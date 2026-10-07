// 一条**确定性**的尺子：`js/api.js` 收流末尾那条「整段都被当思考剥光了」的兜底，
// **到底有没有把字推给气泡**。
//
// ============================================================
// 为什么要专门为这一条写尺子（2026-10-06 夜）
// ============================================================
// 那条兜底原来是**两条 if**：
//     if (!all && rawAll) all = rawAll.replace(/<\/?think>/gi, '').trim();
//     if (strip && !all && rawAll) { all = …; onChunk(all); }     ← 这句一次都没跑过
// 第二条里的 `!all` 刚被上面那条赋过值，轮到它时**永远不成立**。死代码。
//
// 它坏在哪：气泡里的字是 chat.js 那条 `onChunk` 攒出来的
//   （`msg.raw += piece; paint(msg)`，js/chat.js:2588），
//   而返回值 `res.text` 走的是账本和记忆（chat.js:2608 / 2628）。
// 兜底这一趟**只补了返回值、没补气泡** → 屏幕上是一颗**空气泡**，
// 账本里那句话却是全的 —— 刷新/重画一遍又出来了。当场看像是"模型什么都没说"。
// 这一族的名字在 [[scanner-numbers-are-not-what-they-claim]] 里：
// **桩不照产品合同演 → 一个病根长出三件"产品坏了"**，空气泡就是其中一件。
//
// ============================================================
// 尺子怎么造（不碰网络、不调模型）
// ============================================================
// 拿一个假 `fetch` 顶上去，喂它一段**自己编的 SSE 帧**，让收流那条路原样跑完。
// 三条用例，三个方向：
//   A 整段包在 `<think>…</think>` 里 —— **这就是那个反例**：兜底该开，且必须**推给气泡**；
//   B 正常正文 —— 兜底**不该**开，而且不许推两遍；
//   C 开头一段 think + 后面真正文 —— 剥完**还剩字** → 兜底不该开（防"多推一遍"那一支）：
//     这一条捏住的正是兜底的**判据是 `!all` 而不是"rawAll 有没有东西"**。判据写松一格，
//     气泡里就会多出一整段带 `<think>` 标签的原文。
//     ⚠ C 原来是照"正文 + 尾巴一段 think"写的，第一版当场红了 —— **红的是我写错的那句前提**：
//       这个剥器只认**开头**那一段（`makeStripper` 里 `decided` 一旦落定就不再进 inside），
//       正文中间的 `<think>` 它**原样放过**。这不是缺陷：它要治的是
//       `glm-4.1v-thinking-flash` 那种"正文开头就是 `<think>用户的问题是问…`"的形状
//       （见 makeStripper 上面那段），不是通用剥器。拿它去量中间夹 think，量的是我以为的它。
//
// ★★ A 那条同时自带"反例做进每一步"的自证，别删：
//   要是哪天有人把兜底整段删了，`all` 会是空串 → `ask` 直接返回 `{error:'模型没说出话来'}`，
//   **A1 当场就红**（读到的不是一个字符串）。也就是说这一格红了，
//   光是"兜底没开"就够解释，不用去猜别处。尺子**在坏产品上红得出来**，才有人敢信它绿。
//
// ★★ 而且这一版真的**把它拿到坏产品上跑过一遍**（不留痕的那种）：
//   `node test/probe_stripfallback.cjs --旧兜底` 会把 api.js 的源码**在内存里**改回原来那两条 if
//   （**磁盘上一个字节都不动**），再跑同三条用例 —— A3 当场红、B/C 照旧绿，
//   读数印在 test/_out/stripfallback_旧.txt。
//   为什么非这么做：这一格绿的时候说明不了什么（"兜底没开"和"兜底开了但没推"在我看来长得一样）；
//   只有**在坏产品上红过**的尺子，绿才有分量。[[scanner-numbers-are-not-what-they-claim]]
//
// 用法：node test/probe_stripfallback.cjs [--旧兜底]
const path = require('path'), fs = require('fs');

// ---- 装产品（跟 probe_ggbcmds.cjs 同序同集：少装一份就是"那段静默跳过、读数照样绿"）----
const store = {};
const LS = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const W = { SR: {} };
const 文件表 = ['config.js', 'prompt-base.js', 'prompt-draw.js', 'drawkb.js', 'ggbcmds.js',
  'prompt-say.js', 'textbook.js', 'retrieve.js', 'api.js', 'render.js', 'chips.js'];

// ★ --旧兜底：只在内存里把 api.js 改回"两条 if"的老写法（见文件顶上那段）。
//   **不碰磁盘**：改的是下面这个字符串，`fs.readFileSync` 只读不写。
const 旧兜底 = process.argv.indexOf('--旧兜底') >= 0;
function 读源码(f) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  if (f !== 'api.js' || !旧兜底) return s;
  const 起 = s.indexOf('      if (!all && rawAll) {');
  const 止 = s.indexOf('\n      }', 起);
  if (起 < 0 || 止 < 0) throw new Error('★ 定位不到兜底那一段 —— 源码改过形状了，先修这把尺子');
  const 老 = '      if (!all && rawAll) all = rawAll.replace(/<\\/?think>/gi, \'\').trim();\n'
    + '      if (strip && !all && rawAll) { all = rawAll.replace(/<\\/?think>/gi, \'\').trim(); onChunk(all); }';
  return s.slice(0, 起) + 老 + s.slice(止 + '\n      }'.length);
}

