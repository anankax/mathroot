// 对话客户端。两个后端（智谱 GLM / DeepSeek）都是 OpenAI 兼容协议、都允许浏览器直连，
// 不需要任何代理。后端的 URL、鉴权、模型、降级顺序全从 SR.BACKENDS 取，改后端不动这个文件。
//
// 请求骨架照邰言邰语那份抄的——同一个协议，踩过的坑一样：
//   关思维链遇 400 要去掉参数重发 / 429 是秒回的、重试很便宜 / 超时分三段 /
//   半截的回复不要丢，留着比空着强。
//
// 数根自己多出来的三件事：
//   1. 免费池 429 要**自动换下一个免费模型**，别一上来就让访客去注册（换完还不行才提示切 Key）
//   2. glm-4v-flash 上下文只有 16K → 历史必须**按 token 裁**，不能按轮数裁
//   3. glm-4.1v-thinking-flash 的思考过程混在正文里（`<think>…`）→ 流式剥掉
var SR = (window.SR = window.SR || {});

SR.api = (function () {

  // ============================================================
  //  后端
  // ============================================================
  function getBackendId() {
    try { return localStorage.getItem(SR.LS_BACKEND) || SR.DEFAULT_BACKEND; } catch (e) { return SR.DEFAULT_BACKEND; }
  }
  function backend(id) { return SR.BACKENDS[id || getBackendId()] || SR.BACKENDS[SR.DEFAULT_BACKEND]; }
  function setBackend(id) {
    if (!SR.BACKENDS[id]) return;
    try { localStorage.setItem(SR.LS_BACKEND, id); } catch (e) {}
  }

  // ---- Key ----
  //   GLM 的 Key 写在 config.js 里（孔老师拍板，同邰言邰语那套取舍）；
  //   DeepSeek 的 Key 只存在使用者自己的浏览器里，我们碰不到。
  function getKey(id) {
    var b = backend(id);
    if (b.keyInPage) return SR.GLM_KEY || '';
    try { return localStorage.getItem(SR.LS_KEY) || ''; } catch (e) { return ''; }
  }
  function setKey(k) { try { localStorage.setItem(SR.LS_KEY, String(k || '').trim()); } catch (e) {} }
  function forgetKey() { try { localStorage.removeItem(SR.LS_KEY); } catch (e) {} }
  function hasKey(id) { return getKey(id).length > 10; }
  // 这个后端现在能不能用（GLM 看内置 Key 配没配，DeepSeek 看使用者填没填）
  function ready(id) { return hasKey(id); }

  // 本会话累计用量，页脚拿它显 token
  var usage = { prompt: 0, completion: 0, calls: 0 };
  function usageText() {
    if (!usage.calls) return '';
    return '本会话 ' + usage.calls + ' 次 · 输入 ' + usage.prompt + ' tokens · 输出 ' + usage.completion;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ============================================================
  //  按 token 裁历史
  // ============================================================
  // ★ glm-4v-flash 只有 16K 上下文，实测 15246 tokens 能过、再往上 400/1210"输入过长"。
  //   我们那份学生提示词本身就 7541 tokens，一张图约 244 tokens，输出留 1024，
  //   于是留给历史的就七千上下（见 SR.BACKENDS.glm.budget）。
  //   按轮数裁是不行的：24 轮短对话才 8865 tokens 看着没事，
  //   但学生贴一道长题干、或者连着发几轮长解答，几轮就能把 16K 顶满。
  //
  // 0.65 这个系数是实测出来的：11609 字符的提示词 = 7541 tokens。
  // 中文按 0.65 算得准，英文/公式会被高估——高估是安全的方向，宁可多裁一点。
  function charCost(m) {
    var c = m && m.content, n = 0;
    if (typeof c === 'string') n = c.length;
    else if (Object.prototype.toString.call(c) === '[object Array]') {
      for (var i = 0; i < c.length; i++) {
        if (!c[i]) continue;
        if (c[i].type === 'text') n += (c[i].text || '').length;
        // 一张图的 token 摊成"字符当量"来记账：实测 244 tokens ÷ 0.65 ≈ 375 字符
        else if (c[i].type === 'image_url') n += 375;
      }
    }
    return n;
  }
  function estTokens(m) { return Math.ceil(charCost(m) * 0.65) + 4; }

  // 从**最老的**开始丢，永远保住最近的那几轮
  function trimHistory(history, budget) {
    if (!history || !history.length) return [];
    if (!budget) return history;
    var total = 0, i;
    for (i = 0; i < history.length; i++) total += estTokens(history[i]);
    if (total <= budget) return history;
    var keep = [], acc = 0;
    for (i = history.length - 1; i >= 0; i--) {         // 倒着收，收到装不下为止
      var c = estTokens(history[i]);
      if (acc + c > budget) break;
      keep.unshift(history[i]);
      acc += c;
    }
    // 至少留一条，免得只剩 system 光秃秃的（半截也比没有好）
    if (!keep.length) keep = [history[history.length - 1]];
    return keep;
  }

  // ============================================================
  //  正文的组装（chat.js 也用它，别在两处各写一遍）
  // ============================================================
  // parts 收两种形状：
  //   • 一个图片 dataURL 字符串 —— 老写法（单张图），留着不破坏已有调用
  //   • [{kind:'image', dataUrl}, {kind:'text', text, name}, …] —— 多文件，见 js/files.js
  // 图片按 OpenAI 的约定排在文字之后；文本类文件（.docx/PDF 提不出图的那种）
  // 拼进正文，前面挂一行【文件名】，让学生知道"这几行是从哪个文件里读出来的"。
  function userContent(text, parts) {
    if (typeof parts === 'string') parts = parts ? [{ kind: 'image', dataUrl: parts }] : [];
    parts = parts || [];
    var imgs = [], docs = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      if (p.kind === 'image' && p.dataUrl) imgs.push({ type: 'image_url', image_url: { url: p.dataUrl } });
      else if (p.kind === 'text' && p.text) docs.push('【' + (p.name || '文件') + '】\n' + p.text);
    }
    var t = text || '';
    if (docs.length) t = (t ? t + '\n\n' : '') + docs.join('\n\n');
    if (!imgs.length) return t || '';
    if (!t) t = '（这是学生发来的题目，帮我看看）';
    return [{ type: 'text', text: t }].concat(imgs);
  }

  // ============================================================
  //  「测一下」：拿一串 Key 真打一次，看通不通
  // ============================================================
  // 存在的理由：不验的话，Key 填错了要等到下一次真提问（可能还带着一张照片）才知道，
  // 中间白等一场；而且失败的是"那一轮对话"，学生分不清是网的问题还是 Key 的问题。
  // 用一个最小请求：一句话、max_tokens 1、不流式。花掉的额度可以忽略。
  // ★ 只报"通/不通 + 为什么"，不返回任何模型输出——这里不需要，也不该让它说话。
  function probeKey(k, cb) {
    var b = SR.BACKENDS.deepseek;
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, 20000);
    var done = function (res) { clearTimeout(t); cb(res); };
    fetch(b.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k },
      body: JSON.stringify({
        model: (b.models && b.models[0]) || 'deepseek-chat',
        messages: [{ role: 'user', content: '你好' }],
        max_tokens: 1,
        stream: false
      }),
      signal: ctl.signal
    }).then(function (r) {
      if (r.ok) { done({ ok: true }); return; }
      return r.text().catch(function () { return ''; }).then(function (body) {
        var why;
        if (r.status === 401 || r.status === 403) why = '这个 Key 服务器不认（可能少复制了一段）';
        else if (r.status === 402) why = '这个 Key 的余额不够了';
        else if (r.status === 429) why = '被限流了——Key 本身是好的，等一会儿再试';
        else why = 'HTTP ' + r.status + (body ? '：' + String(body).slice(0, 100) : '');
        done({ ok: false, error: why });
      });
    }).catch(function (e) {
      done({ ok: false, error: (e && e.name === 'AbortError') ? '等太久没响应' : ('连不上（' + ((e && e.message) || e) + '）') });
    });
  }

  // ============================================================
  //  剥掉 <think>…</think>
  // ============================================================
  // glm-4.1v-thinking-flash 的思考过程不走 reasoning_content，
  // 而是**纯文本混在 content 里**（实测 0 帧 reasoning_content，正文开头就是 `<think>用户的问题是问…`）。
  // 直接念出来就穿帮了，所以按流剥——注意标签可能被切成两半跨 chunk，得攒着判。
  function makeStripper(onOut) {
    var buf = '', decided = false, inside = false;
    return {
      push: function (chunk) {
        buf += chunk;
        for (;;) {
          if (!decided) {
            var t = buf.replace(/^\s+/, '');
            // 还不够判断、且目前看着像是 <think 的开头 → 再等等
            if (t.length < 6 && '<think'.indexOf(t) === 0) return;
            decided = true;
            inside = (t.slice(0, 6).toLowerCase() === '<think');
            if (inside) buf = t;
          }
          if (inside) {
            var i = buf.toLowerCase().indexOf('</think');
            if (i < 0) { if (buf.length > 8) buf = buf.slice(-8); return; }  // 整段丢掉，尾巴留着防切断
            var gt = buf.indexOf('>', i);
            if (gt < 0) { buf = buf.slice(i); return; }
            buf = buf.slice(gt + 1);
            inside = false;
            continue;
          }
          if (buf) { onOut(buf); buf = ''; }
          return;
        }
      },
      flush: function () { if (!inside && buf) { onOut(buf); buf = ''; } }
    };
  }

  // 分数线：低于它就不给。数值和理由在 js/kb.js 顶上那段（量出来的，不是拍的）。
  // 取不到就退到 0（＝不卡）——宁可多给，也别因为一个加载顺序问题整段检索没了。
  function cutOf(which) {
    try { return (SR.kb && SR.kb.cut) ? SR.kb.cut(which) : 0; } catch (e) { return 0; }
  }

  // ---- 本地检索：按学生这一轮说的话，从教材索引里挑几条塞进去 ----
  // ★ 这里原来**没有**分数线，凡是撞上就全给。实测"这道题我不会"能召回
  //   「1.5 等腰三角形」、「第二题」能召回「四分位数和箱线图」——都是噪声，
  //   而附注是让人信的东西，塞一条错的进去还不如不塞。
  function pickTextbook(query, k) {
    try {
      if (!SR.findTextbook) return '';
      var hits = SR.findTextbook(query, k || 2);
      if (!hits || !hits.length) return '';
      var cut = cutOf('textbook'), out = [];
      for (var i = 0; i < hits.length; i++) {
        if (hits[i].score < cut) continue;
        out.push(hits[i].doc.text.trim());
      }
      return out.join('\n\n');
    } catch (e) { return ''; }
  }

  // ---- 追问条目库：孔老师自己写的 118 条，只挑一条 ----
  //   为什么只挑一条：条目里四个【…】是按"学生说到哪儿了"分档的追问问法，
  //   一次给多条，模型就会去挑一条最像的照搬，回复立刻千篇一律。
  //   给一条、并且明说"参考问法别搬原句"，它才会拿这道题的数去问。
  function pickZhuawen(query) {
    try {
      if (!SR.findZhuawen) return '';
      var hits = SR.findZhuawen(query, 1);
      // 分数太低＝没对上，不如不给。原来这条线是 3，实测 13 句泛泛的学生话漏进去 11 句，
      // 现在照量出来的数抬到 10（见 js/kb.js 顶上那段）。
      if (!hits || !hits.length || hits[0].score < cutOf('zhuawen')) return '';
      return hits[0].doc.text.trim();
    } catch (e) { return ''; }
  }

  // ---- 组装 system ----
  // mode: 'student' | 'demo'；query: 学生这一轮说的话，用来检索教材索引；
  // parts: 这一轮带的文件（见 userContent 上面那段），用来判"是不是一整份卷子"
  //
  // ★ 学生模式按后端挑提示词。免费通道那颗 glm-4v-flash 只有 16K 上下文，
  //   全量提示词 7618 tokens 塞进去它就顾不上读规则了（实测：想说围栏 2/4、0/4，
  //   还在照抄提示词里的例句）；换成 5303 字的精简版才是 4/4、4/4。见 config.js 的注释。
  //   演示模式两个后端共用一份——它短，而且实测在 GLM 上是 6/6 全绿。
  function buildSystem(mode, query, backendId, parts) {
    var m = SR.MODES[mode] || SR.MODES.student;
    var b = backend(backendId);
    var lean = (mode === 'student' && b.promptProfile === 'lean' && SR.PROMPT_LEAN);
    var sys = lean ? SR.PROMPT_LEAN : (m.prompt() || '');
    // 演示模式不检索。实测：给学生那套教材索引塞进演示模式，出图率从 8/8 掉到 6/8——
    // 附注里那句"照上面「三、教材索引」那节的规矩"在演示模式的提示词里根本没有对应的一节，
    // 模型被这段没头没尾的附注带跑了。教师模式要的是快，别再给它添东西。
    var tb = (mode === 'demo') ? '' : pickTextbook(query, 2);
    if (tb) {
      sys += '\n\n---\n\n# 附：这一轮给你翻出来的教材索引\n\n' +
             '（下面这几条是系统按学生刚说的话找出来的。**只挑对得上这道题的那一条用**，' +
             '对不上就当没给。用法照上面「三、教材索引」那节的规矩。）\n\n' + tb;
    }
    // ★ 收尾块放在**所有内容之后**，就为了占住"最后一段"这个位置。
    //   小模型（glm-4v-flash）只认最后读到的东西：实测同一份提示词，
    //   格式要求在中段时 ```想说 命中 0/6～1/6，挪到末尾的招在演示模式上是从 5/8 提到 10/10 的。
    //   注意它必须在教材索引附注**后面**——附注是后拼的，写进提示词里就会被顶掉位置。
    // ★ 2026-10-01：改成**学生模式两条通道都加**。原来只给精简版加，理由是"DeepSeek 那份
    //   全量提示词本来就是 8/8"——但那是收尾还长在正文里、离末尾不远的时候测的数。
    //   这一轮补上追问条目库之后，两份 system 的末尾都变成了"教材索引 + 追问条目"，
    //   而正文里那段内联收尾已经删掉（见 build_prompt.py 4b）。所以现在**只剩这一处**收尾，
    //   全量版不追加就等于没有格式要求。
    //   演示模式不追加：它自带的收尾是在演示提示词上测出来的（出图 10/10），别去动。
    // ---- 整卷 / 多道题：学生一次发来一整份卷子 ----
    // ★ 触发条件故意做得很粗：≥2 张图，或者正文超过 800 字。
    //   因为"这是不是一整张卷子"是判不准的（一张照片也可能拍的是整页），
    //   而**漏判的代价比误判大得多**：漏判了它就照着第一题开始追问，
    //   学生手上还有十道不会的，却只能跟着一题走。误判最多是多列一遍题。
    // ★ 只在学生模式加。演示模式不给任何附注——理由见上面教材索引那段：
    //   演示提示词是另一个体系，塞一段它没有对应章节的话进去，实测出图率会掉。
    var imgCount = 0, textLen = (query || '').length;
    for (var pi = 0; pi < (parts || []).length; pi++) {
      var pp = parts[pi];
      if (!pp) continue;
      if (pp.kind === 'image') imgCount++;
      else if (pp.kind === 'text') textLen += (pp.text || '').length;
    }
    if (mode === 'student' && (imgCount >= 2 || textLen > 800)) {
      sys += '\n\n---\n\n# 附：这一轮学生发来的是一整份（或好几道）题\n\n' +
        '（系统看出来这一轮不是一道题，是一整张卷子、或者好几道一起发来的。按这个次序来：\n' +
        '1. **先别追问。** 先把你能看到的题**列一遍**：题号 + 一句话说这题在问什么。' +
        '看到几道列几道；看不清的题号就写"看不清"。**看不清的题不许猜、不许照着别的题补出来。**\n' +
        '2. 列完再问一句：这些里面**哪些是不会的、哪些是做错的**？让他挑一道先说。\n' +
        '3. 他挑定一道之后，就回到你平常那套，一道一道来。\n\n' +
        '★ 这一轮格外要守住铁律第 7 条：你**不光看得见他的解答，还能一眼看出他哪一步错了**。' +
        '看得见不等于可以说——列题号的时候**只许说这题在问什么**，' +
        '一个字都不许提他做得对不对、错在哪一步、哪一步可以更快。\n' +
        '★ 万一题都看不清，别硬列：直说"这份我这边看得不太清"，然后问他哪一道先说。）';
    }

    // 追问条目库：只有学生模式才给。它是"这一类题该怎么问"的参考，
    // 演示模式是老师自己画图，用不上；给了反而多一段要读的东西。
    //
    // ★「没召回到怎么办」这一档就在下面那个 if 的反面：**一个字都不加**。
    //   检索分数不够就不给，system 退回只有提示词本身——这正是加知识库之前的行为，
    //   是安全的默认档。别哪天改成"没召到就补一段通用追问"，
    //   那等于在模型本来就会的地方再教它一遍，反而会把它带离这道题。
    //   （本条来自那六次缺陷的共同根因：要它做一件事、却没给它那一档句式，它就自己编。
    //     这里反过来——**没有那一档，就不提那件事**。）
    if (mode === 'student') {
      var zw = pickZhuawen(query);
      if (zw) {
        sys += '\n\n---\n\n# 附：这一轮翻出来的一类题\n\n' +
               '（系统按学生刚说的话找的一条，是老师自己整理的追问条目。' +
               '**只在对得上这道题的时候参考它**，对不上就当没给。' +
               '它按"学生说到哪儿了"分了四档，照上面「追问的五个台阶」挑当前那一档，' +
               '**参考它的问法就行，别把原句搬过来**——原句是照着别的题写的，搬过来跟学生说的对不上。）\n\n' + zw;
      }
    }
    if (mode === 'student' && SR.PROMPT_TAIL) sys += '\n\n---\n\n' + SR.PROMPT_TAIL;
    return sys;
  }

  // ============================================================
  //  一次对话
  // ============================================================
  // opts: {mode, history, text, parts, onChunk, onNotice}
  //   parts 见 userContent 上面那段。老的 opts.imageDataUrl 仍然认。
  // 返回 {text, model} 或 {error, needOwnKey?}
  async function ask(opts) {
    var onChunk = opts.onChunk || function () {};
    var onNotice = opts.onNotice || function () {};
    var b = backend();
    var key = getKey(b.id);

    if (!key || key.length <= 10) {
      if (b.keyInPage) return { error: '免费通道的 Key 没配上，先去「关于」看看，或者切到自己的 Key。', needOwnKey: true };
      return { error: '还没填 ' + b.label + ' 的 Key' };
    }
    if (!navigator.onLine) return { error: '断网了' };

    var parts = opts.parts || (opts.imageDataUrl ? [{ kind: 'image', dataUrl: opts.imageDataUrl }] : []);
    var hasImg = false;
    for (var pi = 0; pi < parts.length; pi++) if (parts[pi] && parts[pi].kind === 'image') { hasImg = true; break; }

    // ★ 带图那一轮单独给历史预算（b.budgetImage）。b.budget 是按免费通道
    //   最小那颗模型的 16K 上下文量的；带图走的是 128K 的 glm-4.6v-flash，
    //   而一整张卷子的五六页图本来就占掉两千多字符当量，再用 7000 去裁，
    //   历史会被裁到只剩最后一轮——学生上一句说"我算到 x=4"就白说了。
    var budget = (hasImg && b.budgetImage) ? b.budgetImage : b.budget;

    // ★ 知识库(教材索引 + 追问条目库，共 117KB)从首屏挪到这儿按需拿。
    //   要 await：buildSystem 里那两段附注得等语料真到了才检索得到。
    //   但**绝不与它共沉浮**——拿不到就返回 false，附注走"没检索到"那一档，
    //   kb.js 那边还有 3 秒兜底，学生不会因为一个 404 就卡在"正在输入"。
    try { if (SR.kb) await new Promise(function (r) { SR.kb.load(function () { r(); }); }); } catch (e) {}

    // ★ 召回用的不是 opts.text 一句，而是"这一轮的话 + 前几轮学生自己的话"。
    //   原因见 js/kb.js 的 queryFor：学生说"这题我不会"时，话里一个知识点的字都没有，
    //   照原样检索永远召不回。传 opts.history 而不是裁过的那份——
    //   裁历史是为省 token，这里只要有字就行。
    var recall = SR.kb ? SR.kb.queryFor(opts.text, opts.history) : (opts.text || '');

    var msgs = [{ role: 'system', content: buildSystem(opts.mode, recall, b.id, parts) }]
      .concat(trimHistory(opts.history || [], budget))
      .concat([{ role: 'user', content: userContent(opts.text, parts) }]);

    var ctl = new AbortController();
    var timer = null, got = false;
    var arm = function (ms) { clearTimeout(timer); timer = setTimeout(function () { ctl.abort(); }, ms); };
    arm(SR.WAIT_FIRST);
    var hard = setTimeout(function () { ctl.abort(); }, SR.HARD_CAP);

    // 拆成函数，是为了万一 thinking 不被认了能去掉重发
    function bodyOf(withThinking, model) {
      var body = {
        model: model,
        messages: msgs,
        temperature: SR.TEMPERATURE,
        max_tokens: SR.MAX_TOKENS,
        stream: true
      };
      // ★ thinking 只对 DeepSeek 发。GLM 前后两代模型都不吃这个参数，别去惹它的参数校验。
      if (withThinking && b.sendThinking && SR.THINKING_OFF) body.thinking = SR.THINKING_OFF;
      return JSON.stringify(body);
    }
    var send = function (body) {
      return fetch(b.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: body,
        signal: ctl.signal
      });
    };

    var all = '', rawAll = '';
    try {
      // ---- 逐个模型试：主模型 → 降级 → 再降级 ----
      //   ★ 只在 429 上往后走。401/402 是 Key 和余额的事，换模型救不了，早报早好。
      //   ★ 走哪一条链，看两件事：**是不是演示模式**、**这一轮带不带图**。
      //     演示模式走 models——实测 glm-4v-flash 在演示那条上是 6/6（围栏全中），
      //     而文字模型不认 ``` 围栏，会把画板命令当普通文字打出来：
      //       〔正文〕ggb ⏎ #清空 ⏎ 数轴 ⏎ t=Slider(-4,4,0.1) ⏎ …
      //     三个演示用例全 0/6。演示模式的命根子就是围栏，不能交给文字模型。
      //     学生模式**带图**走 modelsImage：那条链上只有守得住规矩的模型，
      //     挤不动时会直接报"通道挤了、切自己的 Key"，**不会**降级到会解题的那两颗
      //     （详见 config.js 里 modelsImage 那段实测）。
      //     学生模式不带图走 modelsText（文字模型会当老师，正文稳；围栏丢了有本地兜底）。
      //     DeepSeek 三条都没配，一律回落到 models。
      var chain;
      if (hasImg) chain = b.modelsImage || b.models;
      else if (opts.mode === 'demo') chain = b.models;
      else chain = b.modelsText || b.models;

      // ★ 单模型链（就是带图那条）必须给足重试：链上只有一个，一次 429 就失败太亏。
      //   429 是秒回的，等一下再打很便宜，而"降级"在这条链上是不能用的选项。
      //   链长的时候反而少试几次——后面还有别的模型可换，别在一颗上耗太久。
      var TRIES = chain.length > 1 ? 2 : 4;
      var r = null, errText = '', model = chain[0], lastSt = 0;
      for (var mi = 0; mi < chain.length; mi++) {
        model = chain[mi];
        lastSt = 0;   // ★ 每换一颗模型就清空。不清的话上一颗的 429 会冒充这一颗的，
                      //   让"这一颗报了 400，不该再往后换"的判断失效（那种情况会白跑两颗模型）
        for (var ti = 0; ti < TRIES; ti++) {
          if (mi > 0 || ti > 0) {
            // 429 是秒回的，等一下再来，很便宜
            await sleep(700 + (mi * TRIES + ti) * 650);
            onNotice(mi > 0 ? ('免费通道有点挤，换了个模型继续（' + model + '）')
                            : '免费通道有点挤，等一下再试…');
          }
          r = await send(bodyOf(true, model));

          if (r.status === 400) {
            var t4 = await r.text().catch(function () { return ''; });
            if (!/thinking/i.test(t4)) { errText = t4.slice(0, 120); break; }
            r = await send(bodyOf(false, model));    // 参数不被认，去掉再来
          }
          if (r.ok) break;
          lastSt = r.status;
          if (r.status !== 429) break;               // 其它错，别浪费时间重试
        }
        if (r && r.ok) break;
        if (r && lastSt !== 429) break;              // 不是 429，换模型也没用
      }

      if (!r || !r.ok) {
        var st = r ? r.status : 0;
        if (st === 401 || st === 403) return { error: b.keyInPage ? '服务端的 Key 失效了，请联系 KAX' : 'Key 不对，去右上角重新填一个' };
        if (st === 402) return { error: '这个 Key 的余额不够了' };
        if (st === 429) {
          return b.keyInPage
            ? { error: '免费通道现在排满了队，等一两分钟再发。也可以点下面切到自己的 Key，立刻就能用。', needOwnKey: true }
            : { error: '请求太密，稍等一下再发' };
        }
        if (st === 400 && errText) return { error: '接口说：' + errText };
        var t = errText || (r ? await r.text().catch(function () { return ''; }) : '');
        return { error: '接口 ' + (st || '错误') + '：' + String(t).slice(0, 120) };
      }

      // ---- 收流 ----
      // 只取 delta.content，reasoning_content 一律丢掉。思维链参数生效时它根本不出现；
      // 万一没关掉，这里也保证学生看不见。
      var wantStrip = !!b.stripThink;
      var out = function (s) { all += s; onChunk(s); if (!got) { got = true; arm(SR.WAIT_IDLE); } };
      var strip = wantStrip ? makeStripper(out) : null;

      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        buf += dec.decode(step.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();                       // 最后一行可能只到一半，留着
        for (var j = 0; j < lines.length; j++) {
          var s = lines[j].trim();
          if (s.indexOf('data:') !== 0) continue;
          var p = s.slice(5).trim();
          if (p === '[DONE]') continue;
          var o; try { o = JSON.parse(p); } catch (e) { continue; }
          var ch = o && o.choices && o.choices[0] && o.choices[0].delta;
          if (ch && ch.content) {
            rawAll += ch.content;
            if (strip) strip.push(ch.content); else out(ch.content);
          }
          if (o && o.usage) {
            usage.prompt += o.usage.prompt_tokens || 0;
            usage.completion += o.usage.completion_tokens || 0;
            usage.calls++;
          }
        }
      }
      if (strip) strip.flush();

      // 兜底：万一整段都被当思考剥光了，退回"去掉标签的原文"，总比空手强
      if (!all && rawAll) all = rawAll.replace(/<\/?think>/gi, '').trim();
      if (strip && !all && rawAll) { all = rawAll.replace(/<\/?think>/gi, '').trim(); onChunk(all); }

      if (!all) return { error: '模型没说出话来' };
      return { text: all, model: model, backend: b.id };

    } catch (e) {
      if (all) return { text: all };             // 吐了半截，别丢
      if (e.name !== 'AbortError') return { error: '连不上服务：' + (e.message || '') };
      return { error: got ? '模型说着说着没动静了' : '等太久了，没等到回复' };
    } finally {
      clearTimeout(timer);
      clearTimeout(hard);
    }
  }

  return {
    ask: ask,
    getKey: getKey, setKey: setKey, forgetKey: forgetKey, hasKey: hasKey, ready: ready,
    probeKey: probeKey,
    backend: backend, getBackendId: getBackendId, setBackend: setBackend,
    userContent: userContent, trimHistory: trimHistory, estTokens: estTokens,
    usage: usage, usageText: usageText, pickTextbook: pickTextbook, buildSystem: buildSystem
  };
})();
