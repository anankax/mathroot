// 【分步】验收 —— `#分步 n 名字` / `#分步滑块 t` / 上一步·下一步·重置
//
// 这把尺子要量的东西，一句话：**按下一步，画布上真的多出一块吗？按重置，真的回到原样吗？**
//
// 三条防腐设计（都是被坑出来的）：
//  ① **稳定性自检**：不动作连冻两次，必须字节一样。不一样 → 尺子本身不稳，下面全不算数。
//  ② **对照**：同一张图不写 `#分步` 时，stepBy 全是空转，PNG 必须**一模一样**。
//     这条是"让尺子有机会报没变化"——不然"每按一次都不一样"可能只是重绘噪声。
//  ③ **不靠 getVisible 报数**：那是个坏尺子（If 封死的对象它照样报可见）。
//     能画出来才算数，所以全程拿 PNG 字节说话。
//
// ⚠ 驱动滑块 `t` 一律 `#隐藏`。它那个滑块钮**自己在画布上会动**——
//   留着它，"每步都不一样"就是废话（钮动了而已），什么也证明不了。
const path=require('path'),fs=require('fs'),http=require('http');
const WebSocket=require(path.join(process.env.USERPROFILE,'.claude','skills','browser','browser','node_modules','ws'));
const 图录=path.join(__dirname,'_shot');try{fs.mkdirSync(图录,{recursive:true})}catch(e){}
const put=p=>new Promise((res,rej)=>{const r=http.request({host:'localhost',port:9222,path:p,method:'PUT'},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res(d))});r.on('error',rej);r.end()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ── A 段：机制段。三个圆圈点，谁都不挨着谁，最干净 ──
// ★ 底图那一件 `底` **故意不登记进任何一步**，这不是凑数：
//   · 尺子这边：`shoot()` 的契约是"裁到内容"，**整张全白时它故意回空串**
//     （board.js shoot 末尾那句 `if (x1 < 0) cb('') // 整张全白＝什么都没画出来`）。
//     要是三件全登记进步骤，第 0 步就是一张真白板，shoot 回空串——
//     那不是"分步坏了"，是我拿"有没有图可导"去量"状态变没变"，量错了东西。
//   · 产品那边：真实配方**本来就该**留底图不登记（题目的线段、角、图形本身要一直在），
//     不然学生按到"第 0 步"看见的是一片空白，只会以为老师没画。
//     ⚠ 这条得写进提示词。
const 机制=[
  '#清空','#隐藏 坐标轴和网格',
  '底=(3.6,2.4)',
  'P1=(1,1)','P2=(2.2,1)','P3=(3.4,1)',
  'c1=圆(P1,0.55)','c2=圆(P2,0.55)','c3=圆(P3,0.55)',
  't=Slider(0,3,1)','#隐藏 t','#分步滑块 t',
  '#分步 1 P1 c1','#分步 2 P2 c2','#分步 3 P3 c3'
];
// 对照组：一模一样，就是没有那三行 `#分步`
const 对照=机制.filter(s=>!/^#分步\s/.test(s));

// ── B 段：真实尺规作角平分线 ──
const 尺规=[
  '#清空','#隐藏 坐标轴和网格',
  'O=(0,0)','A=(3.2,0)','B=(1.5,2.6)',
  '射线(O,A)','射线(O,B)',
  't=Slider(0,3,1)','#隐藏 t','#分步滑块 t',
  'r=Slider(1,2.2,0.1)','c1=圆(O,r)',
  'E=交点(c1,射线(O,A),1)','F=交点(c1,射线(O,B),1)',
  'a1=弧(O,E,F)',
  '#分步 1 E F a1',
  'd=距离(E,F)','c2=圆(E,d)','c3=圆(F,d)',
  'K=交点(c2,c3,2)','a2=弧(E,K,F)','a3=弧(F,E,K)',
  '#分步 2 K a2 a3',
  '角平分线=射线(O,K)',
  '#分步 3 角平分线',
  '#隐藏 c1','#隐藏 c2','#隐藏 c3','#隐藏 r','#隐藏 d'
];

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
 if(await q('!!(window.SR&&SR.board&&SR.board.isReady())')!==true){console.log('✗ 画板没就绪');process.exit(1)}

 // ★ `shoot()` 头几次会回空串：它的出图是「先 toPNG()，再异步解码裁边」，
 //   板子刚起来那几秒钟解码赶不上 SHOOT_MAX 就交了空卷。所以**重试到真拿到图为止**。
 //   ⚠ 但重试只是让它拿到图；**不许**因此就放宽断言——空串必须判红，
 //   否则「三张都是空串」会被 `c0===c1&&c1===c2` 读成"纹丝不动 ✓"（比三个零）。
 const 非空=x=>typeof x==='string'&&x.length>200;
 const 冻=async()=>{
   for(let i=0;i<10;i++){
     const u=await q('(function(){return new Promise(function(res){try{SR.board.shoot(function(u){res(u||"")})}catch(e){res("")}})})()');
     if(非空(u))return u;
     await sleep(700);
   }
   return '';   // 十次都空 —— 这不是"没变化"，这是尺子坏了，下面每条都会红
 };
 async function 摆(稿){await q('SR.board.clear()');await sleep(400);
   await q('window.__稿='+JSON.stringify(稿));
   await q('(function(){return new Promise(function(res){try{SR.board.draw(window.__稿,function(){res(1)})}catch(e){res(0)}})})()');await sleep(1200)}
 // 条子读三样：**在不在**(量 rect，别量 display——藏的是它爹的话孩子照样报 flex)、几步、按钮能不能点
 const 条=async()=>await q('(function(){var b=document.getElementById("stepbar"),n=document.getElementById("stepnum"),p=document.getElementById("btn-prev"),x=document.getElementById("btn-next");'+
   'return {在:!!b&&b.getClientRects().length>0, 字:n?n.textContent:"", 上一步灰:!!p&&p.disabled, 下一步灰:!!x&&x.disabled, 步数:SR.board.stepMax(), 第几步:SR.board.stepNow(), 有分步:SR.board.hasSteps()}})()');
 const 按=async w=>{await q('document.getElementById("'+w+'").click()');await sleep(700)};
 const 存=(名,d)=>{try{fs.writeFileSync(path.join(图录,名),Buffer.from(String(d).split(',')[1]||'','base64'))}catch(e){}};

 let 绿=0,红=0;
 const 判=(好,现,该)=>{(好?绿++:红++);console.log('   '+(好?'✓':'✗')+' '+现+(好?'':'   ← 该是：'+该))};

 // ───────── 热身：先把 shoot 那几个空卷熬过去 ─────────
 await 摆(机制);
 const 热=await 冻();
 console.log('【热】shoot 热身：'+(非空(热)?'拿到图了':'★ 十次都没拿到图，下面全是红'));

 // ───────── 0. 尺子自检 ─────────
 console.log('【0】尺子稳不稳（不动作连冻两次）');
 await sleep(600);
 const a=await 冻();await sleep(500);const b=await 冻();
 判(非空(a)&&a===b, '连冻两次字节一样', '非空且一样（拿到的 '+a.length+'/'+b.length+'）');

 // ───────── 1. 没有 `#分步` 时，这套机制必须一动不动 ─────────
 console.log('\n【1】对照：同一张图不写 `#分步`');
 await 摆(对照);
 const c0=await 冻();const s0=await 条();
 await q('SR.board.stepBy(1)');await sleep(600);const c1=await 冻();
 await q('SR.board.stepBy(1)');await sleep(600);const c2=await 冻();
 判(s0.有分步===false, 'hasSteps() = false', 'false');
 判(s0.在===false, '分步条不出现', '不出现');
 判(非空(c0)&&非空(c1)&&非空(c2), '对照图真拿到了三张（不是三个空串）', '三张都有内容');
 判(c0===c1&&c1===c2, 'stepBy 空转，画布纹丝不动', '三次一模一样');

 // ───────── 2. 机制段：登记、走步、重置 ─────────
 console.log('\n【2】`#分步` 机制（三个圆圈点）');
 await 摆(机制);
 const p0=await 冻();const t0=await 条();
 判(非空(p0), '冻出了图（非空）', '有 PNG');
 判(t0.有分步===true, 'hasSteps() = true', 'true');
 判(t0.步数===3, 'stepMax() = 3', '3');
 判(t0.第几步===0, 'stepNow() 起手 = 0（只露底图）', '0');
 判(t0.在===true, '分步条出现', '出现');
 判(t0.字==='第 0 / 3 步', '步数文字 =「'+t0.字+'」', '第 0 / 3 步');
 判(t0.上一步灰===true, 'step 0 时「上一步」是灰的', '灰的');
 判(t0.下一步灰===false, 'step 0 时「下一步」能点', '能点');
 存('step_A0.png', p0);

 await 按('btn-next');
 const p1=await 冻();const t1=await 条();
 判(非空(p1)&&p1!==p0, '按一次「下一步」→ 画布**变了**（P1 c1 冒出来）', '变');
 判(t1.第几步===1, 'stepNow() = 1', '1');
 判(t1.字==='第 1 / 3 步', '步数文字跟着走', '第 1 / 3 步');
 判(t1.上一步灰===false, '现在「上一步」能点了', '能点');
 存('step_A1.png', p1);

 await 按('btn-next');
 const p2=await 冻();const t2=await 条();
 判(非空(p2)&&p2!==p1, '再按一次 → 又变了（P2 c2）', '变');
 判(t2.第几步===2, 'stepNow() = 2', '2');

 await 按('btn-next');
 const p3=await 冻();const t3=await 条();
 判(非空(p3)&&p3!==p2, '第三次 → 再变（P3 c3）', '变');
 判(t3.第几步===3, 'stepNow() = 3', '3');
 判(t3.下一步灰===true, '到头了「下一步」该灰', '灰的');
 判(非空(p3)&&p0!==p3, 'step3 和 step0 不是同一张（两张都非空）', '不同');
 存('step_A3.png', p3);

 await 按('btn-prev');
 const p2b=await 冻();const t2b=await 条();
 判(t2b.第几步===2, '「上一步」回到 2', '2');
 判(非空(p2b)&&p2b===p2, '回到 step2 的图**和刚才那张字节一样**', '一模一样');
 判(非空(p2b)&&p2b!==p3, '确实离开了 step3', '不一样');

 await 按('btn-reset');
 const pR=await 冻();const tR=await 条();
 判(tR.第几步===0, '「重置」回到 0', '0');
 判(非空(pR)&&pR===p0, '★ 重置后的图**和最初那张字节一样**', '一模一样');
 判(tR.在===true&&tR.第几步===0, '重置后条子还在（只是回到 0 步）', '在');

 // ───────── 3. 驱动滑块与按钮是同一个真相 ─────────
 console.log('\n【3】滑块驱动 = 按钮驱动？');
 await q('SR.board.stepReset()');await sleep(500);
 await q('try{ggbApplet.setValue("t",2)}catch(e){}');await sleep(900);
 const s2=await 冻();const ts=await 条();
 判(ts.第几步===2, '把滑块拨到 2 → stepNow() 也是 2（监听器活着）', '2');
 判(s2===p2, '★ 滑块拨出来的 step2 和按钮走出来的 step2 字节一样', '一模一样');
 await q('SR.board.stepBy(1)');await sleep(800);
 判(await q('Number(ggbApplet.getValue("t"))')===3, '再按「下一步」→ 滑块被写回 3（两个口子不打架）', '3');

 // ───────── 4. 尺规作图那段 —— 真配方 ─────────
 console.log('\n【4】尺规作角平分线（真配方 + #分步）');
 await 摆(尺规);
 const q0=await 冻();const u0=await 条();
 判(u0.步数===3, '尺规那张也认出了 3 步', '3');
 判(非空(q0), '画出来了（不是空图）', '有内容');
 存('step_B0.png', q0);
 for(let i=1;i<=3;i++){
   await 按('btn-next');
   const p=await 冻();
   判(非空(p)&&p!==q0, '尺规 step'+i+' 有东西冒出来', '有变化');
   存('step_B'+i+'.png', p);
 }
 const u3=await 条();
 判(u3.第几步===3&&u3.下一步灰===true, '尺规走到头了，按钮灰掉', '3 步且灰');

 // ───────── 5. `#清空` 该把分步一起忘了 ─────────
 console.log('\n【5】`#清空` 之后');
 await q('SR.board.clear()');await sleep(800);
 const u=await 条();
 判(u.有分步===false, 'hasSteps() 回到 false', 'false');
 判(u.在===false, '分步条收起来了', '收起来');
 判(u.步数===0, 'stepMax() 归 0', '0');

 // ───────── 6. 记一条契约：全白板子 shoot 故意回空串 ─────────
 //   写下来是因为这一条**长得像坏了**：第 0 步要是把底图也登记进分步，
 //   冻图就会是空串，下一个人（包括我自己）会去查"分步怎么不生效"。
 console.log('\n【6】契约：全白板子 → shoot 回空串（故意，不是坏）');
 await 摆(机制);
 await q('SR.board.stepBy(-1);SR.board.stepReset()');await sleep(500);
 await q('try{ggbApplet.setVisible("底",false)}catch(e){}');await sleep(900);
 const 白raw=await q('(function(){try{return (ggbApplet.getPNGBase64(2,false,96)||"").length}catch(e){return "THROW"}})()');
 const 白=await q('(function(){return new Promise(function(res){try{SR.board.shoot(function(u){res(u||"")})}catch(e){res("THROW")}})})()');
 const 白2=await 冻();   // 冻() 会重试 10 次；它还是空，就说明"空"是真的
 判(白raw>10000, '白板子其实导得出位图（raw '+白raw+' 字节）', 'GeoGebra 有输出');
 判(白==='', 'shoot 判"没有可裁的内容"→ 回空串', '空串');
 判(白2==='', '重试十次也还是空（不是慢，是真没有）', '还是空');
 await q('try{ggbApplet.setVisible("底",true)}catch(e){}');await sleep(900);
 判(非空(await 冻()), '把底图放回来 → 立刻又有图了（尺子没坏）', '有图');

 console.log('\n───── '+绿+' 绿 / '+红+' 红 ─────');
 console.log('留图：test/_shot/step_A*.png、step_B*.png');
 ws.close();await put('/json/close/'+tab.id);
})().catch(e=>{console.log('探针本身炸了：'+e.message);process.exit(1)});
