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
    // ★★ 2026-10-03：点工位那一行 = 老师已经明确说了"办哪一件"，首屏该收了。
    //   为什么非收不可：下面 `SR.chat.reset()` 会 `#msgs.innerHTML=''` 把整栏重建，
    //   首屏那条消息也跟着没了；而 `data-landing` **还挂着**
    //   → `body[data-landing="1"] #msgs > .msg:not(.landing){display:none}`
    //   会把刚重建出来的开场白一起藏住 → 屏幕上反而**什么都不剩**。
    //   （boot 时也走这儿，但那会儿 landing.js 还没 init，`els.box` 是空的，
    //    `hide()` 一拳打空、没有副作用；紧接着的 `SR.landing.init()` 会照常 show()。）
    if (SR.landing && SR.landing.hide) SR.landing.hide();
    // ★★ 2026-10-03：「我按【X】办的（照…认的）」是**我替他归类**的结论，
    //   只在"他没说办哪一件、我猜了一把"之后才算数。老师一旦亲手点了工位那一行，
    //   那句话就过期了 —— 可它原来**没人撤**（`clearStrip` 只挂在 pick/rework/⟳ 三处，
    //   而工位按钮走的是 applyWork，压根不经过 landing）。
    //   实测症状（test/_sweep6.cjs 的截图）：工位行已经亮在【组卷】上、对话里也写着
    //   「换到「组卷」」，底下那条却还挂着"我按【备课】办的" —— 一句和眼前自相矛盾的话，
    //   而且因为它长得像状态栏，老师会当成"它其实还是按备课办的"。
    //   ★ 放这儿不会把归类那条打掉：intercept() 那条路是 pick() 在前、strip() 在后，
    //     写进去的时候这一下早过去了（见 js/landing.js 的 intercept）。
    if (SR.landing && SR.landing.clearStrip) SR.landing.clearStrip();
    work = w;
    SR.chat.setWork(w);
    try { localStorage.setItem(SR.LS_WORK, w); } catch (e) {}
    document.body.setAttribute('data-work', w);
    // 流水线那一块跟着这个工位显隐（见 js/flow.js 的 setWork）。
    // ★ 备课↔讲评是**同一条链**，过去的时候账本留着不重开——
    //   跟下面 `stepsOf(last) && stepsOf(w)` 那条"不把链子打回零"是同一个道理。
    if (SR.flow) SR.flow.setWork(w);
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
          // ★ 2026-10-02 改走全站那唯一一份 `SR.copyText`（js/chat.js），别在这儿再养一套。
          //   这里原来赌的是"`navigator.clipboard` 不行就会 reject"——**它不 reject，它会挂着**，
          //   于是 `selectNode` 那条退路永远走不到，点一下毫无动静。
          //   现在是：成了亮一下，没成（file:// 之类）就把路径选中，老师自己 Ctrl+C。
          SR.copyText(t, function (ok) { if (ok) done(); else selectNode(p); });
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
  // 现画工位那一行（输入框底下那六颗 .workbtn）。
  //
  // ★ 2026-10-02 加。左栏撤掉之前，这六颗是**写死在 index.html 里的**；
  //   左栏一没，工位行得换个地方摆，顺手把"写死"这件事也去掉：
  //   名字只有 js/config.js 的 SR.WORKS[].label 一个真源，加一格不用改两处。
  //   ⚠ 教训是现成的：2026-10-02 查"六个项目在哪"时发现「学情」**从没进过源码**，
  //     而当时左栏和首屏卡片各写死了一遍五个名字——两处都对得上，
  //     所以少了的那一格在屏幕上看着完全正常，谁也看不出缺东西。
  //
  // ★ 非在 boot() **最前面**画不可（早于 memo.init / 下面那段接线 / 最后的 applyWork）：
  //   · 接线那一句是 querySelectorAll('.workbtn')——按钮还没入 DOM 就找不到东西，
  //     六颗全点不动（而且一声不响）；
  //   · applyWork 要照着它们 toggle('on') 高亮、memo.js 的 paintWorks 还要照
  //     SAY 给它们点灯（就在 memo.init 里）——都得先有按钮。
  // ★ 用 SR.WORK_ORDER 排序、SR.WORKS 取名字，两样缺一就退回 WORKS 自己的顺序：
  //   宁可排得不对，也不要空白一行——空白在屏幕上跟"产品没这个功能"一样。
  function paintWorks() {
    var box = $('works');
    if (!box) return;
    var order = (SR.WORK_ORDER || []).filter(function (id) { return !!SR.WORKS[id]; });
    var all = Object.keys(SR.WORKS);
    // 顺序表里漏掉的工位**补在后面**，不是丢掉：漏一个 = 那一格点不进去，
    // 而"少了一格"在屏幕上和"本来就没有这一格"长得一样。
    all.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    if (!order.length) return;
    var html = '';
    for (var i = 0; i < order.length; i++) {
      var w = SR.WORKS[order[i]] || {};
      // title 给的是 badge（那句话本来就是"这一格是干什么的"的唯一说明）。
      html += '<button type="button" class="workbtn" data-work="' + order[i] + '"'
           +  ' title="' + (w.badge || '') + '">' + (w.label || order[i]) + '</button>';
    }
    box.innerHTML = html;
  }

  // ============================================================
  //  画板抽屉（2026-10-03）
  // ============================================================
  // ★ 只写 `data-drawer` 这一个属性，**别在这儿动别的**：开关长什么样全在
  //   css 的 `.drawer` / `.drawer[data-drawer="open"]` 那两条里，一处真源。
  //   `.boardbox` 全局只有一份，所以"同时只有一块活画板"天然成立，不用加锁。
  //
  // ⚠ 关的时候**不要**调 refit：尺寸一点没变（`transform` 不改布局，
  //   这也是不能换成 `display:none` 的原因之一），ResizeObserver 不会触发，
  //   手动 refit 一次反而会在离屏画图那会儿插队。
  function openDrawer() {
    var d = $('drawer'); if (!d) return;
    d.setAttribute('data-drawer', 'open');
    d.setAttribute('aria-hidden', 'false');
    var s = $('drawerscrim'); if (s) s.hidden = false;
  }
  function closeDrawer() {
    var d = $('drawer'); if (!d) return;
    d.setAttribute('data-drawer', 'closed');
    d.setAttribute('aria-hidden', 'true');
    var s = $('drawerscrim'); if (s) s.hidden = true;
  }

  function boot() {
    // ★ 第一件事：把工位那一行画出来。理由见 paintWorks 上面那段——
    //   下面 SR.memo.init()、.workbtn 接线、最后的 applyWork 全都踩在这几颗按钮上。
    paintWorks();

    // 署名以 config.js 为准刷一遍页脚和画板水印（index.html 里那两处是开机前的样子）。
    // 顺序上放最前面：board 挂牌时会用到水印，存图也照它取字。
    var cr = $('credits');
    if (cr && SR.COPYRIGHT) cr.textContent = SR.COPYRIGHT;
    var wm = document.querySelector('.wm');
    if (wm && SR.WATERMARK) wm.textContent = SR.WATERMARK;

    // 统一记忆（见 js/memo.js）。★ 排在 chat.init 前面：
    //   「这一份」那一行得先挂上，底下 chat.init 接按钮的时候它已经在屏幕上了；
    //   而且 applyWork → chat.reset 要从它那儿把上一场读回来，它得先就位。
    if (SR.memo) SR.memo.init();

    // 顺序要紧：chat 先把 DOM 句柄和按钮接好，board 才能挂牌，
    // applyMode 最后跑（它会重置对话、写开场白）。
    SR.chat.init();
    SR.board.init('ggb', {
      playState: SR.chat.onPlayState,
      log: SR.chat.setStatus,
      // 画板切了维度（老师点按钮，或者模型自己在围栏里写 #三维 / #平面）
      //
      // ★★ 2026-10-02：那一排「平面／三维／导图」**谁亮**不再由这儿点了，
      //   交给 js/mindmap.js 的 syncSwitcher **一处**说了算。
      //   非挪不可的理由：现在有三个可能的状态，而"导图开着"这一档**必须压过**
      //   另外两颗——导图一开，「三维」要是还亮着，看着像导图变成了三维。
      //   这边再点一次就是第二个真源，两个真源早晚会在某一刻说得不一样。
      // ★ yieldToBoard：**模型把画板切了视角，就是把导图让开**——
      //   跟 chat.js 收到围栏、tabs.js 点某页标签是同一个动作、同一个名字。
      view: function (is3d) {
        if (!SR.mm) return;
        SR.mm.set3D(is3d);        // 它自己会 syncSwitcher，这儿不用再喊一次
        SR.mm.yieldToBoard();
      }
    });
    // 右栏多页（见 js/tabs.js）。★ 排在 board.init **后面**：
    //   它整条路都踩在 SR.board 的 snapshot/restore/activatePage/openNew 上。
    //   它自己会等画板就绪（GeoGebra 那一包要拉几秒），等不到就走老路——
    //   所以这一句是"加一层"，不是"换一条路"，画板起不来时画图照旧。
    if (SR.tabs) SR.tabs.init('tabs');
    // 思维导图（见 js/mindmap.js）。★ 排在 board.init / tabs.init 之后：
    //   它一装好就要读 `.viewsw` 那三颗按钮、画第一张（虽然这会儿多半是空场），
    //   而且它按的 `SR.board.mark`（署名）、`SR.pack.turns`（账本）也都是前面装的。
    //   ⚠ 这一句只是**把画布开出来**，导图仍然是关着的（css 里 display:none），
    //     老师点「导图」那一下才第一次真画——所以它不拖慢开机。
    if (SR.mm) SR.mm.init('mm');

    // 流水线（见 js/flow.js）。★ 排在 chat.init 之后：init 里要读 SR.chat.getWork()
    //   才判得出现在是哪个工位（判据是那个工位身上有没有 retrieve 这个开关，
    //   所以 flow.js 里看不到任何具体工位的名字）。
    //   它只是把右栏那一块显隐摆对、画一张空场——**不跑检索、不发请求**。
    if (SR.flow) SR.flow.init();

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

    // ---- 左栏下组 ----
    $('aboutbtn').addEventListener('click', function () { openOverlay('about'); });

    // ★ "这一趟是不是在本机"——左栏下组那三颗按钮**共用一个判据**，别各判各的。
    //   2026-10-02 之前只有「知识库」在用（当时「备课卡片」是对访客公开的），
    //   现在备课卡片也收进来了，所以提到外面算一次。
    //   判据跟 js/kb.js 的 local() 是同一套：localhost／127.0.0.1／file://／空 host。
    var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1' ||
                  location.protocol === 'file:' || location.hostname === '';

    // ---- 模板库（住在「组卷」产物栏的「版式」那一行里）----
    // ★ 组卷的地基。**模板是每个老师传自己的**，站里不预置任何一所学校的模板。
    //   列表、上传、解析、「我认出来的是」那张卡，都在 js/material.js 里。
    // ★ 2026-10-02 从左栏「我的」区搬进「组卷」的产物栏（#tplbar）。搬完多了
    //   一件事：它得**说出当前用的是哪一份**（#tplnow）。原来只有"选中了"这个
    //   内存状态，开机 restore() 接回来的那份**界面上一个字都不说**。
    SR.paintTpl = function () {
      var el = $('tplnow');
      if (!el) return;
      var t = (SR.material && SR.material.current) ? SR.material.current() : null;
      el.textContent = t ? ('正在用「' + t.name + '」') : '还没选模板 · 出的是通用格式';
      el.classList.toggle('on', !!t);
    };

    var tb = $('tplbtn');
    if (tb && SR.material) {
      tb.addEventListener('click', function () { openOverlay('tpl'); SR.material.open(); });
      // ★ 开机把上次用的那份模板接回来。
      //   不接的话，刷一次页面 `cur` 就空了——老师传完模板、刷新一下，
      //   再说"出第五周的周练卷"，模型手上没有格式号表，就会跟他正常聊天、什么都不出。
      //   他看到的只是"它坏了"。验收线是「打开就能直接印」，所以这一步不能省。
      //   ★ 接回来之后那一行会自己重画：js/material.js 里定了一条规矩——
      //     **cur 一变就调 SR.paintTpl()**（选／传／删／接回来四处都调）。
      //     不重画的话，界面上一直写着"还没选模板"，而模型手上其实已经有版式表了；
      //     "它自己知道、界面上不说"正是这一行要消灭的东西。
      //   ★★ 接回来之后还得**回头补卷子卡**（2026-10-03）：
      //     `restore()` 是异步的（读 IndexedDB），而重画对话那条路在 `chat.init()`
      //     （上面第 441 行）里**同步**就跑完了 —— 那一刻 `cur` 还是 null，
      //     刷新之后每一轮的卷子卡**一条都建不出来**，而且没有任何报错：
      //     字在、冻图占位在，只有那张卡没了。老师只会以为"卷子丢了"。
      //     （当场那一轮不走这条路，`cur` 就在手上，所以这个毛病只在刷新后出现。）
      //   ⚠ 必须挂在 then 上，不能顺手在下面再调一次 —— 那时它还没读完。
      var rp = SR.material.restore();
      if (rp && rp.then && SR.chat && SR.chat.paintMatCards) {
        rp.then(function () { SR.chat.paintMatCards(); });
      }
    }
    SR.paintTpl();

    // ---- 备课卡片 ----
    // ★ 2026-10-02 改：**只在本机出现**了（原来对访客公开）。孔老师的原话是
    //   "那个我的的内容也需要去掉……不要给使用的人看到了"。
    //   它列的是那 118 条追问条目库——他自己写的，本来公开无妨；现在收成只给他
    //   自己备课时查。门禁跟下面「知识库」同一套判法（判是不是本机）。
    // ★ 跟「知识库」面板仍是两件事，别往一处合：
    //   这个只列条目正文（没有分数）；那个显示分数和阈值，给编目的人验召回。
    //   渲染与装载都在 js/cards.js 里，那边只读 SR.ZHUAWEN，碰都不碰教材索引。
    var cb = $('cardbtn');
    if (cb && SR.cards && isLocal) {
      cb.style.display = '';
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
    // ★ 2026-10-02 改：这段原来写的是"这两份语料是自写内容、公开站上也有"——
    //   那句**当年就不准，现在更不准了**。这个面板背后是两份不同的语料：
    //     js/zhuawen.js  —— 孔老师自己写的 118 条追问条目，公开站上确实有，公开无妨；
    //     js/textbook.js —— **课本定义和法则的原文**，2026-10-02 已经撤出仓库、
    //                       被 .gitignore 挡着，公开站上是 404（实测）。
    //   也就是说：面板的可见性和文件的可见性**是两件事**，别再把它们写成一件事。
    //   这个面板显示分数和阈值，是给编目的人看的，门禁判的是"是不是本机"。
    var kb = $('kbbtn');
    if (kb && SR.kb) {
      if (isLocal) {
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

    // ---- 清空重开（顶栏那一排最右边那颗 ⟳）----
    // ★ 补这个按钮的理由：chat.js 里有 MAX_TURNS = 24 那道闸，可见前**没有任何清空入口**。
    //   备课是"一课一清"的活儿：上一节课的追问链留在屏幕上，下一课接着问会串味。
    //   原来只能靠切工位间接清（还得切两次），现在给它一个正当的门。
    //
    // ★ 2026-10-02：那颗箭头**改成写在 index.html 里了**（原来是在这儿 innerHTML 塞的）。
    //   原因是它旁边多了三个同伴（本地素材／备课卡片／知识库），四个图标同一套写法
    //   才好对齐、好一起调大小；一个塞在这儿、三个写在 HTML 里，改一次得翻两个文件。
    //   ★ 当初"塞在这儿"的两条理由仍然算数，一并留着：图标**不用字体**（图标字体的
    //     箭头在不同机器上胖瘦差得远，有的机器干脆吐一个豆腐块），path 数据也**不挨着
    //     别的按钮**（那段 d 长得会把邻近几行挤到屏幕外，读起来不知道在看什么）。
    var nb = $('newbtn');
    if (nb) {
      // ★★ 这颗是**唯一**能清记忆的地方（孔老师的原话：「除非我靠一个刷新按钮给他清了」）。
      //   {wipe:true} 只在这一个调用点出现——见 js/chat.js 的 reset 和 js/memo.js 的 clear。
      //   别把它加到 applyWork 上去：那样切一次工位就抹一场，
      //   而"切工位顺手清掉了"在屏幕上和"本来就没记住"完全一样。
      nb.addEventListener('click', function () { SR.chat.reset(work, { wipe: true }); });
    }

    // ---- 平面 / 三维 / 导图（这一排是"右栏显示什么"，见 js/mindmap.js）----
    // ★ 三颗按钮的监听**只在这一处**。mindmap.js 装的时候只认下它们用于点灯，
    //   不自己绑一遍——绑两遍的话「导图」会同时走 show('mm') 和 setView('mm') 两条路，
    //   setView 那头认不出 'mm'，`if (v === '3d') ... else showPlane()` 会把它当平面。
    document.querySelectorAll('.viewbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-view');
        // 「导图」不开视角，只是把自己的那层盖到画板上。
        if (v === 'mm') { if (SR.mm) SR.mm.show('mm'); return; }
        // 平面／三维：**先把导图让开**，再真切视角。
        // ★ 这一句不能省，也不能只靠 board 的 view 钩子：画板**已经在平面**时
        //   点「平面」，board.js 的 to2D 是 `if (!api || !is3D) return`——
        //   一个钩子都不发。少了这一句，老师点了「平面」，导图还盖在那儿，
        //   看着就是"这个按钮坏了"。（点了没反应比反应错更难查。）
        if (SR.mm) SR.mm.show(v);
        SR.board.setView(v);
      });
    });

    // ---- 画板抽屉：遮罩点一下关、Esc 关 ----
    // ★ 两条关的路都留着：遮罩是"点到外面"，Esc 是"我不想看了"，
    //   少了任何一条，抽屉开了之后都有一半人是靠猜关掉的。
    //   ⚠ Esc 只关抽屉，**不**顺手关别的层：overlay（关于／知识库）有自己的关法，
    //     在这儿一起关会把"开着知识库按 Esc"变成两件事一起发生。
    (function () {
      var sc = $('drawerscrim');
      if (sc) sc.addEventListener('click', closeDrawer);
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var d = $('drawer');
        if (d && d.getAttribute('data-drawer') === 'open') { closeDrawer(); e.preventDefault(); }
      });
    })();

    // ---- 备课卡片：挂搜索框和"点一行抄走" ----
    // ★ 只挂监听，不预装语料。语料是点开面板那一刻才去拿的（js/cards.js 的 open）——
    //   跟下面知识库那条是同一条纪律：首屏不许为了一个还没打开的抽屉付流量。
    if (SR.cards) SR.cards.bind();

    applyWork(readSavedWork(), true);

    // 首屏（见 js/landing.js）。★ 位置就压在 applyWork 后面，两个理由：
    //   ① 它要画"上次用的是哪一件"那一块，得等 applyWork 把工位定下来才问得准；
    //   ② 它要读 `body[data-work]`，那也是 applyWork 写的。
    //   ⚠ 放在这串的最后（不是中间）：上面 board/mindmap/flow 谁先谁后各有各的理由，
    //     而首屏**只跟 chat 的 getWork 有关**，跟画板、导图、流水线一个字都不搭。
    if (SR.landing) SR.landing.init();

    // ★ 首屏不弹 Key 层了。默认后端是免费通道，本来就什么都不用填——
    //   一进来就糊一个"请填 Key"的框，是把人往外推。
    applyBackend(SR.api.getBackendId());
    $('input').focus();
  }

  return { boot: boot, needKey: needKey, applyWork: applyWork, applyBackend: applyBackend, useOwnKey: useOwnKey,
           openDrawer: openDrawer, closeDrawer: closeDrawer };
})();

document.addEventListener('DOMContentLoaded', function () { SR.main.boot(); });
