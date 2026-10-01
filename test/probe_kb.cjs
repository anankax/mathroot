// 知识库的**召回**验收：node test/probe_kb.cjs [url]
//
// 这一条验的不是"知识库在不在"，是**它到底什么时候动**。
// 老毛病（见 js/kb.js 的 queryFor）：检索只拿学生这一轮的原话，
// 而学生十有八九不点知识点的名。学生说"嗯""我不会"，话里一个知识点的字都没有，
// 二元组一个都对不上——于是手上 118 条，永远召不回。
//
// 所以这里跑三组对照，走的是**页面里那条真路**（SR.api.ask → buildSystem），
// 只把 fetch 换成假的，为的是把发出去的 system 抓下来看：
//   A 组｜学生这一轮只说"嗯"，但上一轮说过知识点   → 修完之后**应该**召回
//   B 组｜学生只说"嗯"，前面也什么都没说           → 应该召回不到（退回"没召回到"那一档）
//   C 组｜学生这一轮自己就点知识点的名             → 一直都能召回（对照组，证明量具没坏）
//
// A 组是这次改动的命根子：B 和 C 修不修它都长一个样，只有 A 会变。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const URL_ = (process.argv[2] && process.argv[2].indexOf('http') === 0) ? process.argv[2] : 'http://localhost:8138/index.html';
let PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function req(opts, body) {
  return new Promise((res, rej) => {
    const r = http.request(opts, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}

(async () => {
  const t = JSON.parse(await req({ host: 'localhost', port: 9222, path: '/json/new?about:blank', method: 'PUT' }));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {});
  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('页面抛错: ' + (r.result.exceptionDetails.exception || {}).description);
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  await send('Page.navigate', { url: URL_ });
  await q('try{localStorage.clear()}catch(e){}');
  await send('Page.navigate', { url: URL_ });
  for (let i = 0; i < 40; i++) { if (await q('!!(window.SR&&SR.chat&&SR.api&&SR.kb)')) break; await wait(500); }
  await wait(800);

  // 先把语料装上——这本来该由 ask() 自己拿，这里也让它自己拿（不预装），
  // 顺便看看 ask 里那句 await 是否真的等到了。
  ok('首屏还没有语料（延迟装载生效）',
     (await q('typeof SR.TEXTBOOK')) === 'undefined', await q('typeof SR.TEXTBOOK'));

  // 假 fetch：不真打模型，只把**请求体**抓下来。判的就是它。
  await q(`window.__cap=null; window.fetch=function(u,o){
    window.__cap = JSON.parse(o.body);
    var s='data: {"choices":[{"delta":{"content":"嗯，你说。"}}]}\\n\\ndata: [DONE]\\n\\n';
    return Promise.resolve(new Response(s,{status:200,headers:{'Content-Type':'text/event-stream'}}));
  };`);

  // 走真路跑一轮，回来把 system 抓出来
  const runTurn = (text, history) => q(
    '(async function(){ window.__cap=null;' +
    ' await SR.api.ask({mode:"student", text:' + JSON.stringify(text) + ',' +
    ' history:' + JSON.stringify(history) + ', parts:[], onChunk:function(){} });' +
    ' return window.__cap ? window.__cap.messages[0].content : null; })()');

  const SYS_HIT_KB = '附：这一轮翻出来的一类题';
  const SYS_HIT_TB = '附：这一轮给你翻出来的教材索引';
  // 只报"哪几段附注进去了"，别把上万字的 system 打出来
  const shape = s => {
    if (!s) return '（没抓到请求）';
    const bits = [];
    if (s.indexOf(SYS_HIT_TB) >= 0) bits.push('教材索引');
    if (s.indexOf(SYS_HIT_KB) >= 0) bits.push('追问条目');
    return bits.length ? bits.join(' + ') : '（只有提示词本身）';
  };

  console.log('\n----- A 组｜这一轮只说「嗯」，上一轮说过「绝对值」 -----');
  const A = await runTurn('嗯', [
    { role: 'user', content: '老师这道题我不会' },
    { role: 'assistant', content: '你先说说题里给了什么。' },
    { role: 'user', content: '就是那个绝对值化简的，我算到 x=4 就卡了' }
  ]);
  console.log('  system 里的附注：' + shape(A) + '　（共 ' + (A || '').length + ' 字）');
  ok('★ 前几轮说过知识点，这一轮只说「嗯」也能召回',
     !!A && A.indexOf(SYS_HIT_KB) >= 0, shape(A));

  // ⚠ 上面 A 组过了，不等于**这个改动**起了作用——说不定别的地方也在帮它召回。
  //   所以再拿同一个 buildSystem，喂**改之前那句话**（只有"嗯"、不带前几轮），
  //   看它是不是就召不到了。这一组要是也命中，A 组那条 ✓ 就白给了。
  console.log('\n----- A′ 组｜同一个学生，但只用改之前那句「嗯」去检索（对照） -----');
  const A2 = await q('SR.api.buildSystem("student","嗯","glm",[])');
  console.log('  system 里的附注：' + shape(A2));
  ok('只用「嗯」检索 → 召回不到（证明 A 组的命中是"带上前几轮"换来的，不是本来就有的）',
     !!A2 && A2.indexOf(SYS_HIT_KB) < 0, shape(A2));

  console.log('\n----- B 组｜这个学生从头到尾什么都没说 -----');
  const B = await runTurn('嗯', []);
  console.log('  system 里的附注：' + shape(B) + '　（共 ' + (B || '').length + ' 字）');
  ok('召不到就不给附注（退回只有提示词那一档，不是硬塞一条）',
     !!B && B.indexOf(SYS_HIT_KB) < 0, shape(B));
  ok('B 组的 system 比 A 组短（确实是"少了一段"，不是换了一段）',
     !!A && !!B && B.length < A.length, [A && A.length, B && B.length]);

  console.log('\n----- C 组｜学生自己点了知识点的名（对照组） -----');
  const C = await runTurn('数轴上到原点的距离是3的点有几个', []);
  console.log('  system 里的附注：' + shape(C) + '　（共 ' + (C || '').length + ' 字）');
  ok('说了知识点就能召回（改之前也是这个表现——量具没坏）',
     !!C && C.indexOf(SYS_HIT_KB) >= 0, shape(C));

  // ★ 泄漏测试（2026-10-01 立）。这是本机面板第一次打开就抓到的真问题：
  //   学生说"这道题我不会"——一个字的知识点都没有——原来也会召回
  //   「图形的变换·旋转(7.9)」并喂进 system。原来那条 score < 3 的线，
  //   在 13 句泛泛的学生话里放进去 11 句。现在抬到 10（理由见 js/kb.js）。
  //   这一组就是把它钉住：**泛泛的话，一条都不许漏进去。**
  console.log('\n----- D 组｜泛泛的学生话，一条都不许召回 -----');
  const NOISE = [
    '这道题我不会', '我看不懂题目', '第二题', '我随便写的',
    '哦哦我明白了', '等一下我看看', '老师这道题怎么做', '我算到一半就不会了', '这个我忘了',
  ];
  let leaked = [];
  for (const s of NOISE) {
    const sys = await runTurn(s, []);
    if (sys && sys.indexOf(SYS_HIT_KB) >= 0) leaked.push(s);
  }
  ok('九句泛泛的话，一句都没漏进 system', leaked.length === 0, leaked);

  // 反过来：一句真的点了知识点的短话，仍然要进得来（别为了堵漏把门焊死）
  const shortOK = await runTurn('我不会画数轴', []);
  ok('该召回的短话仍然进得来（没把门焊死）',
     !!shortOK && shortOK.indexOf(SYS_HIT_KB) >= 0, shape(shortOK));

  // 攒长也不行：前几轮全是废话的学生，攒到第五轮还是不许漏
  const piled = await runTurn('嗯', [
    { role: 'user', content: '这道题我不会' }, { role: 'assistant', content: '你说说题里给了什么。' },
    { role: 'user', content: '我看不懂题目' }, { role: 'assistant', content: '那就先念题。' },
    { role: 'user', content: '我算到一半就不会了' }, { role: 'assistant', content: '算到哪一步？' },
    { role: 'user', content: '老师这道题怎么做' }, { role: 'assistant', content: '你先说说你的想法。' },
    { role: 'user', content: '等一下我看看' }, { role: 'assistant', content: '好。' }
  ]);
  console.log('  五轮废话之后：' + shape(piled));
  ok('★ 前几轮全是废话，攒到第五轮也不许漏进 system',
     !!piled && piled.indexOf(SYS_HIT_KB) < 0, shape(piled));

  console.log('\n----- 顺序：收尾块必须还在最末尾 -----');
  // ★ 这条是 api.js 里反复强调过的：PROMPT_TAIL 要占住"最后一段"这个位置，
  //   小模型只认最后读到的东西。新加的附注只能排在它**前面**。
  const tailBit = '一个字都不许抄';   // prompt-tail.js 里的原话
  const lastNotes = [A, B, C].map(s => {
    if (!s) return null;
    return { 有收尾: s.indexOf(tailBit) >= 0, 收尾在附注之后: s.lastIndexOf(tailBit) > Math.max(s.lastIndexOf(SYS_HIT_TB), s.lastIndexOf(SYS_HIT_KB)) };
  });
  ok('三轮的 system 里都有收尾块', lastNotes.every(x => x && x.有收尾), lastNotes);
  ok('收尾块都在所有附注之后', lastNotes.every(x => x && x.收尾在附注之后), lastNotes);

  console.log('\n结果：' + PASS + ' 通过, ' + FAIL + ' 失败');
  ws.close(); process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('探针自己炸了:', e); process.exit(2); });
