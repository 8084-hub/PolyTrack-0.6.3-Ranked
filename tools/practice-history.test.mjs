import test from 'node:test';
import assert from 'node:assert/strict';
import {createPracticeHistory,practiceAdvice,PRACTICE_KEY,HUNT_IDLE_MS} from './practice-history.mjs';
import {installPracticeObserver} from './practice-native.mjs';
const account='a'.repeat(64),track='b'.repeat(64);
function setup(){let at=100000,saved=null,writes=0;const storage={getItem:()=>saved,setItem:(_key,value)=>{saved=value;writes++;}};const history=createPracticeHistory({storage,now:()=>at});return {history,storage,advance:ms=>at+=ms,writes:()=>writes,saved:()=>saved};}
test('practice accumulates active time and resets since-PB time only for an improvement',()=>{
 const h=setup();let attempt=h.history.begin(account,track,20000);attempt.tick(1000,2);attempt.finish(21000);
 assert.equal(h.history.get(account,track).sincePbMs,1000);assert.equal(h.history.get(account,track).pbs,0);
 attempt=h.history.begin(account,track,20000);attempt.tick(1000,3);attempt.finish(19000);
 const row=h.history.get(account,track);assert.equal(row.pbs,1);assert.equal(row.finishes,2);assert.equal(row.sincePbMs,0);assert.equal(row.furthestCheckpoint,3);
});
test('duplicate finishes and post-finish restarts cannot double count',()=>{
 const h=setup(),attempt=h.history.begin(account,track);attempt.tick(1000);attempt.finish(10000);attempt.finish(10000);attempt.restart(10000);attempt.tick(1000);
 const row=h.history.get(account,track);assert.equal(row.finishes,1);assert.equal(row.pbs,1);assert.equal(row.restarts,0);assert.equal(row.activeMs,1000);
});
test('rapid restarts remain in memory and do not cause a write per attempt',()=>{
 const h=setup();for(let i=0;i<50;i++){const attempt=h.history.begin(account,track);attempt.tick(100);attempt.restart(100);}
 assert.equal(h.history.get(account,track).restarts,50);assert.ok(h.writes()<=1);
 h.history.flush(true);assert.equal(h.writes(),2);assert.ok(h.saved().length<2000);
});
test('storage failure does not break racing or delete unrelated data',()=>{
 const history=createPracticeHistory({storage:{getItem(){throw Error('blocked');},setItem(){throw Error('full');}}});
 history.begin(account,track).finish(10000);assert.equal(history.flush(true),false);assert.equal(history.get(account,track).pbs,1);
});
test('clear removes only the requested racers practice, not PBs or another account',()=>{
 const h=setup(),other='c'.repeat(64);h.history.begin(account,track).finish(100);h.history.begin(other,track).finish(200);h.history.clear(account);
 assert.equal(h.history.get(account,track),null);assert.equal(h.history.get(other,track).bestMs,200);
});
test('corrupt and excessive saved history is bounded and sanitized',()=>{
 const accounts={};for(let a=0;a<8;a++){const tracks={};for(let t=0;t<300;t++)tracks[t.toString(16).padStart(64,'0')]={attempts:'bad',activeMs:-1};accounts[a.toString(16).padStart(64,'0')]=tracks;}
 let saved;const history=createPracticeHistory({storage:{getItem:()=>JSON.stringify({version:1,accounts}),setItem:(_key,value)=>saved=value}});history.begin(account,track).finish(100);history.flush(true);
 const parsed=JSON.parse(saved);assert.ok(Object.keys(parsed.accounts).length<=4);for(const tracks of Object.values(parsed.accounts))assert.ok(Object.keys(tracks).length<=256);
});
test('practice is only a bounded hint and sparse data never claims a track is impossible',()=>{
 assert.deepEqual(practiceAdvice(null),{factor:1,text:''});assert.equal(practiceAdvice({attempts:1,activeMs:900000}).factor,1);
 const away=practiceAdvice({attempts:10,activeMs:60000,lastPlayedAt:0},8*86400000);assert.equal(away.factor,1.1);
 const plateau=practiceAdvice({attempts:20,activeMs:1000000,sincePbMs:900000,restartsSincePb:12,restarts:12,lastPlayedAt:10000},10000);assert.equal(plateau.factor,.9);assert.doesNotMatch(plateau.text,/impossible|never|bad player/);
});
function nativeFixture(onLeave=()=>{}){
 class Physics{createCar(_a,_b,_c,track,recording){return {id:1,carState:{frames:0},track,recording};}}
 class Car{constructor(state){this.state=state;this.reset=[];this.finish=[];this.started=true;this.paused=false;this.finished=false;}addResetCallback(fn){this.reset.push(fn);}addFinishCallback(fn){this.finish.push(fn);}getCarState(){return this.state;}getTime(){return {numberOfFrames:this.state.frames};}hasStarted(){return this.started;}hasFinished(){return this.finished;}get isPaused(){return this.paused;}getNextCheckpointIndex(){return 2;}dispose(){return 'native-disposed';}}
 let tick,shown=true,clock=0;const h=setup(),physics=new Physics(),require=id=>({A:id===5220?Physics:Car});
 const observer=installPracticeObserver({require,history:h.history,accountId:()=>account,onLeave,visible:()=>shown,clock:()=>clock,schedule:fn=>{tick=fn;return 1;},cancel(){}});
 const car=(recording=null)=>{const result=physics.createCar(null,null,null,{getId:()=>track},recording);const value=new Car(result.carState);value.addResetCallback(()=>{});return value;};
 return {h,physics,Car,Physics,require,observer,car,tick:()=>{clock+=1000;tick();},hide:()=>shown=false,show:()=>shown=true};
}
test('native observer excludes ghosts, pauses and hidden time; repeated install is idempotent',()=>{
 const f=nativeFixture();try{const ghost=f.car('replay');ghost.state.frames=1000;f.tick();assert.equal(f.h.history.get(account,track),null);
 const car=f.car();car.state.frames=1000;f.tick();f.hide();car.state.frames=2000;f.tick();f.show();car.paused=true;car.state.frames=3000;f.tick();car.paused=false;car.state.frames=4000;f.tick();
 assert.equal(f.h.history.get(account,track).activeMs,2000);
 assert.equal(installPracticeObserver({require:f.require}),f.observer);
 }finally{f.observer.stop();}
});
test('synchronous native car recreation counts a restart, leaving the track does not',async()=>{
 const f=nativeFixture();try{const first=f.car();first.state.frames=6000;f.tick();assert.equal(first.dispose(),'native-disposed');f.car();assert.equal(f.h.history.get(account,track).restarts,1);
 const last=f.car();last.state.frames=3000;last.dispose();await Promise.resolve();assert.equal(f.h.history.get(account,track).restarts,1);
 }finally{f.observer.stop();}
});
test('native finish counts once and native callback/return behavior stays intact',()=>{
 const f=nativeFixture();try{const car=f.car();car.state.frames=12000;car.finished=true;for(const callback of car.finish)callback(car);car.dispose();assert.equal(f.h.history.get(account,track).finishes,1);assert.equal(f.h.history.get(account,track).bestMs,12000);}finally{f.observer.stop();}
});
test('late analytics install cannot replace active event binding hooks',()=>{
 class Physics{};class Car{};Physics.prototype[Symbol.for('polytrack-native-local-binding')]=true;
 assert.throws(()=>installPracticeObserver({require:id=>({A:id===5220?Physics:Car})}),/practice_binding_already_active/);
});

