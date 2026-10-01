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

  // 这一段该套哪一档格式（图和字共用同一套判法）。
  function pPrOf(tpl, b) {
    var slots = tpl.slots || [];
    var s = null;
    if (b && typeof b.slot === 'number' && slots[b.slot]) s = slots[b.slot];
    if (!s) s = slots[tpl.bodySlot] || null;
    return s ? (s.pPr || '') : '';
  }

  // ============================================================
  //  图：一段「图片段」怎么排进 Word
  // ============================================================
  // ★ 一切用 **inline**（随文），不用 `wp:anchor`（浮动）。
  //   浮动图那一族坑（锚点在 XML 里的位置跟题目顺序对不上、整表 replace 会把图吞掉、
  //   图挤在同一个空单元格里）全是"图跟文字不在一根绳上"造成的。新文件没这个包袱，
  //   一上来就用 inline，题在哪一段、图就在哪一段，顺序天然绑死。
  //
  // ★ 四个命名空间**就地声明**（wp/a/r/pic）。正常的 Word 模板在 `w:document` 上
  //   已经声明过前三个，但"模板是别人给的"这件事不能赌——就地再声明一遍是合法的 XML，
  //   多写几个字符，换掉"这份模板刚好没声明所以整份打不开"。
  var NS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
         + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
         + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
         + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  // 图上纸多大：**宽高都要卡**，不然一张很宽的图会把版心撑破。
  // 1 cm = 360000 EMU。
  var FIG_MAX_W = 3400000;      // 约 9.4cm —— 版心 15.9cm 的六成，卷子上常见的大小
  var FIG_MAX_H = 2400000;      // 约 6.7cm
  function fitEmu(w, h) {
    var k = Math.min(FIG_MAX_W / w, FIG_MAX_H / h, 1);
    return [Math.round(w * k), Math.round(h * k)];
  }

  function figPara(tpl, b, media) {
    var m = media && b.fig != null ? media[SR.figures.key(b.fig)] : null;
    // 图没画出来 → 这一段**什么都不排**。调用方（js/material.js）会把这一行撤掉
    // 并告诉老师，所以这里不会出现"纸上留一个空洞"。
    if (!m) return '';
    var d = fitEmu(m.cx, m.cy);
    var pPr = pPrOf(tpl, b);
    // 图默认居中：模板里那一档多半是"题干"的左对齐，图跟着左对齐会贴着版心边。
    // 只在模板没写对齐的时候补，模板自己说了算。
    if (!/w:jc /.test(pPr)) pPr = pPr.replace(/<w:pPr>/, '<w:pPr><w:jc w:val="center"/>');
    var id = m.id;
    return '<w:p>' + pPr + '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" ' + NS + '>'
      + '<wp:extent cx="' + d[0] + '" cy="' + d[1] + '"/>'
      // 缩放范围：不给的话老版本 Word 拖动时会变形
      + '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
      + '<wp:docPr id="' + id + '" name="数根配图' + id + '"/>'
      + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
      + '<pic:pic>'
      + '<pic:nvPicPr><pic:cNvPr id="' + id + '" name="mathroot' + id + '.png"/>'
      + '<pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>'
      + '<pic:blipFill><a:blip r:embed="' + m.relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
      + '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + d[0] + '" cy="' + d[1] + '"/></a:xfrm>'
      + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
      + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }

  // ============================================================
  //  装包：模板整包原样搬，只换 word/document.xml
  // ============================================================
  // ★ 图一进来，要动的就不止 document.xml 了（同族两处"Word 说文件损坏"：
  //   新图没在 rels 里注册、png 没在 Content_Types 里登记）。
  //   三样一起改，少一样那份文件就是打不开：
  //     ① word/media/<新名字>.png      —— 图片字节本身
  //     ② word/_rels/document.xml.rels —— rId ↔ 图片文件 的对应
  //     ③ [Content_Types].xml          —— 扩展名 png 的 Default 项
  //   名字一律避开模板里已经有的（模板自己可能就有 image1.png 当校徽）。
  function planMedia(files, blocks) {
    var figs = [];
    (blocks || []).forEach(function (b) {
      if (b && b.fig) {
        var m = SR.figures && SR.figures.get(b.fig);
        if (m) figs.push({ key: SR.figures.key(b.fig), m: m });
      }
    });
    if (!figs.length) return null;

    // —— 已经在包里的文件名（避免撞名）——
    var used = {};
    files.forEach(function (f) { used[f.name] = 1; });

    var relsName = 'word/_rels/document.xml.rels';
    var rels = null;
    for (var i = 0; i < files.length; i++) if (files[i].name === relsName) rels = files[i];
    var relsXml = rels ? SR.docx.str(rels.data) : '';

    // 已用过的 rId 号，从最大的往后发
    var maxId = 0, mm;
    var re = /Id="rId(\d+)"/g;
    while ((mm = re.exec(relsXml))) maxId = Math.max(maxId, +mm[1]);

    var media = {}, added = [], n = 0;
    figs.forEach(function (f) {
      if (media[f.key]) return;                     // 同一张图用两次：一份字节、一个 rId
      n++;
      var name = 'word/media/mathroot' + n + '.png';
      while (used[name]) { n++; name = 'word/media/mathroot' + n + '.png'; }
      used[name] = 1;
      var id = ++maxId;
      media[f.key] = { relId: 'rId' + id, id: 1000 + n, cx: f.m.w * 9525, cy: f.m.h * 9525 };
      // px → EMU 用 9525（96dpi）。**必须按 PNG 自己的像素算**：
      // 画板导出的是 2 倍图，按"画板 CSS 尺寸"算会缩成一半，纸上图变小一圈。
      added.push({ name: name, data: f.m.png });
      media[f.key].part = name;
      media[f.key].rid = id;
    });

    // —— ② rels ——
    var addRel = Object.keys(media).map(function (k) {
      var m = media[k];
      return '<Relationship Id="' + m.relId
           + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"'
           + ' Target="' + m.part.replace(/^word\//, '') + '"/>';
    }).join('');
    if (relsXml) {
      relsXml = relsXml.replace(/<\/Relationships>\s*$/, addRel + '</Relationships>');
    } else {
      // 模板居然没有 rels？补一份最小的。正常 Word 文件不会走到这儿。
      relsName = 'word/_rels/document.xml.rels';
      relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
              + addRel + '</Relationships>';
    }

    // —— ③ Content_Types ——
    var ctName = '[Content_Types].xml', ct = null;
    for (var j = 0; j < files.length; j++) if (files[j].name === ctName) ct = files[j];
    var ctXml = ct ? SR.docx.str(ct.data) : '';
    if (ctXml && !/Extension="png"/i.test(ctXml)) {
      ctXml = ctXml.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>');
    }

    return { media: media, files: [
      { name: relsName, data: SR.docx.bytes(relsXml) },
      { name: ctName, data: SR.docx.bytes(ctXml) }
    ].concat(added) };
  }

  function buildXml(tpl, blocks, media) {
    var mid = (blocks || []).map(function (b) {
      return (b && b.fig) ? figPara(tpl, b, media) : blockPara(tpl, b);
    }).join('');
    var body = (tpl.head || []).join('') + mid + (tpl.keepTail || []).join('');
    return tpl.bodyHead + body + tpl.bodyFoot;
  }

  function build(tpl, blocks) {
    var files = (tpl.pack || []).map(function (f) { return { name: f.name, data: f.data }; });
    // 先规划好图（名字、rId、尺寸），再生成正文——正文里要引用 rId。
    var plan = planMedia(files, blocks);
    var xml = buildXml(tpl, blocks, plan ? plan.media : null);
    files = SR.docx.replace(files, 'word/document.xml', SR.docx.bytes(xml));
    // ★ 走 replace，**不是 concat**：rels 和 [Content_Types].xml 模板里本来就有，
    //   直接往后追加会变成同一个名字两条记录（zip 里允许，Word 打开就是"文件损坏"）。
    //   replace 是"有就换掉、没有才追加"，图片那几条新名字自然落到末尾。
    if (plan) plan.files.forEach(function (u) { files = SR.docx.replace(files, u.name, u.data); });
    return SR.docx.write(files);
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
      if (m) {
        // ★ 一行要图：`#6 [图] 数轴; A=(-2,0); B=(3,0)`
        //   带 `#号`（图排在模板的哪一档格式里，一般是居中的那一档），
        //   后面是画板认的中文命令——**跟「画图」工位同一套方言**，
        //   模型在那边已经会写了，这儿不用另教一种。
        //   识别只认**行首的 `[图]`**，宁可严一点：正文里偶尔出现"图"字很常见，
        //   认宽了会把老师的正文变成一张图。
        var fm = /^\[图\]\s*(.*)$/.exec(m[2]);
        if (fm) {
          // ⚠ 这里只能用 `return`，不能用 `continue`——外头那层是 `forEach` 的**回调**，
          //   不是循环体。写成 `continue` 整个文件直接 SyntaxError（2026-10-01 实测：
          //   站点整个白掉，因为 produce.js 一行都执行不了，比"图插不进去"严重得多）。
          if (fm[1].trim()) out.push({ slot: +m[1], fig: fm[1].trim(), text: '' });
          return;                                    // `[图]` 后面什么都没有 → 当空行丢掉
        }
        out.push({ slot: +m[1], text: m[2] });
      } else out.push({ slot: null, text: s.trim() });   // 漏了编号 → 落回正文格式
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

  // 一段文字有几行（空行不算）。
  function lineCount(s) {
    if (!s) return 0;
    var a = String(s).split(/\r?\n/), n = 0;
    for (var i = 0; i < a.length; i++) if (a[i].trim()) n++;
    return n;
  }

  // ============================================================
  //  这一轮右栏该摆哪一份？（两条来源比厚度）
  // ============================================================
  // ★★ 为什么要有这个函数（2026-10-02 实测，免费通道 glm-4.6v-flash）：
  //   原来那一档的判据是"**没有围栏才捡**"（`!p.mat.length`）。模型绕过去了，
  //   而且绕得很难看——它把整份材料写了**三遍**：
  //     ① 光着写十几行 `#0 … #2 …`（没有围栏）
  //     ② 开一个 ```材料 围栏，里面**只放那一行 [图]**（围栏有了，旧判据不成立）
  //     ③ 再把整份重写一遍
  //   于是：气泡把十几行 `#0 第五周 周练卷` 原样印出来（最难看的那个坏法），
  //   右栏只摆出一张光图（"最后闭合的围栏"正好是那一行 [图]），卷子一道题都没有——
  //   文件名还写着"出一份第五周的周练卷….docx"。
  //
  //   新判据：**两条来源都拿出来比一比，谁厚用谁**（按行数）。
  //   `rest` 那一项跟用不用它无关——**编号行永远不许留在气泡里**。
  //
  // ★ 为什么单独做成一个纯函数：触发它的那种回复**不是每次都能碰上的**
  //   （同一句要求，下一次它就规规矩矩只写一个围栏了）。靠重跑模型去碰，
  //   碰不到就等于没验过。做成纯函数，就能拿当时那份原文当样本反复验。
  function pickSource(visible, fenced) {
    var lf = lift(visible);
    var useLift = lf.n >= LIFT_MIN && lf.n > lineCount(fenced);
    var from = useLift ? 'lift' : (fenced ? 'fence' : '');
    return {
      // ★ 拿掉编号行的条件：**我确实把这些行收走了**（要么捡进了右栏，要么围栏那一份顶着）。
      //   收都不收还把它们从气泡里抹掉，结果是**气泡整个空掉**——
      //   老师看到的是一句回复都没有，右栏也没有东西。那比看见两行 `#2 …` 糟得多。
      //   （实测边界：模型只写一两行编号、又没开围栏，就会走到这儿。）
      rest: from ? lf.rest : visible,                  // 气泡里该显示的文字
      n: lf.n,
      from: from,
      body: useLift ? lf.body : (fenced || '')
    };
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
      if (b && b.fig) {
        // 要图的那一行，只判一件事：**图有没有画出来**。
        if (!(SR.figures && SR.figures.get(b.fig))) {
          bad.push({ at: i, why: '这一处要的图还没画出来：' + String(b.fig).slice(0, 24) });
        }
        return;
      }
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
      // 要图的那一行：画好了就把**同一张 PNG**摆出来（跟塞进 docx 的是同一份字节，
      // 所以"预览里看着对、下载下来不一样"不会发生）；没画好就摆一句实话。
      if (b && b.fig) {
        var f = SR.figures && SR.figures.get(b.fig);
        return '<div class="pv-fig">' + (f
          ? '<img src="' + f.url + '" alt="配图">'
          : '<span class="pv-figwait">图还没画出来</span>') + '</div>';
      }
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
    pickSource: pickSource, lineCount: lineCount,
    previewHtml: previewHtml, inlineHtml: inlineHtml, paraXml: paraXml
  };
})();

if (typeof module === 'object' && module.exports) module.exports = SR.produce;
