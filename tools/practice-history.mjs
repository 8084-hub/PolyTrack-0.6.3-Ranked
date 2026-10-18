export const PRACTICE_KEY='polytrack-practice-history-v1';
const HASH=/^[a-f0-9]{64}$/;
const MAX_TRACKS=256,MAX_ACCOUNTS=4;
export function createPracticeHistory({storage,now=Date.now,onChange=()=>{}}={}){
 let data={version:1,accounts:{}},dirty=false,revision=0,lastSave=0;
 try{
  const value=JSON.parse(storage?.getItem(PRACTICE_KEY)||'null');
  if(value?.version===1&&value.accounts&&typeof value.accounts==='object'){
   for(const [account,tracks] of Object.entries(value.accounts).filter(([id])=>HASH.test(id)).slice(0,MAX_ACCOUNTS)){
    if(!tracks||typeof tracks!=='object'||Array.isArray(tracks))continue;
    data.accounts[account]={};
    for(const [id,row] of Object.entries(tracks).filter(([id,row])=>HASH.test(id)&&row&&typeof row==='object').slice(0,MAX_TRACKS)){
     const clean={};for(const field of ['activeMs','sincePbMs','attempts','finishes','pbs','restarts','restartsSincePb','respawns','lastPlayedAt','lastPbAt','bestMs','furthestCheckpoint'])clean[field]=Number.isFinite(row[field])&&row[field]>=0?Math.min(row[field],field.endsWith('At')?now():315576000000):0;
     clean.restartBuckets=Array.from({length:4},(_,index)=>Math.min(1e9,Math.max(0,Number(row.restartBuckets?.[index])||0)));
     data.accounts[account][id]=clean;
    }
   }
  }
 }catch{}
 const safe=n=>Number.isFinite(n)&&n>=0?n:0;
 function entry(accountId,trackId){
  if(!HASH.test(accountId)||!HASH.test(trackId))return null;
  const accounts=data.accounts;
  if(!Object.hasOwn(accounts,accountId))accounts[accountId]={};
  while(Object.keys(accounts).length>MAX_ACCOUNTS)delete accounts[Object.keys(accounts).find(id=>id!==accountId)];
  const tracks=accounts[accountId];
  if(!Object.hasOwn(tracks,trackId))tracks[trackId]={activeMs:0,sincePbMs:0,attempts:0,finishes:0,pbs:0,restarts:0,restartsSincePb:0,respawns:0,lastPlayedAt:0,lastPbAt:0,bestMs:0,restartBuckets:[0,0,0,0],furthestCheckpoint:0};
  while(Object.keys(tracks).length>MAX_TRACKS){const oldest=Object.keys(tracks).filter(id=>id!==trackId).sort((a,b)=>safe(tracks[a].lastPlayedAt)-safe(tracks[b].lastPlayedAt))[0];delete tracks[oldest];}
  return tracks[trackId];
 }
 function changed(){dirty=true;revision++;try{onChange();}catch{}}
 function flush(force=false){if(!dirty||!force&&now()-lastSave<30000)return false;lastSave=now();try{storage?.setItem(PRACTICE_KEY,JSON.stringify(data));dirty=false;return true;}catch{return false;}}
 function begin(accountId,trackId,baselineMs=0){
  const row=entry(accountId,trackId);if(!row)return null;
  
  if(Number.isFinite(baselineMs)&&baselineMs>0)row.bestMs=row.bestMs>0?Math.min(row.bestMs,baselineMs):baselineMs;
  let ended=false,elapsed=0,started=false;
  function start(){if(started)return;started=true;row.attempts=safe(row.attempts)+1;row.lastPlayedAt=now();changed();}
  return {
   tick(deltaMs,checkpoint=0){if(ended)return;const delta=Math.min(2000,safe(deltaMs));if(!delta)return;start();row.activeMs=safe(row.activeMs)+delta;row.sincePbMs=safe(row.sincePbMs)+delta;row.lastPlayedAt=now();row.furthestCheckpoint=Math.max(safe(row.furthestCheckpoint),Math.min(10000,safe(checkpoint)));elapsed+=delta;changed();flush();},
   respawn(atMs){if(ended||atMs<=0)return;row.respawns=safe(row.respawns)+1;changed();},
   finish(timeMs){if(ended||!Number.isFinite(timeMs)||timeMs<=0)return;start();ended=true;row.finishes=safe(row.finishes)+1;row.lastPlayedAt=now();if(!row.bestMs||timeMs<row.bestMs){row.bestMs=timeMs;row.pbs=safe(row.pbs)+1;row.lastPbAt=now();row.sincePbMs=0;row.restartsSincePb=0;}changed();},
   restart(atMs){if(ended)return;ended=true;if(atMs>0||elapsed>0){start();row.restarts=safe(row.restarts)+1;row.restartsSincePb=safe(row.restartsSincePb)+1;const index=atMs<5000?0:atMs<15000?1:atMs<30000?2:3;row.restartBuckets=Array.isArray(row.restartBuckets)&&row.restartBuckets.length===4?row.restartBuckets:[0,0,0,0];row.restartBuckets[index]++;changed();}},
   leave(){ended=true;}
  };
 }
 return {begin,flush,get revision(){return revision;},get(accountId,trackId){const row=data.accounts?.[accountId]?.[trackId];return row?{...row,restartBuckets:[...(row.restartBuckets||[])]}:null;},clear(accountId){if(Object.hasOwn(data.accounts,accountId)){delete data.accounts[accountId];changed();flush(true);}}};
}
export function practiceAdvice(row,at=Date.now()){
 if(!row||row.attempts<3||row.activeMs<60000)return {factor:1,text:''};
 const age=Math.max(0,at-row.lastPlayedAt),days=Math.floor(age/86400000);
 if(days>=7)return {factor:1.1,text:`Last practised ${days} days ago`};
 if(row.sincePbMs>=900000&&row.restartsSincePb>=10)return {factor:.9,text:'15+ minutes since a PB; consider a different route'};
 if(row.pbs>=2&&row.activeMs>=180000)return {factor:1.05,text:`${row.pbs} PBs in ${Math.round(row.activeMs/60000)} minutes of practice`};
 return {factor:1,text:`${Math.round(row.activeMs/60000)} min practice · ${row.finishes} finishes · ${row.restarts} restarts`};
}
