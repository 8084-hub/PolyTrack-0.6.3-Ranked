import test from 'node:test';
import assert from 'node:assert/strict';
import { installSiteUpdates, UPDATED_GAME_URL, CANONICAL_SITE_VERSION_URL } from './site-updates.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

class FakeElement {
  constructor(tag, document) {
    Object.assign(this, { tag, document, style: {}, dataset: {}, listeners: {}, children: [], isConnected: false });
  }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  append(...children) {
    for (const child of children) { child.parent = this; child.isConnected = true; this.children.push(child); }
  }
  remove() { this.removed = true; this.isConnected = false; }
  showModal() { if (this.document.dialogFailure) throw Error('dialog unavailable'); this.open = true; }
  close() { this.open = false; }
  focus() { this.document.activeElement = this; }
}
class FakeDocument extends EventTarget {
  constructor() {
    super(); this.visibilityState = 'visible'; this.baseURI = 'https://game.example/path/';
    this.body = new FakeElement('body', this);
    const append = this.body.append.bind(this.body);
    this.body.append = (element) => { append(element); if (element.tag === 'button') this.button = element; };
  }
  hasFocus() { return true; }
  createElement(tag) { return new FakeElement(tag, this); }
  get dialog() { return this.body.children.find(element => element.tag === 'dialog' && !element.removed); }
}

function harness({ response = { revision: 44 }, isIdle = () => true, revision = 43, ...options } = {}) {
  const document = new FakeDocument(); let time = 1000, calls = 0, reloadChecks = 0, nextTimer = 0, currentResponse=response;
  const timers = new Map();
  const handle = installSiteUpdates({ revision, document, now: () => time, isIdle, endpoint: 'site-version.json',
    fetch: async (url, options) => { calls++; const parsed=new URL(url);assert.equal(parsed.origin+parsed.pathname,'https://game.example/path/site-version.json');
      assert.equal(parsed.searchParams.get('_updateCheck'),String(time));assert.equal(options.cache, 'no-store'); return { ok: true, json: async () => currentResponse }; },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id), canReload: () => { reloadChecks++; return false; }, ...options });
  return { document, handle, timers, get calls() { return calls; }, get reloadChecks() { return reloadChecks; }, setTime: (value) => { time = value; }, setResponse: value => { currentResponse=value; } };
}

test('checks same-origin version and offers reload only from a user-clickable notification', async () => {
  const h = harness(); await h.handle.check();
  assert.equal(h.calls, 1); assert.equal(h.document.button.textContent, 'Update available');
  assert.equal(h.document.button.dataset.siteUpdate, 'available');
  assert.equal(h.reloadChecks, 0, 'finding an update must not interrupt the current session');
  h.document.button.listeners.click();
  assert.equal(h.reloadChecks, 1, 'reload safety is checked only after an explicit click');
  h.handle.dispose();
});

test('clears an obsolete update badge when the loaded revision is current', async () => {
  const h=harness();await h.handle.check();
  const badge=h.document.button;assert.equal(badge.dataset.siteUpdate,'available');
  h.setTime(1000+30*60*1000);h.setResponse({revision:'44'});await h.handle.check();
  assert.equal(badge.removed,undefined,'an invalid response must not clear a valid notification');
  h.setTime(1000+60*60*1000);h.setResponse({revision:43});await h.handle.check();
  assert.equal(badge.removed,true);assert.equal(h.document.button,badge);
  h.setTime(1000+90*60*1000);h.setResponse({revision:45});await h.handle.check();
  assert.notEqual(h.document.button,badge);assert.equal(h.document.button.dataset.siteUpdate,'available');
  h.handle.dispose();
});

test('new bootstrap revision clears stale remote state but retains a genuinely newer release',async()=>{
  const h=harness({revision:114,response:{revision:115}});await h.handle.check();
  const badge=h.document.button;assert.ok(badge);
  h.setTime(1000+30*60*1000);h.setResponse({revision:112});await h.handle.check();
  assert.equal(badge.removed,true,'a stale remote manifest cannot leave the old badge visible');
  h.setTime(1000+60*60*1000);h.setResponse({revision:115});await h.handle.check();
  assert.equal(h.document.button.dataset.siteUpdate,'available','a revision newer than the loaded client remains visible');
  h.handle.dispose();
});

test('deduplicates installations and throttles interval and visibility-resume checks', async () => {
  const h = harness();
  assert.equal(installSiteUpdates({ revision: 43, document: h.document, fetch: async () => assert.fail('duplicate') }), h.handle);
  await h.handle.check(); assert.equal(h.calls, 1);
  h.document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); assert.equal(h.calls, 1);
  h.setTime(1000 + 30 * 60 * 1000); await h.handle.check(); assert.equal(h.calls, 2); h.handle.dispose();
});

test('does not check while hidden or not idle', async () => {
  let idle = false; const h = harness({ isIdle: () => idle }); await h.handle.check();
  h.document.visibilityState = 'hidden'; idle = true; await h.handle.check(); assert.equal(h.calls, 0);
  h.document.visibilityState = 'visible'; await h.handle.check(); assert.equal(h.calls, 1); h.handle.dispose();
});

test('rejects invalid revisions and never requests an arbitrary cross-origin endpoint', async () => {
  for (const response of [{ revision: 43 }, { revision: '44' }, { revision: -1 }]) {
    const h = harness({ response }); await h.handle.check(); assert.equal(h.document.button, undefined); h.handle.dispose();
  }
  const document = new FakeDocument();
  const h = installSiteUpdates({ revision: 43, document, endpoint: 'https://other.example/site-version.json',
    fetch: async () => assert.fail('cross-origin request') });
  await h.check(); h.dispose();
});

test('default on a copied build checks only the exact canonical manifest using credential-free CORS', async () => {
  const requests = [];
  const h = harness({revision: 158, endpoint: undefined, fetch: async (url, options) => {
    requests.push({url, options});
    return {ok: true, json: async () => ({revision: 160, minimumSupportedRevision: 159})};
  }});
  await h.handle.check();
  assert.equal(requests.length, 1);
  const {url, options} = requests[0];
  assert.equal(CANONICAL_SITE_VERSION_URL, 'https://staticquasar931.github.io/PolyTrack-0.6.3-Ranked/site-version.json');
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, CANONICAL_SITE_VERSION_URL);
  assert.equal(parsed.search, '?_updateCheck=1000');
  assert.equal(options.method, 'GET');
  assert.equal(options.mode, 'cors');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.equal(options.cache, 'no-store');
  assert.deepEqual(options.headers, {Accept: 'application/json'});
  assert.equal(h.handle.getCompatibility().onlineAllowed, false);
  h.handle.dispose();
});

test('explicit relative and absolute same-origin manifests retain local support', async () => {
  for (const endpoint of ['site-version.json', '/local-version.json', 'https://game.example/test.json?local=1']) {
    let calls = 0;
    const h = harness({endpoint, fetch: async (url, options) => {
      calls++;
      const expected = new URL(endpoint, 'https://game.example/path/');
      const actual = new URL(url);
      assert.equal(actual.origin + actual.pathname, expected.origin + expected.pathname);
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.mode, 'same-origin');
      assert.equal(options.redirect, 'error');
      return {ok: true, json: async () => ({revision: 44})};
    }});
    await h.handle.check();
    assert.equal(calls, 1);
    assert.equal(h.document.button.textContent, 'Update available');
    h.handle.dispose();
  }
});

test('cross-origin allowlist excludes every other host, path, scheme, port, query, fragment and userinfo', async () => {
  for (const endpoint of [
    'https://other.example/site-version.json',
    'https://staticquasar931.github.io/another-game/site-version.json',
    'https://staticquasar931.github.io/PolyTrack-0.6.3-Ranked/other.json',
    'https://staticquasar931.github.io/PolyTrack-0.6.3-Ranked/site-version.json/',
    'http://staticquasar931.github.io/PolyTrack-0.6.3-Ranked/site-version.json',
    'https://staticquasar931.github.io:444/PolyTrack-0.6.3-Ranked/site-version.json',
    `${CANONICAL_SITE_VERSION_URL}?redirect=https://other.example`,
    `${CANONICAL_SITE_VERSION_URL}?_updateCheck=1`, `${CANONICAL_SITE_VERSION_URL}#fragment`,
    'https://name:password@staticquasar931.github.io/PolyTrack-0.6.3-Ranked/site-version.json',
    'https://staticquasar931.github.io.attacker.invalid/PolyTrack-0.6.3-Ranked/site-version.json',
    'data:application/json,{"revision":160}', 'file:///tmp/site-version.json'
  ]) {
    let calls = 0;
    const h = harness({endpoint, fetch: async () => { calls++; return {ok: true}; }});
    await h.handle.check();
    assert.equal(calls, 0, endpoint);
    assert.equal(h.handle.getCompatibility().onlineAllowed, true);
    h.handle.dispose();
  }
});

test('canonical CORS errors and redirects fail open without fallback to a fork manifest', async () => {
  for (const failure of ['cors', 'redirect']) {
    let fail = false;
    const requested = [];
    const h = harness({revision: 158, endpoint: CANONICAL_SITE_VERSION_URL, fetch: async url => {
      requested.push(url);
      if (fail && failure === 'cors') throw new TypeError('Failed to fetch');
      return {ok: true, redirected: fail, json: async () => ({revision: 160, minimumSupportedRevision: 159})};
    }});
    await h.handle.check();
    assert.equal(h.handle.getCompatibility().onlineAllowed, false);
    fail = true; h.setTime(1000 + 30 * 60 * 1000); await h.handle.check();
    assert.equal(h.handle.getCompatibility().onlineAllowed, true);
    assert.equal(h.document.dialog, undefined);
    assert.equal(requested.length, 2);
    assert.ok(requested.every(url => url.startsWith(`${CANONICAL_SITE_VERSION_URL}?_updateCheck=`)));
    h.handle.dispose();
  }
});

test('contains fetch failures and removes the notification on disposal', async () => {
  const h = harness(); await h.handle.check(); h.handle.dispose(); assert.equal(h.document.button.removed, true);
  const document = new FakeDocument();
  const failed = installSiteUpdates({ revision: 43, document, fetch: async () => { throw Error('offline'); } });
  await failed.check(); assert.equal(document.button, undefined); failed.dispose();
});

test('checked-in updater, client loader and published revision agree', () => {
  const root=new URL('../',import.meta.url);
  const revision=JSON.parse(readFileSync(new URL('site-version.json',root),'utf8')).revision;
  const patch=readFileSync(new URL('polytrack_062_patch.js',root),'utf8');
  const index=readFileSync(new URL('index.html',root),'utf8');
  assert.ok(patch.includes(`installSiteUpdates({revision:${revision},`));
  assert.ok(patch.includes(`site-updates.mjs?v=${revision}`));
  assert.ok(index.includes(`polytrack_062_patch.js?v=${revision}`));
});

const INTERVAL = 30 * 60 * 1000;
const unsupported = { revision: 160, minimumSupportedRevision: 159 };
function choices(document) { return document.dialog.children[2].children; }

test('minimum policy is dormant when absent and boundary revisions remain supported', async () => {
  for (const response of [{ revision: 160 }, { revision: 160, minimumSupportedRevision: 0 },
    { revision: 160, minimumSupportedRevision: 158 }]) {
    const states = [];
    const h = harness({revision: 158, response, onCompatibilityChange: state => states.push(state)});
    await h.handle.check();
    assert.equal(h.handle.getCompatibility().onlineAllowed, true);
    assert.equal(h.document.dialog, undefined);
    assert.equal(states.some(state => !state.onlineAllowed), false);
    assert.equal(h.document.button.textContent, 'Update available');
    h.handle.dispose();
  }
});

test('unsupported client shows labelled native blue square dialog with fixed safe new-tab URL', async () => {
  const h = harness({revision: 158, response: {...unsupported, url: 'javascript:evil()',
    updateUrl: 'https://attacker.invalid', message: '<script>bad</script>'}});
  await h.handle.check();
  const dialog = h.document.dialog;
  assert.equal(dialog.open, true);
  assert.equal(dialog['aria-labelledby'], dialog.children[0].id);
  assert.equal(dialog['aria-describedby'], dialog.children[1].id);
  assert.equal(dialog.style.borderRadius, '0');
  assert.equal(dialog.style.background, '#17274d');
  const [open, offline] = choices(h.document);
  assert.equal(open.textContent, 'Open updated game');
  assert.equal(open.href, 'https://staticquasar931.github.io/PolyTrack-0.6.3-Ranked/');
  assert.equal(open.href, UPDATED_GAME_URL);
  assert.equal(open.target, '_blank');
  assert.equal(open.rel, 'noopener noreferrer');
  assert.match(open['aria-label'], /new tab/);
  assert.equal(offline.textContent, 'Stay here offline');
  assert.equal(offline.type, 'button');
  assert.equal(h.document.activeElement, offline);
  assert.equal(h.reloadChecks, 0);
  assert.deepEqual(h.handle.getCompatibility(), {onlineAllowed: false, revision: 158,
    latestRevision: 160, minimumSupportedRevision: 159, reason: 'unsupported'});
  h.handle.dispose();
});

test('offline choice and Escape dismiss without reloading, restore focus and avoid repeated nagging', async () => {
  for (const cancel of [false, true]) {
    let idle = false;
    const h = harness({revision: 158, response: unsupported, isIdle: () => idle});
    const previous = h.document.createElement('button');
    h.document.body.append(previous); previous.focus();
    idle = true;
    await h.handle.check();
    const dialog = h.document.dialog;
    if (cancel) {
      let prevented = false;
      dialog.listeners.cancel({preventDefault() { prevented = true; }});
      assert.equal(prevented, true);
    } else choices(h.document)[1].listeners.click();
    assert.equal(h.document.dialog, undefined);
    assert.equal(h.document.activeElement, previous);
    assert.equal(h.handle.getCompatibility().onlineAllowed, false);
    assert.equal(h.handle.getCompatibility().reason, 'offline-selected');
    h.handle.dispose();
  }
  const h = harness({revision: 158, response: unsupported});
  await h.handle.check(); choices(h.document)[1].listeners.click();
  h.setTime(1000 + INTERVAL); await h.handle.check();
  assert.equal(h.document.dialog, undefined);
  assert.equal(h.handle.getCompatibility().reason, 'offline-selected');
  h.setTime(1000 + 2 * INTERVAL); h.setResponse({revision: 161, minimumSupportedRevision: 160});
  await h.handle.check(); assert.ok(h.document.dialog, 'changed minimum gets a new explanation');
  h.handle.dispose();
});

test('valid supported or absent policy restores online compatibility and closes dialog', async () => {
  for (const response of [{revision: 160}, {revision: 160, minimumSupportedRevision: 158}]) {
    const states = [];
    const h = harness({revision: 158, response: unsupported, onCompatibilityChange: s => states.push(s)});
    await h.handle.check();
    assert.equal(states.at(-1).onlineAllowed, false);
    h.setTime(1000 + INTERVAL); h.setResponse(response); await h.handle.check();
    assert.equal(states.at(-1).onlineAllowed, true);
    assert.equal(h.document.dialog, undefined);
    h.handle.dispose();
  }
});

test('same-minimum checks reuse the dialog and offline choice reports the latest manifest', async () => {
  const h = harness({revision: 158, response: unsupported}); await h.handle.check();
  const dialog = h.document.dialog;
  h.setTime(1000 + INTERVAL); h.setResponse({...unsupported, revision: 161}); await h.handle.check();
  assert.equal(h.document.dialog, dialog);
  choices(h.document)[1].listeners.click();
  assert.equal(h.handle.getCompatibility().latestRevision, 161);
  h.handle.dispose();
});

test('dialog keyboard wraps between the explicit choices without affecting other keys', async () => {
  const h = harness({revision: 158, response: unsupported}); await h.handle.check();
  const [open, offline] = choices(h.document);
  let prevented = 0;
  const key = (key, shiftKey = false) => h.document.dialog.listeners.keydown({key, shiftKey,
    preventDefault() { prevented++; }});
  key('Tab'); assert.equal(h.document.activeElement, open);
  key('Tab', true); assert.equal(h.document.activeElement, offline);
  key('ArrowDown'); assert.equal(prevented, 2);
  h.handle.dispose();
});

test('all malformed policy values fail open, including contradictory minimum above release', async () => {
  for (const minimum of [null, '159', -1, 1.5, Infinity, {}, Number.MAX_SAFE_INTEGER + 1, 161]) {
    const h = harness({revision: 158, response: unsupported}); await h.handle.check();
    assert.equal(h.handle.getCompatibility().onlineAllowed, false);
    h.setTime(1000 + INTERVAL); h.setResponse({revision: 160, minimumSupportedRevision: minimum});
    await h.handle.check();
    assert.equal(h.handle.getCompatibility().onlineAllowed, true, String(minimum));
    assert.equal(h.document.dialog, undefined);
    assert.equal(h.document.button.textContent, 'Update available');
    h.handle.dispose();
  }
});

test('malformed dormant policy cannot suppress the ordinary optional update offer', async () => {
  const h = harness({revision: 158, response: {revision: 160, minimumSupportedRevision: '159'}});
  await h.handle.check();
  assert.equal(h.handle.getCompatibility().onlineAllowed, true);
  assert.equal(h.document.button.textContent, 'Update available');
  assert.equal(h.document.button.style.borderRadius, '0');
  assert.equal(h.document.button.style.background, '#28346a');
  h.document.button.listeners.click();
  assert.equal(h.reloadChecks, 1);
  h.handle.dispose();
});

test('fetch, HTTP, JSON and timeout failures release an existing compatibility restriction', async () => {
  for (const failure of ['fetch', 'http', 'json', 'timeout']) {
    let failing = false;
    const states = [];
    const h = harness({revision: 158, onCompatibilityChange: state => states.push(state),
      fetch: async () => {
        if (!failing) return {ok: true, json: async () => unsupported};
        if (failure === 'fetch') throw Error('offline');
        if (failure === 'timeout') return new Promise(() => {});
        return {ok: failure !== 'http', json: async () => { throw Error('invalid JSON'); }};
      }});
    await h.handle.check();
    failing = true; h.setTime(1000 + INTERVAL);
    const pending = h.handle.check();
    if (failure === 'timeout') {
      await Promise.resolve();
      const timeout = [...h.timers.values()].find(timer => timer.delay === 8000);
      timeout.fn();
    }
    await pending;
    assert.equal(states.at(-1).onlineAllowed, true, failure);
    assert.equal(h.document.dialog, undefined);
    h.handle.dispose();
  }
});

test('dialog API failures and synchronous/asynchronous callback failures fail open', async () => {
  const h = harness({revision: 158, response: unsupported});
  h.document.dialogFailure = true;
  await h.handle.check();
  assert.equal(h.handle.getCompatibility().onlineAllowed, true);
  assert.equal(h.document.dialog, undefined);
  h.handle.dispose();
  for (const asynchronous of [false, true]) {
    const h = harness({revision: 158, response: unsupported, onCompatibilityChange(state) {
      if (!state.onlineAllowed) {
        if (asynchronous) return Promise.reject(Error('callback failed'));
        throw Error('callback failed');
      }
    }});
    await h.handle.check(); await Promise.resolve();
    assert.equal(h.handle.getCompatibility().onlineAllowed, true);
    assert.equal(h.document.dialog, undefined);
    h.handle.dispose();
  }
});

test('callback payloads cannot mutate state, and disposal releases compatibility and UI', async () => {
  const states = [];
  const h = harness({revision: 158, response: unsupported, onCompatibilityChange: state => states.push(state)});
  await h.handle.check();
  assert.equal(Object.isFrozen(states.at(-1)), true);
  const copy = h.handle.getCompatibility(); copy.onlineAllowed = true;
  assert.equal(h.handle.getCompatibility().onlineAllowed, false);
  const dialog = h.document.dialog;
  h.handle.dispose(); h.handle.dispose();
  assert.equal(states.at(-1).reason, 'disposed');
  assert.equal(states.at(-1).onlineAllowed, true);
  assert.equal(dialog.removed, true);
  assert.equal(h.timers.size, 0);
});

test('no compatibility UI appears while busy, including when run starts during fetch', async () => {
  let idle = false;
  const h = harness({revision: 158, response: unsupported, isIdle: () => idle});
  await h.handle.check(); assert.equal(h.calls, 0);
  assert.equal(h.document.dialog, undefined); h.handle.dispose();
  let resolve;
  idle = true;
  const deferred = harness({revision: 158, isIdle: () => idle,
    fetch: () => new Promise(done => { resolve = done; })});
  const pending = deferred.handle.check(); await Promise.resolve();
  idle = false;
  resolve({ok: true, json: async () => unsupported}); await pending;
  assert.equal(deferred.document.dialog, undefined);
  assert.equal(deferred.handle.getCompatibility().onlineAllowed, true);
  deferred.handle.dispose();
});

test('late response after disposal never reinstates restrictions or creates UI', async () => {
  let resolve;
  const h = harness({revision: 158, fetch: () => new Promise(done => { resolve = done; })});
  const pending = h.handle.check(); await Promise.resolve();
  h.handle.dispose(); resolve({ok: true, json: async () => unsupported}); await pending;
  assert.equal(h.handle.getCompatibility().onlineAllowed, true);
  assert.equal(h.document.dialog, undefined);
  assert.equal(h.document.button, undefined);
  assert.equal(h.timers.size, 0);
});

test('disposing before fetch starts avoids the request; ignored abort still releases timers', async () => {
  const early = harness();
  early.handle.dispose(); await Promise.resolve(); await Promise.resolve();
  assert.equal(early.calls, 0);
  assert.equal(early.timers.size, 0);
  const h = harness({fetch: () => new Promise(() => {})});
  const pending = h.handle.check(); await Promise.resolve();
  h.handle.dispose(); await pending;
  assert.equal(h.timers.size, 0);
  assert.equal(h.handle.getCompatibility().onlineAllowed, true);
});

test('unsafe callback hooks and timer failures cannot leave compatibility blocked', async () => {
  const h = harness({revision: 158, response: unsupported,
    onCompatibilityChange() { throw Error('always fails'); }});
  await h.handle.check();
  assert.equal(h.handle.getCompatibility().onlineAllowed, true);
  h.handle.dispose();
  const broken = harness({setTimeout() { throw Error('timer unavailable'); }});
  await broken.handle.check();
  assert.equal(broken.handle.getCompatibility().onlineAllowed, true);
  broken.handle.dispose();
});

// Optional local browser verification. No install/download and no external requests.
let chromium;
try { ({chromium} = createRequire(new URL('./verifier/package.json', import.meta.url))(
  process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch { /* Unit tests remain dependency-free. */ }
test('native dialog keyboard focus, mobile fit and new-tab navigation preserve the current page',
  {skip: !chromium}, async () => {
    const browser = await chromium.launch({headless: true});
    try {
      const context = await browser.newContext();
      await context.route('**/*', route => route.fulfill({contentType: 'text/html', body: '<title>Updated game fixture</title>'}));
      const font = readFileSync(new URL('../forced_square.woff2', import.meta.url));
      await context.route('**/forced_square.woff2', route => route.fulfill({contentType: 'font/woff2', body: font}));
      const page = await context.newPage();
      await page.goto('https://game.example/');
      await page.setContent(`<base href="https://game.example/"><style>
        @font-face {font-family:ForcedSquare;src:url('/forced_square.woff2') format('woff2')}
        body {margin:0;padding:24px;background:#101a35;color:#f5f7ff;font:18px ForcedSquare,sans-serif}
        #before {padding:12px;border:2px solid #7e9bd1;background:#28346a;color:white;font:inherit}
      </style><button id="before">Existing game</button>`);
      const source = readFileSync(new URL('./site-updates.mjs', import.meta.url), 'utf8');
      await page.evaluate(async source => {
        document.getElementById('before').focus();
        const blob = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
        const {installSiteUpdates} = await import(blob);
        URL.revokeObjectURL(blob);
        localStorage.setItem('polytrack-qa-progress', JSON.stringify({track: 'fixture', best: 1234}));
        sessionStorage.setItem('polytrack-qa-session', 'preserve-current-session');
        window.runSentinel = {frames: 4321, track: 'fixture'};
        window.compatibilityOnlineAllowed = true;
        window.compatibilityStates = [];
        window.updater = installSiteUpdates({revision: 158, isIdle: () => true,
          fetch: async () => ({ok: true, json: async () => ({revision: 160, minimumSupportedRevision: 159})}),
          onCompatibilityChange: state => {
            window.compatibilityStates.push(state);
            window.compatibilityOnlineAllowed = state.onlineAllowed !== false;
          }});
        await window.updater.check();
        await document.fonts.ready;
      }, source);
      const session = () => page.evaluate(() => ({local: {...localStorage}, session: {...sessionStorage},
        run: window.runSentinel}));
      const before = await session();
      const dialog = page.getByRole('dialog', {name: 'Update needed for online play'});
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Stay here offline');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Open updated game');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Stay here offline');
      for (const [width, height] of [[320, 568], [568, 320], [1366, 900]]) {
        await page.setViewportSize({width, height});
        assert.equal(await dialog.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight &&
            node.scrollWidth <= node.clientWidth;
        }), true, `dialog fits ${width}x${height}`);
        if (process.env.POLYTRACK_AUDIT_SCREENSHOT_DIR && (width === 320 || width === 1366)) {
          const directory = resolve(process.env.POLYTRACK_AUDIT_SCREENSHOT_DIR);
          mkdirSync(directory, {recursive: true});
          await page.screenshot({path: resolve(directory, `site-compatibility-${width === 320 ? '320px' : 'desktop'}.png`)});
        }
      }
      const popupPromise = page.waitForEvent('popup');
      await page.getByRole('link', {name: 'Open updated game (opens in a new tab)'}).click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(popup.url(), UPDATED_GAME_URL);
      assert.equal(page.url(), 'https://game.example/');
      assert.equal(await popup.evaluate(() => window.opener), null);
      assert.deepEqual(await session(), before, 'opening official URL preserves storage and in-memory session');
      await popup.close(); await page.bringToFront();
      await page.keyboard.press('Escape');
      assert.equal(await dialog.count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'before');
      assert.equal(await page.evaluate(() => window.updater.getCompatibility().onlineAllowed), false);
      assert.equal(await page.evaluate(() => window.compatibilityOnlineAllowed), false);
      assert.deepEqual(await session(), before, 'staying offline preserves all fixture data');
      await page.evaluate(() => window.updater.dispose());
      assert.deepEqual(await session(), before, 'disposal does not clear local data');
    } finally { await browser.close(); }
  });
