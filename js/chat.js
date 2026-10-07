// 对话层：气泡、流式、把围栏派给画板、可选回答、拍照。
var SR = (window.SR = window.SR || {});

SR.chat = (function () {

  var els = {};
  var history = [];          // [{role, content}] —— 发给模型的上下文
  var busy = false;
  // ★ 2026-10-04：「画板没认 → 让模型改一次」那一趟**每次提问只准跑一趟**（见 试自修）。
  //   闸装在这一层、由 submit() 每轮开头置回 false —— 管的正是"**老师这一句话**
  //   最多让它改几趟"。写成 msg 上的一个字段也行，但那样闸就散在几处，
  //   而这个闸要拦的恰恰是"自修这一趟**又**没认 → 再自修"这条链。
  var 自修过了 = false;
  // ★★ 2026-10-04 夜：**局面数** —— 每一次"老师把这一局翻篇了"加一。
  //   谁会让它加：清空按钮、换工位/重开（`reset`）、老师又发了一句话（`submit`）。
  //   谁要看它：自修那一趟（`去问`）拿到存档、正等画板重画的那几秒里，如果这个数变了，
  //   说明**等的那几秒里局面已经不是原来那一局了** —— 这时**一步都不许往回动**。
  //
  //   为什么非有不可：`restore(旧)` 在"改坏了"那一刻是解药，在"老师刚把板清了"那一刻
  //   是**把垃圾搬回来**。它们在代码上长得一模一样（都是"把旧存档装回去"），
  //   光看板的状态也分不出来（都是"板上的东西跟旧的不一样了"）——只有**有人告诉过我们**
  //   局面翻篇了，才分得出来。同族：`find()` 抓第一个标签页、按秒表读状态，
  //   读数都合情合理，量的却是**别人那一刻的**东西。
  var 局面数 = 0;
  var work = SR.DEFAULT_WORK || 'prep';
  // 上下文条数的粗兜底。**真正管用的那道闸在 api.js 里**——免费通道只有 16K，
  // 得按 token 裁（trimHistory），按条数裁是挡不住"贴一道长题干"的。
  var MAX_TURNS = 24;
  var lastFail = null;       // 上一轮失败的提问，切完 Key 可以一键重发

  // ★★ 2026-10-06：气泡底下那根小条上的三件事（复制／修改／重新发送）。
  //
  // `pendingTrunc` —— 按过「修改」之后，**发送时该从第几条重来**。
  //   为什么是"挂起来等发送"而不是"按下去就删"：老师点「修改」往往只想**看一眼
  //   自己原来是怎么说的**，看完反悔、或者干脆不改了。按下去就删的话，
  //   他没有回头路。挂起来的话，只要不按发送（或者按 Esc），一个字节都没动。
  //   ★ 它跟 `pendingParts` 是一对：那个挂的是"要发什么"，这个挂的是"从哪重来"。
  var pendingTrunc = null;   // { n: 第几条, 原话: '…' }
  //
  // ★ 附件**不用另存一份**：那条气泡建出来的时候，`text` 和 `parts` 就已经
  //   被闭包攥住了（见 addUser 底下那段）。刷新之后 `SR.memo` 里没有图
  //   （memo.js 顶上那个老取舍），重画出来的气泡本来也就没有图 ——
  //   两边**同时**没有，看着是一致的，不需要在这儿补一句"图丢了"。

  // 开场白。★ 每个工位**一句话**，就这么长。
  //   2026-10-01 孔老师定了两回，第二回是骂醒的：他要的就是「告诉我你的问题」这一句。
  //   ★ 别再加第二句。加什么都算跑偏，试过两版都是这个下场：
  //     · 自述式（"我不判对错、不给答案、只顺着你的思路往下问…"）＝把工作方式念给学生听，像说明书
  //     · 补充式（"做错的、不会的都能发，整张卷子也行。先说说你想到哪一步了。"）
  //       ＝像是怕他不用而急着推销自己，**"有点刻意了"说的就是这种**
  //   ★ 那两层意思都没丢，只是不在这儿说：「为什么这么设计」在「关于」面板里；
  //     发整张卷子、发文件这些，属于**问得出来就答得出来**的事，
  //     不用开场白替他把用法讲一遍（真发上来了，"整卷附注"那一档会接住，见 api.js）。
  var OPENING = {
    // ★ 出材料这一句要把**头两步**说全：模板 + 要求。只写"传一份模板"的话，
    //   老师传完就停在那儿等，不知道下一步该说话；写了但不说传模板，
    //   出来的东西就没有版式可套——那正是这个工位唯一的产品前提。
    material: '传一份你学校的模板，再说要出什么。',
    draw: '告诉我你想画什么。',
    // ★ 备课这一句要说清**进来什么、出去什么**（2026-10-02 改）。
    //   原来那句是「告诉我你要上的哪一课。」——只说了一半：老师给完课题，
    //   不知道会拿回什么，也就看不出这个工位跟"直接问 AI 答案"有什么两样。
    //   现在这句把两件事都说出来：给的是题/课题，拿回去的是**学生怎么答**。
    prep: '给我一道题或者一个课题，我把学生怎么答摆给你看。',
    vary: '把题目发过来，我给你出几个变式。',
    // ★ 学情这一句同样要说清**进来什么、出去什么**（跟上面备课那条一个道理）：
    //   进来的是一张表，拿回去的是"先讲哪三道"。只说"把成绩表传上来"的话，
    //   老师会以为这儿能给他一堆图表，传完发现只有几句排好序的题号。
    //   ⚠ 别写成"我给你分析分析"——他缺的不是数据，是**先讲哪个**。
    grade: '把成绩表传上来，我只看你出的那几道，告诉你先讲哪三道。',
    review: '把卷子发过来，我先列一遍题，你挑哪一道讲。'
  };

  // 输入框的提示语，跟开场白一样**按工位给**。
  // 一句话，说的是"这一格你该往里打什么"——举的那个例子要真是这个工位接得住的。
  var TIP = {
    material: '说说要出什么，例如 第五周 一元一次方程 周练卷',
    draw: '说说要画什么，例如 数轴上表示 -2 和 3',
    prep: '贴一道题，或者写一个课题，例如 3.1 代数式的值',
    vary: '贴一道题，我给你出几个变式',
    // 举的例子得是**他真的会拿到的那种表**：智学网导出的成绩表。
    grade: '把成绩表发过来，例如 智学网导出的那张表',
    // ★ 原来后半句是"也可以先说说这次考得怎么样"——那是**学生**的口吻
    //   （考完回来说自己考得怎么样）。老师发卷子是来讲评的，不是来报分数的。
    review: '把卷子发过来，拍照、PDF、Word 都行，一次可以发好几张'
  };
  // 窄屏那一版：**只剩动词，例子全去掉。**
  //
  // ★ 为什么要另开一版（2026-10-02 390/360 实测）：
  //   index.html 上写着"placeholder 要短：输入框最矮只放得下一行，长占位符会被边框切掉半行"——
  //   那条原则是对的，可上面这份 TIP 一句 21～28 字，**比它警告的还长**。
  //   390px 上输入框内容宽 189px、15px 的字一行放 12 个字，于是材料那句折成 2 行、
  //   360px 上折成 3 行，而框最矮只有 47px（正好一行）——底下被切掉 21px / 45px。
  //   截图上就是"说说要出什么，例如 第五周 一元"后面没了。
  //   ⚠ 一行的上限是 **10 个字**（360px 上内容宽 159px ÷ 15px ≈ 10.6），下面每句都在 10 以内；
  //     超了就会折行，折行就又被切。改这几句之前先照这个数一数。
  //   ⚠ 例子不是删了——它在**开场白**里（上面 OPENING），那一段在对话区，多长都放得下。
  var TIP_SHORT = {
    material: '说说要出什么',
    draw: '说说要画什么',
    prep: '贴一道题或写课题',
    vary: '贴一道题试试',
    grade: '发成绩表进来',          // 6 字，一行的上限是 10
    review: '把卷子发过来'
  };
  // 用哪一版：窄屏用短的。**900px 跟 css 那条断点取同一个数**——
  // 两边要是错开，就会出现"CSS 已经按手机排了、提示语还是长的那句"。
  function tipFor(w) {
    return (window.innerWidth <= 900 ? TIP_SHORT : TIP)[w] || TIP.prep;
  }

  function $(id) { return document.getElementById(id); }

  function init() {
    els.msgs = $('msgs');
    // `#chips`（输入框上面那排常驻选项）2026-10-03 删掉了 ——「想说」改成挂在
    // 它自己那条回复底下（见 showChips），那个常驻容器就没人往里写了。
    // ⚠ 连 `els.chips` 也一起删：下面那个 missing 检查是**按 els 的键**遍历的，
    //   容器没了还留着这个键，页面一开就会报一句"少了个 id"的假警报。
    els.input = $('input');
    els.send = $('send');
    els.attach = $('attach');
    els.file = $('file');
    els.status = $('status');
    els.steps = $('steps');

    // 页面骨架要是缺了哪个 id，给一句人话，别整页白屏
    var missing = [];
    for (var k in els) if (els.hasOwnProperty(k) && !els[k]) missing.push(k);
    if (missing.length) {
      console.error('页面里找不到这些元素：' + missing.join('、') + '（检查 index.html 的 id）');
      return;
    }

    els.send.addEventListener('click', function () { submit(); });
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
      // ---- Esc = 反悔（2026-10-06）----
      // ★ 只办一件事：把按「修改」挂起来的那一刀**卸掉**（见文件开头 `pendingTrunc`）。
      //   按「修改」之后输入框里是他原来那句话，**发送键就在手边** ——
      //   他可能只是想看一眼、然后顺手清空走人。清空走人倒是不会触发那一刀
      //   （`submit` 头一句就把空话挡了），可万一他清到一半又打了几个字发出去，
      //   丢掉的就是后面那几轮。
      // ★ 只卸刀，**不清输入框**：那是他自己的字，Esc 不该替他删掉。
      // ⚠ 跟工位那一行的 Esc（如果有）不冲突：这一句只在输入框里按的时候才响。
      if (e.key === 'Escape' && pendingTrunc) {
        pendingTrunc = null;
        setStatus('不改了，后面那几轮都留着。');
      }
    });
    els.input.addEventListener('input', autoGrow);
    // 提示语分长短两版，窗口跨过 900px 那条线时要换过来。
    // ★ 不挂这个的话：手机竖着打开（短提示），转成横屏 / 拖宽窗口跨过 900px，
    //   提示语还是那句短的不说，**长那版的例子永远回不来**——除非切一次工位。
    window.addEventListener('resize', function () {
      if (els.input) els.input.placeholder = tipFor(work);
    });
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
    // ★ 清空**必须连带把这一页的存档一起作废**（`SR.tabs.cleared`）。
    //   不喊这一声的话：老师点清空 → 板上确实空了 → 但这一页存的还是那张图，
    //   他一走再回来，图自己又长回来了。他会以为"清空没生效"，
    //   然后连点三下——而那个 bug 长在别的地方，他怎么点都修不好。
    if (bc) bc.addEventListener('click', function () {
      局面数++;          // ★ 老师亲手把板抹了 = 翻篇：自修那一趟不许再把老图"还回来"（见 局面数）
      SR.board.clear();
      if (SR.tabs) SR.tabs.cleared();
    });
    if (bpng) bpng.addEventListener('click', function () { saveBoardPNG(bpng); });

    // 分步演示那三个（见 js/board.js 里"分步"那一整段）。**按钮只报"往哪走"**，
    //   具体走几步、谁露谁藏，全在画板那边算——两边各算一份的话，
    //   滑块驱动和按钮驱动早晚会说得不一样。
    var bnext = $('btn-next'), bprev = $('btn-prev'), breset = $('btn-reset');
    if (bnext) bnext.addEventListener('click', function () { SR.board.stepBy(1); });
    if (bprev) bprev.addEventListener('click', function () { SR.board.stepBy(-1); });
    if (breset) breset.addEventListener('click', function () { SR.board.stepReset(); });

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
      if (!url) { setStatus('GeoGebra 上还没画东西，或者这一版的浏览器不让存图。'); return; }
      var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
      // ★ 文件名里的「画板」也换掉了（2026-10-02）：存下来的图会被贴进课件、发进群里，
      //   文件名是**别人第一眼看到的那行字**，它得自己说得清是拿什么画的。
      var name = '数根-GeoGebra-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
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

  // 画板说"这一张图有分步" → 把那条按钮亮出来，并把「第几/共几步」写上去。
  //   ★ 走的线跟上面 onPlayState 一模一样（board 的 hooks.stepState → 这里），
  //     不是两个来源：`#分步` 是模型写在围栏里的，只有画板知道有几个。
  //   ★ 亮/灭用 display，跟 `.tabs` 一个规矩（见 index.html 那段注释）。
  function onStepState(st) {
    var bar = $('stepbar');
    if (!bar) return;
    if (!st || !st.max) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    var num = $('stepnum');
    if (num) num.textContent = '第 ' + st.now + ' / ' + st.max + ' 步';
    // ★ 走到两头就把那一头**按死**（灰掉），别让它点了没反应——
    //   点了没反应，老师会以为按钮坏了，然后连点三下。
    var bp = $('btn-prev'), bn = $('btn-next');
    if (bp) bp.disabled = st.now <= 0;
    if (bn) bn.disabled = st.now >= st.max;
  }

  function setStatus(s) {
    if (els.status) els.status.textContent = s || '';
  }

  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
  }

  // ---- 开场白重置 ----
  // ============================================================
  //  统一记忆（见 js/memo.js）——把这一场从浏览器里摆回屏幕上
  // ============================================================
  //
  // ★ 这里跟 memo 是**一份数据的两个朝向**：memo 存的是原文（带围栏那个 raw），
  //   重画照原文重画，喂给模型的 history 也照原文拼回来。
  //   所以屏幕上恢复出来的一定就是发给它的那一条——不存在"看着对、发过去少了"。

  function workLabel(id) {
    var w = (SR.WORKS && SR.WORKS[id]) || {};
    return w.label || id || '';
  }

  // 换了工位那一处插一条分界线。★ 它**不进 memo、不进 history**：
  //   它只是给老师看的——"底下那些是另一道工序办的"。
  //   塞进 history 的话，模型下一轮会看见一条它自己没说过的话，
  //   而那句话在屏幕上看着完全正常，谁也不会往那儿想。
  function addDivider(to) {
    var el = document.createElement('div');
    el.className = 'wdiv';
    el.textContent = '换到「' + workLabel(to) + '」';
    els.msgs.appendChild(el);
  }

  // 接着往下说的时候，也要把接缝补上。
  //
  // ★ 分界线有**两条路**要画，只做一条就会出这种事：
  //   重画那条（repaintLog，刷新页面、切工位走它）里挨条比 w，
  //   而**真说话的这条**（submit 里 addUser + assistant 气泡）根本不经过重画。
  //   结果：当场说着话，两个工位的话**就这么连成一段**，中间什么也没有；
  //   等刷新一下，那条线又冒出来了——**中间那段到底是不是同一个人说的，
  //   屏幕给的答案前后不一致**（[[scanner-numbers-are-not-what-they-claim]] 那条：
  //   同一个事实两处各算一遍，就得两处都算对）。
  //   判据用**盘上最后一条的工位**，不是内存里的 work——切工位时内存已经换过去了。
  function seamIfWorkChanged() {
    if (!SR.memo) return;
    var list = SR.memo.log();
    if (!list.length) return;
    var prev = list[list.length - 1].w;
    if (prev && work && prev !== work) addDivider(work);
  }

  // ============================================================
  //  「流水线」那一块跟着**这一条回复**走（阶段 F）
  // ============================================================
  //
  // ★ 以前它是右栏里跟画板上下分的一块，**常驻**：跑完七步它还立在那儿，
  //   下一条回复来了再重画一遍——老师看不出"这条流水线是哪句话的"。
  //   现在把它搬进这一轮那条气泡里，跟卷子卡、冻图一个待遇：**谁的话，挂在谁下面。**
  //
  // ★ 搬的是**整个 #flowbox 节点**，不是重画一份。`#flowlist` 是它的子节点，
  //   搬父即整块搬；js/flow.js 一个字都不用改（它只认 `#flowlist` 那个 id，
  //   paintNow 每次都重新 `getElementById`，节点挪到哪儿它都能接着画）。
  //
  // ⚠ **脱档的坑**（这一阶段唯一会咬人的地方）：一旦搬进气泡，`#flowbox` 就成了
  //   `#msgs` 的后代；而 `#msgs` 有两处会被整个掏空（`reset()` 里一次、repaintLog
  //   开头一次），它跟着一起脱档。脱档之后 `document.getElementById('flowbox')`
  //   就**返回 null 了**（不在 document 里的节点查不到），屏幕上只表现为
  //   "流水线不见了"，跟"这条本来就没有流水线"长得一模一样。
  //   治法：**第一次读到它就攥住引用**（`flowEl`），脱档了也还在手上。
  //   所以这个引用不许释放 —— 它就是全部保险，比 `getElementById` 认得的多一份。
  var flowEl = null;    // #flowbox 本体
  var flowHome = null;  // 它原来那个窝（抽屉里）：{parent, next}。空着的时候回这儿待着。

  // 什么时候把它摆进对话？两条**都**要满足：
  //   ① **这个工位有流水线** —— 判据是工位自己身上有没有 `retrieve` 这个开关，
  //      跟 js/flow.js 的 setWork 用的是**同一个开关**（`.retrieve`，不是工位名字，
  //      所以这儿也不会写死 "prep"/"review"）。
  //   ② **账本里真有轮次** —— 刷新回来时 setWork 在 init 里跑过、那时一轮都没跑，
  //      账本是空的；空的摆出来就是一句"最近 0 轮"，钉在回复下面只会像坏了。
  //      **这正对**：刷新之后它就该回抽屉里待着，等下一轮再长出来。
  // ⚠ 为什么不能只看账本（这是我第一版写错的那处）：切工位时 main.js 的顺序是
  //   `SR.chat.setWork(w)`（走重画这条路）**在前**、`SR.flow.setWork(w)`（那才 reset
  //   账本）**在后**——重画那一刻账本还是**上一个工位**的。只看账本的话，
  //   从备课切到组卷，会把备课的流水线挂进组卷那条回复里。
  // ⚠ 也不用 `data-flow` 那个属性：那是 css 显隐用的，同样慢一拍。
  function flowLive() {
    if (!((SR.WORKS || {})[work] || {}).retrieve) return false;
    return !!(SR.flow && SR.flow.list && SR.flow.list().length);
  }

  function flowBox() {
    if (!flowEl) {
      // ★ 第一次一定读到抽屉里那一份：能把它搬进气泡的只有 homeFlow，而 homeFlow
      //   也走这里。所以这一步顺手就把"窝"的坐标记下来了。
      flowEl = document.getElementById('flowbox');
      if (flowEl) {
        flowHome = { parent: flowEl.parentNode, next: flowEl.nextSibling };
        // 「跑完收起来」：点表头展开／收起。**不写进 js/flow.js** —— 那个文件管的是
        // "七步怎么跑"，折叠纯粹是摆法，而且是搬进气泡之后才有的摆法。
        var head = flowEl.querySelector('.colhead');
        if (head) head.addEventListener('click', function () { flowEl.classList.toggle('open'); });
      }
    }
    return flowEl;
  }

  // 搬进这条气泡。folded 默认 true（跑完了就折成一行，点开才铺开）。
  function homeFlow(b, folded) {
    var box = flowBox();
    if (!box || !b) return false;
    box.classList.toggle('done', folded !== false);
    if (folded === false) box.classList.add('open');
    b.appendChild(box);
    // ★ 有产物 → 气泡定宽，跟卷子卡／冻图同一条理由（见 css `.bubble.hasprod`）：
    //   流水线是一块要横向铺开的表格，气泡要是缩到文字的宽度，它会挤成一团。
    b.classList.add('hasprod');
    return true;
  }

  // 搬回抽屉里原来那个位置（空着的时候，或者换到没有流水线的工位时）。
  function parkFlow() {
    var box = flowBox();
    if (!box || !flowHome || !flowHome.parent) return false;
    box.classList.remove('done', 'open');
    if (flowHome.next && flowHome.next.parentNode === flowHome.parent) {
      flowHome.parent.insertBefore(box, flowHome.next);
    } else {
      flowHome.parent.appendChild(box);
    }
    return true;
  }

  // 按记忆把这一场重画一遍。返回"到底摆回来了没有"——
  //   空的那一场得退回开场白，不能留一块空白。
  function repaintLog() {
    if (!SR.memo) return false;
    var list = SR.memo.log();
    // ★ 空场也要把流水线放回抽屉（下面那条路会提前 return，走不到散场那几行）。
    if (!list.length) { parkFlow(); return false; }
    // ★ 先把引用攥到手上（`flowBox` 第一句就是），再掏空 `#msgs` ——
    //   这一行之后它可能就是脱档的那个了，理由见上面 flowEl 那段长注释。
    flowBox();
    els.msgs.innerHTML = '';
    var prev = '';
    var ask = '';  // 上一条**老师说的话** —— 卷子名字就是从它来的（见 fileTitle）
    var ai = 0;   // 第几条**助手回复**——「打包」那颗按钮拿它当序号（见下面那段注释）
    var lastB = null;  // 最后一条助手气泡 —— 散场时流水线要挂到它身上
    // 「想说」也要跟着摆回来，但**只摆最后那一条**（见散场那几行）。
    //   这三样是给最后一条准备的材料：它自己那份 ```想说、在哪个工位、
    //   是不是本场的第一次回复（`SR.fallbackChips` 里只有讲评那份认 `first`）。
    var lastSay = null, lastWork = '', lastFirst = false;
    // ★ 这一屏里"有图要先摆着、摆完要自己补上"的那些（2026-10-04，见 补图 那段）。
    //   攒在这儿、等整屏摆完再开跑 —— 摆的中间就开跑的话，`freezeFences` 会跟
    //   `placeFigures`（还在往正文里挪框）抢 DOM，图会钉到没摆好的位置上。
    var 待补 = [];
    // ★ 2026-10-04：作图那三颗兜底按钮要按"图上画的是立体还是平面"挑词
    //   （孔老师 2026-10-03 截图那三条"画个正方体／换成三维"，摆在一条数轴底下）。
    //   攒**每条助手回复的原文**——判据是"最近一条真画了图的回复说了算"，
    //   规则本身在 js/chips.js 的 SR.dimFromTexts 里（纯函数，探针量得到）。
    var dimTexts = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      // t.w = 说这句话的时候在哪个工位。变了就插一条分界线。
      if (t.w && prev && t.w !== prev) addDivider(t.w);
      if (t.w) prev = t.w;
      if (t.r === 'u') {
        ask = t.t;
        // ★ 2026-10-06：老师这一条也要钉门牌 —— 「修改 / 重新发送」要按它算
        //   "从第几条重来"（见 账本号 / 从这儿重来）。重画这条路跟当场那条路
        //   **必须钉同一个号**，不然刷新之后这两颗按钮要么失灵、要么切错地方，
        //   而屏幕上两种表现看着都像"按钮坏了"。
        //   ⚠ 传 `[]`：账本里没存图（memo.js 顶上那个老取舍），重画出来本来就没图，
        //     所以 attachUserActs 拿到的 parts 是空的 —— 那一颗「重新发送」
        //     重发出去的也就只有字，**跟屏幕上这条看着一致**，不会出现"图悄悄少了"。
        var ue = addUser(t.t, []);
        if (ue) ue.setAttribute('data-mi', String(i));
        continue;
      }
      dimTexts.push(String(t.t || ''));     // 助手回复的原文——挑兜底按钮用（见上面 dimTexts）
      // ★ 2026-10-03 起用 restoreParts（`restoreText` 是它的薄包装）：
      //   重画这条路**不只要正文了** —— 每条回复底下还要钉回它自己那块冻图，
      //   那需要 `ggb` 那几份命令原文。
      var pr = restoreParts(t.t, t.w);
      var v = pr.visible;
      var b = addAssistantText(v);
      // ★ 给这条消息钉上它在 memo 里的序号。用途只有一个：**补卡**。
      //   开机那一刻模板还没从 IndexedDB 里读出来（restore 是异步的，而这条路
      //   在 chat.init() 里**同步**就跑完了），卷子卡建不出来；等模板接回来之后
      //   paintMatCards() 要能回头找到该补的那条。靠 DOM 顺序数位置是不行的——
      //   中间夹着分界线（addDivider）和老师说的话，数出来会错位。
      if (b && b.parentNode) b.parentNode.setAttribute('data-mi', String(i));
      // ---- 「复制这段」要跟着摆回来 ----
      //
      // ★ 原来只有当场收流那条路（submit 的收尾，见 attachCopy 那边）会挂这一颗。
      //   于是刷新之后：链子摆回来了、字一条不少，可带走用的按钮一条都没有，
      //   而「关于」里明写着「备好的追问链可以「复制这段」带走」（那段话还标着
      //   "2026-10-02 才补上"）。
      //   跟 restoreText 是同一个毛病、同一条规矩：同一个事实两处各算一遍，
      //   就得两处都算对（见上面 seamIfWorkChanged 那段，"刷新前后屏幕给的答案不一致"）。
      //
      // ⚠ 序号 ai 必须跟 seedPack 数出来的**同一个顺序**：那边也是按 memo 顺序、
      //   只取助手回复（`if (list[i].r !== 'a') continue;`）。两处错开一位，
      //   绿行勾第 3 条勾中的是第 4 条的内容，而包看着是完整的。
      //   ⚠ ai 要数**每一条**助手回复，不受下面 copy 那道闸影响。
      //
      // ★★ 2026-10-06：`copy: true` 那道闸**撤了** —— 六个工位一律挂「复制这段」。
      //   孔老师这一轮的原话是「每个会话都有一个复制功能？你看看 deepseek 做的事情」，
      //   而 DeepSeek 那边每一条都带复制。回头再看原来那道闸也不成立：
      //   `copy: true` 只有备课／命题／讲评三格（见 js/config.js），可**另外三格的
      //   回复也是一段文字**——作图那轮它讲"这几个点要落在数轴上"，出材料那轮
      //   它讲"这份卷子我排了哪几道"，老师一样要往教案、往群里贴。
      //   当年只在"产物本身就是一段文字"的三格上挂，是把"这段的字好不好用"
      //   当成了"要不要给复制"的判据；可判据该是**有没有一段话**，而回复都有话。
      // ⚠ 原来这儿还有一行 `var cfg = SR.WORKS[t.w] || {}` —— 撤了那道闸之后
      //   它一个读者都没有了（`restoreParts` 是照 `t.w` 自己查工位的），
      //   别留着：留着一个没人读的变量，下一个人会以为"这儿还分着工位"。
      if (b && SR.pack && SR.pack.__seed) b.setAttribute('data-turn', String(ai));
      attachCopy(b, v, ai);
      lastSay = pr.say; lastWork = t.w; lastFirst = (ai === 0);
      ai++;
      // 冻图跟着摆回来。★ 会话内有缓存（比如点 ⟳ 切工位触发的那次重画）就直接贴图；
      //   刷新之后内存缓存是空的，就先摆一块写着「图」的占位 —— **点一下才现画**。
      //   不这么做的后果是"刷新一次就把整场对话的图全重画一遍"，二十轮就是二十次
      //   借板+截图，老师会以为页面卡死了。
      var gboxes = [];
      for (var gi = 0; gi < pr.ggb.length; gi++) {
        gboxes.push(attachFigure(b, pr.ggb, gi, (pr.ggbInfo && pr.ggbInfo[gi]) || ''));
      }
      // ★ 记进"待补"那一队：这一屏摆完之后**自己把它们补上**（2026-10-04，见 补图 那段）。
      //   ⚠ 记的是**这条气泡的整串围栏 + 它的那几个框**，不是单个 `.figbox`：
      //     `freezeFences` 冻的是"到这一张为止的累积状态"，一条气泡跑一趟就够了，
      //     按框去跑会把同一串围栏反复借板（三个框 = 三趟，白等三份 13 秒）。
      if (gboxes.length) 待补.push({ fences: pr.ggb, boxes: gboxes });
      // ★ 每张图钉回它自己那道题下面（原文在 `t.t` 里；当场那条路在收流处做同一件事）
      if (gboxes.length) placeFigures(b, t.t, gboxes);
      // ---- 卷子卡也要摆回来 ----
      attachMatCard(b, pr.matBody, ask);
      lastB = b;
    }
    // 流水线挂到**最后那条**助手回复上（账本只说"最近 N 轮"，本来就是整场一份，
    //   挂在最新那条下面才跟得上对话）。没有账本就回抽屉——见 flowLive 那段。
    if (flowLive() && lastB) homeFlow(lastB, true);
    else parkFlow();
    // ---- 「想说」摆回**最后那一条**底下（阶段 G）----
    // ★ 为什么只摆最后一条：当场那条路就是这样——`clearChips()` 在新一轮发出去时
    //   先把上一排撤掉（见 submit 开头），所以屏幕上永远只有**最新**那一条底下有
    //   三颗可点的话。二十轮全摆回来的话，一屏里横着二十排按钮，那不是对话。
    // ★ 模型没写 ```想说 的那几轮，当场是**本地兜底**顶上的；重画这条路也得照做，
    //   不然会出现"刷新之后最后那三颗不见了"——看着像按钮丢了，其实是没人重算。
    //   判据跟当场同源：同一条 `pr.say`、同一个 `SR.fallbackChips`，
    //   所以两处不会给出不一样的三句话。
    //   ⚠ 2026-10-04：这句话原来是"兜底只用到 work 和 first 两样"。**现在不止了**——
    //     作图那一档还要 `is3D`（就是上面攒的 dimTexts），少了它，刷新之后
    //     一张立体图的底下会换成平面那三句。两处**必须传同一个东西**，
    //     跟"当场与重画不给两套答案"是同一条规矩。
    if (lastB) {
      var sl = (lastSay && lastSay[0]) ? lastSay[0].split('\n') : [];
      sl = SR.filterCopiedChips(sl);
      showChips(sl.length ? sl : SR.fallbackChips({
        work: lastWork, first: lastFirst, is3D: SR.dimFromTexts(dimTexts),
        texts: dimTexts     // ★ 作图这一档照图挑词要它（见 chips.js「图上画的到底是什么」那段）
      }), lastB);
    }
    scroll();
    // ---- 整屏摆完了，这才开始补图（2026-10-04，见 补图 那段）----
    // ★ 压在最后：这一屏该摆的框、该挪的位置（placeFigures）、该钉的按钮全钉完了，
    //   才轮到"去冻图"这趟慢活儿开跑。早一步开跑，`fillFigure` 会跟
    //   `placeFigures` 抢同一个 `.figbox` 的父级。
    // ⚠ 它**不阻塞**这一行以后的任何东西 —— 补图是异步的，一屏摆完立刻返回，
    //   老师马上就能接着打字。这一条是"图直接显示出来"的前提：要是等图补完
    //   才让页面活过来，那就是拿一次十几秒的白屏换一张图。
    补图(待补);
    return true;
  }

  // 给一条**已经画好的**气泡补上它那份卷子卡。
  //
  // ★ 判据是 `matBody`（正文有没有东西），**不是** `mat.length`：
  //   围栏掉了、编号行是被本地捡回来的那种，`mat` 是空的而卷子照样有——
  //   拿围栏数当判据的话，正是"最容易丢材料"的那一轮刷新之后卡不见了。
  // ★ 走 `SR.material.renderCard`，跟当场同一个渲染器（模板取快照这条用不上：
  //   刷新之后 `cur` 是从 localStorage 恢复的那一份，本来就只有它）。
  // ⚠ 模板没恢复出来（同学换了台机器 / 清了站点数据）→ 卡摆不出来，那就别摆：
  //   宁可没有这张卡，也不能拿一份**别人的**模板排出来的卷子糊弄他。
  // ★ 已经有了就不重复摆（补卡那趟会重扫一遍整场对话）。
  function attachMatCard(b, matBody, ask) {
    if (!b || !matBody) return false;
    if (!SR.material || !SR.material.renderCard || !SR.material.current()) return false;
    if (b.querySelector('.paperbox')) return false;
    var t = SR.material.current();
    var mEl = document.createElement('div');
    mEl.className = 'paperbox';
    b.appendChild(mEl);
    b.classList.add('hasprod');   // ★ 有产物 → 气泡定宽（见 CSS 里 .hasprod 那段）
    SR.material.renderCard(mEl, t, SR.produce.parseBlocks(matBody), fileTitle(ask, t), '',
      { lazy: true, collapsed: true });
    return true;
  }

  // ★★ 补卡那一趟。**为什么非有不可**（2026-10-03 探针量到的真窟窿）：
  //   模板存在 IndexedDB 里，`SR.material.restore()` 是**异步**的；而重画这条路
  //   在 `SR.chat.init()` 里**同步**就跑完了 —— boot 里 init（main.js:441）排在
  //   restore（main.js:525）前面。于是刷新之后重画那一刻 `SR.material.current()`
  //   还是 null，卷子卡**一条都建不出来**，而且是**静默**的：对话里字一条不少、
  //   冻图占位也在，只有那张卡没了 —— 老师只会以为"卷子丢了"。
  //   （当场那一轮不经过这条路：`cur` 就在手上，所以这个毛病只在刷新后出现。）
  //   治法：模板接回来之后再扫一遍，**只补还没有卡的那些气泡**（data-mi 认门牌）。
  function paintMatCards() {
    if (!els.msgs || !SR.memo || !SR.produce) return 0;
    if (!SR.material || !SR.material.renderCard || !SR.material.current()) return 0;
    var list = SR.memo.log(), ask = '', n = 0;
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.r === 'u') { ask = t.t; continue; }
      var msg = els.msgs.querySelector('.msg[data-mi="' + i + '"]');
      if (!msg) continue;
      var b = msg.querySelector('.bubble');
      if (!b || b.querySelector('.paperbox')) continue;
      var pr = restoreParts(t.t, t.w);
      if (attachMatCard(b, pr.matBody, ask)) n++;
    }
    if (n) scroll();
    return n;
  }

  // 重画一条**模型说过的话**：必须走跟当场那一轮**同一个**解析（render.js 的 parseFences）。
  //
  // ★ 不走会怎么样——2026-10-03 在页面上量到的：**同一段原文，刷新前后两个样子**。
  //   当场渲染走 p.visible（围栏被摘掉：命令进画板、气泡里只剩正话），
  //   重画这条路却把原文直接倒进气泡里，于是老师看见的是
  //     「#清空 / 数轴 / 点(-2,"-2") / 点(3,"3")」
  //   ——机器话。render.js 顶上写着 visible 才是"能给人看的正文"。
  //   更难看的是**只有命令、没有正话**的那种回复：当场渲染气泡是空的，
  //   刷新一下，气泡里就剩这一串光秃秃的命令。
  //   这违反的是本文件上面 seamIfWorkChanged 那条立过的规矩：
  //   同一个事实两处各算一遍，就得两处都算对（"刷新前后屏幕给的答案不一致"）。
  //
  // ⚠ 两处都得跟当场那条取**同一个来源**：
  //   · stripAssign —— 按**说这句话时**的工位（t.w）取，不是按现在的工位；
  //   · 出材料那份编号行 —— 交给 produce.pickSource，跟当场同一条规则。
  //     它自己保着一条底线："收都不收就别抹"（见 produce.js），
  //     所以这儿不会把气泡抹空——那句注释就是为这个边界写的。
  // ★★ 2026-10-03：重画这条路要的**不只是正文**了。每条回复底下要长它自己的冻图
  //   （`ggb` 那几份命令原文）、「想说」要长进那条气泡（`say`）、材料卡要那份 `mat`。
  //   所以把解析结果**整个**交出来，`restoreText` 退化成它的一层薄包装。
  //   ⚠ 里面**仍然只调 SR.render.parseFences**，绝不另写一遍正则 ——
  //     当场（submit）、重画（repaintLog）、打包（seedPack）三处必须同源，
  //     这是「不能破的东西」里的第 ① 条。多一份解析就是多一个会漂的真源。
  function restoreParts(raw, tw) {
    var w = (SR.WORKS && SR.WORKS[tw]) || {};
    if (!SR.render || !SR.render.parseFences) {
      return { visible: raw, ggb: [], ggbInfo: [], say: [], mat: [], pending: '', matBody: '' };
    }
    //    ★ 重画这条路手里的 `raw` 一定是**全文**（它来自存下来的那条记录）→ 收尾。
    var p = SR.render.parseFences(raw, { stripAssign: !!w.stripAssign, 收尾: true });
    var v = p.visible;
    var matBody = '';                    // 这份卷子的正文（编号行原文），重画那张卡要用
    if (tw === 'material' && SR.produce && SR.produce.pickSource) {
      var pk = SR.produce.pickSource(v, p.mat && p.mat.length ? p.mat[p.mat.length - 1] : '');
      v = pk.rest;                       // ⚠ 编号行一律不许留在气泡里，跟当场同一条
      matBody = pk.from ? pk.body : '';  // 没从这儿来 → 空串，调用方据此不摆卡
    }
    return {
      visible: v, ggb: p.ggb || [], ggbInfo: p.ggbInfo || [],
      say: p.say || [], mat: p.mat || [], pending: p.pending || '',
      // ★★ 2026-10-03：重画这条路也要把**卷子卡**摆回来。判据跟当场**同一条**
      //   （`pk.from`，走的是同一个 produce.pickSource），所以"当场摆出来的卡"
      //   和"刷新之后摆回来的卡"不会出现一张有一张没有。
      matBody: matBody
    };
  }

  function restoreText(raw, tw) { return restoreParts(raw, tw).visible; }

  // ============================================================
  //  每条回复底下那张**冻图**
  // ============================================================
  //
  // 为什么冻一张下来、而不是每条回复嵌一个活画板：聊二十轮就有二十个 GeoGebra
  // applet，页面会卡死。所以每条回复把图画**一次**、截下来，钉在它自己那条气泡底下；
  // 老师真想动它，点「再摆弄」把右栏抽屉拉出来，在**那一块**板上接着弄。
  //
  // ★★ 最要紧的一条：**板是累积的**（`SR.board.openNew` 先 snapshot 再 run，从不清空）。
  //   所以第 N 页 = 围栏 1…N 叠加 —— 这正是"讲题顺序"想要的样子。
  //   于是冻第 N 张时**绝不能**再补 `#清空`：补了就把前面几页洗掉，冻出来一张
  //   跟板对不上的图（"连接 AB"那张里根本没有 A、B）。
  //   所以走 `SR.figures.splitLines`（只要切片），**不走 `linesOf`**（那个带清空）。
  //   ⚠ 只有**第 1 张**要自己补一次 `#清空`，把上一轮对话的残留挡在外面。
  //
  // ★ 缓存键 = "**到这一处为止**的全部命令原文"，不是单看某一张围栏的原文：
  //   同一句 `线段(A,B)` 落在不同的累积状态里，冻出来是两张不同的图。
  //   ⚠ 也**不能**并进 `SR.figures` 那个缓存 —— 那边是"一张图一块干净画板"，
  //     同一条命令在两处的语义正好相反，合并了就会互相串图。
  //
  // ★ 为什么由它自己去借板（`offscreenJob`）而不是让调用方借好：
  //   借板是"把老师眼前这张原样收走、跑完原样还回来"，一次只该有一个人借。
  //   调用方（submit 收尾 / 点占位）各自借一次，边界清楚。
  var figCache = {};                       // 累计命令原文 → { url, w, h }

  // 这一串围栏**到第 n 张为止**该按哪一维画：3 还是 2。纯函数，只读字。
  //
  // ★ 判据用 `SR.ggbLooks3D` —— 跟三个选项按钮（chips.js 的 `SR.dimFromTexts`）
  //   **同一个函数**。那一处已经立过规矩：判文本、不判板子，理由是"刷新前后
  //   拿到的得是同一份证据"。这里要的是同一件事，再写一个判法就又多一个真源。
  // ★ 看的是**最后一张非空的围栏**，不是把前面拼起来：板是累积的，
  //   后写的 `#平面` 必须压过先写的 `#三维`。拼起来判的话，一轮立体作图
  //   会把这一轮后面每一张图都拽进三维。
  // ★ 一张围栏都没有 → 平面。跟 chips.js 同一条取向（往平面偏），理由见那边。
  function 该按哪维(fences, n) {
    for (var j = n; j >= 0; j--) {
      var t = String((fences && fences[j]) || '').trim();
      if (t) return SR.ggbLooks3D(t) ? 3 : 2;
    }
    return 2;
  }

  function figKeyUpTo(fences, upto) {
    // ★★ 维度**算进缓存键里**（2026-10-04）。为什么非算不可：这张图长什么样
    //   既取决于命令、也取决于"按哪一维拍"，只拿命令当键的话，
    //   本会话里已经冻好的那张**错图**会被一直命中，改完也看不出改。
    return SR.figures.key(该按哪维(fences, upto) + '\n' + fences.slice(0, upto + 1).join('\n'));
  }

  // 冻出这一轮的前 `upto+1` 张图（缓存命中就不重画）。回调拿到的数组跟 fences 等长，
  // 画不出来的那几格是 null —— 调用方据此摆占位，绝不假装有图。
  //
  // ★★ 借不到板要**重试**，不能就这么算了。原因是个时序事实：这条路是在**收流之后
  //   那一刻**发起的，而那会儿 `paint()` 刚把这一轮的围栏一排排推给画板
  //   （`SR.tabs.drawHere` 排进串行链），板十有八九正忙着 —— `offscreenJob` 一句
  //   "画板忙，没动它"就回来了，图一张都不会有，而屏幕上只是**空着**，看不出是为什么。
  //   （2026-10-03 实测：探针 ⑥ 量到 `真图数:0 / 占位数:2`。）
  function freezeFences(fences, cb, tries) {
    fences = fences || [];
    tries = tries || 0;
    var done = cb || function () {};
    if (!fences.length || !SR.board || !SR.board.offscreenJob || !SR.figures.splitLines) { done([]); return; }
    var all = function () {
      var out = [];
      for (var k = 0; k < fences.length; k++) out.push(figCache[figKeyUpTo(fences, k)] || null);
      return out;
    };
    // 全都已经在缓存里 → 连板都不用借（刷新后重画那条路常常走到这儿）
    var miss = false;
    for (var k2 = 0; k2 < fences.length; k2++) if (!figCache[figKeyUpTo(fences, k2)]) { miss = true; break; }
    if (!miss) { done(all()); return; }

    SR.board.offscreenJob(function (draw, finish) {
      var i = 0;
      (function next() {
        if (i >= fences.length) return finish({ n: i });
        var n = i, key = figKeyUpTo(fences, n);
        if (figCache[key]) { i++; next(); return; }
        var lines = SR.figures.splitLines(fences[n]);
        if (n === 0) lines = ['#清空'].concat(lines);   // ★ 只第 1 张补清空，理由见上
        // ★★ 摆正视角再画（2026-10-04）。借来的这块板是老师**眼前**那块，
        //   它可能正停在三维上——那时候几句平面命令会照着三维视图画，
        //   点全落在 z=0 的地平面上，冻出来一张"线段看不见"的立体图
        //   （孔老师截图问"这什么意思，咋是这个图"的那张）。
        //   ⚠ 用 `ensureView` 而**不是**往 lines 里塞 `#平面`：后者会顺带
        //     重置取景和网格，那是另一件事（理由见 board.js 的 ensureView）。
        if (SR.board.ensureView) SR.board.ensureView(该按哪维(fences, n) === 3);
        // ⚠ 一张张按顺序画，不并行：板只有一块，并行画 = 几张互相覆盖，
        //   每张截到的都是别人的半成品（pack.js 那边同一条）。
        draw(lines, function (ok) {
          if (!ok) { i++; next(); return; }            // 这张画不出来 → 留 null，接着画下一张
          SR.board.shoot(function (url, w, h) {
            if (url) figCache[key] = { url: url, w: w, h: h };
            i++; next();
          });
        });
      })();
    }, function (r) {
      // ★ 判据看的是 `r.res` 在不在，不是 `r.ok`：`ok` 说的是"板**还回去了**没有"，
      //   图冻出来没有是另一回事。这一趟活儿真跑完了就照收，别因为板没还原把图扔了。
      if (r && r.res) { done(all()); return; }
      // ★★ 2026-10-04：重试是给**转瞬即逝**的原因准备的（就是上面那条"画板忙，没动它"——
      //   发起的那一刻 paint 正把围栏一排排推给画板）。而 `死路` 那一档是**板卡死了**
      //   或者**这条路炸了**，重试没有意义：只会把同一个等待再赔进去四遍
      //   （原来的写法配上看门狗就是"转 30 秒 → 重试 → 再转 30 秒"×5 = 两分半白等）。
      //   死路就直接认输，让老师马上看到"图没画出来"，而不是再等两分半。
      if (r && r.死路) { done([]); return; }
      if (tries < 4) { setTimeout(function () { freezeFences(fences, cb, tries + 1); }, 900); return; }
      done([]);                       // 重试到头了还是借不到 → 老实留占位，等老师点
    });
  }

  // ---- 刷新之后，把屏幕上这些图**自己补上**（2026-10-04 加）----
  //
  // ★★ 孔老师原话：「还有就是为啥不让图直接显示出来，一定要我点一下才画出来」。
  //   他这一条站得住。原先的做法（刷新后一律留「图」那个占位、点到哪张才画哪张）
  //   是我为"别一次重画二十张把页面拖死"定的取舍，可代价是**图在那儿却不显示**——
  //   等于白画，而且老师根本不知道那儿本来有图。
  //
  // ★ 改法不是"全自动重画"，是**从最新那张往回、一张一张补**：
  //   ① 串行：`freezeFences` 本来就走 `offscreenJob` 那条串行链，一次只有一块板在借
  //      （并行画会把几张图互相覆盖，board.js / pack.js 那边同一条）。
  //   ② 从**最新**往回：最新那张通常正是屏幕上看的那张，先补它，老师一眼就有图；
  //      更早的那些慢慢往回追，追不完也不影响他看眼前这一条。
  //   ③ 已经在缓存里的**不借板**（`freezeFences` 第一段就查了缓存）——
  //      所以"点 ⟳ 切工位"那种会话内重画几乎是白跑的，不花时间。
  //
  // ★★ 三条**收手**的闸，一条都不能少：
  //   ① 换了代（`补图代`）—— 老师又问了别的、或者整屏重画了一次，
  //      这一队就不作数了。不设这道闸的话，他刚问的新图会**排在一堆旧图后面**，
  //      每条 13 秒上下，他会以为"这一轮卡死了"。
  //   ② 板正在给老师看（抽屉开着 / 放大看开着）—— 别在他眼皮底下把板一借一还，
  //      画板会一闪一闪。等他从板前走开再接着补。
  //   ③ 追到头了 —— 老实停。
  var 补图代 = 0;          // 换代 = 这一队作废（见上）
  var 补图候 = null;       // 等的那个 setTimeout（重画/收手时要 clear，不然会攒一串）

  function 停补图() {
    补图代++;
    if (补图候) { clearTimeout(补图候); 补图候 = null; }
  }

  // 板是不是正摆在老师眼前。★ 读的就是 `data-drawer` / `data-bigfig` 这两个属性本身 ——
  //   它们是那两个开关的**唯一真源**（main.js 里写得很死："只写这一个属性，
  //   开关长什么样全在 css 那两条里"），不是我从别处的状态推出来的二手读数。
  function 板在眼前() {
    var d = document.getElementById('drawer');
    if (d && d.getAttribute('data-drawer') === 'open') return true;
    if (SR.main && SR.main.bigFigOpen && SR.main.bigFigOpen()) return true;
    return false;
  }

  function 补图(队) {
    if (!队 || !队.length) return;
    停补图();
    var 代 = 补图代;
    var i = 队.length - 1;                    // ★ 从最新那张往回
    var 空转 = 0;                             // 连着让了几回没干活
    // 等一等再回来。★ `空转` 只数**连续**的空转：每真补上一张就清零。
    //   不清零的话，二十张图各让一次就撞了上限，后面十几张永远补不上，
    //   而屏幕上看不出是"放弃了"还是"还在补"（同族：数够圈数当跑完了）。
    //   上限 40 × 1.2s ≈ 48 秒 —— 追不上就老实放弃，不留一个永远在转的定时器
    //   （那比没补图更难查：页面上什么都正常，只有个计时器在后台空转）。
    // ★★ `下一步` 必须是**函数声明**（`function 下一步(){}`），**不能**写成
    //   `(function 下一步(){}())` 那种具名函数表达式。2026-10-04 当场栽过一次：
    //   写成表达式的话，`下一步` 这个名字只在自己**体内**有效，外层这个 `让一让`
    //   的 `setTimeout(下一步, …)` 里它是**未定义**的 —— 一进定时器就抛
    //   `ReferenceError`，而且死在定时器里：页面上不报错、不弹窗，探针量到的
    //   就是"补图一声不吭、图一张没出来"（当场的红是"正在出图…"从没出现过）。
    //   函数声明会提升，两个函数互相喊得到。
    function 让一让() {
      if (空转++ > 40) return;
      补图候 = setTimeout(下一步, 1200);
    }
    function 下一步() {
      补图候 = null;
      if (代 !== 补图代) return;               // 闸① 换代了
      if (i < 0) return;                       // 闸③ 追到头了
      // 闸①′ 板还没就绪。★ 这道闸非有不可，而且是**最要命**的一道：
      //   重画这条路在 `chat.init()` 里跑，而板（`board.init`，要等 GeoGebra
      //   那个 CDN 脚本落地）**排在它后面**。这时就开跑的话，`freezeFences`
      //   第二行的判据 `!SR.board.offscreenJob` 会当场 `done([])` ——
      //   它不抛错、不重试、不留痕，只是**安安静静地什么都没做**。
      //   于是这一屏的图会永远停在可点的占位上，而看代码看不出为什么
      //   （同族：探针伪造出一份世上不存在的存档格式）。
      if (!SR.board || !SR.board.isReady || SR.board.isReady() !== true) return 让一让();
      if (板在眼前()) return 让一让();          // 闸② 老师正在看板
      空转 = 0;
      var it = 队[i--];
      // 摆成"正在出图…"那一档（不是可点的那一档）：这一刻**真有人去冻了**，
      // 说出这句才是实话。冻完这儿再调一次 fillFigure 换成真图。
      for (var w = 0; w < it.boxes.length; w++) {
        if (it.boxes[w]) fillFigure(it.boxes[w], it.fences, w, '', 'wait');
      }
      freezeFences(it.fences, function () {
        if (代 !== 补图代) return;             // 等回来也可能换过代了
        for (var k = 0; k < it.boxes.length; k++) {
          // ★ 不管这一格冻上没有**都要**回来刷一次：冻上了贴图，没冻上落回
          //   那一档**可点**的「图」——老师手动点一下还有一条路。
          //   漏了这一次的话，失败的格子会永远停在「正在出图…」上，
          //   那是一句永远不兑现的承诺（当场那条路同一条纪律，见上面 freezeFences 那段）。
          if (it.boxes[k]) fillFigure(it.boxes[k], it.fences, k, '', '');
        }
        补图候 = setTimeout(下一步, 60);
      });
    }
    下一步();                                  // ★ 头一下是靠这一句点着的（不是 IIFE）
  }

  // 往**这一条气泡**里钉一块图。★ 一律 appendChild，**绝不重写 bubble.innerHTML**：
  //   重写会清掉已经摆好的 IMG、打乱 KaTeX 的排版，还废掉正文那条节流
  //   （正文靠 `v !== msg.lastVisible` 判断要不要重刷，见 paint 里那段）。
  function attachFigure(bubble, fences, idx, info, mode) {
    if (!bubble || !fences || idx < 0 || idx >= fences.length) return null;
    var box = document.createElement('div');
    box.className = 'figbox';
    box.setAttribute('data-fig', String(idx));
    if (info) {
      var cap = document.createElement('div');
      cap.className = 'figcap';
      cap.textContent = info;
      box.appendChild(cap);
    }
    fillFigure(box, fences, idx, info, mode);
    var again = document.createElement('button');
    again.type = 'button';
    again.className = 'figagain';
    // ★★ 2026-10-04 改名（孔老师原话：「也不应该叫"再摆弄"，这个说法太随意了」）。
    //   改成「放大看」的理由：这个按钮在课上就干**一件事**——把这块板弄大、
    //   弄到全班看得见。名字照着那件事说，别用一个只有我自己懂的词。
    again.textContent = '放大看';
    again.addEventListener('click', function () {
      // ★ 摆的是**这一条为止的累积状态**，不是光这一张：老师点图上的按钮，
      //   要的是"这张图当时那块板"，接着往下弄。只放最后一张围栏的话，
      //   他会看到"连接 AB"里没有 A、B —— 跟图不一致。
      var lines = SR.figures.linesOf(fences.slice(0, idx + 1).join('\n'));
      // ★★ 2026-10-04：从"拉开右边抽屉"改成"中央蹦一个大窗"（孔老师提的）。
      //   原来的问题是侧栏只有 min(520px, 42vw)，投影到教室那头屏幕上，
      //   图里的点、标注全小得看不清 —— 而老师点这个按钮的**唯一**理由
      //   就是要给学生看。开大窗这一步只搬板、不动这块板上的内容
      //   （见 js/main.js 的 openBigFig：搬的是 `.boardwrap` 那一块本身）。
      if (SR.main && SR.main.openBigFig) SR.main.openBigFig();
      // ★★ 摆正视角再画（2026-10-04，跟上面 freezeFences 那条同一个病）：
      //   这几句命令是**平面**的，而板可能正停在三维上——照着三维画，
      //   点全落在 z=0 的地平面上，老师在大窗里看到的是一张"线段不见了"的立体图。
      //   点「放大看」的这条跟冻图那条是两处独立的作画，所以两处都得摆。
      if (SR.board && SR.board.ensureView) SR.board.ensureView(该按哪维(fences, idx) === 3);
      // ★★ 这一遍走**快档**（`{快:true}`），别按 550ms 一条慢慢长（2026-10-04）。
      //   孔老师原话：「打开大窗口以后，之前的图也没有出来啊，就是一个空白的画板啊。」
      //   量出来的病根就在步长（`test/_enlarge.cjs`，走的是他这个按钮、不是我调 openBigFig）：
      //     点之前 板上 [] 墨 0 → +1s 大窗已经开了，画布**全白**（墨 0）
      //     → +2s 才见 A、B → +4s 才见 s、m。中间那一两秒，就是"空白的画板"。
      //   他要的是**点开就看见图**，不是再看它长一遍 —— 慢慢长那遍他在聊天里已经看过了。
      if (SR.board && SR.board.run) SR.board.run(lines, { 快: true });
      if (SR.tabs && SR.tabs.reset) SR.tabs.reset();   // 这一块板从此是老师在弄，页签重记
    });
    box.appendChild(again);
    bubble.appendChild(box);
    // ★ 有产物 → 气泡**定宽**，不再由内容撑。理由见 CSS 里 `.hasprod` 那段：
    //   不定宽的话，"刷新后那一格占位"顶不动气泡（它没有图片那种固有宽度），
    //   气泡会瘪成文字的宽度（实测 177px），占位跟着瘦成一条；等老师点一下、
    //   图真出来了，气泡**啪地弹到 880** —— 一屏之内跳一次，看着像出了故障。
    bubble.classList.add('hasprod');
    return box;
  }

  // 把图填进这块 `.figbox`：会话内有缓存就贴图，没有就先摆一个占位。
  //
  // ★★ 占位分**两档**，靠 `mode` 分（2026-10-04 加，孔老师那句"要保证出图顺畅"）：
  //   `mode === 'wait'` = "正有人去冻呢"。收流那条路（chat.js 底下那几十行）
  //     在**摆框的那一刻**就用这一档，然后才去冻图。理由是一个实测的时序：
  //     从借板到截图回来要 **13 秒上下**（探针量的：+10s 还占着位，+15s 真图才到）。
  //     这十几秒里原先写的是「图 / 点一下画出来」——**没有在出图的信号**，
  //     而且那句 title 反着指路，叫老师去点一个已经在跑的东西。
  //   `mode` 缺省 = "没人管，点一下才画"（刷新后重画那条路走的就是这儿，
  //     见 repaintLog；以及冻图**失败之后**回落到这一档，给老师留一条手动路）。
  //     这样"刷新一次就把二十张图全重画一遍"这件事不会发生 —— 点到哪张才画哪张。
  //
  // ★ 两档都是 `.figph` 这个类名，只有 `pending` 这一个额外的类分档：
  //   外面那些探针（probe_stream、_q_* 那一批）数的是 `.figph` 的**个数**，
  //   "还没有真图"这件事在两档里都成立，所以它们量到的意思不变。
  function fillFigure(box, fences, idx, info, mode) {
    var key = figKeyUpTo(fences, idx);
    var cached = figCache[key];
    var old = box.querySelector('.figimg, .figph');
    if (old) box.removeChild(old);
    if (cached && cached.url) {
      var im = document.createElement('img');
      im.className = 'figimg';
      im.src = cached.url;
      im.alt = info || '这一轮的图';
      box.removeAttribute('data-empty');          // ★ 画出来了就把"还空着"这个标摘掉
      box.insertBefore(im, box.firstChild);
      return;
    }
    if (mode === 'wait') {
      // ★ 不给它挂 click，也不写 title：这一格此刻**不该被点**（点也只会被
      //   `data-busy` 挡回来，反而更像坏了）。冻图那趟活儿跑完，调用方会拿
      //   真结果再调一次本函数，那时要么贴图、要么落到下面那一档可点的。
      var wph = document.createElement('div');
      wph.className = 'figph pending';
      wph.textContent = '正在出图…';
      box.insertBefore(wph, box.firstChild);
      box.setAttribute('data-empty', '1');         // 仍归"还空着"这一档
      return;
    }
    var ph = document.createElement('div');
    ph.className = 'figph';
    ph.textContent = '图';
    ph.title = '点一下画出来';
    ph.addEventListener('click', function () {
      if (ph.getAttribute('data-busy')) return;
      ph.setAttribute('data-busy', '1');
      ph.textContent = '正在画…';
      freezeFences(fences.slice(0, idx + 1), function (got) {   // ★ 累积：前面几张一并冻
        ph.removeAttribute('data-busy');
        var f = got && got[idx];
        if (!f) { ph.textContent = '图没画出来'; return; }
        // 顺带把前面几张也填上（这一趟本来就把它们一起冻了，白扔可惜）
        var sibs = box.parentNode ? box.parentNode.querySelectorAll('.figbox') : [];
        fillFigure(box, fences, idx, info);
        for (var s = 0; s < sibs.length; s++) {
          var j = sibs[s].getAttribute ? Number(sibs[s].getAttribute('data-fig')) : NaN;
          if (!isNaN(j) && j < idx) fillFigure(sibs[s], fences, j, '');
        }
      });
    });
    box.insertBefore(ph, box.firstChild);
    box.setAttribute('data-empty', '1');           // 还空着（图上那句"正在画…"也归这一档）
  }

  // ---- 把这一条回复里的几张图，各自钉回**它自己那道题下面** ----
  //
  // ★★ 2026-10-03 加（自己上网页走了一遍看出来的）。
  //   原先几张图是**一股脑 append 在正文末尾**的：命题工位一轮出三个变式，
  //   屏幕上就是"三段题面 + 答案"接"三张图"，而三张图还多半长得差不多
  //   （都是数轴，只差几个点）。谁是谁全靠数第几张——老师要的是
  //   "这一道题的图"，不是"第 2 张图"。
  //
  // ★ 做法只改**插在哪儿**，不动任何一块图的内容、也不重排正文。
  //   拿原文当尺子，**不拿渲染好的 DOM 当尺子**——marked 会把 `**变式二**` 的星号
  //   吃掉、把几行并进同一个 <p>，DOM 里的行跟原文的行对不上号；
  //   而原文里"围栏从哪儿到哪儿"是确定的。
  //
  // ★ 锚点怎么定：**数它前面有几道变式**。
  //   某张图在原文里，前面已经排了几道「变式」标题，它就属于第几道题；
  //   要插的位置就是**再下一道变式的前面**（这一道的答案之后）。
  //   所以只需要一个数 k = 该围栏之前出现过的「变式」标题个数，
  //   落在正文里就是"第 k+1 块变式"（0 基下标 k）。
  //
  // ⚠⚠ 第一版是**拿标题的文字去 DOM 里找**同名的那一块（"找到第一个以
  //   `变式二（改条件）`开头的块"）。拿真存档一量就破了：
  //   命题工位一轮常常写**两组**变式（【第一种·题里有图】三个 + 【第二种·题里没图】三个，
  //   实测 8 份存档里 7 份是这样），**两组的标题文字一模一样**——
  //   于是"找第二组的变式二"永远找到第一组那一块，图被插到第一道题下面。
  //   （存档 `test/_shot/vfC-8.txt` 就是这一格，`test/probe_figplace.cjs` 盯着它。）
  //   改成**按序号对位**：正文里第 j 块"以变式开头"的块，就是原文里第 j 道题。
  //   序号天然不会有歧义，而文字会重名。
  //
  // ★ 为什么必须数"原文里的标题"而不是"DOM 里的标题"：
  //   【第一种…】【第二种…】那两行会被 render.js 规则四从**看得见的正文**里删掉，
  //   所以 DOM 里根本没有"组边界"这个东西可锚。
  //
  // ⚠ 兜底两条，都是"宁可照老样子摆，也绝不把图弄丢"：
  //   ① 对不上号（一道变式标题都没有 / 变式的标题和正文挤在同一个 <p> 里，
  //      DOM 里压根没有"下一道变式"这一块可插）→ 退到「复制这段」那条 bar 前面；
  //   ② 连 bar 都没有 → 原地不动（留在末尾）。
  var RE_FENCE_GGB = /```[ \t]*ggb[ \t]*[^\r\n]*\r?\n[\s\S]*?```/g;
  var RE_VHEAD = /(^|\n)[ \t>*#]*变式[一二三四五六七八九十0-9]+[^\n]*/g;
  var RE_VBLOCK = /^变式[一二三四五六七八九十0-9]/;
  // 两边都归一化再比：原文里有 `**变式二**`，DOM 里只剩 `变式二`，星号空格井号一律不算数
  function normHead(s) { return String(s == null ? '' : s).replace(/[\s*>#]+/g, ''); }

  function placeFigures(bubble, raw, boxes) {
    if (!bubble || !raw || !boxes || !boxes.length) return 0;
    var t = String(raw), ends = [], m, j;
    RE_FENCE_GGB.lastIndex = 0;
    while ((m = RE_FENCE_GGB.exec(t))) ends.push(m.index + m[0].length);
    // 每个「变式」标题在原文里的位置（要按位置数，不能只看总数）
    var 位 = [];
    RE_VHEAD.lastIndex = 0;
    while ((m = RE_VHEAD.exec(t))) {
      if (normHead(m[0])) 位.push(m.index + m[0].indexOf('变'));
      if (RE_VHEAD.lastIndex === m.index) RE_VHEAD.lastIndex++;   // 防零宽死循环
    }
    // 正文里"以变式开头"的那几块，按顺序排好 —— 第 j 块就是第 j 道题
    var kids = bubble.children, domHeads = [];
    for (j = 0; j < kids.length; j++) {
      if (kids[j].classList && kids[j].classList.contains('figbox')) continue;
      if (RE_VBLOCK.test(normHead(kids[j].textContent))) domHeads.push(kids[j]);
    }
    var cb = bubble.querySelector('.copybar'), moved = 0;
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      if (!box || ends[i] == null) continue;
      var k = 0, h;
      for (h = 0; h < 位.length; h++) if (位[h] < ends[i]) k++;
      var anchor = domHeads[k];          // 第 k 块 → 插在它前面（= 上一道题之后）
      if (!anchor) { if (!cb) continue; anchor = cb; }
      bubble.insertBefore(box, anchor);
      moved++;
    }
    return moved;
  }

  // 打包的账本（js/pack.js）照记忆重建一份。
  // ★ 不重建的后果：刷新之后点「打包」，打出来的包里只有刷新之后那几轮——
  //   而包看着是完整的，只有老师知道少了半场。
  //
  // ★★ 2026-10-05：重建的**不只是**助手那几段，还要把"问"一起捡回来。
  //   账本从今天起一条存两样：老师的问（`ask`）+ 助手的答（`visible`/`ggb`），
  //   因为绿行那套勾选是**一问一答成对**带走（孔老师定的：勾一条答，
  //   把上面那句问一起装走——单拎一段答案出来"回的是什么"就丢了）。
  //   ⇒ 刷新之后若只重建答不重建问，勾出来的包跟没刷新时勾出来的**不是一个东西**，
  //     而两份包看着都正常。同 `restoreText` 那条规矩：同一个事实两处各算一遍，
  //     就得两处都算对。
  //
  // ⚠ `ask` 的取法：顺着记忆往下走，**记住最后一条 `r === 'u'`**，摊给后面每一个 `a`。
  //   不能只看"紧挨着上一条"，因为助手回复跟老师的话中间还夹着收料单／分界线那种
  //   `r` 不是 `'u'` 的条目（见 js/memo.js）；也不能取最早那条（那样第二问之后
  //   所有答案都挂着第一问）。"最后一条老师的话"就是老师心里那句问。
  //   ⚠ 顺序也要跟 repaintLog 里挂 `data-turn` 的那一处**完全一致**（那边也是
  //     `if (list[i].r !== 'a') continue;`），错开一位，绿行勾第 3 条会勾中第 4 条。
  function seedPack() {
    if (!SR.pack || !SR.pack.__seed) return;
    var w = (SR.WORKS && SR.WORKS[work]) || {};
    var list = SR.memo ? SR.memo.log() : [];
    var rows = [], ask = '';
    for (var i = 0; i < list.length; i++) {
      if (list[i].r === 'u') { ask = String(list[i].t || ''); continue; }
      if (list[i].r !== 'a') continue;
      var p = SR.render.parseFences(list[i].t, { stripAssign: !!w.stripAssign, 收尾: true });
      rows.push({ visible: p.visible, ggb: p.ggb || [], ask: ask });
    }
    SR.pack.__seed(rows, (SR.memo && SR.memo.pocket().topic) || '');
    // ★ 绿行上那两颗按钮（「选择内容」/「打包 (N)」）跟着账本走：账本重建完，
    //   计数要重算一次，而且此刻若正开在挑选模式里，勾选框也得照新账本重新摆。
    if (SR.packui) SR.packui.sync();
  }

  function reset(newWork, opts) {
    work = newWork || work;
    局面数++;          // ★ 换工位／点 ⟳ = 翻篇了：自修那一趟要等的"原来那一局"没了（见文件开头 局面数）
    // ★★ 2026-10-06：「修改」挂起来的那一刀，到这儿作废。
    //   它挂的是"从**第几条**重来"，而这个号是照账本数的 —— 换工位／点 ⟳
    //   之后账本换了（⟳ 还会整个清空），那个号指向的就是**别人**了。
    //   挂着一个已经指错地方的号，比不挂危险得多：老师下一句一发，
    //   被丢掉的是一段他根本没想动的话。
    //   （同族教训见记忆「检测脚本的数字不是它宣称的那件事」：号本身没错，
    //    错的是它量的那个东西已经换人了。）
    pendingTrunc = null;
    // ★★ 只有 ⟳ 走这一条（main.js 传 {wipe:true}）。
    //   切工位、刷新页面**都不许清**——清空是一个动作，不是切工位的副作用。
    //   （见 js/memo.js 顶上那三条。孔老师的原话：「除非我靠一个刷新按钮给他清了」。）
    if (opts && opts.wipe && SR.memo) SR.memo.clear();
    history = (SR.memo ? SR.memo.history() : []).slice();
    // ★ 打包的账本跟着这场对话一起清。不清的话，换了工位／点了 ⟳ 之后，
    //   新对话里点「打包」会打出一个**混着上一场图和文字**的包——
    //   而包里的东西看起来都正常，只有老师知道不对。
    //   ⚠ 上面那句"清"跟这一句不矛盾：清了之后下面 seedPack() 又从记忆里重建一份。
    if (SR.pack) SR.pack.reset();
    els.msgs.innerHTML = '';
    clearChips();
    // ★★ 2026-10-06：右栏这四件（清板／多页复位／让开导图）**不是每一趟都要做**。
    //
    //   谁走 `keepBoard`：「重新发送」和「修改文字」截断之后那一趟。
    //   它们跟 ⟳ 长得像（都是"这一场从头摆一遍"），但**不是同一件事**：
    //   ⟳ 是"这一课重开"，板当然该空；截断是"我第 3 句说错了，从第 3 句重来"——
    //   前三轮画的图**是对的、还要用**，老师可能还在上面手画了两笔。
    //   照 ⟳ 那样清掉，等于拿"我要改一句话"换"我刚摆的教具全没了"，比不改还糟。
    //   ⚠ 代价说清楚：被截掉那几轮画在图上的东西**留在板上**（板不会自己回退）。
    //     这是两个坏结果里较轻的那个 —— 板是累积的（见 freezeFences 那段），
    //     它从来没有"回到某一轮"这个能力；真想要那块干净的，
    //     ⟳ 就在手边，那才是它的活儿。
    if (!(opts && opts.keepBoard)) {
      SR.board.clear();
      // ★ 顺序不能反：**先把画板清干净，再让多页那边记下"开场那一页"**。
      //   反过来的话，那一页的存档记的是上一条链子最后那张图——老师点 ⟳ 换了工位，
      //   一开场就有一页带着上学期的图，而且他会以为是这一课画出来的。
      if (SR.tabs) SR.tabs.reset();
      // 导图让开，回那块干净的画板。★ 换工位／点 ⟳ 之后开场就是"一张空画板"，
      //   这时候导图上只剩「还没有东西」一句——留着它盖在画板上，
      //   老师第一眼看到的是那块空白而不是开场白。
      //   ⚠ 不用在这儿 refresh：关掉之后它的盒子是 0 宽，refresh 自己会返回；
      //     真要看它，点开「导图」那一下 show() 会现算一次（数据也是现读 pack 的账）。
      if (SR.mm) SR.mm.yieldToBoard();
    }
    // ⚠ keepBoard 那一趟**也不动导图**：导图读的是 pack 的账（见 mm.js），
    //   而 pack 上面已经 reset+seedPack 过了 —— 它是自己重算的，不用人去推。
    // 这一场还有东西 → 摆回来；记忆是空的才拿开场白开张。
    if (repaintLog()) seedPack();
    else { history = []; addAssistantText(OPENING[work] || OPENING.prep); }
    // 输入框里的提示也跟着工位走。
    // ★ 原来那句"贴一道题，或者写一个课题，例如 3.1 代数式的值"是**写死在 index.html** 里的，
    //   于是切到「出材料」时它还挂在那儿——**提示的是一个这个工位不接的用法**。
    //   提示语是老师唯一一定会读到的一句话，写错了比没有更坏。
    if (els.input) els.input.placeholder = tipFor(work);
    // ★★ 2026-10-02 改：备课工位**一进来也不点亮任何一节了**（原来点着「复述」）。
    //   理由：链子从哪一节起、一共几节、每节叫什么，现在都得等它先报出来——
    //   第一轮给的是"几路"（学生可能有哪几种错法），链子还没开始摆。
    //   一进来就摆出"复述／定位／追问"六格、第一格还点着，
    //   老师会以为现在就该按这个走，而那正是被改掉的那套固定五节。
    hideStepBar();
    // ★ 摆回来的那一场，链子进度条得**按整段历史重推**（不然刷新一下条子就空了，
    //   而链子还在对话里——老师会以为要重头再走一遍）。
    //   repaintSteps 里量到没有节标题就自己把条子藏了，空场调它是安全的。
    repaintSteps();
    setStatus('');
    els.input.focus();
  }

  // ---- 链子进度条 ----
  // ★ 「一条链子一节一节摆出来」是这个工位的核心交互，所以它得**看得见**。
  //   走到第几节由 SR.parseChain 从那行节标题里读出来（纯前端，别让模型另写档号——
  //   理由见 chips.js 那一段），这里只负责画。
  // ★ 点某一格 = 把链子推到那一节（SR.stepJump），发的是人话不是魔法符号：
  //   小模型吃自然语言比吃 `JUMP=4` 稳，而且这句话留在 history 里下一轮还看得见。
  //
  // ★★ 2026-10-02 改：原来是**固定六格**（复述/定位/追问/给台阶/肯定/整条），
  //   现在步数和名字由模型按这道题自己定，条子照**已经摆出来的**那些节画。
  //   状态就三个：
  //     stepSlots —— 已经摆出来的节，[{n, name}]
  //     stepPlan  —— 它第一轮报的"大概几步"，只用来在末尾补几格**灰格**（预排）
  //     stepNow   —— 现在停在第几节
  //   ★ 灰格是**预排、不是事实**，而且**只增不减**：它报了 4 步却走到 6 步，
  //     槽位就长到 6；报了 5 步只走到 3 步，那三格照样在——
  //     **绝不把已经摆出来的节藏起来**，老师看得见的东西不能说没就没。
  //     计划整个读不出来 → 一格灰格都不画，退回一格「▶ 接着摆」兜着。
  //   ⚠ 这两条规矩（只增不减 / 计划只认第一次报的）**写在 js/chips.js 的 SR.absorbChain 里**，
  //     不在这儿：那边是纯函数，test/probe_chain.cjs 能量到。这里只管画。
  var stepSlots = [], stepPlan = 0, stepNow = 0;

  // 把这一段回复"吃"进槽位里。**只加不减**。
  // ★ 逻辑本身在 js/chips.js 的 SR.absorbChain 里，这里只做一次变量搬运——
  //   这么放的唯一理由是**让 test/probe_chain.cjs 能量到它**（那边没有 DOM，
  //   在 node 里直接拿假回复喂纯函数）。写在 chat.js 里就只能靠肉眼看。
  function absorbChain(text) {
    if (!SR.absorbChain) return;
    var st = SR.absorbChain({ slots: stepSlots, plan: stepPlan, now: stepNow }, text);
    stepSlots = st.slots; stepPlan = st.plan; stepNow = st.now;
  }

  // 藏起来，并把状态清空。★ 走这个而不是"画一个空的"：
  //   备课／讲评**一进来就不该有条子**——第 1 节叫什么、一共几步，
  //   都得等它先报出来（讲评还得先列题号、等老师挑一道）。
  //   一进来就摆出六格、第一格还点着，老师会以为现在就该按这个走。
  function hideStepBar() {
    stepSlots = []; stepPlan = 0; stepNow = 0;
    var box = $('steps');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  }

  // 照着当前状态画。**只画，不改状态**——状态由 absorbChain / repaintSteps 管。
  function renderSteps() {
    var box = $('steps');
    if (!box) return;
    var w = (SR.WORKS && SR.WORKS[work]) || {};
    if (!w.steps || !stepSlots.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = '';
    box.innerHTML = '';               // ★ 每次都重建：格数会变，旧版"只建一次"的做法作废了

    function mk(label, sd, cls) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'stepbtn' + (cls ? ' ' + cls : '');
      b.setAttribute('data-step', sd);
      b.textContent = label;
      // ★ 2026-10-02：title 跟 SR.stepJump 的措辞一起改（原来写的是「接着往下摆」「把链子摆到这一节」）。
      //   老师对着一格上的名字点下去，看到的提示词得说"走到那个环节"，不能又说"摆第 N 节"。
      b.title = (sd === 'close') ? '把整条链子一次给我，好整段拷走'
        : (sd === 'next') ? '接着往下走'
          : (sd === 'project') ? '放大成一屏一节，投到教室给全班看（← → 翻页，Esc 退出）'
            : '把链子走到这个环节';
      // ★★ 2026-10-03：「投影」这一格跟旁边所有格子**不是一类**，它必须在这条
      //   分支上被截住，不能掉进 stepGo。
      //   旁边每一格点下去都是"给模型发一句话"（stepGo → SR.stepJump → submit）；
      //   这一格是**纯前端换一种放映方式**——一个字都不发出去、不花额度、不改对话。
      //   掉进 stepGo 的后果是 `SR.stepJump('project')` 返回空串，看着就是"点了没反应"，
      //   而真正想看的那一层永远不出现，屏幕上一句报错都没有。
      b.addEventListener('click', function () {
        if (sd === 'project') { if (SR.project) SR.project.open(); return; }
        if (!busy) stepGo(sd);
      });
      box.appendChild(b);
      return b;
    }

    for (var i = 0; i < stepSlots.length; i++) {
      var s = stepSlots[i];
      // .now = 正在这一节（主色 + 下划线）；.done = 已经走过（实心）。
      // ★ 这两个类名跟 css/main.css 的 #steps 那一节是一对，改一处忘一处就对不上。
      // ★ 按**节号**判，不按格子位置判：槽位是动态长出来的，位置会变，节号不会。
      var b = mk(s.name, s.n, s.n === stepNow ? 'now' : (s.n < stepNow ? 'done' : ''));
      if (s.n === stepNow) b.setAttribute('aria-current', 'step');
    }
    for (var k = stepSlots.length; k < stepPlan; k++) mk('待定', k + 1, 'todo');
    // 「▶ 下一环节」兜着——**只要没走到计划尽头就一定有得点**。
    // ★ 判据是 `槽位 >= 预排`，不是原来那个 `!stepPlan`：
    //   旧写法下"摆了 2 节、当初没报计划"这种情况，预排被补齐成 2 = 槽位 2，
    //   于是灰格补 0 格、「接着摆」也不画 —— **条子上一个能往前走的格子都没有**，
    //   老师只能离开条子去点底下那句话。条子看得见却走不动，比不画还坏。
    //   现在：没报计划 → 一直有个「接着摆」；报了计划还没走完 → 点末尾那格灰的就行。
    // ★ 2026-10-02：这一格原来写的是「▶ 接着摆」。孔老师选的动词是「下一环节」
    //   （原话「摆一节，这个摆是什么鬼意思」）——按钮上就直接用他那个词。
    if (stepSlots.length >= stepPlan) mk('▶ 下一环节', 'next', 'todo');
    // 「整条」永远在最后：它是这个工位的终点动作（链子的产物就是能拷走的一段文字）。
    mk('整条', 'close', '');

    // ★★ 2026-10-03 新增「⛶ 投影」：上课现用的大字视图，一屏只放一节（见 js/project.js）。
    //   判据是「**现在真的放得出东西**」——`SR.project.can()` 数的是已经落盘的节。
    //   ⚠ 为什么不直接"这个工位支持投影就算数"：这条台阶条只有摆出链子之后才画得出来
    //     （上面 `!stepSlots.length` 那句就 return 了），按理 can() 必然为真；
    //     可**万一**为假（memo 被清过、只剩屏幕上那几个字），点下去就是一颗死按钮。
    //     宁可不画它，也不能给老师一颗点了没反应的格子——这就是用 can() 而不是硬写 true 的道理。
    if (SR.project && SR.project.can()) mk('⛶ 投影', 'project', 'proj');
    // 投影开着的时候，链子每往前走一节，那一屏跟着走（关着时它自己是一句 return）。
    if (SR.project && SR.project.refresh) SR.project.refresh();
  }

  function stepGo(sd) {
    var say = SR.stepJump ? SR.stepJump(sd) : '';
    if (!say) return;
    clearChips();
    submit(say);
  }

  // 「老师说了这句话」——就是把一句话当老师打的字发出去。
  //
  // ★★ 2026-10-02 为思维导图开的口（js/mindmap.js 的 onClick：点一条淡下去的
  //   岔路 = "换这条走"）。它和台阶条点一格（上面那个 stepGo）走的是**同一条路**：
  //   一句人话丢进 submit，照常进 history、照常发给模型。
  //   ⚠ 别再开一个"直接改状态"的口子（比如直接把 stepNow 拨过去）：那样这句话
  //     就不在 history 里，下一轮模型看不见老师刚换了路，会接着按旧那条讲下去——
  //     而且这种错**当场看不出来**，要等它讲到第二节才发现跟导图上选的路对不上。
  //   ⚠ 名字没叫 `say`：上面 stepGo 里已经有个局部变量叫 `say`，同名会把它盖住
  //     （JS 里变量声明优先于外层的函数声明），那边那句 `SR.stepJump(sd)` 还在，
  //     但读的人会以为两处是同一个东西。对外仍然叫 `SR.chat.say`。
  function teacherSays(text) {
    var s = String(text || '').trim();
    if (!s) return false;
    // ★ 2026-10-06：点导图上那条岔路 = 老师**自己另起了一句**，跟「修改」挂起来
    //   那一刀没有关系了。不卸的话，他点一下岔路，"从第 N 条重来"会照样落下 ——
    //   丢掉的是他根本没打算动的几轮，而屏幕上看着就是"点了条岔路，对话少了一截"。
    pendingTrunc = null;
    clearChips();      // 换了路走，上一轮那几颗「接着问」就不作数了
    submit(s);
    return true;
  }

  // 换了工位之后把这一条重画一遍。★ 导出给 main.js 用：
  //   它管"切工位要不要清对话"这条规则，但**台阶条不能只清不清**——
  //   备课↔讲评是同一条链的两个阶段，历史和档位都得留着，重新推一次就行。
  // ★★ 这里**必须遍历整段 history**，不能像原来那样只看最后一条：
  //   切过去之后最后一条很可能正是"先列一下题号"那一轮（没有节标题），
  //   只看它，前面摆过的几节就全丢了。
  function repaintSteps() {
    var w = (SR.WORKS && SR.WORKS[work]) || {};
    if (!w.steps) { hideStepBar(); return; }
    stepSlots = []; stepPlan = 0; stepNow = 0;
    for (var i = 0; i < history.length; i++) {
      if (history[i].role !== 'assistant') continue;
      var t = String(history[i].content || '');
      absorbChain(t);
      // 停在第几节：**最后一条真正摆过链子的**回复说了算。
      // 中间那些"先列一下题号""按你说的改了一句"的回复读出来是 0，不许把指针拖回去。
      var c = SR.inferStep({ prevAssistant: t });
      if (c) stepNow = c;
    }
    renderSteps();
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
    // ---- 老师这一条底下那根小条（2026-10-06）----
    // 复制 / 修改 / 重新发送。★ 三件都挂在**这条消息自己**底下，跟「复制这段」
    // 挂在助手气泡里是同一条道理：它们办的是"对**这一条**做点什么"。
    // ⚠ 传进去的是**闭包里的 text/parts**，不是等点击时再去 DOM 上读字：
    //   气泡里这会儿还多了这根小条自己（"复制修改重新发送"六个字），
    //   从 textContent 上读回来的是一串掺了按钮名的东西，
    //   而它看着完全正常——重发出去的会是一句谁也没说过的话。
    attachUserActs(el, b, text, parts);
    els.msgs.appendChild(el);
    scroll();
    return el;
  }

  function scroll() { els.msgs.scrollTop = els.msgs.scrollHeight; }

  // ---- 出题工位的「图 1 / 图 2 / 图 3」切换器：**2026-10-02 拿掉了** ----
  //
  // 它原来的作用是给"画板只有一块"打补丁：一轮三张图，只画第一张，其余靠点。
  // 右栏多页上线之后这个补丁本身成了毛病：
  //   · 不点就永远没画过——而老师不知道底下还压着两张（"每个变式都配图"成了空话）；
  //   · 它长在**气泡里**，往回翻三屏才点得到，按钮上写"图 2"——
  //     老师要的是"刚才那张数轴"，不是"第几条回复的第 2 张图"。
  // 现在每个围栏直接进右栏自己的一页（`SR.tabs.drawHere`），顺序就是讲题顺序，
  // 全部同时活着，点标签就回去。**别把这个切换器加回来**——两个门通同一件事，
  // 早晚会一个画着 A、另一个高亮着 B。
  // （`css/main.css` 里 `.figsw/.figbtn` 那段留着：右栏标签的形状是照它做的，
  //   注释里写着为什么，删了那段注释就没地方挂了。）

  // ---- 备课／讲评：把这一段拷走 ----
  // ★ 「关于」里一直写着一句"备好的追问链可以「复制这段」带走"，
  //   可**这个按钮根本不存在**（2026-10-02 才补上）。
  //   备课／讲评这两个工位的产物就是**一段文字**——老师要把它贴进教案、学案、
  //   备课组的共享文档里。没有这个按钮，他只能用鼠标划选，而气泡里的字是连着的，
  //   一不留神就把上一轮的一起划进去，或者漏掉最后一行。
  // ★ 为什么**每一条回复都挂**、而不是只在末尾挂一个总按钮：
  //   链子是**一节一节摆**出来的，他摆到第三节想先把这三节拷走也完全合理。
  //   挂的位置跟出题工位的「图 1 / 图 2 / 图 3」一样，都是挂在气泡里的
  //   （见上面 attachFigSwitch 那段）——切换的是"这一条回复"，它属于那条回复。
  //   ★★ 2026-10-05：这条 bar 上原来**还有一颗「打包」**，撤了，搬到绿行
  //     （`#onep`，见 js/packui.js）。孔老师原话：「打包按钮就应该放在这个绿行才对，
  //     放对话里面干什么。」——他说得对，而且 `js/pack.js` 顶上从第一版就写着
  //     它是**会话级**的（包里装的是从头到点击处为止全部的图和全文），
  //     可按钮挂在这儿，跟真正"这一段"的「复制这段」并排，位置在说"这是这一条的东西"。
  //     搬走之后两个刻度各归各位：**这一段 → 这儿；这一份 → 绿行**。
  //   ⚠ 这一颗**留着**，别顺手也搬走：它拷的确实是**这一段**（`t` 就是这条气泡上的字），
  //     挂在这儿是对的。
  //   ⚠ `turn` 也不再是"给打包按钮的序号"了，但**别删**——它现在没用处，
  //     留着是为了别让下面两处调用点看着像"这个参数可以省"：绿行那套勾选
  //     要的是**同一个号**，而那个号只在这两处现成（`data-turn`，见调用点）。
  // ---- 这几颗上的**图标**（2026-10-06）----
  //
  // ★★ 孔老师：「这个很丑啊，为啥不是deepseek那种图标类型的，是文字"复制"什么的」。
  //   原来这几颗是带框的文字按钮——一条消息底下横着「复制 修改 重新发送」八个字，
  //   一屏十几二十条消息，等于一屏全是带框的字，比正文还抢眼。改成图标。
  //
  // ⚠ **只能内联 SVG**：这个站是纯静态、无构建、不引外部图标库（红线，见 README）。
  // ⚠ 下面这几个串是**写死的字面量**，一个变量都不掺。它们进 `innerHTML` 是安全的，
  //   也不跟"用户的话只走 textContent"那条规矩打架——那条规矩防的是把**用户的话**
  //   当 HTML 解析，而这儿压根没有"话"（用户的话进的是 `aria-label` / `title`）。
  // ⚠ 统一 `viewBox="0 0 24 24"` + `stroke="currentColor"` + `fill="none"`：
  //   颜色和尺寸都归 CSS（`.copybtn` / `.copybtn svg`），所以同一个串在哪儿都能用。
  //   `stroke-width` 1.7 是**按 15px 那个尺寸挑的**——缩下去约合 1.06px，
  //   再细一档在 1x 屏上会断成一节一节的虚线（这个站有一半人用 1x 屏）。
  // ⚠ 每颗 svg 都挂 `aria-hidden="true"`：图标对读屏是噪音，
  //   该念的那句话由按钮自己的 `aria-label` 说（见下面 动作条）。
  var SVG头 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var 图标 = {
    // 两张叠着的纸
    复制: SVG头 + '<rect x="9" y="9" width="12" height="12" rx="2.5"/>'
      + '<path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"/></svg>',
    // 一支斜着的笔
    修改: SVG头 + '<path d="M4.5 19.5V16L14.5 6a2.1 2.1 0 0 1 3 3l-10 10H4.5z"/>'
      + '<path d="M13.5 7l3 3"/></svg>',
    // 一个绕回来的箭头
    重新发送: SVG头 + '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>'
      + '<path d="M21 3v5h-5"/></svg>',
    // 反馈用的两颗：拷成了 / 没拷成
    好了: SVG头 + '<path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    没成: SVG头 + '<path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>'
  };

  // 按下去之后**换一颗图标**闪一下。
  //   ★ 为什么不写字（原来「复制好了」是写进按钮里的）：这几颗是**定宽 28px** 的
  //     （见 css 的 `.copybtn`），一写字就撑宽，旁边两颗跟着挪——
  //     而鼠标正停在旁边那颗上面。这条老账见 css 里 `.copybar` 那段
  //     「宁可多留一行的空，也不要按钮在手底下动」。
  //   ★ 说不出口的那半句（"为什么没拷成"）走 `setStatus`——底下那行状态条
  //     本来就是产品里"有事要说"的地方，塞不进一颗 28px 的方按钮。
  //   ⚠ 闪完**必须换回来**，而且 `aria-label` / `title` 要一起还原，
  //     不然鼠标停上去还写着"复制好了"。
  function 闪图标(btn, 名, 多久) {
    var 原图 = btn.innerHTML, 原名 = btn.getAttribute('aria-label'), 原提示 = btn.title;
    var 新名 = (名 === '好了') ? '复制好了' : '没拷成，手动选一下吧';
    btn.innerHTML = 图标[名];
    btn.setAttribute('aria-label', 新名);
    btn.title = 新名;
    btn.className = (名 === '好了') ? 'copybtn done' : 'copybtn';
    setTimeout(function () {
      btn.innerHTML = 原图;
      if (原名 == null) btn.removeAttribute('aria-label'); else btn.setAttribute('aria-label', 原名);
      btn.title = 原提示;
      btn.className = 'copybtn';
    }, 多久 || 1600);
  }

  // ---- 气泡底下那根小条：唯一的造法（2026-10-06）----
  //
  // 老师的气泡和数根的气泡共用它，只是上面摆的"颗"不一样（见 attachUserActs / attachCopy）。
  // ★ 合到一处是为了**形状一样**：同一根条、同一档**尺寸**、同一个浮现时机。
  //   两边各写一遍的话，按钮会慢慢长得不一样，而"不一样"只在并排看时才发现。
  // ★ 默认是**看不见的**（css 里 `.copybar{opacity:0}`，鼠标移到那条消息上才现身）。
  //   看不见它也**占着位置**（不用 `display:none`）：用 display 藏的话，鼠标一移
  //   上去整条对话会往下跳一下——而跳动的那一下正好落在你准备点的那颗按钮上。
  // ★ 一颗 = `{字, 图, 提示, 点}`。`图` 有就走图标，没有就还是那个字（留着这条路，
  //   万一哪天要加一颗没有合适图标的）。
  function 动作条(bubble, 颗) {
    var bar = document.createElement('div');
    bar.className = 'copybar';
    for (var i = 0; i < 颗.length; i++) {
      (function (it) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'copybtn';
        // ★ `字` 一个字都不扔——它从"显示出来的那行字"转职成了这颗按钮的**名字**：
        //   `title`（鼠标停上去那一行）和 `aria-label`（读屏念出来的那句）都取它。
        //   ⚠ 少了 `aria-label`，这三颗对读屏就是**空白**（svg 上挂着 aria-hidden），
        //     念出来全是"按钮"两个字，三颗一模一样。
        if (it.图) { btn.innerHTML = it.图; btn.setAttribute('aria-label', it.字); }
        else btn.textContent = it.字;
        if (it.提示) btn.title = it.提示;
        btn.addEventListener('click', function () { it.点(btn); });
        bar.appendChild(btn);
      })(颗[i]);
    }
    bubble.appendChild(bar);
    return bar;
  }

  // 「复制」那一颗。两颗气泡上长得一模一样（同一个图标），只差**名字**。
  // ★ 数根那条为什么还叫「复制这段」：那是它从 2026-10-02 起就在用的词，
  //   而「关于」面板里明写着「备好的追问链可以「复制这段」带走」。
  //   改成「复制」就得连那段说明一起改，而这么改没有任何好处。
  //   ★ 2026-10-06 改了图标之后，这个词**只有读屏和鼠标悬停看得见**了——
  //     所以「关于」那段话不必跟着改口径，但要改**说法**（那里写的是"一颗「复制这段」"，
  //     现在看着是一颗图标）。见 index.html。
  // ★ 拷的是**传进来的那份文字**，不是 `btn` 旁边那份——理由见 addUser 里那段。
  function 复制颗(text, 字, 提示) {
    var t = String(text || '').trim();
    return {
      字: 字, 图: 图标.复制,
      提示: 提示 || '把这一条原样拷进剪贴板',
      点: function (btn) {
        SR.copyText(t, function (ok) {
          if (ok) 闪图标(btn, '好了', 1600);
          else { 闪图标(btn, '没成', 1600); setStatus('没拷成，手动选一下吧。'); }
        });
      }
    };
  }

  function attachCopy(bubble, text, turn) {
    var t = String(text || '').trim();
    if (!t) return;
    动作条(bubble, [复制颗(t, '复制这段', '把这一段拷进剪贴板')]);

    // ---- 这颗「打包」**搬走了**（2026-10-05），留一条墓志铭，别再加回来 ----
    //
    // 它原来是这条 bar 上的第二颗（`2026-10-02` 定，孔老师把问题交回给我：
    // "你自己看看如何方便用户体验"），当时的四条理由逐条比过工位、比过窄屏，
    // 结论是"挂在这一条回复上最方便"。**那四条今天一条都不成立了**，而且不成立的
    // 方式比"过时"更难看：
    //
    //   ① 「同一种念头不该有两个地方」—— 打包本来就是**整场**的东西
    //      （`js/pack.js` 顶上从第一版就写着"从头到点击处为止"），
    //      它跟真正"这一段"的「复制这段」挤在一根 bar 上，恰恰**造出了**两个刻度
    //      长得一样的假象。老师点中间那条拿到的是半个包，而包看着是完整的。
    //   ② 「两个刻度挨着放」—— 挨着的代价是**刻度分不清**（同上）。
    //   ③ 窄屏放不下 —— 这条当年是为了论证"别放画板工具条"，
    //      可它同样论证了"别放在这儿"：多一颗就折行。
    //   ④ 那第四条（.outbox 组卷独有）说的是"别放右栏"，跟"放哪"无关。
    //
    // ★ 孔老师 2026-10-05 一句话点破：「打包按钮就应该放在这个绿行才对，
    //   放对话里面干什么。」——搬去 `#onep`（见 js/packui.js）之后，
    //   打包回到了它本来就是的东西：**这一份**（整场对话）带走。
    //   而"挑一部分带走"另外给了入口（绿行上那颗「选择内容」），
    //   不用再借"点中间那一条"这种隐式的刻度。
    //
    // ⚠ `css/main.css` 里的 `.packbtn` 那几条**留着**：绿行那两颗按钮
    //   （「选择内容」「打包」）全靠它。
    //   ★ 2026-10-06 起要说清一件事：那颗「打包」跟「复制这段」**不再是同一套形状**了
    //     ——「复制这段」当天换成了无框图标（`.copybtn`），「打包」照旧是绿带子上的
    //     白底细边面板按钮。两条规则已经拆开，别看着"长得像"又合回去。
    //
    // ★ 2026-10-06：这一格现在只挂「复制这段」了 —— 具体挂法在 `动作条()` 里，
    //   杆子由它自己 append，这里**不要再 append 第二根**。
  }

  // ============================================================
  //  老师那一条底下的三件事：复制 / 修改 / 重新发送（2026-10-06）
  // ============================================================
  //
  // 孔老师 2026-10-06：「我觉得发出的消息可以加一个别的智能体有的重新发送和修改文字功能，
  // 以及每个会话都有一个复制功能？你看看 deepseek 做的事情。」
  //
  // ★ 跟 DeepSeek 对过的口径（他定的两条）：
  //   · 「重新发送」和「修改文字」在那边是**同一个动作** —— 从这一条起重来，
  //     后面那几轮一起丢掉。区别只是"重来之前要不要先把字改一改"。
  //   · 复制**每一条**都给（他自己发的 + 数根发的）。
  //   ⇒ 所以真正的地基只有一件事：**把账本从第 n 条截断**（`SR.memo.截到`），
  //     两件事共用它。这一点写在 js/memo.js 的「三·五、截断」那一段里。
  //
  // ★ 三颗都**只在自己这条消息悬停时**才现身（css 里 `.copybar{opacity:0}`）——
  //   不悬停时它们照旧占着位置，只是看不见（理由见 `动作条()` 那段：用 display 藏
  //   会让对话在鼠标移上去的那一下整条往下跳，而跳的那一下正好落在你要点的地方）。

  // 这条消息在**账本**（`SR.memo`）里是第几条。
  //
  // ★ 门牌挂在 `.msg` 上（`data-mi`），跟助手气泡挂的是**同一个名字**——
  //   两边各钉各的元素，不冲突。助手那条钉的是"补卡要用的号"（见 repaintLog），
  //   这条钉的是"重来要从哪儿切"。
  //
  // ⚠ 取不到时返回 **-1**，不许返回 0。
  //   "这一条不在账本里"（上一轮**没答成**，那条压根没进账本）和"这一条是第 0 句"
  //   是两件完全不同的事：前者按「重新发送」只是**再说一遍**，后者按下去要把
  //   **整场对话**丢掉。拿 0 当默认值，前者就会做出后者的事。
  //   （同族教训见记忆「检测脚本的数字不是它宣称的那件事」：数字本身没错，
  //    错的是它量的那个东西。）
  function 账本号(el) {
    if (!el) return -1;
    var v = el.getAttribute('data-mi');
    if (v == null || v === '') return -1;
    var n = parseInt(v, 10);
    return isNaN(n) ? -1 : n;
  }

  // 从账本第 n 条起重来：n 及其后面的全丢，然后照新账本把屏幕摆一遍。
  //
  // ★ 为什么是"切账本 + 重画"，而不是"在屏幕上删掉几个气泡"：
  //   屏幕上每一块东西都是账本某一条推出来的（见 repaintLog 顶上那段）——
  //   账本一变、重画一遍，六处就一起对齐了：气泡、工位分界线、卷子卡、
  //   冻图占位、底下那三颗兜底按钮、绿行的账本。
  //   反过来在 DOM 上删，六处得自己各删一遍，**漏一处屏幕上看不出来**
  //   （少了一条分界线、或者绿行里还留着已经删掉的那一轮）。
  //
  // ★ 返回"真丢了没有"。`SR.memo.截到` 在 n 落在账本外面时返回 false ——
  //   那种情况不算重来，调用方该当"重发一遍"办。
  function 从这儿重来(n) {
    if (!SR.memo || !SR.memo.截到) return false;
    if (typeof n !== 'number' || n < 0) return false;
    if (!SR.memo.截到(n)) return false;
    // ★ `keepBoard`：右栏那块板**一动不动**（理由见 reset 里那段长注释）。
    reset(work, { keepBoard: true });
    return true;
  }

  // 「复制 / 修改 / 重新发送」这一排，挂到**老师自己那一条**底下。
  //
  // ⚠ 传进来的 `text`/`parts` 是**闭包里那一份**，不是点击时去 DOM 上读的。
  //   理由跟 `复制颗` 一样，而且在这儿更凶险：气泡底下这会儿还多了这根小条
  //   自己，从 textContent 读回来的是一串掺着按钮名的东西 —— 而它看着完全正常，
  //   重发出去的会是一句谁也没说过的话。
  //   ★ 2026-10-06 换图标之后这一条**更难看见了**：这几颗现在 textContent 都是空串，
  //     真要从 DOM 上读，读回来的是**一句话都没有**（连"掺着按钮名"都不是）。
  //     结论没变、理由更硬：闭包里那份 `t` 是唯一的一份。
  function attachUserActs(el, bubble, text, parts) {
    var t = String(text || '').trim();
    var 颗 = [];
    // 复制：有字才给。只发了图没打字的那一条，拷出来是个空串——
    //   按钮在那儿、"复制好了"也报，粘出来什么都没有。
    if (t) 颗.push(复制颗(t, '复制'));
    // 修改：没字就没什么可改的（那种一条只有图，要改就是重发）。
    if (t) 颗.push({
      字: '修改', 图: 图标.修改,
      提示: '把这句话放回输入框，改完再发；发出去就从这条重来',
      点: function () { 改这条(el, t, parts); }
    });
    // 重新发送：**每一条都给**，包括只发了图的那一条（图和字一起原样再发一遍）。
    if (t || (parts && parts.length)) 颗.push({
      字: '重新发送', 图: 图标.重新发送,
      提示: '原样再发一遍，后面那几轮丢掉',
      点: function () { 重发这条(el, t, parts); }
    });
    if (颗.length) 动作条(bubble, 颗);
  }

  // 把一批附件摆回输入框上面那一行（`#thumb`）。
  // ★ 这一份 `pendingParts` 是"要发什么"的**唯一**一份（submit 读的就是它）——
  //   想让重发带上原来的图，只能摆回这儿来。
  // ★ 摆回**看得见**的地方而不是悄悄挂在心里：老师得能在发出去之前点 × 撤掉。
  function 收附件(parts) {
    if (!parts || !parts.length) return;
    var room = SR.files.maxFiles - pendingParts.length;
    if (room <= 0) { setStatus('一次最多 ' + SR.files.maxFiles + ' 个文件，先去掉几个再加。'); return; }
    pendingParts = pendingParts.concat(parts.slice(0, room));
    pendingNote = '';
    renderStrip();
  }

  // 「修改」：把原话放回**输入框**，然后**挂起**那一刀（见文件开头 `pendingTrunc`）。
  //
  // ★★ 为什么不在这儿直接截：老师点「修改」十有八九只是想**看一眼自己原来是怎么说的**。
  //   按下去就删的话，他看完觉得"还是原话好"——已经没有回头路了。
  //   挂起来的话，只要不按发送（或者按 Esc），一个字节都没动。
  //
  // ★ 为什么放回输入框、而不是把气泡变成可以直接改的框（DeepSeek 那种内联编辑）：
  //   见 js/memo.js 里 `edit()` 那段 —— 不同的浏览器从 contenteditable 里读出来的
  //   换行和看不见的字符**不是同一套**，读回来的一串"看着一样"的文本，
  //   发出去可能是另一句话。输入框这条路是产品里**唯一**一份"把字变成消息"的地方，
  //   代价是少一次点击，换来的是不会多一条谁也说不清是怎么来的消息。
  function 改这条(el, text, parts) {
    var n = 账本号(el);
    pendingTrunc = { n: n, 原话: String(text || '') };
    els.input.value = String(text || '');
    autoGrow();
    收附件(parts);
    els.input.focus();
    // 光标搁在**末尾**：他是要接着改，不是要全选重打。
    try {
      var L = els.input.value.length;
      els.input.setSelectionRange(L, L);
    } catch (e) {}
    // ★ 先把"会发生什么"讲清楚。截断是**不可撤销**的（后面那几轮真没了），
    //   这种事不该等他按完发送才发现。
    setStatus(n < 0
      ? '这句话不在记录里（上一轮没发成）。改完直接发就行。'
      : '改完点发送，就从这一条重来 —— 后面那几轮会一起丢掉。不想这样按 Esc。');
  }

  // 「重新发送」：原样再发一遍，从这条重来。
  function 重发这条(el, text, parts) {
    if (busy) { setStatus('这一轮还在答，等它说完再重来。'); return; }
    var n = 账本号(el);
    收附件(parts);
    // ★ 那一刀**不在这儿落下**，挂给 submit：在它里面 `landing.intercept()` 之后、
    //   `busy = true` 之前。理由有两条——
    //   ① 走到那儿才算"这句话真要发了"。在这儿先截了，万一后面因为没配 Key
    //      早退回来，屏幕上就是"后半场没了，而且什么也没发生"；
    //   ② 那一趟 `reset({keepBoard:true})` 会清空 `#msgs` 再重画，
    //      而"刚摆上去的那条新气泡"必须是重画**之后**才画的。
    // ⚠ `n < 0`（这一条不在账本里，上一轮没发成）→ 不挂刀。那种情况要的是
    //   "再说一遍"，不是"丢掉一段"。
    pendingTrunc = (n >= 0) ? { n: n, 原话: String(text || '') } : null;
    submit(String(text || ''));
  }

  // 拷进剪贴板。
  //
  // ★★ 2026-10-02 实测重写。旧版是**按下去毫无反应**：按钮既不报成功、也不报失败，
  //   就停在「复制这段」不动。量出来的病根是——
  //   `navigator.clipboard.writeText()` 返回的那个 Promise **可能永远不结**：
  //   在拿不到真正用户手势的时候（页面是脚本点出来的、标签页没有系统焦点），
  //   它既不 resolve 也不 reject，就那么挂着（实测挂满 2 秒还是 pending，
  //   同一次实测里 `document.execCommand('copy')` 是**干脆返回 false**）。
  //   旧版把 cb 整个挂在 .then 上，于是**两条路一起断**——按钮上根本没有"有反应"这个状态。
  //
  //   现在：① **先走同步那条**——`document.execCommand('copy')` 当场返回真假，不等谁；
  //   ② 它说不行，再去够异步那条，但**给它一个上限**（1.5 秒），到点就当没成；
  //   ③ 无论走哪条，cb **保证被调一次**。按钮上不再有"没反应"。
  //
  // ★ 为什么反过来不行（先异步）：异步那条在**真老师真点**的时候当然更漂亮，
  //   可它一旦挂住，老师看到的就是一个死按钮。宁可先用同步那条把结果攥在手里。
  //   两条路给出去的都是**纯文本**，没有格式上的差别。
  // ★ 同步那条要在**点击回调里**调（用户手势还没过期）；这一点 attachCopy 那边保证了。
  //
  // ★ 为什么两条路都得留：`navigator.clipboard` **只在 https 或者 localhost 下才有**，
  //   老师很可能是在内网 http 上、或者把这一页存下来双击打开（file://）——
  //   那种情况它是个 undefined。线上是 GitHub Pages（https），正常走得到。
  //
  // ★★ 挂到 SR 上，**全站就这一份**。同一件事原来在三处各写了一遍——备课气泡、
  //   卡片墙的"复制一行"（cards.js）、教材资源页的"复制路径"（main.js）——三份写法还不一样，
  //   于是"Promise 永远不结"这个病只在备课那一处发作，另外两处看着好好的。
  //   这就是同一件事写三遍的下场：修的时候只修得到出症状的那一份。
  //   现在另外两处都改成调 `SR.copyText`。**要改只改这里。**
  SR.copyText = function (t, cb) {
    var done = false;
    function fin(ok) { if (done) return; done = true; cb(!!ok); }
    function legacy(s) {
      try {
        var ta = document.createElement('textarea');
        ta.value = s;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
      } catch (e) { return false; }
    }
    if (legacy(t)) { fin(true); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // ⚠ 上限到点之后它才 fulfilled 的话，按钮上写的是「没拷成」而东西其实已经进了剪贴板。
      //   这是**故意**的取舍：宁可极偶尔报一次虚惊，也不要让按钮永远不吭声。
      var timer = setTimeout(function () { fin(false); }, 1500);
      navigator.clipboard.writeText(t).then(
        function () { clearTimeout(timer); fin(true); },
        function () { clearTimeout(timer); fin(false); }
      );
      return;
    }
    fin(false);
  }

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
    // ★ 2026-10-06：「再试一次」办的是**这一轮没答成**，跟「修改」挂起来的那一刀
    //   是两码事。卸掉它 —— 不卸的话，切完 Key 点一下"再试一次"，
    //   会把一条跟它无关的、之前按过「修改」的位置上的几轮悄悄吃掉。
    pendingTrunc = null;
    // 文件也得回到输入框上——学生要看得见"那几张图/那份卷子还在"，才敢按下发送
    renderStrip();
    submit(f.text);
  }

  // ---- 可选回答（猜他想说）----
  // ★★ 2026-10-03（阶段 G）：从「输入框上面常驻那一排」改成**这一条回复自己的**。
  //   理由跟冻图、卷子卡、流水线是同一条：一样东西该长在说它的那句话底下。
  //   常驻那一排还有个说不通的地方：它跟"哪一轮"没关系，可顶上那三句是拿
  //   **这一轮**的回复（```想说 围栏／本地兜底）推出来的——聊了五轮，它还钉在
  //   原地，屏幕上的对话早翻过去两屏了，那三句话是在接哪一句就没人说得清。
  //   `#chips`（index.html:323）先留着不删，等阶段 H 清场时一并处理。
  var curChips = null;   // 这一轮那一盒选项。清的时候认它，不去文档里瞎找——
                         //   气泡会被 `#msgs.innerHTML = ''` 整批掀掉，
                         //   照 id 找很容易找到**别的那一条**剩下的盒子。
  function clearChips() {
    if (curChips && curChips.parentNode) curChips.parentNode.removeChild(curChips);
    curChips = null;
  }

  function showChips(lines, bubble) {
    clearChips();
    // 没有气泡就不摆：从今往后这三颗是**挂在某一条回复上**的，
    //   没有那一条就没有它们该待的地方（老写法往 `#chips` 里塞，永远有个窝）。
    if (!lines || !lines.length || !bubble) return;
    var box = document.createElement('div');
    box.className = 'chips';
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
        // ★★ 2026-10-04 孔老师：「提示词点了应该是出现在我的输入框里面，我可以
        //   添加内容输入，而不是点一下就直接问出去了。这样我没法修改话语。」
        //   → 这一颗**只负责填**，发不发由老师自己按（回车 / 发送）。
        //
        // ⚠ 别在这儿 `clearChips()`：那三颗是**一份菜单**，填了一颗就把菜单撤了，
        //   老师想换一颗（"不对，问的是这个"）得整轮重问一遍。要撤由 submit() 撤
        //   ——它自己收工时会撤（见 submit 里那句 clearChips）。
        // ⚠ 也别 `els.input.value = txt` 了事：输入框是靠 'input' 事件长高的
        //   （`autoGrow` 挂在那一档上，见 init）。直接赋值不发事件，框不长高，
        //   长建议的最后一行会被压在框外面看不见——填进去了，老师却以为没填上。
        // ⚠ 框里已经有字就**接在后面**，不覆盖：老师常常先打了半句，再点一颗
        //   当尾巴（"这道题" + "换个章节，题型不变"）。覆盖等于把他刚打的字删了，
        //   而删掉的东西**看不见**——他只知道自己打过的字没了，不知道是被谁删的。
        b.addEventListener('click', function () {
          if (busy) return;
          var cur = String(els.input.value || '');
          els.input.value = cur.trim() ? (cur.replace(/\s+$/, '') + ' ' + txt) : txt;
          els.input.dispatchEvent(new Event('input', { bubbles: true }));   // 让它自己长高
          els.input.focus();
          // 光标落到末尾：老师接着打就是往后接，不是回头改前面的字
          try { els.input.setSelectionRange(els.input.value.length, els.input.value.length); } catch (e) {}
        });
        box.appendChild(b);
      })(t, i);
    }
    bubble.appendChild(box);
    curChips = box;
  }

  // ---- 下载下来的文件叫什么 ----
  // ★ 为什么不直接用模板名：一个老师手上就那几份模板（周练卷模板、导学案模板），
  //   一周出一份，全叫「周练卷模板.docx」的话，下载三次就分不清哪个是哪周的。
  //   拿老师这句要求当名（"第五周 一元一次方程 周练卷"→「第五周 一元一次方程 周练卷.docx」），
  //   他一看文件名就知道是哪一份。
  // ⚠ 文件名的非法字符要清掉（Windows 里 `\ / : * ? " < > |` 一个都不许有），
  //   长度也要收——有些老师会把整段要求贴进来，那能有两百字。
  //
  // ★★ 2026-10-02 修：上面那段注释写的样子是对的，可代码没做到——旧版就是
  //   **把老师那句话原样截 24 个字**，于是真下下来的文件叫
  //   `出一份第五周 一元一次方程 周练卷，选择题 6 .docx`：
  //   开头是"出一份"这种口气词，尾巴断在半个要求上（"选择题 6"）。
  //   他说的确实是那句话，可那不是个名字。
  //   现在做两件事：**剥掉开头的口气词**（给我／帮我／出一份／出 10 道…），
  //   **在第一个逗号处断开**——逗号后面那些（"选择题 6 道、填空题 3 道"）是要求不是名字；
  //   第一段太短（"导学案"）才往后并一段，最多并到 NAME_MAX。
  //   ⚠ 已知不完美：「按这份卷子出一份周练卷」这种**动词在句中**的说法剥不掉，
  //     会整句当名字（11 个字，认得出是哪份，就先不折腾了——
  //     要在句子里找动词，误伤「初步」「出品」这类词的风险比收益大）。
  var LEAD_POLITE = /^(请|帮我|帮忙|麻烦|给我|我要|我想要|我想|替我)/;
  var LEAD_VERB = /^(出|做|来|生成|弄|整|搞|写)([几一数]*[份张套个本])/;
  var LEAD_COUNT = /^(出|做|来|生成|弄|整|搞)([0-9]+|[一二三四五六七八九十两])道/;
  // 名字最长多少字（含空格）。卡这么短是**给老师看的**：他下载三次要能一眼分清楚；
  // 也是给"另存为"后面还要接 (1)(2) 留地方。
  var NAME_MAX = 22;

  function fileTitle(ask, tpl) {
    var s = String(ask || '').replace(/[\r\n]+/g, ' ').trim();
    // ① 剥口气词。**循环剥**——"给我出一份"是两层，剥一次还剩一层。
    for (var i = 0; i < 4; i++) {
      var before = s;
      s = s.replace(LEAD_POLITE, '').replace(LEAD_VERB, '').replace(LEAD_COUNT, '').trim();
      if (s === before) break;
    }
    // ② 非法字符 + 结尾的标点
    s = s.replace(/[\\\/:*?"<>|]/g, '').replace(/[，。；：、！？,.;:!]+$/g, '').trim();
    // ③ 按标点切段，从前往后并，并到 NAME_MAX 就不再并。
    //    ⚠ 逗号后面**不都是名字**：还有一种"要求"（「20 道」「答案附在最后」「难度照课本例题」），
    //    并进来就成了「周练卷 答案附在最后.docx」。这类只可能是**第 2 段起**（第 1 段永远留着），
    //    所以下面的跳过只对 j>0 生效，不会把名字清空。
    var parts = s.split(/[，,。；;、]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    var out = '';
    for (var j = 0; j < parts.length; j++) {
      // 纯数量（「20 道」「6 个」）和要求句（带答案/难度/分值…的）不当名字
      if (j > 0 && (/^[0-9０-９一二三四五六七八九十两]+\s*[道个张题分份]$/.test(parts[j])
                 || /(答案|难度|分值|满分|时间|附在|要求)/.test(parts[j]))) continue;
      var t = out ? out + ' ' + parts[j] : parts[j];
      if (out && t.length >= NAME_MAX) break;   // ⚠ 是 >=：正好卡满也不并，
      out = t;                                  //   不然「…周练卷 选择题 6 道」那种尾巴还会进来
      if (out.length >= NAME_MAX) break;
    }
    if (out.length > NAME_MAX) out = out.slice(0, NAME_MAX).replace(/\s+$/, '');
    if (!out) out = (tpl && tpl.name) || '材料';
    return out;
  }

  // 本机在气泡底下补的一句（**不是模型说的**）。
  // ★ 挂在气泡**外面**：气泡的 innerHTML 在流式期间会被整块换掉，
  //   挂在里面的一句话活不过下一帧。
  function noteUnder(el, text) {
    if (!el) return;
    var p = document.createElement('p');
    p.className = 'localnote';
    p.textContent = text;
    el.appendChild(p);
    scroll();
  }

  // 气泡底下补一句 + 一个按钮（同样**不是模型说的**）。给"这一步要不要做、你说了算"用。
  // ★ 按钮点过就摘掉：它是"再问一次"，留着会让人以为还能反悔第二次。
  // ★ 回一句**那个 `<p>`**：有的补话过一会儿就不成立了（比如"板上没有播放键"，
  //   而自修那一趟正把这一页换掉），得能把它整个收回来。见 说播放这一茬。
  function noteBtnUnder(el, text, 按钮话, onclick) {
    if (!el) return null;
    var p = document.createElement('p');
    p.className = 'localnote';
    p.appendChild(document.createTextNode(text));
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lnbtn';
    b.textContent = 按钮话;
    b.onclick = function () { if (b.parentNode) b.parentNode.removeChild(b); onclick(); };
    p.appendChild(b);
    el.appendChild(p);
    scroll();
    return p;
  }

  // 「这一行算不算真给画板递了一条命令」——**一条判据，两处用**。
  //   `paint` 那边本来内联着同一段（数"真画了东西的条数"，拿它判"模型是不是只发了个
  //   光秃秃的 #清空"），自修那道闸也要用，就抽到这儿。
  // ⚠ 别在闸那边另写一份：两处各写一份就是两份规则，早晚会漂——漂的那天，
  //   自修会按另一套口径开合，而它开合的直接后果是**老师眼前那张图被换掉**。
  // `#清空`/`#分步` 是指令不是对象；`清空()/隐藏()/显示()` 同样不往板上添东西。
  function 数实条(lines) {
    var n = 0;
    for (var i = 0; i < lines.length; i++) {
      var s = String(lines[i]).trim();
      if (s && s.charAt(0) !== '#' && !/^(清空|隐藏|显示)/.test(s)) n++;
    }
    return n;
  }

  // ============================================================
  //  「画板没认」→ 让模型自己改一次
  // ============================================================
  //
  // ★★ 2026-10-04 加的。**产品本来缺了半条回路**：板上没落地的命令，
  //   `SR.board.failed()` 一直存着、状态条也照实说了（老师看得见），
  //   可**模型自己看不见** —— 于是它下一轮还会照原样错一遍，或者干脆不明白老师为什么说"没画出来"。
  //   （实测：问"转出六份铺成一圈"，12 轮里 11 轮都写出了名字或参数不对的命令，
  //    最典型的一条是 `旋转(三角形, α*A, A)` —— 第二格该放**数**，它把第三格那个点名字薅了过去。
  //    见 test/probe_rotate.cjs 与 js/prompt-draw.js 顶上那段。）
  //
  // ⚠ 只做**一次**，不追第二回。理由不是省 token：第二回是在"第一回也没改对"之后，
  //   那说明这一轮的问题不是手滑，是模型就没懂这道题——再问一遍只是让老师多等两轮。
  //   宁可把剩下没认的照实说清楚，让他自己决定是补一句还是手画（他本来就会用 GeoGebra）。
  //
  // ⚠ 判据取 `msg.ggbDone > 0`（这一轮**真给画板递过命令**），不取工位名：
  //   六个工位里能画图的不止 draw 一个，按工位名写死就会漏、而且以后加工位还得回来改。

  // ---- 正文里让你「点播放键」，可这一页的板上**根本没有播放键** ----
  //
  // ★ 来历：孔老师 2026-10-03 的截图。气泡里写着
  //   「现在，点播放键，圆就会绕着点 A 旋转，可以看到它的侧面。」，
  //   而同一份围栏里**一条 `#播放` 都没有**（命令还写坏了：`旋转中心=点旋转`）。
  //   他去画板上找那颗键 —— 那颗键是**暗的**。
  //
  // ★ 为什么是"暗的"这件事**量得出来**、不用猜：
  //   `board.js` 的 `canPlay()` 取的是模块级的 `playTarget`，而 `playTarget`
  //   **只有一个地方会赋值** —— `markPlayable(name)`，它由 `#播放 X` 那一条指令触发
  //   （见 js/board.js:1603 与 :3018）。没有 `#播放`，它就一直是个 null。
  //
  // ★ 为什么写成**本机补话**、而不是提示词里再添一条规则：
  //   这一档失败是**确定性的**（正文说了播放 vs 板上有没有走过 `#播放`），
  //   量得出来就不该交给模型自觉。而且 2026-10-04 实测过：
  //   往作图提示词的尾块里加"别忘了写 #播放"这类规则，六项判据**一起变差**。
  //   （同族的教训见 [[prompt-must-do-at-tail]]：位置比字句要紧，加字要慎。）
  //
  // ⚠ 只**说一句 + 给一颗按钮**，绝不擅自重画：板上可能真有一张能动的图
  //   （`#播放` 写在另一页上），也可能图本身是好的、只是没做动。
  //   换不换这一页，是老师说了算 —— 跟他定过的那条规矩一致
  //   （"不清楚我意图的时候先问，别立马就开始画"）。
  //
  // ★★ 2026-10-06 补的一岔：这句话原来只有**一个说法**（"得先有一行滑块"），
  //   而孔老师那张合并同类项的图**板上已经有滑块了**——它缺的只是最后那条 `#播放`。
  //   于是同一句补话里，前半句（"没有播放键"）是真的、后半句（"得先有滑块"）是假的；
  //   跟着来的那颗按钮还会让模型**再添一个滑块**。
  //   ⇒ 现在按"板上有没有现成的滑块"分两岔：有滑块就只说"把它接上播放键"，
  //     没有才教它"先加滑块、再写 #播放"。判据与写法见函数里那一段。
  var 播放话 = /(点|按|点一下|按下)[^。！？\n]{0,6}播放|播放键|播放按钮/;

  function 说播放这一茬(el, msg) {
    if (SR.NO_SELF_REPAIR) return;              // 跟自修同一把总闸（探针排查用）
    if (!el || !msg || !SR.board || !SR.board.canPlay) return;
    // ⚠ 看的是**老师在气泡上看得见的那一份**，跟「复制这段」取的是同一个东西。
    //   取 `msg.raw` 的话，被 render.js 删掉的那些画板命令行会一起参与判断 ——
    //   而"说了播放"是给**人**看的，就该只按人看得见的那些字判。
    var 文 = String(msg.lastVisible || '');
    if (!播放话.test(文)) return;
    // 等板子停下来再问"到底能不能播"——正画着的时候 `playTarget` 还没被赋上，
    // 那时读到的 false 只是"还没轮到那条指令"，不是"没有这条指令"。
    // （老账：按秒表读状态会把"还没开机"读成"报错了"。）
    var 等 = 0;
    (function 看板子() {
      if (SR.board.isBusy && SR.board.isBusy() && 等++ < 60) { setTimeout(看板子, 250); return; }
      if (SR.board.canPlay()) return;           // 板上有播放键（哪怕指着的不是滑块）→ 不插话

      // ★★ 2026-10-06：这一句得**分岔**。孔老师那张"合并同类项、长条滑过来接上"的图，
      //   板上明明躺着一行 `α=Slider(0,1,0.04)`（只是被 `#隐藏 α` 藏了），
      //   而补话说的却是"得先有一行滑块"——半句错话；更糟的是那颗按钮会让模型
      //   **再添一个滑块**（`t=Slider(0, 2*pi, 0.05)`，范围还是"绕一圈"那一种，
      //   跟他这张图的条形平移完全不是一回事）。
      //   这一版缺的自始至终只有最后那一条 `#播放 α`。
      // ⚠ 判据取的是**命令原文**（`msg.raw`），不是上面那句 `msg.lastVisible`：
      //   `lastVisible` 上画板命令行已经被 render.js 剥掉了，上面那句"人说了播放"
      //   只有它看得见。两件事要的是**两份不同的文本**，别图省事合成一份。
      // ⚠ 认滑块只认**定义那一行**（`名字=Slider(...)`），不认正文里提到"滑块"两个字——
      //   这一版的话里本来就会写"滑块"（它在教老师怎么点），那是词，不是图上的东西。
      var 原文 = String(msg.raw || '');
      var 滑 = 原文.match(/^[ \t]*([A-Za-z一-龥_][\w一-龥']*)[ \t]*=[ \t]*(?:Slider|滑动条|滑块)[ \t]*\(/m);
      var 滑名 = 滑 ? 滑[1] : '';
      var 有滑块 = !!滑;
      var 头一句 = '提醒一句（不是模型说的）：这一段让你点播放键，'
        + '可这一版的画板上没有播放键——那颗是暗的，按不动。';

      var 那张;
      if (有滑块) {
        // 滑块在、只是没跟播放键接上（多半是它写了 `#隐藏` 又忘了写 `#播放`）
        那张 = noteBtnUnder(el, 头一句
          + '这一版其实已经有一个滑块' + (滑名 ? '「' + 滑名 + '」' : '') + '了，'
          + '只是没跟播放键接上——缺的是最后那一条 '
          + (滑名 ? '#播放 ' + 滑名 : '#播放（名字写那个滑块的名字）') + '。',
          '让它补上播放键，重画这一版', function () {
            teacherSays('这一版没有播放键，但滑块' + (滑名 ? ' ' + 滑名 + ' 是' : '已经是') + '现成的：'
              + 'Slider 那一行照原样留着，不要新加滑块。'
              + '请把整份 ggb 围栏重写一遍，只在最后补一条 '
              + (滑名 ? '#播放 ' + 滑名 : '#播放（名字写那个滑块的名字）') + '。');
          });
      } else {
        那张 = noteBtnUnder(el, 头一句 + '要让它真动起来，得先有一行滑块，再写一条 #播放。',
          '让它加个滑块，重画这一版', function () {
            teacherSays('这一版没有播放键。请加一行滑块 t=Slider(0, 2*pi, 0.05)，'
              + '再写一条 #播放 t，然后把整份 ggb 围栏重写一遍（已经对了的行照原样带上）。');
          });
      }
      // ★ 这一句**可能过一会儿就不成立了**：右栏的图是稍后才冻上的，
      //   而"画板没认"那道自修闸可能正在后台把这一页**整张换掉**
      //   （见 试自修 的 去问 —— 它重画的就是这一页）。换了之后新图要是
      //   带了 `#播放`，屏幕上就挂着一句"没有播放键"的假话。
      //   所以留一个**过后再看一眼**的检查：板子一旦能播了，就把这句话收回去。
      //   ⚠ 撤的是整条 `<p>`（连按钮），不是只撤按钮 —— 这话本身已经不真了。
      //   窗口给到 2 分钟：自修那一趟是一次模型往返，实测常见 20~40 秒。
      if (那张) {
        var 看几回 = 0;
        var 再看 = setInterval(function () {
          if (!那张.parentNode) { clearInterval(再看); return; }
          if (SR.board.canPlay()) { 那张.parentNode.removeChild(那张); clearInterval(再看); return; }
          if (++看几回 > 40) clearInterval(再看);      // 40 × 3s = 2 分钟，够了
        }, 3000);
      }
    })();
  }

  function 试自修(el, msg) {
    if (SR.NO_SELF_REPAIR) return;                          // 探针/排查用：在控制台置真就整条回路关掉
    if (自修过了) return;
    if (!msg || !msg.ggbDone) return;                       // 这一轮没碰画板
    if (!SR.board || !SR.board.failed || !SR.tabs || !SR.tabs.relines) return;
    if (!SR.api || !SR.api.ready || !SR.api.ready()) return; // 没 Key 就别硬发
    if (busy) return;                                        // 还有人（老师）在发东西
    自修过了 = true;

    // 等板子停下来再问"到底哪几条没认"——正画着的时候 `failedNow` 还在往里攒。
    // ★ 有上限：板子卡住时不能把这条回路吊死在这儿（超时就当没认，照实说）。
    var 等 = 0;
    (function 看板子() {
      if (SR.board.isBusy && SR.board.isBusy() && 等++ < 60) { setTimeout(看板子, 250); return; }
      var 没认 = SR.board.failed() || [];
      if (!没认.length) return;                              // 全落地了，什么都不用说

      // ★★ 2026-10-04 夜加的第二道闸：**一条没认 ≠ 图坏了，先别急着改**。
      //
      //   这是 A/B 量出来的，不是想出来的（test/probe_repair.cjs 4）：
      //   第 1 轮"自修关"那一臂板上是 **面 7／异点 14** —— 六份转得整整齐齐，
      //   **同时也有一条没认**。原来这道闸只看"有没有没认"，于是把这张好图
      //   `relines` 清板重画，换成模型当场瞎试出来的坏图（它开始写
      //   `Rotate[三角形, A, α*t]` 这种方括号、参数顺序乱掉、还引入了一个
      //   从没定义过的 `t`）。读数当场翻过来：**自修开 0/4、自修关 2/4**，
      //   关着比开着好——因为开着的那一臂会主动把好图换成坏图。
      //
      //   病根不是"回喂"这个想法，是**判据太粗**：一条没认 ≈ 图坏了，这个等号不成立。
      //   一条没认可以是"多写了半句"（图早画好了），也可以是"整张图就靠这一条"
      //   （画板上只有个三角形）——**从 failed() 那个条数上看不出是哪种**。
      //
      //   换一个量得出的判据：**递过去的命令条数 vs 板上对象数**。
      //   这套 DSL 里每一条实命令至少落成板上一个对象（点、多边形、滑块都算），所以：
      //     · 板上对象 **少于** 命令条数 → 有命令根本没落地 → 图是**缺的** → 自动改，值得；
      //     · 板上对象 **不少于** 命令条数 → 那几条没认的是**添头**（重复行、给中间量
      //       起的名字），图该出来的都出来了 → **不自动改**，改成问一句，老师点一下才改。
      //   ⚠ 量的是**这一页**：多围栏的轮次是一页一张图（`tabs.drawHere`），所以只数
      //     **最后那个围栏** —— 它进的就是最新那页，也就是老师正看着的这页。
      var 全 = (msg.ggbAll && msg.ggbAll.length) ? msg.ggbAll[msg.ggbAll.length - 1] : '';
      var 递 = 数实条(String(全 || '').split('\n'));
      var 旧 = SR.board.snapshot ? SR.board.snapshot() : null;
      // 存档拿不到就**不走自动那条路**：回滚的本钱就是这张存档，没有它，
      // "改坏了"就没有退路。宁可只剩按钮，也不拿他眼前的图去赌。（snapshot 忙时返回 null。）
      if (旧 && 递 > 旧.n) { 去问(el, msg, 没认, 旧); return; }
      问一声(el, msg, 没认, 旧, 递);
    })();
  }

  // 图看着是好的、只有零头没认 → 不擅自动板，问一句。
  // ★ 这条正是他定的那条规矩（"大模型不清楚我意图的时候…问我是否正确，而不是立马就开始画"）：
  //   自动改只在**图确实缺东西**时出手；图是好的而它想换一张，那是"换"，得他说了算。
  function 问一声(el, msg, 没认, 旧, 递) {
    var 因 = 旧 ? ('板上现在有 ' + 旧.n + ' 件，你递过去 ' + 递 + ' 条 —— 该出来的看着都出来了')
                : '画板这会儿存不下底档，我不敢自动改';
    noteBtnUnder(el, '有 ' + 没认.length + ' 条画板没认，但' + 因 + '。要照它重画一遍吗？（重画会换掉这一页的图）',
      '让数根改一次', function () {
        if (busy) return;
        var 旧2 = SR.board.snapshot ? SR.board.snapshot() : null;   // 点的时候再存一次，取最新的
        去问(el, msg, 没认, 旧2 || 旧);
      });
  }

  function 去问(el, msg, 没认, 旧) {
    // ★ 没有底档就**一步都不动**。这一条在函数最前头，不在后面某处：
    //   回滚的**全部本钱**就是这张存档，"改了还能还回去"这句话只有拿得到它才成立。
    //   它拿不到（板正忙 / 还没起好 / getBase64 失败）的时候，最坏的选择就是
    //   "先改了再说"——那等于拿老师眼前那张图去赌模型这一趟会不会写对。
    if (!旧) {
      noteUnder(el, '画板这会儿存不下底档，这一趟我不动它 —— 没认的还是那 '
        + 没认.length + ' 条，你可以换个说法再问一句，或者自己在板上手画。');
      setStatus('没认：' + 没认.slice(0, 3).join(' ／ '));
      return;
    }
    // 原来那一份的行和说明 —— 回滚时要把这一页的账（`pg.lines` / 标题）按原样写回去。
    var 原份 = (msg && msg.ggbAll && msg.ggbAll.length) ? msg.ggbAll[msg.ggbAll.length - 1] : '';
    var 原行 = 原份 ? String(原份).split('\n') : null;
    var 原标题 = (msg && msg.ggbInfoAll && msg.ggbInfoAll.length) ? msg.ggbInfoAll[msg.ggbInfoAll.length - 1] : '';

    var 清单 = '';
    for (var i = 0; i < 没认.length && i < 8; i++) 清单 += '　' + 没认[i] + '\n';
    if (没认.length > 8) 清单 += '　…（还有 ' + (没认.length - 8) + ' 条）\n';

    noteUnder(el, '有 ' + 没认.length + ' 条命令画板没认，我让它照着改一遍……');
    setStatus('正在让它把没认的几条改对…');
    busy = true; els.send.disabled = true;

    // ★ 清单里那几条是**画板看到的形态**：认识的中文命令名已经被换成英文了
    //   （`旋转(q, α*A, A)` 到那儿就成了 `Rotate(q, α*A, A)`，实测 test/_failedlist.cjs），
    //   参数一个没动 —— 而错就错在参数上。
    //   ⚠ 所以必须说一句"这是画板那边的样子"。不说的话，模型会照着它**没写过**的一行去改，
    //     轻则当成新命令重写一遍，重则反问"我没写这个"。
    //
    // ★★ 2026-10-05 **撤掉了一段**（加了又撤，账记在这儿）：
    //   原来这儿还会把 `SR.board.objects()` 读回来的**真实名单**一并喂过去，
    //   好让模型看见"我上一版到底交出了什么"。想法本身没错（照大角几何的 `list` 学的），
    //   但**配对 A/B 里它一次都没机会说话**：清场以后两臂各 3 趟，全都是"没认 0 条"，
    //   自修那一趟压根没触发，这段代码连执行都没执行到。
    //   未经检验的一行摆在提示词里，就是白占字数、白让模型分神，所以撤了。
    //   ★ 真要复活它，先得有一个**能稳定造出"没认"的靶子**（现在这句靶子造不出来），
    //     否则还是量不到它。当时那版 A/B 读数（"自修请求里有名单 有"）是**脏数据**——
    //     探针没点 ⟳，量的是共用历史的那一版，见 test/_ab_heji.cjs 顶上那段。
    //   ⚠ 用 `objects()` 而不是数 DOM，这条知识仍然成立（`inject` 600ms 就注进来一个空壳，
    //     而 `#清空` 绕过 `clear()`）——**板上有哪些对象，只能问板子自己**。留着备查。

    var 请 = '★ 画板刚才有这几条**没认**（命令行不通，或者它跑完板上什么都没多）：\n\n'
      + 清单 + '\n（这几行是**画板那边的样子** —— 你写的中文命令名被它翻成英文了，'
      + '方括号里的参数是原样，**错就错在参数上**。）\n\n'
      + '请你把这几条改对，然后**把整份 ```ggb 重写一遍**'
      + '（已经对了的那几行照原样带上，我这边会照你这份重画，不会叠起来）。';

    var 收 = '';
    SR.api.ask({
      work: work,
      history: history.slice(),          // 含刚推入的那条（模型自己那份），它得看见自己写了什么
      text: 请,
      parts: [],
      // ★ 2026-10-06：这一趟是**修同一张图**，不是新起一题，所以专题卡要**沿用老师那一轮**
      //   （`沿用卡: true` 会让 buildSystem 跳过"按本段文字重翻"）。
      //   不传的话，门会拿上面这段修理指令去翻 —— 它里头带着画板现场的命令行
      //   （`Circle(圆心, 半径)` 这种），能勾出老师那句话根本没勾的卡，
      //   于是模型被要求"重写整份 ```ggb"，手里的规矩却换了一套。实测与理由见 js/api.js。
      沿用卡: true,
      // ★ 2026-10-06：这一趟**不挂蓝图闸门**（⑥）。手上那句 `请` 是产品发的修理指令，
      //   不是老师在说话 —— 命题那格开着蓝图（它出的变式要配图，`multiFig`），
      //   要是不关，它底下会拼一段"这一轮先别出成品、只写蓝图"，
      //   正好跟上面那句"把整份 ```ggb 重写一遍"顶牛：修图这一趟反而去写蓝图。
      //   ⚠ 门里那句"老师这一轮说没说要出东西"判不了这个 —— 修理指令里当然没有点头的话，
      //     所以它只会落到"该给蓝图"那一档，**必须是产品这边明说不要**。
      蓝图: false,
      // ★ 2026-10-06：这一趟是**来改这张图的**，所以带上板子的截图（④）——
      //   它得看见自己画成什么样，才谈得上改。`.boardSee` 那道工位开关在 api.js 里查，
      //   这儿只管喊一声"这轮必须看"（板上真是空的时 board.js 自己会拒绝，不看空板）。
      看板: true,
      onChunk: function (piece) { 收 += piece; }
    }).then(function (res) {
      busy = false; els.send.disabled = false;
      var 还 = [];
      if (res && res.error) {
        noteUnder(el, '想让它改一遍，可这一趟没发出去（' + res.error + '）。没认的还在状态条上。');
        setStatus('没认：' + 没认.slice(0, 3).join(' ／ '));
        return;
      }
      //    ★ 自修这一趟等的是 `ask` 收完的整段话 → 收尾。
      var p = SR.render.parseFences(String(res.text || ''), { stripAssign: !!((SR.WORKS[work] || {}).stripAssign), 收尾: true });
      var 行 = (p.ggb && p.ggb[0]) ? p.ggb[0].split('\n') : null;
      if (!行 || !行.length) {
        noteUnder(el, '让它改，它这一趟没给画板指令。没认的还是原来那 ' + 没认.length + ' 条。');
        setStatus('没认：' + 没认.slice(0, 3).join(' ／ '));
        return;
      }
      // ★ 走 `relines`：**同一页重画**，不另开一页（另开会变成标签条上并排两张，
      //   老师以为出了两张图，其实同一道题）。见 js/tabs.js 的 relines。
      //
      // ★★ 2026-10-04 夜改在这里：**等它回话，不再按秒表**。
      //   原来是 `relines()` 之后拿 `isBusy()` 轮询当"画完了没有"——而 `relines` 末尾那句
      //   `run()` 是**排队即返回**的（每条命令隔几百毫秒才放出去），刚排完队那一刻板并**不**忙，
      //   于是判据当场就读了一次板，读到的是**改之前那张**的件数。实测（test/_count3.cjs）：
      //     +1364ms 这一趟刚 `#清空`、正按新命令重画
      //     +1457ms `setBase64 ← restore ← board.js:2098 ← next ← chat.js:612 ← fin`
      //             —— 借板那一趟（`freezeFences` 冻图）收工，把**改之前**的存档装回来了
      //     +1490ms 板上人名单 0 → 7|A,B,C,q,c,a,b（**一声 evalCommand 都没有**）
      //   也就是说"件数掉了就还回去"这道闸**从来没合上过**（读完永远是"一件都没丢"），
      //   补的话还说"改了一遍，还剩 6 条"。数字没错 —— 错的是它量的是**别人那一刻的板**。
      //   现在这个回话是真信号：有世代号（这批被作废 → false）＋多留一帧（等真画上去）。
      var 我这局 = 局面数;
      SR.tabs.relines(行, (p.ggbInfo && p.ggbInfo[0]) || '', function (ok) {
        // ★ 等这几秒里**局面翻篇了没有** —— 翻篇就一步都不动。
        //   · `局面数` 变了：老师把板清了／换了工位／又发了一句。他刚抹掉的东西不该被我"还回来"。
        //   · 板正忙着：有别人在画，谁在画谁说了算。
        //   这一条跟下面那道"改坏了还回去"是**同一行代码的两面**：`restore(旧)` 对"改坏了"
        //   是解药，对"老师不想要了"是**把垃圾搬回来**。光看板的状态分不出这两种
        //   （都是"板上跟旧的不一样了"），只有有人告诉过我们翻篇了才分得出。
        if (局面数 !== 我这局 || (SR.board.isBusy && SR.board.isBusy())) {
          noteUnder(el, '刚要重画这一页，你又发了东西（或者把板清了），这一趟我就停在半路，'
            + '不往回还了 —— 这会儿板上的才是你要的。');
          setStatus('没认：' + 没认.slice(0, 3).join(' ／ '));
          return;
        }
        还 = SR.board.failed() || [];

        // ★★ 2026-10-04 夜加的第三道闸：**这一改是不是还不如原来**。
        //   上面那道闸挡住的是"本来就不该改"，这道挡的是"改了反而更坏"——
        //   实测那一轮就是这么坏的：原来那张**面 7／异点 14**（好图），
        //   改完成了**面 1**（模型瞎试出来的），而这两份在 `failed()` 上
        //   都是"1 条没认"，**从那个条数上分不出来**。分得出来的是**板上有多少东西**。
        //
        //   判据取**对象数变少**、并且**没认的条数没跟着变少**：
        //     · 件数少了、没认的也少了 → 它是一份**更紧凑而确实改对了**的重写
        //       （比如五条 `旋转` 换成一个 `序列`），认；换掉了也算学到东西。
        //     · 件数少了、没认的还是那么多 → **没换来任何好处，却丢了板上的东西**，不认，还回去。
        //   存不住新存档（`snapshot` 忙时返回 null）时也**按坏的算**：量不到就不赌。
        //   ★ `!ok` 也算坏：这一批压根没画完（超时／半路被作废）—— 板上多半是半张图，
        //     拿它当"改好了"是拿老师眼前那张图去赌。
        var 新 = SR.board.snapshot ? SR.board.snapshot() : null;
        if (!ok || !新 || (旧 && 新.n < 旧.n && 还.length >= 没认.length)) {
          var 由 = !ok ? '这一趟画到一半就断了（超时，或者半路被作废）'
                       : (!新 ? '量不出改完那份有多少东西'
                              : ('板上从 ' + 旧.n + ' 件掉到 ' + 新.n + ' 件，而没认的还是 ' + 还.length + ' 条'));
          SR.board.restore(旧, function (r) {
            if (!r.ok) {
              noteUnder(el, '这一改还不如原来（' + 由 + '）。我想把原来那张还回来，可它没还成（'
                + (r.why || '不说明原因') + '）——你按 ⟳ 重画一次吧。');
              setStatus('没认：' + 没认.slice(0, 3).join(' ／ '));
              return;
            }
            // 板已经**像素级**还原回老师原来看见的那张了，所以这一页记的行也得换回去——
            // 两本账不一致的话，下次切页/导出看到的就是另一张。（只换账，不重跑命令：
            // 重跑就是拿命令去凑一张已经对了的图。见 js/tabs.js 的 revertHere。）
            if (SR.tabs.revertHere) SR.tabs.revertHere(原行, 原标题);
            // ⚠ 状态条按**原来那几条**说，不按刚读到的 `还`：restore 不动 `failedNow`，
            //   此刻它里面装的是**被丢掉那份**的没认，拿它说话就是拿另一张图的账报这一张图。
            noteUnder(el, '这一改还不如原来（' + 由 + '），我把原来那张**还回来了**。'
              + '没认的还是那 ' + 没认.length + ' 条，图上其它部分照旧。');
            setStatus('没认：' + 没认.slice(0, 3).join(' ／ '));
          });
          return;
        }

        if (!还.length) {
          noteUnder(el, '改好了 —— 板上现在是重画过的那一份。');
          setStatus(SR.api.usageText());
        } else {
          noteUnder(el, '改了一遍，还剩 ' + 还.length + ' 条没认（' + 还.slice(0, 3).join(' ／ ')
            + '）。你可以把这句话再换个说法补一句，或者自己在画板上手画——两条路都在。');
          setStatus('没认：' + 还.slice(0, 3).join(' ／ '));
        }
      });
    }).catch(function (e) {
      busy = false; els.send.disabled = false;
      noteUnder(el, '想让它改一遍，没发成（' + (e && e.message || e) + '）。');
      setStatus('没认：' + 没认.slice(0, 3).join(' ／ '));
    });
  }

  // ---- 收流：正文、围栏、chips 一起更新 ----
  function paint(msg) {
    // ★ 备课／讲评多删一档"整行就是一条画板赋值"的行（掉围栏时漏出来的 A=(-2,0)）。
    //   画图／出题不删——那两处的正文里出现一行 y=(x+1)(x-2) 是正常的。见 render.js 三条规则。
    var w = (SR.WORKS && SR.WORKS[work]) || {};
    //    ★★ `收尾: !msg.streaming` —— **这一条是作图能不能上板的关键**。
    //       paint 每收到一截就调一次（见下面 onChunk），流式当中 `msg.raw` 是半截的；
    //       图省事写成 `收尾: true` 的话，围栏头掉了的那种块会被**半截**交出去
    //       （实测："ggb ⏎ #" 这一瞬就长成一块），而 `msg.ggbDone` 是个只增不减的
    //       下标 → 完整那一块永远轮不到画（板上一件都没有）。见 render.js 的 opts.收尾。
    var p = SR.render.parseFences(msg.raw, { stripAssign: !!w.stripAssign, 收尾: !msg.streaming });

    // ★ 2026-10-02：把这一轮围栏里的画板命令留在消息对象上，**给打包用**。
    //   打包（js/pack.js）要的是"这一场从头到底一共画了哪几张图"，
    //   而这份清单只有解过围栏才知道。在这儿顺手挂一份，收完流那边就不用
    //   把同一段正文再解一遍——**解两遍就是两份规则，早晚会漂**。
    msg.ggbAll = p.ggb;
    // ★ 同上，说明那一份（```ggb 后面方括号里那句）也留一份：自修回滚时要把
    //   这一页的标题按原样写回去（见 去问 里那条回滚路），没它标题就只能瞎猜一个。
    msg.ggbInfoAll = p.ggbInfo;

    // 正文
    var v = p.visible;

    // ---- 出材料：围栏掉了就本地捡回来 ----
    // ★ 为什么在正文这里动手（而不是等收完流再补）：编号行**绝对不能印在气泡上**。
    //   免费通道那颗 GLM 实测就是把三十几行 `#0 … #2 …` 直接倒进正文的，
    //   晚一步处理，老师就已经看见那串鬼东西了。
    // ★ 只捡不猜：`#数字` 顶格开头，在中文正文里不可能是别的东西。
    //   捡回来的照样走 produce 那条路（同一个中间结构 → 右栏预览 + 下载），
    //   所以"围栏写的"和"捡回来的"出的是同一种文件。
    // ⚠ 2026-10-02 改：原来这一档的条件是 `&& !p.mat.length`（"没有围栏才捡"）。
    //   **那条判据被免费通道那颗模型绕过去了**，而且绕得很难看：
    //   它这一轮把整份材料写了**三遍**——先光着写十几行 `#0 … #2 …`，
    //   再开一个 ```材料 围栏里**只放那一行 [图]**，最后把整份又写一遍。
    //   围栏是有的（新判据不成立），于是：
    //     · 气泡把十几行 `#0 第五周 周练卷` 原样印出来（最难看的那个坏法）；
    //     · 右栏只摆出**一张光图**（取的"最后闭合的围栏"正好是那一行 [图]），
    //       卷子一道题都没有——文件名还写着"出一份第五周的周练卷….docx"。
    //   现在改成：**两条来源都拿出来比一比，谁厚用谁**（按编号行数）。
    //   顺带一条不变：编号行**从气泡里一律拿掉**，跟用不用它无关。
    if (work === 'material' && SR.produce && SR.material) {
      var pk = SR.produce.pickSource(v, p.mat.length ? p.mat[p.mat.length - 1] : '');
      v = pk.rest;                       // ← 无论如何，编号行都不许留在气泡里
      if (pk.from) {
        // ★★ 2026-10-03：这份卷子长在**这一条气泡自己的**位置（`msg.matEl`），
        //   不再只往右栏那个单例里塞。为什么要改：右栏现在是**抽屉**，默认关着 ——
        //   出材料出完，老师眼前一个字的产物都看不见（阶段 B 撤右栏带出来的）。
        //   它本来就该跟产生它的那句话在一起（跟冻图同一条规矩）。
        if (!msg.matEl) {
          msg.matEl = document.createElement('div');
          msg.matEl.className = 'paperbox';
        }
        // ★ 这两样**取快照**，别存会变的全局：`cur`（选中的模板）老师随时会换，
        //   finish() 是几秒之后才回来重画的，那时候再去读，卡就印成了另一份模板。
        msg.matTpl = SR.material.current();
        msg.matTitle = fileTitle(msg.ask, msg.matTpl);
        msg.matFed = SR.material.feed(pk.body, msg.matTitle, msg.matEl);
        msg.matLifted = pk.n;
        msg.matFrom = pk.from;           // 'lift' 还是 'fence'——下面那段别再喂一遍
      }
    }

    if (!v && msg.streaming) v = '…';
    // 一串编号全被收进右栏、正文一个字没剩 → 气泡不能空着。
    // ★ 这一句是**本机说的，不是模型说的**。为什么照样要说：
    //   空气泡给人的印象是"它什么都没干"，而右边明明摆着一份卷子。
    //   这种时候沉默比一句大白话糟得多——**说清东西去哪儿了**就够。
    //   （跟 board.js 的 giveBlank、chips.js 的本地兜底是同一条规矩：
    //     凡是在免费通道上守不住的，都得有本地兜底兜着。）
    // ★ 为什么这一喂要在**流式当中反复做**（而不是等收完流再一次性摆）：
    //   一份周练卷两百来行，等收完再出现，老师盯着空右栏要盯十几秒，
    //   中间还会以为它没在干活。一行行长出来本身就是"它在做"的反馈——
    //   而且 `feed` 是纯的，重画不花钱。
    if (!v && !msg.streaming && msg.matFed && msg.matFed.ok) {
      v = '这份材料按你传的模板排好了，在右边——预览和下载都在那儿。';
    }
    if (v !== msg.lastVisible) {
      SR.render.renderInto(msg.bubble, v || '');
      // ★★ 上面那一句是**重写 innerHTML**（render.js:268），挂在这条气泡里的
      //   材料卡会跟着被洗掉。所以每次重写之后都得把卡再挂回去 —— **顺序不能反**，
      //   反了就是"卡在流式刚开始时闪一下、然后整场都不见了"。
      //   ⚠ 卡里的内容不用重建：`msg.matEl` 这个节点在 DOM 里被摘掉，但 JS 这边
      //     还握着它、innerHTML 也还在；下一次 feed 进来照样往同一个节点里写。
      //   （冻图和「复制这段」没这个问题：它们是**收完流之后**才挂的，
      //     那会儿 paint 的这条路已经不会再进这个 msg 了。）
      if (msg.matEl) msg.bubble.appendChild(msg.matEl);
      msg.lastVisible = v;
      scroll();
    }

    // 画板：只派新闭合的那些块，别重复执行
    //
    // ★★ 2026-10-02 改成**一块围栏 = 右栏一页**（`SR.tabs.drawHere`）。
    //   原来这儿是"multiFig 的工位只自动画第一张，其余收进气泡下面那个
    //   「图 1/图 2/图 3」切换器"。两件事因此一起没了：
    //     · 一个变式都得自己点一下才看得见（不点就永远没画过，而老师不知道有它）；
    //     · 切换器长在**气泡里**，往回翻三屏才能点，图上写着"图 2"——
    //       老师要的是"刚才那张数轴"，不是"第几条回复的第 2 张"。
    //   现在每个围栏进右栏自己的一页，顺序就是讲题顺序，全部同时活着。
    var multi = !!w.multiFig;
    while (msg.ggbDone < p.ggb.length) {
      var lines = p.ggb[msg.ggbDone].split('\n');
      var hint = p.ggbInfo ? p.ggbInfo[msg.ggbDone] : '';
      if (SR.tabs) SR.tabs.drawHere(lines, hint);
      else if (!multi || msg.ggbDone === 0) SR.board.run(lines);   // 老路径（多页没装起来）
      // 模型这一轮有图要画 → **把导图让开**，让老师看见它在画。
      // ★ 跟 tabs.js 点标签、board 的 view 钩子走的是同一个动作（`SR.mm.yieldToBoard`），
      //   一个名字三处调用——比让每处各自去猜"现在该不该切回画板"稳。
      //   产品那条规矩：新东西出来了，直接切过去看，别抢了又不说。
      if (SR.mm) SR.mm.yieldToBoard();
      // ★ 另外数一份"真画了东西的条数"：只有 #清空 的围栏不算画了图。
      //   实测带图那轮模型就爱发一个光秃秃的 ```ggb ⏎ #清空 ⏎ ```（它没东西可画）。
      //   要是拿 ggbDone 去判"它画没画"，就会以为它画了，本地补空数轴那条路会被顶掉。
      msg.ggbReal += 数实条(lines);   // 判据在 数实条 那儿，别在这儿另写一份
      msg.ggbDone++;
    }

    // ⚠ 原来这里还有一段「摆最后一个闭合的围栏」，2026-10-02 挪走了。
    //   现在**只有上面那一处**做决定（`SR.produce.pickSource`：两条来源比厚度），
    //   两处都喂的话，后喂的那一份会把先喂的对的一份顶掉——实测就是这么
    //   把一份完整卷子顶成"一张光图"的。

    // chips 等收完再出，免得半截就被点了
    msg.lastSay = p.say;

    // 留一份原始输出（含围栏），排查"它到底写没写围栏"时看这个
    SR.chat.lastRaw = msg.raw;
  }

  // ---- 发一条 ----
  function submit(forced) {
    if (busy) return;
    // ★★ 2026-10-06：「从这条重来」那一刀，先**接过来**（见文件开头 `pendingTrunc`）。
    //   接手就置空 —— 这一句下面紧跟着好几条 early return（没配 Key、空话、
    //   首屏拦下）。**任何一条早退都不该把那把刀留到下一句去**：
    //   留着的话，老师下一句随口的提问会把跟他没关系的几轮悄悄吃掉，
    //   而且屏幕上什么都不会说（他不是从这儿走的，不会往这上面想）。
    var 待截 = pendingTrunc;
    pendingTrunc = null;
    // ★★ 老师一开口，"补图"那一队立刻作废（2026-10-04，见 补图 那段）。
    //   为什么非收不可：补图是**借板**干活的（一趟十几秒），而老师这一问后面
    //   多半跟着一张要画的图 —— 不收手的话，他等的那张图会**排在一堆旧图后面**，
    //   屏幕上就是"问了半天没反应"，看着像卡死。
    //   ⚠ 位置必须在 `busy = true` 之前、也就是**最前头**：这一句下面紧跟着
    //     `SR.landing.intercept()` 和一堆早退的分支，挂在后面那些分支里
    //     就有"某些问法不收手"的窟窿。
    停补图();
    var text = forced != null ? forced : els.input.value.trim();
    var parts = pendingParts;
    if (!text && !parts.length) return;
    if (!SR.api.ready()) { SR.main.needKey(); return; }

    // ---- 首屏拦一道（见 js/landing.js）----
    // ★ 只在**这场对话的第一句话**上生效，而且只在这个框还是空场的时候：
    //   它替老师把"这句话是五件里的哪一件"判出来、把工位按好，就放行——
    //   所以大多数时候它**不改变发生的事**，只是顺便按了一颗按钮。
    //   ⚠ 位置不能更早（`busy` 和"空话就别发"那两道闸之后），也不能更晚：
    //     更早会连"没配 Key 该弹 Key 层"都抢走，更晚就已经把气泡画上去了。
    //   ⚠ 也不能更晚到 `busy = true` 之后——它里面会调 applyWork，
    //     那条路会 reset()，那就把刚画上去的气泡抹了。
    if (SR.landing && SR.landing.intercept()) return;

    // ---- 首屏还亮着就收起来（见 js/landing.js 底线③：首屏是个入口，不是一道闸）----
    // ★ 走到这儿 = 这一句**真要发**了。多数情况下首屏早收了（上面 intercept() 一
    //   归出工位就 pick()，pick 里自己 hide()），所以这一句是个空操作。
    // ⚠ 治的是**刷新回来**那条路：memo 把上一场对话接回来之后，landing.js 的
    //   blocking() 一见 hasUser() 就放行——那一步是故意写的，不能让首屏把老用户
    //   的话吞了；可"收首屏"这件事当年**只有 pick() 会做**，于是首屏一直亮着盖在
    //   对话上：老师打完字点发送，消息照发、画板照画、口袋照涨，
    //   **屏幕上一点变化都没有**。2026-10-03 在页面上亲眼见的就是这一屏。
    //   收起来之后 `#works` 那一行就露出来了（css `body[data-landing="1"] .works`），
    //   换工位照旧跳得过去——所以这不是把入口弄丢，是把它让开。
    if (SR.landing && SR.landing.hide) SR.landing.hide();

    // ---- 「从这条重来」：真丢那几轮（2026-10-06）----
    //
    // ★ 位置就钉在这儿，两边各有一条理由：
    //   · 不能再早 —— 上面那几条 return 是"这一句没发成"，没发成就不该丢东西；
    //     而且 `landing.intercept()` 得先有机会把首屏那一下处理掉（它只在这一场
    //     的第一句话上生效，而走到这儿说明**这场早就有话**了，正常走不到它）。
    //   · 不能再晚 —— 下面 `busy = true` 之后紧接着就要 `addUser`，
    //     而 `从这儿重来` 走的那趟 `reset()` 会把 `#msgs` 清空重画；
    //     顺序反了的话，新气泡先摆上去、紧接着被重画抹掉，老师按了发送**什么都没发生**。
    // ★ 截断失败（`n` 不在账本里）不报错、也不拦：那一刀没落下去，
    //   这一句就照常当"又说了一遍"发出去 —— 那正是老师按「修改」之后
    //   说"不改了、原话重说一遍"时想要的。
    if (待截 && 待截.n >= 0) 从这儿重来(待截.n);

    busy = true;
    els.send.disabled = true;
    // ★ 收敛保护翻篇（2026-10-04，见 js/converge.js）：老师又发了一句 = **上一轮到此为止**，
    //   在这儿结算它（上一轮有画没落地 → 连败+1；全须全尾 → 清零），然后开新的一轮。
    //   ⚠ 位置钉死在 `busy = true` 这一句旁边，两个理由：
    //     ① 走到这儿 = 这句话**真要发**了。前面那些 return 都是"没发送成"
    //        （没配 Key、首屏拦下、空话），拿那些去结算老师的轮次是错的。
    //     ② 它必须**早于**这一趟的 buildSystem —— buildSystem 读的就是结算后的数，
    //        顺序反了就会少算一轮（design 的命门，也写在 converge.js 顶上括号③）。
    if (SR.converge) SR.converge.翻篇();
    自修过了 = false;                 // 新的一问 → 自修那一趟重新有资格跑（见 试自修）
    // ★ 老师又发了一句 = 翻篇：上一句的图**还在板上**（板是累积的，见 freezeFences 那一段），
    //   但"这一页该是什么样"已经由新这一句说了算。上一句的自修那一趟要是还悬在半路，
    //   它拿着的旧存档就是**上一道题**的了 —— 装回去等于把新题顶掉（见 局面数）。
    局面数++;
    if (forced == null) { els.input.value = ''; autoGrow(); }
    clearChips();
    pendingParts = [];
    pendingNote = '';
    renderStrip();

    seamIfWorkChanged();
    // ★ 2026-10-06：把这条气泡**攥在手上** —— 收到答复之后要往它身上钉门牌
    //   （`data-mi`，见下面 `.then` 成功那一支），「修改 / 重新发送」按它算
    //   "从第几条重来"。钉在这儿而不是 addUser 里面：那会儿账本还没写进去。
    var userEl = addUser(text, parts);
    // 兜底按钮要判"这段对话走到哪儿了"，所以在推入这一轮之前先记两个东西
    var isFirstTurn = !history.some(function (m) { return m.role === 'assistant'; });
    // 这一场的第一句话就是**课题**，拿去给压缩包起名（见 js/pack.js 的 fileName）。
    // ★ 后面几轮的话不能拿——那会儿他说的是「接着往下。」「这句我说不出口」，
    //   包名会变成"数根-接着往下。.zip"。
    if (isFirstTurn && SR.pack) SR.pack.setTopic(text);
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

    var msg = { raw: '', bubble: b, streaming: true, ggbDone: 0, ggbReal: 0, lastVisible: null, lastSay: [], ask: text };
    setStatus('');

    // ★★ 2026-10-05：这一轮算哪个工位，**在这儿定下来，之后不许再变**。
    //
    //   病（孔老师截图 + 原话「提示词为啥变成组卷的了。切换回作图还是这样」）：
    //   上面那个 `work` 是**发请求那一刻**读的，而下面 `.then` 里记进账本的
    //   `work` 是**回答回来之后**才读的 —— 中间隔着十几秒到几十秒，而工位那一行
    //   **没有 busy 闸**（`js/main.js` 的「工位切换」那一段直接 applyWork）。
    //   老师等得不耐烦点一下工位，这一个值就换人了：
    //   请求走的是作图（回复确实是作图的口径，画了 ggb），账本却记成组卷。
    //   而气泡底下那三颗按钮是照账本里的 `t.w` 挑的（见 js/chips.js 的分派与
    //   `repaintLog` 那条重画路），于是那一条底下**永远顶着另一个工位的词**，
    //   而且怎么切工位都改不回来 —— 重画读的还是这条记录。
    //
    //   ★ 隔离探针里量到的（`C:\tmp\查串工位.cjs`）：发出去时 getWork=draw，
    //     回答没回来把工位点到组卷，账本记 `w="material"`。
    //
    //   所以这一轮的身份跟着**出发时**那一个走：跟模型说话、记进账本、
    //   底下挑那三颗按钮，三处用的是同一个值。**别再改回 `work` 去读。**
    var wk = work;                        // 这一轮的工位（下同：ask／lastMeta／账本／底下那排按钮）
    SR.api.ask({
      work: wk,
      history: history.slice(0, -1),      // 最后一条（刚推入的）由 api 自己拼
      text: text,
      parts: parts,
      onChunk: function (piece) { msg.raw += piece; paint(msg); }
    }).then(function (res) {
      msg.streaming = false;
      // 这一轮到底是哪颗模型答的、有没有中途换过模型——探针要看这个。
      // ★ 2026-10-01 加：备课／讲评带图那轮走的是 modelsImage（只有一颗 glm-4.6v-flash），
      //   排查"是不是悄悄降级到会解题的那颗了"必须能看出来，光看回复内容看不出来。
      var hadImg = false;
      for (var qi = 0; qi < parts.length; qi++) if (parts[qi].kind === 'image') { hadImg = true; break; }
      SR.chat.lastMeta = { model: res.model || '', image: hadImg, work: wk, error: res.error || '' };
      if (res.error) {
        msg.出错 = true;                 // 这一轮压根没答成 → 别去自修（见文件末尾 试自修 那一句）
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
        // ★ 2026-10-06（方案⑤）：这道闸原来直接 `slice(-MAX_TURNS)`，切在哪儿全看
        //   条数——切出一个"开头是模型自己那句空话"的半个轮次，api 那边刚治好的病
        //   就从这儿又漏回来。切点交给 api 的 `裁到轮界`（规矩只有一条：
        //   0 或一条 user），它挪不动就原地不动。
        if (history.length > MAX_TURNS) {
          var 切 = history.length - MAX_TURNS;
          if (SR.api && SR.api.裁到轮界) 切 = SR.api.裁到轮界(history, 切);
          history = history.slice(切);
        }
        // ★ 这一轮成了 → 记进浏览器里那份**统一记忆**（见 js/memo.js）。
        //   **老师一条、模型一条，一起推**；而且只在这一支推——
        //   失败那一支上面刚把 user 从 history 里 pop 掉了，只记模型那条的话
        //   `SR.memo.history()` 就跟 `history` 对不上了，而"对不上"在屏幕上完全看不出来，
        //   要等下一轮模型答得驴唇不对马嘴才会被人发觉，那时候已经查不到是这儿。
        if (SR.memo) {
          // ⚠ 这里一律写**长的那套词**（'user'/'assistant'），别写 'u'/'a'：
          //   memo.js 两种都收（见那边 pushTurn 的注释），照抄上面 history.push 的措辞
          //   读起来才对得上——这是"同一件事的两个朝向"该有的样子。
          SR.memo.pushTurn('user', SR.api.userContent(text, parts), wk);
          SR.memo.pushTurn('assistant', res.text, wk);
          // ★★ 2026-10-06：门牌**只在这一支钉**（成功、两条都进了账本之后）。
          //   失败那一支上面刚把 user 从 history 里 pop 掉了，账本里也**没有**这一轮——
          //   在这儿钉号的话，那条气泡会顶着一个**别人的号**（账本里那个位置是上一轮），
          //   老师按「重新发送」，丢掉的是一段跟他点的那条没关系的话。
          //   没有号（`账本号` 返回 -1）时那三颗按钮退化成"再说一遍"，正是失败那轮该有的样子。
          // ⚠ `length - 2`：刚推进去的是 user、assistant 两条，user 在前。
          if (userEl && SR.memo.turns) {
            userEl.setAttribute('data-mi', String(SR.memo.turns().length - 2));
          }
        }
        paint(msg);
        // ★ 2026-10-01 砍掉了原来那段**空气泡兜底**（学生说"画不出来"时本地补一张空数轴、
        //   再代它招呼一句）。它是纯学生侧的东西，四个工位里一个都不需要：
        //   · 画图／出题：老师自己画图、自己出题，模型不出图就是它偷懒，替它圆场是错的；
        //   · 备课／讲评：老师卡住的时候不会说"画不出来"，他要的是下一句问话。
        //   留着它只会让"模型这一轮什么都没说"这件事变得看不出来。
        // 进度条：把这一轮**真摆出来的**那些节吃进槽位，然后重画。
        // ★ 判的是这一轮它真写出来的那行节标题，不是它报的计划——计划是预测、会漂，
        //   条子只画事实（见上面 stepSlots 那段）。第一轮给的是"几路"，读出来是 0，
        //   槽位还是空的，条子就仍然藏着，正合预期。
        absorbChain(String(res.text || ''));
        var nowAt = SR.inferStep({ prevAssistant: String(res.text || '') });
        if (nowAt) stepNow = nowAt;      // 读不出来 = 原地不动，绝不退回第 1 节
        renderSteps();
        // 口袋里添了什么。★ 位置**必须压在 absorbChain 后面**：它记的「链」是
        //   已经摆到第几节，而节号就是上面那一句刚吃进来的。放到前面去，
        //   口袋里永远写着上一轮的节数——刚摆完第 5 节，那儿还写着 4。
        // ★ 一律**照这一轮的原文数**，数不出来的一项就干脆不记：
        //   宁可口袋里没有这一项，也不要写一个不是那么来的数进去
        //   （这就是 [[scanner-numbers-are-not-what-they-claim]] 那条教训——
        //    口袋上那个数，老师会当成事实读）。
        if (SR.memo) {
          //    ★ 到这儿流已经收完了（上面 `msg.streaming = false`）→ 收尾。
          // ★★ 2026-10-06 夜：这几行原来读的是**实时的 `work`**（模块级那个，见文件开头
          //   `var work = SR.DEFAULT_WORK || 'prep'`），而上面 2582 行刚立过一条规矩：
          //   「这一轮的身份跟着**出发时**那一个走……**别再改回 `work` 去读**」。
          //   `.then()` 是**等回来之后**才跑的，中间老师点一下工位，`work` 就换人了，
          //   可 `wk` 没变。这不是纸上的担心：同一段上面 2577 行记着探针量到的那次事故
          //   （发出去时 draw，回来时被点到 material，账本记成 material）。
          //   账本那三处当时跟着 `wk` 改了，**这三处漏了**，后果是：
          //     · `produced(work, …)` 把这一轮的产出**记到另一个工位的口袋里**——
          //       口袋里那个数是老师会当事实读的（一次组卷的"一份材料"会被写进
          //       "题 N 道"，见 memo.js 的 SAY[work].k）；
          //     · `SR.WORKS[work].stripAssign` 换成了另一格的解析开关；
          //     · 最要命的是下面那句 `work === 'material'`：材料那一轮要是被中途点走，
          //       配图这一步**整个不跑**，而少一张图是**悄无声息**的——
          //       老师翻到那道题才发现，那时候他已经印了（见 js/material.js 的 finish）。
          var wp = SR.render.parseFences(res.text, { stripAssign: !!((SR.WORKS[wk] || {}).stripAssign), 收尾: true });
          SR.memo.produced(wk, {
            fig: (wp.ggb || []).length,                                  // 这一轮开了几个 ```ggb 围栏 = 几张图
            // ★ 数法在 js/memo.js 的 countProbs 里，跟口袋里的题号共用同一对正则——
            //   两种形状（组卷的题号行 / 命题的「变式一」小标题）认的是同一个格式契约，
            //   分开放就会有一份忘了改，而忘了改的那一份只是数不准：屏幕上照旧什么都看不出来。
            prob: (SR.memo.countProbs ? SR.memo.countProbs(res.text) : 0),
            paper: (msg.matFed && msg.matFed.ok) ? 1 : (wp.mat || []).length,  // 这一轮排出了几份材料
            chain: stepSlots.length                                      // 已经摆到第几节
          });
        }
        // 出材料：收完流了，**现在才画配图**（流式期间只摆文字，理由见 material.js 的 finish）。
        // ★ 放在这儿而不是 paint() 里：paint 每收到一截就调一次，
        //   在那儿画会让画板反复重画几十遍。
        if (wk === 'material' && SR.material && msg.matFed && msg.matFed.ok) {   // ★ 见上面那段：`wk`，不是实时的 `work`
          SR.material.finish(function (r) {
            // 有图没画出来 → 那一行已经撤掉了，但**得说一声**：
            // 悄悄少一张图，老师翻到那道题才发现，那时候他已经印了。
            if (r && r.dropped) {
              noteUnder(el, '有 ' + r.dropped + ' 张图没画出来，那几行我撤掉了——'
                + '要么把题目里要画的东西说得再具体点，要么去 GeoGebra 那边自己画好、存图贴进来。');
            }
          });
        }
        // ⚠ 原来这儿挂的是出题工位那个「图 1 / 图 2 / 图 3」切换器，2026-10-02 拿掉了：
        //   一圈三张图现在各进右栏自己的一页，不需要第二个门（见上面那段墓志铭）。
        // 备课／讲评：这一条回复底下挂「复制这段」。
        // ★ 拷的是 `msg.lastVisible`——**老师在气泡上看到的那一份**，不是原始输出。
        //   两者会差在 render.js 删掉的东西上（漏出来的 ```ggb 围栏和里面的画板命令、
        //   整行的赋值、"想说"围栏）。那些东西要是跟着进了剪贴板，
        //   老师是把它们贴进教案里的，一贴就是一串 `A=(-2,0)`。
        //   链子那四行两份完全一样，所以拷"看得见的那份"只会少掉垃圾，不会少掉链子。
        // ★ 2026-10-02：先把它记进打包的账本，再挂按钮——按钮拿的是这个**序号**
        //   （"到这一段为止"）。顺序反了的话，按钮上写着的序号会带着这一条还没进账的
        //   空档，点下去少一段。
        // ★★ `msg.lastVisible != null ? … : res.text`——**不能用 `||`**。
        //   `lastVisible` 初值是 `null`（= 压根没渲染过），而"渲染出来是空的"是个**合法的结果**：
        //   整条回复就是一块被捞回来的命令围栏时，`p.visible` 就是空串（实测那一轮：64 字的
        //   原始输出里一个字都不该给老师看）。`||` 把空串跟 `null` 一视同仁 → 回退成 `res.text`
        //   → **一串 `A=(-2,0)` 直接进了打包账本和「复制这段」的剪贴板**，
        //   老师是要把这些贴进教案里的。见记忆「检测脚本的数字不是它宣称的那件事」同族：
        //   读数的意思错了，不是读数错了。
        var 看得见 = msg.lastVisible != null ? msg.lastVisible : res.text;
        // ★★ 2026-10-05：第三个参数是**老师那句问**（`text`，就是上面 addUser 摆进
        //   气泡里的那一串）。绿行那套勾选是"一问一答成对"带走（孔老师定的），
        //   账本里没有问，勾出来的节选就只有一串没头没脑的答复。
        //   ⚠ `text` 是 submit 作用域里的那一份，**不是** `msg.raw`（那是模型的原始
        //     输出，含围栏）；也不是下面 `看得见`（那是**答**）。
        var ti = SR.pack ? SR.pack.note(看得见, msg.ggbAll || [], text) : null;
        // ★ `data-turn` **无条件**挂（在 copy 那道闸**外面**）：绿行的勾选覆盖六个工位，
        //   而 `copy: true` 只有三格。挂在里面的话，作图那几格的回复永远勾不上。
        //   ⚠ `ti == null`（账本没装）时**一个号都不挂**，不是挂 "0"——
        //     挂 0 会让这一条看着像"账本里第 0 条"，而它根本不在账本里，
        //     勾上之后打进包的是**另一条**的内容，包看着还是完整的。
        if (b && ti != null) b.setAttribute('data-turn', String(ti));
        // ★ 2026-10-06：原来这儿是 `if (SR.WORKS[work].copy)`，那道闸撤了 ——
        //   六个工位一律给「复制这段」（理由见 repaintLog 里同一处的长注释）。
        attachCopy(b, 看得见, ti);
        // 绿行上那两颗按钮要重算一次（「打包」上的条数、以及挑选模式里新摆下的那条）。
        if (SR.packui) SR.packui.sync();
        // ---- 冻图：这一轮的每一份 ```ggb 围栏，各截一张钉在这条气泡底下 ----
        // ★★ 时机就在这里，**不在 paint() 那个流式循环里**：paint 每收到一截正文
        //   就调一次（一轮几十次），在那儿出图会把画板洗几十遍，老师眼看着板子抽风；
        //   而且围栏还没闭合时拿到的是半截命令。
        //   `msg.ggbAll` 是 paint 最后一次解围栏的结果，此刻已经是完整的。
        // ★ 不发包（ti 为空）也照样冻：打包是"带走"那条路，冻图是"看着"那条路，
        //   两件事，不该绑在一起。
        // ★ 顺序：**先把框摆上、再去冻**。反过来的话，借板+截图要好几秒，
        //   这几秒里那条回复底下什么都没有——老师会以为这一轮没出图。
        var fl = msg.ggbAll || [];
        if (fl.length) {
          var boxes = [];
          // ★ 一律以 `'wait'` 那一档摆框：这几行**下面紧接着**就去冻图了，
          //   所以从框出现的那一刻起，"有人正在出图"就是**真话**。
          //   （实测这段要 13 秒上下，原先空白占位那 13 秒看着就是卡死了。）
          for (var fi = 0; fi < fl.length; fi++) boxes.push(attachFigure(b, fl, fi, '', 'wait'));
          // ★ 每张图钉回它自己那道题下面（原文就是这一轮的 raw）。
          //   注意此刻「复制这段」那条 bar 已经在里面了（上面 attachCopy 先跑），
          //   所以"最后一张"能落到它前面 —— 见 placeFigures 里的兜底那一支。
          placeFigures(b, msg.raw, boxes);
          freezeFences(fl, function (got) {
            for (var gi = 0; gi < fl.length; gi++) {
              // ★ 不管这一格冻上没有，**都要**回来刷一次：
              //   冻上了 → 贴图；没冻上（借不到板 / 这条命令画不出来）→ 落回
              //   那一档**可点**的「图」，老师手动点一下还有一条路。
              //   漏了这一次的话，失败的那几格会永远停在"正在出图…"上 ——
              //   那比原来那句「点一下画出来」更坏：它是一句永远不兑现的承诺。
              if (boxes[gi]) fillFigure(boxes[gi], fl, gi, '', '');
            }
          });
        }
        // ---- 卷子卡挪到这一条的最后 ----
        // ★ 流式期间它每收一截就被 renderInto 洗掉一次、又被挂回末尾（见 paint 里那段），
        //   所以收流那一刻它**排在「复制这段」和冻图前面**。这几行都挂完了再挪一次，
        //   这条回复的顺序才是：正文 → 图 → 卷子 → 带走用的按钮。
        //   （`appendChild` 对已经在里面的节点就是**挪位置**，不会复制一份。）
        if (msg.matEl) b.appendChild(msg.matEl);
        // 思维导图跟着这一轮长出来（js/mindmap.js 的 refresh）。
        // ★★ 位置**必须在这一句 SR.pack.note 后面**：导图画的正是那份账本
        //    （SR.mm.chainDoc 读的是 SR.pack.turns()）。放到前面去，导图就永远
        //    **慢一轮**——刚摆完这一节，导图上还停在上一节，而下一轮一画又对上了，
        //    于是这种错看着像"偶发的延迟"，没人会往顺序上想。
        //    （孔老师原话：「右边的画板应该要可以有思维导图的同步形成」。）
        // ★ 导图没开着的时候这条几乎不花时间：refresh 一量到它的盒子是 0 宽
        //   （display:none）就直接返回，不会白画一张。
        if (SR.mm) SR.mm.refresh();
        setStatus(SR.api.usageText());
        // ★ 流水线的最后一步（「摆到屏幕上」）**收到这儿才算完**：
        //   认链子、摆围栏、画配图、挂「复制这段」、刷导图——全都在这几行里发生。
        //   让 api.js 去标它就会写成"模型说完的时刻"，那是另一个时刻（见 js/flow.js 的 paintDone）。
        if (SR.flow) SR.flow.paintDone('链子、围栏、图、台阶都摆完了');
        // ★ 摆完了再把它**搬进这条回复**（见上面 flowEl 那段长注释）。
        //   ⚠ 顺序是反的会出一个很细的毛病：先搬后标的话，那一步的"跑完了"是在
        //     已经挂上去之后才写的 —— 老师会看见流水线在气泡里又亮一下。
        //   判据用 flowLive()：画图／出题那些工位没有账本，块留在抽屉里不动。
        if (flowLive()) homeFlow(b, true);
        // ---- 「想说」摆在最后（阶段 G）----
        // ★ 位置从上面（`absorbChain` 之前）**挪到了这儿**：它要挂在气泡的**末尾**，
        //   而在上面那几行跑完之前，这条气泡后面还会长三样东西——「复制这段」、
        //   冻图、卷子卡、还有流水线。谁先 append 谁在前，所以只能等它们都落了位。
        // ★ 模型写了 ```想说 就用它的（更贴这道题）；没写就用本地兜底。
        //   免费通道那两颗小模型守不住这个围栏（实测 0/4 ~ 6/6 看运气），
        //   而"这一轮没有可点的话"正是这个功能要防的事——不留一个空白的输入框。
        //   兜底词库和挑选规则见 js/chips.js 顶上的注释。
        var modelChips = (msg.lastSay && msg.lastSay[0]) ? msg.lastSay[0].split('\n') : [];
        modelChips = SR.filterCopiedChips(modelChips);   // 把提示词里那段示范原样抄回来的挡掉
        // ★ 2026-10-04：作图那三颗兜底按钮要按"图上画的是立体还是平面"挑词
        //   （孔老师 2026-10-03 截图那三条"画个正方体／换成三维，再画个球"，
        //    摆在一条**平面的数轴**底下——见 js/chips.js 的 SR.CHIPS.draw 那段）。
        //   证据取**助手回复的原文**：历史里那些，外加刚收完的这一条 `res.text`。
        //   ⚠ 顺序是"从旧到新"，规则在 SR.dimFromTexts 里（最近一条真画了图的说了算）。
        //   ⚠ 必须跟重画那条路（restoreText）传的是**同一个东西**，
        //     否则刷新前一套词、刷新后另一套——那正是这一片注释反复在防的事。
        var dimTexts = [];
        for (var hj = 0; hj < history.length; hj++) {
          if (history[hj].role === 'assistant') dimTexts.push(String(history[hj].content || ''));
        }
        dimTexts.push(String(res.text || ''));
        showChips(modelChips.length ? modelChips : SR.fallbackChips({
          work: wk, first: isFirstTurn, lastUser: text, prevAssistant: prevAssistant,
          is3D: SR.dimFromTexts(dimTexts),
          texts: dimTexts   // ★ 跟重画那条路（restoreText）传的是同一个东西，见 chips.js 那段
        }), b);
      }
    }).catch(function (e) {
      msg.streaming = false;
      msg.出错 = true;
      b.innerHTML = '<span class="err">出错了：' + SR.render.esc(e.message || e) + '</span>';
    }).then(function () {
      busy = false;
      els.send.disabled = false;
      els.input.focus();
      // ---- 收工之后再补最后一次贴底 ----
      //
      // ★★ 2026-10-03 在页面上量出来的：上面那些 scroll() **全在收流过程中**调的，
      //   而这一轮收工之后对话区还会变一次——「想说」那三颗建议是这时候才冒出来的。
      //   它们顶在输入框上面，把对话区**从底下压掉 53px**：
      //     实测（1440×900，一条带「想说」的回复）
      //       发之前    可滚 1083 / 看得见 541 / 差多少到底 0
      //       收工那一刻 可滚 1330 / 看得见 488 / 差多少到底 **53**，末条被切 33px
      //       再等 1.5 秒 还是 53 —— 没有任何东西会把它补回来
      //   （`可滚` 涨的是新那一轮，`看得见` 掉的就是那三颗建议占走的。）
      //   后果：老师刚收到的那条回复，末尾正好停在屏幕外面，得自己往下滚一下才看得见结尾。
      //   ★ 这不是偶尔：**「想说」是核心协议**，一多半的回复都带它；而且每次
      //     建议从"没有"变成"三颗"（或三颗折成两行）都会来这么一次。
      //
      // ⚠ 位置必须在这个 .then 里，不能在收流那几行里：这儿才是"全都摆完了"的时刻
      //   （挂 bar、刷导图、写状态栏、paintDone 都在它前头），出错那条路也一并照顾到。
      //   跟本文件别处一样**无条件贴底**——每一段新字都是这么滚的，不另立一套规矩。
      scroll();
      // ---- 「画板没认」→ 让模型自己改一次 ----
      // ★ 位置就在这儿（收工那一刻）：板子这时才开始画、而且 `busy` 刚放下来，
      //   所以 试自修 里那道"还有人（老师）在发东西"的闸是有意义的。
      //   它自己会等板子停下来再动手，不在这儿阻塞。
      // ⚠ 放在 `scroll()` **后面**：它一上来就 `noteUnder` 补一句、要贴底，
      //   反过来的话那句会被上面这次没算上它的 scroll 顶到屏幕外面去。
      if (!msg.出错) 试自修(el, msg);
      // ⚠ 它排在 试自修 **后面**：自修那一趟可能正把这一页换掉，
      //   而这条补话要读的正是"换完之后板上有不有播放键"。
      //   两条都挂在同一条气泡底下（各自一句），互不挡道。
      if (!msg.出错) 说播放这一茬(el, msg);

      // ---- 作图模板那一份骨架，用完就作废（见 js/drawtpl.js 的 `收`）----
      // ★ 治的是这么一件很具体的坏事：老师从模板点了一张图，下一轮随口问句别的，
      //   骨架要是还赖着不走，模型会**莫名其妙又画一遍那张图**——而老师什么都没要。
      // ★ 位置放在**这一串的最后**（不是开头）：上面 `试自修` 那一趟也走模型、
      //   也过 buildSystem，留着骨架它才改得准。
      // ⚠ 挂在收工 `.then` 里而不是挂在 `extra` 自己身上：`extra` 一轮可能被调两次
      //   （重试 / 自修），在它里面清会把后面那次要用的骨架弄丢。
      if (SR.DRAWT) SR.DRAWT.收();
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
    // ★ 2026-10-02：给思维导图用——点一条淡下去的岔路 = 老师说「先走第 N 条路。」
    //   （见 js/mindmap.js 的 onClick 和上面 teacherSays 那段）。
    //   点得动就回 true；空话回 false，导图那边据此什么也不做。
    say: teacherSays,
    onPlayState: onPlayState,          // 交给 board.init 当回调
    onStepState: onStepState,          // 同上：画板登记完 `#分步` 会回头喊一声
    setStatus: setStatus,
    // ★ 2026-10-05 加：绿行那颗「选择内容」进挑选模式时要把状态栏那句话**存下来**，
    //   退出时还回去。存的办法不该是"自己去 `#status` 上读 textContent"——
    //   状态栏是 chat 的东西，从 DOM 上把它读回来就是"同一个事实两处各算一遍"，
    //   哪天 setStatus 改成写别的节点，读的那边一个字都不会报错，只会读到空串。
    getStatus: function () { return els.status ? (els.status.textContent || '') : ''; },
    setWork: function (w) { work = w; },
    getWork: function () { return work; },
    // ★ 2026-10-05：「这一轮从发出去到收工」这段中间。外面要判"现在能不能动"就看它
    //   （底下那排按钮早就有一条同样的闸，见 showChips 里那句 `if (busy) return`；
    //   工位那一行是后来补的，见 js/main.js 的「工位切换」那一段）。
    //   ⚠ 名字不叫 isBusy：`SR.board.isBusy()` 已经有一个，那是"画板还在画"，
    //     跟"模型还没答完"是两件事，名字撞上了调用处迟早看串。
    isAsking: function () { return busy; },
    // 「这一份」那三格改完名字要把焦点还给输入框（见 js/memo.js 的 edit）。
    // ★ 不给回来的话：改完课题，光标落在一个刚被删掉的元素上，老师接着敲字
    //   **一个字都进不去**——而屏幕上什么都正常，看着像键盘坏了。
    focusInput: function () { if (els.input) els.input.focus(); },
    // 这一场里老师**说过话**没有。首屏只看第一句话（见 js/landing.js 的 blocking）：
    // 判据取"历史里有没有 user"，不取"屏幕上有没有气泡"——开场白也是一个气泡，
    // 拿气泡数去判的话，一进来就被判成"已经开说了"，首屏永远不出现。
    hasUser: function () { return history.some(function (m) { return m.role === 'user'; }); },
    // ★ 切工位一律走这个。备课↔讲评是**同一条链的两个阶段**，切过去不清历史，
    //   进度条就该**按整段历史重新推出来**，而不是被打回零。
    //   （原来这里还导出一个 paintStepBar，2026-10-02 删了：格数现在是动态的，
    //     "外部指定画第几格"这件事没有意义了，画什么完全由状态决定。）
    repaintSteps: repaintSteps,
    // ★ 模板从 IndexedDB 接回来之后再补一次卷子卡（见 paintMatCards 顶上那段）。
    //   main.js 在 `SR.material.restore()` 的 then 里调它。**不能**指望重画那趟：
    //   它在 chat.init() 里同步跑完，那时模板还在路上。
    paintMatCards: paintMatCards,
    // main.js 用这个判"输入框那边有没有东西等着发"（空了就别送空请求）
    hasPendingImage: function () { return pendingParts.length > 0; },

    // —— 探针用的口子（test/probe_files.cjs）。不参与界面逻辑，也别在界面里调。
    __parts: function () { return pendingParts; },
    __clear: function () { pendingParts = []; pendingNote = ''; renderStrip(); },
    // 冻图那两个（test/probe_stream.cjs 的 ⑥⑦）。★ 导出的用意**不是**当公开 API，
    //   是让探针能**直接问它"你冻出什么了"** —— 图没冻上时屏幕上只留一块空占位，
    //   从 DOM 上根本看不出是"板忙"还是"命令画不出来"还是"截图为空"。
    __freeze: freezeFences,
    __figCache: function () { return figCache; },
    // 「正文里让人点播放键」这条判据（test/probe_playclaim.cjs）。
    // ★ 导出它是因为**这一档失败没法靠真模型复现**：它写不写"点播放键"是随机的，
    //   而这一条闸要防的恰恰是"它写了、板上却没有"。让探针能直接拿好/坏两段原文
    //   喂进来验判据，比等模型赏脸可靠 —— 也才查得出"尺子本身是不是瞎的"。
    __说播放这一茬: 说播放这一茬
  };
})();
