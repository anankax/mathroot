// 推完之后核**线上那一页**——不是 curl 文件，是整页真跑起来。
//
// 为什么要有这把尺子：这个项目吃过一次大亏——工作树里改好了、他看不见，
// 因为他一直是在**线上那版**上评判我的工作（见 2026-10-03 那次一列六行）。
// 所以"推成功"不算数，"线上实物跑起来对"才算数。
//
// 用法：node test/probe_live.cjs
// 前提：**可见窗口**的探针 Chrome 在 9222（别加 --headless=new，他要看得见）。
// 退出码：0 = 线上正常；2 = 有断言红了。
//
// ★ 上一版这把尺子自己就量错了，留个记号：它拿"#works 有六张卡"当开机信号，
//   而那六张卡是 landing.js（本地 defer 脚本）画的，比 CDN 上的六个库早得多。
//   于是在 1 秒出头就开量，读回来四个 undefined —— 看着像"线上塌了"，
//   其实是我量早了。**要等的是库本身，不是页面。**
// ★ 第二条：`marked@12` 的全局是个**对象**（`marked.marked` / `marked.parse`），
//   不是函数。第一版写成 `typeof marked === 'function'` 去等它，
//   等满 30 秒也等不到，报 `到齐秒: null` —— 又一个"恒假"的尺子。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const 线上 = process.argv[2] || 'https://anankax.github.io/mathroot/';
const 超时秒 = 30;

