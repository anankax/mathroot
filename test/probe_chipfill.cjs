// probe_chipfill —— 「点一颗建议，是填进输入框，还是直接问出去」。
//
// 孔老师 2026-10-04 原话：「提示词点了应该是出现在我的输入框里面，我可以添加内容输入，
// 而不是点一下就直接问出去了。这样我没法修改话语」
//
// 这把尺子量三样：
//   ① 点下去之后，输入框里**有没有**那句话；
//   ② 关**没有发**——历史条数不长、气泡不长（"直接问出去"就是这个）；
//   ③ 框里本来有字的时候，是**接在后面**还是被覆盖（覆盖等于把老师打的字删了）。
// 外加一条红验：把那句"只填不送"的行为改回老样子（点一下就 submit），
//   上面①②两条断言必须当场变假——不然它们量的是"屏幕上恰好有个输入框"。
//
// 用法：node test/probe_chipfill.cjs
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };

const 答 = '画好了。\n\n```想说\n换成三维看看\n加一个动点 P\n把这两个点连起来\n```';

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) return { 炸: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };
  const 开页 = async () => { await send('Page.navigate', { url: 'http://127.0.0.1:8138/index.html' }); for (let i = 0; i < 60; i++) { if (await ev("!!(window.SR&&SR.chat&&document.getElementById('input'))")) break; await sleep(500); } await sleep(2000); };

  await send('Page.enable', null);
  await 开页();
  const 开工前 = await ev("localStorage.getItem('mathroot_memo')");

  // 摆一条带 ```想说 的回复，再重来一趟让 repaintLog 把三颗建议摆出来
  await ev("SR.memo.clear();'ok'");
  await ev("SR.memo.pushTurn('a'," + JSON.stringify(答) + ",'draw'); SR.memo.flush(); 'ok'");
  await 开页();

  console.log('\n── ① 三颗建议在不在 ──');
  const 颗 = await ev("JSON.stringify(Array.prototype.map.call(document.querySelectorAll('.chip'),function(c){return c.textContent;}))");
  判('摆出了三颗可点的建议', JSON.parse(颗 || '[]').length === 3, 颗);

  console.log('\n── ② 点一颗：填进去，还是问出去 ──');
  const 前 = await ev("JSON.stringify({条数:SR.memo.log().length,气泡:document.querySelectorAll('.msg').length,框:document.getElementById('input').value})");
  await ev("document.querySelectorAll('.chip')[1].click();'ok'");
  await sleep(900);
  const 后 = await ev("JSON.stringify({条数:SR.memo.log().length,气泡:document.querySelectorAll('.msg').length,框:document.getElementById('input').value,建议还在:document.querySelectorAll('.chip').length})");
  const A = JSON.parse(前), B = JSON.parse(后);
  判('★ 点完输入框里就是那句话', B.框 === '加一个动点 P', JSON.stringify(B.框));
  判('★ 没有直接问出去（历史没长）', B.条数 === A.条数, A.条数 + ' → ' + B.条数);
  判('★ 没有直接问出去（没多一条气泡）', B.气泡 === A.气泡, A.气泡 + ' → ' + B.气泡);
  判('★ 另外两颗还在（换一颗不用重问一轮）', B.建议还在 === 3, '建议数=' + B.建议还在);
  判('光标落在末尾（接着打就是往后接）', (await ev("document.getElementById('input').selectionStart")) === B.框.length, '光标=' + await ev("document.getElementById('input').selectionStart") + '/' + B.框.length);

  console.log('\n── ③ 框里已经有字：接在后面，不许覆盖 ──');
  await ev("(function(){var i=document.getElementById('input');i.value='这道题';i.dispatchEvent(new Event('input',{bubbles:true}));return 'ok';})()");
  await ev("document.querySelectorAll('.chip')[2].click();'ok'");
  await sleep(600);
  const C = await ev("document.getElementById('input').value");
  判('★ 老师先打的字还在（覆盖 = 看不见地删掉他刚打的字）', C.indexOf('这道题') === 0, JSON.stringify(C));
  判('点的那句接在后面', C.indexOf('把这两个点连起来') > 0, JSON.stringify(C));

  console.log('\n── ④ 红验：②里"没发出去"那两条读数，换成一条**该发**的路，必须读到"发了" ──');
  // 老行为（点一下就 submit）没法从外面装回去——`submit` 在闭包里，露不出来。
  // 所以红验改成量**读数本身有没有分辨力**：②用哪两样判"没发"（气泡没多、框没被清），
  // 这里就用**同两样**，换一条已知会发的路（回车），必须读到"发了"。读不到，就说明
  // ②那条绿不是因为"没发"，而是因为**这把尺子根本量不出'发了'**——那才是假绿。
  //
  // ⚠ 教训（2026-10-04，第一次跑这把尺子时踩的）：红验原先量的是 `SR.memo.log().length`，
  //   而②量的是**气泡**——两把尺子不一样。`memo.log()` 要等模型把回复写完才写
  //   （js/chat.js:1610 `SR.memo.pushTurn('user', …)` 在 res 回来之后），1.2 秒去看
  //   当然没长，于是红验当场报假红。**红验换了尺子就不是红验了。**
  await ev("(function(){var i=document.getElementById('input');i.value='红验用';i.dispatchEvent(new Event('input',{bubbles:true}));i.focus();return 'ok';})()");
  const 对前 = JSON.parse(await ev("JSON.stringify({气泡:document.querySelectorAll('.msg').length,框:document.getElementById('input').value})"));
  await ev("(function(){var i=document.getElementById('input');i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return 'ok';})()");
  let 对后 = null;
  for (let i = 0; i < 20; i++) {                     // 气泡是当场多出来的（实测 400ms 内），给足 8 秒
    await sleep(400);
    对后 = JSON.parse(await ev("JSON.stringify({气泡:document.querySelectorAll('.msg').length,框:document.getElementById('input').value})"));
    if (对后.气泡 > 对前.气泡) break;
  }
  判('★红验：同一把尺子（气泡数），换一条**该发**的路（回车），必须读到"发出去了"（否则②那条绿是白给的）', 对后.气泡 > 对前.气泡, 对前.气泡 + ' → ' + 对后.气泡);
  判('★红验：回车那条路会把框清掉——②里"框里还是那句话"才说明没发', 对后.框 === '' && 对前.框 !== '', JSON.stringify(对前.框) + ' → ' + JSON.stringify(对后.框));

  // 收工还原
  if (开工前 === null) await ev("SR.memo.clear();'ok'");
  else await ev("(function(){try{localStorage.setItem('mathroot_memo'," + JSON.stringify(开工前) + ");}catch(e){}return 'ok';})()");
  await new Promise(r2 => http.get({ host: 'localhost', port: 9222, path: '/json/close/' + t.id }, x => { x.resume(); x.on('end', r2); }).on('error', r2));
  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  process.exit(红 ? 1 : 0);
})();
