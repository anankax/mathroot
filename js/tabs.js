// 右栏多页：**一块 GeoGebra，好几页。**
//
// 为什么（孔老师 2026-10-02 用过线上那版之后的话）：
//   「右边可以产出多个不同的内容的 ggb 图」
// 原来画板只有一块：模型画第二张图的时候，第一张就被盖掉了。一节课讲下来，
// 老师回头想再看一眼"刚才那个动点是怎么动的"——没了。再画几张也一样，永远只剩最后一张。
//
// ★ 做法：**一个 applet，多份状态快照**（切页 = `getBase64()` 存走 + `setBase64()` 载回）。
//   不给每页开一个 applet，理由很实在：js/board.js 整套 `fit/refit/syncHost` 和
//   `paperSnapshot/paperOff` 都是围绕"一块画布"写的（`paperOff` 改的是**全局**的
//   颜色和刻度数字），多实例会互相打架。
//
// ★★ 这条路有两个坑，都是量出来的（test/probe_tabs.cjs），**别在别处重犯**：
//     · `isBusy()` 为真时取的快照是**残的**（1 个 element vs 画完 5 个）
//       → 换页前必须先等这一张画完（在 board.activatePage 里做，不在这儿）
//     · `setBase64` 是**异步**的，载入没落地时发出去的命令会被**吃掉**
//       → 载入后要轮询到收敛再放人（在 board.restore 里做）
//   所以这一层只管"哪一页是哪一页、叫它什么名字"，碰画板的事一律交给 board.js，
//   不在这儿另开一条通往 applet 的路——**两条路就是两个真源**。
var SR = (window.SR = window.SR || {});

