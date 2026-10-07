// ⑤「上下文按你那句话成组裁」——先把两件纯函数量清楚，再上真页面（probe_ctx5.cjs）。
//
// 这场要证的四件事，缺一条读数就作废：
//   · **切点真落在轮的边界上** —— 留下来的那段第一句**绝不能是 assistant**。
//     少了这条，"切得对"跟"恰好对上"分不清。
//   · ★★ **反例：老写法必须真的切出 assistant 打头** —— 同一份输入喂给改之前的
//     那段代码，它必须吐出一个 assistant 打头的数组。没有这一条，上面那条绿
//     只说明"新代码没炸"，说明不了它治的是不是真病。
//   · **最新那一轮永远留** —— 预算小到连最后一条都装不下时，最后那一整轮仍在。
//   · **略注只摘老师的话** —— 模型自己那些回答一个字都不许进去（摘回去＝让它照着演）。
//
// ⚠ 不碰浏览器、不联网：api.js 只是个 IIFE，用 vm 装进来量。
const vm = require('vm'), fs = require('fs'), path = require('path');

let 绿 = 0, 红 = 0;
const 判 = (名, 真, 读) => {
  if (真) { 绿++; console.log('  ✅ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); }
  else { 红++; console.log('  ❌ ' + 名 + (读 !== undefined ? '   ' + 读 : '')); }
};

// ── 把 js/api.js 装进沙箱 ──────────────────────────────────────
const 源 = fs.readFileSync(path.join(__dirname, '..', 'js', 'api.js'), 'utf8');
const box = { console: console };
box.window = box;                 // 这份文件顶上写的是 `var SR = (window.SR = …)`
box.SR = {};                      // 装载期不调用后端、不读 localStorage，给个空壳就够
vm.createContext(box);
vm.runInContext(源, box, { filename: 'js/api.js' });
const API = box.SR.api;
判('0甲 api.js 装进沙箱、三件都导出了', !!(API && API.trimHistory && API.裁到轮界 && API.略注));

// ── 造一份历史：每条正好 100 字 → estTokens = ceil(100*0.65)+4 = 69 ──
const 长 = n => '甲'.repeat(n);
const m = (role, text) => ({ role: role, content: text });
const 全 = [
  m('assistant', 长(100)),      // 0 开场白
  m('user', 长(100)),           // 1 ← 第 1 轮的问
  m('assistant', 长(100)),      // 2
  m('user', 长(100)),           // 3 ← 第 2 轮的问
  m('assistant', 长(100)),      // 4
  m('user', 长(100)),           // 5 ← 第 3 轮的问（最新那一轮）
  m('assistant', 长(100))       // 6   最新那一轮的回答
];
const 一条 = API.estTokens(全[0]);
判('0乙 每条正好 69 tokens（后面每个预算都是照着它算的）', 一条 === 69, 一条 + ' tokens');

// ── 反例用的老写法：一条一条倒着收（改之前那版） ──────────────────
function 老裁(history, budget) {
  var total = 0, i;
  for (i = 0; i < history.length; i++) total += API.estTokens(history[i]);
  if (total <= budget) return history.slice();
  var keep = [], acc = 0;
  for (i = history.length - 1; i >= 0; i--) {
    var c = API.estTokens(history[i]);
    if (acc + c > budget) break;
    keep.unshift(history[i]);
    acc += c;
  }
  if (!keep.length) keep = [history[history.length - 1]];
  return keep;
}

// ══ 1. 反例：老写法真会切出 assistant 打头 ═══════════════════════
// 预算 100：只剩 69 的最后一条 assistant 装得下、它前面那条 user 装不下。
console.log('\n[反例] 同一份历史、同样 100 的预算，喂给**改之前**那段代码');
const 老留 = 老裁(全, 100);
console.log('   老写法留下：' + JSON.stringify(老留.map(x => x.role)) + '（' + 老留.length + ' 条）');
判('★★ 1甲 老写法**真**切出 assistant 打头（这条不红，说明这个病本来就存在）',
  老留.length > 0 && 老留[0].role === 'assistant', 老留.map(x => x.role).join(','));

console.log('\n[现有写法] 同一份历史、同样 100 的预算');
const 新留 = API.trimHistory(全, 100);
console.log('   新写法留下：' + JSON.stringify(新留.map(x => x.role)) + '（' + 新留.length + ' 条）');
判('★★ 1乙 新写法第一句**不是** assistant（是老师的话）',
  新留.length > 0 && 新留[0].role === 'user', 新留.map(x => x.role).join(','));
判('1丙 新写法留下的是**最新那一整轮**（user + 它的 assistant）',
  新留.length === 2 && 新留[0].role === 'user' && 新留[1].role === 'assistant',
  新留.length + ' 条');

// ══ 2. 最新那一轮永远留 ═══════════════════════════════════════
console.log('\n[极限预算] 50 tokens —— 连最后一条（69）都装不下');
const 极小 = API.trimHistory(全, 50);
console.log('   留下：' + JSON.stringify(极小.map(x => x.role)) + '（' + 极小.length + ' 条）');
判('2甲 最新那一整轮仍在（宁可超预算，也不给一段缺头的上下文）',
  极小.length === 2 && 极小[0].role === 'user' && 极小[1].role === 'assistant',
  极小.map(x => x.role).join(','));
判('2乙 但**没有**把整份历史都留下（"永远留"不是"干脆不裁"）',
  极小.length < 全.length, 极小.length + ' / ' + 全.length);

// ══ 3. 装得下时一个字都不动 ═══════════════════════════════════
const 够大 = API.trimHistory(全, 99999);
判('3甲 预算够 → 原样返回（不裁的时候不许悄悄动手脚）', 够大.length === 全.length, 够大.length + ' 条');
判('3乙 budget 传 0 / 不传 → 原样返回（老约定，没改）', API.trimHistory(全, 0).length === 全.length);

// ══ 4. 略注：只摘老师的话 ═════════════════════════════════════
console.log('\n[略注] 拿"有内容"的一份历史来量（上面那份全是「甲」，看不出摘的是谁）');
const 话历史 = [
  m('assistant', '开场白：我是数根。'),
  m('user', '老师说的话甲：长方体这样画对不对'),
  m('assistant', '模型说的话乙：好的，我已经画好了'),
  m('user', '老师说的话丙：那把这个角标出来'),
  m('assistant', '模型说的话丁：没问题'),
  m('user', '老师说的话戊：最新这一句'),
  m('assistant', '模型说的话己：最新这一答')
];
const 留 = 话历史.slice(5);            // 只留最新那一轮
const note = API.略注(话历史, 留);
console.log('   略注 = ' + note);
判('4甲 略注不是空串（真省掉了话就得说）', typeof note === 'string' && note.length > 0);
判('4乙 轮数对：省掉 2 轮（甲、丙），最新那一句不算', /省掉了开头的 2 轮/.test(note), note.slice(0, 30));
判('4丙 摘了老师那两句话', note.indexOf('长方体这样画对不对') >= 0 && note.indexOf('那把这个角标出来') >= 0);
判('★★ 4丁 模型自己的话**一个字都没进去**（摘回去＝让它照着自己演）',
  note.indexOf('我已经画好了') < 0 && note.indexOf('没问题') < 0, '含"模型说的话乙/丁"= ' + /模型说的话/.test(note));
判('4戊 最新那一句不许被当成"省略的"（它就在上下文里）', note.indexOf('最新这一句') < 0);

console.log('\n[略注] 别的几档');
判('5甲 一句都没省 → 空串（没有那一档就不提那件事）', API.略注(话历史, 话历史.slice()) === '');
判('5乙 留的比全的还长（不该发生）→ 也是空串，不许抛', (() => {
  try { return API.略注(话历史.slice(0, 2), 话历史) === ''; } catch (e) { return '炸:' + e.message; }
})());

const 长话 = [m('user', '这是一个特别特别长的开场白'.repeat(6)), m('assistant', '嗯'), m('user', '短'), m('assistant', '答')];
const note2 = API.略注(长话, 长话.slice(2));
console.log('   长话略注 = ' + note2);
判('5丙 太长的话截到 24 字加省略号（不许把整段题干抄回提示词里）',
  note2.indexOf('…') >= 0 && note2.indexOf('这是一个特别特别长的开场白') >= 0);

const 图轮 = [
  { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } }] },
  m('assistant', '看见了'),
  m('user', '第二句'),
  m('assistant', '答')
];
const note3 = API.略注(图轮, 图轮.slice(2));
console.log('   只发了图那一轮的略注 = ' + note3);
判('5丁 只发图、一个字没打的那一轮：算作一轮，但不编出话',
  /1 轮/.test(note3) && note3.indexOf('没打字') >= 0, note3);

