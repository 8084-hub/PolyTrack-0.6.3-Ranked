const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../polytrack_062_patch.js'),'utf8');
const start=source.indexOf('  function writeTrackSnapshotCache('),end=source.indexOf('  function reconcileTrackEntriesWithLocal(',start);
function fixture(){
  let store={},syncs=0,renders=0;
  const context=vm.createContext({Date,Number,String,Array,Object,RANK_MODEL:'model',TRACK_CACHE_SCHEMA:6,
    TRACK_CACHE_KEY:'tracks',trackCacheGeneration:0,trackOverlayCache:null,
    trackSnapshotStore:()=>store,applyCanonicalTrackWeight:(_,rows)=>rows,
    schedulePersonalBestPlacementRender:()=>{renders++;},
    writeJsonStorage:(_,value)=>{store=value;},syncCachedRecordingVerification:()=>{syncs++;}});
  vm.runInContext(source.slice(start,end),context);
  return {context,board:()=>store.track,syncs:()=>syncs,renders:()=>renders};
}
test('older snapshot cannot replace verified loaded results or their check time',()=>{
  const f=fixture(),live=[{accountId:'racer',timeMs:100,runVerified:true}];
  f.context.writeTrackSnapshotCache('track',live,200,{revision:3,source:'edge',checkedAt:210});
  assert.equal(f.context.writeTrackSnapshotCache('track',[{accountId:'racer',timeMs:100,runVerified:false}],150,
    {revision:2,source:'public-backup',checkedAt:0}),false);
  assert.equal(f.board().entries[0].runVerified,true);assert.equal(f.board().checkedAt,210);assert.equal(f.syncs(),1);
});
test('higher revision wins even with an older timestamp; repeat live check is retained',()=>{
  const f=fixture();
  f.context.writeTrackSnapshotCache('track',[],200,{revision:3,checkedAt:210});
  assert.equal(f.context.writeTrackSnapshotCache('track',[],150,{revision:4,checkedAt:220}),true);
  assert.equal(f.board().revision,4);
  assert.equal(f.context.writeTrackSnapshotCache('track',[],150,{revision:4,checkedAt:230}),true);
  assert.equal(f.board().checkedAt,230);
});
test('unversioned older packages also cannot downgrade newer loaded data',()=>{
  const f=fixture();
  f.context.writeTrackSnapshotCache('track',[],200,{checkedAt:210});
  assert.equal(f.context.writeTrackSnapshotCache('track',[],150,{source:'public-backup'}),false);
  assert.equal(f.board().serverUpdatedAt,200);
});

test('accepting new published standings schedules menu placement without a new PB',()=>{
  const f=fixture();
  f.context.writeTrackSnapshotCache('track',[{accountId:'me',timeMs:100}],200,{revision:2,source:'edge',checkedAt:210});
  assert.equal(f.renders(),1);
  f.context.writeTrackSnapshotCache('track',[{accountId:'me',timeMs:100},{accountId:'other',timeMs:90}],300,{revision:3,source:'edge',checkedAt:310});
  assert.equal(f.renders(),2);
  f.context.writeTrackSnapshotCache('track',[],100,{revision:1,source:'public-backup'});
  assert.equal(f.renders(),2,'rejected older files do not trigger a redraw');
});
