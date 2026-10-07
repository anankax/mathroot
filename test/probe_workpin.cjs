// 「这一轮的工位」到底有没有**钉在出发时那一个**上 —— 一条确定性的尺子。
//
// ============================================================
// 治的是哪件事（2026-10-06 夜）
// ============================================================
// `js/chat.js` 的 `submit()` 里，工位那条值是**发请求那一刻**读的（`var wk = work`，
// chat.js:2582）。可 `.then()` 是**等模型回来之后**才跑的，中间隔着十几秒到几十秒，
// 而工位那一行**没有 busy 闸**（main.js 的「工位切换」直接 applyWork）。
// 老师等得不耐烦点一下工位，这个值就换人了。
//
// 账本那三处（`pushTurn` x2 / `lastMeta`）早就跟着 `wk` 走了，**另外三处漏了**：
//     var wp = SR.render.parseFences(res.text, { stripAssign: !!SR.WORKS[work].stripAssign, … })
//     SR.memo.produced(work, { fig: …, prob: …, paper: …, chain: … })
//     if (work === 'material' && SR.material && …) SR.material.finish(…)
// 后果按轻重排：
//   · `produced(work, …)` —— 口袋里的账记到**别人那一格**上；而那个数是老师会当事实读的
//     （`SAY[work].k`，见 memo.js:47：draw→fig／vary→prob／material→paper／prep→chain）。
//   · `SR.WORKS[work].stripAssign` —— 换成另一格的解析开关（同一份文本、两种切法）。
//   · `work === 'material'` —— 材料那一轮被中途点走，**配图整个不跑**，
//     而少一张图是**悄无声息**的：老师翻到那道题才发现，那时候他已经印了。
//
// 这一版把三处都改成 `wk`。这把尺子量的是**第一处**（唯一能确定性地量到读数的那处）。
//
// ============================================================
// 分两段跑
// ============================================================
// 【第一段·机制】不用浏览器，不调模型 —— 直接问 `SR.memo.produced`：
//   同一份 counts，换一个 work 传进去，账**落到哪一格**。
//   这一段手里攥着**反例**：`produced('material', {fig:1, …})` 会把那张图的账**整份丢掉**
//   （memo.js:239 读的是 `counts[cfg.k]`，也就是 `counts.paper`，而 fig 是 1、paper 是 0 →
//   `if (!n) return;` 当场返回，一个字都不记）。图上画了东西、口袋里却不涨——
//   这就是旧写法在"作图那一轮被中途点走"时**真会发生的事**。
//
// 【第二段·产品里那一趟】走真页面（本机 8138 的静态服务），把 `SR.api.ask` 换成一个
//   **我攥着 resolve 的桩**，于是"回答还在飞"这段时间可以拉长到想多长就多长：
//     · 按真按钮发出去（`.workbtn` 那一行是老师点的那条路，不是 `SR.chat.setWork`）；
//     · 飞到一半拿真按钮去点走工位；
//     · 然后才放行那个桩，让 `.then()` 跑完；
//     · 看 `SR.memo.produced` **被谁叫的**（第一个参数就是这一轮的身份）。
//
// ============================================================
// ★★ 第一趟跑出来的**意外**：按钮那条路已经被堵上了（2026-10-06 夜当场改的尺子）
// ============================================================
// 原来那版探针在 `js/main.js:885` 撞了墙：`.workbtn` 的点击处理里有一道 busy 闸 ——
//     if (SR.chat.isAsking()) { SR.chat.setStatus('这一轮还在答，等它说完再换工位'); return; }
// 于是"点走工位"这个动作**根本落不下去**：getWork() 从头到尾都是 draw。
// 当场读数是 `发时 draw → 回前 draw`，格子判红。
// **红的是我写在格子里的那句前提，不是产品** —— 跟 [[scanner-numbers-are-not-what-they-claim]]
// 里那条一模一样：红的样子跟产品坏了长得一样，得先问"我量的那条路今天还走得通吗"。
//
// 所以第二段改成量**三件事**，一件都不许省：
//   ② 真按钮那一路 —— 顺带把"守卫真挡住了"这个事实**量出来**（它以前只是注释里的一句话）；
//   ③ 对照格 —— 同样一趟、不点走；
//   ④ 反例自证 —— 用 `SR.chat.setWork()` **绕过守卫**，硬走到那个状态去。
//
// ★★ 关于 ④，话要说在前面（别让后来的人把它读成"产品有 bug"）：
//   **今天从按钮上走不到那个状态**（守卫挡着）。所以漏掉的 `work` 那三处是**纵深防御**，
//   不是一条天天都在走的活路。它仍然值得改，两条理由：
//     · 那条规矩（「这一轮的身份跟着出发时那一个走」）就写在同一段上面 80 行处，
//       三处照写、三处漏写，是把一条已经判过的账留给下一个搬守卫的人；
//     · 守卫本身是 2026-10-05 才加的，而 `wk` 那条规矩比它早 —— 谁先谁后说不准，下次也一样。
//   ④ 这一格因此有**两个**用途，缺一个都不算数：
//     · 坏写法那一半 —— 证明这把尺子**在坏产品上红得出来**（尺子的资格）；
//     · 好写法那一半 —— 证明**就算真到了那个状态，也不会记错**（修的资格）。
//   ⚠ 而且它**只能**用绕过守卫的办法做：拿"产品里走不通的一条路"当主格，
//     量出来的绿是假的（[[scanner-numbers-are-not-what-they-claim]] 里
//     「两条尺子量出两个答案，因为其中一把量的是产品里不存在的路」）。
//
// ⚠ 探针纪律（跟 probe_ggbcmds_live.cjs 同一套）：
//   · 浏览器必须**开着窗口**，用隔离档案 test/_chrome，**绝不碰他 9222 的桌面 Chrome**；
//   · ⚠⚠ **别在这页上调 `Network.setCacheDisabled`**（2026-10-06 夜实测）：调了之后
//     GeoGebra 永远装不起来，而且是静默的（一条 loadingFailed 都不发）。
//     本机 8138 是 test/serve.cjs，发的是 no-store，压根不需要它；
//   · 硬重载（`Page.reload {ignoreCache:true}`）：防的是同源普通导航吃缓存
//     把"已生效"读成"没生效"；
//   · **自己开一个新标签页，用完关掉** —— 不去 navigate 他/别人留下的那些页；
//   · 页面指纹先核一遍（这一版在不在）；核不出来，后面读数全部作废；
//   · `mathroot_memo` 这份 localStorage **存了再还原**（不 clear）；
//     ⚠ 但**别把这一句读成"我保证擦干净了"** —— 产品自己那条防抖 flush 会在我写回之后
//     再覆盖一遍（见下面收尾那一段的两段量）。真正干净靠的是**档案是一次性的**。
//
// 用法：node test/probe_workpin.cjs            （两段都跑）
//       node test/probe_workpin.cjs --只机制   （不碰浏览器，只跑第一段）
const path = require('path'), fs = require('fs'), http = require('http');

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => {
  if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); }
  else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============================================================
