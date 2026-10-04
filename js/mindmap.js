// 思维导图：把这一节课的**链子**画成一张图。
//
// 为什么要有它（孔老师 2026-10-02 用过线上那版之后的话）：
//   「我觉得你这个备课流程做的是不是不够智能化，没有形成思维导图那样的思维链，
//     无法做到思维链条可视化。实际上右边的画板应该要可以有思维导图的同步形成。」
//   「右边可以产出多个不同的内容的 ggb 图，但又能有一个备课全程思维导图的内容」
// 链子摆在左边是一条一条的文字，往上翻就看不见前面了；右栏的图又是"最后一张盖掉前一张"。
// 老师要的是**一眼看见整条链子的形状**：这道题有几条错路、他选了哪条、走到第几节了。
//
// ============================================================
//  ★★ 为什么**不用 SVG**（三条，都是硬的）
// ============================================================
//   ① 导出走 `new Image()` 时光栅化的是**另一份独立文档**，CDN 上的 web font
//      不会被加载——标题那份思源宋体（index.html 顶上那几行）会掉回系统宋体，
//      "字体不对"这件事孔老师一眼就看得出来。
//   ② SVG 里的 `<foreignObject>` 会**污染 canvas**，`toDataURL` 当场抛 SecurityError
//      ——而这张图一定要能导出（阶段二的压缩包里要它）。
//   ③ SVG dataURL 塞进 `<img>` 必须写死 width/height，又是一处"什么时候量得准"的时序。
//
//   所以走仓库里**已经走通的那条路**：自己开 canvas 画（js/board.js 的 exportPNG、
//   shoot 都是这么干的）。
//
// ============================================================
//  ★★ 三层分工，别混
// ============================================================
//   `SR.mm.chainDoc(turns, opts)`  纯数据：把一串回复读成 {题目, 岔路, 环节}
//   `SR.mm.layout(doc, opts)`      纯几何：算出每个框在哪、每条线连哪儿。**零 DOM 零 canvas**
//   `SR.mm.paint(g, L, scale)`     **唯一的画师**：屏幕上那块 canvas 和导出的 PNG 走同一段绘制
//
//   ★ 屏幕和导出**没有双真源**，这是这套分层的全部意义。分开画的话，
//     "屏幕上看着好好的、导出来少一行字"这类事就永远查不完。
//
// ============================================================
//  ★ 公式：`\frac` 这种东西 canvas 画不出来（KaTeX 是 DOM），走纯函数转成 Unicode 明文
// ============================================================
//   `SR.mm.latexToText` —— `\frac{a}{b}`→`a/b`、`\sqrt{3}`→`√3`、`^{2}`→`²`、`\times`→`×`
//   代价：**没有竖排分式**（换来的好处是屏幕和导出长得一样）。
var SR = (window.SR = window.SR || {});

