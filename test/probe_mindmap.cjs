// 思维导图那把尺子。纯 node，不联网、不花额度、不开浏览器。
//
// 量的是**几何**：框摆得对不对、线连得对不对、"没选中的路还在不在"。
// ⚠ 它**不画**、也不看画出来好不好看——好不好看只有孔老师看得出来（见文件末尾）。
//
// 这把尺子只能问"我在不在工作"：它自己先拿一份**故意摆错**的版面跑一遍，
// 看那些"该报的"报没报（见下面 selftest）。不先跑红，就不知道它会不会报。
const path = require('path'), fs = require('fs');

// ---- 把数根那几个 js 原样装进来（跟浏览器同一个 window 形状）----
// ⚠ chips.js / mindmap.js 里都是直接写 `SR.xxx = …`、自己没声明 SR——
//   在 node 的假 window 里它就是个未定义变量，一跑就 ReferenceError。
//   所以前面补一句 `var SR = window.SR`。（跟 probe_plan.cjs 同一个坑。）
// ★ mindmap 排在 chips **后面**：它调 SR.parseRoutes / SR.absorbChain / SR.numOf，
//   那几件全在 chips.js 里。顺序反了不是"少个功能"，是一上来就崩。
const store = {};
const LS = { getItem: k => (k in store ? store[k] : null),
             setItem: (k, v) => { store[k] = String(v); },
             removeItem: k => { delete store[k]; } };
const W = { SR: {} };
for (const f of ['config.js', 'chips.js', 'mindmap.js']) {
  try {
    new Function('window', 'localStorage', 'navigator',
      'var SR = (window.SR = window.SR || {});\n' + fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))(W, LS, { onLine: true });
  } catch (e) { console.log('装 ' + f + ' 炸了：' + e.message); process.exit(1); }
}
const SR = W.SR;
// ★ 缺了哪一件就说哪一件，别拿 undefined 一路量到底——那样每条都会"过"，
//   而过的原因是它压根没在测东西。（记忆里"数字不是它宣称的那件事"那个形状。）
{
  const need = ['parseRoutes', 'parseStepBody', 'numOf', 'absorbChain', 'chainState'];
  const miss = need.filter(k => typeof SR[k] !== 'function');
  if (miss.length) { console.log('★ chips.js 里缺：' + miss.join(' ') + ' —— 下面那些判据一条都别信。'); process.exit(1); }
  if (!SR.mm || typeof SR.mm.layout !== 'function' || typeof SR.mm.latexToText !== 'function') {
    console.log('★ mindmap.js 没装上（SR.mm.layout / latexToText 找不到）—— 上面那些判据一条都别信。');
    process.exit(1);
  }
}

let bad = 0, n = 0;
function ok(cond, what, extra) {
  n++;
  if (cond) { console.log('  ✓ ' + what); return true; }
  bad++;
  console.log('  ✗ ' + what + (extra ? '   ← ' + extra : ''));
  return false;
}
function head(s) { console.log('\n' + s); }

// —— 造一份"真会出现的"历史回复串 ——
// 三段：第一段出两条错路并说走第 2 路，第二段展开第 1 环节，第三段展开第 2、3 环节。
const TURNS = [
  { visible: '这道题问 |x|=5，学生有两种错法：①他以为 x 一定是正数，所以只写了一个答案；' +
             '②他把 -7 当成 7 了。我打算先走第 2 路，大概 3 个环节。\n\n第 1 节 · 先把"距离"这个词捞出来\n' +
             '学生说：x 到原点的距离是 5，那 x 就是 5。\n你接这句：还有哪个数到原点也是 5？\n这么接的道理：让它自己看见另一边。', ggb: [] },
  { visible: '第 2 节 · 把"两个答案"并排摆出来\n学生说：那就是 5 和 -5 都对。\n' +
             '你接这句：题目问的"等于 5"和"距离是 5"是一回事吗？\n这么接的道理：摆在一起才看得出差别。\n\n' +
             '第 3 节 · 让他把答案说回题目\n学生说：我算出来 3，可题目问的是距离。\n' +
             '你接这句：那你刚才算的是什么？\n这么接的道理：把"算的"和"问的"分开。', ggb: [] }
];

