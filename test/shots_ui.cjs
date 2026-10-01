// 出一组界面截图，给孔老师过目。用法:
//   node test/shots_ui.cjs [url] [出图目录]
// 存到 test/_shots/。桌面 / 手机 / 投影仪三档，外加 Key 面板和"发了整卷"那两种状态。
const path = require('path'), fs = require('fs'), http = require('http'), zlib = require('zlib');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const URL_ = process.argv[2] || 'http://localhost:8138/index.html';
const OUT = process.argv[3] || path.join(__dirname, '_shots');
fs.mkdirSync(OUT, { recursive: true });

function req(opts, body) {
  return new Promise((res, rej) => {
    const r = http.request(opts, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (const x of b) c = CRC[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function mkPNG(w, h, rgb, ink) {
  const mk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const r = [Buffer.from([0])];
    for (let x = 0; x < w; x++) {
      // 画几条"横排文字"，看起来像张卷子
      const on = ink && (y % 14 < 4) && x > w * 0.08 && x < w * (0.55 + 0.4 * ((y * 7) % 5) / 5);
      r.push(Buffer.from(on ? [40, 40, 40] : rgb));
    }
    rows.push(Buffer.concat(r));
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), mk('IHDR', ih), mk('IDAT', zlib.deflateSync(Buffer.concat(rows))), mk('IEND', Buffer.alloc(0))]);
}
function mkDOCX() {
  const name = Buffer.from('word/document.xml');
  const data = Buffer.from('<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>1. 计算</w:t></w:r></w:p></w:body></w:document>');
  const comp = zlib.deflateRawSync(data), crc = crc32(data);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
  const cd = Buffer.concat([ch, name]), lo = Buffer.concat([lh, name, comp]);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(1, 8); e.writeUInt16LE(1, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(lo.length, 16);
  return Buffer.concat([lo, cd, e]);
}

(async () => {
  const TMP = path.join(__dirname, '_tmp'); fs.mkdirSync(TMP, { recursive: true });
  const P1 = path.join(TMP, 'juan1.png'), P2 = path.join(TMP, 'juan2.png'), DX = path.join(TMP, 'juan.docx');
  fs.writeFileSync(P1, mkPNG(300, 200, [246, 244, 240], true));
  fs.writeFileSync(P2, mkPNG(300, 200, [242, 246, 242], true));
  fs.writeFileSync(DX, mkDOCX());

  const t = JSON.parse(await req({ host: 'localhost', port: 9222, path: '/json/new?about:blank', method: 'PUT' }));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {};
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => { const r = JSON.parse(m); if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; } });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Page.enable', {}); await send('DOM.enable', {});
  const q = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.result.value;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // ★ 先清 localStorage 再进页面。不清的话，上一支探针把 mathroot_backend 留成了
  //   deepseek（还没 Key），于是"发一整卷"那一张截出来的不是对话，是 Key 面板——
  //   拍的是别的东西，还以为拍的是自己要看的那件事。
  await send('Page.navigate', { url: URL_ });
  // 每张图都从干净状态起。★ 必须**每张前**清，不能只清一次——
  //   第 07 张是"手机上点开 Key 面板"，那一按会把后端切到 deepseek 写进 localStorage；
  //   只清一次的话，第 08 张（投影仪）就带着那个状态出图，右上角亮着"我的 Key"、
  //   底下写着"还没有填 Key"，跟这张要展示的东西完全不是一回事。
  const newDoc = async () => {
    await q('try{localStorage.clear()}catch(e){}');
    await send('Page.navigate', { url: URL_ });
    for (let i = 0; i < 30; i++) { if (await q('!!(window.SR&&SR.main&&SR.board)')) break; await wait(500); }
    await wait(900);
  };
  const size = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
  const shot = async name => {
    await wait(500);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const f = path.join(OUT, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
    console.log('  ' + name + '.png');
  };

  console.log('出图：');
  // 1) 桌面 · 首屏
  await size(1440, 900, false); await newDoc();
  await shot('01-desktop-first');

  // 2) 桌面 · Key 面板
  await q('document.querySelector(".backs .backbtn[data-backend=deepseek]").click()');
  await shot('02-desktop-keypanel');
  await q('document.getElementById("keyset").classList.remove("open")');
  // 回到免费通道。刚刚点那一下把后端切到 deepseek 了，不退回去的话
  // 待会儿 submit 会因为"没填 Key"弹面板，第 04 张就拍不成对话。
  await q('SR.main.applyBackend("glm")');

  // 3) 桌面 · 发了整卷（2 图 + 1 docx 等在输入框上）
  const root = (await send('DOM.getDocument', {})).result.root.nodeId;
  const inp = (await send('DOM.querySelector', { nodeId: root, selector: '#file' })).result.nodeId;
  await send('DOM.setFileInputFiles', { files: [P1, P2, DX], nodeId: inp });
  await wait(1800);
  await q('document.getElementById("input").value="老师，这是昨天的卷子，好多不会";');
  await shot('03-desktop-wholepaper');

  // 4) 桌面 · 真的发出去之后（气泡里两张图 + 一行文件名）
  await q(`window.fetch=function(){ var s='data: {"choices":[{"delta":{"content":"这份卷子里，哪些是你不会的？挑一道先说。"}}]}\\n\\ndata: [DONE]\\n\\n'; return Promise.resolve(new Response(s,{status:200,headers:{'Content-Type':'text/event-stream'}})); };`);
  await q('SR.chat.submit()');
  await wait(2500);
  await shot('04-desktop-sent');

  // 5) 桌面 · 关于
  await q('document.getElementById("aboutbtn").click()');
  await shot('05-desktop-about');
  await q('document.getElementById("about").classList.remove("open")');

  // 6) 手机 · 首屏
  await size(390, 780, true); await newDoc();
  await shot('06-phone-first');

  // 7) 手机 · Key 面板
  await q('document.querySelector(".backs .backbtn[data-backend=deepseek]").click()');
  await shot('07-phone-keypanel');

  // 8) 投影仪 · 1920×1080
  await size(1920, 1080, false); await newDoc();
  await shot('08-projector');

  // 9) 桌面 · 知识库面板（**只在本机出现**，公开站上没这个按钮）
  //    故意打一句"学生真会说的话"而不是知识点名字——
  //    这一屏要看的正是"话里没点名知识点时，它到底召回了什么"。
  //    这一句一个字的知识点都没有，所以底下那几条都该是灰的、写着"卡掉"。
  await size(1440, 900, false); await newDoc();
  await q('document.getElementById("kbbtn").click()');
  for (let i = 0; i < 30; i++) { await wait(400); if (await q('document.querySelectorAll(".kbhit").length')) break; }
  await q('var e=document.getElementById("kbq"); e.value="这道题我不会，我算到一半就卡住了"; e.dispatchEvent(new Event("input"));');
  await wait(600);
  await shot('09-desktop-knowledge');

  // 10) 桌面 · 知识库面板 · 真点了知识点的名（跟 09 对照着看）
  await q('var e=document.getElementById("kbq"); e.value="分式方程解完要不要检验"; e.dispatchEvent(new Event("input"));');
  await wait(600);
  await shot('10-desktop-knowledge-hit');

  ws.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
