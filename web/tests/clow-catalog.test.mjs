import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const modules = new Map();
async function load(name) {
  if (modules.has(name)) return modules.get(name);
  let output = ts.transpileModule(await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'), {
    fileName: name,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const match of [...output.matchAll(/from "([^"]+)"/g)]) {
    const dependency = match[1];
    let url;
    if (dependency.startsWith('./')) {
      try { url = await load(`${dependency.slice(2)}.tsx`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; url = await load(`${dependency.slice(2)}.ts`); }
    } else url = import.meta.resolve(dependency);
    output = output.replace(match[0], `from ${JSON.stringify(url)}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  modules.set(name, url);
  return url;
}
const { default: Catalog, categoryTrail } = await import(await load('ClowCatalog.tsx'));
const { EnjoySearch, WorkspaceModeSwitch } = await import(await load('EnjoyScene.tsx'));
const folders = [
  { id: 1, name: '个人', parent_id: null, bookmark_count: 20 },
  { id: 2, name: 'NAS 管理', parent_id: 1, bookmark_count: 15 },
  { id: 3, name: '资料 <script>', parent_id: 2, bookmark_count: 2 },
  { id: 4, name: '工作', parent_id: null, bookmark_count: 43 },
];
test('category breadcrumb follows IDs rather than duplicate labels and terminates cycles', () => {
  assert.deepEqual(categoryTrail(folders, '3').map(f => f.id), [1, 2, 3]);
  assert.deepEqual(categoryTrail(folders, ''), []);
  assert.deepEqual(categoryTrail(folders, '404'), []);
  assert.deepEqual(categoryTrail([...folders, { id: 5, name: 'NAS 管理', parent_id: 4 }], '5').map(f => f.id), [4, 5]);
  assert.deepEqual(categoryTrail([{ id: 6, name: 'a', parent_id: 7 }, { id: 7, name: 'b', parent_id: 6 }], '6').map(f => f.id), [7, 6]);
});
test('catalog exposes separate expand and select controls, hierarchy, counts and escaped names', () => {
  for (const variant of ['book', 'compact']) {
    const html = renderToStaticMarkup(createElement(Catalog, { folders, selected: '3', variant, onSelect() {} }));
    assert.match(html, /aria-label="折叠 个人" aria-expanded="true"/);
    assert.match(html, /aria-label="15 条收藏"/);
    assert.match(html, /class="catalog-select" aria-current="true"/);
    assert.match(html, /资料 &lt;script&gt;/);
    assert.doesNotMatch(html, /<script>|删除|改名|<select/);
    assert.match(html, /title="个人 \/ NAS 管理 \/ 资料 &lt;script&gt;"/);
    assert.doesNotMatch(html, /catalog-path|catalog-all/);
    assert.equal((html.match(/aria-label="返回全部收藏"/g) || []).length, 1);
    assert.match(html, /选择父目录时包含其子目录/);
    if (variant === 'compact') assert.match(html, /aria-label="筛选目录：资料 &lt;script&gt;"/);
  }
});
test('both catalog appearances collapse unrelated branches and expose one way to return to all collections', () => {
  for (const variant of ['book', 'compact']) {
    const root = renderToStaticMarkup(createElement(Catalog, { folders, selected: '', variant, onSelect() {} }));
    assert.match(root, /aria-label="展开 个人" aria-expanded="false"/);
    assert.match(root, /id="[^"]+-branch-1" hidden=""/);
    assert.doesNotMatch(root, /catalog-path|catalog-all|catalog-reset/);
    assert.match(root, new RegExp(`aria-label="${variant === 'compact' ? '筛选目录' : '选择分类'}：全部收藏"`));
    const selected = renderToStaticMarkup(createElement(Catalog, { folders, selected: '3', variant, onSelect() {} }));
    assert.match(selected, /aria-label="折叠 个人" aria-expanded="true"/);
    assert.match(selected, /aria-label="折叠 NAS 管理" aria-expanded="true"/);
    assert.match(selected, /aria-label="返回全部收藏"/);
    const unrelated = renderToStaticMarkup(createElement(Catalog, { folders, selected: '4', variant, onSelect() {} }));
    assert.match(unrelated, /aria-label="展开 个人" aria-expanded="false"/);
  }
});
test('default sibling names sort in Chinese order while pending directories stay last', () => {
  const entries = [
    { id: 1, name: '开发与工具', parent_id: null },
    { id: 2, name: '待整理（空目录）', parent_id: null },
    { id: 3, name: '灵感与设计', parent_id: null },
    { id: 4, name: '待整理', parent_id: 3 },
    { id: 5, name: '设计素材', parent_id: 3 },
    { id: 6, name: '阅读与学习', parent_id: null },
    { id: 7, name: '待整理', parent_id: null },
    { id: 8, name: '待整理资料', parent_id: null },
    { id: 9, name: '待整理 (稍后归档)', parent_id: null },
  ];
  const original = structuredClone(entries);
  for (const variant of ['book', 'compact']) {
    const html = renderToStaticMarkup(createElement(Catalog, { folders: entries, selected: '', variant, onSelect() {} }));
    const names = [...html.matchAll(/class="catalog-select"[^>]*><span>([^<]+)<\/span>/g)].map(match => match[1]);
    assert.deepEqual(names, ['待整理资料', '开发与工具', '灵感与设计', '设计素材', '待整理', '阅读与学习', '待整理', '待整理 (稍后归档)', '待整理（空目录）']);
  }
  assert.deepEqual(entries, original);
});
test('both catalog appearances honor the same explicit manual sibling order', () => {
  const ordered = folders.map(folder => ({...folder, sort_order: folder.id === 4 ? 0 : 1}));
  for (const variant of ['book', 'compact']) {
    const html = renderToStaticMarkup(createElement(Catalog, {folders: ordered, selected: '', variant, onSelect() {}}));
    assert.ok(html.indexOf('<span>工作</span>') < html.indexOf('<span>个人</span>'));
    assert.ok(html.indexOf('<span>个人</span>') < html.indexOf('<span>NAS 管理</span>'));
  }
});
test('enjoy search displays category scope and one destination action outside its options popover', () => {
  const props = { inputRef: { current: null }, folders, folderId: '2', query: 'pansou', searchMode: 'keyword', busy: false,
    onFolder() {}, onQuery() {}, onSearchMode() {}, onRefresh() {}, onMode() {} };
  const html = renderToStaticMarkup(createElement(EnjoySearch, props));
  assert.match(html, /aria-label="搜索 NAS 管理 中的收藏"/);
  assert.match(html, /value="pansou"/);
  assert.match(html, /<span>去管理版<\/span>/);
  assert.doesNotMatch(html, /去纯享版/);
  assert.match(html, /<\/section><button type="button" class="secondary workspace-mode-link"/);
  const all = renderToStaticMarkup(createElement(EnjoySearch, { ...props, folderId: '' }));
  assert.match(all, /aria-label="搜索全部收藏"/);
  for (const [mode, destination, label] of [['manage', 'enjoy', '去纯享版'], ['enjoy', 'manage', '去管理版']]) {
    const busy = renderToStaticMarkup(createElement(WorkspaceModeSwitch, { mode, busy: true, onChange() {} }));
    assert.equal((busy.match(/<button\b/g) || []).length, 1);
    assert.equal((busy.match(/disabled=""/g) || []).length, 1);
    assert.ok(busy.includes(`<span>${label}</span>`));
    let changed;
    WorkspaceModeSwitch({ mode, busy: false, onChange: next => { changed = next; } }).props.onClick();
    assert.equal(changed, destination);
  }
});
