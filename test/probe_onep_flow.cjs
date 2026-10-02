// 第五阶段「走一遍」落地对账：**同一份东西在五个工位之间流过去**。
//
// 这张模拟稿（test/_mock/mock.html 的 ⑤）claim 的是两句话：
//   「每一步都不用重新交代，每一步都给下一步留了东西」
// 这个探针量的就是这两句在**真产品**里成不成立。两句各有一条实现、各有一组断言：
//
//   一、「不用重新交代」= js/api.js 的 buildSystem 末尾那段
//       『# 附：老师手上正在办的那一件事』（口袋通到模型那儿的路）。
//       加这一段之前，api.js 里**一处都没读 pocket**——顶上那三格挂在屏幕上，
//       模型一个字看不见，切个工位就问一遍"你要出哪一节"。
//   二、「给下一步留了东西」= js/memo.js 的 paintWorks（工位那一行照口袋点灯）。
//
// ── 这个探针为什么这么写（每一条都对应一次栽过的坑）──────────────────
//   ★ 判据用**页面里现算出来的**值和**产品自己的输出**，不拿我敲的字符串当尺子：
//     "口袋里有什么"那一句是当场调 SR.memo.bagText() 取回来的。我要是把
//     '口袋：题 6 道' 这个字面量抄进来比，改一次措辞它就永远比不过——
//     而**永远比不过**和**真的没写进去**在报告上长得一模一样。
//   ★ 必须先自检"我这个找法找得到东西"：空场那一趟断言的是"**找不到**那段"，
//     一段永远找不到的文本会让它假绿。所以先拿**有东西**的那一趟证明找得到，
//     空场那一趟才作数（顺序不能反）。
//   ★ 空场那一趟还要**两边都量**：不光"那段附注没出现"，还得"同一个调用里
//     该有的东西照样有"（提示词正文在）。只量"没有"的话，页面上凡是抛异常的
//     地方都能让它假绿。
//   ★ TAIL 那一条是个**不变式**，不是功能：收尾块是每一轮的格式契约，必须最后
//     读到（挪到末尾实测过 5/8 → 10/10）。新加的那段排在它前面，这件事得钉住——
//     哪天有人把新段追加到 return 前一行，屏幕上什么都看不出来，出图率掉一半。
//
// 开法：先 `node test/serve.cjs 8138`，Chrome 挂在 9222，再 `node test/probe_onep_flow.cjs`
const WS = require(require('os').homedir() + '/.claude/skills/browser/browser/node_modules/ws');

const HOST = process.env.HOST || '127.0.0.1:9222';
const SITE = process.env.SITE || 'http://localhost:8138/index.html';
const KEY = 'mathroot_memo';
const MARK = '老师手上正在办的那一件事';   // 那段附注的标题，量它的在不在

const sleep = ms => new Promise(r => setTimeout(r, ms));
let id = 0;
const pend = new Map();

let pass = 0, fail = 0;
const bad = [];
function ok(cond, name, why) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++; bad.push(name);
    console.log('  ✗ ' + name + (why ? '\n      → ' + why : ''));
  }
}

