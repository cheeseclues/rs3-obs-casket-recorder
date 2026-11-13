// Deterministic OBS v5 protocol tests for the v0.6.1 replay-buffer workflow.
// Runs from Node.js without connecting to OBS or RuneScape.
'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

let time = 100000, nextTimer=1;
const scheduled = new Map(), elements=new Map(), handlers=new Map(), store=new Map();
function setT(fn, delay=0, periodic=false){ const id=nextTimer++; scheduled.set(id,{fn,at:time+Math.max(0,Number(delay)||0),period:periodic?Math.max(1,Number(delay)||1):0}); return id; }
function clearT(id){scheduled.delete(id)}
async function flush(){for(let i=0;i<20;i++)await Promise.resolve()}
async function tick(ms){
 const end=time+ms;
 while(true){let found=null;for(const [id,v] of scheduled){if(v.at<=end && (!found||v.at<found[1].at)) found=[id,v];}
   if(!found)break;
   const [id,v]=found;time=v.at;
   if(v.period){v.at+=v.period;scheduled.set(id,v);} else scheduled.delete(id);
   v.fn(); await flush();
 }
 time=end;await flush();
}
for(const id of ['log','altstatus','permissions','status','password','connect','disconnect','test','stop','recordState','calstatus','calibrate','clear','threshold','thresholdNumber','detectStatus','confidence','watch','unwatch','liveRecord','copy','rewardCalibrate','rewardClear','rewardStatus','rewardThreshold','rewardThresholdNumber','rememberPassword','autoConnect','autoWatch','forgetPassword','rewardDetectStatus','rewardConfidence','rerollCalibrate','rerollClear','rerollStatus','bufferStatus','bufferStart','bufferSaveTest','autoBuffer','replaySeconds','tierSelect','tierSummary']) {
  elements.set(id,{id,textContent:'',value:'',checked:false,disabled:false,className:'',scrollTop:0,scrollHeight:2,
    addEventListener(type,fn){handlers.set(id+':'+type,fn);}});
}
elements.get('tierSelect').value='elite';elements.get('threshold').value='95';elements.get('rewardThreshold').value='96';elements.get('replaySeconds').value='60';
store.set('rs3obs-settings-v04',JSON.stringify({liveRecord:true,autoBuffer:true,autoWatch:false,replaySeconds:'60'}));
let activeBuffer=false, saves=0, recordStarts=0, recordedPaths=[];
let socketId=0;
const requests=[];
class WebSocketMock{
  static OPEN=1;
  constructor(url){this.url=url;this.readyState=1;this.id=++socketId;Promise.resolve().then(()=>this.onmessage({data:JSON.stringify({op:0,d:{rpcVersion:1}})}));}
  send(payload){
    const m=JSON.parse(payload);
    if(m.op===1){assert.equal(m.d.eventSubscriptions,64,'Outputs event subscription required');Promise.resolve().then(()=>this.onmessage({data:JSON.stringify({op:2,d:{negotiatedRpcVersion:1}})}));return;}
    assert.equal(m.op,6);const d=m.d, t=d.requestType; requests.push(t);
    let responseData={};
    if(t==='GetRecordStatus')responseData={outputActive:false};
    else if(t==='GetReplayBufferStatus')responseData={outputActive:activeBuffer};
    else if(t==='StartReplayBuffer')activeBuffer=true;
    else if(t==='SaveReplayBuffer'){
      if(!activeBuffer)throw Error('Buffer not running');
      saves++;
      const newPath='F:/obs/replay-'+saves+'.mp4';
      // OBS may return the OLD path until it finishes writing the new replay.
      setT(()=>{
        recordedPaths.push(newPath);
        this.onmessage({data:JSON.stringify({op:5,d:{eventType:'ReplayBufferSaved',eventData:{savedReplayPath:newPath}}})});
      },300);
    }
    else if(t==='GetLastReplayBufferReplay')responseData={savedReplayPath:recordedPaths.at(-1)||''};
    else if(t==='StartRecord')recordStarts++;
    else if(t==='StopRecord'){};
    Promise.resolve().then(()=>this.onmessage({data:JSON.stringify({op:7,d:{requestType:t,requestId:d.requestId,requestStatus:{result:true,code:100},responseData}})}));
  }
  close(){this.readyState=3; if(this.onclose)this.onclose({code:1000})}
}
const context={
  document:{getElementById:id=>elements.get(id)},window:{},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  performance:{now:()=>time}, Date,JSON,Math,Map,Set,Number,String,Error,Promise,Uint8Array,TextEncoder,WebSocket:WebSocketMock,
  setTimeout:(fn,ms)=>setT(fn,ms),clearTimeout:clearT,setInterval:(fn,ms)=>setT(fn,ms,true),clearInterval:clearT,
  console,navigator:{clipboard:{writeText:async()=>{}}},
  crypto:{subtle:{digest:async()=>new Uint8Array(32).buffer}},btoa:()=>'',atob:()=>'',
};
context.window=context;context.window.addEventListener=()=>{};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'detector.js'),'utf8'),context);
let code=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
code=code.replace(/\}\)\(\);\s*$/,`window.__test={handleRewardEvent,checkReplayBuffer,queueReplaySave,configuredReplaySeconds};\n})();`);
assert.match(code,/window.__test=/);
vm.runInContext(code,context);
async function invoke(id,type='click'){const fn=handlers.get(id+':'+type);assert.ok(fn,id);fn();await flush()}
(async()=>{
  await invoke('connect');await tick(100);
  assert.equal(activeBuffer,true,'OBS Replay Buffer should auto-start when authenticated');
  assert.ok(requests.includes('StartReplayBuffer'));
  assert.equal(requests.includes('StartRecord'),false);

  // A puzzle-like icon match never invokes handleRewardEvent and cannot save.
  await tick(9000);assert.equal(saves,0,'No reward = no saved replay');

  // Confirmed reward at t0 and reroll at t+3 => save at t+8 (not t+5).
  context.__test.handleRewardEvent('reward','confirmed reward casket');
  await tick(3000);
  context.__test.handleRewardEvent('reroll','reroll click');
  await tick(2050);assert.equal(saves,0,'Reroll should delay save');
  await tick(3000);assert.equal(saves,1,'One replay requested 5s after reroll'); await tick(350);
  assert.equal(recordStarts,0,'Never start OBS recording for automatic rewards');

  // Second reward while a replay save is pending extends same save deadline.
  context.__test.handleRewardEvent('reward','first reward');
  await tick(2500);context.__test.handleRewardEvent('reward','next reward');
  await tick(2600);assert.equal(saves,1);
  await tick(2500);assert.equal(saves,2); await tick(350);

  // A very long chain of rewards triggers an intermediate save before the
  // configured 60-s buffer could overwrite footage, plus a final save.
  const old=saves;
  context.__test.handleRewardEvent('reward','first in chain');
  for(let i=0;i<11;i++) {await tick(4000);context.__test.handleRewardEvent('reroll','reroll in chain');}
  await tick(5500);
  assert.ok(saves>=old+2,'Long sequence should cause an intermediate and final replay save');
  assert.equal(recordStarts,0);
  assert.match(elements.get('log').textContent,/Intermediate replay file confirmed/);
  assert.match(elements.get('log').textContent,/OBS ReplayBufferSaved confirmed/);
  assert.doesNotMatch(elements.get('log').textContent,/OBS replay saved: F:\/obs\/replay-1\.mp4/);
  console.log('PASS: WebSocket auth, buffer startup, puzzle guard, 5s delay, reroll extension, consecutive rewards, long-chain intermediate saves');
})().catch(e=>{console.error(e);process.exitCode=1;});
