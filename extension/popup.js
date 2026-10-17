import {userError, validPage} from './core.mjs';

const $ = id => document.getElementById(id);
let activeTab = null;

function showStatus(text, bad = false) {
  $('status').textContent = text;
  $('status').className = bad ? 'error' : '';
}

function setBusy(busy) {
  $('confirm').disabled = busy;
  $('cancel').disabled = busy;
  $('settings').disabled = busy;
}

function finish(label, message) {
  $('confirm').textContent = label;
  $('confirm').dataset.complete = 'true';
  $('confirm').disabled = true;
  $('cancel').disabled = false;
  $('cancel').textContent = '关闭';
  $('settings').disabled = false;
  showStatus(message);
  $('cancel').focus();
}

async function loadPage() {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    activeTab = tab || null;
    const url = activeTab?.url || '';
    $('page-title').textContent = activeTab?.title || url || '无法读取当前页面';
    $('page-url').textContent = url;
    $('page-url').title = url;
    if (!activeTab?.id || !validPage(url)) {
      $('heading').textContent = '无法收藏此页面';
      showStatus('仅支持 HTTP 或 HTTPS 网页。', true);
      $('confirm').hidden = true;
      $('cancel').textContent = '关闭';
      $('cancel').focus();
      return;
    }
    $('confirm').disabled = false;
    $('confirm').focus();
  } catch (error) {
    $('heading').textContent = '无法读取页面';
    showStatus(userError(error), true);
    $('confirm').hidden = true;
    $('cancel').textContent = '关闭';
  }
}

$('confirm').addEventListener('click', async () => {
  if (!activeTab?.id) return;
  setBusy(true);
  showStatus('正在收藏…');
  try {
    const response = await chrome.runtime.sendMessage({type: 'collect', tabId: activeTab.id});
    if (!response?.ok) throw new Error(response?.error || '扩展未响应，请重新加载扩展');
    const status = response.result?.status;
    if (status === 'duplicate') finish('已经收藏', '该网址已存在，原分类和备注保持不变。');
    else if (status === 'queued') finish('已加入待同步', response.result?.configured === false ? '已保存到本机，并打开设置页面；连接后会同步到「待整理箱」。' : '网络恢复后会自动同步到「待整理箱」。');
    else finish('已加入待整理', '可在拾页的「待整理箱」中归档，或启动 AI 整理。');
  } catch (error) {
    setBusy(false);
    showStatus(userError(error), true);
    $('confirm').focus();
  }
});

$('cancel').addEventListener('click', () => window.close());
$('settings').addEventListener('click', async () => { await chrome.runtime.openOptionsPage(); window.close(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') window.close(); });
await loadPage();
