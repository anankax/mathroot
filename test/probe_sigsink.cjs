// 整改③ 到底治没治病 —— **把模型写出来的命令，喂给真画板，数画板拒了几条**。
//
// ============================================================
// 为什么要另起一把尺子（probe_drawfence.cjs 那张总表量不到这件事）
// ============================================================
// 总表量的是"出没出图 / 出得像不像"，它到不了 ③ 真正治的那一格：
//   ③ 的病是**命令名对、参数形状错 → evalCommand 返回 false → 板上一声不响**
//   （错误弹窗关着，见 board.js 的 setErrorDialogsActive）。这种坏法下**围栏照样在**、
//   "出图率"照样 4/4 —— 总表那一格是绿的，而老师看到的是空白画板。
//   拿"出图率"去证明 ③ 有用，等于拿一把量不到病的那把尺子去量药。
//
// 这把尺子直接量**下游那半截**：
//   模型这一轮真写出来的命令 → SR.render.parseFences 解析 → **SR.board.draw() 送真画板**
//   → 读 SR.board.failed()（画板没认的那几条）和 SR.board.objects()（真建成了什么）。
//   两臂（cmds 开 / 关）各跑同一个句子，比的就是"画板拒了几条"。
//
// ============================================================
// ★★ 用例是挑过的：**只挑"签名错就一定静默失败"的那几句**
// ============================================================
// 四个句子，每一句都同时满足两件事：
//   ① 门表认得出（SR.ggbcmds.翻 会翻中）—— 不然两臂本来就一样，差值恒为 0；
//   ② 那句话的正解命令**少一个参数就成不了**（这三条都是 board.js 注释里实测过的）：
//        · 展开图 `Net(cube, 1)` —— 一个参数的 `Net(cube)` **成不了**
//        · 条形统计图 `BarChart(类目, 高度)` —— `BarChart(L1)` 一个列表 **不行**
//        · 标准差 `SD` —— `Stdev` 在这块板上**什么都没有**
//        · 折线统计图 `Polyline` —— `LineGraph` 要么不认要么画成别的东西
//   换个说法：**这四个句子里的签名，写错一个就是一张空白画板。**
//   ⚠ 只挑得出四句是因为门表本身只有这几条带"静默失败"的签名。这是这趟测量的**上限**，
//     不是它的成绩。另外九条卡的参数形状写错顶多是"画得不好看"，不是 ③ 要治的病。
//
// 外加**一句对照**（「画 y=x^2-2x-3 的图象…」，门表一个字都不认）：
//   这句两臂必须**一模一样**。它不一样就说明这把尺子在抖，四个句子的差值也作废。
//
// ============================================================
// ⚠ 探针纪律（跟 probe_ggbcmds_live.cjs 同一套）
// ============================================================
//   · 浏览器必须**开着窗口**（不带 --headless），用隔离档案 test/_chrome；
//   · ★★ **绝不调 Network.setCacheDisabled**（2026-10-06 实测，见下）——
//       探针要的是**真画板**，而 `setCacheDisabled: true` 之下 **GeoGebra 根本装不起来**：
//       `window.ggbApplet` 一直是 undefined，`SR.board.isReady()` 一直 false，
//       而且 `Network.loadingFailed` **一条都不报**（不是"加载失败"，是压根没走完）。
//       三个对照当场量过：什么都不加→ready；只加 Network.enable→ready；
//       只加 setDeviceMetricsOverride→ready；**只加 setCacheDisabled→永远不 ready**。
//       ⚠ 这条对**别的探针**同样成立：凡是用过 `setCacheDisabled` 的线上探针，
//         量到的都是**一块装不起来的板子**。不读画板的那几把（只读 SR 的）看不出区别 ——
//         这正是 [[scanner-numbers-are-not-what-they-claim]] 那一族：读数条条对，量的东西是死的。
//       ★ 那"会不会吃到旧 js"？不会：本机 8138 是 test/serve.cjs，它给自家文件发的是
//         `Cache-Control: no-store, no-cache, must-revalidate`（curl -I 核过）。
//         "必须硬重载"那条纪律是**给 GitHub Pages 的 max-age=600 写的**，这里不适用。
//         何况下面还有一道身份指纹，版本对不上整场作废。
//   · 下面的身份自检读不出来 = 整场读数作废（版本没装上时，后面每一格都会"看着全绿"）；
//   · 模型那一侧**在页面里调**（SR.api.ask），画板也在页面里 —— 两边同一个 SR。
//     在 Node 里调模型、再把命令送进浏览器，那是两个 SR 实例，量的不是一条路；
//   · **每格先清板并核板是空的**（两格共享一块板会把上一格的残留量进来，同族栽过）；
//   · 页面上翻的开关**用完当场还原**；
//   · 开头先**证明页面上装的是这一版**（指认证不出来则整场读数作废）。
//
// 用法：node test/probe_sigsink.cjs [每句打几次] [后端]
//   例：node test/probe_sigsink.cjs 3 glm
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PORT = 9222, N = parseInt(process.argv[2] || '3', 10);

