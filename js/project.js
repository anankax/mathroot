// 「投影」——上课现用的大字视图（2026-10-03）。
//
// 这一格要治的病是孔老师原话里那一句：**投到教室字太小、步骤全露**。
//
// 备课／讲评摆出来的是一条链子：若干节，每节三行——「学生大概会说」／「你接这句」／
// 「这么接的道理」（格式见 js/chips.js 的 SR.parseStepBody）。它在电脑上当草稿看
// 正合适：一屏摆全，随时能回头对一眼。可一旦投到教室，一屏摆全就同时坏了两次：
//   ① 字小到后排看不清（一屏七八块内容，字号只能一压再压）；
//   ② **答案全露**——你还没开口问，"学生大概会说"那行已经被底下读完了。
//     这一条比字小更致命：链子的讲法本来就是"先让学生说，老师再接"，
//     把学生该说的那句话提前亮在黑板上，这一节课就白设计了。
//
// 所以这一格不是"把字放大"，是**换一种放映方式**：一屏只放一节，一节点一下。
// 讲完一节按一下，下一节盖上来；讲岔了能倒回去。前后翻、进度点、Esc 出来。
//
// ★ 入口：台阶条末尾那颗「⛶ 投影」（js/chat.js 的 renderSteps 里挂的）。
//   它**只在真的摆出链子之后才出现**——那条台阶条本身就是这个判据，
//   所以"没链子时按钮乱亮"这种事天然不会有，不必另设一层门禁。
// ★ 不新开窗口、不调全屏 API：上课那台机器上弹一个权限框，比字小还烦人。
//   它就是一整层盖在页面上（`position:fixed` 铺满），Esc 就出来。
// ★ **一个字都不发给模型**。整块是纯前端的一层皮，数据全从已经落盘的对话里读。
//   点这颗按钮不会产生任何一輪调用、不花额度、不改对话。
//
// ★★ **一节之内还要再展开一次**（2026-10-04 孔老师拍板）。原来"一屏只放一节"
//   只堵住了一半：三块还是并排亮着的，你念"学生大概会说"那一行的同时，
//   "你接这句"已经亮在旁边了——**学生答之前就看见老师准备接的话**，
//   这一节课照样白设计。所以现在：
//     · 一上来**只亮"学生大概会说"**；
//     · 按一下，才亮"你接这句"；再按一下，才亮"这么接的道理"。
//   一屏仍然只放一节。规矩：
//     · `→ / 空格 / Enter / ↓ / PageDown`：本节还有没亮的就亮一块，
//       **全亮了才翻下一节**；停在最后一节又全亮时，这一下什么都不做。
//     · `← / ↑ / PageUp`：本节多亮出来的就收一块，**只剩一块了才退上一节**。
//     · 点进度点 / Home / End：直接落到那一节，**它亮着几块就是几块**（不动它）。
//     · 刚打开投影：每一节都从"只亮第一块"起。
//   ★★ **"亮了几块"记在每一节自己头上**（`亮表`，键是节号），不是全屏一个数。
//      为什么非得这样：全屏一个数的话，"翻回去"和"翻过来"就对不上了——
//      你在第 1 节亮到第三块，按一下翻到第 2 节，再按回来，第 1 节会退回只亮一块
//      （因为那个数被重置了），**按错了退不回原样**。分开记，`←` 就是 `→` 的逆：
//      左边按几下、右边按几下，落点一模一样。
//      键用**节号**不用下标：模型倒回来补写某一节时，数组下标会漂，节号不会。
//   脚上那两颗按钮的**字会跟着变**（"亮下一块 ▶" / "下一节 ▶"），
//   老师就不用猜这一下按出去是亮一块还是翻页。★ 字变了**宽度不能变**——
//   CSS 给 .projnav 钉了 min-width；不然按钮一伸缩，条子上的东西全跟着挪，
//   老师按第二下的时候手指落在别处了（同下面 `.projnav:disabled` 那条一个道理）。
//   还没亮的那几块**照样占着位置**（画成一条虚线），只是内容不写：
//   一是不剧透，二是免得亮出来那一刻整块屏跳一下。
//
// ⚠ 别往 `#proj` 里放画板（`#ggb`）。整块是靠 `display:none` 开合的，而
//   `display:none` 会让 board.js 的 `fit()` 量到 0、图**静默**缩成 240×60
//   （见 index.html 抽屉那段注释里的同一条教训）。要在投影里看图，
//   另开一块板，别把这唯一一块搬进来。
var SR = (window.SR = window.SR || {});

