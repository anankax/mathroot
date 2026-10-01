// 「数根」——模板解析。把老师上传的那份 .docx 读成"**版式 + 骨架**"。
//
// ★ 这个文件是整件事的通用性所在。产品前提是：
//     ① 用户上传模板 → ② 提出要求 → ③ 给出已有资源 → ④ 它去自己编排内容
//   **模板是每个老师上传自己的**。所以这里不许出现任何"我预设抬头长这样、
//   大题是『一、二、三』"的硬编码判断——那种正则换一所学校就崩。
//
//   分三层（见 README「三层解析」）：
//     格式层：页边距 / 纸张 / 页眉 / 样式表        → 前端可靠解析，**这正是"套模板"要继承的**
//     骨架层：段落序列 + 每段挂的格式 + 抬头区形状  → 抽出来当**证据**喂给模型，让它自己认
//     内容层：题目本身                              → 模型产，每段自己指定用哪个"格式号"
//
// ★ "格式号"（slot）这套是通用性的关键：
//   把模板里每一种出现过的段落格式编上号，模型只能从这份清单里挑，
//   前端照着号把模板原来的 pPr/rPr 套回去。**换一份模板，代码一行不动。**
//   为什么不直接用 styles.xml 里的样式名：WPS 会把它编成 `a5`、`aF` 这种，
//   名字本身说明不了任何事；而且实测很多段落的格式压根不走样式、是**直接挂在段上**的。
//   （周练卷的正文段 pPr 里连 rPr 都没有，字体挂在每个 run 上——这是踩过的坑。）
var SR = (window.SR = window.SR || {});

SR.tpl = (function () {

  // ============================================================
  //  XML 小工具（跟 test/_spike_docx.cjs 里验过的那套同源，别再写第二份）
  // ============================================================

  // 把一段 XML 里的**顶层**元素逐个切出来。
  // ★ 为什么不能直接 /<w:p>…<\/w:p>/g：表格 `<w:tbl>` 里套着 `<w:p>`，
  //   平铺正则会把单元格里的段落也当成顶层段落，切点整个错位。
  //   要动的是"正文这一层"，就必须按嵌套深度切。
  function splitTop(xml) {
    var out = [];
    var re = /<(\/?)([A-Za-z0-9_:.\-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
    var depth = 0, start = -1, m;
    while ((m = re.exec(xml))) {
      var closing = m[1] === '/', self = m[4] === '/';
      if (self) { if (depth === 0) out.push(xml.slice(m.index, re.lastIndex)); continue; }
      if (!closing) { if (depth === 0) start = m.index; depth++; }
      else { depth--; if (depth === 0) out.push(xml.slice(start, re.lastIndex)); }
    }
    return out;
  }

  // 一段 XML 里的纯文字（把 <w:t> 拼起来）。倒着做：先把标签去掉再拼，
  // 免得 `a</w:t>…<w:t>b` 中间夹着的东西被算进来。
  function plain(el) {
    return (String(el).match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [])
      .map(function (t) { return t.replace(/<[^>]+>/g, ''); }).join('').trim();
  }

  function isPara(el) { return /^<w:p[\s>]/.test(el); }

  // 取一段里的块：`<xxx>…</xxx>`，没有就空串
  function block(el, tag) {
    var m = new RegExp('<' + tag + '[\\s>][\\s\\S]*?</' + tag + '>').exec(el);
    return m ? m[0] : '';
  }

  function bodyInner(xml) {
    var m = /<w:body[^>]*>([\s\S]*)<\/w:body>/.exec(xml);
    return m ? m[1] : null;
  }

  // ============================================================
  //  骨架：抬头区到哪儿为止
  // ============================================================
  // 切点 = 第一个顶层段落，它的文字以「一、」开头（第一道大题）。
  // ★ 为什么不按"第 N 段"切：抬头区长什么样**因校而异**——有的三行，
  //   有的还带"班级 姓名 学号"框，校徽是浮动图锚在抬头里的。
  //   按"第一道大题"切，是唯一跟学校无关的判据。
  //   找不到就退回"留头两段有字的"（见 _spike_docx.cjs 的三级兜底）。
  function findCut(tops) {
    for (var i = 0; i < tops.length; i++) {
      if (!isPara(tops[i])) continue;
      if (/^\s*一\s*[、．.]/.test(plain(tops[i]))) return { cut: i, how: '「一、」大题标题' };
    }
    var seen = 0;
    for (var j = 0; j < tops.length; j++) {
      if (isPara(tops[j]) && plain(tops[j]) && ++seen === 2) return { cut: j + 1, how: '没找到大题标题，退回首两段有字的之后' };
    }
    return { cut: Math.min(1, tops.length), how: '兜底' };
  }

  // ============================================================
  //  格式号：段落格式和字体格式各投一次票
  // ============================================================
  // ★ 为什么是"投票"而不是"挑一段当样板"：
  //   正文长什么样，按定义就是**这份材料里出现最多的那种格式**。跟学校无关，也不用问模型。
  //   踩过的两次坑，都是因为拿了"第一个"而不是"最多的"：
  //     ① 段落格式挑了切点前最后一段 → 那恰好是「班级 姓名 学号」（居中+加粗+14pt），
  //        整篇正文会变成居中加粗的。**大题标题前面那一段，恰好是全篇最不像正文的一段。**
  //     ② 字体挑了供体段里第一个 <w:r> → 那一个是加粗的，
  //        实测原件正文 162 个 run 明确 w:b val="0"、只有 13 个粗，
  //        我的产物却 54 个全粗。**同一件事在 pPr 上吃过一次亏，在 rPr 上又吃一次。**
  //     ③ 上面两条改完还是错的——**每个格式号的字体，不能取自它"第一段样例"里的第一个 run**。
  //        周练卷 #2 号有 41 段，而"第一段"恰好是「一、选择题(本题共10小题…)」这道**加粗**的大题标题；
  //        于是 41 段正文全被套上加粗。**"第一段"和"最多的那种"在 rPr 这里第三次不是一回事。**
  //        所以：格式号内部也要投票，跟全局用同一把尺子。
  function mode(map, counts) {
    var best = '', n = 0;
    Object.keys(counts).forEach(function (k) { if (counts[k] > n) { n = counts[k]; best = map[k]; } });
    return { value: best, count: n };
  }

  function tally(tops, opts) {
    var box = { map: {}, counts: {} };
    tops.forEach(function (t) {
      if (!isPara(t)) return;
      var txt = plain(t);
      if (opts.blankOnly ? txt : !txt) return;          // 空段单独投、有字段单独投
      var sig = opts.run
        ? runSig(t)                                      // 这一趟收"字体格式"
        : (block(t, 'w:pPr') || '(无 pPr)');             // 这一趟收"段落格式"
      if (!sig) return;                                  // 公式 run、没 rPr 的 run 不参与
      if (!box.map[sig]) { box.map[sig] = opts.run ? sig : (block(t, 'w:pPr') || ''); box.counts[sig] = 0; }
      box.counts[sig] += 1;                              // 一段算一票，两种格式同一把尺子
    });
    return mode(box.map, box.counts);
  }

  // 一段里"正文那个 run"的 rPr。
  // ★ 一段里只认第一种非公式 run 的格式，够用了：同一段里正文不会中途换字体。
  //   要的是"跨段投票"，不是"段内投票"——段内挑"最多的那个"曾被单字符拆碎的 run 骗过。
  function runSig(para) {
    var rr = /<w:r[\s>][\s\S]*?<\/w:r>/g, m;
    while ((m = rr.exec(para))) {
      if (m[0].indexOf('<m:oMath') >= 0 || m[0].indexOf('<m:r>') >= 0) continue;
      var rp = block(m[0], 'w:rPr');
      if (rp) return rp;
    }
    return null;
  }

  // ============================================================
  //  页眉 / 纸张 / 样式表
  // ============================================================
  function pageOf(xml) {
    var m = /<w:sectPr[\s\S]*?<\/w:sectPr>/.exec(xml);
    var out = { w: 0, h: 0, top: 0, bottom: 0, left: 0, right: 0, landscape: false };
    if (!m) return out;
    var sz = /<w:pgSz([^>]*)\/>/.exec(m[0]);
    if (sz) {
      out.w = +((/w:w="(-?\d+)"/.exec(sz[1]) || [, 0])[1]);
      out.h = +((/w:h="(-?\d+)"/.exec(sz[1]) || [, 0])[1]);
      out.landscape = /w:orient="landscape"/.test(sz[1]);
    }
    var mg = /<w:pgMar([^>]*)\/>/.exec(m[0]);
    if (mg) {
      ['top', 'bottom', 'left', 'right'].forEach(function (k) {
        out[k] = +((new RegExp('w:' + k + '="(-?\\d+)"').exec(mg[1]) || [, 0])[1]);
      });
    }
    return out;
  }

  // styles.xml 里有哪些样式名（给模型看的旁证；正文用不用它们由 slot 说了算）
  function styleNames(stylesXml) {
    if (!stylesXml) return [];
    var out = [], re = /<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g, m;
    while ((m = re.exec(stylesXml))) {
      var nm = /<w:name w:val="([^"]+)"/.exec(m[2]);
      out.push({ id: m[1], name: nm ? nm[1] : m[1], type: (/w:type="([^"]+)"/.exec(m[0]) || [, ''])[1] });
    }
    return out;
  }

  // 页眉里的文字（"我认出来的是"那张卡要摆出来给老师看）
  function headerText(map) {
    var out = [];
    Object.keys(map).forEach(function (n) {
      if (!/^word\/header\d*\.xml$/.test(n)) return;
      var t = plain(SR.docx.str(map[n]));
      if (t) out.push({ part: n, text: t });
    });
    return out;
  }

  // ============================================================
  //  解析主流程
  // ============================================================
  function parse(buf, meta) {
    return SR.docx.read(buf).then(function (z) {
      var docU8 = z.get('word/document.xml');
      if (!docU8) throw new Error('这份 .docx 里没有 word/document.xml，不是 Word 文档');
      var xml = SR.docx.str(docU8);
      var inner = bodyInner(xml);
      if (!inner) throw new Error('这份 .docx 的正文结构看不懂（找不到 w:body）');
      var tops = splitTop(inner);

      // ---- 骨架 ----
      var at = findCut(tops);
      var tail = tops[tops.length - 1];
      var hasSect = /^<w:sectPr[\s>]/.test(tail);
      var head = tops.slice(0, Math.max(1, at.cut));
      var keepTail = hasSect ? [tail] : [];

      // ---- 格式号：把每一种"段落格式"编个号 ----
      // 同一个 pPr 归一号；顺带把它的字体格式和一段样例文字带上——
      // 模型要照这份清单挑"这一段该长什么样"，人也靠样例认得出这是标题还是正文。
      var byPPr = {}, slots = [];
      tops.forEach(function (t) {
        if (!isPara(t)) return;
        var pPr = block(t, 'w:pPr') || '';
        var txt = plain(t);
        if (!txt) return;                        // 空段单独作一档，不混进来
        var key = pPr || '(无 pPr)';
        if (!byPPr[key]) {
          byPPr[key] = { i: slots.length, pPr: pPr, rPr: '', n: 0, sample: '', math: false,
                         _rm: {}, _rc: {} };     // _rm/_rc：这一号内部的字体投票箱
          slots.push(byPPr[key]);
        }
        var sl = byPPr[key];
        sl.n++;
        if (!sl.sample) sl.sample = txt.slice(0, 24);
        if (t.indexOf('<m:oMath') >= 0) sl.math = true;
        // ★ 这一号的字体：在本号**所有**段落里投票（见上面坑③）。一段一票，跟全局一个尺子。
        var rs = runSig(t);
        if (rs) { if (!sl._rm[rs]) { sl._rm[rs] = rs; sl._rc[rs] = 0; } sl._rc[rs]++; }
      });

      // ---- 投票挑"正文"和"空段" ----
      var vBody = tally(tops, {});
      var vBlank = tally(tops, { blankOnly: true });
      var vRun = tally(tops, { run: true });

      var bodySlot = null, i;
      for (i = 0; i < slots.length; i++) if (slots[i].pPr === vBody.value) bodySlot = slots[i];
      if (!bodySlot && slots.length) bodySlot = slots[0];

      var blankPPr = vBlank.value;               // 空段的格式单独投；模板靠空段拉开题干和选项
      var bodyRPr = vRun.value || (bodySlot ? bodySlot.rPr : '');

      // 每个 slot 的字体：本号内部投票，取不到才落回正文那份
      slots.forEach(function (s) {
        s.rPr = mode(s._rm, s._rc).value || bodyRPr;
        delete s._rm; delete s._rc;            // 投票箱不往存档里带
      });
      if (bodySlot) bodySlot.kind = 'body';

      // ---- 认出来的东西，摆给老师看 ----
      var headText = head.filter(isPara).map(plain).filter(Boolean);
      var sec = pageOf(xml);

      return {
        id: (meta && meta.id) || ('t' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        name: (meta && meta.name) || '未命名模板',
        savedAt: Date.now(),
        bytes: buf.byteLength || (buf.length || 0),

        page: sec,
        slots: slots,
        bodySlot: bodySlot ? bodySlot.i : 0,
        blankPPr: blankPPr,
        bodyRPr: bodyRPr,
        styles: styleNames(z.get('word/styles.xml') ? SR.docx.str(z.get('word/styles.xml')) : ''),
        headers: headerText(z.map),
        head: head,
        headText: headText,
        hasLogo: head.join('').indexOf('<wp:anchor') >= 0,
        cut: at.cut,
        cutHow: at.how,
        keepTail: keepTail,
        bodyHead: xml.slice(0, /<w:body[^>]*>/.exec(xml).index + /<w:body[^>]*>/.exec(xml)[0].length),
        bodyFoot: xml.slice(/(<\/w:body>)/.exec(xml).index),

        // ★ 整包原样留着：出材料时要"继承版式"——styles/theme/media/页眉页脚/Content_Types
        //   一个字节都不改，只换 word/document.xml（见 produce.js）。
        pack: z.顺序.map(function (n) { return { name: n, data: z.get(n) }; })
      };
    });
  }

  // ============================================================
  //  存：IndexedDB（模板几 MB，localStorage 放不下）
  // ============================================================
  var DB = 'mathroot_tpl', STORE = 'tpl', VERSION = 1;

  function db() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('这个浏览器不支持本地存模板'));
      var rq = indexedDB.open(DB, VERSION);
      rq.onupgradeneeded = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error || new Error('打不开本地模板库')); };
    });
  }

  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(STORE, mode), s = t.objectStore(STORE), out;
        out = fn(s);
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { rej(t.error || new Error('本地模板库读写失败')); };
      });
    });
  }

  function save(t) { return tx('readwrite', function (s) { s.put(t); return t; }); }
  function all() { return tx('readonly', function (s) { return s.getAll(); }); }
  function remove(id) { return tx('readwrite', function (s) { s.delete(id); return id; }); }

  // 给「我认出来的是」那张卡用的人话摘要
  function summary(t) {
    if (!t) return '';
    var cm = t.page.w ? (Math.round(t.page.w / 56.7) / 10) + '×' + (Math.round(t.page.h / 56.7) / 10) + ' cm' : '纸张没认出来';
    var kind = /^\s*一\s*[、．.]/.test((t.slots[t.bodySlot] || {}).sample || '') ? '旧卷子' : '模板';
    return cm + ' · ' + (t.page.landscape ? '横向' : '纵向')
      + ' · ' + t.slots.length + ' 种段落格式'
      + ' · 抬头 ' + (t.headText.length || 0) + ' 行'
      + (t.hasLogo ? '（含校徽图）' : '')
      + ' · 看得出是' + kind;
  }

  return {
    parse: parse, save: save, all: all, remove: remove, summary: summary,
    // 这几个给 produce.js 和测试用
    splitTop: splitTop, plain: plain, block: block, findCut: findCut, pageOf: pageOf
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.tpl;