head('一、latexToText — 公式得变成能画的字');
const CASES = [
  ['$\\frac{1}{2}$', '1/2'],
  ['$\\frac{x+1}{3}$', '(x+1)/3'],
  ['$\\sqrt{3}$', '√3'],
  ['$\\sqrt{x+1}$', '√(x+1)'],
  ['$x^{2}$', 'x²'],
  ['$x^{10}$', 'x¹⁰'],
  ['$a_{1}$', 'a₁'],
  ['$\\frac{\\frac{1}{2}}{3}$', '(1/2)/3'],
  ['$2\\times 3$', '2×3'],
  ['$a\\div b$', 'a÷b'],
  ['$x\\leq 5$', 'x≤5'],
  ['$x\\geq -5$', 'x≥-5'],
  ['$x\\neq 0$', 'x≠0'],
  ['$\\angle ABC$', '∠ABC'],
  ['$\\triangle ABC$', '△ABC'],
  ['$3.14\\pi$', '3.14π'],
  ['$-7$ 的绝对值是 $7$', '-7 的绝对值是 7'],
  ['$30^{\\circ}$', '30°'],
  ['$y=\\frac{1}{2}x+1$', 'y=1/2x+1'],
  ['$y = 2x - 1$', 'y=2x - 1'],          // = 两边的空格收掉；**减号两边的故意不收**（见下面那条注释）
  ['$\\sqrt[3]{8}$', '³√8'],
  ['$AB\\parallel CD$', 'AB∥CD'],
  ['$\\overrightarrow{AB}$', 'overrightarrowAB'],
  ['\\frac{1}{2}', '1/2'],                 // 没包 $ 的裸 LaTeX
  ['纯中文，一个公式都没有', '纯中文，一个公式都没有']
];
CASES.forEach(([src, want]) => {
  const got = SR.mm.latexToText(src);
  ok(got === want, JSON.stringify(src) + ' → ' + JSON.stringify(got), got === want ? '' : '想要的：' + JSON.stringify(want));
});
// ★ 减号两边的空格**故意不收**（上面那条对照就是钉这件事的）。
//   加号、乘号、等号收了都不会出事；减号不一样——它在中文里还能是连字符和破折号，
//   `2x - 1` 收成 `2x-1` 没事，但"第一 - 第三"那种收完就成了一个不存在的词。
//   面上难看一点，好过**悄悄地改掉老师写的话**。

head('二、latexToText — 输出里不许再有反斜杠和美元');
const dirty = [];
CASES.forEach(([src]) => { const g = SR.mm.latexToText(src); if (/[\\$]/.test(g)) dirty.push(JSON.stringify(src) + ' → ' + JSON.stringify(g)); });
ok(dirty.length === 0, CASES.length + ' 条对照全都干净', dirty.join(' / '));
ok(SR.mm.latexToText('$x^{2}$') === SR.mm.latexToText('$x^{2}$'), '同一份输入跑两遍，输出一样');

head('三、chainDoc — 从回复串里读出来的东西');
const doc = SR.mm.chainDoc(TURNS, { topic: '已知 $|x|=5$，求 $x$。' });
ok(doc.routes.length === 2, '读出 2 条岔路（读到 ' + doc.routes.length + ' 条）');
ok(doc.routes[0] && /正数/.test(doc.routes[0].text), '第 1 条是"他以为 x 一定是正数"', doc.routes[0] && doc.routes[0].text);
ok(doc.routes[1] && !/我打算先走/.test(doc.routes[1].text), '第 2 条**没**把"我打算先走"那半句计划吞进去', doc.routes[1] && doc.routes[1].text);
ok(doc.chosen === '2', '认出它选了第 2 路（认出来的是 ' + JSON.stringify(doc.chosen) + '）');
ok(doc.steps.length === 3, '读出 3 个环节（读到 ' + doc.steps.length + ' 个）', doc.steps.map(s => s.n).join(','));
ok(doc.steps[0] && /距离/.test(doc.steps[0].name || ''), '第 1 个环节的名字是"先把距离这个词捞出来"', doc.steps[0] && doc.steps[0].name);
ok(doc.steps[0] && /到原点的距离是 5/.test(doc.steps[0].said || ''), '第 1 个环节挂着学生那句原话', doc.steps[0] && doc.steps[0].said);
ok(doc.steps[2] && /题目问的是距离/.test(doc.steps[2].said || ''), '第 3 个环节那句学生的话没跑到第 1 个里去', doc.steps[2] && doc.steps[2].said);
ok(!/第\s*1\s*节/.test(doc.steps[0] && doc.steps[0].said || ''), '学生的话里不夹着"第 1 节"这种标记');

head('四、layout — 版面几何');
function geom(d, o) { return SR.mm.layout(d, o); }

function overlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}
function allPairs(list, fn) {
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) fn(list[i], list[j]);
}
function onBorder(n, x, y) {
  const e = 0.6;
  const nearX = Math.abs(x - n.x) <= e || Math.abs(x - (n.x + n.w)) <= e;
  const nearY = Math.abs(y - n.y) <= e || Math.abs(y - (n.y + n.h)) <= e;
  const inX = x >= n.x - e && x <= n.x + n.w + e;
  const inY = y >= n.y - e && y <= n.y + n.h + e;
  return inX && inY && (nearX || nearY);
}

