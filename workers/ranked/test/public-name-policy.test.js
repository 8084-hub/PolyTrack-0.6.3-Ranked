import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { computeTrackEntries } from '../src/index.js';
import { moderatePublicName, safePublicName } from '../src/public-name-policy.js';

const TRACK = '5803f9e963625804e3de3246d043dc7dde847aa32e991f7f7326b0453f1fa038';

test('public-name policy matches client cleanup and avoids ordinary substring false positives', () => {
  assert.deepEqual(moderatePublicName('  Sakura  Racer  '), { blocked: false, reason: '', clean: 'Sakura Racer' });
  for (const name of ['Analogue', 'Scunthorpe', 'Fukushima', 'Niño Racer', '李小龍']) assert.equal(moderatePublicName(name).blocked, false, name);
  assert.equal(moderatePublicName('moderator').reason, 'reserved-name');
  assert.equal(moderatePublicName('f.u.c.k').blocked, true);
  assert.deepEqual(moderatePublicName('A\u200b  Racer'), { blocked: false, reason: '', clean: 'A Racer' });
});

test('blocked names use deterministic account-specific public fallbacks', () => {
  assert.equal(safePublicName('moderator', 'account-a'), safePublicName('moderator', 'account-a'));
  assert.notEqual(safePublicName('moderator', 'account-a'), 'moderator');
  assert.equal(safePublicName('Scunthorpe', 'account-a'), 'Scunthorpe');
});

test('track snapshot projection sanitizes names without a database lookup', () => {
  const row = { accountId: 'account-a', trackId: TRACK, timeMs: 1000, frames: 1000, raceTimeFrames: 1000, replay: 'fixture-replay', replayHash: 'a'.repeat(64), name: 'moderator', nickname: 'moderator' };
  const entry = computeTrackEntries([row], TRACK)[0];
  assert.equal(entry.name, safePublicName('moderator', 'account-a'));
  assert.equal(entry.nickname, entry.name);
});

test('profile notification and identity update reuse the pure policy without moderation reads', () => {
  const source = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const section = (start, end) => {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, 'Worker hook section exists');
    return source.slice(from, to);
  };
  const compute = section('export function computeTrackEntries(', 'export async function rebuildTrack(');
  const notify = section('async function notifyProfile(', 'async function processProfileJob(');
  const update = section('export async function updateTrackIdentity(', 'async function processProfileJobs(');
  assert.match(compute, /safePublicName\(row\.nickname \|\| row\.name/);
  assert.match(notify, /safePublicName\(profile\.data\.nickname \|\| profile\.data\.name/);
  assert.match(update, /safePublicName\(identity\.name, accountId\)/);
  assert.doesNotMatch(notify, /moderationNames/);
});
