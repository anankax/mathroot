// 对话层：气泡、流式、把围栏派给画板、可选回答、拍照。
var SR = (window.SR = window.SR || {});

SR.chat = (function () {

  var els = {};
  var history = [];          // [{role, content}] —— 发给模型的上下文
  var busy = false;
  var mode = 'student';
  // 上下文条数的粗兜底。**真正管用的那道闸在 api.js 里**——免费通道只有 16K，
  // 得按 token 裁（trimHistory），按条数裁是挡不住"学生贴一道长题干"的。
  var MAX_TURNS = 24;
  var lastFail = null;       // 上一轮失败的提问，切完 Key 可以一键重发

  // 开场白。★ 一句话，就这么长。
  //   2026-10-01 孔老师定了两回，第二回是骂醒的：她要的就是「告诉我你的问题」这一句。
  //   ★ 别再加第二句。加什么都算跑偏，试过两版都是这个下场：
  //     · 自述式（"我不判对错、不给答案、只顺着你的思路往下问…"）＝把工作方式念给学生听，像说明书
  //     · 补充式（"做错的、不会的都能发，整张卷子也行。先说说你想到哪一步了。"）
  //       ＝像是怕他不用而急着推销自己，**"有点刻意了"说的就是这种**
  //   ★ 那两层意思都没丢，只是不在这儿说：「为什么这么设计」在「关于」面板里；
  //     发整张卷子、发文件这些，属于**学生问得出来就答得出来**的事，
  //     不用开场白替他把用法讲一遍（真发上来了，"整卷附注"那一档会接住，见 api.js）。
  var OPENING = {
    student: '告诉我你的问题。',
    demo: '告诉我你想画什么。'
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
  function reset(newMode) {
    mode = newMode || mode;
    history = [];
    els.msgs.innerHTML = '';
    clearChips();
    SR.board.clear();
    addAssistantText(OPENING[mode] || OPENING.student);
    setStatus('');
    els.input.focus();
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

  // ---- 收流：正文、围栏、chips 一起更新 ----
  function paint(msg) {
    // ★ 学生模式多删一档"整行就是一条画板赋值"的行（掉围栏时漏出来的 A=(-2,0)）。
    //   演示模式不删——老师板书里出现一行 y=(x+1)(x-2) 是正常的。见 render.js 三条规则。
    var p = SR.render.parseFences(msg.raw, { student: mode === 'student' });

    // 正文
    var v = p.visible;
    if (!v && msg.streaming) v = '…';
    if (v !== msg.lastVisible) {
      SR.render.renderInto(msg.bubble, v || '');
      msg.lastVisible = v;
      scroll();
    }

    // 画板：只派新闭合的那些块，别重复执行
    while (msg.ggbDone < p.ggb.length) {
      var lines = p.ggb[msg.ggbDone].split('\n');
      SR.board.run(lines);
      // ★ 另外数一份"真画了东西的条数"：只有 #清空 的围栏不算画了图。
      //   实测带图那轮模型就爱发一个光秃秃的 ```ggb ⏎ #清空 ⏎ ```（它没东西可画）。
      //   要是拿 ggbDone 去判"它画没画"，就会以为它画了，本地补空数轴那条路会被顶掉。
      for (var li = 0; li < lines.length; li++) {
        var s = lines[li].trim();
        if (s && s.charAt(0) !== '#' && !/^(清空|隐藏|显示)/.test(s)) msg.ggbReal++;
      }
      msg.ggbDone++;
    }

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

    var msg = { raw: '', bubble: b, streaming: true, ggbDone: 0, ggbReal: 0, lastVisible: null, lastSay: [] };
    setStatus('');

    SR.api.ask({
      mode: mode,
      history: history.slice(0, -1),      // 最后一条（刚推入的）由 api 自己拼
      text: text,
      parts: parts,
      onChunk: function (piece) { msg.raw += piece; paint(msg); }
    }).then(function (res) {
      msg.streaming = false;
      // 这一轮到底是哪颗模型答的、有没有中途换过模型——探针要看这个。
      // ★ 2026-10-01 加：学生传图那轮走的是 modelsImage（只有一颗 glm-4.6v-flash），
      //   排查"是不是悄悄降级到会解题的那颗了"必须能看出来，光看回复内容看不出来。
      var hadImg = false;
      for (var qi = 0; qi < parts.length; qi++) if (parts[qi].kind === 'image') { hadImg = true; break; }
      SR.chat.lastMeta = { model: res.model || '', image: hadImg, mode: mode, error: res.error || '' };
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
        // ★ 气泡里一个字都没有的时候，得补一句**程序自己**的话。两种来路：
        //   ① 模型既没画也没说（学生说"画不出来"那种）→ 本地补一张空图，再告诉学生图放好了；
        //      学生模式才补空图（演示模式是老师自己画图，模型不出图就是它偷懒，别替它圆场）。
        //      判定写在 board.giveBlank 里，见那段注释。
        //   ② 模型**画了图、正文却一句没有**——围栏外的字被 render.js 的删行规则删光了
        //      （免费通道掉围栏时最常见的形状）。图是在板上了，可没人招呼一声，
        //      学生盯着一个空气泡，只会以为页面坏了。
        //      2026-10-01 才补的这一支：原来只处理①，`probe_blank` 抓到②时气泡是空的。
        //   两句话都只交代"画板那边好了、你接着说"，不冒充老师提问，也不给答案。
        //   只在气泡真空的时候补——模型但凡说了句正经话，就别去盖它。
        //   顺手也把这句话写进 history：学生看到的就是它，下一轮模型也该知道画板上有什么了
        //   （不然它会当画板还是空的，又说一遍"你先画"）。
        if (!msg.lastVisible && mode === 'student') {
          var blankKind = msg.ggbReal ? '' : SR.board.giveBlank(text);
          var line = '';
          if (blankKind === '坐标系') line = '画板上给你放了一个空坐标系，你把题目里的点标上去，标好了说给我听。';
          else if (blankKind) line = '画板上给你放了一条空数轴，你把题目里那几个数标上去，标好了说给我听。';
          else if (msg.ggbReal) line = '画板上给你画好了，你先看一眼，再说说这道题你当时是怎么想的。';
          if (line) {
            SR.render.renderInto(b, line);
            msg.lastVisible = line;
            history[history.length - 1].content = String(res.text || '') + '\n\n' + line;
          }
        }
        // 模型写了 ```想说 就用它的（更贴这道题）；没写就用本地兜底。
        // ★ 免费通道那两颗小模型守不住这个围栏（实测 0/4 ~ 6/6 看运气），
        //   而"这一轮没有可点的话"正是这个功能要防的事——不给学生留空白输入框。
        //   兜底词库和挑选规则见 js/chips.js 顶上的注释。
        var modelChips = (msg.lastSay && msg.lastSay[0]) ? msg.lastSay[0].split('\n') : [];
        modelChips = SR.filterCopiedChips(modelChips);   // 把提示词里那段示范原样抄回来的挡掉
        showChips(modelChips.length ? modelChips : SR.fallbackChips({
          demo: mode === 'demo', first: isFirstTurn, lastUser: text, prevAssistant: prevAssistant
        }));
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
    setMode: function (m) { mode = m; },
    getMode: function () { return mode; },
    // main.js 用这个判"输入框那边有没有东西等着发"（空了就别送空请求）
    hasPendingImage: function () { return pendingParts.length > 0; },

    // —— 探针用的口子（test/probe_files.cjs）。不参与界面逻辑，也别在界面里调。
    __parts: function () { return pendingParts; },
    __clear: function () { pendingParts = []; pendingNote = ''; renderStrip(); }
  };
})();