test('a new PB clears the plateau restart count but retains lifetime restarts',()=>{
 const h=setup();for(let i=0;i<12;i++)h.history.begin(account,track,20000).restart(1000);
 h.history.begin(account,track).finish(19000);
 const row=h.history.get(account,track);assert.equal(row.restarts,12);assert.equal(row.restartsSincePb,0);
 assert.notEqual(practiceAdvice({...row,attempts:20,activeMs:1000000,sincePbMs:900000}).factor,.9);
});

test('opening and leaving a track without driving is not a practice attempt',()=>{
 const h=setup();h.history.begin(account,track).leave();
 const row=h.history.get(account,track);assert.equal(row.attempts,0);assert.equal(row.lastPlayedAt,0);
});

test('return hint uses observed improvements on other tracks without changing points',()=>{const at=1000000000,row={trackId:track,attempts:8,activeMs:600000,lastPlayedAt:at-4*86400000};const advice=practiceAdvice(row,at,{otherTracks:['c','d','e'].map(id=>({trackId:id.repeat(64),improvedMs:100,lastPbAt:at-1000}))});assert.equal(advice.factor,1.1);assert.match(advice.text,/3 other tracks improved/);});

test('native leave callback ignores repeated disposal and synchronous replacement',async()=>{let leaves=0;const f=nativeFixture(()=>leaves++);try{const first=f.car();first.dispose();f.car();await Promise.resolve();assert.equal(leaves,0);first.dispose();await Promise.resolve();assert.equal(leaves,0);const last=f.car();last.dispose();await Promise.resolve();assert.equal(leaves,1);last.dispose();await Promise.resolve();assert.equal(leaves,1);}finally{f.observer.stop();}});

