// 尺子：孔老师第三条——「插入模板或者出现 ggb 的内容，由智能体发出以后**跟在对话框下面**，
//   就和微信聊天那样，然后可以上滑下滑」。
//
// 这条要量的是**位置**，不是"有没有图"。所以判据是父链和抽屉，不是计数：
//   ① 真图（img.figimg）落在 `#msgs` 的**某条气泡里面**（父链里有 .bubble）
//   ② 它**不在**抽屉里（`.drawer` 整棵子树里一张都不该有）
//   ③ 出图过程中/出图之后，抽屉**一直是收着的**（老师没点，它就不该自己弹出来）
//   ④ 「放大看」在图上，且**点它大窗才开** —— 这一格是**判别动作**：
//      不信"抽屉收着"是恒真读数，得亲手让它开一次，证明这把尺子读得出"开"
//      （老账：判别动作要挑会变的那个量；恒绿的断言等于没量）
//      ★ 2026-10-05：按钮原名「再摆弄」、干的是"拉开抽屉"；2026-10-04 改名「放大看」、
//        改成"中央蹦一个大窗"。这把尺子当时没跟着改 → ④a/④b **长期假红**。
//        已改成按类名 `.figagain` 找、按 `SR.main.bigFigOpen()` 判翻面。
//   ⑤ 红验：发问**之前**页面上真图数是 0（不然 ① 可能是拿上一场的残留冒充的）
//
// ★ 量抽屉开没开用 `getClientRects().length`，**不用** `getComputedStyle().display`：
//   抽屉是 `.drawer[data-drawer]` 那套，藏起来的可能是它的爹，孩子照样报 flex。
//   （老账：量"看得见吗"要量占位矩形。）
// ★ 用的是**真模型**（不是编的围栏）：这条要量的是"智能体发出以后"，
//   而"智能体发出以后"跟"我手写一段围栏"之间差着整整一层。
//
// 用法：node test/probe_figinline.cjs
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const 问 = '画一条数轴，在数轴上标出 -2、0、3 这三个点';

