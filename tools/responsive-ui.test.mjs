import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installResponsiveViewport} from './responsive-ui.mjs';

function fixture({width=1366,height=600,visualHeight=height,containerWidth=width}={}){
  const events=new Map(),visualEvents=new Map(),properties={},frames=new Map();let writes=0,id=0,scrolled=0;
  const html={style:{setProperty(key,value){properties[key]=value;writes++;}},dataset:{}};
  const window={innerWidth:width,innerHeight:height,visualViewport:{width,height:visualHeight,offsetTop:0,
    addEventListener:(key,fn)=>visualEvents.set(key,fn),removeEventListener:key=>visualEvents.delete(key)},
    addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key),
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key)};
  const document={documentElement:html,addEventListener(){},removeEventListener(){},activeElement:{matches:()=>true,closest:()=>true,scrollIntoView:()=>scrolled++}};
  const container={getBoundingClientRect:()=>({width:containerWidth,height})};
  const dispose=installResponsiveViewport({document,window,container});
  const flush=()=>{for(const [id,fn]of frames){frames.delete(id);fn();}};
  return {window,properties,html,dispose,events,visualEvents,frames,flush,writes:()=>writes,scrolled:()=>scrolled};
}
test('uses the content container, not screen resolution or a parent frame',()=>{
  const f=fixture({width:1920,height:1080,containerWidth:600});
  assert.equal(f.properties['--sq-available-width'],'600px');assert.equal(f.html.dataset.sqSpace,'narrow');
  assert.equal(f.properties['--sq-available-height'],'1080px');f.dispose();
});
test('short height is independent of width and keyboard viewport keeps fields reachable',()=>{
  const f=fixture({width:1366,height:700,visualHeight:300});
  assert.equal(f.html.dataset.sqSpace,'short');assert.equal(f.properties['--sq-available-height'],'300px');assert.equal(f.scrolled(),1);f.dispose();
});
test('resize bursts coalesce and unchanged dimensions produce no style writes',()=>{
  const f=fixture(),before=f.writes();for(let i=0;i<100;i++)f.events.get('resize')();
  assert.equal(f.frames.size,1);f.flush();assert.equal(f.writes(),before);
  f.window.visualViewport.height=500;f.visualEvents.get('resize')();f.flush();assert.equal(f.properties['--sq-available-height'],'500px');f.dispose();
  assert.equal(f.events.size,0);assert.equal(f.visualEvents.size,0);
});
test('shared responsiveness does not write canvas size, native scale or the page selector',()=>{
  const module=fs.readFileSync(new URL('./responsive-ui.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(module,/screen\.(width|height)|window\.parent|devicePixelRatio|canvas\.width|\.transform\s*=/);
  const css=fs.readFileSync(new URL('../responsive-ui.css',import.meta.url),'utf8');assert.doesNotMatch(css,/\.pages\s*\{|#ui\s*\{/);
});
test('public optional Overall results use the same gated reader as other public fallback data',()=>{
  const patch=fs.readFileSync(new URL('../polytrack_062_patch.js',import.meta.url),'utf8');
  const branch=patch.slice(patch.indexOf("if(data.resultBundleLocation==='main_results'"),patch.indexOf('direct = normalizeEntries',patch.indexOf("if(data.resultBundleLocation==='main_results'")));
  assert.match(branch,/readDirectPublicSnapshot\(COLLECTIONS.leaderboardsOverall,'main_results'\)/);assert.doesNotMatch(branch,/\.collection\(/);
});
