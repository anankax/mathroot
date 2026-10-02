// 公式渲染的验收：「屏幕上还能不能看见反斜杠」。
//
// ★★ 为什么有这个文件（2026-10-02）：孔老师用线上那一版，第一句话就是
//   「首先为什么数学公式显示不出来，frac 还在」。屏幕上原样印着 `(1 \frac{1}{2})`。
//   查下来是**规则只写了一半**——js/render.js 的 typeset() 只认 `$$ \[ $ \(` 四种定界符，
//   而备课那四份提示词**从来没要求过用 `$` 包公式**。（详见 js/prompt-prep.js 里新加的那一节。）
//   两头一起改：提示词补上规矩（软的），js/render.js 加一道 armText 兜底（硬的）。
//
// ★ 分两腿，因为这两件事的"便宜程度"差一个数量级：
//   A 腿（纯函数，永远跑）：**包得对不对**。喂字符串进 SR.render.armText，看输出。
//     不联网、不开浏览器、不花额度，几毫秒。
//   B 腿（浏览器，要 LIVE=1）：**KaTeX 到底认不认**。armText 只保证 `$` 补上了，
//     补出来的东西 KaTeX 能不能渲染是另一回事——那得真在浏览器里读 `.katex` 的个数。
//   ⚠ 两腿缺一不可，也**不许拿 A 腿的绿去当 B 腿的绿**：A 腿过了 B 腿没跑，
//     总结那行会明写「B 腿没跑」，别把它读成"过了"。
//
// 用法:
//   node test/probe_math.cjs              只跑 A 腿
//   LIVE=1 node test/probe_math.cjs       连 B 腿一起（先 node test/serve.cjs 8138，Chrome 在 9222）
//   退出码 0 = 跑的这几腿全过；1 = 有红的；3 = 尺子自己坏了
const path = require('path'), fs = require('fs');

// ★ SR_RENDER 是给 `test/_redfirst_math.cjs` 用的：它把**改坏的副本**写到别处，
//   让探针去读那份，于是"证明它会红"这件事**完全不用碰 js/render.js**。
//   （原来的写法是就地改真文件、跑完再还原——中途被强杀就会留下一份残废的 render.js。
//    这个仓库在"探针把东西留在别人机器上"这件事上已经吃过一次亏，不留第二次机会。）
const RFILE = process.env.SR_RENDER || path.join(__dirname, '..', 'js', 'render.js');
const W = { SR: {} };
new Function('window', 'localStorage', 'navigator',
  fs.readFileSync(RFILE, 'utf8'))(W, {}, { onLine: true });
const R = W.SR.render;
if (!R || !R.armText) {
  console.log('★ render.js 里没有 armText —— 下面每一条都别信。');
  process.exit(3);
}