let 过 = 0, 败 = 0;
const 判 = (名, ok, 附) => { console.log('  ' + (ok ? '✓' : '✗') + ' ' + 名 + (附 ? '　' + 附 : '')); ok ? 过++ : 败++ };

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const q = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面炸了 ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 250));
    return R && R.result ? R.result.value : null };
  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 50; i++) { await sleep(700); if (await q('!!(window.SR&&SR.board&&SR.board.isReady())') === true) break }
  await send('Page.bringToFront', {});
  // 开工前的 localStorage：只动我自己那两个键，用完写回。
  const 存前 = await q("(function(){var o={};['mathroot_memo','mathroot_work','mathroot_backend'].forEach(function(k){o[k]=localStorage.getItem(k)});return o})()");

  // ★★ 抽屉"藏没藏"要用**三件事合起来**判，少一件就会读错（这一版就是这么栽的）：
  //   `getClientRects().length` 只抓得住 `display:none`。
  //   而抽屉的藏法是 `transform: translateX(calc(100% + 24px))` ＋ `visibility:hidden`
  //   （见 css/main.css 的 `.drawer`）—— **这两种它都抓不住**：
  //   被推出屏外的元素照样生成盒子，矩形数照样是 1、宽照样 520。
  //   实测：`data-drawer` 从 closed 翻成 open，`占位`／`可视宽` **一个数都没动**；
  //   于是"点一下抽屉就开了"那条断言看着是绿的，实际量的是一个恒定的量 —— **假红验**。
  //   现在改成"在不在视口里"：display 不是 none ＋ visibility 不是 hidden ＋ 宽>0 ＋ 左沿落在视口内。
  //   这一条会真的跟着开/关翻面（④b 那格拿它当判别动作，它就必须翻）。
  const 抽屉 = `(function(){var d=document.getElementById('drawer');if(!d)return {在:false};
    var r=d.getBoundingClientRect(),c=getComputedStyle(d);
    var 看得见=(c.display!=='none')&&(c.visibility!=='hidden')&&(r.width>0)&&(r.left<innerWidth)&&(r.right>0);
    return {在:true, 数据态:d.getAttribute('data-drawer'), 看得见:看得见,
      视口:innerWidth, 左沿:Math.round(r.left), 右沿:Math.round(r.right),
      display:c.display, visibility:c.visibility, 矩形数:d.getClientRects().length,
      图在抽屉里:document.querySelectorAll('#drawer img.figimg').length}})()`;
  const 图 = `(function(){var a=document.querySelectorAll('#msgs img.figimg'),o=[];
    for(var i=0;i<a.length;i++){var e=a[i],链=[],p=e;
      while(p&&p!==document.body){链.push(p.className&&typeof p.className==='string'?p.className.split(' ')[0]:p.tagName);p=p.parentElement}
      var r=e.getBoundingClientRect();
      o.push({在气泡里:链.indexOf('bubble')>=0,链:链.slice(0,6).join('<'),宽:Math.round(r.width),高:Math.round(r.height),自然宽:e.naturalWidth})}
    return o})()`;
  // ★★ 2026-10-05 改：「再摆弄」这个按钮**已经不叫这个名了**。
  //   孔老师 2026-10-04 原话「也不应该叫"再摆弄"，这个说法太随意了」→ 改名「放大看」
  //   （见 js/chat.js 的 attachFigure 那段）。而且它干的事也从"拉开右边抽屉"
  //   改成了"中央蹦一个大窗"。
  //   这把尺子当时还在按老名字找按钮 → ④a/④b **长期假红**：读数是"图上没挂按钮"，
  //   而屏幕上那颗按钮一直都在。老账：**尺子递的选项名还是旧的，产品早改名了**——
  //   红的样子跟产品坏了长得一模一样，最容易骗过下一个人。
  //   现在改成：按类名 `.figagain` 找（类名是产品自己的钩子），
  //   判别动作也跟着换成量**大窗开没开**（`SR.main.bigFigOpen()`）。
  const 按钮 = `(function(){var b=document.querySelector('#msgs .bubble .figagain');
    if(!b) return {在:false};
    var r=b.getBoundingClientRect();
    return {在:true,字:(b.textContent||'').trim(),占位:b.getClientRects().length,宽:Math.round(r.width)}})()`;

  console.log('◆ 出图之前（**红验的底**）');
  判('⑤ 页面上真图数 = 0（没有上一场的残留冒充）', (await q('document.querySelectorAll("#msgs img.figimg").length')) === 0);
  const d0 = await q(抽屉);
  判('③a 说第一句话之前，抽屉是收着的', d0.看得见 === false, JSON.stringify(d0));

  await q("SR.landing && SR.landing.pick && SR.landing.pick('draw', true)");
  await sleep(400);
  console.log('◆ 问他：' + 问);
  await q('SR.chat.submit(' + JSON.stringify(问) + ')');

  let 到了 = false;
  for (let z = 0; z < 240; z++) { await sleep(500);
    if ((await q('!!document.querySelector("#msgs img.figimg")')) === true) { 到了 = true; break }
    const 忙 = await q('!!(SR.board.isBusy&&SR.board.isBusy())');
    if (z > 20 && 忙 === false && (await q('!!document.querySelector("#msgs .figph.pending")')) === false && z > 40) { /* 可能它压根没写围栏，继续等一会儿 */ }
  }
  console.log('  （等了 ' + (到了 ? '到图出现' : '满 120 秒也没等到图') + '）');
  判('① 真图出现了，而且**在气泡里面**（父链含 .bubble）', 到了 && (await q(图)).every(x => x.在气泡里), JSON.stringify(await q(图)));
  const d1 = await q(抽屉);
  判('② 真图不在抽屉里', d1.图在抽屉里 === 0);
  判('③b 出图这整段时间，抽屉一直没自己弹开', d1.看得见 === false, JSON.stringify(d1));
  const ag = await q(按钮);
  判('④a 图上挂着「放大看」（有字、有占位）', ag.在 === true && ag.占位 > 0 && ag.字 === '放大看', JSON.stringify(ag));
  // ★★ 判别动作：亲手点它，**大窗必须从"关着"翻成"开着"**。
  //   不点这一下，上面 ③a/③b 那两条"抽屉收着"就可能是恒真读数（老账：红验要挑会变的那个量）。
  const 开前 = await q('SR.main.bigFigOpen()');
  await q(`(function(){var b=document.querySelector('#msgs .bubble .figagain');
    if(!b) return 0; b.scrollIntoView({block:'center'}); b.click(); return 1})()`);
  await sleep(1200);
  const 开后 = await q('SR.main.bigFigOpen()');
  判('④b 点了「放大看」之后大窗**真的开了**（判别动作：这个量必须翻面）',
    开前 === false && 开后 === true, { 点前: 开前, 点后: 开后 });

  // 收拾：收回大窗、关掉抽屉，把三个键写回原样
  await q("SR.main && SR.main.closeBigFig && SR.main.closeBigFig()");
  await sleep(400);
  await q("SR.board && SR.board.hideDrawer && SR.board.hideDrawer()");
  await sleep(300);
  await q('(function(){var s=' + JSON.stringify(存前) + ';Object.keys(s).forEach(function(k){if(s[k]===null)localStorage.removeItem(k);else localStorage.setItem(k,s[k])});return 1})()');
  console.log('  （开工前那份 localStorage 已原样写回：' + (存前.mathroot_memo || '').length + ' 字节）');
  console.log('\n结果：' + 过 + ' 通过, ' + 败 + ' 失败');
  ws.close(); await put('/json/close/' + t.id);
  process.exit(败 ? 1 : 0);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2) });
