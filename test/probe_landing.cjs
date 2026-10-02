// 首屏（一个框 + 五块 + 归完那一行）——判两件事，各占一半：
//
//   一半是 **route()**：一句话进来，五件里认得出哪一件？
//     ★ 这一半的料全是从**产品自己的字**上抄的：chat.js 的 OPENING / TIP 那十句原文、
//       config.js 里那五个 label、还有几种"老师真会打"的形状。所以它验的不是
//       "我编的词表准不准"，而是**产品自己写在屏幕上的那些例子，进去之后回不回得来**。
//     ★★ 另一半同样重要，而且更容易被忽略：**对不上的时候它有没有硬塞一件**。
//       "判成 X"和"承认判不出来"在屏幕上是两种完全不同的东西，可在这份数据里
//       都只是 route().work ——空串（判不出来）要是悄悄变成某一件，
//       探针必须当场喊，而不是跟着绿过去。
//
//   另一半是 **intercept() 的放行约定**：
//     它回 true = 这一句我接走了 / 回 false = 放行，submit 照发。
//     ★ 这条约定写反了的话，屏幕上会出现**最像成功的一种坏**：那一行
//       "我按【备课】办的"照常出现，看着像已经办了，而老师那句话被吞了，
//       一个字都没发出去。所以这里有一条专门盯它的：
//         「归好类那一趟必须放行，而且放行的时候工位真的换了」。
//
// ★ 先跑红（跑法见文件末尾）：四种改法都得真红过，不然不知道它判得了什么。
//   2026-10-02 实测过一遍，红的就是该红的那几条、也只有那几条：
//     ① route() 咬得紧时随手挑头名（不再回空）→ ② 的那条红
//     ② intercept() 归得出来那趟回 true（吞掉那句话）→ ⑤ 的那条红
//     ③ 把 ['命题',4] 从词表里拿掉 → ④ 的两条红
//     ④ rework 不再把原话带过去 → ⑥⑧ 里"同一句话重发"那两条红
//   造这几份改坏的副本用 _red/mk.cjs（一次造四份，都是**只改一处**）。
//
// 跑法：node test/probe_landing.cjs
//       node _red/mk.cjs && LANDING_FILE=_red/m_swallow.js node test/probe_landing.cjs  （红验用；
//       ★ 别写 /tmp —— 这是 Windows，node 会把 /tmp 当 C:\tmp，直接 ENOENT）

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LANDING_FILE = process.env.LANDING_FILE || path.join(ROOT, 'js', 'landing.js');

let bad = 0, ran = 0;
function judge(what, cond, got) {
  ran++;
  if (cond) { console.log('  ✓ ' + what); return true; }
  bad++;
  console.log('  ✗ ' + what + '    ← 实际拿到：' + JSON.stringify(got));
  return false;
}