SR.tabs = (function () {

  // ============================================================
  //  一、页名 —— 纯函数，node 里能跑
  // ============================================================

  // ★ 这份表是"从命令认内容"的**唯一一份**。js/pack.js 那边给图片起名也读它
  //   （`SR.tabs.shapeOf`）——原来那边自己抄过一份，两套规则就是两个真源：
  //   同一张图，标签上叫「函数图象」、压缩包里叫「抛物线」，老师会以为存错了。
  //
  // ★ 每条都挑得**很窄**：宁可认不出来（退回「图 N」），也别认错。
  //   把抛物线叫成「数轴」比叫「图 3」坏得多——老师会以为是自己存错了。
  var SHAPES = [
    [/#三维/,                              '立体图'],
    [/Slider\s*\(/,                        '动点'],
    [/Circle\s*\(/,                        '圆'],
    [/Polygon\s*\(/,                       '多边形'],
    [/Triangle\s*\(|三角形/,                '三角形'],
    [/[xyf]\s*\(?\s*x\s*\)?\s*=|x\s*\^\s*2/, '函数图象']
  ];

  // 认这一串命令画的是什么。认不出来回**空串**（不是「图」——
  // 兜底那个「图 N」的责任在下面 titleFor 手里，两件事分开）。
  function shapeOf(cmds) {
    var s = String(cmds == null ? '' : cmds);
    var lines = s.split(/[\n;；]/), i, t;
    // 先认"整条命令就是一个词"的那种——它们比正则表里的形状更硬
    for (i = 0; i < lines.length; i++) {
      t = lines[i].trim();
      if (/^#?数轴$/.test(t)) return '数轴';
      if (/^#?(坐标系|坐标平面|平面直角坐标系)$/.test(t)) return '坐标系';
      if (/^#?(三维|3d)$/i.test(t)) return '立体图';
    }
    for (i = 0; i < SHAPES.length; i++) if (SHAPES[i][0].test(s)) return SHAPES[i][1];
    return '';
  }

  // 名字上的脏东西：换行、反引号、markdown 记号、末尾标点
  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[`*#]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 12)
      // ⚠ 末尾标点那份名单里**必须有中文句号**。第一版写的是 `[.、,，:：;；!！?？]`——
      //   半角句点在里面，`.。` 这个中文的**不在**，而中文句子结尾恰恰最常用它。
      //   症状：模型把围栏标题写成「数轴。」，标签上就真印着那个句号。
      //   （这一条是 test/probe_tabpage.cjs 的 A 腿逼出来的，不是我想到的。）
      .replace(/[.。．、,，:：;；!！?？…]+$/, '')
      .trim();
  }

  // 重名了加个号，别让两个标签长得一模一样（老师分不清点哪个）
  function uniqueTitle(t, ex) {
    ex = ex || [];
    if (t === '图') {                       // 认不出来 → 「图 1」「图 2」…
      var n = 1;
      while (ex.indexOf('图 ' + n) >= 0) n++;
      return '图 ' + n;
    }
    if (ex.indexOf(t) < 0) return t;
    var k = 2;
    while (ex.indexOf(t + ' ' + k) >= 0) k++;
    return t + ' ' + k;
  }

  // 一页叫什么。三个来源，从硬到软：
  //   ① 围栏标题（```ggb 数轴）—— **当可选**：小模型掉围栏是常态，不能指望它
  //   ② 命令内容（数轴／坐标系／三维／圆／…）
  //   ③ 兜底「图 N」
  //   ⚠ 不许用时间戳、不许用 `page-1`：老师认的是内容，不是编号。
  //     也不许叫「画板」——那个词 2026-10-02 已经从这个产品里拿掉了
  //     （它说不清是什么东西，还跟"几何画板"撞词，见 index.html 里那段）。
  function titleFor(cmds, existing, hint) {
    var s = Array.isArray(cmds) ? cmds.join('\n') : String(cmds == null ? '' : cmds);
    var t = clean(hint) || shapeOf(s);
    return uniqueTitle(t || '图', existing || []);
  }

  // ============================================================
  //  二、页
  // ============================================================
  //
  //  一页：{ title, snap, lines, used, pending, blank }
  //    snap    board.snapshot() 那一份 `{data, n}`；null = 还没存过（切走的时候存）
  //    lines   这一页是照哪串命令画的
  //    used    这一页已经被画过东西了没有（刚开出来那一页是 false，可以接着用）
  //    pending **还没画**：老师正翻着前面某一页，新的一页先挂着（标签上点一个点）
  //    blank   就是开场那一块空板
  var pages = [], cur = -1, following = true;
  var hostId = null, live = false, waitT = null, waitN = 0;

  function status(msg) {
    if (SR.chat && SR.chat.setStatus) SR.chat.setStatus(msg);
  }

  function titlesExcept(i) {
    var out = [];
    for (var k = 0; k < pages.length; k++) if (k !== i) out.push(pages[k].title);
    return out;
  }

  // 开场那一块空板也算一页。★ 为什么不"等它画了第一张图才开页"：
  //   老师在空板上手画两笔是常事（讲台上直接画给学生看），那两笔也得有个地方待着。
  function newBlank() {
    pages.push({
      title: '空白页', snap: SR.board.snapshot(),
      lines: [], used: false, pending: false, blank: true
    });
    cur = pages.length - 1;
    following = true;
  }

  // 回 `[那一页对象, 它现在的下标]`。★ 为什么把**对象**也交出去：`evict()` 会在这里面
  // 刨格子、下标当场就过期了，而调用方还要拿着它等一个异步回调（见 sealInto）。
  function addPage(lines, hint, pending) {
    var s = (lines || []).join('\n');
    var pg = {
      title: titleFor(s, titlesExcept(-1), hint),
      snap: null, lines: (lines || []).slice(),
      used: false, pending: !!pending, blank: false
    };
    pages.push(pg);
    var drop = evict();
    if (drop) status('标签最多 ' + (SR.TABS_MAX || 12) + ' 页，最早那一页收起来了。');
    return [pg, pages.indexOf(pg)];
  }

  // 标签上限：超了收**最早那一页**，但当前这一页和最新那一页永远留着。
  function evict() {
    var max = SR.TABS_MAX || 12, dropped = 0, victim = -1, i;
    while (pages.length > max) {
      victim = -1;
      for (i = 0; i < pages.length; i++) {
        if (i === cur || i === pages.length - 1) continue;
        victim = i; break;
      }
      if (victim < 0) break;           // 只剩它自己了，不删
      pages.splice(victim, 1);
      if (victim < cur) cur--;
      dropped++;
    }
    return dropped;
  }

  // 把 `cur` 收到数组范围里。★ 为什么非要这么一句：`evict()` 会在**任一次 addPage**
  //   里刨格子，而这时可能正有一段异步活儿（`openNew` 的回调）在等着。等它回来的时候，
  //   它攥着的下标可能已经指到数组外面去了。`cur` 变成 -1 之后，
  //   `render()` 会一个标签都不点亮、`drawHere()` 会整个走老路——**看着像"多页没装起来"，
  //   其实是账乱了**，最难查的那一类。
  function clampCur() {
    if (pages.length === 0) { cur = -1; return; }
    if (cur < 0 || cur >= pages.length) cur = pages.length - 1;
  }

  // 把某一页的存档记下来。★ 存不下来时**保留旧的那份**，别把好的覆盖成空的。
  //
  // ★★ 收的是**那一页这个对象本身**，不是它在数组里的下标。
  //   存快照这件事是**异步**的（要等这一张画完、等 setBase64 收敛），
  //   而等待期间上面的 `evict()` 完全可能把数组刨掉一格、后面全体前移。
  //   按下标收的话，等回来就落到**隔壁那一页**身上了——症状是"点第 2 个标签，
  //   出来的是第 3 页那张图"，而且它不报错、不崩，只是悄悄换了张图。
  //   （这条是写 test/probe_tabpage.cjs 的时候看出来的，不是跑出来的。）
  function sealInto(pg, snap) {
    if (pg && snap) pg.snap = snap;
  }

  // ============================================================
  //  三、模型又画了一张（js/chat.js 那条路走这儿，不再直接喊 board.run）
  // ============================================================

  function drawHere(lines, hint) {
    if (!live || cur < 0) {                  // 多页没装起来 → 退回老路，绝不挡住画图
      SR.board.run(lines);
      return;
    }
    var pg = pages[cur];

    // ① 眼前这一页是块"还没用过的空白板"，而且你人就在这儿（`following`）→ 直接用它，
    //    不再另开一页。（开场那块空板上画第一张图走这条；点了「清空」之后画下一张也走这条。）
    //    ★ 原来这儿写的是 `cur === pages.length - 1`——**只有停在最后一页才复用**。
    //      那是错的：他在第 1 页上点了「清空」，再要一张图，本该就画在这块刚擦干净的板上
    //      （`cleared()` 那段注释就是这么承诺的），可条件不成立，于是标签条上又多出一个空标签，
    //      他刚清掉的那一页倒一直写着「空白页」挂在那儿。
    //      改成看 `following`：它现在只在"你停在最新一页"或"你刚清了这块板"时为真——
    //      恰好就是"你人在这儿"的两种情形。**判据从"在哪一格"换成"人在不在"。**
    if (following && !pg.used && !pg.pending) {
      pg.used = true;
      pg.blank = false;
      pg.title = titleFor(lines.join('\n'), titlesExcept(cur), hint);
      pg.lines = (lines || []).slice();
      SR.board.run(lines);
      render();
      return;
    }

    // ② 老师正翻着前面某一页 → **一根汗毛都不动他眼前的板**，
    //    只把新的一页先挂上去（标签上一个点），等他自己点过去的那一刻才画。
    //    ★ 为什么不在这儿后台画好：画板只有一块，要么占着他的板画（他正看着的那张
    //      会被洗一下再洗回来），要么先不画。挂着最省事，而且**他能看见"数根又画了一张"**。
    if (!following) {
      var pi = addPage(lines, hint, true)[1];
      status('数根又画了一张（第 ' + (pi + 1) + ' 页，还没画）——你在看第 ' + (cur + 1) +
             ' 页，没动你的板。点那个带点的标签过去看。');
      render();
      return;
    }

    // ③ 正常：把现在这一页封存，接着把新的画上去。
    //    ★ 先把标签挂上、再动手：老师点下去的一瞬间就该看见"第 3 页"出现了，
    //      而不是等它画完才冒出个标签（那中间几秒屏幕上什么都没有，像卡住了）。
    // ★ 抓的是"原来那一页这个对象"，不是下标 `cur`——见 sealInto 上面那段。
    var fromPg = pages[cur];
    var add = addPage(lines, hint, false);
    var np = add[0];
    // ★★ 必须当场标成"用过了"。`addPage` 开出来的一律是 `used:false`（"刚开出来、还没用过"），
    //   而这一页**马上**就要画上东西——不标的话，下一次 drawHere 会看见一个
    //   "还空着的页"，走上面那条 ①，把**刚画好的这张图连名带图一起盖掉**。
    //   症状特别阴：页数不涨（该三页变两页）、标签上写着新名字、板子上是新图，
    //   看着像"少开了一页"，其实是**上一张被吃了**。
    //   （这条是 test/probe_tabpage.cjs 的格子 ⑤a 抓出来的 —— 第二张图之后再画一张，
    //    页面数停在 2，第一张的函数图象被顶掉变成「立体图」。）
    np.used = true;
    cur = add[1];
    render();
    SR.board.openNew(lines, function (r) {
      if (!r.ok) {
        // 封存没成（画板忙到超时之类）→ 把这一页撤掉，别留一个永远空着的标签
        var k = pages.indexOf(np);
        if (k >= 0) pages.splice(k, 1);
        var back = pages.indexOf(fromPg);
        if (back >= 0) cur = back;    // 原来那一页还在 → 退回去
        clampCur();                   // 它也被收走了 → 退到最后一页，总之别指向数组外面
        SR.board.run(lines);          // 老路：画上去了，只是没分页
        status('没分出一页来（' + r.why + '），这张还是画在当前这一页上了。');
        render();
        return;
      }
      sealInto(fromPg, r.out);
    });
  }

  // ============================================================
  //  四、老师点了某个标签
  // ============================================================

  function go(i) {
    if (i < 0 || i >= pages.length || i === cur) return;
    var pg = pages[i];
    var fromPg = pages[cur];

    // 老师要看某一页 → **先把思维导图让开**（js/mindmap.js 的 yieldToBoard）。
    // ★ 放在这一行、**在下面那几个 return 之前**：点了一页却因为"还没存过"
    //   被挡回来时，他想要的是看那张图，导图还盖着就说不通。
    //   放在最前面还有个好处——后面每一处 status() 写的字，他都看得见
    //   （导图盖着的时候状态条在下面，本来也在，但视线在那张图上）。
    //   ⚠ yieldToBoard 自己判 open，不开的时候它一声不响。
    if (SR.mm) SR.mm.yieldToBoard();

    if (pg.pending) { openPending(pg, fromPg); return; }
    if (!pg.snap) { status('这一页还没存过，切不过去。'); return; }

    status('正在切到第 ' + (i + 1) + ' 页…');
    SR.board.activatePage(pg.snap, function (r) {
      if (!r.ok) {
        // ★ 切不过去就**老老实实留在原地**，并把为什么说出来。
        //   绝不"切一半"——那会让标签指着 A、板子上是 B，比切不过去坏得多。
        //   `cur` 从头到尾没动过，所以"原地"不是靠这里补回来的，是**根本没离开过**。
        following = (cur === pages.length - 1);
        status('没切过去：' + r.why);
        render();
        return;
      }
      sealInto(fromPg, r.out);
      // ★ 按对象找下标，不按当年那个 `i`——等这一趟回来，数组可能已经被收过格子了。
      var k = pages.indexOf(pg);
      if (k >= 0) cur = k;
      clampCur();
      following = (cur === pages.length - 1);
      render();
    });
  }

  // ★ 收的是**页对象**不是下标：`go()` 里刚拿到它就同步转手过来，这一路上
  //   没有 `addPage`（也就没有 `evict`），但用对象是一道白拿的保险。
  function openPending(pg, fromPg) {
    var i = pages.indexOf(pg);
    if (i < 0) return;                    // 已经被收走了
    status('正在把第 ' + (i + 1) + ' 页画出来…');
    SR.board.openNew(pg.lines, function (r) {
      if (!r.ok) { status('没画出来：' + r.why); return; }
      sealInto(fromPg, r.out);
      pg.pending = false;
      pg.used = true;
      var k = pages.indexOf(pg);
      if (k < 0) return;              // 这中间被收走了，不吭声
      cur = k;
      following = (cur === pages.length - 1);
      render();
    });
  }

  // ============================================================
  //  五、标签条
  // ============================================================

  function render() {
    var host = hostId && document.getElementById(hostId);
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);

    // ★ 只有一页就别占那一行。手机上画板那一块才 156px，一行标签是它的五分之一；
    //   而且一个标签的"标签条"也不像话。
    //   ⚠ 一行的高度变化会让画板被切（`#ggb` 的尺寸是 inject 那一刻定死的，
    //     ResizeObserver 盯的是 `#ggb` 自己，父级变矮它不醒）——所以下面补一次 refit。
    if (pages.length < 2) {
      host.style.display = 'none';
      if (SR.board && SR.board.refit) SR.board.refit();
      return;
    }
    host.style.display = '';

    for (var i = 0; i < pages.length; i++) {
      (function (i) {
        var pg = pages[i];
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tab' + (i === cur ? ' on' : '') + (pg.pending ? ' pend' : '');
        b.title = pg.title + (pg.pending ? '（还没画，点它就画）' : '');
        var t = document.createElement('span');
        t.className = 'tt';
        t.textContent = pg.title;                 // ★ textContent：页名可能来自模型的原话
        b.appendChild(t);
        if (pg.pending) {
          var d = document.createElement('i');
          d.className = 'dot';
          b.appendChild(d);
        }
        b.addEventListener('click', function () { go(i); });
        host.appendChild(b);
      })(i);
    }
    if (SR.board && SR.board.refit) SR.board.refit();
  }

  // ============================================================
  //  六、装机 / 重置
  // ============================================================

  // 老师点了画板上那颗「清空」。★ 它**不只是擦板**：这一页的存档也得一起作废，
  //   否则他一走再回来，刚清掉的那张图自己又长回来了——他会以为"清空没生效"。
  //   作废之后这一页回到"刚开出来、还没用过"的样子：下一张图**接着用这一页**，
  //   不会因为他清了一下板就多出一个空标签。
  //   ⚠ 名字也得跟着改：标签上写着「数轴」而板上是空的，那是标签在说谎。
  function cleared() {
    if (cur < 0 || cur >= pages.length) return;
    var pg = pages[cur];
    pg.snap = null;
    pg.used = false;
    pg.pending = false;
    pg.lines = [];
    pg.blank = true;
    pg.title = uniqueTitle('空白页', titlesExcept(cur));
    // ★ 顺手把 `following` 置真：**点「清空」就是一句"我现在就在这块板上做事"。**
    //   不置的话，他若停在中间某一页（following 是假），清完再要一张图会**画到后台去**
    //   （标签上一个点），而他眼前明明是一块刚擦干净的空板——那张图却不上来。
    //   产品里"新图不抢视图"那条规矩的前提是**他正看着一张有内容的图**，不是空板。
    following = true;
    render();
  }

  function reset() {
    pages = []; cur = -1; following = true;
    // ★ 调用方（js/chat.js 的 reset）**先 clear 画板再喊这儿**——
    //   顺序反了的话，开场那一页的存档记的是上一条链子的最后一张图。
    if (live && SR.board.isReady()) newBlank();
    render();
  }

  function init(id) {
    hostId = id || 'tabs';
    // 画板那一包要从 geogebra.org 拉（冷缓存约 3 秒）。就绪之前 `snapshot()`
    // 一律返回 null，所以等它——但**等着不挡事**：没就绪时 drawHere 走老路。
    (function wait() {
      waitN++;
      if (SR.board && SR.board.isReady()) {
        live = true;
        if (!pages.length) newBlank();
        render();
        return;
      }
      if (waitN > 300) return;        // 一分钟还没起来就是不起来了，别一直转
      waitT = setTimeout(wait, 200);
    })();
  }

  return {
    // 纯函数（node 里能测）
    shapeOf: shapeOf, titleFor: titleFor, clean: clean,
    // 页
    init: init, reset: reset, cleared: cleared, drawHere: drawHere,
    go: go, render: render,
    // 给测试和界面看的读数
    count: function () { return pages.length; },
    current: function () { return cur; },
    titles: function () { return pages.map(function (p) { return p.title; }); },
    pending: function () { return pages.map(function (p) { return !!p.pending; }); },
    isFollowing: function () { return following; }
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.tabs;
