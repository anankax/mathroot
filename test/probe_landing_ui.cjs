// 首屏那一层，**在真浏览器里**的样子。
//
// 跟 test/probe_landing.cjs 是两把不同的尺子，别互相替代：
//   probe_landing.cjs（node）判 route()/intercept() 的**约定**——归得对不对、放不放行。
//     ★ 它有一件事**判不了**：那句"放行"之后，老师的话到底有没有真的发出去。
//       归得出来那一趟 landing 自己不调 submit，是 chat.js 接着发的；
//       在 node 里我够不着 chat.js，只能判到"它回的是 false、框里那句话没被动过"。
//   ★ 这一把补的就是那一段，另外还有"画出来是什么样"：
//       ① 首屏真的立起来了吗（看得见吗——量 getClientRects，不量 computed display）
//       ② 底下那几块真的是从 SR.WORKS 画出来的吗、有没有溢出
//          ★ 块数**照 SR.WORK_ORDER 现数**（下面那个 NW），不写死——2026-10-03 加
//            「学情」就是一次加件；写死 5 的话它会在仪器自检里报"仪器不对"，
//            把人指向"服务没起来"，而不是"该改尺子了"。
//       ③ 打一句话按发送：工位换了 + 那一行字出来了 + **气泡真的挂在屏幕上了**
//       ④ 对不上时：不出现气泡，屏幕上说"不像"，那句话还在框里
//       ⑤ 归完那一行的「换一件」展开得出来吗、点得动吗
//       ⑥ 首屏的排布：**一栏 + 居中**（1400/900/620），以及画板收着没放出来
//
// ★★ 量"看不看得见"一律用 getClientRects().length，**不许用 getComputedStyle().display**。
//   这个仓库栽过一次：藏起来的是它的**爹**（.outbox），孩子照样报 flex，
//   于是"藏了"被报成"没藏"。（教训原文见 CLAUDE 记忆里的量具那一条。）
//
// ★ 不自称"线上也这样"。这一趟量的是**本机这份工作副本**渲染出来的样子；
//   线上的样子由 SR_PAGE=https://anankax.github.io/mathroot/ 单独跑一趟再说。
//
// ★★ 红验（尺子自己得先证明能红）。故障**注在探针里**，js/ 下一个字不改——
//   "临时改一下产品再改回来"这种事不做：忘了改回来就是把坏东西留在仓库里。
//   跑法：SR_FAULT=<名字> node test/probe_landing_ui.cjs
//   ★ 判据是"该红的那几条红了、别的没红"，**不是"有红就行"**。
//     2026-10-03 重测（这趟一共 45 条），实测四趟：
//     hideblocks   → 红 1 条（只有那条量"首屏六块看不看得见"的）
//     nointercept  → 红 13 条（②那一行字/工位/按钮/让开 + ③"没发出去"往下，全是"压根没拦"的后代）
//     swallow      → 红 15 条（②③④⑤⑥ 全塌，那句话被吞了）
//     nostanddown  → 红 9 条（整族"让开没让开"：水印/消息区/**画板** + ⑥里的居中/封顶/一栏）
//     ★ 这三个数比原来大，是因为这趟**加了尺子**（画板收起来又回来、首屏一栏居中），
//       **不是产品退化了**——新加的每一条都落在它该落的那一族里。
//       查红验要看的始终是那一件事：**红的是不是这一族、别族有没有被牵连**。
//   ⚠ 这里踩过一个坑：本来想拿 `SR.landing.route = …` 注"归不出来"，那一趟**全绿**——
//     不是尺子漏了，是**那一手什么都没改**：intercept() 调的是闭包里那份 route，
//     改外面这个导出名根本不经过它。所以故障得注在**真在调用路径上**的地方。
//     （顺带也是好事：外面改不动归类，尺子想放水都放不了。）
//
// 用法（先 node test/serve.cjs 8138，Chrome 开着 9222）：
//   node test/probe_landing_ui.cjs
//   ⚠ 跑之前先把这个浏览器里的**旧 8138 标签页关掉**（留一个 about:blank 就行，
//     别把窗口全关光——Chrome 会整个退掉，9222 就没了）。
//     为什么：同源页**共享 localStorage**，别的页离开时 `pagehide` 会把 memo 写回盘上，
//     正好盖掉这一趟的清场。2026-10-04 实测：存量 11 个标签时自检当场报"仪器不对"，
//     关干净之后 47/47 全绿。**这不是产品坏，是这道探针的现场没扫干净。**
// 退出码：0 = 通过；1 = 有红；2 = 探针自己炸了；3 = 尺子坏了（页面/仪器没起来）
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';

let PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}
function closeTab(tid) {
  return new Promise(res => {
    const r = http.request({ host: 'localhost', port: 9222, path: '/json/close/' + tid, method: 'GET' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', () => res(null)); r.end();
  });
}

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => {
    const r = JSON.parse(m);
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; }
  });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable', {}); await send('Runtime.enable', {});
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300);
    return R && R.result ? R.result.value : null;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ★★ 故意弄坏的地方（红验用）。**故障注在探针里，不改 js/ 下一个字**——
  //   "临时改一下产品再改回来"这种事不做：忘了改回来就是把坏东西留在仓库里。
  //   跑法：SR_FAULT=swallow node test/probe_landing_ui.cjs
  //   判据是"该红的那几条红了、别的没红"，不是"有红就行"。
  //   ★ 声明放在最前面：下面 injectFault() 在页面一加载就要用（TDZ 是不等人的）。
  const FAULT = process.env.SR_FAULT || '';
  const FAULT_JS = {
    // 那几块被藏起来 → ① 的"每一块都看得见"应该红
    hideblocks: "document.getElementById('lblocks').style.display='none';",
    // 首屏压根不拦了（"这个工作台没起作用"）→ ② 的"工位换了/那一行字出来了"应该红
    // ⚠ 原先是拿 `SR.landing.route = …` 来注的，**那一手是空的**：intercept() 调的是
    //   闭包里那份 route（模块内部直接调），改外面这个导出名根本不经过它。
    //   所以那一趟全绿，看着像"尺子漏了"，其实是"我什么都没改"。
    //   （顺带也是件好事：外面改不动归类——尺子想放水都放不了。）
    nointercept: "SR.landing.intercept=function(){return false;};",
    // intercept 一律接走（那正是"吞掉老师那句话"）→ ② 的"话真的发出去了"应该红
    swallow: "SR.landing.intercept=function(){return true;};",
    // 首屏亮着、干活那一套也亮着 → ① 的两条"让开了"应该红
    nostanddown: "document.body.removeAttribute('data-landing');"
  };
  async function injectFault() {
    if (FAULT_JS[FAULT]) await q('(function(){ ' + FAULT_JS[FAULT] + ' return 1 })()');
  }

  await send('Page.navigate', { url: PAGE });
  for (let i = 0; i < 40; i++) { if ((await q('!!(window.SR&&window.SR.landing)')) === true) break; await wait(500); }
  // ★★ 首屏那张卡片屏只在"刚进来"那一屏出现——memo 非空时 landing.js 不挂它（show() 里写死的），
  //    这是**设计**不是坏了。所以先把前提做出来：存一份 memo 原文 → 清掉 → 重开一页。
  //    ⚠ 清必须用产品自己的 `SR.memo.clear()`（内存和盘**一起**清，js/memo.js 那份）；
  //      从外面 `localStorage.removeItem()` **不管用**：memo 有两个朝向，内存里那份
  //      在 `pagehide` 时会再写回盘上（js/memo.js 顶上那条注释），正好把抹掉的填回来。
  //      第一版我就写的 removeItem，结果量到的还是六轮对话那一屏，自检报"仪器不对"——
  //      把人指向"服务没起来"，而真相是**我自己的清法没生效**。
  //    ⚠ 收工按**原文**写回（不是 clear()），别抹掉老师自己的东西。
  const 开工前memo = await q("(function(){try{return localStorage.getItem('mathroot_memo')}catch(e){return null}})()");
  const memo条数 = await q("(function(){try{return (SR.memo&&SR.memo.log&&SR.memo.log().length)||0}catch(e){return -1}})()");
  if (memo条数 > 0) {
    await q("(function(){try{if(SR.memo&&SR.memo.clear)SR.memo.clear();}catch(e){}return 1})()");
    await send('Page.navigate', { url: PAGE });
    for (let i = 0; i < 40; i++) { if ((await q('!!(window.SR&&SR.WORKS&&SR.chat&&SR.landing&&document.querySelector(".msg.landing"))')) === true) break; await wait(500); }
    await wait(900);
    console.log('  （开工前 memo 里躺着 ' + memo条数 + ' 条，先清掉重开一页做"刚进来"那一屏——'
              + 'memo 非空时首屏**本来就不该**出现，不清就量不到首屏，只会量到上一次对话。）');
  }
  await injectFault();       // ① 也在故障范围里（hideblocks / nostanddown 打的就是①）

  const host = await q('location.host');
  console.log('这一趟跑在 : ' + host + '\n');

  // ---- 仪器自检：**只问"我在不在工作"，不问"产品对不对"** ----
  //   （自检里要是逐字去比产品输出，产品一退化自检就喊"尺子坏了"，把人指错方向。）
  const inst = await q(`(function(){
     return { works: !!SR.WORKS, order: SR.WORK_ORDER ? SR.WORK_ORDER.length : -1,
              nworks: SR.WORKS ? Object.keys(SR.WORKS).length : -1,
              // ⚠ 门牌 2026-10-03 换过：首屏不再是 HTML 里的 #landing，改成 #msgs 的
              //   第一条助手消息 div.msg.assistant.landing（landing.js 的 mountFirstMessage 现建现插）。
              //   旧写法 getElementById('landing') 永远 false，这把尺子就永远卡在"仪器不对"——
              //   **一把拒绝出数的尺子，跟坏产品长得一模一样**，所以门牌得跟着产品走。
              //   ⚠ 这段整个在模板串里，注释**不许出现反引号**（会把模板串截断，见下面那条同族警告）。
              landing: !!SR.landing, box: !!document.querySelector('.msg.landing'),
              bar: !!document.getElementById('routebar'), input: !!document.getElementById('input'),
              send: !!document.getElementById('send'), chat: !!SR.chat };
   })()`);
  // ★ 件数**照 SR.WORK_ORDER 现数**，不写死。2026-10-03 加「学情」就是一次加件：
  //   写死 5 的话，那天它会在第①段当场红，报的却是"仪器不对"——把人指向服务没起来。
  const NW = inst ? inst.order : -1;
  const instOk = inst && inst.works && inst.landing && inst.box && inst.bar && inst.input && inst.send && inst.chat
    && NW > 0 && NW === inst.nworks;
  if (!instOk) {
    console.log('★ 仪器不对，先别往下判：' + JSON.stringify(inst));
    console.log('  （页面根本没起来？服务在 8138 吗、Chrome 9222 是这个 profile 吗？）');
    if (typeof 开工前memo === 'string') await q('(function(){try{localStorage.setItem("mathroot_memo",' + JSON.stringify(开工前memo) + ')}catch(e){}return 1})()');
    await closeTab(t.id); ws.close(); process.exit(3);
  }

  // 看得见吗——**恒量的那一个口径**。别改成 getComputedStyle().display。
  const vis = sel => `(function(){var e=document.querySelector(${JSON.stringify(sel)});return !!e && e.getClientRects().length>0;})()`;

  // ★★ 重开一屏。为什么要这个：首屏的 `picked`（"他自己点过工位了"）一旦立起来
  //   **就不再落**——产品**故意**这样（底线③：点过一次，别再拦第二回）。
  //   所以一屏里只有**第一句话**会被归。第一版没管这件事，② 归完一句之后
  //   ③④⑤ 全在半路拦截已经退休的状态下跑：屏幕上显示"对不上时它没说不像"
  //   "换一件按钮找不着"，看着像坏了三处，其实是我把三个场景串在一屏里了。
  //   真浏览器里老师就是**新开一次**——所以重载页面就是这里最诚实的等价物。
  //   ⚠ 重载之后桩要重装（页面里的那些改动跟着页面一起没了）。
  async function fresh() {
    // ★★ 「新开一屏」现在**多了一道手续**：这一场的东西是**跨刷新活着**的
    //   （2026-10-02 起，"切工位／刷新都不丢，只有 ⟳ 才清"——这正是老师要的那件事）。
    //   所以光重载页面，开出来的**不再是空场**，是上一节留下的那一场：
    //   首屏那一行会因为"这一场已经说过话了"不再拦，⑤ 那几颗颗自然就找不到。
    //   这不是产品坏了，是**这道探针的起点变了**；要空场就得先把它清空。
    //
    //   ⚠⚠ 别只删 `localStorage` 那一下：页面离开时 memo.js 的 `pagehide` 兜底
    //     会把内存里那份**又写回盘上**（写在删除之后，等于没删）。
    //     内存那份和盘上那份都得动——`clear()` 干的正是这件事。
    await q(`SR.memo.clear(); localStorage.removeItem('mathroot_memo'); 1`);
    // ★★ 2026-10-04：**还得先分清"这是新那一页"**。下面那个等号在刷新**落地之前**
    //   就会被旧页满足（旧页本来就 data-landing=1、lblocks=6），于是循环当场放行：
    //   `before` 量到的是**刚被 clear 清空的旧页**（0 条），发送那一下点在还没就绪的新页上。
    //   结果 ②整段把产品冤枉成"话没发出去、工位没换"——而产品其实是好的
    //   （手跑一遍：发送后 data-landing=null、data-work=material、routeBar「我按【组卷】办的」、
    //    气泡里老师那句在、输入框清空，全对）。
    //   治法：刷新前在 window 上盖个戳，刷新后那个戳**必须消失**才算换了 document。
    //   （同族：等的是个"稳的错值"——旧页那个状态稳稳地成立着。）
    await q(`window.__probeGen = 'g' + Date.now(); 1`);
    await send('Page.reload', { ignoreCache: true });
    // ★★ 2026-10-03：**等的东西换了一个**。原来等的是"#lblocks 里有 6 块"——
    //   可那 6 块是 index.html 里就写死的静态 DOM，**页面一解析完就是 6 块**，
    //   跟 landing 那一层（landing.js 的 show() 才去设 data-landing、填 #lq、标出最像的）**毫无关系**。
    //   于是这个等号在首屏初始化**之前**就放行了：
    //     · ③ 看到的是"还没 init 的首屏"——#lq 还是 index.html 里那句「要做什么？」，
    //       量出来就是"没说不像"（产品被冤枉成坏了）；
    //     · ⑥ 看到的是"首屏还没立、画板还开着、#lblocks 宽 0"。
    //   同一份代码两趟跑出不同的红，根子都在这儿——**等的是个"稳的错值"**
    //   （记忆里"等稳会栽在稳的错值上"那条，形状一模一样）。
    //   现在等 data-landing="1"：landing.js 的 show() 里设的那个属性，
    //   而它正是下面每一段都依赖的那个状态（"首屏真的立起来了"）。
    //   ⚠ 别改成等首屏那个框（.msg.landing）可见：那一条是 CSS 说了算的，属性没设也可能可见。
    for (let i = 0; i < 60; i++) {
      // 换了 document（戳没了）**且**首屏真立起来了，才算这一页准备好了
      const 新页 = await q('typeof window.__probeGen === "undefined"');
      // ★★ 2026-10-04：这里**必须**把第二个 q 也钉成布尔。
      //   刷新刚落地那一瞬 `document.body` 还是 null，`document.body.getAttribute` 当场抛，
      //   而 q 把异常**变成一个字符串** `'THROW: …'` 返回（见 q 的定义）——字符串是真值，
      //   于是 `&&` 当场成立、循环**立刻放行**，这一页根本没等就绪。
      //   后果：下面是 ②③④⑤⑥ 全在一张没加载完的页上量，红得跟产品坏了一样
      //   （实测 ② 报"老师那句话没发出去、气泡 0 条"，而手动走一遍产品全对：
      //    routebar「我按【组卷】办的」、user 气泡在、输入框清空）。
      //   同一族：一把**会提前放行**的等号，跟"等一个稳的错值"是一回事。
      const 就绪 = await q('!!(document.body && document.body.getAttribute("data-landing")==="1" && document.querySelectorAll("#lblocks .lblock").length === ' + NW + ')');
      if (新页 === true && 就绪 === true) break;
      await wait(250);
    }
    await wait(400);
    await q(`(function(){ window.__origAsk = SR.api.ask;
       SR.api.ask = function(o){ o.onChunk('（桩）'); return Promise.resolve({ text:'（桩）', model:'STUB', error:'' }); };
       window.__origReady = SR.api.ready; SR.api.ready = function(){ return true; }; return 1; })()`);
    await injectFault();
    // ★ 返回"首屏真的立起来了没"——跟上面那个等号同一个口径。
    //   原来返回的是"DOM 里有几块"，那件事在初始化之前就已经是真了，等于没回答。
    return await q('document.body.getAttribute("data-landing")==="1"');
  }
  if (FAULT) console.log('★★ 这一趟注了故障：' + FAULT + '（红验用，看该红的那几条红了没）\n');
  else if (process.env.SR_FAULT) { console.log('★ 不认识的 SR_FAULT=' + process.env.SR_FAULT + '，认得的只有：' + Object.keys(FAULT_JS).join(' / ')); await closeTab(t.id); ws.close(); process.exit(3); }

  // ============================================================
  //  ① 首屏立起来了吗
  // ============================================================
  console.log('① 首屏：一个框 + 底下 ' + NW + ' 块');
  ok('★ 首屏那个框真的看得见（量 getClientRects，不量 computed display）', await q(vis('.msg.landing')));
  const q1 = await q('(document.getElementById("lq")||{}).textContent||""');
  ok('  #lq 上有一句问话，而且不是空的（空的会让下面几条变成"比了个寂寞"）', !!String(q1).trim(), q1);

  // 首屏那几块：从 SR.WORKS 现取期望值，**一个名字都不写死**
  const blocks = await q(`(function(){
     return Array.prototype.map.call(document.querySelectorAll('#lblocks .lblock'), function(b){
       return { w: b.getAttribute('data-work'),
                label: (b.querySelector('b')||{}).textContent||'',
                badge: (b.querySelector('i')||{}).textContent||'',
                seen: b.getClientRects().length > 0,
                r: b.getBoundingClientRect() };
     });
   })()`);
  const wantLabels = await q('(function(){return SR.WORK_ORDER.map(function(w){return (SR.WORKS[w]&&SR.WORKS[w].label)||w;});})()');
  ok('首屏正好 ' + NW + ' 块（照 SR.WORK_ORDER 数）', Array.isArray(blocks) && blocks.length === NW, blocks && blocks.length);
  ok('首屏 ' + NW + ' 块的顺序 = SR.WORK_ORDER 的顺序', !!blocks && blocks.map(b => b.w).join(',') === (await q('SR.WORK_ORDER.join(",")')),
     blocks && blocks.map(b => b.w));
  ok('★ 首屏 ' + NW + ' 块各自的名字 = config 里那一件的 label（名字只有一个源头）',
     !!blocks && blocks.map(b => b.label).join('|') === wantLabels.join('|'),
     { 屏幕上: blocks && blocks.map(b => b.label), config: wantLabels });
  ok(' 首屏 ' + NW + ' 块每一块底下的说明（badge）都不是空的', !!blocks && blocks.every(b => b.badge.trim().length > 0),
     blocks && blocks.map(b => b.badge));
  ok('★ 首屏 ' + NW + ' 块**每一块都看得见**（不是被爹藏了还报着 flex）', !!blocks && blocks.every(b => b.seen),
     blocks && blocks.map(b => [b.w, b.seen]));

  // 首屏在的时候，干活那一套该让开——★ 这也要量"看得见"，不是量 display
  ok('  首屏在的时候，数根那个水印让开了（.ghost 看不见）', (await q(vis('.ghost'))) === false);
  // ★★ 2026-10-04：判据改了。产品 2026-10-03 起**不再整块藏 `#msgs`**了——
  //   首屏那条消息（`div.msg.landing`）现在就住在 `#msgs` 里面，藏 `#msgs` 等于把首屏自己藏掉，
  //   而刷新回来时它藏的是 memo 刚接回来的那一场对话（见 css/main.css 那一段长注释）。
  //   现在让开的是"**首屏之外**的那些消息"。这两条合起来才是原来那一条的意思，
  //   而且是**往严了**改的：不光"看着让开了"，还要求首屏自己看得见。
  ok('  首屏在的时候，首屏之外的消息让开了（#msgs 里非 landing 那些看不见）',
    (await q('(function(){var l=document.querySelectorAll("#msgs > .msg:not(.landing)");'
      + 'if(!l.length) return true;'
      + 'return !Array.prototype.some.call(l,function(m){return m.getClientRects().length>0});})()')) === true);
  ok('  而首屏那条自己**看得见**（#msgs 整块没被藏——藏了就是把首屏藏了）',
    (await q(vis('.msg.landing'))) === true);
  // ★ 2026-10-03 孔老师原话："页面也太偏左了，我觉得就应该对话框居中"。当年病根是右栏还立着。
  //   ★★ 2026-10-04：这条判据**原来量的是 .side**，而 .side 2026-10-02 就搬进抽屉了——
  //   元素没了，`vis` 恒返回 false，于是这条**永远是绿的**，绿的却是"东西不存在"，
  //   不是"东西被藏了"。同一族的坑：砍掉容器会把否定式断言变成恒真。
  //   现在量首屏**真用 data-landing 藏掉的那几样**（见 css/main.css 的
  //   `body[data-landing="1"] #msgs>.msg:not(.landing), #thumb, #steps, .works, .ghost {display:none}`）：
  //   干活那一套（工位那一行 .works、台阶条 #steps）在首屏上必须让开。
  //   ⚠ 量的是它们**本身**看得见看不见，不是 getComputedStyle().display——藏的是它自己。
  ok('★ 首屏在的时候，干活那一套让开了（工位那一行 .works 看不见）', (await q(vis('.works'))) === false);
  ok('★ 首屏在的时候，台阶条 #steps 也让开了', (await q(vis('#steps'))) === false);

  // 首屏那几块排不排得下（本机这份宽度下）
  const fit = await q(`(function(){
     var c=document.getElementById('lblocks'); var cr=c.getBoundingClientRect();
     var over=[]; Array.prototype.forEach.call(c.querySelectorAll('.lblock'),function(b){
       var r=b.getBoundingClientRect();
       if (r.right > cr.right + 0.5) over.push({ w:b.getAttribute('data-work'), right:Math.round(r.right), boxRight:Math.round(cr.right) });
     });
     return { over: over, cols: getComputedStyle(c).gridTemplateColumns.split(' ').length };
   })()`);
  ok(' 首屏没有一块冒到容器右边外面去', !!fit && fit.over.length === 0, fit && fit.over);
  console.log('     （这个宽度下排了 ' + (fit && fit.cols) + ' 列）');

  // ============================================================
  //  ② 打一句话按发送：工位换了 + 那一行出来了 + **话真的发出去了**
  // ============================================================
  console.log('\n② 打「出一份第五周周练卷」，按发送');
  // ★ 新开一屏 + 装桩。桩必须**会 resolve**：第一版写的是 `new Promise(function(){})`
  //   ——一个永远不落地的 promise，看着很"稳"，其实把 chat.js 的 `busy` 永久焊在 true 上
  //   （它只在 ask 回来之后才落 busy）。于是后面每一次 submit 都在 busy 那道闸上
  //   直接 return，屏幕上显示"对不上时它没说不像""点一块没反应"，
  //   看着像坏了三处，其实是我把闸门焊死了。
  //   （又一次：数到的不是它宣称的那件事。）
  await fresh();

  const SENT = '出一份第五周周练卷';
  const before = await q('document.querySelectorAll("#msgs .msg").length');
  await q(`(function(){var i=document.getElementById('input');i.value=${JSON.stringify(SENT)};
     i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  await q('document.getElementById("send").click()');
  await wait(700);

  const after = await q(`(function(){
     var ms=document.querySelectorAll('#msgs .msg');
     // ★ 不取"最后一条"：桩会回一句，于是最后一条是**助手**的。
     //   要守的那件事是"**老师那一句**在不在屏幕上"，所以在所有气泡里找 user 那条。
     //   （第一版按位置取，结果把助手的桩回复当成"老师的话没发出去"报了一红。）
     var mine = Array.prototype.filter.call(ms, function(m){
        return /\\buser\\b/.test(m.className) && (m.innerText||'').indexOf('第五周') >= 0; });
     return { n: ms.length, nUserSent: mine.length,
              sentTxt: mine.length ? (mine[0].innerText||'').trim() : '',
              bar: (document.getElementById('routebar')||{}).innerText||'',
              barSeen: !!document.querySelector('#routebar') && document.querySelector('#routebar').getClientRects().length>0,
              work: document.body.getAttribute('data-work'),
              inputVal: document.getElementById('input').value,
              landSeen: !!(document.querySelector('.msg.landing')||{}).getClientRects && document.querySelector('.msg.landing').getClientRects().length>0,
              // ★★ 2026-10-04：判据换掉了。原来量的是 .side（main 右边那一栏），
              //   那个元素 **2026-10-02 就搬进抽屉了**（见 css/main.css 那句
              //   "…已经搬进抽屉，main 现在只有一个孩子（那个 .col）"）。
              //   querySelector 找 .side 从那天起**永远是 null**，于是这一条**一直红**——
              //   一把永远红的尺子，跟"产品一直坏着"长得一模一样，谁也不会再去看它。
              //   而且"首屏收起来的那一栏"这个说法今天也没了：首屏收的是 .works/#steps/#thumb，
              //   画板根本不在首屏的收放范围里。所以改成量今天的实情——说完话之后，
              //   画板那一格还在文档里、抽屉还能开。（板子**活着**由下面 ggbBox 那条单独量。）
              //   ⚠ 这里是在一个模板串**里面**，注释里也不许出现反引号——
              //     反引号会把模板串当场截断（本行我改了两次，两回都栽在这上面）。
              板在: !!document.getElementById('ggb') && !!document.getElementById('drawer'),
              ggbBox: (function(){var e=document.getElementById('ggb'); if(!e) return null;
                        var r=e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) };})() };
   })()`);

  // ★★ 2026-10-04：上面那段 evaluate **一抛错，q 回的是字符串** `'THROW: …'`（见 q 的定义）
  //   ——它是真值，于是下面 `after.sentTxt.slice(...)` 在 Node 里炸成
  //   "Cannot read properties of undefined (reading 'slice')"，**把页面里真正那句话吞掉**。
  //   教训：探针的报错路径自己也会遮蔽现场。所以先把它摆到明面上，再让读数取值一律走 S()。
  if (typeof after === 'string') console.log('  ★ ② 那段 evaluate 在页面里抛了：' + after);
  const S = x => (typeof x === 'string' ? x.slice(0, 60) : x);

  ok('★ 气泡真的挂上去了——**老师那句话发出去了**（不是只剩一行"我按【X】办的"）',
     !!after && typeof after === 'object' && after.n > before && after.nUserSent === 1 && String(after.sentTxt || '').indexOf(SENT.slice(0, 5)) >= 0,
     { 之前: before, 之后: after && after.n, 找到几条我发的话: after && after.nUserSent, 内容: S(after && after.sentTxt) });
  ok('★ 那一行"我按【…】办的"出来了、而且看得见', !!after && after.barSeen && /组卷/.test(after.bar), after && after.bar);
  ok('  工位真的换到组卷了（body[data-work]）', after && after.work === 'material', after && after.work);
  ok('  工位那一行里「组卷」那颗也亮了', (await q(`(function(){var b=document.querySelector('#works .workbtn[data-work="material"]');return !!b && b.classList.contains('on');})()`)) === true);
  ok('  首屏让开了（这一栏开始说正事了）', after && after.landSeen === false, after && after.landSeen);
  // ★★ 2026-10-04：这两条原来守的是"首屏把 .side 收成 display:none，说上话之后得自己回来"。
  //   那件事已经不存在了（.side 搬进抽屉了，见上面 板在 那段注释）。今天真正会出事的是
  //   **画板本身有没有被首屏那一趟弄死**：GeoGebra 是开机时注入的，首屏把周围的东西
  //   display:none 掉，要是把 applet 的尺寸算成了 0 再没算回来，画布就是块死白。
  //   所以现在只留一条硬指标——#ggb 得有**实际尺寸**（宽高都 > 0）。光"在文档里"证明不了这件事。
  ok('★ 说上话之后，画板那一格还在（没被首屏那一趟拆掉）',
     after && after.板在 === true, after && after.板在);
  ok('★ 而且它是**活的**：#ggb 有实际尺寸（宽高都 > 0，不是被藏到尺寸都没了）',
     !!(after && after.ggbBox && after.ggbBox.w > 0 && after.ggbBox.h > 0), after && after.ggbBox);
  ok('  发出去之后框清空了（chat.js 自己清的，不是 landing 替他清）', after && after.inputVal === '', after && after.inputVal);

  // ============================================================
  //  ③ 对不上的时候：**不出现气泡**，屏幕上说不像，话还在框里
  // ============================================================
  console.log('\n③ 打「你好」——该问，不该硬塞一件');
  await fresh();                       // ★ 新开一屏：首屏的"第一句话"这一格只给一次
  const n3 = await q('document.querySelectorAll("#msgs .msg").length');
  await q(`(function(){var i=document.getElementById('input');i.value='你好';
     i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  await q('document.getElementById("send").click()');
  await wait(600);

  const ask = await q(`(function(){return {
     n: document.querySelectorAll('#msgs .msg').length,
     lq: (document.getElementById('lq')||{}).textContent||'',
     tip: (document.getElementById('ltip')||{}).innerText||'',
     inputVal: document.getElementById('input').value,
     landSeen: !!(document.querySelector('.msg.landing')||{}).getClientRects && document.querySelector('.msg.landing').getClientRects().length>0,
     nMark: document.querySelectorAll('#lblocks .lblock em').length };})()`);
  ok('★ 没发出去（气泡数没变）—— 这一句被接住了', ask && ask.n === n3, { 之前: n3, 之后: ask && ask.n });
  ok('★ 屏幕上明说了"不像"（产品原话是「这不像底下这几件里的哪一件。」，尺子只判这三个字）', ask && /不像/.test(ask.lq), ask && ask.lq);
  ok('  首屏还亮着（没跳走）', ask && ask.landSeen === true);
  ok('  那句话还留在框里（点一件就能直接办）', ask && ask.inputVal === '你好', ask && ask.inputVal);

  // 点一块 = 用刚才那句话办
  console.log('\n④ 点「备课」那块——用刚才那句话办');
  await q(`(function(){var b=document.querySelector('#lblocks .lblock[data-work="prep"]'); b.click(); return 1})()`);
  await wait(700);
  // ★ 又是同一个坑（这条探针里栽了两回，所以在这儿写下来）：
  //   **别读"最后一条气泡"**——桩会回一句，最后一条永远是助手的。
  //   要守的是"老师那句话说出去过没有"，那就得在所有气泡里找 user 那条。
  //   （这条探针里凡是"看最后一条"的判据，全都是错的；②④⑤ 各栽了一回。）
  const pick = await q(`(function(){
     var mine = Array.prototype.filter.call(document.querySelectorAll('#msgs .msg'), function(m){
        return /\\buser\\b/.test(m.className) && (m.innerText||'').indexOf('你好') >= 0; });
     return { n: document.querySelectorAll('#msgs .msg').length, nUser: mine.length,
              txt: mine.length ? (mine[0].innerText||'').trim() : '',
              work: document.body.getAttribute('data-work') };})()`);
  ok('★ 工位换成备课了', pick && pick.work === 'prep', pick && pick.work);
  ok('★ 而且用的是**刚才那句「你好」**（点一下就办，不用重打）',
     pick && pick.nUser === 1, { 找到几条: pick && pick.nUser, 内容: pick && pick.txt });

  // ============================================================
  //  ⑤ 「换一件」展开得出来吗、点得动吗
  // ============================================================
  console.log('\n⑤ 归完那一行上的「换一件」');
  await fresh();                       // ★ 又要一屏新的：「换一件」得先有那一行，那一行得先归出来
  await q(`(function(){var i=document.getElementById('input');i.value='换个数再出几道';
     i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
  await q('document.getElementById("send").click()');
  await wait(600);
  const chgOk = await q(`(function(){var c=document.getElementById('routechg');return !!c && c.getClientRects().length>0;})()`);
  ok('  「换一件」这一颗真的在屏幕上（量得见）', chgOk === true);
  await q(`(function(){var c=document.getElementById('routechg'); if(c) c.click(); return 1})()`);
  await wait(300);
  const minis = await q(`(function(){
     var p=document.getElementById('routepick');
     return Array.prototype.map.call(document.querySelectorAll('#routepick .rmini'), function(b){
       return { w:b.getAttribute('data-work'), t:(b.textContent||'').trim(), seen:b.getClientRects().length>0 }; });})()`);
  ok('  展开之后是 ' + NW + ' 颗（照 SR.WORK_ORDER 数）', Array.isArray(minis) && minis.length === NW, minis && minis.length);
  ok('★ ' + NW + ' 颗**都看得见**（不是展开了却藏在折叠里）', !!minis && minis.every(m => m.seen),
     minis && minis.map(m => [m.w, m.seen]));
  ok('  ' + NW + ' 颗上的字 = ' + NW + ' 件的 label', !!minis && minis.map(m => m.t).join('|') === wantLabels.join('|'),
     { 屏幕上: minis && minis.map(m => m.t), config: wantLabels });
  // 点「备课」：换过去、同一句话重发
  // 同样的道理：找的是 **user** 的那条，不是最后一条。
  const uCount = `Array.prototype.filter.call(document.querySelectorAll('#msgs .msg'), function(m){
      return /\\buser\\b/.test(m.className) && (m.innerText||'').indexOf('换个数再出几道') >= 0; }).length`;
  const n5 = await q('(function(){return ' + uCount + ';})()');
  await q(`(function(){var b=document.querySelector('#routepick .rmini[data-work="prep"]'); if(b) b.click(); return 1})()`);
  await wait(700);
  const re = await q(`(function(){
     var d=document.getElementById('msgs'); var kids=Array.prototype.slice.call(d.children);
     var wd=-1, u=[];
     kids.forEach(function(k,i){ if(k.classList.contains('wdiv')) wd=i; });
     kids.forEach(function(k,i){
       // ⚠ 别在这儿写词界正则：这一整段是**模板串**，反斜杠-b 进到页面里是**退格符**，
       //   不是词界——正则于是永远匹配不上，量出来"一条都没有"，红得跟产品坏了一样。
       //   （真要写就得写双反斜杠；这边干脆改用 classList，绕开转义这回事。）
       if(k.classList.contains('user') && (k.innerText||'').indexOf('换个数再出几道')>=0) u.push(i); });
     return { n: u.length, work: document.body.getAttribute('data-work'),
              seam: wd, seamTxt: wd>=0 ? (kids[wd].textContent||'') : '',
              在接缝前的: u.filter(function(i){return i<wd;}).length,
              在接缝后的: u.filter(function(i){return i>wd;}).length };})()`);
  // ★★ 这条断言 2026-10-02 改过，原来的判据是「只会有一条」——现在**两条是对的**，理由如下：
  //   原来那一趟是**跨体系**（命题 → 备课），而 applyWork 那时会把历史清掉再重开，
  //   所以屏幕上那句话没了，rework 只好重发一遍（见 landing.js rework 里 `keep` 那条）。
  //   现在这一场是**跨刷新活着的**，换过去历史还在，那句**已经发出去过**的话又一次被重发，
  //   于是屏幕上真的出现两条。**这是事实，不是画错了**——产品确实把那句话送出去过两回。
  //   要守的不是"只许有一条"（那会逼着我去压掉一条真发生过的发送），
  //   而是"这两回**分得开**"：中间那条接缝就是干这个的，它让"同一句话出现两次"
  //   读成"换到备课、又重问了一遍"，而不是"我说了两遍"。
  ok('★ 换成备课：工位换过去了，那句话也还在',
     re && re.work === 'prep' && re.n >= 1, { 换之前: n5, 换之后: re && re.n, work: re && re.work });
  ok('★ 而且重发的这一条**跟原来那条分得开**（中间有一条接缝，不是"我说了两遍"）',
     re && re.seam >= 0 && re.在接缝前的 >= 1 && re.在接缝后的 >= 1,
     { 接缝在第几个: re && re.seam, 接缝上写的: re && re.seamTxt,
       接缝前: re && re.在接缝前的, 接缝后: re && re.在接缝后的 });

  // ============================================================
  //  ⑥ 首屏的排布：**一栏 + 居中**
  // ============================================================
  // ★★ 2026-10-03 重写。原来是 `for (const [w, cols] of [[900, 2], [620, 1]])` 在量"窄屏收列"——
  //   现在**首屏一律一栏**（css/main.css 里 `body[data-landing="1"] main{grid-template-columns:minmax(0,1fr)}`），
  //   那个期望已经不成立了。⚠ 留着它的坏处不是红：它只判了"没冒出去"，**照样全绿**，
  //   只在下面印一行「期望 2 列上下」的**假话**。下一个看这行字的人会照着它把两列改回去。
  //   （同族：记忆里"数字本身没错，错的是它量的那件事"。）
  //   现在量的是这趟真改掉的三件事：**一栏 / 居中 / 画板收起**。
  //   宽度取三档——**1400 是唯一能看出"居中"的那一档**（900 的封顶在窄屏根本不咬），
  //   900 / 620 是老本行"别冒出去"。
  console.log('\n⑥ 首屏排布：一栏 + 居中（1400 / 900 / 620）');
  for (const w of [1400, 900, 620]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await fresh();
    await wait(300);
    const g = await q(`(function(){
       var c=document.getElementById('lblocks'); if(!c) return null;
       var cr=c.getBoundingClientRect(); var over=[];
       Array.prototype.forEach.call(c.querySelectorAll('.lblock'),function(b){
         var r=b.getBoundingClientRect();
         if (r.right > cr.right + 0.5 || r.left < cr.left - 0.5) over.push(b.getAttribute('data-work'));
       });
       var mn=document.querySelector('main'), mr=mn.getBoundingClientRect();
       var col=document.querySelector('main .col:not(.side)'), cbr=col?col.getBoundingClientRect():null;
       var sd=document.querySelector('.side');
       return { cols: getComputedStyle(c).gridTemplateColumns.split(' ').length, over: over,
                colsSeen: c.querySelectorAll('.lblock').length, boxW: Math.round(cr.width),
                colW: cbr?Math.round(cbr.width):-1,
                leftGap: cbr?Math.round(cbr.left-mr.left):-1, rightGap: cbr?Math.round(mr.right-cbr.right):-1,
                sideSeen: !!sd && sd.getClientRects().length>0 };})()`);
    ok('  ' + w + 'px：首屏没有一块冒出去', g && g.over.length === 0, g && g.over);
    ok('  ' + w + 'px：首屏是**一栏**', g && g.cols === 1, g && g.cols);
    ok('  ' + w + 'px：对话框居中（左右留白差 ≤ 2px）',
       !!g && Math.abs(g.leftGap - g.rightGap) <= 2, { 左留白: g && g.leftGap, 右留白: g && g.rightGap });
    ok('  ' + w + 'px：画板收着（首屏那一栏是空出来的）', g && g.sideSeen === false, g && g.sideSeen);
    console.log('     ' + w + 'px：' + (g && g.cols) + ' 列，一栏容器宽 ' + (g && g.boxW) + 'px，'
              + '对话栏宽 ' + (g && g.colW) + 'px，左留白 ' + (g && g.leftGap) + ' / 右留白 ' + (g && g.rightGap));
  }
  // 宽屏那一档单独把"是不是正好 1000px"钉死（封顶只有宽屏才咬得住——
  // 窄屏两档量的是"没超"，量不出它到底封没封顶）。
  // ★ 2026-10-04：这个数从 900 改成 1000。原来首屏那一屏单有一条例外
  //   （`body[data-landing="1"] .col{max-width:900px}`），10-03 那条例外已删、
  //   并进 `main > .col` 的默认；10-04 孔老师又把默认从分档改成一律 1000。
  //   所以现在首屏跟别的屏**同一个数**——这行跟着改，不是放宽判据。
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await fresh(); await wait(300);
  const wide = await q(`(function(){ var c=document.querySelector('main .col:not(.side)');
     var sd=document.querySelector('.side');
     return { w: c?Math.round(c.getBoundingClientRect().width):-1,
              maxw: c?getComputedStyle(c).maxWidth:'',
              side: !!sd && sd.getClientRects().length>0 }; })()`);
  ok('★ 1400px 宽屏：对话栏正好封顶在 1000px（六个工位同一个数，首屏也不例外）', !!wide && wide.w === 1000, wide);
  ok('★ 1400px 宽屏：画板照样收着（宽了也不许把它放出来）', !!wide && wide.side === false, wide);
  await send('Emulation.clearDeviceMetricsOverride', {});

  // ---- 收尾：桩还回去、记忆原样写回 ----
  await q('(function(){ if(window.__origAsk) SR.api.ask=window.__origAsk; if(window.__origReady) SR.api.ready=window.__origReady; return 1 })()');
  // 开页前挪开的那份记忆，原样放回去（探针不许把老师的对话弄丢）
  if (开工前memo === null) await q("localStorage.removeItem('mathroot_memo')");
  else await q('(function(){try{localStorage.setItem("mathroot_memo",' + JSON.stringify(开工前memo) + ')}catch(e){}return 1})()');

  console.log('\n' + (FAIL ? '★ 红的 ' + FAIL + ' 条 / 共 ' + (PASS + FAIL) + ' 条' : '全绿：' + PASS + ' 条，红的 0 条'));
  await closeTab(t.id); ws.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('★ 探针自己炸了：' + (e && e.stack || e)); process.exit(2); });
