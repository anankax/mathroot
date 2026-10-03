// 首屏：一个框，底下几块。
//
// 为什么要有这一层（孔老师 2026-10-02 的原话：「我想要一个简洁的工作台，最好就是一个搜索框。
// 但是它能把我需要的功能页面跳出来」）：
//   原来进来就是一格空输入框 + 左栏五颗按钮。「空框 + 几个名词」对新来的老师等于
//   **什么都得先猜**：这几颗按下去会给我什么？我这句话该往哪一颗里打？
//   现在把"这一句是几件里的哪一件"这件事**由我替他说出来**，而且说出来之后
//   那句话还在屏幕上（可一点改判）——猜错了看得见，改起来一下。
//
// ★ 这一层只做**归类**，一件事都不多做。它不碰提示词、不碰检索、不碰画板。
//   归完就交给原来那条路（SR.main.applyWork + SR.chat.submit），跟手点输入框底下
//   那一行工位走的是**同一条路**——所以"首屏"坏掉的时候，工位那条路一个字都不受影响。
//
// ★ 块数是**照 SR.WORK_ORDER 现数**的（paintBlocks），这份文件里不写死几块：
//   数写死了，加一格工位这儿不会红，只是首屏悄悄少一块。
//   2026-10-03 前一版这里写的是"五块"——「学情」加进来那天它就是错的了。
//
// ★★ 三条不能破的底线（都是他定的）：
//   ① **归类要看得见、并且一下能改**——判成哪一件，得有一行字明说；
//   ② **不像就不像**——哪一件都对不上时直接说"这不像几件里的哪一件"，不许硬塞一件进去。
//      （这正是「数小问」那个缺陷家族反复发作的形状：要它做一件事却没给它那一档，
//        它就自己编一档。这儿是同一个位置，宁可多问一句。）
//   ③ **工位那一行永远能直接跳过去**——首屏是个入口，不是一道闸。
//
// ★ 红验：test/probe_landing.cjs。route() 是纯函数（只吃一段字，不碰 DOM），
//   所以那条探针能在 node 里把真文件原样装进来跑，不用开浏览器。
var SR = (window.SR = window.SR || {});

