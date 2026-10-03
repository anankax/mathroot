// 尺子：老师**亲手点了工位那一行**之后，那条「我按【X】办的」还在不在？
//
// 背景（2026-10-03 扫场 test/_sweep6.cjs 的截图里看见的）：
// 第一句「3.2 代数式（第二课时）」被产品归类成【备课】，于是输入框上面横出一条
// 「我按【备课】办的（照像课课题认的）… 换一件」。
// 接着老师点工位行上的【组卷】：工位真的切过去了（对话里还写着「换到「组卷」」），
// **可那条横带还挂着「我按【备课】办的」**。
//
// 这句和眼前自相矛盾，而且它长得像状态栏 —— 老师会当成"它其实还是按备课办的"。
//
// 根因：`clearStrip` 只挂在 pick / rework / ⟳ 三处，而工位按钮走的是
// `main.applyWork`，压根不经过 landing。修在 `js/main.js` 的 applyWork 里。
//
// ★ 这把尺子量的是**屏幕上那条带子还在不在**（`#routebar[hidden]`），
//   不是读代码自述。"改了代码"和"老师看不见它了"是两件事。
//
// 红验（就在本文件里，**探针内部注入**，绝不改坏 js/ 再还原）：
//   在页面上把 `SR.landing.clearStrip` 换成空函数，重放同一个动作 ——
//   这时那条带子**必须还挂着**。若还挂着，说明这一下量的就是它；
//   若换了空函数它照样消失，那是别的东西顺手清掉的，这把尺子就不算数。
//
// 用法：node test/probe_routebar.cjs
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = 'http://localhost:8138/index.html';

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('页面里炸了：' + String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).slice(0, 400));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  // 那条带子现在的样子。★ 量 hidden 属性 + 可见性两样：只有 hidden 不算"老师看不见了"。
  const 带子 = () => ev('(function(){var b=document.getElementById("routebar");if(!b)return{无:true};'
    + 'return{hidden:!!b.hidden,看得见:b.getClientRects().length>0,'
    + '字:(b.innerText||b.textContent||"").replace(/\\s+/g," ").trim(),'
    + '写的工位:SR.chat.getWork()};})()');

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE + '?rb=' + Date.now() });
  for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.chat&&SR.memo&&SR.landing)').catch(() => false)) break; await sleep(500); }
  await sleep(1200);

  // 洗成一张白纸：首屏得亮着（blocking() 要靠 live），不然归类那条根本不会写。
  await ev('(function(){try{SR.memo.clear();}catch(e){}return 1})()');
  await send('Page.navigate', { url: PAGE + '?rb2=' + Date.now() });
  for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.chat&&SR.memo&&SR.landing)').catch(() => false)) break; await sleep(500); }
  await sleep(1500);

  const 开场 = await 带子();
  console.log('开场：' + JSON.stringify(开场));

  // ---- 第一句：不点工位，让它自己归类 ----
  //   用桩把模型挡掉：这一把量的是**归类和那条带子**，不是模型说什么。
  //   （照 probe_repaint_fence.cjs 的做法，自己造一段 SSE。）
  await ev('(function(){'
    + 'var R=String.fromCharCode(96);'
    + 'var body="data: "+JSON.stringify({choices:[{delta:{content:"好。"}}]})+"\\n\\n"'
    + '+"data: [DONE]\\n\\n";'
    + 'window.fetch=function(){return Promise.resolve(new Response(body,{status:200,headers:{"Content-Type":"text/event-stream"}}));};'
    + 'return 1})()');

  await ev('(function(){var i=document.getElementById("input");i.focus();i.value="3.2 代数式（第二课时）";i.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
  await sleep(150);
  await ev('document.getElementById("send").click(); 1');
  await sleep(2500);
  const 归完 = await 带子();
  console.log('归完类：' + JSON.stringify(归完));

  // ---- 老师亲手点工位行上的【组卷】----
  //   ★ 用**工位行那颗真按钮**（.workbtn），不是首屏那张卡 —— 老师日常走的就是这一颗。
  const 点了 = await ev('(function(){var b=document.querySelector(".workbtn[data-work=\\"material\\"]");'
    + 'if(!b)return false;b.click();return true;})()');
  await sleep(600);
  const 切完 = await 带子();
  console.log('点了【组卷】：' + JSON.stringify(切完));

  // ---- 红验：把 clearStrip 换成空函数，重放同一下 ----
  //   这一把得先回到"带子在"的状态：重新归类一次。
  await ev('(function(){try{SR.memo.clear();}catch(e){}return 1})()');
  await send('Page.navigate', { url: PAGE + '?rb3=' + Date.now() });
  for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.chat&&SR.memo&&SR.landing)').catch(() => false)) break; await sleep(500); }
  await sleep(1500);
  const 装了 = await ev('(function(){var o=SR.landing.clearStrip;if(typeof o!=="function")return{ok:false,why:"clearStrip 不是函数"};'
    + 'SR.landing.clearStrip=function(){};window.__原=o;return{ok:SR.landing.clearStrip!==o};})()');
  console.log('\n红验：把 clearStrip 换成空函数 —— ' + JSON.stringify(装了));
  if (!装了 || !装了.ok) { console.log('★ 故障没注进去 —— 这一把的红验不算，停。'); await closeTab(t.id); ws.close(); process.exit(3); }
  await ev('(function(){var i=document.getElementById("input");i.focus();i.value="3.2 代数式（第二课时）";i.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
  await sleep(150);
  await ev('document.getElementById("send").click(); 1');
  await sleep(2500);
  const 红前 = await 带子();
  await ev('(function(){var b=document.querySelector(".workbtn[data-work=\\"material\\"]");if(b)b.click();return 1})()');
  await sleep(600);
  const 红后 = await 带子();
  console.log('  注入之后：归类完=' + JSON.stringify(红前));
  console.log('  注入之后：点完【组卷】=' + JSON.stringify(红后));

  // ---- 判据 ----
  console.log('\n══ 判定 ══');
  const 条 = [];
  条.push(['第一句归完类，那条带子确实出来了（不是空的）',
    归完 && 归完.看得见 === true && /我按/.test(归完.字), JSON.stringify(归完.字)]);
  条.push(['带子上写的工位，和当时的工位一致',
    归完 && 归完.写的工位 === 'prep', 归完 && 归完.写的工位]);
  条.push(['按钮找得到（.workbtn[data-work=material]）', 点了 === true, String(点了)]);
  条.push(['点完【组卷】，工位真的切过去了',
     切完 && 切完.写的工位 === 'material', 切完 && 切完.写的工位]);
  // ★★ 这一条是这把尺子的正主。
  条.push(['点完工位，那条「我按【备课】办的」**看不见了**',
     切完 && 切完.看得见 === false, '看得见=' + (切完 && 切完.看得见) + ' 字=' + JSON.stringify(切完 && 切完.字)]);
  // 红验：故障注进去之后，同一下**必须清不掉** —— 否则这尺子量的不是这一下。
  条.push(['【红验】把 clearStrip 换成空函数后，同一下清不掉了（带子还挂着）',
     红后 && 红后.看得见 === true, '看得见=' + (红后 && 红后.看得见) + ' 字=' + JSON.stringify(红后 && 红后.字)]);

  let 红 = 0;
  for (const [名, ok, 值] of 条) { if (!ok) 红++; console.log('  ' + (ok ? '✓' : '✗') + ' ' + 名 + '   【' + 值 + '】'); }
  console.log('\n' + (红 ? '★ 红了 ' + 红 + ' 条' : '★ 全绿：老师亲手点了工位，那条过期的归类就下去了'));
  await closeTab(t.id); ws.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });
