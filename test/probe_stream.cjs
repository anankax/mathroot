// 「对话流」目标形态的尺子（阶段 A：先造尺子，此时产品还没改，预期红）。
//
// 量的是**目标形态**，不是现状：
//   ② 首屏 = #msgs 里第一条助手消息**里面**的六张卡（不再是旁边盖住整屏的一层 #landing）
//   ③ 点一张卡：首条折叠、工位按上、光标进框、抽屉关着、画板不忙
//   ① 收掉首屏**之后**对话栏仍居中、右栏不再把话说挤到左边   ← 注意：不是量首屏那一屏
//   ④ 抽屉关着时画板**仍是全尺寸**（专抓 display:none：离屏出图会静默缩成 240×60）
//   ⑤ 点「再摆弄」抽屉滑出来
//   ⑥ 产物长在**它自己那条气泡里**（冻图 / 卷子卡 / 想说）
//   ⑦ ★ 冻图 == 板上的图（专抓 SR.figures.linesOf 那个前置 #清空 的坑）
//   ⑧ 流水线跟着回复走
//   ⑨ 硬约束回归：模型回复的气泡都有 copybar，刷新后仍在
//
// ★★ 两条量错过的坑，记在这儿别再犯：
//   ① 一开始把「居中」量在**首屏那一屏**上 → 假绿。那一屏被
//      `body[data-landing="1"] main{grid-template-columns:minmax(0,1fr)}` 压成了单列，
//      是**唯一**已经居中的一屏。收掉首屏之后 main 是两列（804.969px 593.031px）、
//      左 14 右 621。要量的是**收屏之后**。
//   ② 一開始把「每条 assistant 气泡都有 copybar」照 DOM 数量断言 → 假红。
//      #msgs 第一条是 landing.js 的开场白（"传一份你学校的模板…"），它**本来就没有**
//      copybar，不是坏了。预期数要拿 **SR.memo 里 assistant 的条数**，不是气泡数。
//
// ★ 可见性一律量 getClientRects().length，绝不读 getComputedStyle().display。
// ★ 核「改动生效没生效」前先 Network.setCacheDisabled **硬重载**，别吃同源缓存。
// ★ 干净档案是**注入出来的**（内存版 localStorage），不碰孔老师真浏览器里那份。
//
// 跑法：node test/probe_stream.cjs
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PAGE = process.env.SR_PAGE || 'http://localhost:8138/index.html';
const OUT = path.join(__dirname, '_shot');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });

// ★★ 底下这层垫子**必须靠 window.name 兜底**，不能用模块里的一个空对象。
//   原因：它是 Page.addScriptToEvaluateOnNewDocument 注入的，**每次导航都会重跑**。
//   用空对象的话，Page.reload 的那一刻它给自己重置成一张新空表 —— memo 里那一场
//   对话是探针自己擦掉的，却看起来像"产品刷新后没接回来"。
//   （老探针 probe_repaint_fence.cjs 里那句"重载后 memo 里那条不见了（别的标签页
//     把它盖了？）"就是这个，一直被记成了别人的锅。）
//   window.name 同一个标签页内跨导航存活，正好当这块垫子的底。
const CLEAN = `(function(){
  var KEY = '__sr_probe_ls__';
  var m = {};
  try { m = JSON.parse(window.name && window.name.indexOf(KEY) === 0 ? window.name.slice(KEY.length) : '{}') || {}; } catch (e) { m = {}; }
  function persist(){ try { window.name = KEY + JSON.stringify(m); } catch(e){} }
  var shim = { getItem:function(k){return Object.prototype.hasOwnProperty.call(m,k)?m[k]:null},
    setItem:function(k,v){m[k]=String(v); persist();}, removeItem:function(k){delete m[k]; persist();},
    clear:function(){m={}; persist();},
    key:function(i){return Object.keys(m)[i]||null}, get length(){return Object.keys(m).length} };
  try{Object.defineProperty(window,'localStorage',{configurable:true,get:function(){return shim}})}catch(e){}
  try{Object.defineProperty(window,'sessionStorage',{configurable:true,get:function(){return shim}})}catch(e){}
})();`;

// 两条**累积**的围栏：第一条把 A、B 两个点摆上；第二条只说「连起来」。
// 板是累积的（board.openNew 不清空），所以第二条的冻图里必须**同时有 A、B 和线段**。
//
// ★★ 两个点**必须离轴**（A=(-3,1)、B=(2,2)），这是 2026-10-03 用血换来的：
//   第一版写的是 `数轴 / A=(-2,0) / B=(3,0)`，两个点**正好落在刚画好的那条数轴上**，
//   于是 `线段(A,B)` 画出来的东西**跟轴上已有的那截完全重合** —— 画面一个像素都没变，
//   两张冻图的字节数一模一样。⑦ 因此红了，而我差点去查产品。
//   查法：借板按 freezeFences 的顺序各画一次、把 PNG 存下来**用眼睛看**
//   （test/_diag_freeze.cjs），一眼就能看见"线段压在轴上"。
//   **尺子量的是它自己构造出来的退化场景，不是产品。**
//   换成离轴的点之后同一个诊断给出：A、B 两张图不同；再补一组对照
//   （`#清空` 后画线段）→ A、B、线段**全部消失**、只剩坐标轴 —— 这是"真被洗了"的样子，
//   也就是 ⑦ 红得起来的证据。
const F1 = 'A=(-3,1)\nB=(2,2)';
const F2 = '线段(A,B)';
const RAW = '```ggb\n' + F1 + '\n```\n先把两个点摆上。\n'
          + '```ggb\n' + F2 + '\n```\n再把两点连起来。\n'
          + '```想说\n换一组数据\n让它动起来\n看这个变化\n```\n';

