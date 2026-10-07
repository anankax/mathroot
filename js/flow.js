// 流水线：把"备一次课"从"一轮一句话"变成一条**看得见的流水线**。
//
// 孔老师 2026-10-02 的原话是"我需要你把扣子工作流的那样做出来，而且不要只是本机，
// 应该是在我云知识库调取苏科版这些东西才对吧"。所以这个文件要同时干两件事：
//
//   一、**每一步看得见**：一道题走一遍是"凑检索的话 → 翻教材索引 → 翻你写的追问条目
//       → 拼提示词 → 模型回话 → 摆到屏幕上"，每一步一行，写出它用了什么、耗时多少。
//   二、**每一步能单独重跑**：翻教材那一步翻歪了，只重跑它——**前面几步一个字不动**，
//       它下游那几步标成"得重来"。这正是扣子给不了的东西（它改一次画布要发布一次）。
//
// ★★ 这一步为什么以前做不到：原来检索是**藏在 buildSystem 里面**的两行同步调用
//   （js/api.js 的 pickTextbook / pickZhuwen），跑完了界面上什么都不说，
//   你也改不了中间那一步。现在把它**提到外面来**，跑成有名字、有输入、有产物的步骤对象。
//
// ★ 分界线（跟 js/gate.js 顶上那段是同一条）：**"这一步怎么说"留在浏览器**
//   （提示词、检索、账本），**"这一步该长什么样"在云上**（形状校验、重试、记次数）。
//   所以这个文件里没有一句话是要发给模型的——它只记账和调度。
//
// ★ 云上那两步（textbook / zhuawen）走 js/gate.js；**云上不答就退回本机**，
//   而公开站上本机也没有课本原文（js/textbook.js 是 localOnly，见 js/kb.js 顶上），
//   于是那一档就老老实实记成"没翻到"——这一步一个字都不加进提示词，
//   跟加知识库之前的行为一模一样。**不许因为检索不到就挡住对话。**
var SR = (window.SR = window.SR || {});

