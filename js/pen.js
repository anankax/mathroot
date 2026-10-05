// 画笔：整页随手画，用来在图上圈重点、画辅助线、标角。
//
// 孔老师 2026-10-05 的原话：
//   「我觉得需要一个网页的画笔功能，这个功能要在最高层不会被页面影响遮挡，
//     最好是在右下角搞个画笔按钮，以及清屏，撤销，这样就可以在几何大图上面批注画线标记了。」
// 后面又补两条（都是一句话定死的）：
//   「撤销操作也能还原操作」「操作肯定要能可逆的」→ 加**重做**；
//   「画的时候会误触按钮肯定是不行的」→ 笔开着的时候，别的按钮一律按不到。
//
// ============================================================
// ★★ 它是**整页一层**，不是板子里的一小块
// ============================================================
//   他说的是"网页上随便画"——所以左边对话栏、顶栏、空白处，哪儿都画得上。
//   层挂在 `<body>` 底下（**不能**放进 `.drawer`／`.boardwrap`）：
//   `.drawer` 的关闭态靠 `translateX(…)` 滑出去，而任何祖先只要有 transform，
//   `position: fixed` 就改认那个祖先当包含块，"整页"当场变成"抽屉那一溜"，
//   并且屏幕上看着还挺正常、不报错。坑的详情写在 index.html 那一段。
//
// ============================================================
// ★★ 为什么是盖一层画布，不是往 GeoGebra 里塞对象
// ============================================================
//   塞进去（`线段()`／`手绘()` 那类命令）看着更"一体"，但要坏三件事：
//     ① 「清空」会把老师画的**图**跟批注一起抹掉 —— 清批注和清图是两个动作；
//     ② 「存图」「卷面图」走的是 applet 自己的位图，批注一进去就**印到卷子上**了；
//     ③ 批注是"随手一画"，不该被坐标系、被缩放、被切视角动来动去。
//   所以它自己记自己那一叠笔迹，和 GeoGebra **一点关系都没有**。
//
// ============================================================
// ★★ "盖在最上面"和"能画"是两件事
// ============================================================
//   z-index 最高解决的是**看不看得见**；"能不能画"是 `pointer-events` 说了算。
//   一块盖满全屏的透明画布要是**一直**吃鼠标，整页就锁死了：按钮点不了、对话滚不动。
//   所以右下角那颗「笔」兼一个开关：
//     关着 → `pointer-events: none`，这层透明得像不存在，网页照常用；
//     开着 → 整页归它，除了它自己那四颗按钮（那四颗在它上面，见 css 的层级注释）。
//
// ============================================================
// ★★ 代价（说好的，写在最显眼处）
// ============================================================
//   笔迹钉在**屏幕**上，不钉在图的点上。你圈住的那个点在屏幕上就是那个位置；
//   图重排了（点「放大看」、切三维、缩放），圈还留在原来那块屏幕上，**不跟着那个点跑**。
//   所以"一边缩放一边圈"会不对 —— 要圈，圈完再缩放。
//   这条是"整页随便画"自带的，不是没做好。
var SR = (window.SR = window.SR || {});

SR.pen = (function () {
  var cv = null, g = null;
  var 笔钮 = null, 撤钮 = null, 重钮 = null, 清钮 = null;
  var 开着 = false;

  // ★★ 存法：一个**操作栈** + 一根指针，画面 = 把栈里前 `指针` 条重放一遍。
  //    一条操作要么是一笔（`{t:'笔', 盘:[{x,y},…]}`），要么是清屏（`{t:'清'}`）。
  //    ★ 为什么不直接存"一堆笔迹 + 删了几笔"：因为**清屏也得能撤销**，
  //      而清屏撤回来的不是"最后一笔"，是**之前所有的笔**。
  //      做成"重放"，这件事不用特意写 —— 指针往回退一格，那些笔自然就回来了。
  //      代价是每次撤销/重做都要把可见的笔重画一遍；几十笔的量，看不出来。
  var 栈 = [], 指针 = 0;
  var 当前 = null;                 // 手上正画着的那一笔（还没入栈）
  var 红 = '#e0242c', 粗 = 3;

  function $(id) { return document.getElementById(id) }

  // ---------- 画面布 ----------
  // ⚠ `cv.width = …` 会把画布整个重置（变换、样式全没），所以设完必须重设变换。
  //   只在尺寸**真的变了**的时候设：ResizeObserver 一秒能喊好几次，
  //   每次都重设就是反复把画好的批注清掉重画。
  function 改尺寸() {
    if (!cv || !g) return;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    var dpr = window.devicePixelRatio || 1;
    var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (cv.width === pw && cv.height === ph) return;
    cv.width = pw; cv.height = ph;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    重放();
  }

  function 上色() {
    g.strokeStyle = 红; g.lineWidth = 粗;
    g.lineCap = 'round'; g.lineJoin = 'round';
  }

  // 把一条笔迹描到画布上（不清屏）
  function 描(盘) {
    if (!盘 || !盘.length) return;
    上色();
    if (盘.length === 1) {
      // ★ 点一下也得留个印：只画一个零长度的线段什么都看不见，
      //   老师"点了一下看看"会以为画笔没开。半径取半个线宽，看着就是个笔尖。
      g.beginPath(); g.arc(盘[0].x, 盘[0].y, 粗 / 2, 0, Math.PI * 2);
      g.fillStyle = 红; g.fill();
      return;
    }
    g.beginPath(); g.moveTo(盘[0].x, 盘[0].y);
    for (var i = 1; i < 盘.length; i++) g.lineTo(盘[i].x, 盘[i].y);
    g.stroke();
  }

  // 全清 + 按栈重放。撤销／重做／清屏／改尺寸都走它 —— **一处说了算**。
  function 重放() {
    if (!g || !cv) return;
    g.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
    for (var i = 0; i < 指针; i++) {
      var 步 = 栈[i];
      if (步.t === '清') g.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
      else 描(步.盘);
    }
    if (当前) 描(当前);
    同步钮();
  }

  // 画面上现在有没有东西？—— 顺着栈走一遍，遇到清屏就把计数清零。
  // ⚠ 不能拿"指针 > 0"顶替：栈是 [{笔},{清}]、指针 2 的时候，画面上是空的，
  //   但指针 > 0 成立 —— 那样「清」会一直亮着，按下去又什么都不变。
  function 有墨() {
    var n = 0;
    for (var i = 0; i < 指针; i++) n = (栈[i].t === '清') ? 0 : n + 1;
    return n > 0;
  }

  function 同步钮() {
    if (撤钮) 撤钮.disabled = !(指针 > 0);
    if (重钮) 重钮.disabled = !(指针 < 栈.length);
    if (清钮) 清钮.disabled = !有墨();
  }

  function 撤销() {
    if (!(指针 > 0)) return;
    指针--; 当前 = null; 重放();
  }

  function 重做() {
    if (!(指针 < 栈.length)) return;
    指针++; 当前 = null; 重放();
  }

  function 清屏() {
    if (!有墨()) return;
    栈.length = 指针;                  // 新动作之前，原来能重做的那一摞作废
    栈.push({ t: '清' });
    指针++;
    当前 = null;
    重放();
  }

  function 开关(b) {
    开着 = (b === undefined) ? !开着 : !!b;
    if (cv) cv.classList.toggle('on', 开着);
    if (笔钮) {
      笔钮.setAttribute('aria-pressed', 开着 ? 'true' : 'false');
      笔钮.title = 开着 ? '画笔（开着）：整页按住拖动就是画 · 再点一下关掉' : '画笔：整页随手画线批注';
    }
    // 关画笔的那一刻手上还有一笔没抬起来 → 收成正式一笔，别丢
    if (!开着 && 当前) { 入栈(当前); 当前 = null; 重放(); }
  }

  function 入栈(盘) {
    if (!盘 || !盘.length) return;
    栈.length = 指针;                  // 新动作之前，原来能重做的那一摞作废
    栈.push({ t: '笔', 盘: 盘 });
    指针++;
  }

  // ---------- 落笔 ----------
  // 整页 fixed 层，左上角就是视口左上角 —— `clientX/clientY` 直接能用，
  // 不用减任何一个盒子的位置。（改成放进容器里就得每次 getBoundingClientRect，
  // 而且滚页面的时候那个值会变，这是"整页一层"顺手省下来的一件事。）
  function 点(e) { return { x: e.clientX, y: e.clientY }; }

  function 按下(e) {
    if (!开着 || !cv) return;
    if (e.button !== undefined && e.button > 0) return;   // 右键／中键不管
    if (e.isPrimary === false) return;                    // 多指时只认第一根
    当前 = [点(e)];
    // ★ 指针捕获：手指／鼠标划出视口边界的那一截也得算数，
    //   不然画个圈稍微出界，弧就断在那儿了。
    try { cv.setPointerCapture(e.pointerId) } catch (err) {}
    e.preventDefault();
    重放();                          // 立刻点出一个笔尖，别等抬手
  }

  function 拖动(e) {
    if (!当前 || !g) return;
    var p = 点(e), 末 = 当前[当前.length - 1];
    // 挪不到一个像素就不记：一秒能来几百个事件，全塞进去只是白占内存
    if (Math.abs(p.x - 末.x) + Math.abs(p.y - 末.y) < 1.2) return;
    var 起点 = { x: 末.x, y: 末.y };
    当前.push({ x: p.x, y: p.y });
    // ★ 只画**新添的这一小段**，不整幅重放 —— 一笔画长了，
    //   每次移动都从头描一遍会越描越卡，手感先坏掉。
    //   整幅重放只留给"撤销／重做／清屏／改尺寸"这些一转念的时刻。
    上色();
    g.beginPath(); g.moveTo(起点.x, 起点.y); g.lineTo(p.x, p.y); g.stroke();
    e.preventDefault();
  }

  function 抬起(e) {
    if (!当前) return;
    入栈(当前); 当前 = null;
    try { if (e && e.pointerId !== undefined) cv.releasePointerCapture(e.pointerId) } catch (err) {}
    同步钮();
  }

  // 笔开着的时候不让页面跟着滚。
  // ★ 不拦的话：一边画一边页面自己在动，画出来的线跟想画的位置**错开**，
  //   而且画完一看全是斜的 —— 这种坏法很容易被当成"画笔不准"。
  //   要滚页面就先把笔关掉。`passive:false` 是必须的，否则 preventDefault 无效
  //   （浏览器默认把 wheel 当 passive，拦了也不生效、还不报错）。
  function 拦住滚(e) { if (开着) e.preventDefault(); }

  function init() {
    cv = $('penlayer');
    if (!cv) return false;
    g = cv.getContext('2d');
    if (!g) return false;
    笔钮 = $('pen-toggle'); 撤钮 = $('pen-undo'); 重钮 = $('pen-redo'); 清钮 = $('pen-clear');
    if (笔钮) 笔钮.addEventListener('click', function () { 开关() });
    if (撤钮) 撤钮.addEventListener('click', function (e) { e.preventDefault(); 撤销() });
    if (重钮) 重钮.addEventListener('click', function (e) { e.preventDefault(); 重做() });
    if (清钮) 清钮.addEventListener('click', function (e) { e.preventDefault(); 清屏() });
    cv.addEventListener('pointerdown', 按下);
    cv.addEventListener('pointermove', 拖动);
    cv.addEventListener('pointerup', 抬起);
    cv.addEventListener('pointercancel', 抬起);
    cv.addEventListener('wheel', 拦住滚, { passive: false });
    // ★ 盯画布自己，不盯 window：它是 `fixed inset:0`，视口一变它就变，
    //   所以"它变了"和"该重排了"是同一件事。手机地址栏收放、转屏也走这条。
    if (window.ResizeObserver) {
      try { new ResizeObserver(function () { 改尺寸() }).observe(cv) } catch (e) {}
    }
    window.addEventListener('resize', function () { 改尺寸() });
    改尺寸(); 重放();
    return true;
  }

  return {
    init: init,
    // 给探针用的口子（test/probe_pen.cjs）。产品自己不读这些。
    __开着了: function () { return 开着 },
    __栈: function () { return 栈 },
    __指针: function () { return 指针 },
    __当前: function () { return 当前 },
    __开关: 开关, __撤销: 撤销, __重做: 重做, __清屏: 清屏,
    __笔迹: function () {
      // 重放一遍栈，把"此刻画面上真正看得见的笔"吐出来（探针拿它核撤销/重做）
      var 出 = [];
      for (var i = 0; i < 指针; i++) {
        var 步 = 栈[i];
        if (步.t === '清') 出 = []; else 出.push(步.盘);
      }
      return 出;
    }
  };
})();