// ═══════════════════════════════════════════════════════════════════════
// 红验（RED=1）：把 `css/main.css` **这一个响应**换成改坏的那一份。
//   ★ 只用 CDP 换响应，**磁盘上那个文件一个字节都不动**（改坏再还原不算数：
//     中途炸了就把坏文件留在盘上，"还原"这一步没人验）。
//   ★ 判据是「**换到了没有**」而不是「红没红」：没换到的那一趟跑的是真产品，
//     全绿也当不了"尺子灵"的证据 —— 那就是在**没改的那份上**跑出的全绿。
//   ① 把 `#msgs > .msg:not(.landing)` 那层收窄去掉 → 等于回到阶段 C 之前那条
//      `body[data-landing="1"] #msgs{display:none}`：首屏一收，连刚重建出来的
//      开场白一起藏住（就是 D1 那个 bug）。断言 ②/③ 必红。
//   ② `.drawer` 收起态改回 `display:none` → 断言 ④ 必红（canvas 静默缩水成 240×60）。
//   ③ js/chat.js 里把冻图那条路换成**每张都补 #清空**（就是 linesOf 的坏法）→ 断言 ⑦ 必红。
//      这一条最要紧：⑦ 是阶段 D 唯一一条"专抓某个具体 bug"的断言，
//      不证它红得起来，就没法排除"它其实恒绿"。
//
// ★★ 三组红验要**分开跑**（`RED=css` 与 `RED=js`），不能一锅端。
//   原因是硬的：② 把抽屉改成 `display:none` 之后，画板量到 0×0，
//   后面**所有**跟冻图有关的断言都会跟着崩 —— 一趟里既改 CSS 又改 chat.js，
//   ⑦ 红了也说不清是"JS 那个坑"还是"画板被 CSS 弄没了"。
//   实测（一锅端那一趟）：⑦ 红是红了，但两张图变成 474×114、墨都是 1282，
//   那是画板塌掉的样子，不是 #清空 的样子。**红的理由不对，等于没证。**
//   ④ `.hasprod` 那条定宽拿掉 → ⑥c 必红（占位瘦成一条、点一下还会跳）。
//   ⑤（阶段 F）`fold`：把 `.flowbox.done:not(.open) #flowlist{display:none}` 拿掉
//      → 只该红"⑧ 跑完折成表头一行"那几条。
//   ⑥（阶段 F）`unhook`：让重画前**不再攥住** `#flowbox` 的引用（等于从来不攥）
//      → 只该红 ⑧b 那几条（脱档之后 `getElementById` 再也找不到它）。
//      ⑤⑥ 也**必须分开**：一锅里"没折"和"流水线没了"长得一模一样。
//   ⑦（阶段 G）`chips`：把「想说」那一盒塞回**输入框上面那个常驻容器**
//      → 只该红 ⑩/⑩b 那几条。
//   ⑧（阶段 H 收尾）`star`：把 `**` 塞回 js/flow.js 的 `what` → 只该红 ⑧c 那两条。
//      这一组单跑，因为它换的是**第三个文件**（flow.js），跟前几组不共文件。
//   RED=1/`css` → ① ②；RED=3/`js` → ③；RED=fold → ⑤；RED=unhook → ⑥；
//   RED=chips → ⑦；RED=star → ⑧c；RED=all → 全一锅（只当烟雾用，红了别信它的理由）。
const REDMODE = process.env.RED || '';
const RED = !!REDMODE;
const DO_CSS = REDMODE === '1' || REDMODE === 'css' || REDMODE === 'all';
const DO_JS = REDMODE === '3' || REDMODE === 'js' || REDMODE === 'all';
// ④ 单独一组，**不能跟 ①② 一锅端**：② 把抽屉改成 display:none 之后画板量到 0×0，
//   「点占位真画出来」那条会跟着崩 —— ⑥c 红了也说不清是"气泡没定宽"还是"画板没了"。
//   实测教训见上面 ⑦ 那段（红的理由不对，等于没证）。
const DO_PROD = REDMODE === '4' || REDMODE === 'hasprod' || REDMODE === 'all';
// ⑧（阶段 F）**必须分两组**，跟 ④ 那条同一个道理：折叠是 css 的事、
//   脱档是 js 的事，混在一趟里，红了就分不清是"没折"还是"流水线没了"。
//   `fold` = 把那条折叠规则拿掉 → 只该红"折成一行"那几条；`unhook` = 让 js 不再
//   攥住节点引用（等于从来没攥过）→ 只该红 ⑧b 那几条。
const DO_FOLD = REDMODE === 'flow' || REDMODE === 'fold' || REDMODE === 'all';
const DO_UNHOOK = REDMODE === 'unhook' || REDMODE === 'all';
// ⑩（阶段 G）`chips`：把那一盒选项塞回**输入框上面那个常驻容器**（阶段 G 之前的写法）
//   → 只该红 ⑩/⑩b 那几条（"在最后那条气泡里""整场只有一盒""老容器里一颗不剩"）。
//   跟 `fold`/`unhook` 分开跑：那条路红了，屏幕上跟"按钮根本没出来"是一样的，
//   一锅里混着就说不清是搬错了地方还是压根没摆。
const DO_CHIPS = REDMODE === 'chips' || REDMODE === 'all';
// ⑧c（阶段 H 收尾）`star`：把 `**` 塞回 js/flow.js 的 `what` 字段（就是它当年那个样子）
//   → 只该红 ⑧c 那两条。★ 这一组量的是**整族**毛病：给纯文本落点（textContent / title）
//   的串里写了 markdown 星号，星号不会变成粗体、只会原样露在老师眼前。
//   2026-10-03 走真路在页面上撞见的就是它（模板库那句"下面这张卡是**它认出来的东西**"）。
const DO_STAR = REDMODE === 'star' || REDMODE === 'all';
let SAB = null, SABJS = null, SABFLOW = null, SAB_WHY = [], SAB_HIT = false, SABJS_HIT = false, SABFLOW_HIT = false;
if (RED) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'css', 'main.css'), 'utf8');
  let j = fs.readFileSync(path.join(__dirname, '..', 'js', 'chat.js'), 'utf8');
  let fl = fs.readFileSync(path.join(__dirname, '..', 'js', 'flow.js'), 'utf8');
  // ⚠ 搜索串必须**逐字照源码**（连缩进和空格）。对不上就直接退出，
  //   报了"红验作废"总好过一片假绿。
  const cuts = [];
  if (DO_CSS) cuts.push(
    ['body[data-landing="1"] #msgs > .msg:not(.landing),',
      'body[data-landing="1"] #msgs,',
      '① 首屏亮着时把整栏藏掉（回到阶段 C 之前那条）'],
    ['transform: translateX(calc(100% + 24px)); visibility: hidden;',
      'display: none; visibility: hidden;',
      '② 抽屉收起态改回 display:none']);
  if (DO_PROD) cuts.push(
    ['.msg .bubble.hasprod { width: 88%; }',
      '/* 红验：这条定宽被拿掉了 */',
      '④ 带产物的气泡不再定宽 → ⑥c 必红（占位瘦成一条、点一下还会跳）']);
  if (DO_FOLD) cuts.push(
    ['.msg .bubble .flowbox.done:not(.open) #flowlist { display: none; }',
      '/* 红验：这条折叠规则被拿掉了 */',
      '⑧ 跑完不再折起来 → ⑧ 那几条"折成表头一行"必红']);
  for (const [find, to, why] of cuts) {
    if (s.indexOf(find) < 0) {
      console.error('★★ 红验作废：css/main.css 里找不到这一处 —— ' + why + '\n   ' + JSON.stringify(find));
      process.exit(3);
    }
    s = s.replace(find, to);
    SAB_WHY.push(why);
  }
  // ③ 冻图那个坑的正脸：把「只第 1 张补清空」改成「每张都补」。
  if (DO_JS) {
    const jfind = "if (n === 0) lines = ['#清空'].concat(lines);";
    if (j.indexOf(jfind) < 0) {
      console.error('★★ 红验作废：js/chat.js 里找不到那一行 —— ③ 冻图每张都补 #清空\n   ' + JSON.stringify(jfind));
      process.exit(3);
    }
    j = j.replace(jfind, "lines = ['#清空'].concat(lines);");
    SABJS = j;
    SAB_WHY.push('③ 冻图那条路改成**每张围栏都补 #清空**（等于误用 SR.figures.linesOf）');
  }
  // ⑧b 那个坑的正脸：**不攥住**节点引用（等于 `flowEl` 这份缓存根本不存在）。
  //   ⚠ 切点必须落在 `flowBox()` **之后**：那一行是"攥到手上"，紧跟其后的
  //     `els.msgs.innerHTML = ''` 才把它掀脱档。要是写成 `flowEl = null; flowBox();`
  //     （清零在前），`flowBox()` 当场又会 `getElementById` 把它捡回来 —— 节点此刻
  //     还在文档里 —— 于是什么都没坏、⑧b 照绿，红验变成一次假证。
  //     顺序反过来（先攥后扔）才是"从来没攥过"：下一句 `innerHTML = ''` 之后
  //     `flowEl` 是空的，`homeFlow` 再去 `getElementById` 就只剩 null。
  if (DO_UNHOOK) {
    const jfind = '    flowBox();';
    if (j.indexOf(jfind) < 0) {
      console.error('★★ 红验作废：js/chat.js 里找不到那一行 —— ⑧b 攥住引用\n   ' + JSON.stringify(jfind));
      process.exit(3);
    }
    j = j.replace(jfind, '    flowBox(); flowEl = null;   /* 红验：攥到手就扔掉 */');
    SABJS = j;
    SAB_WHY.push('⑧b 重画前不再攥住 #flowbox 的引用 → 脱档之后找不回来，⑧b 必红');
  }
  // ⑩ 那个坑的正脸：这一盒选项**塞回输入框上面那个常驻容器**（阶段 G 之前的写法）。
  //   ⚠ 锚点要用两行：`bubble.appendChild(box);` 这一句在 chat.js 里有三处
  //     （冻图那格、卷子卡、这里），只按一行换会换错人 —— 那不是红验，那是把别处改坏。
  //     所以拿"紧接着的那句 `curChips = box;`"把范围锁死在 showChips 里。
  //   ⚠⚠ 跨行的锚点**必须容忍 CRLF**：`js/chat.js` 落盘是 `\r\n`（实测：
  //      `j.indexOf('    bubble.appendChild(box);\n    curChips = box;')` = −1，
  //      而它明明就在 1176-1177 两行上）。单行锚点碰不到这个坑，一跨行就必踩。
  //      所以这里用 `\r?\n` 的正则，别用字面量字符串。
  //   ★★ 2026-10-03（阶段 H）改的：原来这里就是把 `box` 塞给 `#chips`。阶段 H 把
  //     `#chips` 从 index.html 删了，`getElementById('chips')` 恒返回 null ——
  //     再照老写法替换，`null.appendChild` 会当场抛异常，整趟跑没有汇总行，
  //     红验就成了一次"看起来红了"的假证（红在抛异常上，不在断言上）。
  //   ⇒ 变异改成"**把那个常驻容器再长回来**"：拿不到就现造一个挂到 body 上。
  //     这样它红的理由跟老写法**一模一样**（盒子不在气泡里、页面上多出一个跟轮次
  //     无关的固定窝），而且还顺带证明了新加的那条"老容器确实没了"是**能红的**
  //     —— 一条谁也红不了的断言等于没写。
  if (DO_CHIPS) {
    const jfind2 = /    bubble\.appendChild\(box\);\r?\n    curChips = box;/;
    if (!jfind2.test(j)) {
      console.error('★★ 红验作废：js/chat.js 里找不到 showChips 那两句 —— ⑩ 塞回常驻容器\n   '
        + String(jfind2));
      process.exit(3);
    }
    j = j.replace(jfind2,
      "    var _c=document.getElementById('chips');\n"
      + "    if(!_c){ _c=document.createElement('div'); _c.id='chips'; document.body.appendChild(_c); }\n"
      + "    _c.appendChild(box);\n"
      + "    curChips = box;   /* 红验：又把常驻容器长回来 */");
    SABJS = j;
    SAB_WHY.push('⑩ 「想说」塞回一个跟轮次无关的常驻容器（阶段 G 之前的写法）→ ⑩/⑩b 必红');
  }
  // ⑧c 那个坑的正脸：`**` 塞回 `what`（步骤名上那个 title）**和** kbNote（附注）。
  //   两处走的是两个不同的口子，一条红了证不到另一条。
  //   `what` 是每一步都有的，红得稳；kbNote 那支要挑**本机真会走到**的（见下面那段）。
  if (DO_STAR) {
    const ffind = "what: '孔老师自己写的 118 条问法，一次只给一条——";
    if (fl.indexOf(ffind) < 0) {
      console.error('★★ 红验作废：js/flow.js 里找不到那一行 —— ⑧c 星号塞回 what\n   ' + JSON.stringify(ffind));
      process.exit(3);
    }
    fl = fl.replace(ffind, "what: '孔老师自己写的 118 条问法，一次**只给一条**——");
    SAB_WHY.push('⑧c 往 `what` 里塞回 markdown 星号（`**只给一条**`）→ ⑧c 的 title 那条必红');
    // 附注那一条也给它一个正脸（kbNote 走的是另一个口子，光改 `what` 证不到它）。
    // ⚠★ 这一支是**量出来的，不是猜的**。第一版我瞄的是 kbNote 的 `!hits` 那支
    //   （'这台机器上没有这份语料，这一步整个跳过'），跑 RED=star **只有 1 条红** ——
    //   因为**本机是有语料的**（SR.kb 从注入的 localStorage 里来），那支根本走不到。
    //   把 7 格附注的字面捞出来看，实走的是末行那支 `'翻到 N 条过线的：'`。
    //   现在改瞄这一支，跟实测到的那 7 格里的 2 格（教材 / 抓问）对得上。
    //   ⚠ 万一哪天本机语料没了，这一支会退成 `!hits`，那条**红**就变成"没红" ——
    //     下面这句 console 会当场喊出来，别把它当绿。
    const nfind = "return '翻到 ' + kept + ' 条过线的：'";
    if (fl.indexOf(nfind) < 0) {
      console.error('★★ 红验作废：js/flow.js 里找不到 kbNote 那条「翻到 N 条过线的」—— ⑧c 星号塞回附注\n   ' + JSON.stringify(nfind));
      process.exit(3);
    }
    fl = fl.replace(nfind, "return '**翻到** ' + kept + ' 条过线的：'");
    SABFLOW = fl;
    SAB_WHY.push('⑧c 往 kbNote 的「翻到 N 条过线的」里塞回 markdown 星号（`**翻到**`）→ ⑧c 的附注那条必红');
  }
  SAB = (DO_CSS || DO_PROD || DO_FOLD) ? s : null;
  console.log('⚠⚠ 红验模式（' + REDMODE + '）：这一趟跑的是**改坏的那一份** ——\n    '
    + SAB_WHY.join('\n    ') + '\n    （磁盘上那几个文件一个字节都没动）\n');
}

