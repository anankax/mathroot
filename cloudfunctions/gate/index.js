// 数根的云函数 gate —— 「一步」的执行器。
//
// 为什么有它（孔老师 2026-10-02 定下的第七件事）：
//   数根每个工位都是"一句话进去、一段回答出来"，账本（提示词、知识库检索、
//   链子状态）全在浏览器里。这本来没问题——直到要往外接东西：
//     ① Key 摆在网页上（js/config.js 那一行），谁都能拿去用；
//     ② 一步里想"重试一次""先校验这段回复的形状对不对"，浏览器里做不了；
//     ③ 以后要调学科网／知网那类不许浏览器直连的接口，浏览器根本够不着。
//   这三件事都需要一个"服务器上的自己人"。gate 就是这个角色。
//
// ★★ 分界线（别越过）：**云函数知道"这一步该长什么样"，不知道"这一步该怎么说"。**
//   提示词、链子状态留在浏览器（js/prompt-prep.js 仍是提示词的唯一一份）。理由在计划
//   文件里：这个仓库已经在"两份同样的措辞"上吃过一次亏（test/check_prep_prompts.cjs
//   那份 SAME 表就是为防它而写的）。云函数里再放一份就是第三份，而且**那一份探针够不着**
//   ——跑不了 CDP、进不了尺子，哪天漂了没有任何东西会报。
//   ⚠ 形状表那份重复（下面 STEPS 那段）是**已知的代价**，它的哨兵是
//     test/check_gate_contract.cjs：拿前端同名的表逐项比。那份脚本还没写（阶段五）。
//
// ★★ 第 2 版加的一件事：**知识库那两步也上云了**（textbook / zhuawen，见下面 KB 那段）。
//   这一条**改了上面那句"检索留在浏览器"**，得说清楚为什么，不然下一个人会以为写错了：
//     原来检索整个在浏览器做 → 要让云上也能检索，只剩"把整份语料下到浏览器"这条路
//     → 那等于把课本原文发到公开站上，正是 js/textbook.js 那条线要挡住的事。
//     搬进云函数之后，语料待在**代码包里**（不进仓库，见 .gitignore 那条），
//     浏览器只拿到**这一次查到的几条**。
//   ★ 但要诚实：这不是零泄漏。口令明文在网页上，谁都能拿它按 118 个问法把整份语料
//     一条条问下来。所以这道门的性质是**门槛**（跟前面三样一样），不是保密。
//     真要一点不落进浏览器，得连**组装提示词**也搬上云——那跟"提示词不上云"直接冲突，
//     是一个单独的决定，不在这份里。
//
// ★★ 它同时是一道**门槛**，但**不是安全**。这话必须说白，不然会误以为有它就不用管了：
//   这个函数是公开的，谁扫到域名都能调。挡的三样——
//     · 口令 —— 会明文写在 js/config.js 里（网站上人人可见），挡不住看源码的人；
//     · Referer —— curl 随手就能伪造；
//     · 每日次数 —— **是软的**，见下面 daily 那段。
//   它们挡的是"顺手扫到的脚本"，不是"存心要烧额度的人"。
//   真正兜住钱包的那条得接数据库做**持久**计数，那是下一步，不在这份里。
//   今天用的是免费那档 GLM Key：脚本最多把它打到限流，**不产生账单**。
//   换付费 Key 那天，持久上限必须先补上。
//
// ★ 为什么是 HTTP 云函数（不是事件函数 + 网关）：
//   浏览器要跨域直接调它，CORS 得自己说了算；以后要做流式也得走它。
//   事件函数走网关那条路，CORS 不由自己控制，流式基本没戏。
//
// ★ 这一版**只做非流式**（`{text, tries, ms}`，就是计划里那个契约）。
//   不做 SSE 是故意的：现在还没有任何东西消费流式，写了就是一段没跑过的代码。
//   主对话那条"一个字一个字写出来"的感觉暂时还是浏览器直连，等这一步稳了再说。

const http = require('http');
const { URL } = require('url');

const PORT = 9000;
// ★ 版本号在**每次改了行为**时都要往上走一格。它不只是给人看的：
//   SCF 的旧实例会**热着继续跑旧代码**（2026-10-02 实测过——reslib 那边
//   一次回包少了三个新字段、多了个旧的，就是因为调用打到了一个升级前就在的实例上）。
//   有这个号，一眼就能判"这次答话的是新代码还是旧实例"，不用去猜回包形状。
//   gate-3：加了 reslib 那一步（资源库检索）。
//   gate-4：加了云存储库那两步（liblist 列桶 / libsign 签原件）。
//     ★ 升这个号的直接原因就是下面这条：热实例会拿旧代码答话。
//       你要是看见回包里 version 还是 gate-3，那就是**打到了升级前就在的实例**，
//       这一次的读数作废（不是"改动没生效"）。
const VERSION = 'gate-4';

