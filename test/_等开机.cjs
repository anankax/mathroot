// 「页面开完机了吗」—— 硬重载之后必须等这一条，再去读第一个数。
//
// ============================================================
// 为什么非要有这么一个小东西（2026-10-06 夜）
// ============================================================
// 好几把尺子这里是同一个写法：
//     await 发('Page.reload', { ignoreCache: true });
//     await new Promise(r => setTimeout(r, 4000));      // 睡 4 秒
//     const 指纹 = await ev('JSON.stringify({ … SR.… })');   // 就读
// 「睡 4 秒就读」在**这台机器上的一次冷启动**根本不够。于是就炸成
//     ReferenceError: SR is not defined
// —— 而那个"炸"跟"产品坏了"长得**一模一样**：谁看见"SR is not defined"都得先怀疑
// js 没装上、是不是少传了一个文件。**实际上它只是读早了。**
//
// 这就是 [[scanner-numbers-are-not-what-they-claim]] 里那条
// 「**按秒表读状态会把『还没开机』读成『报错了』**」。
// 实测：probe_seeboard 挨着别把尺子跑时炸在这一句上（退出码 2、连汇总都没打），
// 单独给它一张干净页面、并且**真等到开机**之后，16 绿 / 0 红。
//
// ★ 更阴的是它**平时不炸**：页面是热的（刚跑过别的尺子）时，4 秒早够了，
//   于是这把尺子一路绿着 —— 等哪天它排在冷启动后面，才突然"坏"一次。
//   所以这一条不是"修个偶发"，是把一颗一直埋着的雷拆掉。
//
// ============================================================
// 判据怎么挑
// ============================================================
// 挑的都是**装完之后才会成立**的那几样，不是"元素在不在"：
//   · `SR` 已定义，且 `SR.api.ask` / `SR.WORKS` 是那副样子；
//   · 六个工位按钮齐了（`#works .workbtn`，少一个就是还没铺完）；
//   · 输入框在。
// ⚠ 判据里那句自己会抛（`SR` 还没定义时 `typeof SR` 是安全的，但 `SR.api` 不是）——
//   所以整句包在 try 里，抛了就当"还没好"，接着等。**不能**让它把探针炸掉：
//   那正是我们要躲开的那种假红。
// ⚠ 返回 `=== true` 才算好（[[scanner-numbers-are-not-what-they-claim]]：
//   「真值字符串当循环条件」那一条 —— `'THROW: …'` 是真值，会当场放行）。
//
// 用法：
//   const { 等开机 } = require(path.join(__dirname, '_等开机.cjs'));
//   const 开完了 = await 等开机(ev, '&& typeof SR.board.该看板 === "function"');
//
// 第二参数是**附加**判据（拼在 `&&` 后面），不给就用通用的那几条。
//
// ⚠ 还有两把尺子（probe_carrycard / probe_seeboard）里各有一份**自己写的**同样的闸，
//   是这两晚先后补上的、都已验证过绿。要合流就一起来，别只合一半 ——
//   但那两次改动都要重跑验证，先记在这儿，不为了整齐去动已经量绿的东西。
const 通用判据 = 'typeof SR !== "undefined" && SR.api && SR.WORKS && typeof SR.api.ask === "function"'
  + ' && document.querySelectorAll("#works .workbtn").length >= 6'
  + ' && !!document.getElementById("input")';

async function 等开机(ev, 附加) {
  const 式 = '(function(){ try { return !!(' + 通用判据 + (附加 ? ' ' + 附加 : '') + '); }'
    + ' catch(e){ return "THROW:" + e.message } })()';
  for (let i = 0; i < 40; i++) {                 // 最多 20 秒
    let v = null;
    try { v = await ev(式); } catch (e) { v = null; }   // 这句自己抛也当"还没好"
    if (v === true) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

module.exports = { 等开机: 等开机 };
