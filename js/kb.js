// 知识库：两份语料的按需装载口，外加一处早就该补的召回修正。
//
// 语料是哪两份：
//   ① 教材索引   js/textbook.js  —— 苏科版四册的章节脉络，含 78 处【书上原话】
//   ② 追问条目库 js/zhuawen.js   —— 六册 118 条，按"学生说到哪儿了"分五档的追问问法
//
// ★★ 两份的**公开性不一样**，代码上也分开走，别当成一对：
//   · js/zhuawen.js 是孔老师**自己写**的，公开站上放得下。
//   · js/textbook.js 里是**课本定义和法则的原文**。按 .gitignore 里那条判据——
//     "就算界面上不显示，文件本身也已经发出去了"——它一进仓库就等于公开了。
//     所以它**不进仓库**：只在孔老师**本机**跑起来的页面上加载；公开站上
//     连这一次请求都不发（见下面的 local()），控制台里不会多一行 404。
//     本机拿不到（比如他还没跑过生成脚本）就退回"没检索到"那一档，
//     跟这个模块加进来之前一模一样——**永远不许挡住对话**。
//
// 两份加起来 117 KB。原来它们挂在 index.html 的 <script defer> 上，
//   **首屏就得下载、得解析**——可它们真正派上用场，是学生在输入框里敲下第一句话、
//   点发送的那一刻。中间这段时间纯属白等。所以挪到这儿：第一次真要检索了才去拿。
//
// ★ 为什么**不**按册拆成 kb-7a…kb-9b：
//   检索器是 BM25（见 js/retrieve.js），打分要拿**整个语料**算 idf——
//   只装七上那一册，df/N 就只统计了七上，跨册同名知识点的排序会歪。
//   而且学生的册别在话里根本看不出来（"这题我不会"没说是几年级），拆了也无从选择。
//   所以拆册只添复杂度，不换命中率。真要省流量，省在"首屏→第一次提问"这一步就够了。
//
// ★ 这个模块**永远不许挡住对话**。拿不到就拿不到：buildSystem 那边照旧走
//   "没检索到"那一档，跟加这个模块之前一模一样。所以 load() 出错也照样回调，
//   并且有 KEEPALIVE 兜底——网慢或者文件被谁删了，最多等这么久就放行。
var SR = (window.SR = window.SR || {});

