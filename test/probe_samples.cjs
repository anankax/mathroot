// 常驻：**把提示词里每一段 ```ggb 配方都抠出来喂给板子**。
//
// 为什么要有这把尺子：样例是给模型抄的。模型抄东西是**逐字抄**的（已实测：
// 角平分线那段连 `距离(O,A)*0.6` 一起搬走，而只讲道理的规则它压根不理）。
// 那么只要提示词里有**一段坏样例**，模型就会忠实地把一个坏图搬到老师面前——
// 而我会以为是"模型不听话"。所以每一段能抄的配方，我自己先得知道它跑不跑得动。
//
// ★ 抠的是**文件里那一行原文**，不是我手打的字符串。手打 = 量了一个跟产品无关的东西。
//
// ★★ 两类块必须分开，头一版没分，报了 4 条"假红"：
//   **完整配方**（带 `#清空`）= 从一张白纸开始画，能独立喂。
//   **片段**（不带 `#清空`）= 只讲某一条命令怎么写，用到的 A/B/C/D 是"你手上本来就有的点"，
//   单独喂必然缺名字。拿它去喂板子 = **量了一个它自己声明不负责的东西**。
//   （这正是那把老尺子栽过的地方：红的样子跟产品坏了长得一样。）
const path=require('path'),fs=require('fs'),http=require('http');
const WebSocket=require(path.join(process.env.USERPROFILE,'.claude','skills','browser','browser','node_modules','ws'));
const put=p=>new Promise((res,rej)=>{const r=http.request({host:'localhost',port:9222,path:p,method:'PUT'},x=>{let s='';x.on('data',c=>s+=c);x.on('end',()=>res(s))});r.on('error',rej);r.end()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const 源=fs.readFileSync(path.join(__dirname,'..','js','prompt-draw.js'),'utf8');
const 行们=源.split(/\r?\n/);
const 拆=ln=>{
  const m=/^\s*"([\s\S]*)"\s*,?\s*$/.exec(ln);
  if(!m) return null;
  return m[1].replace(/\\([\\"])/g,'$1').replace(/\\n/g,'\n').replace(/\\t/g,'\t');
};
const 块=[];
for(let i=0;i<行们.length;i++){
  if(!/^\s*"```ggb",?\s*$/.test(行们[i])) continue;
  const 体=[];let j=i+1;
  for(;j<行们.length;j++){
    if(/^\s*"```",?\s*$/.test(行们[j])) break;
    const t=拆(行们[j]); if(t===null) break;
    体.push(t);
  }
  if(!体.length || j>=行们.length || !/^\s*"```",?\s*$/.test(行们[j])) continue;
  块.push({行号:i+1, 体, 完整:体[0].trim()==='#清空'});
}
const 完整=块.filter(x=>x.完整), 片段=块.filter(x=>!x.完整);
console.log('提示词 '+源.length+' 字符里抠出 '+块.length+' 段 ```ggb：完整配方 '+完整.length+' 段、片段 '+片段.length+' 段\n');

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
 for(let i=0;i<40;i++){await sleep(700);if(await q('!!(window.SR&&SR.board&&SR.board.isReady())')===true)break}
 await send('Page.bringToFront',{});

 const 喂=async(行)=>{
   await q('SR.board.stopPlay()');await q('SR.board.clear()');await sleep(260);
   await q('window.__行='+JSON.stringify(行));
   await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__行,function(){res(1)})}catch(e){res(0)}})})()');
   for(let i=0;i<25;i++){await sleep(200);if(await q('SR.board.isBusy()')===false)break}
   await sleep(320);
   const 没=await q('SR.board.failed()')||[];
   const 壳=await q('(function(){var a=ggbApplet.getAllObjectNames(),o=[];for(var i=0;i<a.length;i++){try{if(!ggbApplet.isDefined(a[i]))o.push(a[i])}catch(e){}}return o})()')||[];
   const 对象=await q('(function(){try{return ggbApplet.getAllObjectNames().length}catch(e){return -1}})()');
   return {没,壳,对象};
 };

 // ══ 零、尺子自检 ═══════════════════════════════════════════════════
 // ★ 老账：**恒绿的断言自己吃自己的报错**。一条"该红"的样本要是不红，
 //   后面所有绿都不可信 —— 因为我不知道这把尺子到底有没有在量东西。
 //   所以先喂一段**明知会坏**的（第 12 题原案：两圆相距 6、半径 1.6），
 //   它必须红；红不了就当场收工，别往下报绿。
 console.log('══ 零、尺子自检：明知会坏的一段，必须红 ══');
 const 自检=await 喂(['#清空','A=(-3,0)','B=(3,0)','c1=圆(A,1.6)','c2=圆(B,1.6)',
   'E=交点(c1,c2,1)','F=交点(c1,c2,2)','垂线=直线(E,F)']);
 if(!自检.壳.length){
   console.log('  ✗ 自检没红（没认 '+JSON.stringify(自检.没)+'、空壳 []）——这把尺子量不出坏图，'
     +'下面所有绿都不作数。收工。');
   ws.close();await put('/json/close/'+t.id);process.exit(3);
 }
 console.log('  ✓ 自检红了（空壳 '+JSON.stringify(自检.壳)+'）——尺子确实在量东西\n');

 // ══ 一、完整配方 ═══════════════════════════════════════════════════
 let 坏=0;
 console.log('══ 一、完整配方（能独立画一张图，模型抄的就是这些）══');
 for(const f of 完整){
   const r=await 喂(f.体);
   const 红=r.没.length||r.壳.length;
   if(红) 坏++;
   const 首行=f.体.filter(x=>x&&x.charAt(0)!=='#')[0]||'(无)';
   console.log('  '+(红?'✗':'✓')+' 第 '+f.行号+' 行（'+f.体.length+' 行，起手「'+首行+'」，板上 '+r.对象+' 个）');
   if(r.没.length) console.log('      没认：'+JSON.stringify(r.没));
   if(r.壳.length) console.log('      空壳：'+JSON.stringify(r.壳));
   if(红) console.log('      全文：\n'+f.体.map(x=>'        '+x).join('\n'));
 }
 console.log('\n  → '+完整.length+' 段完整配方，坏 '+坏+' 段');

 // ══ 二、片段（只登记，不独立喂）════════════════════════════════════
 console.log('\n══ 二、片段（只讲某条命令怎么写，用到的点靠上下文，**不独立喂**）══');
 for(const f of 片段){
   console.log('  · 第 '+f.行号+' 行：'+f.体[0]+(f.体.length>1?'   …共 '+f.体.length+' 行':''));
 }
 console.log('  （这几段没法单独验——它们的 A/B/C/D 是"你手上本来就有的点"。');
 console.log('    拿它们去喂板子只会得到一批和产品无关的报错，正是那把老尺子栽的跟头。）');

 ws.close();await put('/json/close/'+t.id);
 process.exitCode = 坏 ? 4 : 0;
})().catch(e=>{console.error('炸了 '+(e&&e.stack||e));process.exit(2)});
