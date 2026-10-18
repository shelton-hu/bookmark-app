import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

let source = ts.transpileModule(await readFile(new URL('../src/FolderManagement.tsx', import.meta.url), 'utf8'), {
  fileName: 'FolderManagement.tsx', compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX},
}).outputText;
for (const match of [...source.matchAll(/from "([^"]+)"/g)]) source = source.replace(match[0], `from ${JSON.stringify(import.meta.resolve(match[1]))}`);
const {FolderSummary, FolderDeleteForm} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const preview = {folders_deleted: 1, bookmarks_affected: 3, active_bookmarks_affected: 2,
  trashed_bookmarks_affected: 1, descendant_bookmarks_preserved: 4, children_reparented: 1, snapshot: 'a'.repeat(64)};
const renderDelete = (changes = {}, busy = false) => renderToStaticMarkup(createElement(FolderDeleteForm, {
  preview: {...preview, ...changes}, names: ['资料 <script>'], busy, cancel() {}, recheck() {}, confirm() {},
}));

test('management counts name their descendant scope and show the direct count separately', () => {
  const html = renderToStaticMarkup(createElement(FolderSummary, {
    folder: {id: 1, bookmark_count: 7, direct_bookmark_count: 2}, path: '资料 / 开发 <script>',
  }));
  assert.match(html, /7 条书签/);
  assert.match(html, /含子目录 · 本目录 2 条/);
  assert.match(html, /开发 &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('empty is shown as zero while absent old-server counts are not reported as empty', () => {
  const zero = renderToStaticMarkup(createElement(FolderSummary, {folder: {id: 1, bookmark_count: 0, direct_bookmark_count: 0}, path: '空目录'}));
  assert.match(zero, /0 条书签/); assert.match(zero, /本目录 0 条/);
  const unknown = renderToStaticMarkup(createElement(FolderSummary, {folder: {id: 1}, path: '资料'}));
  assert.match(unknown, /数量待刷新/); assert.doesNotMatch(unknown, /0 条书签/);
});

test('deletion distinguishes inbox moves, trash retention and untouched descendants', () => {
  const html = renderDelete();
  assert.match(html, /2 条<\/strong>直属正常书签将移入<strong>待整理箱/);
  assert.match(html, /1 条<\/strong>回收站书签仅解除目录归属/);
  assert.match(html, /4 条<\/strong>正常书签保留原目录归属/);
  assert.match(html, /1 个<\/strong>未选子目录将提升/);
  assert.match(html, /资料 &lt;script&gt;/);
  assert.match(html, /我已核对数量/);
  assert.match(html, /disabled="">确认删除目录/);
});

test('direct, descendant-only and trash-only bookmarks all require acknowledgement', () => {
  for (const changes of [
    {bookmarks_affected: 1, active_bookmarks_affected: 1, trashed_bookmarks_affected: 0, descendant_bookmarks_preserved: 0},
    {bookmarks_affected: 0, active_bookmarks_affected: 0, trashed_bookmarks_affected: 0, descendant_bookmarks_preserved: 3},
    {bookmarks_affected: 1, active_bookmarks_affected: 0, trashed_bookmarks_affected: 1, descendant_bookmarks_preserved: 0},
  ]) {
    const html = renderDelete(changes);
    assert.match(html, /type="checkbox"/);
    assert.match(html, /disabled="">确认删除目录/);
  }
});

test('a truly empty folder still asks for deletion confirmation without a redundant checkbox', () => {
  const html = renderDelete({bookmarks_affected: 0, active_bookmarks_affected: 0, trashed_bookmarks_affected: 0, descendant_bookmarks_preserved: 0, children_reparented: 0});
  assert.doesNotMatch(html, /type="checkbox"|disabled=""/);
  assert.match(html, /确认删除目录/);
});

test('submitting disables all confirmation controls', () => {
  const html = renderDelete({}, true);
  for (const button of html.match(/<button[^>]*>/g)) assert.match(button, /disabled=""/);
  assert.match(html, /正在处理…/);
});
