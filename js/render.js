// 渲染：把模型的回复拆成三样东西——正文、画板命令、可选回答。
//
// 流式当中围栏是半截的，这里必须处理"还没闭合"的情况，
// 否则学生会在屏幕上看见 ```ggb 一闪一闪的中间态。
var SR = (window.SR = window.SR || {});

SR.render = (function () {

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- 拆围栏 ----
  // 返回 {visible, ggb:[], say:[], pending}
  //   visible —— 能给学生看的正文（围栏已经摘掉）
  //   ggb     —— 已经闭合的画板命令块（每块是若干行）
  //   say     —— 已经闭合的"猜他想说"块
  //   pending —— 后半截还没闭合的围栏原文，**不要显示**，等它闭合
  // opts.stripAssign —— 多删一档"整行就是一条画板赋值"的行（见规则三）。
  //   备课／讲评工位开、画图／出题工位关（SR.WORKS[x].stripAssign）。
  function parseFences(text, opts) {
    var ggb = [], say = [], mat = [];
    var stripAssign = !!(opts && opts.stripAssign);
    var visible = String(text == null ? '' : text);

    // 先摘掉闭合的三个专用围栏
    //   ggb  → 画板命令
    //   想说  → 气泡下面那三个可点的选项
    //   材料  → 一整份卷子（出材料工位专用，一行一段，见 js/prompt-material.js）
    // ★ 三者都是"围栏里是给机器看的、围栏外是给人看的"。
    //   材料这一档尤其要摘干净：一份卷子两百来行，留在正文里会把对话刷没。
    visible = visible.replace(/```[ \t]*(ggb|想说|材料)[ \t]*\r?\n([\s\S]*?)```/g,
      function (all, tag, body) {
        if (tag === 'ggb') ggb.push(body);
        else if (tag === '想说') say.push(body);
        else mat.push(body);
        return '';
      });

    // 剩下的反引号如果成不了对，最后那截就是半截围栏——藏起来
    var pending = '';
    var parts = visible.split('```');
    if (parts.length % 2 === 0) {                  // 奇数个标记 → 有一个没闭合
      pending = '```' + parts[parts.length - 1];
      visible = parts.slice(0, -1).join('```');
    }
    visible = visible.replace(/`{1,2}$/, '');      // 末尾可能只到了一两个反引号

    // ★ 免费通道的 glm-4.1v-thinking-flash 会把整段回复包进 <answer>…</answer>
    //   （2026-10-01 实测：正文本身完全正确——"这道题你当时是怎么做的？从第一步开始说。"——
    //    就是外面多套了一层标签。提示词里明写了不许用标签，它照用，学生就会看见尖括号）。
    //   这里只剥这几个固定的包装名。**别写成"去掉所有尖括号内容"**：
    //   数学里 a < b、x > 0 是真会出现的，那样会连题目一起吃掉。
    //   <think> 不在这儿管——那个在 api.js 的 makeStripper 里整段丢，层级更早。
    visible = visible.replace(/<\/?(answer|response|reply|output)\s*>/gi, '');

    // ★ 模型会把提示词里的**内部编号**念给学生听。
    //   实测（2026-10-01 DeepSeek，学生说"我画不出来"那一轮）：
    //     "按办法三，先把空数轴给你。你自己把题目里的数标上去…"
    //   ——"办法三"是提示词里那三条规矩的编号（办法一/二/三），学生根本不知道这是什么。
    //   这跟"念叨"是一路毛病：它在跟提示词说话，不是跟学生说话。
    //   只删**带编号又紧跟标点**的那种半截插入语（长得像括号里的话）：
    //     "按办法三，先把空数轴给你。" → "先把空数轴给你。"
    //   ⚠ 千万别写成"见到办法/台阶就删"——老师正说"我们走到第五台阶"是正常话，
    //     所以非得"后面跟着标点"，或者"整条回复就停在编号上"才动手。
    visible = visible
      .replace(/(?:按|用|照)?(?:办法|台阶)[一二三四五六七八九十\d]+\s*[，,：:]\s*/g, '')
      .replace(/(?:按|用|照)(?:办法|台阶)[一二三四五六七八九十\d]+\s*[。.!！?？]?\s*$/g, '');

    // ★ 标签掉了、内容还在：模型把围栏标签写成光秃秃一个"想说"。
    //   实测（DUMP=1 node test/probe_fence.cjs 6 glm 求画数轴，掉围栏那 5 条里有 2 条是这个形状）：
    //     #清空 ⏎ 数轴 ⏎ 想说 ⏎ 我想知道数轴上左边和右边的数谁大 ⏎ 我不确定左边是负数还是正数
    //   后面那两行本来是**按钮上给学生点的话**，现在直挺挺挂在老师气泡底下——
    //   学生读到的是老师在自己答自己的话（跟"回声"是一路坏味道，只是这回没围栏帮忙挡）。
    //   ★ 这不是删一行能了事的：模型其实把该给的都给了，只是没写反引号。
    //     所以**收回来当 想说 用**——标签删掉、后面那几行进 say，按钮照旧出得来。
    //   ⚠ 只敢收"两三行短句"：后面要是拖着一大段话（那多半是正文），就只删标签、内容留着。
    //     宁可显示，也不能把老师的正文吃掉。
    var bl = visible.split('\n'), tagAt = -1;
    for (var bi = 0; bi < bl.length; bi++) {
      if (/^想说[:：]?$/.test(bl[bi].trim())) { tagAt = bi; break; }
    }
    if (tagAt >= 0) {
      var tail = bl.slice(tagAt + 1).map(function (s) { return s.trim(); })
        .filter(Boolean)
        .filter(function (s) { return !/^`{1,}$/.test(s); });   // 尾巴上那个孤零零的 ``` 不算内容
      if (tail.length && tail.length <= 5 && tail.every(function (s) { return s.length <= 40; })) {
        say.push(tail.join('\n'));
        visible = bl.slice(0, tagAt).join('\n');
      }
      // 收不了就走下面的规则一：那一行"想说"自己会被当标签删掉，内容原样留着
    }

    // ★ 掉了围栏的画板命令会**原样念给学生听**（2026-10-01 实测）：
    //   免费通道那颗文字模型守不住围栏，一被要求画图就把命令当正文打出来，
    //   学生那一屏收到的是"#清空 ⏎ 数轴 ⏎ A=(-2,0)"——他根本不知道这是什么。
    //   这里把"单独占一行的画板命令"整行删掉。
    //   ⚠ 只删**整行就是一条命令**的，不做模糊匹配：
    //     老师正文里说"我们在数轴上标出 -2"是完全正常的，那行不能动；
    //     会被删的只有那种顶格一行、前后什么都不带的纯命令。
    // 规则一：整行就是一个开关命令。带参数的两个（`#隐藏 t` / `#播放 t`）
    //   必须**带井号**才算——不带井号的"播放 暂停"这种在中文正文里可能出现，别误伤。
    var RE_MARK0 = /^#?(清空|三维|平面|2D|3D|数轴|坐标系|隐藏|播放|暂停|ggb|想说)$/;
    var RE_MARK1 = /^#(隐藏|播放|暂停)\s+\S+$/;
    // 规则二：整行只有反引号——模型写了个**没带标签的围栏**（实测原话：
    //   "#清空 ⏎ 数轴 ⏎ ``` ⏎ #清空 ⏎ 数轴 ⏎ ``` ⏎ …"）。这种成对反引号骗过了
    //   下面"半截围栏"的判断（成对 → 不算半截），于是两个 ``` 会原样印给学生。
    //   一行反引号没有任何信息量，删掉永远是安全的。
    var RE_TICK = /^`{1,}$/;
    // 规则三：整行就是一条画板赋值（`A=(-2,0)`、`t=Slider(-4,4,0.1)`、`c=正方体(A,B)`）。
    //   ★ 只在 stripAssign 的工位上删（备课／讲评）。那两个工位里模型绝没有理由在正文里
    //     写坐标赋值，出现必是掉围栏；画图／出题不一样——那两处的正文本来就该有式子，
    //     一行 "y=(x+1)(x-2)" 是正常内容，不能动，所以这一档必须按工位分流，不能一刀切。
    //   ⚠ 形状卡死在"等号右边紧跟着括号"上：
    //     "y=2x+1"、"f(x)=2x+1"、"x=3" 都不符合（右边不是括号开头），正文里出现是正常的。
    var RE_ASSIGN = /^[A-Za-z][A-Za-z0-9_]*\s*=\s*[A-Za-z0-9_一-龥]*\s*\(.*\)$/;
    visible = visible.split('\n').filter(function (ln) {
      var s = ln.trim();
      if (RE_MARK0.test(s) || RE_MARK1.test(s)) return false;
      if (RE_TICK.test(s)) return false;
      if (stripAssign && RE_ASSIGN.test(s)) return false;
      return true;
    }).join('\n');

    return { visible: visible.trim(), ggb: ggb, say: say, mat: mat, pending: pending };
  }

  // ---- markdown → 干净 HTML ----
  function md(text) {
    var html;
    if (window.marked && window.DOMPurify) {
      try {
        html = window.marked.parse(text, { breaks: true, gfm: true });
      } catch (e) {
        html = esc(text).replace(/\n/g, '<br>');
      }
      // 必须真的过一遍 DOMPurify——模型吐的是不可信文本。
      html = window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
    } else {
      html = esc(text).replace(/\n/g, '<br>');
    }
    return html;
  }

  // ---- 公式：渲在已经净化过的 DOM 上（KaTeX 的输出是本地生成的，可信）----
  function typeset(el) {
    if (!el || !window.renderMathInElement) return;
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      });
    } catch (e) {}
  }

  function renderInto(el, text) {
    el.innerHTML = md(text);
    typeset(el);
  }

  return { esc: esc, parseFences: parseFences, md: md, typeset: typeset, renderInto: renderInto };
})();