// ══ 6. 裁到轮界 + chat.js 那道按条数的硬闸 ═════════════════════
console.log('\n[裁到轮界] chat.js 的 MAX_TURNS 也走它');
判('6甲 切点落在 assistant 上 → 往左挪到它那条 user', API.裁到轮界(全, 6) === 5, API.裁到轮界(全, 6));
判('6乙 切点本来就在 user 上 → 原地不动', API.裁到轮界(全, 5) === 5);
判('6丙 切点本来就落在一条 user 上 → 原地不动，不硬往左多挪一条', API.裁到轮界(全, 1) === 1, API.裁到轮界(全, 1));
// 挪到 0 的那一档：切点前面**一句 user 都没有**（开场白挨着开场白），挪不动就地停。
const 没边界 = [m('assistant', '开场白一'), m('assistant', '开场白二'), m('user', '问'), m('assistant', '答')];
判('6丁 前面一句 user 都没有 → 停在 0（不抛、也不乱挪）', API.裁到轮界(没边界, 1) === 0, API.裁到轮界(没边界, 1));
判('6戊 越界/负数不抛，夹回来', API.裁到轮界(全, 99) === 全.length && API.裁到轮界(全, -3) === 0);

console.log('\n' + 绿 + ' 绿 / ' + 红 + ' 红');
process.exit(红 ? 1 : 0);
