const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'public');
const port = process.env.PORT || 3000;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
};

const maxBodyBytes = 32 * 1024;
const rateLimitWindowMs = 15 * 60 * 1000;
const rateLimitMax = 5;
const contactAttempts = new Map();

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character]));
}

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
}

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (contactAttempts.get(ip) || []).filter(timestamp => now - timestamp < rateLimitWindowMs);
  if (recent.length >= rateLimitMax) {
    contactAttempts.set(ip, recent);
    return true;
  }
  recent.push(now);
  contactAttempts.set(ip, recent);
  return false;
}

async function deliverContactEmail(contact) {
  const apiKey = process.env.RESEND_API_KEY;
  const contactEmail = process.env.CONTACT_EMAIL;
  const fromEmail = process.env.CONTACT_FROM_EMAIL || 'Berg Systems <onboarding@resend.dev>';

  if (!apiKey || !contactEmail) {
    throw new Error('Contact email environment variables are missing');
  }

  const safe = Object.fromEntries(Object.entries(contact).map(([key, value]) => [key, escapeHtml(value)]));
  const businessLine = contact.business || 'Not provided';
  const emailText = [
    'New Berg Systems website inquiry',
    '',
    `Name: ${contact.name}`,
    `Email: ${contact.email}`,
    `Business: ${businessLine}`,
    '',
    'Message:',
    contact.message,
  ].join('\n');

  const response = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [contactEmail],
      reply_to: contact.email,
      subject: `New Berg Systems inquiry from ${contact.name}`,
      text: emailText,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#17231f;max-width:640px">
          <h2 style="color:#245b4a">New Berg Systems website inquiry</h2>
          <p><strong>Name:</strong> ${safe.name}<br>
          <strong>Email:</strong> <a href="mailto:${safe.email}">${safe.email}</a><br>
          <strong>Business:</strong> ${safe.business || 'Not provided'}</p>
          <p><strong>Message:</strong></p>
          <p style="white-space:pre-wrap;background:#f5f3ed;padding:16px;border-radius:10px">${safe.message}</p>
        </div>`,
    }),
  });

  const resultText = await response.text();
  if (!response.ok) {
    console.error(`[contact] Resend rejected delivery (${response.status}): ${resultText.slice(0, 500)}`);
    throw new Error('Resend delivery failed');
  }

  let deliveryId = 'accepted';
  try {
    deliveryId = JSON.parse(resultText).id || deliveryId;
  } catch {
    // A successful response without JSON is still accepted by the delivery provider.
  }
  console.log(`[contact] Email accepted by Resend: ${deliveryId}`);
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/contact') {
    let body = '';
    let tooLarge = false;

    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxBodyBytes) {
        body = '';
        tooLarge = true;
      }
    });

    req.on('end', async () => {
      if (tooLarge) {
        return sendJson(res, 413, { ok: false, message: 'That message is too long. Please shorten it and try again.' });
      }

      try {
        const submitted = JSON.parse(body);
        const contact = {
          name: clean(submitted.name, 100),
          email: clean(submitted.email, 254),
          business: clean(submitted.business, 150),
          message: clean(submitted.message, 5000),
        };

        if (!contact.name || !contact.email || !contact.message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
          return sendJson(res, 400, { ok: false, message: 'Please fill out the required fields with a valid email address.' });
        }

        if (isRateLimited(requestIp(req))) {
          return sendJson(res, 429, { ok: false, message: 'Please wait a few minutes before sending another message.' });
        }

        await deliverContactEmail(contact);
        return sendJson(res, 200, { ok: true, message: 'Thanks — your message was sent. We’ll be in touch soon.' });
      } catch (error) {
        if (error instanceof SyntaxError) {
          return sendJson(res, 400, { ok: false, message: 'Please fill out the required fields.' });
        }
        console.error(`[contact] Delivery error: ${error.message}`);
        return sendJson(res, 502, { ok: false, message: 'Your message could not be sent. Please try again in a moment.' });
      }
    });
    return;
  }

  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.normalize(path.join(root, requested));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, () => console.log(`Berg Systems listening on ${port}`));
