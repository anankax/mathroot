// 资料库面板（界面那半）。左边那条 `#toolrail` 里 📚 那颗按钮开的就是它。
//
// ★★ 它治的是哪一句话（孔老师 2026-10-07 原话）：
//   「读取端口肯定是要有的，而且不光是组卷备课，我这个 agent 要完全能读，不光是这些技能。
//     还有 key 页面拿掉就算了，我这个 cloudbase 主要还是为了搞个云存储库的。」
//   ⇒ 云上那份库（桶 `materials` 1413 个对象 + PG `res_chunks` 七千多块正文）**早就是活的**，
//     缺的只是"老师自己这一双手够得着"。模型那一头够得着的口子是 ```` ```查 ```` 围栏
//     （见 js/render.js / js/chat.js 的 `补查`），**这一份是给老师本人的**。
//
// ★★ 三条设计纪律，改这个文件之前先读：
//   ① **不经过模型、不花额度**。搜和列走的是云函数 `reslib` / `liblist` 两步，
//      gate 那边它们记的是 `KB_DAILY_CAP`，不是调模型那个 `DAILY_CAP`。
//      所以这个面板可以随便点，跟对话那一路互不影响。
//   ② **一次请求都不许在开机时发**。挂监听、不干活：真正的取数只在
//      「翻一翻」/「库里有什么」被点的那一刻。开面板本身也**不发**任何请求。
//   ③ **一个字都不写死**（命中、分数、书架、页号、名单全是云上现回的）。
//      在这儿写死一份就是给库开了第二个真源——库里添了材料，这份死名单不会跟着动，
//      而屏幕上看着完全正常。（同 `#works` / `#proj` 那两处立过的规矩。）
//
// ★ 为什么是**常驻面板**、不是浮层/弹窗：跟 `#tplp` 同一个道理——它一开把对话区顶高，
//   老师翻材料的时候上一条回复和他那张图还看得见；糊一层浮层正好把要看的东西盖掉。
//   ⚠ 所以 css 那边**方角细线、不圆角不投影**（圆角+投影是"浮层"的长相，
//     而全站唯一一处浮层是 `.toolrail` 自己）。给这一块加上去，
//     老师会以为"点一下别处它就没了"，可它不会。
//
// ★★ 有一件事**不在这一版里**，写下来免得后人以为是漏了：
//   面板里搜到的那几条**不会**顺手喂给模型。要模型用上库里的东西，走 ```` ```查 ```` 围栏
//   那条路（模型自己发起）。这里"搜 → 看 → 拿原件"是一条**人给自己用**的链，
//   跟"哪几块进了提示词"是两回事——混起来会让"我看到它搜出来了"变成
//   "我以为它读过了"，那是这个产品最容易骗人的一类错觉（见 js/flow.js 里
//   `pluckRes` 那条"没能全塞进去"的注释，同一个病根）。
SR.LIBUI = (function () {

  var 在飞 = false;      // 一次只跑一趟（云上冷启动十来秒，连点会排队等）
  // 那一行提示分**两截**：`基线` 是"这一趟翻成什么样了"，`临时` 是"刚才那一下干了什么"。
  // ★ 为什么不共用一个格子：只留一截的话，「拿原件」那句会把"翻到 8 条"顶掉，
  //   而老师正对着那份名单在挑——他挑到一半，头顶那句说明没了。
  var 基线 = '';
  var 临时 = '';

  function $(id) { return document.getElementById(id) }

  // 本机那一页。★ 判断只看 hostname，不去 ping——这条只是用来换一句**更准的提示语**，
  //   不是功能开关。判错了最多提示语差一句，功能一样跑。
  function 本机() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || location.protocol === 'file:';
  }

  // ---- 开／关 ----
  // ⚠ 原来这儿写着"跟 js/drawui.js 那四行一一对应，故意长得一样"。2026-10-08 📐
  //   （drawtpl.js / drawui.js）**跟这条栏一起撤了**，而 📚 当天搬了回来——
  //   所以现在这条栏里只有这一块面板，"跟谁长得一样"那句话没有对象了。
  //   这四行的形状留着（它就是"开 = 去掉 hidden + aria=1 + 给焦点"这个最普通的写法）。
  function 开() {
    $('libp').hidden = false;
    var b = $('libbtn');
    if (b) b.setAttribute('aria-expanded', '1');
    var q = $('libp-q');
    if (q) q.focus();
  }
  function 关() {
    $('libp').hidden = true;
    var b = $('libbtn');
    if (b) b.setAttribute('aria-expanded', '0');
  }
  function 开着的() { return !$('libp').hidden }
  function 切() { 开着的() ? 关() : 开() }

  // ---- 小零件 ----
  function 字(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d;
  }
  function 一行(cls, txt) {
    var d = 字(txt);
    if (cls) d.className = cls;
    return d;
  }
  function 清(盒) { while (盒.firstChild) 盒.removeChild(盒.firstChild); }

  // 一段正文的**头一行**，给列表底下垫一句"这条讲的是什么"。
  // ★ 为什么取头一行、不取前 80 个字：库里那些正文第一行往往是标题
  //   （`§2.2 数轴`、`第3章 代数式`），比从中间切一段好认得多；
  //   从中间切多半切在一句话腰上，读起来像乱码。
  // ⚠ 空正文（抽失败的、只剩壳的）要**明说"这块是空的"**，不能画一条空白——
  //   空白跟"这块内容就是这样"从外面看一模一样。
  function 摘要(b) {
    var t = String(b || '').replace(/\s+/g, ' ').trim();
    if (!t) return '（这块的正文是空的 —— 抽取那一步没留下东西）';
    return t.length > 110 ? t.slice(0, 110) + '…' : t;
  }

  function 短名(h) {
    if (SR.flow && SR.flow.shortName) return SR.flow.shortName(h);
    return String((h && (h.doc || h.title)) || '（没名字）');
  }

  function 路数(why) {
    if (!why) return '云上没答上来';
    // ★★ 本机那条 CORS 是**查实过的**、而且长得像"配置错了"（见 js/gate.js 那条长注释）：
    //   腾讯云网关对 localhost 这个来源在预检里回了两个 `Access-Control-Allow-Origin`，
    //   Chrome 判 MultipleAllowOriginValues，请求**根本没到函数**就被浏览器拦了。
    //   ⇒ 不把这句话说出来，本机看到「连不上云函数」就会去改配置，而配置是对的。
    //   ★ 2026-10-07 复测：这个形状**今天不复现**（本机现在撞到的是"云函数那头挂着"HTTP 443，
    //     见 js/gate.js 顶上那段）—— 但形状真出现时这句话仍然是对的，所以分支留着。
    //     别把"本机的失败"默认等同于这一种。
    if (本机() && /连不上云函数|Failed to fetch/i.test(why)) {
      return why + '。★ 本机这一页调云函数一直被腾讯网关那条 CORS 挡着（预检回了两个 '
        + 'Allow-Origin），只有线上那一页通 —— 不是配置错了，别去改它。';
    }
    return why;
  }

  // ---- 拿原件：两跳 ----
  // ① `libsign` 换一个**限时**地址；② 让浏览器自己去下（不经过 JS 缓冲）。
  // ★ 为什么不提前签好：签出来的地址只活一小会儿（`expires` 默认几百秒），
  //   签了不用，等老师想点的时候已经过期了 —— 那一下他会看到"点了没反应"，
  //   而这跟"原件丢了"长得一模一样。
  // ★ `?f=` 那个键**故意不复用**：一条命中上可能同时挂着"搜到了"和"拿原件"两种状态，
  //   共用一个键会让"签完把这一条整行重画了"，看起来像搜了一次。
  function 拿(键, 名, 按钮) {
    if (!SR.gate || !SR.gate.libSign) { 提示('这条路走不了：页面还没装好'); return; }
    var 原 = 按钮.textContent;
    按钮.disabled = true;
    按钮.textContent = '签…';
    SR.gate.libSign(键).then(function (j) {
      按钮.disabled = false;
      按钮.textContent = 原;
      if (!j || !j.ok || !j.url) {
        // ★ 报在**面板里**，不弹窗：全站没有一处 `alert`（错误都写在它自己那一块），
        //   而且弹窗一关，那句话就没了——他回头看"刚才说的什么"就找不着。
        提示('这份拿不下来：' + 路数(j && (j.why || j.error)));
        return;
      }
      // ★ 用一颗**真 `<a download>`**、而不是 `window.open`：前者下一份文件，
      //   后者在新标签里打开一份 pdf——老师要的是"存下来"。
      //   ⚠ 跨源时 `download` 会被浏览器忽略（这是规定），那就退化成打开一个新标签，
      //     不报错——所以别拿"下载框没弹出来"当"签名坏了"。
      var a = document.createElement('a');
      a.href = j.url;
      a.download = 名 || '';
      a.rel = 'noopener';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      提示('这份的下载地址已经给了浏览器（' + (j.expires || '') + ' 秒内有效）');
    });
  }

  // 说一句"刚才那一下"（拿原件成没成）。★ 只换临时那一截，基线留着。
  function 提示(t) { 临时 = t || ''; 刷新提示() }
  // 说一句"这一趟翻成什么样了"。★ 换基线时临时那一截一起清掉——
  //   上一趟的"签好了"跟这一趟的结果摆在一起，读起来像这一趟也签了一份。
  function 基线说(t) { 基线 = t || ''; 临时 = ''; 刷新提示() }
  function 刷新提示() {
    var n = $('libp-note');
    if (!n) return;
    n.textContent = 基线 + (基线 && 临时 ? ' ｜ ' : '') + 临时;
  }

  // ---- 一条命中 ----
  function 命中行(h) {
    var box = document.createElement('div');
    box.className = 'libp-hit';

    var 头 = document.createElement('div');
    头.className = 'libp-hithead';
    头.appendChild(一行('libp-score', Number(h.score).toFixed(2)));
    头.appendChild(一行('libp-name', 短名(h)));
    var 地 = [];
    if (h.shelf) 地.push(h.shelf);
    if (h.page != null && h.page !== '') 地.push('第 ' + h.page + ' 页');
    if (地.length) 头.appendChild(一行('libp-where', 地.join(' · ')));

    if (h.key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'libp-get';
      b.textContent = '拿原件';
      b.title = '下载这份材料（给自己拿原件，跟模型读的是同一份）';
      b.addEventListener('click', function () { 拿(h.key, 短名(h), b) });
      头.appendChild(b);
    } else {
      // ⚠ 没有 key 要说出来。静默不给按钮，看起来像"这一条就是这么设计的"。
      // ★ 用一个**自己的类名**（`libp-nokey`），不复用 `libp-where`：
      //   那一格是"书架 · 第几页"，这一格是"为什么没有按钮"，两回事。
      //   ⚠ 复用同一个类名会让"取这一行的说明"取到**前面那一格**——
      //     探针当场栽过这个（[[scanner-numbers-are-not-what-they-claim]] 里
      //     "整节断言量的是同一个隐藏元素"那一族）：读数看着有内容、其实读的是别处。
      头.appendChild(一行('libp-nokey', '（这条没带原件名，拿不了）'));
    }
    box.appendChild(头);
    box.appendChild(一行('libp-snip', 摘要(h.body)));
    return box;
  }

  // ---- 一趟：搜索 ----
  function 搜() {
    if (在飞) return;
    var q = String(($('libp-q') || {}).value || '').trim();
    if (!q) { 基线说('先写一句关键词 —— 两三个词最好。'); return; }
    if (!SR.gate || !SR.gate.reslib) { 基线说('这条路走不了：页面还没装好'); return; }
    在飞 = true;
    基线说('正在翻……（云上那一步冷的时候要十来秒，等一次就好）');
    清($('libp-hits'));
    var k = (SR.flow && SR.flow.STEPS && SR.flow.STEPS.reslib) ? SR.flow.STEPS.reslib.k : 3;
    // 面板给的是 8 条（对话那条链只吃 3 条）——**老师想多看点**，
    // 而多列几条不花额度、也不占提示词（这一份不走提示词）。
    var kk = Math.max(8, k);
    SR.gate.reslib(q, kk).then(function (j) {
      在飞 = false;
      var hits = (j && j.ok && j.hits) ? j.hits : null;
      if (!hits) {
        基线说('没翻成：' + 路数(j && (j.why || j.error)));
        return;
      }
      if (!hits.length) {
        // ★ "库里真没有"跟"云上挂了"要分得开（`路数` 那句只在上一条）。
        基线说('「' + q + '」在库里没翻到对得上的。换个词试试 —— 库里题名多半带着章节号。');
        return;
      }
      基线说('翻到 ' + hits.length + ' 条' + (j.rows ? '（库里共 ' + j.rows + ' 块）' : '') + '，按分数排。');
      var 盒 = $('libp-hits');
      清(盒);
      hits.forEach(function (h) { 盒.appendChild(命中行(h)) });
    });
  }

  // ---- 一趟：列桶（"库里有什么"）----
  function 列() {
    if (在飞) return;
    if (!SR.gate || !SR.gate.libList) { 基线说('这条路走不了：页面还没装好'); return; }
    在飞 = true;
    基线说('正在列桶……（一千多个名字，要拖一趟）');
    清($('libp-hits'));
    SR.gate.libList().then(function (j) {
      在飞 = false;
      if (!j || !j.ok || !j.items) {
        基线说('没列成：' + 路数(j && (j.why || j.error)));
        return;
      }
      var items = j.items;
      // ⚠ 这一行是**纯文本**（`textContent`），不是 markdown —— 别在这儿写 `**加粗**`，
      //   那四个星号会原样显示在老师眼前。
      基线说('桶里一共 ' + (j.n != null ? j.n : items.length) + ' 个原件。'
        + '★ 注意这是"一份文件算一个"；上面「翻一翻」数的是切好的正文块'
        + '（一份文件可能切出十几块）——两个数不一样是正常的。');
      var 盒 = $('libp-hits');
      清(盒);
      // ★ 一千多行一次性铺出来会卡一下。用**文档片段**一次插进去
      //   （逐条 appendChild 会让浏览器重排一千多次）。
      var frag = document.createDocumentFragment();
      items.forEach(function (it) {
        var box = document.createElement('div');
        box.className = 'libp-hit';
        var 头 = document.createElement('div');
        头.className = 'libp-hithead';
        // ★ 名字走云上回的 `name`（`prettyName` 还原过的、人读的那个）；
        //   它跟 `shortName()` 不是一回事——那个是**切块**那边的路径末段。
        头.appendChild(一行('libp-name', it.name || it.key));
        头.appendChild(一行('libp-where', it.size ? 大小(it.size) : ''));
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'libp-get';
        b.textContent = '拿原件';
        b.addEventListener('click', function () { 拿(it.key, it.name || it.key, b) });
        头.appendChild(b);
        box.appendChild(头);
        frag.appendChild(box);
      });
      盒.appendChild(frag);
    });
  }

  function 大小(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ---- 接线 ----
  function init() {
    var b = $('libbtn');
    if (b) b.addEventListener('click', 切);
    var x = $('libp-x');
    if (x) x.addEventListener('click', 关);
    var go = $('libp-go');
    if (go) go.addEventListener('click', 搜);
    var all = $('libp-all');
    if (all) all.addEventListener('click', 列);
    var q = $('libp-q');
    if (q) q.addEventListener('keydown', function (e) {
      // 回车就查。★ 但**不许冒泡出去**：`#input` 那条链也认回车，
      //   不拦的话会出现"查一次 + 把输入框里那句话发出去"两件事一起发生。
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); 搜(); }
      if (e.key === 'Escape') { e.stopPropagation(); 关(); }
    });
    // Esc 关掉。
    // ★★ 下面那两处（`capture` + `$('tplp')` 守卫）**原来的理由是 📐**：
    //   `document` 上那条 Esc 是**一起响**的（drawui.js 当时自己挂了一条），
    //   冒泡阶段我这条排在它后面，那时 📐 已经被它关掉了，我再看就永远看不到"它开着"，
    //   于是**两按一次 Esc、两个面板一起没**。capture 让我这条先跑，才看得到真实状态。
    //   ⇒ 一次 Esc 只收一层，跟 main.js 里"Esc 先管大窗再管抽屉"那条同一个分寸。
    // ⚠ 2026-10-08 📐 撤了（`#tplp` / `#drawtplbtn` / drawui.js 三样都不在页面里），
    //   **这条理由现在没有对象**：`$('tplp')` 恒为 null，那句守卫恒为假，等于没写。
    //   ★ 两处**都故意留着**，没删：
    //     · 守卫留着是**防御**——它现在是空操作，一个字都不做；
    //     · 真删它反而危险：`if (tplp && …) return;` 少一个条件就会变成
    //       "守卫不存在就直接 return" —— 那正是"开着的时候按 Esc 关不掉"。
    //       `test/probe_libpanel.cjs` 的 1.4／1.5 就是替这件事站岗的，别把那两条删了。
    //     · capture 留着同理：它今天的实际效果跟冒泡一样，但哪天再有第二块面板，
    //       这条就是对的写法。
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!开着的()) return;
      var tplp = $('tplp');
      if (tplp && !tplp.hidden) return;      // 同族面板开着：这一下归它（★ 今天恒不成立，见上）
      关();
    }, true);
  }

  return { init: init, 开: 开, 关: 关, 切: 切, 搜: 搜, 列: 列, 开着的: 开着的 };
})();
