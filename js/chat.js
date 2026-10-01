// 对话层：气泡、流式、把围栏派给画板、可选回答、拍照。
var SR = (window.SR = window.SR || {});

SR.chat = (function () {

  var els = {};
  var history = [];          // [{role, content}] —— 发给模型的上下文
  var busy = false;
  var work = SR.DEFAULT_WORK || 'prep';
  // 上下文条数的粗兜底。**真正管用的那道闸在 api.js 里**——免费通道只有 16K，
  // 得按 token 裁（trimHistory），按条数裁是挡不住"贴一道长题干"的。
  var MAX_TURNS = 24;
  var lastFail = null;       // 上一轮失败的提问，切完 Key 可以一键重发

  // 开场白。★ 每个工位**一句话**，就这么长。
  //   2026-10-01 孔老师定了两回，第二回是骂醒的：她要的就是「告诉我你的问题」这一句。
  //   ★ 别再加第二句。加什么都算跑偏，试过两版都是这个下场：
  //     · 自述式（"我不判对错、不给答案、只顺着你的思路往下问…"）＝把工作方式念给学生听，像说明书
  //     · 补充式（"做错的、不会的都能发，整张卷子也行。先说说你想到哪一步了。"）
  //       ＝像是怕他不用而急着推销自己，**"有点刻意了"说的就是这种**
  //   ★ 那两层意思都没丢，只是不在这儿说：「为什么这么设计」在「关于」面板里；
  //     发整张卷子、发文件这些，属于**问得出来就答得出来**的事，
  //     不用开场白替他把用法讲一遍（真发上来了，"整卷附注"那一档会接住，见 api.js）。
  var OPENING = {
    // ★ 出材料这一句要把**头两步**说全：模板 + 要求。只写"传一份模板"的话，
    //   老师传完就停在那儿等，不知道下一步该说话；写了但不说传模板，
    //   出来的东西就没有版式可套——那正是这个工位唯一的产品前提。
    material: '传一份你学校的模板，再说要出什么。',
    draw: '告诉我你想画什么。',
    prep: '告诉我你要上的哪一课。',
    vary: '把题目发过来，我给你出几个变式。',
    review: '把卷子发过来，先看看哪些题值得讲。'
  };

  // 输入框的提示语，跟开场白一样**按工位给**。
  // 一句话，说的是"这一格你该往里打什么"——举的那个例子要真是这个工位接得住的。
  var TIP = {
    material: '说说要出什么，例如 第五周 一元一次方程 周练卷',
    draw: '说说要画什么，例如 数轴上表示 -2 和 3',
    prep: '贴一道题，或者写一个课题，例如 3.1 代数式的值',
    vary: '贴一道题，我给你出几个变式',
    review: '把卷子发过来，也可以先说说这次考得怎么样'
  };

  function $(id) { return document.getElementById(id); }

  function init() {
    els.msgs = $('msgs');
    els.chips = $('chips');
    els.input = $('input');
    els.send = $('send');
    els.attach = $('attach');
    els.file = $('file');
    els.status = $('status');
    els.steps = $('steps');

    // 页面骨架要是缺了哪个 id，给一句人话，别整页白屏
    var missing = [];
    for (var k in els) if (els.hasOwnProperty(k) && !els[k]) missing.push(k);
    if (missing.length) {
      console.error('页面里找不到这些元素：' + missing.join('、') + '（检查 index.html 的 id）');
      return;
    }

    els.send.addEventListener('click', function () { submit(); });
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
    els.input.addEventListener('input', autoGrow);
    els.attach.addEventListener('click', function () { els.file.click(); });
    els.file.addEventListener('change', function () { onPick(els.file.files); });
    // 直接往输入框里粘贴截图。★ 粘贴都是**追加**，不是替换：
    //   学生常常一张一张截、一张一张粘，替换的话前面的就白发了。
    els.input.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      var got = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          var f = items[i].getAsFile();
          if (f) got.push(f);
        }
      }
      if (got.length) { e.preventDefault(); onPick(got); }
    });

    // 画板按钮
    var bp = $('btn-play'), br = $('btn-redraw'), bc = $('btn-clear'), bpng = $('btn-png');
    if (bp) bp.addEventListener('click', function () { SR.board.togglePlay(); });
    if (br) br.addEventListener('click', function () { SR.board.redraw(); });
    if (bc) bc.addEventListener('click', function () { SR.board.clear(); });
    if (bpng) bpng.addEventListener('click', function () { saveBoardPNG(bpng); });

    // 画板的注入不在这里——那是 main.boot 的活。这里只把两个回调交出去。
  }

  // 存图（画板工具条最右边那个）。署名由 board.exportPNG 烧进图片右下角，
  // 这里只管把 dataURL 变成一次下载，并让按钮在生成的这一两秒里看得见反应——
  // 点了没动静，老师会以为坏了，然后连点三下。
  function saveBoardPNG(btn) {
    var old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '正在存…';
    SR.board.exportPNG(function (url) {
      btn.disabled = false;
      btn.textContent = old;
      if (!url) { setStatus('画板还没画东西，或者这一版的浏览器不让存图。'); return; }
      var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
      var name = '数根-画板-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
                 '-' + p(d.getHours()) + p(d.getMinutes()) + '.png';
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setStatus('存好了：' + name);
    });
  }

  function onPlayState(st) {
    var bp = $('btn-play');
    if (!bp) return;
    if (!st.target) { bp.style.display = 'none'; return; }
    bp.style.display = '';
    bp.textContent = st.playing ? '⏸ 停' : '▶ 播放 ' + st.target;
  }

  function setStatus(s) {
    if (els.status) els.status.textContent = s || '';
  }

  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
  }

  // ---- 开场白重置 ----
  function reset(newWork) {
    work = newWork || work;
    history = [];
    els.msgs.innerHTML = '';
    clearChips();
    SR.board.clear();
    addAssistantText(OPENING[work] || OPENING.prep);
    // 输入框里的提示也跟着工位走。
    // ★ 原来那句"贴一道题，或者写一个课题，例如 3.1 代数式的值"是**写死在 index.html** 里的，
    //   于是切到「出材料」时它还挂在那儿——**提示的是一个这个工位不接的用法**。
    //   提示语是老师唯一一定会读到的一句话，写错了比没有更坏。
    if (els.input) els.input.placeholder = TIP[work] || TIP.prep;
    // 备课工位一上来就把①复述点亮：这就是"一档一档走"的起点，摆在那儿他自己会看。
    // ★ 讲评工位**整根藏起来**，不留空槽，也不点着任何一档：
    //   它开头那一段是"先念题号、再说讲哪几道"，五档还没开始。
    //   一打开讲评就摆出"复述／定位／追问"六格，老师会以为现在就该按这个走。
    //   等卷子发上来、挑定一道，第一轮回复之后它自己会冒出来。
    if (work === 'prep') paintStepBar(1); else hideStepBar();
    setStatus('');
    els.input.focus();
  }

  // ---- 档位进度条 ----
  // ★ 「一档一档走」是这个产品的核心交互，所以它得**看得见**。
  //   档位由 SR.inferStep 推断（纯前端，不靠模型在围栏里写档号——理由见 chips.js 那一段），
  //   这里只负责画。进度条和下面的兜底按钮**共用同一份推断**，别各判一套。
  // ★ 点某一段 = 替学生发一句那个档位的话（SR.STEP_JUMP），不是发魔法符号：
  //   小模型吃自然语言比吃 `JUMP=4` 稳，而且这句话留在 history 里下一轮还看得见。
  var stepNow = 0;
  // 藏起来。★ 走这个而不是 paintStepBar(0)：那个只是"不点亮任何一档"，
  //   六格还是摆在那儿。讲评工位一进来不该摆出来（见 reset 里那段）。
  //   下一次 paintStepBar 会把 display 还原成 ''，所以藏过之后不用特意恢复。
  function hideStepBar() {
    var box = $('steps');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
    stepNow = 0;
  }
  function paintStepBar(step) {
    var box = $('steps');
    if (!box || !SR.STEP_ORDER) return;
    var w = (SR.WORKS && SR.WORKS[work]) || {};
    if (!w.steps) { box.style.display = 'none'; box.innerHTML = ''; stepNow = 0; return; }
    box.style.display = '';
    if (!box.childNodes.length) {
      for (var i = 0; i < SR.STEP_ORDER.length; i++) {
        (function (sd) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'stepbtn';
          b.setAttribute('data-step', sd);
          b.textContent = SR.STEP_NAMES[sd] || sd;
          b.title = '从这一档接着走';
          b.addEventListener('click', function () {
            if (busy) return;
            if (!SR.STEP_JUMP || !SR.STEP_JUMP[sd]) return;
            clearChips();
            submit(SR.STEP_JUMP[sd]);
          });
          box.appendChild(b);
        })(SR.STEP_ORDER[i]);
      }
    }
    if (step === undefined || step === null || step === 0) step = stepNow;
    stepNow = step;
    var at = SR.STEP_ORDER.indexOf(step);
    var btns = box.querySelectorAll('.stepbtn');
    for (var j = 0; j < btns.length; j++) {
      // .now = 正在这一档（主色 + 下划线）；.done = 已经走过（实心）。
      // ★ 这两个类名跟 css/main.css 的 #steps 那一节是一对，改一处忘一处就对不上。
      btns[j].classList.toggle('now', SR.STEP_ORDER[j] === step);
      btns[j].classList.toggle('done', at > 0 && j < at);
    }
  }

  // 换了工位之后把这一条重画一遍。★ 导出给 main.js 用：
  //   它管"切工位要不要清对话"这条规则，但**档位条不能只清不清**——
  //   备课↔讲评是同一条链的两个阶段，历史和档位都得留着，重新推一次就行
  //   （推的依据还是那条：模型上一轮问出口的那句话）。
  function repaintSteps() {
    var w = (SR.WORKS && SR.WORKS[work]) || {};
    if (!w.steps) { paintStepBar(0); return; }
    if (!history.length) { if (work === 'prep') paintStepBar(1); else hideStepBar(); return; }
    var prev = '', first = true;
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'assistant') { prev = String(history[i].content || ''); first = false; break; }
    }
    paintStepBar(SR.inferStep({ prevAssistant: prev, first: first }));
  }

  function addAssistantText(text) {
    var el = document.createElement('div');
    el.className = 'msg assistant';
    var b = document.createElement('div');
    b.className = 'bubble';
    SR.render.renderInto(b, text);
    el.appendChild(b);
    els.msgs.appendChild(el);
    scroll();
    return b;
  }

  // 学生这一轮发的东西：文字之外还可能是好几张图、几页 PDF、一份 Word。
  // 图片各占一行（学生要能看清自己发的是哪几张），文档只挂一行小字——
  // 把一整份卷子的文字正文摊在气泡里，对话会被撑得没法看。
  function addUser(text, parts) {
    var el = document.createElement('div');
    el.className = 'msg user';
    var b = document.createElement('div');
    b.className = 'bubble';
    parts = parts || [];
    var docs = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.kind === 'image') {
        var img = document.createElement('img');
        img.className = 'shot';
        img.src = p.dataUrl;
        img.alt = p.name || '学生发来的图片';
        b.appendChild(img);
      } else if (p.kind === 'text') docs.push(p.name || '文件');
    }
    if (docs.length) {
      var d = document.createElement('div');
      d.className = 'docsent';
      d.textContent = '📄 ' + docs.join('、');
      b.appendChild(d);
    }
    if (text) {
      var t = document.createElement('div');
      t.textContent = text;
      b.appendChild(t);
    }
    el.appendChild(b);
    els.msgs.appendChild(el);
    scroll();
  }

  function scroll() { els.msgs.scrollTop = els.msgs.scrollHeight; }

  // ---- 出题工位的「图 1 / 图 2 / 图 3」切换器 ----
  // ★ 为什么要它：画板物理上只有一块，而这一轮会带三张图（每个变式一张）。
  //   paint() 那边已经改成只自动画第一张（见那里的注释），剩下的得有个门能叫回来，
  //   否则那两张图就永远看不见了——"每个变式都配图"这句话就成了空话。
  //
  // ★ 挂在**气泡里面**，不挂画板上：切换的是"这一条回复里的第几张"，
  //   它属于那条回复，不属于画板。画板上的「重画」按钮重画的也永远是当前这张。
  function attachFigSwitch(bubble, blocks) {
    if (!blocks || blocks.length < 2) return;
    var bar = document.createElement('div');
    bar.className = 'figsw';
    var btns = [];
    function pick(i) {
      for (var k = 0; k < btns.length; k++) btns[k].className = (k === i ? 'figbtn on' : 'figbtn');
      SR.board.run(String(blocks[i]).split('\n'));
    }
    for (var i = 0; i < blocks.length; i++) {
      (function (i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'figbtn';
        b.textContent = '图 ' + (i + 1);
        b.title = '把这一张画到画板上';
        b.addEventListener('click', function () { pick(i); });
        btns.push(b);
        bar.appendChild(b);
      })(i);
    }
    bubble.appendChild(bar);
    // 第一张已经在 paint() 里自动画过了，这里只把高亮摆对，不重画——
    // 重画一遍会白等 550ms × 十几条命令，而且画面会先闪一下。
    btns[0].className = 'figbtn on';
  }

  // 出错时的那一行。needOwnKey 时多给一个"切到自己的 Key"的按钮——
  // 用 DOM 拼，不走 innerHTML，按钮的点击才不会被后来的重绘冲掉。
  function showError(bubble, errText, needOwnKey) {
    var box = document.createElement('div');
    var sp = document.createElement('span');
    sp.className = 'err';
    sp.textContent = errText;
    box.appendChild(sp);
    // ★ 「再试一次」是**必须**有的（2026-10-01 加）：
    //   免费通道那轮带图的请求走的是 glm-4.6v-flash，它被限流限得厉害（实测三次能成一两次），
    //   而 API 的 429 是秒回的、隔几秒再打往往就通了。
    //   原来这里只给一个「切到自己的 Key」——学生没 Key 的话，那张照片就白拍了：
    //   submit 的时候已经把 pendingImage 清空了，他得回去重新找那张图、重新拍一遍。
    //   retryLast 里存着 img，这一下就把照片和原话都带回来了。
    if (needOwnKey) {
      var again = document.createElement('button');
      again.type = 'button';
      again.className = 'inlinebtn';
      again.textContent = '再试一次';
      again.addEventListener('click', function () { retryLast(); });
      box.appendChild(again);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inlinebtn';
      btn.textContent = '切到自己的 Key';
      btn.addEventListener('click', function () { SR.main.useOwnKey(); });
      box.appendChild(btn);
    }
    bubble.appendChild(box);
  }

  // 刚才那一轮重发。两个入口：切完 Key 自动重发（main.js 的 saveKey 会喊它）、
  // 气泡上那个「再试一次」按钮。
  function retryLast() {
    if (!lastFail || busy) return;
    var f = lastFail;
    lastFail = null;
    // ★ 先把上一轮留下的两个气泡从界面上摘掉，再重发。
    //   不摘的话，重发会再 addUser 一遍：屏幕上同一句话出现两次、
    //   中间还夹着那条红字的报错，学生看着像"我发了两遍"。
    var n = els.msgs.children.length;
    for (var i = 0; i < 2 && n - 1 - i >= 0; i++) {
      var el = els.msgs.children[n - 1 - i];
      if (el.className.indexOf('assistant') < 0 && el.className.indexOf('user') < 0) break;
      els.msgs.removeChild(el);
    }
    pendingParts = f.parts || [];
    // 文件也得回到输入框上——学生要看得见"那几张图/那份卷子还在"，才敢按下发送
    renderStrip();
    submit(f.text);
  }

  // ---- 可选回答（猜他想说）----
  function clearChips() { if (els.chips) els.chips.innerHTML = ''; }

  function showChips(lines) {
    clearChips();
    if (!lines || !lines.length) return;
    for (var i = 0; i < lines.length; i++) {
      var t = String(lines[i]).trim();
      if (!t) continue;
      (function (txt, idx) {
        var b = document.createElement('button');
        b.className = 'chip';
        b.type = 'button';
        b.textContent = txt;
        // 错开入场的序号——CSS 那边是 `animation-delay: calc(var(--i) * 28ms)`。
        // 一排四个选项同时淡入，看着是"这一块换了"；错开才像"一件件摆上来"。
        b.style.setProperty('--i', idx);
        b.addEventListener('click', function () {
          if (busy) return;
          clearChips();
          submit(txt);
        });
        els.chips.appendChild(b);
      })(t, i);
    }
  }

  // ---- 下载下来的文件叫什么 ----
  // ★ 为什么不直接用模板名：一个老师手上就那几份模板（周练卷模板、导学案模板），
  //   一周出一份，全叫「周练卷模板.docx」的话，下载三次就分不清哪个是哪周的。
  //   拿老师这句要求当名（"第五周 一元一次方程 周练卷"→「第五周 一元一次方程 周练卷.docx」），
  //   他一看文件名就知道是哪一份。
  // ⚠ 文件名的非法字符要清掉（Windows 里 `\ / : * ? " < > |` 一个都不许有），
  //   长度也要收——有些老师会把整段要求贴进来，那能有两百字。
  function fileTitle(ask, tpl) {
    var s = String(ask || '').replace(/[\r\n]+/g, ' ').trim();
    s = s.replace(/[\\\/:*?"<>|]/g, '').replace(/[，。；：、！？,.;:!]+$/g, '').trim();
    if (s.length > 24) s = s.slice(0, 24);
    if (!s) s = (tpl && tpl.name) || '材料';
    return s;
  }

  // 本机在气泡底下补的一句（**不是模型说的**）。
  // ★ 挂在气泡**外面**：气泡的 innerHTML 在流式期间会被整块换掉，
  //   挂在里面的一句话活不过下一帧。
  function noteUnder(el, text) {
    if (!el) return;
    var p = document.createElement('p');
    p.className = 'localnote';
    p.textContent = text;
    el.appendChild(p);
    scroll();
  }

  // ---- 收流：正文、围栏、chips 一起更新 ----
  function paint(msg) {
    // ★ 备课／讲评多删一档"整行就是一条画板赋值"的行（掉围栏时漏出来的 A=(-2,0)）。
    //   画图／出题不删——那两处的正文里出现一行 y=(x+1)(x-2) 是正常的。见 render.js 三条规则。
    var w = (SR.WORKS && SR.WORKS[work]) || {};
    var p = SR.render.parseFences(msg.raw, { stripAssign: !!w.stripAssign });

    // 正文
    var v = p.visible;

    // ---- 出材料：围栏掉了就本地捡回来 ----
    // ★ 为什么在正文这里动手（而不是等收完流再补）：编号行**绝对不能印在气泡上**。
    //   免费通道那颗 GLM 实测就是把三十几行 `#0 … #2 …` 直接倒进正文的，
    //   晚一步处理，老师就已经看见那串鬼东西了。
    // ★ 只捡不猜：`#数字` 顶格开头，在中文正文里不可能是别的东西。
    //   捡回来的照样走 produce 那条路（同一个中间结构 → 右栏预览 + 下载），
    //   所以"围栏写的"和"捡回来的"出的是同一种文件。
    // ⚠ 2026-10-02 改：原来这一档的条件是 `&& !p.mat.length`（"没有围栏才捡"）。
    //   **那条判据被免费通道那颗模型绕过去了**，而且绕得很难看：
    //   它这一轮把整份材料写了**三遍**——先光着写十几行 `#0 … #2 …`，
    //   再开一个 ```材料 围栏里**只放那一行 [图]**，最后把整份又写一遍。
    //   围栏是有的（新判据不成立），于是：
    //     · 气泡把十几行 `#0 第五周 周练卷` 原样印出来（最难看的那个坏法）；
    //     · 右栏只摆出**一张光图**（取的"最后闭合的围栏"正好是那一行 [图]），
    //       卷子一道题都没有——文件名还写着"出一份第五周的周练卷….docx"。
    //   现在改成：**两条来源都拿出来比一比，谁厚用谁**（按编号行数）。
    //   顺带一条不变：编号行**从气泡里一律拿掉**，跟用不用它无关。
    if (work === 'material' && SR.produce && SR.material) {
      var pk = SR.produce.pickSource(v, p.mat.length ? p.mat[p.mat.length - 1] : '');
      v = pk.rest;                       // ← 无论如何，编号行都不许留在气泡里
      if (pk.from) {
        msg.matFed = SR.material.feed(pk.body, fileTitle(msg.ask, SR.material.current()));
        msg.matLifted = pk.n;
        msg.matFrom = pk.from;           // 'lift' 还是 'fence'——下面那段别再喂一遍
      }
    }

    if (!v && msg.streaming) v = '…';
    // 一串编号全被收进右栏、正文一个字没剩 → 气泡不能空着。
    // ★ 这一句是**本机说的，不是模型说的**。为什么照样要说：
    //   空气泡给人的印象是"它什么都没干"，而右边明明摆着一份卷子。
    //   这种时候沉默比一句大白话糟得多——**说清东西去哪儿了**就够。
    //   （跟 board.js 的 giveBlank、chips.js 的本地兜底是同一条规矩：
    //     凡是在免费通道上守不住的，都得有本地兜底兜着。）
    // ★ 为什么这一喂要在**流式当中反复做**（而不是等收完流再一次性摆）：
    //   一份周练卷两百来行，等收完再出现，老师盯着空右栏要盯十几秒，
    //   中间还会以为它没在干活。一行行长出来本身就是"它在做"的反馈——
    //   而且 `feed` 是纯的，重画不花钱。
    if (!v && !msg.streaming && msg.matFed && msg.matFed.ok) {
      v = '这份材料按你传的模板排好了，在右边——预览和下载都在那儿。';
    }
    if (v !== msg.lastVisible) {
      SR.render.renderInto(msg.bubble, v || '');
      msg.lastVisible = v;
      scroll();
    }

    // 画板：只派新闭合的那些块，别重复执行
    // ★ multiFig 的工位（出题）只自动画**第一张**。理由见 config.js 的 SR.WORKS.vary：
    //   画板只有一块，每个变式的围栏头一行都是 #清空，连着画等于前两张刚出来就被擦掉，
    //   老师从头到尾只看得到最后一张。其余的收进下面的切换器，点哪张画哪张。
    var multi = !!w.multiFig;
    while (msg.ggbDone < p.ggb.length) {
      var lines = p.ggb[msg.ggbDone].split('\n');
      if (!multi || msg.ggbDone === 0) SR.board.run(lines);
      // ★ 另外数一份"真画了东西的条数"：只有 #清空 的围栏不算画了图。
      //   实测带图那轮模型就爱发一个光秃秃的 ```ggb ⏎ #清空 ⏎ ```（它没东西可画）。
      //   要是拿 ggbDone 去判"它画没画"，就会以为它画了，本地补空数轴那条路会被顶掉。
      for (var li = 0; li < lines.length; li++) {
        var s = lines[li].trim();
        if (s && s.charAt(0) !== '#' && !/^(清空|隐藏|显示)/.test(s)) msg.ggbReal++;
      }
      msg.ggbDone++;
    }

    // ⚠ 原来这里还有一段「摆最后一个闭合的围栏」，2026-10-02 挪走了。
    //   现在**只有上面那一处**做决定（`SR.produce.pickSource`：两条来源比厚度），
    //   两处都喂的话，后喂的那一份会把先喂的对的一份顶掉——实测就是这么
    //   把一份完整卷子顶成"一张光图"的。

    // chips 等收完再出，免得半截就被点了
    msg.lastSay = p.say;

    // 留一份原始输出（含围栏），排查"它到底写没写围栏"时看这个
    SR.chat.lastRaw = msg.raw;
  }

  // ---- 发一条 ----
  function submit(forced) {
    if (busy) return;
    var text = forced != null ? forced : els.input.value.trim();
    var parts = pendingParts;
    if (!text && !parts.length) return;
    if (!SR.api.ready()) { SR.main.needKey(); return; }

    busy = true;
    els.send.disabled = true;
    if (forced == null) { els.input.value = ''; autoGrow(); }
    clearChips();
    pendingParts = [];
    pendingNote = '';
    renderStrip();

    addUser(text, parts);
    // 兜底按钮要判"这段对话走到哪儿了"，所以在推入这一轮之前先记两个东西
    var isFirstTurn = !history.some(function (m) { return m.role === 'assistant'; });
    var prevAssistant = '';
    for (var hi = history.length - 1; hi >= 0; hi--) {
      if (history[hi].role === 'assistant') { prevAssistant = String(history[hi].content || ''); break; }
    }
    // 图片那段的组装只有一份，在 api.js 里（以前这里和 api.js 各写了一遍，改一处忘一处）
    history.push({ role: 'user', content: SR.api.userContent(text, parts) });

    var el = document.createElement('div');
    el.className = 'msg assistant';
    var b = document.createElement('div');
    b.className = 'bubble';
    b.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    el.appendChild(b);
    els.msgs.appendChild(el);
    scroll();

    var msg = { raw: '', bubble: b, streaming: true, ggbDone: 0, ggbReal: 0, lastVisible: null, lastSay: [], ask: text };
    setStatus('');

    SR.api.ask({
      work: work,
      history: history.slice(0, -1),      // 最后一条（刚推入的）由 api 自己拼
      text: text,
      parts: parts,
      onChunk: function (piece) { msg.raw += piece; paint(msg); }
    }).then(function (res) {
      msg.streaming = false;
      // 这一轮到底是哪颗模型答的、有没有中途换过模型——探针要看这个。
      // ★ 2026-10-01 加：备课／讲评带图那轮走的是 modelsImage（只有一颗 glm-4.6v-flash），
      //   排查"是不是悄悄降级到会解题的那颗了"必须能看出来，光看回复内容看不出来。
      var hadImg = false;
      for (var qi = 0; qi < parts.length; qi++) if (parts[qi].kind === 'image') { hadImg = true; break; }
      SR.chat.lastMeta = { model: res.model || '', image: hadImg, work: work, error: res.error || '' };
      if (res.error) {
        paint(msg);
        // 免费通道排队排空了，别只说一句"再等等"——直接给一条出路：
        // 点一下切到自己的 Key，填完自动把这一轮重发，不用重新打字。
        showError(b, res.error, res.needOwnKey);
        setStatus(res.error);
        history.pop();                    // 这轮没成，别把话留在上下文里
        lastFail = { text: text, parts: parts };
      } else {
        lastFail = null;
        history.push({ role: 'assistant', content: res.text });
        if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS);
        paint(msg);
        // ★ 2026-10-01 砍掉了原来那段**空气泡兜底**（学生说"画不出来"时本地补一张空数轴、
        //   再代它招呼一句）。它是纯学生侧的东西，四个工位里一个都不需要：
        //   · 画图／出题：老师自己画图、自己出题，模型不出图就是它偷懒，替它圆场是错的；
        //   · 备课／讲评：老师卡住的时候不会说"画不出来"，他要的是下一句问话。
        //   留着它只会让"模型这一轮什么都没说"这件事变得看不出来。
        // 模型写了 ```想说 就用它的（更贴这道题）；没写就用本地兜底。
        // ★ 免费通道那两颗小模型守不住这个围栏（实测 0/4 ~ 6/6 看运气），
        //   而"这一轮没有可点的话"正是这个功能要防的事——不留一个空白的输入框。
        //   兜底词库和挑选规则见 js/chips.js 顶上的注释。
        var modelChips = (msg.lastSay && msg.lastSay[0]) ? msg.lastSay[0].split('\n') : [];
        modelChips = SR.filterCopiedChips(modelChips);   // 把提示词里那段示范原样抄回来的挡掉
        showChips(modelChips.length ? modelChips : SR.fallbackChips({
          work: work, first: isFirstTurn, lastUser: text, prevAssistant: prevAssistant
        }));
        // 档位进度条：判的是**这一轮它问出口的那句话**——模型跳到哪一档是它自己按学生
        // 答话定的，只有它问出来的那句话能证明它到了哪儿（见 chips.js 的 SR.inferStep）。
        paintStepBar(SR.inferStep({ prevAssistant: String(res.text || ''), first: isFirstTurn, lastUser: text }));
        // 出材料：收完流了，**现在才画配图**（流式期间只摆文字，理由见 material.js 的 finish）。
        // ★ 放在这儿而不是 paint() 里：paint 每收到一截就调一次，
        //   在那儿画会让画板反复重画几十遍。
        if (work === 'material' && SR.material && msg.matFed && msg.matFed.ok) {
          SR.material.finish(function (r) {
            // 有图没画出来 → 那一行已经撤掉了，但**得说一声**：
            // 悄悄少一张图，老师翻到那道题才发现，那时候他已经印了。
            if (r && r.dropped) {
              noteUnder(el, '有 ' + r.dropped + ' 张图没画出来，那几行我撤掉了——'
                + '要么把题目里要画的东西说得再具体点，要么去画板那边自己画好、存图贴进来。');
            }
          });
        }
        // 出题工位：这一轮带了几张图，就在气泡下面挂几个切换钮（见 attachFigSwitch）。
        // ★ 收完流再挂，不在 paint() 里挂——流式当中围栏是一块一块闭合的，
        //   在那儿挂会看着按钮一个个往外蹦。
        if (SR.WORKS[work] && SR.WORKS[work].multiFig) {
          var wp = SR.render.parseFences(String(res.text || ''), { stripAssign: !!(SR.WORKS[work].stripAssign) });
          attachFigSwitch(b, wp.ggb);
        }
        setStatus(SR.api.usageText());
      }
    }).catch(function (e) {
      msg.streaming = false;
      b.innerHTML = '<span class="err">出错了：' + SR.render.esc(e.message || e) + '</span>';
    }).then(function () {
      busy = false;
      els.send.disabled = false;
      els.input.focus();
    });
  }

  // ---- 待发的东西（图片 / PDF / Word 统一排队）----
  // 原来这里只有一个 pendingImage。2026-10-01 孔老师要"学生也能发一整张卷子"，
  // 于是一张图变成了一队东西，各自的 kind/dataUrl/text 不同——见 js/files.js。
  var pendingParts = [];
  var pendingNote = '';     // "这是一份 12 页的 PDF，先看了前 6 页"这类要跟学生交代的话

  // 输入框上方那一条缩略图。挑文件、重试、删除都走它。
  function renderStrip() {
    var el = document.getElementById('thumb');
    if (!el) return;
    el.innerHTML = '';
    if (!pendingParts.length) {
      el.style.display = 'none';
      return;
    }
    var strip = document.createElement('div');
    strip.className = 'strip';
    pendingParts.forEach(function (p, i) {
      var box = document.createElement('div');
      box.className = 'fi';
      if (p.kind === 'image') {
        var im = document.createElement('img');
        im.src = p.dataUrl;
        box.appendChild(im);
      } else {
        var d = document.createElement('div');
        d.className = 'doc';
        var b = document.createElement('b');
        b.textContent = 'DOC';
        var s = document.createElement('span');
        s.textContent = p.name || '文档';
        d.appendChild(b); d.appendChild(s);
        box.appendChild(d);
      }
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'x'; x.textContent = '×';
      x.title = '去掉这个';
      x.addEventListener('click', function () {
        pendingParts.splice(i, 1);
        if (!pendingParts.length) pendingNote = '';
        renderStrip();
      });
      box.appendChild(x);
      strip.appendChild(box);
    });
    el.appendChild(strip);

    var meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = SR.files.describe(pendingParts) + (pendingNote ? '　' + pendingNote : '');
    el.appendChild(meta);

    // ★ 这里必须写死 `block`，**不能**写 `el.style.display = ''`（2026-10-01 实测的 bug）。
    //   清空行内样式 = 让**样式表**说了算，而 `#thumb` 在 main.css 里就是 `display:none`。
    //   于是：图上去了、`#thumb img` 也在、探针量到的 len 也不为 0，**屏幕上就是看不见**。
    //   学生的感受是"我发了文件，什么反应都没有"，看不见自己发了哪几张，也没法点 × 撤掉。
    //   ⚠ 判断"清除行内样式能不能显示"要看这条 `display:none` 在哪儿：
    //     写在 HTML 的 style 属性里（#resbtn、#btn-play）→ 清掉就显；
    //     写在样式表里（#thumb）→ 清掉反而按样式表藏起来。两者长得一样，结果相反。
    el.style.display = 'block';
  }

  // 收下一批文件（可能来自文件选择框，也可能来自粘贴）。
  // ★ 粘贴来的和选来的走同一个入口：都是 File 对象，凭什么一个能收一个不能。
  function onPick(list) {
    if (!list || !list.length) return;
    var room = SR.files.maxFiles - pendingParts.length;
    if (room <= 0) { setStatus('一次最多 ' + SR.files.maxFiles + ' 个文件，先去掉几个再加。'); return; }
    var take = [];
    for (var i = 0; i < list.length && take.length < room; i++) take.push(list[i]);
    setStatus('正在读文件…');
    SR.files.toParts(take, function (err, parts, note) {
      els.file.value = '';
      if (err) { setStatus(err); return; }
      pendingParts = pendingParts.concat(parts);
      pendingNote = note || '';
      renderStrip();
      // 提示只留一句。文件多的时候 notes 会长，全塞进状态栏会盖掉整行；长的进 strip 的 meta。
      setStatus(note ? '' : '收好了，还有别的可以接着发。');
    });
  }

  return {
    init: init, reset: reset, submit: submit,
    retryLast: retryLast,              // 切完 Key 重发上一轮（main.js 用它）
    onPlayState: onPlayState,          // 交给 board.init 当回调
    setStatus: setStatus,
    setWork: function (w) { work = w; },
    getWork: function () { return work; },
    // main.js 用它切工位后把进度条重画一遍（工位一换，档位条要么换内容要么藏起来）
    paintStepBar: paintStepBar,
    // ★ 切工位走这个，别直接调 paintStepBar(0)：备课↔讲评是**同一条链的两个阶段**，
    //   切过去不清历史，档位就该按历史重新推出来，而不是被打回零。
    repaintSteps: repaintSteps,
    // main.js 用这个判"输入框那边有没有东西等着发"（空了就别送空请求）
    hasPendingImage: function () { return pendingParts.length > 0; },

    // —— 探针用的口子（test/probe_files.cjs）。不参与界面逻辑，也别在界面里调。
    __parts: function () { return pendingParts; },
    __clear: function () { pendingParts = []; pendingNote = ''; renderStrip(); }
  };
})();
