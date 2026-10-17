import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const compiled = new Map();
async function moduleUrl(name) {
  if (compiled.has(name)) return compiled.get(name);
  let output = ts.transpileModule(await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'), {
    fileName: name,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const match of [...output.matchAll(/from "([^"]+)"/g)]) {
    const dependency = match[1];
    const url = dependency.startsWith('./') ? await moduleUrl(`${dependency.slice(2)}${['./BookmarkHand', './CardDepartureOverlay'].includes(dependency) ? '.tsx' : '.ts'}`) : import.meta.resolve(dependency);
    output = output.replace(match[0], `from ${JSON.stringify(url)}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  compiled.set(name, url);
  return url;
}
const { clowDeck, cardForBookmark } = await import(await moduleUrl('clowDeck.ts'));
const { default: Card, CardFace } = await import(await moduleUrl('ClowBookmark.tsx'));
const { default: Row, BookmarkResults } = await import(await moduleUrl('BookmarkList.tsx'));

test('all 52 distinct faces repeat without changing when results are filtered or sorted', () => {
  assert.equal(clowDeck.length, 52);
  assert.equal(new Set(clowDeck.map(c => c.key)).size, 52);
  assert.equal(new Set(clowDeck.map(c => c.glyph)).size, 52);
  const ids = Array.from({ length: 109 }, (_, i) => i + 1);
  const original = new Map(ids.map(id => [id, cardForBookmark(id)]));
  for (const id of ids.reverse().filter(id => id % 3)) assert.deepEqual(cardForBookmark(id), original.get(id));
  for (let id = 1; id <= 52; id++) assert.deepEqual(cardForBookmark(id), cardForBookmark(id + 52));
});

test('all 52 cards use distinct original faces with live titles', async () => {
  const hashes = new Set();
  for (const [index, card] of clowDeck.entries()) {
    const html = renderToStaticMarkup(createElement(CardFace, { id: index + 1, title: card.name }));
    assert.ok(html.includes(`src="/clow-deck/${card.key}.webp"`), card.key);
    assert.match(html, /width="600" height="1344"/);
    assert.match(html, /clow-scroll-title/);
    assert.doesNotMatch(html, /small-glyph|experiments|painted|clow-face-glyph/);
    const bytes = await readFile(new URL(`../public/clow-deck/${card.key}.webp`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', card.key);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', card.key);
    assert.ok(bytes.length > 1000, card.key);
    hashes.add(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(hashes.size, 52);
});

test('ribbon lettering uses separate curved paths for every copy of a card', () => {
  const html = renderToStaticMarkup(createElement('div', null,
    createElement(CardFace, { id: 5, title: '雨之牌' }),
    createElement(CardFace, { id: 5, title: '雨之牌' })));
  const ids = [...html.matchAll(/<path[^>]*id="([^"]+)"/g)].map(match => match[1]);
  const links = [...html.matchAll(/<textPath[^>]*href="#([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  assert.deepEqual(links, ids);
  assert.match(html, /q 190 46 380 0/);
  assert.match(html, /startOffset="50%"/);
});

const { ribbonTitleLines } = await import(await moduleUrl('ribbonTitle.ts'));
test('ribbon titles fit two readable lines and retain complete graphemes', () => {
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const measure = text => [...segments.segment(text)].length * 44;
  assert.deepEqual(ribbonTitleLines('  雨之牌\n ', measure), ['雨之牌']);
  const balanced = ribbonTitleLines('一二三四五六七八九十', measure);
  assert.equal(balanced.join(''), '一二三四五六七八九十');
  assert.ok(Math.abs(measure(balanced[0]) - measure(balanced[1])) <= 88);
  assert.deepEqual(ribbonTitleLines('一'.repeat(30), measure), ['一'.repeat(8), '一'.repeat(7) + '…']);
  const title = '👨‍👩‍👧‍👦e\u0301'.repeat(12);
  const lines = ribbonTitleLines(title, measure);
  assert.ok(lines.every(line => measure(line) <= 370));
  assert.equal(lines.join('').replace(/…$/, ''), '👨‍👩‍👧‍👦e\u0301'.repeat(7) + '👨‍👩‍👧‍👦');
  assert.deepEqual(ribbonTitleLines('Sealed Book Library Notes', text => text.length, 16), ['Sealed Book', 'Library Notes']);
  const numbered = ribbonTitleLines('收藏设计灵感 27', measure);
  assert.ok(numbered[1].length > 2);
  assert.ok(!/^\d+$/u.test(numbered[1]));
  const mixedWidth = text => [...segments.segment(text)].reduce((width, part) => width + (/\p{Script=Han}/u.test(part.segment) ? 44 : 22), 0);
  assert.deepEqual(ribbonTitleLines('镜之牌 · 星月与微光 27', mixedWidth), ['镜之牌', '星月与微光 27']);
});

const bookmark = { id: 1, title: 'Cashbook <script>alert(1)</script>', url: 'https://example.test/a', tags: [], folder_id: null };
const props = { bookmark, managing: false, folders: [], selected: false, busy: false, toggle() {}, edit() {}, refresh() {}, remove() {}, restore() {}, filterTag() {} };
test('the card exposes distinct quick-open and details buttons with escaped titles', () => {
  const html = renderToStaticMarkup(createElement(Card, props));
  assert.match(html, /clow-scroll-title/);
  assert.match(html, /Cashbook &lt;script&gt;/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-label="翻牌打开 /);
  assert.match(html, /class="clow-details-seal"[^>]*aria-label="翻牌查看 /);
  assert.equal((html.match(/<button\b/g) || []).length, 2);
  assert.match(html, /clow-deck\/windy.webp/);
  assert.doesNotMatch(html, /<a\b|type="checkbox"|ribbon-link|clow-windy.webp/);
});
test('rain uses the same quick-open flow and unsafe URLs only offer details', () => {
  const rain = { ...bookmark, id: 5 };
  const html = renderToStaticMarkup(createElement(Card, { ...props, bookmark: rain }));
  assert.match(html, /aria-label="翻牌打开 /);
  assert.match(html, /src="\/clow-deck\/rain.webp"/);
  assert.doesNotMatch(html, /召唤|clow-summoning/);
  const unsafe = renderToStaticMarkup(createElement(Card, { ...props, bookmark: { ...rain, url: 'javascript:alert(1)' } }));
  assert.doesNotMatch(unsafe, /aria-label="翻牌打开 /);
  assert.match(unsafe, /aria-label="翻牌查看 /);
});
test('management rows expose complete URLs and folder paths with direct actions, without card artwork', () => {
  const html = renderToStaticMarkup(createElement(Row, { ...props, managing: true, selected: true, bookmark: { ...bookmark, folder_id: 2, classification_status: 'done' }, folders: [{ id: 1, name: '工作', parent_id: null }, { id: 2, name: '资料', parent_id: 1 }] }));
  assert.match(html, /role="listitem"/);
  assert.match(html, /Cashbook &lt;script&gt;/);
  assert.match(html, /href="https:\/\/example.test\/a"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(html, /工作 \/ 资料/);
  assert.match(html, /type="checkbox"[^>]*checked=""/);
  assert.match(html, />编辑<|编辑<\/button>/);
  assert.match(html, />删除<|删除<\/button>/);
  assert.doesNotMatch(html, /<img|clow-art|clow-reader|hand-card/);
});
test('filed bookmarks are not pending even when the automatic classification status is pending', () => {
  const row = (overrides) => renderToStaticMarkup(createElement(Row, { ...props, bookmark: { ...bookmark, ...overrides } }));
  for (const classification_status of ['pending', 'done']) {
    assert.doesNotMatch(row({ folder_id: 2, classification_status }), /bookmark-row-status|待整理/);
    assert.match(row({ folder_id: null, classification_status }), /bookmark-row-status pending[^>]*>待整理/);
  }
  assert.match(row({ folder_id: 2, classification_status: 'failed' }), /bookmark-row-status failed[^>]*>分类失败/);
  assert.doesNotMatch(row({ folder_id: null, classification_status: 'pending', deleted_at: '2026-10-17T00:00:00Z' }), /bookmark-row-status|待整理/);
});
test('trash rows offer restore and permanent deletion; unsafe URLs cannot become active links and busy prevents writes', () => {
  const html = renderToStaticMarkup(createElement(Row, { ...props, busy: true, bookmark: { ...bookmark, url: 'javascript:alert(1)', deleted_at: '2026-10-12T00:00:00Z' } }));
  assert.match(html, /aria-label="恢复 /);
  assert.match(html, /disabled=""[^>]*aria-label="彻底删除 /);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /<a\b|aria-label="编辑 |aria-label="删除 /);
});
test('mode presentation keeps every result while only enjoy receives hand positions', () => {
  const items = Array.from({ length: 109 }, (_, index) => ({ ...bookmark, id: index + 1 }));
  for (const managing of [true, false]) {
    let rendered = 0;
    const html = renderToStaticMarkup(createElement(BookmarkResults, { items, managing, children: (item, hand) => {
      rendered++;
      assert.equal(Boolean(hand), !managing);
      return createElement('article', { key: item.id }, item.title);
    } }));
    assert.equal(rendered, 109);
    if (managing) { assert.match(html, /role="list"/); assert.doesNotMatch(html, /hand-rail/); }
    else assert.match(html, /hand-rail/);
  }
});
