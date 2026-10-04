// 【提示词里每一段 ```ggb 都跑一遍】—— 提示词自己的样例，自己得跑得对。
//
// 为什么要这一把（2026-10-04，孔老师那句「是不是应该好好学习一下 geogebra 各种功能，
// 构建成体系的提示词」）：
//   模型抄的就是这些样例。样例里少一行 `#隐藏`、弧的端点落在别处、多边形带着灰底
//   印进卷子 —— 提示词正文写得再漂亮都没用，因为它照着抄下来的就是错的。
//   26 段围栏散在 prompt-draw.js 里，靠人一段段看，看漏是迟早的事。
//
// 这把尺子逐段量四件事：
//   ① 建得出东西（不是空板）；② shoot() 出得来图；
//   ③ 带 `#分步` 的，步数 > 0 且每按一步图真的变；
//   ④ 板上**不留可见的数**（滑块/长度会连着自己一起印进存出来的图里）；
//      ⚠ 2026-10-04 起 product 那边加了兜底（board.js `藏白捡的数`：命令自己捡来的、
//        稿里没点过名的数一律藏掉），所以这一条**已经抓不到围栏自己漏藏数**了——
//        它现在量的是"兜底生效了没"。围栏漏藏、指望兜底接住，是**允许**的；
//        真想验围栏自己写得干不干净，得先把兜底关掉再看。别把这条绿当成"围栏写得好"。
//   ⑤ 围栏里每条 `#隐藏 名字`，那个名字在板上真实存在的话，必须真藏住了。
//
// 两条防腐：
//   · **只看行首的围栏**：正文里行内提到「必须有一个 ```ggb 围栏」，
//     松正则会把行内那一下当成开围栏，跟下一个真围栏配成一对，
//     量出来的是"一段带散文的围栏"（我第一版就这么报了 26 段，其中一段是假段）。
//   · **不许写死"一共几段"**：加一段围栏那天，写死的件数会报成"仪器不对"。
//     所以量到的段数照实打印，跑不了的那些**逐条列出来带原因**，一条都不许静默消失。
//
// 跑法：node test/probe_promptfences.cjs [只跑第几段]
const path=require('path'),fs=require('fs'),http=require('http');
const WebSocket=require(path.join(process.env.USERPROFILE,'.claude','skills','browser','browser','node_modules','ws'));
const put=p=>new Promise((res,rej)=>{const r=http.request({host:'localhost',port:9222,path:p,method:'PUT'},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d))});r.on('error',rej);r.end()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const 图录=path.join(__dirname,'_shot');try{fs.mkdirSync(图录,{recursive:true})}catch(e){}

// ── 在 Node 里把 prompt-draw.js 当模块跑一遍，只为拿到渲染后的提示词文本 ──
const 沙={window:{}};
new Function('window','var SR=(window.SR=window.SR||{});'+
  fs.readFileSync(path.join(__dirname,'..','js','prompt-draw.js'),'utf8').replace(/^var SR = .*$/m,''))(沙.window);
const 文=沙.window.SR.PROMPT_DRAW;

