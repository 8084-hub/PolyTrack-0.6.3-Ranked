const finite=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
const positiveInt=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const text=value=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,100);
const numbers=['activeMs','simulatedMs','sincePbMs','attempts','finishes','pbs','restarts','respawns','lastPlayedAt','lastPbAt','trackingStartedAt','legacyActiveMs','furthestCheckpoint','bestMs','improvedMs'];
export function buildDeveloperReport({practice=[],coverage=null,finishes=[],snapshot={},events=[],viewport={},publicId='',includePublicId=false,clientRevision=155}={}){
 const select=(row,fields)=>Object.fromEntries(fields.map(key=>[key,finite(row?.[key])]));
 return {schema:'polytrack-developer-diagnostics-v1',revision:finite(clientRevision),diagnosticsRevision:155,exportedAt:new Date().toISOString(),
  privacy:{automaticUpload:false,includesPublicId:includePublicId===true,limitations:'Client observations are incomplete and untrusted. Timing notes are not cheating verdicts. Request events are not billed Firebase operations.'},
  ...(includePublicId&&/^[a-f0-9]{64}$/.test(publicId)?{publicRacerId:publicId}:{}),
  snapshot:{generation:finite(snapshot.generation),capturedAt:finite(snapshot.capturedAt)},
  viewport:select(viewport,['width','height','pixelRatio']),
  practiceCoverage:coverage?{version:2,scope:'Known reported/device visible-time estimate, not full historical driving coverage',...select(coverage,['startedAt','baselinePlaytimeMs','knownPlaytimeMs','observedVisibleMs','coverageFraction'])}:null,
  practice:practice.slice(0,256).map(row=>({trackId:/^[a-f0-9]{64}$/.test(row.trackId)?row.trackId:'',trackName:text(row.trackName),...select(row,numbers),
   resetTimingBuckets:Array.from({length:4},(_,i)=>finite(row.restartBuckets?.[i])),
   recentFinishes:(row.recentFinishes||[]).slice(-8).map(run=>({...select(run,['at','timeMs','practiceMs']),timingNote:run.timingNote===true}))})),
  loadedResults:finishes.slice(0,256).map(row=>({trackId:/^[a-f0-9]{64}$/.test(row.trackId)?row.trackId:'',...select(row,['timeMs','rank','fieldSize','weight','cachedAt','snapshotCapturedAt']),rank:positiveInt(row.rank),fieldSize:positiveInt(row.fieldSize),weight:typeof row.weight==='number'&&Number.isFinite(row.weight)?row.weight:null,runVerified:typeof row.runVerified==='boolean'?row.runVerified:null,integrityVerified:typeof row.integrityVerified==='boolean'?row.integrityVerified:null,local:row.local===true,placementKnown:positiveInt(row.rank)!==null&&positiveInt(row.fieldSize)!==null&&Number(row.fieldSize)>=Number(row.rank)})),
  recentEvents:events.slice(-80).map(row=>({category:/^[a-z-]{1,32}$/.test(row.category)?row.category:'application',code:/^[A-Z0-9_-]{1,32}$/.test(row.code)?row.code:'EVENT',durationMs:finite(row.durationMs),status:finite(row.status)}))};
}
export function openDiagnostics({report,practiceOnly=false,returnFocus=document.activeElement}){
 document.getElementById('polytrackDeveloperDialog')?.remove();
 const dialog=document.createElement('dialog');dialog.id='polytrackDeveloperDialog';dialog.className='sq-developer-dialog';
 dialog.innerHTML='<header><h2></h2><button type="button" data-close aria-label="Close developer information">Close</button></header><main><p>Reproduce the issue, then download or copy this report. Nothing is uploaded automatically.</p><details><summary>What is included?</summary><p>Your local practice totals and recent finishes, loaded track results, feature coverage, snapshot version, screen dimensions and bounded request diagnostics. No login tokens, emails, passwords, replays, browser history or raw console messages.</p></details><label><input type="checkbox" data-public-id> Include my public racer ID (helps match public results)</label><label><input type="checkbox" data-log-diagnostics> Log app events and snapshot timings to console (not Firebase billing)</label><div data-practice></div><details><summary>Preview JSON report</summary><pre data-json></pre></details><p role="status" data-status></p></main><footer><button type="button" data-download>Download JSON</button><button type="button" data-copy>Copy JSON</button></footer>';
 dialog.querySelector('h2').textContent=practiceOnly?'Your practice history':'Export developer diagnostics';
 const duration=ms=>ms>=3600000?(ms/3600000).toFixed(1)+' h':Math.round(ms/60000)+' min';
 const render=()=>{
  const data=report(dialog.querySelector('[data-public-id]').checked);
  dialog.querySelector('[data-json]').textContent=JSON.stringify(data,null,2);
  const target=dialog.querySelector('[data-practice]');target.replaceChildren();
  const coverage=document.createElement('p');
  coverage.textContent=data.practiceCoverage?'Feature-enabled visible time: '+duration(data.practiceCoverage.observedVisibleMs)+'; reference playtime: '+duration(data.practiceCoverage.knownPlaytimeMs)+' (coverage estimate '+Math.round(data.practiceCoverage.coverageFraction*100)+'%). This reference uses reported/device playtime, not guaranteed full account history. Active driving totals are shown per track below.':'Practice coverage starts when this version is used. Earlier playtime is not retroactively tracked.';target.append(coverage);
  if(!data.practice.length){const p=document.createElement('p');p.textContent='No driving recorded yet. Complete a run or restart after driving to build practice history.';target.append(p);}
  for(const row of data.practice.sort((a,b)=>b.lastPlayedAt-a.lastPlayedAt)){
   const article=document.createElement('article'),heading=document.createElement('h3'),p=document.createElement('p'),more=document.createElement('p');
   heading.textContent=row.trackName||'Track';p.textContent=duration(row.activeMs)+' active practice · '+row.attempts+' attempts · '+row.finishes+' finishes · '+row.pbs+' PBs';
   more.textContent=row.restarts+' restarts · '+row.respawns+' checkpoint respawns · '+duration(row.sincePbMs)+' since PB'+(row.pbs?' · '+duration(row.activeMs/row.pbs)+' per PB':'')+(row.bestMs?' · Best '+(row.bestMs/1000).toFixed(3)+'s':'');
   article.append(heading,p,more);
   const recent=document.createElement('small');recent.textContent=(row.lastPlayedAt?'Last played '+new Date(row.lastPlayedAt).toLocaleString():'')+(row.improvedMs?' · Recorded improvement '+(row.improvedMs/1000).toFixed(3)+'s':'');article.append(recent);
   if(row.recentFinishes.some(run=>run.timingNote)){const note=document.createElement('p');note.textContent='Timing discrepancy recorded for developer review. This is not evidence of cheating.';article.append(note);}
   const details=document.createElement('details'),summary=document.createElement('summary'),detail=document.createElement('p');summary.textContent='Recent finishes and reset pattern';detail.textContent='Recent finishes: '+(row.recentFinishes.map(run=>(run.timeMs/1000).toFixed(3)+'s').join(', ')||'None recorded')+'. Restarts: under 5s '+row.resetTimingBuckets[0]+', 5 to 15s '+row.resetTimingBuckets[1]+', 15 to 30s '+row.resetTimingBuckets[2]+', 30s or longer '+row.resetTimingBuckets[3]+'. '+(row.attempts?Math.round(100*row.finishes/row.attempts)+'% of observed attempts finished.':'');details.append(summary,detail);article.append(details);
   target.append(article);
  }
  return JSON.stringify(data,null,2);
 };
 const status=message=>{dialog.querySelector('[data-status]').textContent=message;};
 const debug=dialog.querySelector('[data-log-diagnostics]');
 try{debug.checked=localStorage.getItem('polytrack-developer-request-log')==='true';}catch{debug.disabled=true;}
 debug.addEventListener('change',()=>{try{localStorage.setItem('polytrack-developer-request-log',String(debug.checked));status('Logging '+(debug.checked?'enabled':'disabled')+'. This is not a Firebase billing meter.');}catch{status('Console logging preferences cannot be saved in this browser.');}});
 dialog.querySelector('[data-public-id]').addEventListener('change',render);
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{dialog.remove();if(returnFocus?.isConnected&&!returnFocus.disabled)returnFocus.focus({preventScroll:true});});
 dialog.querySelector('[data-download]').onclick=()=>{const blob=new Blob([render()],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='polytrack-developer-report-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Downloaded. Review it before sharing with the developer.');};
 dialog.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(render());status('JSON copied. Review it before sharing.');}catch{status('Clipboard unavailable. Use Download JSON instead.');}};
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
 document.body.append(dialog);render();dialog.showModal();
}
