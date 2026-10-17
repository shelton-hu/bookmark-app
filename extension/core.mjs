export function normalizeServer(value) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('请填写 HTTP 或 HTTPS 服务器地址，不包含账号、查询参数或片段');
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('服务器地址不包含路径，例如 http://192.168.1.10:8093');
  return url.origin;
}

export function permissionOrigin(server) { return `${new URL(normalizeServer(server)).origin}/*`; }
export function validPage(url) { try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; } }
export function makeDraft(page, sendExcerpt = true) {
  if (!validPage(page.url)) throw new Error('仅支持收藏 HTTP 或 HTTPS 网页');
  return {id: crypto.randomUUID(), created_at: new Date().toISOString(), attempts: 0,
    payload: {url: page.url, title: String(page.title || page.url).slice(0, 1000),
      description: String(page.description || '').slice(0, 2000), excerpt: sendExcerpt ? String(page.excerpt || '').slice(0, 12000) : ''}};
}
export function userError(error) { return String(error?.message || error || '未知错误').slice(0, 300); }
export async function uploadDraft(server, token, draft, fetcher = fetch) {
  const response = await fetcher(`${normalizeServer(server)}/api/bookmarks`, {
    method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    body: JSON.stringify(draft.payload), signal: AbortSignal.timeout(15000), credentials: 'omit'
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { const body = await response.json(); if (typeof body.detail === 'string') message = body.detail; } catch {}
    throw new Error(message);
  }
  const body = await response.json();
  if (!body.bookmark?.id) throw new Error('服务器返回无效，收藏仍保留在待同步队列');
  return body;
}
