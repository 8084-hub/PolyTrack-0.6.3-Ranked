const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../polytrack_062_patch.js'),'utf8');
const helper=source.match(/  function trackFreshnessPresentation\([\s\S]*?\r?\n  \}/)[0];
const now=1800000000000;
test('rounded durations do not claim the next hour or day early',()=>{
  const body=source.match(/  function durationLabel\([\s\S]*?\r?\n  \}/)[0];
  const context=vm.createContext({});
  vm.runInContext(body,context);
  assert.equal(context.durationLabel(3600000-1),'59m');
  assert.equal(context.durationLabel(86400000-1),'23h');
  assert.equal(context.durationLabel(86400000),'1d');
});
const context=vm.createContext({Date:{now:()=>now},durationLabel:value=>`${Math.floor(value/3600000)}h`,ageLabel:value=>`${Math.floor((now-value)/3600000)}h ago`});
vm.runInContext(helper,context);

test('fresh snapshot and old track update are independent timestamps',()=>{
  const result=context.trackFreshnessPresentation({status:'snapshot',fetchedAt:now-240*3600000},{source:'public-backup',snapshotCapturedAt:now-2*3600000},false,now);
  assert.equal(result.sourceLine,'Snapshot 2h old');
  assert.equal(result.updateLine,'Standings changed 240h ago');
  assert.equal(result.baseSource,'snapshot');
  assert.equal(result.sourceLabel,'Snapshot');
});
test('fallback package age does not claim an unchanged track was just checked',()=>{
  const result=context.trackFreshnessPresentation({status:'snapshot',fetchedAt:now-240*3600000},null,false,now-3600000);
  assert.equal(result.sourceLine,'Snapshot package 1h old');
  assert.equal(result.updateLine,'Standings changed 240h ago');
});
test('mixed sources identify their actual base and failed refresh does not erase it',()=>{
  for(const [status,cached,base] of [['snapshot',{source:'public-backup'},'snapshot'],['cloud',{},'live'],['stale',{source:'cloud'},'cache'],['stale',{source:'public-backup'},'snapshot']]){
    const result=context.trackFreshnessPresentation({status},cached,true);
    assert.equal(result.baseSource,base);
    assert.match(result.sourceLabel,/\+ local PB$/);
    assert.equal(result.source,status==='stale'?'error':'mixed');
  }
});
test('unknown activity and capture times remain unknown rather than fabricated',()=>{
  const result=context.trackFreshnessPresentation({status:'snapshot'},null,false);
  assert.equal(result.sourceLine,'Snapshot age unknown');
  assert.equal(result.updateLine,'Standings change time unknown');
});

test('snapshot capture age appears once alongside its source, separate from track update age',()=>{
  const result=context.trackFreshnessPresentation({status:'snapshot',fetchedAt:now-72*3600000},{source:'public-backup',snapshotCapturedAt:now-9*3600000},false,now);
  assert.equal(result.sourceLine,'Snapshot 9h old');
  assert.equal(result.updateLine,'Standings changed 72h ago');
  assert.doesNotMatch(result.sourceLine,/track updated/i);
});

test('mixed snapshot source keeps local PB explicit without duplicating Snapshot',()=>{
  const result=context.trackFreshnessPresentation({status:'snapshot',fetchedAt:now-72*3600000},{source:'public-backup',snapshotCapturedAt:now-9*3600000},true,now);
  assert.equal(result.sourceLine,'Snapshot 9h old + local PB');
  assert.equal(result.updateLine,'Standings changed 72h ago');
});

test('confirmed uploaded PB provenance is distinct from a local-only PB',()=>{
  const state={status:'snapshot',fetchedAt:now-72*3600000};
  const cached={source:'public-backup',snapshotCapturedAt:now-9*3600000};
  assert.equal(context.trackFreshnessPresentation(state,cached,true,now,'submitted PB').sourceLine,'Snapshot 9h old + submitted PB');
  assert.equal(context.trackFreshnessPresentation(state,cached,true,now,'local PB').sourceLine,'Snapshot 9h old + local PB');
});

test('snapshot markup bolds an escaped age label',()=>{
  const markup=source.match(/  function trackFreshnessSourceHtml\([\s\S]*?\r?\n  \}/)[0];
  const renderContext=vm.createContext({escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
  vm.runInContext(markup,renderContext);
  assert.equal(renderContext.trackFreshnessSourceHtml('snapshot','Snapshot 2h old'),'<b class="track-data-snapshot-age">Snapshot</b> 2h old');
  assert.match(renderContext.trackFreshnessSourceHtml('snapshot','Snapshot <img> old'),/&lt;img&gt;/);
});
