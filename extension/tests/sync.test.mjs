import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeServer, makeDraft, uploadDraft, permissionOrigin} from '../core.mjs';

test('server accepts LAN origin and rejects credentials/paths/non-http schemes', () => {
  assert.equal(normalizeServer(' http://192.168.1.5:8093/ '), 'http://192.168.1.5:8093');
  assert.equal(permissionOrigin('https://nas.local:8093'), 'https://nas.local:8093/*');
  for (const url of ['file:///tmp', 'http://user:pass@nas.local', 'http://nas.local/api', 'http://nas.local/?secret=a']) assert.throws(() => normalizeServer(url));
});
test('privacy toggle strips excerpt while retaining URL metadata and bounded fields', () => {
  const page = {url: 'https://example.com', title: 'a'.repeat(1200), description: 'b'.repeat(2500), excerpt: 'c'.repeat(14000)};
  const a = makeDraft(page, false); assert.equal(a.payload.excerpt, ''); assert.equal(a.payload.title.length, 1000);
  const b = makeDraft(page, true); assert.equal(b.payload.excerpt.length, 12000); assert.equal(b.payload.description.length, 2000);
  assert.throws(() => makeDraft({url: 'chrome://settings'}));
});
test('upload requires acknowledged ID and never sends cookie credentials', async () => {
  const draft = makeDraft({url: 'https://example.com', title: 'hello'});
  const result = await uploadDraft('http://nas.local:8093', 'revocable', draft, async (url, options) => {
    assert.equal(url, 'http://nas.local:8093/api/bookmarks'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, 'Bearer revocable'); assert.equal(JSON.parse(options.body).url, draft.payload.url);
    return {ok: true, json: async () => ({bookmark: {id: 3}, duplicate: true})};
  }); assert.equal(result.duplicate, true);
  await assert.rejects(uploadDraft('http://nas.local', 't', draft, async () => ({ok: true, json: async () => ({})})), /无效/);
  await assert.rejects(uploadDraft('http://nas.local', 't', draft, async () => ({ok: false, status: 401, json: async () => ({detail: 'Token revoked'})})), /Token revoked/);
});
test('manifest opens a confirmation popup instead of collecting on toolbar click', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const background = await readFile(new URL('../background.js', import.meta.url), 'utf8');
  const popup = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.action.default_title, '确认收藏当前网页');
  assert.doesNotMatch(background, /action\.onClicked/);
  assert.match(popup, /id="confirm"[^>]*>确认收藏</);
  assert.match(popup, /id="cancel"[^>]*>取消</);
});
test('confirmed collection persists offline, rejects unsupported tabs, then startup sync drains duplicates', async () => {
  const data = {settings: {server: 'http://nas.local:8093', token: 'token', send_excerpt: false}, queue: [], recent: []};
  const listeners = {}; const hook = name => ({addListener(fn) { listeners[name] = fn; }});
  const tabs = {
    1: {id: 1, url: 'https://example.com', title: 'Example'},
    2: {id: 2, url: 'chrome://settings', title: 'Settings'},
  };
  globalThis.chrome = {
    storage: {local: {get: async defaults => ({...defaults, ...structuredClone(data)}), set: async values => Object.assign(data, structuredClone(values))}},
    action: {onClicked: hook('click'), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {}},
    tabs: {get: async id => tabs[id]},
    scripting: {executeScript: async ({args}) => [{result: {url: 'https://example.com', title: 'Example', description: '', excerpt: args[0] ? 'body' : ''}}]},
    alarms: {create() {}, onAlarm: hook('alarm')}, runtime: {id: 'test', onInstalled: hook('installed'), onStartup: hook('startup'), onMessage: hook('message'), openOptionsPage: async () => {}}
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('NAS offline'); };
  await import('../background.js');
  assert.equal(listeners.click, undefined);
  const send = message => new Promise(resolve => {
    assert.equal(listeners.message(message, {id: 'test'}, resolve), true);
  });
  async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('worker did not reach expected state'); }
  try {
    const unsupported = await send({type: 'collect', tabId: 2});
    assert.equal(unsupported.ok, false);
    assert.match(unsupported.error, /HTTP 或 HTTPS/);
    assert.equal(data.queue.length, 0);

    const first = await send({type: 'collect', tabId: 1});
    const second = await send({type: 'collect', tabId: 1});
    assert.deepEqual([first.result.status, second.result.status], ['queued', 'queued']);
    await until(() => data.queue.length === 2 && data.last_error === 'NAS offline');
    assert.equal(data.recent.length, 0); assert.equal(data.queue[0].payload.excerpt, '');

    globalThis.fetch = async () => ({ok: true, json: async () => ({bookmark: {id: 42, title: 'Example'}, duplicate: true})});
    listeners.startup(); await until(() => data.queue.length === 0);
    assert.equal(data.recent.length, 2); assert.ok(data.recent.every(x => x.duplicate));
    assert.equal(data.last_error, '');
  } finally { globalThis.fetch = originalFetch; delete globalThis.chrome; }
});
