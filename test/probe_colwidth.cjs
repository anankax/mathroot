// probe_colwidth —— 「切工位的时候，对话栏会不会跳」。
//
// 孔老师 2026-10-04 原话：「不同的板块不是用的一个屏，大小也不一样。切换的根本不自然。」
// 那之前 css 是按工位分三档的（备课/作图/命题 900、讲评 1000、组卷/学情 1120），
// 切一次工位，栏宽一变 → 整栏重新居中 → 左右两条边线一起往里/往外跳，读着的字当场重排。
// 现在六档并成一档 1000，这把尺子就是**钉住那件事**。
//
// 量什么：六个工位逐个切过去，读 `main > .col` 的**左边线**和**宽度**。
//   ① 六个工位宽度必须一样（"大小也不一样"就是这条）；
//   ② 六个工位左边线必须一样（★ 真正的罪魁是这条——宽度换了、居中跟着变，边线就跳，
//      老师眼睛盯的是左边那条线，它一动就像"换了一屏"）；
//   ③ 该是 1000 就是 1000（窗口够宽时）。
// 外加红验：临时给某一个工位塞一条 820 的规则，上面①②必须当场变假——
//   否则它们量的可能是"屏幕上恰好有条栏"，而不是"这条栏没跳"。
//
// 用法：node test/probe_colwidth.cjs
//   （需要 test/serve.cjs 8138 在跑、探针 Chrome 9222 在跑）
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) return { 炸: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };

  await send('Page.enable', null);
  await send('Page.navigate', { url: 'http://127.0.0.1:8138/index.html' });
  for (let i = 0; i < 60; i++) { if (await ev("!!(window.SR&&SR.WORK_ORDER&&document.querySelectorAll('.workbtn').length>=6)")) break; await sleep(500); }
  await sleep(1200);

  // 工位按钮点了会写 localStorage（SR.LS_WORK），收工要原样写回
  const 开工前 = await ev("JSON.stringify({memo:localStorage.getItem('mathroot_memo'),work:localStorage.getItem(SR.LS_WORK)})");
  const 存档 = JSON.parse(开工前);
  const KEY = await ev("SR.LS_WORK");

  // 量一条栏：左边线、宽度、右边线、算出来的 max-width
  const 量栏 = "JSON.stringify((function(){var c=document.querySelector('main > .col');if(!c)return null;var r=c.getBoundingClientRect();"
    + "return {左:Math.round(r.left),宽:Math.round(r.width),右:Math.round(r.left+r.width),"
    + "封顶:getComputedStyle(c).maxWidth,视口:window.innerWidth};})())";

  console.log('\n── ① 六个工位逐个切，看那条栏动不动 ──');
  console.log('    视口宽 = ' + await ev("window.innerWidth") + 'px');
  const 读数 = [];
  for (const w of ['prep', 'draw', 'vary', 'material', 'grade', 'review']) {
    const 点 = await ev("(function(){var b=document.querySelector('.workbtn[data-work=\"" + w + "\"]');if(!b)return '没这颗';b.click();return 'ok';})()");
    if (点 !== 'ok') { console.log('    ⚠ 工位 ' + w + ' 的按钮没找到：' + 点); continue; }
    await sleep(500);                       // 等布局落定
    const o = JSON.parse(await ev(量栏));
    读数.push({ 工位: w, ...o });
    console.log('    ' + w.padEnd(9) + ' 左=' + String(o.左).padStart(5) + '  宽=' + String(o.宽).padStart(5) + '  右=' + String(o.右).padStart(5) + '  封顶=' + o.封顶);
  }

  const 宽集 = 读数.map(x => x.宽), 左集 = 读数.map(x => x.左);
  const 同宽 = 宽集.every(x => x === 宽集[0]);
  const 同左 = 左集.every(x => x === 左集[0]);
  const 极差宽 = Math.max(...宽集) - Math.min(...宽集);
  const 极差左 = Math.max(...左集) - Math.min(...左集);
  判('★ 六个工位**宽度一样**（"大小也不一样"就是这条）', 同宽, '极差 ' + 极差宽 + 'px   [' + 宽集.join(', ') + ']');
  判('★★ 六个工位**左边线一样**（宽度换→重新居中→边线跳，这才是"切换不自然"的正身）', 同左, '极差 ' + 极差左 + 'px   [' + 左集.join(', ') + ']');
  判('该封在 1000', 读数.every(x => x.封顶 === '1000px'), '封顶=' + 读数.map(x => x.封顶).join(' / '));

  console.log('\n── ② 红验：临时给「学情」塞一条 820 的窄栏，①②必须当场变假 ──');
  // 量的是"这条尺子分不分得出栏宽变了"：分不出，上面那两条绿就是白给的。
  await ev("(function(){var s=document.createElement('style');s.id='__红验';"
    + "s.textContent='body[data-work=\"grade\"] main > .col{max-width:820px !important}';"
    + "document.head.appendChild(s);return 'ok';})()");
  await ev("(function(){document.querySelector('.workbtn[data-work=\"grade\"]').click();return 'ok';})()");
  await sleep(500);
  const 红读 = JSON.parse(await ev(量栏));
  console.log('    学情（塞了 820 之后）左=' + 红读.左 + '  宽=' + 红读.宽 + '  封顶=' + 红读.封顶);
  判('★红验：同一把尺子，塞一条窄栏必须**读得出**宽了/左了（读不出，①那两条绿是白给的）',
    (红读.宽 !== 宽集[0]) && (红读.左 !== 左集[0]), '宽 ' + 宽集[0] + ' → ' + 红读.宽 + '，左 ' + 左集[0] + ' → ' + 红读.左);
  await ev("(function(){var s=document.getElementById('__红验');if(s)s.remove();return 'ok';})()");

  // 收工：把开工前那份原样写回（工位按钮刚把 SR.LS_WORK 写成了 grade）
  await ev("(function(){try{var d=" + JSON.stringify(存档) + ";"
    + "if(d.memo===null)localStorage.removeItem('mathroot_memo');else localStorage.setItem('mathroot_memo',d.memo);"
    + "if(d.work===null)localStorage.removeItem(" + JSON.stringify(KEY) + ");else localStorage.setItem(" + JSON.stringify(KEY) + ",d.work);"
    + "}catch(e){}return 'ok';})()");
  await new Promise(r2 => http.get({ host: 'localhost', port: 9222, path: '/json/close/' + t.id }, x => { x.resume(); x.on('end', r2); }).on('error', r2));
  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  process.exit(红 ? 1 : 0);
})();
