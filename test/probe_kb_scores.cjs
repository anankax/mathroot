// 量阈值：node test/probe_kb_scores.cjs
//
// 起因是「知识库」面板第一次打开就露了馅：学生说「这道题我不会，我算到一半就卡住了」——
// 一个字的知识点都没有——却也召回了「图形的变换·旋转(7.9)」「因式分解(4.9)」，
// 全都过了 pickZhuawen 那条 score < 3 的线。这些条目跟这道题毫无关系。
//
// 所以这里把两拨话放在一起量分数：
//   一拨是**真的点了知识点的名**（该召回）；一拨是**泛泛的学生话**（不该召回）。
// 要的是两拨之间有没有一条分得开的界。分不开就说明光调阈值治不了，
// 得换个判据——**先把这件事量出来，再决定怎么改**。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const QUERIES = [
  // —— 该召回的：话里点着知识点的名 ——
  ['该召回', '数轴上到原点的距离是3的点有几个'],
  ['该召回', '绝对值化简的时候我不知道要不要变号'],
  ['该召回', '一元二次方程增长率是平方还是乘2'],
  ['该召回', '分式方程解完要不要检验'],
  ['该召回', '完全平方公式中间那一项'],
  // ★ 下面这些是**学生真会打的短话**——阈值定得太高，先砍掉的就是这一批。
  //   它们比上一批短得多，二元组少，分数天然低，所以必须一起量。
  ['该召回', '绝对值'],
  ['该召回', '我不会画数轴'],
  ['该召回', '这题要用勾股定理吗'],
  ['该召回', '增长率'],
  ['该召回', '分式方程'],
  ['该召回', '因式分解'],
  ['该召回', '这个圆怎么画'],
  ['该召回', '三视图看不出来'],
  // —— 不该召回的：泛泛的学生话，一个知识点都没有 ——
  ['不该召回', '这道题我不会'],
  ['不该召回', '这道题我不会，我算到一半就卡住了'],
  ['不该召回', '嗯'],
  ['不该召回', '老师，这是昨天的卷子，好多不会'],
  ['不该召回', '我看不懂题目'],
  ['不该召回', '第二题'],
  ['不该召回', '我随便写的'],
  ['不该召回', '哦哦我明白了'],
  ['不该召回', '等一下我看看'],
  ['不该召回', '老师这道题怎么做'],
  ['不该召回', '我算到一半就不会了'],
  ['不该召回', '这个我忘了'],
  ['不该召回', '答案是多少'],
];

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
  const q = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.result.value;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  await send('Page.navigate', { url: 'http://localhost:8138/index.html' });
  for (let i = 0; i < 40; i++) { if (await q('!!(window.SR&&SR.kb)')) break; await wait(500); }
  await q('window.__ok=null; SR.kb.load(function(o){window.__ok=o})');
  for (let i = 0; i < 20; i++) { await wait(300); if (await q('window.__ok!==null')) break; }
  console.log('语料就位:', await q('JSON.stringify(SR.kb.status().map(function(r){return r.条数}))'));

  const rows = [];
  for (const [want, text] of QUERIES) {
    const r = await q('JSON.stringify(SR.kb.search(' + JSON.stringify(text) + '))');
    const o = JSON.parse(r);
    const zw = o.zhuawen || [], tb = o.textbook || [];
    rows.push({
      want, text,
      zw1: zw[0] ? zw[0].score : 0, zw1t: zw[0] ? zw[0].doc.title.slice(0, 26) : '—',
      tb1: tb[0] ? tb[0].score : 0, tb1t: tb[0] ? tb[0].doc.title.slice(0, 26) : '—',
    });
  }

  console.log('\n' + '话'.padEnd(4) + '查询'.padEnd(34) + '条目库首条'.padEnd(30) + '分'.padEnd(7) + '教材首条'.padEnd(28) + '分');
  console.log('-'.repeat(115));
  for (const r of rows) {
    console.log(r.want.padEnd(6) + r.text.padEnd(34) + r.zw1t.padEnd(30) +
      String(r.zw1.toFixed(1)).padEnd(9) + r.tb1t.padEnd(28) + r.tb1.toFixed(1));
  }

  const hit = rows.filter(r => r.want === '该召回').map(r => r.zw1);
  const no = rows.filter(r => r.want === '不该召回').map(r => r.zw1);
  const lo = Math.min(...hit), hi = Math.max(...no);
  console.log('\n条目库首条分数：该召回组 ' + lo.toFixed(1) + ' ~ ' + Math.max(...hit).toFixed(1) +
              '　|　不该召回组 ' + Math.min(...no).toFixed(1) + ' ~ ' + hi.toFixed(1));
  console.log(lo > hi
    ? ('  → 分得开。阈值取 ' + ((lo + hi) / 2).toFixed(1) + ' 附近即可（' + hi.toFixed(1) + ' < 阈值 < ' + lo.toFixed(1) + '）')
    : ('  ★ 分不开：不该召回的那组最高 ' + hi.toFixed(1) + '，比该召回的最低 ' + lo.toFixed(1) + ' 还高。' +
       '\n    光调阈值治不了——把线抬到 ' + lo.toFixed(1) + ' 以上，该召回的也一起被砍掉了。' +
       '\n    得换判据（比如先判"这句话里有没有知识点"，没有就压根不检索）。'));

  // ---- 第二件事：queryFor 把前几轮拼进来之后，分数会不会被"拼长"顶上去 ----
  // ★ BM25 是**累加**的：检索词里不同的二元组越多，能撞上的机会越多，
  //   哪怕每一条都只是勉强撞上，加起来也会把分数抬起来。
  //   所以"把前几轮一起检索"这个改动，有一个反向的风险：
  //   一个从头到尾都在说废话的学生，攒到第三轮说不定就够上阈值了。
  //   这一节就是量它——量出来才知道阈值该定在哪儿。
  console.log('\n----- 拼上「前几轮」之后，泛泛的话会不会攒够分 -----');
  const CONVOS = [
    ['泛泛的话 ×1', ['这道题我不会']],
    ['泛泛的话 ×2', ['这道题我不会', '我看不懂题目']],
    ['泛泛的话 ×3', ['这道题我不会', '我看不懂题目', '我算到一半就不会了']],
    ['泛泛的话 ×5', ['这道题我不会', '我看不懂题目', '我算到一半就不会了', '老师这道题怎么做', '等一下我看看']],
  ];
  const convRows = [];
  for (const [name, turns] of CONVOS) {
    // 模拟真实历史：前几轮是学生的话，夹着模型的回复
    const hist = [];
    for (const s of turns) { hist.push({ role: 'user', content: s }); hist.push({ role: 'assistant', content: '你先说说题里给了什么。' }); }
    const r = await q('JSON.stringify(SR.kb.search(SR.kb.queryFor("嗯", ' + JSON.stringify(hist) + ')))');
    const o = JSON.parse(r);
    const zw = (o.zhuawen || [])[0], tb = (o.textbook || [])[0];
    convRows.push({ name, zw: zw ? zw.score : 0, zwt: zw ? zw.doc.title.slice(0, 24) : '—', tb: tb ? tb.score : 0 });
    console.log('  ' + name.padEnd(12) + '条目库首条 ' + String((zw ? zw.score : 0).toFixed(1)).padEnd(7) +
                (zw ? zw.doc.title.slice(0, 24) : '—') + '　｜　教材首条 ' + (tb ? tb.score.toFixed(1) : '0.0'));
  }
  const convMax = Math.max(...convRows.map(r => r.zw));
  console.log('  攒得起来的最高分：' + convMax.toFixed(1) +
    (convMax < 10 ? '　→ 攒不过 10 分，阈值定在 10 挡得住' : '　★ 攒过了 10 分——阈值要往上抬，或者改成"每轮只拿这一轮的话检索"'));

  // 阈值那条线现在扫掉多少
  for (const cut of [3, 5, 6, 8, 10, 12, 15, 18]) {
    const passHit = hit.filter(s => s >= cut).length, passNo = no.filter(s => s >= cut).length;
    console.log('  阈值 ' + String(cut).padEnd(3) + '：该召回 ' + passHit + '/' + hit.length +
                ' 段进 system，不该召回 ' + passNo + '/' + no.length + ' 段也进');
  }
  ws.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
