// probe_ggbcn —— 「www.geogebra.org 不通的时候，画板还能不能起来、图还画不画得出来」。
//
// 为什么要有这一把尺子：
//   孔老师 2026-10-04 报「出不来图，后面还是图没画出来」。干净浏览器里本地/线上都是
//   4~6 秒出图（test/_shot/_diagfig.cjs 量的），一模一样 —— 说明问题不在出图那条路，
//   在他那次会话**画板根本没起来**。而他的机器 nslookup 出来：`www.geogebra.org` 只有
//   CloudFront 的 IPv6（2600:9000:…），国内那条路经常整段不通。板子起不来 = 一道图都出不来。
//   修法：index.html 的 geogebra 源链加了 `cdn.geogebra.org`（另一组边缘，3.161.82.x），
//   并且 js/board.js 把 codebase 也跟着转到 cdn —— 因为 deployggb.js 里的 codebase
//   是**写死 www** 的，只换脚本等于没换。
//
// ⚠ 这一把尺子**必须把 www 真的挡掉**才量得到那件事。挡没挡住，靠下面那条红验证：
//   两个域名一起挡，板子就该起不来。红验要是红了，说明 CDP 的拦截没生效，
//   上面那条绿就是"在一条通畅的网路上量'断网也能用'"——读数对，量的东西不对。
//
// 用法：node test/probe_ggbcn.cjs
//   （需要 test/serve.cjs 8138 在跑、探针 Chrome 9222 在跑）
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };

const 围栏 = '```ggb\n数轴\nA=(-2,0)\nB=(3,0)\n```';
const 答 = '画好了，数轴上是 -2 和 3。\n\n' + 围栏;

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {}; const 线 = [];
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; }
    if (o.method === 'Runtime.consoleAPICalled') { try { 线.push(o.params.args.map(a => a.value !== undefined ? a.value : a.description).join(' ')); } catch (e) {} } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) return { 炸: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };
  const 挡 = urls => send('Network.setBlockedURLs', { urls });
  const 开页 = async () => { await send('Page.navigate', { url: 'http://127.0.0.1:8138/index.html' }); for (let i = 0; i < 80; i++) { if (await ev("!!(window.SR&&SR.board&&document.getElementById('input'))")) break; await sleep(400); } };
  const 等板 = async (上线秒) => { const t0 = Date.now(); while (Date.now() - t0 < 上线秒 * 1000) { if (await ev("!!(SR.board.isReady&&SR.board.isReady())")) return (Date.now() - t0) / 1000; await sleep(400); } return null; };

  await send('Network.enable', null);
  await send('Page.enable', null);
  await send('Runtime.enable', null);

  console.log('★ 只挡 `www.geogebra.org`（模拟"官方那台走不通"），cdn 那台留着');
  await 挡(['*://www.geogebra.org/*']);
  await 开页();

  console.log('\n── ① 画板起来了没有、靠哪个源 ──');
  const 秒 = await 等板(60);
  判('★★ 官方站不通时，画板照样起得来（靠 cdn 兜底）', 秒 !== null, 秒 === null ? '等了 60 秒还没起' : 秒.toFixed(1) + 's');
  const 用的源 = await ev("(window.SRlib&&SRlib.used&&SRlib.used['geogebra'])||'(没记)'");
  console.log('    geogebra 落在：' + 用的源);
  判('★ 这次确实走的是 cdn.geogebra.org（没走成 www）', String(用的源).indexOf('cdn.geogebra.org') >= 0, String(用的源));

  console.log('\n── ② 走一遍真出图：摆一条带 ggb 的回复 → 点「图」 → 等冻图 ──');
  const 开工前 = await ev("localStorage.getItem('mathroot_memo')");
  await ev("SR.memo.clear();'ok'");
  await ev("SR.memo.pushTurn('a'," + JSON.stringify(答) + ",'draw'); SR.memo.flush(); 'ok'");
  await 开页();
  await sleep(2500);
  const 有占位 = await ev("(function(){var p=document.querySelector('.figbox .figph');return p?p.textContent:null;})()");
  console.log('    那一格写的是：' + JSON.stringify(有占位));
  await ev("(function(){var p=document.querySelector('.figbox .figph');if(p)p.click();return 'ok';})()");
  let 出图 = null, 轨迹 = [];
  const t1 = Date.now();
  while (Date.now() - t1 < 60000) {
    await sleep(400);
    const s = JSON.parse(await ev("(function(){var p=document.querySelector('.figbox .figph');var i=document.querySelector('.figbox .figimg');return JSON.stringify({占位:p?p.textContent:null,有图:!!i,宽:i?i.naturalWidth:null});})()"));
    if (!轨迹.length || 轨迹[轨迹.length - 1].占位 !== s.占位) 轨迹.push({ 秒: ((Date.now() - t1) / 1000).toFixed(1), 占位: s.占位 });
    if (s.有图) { 出图 = Date.now() - t1; break; }
    if (s.占位 === '图没画出来') { 出图 = false; break; }
  }
  console.log('    轨迹：' + JSON.stringify(轨迹));
  判('★★ www 不通时，图还是画得出来（这才是老师要的那件事）', 出图 !== null && 出图 !== false, 出图 ? (出图 / 1000).toFixed(1) + 's 出图' : '没出图');

  // 在 www 被挡的情况下，确认那条 codebase 真的转到了 cdn（不然是"脚本新的、引擎还在 www"）
  const 控制台里的话 = 线.filter(x => /cdn\.geogebra\.org|codebase/i.test(x));
  判('★ codebase 也跟着转到了 cdn（只换脚本等于没换）', 控制台里的话.some(x => /cdn\.geogebra\.org/.test(x)), 控制台里的话.slice(0, 2).join(' | ') || '(控制台没这句话)');

  // 收工还原
  if (开工前 === null) await ev("SR.memo.clear();'ok'"); else await ev("(function(){try{localStorage.setItem('mathroot_memo'," + JSON.stringify(开工前) + ");}catch(e){}return 'ok';})()");

  console.log('\n── ③ 红验：两个域名**一起**挡，板子必须起不来 ──');
  // 这一条盯的是"拦截到底生效没有"。它要是绿了（板子居然照样起来），
  // 那①②两条绿全不作数——那是在一条通畅的网路上量的。
  await 挡(['*://www.geogebra.org/*', '*://cdn.geogebra.org/*']);
  await 开页();
  const 红秒 = await 等板(25);
  判('★红验：两个源一起挡，画板**必须**起不来（起得来 = CDP 拦截没生效，①②全不作数）', 红秒 === null, 红秒 === null ? '没起来（对）' : '★居然 ' + 红秒.toFixed(1) + 's 就起来了');
  await 挡([]);
  await new Promise(r2 => http.get({ host: 'localhost', port: 9222, path: '/json/close/' + t.id }, x => { x.resume(); x.on('end', r2); }).on('error', r2));
  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  process.exit(红 ? 1 : 0);
})();
