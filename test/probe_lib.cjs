// 量「查」这条围栏 —— 模型自己发起的一次查库（js/render.js 解析 + js/chat.js 的 补查）。
//
// ★★ 这条探针要证的**最要紧那件事**，不是"它会不会查"，而是这六件：
//    ① 六个工位**一视同仁**：读库不是备课／讲评两格的私产（那两格是靠 SR.WORKS[x].retrieve
//       自动翻的，另四格一个请求都不发）。这里每一格都要真查出一次来。
//    ② 第二轮模型调用**真的发生**（不是"产品自己编了一句像查过的话"）。
//    ③ 命中块的正文**真的发出去了**（在第一轮那一发里**找不到**，第二轮那一发里找得到）。
//    ④ 第二段话**接在同一个气泡里**（不是新开一个气泡，也不是只在账本里）。
//    ⑤ 一轮最多查一次（写两个围栏也只查一趟，且查的是**最后一个**）。
//    ⑥ **不写围栏的那一轮，一次额外调用都不许发生**（这是"闸"那一半）。
//
// ⚠ 方案里我原本写的判据是「命中块进没进第二次的 **system**」。**实测不是**：
//   `补查` 把命中块拼进的是 `opts.text`（那段「这是你自己刚才要查的」指令），
//   也就是**第二次那一发的 user 消息**，不是 system。所以这里量的就是 user，
//   而且顺带量了一发「第一轮那一发里绝找不到它」——
//   不这么对照的话，"找得到"可能只是因为它本来就在别处（那是一条恒绿）。
//   ★ 这是探针的读数纠正了写方案时的假设，不是产品错了。
//
// ⚠ 探针纪律（跟 probe_libpanel.cjs 同一套，别动）：
//   · 浏览器必须**开着窗口**（不带 --headless），隔离档案 test/_chrome，绝不碰他桌面那个 Chrome；
//   · 每轮之前**硬重载一次**（`Page.reload {ignoreCache:true}`）——dev server 发 no-store
//     （见 test/serve.cjs），但这个动作本身要留着；
//   · ⚠⚠ **本探针不碰 `Network.setCacheDisabled`**（2026-10-06 夜实测它会让
//     `window.ggbApplet` 永远停在 undefined，见 probe_ggbcmds_live.cjs 顶上那段）。
//     这一版不量画板，但别把这行加回来——下一个复制这份探针去量画板的人会中招。
//     要计请求数走**包一层 window.fetch**，跟 Network 域没关系。
//
// ★★ 桩必须**照着产品的合同演**（[[scanner-numbers-are-not-what-they-claim]]：
//   "桩不照产品合同演→一个病根长出三件'产品坏了'"）：
//   · 真模型那条合同是 **SSE**：`r.body.getReader()` 逐帧读，
//     每一帧是 `data: {"choices":[{"delta":{"content":"…"}}]}`，末尾 `data: [DONE]`。
//     只 `Promise.resolve({text})` 是**不行的**——`api.js` 收流那一段会拿到 undefined。
//   · 所以桩包的 `fetch` 回的是一颗**真的 `Response`**（真 ReadableStream），
//     让**真的 `ask` / `buildSystem` 整条跑完**。这样量到的"第二段"是产品自己收的，
//     不是我伪造的字符串。
//   · 桩只拦 `SR.BACKENDS[*].url` 那几个地址；别的一律放行（知识库、教材索引照旧走真网络）。
//
// ★★ 一条刻意的隔离：**六条桩回复里一条 ```ggb 都不给**。
//   给了就会走「画板没认 → 让模型自己改一趟」（js/chat.js 的 试自修），
//   那是**另一条**也会多发一次模型调用的路，会把"调了几次"这个读数搅浑。
//   不给围栏 ⟹ `msg.ggbDone` 是 0 ⟹ `试自修` 头一句就 return（见 js/chat.js:2310）。
//   这条围栏跟画板没关系，本来就是文字那一档，所以不算回避。
//
// ★★ 反例（群 5）刻意**从磁盘现读的源码**上造，而且**装完读回来核**
//   （源码里塞一句 `SR.render.__坏 = '坏N'`，读不到就是没装上，这一轮作废）：
//   同族的坑是"编辑打空、验的却是没改过的那份"，以及 `git show HEAD:` 那种会随提交漂走的基准。
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) }); r.on('error', rej); r.end() });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let 绿 = 0, 红 = 0, 判错 = [];
const 判 = (名, 真, 值) => {
  if (真) { 绿++; console.log('  ✅ ' + 名 + (值 !== undefined ? '   ' + JSON.stringify(值) : '')) }
  else { 红++; 判错.push(名); console.log('  ❌ ' + 名 + (值 !== undefined ? '   ' + JSON.stringify(值) : '')) }
};

