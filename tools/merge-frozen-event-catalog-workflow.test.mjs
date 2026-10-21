import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {syncPublicEventCatalog} from './sync-event-catalog.mjs';
import {mergeSavedArchiveFiles} from './merge-frozen-event-catalog.mjs';

const workflow=await fs.readFile(new URL('../.github/workflows/sync-event-catalog.yml',import.meta.url),'utf8');
function step(name){
 const start=workflow.indexOf('      - name: '+name+'\n');assert.ok(start>=0,name);
 const next=workflow.slice(start+1).search(/\n      - (?:name|uses):/);
 return next<0?workflow.slice(start):workflow.slice(start,start+1+next);
}
function condition(name){const match=/^        if: (.+)$/m.exec(step(name));return match?.[1];}
function enabled(name,context){return vm.runInNewContext(condition(name),{always:()=>true,cancelled:()=>false,...context});}
const capture='Capture bounded public snapshots',merge='Index all saved frozen event periods';
const old={id:'old-frozen',kind:'daily',trackId:'a'.repeat(64),startsAt:1,endsAt:2};
const fresh={periods:[{...old,id:'current',startsAt:3,endsAt:4}],archives:[]};
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'polytrack-catalog-workflow-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const output=path.join(directory,'public-catalog.json'),staging=path.join(directory,'no-staging');
 await fs.writeFile(output,JSON.stringify({periods:[],archives:[old]}));
 let requests=0;
 await syncPublicEventCatalog({outputFile:output,log:()=>{},fetchImpl:async()=>{requests++;return Response.json(fresh);}});
 return {output,staging,requests:()=>requests};
}

test('scheduled Sunday skips snapshot capture but preserves archives with no staging or extra reads',async t=>{
 const context={github:{event_name:'schedule',event:{schedule:'10 20 * * 0'}},steps:{catalog:{outcome:'success'},snapshot:{outcome:'skipped'}}};
 assert.match(step('Capture public event assignments'),/^        id: catalog$/m);
 assert.equal(enabled(capture,context),false);assert.equal(enabled(merge,context),true);
 const f=await fixture(t);
 const result=await mergeSavedArchiveFiles(f);
 assert.deepEqual(result.periods,fresh.periods);
 assert.deepEqual(result.archives,[{...old,archived:true}]);
 assert.equal(f.requests(),1);
 await assert.rejects(fs.stat(f.staging),{code:'ENOENT'});
});

test('failed daily snapshot still merges locally without erasing saved archive history or publishing partial capture',async t=>{
 const context={github:{event_name:'schedule',event:{schedule:'30 10 * * *'}},steps:{catalog:{outcome:'success'},snapshot:{outcome:'failure'}}};
 assert.equal(enabled(capture,context),true);assert.equal(enabled(merge,context),true);
 const f=await fixture(t),frozen={...old,id:'staged-frozen',startsAt:2,endsAt:3};
 await assert.rejects((async()=>{
  await fs.mkdir(path.join(f.staging,'events'),{recursive:true});
  await fs.writeFile(path.join(f.staging,'events',frozen.id+'.json'),JSON.stringify({id:frozen.id,period:frozen,entries:[],archived:true}));
  throw Error('simulated snapshot capture failed');
 })(),/simulated snapshot capture failed/);
 const result=await mergeSavedArchiveFiles(f);
 assert.deepEqual(result.archives.map(row=>row.id),[frozen.id,old.id]);
 assert.deepEqual(result.periods,fresh.periods);assert.equal(f.requests(),1);
 // Keep GitHub's default success() gate: failed capture must not publish partial files.
 assert.equal(condition('Commit changed assignments'),undefined);
});

test('local history merge is gated by successful catalog sync and never runs after cancellation',()=>{
 assert.match(condition(merge),/^always\(\) && !cancelled\(\) && steps\.catalog\.outcome == 'success'$/);
 for(const outcome of ['failure','skipped','cancelled'])
  assert.equal(enabled(merge,{steps:{catalog:{outcome},snapshot:{outcome:'success'}}}),false);
 assert.equal(enabled(merge,{cancelled:()=>true,steps:{catalog:{outcome:'success'},snapshot:{outcome:'failure'}}}),false);
});