SR.mm = (function () {

  // ============================================================
  //  一、LaTeX → 明文（纯函数，node 里能测）
  // ============================================================
  // ★ 为什么非要转：canvas 的 `fillText` 只画字，画不了排版。
  //   导图里那些 `$x^2-3x+2=0$` 直接画出来就是**一串反斜杠**——
  //   这正是孔老师这次第一条抱怨的形状（「数学公式显示不出来，frac 还在」）。
  //   图里不靠任何字体、不靠 DOM，就得把式子摊平成一行 Unicode。

  var SYM = [
    ['\\\\(?:left|right)[.\\[\\]()|]', ''],
    ['\\\\[a-zA-Z]*space|\\\\,|\\\\;|\\\\!|\\\\ ', ' '],
    ['\\\\quad', '  '],
    ['\\\\times', '×'], ['\\\\div', '÷'], ['\\\\cdot', '·'],
    ['\\\\leq\\b|\\\\le\\b', '≤'], ['\\\\geq\\b|\\\\ge\\b', '≥'],
    ['\\\\neq\\b|\\\\ne\\b', '≠'], ['\\\\approx', '≈'],
    ['\\\\pm', '±'], ['\\\\mp', '∓'],
    ['\\\\angle', '∠'], ['\\\\triangle', '△'],
    ['\\\\parallel', '∥'], ['\\\\perp', '⊥'],
    ['\\\\because', '∵'], ['\\\\therefore', '∴'],
    ['\\\\infty', '∞'], ['\\\\circ', '°'],
    ['\\\\to\\b|\\\\rightarrow', '→'], ['\\\\leftarrow', '←'],
    ['\\\\pi', 'π'], ['\\\\alpha', 'α'], ['\\\\beta', 'β'], ['\\\\theta', 'θ'],
    ['\\\\ell', 'ℓ'],
    ['\\\\text|\\\\mathrm|\\\\operatorname', ''],
    ['\\\\%', '%'],
    ['\\\\\\{', '{'], ['\\\\\\}', '}']
  ];
  var SYM_RE = SYM.map(function (p) { return [new RegExp(p[0], 'g'), p[1]]; });

  var SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶',
              '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼',
              '(': '⁽', ')': '⁾', 'n': 'ⁿ' };
  var SUB = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆',
              '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌',
              '(': '₍', ')': '₎' };

  // 从 `s[i]`（应当是个 `{`）读出一个平衡的组，回 {body, next}
  function group(s, i) {
    if (s.charAt(i) !== '{') return { body: s.charAt(i), next: i + 1 };  // `x^2` 只有一个字符
    var d = 0;
    for (var k = i; k < s.length; k++) {
      var c = s.charAt(k);
      if (c === '{') d++;
      else if (c === '}') { d--; if (!d) return { body: s.slice(i + 1, k), next: k + 1 }; }
    }
    return { body: s.slice(i + 1), next: s.length };   // 括号没配平：能捞多少捞多少
  }
  // `x+1` 当分子或分母时要加括号，`3` 不用。判据是**有没有运算符**，不是长不长。
  // ★ `/` 和 `√` 也算：`\frac{\frac{1}{2}}{3}` 内层摊平后就是 `1/2`，
  //   不加括号出来是 `1/2/3`——**看着像个答案，其实是三种读法的混合**。
  function needParen(x) { return /[+\-×÷·\/√]/.test(x.replace(/^[-+]/, '')); }
  function shift(s, table) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = table[s.charAt(i)];
      if (c == null) return '';       // 有一个字换不了就整段不换，别生出半个上标
      out += c;
    }
    return out;
  }

  // 把 `\frac` / `\sqrt` 摊平成一行。**递归**——分子分母里还可能是 `\frac`。
  // ★★ 这里踩过一次，记下来：最早是"外层扫一遍、里层留给下一轮"，
  //   而"要不要给它加括号"是在**摊平之前**判的。于是 `\frac{\frac{1}{2}}{3}`
  //   判内层时手里那个串是 `\frac{1}{2}`——**里面根本没有 `/`**（那个斜杠是
  //   转换器待会儿才生出来的），判成"没运算符、不用加括号"，出来是 `1/2/3`：
  //   看着像个答案，其实是三种读法混在一起。**判据要拿"它将会变成什么"去判。**
  function flat(s) {
    var out = '', i = 0;
    while (i < s.length) {
      var m = /^\\(?:d|t)?frac\s*/.exec(s.slice(i));
      if (m) {
        var a = group(s, i + m[0].length), b = group(s, a.next);
        var an = flat(a.body), bn = flat(b.body);
        out += (needParen(an) ? '(' + an + ')' : an) + '/' +
               (needParen(bn) ? '(' + bn + ')' : bn);
        i = b.next; continue;
      }
      var r = /^\\sqrt\s*/.exec(s.slice(i));
      if (r) {
        var at = i + r[0].length, deg = '';
        if (s.charAt(at) === '[') {                    // \sqrt[3]{8} → ³√8
          var e = s.indexOf(']', at);
          if (e > 0) { deg = shift(s.slice(at + 1, e), SUP); at = e + 1; }
        }
        var g = group(s, at), gn = flat(g.body);
        out += (deg ? deg + '√' : '√') + (needParen(gn) ? '(' + gn + ')' : gn);
        i = g.next; continue;
      }
      out += s.charAt(i); i++;
    }
    return out;
  }

  // ★ 一遍遍扫，直到没有 `^{`——**`x^{y^{2}}` 这种嵌起来的要两轮才摊平**
  //   （上面那条正则的 `[^}]*` 读不进嵌套的花括号）。
  //   上限 6 轮不是随便给的：正常题目两层就到头；给无限碰上 bug 就是**卡死**，那不叫鲁棒。
  function latexToText(s) {
    var t = String(s == null ? '' : s).replace(/[$]/g, '');
    for (var round = 0; round < 6; round++) {
      var before = t;
      var out = flat(t);
      out = out.replace(/\^\s*(\{[^}]*\}|\\circ|.)/g, function (all, q) {
        var body = q.charAt(0) === '{' ? q.slice(1, -1) : q;
        if (body === '\\circ') return '°';
        return shift(body, SUP) || ('^(' + body + ')');
      });
      out = out.replace(/_\s*(\{[^}]*\}|.)/g, function (all, q) {
        var body = q.charAt(0) === '{' ? q.slice(1, -1) : q;
        return shift(body, SUB) || ('_(' + body + ')');
      });
      t = out;
      if (t === before) break;
    }
    for (var k = 0; k < SYM_RE.length; k++) t = t.replace(SYM_RE[k][0], SYM_RE[k][1]);
    // ★ 运算符两边的空格收掉。模型写 `$2\times 3$`、`$x\leq 5$` 是**常态**，
    //   照抄出来就是 `2× 3`——式子成了"一个符号后面跟着一句话"，比原来的毛病还难看。
    //   ⚠ 只认下面这些**换了字形之后**才不会跟中文撞车的符号。别顺手把 `,`、`。` 也加进来：
    //     中文句子里的空格是断句用的，收掉了就是"把两句话焊在一起"。
    t = t.replace(/\s*([×÷·≤≥≠≈±∓∠△∥⊥→←=])\s*/g, '$1');
    // ★ 兜底：到这儿还剩下的 `\` 一律**只去掉那个反斜杠**，把命令名留成字。
    //   为什么不留着不管：canvas 上一串反斜杠正是这次要治的病。
    //   为什么不整条丢掉：`\overrightarrow` 留成 `overrightarrow` 至少看得出原话——
    //   **看得见的丑 好过 看不见的丢**。
    t = t.replace(/\\([a-zA-Z]+)/g, '$1').replace(/[\\{}]/g, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  // ============================================================
  //  二、把一串回复读成一张导图的输入（纯函数）
  // ============================================================
  // turns：`[{visible, ggb}, …]`——就是 js/pack.js 那一份的形状（每条助手回复一条）。
  // ★ 复用 pack 那一份、不另记一份：**同一场对话只该有一个账本**。
  //   另记一份的结果是"打包里的图和导图上的图对不上"，而且没有任何东西会报。
  //
  // 返回 `{ topic, routes, chosen, steps, plan }`
  function chainDoc(turns, opts) {
    opts = opts || {};
    var list = turns || [];
    // ★ 槽位是**现折出来的**，不读 chat.js 里那份闭包状态：那份没出口，
    //   而且"链子"本来就该能从这串回复重算——重算得出来，才能只重跑下游（阶段五）。
    var st = SR.chainState ? SR.chainState() : { slots: [], plan: 0, now: 0 };
    var routes = [], routeAt = -1, bodies = {}, texts = [];

    list.forEach(function (tn, i) {
      var t = String((tn && tn.visible) || '');
      texts.push(t);
      // 第一条说得出的岔路那一轮，就是"出几路"那一轮。**只认第一条**：
      // 后面某一轮再列一串编号，多半是别的东西（题目清单、步骤表）。
      if (routeAt < 0 && SR.parseRoutes) {
        var r = SR.parseRoutes(t);
        if (r.length >= 2) { routes = r; routeAt = i; }
      }
      if (SR.absorbChain) SR.absorbChain(st, t);
      if (SR.parseStepBody) {
        var b = SR.parseStepBody(t);
        Object.keys(b).forEach(function (n) { if (!bodies[n]) bodies[n] = b[n]; });
      }
    });

    // 它选了哪条路。★ 认的是**明确指路的那句话**（"先走第 1 路"），不是随便一个"第 1 路"——
    //   正文里列路本身就写 `第 1 路：…`，那样会把每一条都认成选中。
    //   所以动词是必须的（先走／就走／选／按／用），这条闸跟 chips.js 的 RE_PLAN_ISH 是一回事。
    var chosen = '';
    if (routes.length) {
      var re = /(?:先走|就走|走|选|按|用)\s*第\s*([0-9]+|[一二两三四五六七八九十])\s*[种条]?路/;
      for (var i = 0; i < texts.length; i++) {
        var m = re.exec(texts[i]);
        if (!m) continue;
        var n = SR.numOf ? SR.numOf(m[1]) : parseInt(m[1], 10);
        if (n && routes.some(function (r) { return r.key === String(n); })) { chosen = String(n); break; }
      }
    }

    var steps = (st.slots || []).map(function (s) {
      var b = bodies[s.n] || { said: '', you: '', why: '' };
      return { n: s.n, name: s.name, said: b.said, you: b.you, why: b.why };
    });
    return { topic: String(opts.topic || ''), routes: routes, chosen: chosen,
             steps: steps, plan: st.plan || 0 };
  }

  // ============================================================
  //  三、版面（纯几何）
  // ============================================================
  // ★ 输入输出全是数，**不碰 DOM、不碰 canvas**。所以 `test/probe_mindmap.cjs`
  //   能在 node 里把它摆到各种边角（0 条路／6 条路／12 个环节／一个字都没有），
  //   量的还是真几何——不联网、不花额度、不用浏览器。

  // 字号表。★ **layouter 和 painter 读的是同一个对象**（`SR.mm.FS`）。
  //   量字宽用它、画字也用它；抄成两份的话，框子按 15px 排出来、字按 12px 画上去，
  //   下半截就空着——这种毛病小屏上看不出，导出来才发现。
  var FS = { topic: 20, topicBody: 14.5, rtitle: 15, rbody: 12.5,
             stitle: 15, sbody: 12, sub: 11, foot: 11 };
  var FONT = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';

  // 记号（环节号那枚方牌／岔路的 ①）要占掉的**左边整段**。
  // ★ 这个数**同时决定换行宽度和落笔位置**——两处各写一遍的话，
  //   字就压到方牌上或者压出框外，而这两种都要把图导出来才看得出来。
  var INSET = { topic: 13, route: 31, step: 31 };
  var PADX = 30, PADY = 26, GAP_MAIN = 30, GAP_CROSS = 18, PADIN = 11;
  var W_TOPIC = 460, W_ROUTE = 186, W_STEP = 300;
  var MAXLINES = 7;                  // 一栏最多画几行，超了截断加省略号
  var MARK = '①②③④⑤⑥⑦⑧⑨';

  // 没有 ctx 时的估宽：中日韩按一个全宽，西文按半个。
  // ★ 只在 node 里用它。浏览器里 **一定** 把真 ctx 传进来（见 refresh），
  //   估算和真字宽差几个像素，边角上就是"字压出框外"。
  function estW(s, fs) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += (s.charCodeAt(i) < 128 ? fs * 0.55 : fs);
    return w;
  }

  function wrap(text, maxPx, fs, measure) {
    var out = [];
    String(text == null ? '' : text).split('\n').forEach(function (para) {
      para = para.replace(/\s+/g, ' ').trim();
      if (!para) return;
      var line = '';
      for (var i = 0; i < para.length; i++) {
        var ch = para.charAt(i);
        if (line && measure(line + ch, fs) > maxPx) { out.push(line); line = ''; }
        line += ch;
      }
      if (line) out.push(line);
    });
    if (out.length > MAXLINES) {
      out = out.slice(0, MAXLINES);
      out[MAXLINES - 1] = out[MAXLINES - 1].replace(/.{1,2}$/, '') + '…';
    }
    return out;
  }

  // 一栏文字的排法：`[{text, fs, color, weight, gapBefore}]` → 框的尺寸和每行的落点。
  // ★ **量一次、存下来**，painter 直接照它画——两处各量一次，就一定会差一行。
  function block(fields, maxPx, measure) {
    var rows = [], w = 0;
    fields.forEach(function (f) {
      if (!f.text) return;
      if (f.gapBefore && rows.length) rows.push({ text: '', fs: f.fs, gap: f.gapBefore });
      wrap(f.text, maxPx, f.fs, measure).forEach(function (l) {
        rows.push({ text: l, fs: f.fs, color: f.color, weight: f.weight,
                    h: Math.round(f.fs * 1.5) });
        w = Math.max(w, measure(l, f.fs));
      });
    });
    var h = 0;
    rows.forEach(function (r) { h += (r.h || r.gap || 0); });
    return { rows: rows, textW: w, textH: h };
  }

  // 「环节超过 6 个就横过来」——竖着排 12 个环节，导出来是一根一米长的面条，
  // 插进 Word 版心放不下。
  var MAX_DOWN = 6;

  function layout(doc, opts) {
    opts = opts || {};
    doc = doc || {};
    var measure = opts.measure || estW;
    var routes = doc.routes || [], steps = doc.steps || [], chosen = doc.chosen || '';
    // ★ 方向**在换行之前**定下来：换行宽度和框的尺寸都跟着它变。
    //   反过来（先按竖排量好、再决定横排）就要把每一栏重量一遍，而重量那一步
    //   只要有一栏忘了，出来的就是"横排里混着一个按竖排宽度的框"。
    var horizontal = opts.orient ? (opts.orient === 'h') : (steps.length > MAX_DOWN);

    var nodes = [];
    var main = 0;                 // 主干走到哪了（沿主轴的绝对位置，最后整体平移）

    // 造一个框。`crossCenter` 是它在十字轴上的**中心**；框自己算出左上角。
    function box(kind, fields, wrapW, fixedW, crossCenter) {
      var b = block(fields, wrapW, measure);
      var w = Math.max(96, Math.ceil(b.textW) + INSET[kind] + PADIN);
      if (fixedW) w = Math.max(fixedW, w);     // 定宽那一排才整齐；真超了就让这一个宽出去
      var h = b.textH + PADIN * 2;
      var n = { kind: kind, w: w, h: h, block: b, dim: false,
                crossLen: horizontal ? h : w,      // 沿十字轴占多少
                mainLen:  horizontal ? w : h };    // 沿主轴占多少
      n.crossPos = crossCenter - n.crossLen / 2;
      nodes.push(n);
      return n;
    }
    function place(n, mainPos) {
      n.mainPos = mainPos;
      if (horizontal) { n.x = mainPos; n.y = n.crossPos; }
      else { n.x = n.crossPos; n.y = mainPos; }
      return n;
    }

    // ---- ① 题目 ----
    var tnode = null, topicTxt = latexToText(doc.topic || '');
    if (topicTxt) {
      var fields = [{ text: topicTxt, fs: FS.topicBody }];
      // 先探一次宽度：题目框**按内容收窄**（一行短文不该占满 460），但不超过 W_TOPIC
      var probe = block(fields, W_TOPIC - INSET.topic - PADIN, measure);
      var tw = Math.max(210, Math.min(W_TOPIC, Math.ceil(probe.textW) + INSET.topic + PADIN));
      tnode = place(box('topic', fields, tw - INSET.topic - PADIN, 0, 0), main);
      main += tnode.mainLen;
    }

    // ---- ② 几条岔路：沿十字轴并排，以 0 为中心 ----
    var rnodes = [];
    if (routes.length) {
      main += GAP_MAIN;
      var items = routes.map(function (r, i) {
        var n = box('route',
          [{ text: r.text || '（这一条它没写内容）', fs: FS.rbody }],
          W_ROUTE - INSET.route - PADIN, W_ROUTE, 0);
        n.label = i < MARK.length ? MARK.charAt(i) : '';
        n.key = r.key;
        n.dim = !!(chosen && r.key !== chosen);
        return n;
      });
      var total = 0;
      items.forEach(function (n, i) { total += n.crossLen + (i ? GAP_CROSS : 0); });
      var c = -total / 2;
      items.forEach(function (n) { n.crossPos = c; c += n.crossLen + GAP_CROSS; });
      items.forEach(function (n) { place(n, main); });
      main += items.reduce(function (a, n) { return Math.max(a, n.mainLen); }, 0);
      rnodes = items;
    }

    // ---- ③ 主干：环节一个接一个 ----
    var snodes = [];
    if (steps.length) {
      main += GAP_MAIN;
      steps.forEach(function (s, i) {
        if (i) main += GAP_MAIN * 0.6;
        var fields = [{ text: s.name, fs: FS.stitle, weight: '700' }];
        if (s.said) fields.push({ text: '学生：' + latexToText(s.said), fs: FS.sbody, color: 'ink2', gapBefore: 6 });
        if (s.you)  fields.push({ text: '你接：' + latexToText(s.you),  fs: FS.sbody, color: 'brand', gapBefore: 4 });
        if (s.why)  fields.push({ text: '道理：' + latexToText(s.why),  fs: FS.sub,  color: 'ink3', gapBefore: 4 });
        var n = place(box('step', fields, W_STEP - INSET.step - PADIN, W_STEP, 0), main);
        n.n = s.n;
        main += n.mainLen;
        snodes.push(n);
      });
    }

    // ---- ④ 整体挪进正数区，再连 ----
    if (!nodes.length) {
      // ★ 空场也**要有一张图**，不能返回 null：老师一节课刚开始就点开导图，
      //   屏幕上是一片空白、还是"还没有东西"一句话，是两回事。
      return { w: 420, h: 152, nodes: [], edges: [], empty: true, horizontal: horizontal,
               hit: function () { return null; } };
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
    });
    var dx = PADX - minX, dy = PADY - minY;
    nodes.forEach(function (n) { n.x += dx; n.y += dy; });

    var edges = [];
    function seg(a, b, dim) {
      var p, q;
      if (horizontal) {
        p = { x: a.x + a.w, y: a.y + a.h / 2 };
        q = { x: b.x, y: b.y + b.h / 2 };
      } else {
        p = { x: a.x + a.w / 2, y: a.y + a.h };
        q = { x: b.x + b.w / 2, y: b.y };
      }
      edges.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, dim: !!dim });
    }
    rnodes.forEach(function (n) { seg(tnode, n, n.dim); });
    if (rnodes.length && snodes.length) {
      var from = null;
      for (var i = 0; i < rnodes.length; i++) if (rnodes[i].key === chosen) { from = rnodes[i]; break; }
      if (from) seg(from, snodes[0], false);
      else {
        // ★ 读不出选了哪条**不替它挑一条**：连到**整排岔路**那条中点，
        //   图上看得出来"这条链子是从这一排出来的"，而没说"它选了哪一条"。
        var r0 = rnodes[0], r1 = rnodes[rnodes.length - 1];
        seg({ x: r0.x, y: r0.y, w: (r1.x + r1.w) - r0.x, h: r0.h }, snodes[0], true);
      }
    } else if (tnode && snodes.length) {
      seg(tnode, snodes[0], false);
    }
    for (var k = 1; k < snodes.length; k++) seg(snodes[k - 1], snodes[k], false);

    function hit(px, py) {
      function inside(n) { return px >= n.x && px <= n.x + n.w && py >= n.y && py <= n.y + n.h; }
      // ★ 岔路优先：点它是**有后果的**（换一条路走），点环节没有后果。
      //   重叠的时候宁可让有后果的那个先赢。
      for (var i = rnodes.length - 1; i >= 0; i--) if (inside(rnodes[i])) return rnodes[i];
      for (var j = nodes.length - 1; j >= 0; j--) if (inside(nodes[j])) return nodes[j];
      return null;
    }

    return { w: Math.ceil(maxX - minX) + PADX * 2, h: Math.ceil(maxY - minY) + PADY * 2,
             nodes: nodes, edges: edges, horizontal: horizontal, chosen: chosen,
             routes: rnodes, steps: snodes, topic: tnode, hit: hit };
  }

  // ============================================================
  //  四、画（唯一的一份画师）
  // ============================================================
  // 颜色从 CSS 变量读，读不到就用下面这份兜底（node 里、样式还没装上来的时候）。
  // ★ 不在这儿抄一份色值当"真源"：css/main.css 那一处才是。抄出来的那份
  //   不会有人跟着改，而**它坏了没有任何东西会报**——导图会慢慢变成另一个色系。
  var C = { ink: '#0d1913', ink2: '#33443b', ink3: '#5a6e64', line: '#d2e0d8',
            panel: '#fdfefd', sunken: '#d8e5dd', brand: '#0b6b45', brandDeep: '#063f28',
            brandSoft: '#d9eee2', brandLine: '#a5ccb7', alt: '#5f6b12',
            altSoft: '#eff4d9', altLine: '#c8d492' };
  var CVAR = { ink: '--ink', ink2: '--ink-2', ink3: '--ink-3', line: '--line',
               panel: '--panel', sunken: '--sunken', brand: '--brand',
               brandDeep: '--brand-deep', brandSoft: '--brand-soft',
               brandLine: '--brand-line', alt: '--alt', altSoft: '--alt-soft',
               altLine: '--alt-line' };
  function syncColors() {
    if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return;
    var cs = getComputedStyle(document.documentElement), k, v;
    for (k in CVAR) {
      if (!CVAR.hasOwnProperty(k)) continue;
      v = cs.getPropertyValue(CVAR[k]);
      if (v && v.trim()) C[k] = v.trim();
    }
  }

  function paint(g, L, scale) {
    scale = scale || 1;
    g.save();
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.textBaseline = 'top';
    g.fillStyle = C.panel;
    g.fillRect(0, 0, L.w, L.h);

    if (L.empty) {
      g.fillStyle = C.ink3;
      g.font = '13px ' + FONT;
      g.textAlign = 'center';
      g.fillText('这一场还没有东西可画——在左边摆出几个环节，或者让它先给你几条错路。',
                 L.w / 2, L.h / 2 - 8);
      g.textAlign = 'left';
      g.restore();
      return;
    }

    // ---- 连线先画，框盖在上面：端点就正好落在框边上 ----
    L.edges.forEach(function (e) {
      g.beginPath();
      g.setLineDash(e.dim ? [6, 5] : []);
      g.strokeStyle = e.dim ? C.line : C.brandLine;
      g.lineWidth = e.dim ? 1.5 : 2;
      g.moveTo(e.x1, e.y1); g.lineTo(e.x2, e.y2); g.stroke();
    });
    g.setLineDash([]);

    // ---- 框和字 ----
    L.nodes.forEach(function (n) {
      g.save();
      // 没选中的那条路：淡下去、虚线、白底——但**还在**。
      // ★ 不许把它藏掉：老师要看的正是"我这儿本来还有别的走法"。
      if (n.dim) g.globalAlpha = 0.45;

      if (n.kind === 'topic') {
        g.fillStyle = C.brandDeep;
        g.fillRect(n.x, n.y, n.w, n.h);
      } else if (n.kind === 'route') {
        g.fillStyle = n.dim ? C.panel : C.brandSoft;
        g.fillRect(n.x, n.y, n.w, n.h);
        g.beginPath();
        g.setLineDash(n.dim ? [5, 4] : []);
        g.strokeStyle = n.dim ? C.line : C.brand;
        g.lineWidth = 1.5;
        g.strokeRect(n.x + .75, n.y + .75, n.w - 1.5, n.h - 1.5);
        g.setLineDash([]);
      } else {
        g.fillStyle = C.panel;
        g.fillRect(n.x, n.y, n.w, n.h);
        g.strokeStyle = C.brandLine; g.lineWidth = 1;
        g.strokeRect(n.x + .5, n.y + .5, n.w - 1, n.h - 1);
      }

      // 记号：环节号一枚小方牌（全站无圆角，方牌才是这里的形状）；岔路是 ①
      var top = n.y + PADIN;
      if (n.kind === 'step') {
        g.fillStyle = C.brand;
        g.fillRect(n.x, n.y, 22, 20);
        g.fillStyle = '#fff';
        g.font = '700 12px ' + FONT;
        g.textAlign = 'center';
        g.fillText(String(n.n == null ? '' : n.n), n.x + 11, n.y + 4);
        g.textAlign = 'left';
      } else if (n.kind === 'route' && n.label) {
        g.fillStyle = n.dim ? C.ink3 : C.brand;
        g.font = '700 13px ' + FONT;
        g.fillText(n.label, n.x + 10, top);
      }

      var tx = n.x + INSET[n.kind], y = top;
      n.block.rows.forEach(function (row) {
        if (!row.text) { y += row.gap || 0; return; }
        var col = row.color;
        if (col === 'panel') col = '#fff';
        else if (col === 'brand') col = C.brand;
        else if (col === 'ink2') col = C.ink2;
        else if (col === 'ink3') col = C.ink3;
        if (!col) col = (n.kind === 'topic') ? '#fff' : C.ink;
        g.fillStyle = col;
        g.font = (row.weight || '') + ' ' + row.fs + 'px ' + FONT;
        g.fillText(row.text, tx, y);
        y += row.h;
      });
      g.restore();
    });

    // ---- 署名：跟"存图"烧的是同一行字（见 js/board.js 的 mark）----
    if (SR.board && SR.board.mark) { try { SR.board.mark(g, L.w, L.h); } catch (e) {} }
    g.restore();
  }

  // ============================================================
  //  四点五、导出成一张 PNG（打包用）
  // ============================================================
  // ★★ 走的是**同一个 paint**，不是第二套画法。屏幕上那块 canvas 和这张图
  //   逐像素相同——这不是省事，是因为它们**会躺在同一个压缩包里**：
  //   两份画法只要有一处不一样（比如导出时忘了画没选中那条路的虚线），
  //   老师看到的就是"屏幕上和带走的不是一张图"，而没有任何东西会报。
  //
  // ★ 返回 ''：① 空场（一张写着"还没有东西"的图放包里没有意义）；
  //   ② 没有 canvas（node 里跑探针）。**不抛异常**——打包那头只关心有没有图，
  //   为了导图把整个包弄失败是最差的结果。
  //
  // ⚠ 宽度封顶 2400px（计划里定的那条）：这张图是要插进 Word 版心、印出来的，
  //   一整条链子横过来能画到四千多像素，插进去就是被压扁的字。
  //   **只缩不放**——本来就不宽的时候别把它拉大，那只会糊。
  var MAXW = 2400;
  function toPNG(opts) {
    if (typeof document === 'undefined' || !document.createElement) return '';
    opts = opts || {};
    var turns = (SR.pack && SR.pack.turns) ? SR.pack.turns() : [];
    var doc = chainDoc(turns, { topic: (SR.pack && SR.pack.topic) ? SR.pack.topic() : '' });
    if (!doc.steps || !doc.steps.length) return '';
    // 量字要用真的 ctx：estimate 差几个像素，图上就是"字压出框外"（见 measureWith）。
    var mc = document.createElement('canvas').getContext('2d');
    var lay = layout(doc, { measure: measureWith(mc), orient: opts.orient });
    var s = Math.min(1, MAXW / lay.w);
    lay.scale = s;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(lay.w * s));
    c.height = Math.max(1, Math.round(lay.h * s));
    var g = c.getContext('2d');
    try { paint(g, lay, s); } catch (e) { return ''; }
    // ⚠ 这里**没有** getImageData／foreignObject，画布从来没被别的域的东西污染过，
    //   所以 toDataURL 不会抛 SecurityError（导出这条路的选型理由见文件头那段）。
    try { return c.toDataURL('image/png'); } catch (e) { return ''; }
  }

  // ============================================================
  //  五、装机（右栏那一块）
  // ============================================================
  var canvas = null, host = null, L = null, open = false, vs = [];
  // ★★ 2026-10-05：**画板此刻是哪一档** —— '2d' / 'blank' / '3d'。
  //   原来这儿是个布尔 `is3D`，只有平面/三维两档时装得下。孔老师要了「空白」
  //   之后就是三档，布尔装不下了：切到空白，按钮会亮"平面"（因为 is3D 是 false），
  //   老师看着亮的和板上的对不上。所以换成档名，跟 board.js 的 `现在视角()` 同一套词。
  //   ⚠ 初值给 'blank' 不是 '2d' —— 板子**开机就是一张干净纸**（无轴无网格，
  //     见 board.js 里 `关轴()` 跟 appletOnLoad 那一段）。而 init() 里会拿
  //     `SR.board.viewDim()` 对一次真账，这个初值只是万一板子还没起来时的兜底。
  var dim = 'blank';

  // 真实测宽：拿画板上那块 ctx 量真字。★ 别退回 estW 兜底——估算差几个像素，
  //   边角上就是"字压出框外"，而那只有导出来才看得见。
  function measureWith(g) {
    return function (s, fs) { g.font = fs + 'px ' + FONT; return g.measureText(s).width; };
  }

  function refresh() {
    if (!canvas || !host) return;
    // 藏着的时候 clientWidth 是 0。这时候别拿一个下限去画——那会把版面记成错的。
    // show() 一定会再喊一次 refresh，所以"等看得见再量"就够了。
    if (host.clientWidth < 2) return;
    var cw = Math.max(240, host.clientWidth), ch = Math.max(160, host.clientHeight);
    var doc = chainDoc(SR.pack && SR.pack.turns ? SR.pack.turns() : [],
                       { topic: SR.pack && SR.pack.topic ? SR.pack.topic() : '' });
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    var g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    var lay = layout(doc, { measure: measureWith(g) });
    // 装不下就整体缩到装得下（**只缩不放**）：竖着排十几个环节时靠这一句。
    var s = Math.min(1, (cw - 8) / lay.w);
    lay.scale = s;
    L = lay;
    paint(g, lay, dpr * s);
  }

  function onClick(ev) {
    if (!L || !L.hit) return;
    var r = canvas.getBoundingClientRect(), s = L.scale || 1;
    var n = L.hit((ev.clientX - r.left) / s, (ev.clientY - r.top) / s);
    if (!n || n.kind !== 'route' || !n.dim) return;
    if (!SR.chat || !SR.chat.say) return;
    // ★ 点一条淡下去的路 = "换这条走"。发出去的是**老师的话**，不是魔法符号。
    //   ⚠ 这一句会留在 history 里，模型下几轮都看得见（跟 SR.stepJump 一个道理）——
    //     所以它得是一句人话，而不是给程序看的 token。
    var i = (L.routes || []).indexOf(n);
    SR.chat.say('先走第 ' + (i + 1) + ' 条路。', { viaMm: true });
  }

  // 那几颗按钮谁亮：**只有这一处说了算**。
  // ★ main.js 的 view 钩子会把"画板切档"这件事喊过来（模型自己写 #三维 也算），
  //   导图一开就压过那一排——不然切到导图了，"三维"还亮着，看着像导图变成了三维。
  //   ★★ 2026-10-05：从"两档比真假"改成"三档比名字"。改这一行的原因见 `dim` 那段。
  function syncSwitcher() {
    vs.forEach(function (b) {
      var v = b.getAttribute('data-view');
      b.classList.toggle('on', open ? v === 'mm' : (v === dim));
    });
  }

  function show(which) {
    open = (which === 'mm');
    var wrap = document.querySelector('.boardwrap');
    if (wrap) wrap.classList.toggle('mmon', open);
    syncSwitcher();
    // ★ 导图**盖**在画板上，不把 #ggb 藏起来：藏了它的盒子就塌，
    //    GeoGebra 那边量到 0 宽、回来还要重排一次（而且它自己不会知道）。
    if (open) refresh();
    else if (SR.board && SR.board.refit) SR.board.refit();
  }

  // ★★ 模型有图要画 / 老师点了某张图的标签 / 模型自己切了视角 → **把导图让开**。
  //   一个名字、三处调用（chat.js 收围栏、tabs.js 点标签、main.js 的 view 钩子），
  //   比让每个调用方各自去猜"现在该不该切回去"稳。
  //   产品那条规矩在这儿落地：**新东西出来了，直接切过去看，别抢了又不说。**
  function yieldToBoard() { if (open) show(dim === '3d' ? '3d' : '2d'); }

  function init(hostId) {
    host = document.getElementById(hostId);
    if (!host) return;
    syncColors();
    canvas = document.createElement('canvas');
    canvas.className = 'mmcanvas';
    host.appendChild(canvas);
    canvas.addEventListener('click', onClick);
    var t = null;
    window.addEventListener('resize', function () {
      clearTimeout(t); t = setTimeout(function () { if (open) refresh(); }, 160);
    });

    // 那三颗按钮**不在这儿绑**——绑在 js/main.js 里（跟工位、通道、工具条那些
    // 按钮同一个地方）。理由不是整齐，是**绑两遍**：main.js 本来就有一句
    // `document.querySelectorAll('.viewbtn').forEach(...)`，我这儿再绑一次，
    // 「导图」那一颗就会同时走两条路（一条 show('mm')、一条 setView('mm')），
    // 而 2d/3d 那两颗会被喊两遍视角。这里只**认下**它们，用来点灯。
    vs = Array.prototype.slice.call(document.querySelectorAll('.viewsw .viewbtn'));
    // ★★ 2026-10-05：**开局先跟画板对一次账**。
    //   板子一开机就是"空白"（appletOnLoad 里那句 `关轴()`），可那一声通知
    //   大概率比 mindmap.init 早 —— 那会儿我还不在，听不见。不主动问一句，
    //   顶上就会默认亮着 HTML 里写死的 `class="viewbtn on"`（平面），
    //   而板子明明是空的：老师一进来看见"平面"亮着、板上没轴，第一次就对不上。
    //   ⚠ 只认 '2d'/'blank'/'3d' 三个值，别把没认出来的东西吃进来
    //     （同族：参数名写错不报错，只是静默换了个量法）。
    try {
      var d = SR.board && SR.board.viewDim ? SR.board.viewDim() : '';
      if (d === '2d' || d === 'blank' || d === '3d') dim = d;
    } catch (e) {}
    syncSwitcher();
  }

  return {
    // 纯函数（node 里能测）
    latexToText: latexToText, layout: layout, chainDoc: chainDoc,
    FS: FS, COLORS: C,
    // 画
    paint: paint,
    // 导出一张（打包用，见上面四点五）
    toPNG: toPNG,
    // 装机
    init: init, refresh: refresh, show: show, syncSwitcher: syncSwitcher,
    isOpen: function () { return open; },
    yieldToBoard: yieldToBoard,
    // main.js 的 view 钩子把"画板现在是哪一档"喂进来（导图让开时要回到对的那一边）。
    // ★★ 2026-10-05：原来是 `set3D(v)` 收一个真假，现在收**档名** '2d'/'blank'/'3d'。
    //   ⚠ 认不出来的值一律**不采信**，保住上一档 —— 别退回"不是 3d 就当 2d"那种
    //     想当然（那正是这次要改掉的老毛病：新档名掉进 else 里被静默当成平面）。
    setDim: function (v) {
      if (v === '2d' || v === 'blank' || v === '3d') dim = v;
      syncSwitcher();
    },
    // 兼容旧名字：万一还有别处在喊 set3D（现在仓库里没有了，2026-10-05 全量搜过）
    set3D: function (v) { this.setDim(v ? '3d' : '2d'); },
    __dim: function () { return dim; },
    __layout: function () { return L; }
  };
})();
