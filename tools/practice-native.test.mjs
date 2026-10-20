import test from 'node:test';
import assert from 'node:assert/strict';
import {createPracticeHistory} from './practice-history.mjs';
import {installPracticeObserver} from './practice-native.mjs';

const account='a'.repeat(64),track='b'.repeat(64);
function fixture(options={}){
 let at=100000,tick,shown=true,owner=account;
 class Physics{createCar(_a,_b,_c,_track){return {carState:{frames:0,x:0,y:0,z:0}};}}
 class Car{
  constructor(state){this.state=state;this.reset=[];this.finish=[];this.paused=false;this.started=true;}
  getCarState(){return this.state;}
  getTime(){return {numberOfFrames:this.state.frames};}
  getPosition(){return this.state;}
  hasStarted(){return this.started;}
  hasFinished(){return false;}
  get isPaused(){return this.paused;}
  getNextCheckpointIndex(){return 1;}
  addResetCallback(fn){this.reset.push(fn);return 'reset-registered';}
  addFinishCallback(fn){this.finish.push(fn);}
  dispose(){return 'disposed';}
 }
 if(options.noMotion)delete Car.prototype.getPosition;
 const history=createPracticeHistory({now:()=>at});
 const physics=new Physics();
 const observer=installPracticeObserver({require:id=>({A:id===5220?Physics:Car}),history,accountId:()=>owner,bestMs:()=>options.bestMs||0,clock:()=>at,visible:()=>shown,schedule:fn=>{tick=fn;},cancel(){},placementAfterFinish:options.placementAfterFinish});
 function car(){const c=new Car(physics.createCar(null,null,null,{getId:()=>track}).carState);assert.equal(c.addResetCallback(()=>{}),'reset-registered');return c;}
 return {history,observer,car,step(c,{ms=1000,frames=ms,x=c.state.x}={}){at+=ms;c.state.frames+=frames;c.state.x=x;tick();},hide(){shown=false;},show(){shown=true;},switchAccount(){owner='c'.repeat(64);}};
}

test('native sampling separates moving, stationary, hidden, paused and long gaps',()=>{
 const f=fixture();try{
  const car=f.car();f.step(car,{x:2});f.step(car);f.hide();f.step(car,{x:4});f.show();car.paused=true;f.step(car,{x:6});car.paused=false;
  f.step(car,{ms:60000,x:8});f.step(car,{x:10});
  const row=f.history.get(account,track);
  assert.equal(row.movingMs,2000);assert.equal(row.stationaryMs,1000);assert.equal(row.hiddenMs,1000);assert.equal(row.pausedMs,1000);assert.equal(row.unobservedGapMs,60000);
  assert.equal(row.activeMs,3000);assert.equal(row.longestHuntMs,2000);
 }finally{f.observer.stop();}
});

test('missing or failing motion API preserves race observation without inventing driving',()=>{
 for(const noMotion of [true,false]){
  const f=fixture({noMotion});try{const car=f.car();if(!noMotion)car.getPosition=()=>{throw Error('unavailable');};f.step(car,{x:3});
   const row=f.history.get(account,track);assert.equal(row.activeMs,1000);assert.equal(row.progressingMs,1000);assert.equal(row.motionObservedMs,0);assert.equal(row.movingMs,0);assert.equal(row.longestHuntMs,0);
  }finally{f.observer.stop();}
 }
});

test('resets and implausible position jumps do not count as motion',()=>{
 const f=fixture();try{const car=f.car();f.step(car,{x:10000});assert.equal(f.history.get(account,track).movingMs,0);
  car.state.x=0;for(const fn of car.reset)fn();f.step(car,{x:0});assert.equal(f.history.get(account,track).movingMs,0);
  f.step(car,{x:1});assert.equal(f.history.get(account,track).movingMs,1000);
 }finally{f.observer.stop();}
});

test('same-track recreation carries hunt and account switch never credits previous owner',()=>{
 const f=fixture();try{const first=f.car();f.step(first,{x:2});first.dispose();const second=f.car();f.step(second,{x:3});assert.equal(f.history.get(account,track).longestHuntMs,2000);
  f.switchAccount();f.step(second,{x:4});for(const fn of second.finish)fn();assert.equal(f.history.get(account,track).finishes,0);assert.equal(f.history.get(account,track).movingMs,2000);
  const third=f.car();f.step(third,{x:5});assert.equal(f.history.get('c'.repeat(64),track).movingMs,1000);
 }finally{f.observer.stop();}
});

test('optional placement callback runs once after finish with explicit identity and time',async()=>{
 let calls=0;
 const f=fixture({placementAfterFinish:request=>{calls++;assert.equal(f.history.get(account,track).trackedBestMs,1000);return {...request,at:request.finishedAt,rank:5,total:100,exact:true,complete:true,authoritative:true};}});
 try{const car=f.car();f.step(car,{x:3});for(const fn of car.finish){fn();fn();}await Promise.resolve();assert.equal(calls,1);assert.equal(f.history.get(account,track).firstPlacement.rank,5);}finally{f.observer.stop();}
});

test('placement callback failure, partial boards and mismatching identity/time stay unknown',async()=>{
 for(const patch of [{complete:false},{authoritative:false},{timeMs:999},{trackId:'c'.repeat(64)},{accountId:'c'.repeat(64)},null,'throw']){
  const f=fixture({placementAfterFinish:request=>{if(patch==='throw')return Promise.reject(Error('offline'));return patch===null?null:{...request,at:request.finishedAt,rank:1,total:100,exact:true,complete:true,authoritative:true,...patch};}});
  try{const car=f.car();f.step(car,{x:3});for(const fn of car.finish)fn();await Promise.resolve();assert.equal(f.history.get(account,track).firstPlacement,null);}finally{f.observer.stop();}
 }
});

test('late async placement after observer stop is ignored',async()=>{
 let resolve;const f=fixture({placementAfterFinish:()=>new Promise(r=>resolve=r)});
 const car=f.car();f.step(car,{x:1});for(const fn of car.finish)fn();f.observer.stop();
 resolve({accountId:account,trackId:track,timeMs:1000,at:101000,rank:1,total:100,exact:true,complete:true,authoritative:true});await Promise.resolve();assert.equal(f.history.get(account,track).firstPlacement,null);
});
test('native finish records a slower-than-PB result once',()=>{
 const f=fixture({bestMs:900});try{
  const car=f.car();f.step(car,{frames:1200,x:1});for(const fn of car.finish){fn();fn();}
  const row=f.history.get(account,track);
  assert.equal(row.finishes,1);assert.equal(row.pbs,0);assert.equal(row.bestMs,900);
  assert.equal(row.trackedBestMs,1200);assert.equal(row.lastObservedFinishMs,1200);
  assert.equal(row.recentFinishes[0].timeMs,1200);
 }finally{f.observer.stop();}
});