const moving={visible:true,paused:false,progressing:true,moving:true};
function observe(h,attempt,evidence=moving,ms=1000){h.advance(ms);attempt.observe(ms,evidence);}

test('tracked best is never seeded from baseline, legacy best or legacy finishes',()=>{
 const h=setup();let a=h.history.begin(account,track,10000);
 assert.equal(h.history.get(account,track).trackedBestMs,0);
 a.finish(12000);assert.equal(h.history.get(account,track).trackedBestMs,12000);
 a=h.history.begin(account,track,9000);a.finish(11000);
 assert.equal(h.history.get(account,track).trackedBestMs,11000);
 assert.equal(h.history.get(account,track).bestMs,9000);
 const legacy={version:1,accounts:{[account]:{[track]:{bestMs:8000,activeMs:5000,recentFinishes:[{at:90000,timeMs:8000}]}}}};
 const restored=createPracticeHistory({storage:{getItem:()=>JSON.stringify(legacy)},now:()=>100000});
 const row=restored.get(account,track);assert.equal(row.trackedBestMs,0);assert.equal(row.observationVersion,0);assert.equal(row.legacyActiveMs,5000);assert.equal(row.movingMs,0);
});

test('observed baseline improvement and ordinary finish PB improvements stay distinct',()=>{
 const h=setup();h.history.begin(account,track,30000).leave();
 h.history.observeBest(account,track,20000);
 h.history.begin(account,track,19000).finish(18000);
 const row=h.history.get(account,track);
 assert.equal(row.biggestObservedImprovementMs,10000);assert.equal(row.biggestPbImprovementMs,1000);assert.equal(row.improvedMs,1000);
 assert.equal(row.trackedBestMs,18000);
 h.history.begin(account,track).finish(22000);assert.equal(h.history.get(account,track).biggestPbImprovementMs,1000);
});

test('observed time categories distinguish stationary clock progress and missing motion',()=>{
 const h=setup(),a=h.history.begin(account,track);
 observe(h,a);observe(h,a,{...moving,moving:false});observe(h,a,{...moving,moving:null});
 observe(h,a,{...moving,progressing:false});observe(h,a,{...moving,paused:true});observe(h,a,{...moving,visible:false,paused:true});
 observe(h,a,moving,10000);
 const row=h.history.get(account,track);
 assert.equal(row.focusedMs,4000);assert.equal(row.progressingMs,3000);assert.equal(row.movingMs,1000);assert.equal(row.motionObservedMs,3000);
 assert.equal(row.stationaryMs,1000);assert.equal(row.idleMs,1000);assert.equal(row.pausedMs,1000);assert.equal(row.hiddenMs,1000);assert.equal(row.unobservedGapMs,10000);
 assert.equal(row.longestHuntMs,1000);assert.equal(row.observationVersion,1);
});

test('hunts span restarts and reloads but count only observed moving time',()=>{
 const h=setup();let a=h.history.begin(account,track);observe(h,a);a.restart(1000);
 a=h.history.begin(account,track);observe(h,a,{...moving,moving:false});observe(h,a);a.leave();h.history.flush(true);
 const reloaded=createPracticeHistory({storage:h.storage,now:()=>104000});
 reloaded.begin(account,track).observe(1000,moving);
 const row=reloaded.get(account,track);assert.equal(row.longestHuntMs,3000);assert.equal(row.hunt.movingMs,3000);
 const clone=reloaded.get(account,track);clone.hunt.movingMs=999999;assert.equal(reloaded.get(account,track).hunt.movingMs,3000);
});

test('track switch and long stationary/hidden/paused inactivity break hunts',()=>{
 for(const evidence of [{...moving,moving:false},{...moving,visible:false},{...moving,paused:true}]){
  const h=setup();let a=h.history.begin(account,track);observe(h,a);observe(h,a);h.advance(HUNT_IDLE_MS+1);a.observe(1000,evidence);observe(h,a);
  assert.equal(h.history.get(account,track).hunt.movingMs,1000);assert.equal(h.history.get(account,track).longestHuntMs,2000);
  a.leave();h.history.begin(account,'c'.repeat(64)).leave();a=h.history.begin(account,track);observe(h,a);
  assert.equal(h.history.get(account,track).hunt.movingMs,1000);
 }
});

test('legacy tick has no motion coverage and never creates a hunt',()=>{
 const h=setup(),a=h.history.begin(account,track);a.tick(1000);
 const row=h.history.get(account,track);assert.equal(row.observationVersion,0);assert.equal(row.longestHuntMs,0);assert.equal(row.motionObservedMs,0);
});

test('first placement requires a matching new finish and complete authoritative exact evidence',()=>{
 const h=setup();const a=h.history.begin(account,track,9000);
 const evidence={rank:4,total:100,exact:true,complete:true,authoritative:true,timeMs:10000,finishedAt:100000,at:100000};
 assert.equal(h.history.observePlacement(account,track,evidence),false);
 const finish=a.finish(10000);assert.deepEqual(finish,{timeMs:10000,finishedAt:100000});
 for(const patch of [{complete:false},{authoritative:false},{exact:false},{at:undefined},{at:99999},{total:3},{timeMs:9000},{finishedAt:99999},{rank:1.5}])assert.equal(h.history.observePlacement(account,track,{...evidence,...patch}),false);
 assert.equal(h.history.get(account,track).firstPlacement,null);
 assert.equal(h.history.observePlacement(account,track,evidence),true);
 assert.equal(h.history.observePlacement(account,track,{...evidence,rank:2}),false);
 h.history.flush(true);const restored=createPracticeHistory({storage:h.storage,now:()=>100000});assert.equal(restored.get(account,track).firstPlacement.rank,4);
});

test('late placement for an older finish is rejected and storage remains bounded',()=>{
 const h=setup();const old=h.history.begin(account,track).finish(10000);h.advance(1000);h.history.begin(account,track).finish(9000);
 assert.equal(h.history.observePlacement(account,track,{...old,at:101000,rank:2,total:100,complete:true,authoritative:true,exact:true}),false);
 const a=h.history.begin(account,track);for(let i=0;i<10000;i++)a.observe(1000,moving);h.history.flush(true);
 assert.ok(h.saved().length<3000);assert.equal(h.history.get(account,track).firstPlacement,null);
});

test('new observation timestamps round-trip at real epoch scale without duration clamping',()=>{
 let saved;const at=Date.UTC(2026,9,18),storage={getItem:()=>saved,setItem:(_key,value)=>saved=value};
 const h=createPracticeHistory({storage,now:()=>at});const a=h.begin(account,track);a.observe(1000,moving);a.finish(12000);h.flush(true);
 const row=createPracticeHistory({storage,now:()=>at}).get(account,track);
 assert.equal(row.observedStartedAt,at);assert.equal(row.lastObservedFinishAt,at);assert.equal(row.trackedBestMs,12000);assert.equal(row.observationVersion,1);
});
