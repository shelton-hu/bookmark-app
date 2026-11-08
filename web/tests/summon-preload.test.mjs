import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let generation = 0;
async function modules() {
  const cache = new Map(), id = ++generation;
  async function url(name) {
    if (cache.has(name)) return cache.get(name);
    let js = ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    for (const match of [...js.matchAll(/from "(\.\/[^\"]+)"/g)]) js = js.replace(match[0], `from ${JSON.stringify(await url(match[1].slice(2)))}`);
    const result = `data:text/javascript;base64,${Buffer.from(`// session ${id}\n${js}`).toString('base64')}`;
    cache.set(name, result);
    return result;
  }
  return { ...await import(await url('summonPreload')), ...await import(await url('summonArtwork')), ...await import(await url('summonSequence')) };
}

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function browser({ reduced = false } = {}) {
  const originals = Object.fromEntries(['window', 'document', 'Image', 'fetch', 'setTimeout', 'clearTimeout'].map(key => [key, globalThis[key]]));
  const idle = new Map(), timers = new Map(), images = [], requests = [], draws = [];
  const motion = Object.assign(new EventTarget(), { matches: reduced });
  const doc = Object.assign(new EventTarget(), { hidden: false, createElement: () => ({
    width: 0, height: 0, getContext: () => ({ drawImage(source) { draws.push(source.src ?? 'canvas'); } }),
  }) });
  let next = 0, peak = 0;
  const count = () => { peak = Math.max(peak, images.filter(i => !i.settled).length + requests.filter(r => !r.settled).length); };
  globalThis.window = { matchMedia: () => motion, requestIdleCallback(callback) { idle.set(++next, callback); return next; }, cancelIdleCallback(id) { idle.delete(id); } };
  globalThis.document = doc;
  globalThis.setTimeout = (callback, delay) => { callback.delay = delay; timers.set(++next, callback); return next; };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.Image = class {
    dataset = {};
    naturalWidth = 600; naturalHeight = 1344; settled = false;
    constructor() {
      this.promise = new Promise((resolve, reject) => { this.resolve = () => { this.settled = true; resolve(); }; this.reject = () => { this.settled = true; reject(new Error('image failed')); }; });
      images.push(this); count();
    }
    decode() { return this.promise; }
  };
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
    const request = { url, settled: false, finish() { this.settled = true; resolve({ ok: true, blob: async () => new Blob(['mock'], { type: 'image/png' }) }); }, fail() { this.settled = true; reject(new Error('offline')); } };
    options.signal.addEventListener('abort', () => { request.settled = true; reject(new Error('aborted')); });
    requests.push(request); count();
  });
  return { images, requests, draws, idle, timers, doc, motion, get peak() { return peak; },
    async tick() { const entry = idle.entries().next().value; if (entry) { idle.delete(entry[0]); entry[1](); } await flush(); },
    restore() { Object.assign(globalThis, originals); },
  };
}

test('idle work prioritizes nearby figures, downloads the deck in bounded batches, and never decodes the whole deck', async () => {
  const api = await modules(), b = browser(), session = api.startSummonPreload();
  try {
    session.prioritize(['windy', 'fly', 'shadow', 'watery', 'rain']);
    assert.equal(b.images.length + b.requests.length, 0, 'initial rendering starts no work');
    await b.tick();
    assert.match(b.images[0].src, /windy-restored/);
    for (let i = 0; i < 150 && (b.idle.size || b.images.some(i => !i.settled) || b.requests.some(r => !r.settled)); i++) {
      b.images.filter(i => !i.settled).forEach(i => i.resolve());
      b.requests.filter(r => !r.settled).forEach(r => r.finish());
      await flush(); await b.tick();
    }
    assert.equal(b.images.length, 5, 'only nearby cards are decoded');
    assert.equal(new Set([...b.images.map(i => i.src), ...b.requests.map(r => r.url)]).size, 105);
    assert.ok(b.peak <= 2, `concurrent transfers: ${b.peak}`);
    assert.ok(api.preparedFigure('windy', api.spiritPalette('windy')));
  } finally { session.dispose(); await flush(); b.restore(); }
});

test('playing pauses background canvas work and promotes an in-flight clicked figure without deadlocking', async () => {
  const api = await modules(), b = browser(), session = api.startSummonPreload();
  let resume = () => {};
  try {
    session.prioritize(['windy', 'fly', 'shadow']); await b.tick();
    resume = api.suspendSummonPreload();
    b.images[0].resolve(); await flush(); await b.tick();
    assert.equal(b.draws.length, 0, 'decoded background image waits while an animation plays');
    const figure = await api.loadFigure('windy', api.spiritPalette('windy'));
    assert.ok(figure);
    assert.equal(b.images.length, 1, 'foreground reuses the pending image');
    const draws = b.draws.length;
    await b.tick(); assert.equal(b.draws.length, draws);
    assert.equal(b.idle.size, 0);
    resume(); resume(); // release is idempotent
    await b.tick();
    assert.ok(b.images.length > 1, 'remaining work resumes after playback');
  } finally { resume(); session.dispose(); b.images.filter(i => !i.settled).forEach(i => i.resolve()); await flush(); b.restore(); }
});

