import { formatActiveTime } from './active-time.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const count = value => Math.floor(num(value));

function time(value) {
  const centiseconds = Math.round(num(value) / 10);
  const seconds = Math.floor(centiseconds / 100);
  const fraction = String(centiseconds % 100).padStart(2, '0');
  if (seconds < 60) return seconds + '.' + fraction + 's';
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + '.' + fraction;
}

function date(value) {
  const timestamp = num(value);
  if (timestamp < Date.UTC(2020, 0, 1)) return '';
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.valueOf())
    ? ''
    : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function pbAge(value) {
  const timestamp = num(value);
  if (timestamp < Date.UTC(2020, 0, 1)) return '';
  const elapsed = Date.now() - timestamp;
  if (elapsed < 0) return '';
  if (elapsed < 60_000) return 'just now';
  if (elapsed < 3_600_000) return Math.floor(elapsed / 60_000) + 'm ago';
  if (elapsed < 86_400_000) return Math.floor(elapsed / 3_600_000) + 'h ago';
  if (elapsed < 30 * 86_400_000) return Math.floor(elapsed / 86_400_000) + 'd ago';
  if (elapsed < 365 * 86_400_000) return Math.floor(elapsed / (30 * 86_400_000)) + 'mo ago';
  return Math.floor(elapsed / (365 * 86_400_000)) + 'y ago';
}

function nameOf(row, lookup) {
  let value = row.trackName ?? row.name;
  if (!value && typeof lookup === 'function' && row.trackId != null) {
    try { value = lookup(row.trackId); } catch {}
  } else if (!value && lookup && row.trackId != null) {
    value = lookup[row.trackId];
  }
  const fallbackId = String(row.trackId ?? '').slice(0, 8);
  return String(value || 'Track ' + (fallbackId || 'unknown'));
}

function art(row, callback) {
  if (typeof callback === 'function' && row.trackId != null) {
    try {
      const value = callback(row.trackId);
      if (typeof value === 'string' && value.trim()) return value;
    } catch {}
  }
  return '<span class="pp-preview-unknown" aria-label="Track preview unavailable">?</span>';
}

function evidenceSource(record) {
  if (record.local === true || record.localPending === true || record.source === 'local') return 'local';
  if (record.source === 'cloud') return 'cloud';
  if (record.source === 'snapshot' || num(record.snapshotCapturedAt)) return 'snapshot';
  if (record.source === 'saved') return 'saved';
  return 'known';
}

function resultEvidence(results, trackId) {
  const matching = (Array.isArray(results) ? results : [])
    .filter(record => record && record.trackId === trackId && num(record.timeMs));
  const bestBySource = new Map();
  for (const record of matching) {
    const source = evidenceSource(record);
    const current = bestBySource.get(source);
    if (!current || num(record.timeMs) < num(current.timeMs)) bestBySource.set(source, record);
  }
  const order = ['local', 'snapshot', 'cloud', 'saved', 'known'];
  return [...bestBySource.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([source, record]) => ({ source, record }));
}

function evidenceLabel(source) {
  if (source === 'local') return 'Known PB evidence · Local PB';
  if (source === 'snapshot') return 'Snapshot PB';
  if (source === 'cloud') return 'Cloud PB evidence';
  if (source === 'saved') return 'Saved PB · source not confirmed';
  return 'Known PB evidence';
}

function rankLabel(record) {
  const rank = Number(record.rank);
  const fieldSize = Number(record.fieldSize);
  return Number.isSafeInteger(rank) && rank > 0 &&
    Number.isSafeInteger(fieldSize) && fieldSize >= rank
    ? 'Rank ' + rank + ' of ' + fieldSize
    : 'Placement not available';
}

function evidenceMarkup(evidence) {
  const { source, record } = evidence;
  const rank = rankLabel(record);
  const age = pbAge(record.pbAt);
  return '<p class="pp-evidence pp-evidence-known pp-evidence-' + source + '">' +
    '<strong>' + esc(evidenceLabel(source)) + '</strong>' +
    '<b>' + time(record.timeMs) + '</b>' +
    '<span>' + esc(rank) + '</span>' +
    (age ? '<small class="pp-pb-age" title="Based on the PB timestamp in the saved result">PB recorded ' + esc(age) + '</small>' : '') +
    '</p>';
}

function sessionDetailsMarkup(rows, lookup) {
  const tracks = rows.map(row => {
    const observations = row.observationVersion === 1
      ? [
          ['Focused', row.focusedMs],
          ['Paused', row.pausedMs],
          ['Hidden / unfocused', row.hiddenMs],
          ['Observed moving', row.movingMs],
          ['Stationary', row.stationaryMs]
        ].filter(([, value]) => num(value) > 0)
      : [];
    if (num(row.longestHuntMs)) observations.push(['Longest hunt', row.longestHuntMs, formatActiveTime]);
    if (num(row.biggestObservedImprovementMs)) observations.push(['Largest observed improvement', row.biggestObservedImprovementMs, time]);
    if (num(row.biggestPbImprovementMs)) observations.push(['Largest driven PB gain', row.biggestPbImprovementMs, time]);
    return { row, observations };
  }).filter(item => item.observations.length);

  if (!tracks.length) return '';

  const items = tracks.map(({ row, observations }) => {
    const name = nameOf(row, lookup);
    const values = observations.map(([label, value, format]) =>
      '<span><small>' + esc(label) + '</small><b>' + (format || formatActiveTime)(value) + '</b></span>'
    ).join('');
    return '<details class="pp-more pp-session-row"><summary>' +
      '<strong>' + esc(name) + '</strong><small>' + observations.length +
      (observations.length === 1 ? ' measurement' : ' measurements') +
      '</small></summary><div class="pp-observations">' + values + '</div></details>';
  }).join('');

  return '<details class="pp-session-details"><summary>Session details <span>' +
    tracks.length + (tracks.length === 1 ? ' track' : ' tracks') +
    '</span></summary><div class="pp-session-rows">' + items + '</div></details>';
}

function card(row, lookup, preview, results) {
  const name = nameOf(row, lookup);
  const attempts = count(row.attempts);
  const finishes = count(row.finishes);
  const tracked = num(row.trackedBestMs);
  const evidence = resultEvidence(results, row.trackId);
  const improvement = num(row.improvedMs ?? row.improvementMs);
  const metrics = [
    attempts ? { sort: 'attempts', text: attempts + (attempts === 1 ? ' attempt' : ' attempts') } : null,
    count(row.restarts) ? { text: count(row.restarts) + (count(row.restarts) === 1 ? ' reset' : ' resets') } : null,
    count(row.pbs) ? { text: count(row.pbs) + (count(row.pbs) === 1 ? ' recorded best' : ' recorded bests') } : null,
    count(row.respawns) ? { text: count(row.respawns) + (count(row.respawns) === 1 ? ' checkpoint respawn' : ' checkpoint respawns') } : null,
    improvement ? { sort: 'improvement', text: time(improvement) + ' driven PB gain' } :
      { sort: 'improvement', zero: true, text: 'No driven PB gain recorded' }
  ].filter(Boolean);
  const lastPlayed = date(row.lastPlayedAt);
  const activeTime = num(row.activeMs) ? formatActiveTime(row.activeMs) : 'Not measured';
  const knownResults = evidence.length
    ? evidence.map(evidenceMarkup).join('')
    : '';
  const trackedHistory = tracked || finishes ? '<p class="pp-evidence pp-evidence-tracked">' +
    '<strong>Tracked history</strong>' +
    (tracked ? '<b>best ' + time(tracked) + '</b>' : '') +
    (finishes ? '<span>' + finishes + ' recorded ' + (finishes === 1 ? 'finish' : 'finishes') + '</span>' : '') +
    '</p>' : '';
  return '<li class="pp-track" data-pp-track-id="' + esc(row.trackId) +
    '" data-track-name="' + esc(name.toLocaleLowerCase()) +
    '" data-active-ms="' + num(row.activeMs) +
    '" data-attempts="' + attempts +
    '" data-last-played="' + num(row.lastPlayedAt) +
    '" data-improvement-ms="' + improvement + '">' +
    '<div class="pp-track-top"><button type="button" class="pp-art pp-track-open" data-track-id="' + esc(row.trackId) +
    '" aria-label="Open track ' + esc(name) + '">' + art(row, preview) +
    '</button><div class="pp-track-main"><h3><button type="button" class="pp-track-name-button" data-track-id="' + esc(row.trackId) +
    '">' + esc(name) + '</button></h3>' +
    '<p class="pp-last-played pp-sort-metric pp-sort-recent"><small>Last played</small><strong>' +
    (lastPlayed ? esc(lastPlayed) : 'Date not recorded') + '</strong></p>' +
    '<p class="pp-active pp-sort-metric pp-sort-active"><small>Measured drive time</small><strong>' +
    esc(activeTime) + '</strong></p></div></div>' +
    (knownResults || trackedHistory ? '<div class="pp-results">' + knownResults + trackedHistory + '</div>' : '') +
    (metrics.length ? '<p class="pp-track-data">' + metrics.map(value => '<span' +
      (value.sort ? ' class="pp-sort-' + value.sort + (value.zero ? ' pp-zero' : '') + '"' : '') + '>' + esc(value.text) + '</span>').join('') + '</p>' : '') +
    (num(row.sincePbMs)
      ? '<p class="pp-since-pb" title="Measured drive time since the last observed best improvement">' +
        esc(formatActiveTime(row.sincePbMs)) + ' since last recorded best</p>'
      : '') +
    '</li>';
}

function finishItems(rows, lookup) {
  return rows.flatMap(row =>
    (Array.isArray(row.recentFinishes) ? row.recentFinishes : [])
      .filter(run => run && num(run.timeMs))
      .map(run => ({ run, name: nameOf(row, lookup) }))
  ).sort((a, b) => num(b.run.at) - num(a.run.at)).slice(0, 6).map(({ run, name }) =>
    '<li class="pp-finish"><span><strong>' + esc(name) + '</strong><small>' +
    esc(date(run.at) || 'Date unavailable') +
    (num(run.practiceMs) ? ' · ' + esc(formatActiveTime(run.practiceMs)) + ' practice' : '') +
    '</small></span><b>' + time(run.timeMs) + '</b>' +
    (run.timingNote === true ? '<small class="pp-note">Practice and finish clocks differed on this run.</small>' : '') +
    '</li>'
  ).join('');
}

function coverageMarkup(coverage) {
  if (!Number.isFinite(coverage?.coverageFraction)) return '';
  const percent = Math.round(Math.max(0, Math.min(1, coverage.coverageFraction)) * 100);
  const description = percent < 10
    ? 'Less than 10% of visible time is covered. This history describes only the recorded practice.'
    : percent < 60
      ? 'Partial evidence: some visible time is covered.'
      : 'Good evidence: most visible time is covered.';
  return '<details class="pp-coverage-details"><summary>About history coverage</summary>' +
    '<p class="pp-coverage-note">' + percent + '% visible-time coverage. ' + esc(description) +
    ' Attempts and active time are practice observations; saved PB evidence is shown separately and does not imply a tracked finish.</p></details>';
}

