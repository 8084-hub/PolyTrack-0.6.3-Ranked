const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

const number = value => Number.isFinite(value) && value > 0 ? value : 0;
const duration = ms => {
  const seconds = number(ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
};
const shortDuration = ms => {
  const minutes = Math.floor(number(ms) / 60000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : minutes ? `${minutes}m` : `${Math.round(number(ms)/1000)}s`;
};
const dateLabel = value => {
  const date = new Date(number(value));
  return Number.isFinite(date.getTime()) && date.getTime() > 0
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'Date unavailable';
};
const labelFor = (row, trackName) => {
  const candidate = row.trackName ?? row.name ?? (typeof trackName === 'function'
    ? trackName(row.trackId)
    : trackName && typeof trackName === 'object'
      ? trackName[row.trackId]
      : trackName);
  return String(candidate || `Track ${String(row.trackId || '').slice(0, 8) || 'unknown'}`);
};

function stat(label, value, detail = '') {
  return `<div class="pp-stat"><span class="pp-stat-label">${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ''}</div>`;
}

export function renderPracticeProfile({ rows = [], coverage = null, trackName } = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object') : [];
  const total = key => safeRows.reduce((sum, row) => sum + number(row[key]), 0);
  const allFinishes = safeRows.flatMap(row => (Array.isArray(row.recentFinishes) ? row.recentFinishes : [])
    .filter(run => run && number(run.timeMs) > 0)
    .map(run => ({ ...run, trackId: row.trackId, label: labelFor(row, trackName) })))
    .sort((a, b) => number(b.at) - number(a.at)).slice(0, 6);
  const activeMs = total('activeMs');
  const finishes = total('finishes');
  const pbs = total('pbs');
  const latest = [...safeRows].sort((a, b) => number(b.lastPlayedAt) - number(a.lastPlayedAt)).slice(0, 5);
  const coveragePercent = Number.isFinite(coverage?.coverageFraction)
    ? Math.round(Math.max(0, Math.min(1, coverage.coverageFraction)) * 100)
    : null;

  const trackItems = latest.length ? latest.map(row => `<li class="pp-track">
    <span class="pp-track-copy"><strong>${esc(labelFor(row, trackName))}</strong><small>${number(row.attempts)} attempts · ${number(row.finishes)} finishes</small></span>
    <span class="pp-track-best">${number(row.bestMs) ? duration(row.bestMs) : number(row.finishes) ? 'PB unavailable' : 'No finish'}</span>
  </li>`).join('') : '<li class="pp-empty">No practice tracks recorded yet.</li>';

  const finishItems = allFinishes.length ? allFinishes.map(run => `<li class="pp-finish">
    <span class="pp-finish-copy"><strong>${esc(run.label)}</strong><small>${esc(dateLabel(run.at))}${run.practiceMs ? ` · ${esc(shortDuration(run.practiceMs))} practice` : ''}</small></span>
    <span class="pp-finish-time">${duration(run.timeMs)}</span>
    ${run.timingNote === true ? '<p class="pp-timing-note">Practice and finish clocks differed substantially on this run. Timing sources can vary; this is a data note, not a verdict.</p>' : ''}
  </li>`).join('') : '<li class="pp-empty">Recent finishes will appear here.</li>';

  return `<details class="polytrack-practice-profile">
  <summary><span class="pp-mark" aria-hidden="true">PT</span><span><strong>Practice history</strong><small>Local history for this racer</small></span><span class="pp-summary-caret" aria-hidden="true"></span></summary>
  <div class="pp-content">
    <div class="pp-stats" aria-label="Practice summary">
      ${stat('Practice time', shortDuration(activeMs), 'tracked active time')}
      ${stat('Finishes', finishes, `${pbs} personal best${pbs === 1 ? '' : 's'}`)}
      ${stat('Attempts', total('attempts'), `${total('restarts')} restarts · ${total('respawns')} respawns`)}
      ${stat('Tracks', safeRows.filter(row=>number(row.attempts)>0).length, coveragePercent === null ? 'tracked locally' : `${coveragePercent}% observed coverage`)}
    </div><details class="pp-more"><summary>More practice stats</summary><div class="pp-stats">
      ${stat('PB time gained', duration(total('improvedMs')), 'across recorded improvements')}
      ${stat('Quick resets', safeRows.reduce((sum,row)=>sum+number(row.restartBuckets?.[0]),0), 'restarted before 5 seconds')}
      ${stat('Unfinished tracks', safeRows.filter(row=>number(row.attempts)>0&&!number(row.finishes)).length, 'started, no recorded finish')}
      ${stat('Finish rate', `${total('attempts')?Math.min(100,Math.round(100*finishes/total('attempts'))):0}%`, 'of observed attempts')}
    </div>
    </details><div class="pp-columns">
      <section class="pp-panel" aria-labelledby="pp-tracks-title"><h3 id="pp-tracks-title">Recent tracks</h3><ul>${trackItems}</ul></section>
      <section class="pp-panel" aria-labelledby="pp-finishes-title"><h3 id="pp-finishes-title">Recent finishes</h3><ul>${finishItems}</ul></section>
    </div>
    <details class="pp-manage"><summary>Manage local history</summary><p>This removes practice observations for this racer on this device, not PBs or saved tracks.</p><button type="button" data-clear-practice-history>Clear practice history...</button></details><p class="pp-footnote">Practice history is stored locally and may be incomplete. Times are informational and are not a cheating determination.</p>
  </div>
</details>`;
}
