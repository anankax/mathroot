/* 指针光照 —— 把鼠标位置写进元素上的 --mx / --my，CSS 那边拿它去画一团柔光。
 *
 * ★ 为什么单单挑这一件事做（而不是加一堆花哨的动画）：
 *   那篇《明日方舟》UI/UX 分析在第七节里，作者替方舟认了一个短板——
 *   原文："由于方舟是一款手游，因此交互上没有办法做指针悬停效果，在光线控制上
 *   除了用陀螺仪似乎没有太多的想象空间……期待以后有更多产品能够在 UI 层面
 *   就开始考虑 shading & lighting 这些原本在建模阶段才会考虑的元素。"
 *   **网页是有指针的。** 这一件是它做不到、我们做得到的，而且是那篇文章
 *   自己点着名说"以后应该有人做"的那一件。
 *
 * ★ 三条纪律，都吃过亏：
 *   ① 只用 CSS 变量，不建任何 DOM 节点。气泡的内容是 `innerHTML=` 直接换掉的
 *      （见 js/render.js:157），塞进去的元素每次重绘都会被抹掉。
 *   ② 元素盒子（rect）只在**指针换到另一个元素上**的时候量一次，不是每次
 *      pointermove 都量。getBoundingClientRect 会强制布局，一秒钟量六十次，
 *      低配机器上滚对话区就开始掉帧。滚动和缩放的时候才重新量。
 *   ③ 变量**只写当前这一个元素**，不往 document 上写。写在 document 上会让
 *      整页重算样式；而且--mx 是"相对这个元素"的坐标，全局一个值本来就是错的。
 *
 * ★ 没写进去过 --mx 的元素，CSS 里的默认值把光放在框子外面（-40%），
 *   所以"这段没跑"和"这一版没加光照"长得一模一样。JS 挂了不会留下怪东西。
 */
(function () {
  'use strict';

  // 给哪几种元素打光。★ 只给"面积够大、能看清光在动"的东西：
  //   两块大面板和弹层那块板，外加按钮。
  //   小图标、细条、状态栏不给——那么小一块，光一晃像个脏点。
  var SEL = '.col, .overlay .box, .tool, .chip';

  var reduce = false;
  try {
    reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (window.matchMedia) {
      window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function (e) {
        reduce = e.matches;
      });
    }
  } catch (e) { reduce = false; }

  var cur = null;      // 现在光标在哪个元素上
  var rect = null;     // 它的盒子（缓存）
  var queued = false;  // 这一帧排过队没有
  var px = 0, py = 0;  // 待写入的坐标

  function measure() {
    if (cur) rect = cur.getBoundingClientRect();
  }

  // 真的往元素上写。★ 放在 rAF 里，一帧最多写一次——
  // 指针设备一秒钟能发一百多个事件，每个都写一次是白烧电。
  function flush() {
    queued = false;
    if (!cur) return;
    if (!rect || !rect.width) return;
    cur.style.setProperty('--mx', (px - rect.left) + 'px');
    cur.style.setProperty('--my', (py - rect.top) + 'px');
  }

  function onMove(e) {
    px = e.clientX; py = e.clientY;
    var el = null;
    if (e.target && e.target.closest) el = e.target.closest(SEL);
    if (el !== cur) { cur = el; measure(); }
    if (!queued) { queued = true; requestAnimationFrame(flush); }
  }

  // 滚动 / 缩放之后盒子会变。★ 必须是 capture:true —— 滚的是里面的 #msgs，
  // 不是 document，不捕获的话这个监听收不到。
  function onChange() { measure(); }
  document.addEventListener('scroll', onChange, { passive: true, capture: true });
  window.addEventListener('resize', onChange);

  document.addEventListener('pointermove', function (e) {
    if (reduce) return;
    // 触摸屏上没有"指针"这回事：手指按住时发的是 touch，抬起来就没有了，
    // 光会僵在最后那一点上。所以触摸设备整条不跑。
    if (e.pointerType === 'touch') return;
    onMove(e);
  }, { passive: true });
})();
