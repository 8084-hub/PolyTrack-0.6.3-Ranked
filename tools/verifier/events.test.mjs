import test from 'node:test';
import assert from 'node:assert/strict';
import { runEventCoordinator, EVENT_JOB_LIMIT } from './events.mjs';
import { createSimilarityReviewer } from './similarity.mjs';
import { VERIFIER_ENGINE_DIGEST, VERIFIER_VERSION } from '../../workers/ranked/src/verification.js';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function fixture(counts, inboxCount = 0, unavailable = false) {
  let intakes = 0, native = 0;
  const batches = [];
  const runtime = { service: {
    processBatch: async (period, verify, limit) => {
      assert(limit <= 4);
      const count = Math.min(counts[period], limit); counts[period] -= count;
      if (!count) return [];
      batches.push({ period, count });
      const jobs = Array.from({ length: count }, (_, i) => ({ resultId: `${period}_${counts[period]}_${i}` }));
      return verify(jobs, { id: period, kind: 'custom', trackId: 'a'.repeat(64) });
    }, archivePeriod: async () => assert.fail('unexpected archive')
  }};
  const options = { verifyBatch: async (_root, jobs) => { native += jobs.length; return jobs.map(j => ({ ...j, reason: unavailable ? 'engine_unavailable' : 'native_exact_finish' })); },
    consumeInbox: async () => ({ consumed: intakes++ < inboxCount ? 1 : 0 }),
    readWork: async () => ({ periodIds: Object.keys(counts), archiveId: null }) };
  return { runtime, options, batches, native: () => native, intakes: () => intakes };
}
test('one event period can consume sixteen jobs in four bounded native batches', async () => {
  const f = fixture({ daily: 100 });
  const result = await runEventCoordinator(f.runtime, '/repo', f.options);
  assert.equal(EVENT_JOB_LIMIT, 16); assert.equal(result.checked, 16);
  assert.equal(f.native(), 16); assert.deepEqual(f.batches.map(b => b.count), [4, 4, 4, 4]);
});
test('daily and weekly share one global sixteen-job budget', async () => {
  const f = fixture({ daily: 100, weekly: 100 });
  const result = await runEventCoordinator(f.runtime, '/repo', f.options);
  assert.equal(result.checked, 16); assert.equal(f.native(), 16);
  assert.deepEqual(f.batches.map(b => b.period), ['daily', 'weekly', 'daily', 'weekly']);
});
test('caller shared native remainder bounds event work exactly', async () => {
  for (const limit of [1, 4, 7, 12, 16]) {
    const f = fixture({ daily: 100, weekly: 100 });
    assert.equal((await runEventCoordinator(f.runtime, '/repo', { ...f.options, limit })).checked, limit);
    assert.equal(f.native(), limit);
  }
});
test('intake stops on empty and never reads more than sixteen receipts', async () => {
  for (const count of [0, 3, 16, 100]) {
    const f = fixture({}, count);
    const result = await runEventCoordinator(f.runtime, '/repo', f.options);
    assert.equal(result.consumed, Math.min(count, 16));
    assert.equal(f.intakes(), Math.min(count + 1, 16));
  }
});
test('invalid job and intake limits fail before any work', async () => {
  const f = fixture({ daily: 100 });
  for (const limit of [0, 17, 1.5]) await assert.rejects(runEventCoordinator(f.runtime, '/repo', { ...f.options, limit }), /limit/);
  await assert.rejects(runEventCoordinator(f.runtime, '/repo', { ...f.options, intakeLimit: 17 }), /limit/);
  assert.equal(f.intakes(), 0); assert.equal(f.native(), 0);
});
test('engine unavailable stops subsequent batches and preserves native reason', async () => {
  const f = fixture({ daily: 100, weekly: 100 }, 0, true);
  const result = await runEventCoordinator(f.runtime, '/repo', f.options);
  assert.equal(result.checked, 4); assert.equal(f.batches.length, 1);
  assert(result.results.every(r => r.reason === 'engine_unavailable'));
});
test('Kodub periods forward only the trusted period descriptor', async () => {
  const trackId = 'a'.repeat(64), codeHash = 'b'.repeat(64), code = 'PolyTrack2ABC';
  const period = { id: 'kodub_period', kind: 'kodub', trackId,
    kodub: { trackCode: code, trackCodeHash: codeHash } };
  const jobs = [{ resultId: 'kodub_result', trackId }];
  let calls = 0, invocation;
  const runtime = { service: {
    processBatch: async (_periodId, verify, limit) => {
      assert(limit <= 4);
      if (calls++) return [];
      return verify(jobs, period);
    },
    archivePeriod: async () => assert.fail('unexpected archive'),
  } };
  const result = await runEventCoordinator(runtime, '/repo', {
    consumeInbox: async () => ({ consumed: 0 }),
    readWork: async () => ({ periodIds: [period.id], archiveId: null }),
    verifyBatch: async (...args) => {
      invocation = args;
      return jobs.map(job => ({ ...job, reason: 'native_exact_finish' }));
    },
  });
  assert.equal(result.checked, 1);
  assert.deepEqual(invocation, ['/repo', jobs, [{ trackId, code, codeHash }]]);
});
test('Kodub periods reject mismatched leased job tracks before verification', async () => {
  const trackId = 'a'.repeat(64);
  const period = { id: 'kodub_period', kind: 'kodub', trackId,
    kodub: { trackCode: 'PolyTrack2ABC', trackCodeHash: 'b'.repeat(64) } };
  const runtime = { service: {
    processBatch: async (_periodId, verify) => verify([
      { resultId: 'kodub_result', trackId: 'c'.repeat(64) },
    ], period),
    archivePeriod: async () => assert.fail('unexpected archive'),
  } };
  await assert.rejects(runEventCoordinator(runtime, '/repo', {
    consumeInbox: async () => ({ consumed: 0 }),
    readWork: async () => ({ periodIds: [period.id], archiveId: null }),
    verifyBatch: async () => assert.fail('mismatched job must not reach verifier'),
  }), /Kodub verifier period mismatch/);
});

