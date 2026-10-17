import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const output = ts.transpileModule(await readFile(new URL('../src/bookmarkQuery.ts', import.meta.url), 'utf8'), {
  fileName: 'bookmarkQuery.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { bookmarkQuery } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const state = { page: 'pending', query: 'moon & 星', searchMode: 'keyword', folderId: '23', tag: 'work' };
test('enjoy searches the visible category including descendants but ignores private lists and tags', () => {
  for (const page of ['library', 'pending', 'trash']) {
    const params = bookmarkQuery({ ...state, page, mode: 'enjoy' });
    assert.deepEqual(Object.fromEntries(params), { q: 'moon & 星', mode: 'keyword', trash: 'false', pending: 'false', folder_id: '23', include_children: 'true' });
    assert.equal(new URLSearchParams(params.toString()).get('q'), state.query);
  }
});
test('all collections clears folder scope; category and search survive a mode round trip', () => {
  const scoped = { ...state, page: 'library', tag: '' };
  const enjoy = bookmarkQuery({ ...scoped, mode: 'enjoy' });
  const manage = bookmarkQuery({ ...scoped, mode: 'manage' });
  assert.equal(enjoy.toString(), manage.toString());
  const all = bookmarkQuery({ ...scoped, folderId: '', mode: 'enjoy' });
  assert.equal(all.has('folder_id'), false);
  assert.equal(all.has('include_children'), false);
  assert.equal(all.get('q'), state.query);
});
test('pending ignores a remembered directory while other management views retain their scope', () => {
  const params = bookmarkQuery({ ...state, mode: 'manage' });
  assert.deepEqual(Object.fromEntries(params), { q: state.query, mode: 'keyword', trash: 'false', pending: 'true', tag: 'work' });
  for (const page of ['library', 'trash']) {
    const scoped = bookmarkQuery({ ...state, page, mode: 'manage' });
    assert.equal(scoped.get('folder_id'), '23');
    assert.equal(scoped.get('include_children'), 'true');
    assert.equal(scoped.get('tag'), 'work');
    assert.equal(scoped.get('pending'), 'false');
    assert.equal(scoped.get('trash'), String(page === 'trash'));
  }
});

test('lightweight management pages retain complete selection IDs while enjoy stays continuous', () => {
  const managing = bookmarkQuery({ ...state, mode: 'manage', listPage: 3, pageSize: 10 });
  assert.equal(managing.get('page'), '3');
  assert.equal(managing.get('page_size'), '10');
  assert.equal(managing.get('view'), 'summary');
  assert.equal(managing.get('include_ids'), 'true');
  assert.equal(managing.has('folder_id'), false);
  assert.equal(managing.has('include_children'), false);
  assert.equal(managing.get('pending'), 'true');
  const enjoy = bookmarkQuery({ ...state, mode: 'enjoy', listPage: 3, pageSize: 10 });
  assert.equal(enjoy.get('view'), 'summary');
  for (const key of ['page', 'page_size', 'include_ids', 'tag']) assert.equal(enjoy.has(key), false);
  const semantic = bookmarkQuery({ ...state, mode: 'manage', searchMode: 'semantic', listPage: 2, searchId: 'same-search' });
  assert.equal(semantic.get('search_id'), 'same-search');
});