// 上游：智谱 GLM，OpenAI 兼容协议。跟 js/config.js 里那个 URL 是同一个。
const UPSTREAM = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

// ---- 只许调白名单里的模型 ----
// ★ 这是一条**硬的**护栏（不像每日次数）：调用方在 body 里写什么模型名都不算数，
//   不在这张表里的一律拒。没有它，谁都能让我们去调一颗按 token 计费的贵模型。
//   以后接了付费 Key，这张表就是花钱的那道闸。
const ALLOW_MODELS = ['glm-4-flash-250414', 'glm-4v-flash', 'glm-4.1v-thinking-flash', 'glm-4.6v-flash'];

// ---- 另外两条硬的护栏（都是无状态的，所以真能挡住）----
const MAX_TOKENS_CAP = 2048;      // 单次输出上限。调用方要不上去，我们就按这个封顶
const MAX_CHARS = 300000;         // system + user 合计字符上限（备课提示词 11711 字，留足余量）

// ---- 环境变量（只有这一处读，别在别处再读一遍）----
//   GLM_KEY    —— 模型 Key。**只存在云函数环境变量里，不进代码、不进仓库、不进前端。**
//   GATE_TOKEN —— 口令。会同步写在 js/config.js（公开），所以它只是门槛。
//   DAILY_CAP  —— 每天最多让数根调多少次模型。
const KEY = String(process.env.GLM_KEY || '').trim();
const TOKEN = String(process.env.GATE_TOKEN || '').trim();
const DAILY_CAP = Math.max(1, parseInt(process.env.DAILY_CAP || '200', 10) || 200);
// 知识库那两步的每日次数。它不花钱，所以给得宽；它要挡的是"按 118 个问法把整份语料
// 一条条问下来"。★ 同样**不新增环境变量**——新变量我这边改不了（实测过：MCP 写进
// 函数的环境变量改了、实例重启了，值还是旧的），默认值放在代码里最省事。
const KB_DAILY_CAP = Math.max(1, parseInt(process.env.KB_DAILY_CAP || '2000', 10) || 2000);
// 允许的站点来源。GitHub Pages 上是 anankax.github.io；本机调试时在环境变量里加
// localhost 那段（用 | 分隔），别改代码。
const ALLOW_ORIGIN = String(process.env.ALLOW_ORIGIN || 'https://anankax.github.io').split('|');

// ============================================================
//  每日次数（★ 软的，说清怎么个软法）
// ============================================================
// ★ 它是**模块级变量**，也就是说：
//     每个函数实例各记一份 → 同时开 5 个实例，就有 5 份 200 次；
//     冷启动归零         → 实例被回收再拉起来，计数从 0 开始。
//   所以它**不是**"每天最多 200 次"这条保证，它是"每个活着的实例每天最多 200 次"。
//   真要那条保证，得把这两个数写进数据库。**这一步没做，也不假装做了**——
//   上面那三行"硬的护栏"才是今天真正在起作用的东西。
//   ★ 别把这里改成 SR 那种"看起来更严谨"的写法（比如按小时滑窗）：一小时内同样会归零，
//     只是把"软"这件事藏得更深了。
// 北京时间的今天（云函数默认 UTC，直接切会把"今天"错开八小时）
function today() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
// ★ 两份计数：模型那几步一份（DAILY_CAP），知识库那两步一份（KB_DAILY_CAP，见下面 KB 那段）。
//   知识库那两步不花钱，但要挡住"拿公开口令按 118 个问法把整份语料问下来"这种扫法。
//   ★ 软的程度**完全一样**（实例内存、冷启动归零），别把它当成真上限。
let day = today(), used = 0, kbUsed = 0;
function roll() {
  const d = today();
  if (d !== day) { day = d; used = 0; kbUsed = 0; }
}
function bumpUsed() { roll(); return ++used; }
function bumpKbUsed() { roll(); return ++kbUsed; }
function peekUsed() { roll(); return used; }
function peekKbUsed() { roll(); return kbUsed; }

