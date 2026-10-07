// 专题卡**在产品页面里**到底通没通 —— 走真页面、真 buildSystem、真模型。
//
// 为什么 Node 那把尺子（probe_drawfence.cjs）还不够：
//   那个探针是**自己按清单 require 文件**的，`js/drawkb.js` 是我手写进去的一行；
//   可产品页面上是 `index.html` 那个 <script> 标签说了算。两处一旦不一致
//   （标签漏了 / 路径打错 / 文件被 .gitignore 挡在仓库外），Node 那边照样全绿，
//   线上却是"SR.drawkb 是 undefined、那段静默跳过"——**看着全绿，其实一格没走**。
//
// ⚠ 探针纪律（都是踩出来的，别动）：
//   · 浏览器必须**开着窗口**（不带 --headless），用隔离档案 test/_chrome，绝不碰他那个 9222 的桌面 Chrome；
//   · 每次都要**硬重载**（dev server 会给 js 发 max-age，普通导航吃同源缓存，
//     会把"已生效"读成"没生效"）；
//   · 先 Network.enable 再 setCacheDisabled（顺序反了 setCacheDisabled 是空话）；
//   · 读数一律从 SR 里读，不扒 DOM。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
// ★ 「这一版的底座有多长」从磁盘现算 —— 别写死。详见 test/_base_len.cjs 顶上那段。
const 磁盘base = require(path.join(__dirname, '_base_len.cjs')).磁盘底座长度();
const PORT = 9222;
// ★ 「硬重载之后等开完机」共用那一份，别在这儿再抄一遍。见 test/_等开机.cjs。
const { 等开机 } = require(path.join(__dirname, '_等开机.cjs'));
const 话 = process.argv[2] || '画个圆，半径能拖的';
const 期望卡 = process.argv[3] || '圆';

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => { if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); } };
const 取 = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));

