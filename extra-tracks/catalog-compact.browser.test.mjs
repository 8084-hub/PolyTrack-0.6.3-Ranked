import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const fontCss='@font-face{font-family:ForcedSquare;src:url(data:font/woff2;base64,'+fs.readFileSync(new URL('../forced_square.woff2',import.meta.url)).toString('base64')+') format("woff2")}body{font-family:ForcedSquare,sans-serif}';
const require=createRequire(import.meta.url);
let chromium;try{({chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'));}catch{}
const moduleSource=fs.readFileSync(new URL('./catalog-ui.mjs',import.meta.url),'utf8');
const reviewSource=fs.readFileSync(new URL('./review.mjs',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('./catalog.css',import.meta.url),'utf8');
test('catalog header, filters and review controls fit small touch screens with export enabled',{skip:!chromium},async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({hasTouch:true});
  await page.route('**/*',route=>{
   const url=route.request().url();
   if(url==='http://catalog.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><main id="root"></main>'});
   if(url==='http://catalog.test/catalog-ui.mjs')return route.fulfill({contentType:'text/javascript',body:moduleSource});
   if(url==='http://catalog.test/review.mjs')return route.fulfill({contentType:'text/javascript',body:reviewSource});
   return route.abort();
  });
  await page.goto('http://catalog.test/');await page.addStyleTag({content:fontCss+css});await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(async()=>{
   const {mountExtraTracks}=await import('/catalog-ui.mjs');
   window.feedback={};window.exportCount=0;
   window.catalog=mountExtraTracks({document,root:document.querySelector('#root'),entries:Array.from({length:24},(_,i)=>({id:'track-'+i,name:'Track '+i,author:'Test creator',tags:['technical','scenic'],source:'Test collection'})),onExportFeedback:async()=>exportCount++,getFeedback:entry=>feedback[entry.id]||{},onFeedback:(entry,value)=>{feedback[entry.id]={...feedback[entry.id],...value};},onReport:async()=>{}});
   catalog.open();
  });
  for(const [width,height] of [[320,568],[390,844],[568,320],[844,390],[768,1024],[1024,768]]){
   await page.setViewportSize({width,height});
   await page.locator('.sq-extra-header').scrollIntoViewIfNeeded();
   assert.equal(await page.locator('.sq-extra-field').filter({has:page.getByLabel('Sort',{exact:true})}).locator('.sq-extra-filter-count').count(),0,'Sort has no empty count badge');
   if(width<=560){const rows=await page.locator('.sq-extra-check').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert.ok(Math.abs(rows[0]-rows[1])<1,'compact checkboxes share one row');}
   const info=await page.locator('.sq-extra-header').evaluate(el=>({width:el.clientWidth,content:el.scrollWidth,children:[...el.children].map(node=>{const box=node.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,height:box.height,scroll:node.scrollWidth,client:node.clientWidth,button:node.tagName==='BUTTON'};})}));
   assert.ok(info.content<=info.width+1,'header has no overflow at '+width+'x'+height);
   for(const item of info.children){
    assert.ok(item.left>=0&&item.right<=width+1,'header content fits');
    assert.ok(item.scroll<=item.client+1,'header labels are not clipped');
    if(item.button)assert.ok(item.height>=44,'touch header buttons must be at least 44px at '+width+'x'+height);
   }
   if(width===390&&process.env.POLYTRACK_AUDIT_SCREENSHOT_DIR)await page.screenshot({path:process.env.POLYTRACK_AUDIT_SCREENSHOT_DIR+'/catalog-390.png'});
   await page.locator('.sq-extra-export').click();
   const more=page.locator('.sq-extra-more').first();await more.scrollIntoViewIfNeeded();await more.click();
   const menu=page.locator('.sq-extra-more-menu:not([hidden])');
   const bounds=await menu.boundingBox();
   assert.ok(bounds&&bounds.x>=7&&bounds.y>=7&&bounds.x+bounds.width<=width-7&&bounds.y+bounds.height<=height-7,'review popup remains inside '+width+'x'+height);
   if(width===390&&process.env.POLYTRACK_AUDIT_SCREENSHOT_DIR)await page.screenshot({path:process.env.POLYTRACK_AUDIT_SCREENSHOT_DIR+'/review-390.png'});
   await menu.getByRole('button',{name:'Done',exact:true}).click();
   assert.equal(await more.evaluate(node=>node===document.activeElement),true);
  }
  assert.equal(await page.evaluate(()=>exportCount),6);
 }finally{await browser.close();}
});
