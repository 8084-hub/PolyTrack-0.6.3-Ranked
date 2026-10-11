const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const patchPath = process.env.POLYTRACK_PATCH_PATH || path.join(__dirname, '..', 'polytrack_062_patch.js');
const source = fs.readFileSync(patchPath, 'utf8');

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is present`);
  const parameters = source.indexOf('(', start);
  let parameterDepth = 0;
  let body = -1;
  for (let index = parameters; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')' && --parameterDepth === 0) { body = source.indexOf('{', index); break; }
  }
  let depth = 0;
  for (let index = body; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

test('Ranked click invokes the guarded panel opener', async () => {
  let opens = 0;
  const context = vm.createContext({ openRankedPanel: () => { opens += 1; return Promise.resolve(); } });
  vm.runInContext(`${extract('handleRankedButtonClick')};`, context);
  let prevented = 0;
  let stopped = 0;
  context.handleRankedButtonClick({ preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } });
  await Promise.resolve();
  assert.equal(opens, 1);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

test('Ranked panel stays visible and shows retry when opening rejects', async () => {
  const list = { innerHTML: '' };
  const panel = { style: { display: 'none' }, querySelector: selector => selector === '#overallLeaderboardList' ? list : null };
  const logs = [];
  const context = vm.createContext({
    document: { getElementById: id => id === 'overallLeaderboardPanel' ? panel : null },
    ensurePanel: () => {},
    openPanel: async () => { throw new Error('filter render failed'); },
    log: (...args) => logs.push(args)
  });
  vm.runInContext(`${extract('rankedPanelOpenFailed')};${extract('openRankedPanel')};`, context);
  assert.equal(await context.openRankedPanel(), null);
  assert.equal(panel.style.display, 'flex');
  assert.match(list.innerHTML, /Ranked could not finish opening/);
  assert.match(list.innerHTML, /data-rank-retry/);
  assert.match(logs[0].join(' '), /filter render failed/);
});

test('throwing filter adapter is disabled without aborting leaderboard rendering', () => {
  const root = { textContent: '' };
  const logs = [];
  const context = vm.createContext({
    personalFilterRuntime: null,
    rankedFiltersUi: { update: () => { throw new Error('bad saved filter'); } },
    rankedFilterResult: { stale: true },
    rankedFiltersSyncing: false,
    document: { getElementById: id => id === 'overallFilterPanel' ? root : null },
    log: (...args) => logs.push(args)
  });
  vm.runInContext(`${extract('syncRankedFilterRows')};${extract('syncRankedFilterRowsSafely')};`, context);
  assert.equal(context.syncRankedFilterRowsSafely([]), null);
  assert.equal(context.rankedFiltersUi, null);
  assert.equal(context.rankedFilterResult, null);
  assert.equal(context.rankedFiltersSyncing, false);
  assert.equal(root.textContent, 'Saved filters are unavailable.');
  assert.match(logs[0].join(' '), /bad saved filter/);
});

test('reconciliation cannot hide Ranked through Verified-only ancestor text', () => {
  assert.doesNotMatch(source, /function hideVerifiedOnlyToggle\s*\(/);
  assert.doesNotMatch(source, /querySelectorAll\(['"]label,button,div,span['"]\)/);
  assert.doesNotMatch(extract('reconcileUiContents'), /hideVerifiedOnlyToggle/);
  assert.match(source, /function ensureNativeAllRunsDefault\s*\(/);
  assert.match(extract('decorateNativeLeaderboardCosmetics'), /ensureNativeAllRunsDefault\(host\)/);
});

test('permanent Rolling Hills search restoration clears native hidden state',()=>{
 const attributes=new Map([['aria-hidden','true']]);const card={hidden:true,style:{display:'none',removeProperty(name){if(name==='display')this.display='';}},getAttribute:name=>attributes.get(name)||null,removeAttribute:name=>attributes.delete(name)};
 const context=vm.createContext({document:{querySelector:()=>card}});vm.runInContext(`${extract('restorePermanentRollingTrack')};`,context);
 context.restorePermanentRollingTrack();assert.equal(card.hidden,false);assert.equal(card.style.display,'');assert.equal(attributes.has('aria-hidden'),false);
});
test('permanent Rolling Hills survives native search and cached rankings paint before refresh',()=>{
 assert.match(extract('restorePermanentRollingTrack'),/\.sq-featured-events \.sq-permanent-track/);
 assert.match(source,/addEventListener\('input',event=>\{[\s\S]*?\.search-bar-container input[\s\S]*?restorePermanentRollingTrack/);
 const opener=extract('openPanel');
 assert.ok(opener.indexOf('renderEntries(savedEntries,saved)')<opener.indexOf('await withTimeout(fetchOverallEntries(shouldForceRefresh)'));
});
test('patch UI does not expose scoring formula constants', () => {
  for (const pattern of [/Overall RP is 68%/, /20% diminishing track coverage/, /12% protected all-track depth/, /Official tracks use 1\.6x/, /1\.6x type/, /1\.0x type/, /0\.6x type/, /award 9 for first/, /100 points for each/, /base field weight/, /base multiplier is/]) {
    assert.doesNotMatch(source, pattern);
  }
  assert.match(source, /function rankedPlacementCost\(/);
  assert.match(source, /function rankedTrackWeightParts\(/);
  assert.match(source, /warning\.style\.top = '-32px'/);
});

test('Ranked render callbacks preserve a loading state before the first snapshot arrives',()=>{
 const list={innerHTML:''},panel={setAttribute(){}};
 const context=vm.createContext({document:{getElementById:id=>id==='overallLeaderboardList'?list:id==='overallLeaderboardPanel'?panel:null,querySelectorAll:()=>[]},overallCategory:'overall',overallLoadState:{status:'idle'},overallEntriesCache:[],overallPage:0,sortedOverallEntries:()=>[],syncRankedFilterRowsSafely:()=>null,updateOverallPager(){},tr:()=> 'Loading rankings',escapeHtml:String});
 vm.runInContext(extract('renderEntries'),context);
 for(const status of ['idle','loading']){context.overallLoadState={status};context.renderEntries();assert.match(list.innerHTML,/overall-loading/);assert.doesNotMatch(list.innerHTML,/unavailable|No racers|initializing/);}
 context.overallLoadState={status:'error',message:'offline'};context.renderEntries();assert.match(list.innerHTML,/temporarily unavailable/);
});

test('overall pager jumps directly and clamps first/last through bounded page state',()=>{
 let renders=0;const context=vm.createContext({overallPage:0,OVERALL_PAGE_SIZE:10,currentLeaderboardCount:()=>95,renderEntries:()=>{renders++;},flashOverallPage(){}});
 vm.runInContext(`${extract('jumpOverallPage')};`,context);
 assert.equal(context.jumpOverallPage(7),true);assert.equal(context.overallPage,6);
 assert.equal(context.jumpOverallPage(11),false);assert.equal(context.jumpOverallPage(1.5),false);
 assert.equal(context.jumpOverallPage(1),true);assert.equal(context.overallPage,0);
 assert.equal(context.jumpOverallPage(10),true,'last available page is reachable');
 assert.equal(context.overallPage,9);assert.equal(context.jumpOverallPage(11),false,'out-of-range pages are rejected');
 assert.equal(context.jumpOverallPage(9),true);assert.equal(context.overallPage,8);assert.equal(renders,4);
 assert.match(source,/id="overallFirstPage"[\s\S]*?id="overallPageJump"[\s\S]*?id="overallLastPage"/);
 assert.match(source,/event\.target\?\.id!=='overallPageJump'[\s\S]*?jumpOverallPage\(page\)/);
});

test('specific normalized display-name identities are blocked without catching similar handles',()=>{
 const constantsStart=source.indexOf('  const DEFAULT_NAME_BLOCKLIST');
 const constantsEnd=source.indexOf('  function readProfileMap',constantsStart);
 assert.ok(constantsStart>=0&&constantsEnd>constantsStart);
 const context=vm.createContext({});
 vm.runInContext(`${source.slice(constantsStart,constantsEnd)};${extract('sanitizeDisplayName')};${extract('normalizeNameForCheck')};${extract('moderationDecision')};`,context);
 for(const name of ['Kim Jong Un','K1m J0ng Un','Ngrachio445','Ngr4chi0445','Nigervaan','N1g3rv44n','Stephen Hawking','St3ph3n H4wk1ng'])
   assert.equal(context.moderationDecision(name).reason,'blocked-name-identity',`${name} should normalize to the explicit blocked identity`);
 for(const name of ['BLACKBEAUTY','CheatingMiguel'])assert.equal(context.moderationDecision(name).blocked,false,`${name} remains allowed`);
});
