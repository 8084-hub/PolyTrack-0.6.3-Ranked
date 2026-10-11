import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../polytrack_062_patch.js',import.meta.url),'utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}

test('protected refresh control visibly locks and unlocks without changing loading-owned disabled state',()=>{
  let locked=true;const attrs=new Map();
  const button={disabled:false,dataset:{},style:{removeProperty:()=>{}},setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
  const context=vm.createContext({String,snapshotOnlyForNewAccount:()=>locked,snapshotUnlockLabel:()=> 'Live refresh unlocks in 10:00',snapshotCaptureLabel:()=> 'Snapshot captured 2 hours ago'});
  vm.runInContext(section('  function syncSnapshotRefreshControl(', '  async function readPublicSnapshotBackup('),context);
  context.syncSnapshotRefreshControl(button);assert.equal(button.disabled,true);assert.match(button.title,/Live refresh unlocks in 10:00/);assert.equal(attrs.get('aria-disabled'),'true');
  context.syncSnapshotRefreshControl(button);locked=false;context.syncSnapshotRefreshControl(button);assert.equal(button.disabled,false);
  button.disabled=true;locked=true;context.syncSnapshotRefreshControl(button);locked=false;context.syncSnapshotRefreshControl(button);assert.equal(button.disabled,true);
});
test('snapshot age labels do not pretend each track was updated when the snapshot was captured',()=>{
  const context=vm.createContext({publicSnapshotCapturedAt:123,ageLabel:at=>{assert.equal(at,123);return '2 hours ago';}});
  vm.runInContext(section('  function snapshotCaptureLabel(', '  function syncSnapshotRefreshControl('),context);
  assert.equal(context.snapshotCaptureLabel(),'Snapshot captured 2 hours ago');
  context.publicSnapshotCapturedAt=0;assert.match(context.snapshotCaptureLabel(),/unavailable/);
});

test('new-account snapshot protection needs fifteen minutes and a saved finish, and survives reloads',()=>{
  let now=Date.UTC(2026,9,7),accountId='a'.repeat(64),cached=null,local=[];const storage=new Map();
  const create=()=>{
    const context=vm.createContext({Date:{now:()=>now},activeRankedAccountId:()=>accountId,
      readOverallSnapshotCache:()=>cached,readLocalRaceRows:()=>local,canonicalRaceTimeMs:row=>row.timeMs||0,snapshotRacerDirectoryEntries:{},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}});
    vm.runInContext(section('  const NEW_ACCOUNT_SNAPSHOT_MS=', '  let publicSnapshotReaderPromise='),context);return context;
  };
  let context=create();assert.equal(context.snapshotOnlyForNewAccount(),true);
  assert.match(context.snapshotUnlockLabel(),/15:00/);
  assert.match(context.snapshotUnlockLabel(),/saved finish required/);
  local=[{accountId,timeMs:12345}];
  now+=899999;context=create();assert.equal(context.snapshotOnlyForNewAccount(),true);
  assert.match(context.snapshotUnlockLabel(),/0:01/);
  assert.doesNotMatch(context.snapshotUnlockLabel(),/finish required/);
  assert.match(context.snapshotAccessNotice(),/Finish saved\. Live refresh unlocks when the timer ends\./);
  assert.doesNotMatch(context.snapshotAccessNotice(),/first saved finish/);
  now++;assert.equal(context.snapshotOnlyForNewAccount(),false);
  assert.equal(context.snapshotUnlockLabel(),'Live refresh available');
  accountId='b'.repeat(64);assert.equal(context.snapshotOnlyForNewAccount(),true);
  cached={entries:[{accountId,accountCreatedAt:now-86400000}]};assert.equal(context.snapshotOnlyForNewAccount(),false);
});
test('older racer-directory identities unlock bounded live refresh without a local finish',()=>{
  const now=Date.UTC(2026,9,7),accountId='c'.repeat(64);
  const context=vm.createContext({Date:{now:()=>now},activeRankedAccountId:()=>accountId,readOverallSnapshotCache:()=>null,
    readLocalRaceRows:()=>[],canonicalRaceTimeMs:()=>0,snapshotRacerDirectoryEntries:{[accountId]:{updatedAt:now-900000}},
    localStorage:{getItem:()=>String(now-900000),setItem:()=>{}}});
  vm.runInContext(section('  const NEW_ACCOUNT_SNAPSHOT_MS=', '  let publicSnapshotReaderPromise='),context);
  assert.equal(context.snapshotOnlyForNewAccount(),false);
});