// ============================================================
//  A 腿：armText 包得对不对（纯函数）
// ============================================================
// ★ 用例里那些"原话"，形状都是从真实回复里抄的：中文句子里夹一段裸 LaTeX。
//   `want` 是**逐字**比对的期望值 —— 所以它同时钉住了"包在哪儿"和"包到哪儿为止"。
const CASES = [
  // ---- 尺子自检那一格 ----
  {
    name: '★自检：纯中文（一个字符都不许动）',
    in: '他把两个条件看反了，所以算出来是 3。',
    want: '他把两个条件看反了，所以算出来是 3。',
    why: '如果这一格也变了，说明 armText 是"见到什么包什么"，它把整句话喂给 KaTeX 了——' +
         '那 A 腿后面每一条的绿都没有意义'
  },

  // ---- 要包的 ----
  {
    name: '裸 \\frac 夹在中文里（他截图里那个形状）',
    in: '他写的是 1\\frac{1}{2}，其实应该是 \\frac{3}{2}。',
    want: '他写的是 $1\\frac{1}{2}$，其实应该是 $\\frac{3}{2}$。'
  },
  {
    name: '★字母前面有空格：空格要留在公式外面',
    in: '答案是 \\sqrt{3} 厘米。',
    want: '答案是 $\\sqrt{3}$ 厘米。',
    why: '`$ \\sqrt{3} $` 也能渲染，可导出的文字里会多两个空格；顺手修掉，别让它成为以后的神秘差异'
  },
  {
    name: '★括号也要包进去（不然括号会跟公式分家）',
    in: '所以 (1 \\frac{1}{2}) 是多少？',
    want: '所以 $(1 \\frac{1}{2})$ 是多少？'
  },
  {
    name: '两段公式、中间隔着中文 → 包成两段',
    in: '先算 \\frac{1}{2}，再算 \\sqrt{3}。',
    want: '先算 $\\frac{1}{2}$，再算 $\\sqrt{3}$。'
  },
  {
    name: '上标也要包（`x^{2}` 在屏幕上同样没法看）',
    in: '面积是 (x+1)^{2} 平方厘米。',
    want: '面积是 $(x+1)^{2}$ 平方厘米。'
  },

  // ---- 不许动的 ----
  {
    name: '★已经有 `$` 的**一个字都不动**（防重复包）',
    in: '他写的是 $\\frac{1}{2}$。',
    want: '他写的是 $\\frac{1}{2}$。',
    why: '这一条要是红了，说明我们会在模型已经包好的公式外面再套一层 `$`，' +
         '屏幕上会变成一对美元符号加一段没渲染的 LaTeX'
  },
  {
    name: '★反例：普通式子（没有命令也没有上标）不许包',
    in: '把 x = 3 代回去就行了。',
    want: '把 x = 3 代回去就行了。',
    why: '中文句子里等号到处都是。见等号就包 = 整句话进 KaTeX'
  },
  {
    name: '★反例：裸的 `2^3` 不包（`^{` 才认）',
    in: '2^3 是 8，别忘了。',
    want: '2^3 是 8，别忘了。',
    why: '`^` 单独一个还出现在注释符、异或里。只认 `^{` 是**故意收窄**的'
  },
  {
    name: '★反例：Windows 路径不是 LaTeX',
    in: '文件在 C:\\数学办公\\数根 里。',
    want: '文件在 C:\\数学办公\\数根 里。',
    why: '这就是"只认已知命令名、不做见到反斜杠就包"那条的用途'
  },
  {
    name: '★反例：`\\t` 不在命令名单里（别把制表符当公式）',
    in: '变量叫 t，不是 \\t。',
    want: '变量叫 t，不是 \\t。',
    why: '名单是**手写白名单**。这一格红了说明有人改成"任何反斜杠都算"了'
  },

  // ---- 知道的边界（不是没想到，是权衡过的）----
  {
    name: '边界：`x_1 + x_2` 不包（下标够不着）',
    in: 'x_1 和 x_2 都要算。',
    want: 'x_1 和 x_2 都要算。',
    why: '★ **知道这一格为什么过**：markdown 比我们先看到 `_`（`x_1` 和 `x_2` 会被 marked ' +
         '认成斜体并改写成 <em>），等轮到 armText，原文已经不在文本节点里了——收了也是白收。' +
         '所以这里**故意断言"不动"**：谁哪天把 `_` 加进命令名单，这一格会红，' +
         '提醒他先去看 render.js 那段注释。根治要靠提示词那一头的写法'
  }
];

let bad = 0;
console.log('===== A 腿：armText 包得对不对（纯函数，' + CASES.length + ' 格）=====');
for (const c of CASES) {
  const got = R.armText(c.in).text;
  const ok = got === c.want;
  if (!ok) bad++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + c.name);
  if (!ok) {
    console.log('      原文〔' + c.in + '〕');
    console.log('      期望〔' + c.want + '〕');
    console.log('      实际〔' + got + '〕');
  }
  if (c.why) console.log('        ' + c.why.replace(/\n/g, '\n        '));
}