// ★★ 条数**从源文件里数**，不写死（2026-10-06 夜加第 14 条时改的）：
//   原来这里写的是 `F.条数 !== 13`。加一条卡的那天，这一格会把**装得好好的页面**
//   判成"仪器不对"、整场读数作废。同族：[[scanner-numbers-are-not-what-they-claim]]
//   里那条"写死的件数在'加一件'那天报成'仪器不对'"。
//   ⚠ 正则为什么是 `[{,]` 开头：卡在源文件里写成 `  { 名: 'Slider', …`，**行首是 `{`**。
//     `^\s*名:` 数出 0（把好页面判成红），`\b名:` 也数出 0（`\b` 只认 ASCII）。
const 应装 = (fs.readFileSync(path.join(__dirname, '..', 'js', 'ggbcmds.js'), 'utf8').match(/[{,]\s*名: '/g) || []).length;

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: PORT, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 用例：4 句"签名错就是空白板" + 1 句对照 ----
const 用例 = [
  { 键: 'sig-cube', 话: '画个正方体的展开图',
    该贴: ['Cube', 'Net'], 要说清: '正解是 Net(cube, 1)（一个参数成不了）' },
  { 键: 'sig-bar', 话: '画个条形统计图，五天的人数分别是 8、12、6、10、4',
    该贴: ['BarChart'], 要说清: '正解是 BarChart(类目, 高度)（一个列表不行）' },
  { 键: 'sig-sd', 话: '算一下这组数据的标准差：1、2、2、3、5、8',
    该贴: ['统计量'], 要说清: '正解是 SD（Stdev 在这块板上什么都没有）' },
  { 键: 'sig-line', 话: '画个折线统计图，五天的人数分别是 8、12、6、10、4',
    该贴: ['Polyline'], 要说清: '正解是 Polyline（LineGraph 要么不认要么画成别的）' },
  // ★ 对照：门表一个字都不认 → 两臂的提示词**逐字相同**，差值只可能来自模型抖动
  //   ★★ 2026-10-06 夜换过一句，别改回去：原来这句是「画 y=x^2-2x-3 的图象，标出它的最低点」，
  //     它当时确实一个字都不认。可就是这一晚，**第 14 条卡（顶点/极值）的门里收了「最低点」**——
  //     同一句话，一夜之间从"零命中"变成了"命中一条"，对照臂就**不再是对照臂**了
  //     （两臂提示词不再相同，"差值是噪声"这个前提当场作废）。
  //     教训不是"别加卡"，是**对照臂的资格会随产品改动过期**：门表一动，这句就失效。
  //     ⚠ 加卡/改门之后，**这一句必须拿 probe_ggbcmds.cjs 重核一遍**（那里 ② 号那一节就是干这个的）。
  //   现在这句「画一条线段 AB，长 5 厘米」：14 条门的词一个都不沾，且它是个**真作图请求**
  //   （不是"今天天气不错"那种闲聊）—— 门该不认、模型该画，两臂才比得公平。
  { 键: 'ctrl-none', 话: '画一条线段 AB，长 5 厘米',
    该贴: [], 要说清: '门表一个字不认，两臂提示词逐字相同（这句是这把尺子的"在不在抖"）' }
];

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  await send('Page.enable', {}); await send('Runtime.enable', {});
  // ★★ 这里**故意没有** Network.setCacheDisabled —— 加了它 GeoGebra 就装不起来（见文件顶上那段实测）。
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (e, 等待秒) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true, timeout: (等待秒 || 60) * 1000 });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description;
      return 'THROW: ' + String(d).slice(0, 300);
    }
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  let 就绪 = false;
  for (let i = 0; i < 45; i++) { await sleep(700); if (await ev('!!(window.SR && SR.board && SR.board.isReady && SR.board.isReady())') === true) { 就绪 = true; break; } }
  if (!就绪) { console.error('★ 画板没起来。'); process.exit(2); }
  await send('Page.bringToFront', {});

  // ---- 身份自检：证不出页面上装的是这一版，整场读数作废 ----
  const 指纹 = await ev('JSON.stringify({ 模块: typeof SR.ggbcmds, 条数: SR.ggbcmds ? SR.ggbcmds.卡.length : null, 开关: SR.WORKS.draw.cmds, ask: typeof SR.api.ask, draw: typeof SR.board.draw, failed: typeof SR.board.failed, objects: typeof SR.board.objects, ggb: typeof window.ggbApplet })');
  console.log('页面指纹：' + 指纹 + '\n');
  if (String(指纹).indexOf('THROW') === 0) { console.error('★ 读指纹就炸了：' + 指纹); process.exit(2); }
  const F = JSON.parse(指纹);
  // ★★ `ggb` 那一格单拎出来判、而且写进错话里：**applet 装不起来是这个家族里最会骗人的一种坏**——
  //   上面那些 SR.* 的口子在 applet 死掉时**照样齐全**（board.js 早注进来了），
  //   `SR.board.draw()` 也会老老实实走完、回调给你一个 ok，只是板上一个对象都没有。
  //   不单独量这一格，读数是"画板没认 0 条、建成 0 个"——干净得像全绿。
  判('★★ 真画板装起来了（ggbApplet 在）——不量这一格，板子死了读数也是全绿', F.ggb === 'object', 'typeof ggbApplet = ' + F.ggb);
  if (F.模块 !== 'object' || F.条数 !== 应装 || F.开关 !== true || F.ask !== 'function' || F.draw !== 'function' || F.failed !== 'function' || F.objects !== 'function' || F.ggb !== 'object') {
    console.error('★ 页面指纹不对（js/ggbcmds.js 没装 / 开关不是 true / 画板测试口子缺一个 / applet 没装起来）—— 整场读数作废。'); process.exit(2);
  }
  // ---- ★★ 尺子自检：这条路上"画成功"到底长什么样 ----
  //   为什么非要有这一格（2026-10-06 当场栽的）：我的第一版把 parseFences 的**块数组**
  //   直接交给了 `SR.board.draw()`（它要的是**一行一条**），于是每一格都读出
  //   "画板没认 0 条 / 板上建成 0 个"——**两个都是 0，干净得像全绿**，看着就是
  //   "模型什么都没写"。板子其实好好的（下面这条自检当场就能证明）。
  //   有了这一格，尺子一旦递错形状，**第一行就红了**，不会等我去读出一整张安安静静的表。
  {
    const r = await ev('(async function(){ SR.board.clear(); await new Promise(function(r){setTimeout(r,500);});'
      + ' var ok=null; await new Promise(function(res){ SR.board.draw(["A=(1,1)","B=(2,3)","Polygon(A,B,(0,3))"], function(o){ ok=o; res(); }); });'
      + ' await new Promise(function(r){setTimeout(r,400);});'
      + ' return JSON.stringify({ ok:ok, 清后:null, 没认:SR.board.failed(), 对象:SR.board.objects() }); })()');
    let J = null; try { J = JSON.parse(r); } catch (e) {}
    const 好 = J && J.ok === true && J.没认.length === 0 && J.对象.length >= 3;
    判('★★ 尺子自检：塞三条已知命令进去，画板真认、板上真建出 ≥3 个对象（这一格红了＝下面整场读数作废）',
      好, J ? ('画完=' + J.ok + '　没认 ' + J.没认.length + ' 条　建成 ' + J.对象.length + ' 个：' + J.对象.join('、')) : String(r));
    if (!好) { console.error('★ 尺子自检没过 —— 下面那些读数不作数，先修尺子。'); process.exit(2); }
  }
  console.log('每句打 ' + N + ' 次，两臂各跑一遍（cmds 开 / 关）\n');

  // ---- 一格 ----
  const 跑一格 = async (话, 开) => {
    const e = '(async function(){'
      + ' var 原 = SR.WORKS.draw.cmds; SR.WORKS.draw.cmds = ' + (开 ? 'true' : 'false') + ';'
      + ' var 流 = ""; var res = null, 炸 = null;'
      + ' try { res = await SR.api.ask({ work:"draw", history:[], text:' + JSON.stringify(话) + ','
      + '   onChunk:function(p){ 流 += p; }, onNotice:function(){} }); } catch(err){ 炸 = String(err && err.message || err); }'
      + ' var sys = SR.api.lastSystem || "";'
      + ' SR.WORKS.draw.cmds = 原;'                       // ★ 用完当场还原
      + ' if (炸) return JSON.stringify({ 炸: 炸 });'
      + ' if (res && res.error) return JSON.stringify({ 模型错: String(res.error).slice(0,200) });'
      + ' var 全文 = (res && res.text) || 流 || "";'
      // ★★ 这里踩过一次，别改回去：`parseFences().ggb` 是**一段一段**（每个围栏一整块，
      //   块里是带 \n 的多行），而 `SR.board.draw()` 要的是**一行一条**。
      //   第一版我直接把块数组递了过去 → `expand()` 把整块当一条命令 → evalCommand 不认
      //   　→ 读数成了"画板没认 0 条、板上建成 0 个"。**两栏都是 0，全是干净的 0**，
      //   看着就像"模型什么都没写"，其实是我这把尺子递错了形状。
      //   chat.js 自己那两处（:2235 / :2427）写的正是 `p.ggb[0].split("\\n")`。
      + ' var 块 = []; try { 块 = (SR.render.parseFences(全文).ggb) || []; } catch(e2){ 块 = []; }'
      + ' var 行 = 块.join("\\n").split("\\n").map(function(s){ return s.trim(); }).filter(function(s){ return s.length; });'
      + ' var 贴了 = SR.ggbcmds.卡.filter(function(c){ return sys.indexOf(c.体) >= 0; }).map(function(c){ return c.名; });'
      + ' SR.board.clear();'
      + ' await new Promise(function(r){ setTimeout(r, 500); });'
      + ' var 清后 = SR.board.objects().length;'
      + ' var 画完 = null, 没认 = [], 对象 = [];'
      + ' if (行.length) {'
      + '   await new Promise(function(r){ SR.board.draw(行, function(ok){ 画完 = ok; r(); }); });'
      + '   await new Promise(function(r){ setTimeout(r, 400); });'
      + '   没认 = SR.board.failed(); 对象 = SR.board.objects();'
      + ' }'
      + ' return JSON.stringify({ 贴了:贴了, 行数:行.length, 行:行, 清后:清后, 画完:画完,'
      + '   没认:没认, 对象:对象, 正文: 全文.slice(0, 500) });'
      + '})()';
    const r = await ev(e, 120);
    if (typeof r !== 'string' || r.indexOf('THROW') === 0) throw new Error('格子炸了：' + r);
    return JSON.parse(r);
  };

  const 汇总 = [];    // {键, 臂, 贴了, 行数, 没认数, 对象数, 命令样例, 板空吗}
  for (const c of 用例) {
    console.log('══ ' + c.键 + '：「' + c.话 + '」');
    console.log('   ' + c.要说清);
    const 两臂 = {};
    for (const 开 of [true, false]) {
      const 桩 = [];
      for (let i = 0; i < N; i++) {
        let r;
        try { r = await 跑一格(c.话, 开); }
        catch (e) { r = { 炸: String(e && e.message || e) }; }
        桩.push(r);
      }
      const 好 = 桩.filter(r => !r.炸 && !r.模型错);
      const 模型错 = 桩.filter(r => r.模型错 || r.炸);
      两臂[开 ? '开' : '关'] = 好;
      console.log('   臂 ' + (开 ? '★cmds 开' : '  cmds 关') + '：'
        + 好.length + '/' + N + ' 格跑通'
        + (模型错.length ? '　（模型侧没跑通 ' + 模型错.length + ' 格：' + String(模型错[0].模型错 || 模型错[0].炸).slice(0, 80) + '）' : '')
        + '　贴了签名：' + (好.length ? (好[0].贴了.join('、') || '（一条都没贴）') : '—'));
      for (const r of 好) {
        const 样例 = (r.行 || []).filter(x => x.trim() && x.trim().charAt(0) !== '#').slice(0, 3).join(' ‖ ');
        console.log('       围栏 ' + r.行数 + ' 条　清板后板上 ' + r.清后 + ' 个对象　画完=' + r.画完
          + '　**画板没认 ' + r.没认.length + ' 条**　板上建成 ' + r.对象.length + ' 个'
          + (r.没认.length ? '\n          没认的是：' + r.没认.join(' ‖ ') : '')
          + (样例 ? '\n          写了：' + 样例 : ''));
        汇总.push({ 键: c.键, 臂: 开 ? '开' : '关', 贴了: r.贴了, 行数: r.行数, 没认数: r.没认.length, 对象数: r.对象.length, 没认: r.没认 });
      }
    }
    // ---- 判 ----
    if (c.该贴.length) {
      判('★ 开的那一臂真贴上了 ' + c.该贴.join('、'), (两臂.开[0] && c.该贴.every(n => 两臂.开[0].贴了.indexOf(n) >= 0)),
        两臂.开[0] ? (两臂.开[0].贴了.join('、') || '（一条都没贴）') : '没跑通');
      判('   └ ★ 对照臂（cmds 关）一条都贴不上（保证上面那条不是恒绿）',
        !两臂.关.length || 两臂.关.every(r => r.贴了.length === 0),
        (两臂.关[0] && 两臂.关[0].贴了.join('、')) || '（一条都没贴）');
    } else {
      判('★ 对照句两臂都一条没贴（门表本来就不认这句）',
        两臂.开.every(r => !r.贴了.length) && 两臂.关.every(r => !r.贴了.length));
    }
    // ★★ 对照句的两臂**本来就该读出一样的东西**（同一句话，门表不认 → 喂给模型的
    //   system 逐字相同）。所以这里**不判**"读数一样"——那是我第一版写错的断言：
    //   提示词一样 ≠ 模型两遍写得一样。模型是**随机**的，同一条提示词跑两遍也会翻盘
    //   （[[llm-judgment-not-reproducible]]）。把它判成"尺子在抖"，等于拿模型的抖动
    //   去给尺子定罪——红的样子跟尺子坏了长得一样，其实是这句断言在量一个不存在的东西。
    //   它真正的用处是**报一个噪声地板**：同一个提示词的两臂能差多少。下面总账里那个
    //   "两臂差值"必须**大于这个地板**才敢读成 ③ 的效果。
    // ★★ 每格都核一次"清板是真清了"——两格共享一块板会把上一格的残留量进来
    判('   └ 每格开画前板是空的（清板真清了，不是量的上一格的残留）',
      两臂.开.concat(两臂.关).every(r => r.清后 === 0),
      两臂.开.concat(两臂.关).map(r => r.清后).join('/'));
  }

  // ---- 总账 ----
  console.log('\n══ 两臂总账（画板"没认"的条数才是 ③ 治的那个病）══');
  const 键表 = 用例.map(c => c.键);
  const 格 = (臂, k) => 汇总.filter(r => r.臂 === 臂 && r.键 === k);
  const 和 = a => a.reduce((s, x) => s + x, 0);
  console.log('  句子            臂     围栏条数   画板没认   板上建成');
  for (const k of 键表) {
    for (const 臂 of ['开', '关']) {
      const g = 格(臂, k);
      console.log('  ' + k.padEnd(14) + 臂 + '    ' + String(和(g.map(r => r.行数))).padStart(6) + '    '
        + String(和(g.map(r => r.没认数))).padStart(8) + '    ' + String(和(g.map(r => r.对象数))).padStart(6));
    }
  }
  // ★★ 噪声地板：对照句两臂喂的 system **逐字相同**（门表不认它，③ 一个字符都没加），
  //   所以这两列之间的差别**一点都不是 ③ 干的**，全是模型自己的抖动。
  //   这就是这把尺子的分辨率——下面那个"两臂差值"如果不比它大，就没资格读成效果。
  const c开 = 格('开', 'ctrl-none'), c关 = 格('关', 'ctrl-none');
  const 地板行 = Math.abs(和(c开.map(r => r.行数)) - 和(c关.map(r => r.行数)));
  const 地板没认 = Math.abs(和(c开.map(r => r.没认数)) - 和(c关.map(r => r.没认数)));
  console.log('\n  ★ 噪声地板（对照句·两臂提示词逐字相同，差值只可能来自模型抖动）'
    + '：围栏 ±' + 地板行 + ' 条　画板没认 ±' + 地板没认 + ' 条'
    + '　（开 ' + 和(c开.map(r => r.行数)) + '/' + 和(c开.map(r => r.没认数))
    + '　关 ' + 和(c关.map(r => r.行数)) + '/' + 和(c关.map(r => r.没认数)) + '）');

  const sigKeys = 键表.filter(k => k.indexOf('sig-') === 0);
  const 开没认 = 和(sigKeys.map(k => 和(格('开', k).map(r => r.没认数))));
  const 关没认 = 和(sigKeys.map(k => 和(格('关', k).map(r => r.没认数))));
  const 开对象 = 和(sigKeys.map(k => 和(格('开', k).map(r => r.对象数))));
  const 关对象 = 和(sigKeys.map(k => 和(格('关', k).map(r => r.对象数))));
  console.log('  四句签名题合计：cmds 开 → 画板没认 ' + 开没认 + ' 条 / 板上建成 ' + 开对象 + ' 个'
    + '　　cmds 关 → 没认 ' + 关没认 + ' 条 / 建成 ' + 关对象 + ' 个'
    + '　（差 ' + (开没认 - 关没认) + ' 条 / ' + (开对象 - 关对象) + ' 个）');
  // ★ 差值比地板小 = 这一趟**读不出效果**（不是"没效果"，是这把尺子分不出来）。只印不判：
  //   把它判红等于说"③ 没用"，那句话这趟数据撑不起来；判绿更糟。
  const 读得出 = Math.abs(开没认 - 关没认) > 地板没认;
  console.log('  ⚠ 两个读数不是结论。' + (读得出
    ? '差值（' + (开没认 - 关没认) + ' 条）已超过噪声地板（±' + 地板没认 + ' 条）——**仍要**逐格看它真写了哪条命令，'
      + '再决定这个差值算不算 ③ 的功劳。'
    : '差值（' + (开没认 - 关没认) + ' 条）**没有超过**噪声地板（±' + 地板没认 + ' 条）——'
      + '这一趟读不出 ③ 的效果，别把"分不出来"说成"没有用"，也别把它说成"有用"。'));

  const 复位 = await ev('SR.WORKS.draw.cmds');
  判('★ 探针没把页面上的开关留在翻过的状态（用完还原）', 复位 === true, '现值 ' + 复位);

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  ws.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });
