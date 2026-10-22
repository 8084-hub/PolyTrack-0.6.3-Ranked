import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {generatedNameAt,generatedNameStats,generateFallbackName,generatePublicName,moderatePublicName} from '../workers/ranked/src/public-name-policy.js';

test('existing client arrays have 8742 distinct reachable names, all preserved in the expanded vocabulary',async()=>{
  const client=await fs.readFile(new URL('../polytrack_062_patch.js',import.meta.url),'utf8');
  const words=suffix=>JSON.parse(client.match(new RegExp('const PROFILE_NAME_WORD_'+suffix+' = (\\[[^;]+\\]);'))[1].replaceAll("'",'"'));
  const a=words('A'),b=words('B');
  assert.equal(a.length,93);
  assert.equal(b.length,94);
  const gcd=(a,b)=>b?gcd(b,a%b):a;
  const period=a.length*13*b.length/gcd(a.length,13*b.length);
  const before=new Set();
  for(let h=0;h<period;h++)before.add(a[h%a.length]+b[Math.floor(h/13)%b.length]);
  assert.equal(period,113646);
  assert.equal(before.size,8742);
  const after=new Set(Array.from({length:generatedNameStats.combinations},(_,i)=>generatedNameAt(i)));
  assert.equal(after.size,25600);
  for(const name of before)assert.ok(after.has(name),name);
  for(const name of before)assert.equal(moderatePublicName(name).blocked,false,name);
  const legacy=seed=>{
    const hash=Array.from(String(seed || 'racer')).reduce((acc,char)=>((acc*33)^char.charCodeAt(0))>>>0,5381);
    return a[hash%a.length]+b[Math.floor(hash/13)%b.length];
  };
  for(let i=0;i<10000;i++)assert.equal(generateFallbackName('account-'+i),legacy('account-'+i));
});

test('proposed integration keeps saved defaults and legacy fallbacks, expanding only new defaults',async()=>{
  const source=await fs.readFile(new URL('../polytrack_062_patch.js',import.meta.url),'utf8');
  const begin=source.indexOf('  function getOrCreateDefaultDisplayName(');
  const end=source.indexOf('\n  async function enforceSafeDisplayName',begin);
  assert.ok(begin>=0 && end>begin);
  let getter=source.slice(begin,end);
  const original="const generated = makeFallbackName(accountId) || 'RookieRacer';";
  const replacement="const generated = globalThis.__polytrackNamePolicy?.generatePublicName?.(accountId) || makeFallbackName(accountId) || 'RookieRacer';";
  assert.ok(getter.includes(original)||getter.includes(replacement),'default callsite is recognized');
  getter=getter.replace(original,replacement);
  const run=(existing,policy)=>{
    let writes=0;
    const context=vm.createContext({__polytrackNamePolicy:policy,guestAccountId:'guest-account',LAST_ACTIVE_NAME_KEY:'name',
      sanitizeDisplayName:v=>String(v).trim(),makeFallbackName:generateFallbackName,
      localStorage:{getItem:()=>existing,setItem:()=>{writes++;}}});
    vm.runInContext(getter+';result=getOrCreateDefaultDisplayName("account-a");',context);
    return {name:context.result,writes};
  };
  assert.deepEqual(run('neonracer',{generatePublicName}),{name:'neonracer',writes:0});
  assert.deepEqual(run('Custom Handle',{generatePublicName}),{name:'Custom Handle',writes:0});
  assert.deepEqual(run('Guest',{generatePublicName}),{name:generatePublicName('account-a'),writes:1});
  assert.deepEqual(run('',undefined),{name:generateFallbackName('account-a'),writes:1});
});
