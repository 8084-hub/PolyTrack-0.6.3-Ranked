import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPracticeProfile, installPracticeProfileControls } from './practice-profile.mjs';

const row = (overrides = {}) => ({
  trackId: 'track-a', trackName: 'Summer Run', activeMs: 125000, attempts: 7,
  finishes: 3, pbs: 1, bestMs: 47250, trackedBestMs: 47250, sincePbMs: 61000,
  lastPlayedAt: Date.UTC(2026, 9, 17), ...overrides
});

test('renders compact summary and per-track useful data with trusted preview markup', () => {
  const html = renderPracticeProfile({ rows: [row()], trackPreview: id => `<img src="/thumb/${id}.png" alt="">` });
  assert.match(html, /ACTIVE TIME/);
  assert.match(html, /2m/);
  assert.match(html, /TRACKS DRIVEN/);
  assert.match(html, /7 attempts/);
  assert.match(html, /3 recorded finishes/);
  assert.match(html, /1 PB/);
  assert.match(html, /47\.25s/);
  assert.match(html, /1m 1s without a new PB/);
  assert.match(html, /Last played [^<]*2026/);
  assert.match(html, /<img src="\/thumb\/track-a\.png" alt="">/);
  assert.doesNotMatch(html, />PT</);
});

test('invalid epoch-scale activity timestamps are reported as unavailable', () => {
  const html = renderPracticeProfile({ rows: [row({ lastPlayedAt: 2 })] });
  assert.match(html, /Last played date not recorded/);
  assert.doesNotMatch(html, /Dec 31, 1969|Jan 1, 1970/);
});

test('escapes names and uses fallback art if callback fails or returns no markup', () => {
  const html = renderPracticeProfile({ rows: [row({ trackName: '<img src=x onerror=1>' })], trackPreview: () => '<script>bad()</script>' });
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
  assert.match(html, /<script>bad\(\)<\/script>/);
  const fallback = renderPracticeProfile({ rows: [row()], trackPreview: () => '' });
  assert.match(fallback, /pp-preview-unknown/);
});

test('does not render recent finishes section when there are none', () => {
  const html = renderPracticeProfile({ rows: [row()] });
  assert.doesNotMatch(html, /pp-finishes/);
  assert.doesNotMatch(html, /Recent finishes/);
});

test('shows recent finishes only when known and keeps optional timing note escaped', () => {
  const html = renderPracticeProfile({ rows: [row({ recentFinishes: [{ at: Date.UTC(2026, 9, 18), timeMs: 48123, practiceMs: 92000, timingNote: true }] })] });
  assert.match(html, /Recent finishes/);
  assert.match(html, /48\.12s/);
  assert.match(html, /1m 32s practice/);
  assert.match(html, /clocks differed/);
});

test('renders the full searchable track history and excludes non-observations', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row({ trackId: `t${i}`, trackName: `Track ${i}`, lastPlayedAt: i + 1 }));
  rows.push({ trackId: 'empty', trackName: 'Empty', activeMs: 0, attempts: 0, finishes: 0 });
  const html = renderPracticeProfile({ rows });
  assert.equal((html.match(/class="pp-track"/g) || []).length, 12);
  assert.doesNotMatch(html, /Empty/);
});

test('separates known local/cloud PB evidence from tracked finish history and never invents rank', () => {
  const html = renderPracticeProfile({ rows: [row()], results: [
    { trackId: 'track-a', timeMs: 46000, local: true },
    { trackId: 'track-a', timeMs: 45500, source: 'cloud', rank: 4, fieldSize: 20 }
  ] });
  assert.match(html, /Tracked history/);
  assert.match(html, /Cloud PB evidence/);
  assert.match(html, /45\.50s/);
  assert.match(html, /Rank 4 of 20/);
  const noProof = renderPracticeProfile({ rows: [row()] });
  assert.doesNotMatch(noProof, /Known PB evidence|Rank /);
});

