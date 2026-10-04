// probe_noggb —— 「画板起不来的时候，出图这条路会怎么表现」。
//
// 为什么要有这一把尺子：
//   孔老师 2026-10-04 报「图出不来，后面还是图没画出来」。可在**干净浏览器**里，
//   本地和线上跑同一句话都是 4~6 秒出图（test/_shot/_diagfig.cjs 量的），一模一样。
//   于是问题不在那条路上，在"他那次会话的画板根本没起来"。
//   这一把尺子就把那一档**变成可复现的**：开场先拿 CDP 把 geogebra.org 挡掉，
//   板子必然起不来，然后量出图这条路**当场会说什么、多久才说**。
//
// ⚠ 它量的是**表现**，不是"功能对不对"：
//   板子起不来时出不了图，这是物理的，改不了。能改的是**多久认输、认输时说不说人话**。
//   所以断言盯的是这两样，别写成"应该有图"——那一条在任何版本都红。
//
// 用法：node test/probe_noggb.cjs
//   （需要 test/serve.cjs 8138 在跑、探针 Chrome 9222 在跑）
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const 帆 = (() => {
  let 绿 = 0, 红 = 0;
  return {
    ok(名, 真, 读) { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } },
    尾巴() { console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红'); return 红; }
  };
})();

const 围栏 = '```ggb\n数轴\nA=(-2,0)\nB=(3,0)\n文本("-2", A+(0,-0.6))\n文本("3", B+(0,-0.6))\n```';
const 答 = '画好了。数轴上有两个点，分别是 -2 和 3。\n\n' + 围栏;

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) return { 炸: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };

  console.log('★ 挡掉 geogebra.org（模拟"板子起不来"）');
  await send('Network.enable', null);
  await send('Network.setBlockedURLs', { urls: ['*geogebra.org*'] });
  await send('Page.enable', null);
  await send('Page.navigate', { url: 'http://127.0.0.1:8138/index.html' });
  for (let i = 0; i < 60; i++) { if (await ev("!!(window.SR&&SR.chat&&SR.board)")) break; await sleep(500); }
  await sleep(1500);

  const 开工前 = await ev("localStorage.getItem('mathroot_memo')");
  await ev("SR.memo.clear();'ok'");
  await ev("SR.memo.pushTurn('a'," + JSON.stringify(答) + ",'draw'); SR.memo.flush(); 'ok'");
  // 重来一趟，让顶上的 repaintLog 把这条摆出来（摆出来的占位是**可点**那一档）
  await send('Page.navigate', { url: 'http://127.0.0.1:8138/index.html' });
  for (let i = 0; i < 60; i++) { if (await ev("!!(window.SR&&SR.chat&&SR.board)")) break; await sleep(500); }
  await sleep(2500);

  console.log('\n── ① 板子起来了没有 ──');
  const 就绪 = await ev("!!(SR.board.isReady&&SR.board.isReady())");
  帆.ok('★对照：geogebra.org 被挡掉之后，画板**确实**没起来（不然下面量的是另一回事）', 就绪 === false, '就绪=' + 就绪);
  const 板话 = await ev("(function(){var n=document.querySelector('.boardbar .note, .boardbox .note, #status');return document.querySelector('.boardbox')?document.querySelector('.boardbox').textContent.slice(0,60):null;})()");
  console.log('    画板那一刻说的话：' + JSON.stringify(板话));

  console.log('\n── ② 那颗「图」在不在、点了会怎样 ──');
  const 占位 = await ev("(function(){var b=document.querySelector('.figbox');if(!b)return null;var p=b.querySelector('.figph');return p?{文:p.textContent,类:p.className,可点:!!p.onclick||p.getAttribute('title')}:{文:null,有图:!!b.querySelector('.figimg')};})()");
  帆.ok('刷新之后那一格是可点的「图」（不是"正在出图"）——这是设计，不是坏的', !!(占位 && 占位.文 === '图'), JSON.stringify(占位));

  const t0 = Date.now();
  await ev("(function(){var p=document.querySelector('.figbox .figph');if(p)p.click();return 'ok';})()");
  let 到 = null, 轨迹 = [];
  while (Date.now() - t0 < 120000) {
    await sleep(400);
    const s = await ev("(function(){var p=document.querySelector('.figbox .figph');var i=document.querySelector('.figbox .figimg');return JSON.stringify({占位:p?p.textContent:null,有图:!!i});})()");
    const o = JSON.parse(s);
    if (!轨迹.length || 轨迹[轨迹.length - 1].占位 !== o.占位) 轨迹.push({ 秒: ((Date.now() - t0) / 1000).toFixed(1), 占位: o.占位, 有图: o.有图 });
    if (o.有图 || o.占位 === '图没画出来') { 到 = Date.now() - t0; break; }
  }
  console.log('    点了之后的轨迹：' + JSON.stringify(轨迹));
  console.log('\n── ③ 认输要多久、认输时说不说人话 ──');
  if (到 === null) {
    帆.ok('★ 板子起不来时，出图这条路**必须**认输（不能一直转）', false, '等了 120 秒还没认输：它一直停在「' + (轨迹.length ? 轨迹[轨迹.length - 1].占位 : '?') + '」');
  } else {
    console.log('    从点下去到认输：' + (到 / 1000).toFixed(1) + ' 秒');
    帆.ok('★ 板子起不来时，出图这条路**必须**认输（不能一直转）', true, (到 / 1000).toFixed(1) + 's');
    // ★ 这一条是这一把尺子的正题：一分钟的等待，加上一句不解释的话，等于"坏了"。
    帆.ok('★★ 认输要快（≤10 秒）——板子没起来这件事，第 0 秒就知道，不该让老师等一分钟', 到 <= 10000, (到 / 1000).toFixed(1) + 's');
    const 末话 = await ev("(function(){var p=document.querySelector('.figbox .figph');return p?{文:p.textContent,title:p.getAttribute('title')}:(document.querySelector('.figbox .figimg')?'有图':null);})()");
    帆.ok('★★ 认输那句话要说出**为什么**（不能只有"图没画出来"四个字，板子没起来和命令画不出，是两回事）',
      !!(末话 && 末话.title && /画板|没起来|加载|网络/.test(末话.title)), JSON.stringify(末话));
  }

  // 收工：把开工前那份原样写回
  if (开工前 === null) await ev("SR.memo.clear();'ok'");
  else await ev("(function(){try{localStorage.setItem('mathroot_memo'," + JSON.stringify(开工前) + ");}catch(e){}return 'ok';})()");
  await send('Network.setBlockedURLs', { urls: [] });
  await new Promise(r2 => http.get({ host: 'localhost', port: 9222, path: '/json/close/' + t.id }, x => { x.resume(); x.on('end', r2); }).on('error', r2));
  process.exit(帆.尾巴() ? 1 : 0);
})();