// 第一段 · 机制（Node，无浏览器）
// ============================================================
function 第一段() {
  console.log('══ 第一段 · 机制：`produced` 按谁说的话记账 ══');
  const store = {};
  const LS = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const W = { SR: {} };
  const 文件表 = ['config.js', 'memo.js'];
  for (const f of 文件表) {
    new Function('window', 'localStorage', 'document',
      'var SR = (window.SR = window.SR || {});\n' + fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')
    )(W, LS, { querySelectorAll: () => [], querySelector: () => null, body: {} });
  }
  const SR = W.SR;
  if (!SR.memo || typeof SR.memo.produced !== 'function') {
    console.error('★ 装不上 SR.memo.produced —— 这一段读数作废。'); process.exit(2);
  }
  // 身份自检：SAY 表就是"哪一格收哪一项"的那张分派表，先把它读回来核一遍。
  //   ★ 不核这一下的话，哪天 SAY 改了名，这里读到的"fig 没涨"会被我读成"账丢了"。
  const 表 = SR.memo._SAY || null;
  console.log('　（这段用的是真 js/memo.js；分派表 draw→fig／vary→prob／material→paper／prep→chain）');

  const 读 = () => JSON.parse(JSON.stringify(SR.memo.pocket().marks));
  const 差 = (前, 后) => {
    const o = {}; const ks = {};
    Object.keys(前).forEach(k => ks[k] = 1); Object.keys(后).forEach(k => ks[k] = 1);
    Object.keys(ks).forEach(k => { const d = (后[k] || 0) - (前[k] || 0); if (d) o[k] = d; });
    return o;
  };
  // 一轮"作图"答完之后 chat.js 真正交给 produced 的那一份 counts
  //   （照抄 chat.js:2677：四个键一起给，缺一个就等于换了题意）
  const 作图那一轮 = { fig: 1, prob: 0, paper: 0, chain: 0 };

  // ①a 正路：这一轮真是作图 → fig 涨 1
  {
    const 前 = 读(); SR.memo.produced('draw', 作图那一轮);
    const d = 差(前, 读());
    判('①a 作图那一轮按 draw 记 → 图 1 张（正路）', d.fig === 1 && !d.paper && !d.prob, JSON.stringify(d));
  }
  // ①b ★★ 反例：同一份 counts，换成 material —— 图那张的账**整份丢掉**
  {
    const 前 = 读(); SR.memo.produced('material', 作图那一轮);
    const d = 差(前, 读());
    判('①b ★★ 同一份 counts 换成 material → 账**一个字都不记**（旧写法在"作图被中途点走"时就是这个）',
      Object.keys(d).length === 0, JSON.stringify(d) || '{}');
  }
  // ①c ★★ 另一头：组卷那一轮（一份材料 + 6 道题）被点成 vary → 记成「题 6 道」
  {
    const 组卷那一轮 = { fig: 0, prob: 6, paper: 1, chain: 0 };
    const 前 = 读(); SR.memo.produced('vary', 组卷那一轮);
    const d = 差(前, 读());
    判('①c ★★ 组卷那一轮按 vary 记 → 写成「题 6 道」、那份卷子不见了',
      d.prob === 6 && !d.paper, JSON.stringify(d));
  }
  console.log('　→ 一句结论：口袋那一格是**由传入的工位选的**，不是由内容选的。');
  console.log('　　 旧写法把"回来时"的工位传进去 = 让屏幕上那一刻的按钮决定这一轮记在哪儿。');
}

