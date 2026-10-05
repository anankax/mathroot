// 绿行（`#onep`，「这一份」那一行）上的两颗按钮：**「选择内容」**和**「打包」**。
//
// 为什么搬到这儿（孔老师 2026-10-05 的原话）：
//   「打包按钮就应该放在这个绿行才对，放对话里面干什么，或者说，这里面放个
//     "选择会话内容"按钮，然后下面的对话框里需要保存的出现类似微信的勾选按钮。
//     然后看着打包」
//
// ★ 他说得对，而且不是"换个位置好看一点"这个层面上的对：
//   `js/pack.js` 顶上从第一版就写着它是**会话级**的（包里装的是从头到点击处为止
//   全部的图和全文），可那颗按钮一直挂在**每一条回复底下的 bar** 上，
//   跟真正"这一段"的「复制这段」并排摆着。位置在说"这是这一条的东西"，
//   注释在说"这是整场的东西"——两句话对不上，而老师只看位置。
//   ⇒ 搬上来之后两个刻度各归各位：**这一段 → 气泡底下那颗；这一份 → 绿行这颗**。
//
// ★ 顺带多出来的那一种打法（老师自己提的那个"或者说"）：绿行上多一颗「选择内容」，
//   进挑选模式之后每条回答左边长一个微信那样的圆圈，勾中的才进包。
//   ⇒ **勾的单位是"一问一答"**（孔老师当天定的）：勾一条回答，它上面那句问
//     会跟着一起进包。这么定是因为包里那份 .md 是要贴进教案的——
//     单拎一段答案出来，"这是在答什么"就丢了。
//
// ★★ 这个文件跟 js/pack.js 是**两层**，别搅在一起：
//   `pack.js` 管"打包要装哪些东西"（纯数据，node 里跑得动，探针直接量它）；
//   这儿只管"老师怎么点得到它"（DOM、勾选状态、状态栏）。
//   ⚠ 所以这个文件里**一条打包逻辑都不许写**——尤其别自己数一遍"勾了哪几条"。
//     那个数只有 `SR.pack.pick` 一份实现，两处各算一遍，早晚一处认"勾上的"、
//     另一处认"到这段为止"，而两份包看着都是完整的。
var SR = (window.SR = window.SR || {});

