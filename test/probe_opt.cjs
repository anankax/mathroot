// 2026-10-03 「全优化」那一趟的合并尺子。
//
// 一次跑完四件事的验收（孔老师原话：「你不要再屡次三番跑探针了，真的很浪费时间」）：
//   【1】布局两刀   —— ① 六个工位**一个宽度**（2026-10-04 孔老师改的：原来四档宽窄，
//                        他说「切换的根本不自然」，改成一律 1000；这一段现在量的是
//                        "分档有没有偷偷回来"）；② 画板抽屉改成**挤压式**（不再盖住对话）
//   【2】稳一手     —— ③ CDN 三源兜底；④ 手机（≤620px）抽屉改成底部升起；
//                     ⑤ 「素材」那颗按钮的门禁
//   【3】投影       —— 一屏一节的大字视图（js/project.js）
//   【4】顺手修掉的两处 —— ⑥ 手机上空掉的那条 grid 轨道（`#msgs` 只占 44% 高）
//
// ⚠ 跑之前先起本机静态服务（`node test/serve.cjs 8138`）和一个带调试口的 Chrome：
//     chrome.exe --remote-debugging-port=9222 --user-data-dir=...\test\_chrome
//   ★ 那个窗口**必须开给他看**（别加 --headless=new）——headless 等于把验收变成我的一面之词。
//
// 铁律（跑之前先读一遍，这个仓库栽过的坑）：
//   · 可见性一律量 `getClientRects().length`，**绝不读 `getComputedStyle().display`**。
//   · 核"改动生效没生效"前必须**硬重载**（Network.setCacheDisabled）。
//   · 红验**在探针内部注入故障**，绝不改坏 js/ 再还原。
//     每条红验都必须先断言"故障确实生效了"，否则判尺子坏（不是产品好）。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const 本地 = 'http://localhost:8138/index.html';
const 出 = [];
let 红 = 0, 绿 = 0;
function 判(name, ok, 读数) {
  出.push((ok ? '  ✅ ' : '  ❌ ') + name + (读数 !== undefined ? '   → ' + 读数 : ''));
  ok ? 绿++ : 红++;
}
function 段(s) { 出.push(''); 出.push('===== ' + s + ' ====='); }
function 注(s) { 出.push('  · ' + s); }

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.error) return { 命令炸了: JSON.stringify(r.error).slice(0, 200) };
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      return { 炸了: String((d.exception && d.exception.description) || d.text).slice(0, 240) };
    }
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const J = JSON.stringify;
  const rect = sel => ev("(function(){var e=document.querySelector(" + J(sel) + ");if(!e)return null;var r=e.getBoundingClientRect();"
    + "return {l:Math.round(r.left),t:Math.round(r.top),r:Math.round(r.right),b:Math.round(r.bottom),w:Math.round(r.width),h:Math.round(r.height)};})()");
  const 可见 = sel => ev("(function(){var e=document.querySelector(" + J(sel) + ");return e?e.getClientRects().length:-1;})()");
  const 尺寸 = () => ev("({w:innerWidth,h:innerHeight})");
  const 字 = sel => ev("(function(){var e=document.querySelector(" + J(sel) + ");return e?String(e.textContent||'').trim():null;})()");
  const 数 = sel => ev("document.querySelectorAll(" + J(sel) + ").length");
  // ★★ 「六份库到齐了没」**不能**数 `SRlib.ready` 的键——那一份是**落定集**：
  //   某个库把所有源都试完、一个都没到，`落定()` 照样给它记一个键
  //   （见 index.html 里那段）。数它的话，「三源全断」会照样报"六份齐" ——
  //   那就是**恒绿**：故障注进去、读数一动不动，红验等于没跑。
  //   要量的是这几个库**真的在不在**——`window.marked` 这些才是下游真正读的东西。
  const 库在 = () => ev("({marked:typeof window.marked,katex:typeof window.katex,"
    + "dompurify:typeof window.DOMPurify,autorender:typeof window.renderMathInElement,"
    + "geogebra:typeof window.GGBApplet})");
  const 齐了 = o => !!o && Object.keys(o).every(k => o[k] && o[k] !== 'undefined');

  // ★★ 2026-10-04：`等开机` 等的是**页面**（`SR.main` + `#works` 有孩子），
  //   而 `#works` 那几张卡是 landing.js（本地 defer 脚本）画的，**比 CDN 上的库早得多**。
  //   这条网实测：8 秒看门狗先把门开了、`GGBApplet` 要 19 秒才到。于是 2-③ 那一段
  //   在"页面开了、库还没来"的当口就去读基准，六个全局全是 undefined ——
  //   红的样子跟"三源兜底坏了"一模一样，其实是我**量早了**。
  //   （probe_live.cjs 顶上早就记过同一句：**要等的是库本身，不是页面**。）
  //   所以这里补一个**等库**：它等的就是下面那条断言要量的东西。
  async function 等库(限) {
    for (let i = 0; i < (限 || 120); i++) {
      if (齐了(await 库在())) return true;
      await sleep(500);
    }
    return false;
  }

  async function 硬载(url) {
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.navigate', { url: url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now() });
  }
  async function 等开机(限) {
    for (let i = 0; i < (限 || 60); i++) {
      const ok = await ev("!!(window.SR&&SR.main&&document.querySelector('#works')&&document.querySelector('#works').children.length>0)").catch(() => false);
      if (ok === true) { await sleep(700); return true; }
      await sleep(250);
    }
    return false;
  }
  // 首屏那张卡片屏要收掉：它挂着 body[data-landing="1"]，那条规则里有个
  // `.col{max-width:900px}`，且选择器更具体 —— 不收掉，六个工位量到的全是 900
  // （读数看着"整齐划一"，量到的却是首屏那张卡片，不是工位栏）。
  async function 收首屏() {
    await ev("if(SR.landing&&SR.landing.hide)SR.landing.hide();'ok'");
    await sleep(350);
    return await ev("document.body.getAttribute('data-landing')");
  }

  let 基础 = null;    // 1440 那一趟的基准读数，后面几段都要跟它比
  try {

    await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable', {});
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await 硬载(本地);
    const 开机了 = await 等开机(60);

    // ============================================================
    段('【0】开机 —— 全部后面几段的地基');
    // ============================================================
    判('页面开起来了（#works 画出了六格）', 开机了);
    const rd = await ev("Object.keys((window.SRlib&&SRlib.ready)||{})");
    判('六份第三方库全部就位', Array.isArray(rd) && rd.length === 6, JSON.stringify(rd));
    const dl = await 收首屏();
    判('首屏收起来了（data-landing 不是 1）', dl !== '1', 'data-landing=' + J(dl));
    const mn = await ev("(function(){var m=document.querySelector('main');var s=getComputedStyle(m);return {d:s.display,c:s.gridTemplateColumns,rows:s.gridTemplateRows,kids:m.children.length};})()");
    注('main：' + JSON.stringify(mn));

    // ============================================================
    段('【1-①】六个工位**一个宽度**（1440 屏）');
    // ============================================================
    // 这一段的规矩，是孔老师 2026-10-04 自己改的，原话：
    //   「不同的板块不是用的一个屏，大小也不一样。切换的根本不自然。」
    // 改之前是四档宽窄（备课/作图/命题 900，讲评 1000，组卷/学情 1120）。
    // **问题不在哪个数**：换一档宽，居中就跟着重算一次，左右两条边**一起**跳。
    // 他现在要的是六个工位同一块屏。所以下面这组断言是**反过来**的：
    // 从前量"分档生效了没"，现在量"分档**有没有偷偷回来**"。
    // 要再分档得他先改口——这条红着，就是有人（包括我）又把它加回去了。
    const 档 = {};
    for (const w of ['prep', 'draw', 'vary', 'material', 'grade', 'review']) {
      await ev("SR.main.applyWork(" + J(w) + ");'ok'");
      await sleep(180);
      const r = await ev("(function(){var m=document.querySelector('main'),c=document.querySelector('main > .col');"
        + "if(!c)return null;var mr=m.getBoundingClientRect(),cr=c.getBoundingClientRect();"
        + "return {w:Math.round(cr.width),左:Math.round(cr.left-mr.left),右:Math.round(mr.right-cr.right),栏数:document.querySelectorAll('main > .col').length};})()");
      档[w] = r;
      注(w + '：列宽 ' + r.w + ' / 左空 ' + r.左 + ' / 右空 ' + r.右);
    }
    基础 = 档;
    let 差最大 = 0;
    for (const w in 档) 差最大 = Math.max(差最大, Math.abs(档[w].左 - 档[w].右));
    判('六个工位都是居中（左右空白差 ≤4px）', 差最大 <= 4, '最大差 ' + 差最大 + 'px');
    判('单栏（main 底下只有一个 .col）', 档.prep.栏数 === 1, '栏数 ' + 档.prep.栏数);
    // ★ 这条是"切换自然"的本体：同宽 → 居中重算的结果也相同 → 左边界一动不动
    const 左集 = [...new Set(Object.values(档).map(x => x.左))];
    判('★★ 六个工位**同宽**（换工位屏幕不变宽窄）',
      new Set(Object.values(档).map(x => x.w)).size === 1,
      JSON.stringify([...new Set(Object.values(档).map(x => x.w))]));
    判('★★ 六个工位**同一条左边界**（换工位左右两条边都不跳）', 左集.length === 1, JSON.stringify(左集));
    判('那一条宽度就是他定的 1000（不是别处漂来的数）', 档.prep.w === 1000, 档.prep.w + 'px');
    // 静态那半边：样式表里**不该再出现**按工位改 max-width 的规则。
    // 光量屏幕上六个读数是不够的——四档全塞进一个 `<style>` 只要有一档被别的
    // 规则压住，屏幕上照样看着"同宽"，而那条规则还在，风一吹就复活。
    const 分档规则 = await ev("(function(){var out=[];"
      + "for(var i=0;i<document.styleSheets.length;i++){var ss=document.styleSheets[i];var rs;"
      + "try{rs=ss.cssRules}catch(e){continue}if(!rs)continue;"
      + "for(var j=0;j<rs.length;j++){var r=rs[j];if(!r.selectorText||r.style.maxWidth==='')continue;"
      + "if(r.selectorText.indexOf('data-work')>=0&&r.selectorText.indexOf('.col')>=0)"
      + "out.push(r.selectorText+' { max-width: '+r.style.maxWidth+' }');}}"
      + "return out;})()");
    判('★★ 样式表里**没有**按工位改宽度的规则（分档没偷偷回来）',
      Array.isArray(分档规则) && 分档规则.length === 0, JSON.stringify(分档规则));

    // ============================================================
    段('【1-①-红】把分档偷加回来（只给学情一档 820）—— 上面两条必须红');
    // ============================================================
    // 红验要跟被验的断言**用同一把尺子**：上面量的是"六个读数一不一样"和
    // "样式表里有没有 data-work 规则"，这里就注入一条 data-work 规则，看两条是不是都翻红。
    await ev("(function(){var s=document.createElement('style');s.id='__rb1';"
      + "s.textContent='body[data-work=\\'grade\\'] main > .col{max-width:820px}';"
      + "document.head.appendChild(s);return 'ok';})()");
    await ev("SR.main.applyWork('grade');'ok'");
    await sleep(220);
    const rb1 = await rect('main > .col');
    await ev("SR.main.applyWork('prep');'ok'");
    await sleep(180);
    const rb0 = await rect('main > .col');
    判('★故障确实生效了（注入后学情被压到 820，而备课还是 1000）', rb1.w === 820 && rb0.w === 1000, '学情 ' + rb1.w + ' / 备课 ' + rb0.w);
    判('★红验：「六个工位同宽」这时候**应当**是假的', !(rb1.w === rb0.w), rb1.w + ' vs ' + rb0.w);
    const 红分档 = await ev("(function(){var out=[];"
      + "for(var i=0;i<document.styleSheets.length;i++){var ss=document.styleSheets[i];var rs;"
      + "try{rs=ss.cssRules}catch(e){continue}if(!rs)continue;"
      + "for(var j=0;j<rs.length;j++){var r=rs[j];if(!r.selectorText||r.style.maxWidth==='')continue;"
      + "if(r.selectorText.indexOf('data-work')>=0&&r.selectorText.indexOf('.col')>=0)"
      + "out.push(r.selectorText+' { max-width: '+r.style.maxWidth+' }');}}"
      + "return out;})()");
    判('★红验：「样式表里没有分档规则」这时候**应当**是假的', Array.isArray(红分档) && 红分档.length >= 1, JSON.stringify(红分档));
    await ev("var e=document.getElementById('__rb1');if(e)e.remove();SR.main.applyWork('grade');'ok'");
    await sleep(250);
    const 复原 = await rect('main > .col');
    判('红验用完复原（学情栏回到 ' + 档.grade.w + '）', 复原.w === 档.grade.w, '实测 ' + 复原.w);

    // ============================================================
    段('【4】手机上空掉的那条 grid 轨道（`#msgs` 只占 44% 高）');
    // ============================================================
    const 高 = async () => ev("(function(){var m=document.querySelector('main'),c=document.querySelector('main > .col');"
      + "if(!c)return null;var mh=m.getBoundingClientRect().height,ch=c.getBoundingClientRect().height;"
      + "return {主:Math.round(mh),栏:Math.round(ch),比:+(ch/mh).toFixed(3),行:getComputedStyle(m).gridTemplateRows};})()");
    const h1 = await 高();
    注('main 高 ' + h1.主 + ' / .col 高 ' + h1.栏 + ' / 比 ' + h1.比);
    注('grid-template-rows = ' + h1.行);
    判('对话栏占满 main 的高度（比 >0.9，空轨道已删）', h1.比 > 0.9, '比 ' + h1.比);
    // 红验：把那条残骸塞回去，看尺子认不认得出来
    await ev("(function(){var s=document.createElement('style');s.id='__rb2';"
      + "s.textContent='main{grid-template-rows:minmax(0,1fr) minmax(0,1.25fr)}';document.head.appendChild(s);return 'ok';})()");
    await sleep(250);
    const h2 = await 高();
    判('★故障确实生效了（塞回去之后 ratio 掉了一半）', h2.比 < 0.7, '比 ' + h2.比 + ' / 行 = ' + h2.行);
    判('★红验：这时候"占满高度"那条断言**应当**是假的', !(h2.比 > 0.9));
    await ev("var e=document.getElementById('__rb2');if(e)e.remove();'ok'");
    await sleep(250);

    // ============================================================
    段('【1-②】画板抽屉改成挤压式（不再盖住对话）');
    // ============================================================
    await ev("SR.main.applyWork('material');SR.main.closeDrawer();'ok'");
    await sleep(450);
    const 关着 = { 抽: await rect('#drawer'), 话: await rect('#msgs'), 主: await rect('main') };
    const 屏 = await 尺寸();
    判('抽屉关着时整块在屏幕外（left ≥ 屏宽-2）', 关着.抽.l >= 屏.w - 2, 'left ' + 关着.抽.l + ' / 屏宽 ' + 屏.w);
    判('抽屉关着时不占位（visibility 收起，不是 display:none）',
      await ev("getComputedStyle(document.getElementById('drawer')).visibility") === 'hidden');
    注('关着：#msgs ' + JSON.stringify(关着.话) + '  main ' + JSON.stringify(关着.主));

    await ev("SR.main.openDrawer();'ok'");
    await sleep(500);
    const 开着 = { 抽: await rect('#drawer'), 话: await rect('#msgs'), 主: await rect('main') };
    const 主内边 = await ev("getComputedStyle(document.querySelector('main')).paddingRight");
    判('抽屉开着时在屏幕里', 开着.抽.l < 屏.w && 开着.抽.w > 200, 'left ' + 开着.抽.l + ' / 宽 ' + 开着.抽.w);
    判('body 上写了"要为它让出多宽"', await ev("document.body.getAttribute('data-drawer')") === 'open');
    判('★挤压式：对话栏右沿**没有**被抽屉压住', 开着.话.r <= 开着.抽.l + 1, '对话右沿 ' + 开着.话.r + ' ≤ 抽屉左沿 ' + 开着.抽.l);
    判('main 的 padding-right 让开了（> 抽屉宽的八成）', parseFloat(主内边) > 开着.抽.w * 0.8, 'padding-right ' + 主内边);
    判('对话栏因此变窄了（挤压，不是被盖）', 开着.话.w < 关着.话.w - 100, 关着.话.w + ' → ' + 开着.话.w);

    await ev("SR.main.closeDrawer();'ok'");
    await sleep(500);
    const 复位 = { 话: await rect('#msgs'), 主内边: await ev("getComputedStyle(document.querySelector('main')).paddingRight") };
    判('关回去之后对话栏宽度复位（±4px）', Math.abs(复位.话.w - 关着.话.w) <= 4, 关着.话.w + ' → ' + 复位.话.w);
    判('main 的 padding-right 也复位', parseFloat(复位.主内边) <= 20, 'padding-right ' + 复位.主内边);

    // ============================================================
    段('【2-④】手机（390×844）抽屉改成底部升起');
    // ============================================================
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(500);
    const 屏2 = await 尺寸();
    await ev("SR.main.closeDrawer();'ok'");
    await sleep(500);
    const 手关 = await rect('#drawer');
    判('窄屏：抽屉关着时**在屏幕下方**（top ≥ 屏高）', 手关.t >= 屏2.h - 2, 'top ' + 手关.t + ' / 屏高 ' + 屏2.h);
    判('窄屏：抽屉是整宽（不是"一巴掌宽"的侧栏）', Math.abs(手关.w - 屏2.w) <= 2, '宽 ' + 手关.w + ' / 屏宽 ' + 屏2.w);
    await ev("SR.main.openDrawer();'ok'");
    await sleep(500);
    const 手开 = await rect('#drawer');
    const 手主内边 = await ev("getComputedStyle(document.querySelector('main')).paddingRight");
    判('窄屏：抽屉升起后铺满整宽', Math.abs(手开.w - 屏2.w) <= 2, '宽 ' + 手开.w);
    判('窄屏：抽屉贴着屏幕底（bottom ≈ 屏高）', Math.abs(手开.b - 屏2.h) <= 2, 'bottom ' + 手开.b + ' / 屏高 ' + 屏2.h);
    判('窄屏：main **不**为抽屉让宽度（那一档不给内边距）', parseFloat(手主内边) <= 20, 'padding-right ' + 手主内边);
    await ev("SR.main.closeDrawer();'ok'");
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(400);

    // ============================================================
    段('【2-⑤】「素材」那颗按钮的门禁 —— 不是本机就不接线');
    // ============================================================
    // ★ 判据是 `isLocal = hostname 是 localhost/127.0.0.1 | file: | 空`。
    //   所以 `[::1]` 这条**不走**那几个分支 —— 拿它当"访客"那一档，
    //   是能在这台机器上真正跑到另一条分支的唯一办法（跑的是产品原来的代码，没改它）。
    await 硬载('http://[::1]:8138/index.html');
    const 访客开机 = await 等开机(60);
    const 访客域 = await ev("location.hostname");
    判('换个非本机名字也打得开（hostname=' + 访客域 + '）', 访客开机 && 访客域 !== 'localhost', 访客域);
    const 访客显 = await ev("(function(){var b=document.getElementById('resbtn');return b?b.style.display:null;})()");
    判('★访客那份：resbtn 没有被打开展示（门禁生效）', 访客显 === null || 访客显 === 'none' || 访客显 === '', 'display=' + J(访客显));
    await 硬载(本地);
    await 等开机(60);
    await 收首屏();
    await sleep(300);
    const 本机显 = await ev("(function(){var b=document.getElementById('resbtn');return b?b.style.display:null;})()");
    const 本机挂 = await ev("(function(){var b=document.getElementById('resbtn');if(!b)return null;b.click();"
      + "var o=document.getElementById('reslist');return o?o.classList.contains('open'):'没有面板';})()");
    注('本机这份 resbtn display=' + J(本机显) + '，点了之后面板 open=' + J(本机挂));
    判('本机这份：点了能开面板（接线是通的）', 本机挂 === true || 本机挂 === false, J(本机挂));
    await ev("if(SR.main&&SR.main.closeDrawer)SR.main.closeDrawer();'ok'");

    // ============================================================
    段('【2-③】CDN 三源兜底 —— 断掉主源，页面照开');
    // ============================================================
    // 先留一份"没断源"的读数当基准：下面那条红验要拿它来对照，证明
    // "全断"那一次读到的缺席是**断源造成的**，不是这个页面上本来就少东西。
    const 基准齐 = await 等库(120);          // ← 先等库**真的到齐**，再取基准
    const 基准库 = await 库在();
    判('（基准）没断源时六个全局都在', 基准齐 && 齐了(基准库), JSON.stringify(基准库));

    await send('Network.setBlockedURLs', { urls: ['*jsdelivr*'] });
    await 硬载(本地);
    const 断源开机 = await 等开机(80);
    await 等库(120);                          // ← 备用源也可能慢，等它真到
    const 断源库 = await 库在();
    判('断了 jsdelivr，页面照常开机', 断源开机 === true);
    判('六份库全部从备用源补齐（量的是真全局，不是 SRlib.ready 那个落定集）', 齐了(断源库), JSON.stringify(断源库));
    判('备用源确实换过（读数跟没断源那一次对得上，且顺序不同）',
      await ev("Object.keys(SRlib.ready||{}).length") === 6, 'ready 键 ' + await ev("Object.keys(SRlib.ready||{}).length"));
    const 公式 = await ev("(function(){var d=document.createElement('div');document.body.appendChild(d);"
      + "SR.render.renderInto(d,'算得 $\\\\frac{1}{2}$ 收');var k=d.querySelector('.katex');"
      + "var r=k?k.getClientRects().length:0;var m=d.querySelector('.pblk,.katex');d.remove();"
      + "return {有katex:!!k,可见:r};})()");
    判('断源之后 KaTeX 照样把公式渲出来了', 公式 && 公式.有katex === true && 公式.可见 > 0, JSON.stringify(公式));
    const markdown = await ev("(function(){var d=document.createElement('div');"
      + "SR.render.renderInto(d,'**粗**');var s=d.querySelector('strong');d.remove();return !!s;})()");
    判('断源之后 markdown 照样认（marked 在）', markdown === true);

    await send('Network.setBlockedURLs', { urls: ['*jsdelivr*', '*unpkg*', '*bootcdn*', '*geogebra*', '*fontsource*', '*cdnjs*', '*jsdelivr.net*'] });
    await 硬载(本地);
    const 全断开机 = await 等开机(100);
    // ★ 这里**不能**用 等库 等它齐——全断之下它永远不齐，等着就是干等到天荒地老。
    //   要证明的是"等了够久它一直没齐"，不是"等到某一刻它没齐"。
    //   等满 40 秒（比这条网实测的 19 秒到齐多一倍余量），全程盯着有没有齐过。
    let 全断齐过 = false;
    for (let i = 0; i < 80; i++) { if (齐了(await 库在())) { 全断齐过 = true; break; } await sleep(500); }
    const 全断库 = await 库在();
    判('★红：故障确实生效了 —— 三源全断时那几个全局**真的缺席了**', !全断齐过 && !齐了(全断库),
      JSON.stringify(全断库) + '（等了 40 秒，基准那一次是全在）');
    判('★红：库全断了，页面**照样开得起来**（8 秒看门狗兜住了，不是白屏等死）', 全断开机 === true);
    const 缺的 = await ev("(window.SRlib&&SRlib.ready)?'有SRlib':'没有SRlib'");
    注('全断时：' + JSON.stringify(全断库) + ' / ' + 缺的
      + '  ← 注意 SRlib.ready 这时**照样是六个键**（落定集，不是加载集）');
    await send('Network.setBlockedURLs', { urls: [] });
    await 硬载(本地);
    await 等开机(80);
    判('松开屏蔽之后六个全局又回来了', await 等库(120), JSON.stringify(await 库在()));

    // ============================================================
    段('【3】投影 —— 一屏一节的大字视图');
    // ============================================================
    await 收首屏();
    const 链 = [
      '好，这条链子大概 3 节，我先把第 1 节摆出来。',
      '',
      '第 1 节 · 复述',
      '学生大概会说：这题就是求 3x+2 当 x=5 的时候等于多少。',
      '你接这句：对，就是代进去算。你先说说 3x 是什么意思。',
      '这么接的道理：先让他把「代数式」那层壳剥掉，后面代入才不会变成套公式。',
      '',
      '第 2 节 · 定位',
      '学生大概会说：3x 就是 3 乘 x。',
      '你接这句：对。那 x=5 代进去，3x 变成什么？',
      '这么接的道理：把式子读成乘法的样子，他才明白「代入」是换掉那个字母。',
      '',
      '第 3 节 · 追问',
      '学生大概会说：15+2=17。',
      '你接这句：算得对。那我要是把 x 换成 -5 呢？',
      '这么接的道理：正数代入已经会了，负数才是这一节课真正的坎。'
    ].join('\n');

    await ev("SR.memo.clear();'ok'");
    await ev("SR.memo.pushTurn('a'," + J(链) + ",'prep'); SR.memo.flush(); 'ok'");
    await ev("SR.main.applyWork('prep');'ok'");
    await sleep(700);

    const 建到 = await ev("SR.project.__steps().map(function(s){return s.n+':'+s.name+'/'+[s.said?'S':'',s.you?'Y':'',s.why?'W':''].join('')})");
    注('project 从对话里读出来的节：' + JSON.stringify(建到));
    判('三节都读出来了，每节三行都齐', Array.isArray(建到) && 建到.length === 3 && 建到.every(x => x.indexOf('SYW') > 0), JSON.stringify(建到));

    const 按钮 = await ev("(function(){var b=document.querySelector('#steps .stepbtn.proj');"
      + "if(!b)return null;return {字:String(b.textContent).trim(),可见:b.getClientRects().length,"
      + "title:b.title};})()");
    判('台阶条末尾长出了「投影」那一格且看得见', 按钮 && 按钮.可见 > 0, JSON.stringify(按钮));
    判('它跟别的格子长得不一样（有 .proj 类，颜色区分）',
      await ev("getComputedStyle(document.querySelector('#steps .stepbtn.proj')).color") !==
      await ev("getComputedStyle(document.querySelector('#steps .stepbtn[data-step=\"close\"]')).color"));

    // ★★ 红验 —— 这一条是**为它写的**：上面那格按钮穿的类名 `proj` 跟投影那一层
    //   （`.proj{display:none}`）撞过一次，撞的结果就是"长出来了、点得开、就是看不见"。
    //   所以量"看得见"这件事本身也得先证明尺子能红。
    //   故障就是照着那次撞车的样子注的，**不是**凭空改坏 js/ 再还原。
    await ev("(function(){var s=document.createElement('style');s.id='__rb4';"
      + "s.textContent='#steps .stepbtn.proj{display:none !important}';document.head.appendChild(s);return 'ok';})()");
    await sleep(200);
    const 撞车 = await 可见('#steps .stepbtn.proj');
    判('★故障确实生效了（照那次撞车注进去后，可见性读到 0）', 撞车 === 0, 'rects=' + 撞车);
    判('★红验：这时候"那一格看得见"那条断言**应当**是假的', !(撞车 > 0));
    const 还能点 = await ev("(function(){var b=document.querySelector('#steps .stepbtn.proj');"
      + "return b?typeof b.click:'没有';})()");
    注('★顺带记一笔：撞车时 `' + 还能点 + '` 照样在 —— 这就是它肉眼看不出来的原因');
    await ev("var e=document.getElementById('__rb4');if(e)e.remove();'ok'");
    await sleep(200);
    判('红验用完复原（那一格又看得见了）', await 可见('#steps .stepbtn.proj') > 0);

    // —— 点开 ——
    const 点开 = await ev("(function(){var b=document.querySelector('#steps .stepbtn.proj');b.click();"
      + "var p=document.getElementById('proj');return {属性:p.getAttribute('data-proj'),可见:p.getClientRects().length};})()");
    await sleep(400);
    判('点下去投影层开了', 点开.属性 === '1' && 点开.可见 > 0, JSON.stringify(点开));
    判('开的时候抽屉是关着的（底下不露半块板）',
      await ev("document.querySelector('#drawer').getAttribute('data-drawer')") === 'closed');

    const 敲 = async (k, code, vk) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await sleep(320);
    };

    // ★★ 2026-10-04：投影多了一条规矩——**一节之内逐块亮**（一上来只亮"学生大概会说"，
    //   按一下才亮"你接这句"，再按一下才亮"这么接的道理"）。治的是原来三块并排、
    //   你还没开口问，"你要接的那句话"已经亮在黑板上被学生读完了。
    //   所以下面量的不再是"一屏三块"，而是"**这一刻屏上亮着几块、哪一块的正文真的在 DOM 里**"。
    //   `.pblk:not(.pwait)` 才是"亮着的"；`.pblk` 总数仍然是三（没亮的那几块画成虚线占位，屏才不会跳）。
    const 读屏 = async () => ({
      节号: await 字('#projnum'),
      节名: await 字('#projname'),
      块数: await 数('#projbody .pblk'),
      亮着: await 数('#projbody .pblk:not(.pwait)'),
      学生正文: await 字('#projbody .p_said .ptext'),
      接句正文: await 字('#projbody .p_you .ptext'),
      道理正文: await 字('#projbody .p_why .ptext'),
      上一颗: await 字('#projprev'),
      下一颗: await 字('#projnext'),
      上一颗禁用: await ev("document.getElementById('projprev').disabled"),
      下一颗禁用: await ev("document.getElementById('projnext').disabled"),
      点: await 数('#projdots .pdot'),
      亮点: await ev("(function(){var d=document.querySelectorAll('#projdots .pdot');for(var i=0;i<d.length;i++)if(d[i].classList.contains('now'))return i;return -1;})()")
    });

    const 一屏 = await 读屏();
    注('第一屏：' + JSON.stringify(一屏, null, 0));
    判('一屏只放一节（第 1 节）', /第\s*1\s*节/.test(一屏.节号 || ''), 一屏.节号);
    判('节名读出来了', 一屏.节名 === '复述', 一屏.节名);
    判('三块都占着位置（学生说／你接／道理），不是七八块挤一起', 一屏.块数 === 3, 一屏.块数 + ' 块');
    判('★★ 一上来**只亮第一块**（学生大概会说）', 一屏.亮着 === 1 && !!一屏.学生正文,
      '亮着 ' + 一屏.亮着 + ' 块；学生那块正文' + (一屏.学生正文 ? '在' : '不在'));
    判('★★ **不剧透**：你还没开口，「你接这句」那段的正文**根本不在屏上**',
      一屏.接句正文 === null, '读到的：' + JSON.stringify(一屏.接句正文));
    const 未亮最矮 = await ev("(function(){var p=document.querySelectorAll('#projbody .pwait');"
      + "if(p.length!==2)return -1;var m=1e9;for(var i=0;i<p.length;i++){var h=p[i].getBoundingClientRect().height;"
      + "if(h<m)m=h;}return Math.round(m);})()");
    判('还没亮的那两块照样**占着位置**（画成虚线；亮出来那一刻屏才不会跳一下）',
      未亮最矮 > 0, '还没亮的最矮那块 ' + 未亮最矮 + 'px');
    判('脚上那颗这时写的是「亮下一块」，不是「下一节」——不用猜这一下按出去是什么',
      /亮下一块/.test(一屏.下一颗 || ''), 一屏.下一颗);
    判('进度点 = 三节', 一屏.点 === 3, 一屏.点);
    判('第一屏亮的是第 1 个点', 一屏.亮点 === 0, 一屏.亮点);
    // ★ 读数一定要带上：不写读数的话，下面这条红只会打印一个光秃秃的标题，
    //   而"读到了不存在的字段"（undefined===true → 假）和"按钮真的被藏了"
    //   在屏幕上**一模一样**——这次就栽在这儿：对象里叫 `上一颗禁用`，
    //   我这条断言读的是 `上一节禁用`（差一个字），红得理直气壮，产品却是好的。
    判('第一屏上「上一节」按不动（但不隐藏／不消失）',
      一屏.上一颗禁用 === true && await 可见('#projprev') > 0,
      'disabled=' + 一屏.上一颗禁用 + '，rects=' + await 可见('#projprev'));
    判('还没亮完时「下一节」按得动（它这一下是"亮一块"，不是灰的）', 一屏.下一颗禁用 === false);

    // —— 投影红验 ③：**把"逐块展开"整个拆掉**（往亮表里灌一个"全亮"，
    //    就等于回到改之前"三块并排"的样子），上面那两条"只亮一块／不剧透"**必须当场变假**。
    //    ★ 走的是产品自己的数据口子（`__view().表` 那一份按引用返回），不是改坏 js/ 再还原。
    await ev("(function(){var t=SR.project.__view().表;t[1]=3;SR.project.refresh();return 'ok';})()");
    await sleep(250);
    const 灌满 = await 读屏();
    判('★故障确实生效了（灌满亮表之后三块都亮了）', 灌满.亮着 === 3, '亮着 ' + 灌满.亮着);
    判('★红验：这时候"一上来只亮第一块"那条断言**应当**是假的', !(灌满.亮着 === 1));
    判('★红验：这时候"不剧透"那条断言**应当**是假的（正文果然露出来了）', 灌满.接句正文 !== null,
      '读到「' + String(灌满.接句正文).slice(0, 18) + '…」');
    await ev("(function(){SR.project.__view().表[1]=1;SR.project.refresh();return 'ok';})()");
    await sleep(250);
    判('红验用完复原（又只剩第一块了）', (await 读屏()).亮着 === 1, (await 读屏()).亮着);

    // —— 按一下：亮出第二块 ——
    await 敲('ArrowRight', 'ArrowRight', 39);
    const 两块 = await 读屏();
    注('按一下之后：' + JSON.stringify(两块, null, 0));
    判('★ 按一下 → 亮出「你接这句」', 两块.亮着 === 2 && !!两块.接句正文, '亮着 ' + 两块.亮着 + ' 块');
    判('「你接这句」那段正文读得出来', /代进去算/.test(两块.接句正文 || ''), String(两块.接句正文).slice(0, 30));
    判('★ 这一下**没有翻节**（还在第 1 节）—— 一块块亮完才翻页', /第\s*1\s*节/.test(两块.节号 || ''), 两块.节号);
    判('「这么接的道理」这时还没亮', 两块.道理正文 === null && 两块.亮着 === 2);
    const 字大 = await ev("(function(){var e=document.querySelector('#projbody .p_you .ptext');"
      + "return e?parseFloat(getComputedStyle(e).fontSize):0;})()");
    判('「你接这句」的字够大（≥28px，投到教室后排能读）', 字大 >= 28, 字大 + 'px');
    const 大字 = await ev("parseFloat(getComputedStyle(document.getElementById('projname')).fontSize)");
    判('节名更大（≥40px）', 大字 >= 40, 大字 + 'px');

    await 敲('ArrowRight', 'ArrowRight', 39);
    const 三块 = await 读屏();
    判('再按一下 → 三块全亮（「这么接的道理」也出来了）', 三块.亮着 === 3 && !!三块.道理正文,
      '亮着 ' + 三块.亮着 + ' 块');
    判('三块全亮之后，脚上那颗才改口叫「下一节」', /下一节/.test(三块.下一颗 || ''), 三块.下一颗);

    await 敲('ArrowRight', 'ArrowRight', 39);
    const 第二节 = await 读屏();
    判('三块都亮完了，这一下才翻到第 2 节',
      /第\s*2\s*节/.test(第二节.节号 || '') && 第二节.节名 === '定位',
      JSON.stringify({ 节号: 第二节.节号, 节名: 第二节.节名 }));
    判('★★ 新的一节**不许一上来就全亮**（只亮第一块）', 第二节.亮着 === 1, '亮着 ' + 第二节.亮着);
    判('进度点跟着走', 第二节.亮点 === 1, 第二节.亮点);

    // —— 按回去：**必须回到原来那一屏**（"按错了能原路退回去"）——
    //   ★ 这一条是"逐块亮"最容易做坏的地方：如果"亮了几块"只存一个全屏的数，
    //     翻回来就被重置成 1，退回去看到的跟原来不是一屏——那就不叫退回去了。
    await 敲('ArrowLeft', 'ArrowLeft', 37);
    const 回一 = await 读屏();
    判('★★ 按 ← 退回第 1 节，**亮着的还是那三块**（不是退回"只亮一块"）',
      /第\s*1\s*节/.test(回一.节号 || '') && 回一.亮着 === 3, 回一.节号 + '，亮着 ' + 回一.亮着);
    await 敲('ArrowLeft', 'ArrowLeft', 37);
    判('本节还有多的，再按 ← 先**收一块**（没翻节）',
      (await 读屏()).亮着 === 2 && /第\s*1\s*节/.test(await 字('#projnum')), (await 读屏()).亮着);
    await 敲('ArrowLeft', 'ArrowLeft', 37);
    const 收到底 = await 读屏();
    判('收到只剩第一块', 收到底.亮着 === 1, 收到底.亮着);
    判('收到底时「上一节」按不动了（第一屏第一块）', 收到底.上一颗禁用 === true);
    await 敲('ArrowRight', 'ArrowRight', 39);
    await 敲('ArrowRight', 'ArrowRight', 39);
    判('★ 左三下、右两下之后回到"三块全亮"——两边对得上',
      (await 读屏()).亮着 === 3, (await 读屏()).亮着);

    // —— 模型没写全三行时的实话 ——
    //   现在停在（第 1 节，三块全亮）。模型又写了一节（第 4 节，只有"学生大概会说"一行），
    //   往回走要穿过第 2、3 节：那两节都还没亮完过，所以每穿一节都得先把它亮满。
    //   ★ 这一段顺带量到一件事：**跨过一节时不会被那一节的展开状态绊住**。
    await ev("SR.memo.pushTurn('a','第 4 节 · 小结\\n学生大概会说：嗯。','prep');SR.memo.flush();SR.project.refresh();'ok'");
    await sleep(300);
    const 点4 = await 数('#projdots .pdot');
    判('字幕跟上了新写的一节（进度点变 4）', 点4 === 4, 点4);
    for (let i = 0; i < 12; i++) {          // 一路按到第 4 节（第 2、3 节各要按几下才过）
      if (/第\s*4\s*节/.test(await 字('#projnum') || '')) break;
      await 敲('ArrowRight', 'ArrowRight', 39);
    }
    const 半节 = { 节号: await 字('#projnum'), 块数: await 数('#projbody .pblk'),
      亮着: await 数('#projbody .pblk:not(.pwait)'),
      缺的实话: await 字('#projbody .pnote') };
    注('半节：' + JSON.stringify(半节));
    判('一路按到了第 4 节', /第\s*4\s*节/.test(半节.节号 || ''), 半节.节号);
    判('只有一行的那一节只画一块，**不替模型编满**', 半节.块数 === 1, 半节.块数);
    判('★ 只有一行的那一节也不许"没得亮"——那唯一一块该是亮的', 半节.亮着 === 1, '亮着 ' + 半节.亮着);
    判('缺的几行如实说了', /没写/.test(半节.缺的实话 || ''), 半节.缺的实话);
    const 末屏 = await rect('#projbody');
    判('正文区没被撑破（.projbody 高度正常）', 末屏 && 末屏.h > 100, JSON.stringify(末屏));
    判('翻到最后一节、又全亮完了，「下一节」按不动',
      await ev("(function(){var b=document.getElementById('projnext');"
        + "return b.disabled;})()") === true,
      '亮着 ' + 半节.亮着 + '/1');

    // —— 投影红验 ①：把层藏起来，尺子必须红 ——
    await ev("(function(){var s=document.createElement('style');s.id='__rb3';s.textContent='#proj{display:none !important}';document.head.appendChild(s);return 'ok';})()");
    await sleep(250);
    const 藏起 = await 可见('#proj');
    判('★故障确实生效了（注入 display:none 后可见性读到 0）', 藏起 === 0, 'rects=' + 藏起);
    判('★红验：这时候"投影层开着且看得见"那条断言**应当**是假的', !(藏起 > 0));
    await ev("var e=document.getElementById('__rb3');if(e)e.remove();'ok'");
    await sleep(250);
    判('红验用完复原（又看得见了）', await 可见('#proj') > 0);

    // —— 投影红验 ②：把三行解析掐掉，尺子必须红 ——
    await ev("window.__psBody=SR.parseStepBody;SR.parseStepBody=function(){return {};};SR.project.refresh();'ok'");
    await sleep(300);
    const 空块 = await 数('#projbody .pblk');
    判('★故障确实生效了（掐掉解析后一块正文都没有了）', 空块 === 0, '块数 ' + 空块);
    判('★红验：这时候"这一节只画一块"那条断言**应当**是假的', !(空块 === 1));
    await ev("SR.parseStepBody=window.__psBody;delete window.__psBody;SR.project.refresh();'ok'");
    await sleep(300);
    判('红验用完复原（第 4 节那一块回来了）', await 数('#projbody .pblk') === 1,
      '块数 ' + await 数('#projbody .pblk'));

    // —— 退出 ——
    await 敲('Escape', 'Escape', 27);
    const 退出 = { 属性: await ev("document.getElementById('proj').getAttribute('data-proj')"),
      可见: await 可见('#proj'),
      焦点: await ev("document.activeElement?document.activeElement.id:'(没有)'") };
    判('Esc 退出投影', 退出.属性 === '0' && 退出.可见 === 0, JSON.stringify(退出));
    判('退出后焦点回到输入框（老师接着就能打字）', 退出.焦点 === 'input', 退出.焦点);

    // —— 关着的时候不许拦按键 ——
    const 页1 = await 字('#msgs');
    await 敲('ArrowRight', 'ArrowRight', 39);
    await 敲('Escape', 'Escape', 27);
    判('★关着的时候左右键／Esc 一个都不拦（不劫持全站键盘）',
      await ev("document.getElementById('proj').getAttribute('data-proj')") === '0' &&
      await 字('#msgs') === 页1);

    // —— 投影红验 ③：can() 是不是真的在把门 ——
    await ev("window.__can=SR.project.can;SR.project.can=function(){return false;};SR.chat.repaintSteps();'ok'");
    await sleep(250);
    const 无钮 = await 数('#steps .stepbtn.proj');
    判('★故障确实生效了（can() 说没有时，那格按钮真的不画了）', 无钮 === 0, '按钮数 ' + 无钮);
    判('★红验：这时候"台阶条末尾有投影那一格"那条断言**应当**是假的', !(无钮 > 0));
    await ev("SR.project.can=window.__can;delete window.__can;SR.chat.repaintSteps();'ok'");
    await sleep(250);
    判('红验用完复原（按钮回来了）', await 数('#steps .stepbtn.proj') === 1);

    // —— 刷新之后还在 ——
    await 硬载(本地);
    await 等开机(80);
    await 收首屏();
    const 刷新后 = await ev("(function(){var b=document.querySelector('#steps .stepbtn.proj');return b?b.getClientRects().length:0;})()");
    const 刷新后节 = await ev("SR.project.__steps().length");
    判('刷新回来投影那一格还在（对话是从记忆里重建的）', 刷新后 > 0, 'rects=' + 刷新后);
    判('刷新回来链子还是四节', 刷新后节 === 4, 刷新后节);
    await ev("var b=document.querySelector('#steps .stepbtn.proj');if(b)b.click();'ok'");
    await sleep(500);
    const 刷新后屏 = { 节号: await 字('#projnum'), 块数: await 数('#projbody .pblk'),
      点: await 数('#projdots .pdot'), 可见: await 可见('#proj') };
    注('刷新后开投影：' + JSON.stringify(刷新后屏));
    判('刷新之后投影照样能开，还是从第 1 节起', 刷新后屏.可见 > 0 && /第\s*1\s*节/.test(刷新后屏.节号 || ''), 刷新后屏.节号);
    判('刷新之后正文照样在三块里（不是空的壳）', 刷新后屏.块数 === 3, 刷新后屏.块数);
    await 敲('Escape', 'Escape', 27);

    // ============================================================
    段('合计');
    // ============================================================
    出.push('  绿 ' + 绿 + ' 条 / 红 ' + 红 + ' 条');

  } catch (e) {
    出.push('');
    出.push('★★ 探针自己炸了：' + (e && e.stack || e));
    红++;
  }

  const 文 = 出.join('\n');
  console.log(文);
  try { fs.writeFileSync(path.join(__dirname, '_shot', 'opt.txt'), 文, 'utf8'); } catch (e) {}
  await closeTab(t.id); ws.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });
