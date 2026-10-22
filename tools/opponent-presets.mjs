export const OPPONENT_PRESET_KEY='polytrack-opponent-shortcut-v1';
const modes=new Set(['accounts','filters','places','relative','recent','percentile']);
const idOf=row=>String(row?.accountId||row?.userId||row?.publicId||'');
const validId=id=>/^[A-Za-z0-9_.:-]{1,128}$/.test(id);
const timeOf=row=>Number(row?.timeMs??row?.frames??row?.raceTimeFrames??0);
const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
const list=(value,min,max)=>[...new Set((Array.isArray(value)?value:[]).filter(Number.isSafeInteger).filter(n=>n>=min&&n<=max))].slice(0,10);
export function shortcutCode(value){
 return /^(?:Shift\+)?Key[BFGJKLNOQUVXYZ]$/.test(value||'')?value:'';
}
export function normalizeOpponentPreset(value={}){
 return {version:1,enabled:value.enabled!==false,key:shortcutCode(value.key)||'KeyG',
  mode:modes.has(value.mode)?value.mode:'relative',limit:Math.round(clamp(value.limit,1,10,10)),
  accounts:[...new Set((Array.isArray(value.accounts)?value.accounts:[]).filter(validId))].slice(0,10),
  places:list(value.places,1,1000000),relative:list(value.relative,-1000000,1000000).length?list(value.relative,-1000000,1000000):[-2,-1,1,2],
  percentileMin:clamp(value.percentileMin,0,100,0),percentileMax:clamp(value.percentileMax,0,100,10),
  after:Number.isSafeInteger(value.after)&&value.after>0?value.after:0,
  before:Number.isSafeInteger(value.before)&&value.before>0?value.before:0,includeSelf:value.includeSelf===true};
}
export function loadOpponentPreset(storage){try{return normalizeOpponentPreset(JSON.parse(storage?.getItem(OPPONENT_PRESET_KEY)||'{}'));}catch{return normalizeOpponentPreset();}}
export function saveOpponentPreset(storage,value){const preset=normalizeOpponentPreset(value);storage.setItem(OPPONENT_PRESET_KEY,JSON.stringify(preset));return preset;}
export function opponentShortcutMatches(event,preset){return preset.enabled&&shortcutCode(preset.key)===(event.shiftKey?'Shift+':'')+event.code&&!event.repeat&&!event.altKey&&!event.ctrlKey&&!event.metaKey;}
export function opponentShortcutLabel(value){return shortcutCode(value).replace('Key','')||'G';}
export function opponentRunAt(row){
 for(const key of ['pbAt','runAt','createdAt','timestamp']){const n=Number(row?.[key]);if(Number.isSafeInteger(n)&&n>0&&n<=8640000000000000)return n;}
 const upload=Number(row?.uploadId??row?.id);return Number.isSafeInteger(upload)&&upload>=1e14?Math.floor(upload/1000):0;
}
export function opponentRecordingId(row){const n=Number(row?.uploadId??row?.id);return Number.isSafeInteger(n)&&n>0?n:null;}
export function selectOpponentRows(input,value,{selfId='',complete=false,totalEntries,filteredIds=[]}={}){
 const preset=normalizeOpponentPreset(value),seen=new Set();
 const rows=(Array.isArray(input)?input:[]).filter(row=>validId(idOf(row))&&Number.isFinite(timeOf(row))&&timeOf(row)>0)
  .slice().sort((a,b)=>timeOf(a)-timeOf(b))
  .filter(row=>{const id=idOf(row);if(seen.has(id))return false;seen.add(id);return true;});
 const exact=complete===true&&(!Number.isSafeInteger(totalEntries)||totalEntries===rows.length);
 if(['places','relative','percentile'].includes(preset.mode)&&!exact)return {rows:[],reason:'Full saved standings are needed for place-based selection.',missing:0,complete:false};
 // Native placement is row-indexed; stable sorting keeps the supplied tie order.
 const placed=rows.map((row,index)=>({row,rank:index+1}));
 const mine=placed.find(item=>idOf(item.row)===selfId),filtered=new Set(filteredIds);
 if(preset.mode==='relative'&&!mine)return {rows:[],reason:'You need a saved finish on this track to choose nearby racers.',missing:0,complete:exact};
 if(preset.mode==='percentile'&&preset.percentileMin>preset.percentileMax)return {rows:[],reason:'The percentile start must be below the end.',missing:0,complete:exact};
 let chosen=placed.filter(item=>preset.includeSelf||idOf(item.row)!==selfId);
 if(preset.mode==='accounts')chosen=chosen.filter(item=>preset.accounts.includes(idOf(item.row))).sort((a,b)=>preset.accounts.indexOf(idOf(a.row))-preset.accounts.indexOf(idOf(b.row)));
 else if(preset.mode==='filters')chosen=chosen.filter(item=>filtered.has(idOf(item.row)));
 else if(preset.mode==='places')chosen=chosen.filter(item=>preset.places.includes(item.rank));
 else if(preset.mode==='relative'){const wanted=new Set(preset.relative.map(offset=>mine.rank+offset));chosen=chosen.filter(item=>wanted.has(item.rank));}
 else if(preset.mode==='percentile')chosen=chosen.filter(item=>{const percent=rows.length<=1?0:100*(item.rank-1)/(rows.length-1);return percent>=preset.percentileMin&&percent<=preset.percentileMax;});
 else if(preset.mode==='recent')chosen=chosen.filter(item=>opponentRunAt(item.row)>0&&(!preset.after||opponentRunAt(item.row)>=preset.after)&&(!preset.before||opponentRunAt(item.row)<preset.before)).sort((a,b)=>opponentRunAt(b.row)-opponentRunAt(a.row)||a.rank-b.rank);
 const missing=preset.mode==='accounts'?preset.accounts.filter(id=>!rows.some(row=>idOf(row)===id)).length:0;
 const playable=chosen.filter(item=>opponentRecordingId(item.row)!==null).slice(0,preset.limit).map(item=>({...item.row,selectionRank:item.rank}));
 return {rows:playable,missing,complete:exact,reason:playable.length?'':chosen.length?'Matching runs have no saved replay.':'No saved runs match this shortcut.'};
}

export function openOpponentPresetDialog({document=globalThis.document,storage=globalThis.localStorage,getProfiles=()=>[],onRun=null,onSave=()=>{},returnFocus=document.activeElement}={}){
 document.getElementById('polytrackOpponentPresetDialog')?.close();
 const dialog=document.createElement('dialog');dialog.id='polytrackOpponentPresetDialog';dialog.className='sq-developer-dialog sq-opponent-preset';
 dialog.setAttribute('aria-labelledby','sqOpponentTitle');
 dialog.innerHTML='<header><h2 id="sqOpponentTitle">Ghost shortcut</h2><button type="button" data-close aria-label="Close ghost shortcut">Close</button></header><main><p>Choose up to 10 ghosts with one key. Works with filters on or paused.</p><div class="sq-opponent-form"><label>Shortcut key<input data-key readonly aria-label="Press a key for the ghost shortcut"></label><label>Choose by<select data-mode><option value="relative">Around my place</option><option value="accounts">Chosen racers</option><option value="filters">My saved filters</option><option value="places">Exact places</option><option value="recent">Most recent PBs</option><option value="percentile">Percentile range</option></select></label><label>Maximum ghosts<input data-limit type="number" min="1" max="10" inputmode="numeric"></label><label class="sq-opponent-check"><input data-enabled type="checkbox">Enable shortcut</label></div><section data-fields><div data-for="accounts"><label>Find a racer<input data-search type="search" placeholder="Name or public racer ID" autocomplete="off"></label><div data-picked></div><div data-results class="sq-opponent-results" aria-label="Racers"></div></div><div data-for="places"><label>Places<input data-places placeholder="1, 3, 5" inputmode="numeric"></label></div><div data-for="relative"><label>Places from me<input data-relative placeholder="-2, -1, 1, 2"></label><small>Negative = ahead. Positive = behind.</small></div><div data-for="recent"><div class="sq-opponent-form"><label>From (local date)<input type="date" data-after></label><label>Through (local date)<input type="date" data-before></label></div><small>Undated runs are skipped.</small></div><div data-for="percentile"><div class="sq-opponent-form"><label>From %<input data-min type="number" min="0" max="100" step="0.1"></label><label>To %<input data-max type="number" min="0" max="100" step="0.1"></label></div><small>0% is first place; 100% is last.</small></div><div data-for="filters"><p>Uses your saved filter rules without changing whether filters are on.</p></div></section><label class="sq-opponent-check"><input data-self type="checkbox">Include my own replay when it matches</label><p role="status" aria-live="polite" data-status></p></main><footer><button type="button" data-run>Save and select now</button><button type="button" data-save>Save shortcut</button></footer>';
 if(!document.getElementById('sqOpponentStyle')){const style=document.createElement('style');style.id='sqOpponentStyle';style.textContent='.sq-opponent-preset{width:min(720px,calc(100vw - 24px));box-sizing:border-box}.sq-opponent-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.sq-opponent-preset label{display:flex;flex-direction:column;gap:6px;margin:10px 0}.sq-opponent-preset .sq-opponent-check{flex-direction:row;align-items:center}.sq-opponent-preset input:not([type=checkbox]),.sq-opponent-preset select{box-sizing:border-box;width:100%;min-height:44px;background:#15234e;border:1px solid #86b8e6;color:#fff;padding:8px;font:inherit}.sq-opponent-results{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;max-height:220px;overflow:auto}.sq-opponent-preset [data-picked]{display:flex;flex-wrap:wrap;gap:6px}.sq-opponent-preset button{min-height:44px}.sq-opponent-preset small{color:#b9d3ed}.sq-opponent-preset [data-status]{min-height:1.4em;color:#86e9ff}.sq-opponent-preset [data-status][data-error=true]{color:#ffb7aa}@media(max-width:480px){.sq-opponent-form,.sq-opponent-results{grid-template-columns:1fr}}';document.head.append(style);}
 const query=s=>dialog.querySelector(s),preset=loadOpponentPreset(storage),selected=new Set(preset.accounts),status=query('[data-status]');
 const date=value=>{if(!value)return '';const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
 query('[data-key]').value=opponentShortcutLabel(preset.key);query('[data-mode]').value=preset.mode;query('[data-limit]').value=preset.limit;query('[data-enabled]').checked=preset.enabled;query('[data-self]').checked=preset.includeSelf;
 query('[data-places]').value=preset.places.join(', ');query('[data-relative]').value=preset.relative.join(', ');query('[data-min]').value=preset.percentileMin;query('[data-max]').value=preset.percentileMax;query('[data-after]').value=date(preset.after);query('[data-before]').value=date(preset.before?preset.before-1:0);
 let key=preset.key;
 const tell=(text,error=false)=>{status.textContent=text;status.dataset.error=String(error);};
 const profiles=()=>{const map=new Map();for(const row of getProfiles()||[])if(validId(idOf(row)))map.set(idOf(row),row);return map;};
 const name=(id,map)=>String(map.get(id)?.name||map.get(id)?.nickname||id);
 const renderUsers=()=>{const map=profiles(),picked=query('[data-picked]'),results=query('[data-results]');picked.replaceChildren();results.replaceChildren();for(const id of selected){const button=document.createElement('button');button.type='button';button.textContent=name(id,map)+' ×';button.setAttribute('aria-label','Remove '+name(id,map));button.onclick=()=>{selected.delete(id);renderUsers();};picked.append(button);}const term=query('[data-search]').value.trim().toLocaleLowerCase();const rows=[...map].filter(([id,row])=>!selected.has(id)&&(!term||id.toLowerCase().includes(term)||String(row.name||row.nickname||'').toLocaleLowerCase().includes(term))).slice(0,24);if(validId(query('[data-search]').value.trim())&&term&&!rows.length&&!selected.has(query('[data-search]').value.trim()))rows.push([query('[data-search]').value.trim(),{}]);for(const [id] of rows){const button=document.createElement('button');button.type='button';button.textContent=name(id,map);button.title=id;button.disabled=selected.size>=10;button.onclick=()=>{selected.add(id);renderUsers();};results.append(button);}};
 const show=()=>{for(const section of dialog.querySelectorAll('[data-for]'))section.hidden=section.dataset.for!==query('[data-mode]').value;};
 query('[data-key]').addEventListener('keydown',event=>{if(event.key==='Tab'||event.key==='Escape')return;event.preventDefault();event.stopPropagation();const next=shortcutCode((event.shiftKey?'Shift+':'')+event.code);if(next&&!event.ctrlKey&&!event.altKey&&!event.metaKey){key=next;query('[data-key]').value=opponentShortcutLabel(next);tell('');}else tell('Choose B, F, G, J, K, L, N, O, Q, U, V, X, Y or Z, optionally with Shift.',true);});
 query('[data-search]').addEventListener('input',renderUsers);query('[data-mode]').addEventListener('change',show);
 const parseList=(selector,negative)=>{const raw=query(selector).value.trim();if(!raw)return [];const parts=raw.split(/[\s,]+/);if(parts.length>10||parts.some(part=>!new RegExp(negative?'^-?\\d+$':'^\\d+$').test(part)))throw Error('Enter up to 10 whole numbers separated by commas.');const values=parts.map(Number);if(values.some(n=>!Number.isSafeInteger(n)||Math.abs(n)>1000000||(!negative&&n<1)))throw Error('Places must be whole numbers from 1 to 1,000,000.');return values;};
 const save=()=>{
  const mode=query('[data-mode]').value,changes={};
  if(mode==='accounts'){
   if(!selected.size)throw Error('Choose at least one racer.');
   changes.accounts=[...selected];
  }else if(mode==='places'){
   changes.places=parseList('[data-places]',false);
   if(!changes.places.length)throw Error('Choose at least one place.');
  }else if(mode==='relative'){
   changes.relative=parseList('[data-relative]',true);
   if(!changes.relative.length)throw Error('Enter places ahead of or behind you.');
  }else if(mode==='recent'){
   changes.after=query('[data-after]').value?new Date(query('[data-after]').value+'T00:00:00').getTime():0;
   const end=query('[data-before]').value?new Date(query('[data-before]').value+'T00:00:00'):null;
   if(end)end.setDate(end.getDate()+1);
   changes.before=end?.getTime()||0;
   if(changes.after&&changes.before&&changes.after>=changes.before)throw Error('The start date must be before the end date.');
  }else if(mode==='percentile'){
   changes.percentileMin=Number(query('[data-min]').value);changes.percentileMax=Number(query('[data-max]').value);
   if(!Number.isFinite(changes.percentileMin)||!Number.isFinite(changes.percentileMax)||changes.percentileMin<0||changes.percentileMax>100||changes.percentileMin>changes.percentileMax)throw Error('Choose a percentile range from 0 to 100.');
  }
  const limit=Number(query('[data-limit]').value);
  if(!Number.isInteger(limit)||limit<1||limit>10)throw Error('Choose from 1 to 10 ghosts.');
  // Inactive modes retain their last valid saved values, never hidden invalid drafts.
  const saved=saveOpponentPreset(storage,{...preset,...changes,enabled:query('[data-enabled]').checked,key,mode,limit,includeSelf:query('[data-self]').checked});
  Object.assign(preset,saved);onSave(saved);return saved;
 };
 query('[data-save]').onclick=()=>{try{save();tell('Shortcut saved.');}catch(error){tell(error.message||'Could not save this shortcut.',true);}};
 query('[data-run]').disabled=typeof onRun!=='function';query('[data-run]').onclick=async()=>{try{const saved=save();await onRun(saved);dialog.close();}catch(error){tell(error.message||'Ghosts could not be selected.',true);}};
 query('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('keydown',event=>event.stopPropagation());dialog.addEventListener('keyup',event=>event.stopPropagation());dialog.addEventListener('close',()=>{dialog.remove();if(returnFocus?.isConnected&&!returnFocus.disabled)returnFocus.focus({preventScroll:true});});
 document.body.append(dialog);show();renderUsers();dialog.showModal();query('[data-key]').focus();return dialog;
}