test('event exact-duplicate review runs on bound results before any event publication',async()=>{
  const trackId='a'.repeat(64), replayParts=[];
  const turns=Array.from({length:24},(_,i)=>100+i*200);
  const controls={lists:{up:[0],right:turns,down:[],left:[],reset:[]}};
  for(const list of Object.values(controls.lists)){
    const bytes=Buffer.alloc(3+list.length*3);bytes.writeUIntLE(list.length,0,3);
    list.forEach((tick,i)=>bytes.writeUIntLE(tick-(i?list[i-1]:0),3+i*3,3));replayParts.push(bytes);
  }
  const replay=deflateSync(Buffer.concat(replayParts)).toString('base64url');
  const replayHash=createHash('sha256').update(replay).digest('hex');
  const jobs=[
    {runId:'run-later',resultId:'run-later',accountId:'b'.repeat(64),trackId,timeMs:6000,replay,replayHash,receivedAt:200},
    {runId:'run-earlier',resultId:'run-earlier',accountId:'c'.repeat(64),trackId,timeMs:6000,replay,replayHash,receivedAt:100},
  ];
  const period={id:'daily',kind:'daily',trackId};
  const nativeResults=jobs.map(job=>({resultId:job.runId,status:'verified',trackId,timeMs:job.timeMs,replayHash,
    engineDigest:VERIFIER_ENGINE_DIGEST,trackContentHash:null,
    binding:{verifierVersion:VERIFIER_VERSION,resultId:job.runId,trackId,nativeTrackId:trackId,timeMs:job.timeMs,
      replayHash,actualReplayHash:replayHash,trackContentHash:null,engineDigest:VERIFIER_ENGINE_DIGEST}}));
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'event-similarity-'));
  try{
    const reviewer=createSimilarityReviewer(root);let publishedResults,publicationComplete=false;const findings=[];
    const runtime={service:{processBatch:async(_period,verify)=>{
      publishedResults=await verify(jobs,period);
      publicationComplete=true;
      return publishedResults.map(row=>({...row}));
    },archivePeriod:async()=>assert.fail('unexpected archive')}};
    const result=await runEventCoordinator(runtime,root,{limit:2,consumeInbox:async()=>({consumed:0}),
      readWork:async()=>({periodIds:['daily'],archiveId:null}),verifyBatch:async()=>nativeResults,
      reviewSimilarity:reviewer,writeFinding:async(...args)=>{
        assert.equal(publicationComplete,true,'finding write must follow publication');findings.push(args);return true;
      }});
    assert.equal(result.checked,2);
    assert.equal(publishedResults[0].status,'mismatch');
    assert.equal(publishedResults[0].reason,'exact_duplicate_run');
    assert.equal(publishedResults[1].status,'verified','earliest trusted event receipt remains the winner');
    assert.equal(findings.length,1,'only the published exact duplicate is recorded');
    assert.equal(findings[0][1].runId,'run-later');assert.equal(findings[0][2].reason,'exact_duplicate_run');
    assert.equal(result.eventFindingsAdded,1);assert.equal(result.eventFindingWriteFailed,0);

    let mismatchedWrites=0;
    const mismatchedRuntime={service:{processBatch:async(_period,verify)=>{
      const rows=await verify(jobs,period);return rows.map((row,index)=>index===0?{...row,reason:'publication_reason_changed'}:{...row});
    },archivePeriod:async()=>assert.fail('unexpected archive')}};
    await runEventCoordinator(mismatchedRuntime,root,{limit:2,consumeInbox:async()=>({consumed:0}),
      readWork:async()=>({periodIds:['daily'],archiveId:null}),verifyBatch:async()=>nativeResults,
      reviewSimilarity:createSimilarityReviewer(root),writeFinding:async()=>{mismatchedWrites++;return true;}});
    assert.equal(mismatchedWrites,0,'unmatched publication results never create findings');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('event similarity guard lets sparse unavailable results defer without native proof fields',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'event-unavailable-'));
  try{
    const job={runId:'unavailable-run',resultId:'unavailable-run'};
    const runtime={service:{processBatch:async(_period,verify)=>verify([job],{id:'daily',kind:'daily'}),archivePeriod:async()=>assert.fail('unexpected archive')}};
    const result=await runEventCoordinator(runtime,root,{limit:1,consumeInbox:async()=>({consumed:0}),
      readWork:async()=>({periodIds:['daily'],archiveId:null}),verifyBatch:async()=>[{resultId:job.runId,status:'unavailable',reason:'engine_unavailable'}],
      reviewSimilarity:createSimilarityReviewer(root)});
    assert.equal(result.checked,1);
    assert.equal(result.results[0].reason,'engine_unavailable');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('intake alternates retry priority even under sustained fresh traffic', async () => {
  const f = fixture({}, 100), priorities = [];
  await runEventCoordinator(f.runtime, '/repo', { ...f.options,
    consumeInbox: async (_runtime, { preferRetry }) => { priorities.push(preferRetry); return { consumed: 1 }; } });
  assert.deepEqual(priorities, Array.from({ length: 16 }, (_, i) => i % 2 === 0));
});

test('budget exhaustion defers event work before any lease or discovery read',async()=>{
  const f=fixture({daily:10},100);
  f.options.readWork=async()=>assert.fail('discovery must be deferred');
  const result=await runEventCoordinator(f.runtime,'/repo',{...f.options,canSpend:()=>false});
  assert.equal(result.budgetDeferred,true);assert.equal(result.checked,0);assert.equal(result.archived,null);
  assert.equal(f.intakes(),0);assert.equal(f.native(),0);
});

test('sustained intake preserves request allowance for a leased event batch',async()=>{
  let remaining=400,intakes=0,batches=0;
  const runtime={service:{processBatch:async(_period,_verify,limit)=>{
    assert.ok(remaining>=136,'must reserve completion plus four possible findings before lease');remaining-=128;batches++;
    return Array.from({length:limit},()=>({reason:'native_exact_finish'}));
  },archivePeriod:async()=>assert.fail('archive must be deferred')}};
  const result=await runEventCoordinator(runtime,'/repo',{limit:4,canSpend:n=>n<=remaining,
    consumeInbox:async()=>{remaining-=48;intakes++;return {consumed:1};},
    readWork:async()=>{remaining-=24;return {periodIds:['daily'],archiveId:'old'};},
    verifyBatch:async()=>assert.fail('fixture batch simulates native accounting')});
  assert.equal(intakes,5);assert.equal(batches,1);assert.equal(result.checked,4);
  assert.equal(result.archived,null);assert.equal(result.budgetDeferred,true);assert.equal(remaining,8);
});

test('insufficient completion reserve never leases another event batch',async()=>{
  const f=fixture({daily:20});let remaining=127;
  const result=await runEventCoordinator(f.runtime,'/repo',{...f.options,canSpend:n=>n<=remaining});
  assert.equal(f.native(),0);assert.equal(f.batches.length,0);assert.equal(result.budgetDeferred,true);
});

test('four-slot Catch-Up rounds rotate sustained periods even when discovery clock order is unchanged', async () => {
  const f = fixture({daily: 100, weekly: 100, older: 100});
  const selectionState = {};
  for (let i = 0; i < 12; i++) {
    const result = await runEventCoordinator(f.runtime, '/repo', {...f.options, limit: 4, selectionState});
    assert.equal(result.checked, 4);
  }
  assert.deepEqual(f.batches.map(batch => batch.period), Array.from({length: 4}, () => ['daily', 'weekly', 'older']).flat());
  assert.equal(f.intakes(), 12, 'No additional intake or discovery polling');
});

test('deferred event budgets do not advance the in-memory period cursor', async () => {
  const f = fixture({daily: 100, weekly: 100});
  const selectionState = {lastPeriodId: 'daily'};
  await runEventCoordinator(f.runtime, '/repo', {...f.options, limit: 4, selectionState, canSpend: () => false});
  assert.deepEqual(selectionState, {lastPeriodId: 'daily'});
  const result = await runEventCoordinator(f.runtime, '/repo', {...f.options, limit: 4, selectionState});
  assert.equal(result.checked, 4);
  assert.equal(f.batches[0].period, 'weekly');
});


test('aborted intake defers only event work without adding immediate retries',async()=>{
 const f=fixture({daily:10});let calls=0;
 const options={...f.options,consumeInbox:async()=>{if(calls++===0)return {consumed:1,rejected:false};throw Object.assign(Error('Firestore request failed: 409'),{status:409,code:'ABORTED'});},readWork:async()=>assert.fail('no more event reads after contention')};
 const result=await runEventCoordinator(f.runtime,'/repo',options);
 assert.equal(result.consumed,1);assert.equal(result.checked,0);assert.equal(result.conflictDeferred,true);assert.equal(result.budgetDeferred,true);assert.equal(f.native(),0);assert.equal(calls,2);
});

test('event intake never hides permission failures or ambiguous write outcomes',async()=>{
 for(const failure of [Object.assign(Error('denied'),{status:403,code:'PERMISSION_DENIED'}),Object.assign(Error('unavailable'),{status:503}),Error('timeout')]){
  const f=fixture({daily:10});await assert.rejects(runEventCoordinator(f.runtime,'/repo',{...f.options,consumeInbox:async()=>{throw failure;}}),e=>e===failure);
 }
});
