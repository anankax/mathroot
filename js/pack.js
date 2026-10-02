// 打包：把这一节课的**图和全程文字**装成一个 .zip 带走。
//
// 为什么要有它（孔老师 2026-10-02 的原话）：
//   「生成一个包含了思维导图和需要的各种图形或者题目演示的图片的压缩包文件」
// 链子摆在屏幕上，老师要把它带进教案、带进备课组的共享盘、带回家。
// 「复制这段」只能带文字，图还得一张张去点「存图」——一节课十几张，
// 存完还得自己一张张改名。这一颗按钮把这两件事合成一次。
//
// ★★ 坑一：**容器不重写。**
//   js/docx.js 本身就是一个 store-only 的 ZIP 写入器，而且每件事都做对了
//   （CRC 查表、两个头都把位 11 `0x0800` 置上让中文名按 UTF-8 解、
//   EOCD 两个偏移是绝对的）。一个 .zip 和一个 .docx **本来就是同一个容器**，
//   只差扩展名和 MIME。再写一个八十行的写入器，就是把这份已经被 Word 验证过的
//   代码抄第二遍——而抄出来的那份没有任何东西在用它，坏了也不会有人报。
//
// ★★ 坑二：**CRC 必须算在字节上。** 见 js/figures.js 的 bytesOf 那段。
//
// ★★ 坑三：**.md 必须带 UTF-8 BOM。** 老师在 Windows 上双击 .md，
//   默认打开它的是记事本。没有 BOM 的话，记事本会按系统默认代码页（GBK）解，
//   一整篇中文全是乱码——而"打开就是乱码"这件事，老师不会觉得是编码问题，
//   他会觉得**这个文件是坏的**。三个字节换一条命，值。
//
// ★ 它是**会话级**的，不是"这一条回复"级的：包里装的是从头到点击处为止
//   全部的图和全文。挂在「复制这段」旁边（见 js/chat.js 的 attachCopy），
//   是因为老师想"带走"这个念头就是在那时候冒出来的，而且
//   「复制这段」＝**这一段**文字带走、「打包」＝**到这一段为止整包**带走，
//   两个刻度挨着放，不用学第二个地方。
var SR = (window.SR = window.SR || {});