test('snapshot racer-directory overlays overall identity only when profile metadata is newer',()=>{
  const id='d'.repeat(64),directory={updatedAt:300,name:'Natsujo',nickname:'Natsujo',countryCode:'JP',carStyle:'style-v2',carId:'car-2',carColors:'ffffff00000000000000',profileCosmetics:{theme:'classic'}};
  const context=vm.createContext({snapshotRacerDirectoryEntries:{[id]:directory},cleanUserId:value=>String(value||''),
    getLastKnownName:()=>'',__pt062GetRememberedStyle:()=>'',PROFILE_COSMETICS_KEY:'local-profile-cosmetics',readJsonStorage:()=>null,activeRankedAccountId:()=>''});
  vm.runInContext(section('  function snapshotRacerDirectoryIdentity(', '  function hasExplicitProfileCosmetics('),context);
  const [row]=context.overlaySnapshotRacerDirectory([{userId:id,name:'Unknown',countryCode:'',carStyle:'',carId:'',carColors:''}]);
  assert.equal(row.name,'Natsujo');assert.equal(row.countryCode,'JP');assert.equal(row.carStyle,'style-v2');assert.equal(row.carId,'car-2');

  const live=[{userId:id,name:'Current live name',identityUpdatedAt:400}];
  assert.equal(context.overlaySnapshotRacerDirectory(live)[0].name,'Current live name');
  const newerDirectory={...directory,updatedAt:500};context.snapshotRacerDirectoryEntries[id]=newerDirectory;
  const [updated]=context.overlaySnapshotRacerDirectory(live);
  assert.equal(updated.name,'Natsujo');assert.equal(updated.identityUpdatedAt,500);
  assert.equal(context.snapshotRacerDirectoryIdentity(id,0,600),null);
  const pbNewer=[{userId:id,name:'Latest canonical PB name',identityUpdatedAt:0,pbAt:900}];
  assert.equal(context.overlaySnapshotRacerDirectory(pbNewer)[0].name,'Latest canonical PB name');
});

test('native per-track identity uses a newer directory profile but preserves fresher cached live identity',()=>{
  const id='e'.repeat(64),rows=[{userId:id,name:'Cached live profile',identityUpdatedAt:700,carStyle:'live-style'}];
  const context=vm.createContext({overallEntriesCache:rows,readOverallSnapshotCache:()=>null,cleanUserId:value=>String(value||''),
    snapshotRacerDirectoryEntries:{[id]:{updatedAt:600,name:'Old directory name',carStyle:'old-style'}},
    snapshotCosmeticEntries:{},activeRankedAccountId:()=>'',readJsonStorage:()=>null,PROFILE_COSMETICS_KEY:'profile',
    rankedIdentityIndex:null,rankedIdentityIndexSource:null});
  vm.runInContext(section('  function snapshotRacerDirectoryIdentity(', '  function hasExplicitProfileCosmetics('),context);
  vm.runInContext(section('  function rankedIdentityRows(){', '  function decorateNativeLeaderboardIdentity('),context);
  const preserved=context.rankedIdentityForRacer({userId:id,name:'Track cached name',identityUpdatedAt:700,carStyle:'track-style'});
  assert.equal(preserved.name,'Cached live profile');assert.equal(preserved.carStyle,'live-style');
  context.snapshotRacerDirectoryEntries[id]={updatedAt:800,name:'Natsujo',carStyle:'directory-style',countryCode:'JP',profileCosmetics:{theme:'classic'}};
  const hydrated=context.rankedIdentityForRacer({userId:id,name:'Track cached name',identityUpdatedAt:700});
  assert.equal(hydrated.name,'Natsujo');assert.equal(hydrated.carStyle,'directory-style');assert.equal(hydrated.countryCode,'JP');
  assert.equal(hydrated.profileCosmetics.theme,'classic');assert.equal(hydrated.identityUpdatedAt,800);
  const latestPb=context.rankedIdentityForRacer({userId:id,name:'Latest canonical PB name',identityUpdatedAt:0,pbAt:900});
  assert.equal(latestPb.name,'Latest canonical PB name');assert.equal(latestPb.carStyle,'live-style');
});

