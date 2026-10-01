// glm-4v-flash 的上下文到底够不够用？
//   把我们**真正的那份**学生提示词发出去，读 usage.prompt_tokens，看它吃掉多少。
//   再逐步加长对话历史，找到它开始报错的那个点。
// 用法: node test/probe_glm_ctx.cjs
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const TAIYAN = 'C:/数学办公/邰言邰语/index.html';
const URL_GLM = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const KEY = (fs.readFileSync(TAIYAN, 'utf8').match(/const\s+GLM_KEY\s*=\s*"([^"]+)"/) || [])[1];

// 把数根自己那几个 js 装进来，拿到真正的提示词（跟 api.js 走同一份源）
const W = { SR: {} };
global.window = W;
for (const f of ['config.js', 'prompt-student.js', 'prompt-demo.js', 'textbook.js', 'retrieve.js']) {
  try { eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')); } catch (e) {}
}
const STUDENT = W.SR.PROMPT_STUDENT || '';
console.log('学生提示词 ' + STUDENT.length + ' 字符\n');

function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}
async function makeImage() {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {});
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(function(){
    var c=document.createElement('canvas'); c.width=620; c.height=300;
    var g=c.getContext('2d'); g.fillStyle='#fcfcfa'; g.fillRect(0,0,620,300);
    g.fillStyle='#15151f'; g.font='28px sans-serif';
    g.fillText('2(x - 3) + 4 = 3x - 5', 25, 90); g.fillText('2x - 3x = -5 + 6 - 4', 25, 170);
    return c.toDataURL('image/png'); })()` });
  ws.close();
  return r.result.result.value;
}

// 发一次，返回 {ok, prompt_tokens, error}
async function probe(model, sys, history, withImg, img) {
  const msgs = [{ role: 'system', content: sys }].concat(history);
  msgs.push({
    role: 'user',
    content: withImg
      ? [{ type: 'text', text: '老师，这道题我不会。' }, { type: 'image_url', image_url: { url: img } }]
      : '老师，这道题我不会。'
  });
  const r = await fetch(URL_GLM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ model: model, messages: msgs, temperature: 1.0, max_tokens: 256, stream: false })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let code = '', msg = '';
    try { const j = JSON.parse(t); code = j.error.code; msg = j.error.message; } catch (e) { msg = t.slice(0, 120); }
    return { ok: false, code: code, msg: msg };
  }
  const j = await r.json();
  return { ok: true, prompt_tokens: j.usage && j.usage.prompt_tokens, completion: j.usage && j.usage.completion_tokens };
}

function fakeHistory(turns) {
  const out = [];
  for (let i = 0; i < turns; i++) {
    out.push({ role: 'user', content: '老师，我是这个学生的第' + i + '轮发言，我在说我对这道题的某一步的想法和做法。' });
    out.push({ role: 'assistant', content: '那你再说说，你写的第' + i + '步是怎么来的？当时你心里是怎么想的呢？' });
  }
  return out;
}

(async () => {
  const img = await makeImage();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  console.log('── 只发提示词 + 一句话（不带图）');
  let r = await probe('glm-4v-flash', STUDENT, [], false, img);
  console.log('   ' + JSON.stringify(r));

  await sleep(800);
  console.log('\n── 提示词 + 一张图');
  r = await probe('glm-4v-flash', STUDENT, [], true, img);
  console.log('   ' + JSON.stringify(r));

  // 逐档加长历史，找断点
  console.log('\n── 加长对话历史，找上下文断点');
  for (const turns of [2, 4, 6, 8, 12, 16, 24]) {
    await sleep(900);
    const rr = await probe('glm-4v-flash', STUDENT, fakeHistory(turns), true, img);
    console.log('   ' + String(turns).padStart(2) + ' 轮历史（' + (turns * 2) + ' 条消息）→ ' +
      (rr.ok ? 'OK，输入 ' + rr.prompt_tokens + ' tokens' : '败：' + (rr.code || '') + ' ' + (rr.msg || '').slice(0, 90)));
  }

  console.log('\n── 同一个断点，换 glm-4.6v-flash 对照（128K 那档）');
  await sleep(900);
  r = await probe('glm-4.6v-flash', STUDENT, fakeHistory(24), true, img);
  console.log('   24 轮历史 → ' + (r.ok ? 'OK，输入 ' + r.prompt_tokens + ' tokens' : '败：' + (r.code || '') + ' ' + (r.msg || '').slice(0, 90)));

  process.exit(0);
})();
