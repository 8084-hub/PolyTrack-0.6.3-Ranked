import test from 'node:test';
import assert from 'node:assert/strict';
import {compareControls,createSimilarityReviewer,similarityEvidence} from './similarity.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {encodeSnapshot} from '../snapshot-package.mjs';
import {publishResults} from './runner.mjs';
import {verificationKey,VERIFICATION_COLLECTION,VERIFIER_ENGINE_DIGEST,VERIFIER_VERSION} from '../../workers/ranked/src/verification.js';
const turns=Array.from({length:24},(_,i)=>100+i*200);
const controls={lists:{up:[0],right:turns,down:[],left:[],reset:[]}};
test('complex exact inputs create advisory evidence',()=>{
  assert.equal(compareControls(controls,controls,6000,6000).inputSimilarity,1);
});
test('holding forward and short scripts are not clone evidence',()=>{
  assert.equal(compareControls({lists:{up:[0],right:[],down:[],left:[],reset:[]}}, {lists:{up:[0],right:[],down:[],left:[],reset:[]}},6000,6000),null);
});
test('different timings and mismatched lengths do not qualify',()=>{
  assert.equal(compareControls(controls,{lists:{up:[0],right:turns.map(t=>t+1),down:[],left:[],reset:[]}},6000,6000),null);
  assert.equal(compareControls(controls,controls,6000,9000),null);
});
test('client-provided evidence cannot become server review evidence',()=>{
  assert.equal(similarityEvidence({reviewEvidence:{kind:'similar_top_inputs'}}),undefined);
});
test('missing snapshot cannot interrupt physics verification',async()=>{
  const results=[{status:'verified',resultId:'x'}];
  assert.equal(await createSimilarityReviewer('/missing-snapshot')([{resultId:'x',trackId:'a'.repeat(64),replay:'bad',timeMs:6000}],results),results);
});
test('real decoded snapshot references flag other racers, never self',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'similarity-'));
  try {
    const parts=[];
    for(const list of Object.values(controls.lists)) {
      const bytes=Buffer.alloc(3+list.length*3);bytes.writeUIntLE(list.length,0,3);
      list.forEach((tick,i)=>bytes.writeUIntLE(tick-(i?list[i-1]:0),3+i*3,3));parts.push(bytes);
    }
    const replay=deflateSync(Buffer.concat(parts)).toString('base64url');
    const hash=createHash('sha256').update(replay).digest('hex'),trackId='a'.repeat(64),accountId='b'.repeat(64);
    const dir=path.join(root,'public-snapshots1');await fs.mkdir(dir);
    const files={};
    for(const [logical,data] of Object.entries({[`tracks/${trackId}.json`]:{updatedAt:123,entries:[{id:1,accountId,rank:1,timeMs:6000,replayHash:hash,runVerified:true,integrityVerified:true}]},'recordings/1.json':{trackId,accountId,recording:replay,replayHash:hash}})) {
      const bytes=await encodeSnapshot(data),sha256=createHash('sha256').update(bytes).digest('hex');
      files[logical]={path:sha256+'.bin',sha256};await fs.writeFile(path.join(dir,sha256+'.bin'),bytes);
    }
    await fs.writeFile(path.join(dir,'index.json'),JSON.stringify({files}));
    await fs.writeFile(path.join(root,'snapshot-current.json'),JSON.stringify({currentdir:'public-snapshots1'}));
    const reviewer=createSimilarityReviewer(root);
    const result={resultId:'x',status:'verified'};
    await reviewer([{resultId:'x',accountId:'c'.repeat(64),trackId,timeMs:6000,replay}], [result]);
    assert.equal(similarityEvidence(result).referenceAccountId,accountId);
    const row={accountId:'c'.repeat(64),trackId,timeMs:6000,frames:6000,raceTimeFrames:6000,uploadId:2,replay,replayHash:hash};
    const job={...row,resultId:'x',queueKey:verificationKey(row),queueCollection:VERIFICATION_COLLECTION};
    Object.assign(result,{engineDigest:VERIFIER_ENGINE_DIGEST,verifierVersion:VERIFIER_VERSION,reason:'native_exact_finish'});
    let reads=0,writes;
    const db={get:async(collection)=>{reads++;return collection===VERIFICATION_COLLECTION?{data:{slots:{[row.accountId]:{accountId:row.accountId,key:job.queueKey,status:'waiting'}}}}:collection==='0.6.2_race_results'?{data:row}:null;},
      write:(collection,id,data)=>({collection,id,data}),call:async(_,{writes:batch})=>{writes=batch;return {};}};
    const totals=await publishResults(db,[job],[result]);
    assert.equal(reads,4,'existing queue, canonical, reconciliation, and audit reads only');
    assert.equal(writes.length,3,'review evidence shares the existing atomic audit write');
    assert.equal(writes.find(w=>w.collection==='0.6.2_s1_verification_audit').data.needsReview,true);
    assert.equal(totals.reviewFlagged,1);
    const self={resultId:'self',status:'verified'};
    await reviewer([{resultId:'self',accountId,trackId,timeMs:6000,replay}],[self]);
    assert.equal(similarityEvidence(self),undefined);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