SR.packui = (function () {

  var els = { strip: null, pick: null, pack: null };

  var picking = false;   // 在挑选模式里吗
  var busy = false;      // 这一颗正在打包（几秒到几十秒），中途别让他点第二下
  var got = {};          // 勾上的：turn 序号 -> 1。★ 普通对象不是 ES6 Set：
                         //   这个文件跟全站一样是 ES5 写法，别在这儿开新口子。
  var lastStatus = '';   // 进挑选模式时把状态栏那句话记下来，退出时还回去

  function $(id) { return document.getElementById(id); }

  // 一屏上所有**能勾的**消息（带了 `data-turn` 的助手气泡）。
  // ★ 判据取 `[data-turn]`，**不取** `.msg.assistant`：开场白、首屏那句
  //   「告诉我你的问题」也是助手气泡，可它们**不在打包账本里**。
  //   拿类名当判据的话，开场白也会长出一个圆圈，勾上之后打进包的是**别的**内容
  //   ——包里东西看着都对，只是多了一段不该有的、或者少了那段该有的。
  function 可勾的() {
    var box = $('msgs'), out = [];
    if (!box) return out;
    var bu = box.querySelectorAll('.bubble[data-turn]');
    for (var i = 0; i < bu.length; i++) {
      var m = bu[i].parentNode;
      if (m && m.classList && m.classList.contains('msg')) out.push(m);
    }
    return out;
  }

  function 序号(msg) {
    var bu = msg.querySelector('.bubble[data-turn]');
    var n = bu ? Number(bu.getAttribute('data-turn')) : NaN;
    return (isFinite(n) && n >= 0) ? n : null;
  }

  // 这一条上面**最近的那句老师说的话**。
  // ★ 顺着 DOM 往前找，不看账本：账本里 `ask` 是重建时按记忆摊下来的，
  //   跟屏幕上摆着的那一句话可能有出入（比如记忆里那条 `r === 'u'` 的分界线
  //   变了）。屏幕上跟哪一句配对，就该高亮哪一句——**看得见的那句**才算数。
  function 上一条老师的(msg) {
    var p = msg.previousElementSibling;
    while (p) {
      if (p.classList && p.classList.contains('msg') && p.classList.contains('user')) return p;
      p = p.previousElementSibling;
    }
    return null;
  }

  // ---- 勾选框的增删 ----

  function 摆勾选框() {
    var ms = 可勾的();
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      var n = 序号(m);
      if (n == null) continue;
      m.setAttribute('data-pick', String(n));
      if (!m.querySelector(':scope > .pickbox')) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'pickbox';
        b.setAttribute('aria-label', '选中这条内容');
        m.insertBefore(b, m.firstChild);
      }
    }
    paint();
  }

  function 收勾选框() {
    var box = $('msgs');
    if (!box) return;
    var bs = box.querySelectorAll('.pickbox');
    for (var i = 0; i < bs.length; i++) if (bs[i].parentNode) bs[i].parentNode.removeChild(bs[i]);
    var ms = box.querySelectorAll('.msg');
    for (var j = 0; j < ms.length; j++) {
      ms[j].classList.remove('picked', 'pickedq');
      ms[j].removeAttribute('data-pick');
    }
  }

  // 把 `got` 刷到屏幕上：圆圈实心／空心，以及"这一条是跟着哪句问一起走的"。
  function paint() {
    var ms = 可勾的();
    // ★ 先全清，再按 `got` 重新点——不这么写就得维护一份"上次画过什么"，
    //   而那份状态多一个来源就多一处会漂。每屏几十个节点，全清不心疼。
    for (var i = 0; i < ms.length; i++) ms[i].classList.remove('picked');
    var qs = document.querySelectorAll('#msgs .msg.user.pickedq');
    for (var k = 0; k < qs.length; k++) qs[k].classList.remove('pickedq');

    var n = 0;
    for (var j = 0; j < ms.length; j++) {
      var num = 序号(ms[j]);
      if (num == null || !got[num]) continue;
      n++;
      ms[j].classList.add('picked');
      var q = 上一条老师的(ms[j]);
      if (q) q.classList.add('pickedq');   // 只是**标一下**"这句跟着走"，它本身不能勾
    }
    return n;
  }

  // 挑中的序号数组（升序由 SR.pack.pick 那边排，这儿不重排——
  // 两份都排一次不算错，但"谁排的"就成了两个答案的来源）。
  function 选中的() {
    var out = [];
    for (var k in got) if (Object.prototype.hasOwnProperty.call(got, k)) out.push(Number(k));
    return out;
  }

  // ---- 标签 ----

  function paintLabels() {
    if (!els.pack) return;
    var n = SR.pack ? SR.pack.count() : 0;
    var 勾 = 0;
    for (var k in got) if (Object.prototype.hasOwnProperty.call(got, k)) 勾++;
    // 空闲时按钮上写**账本里有多少条**（"这一份现在装着几节"），
    // 挑选模式里写**勾了几条**（"这一下会打几条走"）。
    // ★ 两个数不能都写、也不能都不写：老师正看着那个数字决定按不按。
    els.pack.textContent = picking ? ('打包 (' + 勾 + ')')
                                   : ('打包' + (n ? ' (' + n + ')' : ''));
    els.pack.disabled = busy || n === 0;
    els.pack.title = picking
      ? '只把勾上的那几条打进压缩包（每条回答会连它上面那句问一起走）'
      : '把这一份的图和全文打成一个压缩包（.zip）';
    if (els.pick) {
      els.pick.textContent = picking ? '取消选择' : '选择内容';
      els.pick.disabled = !n;
      els.pick.title = picking ? '退出挑选，整份打包' : '挑几条出来单独打包';
    }
  }

  // ---- 进 / 出挑选模式 ----

  function enter() {
    if (picking) return;
    picking = true;
    got = {};
    document.body.setAttribute('data-picking', '1');
    if (SR.chat) {
      lastStatus = SR.chat.getStatus ? SR.chat.getStatus() : '';
      SR.chat.setStatus('点左边那些圆圈，勾中的才会进包——勾一条回答，它上面那句问会跟着一起走。');
    }
    摆勾选框();
    paintLabels();
  }

  // ★ 只做**清场**，不碰标签、不碰状态栏。叫它的地方自己决定接下来是重画还是收工
  //   （`sync` 会在没内容可打时调它，那条路上标签要按"没东西"重画）。
  function drop() {
    picking = false;
    got = {};
    document.body.removeAttribute('data-picking');
    收勾选框();
  }

  function leave() {
    if (!picking) return;
    drop();
    if (SR.chat) SR.chat.setStatus(lastStatus || '');
    paintLabels();
  }

  // ---- 点一下圆圈 ----

  function toggle(msg) {
    var n = 序号(msg);
    if (n == null) return;
    if (got[n]) delete got[n]; else got[n] = 1;
    var c = paint();
    paintLabels();
    if (SR.chat) {
      SR.chat.setStatus(c ? ('挑了 ' + c + ' 条，可以按「打包」了。')
                          : '还没勾内容——点左边那些圆圈。');
    }
  }

  // ---- 打包那一下 ----
  //
  // ★ 这段是从 `js/chat.js` 原样搬过来的（那颗按钮原来长在气泡底下）。
  //   每一句状态、每一个延时都有它的来由，别顺手"简化"：
  //   · 失败 → 按钮立刻还给老师（他多半想再点一次）；
  //   · 成功 → 「打包好了」**一直按着**，直到那四个字收回去为止。不然那两秒里
  //     按钮看着能点，点下去又打一遍，他会以为刚才那次没成。
  //   · 少一张图必须**说出来**。悄悄给一个缺图的包，老师翻到那道题才发现，
  //     那时候他已经把包发给备课组了。（跟出材料那边"图没画出来要说明"同一条规矩。）
  //   · 「（含导图）」是给"数不上"准备的：老师数包里那几张题目图，会觉得跟话里的
  //     数对不上（差的那一张是思维导图）。不说明的话，他会以为包多装了什么。
  function run(sel) {
    if (busy || !SR.pack) return;
    busy = true;
    paintLabels();
    els.pack.textContent = '打包中…';
    SR.chat.setStatus('正在把这一课的图重新画一遍，收进压缩包…');
    SR.pack.make(sel, function (n, all) {
      if (all > 1) SR.chat.setStatus('正在收第 ' + n + ' 张图（一共 ' + all + ' 张）…');
    }, function (r) {
      busy = false;
      if (!r.ok) {
        paintLabels();                      // 按钮立刻还给老师（他多半想再点一次）
        SR.chat.setStatus(r.why);
        return;
      }
      SR.pack.save(r.name, r.bytes);
      // ★ 打完了就退出挑选模式：老师这一下要的是"拿走"，不是"接着挑"。
      //   留在里面的话，那些圆圈还挂在每一条旁边，看着像还没完。
      if (picking) drop();
      els.pack.className = 'opbtn packbtn done';
      els.pack.textContent = '打包好了';
      // ★ 画板没还回去也要说出来（见 js/pack.js 的 `back`）：不说明的话，
      //   老师会以为画板自己乱跳了——它停在最后画的那一张上。
      SR.chat.setStatus('已打包 ' + r.figs + ' 张图' + (r.mm ? '（含导图）' : '')
        + (r.missed ? '，有 ' + r.missed + ' 张没画出来、没进包' : '')
        + (r.back === false ? '。画板还停在最后一张上，点一下「恢复」就回来了' : '')
        + '。');
      setTimeout(function () {
        els.pack.className = 'opbtn packbtn';
        paintLabels();
      }, 2200);
    });
  }

  // ---- 对外 ----

  // 账本／屏幕变了就喊一声。三处喊它：chat.js 的 submit（新摆了一条）、
  // seedPack（刷新之后按记忆重建完）、以及这儿自己。
  // ★ 没有内容可打时**自动退出挑选模式**：挑了半天一条都勾不上（圆圈全不见了），
  //   老师会以为功能坏了。
  function sync() {
    if (!els.strip) return;
    var n = SR.pack ? SR.pack.count() : 0;
    if (!n) {
      if (picking) { drop(); if (SR.chat) SR.chat.setStatus(lastStatus || ''); }
      else 收勾选框();
      paintLabels();
      return;
    }
    if (picking) 摆勾选框();
    paintLabels();
  }

  function init() {
    els.strip = $('onep');
    els.pick = $('op-pick');
    els.pack = $('op-pack');
    if (!els.strip || !els.pick || !els.pack) return;

    els.pick.addEventListener('click', function () {
      if (picking) leave(); else enter();
    });

    els.pack.addEventListener('click', function () {
      if (!SR.pack) return;
      if (picking) {
        var sel = 选中的();
        if (!sel.length) {
          // ★ 一条没勾就按下去，别静默——静默的话他会以为按钮坏了，
          //   然后再按两下。（跟分步那条"点了没反应"同一条规矩。）
          SR.chat.setStatus('还一条都没勾——点左边那些圆圈，勾中的才会进包。');
          return;
        }
        run(sel);
        return;
      }
      run(null);                 // 不挑 = 整份打包（`pick(null)` 那一路）
    });

    // 点圆圈（以及消息左边的空白）＝ 勾/取消。
    // ⚠ 用**事件委托**挂一次，不往每条消息上各挂一个：
    //   消息是流式一条条长出来的，`sync` 也会重摆圆圈，逐个挂就是每摆一次挂一轮，
    //   而重复挂的监听器**不会报错**，只会让一次点击跑两遍（勾上又取消，
    //   看着像"点了没反应"）。
    var box = $('msgs');
    if (box) {
      box.addEventListener('click', function (e) {
        if (!picking) return;
        var t = e.target;
        if (!t || !t.closest) return;
        var m = t.closest('.msg');
        if (!m || !m.querySelector('.bubble[data-turn]')) return;
        // 圆圈本身 → 总是勾／取消
        if (t.closest('.pickbox')) { toggle(m); return; }
        // ⚠ 点在**正文里**不勾：那儿是老师要划词选字的地方（他会不会想拷一句话？
        //   会的）。点左边那条空沟（圆圈那一溜）才勾，跟微信一样是"点行"，
        //   但把"行"缩到不跟划词打架的那一半。
        if (t.closest('.bubble')) return;
        // 带动作的东西一律不勾：划到它们身上是"我要按它"，不是"我要选这条"。
        if (t.closest('button') || t.closest('a') || t.closest('input')) return;
        toggle(m);
      });
    }

    // Esc 退出挑选。★ 挂 document 上而不是 `#msgs`：老师的鼠标多半不在对话栏里，
    //   挂在里面就等于只有"鼠标正好在对话上"时 Esc 才管用。
    document.addEventListener('keydown', function (e) {
      if (!picking) return;
      if (e.key === 'Escape' || e.keyCode === 27) leave();
    });

    sync();
  }

  return {
    init: init,
    sync: sync,
    enter: enter,
    leave: leave,
    // 探针用：量"现在屏幕上到底有几个圆圈、勾了几个"。
    // ★ 露出来是因为这两件事**从账本上看不出来**：账本是数据，圆圈是屏幕上的东西，
    //   而它们对不上的方式恰恰是最难查的那种——圆圈该有的地方没有（作图那几格
    //   历史上就少过），点了照样变蓝，包照样打得出来，只是少一条。
    __picking: function () { return picking; },
    __checked: function () { var a = 选中的(); a.sort(function (x, y) { return x - y; }); return a; },
    __boxes: function () { return document.querySelectorAll('#msgs .pickbox').length; }
  };
})();
