// 备课卡片（**公开**面板）：把那 118 条追问条目摊开给人看。
//
// ★ 这个面板跟 js/main.js 里那个「知识库」面板**目的不同，别合并**：
//     · 知识库（本机）= 验货。打一句话进去，看召回什么、分数多少、被阈值卡掉几条。
//       它的主角是**分数**，所以只能在孔老师本机出现。
//     · 备课卡片（公开）= 备查。按册别分组、能搜，一条一张卡，挑一档直接念。
//       它的主角是**那五句话**，所以公开站上也有它。
//   两个面板长得像，是因为它们本来就是同一批条目的两种看法。
//
// ★ 渲染路径**只读 SR.ZHUAWEN**（追问条目库，孔老师自己写的，可以公开）。
//   教材索引 SR.TEXTBOOK 在这条路径上一个字都不碰——那是书上的原话，不公开。
//   这条边界靠代码分叉（下面压根没有 TEXTBOOK 这个字），不靠自觉。
//
// ★ 也不显示分数、不显示阈值。公开展示的卡片不该带着"差几分够上"这种内部读数。
var SR = (window.SR = window.SR || {});

SR.cards = (function () {

  // ---- 解析 ----
  // 语料格式（跟 js/retrieve.js 的 splitEntries 同一套切法，别写成另一种口径）：
  //   ### 七上 · 正数与负数·相反意义的量｜也叫：正负号、收入支出
  //   【认这类题】...
  //   【还没开口】...
  //   （空行）
  // 五档的名字在语料里就带方括号，这里只是把它切出来当标签。
  var SLOTS = ['认这类题', '还没开口', '复述完了', '卡住说不出', '说对了'];

  function splitEntries(raw) {
    var parts = String(raw || '').split(/\n(?=###\s)/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (/^###\s/.test(parts[i])) out.push(parts[i]);
    }
    return out;
  }

  function parse(entry) {
    var lines = entry.split('\n');
    var head = lines[0].replace(/^###\s*/, '').trim();
    // 册别：标题里第一个「·」之前那截。没有就归到"其他"，**不猜**
    var book = '其他', rest = head, dot = head.indexOf('·');
    if (dot > 0 && dot <= 3) { book = head.slice(0, dot).trim(); rest = head.slice(dot + 1).trim(); }
    // 别名：语料里写成「｜也叫：a、b、c」。搜索要搜得到别名，老师不按书面语叫。
    var name = rest, aka = '', al = rest.indexOf('｜也叫：');
    if (al >= 0) { name = rest.slice(0, al).trim(); aka = rest.slice(al + 4).trim(); }

    var slots = [];
    for (var i = 1; i < lines.length; i++) {
      var m = /^【(.+?)】(.*)$/.exec(lines[i].trim());
      if (m) slots.push({ tag: m[1], text: m[2] });
    }
    return { book: book, name: name, aka: aka, slots: slots, text: entry };
  }

  var all = null;   // 解析一次就记住：118 条，重分组不值当再切一遍

  function entries() {
    if (all) return all;
    var raw = window.SR.ZHUAWEN;
    if (!raw) return null;
    var parts = splitEntries(raw);
    all = [];
    for (var i = 0; i < parts.length; i++) all.push(parse(parts[i]));
    return all;
  }

  // ---- 渲染 ----
  var $ = function (id) { return document.getElementById(id); };

  // ★ 不用 innerHTML。条目正文要原样显示，中间只有一处要上色：
  //   语料里那个填空的 `____`。这里按**固定字面量**切，切出来的每一段都当纯文本
  //   塞进 textContent——文本永远不进 HTML 解析器，就不用担心条目里带尖括号。
  function putText(el, s) {
    var parts = String(s).split('____');
    for (var i = 0; i < parts.length; i++) {
      if (i) {
        var mk = document.createElement('span');
        mk.className = 'mk';
        mk.textContent = '____';
        el.appendChild(mk);
      }
      if (parts[i]) el.appendChild(document.createTextNode(parts[i]));
    }
  }

  function lineEl(cls, txt) {
    var d = document.createElement('div');
    d.className = cls;
    putText(d, txt);
    return d;
  }

  function cardEl(e) {
    var card = document.createElement('div');
    card.className = 'card';

    var nm = document.createElement('div');
    nm.className = 'cardname';
    nm.textContent = e.name;
    card.appendChild(nm);

    if (e.aka) {
      var aka = document.createElement('span');
      aka.className = 'cardaka';
      aka.textContent = '也叫：' + e.aka;
      card.appendChild(aka);
    }

    // 五档按语料里的顺序排；语料里少的档（或名字不一样的）原样跟在后面，不丢
    var got = [];
    for (var s = 0; s < SLOTS.length; s++) {
      for (var i = 0; i < e.slots.length; i++) {
        if (e.slots[i].tag === SLOTS[s]) { got.push(e.slots[i]); break; }
      }
    }
    for (var j = 0; j < e.slots.length; j++) {
      if (SLOTS.indexOf(e.slots[j].tag) < 0) got.push(e.slots[j]);
    }

    for (var k = 0; k < got.length; k++) {
      var line = document.createElement('div');
      line.className = 'line';
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = got[k].tag;
      line.appendChild(tag);
      line.appendChild(lineEl('txt', got[k].text));
      // 点一行就把它抄走——备课时手边多半正开着教案，这一下省一次手打。
      line.title = '点一下复制这句话';
      line._copy = got[k].text;
      card.appendChild(line);
    }
    return card;
  }

  function hit(e, q) {
    if (!q) return true;
    var hay = (e.name + ' ' + e.aka + ' ' + e.text).toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  var BOOKS = ['七上', '七下', '八上', '八下', '九上', '九下'];

  function paint() {
    var rows = $('cardrows'), meta = $('cardmeta');
    if (!rows) return;
    var list = entries();
    if (!list) {
      rows.textContent = '';
      var miss = document.createElement('div');
      miss.className = 'cardempty';
      miss.textContent = '条目库没装上（多半是离线）。关掉再开一次试试。';
      rows.appendChild(miss);
      if (meta) meta.textContent = '';
      return;
    }

    var q = String(($('cardq') && $('cardq').value) || '').trim().toLowerCase();
    var keep = [];
    for (var i = 0; i < list.length; i++) if (hit(list[i], q)) keep.push(list[i]);

    if (meta) {
      meta.textContent = q
        ? '搜「' + q + '」：命中 ' + keep.length + ' / ' + list.length + ' 张'
        : '共 ' + list.length + ' 张，按册别排';
    }

    rows.textContent = '';
    if (!keep.length) {
      var none = document.createElement('div');
      none.className = 'cardempty';
      // ★ 搜不着的时候要给下一步，不能只说"没有"——老师多半是叫法不同，
      //   而别名就写在每张卡的"也叫："那一行里。
      none.textContent = '没搜到。换个叫法试试——每张卡下面那行「也叫：」里是它认得的所有别名。';
      rows.appendChild(none);
      return;
    }

    // 分组：先按六册的固定顺序，剩下的归"其他"（不按字典序排，
    // 老师翻的时候是按册走的）
    var groups = [], seen = {};
    function group(b) {
      var arr = [];
      for (var i = 0; i < keep.length; i++) if (keep[i].book === b) arr.push(keep[i]);
      return arr;
    }
    for (var b = 0; b < BOOKS.length; b++) {
      var arr = group(BOOKS[b]);
      if (arr.length) { groups.push([BOOKS[b], arr]); seen[BOOKS[b]] = 1; }
    }
    var other = [];
    for (var j = 0; j < keep.length; j++) if (!seen[keep[j].book]) other.push(keep[j]);
    if (other.length) groups.push(['其他', other]);

    for (var g = 0; g < groups.length; g++) {
      var h = document.createElement('h3');
      h.className = 'cardgrp';
      h.textContent = groups[g][0] + '（' + groups[g][1].length + '）';
      rows.appendChild(h);
      for (var c = 0; c < groups[g][1].length; c++) rows.appendChild(cardEl(groups[g][1][c]));
    }
  }

  // ---- 复制一行 ----
  function copyLine(el) {
    var t = el._copy;
    if (!t) return;
    function done() {
      el.classList.add('copied');
      el.title = '复制了';
      window.setTimeout(function () { el.classList.remove('copied'); el.title = '点一下复制这句话'; }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done, fallback);
    } else fallback();
    function fallback() {
      // 剪贴板 API 在非 https 下没有（本机 http://localhost 也算安全上下文，
      // 但 file:// 打开就没有）。退回老办法，别静默失败。
      var ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  // ---- 打开 ----
  // 第一次打开才去拿语料（它跟对话那边共用 js/kb.js 的装载，拿过一次就不再拿）。
  var opened = false;
  function open() {
    if (opened) { paint(); return; }
    opened = true;
    paint();                       // 先画一遍：语料要是在，立刻就有；不在就出"没装上"
    if (!window.SR.kb) return;
    window.SR.kb.load(function () { paint(); });
  }

  function bind() {
    var q = $('cardq');
    if (q) q.addEventListener('input', paint);
    var rows = $('cardrows');
    if (rows) rows.addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el !== rows && !(el.className && /(^|\s)line(\s|$)/.test(el.className))) el = el.parentNode;
      if (el && el !== rows) copyLine(el);
    });
  }

  return { bind: bind, open: open, paint: paint, parse: parse, splitEntries: splitEntries };
})();