// ============================================================
//  一、把产品那两个文件原样装进来
// ============================================================
// ★ 跟 test/probe_flow.cjs 同一个装法：那两份文件顶上写的都是 `var SR = window.SR`，
//   node 里没有 window，得替它造一个。**不 require、不翻译、不改一个字**——
//   验的就是浏览器里跑的那一份。
//
// ★★ 顶上那句注释是**真的**，不是客气话：这份探针第一版是拿"我另抄一份词表"
//   去比的，那等于在验"我抄得对不对"。现在全部改掉——load 进来的是产品本身，
//   判据的**期望值**也从产品自己的常量里现取（见下面第 ① 组）。
//
// 假 DOM：只做到 landing.js 真正用到的那几样。不引 jsdom。
//   ⚠ 它**不是**一个浏览器。它只回答一个问题："这份代码有没有按约定跟外面说话"。
//     首屏画出来好不好看、五块排不排得下，那是浏览器那一趟的事（人看）。
const W = { SR: {} };
const els = {};
function mkEl(id) {
  const e = {
    id,
    textContent: '', innerHTML: '', value: '', hidden: true, className: '',
    _cls: {}, _on: {},
    classList: {
      toggle(c, v) { e._cls[c] = v === undefined ? !e._cls[c] : !!v; },
      add(c) { e._cls[c] = true; },
      remove(c) { e._cls[c] = false; },
      contains(c) { return !!e._cls[c]; }
    },
    addEventListener(k, f) { (e._on[k] = e._on[k] || []).push(f); },
    focus() {}, dispatchEvent() { return true; },
    setAttribute(k, v) { e[k] = v; },
    getAttribute(k) { return e[k] == null ? null : e[k]; },
    querySelector() { return null; },
    // 五块、还有"换一件"展开的那五颗小按钮，都是从 innerHTML 里现画出来的，
    // 所以要从那段 html 上把 data-work 读回来——
    // ★ 不能在这儿"假装有五个"，那样 focusBlock 点错灯也看不出来。
    //
    // ★★ 还有一件真 DOM 才有的事：**同一个元素，问两次得是同一个人**。
    //   strip() 是这么写的：自己 querySelectorAll('.rmini') 拿到一批、往上面挂监听；
    //   探针想点某颗，也得问到**那一批里的同一个对象**。第一版每次都现造新对象，
    //   于是监听挂在一批上、我点的是另一批，`target._on.click` 直接 undefined。
    //   （真实浏览器里当然不会这样——那正是假 DOM 要替真的那一部分。）
    //   所以按「选择器 + 当时那段 html + data-work」缓存；innerHTML 一换，键就变了，
    //   自然拿到新的一批，不会点着上一屏的旧按钮。
    querySelectorAll(sel) {
      if (typeof sel !== 'string' || sel.charAt(0) !== '.') return [];
      const html = String(e.innerHTML);
      if (e._qsaHtml !== html) { e._qsa = {}; e._qsaHtml = html; }
      const cache = (e._qsa = e._qsa || {});
      return (html.match(/data-work="[^"]+"/g) || []).map(function (m) {
        const w = m.slice(11, -1);
        const key = sel + '|' + w;
        if (!cache[key]) {
          const b = mkEl(sel.slice(1) + ':' + w);
          b['data-work'] = w;
          cache[key] = b;
        }
        return cache[key];
      });
    },
    fire(k, ev) { (e._on[k] || []).forEach(function (f) { f(ev || {}); }); }
  };
  return e;
}
const FAKE_DOC = {
  body: { _a: {}, setAttribute(k, v) { this._a[k] = v; }, getAttribute(k) { return this._a[k]; }, removeAttribute(k) { delete this._a[k]; } },
  getElementById(id) { return els[id] || (els[id] = mkEl(id)); }
};
function load(rel, src) {
  const code = src != null ? src : fs.readFileSync(path.join(ROOT, rel), 'utf8');
  new Function('window', 'document', 'location', 'localStorage', 'navigator', code)(
    W, FAKE_DOC, undefined, { getItem: () => null, setItem() {}, removeItem() {} }, undefined);
}
load('js/config.js');
const LANDING_SRC = fs.readFileSync(LANDING_FILE, 'utf8');
load(path.basename(LANDING_FILE), LANDING_SRC);

const S = W.SR;
let L = S.landing;

// ============================================================
//  二、桩：chat / main / files 那一圈
// ============================================================
// ★ 这些桩记的是"landing 有没有按约定跟它们说话"，不模仿它们的行为。
const calls = { applyWork: [], submit: [], needKey: 0 };
const chatStub = {
  _work: 'material', _user: false, _parts: false,
  getWork() { return this._work; },
  setWork(w) { this._work = w; },
  hasUser() { return this._user; },
  hasPendingImage() { return this._parts; },
  submit(t) { calls.submit.push(t); },
  __parts() { return []; }
};
S.chat = chatStub;
S.main = { applyWork(w) { calls.applyWork.push(w); chatStub.setWork(w); }, needKey() { calls.needKey++; } };

function reset(text, opt) {
  opt = opt || {};
  els['input'] = els['input'] || mkEl('input');
  els['input'].value = text == null ? '' : text;
  chatStub._work = opt.work || 'material';
  chatStub._user = !!opt.hasUser;
  chatStub._parts = !!opt.parts;
  calls.applyWork.length = 0; calls.submit.length = 0; calls.needKey = 0;
  L.show();
}

