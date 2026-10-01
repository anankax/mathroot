// 装配：模式切换、Key 设置、启动。
var SR = (window.SR = window.SR || {});

SR.main = (function () {

  var mode = 'student';
  var dlg = null;

  function $(id) { return document.getElementById(id); }

  function readSavedMode() {
    // 网址后面挂 #demo 可以直接进演示模式（上课前把这个链接存书签）
    if (/demo/.test(location.hash)) return 'demo';
    if (/student/.test(location.hash)) return 'student';
    try { return localStorage.getItem(SR.LS_MODE) || 'student'; } catch (e) { return 'student'; }
  }

  function applyMode(m) {
    mode = m;
    SR.chat.setMode(m);
    try { localStorage.setItem(SR.LS_MODE, m); } catch (e) {}
    document.body.setAttribute('data-mode', m);
    var btns = document.querySelectorAll('.modebtn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-mode') === m);
    }
    $('badge').textContent = SR.MODES[m].badge;
    $('demoflag').style.display = (m === 'demo') ? '' : 'none';
    SR.chat.reset(m);
  }

  // ---- Key ----
  function openKeyDlg(first) {
    var d = $('keyset');
    d.classList.add('open');
    var inp = $('keyinput');
    inp.value = SR.api.getKey();
    $('keyerr').textContent = first ? '这个页面里没有存任何 Key，得填你自己的才能用。' : '';
    inp.focus();
  }
  function closeKeyDlg() { $('keyset').classList.remove('open'); }

  function saveKey() {
    var v = $('keyinput').value.trim();
    if (v.length < 20 || v.indexOf('sk-') !== 0) {
      $('keyerr').textContent = '这不像一个 DeepSeek Key（一般以 sk- 开头）。';
      return;
    }
    SR.api.setKey(v);
    closeKeyDlg();
    $('keybtn').textContent = 'Key ✓';
    $('input').disabled = false;
    $('input').focus();
  }

  function needKey() { openKeyDlg(false); }

  // ---- 启动 ----
  function boot() {
    // 顺序要紧：chat 先把 DOM 句柄和按钮接好，board 才能挂牌，
    // applyMode 最后跑（它会重置对话、写开场白）。
    SR.chat.init();
    SR.board.init('ggb', {
      playState: SR.chat.onPlayState,
      log: SR.chat.setStatus
    });

    // Key 按钮：只是把设置层打开。换 / 忘都在那一层里做。
    $('keybtn').addEventListener('click', function () { openKeyDlg(false); });
    $('keysave').addEventListener('click', saveKey);
    $('keyforget').addEventListener('click', function () {
      SR.api.forgetKey();
      $('keybtn').textContent = 'Key';
      $('keyerr').textContent = '已忘掉。要用得重新填。';
      $('keyinput').value = '';
    });
    $('keyinput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') saveKey();
    });
    document.querySelectorAll('.modebtn').forEach(function (b) {
      b.addEventListener('click', function () { applyMode(b.getAttribute('data-mode')); });
    });

    var ok = SR.api.hasKey();
    $('keybtn').textContent = ok ? 'Key ✓' : 'Key';
    $('input').disabled = !ok;

    applyMode(readSavedMode());
    $('input').focus();

    if (!ok) openKeyDlg(true);
  }

  return { boot: boot, needKey: needKey, applyMode: applyMode };
})();

document.addEventListener('DOMContentLoaded', function () { SR.main.boot(); });
