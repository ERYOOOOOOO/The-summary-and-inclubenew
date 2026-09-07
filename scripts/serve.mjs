#!/usr/bin/env node
// Tiny static server so the page can fetch data/news.json.
// Opening index.html straight from the file system will not work: browsers
// block fetch() on file:// URLs.
//
//   node scripts/serve.mjs [port]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, relative);

  // Never serve anything outside the project directory.
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(file);
    const target = info.isDirectory() ? path.join(file, 'index.html') : file;
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`serving ${ROOT}\n  http://localhost:${PORT}`);
});