SR.landing = (function () {

  // ★★ 2026-10-03 孔老师定的这一句：「要做什么？」
  //   之前写的是「今天要办哪一件？」——那是**我**留的占位（注释里写着"他还没定过"），
  //   一直没拿掉。模拟稿里那句是「告诉我你的问题。」，他看了两个候选，给了这第三个。
  //   ⚠ 这儿现在是**唯一真源**。原来 index.html 里还抄了一份（开机前那一眼显示用的），
  //     init() 的 `els.q.textContent = BQ` 会把它盖掉——两处不一样屏幕会跳一下。
  //     2026-10-03 首屏改成"#msgs 里第一条消息"之后那份**删了**：那条消息是 JS
  //     现建的，开机前根本没有它可显示（首屏那一下由 css 的 `.ghost` 顶着）。
  var BQ = '要做什么？';
  // ★ 六块底下那句。原来它写死在 index.html 的 `<p class="ltip">` 里——那份删掉之后
  //   真源搬这儿来（跟 BQ 一样：写死两处，改一处屏幕就会不一致）。
  //   "也可以"这三个字是**要紧的**：它说的是"这六块不是必须走的流程"，
  //   直接打字一样能办（底线③：首屏是个入口，不是一道闸）。
  var TIP = '也可以直接打一句话——说清要干什么，我看是哪一件。';

  var live = false;      // 首屏亮着吗
  var picked = 0;        // 他自己点过工位了吗——点过就不再拦（底线③）
  var held = '';         // "我不确定"那会儿他刚打的那句话，原样存着，点一件就用它
  var heldOn = false;    // 手上有没有一份"待办"（一句话或一份附件）——决定点一块是"办"还是"跳"
  // ★ 已经替老师认过的那一句（归类那一趟的发出去的那句）。
  //   为什么还要单独存一份：**归得出来**的时候那句话并没有存在 held 里——
  //   它是照原样发出去的，发完 chat.js 的框就清了。等他回过头来点「换一件」，
  //   held 是空的，而跨体系那一趟 applyWork → reset() 会把历史一起抹掉，
  //   于是**那句话就真没了**，换过去是一件空活。探针 ⑨ 就是盯这个的。
  var lastSent = '';
  var els = {};

  // ============================================================
  //  一、认得出来的话
  // ============================================================
  // ★ 这些词一条都不是凭空编的，来源就三处：
  //   ① 工位自己的名字（组卷／作图／备课／命题／学情／讲评，见 config.js 的 SR.WORKS）；
  //   ② 各工位**已经写好**的开场白和输入框提示（chat.js 的 OPENING / TIP）——
  //      比如「说说出什么，例如 第五周 一元一次方程 周练卷」里的"周练"，
  //      「把卷子发过来，我先列一遍题」里的"列一遍题"，
  //      「贴一道题，或者写一个课题」里的"课题"；
  //   ③ 老师真会打的短句（"这节课怎么讲" / "把错的挑出来讲"）。
  //   w=4 是"一出现基本就能认"；w=1 是"得跟别的话一起撑着才算"。
  //
  // ⚠ 改这张表之前先跑 test/probe_landing.cjs——里面那几十句是照着**上面三处原文**
  //   抄下来的，改表改到哪一句翻车，探针会当场说出来是哪一句。
  var WORDS = {
    material: [
      ['组卷', 4], ['出卷', 4], ['周练', 4], ['周考', 4], ['月考', 4], ['单元卷', 4], ['答题卡', 4],
      // ★ 「期中／期末」只给 2，不给 4：它们**是时段名，不是工件名**——
      //   "期中卷"是组卷的活，可"期末复习课怎么上"是备课的活，两句话里都有这两个字。
      //   给 4 的话后一句会被判成组卷（实测：prep 5 分、material 4 分，咬得只剩 1 分差），
      //   给 2 就让动词（"出/组"对"怎么上"）说了算。
      ['期中', 2], ['期末', 2],
      ['单元测试', 3], ['出一份', 3], ['出一套', 3], ['编一份', 3],
      ['几道题', 2], ['多少道', 2], ['分值', 2], ['满分', 2], ['题量', 2], ['印出来', 2],
      // ★ 「卷子／试卷／考卷」给 2，**两边都给**（下面 review 里同样三条）：
      //   "一张卷子"这两件都收——出卷是造一张，讲评是拆一张。给它俩同分就是让它俩**抵消**，
      //   "是造还是拆"交给动词去定（"出一份…卷" 对 "把…卷发过来讲评"）。
      //   只给 material 的话，「把卷子发过来」会被判成"出材料"，那是把讲评抢走了。
      ['卷子', 2], ['试卷', 2], ['考卷', 2],
      ['模板', 1], ['打印', 1], ['排版', 1], ['难度', 1]
    ],
    draw: [
      ['画一个', 4], ['画个', 4], ['画一下', 4], ['帮我画', 4], ['画一张', 4], ['画出来', 4],
      ['作图', 4], ['数轴', 4], ['函数图', 4], ['描点', 4],
      ['抛物线', 3], ['坐标系', 3], ['示意图', 3], ['几何图形', 3], ['图像', 3],
      ['画', 2], ['图形', 2], ['三角形', 1], ['圆', 1]
    ],
    prep: [
      ['怎么讲', 4], ['怎么上', 4], ['怎么引入', 4], ['备课', 4], ['教学设计', 4], ['教案', 4],
      ['学生怎么答', 4], ['这节课', 3], ['这一课', 3], ['导入', 3], ['引入', 3], ['板书', 3],
      ['追问', 3], ['重难点', 3], ['讲清', 3], ['过渡', 2], ['例题', 2], ['学生', 1], ['课', 1]
    ],
    vary: [
      // ★ 头两条是**按钮上那个名字本身**（config.js 里 label:'命题'）。
      //   ⚠ 这两条是 test/probe_landing.cjs 逼出来的：原来这一串全是"变式/换个数"
      //     这类动词，一个都没有是"命题"本身的——于是**把那颗按钮的名字打到框里，
      //     它认不出来**，五件里唯一一件进不去的。⑤ 里有两条专门盯着这个：
      //     每件的名字打进去都得回得来、且不许算到别人头上。
      ['命题', 4], ['出题', 4],
      ['变式', 4], ['变一变', 4], ['变一下', 4], ['改个数', 4], ['换个条件', 4], ['换个数', 4],
      ['改编', 4], ['举一反三', 4], ['再出几道', 3], ['同类型', 3], ['类似的题', 3],
      ['难一点', 3], ['加难', 3], ['改一改', 3], ['拓展', 2]
    ],
    // ★ 2026-10-03 新加的这一格。「学情」两个字的**名字本身**必须在这儿（['学情',4]），
    //   否则 test/probe_landing.cjs ④ 那条"每一件的名字打进去都回得来"会当场红——
    //   名字进不去 = 这一格在首屏上永远点不到。跟当初给 vary 补 ['命题',4] 同一个理由。
    grade: [
      ['学情', 4], ['成绩表', 4], ['成绩单', 4], ['智学网', 4],
      ['及格率', 4], ['优秀率', 4], ['分数段', 4], ['平均分', 4],
      ['先讲哪', 4], ['哪个班', 4], ['两个班', 4], ['哪个题', 3],
      ['排名', 3], ['成绩', 3],
      ['从低到高', 4], ['排个序', 3],
      // ★ 「得分率」review 那边是 4，这儿**也必须给 4**。这一条是量出来的，不是想出来的：
      //   第一版给的是 3，跑出来 "得分率排一排" 从"讲评"掉成了**该问**
      //   （review 4 对 grade 3，差 1 分不够 BAR/LEAD）——那正是这个仓库最怕的形状：
      //   老师嘴里说的明明是学情的活，屏幕上却回他"这不像哪一件"。
      //   两边同分（4 对 4）之后：
      //     "得分率"          → 顶两名同分 → **该问**，屏幕上说「【学情】和【讲评】都像」
      //                         （这一条**改了原来的行为**：以前它一声不响地判成讲评。
      //                          改成问一句是对的——光说这三个字，本来就两件都像。）
      //     "得分率从低到高排" → grade 8 对 review 4 → **学情**
      //     "得分率排一排"     → 4 对 4 → 该问（同上）
      ['得分率', 4]
      // ★ 「这次考试」「均分」「班级」**不往这儿加**——理由说清楚，免得下次有人照"同类词"
      //   搬过来：不是怕抢。实测把这三条一起塞进上面这串，test/probe_landing.cjs
      //   **47 条一条都不红**（那份探针里那 9 句真题／6 句该问的正是盯这个的）。
      //   不加的理由是**没有分给它的理由**：这三个词讲评那边本来就用得好
      //   （「讲评一下这次考试」review 拿 7 分，靠的是'讲评'4 分撑着，不是这三个字）；
      //   而 grade 要的是**排序**这件事——'排''先讲哪''得分率'才是它的话头。
      //   ⚠ 真要加，先跑探针再说：同分时 grade 排在 review **前面**（见 rankedOf
      //     与 SR.WORK_ORDER），一时看不出来，可"看着正常"正是这一仓库最老的病。
    ],
    review: [
      ['讲评', 4], ['错因', 4], ['失分', 4], ['丢分', 4], ['得分率', 4], ['卷面分析', 4],
      ['阅卷', 4], ['批改', 4], ['做错', 4], ['考情', 4], ['列一遍题', 4],
      ['错了', 3], ['订正', 3], ['均分', 3], ['这次考试', 3], ['考得', 3],
      ['卷子', 2], ['试卷', 2], ['考卷', 2],     // ← 跟 material 那三条同分，故意抵消
      ['分数', 2], ['拍照', 2], ['照片', 2], ['班级', 1]
    ]
  };

  // ---- 话头之外的三个"形状"判据 ----
  var CHAP = /\d+\.\d+/;                                  // 3.1 / 2.4
  var CHAP2 = /第\s*[一二三四五六七八九十\d]+\s*[章节]/;   // 第 3 节 / 第三章
  var BOOK = /[七八九]\s*[上下]/;                          // 七上 / 八下
  // 题干上才有的东西：如图、已知、求证、求…、（1）、∠、△、＝
  var PROB = /如图|已知|求证|求[解证值]|∠|△|[（(]\s*[12]\s*[）)]|＝|≠/;

  var BAR = 4;    // 头名至少这么多分，才敢自动办
  var LEAD = 2;   // 而且得甩开第二名这么多——咬得紧就问，不硬猜

  function hits(t, w) {
    var list = WORDS[w] || [], s = 0;
    for (var i = 0; i < list.length; i++) if (t.indexOf(list[i][0]) >= 0) s += list[i][1];
    return s;
  }

  function score(t) {
    var sc = {};
    for (var i = 0; i < SR.WORK_ORDER.length; i++) sc[SR.WORK_ORDER[i]] = hits(t, SR.WORK_ORDER[i]);
    return sc;
  }

  // 排序：分数高的在前；同分照左栏的顺序（**不能靠 Array.sort 的稳定性去碰运气**，
  // 显式带上次序，探针才复现得了）。
  function rankedOf(sc) {
    return SR.WORK_ORDER.slice().sort(function (a, b) {
      if (sc[b] !== sc[a]) return sc[b] - sc[a];
      return SR.WORK_ORDER.indexOf(a) - SR.WORK_ORDER.indexOf(b);
    });
  }

  function likeTopic(t) { return t.length <= 24 && (CHAP.test(t) || CHAP2.test(t) || BOOK.test(t)); }
  function likeProblem(t) { return PROB.test(t) || (t.length > 40 && /\d/.test(t)); }
  // ★ 原本这儿还有第三条「一个短名字、什么动词都没有 ⇒ 当课题（备课）」。
  //   **2026-10-02 砍掉了**，理由值得写下来：它按长度放行，于是「你好」「在吗」
  //   也满足条件，会被判成备课、**当场发出去当课题问**——那是把一句打招呼
  //   变成一条提示词里的正式提问，比多问一句坏得多。
  //   现在光一个课题名（没带章节号的，比如「一元一次方程」）走"对不上"那一档，
  //   屏幕上会请老师点一件，**他刚打的那句话留着**——就一下，而且他知道发生了什么。
  //   ⚠ 想加回来之前先看 test/probe_landing.cjs 里那条「打招呼不许被归类」。

  // ---- 归类：纯函数，只吃一段字 ----
  // 回 {work, sure, why, ranked, score}
  //   work='' 表示"哪一件都对不上"，调用方该去问，**不许自己挑一件**。
  //   sure=1 话头明确；sure=0 是靠形状认的（strip 上会说得客气一点）。
  function route(text) {
    var t = String(text == null ? '' : text).trim();
    var sc = score(t);
    var rank = rankedOf(sc);
    var top = sc[rank[0]] || 0, second = sc[rank[1]] || 0;

    if (top >= BAR) {
      if (top - second >= LEAD) return { work: rank[0], sure: 1, why: '话头', ranked: rank, score: top };
      // 咬得紧：两件都像。★ 这里**必须回空**——随手挑头名的话，"两件都像"和"一件明显像"
      // 在屏幕上长得一模一样，老师只会觉得"它偶尔判得怪"，不会知道该改。
      return { work: '', sure: 0, why: 'ambiguous', ranked: rank, score: top };
    }
    // 一个工位的话头都没够着，再看形状
    if (likeTopic(t)) return { work: 'prep', sure: 0, why: '像课题', ranked: rank, score: top };
    if (likeProblem(t)) return { work: 'prep', sure: 0, why: '像一道题', ranked: rank, score: top };
    return { work: '', sure: 0, why: '', ranked: rank, score: top };
  }

  // ============================================================
  //  二、界面
  // ============================================================
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // 首屏那几块。★ 名字和那句小字**都从 SR.WORKS 现取**——不写死在这份文件里。
  //   理由跟"名字在 config／左栏／关于三处同源"是同一个：写死了就有第二个真源，
  //   哪天改了 config，首屏还挂着旧名字，而且**它看起来是好的**。
  function paintBlocks(mark) {
    var box = els.blocks;
    if (!box) return;
    var html = '';
    for (var i = 0; i < SR.WORK_ORDER.length; i++) {
      var w = SR.WORK_ORDER[i], o = SR.WORKS[w] || {};
      var tip = mark && mark.indexOf(w) >= 0 ? '<em>最像这个</em>' : '';
      html += '<button type="button" class="lblock" data-work="' + esc(w) + '">'
            +   '<b>' + esc(o.label || w) + '</b>'
            +   '<i>' + esc(o.badge || '') + '</i>'
            +   tip
            + '</button>';
    }
    box.innerHTML = html;
  }

  function focusBlock(w) {
    if (!els.blocks) return;
    var bs = els.blocks.querySelectorAll('.lblock');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-work') === w);
  }

  function say(q, tip) {
    if (els.q) els.q.textContent = q;
    if (els.tip) els.tip.innerHTML = tip;
  }

  // "不确定"那一屏。★ 它**不换掉五块**，只在上面多说两句话、把最像的一两块标出来——
  //   换成另一套界面的话，老师会以为走错了地方。
  function askState(r) {
    var rank = r.ranked || SR.WORK_ORDER;
    var mark = [];
    if (r.why === 'ambiguous') {
      mark = [rank[0], rank[1]];
      say('这一句，' + lbl(mark[0]) + '和' + lbl(mark[1]) + '都像。',
          '点一件，我就按那一件办——你刚才那句话我留着。');
    } else {
      var tail = held ? '——你刚才那句话我留着。' : (heldOn ? '——你发的东西我留着。' : '。');
      // ★ 这句里**不写死件数**：写死了加一格工位它不会红，只会在屏幕上少说一件
      //   （2026-10-03 之前这儿写的就是"五件里的哪一件"）。
      say('这不像底下这几件里的哪一件。', '你点一件，我就按那一件办' + tail);
    }
    paintBlocks(mark);
  }

  function lbl(w) { return '【' + ((SR.WORKS[w] && SR.WORKS[w].label) || w) + '】'; }

  // ---- 首屏是 #msgs 里的**第一条助手消息**（2026-10-03 改）----
  //
  // 原来它是 .col 里一个独立的 `#landing` 块，靠
  //   `body[data-landing="1"] #msgs{display:none}`（旧 css:769）
  // 把整个对话栏藏住来"让位"。那一藏就是 D1：**刷新回来，上一场对话明明
  // 由 memo 接回来了、DOM 里也在、copybar 也挂好了，却被这条规则整块藏住，
  // 老师一个字都看不见，会以为对话丢了。**
  //
  // 改成第一条消息之后，藏就不需要了——首屏和对话本来就该在同一列里，
  // 首屏收起来只是它自己往下让，不是把整栏遮上。
  // 「刷新回来不出现」这件事也不再靠 CSS，而是 init() 里**根本不建**（见那儿）。
  function mountFirstMessage(box) {
    var m = document.createElement('div');
    m.className = 'msg assistant landing';
    var b = document.createElement('div');
    b.className = 'bubble';
    var q = document.createElement('p'); q.className = 'lq'; q.id = 'lq';
    var bl = document.createElement('div'); bl.className = 'lblocks'; bl.id = 'lblocks';
    var tp = document.createElement('p'); tp.className = 'ltip'; tp.id = 'ltip';
    tp.textContent = TIP;
    b.appendChild(q); b.appendChild(bl); b.appendChild(tp);
    m.appendChild(b);
    box.insertBefore(m, box.firstChild);
    return m;
  }

  // 那一列里那几块卡片的点击（★ 每次重建新节点都要重绑——监听是挂在**节点**上的，
  //   不是挂在模块上的；老节点被抽走时它的监听跟着走，不会有第二份）。
  function wireBlocks() {
    if (!els.blocks) return;
    els.blocks.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.lblock') : null;
      if (!b) return;
      var w = b.getAttribute('data-work');
      // ★ 在"不确定"那一屏上点一块 = 用他刚打的那句话办（held）——这就是他要的
      //   "一下就能改"。手上没东西（比如只是进来点一下）就单纯跳过去。
      if (heldOn) rework(w);
      else pick(w);
    });
  }

  // 确保首屏那条消息**在 #msgs 里、且在最前面**。已经是了就不重做。
  // ★ 要能重复调：探针用 `SR.landing.show()` 摆回"刚进来、首屏亮着"那一屏
  //   （test/probe_landing_send.cjs 就是这么回收现场的），所以 show() 不能只是
  //   翻一个标志位，它得真把那条消息摆回来。
  function ensureMount() {
    var mbox = $('msgs');
    if (!mbox) return;
    if (els.box && els.box.parentNode === mbox) {
      // 在是在，但可能在中间（重画会把对话整个重建，这条得重新占回第一位——
      // 它是"这一栏从哪儿开始"，不是一条可以插在中间的回复）。
      if (mbox.firstChild !== els.box) mbox.insertBefore(els.box, mbox.firstChild);
      return;
    }
    els.box = mountFirstMessage(mbox);
    els.q = $('lq'); els.tip = $('ltip'); els.blocks = $('lblocks');
    if (els.q) els.q.textContent = BQ;
    paintBlocks([]);
    // 上次用的那一件，先轻轻标出来——省掉"我上次是干哪件来着"这一下。
    var last = (SR.chat && SR.chat.getWork && SR.chat.getWork()) || '';
    if (last) focusBlock(last);
    wireBlocks();
  }

  function show() {
    live = true;
    document.body.setAttribute('data-landing', '1');
    ensureMount();
    // ★ 2026-10-03：首屏一亮，画板抽屉就得关上。原来这件事是 css 里
    //   `body[data-landing="1"] .side{display:none}` 顺手办的——`.side` 撤了之后
    //   那条规则也没了，于是抽屉（z-index 30）会盖在首屏上。显式关一次。
    if (SR.main && SR.main.closeDrawer) SR.main.closeDrawer();
  }
  function hide() {
    live = false;
    document.body.removeAttribute('data-landing');
    // ★ 收起 = **整条抽走**，不是折叠留半句。
    //   留半句（比如只留「要做什么？」当问候）当场和刷新后会长得不一样：
    //   刷新回来时这一条根本不建（见 init），于是那句问候只在这一条路上有。
    //   同一个事实两处各算一遍，屏幕给的答案就会不一致——这个仓库最老的病。
    if (els.box && els.box.parentNode) els.box.parentNode.removeChild(els.box);
    els.box = els.q = els.tip = els.blocks = null;
  }
  function blocking() {
    if (!live) return false;
    if (picked) return false;
    // ★ 这一场已经开说了就不再拦第二句。「这句话是哪一件」是**第一句话**的问题；
    //   第二句往往是「接着往下」「换个数」，那时候归类比不归更烦人，
    //   而且工位早就定了（左栏亮着的那一颗就是）。
    if (SR.chat && SR.chat.hasUser && SR.chat.hasUser()) return false;
    return true;
  }

  // ============================================================
  //  三、归完那一行（"我按【备课】办的"）
  // ============================================================
  function strip(w, sure, why) {
    var bar = els.bar;
    if (!bar) return;
    var soft = sure ? '' : '<span class="soft">（照' + esc(why || '形状') + '认的）</span>';
    bar.innerHTML = '<span class="rt">我按 ' + esc(lbl(w)) + ' 办的</span>' + soft
                  + '<button type="button" class="rchg" id="routechg">换一件</button>'
                  + '<span class="rpick" id="routepick" hidden></span>';
    bar.hidden = false;
    var chg = $('routechg'), pick = $('routepick');
    if (chg) chg.addEventListener('click', function () {
      // 展开成五颗小按钮。★ 文案上说清"换一件=重开一段"：换的若是另一套体系，
      //   上面那半截对话会被清掉（见 main.js applyWork 那条清空规则），
      //   不先说清的话，老师会以为是"把这句话转给另一件"，回头找不到刚才那段。
      var ok = sameSystem(w, SR.chat.getWork());
      chg.hidden = true;
      pick.hidden = false;
      pick.innerHTML = '<span class="rnote">'
        + (ok ? '换过去，这段对话留着。' : '换一件会重开一段——这句话我照样带过去，上面那半截不留。')
        + '</span>' + SR.WORK_ORDER.map(function (x) {
            return '<button type="button" class="rmini' + (x === SR.chat.getWork() ? ' cur' : '')
                 + '" data-work="' + esc(x) + '">' + esc((SR.WORKS[x] && SR.WORKS[x].label) || x) + '</button>';
          }).join('');
      pick.querySelectorAll('.rmini').forEach(function (b) {
        b.addEventListener('click', function () { rework(b.getAttribute('data-work')); });
      });
    });
  }
  // 备课↔讲评是同一份提示词、同一条链的两个阶段（main.js 那条清空规则就是这么定的）
  function sameSystem(a, b) {
    return !!(SR.WORKS[a] && SR.WORKS[b] && SR.WORKS[a].steps && SR.WORKS[b].steps);
  }
  function clearStrip() { if (els.bar) { els.bar.hidden = true; els.bar.innerHTML = ''; } }

  // ============================================================
  //  四、接线
  // ============================================================
  function pick(w, quiet) {
    if (!SR.WORKS[w]) return;
    picked = 1;
    hide();
    held = ''; heldOn = false;
    if (!quiet) clearStrip();
    if (SR.main && SR.main.applyWork) SR.main.applyWork(w);
    var t = $('input');
    if (t) t.focus();
  }

  // 换一件：同一句话，换一件重办
  // ★ 附件不用在这儿搬回来：`pendingParts` 是 chat.js 的**模块级变量**，
  //   applyWork 里那条 reset() 只清气泡和 chips，**不动它**——所以换过去之后
  //   那份附件还在框上挂着，这儿一个字都不用管。（搬一遍反而会变成两份。）
  function rework(w) {
    if (!SR.WORKS[w]) return;
    var was = SR.chat.getWork();
    var keep = sameSystem(w, was);
    var text = held || lastSent;    // 见 lastSent 那条注释：归得出来那趟存在这儿
    var more = !!(SR.chat.hasPendingImage && SR.chat.hasPendingImage());
    picked = 1;
    hide();
    clearStrip();
    held = ''; heldOn = false;
    if (SR.main && SR.main.applyWork) SR.main.applyWork(w);
    // 同体系（备课↔讲评）：历史留着，那半句还在屏幕上，重发就变成问两遍了
    if (keep) return;
    if (!text && !more) return;
    // ★ 把盒子清干净再送：submit 收到 forced 时**不会**自己清（它以为字是框里来的）。
    //   派一次 input 事件是为了让 chat.js 的 autoGrow 把框高收回去——
    //   直接改 value 的话，框还维持着刚才那个高度，底下空一截。
    clearBox();
    SR.chat.submit(text);
  }

  function clearBox() {
    var t = $('input');
    if (!t) return;
    t.value = '';
    try { t.dispatchEvent(new Event('input')); } catch (e) {}
  }

  // chat.js 的 submit() 一进来先问这个。
  // ★ 回值的两种意思，别弄反：
  //     true  = **这一句我接走了**，submit 那边一个字都别做（我去问他/我去排队）；
  //     false = **放行**，submit 照原样把这句话发出去——归类那一趟我可能已经办完了
  //             （工位替他按好、那一行"我按【X】办的"也写上去了），但话得照发。
  //   ⚠ 归好类那条路**必须回 false**：要是在这儿回 true，等于把老师那句话吞掉，
  //     屏幕上只剩下一行"我按【备课】办的"，一件事没办——而且看着像"发出去了"。
  // ★ 它**必须**放在 SR.api.ready() 那道闸后面（见 chat.js submit 里的位置）：
  //   没配 Key 的时候该弹的是 Key 层，不是先替他归个类。
  function intercept() {
    if (!blocking()) return false;
    var t = $('input');
    var text = t ? String(t.value || '').trim() : '';
    var hasParts = !!(SR.chat && SR.chat.hasPendingImage && SR.chat.hasPendingImage());

    if (!text && hasParts) {
      // 只发了文件、一个字没打：**不猜**。一张照片是"卷子"还是"一道题"，
      // 从这儿看不出来（文件名不可靠），猜错了等于把它送进错的提示词。
      held = ''; heldOn = true;
      askState({ why: '', ranked: SR.WORK_ORDER, score: 0 });
      return true;
    }
    if (!text) return false;

    var r = route(text);
    if (!r.work) {
      held = text; heldOn = true;
      askState(r);
      return true;
    }
    pick(r.work, true);
    lastSent = text;                    // 留着，万一他回头点「换一件」
    strip(r.work, r.sure, r.why);
    return false;                       // 放行——这一句照样发，只是工位已经按好了
  }

  function init() {
    els.bar = $('routebar');
    if (!$('msgs')) return;               // 这一页没放对话栏（比如老页面）就整层不生效
    // ⟳ 清空重开：那一行"我按【X】办的"跟着这场对话一起走
    var nb = $('newbtn');
    if (nb) nb.addEventListener('click', clearStrip);
    // ★★ 刷新回来**且这一栏已经有东西**：首屏不出现。
    //   「要做什么？」问的是"这一栏还没开始的时候走哪一件"；已经有对话了，
    //   这个问题已经问过、也答过了。硬要显示它，就得反过来把对话藏住——
    //   而"把对话藏住"正是 D1：老师刷新后一个字都看不见，以为对话丢了。
    //   ★ 不靠 CSS 藏、靠这儿根本**不建**：没有那条消息，也就没有要藏的东西。
    //   ⚠ 判据用 memo 的**条数**（不是 hasUser）——上一场可能只有开场白没说过话，
    //     那也已经是"开始了"，不该再拿首屏盖上去。
    if (SR.memo && SR.memo.log && SR.memo.log().length) { live = false; return; }
    show();
  }

  return {
    LIVE: 1,
    init: init,
    route: route,          // 纯函数，探针直接调这个
    score: score,
    blocking: blocking,
    intercept: intercept,  // chat.js submit() 顶上那一句
    show: show, hide: hide,
    ask: askState,
    strip: strip, clearStrip: clearStrip,
    pick: pick, rework: rework,
    BLOCKS: function () { return SR.WORK_ORDER.slice(); },
    HEAD: BQ
  };
})();
