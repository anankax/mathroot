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
          queueLeft--;                 // ★ 跑一条减一条，"在画"才收得住
        }, idx * SR.GGB_CMD_DELAY));
      })(lines[k], k);
    }
  }

  var pendingLines = null;
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

  // ---- 装机 ----
  var hostId = null;

  // 画板跟着容器走，别写死尺寸——投影仪、笔记本、半屏，窗口大小都不一样
  function fit() {
    var c = hostId && document.getElementById(hostId);
    if (!c) return [SR.GGB_WIDTH, SR.GGB_HEIGHT];
    var w = Math.max(320, Math.floor(c.clientWidth - 14));
    var h = Math.max(240, Math.floor(c.clientHeight - 14));
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

  function init(containerId, h) {
    if (h) for (var k in h) if (h.hasOwnProperty(k)) hooks[k] = h[k];
    hostId = containerId;
    if (typeof GGBApplet === 'undefined') {
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
        // 命令写错时，别弹那个糊在画板中间的模态框。错误改走控制台。
        try { a.setErrorDialogsActive(false); } catch (e) {}
        // 只要图形区。`perspective:'G'` 这个启动参数不管用（实测还是带出代数面板，
        // 白占底下三分之一，滑块也会在里头露出来），得加载完之后再喊一声。
        try { a.setPerspective('G'); } catch (e) {}
        setDefaultView();
        if (hooks.ready) hooks.ready();
        flushPending();
      }
    }, true);
    app.inject(containerId);

    // 窗口一变，画板跟着变
    var t = null;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (!api) return;
        var n = fit();
        try { api.setSize(n[0], n[1]); } catch (e) {}
      }, 220);
    });
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
    togglePlay: togglePlay, stopPlay: stopPlay, toPNG: toPNG,
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
    isBusy: function () { return queueLeft > 0 || !!pendingLines; },
    translate: translate            // 给测试用：看中文命令翻成了什么
  };
})();