const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0;
function 判(名, ok, 值) {
  if (ok) { 绿++; console.log('  ✓ ' + 名 + (值 !== undefined ? '  → ' + JSON.stringify(值) : '')); }
  else { 红++; console.log('  ✗ ' + 名 + '  → ' + JSON.stringify(值)); }
}

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };

  // 页面自己的 console.warn/error（闸门超时会走这条）——注意这是 Runtime 域，
  // 不是 Log 域。Log 域收的是网络/弃用那类浏览器条目，收不到页面自己的 console。
  const 台 = [];
  ws.on('message', m => {
    const o = JSON.parse(m);
    if (o.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].indexOf(o.params.type) >= 0) {
      台.push(o.params.type + ': ' + (o.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ').slice(0, 160));
    }
    if (o.method === 'Runtime.exceptionThrown') {
      台.push('未捕获: ' + ((o.params.exceptionDetails || {}).text || '').slice(0, 160));
    }
  });

  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable', {});
  await send('Log.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // ★ 记一条**时间线**：每个库是什么时候到的、8 秒闸门是什么时候开的。
  //   为什么非量不可：`SR.main.boot()` 是挂在 `SRlib.whenReady` 上的，
  //   而 `whenReady` 在**闸门一开就叫**——闸门要是被 8 秒兜底提前开了，
  //   `boot()` 就会在一个**没有库**的时刻跑。`render.js` 那几处是惰性查 `window.X`
  //   还好说（到用的时候库已经在了），但 `GGBApplet` 是开机就要的
  //   （index.html 顶上那段注释说得很死：它必须在 `board.init()` 之前就位）。
  //   ⚠ 上一版这里有一条**恒绿**的断言：`!闸门超时 || 到齐秒 !== null`——
  //     只要库到了它就是真的，闸门开早开晚都判绿，等于没量。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(function(){
      var TL = window.__tl = { libs: {}, warnAt: null };
      var 名 = ['marked','katex','DOMPurify','renderMathInElement','GGBApplet'];
      var t0 = Date.now();
      TL.t0 = t0;
      (function tick(){
        for (var i=0;i<名.length;i++){
          var n = 名[i];
          if (window[n] && TL.libs[n] === undefined) TL.libs[n] = Date.now() - t0;
        }
        if (!TL.停) setTimeout(tick, 30);
      })();
      var w = console.warn;
      TL.警告 = [];
      console.warn = function(){
        var 文 = [].slice.call(arguments).map(String).join(' ');
        TL.警告.push({ 在: Date.now() - t0, 文: 文 });
        // ★ 只认**闸门那一条**。上一版记的是"第一条 console.warn"，
        //   页面里任何一句别的 warn 都会把我引到错的时间点上——
        //   我看着 13.28s 那个数就以为闸门开在 13.28s，其实那可能是别人。
        if (TL.warnAt === null && 文.indexOf('还没到齐') >= 0) TL.warnAt = Date.now() - t0;
        return w.apply(console, arguments);
      };
    })();`
  });

  console.log('\n线上实物核对 → ' + 线上 + '\n');
  const T0 = Date.now();
  await send('Page.navigate', { url: 线上 });

  // ★ 等的是**五个下游真正读的全局**，不是"页面画出来了"。
  //   而且**不数 `SRlib.ready` 的键**——那一份是**落定集**：某个库把所有源都试完、
  //   一个都没到，`落定()` 照样给它记一个键。数它的话，三源全断会报"六份齐"。
  //   （这是"检测脚本的数字不是它宣称的那件事"里反复出现的那一类。）
  const 库在 = "({marked:typeof window.marked,katex:typeof window.katex,"
    + "doom:typeof window.DOMPurify,ar:typeof window.renderMathInElement,ggb:typeof window.GGBApplet})";
  let 到齐秒 = null, 快照 = null;
  for (let i = 0; i < 超时秒 * 4; i++) {
    快照 = await ev(库在);
    if (快照 && 快照.marked === 'object' && 快照.katex === 'object'
      && 快照.doom === 'function' && 快照.ar === 'function' && 快照.ggb === 'function') {
      到齐秒 = (Date.now() - T0) / 1000; break;
    }
    await sleep(250);
  }
  await sleep(600);

  const 缺 = await ev("(function(){var a=['katex-css','marked','dompurify','katex','autorender','geogebra'],"
    + "r=(window.SRlib&&SRlib.ready)||{};return a.filter(function(k){return !r[k];});})()");
  const TL = await ev('window.__tl ? ({libs:__tl.libs, warnAt:__tl.warnAt, t0:__tl.t0, 警告:__tl.警告}) : null');
  await ev('window.__tl && (__tl.停 = true)');
  // 开门时刻怎么定：走了兜底那条路就是 warnAt；没走兜底，就是**最后一个库落定**那一刻
  //（`剩` 归零＝开门）。
  // ⚠ 这里我一开始图省事拿 `TL.libs.GGBApplet` 当开门时刻——那在"没走兜底"的分支里
  //   等于**拿 GGBApplet 跟它自己比**，断言恒真，数字还是假的。又一条"量错了东西"。
  const 末位到 = TL ? Math.max.apply(null, Object.keys(TL.libs).map(k => TL.libs[k])) : null;
  const 闸门开在 = TL ? (TL.warnAt !== null ? TL.warnAt : 末位到) : null;
  const 走兜底 = !!(TL && TL.warnAt !== null);

  console.log('— 六份库 —');
  判('六个下游全局都到齐了', 到齐秒 !== null, 到齐秒 !== null ? ('耗时 ' + 到齐秒.toFixed(2) + 's') : 快照);
  判('源链全部落定（无缺项）', Array.isArray(缺) && 缺.length === 0, 缺);
  if (TL) {
    const 序 = Object.keys(TL.libs).sort((a, b) => TL.libs[a] - TL.libs[b])
      .map(k => k + ' ' + (TL.libs[k] / 1000).toFixed(2) + 's').join('  ');
    console.log('  时间线：' + 序);
    console.log(TL.warnAt === null
      ? '  闸门：没走到兜底那条路（库落定时就开门了），正常'
      : '  闸门：8 秒兜底先开了门（' + (TL.warnAt / 1000).toFixed(2) + 's），库后到');
    // ★★ 2026-10-04：上面那一行原来写的是「网络慢，不是坏」。**那句是错的**，
    //   而且是我自己看着这条红注上去的——红的样子跟"产品坏了"长得一样，
    //   这一次它**就是**坏了：闸门一开 boot() 就跑，board.init() 撞上没有 GGBApplet
    //   的当口，老代码写一句「没加载出来，刷新试试」就 return，**再没人回来建 applet**，
    //   画板整场死在那儿。慢网这一档是**必然**撞上的（闸门本来就是为慢网开的）。
    //   下面那条断言当时只查到"开门那一刻库在不在"就收了，没往下问**板子最后起没起**——
    //   所以补上「画板最后真起来了」那一条，它才是这件事的结论。
    if (TL.警告 && TL.警告.length) {
      console.log('  页面的 warn：' + TL.警告.map(x => (x.在 / 1000).toFixed(2) + 's ' + x.文.slice(0, 70)).join(' | '));
    }
    // ★ 这一条 2026-10-04 从"判红"降成"记录"——理由是它写的契约已经**反过来**了。
    //   它原来判的是："开门那一刻 GGBApplet 必须已就位"（不许 boot 跑在空手上）。
    //   改后的设计恰恰相反：闸门到点就开，库没到就让 boot **等**。
    //   于是"库晚于开门"现在是**预期内的正常**，它却每次都判红 —— 长期假红，
    //   红的样子跟产品坏了长得一模一样，会把我以后每一条真红的可信度都拖下水。
    //   ⚠ 想代理的那件事没丢，交给下面那条**独立量后果**的断言：「板子最后真起来了」。
    //     片头归片头，后果归后果，**只判后果**。
    console.log('  – 开门那一刻 GGBApplet 在不在（改后不作判据，看下面"板子最后真起来了"）：'
      + 'GGBApplet ' + (TL.libs.GGBApplet === undefined ? '（没记到）' : (TL.libs.GGBApplet / 1000).toFixed(2) + 's')
      + ' / 开门 ' + (闸门开在 / 1000).toFixed(2) + 's' + (走兜底 ? '，走的兜底' : '，没走兜底'));
    // ★ 真坏了的样子是「板子没起来」。板子是**后果**，上面那个是**片头**。
    //   所以这一条要独立量，且要等到它真起来（applet 本体那一包比 deployggb.js 晚得多）。
    //   `board.init()` 在 boot 里是无条件跑的，跟抽屉开不开没关系，所以不用点开右栏。
    let 板子 = null;
    for (let i = 0; i < 60; i++) {
      const g = await ev("(function(){try{return !!(window.ggbApplet&&window.ggbApplet.getAllObjectNames);}"
        + "catch(e){return false;}})()");
      if (g === true) { 板子 = ((i + 1) * 1.0).toFixed(0) + 's'; break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    判('画板最后真起来了（慢网兜底那一路也建得出 applet）', 板子 !== null,
      { 起来于: 板子 === null ? '等了 60 秒还没起' : ('+' + 板子), 走兜底: 走兜底 });
  } else {
    判('拿到库的到达时间线', false, 'window.__tl 没装上');
  }

  console.log('\n— 渲染管线真干活 —');
  // 不是只看"marked 在不在"，是**真拉一遍**。存在但坏的库照样会返回 true。
  判('marked 能把 markdown 变成 HTML', await ev(
    "(function(){try{var h=SR.render.md('# 标\\n\\n这**加粗**');"
    + "return h.indexOf('<h1')>=0&&h.indexOf('<strong')>=0;}catch(e){return '炸:'+e.message;}})()") === true);
  判('KaTeX 能排版一条公式', await ev(
    "(function(){try{var d=document.createElement('div');"
    + "katex.render('x^2+y^2=r^2',d);"
    + "return !!d.querySelector('.katex');}catch(e){return '炸:'+e.message;}})()") === true);
  判('GeoGebra 脚本已就位（GGBApplet）', 快照 && 快照.ggb === 'function');

  console.log('\n— 版式与入口 —');
  const 六格 = await ev("document.querySelectorAll('#works > *').length");
  判('首屏六张卡在', 六格 === 6, 六格);
  const 列宽 = await ev("(function(){var c=document.querySelector('main > .col');return c?Math.round(c.getBoundingClientRect().width):null;})()");
  判('对话栏单列且限宽（≤1120）', typeof 列宽 === 'number' && 列宽 <= 1120, 列宽);
  // 居中：左右空白差 ≤4px
  const 居 = await ev("(function(){var c=document.querySelector('main > .col');if(!c)return null;"
    + "var r=c.getBoundingClientRect();return Math.round(Math.abs(r.left-(innerWidth-r.right)));})()");
  判('对话栏居中（左右空白差 ≤4px）', typeof 居 === 'number' && 居 <= 4, 居);
  判('project.js 在位且有 can()', await ev("!!(window.SR&&SR.project&&typeof SR.project.can==='function')"));
  判('投影那一层用的是 #proj id（不是 .proj 类）', await ev(
    "(function(){var e=document.getElementById('proj');"
    + "return !!e&&e.className.indexOf('proj')>=0;})()") === true);
  // ★ 台阶条那格按钮的可见性：量 getClientRects().length，**绝不量 getComputedStyle().display**
  //   ——2026-10-03 那次类名撞车，按钮"存在、可点、点了就开"，唯独不可见，
  //     而 getComputedStyle 照样读得到主色。只有 rects 才现形。
  const 有链 = await ev("!!(window.SR&&SR.memo&&SR.memo.log&&SR.memo.log().length&&SR.project.can())");
  if (有链) {
    判('有链子时那格「⛶ 投影」按钮真的可见', await ev(
      "(function(){var b=document.querySelector('#steps .stepbtn.proj');"
      + "return b?b.getClientRects().length:0;})()") > 0);
  } else {
    console.log('  – 这一页没有链子，跳过「投影按钮可见」那条（要造一条链才能验）');
  }

  console.log('\n— 台面 —');
  判('页面没有 console 报错/未捕获异常', 台.filter(s => s.indexOf('还没到齐') < 0).length === 0,
    台.filter(s => s.indexOf('还没到齐') < 0));

  // ★ 红验：把三家 CDN 全掐掉，再开一页——"六个库到齐"那条**必须**变红。
  //   不跑这一条的尺子等于没验过：它可能无论线上是死是活都报绿
  //   （今天这一把尺子自己就已经栽过两次，见文件顶上的注释）。
  //   这一步只截 6 秒，不等满——要证明的是"掐了之后**判不出绿**"，
  //   不是"等它到底缺几个"。
  console.log('\n— 红验：掐掉三家 CDN —');
  await send('Network.setBlockedURLs', { urls: ['*fastly.jsdelivr.net*', '*unpkg.com*', '*cdn.bootcdn.net*', '*geogebra.org*'] });
  await send('Page.navigate', { url: 线上 + '?r=' + Date.now() });
  await sleep(6000);
  const 红快照 = await ev(库在);
  const 红齐全 = !!(红快照 && 红快照.marked === 'object' && 红快照.katex === 'object'
    && 红快照.doom === 'function' && 红快照.ar === 'function' && 红快照.ggb === 'function');
  判('★故障确实生效了：掐了 CDN 之后库真的到不了', !红齐全, 红快照);
  判('★红验：这时候"六个库到齐"那条断言**应当**是假的', !红齐全);
  await send('Network.setBlockedURLs', { urls: [] });

  const r = await send('Page.captureScreenshot', { format: 'png' });
  const 出 = path.join(__dirname, '_shot', 'live-首页.png');
  fs.writeFileSync(出, Buffer.from(r.result.data, 'base64'));
  console.log('\n截图 → ' + 出);
  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红\n');
  await closeTab(t.id); ws.close();
  process.exit(红 ? 2 : 0);
})().catch(e => { console.error('炸了：' + (e && e.stack || e)); process.exit(3); });
