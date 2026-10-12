const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','polytrack_062_patch.js'),'utf8');
const start=source.indexOf('  let overallPageOffset=0,');
const end=source.indexOf('  function handleArchivePageShortcut(',start);
function fixture(){
 let now=1000;const jumps=[];const panel={querySelector:()=>null};
 const context=vm.createContext({Date:{now:()=>now},HTMLInputElement:class{},HTMLTextAreaElement:class{},HTMLSelectElement:class{},document:{getElementById:()=>panel},isElementVisible:value=>Boolean(value),overallPage:4,currentLeaderboardCount:()=>400,OVERALL_PAGE_SIZE:10,
 shortcutDigit:event=>/^Digit[0-9]$/.test(event.code)?Number(event.code.at(-1))||10:null,
 jumpOverallPage:page=>{if(page<1||page>40)return false;jumps.push(page);context.overallPage=page-1;return true;},changeOverallPage:delta=>context.overallPage+=delta});
 vm.runInContext(source.slice(start,end),context);
 const key=(code,other={})=>context.handleOverallLeaderboardShortcut({code,key:'',target:null,shiftKey:true,preventDefault(){},stopPropagation(){},...other});
 return {context,jumps,key,advance:()=>now+=4000};
}
test('relative page shortcuts add and subtract without changing direct Shift digits',()=>{
 const f=fixture();f.key('Equal');f.key('Digit5');assert.deepEqual(f.jumps,[10]);
 f.key('Minus');f.key('Digit3');assert.deepEqual(f.jumps,[10,7]);
 f.key('Digit2');assert.deepEqual(f.jumps,[10,7,2]);
 f.key('NumpadAdd');f.key('Digit0');assert.deepEqual(f.jumps,[10,7,2,12]);
});
test('relative page prefix expires and typing or modifiers do not trigger paging',()=>{
 const f=fixture();f.key('Equal');f.advance();f.key('Digit5');assert.deepEqual(f.jumps,[5]);
 f.key('Equal',{ctrlKey:true});f.key('Digit3');assert.equal(f.jumps.at(-1),3);
 f.key('Digit4',{target:new f.context.HTMLInputElement()});assert.equal(f.jumps.at(-1),3);
 f.key('Minus',{repeat:true});f.key('Digit2');assert.equal(f.jumps.at(-1),2);
});

test('relative jumps clamp to available pages rather than silently doing nothing',()=>{
 const f=fixture();f.key('Minus');f.key('Digit9');assert.equal(f.jumps.at(-1),1);
 f.context.overallPage=37;f.key('Equal');f.key('Digit9');assert.equal(f.jumps.at(-1),40);
});