test('canonical display names choose the freshest row identity over older live and directory caches',()=>{
  const id='g'.repeat(64),context=vm.createContext({cleanUserId:value=>String(value||''),safeDisplayName:value=>String(value||''),
    overallEntriesCache:[{userId:id,name:'Cached live name',identityUpdatedAt:700}],
    readOverallSnapshotCache:()=>({entries:[{userId:id,name:'Older disk name',identityUpdatedAt:650}]}),
    snapshotRacerDirectoryEntries:{[id]:{updatedAt:800,name:'Directory name'}},getLastKnownName:()=> 'Stale remembered name',setLastKnownName:()=>{}});
  vm.runInContext(section('  function snapshotRacerDirectoryIdentity(', '  function hasExplicitProfileCosmetics('),context);
  vm.runInContext(section('  function rowIdentityFreshness(', '  function overlaySnapshotRacerDirectory('),context);
  vm.runInContext(section('  function canonicalDisplayName(', '  const sdkScriptLoads='),context);
  assert.equal(context.canonicalDisplayName(id,'Newest canonical PB',900),'Newest canonical PB');
  assert.equal(context.canonicalDisplayName(id,'Older track label',600),'Directory name');
  context.readOverallSnapshotCache=()=>({entries:[{userId:id,name:'Newest cached profile',identityUpdatedAt:950}]});
  assert.equal(context.canonicalDisplayName(id,'Older track label',600),'Newest cached profile');
});

test('cached track rows return immediately and start at most one bounded background refresh',async()=>{
  let refreshes=0,now=100000;
  const cached={entries:[{userId:'f'.repeat(64)}],fetchedAt:0,serverUpdatedAt:10};
  const context=vm.createContext({Date:{now:()=>now},unrankedExtraTrackIds:new Set(),readTrackSnapshotCache:()=>cached,TRACK_REFRESH_MS:100,
    trackSnapshotMetadataIsNewer:()=>false,selectCachedTrackState:()=>{},trackEntryRequests:new Map(),trackCacheBackgroundRefreshAt:new Map(),loadTrackEntries:async()=>{refreshes++;return cached.entries;}});
  vm.runInContext(section('  async function getTrackEntries(', '  function trackSnapshotMetadataIsNewer('),context);
  const first=await context.getTrackEntries('track',10);
  const second=await context.getTrackEntries('track',10);
  assert.equal(first.length,1);assert.equal(second.length,1);assert.equal(refreshes,1);
  const force=await context.getTrackEntries('track',10,true);
  assert.equal(force.length,1);assert.equal(refreshes,2);
});

test('selecting a cached track advances generation and rejects an older response from banner state',()=>{
  const context=vm.createContext({document:{documentElement:{classList:{remove:()=>{}}}},TRACK_REFRESH_MS:60000,
    setTimeout:()=>{},updateTrackFreshnessBanner:()=>{}});
  vm.runInContext('let currentTrackLoadState={trackId:"old-track",status:"loading"};let trackLoadGeneration=4;',context);
  vm.runInContext(section('  function selectCachedTrackState(', '  async function getTrackEntries('),context);
  vm.runInContext(section('  function setTrackLoadStateForGeneration(', '  async function getTrackEntries('),context);
  const result=vm.runInContext(`(()=>{const oldGeneration=trackLoadGeneration;selectCachedTrackState('new-track',{serverUpdatedAt:700,fetchedAt:650,checkedAt:640});const rejected=setTrackLoadStateForGeneration(oldGeneration,{trackId:'old-track',status:'stale',fetchedAt:999});return {state:currentTrackLoadState,rejected,generation:trackLoadGeneration};})()`,context);
  assert.equal(result.state.trackId,'new-track');assert.equal(result.state.status,'cache');
  assert.equal(result.state.fetchedAt,700);assert.equal(result.state.checkedAt,640);
  assert.equal(result.rejected,false);assert.equal(result.generation,5);
});