SR.pack = (function () {

  // 每一条助手回复：{ visible: 老师在气泡上看到的那份文字, ggb: [围栏里的命令串] }
  // ★ 存 visible（不是 raw）的理由跟「复制这段」一模一样，见 js/chat.js 里那段：
  //   包里那份是要贴进教案的，不能夹着 `A=(-2,0)` 这种给画板看的命令。
  var turns = [];
  var topic = '';          // 这一场的第一句话，用来给压缩包起名

  function reset() { turns = []; topic = ''; }

  function setTopic(t) { if (!topic && t) topic = String(t); }

  // 记下一条回复，返回它的序号（打包时按序号取"到这一段为止"）。
  function note(visible, ggb) {
    turns.push({ visible: String(visible || ''), ggb: (ggb || []).slice() });
    return turns.length - 1;
  }

  // ---- 名字 ----
  //
  // ★ 压缩包叫什么：拿这一场的课题。
  //   ⚠ 必需过一遍 `\ / : * ? " < > |` 那九个字符——它们在 Windows 上**根本建不出文件**
  //     （不是显示成别的，是存不下来，浏览器会静默失败或者给个 "未确认的下载"）。
  //     课题是老师自己打的字，完全可能带着 "/"（"3.1 代数式的值/第二课时"）。
  //   ⚠ 名字末尾的点和空格也是非法的（Windows 会把它们悄悄吃掉，然后文件名对不上）。
  var BAD = /[\\\/:*?"<>|]/g;
  function fileName(t) {
    var s = String(t == null ? topic : t)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(BAD, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24)
      .replace(/[. ]+$/, '')
      .trim();
    return '数根-' + (s || '这一课') + '.zip';
  }

  // ---- 一张图叫什么 ----
  //
  // ★ 序号打头（`01-`、`02-`…）**不是装饰**：解压出来的默认排序就是链子的顺序，
  //   也就是课上讲的顺序。不编号的话，`数轴.png` 和 `动点.png` 谁先谁后看不出来。
  // ★ 名字从命令里认，认不出来就叫「图」——**绝不硬猜**。
  //   把抛物线叫成「数轴」比叫「图 3」坏得多：老师会以为是自己存错了。
  //   所以下面每一条的关键词都挑得**很窄**（整词、带括号、带井号），宁可认不出。
  // ⚠ 这一段和阶段三的页名推断（`SR.tabs.titleFor`）是**同一件事**。
  //   做那时候把这份合过去，别留两套"从命令认内容"的规则——两套就是两个真源。
  var SHAPES = [
    [/#三维/,              '立体图'],
    [/Slider\s*\(/,        '动点'],
    [/Circle\s*\(/,        '圆'],
    [/Polygon\s*\(/,       '多边形'],
    [/[xyf]\s*\(?\s*x\s*\)?\s*=|x\s*\^\s*2/, '函数图象']
  ];
  function shapeOf(cmds) {
    var s = String(cmds || '');
    for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i][0].test(s)) return SHAPES[i][1];
    return '图';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ---- 这一包里该有哪几张图（纯函数，node 里能测） ----
  // 同一串命令在链子里出现两次（"再看一眼刚才那张图"）只收一张。
  function figures(upto) {
    var out = [], seen = {};
    var end = (upto == null ? turns.length - 1 : upto);
    for (var i = 0; i <= end && i < turns.length; i++) {
      var g = turns[i].ggb || [];
      for (var j = 0; j < g.length; j++) {
        var k = (SR.figures && SR.figures.key) ? SR.figures.key(g[j]) : String(g[j]).trim();
        // ★ 只有 `#清空` 的围栏不算图（模型空发一个围栏是常态，见 chat.js 里 ggbReal 那段）
        var has = g[j].split('\n').some(function (s) {
          s = s.trim();
          return s && s.charAt(0) !== '#' && !/^(清空|隐藏|显示|三维|平面|播放)/.test(s);
        });
        if (!has || seen[k]) continue;
        seen[k] = 1;
        out.push(g[j]);
      }
    }
    return out;
  }

  // ---- 全程文字 ----
  function markdown(upto) {
    var end = (upto == null ? turns.length - 1 : upto);
    var parts = [];
    for (var i = 0; i <= end && i < turns.length; i++) {
      var t = turns[i].visible.trim();
      if (t) parts.push(t);
    }
    // ⚠ 空场也**要出这个文件**：老师点了打包，包里却连一个文字文件都没有，
    //   他会以为打包坏了。（那种情况下面 make() 会另外说一句"没有东西可打"。）
    return '# 备课全程\n\n' + parts.join('\n\n---\n\n') + '\n\n---\n\n© 2026 KAX · 数根 mathroot\n';
  }

  // 加 BOM（理由见顶上"坑三"）
  function withBom(s) {
    var body = new TextEncoder().encode(s);
    var out = new Uint8Array(body.length + 3);
    out[0] = 0xEF; out[1] = 0xBB; out[2] = 0xBF;
    out.set(body, 3);
    return out;
  }

  function zip(files) {
    return SR.docx.write(files);
  }

  // ---- 打一个包 ----
  //   upto   到第几条回复为止（null = 全部）
  //   onStep(现在第几张, 一共几张)   进度，界面拿它写状态栏
  //   cb({ ok, name, bytes, figs, missed, why })
  //
  // ★ 全程**不弹窗、不写库**，只有最后一步 save 会碰 DOM。
  //   所以探针可以先 make 拿到字节，自己拿去验，不惊动下载。
  function make(upto, onStep, cb) {
    if (typeof onStep === 'function') onStep(0, 0);
    var list = figures(upto);
    var md = markdown(upto);
    var body = md.replace(/^#\s*备课全程\s*/, '').trim();

    if (!list.length && !body) {
      cb({ ok: false, why: '还没有东西可以打包——先在对话里摆出几节，或者让它画张图。' });
      return;
    }

    var files = [], i = 0, missed = 0;

    function next() {
      if (i >= list.length) return finish();
      var n = i + 1, cmds = list[i];
      if (onStep) onStep(n, list.length);
      // ★ 一张张按顺序画，不是并行：画板只有一块，并行画 = 几张图互相覆盖，
      //   每张截到的都是别人的半成品。
      SR.board.draw(SR.figures.linesOf(cmds), function (ok) {
        if (!ok) { missed++; i++; next(); return; }
        SR.board.shootMarked(function (url) {
          if (url) {
            files.push({
              name: pad2(n) + '-' + shapeOf(cmds) + '.png',
              data: SR.figures.bytesOf(url)
            });
          } else {
            missed++;
          }
          i++;
          next();
        });
      });
    }

    function finish() {
      files.push({ name: '备课全程.md', data: withBom(md) });
      // ★ 画完这么多张，画板正停在**最后画的那一张**上。而老师点打包之前，
      //   板上是这一场最后一张图。要是他点的是中间某一条的「打包」，
      //   上面那一轮就会把画板换掉——所以这里补一次，把最后那张再画回来。
      var last = turns.length ? (turns[turns.length - 1].ggb || []) : [];
      if (last.length) {
        try { SR.board.run(SR.figures.linesOf(last[last.length - 1])); } catch (e) {}
      }
      cb({
        ok: true, name: fileName(), bytes: zip(files),
        figs: files.length - 1, missed: missed
      });
    }

    next();
  }

  // 存盘。★ MIME 换成 zip 的：浏览器照它决定"双击用什么打开"，
  //   写成 docx 那种会变成"用 Word 打开一个压缩包"。
  function save(name, bytes) {
    SR.docx.saveBytes(bytes, name, 'application/zip');
  }

  return {
    note: note, setTopic: setTopic, reset: reset,
    fileName: fileName, shapeOf: shapeOf, figures: figures, markdown: markdown,
    withBom: withBom, make: make, save: save,
    count: function () { return turns.length; },
    // 测试用：直接塞一批回复进去，不走界面（界面那条路见 js/chat.js 的 submit）
    __seed: function (list, t) { reset(); topic = t || ''; (list || []).forEach(function (x) { note(x.visible, x.ggb); }); }
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.pack;
