// 2026-10-07 那一版外观改动（对话区去框 + 工位那一行降份量）——在**真页面**上量。
//
// 为什么非要在浏览器里量：这两处改的全是"看着像什么"，
//   · 助手那一侧没了底色、老师那侧多了圆角 → 只有 computedStyle 说了算；
//   · 工位行前头那句「也可以直接说：」是 `::before` 的 content → 只有浏览器知道它有没有内容；
//   · 最要命的一条：CSS 注释写坏会把**紧跟其后的整条规则吃掉**，
//     而文件里明明写着、页面上什么都没变（这个坑在 .figimg 上摔过两次）。
//     所以下面**必须**顺手量一条跟本次改动无关的老规则（.figimg 的 max-height）
//     还在不在——它就是"CSS 有没有被吃掉"的那根探针。
//
// ★ 指纹那一格是**开测前的资格赛**：Pages / 本地服务都可能把旧 CSS 喂回来
//   （见 memory：四条不同版本的提示词跑出逐字节相同的输出）。指纹对不上，
//   下面所有读数**整场作废**，不是"差不多就行"。
//
// 跑法：node test/probe_ui_deepseek.cjs
//   （要 8138 上那个静态服务活着：python -m http.server 8138）

const path = require('path'), http = require('http'), fs = require('fs'), crypto = require('crypto');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const 址 = process.argv[2] || 'http://127.0.0.1:8138/index.html';

let 红 = 0, 绿 = 0;
function 判(什么, 成不成, 拿到) {
  if (成不成) { 绿++; console.log('  ✓ ' + 什么); return true; }
  红++; console.log('  ✗ ' + 什么 + '    ← 实际拿到：' + JSON.stringify(拿到));
  return false;
}

const 取 = (p, 法) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port: 9222, path: p, method: 法 || 'GET' }, x => {
    let s = ''; x.on('data', d => s += d); x.on('end', () => res(s));
  }); r.on('error', rej); r.end();
});