// ---- 幂等：包过一遍的再包一遍，一个字符都不该变 ----
// ★ 这条为什么要单独量：armLatex 是**整棵子树走一遍**，而同一段文字在流式期间
//   会被反复重画。万一哪天有人把"看见 `$` 就退出"那道闸拆了，屏幕上会出现 `$$...$$`，
//   而上面每一格**照样是绿的**（它们只看单次调用）。
const IDEM = '他写的是 1\\frac{1}{2}，其实是 \\sqrt{3}。';
const once = R.armText(IDEM).text, twice = R.armText(once).text;
const idemOK = once === twice && once.indexOf('$') >= 0;
if (!idemOK) bad++;
console.log((idemOK ? '  ✓ ' : '  ✗ ') + '幂等：包第二遍不变（' + once + '）');
if (!idemOK) console.log('      第一遍〔' + once + '〕\n      第二遍〔' + twice + '〕');

// ============================================================
//  尺子自检 —— 上面这些绿，得能证明不是"空转"
// ============================================================
const selfBad = [];
if (!CASES.length) selfBad.push('用例表是空的，"全都对"空转通过');
if (!CASES.some(c => c.want.indexOf('$') >= 0)) selfBad.push('没有一格是"该包上"的——只有不动的格子，包没包上根本没量到');
if (!CASES.some(c => c.want.indexOf('$') < 0)) selfBad.push('没有一格是"不许动"的——"见什么包什么"的那种坏法量不到');
// 拿一段**明知该包**的文字喂进去，看 armText 到底动不动。不动 = 检测器没在工作。
// ⚠ 这一格只许问"它动没动"（changed / 出没出 `$`），**不许逐字比对包出来的样子**。
//   第一版就是逐字比的（拿 `'$\frac{a}{b}$'` 去 indexOf），结果把"首尾空格留在外面"
//   这条产品行为焊进了自检里 —— 那条行为一退化，自检就喊"尺子坏了"（退出码 3），
//   把人指去改探针文件，而真正坏的是 js/render.js。**自检只能问"我在不在工作"，
//   不能问"产品对不对"**，否则它会把产品的红说成自己的红。（2026-10-02 实测踩到）
const CANARY = R.armText('结果是 \\frac{a}{b}。');
if (!CANARY.changed || CANARY.text.indexOf('$') < 0) selfBad.push('喂一段该包的（结果是 \\frac{a}{b}。）它都没包 —— 上面那些"不动"的绿是假的');
console.log('');
console.log('===== 尺子自检 =====');
console.log('  用例表非空、两边都有  ' + (CASES.length && CASES.some(c => c.want.indexOf('$') >= 0) && CASES.some(c => c.want.indexOf('$') < 0) ? '过' : '★ 不过'));
console.log('  armText 对"该包的"真的会动  ' + (selfBad.length ? '★ 不过' : '过'));
if (selfBad.length) {
  console.log('');
  console.log('★★★ 尺子自己坏了 —— 下面那份清单**一条都别信**，先修 test/probe_math.cjs：');
  selfBad.forEach(x => console.log('    · ' + x));
  process.exit(3);
}

console.log('');
console.log('===== A 腿结果 =====');
console.log('  ' + (CASES.length + 1 - bad) + '/' + (CASES.length + 1) + ' 通过' + (bad ? '，★ 有 ' + bad + ' 格红了，见上面' : ''));
console.log('  ⚠ 这只证明**字符串层面**包得对。KaTeX 认不认包出来的东西，得看 B 腿。');

// ============================================================
//  B 腿：浏览器里 KaTeX 到底渲没渲出来（要 LIVE=1）
// ============================================================
if (!process.env.LIVE) {
  console.log('');
  console.log('===== B 腿：没跑 =====');
  console.log('  它要在真浏览器里读 `.katex` 的个数（那才是"公式显示出来了"的直接证据）。');
  console.log('  开法：先 `node test/serve.cjs 8138`，Chrome 挂在 9222，再：');
  console.log('    LIVE=1 node test/probe_math.cjs');
  console.log('  ★ 上面 A 腿的绿**不能**替 B 腿结账。');
  process.exit(bad ? 1 : 0);
}

// ---- B 腿正式跑 ----
const http = require('http');
let WebSocket;
try {
  WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
} catch (e) {
  console.log('\n★ B 腿起不来：找不到 ws 模块（' + e.message + '）。退出码 3，别把这次读成"过了"。');
  process.exit(3);
}
const put = p => new Promise((res, rej) => {
  const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
  r.on('error', rej); r.end();
});
const closeTab = id => new Promise(res => http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res));