[['竖排（3 个环节）', doc, {}],
 ['横排（12 个环节）', Object.assign({}, doc, {
    steps: Array.from({ length: 12 }, (_, i) => ({ n: i + 1, name: '第 ' + (i + 1) + ' 个环节', said: '学生说的一句话', you: '你接一句', why: '' }))
  }), {}],
 ['没有岔路', Object.assign({}, doc, { routes: [], chosen: '' }), {}],
 ['只有题目', { topic: '求 $x$。', routes: [], chosen: '', steps: [] }, {}],
 ['什么都没有', { topic: '', routes: [], chosen: '', steps: [] }, {}],
 ['6 条岔路', Object.assign({}, doc, {
    routes: Array.from({ length: 6 }, (_, i) => ({ key: String(i + 1), label: '第 ' + (i + 1) + ' 路', text: '第 ' + (i + 1) + ' 种错法，学生这么想的。' }))
  }), {}]
].forEach(([label, d, o]) => {
  const L = geom(d, o);
  console.log('  · ' + label + ' → ' + L.w + '×' + L.h + (L.empty ? '（空场占位）' : '') +
              (L.horizontal ? ' 横排' : ' 竖排'));
  ok(Number.isFinite(L.w) && Number.isFinite(L.h) && L.w > 0 && L.h > 0,
     label + '：包围盒是个有限的正常数');
  ok(L.nodes.every(x => Number.isFinite(x.x) && Number.isFinite(x.y)), label + '：每个框的坐标都是数');
  ok(L.nodes.every(x => x.x >= 0 && x.y >= 0), label + '：没有框跑到负数区去');
  ok(L.nodes.every(x => x.x + x.w <= L.w + 1 && x.y + x.h <= L.h + 1), label + '：没有框伸出包围盒');

  const pairs = [];
  allPairs(L.nodes, (a, b) => { if (overlap(a, b)) pairs.push(a.kind + '/' + b.kind); });
  ok(pairs.length === 0, label + '：框两两不重叠', pairs.join(' '));

  const offs = [];
  L.edges.forEach(e => {
    const from = L.nodes.find(x => onBorder(x, e.x1, e.y1));
    const to = L.nodes.find(x => onBorder(x, e.x2, e.y2));
    if (!from) offs.push('起点 (' + Math.round(e.x1) + ',' + Math.round(e.y1) + ') 不在任何框边上');
    if (!to) offs.push('终点 (' + Math.round(e.x2) + ',' + Math.round(e.y2) + ') 不在任何框边上');
  });
  ok(offs.length === 0, label + '：' + L.edges.length + ' 条线两端都落在框边上', offs.slice(0, 3).join(' / '));
});

head('五、岔路：没选中的那条必须还在，而且带 dim');
{
  const L = geom(doc, {});
  ok(L.routes.length === 2, '两条路都画出来了（没把没选中的丢掉）');
  const dim = L.routes.filter(r => r.dim).map(r => r.key);
  const lit = L.routes.filter(r => !r.dim).map(r => r.key);
  ok(dim.length === 1 && dim[0] === '1', '没选中的是第 1 路（dim：' + JSON.stringify(dim) + ')');
  ok(lit.length === 1 && lit[0] === '2', '亮着的是第 2 路（' + JSON.stringify(lit) + '）');
  // 主干那条线得从**选中的**那一条出来
  const first = L.steps[0];
  const hit = L.edges.filter(e =>
    Math.abs(e.y2 - first.y) <= 0.6 || Math.abs(e.x2 - first.x) <= 0.6 ||
    Math.abs(e.x2 - (first.x + first.w)) <= 0.6 || Math.abs(e.y2 - (first.y + first.h)) <= 0.6);
  ok(hit.length > 0, '主干跟岔路那一层连上了');
}
{
  // 读不出选了哪条 → **不许替它挑一条**
  const L = geom(Object.assign({}, doc, { chosen: '' }), {});
  ok(L.routes.every(r => !r.dim), '读不出选了哪条时，两条路**都不 dim**（不替它挑）');
  ok(L.edges.some(e => e.dim), '连主干的线标成 dim（"从这一排出来"，没说选了哪条）');
}
{
  const L = geom({ topic: '', routes: [], chosen: '', steps: [{ n: 1, name: '一', said: '', you: '', why: '' }] }, {});
  ok(L.edges.length === 0, '没有岔路也没有题目时，不连出凭空的线');
}

