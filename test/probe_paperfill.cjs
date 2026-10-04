// 「卷子上那张图必须是**空心**的」——这条规则原来写的是
//     if (ty === 'polygon') api.setFilling(s.n, 0);
// 可实测（test/_types.cjs）`getObjectType` 报的是**形状名**不是 polygon：
//   三点→triangle、四点→quadrilateral、五点→pentagon、正 n 边形→polygon、扇形→sector。
// 名字对不上 ⇒ 那条规则**静默地不生效**：三角形带着那层半透明灰底印进卷子，
// 而屏幕上一点异常都看不出来（它本来就是灰的）。
//
// ★ 尺子第一版量错了地方：它去读"存完图之后"的底色，可纸面模式**存完就还原**了，
//   读到的是还原值，于是判我改坏了。抹底色发生在 paperOn 之后、toPNG() 之前，
//   唯一作数的是**印出来的那张位图**。这一版就量位图。
//
// 这把尺子量四件事：
//   ①【反例】把**老写法原样**在真板子上跑一遍，看它动不动三角形 —— 尺子先得能红。
//   ② 印出来的图，跟"手动空心"的那张**逐像素一模一样** ⇒ 卷面上确实是空心的。
//   ③ 对照组：板子上多一条线段，位图必须**不一样** ⇒ 这把尺子分得出差别，不是恒绿。
//   ④ 存完图还要**还回去**：paperOff 的合同是"照抄的还原"，filling 原来抄漏了。
//
// 读的是 ggbApplet 原生值与位图像素，不走 board 自己的封装 —— 别让我的尺子替产品背书。
const path=require('path'),fs=require('fs'),http=require('http');
const WebSocket=require(path.join(process.env.USERPROFILE,'.claude','skills','browser','browser','node_modules','ws'));
const put=p=>new Promise((res,rej)=>{const r=http.request({host:'localhost',port:9222,path:p,method:'PUT'},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d))});r.on('error',rej);r.end()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const 图录=path.join(__dirname,'_shot');try{fs.mkdirSync(图录,{recursive:true})}catch(e){}

const 稿=['#清空','#隐藏 坐标轴和网格',
  'A=(0.6,0.5)','B=(3.6,0.5)','C=(1.4,2.4)','多边形(A,B,C)',
  'P=(2.7,1.5)','O=(0.4,2.0)','圆(O,1.0)'];
// P、O 都落在三角形里面 ⇒ ③ 那条对照线段不会把裁剪框撑大，两张图尺寸才会一致
const 稿3=稿.concat(['线段(P,O)']);

const 扫='(function(){var o={面:[],全:{}};'+
  'ggbApplet.getAllObjectNames().forEach(function(n){'+
  'var t=null;try{t=ggbApplet.getObjectType(n)}catch(e){t="?"}'+
  'var f=null;try{f=ggbApplet.getFilling(n)}catch(e){f=null}'+
  'var v=null;try{v=ggbApplet.getVisible(n)}catch(e){v=null}'+
  'o.全[n]={t:t,f:f,v:v};'+
  'if(/^(triangle|quadrilateral|pentagon|polygon|sector)$/.test(t))o.面.push(n)});return o})()';

