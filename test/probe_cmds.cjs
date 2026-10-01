// 探两件事：
//   1. 数轴之后 y 轴到底藏住没有（setAxesVisible(true,false) 真的管用吗）
//   2. 交点命令该写中文还是英文（zh_CN applet 里 evalCommand 认哪个）
// 用法: node test/probe_cmds.cjs
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

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
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 160);
    return R && R.result ? R.result.value : null;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const shot = async name => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(s.result.data, 'base64'));
    return path.join(__dirname, name);
  };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break;
  }

  // ---- 代数面板：程序里调 setPerspective 管不管用 ----
  console.log('--- 代数面板 ---');
  console.log('  调之前，面板在不在:', await q('document.body.innerText.indexOf("fx")>=0 || !!document.querySelector(".avItem,.algebraPanel")'));
  console.log('  setPerspective("G") =>', await q('(function(){try{ggbApplet.setPerspective("G");return "ok"}catch(e){return "THROW:"+e.message}})()'));
  await sleep(1200);
  console.log('  调之后，面板里还有没有那两行 f/g:', await q('document.body.innerText.indexOf("fx")>=0'));

  // ---- 数轴：y 轴藏住没有 ----
  console.log('\n--- 数轴 ---');
  await q(`SR.board.run(['#清空','数轴'])`);
  for (let i = 0; i < 15; i++) { await sleep(300); if (!(await q('SR.board.isBusy()'))) break; }
  await sleep(500);
  console.log('  ' + await q('JSON.stringify({x:ggbApplet.getVisible("xAxis"),y:ggbApplet.getVisible("yAxis"),g:ggbApplet.getGridVisible()})'));
  console.log('  截图: ' + await shot('_numline.png'));

  // ---- 交点：中文还是英文 ----
  console.log('\n--- 交点命令 ---');
  await q(`SR.board.run(['#清空','坐标系','f(x)=2x+1','g(x)=-x+3'])`);
  for (let i = 0; i < 15; i++) { await sleep(300); if (!(await q('SR.board.isBusy()'))) break; }
  console.log('  建曲线之后:', JSON.stringify(await q('ggbApplet.getAllObjectNames()')));

  for (const cmd of ['交点(f,g)', 'Intersect(f,g)', '交点(f, g)', '交点[f,g]', 'Intersect[f,g]', 'A=交点(f,g)', 'A=Intersect(f,g)']) {
    const r = await q('(function(){try{return String(ggbApplet.evalCommand(' + JSON.stringify(cmd) + '))}catch(e){return "THROW:"+e.message}})()');
    await sleep(400);
    const objs = await q('ggbApplet.getAllObjectNames()');
    const newOnes = objs.filter(n => !['f', 'g', 'xAxis', 'yAxis'].includes(n));
    console.log('  ' + JSON.stringify(cmd).padEnd(24) + ' 返回 ' + String(r).padEnd(6) + ' 新增 ' + JSON.stringify(newOnes));
    // 每试一条就清掉上次留下的
    for (const n of newOnes) await q('ggbApplet.deleteObject(' + JSON.stringify(n) + ')');
  }

  console.log('\n  截图: ' + await shot('_cmds.png') + '   TABID=' + t.id);
  ws.close(); process.exit(0);
})();
