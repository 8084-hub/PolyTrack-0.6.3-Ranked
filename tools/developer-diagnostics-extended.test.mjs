import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeveloperReport } from './developer-diagnostics.mjs';

const id = 'a'.repeat(64);

test('report preserves the v1 structure and omits public ID by default', () => {
 const report = buildDeveloperReport({ publicId: id, email: 'private@example.test', token: 'secret' });
 assert.equal(report.schema, 'polytrack-developer-diagnostics-v1');
 assert.equal(report.privacy.automaticUpload, false);
 assert.equal(report.publicRacerId, undefined);
 assert.doesNotMatch(JSON.stringify(report), /private@example|secret|token/);
 assert.equal(buildDeveloperReport({ publicId: id, includePublicId: true }).publicRacerId, id);
});

test('local results reuse the loaded-results whitelist and rejects secrets', () => {
 const report = buildDeveloperReport({ localResults: [{ trackId: id, timeMs: 42, rank: 1, fieldSize: 5, code: 'private-code', replay: 'secret', token: 'secret' }] });
 assert.deepEqual(report.localResults[0], { trackId: id, timeMs: 42, rank: 1, fieldSize: 5, weight: null, cachedAt: 0, snapshotCapturedAt: 0, runVerified: null, integrityVerified: null, local: false, placementKnown: true });
 assert.doesNotMatch(JSON.stringify(report.localResults), /private-code|secret|replay|token/);
});

test('insights, tracks, and settings export only bounded schema fields', () => {
 const report = buildDeveloperReport({
  insights: { version: 1, startedAt: 3, revisions: [{ revision: 7, firstAt: 1, lastAt: 2, visits: 4, token: 'secret' }], tracks: { [id]: { plays: 2, sources: { planner: 1, password: 'secret' }, token: 'secret' } }, transitions: { [`${id}:${id}`]: 5 }, metrics: { BOARD: { count: 2, totalMs: 20, maxMs: 15, over5s: 1, arbitrary: 'secret' } }, actions: { 'planner-track-click': 1 }, token: 'secret' },
  extraTracks: [{ id, name: 'Track', author: 'Maker', code: 'secret', script: 'secret' }],
  settings: { music: true, volume: 0.5, token: 'secret', privateSetting: 'secret', debug: false }
 });
 assert.deepEqual(report.extraTracks, [{ trackId: id, name: 'Track', author: 'Maker' }]);
 assert.deepEqual(report.settings, { music: true, volume: 0.5 });
 assert.equal(report.insights.tracks[id].sources.planner, 1);
 assert.doesNotMatch(JSON.stringify(report.insights), /secret|token|password/);
});

test('local results and extra-track metadata allow 5000 rows and report truncation', () => {
 const rows = Array.from({ length: 5001 }, (_, index) => ({ trackId: String(index), name: 'Track ' + index, timeMs: index }));
 const report = buildDeveloperReport({ localResults: rows, extraTracks: rows });
 assert.equal(report.localResults.length, 5000);
 assert.equal(report.extraTracks.length, 5000);
 assert.deepEqual(report.truncation, { localResults: { omitted: 1 }, extraTracks: { omitted: 1 }, localProfiles: { omitted: 0 }, localPersonalBests: { omitted: 0 }, localTracks: { omitted: 0 }, localPractice: { omitted: 0 } });
 assert.equal(report.extraTracks[0].trackId, '0');
 assert.equal(report.extraTracks[0].timeMs, undefined);
});

test('practice aggregate stats include active time, starts, finishes, resets and notes', () => {
 const report = buildDeveloperReport({ practice: [
  { activeMs: 200, attempts: 3, finishes: 0, restarts: 2, respawns: 1, recentFinishes: [{ timingNote: true }] },
  { activeMs: 300, attempts: 2, finishes: 1, restarts: 4, respawns: 0, recentFinishes: [{ timingNote: false }] }
 ] });
 assert.deepEqual(report.practiceSummary, { activeMs: 500, starts: 5, finishes: 1, resets: 7, tracksNeverFinished: 1, timingNotes: 1 });
});

test('unknown result placement remains unknown and sensitive fields never escape', () => {
 const result = buildDeveloperReport({ finishes: [{ rank: Infinity, fieldSize: Infinity, weight: null, connectionCode: 'secret' }] }).loadedResults[0];
 assert.equal(result.rank, null); assert.equal(result.fieldSize, null); assert.equal(result.placementKnown, false);
 assert.doesNotMatch(JSON.stringify(result), /secret|connectionCode/);
});

test('local profile data is explicit, whitelisted, ID-preserving, and gated by the existing checkbox consent', () => {
 const localData = {
  profiles: [{ publicId: 'racer_ID-0000000000000000000000000000000000000000000000000000000000000000', name: 'Racer', carColors: ['#112233', '#abcdef'], cosmetics: { body: 'sport', wheels: 'gold', authToken: 'secret', arbitrary: { password: 'secret' } }, playtimeMs: 1234, personalBests: [{ trackId: id, trackName: 'Track', timeMs: 456, frames: 28, achievedAt: 99, replay: 'secret' }], email: 'private@example.test', token: 'secret' }],
  tracks: [{ trackId: 'opaque-track-identifier-that-must-not-be-cut', name: 'Track', author: 'Builder', source: 'local', official: false, connectionCode: 'secret' }],
  practice: [{ trackId: id, trackName: 'Track', activeMs: 80, focusedMs: 20, pausedMs: 3, hiddenMs: 4, movingMs: 10, longestHuntMs: 6, biggestImprovementMs: 12, token: 'secret' }]
 };
 const optedOut = buildDeveloperReport({ localData });
 assert.equal(optedOut.localData, null);
 assert.deepEqual(optedOut.truncation.localProfiles, { omitted: 1 });
 const report = buildDeveloperReport({ localData, includePublicId: true });
 assert.equal(report.localData.profiles[0].publicId, localData.profiles[0].publicId);
 assert.equal(report.localData.tracks[0].trackId, localData.tracks[0].trackId);
 assert.equal(report.localData.profiles[0].personalBests[0].timeMs, 456);
 assert.equal(report.localData.practice[0].focusedMs, 20);
 assert.equal(report.localData.practice[0].biggestImprovementMs, 12);
 assert.equal(report.privacy.includesLocalProfiles, true);
 assert.doesNotMatch(JSON.stringify(report), /secret|private@example|authToken|connectionCode|replay/);
 assert.match(report.privacy.limitations, /does not imply legacy playtime was tracked/);
});

test('local data truncation reports every omitted category', () => {
 const profile = { publicId: 'racer', personalBests: Array.from({ length: 5001 }, (_, i) => ({ trackId: id, timeMs: i })) };
 const report = buildDeveloperReport({ includePublicId: true, localData: { profiles: Array(501).fill(profile), tracks: Array(5001).fill({ trackId: 'track' }), practice: Array(501).fill({ trackId: id }) } });
 assert.deepEqual(report.truncation.localProfiles, { omitted: 1 });
 assert.deepEqual(report.truncation.localPersonalBests, { omitted: 5501 });
 assert.deepEqual(report.truncation.localTracks, { omitted: 1 });
 assert.deepEqual(report.truncation.localPractice, { omitted: 1 });
});
