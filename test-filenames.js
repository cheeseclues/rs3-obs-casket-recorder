// Deterministic OBS v5 naming and restore tests. No live OBS connection.
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const assert=require('node:assert/strict');
let clock=100000, id=1, nextPath=0, activeBuffer=true;
let outputFmt='Replay %CCYY-%MM-%DD %hh-%mm-%ss';
const originalFmt=outputFmt;
let failSetOnce=false, failSaveOnce=false;
const settingsSeen=[], savedPaths=[],pendingTimers=new Map(),elements=new Map(),handlers=new Map(),storage=new Map();
function setTimer(fn,delay=0,repeat=false){const n=id++;pendingTimers.set(n,{at:clock+Math.max(0,+delay||0),fn,period:repeat?Math.max(1,+delay||1):0});return n;}
function clearTimer(n){pendingTimers.delete(n)}
async function flush(){for(let i=0;i<35;i++)await Promise.resolve();}
async function tick(delta){const end=clock+delta;let guard=0;while(true){let item=null;for(const entry of pendingTimers)if(entry[1].at<=end&&(!item||entry[1].at<item[1].at))item=entry;if(!item)break;if(++guard>50000)throw Error('timer loop');const [n,t]=item;clock=t.at;if(t.period)t.at+=t.period;else pendingTimers.delete(n);t.fn();await flush();}clock=end;await flush();}
const names=['log','altstatus','permissions','status','password','connect','disconnect','test','stop','recordState','calstatus','calibrate','clear','threshold','thresholdNumber','detectStatus','confidence','watch','unwatch','liveRecord','copy','rewardCalibrate','rewardClear','rewardStatus','rewardThreshold','rewardThresholdNumber','rememberPassword','autoConnect','autoWatch','forgetPassword','rewardDetectStatus','rewardConfidence','rerollCalibrate','rerollClear','rerollStatus','bufferStatus','bufferStart','bufferSaveTest','autoBuffer','replaySeconds','tierSelect','tierSummary'];
for(const name of names) elements.set(name,{id:name,textContent:'',value:'',checked:false,disabled:false,scrollTop:0,scrollHeight:0,className:'',addEventListener(t,f){handlers.set(name+':'+t,f)}});
elements.get('tierSelect').value='elite';elements.get('threshold').value='95';elements.get('rewardThreshold').value='96';elements.get('replaySeconds').value='30';
storage.set('rs3obs-settings-v04',JSON.stringify({liveRecord:true,autoBuffer:true,autoWatch:false,replaySeconds:'30'}));
class FakeWebSocket{
 static OPEN=1;
 constructor(){this.readyState=1;Promise.resolve().then(()=>this.onmessage({data:JSON.stringify({op:0,d:{rpcVersion:1}})}));}
 send(payload){const m=JSON.parse(payload);
   if(m.op===1){Promise.resolve().then(()=>this.onmessage({data:JSON.stringify({op:2,d:{negotiatedRpcVersion:1}})}));return;}
   if(m.op!==6)throw Error('unexpected opcode '+m.op);
   const d=m.d;let responseData={},ok=true,comment='failed';
   if(d.requestType==='GetRecordStatus')responseData={outputActive:false};
   else if(d.requestType==='GetReplayBufferStatus')responseData={outputActive:activeBuffer};
   else if(d.requestType==='GetOutputList')responseData={outputs:[{outputName:'adv_file_output'},{outputName:'Replay Buffer'}]};
   else if(d.requestType==='GetOutputSettings'){assert.equal(d.requestData.outputName,'Replay Buffer');responseData={outputSettings:{format:outputFmt}};}
   else if(d.requestType==='SetOutputSettings'){
    assert.equal(d.requestData.outputName,'Replay Buffer');
    if(failSetOnce){failSetOnce=false;ok=false;comment='SetOutputSettings test failure';}
    else {outputFmt=d.requestData.outputSettings.format;settingsSeen.push(outputFmt);}
   } else if(d.requestType==='GetLastReplayBufferReplay')responseData={savedReplayPath:savedPaths.at(-1)||''};
   else if(d.requestType==='SaveReplayBuffer'){
    if(failSaveOnce){failSaveOnce=false;ok=false;comment='SaveReplayBuffer test failure';}
    else {
     // Our verified OBS test confirms these OBS filename-format token semantics.
     const file=outputFmt.replaceAll('%DD','13').replaceAll('%MM','11').replaceAll('%CCYY','2026').replaceAll('%YY','26').replaceAll('%hh','20').replaceAll('%mm','46').replaceAll('%ss',String(++nextPath).padStart(2,'0'))+'.mp4';
     setTimer(()=>{const filename='F:/obs/'+file;savedPaths.push(filename);this.onmessage({data:JSON.stringify({op:5,d:{eventType:'ReplayBufferSaved',eventData:{savedReplayPath:filename}}})});},150);
    }
   }else if(d.requestType==='StartReplayBuffer')activeBuffer=true;
   Promise.resolve().then(()=>this.onmessage({data:JSON.stringify({op:7,d:{requestType:d.requestType,requestId:d.requestId,requestStatus:{result:ok,code:ok?100:501,comment},responseData}})}));
 }
 close(){this.readyState=3;this.onclose?.({code:1000})}
}
const ctx={document:{getElementById:k=>elements.get(k)},window:{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},performance:{now:()=>clock},Date,JSON,Math,Map,Set,Number,String,Error,Promise,Uint8Array,TextEncoder,WebSocket:FakeWebSocket,setTimeout:setTimer,clearTimeout:clearTimer,setInterval:(f,d)=>setTimer(f,d,true),clearInterval:clearTimer,console,navigator:{clipboard:{writeText:async()=>{}}},crypto:{subtle:{digest:async()=>new Uint8Array(32).buffer}},btoa:()=>'',atob:()=>''};
ctx.window=ctx;ctx.window.addEventListener=()=>{};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'detector.js'),'utf8'),ctx);
let code=fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
code=code.replace(/\}\)\(\);\s*$/,`window.__test={handleRewardEvent,saveReplayWithTierName,recoverReplayFormat,queueReplaySave,format:()=>replayFilenamePattern(replayTiers)};\n})();`);
assert.match(code,/window.__test=/);vm.runInContext(code,ctx);
async function invoke(name){handlers.get(name+':click')();await flush()}
async function saveAfter(tiers){for(const t of tiers){ctx.__test.handleRewardEvent('reward',t+' reward',t);await flush();}await tick(5400);await tick(200);}
(async()=>{
 await invoke('connect');await tick(100);assert.match(elements.get('log').textContent,/authenticated successfully/i);
 await saveAfter(['elite']);
 assert.match(savedPaths.at(-1),/Elite - 13\.11\.2026 20-46-\d{2}\.mp4$/);
 assert.equal(outputFmt,originalFmt,'replay output format restored after save');
 assert.equal(storage.has('rs3obs-replay-format-recovery-v063'),false,'backup cleared after verified restore');
 await saveAfter(['elite','master']);
 assert.match(savedPaths.at(-1),/Elite \+ Master - 13\.11\.2026/);
 assert.equal(outputFmt,originalFmt);
 await saveAfter([]); // no queued event, no new save
 const afterNamed=savedPaths.length;
 // When the tier can't be determined, use Unknown, never current tier selector.
 ctx.__test.handleRewardEvent('reward','unclassified reward');await tick(5600);
 assert.match(savedPaths.at(-1),/Unknown - 13\.11\.2026/);
 assert.equal(savedPaths.length,afterNamed+1);
 failSetOnce=true;
 await saveAfter(['hard']);
 assert.match(savedPaths.at(-1),/Replay 2026-11-13 20-46-\d{2}\.mp4$/,'still save with default OBS filename on format change failure');
 assert.equal(outputFmt,originalFmt);
 assert.equal(storage.has('rs3obs-replay-format-recovery-v063'),false);
 failSaveOnce=true;
 ctx.__test.handleRewardEvent('reward','easy reward','easy');await tick(5200);await flush();
 assert.equal(outputFmt,originalFmt,'restore after SaveReplayBuffer request fails');
 assert.equal(storage.has('rs3obs-replay-format-recovery-v063'),false);
 // Simulate a crash after applying temporary formatting; test recovery on reconnect.
 outputFmt='Master - %DD.%MM.%CCYY %hh-%mm-%ss';
 storage.set('rs3obs-replay-format-recovery-v063',JSON.stringify({outputName:'Replay Buffer',original:originalFmt,temporary:outputFmt}));
 assert.equal(await ctx.__test.recoverReplayFormat(),true);
 assert.equal(outputFmt,originalFmt,'restored after interrupted save');
 assert.equal(storage.has('rs3obs-replay-format-recovery-v063'),false);
 assert.ok(settingsSeen.some(x=>x.startsWith('Elite + Master')));
 console.log('PASS: Finnish dates, Elite, mixed Elite + Master, Unknown fallback, restore after success, fallback if SetOutputSettings fails, restore after SaveReplayBuffer failure, reconnect recovery');
})().catch(e=>{console.error(e);process.exitCode=1});
