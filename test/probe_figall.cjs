// 初中数学作图「万能体检表」——把孔老师可能要的图**一类一类**打过去，看哪些画不出来。
//
// 为什么要这一把（2026-10-04 孔老师原话）：
//   「把初中数学可能做的图，都让智能体做一遍，看看哪些做不出来，尺规作图的动图也试试看，
//     还有那些几何试卷题动点作图，什么轴对称，什么旋转，什么三视图，什么长方形折叠的动图，
//     我希望这个智能体能很万能。」
//
// ★ 这一把**同时量三层**，缺一层就会得出假的结论：
//     ① 模型层：给了这句话，它**写不写** ```ggb 围栏。（probe_drawfence 量的是这层）
//     ② 翻译层：它写的中文命令，board.js 翻成英文后画板**认不认**。（probe_zhcmd 量的是这层）
//     ③ 成品层：画板上**真建出了几个对象**、点了播放**会不会动**。
//   只量①：会以为"出图了"就好了——可板上一片空白也照样算"出图"。
//   只量②：会以为"命令都认"就好了——可模型根本没写那条命令时它也是绿的。
//   孔老师问的是「能不能很万能」——那是**老师点一下看到的那个结果**，也就是第③层。
//
// ★ 还有一个必须分开的读数：「**建出来了但不会动**」和「**建出来了而且会动**」。
//   动图（折叠、旋转、动点、a 变化）他要的是一整类。判"会不会动"不能看命令里有没有
//   `Slider` 这几个字（那是猜），得**真的按一下播放、隔一秒再看那个点的坐标变没变**
//   ——挑一个会变的量去量。（同族教训：[[scanner-numbers-are-not-what-they-claim]]）
//
// 用法：node test/probe_figall.cjs [每句打几次，默认 1] [只跑第几号，逗号分隔]
//   例：node test/probe_figall.cjs 1 1,15,51      ← 先拿三句试通路，别一上来跑全场
//   ⚠ 全场 ≈ 9 分钟。跑之前先确认 Chrome 在 9222（**开着的窗口**）＋ serve.cjs 在 8138。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const N = Number(process.argv[2] || 1);
// 只跑指定的几号（1 起）——先拿三句试通路，再跑全场。
//   ⚠ 过滤必须在**编号之前**，不然"第 51 号"会变成"过滤后那几条里的第 51 号"，
//     读出来的编号跟我嘴里的编号对不上。（量具自己的编号不能骗人。）
const ONLY = (process.argv[3] || '').split(',').map(s => Number(s.trim())).filter(n => n > 0);
// —— 期望值只有三种 ——
//   '静'  = 该画出一张能看的静态图
//   '动'  = 该画出一张**点播放会动**的图
//   '不画' = 这句没法画，**一个围栏都不许出**（对照组，防"会画"是靠硬凑得来的）
const 表 = [
  // ── A 基本图形（七上·七下）────────────────────────────
  ['A 数轴', '画一条数轴，在数轴上标出 -2、0、3 这三个点', '静'],
  ['A 解集', '把不等式 x-1>2 的解集在数轴上表示出来', '静'],
  ['A 线段中点', '画一条线段 AB，标出它的中点 M，并标出 AM=MB', '静'],
  ['A 角平分线', '画一个角 AOB，再画出它的角平分线 OC', '静'],
  ['A 三线八角', '画两条平行线，再画一条截线，标出同位角 1 和 2', '静'],
  ['A 三角形三线', '画三角形 ABC，画出 BC 边上的高 AD、中线 BE 和角平分线 CF', '静'],
  ['A 内角和拼图', '把三角形的三个角剪下来拼在一起，说明内角和是 180 度', '静'],
  ['A 公式拼图', '用图形说明 (a+b)² = a²+2ab+b²', '静'],

  // ── B 尺规作图（他点名要）────────────────────────────
  ['B 尺规·等线段', '用尺规作一条线段等于已知线段 AB', '静'],
  ['B 尺规·等角', '用尺规作一个角等于已知角 AOB', '静'],
  ['B 尺规·角平分线', '用尺规作角 AOB 的平分线', '静'],
  ['B 尺规·中垂线', '用尺规作线段 AB 的垂直平分线', '静'],
  ['B 尺规·过点作垂线', '用尺规过直线外一点 P 作这条直线的垂线', '静'],
  ['B 尺规·SSS', '已知三边 a、b、c，用尺规作一个三角形', '静'],
  ['B 尺规·动图', '画一个尺规作角的平分线的过程动图，圆规画弧的过程能动起来', '动'],

  // ── C 轴对称·旋转·折叠（他点名）──────────────────────
  ['C 轴对称·图形', '画三角形 ABC 和一条直线 l，作三角形 ABC 关于直线 l 的对称图形', '静'],
  ['C 轴对称·点', '画一个点 A 和一条直线 l，作点 A 关于直线 l 的对称点 A′，连上 AA′', '静'],
  ['C 长方形折叠', '画一个长方形 ABCD，把角 B 沿着一条线折过去，动图', '动'],
  ['C 折痕题', '长方形 ABCD 中，把三角形 ABE 沿 AE 折叠，点 B 落在点 F 处，画出折后的图形', '静'],
  ['C 中心对称', '把三角形 ABC 绕点 O 旋转 180 度', '静'],
  ['C 旋转 60 度', '把三角形 ABC 绕点 O 顺时针旋转 60 度，做成能看的动图', '动'],
  ['C 连续旋转图案', '把同一个图形绕一点连续旋转 60 度六次，转出一个图案', '动'],
  ['C 平移', '把三角形 ABC 沿向量平移一段距离', '静'],
  ['C 位似', '以点 O 为位似中心，把三角形 ABC 放大 2 倍', '静'],

  // ── D 函数图象 ──────────────────────────────────────
  ['D 一次函数', '画一次函数 y=2x+1 的图象，并标出它与 x 轴、y 轴的交点', '静'],
  ['D 一次函数平移', '画 y=2x+1 的图象，让它的图象上下平移的动图', '动'],
  ['D 反比例', '画反比例函数 y=6/x 的图象', '静'],
  ['D 反比例 k 的意义', '画反比例函数 y=6/x 的图象，并在图象上取一点 P，画出它到两坐标轴的垂线围成的矩形', '静'],
  ['D 二次函数', '画二次函数 y=x²-2x-3 的图象，标出顶点和对称轴', '静'],
  ['D 二次函数 a 变化', '画二次函数 y=ax² 的图象，让 a 变化的动图', '动'],
  ['D 图象法解方程组', '用图象法解方程组 y=2x-1 和 y=-x+5', '静'],

  // ── E 三视图·立体（他点名）───────────────────────────
  ['E 正方体', '画一个正方体，并画出它的三视图', '静'],
  ['E 小方块三视图', '画出由 4 个小立方块搭成的几何体，并画出它的主视图、左视图、俯视图', '静'],
  ['E 正方体展开图', '画出正方体的一种展开图', '静'],
  ['E 圆柱展开', '画一个圆柱，并画出它的侧面展开图', '静'],
  ['E 圆锥展开', '画一个圆锥，并画出它的侧面展开图', '静'],
  ['E 立体旋转', '画一个圆锥，让它转起来给我看', '动'],

  // ── F 圆（九上）──────────────────────────────────────
  ['F 垂径定理', '画一个圆 O，画一条弦 AB，过 O 作 AB 的垂线交 AB 于 M，标出 AM=MB', '静'],
  ['F 圆周角', '画一个圆，同一段弧 AB 上取两个点 C、D，画出角 ACB 和角 ADB', '静'],
  ['F 切线', '画一个圆 O，过圆上一点 A 作圆的切线', '静'],
  ['F 圆内接正六边形', '画一个圆的内接正六边形', '静'],
  ['F 扇形', '画一个半径 3、圆心角 120 度的扇形', '静'],

  // ── G 统计图（八下·新课标）───────────────────────────
  ['G 条形图', '画一个条形统计图：篮球 8 人、足球 12 人、乒乓球 6 人', '静'],
  ['G 扇形图', '画一个扇形统计图：篮球占 40%、足球占 35%、乒乓球占 25%', '静'],
  ['G 折线图', '画一个折线统计图，表示某地一周每天的气温', '静'],
  ['G 直方图', '画一个频数分布直方图', '静'],
  ['G 箱线图', '画一个箱线图，表示这组数据的四分位数', '静'],

  // ── H 试卷几何题 → 动图（他最后强调的那一件）──────────
  ['H 矩形动点', '长方形 ABCD 中，点 P 从点 A 出发沿 AB 边向点 B 运动，画出三角形 PCD 的面积随 P 变化的动图', '动'],
  ['H 数轴动点', '数轴上点 P 从 -2 出发，以每秒 1 个单位的速度向右运动，画出它运动的动图', '动'],
  ['H 抛物线上动点', '抛物线 y=x²-2x-3 上有一个动点 P，画出三角形 PAB 面积最大的动图', '动'],
  ['H 相似动点', '在三角形 ABC 中，点 D 在 AB 上运动，DE 平行 BC 交 AC 于 E，画出这个过程的动图', '动'],

  // ── 对照组：这两句**一个围栏都不许出** ─────────────────
  ['对照·乱字符', '1111', '不画'],
  ['对照·无关话', '今天天气不错', '不画']
];

