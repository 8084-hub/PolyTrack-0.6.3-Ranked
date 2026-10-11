import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {decodeSnapshot} from '../snapshot-package.mjs';
const {decodeReplay, sha256} = createRequire(import.meta.url)('./replay.cjs');
const evidenceByResult = new WeakMap();
export const similarityEvidence = result => evidenceByResult.get(result);

// Review evidence only: shared routes and practiced inputs are not proof of TAS.
export function compareControls(a, b, durationA, durationB) {
  const channels = controls => ['up','right','down','left','reset'].map(name => controls.lists[name]);
  a = {lists:channels(a)};
  b = {lists:channels(b)};
  const duration = Math.min(durationA, durationB);
  if (duration / Math.max(durationA, durationB) < .9) return null;
  const transitions = lists => lists.flatMap((list, channel) => list.filter(t => t <= duration).map(t => `${channel}:${t}`));
  const left = transitions(a.lists), right = transitions(b.lists);
  if (left.length < 20 || right.length < 20) return null;
  const rightSet = new Set(right);
  const transitionSimilarity = 2 * left.filter(t => rightSet.has(t)).length / (left.length + right.length);
  if (transitionSimilarity < .95) return null;
  const edges = [...new Set([0, duration, ...a.lists.flat(), ...b.lists.flat()].filter(t => t <= duration))].sort((x,y) => x-y);
  const positionsA = [0,0,0,0,0], positionsB = [0,0,0,0,0];
  let informativeMs = 0, matchedMs = 0;
  for (let i=0;i<edges.length-1;i++) {
    let stateA=0, stateB=0;
    for (let c=0;c<5;c++) {
      while (a.lists[c][positionsA[c]] <= edges[i]) positionsA[c]++;
      while (b.lists[c][positionsB[c]] <= edges[i]) positionsB[c]++;
      stateA |= (positionsA[c] % 2) << c;
      stateB |= (positionsB[c] % 2) << c;
    }
    // Ignore coasting/holding forward; otherwise simple tracks look cloned.
    if ((stateA | stateB) & 30) {
      const ms=edges[i+1]-edges[i]; informativeMs+=ms;
      if (stateA===stateB) matchedMs+=ms;
    }
  }
  if (informativeMs < 1000 || matchedMs/informativeMs < .95) return null;
  return {inputSimilarity: Number((matchedMs/informativeMs).toFixed(4)), transitionSimilarity: Number(transitionSimilarity.toFixed(4)), informativeMs};
}

export function createSimilarityReviewer(root) {
  let packagePromise;
  const boards = new Map();
  async function snapshotPackage() {
    const pointer=JSON.parse(await fs.readFile(path.join(root,'snapshot-current.json'),'utf8'));
    if (!/^public-snapshots\d+$/.test(pointer.currentdir)) throw Error('Invalid snapshot directory');
    const dir=path.join(root,pointer.currentdir);
    const index=JSON.parse(await fs.readFile(path.join(dir,'index.json'),'utf8'));
    async function read(logical) {
      const item=index.files[logical];
      if (!item || !/^[a-f0-9]{64}\.bin$/.test(item.path)) return null;
      const bytes=await fs.readFile(path.join(dir,item.path));
      if (bytes.length>2*1024*1024 || createHash('sha256').update(bytes).digest('hex')!==item.sha256) throw Error('Invalid reference snapshot');
      return JSON.parse(Buffer.from(await decodeSnapshot(bytes)).toString('utf8'));
    }
    return {read, generation:pointer.currentdir};
  }
  async function references(trackId) {
    if (!boards.has(trackId)) {
      if(boards.size>=16) boards.delete(boards.keys().next().value);
      boards.set(trackId,(async()=>{
        const pkg=await (packagePromise ||= snapshotPackage());
        const board=await pkg.read(`tracks/${trackId}.json`);
        const entries=(board?.entries || []).filter(e=>e.runVerified===true && e.integrityVerified===true && /^[a-f0-9]{64}$/.test(e.accountId || '') && Number.isSafeInteger(e.timeMs) && e.timeMs>0).sort((a,b)=>a.timeMs-b.timeMs).slice(0,10);
        const refs=[];
        for(const entry of entries) {
          try {
            const recording=await pkg.read(`recordings/${entry.id}.json`);
            if(!recording || recording.trackId!==trackId || recording.accountId!==entry.accountId || recording.replayHash!==entry.replayHash || sha256(recording.recording)!==entry.replayHash) continue;
            refs.push({...entry, controls:decodeReplay(recording.recording,entry.timeMs), generation:pkg.generation, boardUpdatedAt:board.updatedAt});
          } catch { /* Missing/oversized historical recordings are not evidence. */ }
        }
        return refs;
      })().catch(()=>[]));
    }
    return boards.get(trackId);
  }
  return async function review(jobs, results) {
    for (const result of results) {
      evidenceByResult.delete(result);
      if(result.status!=='verified') continue;
      const job=jobs.find(j=>j.resultId===result.resultId);
      if(!job || !/^[a-f0-9]{64}$/.test(job.trackId)) continue;
      try {
        const own=decodeReplay(job.replay,job.timeMs);
        for(const ref of await references(job.trackId)) {
          if(ref.accountId===job.accountId) continue;
          const evidence=compareControls(own,ref.controls,job.timeMs,ref.timeMs);
          if(evidence) {
            evidenceByResult.set(result,{kind:'similar_top_inputs', version:1, ...evidence, finishGapMs:Math.abs(job.timeMs-ref.timeMs), referenceAccountId:ref.accountId, referenceReplayHash:ref.replayHash, referenceRank:Number.isSafeInteger(ref.rank)?ref.rank:null, referenceSnapshot:ref.generation, referenceUpdatedAt:Number.isFinite(ref.boardUpdatedAt)?ref.boardUpdatedAt:null});
            break;
          }
        }
      } catch { /* An optional review must never change physics verification. */ }
    }
    return results;
  };
}
