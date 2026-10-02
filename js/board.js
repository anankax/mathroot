// 画板：GeoGebra 桥。
//
// 模型在回复里写一段 ```ggb 围栏，这里逐条丢给 evalCommand。
// 逐条之间有间隔（SR.GGB_CMD_DELAY），图就跟着话一点点长出来——
// 这是这个作品跟扣子版最不一样的地方：扣子的气泡塞不进画布，
// 这里画板是我们自己的，想怎么控就怎么控。
var SR = (window.SR = window.SR || {});

SR.board = (function () {

  var api = null;            // ggbApplet 本体
  var ready = false;
  var pending = [];          // 待执行的定时器，换新图时清掉
  var queueLeft = 0;         // 还排着队没执行的条数（定时器跑完要减，不然"在画"就一直是真）
  var lastLines = [];        // 上一张图的命令，"重画"用
  var playTarget = null;     // 当前能播放的对象名
  var playing = false;
  var hooks = { ready: null, playState: null, log: null, view: null };

  function log(s) { if (hooks.log) hooks.log(s); }

  // ---- 中文命令名 → GeoGebra 的英文命令名 ----
  //
  // 实测（test/probe_cmds.cjs）：这个 applet 的界面是中文的，但 evalCommand
  // **只认英文命令名**。`交点(f,g)` 返回 false、什么都不建；`Intersect(f,g)`
  // 返回 true 并建出点 A。中英文混着试了 7 种写法，全是这个结论。
  //
  // 提示词里教模型写的是中文（老师看着自然，模型也更愿意照抄），所以在这里翻译一道。
  // 不这么做的话，`线段(A,B)`、`圆(A,2)` 这些会一声不响地什么都不画——
  // 而错误弹窗又被我们关掉了，课上没人会发现。
  var CMD_MAP = {
    '中垂线': 'PerpendicularBisector', '垂直平分线': 'PerpendicularBisector',
    '交点': 'Intersect', '直线': 'Line', '线段': 'Segment', '射线': 'Ray',
    '向量': 'Vector', '半圆': 'Semicircle', '多边形': 'Polygon', '圆弧': 'CircularArc',
    '扇形': 'CircularSector', '垂线': 'PerpendicularLine', '中点': 'Midpoint',
    '平行线': 'Line', '切线': 'Tangent', '角度': 'Angle', '角': 'Angle',
    '距离': 'Distance', '长度': 'Distance', '面积': 'Area', '周长': 'Perimeter',
    '文本': 'Text', '轨迹': 'Locus', '描点': 'Locus', '滑动条': 'Slider',
    '滑块': 'Slider', '零点': 'Root', '顶点': 'Vertex', '极值点': 'Extremum',
    '重心': 'Centroid', '垂心': 'Orthocenter', '内心': 'Incenter', '外心': 'Circumcenter',
    '旋转': 'Rotate', '平移': 'Translate', '反射': 'Reflect', '位似': 'Dilate',
    '圆': 'Circle', '序列': 'Sequence', '元素': 'Element', '函数': 'Function',
    '不等式': 'Inequality', '导数': 'Derivative', '积分': 'Integral',

    // ---- 3D ----
    // 实测：中文命令名在 3D 下同样被拒（`球((0,0,0),2)`、`立方体(A,B)`、`棱柱(...)`、`平面(...)`
    // 四条全返回 false、什么都不建），跟 2D 一个脾气。所以这一层照翻。
    '正方体': 'Cube', '立方体': 'Cube', '正六面体': 'Cube',
    '棱柱': 'Prism', '棱锥': 'Pyramid', '角锥': 'Pyramid',
    '四面体': 'Tetrahedron', '正四面体': 'Tetrahedron',
    '八面体': 'Octahedron', '正八面体': 'Octahedron',
    '十二面体': 'Dodecahedron', '二十面体': 'Icosahedron',
    '球': 'Sphere', '球面': 'Sphere', '圆锥': 'Cone', '圆柱': 'Cylinder',
    '平面': 'Plane', '棱': 'Segment', '侧面': 'Polygon'
  };
  // 长的先替——不然「中垂线」会被「垂线」吃掉半截，变成「中PerpendicularLine」
  var CMD_KEYS = Object.keys(CMD_MAP).sort(function (a, b) { return b.length - a.length; });

  var AXIS_MAP = { 'x轴': 'xAxis', 'y轴': 'yAxis', 'z轴': 'zAxis', 'X轴': 'xAxis', 'Y轴': 'yAxis' };

  // 只在"没被引号包住"的地方动手，免得把 文本("x轴上的点") 里的字给替了
  function translate(line) {
    var parts = String(line).split(/("(?:[^"\\]|\\.)*")/);
    for (var i = 0; i < parts.length; i += 2) parts[i] = translateBare(parts[i]);
    return parts.join('');
  }

  function translateBare(s) {
    var k;
    for (k in AXIS_MAP) {
      if (AXIS_MAP.hasOwnProperty(k)) s = s.split(k).join(AXIS_MAP[k]);
    }
    for (var i = 0; i < CMD_KEYS.length; i++) {
      var cn = CMD_KEYS[i];
      if (s.indexOf(cn) < 0) continue;
      // 只有当它是个"命令"时才算——紧跟 ( 或 [，前面不是汉字（不然会切掉「中垂线」的尾巴）
      s = s.replace(new RegExp('(^|[^\\u4e00-\\u9fa5A-Za-z0-9_])' + cn + '\\s*(?=[\\(\\[])', 'g'),
        function (m, pre) { return pre + CMD_MAP[cn]; });
    }
    return s;
  }

  // ---- 关键字 → 真实命令 ----
  // 提示词里教模型用的就是这几个词，别改词面，改了模型就不认了。
  function expand(cmd) {
    var c = cmd.trim();
    if (!c || c.charAt(0) === '/' ) return [];
    if (c === '#清空') return ['__NEW__'];
    // 数轴／坐标系走真 API，不走 evalCommand。
    // 原来写成 SetVisibleInView[...] 那套，GeoGebra 直接弹一个
    // 「未知的指令」的模态框糊在画板正中间——公开课上弹这个就完了。
    // 而且查过：这个 applet 里根本没有 setVisibleInView 这个方法。
    if (c === '数轴' || c === '#数轴') return ['__NUMLINE__'];
    if (c === '坐标系' || c === '#坐标系') return ['__PLANE__'];
    // 平面 / 三维：同一块画板切视角。三维那边走 setPerspective('T')，见 show3D。
    if (c === '#三维' || c === '三维' || c === '#3D') return ['__3D__'];
    if (c === '#平面' || c === '平面' || c === '#二维' || c === '二维' || c === '#2D') return ['__2D__'];
    var m;
    if ((m = c.match(/^#隐藏\s+(.+)$/))) return ['__HIDE__' + translate(m[1].trim())];
    if ((m = c.match(/^#显示\s+(.+)$/))) return ['__SHOW__' + translate(m[1].trim())];
    if ((m = c.match(/^#播放\s+(.+)$/))) return ['__PLAY__' + m[1].trim()];
    if (c === '#暂停' || c === '#停止') return ['__STOP__'];
    return [translate(c)];
  }

  // ---- 单条执行 ----
  function exec(one) {
    if (!api) return;
    try {
      if (one === '__NEW__') { api.newConstruction(); stopPlay(); return; }
      if (one === '__NUMLINE__') { showNumLine(); return; }
      if (one === '__PLANE__') { showPlane(); return; }
      if (one === '__3D__') { show3D(); return; }
      if (one === '__2D__') { showPlane(); return; }
      if (one.indexOf('__HIDE__') === 0) { api.setVisible(one.slice(8), false); return; }
      if (one.indexOf('__SHOW__') === 0) { api.setVisible(one.slice(8), true); return; }
      if (one.indexOf('__PLAY__') === 0) { markPlayable(one.slice(8)); return; }
      if (one === '__STOP__') { stopPlay(); return; }
      api.evalCommand(one);
    } catch (e) {
      log('这条画不出来：' + one + ' —— ' + (e.message || e));
    }
  }

  // ---- 按行、按间隔执行 ----
  // ---- 点画小一点 ----
  //
  // ★ 2026-10-02 孔老师看着画板问「geogebra 的点怎么这么大」。
  //   根子在 GeoGebra 自己的默认值：**新建的点大小是 5**（它属性面板里那一档），
  //   在一块宽不到 560px 的画板上就是一个大圆点，投到投影仪上更笨。
  //   而且**没有"改全局默认"这条 API**——启动参数（appName / perspective 那一族）里
  //   没有点大小这一项，`setPointSize` 只认单个对象。所以只能建完再回头逐个改。
  //
  // ★ 为什么跟着每条命令走、而不是等整段画完再扫一遍：
  //   `exec` 一条之后到一下条之间隔着 SR.GGB_CMD_DELAY，老师看到的是**图一点点长出来**。
  //   等画完才统一改，他会先看见一排大圆点、再看着它们集体缩一圈。
  //   跟着走的话，每个点生出来就是小的。
  //
  // ★ 只动 point：别的对象一概不碰。颜色、线宽、标签这些留给模型和老师，
  //   这里改点大小是"画板的默认值不好看"，不是"我要统一管画板的样式"。
  var POINT_SIZE = 3;
  function slimPoints() {
    if (!api) return;
    var names = [];
    try { names = api.getAllObjectNames() || []; } catch (e) { return; }
    for (var i = 0; i < names.length; i++) {
      try {
        if (api.getObjectType(names[i]) !== 'point') continue;
        // 已经是这个大小的不再重复设。每条命令扫一遍，不设这道闸就是每 550ms 白喊一次
        if (api.getPointSize(names[i]) === POINT_SIZE) continue;
        api.setPointSize(names[i], POINT_SIZE);
      } catch (e) {}
    }
  }

  function run(rawLines) {
    clearTimers();
    var lines = [];
    for (var i = 0; i < rawLines.length; i++) {
      var exp = expand(rawLines[i]);
      for (var j = 0; j < exp.length; j++) lines.push(exp[j]);
    }
    if (!lines.length) return;
    lastLines = rawLines.slice();          // 存原命令，"重画"重放这一份
    if (!ready) { pendingLines = lines; return; }   // 画板还没就绪，等就绪了再放
    queueLeft = lines.length;
    for (var k = 0; k < lines.length; k++) {
      (function (one, idx) {
        pending.push(setTimeout(function () {
          exec(one);
          slimPoints();                // 新点子生出来就是小的，别等画完再集体缩一圈
          queueLeft--;                 // ★ 跑一条减一条，"在画"才收得住
        }, idx * SR.GGB_CMD_DELAY));
      })(lines[k], k);
    }
  }

  var pendingLines = null;

  // 画板上还有没有活。★ 只留**这一处**定义，导出给外面的 `isBusy` 和 draw() 内部
  //   判"画完了没有"用的是同一个函数。
  //   ⚠ 2026-10-02 栽过一跤：draw() 里直接写了 `isBusy()`——这个名字在模块作用域里
  //     **根本不存在**（它只是返回对象上的一个属性），于是每一张图都在
  //     第一轮轮询就抛 ReferenceError。同一件事抄两遍迟早会分叉，索性只留一处。
  function busyNow() { return queueLeft > 0 || !!pendingLines; }

  function flushPending() {
    if (pendingLines) { var p = pendingLines; pendingLines = null; run(p); }
  }

  function clearTimers() {
    for (var i = 0; i < pending.length; i++) clearTimeout(pending[i]);
    pending = [];
    queueLeft = 0;
  }

  function clear() { clearTimers(); if (api) { api.newConstruction(); } stopPlay(); }
  function redraw() { if (lastLines.length) run(lastLines); }

  // ---- 动点播放 ----
  function markPlayable(name) {
    playTarget = name; playing = false;
    if (hooks.playState) hooks.playState({ target: name, playing: false });
    log('可以播放：' + name);
  }
  function togglePlay() {
    if (!api || !playTarget) return;
    var want = !playing;
    try {
      api.setAnimating(playTarget, want);
      if (want) { api.startAnimation && api.startAnimation(); }
      playing = want;
      if (hooks.playState) hooks.playState({ target: playTarget, playing: playing });
    } catch (e) { log('播放失败：' + (e.message || e)); }
  }
  function stopPlay() {
    try { if (api && playTarget) api.setAnimating(playTarget, false); } catch (e) {}
    playing = false;
    if (hooks.playState) hooks.playState({ target: playTarget, playing: false });
  }

  // ---- 导出图片（答辩材料用）----
  function toPNG() {
    try { return api ? api.getPNGBase64(2, false, 96) : ''; } catch (e) { return ''; }
  }

  // ★ 存图时必须把署名**烧进图里**（2026-10-01）。
  //   画板右下角那个 `KAX · 数根 mathroot` 是个 DOM 层，`getPNGBase64` 拿不到它——
  //   照着它直接存出去，就是一张干干净净、看不出出处的图。而图片恰恰是最容易被
  //   拿去用的形态（贴进课件、发群里、塞进别处的材料），孔老师这次第一条要求就是"不让人盗用"。
  //   所以导出这一路自己再画一遍，压在右下角。
  //
  //   异步是因为要等位图 load 完才能往 canvas 上叠。回调传 dataURL，任一步失败给空串。
  //
  // ---- 署名那一下，只有一份 ----
  // ★★ 2026-10-02 从下面 exportPNG 里抽出来的。抽的理由很实在：现在有**两种图**
  //   要烧署名——「存图」（整块画板，走 exportPNG）和「打包带走」里那些图
  //   （裁过边，走 shootMarked，见下面）。各写一份的话，"字号多大多粗、
  //   要不要垫一层白边"这件事就有了两个真源；哪天只调了一处，
  //   两种图上的字就长得不一样——而它们**摆在同一个压缩包里，一眼看得出**。
  //   字照画板上那一处（index.html 的 `.wm`）取，不再抄一份常量：改名只改那一处。
  function mark(g, w, h) {
    var wm = document.querySelector('.wm');
    var txt = (wm && wm.textContent.trim()) || 'KAX · 数根 mathroot';
    var fs = Math.max(13, Math.round(w / 42));
    var pad = Math.round(fs * 0.8);
    g.font = fs + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    // 先垫一层浅色描边：白底上深绿看得清，深色底上这层也兜着
    g.fillStyle = 'rgba(255,255,255,.8)';
    g.fillText(txt, w - pad + 1, h - pad + 1);
    g.fillStyle = 'rgba(39,122,86,.9)';
    g.fillText(txt, w - pad, h - pad);
  }

  function exportPNG(cb) {
    var raw = toPNG();
    if (!raw) { cb(''); return; }
    // ★ `getPNGBase64` 给的是**光秃秃的 base64**（开头就是 `iVBORw0KGgo`），
    //   不是 data URL。直接塞给 `img.src` 会走 onerror——实测就是这样，
    //   日志里只有一句"画板位图加载失败"。所以前缀得自己补。
    var src = /^data:/.test(raw) ? raw : 'data:image/png;base64,' + raw;
    var im = new Image();
    im.onerror = function () {
      // 别静默失败：存图这条路一旦断了，界面上只会看到"点了没反应"，
      // 分不出是"还没画东西"还是"浏览器不让存"。留一行日志给控制台。
      if (window.console) window.console.warn('exportPNG：画板位图加载失败');
      cb('');
    };
    im.onload = function () {
      try {
        var c = document.createElement('canvas');
        c.width = im.width; c.height = im.height;
        var g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        mark(g, im.width, im.height);
        cb(c.toDataURL('image/png'));
      } catch (e) {
        if (window.console) window.console.warn('exportPNG 失败：', e);
        cb('');
      }
    };
    im.src = src;
  }

  // ---- 按一组命令画好，**画完了再回话** ----
  //
  // ★ 为什么不直接用 run()：run() 是**排队即返回**的——每条命令隔 550ms 才放出去，
  //   调用方拿到返回值的那一刻，画板上还什么都没有。这时候去 toPNG，
  //   导出的是**上一张图**（或者一张空白）。出材料要"画完这张再画下一张"，
  //   所以非有一个"我画完了"的回话不可。
  // ★ 上限给足（一张复杂的图十几条命令也就十来秒），但也必须有上限：
  //   画板要是卡住，不能让整份材料跟着一起卡死——超时就当这张画不出来，
  //   由调用方决定怎么办（出材料那边的做法是：这张图撤掉，并告诉老师）。
  var DRAW_MAX = 30000;
  function draw(lines, cb) {
    var t0 = Date.now(), done = false, hard = null;
    function fin(ok) { if (done) return; done = true; clearTimeout(hard); cb(ok); }
    hard = setTimeout(function () { fin(false); }, DRAW_MAX);
    run(lines);
    (function wait() {
      if (done) return;
      // ★ 判"画完了"要问两件事：就绪了没有、队列里还有没有东西。
      //   只看 isBusy() 的话，画板还没就绪时队列是空的，会被判成"早就画完了"。
      if (ready && !busyNow()) {
        // 再留一帧：exec 里最后一条是 evalCommand，GeoGebra 画到画布上要一点时间。
        setTimeout(function () { fin(true); }, 160);
        return;
      }
      if (Date.now() - t0 > DRAW_MAX) { fin(false); return; }
      setTimeout(wait, 150);
    })();
  }

  // ============================================================
  //  卷面样式：把图画成"印在卷子上的样子"
  // ============================================================
  //
  // ★★ 为什么要这么绕（2026-10-02，孔老师看着那张图说
  //   「你这个画的效果哪里和正常的试卷上的做图效果一样。哪能直接放出的卷子上面去」）：
  //
  //   直接截画板的屏，得到的是**GeoGebra 屏幕的样子**，不是卷子上印的样子。
  //   拿她真卷子里的图（B9 那份 image20.png，一条数轴）逐条比，差的正好是三样：
  //     ① 点是大蓝圆点（卷子上是实心小黑点）
  //     ② 点的名字写成 `A = (-2, 0)`（卷子上只写一个斜体 `A`）
  //     ③ 字是无衬线小号（卷子上是 **Times 斜体**，而且比它大一圈）
  //
  //   ①② 有 API 能治。③ 治不了：GeoGebra 画字用它自己的字体，换不掉也关不掉——
  //     `evalCommand('SetColor(A,0,0,0)')` 那一族**脚本命令从 JS 发出去全部返回 false**
  //     （15 条实测，一个都不认），`setFont` 调了图上一个像素都不变。
  //
  //   所以这条路的做法是：**线让 GeoGebra 画，字由我写。**
  //     导出前  → 把 GeoGebra 的字全关掉、颜色全改黑、点改小
  //     导出后  → 照 `getViewProperties` 给的坐标变换，自己把字描上去
  //
  // ★ 字多大**不能写死像素**：宽的图会被缩进 9.4cm 的版心、窄的按原样印，
  //   同一串像素在两种图上印出来能差一倍。所以按"印出来多大"倒推位图里该画多大。
  var PAPER_FONT = '"Times New Roman", "SimSun", "宋体", serif';
  var PAPER_TEXT_CM = 0.30;        // 图上的字印出来多高（约 8.5pt，跟卷子正文一个量级）
  var EMU_PER_PX = 9525;           // 1 位图像素 = 1/96 英寸

  // 这张图会被缩小多少倍（跟 js/produce.js 里 fitEmu 用的是同一组上限）
  function figScale(w, h) {
    var mw = (SR.produce && SR.produce.FIG_MAX_W) || 3400000;
    var mh = (SR.produce && SR.produce.FIG_MAX_H) || 2400000;
    return Math.min(1, mw / (w * EMU_PER_PX), mh / (h * EMU_PER_PX));
  }
  function paperFontPx(w, h) {
    var cmPerPx = figScale(w, h) * EMU_PER_PX / 360000;
    return Math.max(10, Math.round(PAPER_TEXT_CM / cmPerPx));
  }

  // ★ `getViewProperties` 回的是**一串 JSON 文本**，不是对象（实测 2026-10-02）。
  //   照着 `v.xMin` 读会全是 undefined，坐标一路算成 NaN——字写到了画布外一个不存在的地方，
  //   图上干干净净一个字都没有。而且 NaN 会让下面的 niceStep 挑出 10000，把刻度线也钉没了
  //   （图上只剩原点那一个刻度）。两处毛病同一个根。
  //   所以这里先认一遍：是字符串就 parse，是对象就直接用（换个 GeoGebra 版本也吃得下）。
  function viewProps() {
    var v = api.getViewProperties(1);
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = {}; } }
    return v || {};
  }

  // 世界坐标 → 位图像素坐标。`getViewProperties` 给的是**左下角**的世界坐标
  // （只有 xMin/yMin，没有 xMax/yMax，得自己加）、CSS 像素的宽高；
  // 位图是它的 scale 倍（toPNG 里写死 2）。
  function viewMap(imgW) {
    var v = viewProps();
    var k = imgW / v.width;
    var xMin = v.xMin, yMax = v.yMin + v.height * v.invYscale;
    return {
      k: k, xMin: xMin, xMax: xMin + v.width * v.invXscale, yMax: yMax,
      cssPerUnitX: v.invXscale, cssPerUnitY: v.invYscale,
      sx: function (x) { return (x - xMin) / v.invXscale * k; },
      sy: function (y) { return (yMax - y) / v.invYscale * k; }
    };
  }

  // 刻度间隔：跟 GeoGebra 用它自己那套挑出来的多半一样（都是"两格之间留够看得清的距离"），
  // 但**我不赌**——下面 setAxisSteps 会把它钉死成这个值，于是刻度线和我的数字天然对齐。
  function niceStep(pxPerUnit) {
    var c = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    for (var i = 0; i < c.length; i++) if (pxPerUnit * c[i] >= 50) return c[i];
    return 10000;
  }

  // 导出前把画板改成"卷面"、导出后**原样还回去**。
  // ★ 一定要还：这套改动是**全局**的（颜色、点大小、刻度数字），
  //   不还的话老师面前那块画板会一直是"没有数字的黑白图"，下一节课就懵了。
  //   所以进来先把每一样的现值抄一份，出去照着抄的还原。
  function paperSnapshot() {
    var names = api.getAllObjectNames();
    return {
      ok: true,
      opts: api.getGraphicsOptions(1),
      objs: names.map(function (n) {
        return {
          n: n,
          color: api.getColor(n),
          lt: api.getLineThickness(n),
          pt: api.getPointSize(n),
          lv: api.getLabelVisible(n),
          ls: api.getLabelStyle(n),
          cap: api.getCaption(n),
          // 文本框要整个藏起来（它的字也是 GeoGebra 的字，字体不对），
          // 所以得把"显示/隐藏"也抄一份，还的时候才还得回去
          vis: api.getVisible(n)
        };
      })
    };
  }

  function paperOn(snap) {
    var o = api.getGraphicsOptions(1);
    // 刻度数字交给我写（我写的是 Times 斜体），刻度线留着——GeoGebra 的刻度线不跟着数字走
    if (o.axes && o.axes.x) o.axes.x.showNumbers = false;
    if (o.axes && o.axes.y) o.axes.y.showNumbers = false;
    o.axesColor = '#000000';
    // 刻度间隔钉死，好让我的数字落在它的刻度线上
    var m = viewMap(1);
    var stepX = niceStep(m.cssPerUnitX), stepY = niceStep(m.cssPerUnitY);
    try { api.setAxisSteps(1, stepX, stepY); } catch (e) {}
    try { api.setGraphicsOptions(1, o); } catch (e) {}
    snap.objs.forEach(function (s) {
      try {
        var ty = api.getObjectType(s.n);
        if (ty === 'image' || ty === 'button') return;
        if (ty === 'text') { api.setVisible(s.n, false); return; }   // 文本框也归我自己写
        api.setColor(s.n, 0, 0, 0);
        api.setLineThickness(s.n, 1);
        if (ty === 'point') {
          api.setPointSize(s.n, 3);
          api.setFilling(s.n, 1);
        }
        // 多边形在屏幕上那块半透明灰底，印到卷子上是脏的；卷子上的图是**空心的**
        if (ty === 'polygon') api.setFilling(s.n, 0);
        api.setLabelVisible(s.n, false);            // 字由我写
      } catch (e) {}
    });
    snap.step = { x: stepX, y: stepY };
  }

  function paperOff(snap) {
    snap.objs.forEach(function (s) {
      try {
        if (s.color && s.color.length >= 3) api.setColor(s.n, s.color[0], s.color[1], s.color[2]);
        api.setLineThickness(s.n, s.lt);
        api.setPointSize(s.n, s.pt);
        api.setLabelStyle(s.n, s.ls);
        api.setCaption(s.n, s.cap);
        api.setLabelVisible(s.n, s.lv);
        api.setVisible(s.n, s.vis);
      } catch (e) {}
    });
    try { api.setGraphicsOptions(1, snap.opts); } catch (e) {}
  }

  // ---- 往位上写字 ----
  // 点的名字：写在点的右上方（卷子上就这么写）。
  // 轴的刻度数字：x 轴的写在轴底下居中，y 轴的写在轴左边右对齐。
  function paperDrawText(g, m, box, fontPx, snap) {
    var names = api.getAllObjectNames();
    g.fillStyle = '#000';
    g.font = fontPx + 'px ' + PAPER_FONT;
    g.textBaseline = 'middle';
    // ---- 刻度数字 ----
    var ax = api.getGraphicsOptions(1).axes || {};
    var cx = m.sx(0), cy = m.sy(0);
    var xOn = !!(ax.x && ax.x.visible), yOn = !!(ax.y && ax.y.visible);
    g.textAlign = 'center';
    if (xOn) {
      var st = snap.step.x;
      for (var v = Math.ceil(m.xMin / st) * st; v <= m.xMax + 1e-9; v += st) {
        if (Math.abs(v) < st / 2) { }                 // 0 照写，卷子上也是写的
        var px = m.sx(v) - box.x0;
        if (px < fontPx * 0.7 || px > box.w - fontPx * 0.7) continue;   // 贴边的写不下
        g.fillText(fmtNum(v), px, cy - box.y0 + fontPx * 1.15);
      }
    }
    if (yOn) {
      var sy = snap.step.y;
      g.textAlign = 'right';
      for (var u = Math.ceil(-m.yMax / sy) * sy; u <= m.yMax + 1e-9; u += sy) {
        if (Math.abs(u) < sy / 2) continue;           // 原点只写一次，写在下头了
        var py = m.sy(u) - box.y0;
        if (py < fontPx * 0.7 || py > box.h - fontPx * 0.7) continue;
        g.fillText(fmtNum(u), cx - box.x0 - fontPx * 0.35, py);
      }
    }
    // ---- 点的名字 ----
    g.textAlign = 'left';
    names.forEach(function (n) {
      var ty = api.getObjectType(n);
      if (ty !== 'point') return;
      if (!api.getVisible(n)) return;
      var px = m.sx(api.getXcoord(n)) - box.x0;
      var py = m.sy(api.getYcoord(n)) - box.y0;
      if (px < -30 || py < -30 || px > box.w + 30 || py > box.h + 30) return;
      g.fillText(n, px + fontPx * 0.38, py - fontPx * 0.62);
    });
    // ---- 文本框（模型写的 `文本("l",(1,2.6))` 这类）----
    //   它的字也是 GeoGebra 的字，为了让字体跟卷子一致，同样是**我重写一遍**。
    names.forEach(function (n) {
      if (api.getObjectType(n) !== 'text') return;
      if (!api.getVisible(n)) return;         // 老师本来就藏着的不写
      var s = '';
      try { s = String(api.getValueString(n)); } catch (e) { s = ''; }
      if (!s) return;
      var px = m.sx(api.getXcoord(n)) - box.x0;
      var py = m.sy(api.getYcoord(n)) - box.y0;
      if (px < -60 || py < -30 || px > box.w + 60 || py > box.h + 30) return;
      g.textAlign = 'left';
      g.fillText(s, px, py);
    });
  }

  // 3 → "3"，3.0 → "3"，0.5 → "0.5"（别把整数写成 3.0，卷子上不这么印）
  function fmtNum(v) {
    var r = Math.round(v * 1e6) / 1e6;
    return String(r);
  }

  // ---- 出一张**能直接印到卷子上的**图 ----
  //
  // ★ 跟 exportPNG（工具条"存图"那条路）分开，因为两边的要求是**反的**：
  //   "存图"是给人拿去用的，署名必须烧进去（防"截图当自己的作品"）；
  //   而插进卷子里的图是**老师自己那份材料的一部分**，会印到每个学生手上——
  //   右下角挂一行 KAX，是给全班看的广告，不能这么干。
  // ★ 顺手裁边：画板是个方方正正的格子，图往往只占中间一条。
  //   不裁的话，卷子上会出现"图很小、周围一大片空"的怪样子。
  //   裁的判据是"这一圈像不像空白"，**只裁白边，不动内容**。
  function shoot(cb) {
    if (!api) { cb(''); return; }
    var snap = null;
    try { snap = paperSnapshot(); paperOn(snap); } catch (e) { snap = null; }
    var raw = toPNG();
    // ★ 出图之后**立刻**还原，别等到位图解码完——解码是异步的，
    //   中间老师能看见画板上的颜色／刻度数字被改过又变回来，那几帧很难看。
    if (snap) { try { paperOff(snap); } catch (e) {} }
    if (!raw) { cb(''); return; }
    var src = /^data:/.test(raw) ? raw : 'data:image/png;base64,' + raw;
    var im = new Image();
    im.onerror = function () { cb(''); };
    im.onload = function () {
      try {
        var c = document.createElement('canvas');
        c.width = im.width; c.height = im.height;
        var g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        var d = g.getImageData(0, 0, im.width, im.height).data;
        var x0 = im.width, y0 = im.height, x1 = -1, y1 = -1;
        for (var y = 0; y < im.height; y++) {
          for (var x = 0; x < im.width; x++) {
            var i = (y * im.width + x) * 4;
            // 阈值别抠太紧：抗锯齿的浅灰也要算成内容，
            // 不然数轴那根细线的两端会被裁掉一小截。
            if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) { cb(''); return; }          // 整张全白＝什么都没画出来

        // ★ 字要**先定大小、再加留白、最后才裁**：
        //   字号按**内容的实际大小**算（不是画板大小——画板那么大一块，图只占中间一条，
        //   照画板算出来的字会小一半）；留白按字号给，字才有地方站；
        //   顺序反了的话，写出去的字会顶到画布边上被切掉半个。
        var fontPx = snap ? paperFontPx(x1 - x0 + 1, y1 - y0 + 1) : 0;
        var pad = snap ? Math.max(10, Math.round(fontPx * 0.8)) : 10;
        x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
        x1 = Math.min(im.width - 1, x1 + pad); y1 = Math.min(im.height - 1, y1 + pad);
        var w = x1 - x0 + 1, h = y1 - y0 + 1;
        var o = document.createElement('canvas');
        o.width = w; o.height = h;
        var g2 = o.getContext('2d');
        g2.drawImage(c, x0, y0, w, h, 0, 0, w, h);
        if (snap) {
          try { paperDrawText(g2, viewMap(im.width), { x0: x0, y0: y0, w: w, h: h }, fontPx, snap); }
          catch (e) { if (window.console) window.console.warn('图上写字失败：', e); }
        }
        cb(o.toDataURL('image/png'), w, h);
      } catch (e) {
        if (window.console) window.console.warn('shoot 失败：', e);
        cb('');
      }
    };
    im.src = src;
  }

  // ---- 裁过边 **并且烧了署名** 的一张（打包带走用）----
  //
  // ★ 为什么要在 shoot 和 exportPNG 中间再开一条，而不是二选一：
  //   那两条的取舍**正好是反的**——
  //     · exportPNG（工具条「存图」）：整块画板、有署名。老师要的是"画板现在这样子"。
  //     · shoot（出材料配图）：裁过边、**不许有署名**。那张会印到每个学生手上，
  //       右下角挂一行 KAX 是给全班看的广告。
  //   而打包里那些图**两个要求同时成立**：要贴进教案（所以裁边，周围一大片空很难看），
  //   又会被传出去（所以署名，跟"存图"一个道理）。缺哪一条都是错的，
  //   所以只能合成一条——**署名那一下走上面那个共用的 mark()**。
  //
  // ⚠ 它连着调 shoot，所以**会动画板**（shoot 里 paperOn/paperOff 那一段）。
  //   调用方（js/pack.js）必须按顺序一张张画、画完把最后一张留在板上，
  //   理由写在那边。
  function shootMarked(cb) {
    shoot(function (url, w, h) {
      if (!url) { cb('', 0, 0); return; }
      var im = new Image();
      im.onerror = function () { cb('', 0, 0); };
      im.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = im.width; c.height = im.height;
          var g = c.getContext('2d');
          g.drawImage(im, 0, 0);
          mark(g, im.width, im.height);
          cb(c.toDataURL('image/png'), im.width, im.height);
        } catch (e) {
          if (window.console) window.console.warn('shootMarked 失败：', e);
          cb('', 0, 0);
        }
      };
      im.src = url;
    });
  }

  // ---- 装机 ----
  var hostId = null;

  // 画板跟着容器走，别写死尺寸——投影仪、笔记本、半屏，窗口大小都不一样
  //
  // ★ 量的是**外面那个盒子**（.boardwrap），不是 `#ggb` 自己（2026-10-01 手机实测）。
  //   GeoGebra 的 `inject()` 会把尺寸**写回容器本身**——`#ggb` 上一直挂着行内样式
  //   `width: 347px; height: 232px;`。于是"照容器的高度算 → 再写回容器"成了自问自答：
  //   量到的永远是上一轮写进去的数，容器再被顶大一点，下一轮量到更大……收敛不了。
  //   手机上的表现是 applet 232px 塞进 224px 的格子，`#ggb` 又是 overflow:hidden，底下切掉一条。
  //
  // ★ 两个下限是"容器小到离谱时别算出 0 或负数"，**不是**"保证至少多大"。
  //   原来写 320/240，比手机能给的高度还高，直接被顶穿。宁可让它小，也别让它溢出。
  //
  // ★★ 2026-10-02 修：**上面那句话当时是写着好看的，代码里没做到**——
  //   高度那一行写的是 `Math.max(160, …)`：容器只给得出 72px 时它照样返回 160，
  //   而 160 会被 `setSize` 写回 `#ggb` 的行内样式，`#ggb` 于是比 `.boardwrap` 还高，
  //   最外面 `.col` 是 overflow:hidden ——**把画板底下大半块切掉了**。
  //   390px 实测：`.boardwrap` 90px 里塞进 160px 的画布，切掉 70px；
  //   360px 更狠：60px 里塞 160px，切掉 100px。桌面没事（543 的格子给 160 一点不难）。
  //   ⚠ 所以这里**不能有"至少 160"这种下限**：一个下限只要大于容器，
  //     就一定会把东西顶穿；下限的作用只是别算出 0 或负数。
  //     真要"手机上别太小"，那是**布局的事**（给画板那一行多分点高度，见 css 里
  //     手机那条 grid-template-rows），不能在测量函数里偷偷放大。
  //   ⚠ 别把 floor 改回 160 去"照顾手机"——那正是这一版的病。
  var MIN_W = 240, MIN_H = 60;
  function fit() {
    var c = hostId && document.getElementById(hostId);
    if (!c) return [SR.GGB_WIDTH, SR.GGB_HEIGHT];
    var box = c.parentElement || c;
    var cs = window.getComputedStyle(c);
    var px = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    var py = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var w = Math.max(MIN_W, Math.floor(box.clientWidth - px - 2));
    var h = Math.max(MIN_H, Math.floor(box.clientHeight - py - 2));
    return [w, h];
  }

  // 让横竖比例一致（正方形格子），不然数轴会被压扁
  function setDefaultView() {
    if (!api) return;
    var d = fit(), xr = 7;
    var yr = xr * (d[1] / d[0]);
    try { api.setCoordSystem(-xr, xr, -yr, yr); } catch (e) {}
  }

  // ---- 平面 / 三维 两个视角 ----
  // ★ 就一块画板，切视角，不做并排。右边这栏才 560px 宽，
  //   `"GT"` 并排每块只剩 280px，投影仪上没法看。
  //
  // ★ classic 引擎**本身就带 3D**（官方 3D 视图文档：3D 视图随时能从视图菜单加出来，
  //   即引擎已加载、默认只是没显示），不用换 appName。而我们 loadApplet 的第二个参数
  //   本来就写死了 true（官方注释：true to force web3d），跑的就是带 3D 的那份代码库。
  //   实测：setPerspective('T') 切过去 Cube/Sphere/Cone/Cylinder/Plane/Rotate/Prism/Pyramid
  //   全部建得出东西，切回 'G' 之后 2D 一切照常，来回切四次也不坏。
  var is3D = false;

  // 切回 2D。只在真的要切的时候喊——每张图都喊一次会让视角反复重置。
  function to2D() {
    if (!api || !is3D) return;
    try { api.setPerspective('G'); } catch (e) {}
    is3D = false;
    if (hooks.view) hooks.view(false);
  }

  // 数轴：只留横轴，不要网格，横轴落在画面正中
  function showNumLine() {
    if (!api) return;
    to2D();
    try { api.setAxesVisible(true, false); } catch (e) {}
    try { api.setGridVisible(false); } catch (e) {}
    setDefaultView();
  }

  // 坐标平面：两条轴 + 网格
  function showPlane() {
    if (!api) return;
    to2D();
    try { api.setAxesVisible(true, true); } catch (e) {}
    try { api.setGridVisible(true); } catch (e) {}
    setDefaultView();
  }

  // 三维：空坐标架，三条轴都开
  function show3D() {
    if (!api) return;
    try { api.setPerspective('T'); } catch (e) {}
    is3D = true;
    if (hooks.view) hooks.view(true);
    // ★ 三维视图的编号是 3，不是 1 —— setAxesVisible(3, x, y, z) 三个方向各一个开关。
    //   实测 setAxesVisible(3,true,true,true) 与 setCoordSystem(-4,4,-4,4,-4,4,true) 都生效。
    try { api.setAxesVisible(3, true, true, true); } catch (e) {}
    // 3D 的 setCoordSystem 比 2D 版多两个 z 参数
    var g = SR.GGB_3D_RANGE || [-4, 4, -4, 4, -4, 4];
    try { api.setCoordSystem(g[0], g[1], g[2], g[3], g[4], g[5], true); } catch (e) {}
  }

  // 加载提示写在哪：boardbar 上的一个**真节点**（`#ggbstate`）。
  //
  // ★ 为什么不用 `#ggb::after` 那种省事的写法（2026-10-01 实测）：
  //   写是写上了——getComputedStyle 说 content 有、display:flex、position:absolute、
  //   父节点 relative、盒子在 (834,258) 591×546，样样齐全，**截图上一个字看不见**。
  //   原因是 GeoGebra 往 #ggb 里塞了自己的 .applet_scaler（带 transform 的），
  //   伪元素被压在它底下。教训：**别在别人 inject 的容器里跟它抢层叠**，
  //   提示挪到自己这一行上（boardbar），一行 textContent 就够了。
  function note(txt) {
    var el = document.getElementById('ggbstate');
    if (!el) return;
    if (txt) { el.textContent = txt; el.style.display = ''; }
    else { el.style.display = 'none'; }
  }

  function init(containerId, h) {
    if (h) for (var k in h) if (h.hasOwnProperty(k)) hooks[k] = h[k];
    hostId = containerId;
    // 画板那一包要从 geogebra.org 拉，冷缓存实测约 3 秒（最快 3 秒，最慢量到过 15 秒）。
    // 这期间给一句话，别让老师盯着一块纯白方块猜是不是坏了。
    // ⚠ 话要短：左边那个「画板」标题已经说清是什么了，这儿再说一遍"画板正在加载"
    //   就是「画板　画板正在加载…」——截图核过，两个字重复得扎眼。
    note('正在加载…');
    if (typeof GGBApplet === 'undefined') {
      // ★ 这一档跟"正在加载"要分开说：一个等一会儿会好，一个等到天亮也不会好。
      note('没加载出来，刷新试试');
      log('GeoGebra 脚本没加载出来（检查网络，或换用 https 打开）');
      return;
    }
    var d = fit();
    var app = new GGBApplet({
      appName: SR.GGB_APP || 'classic',
      width: d[0],
      height: d[1],
      language: 'zh_CN',
      perspective: 'G',            // 只要图形区——底下那块代数面板白占地方，滑块还会在里头露出来
      showMenuBar: false,
      showToolBar: false,
      showAlgebraInput: false,
      showResetIcon: false,
      enableRightClick: false,
      enableLabelDrags: true,
      enableShiftDragZoom: true,
      showZoomButtons: false,
      appletOnLoad: function (a) {
        api = a;
        ready = true;
        // 加载提示到这儿收工。
        note('');
        // 命令写错时，别弹那个糊在画板中间的模态框。错误改走控制台。
        try { a.setErrorDialogsActive(false); } catch (e) {}
        // 只要图形区。`perspective:'G'` 这个启动参数不管用（实测还是带出代数面板，
        // 白占底下三分之一，滑块也会在里头露出来），得加载完之后再喊一声。
        try { a.setPerspective('G'); } catch (e) {}
        setDefaultView();
        // ★ 装完机再对齐一次容器高度（2026-10-02）。inject 那一刻的布局常常还没稳
        //   （字体后到、顶栏回卷成两行都会改高度），而**光靠 ResizeObserver 不一定醒**：
        //   它盯的是 `#ggb`，`#ggb` 的高度被 inject 写死了，父级变它不变。
        //   refit 自己有 220ms 防抖和"尺寸没变就别喊"的闸，多喊一次是安全的。
        refit();
        if (hooks.ready) hooks.ready();
        flushPending();
      }
    }, true);
    app.inject(containerId);

    // ★★ 把**容器自己的高度**也对齐到 applet 的高度（2026-10-02 加，手机实测）。
    //   为什么非做不可：`inject()` 会把容器尺寸写死成行内样式（`#ggb` 上挂着
    //   `height: 82px`），而 `setSize()` **只改它自己那套 DOM，不回头改这行行内样式**。
    //   于是 inject 那一刻容器多高，那行样式就永远是多高——后来布局settle了、
    //   `refit` 把 applet 撑到 105，容器还是 82，而 `#ggb` 是 overflow:hidden：
    //   **底下 21px 直接被切掉**（390px 实测：等 7 秒让布局稳下来才看得见这一幕，
    //   4 秒时反而"看着没事"——所以这个 bug 靠肉眼和早量都抓不到）。
    //   ⚠ 这么写**不会**触发那套"自问自答"的循环：fit() 量的是**父级** `.boardwrap`
    //     （见上面那段），改子级的高度不会反馈回测量值。这是那个设计顺手带来的好处。
    function syncHost(n) {
      var c = hostId && document.getElementById(hostId);
      if (!c) return;
      var cs = window.getComputedStyle(c);
      var py = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      c.style.height = (n[1] + py) + 'px';
    }

    // 容器一变，画板跟着变
    var t = null, lastW = 0, lastH = 0;
    function refit() {
      clearTimeout(t);
      t = setTimeout(function () {
        if (!api) return;
        var n = fit();
        // 尺寸没真变就别喊 setSize —— 它自己会改 DOM，不设这道闸容易和下面那个
        // ResizeObserver 互相触发个没完。
        if (n[0] === lastW && n[1] === lastH) { syncHost(n); return; }
        lastW = n[0]; lastH = n[1];
        try { api.setSize(n[0], n[1]); } catch (e) {}
        // ★ 这一句不能省，也别挪到 if 里面去：上面那道闸拦掉的正是"尺寸没变、
        //   但容器那行行内样式还停在旧值"的情形——而那正是要修的这一种。
        syncHost(n);
      }, 220);
    }
    window.addEventListener('resize', refit);
    // ★ 光听 window.resize 不够（2026-10-01 手机实测）：顶栏在窄屏上会回卷成两行、
    //   字体后到会改行高——这些都会让盒子变矮，**但不触发 window.resize**。
    //   结果就是 applet 比容器高出一截（实测手机上是 347×240 塞进 361×224），
    //   而 `#ggb` 是 overflow:hidden，底下那一条被切掉，画板看着像没画完。
    //   盯着这个盒子本身，谁把它改了都算数。
    if (window.ResizeObserver) {
      try {
        var box = document.getElementById(containerId);
        if (box) new ResizeObserver(refit).observe(box);
      } catch (e) {}
    }
  }

  // ---- 学生说"画不出来"，而模型没给围栏 → 本地递一把尺子 ----
  //
  // ★ 为什么这条也得有本地兜底（2026-10-01 实测）：
  //   v18 提示词里的「办法三」写得很清楚——学生说画不出来，**老师给他一条空数轴**，
  //   不是让他自己再画一遍。可免费通道那颗文字模型（正文稳、围栏丢）打这个用例只有 1/8，
  //   于是学生说完"我画不出来"，屏幕上什么都不动，只换来一句反问——等于把话推回去了。
  //   道理和 chips.js 一样：**凡是在免费通道上守不住的，都得有本地兜底兜着。**
  //
  // 只认"数轴"和"坐标系"两类，别的一律不动——没把握时宁可什么都不画，
  // 也不能画出一个提示词没让画的东西（那正是"替他做题"的开头）。
  // 返回画了什么，没画返回 ''（测试和排查都用得上）。
  function giveBlank(text) {
    var t = String(text || '');
    // 先得确认他是在"要图"，不是"提到了图"
    if (!/画不出来|画不了|不会画|帮我画|给我画|画个|画一下|画一画|能画|看得见/.test(t)) return '';
    if (/数轴/.test(t)) { run(['#清空', '数轴']); return '数轴'; }
    if (/坐标系|坐标平面|平面直角/.test(t)) { run(['#清空', '坐标系']); return '坐标系'; }
    return '';
  }

  return {
    init: init, run: run, clear: clear, redraw: redraw, giveBlank: giveBlank,
    draw: draw, shoot: shoot, shootMarked: shootMarked,
    togglePlay: togglePlay, stopPlay: stopPlay,
    toPNG: toPNG, exportPNG: exportPNG,
    isReady: function () { return ready; },
    canPlay: function () { return !!playTarget; },
    isPlaying: function () { return playing; },
    is3D: function () { return is3D; },
    // 工具条那两个按钮走这里（模型自己在围栏里写 #三维 时也会经 hooks.view 回头喊一声）
    setView: function (v) {
      if (v === '3d') show3D(); else showPlane();
      return is3D;
    },
    // 还有命令排着队没执行完吗（测试和"重画"按钮都用得上）
    isBusy: busyNow,
    translate: translate,           // 给测试用：看中文命令翻成了什么
    // 给测试用：把 applet 本体交出去。
    // ★ 为什么非要露这个口子：GeoGebra 有哪些接口、那几个样式命令到底叫什么名字，
    //   我**猜不出来**——猜错了 evalCommand 只是返回 false，一声不响，画板上看不出区别。
    //   有了这个口子，量具（test/_t9.cjs）能在真画板上一条条试、当场看返回值。
    applet: function () { return api; }
  };
})();