const put = p => new Promise((res, rej) => {
  const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
  r.on('error', rej); r.end();
});
// 编号**先钉死**在原始表上，再过滤。过滤后重编会让我嘴里的"第 51 号"和输出对不上。
const 全表 = 表.map((r, i) => ({ 号: i + 1, 组: r[0], 句: r[1], 期望: r[2] }));
const 跑 = ONLY.length ? 全表.filter(r => ONLY.indexOf(r.号) >= 0) : 全表;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  // ★ 宽度按 **2000** 给：数根是三栏（工位条 + 对话 + 画板），画板那一栏在 x≈1465 起。
  //   按 1440 模拟，画板整块**落在视口外面**——截图画板会截到一片空，两张空图当然"一模一样"，
  //   于是一张真会动的图被量成"不动"。第一次就是这么栽的：不是产品不动，是我截了一块看不见的地方。
  await send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1000, deviceScaleFactor: 1, mobile: false });

  // ★ 取回值一律走这一条：**THROW 当异常抛**，不返回字符串。
  //   栽过的坑：以前 q() 出错返回 'THROW: …'，而字符串是**真值**，
  //   于是 `while(... q('就绪了吗'))` 当场放行——25 条假红，样子跟产品坏了长得一样。
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    const R = r.result;
    if (R && R.exceptionDetails) throw new Error('页面里炸了: ' + String(R.exceptionDetails.exception && R.exceptionDetails.exception.description).slice(0, 200) + '\n    表达式: ' + e.slice(0, 160));
    return R && R.result ? R.result.value : null;
  };

  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  let 就绪 = false;
  for (let i = 0; i < 40; i++) {
    await sleep(700);
    if (await q('!!(window.SR&&SR.board&&SR.board.isReady&&SR.board.isReady())') === true) { 就绪 = true; break; }
  }
  if (!就绪) { console.log('画板一直没起来——先看那一页有没有报错'); process.exit(1); }
  // 把这一页拿到最前面：后台标签页里 rAF 被节流，截图会**稳在同一帧**上，
  //   于是一张真会动的图会被量成"不动"——又一个是"稳的错值"。
  await send('Page.bringToFront', {});

  // ★★ 2026-10-04 加：开跑前**验签**——把"这一页现在跑的是哪一份 render.js"打出来。
  //   为什么要这一步：18:02 那份体检表里 #51 还漏着 ```想知道，我改的闸门却在文件里。
  //   真因是**时序**——体检表是长跑，页面在**改文件之前**就加载好了，全程跑的是旧代码，
  //   写完盘的时间戳(18:02)看着"在修复之后"，其实读数是修复前的。
  //   ⚠ 这跟老账里那条同族：**时间戳是"什么时候写完的"，不是"什么时候读的"**。
  //   所以这里不问"我改了吗"，直接问页面：`parseFences` 的源码里有没有那句闸门。
  //   往后凡是改了 render.js / board.js 再跑体检，先看这一行是不是 ★在。
  const 签 = await q('(function(){var s=String(SR.render.parseFences);'
    + 'return {闸门:s.indexOf("RE_FENCEOPEN")>=0, 老规矩:s.indexOf("RE_TICKLINE")>=0}})()');
  console.log('   [验签] 页面里的 render.js：新闸门 RE_FENCEOPEN ' + (签 && 签.闸门 ? '★在' : '✗不在——跑的是旧代码，读数一律作废')
    + '　老规矩 RE_TICKLINE ' + (签 && 签.老规矩 ? '在' : '✗不在'));
  if (!签 || !签.闸门) { console.log('   页面跑的不是当前源码，先停下——别拿旧代码的读数当结论'); process.exit(3); }

  const 框 = await q('(function(){var e=document.getElementById("ggb"); if(!e) return null;'
    + 'var r=e.getBoundingClientRect(); return {x:Math.round(r.left),y:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)};})()');
  // ★★ "画板上这一眼"取的是**画板自己渲染的那张图**（`SR.board.toPNG()`，getPNGBase64），
  //   不是 CDP 截屏。为什么换：CDP 截屏量的是**屏幕上那一块**，只要画板被抽屉挡住、
  //   或者落在模拟视口外面，两张截图就都是空白、一定"一模一样"——
  //   量具自己造出一个"不动"的读数，而它跟"产品真的不动"长得完全一样。
  //   画板自己渲染的图不受视口影响，量的就是**图形**本身变没变，正是我要问的那件事。
  //   ⚠ 空白要**当尺子坏了报出来**，不能当"不动"：长度太短直接返回 null。
  const 拍 = async () => {
    const b64 = await q('SR.board.toPNG()');
    if (typeof b64 !== 'string' || b64.length < 2000) return null;
    return require('crypto').createHash('md5').update(b64).digest('hex');
  };
  const 后端 = await q('SR.api.backend && SR.api.backend().id');
  console.log('画板就绪。后端 = ' + 后端 + '，每句打 ' + N + ' 次，共 ' + 跑.length + '/' + 全表.length + ' 句'
    + (ONLY.length ? '（只跑 ' + ONLY.join(',') + ' 号）' : '') + '。画板框 ' + JSON.stringify(框) + '\n');

  // ═══ 先验这把"会不会动"的尺子本身 ═══
  // ★ 判据写完必须先**在已知会动的图上红一次**（证明它认得出"动了"），
  //   再**在已知不动的图上不许红**（证明它不会把静止当运动）。
  //   少了前半段：尺子恒绿，我也以为"动图都好"；少了后半段：它把画板自身的重绘
  //   抖一下也当成"动了"，那我就会拿着一份假的好看读数去改提示词。
  const 自检 = {};
  {
    const 试 = async (命令, 播放) => {
      await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(450);
      await q('SR.board.run(' + JSON.stringify(命令) + ')');
      for (let i = 0; i < 20; i++) { await sleep(250); if (await q('SR.board.isBusy()') === false) break; }
      await sleep(400);
      const h0 = await 拍();
      if (播放) await q('SR.board.togglePlay()');
      await sleep(1200);
      const h1 = await 拍();
      if (播放) await q('SR.board.stopPlay()');
      if (h0 === null || h1 === null) return null;      // 取不到图 → 尺子坏了，不是"不动"
      return h0 !== h1;
    };
    // ① 真的会动：一个绕点旋转的三角形，滑块 α 驱动
    const 会动的 = ['#清空', 'O=(0,0)', 'A=(2,0)', 'B=(3,1)', 'C=(2,2)', '多边形(A,B,C)',
      'α=Slider(0,6.28,0.05)', '旋转(多边形(A,B,C), α, O)', '#隐藏 α', '#播放 α'];
    自检.会动的图判成动 = await 试(会动的, true);
    // ② 同样一张图、**不按播放**——它一秒后必须长得一模一样
    自检.不播放的图判成不动 = !(await 试(会动的.slice(0, -1), false));
    自检.取得到图 = 自检.会动的图判成动 !== null && 自检.不播放的图判成不动 !== null;
  }
  自检.尺子可用 = 自检.取得到图 && 自检.会动的图判成动 === true && 自检.不播放的图判成不动 === true;
  console.log('  尺子自检：会动的判成动 = ' + 自检.会动的图判成动 + '，不播放的判成不动 = ' + 自检.不播放的图判成不动
    + (自检.尺子可用 ? '  ✅ 这把尺子可用' : '  ❌❌ 尺子本身有问题，下面的动图读数**一律不许信**') + '\n');

  const 记录 = [];
  for (const 条 of 跑) {
    const { 号, 组, 句, 期望 } = 条;
    const 行 = { n: 号, 组, 句, 期望, 次: [] };
    for (let k = 0; k < N; k++) {
      // 每句都从**干净画板**开始，别让上一句的对象混进来充数
      await q('SR.board.stopPlay()'); await q('SR.board.clear()'); await sleep(450);

      // ① 模型层
      const r = await q('(async function(){ try{ var z = await SR.api.ask({work:"draw",history:[],text:' + JSON.stringify(句) + ',onChunk:function(){},onNotice:function(){}});'
        + 'var t = z.text || ""; var P = SR.render.parseFences(t);'
        + 'return {err:z.error||null, model:z.model||"", 围栏:(P.ggb||[]).length, 命令:(P.ggb||[]).join("\\n"), 可见:(P.visible||""), 原文:t}; }'
        + 'catch(e){ return {err:String(e&&e.message||e)}; } })()');
      const 一 = { 错: r && r.err || null, model: r && r.model || '', 围栏: r && r.围栏 || 0, 命令: r && r.命令 || '', 可见: r && r.可见 || '', 原文: r && r.原文 || '' };

      // ② + ③ 翻译层 / 成品层：命令交给产品自己的 run()，再看板上真有什么
      if (一.命令) {
        // ★ 整段**原样**交给产品自己的 run()，连 `#三维` 那一类开关行也一起给——
        //   线上就是这么喂的。我在这儿先替它滤掉井号行，就等于测了一条线上不存在的路。
        await q('SR.board.run(' + JSON.stringify(一.命令.split('\n')) + ')');
        for (let i = 0; i < 24; i++) { await sleep(250); if (await q('SR.board.isBusy()') === false) break; }
        await sleep(500);
        const 板 = await q('(function(){ var a=SR.board.applet(); if(!a) return null;'
          + 'var ns=a.getAllObjectNames(), o={}, ty={};'
          + 'for (var i=0;i<ns.length;i++){ var n=ns[i]; try{ o[n]=String(a.getCommandString(n)); ty[n]=String(a.getObjectType(n)); }catch(e){ o[n]="?"; ty[n]="?"; } }'
          // ⚠ `3D:` 不能当对象字面量的键——数字开头，整段表达式直接 SyntaxError。
          //   （第 51 号那次就是这么炸的，报错只说"Invalid or unexpected token"，不指位置。）
          + 'return {对象:o, 类型:ty, 是三维:SR.board.is3D(), 能播:SR.board.canPlay(), 没认:SR.board.failed()}; })()');
        一.板 = 板;
        // ★★ 判"会不会动"**改了两次口径**，两版都记在这儿，别再退回第一版：
        //   第一版：把所有 `point` 对象的坐标拼成串，按播放前后比。
        //     ——**错**。绝大多数动图里**动的是"旋转/折叠出来的那个像"**，而那是个
        //     多边形/圆锥，GeoGebra 里它**不是一个个 point 对象**；A、B、C 三个原点
        //     自始至终一动不动。于是量出来"没动"，可屏幕上明明在转——
        //     量错了东西，而错读数跟"产品坏了"长得一模一样。
        //     （同族：[[scanner-numbers-are-not-what-they-claim]]）
        //   第二版（现行）：**拍画板那块像素，按播放前后两张图比**。
        //     老师看到的本来就是像素，"图变了"就是"动了"，不用我去猜哪个对象在动。
        //     ⚠ 量的是 `#ggb` 那一块的**裁剪**，不是整页：整页会把状态栏那行
        //       「可以播放：α」也算成"动了"。
        //     ⚠ 开跑前把这一页 `bringToFront`：后台标签页里 rAF 是被节流的，
        //       两张截图会长得一样，又变成一次"稳的错值"。
        if (板 && 板.能播 && 框) {
          const h0 = await 拍();
          await q('SR.board.togglePlay()');
          await sleep(900);
          const h1 = await 拍();
          await sleep(1000);
          const h2 = await 拍();
          await q('SR.board.stopPlay()');
          一.动了 = (h1 !== h0) || (h2 !== h0);
          一.动指纹 = [h0 && h0.slice(0, 6), h1 && h1.slice(0, 6), h2 && h2.slice(0, 6)];
          // 没动的，把画板那张图存下来——他问"哪些做不出来"时，一张图比我一段话有用。
          if (期望 === '动' && !一.动了) {
            try {
              const b64 = await q('SR.board.toPNG()');
              if (typeof b64 === 'string' && b64.length > 2000) {
                const d = path.join(__dirname, '_shot'); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                fs.writeFileSync(path.join(d, 'fig' + 号 + '.png'), Buffer.from(b64, 'base64'));
              }
            } catch (e) {}
          }
        }
      }
      行.次.push(一);
    }
    记录.push(行);
    // 边跑边打，长跑不至于最后才发现挂在哪
    const a = 行.次[0];
    const 件 = a && a.板 ? Object.keys(a.板.对象).length : 0;
    const 判 = 期望 === '不画' ? (a.围栏 === 0 ? '✅' : '❌硬画了') :
      期望 === '动' ? ((a.围栏 > 0 && 件 > 0 && a.动了) ? '✅' : '❌') : ((a.围栏 > 0 && 件 > 0) ? '✅' : '❌');
    console.log('  ' + 判 + '  ' + String(号).padStart(2) + '. ' + 组.padEnd(16) +
      ' 围栏' + (a.围栏 || 0) + ' 对象' + 件 + (a.板 ? (a.板.能播 ? ' 能播' : '') + (a.动了 ? ' **真动了**' : '') + (a.板.没认 && a.板.没认.length ? ' 没认' + a.板.没认.length : '') : '') +
      (a.错 ? '  ⚠' + a.错.slice(0, 40) : ''));
  }

  // ── 汇总 ──
  const 该静 = 记录.filter(r => r.期望 === '静'), 该动 = 记录.filter(r => r.期望 === '动'), 不画 = 记录.filter(r => r.期望 === '不画');
  const 好 = r => r.次.every(a => a.围栏 > 0 && a.板 && Object.keys(a.板.对象).length > 0) ? 1 : 0;
  const 好动 = r => r.次.every(a => a.围栏 > 0 && a.板 && Object.keys(a.板.对象).length > 0 && a.动了) ? 1 : 0;
  console.log('\n════ 体检结果 ════');
  console.log('  静态图  ' + 该静.reduce((s, r) => s + 好(r), 0) + '/' + 该静.length);
  console.log('  动图    ' + 该动.reduce((s, r) => s + 好动(r), 0) + '/' + 该动.length);
  console.log('  对照组  ' + 不画.reduce((s, r) => s + (r.次.every(a => a.围栏 === 0) ? 1 : 0), 0) + '/' + 不画.length + '（这句该一个围栏都不出）');
  const 坏 = 记录.filter(r => !(r.期望 === '不画' ? r.次.every(a => a.围栏 === 0) :
      r.期望 === '动' ? r.次.every(a => a.围栏 > 0 && a.板 && Object.keys(a.板.对象).length > 0 && a.动了) :
      r.次.every(a => a.围栏 > 0 && a.板 && Object.keys(a.板.对象).length > 0)));
  // ★★ 汇总"画板没认的命令"——这是**修什么**的清单，比"过没过"值钱。
  //   为什么非要有这一节：上面那个 ✅/❌ 只要求"板上建出了一个对象"，
  //   一条命令没认、其余九条认了，照样打 ✅。可老师看到的图上确实缺了那一块。
  //   把没认的原话按出现次数排出来，缺哪些命令名、哪几种写法是画板不认的，一目了然。
  const 没认表 = {};
  记录.forEach(r => r.次.forEach(a => (a.板 && a.板.没认 || []).forEach(c => {
    const k = String(c).replace(/[（(].*$/, '').trim();
    没认表[k] = (没认表[k] || 0) + 1;
  })));
  const 没认排 = Object.entries(没认表).sort((x, y) => y[1] - x[1]);
  const 总条 = 记录.reduce((s, r) => s + r.次.reduce((t, a) => t + (a.命令 ? a.命令.split('\n').filter(l => l.trim() && l.trim()[0] !== '#').length : 0), 0), 0);
  const 总认不出 = 没认排.reduce((s, kv) => s + kv[1], 0);
  console.log('\n  画板没认的命令：共 ' + 总认不出 + ' 条 / 全场非开关命令 ' + 总条 + ' 条');
  没认排.forEach(([k, n]) => console.log('    ' + String(n).padStart(3) + ' × ' + k));

  console.log('\n  没过的 ' + 坏.length + ' 句：');
  坏.forEach(r => {
    const a = r.次[0];
    const 因 = r.期望 === '不画' ? '硬画了' : !a.围栏 ? '模型没写围栏' :
      !a.板 || !Object.keys(a.板.对象).length ? '围栏有、画板上一个对象都没建出来' :
      r.期望 === '动' ? '建出来了但**不会动**' : '其它';
    console.log('    · ' + r.组 + '　[' + 因 + ']　「' + r.句 + '」');
    if (a.命令) console.log('        它写的命令：\n' + a.命令.split('\n').map(s => '          ' + s).join('\n'));
    if (a.板 && a.板.没认 && a.板.没认.length) console.log('        画板没认的：' + JSON.stringify(a.板.没认));
    if (a.可见) console.log('        它说的话：' + JSON.stringify(a.可见.replace(/\n+/g, ' ').slice(0, 120)));
  });

  fs.writeFileSync(path.join(__dirname, '_figall.json'), JSON.stringify({ 尺子自检: 自检, 记录 }, null, 1));
  console.log('\n逐条原文 → test/_figall.json');
  ws.close(); await put('/json/close/' + t.id);
})().catch(e => { console.error('炸了 ' + (e && e.stack || e)); process.exit(2); });
