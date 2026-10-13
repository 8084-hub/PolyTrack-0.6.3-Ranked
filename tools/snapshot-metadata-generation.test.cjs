const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../polytrack_062_patch.js'),'utf8');
test('generation recovery rewarms metadata and ignores retired warm replies',async()=>{
 const start=source.indexOf('      let metadataEpoch=0;'),end=source.indexOf('      return reader;',start);assert(start>=0&&end>start);
 const requests=[],deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};let notify;
 const reader=kind=>{const item={kind,...deferred()};requests.push(item);return item.promise;};
 const context={module:{createPublicSnapshotReader:options=>{notify=options.onGenerationChange;return reader;}},document:{querySelector:()=>({content:'./public-snapshots24/'}),getElementById:()=>null},window:{location:{href:'https://example.test/'}},URL,Date,queueMicrotask,
 snapshotTrackStatistics:{old:1},snapshotCosmeticEntries:{old:1},snapshotRacerDirectoryEntries:{old:1},publicSnapshotCapturedAt:1,cosmeticEpoch:0,overallCacheGeneration:0,overallEntriesCache:[],overallLoadState:{},updateTrackFreshnessBanner:()=>{},isElementVisible:()=>false,renderEntries:()=>{},decorateNativeLeaderboardCosmetics:()=>{}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);assert.equal(requests.length,4);
 notify();await new Promise(resolve=>queueMicrotask(resolve));assert.equal(requests.length,8);assert.equal(context.publicSnapshotCapturedAt,0);
 for(const req of requests.slice(0,4))req.resolve({tracks:{retired:1},entries:{retired:1},capturedAt:'2020-01-01T00:00:00Z'});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(Object.keys(context.snapshotTrackStatistics).length,0);assert.equal(context.publicSnapshotCapturedAt,0);
 for(const req of requests.slice(4))req.resolve({tracks:{current:1},entries:{current:1},capturedAt:'2021-01-01T00:00:00Z'});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(context.snapshotTrackStatistics.current,1);assert.equal(context.snapshotCosmeticEntries.current,1);assert.equal(context.snapshotRacerDirectoryEntries.current,1);assert.equal(context.publicSnapshotCapturedAt,Date.parse('2021-01-01T00:00:00Z'));
});

test('metadata row replacement preserves page while normal ranking loads reset it',()=>{
 const start=source.indexOf('  function renderEntries(entries,snapshotMeta,'),end=source.indexOf('    const filterRoot=',start);assert(start>=0&&end>start);
 const context={document:{getElementById:()=>({})},overallEntriesCache:[],overallCategory:'overall',overallPage:3,overallLoadState:{},overlaySnapshotRacerDirectory:rows=>rows,setRankedFilterSnapshotMeta:()=>{}};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+'\n}',context);
 context.renderEntries([{userId:'test'}],{},{preservePage:true});assert.equal(context.overallPage,3);
 context.renderEntries([{userId:'test'}],{});assert.equal(context.overallPage,0);
 const warm=source.slice(source.indexOf('      let metadataEpoch=0;'),source.indexOf('      return reader;',source.indexOf('      let metadataEpoch=0;')));
 assert.equal((warm.match(/renderEntries\(overallEntriesCache,overallLoadState,\{preservePage:true\}\)/g)||[]).length,2);
});
