// 本地素材索引（"后备资源"）的读取口。
//
// ★ 这份索引**不进仓库、不上公开站**。它由 test/build_resource_index.cjs 在孔老师
//   本机扫出来，写着"哪一节手上有哪些课件/教案"——学科网、出版社、别人的课程，
//   著作权都不在他手上，一放上公开网页就等于再传播一份（详见
//   24-知识库\05-后备资源（本地素材索引·不随站发布）.md）。
//   所以：文件只在**本机跑起来的**页面上存在；公开站上它根本不存在，
//   这个模块探测不到就什么都不做——不会多出一个点了没反应的按钮。
//
// ★ 索引里**只有文件名、章节号和路径，没有内容**。这里也照这个边界来：
//   它只帮孔老师"找得到手上有什么"，不做任何内容检索，更不往提示词里塞。
var SR = (window.SR = window.SR || {});

SR.resources = (function () {

  var SRC = 'js/resource-index.js';
  var state = 'idle';        // idle | loading | ready | missing
  var wakers = [];

  function local() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || location.protocol === 'file:';
  }

  // 按需加载：索引有 300 KB，只在真要打开面板时才去拿；
  // 公开站上连这一次请求都不发（先判 local），控制台里不会多一行 404。
  function load(cb) {
    if (state === 'ready') { cb(true); return; }
    if (state === 'missing' || !local()) { state = 'missing'; cb(false); return; }
    if (state === 'loading') { wakers.push(cb); return; }
    state = 'loading';
    wakers.push(cb);
    var s = document.createElement('script');
    s.src = SRC;
    s.onload = function () { state = window.SR.RESOURCES ? 'ready' : 'missing'; flush(); };
    // 文件不在（公开站、或者他还没生成过）——静静算了，这不是错误。
    s.onerror = function () { state = 'missing'; flush(); };
    document.head.appendChild(s);
  }

  function flush() {
    var ok = state === 'ready';
    var ws = wakers; wakers = [];
    for (var i = 0; i < ws.length; i++) ws[i](ok);
  }

  // 查一条：节号（2.3）、知识点（绝对值）、来源（学科网）都能搜。
  // 打分只为了让最像的排前面，不是"相关度"——这是查文件夹，不是检索资料。
  function score(r, toks) {
    var s = 0;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], hit = false;
      if (r.节 && r.节 === t) { s += 100; hit = true; }          // 节号写全了，最准
      if (r.节 && r.节.indexOf(t) === 0) { s += 40; hit = true; }
      if (r.册 && r.册 === t) { s += 20; hit = true; }
      if (r.源 && r.源.indexOf(t) >= 0) { s += 15; hit = true; }
      if (r.名 && r.名.indexOf(t) >= 0) { s += 12; hit = true; }
      if (r.词) for (var j = 0; j < r.词.length; j++) if (r.词[j].indexOf(t) >= 0) { s += 8; hit = true; }
      if (!hit) return 0;                                        // 有一个词全军覆没，这条就不算
    }
    return s;
  }

  function find(q) {
    var all = (window.SR.RESOURCES && window.SR.RESOURCES.素材) || [];
    var toks = String(q || '').split(/[\s,，、;；]+/).filter(function (x) { return x; });
    if (!toks.length) return all.slice(0, 200);
    var hit = [];
    for (var i = 0; i < all.length; i++) {
      var s = score(all[i], toks);
      if (s) hit.push({ r: all[i], s: s });
    }
    hit.sort(function (a, b) { return b.s - a.s || (a.r.路径 < b.r.路径 ? -1 : 1); });
    return hit.slice(0, 200).map(function (x) { return x.r; });
  }

  function base() { return (window.SR.RESOURCES && window.SR.RESOURCES.基准目录) || 'C:\\数学办公\\宜兴东氿中学'; }
  function total() { return (window.SR.RESOURCES && window.SR.RESOURCES.条数) || 0; }
  function when() { return (window.SR.RESOURCES && window.SR.RESOURCES.生成时间) || ''; }

  return { load: load, find: find, base: base, total: total, when: when,
           state: function () { return state; } };
})();
