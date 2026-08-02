const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, 'public');
const port = process.env.PORT || 3000;
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json' };

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/contact') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.name || !data.email || !data.message) throw new Error('required');
        console.log(`[contact] ${new Date().toISOString()} | ${data.name} | ${data.email} | ${data.business || '—'} | ${data.message}`);
        res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true,message:'Thanks — your message is on its way. We’ll be in touch soon.'}));
      } catch { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,message:'Please fill out the required fields.'})); }
    }); return;
  }
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.normalize(path.join(root, requested));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'}); res.end(data); });
});
server.listen(port, () => console.log(`Berg Systems listening on ${port}`));