let PASS = 0, FAIL = 0, TODO = 0;
const ok = (c, what, got) => {
  if (c) { console.log('  ✓ ' + what); PASS++; return true; }
  console.log('  ✗ ' + what + '    ← 实际拿到：' + JSON.stringify(got)); FAIL++; return false;
};
const later = what => { console.log('  ○ 未验（留到后面阶段）：' + what); TODO++; };

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => {
    const r = JSON.parse(m);
    // 红验：把被换掉的那两份响应塞进去，别的原样放过（continueRequest）。
    if (r.method === 'Fetch.requestPaused' && r.params) {
      const p = r.params;
      const put = (body, mime) => send('Fetch.fulfillRequest', {
        requestId: p.requestId, responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: mime },
          { name: 'Cache-Control', value: 'no-store' }],
        body: Buffer.from(body, 'utf8').toString('base64'),
      });
      if (SAB && /\/css\/main\.css(\?|$)/.test(p.request.url)) {
        SAB_HIT = true; put(SAB, 'text/css; charset=utf-8');
      } else if (SABJS && /\/js\/chat\.js(\?|$)/.test(p.request.url)) {
        SABJS_HIT = true; put(SABJS, 'text/javascript; charset=utf-8');
      } else if (SABFLOW && /\/js\/flow\.js(\?|$)/.test(p.request.url)) {
        SABFLOW_HIT = true; put(SABFLOW, 'text/javascript; charset=utf-8');
      } else {
        send('Fetch.continueRequest', { requestId: p.requestId });
      }
      return;
    }
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; }
  });
  await new Promise(r => ws.on('open', r));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await send('Page.enable', {}); await send('Runtime.enable', {}); await send('Network.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  // ★ Fetch.enable 必须赶在 Page.navigate **之前**，否则这一次导航的 CSS 就是真货。
  if (RED) await send('Fetch.enable', { patterns: [
    { urlPattern: '*css/main.css*', requestStage: 'Request' },
    { urlPattern: '*js/flow.js*', requestStage: 'Request' },
    { urlPattern: '*js/chat.js*', requestStage: 'Request' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: CLEAN });
  // ★★ ev() 页面里一炸就**抛**，绝不返回一个字符串。
  //   第一版写的是 `return 'THROW: ' + …`，而就绪循环写的是 `if (await ev('!!(window.SR…')) break;`
  //   —— 字符串是**真值**，于是页面还没起来（SR is not defined）就被判成"已就绪"，
  //   后面每一条断言都量在一个**空上下文**上。硬重载之后尤其明显：
  //   实测看到的是 `memo: ["ERR SR is not defined"]、气泡数 0`，
  //   差一点就把它当成"产品刷新后没把对话接回来"。
  //   ★ 同一个写法在 test/_walk8.cjs 里也有（那边只导航一次，撞上的概率低，但同样该改）。
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      throw new Error('页面里炸了：' + String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).slice(0, 200));
    }
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const shot = async n => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, 'st-' + n + '.png'), Buffer.from(s.result.data, 'base64')); };
  const up = async () => {
    let good = 0;                       // 连续三次都答得上来才算真的起来了
    for (let i = 0; i < 200 && good < 3; i++) {
      try { good = (await ev('!!(window.SR && SR.chat && SR.board && SR.landing)')) === true ? good + 1 : 0; }
      catch (e) { good = 0; }           // 上下文还没建立 —— 这**不算**就绪
      await sleep(250);
    }
    if (good < 3) throw new Error('等了 50 秒页面也没起来');
    // ★ 等的是 **`<canvas>` 本身**（下游每条断言量的都是它），不是 GeoGebra 那个
    //   `.applet_scaler.ggbTransform` 外壳 —— 实测外壳先出现、canvas 后出现，中间隔一段。
    //   第一版等的是外壳，于是 ④ 偶尔量到 `#ggb` 里还没有 canvas（`canvas宽:null`）；
    //   那**不是产品坏了**（`SR.board.clear()` 只调 `newConstruction()`，从不拆 applet），
    //   是**尺子量早了** —— 一条约一半概率抖动的尺子不合格。
    // ★★ 而且等不到就**抛**，不许像第一版那样默默往下走：静默超时会把"尺子没等到"
    //   伪装成"产品把画板弄没了"，正是最该避免的那种假红。
    let canvasIn = false;
    for (let i = 0; i < 80; i++) {
      try { if (await ev('!!document.querySelector("#ggb canvas")')) { canvasIn = true; break; } } catch (e) {}
      await sleep(300);
    }
    if (!canvasIn) throw new Error('等了 24 秒 #ggb 里也没长出 canvas —— 别当产品故障，先查 applet 有没有加载出来');
    await sleep(1200);
  };
  // 桩：把模型这一轮喂成「两条 ggb + 一条想说」的原文
  const stub = raw => ev(`(function(){
    var RAW = ${JSON.stringify(raw)};
    try{ SR.api.ready = function(){ return true; }; }catch(e){}
    window.fetch = function(){
      var s = 'data: ' + JSON.stringify({choices:[{delta:{content: RAW}}]}) + '\\n\\ndata: [DONE]\\n\\n';
      return Promise.resolve(new Response(s,{status:200,headers:{"Content-Type":"text/event-stream"}}));
    };
    return 1; })()`);
  const fire = async text => {
    await ev(`(function(){var i=document.getElementById('input');i.focus();i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));return 1})()`);
    await sleep(250);
    await ev('document.getElementById("send").click(); 1');
    for (let s = 0; s < 80; s++) { await sleep(400); if (!(await ev('document.getElementById("send").disabled'))) break; }
    await sleep(800);
  };

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE }); await up();

  const n = await ev('(function(){try{return localStorage.length}catch(e){return "ERR"}})()');
  const GREET = await ev(`document.querySelectorAll('#msgs .msg.assistant').length`);
  console.log('这次是干净档案（localStorage 里 ' + n + ' 条）；开屏时 #msgs 里已有 ' + GREET + ' 条助手气泡（landing.js 的开场白）\n');

  // ---- ② 首屏 = 第一条消息里的六张卡 ----
  console.log('② 首屏是 #msgs 第一条助手消息**里面**的六张卡');
  const first = await ev(`(function(){
    var m=document.getElementById('msgs'), f=m?m.children[0]:null;
    var bs=f?[].slice.call(f.querySelectorAll('.lblock')):[];
    var l=document.getElementById('landing');
    return {首条是助手气泡:!!(f&&f.classList&&f.classList.contains('assistant')),
            卡片数:bs.length,
            左边缘:bs.map(function(b){return Math.round(b.getBoundingClientRect().left)}),
            卡片都看得见:bs.length>0 && bs.every(function(b){return b.getClientRects().length>0}),
            独立landing还看得见:l?l.getClientRects().length>0:false};})()`);
  console.log('   ' + JSON.stringify(first));
  ok(first.卡片数 === 6 && first.卡片都看得见, '② 六张卡长在首条助手气泡里、都看得见', first);
  ok(first.左边缘.length === 6 && first.左边缘.every(x => x === first.左边缘[0]), '② 六张卡一列', first.左边缘);
  ok(first.独立landing还看得见 === false, '② 旧的那层 #landing 不再单独占屏', first.独立landing还看得见);
  await shot('a1-首屏');

  // ---- ③ 点一张卡 ----
  // ★ 点的是「备课」不是「组卷」：SR.DEFAULT_WORK 就是 'material'，
  //   点组卷的话 `getWork()==='material'` 不点也成立 —— 那是**假绿**，量的是默认值。
  //   备课不是默认值，按上了才说明这一下真点着了；而且备课带 copy:true，⑨ 正好接着用它。
  // ★ 选择器不写 `#msgs .lblock`：现在卡片还在旁边那个 #landing 里（阶段 C 才搬进气泡），
  //   写死 #msgs 会连一个都选不着 —— 第一版就是这么空点了一下，然后 ① 又量回首屏去了。
  console.log('\n③ 点「备课」那张卡');
  const clicked = await ev(`(function(){
    var b=document.querySelector('.lblock[data-work="prep"]');
    if(!b) return 'no-card';
    b.click(); return b.getAttribute('data-work'); })()`);
  console.log('   点到的卡：' + clicked);
  ok(clicked === 'prep', '③ 前提：真的点到「备课」那张卡了', clicked);
  await sleep(1800);
  const after = await ev(`(function(){
    var m=document.getElementById('msgs'), f=m?m.children[0]:null;
    var d=document.getElementById('drawer');
    var l=document.getElementById('landing');
    // ★ 量的是**效果**（那六张卡还看得见几张），不是某个手法。
    //   2026-10-03 第一版量的是「m.children[0].querySelector('.lblocks')」在不在——
    //   那等于钉死"首屏那条消息必须还在、只是折叠"，可产品要的是**这块让开**：
    //   整条抽走（现在的做法）和就地折叠都算让开。按手法写断言，等于把实现焊进尺子里。
    var vis=0;
    [].slice.call(document.querySelectorAll('#msgs .lblock')).forEach(function(b){ if(b.getClientRects().length) vis++; });
    return {首屏收掉了:!document.body.hasAttribute('data-landing'),
            旧landing还看得见:l?l.getClientRects().length>0:false,
            首屏卡还看得见:vis,
            工位:SR.chat.getWork(), 光标在输入框:document.activeElement===document.getElementById('input'),
            active是什么:(function(){var a=document.activeElement;return a?(a.tagName+(a.id?'#'+a.id:'')):'null'})(),
            页面有焦点:document.hasFocus(),
            抽屉存在:!!d, 抽屉状态:d?d.getAttribute('data-drawer'):'(没有抽屉)',
            画板忙:SR.board.isBusy()};})()`);
  console.log('   ' + JSON.stringify(after));
  ok(after.首屏收掉了 && after.旧landing还看得见 === false, '③ 点一下首屏就收了', after);
  ok(after.工位 === 'prep', '③ 工位按到了「备课」（不是默认值）', after.工位);
  ok(after.首屏卡还看得见 === 0, '③ 收屏时那六张卡跟着让开（不是还挂在上面）', after.首屏卡还看得见);
  // ★ D2：这条**会抖** —— 实测 3 次里 1 次红。`pick()` 确实 `t.focus()` 了，但首屏一收、
  //   右栏从 display:none 变回来 → 板子重排 → GeoGebra applet 把焦点抢到 canvas 上。
  //   红不是尺子坏了，是产品真会丢光标（老师点完卡片打字，一个字都不进去）。
  //   阶段 B 把画板改成 transform+visibility 收起之后**重量复验**，不许假设它自己好了。
  ok(after.光标在输入框, '③ 光标落在输入框里（★ D2：会抖，1/3 红）', after.光标在输入框);
  ok(after.抽屉存在 && after.抽屉状态 === 'closed', '③ 抽屉此时是关着的', after);
  ok(after.画板忙 === false, '③ 画板不忙', after.画板忙);
  await shot('a2-点完卡片');

  // ---- ① 收掉首屏之后，对话栏仍居中 ----
  console.log('\n① 收掉首屏**之后**对话栏仍居中（这才是要量的那一屏）');
  const geo = await ev(`(function(){
    var m=document.getElementById('msgs');
    var col=m?(m.closest('.col')||m.parentElement):null;
    if(!col) return 'no-col';
    var r=col.getBoundingClientRect();
    var side=document.querySelector('.side');
    var main=document.querySelector('main');
    return {左:Math.round(r.left), 右:Math.round(innerWidth-r.right), 宽:Math.round(r.width),
            landing:document.body.getAttribute('data-landing'),
            右栏还看得见:side?side.getClientRects().length>0:null, 窗口宽:innerWidth,
            main列:main?getComputedStyle(main).gridTemplateColumns:null};})()`);
  console.log('   ' + JSON.stringify(geo));
  // ★ 判「不再有两栏」量的是 **main 的列数**，不是"还能不能找到 .side 这个节点"：
  //   节点还在（探针自己也不会去删它），量节点等于在量 DOM 里有没有那行字。
  const cols = geo && geo.main列 ? geo.main列.trim().split(/\s+/).length : -1;
  ok(cols === 1, '① main 是单列（对话流不再被右栏挤到左边）', geo && geo.main列);
  ok(geo && Math.abs(geo.左 - geo.右) <= 4, '① 左右空白差 ≤4px（居中）', geo);

  // ---- ④ 抽屉关着，画板仍是全尺寸（专抓 display:none） ----
  console.log('\n④ 抽屉关着时画板仍全尺寸（抓 display:none 那个静默缩水）');
  const bd = await ev(`(function(){
    var w=document.querySelector('.boardwrap'), g=document.getElementById('ggb');
    var c=g?g.querySelector('canvas'):null;
    var d=document.getElementById('drawer');
    return {抽屉状态:d?d.getAttribute('data-drawer'):'(没有抽屉)',
            boardwrap宽:w?Math.round(w.clientWidth):null,
            canvas宽:c?Math.round(c.getBoundingClientRect().width):null,
            canvas高:c?Math.round(c.getBoundingClientRect().height):null};})()`);
  console.log('   ' + JSON.stringify(bd));
  ok(bd.抽屉状态 === 'closed', '④ 前提：抽屉确实是关着的', bd.抽屉状态);
  // ★ 要抓的是「被 display:none 悄悄缩成 240×60」，所以量**高**，不要量"canvas 宽 == boardwrap 宽"：
  //   canvas 本来就比 boardwrap 内缩一圈内边距（实测 572 对 592，差 20 是正常的），
  //   写死 ≤4 会变成一条**与产品坏没坏无关**的红。
  ok(bd.canvas宽 >= 240 && bd.canvas高 >= 240,
     '④ 关着时 canvas 不是 240×60（display:none 会让它静默缩水）', bd);
  ok(bd.boardwrap宽 > 0 && bd.canvas宽 >= bd.boardwrap宽 * 0.8,
     '④ 关着时 canvas 撑满了这块板（≥ 板的 80% 宽）', bd);

  // ---- ④b 抽屉真的开得出来、关得回去（阶段 B 自己的东西）----
  console.log('\n④b 抽屉开合');
  const opened = await ev(`(function(){
    if(!(SR.main&&SR.main.openDrawer)) return 'no-api';
    SR.main.openDrawer(); return 1})()`);
  await sleep(520);                        // 过渡 .22s，给足再量
  const open = await ev(`(function(){
    var d=document.getElementById('drawer'), s=document.getElementById('drawerscrim');
    var r=d?d.getBoundingClientRect():null;
    var g=document.getElementById('ggb'), c=g?g.querySelector('canvas'):null;
    return {接口:true, 抽屉:d?d.getAttribute('data-drawer'):null,
            左边:r?Math.round(r.left):null, 右边缘:r?Math.round(r.right):null, 窗口宽:innerWidth,
            // ★ 可见性一律量 getClientRects().length，绝不读 getComputedStyle().display
            看得见:d?d.getClientRects().length>0:false,
            遮罩在:s?(!s.hidden):null,
            canvas宽:c?Math.round(c.getBoundingClientRect().width):null,
            canvas高:c?Math.round(c.getBoundingClientRect().height):null};})()`);
  console.log('   ' + JSON.stringify(open));
  ok(opened === 1 && open.抽屉 === 'open', '④b 抽屉滑出来了', open);
  ok(open.看得见 && open.左边 < open.窗口宽 - 40, '④b 滑出来之后真的在屏幕里（不是推在外面）', open);
  ok(open.遮罩在 === true, '④b 遮罩跟着出来（点外面能关）', open.遮罩在);
  // ★ 抓的是"滑出来之后被 resize 弄塌成 240×60"——抽屉宽了，板子该跟着长。
  ok(open.canvas宽 >= 240 && open.canvas高 >= 240, '④b 开着时 canvas 仍是全尺寸', open);
  await shot('a2b-抽屉开着');

  await ev(`(function(){var s=document.getElementById('drawerscrim'); if(s) s.click(); return 1})()`);
  await sleep(520);
  const shut = await ev(`(function(){
    var d=document.getElementById('drawer'), s=document.getElementById('drawerscrim');
    var r=d?d.getBoundingClientRect():null;
    return {抽屉:d?d.getAttribute('data-drawer'):null, 遮罩在:s?(!s.hidden):null,
            左边:r?Math.round(r.left):null, 窗口宽:innerWidth};})()`);
  console.log('   ' + JSON.stringify(shut));
  ok(shut.抽屉 === 'closed' && shut.遮罩在 === false, '④b 点遮罩能关回去', shut);
  // ★ 关着时"推在外面"＝ 左边缘 ≥ 窗宽。只推 100% 的话投影还会露一条，
  //   所以 css 里推的是 `calc(100% + 24px)`，这条正好把那个 24px 也钉住。
  ok(shut.左边 >= shut.窗口宽, '④b 关着时整条推在画布外（含给投影留的 24px）', shut);

  // ---- ⑥（冻图那半）/ ⑦ / ⑧ 都在下面那轮 fire 之后 ----（⑧ 挨着 ⑥⑦ 那一段里）

  // ---- ⑨ 硬约束回归：模型回复的气泡都有 copybar，刷新后仍在 ----
  // ★ 必须在**带 copy:true 的工位**上量。config.js 里 copy:true 只有两处（备课、讲评），
  //   而干净档案默认落在 SR.DEFAULT_WORK='material'（组卷），组卷从设计上就没有 copybar ——
  //   在组卷里量这一条是**恒红**，跟产品坏没坏没关系。③ 点的正是备课，就势接着跑。
  console.log('\n⑨ 硬约束回归（备课工位：模型回复的 copybar，当场 + 刷新后）');
  await stub(RAW);
  await fire('把 A、B 两个点摆上，再连起来，画给我看');

  // ---- ⑥（冻图那半）| 每张图长在**它自己那条气泡里**，是张真图 ----
  // ---- ⑦ ★ 冻图 == 板上的图（专抓 SR.figures.linesOf 那个前置 #清空） ----
  //
  // ★★ ⑦ 怎么量才量得准：RAW 是**两条累积**的围栏——见文件顶上 F1/F2 那段的说明。
  //    一句话：第 2 页 = F1 + F2 叠加（A、B 还在，线段连在它们之间），
  //    于是第二条的墨**一定**比第一条多。判据量这个"多"。
  //    误用 `linesOf`（前置 `#清空`）时，第 2 张会先把 A、B 洗掉再 `线段(A,B)` ——
  //    端点不存在，什么也画不出来，只剩坐标轴，墨**反而比第一条少**，断言就红。
  //    ⚠ 注意"只剩坐标轴"不是"全白"：GeoGebra 的坐标轴一直在，`shoot` 不会返回空串。
  //    所以判据必须是**比墨量**，不能写成"第二张有没有图"——那样是恒真的。
  // ★ 先直接问 `freezeFences` 本人"你冻出什么了"。图没冻上时屏幕上只留一块空占位，
  //   从 DOM 上**看不出**是"板忙"还是"命令画不出来"还是"截图为空"——三种原因长得一模一样。
  const fdiag = await ev(`(async function(){
    var out={};
    out.口子={offscreen:!!(SR.board&&SR.board.offscreenJob), split:!!(SR.figures&&SR.figures.splitLines),
              freeze:!!(SR.chat&&SR.chat.__freeze)};
    out.板忙=SR.board.isBusy(); out.作业忙=(SR.board.jobBusy?SR.board.jobBusy():null);
    var list=(SR.memo.log()||[]).filter(function(x){return x.r==='a'});
    var raw=list.length?list[list.length-1].t:'';
    var p=SR.render.parseFences(raw,{stripAssign:false});
    out.最后一轮的围栏数=(p.ggb||[]).length;
    out.缓存条数=Object.keys((SR.chat.__figCache?SR.chat.__figCache():{})).length;
    if(!out.最后一轮的围栏数) return out;
    out.直接冻=await new Promise(function(res){
      SR.chat.__freeze(p.ggb, function(got){
        res((got||[]).map(function(g){ return g?({宽:g.w,高:g.h,url长:(g.url||'').length}):null; }));
      });
    });
    return out; })()`);
  console.log('   诊断：' + JSON.stringify(fdiag));

  console.log('\n⑥ 冻图长在它自己那条气泡里  |  ⑦ 冻图 == 板上的图（专抓 #清空 那个坑）');
  const figs = await ev(`(async function(){
    function ink(url){ return new Promise(function(res){
      if(!url) return res({w:0,h:0,dark:-1});
      var im=new Image();
      im.onerror=function(){ res({w:0,h:0,dark:-1}); };
      im.onload=function(){
        try{
          var c=document.createElement('canvas'); c.width=im.width; c.height=im.height;
          var g=c.getContext('2d'); g.drawImage(im,0,0);
          var d=g.getImageData(0,0,im.width,im.height).data, n=0;
          // 阈值 200：纸面样式把线改成了实心黑，抗锯齿的边也够黑。
          for(var i=0;i<d.length;i+=4){ if(d[i]<200||d[i+1]<200||d[i+2]<200) n++; }
          res({w:im.width,h:im.height,dark:n});
        }catch(e){ res({w:im.width,h:im.height,dark:-2}); }
      };
      im.src=url;
    });}
    var as=[].slice.call(document.querySelectorAll('#msgs .msg.assistant'));
    var bub=null;
    for(var i=as.length-1;i>=0;i--){ if(as[i].querySelector('.figbox')){ bub=as[i]; break; } }
    if(!bub) return {找到:false};
    var boxes=[].slice.call(bub.querySelectorAll('.figbox'));
    var imgs=boxes.map(function(x){ return x.querySelector('.figimg'); });
    // ★ 「长在它自己那条气泡里」到底怎么量 —— 第一版写的是 x.parentNode === bub，
    //   而 bub 取的是外层 .msg.assistant，图框的真正父节点是**内层 .bubble**，
    //   于是这条断言**恒假**（实测 父节点:["DIV.bubble","DIV.bubble"]）。
    //   恒假的断言跟恒真的一样没用：它红了，但红的是尺子不是产品。
    //   正确的判据有两半，缺一不可：
    //     ① 图框的父节点**是那条消息里的 .bubble**（不是别处、不是右栏）；
    //     ② 那条消息**不是**开场白（.landing）——开场白里不该有产物。
    //   另外补一条反向的：图框**不在抽屉里**，坐实"不是旁边一栏"。
    // ⚠ 这一段是**模板字面量里面**：底下不许出现反引号，出现一个就把串提前掐断
    //   （这次就栽在这儿，报的错是"missing ) after argument list"在片头那行）。
    var dr=document.getElementById('drawer');
    var 在气泡里=boxes.every(function(x){
      var p=x.parentNode;
      if(!p || !/\\bbubble\\b/.test(p.className||'')) return false;   // 父节点得是 .bubble
      if(p.closest('.msg')!==bub) return false;                      // 而且那个 .bubble 得是这条消息的
      if(dr && dr.contains(x)) return false;                         // 更不许落在抽屉里
      return true;});
    var res={找到:true, 块数:boxes.length,
      还在气泡里:在气泡里,
      父节点:boxes.map(function(x){var p=x.parentNode; return p?(p.tagName+'.'+(p.className||'')):'(无)';}),
      气泡是谁:bub.tagName+'.'+(bub.className||''),
      真图数:imgs.filter(function(m){return !!m && m.naturalWidth>0;}).length,
      占位数:boxes.filter(function(x){return !!x.querySelector('.figph');}).length,
      再摆弄数:boxes.filter(function(x){return !!x.querySelector('.figagain');}).length,
      图:[]};
    for(var k=0;k<imgs.length;k++){
      var m=imgs[k];
      res.图.push(await ink(m ? m.src : null));   // 没图的那一格 ink(null) → {dark:-1}
    }
    return res; })()`);
  console.log('   ' + JSON.stringify(figs));
  ok(figs.找到 === true && figs.块数 === 2, '⑥ 两条围栏 = 两块图框', figs);
  ok(figs.还在气泡里 === true, '⑥ 两块都长在**它自己那条气泡里**（不是旁边一栏）', figs.还在气泡里);
  ok(figs.真图数 === 2 && figs.占位数 === 0, '⑥ 两块都是真图（naturalWidth>0），不剩占位', figs);
  ok(figs.再摆弄数 === 2, '⑥ 每块都挂着「再摆弄」', figs.再摆弄数);
  ok(figs.图[0] && figs.图[1] && figs.图[0].dark > 0 && figs.图[1].dark > 0,
     '⑦ 前提：两张都真有墨（第一条把 A、B 摆上、第二条连线）', figs.图);
  // ★ 这条就是 `#清空` 那个坑的正脸：误用 linesOf 时第二条会**全白**（dark=0 或根本没有图）。
  ok(figs.图[1] && figs.图[1].dark > figs.图[0].dark,
     '⑦ ★ 第二条的墨比第一条多（说明 A、B 还留在板上，没被 #清空 洗掉）', figs.图);
  await shot('a4-两条冻图');
  // ★ 再拍一张**把这条回复滚到中间**的：第一张是按"刚发完"的位置拍的，冻图往往被
  //   挤出屏幕外，光看图会以为只有一张。这一张才看得清"整条回复 + 两块图"到底多大。
  await ev(`(function(){
    var as=[].slice.call(document.querySelectorAll('#msgs .msg.assistant')), b=null;
    for(var i=as.length-1;i>=0;i--){ if(as[i].querySelector('.figbox')){ b=as[i]; break; } }
    if(b && b.scrollIntoView) b.scrollIntoView({block:'center'});
    return 1; })()`);
  await sleep(450);
  await shot('a4b-冻图整块');
  // ★ 「这块图到底占多大、旁边空了多少」不能靠眼睛估。量出来的是**渲染后**的框，
  //   跟 naturalWidth 是两回事（上限生效之后两者才会不一样）。
  const figgeo = await ev(`(function(){
    var o={窗口:[innerWidth,innerHeight]};
    var as=[].slice.call(document.querySelectorAll('#msgs .msg.assistant')), b=null;
    for(var i=as.length-1;i>=0;i--){ if(as[i].querySelector('.figbox')){ b=as[i]; break; } }
    if(!b) return o;
    var bub=b.querySelector('.bubble')||b;
    var r=function(e){ var x=e.getBoundingClientRect(); return [Math.round(x.width),Math.round(x.height)]; };
    o.气泡=r(bub);
    o.图框=(b.querySelectorAll('.figbox')[0])?r(b.querySelectorAll('.figbox')[0]):null;
    // 顺带把**算出来的**样式读回来。渲染尺寸不对时，"是规则没上去"还是"上去了被压回去"
    // 是两件事，光看渲染尺寸分不出来 —— 而这两种的治法完全不同。
    o.图=[].slice.call(b.querySelectorAll('.figimg')).map(function(m){
      var cs=getComputedStyle(m);
      return {渲染:r(m), 原始:[m.naturalWidth,m.naturalHeight],
              算出来的:{maxH:cs.maxHeight, maxW:cs.maxWidth, w:cs.width, h:cs.height, display:cs.display}}; });
    // 表里到底有没有那条规则（有 = 解析器吃进去了；没有 = 样式表在中途被掐断）
    o.规则在不在=null;
    try{
      for(var s=0;s<document.styleSheets.length;s++){
        var rs=null; try{ rs=document.styleSheets[s].cssRules; }catch(e){ continue; }
        for(var q=0;q<rs.length;q++){
          if(rs[q].selectorText==='.figimg'){ o.规则在不在=rs[q].cssText.slice(0,120); }
        }
      }
    }catch(e){ o.规则在不在='(读不到:'+e.message+')'; }
    return o; })()`);
  console.log('   冻图占多大：' + JSON.stringify(figgeo));

  // ---- ⑧ 流水线跟着回复走（阶段 F）----
  //
  // ★ 这一条量的是**摆法**，不是"七步跑没跑对"（那是 js/flow.js 自己的事，探针
  //   从头到尾没管过）。要钉住三件事，每一件都对应一个真会出问题的地方：
  //     ① 它在**气泡里**、而且是**这一轮那条**气泡 —— 阶段 F 的全部意义；
  //     ② 抽屉里**没有第二份** —— 搬是搬，不是复制（复制一份的话两处会各跑各的）；
  //     ③ 折起来只剩表头一行、点开能铺开 —— "跑完收起来"。
  console.log('\n⑧ 流水线跟着回复走');
  const fl = await ev(`(function(){
    var box=document.getElementById('flowbox');
    if(!box) return {找到:false};
    var msgs=[].slice.call(document.querySelectorAll('#msgs .msg.assistant'));
    var last=msgs.length?msgs[msgs.length-1]:null;
    var head=box.querySelector('.colhead');
    var list=document.getElementById('flowlist');
    var r=function(e){ return e?Math.round(e.getBoundingClientRect().height):null; };
    return {找到:true,
      在气泡里: !!box.closest('.bubble'),
      挂在最后一条: !!(last && last.contains(box)),
      最后一条有图: !!(last && last.querySelector('.figbox')),
      抽屉里还有一份: (function(){var d=document.getElementById('drawer');
                                return !!(d&&d.contains(box));})(),
      文档里找得到: !!document.querySelector('#drawer #flowbox, #msgs #flowbox'),
      折起来了: box.classList.contains('done'),
      表头可点: !!head && getComputedStyle(head).cursor==='pointer',
      // ★ 可见性一律量 getClientRects().length
      列表看得见: list? list.getClientRects().length>0 : null,
      折叠时框高: r(box), 表头高: r(head),
      步数: list? list.querySelectorAll('.fround').length : null,
      表头字: head? head.textContent.replace(/\\s+/g,' ').trim() : '',
      轮数: (SR.flow&&SR.flow.list)?SR.flow.list().length:null};
  })()`);
  console.log('   ' + JSON.stringify(fl));
  ok(fl.找到 === true, '⑧ 前提：页面上还有 #flowbox 这块', fl);
  ok(fl.在气泡里 === true, '⑧ 流水线搬进了气泡（不再是右栏里常驻的一块）', fl);
  ok(fl.挂在最后一条 === true && fl.最后一条有图 === true,
     '⑧ 挂在**这一轮**那条回复下面（跟它的冻图同一条气泡）', fl);
  ok(fl.抽屉里还有一份 === false, '⑧ 抽屉里不留第二份（是搬，不是复制）', fl.抽屉里还有一份);
  ok(fl.轮数 >= 1, '⑧ 前提：账本里真有轮次（不然这条是在量一块空面板）', fl.轮数);
  ok(fl.折起来了 === true && fl.列表看得见 === false, '⑧ 跑完折成表头一行（七步列表收起来）', fl);
  // ★ 「折成一行」不能只量"列表看不见" —— 那对"整块被藏了"也成立。要量**框高**：
  //   折着的时候框高 ≈ 表头高（只多一条 border-top）。写死一个 px 值不行：
  //   它跟着字号变，哪天调了字号就会变成一条与产品坏没坏无关的红。
  ok(fl.折叠时框高 !== null && fl.表头高 !== null && fl.折叠时框高 <= fl.表头高 + 3,
     '⑧ 折着的时候整块就是表头那么高（不是只把列表藏了、框还杵着）', fl);
  await shot('a5-流水线折在气泡里');

  // 点表头能铺开、再点又能收回去
  const foldOpen = await ev(`(function(){
    var box=document.getElementById('flowbox'), head=box.querySelector('.colhead');
    var list=document.getElementById('flowlist');
    var r=function(e){ return e?Math.round(e.getBoundingClientRect().height):null; };
    var before=r(box);
    head.click();
    return {open:box.classList.contains('open'), 折叠时框高:before,
            列表看得见:list.getClientRects().length>0, 框高:r(box),
            步数:list.querySelectorAll('.fround').length,
            轮数:(SR.flow&&SR.flow.list)?SR.flow.list().length:null};})()`);
  console.log('   ' + JSON.stringify(foldOpen));
  ok(foldOpen.open === true && foldOpen.列表看得见 === true, '⑧ 点一下表头铺得开', foldOpen);
  ok(foldOpen.步数 >= 1, '⑧ 铺开的是真内容（至少一轮流水线），不是一句空话', foldOpen.步数);
  ok(foldOpen.框高 > foldOpen.折叠时框高, '⑧ 铺开之后确实变高了', foldOpen);

  // ⑧c 面板**自己的措辞**里不许出现字面的 `**`。
  // ★ 为什么单独钉一条：步名、附注都走 `el()` 的 textContent（flow.js 480 行那段
  //   "一律 textContent，绝不 innerHTML"），每步名上那个"鼠标停一下"的说明走 `nm.title`
  //   —— **两个落点都是纯文本**。往这两种地方写 markdown 星号，星号不会变成粗体，
  //   只会原样露在老师眼前。2026-10-03 走真路在页面上撞见的正是它（模板库那句
  //   "下面这张卡是**它认出来的东西**"），顺手在 js/flow.js 的 `what` 与 kbNote 里
  //   也搜出四、五处，一并清了。
  //   ☆ 量的是**铺开状态**：折着的时候列表被藏起来，扫一块看不见的东西等于没扫。
  // ⚠⚠ 扫的**不是整块面板**，只扫"面板自己的措辞"三处：步名 `.fname`、附注 `.fnote`、
  //   每步名上的 title。**故意跳过 `.fout`** —— 那一格是**原样贴出来的东西**：
  //   「拼提示词」那格贴的就是拼好的提示词本身，里面有 `**` 是**应该的**（那是写给模型看的
  //   markdown），跟"星号漏在老师眼前"是两回事。
  //   ★ 这一条是量的过程中改的：第一版扫 `list.textContent`，读数 124 个星号，看着像
  //     "根本没修好"。逐格拆开才看见 124 **全在「拼提示词」那格的 out 里**，
  //     名 0 / 注 0 / title 0 —— 尺子扫到了别人的东西。**数字没错，错的是它量的那件事。**
  const star = await ev(`(function(){
    var list=document.getElementById('flowlist');
    if(!list) return {找到:false};
    var cnt=function(s){return (String(s||'').match(/\\*\\*/g)||[]).length};
    var steps=[].slice.call(list.querySelectorAll('.fstep'));
    var names=steps.map(function(st){var e=st.querySelector('.fname'); return e?e.textContent:''});
    var notes=steps.map(function(st){var e=st.querySelector('.fnote'); return e?e.textContent:''});
    var ts=[].slice.call(list.querySelectorAll('[title]'));
    var tips=ts.map(function(e){return e.getAttribute('title')||''});
    // 「拼提示词」那格是**原样贴提示词**，它里面有多少星号只当信息记，不当红
    var outs=steps.map(function(st){var e=st.querySelector('.fout'); return e?e.textContent:''});
    return {找到:true,
      看得见:list.getClientRects().length>0,
      步数:steps.length,
      措辞字数:names.join('').replace(/\\s+/g,'').length + notes.join('').replace(/\\s+/g,'').length,
      名里的星号:cnt(names.join('\\u0001')),
      注里的星号:cnt(notes.join('\\u0001')),
      有字的注:notes.filter(function(x){return String(x).replace(/\\s+/g,'').length}).length,
      提示条数:ts.length,
      注样本:notes.filter(function(x){return String(x).replace(/\\s+/g,'').length})
                   .map(function(x){return String(x).replace(/\\s+/g,' ').slice(0,26)}),
      提示里的星号:cnt(tips.join('\\u0001')),
      // 只有信息价值：out 是引来的原文，星号多少不算红
      出里的星号_仅供参考:cnt(outs.join('\\u0001')),
      第一颗来源:((tips.join('\\u0001').match(/[^\\u0001]*\\*\\*[^\\u0001]*/)||[''])[0]).slice(0,40)};
  })()`);
  console.log('   ' + JSON.stringify(star));
  ok(star.找到 === true && star.看得见 === true && star.步数 > 0,
     '⑧c 前提：铺开的这块面板真看得见、真有步（不然下面几条是在扫一块空面板）', star);
  ok(star.有字的注 >= 1,
     '⑧c 前提：至少有一格写了附注（不然"注里不许有星号"是空转）', star);
  ok(star.提示条数 > 0,
     '⑧c 前提：每步名上那个 title 真挂上了（没有它的话下面那条是空转）', star);
  ok(star.名里的星号 === 0,
     '⑧c ★ 步名里没有字面的 `**` —— 这里走 textContent，星号不会变成粗体、只会露出来', star);
  ok(star.注里的星号 === 0,
     '⑧c ★ 附注里没有字面的 `**`（kbNote 那几条也走 textContent，同理）', star);
  ok(star.提示里的星号 === 0,
     '⑧c ★ 每步那个 title 也是纯文本，同样不许有 `**`', star);

  await shot('a5b-流水线铺开');
  const foldBack = await ev(`(function(){
    document.getElementById('flowbox').querySelector('.colhead').click();
    var box=document.getElementById('flowbox'), list=document.getElementById('flowlist');
    return {open:box.classList.contains('open'),
            列表看得见:list.getClientRects().length>0,
            框高:Math.round(box.getBoundingClientRect().height)};})()`);
  ok(foldBack.open === false && foldBack.列表看得见 === false, '⑧ 再点一下又收回去', foldBack);

  // ---- ⑩（阶段 G）「想说」长在**这一条回复**底下 ----
  //
  // ★ 治的是什么：`#chips` 原来是输入框上面一排**常驻**的按钮。它跟"哪一轮"没有
  //   关系，可那三句话是拿**这一轮**的回复推出来的（```想说 围栏／本地兜底）——
  //   聊了五轮，它还钉在原地，屏幕上早翻过去两屏了。
  // ★ 判据必须落在**位置**上："这三颗在不在"是不够的（老写法它们也在，只是在
  //   另一个地方）。所以量的是 `closest('.bubble')`、是"整场一共几盒"、
  //   以及**整条祖先链**（链里不许出现输入框那块地）。
  // ★ 可见性一律量 `getClientRects().length`（见文件顶上那条铁律）。
  //
  // ★★ 2026-10-03（阶段 H）**退役了一条、换了一条**，记在这儿免得以后有人以为是漏写：
  //   原来有一条 `老容器里还剩几颗 === 0` —— 量的是 `#chips` 那个常驻容器里还剩几颗。
  //   阶段 H 把 `#chips` 从 index.html 里删掉了，`getElementById` 从此恒返回 null，
  //   那条就变成了**在量一个不存在的东西**：不管产品好没好，它永远是绿的。
  //   （铁律：**删掉容器会把"否定式断言"变成恒真**，而不是让它变红 —— 恒绿的断言
  //     比没有还坏，它会让后面的人以为这一块有人看着。）
  //   ⇒ 换成两条：① 那个容器**确实没了**（谁哪天把它加回来，这条会红，
  //        因为"想说"就有回到"常驻一排"那条老路上去的风险）；
  //      ② **整条祖先链**里不许出现 `.composer`／`#routebar`（#steps 已撤）
  //        —— 这三个都是"跟第几轮无关的固定位置"，长在里面就是老毛病复发。
  console.log('\n⑩「想说」跟着回复走（阶段 G）');
  const ck = await ev(`(function(){
    var as=[].slice.call(document.querySelectorAll('#msgs .msg.assistant'));
    var last=as.length?as[as.length-1]:null;
    var box=last?last.querySelector('.chips'):null;
    var chips=box?[].slice.call(box.querySelectorAll('.chip')):[];
    var bu=last?last.querySelector('.bubble'):null;
    var old=document.getElementById('chips');
    var br=bu?bu.getBoundingClientRect():null, kr=box?box.getBoundingClientRect():null;
    var 链=[]; (function(){ var e=box; while(e&&e!==document.body){
      var cs=getComputedStyle(e);
      链.push(String(e.className||e.tagName)+':'+cs.display); e=e.parentNode; } })();
    return {找到:!!box,
            在最后一条里:!!(box&&last&&last.contains(box)),
            在哪:box&&box.parentNode?String(box.parentNode.className):null,
            全文里有几盒:document.querySelectorAll('#msgs .chips').length,
            老容器在不在:!!old,
            链:链,
            颗数:chips.length,
            文字:chips.map(function(c){return c.textContent;}),
            看得见:chips.map(function(c){return c.getClientRects().length>0;}),
            最窄一颗:chips.length?Math.min.apply(null,chips.map(function(c){
              return Math.round(c.getBoundingClientRect().width);})):null,
            框宽:kr?Math.round(kr.width):null, 气泡宽:br?Math.round(br.width):null,
            底边差:(br&&kr)?Math.round(br.bottom-kr.bottom):null};
  })()`);
  console.log('   ' + JSON.stringify(ck));
  ok(ck.找到 === true && ck.在最后一条里 === true && ck.在哪.indexOf('bubble') >= 0,
     '⑩ 这一排长在**最后那条回复的气泡里**', ck);
  ok(ck.全文里有几盒 === 1, '⑩ 整场只有**一盒**（不是每条回复底下都摆一排）', ck.全文里有几盒);
  ok(ck.老容器在不在 === false,
     '⑩ 输入框上面那个常驻容器（#chips）确实没了 —— 阶段 H 删的；它要是又冒出来，谁把它加回来谁得回来看这条',
     ck.老容器在不在);
  ok((ck.链 || []).length >= 2 && /^chips/.test(ck.链[0]) && /bubble/.test(ck.链[1])
     && !(ck.链 || []).some(function(x){ return /composer|steps|routebar/.test(x); }),
    '⑩ 它的祖先是 气泡 → 消息，**整条链里没有 `.composer`／`#routebar`**' +
     ck.链);
  ok(ck.颗数 === 3 && ck.文字.join('|') === '换一组数据|让它动起来|看这个变化',
     '⑩ 三颗就是模型写的那三句（走的是 ```想说 围栏，不是本地兜底）', ck.文字);
  ok(ck.看得见.every(Boolean) === true && ck.最窄一颗 > 40,
     '⑩ 三颗都真的看得见、都有宽度（不是被谁盖住、也没缩成一条）', ck);
  // ★ 宽度照 .figbox / .flowbox 那一套啃回气泡的 14px 内边距 —— 气泡只左边有 3px 边条，
  //   所以这一排应当正好是"气泡宽 − 3"。写死 px 不行（字号一变就变成假红），认这个差值。
  ok(ck.框宽 !== null && Math.abs((ck.气泡宽 - 3) - ck.框宽) <= 2,
     '⑩ 这一排铺满气泡（啃掉了左右内边距，不是缩在正文字那一栏里）', ck);
  ok(ck.底边差 !== null && Math.abs(ck.底边差) <= 1,
     '⑩ 它是气泡的**最后一格**（底边跟气泡底边齐平，下面不再拖一段空白）', ck.底边差);
  await shot('a8-想说长在回复底下');

  // ---- ⑤ 点「再摆弄」→ 抽屉滑出来 + 板被摆成"这一张当时的那个状态" ----
  console.log('\n⑤ 点第二块的「再摆弄」');
  const again = await ev(`(function(){
    var as=[].slice.call(document.querySelectorAll('#msgs .msg.assistant'));
    var bub=null;
    for(var i=as.length-1;i>=0;i--){ if(as[i].querySelector('.figagain')){ bub=as[i]; break; } }
    if(!bub) return 'no-btn';
    var bs=bub.querySelectorAll('.figagain');
    bs[bs.length-1].click();          // 点**第二块**（累积的那张）
    return bs.length; })()`);
  ok(again === 2, '⑤ 前提：真的点到「再摆弄」了', again);
  // ★★ 这里原来写的是「死等 1600ms，然后量 isBusy」。实测是红的，但**红错了地方**：
  //   命令是 550ms 一条排进串行链的，这一张要画 `#清空` + 3 条 ≈ 2.2s，
  //   1600ms 那一刻板**本来就应该还在忙**——红的是"尺子等太短"，不是"产品卡住"。
  //   固定 sleep 还会两头不讨好：调大到 4s，真卡住时它就得白等 4s 才知道；调小了又假红。
  //   改成**轮询到闲**、并**把等了多少毫秒报出来**：真的卡死时等满上限 → 红，且看得见它等了多久。
  let waited = 0;
  while (waited < 20000) {
    if (await ev('SR.board.isBusy()') === false) break;
    await sleep(250); waited += 250;
  }
  const af = await ev(`(function(){
    var d=document.getElementById('drawer');
    // ★ 别拿**名字**认那条线段。GeoGebra 会给 Segment(A,B) **自动起名**——实测叫 f，
    //   不叫 Segment、也不叫 线段。第一版按 /^(Segment|线段)/ 去匹配，量到 ['A','B','f']
    //   就报红了，而板上那条线段明明画着。名字是产品/库的自由，**类型**才是事实。
    var names=[], types={};
    try{
      names=SR.board.applet().getAllObjectNames()||[];
      names.forEach(function(n){ try{ types[n]=String(SR.board.applet().getObjectType(n)); }catch(e){ types[n]='?'; } });
    }catch(e){ names=['(取不到:'+e.message+')']; }
    return {抽屉:d?d.getAttribute('data-drawer'):null,
            物件类型:types,
            抽屉看得见:d?d.getClientRects().length>0:false,
            面数:(SR.tabs&&SR.tabs.count)?SR.tabs.count():null,
            画板忙:SR.board.isBusy(),
            板上物件:names};})()`);
  af.等了毫秒 = waited;
  console.log('   ' + JSON.stringify(af));
  ok(af.抽屉 === 'open' && af.抽屉看得见 === true, '⑤ 点「再摆弄」把抽屉拉出来了', af);
  ok(af.画板忙 === false, '⑤ 摆完之后画板不忙（不是卡在半路）', af);
  // ★ 光"不忙"说明不了板上有东西：空板也不忙。这一条才正面回答"摆上了没有"。
  //   点的是**第二块**（累积的那张），所以要的是 A、B **和**那条线段，一个都不能少。
  ok(['A', 'B'].every(function (n) { return af.板上物件.indexOf(n) >= 0; }) &&
     Object.keys(af.物件类型).some(function (n) { return /segment|线段/i.test(af.物件类型[n]); }),
     '⑤ 板上真的有 A、B 和那条线段（不是一块空板）', af.物件类型);
  await shot('a5-再摆弄');
  await ev(`(function(){var s=document.getElementById('drawerscrim'); if(s) s.click(); SR.main.closeDrawer&&SR.main.closeDrawer(); return 1})()`);
  await sleep(520);
  // ★★ 判据不能用「第 GREET 条之后的气泡」—— GREET 是**开屏时**数出来的，
  //   而刷新之后**没有开场白**（首屏亮着时开场白还没插），于是那一下会把**唯一那条真回复**
  //   当成开场白切掉，量出来 0 条，看着像"刷新后没接回来"。
  //   稳的判据是**拿 memo 里 assistant 的条数当预期**：开场白不进 memo、也不带 copybar，
  //   两边天然对得上，刷新前后都成立。
  //   两把尺子由**同一段判据**生成（`mk(extra)`），保证刷新前后量的确实是同一个东西。
  const mk = extra => `(function(){
    var as=[].slice.call(document.querySelectorAll('#msgs .msg.assistant'));
    var ma=0; try{ ma=(SR.memo.log()||[]).filter(function(x){return x.r==='a'}).length; }catch(e){}
    var o={气泡总数:as.length, memo里assistant条数:ma,
      带copybar的:as.filter(function(b){return b.querySelector('.copybar .copybtn')}).length,
      气泡里有没有机器话:as.some(function(b){return /#清空|线段\\(/.test(b.innerText||'')})};
    ${extra}
    return o;})()`;
  const live = await ev(mk(''));
  console.log('   当场：' + JSON.stringify(live));
  ok(live.memo里assistant条数 >= 1, '⑨ 前提：memo 里确实记下了一条模型回复', live);
  ok(live.带copybar的 === live.memo里assistant条数, '⑨ 当场：每条模型回复的气泡都挂着 copybar', live);
  ok(live.气泡里有没有机器话 === false, '⑨ 当场：气泡里没有围栏里的机器话', live);

  await send('Page.reload', { ignoreCache: true }); await up();
  await sleep(1500);                       // 重画那条路是异步的，多给一拍再判
  const afterReload = await ev(mk(`
    o.工位=(function(){try{return SR.chat.getWork()}catch(e){return 'ERR'}})();
    o.首屏还亮着=document.body.hasAttribute('data-landing');
    o.旧landing看得见=(function(){var l=document.getElementById('landing');return l?l.getClientRects().length>0:false})();
    o.msgs子数=document.getElementById('msgs').children.length;
    o.msgs子=[].slice.call(document.getElementById('msgs').children).map(function(x){
      return x.tagName+'.'+String(x.className).split(' ').join('.')+'|'+String(x.innerText||'').slice(0,26).replace(/\\n/g,'⏎')});
    o.可见气泡=(function(){var n=0;[].slice.call(document.querySelectorAll('#msgs .msg.assistant')).forEach(function(b){if(b.getClientRects().length)n++});return n})();`));
  console.log('   刷新后：' + JSON.stringify(afterReload, null, 1));
  ok(afterReload.memo里assistant条数 >= 1, '⑨ 前提：刷新后这一轮还在（memo 接回来了）', afterReload);
  ok(afterReload.带copybar的 === afterReload.memo里assistant条数, '⑨ 刷新后：copybar 仍挂着（重画那条路）', afterReload);
  ok(afterReload.气泡里有没有机器话 === false, '⑨ 刷新后：气泡里仍没有机器话', afterReload);
  // ★ D1（原缺陷，阶段 C 已治好）：上面三条量的是 **DOM 里有没有**，当年刷新后全绿；
  //   可 `可见气泡:0` —— memo 接回来了、DOM 里也在、copybar 也挂回来了，但 `data-landing`
  //   还挂着，那条 `body[data-landing="1"] #msgs{display:none}` 把整块藏住，老师刷新回来
  //   **一个字都看不见**，会以为对话丢了。这条量的是**用户真看得见什么**，所以它才是
  //   能抓住 D1 的那一条 —— 前三条例行绿着，它红了。
  //   治法 = 首屏搬进 `#msgs`（不再需要整栏让位）+ 有 memo 历史时 init() 根本不建首屏。
  ok(afterReload.可见气泡 >= 1,
     '⑨ 刷新后：接回来的对话真的看得见（★ D1 的判据；红验模式下这条应保持绿）', afterReload);
  await shot('a3-刷新后');

  // ══════════════════════════════════════════════════════════════════
  //  ⑥（卷子卡那半）| 阶段 E：这份材料长在**产出它的那句话底下**
  // ══════════════════════════════════════════════════════════════════
  //
  // ★ 这一段为什么**排在 ⑨ 后面**：⑨ 的判据是
  //   `带copybar的 === memo里assistant条数`，而组卷工位 `copy:false` ——
  //   它这一条回复**本来就没有 copybar**。我要是把这一轮插到 ⑨ 前面，
  //   ⑨ 会红，而红的是**我刚加的这一轮**，不是产品。（"红的理由不对，等于没证"。）
  //
  // ★ 为什么要验这一条：右栏改成抽屉之后**默认是关着的**，而卷子原来只往 `#out`
  //   （抽屉里）摆 —— 出一份材料，老师眼前一个字的产物都没有，得先知道
  //   "要去点「再摆弄」"才找得着自己那份卷子。这是阶段 B 撤右栏带出来的窟窿。
  console.log('\n⑥b（阶段 E）卷子卡长在它自己那条气泡里，不在抽屉里');

  // 桩模板。★ 卡是 lazy 的（点「下载」才 build docx），所以这儿不用真 .docx——
  //   探针要量的是**卡摆在哪儿**，不是"卷子排得对不对"（那是 produce 自己的事）。
  //   ⚠ 但字段得给全：`SR.tpl.summary()`（material.paint 拿它画模板行）读的是
  //     `t.page.w / t.headText.length / t.hasLogo`，缺一个就在**开机 restore 那条路上**
  //     抛 TypeError —— 而那一抛被 restore 自己的 .catch 吞掉，屏幕上看起来只是
  //     "模板没选中"，跟"模板存坏了"长得一模一样。（第一次就是这么炸的。）
  const tplOk = await ev(`(async function(){
    var t={id:'probe-tpl', name:'探针模板', savedAt:Date.now(), bodySlot:0,
           page:{w:11906,h:16838,landscape:false}, headText:['探针'], hasLogo:false,
           slots:[{i:0,pPr:'',rPr:'',n:0,sample:'',math:false}]};
    await SR.tpl.save(t);
    await SR.material.use('probe-tpl');
    return SR.material.current()?SR.material.current().id:null; })()`);
  ok(tplOk === 'probe-tpl',
     '⑥b 前提：探针模板选中了（没它的话 feed 直接返回"没有选中模板"、卡根本不摆）', tplOk);

  await ev(`(function(){ SR.chat.setWork('material');
    document.body.setAttribute('data-work','material'); return 1; })()`);
  // 桩回复：一份带编号行的卷子围栏 + 一句正话。编号行**不该出现在气泡正文里**。
  const MATRAW = '```材料\n#0 第五周 周练卷\n#0 七(7)班\n#0 一、选择题\n#0 1. 计算 $2+3$ 的值。\n```\n'
               + '好了，按你传的模板排成一份周练卷。\n';
  await stub(MATRAW);
  await fire('给我出一份第五周的周练卷');

  const card = await ev(`(function(){
    var as=[].slice.call(document.querySelectorAll('#msgs .msg.assistant'));
    var bub=null;
    for(var i=as.length-1;i>=0;i--){ if(as[i].querySelector('.paperbox')){ bub=as[i]; break; } }
    if(!bub) return {找到:false};
    var dr=document.getElementById('drawer');
    var box=bub.querySelector('.paperbox');
    var pv=box.querySelector('.pvwrap');
    var bu=bub.querySelector('.bubble');
    // 判据跟 ⑥ 冻图那条同源：父节点得是**这条消息里的 .bubble**，
    // 且不许落在抽屉里。⚠ 这一段在模板字面量里面，底下不许出现反引号。
    var 在里面=(function(){ var p=box.parentNode;
      if(!p||!/\\bbubble\\b/.test(p.className||'')) return false;
      if(p.closest('.msg')!==bub) return false;
      if(dr&&dr.contains(box)) return false; return true; })();
    return {
      找到:true,
      卡数:bub.querySelectorAll('.paperbox').length,
      父节点:box.parentNode?(box.parentNode.tagName+'.'+(box.parentNode.className||'')):'(无)',
      在这个气泡里:在里面,
      文件名:(box.querySelector('.outhead .nm')||{}).textContent||'',
      预览在不在:!!pv,
      预览看得见:pv?pv.getClientRects().length>0:null,
      预览段数:pv?pv.querySelectorAll('.pv-p').length:null,
      按钮:[].slice.call(box.querySelectorAll('.outhead .tool')).map(function(x){return x.textContent}),
      抽屉开着:dr?dr.getAttribute('data-drawer'):null,
      卡宽:Math.round(box.getBoundingClientRect().width),
      气泡宽:Math.round(bu.getBoundingClientRect().width),
      正文里有没有编号行:/[#＃]\\s*\\d/.test(bu.innerText||'')
    }; })()`);
  console.log('   ' + JSON.stringify(card));
  ok(card.找到 === true && card.在这个气泡里 === true && card.卡数 === 1,
     '⑥b 卷子卡长在**它自己那条气泡里**（不是旁边一栏、不在抽屉里）', card);
  ok(/周练卷/.test(card.文件名 || ''), '⑥b 卡上写的是这一轮那句话取出来的文件名', card.文件名);
  // ★ 这一条是**新窟窿的正面判据**：抽屉关着，产物照样看得见。
  ok(card.抽屉开着 === 'closed', '⑥b 抽屉是关着的（产物不再躲在抽屉里）', card.抽屉开着);
  // ★ 默认收着 —— 两百行的卷子摊在对话里会把整场对话撑得没法看。
  ok(card.预览在不在 === true && card.预览看得见 === false,
     '⑥b 预览默认**收着**（看得见 = false 才算收着）', {看得见:card.预览看得见});
  // ★ 光"收着"不等于"里面有东西"：给一个空壳也收着。所以要**同时**量内容在不在。
  ok(card.预览段数 > 0, '⑥b 收着的预览里**确实排好了内容**（不是个空壳）', card.预览段数);
  ok((card.按钮 || []).join('|') === '预览|下载 .docx', '⑥b 两颗按钮都在', card.按钮);
  // ★ 「比文字那一栏宽」：`.paperbox` 用 `margin:10px -14px` 把气泡的左右内边距啃回来，
  //   所以它的宽应当**贴着气泡外沿**（≈ 气泡宽），而不是缩在文字那一栏里。
  //   ⚠ 容差给 6px：气泡左边有 3px 的 brand 竖条，卡的 1px 边框也算在外沿之外。
  ok(card.卡宽 >= card.气泡宽 - 6, '⑥b 卡比文字那一栏宽（啃掉了气泡的 14px 内边距）',
     {卡宽:card.卡宽, 气泡宽:card.气泡宽});
  ok(card.正文里有没有编号行 === false, '⑥b 编号行没有漏进气泡正文', card.正文里有没有编号行);

  // ★★ 2026-10-03（阶段 H）：右栏那个**产物单例**（`#out`，只显示最新一份卷子）
  //   连同它的空白态 `.outempty` 一起删掉了。跟 ⑩ 那条「常驻容器确实没了」同一个道理：
  //   删掉容器之后，"卡摆在哪"那几条就不再有人替它看着了。谁哪天把 `#out` 加回来、
  //   又让 `put()` 落回它身上，屏幕上**照样是"卡在气泡里"**（气泡那条路也在跑），
  //   可同一个文档里两个 id 相同的元素会让 `material.js` 的 `$()` 只认第一个 ——
  //   那是条很难查的病。所以钉一条：单例和它的空白态都不许回来。
  const goneOut = await ev(`(function(){
    return { 老单例:!!document.getElementById('out'),
             老空白态:!!document.querySelector('.outempty') }; })()`);
  ok(goneOut.老单例 === false && goneOut.老空白态 === false,
     '⑥d 右栏那个产物单例（#out / .outempty）确实没了 —— 阶段 H 删的；想加回来先回来看这条',
     goneOut);
  await shot('a6-卷子卡');

  // 点「预览」→ 真的摊开
  const pvOpen = await ev(`(function(){
    var as=[].slice.call(document.querySelectorAll('#msgs .msg.assistant'));
    var bub=null;
    for(var i=as.length-1;i>=0;i--){ if(as[i].querySelector('.paperbox')){ bub=as[i]; break; } }
    if(!bub) return {找到:false};
    var p=bub.querySelector('.paperbox .pvbtn'); if(p) p.click();
    var pv=bub.querySelector('.paperbox .pvwrap');
    return {找到:true, 看得见:pv?pv.getClientRects().length>0:null,
            按钮写的是:p?p.textContent:''}; })()`);
  ok(pvOpen.找到 && pvOpen.看得见 === true, '⑥b 点一下「预览」真的摊开了', pvOpen);
  ok(pvOpen.按钮写的是 === '收起预览', '⑥b 按钮跟着改口（预览 ↔ 收起预览）', pvOpen.按钮写的是);
  await shot('a6b-卷子卡摊开');

  // ---- 重画那条路：刷新之后这张卡得**自己回来** ----
  await send('Page.reload', { ignoreCache: true }); await up();
  await sleep(1500);
  const card2 = await ev(`(function(){
    var as=[].slice.call(document.querySelectorAll('#msgs .msg.assistant'));
    var bub=null;
    for(var i=as.length-1;i>=0;i--){ if(as[i].querySelector('.paperbox')){ bub=as[i]; break; } }
    if(!bub) return {找到:false, 气泡数:as.length};
    var box=bub.querySelector('.paperbox');
    var pv=box.querySelector('.pvwrap');
    return {找到:true, 卡数:bub.querySelectorAll('.paperbox').length,
            文件名:(box.querySelector('.outhead .nm')||{}).textContent||'',
            预览段数:pv?pv.querySelectorAll('.pv-p').length:null,
            预览看得见:pv?pv.getClientRects().length>0:null,
            卡看得见:box.getClientRects().length>0}; })()`);
  console.log('   刷新后：' + JSON.stringify(card2));
  ok(card2.找到 === true && card2.卡数 === 1, '⑥b 刷新后卷子卡摆回来了（重画那条路）', card2);
  ok(/周练卷/.test(card2.文件名 || ''), '⑥b 刷新后文件名还是那一个（走 fileTitle，同一套规则）', card2.文件名);
  ok(card2.预览段数 > 0 && card2.卡看得见 === true,
     '⑥b 刷新后卡里内容也在、也确实看得见（不是个空壳挂着）', card2);
  await shot('a6c-刷新后的卷子卡');

  // ⑥c（阶段 E 附带）：刷新后那格**占位**不许瘦成一条，点出来也不许跳
  //
  // ★ 为什么单开一条：这是**上眼**才发现的 —— 原来的 ⑥ 量的是"图框宽 438"，
  //   那是**图已经贴上去之后**的事。刷新回来图还没画，占位是
  //   `.figph{width:100%}`（百分比宽度对"气泡该多宽"**贡献为零**），
  //   气泡瘪回文字的宽度，占位跟着瘦成 146px 一条。
  //   尺子量不到，不是因为它笨，是因为它**从没量过"还没画的那一刻"**。
  const ph = await ev(`(function(){
    var p=document.querySelector('#msgs .msg.assistant .bubble .figph');
    if(!p) return {找到:false};
    var box=p.closest('.figbox'), bu=p.closest('.bubble');
    return {找到:true,
            占位宽:Math.round(p.getBoundingClientRect().width),
            图框宽:Math.round(box.getBoundingClientRect().width),
            气泡宽:Math.round(bu.getBoundingClientRect().width),
            气泡有标:bu.classList.contains('hasprod')}; })()`);
  console.log('   刷新后的占位：' + JSON.stringify(ph));
  await shot('a6d-刷新后的占位');
  // 判据取 400：瘦的那版量到 146，定宽之后是 760 上下，两档分得开。
  ok(ph.找到 === true && ph.占位宽 >= 400,
     '⑥c 刷新后那格占位**没瘦成一条**（它占的是"图出来之后要多宽"的地方，不是文字那么宽）', ph);
  ok(ph.气泡有标 === true,
     '⑥c 带产物的气泡挂上了定宽标记（宽度由产物决定，不由这一轮文字的长短决定）', ph);
  // ★ 这条我第一版写错过，记下来：当时断言的是 `占位宽 ≈ 气泡宽 - 28`
  //   （以为 -14px 的负外边距啃掉的是内边距那一份）。实测差 26px —— 因为
  //   气泡左边还立着一条 **3px 的 brand 竖条**，负外边距啃的是内边距，
  //   竖条啃不掉。**错的是我算的那个"应该值"，不是产品**（尺子不许拿错数去逼产品）。
  //   改成量两件**看得见的事**：占位顶满图框；图框一直顶到气泡外沿，只差那条竖条。
  ok(ph.占位宽 === ph.图框宽 && (ph.气泡宽 - ph.图框宽) <= 6,
     '⑥c 占位顶满图框，图框一直顶到气泡外沿（只差左边那条 3px 竖条）', ph);

  // 点一下占位 → 真画出来 → **气泡宽度不许变**。变了就是老师眼前跳一下。
  const jumped = await ev(`(async function(){
    var p=document.querySelector('#msgs .msg.assistant .bubble .figph');
    if(!p) return {找到:false};
    var bu=p.closest('.bubble'), before=Math.round(bu.getBoundingClientRect().width);
    p.click();
    for(var i=0;i<40;i++){ await new Promise(function(r){setTimeout(r,250)});
      if(bu.querySelector('.figimg')) break; }
    var im=bu.querySelector('.figimg');
    return {找到:true, 点之前:before, 点之后:Math.round(bu.getBoundingClientRect().width),
            画出图了:!!im, 图宽:im?Math.round(im.getBoundingClientRect().width):null}; })()`);
  console.log('   点占位之后：' + JSON.stringify(jumped));
  ok(jumped.找到 === true && jumped.画出图了 === true,
     '⑥c 点占位真的画出来了（不然下面那条是在量一块没画出来的空框）', jumped);
  ok(jumped.点之后 === jumped.点之前, '⑥c 图出来之后气泡**没有变宽**（不跳）', jumped);

  // ---- ⑧b 重画那条路：`#msgs` 被掏空之后，它得**自己回来**（阶段 F 的脱档坑）----
  //
  // ★ 这一条专抓那个坑，别的一条都抓不到：
  //   ① 搬进气泡之后，`#flowbox` 就是 `#msgs` 的后代了；
  //   ② `reset()` / `repaintLog()` 都会 `#msgs.innerHTML = ''` —— 它跟着一起**脱档**；
  //   ③ 脱档之后 `document.getElementById('flowbox')` 就返回 null（不在 document 里了），
  //      而屏幕上看起来只是"流水线不见了"，跟"这条本来就没有流水线"长得一模一样。
  //   治法是把节点引用攥在 js/chat.js 里（`flowEl`）。**这条断言就是那个引用的证词**：
  //   给它打个记号，掏空之后再找 —— 找回来还得是**同一块**，不是新造的一块。
  // ⚠ 放在最末尾，是因为它会把 `#msgs` 整个重建一遍（那正是要验的动作）。
  //   放前面去会把 ⑤/⑥b 那些"点第几块、量哪条气泡"的断言全打乱。
  console.log('\n⑧b 重画之后流水线还找得回来（抓 innerHTML=\'\' 那个脱档）');
  await stub(RAW);
  await fire('再摆一次那两个点，我看看流水线还在不在');
  const marked = await ev(`(function(){
    var box=document.getElementById('flowbox');
    if(!box) return {找到:false};
    box.setAttribute('data-probe-tag','1');   // 记号：待会儿要认的是**这一块**
    return {找到:true, 在气泡里:!!box.closest('.bubble'),
            轮数:(SR.flow&&SR.flow.list)?SR.flow.list().length:null,
            折起来了:box.classList.contains('done')};})()`);
  console.log('   ' + JSON.stringify(marked));
  ok(marked.找到 === true && marked.在气泡里 === true && marked.轮数 >= 1,
     '⑧b 前提：又跑了一轮，流水线现在在气泡里（不然这一条在量一块本来就在抽屉里的东西）', marked);
  ok(marked.折起来了 === true, '⑧b 前提：跑完是折着的', marked.折起来了);
  const afterReset = await ev(`(function(){
    SR.chat.reset('prep');       // 切工位／重画走的就是这一条（不传 wipe，不动记忆）
    var box=document.getElementById('flowbox');
    var msgs=[].slice.call(document.querySelectorAll('#msgs .msg.assistant'));
    var last=msgs.length?msgs[msgs.length-1]:null;
    var d=document.getElementById('drawer');
    return {找得到:!!box,
            是我那一块:!!(box&&box.getAttribute('data-probe-tag')==='1'),
            在气泡里:!!(box&&box.closest('.bubble')),
            挂在最后一条:!!(box&&last&&last.contains(box)),
            抽屉里还有一份:!!(box&&d&&d.contains(box)),
            折起来了:!!(box&&box.classList.contains('done')),
            气泡数:msgs.length}; })()`);
  console.log('   ' + JSON.stringify(afterReset));
  ok(afterReset.找得到 === true, '⑧b ★ 重画之后 #flowbox 还在文档里（没被 innerHTML=\'\' 连根拔掉）', afterReset);
  ok(afterReset.是我那一块 === true, '⑧b ★ 还是**同一块**（不是新造了一个壳）', afterReset);
  ok(afterReset.在气泡里 === true && afterReset.挂在最后一条 === true,
     '⑧b 重画之后又挂回了**最后那条**回复下面', afterReset);
  ok(afterReset.抽屉里还有一份 === false, '⑧b 抽屉里没有残留的第二份', afterReset);
  ok(afterReset.折起来了 === true, '⑧b 重挂回来仍是折着的一行', afterReset);
  await shot('a7-重画之后的流水线');

  // ---- ⑩b（阶段 G）重画之后它自己回来 + 点一颗就发出去 ----
  //
  // ★ 两件事挤在这里，因为它们都要"这一条最后的气泡"：
  //   ① **重画那条路**（跟 ⑧b 同一个坑的另一半）：`#msgs.innerHTML=''` 之后，
  //      那一盒选项跟气泡一起没了；重画这条路不重新摆的话，屏幕上就是
  //      "刷新回来最后一排按钮不见了"——看着像功能丢了，其实是没人重算。
  //      （当场那条路是 `submit` 收尾摆的，⑩ 那儿已经量过。）
  //   ② **点下去**：老写法里按钮的父节点是那个常驻容器，搬进气泡之后
  //      点它还是不是原来那件事（把那句话发出去），得验，不能推。
  //      而且发出去的**那一刻**，上一排要跟着撤掉（`submit` 开头的 `clearChips()`）——
  //      不撤的话，新回复底下又摆一排，屏幕上会横着两排按钮。
  // ⚠ 放最末尾：它会再发一轮，把"最后那条"换掉。
  console.log('\n⑩b 重画之后它自己回来  |  点一颗就发出去');
  const ck2 = await ev(`(function(){
    var as=[].slice.call(document.querySelectorAll('#msgs .msg.assistant'));
    var last=as.length?as[as.length-1]:null;
    var box=last?last.querySelector('.chips'):null;
    if(!box) return {找到:false};
    var chips=[].slice.call(box.querySelectorAll('.chip'));
    var sz=function(e){ var q=e.getBoundingClientRect();
      return Math.round(q.width)+'x'+Math.round(q.height); };
    var parentOf=function(e){ return e && e.parentNode
      ? String(e.parentNode.className||e.parentNode.tagName) : null; };
    var btn=box.querySelector('.chip');
    var txt=btn?btn.textContent:'';
    // ★★ 量在**点之前**（2026-10-03 改）。
    //   btn.click() 是**同步**的：它当场跑 clearChips()，把这一盒从文档里摘掉。
    //   所以在 click 之后再量，量到的是一个**脱档节点** —— getClientRects() 恒为 0、
    //   getBoundingClientRect() 恒为 0x0、getComputedStyle().display 恒为空串、
    //   parentNode 恒为 null。这四样凑在一起是"不在文档里"的签名，**不是**"没摆出来"。
    //   老写法正是先 click 再量，于是"三颗看不看得见"那条恒红，而红的样子
    //   （0x0 / display 空串）跟"产品真的没渲染"一模一样 —— 尺子量错了地方，
    //   却给出一个看起来在产品身上才有的读数。（同族第 29 例。）
    //   ⇒ 几何一律在 **click 之前**量；click 之后只量"撤掉了没有"。
    //   ⚠ 这一段是**写在模板字符串里**的（ev 那对反引号），注释里
    //     一个反引号都不能有——写一个就把字符串截断在那儿，报出来的是
    //     "xxx is not a function"，跟真正的原因隔着十万八千里。
    var 点前各颗矩形数=chips.map(function(c){return c.getClientRects().length;});
    var 点前各颗大小=chips.map(sz);
    var 点前盒大小=sz(box);
    var 点前盒矩形数=box.getClientRects().length;
    var 点前在文档里=box.isConnected;
    var 点前父节点=parentOf(box);
    // 0x0 有几种来历（display:none / 祖先被藏 / 尺寸算成 0），
    // 把链子上每一格的 display 都取出来，一眼看得出是哪一格断的。
    var 点前链=(function(){ var out=[], e=box;
      while(e && e!==document.body){
        var cs=getComputedStyle(e);
        out.push(String(e.className||e.tagName)+':'+cs.display);
        e=e.parentNode;
      } return out; })();
    var 点前气泡大小=last.querySelector('.bubble')
      ? sz(last.querySelector('.bubble')) : null;
    btn.click();                                   // 同步：clearChips + 起一轮
    var 点下去那一刻还剩几盒=document.querySelectorAll('#msgs .chips').length;
    // click 之后**只**量这一件事：它确实被摘下去了（而不是还挂在文档里）。
    //   这一对读数（点前 isConnected:true / 点后 false）正是上一条断言的推理依据 ——
    //   有了它，"0x0 是因为被摘了"才是个**量出来的**结论，不是我猜的。
    var 点后在文档里=box.isConnected, 点后父节点=parentOf(box);
    return {找到:true, 重画后颗数:chips.length,
            重画后文字:chips.map(function(c){return c.textContent;}),
            // ★ 把每一颗的量都留出来（不是给一个 true/false）：红了的时候
            //   得知道是**哪一颗**、以及它旁边那两颗是什么样，不然分不清
            //   "三颗都没摆出来"和"第三颗被谁挤掉了"。
            重画后各颗矩形数:点前各颗矩形数,
            重画后各颗大小:点前各颗大小,
            重画后盒大小:点前盒大小, 重画后盒矩形数:点前盒矩形数,
            链:点前链,
            重画后气泡大小:点前气泡大小,
            点前在文档里:点前在文档里, 点前父节点:点前父节点,
            点后在文档里:点后在文档里, 点后父节点:点后父节点,
            点了:txt, 点下去那一刻还剩几盒:点下去那一刻还剩几盒};
  })()`);
  console.log('   ' + JSON.stringify(ck2));
  ok(ck2.找到 === true && ck2.重画后颗数 === 3,
     '⑩b ★ 重画之后这一排自己回来了（不是"刷新就没"）', ck2);
  // ⚠ 下面几条一律先 `|| []`：`找到:false` 时那个 early-return 里**没有**这些键，
  //   直接 `.join` / `.length` 会抛异常，整趟跑没有汇总行 —— 而红验最需要看到的
  //   正是那一行"只红了这几条、别的都没动"。（RED=chips 第一趟就是这么炸在 1105 行的。）
  ok((ck2.重画后文字 || []).join('|') === '换一组数据|让它动起来|看这个变化',
     '⑩b 重画摆回来的是**同三句**（跟当场同源：同一条 ```想说）', ck2.重画后文字 || ck2);
  ok(ck2.点前在文档里 === true && (ck2.重画后各颗矩形数 || []).length === 3
       && (ck2.重画后各颗矩形数 || []).every(function(n){ return n > 0; }),
     '⑩b 摆回来那三颗也真看得见（每颗都量 getClientRects；且量的时候它确实在文档里）', ck2);
  ok(ck2.点下去那一刻还剩几盒 === 0 && ck2.点后在文档里 === false
       && ck2.点前在文档里 === true,
     '⑩b 点一颗 → 上一排立刻撤掉（不然新回复底下又是一排，屏上横着两排）', ck2);
  // ★ 这一条是给我自己立的规矩：上面两条读到的 0x0 / display 空串，
  //   只有配上"点前在文档里 / 点后不在"才分得清是**被摘了**还是**没渲染**。
  //   下一次谁再看到 0x0，先看这两个真值，别急着改产品。
  ok(ck2.点前父节点 !== null && /bubble/.test(String(ck2.点前父节点))
       && ck2.点后父节点 === null,
     '⑩b 点前它挂在气泡里、点后被摘下来（0x0 是被摘的读数，不是没渲染）', ck2);
  await new Promise(r => setTimeout(r, 1500));
  const sent = await ev(`(function(){
    var us=[].slice.call(document.querySelectorAll('#msgs .msg.user'));
    var u=us.length?us[us.length-1]:null;
    return {最后一条老师说的话:u?u.querySelector('.bubble').textContent.replace(/\\s+/g,' ').trim():null,
            老师气泡数:us.length, 发送键还停用吗:document.getElementById('send').disabled}; })()`);
  console.log('   ' + JSON.stringify(sent));
  ok(sent.最后一条老师说的话 === ck2.点了,
     '⑩b 点那一颗 = 把那句话**发出去**了（不是只把它塞进输入框）', sent);
  await shot('a9-点一颗说说看');

  console.log('\n' + '─'.repeat(64));
  console.log((FAIL ? '✗ ' : '✓ ') + PASS + ' 过 / ' + FAIL + ' 红 / ' + TODO + ' 未验');
  if (RED) {
    // ★ 红验得自己证明「确实换掉了」：没换成的那一趟跑的是真产品。
    //   ⚠ 两份**各证各的**：只证了 CSS 就去谈 ⑦ 红没红，等于把"JS 那份根本没换"的
    //     一趟当成"⑦ 红得起来" —— 那正是这条红验最容易被自己骗过去的地方。
    // ⚠ 只对**这一趟要求换的那几份**下判断：RED=css 那趟没打算换 chat.js，
    //   把它的"没换"算成失败，就会把一趟干净的红验误报成作废。
    const wantCss = DO_CSS || DO_PROD || DO_FOLD;
    const wantJs = DO_JS || DO_UNHOOK || DO_CHIPS;
    const wantFlow = DO_STAR;
    console.log('★ 红验换成了没有：'
      + (wantCss ? 'css/main.css ' + (SAB_HIT ? '换了' : '**没换**') : '')
      + (wantCss && (wantJs || wantFlow) ? ' ／ ' : '')
      + (wantJs ? 'js/chat.js ' + (SABJS_HIT ? '换了' : '**没换**') : '')
      + (wantJs && wantFlow ? ' ／ ' : '')
      + (wantFlow ? 'js/flow.js ' + (SABFLOW_HIT ? '换了' : '**没换**') : ''));
    const good = (!wantCss || SAB_HIT) && (!wantJs || SABJS_HIT) && (!wantFlow || SABFLOW_HIT);
    console.log(good
      ? '★ 该换的都换掉了 —— 上面那些红都是对着改坏的那份报的'
      : '★★ 有没换成的 —— 这一趟跑的是真产品，这些绿不能当尺子灵的证据');
    await send('Fetch.disable', {});
  }
  await closeTab(t.id); ws.close();
  process.exit(0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });
