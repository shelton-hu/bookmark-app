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
test('management keeps descendant folders, tags and pending/trash filters', () => {
  const params = bookmarkQuery({ ...state, mode: 'manage' });
  assert.deepEqual(Object.fromEntries(params), { q: state.query, mode: 'keyword', trash: 'false', pending: 'true', folder_id: '23', include_children: 'true', tag: 'work' });
  assert.equal(bookmarkQuery({ ...state, page: 'trash', mode: 'manage' }).get('trash'), 'true');
});

test('lightweight management pages retain complete selection IDs while enjoy stays continuous', () => {
  const managing = bookmarkQuery({ ...state, mode: 'manage', listPage: 3, pageSize: 10 });
  assert.equal(managing.get('page'), '3');
  assert.equal(managing.get('page_size'), '10');
  assert.equal(managing.get('view'), 'summary');
  assert.equal(managing.get('include_ids'), 'true');
  assert.equal(managing.get('include_children'), 'true');
  assert.equal(managing.get('pending'), 'true');
  const enjoy = bookmarkQuery({ ...state, mode: 'enjoy', listPage: 3, pageSize: 10 });
  assert.equal(enjoy.get('view'), 'summary');
  for (const key of ['page', 'page_size', 'include_ids', 'tag']) assert.equal(enjoy.has(key), false);
  const semantic = bookmarkQuery({ ...state, mode: 'manage', searchMode: 'semantic', listPage: 2, searchId: 'same-search' });
  assert.equal(semantic.get('search_id'), 'same-search');
});
