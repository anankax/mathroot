// 右栏多页的验收：「标签指着第 2 页，画板上到底是不是第 2 页那张图」。
//
// ★ 这个文件替的是**量尺**，不是数据。上一趟写的 test/probe_tabs.cjs 问的是
//   "GeoGebra 那几个接口到底怎么用"（快照往返、并发半张图、三维视角回不回得来），
//   问完就有答案了，答案焊进了 js/board.js 和 js/tabs.js。这一份问的是**别的事**：
//   写完这两份代码之后，「点标签 → 板子真换图」这件事**还成不成立**。
//   它是闸：红了就是产品坏了，不是尺子坏了（除了标了"尺子自检"的那两格）。
//
// ★★ 分两腿，跟 probe_math.cjs 一个道理：
//   A 腿（纯函数，永远跑）：**页名推断**。shapeOf / titleFor / clean 在 node 里直接喂。
//   B 腿（浏览器，要 LIVE=1）：**那台真画板**。B 腿的每一条判据都从画板自己嘴里读
//     （`ggbApplet.getAllObjectNames()` / `SR.board.is3D()`），**一条都不读 tabs.js 的账**。
//   ⚠ 为什么这条纪律对这个文件特别要紧：多页这套东西的账（`pages` 数组）和板子上
//     真正有什么，是**两个可以各说各话的东西**，而它俩一旦分家，症状就是"看着挺好，
//     点过去是另一张图"。拿账去验账，等于什么都没验。
//
// 用法:
//   node test/probe_tabpage.cjs              只跑 A 腿
//   LIVE=1 node test/probe_tabpage.cjs       连 B 腿一起（先 node test/serve.cjs 8138，Chrome 在 9222）
//   退出码 0 = 跑的这几腿全过；1 = 有红的；3 = 尺子自己坏了
const path = require('path'), fs = require('fs');

// ★ SR_TABS 是给 `test/_redfirst_tabpage.cjs` 用的：它把**改坏的副本**写到别处，
//   让探针去读那份，于是"证明它会红"这件事完全不用碰 js/tabs.js。
//   （理由跟 probe_math.cjs 那份 SR_RENDER 一模一样：探针不许把东西留在她机器上。）
const TFILE = process.env.SR_TABS || path.join(__dirname, '..', 'js', 'tabs.js');

// tabs.js 是个 `(function(){...})()`，只看 window.SR。`module` 在 new Function 里
// 是取不到的（那是 node 模块自己的变量），所以它末尾那句 `module.exports` 不会生效——
// 我们要的正是这个：只读 window.SR.tabs，跟浏览器里那条装载路径同源。
const W = { SR: {} };
new Function('window', 'localStorage', 'navigator',
  fs.readFileSync(TFILE, 'utf8'))(W, {}, { onLine: true });
const T = W.SR && W.SR.tabs;
if (!T || !T.shapeOf || !T.titleFor || !T.clean) {
  console.log('★ tabs.js 里没有 shapeOf / titleFor / clean —— 下面每一条都别信。');
  process.exit(3);
}