// ★ init() 必须在桩接好**之后**叫：它里面要问 SR.chat.getWork()（"上次用的哪一件"）。
//   ⚠ 第一版漏了这一句，于是 els.bar 一直是 undefined——那一行的 strip() 有个
//     `if (!bar) return;` 挡着，**不报错、也不写**，看着像"没做"，其实是我没让它上电。
//     最后是去读 els['routebar'].innerHTML 才崩出来。
L.init();

// ★★ 重装一份干净的 landing。为什么要这么干：
//   `picked`（"他自己点过工位了"）一旦立起来就**不再落**——那是产品**故意**的
//   （底线③：点过一次就别再拦第二回）。可探针是一口气跑完七八个场景的：
//   ⑤ 里那条"归得出来就放行"走的就是 pick()，picked 当场立起来，
//   于是 ⑥⑦⑧ 全在"已经点过工位"的状态下跑，intercept() 一律回 false——
//   屏幕上一片红看着像产品坏了，其实是**我把场景串了**。
//   真浏览器里一个页面只开一屏，遇不上；探针要连着跑，就得每次重装一份。
//   ⚠ 顺手把监听清掉：init() 会往 els.blocks / els.newbtn 上挂委托，
//     不清的话第二次 init 就是两颗监听，点一下办两遍。
function reload() {
  for (const id of Object.keys(els)) if (els[id] && els[id]._on) els[id]._on = {};
  load(path.basename(LANDING_FILE), LANDING_SRC);
  L = S.landing;
  L.init();
}

// ============================================================
//  三、① route()：产品自己写的那几句例子，回不回得来
// ============================================================
// ★ 期望值从**产品自己的常量**里现取（SR.WORKS 的 label），不写死中文名——
//   哪天改了 label，这一组跟着走，不会因为"名字换了"整片变红。
const LABEL = {};
for (const w of S.WORK_ORDER) LABEL[w] = (S.WORKS[w] && S.WORKS[w].label) || w;
const labelOf = (id) => LABEL[id];
function R(t) { return L.route(t); }

console.log('首屏这一份：' + LANDING_FILE);
console.log('');
console.log('① 产品自己写在屏幕上的那些例子');

// 这几句是 chat.js 的 OPENING / TIP **原文**（一字不改抄下来的）。
// ★ 为什么要拿原文：那些例子是老师第一眼会照着打的字。它们要是回不来，
//   首屏就成了"进门先被问一句'你这话是什么意思'"。
const 真题 = [
  ['第五周 一元一次方程 周练卷', 'material'],
  ['数轴上表示 -2 和 3', 'draw'],
  ['3.1 代数式的值', 'prep'],
  ['把卷子发过来，拍照、PDF、Word 都行，一次可以发好几张', 'review'],
  ['给我一道题或者一个课题，我把学生怎么答摆给你看', 'prep'],
  ['把题目发过来，我给你出几个变式', 'vary'],
  ['告诉我你想画什么，画一个数轴', 'draw'],
  ['这节课怎么讲', 'prep'],
  ['讲评一下这次考试', 'review']
];
for (const [t, want] of 真题) {
  const r = R(t);
  judge('「' + t + '」→ ' + labelOf(want), r.work === want, { got: r.work, why: r.why, score: r.score });
}

console.log('');
console.log('② 认不出来的时候，得说认不出来（不许硬塞一件）');
// ★★ 这一组是整份探针里最要紧的几条。上面那组全绿只说明"常见的话认得出来"；
//   这几条才说明"不认识的话**不会**被假装认识"。
const 该问的 = [
  ['你好'],
  ['在吗'],
  ['谢谢'],
  ['把卷子发过来'],                       // 组卷/讲评两边都像 → 该问（见词表里那三条 2 分）
  ['一元一次方程'],                       // 光一个课题名，没有章节号 → 该问
  ['第五周']                              // 光一个时段 → 该问
];
for (const [t] of 该问的) {
  const r = R(t);
  judge('「' + t + '」不当场归类，交给老师点', r.work === '' && r.why !== 'ambiguous', { got: r.work, why: r.why, score: r.score });
}
// ★ 这条是 landing.js 里**故意砍掉**的第三条形状规则（bareName：一个短名字、
//   什么动词都没有就当课题）留下的哨兵——砍它的原因写在那边，这儿盯着它别回来。
//   规则要是回来了，下面这句会变成"备课"，而它会**当场发出去**当一条正式提问。
judge('★「你好」不许被当成课题归到备课（否则一句招呼就会当场发出去）',
  R('你好').work !== 'prep', { got: R('你好').work });
// 咬得紧那一档：**要能认出"两件都像"**，那跟"对不上"不是一回事，屏幕上的话也不一样。
// ★ 这儿判的是**头两名就是那两件**（集合），不判谁先谁后——
//   同分时谁排在前面由 rankedOf 里那条显式次序（照 SR.WORK_ORDER）定，
//   material 在 review 前面、就这么定的，不是"撞出来的"。改成判先后的话，
//   哪天有人调了 WORK_ORDER 的顺序，这条会红，可红的**不是**它要守的那件事。
{
  const t = '把这次的周练卷发过来讲评一下';
  const r = R(t);
  const duo = [r.ranked[0], r.ranked[1]].sort().join(',');
  judge('「' + t + '」认出"两件都像"，而且头两名就是那两件（组卷 + 讲评）',
    r.work === '' && r.why === 'ambiguous' && duo === ['material', 'review'].sort().join(','),
    { got: r.work, why: r.why, ranked: r.ranked.slice(0, 3), score: r.score });
}

console.log('');
console.log('③ 形状判据（没有话头，靠"长得像什么"认）');
{
  const a = R('如图，在△ABC中，已知∠A=60°，求∠B的度数');
  judge('贴一整道题 → 备课（低把握，屏幕上会说"照像一道题认的"）',
    a.work === 'prep' && a.sure === 0 && a.why === '像一道题', { got: a.work, sure: a.sure, why: a.why });
  const b = R('七上 2.4');
  judge('带章节号/册名的短句 → 备课（低把握）', b.work === 'prep' && b.sure === 0, { got: b.work, sure: b.sure, why: b.why });
  // ★ 反过来：有明确话头时，形状**不许**夺权。
  const c = R('如图，已知∠A=60°，帮我把这道题变一下');
  judge('像题、又有"变一下" → 听话头的（命题），不让"像题"抢走',
    c.work === 'vary' && c.sure === 1, { got: c.work, sure: c.sure, why: c.why });
  // ★ 「期末」是时段名不是工件名（词表里那条 2 分的注释就是为这句写的）
  const d = R('期末复习课怎么上');
  judge('「期末复习课怎么上」→ 备课，不被"期末"拽去组卷', d.work === 'prep', { got: d.work, why: d.why, score: d.score });
  // ★ 光一个课题名**故意**不归类（词表旁边那段注释说的就是这条的代价）
  const e = R('勾股定理');
  judge('「勾股定理」不当场归类（这条是故意的：宁可问一句，也不把打招呼当课题发出去）',
    e.work === '', { got: e.work, why: e.why });
}

console.log('');
console.log('④ 词表本身的形状（改表改坏了这儿会先说）');
{
  let empty = [], noLabel = [];
  for (const w of S.WORK_ORDER) {
    if (!S.WORKS[w]) empty.push(w);
    else if (!S.WORKS[w].label) noLabel.push(w);
  }
  judge('SR.WORK_ORDER 里每一件都在 SR.WORKS 里有正身', empty.length === 0, empty);
  judge('每一件都有 label（五块上的名字就是它，见 landing.js paintBlocks）', noLabel.length === 0, noLabel);
  // ★ "五块"这个数不是抄来的，是照着 SR.WORK_ORDER 数出来的
  judge('首屏那五块正好是 SR.WORK_ORDER 那五件（一块不多一块不少）',
    L.BLOCKS().join(',') === S.WORK_ORDER.join(','), { got: L.BLOCKS(), want: S.WORK_ORDER });
  // 每一件都得有自己的话头，否则那一件在首屏上永远进不去
  const dead = S.WORK_ORDER.filter(function (w) {
    // 拿一个只属于它的词去试：把它自己的 label 当成一句话打进去
    const r = L.route(labelOf(w));
    return r.work !== w;
  });
  judge('五件的名字打进去都回得来（有哪一件进不去，说明它的话头被别的件抢了）', dead.length === 0, dead);
  // 反过来的那条：一个工位的名字不许被算到**别的**工位头上。
  // ★★ 这条是这一组里唯一抓到过**真东西**的：跑第一遍时它报「命题 → 组卷」，
  //   而组卷那边一分都不该有（'命题'两个字里没有任何一条组卷的词）——
  //   于是它把"一个字都没撞上"报成了"被人抢了"。两个都是红的，可红的意思不一样：
  //   前者是"这一件在首屏上永远进不去"（真缺口，当天就补了 ['命题',4]），
  //   后者才是"被抢"。所以下面把两种情况分开报，看着才知道该改哪。
  const stolen = [];
  for (const w of S.WORK_ORDER) {
    const sc = L.score(labelOf(w));
    const mx = Math.max.apply(null, S.WORK_ORDER.map(x => sc[x]));
    if (mx === 0) { stolen.push(labelOf(w) + ' →（一个字都没撞上：这一件在首屏上永远进不去）'); continue; }
    const top = S.WORK_ORDER.slice().sort((a, b) => (sc[b] - sc[a]) || (S.WORK_ORDER.indexOf(a) - S.WORK_ORDER.indexOf(b)))[0];
    if (top !== w) stolen.push(labelOf(w) + ' → 被算到' + labelOf(top) + '头上');
  }
  judge('五件的名字各自归各自（没被算到别人头上、也没有哪一件一个字都不认）', stolen.length === 0, stolen);
}

// ============================================================
//  四、⑤ intercept() 的放行约定
// ============================================================
console.log('');
console.log('⑤ 归好类那一趟：放行，而且工位真的换了');
{
  reset('出一份周练卷');
  const took = L.intercept();
  judge('★ 归得出来时必须放行（回 false）——回 true 就是把老师那句话吞了',
    took === false, { got: took });
  judge('放行之前工位已经换好了', calls.applyWork.join(',') === 'material', { got: calls.applyWork });
  // ★★ 这条第一版写错了，写错的方向值得留一笔：我原来判的是"submit 收到那句话"。
  //   可**归得出来这一趟，landing 自己从来不调 submit**——它回 false，是 chat.js
  //   接着把这句话发出去的（那正是"放行"的全部意思）。所以拿 calls.submit 去判，
  //   判的其实是"landing 有没有越权自己发一遍"，跟我要守的那件事正好相反。
  //   在 node 里我够不着 chat.js，能判的只有两件：①它回的是 false；②**框里那句话没被动过**
  //   （chat.js 下一步就是去读这个框）。"真发出去了没有"是浏览器那一趟的事。
  judge('landing 自己没偷偷再发一遍（放行 = 交给 chat.js 去发）', calls.submit.length === 0, { got: calls.submit });
  judge('★ 框里那句话原封不动（chat.js 接着读的就是它，读到什么就发什么）',
    els['input'].value === '出一份周练卷', { got: els['input'].value });
  judge('那一行"我按【X】办的"写上了，而且写的是这一件的名字',
    String(els['routebar'].innerHTML).indexOf(labelOf('material')) >= 0 && els['routebar'].hidden === false,
    { html: els['routebar'].innerHTML, hidden: els['routebar'].hidden });
  judge('首屏让开了（这一栏要开始说正事了）',
    FAKE_DOC.body.getAttribute('data-landing') === undefined, { got: FAKE_DOC.body.getAttribute('data-landing') });
}

console.log('');
console.log('⑥ 对不上的时候：接走这一句，别发，也别乱换工位');
reload();                              // ⑤ 把 picked 立起来了，这儿要一块干净的首屏
{
  reset('你好');
  const took = L.intercept();
  judge('★ 对不上时回 true（这一句我接走了，不许发出去）', took === true, { got: took });
  judge('没动工位（工位是老师自己点才换的）', calls.applyWork.length === 0, { got: calls.applyWork });
  judge('没发出去', calls.submit.length === 0, { got: calls.submit });
  judge('屏幕上说了"不像五件里的哪一件"', String(els['lq'].textContent).indexOf('不像') >= 0, { got: els['lq'].textContent });

  // 点一块 = 用刚才那句话办（这就是"一下就能改"）
  const block = els['lblocks'].querySelectorAll('.lblock').find(b => b.getAttribute('data-work') === 'prep');
  els['lblocks'].fire('click', { target: { closest: () => block } });
  judge('点「备课」之后：工位换到备课，而且用的是**刚才那句话**',
    calls.applyWork.join(',') === 'prep' && calls.submit.length === 1 && calls.submit[0] === '你好',
    { work: calls.applyWork, sent: calls.submit });
}

console.log('');
console.log('⑦ 只发了附件、一个字没打：不猜');
reload();
{
  reset('', { parts: true });
  const took = L.intercept();
  judge('接走（回 true），不硬猜一件', took === true, { got: took });
  judge('工位一个都没动', calls.applyWork.length === 0, { got: calls.applyWork });
  judge('屏幕上请他自己点', String(els['lq'].textContent).indexOf('不像') >= 0, { got: els['lq'].textContent });
}

console.log('');
console.log('⑧ 归完那一行上的「换一件」');
reload();
{
  reset('换个数再出几道');            // → 命题
  L.intercept();
  const chg = els['routechg'];
  judge('有一行字、有一个「换一件」', !!chg, { got: els['routebar'].innerHTML });
  chg.fire('click', {});               // 展开五颗小按钮
  const minis = els['routepick'].querySelectorAll('.rmini');
  judge('展开之后是五颗（照 SR.WORK_ORDER 数的）', minis.length === S.WORK_ORDER.length, { got: minis.length });
  // 点「备课」：换一件重办，用的是同一句话
  calls.submit.length = 0; calls.applyWork.length = 0;
  const target = minis.find(b => b.getAttribute('data-work') === 'prep');
  target._on.click[0]();
  judge('换成备课：工位换过去，而**同一句话**重发一遍',
    calls.applyWork.join(',') === 'prep' && calls.submit.length === 1 && calls.submit[0] === '换个数再出几道',
    { work: calls.applyWork, sent: calls.submit });
}

// ============================================================
//  五、⑨ 什么时候**不**该拦 —— ★ 这一组必须放最后
// ============================================================
// ★★ 为什么整组挪到最后：里面那条 `L.pick()` 会把 `picked` 立起来，而 `picked`
//   是**模块级的、一旦立起来就不再落**（真实浏览器里也是这样，切工位不清它）。
//   原本它排在中间，后面的 ⑦⑧ 就全在"已经点过工位"的状态下跑，
//   而那种状态下 intercept() 一律回 false —— 探针会一片绿，**却是绿在错误的前提上**。
//   （第一版就是这么排的，只是前面先崩了没跑到，没暴露出来。）
console.log('');
console.log('⑨ 什么时候不该拦');
reload();
{
  // ① 这一场已经说过话了：那是"接着往下"的话，不是"我要办哪一件"
  reset('出一份周练卷', { hasUser: true });
  judge('这一场已经说过话了 → 第二句不拦（那是"接着往下"这类话）',
    L.intercept() === false && calls.applyWork.length === 0, { got: calls.applyWork });

  // ② 他自己点过工位：之后一律不拦。
  //    ⚠ 这儿必须再调一次 L.show()：`pick()` 会把首屏**收起来**（hide）。
  //      不 show 的话 blocking() 因为 `!live` 就是 false，这条会绿——但绿的是
  //      "首屏收起来了"，不是"他点过工位了"。两件事得分开。
  reset('出一份周练卷');
  L.pick('draw');
  L.show();
  // ⚠ 清一下记录本：`pick()` 自己那一下**本来就会**调 applyWork('draw')——那是它该干的。
  //   不清的话下面那条会拿到 ['draw']，看着像"intercept 又归了一次类"，其实是上面那句留下的。
  //   （又是同一个形状：探针把**自己刚才那步**的动静算到了被测的那步头上。）
  calls.applyWork.length = 0;
  judge('他自己点过工位（首屏重新亮着也不拦）→ blocking() 为假',
    L.blocking() === false && L.intercept() === false, { got: L.blocking() });
  judge('  而且这一句没被归类、也没被吞（回 false = 照发）', calls.applyWork.length === 0, { got: calls.applyWork });
}

console.log('');
console.log(bad ? '★ 红的 ' + bad + ' 条 / 共 ' + ran + ' 条' : '全绿：' + ran + ' 条，红的 0 条');
process.exit(bad ? 1 : 0);
