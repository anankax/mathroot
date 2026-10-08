// 文件 → 能发给模型的东西。
//
// 学生发过来的可能是一道题，也**可能是一整张卷子**（2026-10-01 孔老师提的需求：
// "学生也可能发一整张卷子，你也要帮他分析，问他哪些不会"）。所以这里要能吃下：
//
//   图片（多张）   → 缩到最长边 1280 的 JPEG，直接当图片发（老路子）
//   PDF            → 逐页渲染成图片再发（前 6 页）
//   .docx          → 解 zip 取出正文，当文字发
//   .txt / .md     → 直接读
//   .doc / .pptx   → **读不了**，明确回一句话，不静默失败
//
// 两条边界，别越：
//   ① pdf.js 是**按需加载**的（照 js/resources.js 那套三段式）。不看 PDF 的人
//      一个字节都不下载——它的体积比我们自己所有 js 加起来还大。
//   ② 所有失败都要有话说。学生传了一个打不开的文件，屏幕上必须出现一句人话，
//      不能什么都不发生——"我发了个文件，它没反应"是最让人放弃的一种失败。
var SR = (window.SR = window.SR || {});

SR.files = (function () {

  var MAX_FILES = 8;        // 一次最多收几个文件
  var MAX_PDF_PAGES = 6;    // 一份 PDF 最多看前几页
  var MAX_TEXT = 12000;     // 文本类抽出多少字就够（再长模型也读不完）
  var PHOTO_MAX = 1280;     // 照片缩到最长边多少（手写字清晰度和体积的平衡点）
  var PAGE_MAX = 1500;      // PDF 页面缩到多少。比照片大一档：卷子上的小字更密

  var PDF_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  var PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

  // ============================================================
  //  判类型
  // ============================================================
  function kindOf(file) {
    var n = (file.name || '').toLowerCase();
    var t = file.type || '';
    if (/^image\//.test(t) || /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/.test(n)) return 'image';
    if (t === 'application/pdf' || /\.pdf$/.test(n)) return 'pdf';
    if (/\.docx$/.test(n)) return 'docx';
    // ★★ 2026-10-08：`.xlsx` 从这一档里**单独提出来**（原来跟 .xls／.ppt／.pptx 挤在
    //   'office' 里、共用一句"读不了"）。理由是学情工位：它的第一句话就是
    //   「把成绩表发给我（智学网导出的那种就行）」，而智学网导出的**就是 .xlsx**——
    //   这是那一格最常来、也最该读得懂的东西，却被归进了"读不了"。
    //   ⚠ `.xls` **仍在读不了那一档**：它是 BIFF 二进制（不是 zip），跟 .xlsx 不是一个东西，
    //     xlsxPart 那套解 zip 的路子对它一个字都用不上。别把这两个后缀并进同一个判断。
    if (/\.xlsx$/.test(n)) return 'xlsx';
    if (/\.(xls|ppt|pptx)$/.test(n)) return 'office';
    if (/\.(txt|md|csv|json)$/.test(n) || /^text\//.test(t)) return 'text';
    if (/\.doc$/.test(n)) return 'doc-old';
    return 'unknown';
  }

  var WHY = {
    'doc-old': '.doc 是 Word 的老格式，浏览器读不了。用 Word 打开，另存为 PDF 或者 .docx 再发。',
    // ★★ 2026-10-08 从一条 'office' 里劈出来。原来 xls／xlsx／ppt／pptx 共用一句
    //   「.pptx / .xls 读不了」——那句话对**成绩表**这件事是**错的**：
    //   学情工位的第一句话是「把成绩表发给我（智学网导出的那种就行）」，而智学网导出的
    //   就是 .xlsx，正是这一档最常来的东西；老师拖进来一张 .xlsx，屏幕上却回他一句
    //   讲 .pptx 和 .xls 的话——**那句话指不到他手上那个文件**，他只会以为
    //   "这产品不认我的表"，然后放弃。
    //   ⇒ `.xlsx` 已经**真读得懂了**（`xlsxPart`，走 .docx 那套原生解 zip），
    //     从这一档里搬走；留在这一档的是 `.xls`（BIFF 二进制，不是 zip，解不了）
    //     和幻灯片。孔老师 2026-10-08 拍板的：xlsx 直接读 + 得分率在代码里算准。
    'office': '.xls / .ppt / .pptx 读不了。Excel 的**老格式**（.xls）请先用 Excel 另存为 .xlsx；幻灯片截图，或者另存为 PDF 再发。',
    'unknown': '这个格式读不了。截图，或者另存为 PDF 再发。'
  };

  // ============================================================
  //  图片 → dataURL
  // ============================================================
  // 缩到最长边 max。★ 先铺一层白底再画：学生拍的照片常常带透明通道（PNG 截图），
  //   不铺白底的话透明处会变成黑块，模型看到一片黑。
  function shrink(src, w, h, max) {
    var s = Math.min(1, (max || PHOTO_MAX) / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    var g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0, c.width, c.height);
    try { return c.toDataURL('image/jpeg', 0.82); } catch (e) { return ''; }
  }

  function imagePart(file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var url = shrink(img, img.width, img.height, PHOTO_MAX);
        if (!url) return cb('这张图转不出来');
        cb(null, { kind: 'image', dataUrl: url, name: file.name || '图片' });
      };
      img.onerror = function () { cb('这张图读不出来（可能格式特殊，或者文件坏了）'); };
      img.src = fr.result;
    };
    fr.onerror = function () { cb('这个文件读不出来'); };
    fr.readAsDataURL(file);
  }

  // ============================================================
  //  PDF → 每页一张图
  // ============================================================
  var pdfState = 'idle';   // idle | loading | ready | missing
  var pdfWaiters = [];

  function loadPdf(cb) {
    if (window.pdfjsLib) { pdfState = 'ready'; cb(true); return; }
    if (pdfState === 'missing') { cb(false); return; }
    if (pdfState === 'loading') { pdfWaiters.push(cb); return; }
    pdfState = 'loading';
    pdfWaiters.push(cb);
    var s = document.createElement('script');
    s.src = PDF_SRC;
    s.onload = function () {
      if (window.pdfjsLib) {
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER; } catch (e) {}
        pdfState = 'ready';
      } else pdfState = 'missing';
      flushPdf();
    };
    s.onerror = function () { pdfState = 'missing'; flushPdf(); };
    document.head.appendChild(s);
  }
  function flushPdf() {
    var w = pdfWaiters; pdfWaiters = [];
    for (var i = 0; i < w.length; i++) w[i](pdfState === 'ready');
  }

  function pdfParts(file, cb) {
    loadPdf(function (ok) {
      if (!ok) return cb('PDF 那个解析库没加载上（可能没网）。可以先把 PDF 截图，再当图片发。');
      file.arrayBuffer().then(function (buf) {
        return window.pdfjsLib.getDocument({ data: buf }).promise;
      }).then(function (doc) {
        var total = doc.numPages;
        var take = Math.min(total, MAX_PDF_PAGES);
        var out = [], p = 1;
        function step() {
          if (p > take) {
            var note = take < total
              ? ('这是一份 ' + total + ' 页的 PDF，先看了前 ' + take + ' 页' +
                 (out.length < take ? '（其中 ' + (take - out.length) + ' 页没渲染出来）' : ''))
              : '';
            return cb(null, out, note);
          }
          var n = p;
          doc.getPage(n).then(function (page) {
            // scale 2 先按两倍渲，再缩到 PAGE_MAX——等于超采样，卷子上的小字清楚得多
            var vp = page.getViewport({ scale: 2 });
            var c = document.createElement('canvas');
            c.width = vp.width; c.height = vp.height;
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
              var url = shrink(c, c.width, c.height, PAGE_MAX);
              if (url) out.push({ kind: 'image', dataUrl: url, name: file.name + ' 第 ' + n + ' 页' });
            });
          }).catch(function () { /* 单页渲不出来就跳过，剩下的接着来 */ })
            .then(function () { p++; step(); });
        }
        step();
      }).catch(function (e) {
        var msg = (e && e.message) || e;
        if (/password/i.test(String(msg))) cb('这份 PDF 是加密的，打不开。截个图发也行。');
        else cb('这份 PDF 打不开（' + String(msg).slice(0, 60) + '）。截个图发也行。');
      });
    });
  }

  // ============================================================
  //  .docx → 正文文字
  // ============================================================
  // ★ .docx 就是一个 zip，里面 word/document.xml 是正文。
  //   用浏览器**原生**的 DecompressionStream('deflate-raw') 解，不引任何库。
  //   只认 method 8（deflate）和 method 0（不压缩）两种；别的（bzip2 之类）
  //   在 Word 存出来的 docx 里不会出现。
  function u8(buf, off, len) {
    return new TextDecoder('utf-8').decode(new Uint8Array(buf, off, len));
  }

  function unzipEntry(buf, want) {
    return new Promise(function (resolve, reject) {
      var dv = new DataView(buf);
      var len = buf.byteLength;
      // 尾部找 EOCD（0x06054b50）。后面可能挂一段 zip 注释，最长 65535，所以往回扫。
      var eocd = -1;
      for (var i = len - 22; i >= 0 && i >= len - 22 - 65535; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) return reject(new Error('不是有效的 docx'));
      var n = dv.getUint16(eocd + 10, true);
      var p = dv.getUint32(eocd + 16, true);
      for (var k = 0; k < n; k++) {
        if (dv.getUint32(p, true) !== 0x02014b50) return reject(new Error('docx 的结构读坏了'));
        var method = dv.getUint16(p + 10, true);
        var csize = dv.getUint32(p + 20, true);
        var usize = dv.getUint32(p + 24, true);
        var fnLen = dv.getUint16(p + 28, true);
        var exLen = dv.getUint16(p + 30, true);
        var cmLen = dv.getUint16(p + 32, true);
        var lho = dv.getUint32(p + 42, true);
        var name = u8(buf, p + 46, fnLen);
        if (name === want) {
          var lfn = dv.getUint16(lho + 26, true);
          var lex = dv.getUint16(lho + 28, true);
          var start = lho + 30 + lfn + lex;
          // 有 data descriptor 的条目，中央目录里的 csize 可能是 0，用 usize 兜一下
          var size = csize || usize;
          var raw = buf.slice(start, start + size);
          if (method === 0) return resolve(new TextDecoder('utf-8').decode(raw));
          if (method !== 8) return reject(new Error('这个 docx 用的压缩方式读不了'));
          try {
            var ds = new DecompressionStream('deflate-raw');
            new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer()
              .then(function (ab) { resolve(new TextDecoder('utf-8').decode(ab)); })
              .catch(reject);
          } catch (e) { reject(new Error('这个浏览器不支持解压 docx')); }
          return;
        }
        p += 46 + fnLen + exLen + cmLen;
      }
      reject(new Error('这个 docx 里找不到正文'));
    });
  }

  // Word 的正文 XML → 纯文本。段尾换行、制表符和换行标签保留，其余标签全去掉。
  function xmlToText(xml) {
    var s = String(xml)
      // ★ 域代码要整段扔掉（含里面那点字），不能只去标签。
      //   `instrText` 里装的是 Word 的"指令"，不是内容：自动编号的 `SEQ 图 \* ARABIC`、
      //   页码的 `PAGE \* MERGEFORMAT`。只去标签的话，正文里会留下一串
      //   `= 1 \* GB3 ①掌握……`——实测一份导学案的"学习目标"就是这模样，
      //   模型读到的题面带着这层壳（同族：公式读成"12"，都是"看着有字、其实走样"）。
      .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '')
      .replace(/<w:instrText\b[^>]*\/>/g, '')
      // ★ 浮动图的定位数也要扔：它名字上是个标签，值却**写在标签里面**，
      //   于是逃过"去标签"那一步，正文里凭空多出一串数——
      //   实测卷子开头就是 `445600-472700宜兴市东氿中学…`（左边距 445600、上边距 -472700）。
      .replace(/<wp:posOffset\b[^>]*>[\s\S]*?<\/wp:posOffset>/g, '')
      .replace(/<w:tab\b[^>]*\/?>/g, '\t')
      .replace(/<w:br\b[^>]*\/?>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]*>/g, '');
    // ★ &amp; 必须**最后**替换。先换它的话，"&amp;lt;" 会被解成 "<"，
    //   正文里本来写着的 "a &lt; b" 就变成 "a < b" 再被当成标签吃掉。
    s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
         .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
         .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
         .replace(/&amp;/g, '&');
    return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function docxPart(file, cb) {
    file.arrayBuffer()
      .then(function (buf) { return unzipEntry(buf, 'word/document.xml'); })
      .then(function (xml) {
        // ★ 公式和图**必须在过 xmlToText 之前数**。过完那道，正文全成纯字了，
        //   再想问"这儿原来是不是个公式"就问不出来——标签已经没了。
        var nF = (xml.match(/<m:oMath[ >]/g) || []).length;
        var nG = (xml.match(/<w:drawing[ >]/g) || []).length;
        return { text: xmlToText(xml), nF: nF, nG: nG };
      })
      .then(function (r) {
        if (!r.text) return cb('这个 docx 里没读到字（可能是纯图片排的版），截个图发也行。');
        // ★ 为什么非要提醒一句：Word 的公式在 XML 里是分层的（分子/分母/上标各一层），
        //   按纯文本读出来只剩一串挨着的字——$\frac{1}{2}$ 读成 "12"。
        //   模型不会知道这是走样的，它会照着这份走样的题出材料，出来的卷子没人能用
        //   （同族：B9 那次，组卷网的公式本来就是图片，读出来是空的）。
        //   与其出一份看不出来的错卷子，不如当场请老师改发截图——截图走视觉那一档，看得见。
        var note = '';
        if (r.nF) note = file.name + ' 里有 ' + r.nF + ' 处公式，纯文字读出来会走样；公式多的卷子，截个图发我。';
        else if (r.nG) note = file.name + ' 里有 ' + r.nG + ' 张图，我只读到了字，图没进来。';
        cb(null, { kind: 'text', text: r.text.slice(0, MAX_TEXT), name: file.name }, note);
      })
      .catch(function (e) { cb('这个 docx 打不开（' + ((e && e.message) || e) + '）。另存为 PDF 再发也行。'); });
  }

  // ============================================================
  //  .xlsx → 一张表（制表符分隔的文本）
  // ============================================================
  // ★★ 2026-10-08 加。为什么非有不可：学情工位的第一句话是「把成绩表发给我
  //   （智学网导出的那种就行）」，而智学网导出的**就是 .xlsx**。
  //   加它之前，老师拖进来的正是它要的那个文件，屏幕上回一句「把成绩表发给我」——
  //   实测（探针 p/grade_xlsx.json）原文就是这一句。整个工位进不去门。
  //
  // ★ 怎么做到不引任何库：.xlsx 跟 .docx 一样是 **zip**，上面 `unzipEntry` 那套
  //   （原生 DecompressionStream('deflate-raw')）直接能用。要读的只有两个成员：
  //     xl/sharedStrings.xml  —— 字符串池，单元格 `t="s"` 时那个数是**池子的下标**
  //     xl/worksheets/sheet1.xml —— 格子本身
  //   ⚠ 别拿"Excel 文档里大概是这么写的"当事实：下面每一处形状都是拿孔老师机器上
  //     真存的 .xlsx（`22-阅卷工作/第一次月考/…七年级7班.xlsx`、`19-周考成绩/*.xlsx`）
  //     解开看过的——包括**这个文件里的 sharedStrings 是空的（0 条）** 这种情形。
  //
  // ★ 提取的边界，三件明说：
  //   ① **值是数字就写数字**（`118.0` 收成 `118`）。日期在 xlsx 里是数字序列号，
  //      这个格式里**读不成日期**——成绩表里用不着，认了，不硬猜。
  //   ② 多个工作表时**挑格子最多的那张**（实测有的文件 sheet1 是空的、数据在 sheet2），
  //      并在 note 里说一句"这文件里有几张表、读了哪张"，不让它悄悄少读。
  //   ③ 合并单元格、样式、公式**一概不管**：要的是"哪一行哪一列写了什么"。
  function 列号(s) {                       // 'AB' → 27（0 基）
    var n = 0;
    for (var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  function 去标签(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&amp;/g, '&');
  }
  // 一块 XML（`<si>` 或 `<is>`）里的所有 `<t>` 拼起来就是那格的字
  function 池子里字(块) {
    var m = String(块).match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    var s = '';
    for (var i = 0; i < m.length; i++) s += 去标签(m[i].replace(/^<t[^>]*>/, '').replace(/<\/t>$/, ''));
    return s;
  }
  function 读共享串(xml) {
    var out = [];
    if (!xml) return out;
    var si = String(xml).match(/<si\b[\s\S]*?<\/si>/g) || [];
    for (var i = 0; i < si.length; i++) out.push(池子里字(si[i]));
    return out;   // ⚠ 可能是**空数组**（实测真文件里就有），所以下面取值一律带存在性判断
  }
  // 一张 sheet 的 XML → 二维数组
  function 读表(xml, 共享) {
    var rows = [], 行们 = String(xml).match(/<row\b[^>]*>[\s\S]*?<\/row>|<row\b[^>]*\/>/g) || [];
    for (var i = 0; i < 行们.length; i++) {
      var 行号 = 0, mr = 行们[i].match(/<row\b[^>]*\br="(\d+)"/);
      if (mr) 行号 = Number(mr[1]) || 0;
      var 行 = [], 格们 = 行们[i].match(/<c\b[^>]*>[\s\S]*?<\/c>|<c\b[^>]*\/>/g) || [];
      for (var j = 0; j < 格们.length; j++) {
        var c = 格们[j];
        var mc = c.match(/\br="([A-Z]+)\d+"/);
        if (!mc) continue;
        var 列 = 列号(mc[1]);
        // ⚠ 这里必须是 `[A-Za-z]+`：Excel 的单元格类型里有一个 **`inlineStr`**（大写 S），
        //   而它正是孔老师那些成绩表**用得最多**的一种（`<is><t>姓名</t></is>`）。
        //   只写 `[a-z]+` 的话 `inlineStr` **匹配不上** → 类型读成空 → 掉进下面
        //   "普通数字"那一支 → 那格既没有 `<v>` 也没有别的，于是**一个格子一个字都读不出**。
        //   症状极阴：表读出来了、行数对、数字全对，**只有文字列是空的**——
        //   而文字列恰好是「学号／姓名／题号／满分」这些**给表定名分的格子**。
        //   实测（2026-10-08，`node xtest.cjs`，拿他 19-周考成绩、22-阅卷工作 里真存的
        //   7 份 xlsx）：改之前每张表的表头整行是空白；改之后 学号／姓名／分数 都在。
        var 类型 = (c.match(/\bt="([A-Za-z]+)"/) || [,''])[1];
        var v = '';
        if (类型 === 's') {
          var mv = c.match(/<v>([\s\S]*?)<\/v>/);
          var k = mv ? Number(mv[1]) : -1;
          v = (共享 && k >= 0 && k < 共享.length) ? 共享[k] : '';
        } else if (类型 === 'inlineStr') {
          v = 池子里字(c);
        } else {
          var mv2 = c.match(/<v>([\s\S]*?)<\/v>/);
          if (mv2) v = 去标签(mv2[1]);
        }
        v = String(v == null ? '' : v).replace(/\.0+$/, '').replace(/[\t\r\n]+/g, ' ').trim();
        // ★ 浮点噪声：Excel 存的是二进制浮点，`97.65` 取出来会长成 `97.65000000000001`。
        //   原样交给模型，它就照这个念——老师看见屏幕上一串小数位，只会觉得这产品脏。
        //   ⚠ 只在**小数位 ≥8 位**时收，两位三位的真数一个都不碰（成绩表用不着更多位）。
        if (/^-?\d+\.\d{8,}$/.test(v)) {
          var f = Number(v);
          if (isFinite(f)) v = String(Math.round(f * 100) / 100);
        }
        行[列] = v;
      }
      for (var z = 0; z < 行.length; z++) if (行[z] == null) 行[z] = '';
      rows.push({ 行号: 行号 || rows.length + 1, 格: 行 });
    }
    return rows;
  }
  function 记字数(rows) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) for (var j = 0; j < rows[i].格.length; j++) if (rows[i].格[j]) n++;
    return n;
  }
  function 铺成文本(rows) {
    var out = [], W = 0;
    for (var i = 0; i < rows.length; i++) W = Math.max(W, rows[i].格.length);
    for (var k = 0; k < rows.length; k++) {
      var a = rows[k].格.slice(0, W);
      while (a.length < W) a.push('');
      out.push(a.join('\t'));
    }
    return out.join('\n');
  }
  function xlsxPart(file, cb) {
    file.arrayBuffer().then(function (buf) {
      // ① 共享串（可能整个成员都没有）
      return unzipEntry(buf, 'xl/sharedStrings.xml')
        .then(function (x) { return x; }, function () { return ''; })
        .then(function (ssxml) {
          var 共享 = 读共享串(ssxml);
          // ② 工作表：sheet1..sheet6 挨个试，挑"有字的格子最多"的那张
          var 底 = null, 有几张 = 0, 名字 = [];
          var 链 = Promise.resolve();
          for (var n = 1; n <= 6; n++) (function (n) {
            链 = 链.then(function () {
              return unzipEntry(buf, 'xl/worksheets/sheet' + n + '.xml').then(function (x) {
                有几张++;
                var rows = 读表(x, 共享);
                if (记字数(rows) < 2) return;
                名字.push('sheet' + n);
                if (!底 || 记字数(rows) > 底.n) 底 = { n: 记字数(rows), rows: rows, 谁: 'sheet' + n };
              }, function () { /* 这张不存在，跳过 */ });
            });
          })(n);
          return 链.then(function () { return { 底: 底, 有几张: 有几张 }; });
        });
    }).then(function (r) {
      if (!r.底) return cb('这个 xlsx 里没读到内容（可能是空表，或者只有图）。');
      var 文本 = 铺成文本(r.底.rows);
      if (!文本) return cb('这个 xlsx 里没读到内容。');
      var note = '';
      // ★ 多张表时**必须说一句**：不说的话，"读了信息最多的那张"这个选择
      //   就成了一次没有痕迹的取舍——老师以为整份文件都进来了。
      if (r.有几张 > 1) {
        note = file.name + ' 里有 ' + r.有几张 + ' 张表，我读了信息最多的那张（' + r.底.谁 +
               '）。要指定哪一张，把它单独存一个文件再发。';
      }
      cb(null, { kind: 'text', text: 文本.slice(0, MAX_TEXT), name: file.name }, note);
    }).catch(function (e) {
      cb('这个 xlsx 打不开（' + ((e && e.message) || e) + '）。在 Excel 里另存为 CSV 再发也行。');
    });
  }

  // ============================================================
  //  汇总：一批文件 → 一批 parts
  // ============================================================
  // cb(errText, parts, notes)
  //   errText 只有"一个都没读成"的时候才有；单个文件失败进 notes，不打断其余的。
  //   notes 是给人看的一句话，比如"这是一份 12 页的 PDF，先看了前 6 页"。
  function toParts(list, cb) {
    var files = [];
    for (var i = 0; i < list.length && files.length < MAX_FILES; i++) if (list[i]) files.push(list[i]);
    if (!files.length) return cb('没选文件');
    var out = [], notes = [], idx = 0;
    if (list.length > MAX_FILES) notes.push('一次最多 8 个文件，多的先没收。');

    function next() {
      if (idx >= files.length) {
        if (!out.length) return cb(notes.join(' ') || '这几个文件都读不了');
        return cb(null, out, notes.join(' '));
      }
      var f = files[idx++];
      var kind = kindOf(f);
      // ★ part 可能是**一个**（图片、docx）也可能是**一串**（PDF 每页一个）。
      //   第一版只写了 out.push(part)，PDF 那条路就把整串当成了一个元素塞进去：
      //   探针量到 parts.length === 1、元素的 name 是 null，屏幕上那张卷子成了空气。
      //   一个文件产出几条，由各 read* 自己决定，这里照着摊平就行。
      var done = function (err, part, note) {
        if (err) notes.push(f.name + '：' + err);
        else if (part) {
          if (Object.prototype.toString.call(part) === '[object Array]') {
            for (var j = 0; j < part.length; j++) out.push(part[j]);
          } else out.push(part);
          if (note) notes.push(note);
        }
        next();
      };
      if (kind === 'image') return imagePart(f, done);
      if (kind === 'pdf') return pdfParts(f, done);
      if (kind === 'docx') return docxPart(f, done);
      if (kind === 'xlsx') return xlsxPart(f, done);
      if (kind === 'text') {
        f.text().then(function (t) {
          t = String(t || '').trim();
          if (!t) return done('这个文件是空的');
          done(null, { kind: 'text', text: t.slice(0, MAX_TEXT), name: f.name },
               t.length > MAX_TEXT ? (f.name + ' 太长，只读了前 ' + MAX_TEXT + ' 个字。') : '');
        }).catch(function () { done('这个文件读不出来'); });
        return;
      }
      done(WHY[kind] || WHY.unknown);
    }
    next();
  }

  // 给界面用的一句话："3 个文件：2 张图 · 5 页 PDF"
  function describe(parts) {
    var img = 0, doc = 0;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].kind === 'image') img++;
      else if (parts[i].kind === 'text') doc++;
    }
    var bits = [];
    if (img) bits.push(img + ' 张图');
    if (doc) bits.push(doc + ' 份文档');
    return parts.length + ' 个文件：' + bits.join(' · ');
  }

  return {
    toParts: toParts,
    describe: describe,
    kindOf: kindOf,
    shrink: shrink,          // 别的地方要缩图就走它，别各写一份 canvas
    maxFiles: MAX_FILES
  };
})();
