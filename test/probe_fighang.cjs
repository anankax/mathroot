// probe_fighang —— 「截图那一步卡住的时候，那格是**一直转**，还是**说一句人话**」。
//
// 为什么要有这一把尺子：
//   孔老师 2026-10-04 的截图里，那一格停在「正在画…」不动。查下来出图这条链上
//   **只有一步没有上限**：`shoot()` 往下走靠的是 `im.onload` / `im.onerror`，
//   两个都不来的时候它一次都不回话，而中间**没有任何一步会报错** ——
//   于是上层（`offscreenJob` 的串行链）就永远挂着，屏幕上一直转、一个字都不说。
//   补法：`shoot` 挂 10 秒上限（SHOOT_MAX），到点就当"没出图"回话。
//
// 怎么把那一档**变成可复现的**：开页之后把 `window.Image` 换成一个
//   "src 设了也什么都不触发"的假货 —— 位图永远不会解码完，`shoot` 那一趟必然卡住。
//   （真货存下来，收工前装回去。）
//
// ⚠ 红验是这一把尺子的正身：把真 `Image` 装回去、再点一次，图**必须**出得来。
//   它同时证两件事：① 卡住确实是那个假货造成的（不是别的原因）；
//   ② 失败的图**没有被缓存**（不然第二次会直接给出上一次的"图没画出来"，
//      而那条读数看着也"对"，却什么也没证明）。
//
// 用法：node test/probe_fighang.cjs
//   （需要 test/serve.cjs 8138 在跑、探针 Chrome 9222 在跑）
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };

const 围栏 = '```ggb\n数轴\nA=(-2,0)\nB=(3,0)\n```';
const 答 = '画好了。\n\n' + 围栏;

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) return { 炸: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };
  const 开页 = async () => { await send('Page.navigate', { url: 'http://127.0.0.1:8138/index.html' }); for (let i = 0; i < 80; i++) { if (await ev("!!(window.SR&&SR.board&&document.getElementById('input'))")) break; await sleep(400); } };
  // 读数：那一格现在写着什么、有没有真图
  const 那格 = "JSON.stringify((function(){var p=document.querySelector('.figbox .figph');var i=document.querySelector('.figbox .figimg');return {占位:p?p.textContent:null,有图:!!i};})())";
  // 点下去之后盯住，直到"有图"或"图没画出来"；返回 {结果, 秒}
  const 盯到完 = async (上限秒) => {
    const t0 = Date.now();
    await ev("(function(){var p=document.querySelector('.figbox .figph');if(p)p.click();return 'ok';})()");
    const 轨迹 = [];
    while (Date.now() - t0 < 上限秒 * 1000) {
      await sleep(300);
      const o = JSON.parse(await ev(那格));
      if (!轨迹.length || 轨迹[轨迹.length - 1].占位 !== o.占位) 轨迹.push({ 秒: +((Date.now() - t0) / 1000).toFixed(1), 占位: o.占位 });
      if (o.有图) return { 结果: '有图', 秒: (Date.now() - t0) / 1000, 轨迹 };
      if (o.占位 === '图没画出来') return { 结果: '认输', 秒: (Date.now() - t0) / 1000, 轨迹 };
    }
    return { 结果: '还在转', 秒: 上限秒, 轨迹 };
  };

  await send('Page.enable', null);
  await 开页();
  await sleep(2500);

  console.log('★ 画板就绪=' + await ev("!!(SR.board.isReady&&SR.board.isReady())") + '（没起来的话下面量的是另一回事）');

  const 开工前 = await ev("localStorage.getItem('mathroot_memo')");
  await ev("SR.memo.clear();'ok'");
  await ev("SR.memo.pushTurn('a'," + JSON.stringify(答) + ",'draw'); SR.memo.flush(); 'ok'");
  await 开页();
  await sleep(2500);
  console.log('★ 那一格写的是：' + await ev("(function(){var p=document.querySelector('.figbox .figph');return p?JSON.stringify(p.textContent):'(没占位)';})()"));

  console.log('\n── ① 把 Image 换成"永远不解码"的假货 → 点「图」 ──');
  await ev("(function(){window.__真Image=window.Image;window.Image=function(){var o={};"
    + "Object.defineProperty(o,'src',{set:function(){},get:function(){return '';}});return o;};return '装上了';})()");
  const 假 = await 盯到完(40);
  console.log('    轨迹：' + JSON.stringify(假.轨迹));
  判('★★ 截图卡住时，那格**认输**（不是一直转）——"转着不说"是最坏的坏法', 假.结果 === '认输', 假.结果 + ' @ ' + 假.秒.toFixed(1) + 's');
  判('★★ 认输要快（≤20 秒）——位图不来这件事，10 秒就该当没戏', 假.结果 === '认输' && 假.秒 <= 20, 假.秒.toFixed(1) + 's');
  判('认输那句还是原来那句人话（"图没画出来"）', (await ev(那格)).indexOf('图没画出来') >= 0, await ev(那格));

  console.log('\n── ② 红验：真 Image 装回去、再点一次，图**必须**出得来 ──');
  // 这一条证两件事：①卡住确实是那个假货造成的；②失败的图**没被缓存**。
  await ev("(function(){window.Image=window.__真Image;return '装回去了';})()");
  const 真 = await 盯到完(30);
  console.log('    轨迹：' + JSON.stringify(真.轨迹));
  判('★红验：真 Image 装回去，同一格再点就出图（证①假货就是原因 ②失败的图没被缓存）', 真.结果 === '有图', 真.结果 + ' @ ' + 真.秒.toFixed(1) + 's');

  // 收工还原
  if (开工前 === null) await ev("SR.memo.clear();'ok'"); else await ev("(function(){try{localStorage.setItem('mathroot_memo'," + JSON.stringify(开工前) + ");}catch(e){}return 'ok';})()");
  await ev("(function(){window.Image=window.__真Image;return 'ok';})()");
  await new Promise(r2 => http.get({ host: 'localhost', port: 9222, path: '/json/close/' + t.id }, x => { x.resume(); x.on('end', r2); }).on('error', r2));
  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  process.exit(红 ? 1 : 0);
})();
