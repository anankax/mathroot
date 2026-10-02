// 「出材料」工位的流程控制。**它是这个工位的"手"，提示词是"嘴"。**
//
// 一条流程（孔老师定的产品前提，一个字不改）：
//     ① 上传模板 → ② 提出要求 → ③ 给出已有的资源 → ④ 它去自己编排内容
//
// 这个文件管三件事：
//   一、**模板库**：传进来 → SR.tpl.parse → 存 IndexedDB → 列出「我认出来的是」
//   二、**认错了能改**：正文用哪个格式号是投票投出来的，投歪了老师得能自己指
//   三、**出材料**：把模型产出的内容（一串 block）交给 SR.produce，产物摆进右栏
//
// ★ 这个文件里**不许出现任何一所学校的名字、任何"抬头长这样"的假设**。
//   换一所学校 = 换一份上传的文件。见 js/tpl.js 顶上那段。
var SR = (window.SR = window.SR || {});

SR.material = (function () {

  var cur = null;          // 当前选中的模板（模板对象，见 SR.tpl.parse 的返回值）
  var lastFeed = null;     // 最近一次喂进来的 { body, title }，收完流之后画配图要用

  function $(id) { return document.getElementById(id); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================================
  //  模板库：列表
  // ============================================================
  function open() {
    paint();
    var f = $('tplfile');
    if (f && !f._bound) {
      f._bound = 1;
      // ★ .docx 一个都不放过：数根**只认 .docx**。
      //   老 .doc（97-2003 二进制）不是 zip，SR.docx.read 读不了。
      //   与其让它抛一个看不懂的错，不如在这儿就说清"另存为 .docx 再传"。
      f.addEventListener('change', function () {
        var file = f.files && f.files[0];
        f.value = '';                    // 同一份文件改完再传要能触发 change
        if (file) take(file);
      });
    }
  }

  function say(msg, kind) {
    var el = $('tplmsg');
    if (!el) return;
    el.textContent = msg || '';
    el.className = kind === 'err' ? 'err' : (kind === 'ok' ? 'ok' : '');
  }

  // ★ 规矩只有一条：**`cur` 一变就调这里**。
  //   产物栏顶上那行「版式：正在用「XX」」是照着 `cur` 写的（SR.paintTpl）。
  //   原来 `cur` 是个纯内存状态、界面上一个字都不说——老师传完模板、刷新一下，
  //   restore 悄悄把它接回来了，而看板还是"通用格式"，他以为模板丢了。
  //   加这一句之后，选／传／删／接回来四条路都会自己重画。
  //   ⚠ 不要因为"某一条路上调用方也会重画"就把某处的 notify 省掉——
  //     少一处，那一处的界面就永远是上一次的值，而没有任何东西会报。
  function notify() {
    if (typeof SR.paintTpl === 'function') SR.paintTpl();
  }

  function paint() {
    if (!SR.tpl) return Promise.resolve();
    return SR.tpl.all().then(function (list) {
      var box = $('tplrows');
      if (!box) return;
      list = (list || []).sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
      if (!list.length) {
        box.innerHTML = '<p class="empty">还没有模板。先传一份你学校给的（.docx）。</p>';
        return;
      }
      box.innerHTML = list.map(function (t) {
        return '<div class="tplrow' + (cur && cur.id === t.id ? ' on' : '') + '" data-id="' + esc(t.id) + '">'
             +   '<div class="nm">' + esc(t.name) + '</div>'
             +   '<div class="sm">' + esc(SR.tpl.summary(t)) + '</div>'
             +   '<div class="act">'
             +     '<button type="button" class="tool usesm" data-use="' + esc(t.id) + '">用这份</button>'
             +     '<button type="button" class="tool usesm" data-del="' + esc(t.id) + '">删掉</button>'
             +   '</div>'
             + '</div>';
      }).join('');
    });
  }

  // 文件 → 解析 → 存 → 摆出「我认出来的是」
  function take(file) {
    if (!SR.tpl || !SR.docx) { say('解析模块没装上，刷新一下页面。', 'err'); return; }
    if (/\.doc$/i.test(file.name)) {
      say('这份是老的 .doc（97-2003 格式），不是 .docx。在 Word 里「另存为」成 .docx 再传。', 'err');
      return;
    }
    say('正在读「' + file.name + '」…');
    var fr = new FileReader();
    fr.onload = function () {
      SR.tpl.parse(fr.result, { name: file.name.replace(/\.docx$/i, '') })
        .then(function (t) {
          return SR.tpl.save(t).then(function () { return t; });
        })
        .then(function (t) {
          cur = t;
          remember(t.id);
          notify();
          say('读好了。下面这张卡是**它认出来的东西**——认错了可以改。', 'ok');
          card(t);
          return paint();
        })
        .catch(function (e) {
          say('这份读不了：' + ((e && e.message) || e), 'err');
        });
    };
    fr.onerror = function () { say('文件没读进来，再试一次。', 'err'); };
    fr.readAsArrayBuffer(file);
  }

  // ============================================================
  //  「我认出来的是」——认出来的每一条都要能给老师看
  // ============================================================
  // ★ 为什么正文格式那一项要摆出来给老师改：
  //   正文用哪个格式号是**在这份模板里投票投出来的**（出现最多的那种段落格式）。
  //   这条假设在大多数卷子模板上成立，但**在一份"填写提示行比正文还多"的模板上会投歪**
  //   ——实测：无锡那两份论文模板，"摘要：／关键词：／一级标题示例／参考文献著录格式"
  //   全是一个格式，18 段，比真正的正文（11 段）还多，于是正文号投到了它头上。
  //   那不是代码错，是那份模板本身没有"正文"这一档。**只有老师知道该用哪一档。**
  function card(t) {
    var box = $('tplcard');
    if (!box) return;
    var slots = t.slots || [];
    var opts = slots.map(function (s) {
      return '<option value="' + s.i + '"' + (s.i === t.bodySlot ? ' selected' : '') + '>'
           + '#' + s.i + '　×' + s.n + ' 段　「' + esc(s.sample || '') + '」</option>';
    }).join('');
    box.innerHTML =
      '<div class="tplcard">'
    +   '<h4>我认出来的是</h4>'
    +   '<dl>'
    +     '<dt>纸张</dt><dd>' + esc(pageText(t)) + '</dd>'
    +     '<dt>抬头</dt><dd>' + (t.headText && t.headText.length
            ? t.headText.map(esc).join('　/　') : '（没认出来，这份应该是空白模板）') + '</dd>'
    +     '<dt>页眉</dt><dd>' + ((t.headers && t.headers[0] && t.headers[0].text) ? esc(t.headers[0].text) : '（没有）') + '</dd>'
    +     '<dt>校徽</dt><dd>' + (t.hasLogo ? '有，在抬头里，出的材料会原样带着' : '（没有）') + '</dd>'
    +     '<dt>切点</dt><dd>' + esc(t.cutHow || '') + '</dd>'
    +   '</dl>'
    +   '<label class="tplpick">正文用哪一种格式<br>'
    +     '<select id="tplbody">' + opts + '</select></label>'
    +   '<p class="hint">上面这些是数根从你这份文件里读出来的。'
    +     '正文那一项认错了，就在这儿换一个——出的材料跟着变。</p>'
    +   '<div class="row"><button type="button" class="tool primary" id="tplsav">就按这个来</button></div>'
    +   '</div>';

    var sel = $('tplbody');
    var ok = $('tplsav');
    if (ok) ok.addEventListener('click', function () {
      if (sel) t.bodySlot = +sel.value;
      SR.tpl.save(t).then(function () {
        say('记住了。以后出材料就按你选的这个来。', 'ok');
        paint();
      });
    });
  }

  function pageText(t) {
    if (!t.page || !t.page.w) return '没认出来';
    var w = Math.round(t.page.w / 56.7) / 10, h = Math.round(t.page.h / 56.7) / 10;
    return w + ' × ' + h + ' cm　' + (t.page.landscape ? '横向' : '纵向')
         + '　左右边距 ' + (Math.round(t.page.left / 56.7) / 10) + ' / ' + (Math.round(t.page.right / 56.7) / 10) + ' cm'
         + '　上下边距 ' + (Math.round(t.page.top / 56.7) / 10) + ' / ' + (Math.round(t.page.bottom / 56.7) / 10) + ' cm';
  }

  // ============================================================
  //  交给模型的那张「格式号表」
  // ============================================================
  // ★★ 这一段就是**通用性**本身。
  //   模型没见过这所学校的模板，但它不需要见过——它只需要知道
  //   "这份模板里有哪几档格式、每档长什么样"，然后**挑号**。
  //   把号套回模板的活是前端干的（js/produce.js 的 blockPara）。
  //   所以换一所学校 = 换一份上传的文件，这一段自动跟着变，代码一行不动。
  //
  // ★ 表里给的是**样例原文**，不是"标题/正文/落款"这种我起的名字——
  //   名字是我猜的，原文是模板自己的。让模型照原文判断，比我贴标签准。
  // ★ 每档的段数（×N）也给：段数最多的那档通常就是正文，
  //   这是给模型的一个旁证，**不是**让它照段数选。
  function slotBrief() {
    if (!cur) {
      return '# 这一轮没有模板\n\n'
           + '老师还没上传他学校的模板。**这一轮不要写 ```材料 围栏**——没有版式可套。\n'
           + '你可以先跟他把要求聊清楚（出什么、哪个章节、多少题、什么难度），'
           + '然后说一句：模板在左边「我的模板」里传一份，传完就能出。';
    }
    var slots = cur.slots || [];
    var rows = slots.map(function (s) {
      var sm = String(s.sample || '').replace(/\s+/g, ' ').slice(0, 46);
      return '  #' + s.i + '　×' + s.n + ' 段　「' + (sm || '（空段）') + '」';
    }).join('\n');
    var body = slots[cur.bodySlot];
    return '# 老师这份模板里认出来的格式\n\n'
      + '下面每一行是一档格式：`#号`、`×几段`、`「模板里长这样的一段原文」`。\n\n'
      + rows + '\n\n'
      + '正文（题干、选项、说明性的句子）默认用 **#' + cur.bodySlot + '**'
      + (body ? '（「' + String(body.sample || '').replace(/\s+/g, ' ').slice(0, 30) + '」这一档）' : '')
      + '。\n'
      + '大题标题（"一、选择题"那种）用**跟它的字体最像的那一档**；'
      + '**判断不了就一律用 #' + cur.bodySlot + '**，别猜。\n'
      + '要一段空白，就写一个号和空格、后面什么都不写（`#' + cur.bodySlot + '`），'
      + '空白段用的是模板自己的空段格式，写哪个号都一样。'
      + '★ 别用空行代替空段——空行不算数，会被丢掉。\n\n'
      + '★ **只能用上面出现过的号。** 表里没有的号一律不许写。';
  }

  // ============================================================
  //  出材料
  // ============================================================
  // blocks 的形状见 js/produce.js 顶上那段。产物落进右栏 #out。
  function use(id) {
    return SR.tpl.all().then(function (list) {
      var t = (list || []).filter(function (x) { return x.id === id; })[0];
      if (!t) return null;
      cur = t;
      remember(t.id);
      notify();
      say('好，接下来出材料就用「' + t.name + '」这份版式。', 'ok');
      return paint().then(function () { return t; });
    });
  }

  // ---- 记住用的是哪一份 ----
  // ★ 为什么非记不可：模板存在 IndexedDB 里，而 `cur` 是内存里的。
  //   **刷新一次页面，模板就"没选中"了**——老师传完模板、刷新一下，
  //   再说一句"出第五周的周练卷"，模型拿到的格式号表是空的，
  //   它就会正常跟你聊天、什么都不出。老师看到的是"它坏了"。
  //   验收线是「打开就能直接印」，那就得**开机自己接上**。
  var LS_TPL = 'mathroot_tpl';
  function remember(id) {
    try { localStorage.setItem(LS_TPL, String(id)); } catch (e) {}
  }

  // 开机调一次：把上次用的那份接回来。没记过就挑最近存的一份——
  // 一个老师手上常常就一份模板（他学校给的那份），不该每次开机都让他再点一次。
  function restore() {
    if (!SR.tpl) return Promise.resolve(null);
    var want = '';
    try { want = localStorage.getItem(LS_TPL) || ''; } catch (e) {}
    return SR.tpl.all().then(function (list) {
      list = list || [];
      if (!list.length) return null;
      var t = null;
      for (var i = 0; i < list.length; i++) if (list[i].id === want) t = list[i];
      if (!t) {                                  // 记的那份被删了 → 退回最近的一份
        t = list.slice().sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); })[0];
      }
      if (!t) return null;
      cur = t;
      remember(t.id);
      notify();
      return t;
    }).catch(function () { return null; });
  }

  function drop(id) {
    return SR.tpl.remove(id).then(function () {
      if (cur && cur.id === id) {
        cur = null;
        try { localStorage.removeItem(LS_TPL); } catch (e) {}
        notify();
      }
      return paint();
    });
  }

  // 把一份材料摆到右栏。★ 用 SR.produce 生成的是**同一份 blocks**——
  //   右栏预览和下载下来的 docx 出自同一个中间结构，所以
  //   "预览里看着对、下载下来不对"这种事不会发生。
  function show(tpl, blocks, title, note) {
    var box = $('out');
    if (!box || !SR.produce) return null;
    // ★ 打包放在更新 DOM **之前**：现在图是字节，进 `SR.docx.write` 那一步。
    //   顺序反了的话，界面先显示出"已就绪"，文件其实还没拼出来；
    //   中间要是抛错，老师看到的就是"右栏好端端的、点下载没反应"。
    var blob = SR.produce.build(tpl, blocks);
    var bad = SR.produce.check(tpl, blocks);
    var name = (title || tpl.name || '材料') + '.docx';
    box.innerHTML =
      '<div class="outhead">'
    +   '<div class="nm">' + esc(name) + '</div>'
    +   '<div class="act">'
    +     '<button type="button" class="tool" id="outpv">预览</button>'
    +     '<button type="button" class="tool primary" id="outdl">下载 .docx</button>'
    +   '</div>'
    + '</div>'
    + (note ? '<p class="figwait">' + esc(note) + '</p>' : '')
    + (bad.length
        ? '<p class="err">有 ' + bad.length + ' 处要修：' + esc(bad.map(function (b) { return b.why; }).join('；')) + '</p>'
        : '')
    + '<div class="pvwrap" id="outpvbox">' + SR.produce.previewHtml(tpl, blocks) + '</div>';

    var d = $('outdl');
    if (d) d.addEventListener('click', function () { SR.produce.save(tpl, blocks, name); });
    var p = $('outpv');
    var pv = $('outpvbox');
    if (p && pv) p.addEventListener('click', function () {
      var on = pv.style.display !== 'none';
      pv.style.display = on ? 'none' : '';
      p.textContent = on ? '预览' : '收起预览';
    });
    return blob;
  }

  // 模型吐的 ```材料 围栏 → 右栏产物。
  // ★ 它**在流式过程里会被反复调用**（每收到一截正文就重画一次），
  //   所以这里必须是纯的：不弹提示、不写库、不滚屏——只重画右栏。
  //   一份两百行的卷子，老师是看着它一行行长出来的，这比转圈等半天好得多。
  //
  // ⚠ 返回 {ok, n, bad}：调用方（chat.js）拿它判断"这一轮到底出没出材料"。
  //   **不许拿"有没有收到围栏"当判据**——免费通道那几颗小模型掉围栏是常事，
  //   那种时候 fed.ok 是 false，界面得给老师一句人话，不能默默什么都不动。
  function feed(body, title) {
    if (!cur) return { ok: false, why: '没有选中模板' };
    if (!SR.produce) return { ok: false, why: '出材料的模块没装上' };
    var blocks = SR.produce.parseBlocks(body);
    if (!blocks.length) return { ok: false, why: '空的' };
    lastFeed = { body: body, title: title };
    show(cur, blocks, title);
    return { ok: true, n: blocks.length, bad: SR.produce.check(cur, blocks) };
  }

  // ============================================================
  //  收完流之后：把这一轮要的配图画出来
  // ============================================================
  // ★ 为什么**不能**放在 feed 里顺手做：feed 在流式当中每收到一截正文就被调一次，
  //   而画一张图要几秒（命令 550ms 一条排着走）。在 feed 里画，一份两百行的卷子
  //   会让画板反复重画几十遍——老师看着画板抽风，卷子半天出不来。
  //   所以分成两拍：**流式期间只摆文字**（要图的那一行先摆一句"图还没画出来"），
  //   **收完流再画**，画完把右栏重摆一遍。
  //
  // ★ 一张没画出来就**把那一行撤掉**，绝不硬塞：卷子上写着"如图"、后面空着，
  //   是比少一道题更坏的坏法。撤了要**说给老师听**（返回值里的 dropped）。
  function dropDeadFigs(blocks) {
    var out = [], dropped = 0;
    (blocks || []).forEach(function (b) {
      if (b && b.fig && !(SR.figures && SR.figures.get(b.fig))) { dropped++; return; }
      out.push(b);
    });
    return { blocks: out, dropped: dropped };
  }

  function finish(cb) {
    if (!cur || !lastFeed || !SR.produce || !SR.figures) { if (cb) cb(null); return; }
    var body = lastFeed.body, title = lastFeed.title;
    var blocks = SR.produce.parseBlocks(body);
    var st = SR.figures.stats(blocks);
    if (!st.need || st.ok === st.need) { if (cb) cb({ need: st.need, dropped: 0 }); return; }

    SR.figures.drawAll(blocks,
      function (i, n) {                       // 每画完一张，把进度摆出来
        // ★ 这儿得**重新解析** lastFeed.body：模型流式期间可能又补了几行，
        //   拿着画图开始时那一份重画，会把后长出来的东西吃掉。
        show(cur, SR.produce.parseBlocks(lastFeed.body), title,
             '正在画第 ' + i + '/' + n + ' 张图…');
      },
      function () {
        var rt = dropDeadFigs(SR.produce.parseBlocks(lastFeed.body));
        show(cur, rt.blocks, title);
        if (cb) cb({ need: st.need, dropped: rt.dropped });
      });
  }

  // 点按钮的分发（事件委托，paint 重画之后不用重新绑）
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-use],[data-del]') : null;
    if (!el) return;
    var u = el.getAttribute('data-use'), d = el.getAttribute('data-del');
    if (u) use(u);
    if (d) drop(d);
  });

  return {
    open: open, use: use, drop: drop, show: show, slotBrief: slotBrief,
    feed: feed, finish: finish,
    restore: restore,
    current: function () { return cur; },
    // 目前没有调用方。留着它，但**也走 notify()**——绕过通知的口子只要开一条，
    // 界面就会在"没人记得要走 notify"的那条路上停在旧值上。
    setCurrent: function (t) { cur = t; notify(); }
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.material;
