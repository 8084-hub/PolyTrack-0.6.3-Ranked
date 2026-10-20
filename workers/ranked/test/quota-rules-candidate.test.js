import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../../../docs/security/quota-20261018/backend-only-public.rules',import.meta.url),'utf8');
function block(collection) {
  const marker = 'match /'+collection+'/{';
  const start = source.indexOf(marker);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n    match /',start+marker.length) < 0 ? undefined : source.indexOf('\n    match /',start+marker.length));
}
test('quota candidate denies public result/profile scans without removing keyed reads',()=>{
  for (const name of ['0.6.2_profiles_public','0.6.2_race_results']) {
    const rules = block(name);
    assert.match(rules,/allow get: if true;/);
    assert.match(rules,/allow list: if false;/);
    assert.doesNotMatch(rules,/allow read:/);
  }
});
test('quota candidate closes direct Firestore fallback boards and event archives',()=>{
  for (const name of ['0.6.2_leaderboards_track','0.6.2_leaderboards_overall',
    '0.6.2_s1_leaderboards_track','0.6.2_s1_leaderboards_overall','0.6.2_event_public'])
    assert.doesNotMatch(block(name),/allow (?:get|read|list): if true;/);
  assert.match(source,/match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
});
test('old event inbox and receipt reads cannot bypass the Worker archive gate or read Rules dependencies',()=>{
  for (const name of ['0.6.2_event_inbox','0.6.2_event_receipts']) {
    assert.match(block(name),/allow get: if false;/);
    assert.doesNotMatch(block(name),/allow get: if signedIn/);
  }
});
