// 「数根」——**出材料**。把模型产出的结构化内容，装进老师上传的那份模板里。
//
// 一句话：**继承版式，重写正文。**
//   styles / 字体表 / 主题 / 页眉页脚 / media（校徽）/ Content_Types / rels
//     → 从模板包里**原样搬运，一个字节都不动**
//   word/document.xml
//     → 只换这一条：抬头区留着，正文换成新出的，末尾 sectPr 留着
//
// ★ 为什么这么做，而不是"新建一个 Word 文档再把格式调成一样"：
//   模板里那些**内容**的东西——OMML 公式、wp:anchor 浮动校徽、WMF、OLE——
//   一个都不用碰，因为它们是内容、本来就要换掉；而**版式**的东西原样搬，
//   就不存在"我猜你学校的页边距是多少"这种事。实测在四份来源完全不同的模板上都成立
//   （导学案 / 周练卷 / 运算 / 论文模板），Word 打开正常、版式一致。
//
// ★ 内容的形状（模型交回来的东西）：一串"段"。
//     { slot: 2, text: '1．计算 $\\frac{1}{2}+\\frac{1}{3}$ 的结果是（    ）' }
//     { slot: 5, text: '' }        ← 空段，用模板自己的空段格式
//   `slot` 是模板里第几种"段落格式"（见 tpl.js 投票选出来的那份清单）。
//   **模型只能从见过的号里挑**，前端照着号把模板原来的 pPr 套回去——
//   换一份模板，这个文件一行都不用改。
var SR = (window.SR = window.SR || {});