// ============================================================
//  A 腿：页名推断（纯函数）
// ============================================================
// ★ 这条表同时钉住三件事：三个来源**谁压谁**（围栏标题 > 命令内容 > 「图 N」）、
//   认不出来时回什么、重名怎么加号。`want` 是逐字比对的。
const NAMED = [
  // ---- 尺子自检那一格 ----
  {
    name: '★自检：喂一段**什么都不是**的，它必须说"不认识"',
    cmds: 'zzz', hint: '', ex: [], want: '图 1',
    why: '这一格和下面每一格"认出来了"是**两个相反的方向**。一个不管喂什么都回「圆」的 ' +
         'shapeOf，能把下面所有正向的格子全骗绿。所以它必须能说"不"。' +
         '（注意这一格判的是**推断的完整结果**「图 1」，不是 shapeOf 的空串——' +
         '兜底归 titleFor 管，两件事分开，见 js/tabs.js 里那段。）'
  },

  // ---- ① 围栏标题压过一切 ----
  {
    name: '① 围栏标题「数轴」压过命令内容（命令画的是圆）',
    cmds: 'Circle((0,0),2)', hint: '数轴', ex: [], want: '数轴',
    why: '模型自己起了名就用它的。这一格红了说明优先级反了——' +
         '老师会看见标签写「圆」而模型说的是「数轴」'
  },
  {
    name: '① 围栏标题里的脏东西要洗掉（换行 / 星号 / 末尾句号）',
    cmds: 'Circle((0,0),2)', hint: '  圆 **一**\n ', ex: [], want: '圆 一',
    why: '围栏标题是**模型的原话**，它爱在里面写 markdown。原样贴到标签上，' +
         '标签上就出现星号'
  },

  // ---- ② 从命令认内容 ----
  { name: '② 数轴（整条命令就一个词）', cmds: '#清空\n数轴', hint: '', ex: [], want: '数轴' },
  { name: '② 数轴（带井号那个写法）', cmds: '#数轴', hint: '', ex: [], want: '数轴' },
  { name: '② 坐标系（三种叫法都认）', cmds: '坐标系', hint: '', ex: [], want: '坐标系' },
  { name: '② 坐标系（叫"平面直角坐标系"也认）', cmds: '平面直角坐标系', hint: '', ex: [], want: '坐标系' },
  {
    name: '② 三维：`#三维` 那一行压过下面的 Circle',
    cmds: '#清空\n#三维\nA=(0,0,0)\nCircle((0,0,0),2)', hint: '', ex: [], want: '立体图',
    why: '立体图里有个圆，叫「立体图」比叫「圆」有用——他会想找"那个正方体"，' +
         '不会想找"那个圆"'
  },
  { name: '② 动点（Slider）', cmds: 'Slider(1,5)', hint: '', ex: [], want: '动点' },
  { name: '② 圆（Circle）', cmds: 'Circle((0,0),2)', hint: '', ex: [], want: '圆' },
  { name: '② 多边形（Polygon）', cmds: 'Polygon(A,B,C)', hint: '', ex: [], want: '多边形' },
  {
    name: '② 三角形（英文命令和中文词都认）',
    cmds: 'A=(0,0)\nB=(3,0)\nC=(0,4)\n三角形', hint: '', ex: [], want: '三角形'
  },
  {
    name: '② 函数图象（`f(x)=` 那个写法）',
    cmds: '#清空\nf(x)=x^2', hint: '', ex: [], want: '函数图象'
  },
  {
    name: '② 函数图象（裸的 `x^2`，没有 f(x) 也认）',
    cmds: '#清空\nx^2', hint: '', ex: [], want: '函数图象'
  },
  {
    name: '★反例：只有两个端点、一条线段 —— 认不出来就老老实实说认不出来',
    cmds: '#清空\nA=(-2,0)\nB=(3,0)\nSegment(A,B)', hint: '', ex: [], want: '图 1',
    why: '这条线段的"内容"是什么形状？没形状。认不出来回「图 1」是**对的**。' +
         '要是哪天有人为了让这一格"更好看"给它配上「线段」，而配歪了，' +
         '那才是真坏事——把抛物线叫成「数轴」比叫「图 3」坏得多（见 js/tabs.js 那段注释）'
  },
  {
    name: '★反例：`x = 3` 这种普通等式**不是**函数（别见 x 就叫函数图象）',
    cmds: 'x = 3', hint: '', ex: [], want: '图 1',
    why: '`x = 3` 是条竖线，不是函数图象。那条正则**故意**只认 `f(x)=` 和 `x^2`，' +
         '见等号就认会把这节课一半的图都叫成「函数图象」'
  },

  // ---- ③ 重名加号 ----
  {
    name: '③ 重名：已经有一个「数轴」了，第二个叫「数轴 2」',
    cmds: '数轴', hint: '', ex: ['数轴'], want: '数轴 2',
    why: '两个标签长得一模一样，他分不清该点哪个'
  },
  {
    name: '③ 重名：第三个叫「数轴 3」（不是又回到 2）',
    cmds: '数轴', hint: '', ex: ['数轴', '数轴 2'], want: '数轴 3'
  },
  {
    name: '③ 认不出来的：已经占了「图 1」「图 2」→ 这是「图 3」',
    cmds: 'Segment(A,B)', hint: '', ex: ['图 1', '图 2'], want: '图 3',
    why: '「图 N」的编号是**空位里最小的那个**，不是"数量 + 1"。' +
         '收掉过一页之后编号会有洞，那样才填得满'
  }
];

let bad = 0;
console.log('===== A 腿：页名推断（纯函数，' + NAMED.length + ' 格）=====');
for (const c of NAMED) {
  const got = T.titleFor(c.cmds, c.ex, c.hint);
  const ok = got === c.want;
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + c.name);
  if (!ok) {
    console.log('      命令〔' + String(c.cmds).replace(/\n/g, '\\n') + '〕　' +
                '围栏标题〔' + c.hint + '〕　已有的页名' + JSON.stringify(c.ex));
    console.log('      期望〔' + c.want + '〕　实际〔' + got + '〕');
  }
  if (c.why) console.log('        ' + c.why.replace(/\n/g, '\n        '));
}

// ---- clean 单独钉（它是"洗标题"的唯一一处，别处不该再有一份）----
const CLEANS = [
  ['圆', '圆', '★一个正常的名字，一个字符都不许动'],
  ['  圆\n', '圆', '前后空白和换行'],
  ['**数轴**', '数轴', 'markdown 的星号'],
  ['#坐标系', '坐标系', '井号'],
  ['数轴。', '数轴', '★末尾的**中文**句号（第一版名单里只有半角 `.`，这一格就是为了钉住它）'],
  ['图 1,', '图 1', '末尾的逗号'],
  ['圆　一', '圆 一', '★知道的行为：全角空格会被收成一个半角空格（标签上不留一道宽缝）。' +
                     '不是漏网——JS 的 `\\s` 本来就含 U+3000。这一格是**钉住**它，' +
                     '哪天有人改成"只收半角空白"，这格会红，提醒他来看一眼'],
  ['0123456789abcdef', '0123456789ab', '★太长要截到 12 个字（标签条一行放不下）']
];
console.log('');
console.log('---- clean：洗标题（' + CLEANS.length + ' 格）----');
for (const [inp, want, why] of CLEANS) {
  const got = T.clean(inp);
  const ok = got === want;
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + '〔' + inp.replace(/\n/g, '\\n') + '〕→〔' + got + '〕' +
    (ok ? '' : '　期望〔' + want + '〕') + '　' + why);
}