// ============================================================
//  形状表：每个 step 的回话"该长什么样"
// ============================================================
// ★ 这张表**只管形状，不管内容**。"这句追问像不像老师说的"那种判断，机器做不了，
//   也不该做——那是孔老师一个人看得出来的事（计划文件里的验收那节写着）。
//   这里只问"能不能数出 2~4 条路"这种**可数**的问题。
// ★ 未知 step 一律放行不回炉：流水线还在长，多一个名字就多一次误伤的风险。
//   宁可少校验一次，也别把一句好回复回炉成一句坏的。
function countRoutes(t) {
  // 「1. …」「2、…」「第 3 条」这类开头各算一条路
  const m = t.match(/^[ \t　]*(?:第[ \t]*)?[1-4一二三四][ \t]*[、.．)）:：]/gm);
  return m ? m.length : 0;
}
const STEPS = {
  // 认课题：只要不是空的、不是一句"我不知道"。这一步出的是课题名，没有形状可言。
  topic: { check: (t) => t.trim().length >= 2 },
  // 出几路：必须真能数出 2~4 条路
  routes: { check: (t) => { const n = countRoutes(t); return n >= 2 && n <= 4; } },
  // 展开一个环节：必须能读到环节名（「第 N 个环节 · 名字」或「第 N 节 · 名字」）
  step: { check: (t) => /第[ \t]*\d+[ \t]*[个]?[ \t]*(?:环节|节)/.test(t) },
  // 收尾：导图 + 打包，出的是清单，只要求非空
  wrap: { check: (t) => t.trim().length >= 2 }
};

// ============================================================
//  知识库：两步**不调模型**的步骤（textbook / zhuawen）
// ============================================================
// ★ 语料和检索器都在 ./kb.js 里，那份**由 test/build_prompt.py 生成**，
//   内容是 ① js/retrieve.js 的源码**原样**嵌进去 ② 两份语料（教材索引 / 118 条追问条目）。
//   ★ 为什么不"照着重写一遍"：那样云上算出来的分跟本机算出来的分就会**慢慢不一样**，
//     而这正是最难发现的一类坏——它就静静地少召回两条，没有任何东西会报。
//     原样嵌进去以后，"云上==本机"是**按构造成立**的，test/probe_kb_cloud.cjs 逐条比。
//   ★ 它不在仓库里（.gitignore 有一条），但**在部署的代码包里**——MCP 是从本机这个目录
//     打包上传的，不看 git 里有什么。
//   ★ 拿不到就只关这两步，**不关整个函数**：语料没装上，模型那几步照样该能用。
let KB = null, KB_ERR = '';
try {
  KB = require('./kb.js');
} catch (e) {
  KB_ERR = String((e && e.message) || e);
}

// ---- 资源库那一步（reslib）：跟上面同一个思路，只是语料在数据库里 ----
// ★ 三份文件都在本目录下，逐字节拷贝自 cloudfunctions/reslib/，哨兵 test/check_reslib_core.cjs：
//     reslib-core.js      打分那套
//     reslib-pg.js        读库那半（分页 / 缓存 / 平台临时凭证）
//     reslib-retrieve.js  取→算→拼成回给浏览器的形状
//   为什么不直接 require cloudfunctions/reslib/ 那一份：**云函数按目录打包**，
//   跨目录 require 到了云上就是 MODULE_NOT_FOUND。所以只能复制——复制就得有哨兵。
//   ★ 为什么这三份非共享不可：里面装的都是**决定数字对不对**的东西（打分、分页、拼结果）。
//     各写一遍的后果是"少取了几行""分了不一样的分"，而这两种跟"没命中"从外面看**一模一样**。
// ★ 它**不新增环境变量**（同 KB_DAILY_CAP 那条：新变量我这边改不了）。
// ★ `@cloudbase/manager-node` 是在 reslib-pg.mgr() 里**懒加载**的，所以下面这行
//   require 不会因为依赖没装上就炸——依赖没装成这件事到第一次真查库时才现形，
//   那时走 runRes 的软降级。
let RES = null, RESPG = null, RES_ERR = '';
try {
  RES = require('./reslib-retrieve.js');
  RESPG = require('./reslib-pg.js');
} catch (e) {
  RES_ERR = String((e && e.message) || e);
}

