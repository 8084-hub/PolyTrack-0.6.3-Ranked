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
  assert.equal(result.ageLine,'Snapshot 2h old');
  assert.equal(result.updateLine,'Track updated 240h ago');
  assert.equal(result.baseSource,'snapshot');
});
test('fallback package age does not claim an unchanged track was just checked',()=>{
  const result=context.trackFreshnessPresentation({status:'snapshot',fetchedAt:now-240*3600000},null,false,now-3600000);
  assert.equal(result.ageLine,'Snapshot package 1h old');
  assert.equal(result.updateLine,'Track updated 240h ago');
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
  assert.equal(result.ageLine,'Snapshot age unknown');
  assert.equal(result.updateLine,'Track update time unknown');
});