SR.produce = (function () {

  // ============================================================
  //  一段 → <w:p>
  // ============================================================
  // ★ 行距那一处**故意不照抄模板**：模板的正文行距是"固定值 18pt"
  //   （`w:lineRule="exact"`），而 Word 在固定行距下会把**超出行高的一律裁掉**——
  //   12pt 的分数高约 29pt，一行的分母就被齐齐切掉半截（孔老师截图那次）。
  //   含公式的那一行换成 `atLeast`（最小值）：正文一行本来就撑不满 18pt，
  //   **间距一个字不变**；只有装公式的那行会长高到刚好装下。
  //   不含公式的段一个字不动，模板的节奏原样保留。
  function relaxLine(pPr) {
    return pPr.replace(/(<w:spacing\b[^>]*?)w:lineRule="exact"/, '$1w:lineRule="atLeast"');
  }

  function paraXml(pPr, rPr, text) {
    var p = pPr || '';
    var t = String(text == null ? '' : text);
    if (t.indexOf('$') >= 0) p = relaxLine(p);
    return '<w:p>' + p + (t ? SR.omml.runs(t, rPr) : '') + '</w:p>';
  }

  // 把 blocks 里的一段翻成 XML。slot 越界 / 没给 → 落回模板的正文格式。
  function blockPara(tpl, b) {
    var text = b && b.text != null ? String(b.text) : '';
    var slots = tpl.slots || [];

    // 空段：模板的空段格式是单独投出来的。
    // 模板就是靠这种空段把题干和选项拉开的，拿正文格式去顶空段，间距会比模板高一半。
    if (!text) return '<w:p>' + (tpl.blankPPr || '') + '</w:p>';

    var s = null;
    if (b && typeof b.slot === 'number' && slots[b.slot]) s = slots[b.slot];
    if (!s) s = slots[tpl.bodySlot] || null;
    if (!s) return paraXml('', tpl.bodyRPr || '', text);

    return paraXml(s.pPr, s.rPr || tpl.bodyRPr || '', text);
  }

  // ============================================================
  //  装包：模板整包原样搬，只换 word/document.xml
  // ============================================================
  function buildXml(tpl, blocks) {
    var mid = (blocks || []).map(function (b) { return blockPara(tpl, b); }).join('');
    var body = (tpl.head || []).join('') + mid + (tpl.keepTail || []).join('');
    return tpl.bodyHead + body + tpl.bodyFoot;
  }

  function build(tpl, blocks) {
    var xml = buildXml(tpl, blocks);
    var files = (tpl.pack || []).map(function (f) { return { name: f.name, data: f.data }; });
    return SR.docx.write(SR.docx.replace(files, 'word/document.xml', SR.docx.bytes(xml)));
  }

  function save(tpl, blocks, filename) {
    SR.docx.save(build(tpl, blocks), filename || (tpl.name || '材料').replace(/\.docx$/i, '') + '.docx');
  }

  // ============================================================
  //  ```材料 围栏 → blocks
  // ============================================================
  // 围栏里的写法（见 js/prompt-material.js）：**一行一段**，行首 `#号` 是格式号。
  //
  // ★ 为什么是"行首编号"而不是 JSON：
  //   一份周练卷两百来行，JSON 里任何一个引号/逗号错掉，整份全废、而且没法只重试一截；
  //   行首编号**坏一行只坏一行**——漏写编号的那行落回正文格式，其余照排。
  //   实测模型守这个格式比守 JSON 稳得多（它见过大量"行首打标记"的语料）。
  //   ★ 这条跟"出材料"是同一族：**要它每行都做同一件事，就把它写在最末尾、给成样子**。
  //
  // ⚠ 不在这儿判"这行像不像题目"。判不了，也不必判——格式号越界由 check() 报出来。
  function parseBlocks(text) {
    var out = [];
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (ln) {
      var s = ln.replace(/\s+$/, '');
      if (!s.trim()) return;                       // 空行不单独成段：模板自己的空段格式要显式写 `#号`
      var m = /^\s*[#＃]\s*(\d+)\s?(.*)$/.exec(s);
      if (m) out.push({ slot: +m[1], text: m[2] });
      else out.push({ slot: null, text: s.trim() });   // 漏了编号 → 落回正文格式
    });
    return out;
  }

  // ============================================================
  //  本地兜底：围栏掉了，把编号行捡回来
  // ============================================================
  // ★★ 为什么必须有这一档（2026-10-01 实测，免费通道 glm-4.6v-flash）：
  //   同一个提示词、同一句要求，DeepSeek 规规矩矩写了 ```材料 围栏，
  //   **GLM 把围栏丢了**——`#0 某某中学… ＃#2 一、选择题…` 三十几行
  //   直挺挺倒在对话里。老师那一屏读到的是"#0 #2 #1"这种鬼东西，
  //   右栏一个产物都没有。**这正是产品最丢脸的一种坏法。**
  //
  //   道理跟 board.js 里 giveBlank 那一段一模一样：
  //   **凡是在免费通道上守不住的，都得有本地兜底兜着。**
  //   而这一档的兜底特别稳——`#数字` 顶格开头，在任何中文正文里都不可能是别的东西。
  //
  // ★ 两件事分开：
  //   **拆**（哪些行是编号行）永远是确定的，所以 lift 每次都拆，
  //   拆出来的行**绝不印到气泡上**——晚一步处理，老师就已经看见那串鬼东西了；
  //   **当材料收下**才需要门槛：至少 LIFT_MIN 行。
  //   单独一行 `#2` 说明不了什么，**收错比漏收贵**（可能把老师的正文吃进右栏）。
  //   一份卷子真掉了围栏，捡回来的是几十行，这个门槛碰不到它。
  var LIFT_MIN = 3;
  function lift(text) {
    var s = String(text == null ? '' : text);
    var got = [], keep = [];
    s.split(/\r?\n/).forEach(function (ln) {
      if (/^\s*[#＃]\s*\d+(\s|$)/.test(ln)) got.push(ln);
      else keep.push(ln);
    });
    return { body: got.join('\n'), rest: keep.join('\n'), n: got.length };
  }

  // ============================================================
  //  归档前过一道闸：不许悄悄出一份残的
  // ============================================================
  // 模型给的东西可能缺胳膊少腿。这里只把**能判的**判掉，判不了的不管——
  // ★ 别在这儿发明"看起来像不像一份卷子"这种判据，那是"检测脚本的数字不是它宣称的那件事"那一族。
  function check(tpl, blocks) {
    var bad = [];
    if (!blocks || !blocks.length) bad.push({ at: -1, why: '一个段都没有' });
    (blocks || []).forEach(function (b, i) {
      var t = b && b.text != null ? String(b.text) : '';
      if (!t) return;
      if (!SR.omml.balanced(t)) bad.push({ at: i, why: '这一段的 `$` 没配对：' + t.slice(0, 30) });
      if (b.slot === null || b.slot === undefined) {
        // 漏写编号是**允许**的降级（落回正文格式），但这句得说出来——
        // 一份卷子的标题要是漏了编号，排出来就是正文的样子，老师得知道去哪儿找。
        bad.push({ at: i, why: '这一行没写格式号，按正文排的：' + t.slice(0, 20) });
      } else if (typeof b.slot !== 'number' || !(tpl.slots || [])[b.slot]) {
        bad.push({ at: i, why: '格式号 ' + b.slot + ' 不在模板里，会落回正文格式：' + t.slice(0, 20) });
      }
    });
    return bad;
  }

  // ============================================================
  //  右栏预览：拿同一串 LaTeX 渲染成 HTML
  // ============================================================
  // ★ 不是去反解 docx（那是另一个大工程，且没必要），而是**用生成时的中间结构**渲染。
  //   预览跟产物用的是同一份 blocks，所以"预览里看着对、下载下来不对"这种事不会发生
  //   ——除非是我这段 HTML 渲染自己跟 OMML 不一致，那是这函数的问题，不是内容的问题。
  //
  // ★ 符号表从 omml.js 借（`SR.omml.SYM`）。两处各维护一份，迟早会出现
  //   "Word 里是 ±、预览里是字母"这种对不上。
  function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function texHtml(s) {
    var SYM = SR.omml.SYM || {};
    var out = '', i = 0;
    function grp() {                       // 读一个 {…} 或单个原子
      if (s[i] === '{') {
        var d = 1, j = i + 1, st = j;
        while (j < s.length && d > 0) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; }
        var r = s.slice(st, j - 1); i = j; return r;
      }
      var c = s[i] === '\\' ? (s.slice(i).match(/^\\[A-Za-z]+|^\\[^A-Za-z]/) || [''])[0] : s[i];
      i += c.length; return c;
    }
    function body(inner) { return texHtml(inner); }
    while (i < s.length) {
      var ch = s[i];
      if (ch === '\\') {
        var m = s.slice(i).match(/^\\([A-Za-z]+)/);
        if (m) {
          var name = m[1]; i += m[0].length;
          if (s[i] === ' ') i++;                       // 字母命令后的一个空格是分隔符
          if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
            var a = body(grp()), b = body(grp());
            out += '<span class="fr"><span class="n">' + a + '</span><span class="d">' + b + '</span></span>';
          } else if (name === 'sqrt') {
            var deg = '';
            if (s[i] === '[') { var e = s.indexOf(']', i); deg = s.slice(i + 1, e); i = e + 1; }
            out += '<span class="sq">√<i>' + (deg ? '<sup>' + esc(deg) + '</sup>' : '') + '</i></span>'
                 + '<span class="rad">' + body(grp()) + '</span>';
          } else if (name === 'overline' || name === 'bar') {
            out += '<span class="ov">' + body(grp()) + '</span>';
          } else if (name === 'abs' || name === 'lvert' || name === 'rvert') {
            out += '|' + body(grp()) + '|';
          } else if (name === 'text' || name === 'mathrm' || name === 'operatorname') {
            out += esc(grp());
          } else if (Object.prototype.hasOwnProperty.call(SYM, name)) {
            out += esc(SYM[name]);
          } else {
            out += esc('\\' + name);                   // 认不出来的原样放回，不吞字
          }
          continue;
        }
        i += 2; continue;                              // \% \{ 这种
      }
      if (ch === '^' || ch === '_') {
        i++;
        var g = body(grp());
        out += ch === '^' ? '<sup>' + g + '</sup>' : '<sub>' + g + '</sub>';
        continue;
      }
      if (ch === '{') { out += body(grp()); continue; }
      out += esc(ch); i++;
    }
    return out;
  }

  // 一段文字（含 $…$）→ HTML。`$` 没配对就整段当普通文字，别把半截公式渲染出来。
  function inlineHtml(text) {
    var s = String(text == null ? '' : text);
    if (!SR.omml.balanced(s)) return esc(s);
    var out = '', at = 0, re = /\$([^$]+)\$/g, m;
    while ((m = re.exec(s))) {
      out += esc(s.slice(at, m.index));
      out += '<span class="mth">' + texHtml(m[1]) + '</span>';
      at = m.index + m[0].length;
    }
    out += esc(s.slice(at));
    return out;
  }

  // 预览页：照模板的段落格式，给每段套上 class，让右栏"看着像那张卷子"。
  function previewHtml(tpl, blocks) {
    var slots = tpl.slots || [];
    var rows = (blocks || []).map(function (b) {
      var t = b && b.text != null ? String(b.text) : '';
      if (!t) return '<div class="pv-blank"><i>&nbsp;</i></div>';
      var s = (typeof b.slot === 'number' && slots[b.slot]) ? slots[b.slot] : slots[tpl.bodySlot];
      var jc = s && /w:jc w:val="(\w+)"/.test(s.pPr) ? /w:jc w:val="(\w+)"/.exec(s.pPr)[1] : 'left';
      var sz = s && /<w:sz w:val="(\d+)"/.exec(s.rPr || '') ? (+(/<w:sz w:val="(\d+)"/.exec(s.rPr)[1]) / 2) : 12;
      var bold = s && /<w:b\/>/.test(s.rPr || '');
      var st = 'text-align:' + (jc === 'center' ? 'center' : jc === 'right' ? 'right' : 'left')
             + ';font-size:' + sz + 'pt' + (bold ? ';font-weight:700' : '');
      return '<div class="pv-p" style="' + st + '">' + inlineHtml(t) + '</div>';
    }).join('');
    return '<div class="pv-page">' + rows + '</div>';
  }

  return {
    build: build, buildXml: buildXml, save: save, check: check,
    parseBlocks: parseBlocks, lift: lift, LIFT_MIN: LIFT_MIN,
    previewHtml: previewHtml, inlineHtml: inlineHtml, paraXml: paraXml
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.produce;
