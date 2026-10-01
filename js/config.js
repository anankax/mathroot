// 「数根」——全局常量与模式定义。
// 要换后端、换模型、调出图速度，都只改这个文件。
var SR = (window.SR = window.SR || {});

// ============================================================
//  后端
// ============================================================
// 两个后端，都是 OpenAI 兼容协议、都允许浏览器直连（CORS 实测放行）。
//
//   glm      —— 默认。孔老师的智谱 Key 明文放在这里，访客零门槛直接用、不用注册。
//                这是权衡过的取舍（同「邰言邰语」那套）：不花钱、不部署、不动服务器，
//                代价是 Key 公开可被拿用。想收紧就把 SR.GLM_KEY 清空，
//                页面会自动落回"请自带 Key"那一档，其余一切照常。
//   deepseek —— 访客填自己的 Key，不烧孔老师的额度。
//
// ★ 免费视觉模型怎么挑的（2026-10-01 实测，别凭文档换）：
//   各打 5 次带图流式请求，结果差别很大——
//     glm-4v-flash            成功 5/5   平均  870ms   无思维链
//     glm-4.1v-thinking-flash 成功 5/5   平均 1564ms   思维链混在正文里（见 stripThink）
//     glm-4.6v-flash          成功 2/5   平均 4572ms   127 帧思维链   ← 高峰期基本调不动
//   单看连通性，glm-4v-flash 又稳又快，看着该选它。**但那是只看"通不通"得出的结论，
//   没看"守不守得住"**——同一张学生错解照片喂进去，它 4/4 把题解了（详见 modelsImage 那段）。
//   所以现在是分流的：演示模式要稳 → glm-4v-flash；学生传图要守规矩 → glm-4.6v-flash。
//   **稳，比参数漂亮要紧**这句仍然对，只是"稳"得按场景分别定义。
//
// ★ glm-4v-flash 的真实上下文是 **16K**（实测：15246 tokens 通过，再往上报 400/1210"输入过长"）。
//   我们那份学生提示词本身就 7541 tokens，一张图约 244 tokens，所以历史得**按 token 裁**——
//   见 SR.BACKENDS.glm.budget 和 api.js 里的 trimHistory。
//   别退回"按轮数裁"：24 轮短对话才 8865 tokens 看着没事，但学生贴长题时一轮就能吃掉几百 token。
SR.BACKENDS = {
  glm: {
    id: 'glm',
    label: '免费通道',
    hint: '不用注册，打开就能用',
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    // [主模型, 降级一, 降级二]。主模型 429 时依次往后试（智谱官方也是这个建议）
    // ★ 这一条走**演示模式**——演示是老师在画图，屏幕上没有学生的解答。
    //   glm-4v-flash 在演示那条链上是 6/6（围栏全中），演示的命根子就是围栏，所以它打头。
    models: ['glm-4v-flash', 'glm-4.1v-thinking-flash', 'glm-4.6v-flash'],
    // ★ 学生**上传了图片**那一轮走这一条。跟上面那条不是一回事，**别合并**。
    //   2026-10-01 实测（test/probe_image_prompt.cjs：一张"解方程 2x+1=7"的错解照片，
    //   学生问"我算出来 x=4，对不对"）：
    //     glm-4v-flash × 精简版：**把整道题解出来了 4/4**——"因此正确答案是 x=3，你算错了"。
    //       换成全量 v18 提示词照旧 4/4。所以这不是提示词的事，改提示词救不了。
    //     glm-4.1v-thinking-flash：给答案 3/5、判对错 3/5，还把自己的思考过程当正文念。
    //     glm-4.6v-flash：**守得住**，2/2 都是"这道题你当时是怎么做的？从第一步开始说。"
    //   ——所以只留最后一颗。前面两颗会替学生把题做了，**再挤也不许降级到它们**：
    //   宁可跟学生说"通道挤了，切自己的 Key"，也不能让"只问不答"这条命根子塌掉。
    //   代价是 glm-4.6v-flash 的 429 比另两颗密，所以 api.js 对单模型链给足重试次数。
    modelsImage: ['glm-4.6v-flash'],
    // ★ 不带图的时候走这一条（学生提问、答话、追问的那些轮，占绝大多数）。
    //   2026-10-01 实测，同一份精简提示词换颗模型，差别是决定性的：
    //     glm-4v-flash（视觉，9B）——**丢角色**。学生说"我不会"，它回
    //        "好的，老师，这道题我不会。请问我应该如何比较 -2 和 1 的大小呢？"
    //        它把自己当成学生了。砍长度（5303→3165 字）、换收尾块、拆掉剧本式样例、
    //        禁照抄，四轮全试过，说不会/纯计算题这两格始终是 0/6 和 1/6。
    //     glm-4-flash-250414（文字）——**正文完全对**：
    //        "这道题你当时是怎么做的？从第一步开始说。"（不回声、不念叨、约 1 秒）
    //        代价是 ```想说 围栏掉到 0/4——小模型一次只服从得了一件事。
    //   所以分流：要它"会当老师"的时候用文字那颗（正文更重要），
    //   要它"看得见图"的时候才用视觉那颗（没得选）。
    //   围栏丢了不要紧，按钮有本地兜底，见 js/chips.js。
    modelsText: ['glm-4-flash-250414', 'glm-4v-flash'],
    // 这颗是邰言邰语那边已经验过价目表的免费文字模型（"别用别名 glm-4-flash"，那个查不到价）
    // glm-4.1v-thinking-flash 的思考过程不是走 reasoning_content，而是
    // **以「<think>…」的纯文本混在 content 里**（实测 0 帧 reasoning_content，
    // 但正文开头就是 `<think>用户的问题是问…`）。不剥掉就直接念给学生听了。
    stripThink: true,
    keyInPage: true,      // Key 写在本文件里，不要用户填
    // ★★ false → true（2026-10-01 孔老师截图那次事故）。原来那句"GLM 不吃这个参数，
    //   别去惹它的参数校验"是**错的**——四颗 glm 全认（glm-4v-flash / glm-4-flash-250414 /
    //   glm-4.1v-thinking-flash / glm-4.6v-flash 实测都 200）。
    //   真问题是 `glm-4.6v-flash` **默认开着深度思考**，而 SR.MAX_TOKENS 只有 1024：
    //   实测同一段三轮历史打 6 次，**3 次正文 0 字**、finish_reason=length、
    //   思考帧 1023、completion_tokens=1024——额度被思考整段吃光，正文一个字不剩，
    //   学生那边就是红字「模型没说出话来」。另外 3 次也烧了 182/592/706，全是擦着上限过。
    //   显式关掉之后：0/4 空，completion_tokens 只用 **9~14**（省 80 倍），回复也快了一个量级。
    //   万一哪颗不认这个参数，api.js 有现成的 400 兜底：认出错误里带 thinking 就去掉重发。
    sendThinking: true,
    // ★ 学生提示词用精简版（prompt-lean.js，5303 字）**不是审美取舍，是实测逼出来的**：
    //   全量版 11711 字 = 7618 tokens 喂给 glm-4v-flash，```想说 围栏只中 2/4、0/4，
    //   正文还在照抄提示词里的例句（"（好）学生：…"）；换成精简版，同一颗模型、同一批用例，
    //   命中 4/4、4/4，抄例句清零，耗时从 13.8 秒降到 1.6 秒。
    //   全量版留给 DeepSeek——那份提示词就是在它上面逐版调到围栏 8/8 的，别动。
    //   两份都由 test/build_prompt.py 生成。演示模式的提示词两个后端共用，不分档。
    promptProfile: 'lean',
    budget: 7000,         // 留给对话历史的 token 预算（16K - 提示词 7541 - 图 244 - 输出 1024 - 余量）
    // ★ 带图那一轮单独放宽（2026-10-01 加）。上面那个 7000 是按**最小**那颗
    //   （16K 的 glm-4v-flash）量的，可带图走的是 modelsImage，链上只有
    //   128K 的 glm-4.6v-flash。而学生现在能一次发一整张卷子——五六页图
    //   就占掉两千多字符当量，再拿 7000 去裁，历史会被裁到只剩最后一轮：
    //   学生上一句"我算到 x=4"，下一句模型就忘了。
    //   这里给 30000，是"够放十几轮 + 一整份卷子"且仍远低于 128K 的数。
    //   真顶到上限时 trimHistory 会从最老的开始丢，不会报错。
    budgetImage: 30000
  },
  deepseek: {
    id: 'deepseek',
    label: '我的 Key',
    hint: '用你自己的 DeepSeek Key',
    url: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-flash'],
    stripThink: false,
    keyInPage: false,
    sendThinking: true,   // DeepSeek 默认吐思维链，要显式关掉
    promptProfile: 'full', // 全量 v18 提示词（同源生成，围栏 8/8 是它的数）
    budget: 120000        // 1M 上下文，够用，不必裁
  }
};
SR.DEFAULT_BACKEND = 'glm';