SR.kb = (function () {

  // 要加新语料，就在这里添一行。要求：正文格式必须是 "### 标题\n正文"
  // （js/retrieve.js 的 splitEntries 按这个切）。
  // 比如将来那批"给学生巩固用的同类题"，定好格式之后加：
  //   { key: 'TIMU', src: 'js/kb-timu.js', what: '同类题' }
  // ★ 别先添一行指向还不存在的文件——那会在控制台留一条 404，看着像本站坏了。
  // ★ localOnly: true = **只在本机加载**，公开站上连请求都不发（见 local()）。
  //   加这一条是因为教材索引是课本原文，不进仓库；另见本文件顶上那段。
  var FILES = [
    { key: 'TEXTBOOK', src: 'js/textbook.js', what: '教材索引',   localOnly: true },
    { key: 'ZHUAWEN',  src: 'js/zhuawen.js',  what: '追问条目库' }
  ];

  // 等这么久还没齐就放行——宁可这一轮没有库，不能让学生干等。
  // ★ 取 2 秒是有取舍的：GitHub Pages 是 CDN，两份语料压过之后几十 KB，
  //   正常网络一两百毫秒就下来了；2 秒是给慢网留的余量，不是常态。
  // ★ 也**没有**在页面空闲时预热（requestIdleCallback 那种）：
  //   预热能把这 200ms 藏进空档里，看着更划算，但它会让"首屏到底有没有语料"
  //   变成一个看时机的答案——而本机是唯一测得出来延迟装载有没有生效的地方，
  //   量不出来就等于没有。这条 2 秒的取舍，换的是量具还在。
  var KEEPALIVE = 2000;

  // ============================================================
  //  两条分数线：低于它就不给。★ 数值是量出来的，不是拍的
  // ============================================================
  // 起因：本机「知识库」面板第一次打开就露了馅——学生说"这道题我不会，我算到一半就卡住了"，
  // 一个字的知识点都没有，却也召回了「图形的变换·旋转(7.9)」「因式分解(4.9)」，
  // 全都过了原来那条 score < 3 的线。**13 句泛泛的学生话里有 11 句都漏了进去。**
  //
  // 于是把两拨话放在一起量（test/probe_kb_scores.cjs，13 句点着知识点名的 + 13 句泛泛的）：
  //   条目库：该召回 13.3~57.5（"我不会画数轴""增长率""分式方程"这些**学生真会打的短话**也算了），
  //           不该召回 0~7.9。线取 10 时：13 句真话进 12 句，13 句废话进 0 句。
  //   教材索引：该召回 8.0~28.3（"我不会画数轴"那条 5.5 是唯一低于 6 的），
  //           不该召回 0~4.4。线取 6 时：真话进 12 句，废话进 0 句。
  //
  // ★ 为什么条目库是 10 而不是刚好卡住 7.9 的 8：
  //   因为 queryFor 会把前几轮的话拼进来，而 BM25 是**累加**的——
  //   检索词越长，勉强撞上的机会越多。实测一个从头到尾只会说废话的学生，
  //   攒到第 5 轮时首条分数从 7.9 涨到 **8.1**。定 8 的话，那一轮就漏进去了。
  //   往上的余量也是量过的：真话里最低的一条是 13.3，所以 10 两头都留得下。
  //
  // ★ 这条线宁可偏高。代价不对称：**给错了**是往 system 里塞一条八竿子打不着的
  //   条目，模型会顺着它跑偏；**没给**就退回加知识库之前那一档，本来就是这个系统的默认样子。
  var CUT = { zhuawen: 10, textbook: 6 };

  // ★ 只有**本机**才去拿 js/textbook.js——课本原文不进仓库，公开站上它根本不存在。
  //   判法照抄 js/resources.js 的 local()：公开站上**连这一次请求都不发**，
  //   控制台里不会多一行 404（本文件顶上那句"别让 FILES 指向不存在的文件"是同一个道理）。
  //   判据全用 location，不依赖任何构建期的开关——本机和公开站跑的是同一份代码。
  function local() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || location.protocol === 'file:';
  }

  var tried = false;
  var wakers = [];

  // 这一台机器上**该拿**的语料。公开站上"该拿的"只有追问条目库那一份。
  function applicable() {
    var out = [];
    for (var i = 0; i < FILES.length; i++) if (!FILES[i].localOnly || local()) out.push(FILES[i]);
    return out;
  }

  // 已经拿到了几份。★ 每次都现读 window.SR，不缓存——
  //   兜底放行之后脚本才姗姗来迟的话，下一轮问它，答案就该是"到了"。
  function got() {
    var out = [], want = applicable();
    for (var i = 0; i < want.length; i++) if (window.SR[want[i].key]) out.push(want[i].key);
    return out;
  }
  function has() { return got().length === applicable().length; }

  function flush() {
    var ws = wakers; wakers = [];
    for (var i = 0; i < ws.length; i++) ws[i](has());
  }

  // 按需加载。幂等；并发调用合并成一次；出错不抛，回 false。
  function load(cb) {
    if (cb) wakers.push(cb);
    if (tried) { flush(); return; }        // 试过了，立刻按**现在**的状态回话
    tried = true;
    var want = applicable();
    var left = want.length, settled = false;
    function settle() { if (settled) return; settled = true; flush(); }
    window.setTimeout(settle, KEEPALIVE);
    // 这一台上没有该拿的语料（理论上不会——追问条目库哪台都拿），别白等满 2 秒
    if (!left) { settle(); return; }
    for (var i = 0; i < want.length; i++) {
      (function (f) {
        var s = document.createElement('script');
        s.src = f.src;
        // 拿不到是正常情况（离线、被删、断网），不是错误——静静算了
        s.onload = s.onerror = function () { if (--left <= 0) settle(); };
        document.head.appendChild(s);
      })(want[i]);
    }
  }

  // ---- 每一份现在什么情况（给本机那个「知识库」面板看的）----
  function status() {
    var out = [];
    for (var i = 0; i < FILES.length; i++) {
      var raw = window.SR[FILES[i].key];
      out.push({
        what: FILES[i].what, key: FILES[i].key, src: FILES[i].src,
        ok: !!raw,
        条数: raw ? countEntries(raw) : 0,
        // 给面板算个"约重"：UTF-16 字数 ×2 只是粗略，用来让人对量级有概念
        KB: raw ? Math.round(raw.length * 3 / 1024) : 0
      });
    }
    return out;
  }

  // 跟 js/retrieve.js 的 splitEntries 同一套切法，别写成另一种口径——
  // 面板上显示"118 条"、检索器却切出别的数，那就是在骗自己。
  function countEntries(raw) {
    var parts = String(raw || '').split(/\n(?=###\s)/);
    var n = 0;
    for (var i = 0; i < parts.length; i++) if (/^###\s/.test(parts[i])) n++;
    return n;
  }

  // 面板用：这一句能召回什么，分数各是多少。
  // 带分数是为了让人**看见阈值卡在哪儿**——pickZhuawen 的 score < 3 不给，
  // 到底卡掉了什么，光看界面是看不出来的。
  function search(q) {
    var out = { textbook: [], zhuawen: [] };
    try { if (window.SR.findTextbook) out.textbook = window.SR.findTextbook(q, 5); } catch (e) {}
    try { if (window.SR.findZhuawen) out.zhuawen = window.SR.findZhuawen(q, 5); } catch (e) {}
    return out;
  }

  // ============================================================
  //  召回用的那句话：本模块最要紧的一处修正
  // ============================================================
  // ★ 这不是新功能，是补一个早该补的洞。
  //   检索原来是拿**学生这一轮的原话**去召回的（api.js 传 opts.text）。
  //   可学生十有八九不点知识点的名——"这题我不会""第二题""老师，这是昨天的卷子"，
  //   这些话里一个知识点的字都没有，二元组一个都对不上，于是**永远召不回**。
  //   库越厚，这个洞越显眼：手上 118 条，却只在学生碰巧说出"绝对值""数轴"时才动一下。
  //
  //   改法：把**前几轮学生自己说的话**一起当检索词。
  //   他上一轮说过"我算到 x=4 就卡了"，这一轮只说"嗯"，那上一轮那句仍然该参与召回。
  //
  //   三条自我约束，都是有代价的：
  //     · **只取学生说的**。把模型的回复也塞进去，等于拿一堆老师的话去检索"学生卡在哪儿"，
  //       召回来的会是模型自己提过的知识点，越滚越偏。
  //     · **只取最近几轮、并且限长**。给得太多，BM25 会被一堆无关的词摊平，
  //       原来那句"绝对值"的权重反而被稀释掉。所以这一轮的原话最先放、也最重。
  //     · **拿不到就算了**。返回空串时，两条检索都照常走"没召回到"那一档。
  function queryFor(text, history, budget) {
    var cap = budget || 240;
    var out = String(text || '').trim();
    var h = history || [];
    for (var i = h.length - 1; i >= 0 && out.length < cap; i--) {
      if (!h[i] || h[i].role !== 'user') continue;
      var t = flat(h[i].content);
      if (!t) continue;
      out = (out ? out + '\n' : '') + t;
    }
    return out.slice(0, cap);
  }

  // 历史里那条 content 可能是纯字符串，也可能是 parts 数组（带图那一轮就是数组），
  // 数组里只有 kind === 'text' 的才拿得出来——图片对检索没有用。
  function flat(content) {
    if (typeof content === 'string') return content;
    if (Object.prototype.toString.call(content) !== '[object Array]') return '';
    var out = [];
    for (var i = 0; i < content.length; i++) {
      var c = content[i];
      if (c && typeof c === 'object' && typeof c.text === 'string' && !c.image_url) out.push(c.text);
    }
    return out.join(' ');
  }

  // 面板和 api.js 都从这儿取分数线。★ 只留这一个源头——
  //   面板上写的"阈值 10 分以下不给"要是跟 api.js 真正用的数对不上，
  //   那个面板就变成了一个看起来在验货、其实在骗人的东西。
  function cut(which) { return CUT[which] || 0; }

  return {
    load: load, has: has, status: status, search: search,
    queryFor: queryFor, countEntries: countEntries, cut: cut,
    files: function () { return FILES.slice(); }
  };
})();