(async () => {
  const t = await fetch(`http://${HOST}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  const ws = new WS(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));
  ws.on('message', m => {
    const o = JSON.parse(m);
    if (o.id && pend.has(o.id)) { pend.get(o.id)(o); pend.delete(o.id); }
  });
  const send = (method, params) => new Promise(res => {
    const i = ++id; pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const q = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text || JSON.stringify(d));
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  // 页面里求值，异常当成**失败**报出来（不是当成 undefined 悄悄接着跑）
  const V = async expr => {
    const s = await q(`JSON.stringify((function(){ try { return {v:(${expr})}; }
                                             catch(e){ return {err:String(e&&e.message||e)}; } })())`);
    const o = JSON.parse(s);
    if (o.err) throw new Error(o.err);
    return o.v;
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: SITE });
  for (let i = 0; i < 80; i++) { if (await q('!!(window.SR && SR.api && SR.memo && SR.main)')) break; await sleep(250); }
  if (!(await q('!!(window.SR && SR.api && SR.memo && SR.main)'))) {
    console.log('⛔ 尺子坏了：页面/模块没起来，这一趟不算数。');
    await fetch(`http://${HOST}/json/close/${t.id}`); process.exit(3);
  }
  // 先等画板那一包落定——它加载完会收掉「正在加载…」，工具条矮一行、画板接走那块高度。
  // 这一条不测布局，但导图/画板那些模块起来的过程中页面在动，取状态要等它静下来。
  const ready = async () => {
    for (let i = 0; i < 120; i++) {
      const s = await V(`(function(){var e=document.getElementById('ggbstate');
        return {has:!!e, hidden:!!(e&&e.style.display==='none')};})()`);
      if (s.has && s.hidden) return true;
      await sleep(300);
    }
    return false;
  };
  if (!(await ready())) {
    console.log('⛔ 尺子坏了：等不到画板加载完。这一趟不算数（页面还在动的时候取的状态不作准）。');
    await fetch(`http://${HOST}/json/close/${t.id}`); process.exit(3);
  }

  // ── 页面里的助手 ────────────────────────────────────────────────
  // 调 buildSystem 拿那一段 system 原文。五个工位都是同一个签名。
  // 传空的 hist/parts：这一段附注跟历史无关，它读的是口袋。
  const SYS = w => V(`SR.api.buildSystem(${JSON.stringify(w)}, '按这一节出几道题', undefined, [], [], {})`);
  const WIPE = () => q(`SR.memo.clear(); try{localStorage.removeItem(${JSON.stringify(KEY)})}catch(e){}; 1`);
  const HASS = () => V(`Array.prototype.slice.call(document.querySelectorAll('.workbtn'))
      .filter(function(b){return b.classList.contains('has');})
      .map(function(b){return b.getAttribute('data-work');}).sort().join(',')`);

  console.log('\n【一】「每一步都不用重新交代」——口袋通到模型那儿\n');

  // ---- 空场：一个字都不加 ----
  await WIPE();
  const emptySys = await SYS('vary');
  ok(emptySys.indexOf(MARK) < 0, '空场：那段附注不出现',
     '刚进来还没交代过任何东西，却已经在跟模型说"这一件是……"——模型会以为老师在交代一件叫"还没定"的课');
  // ★ 两边都量：不能只量"没有"。提示词正文得在，不然"页面整个炸了、返回空串"也满足上面那条。
  ok(emptySys.length > 500, '空场：可这不等于 system 是空的（提示词正文照样在）',
     '只量"没有"的话，任何抛异常返空串的地方都能让上面那条假绿。实测长度 ' + emptySys.length);

  // ---- 有课时：加，而且加的是口袋里的原话 ----
  await q(`SR.memo.setPocket({topic:'3.1 用字母表示数', cls:'七(7)班'}); 1`);
  const topicSys = await SYS('vary');
  ok(topicSys.indexOf(MARK) >= 0, '★ 尺子自检：口袋里有东西时，那段附注**找得到**',
     '找不到 → 上面那条"空场不出现"是假绿（一段永远找不到的文本当然处处都找不到）');
  ok(topicSys.indexOf('3.1 用字母表示数') >= 0, '课题原样进去了');
  ok(topicSys.indexOf('七(7)班') >= 0, '班级原样进去了');

  // 五个工位都要有：切到哪个工位都不用重新交代，不是只给某一个工位开小灶
  const allW = await V(`SR.WORK_ORDER.join(',')`);
  for (const w of String(allW).split(',')) {
    const s = await SYS(w);
    ok(s.indexOf(MARK) >= 0, `切到【${w}】也有这一段`);
  }
  // 说得对不对：那一段里点的是**这个**工位的名字（config.js 的 label，不是我写死的）
  const lbl = await V(`SR.WORKS['prep'].label`);
  const prepSys = await SYS('prep');
  ok(prepSys.indexOf('换到了【' + lbl + '】') >= 0, `那一段点的是当前工位「${lbl}」（读 config.js，不写死）`);

  // ---- 口袋里的东西也跟着进去，而且跟屏幕上那句话**同源** ----
  await q(`SR.memo.produced('vary', {prob: 6}); 1`);
  await q(`SR.memo.produced('draw', {fig: 1}); 1`);
  const bag = await V(`SR.memo.bagText()`);              // ← 屏幕上那句，现取
  const bagSys = await SYS('vary');
  const bagIn = String(bag).replace(/^口袋：/, '');
  ok(bagSys.indexOf(bagIn) >= 0, '口袋那一句原样进了 system（跟 #op-bag 上写的是同一句）',
     '屏幕上写的是「' + bag + '」，system 里找不到「' + bagIn + '」——两处对不上，看着都正常');
  ok(bagIn.indexOf('题 6 道') >= 0 && bagIn.indexOf('图 1 张') >= 0,
     '（尺子自检：口袋那句里确实有刚记进去的题和图）', 'bagText 是「' + bag + '」，没读到我刚 produced 的东西');

  // ---- TAIL 不变式：收尾块仍然最后一段 ----
  const tailTxt = await V(`SR.PROMPT_PREP_TAIL || ''`);
  for (const w of ['prep', 'review']) {
    const s = await SYS(w);
    const iMark = s.indexOf(MARK), iTail = tailTxt ? s.lastIndexOf(tailTxt) : -1;
    ok(iMark >= 0 && iTail > iMark, `【${w}】收尾块仍然排在最后（新那段在它前面）`,
       'iMark=' + iMark + ' iTail=' + iTail + '。收尾块被顶掉了位置——屏幕上一点看不出来，出图率会掉');
    ok(tailTxt.length > 0 && s.trim().slice(-40) === tailTxt.trim().slice(-40),
       `【${w}】system 的**末尾**就是收尾块`);
  }
  // 反面：不 tail 的工位不该有收尾块（这条一直是对的，量一下免得我这段把顺序搞乱）
  const drawSys = await SYS('draw');
  ok(tailTxt && drawSys.indexOf(tailTxt) < 0, '【作图】照旧不带收尾块（tail:false 没被我这段带坏）');

  console.log('\n【二】「每一步都给下一步留了东西」——工位那一行照口袋点灯\n');

  // 反面先来：点一下不等于干过活
  await WIPE();
  await q(`SR.main.applyWork('draw'); 1`);
  await sleep(150);
  ok(await HASS() === '', '刚点进【作图】、什么都没出：那一格**不亮**',
     '照"点过没有"点灯的话，六格走一遍就全亮着，而字上写着"口袋空着"——样式和字各说各的');

  await q(`SR.memo.produced('vary', {prob: 6}); 1`);
  await sleep(80);
  ok(await HASS() === 'vary', '出了 6 道题 → 只有【命题】亮',
     '实际亮的是：' + await HASS());

  await q(`SR.memo.produced('material', {paper: 1}); 1`);
  await sleep(80);
  ok(await HASS() === 'material,vary', '再出 1 份卷子 → 又亮一格，前一颗不灭');

  await q(`SR.memo.produced('var' + 'y', {prob: 0}); 1`);   // 0 条：不该记，也不该多亮
  await sleep(80);
  ok(await HASS() === 'material,vary', '记 0 条不改任何东西（paintWorks 跟 produced 判据一致）');

  // 讲评那格永远不亮——它是从口袋里取的，不往里放
  await q(`SR.memo.produced('review', {rev: 3}); 1`);
  await sleep(80);
  ok((await HASS()).indexOf('review') < 0, '【讲评】永远不亮（它是取的那一头，不是放的那一头）',
     '亮起来了 → 有人给它补了一个计数，那个数只能靠数它说了几轮，会被当成"讲了几条"读');

  // 切工位不熄灯：口袋是跨工位的，灯也得跨
  await q(`SR.main.applyWork('prep'); 1`);
  await sleep(150);
  ok(await HASS() === 'material,vary', '切工位之后灯**不灭**（口袋里还在，凭啥灭）',
     '切一下全灭 → 那不是"流过去"，是每换一格就重新开始');

  // 只有 ⟳ 能清
  await WIPE();
  await sleep(80);
  ok(await HASS() === '', '⟳ 之后全灭');
  ok((await SYS('vary')).indexOf(MARK) < 0, '⟳ 之后那段附注也**不再出现**（模型那边一起清干净）');

  // ---- 刷新之后还在（这个产品的记忆得扛得住刷新，灯也一样）----
  await q(`SR.memo.setPocket({topic:'6.3 相交线', cls:'七(7)班'}); SR.memo.produced('prep', {chain: 2}); SR.memo.flush(); 1`);
  await send('Page.navigate', { url: SITE });
  for (let i = 0; i < 80; i++) { if (await q('!!(window.SR && SR.memo)')) break; await sleep(250); }
  await sleep(400);
  ok(await HASS() === 'prep', '刷新之后灯还亮着（照 localStorage 那一份重画）',
     '实际：' + await HASS());
  ok((await SYS('prep')).indexOf('6.3 相交线') >= 0, '刷新之后模型那边也还知道这是哪一件');

  console.log('\n【三】那盏灯**真的看得见**吗（class 挂上没有 ≠ 屏幕上有东西）\n');

  // ★★ 这一节是因为一条老教训才有的：class 挂上了、`display` 算出来也对，
  //   东西照样可以**一个像素都没画出来**——上一回栽在"藏的是它的**爹**"，
  //   子元素照报 flex。（[[scanner-numbers-are-not-what-they-claim]]）
  //   所以这儿不量 class，量两样**画出来的东西**：
  //     ① 那个小圆点自己的配色（伪元素上的 backgroundColor）
  //     ② 文字的左边缘**动没动**——预留的那点空白要是没生效，口袋一满字就整体右移 13px
  const DOT = () => V(`Array.prototype.slice.call(document.querySelectorAll('.workbtn')).map(function(b){
      var cs = getComputedStyle(b, '::before');
      var n = null;
      for (var i = 0; i < b.childNodes.length; i++) if (b.childNodes[i].nodeType === 3 && b.childNodes[i].data.trim()) { n = b.childNodes[i]; break; }
      var left = null;
      if (n) { var r = document.createRange(); r.selectNodeContents(n); left = Math.round(r.getBoundingClientRect().left * 100) / 100; }
      return { w: b.getAttribute('data-work'), has: b.classList.contains('has'),
               content: cs.content, bg: cs.backgroundColor, dw: cs.width,
               textLeft: left, btnW: Math.round(b.getBoundingClientRect().width) };
    })`);

  await WIPE();
  await sleep(120);
  const dotOff = await DOT();

  // 尺子自检：**空着的时候那条规则也得在**，只是透明的。
  // 不在的话就说明这条 ::before 压根没应用上——那"亮起来"那一条永远也过不了，
  // 而它过不了的样子跟"样式写错了"一模一样，会把下一个人指到错的地方去。
  ok(dotOff.every(d => d.content !== 'none' && d.content !== ''), '尺子自检：六个格子的 ::before 都挂上了（空着也占位）',
     'content 是 none → 这条规则根本没应用，下面几条"亮没亮"全不作数');
  ok(dotOff.every(d => d.dw === '6px'), '空着的时候也是 6px 宽（预留住了，字才不会左右跳）',
     '宽度是 ' + JSON.stringify(dotOff.map(d => d.dw)));
  ok(dotOff.every(d => d.bg === 'rgba(0, 0, 0, 0)'), '空着的时候是透明的（没东西的格子不该有颜色）',
     JSON.stringify(dotOff.map(d => d.bg)));

  await q(`SR.memo.produced('vary', {prob: 6}); 1`);
  await sleep(120);
  const dotOn = await DOT();
  const vary = dotOn.filter(d => d.w === 'vary')[0];
  const others = dotOn.filter(d => d.w !== 'vary');
  ok(vary && vary.has && vary.bg !== 'rgba(0, 0, 0, 0)', '★ 【命题】那个点真的**有颜色**（不是只挂了个 class）',
     '命题那格：' + JSON.stringify(vary));
  ok(others.every(d => d.bg === 'rgba(0, 0, 0, 0)'), '其余五格照旧透明',
     JSON.stringify(others.map(d => d.w + '=' + d.bg)));

  // ★★ 最要紧的一条：**字有没有跳**。预留没生效的话，口袋一满字就整体右移。
  const moved = dotOn.filter((d, i) => dotOff[i] && d.textLeft !== dotOff[i].textLeft);
  ok(moved.length === 0, '★ 亮灯前后，每个格子的**文字左边缘一个像素都没动**',
     '动了的：' + JSON.stringify(moved.map(d => d.w + ' ' + d.textLeft)));
  ok(dotOn.every((d, i) => d.btnW === dotOff[i].btnW), '格子本身宽度也没变（点哪儿都是这一格，范围不能缩）');

  // 当前那一格底色是近黑的，墨绿点在上面读不出来 → 得换白的
  await q(`SR.main.applyWork('vary'); 1`);
  await sleep(200);
  const onCell = (await DOT()).filter(d => d.w === 'vary')[0];
  ok(onCell.has && onCell.bg !== 'rgba(0, 0, 0, 0)', '当前那一格上的点**照样看得见**（底色深，得换亮色）',
     '底色是近黑，点却还是墨绿 → 亮着的那一格上等于没有这个记号：' + JSON.stringify(onCell));

  // 手机上工位那一行是横排换行的，多出来这 13px 会不会把行数顶多一行——
  // 那块 CSS 自己写着"手机上一行高都很贵"。
  await WIPE();
  await sleep(120);
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  const railOff = await V(`Math.round(document.querySelector('.rail').getBoundingClientRect().height)`);
  const railOffH = await V(`Math.round(document.querySelector('.works').getBoundingClientRect().height)`);
  await q(`SR.memo.produced('vary', {prob: 6}); 1`);
  await sleep(200);
  const railOn = await V(`Math.round(document.querySelector('.rail').getBoundingClientRect().height)`);
  const railOnH = await V(`Math.round(document.querySelector('.works').getBoundingClientRect().height)`);
  ok(railOn === railOff && railOnH === railOffH,
     '360px 上：亮灯**没把工位那一行顶高**（' + railOffH + '→' + railOnH + 'px，整栏 ' + railOff + '→' + railOn + '）',
     '多出来的那点宽度把这一行挤到多折了一行，手机上一行高很贵');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });

  // ── 收尾 ────────────────────────────────────────────────────────
  console.log('\n' + (fail === 0 ? '★ 全过' : '★ 有红的') + '：' + pass + ' 通过 / ' + fail + ' 没过');
  if (fail) { console.log('  没过的是：'); bad.forEach(x => console.log('    · ' + x)); }

  await fetch(`http://${HOST}/json/close/${t.id}`);
  ws.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async e => { console.error('炸了：' + (e && e.stack || e)); process.exit(2); });
