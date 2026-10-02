// 统一记忆：这一场的东西留在浏览器里。切工位不丢，刷新页面不丢，**只有 ⟳ 能清**。
//
// 孔老师 2026-10-02 的原话：
//   「看看上下文记忆存储能不能搞出来，不然对话着对话着智能体就忘记了，
//     然后最好所有的功能在这个对话框能有一个统一的记忆，
//     除非我靠一个刷新按钮给他清了，不然网络记忆会一直保存在用户浏览器里面」
//
// 这三句拆成三件事，都在这个文件里：
//   一、**模型那边不忘** —— history 落盘。以前它只活在内存里：切一次工位就抹掉，
//       刷新一下页面也没了；而"没了两轮"和"没了一大段"在屏幕上**长得一模一样**，
//       老师只会觉得"这智能体记性不好"，看不出是这儿丢的。
//   二、**人这边看得见** —— 「这一份」（课题 · 班级 · 日期 ＋ 口袋里有什么），
//       摆在中栏最上面那一行。它跟 history 是**同一份数据**的两个朝向：
//       模型读的是对话，人读的是口袋。
//   三、**只有 ⟳ 能清** —— 清空是**一个动作**，不是切工位、刷页面的副作用。
//
// ★★ 图片不落盘。这是**故意的取舍**，不是没做完：
//   history 里带图的那些条目，图是 base64 dataURL，一页卷子就一两兆；
//   localStorage 一共只有 5 兆左右，塞两张就满。满了以后 `setItem` 是**静默失败**
//   （抛 QuotaExceededError，被 catch 吃掉），看起来像"存上了"，
//   下次打开才发现是空的——**比不存更坏**。
//   所以落盘时把图剥掉，只留一行字说明这儿本来有几张图。
//   代价写在明处：**刷新之后模型不能再看见那些图**，但题号、结论、链子都在文字里，
//   接着往下聊不受影响。真要图片也留住，那是 IndexedDB 那条路（模板就是这么存的，
//   见 js/tpl.js），不是一个键能办的事。
//
// ★ 键名只有一个：`mathroot_memo`。所有工位共用这一份，这是"统一记忆"的字面意思。
//   曾经想过每个工位一个键，那样切工位就是"换了一本笔记"，正好是老师抱怨的那件事。
var SR = (window.SR = window.SR || {});

