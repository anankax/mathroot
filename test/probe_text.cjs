// 找 文本(...) 在 classic 里能用的写法。用法: node test/probe_text.cjs
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

const VARIANTS = [
  'Text("你好")',
  'Text("你好", (1,2))',
  'Text("你好", true, true)',
  'Text("你好", (1,2), true, true)',
  'a1=Text("你好")',
  'a1=Text("你好",(1,2))',
  'Text["你好"]',
  'Text["你好",(1,2)]',
  '文本("你好")',
  't1=Text("∠A=40°", true, true)'
];

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {});
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 160);
    return R && R.result ? R.result.value : null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break;
  }
  console.log('appName:', await q('SR.GGB_APP'));

  for (const v of VARIANTS) {
    await q('ggbApplet.newConstruction()');
    await sleep(250);
    const before = await q('ggbApplet.getAllObjectNames()');
    const ret = await q('(function(){try{return String(ggbApplet.evalCommand(' + JSON.stringify(v) + '))}catch(e){return "THROW:"+e.message}})()');
    await sleep(350);
    const after = await q('ggbApplet.getAllObjectNames()');
    const added = after.filter(n => before.indexOf(n) < 0);
    console.log('  ' + (added.length ? '✓' : '✗') + ' ' + v.padEnd(38) + ' 返回 ' + String(ret).padEnd(6) + ' 新增 ' + JSON.stringify(added));
  }
  ws.close(); process.exit(0);
})();
