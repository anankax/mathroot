// 「出材料」的配图：**模型说这儿要一张图，画板画出来，图归位到那一行上。**
//
// 分工（跟其它地方一样，谁也不越界）：
//   模型   → 只说"这儿要一张什么样的图"，用画图那套中文命令写一行 `#6 [图] 数轴; A=(-2,0)`
//   前端   → 把命令交给画板画、导出 PNG、裁边、量尺寸（本文件 + board.js）
//   produce→ 把这几个字节包成 Word 里的 wp:inline 图（js/produce.js）
//
// ★ 为什么要缓存（`cache` 那一层）：
//   `SR.material.feed` 在**流式过程中会被反复调用**（每收到一截正文就重画一次右栏），
//   而画一张图要几秒钟、还要等 550ms 一条的命令排完。要是每次重画都去画一遍，
//   一份卷子会把画板刷几十遍，老师看着画板抽风，卷子半天出不来。
//   所以：**命令原文当键，画一次存一次，重画只查表。**
//   这也让 feed 可以保持"纯函数"那条规矩（不弹窗、不写库、不滚动）。
//
// ★ 一张图都没画出来时**不许硬塞**：调用方（js/material.js）会把那一行撤掉并说明，
//   不能出现"卷子上写着'如图'、后面什么也没有"。
var SR = (window.SR = window.SR || {});

SR.figures = (function () {

  var cache = {};                 // 命令原文 → { url, w, h, png: Uint8Array }
  var busy = false;

  function key(cmds) {
    // 空白和换行不算数：同一张图，模型今天写一个空格、明天写两个，
    // 不该被当成两张图重画一遍。
    return String(cmds == null ? '' : cmds).replace(/\s+/g, ' ').trim();
  }

  // 模型写的一份命令 → 画板认的那几行。
  // ★ 开头固定补一条 `#清空`：一张图一块画板，上一张的残留绝不能串到这一张里。
  //
  // ★★ 分隔符**三种都收：换行、`;`、全角 `；`**。这一条是 2026-10-02 补的，
  //   不然打包出来的每一张图都是空的。原因：这个仓库里"一份命令"有**两种写法**，
  //   而它们各从一个地方来——
  //     · **多行**：模型写 ```ggb 围栏（js/render.js:34 的 body 原样收下，不碰换行），
  //       于是 `A=(-2,0)\nB=(3,0)\nSegment(A,B)` 是**一份**命令、三行；
  //     · **单行分号**：出材料的 `[图]` 标记（js/produce.js:259），一份命令挤在一行里。
  //   原来只切分号，那 pack.js 拿到多行那一份时**一行都没切开**，
  //   整块变成一个字符串送进 board.run → expand()（board.js:85 只认单条）
  //   → 一条带 \n 的 evalCommand。画板要么报错、要么只认头一行，
  //   而且**静默**：pack 那边只看到 shoot 出了张白图，照样收进包里。
  //   既然这个函数的身份是"一份命令 = 哪几行"（见下面导出处那段"两个真源"的说明），
  //   那两种写法就必须都在这儿收掉——不然它就不是那个真源。
  function linesOf(cmds) {
    return ['#清空'].concat(
      String(cmds || '').split(/[\n;；]/).map(function (s) { return s.trim(); }).filter(Boolean)
    );
  }

  function get(cmds) { return cache[key(cmds)] || null; }

  // 这一串段里，有几处要图、有几处已经画好了
  function stats(blocks) {
    var need = 0, ok = 0;
    (blocks || []).forEach(function (b) {
      if (!b || !b.fig) return;
      need++;
      if (get(b.fig)) ok++;
    });
    return { need: need, ok: ok };
  }

  // dataURL → 字节。★ 走 atob 而不是 fetch：dataURL 在 file:// 下 fetch 会被挡，
  //   而老师完全可能是双击 index.html 打开的（虽然推荐走 http）。
  function bytesOf(url) {
    var b64 = String(url).replace(/^data:[^,]*,/, '');
    if (typeof atob !== 'function') {                 // Node（跑测试的量具里没有 atob）
      return new Uint8Array(Buffer.from(b64, 'base64'));
    }
    var bin = atob(b64);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  // 把还没画的图挨张画出来。
  //   onOne(i, total, cmds, ok)   —— 每张画完喊一声，界面拿它报进度
  //   cb(结果)                    —— 全部跑完；{ 画好: n, 没画出来: n }
  // ★ 一张失败**不打断后面的**：第三张画不出来，第四张照样画。
  //   整份材料因为一张图全废，那是比少一张图更坏的坏法。
  function drawAll(blocks, onOne, cb) {
    var todo = [];
    (blocks || []).forEach(function (b) {
      if (!b || !b.fig) return;
      var k = key(b.fig);
      if (cache[k]) return;
      if (todo.indexOf(k) < 0) todo.push(k);
    });
    if (!todo.length) { cb({ ok: 0, bad: 0, total: 0 }); return; }
    if (!SR.board) { cb({ ok: 0, bad: todo.length, total: todo.length }); return; }

    busy = true;
    var i = 0, okN = 0, badN = 0;
    function step() {
      if (i >= todo.length) {
        busy = false;
        cb({ ok: okN, bad: badN, total: todo.length });
        return;
      }
      var k = todo[i], n = i + 1;
      SR.board.draw(linesOf(k), function (drawn) {
        if (!drawn) { badN++; if (onOne) onOne(n, todo.length, k, false); i++; step(); return; }
        SR.board.shoot(function (url, w, h) {
          if (url) {
            cache[k] = { url: url, w: w, h: h, png: bytesOf(url) };
            okN++;
            if (onOne) onOne(n, todo.length, k, true);
          } else {
            badN++;
            if (onOne) onOne(n, todo.length, k, false);
          }
          i++;
          step();
        });
      });
    }
    step();
  }

  return {
    key: key, get: get, stats: stats, drawAll: drawAll,
    // ★★ 2026-10-02 导出：打包（js/pack.js）也要"一张图 = 先清空 + 那几行命令"这条规矩。
    //   那边自己抄一份的话，「开头固定补 #清空」这件事就有两个真源——
    //   哪天发现还得再补一条（比如要画的图可能落在三维视角上，得先 `#平面`），
    //   只改了一处，另一种图上就会带着上一张的残留。
    linesOf: linesOf,
    // ★★ 同一个理由：dataURL → 字节也只有一份。
    //   ⚠ 打包那边拿到图之后要算 CRC，而 **CRC 必须算在字节上、不是 base64 文本上**——
    //     文本改一个字符（比如把 + 换成空格）字节其实没变，CRC 却会跟着变。
    //     所以那边宁可绕一趟这里，也不能自己去 atob。
    bytesOf: bytesOf,
    isBusy: function () { return busy; },
    // 测试用：清缓存（界面不调）
    __forget: function () { cache = {}; }
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.figures;
