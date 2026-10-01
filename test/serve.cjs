// 测试用的静态服务器：**明确 no-store**。
//
// 为什么不用 python -m http.server：它只发 Last-Modified，浏览器按启发式规则缓存，
// 于是「改了 js 但页面还是老行为」会反复骗人——这一坑今天已经踩过一次
// （config.js 加了 SR.GGB_APP，页面里读出来是 undefined）。
// 用法: node test/serve.cjs [端口，默认 8138]
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || 8138);

// ★ .svg 一定要列进来：漏了就会按 application/octet-stream 发，
//   Chrome 拿到 octet-stream 的图是**拒绝渲染**的——<img> 直接 onerror、naturalWidth 0。
//   这不影响线上（GitHub Pages 自己认 .svg），但会让本地验证看到一个和线上不一样的页面，
//   属于"测试环境骗自己"那一类坑。logo 就这么在本地一直是隐形的一段时间。
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end('not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache', 'Expires': '0'
  });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log('数根测试服务器 http://localhost:' + PORT + '/index.html  (no-store)'));
