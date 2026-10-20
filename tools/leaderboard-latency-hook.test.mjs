import test from 'node:test';
import assert from 'node:assert/strict';
import {installNativeInitialOpenLatencyHook,isVerifiedNativeInitialLeaderboardSchedule} from './leaderboard-latency-hook.mjs';

const nativeStack='Error\n    at Object.open (http://127.0.0.1:1234/main.bundle.js?v=168:20:1523594)';
const nativeCallback=()=>{if(!request.isCancelled) service.getLeaderboard();};

test('only the pinned native 500 ms leaderboard schedule qualifies',()=>{
  assert.equal(isVerifiedNativeInitialLeaderboardSchedule(nativeCallback,500,nativeStack),true);
  assert.equal(isVerifiedNativeInitialLeaderboardSchedule(nativeCallback,499,nativeStack),false);
  assert.equal(isVerifiedNativeInitialLeaderboardSchedule(nativeCallback,500,'Error\n at patch.js:20:2'),false);
  assert.equal(isVerifiedNativeInitialLeaderboardSchedule(()=>service.getLeaderboard(),500,nativeStack),false);
  assert.equal(isVerifiedNativeInitialLeaderboardSchedule(()=>{if(!request.isCancelled) service.load();},500,nativeStack),false);
  assert.equal(isVerifiedNativeInitialLeaderboardSchedule('not a function',500,nativeStack),false);
});

test('unmatched schedule is forwarded and timer override is restored during click',()=>{
  const delays=[],events=[];
  const button={isConnected:true,listener:null,addEventListener(_name,listener){this.listener=listener;},removeEventListener(_name,listener){if(this.listener===listener)this.listener=null;}};
  const root={listener:null,addEventListener(_name,listener){this.listener=listener;},removeEventListener(_name,listener){if(this.listener===listener)this.listener=null;},querySelector(selector){return selector.startsWith('script')?{}:null;}};
  const original=(callback,delay)=>{delays.push(delay);return delays.length;};
  const view={setTimeout:original,clearTimeout(){}};
  const uninstall=installNativeInitialOpenLatencyHook({window:view,document:root,onEvent:event=>events.push(event)});
  root.listener({target:{closest:()=>button}});
  assert.notEqual(view.setTimeout,original);
  view.setTimeout(()=>{},500);
  button.listener();
  assert.equal(view.setTimeout,original);
  assert.deepEqual(delays,[0,500]);
  assert.deepEqual(events,['armed','restored']);
  uninstall();
  assert.equal(root.listener,null);
});