// ============================================================
//  云存储库：两步**不调模型**的步骤（liblist / libsign）
// ============================================================
// ★ 为什么这两步必须开在 gate 上、不能像 js/resources.js 那样在浏览器里读：
//   桶 `materials` 是**私有**的，浏览器手上没有（也不该有）能读它的凭证。
//   能读它的只有这一处——这就是它叫"门房"的意思。
//
// ★★ 这两步**不是一回事**，可用性必须分开报（见 /health 里那段），别合成一个 ready：
//     liblist  列桶里有什么 —— 查的是 storage.objects 那张表，走的是跟 reslib
//              **同一条** executePGSql / 同一份平台临时凭证。**不需要下面这把钥匙。**
//     libsign  签一份原件的下载地址 —— 打的是存储的 HTTP 口，**需要 CLOUDBASE_APIKEY**。
//   合成一个的后果很具体：他没配钥匙，界面上会显示成"整个云存储库不能用"，
//   而实际上"库里有什么"这一半是好的。
//
// ★ 凭证从环境变量来，**绝不进代码、不进日志、不进回包**。
//   它是一把 service_role 级的钥匙，比 GATE_TOKEN 强得多——GATE_TOKEN 是**公开**的
//   （写在 js/config.js 里）。所以下面那道 badKey 不是泛泛的"防注入"，
//   它是一条具体的边界：**门这头是公开口令，那头是管理员钥匙**。
//   没有它，任何人拿到公开口令就能让 gate 去签别的桶、别的对象，或者拿 ../ 越界。
//   ⚠ 它的值我这边碰不到也不该碰（要配也是他自己在控制台粘）——所以下面只判"在不在"。
const STORE_KEY = String(process.env.CLOUDBASE_APIKEY || '').trim();
const STORE_BUCKET = 'materials';
const STORE_HOST = (RESPG ? RESPG.ENV_ID : 'kax1014-d1g5uttgka7757f39') + '.api.tcloudbasegateway.com';
const SIGN_TTL = 1800;          // 签出来的地址活多久（秒）。够点一下下载，不够拿去转发。
const LIB_MAX = 4000;           // 列桶的安全阀：超了就**报错**，不悄悄截断

// 对象名只许是 safeKey 造得出来的那些字符（见 reslib-pg.js 的 keyOf）。
const KEY_OK = /^[A-Za-z0-9\-_. +/一-鿿]+$/;
function badKey(k) {
  const s = String(k || '');
  if (!s) return '没有 key';
  if (s.length > 400) return 'key 太长了';
  if (s[0] === '/' || s.indexOf('..') >= 0 || s.indexOf('//') >= 0) return 'key 里有不该有的路径';
  if (!KEY_OK.test(s)) return 'key 里有桶不认的字符（该是 keyOf(doc) 算出来的那一个）';
  return '';
}

// 逐段 encodeURIComponent——跟上传时同一个做法（test/upload_materials.cjs）。
function encKey(k) { return String(k).split('/').map(encodeURIComponent).join('/'); }

function storeReq(method, p, body) {
  return new Promise((resolve) => {
    const https = require('https');
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const r = https.request({
      hostname: STORE_HOST, path: p, method: method,
      headers: Object.assign({ Authorization: 'Bearer ' + STORE_KEY },
        payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
    }, (res) => {
      // ★ 收 Buffer。别 `d += c`——那样二进制会被按 utf8 隐式转一次，必掉字节
      //   （本地探针头一次就栽在这儿，见 test/_sign_probe.cjs 那段注释）。
      const bufs = [];
      res.on('data', (c) => bufs.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(bufs) }));
    });
    r.on('error', (e) => resolve({ status: 0, err: String((e && e.message) || e) }));
    r.setTimeout(15000, () => r.destroy(new Error('存储接口 15 秒没回')));
    if (payload) r.write(payload);
    r.end();
  });
}

// 列桶里有什么。给面板那个"库里有什么"的浏览态用。
async function runList(res) {
  const t0 = Date.now();
  if (!RESPG) {
    return sendJson(res, 503, { ok: false, via: 'gate', step: 'liblist', error: '读库那几份没装进来：' + RES_ERR });
  }
  if (peekKbUsed() >= KB_DAILY_CAP) {
    return sendJson(res, 429, { ok: false, via: 'gate', step: 'liblist', error: '检索今天查得太多了（' + KB_DAILY_CAP + ' 次）。' });
  }
  let items;
  try {
    items = await RESPG.listObjects();
  } catch (e) {
    const why = String((e && e.message) || e).slice(0, 200);
    if (RESPG) RESPG.noteErr(e);
    return sendJson(res, 502, { ok: false, via: 'gate', step: 'liblist', error: '列桶没成：' + why, ms: Date.now() - t0 });
  }
  if (items.length > LIB_MAX) {
    // ★ 跟 reslib 那条分页安全阀一个道理：到这儿宁可**报错**，也不悄悄截一段交出去——
    //   "截了一段"跟"库里就这么多"从外面看一模一样。
    return sendJson(res, 502, { ok: false, via: 'gate', step: 'liblist',
      error: '桶里有 ' + items.length + ' 个对象，超过一次列完的安全阀（' + LIB_MAX + '）。' });
  }
  bumpKbUsed();
  return sendJson(res, 200, {
    ok: true, via: 'gate', version: VERSION, step: 'liblist',
    bucket: STORE_BUCKET, n: items.length, items: items, ms: Date.now() - t0
  });
}

