// 【半截围栏被吞进画板 —— 捞回那段该在"又一个围栏的开头"停下】—— 2026-10-04
//
// 起因：体检表第 51 号（H 动点：D 在 BC 上动，看 E 的位置）。模型写的是
//     ggb                        ← 开头三个反引号掉了，走 render.js 的捞回逻辑
//     #清空 … #播放 D
//     ```想知道                  ← 紧接着**另一个围栏**（它想给学生三个可点的话）
//     D 在 BC 上运动时，E 点的位置变化
//   （这一份的流在最后被截断，收尾的 ``` 没出来。）
// 老师看到的状态条上写着「画板没认：```想知道 …」，而那句本该变成按钮的白话，
// 在屏幕上整个消失。
//
// 病根只有一处：捞回那段判"块尾"只有两条——整行都是反引号、或空行；
// ```` ```想知道 ```` 一样都不是，于是被当正文往后收。
//
// ★ 我第一轮判成"完整的 ```` ```想说 … ``` ```` 也会被吞"——**判错了**。
//   test/_leak.cjs 的对照 B/C 当场否掉：主正则（render.js:42）在捞回**之前**就跑过，
//   围栏齐全的想说块早被摘走。撞上这条的只有"围栏没收尾"的尾部，**跟标签叫什么无关**。
//   所以这里**不加 `想知道` 这种别名**：实测 57 份回复里那个词只出现 1 次，
//   凭一个样本加别名就是"想多拦一点"。（同族教训：[[scanner-numbers-are-not-what-they-claim]]）
//
// 这把尺子量五件事：
//   ⓪【能红】把**老的两行块尾判据**（逐字抄在下面）喂同一份文本，它**必须**把
//           ```` ```想知道 ```` 和那句白话收进画板体。——这条洞是真的，①那条绿不是空转。
//           ⚠ 这是"判据的转录"，不是老产品本身；它量的是"以前那两行遇到这份输入会怎样"。
//   ①【正题·解析器】51 号原文走真产品 SR.render.parseFences：
//           画板体里**不许**有反引号、不许有「想知道」、不许有那句白话；
//           **且 15 条真命令一条不少**（防止我把块切短了——两样都得量）。
//   ②【正题·到画板】同一份走 SR.board.draw：状态条上「没认」的列表里
//           **一个字都不许**沾反引号或那句白话（这才是老师眼前那句话）。
//   ③【对照·空行】掉了开头反引号的块 + 空行 + 一句正文：正文**必须照旧留着**
//           ——空行收尾是原来就写对的行为，不许被我改坏。
//   ④【对照·围栏齐全】```ggb … ``` 跟 ```想说 … ``` 都齐全时，三样东西各归各位。
//
// 跑法：node test/probe_leak.cjs
const path=require('path'),http=require('http');
const WebSocket=require(path.join(process.env.USERPROFILE,'.claude','skills','browser','browser','node_modules','ws'));
const put=p=>new Promise((res,rej)=>{const r=http.request({host:'localhost',port:9222,path:p,method:'PUT'},x=>{let s='';x.on('data',c=>s+=c);x.on('end',()=>res(s))});r.on('error',rej);r.end()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// 51 号原文，逐字取自 test/_figall.json（不手抄）
const 原文51=['ggb','#清空','A=(-3,0)','B=(3,0)','C=(0,4)','多边形(A,B,C)','D=Slider(-3,3,0.01)','#隐藏 D','#隐藏 DE',
  'DE=线段(D, C)','E=交点(AC, DE)','线段(E,B)','#隐藏 D','#隐藏 E','#隐藏 DE','#播放 D',
  '```想知道','D 在 BC 上运动时，E 点的位置变化'].join('\n');
// 真命令 15 条（从 `#清空` 到 `#播放 D`），修复**不许**把它们切掉
const 真命令=['#清空','A=(-3,0)','B=(3,0)','C=(0,4)','多边形(A,B,C)','D=Slider(-3,3,0.01)','#隐藏 D','#隐藏 DE',
  'DE=线段(D, C)','E=交点(AC, DE)','线段(E,B)','#隐藏 D','#隐藏 E','#隐藏 DE','#播放 D'];
const 白话='D 在 BC 上运动时，E 点的位置变化';

const 空行例=['ggb','#清空','A=(0,0)','线段(A,B)','','画好了，你看到 A 和 B 了吗？'].join('\n');
const 齐全例=['```ggb','#清空','A=(0,0)','B=(2,0)','线段(A,B)','```',
  '```想说','为什么 A 动了？','先看看 B 会不会动','```'].join('\n');

// ⓪ 老的两行块尾判据，逐字抄自改动前的 render.js:93-94
//     if (RE_TICKLINE.test(行[k])) { k++; break; }        // RE_TICKLINE = /^[ \t]*`{3,}[ \t]*$/
//     if (!行[k].trim()) break;
function 老判据扫块尾(行, 头){
  var k = 头 + 1;
  for (; k < 行.length; k++) {
    if (/^[ \t]*`{3,}[ \t]*$/.test(行[k])) { k++; break; }
    if (!行[k].trim()) break;
  }
  return 行.slice(头 + 1, k);
}

(async()=>{
 const t=JSON.parse(await put('/json/new?about:blank'));
 const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});
 let id=0;const pend={};ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&pend[o.id]){pend[o.id](o);delete pend[o.id]}});
 await new Promise(r=>ws.on('open',r));
 const send=(m,p)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}))});
 await send('Page.enable',{});await send('Runtime.enable',{});await send('Network.enable',{});await send('Network.setCacheDisabled',{cacheDisabled:true});
 const q=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});const R=r.result;
   if(R&&R.exceptionDetails)throw new Error('页面炸了 '+String(R.exceptionDetails.exception&&R.exceptionDetails.exception.description).slice(0,200));
   return R&&R.result?R.result.value:null};
 await send('Page.navigate',{url:'http://localhost:8138/index.html'});
 let 好=false;for(let i=0;i<40;i++){await sleep(700);if(await q('!!(window.SR&&SR.render&&SR.board&&SR.board.isReady())')===true){好=true;break}}
 if(!好){console.log('没起来');process.exit(1)}
 await send('Page.bringToFront',{});

 let 绿=0,红=0;const 判=(好2,现,该)=>{好2?绿++:红++;console.log('   '+(好2?'✓':'✗')+' '+现+(好2?'':'   ← 该是：'+该))};
 const 有反引号=s=>/`/.test(s||'');
 const 解析=async 文=>await q('SR.render.parseFences('+JSON.stringify(文)+')');

 // ═══ ⓪ 能红 ═══
 console.log('\n⓪ 能红：老的两行块尾判据（逐字抄自改动前的 render.js）遇到这份输入会怎样');
 const 行=原文51.split('\n'), 头=行.findIndex(s=>s.trim()==='ggb');
 const 老体=老判据扫块尾(行,头);
 console.log('   老判据收进去的块体（最后两行）：');
 老体.slice(-2).forEach(s=>console.log('     '+JSON.stringify(s)));
 判(老体.some(有反引号),'老判据**真的**把 ```` ```想知道 ```` 收进了画板体 ⇒ 这条洞是真的','收进去');
 判(老体.indexOf(白话)>=0,'老判据**真的**把那句白话也收进去了（它在屏幕上会消失）','收进去');

 // ═══ ① 正题·解析器 ═══
 console.log('\n① 正题：51 号原文走真产品 parseFences');
 const P=await 解析(原文51);
 const 体=(P.ggb||[]).join('\n');
 console.log('   画板体的最后两行：'+JSON.stringify(体.split('\n').slice(-2)));
 console.log('   正文/pending：visible='+JSON.stringify(P.visible)+'  pending='+JSON.stringify(P.pending));
 判(P.ggb.length===1,'画板体**还是那一个块**（没被拆成两半）','1 块');
 判(!有反引号(体),'画板体里**一个反引号都没有**','干净');
 判(体.indexOf('想知道')<0,'画板体里**没有「想知道」**','没有');
 判(体.indexOf(白话)<0,'画板体里**没有那句白话**','没有');
 const 体行=体.split('\n').filter(s=>s.trim());
 判(体行.length===真命令.length && 真命令.every((c,i)=>体行[i]===c),
    '★ 15 条真命令**一条不少、顺序不变**（不是把块切短了换来的干净）','15 条都在');
 // ⚠ 第一版这两条我写成了"visible 和 pending 都不许有反引号"——**判据写错了**：
 //   pending 的定义就是"把没闭合的尾巴原文（含那三个反引号）原样存着"，
 //   它**天生带反引号**。要量的不是"pending 干不干净"，而是"它**会不会被显示**"。
 //   grep 过一遍：`p.pending` 在产品里**没有任何一处被渲染**
 //   （chat.js 里那些 `pending` 是上传件和占位符的类名，跟这个字段无关）。
 //   所以判据是：visible 里不出现 + pending 确实把它收走了。
 判(!有反引号(P.visible),'半截围栏**没漏到老师屏幕上**（visible 里一个反引号都没有）','不漏');
 判((P.pending||'').length>0,'那半截确实被"没闭合的尾巴"收走了（进 pending 藏起来，产品里不渲染它）','收走');

 // ═══ ② 正题·到画板 ═══
 //   ⚠ 喂**产品真正喂的那一份**：chat.js:1522 `var lines = p.ggb[i].split('\n'); SR.board.run(lines)`。
 //     第一版我把**原文整段**（连那行 `ggb` 也算一条命令）直接塞给了 draw，
 //     于是没认列表里凭空多了个 `"ggb"`——那不是产品坏了，是我喂错了东西。
 console.log('\n② 正题：走产品那条路（parseFences 的结果 → board.run），看老师眼前那句话');
 await q('SR.board.stopPlay()');await q('SR.board.clear()');
 await q('SR.chat&&SR.chat.setStatus&&SR.chat.setStatus("")');await sleep(450);
 await q('window.__稿='+JSON.stringify((P.ggb[0]||'').split('\n')));
 await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__稿,function(){res(1)})}catch(e){res(0)}})})()');
 for(let i=0;i<30;i++){await sleep(250);if(await q('SR.board.isBusy()')===false)break}
 await sleep(600);
 const s=await q('(function(){var e=document.getElementById("status");return {文:e?e.textContent||"":"",没认:SR.board.failed()||[]}})()');
 console.log('   状态条：'+(s.文?JSON.stringify(s.文.slice(0,200)):'（空的）'));
 console.log('   没认  ：'+JSON.stringify(s.没认));
 判(!(s.没认||[]).some(有反引号),'★ 没认列表里**一个反引号都不沾**（老师昨天看到的就是这条）','不沾');
 判(!(s.没认||[]).some(x=>String(x).indexOf(白话)>=0),'没认列表里**没有那句白话**','没有');

 // ═══ ③ 对照·空行收尾 ═══
 console.log('\n③ 对照：掉了开头反引号的块 + 空行 + 一句正文（原来就写对的行为）');
 const P3=await 解析(空行例);
 console.log('   正文：'+JSON.stringify(P3.visible));
 判(P3.visible.indexOf('画好了')>=0,'空行照样收尾，正文**原样留着**（没被我改坏）','留着');
 判((P3.ggb||[]).join('\n').indexOf('画好了')<0,'那句正文**没被吞进画板**','没吞');

 // ═══ ④ 对照·围栏齐全 ═══
 console.log('\n④ 对照：```ggb … ``` 与 ```想说 … ``` 都齐全');
 const P4=await 解析(齐全例);
 console.log('   ggb='+JSON.stringify(P4.ggb)+'\n   say='+JSON.stringify(P4.say));
 判((P4.ggb||[]).length===1 && (P4.ggb||[])[0].indexOf('线段(A,B)')>=0,'画板块**照旧**摘出来','1 块');
 判((P4.say||[]).length===1 && (P4.say||[])[0].indexOf('为什么 A 动了？')>=0,'想说的三个按钮**照旧**摘出来','1 块');

 console.log('\n───── 半截围栏：'+绿+' 绿 / '+红+' 红 ─────');
 ws.close();await put('/json/close/'+t.id);
})().catch(e=>{console.error('炸了 '+(e&&e.stack||e));process.exit(2)});
