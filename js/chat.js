// 对话层：气泡、流式、把围栏派给画板、可选回答、拍照。
var SR = (window.SR = window.SR || {});

SR.chat = (function () {

  var els = {};
  var history = [];          // [{role, content}] —— 发给模型的上下文
  var busy = false;
  var mode = 'student';
  var MAX_TURNS = 24;        // 上下文最多留这么多条，再老的就丢掉

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
    var p = SR.render.parseFences(msg.raw);

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
    if (!SR.api.hasKey()) { SR.main.needKey(); return; }

    busy = true;
    els.send.disabled = true;
    if (forced == null) { els.input.value = ''; autoGrow(); }
    clearChips();
    pendingImage = null;
    var thumbEl = document.getElementById('thumb');
    if (thumbEl) { thumbEl.innerHTML = ''; thumbEl.style.display = 'none'; }

    addUser(text, img);
    history.push({ role: 'user', content: img ? [
      { type: 'text', text: text || '（这是学生的解答）' },
      { type: 'image_url', image_url: { url: img } }
    ] : text });

    var el = document.createElement('div');
    el.className = 'msg assistant';
    var b = document.createElement('div');
    b.className = 'bubble';
    b.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    el.appendChild(b);
    els.msgs.appendChild(el);
    scroll();

    var msg = { raw: '', bubble: b, streaming: true, ggbDone: 0, lastVisible: null, lastSay: [] };
    setStatus('');

    SR.api.ask({
      mode: mode,
      history: history.slice(0, -1),      // 最后一条（刚推入的）由 api 自己拼
      text: text,
      imageDataUrl: img,
      onChunk: function (piece) { msg.raw += piece; paint(msg); }
    }).then(function (res) {
      msg.streaming = false;
      if (res.error) {
        paint(msg);
        if (!msg.raw) b.innerHTML = '<span class="err">' + SR.render.esc(res.error) + '</span>';
        else b.innerHTML += '<div class="err">' + SR.render.esc(res.error) + '</div>';
        setStatus(res.error);
        history.pop();                    // 这轮没成，别把话留在上下文里
      } else {
        history.push({ role: 'assistant', content: res.text });
        if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS);
        paint(msg);
        showChips(msg.lastSay && msg.lastSay[0] ? msg.lastSay[0].split('\n') : []);
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

  function onPick(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setStatus('这个不是图片'); return; }
    downscale(file, function (dataUrl) {
      pendingImage = dataUrl;
      var el = document.getElementById('thumb');
      if (el) {
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
    onPlayState: onPlayState,          // 交给 board.init 当回调
    setStatus: setStatus,
    setMode: function (m) { mode = m; },
    getMode: function () { return mode; },
    hasPendingImage: function () { return !!pendingImage; }
  };
})();