// 签一份原件的下载地址。
// ★ 只回 **fullSignedURL**，不回 signedURL：实测那个是**相对路径**（不以 http 开头），
//   给浏览器直接点会打到本站上——而"下回来一页本站的 HTML"看着也像下载成功。
// ★ 这一步出错**要响亮地报**（不像 reslib 那条软降级）：它是老师**点了按钮**才发生的，
//   静默失败等于按钮没反应。
async function runSign(res, body) {
  const t0 = Date.now();
  if (!STORE_KEY) {
    return sendJson(res, 503, { ok: false, via: 'gate', step: 'libsign',
      error: '云存储库的钥匙没配：gate 的环境变量里没有 CLOUDBASE_APIKEY' });
  }
  if (peekKbUsed() >= KB_DAILY_CAP) {
    return sendJson(res, 429, { ok: false, via: 'gate', step: 'libsign', error: '今天签得太多了（' + KB_DAILY_CAP + ' 次）。' });
  }
  const key = String(body.key || '');
  const why = badKey(key);
  if (why) return sendJson(res, 400, { ok: false, via: 'gate', step: 'libsign', error: why });
  const secs = Math.max(60, Math.min(3600, parseInt(body.expiresIn, 10) || SIGN_TTL));

  const r = await storeReq('POST',
    '/v1/storages/object/sign/' + STORE_BUCKET + '/' + encKey(key), { expiresIn: secs });
  if (!r.status) {
    return sendJson(res, 502, { ok: false, via: 'gate', step: 'libsign', error: '连不上存储：' + (r.err || '') , ms: Date.now() - t0 });
  }
  const txt = r.buf.toString('utf8');
  let o = null;
  try { o = JSON.parse(txt); } catch (e) { o = null; }
  if (r.status !== 200 || !o || !o.fullSignedURL) {
    // 上游的错原文（INVALID_PARAM 那种）截一段带出去——排错全靠它。
    // ★ 只带 code/message，**不带整个回包**：万一哪天回包里混进了跟凭证有关的东西，
    //   整包转出去就是把它递给了调用方。
    const code = o ? String(o.code || '') : '';
    const msg = o ? String(o.message || '') : txt.slice(0, 160);
    return sendJson(res, 502, { ok: false, via: 'gate', step: 'libsign',
      error: '存储那儿没签成（HTTP ' + r.status + '）' + (code ? ' ' + code : '') + '：' + msg.slice(0, 160),
      ms: Date.now() - t0 });
  }
  bumpKbUsed();
  return sendJson(res, 200, {
    ok: true, via: 'gate', version: VERSION, step: 'libsign',
    bucket: STORE_BUCKET, key: key, url: o.fullSignedURL, expires: secs, ms: Date.now() - t0
  });
}

// 这一步取几条。跟浏览器里的调用点对齐（js/api.js 的 pickTextbook/pickZhuwen）。
// ★ 调用方可以传 k 覆盖，但有上下限——别让一次请求把 118 条全拖回去。
const KBS = {
  textbook: { find: 'findTextbook', k: 2 },
  zhuawen: { find: 'findZhuawen', k: 1 }
};
const KB_K_MAX = 8;
const KB_QUERY_MAX = 2000;   // 查询串上限（浏览器那边 queryFor 是 240 字，留足余量）

// 资源库那一步取几条。默认 3、上限 8——跟调试台 reslib/index.js 的上下限**对齐**，
// 不然同一个问题在调试台上问和在线上问会拿回条数不同的结果。
const RES_K = 3;
const RES_K_MAX = 8;
const RES_QUERY_MAX = 2000;

