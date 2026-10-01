// 在打开的「数根」页面里跑一段 JS。用法: node test/eval_page.cjs <文件 或 表达式>
// 表达式较长时建议写成文件，免得被 shell 和反引号吃掉。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const arg = process.argv[2] || '';
const expr = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
const part = process.argv[3] || 'localhost:8138';

http.get('http://localhost:9222/json', r => {
  let d = ''; r.on('data', c => d += c); r.on('end', () => {
    const pages = JSON.parse(d).filter(t => t.type === 'page' && t.url.includes(part));
    if (!pages.length) { console.error('没有匹配的标签: ' + part); process.exit(1); }
    const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
    ws.on('open', () => ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true }
    })));
    ws.on('message', m => {
      const x = JSON.parse(m); if (x.id !== 1) return;
      const R = x.result;
      if (R.exceptionDetails) console.error('报错: ' + JSON.stringify(R.exceptionDetails.exception).slice(0, 500));
      else console.log(typeof R.result.value === 'string' ? R.result.value : JSON.stringify(R.result.value, null, 1));
      ws.close(); process.exit(0);
    });
  });
}).on('error', e => { console.error('连不上 Chrome：' + e.message); process.exit(1); });
