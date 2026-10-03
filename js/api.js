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

  // 这份历史里还有没有"带图的消息"（内容是数组、里面有 image_url 那种）
  // ★ 分流用（见 ask 里那段）。判的是**内容形状**，不是模型白名单——
  //   哪颗模型认数组这件事会变，形状不会。
  function histHasImage(h) {
    for (var i = 0; h && i < h.length; i++) {
      var c = h[i] && h[i].content;
      if (Object.prototype.toString.call(c) !== '[object Array]') continue;
      for (var j = 0; j < c.length; j++) if (c[j] && c[j].type === 'image_url') return true;
    }
    return false;
  }

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
    if (!t) t = '（这是这节课要上的题，你先看）';
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
  // work: 'draw' | 'prep' | 'vary' | 'review'；query: 这一轮老师说的话，用来检索；
  // parts: 这一轮带的文件（见 userContent 上面那段），用来判"是不是一整份卷子"
  //
  // ★ 挂什么附注，由 SR.WORKS[work] 上的开关说了算，**不在这儿写 if (work === ...)**——
  //   附注与提示词必须一一对应，这是实测过的：把学生那套教材索引塞进演示模式，
  //   出图率 8/8 → 6/8，因为附注里那句"照上面「三、教材索引」那节的规矩"
  //   在演示提示词里根本没有对应的一节，模型被一段没头没尾的话带跑了。
  //   现在 画图／出题 两个工位 retrieve:false，一条附注都不挂，图的就是快。
  //
  // ★ 提示词按后端挑档：免费通道那颗 glm-4v-flash 只有 16K 上下文，
  //   全量 11711 字 = 7618 tokens 塞进去它就顾不上读规则了（实测 ```想说 围栏 2/4、0/4，
  //   正文还在照抄提示词里的例句）；换成 5545 字的精简版才是 4/4、4/4，耗时 13.8s → 1.6s。
  //   画图／出题两个工位只有一份（都短，实测在 GLM 上全绿），不分档。
  function promptOf(w, b) {
    if (b.promptProfile === 'lean' && w.lean) return w.lean() || w.prompt() || '';
    return w.prompt() || '';
  }

  //   hist 是**裁过的历史**（不含这一轮）。★ 只要它是因为"备课／讲评还一轮都没摆过链子"
  //   这一条（见下面那段「几路」）——不拿它做别的判断。
  //
  //   hit —— **可选**的第 6 个参数：{textbook:'', zhuawen:''}，是流水线那两步
  //   （js/flow.js 的 retrieve）**已经翻好**的附注原文。传了就用它，不传就照老样子
  //   在这儿现翻——所以老的调用点（探针、别处）一个字都不用改，行为逐字不变。
  //   ★ 为什么留这一条老路：翻这件事有**两个来处**（云上 / 本机），而"翻歪了能单独重跑"
  //     要求它在 buildSystem **外面**发生。可 buildSystem 是同步的、还被探针直接调着
  //     （test/probe_*.cjs），改成异步要牵一片。所以：外面翻好了就传进来，没传就自己翻。
  //     **拼装那两段话的代码只有下面一份**，两个来处走的是同一份。
  function buildSystem(work, query, backendId, parts, hist, hit) {
    var w = SR.WORKS[work] || SR.WORKS[SR.DEFAULT_WORK];
    var b = backend(backendId);
    var sys = promptOf(w, b);

    // ---- 工位自己现拼的一段 ----
    // ★ 出材料专用：把**老师这份模板**认出来的格式号表交给模型。
    //   这一段每次都不一样（换一份模板就换一张表），所以不能写死在提示词里。
    //   还是老规矩——**不在这儿写 if (work === 'material')**：
    //   api.js 不认识具体工位，它只认 SR.WORKS[x] 上挂没挂这个钩子。
    if (w.extra) {
      var ex = '';
      try { ex = w.extra() || ''; } catch (e) { ex = ''; }
      if (ex) sys += '\n\n---\n\n' + ex;
    }

    // ---- 教材索引 ----
    // ★ 指路话**不点章节编号**，点的是**节的名字**：全量版和精简版现在都有
    //   「手上翻到的东西怎么用」这一节（2026-10-02 补的，两份名字**故意起得一模一样**），
    //   所以这一句在两份提示词里都对得上。
    //   ⚠ 2026-10-02 之前这里指向的是一节**不存在的**「教材索引」——
    //     那是当天重写 prompt-prep.js 时留下的悬空指路话。它正是记在案的那类翻车
    //     （附注与提示词必须一一对应，实测把学生那套索引塞进演示模式，出图率 8/8→6/8）。
    //     别再让它悬空：改这一句之前，先确认提示词里真有那一节、且两份名字一样。
    if (w.retrieve) {
      var tb = (hit && hit.textbook !== undefined) ? hit.textbook : pickTextbook(query, 2);
      if (tb) {
        sys += '\n\n---\n\n# 附：这一轮给你翻出来的教材索引\n\n' +
               '（下面这几条是系统按老师刚说的话找出来的。**只挑对得上这节课的那一条用**，' +
               '对不上就当没给。用法照上面「手上翻到的东西怎么用」那一节的规矩。）\n\n' + tb;
      }
    }

    // ---- 资源库：老师自己那 7706 块材料里最对得上的几块原文 ----
    // ★★ 跟上面那两段的分别，说的就是这一段的全部价值：
    //   教材索引给的是**脉络**（这节课在哪一章、书上原话怎么说），
    //   追问库给的是**问法**（这一类题该怎么问），
    //   这一段给的是**内容本身**——他自己那份学案、那份教案、那份学科网素材是怎么写这一节课的。
    //   他要的就是这个："把我数学资源都资源库里面，然后我的网站智能体再去后端调取。"
    //
    // ★ 为什么不设分数线（另两段都有）：**量不出来**。
    //   实测同一批问题里，"有理数的乘方怎么讲"头名 20.51、"绝对值与相反数"头名 36.95，
    //   而"平方差公式"头名 24.70 落在一块**讲有理数混合运算**的材料上——是块不对症的。
    //   分数在**不同问题之间根本不可比**，所以任何一条全局分数线要么拦不住那块不对症的，
    //   要么把好的一起拦掉。既然量不出一个站得住的数，就不假装有一个。
    //   ⇒ 改用附注里那句话兜着：**对不上就当没给**。这是"没量出来就别硬编个数"，
    //     跟另两段那条量出来的线不是一回事，别把这条当成"忘了设分数线"。
    //
    // ★ 「挂了」跟「没命中」在这里**都退成同一档**：这一段一个字都不加。
    //   区别在哪，面板上（js/flow.js 的 resNote）分得清清楚楚，提示词里不必知道。
    if (w.retrieve) {
      var rb = (hit && hit.reslib !== undefined) ? hit.reslib : '';
      if (rb) {
        sys += '\n\n---\n\n# 附：这一轮从老师资料库里翻出来的几块\n\n' +
               '（下面几块是系统按老师刚说的话，从**老师自己的资料库**里找出来的原文——' +
               '他自己的学案、教案、学科网素材、中考卷。\n' +
               '★ **只挑对得上这节课的用，对不上就当没给**。\n' +
               '★ 它是**别人的讲义**，不是这节课的答案：参考它写了哪些点、怎么起的头，' +
               '别把它的例题、它的数字搬过来——那是另一节课的。\n' +
               '★ 带「（……这块后面还有）」的是**截断的**，别顺着半句话往下推。\n' +
               '用法照上面「手上翻到的东西怎么用」那一节的规矩。）\n\n' + rb;
      }
    }

    // ---- 整卷 / 多道题：老师一次发来一整份卷子 ----
    // ★ 触发条件故意做得很粗：≥2 张图，或者正文超过 800 字。
    //   因为"这是不是一整张卷子"是判不准的（一张照片也可能拍的是整页），
    //   而**漏判的代价比误判大得多**：漏判了它就照着第一题开始追问，
    //   老师手上还有十道要讲的，却只能跟着一题走。误判最多是多列一遍题。
    // ★ 只在**讲评**工位挂（SR.WORKS.review.listPaper）。
    //   原来这条是挂在学生模式上的、条件一模一样——可那个粗条件会**误伤**：
    //   老师在「备课」工位贴一道长题干（比如一道应用题），
    //   也会被当成整卷，然后被要求"先列题号"。现在按工位卡，误伤就没了。
    var imgCount = 0, textLen = (query || '').length;
    for (var pi = 0; pi < (parts || []).length; pi++) {
      var pp = parts[pi];
      if (!pp) continue;
      if (pp.kind === 'image') imgCount++;
      else if (pp.kind === 'text') textLen += (pp.text || '').length;
    }
    if (w.listPaper && (imgCount >= 2 || textLen > 800)) {
      sys += '\n\n---\n\n# 附：这一轮老师发来的是一整份（或好几道）题\n\n' +
        '（系统看出来这一轮不是一道题，是一整张卷子、或者好几道一起发来的。按这个次序来：\n' +
        '1. **先别摆链子。** 先把你能看到的题**列一遍**：题号 + 一句话说这题在问什么。' +
        '看到几道列几道；看不清的题号就写"看不清"。**看不清的题不许猜、不许照着别的题补出来。**\n' +
        '2. 列完再问一句：这几道里**先讲哪一道**？让老师挑。\n' +
        '3. 他挑定一道之后，再按你平常那套摆那一道的链子。\n\n' +
        '★ 列题号这一步**只列"这题在问什么"**——不摆链子、不说该从哪一步讲起、' +
        '不说哪一道最难。挑哪几道讲是老师的决定，你把题摆清楚，别替他挑。\n' +
        '★ 万一题都看不清，别硬列：直说"这份我这边看得不太清"，然后问老师哪一道先讲。）';
    }

    // ---- 追问条目库（孔老师自己写的 118 条）----
    // 只有 retrieve:true 的工位（备课／讲评）才给：它是"这一类题该怎么问"的参考，
    // 画图／出题 用不上，给了反而多一段要读的东西。
    //
    // ★「没召回到怎么办」这一档就在下面那个 if 的反面：**一个字都不加**。
    //   检索分数不够就不给，system 退回只有提示词本身——这正是加知识库之前的行为，
    //   是安全的默认档。别哪天改成"没召到就补一段通用追问"，
    //   那等于在模型本来就会的地方再教它一遍，反而会把它带离这道题。
    //   （本条来自那六次缺陷的共同根因：要它做一件事、却没给它那一档句式，它就自己编。
    //     这里反过来——**没有那一档，就不提那件事**。）
    //
    // ★★ 2026-10-02 改的一个字句，是孔老师"感觉你这个都是预设好的"那次的根因：
    //   旧附注最后半句写的是「它里面写得最好的那几句，正好可以拿来当
    //   **「学生大概会说」和「你接这句」**的样板」——把两行**混在一起**了。
    //   可这份库里全是**老师问学生的话**（"这题你当时是怎么读的？""你分的时候是照
    //   哪个标准分的？"），当「你接这句」的样板是对的，当「学生大概会说」的样板
    //   完全错了：学生那一行被指着去抄老师的问句，于是**永远不会出现一个真孩子
    //   在说错话**——读起来就像数根在念他自己写好的那 118 条。
    //   现在明说：它只喂「你接这句」，「学生大概会说」一个字都不许从这儿拿。
    //   同族证据：库里好几条共用一个带空格的套子「你刚才那句"____"，就是这类题的关键」，
    //   一眼就能看出那是模板不是生成。
    if (w.retrieve) {
      var zw = (hit && hit.zhuawen !== undefined) ? hit.zhuawen : pickZhuawen(query);
      if (zw) {
        sys += '\n\n---\n\n# 附：这一轮翻出来的一类题\n\n' +
               '（系统按老师刚说的话找的一条，是老师自己整理的追问条目。' +
               '**只在对得上这道题的时候参考它**，对不上就当没给。' +
               '它是别人照着**另一道题**写的，所以：**参考它的问法，别把原句搬过来**——' +
               '搬过来跟这道题对不上。\n' +
               '★ 它只能喂**「你接这句」**那一行：里面全是**老师问学生的话**，正好对得上。\n' +
               '★★ **「学生大概会说」一个字都不许从这儿拿。** 库里没有学生的话——' +
               '照它写，学生就变成一个在提问题的小老师，不是在这道题上犯了错的初中生。' +
               '那一行只能照老师这道题**自己生成**。）\n\n' + zw;
      }
    }

    // ---- 备课／讲评：链子还没开始摆的那一轮，先要「几路」 ----
    // ★ 为什么这一条不写在提示词正文里：小模型只认**最后读到**的东西
    //   （实测格式要求在中段 0/6，挪到末尾 5/8 → 10/10）。而末尾那个位置
    //   已经被 TAIL（每一轮都要守的三行格式）占死了——它是产品的命根子，不能让。
    //   所以这一段挂在**倒数第二段**：第一轮 TAIL 仍然是最后读到的，
    //   几路占到"紧挨着最后一段"，比写在正文中段稳得多。
    // ★ 为什么放在 api.js 里按轮次挂、而不是写进提示词：它是**只该出现一次**的义务。
    //   写进正文它每一轮都会看见，第二、三轮就会重新列一遍路——那正是要避免的多嘴。
    // ★ 判据是"**这整条对话还一次都没摆过链子**"，不是"这是第 0 轮"：
    //   讲评工位第一轮是"先列题号"（那时还没挑定题目，列路没意义），
    //   真正该给几路的是**老师挑定一道之后**那一轮——那时候历史已经不是空的了。
    //   （"老师中途换了一道新题"这一档靠提示词正文里那句话兜着，它比这里弱，
    //     但那一档本来也不常见；正文里那句话在 prompt-prep.js 的「老师说了话，你怎么动」。）
    if (w.chainStart) {
      var noChainYet = true;
      if (SR.hasChain) {
        for (var ci = 0; ci < hist.length; ci++) {
          if (hist[ci].role === 'assistant' && SR.hasChain(String(hist[ci].content || ''))) { noChainYet = false; break; }
        }
      }
      if (noChainYet) sys += '\n\n---\n\n' + SR.PROMPT_PREP_ROUTES;
    }

    // ---- 「这一份」：老师手上正在办的那一件事 ----
    //
    // ★★ 这一段补的是第五阶段那张模拟稿说的**「每一步都不用重新交代」**。
    //   在这之前，「这一份」只活在**人这边**——中栏顶上那条 #onep 和 js/memo.js 的
    //   口袋，模型一个字都看不见它（这一段加进来之前，这个文件里没有一处读 pocket）。
    //   后果就是老师说的那件事：在「备课」里交代过"3.1、七(7)班"，切到「命题」
    //   它又问"你要出哪一节"。那不是它记性差，是**那段对话被切工位时 reset 掉了**
    //   （见 js/main.js 的 applyWork：不同提示词体系的工位互相切要重开一段），
    //   而顶上那三格虽然还好好地挂在屏幕上，却没有一条路通到这儿来。
    //   屏幕上写着、模型读不到——**这正是"看着正常"最典型的一种坏**：
    //   老师只会觉得"这智能体记性不好"，看不出是哪儿断的。
    //
    // ★ 为什么由 api.js 现拼、不写进提示词：它是**每一场都不一样**的运行时状态，
    //   跟上面素材模板那张格式号表同一个道理（见 w.extra），提示词里写不了"3.1"。
    // ★ 为什么 api.js 敢读工位名字：读的是 `w.label`（config.js 那一份），
    //   不是在这儿写死"备课"／"命题"——它跟别处一样，不认识具体工位。
    //
    // ★ 位置在这儿、**不占掉最后一段**：收尾块 TAIL 是每一轮的格式契约，必须最后
    //   读到，不能让位（理由见下面那段）。这一段排在 TAIL 前面，但比那几段检索附注
    //   更靠后——它是**轮轮都要知道**的事实，不是"这一轮翻出了什么"。
    //
    // ★ 空场一个字都不加（跟检索那几段同一条规矩）：一进来还没说过话的时候
    //   这儿会写着"这一件是：还没定"，模型会当成老师在跟它交代一件叫"还没定"的课。
    //   没有那一档就不提那件事——这是那六次缺陷的共同根因，别再让它自己编。
    //   （判据取"课题／班级至少有一个"，不取"turns 为空"：老师可能先点着改了课题再说话。）
    var pk = (SR.memo && SR.memo.pocket) ? SR.memo.pocket() : null;
    if (pk && (pk.topic || pk.cls)) {
      var pkl = [];
      if (pk.topic) pkl.push('- 这一件是：' + pk.topic);
      if (pk.cls) pkl.push('- 班：' + pk.cls);
      if (pk.date) pkl.push('- 日子：' + pk.date);
      // ★ bagText 空的时候说的是"口袋空着"——那是一句**给老师看的话**，不是给模型的
      //   事实。原样搬过去会变成"他手上已经攒下：口袋空着"，模型得先解开这个弯才
      //   知道等于什么都没有。剥掉前缀；剩下"空着"就整条不写，没有的东西不提。
      //   ⚠ 这里**不做**逐字比对的自检：那会把 bagText 的措辞焊进 api.js，
      //     哪天口袋换句话说法，这段就静默地一条都不写了（[[scanner-numbers-are-not-what-they-claim]] 那类）。
      //     宁可多写一条"他手上已经攒下：空着"，也不要一条都不写。
      var pkb = ((SR.memo.bagText && SR.memo.bagText()) || '').replace(/^口袋：/, '');
      if (pkb && pkb.indexOf('空着') < 0) pkl.push('- 他手上已经攒下：' + pkb);
      // ★ 题号那一行（2026-10-03 加，为学情那一格）：光有"题 N 道"它排不了名次——
      //   **「口袋里有题号，成绩才排得出名次」**（模拟稿第⑤张）。
      //   来源是 js/memo.js 的 probs()：只从组卷吐的 ```材料 围栏里认题号，
      //   认不出来就是空数组、这一行**根本不出现**——那时候学情那份提示词里的
      //   规矩一会接住（"口袋里还没有题，先出几道或者直接告诉我题号"）。
      //   宁可让它说没有，也不要塞一个错题号进去，那个数老师会拿去讲课。
      var pkp = (SR.memo.probs ? SR.memo.probs() : []) || [];
      if (pkp.length) pkl.push('- 他出的那几道的题号：第 ' + pkp.join('、') + ' 题');
      sys += '\n\n---\n\n# 附：老师手上正在办的那一件事\n\n' +
        '（这不是新开的一段对话，是**同一件事**换到了【' + ((w && w.label) || work) + '】这道工序上。\n' +
        '上面这几行，他已经交代过了：\n\n' + pkl.join('\n') + '\n\n' +
        '★ 直接照它办：该出题就照这一件出，该画图就画这一件的图，该组卷就把这些填进抬头。\n' +
        '★ 只有上面**没有写**的东西才问他——写了的，不用再问一遍。）';
    }

    // ★ 收尾块放在**所有内容之后**，就为了占住"最后一段"这个位置。
    //   小模型（glm-4v-flash）只认最后读到的东西：实测同一份提示词，
    //   格式要求在中段时 ```想说 命中 0/6～1/6，挪到末尾的招在演示提示词上是从 5/8 提到 10/10 的。
    //   注意它必须在上面两段附注**后面**——附注是后拼的，这一步顺序不能动。
    // ★ 只有 tail:true 的工位（备课／讲评）追加。画图／出题**不追加**：
    //   那两份工位本来就要给答案、要出图，收尾块那些"你是问话的那个，不是解题的那个"
    //   会把输出硬拽回问句，跟它们要干的事正好相反。
    if (w.tail && SR.PROMPT_PREP_TAIL) sys += '\n\n---\n\n' + SR.PROMPT_PREP_TAIL;

    // ★ 作图那一格的收尾块（2026-10-03）。它跟上面那份**争的是同一个位置**——
    //   "最后一段"。小模型只认最后读到的东西（上面那段实测），而这里要它干的事
    //   比排版格式更难：**看着自己刚画的那张图**写三句老师接着要说的话。
    //   所以顺序只能是：附注 → 谁开着谁排最后。两格都开的那天再谈合并
    //   （现在 prep 开 tail、draw 开 say，两不相干，一个工位不会同时中两条）。
    //   ⚠ 这一段的**位置**就是它全部的本事：挪到前面等于没做（提示词里写规矩的
    //     那部分在三千字开外，小模型读不到那儿）。改这儿之前先看 test/probe_say.cjs。
    if (w.say && SR.PROMPT_SAY_TAIL) sys += '\n\n---\n\n' + SR.PROMPT_SAY_TAIL;
    return sys;
  }

  // ============================================================
  //  一次对话
  // ============================================================
  // opts: {work, history, text, parts, onChunk, onNotice}
  //   work 见 js/config.js 的 SR.WORKS；不传就当默认工位（备课）。
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
    var roundImg = false;
    for (var pi = 0; pi < parts.length; pi++) if (parts[pi] && parts[pi].kind === 'image') { roundImg = true; break; }

    // ★★ 分流不能只看"这一轮带没带图"，还得看**历史里留不留着图**（2026-10-01 修的事故）。
    //   孔老师实测：第一轮发了一张卷子照片，第二轮打字问"不是发给你图了吗"——这一轮
    //   没带图，于是分流到 modelsText[0] = glm-4-flash-250414（**文字**模型），可历史里
    //   第一轮那条消息是**数组格式**（[{text},{image_url}]），trimHistory 原样放行，
    //   文字模型当场 400：1210「messages.content.type 参数非法，取值范围 ['text']」。
    //   直接打 API 验过同一段历史：glm-4-flash-250414 报 1210，glm-4.6v-flash 与
    //   glm-4v-flash 都是 200。所以**带图的历史必须走带图那条链**——这段对话讲的就是
    //   那张图，模型得看得见它；把历史里的图压成文字等于蒙上它的眼睛，它会反问"题目是什么"。
    // ★ 预算按**没裁过的那份**判：裁之前有图就得按带图给预算，不然预算先砍小、图再被
    //   裁掉，就成了自己把自己判成"没图"。
    var anyImg = roundImg || histHasImage(opts.history);

    // ★ 带图那一轮单独给历史预算（b.budgetImage）。b.budget 是按免费通道
    //   最小那颗模型的 16K 上下文量的；带图走的是 128K 的 glm-4.6v-flash，
    //   而一整张卷子的五六页图本来就占掉两千多字符当量，再用 7000 去裁，
    //   历史会被裁到只剩最后一轮——学生上一句说"我算到 x=4"就白说了。
    var budget = (anyImg && b.budgetImage) ? b.budgetImage : b.budget;
    var hist = trimHistory(opts.history || [], budget);
    // 真发出去的那一份里还有没有图——**裁完再判一次**。真被裁掉了就退回文字链，
    // 否则等于让文字模型去啃一个根本没发给它的东西。
    var hasImg = roundImg || histHasImage(hist);

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

    // ★★ 流水线（2026-10-02，阶段五）：检索那两步**提到 buildSystem 外面**来跑。
    //   提出来才有"每一步看得见"和"翻歪了能单独重跑"——原来它藏在 buildSystem 里面
    //   两行同步调用，跑完界面上一个字都不说，中间那一步你也改不了。
    //   顺序是**云上优先、本机兜底**，理由见 js/flow.js 三、那段：课本原文不该下到浏览器。
    // ★ 这一段永远不许把对话挡掉：出错就当没翻到，附注走"没检索到"那一档，
    //   跟加知识库之前一模一样（这是 kb.js 顶上那条自律，这里是它的第二道）。
    var round = SR.flow ? SR.flow.start(opts.work, opts.text) : null;
    var hit = null;
    if (round) {
      try { hit = await SR.flow.retrieve(round, recall); }
      catch (e) { hit = null; }
    }

    var sysText = buildSystem(opts.work, recall, b.id, parts, hist, hit);
    if (round) {
      // 「每步可见产物」在这一步上是**真发出去的那一整段 system**——想看它到底拿到了什么，
      // 展开就是原文，不用再去翻 SR.api.lastSystem。
      SR.flow.done(round, 'prompt', {
        out: sysText, ms: 0,
        note: sysText.length + ' 个字（含收尾块，这是真发出去的那一段）'
      });
      SR.flow.set(round, 'reply', { state: 'run' });
    }
    // ★★ 2026-10-02 加：把**真发出去的那一段 system** 留一份。
    //   起因是探针开头那行「提示词 N 字符（含收尾块）」——那个 N 是探针自己
    //   拿 prompt()+TAIL 拼出来的一段**估算**，它算漏了按轮次现挂的三样东西
    //   （教材索引、追问条目库、第一轮的「几路」）。量具报的数字不是它宣称的那件事，
    //   这是同一个家族的第七次。现在探针直接读这一份，看的是真发出去的长度。
    //   只留字符串，跟 SR.chat.lastRaw 一个性质，不进 DOM、不外发。
    SR.api.lastSystem = sysText;
    var msgs = [{ role: 'system', content: sysText }]
      .concat(hist)
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
      //   ★ 走哪一条链，看两件事：**这个工位是哪种取向**（SR.WORKS[x].chain）、
      //     **这会儿手里有没有图**——注意 hasImg 是"这一轮带图 **或** 历史里还留着图"，
      //     别退回只看这一轮（2026-10-01 的 1210 就是这么来的，见 ask 里那段）。
      //     chain:'board'（画图／出题）——两个后端都走 models。
      //       glm-4v-flash 在这条上是 6/6（围栏全中），而文字模型不认 ``` 围栏，
      //       会把画板命令当普通文字打出来：
      //         〔正文〕ggb ⏎ #清空 ⏎ 数轴 ⏎ t=Slider(-4,4,0.1) ⏎ …
      //       两个工位的命根子都是围栏，不能交给文字模型。
      //     chain:'role'（备课／讲评）——带图走 modelsImage、不带图走 modelsText。
      //       modelsImage 那条链上只有守得住规矩的模型，挤不动时会直接报
      //       "通道挤了、切自己的 Key"，**不会**降级到会解题的那两颗（详见 config.js）。
      //       不带图走 modelsText：文字那颗会当老师，正文稳；围栏丢了有 chips.js 本地兜底。
      //     DeepSeek 三条都没配，一律回落到 models。
      var w = SR.WORKS[opts.work] || SR.WORKS[SR.DEFAULT_WORK];
      var chain;
      if (w.chain === 'board') chain = b.models;
      else if (hasImg) chain = b.modelsImage || b.models;
      else chain = b.modelsText || b.models;

      // ★ 单模型链（就是带图那条）必须给足重试：链上只有一个，一次 429 就失败太亏。
      //   429 是秒回的，等一下再打很便宜，而"降级"在这条链上是不能用的选项。
      //   链长的时候反而少试几次——后面还有别的模型可换，别在一颗上耗太久。
      // ★★ 4 → 7 次（2026-10-01 孔老师拍的）：`glm-4.6v-flash` 现在很挤，
      //   实测凉 150 秒后连打两次仍是 429/1305，六次里才通一次；而带图那轮
      //   **没有备份可降级**（另两颗免费视觉模型会把题解出来，见 config.js）。
      //   真跑一遍"发图"那轮，就是在第 3～4 次上通的——4 次差一点点，7 次有余量。
      //   代价：最坏纯等待约 18 秒（1.35+2.0+2.65+3.3+3.95+4.6）。他认了这个代价，
      //   理由是**让学生多等几秒，比直接甩一句报错强**。
      var TRIES = chain.length > 1 ? 2 : 7;
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
      if (round) SR.flow.done(round, 'reply', { out: all, note: model + (got ? '，接着往下说了' : '') });
      return { text: all, model: model, backend: b.id };

    } catch (e) {
      if (round) SR.flow.fail(round, 'reply', '这一步没成：' + ((e && e.message) || e));
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
