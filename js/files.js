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
    if (/\.(txt|md|csv|json)$/.test(n) || /^text\//.test(t)) return 'text';
    if (/\.doc$/.test(n)) return 'doc-old';
    if (/\.(ppt|pptx|xls|xlsx)$/.test(n)) return 'office';
    return 'unknown';
  }

  var WHY = {
    'doc-old': '.doc 是 Word 的老格式，浏览器读不了。用 Word 打开，另存为 PDF 或者 .docx 再发。',
    'office': '.pptx / .xls 读不了。截图，或者另存为 PDF 再发。',
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
      .then(function (xml) { return xmlToText(xml); })
      .then(function (text) {
        if (!text) return cb('这个 docx 里没读到字（可能是纯图片排的版），截个图发也行。');
        cb(null, { kind: 'text', text: text.slice(0, MAX_TEXT), name: file.name });
      })
      .catch(function (e) { cb('这个 docx 打不开（' + ((e && e.message) || e) + '）。另存为 PDF 再发也行。'); });
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
