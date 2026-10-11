import { createRequire } from 'node:module';
import { eventRuntime, eventWork, consumeEventInbox } from '../../workers/ranked/src/events-runtime.js';
import { VERIFIER_ENGINE_DIGEST, VERIFIER_VERSION } from '../../workers/ranked/src/verification.js';
import { createSimilarityReviewer } from './similarity.mjs';

export const EVENT_JOB_LIMIT = 16;
function runtime(db, now = Date.now) {
  if (typeof db?.call !== 'function') throw Error('Event Firestore connection required');
  return eventRuntime((path, init) => db.call(path, init?.body ? JSON.parse(init.body) : undefined), { now });
}
export async function checkEventWork(db, { now = Date.now } = {}) {
  return eventWork(runtime(db, typeof now === 'function' ? now : () => now));
}
export async function runEventVerification(db, root, { now = Date.now, verifyBatch, limit = EVENT_JOB_LIMIT, intakeLimit = 16, canSpend = () => true, selectionState } = {}) {
  const r = runtime(db, typeof now === 'function' ? now : () => now);
  const verify = verifyBatch || createRequire(import.meta.url)('./verify.cjs').verifyBatch;
  return runEventCoordinator(r, root, { verifyBatch: verify, reviewSimilarity:createSimilarityReviewer(root), limit, intakeLimit, canSpend, selectionState });
}
export async function runEventCoordinator(r, root, { verifyBatch, limit = EVENT_JOB_LIMIT, intakeLimit = 16,
  consumeInbox = consumeEventInbox, readWork = eventWork, canSpend = () => true, selectionState, reviewSimilarity } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > EVENT_JOB_LIMIT) throw Error('Event job limit');
  if (!Number.isInteger(intakeLimit) || intakeLimit < 1 || intakeLimit > 16) throw Error('Event intake limit');
  let consumed = 0, rejected = false, budgetDeferred = false;
  for (let i = 0; i < intakeLimit; i++) {
    // Two bounded intake transactions plus discovery and one leased batch must fit.
    if (!canSpend(48 + 24 + 128)) { budgetDeferred = true; break; }
    const intake = await consumeInbox(r, { preferRetry: i % 2 === 0 });
    consumed += intake.consumed;
    rejected ||= intake.rejected === true;
    if (!intake.consumed) break;
  }
  if (!canSpend(24)) return {checked:0,consumed,rejected,archived:null,results:[],budgetDeferred:true};
  const work = await readWork(r);
  let checked = 0;
  const results = [];
  const pending = [...work.periodIds];
  // The clock-based discovery rotation may not change during a whole Catch-Up.
  // Continue after the last served period without another read or persisted cursor.
  const lastIndex = pending.indexOf(selectionState?.lastPeriodId);
  if (lastIndex >= 0) pending.push(...pending.splice(0, lastIndex + 1));
  while (pending.length && checked < limit) {
    // Reserve before leasing: one lease and up to four completion transactions.
    // Existing adapter has no retries; each transaction uses at most sixteen reads.
    if (!canSpend(128)) { budgetDeferred = true; break; }
    const periodId = pending.shift();
    const published = await r.service.processBatch(periodId, (jobs,period)=>{
        const verifyAndReview = async (trustedJobs, trustedPeriod, trustedTracks) => {
          const verified = await verifyBatch(root,trustedJobs,trustedTracks);
          if (reviewSimilarity) {
            assertBoundEventResults(trustedJobs,trustedPeriod,verified);
            await reviewSimilarity(trustedJobs,verified);
          }
          return verified;
        };
        if(period.kind!=='kodub')return verifyAndReview(jobs,period);
        if(!jobs.every(job=>job.trackId===period.trackId))throw Error('Kodub verifier period mismatch');
        return verifyAndReview(jobs,period,[{trackId:period.trackId,code:period.kodub.trackCode,codeHash:period.kodub.trackCodeHash}]);
      }, Math.min(4, limit - checked));
    checked += published.length; results.push(...published);
    if (published.length && selectionState) selectionState.lastPeriodId = periodId;
    if (published.some(result => result.reason === 'engine_unavailable')) break;
    if (published.length) pending.push(periodId);
  }
  let archived = null;
  if (work.archiveId && canSpend(24)) { await r.service.archivePeriod(work.archiveId); archived = work.archiveId; }
  else if (work.archiveId) budgetDeferred = true;
  return { checked, consumed, rejected, archived, results, budgetDeferred };
}

function assertBoundEventResults(jobs,period,results) {
  if(!Array.isArray(results)||results.length!==jobs.length||new Set(results.map(row=>row?.resultId)).size!==jobs.length)throw Error('Invalid event verifier result set');
  const seen=new Set();
  for(const job of jobs){
    const resultId=job.runId||job.resultId;
    const result=results.find(row=>row?.resultId===resultId);
    if(!result||seen.has(resultId)||!['verified','mismatch','unavailable'].includes(result.status))throw Error('Invalid event verifier result binding');
    seen.add(resultId);
    if(result.status==='unavailable')continue;
    if(result.trackId!==job.trackId||result.timeMs!==job.timeMs||result.replayHash!==job.replayHash)throw Error('Invalid event verifier result binding');
    const binding=result.binding;
    if(result.engineDigest!==VERIFIER_ENGINE_DIGEST||binding?.engineDigest!==VERIFIER_ENGINE_DIGEST||
      binding.verifierVersion!==VERIFIER_VERSION||binding.resultId!==resultId||binding.trackId!==job.trackId||
      binding.nativeTrackId!==job.trackId||binding.timeMs!==job.timeMs||binding.replayHash!==job.replayHash||
      binding.actualReplayHash!==job.replayHash||binding.trackContentHash!==result.trackContentHash||
      period.kind==='kodub'&&binding.trackContentHash!==period.kodub?.trackCodeHash)throw Error('Invalid event verifier proof');
  }
}
