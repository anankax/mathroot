// 量「气泡底下那根小条」这一版（2026-10-06）：复制 / 修改 / 重新发送。
//
// 这一把量的是**本地 8138** 那一份（线上核验另跑 test/_live.cjs）。
//
// ★ 形状还是那句：**每个读数都要能证伪，每处守卫都要配一条反控。**
//
//   0) 在场证明：先把 `mathroot_memo` 换成一份**我造好的六条账本**，刷新，
//      然后把账本长度**读回来核**——不是 6 就当场退出作废。
//      （为什么非这样不可：这个 profile 里存着上一场的记忆，不摆好的话
//        下面量到的是**别人那一段**，读数合情合理却是错的；见记忆
//        「检测脚本的数字不是它宣称的那件事」里那条空读数。）
//   1) 版本证明：从**页面里正在跑的那个函数**取字面量（`SR.chat.submit.toString()`
//      里要看得到 `待截`、`SR.memo.截到` 要是函数）——
//      证不出来整场读数作废。**不许**拿我磁盘上的文件当证物，那证的是
//      "我电脑上是新的"，不是"页面上跑的是新的"。
//   2) 口袋重算是**纯函数**（`__重算口袋`），单独量：给它一段带 ```ggb 的账本，
//      数出来该是几就是几。
//   3) 小条：**默认看不见 / 悬停现身**。★ 两条都要量，且要量 `getClientRects()`
//      撑不撑得开——只量 opacity 的话，"藏得连位置都没有"也会读成绿。
//   4) 「修改」按下去**一个字节都不许动**（memo 长度不变），Esc 之后还是不动。
//      ★ 反控：Esc 之后状态栏必须出现「不改了…」——那句话**只有 pendingTrunc
//        真被挂上过**才会出现。没有它，这一格就是"根本没挂上刀"也照样绿。
//   5) 「重新发送」：★ 装桩换掉 `SR.api.ask`（读回来核桩真装上了），然后
//      **真派鼠标事件**点那颗按钮（不是 `el.click()`——那玩意儿绕开命中测试，
//      按钮就算被盖住、被 pointer-events:none 也照样"点得动"，会假绿）。
//      量：账本 6 → 4、气泡数对上、口袋里 fig 3 → 1（重算过，不是减出来的）。
//
// ⚠ 全程不许 clear()：写 localStorage 先存后还原。
// 用法：node test/probe_msgactions.cjs   （9222 上已有隔离 profile 的可见 Chrome）
const path = require('path'), http = require('http'), fs = require('fs');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const 本地 = 'http://127.0.0.1:8138/index.html';

const 账本 = {
  v: 1, ts: Date.now(), work: 'draw',
  pocket: { topic: '第一句', cls: '', date: '10月6日', marks: {} },
  turns: [
    { r: 'u', t: '第一句', w: 'draw', i: 0 },
    { r: 'a', t: '好。\n```ggb\nA=(0,0)\n```', w: 'draw', i: 0 },
    { r: 'u', t: '第二句（这句说错了）', w: 'draw', i: 0 },
    { r: 'a', t: '好。\n```ggb\nB=(1,1)\n```', w: 'draw', i: 0 },
    { r: 'u', t: '第三句', w: 'draw', i: 0 },
    { r: 'a', t: '好。\n```ggb\nC=(2,2)\n```', w: 'draw', i: 0 }
  ]
};

