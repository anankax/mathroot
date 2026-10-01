// 「数根」——全局常量与模式定义。
// 要换后端、换模型、调出图速度，都只改这个文件。
var SR = (window.SR = window.SR || {});

// ---- 后端（DeepSeek，浏览器可直连，CORS 实测放行）----
SR.API_URL = 'https://api.deepseek.com/chat/completions';
SR.MODEL = 'deepseek-flash';        // = DeepSeek-V4.1-Flash，1M 上下文，收图
// 思维链关掉。数根要的是干净的问句，不是它的推理过程。
// 万一哪天这个参数不被认了，api.js 会自动去掉它重发一次（照邰言邰语的写法）。
SR.THINKING_OFF = { type: 'disabled' };

// ---- 本地存储 ----
SR.LS_KEY = 'mathroot_key';         // DeepSeek Key，只存在使用者自己的浏览器里
SR.LS_MODE = 'mathroot_mode';       // 上次用的模式

// ---- 画板 ----
// ★ 必须是 classic（完整版）。原来用的 'graphing'（图形计算器）是个精简版，
//   实测 `线段(A,B)`、`圆(O,2)`、`多边形(A,B,C)`、`中点(A,B)`、`角(A,B,C)` 这些
//   几何命令它**一条都建不出东西**——右上角写着"GeoGebra 图形计算器"的那个不是它。
//   classic 既有函数又有几何，数轴、坐标系、三角形、圆、动点全都能画。
SR.GGB_APP = 'classic';
SR.GGB_CMD_DELAY = 550;             // 每条 ggb 命令之间的间隔（毫秒）——图形"一点点长出来"的快慢
SR.GGB_WIDTH = 560;
SR.GGB_HEIGHT = 520;

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
    prompt: function () { return window.SR.PROMPT_STUDENT; },
    // 学生模式下画板是"给他当纸用"的，模型只许出空底图
    extra: function () { return window.SR.TEXTBOOK; }
  },
  demo: {
    id: 'demo',
    label: '教师演示模式',
    badge: '可画可讲 · 公开课演示用',
    prompt: function () { return window.SR.PROMPT_DEMO; },
    extra: function () { return window.SR.TEXTBOOK; }
  }
};