// ---- 页面侧那几件工具（一次注入，反复用）----
// ⚠⚠ 这一段是 **String.raw** 模板：里面的 `\n` 会**原样**留在页面源码里当转义序列，
//   这正是我要的（页面那边的字符串字面量需要 `\n`）。代价是**一个反引号都不许有**——
//   有就当场把外面这个模板掐断（这个坑在 libui.js / probe_libpanel.cjs 里各踩过一次）。
const 页面工具 = String.raw`
window.__模 = [];        // 每一次发往模型服务器的调用
window.__待答 = [];      // 桩按顺序回的正文
window.__调 = { reslib: [] };

window.__造流 = function(文本){
  var enc = new TextEncoder();
  return new ReadableStream({ start: function(c){
    var i = 0;
    while (i < 文本.length) {
      var 片 = 文本.slice(i, i + 9); i += 9;
      c.enqueue(enc.encode('data: ' + JSON.stringify({choices:[{delta:{content:片}}]}) + '\n\n'));
    }
    c.enqueue(enc.encode('data: [DONE]\n\n'));
    c.close();
  }});
};
if (!window.__包过模型) {
  window.__包过模型 = true;
  var 原fetch = window.fetch;
  window.fetch = function(url, init){
    var u = String((url && url.url) || url || '');
    var 是 = false;
    try {
      var bs = SR.BACKENDS || {};
      for (var k in bs) { if (bs[k] && bs[k].url && u.indexOf(bs[k].url) === 0) { 是 = true; break } }
    } catch (e) {}
    if (!是) return 原fetch.apply(this, arguments);
    var o = {};
    try { o = JSON.parse(String((init && init.body) || '{}')) } catch (e) { o = {} }
    window.__模.push({
      url: u, model: o.model || '',
      条: (o.messages || []).map(function(m){
        return { role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }
      })
    });
    var 答 = window.__待答.length ? window.__待答.shift() : { text: '（桩没给这一档）' };
    return Promise.resolve(new Response(window.__造流(String(答.text || '')),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
  };
}
window.__桩答 = function(列表){ window.__待答 = 列表.slice(); window.__模 = []; return 1 };
window.__调用清 = function(){ window.__调.reslib = []; return 1 };

// 库桩：第 n 次被调 → 正文里带 ZHA<n>BB 这个记号。★ 记号带上**调用序号**是关键——
//   "命中块进没进这一发"必须拿**这一次**那一块去认，不然命中的是别人那次翻的东西。
window.__布库桩 = function(){
  SR.gate.reslib = function(q, k){
    var n = window.__调.reslib.length;
    window.__调.reslib.push([q, k]);
    return Promise.resolve({ ok: true, rows: 7706, hits: [{
      id: 1, doc: '[宜兴东氿中学]/02-东氿自家学案/桩材料.docx',
      title: '[宜兴东氿中学]/02-东氿自家学案/桩材料.docx',
      shelf: '学案', page: 3, key: '02-东氿自家学案/桩材料.docx', score: 11.5,
      body: 'ZHA' + n + 'BB 这一段是库里那份学案里的正文。'
    }] });
  };
  return 1;
};
window.__B3 = String.fromCharCode(96, 96, 96);
window.__围 = function(词){ return window.__B3 + '查' + '\n' + 词 + '\n' + window.__B3 };
window.__气泡 = function(){ return document.querySelectorAll('#msgs .msg.assistant').length };
window.__末气泡 = function(){
  var a = document.querySelectorAll('#msgs .msg.assistant'); if (!a.length) return '';
  var b = a[a.length - 1].querySelector('.bubble');
  return b ? String(b.innerText || '') : '';
};
// ⚠ 气泡底下那条补话（localnote 这个 class）：产品是**每说一句就 append 一个 p**（见 js/chat.js
//   noteUnder，注释还专门写了"挂在气泡外面，气泡 innerHTML 会被整块换掉"）。
//   所以"最后那句"要取 querySelectorAll 的**末一个** —— 第一版这里写的是 querySelector，
//   那是**头一个**：名字叫"末注"，量的却是"首注"，读数看着完全合情合理，
//   于是把产品**明明说了**的"翻到了 N 段：…"读成"没说"，白白红了一条
//   （[[scanner-numbers-are-not-what-they-claim]]：错的是它量的那个东西）。
window.__注们 = function(){
  var a = document.querySelectorAll('#msgs .msg.assistant'); if (!a.length) return [];
  var n = a[a.length - 1].querySelectorAll('.localnote'), s = [];
  for (var i = 0; i < n.length; i++) s.push(String(n[i].textContent || ''));
  return s;
};
window.__末注 = function(){
  var n = window.__注们();
  return n.length ? n[n.length - 1] : '';
};
window.__含 = function(s, t){ return String(s == null ? '' : s).indexOf(String(t)) >= 0 };

// ★★ 把读数**在页面里算完再交回来**：真发出去的那几发 body 一份好几万字，
//   整份拎回 Node 会当场把我的上下文撑爆（顺带也看不清真正要看的那两位）。
//   所以下面只回"有没有 / 第几次 / 几个"。
window.__析 = function(围栏词, 甲, 乙){
  var 模 = window.__模, 调 = window.__调.reslib;
  var 某角色 = function(m, role){
    if (!m) return '';
    var s = '';
    for (var i = 0; i < m.条.length; i++) if (m.条[i].role === role) s = m.条[i].content;
    return s;
  };
  var 全 = function(m){
    if (!m) return '';
    var a = [];
    for (var i = 0; i < m.条.length; i++) a.push(m.条[i].role + '@' + m.条[i].content);
    return a.join('\u0003');
  };
  var 词位 = -1;
  for (var i = 0; i < 调.length; i++) if (调[i][0] === 围栏词) 词位 = i;
  var 令 = 词位 < 0 ? '' : ('ZHA' + 词位 + 'BB');
  var m0 = 模[0] || null, m1 = 模[1] || null;
  var 末 = window.__末气泡();
  var sys = String(SR.api.lastSystem || '');
  return {
    模数: 模.length,
    库数: 调.length,
    库词: 调.map(function(x){ return x[0] }),
    词位: 词位,
    令牌: 令,
    一含令: 令 ? window.__含(全(m0), 令) : null,
    二含令: 令 ? window.__含(全(m1), 令) : null,
    二用户含令: 令 ? window.__含(某角色(m1, 'user'), 令) : null,
    一里有甲: !!m0 && window.__含(某角色(m0, 'assistant'), 甲),
    二里有甲: !!m1 && window.__含(某角色(m1, 'assistant'), 甲),
    气泡: window.__气泡(),
    气泡有甲: window.__含(末, 甲),
    气泡有乙: window.__含(末, 乙),
    气泡有围栏词: window.__含(末, 围栏词),
    末注: window.__末注().slice(0, 90),
    注数: window.__注们().length,
    首注: (window.__注们()[0] || '').slice(0, 90),
    sys长: sys.length,
    sys含令: 令 ? window.__含(sys, 令) : null
  };
};

// ---- 换模块（反例用）。★ 装完**读回来核**，读不到那个记号这一轮作废。----
window.__装 = function(src, mark){
  var f = new Function(src
    + '\n; if (SR.render) SR.render.__坏 = ' + JSON.stringify(mark)
    + '; if (SR.chat) SR.chat.__坏 = ' + JSON.stringify(mark) + ';');
  f();
  var a = SR.render && SR.render.__坏, b = SR.chat && SR.chat.__坏;
  return (a === mark || b === mark) ? mark : ('__没装上(render=' + a + ',chat=' + b + ')');
};
// 换 chat.js 之前得把**它挂了监听的节点**换新：旧监听绑在旧节点上，
// 不换掉的话新模块 init 一次、旧监听还响着，量到的是两套在打架。
window.__装聊天 = function(src, mark){
  var ids = ['send','input','attach','file','btn-play','btn-redraw','btn-clear','btn-png',
             'btn-next','btn-prev','btn-reset'];
  for (var i = 0; i < ids.length; i++) {
    var o = document.getElementById(ids[i]); if (!o) continue;
    var c = o.cloneNode(true); o.parentNode.replaceChild(c, o);
  }
  var r = window.__装(src, mark);
  if (r === mark) SR.chat.init();
  return r;
};
`;

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => {
    let o; try { o = JSON.parse(m); } catch (e) { return }
    if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] }
  });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Page.bringToFront', {});
  // ⚠ 这行**故意没有** `Network.setCacheDisabled`，理由见文件顶上。别顺手加回来。
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) return 'THROW: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 300);
    return R && R.result ? R.result.value : null
  };
  // ★★ 判据一律 `=== true`（[[scanner-numbers-are-not-what-they-claim]]：
  //   真值字符串当循环条件 —— q() 抛异常回的 `'THROW: …'` 是真值，会当场放行）。
  const 等真 = async (式, 秒, 步) => { const n = Math.round(秒 * 1000 / (步 || 300)); for (let i = 0; i < n; i++) { if (await q(式) === true) return i * (步 || 300); await sleep(步 || 300) } return -1 };
  const 拍 = async 名 => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r && r.result && r.result.data) {
      fs.mkdirSync(path.join(__dirname, '_shots'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '_shots', 名), Buffer.from(r.result.data, 'base64'));
      return 名
    }
    return '(没拍到)'
  };
  const 硬重载 = async () => { await send('Page.reload', { ignoreCache: true }); await sleep(400) };

  // ★★ 2026-10-07：把后端**钉回默认那一个**，而且把这件事**读回来核**。
  //   起因（实测，不是猜的）：探针档案 `test/_chrome` 是**跨会话活着**的，
  //   `mathroot_backend` 里存着上一次留下的 `'deepseek'`。DeepSeek 的钥匙只存在
  //   使用者自己的浏览器里 —— 探针档案里**没有**，于是：
  //       `SR.api.ready()` 为 false（js/api.js:39-40：ready 就是"钥匙长度 > 10"）
  //     → `submit()` 在 `if (!SR.api.ready()) { SR.main.needKey(); return; }` 当场退掉
  //     → **一次网络都不发**，气泡里只剩开场白，33 条一起红。
  //   红的样子跟"「查」这条围栏根本没做出来"长得**一模一样**，可产品是对的，
  //   坏的是"这一轮的前提"。（[[scanner-numbers-are-not-what-they-claim]]：
  //   产品自己把状态跨刷新存着 ⇒ 空读数比假红更阴。）
  //   ⇒ 每轮开头钉一次；钉完**读回来核**，核不过就作废，绝不拿它算红。
  const 定后端 = async () => {
    await q(`(function(){
      try {
        if (SR.LS_BACKEND) localStorage.setItem(SR.LS_BACKEND, SR.DEFAULT_BACKEND);
        if (SR.api.setBackend) SR.api.setBackend(SR.DEFAULT_BACKEND);
      } catch (e) {}
      return 1;
    })()`);
    return await q('(function(){ return { 后端: (function(){try{return localStorage.getItem(SR.LS_BACKEND)}catch(e){return "?"}})(), 默认: SR.DEFAULT_BACKEND, ready: SR.api.ready() } })()');
  };

  const 起式 ='(function(){ try { return !!(typeof SR !== "undefined" && SR.api && SR.WORKS && SR.chat'
    + ' && SR.gate && SR.landing && SR.render && SR.memo'
    + ' && typeof SR.chat.submit === "function" && typeof SR.chat.isAsking === "function"'
    + ' && document.querySelectorAll("#works .workbtn").length >= 6'
    + ' && !!document.getElementById("input")) } catch(e){ return false } })()';
  const 开机 = async (重) => {
    if (重) await 硬重载();
    const r = await 等真(起式, 40, 500);
    if (r < 0) return false;
    await q(页面工具);
    await q('window.__布库桩()');
    await sleep(200);
    return true;
  };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html?probe=lib&t=' + Date.now() });
  await sleep(500);
  const 起 = await 等真(起式, 40, 500);
  console.log('等开机 ' + 起 + 'ms');
  if (起 < 0) { console.log('★ 没起来，本次不作数'); ws.close(); process.exit(3) }
  await q(页面工具);
  await q('window.__布库桩()');
  await sleep(200);
  const 后端0 = await 定后端();
  console.log('  后端钉在 ' + (后端0 && 后端0.后端) + '（默认 ' + (后端0 && 后端0.默认) + '），ready=' + (后端0 && 后端0.ready));
  if (!后端0 || 后端0.ready !== true) {
    console.log('★ 后端没钉住 / 没钥匙 ⇒ 这一轮一次网络都不会发，33 条全会是假红。本次作废，先修环境。');
    ws.close(); process.exit(3);
  }
  const 桩装好 = await q('(function(){ return { 包过: window.__包过模型 === true, 库桩: typeof SR.gate.reslib === "function", B3: window.__B3.length } })()');
  判('0.1 桩装好了：fetch 包过、库桩换上了、"三个反引号"那三个字符是现拼的（源码里一个都没写）',
    桩装好 && 桩装好.包过 === true && 桩装好.库桩 === true && 桩装好.B3 === 3, 桩装好);

  // ──────────────────────────────────────────────────────────
  // 一轮的跑法。**每一轮之前都硬重载**（探针纪律），所以桩、库桩、页面工具每轮都要重装。
  // ──────────────────────────────────────────────────────────
  const 甲 = 'AQ先把这条捋一捋。';       // 第一段的记号
  const 乙 = 'BQ接着上面：库里那份材料说';  // 第二段的记号

  async function 跑一轮(wk, 文本, 围栏词, 桩答, 期望模数) {
    await 硬重载();
    const r = await 等真(起式, 40, 500);
    if (r < 0) return { 没起来: true };
    // ★ 钉后端 + 核（理由见 `定后端` 顶上那段）。核不过**当场作废**，不往下量。
    const 后端 = await 定后端();
    if (!后端 || 后端.ready !== true) return { 前提不成立: true, 后端: 后端 };
    await q(页面工具);
    await q('window.__布库桩()');
    await sleep(150);
    // 清场：记忆清掉 → 切工位 → reset（reset 里 history = SR.memo.history() 就是空的）
    await q('(function(){ SR.memo.clear(); return 1 })()');
    await q(`(function(){ SR.main.applyWork(${JSON.stringify(wk)}); return 1 })()`);
    await sleep(500);
    await q('(function(){ if (SR.landing && SR.landing.hide) SR.landing.hide(); return 1 })()');
    await q(`(function(){ SR.chat.reset(${JSON.stringify(wk)}, {wipe:true}); return 1 })()`);
    await sleep(350);
    await q(`window.__桩答(${JSON.stringify(桩答)})`);
    await q('window.__调用清()');
    await sleep(150);

    // 前置：工位对得上、历史是空的、而且这一句话**不会**被 landing 中途换走工位。
    //   ★ 最后那一条是必须的：`intercept()` 开场之后每轮都调 `该换吗`，
    //     真被它换走，这一轮量的就是**另一个工位**的读数（读数看着完全正常）。
    const 前 = await q(`(function(){
      var t = ${JSON.stringify(文本)};
      return { 工位: SR.chat.getWork(), 盼: ${JSON.stringify(wk)},
               有user: SR.chat.hasUser(), 气泡: window.__气泡(),
               路: SR.landing.route(t).work, 旧分: SR.landing.score(t)[${JSON.stringify(wk)}] || 0,
               ready: SR.api.ready(), 后端: (function(){try{return localStorage.getItem(SR.LS_BACKEND)}catch(e){return "?"}})() };
    })()`);
    if (!前 || 前.ready !== true || 前.工位 !== wk || 前.有user !== false || 前.旧分 < 4) {
      判('【' + wk + '】前置：后端能用（ready）、工位=' + wk + '、历史空、这句话里本工位站得住脚', false, 前);
      return { 前提不成立: true, 前: 前 };
    }
    await q(`(function(){ SR.chat.submit(${JSON.stringify(文本)}); return 1 })()`);
    await sleep(500);
    const 等 = await 等真('(function(){ return SR.chat.isAsking() === false && window.__模.length >= '
      + 期望模数 + ' })()', 45, 250);
    await sleep(600);
    return await q(`window.__析(${JSON.stringify(围栏词)}, ${JSON.stringify(甲)}, ${JSON.stringify(乙)})`);
  }

  // 围栏：```查 ⏎ 词 ⏎ ```（**闭合的**那种；缺尾那一档在群 5 里单独拼）
  const 围 = 词 => '```查\n' + 词 + '\n```';
  const 造答1 = 块 => 甲 + '\n\n待我去库里翻一翻。\n\n' + 块 + '\n\n好，先说到这儿。';
  const 造答2 = () => 乙 + '，这一步要先把条件摆出来，再往下推。';

  const 工位单 = [
    { wk: 'prep',     文本: '备课：一元二次方程怎么引入', 词: '查词01判别式' },
    { wk: 'draw',     文本: '作图：画个数轴',             词: '查词02数轴' },
    { wk: 'vary',     文本: '出题：来两道变式',           词: '查词03变式' },
    { wk: 'material', 文本: '组卷：出一份卷子',           词: '查词04中考卷' },
    { wk: 'grade',    文本: '学情：排个序',               词: '查词05得分率' },
    { wk: 'review',   文本: '讲评：这份卷子怎么看',       词: '查词06错因' }
  ];

  // ──────────────────────────────────────────────────────────
  console.log('\n════════ 1. 先量一格（组卷）：把这条链的每个环节都对一遍 ════════');
  const 单 = await 跑一轮('material', 工位单[3].文本, 工位单[3].词,
    [{ text: 造答1('```查\n' + 工位单[3].词 + '\n```') }, { text: 造答2() }], 2);
  console.log('   ' + JSON.stringify(单));
  if (单.没起来 || 单.前提不成立) { console.log('★ 第一轮就没跑成，本次不作数'); ws.close(); process.exit(3) }
  判('1.1 第一发 + 第二发 = 模型被调了 2 次（第二次**真发生了**，不是它自己编了一句像查过的话）',
    单.模数 === 2, 单.模数);
  判('1.2 组卷这一格（SR.WORKS 里 retrieve 是假的那四格之一）也真去翻库了：库被调 1 次',
    单.库数 === 1 && 单.库词[0] === 工位单[3].词, { 库数: 单.库数, 库词: 单.库词 });
  判('1.3 ★ 翻出来的那一块**真进了第二发**（第二轮那一发里找得到它的记号）',
    单.二含令 === true && 单.令牌 !== '', { 令牌: 单.令牌, 二含令: 单.二含令 });
  判('1.4 [对照，防恒绿] 同一块在**第一发**里找不到 —— 所以 1.3 不是"它本来就在别处"',
    单.一含令 === false, { 一含令: 单.一含令 });
  判('1.5 命中块拼进的是第二发的 **user 消息**（那段"这是你自己刚才要查的"指令），不是 system',
    单.二用户含令 === true && 单.sys含令 === false, { 二用户含令: 单.二用户含令, sys含令: 单.sys含令 });
  判('1.6 第二发里带着**它自己刚说的那半句**（assistant 那条），话才接得上',
    单.二里有甲 === true, { 二里有甲: 单.二里有甲 });
  判('1.7 ★ 第二段话接在**同一个气泡**里：行数只多 1，而且气泡里两段都在',
    单.气泡 === 2 && 单.气泡有甲 === true && 单.气泡有乙 === true,
    { 气泡: 单.气泡, 有甲: 单.气泡有甲, 有乙: 单.气泡有乙 });
  判('1.8 围栏本身**没印给老师看**（那三行被摘干净了）',
    单.气泡有围栏词 === false, { 气泡里有围栏词: 单.气泡有围栏词 });
  判('1.9 ★ 气泡底下补了两句、而且是**按顺序**补的：先说"我去翻翻"，翻完**改口说结果**'
    + '（"翻到了 1 段：…"还带着出处）',
    单.注数 === 2 && 单.首注.indexOf('我去资料库翻翻') > 0
      && 单.末注.indexOf('翻到了 1 段') === 0 && 单.末注.indexOf('桩材料.docx') > 0,
    { 注数: 单.注数, 首注: 单.首注, 末注: 单.末注 });
  console.log('   截图 ' + await 拍('查围栏_同一气泡.png'));

  // ──────────────────────────────────────────────────────────
  console.log('\n════════ 2. 六个工位一视同仁：每一格都真翻一次 ════════');
  for (let i = 0; i < 工位单.length; i++) {
    const s = 工位单[i];
    if (s.wk === 'material') continue;                 // 上面那一格已经量过了
    const 退 = await q(`(function(){ return !!((SR.WORKS[${JSON.stringify(s.wk)}]||{}).retrieve) })()`);
    const 期库 = (退 === true ? 2 : 0) + 1;            // 退=true 的格子：产品自己那一趟 + 补查 → 这一轮库里共 2 下
    const r = await 跑一轮(s.wk, s.文本, s.词, [{
      text: 造答1('```查\n' + s.词 + '\n```')
    }, { text: 造答2() }], 2);
    if (r.没起来 || r.前提不成立) { 判('【' + s.wk + '】这一轮跑不起来', false, r); continue }
    判('2.' + i + ' 【' + s.wk + '】模型 2 次 / 库 ' + 期库 + ' 下（retrieve=' + 退 + '）/ 命中块进了第二发',
      r.模数 === 2 && r.库数 === 期库 && r.二含令 === true && r.一含令 === false,
      { 模数: r.模数, 库数: r.库数, 期库: 期库, 二含令: r.二含令, 一含令: r.一含令, 库词: r.库词 });
    判('2.' + i + 'b 【' + s.wk + '】第二段照旧接在同一个气泡里、围栏没印出来',
      r.气泡 === 2 && r.气泡有甲 === true && r.气泡有乙 === true && r.气泡有围栏词 === false,
      { 气泡: r.气泡, 有甲: r.气泡有甲, 有乙: r.气泡有乙, 围栏词: r.气泡有围栏词 });
  }

  // ──────────────────────────────────────────────────────────
  console.log('\n════════ 3. 不写围栏的那一轮：一次额外调用都不许发生 ════════');
  const 静 = await 跑一轮('material', '组卷：出一份卷子', '查词07绝对没有',
    [{ text: 甲 + '\n\n就是这一句，我没有要翻的东西。' }], 1);
  if (静.没起来 || 静.前提不成立) { 判('【对照】没写围栏那一轮跑不起来', false, 静) }
  else {
    判('3.1 ★ 没写围栏 → 模型只被调 1 次（第二次调用**没有发生**）', 静.模数 === 1, 静.模数);
    判('3.2 ★ 而且库一下都没被碰（组卷这一格本来就不自动翻）', 静.库数 === 0, 静.库数);
    判('3.3 气泡里就是那一段，没有多出第二段',
      静.气泡 === 2 && 静.气泡有甲 === true && 静.气泡有乙 === false,
      { 气泡: 静.气泡, 有甲: 静.气泡有甲, 有乙: 静.气泡有乙 });
  }

  // ──────────────────────────────────────────────────────────
  console.log('\n════════ 4. 一轮最多查一次：写两个围栏也只查一趟，且查的是**最后**那个 ════════');
  const 双 = await 跑一轮('material', '组卷：出一份卷子', '查词09后一个',
    [{ text: 甲 + '\n\n待我去库里翻一翻。\n\n'
        + '```查\n查词08前一个\n```\n\n' + '```查\n查词09后一个\n```\n\n' }, { text: 造答2() }], 2);
  if (双.没起来 || 双.前提不成立) { 判('【双围栏】跑不起来', false, 双) }
  else {
    判('4.1 ★ 两个围栏 → 库**只被调 1 次**（不是两次）', 双.库数 === 1, 双.库词);
    判('4.2 ★ 查的是**最后一个**围栏（`补查` 取 p.cha 的末条）',
      双.库词.length === 1 && 双.库词[0] === '查词09后一个', 双.库词);
    判('4.3 模型照旧 2 次、第二段照旧并回同一个气泡',
      双.模数 === 2 && 双.气泡 === 2 && 双.气泡有乙 === true,
      { 模数: 双.模数, 气泡: 双.气泡, 有乙: 双.气泡有乙 });
  }

  // ──────────────────────────────────────────────────────────
  console.log('\n════════ 5. 流被截断、围栏没收口 —— 收尾那一遍也得认 ════════');
  // ★ 这一格量的是 render.js 那条「缺查」兜底。**它必须单独量**：
  //   闭合的围栏走主正则那条路，缺尾的走收尾那条路 —— 两条路都得通，
  //   只测闭合的那种，等于把"模型少打三个反引号"这半边的失败放走了。
  //
  // ★★★ 2026-10-07 首跑：5.1 绿、**5.2 红**（`有乙:false`）—— 这是**产品真 bug**，不是尺子：
  //   补查 把第二段并回原文时拼出来的是"第一段(含没收口的围栏) + 第二段"，
  //   而收尾那一遍的「缺查」原来写的是 `[\s\S]*$`（照 ggb 那条抄的，**吃到文末**），
  //   于是第二次 `paint` 一口气把围栏**连同后面整段第二段**都摘掉了：
  //   `res.text` 里在、账本里在，**只有屏幕上没有**，刷新重画还会再吞一次。
  //   治法＝那一档**只吃开头那一句**（查的关键词按设计就是一句，见 render.js 里那段注释）。
  //   ⇒ 下一条断言就是"改完别再吞"。**反例④** 专门把老写法装回去，证明这条断言会红。
  const 截 = await 跑一轮('material', '组卷：出一份卷子', '查词10没闭合',
    [{ text: 甲 + '\n\n待我去库里翻一翻。\n\n```查\n查词10没闭合\n' /* ← 故意不写收尾那三个反引号 */ }, { text: 造答2() }], 2);
  if (截.没起来 || 截.前提不成立) { 判('【缺尾围栏】跑不起来', false, 截) }
  else {
    判('5.1 ★ 围栏缺了收尾那三个反引号 → **照样**发起第二次调用、照样翻库',
      截.模数 === 2 && 截.库数 === 1 && 截.库词[0] === '查词10没闭合',
      { 模数: 截.模数, 库数: 截.库数, 库词: 截.库词 });
    判('5.2 ★ 缺尾那一块摘干净了（围栏词没漏出来），**可它没把第二段一起吞掉**'
      + ' —— 围栏只吃自己那一句，围栏后面的话照旧给老师看',
      截.气泡有围栏词 === false && 截.气泡有乙 === true,
      { 围栏词: 截.气泡有围栏词, 有乙: 截.气泡有乙 });
  }

  // ──────────────────────────────────────────────────────────
  console.log('\n════════ 6. 反例：当场从磁盘现读的源码上造坏，装完读回来核 ════════');
  const 渲源 = fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8');
  const 聊源 = fs.readFileSync(path.join(__dirname, '..', 'js', 'chat.js'), 'utf8');

  const 病例 = [
    { 名: '① 围栏认出来了，但查询词根本没往上游传（`cha` 里是空的）',
      件: 'render', 前: "else if (tag === '查') cha.push(info ? info + '\\n' + body : body);",
      换: "else if (tag === '查') { void 0; }",
      答: [{ text: 造答1('```查\n查词11甲\n```') }, { text: 造答2() }],
      词: '查词11甲', 期模: 1, 期库: 0 },
    { 名: '② 少打三个反引号那一档没人管（收尾那一遍不认「查」）',
      件: 'render', 前: 'var 缺查 = ', 换: 'var 缺查 = null && ',
      答: [{ text: 甲 + '\n\n待我去库里翻一翻。\n\n```查\n查词12乙\n' }, { text: 造答2() }],
      词: '查词12乙', 期模: 1, 期库: 0 },
    { 名: '③ 第二段收到了，但没并回这一轮的原文（气泡里只剩第一段）',
      件: 'chat', 前: 'msg.raw = 各自 + 段;', 换: 'msg.raw = 第一段;',
      答: [{ text: 造答1('```查\n查词13丙\n```') }, { text: 造答2() }],
      词: '查词13丙', 期模: 2, 期库: 1 },
    // ④ 把「吃到文末」那条老写法装回去（2026-10-07 探针首跑逮到的那个产品 bug）。
    //   看得出这一格在量什么、而不是"什么都坏了"：第二次调用照样发生、库照样翻了一次，
    //   第一次那段照样在屏幕上 —— 坏的**只是**"第二段在屏幕上没了"这一件。
    { 名: '④ 「查」照 ggb 那条吃到文末 → 围栏后面那段话被一并吞掉（屏幕上整段消失）',
      件: 'render', 前: 'var 吃 = /^(?:[ \\t]*\\r?\\n)*[ \\t]*[^\\r\\n]*/.exec(查余下);',
      换: 'var 吃 = /^[\\s\\S]*/.exec(查余下);',
      答: [{ text: 甲 + '\n\n待我去库里翻一翻。\n\n```查\n查词14丁\n' }, { text: 造答2() }],
      词: '查词14丁', 期模: 2, 期库: 1, 期乙: false }
  ];

  for (let i = 0; i < 病例.length; i++) {
    const b = 病例[i], 标 = String(i + 1);
    const 源 = b.件 === 'render' ? 渲源 : 聊源;
    if (源.indexOf(b.前) < 0) {
      console.log('  ⚠ 反例造不出来：' + b.名 + ' —— 源码里找不到那个锚点');
      判错.push('反例' + 标 + ' 造不出来'); 红++; continue;
    }
    const 坏 = 源.replace(b.前, b.换);
    if (坏 === 源) { console.log('  ⚠ 替换没落到地方'); 判错.push('反例' + 标 + ' 替换没落地'); 红++; continue }

    await 硬重载();
    const 起2 = await 等真(起式, 40, 500);
    if (起2 < 0) { console.log('  ⚠ 重载之后没起来，反例' + 标 + '不作数'); 判错.push('反例' + 标 + ' 页面没起来'); 红++; continue }
    await q(页面工具);
    await q('window.__布库桩()');
    await sleep(150);
    // ③ 只坏 chat.js —— 先把**好版本**的 render 装回去，免得① ② 的改动叠在上面
    if (b.件 === 'chat') await q(`window.__装(${JSON.stringify(渲源)}, '回渲染')`);
    const 装 = b.件 === 'chat'
      ? await q(`window.__装聊天(${JSON.stringify(坏)}, "坏${标}")`)
      : await q(`window.__装(${JSON.stringify(坏)}, "坏${标}")`);
    if (装 !== '坏' + 标) {
      console.log('  ⚠ 反例装不上：' + b.名 + ' —— 读回来是 ' + JSON.stringify(装) + '，这一轮作废');
      判错.push('反例' + 标 + ' 没装上'); 红++; continue;
    }
    await q('(function(){ SR.memo.clear(); return 1 })()');
    await q(`(function(){ SR.main.applyWork('material'); return 1 })()`);
    await sleep(500);
    await q('(function(){ if (SR.landing && SR.landing.hide) SR.landing.hide(); return 1 })()');
    await q(`(function(){ SR.chat.reset('material', {wipe:true}); return 1 })()`);
    await sleep(350);
    await q(`window.__桩答(${JSON.stringify(b.答)})`);
    await q('window.__调用清()');
    await sleep(150);
    await q(`(function(){ SR.chat.submit('组卷：出一份卷子'); return 1 })()`);
    await sleep(500);
    await 等真('SR.chat.isAsking() === false', 45, 250);
    await sleep(600);
    const r = await q(`window.__析(${JSON.stringify(b.词)}, ${JSON.stringify(甲)}, ${JSON.stringify(乙)})`);
    if (!r) { console.log('  ⚠ 反例' + 标 + ' 读不出数'); 判错.push('反例' + 标 + ' 读不出数'); 红++; continue }
    判('6.' + 标 + ' ✔ 反例成立：' + b.名 + ' → 读数**变了**（量到了那个 bug）',
      r.模数 === b.期模 && r.库数 === b.期库
        && (b.期乙 === undefined || r.气泡有乙 === b.期乙),
      { 模数: r.模数, 期模: b.期模, 库数: r.库数, 期库: b.期库,
        有乙: r.气泡有乙, 期乙: b.期乙 });
    if (b.件 === 'chat') {
      // ③ 的病症要**干净**：坏的只是"并回原文"这一根 —— 第二次调用照样发生、库照样翻了一次
      判('6.' + 标 + ' [干净] 第二次调用和翻库**都还在** → 坏的只是"把第二段并回去"那一句',
        r.模数 === 2 && r.库数 === 1 && r.气泡有甲 === true && r.气泡有乙 === false,
        { 模数: r.模数, 库数: r.库数, 有甲: r.气泡有甲, 有乙: r.气泡有乙 });
    } else {
      判('6.' + 标 + ' [干净] 第一段照样画出来了 → 坏的不是整个渲染，只是"查"这一条线',
        r.气泡有甲 === true, { 有甲: r.气泡有甲 });
    }
  }

  console.log('\n──────── 绿 ' + 绿 + ' / 红 ' + 红 + ' ────────');
  if (判错.length) console.log('★ 下面这些不对：\n   ' + 判错.join('\n   '));
  ws.close(); process.exit(红 ? 1 : 0);
})().catch(e => { console.error('探针自己炸了：' + (e && e.stack || e)); process.exit(3) });
