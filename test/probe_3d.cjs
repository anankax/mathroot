// 3D 到底能不能用？逐条在真 applet 里试，建对象来判，不看文档。
//   要验：setPerspective('T') 切不切得过去 / 3D 的轴和坐标范围 API / 各种立体图形命令 /
//        中文命令名在 3D 下认不认（2D 下实测只认英文）/ 切回 'G' 会不会坏 / getPNGBase64 在 3D 下还能不能用
// 用法: node test/probe_3d.cjs      （要先起 node test/serve.cjs 8138）
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

// 每条：label 名字、cmds 逐条喂进 applet 的命令、want 该不该建出东西。
//   want:false = **预期不过**，是在记录一条已知约束，不算缺陷——
//   混在一起报的话，"红的那几条"和"故意让它红的那几条"就分不开了。
const CASES = [
  { label: '3D 点', cmds: ['A=(0,0,0)', 'B=(2,0,0)'] },
  { label: '正方体 Cube', cmds: ['A=(0,0,0)', 'B=(2,0,0)', 'Cube(A,B)'] },
  { label: '球 Sphere', cmds: ['Sphere((0,0,0),2)'] },
  { label: '圆锥 Cone', cmds: ['c=Circle((0,0,0),2)', 'Cone(c,3)'] },
  { label: '圆柱 Cylinder', cmds: ['c2=Circle((0,0,0),2)', 'Cylinder(c2,3)'] },
  { label: '四面体 Tetrahedron', cmds: ['A2=(0,0,0)', 'B2=(2,0,0)', 'Tetrahedron(A2,B2)'] },
  { label: '平面 Plane', cmds: ['P1=(0,0,0)', 'P2=(1,0,0)', 'P3=(0,1,0)', 'Plane(P1,P2,P3)'] },
  { label: '3D 线段 Segment', cmds: ['S1=(0,0,0)', 'S2=(1,2,3)', 'Segment(S1,S2)'] },
  { label: '旋转 Rotate', cmds: ['cube1=Cube((0,0,0),(1,0,0))', 'Rotate(cube1, 45°, zAxis)'] },
  { label: '滑动条 Slider', cmds: ['α=Slider(0,2*pi,0.05)'] },
  { label: '棱柱 Prism(多边形,高)', cmds: ['A5=(0,0,0)', 'B5=(2,0,0)', 'C5=(0,2,0)', 'pl=Polygon(A5,B5,C5)', 'Prism(pl,3)'] },
  { label: '棱锥 Pyramid(多边形,高)', cmds: ['A6=(0,0,0)', 'B6=(2,0,0)', 'C6=(0,2,0)', 'pl2=Polygon(A6,B6,C6)', 'Pyramid(pl2,1.5)'] },

  // ---- 平移 ----
  // ★ 2026-10-01 这一条连着报了两轮"✗"，追下去发现是**探针自己把命令写错了**：
  //   原来写的是 `Vector((1,2,3))`（单个点）和 `Vector((0,0,0),(1,2,3))`（两个内联坐标），
  //   这两种 Vector 都建不出来 → v 不存在 → Translate 当然返回 false。
  //   换成两个**命名点** `Vector(P,Q)`，Translate(P,v) 和 Translate(c1,v) 一次就过。
  //   教训跟别处一样：脚本报红，先看它喂进去的到底是什么，别先信它的结论。
  { label: '平移 Translate(点,两点向量)', cmds: ['P=(0,0,0)', 'Q=(1,2,3)', 'v=Vector(P,Q)', 'Translate(P,v)'] },
  { label: '平移 Translate(立体图形)', cmds: ['P=(0,0,0)', 'Q=(1,2,3)', 'v=Vector(P,Q)', 'c1=Cube((0,0,0),(1,0,0))', 'Translate(c1,v)'] },

  // ---- 以下都是**预期不过**，留着是为了把约束钉在明处 ----
  // 1) Prism / Pyramid 要的是**一个多边形对象**，不是散着的点。
  { label: '棱柱 Prism(A,B,C,3)', want: false, cmds: ['A=(0,0,0)', 'B=(2,0,0)', 'C=(0,2,0)', 'Prism(A,B,C,3)'] },
  { label: '棱锥 Pyramid(A,B,C,3)', want: false, cmds: ['A=(0,0,0)', 'B=(2,0,0)', 'C=(0,2,0)', 'Pyramid(A,B,C,3)'] },
  // 2) 3D 下**只认英文命令名**（跟 2D 一样），中文字面一条都不认——
  //    所以线上必须先过 translate() 翻译，再喂给 evalCommand。
  { label: '中文：球', want: false, cmds: ['球((0,0,0),2)'] },
  { label: '中文：立方体', want: false, cmds: ['A3=(0,0,0)', 'B3=(2,0,0)', '立方体(A3,B3)'] },
  { label: '中文：棱柱', want: false, cmds: ['A4=(0,0,0)', 'B4=(1,0,0)', 'C4=(0,1,0)', '棱柱(A4,B4,C4,2)'] },
  { label: '中文：平面', want: false, cmds: ['Q1=(0,0,0)', 'Q2=(1,0,0)', 'Q3=(0,1,0)', '平面(Q1,Q2,Q3)'] },
  { label: '中文：平移', want: false, cmds: ['pt2=(0,0,0)', 'Q9=(1,2,3)', 'v2=Vector(pt2,Q9)', '平移(pt2,v2)'] }
];

