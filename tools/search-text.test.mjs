import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSearchText,searchMatches,searchAliases,TRACK_SEARCH_ALIASES} from './search-text.mjs';
test('stylized letters, accents, invisible marks and punctuation have plain text search forms',()=>{
 assert.equal(normalizeSearchText('𝓦𝓲𝓷𝓭𝓸𝔀 Ｃｌｅａｎｅｒ'),'window cleaner');
 assert.ok(searchMatches('nurburgring','Nürburgring'));
 assert.ok(searchMatches('foo bar','foo\u200b','BAR!'));
 assert.ok(searchMatches('','any'));assert.equal(searchMatches('nope','track'),false);
});
test('explicit aliases remain bounded and do not change displayed input',()=>{
 for(const group of TRACK_SEARCH_ALIASES)for(const alias of group)assert.ok(searchMatches(alias,group[0]));
 assert.ok(searchMatches('boxed in','B⛶XED IN'));assert.ok(searchMatches('atlantis','𐌀𐌕𐌋𐌀𐌍𐌕𐌉𐌔'));assert.ok(searchMatches('season','ѕєαѕση'));assert.ok(searchMatches('a09','AO9-race'));
 assert.deepEqual(searchAliases('unrelated'),[]);
});

test('every built-in plain catalog name matches its actual decorative metadata',async()=>{
 const {readFile}=await import('node:fs/promises');
 const records=JSON.parse(await readFile(new URL('../tracks/search-metadata.json',import.meta.url),'utf8'));
 const catalog=JSON.parse(await readFile(new URL('../tracks/catalog.json',import.meta.url),'utf8')).tracks;
 assert.equal(records.length,catalog.length);
 for(const row of records){const track=catalog.find(item=>item.thumbnail===row.thumbnail);assert.ok(track);assert.equal(row.plainName,track.name);assert.ok(searchMatches(track.name,row.name),'Plain name: '+track.name);}
});