test('hidden/reduced-motion hands defer work and disposing aborts downloads and late preparation', async () => {
  const api = await modules(), b = browser({ reduced: true }), session = api.startSummonPreload();
  try {
    session.prioritize(['windy']); await b.tick();
    assert.equal(b.images.length + b.requests.length, 0);
    b.motion.matches = false; b.doc.hidden = true;
    b.motion.dispatchEvent(new Event('change')); await b.tick();
    assert.equal(b.images.length + b.requests.length, 0);
    b.doc.hidden = false; b.doc.dispatchEvent(new Event('visibilitychange')); await b.tick();
    assert.equal(b.images.length, 1);
    session.dispose(); b.images[0].resolve(); await flush(); await b.tick();
    assert.equal(b.draws.length, 0);
    assert.ok(b.requests.every(r => r.settled));
    assert.equal(b.idle.size, 0);
  } finally { session.dispose(); await flush(); b.restore(); }
});

test('prepared textures retain the eight-card LRU and failed images are retried', async () => {
  const api = await modules(), b = browser();
  try {
    const keys = ['windy', 'fly', 'shadow', 'watery', 'rain', 'wood', 'jump', 'illusion', 'silent'];
    for (const key of keys) {
      const pending = api.loadFigure(key, api.spiritPalette(key));
      b.images.at(-1).resolve(); assert.ok(await pending);
    }
    assert.equal(api.preparedFigure(keys[0], api.spiritPalette(keys[0])), null);
    for (const key of keys.slice(1)) assert.ok(api.preparedFigure(key, api.spiritPalette(key)));
    let pending = api.loadFigure('thunder', api.spiritPalette('thunder'));
    b.images.at(-1).reject(); await flush(); b.images.at(-1).reject();
    assert.equal(await pending, null);
    pending = api.loadFigure('thunder', api.spiritPalette('thunder'));
    b.images.at(-1).resolve(); assert.ok(await pending);
  } finally { await flush(); b.restore(); }
});

test('a stalled background image times out, releases its slot, and does not cache a failed result', async () => {
  const api = await modules(), b = browser(), session = api.startSummonPreload();
  try {
    session.prioritize(['windy', 'shadow']); await b.tick();
    assert.equal(b.timers.size, 2);
    [...b.timers.values()].find(callback => callback.delay === 8000)(); await flush();
    assert.equal(b.images[0].src, '', 'stalled image request is stopped');
    assert.equal(api.preparedFigure('windy', api.spiritPalette('windy')), null);
    b.requests.forEach(r => r.finish()); await flush(); await b.tick();
    assert.match(b.images.at(-1).src, /shadow-restored/);
    b.images.at(-1).resolve(); await flush(); await b.tick();
    assert.ok(api.preparedFigure('shadow', api.spiritPalette('shadow')));
    assert.ok(![...b.timers.values()].some(callback => callback.delay === 8000));
  } finally { session.dispose(); await flush(); b.restore(); }
});

test('page startup downloads all resources before any card is browsed without decoding the deck', async () => {
  const api = await modules(), b = browser(), session = api.startSummonPreload();
  try {
    assert.equal(session.getSnapshot().phase, 'loading');
    await b.tick();
    for (let i = 0; i < 100 && b.idle.size + b.requests.filter(r => !r.settled).length; i++) {
      b.requests.filter(r => !r.settled).forEach(r => r.finish()); await flush(); await b.tick();
    }
    assert.equal(b.images.length, 0);
    assert.equal(b.requests.length, 105);
    assert.deepEqual(session.getSnapshot(), { phase: 'ready', completed: 105, total: 105, failed: 0, prepared: 0 });
  } finally { session.dispose(); await flush(); b.restore(); }
});

test('failed startup downloads expose a retry that fetches only missing resources', async () => {
  const api = await modules(), b = browser(), session = api.startSummonPreload();
  try {
    await b.tick(); const missing = b.requests[0].url; b.requests[0].fail();
    for (let i = 0; i < 100 && b.idle.size + b.requests.filter(r => !r.settled).length; i++) {
      b.requests.filter(r => !r.settled).forEach(r => r.finish()); await flush(); await b.tick();
    }
    assert.equal(session.getSnapshot().phase, 'error');
    assert.equal(session.getSnapshot().completed, 104);
    const count = b.requests.length;
    await session.retry(); await b.tick();
    assert.equal(b.requests.length, count + 1);
    assert.equal(b.requests.at(-1).url, missing);
    b.requests.at(-1).finish(); await flush(); await b.tick();
    assert.equal(session.getSnapshot().phase, 'ready');
  } finally { session.dispose(); await flush(); b.restore(); }
});
