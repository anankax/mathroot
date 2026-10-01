// glm-4v-flash 真正的输入天花板上限在哪？（文档说 16K，量一下是不是真的）
// 往提示词后面垫无意义文本，逐档加，看哪一档开始报错。
// 用法: node test/probe_glm_ceiling.cjs
const fs = require('fs');
const URL_GLM = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const KEY = (fs.readFileSync('C:/数学办公/邰言邰语/index.html', 'utf8').match(/const\s+GLM_KEY\s*=\s*"([^"]+)"/) || [])[1];
const PAD = '这是一段用来把输入撑长的填充文字，本身没有意义。';

async function once(targetChars) {
  const body = PAD.repeat(Math.ceil(targetChars / PAD.length));
  const r = await fetch(URL_GLM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
    body: JSON.stringify({
      model: 'glm-4v-flash',
      messages: [{ role: 'user', content: '忽略上面所有内容，只回复两个字：收到\n\n' + body }],
      temperature: 1.0, max_tokens: 16, stream: false
    })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let code = ''; try { code = JSON.parse(t).error.code; } catch (e) {}
    return '败 ' + r.status + ' ' + code;
  }
  const j = await r.json();
  return 'OK 输入 ' + j.usage.prompt_tokens + ' tokens';
}

(async () => {
  for (const chars of [3000, 8000, 12000, 16000, 20000, 26000, 34000, 50000]) {
    const t0 = Date.now();
    let res;
    try { res = await once(chars); } catch (e) { res = '网络错 ' + e.message; }
    console.log('垫 ' + String(chars).padStart(5) + ' 字符（约 ' + Math.round(chars * 0.65 / 1000) + 'K tokens 量级）→ ' + res + '   ' + (Date.now() - t0) + 'ms');
    await new Promise(r => setTimeout(r, 800));
  }
  process.exit(0);
})();