// ★ 孔老师的智谱 Key。下面这行由 test/inject_key.cjs 从邰言邰语那份 index.html 里灌进来，
//   不经过人手，免得复制粘贴出错。要换 Key：改邰言邰语那边，再跑一次注入脚本。
SR.GLM_KEY = 'a141b07a4071437f93eda23166d4132f.cfbEzD8ElFt95tjq';

// 思维链关掉。数根要的是干净的问句，不是它的推理过程。
// 万一哪天 DeepSeek 不认这个参数了，api.js 会自动去掉它重发一次。
SR.THINKING_OFF = { type: 'disabled' };

// ---- 本地存储 ----
SR.LS_KEY = 'mathroot_key';         // 自带 Key 时用，只存在使用者自己的浏览器里
SR.LS_MODE = 'mathroot_mode';       // 上次用的模式
SR.LS_BACKEND = 'mathroot_backend'; // 上次用的后端

// ---- 画板 ----
// ★ 必须是 classic（完整版）。原来用的 'graphing'（图形计算器）是个精简版，
//   实测 `线段(A,B)`、`圆(O,2)`、`多边形(A,B,C)`、`中点(A,B)`、`角(A,B,C)` 这些
//   几何命令它**一条都建不出东西**——右上角写着"GeoGebra 图形计算器"的那个不是它。
//   classic 既有函数又有几何，数轴、坐标系、三角形、圆、动点全都能画。
// ★ 而且 classic **本身就带 3D**（官方文档：3D 视图随时能从视图菜单加出来，
//   即引擎已加载、默认只是没显示），不用另换 appName。实测 setPerspective('T')
//   切过去就能画 Cube/Sphere/Cone/Cylinder/Plane/Rotate，切回 'G' 2D 一切正常。
SR.GGB_APP = 'classic';
SR.GGB_CMD_DELAY = 550;             // 每条 ggb 命令之间的间隔（毫秒）——图形"一点点长出来"的快慢
SR.GGB_WIDTH = 560;
SR.GGB_HEIGHT = 520;
// 3D 视图的默认取景（x/y/z 各 -4..4，y 轴竖着放）
SR.GGB_3D_RANGE = [-4, 4, -4, 4, -4, 4];

