// 装配：模式切换、后端切换、Key 设置、关于面板、启动。
var SR = (window.SR = window.SR || {});

SR.main = (function () {

  var work = SR.DEFAULT_WORK || 'prep';

  function $(id) { return document.getElementById(id); }

  // 上次用的工位。★ **必须判合法性**，别照读照用：
  //   老浏览器里存的是上一版的键和上一版的值（`mathroot_mode = 'student'`），
  //   新代码要是直接拿去查 `SR.WORKS['student']`，拿到的是 undefined——整页白屏。
  //   这条是**真会发生的**，不是理论风险：前一版就是我们在用的那一版。
  //   顺手把旧键清掉，只清这一次。
  function readSavedWork() {
    var h = String(location.hash || '').replace(/^#/, '');
    if (SR.WORKS[h]) return h;
    // 老书签：#demo（教师演示）→ 画图，#student（学生模式）→ 备课
    if (h === 'demo') return 'draw';
    if (h === 'student') return 'prep';
    try { localStorage.removeItem(SR.LS_MODE); } catch (e) {}
    var w = '';
    try { w = localStorage.getItem(SR.LS_WORK) || ''; } catch (e) {}
    return SR.WORKS[w] ? w : (SR.DEFAULT_WORK || 'prep');
  }

  // 切工位。force = true 时不管规则一律重开一段（开机走这条）。
  //
  // ★ 切工位的清空规则：**画图／出题 与 备课／讲评 互相切时清空，备课↔讲评不清。**
  //   前两组不是一套提示词：画图／出题那两份里根本没有"台阶"这回事，
  //   把备课时的那段对话带过去，模型会拿着一堆问句的历史去画图，串味。
  //   而备课和讲评**用的是同一份提示词**（讲评 = 备课 + 整卷附注），
  //   是"先列题号、挑一道、再展开"的两个阶段——切一下就清，那道卷子就没了。
  function applyWork(w, force) {
    if (!SR.WORKS[w]) w = SR.DEFAULT_WORK || 'prep';
    var last = work;
    work = w;
    SR.chat.setWork(w);
    try { localStorage.setItem(SR.LS_WORK, w); } catch (e) {}
    document.body.setAttribute('data-work', w);
    var btns = document.querySelectorAll('.workbtn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-work') === w);
    }
    var el = $('badge');
    if (el) el.textContent = (SR.WORKS[w] && SR.WORKS[w].badge) || '';

    var stepsOf = function (id) { return !!(SR.WORKS[id] && SR.WORKS[id].steps); };
    // 同体系（备课↔讲评）：对话留着，档位按历史重推——**不能打回零**，
    // 那条链还接着呢，打回零等于告诉老师"刚才走的都不算"。
    if (!force && stepsOf(last) && stepsOf(w)) SR.chat.repaintSteps();
    else SR.chat.reset(w);                                              // 换了体系：重开
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

    paintKeyState();
    $('input').disabled = !ready;
    SR.chat.setStatus(ready ? '' : (cur === 'glm' ? '免费通道暂时不可用，可以切到自己的 Key' : '还没有填 Key'));
    return ready;
  }

  // 设置面板顶上那块状态牌。做它的理由：原来这面板一上来就是两段说明文字，
  // 看半天不知道自己现在到底在用什么、Key 到底填上没有——答案本来就该摆在这儿。
  // ★ Key 只显示**尾号四位**。整串摆出来，旁边有人路过就看见了；
  //   而且这块牌子在截图里也会出现（老师演示时会截图），尾号够认、不够用。
  function paintKeyState() {
    var plate = $('keystate');
    if (!plate) return;
    var cur = SR.api.getBackendId();
    var b = SR.BACKENDS[cur] || {};
    var ready = SR.api.ready(cur);
    $('ks-now').textContent = b.label || cur;
    var ok = $('ks-ok');
    ok.textContent = ready
      ? (b.keyInPage ? '已连上 · 不用填任何东西' : '已填好 · 用你自己的额度')
      : (b.keyInPage ? '没配上' : '还没填');
    ok.classList.toggle('ok', ready);
    ok.classList.toggle('no', !ready);
    plate.classList.toggle('warn', !ready);
    var tail = $('ks-tail');
    var k = SR.api.getKey(cur) || '';
    if (!b.keyInPage && k) {
      tail.textContent = '尾号 ' + k.slice(-4);
      tail.style.display = '';
    } else {
      tail.style.display = 'none';
    }
  }

  // 出错气泡里那个"切到自己的 Key"按钮会调到这儿
  function useOwnKey() {
    applyBackend('deepseek');
    openKeyDlg();
  }

  // ---- Key ----
  function openKeyDlg() {
    showOverlay($('keyset'));
    var inp = $('keyinput');
    inp.value = SR.api.getKey('deepseek');
    $('keyok').textContent = '';                       // 上一轮留下的"通了"，换个面板就说不上话了
    // 这句是**提示**不是报错：第一次进来的人看见红字，会以为自己哪儿做错了。
    // 挂 .hint 走灰字（main.css 那条），真出错时不挂，才走红。
    var fresh = !SR.api.hasKey('deepseek');
    sayKeyLine(fresh ? '用数根的免费通道也行，不用填。填了就是用你自己的额度，更稳。' : '', true);
    paintKeyState();
    inp.focus();
  }
  function closeKeyDlg() { hideOverlay($('keyset')); }

  // 往那一行写字只有这一个口子。省得"忘了把上次的 .hint 摘掉"——
  // 一忘，报错就顶着灰字出现，看着像句无关紧要的提示。
  function sayKeyLine(text, isHint) {
    var el = $('keyerr');
    el.textContent = text || '';
    el.classList.toggle('hint', !!isHint && !!text);
  }

  // 同一个校验在两处用（「测一下」和「保存并使用」），别各写一份
  function checkKeyFormat(v) {
    if (v.length < 20 || v.indexOf('sk-') !== 0) return '这不像一个 DeepSeek Key（一般以 sk- 开头）。';
    return '';
  }

  function saveKey() {
    var v = $('keyinput').value.trim();
    var bad = checkKeyFormat(v);
    if (bad) {
      $('keyok').textContent = '';
      sayKeyLine(bad);
      return;
    }
    SR.api.setKey(v);
    if (SR.api.getBackendId() !== 'deepseek') SR.api.setBackend('deepseek');
    sayKeyLine('');
    $('keyok').textContent = '';
    closeKeyDlg();
    applyBackend();
    $('input').focus();
    SR.chat.retryLast && SR.chat.retryLast();
  }

  function needKey() { openKeyDlg(); }

  // ============================================================
  //  弹层：关于 / Key，共用遮罩
  // ============================================================
  // ★ 开和关都要走这两个函数，别在别处直接 classList.add/remove('open')。
  //   那篇第六节讲"方舟在每一个需要进行页面切换的地方都加入了过场动画"——
  //   过场就挂在这个 .open 类上（见 main.css 的 ovIn/boxIn）。
  //
  // ★ 退场为什么非得有 JS：`.overlay` 是靠 `display:none` 切的，而 display
  //   **不参与过渡**，CSS 一个人收不回去。所以加一个 .closing 类放退场动画，
  //   等它跑完再把 .open 摘掉。这个定时器必须能被取消——不然会出现这种事故：
  //   点"关了"（150ms 后摘 .open）→ 立刻又点"我的 Key"（加上 .open）→
  //   定时器到点，把刚打开的弹层又关掉了。看着就是"点了没反应"。
  var OUT_MS = 150;
  function showOverlay(d) {
    if (!d) return;
    if (d._hideT) { clearTimeout(d._hideT); d._hideT = 0; }
    d.classList.remove('closing');
    d.classList.add('open');   // 类被摘掉过再加回来，CSS 动画会自己重播
  }
  function hideOverlay(d) {
    if (!d || !d.classList.contains('open') || d._hideT) return;
    d.classList.add('closing');
    d._hideT = setTimeout(function () {
      d._hideT = 0;
      d.classList.remove('open');
      d.classList.remove('closing');
    }, OUT_MS);
  }

  function openOverlay(id) { showOverlay($(id)); }
  function closeOverlay(d) { hideOverlay(d); }
  function closeAll() {
    var all = document.querySelectorAll('.overlay');
    for (var i = 0; i < all.length; i++) hideOverlay(all[i]);
  }

  // ---- 本地素材面板 ----
  // 列的是"哪一节手上有哪些文件"，不碰素材内容（见 js/resources.js 顶上的边界说明）。
  function openResources() {
    openOverlay('reslist');
    paintResources($('resq') ? $('resq').value : '');
    var q = $('resq');
    if (q) { q.focus(); q.select(); }
  }

  function paintResources(q) {
    var box = $('resrows'), meta = $('resmeta');
    if (!box) return;
    var rows = SR.resources.find(q);
    if (meta) {
      meta.textContent = '共 ' + SR.resources.total() + ' 个文件（' + SR.resources.when() + ' 扫的）' +
        (q ? '，这次筛出 ' + rows.length + ' 个' : '');
    }
    box.innerHTML = '';
    if (!rows.length) {
      var p = document.createElement('p');
      p.className = 'resempty';
      p.textContent = '没筛出来。试试节号（2.3）或者知识点（绝对值、勾股定理），也可以直接搜"学科网""葛""胡小群"。';
      box.appendChild(p);
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var el = document.createElement('div');
      el.className = 'resrow';
      // 错开入场的序号。CSS 那边是 `animation-delay: calc(var(--i) * 28ms)`。
      // ★ 封顶 24：一屏七十条的时候，第 70 条要等两秒才出来，那不叫动效叫卡顿。
      el.style.setProperty('--i', Math.min(i, 24));
      var head = document.createElement('div');
      head.className = 'reshape';
      head.textContent = (r.册 ? r.册 + ' · ' : '') + (r.节 ? r.节 + ' ' : '') + r.名 + '（' + r.型 + '）';
      var src = document.createElement('span');
      src.className = 'ressrc';
      src.textContent = r.源;
      head.appendChild(src);
      var path = document.createElement('code');
      path.className = 'respath';
      // 相对路径补上基准目录，直接粘到资源管理器就能找到
      path.textContent = /^[A-Za-z]:\\/.test(r.路径) ? r.路径 : SR.resources.base() + '\\' + r.路径;
      path.title = '点一下复制这个路径';
      path.addEventListener('click', function (p) {
        return function () {
          var t = p.textContent;
          var done = function () { p.classList.add('copied'); setTimeout(function () { p.classList.remove('copied'); }, 900); };
          // navigator.clipboard 在 http://localhost 下能用；万一不行还有老办法，
          // 都没有就让用户自己选中——所以要 title 提示它。
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(done, function () { selectNode(p); });
          } else selectNode(p);
        };
      }(path));
      el.appendChild(head);
      el.appendChild(path);
      box.appendChild(el);
    }
  }

  function selectNode(n) {
    try {
      var r = document.createRange(); r.selectNodeContents(n);
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    } catch (e) { /* 选不中就算了，路径本来就看得见 */ }
  }

  // ---- 知识库（验货） ----
  // 这个面板要做的事只有一件：让"检索到底召回了什么"看得见。
  // 在那之前它是个黑盒——学生问了、模型答了，中间那一步对不对，谁也说不出来。
  function openKB() {
    openOverlay('kblist');
    paintKB($('kbq') ? $('kbq').value : '');
    // 面板开着的时候才去装语料（跟正经使用同一条路，走的是同一个 kb.load）
    SR.kb.load(function () { paintKB($('kbq') ? $('kbq').value : ''); });
    var q = $('kbq');
    if (q) { q.focus(); q.select(); }
  }

  function paintKB(q) {
    var box = $('kbstat'), hits = $('kbhits');
    if (!box || !hits) return;
    var rows = SR.kb.status(), total = 0, any = false;
    box.innerHTML = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var el = document.createElement('div');
      el.className = 'kbrow' + (r.ok ? '' : ' miss');
      // ★ 只报"到了 / 没到"，不报"加载中"——load 是幂等的、有兜底的，
      //   面板上多一个状态就等于多一个要跟代码对齐的东西，不值。
      el.textContent = r.what + '　' + (r.ok ? r.条数 + ' 条 · 约 ' + r.KB + ' KB' : '没装上') + '　' + r.src;
      box.appendChild(el);
      if (r.ok) { total += r.条数; any = true; }
    }
    hits.innerHTML = '';
    if (!any) {
      hits.innerHTML = '<p class="resempty">语料还没到。等一下再打一次，或者看看上面那行是不是写着"没装上"。</p>';
      return;
    }
    if (!q) {
      hits.innerHTML = '<p class="resempty">两份语料共 ' + total + ' 条，都在了。' +
        '在上面打一句学生真会说的话，看看能翻出什么。</p>';
      return;
    }
    var res = SR.kb.search(q);
    // ★ 分数线从 SR.kb.cut 取，**不写死在这儿**——写死的话，哪天 api.js 那边调了线，
    //   这个面板还会照旧显示"10 分以下不给"，变成一台看着在验货、其实在骗人的仪器。
    paintHits(hits, '教材索引', res.textbook, SR.kb.cut('textbook'));
    paintHits(hits, '追问条目库', res.zhuawen, SR.kb.cut('zhuawen'));
  }

  function paintHits(box, name, list, cut) {
    var h = document.createElement('h3');
    h.textContent = name + '（' + list.length + ' 条）' + (cut ? '　阈值 ' + cut + ' 分以下不给' : '');
    box.appendChild(h);
    var p = document.createElement('p');
    p.className = 'resempty';
    if (!list.length) {
      p.textContent = '一条都没翻出来——这一轮走"没召回到"那一档，一个字都不往 system 里加。';
      box.appendChild(p);
      return;
    }
    // ★「撞上了但够不着线」跟「压根没撞上」是两回事，得分开说。
    //   前者是要调阈值时唯一值得看的那一屏——到底差多少，全在这儿。
    var pass = 0;
    for (var i = 0; i < list.length; i++) if (!cut || list[i].score >= cut) pass++;
    if (!pass) {
      p.textContent = '翻出来 ' + list.length + ' 条，一条都没够上 ' + cut + ' 分——这一轮走"没召回到"那一档，不给。';
      box.appendChild(p);
    }
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var row = document.createElement('div');
      row.className = 'kbhit' + (cut && it.score < cut ? ' cut' : '');
      row.style.setProperty('--i', Math.min(i, 24));   // 错开入场，见 main.css 那条
      var sc = document.createElement('span');
      sc.className = 'kbscore';
      sc.textContent = it.score.toFixed(1);
      if (cut && it.score < cut) sc.textContent += ' 卡掉';
      // 条目正文里有换行，摆进这个列表只留标题那一行——要看全文去源文件看
      var ttl = document.createElement('span');
      ttl.className = 'kbtitle';
      ttl.textContent = it.doc.title;
      row.appendChild(sc);
      row.appendChild(ttl);
      row.title = it.doc.text;
      box.appendChild(row);
    }
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

    // ---- 左栏「我的」区 ----
    $('aboutbtn').addEventListener('click', function () { openOverlay('about'); });

    // ---- 我的模板 ----
    // ★ 出材料的地基。**模板是每个老师传自己的**，站里不预置任何一所学校的模板。
    //   列表、上传、解析、「我认出来的是」那张卡，都在 js/material.js 里。
    var tb = $('tplbtn');
    if (tb && SR.material) {
      tb.addEventListener('click', function () { openOverlay('tpl'); SR.material.open(); });
      // ★ 开机把上次用的那份模板接回来。
      //   不接的话，刷一次页面 `cur` 就空了——老师传完模板、刷新一下，
      //   再说"出第五周的周练卷"，模型手上没有格式号表，就会跟他正常聊天、什么都不出。
      //   他看到的只是"它坏了"。验收线是「打开就能直接印」，所以这一步不能省。
      SR.material.restore();
    }

    // ---- 备课卡片（公开）----
    // ★ 跟下面那个「知识库」面板**是两件事**，别往一处合：
    //   这个公开，给老师备课时查（只列条目正文，没有分数）；
    //   那个只在本机出现，给编目的人验召回（分数、阈值）。
    //   渲染与装载都在 js/cards.js 里，那边只读 SR.ZHUAWEN，碰都不碰教材索引。
    var cb = $('cardbtn');
    if (cb && SR.cards) {
      cb.addEventListener('click', function () { openOverlay('cards'); SR.cards.open(); });
    }

    // ---- 本地素材（后备资源）----
    // ★ 按钮平时是藏着的。只有本机那份索引真在、真读进来了，才让它露面——
    //   公开站上没有那个文件，客户那边从头到尾看不到这个按钮。
    //   探一下是首页之后才做的，不挡开机。
    var rb = $('resbtn');
    if (rb) {
      rb.addEventListener('click', openResources);
      var rq = $('resq');
      if (rq) rq.addEventListener('input', function () { paintResources(rq.value); });
      SR.resources.load(function (ok) {
        if (ok) rb.style.display = '';
        else if (window.console) console.info('数根：本机没有 js/resource-index.js，「素材」按钮就不显示了。');
      });
    }
    // ---- 知识库（验货用）----
    // ★ 跟「素材」不一样：那一个是本机才有的**文件**，公开站上根本没有。
    //   知识库这两份语料是自写内容、公开站上也有，谁都能下下来看——
    //   不公开的只是**这个面板**（它显示分数和阈值，是给编目的人看的），
    //   所以门禁判的是"是不是本机"，不是"文件在不在"。
    var kb = $('kbbtn');
    if (kb && SR.kb) {
      var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ||
                  location.protocol === 'file:' || location.hostname === '';
      if (local) {
        kb.style.display = '';
        kb.addEventListener('click', openKB);
        var kq = $('kbq');
        if (kq) kq.addEventListener('input', function () { paintKB(kq.value); });
        // ★ 这里**不预装**语料。本机"不心疼"是错觉：开了这个头，
        //   首屏就照样得付那 117KB，跟没改一样——而且本机是唯一测得出来
        //   "延迟装载到底有没有生效"的地方，在这儿破例，等于把量具自己拆了。
        //   装语料只有两个时机：学生真提问（api.js 的 ask），或者点开这个面板（openKB）。
      }
    }

    // ★ 这里原来还挂着一个独立的 #keybtn（点了会切后端＋弹这个面板）。
    //   2026-10-01 拆掉了：它和顶栏「我的 Key」那一格通向的是同一件事，
    //   两个长得差不多的入口摆在一起，谁都说不清该点哪个。现在只剩顶栏那一处。
    $('keytest').addEventListener('click', function () {
      var btn = this;
      var v = $('keyinput').value.trim();
      var bad = checkKeyFormat(v);
      $('keyok').textContent = '';
      if (bad) { sayKeyLine(bad); return; }
      sayKeyLine('');
      var old = btn.textContent;
      btn.disabled = true;
      btn.textContent = '测…';
      // ★ 验的是**输入框里这一串**，不是已经存下来的那一串——
      //   学生刚改了一位还没保存，测出"通了"就等于骗他。
      SR.api.probeKey(v, function (res) {
        btn.disabled = false;
        btn.textContent = old;
        if (res && res.ok) {
          sayKeyLine('');
          $('keyok').textContent = '通了。点「保存并使用」就切过去。';
        } else {
          $('keyok').textContent = '';
          sayKeyLine('没通：' + ((res && res.error) || '不知道什么原因'));
        }
      });
    });

    $('keysave').addEventListener('click', saveKey);
    $('keyforget').addEventListener('click', function () {
      SR.api.forgetKey();
      $('keyok').textContent = '';
      sayKeyLine('已忘掉。要用得重新填。');
      $('keyinput').value = '';
      applyBackend();
    });
    // 「免费通道就行」——一键切回去，对不想注册的人最要紧的一步
    $('keyfree').addEventListener('click', function () {
      $('keyok').textContent = '';
      sayKeyLine('');
      closeKeyDlg();
      applyBackend('glm');
      $('input').focus();
    });

    // ---- 后端切换 ----
    // ★ 点「我的 Key」**每一下都得有去处**（2026-10-01 孔老师："我的 key 点了
    //   有反应不"）。原来漏了一整条岔路：**已经在这一格上、Key 也是好的，再点一下**
    //   ——applyBackend 原样重跑一遍，通道没变、不弹窗，屏幕上**一点动静都没有**。
    //   人的直觉是"我点了这个东西，就该给我这个东西"，没动静就等于按钮坏了。
    //   现在三种情况都有去处：
    //     ① 没填过 Key           → 弹面板让他填
    //     ② ★ 已经就在这一格上    → 也弹面板（"点它"的意思就是"我要看看我的 Key"）
    //     ③ 从免费通道切过来、Key 是好的 → 直接切，不弹（这是设好之后的日常动作，
    //        每次切都糊一个框才是烦人）
    document.querySelectorAll('.backbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-backend');
        var was = SR.api.getBackendId();
        if (id === 'deepseek' && was === id) { openKeyDlg(); return; }
        var ready = applyBackend(id);
        if (id === 'deepseek' && !ready) openKeyDlg();
        else $('input').focus();
      });
    });

    // ---- 工位切换 ----
    document.querySelectorAll('.workbtn').forEach(function (b) {
      b.addEventListener('click', function () { applyWork(b.getAttribute('data-work')); });
    });

    // ---- 新的一课 ----
    // ★ 补这个按钮的理由：chat.js 里有 MAX_TURNS = 24 那道闸，可见前**没有任何清空入口**。
    //   备课是"一课一清"的活儿：上一节课的追问链留在屏幕上，下一课接着问会串味。
    //   原来只能靠切工位间接清（还得切两次），现在给它一个正当的门。
    var nb = $('newbtn');
    if (nb) nb.addEventListener('click', function () { SR.chat.reset(work); });

    // ---- 平面 / 三维 ----
    document.querySelectorAll('.viewbtn').forEach(function (b) {
      b.addEventListener('click', function () { SR.board.setView(b.getAttribute('data-view')); });
    });

    // ---- 备课卡片：挂搜索框和"点一行抄走" ----
    // ★ 只挂监听，不预装语料。语料是点开面板那一刻才去拿的（js/cards.js 的 open）——
    //   跟下面知识库那条是同一条纪律：首屏不许为了一个还没打开的抽屉付流量。
    if (SR.cards) SR.cards.bind();

    applyWork(readSavedWork(), true);

    // ★ 首屏不弹 Key 层了。默认后端是免费通道，本来就什么都不用填——
    //   一进来就糊一个"请填 Key"的框，是把人往外推。
    applyBackend(SR.api.getBackendId());
    $('input').focus();
  }

  return { boot: boot, needKey: needKey, applyWork: applyWork, applyBackend: applyBackend, useOwnKey: useOwnKey };
})();

document.addEventListener('DOMContentLoaded', function () { SR.main.boot(); });
