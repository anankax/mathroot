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

  // ---- 3D 的中文命令 ----
  // ★ 2026-10-01 加。probe_3d.cjs 那边是**直接把中文喂给 evalCommand**，全 false，
  //   那是为了证明"这个 applet 只认英文"；可线上真正走的是 SR.board.run，中间有一层翻译。
  //   翻译对不对，得在这条路上量——那边量的是 applet 的脾气，这边量的是我们的代码。
  //   注意 Prism/Pyramid 要的是多边形对象：`棱柱(A,B,C,3)` 那种写法 applet 会返回 false，
  //   不是翻译错了，是参数形态不对。提示词里得教"先多边形再棱柱"。
  const CASES3D = [
    ['S=(0,0,0)', 'T2=(2,0,0)', '球(S,2)'],
    ['A=(0,0,0)', 'B=(2,0,0)', '立方体(A,B)'],
    ['A=(0,0,0)', 'B=(2,0,0)', 'C=(0,2,0)', 'pl=Polygon(A,B,C)', '棱柱(pl,3)'],
    ['A=(0,0,0)', 'B=(2,0,0)', 'C=(0,2,0)', 'pl=Polygon(A,B,C)', '棱锥(pl,1.5)'],
    ['A=(0,0,0)', 'B=(3,0,0)', '四面体(A,B)'],
    ['O=(0,0,0)', 'c=Circle(O,2)', '圆锥(c,3)'],
    ['O=(0,0,0)', 'c=Circle(O,2)', '圆柱(c,3)'],
    ['A=(0,0,0)', 'B=(1,2,3)', '棱(A,B)'],
    ['P1=(0,0,0)', 'P2=(1,0,0)', 'P3=(0,1,0)', '平面(P1,P2,P3)'],
    ['A=(0,0,0)', 'B=(1,0,0)', 'k=立方体(A,B)', 'v=Vector((0,0,0),(1,2,3))', '平移(A,v)'],

    // ---- 下面这几条，是 prompt-demo.js **已经写在提示词里教模型用**的写法 ----
    //   提示词里断言了它们能建出东西，可我一直没在 applet 里验过它们本身。
    //   拿没验过的写法去教模型，等于把"猜"写进了提示词——所以照着提示词的原句再打一遍。
    ['A=(0,0,0)', 'B=(2,0,0)', 'C=(0,2,0)', 'D=(0,0,3)', '棱柱(A,B,C,D)'],
    ['A=(0,0,0)', 'B=(2,0,0)', 'C=(0,2,0)', 'D=(1,1,3)', '棱锥(A,B,C,D)'],
    ['A=(0,0,0)', '平移(A,(1,2,3))'],
    // ⚠ 前置命令是**直接喂 evalCommand** 的，不经过 translate。所以这里必须写英文 `Cube`
    //   写中文的话 k 根本不存在，被测的那条命令当然建不出东西——我第一次就是这么把自己坑了：
    //   探针报"旋转失败"，实际是前置没建成，白追了半小时。
    ['A=(0,0,0)', 'B=(1,0,0)', 'k=Cube(A,B)', '旋转(k,45°,z轴)'],
    ['O=(0,0,0)', '球((0,0,0),2)']
  ];
  console.log('\n--- 3D：中文走 SR.board.run，建得出来吗 ---');
  await q('SR.board.setView("3d")');
  await sleep(1500);
  console.log('   现在是 3D 吗: ' + await q('SR.board.is3D()'));
  let ok3 = 0; const bad3 = [];
  for (const c of CASES3D) {
    const last = c[c.length - 1];
    await q('ggbApplet.newConstruction()');
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
    if (pass) ok3++; else bad3.push(last);
    console.log('   ' + (pass ? '✓' : '✗') + ' ' + await q('SR.board.translate(' + JSON.stringify(last) + ')').then(t => String(t).padEnd(22)) +
                ' 新增 ' + JSON.stringify(added.slice(0, 6)));
  }
  console.log('   3D 过关 ' + ok3 + '/' + CASES3D.length + (bad3.length ? '   没过的：' + bad3.join('、') : ''));
  await q('SR.board.setView("2d")');

  console.log('\n--- 故意喂一条英文老写法，确认没被翻译表搞坏 ---');
  await q('ggbApplet.newConstruction()');
  await q('SR.board.run(["A=(0,0)","B=(3,0)","Segment(A,B)"])');
  for (let i = 0; i < 12; i++) { await sleep(250); if (!(await q('SR.board.isBusy()'))) break; }
  console.log('   英文 Segment(A,B) 之后的对象: ' + JSON.stringify(await q('ggbApplet.getAllObjectNames()')));

  ws.close(); process.exit(0);
})();
