// 2026-10-05 那三刀的验收尺子：「去边界感」+「工位那一行拆壳」+「📐 搬进左侧工具栏」。
//
// ★ 用法（先起 node test/serve.cjs 8138，Chrome 在 9222）：
//     node test/probe_round17.cjs
//   SR_PAGE=https://anankax.github.io/mathroot/ node test/probe_round17.cjs   线上也照跑
// 退出码：0 = 全绿；1 = 有红；2 = 探针自己炸了；3 = 尺子坏了（页面没起来 / 标定对不上）
//
// ══ 这把尺子有两处是刻意写死的，别照着"简化"掉 ══
//
// ① **3px 不写死 3px，写"跟参照物一样宽"。**
//    实测：这台机器上 Chrome 把 `border-bottom: 3px` 算成 `2.66667px`
//    （`1px` 算成 `0.666667px`）。上一版这条断言写的是 `=== 3`，于是产品是对的、
//    尺子报红——**红的样子跟"产品坏了"长得一模一样**。
//    治法不是把 3 改成 2.66667（那个数会跟着 DPI／Chrome 版本变），
//    而是**在同一个页面里现造一个我写死 3px 的元素**，量它，再拿两个数比。
//    两个数相等 = 产品那条真是 3px；不等 = 产品不是 3px。跟 DPI 无关。
//
// ② **先发一次 mouseMoved 把指针挪开再量。**
//    探针窗口是**开着给他看的**（不许 headless），所以他桌面上的鼠标可能正好
//    停在某个按钮上 ——`:hover` 会真的生效。上一版就栽在这：同一颗按钮，
//    循环里量到"透明"、单独再量一次量到品牌绿（那是 `.workbtn:hover` 的底色），
//    差一步就当成"产品自相矛盾"了。
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const get = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const 图 = 'C:/数学办公/数根/test/_shots/';

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 料) => {
  if (真) { 绿++; console.log('  ✓ ' + 名); }
  else { 红++; console.log('  ✗ ' + 名 + '   ' + JSON.stringify(料)); }
};

