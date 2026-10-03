// 尺子：**真正发给模型的那份 system 提示词，最后 1200 字是什么？**
//
// 为什么要有这一把：
//   我一直以为"模型的最后一段"＝ js/prompt-vary.js 的末尾——
//   提示词排版的经验（[[prompt-must-do-at-tail]]）就是这么写的。
//   可 js/api.js 在 w.prompt() **之后**还拼了三样东西：
//     ① 教材索引附注 / ② 资料库附注 / ③「老师手上正在办的那一件事」
//   ——**最后一段根本不是提示词文件**。
//
//   ⚠ 更要命的是第 ③ 段末尾那句话是对**所有工位**说的通用话，
//     里面有「该画图就画这一件的图」。命题工位把提示词尾巴改成"没图可配就别画"，
//     改在**够不着**的位置——它后面还有一整段在叫它画。
//     （实测：改完 test/probe_varyfence.cjs 仍是 0/3 不写围栏。）
//
// ★ 这一把只**看**，不改任何东西：包一层 window.fetch 把请求体抄下来，
//   发一句话，把 system 原样打出来。看完就把 fetch 还回去。
//
// 用法：node test/probe_sysdump.cjs [工位=vary] [说的话]
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));
const put = p => new Promise((res, rej) => { const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); }); r.on('error', rej); r.end(); });
const closeTab = id => new Promise(res => { http.get({ host: 'localhost', port: 9222, path: '/json/close/' + id }, x => { x.resume(); x.on('end', res); }).on('error', res); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = 'http://localhost:8138/index.html';
const 工位 = process.argv[2] || 'vary';
const 话 = process.argv[3] || '把这道题改一改：解方程 2x+3=7';

(async () => {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pend = {};
  ws.on('message', m => { const o = JSON.parse(m); if (o.id && pend[o.id]) { pend[o.id](o); delete pend[o.id]; } });
  await new Promise(r => ws.on('open', r));
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('页面里炸了：' + String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).slice(0, 400));
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send('Page.enable', {}); await send('Runtime.enable', {});
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE + '?sd=' + Date.now() });
  for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.chat&&SR.memo)').catch(() => false)) break; await sleep(500); }
  // ★ 洗成白纸再看。不清的话打出来的是**档案里那一场旧对话**的提示词——
  //   第一版就是这么打出来的：课题写着"你能帮我画个数轴吗，我画不出来"、"已经攒下：图 15 张"，
  //   那是探针 Chrome 档案里的存货，不是这一问的现场。
  //   拿一份别人那页的读数当结论，正是 [[scanner-numbers-are-not-what-they-claim]] 里最常犯的那种。
  await ev('(function(){try{SR.memo.clear();}catch(e){}return 1})()');
  await send('Page.navigate', { url: PAGE + '?sd2=' + Date.now() });
  for (let i = 0; i < 60; i++) { if (await ev('!!(window.SR&&SR.chat&&SR.memo)').catch(() => false)) break; await sleep(500); }
  await sleep(1200);

  const 切 = await ev('(function(){var b=document.querySelector(".workbtn[data-work=\\"' + 工位 + '\\"]");if(!b)return false;b.click();return true;})()');
  if (!切) { console.log('★ 找不到「' + 工位 + '」的按钮'); await closeTab(t.id); ws.close(); return; }
  await sleep(600);

  // 只**抄**请求体，别的一概不动。抄完的 body 原样放行。
  await ev('(function(){'
    + 'window.__抄=null;'
    + 'var 原=window.fetch;'
    + 'window.fetch=function(u,o){'
    + '  try{ if(o&&o.body&&typeof o.body==="string"&&o.body.indexOf("messages")>=0) window.__抄=o.body; }catch(e){}'
    + '  return 原.apply(this,arguments);'
    + '};'
    + 'window.__还原=function(){window.fetch=原;};'
    + 'return 1;})()');

  await ev('(function(){var i=document.getElementById("input");i.focus();i.value=' + JSON.stringify(话) + ';i.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
  await sleep(150);
  await ev('document.getElementById("send").click(); 1');

  // 等请求真的发出去
  let 抄 = null;
  for (let i = 0; i < 60; i++) { 抄 = await ev('window.__抄'); if (抄) break; await sleep(500); }
  await ev('window.__还原(); 1');

  if (!抄) { console.log('★ 没抄到请求体（是不是还没发出去？）'); await closeTab(t.id); ws.close(); return; }

  const 体 = JSON.parse(抄);
  const sysMsg = (体.messages || []).filter(m => m.role === 'system')[0] || { content: '' };
  const sys = String(sysMsg.content || '');
  fs.mkdirSync(path.join(__dirname, '_shot'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '_shot', 'sys-' + 工位 + '.txt'), sys);

  console.log('工位 = ' + 工位 + '   发的话 = ' + 话);
  console.log('system 一共 ' + sys.length + ' 字   其他消息 ' + ((体.messages || []).length - 1) + ' 条');
  console.log('存档：test/_shot/sys-' + 工位 + '.txt\n');
  console.log('══════ system 的**最后 1200 字**（模型最后读到的就是这一段）══════');
  console.log(sys.slice(-1200));
  console.log('\n══════ 这一份里出现过「画」字的每一行 ══════');
  sys.split('\n').forEach((ln, i) => { if (ln.indexOf('画') >= 0) console.log('  ' + (i + 1) + ': ' + ln.slice(0, 150)); });

  // ★ 「老师手上正在办的那一件事」这一段**是不是最后一段**：
  //   它由 js/api.js 在 w.prompt() **之后**现拼，而命题工位没有收尾块（tail:false），
  //   所以对命题来说它**就是模型最后读到的东西**——提示词文件末尾那几句排在它前面，够不着。
  const 位置 = sys.indexOf('老师手上正在办的那一件事');
  console.log('\n══════ 那一段附注在哪儿 ══════');
  if (位置 < 0) console.log('  这一份里**没有**「老师手上正在办的那一件事」（课题/班级都是空的）');
  else {
    const 文件末 = sys.indexOf('★ 上面三道都是');
    console.log('  提示词里那句「没图可配就别画」在第 ' + 文件末 + ' 字');
    console.log('  附注段从第 ' + 位置 + ' 字起，到第 ' + sys.length + ' 字止');
    console.log('  ⇒ 附注排在它后面吗：' + (位置 > 文件末) + '（是的话，模型最后读到的是附注，不是提示词的尾巴）');
  }

  await closeTab(t.id); ws.close();
})().catch(e => { console.error('★ 炸了：' + (e && e.stack || e)); process.exit(2); });
