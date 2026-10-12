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

test('best finish uses relative placement and requires a meaningful loaded field weight',()=>{
 const tracks={large:{type:'official',name:'Large field'},small:{type:'community',name:'Small field'},unknown:{type:'custom',name:'Custom Track'}};
 const context=vm.createContext({
  normalizedFinishSamples:entry=>entry.finishes,
  MIN_MEANINGFUL_FINISH_WEIGHT:.2,
  knownFinishWeight:finish=>finish.weight,
  rankedPlacementCost:(rank,field)=>100*(rank-1)/Math.max(1,field-1),
  trackInfo:id=>tracks[id]||{name:'Custom Track'},
  escapeHtml:String
 });
 vm.runInContext(`${extract('rankedPlacementPercent')};${extract('bestTrackMarkup')};`,context);
 assert.ok(context.rankedPlacementPercent({rank:3,fieldSize:200})<context.rankedPlacementPercent({rank:2,fieldSize:5}));
 const summary=context.bestTrackMarkup({finishes:[
  {trackId:'small',rank:2,fieldSize:5,weight:2},
  {trackId:'large',rank:3,fieldSize:200,weight:1}
 ]});
 assert.match(summary,/<b>Best<\/b> #3 of 200/);
 assert.match(summary,/<b>Strongest<\/b>/);
 const ineligible=context.bestTrackMarkup({finishes:[
  {trackId:'small',rank:1,fieldSize:4,weight:1},
  {trackId:'small',rank:1,fieldSize:20,weight:.19}
 ]});
 assert.match(ineligible,/at least 5 racers and a track weight of 0\.2x or higher/);
 assert.doesNotMatch(ineligible,/data-track-id=/);
 const unresolved=context.bestTrackMarkup({finishes:[{trackId:'unknown',rank:1,fieldSize:20,weight:.2}]});
 assert.match(unresolved,/data-track-id="unknown" title="Open Custom Track"/);
 assert.match(unresolved,/<b>Best<\/b> #1 of 20/);
});

test('unloaded extra-track metadata never excludes profile or planner finishes',()=>{
 const opportunity=extract('profileOpportunityCandidates');
 const comparison=extract('profileComparisonRoutes');
 const planner=extract('plannerCategoryAvailability');
 for(const fn of [opportunity,comparison,planner])assert.doesNotMatch(fn,/isKnownRankedTrackId\(/);
 assert.match(source,/const cachedFinishes=cachedProfileFinishes\(entry\.userId,entry\);/);
 const opener=extract('openRankedProfile');
 const loader=extract('loadExtraTracksCatalog');
 assert.match(opener,/loadExtraTracksCatalog\(\)\.then\([\s\S]*?openRankedProfile\(userId\)/);
 assert.match(loader,/fetch\(new URL\('catalog\.json/);
 assert.doesNotMatch(loader,/db\(\)|\.collection\(/);
 assert.match(source,/name:'Custom Track', type:'custom'/);
 assert.match(source,/MIN_MEANINGFUL_FINISH_WEIGHT=\.2/);
});

test('ranked footer uses content-sized event tiles and keeps scope controls in flow',()=>{
 const context=vm.createContext({});vm.runInContext(extract('overallFooterLayoutCss'),context);
 const css=context.overallFooterLayoutCss();
 assert.match(css,/grid-template-columns:minmax\(300px,\.85fr\) minmax\(0,1\.15fr\)!important/);
 assert.match(css,/overall-challenge-stack[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/overall-track-scope:not\(\[hidden\]\)[^}]*position:static!important/);
 assert.match(css,/overall-track-scope\[hidden\][^}]*display:none!important/);
 assert.match(css,/competition-track-name[^}]*width:fit-content!important/);
 assert.match(css,/overall-category-control::after[^}]*content:none!important/);
 assert.match(css,/overall-freshness[^}]*width:fit-content!important/);
 assert.match(css,/overall-help-card[^}]*height:auto!important/);
 assert.match(css,/@media\(max-width:620px\)[\s\S]*overflow-y:auto!important/);
 assert.match(source,/rankedPolish\.textContent \+= overallFooterLayoutCss\(\);\s*document\.head\.appendChild\(rankedPolish\)/);
 for(const id of ['overallFirstPage','overallLastPage','overallPageJump'])assert.match(source,new RegExp('id="'+id+'"'));
});

test('ranking info belongs only to the info button and page count is uncluttered',()=>{
 const sync=extract('syncCategorySelect');
 assert.doesNotMatch(sync,/select\.title=|control\.dataset\.tip=/);
 assert.match(sync,/control\.removeAttribute\('data-tip'\)/);
 assert.match(sync,/info\.addEventListener\('pointerenter'/);
 const pager=extract('updateOverallPager');
 assert.match(pager,/status\.setAttribute\('aria-label'/);
 assert.doesNotMatch(pager,/status\.textContent = .*label/);
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

test('info explanation stays in the viewport and accounts for panel transforms',()=>{
 const styles={};let transformed=false;
 const copy={style:{setProperty:(key,value)=>styles[key]=value},getBoundingClientRect:()=>({height:110})};
 const info={getBoundingClientRect:()=>({right:330,top:280})};
 const shell={getBoundingClientRect:()=>({left:40,top:20})};
 const control={querySelector:key=>key==='[data-category-info]'?info:copy,closest:()=>shell};
 const ctx=vm.createContext({window:{innerWidth:360},getComputedStyle:()=>({transform:transformed?'matrix(1,0,0,1,0,0)':'none'})});
 vm.runInContext(extract('positionRankedCategoryDescription'),ctx);
 ctx.positionRankedCategoryDescription(control);assert.equal(styles.width,'336px');assert.equal(styles.left,'12px');assert.equal(styles.top,'160px');
 transformed=true;ctx.positionRankedCategoryDescription(control);assert.equal(styles.left,'-28px');assert.equal(styles.top,'140px');
});

test('footer controls explicitly neutralize legacy flex growth in the column layout',()=>{
 const ctx=vm.createContext({});vm.runInContext(extract('overallFooterLayoutCss'),ctx);const css=ctx.overallFooterLayoutCss();
 const refresh=css.match(/#overallLeaderboardPanel #overallDailyGrid \.overall-freshness\{([^}]+)\}/)[1];
 assert.match(refresh,/flex:0 0 auto!important/);
 assert.match(refresh,/height:auto!important/);
 assert.match(refresh,/font:16px\/1\.25 ForcedSquare,sans-serif!important/);
 const pager=css.match(/#overallLeaderboardPanel #overallDailyGrid \.overall-pager\{([^}]+)\}/)[1];assert.match(pager,/flex:0 0 auto!important/);
 assert.match(css,/competition-result[^}]*text-align:center!important/);
 assert.match(css,/section>small[^}]*border:0!important/);
});

test('event captions override legacy self-alignment and pagination does not stretch to the full column',()=>{
 const ctx=vm.createContext({});vm.runInContext(extract('overallFooterLayoutCss'),ctx);const css=ctx.overallFooterLayoutCss();
 const result=css.match(/#overallLeaderboardPanel #overallDailyGrid \.competition-result\{([^}]+)\}/)[1];
 assert.match(result,/align-self:center!important/);assert.match(result,/text-align:center!important/);
 const pager=css.match(/#overallLeaderboardPanel #overallDailyGrid \.overall-pager\{([^}]+)\}/)[1];
 assert.match(pager,/width:fit-content!important/);assert.match(pager,/align-self:center!important/);assert.match(pager,/max-width:100%!important/);
});
