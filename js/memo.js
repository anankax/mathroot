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
  // 摆出来的顺序 = 工位那一行的顺序。
  // ★★ 2026-10-04：原来这儿是一张**写死的、独立的**表 `['material','draw','prep','vary']`，
  //   上面那句注释却写着"跟 config.js 的 SR.WORK_ORDER 一致，不另立一套"——**注释是假话**：
  //   它就是另立了一套，而且是**旧的那一套**（组卷打头）。
  //   症状：一屏里两套序——工位按钮是 备课 作图 命题 组卷，口袋那行读出来是
  //   「口袋：卷子 1 份 · 图 2 张 · 链 5 节 · 题 3 道」。**两边都"看着正常"**，
  //   只有把两串并排读才看得见（判据见 test/_chk14c.cjs）。
  //   现在直接读 SR.WORK_ORDER。config.js（index.html:180）在 memo.js（:250）之前装，拿得到。
  // ★ 筛掉没有 SAY 的工位（grade／review 不往口袋里放东西，SAY 里本来就没它们）。
  //   ⚠ 筛空了退回 SAY 自己的顺序：宁可排得不对，也不要空白一行
  //   （同 js/main.js 的 paintWorks 那条规矩）。
  var ORDER = (SR.WORK_ORDER || []).filter(function (w) { return !!SAY[w]; });
  if (!ORDER.length) ORDER = Object.keys(SAY);

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

  // ---- 口袋里的**题号**（不是"几道"，是"哪几道"）----
  //
  // ★ 学情那一格的全部前提就是这一份清单。模拟稿第⑤张把这句话说得很准：
  //   **「口袋里有题号，成绩才排得出名次」**——成绩表上那 40 行是全卷的，
  //   只有落在这份清单里的那几行才是"他自己出的题"，才轮到排先后。
  //   它跟 bagText 的「题 6 道」**不是一回事**：那个是数，这个是哪几道。
  //
  // ★★ 只认**产品自己的格式契约**，不认"看着像题号"的样子货
  //   （[[scanner-numbers-are-not-what-they-claim]] 那一类：量出来的数会被当成事实读）。
  //   这儿只从 ```材料 围栏里取——那是组卷工位吐的，一行一段、行首是 `#号`，
  //   题号写在这一段的开头（`#1 12．…`）。围栏外面、别的工位的话里
  //   哪怕排着一串"1．2．3．"，也**一个字都不认**：那是正文，不是卷子。
  //   ⚠ 认不出来的时候就返回空数组，让学情那一格照提示词里的规矩一说
  //     「口袋里还没有题」——宁可让它说没有，也不要塞一个错题号进去，
  //     那个数老师会拿去讲课。
  //
  // ⚠ 命题（变式一（改条件）…）**不算**：变式没有题号，那是小标题不是题号。
  //   一份卷子的题号只从组卷那一份材料来——真实流程也是这样（出了题才排卷、才有题号）。
  var RE_MAT = /```[ \t]*材料[ \t]*[^\r\n]*\r?\n([\s\S]*?)```/g;
  var RE_NUM = /^[ \t]*#\d+[ \t]+(\d{1,3})[ \t]*[．.、]/gm;

  // 这一轮回复里出了几道题。
  //
  // ★★ 2026-10-03 修：改之前 chat.js 里写的是 `res.text.match(/(^|\n)\s*#\d+/g)`，
  //   数的是**组卷**那份 ```材料 围栏的行号。可**命题**吐的是一行中文小标题
  //   「变式一（改条件）」——一个 `#N` 都没有。于是命题那一格的口袋点**永远是 0**，
  //   从来没亮过；而"没亮"跟"本来就没题"在屏幕上长得一模一样，没人会去查
  //   （[[scanner-numbers-are-not-what-they-claim]]，"长期假红"那类：坏掉的样子
  //   跟正常的样子分不开）。而学情那一格的前提正架在这条线上。
  //
  // ★ 只认这两种**产品自己的格式契约**，不拿"看着像题号"的东西凑数：
  //   ① 组卷：```材料 围栏里一行一段、行首是 `#号`，题号写在这一段的开头（`#1 12．…`）。
  //      ⚠ 数的是**题号行**，不是 `#1` 行——一道选择题的题面（`1．…`）和选项（`A．…`）
  //        各占一行、都可能是 `#1`，按 `#1` 数会把一道题数成两道。
  //      ⚠ 也不能按"号等于几"数：`#号` 是**老师那份模板里的格式号**，
  //        换一份模板号就全变了（见 js/prompt-material.js 那张表）。
  //   ② 命题：一行小标题「变式一（改条件）」，中文数字，一道变式一道题。
  //   ⚠ 围栏**外面**的正文哪怕排着一串"1．2．3．"也不认：那是正文，不是卷子。
  function countProbs(text) {
    var t = String(text == null ? '' : text);
    var n = 0, m;
    RE_MAT.lastIndex = 0;
    while ((m = RE_MAT.exec(t))) {
      var body = m[1];
      RE_NUM.lastIndex = 0;
      while (RE_NUM.exec(body)) n++;
    }
    // 首部的 * / # / > / 空格都放行：模型爱把这一行加粗（`**变式一**`），
    // 加粗了就不算的话，数出来又是一片 0。
    var vs = t.match(/(^|\n)[ \t>*#]*变式[一二三四五六七八九十]+/g);
    return n + (vs ? vs.length : 0);
  }

  // ★ 跟 countProbs 共用同一对正则：这两件事认的是**同一个格式契约**，
  //   哪天材料围栏的写法变了，只有一处要改。分成两份就一定会有一份忘了改，
  //   而忘了改的那一份只是数不准——屏幕上照旧什么都看不出来。
  function probs() {
    var ts = get().turns, out = [], seen = {};
    for (var i = 0; i < ts.length; i++) {
      if (ts[i].r !== 'a') continue;
      var t = String(ts[i].t || ''), m;
      RE_MAT.lastIndex = 0;
      while ((m = RE_MAT.exec(t))) {
        var body = m[1], n;
        RE_NUM.lastIndex = 0;
        while ((n = RE_NUM.exec(body))) {
          var num = n[1];
          if (!seen[num]) { seen[num] = 1; out.push(num); }
        }
      }
    }
    return out;
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
  //  三·五、截断 —— 「重新发送」和「修改文字」共用的那一刀
  // ============================================================
  //
  // 从第 n 条起（含第 n 条）全丢掉，返回"真丢了没有"。
  // 这就是 DeepSeek 那两个按钮的语义：**从这条重来，后面的清掉**。
  //
  // ★★ 它不只是 `turns.slice(0, n)` 一句话，因为这份存档里有**两样东西是从
  //   这些轮次里攒出来的**，不是独立的事实：
  //     ① 课题（`pocket.topic`）—— 它是**第一句人话**截出来的；
  //     ② 口袋（`pocket.marks`）—— 图几张、题几道、卷子几份、链摆到第几节，
  //        全是 `produced()` 一轮一轮**加上去**的。
  //   删了三轮不重算，那个数就是假的；而这两样**老师都会当成事实读**
  //   （[[scanner-numbers-are-not-what-they-claim]]）。所以一律照**剩下的轮次
  //   从头重算**，不做减法——减法要相信"当时记进去的正好就是这些"，
  //   可当时那一路还掺着别的（`chain` 取的是 max、只有成功那一支才记）。
  //
  // ★ 重算用的是跟当场那条路**同一批函数**（`SR.render.parseFences` /
  //   `countProbs` / `SR.absorbChain`）。两处各数一遍的话，截断之后的读数会跟
  //   当场攒出来的不一样，而"对不上"在屏幕上完全看不出来。
  //   ⚠ 有一处**本来就对不齐，写在这儿认了**：当场那条路里 `paper` 优先认
  //     `msg.matFed`（模板真套上了才算一份），那个状态没落盘，这儿只能按围栏数。
  //     差只差在"模板没套上"那几轮上。
  //   ✅ 还有一处**曾经对不齐，2026-10-06 夜已经对齐了**（别再照旧话改回去）：当场是 `produced(work, …)` 拿**收流那一刻的
  //     工位**记的，而轮次本身记的是**出发那一刻的工位**（`wk`，见 chat.js
  //     「这一轮算哪个工位，在这儿定下来之后不许再变」）。重算一律跟**轮次**走，
  //     两者只在"那一轮中间老师又点了工位"时分岔 —— **现在不分岔了**：chat.js 那三处
  //     一起改成 `wk` 之后，当场攒的和这儿重算的跟的是同一个值。
  //     ⚠ 这两处**必须一直对齐**：分岔的样子是"截断一次，口袋里的数就换一个"，
  //       而屏幕上完全看不出来。守着这件事的尺子是 `test/probe_workpin.cjs`。
  //     ★ 顺带记一件当晚量到的事实：工位那一行**现在有 busy 闸了**（js/main.js:885），
  //       所以"飞行途中点走工位"今天从按钮上**走不到** —— 上面那处对齐属于纵深防御，
  //       不是一条天天在走的活路（`test/probe_workpin.cjs` 的②格量的就是这道闸）。
  //       哪天那道理障挪开，这条链子就又通了，而这两处必须仍然对齐。
  function 重算口袋(ts) {
    var marks = {}, slots = [], plan = 0, now = 0;
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i];
      if (t.r !== 'a') continue;
      var w = t.w, cfg = SAY[w], wp = null;
      try {
        wp = (SR.render && SR.render.parseFences)
          ? SR.render.parseFences(String(t.t || ''), {
              stripAssign: !!((SR.WORKS && SR.WORKS[w] || {}).stripAssign), 收尾: true
            })
          : null;
      } catch (e) { wp = null; }
      if (cfg) {
        // ★ 三个分支跟 produced() 的记法**逐条对齐**：算出 0 的一项**一个都不记**。
        //   记 0 的后果不是"多一个 0"，是 marks 里凭空多出一个键，
        //   于是口袋那一行的样式判成"有东西"、字上却写着"口袋空着"（见 produced）。
        if (w === 'draw' && wp) {
          var nf = (wp.ggb || []).length;
          if (nf) marks.fig = (marks.fig || 0) + nf;
        } else if (w === 'vary') {
          var np = countProbs(t.t);
          if (np) marks.prob = (marks.prob || 0) + np;
        } else if (w === 'material' && wp) {
          var nm = (wp.mat || []).length;
          if (nm) marks.paper = (marks.paper || 0) + nm;
        }
      }
      // 链：跟 chat.js 的 repaintSteps 走**同一条** —— 整段回复过一遍 absorbChain。
      if (SR.absorbChain) {
        var st = SR.absorbChain({ slots: slots, plan: plan, now: now }, String(t.t || ''));
        slots = st.slots; plan = st.plan; now = st.now;
      }
    }
    // 「链」是**这一节摆到第几节**，不是累加（跟 produced 里那条同一个规矩）。
    if (SAY.prep && slots.length) marks.chain = Math.max(marks.chain || 0, slots.length);
    return marks;
  }

  // ★ 2026-10-07：「查」那一段**接在同一条回复后面**（见 js/chat.js 的 试查库）。
  //   为什么要往账本里写第二笔：`pushTurn` 是在**模型第一段话说完**那一刻记的，
  //   那时候查库还没发生、第二段还没来。不补这一笔的话，老师一刷新，
  //   气泡按账本重画出来就**只剩前半截**——"我手头没这个数据，我去翻翻"之后什么都没有，
  //   而他记得自己明明看见过下文。**记的和看见的不一样，是最难查的那类坏。**
  //   ⚠ 判据卡在"这条还在不在、还是不是模型说的那一条"上：这一笔是几百毫秒到几秒
  //     之后才落下来的（等云函数），中间老师完全可能已经发了下一句。
  //     所以调用方必须**先核对再补**（拿 `turns()[n]` 比一比），这一层也再挡一道。
  function 续说(n, more) {
    var o = get();
    var t = o.turns[n];
    if (!t || t.r !== 'a') return false;        // 账本翻页了 / 那一条不是模型的 → 一个字都不动
    var s = stripImages(more);
    if (!s.text) return false;
    t.t = t.t ? t.t + '\n\n' + s.text : s.text;
    save();
    return true;
  }

  function 截到(n) {
    var o = get();
    if (typeof n !== 'number' || isNaN(n)) return false;
    if (n >= o.turns.length) return false;      // 没有要丢的
    if (n < 0) n = 0;
    // 原来的"第一句人话"在第几条。★ 判据必须是 `原第一句 >= n`（= 它被删掉了），
    //   **不能写成"切掉的那一截里有没有 user"**：`n = 0` 时那一截是空的，
    //   那个写法会漏掉"整场清空"这一档，课题就留着一句已经不在对话里的话。
    var 原第一句 = -1;
    for (var i = 0; i < o.turns.length; i++) {
      if (o.turns[i].r === 'u') { 原第一句 = i; break; }
    }
    o.turns = o.turns.slice(0, n);
    if (原第一句 >= 0 && 原第一句 >= n) {
      // ★ 只在**被删掉的那几轮里含第一句人话**时才重推课题。
      //   不含就一个字都别动——老师是可以手改课题的（`setPocket`），
      //   每截一次都拿"第一句人话"去盖，等于把他改的那个字抹了。
      var first = '';
      for (var j = 0; j < o.turns.length; j++) {
        if (o.turns[j].r === 'u') { first = firstLine(o.turns[j].t); break; }
      }
      o.pocket.topic = first;
    }
    o.pocket.marks = 重算口袋(o.turns);
    save();
    paintBar();
    return true;
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
  //   ⚠ **讲评和学情这两格永远亮不了**，这是对的，不是漏了：它俩都是从口袋里**取**的
  //     （讲评点着得分率最低那几道讲，学情把得分率排给他看），**不往里放**。
  //     SAY 里没有这两件，所以这儿自然点不亮。
  //     别为了"六格统一"给它俩补一个计数——那只能靠数它说了几轮／报了几行，
  //     而"说了几轮"跟"办了几件事"不是一件事，那个数会被当成事实读。
  //     （学情报的"40 道题"更是**那张表里的数**，跟口袋一点关系都没有。）
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
    // ★★ 2026-10-05：`op-topic`／`op-cls` 两格已从 index.html 删掉（孔老师：
    //   「还有这边什么哪一个班，给我去掉，标题也是不用写出来。」）。
    //   所以这儿**不许再无条件读 `els.topic.textContent`**——那两个元素现在是 null，
    //   一读就抛，整条绿行（连同下面的口袋计数、「打包」两颗按钮）当场不刷新。
    //   `pocket().topic`／`.cls` 这两个**字段仍然留着**：老账本里存过，读回来不该丢，
    //   只是屏幕上不再摆出来。
    if (els.topic) {
      els.topic.textContent = p.topic || '还没定';
      els.topic.classList.toggle('empty', !p.topic);
    }
    if (els.cls) {
      els.cls.textContent = p.cls || '哪个班';
      els.cls.classList.toggle('empty', !p.cls);
    }
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
    els.topic = document.getElementById('op-topic');   // 已删，留着是 null
    els.cls = document.getElementById('op-cls');       // 已删，留着是 null
    els.date = document.getElementById('op-date');
    els.bag = document.getElementById('op-bag');
    // ★★ 这道闸原来写的是「四个 id 缺一个就把 els.box 置空」——那是**删 HTML 时的地雷**：
    //   照那个写法删掉 op-topic／op-cls 两格，整条绿行会**一声不响地全废**
    //   （口袋计数、「选择内容」、「打包」全挂），而屏幕上看着只是"少了两格字"。
    //   现在只把**真正还在用的那两格**算进这道闸。
    if (!els.date || !els.bag) { els.box = null; return; }
    if (els.topic) els.topic.addEventListener('click', function () { edit('topic', '这节课讲什么'); });
    if (els.cls) els.cls.addEventListener('click', function () { edit('cls', '哪个班'); });
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
    probs: probs, countProbs: countProbs,
    // ★ 2026-10-06：「重新发送」和「修改文字」共用的那一刀（见上面 三·五）。
    //   返回"真丢了没有"——`n` 落在账本外面（>= 长度）时返回 false，
    //   调用方据此知道"这一条压根不在账本里"（失败那一轮就是这样）。
    截到: 截到, 续说: 续说, __重算口袋: 重算口袋,
    clear: clear,
    // 立刻落盘（探针和"关页面前"用；平时走 400ms 节流）
    flush: function () { if (timer) { clearTimeout(timer); timer = 0; } return writeNow(); },
    // 探针用：这一场一共几轮、存进去了没有
    __size: function () { try { return (localStorage.getItem(KEY) || '').length; } catch (e) { return -1; } },
    __lastErr: function () { return lastErr; }
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.memo;