head('六、hit — 点到哪儿算点到');
{
  const L = geom(doc, {});
  const r0 = L.routes[0];
  const g = L.hit(r0.x + r0.w / 2, r0.y + r0.h / 2);
  ok(g === r0, '点岔路正中 → 命中那条岔路');
  const s0 = L.steps[0];
  ok(L.hit(s0.x + s0.w / 2, s0.y + s0.h / 2) === s0, '点环节正中 → 命中那个环节');
  let threw = null;
  try { L.hit(L.w - 1, L.h - 1); L.hit(-50, -50); L.hit(1e9, 1e9); } catch (e) { threw = e.message; }
  ok(!threw, '画面上任意一处（含界外）点下去都不炸', threw);
  ok(geom({ topic: '', routes: [], chosen: '', steps: [] }, {}).hit(10, 10) === null, '空场里点哪儿都是 null');
}

head('七、横排的触发条件');
{
  const six = { topic: 't', routes: [], chosen: '', steps: Array.from({ length: 6 }, (_, i) => ({ n: i + 1, name: 'n' + i, said: '', you: '', why: '' })) };
  const seven = Object.assign({}, six, { steps: six.steps.concat([{ n: 7, name: 'n6', said: '', you: '', why: '' }]) });
  ok(geom(six, {}).horizontal === false, '6 个环节还是竖排');
  ok(geom(seven, {}).horizontal === true, '7 个环节自动改成横排');
  ok(geom(six, { orient: 'h' }).horizontal === true, 'orient:\'h\' 能强制横排（探针和导出要用）');
  ok(geom(seven, { orient: 'v' }).horizontal === false, 'orient:\'v\' 能强制竖排');
}

head('八、paint — 拿个假 ctx 走一遍，看它会不会崩、有没有画东西');
{
  const calls = [];
  const fake = new Proxy({}, {
    get(_, k) {
      if (k === 'measureText') return s => ({ width: String(s).length * 7 });
      if (k === 'canvas') return null;
      return (...a) => { calls.push(String(k)); };
    },
    set() { return true; }
  });
  let threw = null;
  try { SR.mm.paint(fake, geom(doc, { measure: (s, fs) => String(s).length * 7 }), 1); }
  catch (e) { threw = e.message; }
  ok(!threw, 'paint 不炸', threw);
  ok(calls.filter(c => c === 'fillText').length > 5, '真画了字（fillText ' +
     calls.filter(c => c === 'fillText').length + ' 次）');
  ok(calls.includes('strokeRect'), '画了框');
  ok(calls.includes('stroke'), '画了线');

  const calls2 = [];
  const fake2 = new Proxy({}, { get(_, k) {
    if (k === 'measureText') return s => ({ width: String(s).length * 7 });
    return (...a) => { calls2.push(String(k)); };
  }, set() { return true; } });
  SR.mm.paint(fake2, geom({ topic: '', routes: [], chosen: '', steps: [] }, {}), 1);
  ok(calls2.filter(c => c === 'fillText').length === 1, '空场上写一句提示（就 1 行字）');
}

// ============================================================
//  尺子自检：故意喂一份**摆错了**的版面，看上面那些"该报的"报不报。
//  ★ 不先跑红，就不知道它会不会报——绿只说明"它没说话"，不说明"东西是对的"。
// ============================================================
head('九、尺子自检（先跑红）');
{
  const L = geom(doc, {});
  L.nodes[1].x = L.nodes[0].x; L.nodes[1].y = L.nodes[0].y;   // 硬把第 2 个框压到第 1 个上
  let caught = false;
  allPairs(L.nodes, (a, b) => { if (overlap(a, b)) caught = true; });
  ok(caught, '把两个框叠在一起 → overlap 判得出来');

  const L2 = geom(doc, {});
  L2.edges[0].x1 += 999;                                        // 把一条线的起点扔到画面外
  let caught2 = false;
  L2.edges.forEach(e => {
    if (!L2.nodes.find(x => onBorder(x, e.x1, e.y1))) caught2 = true;
  });
  ok(caught2, '把线的端点扔到画面外 → "落在框边上"判得出来');

  ok(SR.mm.latexToText('\\frac{1}{2}') !== SR.mm.latexToText('\\frac{1}{3}'),
     'latexToText 不是个恒等函数（真在算，不是把输入原样吐回来）');

  const e1 = SR.mm.layout({ topic: 'a', routes: [], chosen: '', steps: [] }, {}).w;
  const e2 = SR.mm.layout({ topic: 'a', routes: [], chosen: '', steps: [] }, {}).w;
  ok(e1 === e2, '同输入同输出（尺寸这个数定得住）');
}

console.log('\n' + (bad ? ('★★ ' + bad + ' / ' + n + ' 条没过') : ('全部 ' + n + ' 条通过。')));
console.log('⚠ 这把尺子只量几何。**导图好不好看、岔路那几条是不是真的不同错法、' +
            '画出来那句学生的话像不像孩子在说话**——这三条只有孔老师看得出来，尺子说不了。');
process.exit(bad ? 1 : 0);
