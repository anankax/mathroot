// 整卷 / 多文件那条线的探针。用法:
//   node test/probe_files.cjs [url]
// 需要 Chrome 带 --remote-debugging-port=9222 跑着（scripts/start.cjs --profile）。
//
// 验四件事，每件都**判**，不是打印出来当信息看：
//   ① kindOf 认不认得各种文件
//   ② .docx 真解得出正文（含 &lt; 那个转义坑）
//   ③ 真塞三个文件进 <input type=file>，看 pendingParts 和缩略图条对不对
//   ④ 出站请求体里 image_url 到底几个、整卷那条附注在不在
//
// ★ ④ 是把 window.fetch 换掉、自己造的响应——不真打网络。
//   这样"发了什么"看得一清二楚，也省额度。
const path = require('path'), fs = require('fs'), http = require('http'), zlib = require('zlib');
const WebSocket = require(path.join(process.env.USERPROFILE, '.claude', 'skills', 'browser', 'browser', 'node_modules', 'ws'));

const URL_ = process.argv[2] || 'http://localhost:8138/index.html';
const TMP = path.join(__dirname, '_tmp');
let PASS = 0, FAIL = 0;
function ok(name, cond, extra) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

function req(opts, body) {
  return new Promise((res, rej) => {
    const r = http.request(opts, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}

// ---------------------------------------------------------------
//  造两个真文件：一个 .docx，一个 3 页 .pdf
// ---------------------------------------------------------------
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

// 只写需要的那几个字段的 zip。够 Word 那份 document.xml 用。
function makeZip(entries) {
  const locals = [], centrals = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(off, 42);
    centrals.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals), lo = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(lo.length, 16);
  return Buffer.concat([lo, cd, eocd]);
}

// 手写一份 3 页 PDF。正文里带一道初中题，pdf.js 要真能翻开它才算数。
function makePDF(nPages) {
  const objs = [];
  const kids = [];
  for (let i = 0; i < nPages; i++) kids.push((3 + i * 2) + ' 0 R');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + nPages + ' >>';
  for (let i = 0; i < nPages; i++) {
    const pn = 3 + i * 2, cn = pn + 1;
    const text = 'BT /F1 20 Tf 60 760 Td (Page ' + (i + 1) + ': jie fang cheng 2x+1=7) Tj ET';
    objs[pn] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ' + cn + ' 0 R ' +
               '/Resources << /Font << /F1 ' + (3 + nPages * 2) + ' 0 R >> >> >>';
    objs[cn] = '<< /Length ' + text.length + ' >>\nstream\n' + text + '\nendstream';
  }
  objs[3 + nPages * 2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let out = '%PDF-1.4\n', offs = [];
  for (let i = 1; i < objs.length; i++) {
    if (!objs[i]) continue;
    offs[i] = out.length;
    out += i + ' 0 obj\n' + objs[i] + '\nendobj\n';
  }
  const xref = out.length;
  out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
  for (let i = 1; i < objs.length; i++) {
    out += String(offs[i] || 0).padStart(10, '0') + ' 00000 n \n';
  }
  out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

// 三张小图（纯色 PNG，最小合法尺寸）
function makePNG(w, h, rgb) {
  const mk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = [];
  for (let y = 0; y < h; y++) { raw.push(Buffer.from([0])); for (let x = 0; x < w; x++) raw.push(Buffer.from(rgb)); }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    mk('IHDR', ihdr), mk('IDAT', zlib.deflateSync(Buffer.concat(raw))), mk('IEND', Buffer.alloc(0))
  ]);
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  // ---- 造文件 ----
  const DOCX = path.join(TMP, 'juan.docx');
  fs.writeFileSync(DOCX, makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>' },
    { name: 'word/document.xml', data: '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>' +
        '<w:p><w:r><w:t>1. 计算 -3 + 5 = ?</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>2. 若 a &lt; b，则 a-b 的符号是</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>测试 &amp;lt; 这个转义坑</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>3. 解方程</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>2x+1=7</w:t></w:r></w:p>' +
        '</w:body></w:document>' }
  ]));
  const PDF = path.join(TMP, 'juan.pdf');
  fs.writeFileSync(PDF, makePDF(3));
  const IMGS = [0, 1, 2].map(i => {
    const p = path.join(TMP, 'q' + i + '.png');
    fs.writeFileSync(p, makePNG(40, 30, [200 - i * 40, 120 + i * 30, 60]));
    return p;
  });
  console.log('造好了：docx ' + fs.statSync(DOCX).size + 'B, pdf ' + fs.statSync(PDF).size + 'B, png×3');

  // ---- 连浏览器 ----
  const t = JSON.parse(await req({ host: 'localhost', port: 9222, path: '/json/new?about:blank', method: 'PUT' }));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = {}; const errs = [];
  const send = (m, p) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.on('message', m => {
    const r = JSON.parse(m);
    if (r.id && pend[r.id]) { pend[r.id](r); delete pend[r.id]; return; }
    if (r.method === 'Runtime.exceptionThrown') {
      const d = r.params.exceptionDetails;
      errs.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (r.method === 'Log.entryAdded' && r.params.entry.level === 'error') errs.push(r.params.entry.text + ' ' + (r.params.entry.url || ''));
  });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable', {}); await send('Log.enable', {});
  await send('Page.enable', {}); await send('DOM.enable', {});
  // ★ 视口钉死。不钉的话量的是"他随手拉的那扇窗"，读数会挂在他的窗口尺寸上——
  //   probe_flow_panel 就是这么过期的（见那份文件顶上的记录）。
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });

  const q = async e => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('页面抛错: ' + JSON.stringify(r.result.exceptionDetails.exception || {}));
    return r.result && r.result.result ? r.result.result.value : null;
  };
  // 等就位
  for (let i = 0; i < 20; i++) { if (await q('!!(window.SR&&SR.files&&SR.chat)')) break; await new Promise(r => setTimeout(r, 1000)); }

  // 等 pendingParts 长到 want 个。找不到就返回实际数量（调用方去判失败）。
  async function waitParts(want, tries) {
    let n = 0;
    for (let i = 0; i < (tries || 40); i++) {
      await new Promise(r => setTimeout(r, 500));
      n = await q('(function(){return SR.chat.__parts().length})()');
      if (n >= want) break;
    }
    return n;
  }

  // ===============================================================
  console.log('\n===== ① kindOf 认不认得各种文件 =====');
  const kinds = await q(`JSON.stringify((function(){
    var mk=function(n,t){return {name:n,type:t||''}};
    return {
      png:SR.files.kindOf(mk('a.png','image/png')),
      jpg:SR.files.kindOf(mk('照片.JPG','')),
      pdf:SR.files.kindOf(mk('juan.pdf','application/pdf')),
      docx:SR.files.kindOf(mk('juan.docx','')),
      txt:SR.files.kindOf(mk('a.txt','text/plain')),
      doc:SR.files.kindOf(mk('老稿.doc','')),
      pptx:SR.files.kindOf(mk('a.pptx','')),
      exe:SR.files.kindOf(mk('a.zip',''))
    };
  })())`);
  const k = JSON.parse(kinds);
  ok('png → image', k.png === 'image', k.png);
  ok('大写 .JPG → image', k.jpg === 'image', k.jpg);
  ok('.pdf → pdf', k.pdf === 'pdf', k.pdf);
  ok('.docx → docx', k.docx === 'docx', k.docx);
  ok('.txt → text', k.txt === 'text', k.txt);
  ok('.doc → doc-old（要明确拒绝）', k.doc === 'doc-old', k.doc);
  ok('.pptx → office（要明确拒绝）', k.pptx === 'office', k.pptx);
  ok('未知格式 → unknown', k.exe === 'unknown', k.exe);

  // ===============================================================
  console.log('\n===== ② .docx 真解得开吗 =====');
  const docNode = (await send('DOM.getDocument', {})).result.root.nodeId;
  const inpNode = (await send('DOM.querySelector', { nodeId: docNode, selector: '#file' })).result.nodeId;
  ok('找得到 <input type=file>', !!inpNode, inpNode);

  // ★ 不要自己再 dispatch 一次 change：CDP 的 DOM.setFileInputFiles **本身就会**触发它。
  //   第一版探针两样都做了，于是每批文件被收两遍（3 个文件量出 6 个），
  //   差点当成产品 bug 去查。（"量出来的数不是它说的那件事"——又栽一次。）
  await send('DOM.setFileInputFiles', { files: [DOCX], nodeId: inpNode });
  await waitParts(1);
  const docText = await q(`JSON.stringify((function(){
    var t=document.getElementById('thumb');
    return { strip:!!t.querySelector('.strip'), meta:(t.querySelector('.meta')||{}).textContent||'',
             files:t.querySelectorAll('.fi').length, docs:t.querySelectorAll('.fi .doc').length,
             imgs:t.querySelectorAll('.fi img').length };
  })())`);
  const dt = JSON.parse(docText);
  ok('docx 只收一遍（不是两遍）', dt.files === 1, dt.files);
  ok('docx 显示成名字块，不是 <img>', dt.docs === 1, dt.docs);
  ok('docx 的正文抽出来了', await q('(function(){var p=SR.chat.__parts()[0];return !!(p&&p.kind==="text"&&p.text.indexOf("计算 -3 + 5")>=0)})()'));

  // ===============================================================
  console.log('\n===== ③ 三个文件一起塞进去 =====');
  await q('SR.chat.__clear()');
  await send('DOM.setFileInputFiles', { files: [IMGS[0], IMGS[1], DOCX], nodeId: inpNode });
  const n = await waitParts(3);
  ok('三个文件都收进来了', n === 3, n);
  const strip = JSON.parse(await q(`JSON.stringify((function(){
    var t=document.getElementById('thumb');
    return { vis:getComputedStyle(t).display, imgs:t.querySelectorAll('.fi img').length,
             docs:t.querySelectorAll('.fi .doc').length, xs:t.querySelectorAll('.fi .x').length,
             meta:(t.querySelector('.meta')||{}).textContent||'' };
  })())`));
  console.log('   ', JSON.stringify(strip));
  ok('缩略图条真的显示出来了（不是 display:none）', strip.vis !== 'none', strip.vis);
  ok('两张图各一格', strip.imgs === 2, strip.imgs);
  ok('docx 一格', strip.docs === 1, strip.docs);
  ok('每格都有 ×', strip.xs === 3, strip.xs);
  ok('meta 写了"3 个文件"', /3 个文件/.test(strip.meta), strip.meta);

  // ===============================================================
  console.log('\n===== ③b PDF 真翻得开吗（pdf.js 是当场从 CDN 下的）=====');
  await q('SR.chat.__clear()');
  await send('DOM.setFileInputFiles', { files: [PDF], nodeId: inpNode });
  const np = await waitParts(3, 80);   // 要下 320KB 的 pdf.js + 渲 3 页，给足时间
  ok('3 页 PDF 渲出 3 张图', np === 3, np);
  ok('pdf.js 真的挂上来了', await q('!!window.pdfjsLib'), await q('typeof window.pdfjsLib'));
  const pnames = JSON.parse(await q('JSON.stringify(SR.chat.__parts().map(function(p){return p.name}))'));
  console.log('   页名:', JSON.stringify(pnames));
  ok('页名带"第 N 页"', pnames.length === 3 && /第 1 页/.test(pnames[0]) && /第 3 页/.test(pnames[2]), pnames);

  // 页数上限：8 页的 PDF 只该看前 6 页，而且**要跟学生交代**（不是偷偷截断）
  console.log('\n===== ③c 页数上限（8 页 → 只收前 6 页，且要说明）=====');
  const pdf8 = path.join(TMP, 'long.pdf');
  fs.writeFileSync(pdf8, makePDF(8));
  await q('SR.chat.__clear()');
  await send('DOM.setFileInputFiles', { files: [pdf8], nodeId: inpNode });
  const n8 = await waitParts(6, 80);
  ok('8 页只收 6 页', n8 === 6, n8);
  await new Promise(r => setTimeout(r, 500));
  const meta8 = await q('(function(){var m=document.querySelector("#thumb .meta");return m?m.textContent:""})()');
  console.log('   meta:', meta8);
  ok('跟学生说了"先看了前 6 页"', /先看了前 6 页/.test(meta8), meta8);

  // 明确拒绝：.doc / .pptx 要有话说，不能静默失败
  console.log('\n===== ③d 读不了的格式要有明确回话 =====');
  const docOld = path.join(TMP, 'laogao.doc');
  fs.writeFileSync(docOld, Buffer.from('not a real doc'));
  await q('SR.chat.__clear()');
  await send('DOM.setFileInputFiles', { files: [docOld], nodeId: inpNode });
  await new Promise(r => setTimeout(r, 1500));
  const st = await q('document.getElementById("status").textContent');
  console.log('   状态栏:', st);
  ok('.doc 给了明确提示（不是没反应）', /另存为|截图/.test(st), st);
  await q('SR.chat.__clear()');

  // ===============================================================
  console.log('\n===== ④ 出站请求体 =====');
  // ★★ 2026-10-03 修：这一段原来是 **9 条全红**（`__sent` 恒为 null），
  //   病因跟 probe_flow_panel 是同一个家族——**尺子过期，不是产品坏了**。
  //   这条路的闸有三道（js/chat.js 的 submit）：① `!SR.api.ready()` ② `SR.landing.intercept()` ③ 空话不发。
  //   这道探针从来没跑过首屏，`body[data-landing]` 一直是 1，于是：
  //     第一句"老师，这是昨天的卷子" → landing 判不出这是六件里的哪一件 →
  //     `held` 住、弹那六块问"这是哪一件"、`intercept()` 返回 true → submit 提前 return。
  //   `window.fetch` 压根没被调到，`__sent` 当然是 null，9 条一起红。
  //   （顺带核过：这一拦**不丢东西**——intercept 是在 `pendingParts=[]` 之前返回的，
  //     老师挂的图还在；`rework()` 拿 `held` 重发时把 parts 带走。产品那边没病。）
  //   所以这里发之前先把首屏收了，并且**判一下它真收了**——不判的话，
  //   哪天首屏的规矩变了，这 9 条又会变成一片假红，而我还会以为是产品坏了。
  await q('(function(){ if (SR.landing && SR.landing.hide) SR.landing.hide(); })()');
  await new Promise(r => setTimeout(r, 400));
  const landingDown = await q('(function(){var l=document.getElementById("landing");'
    + 'return !!(document.body.getAttribute("data-landing")!=="1" && l && l.getClientRects().length===0);})()');
  ok('★ 对照：首屏真收了（没收的话下面 9 条"出站请求体"全量不到，会一片假红）', landingDown === true, landingDown);

  // ★★ 2026-10-03 第二处修：「整卷那条附注」现在**只挂讲评工位**了。
  //   源码 js/api.js:344 就写着这件事：`if (w.listPaper && ...)`，而 config 里
  //   只有 review 那一档 `listPaper: true`（prep 是 false）。注释里给了理由——
  //   原来这条挂在所有工位上，粗条件（≥2 图 或 >800 字）会**误伤**：
  //   老师在备课工位贴一道长应用题，也会被要求"先列题号"。
  //   这道探针原来跑在**默认工位（material／组卷）**上，所以那 4 条必然挂。
  //   → 先把工位切到**讲评**（整卷附注的东家），再挂文件。
  //   ⚠ 顺序不能反：applyWork 换了体系会 `SR.chat.reset()`，先把文件挂上去就被清掉了。
  await q('SR.main.applyWork("review")');
  await new Promise(r => setTimeout(r, 500));
  const seat = await q('JSON.stringify({work:SR.chat.getWork(), listPaper:!!(SR.WORKS[SR.chat.getWork()]||{}).listPaper})');
  ok('★ 对照：站在讲评工位上，而且这一档确实挂着「整卷」那条附注', JSON.parse(seat).work === 'review' && JSON.parse(seat).listPaper === true, seat);

  await send('DOM.setFileInputFiles', { files: [IMGS[0], IMGS[1], DOCX], nodeId: inpNode });
  const n3 = await waitParts(3);
  ok('（重发前先摆好 2 图 + 1 docx）', n3 === 3, n3);
  await q(`window.__sent=null; window.__realFetch=window.fetch; window.fetch=function(u,o){
    window.__sent={url:u, body:JSON.parse(o.body)};
    var s='data: {"choices":[{"delta":{"content":"这份卷子里，哪些是你不会的？"}}]}\\n\\ndata: [DONE]\\n\\n';
    return Promise.resolve(new Response(s,{status:200,headers:{'Content-Type':'text/event-stream'}}));
  };`);
  await q('document.getElementById("input").value="老师，这是昨天的卷子"; SR.chat.submit();');
  for (let i = 0; i < 25; i++) { await new Promise(r => setTimeout(r, 400)); if (await q('!!window.__sent')) break; }
  const sent = JSON.parse(await q('JSON.stringify({model:window.__sent&&window.__sent.body.model, msg:(window.__sent&&window.__sent.body.messages)||[]})'));
  const lastUser = sent.msg[sent.msg.length - 1] || {};
  const content = Array.isArray(lastUser.content) ? lastUser.content : [];
  const imgCount = content.filter(c => c.type === 'image_url').length;
  const textBits = content.filter(c => c.type === 'text').map(c => c.text).join('');
  ok('出站是流式请求', !!sent.model, sent.model);
  ok('请求体里有 2 个 image_url', imgCount === 2, imgCount);
  ok('docx 的正文拼进了文字段', /计算 -3 \+ 5/.test(textBits), textBits.slice(0, 120));
  ok('docx 里 a &lt; b 没被吃成标签', /a < b/.test(textBits), textBits.slice(0, 200));
  ok('&amp;lt; 这个坑没被踩（应还原成 &lt; 字面）', /&lt; 这个转义坑/.test(textBits), textBits.slice(0, 300));

  const sys = (sent.msg[0] || {}).content || '';
  ok('system 里带了"整份题"那条附注', /一整份（或好几道）题/.test(sys), sys.length);
  // ---- 下面三条 2026-10-03 重写过。原因不是产品坏了，是**搜索词过期**：
  //   原来写的三个串（`先别追问`／`铁律第 7 条`／`想说`）在**今天的提示词正文里
  //   一个都不存在**（`grep -rn` 全 js/ 核过）。留着它们 = 三条恒红，
  //   红的样子跟产品坏了长得一模一样，最坏的结果是**以后没人再看这三行**。
  //   按纪律：不发明替代代理，每条改成量它名字宣称的那件事、用当下真实的文本。
  ok('附注里点了"先别摆链子、先把题列一遍"（这句是这条附注的要点）',
    /先别摆链子/.test(sys) && /列一遍/.test(sys));
  ok('附注把三步都写清了：列题 → 问先讲哪一道 → 他挑定后再摆链子',
    /列完再问一句/.test(sys) && /先讲哪一道/.test(sys) && /再按你平常那套摆那一道的链子/.test(sys));
  // ★★ 这一条量的是**位置**，所以就拿收尾块自己的结尾去比 sys 的结尾——
  //   以前拿「想说」当路标是量错了东西：那是**围栏协议**的名字，而围栏协议
  //   现在是**本地兜底为主力、模型写不写都行**（见 js/chips.js:15-22 与 js/config.js:60），
  //   提示词早就不教它了。位置本身才是承重的（小模型只认最后读到的东西）。
  const tailEnd = await q('(function(){var t=SR.PROMPT_PREP_TAIL||"";return t.replace(/\\s+$/,"").slice(-40);})()');
  ok('★ 收尾块（PROMPT_PREP_TAIL）仍然压在 sys 的最末尾——位置是承重的',
    tailEnd.length > 10 && sys.replace(/\s+$/, '').endsWith(tailEnd),
    { 结尾对得上: sys.replace(/\s+$/, '').endsWith(tailEnd), 收尾块末40字: tailEnd, sys末40字: sys.replace(/\s+$/, '').slice(-40) });

  console.log('\n===== 控制台报错 =====');
  console.log(errs.length ? errs.slice(0, 10).map(e => '  ' + e).join('\n') : '  （无）');
  ok('无未捕获异常', errs.length === 0, errs.slice(0, 3));

  await q('window.fetch=window.__realFetch;');
  await send('Emulation.clearDeviceMetricsOverride', {});
  console.log('\n结果：' + PASS + ' 通过, ' + FAIL + ' 失败');
  ws.close();
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('探针自己炸了:', e); process.exit(2); });