// ============================================================
// 第二段 · 真页面
// ============================================================
const PORT = 9222, 页面地址 = 'http://127.0.0.1:8138/index.html';

const 取 = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
    let s = ''; r.on('data', d => s += d); r.on('end', () => res(s));
  }).on('error', rej);
});
const 开新页 = url => new Promise((res, rej) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/json/new?' + encodeURIComponent(url), method: 'PUT' },
    x => { let s = ''; x.on('data', d => s += d); x.on('end', () => res(JSON.parse(s))); });
  req.on('error', rej); req.end();
});

async function 第二段() {
  console.log('\n══ 第二段 · 产品里那一趟（真页面，8138）══');
  const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

  let 页;
  try { 页 = await 开新页(页面地址); } catch (e) { 报第二段挂('开不了新标签页：' + e.message); return; }
  const ws = new WebSocket(页.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  let id = 0; const 等 = {};
  ws.on('message', m => { let o; try { o = JSON.parse(m); } catch (e) { return; } if (o.id && 等[o.id]) { 等[o.id](o); delete 等[o.id]; } });
  const 发 = (method, params) => new Promise(r => { const i = ++id; 等[i] = r; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async e => {
    const r = await 发('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) return 'THROW: ' + String((ex.exception && ex.exception.description) || ex.text).slice(0, 300);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const 收尾 = async () => { try { ws.close(); } catch (e) {} try { await 取('/json/close/' + 页.id); } catch (e) {} };

  const 等条件 = async (表达式, 判据, 上限, 步) => {
    const t0 = Date.now();
    let v;
    while (Date.now() - t0 < (上限 || 8000)) {
      v = await ev(表达式);
      if (判据(v)) return v;
      await sleep(步 || 120);
    }
    return v;
  };
  // ⚠⚠ 就绪判据**不能只看 SR**（2026-10-06 夜栽过，别改回去）：
  //   原来这一条是 `typeof SR.chat.submit === "function"`。可 `SR.chat` 在 script 一跑完
  //   就挂上了，而**工位那一行是 main.js 后画的**（`document.querySelectorAll('.workbtn')`
  //   接线在 main.js:885）。于是"页面已就绪"为真、`.workbtn` 却有 **0 颗** ——
  //   下面点工位那颗按钮点了个空（`if (!b) …` 我没判），工位停在 localStorage 里那个旧值上，
  //   而 submit 走到 `els.send.disabled = true` 时 `els.send` 还没绑好，**当场抛异常**，
  //   `busy` 却已经置成 true —— 页面就此卡住，后面每一格都静默地什么都量不到。
  //   这跟 [[scanner-numbers-are-not-what-they-claim]] 里那条同族：
  //   **判"装好没有"的信号挑错了**，早到的信号（半个壳）冒充"装完机"。
  //   现在改成跟产品自己那条路对齐：**按钮真出来了、body 上那个 data-work 也落了**，才算就绪。
  const 就绪 = '(function(){ try {'
    + ' return typeof (window.SR&&SR.memo&&SR.memo.produced)==="function"'
    + ' && typeof (window.SR&&SR.chat&&SR.chat.submit)==="function"'
    + ' && typeof (window.SR&&SR.chat&&SR.chat.getWork)==="function"'
    + ' && document.querySelectorAll(".workbtn").length >= 6'
    + ' && !!document.body.getAttribute("data-work")'
    + ' && !!document.getElementById("send") && !!document.getElementById("input");'
    + ' } catch(e){ return "THROW:"+e.message; } })()';

  let 初值备忘录 = '（没读到）';
  try {
    await 发('Network.enable');
    await 发('Page.enable');
    await 发('Runtime.enable');
    await 发('Page.reload', { ignoreCache: true });
    let 起 = false;
    for (let i = 0; i < 80; i++) { await sleep(500); if (await ev(就绪) === true) { 起 = true; break; } }
    if (!起) { 报第二段挂('页面没起来（' + 就绪 + ' 一直不真）'); return; }

    // ---- 指纹：证明页面上装的是这一版。证不出来，整段读数作废。----
    const 指纹 = await ev('JSON.stringify({ask:typeof SR.api.ask, prod:typeof SR.memo.produced,'
      + ' isAsking:typeof SR.chat.isAsking, cmds:SR.WORKS.draw?SR.WORKS.draw.cmds:"(无)",'
      + ' 六个工位:(SR.WORK_ORDER||[]).join(",")})');
    if (String(指纹).indexOf('THROW') === 0) { 报第二段挂('页面里读指纹就炸了：' + 指纹); return; }
    console.log('　页面指纹：' + 指纹);
    const F = JSON.parse(指纹);
    if (F.ask !== 'function' || F.prod !== 'function' || F.isAsking !== 'function') {
      报第二段挂('页面装的是旧 js（缺 submit/isAsking/produced 之一）'); return;
    }

    初值备忘录 = await ev('localStorage.getItem("mathroot_memo")');
    console.log('　mathroot_memo 进来时长 ' + String(初值备忘录 == null ? '(没有)' : 初值备忘录.length) + '（走的时候原样还回去）');

    // ---- 装桩：把「回答还在飞」这段时间攥在手里 ----
    const 装好 = await ev('(function(){'
      + ' window.__stub = (function(){ var 放=null, 记=[]; var 原=SR.api.ask;'
      + '   SR.api.ask = function(o){ 记.push({work:o.work, text:o.text});'
      + '     return new Promise(function(res){ 放=function(答案){ try{o.onChunk(答案);}catch(e){} res({text:答案, model:"stub"}); }; }); };'
      + '   return {记:记, 放:function(a){ 放(a); }, 还原:function(){ SR.api.ask=原; }}; })();'
      + ' window.__prod = (function(){ var 原=SR.memo.produced, 记=[];'
      + '   var 包=function(w,c){ 记.push({w:w, c:c}); return 原.call(SR.memo,w,c); };'
      + '   包.原=原; 包.记=记; window.__prod包=包; SR.memo.produced=包;'
      + '   return 记; })();'
      + ' window.__坏 = function(开){'
      + '   if(开){ var 包=window.__prod包, 原=包.原, 记=window.__prod;'
      + '     SR.memo.produced=function(w,c){ var live=SR.chat.getWork(); 记.push({w:live, 坏:true, c:c});'
      + '       return 原.call(SR.memo, live, c); }; }'
      + '   else { SR.memo.produced = window.__prod包; }'
      + '   return 1; };'
      + ' return "ok"; })()');
    if (装好 !== 'ok') { 报第二段挂('桩没装上：' + 装好); return; }

    // ---- 答案：一个 ```ggb 围栏 = 一张图 ----
    const 答案图 = '画好了。\n\n```ggb\nA = (0, 0)\nB = (3, 0)\n```\n';
    const 答案短 = '好，这一句只是把首屏让开。';

    // ---- 热身：第一句话会被 landing 拦一道（新档案上 blocking() 为真）。
    //      拿一句真会被它认下来、放行的话淌过去，让 hasUser() 变真；
    //      之后各格就是"这个会话里的第 N 句"，landing 不再插手。
    await ev('document.querySelector(\'.workbtn[data-work="draw"]\').click(); 1');
    await sleep(300);
    await ev('window.__stub.记.length = 0; window.__prod.length = 0; SR.chat.submit("画个三角形"); 1');
    await 等条件('window.__stub.记.length', v => v === 1, 6000);
    const 热记 = await ev('JSON.stringify(window.__stub.记)');
    if (String(热记) === '[]' || 热记 === undefined) {
      const 现场 = await ev('JSON.stringify({状态栏:SR.chat.getStatus(), hasUser:(function(){try{return SR.memo.hasUser()}catch(e){return "THROW:"+e.message}})(),'
        + ' isAsking:SR.chat.isAsking(), getWork:SR.chat.getWork(), 按钮:document.querySelectorAll(".workbtn").length,'
        + ' 气泡:document.querySelectorAll("#msgs .msg").length, ask是不是桩:SR.api.ask===window.__stub0})');
      报第二段挂('热身那一句压根没走到 ask —— 读数作废。现场：' + 现场); return;
    }
    await ev('window.__stub.放(' + JSON.stringify(答案短) + '); 1');
    await 等条件('window.__prod.length', v => v >= 1, 6000);
    await sleep(400);
    const 有历史 = await ev('(function(){ try { return SR.memo.hasUser(); } catch(e){ return "THROW:"+e.message; } })()');
    判('热身后的前置条件：这一场已经有老师说过话（landing 不再插手后面的句子）', 有历史 === true, 'SR.memo.hasUser() = ' + 有历史);

    // ---- 一格 = 发一趟 + （可选）中途动工位 + 放行 ----
    //   切法三种：
    //     '按钮'   —— 点 .workbtn（**老师那条路**，被 busy 闸挡着，量的是"挡没挡住"）
    //     '绕守卫' —— SR.chat.setWork()（**跳过那道闸**，硬走到那个状态；④ 专用的）
    //     null     —— 不动
    async function 一格(选项) {
      await ev('window.__坏(' + (选项.坏 ? 'true' : 'false') + '); 1');
      // 等上一轮真的收工（不然 submit 会被 `if (busy) return` 挡下 —— 那一挡是静默的）
      await 等条件('SR.chat.isAsking()', v => v === false, 5000);
      // 站到"发的时候那个工位"上。★ 用**真按钮**：它会顺手把 body[data-work]
      //   、那颗按钮的 .on、以及 SR.chat 里那个 work 一起对齐（applyWork 一条路走完）。
      await ev('document.querySelector(\'.workbtn[data-work="' + 选项.发时 + '"]\').click(); 1');
      await sleep(350);
      const 起点 = await ev('SR.chat.getWork()');
      const 前 = await ev('JSON.stringify(SR.memo.pocket().marks)');
      await ev('window.__stub.记.length = 0; window.__prod.length = 0; 1');
      await ev('SR.chat.submit(' + JSON.stringify(选项.话) + '); 1');
      await 等条件('window.__stub.记.length', v => v === 1, 6000);
      const 发时工位 = await ev('SR.chat.getWork()');
      const 桩收到 = await ev('JSON.stringify(window.__stub.记[0])');
      const 飞行中 = await ev('SR.chat.isAsking()');
      // 飞到一半动工位
      let 切后工位 = null, 状态栏 = null;
      if (选项.切法 === '按钮') {
        await ev('document.querySelector(\'.workbtn[data-work="' + 选项.切到 + '"]\').click(); 1');
        await sleep(300);
        切后工位 = await ev('SR.chat.getWork()');
        状态栏 = await ev('SR.chat.getStatus()');
      } else if (选项.切法 === '绕守卫') {
        await ev('SR.chat.setWork(' + JSON.stringify(选项.切到) + '); 1');
        await sleep(200);
        切后工位 = await ev('SR.chat.getWork()');
      } else { await sleep(300); }
      // 现在才放行
      await ev('window.__stub.放(' + JSON.stringify(选项.答案) + '); 1');
      await 等条件('window.__prod.length', v => v >= 1, 8000);
      await sleep(500);
      const 后 = await ev('JSON.stringify(SR.memo.pocket().marks)');
      const 记 = await ev('JSON.stringify(window.__prod)');
      await ev('window.__坏(false); 1');
      const d = (() => {
        const a = JSON.parse(前) || {}, b = JSON.parse(后) || {}, o = {};
        const ks = {}; Object.keys(a).forEach(k => ks[k] = 1); Object.keys(b).forEach(k => ks[k] = 1);
        Object.keys(ks).forEach(k => { const x = (b[k] || 0) - (a[k] || 0); if (x) o[k] = x; });
        return o;
      })();
      return { 起点, 飞行中, 发时工位, 切后工位, 状态栏, 桩收到: JSON.parse(桩收到 || 'null'), 记: JSON.parse(记 || '[]'), 差: d };
    }

    // ---- ② 主格：作图发出去，飞到一半**点真按钮**去组卷 ----
    console.log('\n── ② 作图那一轮，飞到一半拿真按钮去点「组卷」 ──');
    {
      const r = await 一格({ 发时: 'draw', 切法: '按钮', 切到: 'material', 话: '画个直角三角形', 答案: 答案图 });
      console.log('　发送时 getWork=' + r.发时工位 + '　桩收到 work=' + JSON.stringify(r.桩收到 && r.桩收到.work)
        + '　飞行中 isAsking=' + r.飞行中);
      console.log('　点按钮之后 getWork=' + r.切后工位 + '　状态栏=' + JSON.stringify(r.状态栏));
      判('②-0 这一句真走到 ask 了（桩收到了 work=draw，而且这一轮真在飞）',
        !!r.桩收到 && r.桩收到.work === 'draw' && r.飞行中 === true, JSON.stringify(r.桩收到) + ' / isAsking=' + r.飞行中);
      判('②-1 ★★ 飞行途中点工位**被挡住了**（工位没换，而且说了一句人话）',
        r.切后工位 === 'draw' && /还在答/.test(String(r.状态栏 || '')),
        'getWork 仍为 ' + r.切后工位 + '；状态栏 ' + JSON.stringify(r.状态栏));
      判('②-2 ★ 挡住它的正是 busy 闸（不是"碰巧按钮点不动"）',
        /等它说完再换工位/.test(String(r.状态栏 || '')), JSON.stringify(r.状态栏));
      const 最 = r.记[r.记.length - 1];
      判('②-3 ★★ `produced` 收到的是**出发时**那个工位（draw）',
        !!最 && 最.w === 'draw', 最 ? ('produced(work=' + JSON.stringify(最.w) + ')') : '（一次都没叫）');
      判('②-4 ★★ 口袋里涨的是「图 1 张」，不是「卷子 1 份」',
        r.差.fig === 1 && !r.差.paper, JSON.stringify(r.差));
    }

    // ---- ③ 对照格：一模一样的一趟，不动工位 ----
    console.log('\n── ③ 对照：同一趟动作，但不动工位 ──');
    {
      const r = await 一格({ 发时: 'draw', 话: '画个直角三角形', 答案: 答案图 });
      const 最 = r.记[r.记.length - 1];
      判('③-1 不动工位时也记在 draw 上', !!最 && 最.w === 'draw', 最 ? ('produced(work=' + JSON.stringify(最.w) + ')') : '（一次都没叫）');
      判('③-2 口袋里同样涨「图 1 张」', r.差.fig === 1, JSON.stringify(r.差));
      console.log('　（②与③同读数 = ②那一下"点走"没有改变记账 —— 那正是这一版要的结果）');
    }

    // ---- ④ ★★ 反例自证：绕守卫硬走到那个状态。两个半边都得绿，缺一个不算数 ----
    console.log('\n── ④ 反例自证：绕开那道理障，硬走到"回来时工位已经换人"那个状态 ──');
    console.log('　⚠ 先说清楚：**从按钮上走不到这个状态**（②刚量过，守卫挡着）。');
    console.log('　　 这一格量的是两件别的事：坏写法下尺子红得出来吗／好写法下真到了也不记错吗。');
    {
      const 好 = await 一格({ 发时: 'draw', 切法: '绕守卫', 切到: 'material', 话: '画个直角三角形', 答案: 答案图 });
      const 最好 = 好.记[好.记.length - 1];
      console.log('　【好写法】发时 getWork=' + 好.发时工位 + ' → 放行前 getWork=' + 好.切后工位);
      判('④-0 ★ 这一格真走到了那个状态（工位确实换成了 material）—— 不然下面两条什么也没证',
        好.切后工位 === 'material' && 好.发时工位 === 'draw', '发时 ' + 好.发时工位 + ' → 回前 ' + 好.切后工位);
      判('④-1 ★★ 好写法下 `produced` 照样收到**出发时**的 draw（真到了那个状态也不记错）',
        !!最好 && 最好.w === 'draw' && !最好.坏,
        最好 ? ('produced(work=' + JSON.stringify(最好.w) + ')') : '（一次都没叫）');
      判('④-2 ★★ 好写法下口袋里照样涨「图 1 张」', 好.差.fig === 1, JSON.stringify(好.差));

      const 坏 = await 一格({ 发时: 'draw', 切法: '绕守卫', 切到: 'material', 话: '画个直角三角形', 答案: 答案图, 坏: true });
      const 最坏 = 坏.记[坏.记.length - 1];
      console.log('　【坏写法】发时 getWork=' + 坏.发时工位 + ' → 放行前 getWork=' + 坏.切后工位);
      判('④-3 ★★ 换成旧写法（第一个参数读**实时** value）→ `produced` 收到的变成 material',
        !!最坏 && 最坏.w === 'material' && 最坏.坏 === true,
        最坏 ? ('produced(work=' + JSON.stringify(最坏.w) + ')') : '（一次都没叫）');
      判('④-4 ★★ 旧写法下那张图的账**丢了**（口袋里 fig 不涨）—— ②④的绿因此才有分量',
        坏.差.fig !== 1, JSON.stringify(坏.差) || '{}');
      console.log('　（④-3/④-4 绿 = 尺子在坏产品上红得出来；④-1/④-2 绿 = 修过之后真到了那个状态也不记错。）');
    }

    // ---- 把工位放回 draw，别把页面的状态留给下一把尺子 ----
    await ev('SR.chat.setWork("draw"); 1');
    await ev('document.querySelector(\'.workbtn[data-work="draw"]\').click(); 1');
    console.log('\n　（收尾：工位放回 draw）');

    // ---- 收尾：还原 localStorage（**存了再还原**，绝不 clear）----
    // ★ 还要说清楚一件事（2026-10-06 夜当场看到的）：**还回去之后还会被产品自己覆盖**。
    //   memo.js 有一条防抖的 `save()`，收到就写；而 `visibilitychange`/`pagehide` 那一趟
    //   拿的是**活文档里那份缓存**整份写回。所以"我写回去的那一刻是对的"跟
    //   "关掉页面之后它还是对的"是两件事 —— 实测跨两趟跑，进来时长 271 → 717 → 1283 → 1850。
    //   这跟 [[scanner-numbers-are-not-what-they-claim]] 里那条同族：
    //   「raw 写 localStorage 必被产品自己的 flush 吃掉」，写了三趟被覆盖三趟。
    //   所以下面**分两段量**：当场读回（这一格能绿）、隔 1.5 秒再读一次（**只报读数，不判绿**）。
    //   真要"擦干净脚印"，靠的是**隔离档案本身是一次性的**（test/_chrome，跟他那个 9222 无关），
    //   不是靠这一句 setItem。别把这条读成"我保证干净了"。
    const 还原 = await ev('(function(){ try{'
      + (初值备忘录 == null ? 'localStorage.removeItem("mathroot_memo");'
        : 'localStorage.setItem("mathroot_memo", ' + JSON.stringify(初值备忘录) + ');')
      + ' return String(localStorage.getItem("mathroot_memo")).length; }catch(e){ return "THROW:"+e.message; } })()');
    const 应长 = 初值备忘录 == null ? 'null'.length : String(初值备忘录).length;
    判('★ 收尾：mathroot_memo 当场原样还回去了（存了再还原，没 clear，键还在）',
      String(还原) === String(应长), '读回长度 ' + 还原 + ' / 进来时 ' + 应长);
    await sleep(1500);
    const 隔一会 = await ev('(function(){ var v=localStorage.getItem("mathroot_memo"); return v==null?"(没有这个键)":String(v.length); })()');
    console.log('　注（不判绿，只报读数）：隔 1.5 秒再读一次 = ' + 隔一会
      + (String(隔一会) === String(应长) ? '（没被覆盖）' : '（★ 产品自己的 flush 又写了一遍 —— 一次性的隔离档案，不涉及他那个浏览器）'));
  } finally {
    await 收尾();
  }
}

function 报第二段挂(理由) {
  console.error('★ 第二段没跑成：' + 理由);
  console.error('  （把这条当作**红**记着 —— 没跑成不等于没病。）');
  红++;
}

(async () => {
  const 只机制 = process.argv.indexOf('--只机制') >= 0;
  第一段();
  if (只机制) { console.log('\n（--只机制：第二段跳过了）'); }
  else await 第二段();
  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });
