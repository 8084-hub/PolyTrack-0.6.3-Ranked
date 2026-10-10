import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewInboxWrite,REVIEW_COLLECTION} from './review-inbox.mjs';
test('ordinary verified and unavailable runs never read or write the inbox',async()=>{
  const db={get:()=>{throw Error('unexpected read');}};
  for(const status of ['verified','unavailable'])assert.equal(await reviewInboxWrite(db,'id',{}, {status}),null);
});
test('flagged finding is separate and resolved decisions survive retries',async()=>{
  const db={get:async()=>null,write:(collection,id,data)=>({collection,id,data})};
  const write=await reviewInboxWrite(db,'id',{accountId:'racer',trackId:'track',resultId:'run',timeMs:123},{status:'mismatch',reason:'finish_mismatch'});
  assert.equal(write.collection,REVIEW_COLLECTION);assert.equal(write.data.status,'open');
  assert.equal(write.data.category,'verification_mismatch');
  assert.equal(await reviewInboxWrite({...db,get:async()=>({data:{status:'resolved'}})},'id',{}, {status:'mismatch'}),null);
});
