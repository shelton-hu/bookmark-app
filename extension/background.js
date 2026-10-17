import {makeDraft, uploadDraft, userError, validPage} from './core.mjs';

// Serialize every queue mutation so confirmation and background sync cannot race.
let chain = Promise.resolve();
function serialize(task) { const result = chain.then(task, task); chain = result.catch(() => {}); return result; }
async function state() { return chrome.storage.local.get({queue: [], recent: [], settings: {}, last_error: ''}); }
async function badge() {
  const {queue, recent} = await state();
  await chrome.action.setBadgeText({text: queue.length ? String(queue.length) : ''});
  await chrome.action.setBadgeBackgroundColor({color: queue.length ? '#b86a20' : '#137b70'});
  await chrome.action.setTitle({title: queue.length ? `${queue.length} 条待同步，点击打开收藏确认` : (recent[0]?.duplicate ? '上一条已收藏，点击确认当前网页' : '确认收藏当前网页')});
}
async function sync() {
  const current = await state();
  const {settings} = current;
  if (!settings.server || !settings.token) { await badge(); return; }
  const queue = [...current.queue];
  const recent = [...current.recent];
  while (queue.length) {
    const draft = queue[0];
    try {
      const result = await uploadDraft(settings.server, settings.token, draft);
      queue.shift();
      recent.unshift({id: draft.id, title: result.bookmark.title || draft.payload.title, url: draft.payload.url,
        bookmark_id: result.bookmark.id, duplicate: result.duplicate, synced_at: new Date().toISOString()});
      await chrome.storage.local.set({queue, recent: recent.slice(0, 20), last_error: ''});
    } catch (error) {
      draft.attempts += 1; draft.error = userError(error);
      await chrome.storage.local.set({queue, last_error: draft.error});
      break; // Preserve draft for alarm/startup/manual retry, including unauthorized tokens.
    }
  }
  await badge();
}
async function collect(tab) {
  if (!validPage(tab?.url)) throw new Error('仅支持收藏 HTTP 或 HTTPS 网页');
  const {settings} = await state();
  let page = {url: tab.url, title: tab.title};
  try {
    const results = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: (sendExcerpt) => {
      const root = document.querySelector('article, main, [role="main"]') || document.body;
      return {url: location.href, title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || document.querySelector('meta[property="og:description"]')?.content || '',
        excerpt: sendExcerpt ? (root?.innerText || '').slice(0, 12000) : ''};
    }, args: [settings.send_excerpt !== false]});
    if (results[0]?.result) page = results[0].result;
  } catch {} // Restricted script access still allows saving the confirmed URL and title.
  const draft = makeDraft(page, settings.send_excerpt !== false);
  const {queue} = await state();
  queue.push(draft);
  await chrome.storage.local.set({queue}); // Persist before making any network request.
  await badge();
  const configured = Boolean(settings.server && settings.token);
  if (!configured) {
    await chrome.runtime.openOptionsPage();
    return {status: 'queued', configured: false};
  }
  await sync();
  const current = await state();
  if (current.queue.some(item => item.id === draft.id)) return {status: 'queued', configured: true};
  const saved = current.recent.find(item => item.id === draft.id);
  return {status: saved?.duplicate ? 'duplicate' : 'saved', configured: true};
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'bookmark-sync') serialize(sync); });
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('bookmark-sync', {periodInMinutes: 1}); serialize(badge); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('bookmark-sync', {periodInMinutes: 1}); serialize(sync); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  let task;
  if (message.type === 'collect') task = async () => collect(await chrome.tabs.get(message.tabId));
  if (message.type === 'sync') task = sync;
  if (message.type === 'configure') task = async () => { await chrome.storage.local.set({settings: message.settings, last_error: ''}); await sync(); };
  if (message.type === 'remove-draft') task = async () => {
    const {queue} = await state(); await chrome.storage.local.set({queue: queue.filter(x => x.id !== message.id)}); await badge();
  };
  if (!task) return false;
  serialize(task).then(result => sendResponse({ok: true, result}), error => sendResponse({ok: false, error: userError(error)}));
  return true;
});
chrome.alarms.create('bookmark-sync', {periodInMinutes: 1});
