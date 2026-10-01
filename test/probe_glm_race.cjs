// 三个免费视觉模型谁最扛得住？各打 N 次带图的流式请求，数成功率/耗时/思维链帧。
// 默认后端选谁，以这个结果为准，不凭文档。
// 用法: node test/probe_glm_race.cjs [每个模型打几次]
const path = require('path'), fs = require('fs'), http = require('http');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const TAIYAN = 'C:/数学办公/邰言邰语/index.html';
const URL_GLM = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const N = Number(process.argv[2] || 5);
const MODELS = ['glm-4.6v-flash', 'glm-4.1v-thinking-flash', 'glm-4v-flash', 'glm-4.5v'];

const KEY = (fs.readFileSync(TAIYAN, 'utf8').match(/const\s+GLM_KEY\s*=\s*"([^"]+)"/) || [])[1];
if (!KEY) { console.error('没读到 GLM_KEY'); process.exit(1); }

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
  const r = await send('Runtime.evaluate', {
    returnByValue: true, awaitPromise: true, expression: `(function(){
      var c=document.createElement('canvas'); c.width=520; c.height=220;
      var g=c.getContext('2d'); g.fillStyle='#fcfcfa'; g.fillRect(0,0,520,220);
      g.fillStyle='#15151f'; g.font='28px sans-serif';
      g.fillText('2(x - 3) + 4 = 3x - 5', 25, 70);
      g.fillText('2x - 3x = -5 + 6 - 4', 25, 140);
      return c.toDataURL('image/png');
    })()`
  });
  ws.close();
  return r.result.result.value;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function once(model, img) {
  const t0 = Date.now();
  let r;
  try {
    r = await fetch(URL_GLM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: [
          { type: 'text', text: '这张图上第一行写的等式是什么？只回答那个等式。' },
          { type: 'image_url', image_url: { url: img } }
        ] }],
        temperature: 1.0, max_tokens: 512, stream: true
      })
    });
  } catch (e) { return { err: 'NET ' + e.message }; }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let code = '';
    try { code = JSON.parse(t).error.code; } catch (e) {}
    return { err: 'HTTP ' + r.status + (code ? ' (' + code + ')' : ''), ms: Date.now() - t0 };
  }
  const dec = new TextDecoder(); let buf = '', text = '', reasoning = 0, frames = 0, first = 0;
  const reader = r.body.getReader();
  for (;;) {
    const s = await reader.read(); if (s.done) break;
    buf += dec.decode(s.value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const ln of lines) {
      const x = ln.trim(); if (x.indexOf('data:') !== 0) continue;
      const p = x.slice(5).trim(); if (p === '[DONE]') continue;
      let o; try { o = JSON.parse(p); } catch (e) { continue; }
      frames++;
      const d = o.choices && o.choices[0] && o.choices[0].delta;
      if (d && d.reasoning_content) reasoning++;
      if (d && d.content) { if (!first) first = Date.now() - t0; text += d.content; }
    }
  }
  return { ms: Date.now() - t0, first: first, frames: frames, reasoning: reasoning, text: text };
}

(async () => {
  const img = await makeImage();
  console.log('每个模型打 ' + N + ' 次，带图流式\n');
  const summary = [];
  for (const m of MODELS) {
    let ok = 0, bad = 0, lat = [], think = [];
    const notes = [];
    for (let i = 1; i <= N; i++) {
      const o = await once(m, img);
      if (o.err) { bad++; notes.push('x' + o.err.replace('HTTP ', '')); }
      else {
        ok++; lat.push(o.ms); think.push(o.reasoning);
        const said = (o.text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        notes.push(o.ms + 'ms/' + o.reasoning + '帧 "' + said + '"');
      }
      await sleep(900);
    }
    const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0;
    const th = think.length ? Math.round(think.reduce((a, b) => a + b, 0) / think.length) : 0;
    summary.push({ model: m, ok: ok, bad: bad, avg: avg, think: th });
    console.log(m.padEnd(24) + ' 成功 ' + ok + '/' + N + '   平均 ' + avg + 'ms   平均思维链 ' + th + ' 帧');
    for (const n of notes) console.log('     ' + n);
    console.log('');
  }
  console.log('===== 结论 =====');
  for (const s of summary) {
    console.log(s.model.padEnd(24) + ' 成功率 ' + Math.round(s.ok / N * 100) + '%  平均 ' + s.avg + 'ms  ' +
      (s.think > 50 ? '★带思维链（慢且费token）' : '无思维链'));
  }
  process.exit(0);
})();