test('uses explicit coverage color and explanation for sparse, moderate, and adequate evidence', () => {
  const view = fraction => renderPracticeProfile({ rows: [row()], coverage: { coverageFraction: fraction } });
  assert.match(view(0.05), /pp-coverage-low[^>]*>[\s\S]*5% visible-time coverage · limited history[\s\S]*Sparse evidence: less than 10% of visible time is covered/);
  assert.match(view(0.3), /pp-coverage-moderate/);
  assert.match(view(0.85), /pp-coverage-adequate/);
  assert.match(view(0.05), /Sparse evidence: less than 10% of visible time is covered\. Information is limited\./);
});

test('shows PB age only from a PB timestamp, never from snapshot capture age', () => {
  const recent = renderPracticeProfile({ rows: [row()], results: [
    { trackId: 'track-a', timeMs: 46000, source: 'snapshot', snapshotCapturedAt: Date.now() - 20 * 86400000,
      pbAt: Date.now() - 2 * 86400000 }
  ] });
  assert.match(recent, /PB recorded 2d ago/);
  const captureOnly = renderPracticeProfile({ rows: [row()], results: [
    { trackId: 'track-a', timeMs: 46000, source: 'snapshot', snapshotCapturedAt: Date.now() - 20 * 86400000 }
  ] });
  assert.doesNotMatch(captureOnly, /PB recorded/);
});

test('provides accessible search, sorting, view controls, and event handler export', () => {
  const html = renderPracticeProfile({ rows: [row()] });
  assert.match(html, /<label>Search tracks/);
  assert.match(html, /value="improvement"/);
  assert.match(html, /data-pp-view="list"/);
  assert.equal(typeof installPracticeProfileControls, 'function');
  assert.equal(installPracticeProfileControls(null) instanceof Function, true);
});

test('renders a single compact instruction for no meaningful observations', () => {
  const html = renderPracticeProfile({ rows: [row({ activeMs: 0, attempts: 0, finishes: 0, bestMs: 0 })] });
  assert.match(html, /Drive a track to start building your practice history/);
  assert.doesNotMatch(html, /pp-tracks/);
});

test('keeps clear-history action available in accessible native details', () => {
  const html = renderPracticeProfile();
  assert.match(html, /<details class="pp-manage">/);
  assert.match(html, /<button type="button" data-clear-practice-history>/);
  assert.match(html, /Manage local history/);
});

test('baseline PB is never labelled an observed finish and invalid ranks are omitted',()=>{const html=renderPracticeProfile({rows:[row({bestMs:12345,trackedBestMs:0})],results:[{trackId:'track-a',timeMs:12345,local:true,rank:4,fieldSize:2}]});assert.doesNotMatch(html,/Tracked best|best 12.35s|Rank 4/);assert.match(html,/Known PB evidence/);});

test('sparse cards keep evidence readable without inventing session measurements',()=>{
 const html=renderPracticeProfile({rows:[row({finishes:0,trackedBestMs:0,observationVersion:1,pausedMs:0,focusedMs:0})],results:[{trackId:'track-a',timeMs:47000,source:'snapshot'}]});
 assert.match(html,/Snapshot PB/);assert.match(html,/Placement not available/);assert.match(html,/No finish recorded yet/);
 assert.doesNotMatch(html,/pp-session-details|>Paused<|>Stationary</);
});
test('observed session details are optional and known PBs remain separate from driven finishes',()=>{
 const html=renderPracticeProfile({rows:[row({observationVersion:1,focusedMs:90000,pausedMs:12000,movingMs:70000,motionObservedMs:80000,longestHuntMs:60000,biggestPbImprovementMs:350})],results:[{trackId:'track-a',timeMs:45000,source:'snapshot',rank:4,fieldSize:20}]});
 assert.match(html,/<details class="pp-session-details">/);assert.match(html,/Session details/);assert.match(html,/Largest driven PB gain/);assert.match(html,/Rank 4 of 20/);assert.match(html,/best 47.25s/);
});