// 喂进页面的几段文字 + 这一格的期望。
// ★ 「有没有渲出来」用的是**两个数**，不是一个：
//     katex —— 页面上出现了几个 KaTeX 生成的元素（>0 才叫渲了）
//     raw   —— 显示出来的文字里还剩几个反斜杠命令（必须 0）
//   只看一个都会骗人：只看 katex，"整句话被塞进公式"也能让他变正；
//   只看 raw，"什么都没渲但也没报错"看着也干净。
const LIVE_CASES = [
  { name: '★自检：纯中文 → 一个 KaTeX 元素都不该有', in: '他把两个条件看反了，所以算出来是 3。', katex: 0, raw: 0 },
  { name: '他自己截图里那个形状：裸 \\frac', in: '他写的是 1\\frac{1}{2}，其实应该是 \\frac{3}{2}。', katex: 2, raw: 0 },
  { name: '裸 \\sqrt 夹在中文里', in: '答案是 \\sqrt{3} 厘米。', katex: 1, raw: 0 },
  { name: '★已经用 `$` 包好的（模型听话的那种）', in: '他写的是 $\\frac{1}{2}$。', katex: 1, raw: 0 },
  {
    name: '★行内代码里的 LaTeX 不许动（那是给人看原文的）',
    in: '命令要写成 `\\frac{1}{2}` 这个形式。', katex: 0, raw: 0, keeps: '\\frac{1}{2}',
    why: '代码块里包上就是**篡改原文**：老师看到的是"本来该照抄的样子"。这一格判两件事——' +
         'katex 必须是 0（没被渲），`keeps` 那段原文必须**原样还在**。' +
         '⚠ 第一版把期望写成"残留 1 个"，那是把**"原文还在"和"漏渲染了"当成了同一件事**；' +
         '这一格刚好让两个意思撞在同一个数值上，所以看不出来。拆开才是对的。'
  },
  { name: '★上标 x^{2}', in: '面积是 (x+1)^{2} 平方厘米。', katex: 1, raw: 0 }
];

