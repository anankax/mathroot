// 装配：模式切换、后端切换、Key 设置、关于面板、启动。
var SR = (window.SR = window.SR || {});

SR.main = (function () {

  var mode = 'student';

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

  // ============================================================
  //  后端
  // ============================================================
  // 默认走免费通道（Key 写在 config.js 里，访客什么都不用填）。
  // 切到"用自己的 Key"才需要弹 Key 层——首屏不弹，降低门槛。
  function applyBackend(id) {
    if (id) SR.api.setBackend(id);
    var cur = SR.api.getBackendId();
    var ready = SR.api.ready(cur);

    var btns = document.querySelectorAll('.backbtn');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-backend') === cur;
      btns[i].classList.toggle('on', on);
      // 免费通道没配上 Key 时点一个红点提示（一般是部署时忘了填）
      btns[i].classList.toggle('warn', on && !ready);
    }

    var kb = $('keybtn');
    if (cur === 'glm') {
      kb.textContent = ready ? '免费通道' : 'Key ✗';
      kb.title = ready ? '正在用 KAX 的免费通道，不用填任何东西' : '免费通道没配好';
    } else {
      kb.textContent = ready ? 'Key ✓' : 'Key';
      kb.title = '用自己的 DeepSeek Key';
    }
    $('input').disabled = !ready;
    SR.chat.setStatus(ready ? '' : (cur === 'glm' ? '免费通道暂时不可用，可以切到自己的 Key' : '还没有填 Key'));
    return ready;
  }

  // 出错气泡里那个"切到自己的 Key"按钮会调到这儿
  function useOwnKey() {
    applyBackend('deepseek');
    openKeyDlg();
  }

  // ---- Key ----
  function openKeyDlg() {
    $('keyset').classList.add('open');
    var inp = $('keyinput');
    inp.value = SR.api.getKey('deepseek');
    $('keyerr').textContent = SR.api.hasKey('deepseek')
      ? '' : '用数根的免费通道也行，不用填。填了就是用你自己的额度，更稳。';
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
    if (SR.api.getBackendId() !== 'deepseek') SR.api.setBackend('deepseek');
    closeKeyDlg();
    applyBackend();
    $('input').focus();
    SR.chat.retryLast && SR.chat.retryLast();
  }

  function needKey() { openKeyDlg(); }

  // ============================================================
  //  弹层：关于 / Key，共用遮罩
  // ============================================================
  function openOverlay(id) { var d = $(id); if (d) d.classList.add('open'); }
  function closeOverlay(d) { d.classList.remove('open'); }
  function closeAll() {
    var all = document.querySelectorAll('.overlay');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('open');
  }

  // ============================================================
  //  启动
  // ============================================================
  function boot() {
    // 署名以 config.js 为准刷一遍页脚和画板水印（index.html 里那两处是开机前的样子）。
    // 顺序上放最前面：board 挂牌时会用到水印，存图也照它取字。
    var cr = $('credits');
    if (cr && SR.COPYRIGHT) cr.textContent = SR.COPYRIGHT;
    var wm = document.querySelector('.wm');
    if (wm && SR.WATERMARK) wm.textContent = SR.WATERMARK;

    // 顺序要紧：chat 先把 DOM 句柄和按钮接好，board 才能挂牌，
    // applyMode 最后跑（它会重置对话、写开场白）。
    SR.chat.init();
    SR.board.init('ggb', {
      playState: SR.chat.onPlayState,
      log: SR.chat.setStatus,
      // 模型在围栏里写 #三维 / #平面 时，把工具条那两个按钮跟着点亮
      view: function (is3d) {
        var vs = document.querySelectorAll('.viewbtn');
        for (var i = 0; i < vs.length; i++) {
          vs[i].classList.toggle('on', vs[i].getAttribute('data-view') === (is3d ? '3d' : '2d'));
        }
      }
    });

    // ---- 弹层的关闭：点按钮、点遮罩空白处、按 Esc ----
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-close')) { closeAll(); return; }
      // 点遮罩本身（不是里面的 box）也关掉
      if (t && t.classList && t.classList.contains('overlay')) closeOverlay(t);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll();
      if (e.key === 'Enter' && $('keyset').classList.contains('open')) saveKey();
    });

    // ---- 顶栏按钮 ----
    $('aboutbtn').addEventListener('click', function () { openOverlay('about'); });
    $('keybtn').addEventListener('click', function () {
      // 正在用免费通道：点它就切到"用自己的 Key"，顺手把设置层打开
      if (SR.api.getBackendId() === 'glm') applyBackend('deepseek');
      openKeyDlg();
    });

    $('keysave').addEventListener('click', saveKey);
    $('keyforget').addEventListener('click', function () {
      SR.api.forgetKey();
      $('keyerr').textContent = '已忘掉。要用得重新填。';
      $('keyinput').value = '';
      applyBackend();
    });
    // 「免费通道就行」——一键切回去，对不想注册的人最要紧的一步
    $('keyfree').addEventListener('click', function () {
      closeKeyDlg();
      applyBackend('glm');
      $('input').focus();
    });

    // ---- 后端切换 ----
    document.querySelectorAll('.backbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-backend');
        var ready = applyBackend(id);
        if (id === 'deepseek' && !ready) openKeyDlg();   // 没 Key 就别让它干等着
        else $('input').focus();
      });
    });

    // ---- 模式切换 ----
    document.querySelectorAll('.modebtn').forEach(function (b) {
      b.addEventListener('click', function () { applyMode(b.getAttribute('data-mode')); });
    });

    // ---- 平面 / 三维 ----
    document.querySelectorAll('.viewbtn').forEach(function (b) {
      b.addEventListener('click', function () { SR.board.setView(b.getAttribute('data-view')); });
    });

    applyMode(readSavedMode());

    // ★ 首屏不弹 Key 层了。默认后端是免费通道，本来就什么都不用填——
    //   一进来就糊一个"请填 Key"的框，是把人往外推。
    applyBackend(SR.api.getBackendId());
    $('input').focus();
  }

  return { boot: boot, needKey: needKey, applyMode: applyMode, applyBackend: applyBackend, useOwnKey: useOwnKey };
})();

document.addEventListener('DOMContentLoaded', function () { SR.main.boot(); });