// 两张位图逐像素比：返回不同的像素个数（尺寸不同就直接说尺寸不同）
const 比='(function(A,B){return new Promise(function(res){'+
  'function 载(u){return new Promise(function(r){var im=new Image();'+
  'im.onload=function(){r(im)};im.onerror=function(){r(null)};im.src=u})}'+
  '载(A).then(function(a){载(B).then(function(b){'+
  'if(!a||!b){res({差:null,话:"有图没加载出来"});return}'+
  'if(a.width!==b.width||a.height!==b.height){res({差:null,话:"尺寸都不一样 A="+a.width+"x"+a.height+" B="+b.width+"x"+b.height});return}'+
  'var c=document.createElement("canvas");c.width=a.width;c.height=a.height;var g=c.getContext("2d");'+
  'g.drawImage(a,0,0);var da=g.getImageData(0,0,c.width,c.height).data;'+
  'g.clearRect(0,0,c.width,c.height);g.drawImage(b,0,0);var db=g.getImageData(0,0,c.width,c.height).data;'+
  'var 差=0;for(var i=0;i<da.length;i+=4){if(Math.abs(da[i]-db[i])>8||Math.abs(da[i+1]-db[i+1])>8||Math.abs(da[i+2]-db[i+2])>8)差++}'+
  'res({差:差,话:c.width+"x"+c.height,总:c.width*c.height})})})})})';

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

 let 绿=0,红=0;const 判=(好,现,该)=>{(好?绿++:红++);console.log('   '+(好?'✓':'✗')+' '+现+(好?'':'   ← 该是：'+该))};
 const 非空=x=>typeof x==='string'&&x.length>200;
 const 冻=async()=>{for(let i=0;i<10;i++){const u=await q('(function(){return new Promise(function(res){try{SR.board.shoot(function(u){res(u||"")})}catch(e){res("")}})})()');if(非空(u))return u;await sleep(700)}return ''};
 const 画=async 稿本=>{await q('SR.board.clear()');await sleep(400);
   await q('window.__稿='+JSON.stringify(稿本));
   await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__稿,function(){res(1)})}catch(e){res(0)}})})()');await sleep(2200)};

 // ───── 源码级：那条规则不许再按类型名筛 ─────
 // ⚠ 头一版这把尺子报了个假红：我在新代码里写了注释「原来只写 `ty === 'polygon'`」，
 //   整串一比对就命中了**注释**。这是"整句比对漏报"那一族的反面——**误报**。
 //   所以先把**整行注释**剥掉再看（board.js 这一段用的是行首 `//`，剥起来干净）。
 const 源=fs.readFileSync(path.join(__dirname,'..','js','board.js'),'utf8');
 const 码=源.split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
 console.log('源码里那条规则（注释已剥掉）：');
 判(码.indexOf("ty === 'polygon'")<0,'可执行代码里 `ty === \'polygon\'` 没了（不再按类型名筛）','不出现');
 判(/if \(typeof 底 === 'number' && 底 > 0\) api\.setFilling\(s\.n, 0\)/.test(码),'改成了按能力筛：读得到底色且大于 0 才抹平','按能力筛');

 await 画(稿);
 const 前=await q(扫);
 const 三=前.面.length?前.面[0]:null;
 console.log('\n板上建出来的东西：');
 Object.keys(前.全).forEach(n=>console.log('   '+n.padEnd(6)+' 类型='+String(前.全[n].t).padEnd(14)+' 底色='+前.全[n].f));
 判(前.面.length===1&&前.全[三].t==='triangle','三角形建出来了（'+三+' 类型 = '+(前.全[三]&&前.全[三].t)+'）','triangle');
 判(前.全[三].f>0,'★ 它建出来**是带灰底的**（底色 = '+前.全[三].f+'）——所以这不是空谈','> 0');

 // ───── ①【反例】把老写法原样跑一遍 ─────
 const 老=await q('(function(){var n='+JSON.stringify(三)+';'+
   'var ty=ggbApplet.getObjectType(n);'+
   'var 前=ggbApplet.getFilling(n);'+
   'if (ty === "polygon") ggbApplet.setFilling(n, 0);'+   // ← 老写法原样，一个字不改
   'var 后=ggbApplet.getFilling(n);'+
   'return {ty:ty,前:前,后:后}})()');
 console.log('\n① 反例：老写法 `if (ty === \'polygon\') setFilling(n,0)`');
 console.log('   三角形的类型串 = '+老.ty+'　→ 判断结果是 '+(老.ty==='polygon')+'，底色 '+老.前+' → '+老.后);
 判(老.ty!=='polygon','老的类型名判断**根本没命中**（ty 是 '+老.ty+'，不是 polygon）','不命中');
 判(老.前===老.后&&老.前>0,'★ 老写法原样跑一遍，三角形的灰底**纹丝不动**（'+老.前+' → '+老.后+'）——这把尺子在坏版本上会红','一动没动');

 // ───── ② 印出来的那张图 ─────
 const E1=await 冻();
 fs.writeFileSync(path.join(图录,'paperfill_原样.png'),Buffer.from(E1.split(',')[1]||'','base64'));
 await q('window.__E1='+JSON.stringify(E1));
 判(非空(E1),'存图这条路能出图','有内容');
 const 后=await q(扫);
 console.log('\n   存完那一刻（产品路径 SR.board.shoot() 走完后）的底色：');
 Object.keys(后.全).forEach(n=>console.log('     '+n.padEnd(6)+' 底色='+后.全[n].f));

 // 手动把三角形抹成空心的，再存一张 —— 这是"空心"的参照物
 await q('ggbApplet.setFilling('+JSON.stringify(三)+',0)');
 const E2=await 冻();
 fs.writeFileSync(path.join(图录,'paperfill_手动空心.png'),Buffer.from(E2.split(',')[1]||'','base64'));
 await q('window.__E2='+JSON.stringify(E2));
 const c12=await q(比+'(window.__E1,window.__E2)');
 console.log('\n② 位图比一比（'+c12.话+'，共 '+c12.总+' 像素）：');
 console.log('   产品印出来的图 vs 手动空心的图 → 不同的像素 '+c12.差+' 个');
 判(c12.差===0,'★ 印出来就是镂空的：跟"手动把三角形抹成空心"的那张**逐像素一模一样**','0 个像素不同');

 // ───── ③ 对照组：尺子分得出差别吗 ─────
 // 板上多一条落在裁剪框里面的线段（P、O 都在三角形里），位图必须变。
 await 画(稿3);
 const E3=await 冻();
 await q('window.__E3='+JSON.stringify(E3));
 const c13=await q(比+'(window.__E1,window.__E3)');
 console.log('\n③ 对照组：板子上多一条线段（P→O，落在裁剪框内，尺寸不该变）');
 console.log('   跟②那张比 → 不同的像素 '+(c13.差===null?('尺寸都不同：'+c13.话):(c13.差+' 个')));
 判(c13.差===null||c13.差>0,'★ 位图**变了** ⇒ 这把尺子分得出图上的差别，②那条绿不是恒绿','不一样');

 // ───── ④ 存完图得还回去 ─────
 await 画(稿);
 const 前2=await q(扫);
 const E4=await 冻();
 await q('window.__E4='+JSON.stringify(E4));
 const 后2=await q(扫);
 console.log('\n④ 存完图，画板还回去了吗（paperOff 的合同："照抄的还原"）：');
 let 漏=0;
 Object.keys(前2.全).forEach(n=>{
   const a=前2.全[n].f, b=后2.全[n]?后2.全[n].f:undefined;
   if(a!==b){漏++;console.log('   ← 没还回去：'+n+'　存图前底色='+a+'　存图后底色='+b)}
 });
 判(漏===0,'★ 每个对象存完图都还回了原样（底色的**没还的**有 '+漏+' 个）','0 个');
 判(后2.全[三]&&后2.全[三].f===前2.全[三].f&&前2.全[三].f>0,
   '★ 那层灰底存完图还**在屏幕上**（'+前2.全[三].f+'）——老师面前那块板子没被存图改样','跟存图前一样');
 判(后2.全[三]&&后2.全[三].v===前2.全[三].v,'对照：可见性这一项一直是还回去的（"还回去"本来就在做，只是原先前漏了底色）','一致');

 console.log('\n───── 卷面底色：'+绿+' 绿 / '+红+' 红 ─────  留图 test/_shot/paperfill_*.png');
 ws.close();await put('/json/close/'+tab.id);
})().catch(e=>{console.log('炸了 '+e.message);process.exit(1)});
