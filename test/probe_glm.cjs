// 验智谱那条新后端：模型名对不对、收不收图、SSE 拆不拆得开、我们那套参数它认不认。
// 用法: node test/probe_glm.cjs
//
// Key 从邰言邰语那份 index.html 现读（同一把），只在本进程里用，不写进数根仓库任何地方。
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const TAIYAN = 'C:/数学办公/邰言邰语/index.html';
const URL_GLM = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const MODEL = process.argv[2] || 'glm-4.6v-flash';

const KEY = (function () {
  const m = fs.readFileSync(TAIYAN, 'utf8').match(/const\s+GLM_KEY\s*=\s*"([^"]+)"/);
  return m && m[1];
})();
if (!KEY) { console.error('没从邰言邰语里读到 GLM_KEY'); process.exit(1); }
console.log('Key 读到了：' + KEY.slice(0, 6) + '…（' + KEY.length + ' 字符）');
console.log('模型：' + MODEL + '\n');

function put(p) {
  return new Promise((res, rej) => {
    const r = http.request({ host: 'localhost', port: 9222, path: p, method: 'PUT' }, x => {
      let d = ''; x.on('data', c => d += c); x.on('end', () => res(d));
    });
    r.on('error', rej); r.end();
  });
}

// ---- 拿一张"学生解答"的图：用 canvas 现画，省得依赖 PIL ----
async function makeImage() {
  const t = JSON.parse(await put('/json/new?about:blank'));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {});
  const r = await send('Runtime.evaluate', {
    returnByValue: true, awaitPromise: true, expression: `(function(){
      var c = document.createElement('canvas'); c.width = 620; c.height = 300;
      var g = c.getContext('2d');
      g.fillStyle = '#fcfcfa'; g.fillRect(0,0,620,300);
      g.fillStyle = '#15151f'; g.font = '26px "Microsoft YaHei", sans-serif';
      g.fillText('解方程：', 30, 55);
      g.font = '30px "Microsoft YaHei", sans-serif';
      g.fillText('2(x - 3) + 4 = 3x - 5', 30, 115);
      g.fillText('2x - 6 + 4 = 3x - 5', 30, 175);
      g.fillText('2x - 3x = -5 + 6 - 4', 30, 235);
      return c.toDataURL('image/png');
    })()`
  });
  ws.close();
  if (!r.result || !r.result.result) throw new Error('canvas 取图失败');
  return r.result.result.value;
}

// ---- 真发一次，流式，逐帧数 ----
async function call(label, messages, extra) {
  const body = Object.assign({
    model: MODEL, messages: messages, temperature: 1.0, max_tokens: 1024, stream: true
  }, extra || {});
  console.log('── ' + label);
  const t0 = Date.now();
  let r;
  try {
    r = await fetch(URL_GLM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify(body)
    });
  } catch (e) { console.log('   连不上：' + e.message + '\n'); return; }

  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.log('   HTTP ' + r.status + ' → ' + t.slice(0, 300) + '\n');
    return;
  }

  const dec = new TextDecoder();
  let buf = '', text = '', reasoning = 0, frames = 0, tFirst = 0;
  const reader = r.body.getReader();
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    buf += dec.decode(step.value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const ln of lines) {
      const s = ln.trim();
      if (s.indexOf('data:') !== 0) continue;
      const p = s.slice(5).trim();
      if (p === '[DONE]') continue;
      let o; try { o = JSON.parse(p); } catch (e) { continue; }
      frames++;
      const d = o.choices && o.choices[0] && o.choices[0].delta;
      if (d && d.reasoning_content) reasoning++;
      if (d && d.content) { if (!tFirst) tFirst = Date.now() - t0; text += d.content; }
      if (o.usage) console.log('   usage: 输入 ' + o.usage.prompt_tokens + ' / 输出 ' + o.usage.completion_tokens);
    }
  }
  const ms = Date.now() - t0;
  console.log('   SSE 帧 ' + frames + ' · reasoning_content 帧 ' + reasoning + ' · 首字 ' + tFirst + 'ms · 全程 ' + ms + 'ms');
  console.log('   回复：' + JSON.stringify(text.slice(0, 400)));
  console.log('');
}

(async () => {
  const img = await makeImage();
  console.log('测试图 dataURL 长度 ' + img.length + '（' + Math.round(img.length * 3 / 4 / 1024) + ' KB）\n');

  // 1. 纯文本，探连通与 SSE
  await call('纯文本', [{ role: 'user', content: '回复两个字：收到' }]);

  // 2. 识图 —— 这是本轮的关键：它到底看不看得懂学生的解答
  await call('识图（学生解答的照片）', [{
    role: 'user',
    content: [
      { type: 'text', text: '这是一个初中学生解方程的草稿。请说出：1) 题目原式是什么；2) 学生第几行开始出错、错在哪。' },
      { type: 'image_url', image_url: { url: img } }
    ]
  }]);

  // 3. 把我们真正的参数原样发一遍，看它认不认（temperature 1.0 / 中文 system）
  await call('带中文 system + 我们那套参数', [
    { role: 'system', content: '你是一个初中数学错题复盘助手。只问不答，绝不直接给答案。' },
    { role: 'user', content: '老师，这道题我不会：比较 -2 和 1 的大小。' }
  ]);

  // 4. thinking 参数：GLM 认不认（DeepSeek 那边是靠它关思维链的）
  await call('多带一个 thinking 参数', [{ role: 'user', content: '回复两个字：收到' }], { thinking: { type: 'disabled' } });

  // 5. 备用免费视觉模型还在不在（429 降级要用）
  for (const m of ['glm-4.1v-thinking-flash', 'glm-4v-flash']) {
    const r = await fetch(URL_GLM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({ model: m, messages: [{ role: 'user', content: '回复两个字：收到' }], max_tokens: 32, stream: false })
    });
    const t = await r.text().catch(() => '');
    console.log('── 备用模型 ' + m + ' → HTTP ' + r.status + (r.ok ? ' ✓ 可用' : ' → ' + t.slice(0, 160)));
  }
  process.exit(0);
})();
