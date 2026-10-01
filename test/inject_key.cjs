// 把孔老师的智谱 Key 从「邰言邰语」那份 index.html 灌进 js/config.js。
//
// 为什么要有个脚本：Key 是长串，手工复制粘贴容易少一位、容易把换行带进去。
// 这里直接读、直接写，全程不经过人手。
//
// ★ 这个 Key 是明文进网页的——孔老师拍板的取舍（同邰言邰语那套）：
//   访客零门槛、不用注册、不花钱、不部署。代价是 Key 公开可被拿用。
//   想收紧就把 config.js 里的 SR.GLM_KEY 清空，页面会自动落回"请用自己的 Key"，其余照常。
//
// 用法: node test/inject_key.cjs
const fs = require('fs'), path = require('path');

const TAIYAN = 'C:/数学办公/邰言邰语/index.html';
const CONFIG = path.join(__dirname, '..', 'js', 'config.js');

const src = fs.readFileSync(TAIYAN, 'utf8');
const m = src.match(/const\s+GLM_KEY\s*=\s*"([^"]+)"/);
if (!m || !m[1]) { console.error('在 ' + TAIYAN + ' 里没找到 GLM_KEY'); process.exit(1); }
const key = m[1].trim();

let cfg = fs.readFileSync(CONFIG, 'utf8');
const before = (cfg.match(/SR\.GLM_KEY\s*=\s*'([^']*)'/) || [])[1];
if (before === key) { console.log('已经是最新的，没动。指纹 ' + fp(key)); process.exit(0); }

cfg = cfg.replace(/SR\.GLM_KEY\s*=\s*'[^']*';/, "SR.GLM_KEY = '" + key + "';");
fs.writeFileSync(CONFIG, cfg);
console.log('写入 config.js：' + (before ? '替换旧 Key ' + fp(before) : '首次填入') + ' → ' + fp(key));

function fp(k) { return k.slice(0, 6) + '…' + k.slice(-4) + '（' + k.length + ' 位）'; }