(async () => {
  console.log('== 对话区去框 + 工位行降份量（' + 址 + '）==\n');

  const 新 = JSON.parse(await 取('/json/new', 'PUT'));
  await new Promise(r => setTimeout(r, 1200));
  const w = new WebSocket(新.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
  await new Promise(r => w.on('open', r));
  let n = 0; const 等 = {};
  w.on('message', m => { let o; try { o = JSON.parse(m) } catch (e) { return } if (o.id && 等[o.id]) 等[o.id](o); });
  const 发 = (m, p) => new Promise(r => { const i = ++n; 等[i] = r; w.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async e => {
    const r = await 发('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    const d = r.result && r.result.exceptionDetails;
    if (d) return 'EXC:' + ((d.exception && d.exception.description) || d.text);
    return r.result && r.result.result && r.result.result.value;
  };
  const 睡 = ms => new Promise(r => setTimeout(r, ms));
  // ★ 拍图：定义提到**最外面**（2026-10-07）。原先它长在 ⑧ 那个 `if (起) {}` 块里，
  //   ⑨ 也要拍一张老师那条的，可是块级 `const` 出了块就没了 —— 探针跑到那儿
  //   直接 `ReferenceError: 拍 is not defined`，**前面几十条绿全作废**。
  //   （同族：一件东西的定义域比用它的地方小，报出来的却是"这句代码有问题"。）
  const 拍 = async (名) => {
    const 图 = await 发('Page.captureScreenshot', { format: 'png' });
    const d = 图.result && 图.result.data;
    if (!d) return null;
    const p = path.join(__dirname, 名);
    fs.writeFileSync(p, Buffer.from(d, 'base64'));
    return p;
  };

  await 发('Network.enable'); await 发('Network.setCacheDisabled', { cacheDisabled: true });
  await 发('Page.enable'); await 发('Page.navigate', { url: 址 });
  await 睡(2500);

  // ---- 资格赛：页面上装的 CSS 是不是磁盘上这一份 ----
  const 本地 = fs.readFileSync(path.join(__dirname, '..', 'css', 'main.css'));
  const 本地签 = crypto.createHash('sha1').update(本地).digest('hex').slice(0, 12);
  const 线上签 = await ev('(async function(){ try { var t = await (await fetch("css/main.css?x=" + Date.now(), {cache:"no-store"})).text();'
    + ' var b = new TextEncoder().encode(t); var h = await crypto.subtle.digest("SHA-1", b);'
    + ' return Array.from(new Uint8Array(h)).map(function(x){return x.toString(16).padStart(2,"0")}).join("").slice(0,12);'
    + ' } catch(e) { return "EXC:" + e.message } })()');
  const 装对了 = 判('页面上装的就是磁盘上这一份 main.css（指纹 ' + 本地签 + '）', 线上签 === 本地签, { 线上: 线上签, 本地: 本地签 });
  if (!装对了) { console.log('\n★ 指纹对不上 —— 下面所有读数**整场作废**，别拿它下结论。'); process.exit(2); }

  // ---- 等开机（起不来也不当场退出：CSS 那几条不依赖开机，量完一起报） ----
  const 开机式 = '(function(){ try { return !!(typeof SR!=="undefined" && SR.chat && document.querySelectorAll("#works .workbtn").length>=6) } catch(e){ return false } })()';
  let 起 = false;
  for (let i = 0; i < 40; i++) { if (await ev(开机式) === true) { 起 = true; break } await 睡(500); }
  console.log('\n【0 开机】' + (起 ? '起来了' : '★ 没起来（下面跟"页面渲染"有关的那几条会跟着红，先别当成产品坏了）'));

  // ── 0·摆场：自己造一场对话出来，**不靠页面上碰巧剩下什么** ──
  //
  // ★★ 2026-10-07 补。原先这一格是"页面上有什么就量什么"——
  //   头几趟跑得挺好（那个 profile 里存着上一场 32 条对话），
  //   直到另一把探针开的新标签页把那场对话冲掉了（memo 只剩 1 条）。
  //   于是 ⑦ 打印「页面上这会儿没有【老师】的消息，这一侧量不到」，
  //   ⑨ 直接判"这一格不算数"——**红的不是产品，是"现场没了"**。
  //   同一族：探针组与组共享一块板却不互相清场（量到的内容照样有、断言照样绿）。
  //
  // ⚠ 摆法只走**产品自己的 API**（`memo.clear()` + `pushTurn`），绝不直接写 localStorage：
  //   那个文档还活着，它的 `save()` 一到就把缓存里那份写回盘上，把我塞的盖掉
  //   （probe_msgactions 里记着这一跤的现场）。摆完**先读回来核**，再刷新。
  const 摆 = await ev(`(function(){ try {
      SR.memo.clear();
      SR.memo.pushTurn('user', '画个直角三角形', 'draw');
      SR.memo.pushTurn('assistant', '画好了。直角在 C 上，两条直角边是 AC 和 BC。', 'draw');
      SR.main.applyWork('draw');
      return 'OK·当场读到 ' + SR.memo.turns().length + ' 条'
    } catch(e){ return 'THROW: ' + ((e && e.message) || e) } })()`);
  await 睡(900);   // 等那条 400ms 的写盘落地
  const 落盘 = await ev(`(function(){ try {
      var o = JSON.parse(localStorage.getItem('mathroot_memo') || '{}');
      return String((o.turns || []).length)
    } catch(e){ return 'EXC:' + e.message } })()`);
  判('摆场：账本真落盘了（摆完先读回来核）', 落盘 === '2', { 摆: 摆, 盘上: 落盘 });
  await 发('Network.setCacheDisabled', { cacheDisabled: true });
  await 发('Page.navigate', { url: 址 });
  await 睡(2500);
  for (let i = 0; i < 40; i++) { if (await ev(开机式) === true) break; await 睡(500); }
  const 在场 = JSON.parse(await ev(`(function(){ try { return JSON.stringify({
      账本: SR.memo.turns().length,
      用户气泡: document.querySelectorAll('.msg.user').length,
      助手气泡: document.querySelectorAll('.msg.assistant').length
    }) } catch(e){ return '{"EXC":1}' } })()`));
  判('摆场：刷新之后两句话**真在屏幕上**（不然 ⑦⑨ 量的是空气）',
    在场.账本 === 2 && 在场.用户气泡 >= 1 && 在场.助手气泡 >= 1, 在场);
  if (!(在场.账本 === 2 && 在场.用户气泡 >= 1 && 在场.助手气泡 >= 1)) {
    console.log('\n★ 摆场没成 —— 下面 ⑦⑨ 那两格**一律不算数**（红的是现场，不是产品）。');
  }

  // ---- 一组：CSS 没被注释吃掉（拿一条跟本次改动无关的老规则当哨兵） ----
  console.log('\n【1 CSS 有没有被吃掉 —— 拿老规则当哨兵】');
  const 哨兵 = await ev('(function(){ try {'
    + ' var out = {};'
    + ' for (var i=0;i<document.styleSheets.length;i++){ var rs; try { rs = document.styleSheets[i].cssRules } catch(e){ continue }'
    + '  for (var j=0;j<rs.length;j++){ var r = rs[j]; if (!r.selectorText) continue;'
    + '   if (r.selectorText === ".figimg") out.figimg = r.style.maxHeight;'
    + '   if (r.selectorText === ".figbox") out.figbox = r.style.marginLeft;'
    + '   if (r.selectorText === ".works.stretch") out.rail = r.style.flexWrap;'
    + '   if (r.selectorText === ".msg.user .bubble") out.userbub = r.style.borderRadius;'
    + '   if (r.selectorText === ".bubble") out.bub = r.style.borderLeftColor + "|" + r.style.backgroundColor;'
    + '  } }'
    + ' return out } catch(e){ return "EXC:" + e.message } })()');
  console.log('     ' + JSON.stringify(哨兵));
  判('.figimg 的 max-height:360px **还在**（说明注释没把后面的规则吃掉）', 哨兵 && 哨兵.figimg === '360px', 哨兵 && 哨兵.figimg);
  判('.figbox 的 margin-left:-14px **还在**（撤框不许动它，动了图就跟正文错 14px）', 哨兵 && 哨兵.figbox === '-14px', 哨兵 && 哨兵.figbox);
  // ⚠ 这一段**别再去文件里找 `.msg` 那条规则**：文件里有**两条** `.msg`
  //   （2794 行还有一条只管动画的），按"最后一条同名规则"取会取到那条，
  //   读出来是空字符串 → 报红，而产品一个字都没错。
  //   这正是 memory 里那一族"红的样子跟产品坏了长得一样"。留白这种东西，
  //   该量的本来就是**真元素上算出来的值**，不是文件里某一条规则。

  // ---- 二组：助手那一侧真的没框了 ----
  console.log('\n【2 助手那一侧：底色和色条都该是透明的】');
  const 助手 = await ev('(function(){ try {'
    + ' var box = document.getElementById("msgs"); if(!box) return "EXC:没有 #msgs";'
    + ' var m = document.createElement("div"); m.className = "msg assistant";'
    + ' var b = document.createElement("div"); b.className = "bubble"; b.textContent = "量一下";'
    + ' m.appendChild(b); box.appendChild(m);'
    + ' var s = getComputedStyle(b), sm = getComputedStyle(m);'
    + ' var o = { bg: s.backgroundColor, bl: s.borderLeftColor, bw: s.borderLeftWidth, 间距: sm.marginBottom, 高: b.getClientRects().length };'
    + ' m.remove(); return o } catch(e){ return "EXC:" + e.message } })()');
  console.log('     ' + JSON.stringify(助手));
  判('助手气泡底色是透明的（不是 --panel 那块板）',
    /rgba\(0, 0, 0, 0\)|transparent/.test(String(助手 && 助手.bg)), 助手 && 助手.bg);
  判('助手气泡左边那道 3px 色条是透明的',
    /rgba\(0, 0, 0, 0\)|transparent/.test(String(助手 && 助手.bl)), 助手 && 助手.bl);
  // ⚠ 别断言 `bw === "3px"`：浏览器报的是**缩放后的实算值**（这台上是 2.66667px，
  //   3 ÷ 1.125）。要的是"那 3px 的空位还在"，不是"字符串长得跟源码一样"。
  判('★ 那 3px 的**空位还在**（不是删掉）—— 它是 .figbox 对齐的基准',
    助手 && parseFloat(助手.bw) > 2.5, 助手 && 助手.bw);
  判('.msg 的下间距 ≥ 18px（在**真元素**上量的）',
    助手 && parseFloat(助手.间距) >= 18, 助手 && 助手.间距);

  // ---- 三组：老师那一侧是右边一个圆角浅气泡 ----
  console.log('\n【3 老师那一侧：靠右 + 圆角 + 踩着底】');
  const 老师 = await ev('(function(){ try {'
    + ' var box = document.getElementById("msgs");'
    + ' var m = document.createElement("div"); m.className = "msg user";'
    + ' var b = document.createElement("div"); b.className = "bubble"; b.textContent = "量一下这一侧";'
    + ' m.appendChild(b); box.appendChild(m);'
    + ' var s = getComputedStyle(b), sm = getComputedStyle(m);'
    + ' var o = { 圆角: s.borderRadius, 底色: s.backgroundColor, 贴右: sm.justifyContent, 宽: Math.round(b.getBoundingClientRect().width), 行宽: Math.round(m.getBoundingClientRect().width) };'
    + ' m.remove(); return o } catch(e){ return "EXC:" + e.message } })()');
  console.log('     ' + JSON.stringify(老师));
  判('老师气泡有圆角（14px）', 老师 && String(老师.圆角).indexOf('14px') === 0, 老师 && 老师.圆角);
  判('老师气泡**有底色**（不是透明的——两侧得看得出谁在说）',
    !/rgba\(0, 0, 0, 0\)|transparent/.test(String(老师 && 老师.底色)), 老师 && 老师.底色);
  判('老师那一条**靠右**（justify-content: flex-end）', 老师 && 老师.贴右 === 'flex-end', 老师 && 老师.贴右);

  // ---- 四组：留白（撤框之后唯一的隔断物） ----
  console.log('\n【4 留白：框撤了，间距得顶上】');
  const 内边距 = await ev('(function(){ try { return getComputedStyle(document.getElementById("msgs")).padding } catch(e){ return "?" } })()');
  判('#msgs 内边距 ≥ 20px', 内边距 && parseFloat(内边距) >= 20, 内边距);

  // ---- 五组：工位那一行降成"触发词"，但一颗都不许少 ----
  console.log('\n【5 工位那一行：降份量，不拆入口】');
  const 行 = await ev('(function(){ try {'
    + ' var w = document.getElementById("works"); if (!w) return "EXC:没有 #works";'
    + ' var btns = w.querySelectorAll(".workbtn");'
    + ' var on = w.querySelector(".workbtn.on");'
    + ' var 灰 = w.querySelector(".workbtn:not(.on)");'
    + ' return {'
    + '  颗数: btns.length,'
    + '  前头那句: getComputedStyle(w, "::before").content,'
    + '  换行: getComputedStyle(w).flexWrap,'
    + '  选中色: on ? getComputedStyle(on).color : "(没有选中的那一格)",'
    + '  未选中色: 灰 ? getComputedStyle(灰).color : "(全选中了?)",'
    + '  选中的在: !!on,'
    + '  看得见: w.getClientRects().length > 0 && btns.length ? btns[0].getClientRects().length > 0 : false'
    + ' } } catch(e){ return "EXC:" + e.message } })()');
  console.log('     ' + JSON.stringify(行));
  判('六颗一颗不少（底线③：认不出话头时这是唯一能换工位的地方）', 行 && 行.颗数 >= 6, 行 && 行.颗数);
  判('前头挂着「也可以直接说：」（这句是 ::before 现挂的）',
    行 && String(行.前头那句).indexOf('也可以直接说') >= 0, 行 && 行.前头那句);
  判('选中那一格**跟没选中的颜色不一样**（别把选中态压成灰）',
    行 && 行.选中的在 && 行.选中色 !== 行.未选中色, 行 && { 选中: 行.选中色, 未选中: 行.未选中色 });

  // ---- 六组：话头 → 自动换工位，在**真页面**上走一遍（零额度） ----
  //
  // 为什么这一格值得单开：node 那份 probe_pickwork 量的是**判据**
  // （`该换吗` 认不认得出来），量不到**接线**——认出来了却没人把它接到工位上，
  // 读数照样全绿。这一格走的是真链条：
  //   #input.value → SR.landing.intercept() → SR.main.applyWork → SR.chat.getWork + #routebar
  // ★ 不发请求：intercept() 只读输入框、只改界面，一个字都不往外发。
  //   （这也是为什么它能在不花额度的情况下量——真要发的是它**后面**那一段。）
  //
  // ⚠ 开测前先核"现在站在哪一屏"：停在首屏时 intercept() 走的是**另一条路**
  //   （首屏那条：认出来就按住不发），量出来的是另一件事。
  //   不核就量 = memory 里那条"空读数比假红更阴"。不是对话屏就当场作废。
  console.log('\n【6 话头 → 自动换工位（真页面、零额度）】');
  const 屏 = await ev('(function(){ try { return document.body.getAttribute("data-landing") } catch(e){ return "?" } })()');
  if (String(屏) === '1') {
    console.log('     ★ 现在停在**首屏**，intercept() 会走首屏那条路——这一格量不到，作废。');
  } else {
    const 试话 = async (起手, 话) => await ev('(function(){ try {'
      + ' if (SR.main && SR.main.applyWork) SR.main.applyWork(' + JSON.stringify(起手) + ', true);'
      + ' var i = document.getElementById("input"); i.value = ' + JSON.stringify(话) + ';'
      + ' var r = SR.landing.intercept();'
      + ' return { 拦下没: r, 工位: (SR.chat.getWork && SR.chat.getWork()) || "",'
      + '          那一行: (document.getElementById("routebar") || {}).textContent || "",'
      + '          输入框: i.value };'
      + ' } catch(e){ return "EXC:" + e.message } })()');
    const 负 = await 试话('prep', '这道题学生作图老是错，怎么讲');
    console.log('     不该换：' + JSON.stringify(负));
    判('在【备课】说「学生作图老是错」——工位**没动**', 负 && 负.工位 === 'prep', 负 && 负.工位);
    const 正 = await 试话('prep', '帮我作图，画一个三角形ABC');
    console.log('     该换的：' + JSON.stringify(正));
    判('说了「作图」——工位自己换到了 draw', 正 && 正.工位 === 'draw', 正 && 正.工位);
    判('★ 那句话**没被吞掉**（input 里还在，接着就会发出去）',
      正 && 正.输入框 === '帮我作图，画一个三角形ABC', 正 && 正.输入框);
    判('那一行把这件事说出来了（「我换到【作图】办了」）',
      正 && String(正.那一行).indexOf('我换到') >= 0 && String(正.那一行).indexOf('作图') >= 0, 正 && 正.那一行);
    判('intercept 回的是 false（true＝把老师这句话吞了，什么也没办）', 正 && 正.拦下没 === false, 正 && 正.拦下没);
    // ★ 这两条量的是**那一行读起来通不通**，不是某个变量的值。
    //   上一版就是在这儿栽的：两个 why 串单独看都对，拼进 strip() 的
    //   `（照' + why + '认的）` 这个框里才现原形——"照你说了「作图」认的"、
    //   "照照话头认的认的"。跟"我要的短句"对不对得上，只有**照着真拼一遍**才知道。
    判('★ 打了名字的：那一行**不带括号**（名字是他自己打的，没什么可"认"的）',
      正 && String(正.那一行).indexOf('（照') < 0, 正 && 正.那一行);
    const 认的 = await 试话('draw', '再出几道变式题');
    console.log('     按话头认的：' + JSON.stringify(认的));
    判('没打名字、按话头认的——工位还是换了', 认的 && 认的.工位 === 'vary', 认的 && 认的.工位);
    判('★ 按话头认的：那一行**带**「（照话头认的）」（这才是"猜的"，老师好改）',
      认的 && String(认的.那一行).indexOf('（照话头认的）') >= 0, 认的 && 认的.那一行);
  }

  // ---- 七组：动作条在气泡**外面**（2026-10-07 孔老师截图那一条） ----
  //
  // 他的原话：「为啥这个聊天框会多一行？你应该把复制修改再试一次的按钮放在
  //   这个聊天框的**下面**，而不是让这个聊天框一行文字一行留白。」
  // 病根：条子是 `bubble.appendChild(bar)` —— 它是气泡的**孩子**，
  //   于是那三颗按钮成了内容的一部分，在盒子里又占一整行。
  // ★ 这一格量的是**几何**（谁在谁下面），不是"某个变量对不对"：
  //   只量 DOM 父子关系的话，"搬到外面但排到上面去了"照样绿。
  console.log('\n【7 动作条在气泡外面（不是气泡的第二行）】');
  const 条 = await ev('(function(){ try {'
    + ' var out = {};'
    + ' ["assistant","user"].forEach(function(kind){'
    + '   var m = document.querySelector(".msg." + kind);'
    + '   if (!m) { out[kind] = null; return }'
    + '   var bub = m.querySelector(".bubble");'
    + '   var bar = m.querySelector(":scope > .copybar");'
    + '   var bb = bub && bub.getBoundingClientRect(), br = bar && bar.getBoundingClientRect();'
    + '   out[kind] = {'
    + '     条找得到: !!bar,'
    + '     爹是那条消息: !!(bar && bar.parentElement === m),'
    + '     气泡里还有条吗: !!(bub && bub.querySelector(".copybar")),'
    + '     条在气泡底下: !!(br && bb && br.top >= bb.bottom - 1),'
    + '     气泡高: bb ? Math.round(bb.height) : null,'
    + '     条高: br ? Math.round(br.height) : null,'
    + '     气泡看得见: !!(bub && bub.getClientRects().length)'
    + '   };'
    + ' });'
    + ' return out } catch(e){ return "EXC:" + e.message } })()');
  console.log('     ' + JSON.stringify(条));
  ['assistant', 'user'].forEach(function (kind) {
    const o = 条 && 条[kind];
    const 名 = kind === 'assistant' ? '助手' : '老师';
    if (!o) { console.log('     （页面上这会儿没有【' + 名 + '】的消息，这一侧量不到）'); return; }
    判('【' + 名 + '】气泡里**没有**那条动作条（不再占气泡里的第二行）', o.气泡里还有条吗 === false, o.气泡里还有条吗);
    判('【' + 名 + '】那条的直接爹是 .msg（跟气泡平级）', o.爹是那条消息 === true, o.爹是那条消息);
    判('★ 【' + 名 + '】那条在气泡的**下面**（几何上量出来的，不是看选择器）', o.条在气泡底下 === true,
      { 条顶: o.条高, 气泡高: o.气泡高, 在底下: o.条在气泡底下 });
  });

  // ---- 八组：把这两处改动拍下来（读数之外，还得有眼睛看得见的那一份） ----
  if (起) {
    console.log('\n  拍下来了：' + await 拍('_ui_deepseek.png'));
    // ★ 再拍一张**鼠标停在一条消息上**的：那三颗按钮平时是 opacity:0 的
    //   （`.copybar` 只在悬停时现身，见 css），不悬停的话这张图上根本看不见它们——
    //   而"按钮到底落在气泡里还是气泡外"正是这一轮要看的，
    //   拍一张看不见按钮的图等于什么都没验。
    // ⚠ 这一格连着栽两回，两回都长得像"悬停不现身"（= 产品坏了）：
    //   ① 随手取了第一条 `.msg.user`，它早被滚到**视口外面**了，鼠标落在屏幕外；
    //   ② 改成先 `scrollIntoView` 再读坐标——**读早了**：`#msgs` 上有
    //      `scroll-behavior: smooth`（css），滚动是**动画**的，
    //      当场读到的还是滚之前那个 y=3253（视口才 906 高）。
    //      memory 里那条"按秒表读状态"就是这个：**没滚到位**和**滚不动**长得一样。
    //   ⇒ 分两步：先滚，睡够，再读坐标，并且**核一遍它真的在视口里**。
    await ev('(function(){ try {'
      + ' var ms = document.querySelectorAll(".msg");'
      + ' for (var i = ms.length - 1; i >= 0; i--) {'
      + '   if (ms[i].querySelector(":scope > .copybar")) { ms[i].scrollIntoView({ block: "center" }); return 1 }'
      + ' } return 0 } catch(e){ return "EXC:" + e.message } })()');
    await 睡(900);
    const 位 = await ev('(function(){ try {'
      + ' var ms = document.querySelectorAll(".msg"), m = null;'
      + ' for (var i = ms.length - 1; i >= 0; i--) {'
      + '   if (ms[i].querySelector(":scope > .copybar")) { m = ms[i]; break }'
      + ' }'
      + ' if (!m) return "EXC:没有带动作条的消息";'
      + ' var r = m.getBoundingClientRect();'
      + ' return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),'
      + '          视口高: window.innerHeight, 在视口里: r.top > 0 && r.bottom < window.innerHeight };'
      + ' } catch(e){ return "EXC:" + e.message } })()');
    console.log('     悬停点：' + JSON.stringify(位));
    if (位 && 位.在视口里 === true) {
      await 发('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 位.x, y: 位.y, button: 'none' });
      await 睡(400);
      // ⚠ 第三跤：上面悬停的是**最后**一条带动作条的消息，这儿却去读
      //   `document.querySelector('.msg .copybar')`——**第一条**。
      //   量错了对象，红的样子跟产品坏了完全一样。**按同一个规则取那一颗**，
      //   并且把全部读数打出来，好一眼看出是"全都没亮"还是"亮的是别人的"。
      const 亮 = await ev('(function(){ try {'
        + ' var ms = document.querySelectorAll(".msg"), m = null;'
        + ' for (var i = ms.length - 1; i >= 0; i--) {'
        + '   if (ms[i].querySelector(":scope > .copybar")) { m = ms[i]; break }'
        + ' }'
        + ' var bar = m && m.querySelector(":scope > .copybar");'
        + ' var 全部 = [].map.call(document.querySelectorAll(".msg .copybar"), function(x){ return getComputedStyle(x).opacity });'
        + ' return { 这一条: bar ? getComputedStyle(bar).opacity : null, 全部: 全部,'
        + '          悬停在这条上吗: m ? m.matches(":hover") : null };'
        + ' } catch(e){ return "EXC:" + e.message } })()');
      console.log('      ' + JSON.stringify(亮));
      const 亮值 = 亮 && 亮.这一条;
      // ⚠ 第四跤：读数已经从"一个数"变成了"一个对象"（为了能一眼看出
      //   是"全都没亮"还是"亮的是别人的"），可这行断言**还在拿对象跟 '1' 比**——
      //   恒假。读数明明全是绿的，红的是尺子自己。
      判('★ 悬停时那三颗**真的会现身**（不然这张图上看不见它们，等于没验）', parseFloat(亮值) > 0.9, 亮值);
      console.log('  悬停图：' + await 拍('_ui_deepseek_hover.png'));
      // ★ 对照臂：**一次都不做被怀疑的那个动作**——鼠标挪到左上角待着，
      //   同一条读数必须回到 0。它要是也报 1，说明这一格量的不是"悬停有没有生效"，
      //   那上面那个绿就不算数（memory：尺子自己得先在一份坏件上红过）。
      await 发('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3, button: 'none' });
      await 睡(300);
      const 对照 = await ev('(function(){ try {'
        + ' var ms = document.querySelectorAll(".msg"), m = null;'
        + ' for (var i = ms.length - 1; i >= 0; i--) {'
        + '   if (ms[i].querySelector(":scope > .copybar")) { m = ms[i]; break }'
        + ' }'
        + ' var bar = m && m.querySelector(":scope > .copybar");'
        + ' return bar ? getComputedStyle(bar).opacity : null;'
        + ' } catch(e){ return "EXC:" + e.message } })()');
      判('★ 对照：鼠标挪开之后那三颗**又藏回去了**（证明上一格量的真是"悬停"）', parseFloat(对照) < 0.1, 对照);
    } else {
      console.log('  ★ 没滚到视口里（或没有带动作条的消息）——悬停图**没拍**，这一格不算数。');
      红++;
    }
  }

  // ── ⑨ 老师自己那条气泡：**他抱怨的就是这一条**（「为啥这个聊天框会多一行」）──
  //   上面 ⑧ 悬停的是**最后一条带动作条的消息**，那多半是助手那条。
  //   可孔老师截图圈出来的是**他自己打的那句「画个直角三角形」**——
  //   所以这一格专门盯 `.msg.user`：一张单行气泡、底下那三颗，气泡里不许再留白。
  console.log('\n【9 老师那条气泡：底下那三颗，不是气泡里的第二行】');
  {
    const 找用户 = ' var ms = document.querySelectorAll(".msg.user"), m = null;'
      + ' for (var i = ms.length - 1; i >= 0; i--) {'
      + '   if (ms[i].querySelector(":scope > .copybar")) { m = ms[i]; break }'
      + ' }';
    await ev('(function(){ try {' + 找用户
      + ' if (m) m.scrollIntoView({ block: "center" }); return m ? 1 : 0'
      + ' } catch(e){ return "EXC:" + e.message } })()');
    await 睡(900);
    const 位2 = await ev('(function(){ try {' + 找用户
      + ' if (!m) return "EXC:没有带动作条的老师消息";'
      + ' var r = m.getBoundingClientRect();'
      + ' var b = m.querySelector(":scope > .bubble");'
      + ' var br = b ? b.getBoundingClientRect() : null;'
      + ' var bar = m.querySelector(":scope > .copybar");'
      + ' var ar = bar ? bar.getBoundingClientRect() : null;'
      + ' return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),'
      + '          视口高: window.innerHeight, 在视口里: r.top > 0 && r.bottom < window.innerHeight,'
      + '          气泡高: br ? Math.round(br.height) : null,'
      + '          气泡里有条吗: !!(b && b.querySelector(".copybar")),'
      + '          条在气泡底下: (br && ar) ? (ar.top >= br.bottom - 1) : null };'
      + ' } catch(e){ return "EXC:" + e.message } })()');
    console.log('     老师那条：' + JSON.stringify(位2));
    if (位2 && 位2.在视口里 === true) {
      判('★ 老师气泡里**没有**那条（单行气泡就是单行，底下不留白）', 位2.气泡里有条吗 === false, 位2.气泡里有条吗);
      判('★ 老师气泡**高不过一行**（他截图里那个"多一行"），底下那三颗的量在气泡外', (位2.气泡高 || 0) < 60, 位2.气泡高);
      await 发('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 位2.x, y: 位2.y, button: 'none' });
      await 睡(400);
      const 亮2 = await ev('(function(){ try {' + 找用户
        + ' var bar = m && m.querySelector(":scope > .copybar");'
        + ' return bar ? getComputedStyle(bar).opacity : null;'
        + ' } catch(e){ return "EXC:" + e.message } })()');
      判('★ 悬停老师那条，底下那三颗**也真会现身**', parseFloat(亮2) > 0.9, 亮2);
      console.log('  老师那条的悬停图：' + await 拍('_ui_deepseek_user.png'));
    } else {
      console.log('  ★ 老师那条没滚到视口里（或没有带动作条的老师消息）——这一格不算数。');
      红++;
    }
  }

  console.log('\n══ ' + 绿 + ' 绿 / ' + 红 + ' 红 ══');
  process.exit(红 ? 1 : 0);
})();
