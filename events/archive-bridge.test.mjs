import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../polytrack_062_patch.js',import.meta.url),'utf8');
const start=source.indexOf('        readArchivedSnapshot:');
const end=source.indexOf('        importTrackCode:',start);
assert(start>=0&&end>start,'archive bridge hooks are present');
const hooks=source.slice(start,end);

function bridge({assets=new Map(),moduleUrl='https://game.test/events/client.mjs?v=168'}={}){
 const reads=[],requests=[];
 const context={
  URL,
  readPublicSnapshotBackup:async(kind,id,accountId)=>{reads.push([kind,id,accountId]);return assets.get([kind,id,accountId].join('/'))||null;},
  eventsModuleUrl:moduleUrl,
  location:{origin:'https://game.test'},
  eventRequestSignal:()=>undefined,
  fetch:async url=>{requests.push(String(url));return {ok:true,json:async()=>({periods:[],archives:[]})};}
 };
 return {hooks:vm.runInNewContext('({'+hooks+'})',context),reads,requests};
}

test('archive bridge reads only matching saved boards and replays',async()=>{
 const accountId='a'.repeat(64),id='daily_20261001';
 const assets=new Map([
  ['event/'+id+'/',{period:{id},archived:true,entries:[]}],
  ['event-replay/'+id+'/'+accountId,{periodId:id,accountId,replay:'saved'}]
 ]);
 const {hooks,reads,requests}=bridge({assets});
 assert.equal((await hooks.readArchivedSnapshot(id)).archived,true);
 assert.equal((await hooks.readArchivedReplay(id,accountId)).replay,'saved');
 assert.equal(await hooks.readArchivedSnapshot('missing'),null);
 assert.equal(await hooks.readArchivedReplay(id,'b'.repeat(64)),null);
 assert.equal(await hooks.readArchivedSnapshot('../invalid'),null);
 assert.equal(hooks.readArchivedTrack,undefined,'no Worker-backed archive import hook');
 assert.deepEqual(reads.map(row=>Array.from(row)),[
  ['event',id,undefined],['event-replay',id,accountId],['event','missing',undefined],['event-replay',id,'b'.repeat(64)]
 ]);
 assert.deepEqual(requests,[],'missing static assets do not trigger network fallback');
});

test('archive catalog accepts only a same-origin static file',async()=>{
 const local=bridge();
 assert.equal((await local.hooks.readStaticArchiveCatalog()).archives.length,0);
 assert.deepEqual(local.requests,['https://game.test/events/public-catalog.json']);
 const remote=bridge({moduleUrl:'https://cdn.test/events/client.mjs'});
 await assert.rejects(remote.hooks.readStaticArchiveCatalog(),/same-origin/);
 assert.deepEqual(remote.requests,[]);
});
