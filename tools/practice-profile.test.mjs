import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPracticeProfile } from './practice-profile.mjs';

test('renders a compact local profile with escaped track labels and timing context', () => {
  const html = renderPracticeProfile({
    trackName: { track123: '<img src=x onerror=alert(1)>' },
    coverage: { coverageFraction: 0.625 },
    rows: [{
      trackId: 'track123', attempts: 4, activeMs: 125000, simulatedMs: 99000,
      finishes: 2, pbs: 1, restarts: 1, respawns: 2, bestMs: 47250,
      lastPlayedAt: 1730000000000,
      recentFinishes: [{ at: 1730000000000, timeMs: 47250, practiceMs: 95000, timingNote: true }]
    }]
  });

  assert.match(html, /<details class="polytrack-practice-profile">/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /63% observed coverage/);
  assert.match(html, /timing sources can vary/i);
  assert.match(html, /not a verdict/i);
  assert.doesNotMatch(html, /<script\b/i);
});

test('renders useful empty states and tolerates missing or malformed inputs', () => {
  const html = renderPracticeProfile({ rows: null, coverage: null });
  assert.match(html, /No practice tracks recorded yet/);
  assert.match(html, /Recent finishes will appear here/);
  assert.match(html, /0%|tracked locally/);
  assert.doesNotMatch(html, /undefined|null/);
});
