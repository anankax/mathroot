// ① 一条底座＋五份附录 —— **确定性**那一半（不花模型额度、不判模型行为）。
//
// 量三件事：
//   ① 六个工位拼出来的系统提示词，**每一个都以底座开头**（位置：最前）；
//   ② 底座那句身份在拼出来的正文里**只出现一次**（一次拼装、没拼两遍）；
//   ③ 作图那格自己的**末尾契约还在末尾**（底座挪进来不许把 SAY 尾巴挤走）。
// 再加一个**反例**：把 SR.PROMPT_BASE 临时置空，拼出来的必须正好短了它那么多、
//   而且不再以那句身份开头。没有这一步，"以底座开头"这个断言分不清
//   "真的拼进去了"和"那句话本来就在附录里"。做完立刻还原。
//
// ⚠ 只连隔离档那台探针浏览器（9222），不碰老师自己的 Chrome。
const path = require('path'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const PORT = 9222;

const 取 = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p },
  r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(JSON.parse(s))); }).on('error', rej));

let 过 = 0, 红 = 0;
const 判 = (名, ok, 读) => { if (ok) 过++; else 红++; console.log('  ' + (ok ? '✓' : '✗') + ' ' + 名 + (读 !== undefined ? '   ' + 读 : '')); };

(async () => {
  const 列表 = await 取('/json/list');
  const 候选 = 列表.filter(t => t.type === 'page' && /^(https?:\/\/)?(localhost|127\.0\.0\.1):8138/.test(String(t.url)));
  if (!候选.length) { console.error('★ 没有 8138 的标签页。'); process.exit(2); }

  let 会话 = null;
  for (const t of 候选) {
    const w = new WebSocket(t.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise(r => w.on('open', r));
    let id = 0; const 等 = {};
    w.on('message', m => { let o; try { o = JSON.parse(m); } catch (e) { return; } if (o.id && 等[o.id]) 等[o.id](o); });
    const 发 = (method, params) => new Promise(r => { const i = ++id; 等[i] = r; w.send(JSON.stringify({ id: i, method, params: params || {} })); });
    const ev = async e => {
      const r = await 发('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
      if (r.result && r.result.exceptionDetails) {
        const d = r.result.exceptionDetails;
        throw new Error('页面里这一句炸了：' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
      }
      return r.result && r.result.result && r.result.result.value;
    };
    const 有 = await ev('typeof SR !== "undefined" && !!SR.WORKS');
    if (有 === true) { 会话 = { 发, ev, w }; break; }
    w.close();
  }
  if (!会话) { console.error('★ 没找到真跑着数根的标签页。'); process.exit(2); }
  const { 发, ev, w } = 会话;

  await 发('Network.enable');
  await 发('Network.setCacheDisabled', { cacheDisabled: true });
  await 发('Page.enable');
  await 发('Page.reload', { ignoreCache: true });

  // 等产品自己的就绪信号（别按秒表读状态）
  let 就绪 = false;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const s = await ev('typeof SR !== "undefined" && !!SR.api && typeof SR.api.buildSystem === "function" && !!SR.PROMPT_BASE && !!SR.WORK_ORDER');
      if (s === true) { 就绪 = true; break; }
    } catch (e) { /* 还在装配 */ }
  }
  if (!就绪) { console.error('★ 等了 30 秒产品没就绪（SR.api.buildSystem / SR.PROMPT_BASE 没齐）。读数作废。'); process.exit(2); }

  // ★★ 先把"这一版装的是哪一版"读回来核对 —— 线上吃同源缓存会把已生效的判成没生效。
  const 指纹 = await ev('JSON.stringify({base:(SR.PROMPT_BASE||"").length, 底座头:(SR.PROMPT_BASE||"").slice(0,24), 工位:SR.WORK_ORDER.slice()})');
  console.log('这一版装的是：' + 指纹 + '\n');
  const 指 = JSON.parse(指纹);
  if (!/^# 你是谁/.test(指.底座头)) {
    console.error('★ 页面上装的底座不是一个以「# 你是谁」开头的版本 —— 读数作废（先怀疑缓存）。');
    process.exit(2);
  }

  const 身份 = '你是「数根」，一个初中数学的助手';
  const 读 = await ev('(function(){ var o={}; SR.WORK_ORDER.forEach(function(wk){' +
    ' try { var s = SR.api.buildSystem(wk, "画一条数轴", null, [], [], {});' +
    ' o[wk] = { 长:s.length, 开头:s.slice(0, 60), 身份出现次数:(s.split(' + JSON.stringify(身份) + ').length-1),' +
    '   以底座开头: s.indexOf(SR.PROMPT_BASE) === 0 }; }' +
    ' catch(e){ o[wk] = { err: String(e && e.message || e) }; } });' +
    ' o.__底座长 = SR.PROMPT_BASE.length;' +
    // 作图那格的末尾契约
    ' try { var d = SR.api.buildSystem("draw", "画一条数轴", null, [], [], {});' +
    '   o.__作图尾 = (SR.PROMPT_SAY_TAIL||"").length ? (d.length - d.lastIndexOf(SR.PROMPT_SAY_TAIL) - SR.PROMPT_SAY_TAIL.length) : -1;' +
    '   o.__作图尾块长 = (SR.PROMPT_SAY_TAIL||"").length; } catch(e){ o.__作图尾 = "炸:"+e.message; }' +
    ' return JSON.stringify(o); })()');
  const r = JSON.parse(读);

  console.log('【① 底座在最前面】');
  for (const wk of 指.工位) {
    const x = r[wk] || {};
    if (x.err) { 判(wk, false, '拼装炸了：' + x.err); continue; }
    判(wk, x.以底座开头 === true && x.身份出现次数 === 1,
      x.长 + ' 字  以底座开头=' + x.以底座开头 + '  底座那句身份出现 ' + x.身份出现次数 + ' 次');
  }

  console.log('\n【② 反例：把底座换成一句哨兵，拼出来的必须**以哨兵开头**且长度对得上】');
  // ★ 为什么用哨兵而不是"把底座置空"：置空撞的是三元表达式的 **falsy 分支**
  //   （`SR.PROMPT_BASE ? 底座+分隔符 : ''`），量到的是"分支走对了"，不是"底座被拼在最前面"。
  //   换成一句世上不存在的话，拼出来的开头必须正好是它 —— 这才分得清
  //   "真的拼进去了"和"那句话本来就在附录里"。
  const 工 = 指.工位[0], 长原 = r[工].长, 长尾 = r.__底座长;
  const 哨兵 = '【哨兵·底座·9f3a】';
  const 分隔 = '\n\n---\n\n';
  await ev('window.__basebak = SR.PROMPT_BASE; SR.PROMPT_BASE = ' + JSON.stringify(哨兵) + ';');
  const 哨 = await ev('SR.api.buildSystem(' + JSON.stringify(工) + ', "画一条数轴", null, [], [], {}).slice(0, 80)');
  const 哨长 = await ev('SR.api.buildSystem(' + JSON.stringify(工) + ', "画一条数轴", null, [], [], {}).length');
  await ev('SR.PROMPT_BASE = window.__basebak; delete window.__basebak;');
  const 还原 = await ev('(SR.api.buildSystem(' + JSON.stringify(工) + ', "画一条数轴", null, [], [], {}).length)');
  const 预期 = 长原 - 长尾 + 哨兵.length;
  判('换哨兵后正好以哨兵＋分隔符开头',
    哨.indexOf(哨兵 + 分隔) === 0, '  开头＝' + JSON.stringify(String(哨).slice(0, 40)));
  判('长度正好是 「原长 − 底座 + 哨兵」（' + 长原 + ' − ' + 长尾 + ' + ' + 哨兵.length + ' ＝ ' + 预期 + '）',
    哨长 === 预期, '  实测 ' + 哨长);
  判('拿了还回去，长度一字不差地复原', 还原 === 长原, 还原 + ' vs ' + 长原);

  console.log('\n【③ 作图那格的末尾契约还在末尾】');
  判('作图拼出来的正文里，`想说` 收尾块就是最后一个字',
    typeof r.__作图尾 === 'number' && r.__作图尾 === 0,
    '收尾块之后还剩 ' + r.__作图尾 + ' 字（该是 0）／收尾块本身 ' + r.__作图尾块长 + ' 字');

  console.log('\n══ ' + 过 + ' 绿 / ' + 红 + ' 红 ══');
  w.close();
  process.exit(红 ? 1 : 0);
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });
