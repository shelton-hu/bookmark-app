import {normalizeServer, permissionOrigin, userError} from './core.mjs';
const $ = id => document.getElementById(id);
const status = (text, bad = false) => { $('status').textContent = text; $('status').className = bad ? 'error' : 'success'; };
function currentSettings() { return {server: normalizeServer($('server').value), token: $('token').value.trim(), send_excerpt: $('send-excerpt').checked}; }
async function permission(server) { return chrome.permissions.request({origins: [permissionOrigin(server)]}); }
async function message(data) {
  const response = await chrome.runtime.sendMessage(data);
  if (!response?.ok) throw new Error(response?.error || '扩展未响应，请重新加载扩展');
}
function link(title, url) { const anchor = document.createElement('a'); anchor.textContent = title || url; anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; return anchor; }
async function render() {
  const {queue, recent, last_error, settings} = await chrome.storage.local.get({queue: [], recent: [], last_error: '', settings: {}});
  $('count').textContent = queue.length ? `(${queue.length})` : '';
  $('last-error').textContent = last_error ? `同步未完成：${last_error}` : '';
  $('queue').replaceChildren();
  for (const draft of queue) {
    const li = document.createElement('li'); li.append(link(draft.payload.title, draft.payload.url));
    const text = document.createElement('small'); text.textContent = `待同步 · ${draft.error || '尚未上传'}`; li.append(text);
    const remove = document.createElement('button'); remove.className = 'secondary'; remove.textContent = '移除';
    remove.addEventListener('click', async () => { if (confirm('从本机待同步队列移除这条收藏？它可能尚未保存到 NAS。')) { await message({type: 'remove-draft', id: draft.id}); await render(); } });
    li.append(remove); $('queue').append(li);
  }
  if (!queue.length) $('queue').textContent = '没有待同步收藏。';
  $('recent').replaceChildren();
  for (const item of recent) { const li = document.createElement('li'); li.append(link(item.title, item.url)); const note = document.createElement('small'); note.textContent = `${item.duplicate ? '已收藏 · 保留原分类和备注' : '已保存'} · ${new Date(item.synced_at).toLocaleString()}`; li.append(note); $('recent').append(li); }
  if (!recent.length) $('recent').textContent = '收藏一个网页，从这里开始。';
  if (settings.server) { $('web-link').href = settings.server; $('web-link').hidden = false; }
}
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  try { const settings = currentSettings(); if (!settings.token) throw new Error('请填写访问令牌');
    if (!await permission(settings.server)) throw new Error('需要允许扩展访问此 NAS 地址才能同步');
    await message({type: 'configure', settings}); status('设置已保存；同步状态见下方。'); await render();
  } catch (error) { status(userError(error), true); }
});
$('test').addEventListener('click', async () => {
  try { const settings = currentSettings(); if (!await permission(settings.server)) throw new Error('尚未获得服务器访问权限');
    status('正在测试连接…');
    const response = await fetch(`${settings.server}/api/connection`, {headers: {Authorization: `Bearer ${settings.token}`}, credentials: 'omit', signal: AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error(`连接失败（HTTP ${response.status}），请检查服务地址和令牌`);
    const body = await response.json(); if (body.status !== 'ok') throw new Error('服务器响应不符合收藏夹接口'); status('连接成功，令牌有效。');
  } catch (error) { status(userError(error), true); }
});
$('sync').addEventListener('click', async () => { $('sync').disabled = true; try { await message({type: 'sync'}); await render(); } catch (error) { status(userError(error), true); } finally { $('sync').disabled = false; } });
const {settings} = await chrome.storage.local.get({settings: {}});
$('server').value = settings.server || ''; $('token').value = settings.token || ''; $('send-excerpt').checked = settings.send_excerpt !== false;
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.queue || changes.recent || changes.last_error)) render(); });
await render();
