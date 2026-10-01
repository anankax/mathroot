// 探画板：走产品自己的那条路（SR.board.run），看数轴出得对不对、
// 播放键动不动、有没有弹错误框。
// 用法: node test/probe_board.cjs
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
  const shot2 = async name => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(s.result.data, 'base64'));
    return path.join(__dirname, name);
  };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  await sleep(1500);
  await send('Page.reload', { ignoreCache: true });   // 同域普通导航吃缓存，必须硬重载
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break;
  }
  console.log('画板就绪:', await q('SR.board.isReady()'), '  GGB_APP =', await q('SR.GGB_APP'));

  // 代数面板：摆两个函数出来，看底下那块面板还在不在
  console.log('\n--- 代数面板（有函数的时候看）---');
  await q(`SR.board.run(['#清空','坐标系','f(x)=2x+1','g(x)=-x+3'])`);
  for (let i = 0; i < 20; i++) { await sleep(400); if (!(await q('SR.board.isBusy()'))) break; }
  await sleep(800);
  console.log('  底下面板占了多少（画布高度 / 容器高度）: ' +
    await q('JSON.stringify({canvas:(document.querySelector(".ggbApplet, canvas")||{}).clientHeight||0, box:document.getElementById("ggb").clientHeight, panel:document.querySelectorAll(".avItem,.algebraPanel,.algebraView").length})'));
  console.log('  截图: ' + await shot2('_algpanel.png'));

  console.log('\n--- 关键方法在不在 ---');
  for (const n of ['setAxesVisible', 'setGridVisible', 'setCoordSystem', 'setPerspective',
    'setVisibleInView', 'setErrorDialogsActive', 'setAnimating', 'startAnimation']) {
    const ty = await q('typeof window.ggbApplet["' + n + '"]');
    console.log('   ' + (ty === 'function' ? '✓' : '✗') + ' ' + n);
  }

  // ---- 走产品自己的那条路 ----
  console.log('\n--- 走 SR.board.run（数轴 + 动点）---');
  await q(`SR.board.run(['#清空','数轴','t=Slider(-4,4,0.1)','#隐藏 t','P=(t,0)','#播放 t'])`);
  for (let i = 0; i < 20; i++) { await sleep(400); if (!(await q('SR.board.isBusy()'))) break; }
  console.log('  画完了（isBusy = ' + (await q('SR.board.isBusy()')) + '，等了几次循环内）');
  console.log('  对象:', JSON.stringify(await q('window.ggbApplet.getAllObjectNames()')));
  console.log('  可播放:', await q('SR.board.canPlay()'));
  console.log('  轴上还剩什么（x轴可见/y轴可见/网格）:',
    await q('JSON.stringify({x:ggbApplet.getVisible("xAxis"),y:ggbApplet.getVisible("yAxis"),g:ggbApplet.getGridVisible?ggbApplet.getGridVisible():"n/a"})'));

  // ---- 点播放键 ----
  console.log('\n--- 播放键 ---');
  const before = await q('JSON.stringify({t:ggbApplet.getValue("t"),btn:document.getElementById("btn-play").textContent})');
  console.log('  点之前:', before);
  await q('document.getElementById("btn-play").click()');
  const curve = [];
  for (let i = 0; i < 6; i++) { await sleep(700); curve.push(await q('ggbApplet.getValue("t")')); }
  console.log('  t 采样:', curve.map(v => (typeof v === 'number' ? v.toFixed(2) : v)).join(' → '));
  const moved = curve.some((v, i) => i > 0 && typeof v === 'number' && v !== curve[0]);
  console.log('  动了吗:', moved ? '✓ 动了' : '✗ 没动');
  await q('document.getElementById("btn-play").click()');

  // ---- 故意喂一条错命令，看还弹不弹框 ----
  console.log('\n--- 故意喂错命令（原来会弹"未知的指令"模态框）---');
  await q(`SR.board.run(['SetGridVisible[false]','SetVisibleInView[xAxis,1,true]'])`);
  await sleep(1800);
  const dlg = await q(`JSON.stringify({
      dialogCount: document.querySelectorAll(".ggbDialog,.dialogError,.ui-dialog,.dialogComponent").length,
      errOnPage: (document.body.innerText.match(/未知的指令[^\\n]*/)||[""])[0],
      obvious: document.body.innerText.indexOf("在线帮助") >= 0
    })`);
  console.log('  ' + dlg);

  // ---- 坐标系走一遍 ----
  console.log('\n--- 坐标系 ---');
  await q(`SR.board.run(['#清空','坐标系','f(x)=2x+1','g(x)=-x+3','交点(f,g)'])`);
  for (let i = 0; i < 20; i++) { await sleep(400); if (!(await q('SR.board.isBusy()'))) break; }
  console.log('  对象:', JSON.stringify(await q('window.ggbApplet.getAllObjectNames()')));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, '_board.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('\n截图: ' + path.join(__dirname, '_board.png') + '   TABID=' + t.id);
  ws.close(); process.exit(0);
})();
