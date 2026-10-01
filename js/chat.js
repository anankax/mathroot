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

  var OPENING = {
    student: '你好，我是数根。把你做错的题贴进来，再说说你当时是怎么想的——算到哪一步都行，说得乱也没关系。我不判对错，不给答案，只顺着你的思路往下问，问到你自己说出错在哪儿为止。',
    demo: '教师演示模式。你说要画什么，我直接画到右边的画板上。想让它动起来就说一声——比如「画个数轴，带个动点 P」。'
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
    els.file.addEventListener('change', function () { onPick(els.file.files[0]); });
    // 直接往输入框里粘贴截图
    els.input.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          e.preventDefault();
          onPick(items[i].getAsFile());
          return;
        }
      }
    });

    // 画板按钮
    var bp = $('btn-play'), br = $('btn-redraw'), bc = $('btn-clear');
    if (bp) bp.addEventListener('click', function () { SR.board.togglePlay(); });
    if (br) br.addEventListener('click', function () { SR.board.redraw(); });
    if (bc) bc.addEventListener('click', function () { SR.board.clear(); });

    // 画板的注入不在这里——那是 main.boot 的活。这里只把两个回调交出去。
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

  function addUser(text, imageDataUrl) {
    var el = document.createElement('div');
    el.className = 'msg user';
    var b = document.createElement('div');
    b.className = 'bubble';
    if (imageDataUrl) {
      var img = document.createElement('img');
      img.className = 'shot';
      img.src = imageDataUrl;
      b.appendChild(img);
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
    pendingImage = f.img || null;
    // 照片也得回到输入框上——学生要看得见"那张图还在"，才敢按下发送
    if (f.img) showThumb(f.img);
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
      (function (txt) {
        var b = document.createElement('button');
        b.className = 'chip';
        b.type = 'button';
        b.textContent = txt;
        b.addEventListener('click', function () {
          if (busy) return;
          clearChips();
          submit(txt);
        });
        els.chips.appendChild(b);
      })(t);
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
    var img = pendingImage;
    if (!text && !img) return;
    if (!SR.api.ready()) { SR.main.needKey(); return; }

    busy = true;
    els.send.disabled = true;
    if (forced == null) { els.input.value = ''; autoGrow(); }
    clearChips();
    pendingImage = null;
    var thumbEl = document.getElementById('thumb');
    if (thumbEl) { thumbEl.innerHTML = ''; thumbEl.style.display = 'none'; }

    addUser(text, img);
    // 兜底按钮要判"这段对话走到哪儿了"，所以在推入这一轮之前先记两个东西
    var isFirstTurn = !history.some(function (m) { return m.role === 'assistant'; });
    var prevAssistant = '';
    for (var hi = history.length - 1; hi >= 0; hi--) {
      if (history[hi].role === 'assistant') { prevAssistant = String(history[hi].content || ''); break; }
    }
    // 图片那段的组装只有一份，在 api.js 里（以前这里和 api.js 各写了一遍，改一处忘一处）
    history.push({ role: 'user', content: SR.api.userContent(text, img) });

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
      imageDataUrl: img,
      onChunk: function (piece) { msg.raw += piece; paint(msg); }
    }).then(function (res) {
      msg.streaming = false;
      // 这一轮到底是哪颗模型答的、有没有中途换过模型——探针要看这个。
      // ★ 2026-10-01 加：学生传图那轮走的是 modelsImage（只有一颗 glm-4.6v-flash），
      //   排查"是不是悄悄降级到会解题的那颗了"必须能看出来，光看回复内容看不出来。
      SR.chat.lastMeta = { model: res.model || '', image: !!img, mode: mode, error: res.error || '' };
      if (res.error) {
        paint(msg);
        // 免费通道排队排空了，别只说一句"再等等"——直接给一条出路：
        // 点一下切到自己的 Key，填完自动把这一轮重发，不用重新打字。
        showError(b, res.error, res.needOwnKey);
        setStatus(res.error);
        history.pop();                    // 这轮没成，别把话留在上下文里
        lastFail = { text: text, img: img };
      } else {
        lastFail = null;
        history.push({ role: 'assistant', content: res.text });
        if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS);
        paint(msg);
        // ★ 模型一个 ```ggb 围栏都没给，而学生又明说了"画不出来" —— 本地补上空图。
        //   学生模式才补（演示模式是老师自己画图，模型不出图就是它偷懒，别替它圆场）；
        //   而且只在 msg.ggbDone === 0 时补，模型已经画了就别叠。
        //   判定写在 board.giveBlank 里，见那段注释。
        var blankKind = '';
        if (mode === 'student' && !msg.ggbReal) blankKind = SR.board.giveBlank(text);
        // ★ 补了空图，可气泡里一个字都没有——那多半是模型这一轮**整段回的都是画板命令**
        //   （免费通道掉围栏的典型形状），被 render.js 的删行规则全删干净了。
        //   学生盯着一个空气泡，只会以为页面坏了。补一句**程序自己**的话：
        //   交代的是"画板那边我给你放好了"，不冒充老师提问，也不给答案。
        //   只在气泡真空的时候补——模型但凡说了句正经话，就别去盖它。
        //   顺手也把这句话写进 history：学生看到的就是它，下一轮模型也该知道
        //   画板上已经有一条空数轴了（不然它会当画板还是空的，又说一遍"你先画"）。
        if (blankKind && !msg.lastVisible) {
          var line = blankKind === '坐标系'
            ? '画板上给你放了一个空坐标系，你把题目里的点标上去，标好了说给我听。'
            : '画板上给你放了一条空数轴，你把题目里那几个数标上去，标好了说给我听。';
          SR.render.renderInto(b, line);
          msg.lastVisible = line;
          history[history.length - 1].content = String(res.text || '') + '\n\n' + line;
        }
        // 模型写了 ```想说 就用它的（更贴这道题）；没写就用本地兜底。
        // ★ 免费通道那两颗小模型守不住这个围栏（实测 0/4 ~ 6/6 看运气），
        //   而"这一轮没有可点的话"正是这个功能要防的事——不给学生留空白输入框。
        //   兜底词库和挑选规则见 js/chips.js 顶上的注释。
        var modelChips = (msg.lastSay && msg.lastSay[0]) ? msg.lastSay[0].split('\n') : [];
        modelChips = SR.filterCopiedChips(modelChips);   // 把提示词里那段示范原样抄回来的挡掉
        showChips(modelChips.length ? modelChips : SR.fallbackChips({
          first: isFirstTurn, lastUser: text, prevAssistant: prevAssistant
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

  // ---- 拍照 ----
  var pendingImage = null;

  // 输入框上方那张小缩略图。挑图和"重试"都要走它，所以抽出来了。
  function showThumb(dataUrl) {
    var el = document.getElementById('thumb');
    if (!el) return;
    el.innerHTML = '';
    var im = document.createElement('img');
    im.src = dataUrl;
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'x'; x.textContent = '×';
    x.addEventListener('click', function () {
      pendingImage = null; el.innerHTML = ''; el.style.display = 'none';
    });
    el.appendChild(im); el.appendChild(x);
    el.style.display = '';
  }

  function onPick(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setStatus('这个不是图片'); return; }
    downscale(file, function (dataUrl) {
      pendingImage = dataUrl;
      showThumb(dataUrl);
      els.file.value = '';
    });
  }

  // 缩到最长边 1280，JPEG 0.82 —— 手写字的清晰度和体积的平衡点
  function downscale(file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var MAX = 1280;
        var w = img.width, h = img.height;
        var s = Math.min(1, MAX / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        var g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        try { cb(c.toDataURL('image/jpeg', 0.82)); }
        catch (e) { cb(fr.result); }
      };
      img.onerror = function () { setStatus('这张图读不出来'); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  return {
    init: init, reset: reset, submit: submit,
    retryLast: retryLast,              // 切完 Key 重发上一轮（main.js 用它）
    onPlayState: onPlayState,          // 交给 board.init 当回调
    setStatus: setStatus,
    setMode: function (m) { mode = m; },
    getMode: function () { return mode; },
    hasPendingImage: function () { return !!pendingImage; }
  };
})();
