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

function active(value) {
  const seconds = Math.floor(num(value) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours
    ? hours + 'h ' + minutes % 60 + 'm ' + seconds % 60 + 's'
    : minutes
      ? minutes + 'm ' + seconds % 60 + 's'
      : seconds + 's';
}

function date(value) {
  const timestamp = num(value);
  if (!timestamp) return '';
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.valueOf())
    ? ''
    : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
  return '<p class="pp-evidence pp-evidence-known pp-evidence-' + source + '">' +
    '<strong>' + esc(evidenceLabel(source)) + '</strong>' +
    '<b>' + time(record.timeMs) + '</b>' +
    '<span>' + esc(rank) + '</span></p>';
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
    if (num(row.longestHuntMs)) observations.push(['Longest hunt', row.longestHuntMs, active]);
    if (num(row.biggestObservedImprovementMs)) observations.push(['Largest observed improvement', row.biggestObservedImprovementMs, time]);
    if (num(row.biggestPbImprovementMs)) observations.push(['Largest driven PB gain', row.biggestPbImprovementMs, time]);
    return { row, observations };
  }).filter(item => item.observations.length);

  if (!tracks.length) return '';

  const items = tracks.map(({ row, observations }) => {
    const name = nameOf(row, lookup);
    const values = observations.map(([label, value, format]) =>
      '<span><small>' + esc(label) + '</small><b>' + (format || active)(value) + '</b></span>'
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
  const metrics = [
    attempts ? attempts + (attempts === 1 ? ' attempt' : ' attempts') : '',
    count(row.restarts) ? count(row.restarts) + (count(row.restarts) === 1 ? ' reset' : ' resets') : '',
    count(row.pbs) ? count(row.pbs) + (count(row.pbs) === 1 ? ' PB' : ' PBs') : '',
    count(row.respawns) ? count(row.respawns) + (count(row.respawns) === 1 ? ' checkpoint respawn' : ' checkpoint respawns') : ''
  ].filter(Boolean);
  const lastPlayed = date(row.lastPlayedAt);
  const activeTime = num(row.activeMs) ? active(row.activeMs) + ' active' : 'Active time not recorded';
  const knownResults = evidence.length
    ? evidence.map(evidenceMarkup).join('')
    : '<p class="pp-evidence pp-evidence-unavailable">' +
      '<strong>Saved PB</strong><span>Not available in loaded results</span></p>';
  const trackedHistory = '<p class="pp-evidence pp-evidence-tracked ' + (!tracked ? 'pp-no-finish' : '') + '">' +
    '<strong>Tracked history</strong>' +
    (tracked ? '<b>best ' + time(tracked) + '</b>' : '') +
    '<span>' + (finishes
      ? finishes + ' recorded ' + (finishes === 1 ? 'finish' : 'finishes')
      : 'No finish recorded yet') +
    '</span></p>';
  const improvement = num(row.improvedMs ?? row.improvementMs);

  return '<li class="pp-track" data-track-id="' + esc(row.trackId) +
    '" data-track-name="' + esc(name.toLocaleLowerCase()) +
    '" data-active-ms="' + num(row.activeMs) +
    '" data-last-played="' + num(row.lastPlayedAt) +
    '" data-improvement-ms="' + improvement + '">' +
    '<div class="pp-track-top"><div class="pp-art" aria-hidden="true">' + art(row, preview) +
    '</div><div class="pp-track-main"><h3>' + esc(name) +
    '</h3><p class="pp-last-played">' + (lastPlayed ? 'Last played ' + esc(lastPlayed) : 'Last played date not recorded') +
    '</p><p class="pp-active">' + esc(activeTime) + '</p></div></div>' +
    '<div class="pp-results">' + knownResults + trackedHistory + '</div>' +
    (metrics.length ? '<p class="pp-track-data">' + metrics.map(value => '<span>' + esc(value) + '</span>').join('') + '</p>' : '') +
    (num(row.sincePbMs)
      ? '<p class="pp-since-pb" title="Active practice time accumulated since the latest recorded personal-best improvement">' +
        esc(active(row.sincePbMs)) + ' without a new PB</p>'
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
    (num(run.practiceMs) ? ' · ' + esc(active(run.practiceMs)) + ' practice' : '') +
    '</small></span><b>' + time(run.timeMs) + '</b>' +
    (run.timingNote === true ? '<small class="pp-note">Practice and finish clocks differed on this run.</small>' : '') +
    '</li>'
  ).join('');
}

function coverageMarkup(coverage) {
  if (!Number.isFinite(coverage?.coverageFraction)) return '';
  const percent = Math.round(Math.max(0, Math.min(1, coverage.coverageFraction)) * 100);
  const level = percent < 10 ? 'low' : percent < 60 ? 'moderate' : 'adequate';
  const description = percent < 10
    ? 'Sparse evidence: less than 10% of visible time is covered. This is not an error or a fraud signal.'
    : percent < 60
      ? 'Partial evidence: some visible time is covered.'
      : 'Good evidence: most visible time is covered.';
  const summary = level === 'low' ? 'limited history' : level === 'moderate' ? 'partial history' : 'well covered';
  return '<span class="pp-coverage pp-coverage-' + level + '" title="' + esc(description) + '">' +
    '<b>' + percent + '% visible-time coverage · ' + summary + '</b>' +
    '<small class="pp-coverage-note">' + esc(description) + '</small></span>';
}

export function renderPracticeProfile({ rows = [], coverage = null, trackName, trackPreview, results = [] } = {}) {
  const safe = Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') : [];
  const observed = safe.filter(row => num(row.activeMs) || count(row.attempts) || count(row.finishes));
  const total = observed.reduce((sum, row) => sum + num(row.activeMs), 0);
  const finishes = finishItems(observed, trackName);
  const details = sessionDetailsMarkup(observed, trackName);

  const summaryStats = [
    ['Longest hunt', Math.max(0, ...observed.map(row => num(row.longestHuntMs))), 'moving time on one track', active],
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
      '<span><small>ACTIVE TIME</small><strong>' + active(total) + '</strong></span>' +
      '<span><small>TRACKS DRIVEN</small><strong>' + observed.length + '</strong></span>' +
      coverageMarkup(coverage) + summaryStats + firstStat + '</div>' +
      '<div class="pp-toolbar">' +
      '<label>Search tracks <input type="search" data-pp-search placeholder="Track name or ID" autocomplete="off"></label>' +
      '<label>Sort by <select data-pp-sort>' +
      '<option value="recent">Most recent</option><option value="active">Active time</option>' +
      '<option value="improvement">Improvement</option><option value="name">Name</option>' +
      '</select></label>' +
      '<div role="group" aria-label="Track layout">' +
      '<button type="button" data-pp-view="grid" aria-pressed="true">Grid</button>' +
      '<button type="button" data-pp-view="list" aria-pressed="false">List</button></div>' +
      '<p data-pp-count aria-live="polite">' + observed.length + ' ' +
      (observed.length === 1 ? 'track' : 'tracks') + '</p></div>' +
      '<section class="pp-tracks pp-view-grid" aria-labelledby="pp-tracks-title">' +
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
        (item.dataset.trackId || '') + ' ' +
        (item.textContent || '')
      ).toLocaleLowerCase().includes(query);
    }
    const visible = items.filter(item => !item.hidden);
    const key = sort?.value || 'recent';
    visible.sort((a, b) =>
      key === 'name'
        ? (a.dataset.trackName || '').localeCompare(b.dataset.trackName || '')
        : key === 'active'
          ? num(b.dataset.activeMs) - num(a.dataset.activeMs)
          : key === 'improvement'
            ? num(b.dataset.improvementMs) - num(a.dataset.improvementMs)
            : num(b.dataset.lastPlayed) - num(a.dataset.lastPlayed)
    );
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

  search?.addEventListener('input', filter);
  sort?.addEventListener('change', filter);
  root.addEventListener('click', onView);
  filter();
  return () => {
    search?.removeEventListener('input', filter);
    sort?.removeEventListener('change', filter);
    root.removeEventListener('click', onView);
  };
}
