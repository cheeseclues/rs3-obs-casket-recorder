'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const M=require('./detector.js');
const binaryToB64=bytes=>Buffer.from(bytes).toString('base64');
const s=M.SIZE, margin=M.MARGIN, w=520,h=400;
let t=100000, nextTimer=1, cursor={x:100,y:100}, lastClickAt=-10000;
let screen=new Uint8Array(w*h*4), captures=0;
const elements=new Map(), handlers=new Map(), store=new Map(), timers=new Map();
function pattern(salt){const p=new Uint8Array(s*s*4);for(let y=0;y<s;y++)for(let x=0;x<s;x++){const z=(y*s+x)*4;p[z]=((x*13+y*19+salt*77)^(y*x*7+salt*11))&255;p[z+1]=((x*23+y*11+salt*59)^(y*x*9+salt*31))&255;p[z+2]=((x*17+y*29+salt*37)^(y*x*13+salt*43))&255;p[z+3]=255;}return p;}
const patch={easyC:pattern(1),eliteC:pattern(5),easyR:pattern(9),eliteR:pattern(11)};
function place(p,x,y){for(let yy=0;yy<s;yy++)for(let xx=0;xx<s;xx++){const dst=((y+yy)*w+x+xx)*4, src=(yy*s+xx)*4;screen.set(p.subarray(src,src+4),dst);}}
function resetScreen(){screen.fill(40);for(let p=3;p<screen.length;p+=4)screen[p]=255;}
function region(x,y,width,height){captures++;if(x<0||y<0||x+width>w||y+height>h)throw Error('Out of bounds');const out=new Uint8Array(width*height*4);for(let yy=0;yy<height;yy++){const sub=screen.subarray(((y+yy)*w+x)*4,((y+yy)*w+x+width)*4);out.set(sub,yy*width*4);}return binaryToB64(out);}
function setT(fn,ms=0,periodic=false){const id=nextTimer++;timers.set(id,{fn,at:t+(Number(ms)||0),period:periodic?(Number(ms)||1):0});return id;}
function clearT(id){timers.delete(id)}
async function flush(){for(let i=0;i<10;i++)await Promise.resolve();}
async function tick(ms){const end=t+ms;let guard=0;while(true){let next=null;for(const [id,v] of timers)if(v.at<=end&&(!next||v.at<next[1].at))next=[id,v];if(!next)break;if(++guard>20000)throw Error('Runaway timer');const [id,v]=next;t=v.at;if(v.period)v.at+=v.period;else timers.delete(id);v.fn();await flush();}t=end;await flush();}
function makeRef(p,position){return {position,template:M.templateFromCapture(p)};}
store.set('rs3obs-casket-template-v1',JSON.stringify(M.templateFromCapture(patch.eliteC)));
store.set('rs3obs-reward-template-v1',JSON.stringify(makeRef(patch.eliteR,{x:290,y:200})));
store.set('rs3obs-reroll-button-v1',JSON.stringify({x:350,y:270}));
store.set('rs3obs-settings-v04',JSON.stringify({liveRecord:false,autoWatch:false,autoBuffer:false}));
const names=['log','altstatus','permissions','status','password','connect','disconnect','test','stop','recordState','calstatus','calibrate','clear','threshold','thresholdNumber','detectStatus','confidence','watch','unwatch','liveRecord','copy','rewardCalibrate','rewardClear','rewardStatus','rewardThreshold','rewardThresholdNumber','rememberPassword','autoConnect','autoWatch','forgetPassword','rewardDetectStatus','rewardConfidence','rerollCalibrate','rerollClear','rerollStatus','bufferStatus','bufferStart','bufferSaveTest','autoBuffer','replaySeconds','tierSelect','tierSummary'];
for(const id of names)elements.set(id,{id,textContent:'',value:'',checked:false,disabled:false,className:'',scrollTop:0,scrollHeight:0,addEventListener(type,fn){handlers.set(id+':'+type,fn)}});
elements.get('tierSelect').value='elite';elements.get('threshold').value='95';elements.get('rewardThreshold').value='96';elements.get('replaySeconds').value='60';
const alt1={rsLinked:true,permissionPixel:true,permissionGameState:true,permissionInstalled:true,rsWidth:w,rsHeight:h,captureInterval:120,get mousePosition(){return (cursor.x<<16)|cursor.y},get rsLastActive(){return t-lastClickAt},getRegion:region,identifyAppUrl:()=>{}};
const context={document:{getElementById:id=>{const item=elements.get(id);assert.ok(item,`missing element ${id}`);return item}},window:{},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},performance:{now:()=>t}, Date,JSON,Math,Map,Set,Number,String,Error,Promise,Uint8Array,TextEncoder,atob:str=>Buffer.from(str,'base64').toString('binary'),btoa:str=>Buffer.from(str,'binary').toString('base64'),setTimeout:(fn,ms)=>setT(fn,ms),clearTimeout:clearT,setInterval:(fn,ms)=>setT(fn,ms,true),clearInterval:clearT,console,navigator:{clipboard:{writeText:async()=>{}}},crypto:{subtle:{digest:async()=>new Uint8Array(32).buffer}}};
context.window=context;context.window.alt1=alt1;context.window.addEventListener=()=>{};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'detector.js'),'utf8'),context);
let code=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
code=code.replace(/\}\)\(\);\s*$/,`window.__test={sampleMatch,sampleRewardWindow,startWatching,stopWatching,pollClicks,calibrations:()=>({casketTemplates,rewardTemplates,rerollPositions}),getLastDetected:()=>lastDetected,getActiveRewardTier:()=>activeRewardTier};\n})();`);
assert.ok(code.includes('window.__test='));vm.runInContext(code,context);
async function invoke(id,type='click'){const h=handlers.get(id+':'+type);assert.ok(h,id);h();await flush()}
(async()=>{
  const storeKey='rs3obs-tier-calibrations-v062';
  let m=JSON.parse(store.get(storeKey));
  assert.ok(m.caskets.elite&&m.rewards.elite&&m.rerolls.elite,'legacy Elite migration');
  assert.ok(!m.caskets.easy,'no invented Easy calibration');
  assert.match(elements.get('tierSummary').textContent,/Elite: casket ✓ · reward ✓ · reroll ✓/);
  // Teach Easy without overwriting existing Elite calibration.
  elements.get('tierSelect').value='easy';await invoke('tierSelect','change');
  cursor={x:100,y:100};resetScreen();place(patch.easyC,86,86);
  await invoke('calibrate');await tick(3000);
  m=JSON.parse(store.get(storeKey));assert.ok(m.caskets.easy&&m.caskets.elite,'both casket templates stored');
  resetScreen();cursor={x:290,y:200};place(patch.easyR,276,186);
  await invoke('rewardCalibrate');await tick(3000);
  m=JSON.parse(store.get(storeKey));assert.ok(m.rewards.easy&&m.rewards.elite,'both reward templates stored');
  await invoke('rerollCalibrate');cursor={x:350,y:270};await tick(3000);
  m=JSON.parse(store.get(storeKey));assert.ok(m.rerolls.easy&&m.rerolls.elite,'both reroll positions stored');
  assert.match(elements.get('tierSummary').textContent,/Easy: casket ✓ · reward ✓ · reroll ✓/);
  // Detect Easy icon then Elite icon, regardless of UI tier selector.
  resetScreen();await invoke('watch');
  place(patch.easyC,86,86);cursor={x:100,y:100};context.__test.sampleMatch();
  assert.equal(context.__test.getLastDetected().tier,'easy');
  resetScreen();place(patch.eliteC,86,86);context.__test.sampleMatch();
  assert.equal(context.__test.getLastDetected().tier,'elite');
  // Reward window verified by its tier image without casket icon prerequisite.
  resetScreen();context.__test.sampleRewardWindow();await tick(1000);
  resetScreen();place(patch.easyR,276,186);lastClickAt=t;await tick(780);
  assert.equal(context.__test.getActiveRewardTier(),'easy');
  assert.match(elements.get('log').textContent,/Verified Easy Treasure Trails reward/);
  // Regression: an already-open Easy reward also scores very highly against
  // the Elite template. The higher-scoring tier flips repeatedly while
  // RuneScape is clicked, but MUST NOT create a phantom Elite reward.
  const matcher=context.window.CasketMatcher;
  const originalMatch=matcher.bestMatch;
  let overlapMode='overlap';
  matcher.bestMatch=(template,...args)=>{
    const refs=context.__test.calibrations().rewardTemplates;
    if(template===refs.easy){return overlapMode==='overlap'?0.995:0.20;}
    if(template===refs.elite){return overlapMode==='closed'?0.20:0.997;}
    return originalMatch(template,...args);
  };
  const earlierElite=(elements.get('log').textContent.match(/Verified Elite Treasure Trails reward/g)||[]).length;
  lastClickAt=t;await tick(1550);
  assert.equal(context.__test.getActiveRewardTier(),'easy','tier locked for the existing Easy reward window');
  assert.equal((elements.get('log').textContent.match(/Verified Elite Treasure Trails reward/g)||[]).length,earlierElite,'no phantom Elite event during one Easy panel');
  assert.match(elements.get('log').textContent,/Overlapping reward templates/,'overlap observed without triggering a reward');
  overlapMode='closed';await tick(1450);
  assert.equal(context.__test.getActiveRewardTier(),null,'reward panel rearmed only after closing');
  overlapMode='elite';lastClickAt=t;await tick(900);
  assert.equal(context.__test.getActiveRewardTier(),'elite','new Elite panel can be recognized after close');
  assert.equal((elements.get('log').textContent.match(/Verified Elite Treasure Trails reward/g)||[]).length,earlierElite+1,'real subsequent Elite opening verified once');
  matcher.bestMatch=originalMatch;
  // Do not record merely because the reward panel is already open at startup.
  context.__test.stopWatching();await tick(500);context.__test.startWatching();
  const before=elements.get('log').textContent.match(/Verified Easy Treasure Trails reward/g)?.length||0;
  await tick(500);
  assert.equal(elements.get('log').textContent.match(/Verified Easy Treasure Trails reward/g)?.length||0,before);
  // Clearing Easy does not affect imported Elite. No remigration after clearing Elite.
  context.__test.stopWatching();elements.get('tierSelect').value='easy';await invoke('clear');await invoke('rewardClear');
  m=JSON.parse(store.get(storeKey));assert.ok(!m.caskets.easy&&!m.rewards.easy&&m.caskets.elite&&m.rewards.elite);
  elements.get('tierSelect').value='elite';await invoke('clear');
  m=JSON.parse(store.get(storeKey));assert.ok(!m.caskets.elite,'cleared Elite does not reimport from old keys');
  assert.ok(captures>0);
  console.log('PASS: Legacy Elite migration, Easy casket/reward/reroll calibration, auto multi-tier match, independent reward transition, no duplicate on startup, tier isolation.');
})().catch(e=>{console.error(e);process.exitCode=1});
