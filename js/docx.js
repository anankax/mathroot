// .docx 的读和写。**纯前端，不引任何库。**
//
// 为什么要有这个文件：
//   老师上传自己学校的模板（一份排好版的 .docx），我们要
//     **继承它的版式**（页边距、字体表、页眉页脚、校徽、样式名），
//     **重写它的正文**，再原样打包成一份新的 .docx 让他下载。
//   `js/files.js` 里那套只够"读一条正文出来当字看"，写不了。
//
// ★ .docx 就是一个 zip。读用浏览器原生的 DecompressionStream('deflate-raw')；
//   写用**不压缩（stored）**——Word 完全接受，而且省掉整个 deflate 实现。
//   实测过：stored 的 docx Word 打开正常（test/_spike_docx.cjs）。
//
// ★ 两条已知的"Word 说文件损坏"，都在**写**这一头：
//   ① 新加的图片必须在 word/_rels/document.xml.rels 里注册；
//   ② 新加的扩展名必须在 [Content_Types].xml 里有 Default 项。
//   本文件只负责 zip 和字节，那两件事在 js/produce.js 里做。
var SR = (window.SR = window.SR || {});

SR.docx = (function () {

  var enc = new TextEncoder();
  var dec = new TextDecoder('utf-8');

  function str(u8) { return dec.decode(u8); }
  function bytes(s) { return enc.encode(s); }

  // 统一成 ArrayBuffer。Node 的 Buffer 是带 byteOffset 的 Uint8Array 视图，
  // 直接 new Uint8Array(buf, off, len) 会从**底层**那个大 buffer 算起，位置全错。
  function toAB(buf) {
    if (buf instanceof ArrayBuffer) return buf;
    var u = buf;
    return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
  }

  // ---- CRC32（zip 每个条目都要）----
  var CRC_T = null;
  function crcTable() {
    if (CRC_T) return CRC_T;
    CRC_T = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_T[n] = c >>> 0;
    }
    return CRC_T;
  }
  function crc32(u8) {
    var t = crcTable(), c = -1;
    for (var i = 0; i < u8.length; i++) c = (c >>> 8) ^ t[(c ^ u8[i]) & 0xFF];
    return (c ^ -1) >>> 0;
  }

  // ---- 解压一个 deflate 流 ----
  // 浏览器：DecompressionStream。Node（跑测试用）：zlib。
  var nodeZlib = null;
  try { nodeZlib = require('zlib'); } catch (e) { /* 浏览器里没有 require，正常 */ }

  function inflateRaw(u8) {
    if (nodeZlib) {
      return Promise.resolve(new Uint8Array(nodeZlib.inflateRawSync(u8)));
    }
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('这个浏览器不支持解压 docx'));
    }
    var ds = new DecompressionStream('deflate-raw');
    return new Response(new Blob([u8]).stream().pipeThrough(ds))
      .arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  // 解一条 deflate 条目，解出来塞进 map。名字靠参数绑，不用闭包陷阱那套。
  function inflateIn(name, raw, map) {
    return inflateRaw(raw).then(function (d) { map[name] = d; },
      function (e) {
        throw new Error('docx 里「' + name + '」解不开：' + ((e && e.message) || e));
      });
  }

  // ============================================================
  //  读：把整个 docx 拆成 { 名字 → 字节 }
  // ============================================================
  // 返回 Promise<{ 顺序:[名字…], get(名字)->Uint8Array }>
  // ★ 目录条目（名字以 / 结尾）也原样留着——重打包时照着搬，别自作聪明过滤。
  function read(buf) {
    return new Promise(function (resolve, reject) {
      var ab = toAB(buf);
      var dv = new DataView(ab), len = ab.byteLength;

      // 尾部找 EOCD（0x06054b50）。后面可能挂 zip 注释，最长 65535，所以往回扫。
      var eocd = -1;
      for (var i = len - 22; i >= 0 && i >= len - 22 - 65535; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd < 0) return reject(new Error('不是有效的 docx（找不到 zip 结尾）'));

      var n = dv.getUint16(eocd + 10, true);
      var p = dv.getUint32(eocd + 16, true);
      var order = [], map = {}, jobs = [];

      for (var k = 0; k < n; k++) {
        if (dv.getUint32(p, true) !== 0x02014b50) {
          return reject(new Error('docx 的结构读坏了（中央目录）'));
        }
        var method = dv.getUint16(p + 10, true);
        var csize = dv.getUint32(p + 20, true);
        var usize = dv.getUint32(p + 24, true);
        var fnLen = dv.getUint16(p + 28, true);
        var exLen = dv.getUint16(p + 30, true);
        var cmLen = dv.getUint16(p + 32, true);
        var lho = dv.getUint32(p + 42, true);
        var name = dec.decode(new Uint8Array(ab, p + 46, fnLen));

        // 局部头里还有一份文件名和 extra，长度**可能跟中央目录不一样**，以局部头为准。
        var lfn = dv.getUint16(lho + 26, true);
        var lex = dv.getUint16(lho + 28, true);
        var start = lho + 30 + lfn + lex;
        // 有 data descriptor 的条目，中央目录里的 csize 可能是 0，用 usize 兜一下。
        var size = csize || usize;
        // 复制一份出来：下面有 async，指向原 buffer 的视图不保险。
        var raw = new Uint8Array(ab.slice(start, start + size));

        order.push(name);
        if (method === 0) {
          map[name] = raw;
        } else if (method === 8) {
          jobs.push(inflateIn(name, raw, map));
        } else {
          return reject(new Error('这个 docx 用了不认识的压缩方式（method ' + method + '）'));
        }
        p += 46 + fnLen + exLen + cmLen;
      }

      Promise.all(jobs).then(function () {
        resolve({
          顺序: order,
          get: function (nm) { return map[nm]; },
          map: map
        });
      }, reject);
    });
  }

  // ============================================================
  //  写：{ 名字 → 字节 } → 一个 zip（不压缩）
  // ============================================================
  // files: [{ name: 'word/document.xml', data: Uint8Array }, …]
  // ★ 顺序要跟读进来的一致（[Content_Types].xml 排最前最保险）。
  function write(files) {
    var parts = [], central = [], offset = 0;

    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var data = f.data || new Uint8Array(0);
      var crc = crc32(data);

      // ---- 局部头（30 字节 + 名字）----
      var lh = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);          // version needed
      lv.setUint16(6, 0x0800, true);      // 位 11：文件名按 UTF-8 解
      lv.setUint16(8, 0, true);           // method 0 = stored
      lv.setUint16(10, 0, true);          // 时间
      lv.setUint16(12, 0x0021, true);     // 日期 1980-01-01（zip 的零点）
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      // ---- 中央目录项（46 字节 + 名字）----
      var ch = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);          // version made by
      cv.setUint16(6, 20, true);          // version needed
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);          // method
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x0021, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);          // extra
      cv.setUint16(32, 0, true);          // comment
      cv.setUint16(34, 0, true);          // 起始磁盘号
      cv.setUint16(36, 0, true);          // 内部属性
      cv.setUint32(38, 0, true);          // 外部属性
      cv.setUint32(42, offset, true);     // 局部头偏移
      ch.set(nameBytes, 46);

      parts.push(lh, data);
      central.push(ch);
      offset += lh.length + data.length;
    });

    var cdSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    var all = parts.concat(central).concat([eocd]);
    var total = all.reduce(function (a, x) { return a + x.length; }, 0);
    var out = new Uint8Array(total), at = 0;
    all.forEach(function (x) { out.set(x, at); at += x.length; });
    return out;
  }

  // ---- 顺手：改一条条目，其余原样搬 ----
  // 这是"继承版式、重写正文"最常用的动作：只换 word/document.xml，
  // 别的一个字节都不动。
  function replace(files, name, data) {
    var hit = false;
    var out = files.map(function (f) {
      if (f.name === name) { hit = true; return { name: f.name, data: data }; }
      return f;
    });
    if (!hit) out.push({ name: name, data: data });
    return out;
  }

  // ---- 浏览器里存盘（Node 下没有 document，别调）----
  //
  // ★★ 2026-10-02：MIME 从写死改成参数（`saveBytes`），`save` 只是它的一个薄壳。
  //   起因是这个写入器现在有**两个出口**：`.docx`（wordprocessingml）和 `.zip`
  //   （打包带走，见 js/pack.js）。一个 zip 和一个 docx **本来就是同一个容器**，
  //   差别只有扩展名和 MIME。要是照着这段再抄一份 `.zip` 版，
  //   抄出来的不只是那三行 Blob——把 `setTimeout(revoke, 3000)` 那个坑
  //   （见下面那段注释）也一起抄了，而两处早晚会漂。
  //
  // ⚠ `revokeObjectURL` 不能立刻调：`a.click()` 之后浏览器还要回头去读这个 URL，
  //   当场撤掉会得到一个"点了没反应／下载失败"的空档。3 秒是留够的。
  function saveBytes(u8, filename, mime) {
    var blob = new Blob([u8], { type: mime || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  function save(u8, filename) {
    saveBytes(u8, filename,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  return {
    read: read, write: write, replace: replace, save: save, saveBytes: saveBytes,
    str: str, bytes: bytes, crc32: crc32, inflateRaw: inflateRaw
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.docx;