// 语料里有几条。用来在自报家门里证明"语料真的在代码包里"——
// 不看这个的话，"检索跑了但一条没命中"和"语料根本没装"从外面看是一模一样的。
let KB_COUNT = null;
function kbCounts() {
  if (!KB) return null;
  if (KB_COUNT) return KB_COUNT;
  const n = (s) => (String(s || '').match(/^###[ \t]/gm) || []).length;
  KB_COUNT = { textbook: n(KB.TEXTBOOK), zhuawen: n(KB.ZHUAWEN) };
  return KB_COUNT;
}

// ============================================================
//  调一次模型
// ============================================================
async function callModel(step, body) {
  const model = ALLOW_MODELS.indexOf(String(body.model || '')) >= 0 ? body.model : ALLOW_MODELS[0];
  const system = String(body.system || '');
  const user = String(body.user || '');
  if (system.length + user.length > MAX_CHARS) {
    return { error: '这一步喂进去的东西太长了（' + (system.length + user.length) + ' 字），超过 ' + MAX_CHARS + '。' };
  }
  const maxTokens = Math.min(MAX_TOKENS_CAP, Math.max(1, parseInt(body.max_tokens || 1024, 10) || 1024));

  const t0 = Date.now();
  let r;
  try {
    r = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 1.0,
        max_tokens: maxTokens,
        stream: false
      })
    });
  } catch (e) {
    return { error: '连不上模型：' + ((e && e.message) || e), ms: Date.now() - t0 };
  }
  const text = await r.text().catch(() => '');
  if (!r.ok) {
    return { error: '接口 ' + r.status + '：' + String(text).slice(0, 160), ms: Date.now() - t0 };
  }
  let o;
  try { o = JSON.parse(text); } catch (e) { return { error: '模型回的不是 JSON', ms: Date.now() - t0 }; }
  const msg = o && o.choices && o.choices[0] && o.choices[0].message;
  const out = msg && typeof msg.content === 'string' ? msg.content : '';
  return { text: out, model: model, ms: Date.now() - t0 };
}

// ============================================================
//  HTTP
// ============================================================
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Gate-Token',
  'Access-Control-Max-Age': '86400'
};
function sendJson(res, code, data) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS));
  res.end(JSON.stringify(data));
}
function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > MAX_CHARS * 3 + 10000) { raw = ''; req.destroy(); } });
    req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}
// Referer 只留来源那一段（浏览器跨域默认只发 origin）
function originOf(ref) {
  const s = String(ref || '').trim();
  if (!s) return '';
  const m = s.match(/^(https?:\/\/[^\/]+)/i);
  return m ? m[1] : '';
}

// 跑一步知识库。**不调模型、也不记模型次数**。
// ★ 返回的 hits 形状跟浏览器里 SR.findTextbook 的返回值对齐（title / score / body / text），
//   所以前端那条分数线（SR.kb.cut，量出来的 6 和 10）一行都不用改——分数线留在浏览器，
//   调它不用重新部署。
// ★ 查询串由**浏览器**拼好送来（SR.kb.queryFor 会把学生自己前面说过的话接上，
//   治的是"话里没点名知识点就召不回"）。"这一步该怎么说"留在浏览器，这里只管检索。
function runKb(res, step, body) {
  const t0 = Date.now();
  const spec = KBS[step];
  if (!KB) {
    return sendJson(res, 503, { ok: false, via: 'gate', step: step, error: '云上这份语料没装进来：' + KB_ERR });
  }
  if (peekKbUsed() >= KB_DAILY_CAP) {
    return sendJson(res, 429, { ok: false, via: 'gate', step: step, error: '知识库今天查得太多了（' + KB_DAILY_CAP + ' 次）。' });
  }
  const query = String(body.query || '').slice(0, KB_QUERY_MAX);
  if (!query.trim()) return sendJson(res, 400, { ok: false, via: 'gate', step: step, error: 'query 是空的' });
  const k = Math.max(1, Math.min(KB_K_MAX, parseInt(body.k || spec.k, 10) || spec.k));
  let hits;
  try {
    hits = KB[spec.find](query, k) || [];
  } catch (e) {
    return sendJson(res, 502, { ok: false, via: 'gate', step: step, error: '检索挂了：' + ((e && e.message) || e) });
  }
  bumpKbUsed();
  return sendJson(res, 200, {
    ok: true,
    via: 'gate',
    version: VERSION,
    step: step,
    query: query,
    k: k,
    // ★ 分数**原样返回**，不四舍五入：这道门的全部价值就是"跟本机算出来的一模一样"，
    //   修约会把真正的走样（换了语料、改了检索器）也一起抹平一小截。
    //   探针那边用容差比（见 test/probe_kb_cloud.cjs）。
    hits: hits.map(function (h) {
      return { title: h.doc.title, score: h.score, body: h.doc.body, text: h.doc.text };
    }),
    ms: Date.now() - t0
  });
}