// ⚠ 开围栏必须是**行首**：`\n```ggb\n`。行内那句「必须有一个 ```ggb 围栏」后面跟的是空格，配不上。
const 围栏=[];
const re=/\n```ggb\r?\n([\s\S]*?)\n```/g;let m;
while((m=re.exec(文))){
  const 行=m[1].split('\n').map(s=>s.trim()).filter(Boolean);
  const 前=文.slice(Math.max(0,m.index-700),m.index);
  const 标=前.lastIndexOf('老师：「');
  const 名=标>=0?前.slice(标).split('\n')[0].replace(/^老师：「|」.*$/g,'').slice(0,24):'';
  围栏.push({名:名||'(没写老师那句)',行:行});
}
// 哪些跑不了：第一行不是起手式（那是"这么写"的片段，本来就只有一两行，故意不是完整的稿）
const 起手=/^(#清空|坐标系|数轴|#三维|#平面)$/;
const 可跑=[],跳过=[];
围栏.forEach((f,i)=>(起手.test(f.行[0]||'')?可跑:跳过).push({i:i+1,...f}));
console.log('提示词里抠出 '+围栏.length+' 段 ```ggb：可跑 '+可跑.length+' 段，片段 '+跳过.length+' 段');
跳过.forEach(f=>console.log('   · 片段（不跑）：第'+f.i+'段　首行「'+String(f.行[0]).slice(0,40)+'」'));
if(!可跑.length){console.log('★ 一段可跑的都没抠出来 —— 是这把手尺子坏了（正则/文件变了），不是提示词坏了');process.exit(1)}

const 只要=process.argv[2]?Number(process.argv[2]):null;

(async()=>{
 const tab=JSON.parse(await put('/json/new?about:blank'));
 const ws=new WebSocket(tab.webSocketDebuggerUrl,{perMessageDeflate:false});
 let id=0;const pend={};ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&pend[o.id]){pend[o.id](o);delete pend[o.id]}});
 await new Promise(r=>ws.on('open',r));
 const send=(m,p)=>new Promise(r=>{const i=++id;pend[i]=r;ws.send(JSON.stringify({id:i,method:m,params:p}))});
 await send('Page.enable',{});await send('Runtime.enable',{});await send('Network.setCacheDisabled',{cacheDisabled:true});
 const q=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});const R=r.result;
   if(R&&R.exceptionDetails)throw new Error('页面炸了 '+String(R.exceptionDetails.exception&&R.exceptionDetails.exception.description).slice(0,300));
   return R&&R.result?R.result.value:null};
 await send('Page.navigate',{url:'http://localhost:8138/index.html'});await send('Page.bringToFront',{});
 for(let i=0;i<60;i++){await sleep(800);if(await q('!!(window.SR&&SR.board&&SR.board.isReady())')===true)break}

 let 绿=0,红=0;const 判=(好,现,该)=>{好?绿++:红++;if(!好)console.log('       ✗ '+现+'   ← 该是：'+该)};
 const 非空=x=>typeof x==='string'&&x.length>200;
 const 冻=async()=>{for(let i=0;i<8;i++){const u=await q('(function(){return new Promise(function(res){try{SR.board.shoot(function(u){res(u||"")})}catch(e){res("")}})})()');if(非空(u))return u;await sleep(600)}return ''};
 const 对象='(function(){var o=[];ggbApplet.getAllObjectNames().forEach(function(n){'+
   'var t="?";try{t=ggbApplet.getObjectType(n)}catch(e){}'+
   'var v=null;try{v=ggbApplet.getVisible(n)}catch(e){}'+
   'o.push({n:n,t:t,v:v})});return o})()';
 const 可见数='(function(){var a=[];ggbApplet.getAllObjectNames().forEach(function(n){try{'+
   'if(ggbApplet.getObjectType(n)==="numeric"&&ggbApplet.getVisible(n))a.push(n+"="+ggbApplet.getValue(n))}catch(e){}});return a})()';

 console.log('\n逐段跑：');
 for(const f of 可跑){
   if(只要&&f.i!==只要)continue;
   const 标签=('第'+f.i+'段 '+(f.名||'')).slice(0,34).padEnd(36);
   await q('SR.board.clear()');await sleep(350);
   await q('window.__稿='+JSON.stringify(f.行));
   const 画好=await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__稿,function(){res(1)})}catch(e){res(0)}})})()');
   await sleep(2300);
   const 前=(await q(对象))||[];
   const 有步=await q('SR.board.hasSteps()')===true;
   const 步数=有步?await q('SR.board.stepMax()'):0;
   const p0=await 冻();
   if(非空(p0))fs.writeFileSync(path.join(图录,'pf'+String(f.i).padStart(2,'0')+'_0.png'),Buffer.from(p0.split(',')[1]||'','base64'));
   const 坏=[];
   if(!画好)坏.push('draw 没回调');
   if(前.length===0)坏.push('板上一件东西都没有');
   if(!非空(p0))坏.push('shoot 出来的图是空的');
   if(有步&&!(步数>0))坏.push('#分步 在，步数却是 0');
   // 逐步：每按一步图必须变
   let 变了几步=0;
   if(有步&&步数>0){
     let 上=p0;
     for(let s=1;s<=步数;s++){
       await q('SR.board.stepBy(1)');await sleep(750);
       const p=await 冻();
       if(非空(p)&&p!==上)变了几步++;
       上=p;
     }
     fs.writeFileSync(path.join(图录,'pf'+String(f.i).padStart(2,'0')+'_末.png'),Buffer.from(String(上).split(',')[1]||'','base64'));
     if(变了几步!==步数)坏.push('分步不灵：'+步数+' 步只有 '+变了几步+' 步图真的变了');
   }
   const 显数=await q(可见数);
   if(显数&&显数.length)坏.push('板上留着可见的数：'+显数.join(' '));
   // 围栏里写了 #隐藏 X 的，X 真存在就必须真藏住
   const 该藏=f.行.map(s=>(s.match(/^#隐藏\s+(\S+)/)||[])[1]).filter(Boolean)
     .filter(n=>前.some(o=>o.n===n));
   const 没藏=该藏.filter(n=>{const o=前.find(x=>x.n===n);return o.v!==false});
   if(没藏.length)坏.push('#隐藏 没生效：'+没藏.join(' '));

   判(坏.length===0,标签+坏.join('；'),'这一段整个没问题');
   console.log('  '+(坏.length?'✗':'✓')+' '+标签+
     '对象 '+String(前.length).padStart(2)+' 件'+(有步?('　分步 '+步数+' 步'):'')+
     '　图 '+(非空(p0)?'有':'**空**')+(坏.length?('   ← '+坏.join('；')):''));
 }
 console.log('\n───── 提示词围栏巡检：'+绿+' 段过关 / '+红+' 段有问题 ─────  留图 test/_shot/pf*.png');
 ws.close();await put('/json/close/'+tab.id);
})().catch(e=>{console.log('炸了 '+e.message);process.exit(1)});