test('newer published track metadata bypasses an apparently fresh local cache',()=>{
  const context=vm.createContext({snapshotTrackStatistics:{track:{updatedAt:500}}});
  vm.runInContext(section('  function trackSnapshotMetadataIsNewer(', '  async function loadTrackEntries('),context);
  assert.equal(context.trackSnapshotMetadataIsNewer('track',{serverUpdatedAt:400,fetchedAt:Date.now()}),true);
  assert.equal(context.trackSnapshotMetadataIsNewer('track',{serverUpdatedAt:500}),false);
  assert.equal(context.trackSnapshotMetadataIsNewer('track',{serverUpdatedAt:600}),false);
});
test('idle visitors and another account saved runs never unlock live standings',()=>{
  let now=Date.UTC(2026,9,7),rows=[];
  const context=vm.createContext({Date:{now:()=>now},activeRankedAccountId:()=> 'self',readOverallSnapshotCache:()=>null,
    readLocalRaceRows:()=>rows,canonicalRaceTimeMs:row=>row.timeMs||0,snapshotRacerDirectoryEntries:{},localStorage:{getItem:()=>null,setItem:()=>{}}});
  vm.runInContext(section('  const NEW_ACCOUNT_SNAPSHOT_MS=', '  let publicSnapshotReaderPromise='),context);
  assert.equal(context.snapshotOnlyForNewAccount(),true);now+=86400000;
  assert.equal(context.snapshotOnlyForNewAccount(),true);
  rows=[{accountId:'other',timeMs:12345},{accountId:'self',timeMs:0}];assert.equal(context.snapshotOnlyForNewAccount(),true);
  rows.push({accountId:'self',timeMs:12345});assert.equal(context.snapshotOnlyForNewAccount(),false);
});

test('new-account gate tolerates blocked storage and rejects future timestamps',()=>{
  const now=Date.UTC(2026,9,7);
  for(const storage of [{getItem:()=>String(now+86400000),setItem:()=>{}},{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}}]){
    const context=vm.createContext({Date:{now:()=>now},activeRankedAccountId:()=>'',readOverallSnapshotCache:()=>null,readLocalRaceRows:()=>[],canonicalRaceTimeMs:()=>0,snapshotRacerDirectoryEntries:{},localStorage:storage});
    vm.runInContext(section('  const NEW_ACCOUNT_SNAPSHOT_MS=', '  let publicSnapshotReaderPromise='),context);
    assert.equal(context.snapshotOnlyForNewAccount(),true);
  }
});

test('new accounts cannot bypass snapshot mode with refresh or missing event snapshots',async()=>{
  let reads=0;
  const context=vm.createContext({snapshotOnlyForNewAccount:()=>true,readPublicSnapshotBackup:async()=>null,
    rankedEdgeAvailable:()=>{reads++;return true;},db:async()=>{reads++;throw Error('Unexpected cloud');}});
  vm.runInContext(section('  async function fetchRankedSnapshot(', '  function rankedNotifyQueue('),context);
  assert.equal(await context.fetchRankedSnapshot('overall','',{refresh:true}),null);
  vm.runInContext(section('  async function loadEventCloudRead(', '  const archiveMonthReads='),context);
  await assert.rejects(context.loadEventCloudRead('/v1/events/d_new/snapshot','0.6.2_event_public','d_new'),/15 minutes/);
  assert.equal(reads,0);
});

