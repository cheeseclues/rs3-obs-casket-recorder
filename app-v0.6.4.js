(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const M = window.CasketMatcher;
  const KEY = 'rs3obs-casket-template-v1';
  const REWARD_KEY = 'rs3obs-reward-template-v1';
  const REROLL_KEY = 'rs3obs-reroll-button-v1';
  const SETTINGS_KEY = 'rs3obs-settings-v04';
  const PASSWORD_KEY = 'rs3obs-obs-password';
  const MULTI_KEY = 'rs3obs-tier-calibrations-v062'; // Keep saved five-tier references intact.
  const FORMAT_RECOVERY_KEY = 'rs3obs-replay-format-recovery-v063';
  const TIERS = ['easy', 'medium', 'hard', 'elite', 'master'];
  const tierName = tier => tier.charAt(0).toUpperCase() + tier.slice(1);
  const hasCaskets = () => TIERS.some(t => !!casketTemplates[t]);
  const hasRewards = () => TIERS.some(t => !!rewardTemplates[t]);
  const logLines = [];
  let socket = null, ready = false, connecting = false, recordingByUs = false, testBusy = false;
  let pending = new Map(), nextId = 0, stopTimer = null;
  let stoppingByUs = false, queuedOpeningAfterStop = false;
  let casketTemplates = {}, rewardTemplates = {}, rerollPositions = {};
  let rerollCalTimer = null, watching = false, captureTimer = null, clickTimer = null;
  let activeRewardTier = null, lastCasketTier = null, pendingCasketCandidateTier = null;
  let rewardCalTimer = null, lastCasketSeen = 0;
  // Reward-interface transition detector. The fixed-position 52x52 pixel sample
  // is independent of casket recognition, so fast clicks cannot bypass it.
  let rewardScanTimer = null, rewardWasVisible = null, rewardMatchingSamples = 0;
  let rewardMissingSamples = 0, lastRewardConfidence = NaN;
  let lastRewardSampleAt = 0, rewardClickBurstUntil = 0;
  let lastRewardIgnoredAt = 0;
  let lastRewardTierConflictAt = 0;
  let savedPasswordForHandshake = '', pendingRemember = ''; 
  let clickRejectCount = 0, lastStatsAt = 0;
  let lastRewardVisibleAt = 0, lastRerollAt = 0, recordingDeadline = 0;
  let rewardCaptureErrorAt = 0;
  // A casket-shaped icon is NOT proof of a reward casket: puzzle caskets may
  // match the same 28x28 template. Queue a candidate; only the reward panel
  // transitioning closed -> open is permitted to trigger recording.
  let pendingCasketCandidateAt = 0;
  let autoRetryBlocked = false, manualDisconnect = false, lastObsRetry = 0, lastObsErrorLog = 0, lastAutoWaitLog = 0;
  let calibratedTimeout = null, lastClickAge = null, lastDetected = null;
  let lastArmed = false, lastUpdateTime = 0, lastClickLogged = 0, lastTriggered = 0;
  let lastConfidence = NaN, activeRun = 0, activeRecordMode = 'manual';
  // OBS Replay Buffer: OBS encodes before the click; the application only
  // saves confirmed rewards. A session's save deadline is 5 s after the last
  // verified reward/reroll, never five seconds after a puzzle-like icon click.
  let replayActive = false, replayStarting = false, replaySaving = false;
  let replayDeadline = 0, replayBatchStart = 0, replayTimer = null;
  let lastReplayCheck = 0, replayWarningAt = 0, lastReplayPath = '';
  let pendingReplay = false;
  let replaySaveWaiter = null;
  // The verified tier set belongs to a pending replay batch, not the calibration dropdown.
  let replayTiers = new Set();
  let replayOutputName = null;
  let filenameRecoveryBusy = false;


  const now = () => performance.now();
  const errText = e => (e && e.message) || String(e);
  function log(message) {
    const stamp = `[${new Date().toLocaleTimeString()}] ${message}`;
    logLines.push(stamp);
    if (logLines.length > 250) logLines.shift();
    $('log').textContent = logLines.join('\n');
    $('log').scrollTop = $('log').scrollHeight;
  }
  function setBadge(id, content, variant) {
    const el = $(id); el.textContent = content; el.className = 'status ' + variant;
  }
  function alt() { return window.alt1 || null; }
  function linked() { return !!alt() && !!alt().rsLinked; }
  function permissionsOK() {
    return !!alt() && !!alt().permissionPixel && !!alt().permissionGameState;
  }
  function mouse() {
    const a = alt();
    if (!a || !linked()) return null;
    const raw = Number(a.mousePosition);
    if (!Number.isFinite(raw)) return null;
    const x = (raw >>> 16) & 0xffff, y = raw & 0xffff;
    if (x === 65535 || y === 65535 || x < 0 || y < 0 ||
        x >= Number(a.rsWidth) || y >= Number(a.rsHeight)) return null;
    return {x, y};
  }
  function refreshPermissions() {
    const a = alt();
    if (!a) {
      setBadge('altstatus', 'Browser test only', 'warn');
      $('permissions').textContent = 'Alt1 not detected. OBS test works, but game detection requires opening this page inside Alt1.';
    } else {
      $('permissions').textContent = `RuneScape linked: ${!!a.rsLinked} · Screen Pixels: ${!!a.permissionPixel} · Game State: ${!!a.permissionGameState} · Installed: ${!!a.permissionInstalled}`;
      setBadge('altstatus', permissionsOK() ? (linked() ? 'Ready' : 'RS not linked') : 'Permissions required',
               permissionsOK() && linked() ? 'connected' : 'warn');
    }
  }
  function updateControls() {
    $('connect').disabled = ready || connecting || recordingByUs;
    $('disconnect').disabled = (!ready && !connecting) || recordingByUs;
    $('test').disabled = !ready || testBusy || recordingByUs;
    $('stop').disabled = !ready || !recordingByUs;
    $('password').disabled = ready || connecting;
    $('watch').disabled = watching || (!hasCaskets() && !hasRewards()) || !permissionsOK() || !linked();
    $('unwatch').disabled = !watching;
    $('calibrate').disabled = !!calibratedTimeout;
    $('rewardCalibrate').disabled = !!rewardCalTimer;
    $('rerollCalibrate').disabled = !!rerollCalTimer;
    $('rerollClear').disabled = !rerollPositions[selectedTier()] || !!rerollCalTimer;
    $('autoWatch').disabled = false;
    $('rewardClear').disabled = !rewardTemplates[selectedTier()] || !!rewardCalTimer;
    $('forgetPassword').disabled = !localStorage.getItem(PASSWORD_KEY);
    $('bufferStart').disabled = !ready || replayStarting || replayActive;
    $('bufferSaveTest').disabled = !ready || !replayActive || replaySaving;
    $('clear').disabled = !casketTemplates[selectedTier()] || !!calibratedTimeout;
  }
  function selectedTier() { return TIERS.includes($('tierSelect').value) ? $('tierSelect').value : 'elite'; }
  function persistCalibrations() {
    const serialized = {version:2, migratedLegacy:true, caskets:{}, rewards:{}, rerolls:{}};
    for (const tier of TIERS) {
      if (casketTemplates[tier]) {
        const {version,size,channels,encoded} = casketTemplates[tier];
        serialized.caskets[tier] = {version,size,channels,encoded};
      }
      if (rewardTemplates[tier]) {
        const {version,size,channels,encoded,pos} = rewardTemplates[tier];
        serialized.rewards[tier] = {position:pos,template:{version,size,channels,encoded}};
      }
      if (rerollPositions[tier]) serialized.rerolls[tier] = rerollPositions[tier];
    }
    try { localStorage.setItem(MULTI_KEY,JSON.stringify(serialized)); }
    catch(e) { log('Calibration storage failed; changes only last until app closes: '+errText(e)); }
  }
  function validPosition(pos) {
    return pos && Number.isInteger(pos.x) && Number.isInteger(pos.y) && pos.x>=0 && pos.y>=0;
  }
  function refreshTierSummary() {
    const tier = selectedTier();
    $('calstatus').textContent = casketTemplates[tier] ? tierName(tier)+' casket calibrated' : tierName(tier)+' casket not calibrated';
    $('rewardStatus').textContent = rewardTemplates[tier] ? tierName(tier)+' reward window calibrated' : tierName(tier)+' reward window not calibrated';
    $('rerollStatus').textContent = rerollPositions[tier] ? tierName(tier)+` reroll at (${rerollPositions[tier].x}, ${rerollPositions[tier].y})` : tierName(tier)+' reroll not calibrated';
    $('tierSummary').textContent = TIERS.map(t => `${tierName(t)}: casket ${casketTemplates[t]?'✓':'—'} · reward ${rewardTemplates[t]?'✓':'—'} · reroll ${rerollPositions[t]?'✓':'—'}`).join('\n');
  }
  function loadTemplate() {
    let migrated = false;
    try {
      const raw=localStorage.getItem(MULTI_KEY);
      if(raw) {
        const obj=JSON.parse(raw);
        if(obj.version !== 2) throw new Error('Unsupported saved multi-tier calibration version');
        for (const tier of TIERS) {
          try { if(obj.caskets?.[tier]) casketTemplates[tier]=M.validatedTemplate(obj.caskets[tier]); }
          catch(e){ log(`${tierName(tier)} casket calibration invalid: `+errText(e)); }
          try {
            if(obj.rewards?.[tier]) {
              const ref=obj.rewards[tier];
              if(!validPosition(ref.position)) throw new Error('Invalid position');
              rewardTemplates[tier]={...M.validatedTemplate(ref.template),pos:ref.position};
            }
          }catch(e){ log(`${tierName(tier)} reward calibration invalid: `+errText(e)); }
          if(validPosition(obj.rerolls?.[tier])) rerollPositions[tier]=obj.rerolls[tier];
        }
      } else {
        // Import the single-tier v0.6.1 settings ONCE as Elite.
        // Keep legacy keys untouched so v0.6.1 is still usable if needed.
        try { const raw=localStorage.getItem(KEY); if(raw) {casketTemplates.elite=M.validatedTemplate(JSON.parse(raw)); migrated=true;} }
        catch(e) {log('Legacy Elite casket could not be imported: '+errText(e));}
        try {
          const raw=localStorage.getItem(REWARD_KEY);
          if(raw) {
            const ref=JSON.parse(raw);
            if(!validPosition(ref.position)) throw new Error('Invalid position');
            rewardTemplates.elite={...M.validatedTemplate(ref.template),pos:ref.position}; migrated=true;
          }
        } catch(e){log('Legacy Elite reward could not be imported: '+errText(e));}
        try {const p=JSON.parse(localStorage.getItem(REROLL_KEY)||'null');if(validPosition(p)){rerollPositions.elite=p;migrated=true;}}
        catch(e){log('Legacy Elite reroll could not be imported: '+errText(e));}
        persistCalibrations();
      }
      if(migrated) log('Existing v0.6.1 calibration imported as Elite; other tiers can be added separately.');
      const count=TIERS.filter(t=>rewardTemplates[t]).length;
      log(`Loaded ${TIERS.filter(t=>casketTemplates[t]).length} casket tier(s), ${count} reward tier(s), ${TIERS.filter(t=>rerollPositions[t]).length} reroll tier(s).`);
    } catch(e) {log('Could not load multi-tier calibrations: '+errText(e));}
    refreshTierSummary();updateControls();
  }
  function capture(x, y, w, h) {
    const a = alt();
    if (!a || !a.permissionPixel) throw new Error('Screen Pixels permission missing.');
    if (!a.rsLinked) throw new Error('Alt1 is not linked to RuneScape.');
    if (x < 0 || y < 0 || x + w > Number(a.rsWidth) || y + h > Number(a.rsHeight))
      throw new Error('Cursor too close to window edge for a full image.');
    return M.fromBase64(a.getRegion(x, y, w, h), w, h);
  }
  function calibrate() {
    if (calibratedTimeout) return;
    if (!permissionsOK() || !linked()) {log('Calibration requires RuneScape plus Alt1 Screen Pixels and Game State permissions.');refreshPermissions();return;}
    if (watching) stopWatching();
    const tier=selectedTier();
    let seconds=3;
    $('calstatus').textContent=`${tierName(tier)}: hover over casket icon (3)…`;
    log(`${tierName(tier)} casket calibration: hover at the CENTER of the icon; do not click.`);
    calibratedTimeout=setInterval(()=>{
      seconds--;
      if(seconds>0){$('calstatus').textContent=`${tierName(tier)}: hover over casket icon (${seconds})…`;return;}
      clearInterval(calibratedTimeout);calibratedTimeout=null;
      try {
        const pos=mouse();if(!pos)throw new Error('Move the mouse over the RuneScape casket.');
        const s=M.SIZE, pixels=capture(pos.x-s/2,pos.y-s/2,s,s);
        casketTemplates[tier]=M.validatedTemplate(M.templateFromCapture(pixels));
        persistCalibrations();log(`${tierName(tier)} casket calibration successful.`);
      }catch(e){log(`${tierName(tier)} casket calibration failed: `+errText(e));}
      finally{refreshTierSummary();updateControls();}
    },1000);updateControls();
  }
  function calibrateReward() {
    if(rewardCalTimer)return;
    if(!permissionsOK()||!linked()){log('Reward calibration requires Alt1 permissions and RuneScape.');return;}
    if(watching)stopWatching();
    const tier=selectedTier();let secs=3;
    $('rewardStatus').textContent=`${tierName(tier)}: point at fixed reward-window decoration (3)…`;
    log(`${tierName(tier)} reward calibration: open its reward interface and hover over a fixed, unique detail.`);
    rewardCalTimer=setInterval(()=>{
      secs--;
      if(secs>0){$('rewardStatus').textContent=`${tierName(tier)}: point at detail (${secs})…`;return;}
      clearInterval(rewardCalTimer);rewardCalTimer=null;
      try {
        const p=mouse();if(!p)throw new Error('Keep mouse within RuneScape.');
        const s=M.SIZE, pixels=capture(p.x-s/2,p.y-s/2,s,s);
        const saved=M.templateFromCapture(pixels);
        rewardTemplates[tier]={...M.validatedTemplate(saved),pos:p};
        persistCalibrations();log(`${tierName(tier)} reward-window calibration successful.`);
      }catch(e){log(`${tierName(tier)} reward calibration failed: `+errText(e).replace('Hover over the CASKET ICON, not an empty slot.','Point at a distinctive reward-window detail.'));}
      finally{refreshTierSummary();updateControls();}
    },1000);updateControls();
  }
  function calibrateReroll() {
    if(rerollCalTimer)return;
    if(!permissionsOK()||!linked()){log('Reroll calibration requires Alt1 permissions and RuneScape.');return;}
    if(watching)stopWatching();
    const tier=selectedTier();let secs=3;
    log(`${tierName(tier)} reroll calibration: open that tier's reward window and hover the CENTER of Reroll.`);
    rerollCalTimer=setInterval(()=>{
      secs--;
      if(secs>0){$('rerollStatus').textContent=`${tierName(tier)} reroll: ${secs}…`;return;}
      clearInterval(rerollCalTimer);rerollCalTimer=null;
      const p=mouse();
      if(!p){log(`${tierName(tier)} reroll calibration failed: mouse outside RuneScape.`);}
      else {rerollPositions[tier]=p;persistCalibrations();log(`${tierName(tier)} reroll calibrated at (${p.x}, ${p.y}).`);}
      refreshTierSummary();updateControls();
    },1000);updateControls();
  }
  function clearReroll() {
    const tier=selectedTier();delete rerollPositions[tier];persistCalibrations();refreshTierSummary();
    log(`${tierName(tier)} reroll position cleared.`);updateControls();
  }
  function clearRewardTemplate() {
    if(watching)stopWatching();const tier=selectedTier();delete rewardTemplates[tier];persistCalibrations();
    $('rewardDetectStatus').textContent='Not running';$('rewardConfidence').textContent='—';refreshTierSummary();
    log(`${tierName(tier)} reward-window calibration cleared.`);updateControls();
  }
  function sampleRewardWindow() {
    if(!watching||!hasRewards()||!permissionsOK()||!linked())return;
    const t=now(), interval=t<rewardClickBurstUntil?130:400;
    if(t-lastRewardSampleAt<interval)return;
    lastRewardSampleAt=t;
    const size=M.SIZE+M.MARGIN*2, results=[];
    const captureCache=new Map();
    for(const tier of TIERS){
      const tmpl=rewardTemplates[tier];if(!tmpl)continue;
      const left=tmpl.pos.x-M.SIZE/2-M.MARGIN, top=tmpl.pos.y-M.SIZE/2-M.MARGIN;
      const rw=Number(alt().rsWidth), rh=Number(alt().rsHeight);
      // Bad/out-of-bounds captures are temporary, not fatal. Keep watching.
      if(left<0||top<0||left+size>rw||top+size>rh)continue;
      try {
        const key=`${left}:${top}`;
        let bytes=captureCache.get(key);
        if(!bytes){bytes=capture(left,top,size,size);captureCache.set(key,bytes);}
        results.push({tier,score:M.bestMatch(tmpl,bytes,size,size)});
      }catch(e){
        if(t-rewardCaptureErrorAt>30000){log('Reward image sample skipped: '+errText(e));rewardCaptureErrorAt=t;}
      }
    }
    if(!results.length){$('rewardConfidence').textContent='No reward template in visible area';return;}
    results.sort((a,b)=>b.score-a.score);
    const threshold=Number($('rewardThreshold').value)/100;
    // Presence is the UNION of calibrated reward templates. A reward window
    // can look almost identical at different tiers (e.g. Elite 99.6%, Easy
    // 99.5%). Never treat a change in the highest-scoring template alone as a
    // new opening or a second tier; keep the first confirmed tier locked until
    // the reward panel has actually disappeared for two samples.
    const best=results[0],visible=best.score>=threshold;
    let result=best;
    if(rewardWasVisible && activeRewardTier && visible){
      const locked=results.find(x=>x.tier===activeRewardTier);
      if(locked && locked.score>=threshold) result=locked;
      if(best.tier!==activeRewardTier && t-lastRewardTierConflictAt>10000){
        log(`Overlapping reward templates (${tierName(activeRewardTier)} and ${tierName(best.tier)}); retaining ${tierName(activeRewardTier)} for this open reward. Calibrate distinctive tier details if this repeats.`);
        lastRewardTierConflictAt=t;
      }
    }else if(!rewardWasVisible && pendingCasketCandidateTier){
      // When a NEW reward window opens, the recently clicked casket is useful
      // disambiguation if several reward templates match nearly as well.
      const freshCandidate=pendingCasketCandidateAt>0 && t-pendingCasketCandidateAt<2700;
      const preferred=freshCandidate && results.find(x=>x.tier===pendingCasketCandidateTier && x.score>=threshold && x.score>=best.score-0.01);
      if(preferred)result=preferred;
    }
    const {tier,score}=result;
    lastRewardConfidence=score;
    const shownTier=(rewardWasVisible&&activeRewardTier&&visible)?activeRewardTier:tier;
    $('rewardConfidence').textContent=`${tierName(shownTier)} ${(score*100).toFixed(1)}% ${visible?'· MATCH':''}`;
    if(rewardWasVisible===null){
      rewardWasVisible=visible;activeRewardTier=visible?tier:null;
      if(visible)lastRewardVisibleAt=t;
      rewardMatchingSamples=visible?1:0;rewardMissingSamples=visible?0:1;
      $('rewardDetectStatus').textContent=visible?`${tierName(tier)} already open (awaiting close)`:'Ready (reward closed)';
      return;
    }
    if(visible){
      lastRewardVisibleAt=t;rewardMatchingSamples++;rewardMissingSamples=0;
      // A still-open reward interface is ONE event, irrespective of how
      // similarity scores fluctuate between Easy/Medium/Hard/Elite/Master.
      // A new casket can produce another event after the panel closes and
      // reappears, or through the separately calibrated reroll-button click.
      if(rewardWasVisible)return;
      if(rewardMatchingSamples<2)return;
      rewardWasVisible=true;activeRewardTier=tier;
      $('rewardDetectStatus').textContent=`${tierName(tier)} reward open`;
      const clickAge=Number(alt().rsLastActive);
      if(!Number.isFinite(clickAge)||clickAge<0||clickAge>2500){
        if(t-lastRewardIgnoredAt>5000){log(`${tierName(tier)} reward appeared without a recent RuneScape click; ignored.`);lastRewardIgnoredAt=t;}
        return;
      }
      if(t-lastTriggered<700)return;
      lastTriggered=t;
      const candidateConfirmed=pendingCasketCandidateAt>0&&t-pendingCasketCandidateAt<2700;
      pendingCasketCandidateAt=0;pendingCasketCandidateTier=null;lastDetected=null;
      log(`Verified ${tierName(tier)} Treasure Trails reward (${(score*100).toFixed(1)}%); ${candidateConfirmed?'casket candidate confirmed':'reward-window fallback'}.`);
      setBadge('detectStatus',`${tierName(tier)} reward confirmed`,'armed');
      handleRewardEvent('reward',`${tierName(tier)} reward-window detection`, tier);
    }else{
      rewardMissingSamples++;rewardMatchingSamples=0;
      if(rewardWasVisible&&rewardMissingSamples>=2){
        rewardWasVisible=false;activeRewardTier=null;
        $('rewardDetectStatus').textContent='Ready (reward closed)';
        if(!lastArmed)setBadge('detectStatus','Watching','connecting');
      }
    }
  }
  function clearTemplate() {
    if(watching)stopWatching();const tier=selectedTier();delete casketTemplates[tier];persistCalibrations();
    lastDetected=null;$('confidence').textContent='—';refreshTierSummary();
    setBadge('detectStatus','Stopped','disconnected');
    log(`${tierName(tier)} casket calibration cleared.`);updateControls();
  }
  function sampleMatch() {
    if (!watching || !hasCaskets() || !permissionsOK() || !linked()) return;
    const pos = mouse();
    const time = now();
    if (!pos) {
      if (lastArmed && time - lastUpdateTime > 400) lastArmed = false;
      $('confidence').textContent = 'Mouse outside RuneScape';
      return;
    }
    try {
      const size = M.SIZE + M.MARGIN * 2;
      const width = Number(alt().rsWidth);
      const height = Number(alt().rsHeight);
      // At the game-window edge the cursor-centered 52x52 region used to
      // extend outside the client, which threw and STOPPED all detection.
      // Clamp the small region inside RuneScape instead; no failed read,
      // watcher reset, or needless OBS interference. The template matcher
      // still searches for the casket within the captured area.
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < size || height < size) {
        $('confidence').textContent = 'RuneScape window too small for casket scan';
        lastDetected = null; lastArmed = false;
        return;
      }
      const left = Math.max(0, Math.min(width - size, pos.x - M.SIZE / 2 - M.MARGIN));
      const top = Math.max(0, Math.min(height - size, pos.y - M.SIZE / 2 - M.MARGIN));
      const raw = capture(left, top, size, size);
      const matches=TIERS.filter(t=>casketTemplates[t]).map(t=>({tier:t,confidence:M.bestMatch(casketTemplates[t],raw,size,size)}));
      matches.sort((a,b)=>b.confidence-a.confidence);
      const {tier,confidence}=matches[0];
      lastConfidence=confidence;lastCasketTier=tier;
      const matched = confidence >= Number($('threshold').value) / 100;
      $('confidence').textContent = `${tierName(tier)} ${(confidence * 100).toFixed(1)}% ${matched ? '· MATCH' : ''}`;
      if (matched) { lastDetected = { time, pos, confidence, tier }; lastCasketSeen = time; }
      if (matched !== lastArmed && time - lastUpdateTime > 200) {
        lastArmed = matched;
        lastUpdateTime = time;
        setBadge('detectStatus', matched ? 'Casket detected · armed' : 'Watching', matched ? 'armed' : 'connecting');
        if (matched) log(`${tierName(tier)} casket recognized: ${(confidence * 100).toFixed(1)}% similarity.`);
      }
    } catch (e) {
      // Errors are isolated: don't keep hammering an invalid Alt1 capture loop.
      log('Screen capture error; detection stopped: ' + errText(e));
      stopWatching();
    }
  }
  function pollClicks() {
    if (!watching || !permissionsOK() || !linked()) { lastClickAge = null; return; }
    const age = Number(alt().rsLastActive);
    const isNew = M.newClick(lastClickAge, age);
    lastClickAge = age;
    if (!isNew) return;
    const pos = mouse();
    const time = now();
    // Burst-sample the small reward reference after any observed real click,
    // even when no casket was seen. This is the v0.4 missing-casket fix.
    if (hasRewards()) rewardClickBurstUntil = time + 1400;
    // Reroll clicks are independent of casket detection and do not get blocked
    // by the initial opening's 2-second duplicate guard.
    const rerollTier=TIERS.find(t=>rerollPositions[t] && (!activeRewardTier||t===activeRewardTier) && M.near(pos,rerollPositions[t],34));
    if (rerollTier && hasRewards() && rewardWasVisible &&
        time - lastRewardVisibleAt < 1100) {
      if (time - lastRerollAt < 220) return; // One event per physical click.
      lastRerollAt = time;
      log(`${tierName(rerollTier)} reroll-button click detected while reward window is visible.`);
      handleRewardEvent('reroll', 'reroll click', rerollTier);
      return;
    }
    if (time - lastTriggered < 700) return; // Ignore repeat detection of same opening.

    // The icon can disappear in the frame after opening: accept a recent match
    // while requiring the click to be close to that matched cursor position.
    const fresh = lastDetected && time - lastDetected.time < 800;
    const sameSpot = M.near(pos, lastDetected?.pos, 30);
    if (!fresh || !sameSpot) {
      // The independent reward watcher checks for closed -> open, even if
      // this click did not have a fresh casket image match.
      clickRejectCount++;
      if(time-lastStatsAt > 60000) {
        if(clickRejectCount>0) log(`Non-casket clicks ignored: ${clickRejectCount} (last minute/interval).`);
        clickRejectCount=0; lastStatsAt=time;
      }
      return;
    }
    // Do NOT call OBS here. Puzzle and reward caskets can have very similar
    // inventory icons; the icon matcher does not read the item's name.
    // Wait for the independent, specifically calibrated *reward interface*.
    pendingCasketCandidateAt = time;
    pendingCasketCandidateTier = lastDetected.tier;
    lastDetected = null; lastCasketSeen = 0;
    setBadge('detectStatus', 'Awaiting reward confirmation', 'armed');
    if (hasRewards()) {
      log(`${tierName(pendingCasketCandidateTier)} casket-shaped item clicked (${(lastConfidence * 100).toFixed(1)}% icon match); awaiting reward interface. Puzzle caskets will be ignored.`);
      // Ensure multiple samples arrive quickly even if the click is noticed
      // after the screen watcher has already run for this frame.
      rewardClickBurstUntil = time + 1800;
    } else {
      log('Casket-shaped item clicked, but no reward-window calibration exists. Recording suppressed to avoid Puzzle casket false positives.');
    }
  }
  function startWatching() {
    if (watching) return;
    refreshPermissions();
    if ((!hasCaskets() && !hasRewards()) || !permissionsOK() || !linked()) {
      log('Cannot start: calibrate a casket or reward window and grant Alt1 Screen Pixels + Game State permissions first.');
      updateControls(); return;
    }
    watching = true;
    lastDetected = null; lastCasketSeen=0; pendingCasketCandidateAt=0;pendingCasketCandidateTier=null; lastClickAge = Number(alt().rsLastActive);
    rewardWasVisible=null; rewardMatchingSamples=0; rewardMissingSamples=0;
    rewardClickBurstUntil=0; lastRewardSampleAt=now()-1000;
    lastArmed = false; lastTriggered = now() - 2000; // Ready immediately; click-age baseline prevents stale triggers.
    setBadge('detectStatus', 'Watching', 'connecting');
    const recommended = Number(alt().captureInterval);
    // Less continuous screen scanning while diagnosing movement/lobby lag; reward fallback is conditional.
    const imagePeriod = Number.isFinite(recommended) ? Math.max(240, Math.min(600, recommended + 110)) : 260;
    if(hasCaskets()) captureTimer = setInterval(sampleMatch, imagePeriod);
    clickTimer = setInterval(pollClicks, 65);
    if (hasRewards()) {
      sampleRewardWindow(); // Establish baseline immediately: pre-open versus already open.
      rewardScanTimer = setInterval(sampleRewardWindow, 80);
      log(`Multi-tier reward-window detection enabled (${TIERS.filter(t=>rewardTemplates[t]).length} tier(s); 52×52 pixel samples; baseline established).`);
    } else {
      $('rewardDetectStatus').textContent = 'Not calibrated';
      $('rewardConfidence').textContent = '—';
    }
    log(`Detection started. Casket image sampling every ${imagePeriod} ms. Reward-confirmation-only replay saving ${$('liveRecord').checked ? 'ENABLED' : 'DISABLED (safe test)'}.`);
    if (!hasRewards()) log('SAFEGUARD: Calibrate at least one reward window before automatic recording. Icon-only events cannot start OBS.');
    updateControls();
  }
  function stopWatching() {
    watching = false;
    clearInterval(captureTimer); clearInterval(clickTimer); clearInterval(rewardScanTimer);
    captureTimer = null; clickTimer = null; rewardScanTimer = null;
    lastDetected = null; lastArmed = false; pendingCasketCandidateAt=0; pendingCasketCandidateTier=null; lastClickAge = null; lastRewardVisibleAt = 0;
    rewardWasVisible = null; activeRewardTier=null; rewardClickBurstUntil = 0;
    setBadge('detectStatus', 'Stopped', 'disconnected');
    log('Detection stopped.');
    updateControls();
  }

  // OBS WebSocket v5 protocol: recording tests plus replay-buffer status/start/save requests.
  async function sha256Base64(str) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    let binary = '';
    for (const val of new Uint8Array(hash)) binary += String.fromCharCode(val);
    return btoa(binary);
  }
  async function authFor(password, salt, challenge) {
    return sha256Base64((await sha256Base64(password + salt)) + challenge);
  }
  function failPending(reason) {
    for (const [, entry] of pending) {
      clearTimeout(entry.timeout); entry.reject(new Error(reason));
    }
    pending.clear();
  }
  function request(requestType, requestData = {}) {
    if (!ready || !socket || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('OBS not authenticated'));
    const requestId = 'rs3obs-' + (++nextId) + '-' + Date.now();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(requestType + ' timed out'));
      }, 12000);
      pending.set(requestId, {resolve, reject, timeout});
      try { socket.send(JSON.stringify({op: 6, d: {requestType, requestId, requestData}})); }
      catch (e) { clearTimeout(timeout); pending.delete(requestId); reject(e); }
    });
  }
  async function incoming(event, ws) {
    if (ws !== socket) return;
    let message;
    try { message = JSON.parse(event.data); } catch(_) { return; }
    if (message.op === 0) {
      try {
        const d = { rpcVersion: 1, eventSubscriptions: (1 << 6) }; // Outputs: ReplayBufferSaved
        if (message.d?.authentication) {
          const password = $('password').value || savedPasswordForHandshake;
          if (!password) throw new Error('Enter OBS WebSocket password before connecting.');
          d.authentication = await authFor(password,
            message.d.authentication.salt, message.d.authentication.challenge);
        }
        if($('rememberPassword').checked && savedPasswordForHandshake) pendingRemember = savedPasswordForHandshake;
        $('password').value = ''; savedPasswordForHandshake='';
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({op: 1, d}));
        log('OBS authentication handshake sent…');
      } catch(e) {
        $('password').value = ''; savedPasswordForHandshake='';
        log('OBS auth failed: ' + errText(e));
        ws.close();
      }
    } else if (message.op === 2) {
      ready = true; connecting = false;
      setBadge('status', 'Authenticated', 'connected');
      if(pendingRemember){localStorage.setItem(PASSWORD_KEY,pendingRemember);pendingRemember='';}
      log('OBS authenticated successfully.');
      updateControls();
      updateControls();
      request('GetRecordStatus').then(s => {
        $('recordState').textContent = s.outputActive ? 'OBS is already recording' : 'OBS idle';
      }).catch(e => log('GetRecordStatus: ' + errText(e)));
      // A previous window/connection might have closed during a temporary
      // filename change. Restore it before any subsequent automatic save.
      recoverReplayFormat().finally(() => checkReplayBuffer(true));
    } else if (message.op === 5) {
      if (message.d?.eventType === 'ReplayBufferSaved') {
        const path = message.d?.eventData?.savedReplayPath;
        if (typeof path === 'string' && path) {
          if (path !== lastReplayPath) {
            lastReplayPath = path;
            log('OBS ReplayBufferSaved confirmed: ' + path);
          }
          if (replaySaveWaiter && path !== replaySaveWaiter.before) replaySaveWaiter.finish(path);
        }
      }
    } else if (message.op === 7) {
      const d = message.d || {}, item = pending.get(d.requestId);
      if (!item) return;
      clearTimeout(item.timeout); pending.delete(d.requestId);
      if (d.requestStatus?.result) item.resolve(d.responseData || {});
      else item.reject(new Error(`${d.requestType || 'OBS request'}: ${d.requestStatus?.comment || 'failed'} (code ${d.requestStatus?.code ?? '?'})`));
    }
  }
  function connect() {
    if (ready || connecting) return;
    if (!crypto?.subtle) { log('Secure Web Crypto unavailable in this browser.'); return; }
    savedPasswordForHandshake = $('password').value || (($('rememberPassword').checked && localStorage.getItem(PASSWORD_KEY)) || '');
    connecting = true; setBadge('status', 'Connecting', 'connecting'); updateControls();
    lastObsRetry=now();
    const ws = new WebSocket('ws://127.0.0.1:4455'); socket = ws;
    ws.onmessage = e => incoming(e, ws).catch(err => log('OBS protocol error: ' + errText(err)));
    ws.onerror = () => {
      if(now()-lastObsErrorLog>60000) {log('OBS not reachable yet; will retry while auto-connect is enabled.');lastObsErrorLog=now();}
    };
    ws.onclose = e => {
      if (socket !== ws) return;
      ready = false; connecting = false; socket = null; savedPasswordForHandshake=''; pendingRemember='';
      replayActive = false; replayStarting = false; replaySaving = false;
      if (replaySaveWaiter) replaySaveWaiter.finish(null);
      $('bufferStatus').textContent = 'OBS disconnected';
      failPending('OBS disconnected');
      if (pendingReplay) log('Replay save pending, but OBS disconnected. Check OBS and reconnect before buffered footage expires.');
      setBadge('status', 'Disconnected', 'disconnected');
      if (e.code===4009) {
        autoRetryBlocked=true;
        log('OBS authentication rejected (4009). Auto retries paused; check the saved password and reconnect manually.');
      } else if (now()-lastObsErrorLog>60000 || e.code===1000) {
        log(`OBS disconnected (code ${e.code}).`);
        lastObsErrorLog=now();
      }
      if (recordingByUs) log('WARNING: OBS connection lost during a recording. Stop recording manually in OBS if necessary.');
      updateControls();
    };
  }
  function scheduleAutoStop() {
    clearTimeout(stopTimer);
    if (!recordingByUs) return;
    const remaining=Math.max(0,recordingDeadline-now());
    $('recordState').textContent = 'Recording · stop in ' + Math.ceil(remaining/1000) + ' sec';
    stopTimer=setTimeout(() => {
      // Check deadline again because a reroll may have arrived just as the
      // timer callback was queued.
      if (recordingByUs && now()+10 < recordingDeadline) scheduleAutoStop();
      else stopRecording();
    }, Math.max(10,remaining));
  }
  function extendAutoRecording(reason) {
    if (!recordingByUs || activeRecordMode === 'manual' || stoppingByUs) return;
    recordingDeadline=Math.max(recordingDeadline,now()+5000);
    scheduleAutoStop();
    log(`OBS recording extended: 5 seconds after ${reason}.`);
  }
  // Automatic replay saves never call StartRecord or StopRecord; these methods
  // remain available only for a deliberate manual five-second OBS test.
  function configuredReplaySeconds() {
    const n = Number($('replaySeconds').value);
    return Number.isFinite(n) ? Math.max(20, Math.min(180, Math.floor(n))) : 60;
  }
  function replaySaveSpan() {
    // Force an intermediate save before oldest reward footage is overwritten.
    // e.g. 60-second OBS buffer -> save at least every 39 s while busy.
    return Math.floor(configuredReplaySeconds() * 650);
  }
  function replayStatus(message) { $('bufferStatus').textContent = message; }
  async function checkReplayBuffer(mayStart = false) {
    if (!ready || replayStarting || replaySaving) return;
    lastReplayCheck = now();
    try {
      const s = await request('GetReplayBufferStatus');
      const wasActive = replayActive;
      replayActive = !!s.outputActive;
      replayStatus(replayActive ? 'Buffer running' : 'Buffer stopped');
      if (replayActive && !wasActive) log('OBS Replay Buffer is running. Pre-opening footage can now be saved.');
      if (!replayActive && mayStart && $('autoBuffer').checked && $('liveRecord').checked) {
        await startReplayBuffer();
      }
    } catch (e) {
      replayActive = false;
      replayStatus('Unavailable — enable Replay Buffer in OBS Output settings');
      if (now() - replayWarningAt > 25000) {
        log('Replay Buffer status failed: ' + errText(e));
        replayWarningAt=now();
      }
    }
    updateControls();
  }
  async function startReplayBuffer() {
    if (!ready || replayActive || replayStarting) return;
    replayStarting = true; updateControls();
    replayStatus('Starting Replay Buffer…');
    try {
      const s = await request('GetReplayBufferStatus');
      if (!s.outputActive) await request('StartReplayBuffer');
      replayActive = true;
      replayStatus('Buffer running');
      log('OBS Replay Buffer started. It keeps the last ' + configuredReplaySeconds() + ' s IF OBS Maximum Replay Time matches this setting.');
    } catch (e) {
      replayActive = false;
      replayStatus('Could not start — check OBS Output → Replay Buffer');
      log('OBS Replay Buffer could not start: ' + errText(e) + '. Enable Replay Buffer in OBS Settings → Output.');
    } finally {
      replayStarting=false;updateControls();
    }
  }
  function scheduleReplaySave() {
    clearTimeout(replayTimer); replayTimer=null;
    if (!pendingReplay) return;
    // Save after five seconds of inactivity, OR before any initial footage
    // is at risk of rolling out of the configured replay buffer.
    const deadline = Math.min(replayDeadline, replayBatchStart + replaySaveSpan());
    const wait = Math.max(20,deadline-now());
    replayStatus(`Reward detected · saving in ${Math.ceil(wait/1000)} s`);
    replayTimer = setTimeout(savePendingReplay,wait);
  }
  function queueReplaySave(reason, tier) {
    if (!pendingReplay) { replayBatchStart=now(); replayTiers.clear(); }
    if (TIERS.includes(tier)) replayTiers.add(tier);
    replayDeadline=now()+5000;
    const wasPending=pendingReplay;
    pendingReplay=true;
    if (!replayActive) {
      log('WARNING: Reward detected but Replay Buffer is not running. Pre-opening footage may be unavailable.');
      // Try to capture at least the post-opening segment if OBS can start it.
      if (ready) startReplayBuffer();
    }
    log((wasPending ? 'Replay save extended' : 'Reward verified; replay save scheduled') + ': 5 seconds after ' + reason + '.');
    scheduleReplaySave();
  }
  // OBS 33.0.1 + obs-websocket 5.7.6: a verified format change on the
  // "Replay Buffer" output takes effect immediately, without stopping it.
  // This was first tested separately against the user's OBS installation.
  function replayFilenameBase(tiers) {
    const labels = TIERS.filter(t => tiers.has(t)).map(tierName);
    return labels.length ? labels.join(' + ') : 'Unknown';
  }
  function replayFilenamePattern(tiers) {
    return replayFilenameBase(tiers) + ' - %DD.%MM.%CCYY %hh-%mm-%ss';
  }
  function savedFormatBackup() {
    try {
      const v = JSON.parse(localStorage.getItem(FORMAT_RECOVERY_KEY) || 'null');
      if (v && typeof v.outputName === 'string' &&
          typeof v.original === 'string' && typeof v.temporary === 'string') return v;
    } catch (e) { log('Invalid OBS filename recovery record: ' + errText(e)); }
    return null;
  }
  function forgetFormatBackup() {
    try { localStorage.removeItem(FORMAT_RECOVERY_KEY); }
    catch (e) {log('Could not clear OBS format recovery record: ' + errText(e));}
  }
  async function locateReplayOutput() {
    if (replayOutputName) return replayOutputName;
    const data = await request('GetOutputList');
    const names = (data.outputs || []).map(o => o.outputName).filter(n => typeof n === 'string');
    replayOutputName = names.find(n => /^Replay Buffer$/i.test(n)) ||
                       names.find(n => /replay buffer/i.test(n)) ||
                       names.find(n => /replay/i.test(n));
    if (!replayOutputName) throw new Error('OBS Replay Buffer output not found; filename unchanged');
    return replayOutputName;
  }
  async function outputFormat(outputName) {
    const r = await request('GetOutputSettings', {outputName});
    const fmt = r.outputSettings?.format;
    if (typeof fmt !== 'string') throw new Error('OBS did not return outputSettings.format');
    return fmt;
  }
  async function setOutputFormat(outputName, fmt) {
    await request('SetOutputSettings', {outputName, outputSettings: {format:fmt}});
    if (await outputFormat(outputName) !== fmt) throw new Error('OBS filename format readback mismatch');
  }
  // Leave other apps'/users' settings alone if they've changed the format
  // since we temporarily set it. A failed restore remains in localStorage.
  async function recoverReplayFormat() {
    if (filenameRecoveryBusy || !ready) return false;
    const backup = savedFormatBackup();
    if (!backup) return true;
    filenameRecoveryBusy=true;
    try {
      const current = await outputFormat(backup.outputName);
      if (current === backup.temporary) {
        await setOutputFormat(backup.outputName, backup.original);
        log('Recovered original OBS replay filename format from an interrupted save.');
      } else if (current !== backup.original) {
        log('OBS filename format was changed externally; leaving the new value untouched.');
      }
      forgetFormatBackup();
      return true;
    } catch(e) {
      log('WARNING: Could not restore original OBS filename format: ' + errText(e));
      return false;
    } finally { filenameRecoveryBusy=false; }
  }
  async function restoreReplayFormatIfUnchanged(outputName, original, temporary) {
    const current = await outputFormat(outputName);
    if (current === temporary) {
      await setOutputFormat(outputName, original);
      log('Original OBS replay filename format restored.');
    } else if (current !== original) {
      // Another OBS client or the user changed it while the save was pending.
      log('OBS replay filename format changed externally; not overriding it.');
    }
    forgetFormatBackup();
  }
  // A naming failure MUST NEVER prevent the actual replay from being saved.
  // Temporarily change the OBS output format, save/confirm the file, and
  // restore the exact previous format even if the save itself fails.
  async function saveReplayWithTierName(tiers) {
    let name=null, original=null, changed=false;
    const base=replayFilenameBase(tiers), target=replayFilenamePattern(tiers);
    const recoveryOk=await recoverReplayFormat();
    try {
      if (!recoveryOk) throw new Error('Unresolved earlier filename restore error');
      name=await locateReplayOutput();
      original=await outputFormat(name);
      if (original !== target) {
        // Persistence happens before the OBS change. It is intentionally kept
        // until restoration is verified, including across application restarts.
        localStorage.setItem(FORMAT_RECOVERY_KEY, JSON.stringify({outputName:name, original, temporary:target}));
        // If OBS changed but the request/readback times out, the finally block
        // still attempts the original format restore.
        changed=true;
        await setOutputFormat(name,target);
      }
      log('Replay filename temporarily set to: ' + target);
    } catch (e) {
      log('WARNING: Tier filename unavailable; saving replay with OBS default naming: ' + errText(e));
      // If the change was partially applied, we must restore it before saving
      // with the normal filename to avoid an unanticipated naming side effect.
      if (changed) {
        try { await restoreReplayFormatIfUnchanged(name,original,target); changed=false; }
        catch (restoreError) {
          log('WARNING: OBS filename restore pending: ' + errText(restoreError));
          // The backup stays available for reconnect/retry.
        }
      }
    }
    let path;
    try {
      path=await saveReplayAndConfirm();
      if (path && changed) {
        const filename=path.split(/[\\/]/).pop();
        if (filename.startsWith(base+' - ') && /\d{2}\.\d{2}\.\d{4}/.test(filename)) {
          log('Finnish-date tier filename confirmed: ' + filename);
        } else {
          log('CHECK: OBS saved replay, but filename did not match tier/date pattern: ' + filename);
        }
      }
      return path;
    } finally {
      if (changed) {
        try {
          await restoreReplayFormatIfUnchanged(name,original,target);
        } catch(e) {
          log('WARNING: OBS filename restore FAILED; automatic recovery will retry: ' + errText(e));
        }
      }
    }
  }

  // OBS accepts SaveReplayBuffer before the file is necessarily finished.
  // GetLastReplayBufferReplay may therefore still report a PREVIOUS replay.
  // Wait for the Outputs.ReplayBufferSaved event (or a changed path on fallback).
  async function saveReplayAndConfirm() {
    let before = lastReplayPath;
    try {
      const r = await request('GetLastReplayBufferReplay');
      if (typeof r.savedReplayPath === 'string') before = r.savedReplayPath;
    } catch (_) { /* No prior replay; event confirmation still works. */ }
    if (replaySaveWaiter) throw new Error('Replay save is already pending confirmation');
    let finish;
    const confirmed = new Promise(resolve => {
      const waiter = {
        before,
        timer: null,
        finish(path) {
          if (replaySaveWaiter !== waiter) return;
          clearTimeout(waiter.timer);
          replaySaveWaiter = null;
          resolve(path);
        }
      };
      finish = waiter.finish;
      replaySaveWaiter = waiter;
      waiter.timer = setTimeout(() => waiter.finish(null), 10000);
    });
    try {
      await request('SaveReplayBuffer');
      log('OBS accepted replay save request; awaiting saved-file confirmation.');
    } catch (e) {
      finish(null);
      throw e;
    }
    let path = await confirmed;
    if (!path) {
      // Safety net if an OBS installation does not emit the event. Critically,
      // never label an unchanged previous path as the newly saved file.
      try {
        const r = await request('GetLastReplayBufferReplay');
        if (r.savedReplayPath && r.savedReplayPath !== before) path = r.savedReplayPath;
      } catch (_) {}
      if (path) {
        if (path !== lastReplayPath) log('OBS replay file confirmed by path change: ' + path);
        lastReplayPath = path;
      } else {
        log('WARNING: OBS accepted the save request, but no NEW replay file was confirmed. Check OBS recordings.');
      }
    }
    return path;
  }
  async function savePendingReplay() {
    if (!pendingReplay || replaySaving) return;
    if (now()+15 < Math.min(replayDeadline,replayBatchStart+replaySaveSpan())) {scheduleReplaySave();return;}
    if (!ready || !replayActive) {
      replayStatus('Cannot save — OBS Replay Buffer offline');
      log('REPLAY SAVE ERROR: OBS buffer not running; cannot save this reward.');
      pendingReplay=false;replayDeadline=0;replayBatchStart=0;replayTiers.clear();
      return;
    }
    replaySaving=true;updateControls();
    const latestDeadline=replayDeadline;
    const wasIntermediate=now()+50 < latestDeadline;
    try {
      const tiersForThisReplay = new Set(replayTiers);
      const confirmedPath = await saveReplayWithTierName(tiersForThisReplay);
      if (confirmedPath) {
        log(wasIntermediate ? 'Intermediate replay file confirmed; further rewards may be in overlapping files.' : 'Reward replay file confirmed after final 5-second wait.');
      }
      // If additional rewards were detected during the request, continue the
      // pending session. Otherwise finish after a successful save.
      if (replayDeadline > latestDeadline + 20 || wasIntermediate) {
        replayBatchStart=now();
        pendingReplay=true;
        scheduleReplaySave();
      } else {
        pendingReplay=false;replayDeadline=0;replayBatchStart=0;replayTiers.clear();
        replayStatus('Buffer running · ready for next reward');
      }
    } catch(e) {
      log('Replay save FAILED: '+errText(e));
      // Retry without spinning, but still subject to replay history rolling.
      replayBatchStart=now();
      replayDeadline=Math.max(replayDeadline,now()+2000);
      scheduleReplaySave();
    } finally {replaySaving=false;updateControls();}
  }
  function handleRewardEvent(mode, reason, tier = null) {
    if (!$('liveRecord').checked) {
      log('DETECTION ONLY: ' + reason + ' confirmed; no replay saved.');
      return;
    }
    if (!ready) {
      log('Verified ' + reason + ', but OBS is disconnected; replay not available.');
      return;
    }
    queueReplaySave(reason, tier);
  }
  async function stopRecording() {
    if (!recordingByUs || stoppingByUs) return;
    stoppingByUs = true;
    clearTimeout(stopTimer); stopTimer = null; recordingDeadline=0;
    let stopped = false;
    try {
      const result = await request('StopRecord');
      stopped = true;
      $('recordState').textContent = 'Stopped and saved by OBS';
      log('OBS recording stopped. ' + (result.outputPath ? 'File: ' + result.outputPath : ''));
    } catch (e) {
      $('recordState').textContent = 'Stop not confirmed — check OBS';
      log('STOP ERROR: ' + errText(e) + '. Check OBS manually!');
    } finally {
      recordingByUs = false; testBusy = false; stoppingByUs = false;
      const shouldRestart = queuedOpeningAfterStop && stopped && ready && $('liveRecord').checked;
      queuedOpeningAfterStop = false;
      updateControls();
      if (shouldRestart) {
        log('OBS starting a new clip for an opening detected during the previous stop.');
        recordFiveSeconds('auto');
      }
    }
  }
  async function recordFiveSeconds(mode) {
    if (!ready || testBusy || recordingByUs || stoppingByUs) return;
    // Record mode is assigned before the asynchronous OBS startup so clicks
    // during startup can be distinguished from a manually requested test.
    activeRecordMode = mode;
    testBusy = true; recordingDeadline=now()+5000; updateControls();
    try {
      const state = await request('GetRecordStatus');
      if (state.outputActive) {
        $('recordState').textContent = 'OBS already recording';
        log('Skipped: OBS is already recording. Existing recording not touched.');
        return;
      }
      await request('StartRecord');
      recordingByUs = true;
      activeRecordMode = mode;
      recordingDeadline=Math.max(recordingDeadline,now()+5000);
      log(`OBS started a 5-second ${mode === 'auto' ? 'casket' : mode === 'reward' ? 'reward-window' : mode === 'reroll' ? 'reroll' : 'manual test'} recording.`);
      scheduleAutoStop();
    } catch(e) {
      $('recordState').textContent = 'Recording failed';
      log('OBS start failed: ' + errText(e));
    } finally {
      if (!recordingByUs) { testBusy = false; recordingDeadline=0; }
      updateControls();
    }
  }

  function storeSettings() {
    try{localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      threshold:$('threshold').value,rewardThreshold:$('rewardThreshold').value,
      liveRecord:$('liveRecord').checked,rememberPassword:$('rememberPassword').checked,
      autoConnect:$('autoConnect').checked,autoWatch:$('autoWatch').checked,
      autoBuffer:$('autoBuffer').checked,replaySeconds:$('replaySeconds').value
    }));}catch(e){log('Could not save settings: '+errText(e));}
  }
  function restoreSettings() {
    try{
      const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');
      if(s.threshold && Number(s.threshold)>=85 && Number(s.threshold)<=99) $('threshold').value=s.threshold;
      if(s.rewardThreshold && Number(s.rewardThreshold)>=85 && Number(s.rewardThreshold)<=99) $('rewardThreshold').value=s.rewardThreshold;
      $('liveRecord').checked=!!s.liveRecord;
      $('autoBuffer').checked=s.autoBuffer!==false;
      $('replaySeconds').value=(Number(s.replaySeconds)>=20 && Number(s.replaySeconds)<=180) ? String(s.replaySeconds) : '60';
      $('rememberPassword').checked=!!s.rememberPassword;
      $('autoConnect').checked=!!s.autoConnect;
      // User requested fully automatic detection; existing installs get this enabled.
      $('autoWatch').checked=s.autoWatch!==false;
      $('thresholdNumber').textContent=$('threshold').value+'%';
      $('rewardThresholdNumber').textContent=$('rewardThreshold').value+'%';
    }catch(e){log('Could not restore settings: '+errText(e));}
  }
  $('autoConnect').addEventListener('change',() => {storeSettings();manualDisconnect=false;autoRetryBlocked=false;});
  $('autoWatch').addEventListener('change',() => {
    storeSettings();
    if($('autoWatch').checked){ log('Auto-start detection enabled: waiting for RuneScape and saved calibration.'); autoStartWatching(); }
    else { log('Auto-start detection disabled.'); if(watching)stopWatching(); }
  });
  $('connect').addEventListener('click', () => {manualDisconnect=false;autoRetryBlocked=false;connect();});
  $('disconnect').addEventListener('click', () => {
    if (recordingByUs) return;
    manualDisconnect=true;
    if (socket) socket.close(1000, 'User disconnected');
  });
  $('test').addEventListener('click', () => recordFiveSeconds('manual'));
  $('stop').addEventListener('click', stopRecording);
  $('tierSelect').addEventListener('change',()=>{refreshTierSummary();updateControls();});
  $('calibrate').addEventListener('click', calibrate);
  $('clear').addEventListener('click', clearTemplate);
  $('rewardCalibrate').addEventListener('click', calibrateReward);
  $('rewardClear').addEventListener('click', clearRewardTemplate);
  $('rerollCalibrate').addEventListener('click',calibrateReroll);
  $('rerollClear').addEventListener('click',clearReroll);
  $('rememberPassword').addEventListener('change', () => {
    if(!$('rememberPassword').checked) localStorage.removeItem(PASSWORD_KEY);
    storeSettings(); updateControls();
  });
  $('forgetPassword').addEventListener('click', () => {
    localStorage.removeItem(PASSWORD_KEY);
    $('rememberPassword').checked=false;
    $('password').value=''; savedPasswordForHandshake=''; storeSettings(); updateControls();
    log('Stored OBS password forgotten.');
  });
  $('rewardThreshold').addEventListener('input', () => {
    $('rewardThresholdNumber').textContent=$('rewardThreshold').value+'%'; storeSettings();
  });
  $('watch').addEventListener('click', () => { $('autoWatch').checked=true;storeSettings();startWatching(); });
  $('unwatch').addEventListener('click', () => { $('autoWatch').checked=false;storeSettings();stopWatching();log('Auto-start paused until re-enabled.'); });
  $('threshold').addEventListener('input', () => {
    $('thresholdNumber').textContent = $('threshold').value + '%'; storeSettings();
  });
  $('liveRecord').addEventListener('change', () => {
    storeSettings(); log(`Automatic reward replay saving ${$('liveRecord').checked ? 'ENABLED' : 'DISABLED; detection-only mode'}.`);
    if ($('liveRecord').checked && ready) checkReplayBuffer(true);
  });
  $('autoBuffer').addEventListener('change', () => {storeSettings();if ($('autoBuffer').checked && ready) checkReplayBuffer(true);});
  $('replaySeconds').addEventListener('change', () => {storeSettings();log('Configured replay duration expectation: ' + configuredReplaySeconds() + ' s. Set the same Maximum Replay Time in OBS settings!');});
  $('bufferStart').addEventListener('click',() => startReplayBuffer());
  $('bufferSaveTest').addEventListener('click',async () => {
    if(!ready || !replayActive || replaySaving) return;
    replaySaving=true;updateControls();
    try{const path=await saveReplayAndConfirm();log(path ? 'Manual replay-buffer test file confirmed.' : 'Manual replay save not confirmed; inspect OBS recording folder.');}
    catch(e){log('Manual replay save failed: '+errText(e));}
    finally{replaySaving=false;updateControls();}
  });
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(logLines.join('\n')); log('Activity log copied.'); }
    catch (_) { log('Clipboard unavailable; select text in the log manually.'); }
  });
  window.addEventListener('beforeunload', (event) => {
    if (recordingByUs || pendingReplay) {
      // Modern browsers may show a generic leave-page prompt.
      event.preventDefault();
      event.returnValue = '';
    }
    clearInterval(captureTimer); clearInterval(clickTimer); clearInterval(rewardScanTimer);
    clearTimeout(replayTimer);
    if (socket && !recordingByUs) socket.close();
  });

  log('v0.6.4 loaded. Tier attribution locked per reward window; Finnish filenames and replay saving preserved.');
  if (alt() && typeof alt().identifyAppUrl === 'function') {
    try { alt().identifyAppUrl('http://127.0.0.1:8091/appconfig-v0.6.4.json'); }
    catch(e) { log('Alt1 app registration error: ' + errText(e)); }
  }
  refreshPermissions();
  loadTemplate();
  restoreSettings();
  updateControls();
  if ($('autoConnect').checked && $('rememberPassword').checked && localStorage.getItem(PASSWORD_KEY)) {
    log('Auto-connect enabled: OBS will be retried when it becomes available.');
    setTimeout(() => {lastObsRetry=now();connect();},350);
  }
  function autoStartWatching() {
    if (!$('autoWatch').checked || watching || calibratedTimeout || rewardCalTimer || rerollCalTimer) return;
    if (!permissionsOK() || !linked() || (!hasCaskets() && !hasRewards())) {
      if (now()-lastAutoWaitLog > 60000) {
        log('Auto detector waiting for RuneScape link, Alt1 permissions, and saved calibration.');
        lastAutoWaitLog=now();
      }
      setBadge('detectStatus','Waiting for RuneScape','warn');
      return;
    }
    startWatching();
  }
  if ($('autoWatch').checked) {
    log('Auto-start detection enabled. It will activate when RuneScape is linked.');
    setTimeout(autoStartWatching,500);
  }
  setInterval(() => {
    refreshPermissions();
    updateControls();
    if (watching && (!permissionsOK() || !linked())) {
      stopWatching();
      if($('autoWatch').checked) log('RuneScape disconnected/unlinked; detector paused until linked again.');
    }
    autoStartWatching();
    // OBS may start after Alt1 at Windows login. Retry locally without
    // requiring a manual connect button, but never hammer a rejected password.
    if (ready && now()-lastReplayCheck > 15000) checkReplayBuffer(true);
    if ($('autoConnect').checked && $('rememberPassword').checked && localStorage.getItem(PASSWORD_KEY) &&
        !manualDisconnect && !autoRetryBlocked && !ready && !connecting && now()-lastObsRetry>=10000) {
      lastObsRetry=now(); connect();
    }
  }, 1800);
})();
