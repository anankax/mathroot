// 在 Chrome 里打开数根，收控制台报错、看各模块是否就位。用法:
//   node test/page_probe.cjs [url] [等待秒数]
// 需要 Chrome 带 --remote-debugging-port=9222 跑着。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const URL_ = process.argv[2] || 'http://localhost:8137/index.html';
const WAIT = Number(process.argv[3] || 22);

function req(opts, body) {
  return new Promise((res, rej) => {
    const r = http.request(opts, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}

(async () => {
  const t = JSON.parse(await req({ host: 'localhost', port: 9222, path: '/json/new?about:blank', method: 'PUT' }));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {}; const logs = [], errs = [];
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => {
    const r = JSON.parse(m);
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; return; }
    if (r.method === 'Runtime.consoleAPICalled') {
      const s = (r.params.args || []).map(a => a.value != null ? a.value : a.description).join(' ');
      (r.params.type === 'error' ? errs : logs).push('[' + r.params.type + '] ' + s);
    }
    if (r.method === 'Runtime.exceptionThrown') {
      const d = r.params.exceptionDetails;
      errs.push('[异常] ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    }
    if (r.method === 'Log.entryAdded' && r.params.entry.level === 'error') {
      errs.push('[网络/日志] ' + r.params.entry.text + ' ' + (r.params.entry.url || ''));
    }
  });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {});
  await send('Log.enable', {});
  await send('Page.enable', {});
  await send('Page.navigate', { url: URL_ });

  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return '抛错:' + (r.result.exceptionDetails.exception || {}).description;
    return r.result && r.result.result ? r.result.result.value : null;
  };

  for (let i = 1; i <= Math.ceil(WAIT / 3); i++) {
    await new Promise(r => setTimeout(r, 3000));
    console.log(`[${i * 3}s] ggbReady=${await q('!!(window.SR&&SR.board&&SR.board.isReady())')}`);
    if (await q('!!(window.SR&&SR.board&&SR.board.isReady())')) break;
  }

  console.log('\n===== 模块就位 =====');
  for (const m of ['SR.config !== undefined || typeof SR !== "undefined"', "typeof SR.MODES", "typeof SR.api.ask", "typeof SR.render.parseFences",
                   "typeof SR.board.run", "typeof SR.chat.submit", "typeof SR.main.boot", "typeof SR.findTextbook",
                   "typeof marked", "typeof DOMPurify", "typeof renderMathInElement", "typeof GGBApplet",
                   "SR.PROMPT_STUDENT.length", "SR.TEXTBOOK.length", "SR.PROMPT_DEMO.length"]) {
    console.log('  ' + m + '  =>  ' + JSON.stringify(await q(m)));
  }

  console.log('\n===== 页面状态 =====');
  console.log('  模式:', await q('document.body.getAttribute("data-mode")'));
  console.log('  Key 层打开?', await q('document.getElementById("keyset").classList.contains("open")'));
  console.log('  输入框禁用?', await q('document.getElementById("input").disabled'));
  console.log('  开场白气泡:', await q('(document.querySelector(".msg.assistant .bubble")||{}).textContent'));
  console.log('  画板 iframe 数:', await q('document.querySelectorAll("#ggb iframe").length'));
  console.log('  画板容器:', await q('document.querySelectorAll("#ggb .applet_scaler").length'));

  console.log('\n===== 围栏拆分自测 =====');
  console.log(await q(`JSON.stringify((function(){
    var t='先看这两个数。\\n\\n'+'\\u0060'.repeat(3)+'ggb\\n#清空\\n数轴\\nA=(1,0)\\n'+'\\u0060'.repeat(3)+'\\n你把它们标上去。\\n\\n'+'\\u0060'.repeat(3)+'想说\\n我看谁靠左\\n我不确定\\n我不会\\n'+'\\u0060'.repeat(3);
    var p=SR.render.parseFences(t);
    return {可见:p.visible, ggb条数:p.ggb.length, 想说条数:p.say.length, 未闭合:p.pending};
  })())`));

  console.log(await q(`JSON.stringify((function(){
    var t='正文'+'\\u0060'.repeat(3)+'ggb\\n#清空\\n数轴';
    var p=SR.render.parseFences(t);
    return {半截被藏住了:p.visible, 待闭合长度:p.pending.length};
  })())`));

  console.log('\n===== 控制台报错 =====');
  if (!errs.length) console.log('  （无）');
  else errs.slice(0, 25).forEach(e => console.log('  ' + e));

  console.log('\n===== 控制台普通日志 =====');
  logs.slice(-12).forEach(l => console.log('  ' + l));

  // 截图
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('test/_page.png', Buffer.from(shot.result.data, 'base64'));
  console.log('\n截图: test/_page.png   TABID=' + t.id);
  ws.close(); process.exit(0);
})();