// ---- 请求参数 ----
SR.TEMPERATURE = 1.0;
SR.MAX_TOKENS = 1024;               // 数根的回复是短问句，不需要长

// ---- 超时（照邰言邰语的三段式）----
SR.WAIT_FIRST = 150000;             // 等第一个字
SR.WAIT_IDLE = 30000;               // 出了字之后，多久没动静算断
SR.HARD_CAP = 240000;               // 全程硬顶

// ---- 两个模式 ----
SR.MODES = {
  student: {
    id: 'student',
    label: '学生模式',
    badge: '只问不答 · 不给答案',
    prompt: function () { return window.SR.PROMPT_STUDENT; }
  },
  demo: {
    id: 'demo',
    label: '教师演示模式',
    badge: '可画可讲 · 公开课演示用',
    prompt: function () { return window.SR.PROMPT_DEMO; }
  }
};

// ---- 署名（要改署名，只改这三行）----
// ★ 这三行是**运行时的源头**：main.js 开机时会把页脚和画板水印的文案按它们刷一遍；
//   index.html 里那两处同样的字是**开机之前**显示用的，别只改那边——改完对不上，
//   画面会在开机那一瞬间跳一下。存图导出的署名也是照画板水印取的字，跟着走。
//   （2026-10-01：原先 SR.COPYRIGHT 定义了却没人读，页脚其实写死在 index.html 里。）
SR.AUTHOR = 'KAX';
SR.SITE = 'mathroot';
SR.COPYRIGHT = '© 2026 ' + SR.AUTHOR + ' · 数根 ' + SR.SITE + ' · 保留所有权利';
SR.WATERMARK = SR.AUTHOR + ' · 数根 ' + SR.SITE;