// ---- 同一个输入两次，得是同一个名字（页面重画时会再算一遍）----
const t1 = T.titleFor('Circle((0,0),2)', ['圆'], '');
const t2 = T.titleFor('Circle((0,0),2)', ['圆'], '');
if (t1 !== t2) { bad++; console.log('  ✗ 同输入两次算出不同结果〔' + t1 + '〕/〔' + t2 + '〕'); }
else console.log('  ✓ 同输入两次同结果（' + t1 + '）');

// ============================================================
//  尺子自检
// ============================================================
// ★ 两份自检分开记：一种是"用例表本身偏了"（两边没都放），一种是"那把尺子会不会动"。
//   合成一个数打印的话，`clean` 那一格出问题会显示成"shapeOf 那个方向没验"——
//   报告指错了地方，比不报还坏。（第一版就是合着的，已经吃到这个教训了。）
const selfTable = [], selfShape = [], selfClean = [];
if (!NAMED.length) selfTable.push('用例表是空的，"全都对"是空转');
if (!NAMED.some(c => /^图 /.test(c.want))) selfTable.push('没有一格是"认不出来"的——"见什么认什么"的那种坏法量不到');
if (!NAMED.some(c => !/^图 /.test(c.want))) selfTable.push('没有一格是"认出来了"的——shapeOf 永远回空串也能全绿');
// clean 这边同一个道理：得有一格"该洗的"，也得有一格"一个字符都不许动"的。
// 只有"该洗的"，一个"见什么删什么"的 clean（把中文字全吃了）照样全绿。
if (!CLEANS.some(([i, w]) => i !== w)) selfClean.push('clean 没有一格是"该洗的"——它要是什么都不做也能全绿');
if (!CLEANS.some(([i, w]) => i === w)) selfClean.push('clean 没有一格是"不许动的"——"见什么删什么"的那种坏法量不到');
// ★ 判据只许问"它到底会不会动"，**不许逐字比对某个具体形状**——逐字比会把产品行为
//   焊进自检里，产品一退化自检就喊"尺子坏了"，把人指去改探针文件。
//   （这条是 probe_math.cjs 那趟踩出来的，见那个文件里那段注释。）
const CAN_SHAPE = T.shapeOf('Circle((0,0),1)');
const CAN_NONE = T.shapeOf('zzz');
if (!CAN_SHAPE) selfShape.push('喂一段明明认得出的（Circle）它也回空串 —— 上面那些"认出来了"的绿是假的');
if (CAN_NONE) selfShape.push('喂一段什么都不是的它照样回〔' + CAN_NONE + '〕 —— 它是个"见什么都认"的东西，下面每格都没意义');
const selfBad = selfTable.concat(selfShape, selfClean);
console.log('');
console.log('===== 尺子自检 =====');
console.log('  用例表："认出来"和"认不出"两边都有  ' + (selfTable.length ? '★ 不过' : '过'));
console.log('  shapeOf 两个方向都动过（认得圆 / 认不出 zzz）  ' + (selfShape.length ? '★ 不过' : '过'));
console.log('  clean 有该洗的、也有不许动的  ' + (selfClean.length ? '★ 不过' : '过'));
if (selfBad.length) {
  console.log('');
  console.log('★★★ 尺子自己坏了 —— 下面那份清单**一条都别信**，先修 test/probe_tabpage.cjs：');
  selfBad.forEach(x => console.log('    · ' + x));
  process.exit(3);
}

console.log('');
console.log('===== A 腿结果 =====');
console.log('  ' + (NAMED.length + CLEANS.length + 1 - bad) + '/' + (NAMED.length + CLEANS.length + 1) +
  ' 通过' + (bad ? '，★ 有 ' + bad + ' 格红了，见上面' : ''));
console.log('  ⚠ 这只证明**页名算得对**。标签点了之后板子上真换了图没有，得看 B 腿。');

// ============================================================
//  B 腿：真画板（要 LIVE=1）
// ============================================================
if (!process.env.LIVE) {
  console.log('');
  console.log('===== B 腿：没跑 =====');
  console.log('  它要在真画板上读 `getAllObjectNames()`（那才是"标签指着第 2 页、画板上就是第 2 页"的直接证据）。');
  console.log('  开法：先 `node test/serve.cjs 8138`，Chrome 挂在 9222，再：');
  console.log('    LIVE=1 node test/probe_tabpage.cjs');
  console.log('  ★ 上面 A 腿的绿**不能**替 B 腿结账。');
  process.exit(bad ? 1 : 0);
}

const http = require('http');
let WebSocket;
try {
  WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
} catch (e) {
  console.log('\n★ B 腿起不来：找不到 ws 模块（' + e.message + '）。退出码 3，别把这次读成"过了"。');
  process.exit(3);
}
const put = p => new Promise((res, rej) => {
  const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
  r.on('error', rej); r.end();
});
const closeTab = id => new Promise(res => http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res));

