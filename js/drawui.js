// 作图模板的**面板**（界面那半）。算骨架那半在 js/drawtpl.js，两边故意分开：
// 骨架是纯函数，探针不用开浏览器就能量它（test/probe_drawtpl.cjs），
// 界面这一半只干"把格子摆出来、把值收回来"。
//
// ★★ 为什么面板上要**把命令原文摊开给老师看**（`.tplp-prev` 那一块）：
//   孔老师那句话——「**你也得检查你的命令**」。命令是我算的，那我就得让他看得见。
//   别处（模型生成的图）老师没有这个口子：他只看得见图，看不见那九行命令。
//   模板这一档他**看得见**，而且看得懂（"射线(O,A)"这种字他天天在课上写）。
//   图不对的时候，他能一眼指出是哪一行不对——这比"再问一遍"有用得多。
//
// ★★ 面板摆在**输入框上方**，不是浮层糊在对话上：
//   挪上来会把对话区顶高，老师填表的时候还能看见上一条回复。
//   浮层的话他就把正在看的图盖掉了——而他多半是**看着那张图**才想起要点模板的。
SR.DRAWUI = (function () {

  var 当前 = null;       // 现选中的模板 id
  var 表单值 = {};       // { 模板id: { 键: 值 } }  —— 换回来的时候上一格填的还在

  function $(id) { return document.getElementById(id) }

  function 值(id) {
    if (!表单值[id]) 表单值[id] = {};
    return 表单值[id];
  }

  // ---- 把一块模板的初始值铺出来 ----
  function 初值(tpl) {
    var v = 值(tpl.id);
    (tpl.字段 || []).forEach(function (x) {
      if (v[x.键] == null) v[x.键] = x.默认;
    });
    return v;
  }

  // ---- 左栏：分组 + 模板名 ----
  function 摆栏() {
    var rail = $('tplp-rail');
    rail.innerHTML = '';
    SR.DRAWT.组.forEach(function (g) {
      var h = document.createElement('div');
      h.className = 'tplp-g';
      h.textContent = g.名;
      rail.appendChild(h);
      g.项.forEach(function (tpl) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tplp-i';
        b.dataset.id = tpl.id;
        b.textContent = tpl.名;
        b.addEventListener('click', function () { 选(tpl.id) });
        rail.appendChild(b);
      });
    });
  }

  // ---- 右栏：这一块模板的格子 ----
  function 摆表(tpl) {
    var v = 初值(tpl);
    var box = $('tplp-fields');
    box.innerHTML = '';
    (tpl.字段 || []).forEach(function (x) {
      var row = document.createElement('label');
      row.className = 'tplp-row';
      var lb = document.createElement('span');
      lb.className = 'tplp-lb';
      lb.textContent = x.名;
      row.appendChild(lb);

      var el;
      if (x.类型 === '选') {
        el = document.createElement('select');
        (x.项 || []).forEach(function (o) {
          var op = document.createElement('option');
          op.value = o; op.textContent = o;
          el.appendChild(op);
        });
      } else {
        el = document.createElement('input');
        el.type = 'text';
        if (x.提示) el.placeholder = x.提示;
      }
      el.className = 'tplp-in';
      el.value = v[x.键] == null ? '' : v[x.键];
      el.addEventListener('input', function () { v[x.键] = el.value; 预报() });
      el.addEventListener('change', function () { v[x.键] = el.value; 预报() });
      row.appendChild(el);
      box.appendChild(row);
    });
  }

  // ---- 底下那条：即将发出去的骨架原文 + 那句话 ----
  // ★ 每次改动都重算一遍，「画」键按下去用的就是**屏幕上这一份**——
  //   不能让老师看见的和实际发出去的有一丁点不一样（那就是又一把骗人的尺子）。
  function 预报() {
    var p = $('tplp-prev'), go = $('tplp-go');
    if (!当前) { p.textContent = ''; go.disabled = true; return }
    var r = SR.DRAWT.拼(当前, 值(当前));
    if (!r || !r.骨架.length) { p.textContent = '（这块模板还拼不出东西）'; go.disabled = true; return }
    p.textContent = r.话 + '\n\n' + r.骨架.join('\n');
    go.disabled = false;
  }

  function 选(id) {
    当前 = id;
    var tpl = SR.DRAWT.找(id);
    if (!tpl) return;
    Array.prototype.forEach.call(document.querySelectorAll('.tplp-i'), function (b) {
      b.classList.toggle('on', b.dataset.id === id);
    });
    $('tplp-fname').textContent = tpl.名;
    $('tplp-desc').textContent = tpl.说明 || '';
    摆表(tpl);
    预报();
  }

  // ---- 开／关 ----
  function 开() {
    var box = $('tplp');
    box.hidden = false;
    var btn = $('drawtplbtn');
    if (btn) btn.setAttribute('aria-expanded', '1');
    // ★ 第一次打开才铺左栏（模板表是死的，铺一次就够）
    if (!$('tplp-rail').children.length) 摆栏();
    // 打开时默认选第一块 —— 空着比选错更让人愣住
    选(当前 || SR.DRAWT.组[0].项[0].id);
    var inp = document.querySelector('#tplp-fields .tplp-in');
    if (inp) inp.focus();
  }
  function 关() {
    $('tplp').hidden = true;
    var btn = $('drawtplbtn');
    if (btn) btn.setAttribute('aria-expanded', '0');
  }
  function 切() { 开着的() ? 关() : 开() }
  function 开着的() { return !$('tplp').hidden }

  function init() {
    var btn = $('drawtplbtn');
    if (btn) btn.addEventListener('click', 切);
    var x = $('tplp-x');
    if (x) x.addEventListener('click', 关);
    var go = $('tplp-go');
    if (go) go.addEventListener('click', function () {
      if (!当前) return;
      var r = SR.DRAWT.拼(当前, 值(当前));
      if (!r) return;
      // ★ 先关面板再发：面板占着地方，关掉之后老师立刻能看见自己那张图开始画。
      关();
      SR.DRAWT.画(当前, 值(当前));
    });
    // Esc 关掉（跟 Key 层、文件选择那些浮层一个规矩）
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && 开着的()) 关();
    });
  }

  return { init: init, 开: 开, 关: 关, 切: 切, 选: 选, 开着的: 开着的, 预报: 预报 };
})();
