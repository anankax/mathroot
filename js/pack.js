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
  //   把抛物线叫成「数轴」比叫成「图 3」坏得多：老师会以为是自己存错了。
  //
  // ★★ 这份表已经**搬走了**（2026-10-02），现在只有一份，在 js/tabs.js 的
  //   `SR.tabs.shapeOf`。原来这儿抄过一份、标签页那边又有一份——同一张图，
  //   标签上叫「函数图象」、包里叫「抛物线」，老师会以为存错了。两套规则就是两个真源，
  //   而**坏掉的那一套不会有任何人报**（图片名错一个字，没人会来告诉你）。
  //   只差一个兜底词：那边认不出来回**空串**（它还要接着去试"图 N"），
  //   这边回**「图」**（文件名里不能是空的）。就这一处差别，写在下面一行里。
  function shapeOf(cmds) {
    var t = (SR.tabs && SR.tabs.shapeOf) ? SR.tabs.shapeOf(cmds) : '';
    return t || '图';
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

  // 这一包正占着画板吗。board.js 的 `jobBusy()` 读它——打包要几十秒，
  // 这期间老师点标签换页会被挡一下（挡的时候会说清是为什么），总好过两边在
  // 同一块板上画，各画出一半。
  var busy = false;
  function isBusy() { return busy; }

  // ---- 打一个包 ----
  //   upto   到第几条回复为止（null = 全部）
  //   onStep(现在第几张, 一共几张)   进度，界面拿它写状态栏
  //   cb({ ok, name, bytes, figs, missed, back, why })
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

    // ★★ 借画板画，画完还回去（`SR.board.offscreenJob`）。
    //
    //   改之前是这样：这里一张张图**直接画在老师眼前那块板上**，画完再把
    //   "最后一张图"重画一遍当作收场。两件事都坏：① 打一次包，老师看着画板
    //   被洗了十几遍（他这时候多半正对着某张图讲）；② 那个收场只把**最后一张**
    //   画回去，如果他点的是中间某一条的「打包」，画板就永远停在了那一串的最后一张。
    //   ⚠ 也**不许**用 `SR.board.draw`：那是排队进串行链的公开口，而这条链现在
    //     正握在自己手里——那就成了自己等自己，卡死。借来的 `draw` 是没上锁的那个。
    busy = true;
    SR.board.offscreenJob(function (draw, done) {
      var files = [], i = 0, missed = 0;
      (function next() {
        if (i >= list.length) return done({ files: files, missed: missed });
        var n = i + 1, cmds = list[i];
        if (onStep) onStep(n, list.length);
        // ★ 一张张按顺序画，不是并行：板只有一块，并行画 = 几张图互相覆盖，
        //   每张截到的都是别人的半成品。
        draw(SR.figures.linesOf(cmds), function (ok) {
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
      })();
    }, function (r) {
      busy = false;
      if (!r.ok) {
        cb({ ok: false, why: '没打成包：' + (r.why || '画板腾不开') });
        return;
      }
      var files = r.res.files;

      // ---- 思维导图（见 js/mindmap.js 的四点五）----
      //
      // ★ 孔老师 2026-10-02 的原话里，这一张和那些图是**并列**要的两件东西：
      //   「生成一个包含了思维导图和需要的各种图形或者题目演示的图片的压缩包文件」。
      //   链子的账在导图里，一节课的图在那几个 `01-` 里，两样都得能带走。
      // ★ 排在**最前面**（unshift）：它是这一课的**总览**，不是第 1 步。
      //   （解压软件多半按名字排，`01-` 那几个会排到它前面，那也没错——
      //    数字打头的本来就该是讲的顺序。两种排法都说得通，不折腾。）
      // ★★ 这一步**不碰画板**，所以放在 offscreenJob 外面：
      //   导图是自己开一块 canvas 画的（跟"存图"同一套做法），
      //   塞进去借画板反而多一层"等板子腾开"的风险。
      // ★ 拿不到就当没有（toPNG 空场回空串，不抛）——**为了导图把整个包弄失败
      //   是最差的结果**：老师和图都在，缺的只是一张总览。
      var mm = false, mmUrl = '';
      try { mmUrl = (SR.mm && SR.mm.toPNG) ? String(SR.mm.toPNG() || '') : ''; } catch (e) { mmUrl = ''; }
      if (mmUrl) {
        try {
          files.unshift({ name: '思维导图.png', data: SR.figures.bytesOf(mmUrl) });
          mm = true;
        } catch (e) { mm = false; }
      }

      files.push({ name: '备课全程.md', data: withBom(md) });
      cb({
        ok: true, name: fileName(), bytes: zip(files),
        // ★ figs 数是**图上**的张数（含导图）。真正装进包里的图片文件
        //   = files.length - 1（那一个是 .md）。两句是同一个数，不是巧合：
        //   → 唯一能进 files 的只有 "01-…png"、"思维导图.png" 和 "备课全程.md"。
        figs: files.length - 1, mm: mm, missed: r.res.missed,
        // ★ 还回去了没有。没还回去（开场那份快照就没取到）时画板停在这一串的最后一张，
        //   跟改之前一样——但界面得**说出来**，不然老师会以为画板自己乱跳了。
        back: r.back !== false
      });
    });
  }

  // 存盘。★ MIME 换成 zip 的：浏览器照它决定"双击用什么打开"，
  //   写成 docx 那种会变成"用 Word 打开一个压缩包"。
  function save(name, bytes) {
    SR.docx.saveBytes(bytes, name, 'application/zip');
  }

  return {
    note: note, setTopic: setTopic, reset: reset,
    fileName: fileName, shapeOf: shapeOf, figures: figures, markdown: markdown,
    withBom: withBom, make: make, save: save, isBusy: isBusy,
    count: function () { return turns.length; },
    // ★ 2026-10-02 露给思维导图用（js/mindmap.js 的 refresh）。
    //   导图画的**就是这一份账**——一个回合一条、带这一回合画出来的图。
    //   导图那边另记一份的话，"打包里的图和导图上的图对不上"这种事
    //   没有任何东西会报（它不会崩，只会慢慢地不对）。
    turns: function () { return turns; },
    topic: function () { return topic; },
    // 测试用：直接塞一批回复进去，不走界面（界面那条路见 js/chat.js 的 submit）
    __seed: function (list, t) { reset(); topic = t || ''; (list || []).forEach(function (x) { note(x.visible, x.ggb); }); }
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.pack;