(async () => {
  let TAB = null;
  try {
    const t = JSON.parse(await put('/json/new?about:blank'));
    TAB = t.id;
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pend = {};
    const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
    await new Promise(r => ws.on('open', r));
    await send('Runtime.enable', {}); await send('Page.enable', {});
    const q = async e => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      const Rr = r.result;
      if (Rr && Rr.exceptionDetails) return 'THROW: ' + String(Rr.exceptionDetails.exception && Rr.exceptionDetails.exception.description).slice(0, 300);
      return Rr && Rr.result ? Rr.result.value : null;
    };
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ★★ 量哪儿可以指定：孔老师的规矩是「UI 验收看线上，不看本地截图」，
    //   所以这条 B 腿最该量的就是线上那一份。默认仍是本机 8138（快、改完立刻能验）。
    const SITE = process.env.SITE || 'http://localhost:8138/index.html';
    console.log('');
    console.log('  （量的地方：' + SITE + '）');
    await send('Page.navigate', { url: SITE });
    await sleep(1200);
    // ★ 硬重载：同域的普通导航会吃缓存，会把**已经生效的改动**误判成"没生效"。
    //   （这条是这个仓库反复吃过的亏，见记忆里那条"核改动生效没生效必须先硬重载"。）
    await send('Page.reload', { ignoreCache: true });
    await sleep(2500);

    // ---- 等画板就绪：**等条件成立**，不是睡一个猜的秒数 ----
    //   GeoGebra 那一包要从 CDN 拉，冷缓存下三秒起步；睡死一个数会报假警报，
    //   而那种假警报长得跟"多页坏了"一模一样，最误导。
    let ready = false, secs = 0;
    for (; secs < 40; secs++) {
      const st = await q('({t: typeof SR!=="undefined" && !!(SR.tabs&&SR.tabs.count),' +
        ' b: typeof SR!=="undefined" && !!(SR.board&&SR.board.isReady&&SR.board.isReady()),' +
        ' g: typeof window.ggbApplet!=="undefined" && !!window.ggbApplet,' +
        ' a: typeof SR!=="undefined" && !!(SR.board&&SR.board.applet&&SR.board.applet()),' +
        ' c: typeof SR!=="undefined" && !!(SR.tabs&&SR.tabs.count&&SR.tabs.count()===1)})');
      if (st && st.t && st.b && st.g && st.a && st.c) { ready = true; break; }
      if (secs === 39) {
        console.log('\n★★★ B 腿开不了，等了 40 秒还是缺东西 —— 下面每一条都别信：');
        console.log('    js/tabs.js 装上了吗（SR.tabs.count）  ' + (st && st.t ? '在' : '★ 不在'));
        console.log('    画板就绪吗（SR.board.isReady）        ' + (st && st.b ? '就绪' : '★ 没就绪（GeoGebra 那个 CDN？）'));
        console.log('    画板句柄拿得到吗（SR.board.applet）    ' + (st && st.a ? '在' : '★ 不在'));
        console.log('    window.ggbApplet 在吗                 ' + (st && st.g ? '在' : '★ 不在'));
        console.log('    开场那一页建好了吗（count===1）        ' + (st && st.c ? '好了' : '★ 没建好 —— 启动还没跑完（见下面那段注释）'));
      }
      await sleep(1000);
    }
    if (!ready) { await closeTab(TAB); process.exit(3); }
    console.log('（画板就绪用了 ' + (secs + 1) + ' 秒）');

    // ---- 如果 SR_TABS 指的不是页面上那一份，就把那一份**注入**进来顶掉 SR.tabs ----
    // ★ 为什么非要有这一段：B 腿量的是浏览器从磁盘加载的那份 tabs.js，而"证明它会红"
    //   要求把代码改坏。就地改真文件万一进程被强杀，留在盘上的就是一份残废的 tabs.js。
    //   改成把改坏的副本送进页面替换 `SR.tabs`——磁盘上的真文件全程没碰。
    //   ⚠ 拼成普通字符串，**不能用模板字符串**：tabs.js 的注释里带反引号。
    if (process.env.SR_TABS) {
      const src = fs.readFileSync(process.env.SR_TABS, 'utf8');
      const inj = await q('(function(){ try { ' + src +
        '\n; return String(typeof SR.tabs.drawHere)+\"|\"+String(typeof SR.tabs.go);' +
        ' } catch (e) { return \"THROW \"+e.message; } })()');
      if (inj !== 'function|function') {
        console.log('\n★★★ 注入改坏的那份 tabs.js 失败了（读到 ' + JSON.stringify(inj) + '）。');
        console.log('    这一趟量到的还是磁盘上那份**好**的，所以它红不了 —— 别当中立证据。');
        await closeTab(TAB); process.exit(3);
      }
      // ★★ 注入完**必须**替它把 `init` 喊上，喊完当场核一遍。
      //
      //   为什么非喊不可：`live` 那一道闸（`js/tabs.js` 的 init 里置真）和**开场那一页**
      //   都是 `init` 建的。注入进来的是一份全新的模块——`live` 是假、`pages` 是空的。
      //   于是**每一次** drawHere 都撞上"画板还没就绪就走老路"那条退路：
      //   板子照画不误，**账本一格不涨**。
      //   症状是**整片红**——十一格一起 ✗，每格都写着 `count=0 cur=-1`。
      //   它长得跟"产品烂了"一模一样，其实是**尺子自己没起来**：
      //   2026-10-02 就在这儿烧掉一整轮，`_redfirst_tabpage` 连跑三刀、三刀都是十一格红，
      //   一刀都没指到它该指的那一格。★ 那十一格红**一个字的证据都不算**。
      //
      //   为什么上面那条就绪判据里特地加了 `c`（count===1）：`init` 是 main.js 在启动末尾调的。
      //   它要是**在我注入之后**才跑，就会把注入那份带着一起 init——多出一页；
      //   顺序稍微一歪，就变成"注入那份永远没人 init"。等 count===1 再动手，
      //   启动就已经跑完了，谁也不会追谁的尾。
      const st2 = await q('(function(){ try { SR.tabs.init("tabs");' +
        ' return { ok:true, n:SR.tabs.count(), cur:SR.tabs.current() };' +
        ' } catch (e) { return { ok:false, why:String(e.message||e) }; } })()');
      if (!(st2 && st2.ok && st2.n === 1 && st2.cur === 0)) {
        console.log('\n★★★ 注入那份 tabs.js 起来了，但**没能当真在用的那一份**（' + JSON.stringify(st2) + '）。');
        console.log('    要的是"开场那一页已经建好"：count=1、cur=0。');
        console.log('    对不上的话，它每一次画图都会走退路、账本一直空着 ——');
        console.log('    那种读数会让**每一格**都报红，而红的理由跟你要验的那一刀毫无关系。');
        console.log('    ★ 这趟数不算，别读成"产品坏了"。');
        await closeTab(TAB); process.exit(3);
      }
      console.log('  （B 腿跑的是注入进来的那份：' + path.basename(process.env.SR_TABS) +
        ' —— 磁盘上的 js/tabs.js 没碰；已替它 init，count=1 cur=0 ✓）');
    }

    // ---- 把"怎么读证据"装进页面里，只装一份 ----
    //   ★ 判据一律从**画板自己**读，不读 tabs.js 的账（`pages`）。理由见文件头。
    await q(String.raw`window.__tpRead = function () {
      var names = [];
      try { names = (window.ggbApplet.getAllObjectNames() || []).slice().sort(); } catch (e) { return { err: e.message }; }
      var host = document.getElementById('tabs');
      var btns = host ? host.querySelectorAll('button.tab') : [];
      var on = -1, pend = [];
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].classList.contains('on')) on = i;
        if (btns[i].querySelector('i.dot')) pend.push(i);
      }
      var labels = [];
      for (var j = 0; j < btns.length; j++) {
        var sp = btns[j].querySelector('span.tt');
        labels.push(sp ? sp.textContent : '?');
      }
      return {
        names: names,
        board3d: (SR.board && SR.board.is3D) ? !!SR.board.is3D() : null,
        busy: (SR.board && SR.board.isBusy) ? !!SR.board.isBusy() : null,
        tabsHidden: host ? (host.style.display === 'none') : null,
        btnCount: btns.length, on: on, dotOn: pend, labels: labels,
        cur: SR.tabs.current(), count: SR.tabs.count(),
        titles: SR.tabs.titles(), pending: SR.tabs.pending(), following: SR.tabs.isFollowing()
      };
    }; 1`);

    const read = async () => {
      const r = await q('JSON.stringify(window.__tpRead())');
      if (typeof r !== 'string' || r.indexOf('{') !== 0) return null;
      try { return JSON.parse(r); } catch (e) { return null; }
    };
    // ★ 等条件成立再读，不睡死一个数。`f` 收一个"这一趟成了吗"的判据。
    const waitFor = async (desc, f, maxMs) => {
      const t0 = Date.now();
      let last = null;
      while (Date.now() - t0 < (maxMs || 15000)) {
        last = await read();
        if (last && f(last)) return last;
        await sleep(250);
      }
      return null;
    };
    const has = (r, ...objs) => r && objs.every(o => r.names.indexOf(o) >= 0);
    const hasNot = (r, ...objs) => r && objs.every(o => r.names.indexOf(o) < 0);
    const show = r => r ? ('对象[' + r.names.join(',') + '] 3D=' + r.board3d + '　标签 ' + r.btnCount +
      ' 个 选中第 ' + (r.on + 1) + ' 个　账: count=' + r.count + ' cur=' + r.cur +
      ' pending=' + JSON.stringify(r.pending)) : '（读不到）';

    let bBad = 0;
    const CHECKS = [];
    const check = (name, ok, detail) => {
      CHECKS.push([name, ok]);
      if (!ok) bBad++;
      console.log((ok ? '  ✓ ' : '  ✗ ') + name);
      if (detail) console.log('      ' + detail);
    };

    console.log('');
    console.log('===== 尺子自检（B 腿）：我读的是不是真画板 =====');
    // ★★ 这一格的全部意义：如果"读画板"这件事本身是瞎的（拿到的一直是同一个空数组），
    //    下面每一条判据都会**看起来**很合理——直到你发现它从来没变过。
    //    所以先证明：建一个对象 → 读得到；清掉 → 读不到。**它在两个方向上都变过。**
    //   ⚠ 标签名不能用下划线开头（`__tpCanary` 我试过，evalCommand 直接回 false，
    //     一个对象都不建）。那一次假警报长得**和产品坏了完全一样**，查了半天才发现是尺子的错。
    //     所以下面把 evalCommand 的返回值也打出来：以后再有"读不到"，
    //     一眼分得清是**命令被拒了**还是**读数没接上**。
    const canRet = await q('String(window.ggbApplet.evalCommand("tpCanary=(7,7)"))');
    let can = await waitFor('canary', r => r.names.indexOf('tpCanary') >= 0, 8000);
    const canSaw = !!can;
    await q('SR.board.clear()');
    const canGone = await waitFor('canary gone', r => r.names.indexOf('tpCanary') < 0, 8000);
    check('尺子自检：建个对象读得到、清掉就读不到（读画板这件事在两个方向上都动过）',
      canSaw && !!canGone,
      'evalCommand 返回 ' + canRet + '　' +
      (canSaw ? '建好了读得到 ✓' : '★ 建了对象读不到 —— 下面每一条都别信') + '　' +
      (canGone ? '清掉了读不到 ✓' : '★ 清掉了还读得到 —— 读数是从别处来的'));
    if (!canSaw || !canGone) {
      console.log('  ★★ 读数来源坏了 —— 下面那九格一格都别信。');
      await closeTab(TAB); process.exit(3);
    }

    // ---- 每张图都**自己起标签名**，不靠 GeoGebra 自动起 ----
    // ★★ 为什么非这样不可（这里是量出来的，不是猜的）：自动起的名字**没法预料**，
    //   而且它会去抢别人的名字——`Segment((0,0),(3,0))` 单独建时自动叫 `f`，
    //   跟函数图象那个 `f` 撞在一起。判据就废了：第二张图的等待条件会被第一张图的对象喂饱，
    //   "切页真的生效了"变成一句空话。自己起名之后，每张图的指纹是**我指定的那几个**。
    //   实测过的五个名字（test/_tp_names2.cjs）：axis / f1 / K1,K2 / poly1 / seg1。
    const F1 = ['#清空', 'P1=(-2,0)', 'P2=(3,0)', 'axis=Segment(P1,P2)'];   // 数轴
    const F2 = ['#清空', 'f1(x)=x^2'];                                       // 函数图象
    const F3 = ['#清空', '#三维', 'K1=(0,0,0)', 'K2=(2,0,0)', 'Cube(K1,K2)'];// 立体图
    const F4 = ['#清空', 'M1=(-1,0)', 'M2=(3,0)', 'M3=(3,2)', 'poly1=Polygon(M1,M2,M3)'];
    const F5 = ['#清空', 'U=(1,1)', 'V=(2,3)', 'seg1=Segment(U,V)'];

    console.log('');
    console.log('===== B 腿：标签点了，板子上真换了图没有 =====');

    // ---- 格子 1：第一张图落在开场那块空板上（不该多出一个标签）----
    await q('SR.tabs.drawHere(' + JSON.stringify(F1) + ', "数轴")');
    let r1 = await waitFor('fig1', r => has(r, 'P1', 'P2', 'axis') && !r.busy, 20000);
    check('① 第一张图：画在开场那块空板上，**没有**多出一个标签',
      !!r1 && r1.count === 1 && r1.titles[0] === '数轴' && r1.btnCount === 0 && r1.tabsHidden === true,
      r1 ? show(r1) + '　页名' + JSON.stringify(r1.titles) +
          '（期望 count=1、页名「数轴」、标签条整条藏着）' : '等了 20 秒 P1/P2/axis 没到齐');

    // ---- 格子 2：第二张图 → 多出一页，板子上换成第二张 ----
    await q('SR.tabs.drawHere(' + JSON.stringify(F2) + ', "")');
    let r2 = await waitFor('fig2', r => has(r, 'f1') && hasNot(r, 'P1') && !r.busy, 20000);
    check('② 第二张图：又多一页（标签条冒出来），页名从命令认出来是「函数图象」',
      !!r2 && r2.count === 2 && r2.titles[1] === '函数图象' && r2.btnCount === 2 &&
      r2.tabsHidden === false && r2.on === 1,
      r2 ? show(r2) + '　页名' + JSON.stringify(r2.titles) +
          '（期望 count=2、页名[数轴,函数图象]、两个标签按钮、选中第 2 个）' : '等了 20 秒 f1 没到');

    // ---- 格子 3：点回第 1 页 —— ★ 板子上真的换回第一张 ----
    //   ★★ 这是整个文件的重点：判据是**画板自己报的对象清单**，
    //      不是 tabs.js 说"我现在在第 1 页"。两个东西分家，症状就是看着挺好、点过去是另一张图。
    await q('SR.tabs.go(0)');
    let r3 = await waitFor('back1', r => has(r, 'P1', 'P2', 'axis') && hasNot(r, 'f1') && !r.busy, 20000);
    check('③ 点回第 1 页：画板上真的是第一张（P1/P2/axis 在、f1 不在了）',
      !!r3 && r3.cur === 0 && r3.on === 0 && r3.titles[0] === '数轴',
      r3 ? show(r3) + '　（期望：对象里有 P1/P2/axis、没有 f1，选中第 1 个标签）' :
        '等了 20 秒板子没换回第一张 —— 切页没生效，或者切过去是**另一张图**');

    // ---- 格子 4：再点回第 2 页 ----
    await q('SR.tabs.go(1)');
    let r4 = await waitFor('back2', r => has(r, 'f1') && hasNot(r, 'P1') && !r.busy, 20000);
    check('④ 再点回第 2 页：画板上真的是第二张（f1 在、P1 不在了）',
      !!r4 && r4.cur === 1 && r4.on === 1 && r4.following === true,
      r4 ? show(r4) + '　（期望：f1 在、P1 不在，选中第 2 个，following=true）' :
        '等了 20 秒没换回第二张');

    // ---- 格子 5：三维 ↔ 平面往返两次 ----
    //   ★ 为什么专挑这条：GeoGebra 的 `setBase64` 会不会把**三维视角**一起带回来，
    //     是上一趟量出来的（`getPerspectiveXML` 是唯一可靠的判据）。
    //     一次往返看不出来"是运气还是真带回来了"，所以**来回各一次**。
    await q('SR.tabs.drawHere(' + JSON.stringify(F3) + ', "")');
    let r5a = await waitFor('3d', r => has(r, 'K1', 'K2') && r.board3d === true && !r.busy, 25000);
    check('⑤a 第三张图是三维的：板子确实进了三维视角，页名「立体图」',
      !!r5a && r5a.count === 3 && r5a.titles[2] === '立体图' && r5a.board3d === true,
      r5a ? show(r5a) + '　页名' + JSON.stringify(r5a.titles) : '等了 25 秒没进三维（或 K1/K2 没建出来）');

    await q('SR.tabs.go(1)');
    let r5b = await waitFor('2d back', r => r.board3d === false && has(r, 'f1') && !r.busy, 20000);
    check('⑤b 切回第 2 页（平面的）：**视角也切回来了**，没停在三维里',
      !!r5b && r5b.board3d === false && has(r5b, 'f1') && hasNot(r5b, 'K1') && r5b.cur === 1 && r5b.on === 1,
      r5b ? show(r5b) + '　（期望 board3d=false、f1 在 K1 不在、选中第 2 个；' +
        '停在三维里的话，一个平面上的抛物线会画在斜着的空间里）' :
        '等了 20 秒视角没切回平面 —— 这是快照没带上视角的典型症状');

    await q('SR.tabs.go(2)');
    let r5c = await waitFor('3d back', r => r.board3d === true && has(r, 'K1') && hasNot(r, 'f1') && !r.busy, 25000);
    // ★★ 这里必须**同时**断言 `cur===2`。第一版只看了"板子上是不是三维"——
    //   而当时 `count` 只有 2（⑤a 那个"少开一页"的 bug），`go(2)` 是个**越界调用，
    //   直接 return 了**，板子压根没动；它之所以显示三维，是因为上一格留下的就是三维。
    //   **这一格于是"因为没生效而变绿"**——最坏的那种假绿，它替真正的 bug 打了掩护。
    //   （这次是 ⑤a 一起红了才顺出来的；下回要是 ⑤a 单独坏了，它会一声不响地绿着。）
    check('⑤c 再切回第 3 页：**三维视角又回来了**（来回各一次，不是碰巧）',
      !!r5c && r5c.board3d === true && has(r5c, 'K1', 'K2') && hasNot(r5c, 'f1') &&
      r5c.cur === 2 && r5c.on === 2,
      r5c ? show(r5c) + '　（期望：三维、K1/K2 在 f1 不在、选中第 3 个）' : '等了 25 秒没切回三维');

    // ---- 格子 6：老师正翻着旧图时来新图 → 挂后台，**一根汗毛都不动他眼前的板** ----
    await q('SR.tabs.go(1)');                      // 停在第 2 页（不是最后一页）
    const before = await waitFor('park', r => r.cur === 1 && !r.busy, 15000);
    await q('SR.tabs.drawHere(' + JSON.stringify(F4) + ', "")');
    await sleep(300);
    const r6a = await read();
    // ★ 再等一会儿**再读一次**：万一它是"晚点才偷偷洗板"，一次读是不够的。
    await sleep(1500);
    const r6b = await read();
    const untouched = r6a && r6b && before &&
      r6a.names.join(',') === before.names.join(',') &&
      r6b.names.join(',') === before.names.join(',');
    check('⑥ 他在看第 2 页时来新图：新图挂后台（第四个标签带一个点），**画板上什么都没变**',
      !!r6a && r6a.count === 4 && r6a.pending[3] === true && r6a.cur === 1 && untouched,
      (r6a ? show(r6a) + '　带点的标签:' + JSON.stringify(r6a.dotOn) : '读不到') + '　' +
      (untouched ? '板子前后一致（'+ (before ? before.names.join(',') : '?') +'）✓'
                 : '★ 板子被动了：之前[' + (before ? before.names.join(',') : '?') + '] 之后[' +
                   (r6b ? r6b.names.join(',') : '?') + ']'));

    // ---- 格子 7：点那个带点的标签，它才画 ----
    await q('SR.tabs.go(3)');
    let r7 = await waitFor('pending', r => has(r, 'M1', 'M2', 'poly1') && !r.busy && r.pending[3] === false, 25000);
    check('⑦ 点那个带点的标签：这时候才画上去，页名「多边形」，点也没了',
      !!r7 && r7.cur === 3 && r7.pending[3] === false && r7.titles[3] === '多边形' && r7.on === 3,
      r7 ? show(r7) + '　页名' + JSON.stringify(r7.titles) + '　带点的标签:' + JSON.stringify(r7.dotOn) :
        '等了 25 秒还没画出来');

    // ---- 格子 8：点「清空」之后，这一页的存档要一起作废 ----
    //   ★ 判据同样是画板：清空 → 存档作废 → 接着画 → **还落在原来那一页**（不多标签），
    //     而且再切走、切回来，**不该把刚清掉的那张图长回来**。
    await q('SR.tabs.go(0)');
    await waitFor('pg0', r => has(r, 'P1', 'P2', 'axis') && !r.busy, 20000);
    await q('SR.board.clear()');                 // 她点工具条那颗「清空」
    await q('SR.tabs.cleared()');
    const r8a = await waitFor('cleared', r => r.names.length === 0, 10000);
    await q('SR.tabs.drawHere(' + JSON.stringify(F5) + ', "")');
    const r8sync = await read();                 // ★ 同步读：挂标签不等画完，所以这一刻就该定下来了
    const r8b = await waitFor('reuse', r => has(r, 'U', 'V', 'seg1') && !r.busy, 20000);
    check('⑧ 清了板再要一张图：**接着用原来那一页**（不多出空标签），板子上是新的一张',
      !!r8b && r8b.count === 4 && r8b.cur === 0 && !!r8a && r8a.titles[0] === '空白页' && has(r8b, 'U', 'V'),
      (r8a ? '清空后：页名' + JSON.stringify(r8a.titles) + ' 板子[' + r8a.names.join(',') + ']' : '清空没读到板子变空') +
      '　接着读到的（同步，还没画完）：count=' + (r8sync ? r8sync.count : '?') + ' 页名' + (r8sync ? JSON.stringify(r8sync.titles) : '?') +
      '　画完：' + (r8b ? show(r8b) : '读不到') + '　（期望 count 仍是 4、cur=0、页名[0] 不再是「空白页」）');

    // 再切走切回来，看刚清掉的那张是不是又长回来了
    await q('SR.tabs.go(1)');
    await waitFor('away', r => has(r, 'f1') && !r.busy, 20000);
    await q('SR.tabs.go(0)');
    let r8c = await waitFor('back0', r => has(r, 'U', 'V') && hasNot(r, 'P1', 'axis') && !r.busy, 20000);
    check('⑧b 切走再切回来：回来的是清空之后那张（U/V），**不是**清空之前那张（P1/axis）',
      !!r8c && has(r8c, 'U', 'V') && hasNot(r8c, 'P1', 'axis'),
      r8c ? show(r8c) + '　★ 要是这里冒出 P1/axis，症状就是"清空没生效"——她点了清空，回头图自己长回来了' : '等了 20 秒没切回来');

    // ---- 格子 9：标签上限（放最后：它会连着排一队活儿，不等它画完）----
    //   ★ `addPage` 是**同步**的（挂标签不等板子），所以直接紧着喊十几次就够，
    //     不必每次等它画完——那样得跑两三分钟。
    //   ⚠ 这一格跑完画板还排着一队活，所以它**必须是最后一格**。
    const maxN = await q('SR.TABS_MAX');
    await q('for (var i=0;i<15;i++) SR.tabs.drawHere(["#清空","Z"+i+"=(0,"+i+")"], "第"+i+"张"); 1');
    const r9 = await read();
    check('⑨ 标签上限：连着要 15 张，页数被压在上限以内（当前这一页和最新那页永远留着）',
      !!r9 && typeof maxN === 'number' && r9.count <= maxN && r9.count >= Math.min(maxN, 15),
      'SR.TABS_MAX=' + maxN + '　连着要 15 张之后 count=' + (r9 ? r9.count : '?') +
      '（期望 ≤ ' + maxN + '）' + (r9 ? '　页名' + JSON.stringify(r9.titles).slice(0, 120) : ''));

    console.log('');
    console.log('===== B 腿结果 =====');
    const pass = CHECKS.filter(x => x[1]).length;
    console.log('  ' + pass + '/' + CHECKS.length + ' 通过' + (bBad ? '，★ 有 ' + bBad + ' 格红了，见上面' : ''));
    console.log('  （每一格的判据都是画板自己报的对象清单 / 视角，不是 tabs.js 的账）');
    await closeTab(TAB);
    process.exit((bad || bBad) ? 1 : 0);
  } catch (e) {
    console.log('\n★ B 腿炸了：' + e.message);
    console.log('  （最常见的是 Chrome 没挂在 9222，或者 test/serve.cjs 不在 8138。）');
    if (TAB) await closeTab(TAB);       // ★ 关掉自己开的标签页：`/json/new` 只管开不管关
    process.exit(3);
  }
})();
