// LaTeX → Word 原生公式（OMML）。**纯前端，不引任何库。**
//
// 血统：从 `C:\数学办公\_tmp_b9\omml.py`（107 行）移植过来。故意改了一件事——
//
// ★ **原版只认自定义方言 `\f{1}{2}`，这里改成吃标准 LaTeX `\frac{1}{2}`。**
//   理由：模型见过成千上万条 LaTeX，`\frac` 是它肌肉记忆；你教它 `\f`，
//   它照样写 `\frac`，公式就整片塌掉。**让代码迁就模型，别让模型迁就代码。**
//
// ★ 另一个照搬的原版做法：**命名空间声明在 `<m:oMath>` 自己身上**
//   （`<m:oMath xmlns:m="…" xmlns:w="…">`）。这样文档根节点有没有 `xmlns:m` 都不打紧。
//   这一条救过一次命——`无锡市初中数学优秀论文撰写模板.docx` 的正文里一个公式都没有，
//   根节点自然没声明 `m:`，往里插公式就会让 Word 报"内容有问题"。
//
// 支持的：\frac \dfrac \sqrt[n]{} ^ _ \abs \text 常用符号；其余字面量原样走。
var SR = (window.SR = window.SR || {});

SR.omml = (function () {

  var MNS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
          + 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

  var SZ = 24;   // 12pt → half-points

  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 数学里的西文习惯：字母斜体、数字和符号正体。
  // 原版一律斜体，出来连"1"都是斜的，卷子上很扎眼。
  function rpr(italic) {
    return '<w:rPr><w:rFonts w:hint="default" w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>'
         + '<w:sz w:val="' + SZ + '"/><w:szCs w:val="' + SZ + '"/></w:rPr>'
         + (italic ? '' : '');
  }
  function ctrl() { return '<m:ctrlPr>' + rpr() + '</m:ctrlPr>'; }

  function mrun(t, italic) {
    if (t === '') return '';
    var sty = (italic === undefined) ? /[A-Za-z]/.test(t) : italic;
    return '<m:r>' + (sty ? '<m:rPr><m:sty m:val="i"/></m:rPr>' : '')
         + rpr() + '<m:t xml:space="preserve">' + esc(t) + '</m:t></m:r>';
  }

  function mfrac(a, b) {
    return '<m:f><m:fPr>' + ctrl() + '</m:fPr><m:num>' + a + '</m:num>'
         + '<m:den>' + b + '</m:den></m:f>';
  }
  function msup(a, b) {
    return '<m:sSup><m:sSupPr>' + ctrl() + '</m:sSupPr><m:e>' + a + '</m:e>'
         + '<m:sup>' + b + '</m:sup></m:sSup>';
  }
  function msub(a, b) {
    return '<m:sSub><m:sSubPr>' + ctrl() + '</m:sSubPr><m:e>' + a + '</m:e>'
         + '<m:sub>' + b + '</m:sub></m:sSub>';
  }
  // x_1^2 这种上下标都有的，得用 sSubSup；套两层出来会歪
  function msubsup(a, sub, sup) {
    return '<m:sSubSup><m:sSubSupPr>' + ctrl() + '</m:sSubSupPr><m:e>' + a + '</m:e>'
         + '<m:sub>' + sub + '</m:sub><m:sup>' + sup + '</m:sup></m:sSubSup>';
  }
  function mdelim(a, ch) {
    ch = ch || '|';
    return '<m:d><m:dPr><m:begChr m:val="' + esc(ch) + '"/><m:endChr m:val="' + esc(ch) + '"/>'
         + ctrl() + '</m:dPr><m:e>' + a + '</m:e></m:d>';
  }
  function msqrt(a, deg) {
    return '<m:rad><m:radPr>' + (deg ? '' : '<m:degHide m:val="1"/>') + ctrl()
         + '</m:radPr><m:deg>' + (deg || '') + '</m:deg><m:e>' + a + '</m:e></m:rad>';
  }
  // 循环小数 `0.1\overline{6}`；初中卷子上有，不给它会原样吐出 \overline
  function mbar(a) {
    return '<m:bar><m:barPr><m:pos m:val="top"/>' + ctrl()
         + '</m:barPr><m:e>' + a + '</m:e></m:bar>';
  }

  // 初中数学卷子上真会出现的符号。认不出来的命令原样输出命令名，不吞字。
  var SYM = {
    times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·',
    le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
    approx: '≈', equiv: '≡', sim: '∽', cong: '≌', propto: '∝',
    pi: 'π', alpha: 'α', beta: 'β', theta: 'θ', omega: 'ω',
    angle: '∠', triangle: '△', parallel: '∥', perp: '⊥',
    because: '∵', therefore: '∴', in: '∈', notin: '∉',
    subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', varnothing: '∅',
    infty: '∞', circ: '°', degree: '°',
    to: '→', rightarrow: '→', longrightarrow: '→', leftrightarrow: '↔',
    Rightarrow: '⇒', Leftrightarrow: '⇔',
    ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱',
    quad: ' ', qquad: '  ', ',': ' ', ';': ' ', '!': '',
    '%': '%', '&': '&', '#': '#', '{': '{', '}': '}', '_': '_', '$': '$',
    left: '', right: '', ' ': ' '
  };

  var SPECIAL = '\\{}^_';

  // 取一个分组：{...} 或单个原子
  function grp(s, i) {
    if (s[i] === '{') { var r = seq(s, i + 1, '}'); return [r[0], r[1] + 1]; }
    return atom(s, i);
  }

  // 读一个命令名（\ 后面那串字母）
  function cmdName(s, i) {
    var j = i + 1;
    if (!/[A-Za-z]/.test(s[j] || '')) return [s[j] || '', j + 1];   // \% 这种单字符
    while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
    var name = s.slice(i + 1, j);
    // ★ 字母命令后面的**一个**空格是分隔符，不是内容——这是 LaTeX 的规矩
    //   （`\pi x` 渲染成 `πx`，`\angle A` 渲染成 `∠A`）。
    //   不吞掉它，`$\angle A=90^\circ$` 就会多出一个空格，量具抓到了。
    //   只吞一个：`\pi  x` 里第二个空格是心想打的，留着。
    if (s[j] === ' ') j++;
    return [name, j];
  }

  function atom(s, i) {
    if (i >= s.length) return ['', i];

    if (s[i] === '\\') {
      var c = cmdName(s, i), name = c[0], j = c[1];

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        var a = grp(s, j); var b = grp(s, a[1]);
        return [mfrac(a[0], b[0]), b[1]];
      }
      if (name === 'sqrt') {
        var deg = '';
        if (s[j] === '[') {                       // \sqrt[3]{x}
          var e = s.indexOf(']', j);
          if (e > 0) { deg = mrun(s.slice(j + 1, e), false); j = e + 1; }
        }
        var r = grp(s, j);
        return [msqrt(r[0], deg), r[1]];
      }
      if (name === 'abs' || name === 'lvert' || name === 'rvert') {
        var v = grp(s, j); return [mdelim(v[0], '|'), v[1]];
      }
      if (name === 'overline' || name === 'bar') {
        var w = grp(s, j); return [mbar(w[0]), w[1]];
      }
      if (name === 'text' || name === 'mathrm' || name === 'operatorname') {
        var t = grp(s, j);
        // 文字里的字原样取出来（grp 已经编成了 m:r，这里重新包一层正体）
        return [t[0], t[1]];
      }
      if (Object.prototype.hasOwnProperty.call(SYM, name)) {
        return [mrun(SYM[name], false), j];
      }
      // 认不出来的命令：把名字当字面量放回去，别吞
      return [mrun('\\' + name, false), j];
    }

    if (s[i] === '{') { var g = seq(s, i + 1, '}'); return [g[0], g[1] + 1]; }

    // 一串普通字符，撞到特殊符号就停
    var k = i;
    while (k < s.length && SPECIAL.indexOf(s[k]) < 0) k++;
    // ★ 第三个格子是**这串字面量本身**，给 seq 用的：
    //   上下标只绑紧挨着的那一个字符，`a_1+a_2` 里的 `_` 该绑旁边的 `a`，
    //   可这一串扫出来是 `+a`。不把原文带出去，seq 就没法把它拆开。
    return [mrun(s.slice(i, k)), k, s.slice(i, k)];
  }

  function seq(s, i, end) {
    var parts = [];
    while (i < s.length && (end === undefined || s[i] !== end)) {
      var a = atom(s, i), node = a[0], j = a[1];

      // ★ 拆串：普通字面量后面紧跟 ^ 或 _ 时，**最后一个字符才是底**。
      //   实测踩到的：`a_{1}+a_{2}` 第二个底出成了 `+a`（下标挂到了加号上）。
      //   光看"生成了几个 m:sSub"是看不出来的——数字对，结构错。
      if ((s[j] === '^' || s[j] === '_') && a[2] && a[2].length > 1) {
        parts.push(mrun(a[2].slice(0, -1)));
        node = mrun(a[2].slice(-1));
      }

      // 紧跟的 ^ 和 _（可能两个都有）
      var sup = null, sub = null, moved = true;
      while (moved) {
        moved = false;
        if (s[j] === '^' || s[j] === '_') {
          var op = s[j];
          var g = grp(s, j + 1);
          if (op === '^') sup = g[0]; else sub = g[0];
          j = g[1]; moved = true;
        }
      }
      if (sup !== null && sub !== null) node = msubsup(node, sub, sup);
      else if (sup !== null) node = msup(node, sup);
      else if (sub !== null) node = msub(node, sub);

      parts.push(node);
      if (j === i) break;                     // 保险：不许原地打转
      i = j;
    }
    return [parts.join(''), i];
  }

  // $...$ 之间的内容 → <m:oMath> 字符串
  function math(inner) {
    var r = seq(String(inner), 0);
    return '<m:oMath ' + MNS + '>' + r[0] + '</m:oMath>';
  }

  // ============================================================
  //  一段带 $...$ 的话 → Word 段落里该有的那串元素
  // ============================================================
  // 返回 '<w:r>文字</w:r><m:oMath>公式</m:oMath><w:r>文字</w:r>…'
  // ★ 行内公式就长这样：`<m:oMath>` 直接当 `<w:p>` 的孩子，不另包 `<w:r>`。
  //
  // rprXml 传段落自己的 `<w:rPr>`（从模板里抄来的），这样字体字号跟着模板走。
  function runs(text, rprXml) {
    var out = [];
    var s = String(text == null ? '' : text);
    var re = /\$([^$]+)\$/g, at = 0, m;
    function textRun(t) {
      if (t === '') return;
      out.push('<w:r>' + (rprXml || '') + '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>');
    }
    while ((m = re.exec(s))) {
      textRun(s.slice(at, m.index));
      out.push(math(m[1]));
      at = m.index + m[0].length;
    }
    textRun(s.slice(at));
    return out.join('');
  }

  // 只要还有没闭合的 $，就是不完整的，别往文档里塞
  function balanced(text) {
    return ((String(text).match(/\$/g) || []).length % 2) === 0;
  }

  return {
    math: math, runs: runs, balanced: balanced, esc: esc,
    MNS: MNS,
    // ★ 符号表也给出去：右栏预览要把同一段 LaTeX 渲染成 HTML，
    //   两处各维护一份符号表迟早会对不上（\pm 在 Word 里是 ±、预览里成了字母）。
    //   **同一个字面量只许有一处定义**。
    SYM: SYM,
    // 给测试和 produce.js 用的中间件
    frac: mfrac, sup: msup, sub: msub, sqrt: msqrt, delim: mdelim, run: mrun
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.omml;
