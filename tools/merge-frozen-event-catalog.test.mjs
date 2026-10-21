import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeFrozenEventCatalog} from './merge-frozen-event-catalog.mjs';
const period={id:'kodub_2000',kind:'kodub',trackId:'a'.repeat(64),startsAt:1000,endsAt:2000,maxRp:700,trackName:'Missing weekly'};
test('saved frozen boards recover periods missing from the recent catalog, newest first',()=>{
 const catalog={periods:[{...period,id:'current'}],archives:[{...period,id:'old',endsAt:1500}]};
 const result=mergeFrozenEventCatalog(catalog,[{id:period.id,period,archived:true,entries:[]}]);
 assert.deepEqual(result.archives.map(row=>row.id),[period.id,'old']);assert.equal(result.periods,catalog.periods);assert.equal(catalog.archives.length,1);
});
test('live, mismatched and malformed boards never become frozen archive periods',()=>{
 const result=mergeFrozenEventCatalog({periods:[],archives:[]},[{period,archived:false,entries:[]},{id:'wrong',period,archived:true,entries:[]},{period:{...period,trackId:'bad'},archived:true,entries:[]}]);
 assert.equal(result.archives.length,0);
});
test('archive metadata is idempotent and excludes non-public board fields',()=>{
 const result=mergeFrozenEventCatalog({periods:[],archives:[]},[{period:{...period,privateNotes:'secret'},archived:true,entries:[]}]);
 assert.equal(result.archives[0].privateNotes,undefined);assert.deepEqual(mergeFrozenEventCatalog(result,[]),result);
});