SR.project = (function () {
  var 开 = false;
  var 页 = 0;          // 现在放映第几节（数组下标，不是节号）
  var 亮 = 1;          // 这一节**亮了几块**（只数模型真写了的那几块，见 有块()）
  var 亮表 = {};       // 节号 → 那一节亮了几块。★ 只有 画() 写它，只有 open() 清它
  var 有 = [];         // 这一节真写了的那几块（画() 每回重算）
  var 节 = [];         // 已经摆出来的节，按节号升序
  var $ = function (id) { return document.getElementById(id); };

  // ============================================================
  //  ① 取数
  // ============================================================
  // ★ 唯一的取值入口是 `SR.memo.log()`——那一份是这个产品里"说过的话"的真源，
  //   刷新回来还在（localStorage，见 js/memo.js）。
  // ★★ **绝不读 DOM**，两条理由都是硬的：
  //     ① 气泡里的字是**渲染过**的。KaTeX 渲完之后，MathML 的注解节点里
  //        还留着 `\frac{1}{2}` 的原文——照 `textContent` 抓，公式会以源码的形状
  //        被抄进投影里，也就是"屏幕上好好的，投影上又变回 LaTeX"。
  //     ② 重画（repaintLog）会把 `#msgs` 整块 `innerHTML = ''` 重建，
  //        在那前后读到的 DOM 是两样东西。memo 不受这件事影响。
  //
  // 合并的规矩跟链子那一头是**同一套**（js/chips.js）：
  //   · 节号和名字 —— `SR.parseChain`
  //   · 每节三行   —— `SR.parseStepBody`
  //   两边都认 `第 N 节 · 名字` 那个头（同一个 RE_STEP），所以键能对上。
  function 建() {
    var 账 = {}, 序 = [], log = [], 计划 = 0;
    try { log = (SR.memo && SR.memo.log) ? SR.memo.log() : []; } catch (e) { log = []; }
    if (!log || !log.length) return { 节: [], 计划: 0 };

    for (var i = 0; i < log.length; i++) {
      var t = log[i];
      if (!t || t.r !== 'a' || !t.t) continue;          // 只看数根说的话
      var c = SR.parseChain ? SR.parseChain(t.t) : null;
      if (!c) continue;
      if (!计划 && c.planCount) 计划 = c.planCount;      // 计划只认第一次报的那个数

      for (var j = 0; j < c.steps.length; j++) {
        var s = c.steps[j];
        if (账[s.n]) continue;                          // 同一节在好几轮里出现过，只留第一处
        账[s.n] = { n: s.n, name: s.name, said: '', you: '', why: '' };
        序.push(账[s.n]);
      }

      var b = SR.parseStepBody ? SR.parseStepBody(t.t) : {};
      for (var k in b) {
        var 条 = 账[k];
        if (!条) continue;      // 有正文却没有节头——不该发生，宁可丢掉也不凭空长出一节
        var v = b[k] || {};
        // ★ **先到先得**：同一节的正文在后面的轮次里被复述时**不覆盖**它。
        //   模型后面复述常是压缩过的（"刚才那意思就是说…"），拿它盖掉等于
        //   把老师第一次听到的那段原话换成了摘要。空的那几栏才用后来说的补。
        if (!条.said && v.said) 条.said = v.said;
        if (!条.you && v.you) 条.you = v.you;
        if (!条.why && v.why) 条.why = v.why;
      }
    }

    序.sort(function (a, b) { return a.n - b.n; });
    return { 节: 序, 计划: 计划 };
  }

  // 有没有东西可放。给台阶条那颗按钮用的。
  function can() { return 建().节.length > 0; }

  // ============================================================
  //  ② 画一屏
  // ============================================================
  var 三行 = [
    ['said', '学生大概会说', 'p_said'],
    ['you', '你接这句', 'p_you'],
    ['why', '这么接的道理', 'p_why']
  ];

  // 现在这一节里**模型真写了**的那几块。没写的行不进这个串，也就**不进"亮"的计数**——
  // ★ "亮几块"必须数这个，不能数固定的 3：模型少写一行时，按到第三下才翻页，
  //   可屏幕上早没东西可亮了，老师会以为键盘出毛病了。
  function 有块() {
    var s = 节[页];
    if (!s) return [];
    var r = [];
    for (var i = 0; i < 三行.length; i++) {
      var v = String(s[三行[i][0]] || '').trim();
      if (v) r.push({ 名: 三行[i][1], 类: 三行[i][2], 文: v });
    }
    return r;
  }

  function 画() {
    if (!节.length) return;
    if (页 < 0) 页 = 0;
    if (页 > 节.length - 1) 页 = 节.length - 1;
    var s = 节[页];
    有 = 有块();
    // 这一节亮几块，从表里取（没记过就是 1 = 只亮第一块）。
    // ★ 钳位收在这儿一处：模型后来补写了行、或者表里那个数越了界，都从这儿兜住；
    //   钳完**写回表里**，别让表里存着一个越界的数等着下一次再钳。
    亮 = Math.max(1, Math.min(有.length, 亮表[s.n] || 1));
    亮表[s.n] = 亮;

    var num = $('projnum'), name = $('projname');
    if (num) num.textContent = '第 ' + s.n + ' 节' + (节.length > 1 ? ' / ' + 节.length : '');
    if (name) name.textContent = s.name || '';

    var body = $('projbody');
    if (body) {
      body.innerHTML = '';
      for (var i = 0; i < 有.length; i++) {
        var b = 有[i], 亮着 = i < 亮;
        var d = document.createElement('div');
        // ★ 还没亮的那一块**照样画出来**（画成一条虚线占位），只是内容不写。
        //   整块根本不画的话，按下这一下的那一刻三块的位置全变，投到教室就是屏幕跳一下。
        d.className = 'pblk ' + b.类 + (亮着 ? '' : (i === 亮 ? ' pwait pnext' : ' pwait'));
        var lb = document.createElement('span');
        lb.className = 'plabel';
        lb.textContent = b.名;
        d.appendChild(lb);
        if (亮着) {
          var tx = document.createElement('div');
          tx.className = 'ptext';
          // ★ 走 render.js 那条**总管线**（markdown → DOMPurify 净化 → 补裸 LaTeX → KaTeX），
          //   不自己拼 HTML。两条理由：模型吐的是不可信文本，必须过净化；
          //   而且公式在数学课上是主角，投影里冒出一行 `\frac{1}{2}` 比字小更难看。
          if (SR.render && SR.render.renderInto) SR.render.renderInto(tx, b.文);
          else tx.textContent = b.文;
          d.appendChild(tx);
        } else {
          var dz = document.createElement('div');
          dz.className = 'pdash';
          d.appendChild(dz);
        }
        body.appendChild(d);
      }
      // 模型没写全三行时**如实说**，绝不替它编满——
      // 这条规矩是从 SR.parseStepBody 那头抄过来的（"宁可空着，也不能长出模型没说过的话"）。
      if (有.length < 三行.length) {
        var n = document.createElement('p');
        n.className = 'pnote';
        n.textContent = '（上面缺的那几行，模型这一节没写。）';
        body.appendChild(n);
      }
    }

    var dots = $('projdots');
    if (dots) {
      dots.innerHTML = '';
      if (节.length > 1) {
        for (var k = 0; k < 节.length; k++) {
          (function (idx) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'pdot' + (idx === 页 ? ' now' : '');
            b.title = '第 ' + 节[idx].n + ' 节 · ' + (节[idx].name || '');
            b.addEventListener('click', function () { 落(idx); });
            dots.appendChild(b);
          })(k);
        }
      }
    }

    // 脚上两颗：**字跟着"这一下按出去会怎样"变**，老师不用猜是亮一块还是翻页。
    var pv = $('projprev'), nx = $('projnext'), 到头 = (亮 >= 有.length);
    if (pv) {
      pv.textContent = 亮 > 1 ? '◀ 收一块' : '◀ 上一节';
      pv.disabled = (页 === 0 && 亮 <= 1);
    }
    if (nx) {
      nx.textContent = 到头 ? '下一节 ▶' : '亮下一块 ▶';
      nx.disabled = (页 === 节.length - 1 && 到头);
    }
  }

  // 落到某一节上。★ **只有这一个地方改 `页`**（前进/后退翻节那两处也走这儿）——
  //   翻节的路有五六条（前后翻、进度点、Home/End、刚打开），散着写迟早漏掉一条，
  //   漏掉的那条会带着上一节的展开状态过去，屏幕上就是"新的一节一上来就全亮着"，
  //   而这正是这块屏要治的病。
  //   ★ 它**不动 `亮表`**：翻回去，那一节该亮几块还是几块（见头顶那段）。
  function 落(i) {
    页 = i;
    画();          // 越界和上下限的钳位都在 画() 里做，一处收口
  }

  // 往前一步：本节还有没亮的**先亮一块**；全亮了才翻下一节。
  function 前进() {
    if (!节.length) return;
    if (亮 < 有块().length) { 亮表[节[页].n] = 亮 + 1; 画(); return; }
    if (页 < 节.length - 1) 落(页 + 1);
  }

  // 往后一步：本节多亮出来的**先收一块**；只剩一块了才退上一节。
  // ★ 跟 前进() 严格对称（靠 `亮表`）：按错了按回来，落点跟原来**一模一样**。
  function 后退() {
    if (!节.length) return;
    if (亮 > 1) { 亮表[节[页].n] = 亮 - 1; 画(); return; }
    if (页 > 0) 落(页 - 1);
  }

  // ============================================================
  //  ③ 开合
  // ============================================================
  function open() {
    var box = $('proj');
    var d = 建();
    节 = d.节;
    if (!节.length) {
      if (window.console) console.info('数根：还没摆出链子，投影里没东西可放。');
      return;
    }
    if (!box) return;

    开 = true;
    // 抽屉先关掉：投影是整块盖住的，底下留一条抽屉只会在投屏上露出半块板。
    // ⚠ 走 SR.main 那个口子，**不自己写 data-drawer**——抽屉状态只有那一个真源
    //   （见 js/main.js 里 openDrawer/closeDrawer 那段注释）。
    try { if (SR.main && SR.main.closeDrawer) SR.main.closeDrawer(); } catch (e) {}

    box.setAttribute('data-proj', '1');
    box.setAttribute('aria-hidden', 'false');
    // 刚打开：**每一节都从"只亮第一块"起**。清表是这一格的用意所在——
    // 上一次投影亮到哪儿了，跟这一次没关系（中途你可能又让模型改过链子）。
    亮表 = {};
    落(0);
    // 焦点挪进来：Esc、左右键才有地方落。⚠ 退出时**要还回去**（见 close），
    // 不然老师退出投影之后想接着打字，字进不去。
    try { box.focus(); } catch (e) {}
  }

  function close() {
    var box = $('proj');
    开 = false;
    if (box) {
      box.setAttribute('data-proj', '0');
      box.setAttribute('aria-hidden', 'true');
    }
    // 把渲出来的公式清掉：下次进来重新渲一遍（对话可能又往前走了一节），
    // 也顺手把 KaTeX 那一堆节点放掉。
    var b = $('projbody');
    if (b) b.innerHTML = '';
    // 焦点还给输入框——退出投影之后下一件事多半是接着打字。
    var i = $('input');
    if (i) { try { i.focus(); } catch (e) {} }
  }

  function toggle() { if (开) close(); else open(); }
  function isOpen() { return 开; }

  // 对话又往前走了一节时，把**已经开着**的那一屏跟上（chat.js 的 renderSteps 每轮喊一次）。
  // ★ 关着的时候这就是一句 `return`，全站每个回合只多花一次布尔判断。
  // ★ 保住老师**现在停在的那一节**——按**节号**找回去，不按下标。新节是往后长的，
  //   下标通常不会漂；但万一模型倒回来补写了前面某一节的正文，节数组就变了，
  //   照下标复位会把老师正讲着的那一屏**自己翻页**，而屏幕上没有任何东西解释它为什么翻。
  function refresh() {
    if (!开) return;
    var 现在 = 节[页];
    var d = 建();
    if (!d.节.length) return;
    节 = d.节;
    if (现在 && typeof 现在.n === 'number') {
      for (var i = 0; i < 节.length; i++) { if (节[i].n === 现在.n) { 页 = i; break; } }
    }
    画();
  }

  // ============================================================
  //  ④ 键盘
  // ============================================================
  // 上课时老师手边只有键盘（或者一支翻页笔，那也是左右键/空格的形状），
  // 所以翻页必须走键盘，不能只有鼠标能点。
  // ★ 用**捕获阶段**挂（第三个参数 true）：这一层盖在页面上时，
  //   底下那些按键处理器（输入框、抽屉的 Esc）一个都不该先看到。
  // ★ 只在真的开着的时候拦（`if (!开) return`）——关着的时候这个监听器
  //   对全站的按键**一个字都不碰**，所以它跟别处的快捷键不会打架。
  function 按键(e) {
    if (!开) return;
    var k = e.key;
    if (k === 'Escape') { e.preventDefault(); close(); return; }
    if (k === 'ArrowLeft' || k === 'PageUp' || k === 'ArrowUp') { e.preventDefault(); 后退(); return; }
    if (k === 'ArrowRight' || k === 'PageDown' || k === 'ArrowDown' ||
      k === ' ' || k === 'Spacebar' || k === 'Enter') { e.preventDefault(); 前进(); return; }
    if (k === 'Home') { e.preventDefault(); 落(0); return; }
    if (k === 'End') { e.preventDefault(); 落(节.length - 1); return; }
  }

  function init() {
    var box = $('proj');
    if (!box) { if (window.console) console.warn('数根：少了 #proj，投影这一层装不上。'); return; }
    var x = $('projx'), pv = $('projprev'), nx = $('projnext');
    if (x) x.addEventListener('click', close);
    if (pv) pv.addEventListener('click', 后退);
    if (nx) nx.addEventListener('click', 前进);
    document.addEventListener('keydown', 按键, true);
  }

  return {
    init: init, open: open, close: close, toggle: toggle, refresh: refresh,
    can: can, isOpen: isOpen,
    // 给探针用的读数：这一份**不写任何状态**，就是"现在能放出几节"。
    __steps: function () { return 建().节; },
    // 同上，纯读数。★ 探针要量"亮了几块"，但**别只信这一个数**——
    //   它是产品自己报的账，得跟屏幕上真亮着的块数（`.pblk:not(.pwait)`）对上才算数。
    __view: function () { return { 页: 页, 亮: 亮, 有: 有.length, 节: 节.length, 开: 开, 表: 亮表 }; }
  };
})();