SR.memo = (function () {

  var KEY = 'mathroot_memo';
  var V = 1;

  // 落盘的软上限。localStorage 通常给 5MB，这个页面还要放 Key、上次工位、模板 id
  // 那几个小键，所以给自己划 400KB——够放几千轮文字，也不会把别人的位置挤掉。
  // 超了就**从最老的开始丢**，并且在控制台说一句（悄悄丢最坏，见 js/tabs.js 里同一段道理）。
  var CAP = 400 * 1024;

  // 口袋里的东西怎么称呼——**只列"往里放东西"的那几个工位**，
  //   一个工位一条，它产什么就记什么。
  // ★ 这里**没有讲评**，是故意的：讲评是**从口袋里取**的（点着得分率最低那几道讲），
  //   它不往里放。给它硬凑一个"讲评 N 条"出来，只能靠数它说了几轮——
  //   而"它说了几轮"跟"它讲了几条"不是一件事，那个数会被当成事实读
  //   （[[scanner-numbers-are-not-what-they-claim]] 那一整条教训）。
  var SAY = {
    draw:     { k: 'fig',   one: '图',   unit: '张' },
    vary:     { k: 'prob',  one: '题',   unit: '道' },
    material: { k: 'paper', one: '卷子', unit: '份' },
    prep:     { k: 'chain', one: '链',   unit: '节' }
  };
  // 摆出来的顺序 = 工位那一行的顺序（跟 config.js 的 SR.WORK_ORDER 一致，不另立一套）
  var ORDER = ['material', 'draw', 'prep', 'vary'];

  var mem = null;
  var timer = 0;
  var lastErr = '';

  function blank() {
    return { v: V, ts: 0, work: '', pocket: { topic: '', cls: '', date: '', marks: {} }, turns: [] };
  }

  function today() {
    var d = new Date();
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  // ---- 读 ----
  // ★ 坏数据一律当空处理，**不要**在坏数据上接着往上写：那会把一份能救的存档
  //   改成一份彻底没法救的。宁可当作新的一场（老师最多觉得"这次没记住"），
  //   也不能把上一场的存档覆盖成半截。
  function read() {
    var raw = '';
    try { raw = localStorage.getItem(KEY) || ''; } catch (e) { return blank(); }
    if (!raw) return blank();
    var o;
    try { o = JSON.parse(raw); } catch (e) { return blank(); }
    if (!o || typeof o !== 'object' || o.v !== V) return blank();
    if (!o.pocket || typeof o.pocket !== 'object') o.pocket = blank().pocket;
    if (!o.pocket.marks || typeof o.pocket.marks !== 'object') o.pocket.marks = {};
    if (!(o.turns instanceof Array)) o.turns = [];
    return o;
  }

  function get() { if (!mem) mem = read(); return mem; }

  // ---- 写 ----
  // 返回 true 才算真写进去了。写不进去**不许装作写进去了**——
  // 这个函数返回 false 的时候，调用方（和探针）要能看见。
  function writeNow() {
    var o = get();
    o.ts = Date.now();
    var s = JSON.stringify(o);
    var tries = 0;
    while (true) {
      try {
        localStorage.setItem(KEY, s);
        lastErr = '';
        return true;
      } catch (e) {
        lastErr = String(e && e.name || e);
        // 装不下 → 从最老的开始丢一半，再来。最多两轮，还不行就认输。
        if (++tries > 2 || o.turns.length < 4) {
          console.warn('数根：这一场的记忆没存进去（' + lastErr + '），下次打开会是空的。');
          return false;
        }
        var cut = Math.ceil(o.turns.length / 2);
        console.warn('数根：这一场的记忆装不下，丢了最早的 ' + cut + ' 轮。');
        o.turns = o.turns.slice(cut);
        s = JSON.stringify(o);
      }
    }
  }

  // 节流：一轮里可能连着推两条（老师一条、模型一条），不必写两次盘。
  function save() {
    if (timer) return;
    timer = setTimeout(function () { timer = 0; writeNow(); }, 400);
  }

  // ============================================================
  //  一、对话（模型读的那份 ＋ 气泡要重画的那份 —— 同一份）
  // ============================================================
  //
  // 存的是**原文**（模型吐的那个 raw，带围栏），不是剥好的可见文字：
  //   · 喂给模型要的就是原文（围栏是它自己的话，剥了它下一轮就不知道自己画过什么）；
  //   · 重画气泡走 js/render.js 那条老路（`renderInto`），围栏它自己认识。
  // 一份数据两个朝向，就不存在"屏幕上的"和"发给模型的"对不上这种事了。

  // content 可能是字符串，也可能是 api.js 的 userContent 组装出来的数组
  // （`[{type:'text'},{type:'image_url',...}]`）。落盘只要文字，图扔掉。
  function stripImages(content) {
    if (typeof content === 'string') return { text: content, imgs: 0 };
    if (!(content instanceof Array)) return { text: '', imgs: 0 };
    var t = '', n = 0;
    for (var i = 0; i < content.length; i++) {
      var p = content[i] || {};
      if (p.type === 'text') { if (p.text) t = t ? t + '\n' + p.text : p.text; }
      else if (p.type === 'image_url') n++;
    }
    // 只有图、一个字都没有的那些轮：留一行字，别让它变成一条空消息。
    // ★ 这一行是**给模型看的**，所以要写得让它知道"这儿有过东西、只是看不见了"，
    //   不然它会以为自己漏读了什么，回头反问老师"你说的图在哪儿"。
    if (!t && n) t = '（我发了 ' + n + ' 张图，这次没有一起带过来）';
    return { text: t, imgs: n };
  }

  // 老师一条 / 模型一条。w = 当时在哪个工位（重画时插分界用）。
  //
  // ★★ `role` **两种写法都收**（'assistant'/'user' 和简写的 'a'/'u'）。
  //   这条不是"顺手兼容"，是踩过：chat.js 那边传的是 `'a'`（它满篇都写 'a'），
  //   而这个函数当时只认 `'assistant'`，于是模型那条被记成了**老师说的**。
  //   坏起来的样子最阴：消息**照样存进去了**、屏幕上也照样重画得出来，
  //   只有下一轮把模型自己的话当成老师的要求再发回去——
  //   要等它答得驴唇不对马嘴，才会有人想到是"角色安错了"，而那会儿已经查不到这儿。
  //   一句话里两套词，就得两套都认；认不下来宁可当场炸，不要静静地按错的记。
  function isAssistant(role) {
    if (role === 'assistant' || role === 'a') return true;
    if (role === 'user' || role === 'u') return false;
    throw new Error('pushTurn 收到一个不认识的 role：' + role);
  }

  function pushTurn(role, content, work) {
    var o = get();
    var s = stripImages(content);
    if (!s.text) return null;
    var t = { r: isAssistant(role) ? 'a' : 'u', t: s.text, w: work || o.work || '', i: s.imgs };
    o.turns.push(t);
    // 课题：这一场的**第一句人话**就是课题，跟 js/pack.js 的 setTopic 同一个判据。
    // 后面那些话不能拿——那会儿说的是「接着往下。」，课题会变成"接着往下"。
    if (t.r === 'u' && !o.pocket.topic) o.pocket.topic = firstLine(s.text);
    if (!o.pocket.date) o.pocket.date = today();
    if (work) o.work = work;
    save();
    paintBar();
    return t;
  }

  function firstLine(s) {
    var x = String(s || '').split(/[\r\n]+/)[0] || '';
    x = x.replace(/\s+/g, ' ').trim();
    return x.length > 24 ? x.slice(0, 24) + '…' : x;
  }

  function turns() { return get().turns; }

  // 重画气泡用。跟 pushTurn 存进去的是同一份，所以屏幕恢复出来的一定是原来那条。
  function log() { return get().turns.slice(); }

  // 喂给模型的那份。★ 图片那一轮退化成一行字（见 stripImages），
  // 所以重建出来的 history 跟"图片还在"时**不是逐字相同**——这是取舍的落点，认了。
  function history() {
    return get().turns.map(function (t) {
      return { role: t.r === 'a' ? 'assistant' : 'user', content: t.t };
    });
  }

  function hasUser() {
    return get().turns.some(function (t) { return t.r === 'u'; });
  }

  // ============================================================
  //  二、口袋 —— 「这一份」是什么
  // ============================================================
  function pocket() { return get().pocket; }

  function setPocket(patch) {
    var o = get(), p = o.pocket;
    if (!patch) return p;
    if ('topic' in patch) p.topic = String(patch.topic || '');
    if ('cls' in patch) p.cls = String(patch.cls || '');
    if ('date' in patch) p.date = String(patch.date || '');
    save();
    paintBar();
    return p;
  }

  // 这一轮做出了什么。由 chat.js 在每一轮成功之后调一次（一处记账，五个工位共用）。
  // counts: {fig, prob, paper, chain, rev}
  function produced(work, counts) {
    var cfg = SAY[work];
    if (!cfg || !counts) return;
    // ★ 数是 0 的**一个都不记**。记 0 的后果不是"多一个 0"——
    //   是 marks 里凭空多出一个键，于是口袋那一行的样式判成"有东西"，
    //   而字上写着"口袋空着"。**样式和字各说各的**，看的人只会觉得哪儿不对劲，
    //   又指不出来（判据是 Object.keys(marks).length，见 paintBar）。
    var o = get(), m = o.pocket.marks, k = cfg.k, n = counts[k] || 0;
    if (!n) return;
    // 「链」是**这一节摆到第几节**，不是累加——所以它取大的那个。
    if (work === 'prep') m.chain = Math.max(m.chain || 0, n);
    else m[k] = (m[k] || 0) + n;
    save();
    paintBar();
  }

  // 口袋那一行字。空的时候说的是"还空着"，不是空字符串——
  // 空字符串在界面上就是一条白线，老师看不出它是在等东西。
  function bagText() {
    var m = get().pocket.marks, out = [];
    for (var i = 0; i < ORDER.length; i++) {
      var w = ORDER[i], cfg = SAY[w];
      var n = m[cfg.k] || 0;
      if (n > 0) out.push(cfg.one + ' ' + n + ' ' + cfg.unit);
    }
    return out.length ? ('口袋：' + out.join(' · ')) : '口袋空着';
  }

  // ============================================================
  //  三、清 —— 只有 ⟳ 走这条
  // ============================================================
  function clear() {
    if (timer) { clearTimeout(timer); timer = 0; }
    mem = blank();
    try { localStorage.removeItem(KEY); } catch (e) {}
    paintBar();
  }

  // ============================================================
  //  四、「这一份」那一行 —— 口袋在人这边长得什么样
  // ============================================================
  //
  // ★ 为什么它跟数据在同一个文件：那行字是**这份数据的另一个朝向**，
  //   不是另一个东西。分成两个文件就得有一处"改了这个忘了那个"，
  //   而两处对不上在屏幕上看着完全正常（见 index.html 里左栏名字那一段的教训）。
  //
  // ★ 课题／班级／日期**点一下就能改**：这三个是唯一机器猜不准的东西——
  //   课题是从第一句话截的（可能截歪），班级和日期这台电脑根本不知道。
  //   做成只读的话，老师只能眼睁睁看着一个错标题跟着这一场走到底。
  var els = {};

  // ★★ 工位那一行照口袋点灯——模拟稿第⑤张说的**「每一步都给下一步留了东西」**，
  //   这是它**看得见**的那一半（看不见的那一半在 js/api.js 的「老师手上正在办的那一件事」）。
  //
  //   判据是**口袋里真有这个工位的产物**，不是"点过这个工位"。
  //   点一下不等于干过活：照点击亮，六个格子走一遍就全亮着，
  //   而字上写着"口袋空着"——**样式和字各说各的**，看的人只会觉得哪儿不对劲又指不出来
  //   （跟 produced() 那条"算出来是 0 就不记"是同一件事的两头）。
  //
  //   ⚠ 讲评那格**永远亮不了**，这是对的，不是漏了：讲评是从口袋里**取**的
  //     （点着得分率最低那几道讲），它不往里放。SAY 里没有它，所以这儿自然点不亮。
  //     别为了"六格统一"给它补一个计数——那只能靠数它说了几轮，而"说了几轮"
  //     跟"讲了几条"不是一件事，那个数会被当成事实读。
  function paintWorks() {
    var bs = document.querySelectorAll('.workbtn');
    if (!bs.length) return;
    var m = pocket().marks;
    for (var i = 0; i < bs.length; i++) {
      var cfg = SAY[bs[i].getAttribute('data-work')];
      bs[i].classList.toggle('has', !!(cfg && (m[cfg.k] || 0) > 0));
    }
  }

  function paintBar() {
    // ★ 先点灯，再看 els.box 那道闸：工位那一行跟 #onep 是两处标记，
    //   哪天 #onep 里的某一格没了（els.box 置空），也不该带着工位那一行一起不亮。
    paintWorks();
    if (!els.box) return;
    var p = pocket();
    els.topic.textContent = p.topic || '还没定';
    els.topic.classList.toggle('empty', !p.topic);
    els.cls.textContent = p.cls || '哪个班';
    els.cls.classList.toggle('empty', !p.cls);
    els.date.textContent = p.date || today();
    els.date.classList.toggle('empty', !p.date);
    els.bag.textContent = bagText();
    els.bag.classList.toggle('has', (pocket().marks && Object.keys(pocket().marks).length) > 0);
  }

  // 点一下 → 原地换成一个输入框，回车／点别处收。★ 不用 contenteditable：
  // 它在不同浏览器里读出来的东西不一样（换行、不可见字符），保存下去就是一个
  // 看着一样、比不上的值。输入框只有一个值，谁都读得一样。
  function edit(field, label) {
    var span = els[field];
    if (!span || span.getAttribute('data-editing') === '1') return;
    span.setAttribute('data-editing', '1');
    var box = document.createElement('input');
    box.type = 'text';
    box.className = 'opedit';
    box.value = pocket()[field] || '';
    box.placeholder = label;
    span.textContent = '';
    span.appendChild(box);
    box.focus();
    box.select();
    var shut = function (keep) {
      span.removeAttribute('data-editing');
      if (keep) {
        var patch = {}; patch[field] = box.value.trim();
        setPocket(patch);
      }
      span.textContent = '';
      paintBar();
      if (SR.chat && SR.chat.focusInput) SR.chat.focusInput();
    };
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); shut(true); }
      else if (e.key === 'Escape') { e.preventDefault(); shut(false); }
      e.stopPropagation();   // 别让回车漏到输入框那边去，不然一边改名一边发了一条空话
    });
    box.addEventListener('blur', function () { shut(true); });
  }

  function mountBar() {
    els.box = document.getElementById('onep');
    if (!els.box) return;
    els.topic = document.getElementById('op-topic');
    els.cls = document.getElementById('op-cls');
    els.date = document.getElementById('op-date');
    els.bag = document.getElementById('op-bag');
    if (!els.topic || !els.cls || !els.date || !els.bag) { els.box = null; return; }
    els.topic.addEventListener('click', function () { edit('topic', '这节课讲什么'); });
    els.cls.addEventListener('click', function () { edit('cls', '哪个班'); });
    els.date.addEventListener('click', function () { edit('date', '哪一天'); });
    paintBar();
  }

  function init() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { if (timer) { clearTimeout(timer); timer = 0; } writeNow(); }
    });
    // 关标签页那一瞬间给一次机会。★ 不能只靠 visibilitychange：
    //   桌面上直接关窗口，有的浏览器不派那一下。
    window.addEventListener('pagehide', function () { if (timer) { clearTimeout(timer); timer = 0; } writeNow(); });
    mountBar();
  }

  return {
    init: init, paintBar: paintBar, paintWorks: paintWorks,
    log: log, turns: turns, history: history, hasUser: hasUser, pushTurn: pushTurn,
    pocket: pocket, setPocket: setPocket, produced: produced, bagText: bagText,
    clear: clear,
    // 立刻落盘（探针和"关页面前"用；平时走 400ms 节流）
    flush: function () { if (timer) { clearTimeout(timer); timer = 0; } return writeNow(); },
    // 探针用：这一场一共几轮、存进去了没有
    __size: function () { try { return (localStorage.getItem(KEY) || '').length; } catch (e) { return -1; } },
    __lastErr: function () { return lastErr; }
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.memo;