function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

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
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200);
    return R && R.result ? R.result.value : null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const shot = async name => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(s.result.data, 'base64'));
    return name;
  };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 24; i++) {
    await sleep(1500);
    if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break;
  }
  console.log('画板就绪:', await q('SR.board.isReady()'));
  console.log('appName 生效的代码库:', await q('(function(){try{return ggbApplet.getHTML5Codebase?String(ggbApplet.getHTML5Codebase()).slice(-40):"取不到"}catch(e){return "THROW"}})()'));

  // ---- 1. 切 3D ----
  console.log('\n--- 1. setPerspective("T") 切不切得过去 ---');
  console.log('  API 有哪些相关方法:', await q('JSON.stringify(["setPerspective","enable3D","setAxesVisible","setCoordSystem","getPNGBase64","getScreenshotBase64"].map(function(n){return n+"="+(typeof ggbApplet[n])}))'));
  const r1 = await q('(function(){try{ggbApplet.setPerspective("T");return "ok"}catch(e){return "THROW:"+e.message}})()');
  console.log('  setPerspective("T") →', r1);
  await sleep(2500);
  console.log('  视图区 DOM:', await q('JSON.stringify(Array.from(document.querySelectorAll("#ggb canvas,.applet_scaler,.ggbView")).map(function(e){return e.tagName+"."+(e.className||"").toString().slice(0,30)})).slice(0,300)'));
  console.log('  截图:', await shot('_3d_view.png'));

  // ---- 2. 3D 的轴 / 坐标范围 API ----
  console.log('\n--- 2. 3D 的 setAxesVisible(3,...) / setCoordSystem(7参) ---');
  console.log('  setAxesVisible(3,true,true,true) →', await q('(function(){try{ggbApplet.setAxesVisible(3,true,true,true);return "ok"}catch(e){return "THROW:"+e.message}})()'));
  console.log('  setCoordSystem(-5,5,-5,5,-5,5,true) →', await q('(function(){try{ggbApplet.setCoordSystem(-5,5,-5,5,-5,5,true);return "ok"}catch(e){return "THROW:"+e.message}})()'));
  await sleep(1200);
  console.log('  截图:', await shot('_3d_axes.png'));

  // ---- 3. 逐条建对象 ----
  console.log('\n--- 3. 3D 命令建不建得出东西 ---');
  let ok = 0, must = 0; const bad = [], known = [];
  for (const c of CASES) {
    const label = c.label, cmds = c.cmds, want = c.want !== false;
    await q('ggbApplet.newConstruction()').catch(() => {});
    await sleep(150);
    await q('ggbApplet.setPerspective("T")');
    await sleep(300);
    for (const one of cmds.slice(0, -1)) await q('ggbApplet.evalCommand(' + JSON.stringify(one) + ')');
    await sleep(250);
    const before = await q('ggbApplet.getAllObjectNames()');
    const cr = await q('(function(){try{return String(ggbApplet.evalCommand(' + JSON.stringify(cmds[cmds.length - 1]) + '))}catch(e){return "THROW:"+e.message}})()');
    await sleep(350);
    const after = await q('ggbApplet.getAllObjectNames()');
    const added = after.filter(n => before.indexOf(n) < 0);
    const pass = added.length > 0;
    if (want) { must++; if (pass) ok++; else bad.push(label); } else if (!pass) known.push(label);
    console.log('   ' + (pass ? '✓ ' : (want ? '✗ ' : '· ')) + label.padEnd(24) + ' `' +
      cmds[cmds.length - 1] + '` 返回 ' + String(cr).slice(0, 12) + '  新增 ' + JSON.stringify(added).slice(0, 80));
  }
  console.log('  该过的过了 ' + ok + '/' + must + (bad.length ? '   ★没过的：' + bad.join('、') : ''));
  console.log('  预期不过 ' + known.length + ' 条（已知约束，不算缺陷）：' + known.join('、'));
  if (bad.length) console.log('  ★ 有该过的没过——下面几张截图要看一眼，别让它悄悄混过去。');
  process.exitCode = bad.length ? 1 : 0;
  console.log('  截图:', await shot('_3d_solids.png'));

  // ---- 4. getPNGBase64 在 3D 下还能不能用 ----
  console.log('\n--- 4. getPNGBase64 在 3D 下 ---');
  console.log('  ' + await q('(function(){try{var s=ggbApplet.getPNGBase64(1,false,72);return s?"有图，长度 "+s.length:s?"空":String(s)}catch(e){return "THROW:"+e.message}})()'));
  console.log('  getScreenshotBase64 存在吗: ' + await q('typeof ggbApplet.getScreenshotBase64'));

  // ---- 5. 切回 2D 会不会坏 ----
  console.log('\n--- 5. 切回 "G" 之后 2D 还正不正常 ---');
  await q('ggbApplet.newConstruction()');
  await q('ggbApplet.setPerspective("G")');
  await sleep(1500);
  await q('SR.board.run(["数轴","A=(-2,0)","B=(1,0)","线段(A,B)"])');
  for (let i = 0; i < 20; i++) { await sleep(300); if (!(await q('SR.board.isBusy()'))) break; }
  await sleep(500);
  console.log('  2D 对象: ' + JSON.stringify(await q('ggbApplet.getAllObjectNames()')));
  console.log('  截图:', await shot('_3d_backto2d.png'));

  // ---- 6. 来回切几次，看稳不稳 ----
  console.log('\n--- 6. 平面/三维 来回切 4 次 ---');
  for (let i = 0; i < 4; i++) {
    await q('ggbApplet.setPerspective(' + JSON.stringify(i % 2 ? 'G' : 'T') + ')');
    await sleep(600);
  }
  console.log('  最终视图截图:', await shot('_3d_toggle.png'));

  ws.close(); process.exit(process.exitCode || 0);
})();