(async () => {
  const 列表 = await 取('/json/list');
  // ★★ 同源标签页会有一堆，`find()` 抓第一个**迟早抓错**（[[scanner-numbers-are-not-what-they-claim]]）。
  //   这里按 url 过滤，再**逐个核身份**（这一页里有没有 SR），核不出来的当场跳过。
  // ⚠ 别写死 `localhost` —— 这台风扇既可能是 localhost:8138 也可能是 127.0.0.1:8138，
  //   写死一个就会"本地明明开着却说没开"（第一次跑就栽在这儿）。
  const 候选 = 列表.filter(t => t.type === 'page' && /^(https?:\/\/)?(localhost|127\.0\.0\.1):8138/.test(String(t.url)));
  console.log('本地 8138 开着 ' + 候选.length + ' 个标签页，逐个核身份…');
  if (!候选.length) { console.error('★ 没有 8138 的标签页。先把探针浏览器开起来（可见窗口 + test/_chrome 档案 + 静态服务 8138）。'); process.exit(2); }

  let 会话 = null, 目标 = null, 缺 = [];
  for (const t of 候选) {
    const w = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise(r => w.on('open', r));
    let id = 0; const 等 = {};
    w.on('message', m => {
      let o; try { o = JSON.parse(m); } catch (e) { return; }
      if (o.id && 等[o.id]) { 等[o.id](o); return; }
      if (o.method === 'Network.responseReceived' && o.params.response.status >= 400) 缺.push(o.params.response.url + ' → ' + o.params.response.status);
    });
    const 发 = (method, params) => new Promise(r => { const i = ++id; 等[i] = r; w.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async (e) => { const r = await 发('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) return 'THROW: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description); return r.result && r.result.result && r.result.result.value; };
    const 有 = await ev('typeof SR !== "undefined" && !!SR.WORKS');
    if (有 === true) { 会话 = { 发, ev, w }; 目标 = t; break; }
    w.close();
  }
  if (!会话) { console.error('★ 这几个标签页里没有一个真跑着数根。'); process.exit(2); }
  const { 发, ev, w } = 会话;
  console.log('核上了：' + 目标.url);

  await 发('Network.enable');                       // ★ 必须在前，否则下一行是空话
  await 发('Network.setCacheDisabled', { cacheDisabled: true });
  await 发('Page.enable');
  await 发('Page.reload', { ignoreCache: true });   // 硬重载

  // ★★ 硬重载之后**等页面真开完机**再读第一个数（2026-10-06 夜补）。
  //   原来这里是"睡 4 秒就读 SR.…"——冷启动时那 4 秒不够，`SR` 还没定义，
  //   整把尺子当场炸成 `ReferenceError: SR is not defined`，而那个"炸"跟
  //   "产品坏了"**长得一模一样**。判据与用法见 test/_等开机.cjs 顶上那段。
  const 开完了 = await 等开机(ev);
  if (!开完了) console.log('★ 20 秒没等到开机 —— 后面的读数要打折看');

  // ★★ 第一件事：**证明页面上装的是这一版**。证不出来，后面的读数全部作废。
  const 指纹 = await ev('JSON.stringify({ 模块: typeof SR.drawkb, 张数: SR.drawkb ? SR.drawkb.卡.length : null, base: String(SR.PROMPT_DRAW).length, 开关: !!(SR.WORKS.draw && SR.WORKS.draw.drawkb) })');
  console.log('页面指纹：' + 指纹);
  if (String(指纹).indexOf('THROW') === 0) { console.error('★ 页面里读指纹就炸了：' + 指纹); process.exit(2); }
  const F = JSON.parse(指纹);
  判('★★ 页面真装上了 js/drawkb.js（不是 Node 探针里手写的那一行）', F.模块 === 'object', 'typeof SR.drawkb = ' + F.模块);
  判('★★ 页面跑的就是磁盘这一份 prompt-draw.js（不是缓存里的旧版，也不是没折的 33123）', F.base === 磁盘base,
    '页面 ' + F.base + ' 字 ／ 磁盘 ' + 磁盘base + ' 字');
  判('★ 作图工位的 drawkb 开关开着', F.开关 === true);
  判('★ 9 张卡都在', F.张数 === 9, 'SR.drawkb.卡 = ' + F.张数 + ' 张');
  判('★ 加载期没有 4xx/5xx', 缺.length === 0, 缺.length ? 缺.join('；') : '一个都没有');

  // ★ 真跑一轮：走产品自己那条路（chat.js 调的也是 SR.api.ask）
  const 跑 = await ev('(async function(){ try{ var r = await SR.api.ask({work:"draw",history:[],text:' + JSON.stringify(话) + ',onChunk:function(){},onNotice:function(){}}); return JSON.stringify({err:r.error||null}); }catch(e){ return JSON.stringify({炸:String(e && e.message || e)}); } })()');
  console.log('跑了一轮：' + 跑);
  const R = JSON.parse(跑);
  判('★ 真页面里这一轮没炸', !R.炸 && !R.err, R.炸 || R.err || 'ok');

  const 卡在 = await ev('(function(){ if(!SR.drawkb) return "[]"; var s=SR.api.lastSystem||""; return JSON.stringify(SR.drawkb.卡.filter(function(c){return s.indexOf(c.体)>=0}).map(function(c){return c.名})); })()');
  console.log('   发出去那份 system 里贴上的卡：' + 卡在);
  判('★★ 真页面里「' + 话 + '」也真贴上了「' + 期望卡 + '」那张卡（拆出来这条路线上通没通）',
    JSON.parse(卡在).indexOf(期望卡) >= 0, 卡在);
  const 总长 = await ev('(SR.api.lastSystem||"").length');
  判('★ 提示词总长确实降下来了（33k → 19.5k + 一张卡 ≈ 21k 上下）', 总长 > 19000 && 总长 < 26000, 总长 + ' 字');
  // ★ 反向核一次：**不认识的句子一张卡都不该翻**（门在页面上也得是紧的）
  const 负 = await ev('JSON.stringify(SR.drawkb.翻("今天天气不错").map(function(c){return c.名}))');
  判('★ 页面上门也是紧的：「今天天气不错」一张卡都不翻', 负 === '[]', 负);

  console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
  w.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });
