// 「这一版的作图底座有多长」—— **从磁盘现算**，别在每把尺子里各写死一个数。
//
// ============================================================
// 为什么要有这么一个小东西（2026-10-06 夜）
// ============================================================
// 三把尺子（probe_draw_ui / probe_carrycard / probe_drawkb_live）里都有一格
// 「页面指纹」，判的是 `String(SR.PROMPT_DRAW).length === 19492` ——
// 那个数是**我写那把尺子那一天**量下来的，写死在了源码里。
// 它的用意是好的："证明页面上跑的是这一份，不是缓存里的旧版"。
//
// 坏在哪：`js/prompt-draw.js` 后来因为六件里别的那几件短了 130 个字
// （19492 → 19362），于是**三把尺子同时天天红着**。
// 而"红的样子"跟"页面装错了版本"**一模一样** —— 谁看见都得先怀疑产品。
// 这是记忆里那条 [[scanner-numbers-are-not-what-they-claim]]：
// **写死的件数在"加一件"那天报成"仪器不对"**；数字本身没错，错的是它量的那个东西
// （它量的是"我当天记得的那个数"，不是"页面上跑的是哪一版"）。
//
// 治法：两边都从**当下的磁盘**算。页面那份对不上磁盘 → 红，那才是真的"版本不对"。
// 想验它是不是还能红：把 `js/prompt-draw.js` 存一份、随便动一个字、再跑，
// 三把尺子都该红在那一条上。
//
// ⚠ 装法跟各把尺子里的假环境**同一套**（`window` / `localStorage` / `document`），
//   少一份装不上就是"静默跳过、读数照样绿"。
const path = require('path'), fs = require('fs');

function 磁盘底座长度() {
  const store = {};
  const LS = {
    getItem: function (k) { return (k in store) ? store[k] : null },
    setItem: function (k, v) { store[k] = String(v) },
    removeItem: function (k) { delete store[k] }
  };
  const W = { SR: {} };
  for (const f of ['config.js', 'prompt-draw.js']) {
    new Function('window', 'localStorage', 'document',
      'var SR = (window.SR = window.SR || {});\n'
      + fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'))(W, LS, {});
  }
  const n = String(W.SR.PROMPT_DRAW || '').length;
  if (!n) throw new Error('★ 装不上 js/prompt-draw.js 里的 SR.PROMPT_DRAW —— 这把基准尺子本身就坏了');
  return n;
}

module.exports = { 磁盘底座长度: 磁盘底座长度 };
