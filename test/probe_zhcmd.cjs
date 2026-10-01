// 逐条验：中文命令经过 board.js 的翻译之后，在真 applet 里到底建不建得出东西。
// 每条都先 newConstruction，摆好前置对象，再把命令交给 SR.board.run（走产品自己的路）。
// 用法: node test/probe_zhcmd.cjs
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

// 每条的最后一个元素是被测命令，前面的是前置
const CASES = [
  ['A=(-3,0)', 'B=(2,0)', '线段(A,B)'],
  ['A=(0,0)', 'B=(3,0)', '直线(A,B)'],
  ['A=(0,0)', 'B=(3,0)', '射线(A,B)'],
  ['A=(0,0)', 'B=(3,0)', '向量(A,B)'],
  ['O=(0,0)', '圆(O,2)'],
  ['A=(0,0)', 'B=(2,0)', 'C=(1,2)', '多边形(A,B,C)'],
  ['A=(0,0)', 'B=(4,0)', '中点(A,B)'],
  ['A=(1,2)', 'B=(3,4)', '中垂线(A,B)'],
  ['A=(1,2)', '垂线(A,x轴)'],
  ['A=(0,0)', 'B=(2,0)', 'C=(1,1)', '角(A,B,C)'],
  ['A=(0,0)', 'B=(3,4)', '距离(A,B)'],
  ['f(x)=2x+1', 'g(x)=-x+3', '交点(f,g)'],
  // 注意：文本(字符串, true, true) 这个两布尔的写法 GeoGebra 不认，必须给位置
  ['A=(0,0)', 'B=(2,0)', 'C=(1,2)', '文本("这是一个三角形", (1,2))'],
  ['A=(0,0)', 'B=(4,0)', 'C=(0,3)', '多边形(A,B,C)']
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
  console.log('画板就绪:', await q('SR.board.isReady()'), '\n');

  console.log('--- 翻译表（光看字符串）---');
  for (const c of CASES) {
    const last = c[c.length - 1];
    console.log('   ' + last.padEnd(30) + ' → ' + await q('SR.board.translate(' + JSON.stringify(last) + ')'));
  }
  console.log('   ' + '#隐藏 x轴'.padEnd(28) + ' → ' + await q('SR.board.translate("x轴")'));

  console.log('\n--- 真 applet 里建得出来吗 ---');
  let ok = 0, bad = [];
  for (const c of CASES) {
    const last = c[c.length - 1];
    await q('ggbApplet.newConstruction()').catch(() => {});
    await sleep(200);
    for (const pre of c.slice(0, -1)) { await q('ggbApplet.evalCommand(' + JSON.stringify(pre) + ')'); }
    await sleep(250);
    const before = await q('ggbApplet.getAllObjectNames()');
    await q('SR.board.run([' + JSON.stringify(last) + '])');
    for (let i = 0; i < 15; i++) { await sleep(250); if (!(await q('SR.board.isBusy()'))) break; }
    await sleep(300);
    const after = await q('ggbApplet.getAllObjectNames()');
    const added = after.filter(n => before.indexOf(n) < 0);
    const pass = added.length > 0;
    if (pass) ok++; else bad.push(last);
    console.log('   ' + (pass ? '✓' : '✗') + ' ' + last.padEnd(30) + ' 新增 ' + JSON.stringify(added));
  }
  console.log('\n过关 ' + ok + '/' + CASES.length + (bad.length ? '   没过的：' + bad.join('、') : ''));

  console.log('\n--- 故意喂一条英文老写法，确认没被翻译表搞坏 ---');
  await q('ggbApplet.newConstruction()');
  await q('SR.board.run(["A=(0,0)","B=(3,0)","Segment(A,B)"])');
  for (let i = 0; i < 12; i++) { await sleep(250); if (!(await q('SR.board.isBusy()'))) break; }
  console.log('   英文 Segment(A,B) 之后的对象: ' + JSON.stringify(await q('ggbApplet.getAllObjectNames()')));

  ws.close(); process.exit(0);
})();