SR.flow = (function () {

  // ============================================================
  //  一、这条流水线上有哪几步 —— 纯函数，node 里能跑
  // ============================================================
  //
  // 两步一个字段，别混：
  //   route —— **在哪儿跑的**（云上 / 本机 / 模型）。这一个会随实际情况变：
  //            云上没答上来就得退回本机，那时这一格必须改口，不能还写着"云上"。
  //   src   —— **用的是谁的东西**（苏科版 / 你写的 / 工位提示词 / 模型 / 屏幕）。
  //            它由构造决定，什么时候都不变。
  // 孔老师要的"每步标出处（云 / 本机 / 你写的条目）"，正好是这两个字段合起来说的话。
  //
  // ⚠ **`what` 和下面的 `kbNote` 里不许写 `**`**：这两处一个走 nm.title（鼠标停一下的
  //   提示）、一个走 el() 的 textContent（见本文件 480 行那段注释：一律 textContent，
  //   绝不 innerHTML）。两个落点都是**纯文本**，星号会原样露在老师眼前。
  //   2026-10-03 走真路在页面上撞见的就是这个（模板库那句"下面这张卡是**它认出来的
  //   东西**"，见 js/material.js 的 say()）。要强调只能另想办法。
  //   ★ 提示词里那些 `**` 不算——那些是喂给模型的 markdown，跟这里两回事。
  var STEPS = {
    recall: {
      name: '凑一句检索的话', route: '本机', src: '这一轮和前几轮学生说的话',
      what: '把这一轮的话、和前几轮学生自己说过的话接起来（模型的回复不算——' +
            '拿一堆老师的话去检索"学生卡在哪儿"，召回来的会是模型自己提过的知识点）。' +
            '学生说「这题我不会」时话里一个知识点的字都没有，全靠这一句才召得回。'
    },
    textbook: {
      name: '翻教材索引', route: '云上', src: '苏科版教材', rerun: true, k: 2,
      what: '苏科版四册的章节脉络，一次翻两条，过不了分数线的就当没翻到。' +
            '翻到的原文附在提示词后面（见 js/api.js 里「# 附：这一轮给你翻出来的教材索引」）。'
    },
    zhuawen: {
      name: '翻你写的追问条目', route: '云上', src: '你写的', rerun: true, k: 1,
      what: '孔老师自己写的 118 条问法，一次只给一条——给多条模型就会挑一条最像的照搬，' +
            '回复立刻千篇一律。'
    },
    // ★★ 2026-10-02 加：**资源库检索**。
    //   跟前两步的差别就一句话：前两步给的是"脉络"和"问法"，这一步给的是**内容本身**——
    //   他自己那 7706 块材料（学案／教案／学科网素材／中考试卷）里最对得上的几块原文。
    //   这是他要的那件事："把我数学资源都资源库里面，然后我的网站智能体再去后端调取"。
    //   ★ 语料在**云上**（PG 的 res_chunks），不随公开站发布——所以 src 写"你的资料库"，
    //     不是"苏科版教材"：这一个是**他自己的东西**，那一个是课本。
    reslib: {
      name: '翻你的资料库', route: '云上', src: '你的资料库', rerun: true, k: 3,
      what: '孔老师自己那 7706 块材料（学案／教案／学科网素材／中考试卷）里最对得上的几块。' +
            '前两步翻的是"这节课在哪一章""这一类题该怎么问"，' +
            '这一步翻的是内容本身——他手上真有的那份讲义是怎么写这一段的。'
    },
    prompt: {
      name: '拼提示词', route: '本机', src: '这个工位的提示词',
      what: '工位提示词 + 上面翻到的两段附注 + 最后那三行格式（收尾块必须压在末尾，' +
            '小模型只认最后读到的东西）。'
    },
    reply: {
      name: '模型回话', route: '模型', src: '模型',
      what: '这一步过一次额度。'
    },
    paint: {
      name: '摆到屏幕上', route: '本机', src: '屏幕',
      what: '认链子、认围栏，把图、台阶、产物摆出来。'
    }
  };

  // 走一遍的顺序。★ 为什么画图／出题那两个工位短一截：它们的 SR.WORKS[x].retrieve
  //   是假的（见 js/api.js 那段注释），翻教材那两步对它们没有意义——
  //   流水线必须照**真跑的**画，不能照"好看的"画一条出来。
  var ORDER_FULL = ['recall', 'textbook', 'zhuawen', 'reslib', 'prompt', 'reply', 'paint'];
  var ORDER_LITE = ['recall', 'prompt', 'reply', 'paint'];

  function plan(work) {
    var w = (SR.WORKS || {})[work] || {};
    return (w.retrieve ? ORDER_FULL : ORDER_LITE).slice();
  }

  // ---- 契约表的前端那一半 ----
  // 云函数 gate 里那两张形状表的 key 就是这几个名字；test/check_gate_contract.cjs
  // 把两边拉出来逐项对。★ 这两份**分在两个仓库位置**（一份在云函数的代码包里、
  // 我的探针够不着），所以"两份会漂"是这件事唯一的风险，而那张对表就是唯一的哨兵。
  //   ★ 到现在为止**模型那几步还没走 gate**（js/api.js 仍旧直连模型），
  //     所以 MODEL 这一组暂时只是名字，没有形状；等接上了再补。
  var KB_STEPS = ['textbook', 'zhuawen'];
  var MODEL_STEPS = ['topic', 'routes', 'step', 'wrap'];
  // 云存储库那两步（2026-10-07 加）。它们**不进流水线**——不是每轮都跑的一步，
  //   是"老师点了资料库那颗按钮"或"模型写了 ```查"时才发的一发。
  //   放在这儿只是为了有个**可核对的名单**：test/check_gate_contract.cjs 拿它跟
  //   云函数那边的分派逐项对，防"加了一步只改了云上"或"只改了浏览器"。
  var LIB_STEPS = ['liblist', 'libsign'];

  // ---- 分数线：跟 js/api.js 的 cutOf 同一个源头（js/kb.js）----
  function cutOf(which) {
    try { return (SR.kb && SR.kb.cut) ? SR.kb.cut(which) : 0; } catch (e) { return 0; }
  }

  // ---- 两条纯函数：把翻到的拼成要附进提示词的那一段 ----
  // ★ 这两条必须跟 js/api.js 里原来的 pickTextbook / pickZhuwen **算得一模一样**：
  //   分数线在这两条里起作用（低于线就不给），而"给不给"正是最容易改歪的地方。
  //   所以 api.js 那两条留着不动（本机那条路和探针还在用它们），
  //   这里这份是**云上那条路**用的——两边的判分逻辑逐句相同，只是数据来处不同。
  function pickTextbook(hits, cut) {
    var out = [];
    for (var i = 0; i < (hits || []).length; i++) {
      if (!hits[i] || hits[i].score < cut) continue;
      out.push(String(hits[i].text || '').trim());
    }
    return out.join('\n\n');
  }
  function pickZhuawen(hits, cut) {
    if (!hits || !hits.length || !hits[0] || hits[0].score < cut) return '';
    return String(hits[0].text || '').trim();
  }
  function keptOf(hits, cut) {
    var n = 0;
    for (var i = 0; i < (hits || []).length; i++) if (hits[i] && hits[i].score >= cut) n++;
    return n;
  }

  // ============================================================
  //  二、账本 —— 一步一个对象，按回合累积
  // ============================================================
  // 为什么是"按回合"而不是"一条线跑到底"：备课／讲评一轮只摆一节（见
  // js/prompt-prep.js 的"一轮只摆一节"），所以它天然是一串回合，
  // 每个回合自己走一遍上面那七步（凑话／翻教材／翻条目／翻资料库／拼提示词／模型／摆上台）。
  // 账本画出来就是一条竖着的流水线。
  // ★ 步数**别在这儿写死**：写死过一个"六步"，加了 reslib 之后这里就成了唯一一处
  //   还在说六步的地方。真要数，数 ORDER_FULL——注释也一个道理。
  var MAX = 30;          // 只留最近这些轮。这是**看得见**用的，不是存档，不必留一辈子
  var rounds = [];
  var seq = 0;

  function reset() { rounds = []; seq = 0; render(); }
  function list() { return rounds; }

  function at(r, id) {
    if (!r || !r.steps) return null;
    for (var i = 0; i < r.steps.length; i++) if (r.steps[i].id === id) return r.steps[i];
    return null;
  }

  // 开一个回合。★ 只存**这一轮学生说的话**，不存历史、不存图片：
  //   历史只有"重跑凑话那一步"用得上，而那一步的输入是定死的（重跑它没有意义，
  //   所以它 rerun 为假）；图片对检索没用，留着只是白占内存。
  function start(work, text) {
    var r = { n: ++seq, work: work, text: String(text == null ? '' : text),
              query: '', steps: [], at: Date.now(), stale: false };
    var ids = plan(work);
    for (var i = 0; i < ids.length; i++) {
      var s = STEPS[ids[i]];
      r.steps.push({
        id: ids[i], name: s.name, what: s.what,
        route: s.route, src: s.src, rerun: !!s.rerun,
        state: 'wait', out: '', note: '', ms: 0, origins: []
      });
    }
    rounds.push(r);
    while (rounds.length > MAX) rounds.shift();
    render();
    return r;
  }

  // ---- 改一步的状态。★ 每一步都经过这两个口子，是为了让**渲染**只有一个入口，
  //   不然某处忘了 render 就会看到一条不更新的流水线，而这种坏最难查。 ----
  function set(r, id, patch) {
    var s = at(r, id); if (!s) return null;
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k];
    render();
    return s;
  }
  function done(r, id, o) {
    o = o || {};
    return set(r, id, { state: 'done', out: o.out != null ? o.out : '',
                        note: o.note || '', ms: o.ms || 0 });
  }
  // ★ skip / fail 都要把 origins 一起清掉：不清的话，"跑过一轮拿到了三块"之后
  //   再重跑、这次云上没答上来，那一行会一边写着「跳过了」、一边底下还挂着
  //   上一轮那三块的完整出处——看着像"这次也翻到了"。
  function skip(r, id, why) { return set(r, id, { state: 'skip', out: '', note: why || '', origins: [] }); }
  function fail(r, id, why) { return set(r, id, { state: 'fail', out: '', note: why || '', origins: [] }); }

  // 把**这一步之后**的每一步标成"得重来"。前面的一步都不动。
  // ★★ 这就是"重跑只动它和它下游"这句话的全部实现——写成别的样子（比如整条重跑）
  //   就等于把扣子的画布重新发明一遍，那正是要避开的。
  function staleAfter(r, id) {
    var on = false, n = 0;
    for (var i = 0; i < r.steps.length; i++) {
      var s = r.steps[i];
      if (s.id === id) { on = true; continue; }
      if (!on) continue;
      // ★★ 只把"还没走到"和"正在跑"的恢复成 wait；**跑过的一律落成 stale**。
      //   写成"不是终态就 wait"（＝原来的写法）有一个看不出来的坏：连着重跑两次时，
      //   第一次已标成 stale 的那几格，第二次会被降成 wait——面板上它们就写着
      //   「还没走到」，而底下那句提示还在说"得重问一次才作数"，两句话对着干；
      //   更实的一层是「重跑」按钮**只在终态出现**，降成 wait 后按钮消失，
      //   那一步就再也点不动了。所以这里反过来写：不是终态的才等，跑过的都作废。
      if (s.state === 'wait' || s.state === 'run') { s.state = 'wait'; continue; }
      s.state = 'stale'; n++;
    }
    r.stale = n > 0;
    render();
    return n;
  }

  // 最近开的那一个回合。★ 之所以能这么取：同一时刻只有一个回合在跑
  //   （js/chat.js 的 busy 把发送串行化了），所以"最近开的那个"就是"正在跑的那个"。
  function cur() { return rounds.length ? rounds[rounds.length - 1] : null; }

  // 「摆到屏幕上」这一步由 js/chat.js 收尾——api.js 不知道气泡什么时候画完
  //   （认链子、摆围栏、画配图、挂"复制这段"全都发生在那儿）。
  // ★ 让 api.js 去标它就会写成"模型说完的时刻"，那跟这一步真正在干的事对不上——
  //   量具报的数字不是它宣称的那件事，别再添一个。
  function paintDone(note, ms) {
    var r = cur(); if (!r) return;
    var s = at(r, 'paint'); if (!s || s.state === 'done') return;
    set(r, 'paint', { state: 'done', out: '', note: note || '', ms: ms || 0 });
  }

  // 一个回合走到哪儿了（给面板右上角那行小字用的）
  function progress(r) {
    var n = 0, mark = '';
    for (var i = 0; i < r.steps.length; i++) {
      var s = r.steps[i];
      if (s.state === 'done') n++;
      else if (!mark && s.state !== 'wait') mark = s.state;
    }
    return { done: n, total: r.steps.length, mark: mark };
  }

  // ============================================================
  //  三、检索那两步：云上优先、本机兜底
  // ============================================================
  // ★★ 顺序是**不能反**的：云上优先。理由不是"云上更快"（它一定更慢），
  //   而是课本原文**不该下到浏览器**——本地那份在公开站上根本不存在（localOnly），
  //   云上那份待在函数代码包里。云上答不上来时退回本机，是给孔老师本机那台用的。
  function cloudOn() { return !!(SR.gate && SR.gate.on && SR.gate.on()); }

  function cloudKb(step, query, k) {
    if (!cloudOn()) return Promise.resolve(null);
    return SR.gate.kb(step, query, k);
  }

  // ---- 资源库那一步：**只有云上这一条路，没有本机兜底** ----
  // ★ 为什么别的两步有本机兜底、这一步没有：兜底要成立，得本机**也有**这份语料。
  //   教材索引和追问库本机确实有（js/textbook.js 那份 localOnly 的），
  //   可这 7706 块材料在公开站上**根本不该存在**（他定的：语料不进仓库、不上站）；
  //   本机虽然也留着原始素材，但那是散在各处的 docx，没有现成的、已经切好块的副本。
  //   ⇒ 所以这一步拿不到就是拿不到，老老实实记"没翻到"，**一个字都不加进提示词**。
  //   这跟教材那一步"公开站上没有课本原文"是同一个道理、同一种收场。
  function cloudRes(query, k) {
    if (!cloudOn()) return Promise.resolve(null);
    return SR.gate.reslib(query, k);
  }

  // 本机翻一次。★ 拿不到就回 null，跟"翻到了 0 条"是两件不同的事：
  //   前者说明这台机器上没有这份语料（公开站上就是这样），后者是语料在、只是没对上。
  function localKb(step, query, k) {
    try {
      var f = step === 'textbook' ? SR.findTextbook : SR.findZhuawen;
      if (typeof f !== 'function') return null;
      var h = f(query, k);
      return (h || []).map(function (x) {
        return { title: x.doc.title, score: x.score, text: x.doc.text };
      });
    } catch (e) { return null; }
  }

  // 跑**一步**检索。返回 {hits, route, src, why, ms}；hits 为 null = 这台机器上没有这份语料。
  async function oneKb(step, query, k) {
    var t0 = Date.now();
    var r = await cloudKb(step, query, k);
    if (r && r.ok && r.hits) {
      return { hits: r.hits, route: '云上', why: '', ms: (typeof r.ms === 'number' ? r.ms : Date.now() - t0) };
    }
    var miss = r && r.why ? ('云上没答上来（' + r.why + '）') : (cloudOn() ? '云上没答上来' : '这台机器上没配云函数');
    var hits = localKb(step, query, k);
    if (hits === null) return { hits: null, route: '本机', why: miss + '，本机也没有这份语料', ms: Date.now() - t0 };
    return { hits: hits, route: '本机', why: miss + '，退回本机那份语料', ms: Date.now() - t0 };
  }

  // 一步的文案：翻到了哪几条 / 为什么一条都没给
  function kbNote(hits, cut) {
    if (!hits) return '这台机器上没有这份语料，这一步整个跳过';
    if (!hits.length) return '一条候选都没有';
    var kept = keptOf(hits, cut);
    var names = hits.filter(function (h) { return h && h.score >= cut; })
                    .map(function (h) { return h.title + '（' + h.score.toFixed(2) + '）'; });
    if (!kept) {
      // ⚠ 这行也别写 `**` —— 这个串走 el() 的 textContent，星号会露出来（见 STEPS 顶上那条）
      return hits.length + ' 条候选，一条都没过分数线 ' + cut + '——' +
             '最高那条是「' + hits[0].title + '」' + hits[0].score.toFixed(2) +
             '，提示词里这一整段就不会出现';
    }
    return '翻到 ' + kept + ' 条过线的：' + names.join('；');
  }

  // ---- 资源库那一步：怎么把翻到的原文拼成附注 ----
  // ★★ `RESLIB_CHARS` 这个数**是拍的，不是量的**，这点得说明白。
  //   别的数（分数线 6 / 10）都是拿真语料量出来的；这一个没有。
  //   为什么先拍一个：这一段是**正文**，不像教材索引那两条是标题脉络，
  //   一条几千字很正常。而备课／讲评走的是 128K 那一颗（glm-4-flash-250414），
  //   预算宽裕；窄的是兜底那颗 16K 的 glm-4v-flash，精简版提示词已经 5545 字。
  //   ⇒ 先按"三条、每条最多 900 字、一共 2400 字"封顶，够用且不会把兜底那颗挤爆。
  //   ⚠ 这是**待量**的数：管线跑通之后要拿真对话量一次"给多少字开始跑偏"，
  //     量出来再改这里。别因为它现在是绿的就当它验过了。
  var RESLIB_CHARS = 2400;
  var RESLIB_ONE = 900;

  // 一条正文截到 RESLIB_ONE 字，并**明说后面还有**。
  // ★ 那个省略号不是装饰：直接切掉、不告诉它，模型会以为那份讲义到这儿就完了，
  //   然后照着半句话往下推——它不知道自己在读残篇。
  function cutOne(t) {
    t = String(t || '').trim();
    if (t.length <= RESLIB_ONE) return t;
    return t.slice(0, RESLIB_ONE) + '\n（……这块后面还有，以上只截了前 ' + RESLIB_ONE + ' 字。）';
  }

  // ---- 那几块材料的**短名** ----
  // ★★ 为什么不把整条路径摆出来（2026-10-02 跑通管线后当场量的）：
  //   库里的题名是**整个文件路径**，7706 条平均 **103 字**、最长 184 字，
  //   而且**条条**开头都重复一遍 `[宜兴东氿中学]`（shelf 本来就是单独一个字段）。
  //   三条命中就是三百多字——面板上人读不动，塞进提示词里是白占额度。
  //   末段是够用的：平均 **35 字**，看着没信息量的只占 **2%**
  //   （最常见的几种是「专题02 与数轴有关的十七大…」「第2章 有理数（举一反三讲义）」）。
  // ★ 完整路径**不扔**——记进这一步的 origins，摆在展开的产物里，要找原文件时看得见。
  function shortName(h) {
    var full = String((h && (h.doc || h.title)) || '');
    var parts = full.split(/[\\/]/).filter(function (x) { return !!x; });
    var last = parts.length ? parts[parts.length - 1] : full;
    return last || '（没名字）';
  }

  // 三条拼成一段，总预算 RESLIB_CHARS。★ 按**顺序**吃预算：分数高的在前，
  //   所以先给的是最对得上的那一条。吃不下就不吃，不是把三条都截短——
  //   三条各截一半，不如一条给全。
  // ★ 回的是 `{text, used}`：`used` 是**真进得去的那几条**。命中五条、因为预算只吃了两条
  //   是常事，所以「出处」那份名单不能照 hits 全抄——抄全套会把没用上的也摆出来，
  //   看着像"这几块都进了提示词"。那正是"数字不是它宣称的那件事"。
  function pluckRes(hits) {
    var out = [], used = [], len = 0;
    for (var i = 0; i < (hits || []).length; i++) {
      var h = hits[i];
      if (!h || !h.body) continue;
      var one = cutOne(h.body);
      if (!one) continue;
      var head = '〔' + (i + 1) + '〕' + shortName(h) + '\n';
      if (len + head.length + one.length > RESLIB_CHARS && out.length) break;
      out.push(head + one);
      used.push(h);
      len += head.length + one.length;
    }
    return { text: out.join('\n\n---\n\n'), used: used };
  }

  // 这一步的文案。★ 三档要分得开，尤其是**"挂了"跟"没命中"**——
  //   这两种从外面看都是"附注里没东西"，可原因一个是系统坏了、一个是库里真没有，
  //   混成一句话，出问题时就没法查（gate 那边专门加了个 why 字段就是为这个）。
  function resNote(got) {
    if (got.why && !got.hits) return got.why;                 // 挂了 / 没配云
    if (!got.hits || !got.hits.length) return '库里没翻到对得上的';
    var names = got.hits.map(function (h) {
      return '「' + shortName(h) + '」' + Number(h.score).toFixed(2);
    });
    return got.hits.length + ' 块候选：' + names.join('；');
  }

  // 跑**一步**资源库检索并记进账本。rerun 走同一段，不另写一份。
  async function runResStep(r, query) {
    if (!at(r, 'reslib')) return { text: '', route: '' };     // 短路线那些工位：一个请求都不发
    set(r, 'reslib', { state: 'run', origins: [] });     // 开跑就把上一轮的出处清掉
    var got;
    try {
      var j = await cloudRes(query, STEPS.reslib.k);
      if (!j || !j.ok) {
        got = { hits: null, why: (j && j.why) || '云上没答上来', ms: (j && j.ms) || 0, route: '云上' };
      } else if (j.hits && j.hits.length) {
        got = { hits: j.hits, why: '', ms: j.ms || 0, route: '云上' };
      } else {
        // 云上答了，但一条都没有。★ 它可能顺手说了为什么（为什么字段在 gate 那边是分开的）
        got = { hits: [], why: j.why || '', ms: j.ms || 0, route: '云上' };
      }
    } catch (e) {
      got = { hits: null, why: '这一步自己出错了：' + ((e && e.message) || e), ms: 0, route: '云上' };
    }

    if (got.hits === null) {
      skip(r, 'reslib', resNote(got));
      return { text: '', route: got.route };
    }
    var picked = pluckRes(got.hits);
    // ★ origins 只列**真拼进去的那几条**（见 pluckRes 顶上那条注释），
    //   而且只在这里、只给人看——它不进提示词（`out` 才是发给模型的那一份）。
    var origins = picked.used.map(function (h) {
      var full = String((h && (h.doc || h.title)) || '');
      var sc = h && h.score != null ? '（' + Number(h.score).toFixed(2) + '）' : '';
      return shortName(h) + sc + '\n    ' + full;
    });
    set(r, 'reslib', { state: 'done', out: picked.text, note: resNote(got),
                       ms: got.ms, route: got.route, origins: origins });
    return { text: picked.text, route: got.route };
  }

  // 跑**一步**教材／追问检索并记进账本。rerun 用同一段代码，不另写一份
  // （另写一份就一定会漂，而这正是"重跑出来的东西跟原来不一样"这种坏法的来处）。
  async function runKbStep(r, step, query) {
    var spec = STEPS[step];
    var cut = cutOf(step);
    // ★ 这一回合的账本里**没有这一步**（画图／出题那两个工位走的是短一截的路线），
    //   那就一步都不跑、一个请求都不发。少了这道闸，那两个工位会白搭两次云函数往返，
    //   而它们的提示词里根本没有放这两段话的地方——纯浪费。
    if (!at(r, step)) return { text: '', route: '' };
    set(r, step, { state: 'run' });
    var got = await oneKb(step, query, spec.k);
    if (got.hits === null) {
      skip(r, step, got.why);
      return { text: '', route: got.route };
    }
    var text = (step === 'textbook') ? pickTextbook(got.hits, cut) : pickZhuawen(got.hits, cut);
    var note = kbNote(got.hits, cut) + (got.why ? '（' + got.why + '）' : '');
    // ★ route 一起改：云上答不上来退回本机时，这一格必须**当场改口**，
    //   不然面板上会一直写着"云上"，而那正是"这一步到底用了谁的东西"这件事的全部。
    set(r, step, { state: 'done', out: text, note: note, ms: got.ms, route: got.route });
    return { text: text, route: got.route };
  }

  // 跑完整的检索这几步。**query 由 api.js 算好传进来**——因为"这一轮加前几轮学生的话"
  // 这件事要历史，而历史只有 api.js 那边有（见 js/kb.js 的 queryFor）。
  // 返回 {textbook:'', zhuawen:'', reslib:''}，直接喂给 buildSystem 当第 6 个参数。
  async function retrieve(r, query) {
    var out = { textbook: '', zhuawen: '', reslib: '' };
    if (!r) return out;
    // ★ 把这一回合用的那句话记在账本上——**重跑那几步的输入就是它**。
    //   不记的话「重跑」只能重算一个空 queries，那是最难查的那种坏（它照样绿）。
    r.query = query || '';
    done(r, 'recall', {
      out: query || '', ms: 0,
      note: query ? (query.length + ' 个字') :
        '这一轮和前面都没有可用的话，几条检索都会落空——跟没加知识库时一样'
    });
    // ★ 三步**依次**跑，不并发。并发能省一点墙上时间（资源库冷启动那十来秒会被
    //   另两步盖住），但面板上画的是一条**按顺序亮**的流水线；并发跑的话
    //   第三步亮着的时候前两步已经亮了、甚至顺序都可能看着乱——
    //   "每一步看得见"是这东西的全部意义，不为省几秒把它弄成一笔糊涂账。
    //   ⚠ 真到了要省的时候，省法不是并发，是让资源库那个实例别冷下来（见 js/gate.js 那段）。
    out.textbook = (await runKbStep(r, 'textbook', query)).text;
    out.zhuawen = (await runKbStep(r, 'zhuawen', query)).text;
    out.reslib = (await runResStep(r, query)).text;
    return out;
  }

  // ★★ 重跑一步：拿**这一步原来的输入**（这一回合的 query）重算一遍，
  //   只更新它自己，下游全标成"得重来"。前面几步一个字不动。
  async function rerun(r, step) {
    if (!r || !at(r, step) || !STEPS[step] || !STEPS[step].rerun) return null;
    var q = r.query;
    // ★ 资源库那一步的回包形状跟另两步不同（它带的是正文，不是 title/score/text），
    //   所以走自己的 runner。**但"重跑只动这一步、下游标成得重来"这套规矩是同一套**——
    //   区别只在取数，不在重跑这件事本身的含义上。
    var got = (step === 'reslib') ? await runResStep(r, q) : await runKbStep(r, step, q);
    staleAfter(r, step);
    // 顺手把下游那个"要重来"的含义说清楚——面板上照这句话显示
    return got;
  }

  // ============================================================
  //  四、面板
  // ============================================================
  // ★ 为什么不做成弹层（跟「关于」「知识库」那些一样的 overlay）：
  //   弹层一盖上来就**看不见流水线边跑边亮了**——而"每步可见"正是这东西的全部意义。
  //   所以它占右栏一块地方，跟画板上下分。★ 也**没有**做成第四颗视角按钮：
  //   谁亮那件事只有 js/mindmap.js 的 syncSwitcher 一处说了算，去动它风险对不上收益。
  var host = null, painted = false;

  var GLYPH = { wait: '·', run: '◌', done: '✓', fail: '✗', skip: '–', stale: '↻' };
  var WORD  = { wait: '还没走到', run: '正在跑', done: '', fail: '没成',
                skip: '跳过了', stale: '得重来' };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    // ★★ 一律 textContent，**绝不 innerHTML**：这里的 out / note 里装的是
    //   模型自己生成的字和课本原文，塞进 innerHTML 就是把别人的字当代码执行。
    if (text != null) e.textContent = String(text);
    return e;
  }

  // 换工位时调。★ 判据是工位自己身上有没有 retrieve 这个开关
  //   （跟 js/api.js 那条"不在这儿写 if (work === ...)"同一个规矩），
  //   所以这个文件不认识任何具体工位的名字。
  function setWork(work) {
    var on = !!((SR.WORKS || {})[work] || {}).retrieve;
    try { document.body.setAttribute('data-flow', on ? 'on' : 'off'); } catch (e) {}
    // 换了体系（画图／出题没有流水线）就把账本清掉——留着上一条链的账本
    // 会画出一条"看起来这儿也跑过"的假流水线。
    if (!on && rounds.length) reset();
    else render();
  }

  function render() {
    if (painted) return;                 // 一次 tick 里改好几步只重画一次
    painted = true;
    setTimeout(function () { painted = false; paintNow(); }, 0);
  }

  function paintNow() {
    if (!host) host = document.getElementById('flowlist');
    if (!host) return;                   // 没这块 DOM（探针里就是）——静默，不许抛
    while (host.firstChild) host.removeChild(host.firstChild);
    var hint = document.getElementById('flowhint');
    if (hint) hint.textContent = rounds.length ? ('最近 ' + rounds.length + ' 轮') : '';

    if (!rounds.length) {
      var p = el('p', 'flowempty',
        '还是一条空流水线。发一句话，这里会一步步亮起来——' +
        '每一步都写清它用了什么、花了多久，翻歪了的那一步能单独重跑。');
      host.appendChild(p);
      return;
    }

    for (var i = 0; i < rounds.length; i++) host.appendChild(roundEl(rounds[i]));
    host.scrollTop = host.scrollHeight;   // 新的那轮在最下面，跟着往下走
  }

  function roundEl(r) {
    var box = el('div', 'fround' + (r.stale ? ' stale' : ''));
    var head = el('div', 'fhead');
    head.appendChild(el('span', 'fn', '第 ' + r.n + ' 轮'));
    var topic = r.text.length > 34 ? r.text.slice(0, 34) + '…' : r.text;
    head.appendChild(el('span', 'ftopic', topic || '（空的）'));
    var pr = progress(r);
    head.appendChild(el('span', 'fprog', pr.done + '/' + pr.total));
    box.appendChild(head);

    for (var i = 0; i < r.steps.length; i++) box.appendChild(stepEl(r, r.steps[i]));

    if (r.stale) {
      var foot = el('div', 'ffoot');
      foot.appendChild(el('span', 'ftxt', '检索变了——下面那几步得重问一次才作数。'));
      if (SR.chat && typeof SR.chat.submit === 'function') {
        var b = el('button', 'tool fbtn', '拿新的重问一轮');
        // ★ 说真话：它**不是**把上一轮覆盖掉，而是新起一轮。
        b.title = '这一句会原样再发一遍——会新起一轮，上一轮留在屏幕上，不会消失。';
        b.addEventListener('click', function () { SR.chat.submit(r.text); });
        foot.appendChild(b);
      }
      box.appendChild(foot);
    }
    return box;
  }

  function stepEl(r, s) {
    var row = el('div', 'fstep st-' + s.state);
    var line = el('div', 'fline');
    line.appendChild(el('span', 'fglyph', GLYPH[s.state] || '·'));

    var nm = el('span', 'fname', s.name);
    nm.title = s.what;                     // 这一步**是什么意思**，鼠标停一下就有
    line.appendChild(nm);

    // 出处两颗：在哪儿跑的（云上/本机/模型）+ 用的是谁的东西（苏科版/你写的/…）
    line.appendChild(el('span', 'ftag t-route', s.route));
    if (s.src && s.src !== s.route) line.appendChild(el('span', 'ftag t-src', s.src));

    if (s.ms) line.appendChild(el('span', 'fms', s.ms + ' ms'));
    if (WORD[s.state]) line.appendChild(el('span', 'fword', WORD[s.state]));

    if (s.rerun && (s.state === 'done' || s.state === 'stale' || s.state === 'fail' || s.state === 'skip')) {
      var b = el('button', 'fbtn flink', '重跑');
      b.title = '只重跑这一步。前面几步一个字不动，它下游那几步会标成「得重来」。' +
                '这一步不花额度。';
      b.addEventListener('click', function () { rerun(r, s.id); });
      line.appendChild(b);
    }
    row.appendChild(line);

    if (s.note) row.appendChild(el('div', 'fnote', s.note));
    if (s.out) {
      // 「每步可见产物」。用原生 details：不用写开合的 JS，键盘也点得动。
      var d = el('details', 'fout');
      d.appendChild(el('summary', '', '这一步的产物（' + s.out.length + ' 字）'));
      d.appendChild(el('pre', '', s.out));
      row.appendChild(d);
    }
    // 上面那块产物是**发给模型的那一份**（短名）。完整路径单独摆一块——
    // ★ 一定要跟产物**分开**说，不能混进去：混进去就等于路径又发给了模型，
    //   那正是这一趟要省掉的东西。所以连字号都不共用。
    if (s.origins && s.origins.length) {
      var d2 = el('details', 'fout');
      d2.appendChild(el('summary', '', '这几块的完整出处（' + s.origins.length + ' 条，只在屏幕上，不发给模型）'));
      d2.appendChild(el('pre', '', s.origins.join('\n\n')));
      row.appendChild(d2);
    }
    return row;
  }

  // ---- 初始化。main.js 在开机时调一次。----
  function init() {
    host = document.getElementById('flowlist');
    setWork((SR.chat && SR.chat.getWork) ? SR.chat.getWork() : (SR.DEFAULT_WORK || ''));
    render();
  }

  return {
    // 纯函数（node 里能跑）
    plan: plan, pickTextbook: pickTextbook, pickZhuawen: pickZhuawen,
    shortName: shortName, pluckRes: pluckRes, cutOne: cutOne, resNote: resNote,
    STEPS: STEPS, KB_STEPS: KB_STEPS, MODEL_STEPS: MODEL_STEPS, LIB_STEPS: LIB_STEPS,
    // 账本
    start: start, reset: reset, list: list, at: at, cur: cur, progress: progress,
    set: set, done: done, skip: skip, fail: fail, staleAfter: staleAfter,
    paintDone: paintDone,
    // 跑
    retrieve: retrieve, rerun: rerun, oneKb: oneKb,
    // 界面
    init: init, setWork: setWork, render: render
  };
})();
