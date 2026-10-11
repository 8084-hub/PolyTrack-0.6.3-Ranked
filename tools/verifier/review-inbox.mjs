export const REVIEW_COLLECTION = '0.6.2_s1_review_inbox';

export function reviewRecord(auditId, job, verdict, evidence) {
  if (!evidence && verdict.status !== 'mismatch') return null;
  return {
    auditId, accountId:job.accountId, trackId:job.trackId, resultId:job.resultId,
    timeMs:Number.isSafeInteger(job.timeMs)?job.timeMs:null,
    category:evidence?'input_similarity':'verification_mismatch',
    status:'open', detectedAt:Number.isFinite(verdict.checkedAt)?verdict.checkedAt:Date.now(), addedAt:Date.now(), verdict:verdict.status,
    reason:String(verdict.reason || '').slice(0,100),
    ...(evidence?.trackName ? {trackName:String(evidence.trackName).slice(0,100)} : {}),
    ...(evidence?{evidence}:{}),
    notice:'Needs manual review. This is not a cheating verdict.'
  };
}

// Keep the original finding and any administrator decision unchanged on retries.
export async function reviewInboxWrite(db, auditId, job, verdict, evidence) {
  const data=reviewRecord(auditId,job,verdict,evidence);
  if(!data) return null;
  const existing=await db.get(REVIEW_COLLECTION,auditId);
  return existing?null:db.write(REVIEW_COLLECTION,auditId,data,null);
}
