import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateServerAchievements,
  BEAT_OWNER_STAGES,
  casualRpForPlacement,
  OWNER_PUBLIC_ID,
  SPECIAL_ROLLING_HILLS_TRACK_ID
} from '../src/server-achievements.js';
import {computeTrackEntries} from '../src/index.js';
import {VERIFIER_ENGINE_DIGEST, VERIFIER_VERSION, verificationKey} from '../src/verification.js';

const OFFICIAL = '5803f9e963625804e3de3246d043dc7dde847aa32e991f7f7326b0453f1fa038';
const OTHER_OFFICIAL = '7eac4fee1111152cfba4d3737410264ca0f22c7f5a2211e79f0099589b8b48c0';
const CATALOG = [OFFICIAL, OTHER_OFFICIAL, SPECIAL_ROLLING_HILLS_TRACK_ID];

function board(trackId, entries, revision = 7) {
  return { trackId, entries, revision, sourceRevision: revision, updatedAt: 1780000000000 + revision,
    signature: `${trackId.slice(0, 20)}_verified_snapshot`, complete: true };
}

function run(accountId, timeMs, extra = {}) {
  return { accountId, timeMs, pbAt: 1770000000000, integrityVerified: true, runVerified: true, ...extra };
}

test('server aggregation rejects integrity-only rows from every authoritative metric', () => {
  const result = aggregateServerAchievements([{userId: 'racer'}], [board(OFFICIAL, [
    run(OWNER_PUBLIC_ID, 22000),
    run('racer', 21000, {runVerified: false}),
    run('verified', 21500)
  ])], new Map(), {eligibleTrackIds: CATALOG, beatOwnerTrackIds: CATALOG, now: 1800000000000});
  const racer = result.entries[0];
  assert.equal(racer.casualRp, 0);
  assert.equal(racer.serverAchievements.beatOwner.count, 0);
  assert.deepEqual(racer.cosmeticUnlocks, []);
  assert.equal(result.audit.integrityOnlyRejected, 1);
  assert.equal(result.audit.physicsVerifiedEntries, 2);
});

test('verified owner beats issue staged cosmetics with immutable snapshot evidence', () => {
  const first = aggregateServerAchievements([{userId: 'racer'}], [
    board(OFFICIAL, [run(OWNER_PUBLIC_ID, 22000), run('racer', 21000)]),
    board(OTHER_OFFICIAL, [run(OWNER_PUBLIC_ID, 23000), run('racer', 22000)]),
    board(SPECIAL_ROLLING_HILLS_TRACK_ID, [run(OWNER_PUBLIC_ID, 24000), run('racer', 23000)])
  ], new Map(), {eligibleTrackIds: CATALOG, beatOwnerTrackIds: CATALOG, now: 1800000000000});
  const earned = first.entries[0];
  assert.equal(earned.serverAchievements.beatOwner.count, 3);
  assert.deepEqual(earned.cosmeticUnlocks, BEAT_OWNER_STAGES.slice(0, 2).map(stage => stage.cosmeticId));
  assert.equal(earned.serverAchievements.beatOwner.unlocks[0].source, 'ranked-track-snapshot');
  assert.equal(earned.serverAchievements.beatOwner.unlocks[0].sourceRevision, 7);
  assert.equal(earned.serverAchievements.beatOwner.unlocks[0].unlockedAt, 1800000000000);

  const prior = new Map([['racer', earned]]);
  const later = aggregateServerAchievements([{userId: 'racer'}], [
    board(OFFICIAL, [run(OWNER_PUBLIC_ID, 20000), run('racer', 21000)], 9)
  ], prior, {eligibleTrackIds: CATALOG, beatOwnerTrackIds: CATALOG, now: 1900000000000}).entries[0];
  assert.equal(later.serverAchievements.beatOwner.count, 3);
  assert.deepEqual(later.serverAchievements.beatOwner.unlocks, earned.serverAchievements.beatOwner.unlocks);
});

test('Casual completions are once per recognized verified track and legacy ledgers do not fabricate RP', () => {
  const first = aggregateServerAchievements([{userId: 'racer'}], [
    board(OFFICIAL, [run('racer', 21000), run('racer', 22000)]),
    board(OTHER_OFFICIAL, [run('racer', 23000)]),
    board('f'.repeat(64), [run('racer', 19000)])
  ], new Map(), {
    eligibleTrackIds: CATALOG, beatOwnerTrackIds: CATALOG, now: 1800000000000
  }).entries[0];
  assert.equal(first.casualCompletionCount, 2);
  assert.equal(first.casualRp, 20);
  assert.equal(first.serverAchievements.casual.rp, 20);
  assert.equal(first.serverAchievements.casual.scoringVersion, 1);
  assert.equal('pointsPerTrack' in first.serverAchievements.casual, false);

  const later = aggregateServerAchievements([{userId: 'racer'}], [], new Map([['racer', first]]), {
    eligibleTrackIds: CATALOG, beatOwnerTrackIds: CATALOG, now: 1900000000000
  }).entries[0];
  assert.equal(later.casualCompletionCount, 2);
  assert.equal(later.casualRp, null, 'a legacy completion ledger must not be converted into placement points');
  assert.equal(later.serverAchievements.casual.ledger, first.serverAchievements.casual.ledger);

  const legacyPositive = aggregateServerAchievements([{userId: 'racer'}], [
    board(OFFICIAL, [run('racer', 21000)])
  ], new Map([['racer', {casualRp: 999999}]]), {
    eligibleTrackIds: CATALOG, beatOwnerTrackIds: [], now: 1900000000000
  }).entries[0];
  assert.equal(legacyPositive.casualRp, null, 'an old aggregate without placement evidence remains unknown');
  assert.equal(legacyPositive.serverAchievements.casual.scoringVersion, 1);
});

test('Casual RP uses a bounded placement percentile and allows rival-driven decreases', () => {
  assert.equal(casualRpForPlacement(1, 3), 100);
  assert.equal(casualRpForPlacement(2, 3), 55);
  assert.equal(casualRpForPlacement(3, 3), 10);
  assert.equal(casualRpForPlacement(1, 1), 10);
  assert.equal(casualRpForPlacement(0, 3), null);
  assert.equal(casualRpForPlacement(4, 3), null);

  const initial = aggregateServerAchievements([{userId: 'racer'}], [board(OFFICIAL, [
    run('racer', 21000), run('rival', 22000), run('third', 23000)
  ])], new Map(), {eligibleTrackIds: CATALOG, beatOwnerTrackIds: [], now: 1800000000000}).entries[0];
  const rivalImproved = aggregateServerAchievements([{userId: 'racer'}], [board(OFFICIAL, [
    run('rival', 20000), run('racer', 21000), run('third', 23000)
  ])], new Map(), {eligibleTrackIds: CATALOG, beatOwnerTrackIds: [], now: 1800000000000}).entries[0];
  const racerImproved = aggregateServerAchievements([{userId: 'racer'}], [board(OFFICIAL, [
    run('racer', 19000), run('rival', 20000), run('third', 23000)
  ])], new Map(), {eligibleTrackIds: CATALOG, beatOwnerTrackIds: [], now: 1800000000000}).entries[0];
  assert.equal(initial.casualRp, 100);
  assert.equal(rivalImproved.casualRp, 55);
  assert.equal(racerImproved.casualRp, 100);
  assert.ok(racerImproved.casualRp > rivalImproved.casualRp);
});

test('a slower personal attempt cannot replace the PB used for Casual RP', () => {
  const canonicalRun = (accountId, timeMs, uploadId) => ({accountId, trackId: OFFICIAL, timeMs,
    raceTimeFrames: timeMs, frames: timeMs, replay: 'fixture-replay', replayHash: 'a'.repeat(64),
    uploadId, integrityVerified: true});
  const faster = canonicalRun('racer', 21000, 1);
  const allRuns = [faster, canonicalRun('racer', 25000, 2), canonicalRun('rival', 22000, 3)];
  const verdicts = Object.fromEntries([faster, allRuns[2]].map(row => [row.accountId, {
    key: verificationKey(row), status: 'verified', verifierVersion: VERIFIER_VERSION, engineDigest: VERIFIER_ENGINE_DIGEST
  }]));
  const entries = computeTrackEntries(allRuns, OFFICIAL, {}, verdicts);
  const awarded = aggregateServerAchievements([{userId: 'racer'}], [board(OFFICIAL, entries)], new Map(), {
    eligibleTrackIds: CATALOG, beatOwnerTrackIds: []
  }).entries[0];
  assert.equal(entries.filter(row => row.accountId === 'racer').length, 1);
  assert.equal(entries.find(row => row.accountId === 'racer').timeMs, 21000);
  assert.equal(awarded.casualRp, 100);
});

test('incomplete track snapshots leave placement-based Casual RP unknown', () => {
  const incomplete = {...board(OFFICIAL, [run('racer', 21000), run('rival', 22000)]), complete: false};
  const entry = aggregateServerAchievements([{userId: 'racer'}], [incomplete], new Map(), {
    eligibleTrackIds: CATALOG, beatOwnerTrackIds: []
  }).entries[0];
  assert.equal(entry.casualCompletionCount, 1);
  assert.equal(entry.casualRp, null);
});

test('owner achievements require an immutable current snapshot source', () => {
  const incompleteSource = board(OFFICIAL, [run(OWNER_PUBLIC_ID, 22000), run('racer', 21000)]);
  incompleteSource.signature = '';
  const entry = aggregateServerAchievements([{userId: 'racer'}], [incompleteSource], new Map(), {
    eligibleTrackIds: CATALOG, beatOwnerTrackIds: CATALOG, now: 1800000000000
  }).entries[0];
  assert.equal(entry.serverAchievements.beatOwner.count, 0);
  assert.deepEqual(entry.cosmeticUnlocks, []);
});
