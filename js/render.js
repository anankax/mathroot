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
    var ggb = [], ggbInfo = [], say = [], mat = [];
    var stripAssign = !!(opts && opts.stripAssign);
    var visible = String(text == null ? '' : text);

    // 先摘掉闭合的三个专用围栏
    //   ggb  → 画板命令
    //   想说  → 气泡下面那三个可点的选项
    //   材料  → 一整份卷子（出材料工位专用，一行一段，见 js/prompt-material.js）
    // ★ 三者都是"围栏里是给机器看的、围栏外是给人看的"。
    //   材料这一档尤其要摘干净：一份卷子两百来行，留在正文里会把对话刷没。
    // ★ 标签后面**那一小截是页名**（```ggb 数轴）。原来这个正则只吃空白，
    //   所以带名字的围栏整个匹配不上——围栏留在正文里，`数轴` 三个字直挺挺
    //   挂在老师的回复里（实测确认过，不是猜的）。右栏多页要拿它当标签名
    //   （js/tabs.js 的 titleFor 第①来源），顺手把这个显示 bug 一起修了。
    //   ⚠ **只有长得像名字的才算名字。** 模型有时候把第一条命令写在标签那一行上
    //     （```ggb A=(0,0)）：当页名吃掉 = 那条命令丢了，而且画板上什么都看不出来、
    //     一声不响。所以带 `= ( ) [ ] # ,` 的一律退回命令、接回 body 里去。
    var NAME = /^[^=()\[\]#,]{1,12}$/;
    visible = visible.replace(/```[ \t]*(ggb|想说|材料)[ \t]*([^\r\n]*)\r?\n([\s\S]*?)```/g,
      function (all, tag, info, body) {
        info = String(info == null ? '' : info).trim();
        if (!NAME.test(info)) {
          if (info) body = info + '\n' + body;   // 不是名字 → 它是内容，还回去
          info = '';
        }
        if (tag === 'ggb') { ggb.push(body); ggbInfo.push(info); }
        else if (tag === '想说') say.push(body);
        else mat.push(body);
        return '';
      });

    // ★★ 2026-10-04 新增：**开头三个反引号掉了的 ggb 围栏**，在这儿捞回来。
    //   免费通道那颗文字模型 glm-4-flash-250414 一被要求画图就写成这样：
    //       ggb            ← 就这一个词，前面没有 ```
    //       #清空
    //       A=(0,0)
    //       线段(A,C)
    //       ```            ← 尾巴上的三个反引号还在
    //   上面那条正则认不出它（它没有开头的 ```），于是这几行一路走到下面
    //   "删掉单独占一行的命令"那一步：`#清空`、`数轴` 被删掉，而 `A=(0,0)`、
    //   `线段(A,C)` 因为这些工位 `stripAssign=false` **原样留在正文里念给老师听**，
    //   画板上**一片空白**——正是提示词里说的"这个工位最糟的失败"。
    //   同一批用例换 DeepSeek 打，围栏一个都不掉、内容也全对，所以这不是提示词的事。
    //   ★ 为什么敢认：整整一行**只有 `ggb` 三个字母**，这种行早就不可能出现在正文里
    //     （下面 RE_MARK0 一直就是按"见到就删"处理的），拿它当块头不会误伤谁。
    //   ⚠ 两道闸都得上，缺一条就会吞掉正经段落：
    //     ① 它的**下一行必须长得像一条画板命令**（以 # 开头 / 是数轴坐标系那几个词 /
    //        是一个 `名字 = …` 赋值）。孤零零一个 ggb 后面跟着大白话，就还是照旧删掉那一行。
    //     ② 块尾**遇到空行就停**。模型的命令块后面一定空一行才接正文，
    //        光认结尾的 ``` 的话，万一那三个反引号也掉了，就会把"画好了。长方形…"
    //        一起吞进画板，老师那句话当场消失。
    var RE_CMD_HEAD = /^(#|数轴|坐标系|三维|平面)/;
    var RE_CMD_ASSIGN = /^[A-Za-z一-龥][A-Za-z0-9_一-龥]*\s*=/;
    var RE_TICKLINE = /^[ \t]*`{3,}[ \t]*$/;
    for (var 轮 = 0; 轮 < 8; 轮++) {
      var 行 = visible.split('\n');
      var 头 = -1;
      for (var i = 0; i < 行.length; i++) {
        if (行[i].trim() !== 'ggb') continue;
        var j = i + 1;
        while (j < 行.length && !行[j].trim()) j++;
        if (j < 行.length) {
          var 首 = 行[j].trim();
          if (RE_CMD_HEAD.test(首) || RE_CMD_ASSIGN.test(首)) { 头 = i; break; }
        }
      }
      if (头 < 0) break;
      var 体 = [], k = 头 + 1;
      for (; k < 行.length; k++) {
        if (RE_TICKLINE.test(行[k])) { k++; break; }
        if (!行[k].trim()) break;
        体.push(行[k]);
      }
      if (体.length) { ggb.push(体.join('\n')); ggbInfo.push(''); 行.splice(头, k - 头); visible = 行.join('\n'); }
      else { 行.splice(头, 1); visible = 行.join('\n'); }
    }

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
    // 规则四：整行是**模型把提示词自己的分档标签抄了回来**。
    //   来历（2026-10-03 实测）：js/prompt-vary.js 末尾那段示范为了让 9B 的小模型
    //   学会"纯式子题不配图"，把示范拆成【有图】【没图】两档、各带一行短标签。
    //   分档**确实管用**——纯式子题一个围栏都不写的比例从 2/15 跳到 17/25（p=1.1e-3），
    //   三条一字不差的空数轴也从 3/15 掉到 0/25（p=0.046）。
    //   可代价是：模型把标签**当成回复的第一个小标题抄了出来**。
    //   25 份存档里 **25 份**，且**每一份都在回复最开头**，一字不落，比如
    //     「【第二种 · 题里没图】解方程、化简求值、代数式求值。每题一段，一个围栏都不写：」
    //   ——老师一打开就看见我写给模型看的内部标签。
    //   ⚠ 差点漏掉：当时尺子只认 `###`，于是###从13/25掉到0/25、我记了"守骨架25/25"。
    //     那不是被治好了，是**换了个抄法**。数字没错，错的是它量的那个东西。
    //   ★ 为什么不改提示词了事：换成同样意思的「★ 句子」形状，抄是没抄袭了（0/15），
    //     可分档也跟着失效（零围栏跌回 2/15）。**模型认的就是这种短方框标签。**
    //     所以这里不去跟它拔河，改成在出口处按"已知会抄的那几句话"删一行——
    //     跟上面规则一/二/三是同一个套路。
    //   ★ 判据只能认**提示词自己的生造短语**，不做"长得像标签就删"那种模糊匹配。
    //     ——这句原话我当时就写在这儿了，可第一版**自己就没做到**：判据写的是
    //       /题里有图|题里没图|…/ 这种裸词。写反例用例的时候才发现：
    //         「**这道题里有图形**，我们数一数。」  里面也含「题里有图」四个字
    //       ——一句正经的正文会被整行删掉。老师眼前凭空少一行，跟抄标签一样难看。
    //     所以判据收紧成两条**都得看着像标签**的：
    //       ① 一行里有【…】方框，方框里装着提示词自己的话（实测抄的 25 份全长这样）；
    //       ② 或者光秃秃把那几句抄在**行首**（"完整的回复是…""一个围栏都不写…"）——
    //          这几句不是人能对着老师说的，出现在行首就是抄的。
    //     ⚠ 别因为"想多拦一点"再把裸词放回来：裸词拦到的第一样东西不是抄的标签，
    //       是正文。（同族教训：[[scanner-numbers-are-not-what-they-claim]]）
    var RE_BOX = /【[^】]{0,30}】/;
    var RE_ECHOWORD = /题里有图|题里没图|一个围栏都不写|每题配一个围栏|每题一个围栏/;
    var RE_ECHOHEAD = /^(完整的回复是|先数一数|题里有图|题里没图|一个围栏都不写|每题配一个围栏|每题一个围栏)/;
    visible = visible.split('\n').filter(function (ln) {
      var s = ln.trim();
      if (RE_MARK0.test(s) || RE_MARK1.test(s)) return false;
      if (RE_TICK.test(s)) return false;
      if (stripAssign && RE_ASSIGN.test(s)) return false;
      if (RE_BOX.test(s) && RE_ECHOWORD.test(s)) return false;
      if (RE_ECHOHEAD.test(s)) return false;
      return true;
    }).join('\n');

    return {
      visible: visible.trim(), ggb: ggb, say: say, mat: mat, pending: pending,
      // ggbInfo 跟 ggb 一一对应（没有名字的那一格是空串）。右栏多页拿它当标签名。
      ggbInfo: ggbInfo
    };
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

  // ---- 兜底：模型写裸 LaTeX 的时候，自己把 `$` 补上 ----
  // ★★ 2026-10-02 新增。孔老师截图里那句话：「首先为什么数学公式显示不出来，frac 还在」
  //   —— 屏幕上原样印着 `(1 \frac{1}{2})`。
  //   根因在提示词那一头（备课那四份**从来没要求过用 `$` 包公式**，见 js/prompt-prep.js
  //   新加的「数学式子怎么写」一节）。但**提示词是软的**：就算改了，模型这几轮多半还写裸的。
  //   这一道是硬的——**认得出 `\frac` 这种命令，就自己给它包上 `$`**。
  //
  // ★ 为什么在**文本节点**上做，不在 markdown 源码上做：
  //   在源码上插 `$...$` 得先绕开 markdown 的 `_`／`*`，还得挑一个净化前后都安全的时机
  //   （塞早了会被 marked 当普通字符，塞晚了过不了 DOMPurify），一串占位符搬运，
  //   能出错的地方多。在文本节点上做时**markdown 已经跑完了**，没有第二次解释，
  //   也就没有第二轮误伤。
  //   ⚠ 代价（**知道的边界，不是没想到**）：一段数学里要是 `x_1` 和 `x_2` 先被 marked
  //     认成了斜体，到这一层就晚了，那一处会显示成斜体而不是公式。中文回复里这种形状很少，
  //     真撞上也比整片乱码轻。要根治得改提示词那一头的写法，见 probe_math.cjs 的边角。
  //
  // ★ 只认**已知的 LaTeX 命令名**，不做"见到反斜杠就包"：
  //   中文回复里 `\` 还会出现在路径、转义里，见一个包一个是自找假警报。
  // ★ 名单末尾那个 `\^\{` 是**上标**（`x^{2}`）：它一个命令都不含，可屏幕上
  //   "x^{2}" 跟 "\frac" 一样是没法看的样子，所以单独收一档。
  //   ⚠ 下标 `_` **故意不收**：markdown 比我们先看到它（`x_1` 和 `x_2` 会被 marked
  //     认成斜体并改写成 <em>），等轮到我们这一层，原文已经不在文本节点里了——
  //     收了也是白收，反而会让"没包上"看起来像我们的 bug。要根治得改提示词的写法。
  var RE_BARE = /(?:\\(?:frac|dfrac|tfrac|sqrt|times|div|cdot|pm|mp|le|leq|ge|geq|ne|neq|approx|equiv|angle|triangle|parallel|perp|circ|infty|pi|alpha|beta|gamma|theta|lambda|mu|sigma|omega|overline|underline|vec|left|right|begin|end|ldots|cdots|quad|qquad|text|mathrm|operatorname|log|sin|cos|tan)\b|\^\{)/;
  // "长得像数学"的字符集。★ 中文字符**不在**里头 —— 这就是切段的边界：
  //   「算得x=\frac{1}{2}再代回」里，"x=\frac{1}{2}" 成一段，"算得"和"再代回"各成一段。
  var MATH_CH = /[A-Za-z0-9\\{}^_=+\-*\/.,;:|()\[\]<> \t]/;
  var SKIP_TAG = { PRE: 1, CODE: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1 };

  // ★★ 这一段是**纯函数**，故意从 DOM 里剥出来：
  //   仓库里所有"判得对不对"的东西都要能在 node 里量（见 test/probe_plan.cjs 顶上那段），
  //   而 armLatex 要 document。剥出来之后 test/probe_math.cjs 能直接喂字符串量边角，
  //   **不用开浏览器、不花额度**——只有"KaTeX 到底认不认它包出来的东西"那一层才留给浏览器。
  //   返回 {text, changed}，不是就地改。
  function armText(s) {
    s = String(s == null ? '' : s);
    // ★ 已经有 `$` 的**一个字都不动**：那一头归 renderMathInElement 管。
    //   这道闸兼职防"重复包"——同一段被 arm 第二遍时，会因为看见 `$` 直接退出。
    if (s.indexOf('$') >= 0) return { text: s, changed: false };
    if (!RE_BARE.test(s)) return { text: s, changed: false };
    var out = '', i = 0, changed = false;
    while (i < s.length) {
      if (!MATH_CH.test(s.charAt(i))) { out += s.charAt(i); i++; continue; }
      var j = i;
      while (j < s.length && MATH_CH.test(s.charAt(j))) j++;
      var run = s.slice(i, j);
      // ★ 首尾的空白要**留在公式外面**：切段是按"数学字符集"切的，而空格算数学字符，
      //   所以 「答案是 \sqrt{3} 厘米」 切出来的那一段是 " \sqrt{3} "，两头各带一个空格。
      //   直接包成 `$ \sqrt{3} $` 也能渲染，可导出的文字里会多两个空格，
      //   以后对着屏幕和导出的文件查差异时会变成一处说不清的神秘不同。顺手夹掉。
      var lead = run.match(/^[ \t]*/)[0];
      var tailSp = run.match(/[ \t]*$/)[0];
      var core = run.slice(lead.length, run.length - tailSp.length);
      // ★ 这一整段里得**真有命令**才包。否则 "x = 3" 这种普通写法也会被裹进公式——
      //   中文句子里等号到处都是，那就等于把整句话喂给 KaTeX 了。
      //   （core 为空时 RE_BARE.test('') 为假，会原样吐回 run，不会包出 `$$`。）
      if (RE_BARE.test(core)) { out += lead + '$' + core + '$' + tailSp; changed = true; }
      else out += run;
      i = j;
    }
    return { text: out, changed: changed };
  }

  function armNode(node) {
    if (!node || !node.data) return;
    var r = armText(node.data);
    if (r.changed) node.data = r.text;
  }

  // 走一遍整棵子树的文本节点，跳过代码块（那儿的原文一个字都不许动）。
  function armLatex(root) {
    if (!root || !document.createTreeWalker) return;
    var walker, node, hit = [];
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    } catch (e) { return; }
    while ((node = walker.nextNode())) {
      var p = node.parentNode;
      if (p && SKIP_TAG[p.nodeName]) continue;
      if (node.data.indexOf('```') >= 0) continue;
      hit.push(node);
    }
    // ★ 先收齐再改：边走 walker 边改数据虽然合法，但收一遍更好查也更稳。
    for (var i = 0; i < hit.length; i++) armNode(hit[i]);
  }

  function renderInto(el, text) {
    el.innerHTML = md(text);
    armLatex(el);              // ← must run **before** typeset：它负责把裸的 `$...$` 补出来
    typeset(el);
  }

  return { esc: esc, parseFences: parseFences, md: md, typeset: typeset,
           armText: armText, armLatex: armLatex, renderInto: renderInto };
})();