// 假 fetch 是可换的：真身灌进来之后，用例里只换这一个变量
let 当前fetch = function () { throw new Error('这一趟没给假回应'); };
for (const f of 文件表) {
  new Function('window', 'localStorage', 'navigator', 'fetch',
    'var SR = (window.SR = window.SR || {});\n' + 读源码(f)
  )(W, LS, { onLine: true }, function () { return 当前fetch.apply(null, arguments); });
}
const SR = W.SR;

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => {
  if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); }
  else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); }
};

// ---- 身份自检：装的到底是不是这一版（证不出来整场作废）----
{
  console.log('装表 ' + 文件表.length + ' 份：' + 文件表.join(' '));
  if (旧兜底) console.log('★★ 反例自证模式：api.js 已在内存里改回"两条 if"的老写法（磁盘没动）——'
    + '下面 A3 **应该红**；要是它还绿，说明这把尺子量不到这件事，正常那趟的绿也不算数。');
  console.log('');
  const 缺 = [];
  if (typeof SR.api !== 'object' || typeof SR.api.ask !== 'function') 缺.push('SR.api.ask');
  if (typeof SR.GLM_KEY !== 'string' || SR.GLM_KEY.length < 10) 缺.push('SR.GLM_KEY（免费后端要它才肯发）');
  if (typeof SR.render === 'undefined') 缺.push('SR.render');
  if (缺.length) { console.error('★ 装不上：' + 缺.join('、') + ' —— 这趟读数作废。'); process.exit(2); }
}

// ---- 假 SSE ----
// 一个 chunk 一段（跟真流一样：标签可能被切开，所以下面 C 那条特意把 </think 切两半）
function 假响应(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true, status: 200, headers: { get: () => 'text/event-stream' },
    body: { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true }) }) },
    text: async () => ''
  };
}
const 帧 = s => 'data: ' + JSON.stringify({ choices: [{ delta: { content: s } }] }) + '\n';
const 尾 = 'data: [DONE]\n';

// 跑一轮：返回 { res, 收到 }（收到 = onChunk 逐段拼起来的气泡内容）
async function 跑一轮(chunks) {
  当前fetch = async () => 假响应(chunks);
  let 收到 = '', 段落数 = 0;
  const res = await SR.api.ask({
    work: 'draw', history: [], text: '画一条线段 AB',
    onChunk: function (piece) { 收到 += piece; 段落数++; }
  });
  return { res: res, 收到: 收到, 段落数: 段落数 };
}

(async () => {
  console.log('══ A 整段都被当思考剥光了 —— 兜底该开，而且必须推给气泡（这条就是那个反例）══');
  {
    const 内文 = '用户问的是画一条线段';
    const { res, 收到, 段落数 } = await 跑一轮([帧('<think>' + 内文 + '</think>'), 尾]);
    // A1：先证"兜底那一条支路真跑到了"。没跑到的话 all 是空串，返回的是 {error:'模型没说出话来'}。
    判('A1 兜底真跑到了（返回值是那句话，不是「模型没说出话来」）',
      !res.error && typeof res.text === 'string', res.error ? ('★ ' + res.error) : ('res.text = ' + JSON.stringify(res.text)));
    判('A2 └ 剥掉标签的正文就是那句思考原话',
      res.text === 内文, JSON.stringify(res.text) + ' vs ' + JSON.stringify(内文));
    // ★★ A3 是这一整个探针存在的理由
    判('A3 ★★ 兜底那段话**真推给了气泡**（onChunk 收到的就是 res.text）',
      收到 === res.text && 收到.length > 0,
      '气泡收到 ' + JSON.stringify(收到) + '（' + 段落数 + ' 段）／返回值 ' + JSON.stringify(res.text || ''));
  }

  console.log('\n══ B 正常正文 —— 兜底不该开，也不许推两遍 ══');
  {
    const 正文 = '画一条线段 AB，长 5 厘米。';
    const { res, 收到, 段落数 } = await 跑一轮([帧(正文), 尾]);
    判('B1 返回值就是正文', res.text === 正文, JSON.stringify(res.text));
    判('B2 ★ 气泡收到的跟返回值**一模一样**（差一个字符就是推重了）', 收到 === 正文,
      JSON.stringify(收到) + ' ／ ' + 段落数 + ' 段');
  }

  console.log('\n══ C 开头一段 think + 后面真正文 —— 剥完还有字，兜底不该开（防"多推一遍"）══');
  {
    const 正文 = '答案：画一条线段 AB。';
    // ★ 标签是**切两半**喂进去的（`<thi` + `nk>…`）——剥器注释里说它会攒着判跨 chunk 的标签，
    //   顺手把这件事也量上。
    const { res, 收到, 段落数 } = await 跑一轮([帧('<thi'), 帧('nk>用户在问线段</think>'), 帧(正文), 尾]);
    判('C1 剥掉开头那段 think，留下的是真正文', res.text === 正文, JSON.stringify(res.text));
    判('C2 ★ 气泡收到的**只有真正文**（兜底没把带标签的原文又补一遍）', 收到 === 正文,
      JSON.stringify(收到) + ' ／ ' + 段落数 + ' 段');
  }

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });
