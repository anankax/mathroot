// 「开场之后，该不该自己换一件」（2026-10-07，整改③）——**确定性**那一半。
//
// ⚠ 跟 test/probe_route.cjs **不是一把尺子**：那一把量的是"这一轮挑了哪颗**模型**"，
//   跟工位没关系（名字撞车过一次，别混）。
//
// 量两种话，缺一条都不算数：
//   ① **该换的得换**：老师明说要那一件（打了名字，或者话头一边倒）。
//   ② ★★ **不该换的一个字都不许动**：他还在原来那件活儿上说话，只是句子里
//      捎带了一个别人的词（"这道题学生**作图**老错"是在说备课，不是要画图）。
//      ② 比 ① 重要得多：①漏了，老师再打一次名字就是了；②错了，
//      是把他手上正干着的活儿换掉、屏幕上那半截对话还重画一遍——
//      而**屏幕上看着完全正常**，他只会觉得"这破玩意儿偶尔抽风"。
//
// ★ 判据一行都不另抄：装的是 `js/landing.js` 原件，喂的是 `SR.landing.该换吗()`。
//   期望值里那几件工位的**名字**也是从 `SR.WORKS[x].label` 现取的——
//   改 config 里的名字，这份探针跟着走，不会变成"我抄的名字"。
//
// ★ 红验（先跑红，再信绿）：做一份**拿掉 ③ 那一句**的副本（就是
//   `if (旧 >= BAR) return null;` 那一行），指进来跑：
//     node -e "…split('if (旧 >= BAR) return null;').join('/*去掉*/')…" > test/_red/m_loose.js
//     PICKWORK_FILE=test/_red/m_loose.js node test/probe_pickwork.cjs
//   ★ 实测读数（2026-10-07，**别照着期待改**）：③ 那组 **20 条里红 2 条**，①②④⑤ 一条不动。
//     **不是整组红**——我一开始在注释里写的就是"整组红"，是假的，量完才发现。
//     原因：route() 认的是**分最高的那一件**，所以一句话里"现在这件"分高过别人时，
//     根本走不到 ③ 就早被 route 挡回去了。③ 真正吃得住的是**窄窄一条带**：
//     别人分够门槛、又甩开现在这件 4 分以上、而**现在这件自己也有 4 分以上**。
//     能落进这条带里的真话不多——**红的那 2 条就是全部**，它们才是这一组的力气所在。
//   这条红的位置和方法无关，量的是"③ 到底有没有在判"。
//
// 跑法：node test/probe_pickwork.cjs      （不开浏览器，不花额度）

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let 红 = 0, 绿 = 0;
function 判(what, cond, got) {
  if (cond) { 绿++; console.log('  ✓ ' + what); return true; }
  红++; console.log('  ✗ ' + what + '    ← 实际拿到：' + JSON.stringify(got));
  return false;
}

// ---- 假 DOM：跟 test/probe_landing.cjs 同一个装法（landing.js 顶上写着 `var SR = window.SR`）----
const W = { SR: {} };
const els = {};
function mkEl(id) {
  const e = {
    id, textContent: '', innerHTML: '', value: '', hidden: true, className: '',
    _cls: {}, _on: {},
    classList: {
      toggle(c, v) { e._cls[c] = v === undefined ? !e._cls[c] : !!v; },
      add(c) { e._cls[c] = true; }, remove(c) { e._cls[c] = false; }, contains(c) { return !!e._cls[c]; }
    },
    addEventListener(k, f) { (e._on[k] = e._on[k] || []).push(f); },
    focus() {}, dispatchEvent() { return true; },
    setAttribute(k, v) { e[k] = v; }, getAttribute(k) { return e[k] == null ? null : e[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  return e;
}
const FAKE_DOC = {
  body: { _a: {}, setAttribute(k, v) { this._a[k] = v; }, getAttribute(k) { return this._a[k]; }, removeAttribute(k) { delete this._a[k]; } },
  getElementById(id) { return els[id] || (els[id] = mkEl(id)); }
};
function load(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  new Function('window', 'document', 'location', 'localStorage', 'navigator', code)(
    W, FAKE_DOC, undefined, { getItem: () => null, setItem() {}, removeItem() {} }, undefined);
}
load('js/config.js');
// ★ 红验用：指一份**改坏**的 landing.js 进来（见文件末尾那条跑法）。
//   不指就是产品原件——平常跑的就是它。
load(process.env.PICKWORK_FILE || 'js/landing.js');

const S = W.SR;
const L = S.landing;
if (!L || typeof L.该换吗 !== 'function') {
  console.error('★ landing.js 里没有 `该换吗` —— 这一版没装整改③，读数作废。');
  process.exit(2);
}

// 工位名一律现取（改 config 里的 label，这份探针跟着走）
const N = {};
S.WORK_ORDER.forEach(w => { N[w] = (S.WORKS[w] && S.WORKS[w].label) || w; });
console.log('这一版装的是：' + S.WORK_ORDER.map(w => w + '=' + N[w]).join('　') + '\n');

// ---- 桩：只回答"现在是哪一件" ----
const chatStub = { _work: 'prep', getWork() { return this._work; } };
S.chat = chatStub;
function 问(现在, 话) {
  chatStub._work = 现在;
  var g = L.该换吗(话);
  var s = L.score(话);
  return { g: g, s: s, 明细: S.WORK_ORDER.map(w => N[w] + s[w]).join(' ') };
}
function 试(现在, 话, 该是) {
  var r = 问(现在, 话);
  var 得 = r.g ? r.g.work : null;
  return 判('（现在【' + N[现在] + '】）「' + 话 + '」→ ' + (该是 ? '换到【' + N[该是] + '】' : '不动'),
    得 === 该是, { 得: 得, 为什么: r.g && r.g.why, 分数: r.明细 });
}

console.log('\n【① 该换的得换 —— 老师白纸黑字打了那一件的名字（触发词）】');
试('prep', '帮我作图，画一个三角形ABC', 'draw');
试('prep', '组卷：第五周 一元一次方程 周练卷', 'material');
试('draw', '这道题的答案我讲评一下', 'review');
试('grade', '换成命题，再出几个变式', 'vary');
试('prep', '学情', 'grade');
试('review', '备课：明天讲 3.1 字母表示数', 'prep');
// ★ 一件都认不出来的词，光打名字也得进得去（同首屏那条：名字进不去＝永远点不到）
S.WORK_ORDER.forEach(function (w) {
  var 别 = S.WORK_ORDER.filter(function (x) { return x !== w; })[0];
  var r = 问(别, N[w]);
  判('光打名字「' + N[w] + '」（现在在【' + N[别] + '】）也认得出', r.g && r.g.work === w,
    { 得: r.g && r.g.work, 分数: r.明细 });
});

console.log('\n【② 话头一边倒（没打名字）也得换】');
试('prep', '把这张卷子讲评一下', 'review');
试('draw', '再出几道变式题', 'vary');
试('prep', '这周要出一份周练卷', 'material');
试('review', '两个班的分都出来了，排一排先讲哪几道', 'grade');

console.log('\n【③ ★★ 不该换的一个字都不许动 —— 在原来那件活儿上说话，捎带了别人的词】');
试('prep', '学生怎么答这道题，你摆给我看', null);
试('prep', '接着往下', null);
试('prep', '这一节的重难点在哪', null);
试('prep', '这句我说不出口，换一句', null);
试('prep', '这道题学生作图老是错，怎么讲', null);          // 「作图」出现了，但这是备课的活
试('review', '这道题我讲评的时候要不要画个图', null);       // 「画个」出现了，但这是讲评的活
试('draw', '这个三角形画错了，重画一遍', null);
试('grade', '得分率从低到高排一排', null);
试('vary', '这道变式太难了，换个数', null);
试('material', '这份卷子的分值再调一下', null);
试('prep', '这段板书怎么设计', null);
试('prep', '你好', null);                                  // 打招呼——首屏那条底线在这儿也成立
试('prep', '在吗', null);
试('prep', '嗯', null);
试('prep', '再讲一遍', null);
// ★★ 下面这几条才是**真正在量门槛**的：别人的分**已经够着 BAR 了**，
//   唯一拦住它的就是"没甩开现在这件 4 分以上"（上面那些条别人本来就够不着，
//   把门槛整段拿掉它们照样不动——那等于没量到）。
//   ★ 红验实测（拿掉 ③ 的副本上）：这一小撮里**只有前两条翻**。
//     翻不了的那几条由 ② 拦着（新不够或没甩开），不是在量 ③——**别把它们记成 ③ 的功劳**。
试('grade', '这题得分率低，讲评的时候重点讲这道', null);   // 学情4 / 讲评8 —— 够门槛也甩开了，只剩 ③ 能拦 → ★红验会翻
试('grade', '得分率统计好了，讲评重点讲哪几道', null);     // 学情4 / 讲评8 —— 同上 → ★红验会翻
试('review', '这次考试得分率很低', null);                  // 讲评7 / 学情4 —— 差 3，② 就拦住了
试('material', '这份周练卷里这类题学生总错，讲评要重点讲', null);  // 组卷4 / 讲评4 —— 咬平，② 拦住
试('draw', '画完了，这题变式再出几个', null);              // 作图2 / 命题4 —— 差 2，② 拦住
试('vary', '这几道变式里有个图画错了', null);              // 命题4 / 作图2 —— 差 2，② 拦住

console.log('\n【④ 认不出来的：现在是哪件就留在哪件，一个字不动】');
S.WORK_ORDER.forEach(function (w) { 试(w, '嗯嗯', null); });

console.log('\n【⑤ 已经在这一件上了，说它自己的名字 = 不动（别自己换给自己）】');
S.WORK_ORDER.forEach(function (w) { 试(w, N[w], null); });

console.log('\n══ ' + 绿 + ' 绿 / ' + 红 + ' 红 ══');
process.exit(红 ? 1 : 0);