(async () => {
  // 只关我自己开的 8138 标签页（**不碰他登着的 DeepSeek**）
  try {
    const list = JSON.parse(await get('/json/list'));
    for (const t of list) if (t.type === 'page' && /localhost:8138/.test(t.url || '')) { try { await get('/json/close/' + t.id) } catch (e) {} }
  } catch (e) {}

  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.enable',{});await send('Network.setCacheDisabled', { cacheDisabled: true });   // ★ 硬过缓存
  const 视口 = async (w, h) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(400) };
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW:' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 140);
    return R && R.result ? R.result.value : null;
  };
  const 拍 = async 名 => { const cr = await send('Page.captureScreenshot', { format: 'png' }); if (cr && cr.result && cr.result.data) { fs.mkdirSync(图, { recursive: true }); fs.writeFileSync(图 + 名, Buffer.from(cr.result.data, 'base64')); return 'test/_shots/' + 名 } return '没截到' };
  const 贴 = async css => q(`(function(){var o=document.getElementById('__r17');if(o)o.remove();
      var s=document.createElement('style');s.id='__r17';s.textContent=${JSON.stringify('')}+${JSON.stringify(css)};
      document.head.appendChild(s);return 1})()`);
  const 撕 = () => q(`(function(){var o=document.getElementById('__r17');if(o)o.remove();return 1})()`);
  // ★ 把指针挪到"消息区正中间"——那儿没有 :hover 规则，量别的东西时不会被它污染
  const 挪指针 = async () => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 470, button: 'none' }); await sleep(250) };

  await 视口(1440, 950);
  await send('Page.navigate', { url: (process.env.SR_PAGE || 'http://localhost:8138/') + 'index.html?r17&t=' + Date.now() });
  for (let i = 0; i < 240; i++) { if (await q('!!(window.SR&&SR.board&&SR.board.isReady&&SR.board.isReady()===true)') === true) break; await sleep(500) }
  await sleep(2500);

  const 活了 = await q('!!(window.SR && SR.WORK_ORDER && SR.WORK_ORDER.length)');
  if (!活了) { console.log('★ 仪器不对，先别往下判：页面没起来（8138 起了吗？9222 是这个 profile 吗？）'); ws.close(); process.exit(3); }
  console.log('页面起来了：工位 ' + await q('SR.WORK_ORDER.length') + ' 个；视口 1440×950');
  await 挪指针();

  // ══════ 0. 标定：量出"这台机器上 3px 到底算多少" ══════
  console.log('\n0. 标定（这一格不过，下面所有宽度断言都不算数）');
  const 参照3 = await q(`(function(){var o=document.getElementById('__ref');if(o)o.remove();
    var d=document.createElement('div');d.id='__ref';
    d.style.cssText='position:fixed;left:-9999px;top:0;width:1px;height:1px;border-bottom:3px solid #000';
    document.body.appendChild(d);return getComputedStyle(d).borderBottomWidth})()`);
  console.log('   我写死 3px 的参照物，这台机器量到 = ' + 参照3);
  const 参照1 = await q(`(function(){var o=document.getElementById('__ref1');if(o)o.remove();
    var d=document.createElement('div');d.id='__ref1';
    d.style.cssText='position:fixed;left:-9999px;top:0;width:1px;height:1px;border-top:1px solid #000';
    document.body.appendChild(d);return getComputedStyle(d).borderTopWidth})()`);
  console.log('   我写死 1px 的参照物，这台机器量到 = ' + 参照1);
  判('标定：参照物量得出数（不是 null／不是 0）', parseFloat(参照3) > 0 && parseFloat(参照1) > 0, { 参照3, 参照1 });
  if (!(parseFloat(参照3) > 0)) { console.log('★ 标定失败，往下的宽度断言没有意义。'); ws.close(); process.exit(3); }
  判('标定：1px 参照 < 3px 参照（尺子能分辨粗细，不是只会读一个数）',
     parseFloat(参照1) < parseFloat(参照3), { 参照1, 参照3 });

  // ══════ 1. 去边界感：四处框／线 ══════
  console.log('\n1. 去边界感（对话栏那块白卡、栏头线、输入条线、抽屉的线和影）');
  const 边界 = await q(`(function(){
    var col=document.querySelector('main > .col'), ch=document.querySelector('.colhead'),
        co=document.querySelector('.composer'), dr=document.getElementById('drawer'),
        ws=document.getElementById('works');
    var g=function(e){var s=getComputedStyle(e);return {底:s.backgroundColor,
      上框宽:s.borderTopWidth, 上框色:s.borderTopColor,
      下框宽:s.borderBottomWidth, 下框色:s.borderBottomColor,
      左框宽:s.borderLeftWidth, 左框色:s.borderLeftColor,
      影:s.boxShadow, 图:s.backgroundImage}};
    return {col:g(col), 栏头:g(ch), 输入条:g(co), 抽屉:g(dr), 工位行:g(ws)}})()`);
  // ★ 宽和色**分开量**，别拼成一个字符串再按空格切开：
  //   `"0.666667px rgba(0, 0, 0, 0)"` 切完 `[1]` 是 `"rgba(0,"`——上一版就这么栽的，
  //   产品是对的，尺子自己拼错字符串、报红（红的样子跟产品坏了长得一样）。
  const 透 = v => v === 'rgba(0, 0, 0, 0)' || v === 'transparent';
  // "这条框看不见" = 要么没宽度，要么宽度在但颜色透明（两件写法都算撤干净了）
  const 没框 = (宽, 色) => !(parseFloat(宽) > 0) || 透(色);
  判('对话栏：没有白底了，也没有那层"跟着鼠标走的光"了（后者在 css 更靠下那条里又铺回来过）',
     透(边界.col.底) && 边界.col.图 === 'none', { 底: 边界.col.底, 图: 边界.col.图 });
  判('对话栏：没有那圈线了（原来 border:1px solid var(--line)）', 没框(边界.col.上框宽, 边界.col.上框色), 边界.col);
  判('栏头：下边线不再画颜色（留宽度不算——见 css 里那条注释）',
     没框(边界.栏头.下框宽, 边界.栏头.下框色) && 透(边界.栏头.底), 边界.栏头);
  判('输入条：那条横贯整幅的上边线没了', 没框(边界.输入条.上框宽, 边界.输入条.上框色) && 透(边界.输入条.底), 边界.输入条);
  判('抽屉：左边线和那圈阴影都没了（它是挤压式的一栏，不是浮层）',
     没框(边界.抽屉.左框宽, 边界.抽屉.左框色) && 边界.抽屉.影 === 'none', 边界.抽屉);
  判('工位那一行：凹槽底和那圈线撤了（这就是"我改的那条没生效"那一处）',
     透(边界.工位行.底) && 没框(边界.工位行.上框宽, 边界.工位行.上框色), 边界.工位行);
  const 角标 = await q(`(function(){var c=document.querySelector('main > .col');
    return {还挂着:c.classList.contains('tick'), 弹层还在用:document.querySelectorAll('.box.tick').length}})()`);
  判('★ 四角角标：对话栏上那两个 L 形角线也撤了（撤了白卡之后，它是这栏唯一还剩的框）',
     角标 && 角标.还挂着 === false, 角标);
  判('★ 对照：角标那套 css 没被删干净——六个弹层还在用它（撤的是这一处用法，不是那条规则）',
     角标 && 角标.弹层还在用 > 0, 角标 && 角标.弹层还在用);

  // ══════ 2. 选中态：不再是黑块，是一条跟参照物一样宽的底边 ══════
  console.log('\n2. 工位那一行的选中态');
  await q(`(function(){ if(SR.landing&&SR.landing.hide) SR.landing.hide(); SR.main.applyWork('prep'); return 1 })()`);
  await sleep(900); await 挪指针();
  const 选中 = await q(`(function(){var b=document.querySelector('#works .workbtn.on');if(!b)return null;
    var s=getComputedStyle(b);return {字:b.textContent.trim(), 底:s.backgroundColor,
      下边宽:s.borderBottomWidth, 下边色:s.borderBottomColor, 线型:s.borderBottomStyle, 可见:b.getClientRects().length}})()`);
  console.log('   量到 = ' + JSON.stringify(选中));
  判('选中的那一格：没有黑底（旧样子是一块 background:var(--ink) 的近黑块）', 选中 && 透(选中.底), 选中 && 选中.底);
  判('选中的那一格：下边是实线，而且**跟标定参照物一样宽**',
     选中 && 选中.线型 === 'solid' && parseFloat(选中.下边宽) === parseFloat(参照3),
     { 产品: 选中 && 选中.下边宽, 参照: 参照3 });
  判('选中的那一格：真的看得见（量 getClientRects，不是量 display）', 选中 && 选中.可见 === 1, 选中 && 选中.可见);

  // ══════ 3. 尺子自检：把旧规则注回去，看量法会不会变 ══════
  console.log('\n3. 尺子自检：注回旧规则，读数必须跟着变（不然上面那些绿是白得的）');
  await 贴('.workbtn.on { background: var(--ink) !important; border-bottom-color: transparent !important; }'
        + ' main > .col { background: var(--panel) !important; border: 1px solid var(--line) !important; }');
  await sleep(400);
  const 旧 = await q(`(function(){var b=document.querySelector('#works .workbtn.on'),c=document.querySelector('main > .col');
    var sb=getComputedStyle(b),sc=getComputedStyle(c);
    return {底:sb.backgroundColor, 下边色:sb.borderBottomColor, 栏底:sc.backgroundColor}})()`);
  console.log('   注回旧规则后 = ' + JSON.stringify(旧));
  判('★ 自检：注回旧规则后，"选中那一格的底"读数变了',
     旧 && 选中 && 旧.底 !== 选中.底, { 现在: 选中 && 选中.底, 注回: 旧 && 旧.底 });
  判('★ 自检：注回旧规则后，"对话栏的底"读数变了', 旧 && 透(旧.栏底) === false, 旧 && 旧.栏底);
  await 撕(); await sleep(400);
  const 回 = await q(`(function(){var b=document.querySelector('#works .workbtn.on');var c=document.querySelector('main > .col');
    return {底:getComputedStyle(b).backgroundColor, 栏底:getComputedStyle(c).backgroundColor}})()`);
  判('★ 自检：撕掉注入之后回到新样子（不是一次性生效）',
     回 && 选中 && 回.底 === 选中.底 && 透(回.栏底), 回);


  // ══════ 7. 栏头那句小字：删干净了没有 ══════
  console.log('\n7. 栏头那句小字（#badge）');
  await 视口(1440, 950); await sleep(600);
  const 栏头 = await q(`(function(){var e=document.querySelector('.colhead');return e?e.textContent.trim():'没有 colhead'})()`);
  判('#badge 元素不存在了', (await q('document.getElementById("badge") === null')) === true);
  判('栏头只剩「对话」两个字', 栏头 === '对话', 栏头);
  const 源头 = await q(`(function(){var out={landing:0,title:0};
    document.querySelectorAll('.lblock i').forEach(function(e){if(e.textContent.trim())out.landing++});
    document.querySelectorAll('.workbtn').forEach(function(e){if((e.getAttribute("title")||"").trim())out.title++});return out})()`);
  console.log('   那句话的源头还在不在 = ' + JSON.stringify(源头));

  // ══════ 8. 首屏：六块一列、盒子撤了 ══════
  console.log('\n8. 首屏六块');
  await q(`(function(){ if(SR.landing&&SR.landing.show) SR.landing.show(); return 1 })()`);
  await sleep(1200); await 挪指针();
  const 首屏在 = await q('document.body.getAttribute("data-landing")');
  if (String(首屏在) !== '1') {
    console.log('  ★ 首屏没摆成（data-landing=' + 首屏在 + '）——这一段跳过，不留一张假装是首屏的图');
  } else {
    const 块 = await q(`(function(){var a=[].slice.call(document.querySelectorAll('.lblock'));if(!a.length)return null;
      return {数:a.length, 排:a.map(function(e){var b=e.getBoundingClientRect(),s=getComputedStyle(e);
        return {左:Math.round(b.left),上:Math.round(b.top),底:s.backgroundColor,外框:s.borderTopWidth,
                左条:s.borderLeftWidth+' '+s.borderLeftColor, 字:e.querySelector('i')?e.querySelector('i').textContent.trim():''}})}})()`);
    console.log('   量到 ' + (块 && 块.数) + ' 块');
    判('首屏六块都在', 块 && 块.数 === 6, 块 && 块.数);
    判('六块**一列**：左缘相同、上缘逐个往下',
       块 && 块.排.every(x => x.左 === 块.排[0].左) && 块.排.every((x, i) => i === 0 || x.上 > 块.排[i - 1].上),
       块 && 块.排.map(x => [x.左, x.上]));
    判('盒子撤了：外框 0、没有底色', 块 && 块.排.every(x => parseFloat(x.外框) === 0 && 透(x.底)),
       块 && 块.排.map(x => x.外框 + ' ' + x.底));
    判('三像素左条还在（悬停/选中的落点，空着时是透明但不是没宽度）',
       块 && 块.排.every(x => parseFloat(x.左条) === parseFloat(参照3)), 块 && 块.排.map(x => x.左条));
    判('★ 对照：右边那句说明真的有字（空页也能让上面几条"通过"）',
       块 && 块.排.filter(x => x.字.length > 0).length === 6, 块 && 块.排.map(x => x.字));
    console.log('   ' + await 拍('_核对-首屏.png'));
  }

  console.log('\n════ ' + 绿 + ' 绿 / ' + 红 + ' 红 ════');
  ws.close(); process.exit(红 ? 1 : 0);
})().catch(e => { console.error('炸了：' + (e && e.stack || e)); process.exit(2) });
