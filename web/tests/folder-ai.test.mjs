import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const modules = new Map();
async function load(name) {
  if (modules.has(name)) return modules.get(name);
  let output = ts.transpileModule(await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8'), {
    fileName: name, compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX},
  }).outputText.replace(/import "[^\"]+\.css";/g, '');
  for (const match of [...output.matchAll(/from "([^"]+)"/g)]) {
    const dependency = match[1];
    const url = dependency.startsWith('./') ? await load(`${dependency.slice(2)}.ts`) : import.meta.resolve(dependency);
    output = output.replace(match[0], `from ${JSON.stringify(url)}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  modules.set(name, url);
  return url;
}
const {default: Organizer, OrganizeReview} = await import(await load('FolderAiOrganizer.tsx'));
const folders = [
  {id: 1, name: '工作', parent_id: null},
  {id: 2, name: '通用', parent_id: 1},
  {id: 3, name: '个人', parent_id: null},
  {id: 4, name: '通用', parent_id: 3},
];
const items = [
  {id: 'folder:2', kind: 'folder', entity_id: 2, before: '工作 / 通用', name: '开发工具', reason: '按用途统一命名'},
  {id: 'title:7', kind: 'title', entity_id: 7, before: '首页 <script>', title: '工具 · 文档', reason: '保留用途'},
  {id: 'move:7', kind: 'move', entity_id: 7, before: '工作', target_parent_id: 2, new_segments: ['接口'], context: '工具文档', reason: '归档到接口资料'},
];
function renderReview(selected = items.map(i => i.id), disabled = false) {
  return renderToStaticMarkup(createElement(OrganizeReview, {items, folders, selected, disabled, toggle() {}}));
}
test('scoped entry shows full paths, defaults to renaming only and needs a configured model', () => {
  const html = renderToStaticMarkup(createElement(Organizer, {folders, initialFolder: folders[1], modelConfigured: false,
    onBusy() {}, onApplied() {}, cancel() {}, openSettings() {}}));
  assert.match(html, /<option value="2" selected="">工作 \/ 通用/);
  assert.match(html, /个人 \/ 通用/);
  assert.match(html, /前往设置/);
  assert.match(html, /disabled="">生成整理预览/);
  assert.match(html, /type="checkbox" checked=""\/><span><strong>规范书签名称/);
  assert.match(html, /type="checkbox"\/><span><strong>重新分配书签目录/);
  assert.doesNotMatch(html, /确认应用/);
});
test('review distinguishes field operations, escapes page text and renders complete target paths', () => {
  const html = renderReview();
  assert.match(html, /子目录名称/);
  assert.match(html, /书签名称/);
  assert.match(html, /书签归属/);
  assert.match(html, /首页 &lt;script&gt;/);
  assert.match(html, /工作 \/ 开发工具 \/ 接口/);
  assert.equal((html.match(/checked=""/g) ?? []).length, 3);
});
test('deselecting a folder rename updates destination display without losing stable identity', () => {
  const html = renderReview(['move:7']);
  assert.match(html, /工作 \/ 通用 \/ 接口/);
  assert.doesNotMatch(html, /工作 \/ 开发工具 \/ 接口/);
  assert.equal((html.match(/checked=""/g) ?? []).length, 1);
});
test('no choices are silently added and all review toggles lock during application', () => {
  assert.doesNotMatch(renderReview([]), /checked=""/);
  assert.equal((renderReview([], true).match(/disabled=""/g) ?? []).length, 3);
});