(async () => {
  let TAB = null;
  try {
    const t = JSON.parse(await put('/json/new?about:blank'));
    TAB = t.id;
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0; const pend = {};
    const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
    await new Promise(r => ws.on('open', r));
    await send('Runtime.enable', {}); await send('Page.enable', {});
    const q = async e => {
      const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      const Rr = r.result;
      if (Rr && Rr.exceptionDetails) return 'THROW: ' + String(Rr.exceptionDetails.exception && Rr.exceptionDetails.exception.description).slice(0, 200);
      return Rr && Rr.result ? Rr.result.value : null;
    };
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // ★★ 量哪儿是可以指定的：`SITE=https://anankax.github.io/mathroot/index.html`。
    //   孔老师的规矩是「UI 验收看线上，不看本地截图」——所以这条 B 腿最该量的地方
    //   就是线上那一份。默认仍是本机 8138（快、改完立刻能验）。
    const SITE = process.env.SITE || 'http://localhost:8138/index.html';
    console.log('  （量的地方：' + SITE + '）');
    await send('Page.navigate', { url: SITE });
    await sleep(1200);
    // ★ 硬重载：同域的普通导航会吃缓存，会把**已经生效的改动**误判成"没生效"。
    await send('Page.reload', { ignoreCache: true });
    await sleep(3000);

    // 尺子自检：页面里得有真的 renderInto 和真的 KaTeX，否则下面读到的 0 全是假的。
    // ★★ 这里必须**等条件成立**，不能睡死一个固定秒数。
    //   第一版睡的 3 秒，冷启动时 katex 那个 CDN 的 auto-render.min.js 还没到位，
    //   读到 false 就报"页面上没有 renderInto"——**假警报**，而且它长得像"公式渲染坏了"，
    //   最坏的那种误导。现在改成轮询到 20 秒，超时了还要**分别说清缺的是哪一样**。
    const PROBE = `({ sr: typeof SR!=='undefined' && !!(SR.render && typeof SR.render.renderInto==='function'),` +
      ` katex: typeof window.renderMathInElement==='function',` +
      ` state: document.readyState })`;
    let parts = null, tried = 0;
    for (; tried < 20; tried++) {
      parts = await q(PROBE);
      if (parts && parts.sr && parts.katex) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!parts || !parts.sr || !parts.katex) {
      console.log('\n★★★ B 腿开不了，等了 20 秒还是缺东西 —— 下面每一条都别信：');
      console.log('    SR.render.renderInto  ' + (parts && parts.sr ? '在' : '★ 不在（js/render.js 没加载？serve 是不是 8138？）'));
      console.log('    renderMathInElement   ' + (parts && parts.katex ? '在' : '★ 不在（katex 那个 CDN 没下来 —— 他平时用得到它，所以这不算小事）'));
      console.log('    document.readyState   ' + (parts ? parts.state : '读不到'));
      await closeTab(TAB); process.exit(3);
    }
    // ★ 把"等了多久"打出来：这一行让"1 秒就绪"和"等了 19 秒"在输出里分得开。
    //   （哪天真要查 katex 那个 CDN 是不是慢，不必再改探针。）
    console.log('');
    console.log('（页面就绪用了 ' + (tried + 1) + ' 秒：SR.render.renderInto 与 renderMathInElement 都到位）');

    // ---- 如果 SR_RENDER 指的不是页面上那一份，就把那一份**注入**进来顶掉 SR.render ----
    // ★ 为什么非要有这一段：B 腿量的是**浏览器从磁盘加载的那份 render.js**，
    //   而"证明它会红"要求把代码改坏。就地改真文件能生效，可万一进程被强杀，
    //   留在磁盘上的就是一份残废的 render.js（他照样打得开网页，只是公式全烂）。
    //   改成把改坏的副本**送进页面**替换 `SR.render`——磁盘上的真文件全程没碰，
    //   而页面里跑的确实就是那份副本。注入完还要回读一句，证明换成功了。
    if (process.env.SR_RENDER) {
      const src = fs.readFileSync(process.env.SR_RENDER, 'utf8');
      // ⚠ 拼成普通字符串，**不能用模板字符串**：render.js 的注释里带反引号。
      const inj = await q('(function(){ try { ' + src +
        '\n; return String(typeof SR.render.renderInto) + "|" + String(typeof SR.render.armText);' +
        ' } catch (e) { return "THROW " + e.message; } })()');
      if (inj !== 'function|function') {
        console.log('\n★★★ 注入改坏的那份 render.js 失败了（读到 ' + JSON.stringify(inj) + '）。');
        console.log('    这一趟的 B 腿量到的还是磁盘上那份**好**的，所以它红不了 —— 别当中立证据。');
        await closeTab(TAB); process.exit(3);
      }
      console.log('  （B 腿跑的是注入进来的那份：' + path.basename(process.env.SR_RENDER) + ' —— 磁盘上的 js/render.js 没碰）');
    }

    // ---- 把"量什么"装进页面里，只装一份 ----
    // ★ 为什么要装成函数而不是每格抄一段：下面"尺子自检"那一格要用**同一段**数法去数
    //   一段我们故意没 arm 的文本。抄两份的话，两份会漂，而那格自检就变成了在验它自己。
    //   `raw` 的定义要念准：**.katex 之外、代码之外**还剩下的 `\命令` 个数 ——
    //   也就是"本该渲出来却漏掉、老师眼里就是一片反斜杠"的那些。代码块里的不算，
    //   因为那儿的原文**本来就该原样显示**（那一格靠 `keeps` 另判）。
    await q(String.raw`window.__pmCount = function (root) {
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false), n, raw = 0, txt = '', last = null;
      while ((n = w.nextNode())) {
        var p = n.parentNode;
        if (p && p.closest && p.closest('.katex')) { if (last !== 'k') { txt += ' [公式] '; last = 'k'; } continue; }
        if (p && p.closest && p.closest('code, pre')) { txt += n.data; last = 'c'; continue; }
        var m = n.data.match(/\\[a-zA-Z]+/g);
        if (m) raw += m.length;
        txt += n.data; last = 't';
      }
      return { katex: root.querySelectorAll('.katex').length, raw: raw, text: txt };
    }; 1`);

    // ---- 尺子自检：那个"漏渲染"计数器，喂它一段**真的没渲**的文本，它数得出来吗 ----
    // ★ 非有这一格不可的理由：下面六格里**每一格都期望 raw=0**。
    //   而"数字真的是 0"和"计数器根本没接上、永远返回 0"，在输出上**长得一模一样**。
    //   这里绕开 armLatex（只走 md，把裸 LaTeX 原样留在 HTML 里），造出一段必然残留的文本。
    //   数不出来 = 上面六格的 raw 全都不算数。
    const CAN_IN = '结果是 \\frac{a}{b}。';
    const canGot = await q(`(()=>{ var d=document.createElement('div');` +
      ` d.innerHTML = SR.render.md(${JSON.stringify(CAN_IN)});` +   // ← 只有 md，没有 armLatex
      ` return window.__pmCount(d); })()`);
    const canOK = canGot && canGot.raw === 1 && canGot.katex === 0;
    console.log('  尺子自检：喂一段**故意没 arm** 的（' + CAN_IN + '）→ 计数器读到 ' +
      (canGot ? 'raw=' + canGot.raw + ', katex=' + canGot.katex : JSON.stringify(canGot)) +
      '（期望 raw=1, katex=0）' + (canOK ? '　✓' : '　★ 计数器是瞎的'));

    console.log('');
    console.log('===== B 腿：真浏览器里 KaTeX 渲没渲出来 =====');
    let bBad = canOK ? 0 : 1;
    if (!canOK) {
      console.log('  ★★ 计数器自检没过 —— 下面那六格**一格都别信**（它们期待的全是 raw=0）。');
    }
    for (const c of LIVE_CASES) {
      // ★ 每格用**全新的 div**，而且不进 DOM 树 —— 免得上一格的 .katex 被数进这一格。
      //   数法本身在上面装好了（`window.__pmCount`），这里只负责喂。**别在这儿再抄一份**。
      const got = await q(`(()=>{ var d = document.createElement('div');` +
        ` SR.render.renderInto(d, ${JSON.stringify(c.in)}); return window.__pmCount(d); })()`);
      if (typeof got !== 'object' || !got) { console.log('  ✗ ' + c.name + ' —— 读不到（' + got + '）'); bBad++; continue; }
      const keepOK = !c.keeps || String(got.text).indexOf(c.keeps) >= 0;
      const ok = got.katex === c.katex && got.raw === c.raw && keepOK;
      if (!ok) bBad++;
      console.log((ok ? '  ✓ ' : '  ✗ ') + c.name);
      console.log('      屏幕上：KaTeX ' + got.katex + ' 个（期望 ' + c.katex + '）　' +
        '公式与代码之外漏渲染的裸命令 ' + got.raw + ' 个（期望 ' + c.raw + '）' +
        (c.keeps ? '　原文「' + c.keeps + '」' + (keepOK ? '还在' : '★ 不见了') : ''));
      console.log('      他说会看到这句话 →〔' + String(got.text).replace(/\s+/g, ' ').trim().slice(0, 120) + '〕');
      if (c.why) console.log('        ' + c.why);
      if (!ok) console.log('      ★ 这一格和期望对不上，别急着改期望值——先看上面"他会看到什么"');
    }
    await closeTab(TAB);
    console.log('');
    console.log('===== B 腿结果 =====');
    console.log('  ' + (LIVE_CASES.length - bBad) + '/' + LIVE_CASES.length + ' 通过' + (bBad ? '，★ 有 ' + bBad + ' 格红了' : ''));
    process.exit((bad || bBad) ? 1 : 0);
  } catch (e) {
    console.log('\n★ B 腿炸了：' + e.message);
    console.log('  （最常见的是 Chrome 没挂在 9222，或者 test/serve.cjs 不在 8138。）');
    if (TAB) await closeTab(TAB);       // ★ 关掉自己开的标签页：`/json/new` 只管开不管关
    process.exit(3);
  }
})();