const put = p => new Promise((res, rej) => {
  const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => res(s)) });
  r.on('error', rej); r.end();
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id] } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })) });
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面里炸了：' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 500));
    return R && R.result ? R.result.value : null;
  };
  const shot = async (名) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 名), Buffer.from(r.result.data, 'base64'));
  };
  const 报 = [];
  const 收 = () => { console.log('══ 小条那三件事 · 本地 8138 ══'); 报.forEach(([k, v]) => console.log('  ' + k + '\n      ' + v)); };

  await send('Page.enable', {}); await send('Runtime.enable', {});
  // ★★ 顺序不能倒：不先 Network.enable，setCacheDisabled 就是一句空话（老账）。
  await send('Network.enable', {}); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 980, deviceScaleFactor: 1, mobile: false });
  await send('Page.bringToFront', {});

  // ★★ 等的是**产品自己的开机完成**，不是"几个对象在了"。
  //   头一遍就栽在这儿：`window.SR && SR.chat && SR.memo` 在**脚本刚解析完**就是真的，
  //   而真正的开机（`SR.main.boot()`）挂在 `DOMContentLoaded` 上、外面还套着
  //   `SRlib.whenReady`（等五个 CDN 库，最多 8 秒）——
  //   于是"就绪"当场放行，我量到的是一张**还没开机**的页面：
  //   账本里 6 条（memo.js 已经装好）、屏幕上一个气泡都没有。读数全都合情合理，
  //   量的却是"开机之前"。同族教训见记忆「检测脚本的数字不是它宣称的那件事」。
  //   ⇒ 认产品自己摆出来的东西：工位那一行六颗按钮（paintWorks，boot 最前面）
  //     ＋ 屏幕上真有一块消息（开场白或上一场）。
  const 开机了吗 = '(document.querySelectorAll("#works .workbtn").length === 6) && (document.querySelectorAll("#msgs > .msg").length > 0)';
  const 起 = async (标) => {
    await send('Page.navigate', { url: 本地 + '?p=' + Date.now() });
    let ok = false;
    for (let i = 0; i < 120; i++) { await sleep(400); if (await q(开机了吗) === true) { ok = true; break } }
    if (!ok) throw new Error(标 + '：页面没开完就超时了（40 秒）—— 工位按钮或消息栏是空的');
    await sleep(1200);   // 开机之后还有那串 0/800/…ms 的补量（板子排版、输入条）
  };

  await 起('第一趟');
  const 存前 = await q("(function(){var o={};['mathroot_memo','mathroot_work','mathroot_backend','mathroot_key'].forEach(function(k){o[k]=localStorage.getItem(k)});return o})()");
  const 还原 = async () => { try { await q("(function(){var o=" + JSON.stringify(存前) + ";for(var k in o){if(o[k]===null)localStorage.removeItem(k);else localStorage.setItem(k,o[k])}return 1})()") } catch (e) {} };

  // ★ 先取一份**开场白**的样子：清空记忆再 reset，屏幕上就是"一场新对话"——
  //   那一刻唯一那条数根的气泡就是开场白。后面 5丁 要拿它当参照，
  //   免得把"开场白又回来了"数成"多了一条回复"（或者反过来）。
  const 开 = await q(`(function(){
      SR.memo.clear();
      SR.chat.reset('draw');
      var m = document.querySelector('.msg.assistant');
      return m ? (m.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40) : null })()`);
  报.push(['0乙 开场白长什么样（新对话那一条）', JSON.stringify(开)]);
  if (!开) { 报.push(['✗ 作废', '取不到开场白 → 5丁 那条"多出来的助手气泡是开场白"核不了']); 收(); await 还原(); ws.close(); await put('/json/close/' + t.id); process.exit(2); }

  // ── 0) 摆好那一屏 + 在场核验 ─────────────────────────────────────────
  //
  // ★★ 2026-10-06：第一版是**直接往 localStorage 里塞**，栽了 —— 而且是那种
  //   "读数看着完全正常"的栽法（账本 1 条、一个开场白气泡、工位六颗，处处合情合理）。
  //   现场抓到的证据：给新文档装了一个"文档一起来就先抄一份 localStorage"的脚本，
  //   第二趟一开机它抄到的**已经不是我塞的那份**了，时间戳还晚于我塞的那一刻。
  //   谁写的？**第一趟那个文档还活着**：memo 模块手里攥着自己的 `mem`，
  //   `save()` 那条 400ms 节流一到就把**缓存里那份**写回盘上，把我塞的盖掉了。
  //   （同族：记忆「检测脚本的数字不是它宣称的那件事」——"我写进去了"和
  //     "待会儿读出来还是它"是两件事，中间隔着一个**还活着的旧文档**。）
  //   ⇒ 改走**产品自己的 API**：`turns()` 交出来的就是那个活数组，pushTurn 往它上面记，
  //     缓存和盘上从此刻起是同一份，谁再写都写的是同一份。
  //   ⚠ 但仍然**先读回来核**再刷新：这一段的意义就是"我证明它真在盘上了"。
  await q(`(function(){
      SR.memo.clear();
      var T = ${JSON.stringify(账本.turns)};
      T.forEach(function(t){ SR.memo.pushTurn(t.r === 'a' ? 'assistant' : 'user', t.t, t.w) });
      SR.memo.produced('draw', { fig: 3 });
      SR.memo.setPocket({ topic: '第一句', date: '10月6日' });
      // ★★ 工位也要摆成 draw。第一版没摆，于是**场景是错位的**：
      //   账本里是作图的六条，工位却停在 localStorage 里上次那个「组卷」上。
      //   后果是一屏怪东西：开场白按组卷出（「传一份你学校的模板…」），
      //   而下面摆着作图的那几条 —— 5丁 里被读成"多出来一条助手气泡"，
      //   差一点当成产品的毛病去查。（同族：量之前先核"在场的是什么"。）
      SR.main.applyWork('draw');
      return 1 })()`);
  await sleep(900);   // 等那条 400ms 的写盘落地
  报.push(['0丙 摆好工位了吗', JSON.stringify(await q("(function(){return JSON.stringify({工位: SR.memo.turns().length ? (document.querySelector('#works .workbtn.on')||{}).textContent : null, 存在localStorage里的: localStorage.getItem('mathroot_work')})})()"))]);
  const 落盘 = JSON.parse(await q(`(function(){
      var o = JSON.parse(localStorage.getItem('mathroot_memo') || '{}');
      return JSON.stringify({
        条数: (o.turns || []).length,
        口袋fig: (o.pocket && o.pocket.marks && o.pocket.marks.fig) || 0,
        课题: (o.pocket && o.pocket.topic) || ''
      }) })()`));
  报.push(['0甲 落盘核验（刷新之前先核一遍，不是等刷新之后再说）', JSON.stringify(落盘)]);
  if (落盘.条数 !== 6 || 落盘.口袋fig !== 3) {
    报.push(['✗ 作废', '账本没真落盘（' + 落盘.条数 + ' 条 / fig ' + 落盘.口袋fig + '）→ 下面一律不算数']);
    收(); await 还原(); await 起('还原'); ws.close(); await put('/json/close/' + t.id); process.exit(2);
  }
  await 起('第二趟（带账本）');

  const 在场 = JSON.parse(await q(`(function(){
      return JSON.stringify({
        账本: SR.memo.turns().length,
        用户气泡: document.querySelectorAll('.msg.user').length,
        助手气泡: document.querySelectorAll('.msg.assistant').length,
        首屏块: document.querySelectorAll('.lblock').length,
        口袋fig: JSON.stringify(SR.memo.pocket().marks.fig || 0)
      }) })()`));
  报.push(['0 在场核验', JSON.stringify(在场)]);
  if (在场.账本 !== 6 || 在场.用户气泡 !== 3 || 在场.助手气泡 !== 3) {
    报.push(['✗ 作废', '账本/气泡不是 6/3/3 → 下面一律不算数']);
    收(); await 还原(); await 起('还原'); ws.close(); await put('/json/close/' + t.id); process.exit(2);
  }

  // ★ 收货人：页面**收到了**什么鼠标事件，记下来。
  //   第一版没有这一层，于是"点了没反应"只能靠"输入框没变"去猜——
  //   而那个读数把两件完全不同的事读成了同一副样子：处理函数没跑 / 处理函数跑了但没干活。
  //   （实测抓到过：elementFromPoint 说是 copybtn，页面收到的 click 却落在 .bubble 上。）
  await q(`(function(){
      window.__点了 = [];
      document.addEventListener('click', function(e){ window.__点了.push(e.target && (e.target.className || '?')) }, true);
      return 1 })()`);

  // ── 1) 版本证明：从**页面里正在跑的函数**取字面量 ────────────────────
  const 证物 = JSON.parse(await q(`(function(){
      var s = String(SR.chat.submit);
      return JSON.stringify({
        跑了这份: s.indexOf('待截') >= 0,
        有截到: typeof SR.memo.截到 === 'function',
        有重算: typeof SR.memo.__重算口袋 === 'function',
        简历长度: s.length
      }) })()`));
  报.push(['1 版本证明（页面里正在跑的那份）', JSON.stringify(证物)]);
  if (!证物.跑了这份 || !证物.有截到 || !证物.有重算) {
    报.push(['✗ 作废', '页面上跑的不是这一版 → 整场读数作废']);
    收(); await 还原(); await 起('还原'); ws.close(); await put('/json/close/' + t.id); process.exit(3);
  }

  // ── 2) 口袋重算是纯函数，单独量 ─────────────────────────────────────
  const 重算 = JSON.parse(await q(`(function(){
      var f = SR.memo.__重算口袋;
      var 三条 = ${JSON.stringify(账本.turns)};
      var 一条 = 三条.slice(0, 2);
      return JSON.stringify({
        '三条的fig': (f(三条).fig || 0),
        '只留第一条的fig': (f(一条).fig || 0),
        '空账本': JSON.stringify(f([])),
      }) })()`));
  报.push(['2 __重算口袋（纯函数，3 段的图 → 该是 3 / 1 / 空）', JSON.stringify(重算)]);
  if (重算['三条的fig'] !== 3 || 重算['只留第一条的fig'] !== 1) 报.push(['✗ 作废', '口袋重算不对 → 后面"重算过"那一条断言不算数']);

  // ── 3) 小条：门牌 / 颗数 / 默认隐形 / 悬停现身 ────────────────────────
  //
  // ★★ 2026-10-06：第一版把三颗按钮 join 成**一整串**再跟一个字面量整句比对，
  //   字面量里多打了一个空格，于是"每条都带齐三颗"这条**本来是绿的**报成了红。
  //   整句比对就是这个毛病：对的也报红、错的也可能因为别处凑巧相同而漏报
  //   （记忆「检测脚本的数字不是它宣称的那件事」里的"同一句话挂多条虚高、整句比对漏报"）。
  //   ⇒ 改成**逐条数颗数**：门牌逐条、老师每条 3 颗、数根每条 1 颗，各断言各的。
  const 条 = JSON.parse(await q(`(function(){
      function 字串(m){
        var out = [];
        m.querySelectorAll('.copybar .copybtn').forEach(function(b){ out.push((b.textContent||'').trim()) });
        return out;
      }
      var 门牌 = [], 师 = [], 徒 = [];
      document.querySelectorAll('.msg.user').forEach(function(m){
        门牌.push(m.getAttribute('data-mi')); 师.push(字串(m).join('|'));
      });
      document.querySelectorAll('.msg.assistant').forEach(function(m){ 徒.push(字串(m).join('|')) });
      var b0 = document.querySelector('.msg.user .copybar');
      var 矩形 = b0 ? b0.getBoundingClientRect() : null;
      return JSON.stringify({
        老师门牌: 门牌, 老师条: 师, 数根条: 徒,
        老师门数: 师.length, 数根条数: 徒.length,
        小条高: 矩形 ? +矩形.height.toFixed(1) : null,
        小条宽: 矩形 ? +矩形.width.toFixed(1) : null,
        默认透明度: b0 ? getComputedStyle(b0).opacity : null
      }) })()`));
  报.push(['3 门牌与颗数', JSON.stringify(条)]);
  // ★ 逐条断言，**每条都要能失败**：门牌必须是 0,2,4（不是就说明钉错地方）；
  //   老师每条恒 3 颗；数根每条恒 1 颗。
  const 门牌对 = 条.老师门牌.join(',') === '0,2,4';
  const 老师对 = 条.老师门数 === 3 && 条.老师条.every(function(s){ return s === '复制|修改|重新发送' });
  const 数根对 = 条.数根条数 === 3 && 条.数根条.every(function(s){ return s === '复制这段' });
  const 隐形 = 条.默认透明度 === '0';
  const 撑开 = 条.小条高 > 10;
  报.push(['3.1 断言', ['门牌=0,2,4 ' + (门牌对 ? '✓' : '✗'),
    '老师恒三颗 ' + (老师对 ? '✓' : '✗'), '数根恒一颗 ' + (数根对 ? '✓' : '✗'),
    '默认 opacity=0 ' + (隐形 ? '✓' : '✗'),
    // ★ 这一条是防"藏得连位置都没有"：opacity 藏法**必须还占着地方**，
    //   否则鼠标移上去的瞬间整条对话会跳一下（正是要避免的那件事）。
    '还占着地方(高>10px) ' + (撑开 ? '✓' : '✗')].join(' · ')]);

  // 悬停 → 现身。★ 用**真鼠标事件**，:hover 是 CSS 命中测试说了算的。
  //
  // ★★ 2026-10-06：第一版量的是 `.msg.user .copybar` —— 那是**永远的第一条**，
  //   而鼠标悬的可能是另一条消息。于是 :hover 明明在（`.msg.user:hover` 为真）、
  //   那条的小条明明亮了，量出来的却是第一条的 0，报成"悬停不现身"。
  //   同族：记忆「检测脚本的数字不是它宣称的那件事」——**整节断言量的是同一个隐藏元素**。
  //   ⇒ 悬哪一条，就量**那一条自己**的小条。
  //   ⇒ 而且先量一次"鼠标挪开时是 0"，再悬上去量一次：不然两次数到同一个值也看不出。
  {
    const 甲 = '.msg.user[data-mi="0"]';
    const 位 = await q(`(function(){
        var m = document.querySelector(${JSON.stringify(甲)});
        if (!m) return null;
        m.scrollIntoView({ block: 'center', behavior: 'instant' });
        var r = m.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) })
      })()`);
    if (!位) { 报.push(['3.2 悬停', '找不到第一条老师消息，这一格作废']) }
    else {
      const p = JSON.parse(位);
      const 读 = await q(`(function(){
          var m = document.querySelector(${JSON.stringify(甲)});
          var b = m.querySelector('.copybar'), r = b.getBoundingClientRect();
          return JSON.stringify({ 悬着的: !!m.matches(':hover'), 透明度: getComputedStyle(b).opacity,
            宽: +r.width.toFixed(1), 高: +r.height.toFixed(1) })
        })()`);
      // ① 先把鼠标挪到角落，量"没悬停时"
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
      await sleep(300);
      const 悬前 = JSON.parse(await q(`(function(){
          var b = document.querySelector(${JSON.stringify(甲)}).querySelector('.copybar');
          return JSON.stringify({ 悬着的: !!document.querySelector(${JSON.stringify(甲)}).matches(':hover'),
            透明度: getComputedStyle(b).opacity }) })()`));
      // ② 再挪到那条消息身上
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, buttons: 0 });
      await sleep(500);
      const 悬后 = JSON.parse(await q(`(function(){
          var m = document.querySelector(${JSON.stringify(甲)});
          var b = m.querySelector('.copybar'), r = b.getBoundingClientRect();
          return JSON.stringify({ 悬着的: !!m.matches(':hover'), 透明度: getComputedStyle(b).opacity,
            宽: +r.width.toFixed(1), 高: +r.height.toFixed(1) }) })()`));
      报.push(['3.2 悬停那条 → 该现身（先量挪开时的，再量悬上去的）',
        '挪开时=' + JSON.stringify(悬前) + ' | 悬上去=' + JSON.stringify(悬后)]);
      await shot('_msg_悬停.png');
    }
  }

  // ── 4) 「修改」按下去：一个字节都不许动 ─────────────────────────────
  // ★ 真派鼠标事件点那颗按钮，而且**先核 elementFromPoint 命中的就是它**——
  //   用 `el.click()` 的话，按钮就算被盖住、被 pointer-events:none 也照样"点得动"。
  //
  // ★★ 2026-10-06 两处硬伤，都在这儿：
  //   ① `scrollIntoView({block:'center'})` 在这个页面上是**平滑**的（滚动没停），
  //      量完坐标再 sleep 两轮，等真按下去时那一颗已经被滚到别处去了。
  //      抓到的证据：elementFromPoint 说命中的是 `copybtn/修改`，
  //      而页面捕获到的 click 落在 `.bubble` 上 —— 处理函数压根没跑。
  //      而"输入框没变、状态栏没变"**看着像产品坏了**。
  //      ⇒ 量坐标和按下去之间不许再隔着会变的东西：`behavior:'instant'` ＋ 按之前**再量一次**。
  //   ② 光看结果分不清"没点中"和"点中了但没干活"。⇒ 页面那边装着 `window.__点了`，
  //      点完把它**读回来**，让"这一下落在谁身上"变成一条读数。
  const 量一颗 = async (msgSel, 字) => JSON.parse(await q(`(function(){
      var m = document.querySelector(${JSON.stringify(msgSel)});
      if (!m) return JSON.stringify({err:'找不到 ' + ${JSON.stringify(msgSel)}});
      m.scrollIntoView({ block: 'center', behavior: 'instant' });
      var bs = m.querySelectorAll('.copybar .copybtn'), hit = null;
      for (var i=0;i<bs.length;i++) if ((bs[i].textContent||'').trim() === ${JSON.stringify(字)}) hit = bs[i];
      if (!hit) return JSON.stringify({err:'这条底下没有「' + ${JSON.stringify(字)} + '」'});
      var r = hit.getBoundingClientRect();
      var x = Math.round(r.left+r.width/2), y = Math.round(r.top+r.height/2);
      var top = document.elementFromPoint(x, y);
      return JSON.stringify({x:x, y:y, 命中的是它吗: top === hit,
        命中的是: top ? ((top.className||'') + '/' + (top.textContent||'').slice(0,6)) : null})
    })()`));

  const 点按钮 = async (msgSel, 字) => {
    const 一 = await 量一颗(msgSel, 字);
    if (一.err) return 一;
    // 悬到那条消息上，把小条叫出来（真实用法就是这样）
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
    await sleep(150);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 一.x, y: 一.y - 40, buttons: 0 });
    await sleep(250);
    // ★ 按之前**再量一次**（不是复用上面那份）
    const 二 = await 量一颗(msgSel, 字);
    if (二.err) return 二;
    await q("window.__点了 = []");   // 清空收货记录，下面读到的就是这一下的
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 二.x, y: 二.y, buttons: 0 });
    await sleep(250);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 二.x, y: 二.y, button: 'left', clickCount: 1, buttons: 1 });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 二.x, y: 二.y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(400);
    二.页面收到 = await q('(window.__点了||[]).slice(-1)[0] || null');
    return 二;
  };

  const m2 = '.msg.user[data-mi="2"]';
  const 点修改 = await 点按钮(m2, '修改');
  const 改后 = JSON.parse(await q(`(function(){
      var st = document.getElementById('status');
      return JSON.stringify({ 输入框: document.getElementById('input').value,
        状态栏: st ? (st.textContent||'').trim() : '(没有)', 账本: SR.memo.turns().length })
    })()`));
  报.push(['4甲 点「修改」', '命中=' + JSON.stringify(点修改) + ' | 改后=' + JSON.stringify(改后)]);
  // ★ 断言：输入框拿到的是**这一条的原话**；账本**一个字节都没动**。
  const 四甲 = (改后.输入框 === '第二句（这句说错了）') && (改后.账本 === 6);
  报.push(['4甲 断言', '输入框=原话 ' + (改后.输入框 === '第二句（这句说错了）' ? '✓' : '✗')
    + ' · 账本仍是 6（按下去不删） ' + (改后.账本 === 6 ? '✓' : '✗')]);
  await shot('_msg_点修改.png');

  // Esc = 反悔。★ 反控：状态栏必须出现「不改了」，那句话只有 pendingTrunc 真挂上过才会有。
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(400);
  const esc后 = JSON.parse(await q("(function(){var st=document.getElementById('status');return JSON.stringify({状态栏:st?(st.textContent||'').trim():'(没有)',账本:SR.memo.turns().length})})()"));
  const 反控过 = String(esc后.状态栏).indexOf('不改了') >= 0;
  报.push(['4乙 ★反控 Esc 反悔', 'Esc后=' + JSON.stringify(esc后)
    + ' | 「不改了」出现了吗=' + (反控过 ? '✓（说明刀真挂上过）' : '✗ **刀压根没挂上，4甲那一格是假绿**')]);

  // ── 5) 「重新发送」：装桩 → 点 → 该真截断 ───────────────────────────
  const 桩 = await q(`(function(){
      window.__真ask = SR.api.ask; window.__真ready = SR.api.ready;
      SR.api.ready = function(){ return true };
      SR.api.ask = function(o){ window.__ask收到 = {work:o.work, text:o.text};
        var 全文 = '桩：收到「' + o.text + '」。';
        // ★★ 桩必须**照 api.js 的合同演**：那边正文只有一条路 —— onChunk
        //   （chat.js 的 paint 读的是 msg.raw，而 msg.raw 只由 onChunk 一截截缝出来）。
        //   第一版桩只 resolve({text})、一次都不叫 onChunk，屏幕上于是量到三件怪事：
        //   气泡空着、底下没有「复制这段」、账本里却**明明白白写着那句话** ——
        //   三条一个病根：msg.raw 是空串 → p.visible 空 → renderInto(b,'')
        //   → 看得见 = msg.lastVisible（那是 ''，不是 null）→ attachCopy 的 if(!t)return 早退。
        //   ⚠ 分两截吐：顺带把"收一截画一次"那条路也走到（paint 的 v !== lastVisible）。
        var 半 = Math.max(1, Math.floor(全文.length / 2));
        if (o.onChunk) { o.onChunk(全文.slice(0, 半)); o.onChunk(全文.slice(半)); }
        return Promise.resolve({ text: 全文, model: 'stub' }) };
      return JSON.stringify({ ask装上了: SR.api.ask !== window.__真ask, ready装上了: SR.api.ready !== window.__真ready })
    })()`);
  报.push(['5甲 装桩', 桩]);

  const 点重发 = await 点按钮(m2, '重新发送');
  await sleep(2200);   // 等那一轮走完（桩是立刻 resolve 的，这 2.2 秒是给收尾那串用的）
  const 后 = JSON.parse(await q(`(function(){
      return JSON.stringify({
        账本: SR.memo.turns().length,
        账本内容: SR.memo.turns().map(function(t){return t.r + ':' + String(t.t).slice(0,10)}),
        用户气泡: document.querySelectorAll('.msg.user').length,
        助手气泡: document.querySelectorAll('.msg.assistant').length,
        口袋fig: SR.memo.pocket().marks.fig || 0,
        接口收到: window.__ask收到 ? window.__ask收到.text : null,
        最后一句: (function(){var u=document.querySelectorAll('.msg.user');var m=u[u.length-1];return m?m.textContent.replace(/\\s+/g,' ').slice(0,60):null})()
      }) })()`));
  报.push(['5乙 点「重新发送」之后', JSON.stringify(后)]);
  await shot('_msg_重发后.png');

  const 五 = {
    '账本 6 → 4（丢的是一整轮）': 后.账本 === 4,
    '气泡 3/3 → 2/2': 后.用户气泡 === 2 && 后.助手气泡 === 2,
    '口袋里 fig 3 → 1（**重算**过，不是减出来的）': 后.口袋fig === 1,
    '发出去的就是这一条的原话': 后.接口收到 === '第二句（这句说错了）'
  };
  报.push(['5丙 断言', Object.keys(五).map(k => k + ' ' + (五[k] ? '✓' : '✗')).join(' · ')]);

  // ── 5丁 走「修改」那条路：改一个字再发 → 截到 0，课题必须跟着换 ──────
  //
  // ★★ 2026-10-06：这一格原来是"点第一条的重新发送"。可那条重发的还是**同一句**
  //   「第一句」，于是课题在前后都是「第一句」，断言 `课题 === '第一句'` **恒真**——
  //   它一次也红不了，量不出"课题有没有跟着重算"
  //   （同族：记忆里"红验写成把 got 和 want 对调"那种恒绿）。
  //   ⇒ 改成真走一遍「修改 → 把字改掉 → 回车」：这样课题该变成**新的那句**，
  //     跟旧的「第一句」不一样，这条断言才有牙。
  //   ⚠ 顺带这也是「修改」那条路的端到端覆盖：按下去不删、改完真发才截。
  const 点改0 = await 点按钮('.msg.user[data-mi="0"]', '修改');
  const 改后0 = JSON.parse(await q(`(function(){
      var st = document.getElementById('status');
      return JSON.stringify({ 输入框: document.getElementById('input').value,
        状态栏: st ? (st.textContent||'').trim() : '(没有)', 账本: SR.memo.turns().length }) })()`));
  报.push(['5丁 点第一条「修改」', '命中=' + JSON.stringify(点改0) + ' | ' + JSON.stringify(改后0)]);
  const 五丁甲 = {
    '输入框=「第一句」（原话回填）': 改后0.输入框 === '第一句',
    '账本仍是 4（按下去不删）': 改后0.账本 === 4,
    '状态栏说了"重来"': String(改后0.状态栏).indexOf('重来') >= 0
  };
  报.push(['5丁甲 断言', Object.keys(五丁甲).map(k => k + ' ' + (五丁甲[k] ? '✓' : '✗')).join(' · ')]);

  const 新话 = '从头来过：换成新的第一句';
  await q("(function(){var i=document.getElementById('input'); i.value=" + JSON.stringify(新话) + "; i.focus(); i.setSelectionRange(i.value.length, i.value.length); return 1})()");
  // 真键盘事件（不是直接调 submit）：走页面上那条 keydown —— 改完按回车就是老师那一下。
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(2200);
  const 后2 = JSON.parse(await q(`(function(){
      return JSON.stringify({
        账本: SR.memo.turns().length,
        账本内容: SR.memo.turns().map(function(t){ return t.r + ':' + String(t.t).slice(0,12) }),
        用户气泡: document.querySelectorAll('.msg.user').length,
        助手气泡: document.querySelectorAll('.msg.assistant').length,
        口袋里还有fig吗: ('fig' in SR.memo.pocket().marks),
        课题: SR.memo.pocket().topic,
        接口收到: window.__ask收到 ? window.__ask收到.text : null,
        助手都长什么样: (function(){
          var out = [];
          document.querySelectorAll('.msg.assistant').forEach(function(m){
            out.push((m.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40)) });
          return out })(),
        屏上有什么: (function(){
          var out = [];
          document.querySelectorAll('#msgs > *').forEach(function(m){
            out.push((m.className||'?') + ' ‖ ' + (m.textContent||'').replace(/\\s+/g,' ').trim().slice(0,24)) });
          return out })(),
        桩的回复在屏上吗: document.body.textContent.indexOf('桩：收到') >= 0,
        末条底下那排: (function(){
          var c = document.querySelectorAll('.msg.assistant'); if (!c.length) return null;
          var out = [];
          c[c.length-1].querySelectorAll('.copybar .copybtn').forEach(function(b){ out.push((b.textContent||'').trim()) });
          return out })(),
        末条是个什么东西: (function(){
          var c = document.querySelectorAll('#msgs > *'), m = c[c.length-1], 子 = [];
          m.querySelectorAll('*').forEach(function(x){
            if (子.length < 10) 子.push((x.className||'?') + ' ⟪' + (x.textContent||'').replace(/\\s+/g,' ').slice(0,12) + '⟫') });
          return { 外层: m.className, 高: +m.getBoundingClientRect().height.toFixed(1), 子: 子 } })()
      }) })()`));
  报.push(['5丁乙 改字发出之后（截到 0，连第一句一起丢掉）', JSON.stringify(后2)]);
  // ★ 截到 0 之后屏幕上**应该**是：开场白 + 老师的新话 + 数根的回复。
  //   开场白回来不是多余的——reset() 见记忆空了就拿它开张，跟按 ⟳ 是同一件事
  //   （js/chat.js:1118-1119：repaintLog() 空了才 addAssistantText(OPENING)）。
  //   所以这儿不数"一共几条"，而是**认出**第一条到底是不是开场白。
  const 助手们 = 后2.助手都长什么样 || [];
  const 五丁 = {
    '账本 4 → 2（旧的清光 + 新一轮）': 后2.账本 === 2,
    '老师气泡 2 → 1': 后2.用户气泡 === 1,
    '助手气泡 = 开场白 + 这一轮的回复（不是旧气泡没清掉）':
      助手们.length === 2 && 助手们[0] === 开 && String(助手们[1]).indexOf('桩：收到') === 0,
    // ★ 直接量"回复有没有落到屏上"，不信气泡数：第一版桩不叫 onChunk，
    //   数出来照样是 2 条助手气泡，可其中一条**空着**（账本里却有那句话）。
    '回复真在屏上（不只是账本里写着）': 后2.桩的回复在屏上吗 === true,
    // ★ 新那一轮的「复制这段」得跟着长回来 —— 它跟正文同一个病根（attachCopy 的 `if(!t) return`）。
    '新那条底下也有「复制这段」': JSON.stringify(后2.末条底下那排) === '["复制这段"]',
    '发出去的是**改过**的那句': 后2.接口收到 === 新话,
    // ★ 这条是"重算"的证据：剩下的两条里没有带 ```ggb 的回复，fig 这一项**该整个消失**。
    //   要是它还在（写成 0 或留着 2），说明是"减"出来的、或者压根没重算。
    'fig 这一项整个消失（== 就是重算过的证据）': 后2.口袋里还有fig吗 === false,
    // ★ 课题跟着换成新的第一句。丢了第一句之后旧课题就是句谎话。
    //   旧课题是「第一句」、新的是「新话」，两个值不一样 —— 这条才红得起来。
    '课题换成新的第一句（不是「第一句」）': 后2.课题 === 新话 && 新话 !== '第一句'
  };
  报.push(['5丁丙 断言', Object.keys(五丁).map(k => k + ' ' + (五丁[k] ? '✓' : '✗')).join(' · ')]);

  // ── 5戊) 「答回来了、却一个字都没流过来」这一档（★是**量**，不是断言）──────
  //   这一档不是我编出来的题目：5丁 那个桩**第一版**就是这么写的（只 resolve({text})、
  //   一次都不叫 onChunk），屏幕上量到的是"助手气泡空着、底下没有「复制这段」、
  //   账本里却明明白白写着那句话"。顺着这条线回去读产品自己的代码，
  //   同一个形状在 api.js 里也有一条路：
  //     js/api.js:757  if (!all && rawAll) all = rawAll.replace(/<\/?think>/gi,'').trim();
  //     js/api.js:758  if (strip && !all && rawAll) { …onChunk(all); }
  //   ★ 757 先跑、而且**不叫 onChunk**；它一跑，758 的 `!all` 就再也不成立 ——
  //     那句兜底的 onChunk 永远轮不到。触发条件是"整段回复都被思考标签剥光了"
  //     （只有 wantStrip 那条路会走到 757）。
  //   ⚠ 我没在真模型上见过这一档（免费通道前面那些轮都没这形状），所以这一格
  //     **只照实报告产品现在的样子**，不写断言 —— 要不要补兜底由孔老师定。
  await q(`(function(){
      SR.api.ask = function(o){ window.__ask收到2 = {text:o.text};
        return Promise.resolve({ text: '桩（不流式）：收到「' + o.text + '」。', model: 'stub2' }) };
      return 1 })()`);
  await q("(function(){var i=document.getElementById('input'); i.value='再来一句：这个桩不流式'; i.dispatchEvent(new Event('input',{bubbles:true})); i.focus(); return 1})()");
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(2200);
  const 后3 = JSON.parse(await q(`(function(){
      var a = document.querySelectorAll('.msg.assistant'), m = a[a.length-1];
      return JSON.stringify({
        账本末条: (function(){ var t = SR.memo.turns(); return t.length ? String(t[t.length-1].t).slice(0,30) : null })(),
        末条气泡自己写的字: (function(){ var q = m && m.querySelector('.bubble'); return q ? (q.textContent||'').replace(/\\s+/g,' ').trim().slice(0,34) : null })(),
        末条底下那排: (function(){ if (!m) return null; var o = []; m.querySelectorAll('.copybar .copybtn').forEach(function(b){ o.push((b.textContent||'').trim()) }); return o })()
      }) })()`));
  报.push(['5戊 ★量一条：答回来了、却一个字都没流过来', JSON.stringify(后3)]);
  报.push(['   ↑ 怎么读', '账本里有那句话、气泡里却没有 → 是**产品**的形状（js/api.js:757 抢在 758 前面）。'
    + '我还没在真模型上见过这一档，所以只量不断言：要不要在 chat.js 收尾处补一道兜底'
    + '（msg.raw 空、res.text 不空 → 拿 res.text 当正文画），你说了算。']);

  await q("(function(){ SR.api.ask = window.__真ask; SR.api.ready = window.__真ready; return 1 })()");

  // ── 6) 图 ─────────────────────────────────────────────────────────
  报.push(['6 图', 'test/_msg_悬停.png · _msg_点修改.png · _msg_重发后.png']);
  收();

  await 还原();
  console.log('  [清理] localStorage 已还原（没用 clear），api.ask/ready 已拆桩');
  await 起('收尾还原');
  ws.close(); await put('/json/close/' + t.id);
})();