test('native replay loading resolves packaged recordings without opening Firestore',async()=>{
  let cloud=0,active=0,peak=0;
  const context=vm.createContext({readRecordingStore:ids=>ids.map(()=>null),cachedNativeRecording:row=>row||null,
    nativeRecordingMemory:new Map(),nativeRecordingRetryAt:new Map(),Date,rememberNativeRecording:()=>{},
    readPublicSnapshotBackup:async(kind,id)=>{assert.equal(kind,'recording');active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return {recording:id,frames:1};},
    db:async()=>{cloud++;throw Error('Unexpected cloud');}});
  vm.runInContext(section('  async function loadNativeRecordings(', '  const LOCAL_RACE_STORE_KEY'),context);
  const ids=Array.from({length:10},(_,i)=>i+1),rows=await context.loadNativeRecordings(ids);
  assert.equal(rows.length,10);assert.equal(cloud,0);assert.ok(peak<=4);
});

test('ordinary ranked reads use snapshots while explicit refresh reads live data',async()=>{
  let cloud=0;const snapshot={entries:[],_publicBackup:true},live={entries:[]};
  const context=vm.createContext({readPublicSnapshotBackup:async()=>snapshot,publicSnapshotRetryAt:0,Date,
    snapshotOnlyForNewAccount:()=>false,
    rankedEdgeAvailable:()=>true,rankedBrokerUrl:()=> 'https://example.test',AbortSignal,
    withTimeout:value=>value,clearRankedEdgeFailure:()=>{},markRankedEdgeUnavailable:()=>{},
    fetch:async()=>{cloud++;return {status:200,ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>live};}});
  const start=source.indexOf('  async function fetchRankedSnapshot('),end=source.indexOf('\n  function ',start);
  // Include only this function so the test exercises the production routing.
  vm.runInContext(source.slice(start,end),context);
  assert.equal(await context.fetchRankedSnapshot('overall'),snapshot);assert.equal(cloud,0);
  assert.equal(await context.fetchRankedSnapshot('overall','',{refresh:true}),live);assert.equal(cloud,1);
});

test('actual event bridge serves finalized static archives without a Worker or Firestore read',async()=>{
  const saved={id:'d_old',archived:true};let cloud=0;
  const context=vm.createContext({snapshotOnlyForNewAccount:()=>false,readPublicSnapshotBackup:async()=>saved,rankedEdgeAvailable:()=>{cloud++;return true;}});
  vm.runInContext(section('  async function loadEventCloudRead(', '  const archiveMonthReads='),context);
  const result=await context.loadEventCloudRead('/v1/events/d_old/snapshot','0.6.2_event_public','d_old');
  assert.equal(result,saved);assert.equal(cloud,0);
});

test('actual event bridge still gets authoritative live standings from the Worker',async()=>{
  let cloud=0;const live={id:'d_live',archived:false};
  const context=vm.createContext({snapshotOnlyForNewAccount:()=>false,readPublicSnapshotBackup:async()=>live,rankedEdgeAvailable:()=>true,
    rankedBrokerUrl:()=> 'https://example.test',AbortSignal,fetch:async()=>{cloud++;return {status:200,ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>live};}});
  vm.runInContext(section('  async function loadEventCloudRead(', '  const archiveMonthReads='),context);
  assert.equal(await context.loadEventCloudRead('/v1/events/d_live/snapshot','0.6.2_event_public','d_live'),live);
  assert.equal(cloud,1);
});

test('actual replay bridge serves archived recordings from static files without cloud reads',async()=>{
  const payload={replay:'encoded'};let cloud=0;
  const context=vm.createContext({eventReplayRequests:new Map(),readPublicSnapshotBackup:async kind=>kind==='event'?{archived:true}:payload,
    rankedEdgeAvailable:()=>{cloud++;return true;}});
  vm.runInContext(section('  async function readEventReplay(', '  async function ensureEventUi('),context);
  assert.equal(await context.readEventReplay('d_old','a'.repeat(64)),payload);assert.equal(cloud,0);
});