// 跑一步资源库检索（PG 里那 7706 块素材）。
// **不调模型、不记模型次数**——跟知识库那两步共用 KB_DAILY_CAP 那一道闸。
//
// ★★ 它跟 runKb 有一处**故意不一样**，别哪天"统一"回去：
//   runKb 出错回 502；这一步出错回 **200，hits 空，外加一个 why**。
//   理由：这条在线上是**可有可无的附注**，不是老师要的东西本身。
//   浏览器那边 js/api.js 写的是
//       try { hit = await SR.flow.retrieve(round, recall); } catch (e) { hit = null; }
//   ——附注没了就当"这一轮没翻到"，照旧把提示词发给模型、照旧出答案。
//   所以**读库失败绝不该变成老师看见的报错**（cloudfunctions/README.md 那条软降级）。
//   ★ 但"软"不等于"瞒"：why 原样带回那次的错，/health 里还有 last_err，
//     这样"资源库挂了"跟"这一问真没命中"仍然分得开——
//     这两个从外面看本来就一模一样，是这类项目反复栽的地方，宁可多带一个字段。
async function runRes(res, body) {
  const t0 = Date.now();
  if (!RES) {
    // 这一档是**装错了**（文件没打包进来），不是运行时抖动——照 runKb 的规矩响亮地报。
    return sendJson(res, 503, { ok: false, via: 'gate', step: 'reslib', error: '资源库那几份没装进来：' + RES_ERR });
  }
  if (peekKbUsed() >= KB_DAILY_CAP) {
    return sendJson(res, 429, { ok: false, via: 'gate', step: 'reslib', error: '检索今天查得太多了（' + KB_DAILY_CAP + ' 次）。' });
  }
  const query = String(body.query || '').slice(0, RES_QUERY_MAX);
  if (!query.trim()) return sendJson(res, 400, { ok: false, via: 'gate', step: 'reslib', error: 'query 是空的' });
  const k = Math.max(1, Math.min(RES_K_MAX, parseInt(body.k, 10) || RES_K));

  let out;
  try {
    out = await RES.retrieve(query, k);
  } catch (e) {
    const why = String((e && e.message) || e).slice(0, 200);
    // 记进模块级 LAST_ERR，/health 里看得到（cacheInfo().last_err）
    if (RESPG) RESPG.noteErr(e);
    return sendJson(res, 200, {
      ok: true, via: 'gate', version: VERSION, step: 'reslib',
      query: query, k: k, hits: [],
      why: '资源库这次没读成：' + why,     // ★ 让"挂了"和"没命中"分得开
      ms: Date.now() - t0
    });
  }
  bumpKbUsed();
  // ★ 把 retrieve 的返回**原样**带出去（只盖掉 via/version/step）——
  //   调试台 reslib/ 回的就是这个形状（两处调的是同一个 retrieve），
  //   所以"调试台 == 线上"不只是算法一样，连回包都一模一样。
  //   分数、条数、账目（corpus_ms / corpus_cached / cache_hits）都跟着走，
  //   浏览器那边要看"这次是不是冷实例"就有得看。
  return sendJson(res, 200, Object.assign({}, out, { via: 'gate', version: VERSION, step: 'reslib' }));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const url = new URL(req.url || '/', 'http://127.0.0.1');

  // ---- 自报家门 ----
  // ★ 只回固定的几样，**绝不回显 req.headers / process.env**：网关会往请求里塞
  //   `x-cloudbase-context`（临时凭据），把它吐出去等于把钥匙递给调用方。
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    const mine = String(req.headers['x-gate-token'] || '') === TOKEN;
    return sendJson(res, 200, {
      ok: true, name: 'gate', version: VERSION,
      steps: Object.keys(STEPS), models: ALLOW_MODELS,
      // 知识库那两步单独列（它们不调模型、不花额度，所以不跟上面那张表混）
      //   ★ entries 是"语料真在代码包里"的证据——不看它的话，
      //     "检索跑了但没命中"和"语料根本没装"从外面看一模一样。
      kb: { steps: Object.keys(KBS), ready: !!KB, why: KB_ERR || null, entries: kbCounts() },
      // 资源库那一步也得有个"它到底在不在"的可看处——
      //   不然"资源库挂了"和"这一问没命中"从外面看一模一样。
      //   ★ cache 那一块**不会去读库**（cacheInfo() 只看内存里那个变量）：
      //     ready=false 只说明"这个实例还没读过"，不说明库坏了。
      reslib: {
        step: 'reslib',
        ready: !!RES,
        why: RES_ERR || null,
        cache: RESPG ? RESPG.cacheInfo() : null
      },
      // 云存储库那两步。★ 两件事分开报，理由见上面 STORE_KEY 那段：
      //   合成一个 ready 的话，"钥匙没配"会被读成"整个库都不能用"，
      //   而"列桶"那一半（走 PG、不走钥匙）本来是好的。
      lib: {
        steps: ['liblist', 'libsign'],
        bucket: STORE_BUCKET,
        list_ready: !!RESPG,
        sign_ready: !!STORE_KEY,          // ★ 只报"在不在"，**绝不报值、也不报长度**
        why: RES_ERR || null
      },
      // 这两个数要带口令才给（不然等于告诉扫站的人还剩多少额度好用）
      used: mine ? peekUsed() : null,
      cap: mine ? DAILY_CAP : null,
      kbUsed: mine ? peekKbUsed() : null,
      kbCap: mine ? KB_DAILY_CAP : null
    });
  }

  if (url.pathname !== '/') return sendJson(res, 404, { error: '没有这个路径' });
  if (req.method !== 'POST') return sendJson(res, 405, { error: '只认 POST' });

  // ---- 没配好就**关着**，别做成一个敞开的转发器 ----
  // ★ 这一条是刻意的：环境变量忘了填，最坏的结果必须是"不能用"，
  //   而不能是"谁都能用"。所以宁可整个函数 503。
  if (!KEY || !TOKEN) {
    return sendJson(res, 503, { ok: false, error: 'gate 还没配好（环境变量缺 GLM_KEY 或 GATE_TOKEN）' });
  }

  // ---- 门槛一：口令 ----
  const got = String(req.headers['x-gate-token'] || '');
  if (got !== TOKEN) return sendJson(res, 401, { ok: false, error: '口令不对' });

  // ---- 门槛二：来源 ----
  // ★ 只认来源那一段。**没带 Referer 的一律拒**——浏览器跨域一定会带，
  //   查不到的那次几乎一定是脚本。代价：服务端到服务端的调用得自己补一个。
  const org = originOf(req.headers.referer || req.headers.origin);
  if (ALLOW_ORIGIN.indexOf(org) < 0) {
    return sendJson(res, 403, { ok: false, error: '来源不对（' + (org || '没带 Referer') + '）' });
  }

  // ---- 先读 body：知识库那两步走的是**另一道闸**，得先知道这是哪一步 ----
  // ★ 把 readJson 挪到每日次数之前，就是为了这一步分岔。代价是"已被挡下的一轮"
  //   也会把 body 读完——口令和来源都已经验过了，不涉及谁白读我们的东西。
  const body = await readJson(req);
  if (!body) return sendJson(res, 400, { ok: false, error: 'body 不是 JSON' });
  const step = String(body.step || '');

  // ---- 知识库那两步：不花额度，所以不受 DAILY_CAP 管，自己的闸在 runKb 里 ----
  if (KBS[step]) return runKb(res, step, body);

  // ---- 资源库那一步也一样：不花额度，共用同一道闸（runRes 里那两条 peekKbUsed）----
  if (step === 'reslib') return runRes(res, body);

  // ---- 云存储库那两步：同上，也不花额度、共用同一道闸 ----
  if (step === 'liblist') return runList(res);
  if (step === 'libsign') return runSign(res, body);

  // ---- 门槛三：每日次数 ----
  if (peekUsed() >= DAILY_CAP) {
    return sendJson(res, 429, { ok: false, error: '今天到上限了（' + DAILY_CAP + ' 次）。明天再来，或者切到自己的 Key。' });
  }

  const shape = STEPS[step];

  // ---- 跑这一步，形状不对就回炉一次 ----
  // ★ 只重发**一次**：小模型同一份提示词连问两次，第二次多半还是一样。
  //   重发第二次是拿老师的等待换一点心理安慰，不值。
  //   ★ 两次都不合格时，**把第二次的原话交出去**，不报错——回炉是我们自己的
  //     洁癖，不该变成老师看见的失败。这一步的产物本来就允许不完美
  //     （提示词是软的，本地还有兜底）。
  let tries = 0, last = null, t0 = Date.now();
  while (tries < 2) {
    tries++;
    bumpUsed();
    last = await callModel(step, body);
    if (last.error) break;
    if (!shape || shape.check(last.text)) break;
  }
  if (last.error) {
    return sendJson(res, 502, { ok: false, via: 'gate', step: step, tries: tries, error: last.error, ms: Date.now() - t0 });
  }
  const good = !shape || shape.check(last.text);
  return sendJson(res, 200, {
    ok: true,
    via: 'gate',            // ★ 只有云函数会填这个字段——探针靠它判"是不是真走了 gate"
    version: VERSION,
    step: step,
    model: last.model,
    text: last.text,
    tries: tries,           // ★ 同上，也是只有 gate 会填
    shaped: good,           // 形状过没过。false 不代表失败，见上面那段
    ms: Date.now() - t0    // 全程毫秒（含重发的等待）
  });
});

server.listen(PORT);