export function renderPracticeProfile({ rows = [], coverage = null, trackName, trackPreview, results = [] } = {}) {
  const safe = Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') : [];
  const observed = safe.filter(row => num(row.activeMs) || count(row.attempts) || count(row.finishes));
  const total = observed.reduce((sum, row) => sum + num(row.activeMs), 0);
  const finishes = finishItems(observed, trackName);
  const details = sessionDetailsMarkup(observed, trackName);

  const summaryStats = [
    ['Longest hunt', Math.max(0, ...observed.map(row => num(row.longestHuntMs))), 'moving time on one track', formatActiveTime],
    ['Largest observed gain', Math.max(0, ...observed.map(row => num(row.biggestObservedImprovementMs))), 'known best decrease, including sync', time],
    ['Largest driven PB gain', Math.max(0, ...observed.map(row => num(row.biggestPbImprovementMs))), 'improvement from an observed finish', time]
  ].filter(([, value]) => value > 0).map(([label, value, note, format]) =>
    '<span><small>' + esc(label) + '</small><strong>' + format(value) + '</strong><small>' +
    esc(note) + '</small></span>'
  ).join('');

  const first = observed.filter(row => row.firstPlacement?.exact === true &&
    row.firstPlacement?.complete === true && row.firstPlacement?.authoritative === true &&
    Number.isSafeInteger(row.firstPlacement.rank) && row.firstPlacement.rank > 0 &&
    Number.isSafeInteger(row.firstPlacement.total) && row.firstPlacement.total >= Math.max(2, row.firstPlacement.rank)
  ).sort((a, b) =>
    (a.firstPlacement.rank - 1) / (a.firstPlacement.total - 1) -
    (b.firstPlacement.rank - 1) / (b.firstPlacement.total - 1) ||
    b.firstPlacement.total - a.firstPlacement.total
  )[0];
  const firstStat = first
    ? '<span><small>Best first recorded place</small><strong>#' + first.firstPlacement.rank +
      ' of ' + first.firstPlacement.total + '</strong><small>' + esc(nameOf(first, trackName)) +
      ' · first known during tracking, not first-ever</small></span>'
    : '';
  const cards = observed.map(row => card(row, trackName, trackPreview, results)).join('');

  const body = observed.length
    ? '<div class="pp-summary" aria-label="Practice summary">' +
      '<span><small>MEASURED DRIVE TIME</small><strong>' + formatActiveTime(total) + '</strong></span>' +
      '<span><small>TRACKS DRIVEN</small><strong>' + observed.length + '</strong></span>' +
      summaryStats + firstStat + '</div>' + coverageMarkup(coverage) +
      '<div class="pp-toolbar">' +
      '<label>Search tracks <input type="search" data-pp-search placeholder="Track name or ID" autocomplete="off"></label>' +
      '<div class="pp-sort-control"><label>Sort by <select data-pp-sort>' +
      '<option value="recent">Last played</option><option value="active">Active time</option>' +
      '<option value="attempts">Attempts</option>' +
      (observed.some(row => num(row.improvedMs ?? row.improvementMs)) ? '<option value="improvement">Driven PB gain</option>' : '') +
      '<option value="name">Name</option>' +
      '</select></label><button type="button" class="pp-direction" data-pp-direction="desc" aria-label="Sort descending" title="Sort descending">\u2193</button></div>' +
      '<div role="group" aria-label="Track layout">' +
      '<button type="button" data-pp-view="grid" aria-pressed="true">Grid</button>' +
      '<button type="button" data-pp-view="list" aria-pressed="false">List</button></div>' +
      '<p data-pp-count aria-live="polite">' + observed.length + ' ' +
      (observed.length === 1 ? 'track' : 'tracks') + '</p></div>' +
      '<section class="pp-tracks pp-view-grid" data-pp-sort-key="recent" aria-labelledby="pp-tracks-title">' +
      '<h2 id="pp-tracks-title">Practice tracks</h2>' +
      '<p class="pp-no-results" hidden>No tracks match your search.</p><ul>' + cards + '</ul></section>'
    : '<p class="pp-empty">Drive a track to start building your practice history.</p>';

  const finishCount = Math.min(6, observed.reduce((sum, row) =>
    sum + (Array.isArray(row.recentFinishes)
      ? row.recentFinishes.filter(run => run && num(run.timeMs)).length
      : 0), 0));

  return '<details class="polytrack-practice-profile">' +
    '<summary class="pp-heading"><span class="pp-heading-copy">' +
    '<strong>Practice history</strong><small>Local driving record</small>' +
    '</span><span class="pp-caret" aria-hidden="true"></span></summary>' +
    '<div class="pp-content">' + body +
    (details ? details : '') +
    (finishes
      ? '<details class="pp-finishes"><summary>Recent finishes <span>' + finishCount +
        '</span></summary><ul>' + finishes + '</ul></details>'
      : '') +
    '<details class="pp-manage"><summary>Manage local history</summary>' +
    '<p>Removes this racer’s practice observations from this device. Personal bests and saved tracks are not changed.</p>' +
    '<button type="button" data-clear-practice-history>Clear practice history</button></details>' +
    '</div></details>';
}

