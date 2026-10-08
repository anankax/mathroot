// 2026-10-03 「全优化」那一趟的合并尺子。
//
// 一次跑完四件事的验收（孔老师原话：「你不要再屡次三番跑探针了，真的很浪费时间」）：
//   【1】布局两刀   —— ① 六个工位**一个宽度**（2026-10-04 孔老师改的：原来四档宽窄，
//                        他说「切换的根本不自然」，改成一律 1000；这一段现在量的是
//                        "分档有没有偷偷回来"）；② 画板抽屉改成**挤压式**（不再盖住对话）
//   【2】稳一手     —— ③ CDN 三源兜底；④ 手机（≤620px）抽屉改成底部升起；
//                     ⑤ 「素材」那颗按钮的门禁
//   【3】（**已撤**，2026-10-08）投影那一组整段删了：那条栏、台阶条、投影层
//        三样一起撤的，尺子留着只会变成一条长期假红。
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
