import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {eventResetLabel,eventRewardLabel} from './client.mjs';
const require=createRequire(new URL('../tools/verifier/package.json',import.meta.url));
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const source=fs.readFileSync(new URL('./client.mjs',import.meta.url),'utf8');
const renderers=source.slice(source.indexOf('  function cardStandings(period){'),source.indexOf('  function selectView('));
const css=fs.readFileSync(new URL('./events.css',import.meta.url),'utf8');
const endsAt=Date.UTC(2026,9,26);
function cards(){
 const ctx={cache:new Map(),read:()=>null,STORE:'fixture',knownPeriods:new Map(),bridge:{thumbnail:()=>'<img alt="">'},escape:v=>String(v??''),recordMarkup:()=>'<time>00:24.123</time><small>Saved on this device</small>',periodName:p=>p.trackName,eventRewardLabel,reset:p=>eventResetLabel(p,'en-US'),now:()=>endsAt-1000};
 return vm.runInNewContext(`(()=>{${renderers};return cards(${JSON.stringify(['weekly','daily'].map(kind=>({id:kind,kind,trackId:'a'.repeat(64),trackName:'A longer event track name',endsAt,maxRp:kind==='weekly'?500:100,entrantLimit:200,scheduleOnly:true})))});})()`,ctx);
}
test('reset dates use actual boundaries and reject missing or invalid dates',()=>{
 assert.equal(eventResetLabel({endsAt},'en-US'),new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(endsAt)+' Local');
 for(const value of [undefined,null,NaN,Infinity,-1,Number.MAX_SAFE_INTEGER,'2026-10-26'])assert.equal(eventResetLabel({endsAt:value}),'Reset date unavailable');
 assert.notEqual(eventResetLabel({endsAt},'en-US'),eventResetLabel({endsAt:endsAt+86400000},'en-US'));
});
test('reward caps stay distinct from personal PB points and never invent zero capacity',()=>{
 assert.equal(eventRewardLabel({maxRp:500,rp:42,runAt:1}),'Up to 500 Event RP');
 assert.equal(eventRewardLabel({maxRp:500,scheduleOnly:true}),'Practice available; event scoring not confirmed');
 for(const maxRp of [undefined,0,-1,NaN])assert.equal(eventRewardLabel({maxRp}),'Event RP details unavailable');
 const html=cards();assert.match(html,/Practice available; event scoring not confirmed/);assert.doesNotMatch(html,/Awaiting|\bOpen\b|verified|earned|Up to \d+ Event RP|Server confirmation pending/);
});
test('permanent incentive remains a capacity label even when a personal result exists',()=>{
 const start=source.indexOf('    if(permanentNote){'),end=source.indexOf('    if(group&&!group.querySelector',start);
 assert(start>=0&&end>start);
 const permanentNote={textContent:'',title:''};
 vm.runInNewContext(source.slice(start,end),{permanentNote,permanent:{entries:[{accountId:'mine',rp:42,runAt:1}]},bridge:{accountId:()=> 'mine'},now:()=>86400000});
 assert.equal(permanentNote.textContent,'Normal RP + up to 1001 Event RP / No reset');
 assert.doesNotMatch(permanentNote.textContent,/42|ago/);
});
test('featured event metadata and PB icons fit desktop and phone viewports',async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage();
  await page.setContent(`<style>body{margin:0}.wrapper{width:100%;display:grid}.personal-best img{width:100%;height:300px;position:absolute;top:-100px}</style><div id="ui"><div class="track-selection-ui"><div class="tracks-container"><div class="wrapper"><section class="sq-featured-events sq-event-track-group"><h2 class="sq-featured-heading">Events</h2><div class="track track-of-the-week sq-kodub-weekly"><button class="button"><img alt=""><div class="track-of-the-week-info"><div class="title">Kodub weekly</div><div class="time-remaining">17h remaining</div><div class="personal-best"><div><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">00:24.123</div></div><small class="sq-kodub-reward">Up to 700 Event RP</small></div></button></div><div class="track sq-permanent-track"><button class="button"><div class="track-title"><p>Rolling Hills Racer</p></div><img class="thumbnail"><div class="record">00:19.993</div><small class="sq-permanent-note">Normal RP + up to 1001 Event RP / No reset</small></button></div><div class="sq-event-track-buttons">${cards()}</div></section></div></div></div></div>`);
  await page.addStyleTag({content:css});
  for(const [width,height] of [[1366,600],[1024,600],[844,390],[390,844],[320,568]]){
   await page.setViewportSize({width,height});
   for(const card of await page.locator('.sq-event-card').all()){
    const box=await card.boundingBox(),reset=await card.locator('.sq-event-reset').boundingBox();
    assert(box.x>=0&&box.x+box.width<=width+1,`card fits ${width}`);
    assert(reset.y>=box.y&&reset.y+reset.height<=box.y+box.height+1,`reset fits ${width}`);
    const reward=await card.locator('.sq-event-reward').boundingBox(),assignment=await card.locator('.sq-event-assignment').boundingBox();
    assert(reward.y+reward.height<=assignment.y+1&&assignment.y+assignment.height<=reset.y+1,`metadata does not overlap ${width}`);
    assert.equal(await card.locator('.sq-event-capacity').isVisible(),false);
   }
   const icon=await page.locator('.personal-best img').boundingBox(),line=await page.locator('.personal-best>div').boundingBox();
   assert.equal(icon.height,22);assert.equal(icon.width,22);
   assert(icon.y>=line.y&&icon.y+icon.height<=line.y+line.height+1,`timer stays in PB row ${width}`);
   assert.equal(await page.locator('.sq-kodub-reward').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  }
 }finally{await browser.close();}
});