export function installPracticeProfileControls(root) {
  if (!root || typeof root.querySelector !== 'function') return () => {};
  const search = root.querySelector('[data-pp-search]');
  const sort = root.querySelector('[data-pp-sort]');
  const direction = root.querySelector('[data-pp-direction]');
  const list = root.querySelector('.pp-tracks ul');
  const section = root.querySelector('.pp-tracks');
  const countLabel = root.querySelector('[data-pp-count]');
  const empty = root.querySelector('.pp-no-results');
  if (!list || !section) return () => {};

  const filter = () => {
    const query = (search?.value || '').trim().toLocaleLowerCase();
    const items = [...list.querySelectorAll('.pp-track')];
    for (const item of items) {
      item.hidden = !(
        (item.dataset.trackName || '') + ' ' +
        (item.dataset.ppTrackId || '') + ' ' +
        (item.textContent || '')
      ).toLocaleLowerCase().includes(query);
    }
    const visible = items.filter(item => !item.hidden);
    const key = sort?.value || 'recent';
    const sign = direction?.dataset.ppDirection === 'asc' ? 1 : -1;
    const attribute = { active: 'activeMs', attempts: 'attempts', improvement: 'improvementMs', recent: 'lastPlayed' }[key] || 'lastPlayed';
    section.dataset.ppSortKey = key;
    visible.sort((a, b) => {
      const names = (a.dataset.trackName || '').localeCompare(b.dataset.trackName || '');
      const comparison = key === 'name' ? names : num(a.dataset[attribute]) - num(b.dataset[attribute]);
      return sign * comparison || names || (a.dataset.ppTrackId || '').localeCompare(b.dataset.ppTrackId || '');
    });
    for (const item of visible) list.append(item);
    if (countLabel) countLabel.textContent = visible.length + ' of ' + items.length + ' tracks';
    if (empty) empty.hidden = visible.length !== 0;
  };

  const onView = event => {
    const button = event.target.closest?.('[data-pp-view]');
    if (!button) return;
    section.classList.toggle('pp-view-list', button.dataset.ppView === 'list');
    section.classList.toggle('pp-view-grid', button.dataset.ppView === 'grid');
    root.querySelectorAll('[data-pp-view]').forEach(item =>
      item.setAttribute('aria-pressed', String(item === button))
    );
  };

  const onDirection = () => {
    const next = direction.dataset.ppDirection === 'asc' ? 'desc' : 'asc';
    direction.dataset.ppDirection = next;
    direction.textContent = next === 'asc' ? '\u2191' : '\u2193';
    direction.setAttribute('aria-label', 'Sort ' + (next === 'asc' ? 'ascending' : 'descending'));
    direction.title = direction.getAttribute('aria-label');
    filter();
  };

  search?.addEventListener('input', filter);
  sort?.addEventListener('change', filter);
  direction?.addEventListener('click', onDirection);
  root.addEventListener('click', onView);
  filter();
  return () => {
    search?.removeEventListener('input', filter);
    sort?.removeEventListener('change', filter);
    direction?.removeEventListener('click', onDirection);
    root.removeEventListener('click', onView);
  };
}
