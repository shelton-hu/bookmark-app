import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const {outputText} = ts.transpileModule(await readFile(new URL('../src/ordering.ts', import.meta.url), 'utf8'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext},
});
const {folderEntries, folderSiblings, reorderedIds, keyboardPlacement} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const folders = [
  {id: 5, name: 'NAS管理', parent_id: 1}, {id: 1, name: '个人', parent_id: null},
  {id: 3, name: '收藏', parent_id: null}, {id: 4, name: '后端', parent_id: 2},
  {id: 2, name: '工作', parent_id: null}, {id: 6, name: '待整理（旧）', parent_id: null},
];

test('legacy directory choices use Chinese sibling order, parent-first hierarchy and pending last', () => {
  assert.deepEqual(folderEntries(folders).map(({folder, depth}) => [folder.id, depth]), [[1,0],[5,1],[2,0],[4,1],[3,0],[6,0]]);
  assert.equal(folders[0].id, 5);
});
test('manual root order carries the entire subtree across every directory entry', () => {
  const ordered = folders.map(folder => ({...folder, sort_order: folder.parent_id === null ? [2,1,3,6].indexOf(folder.id) : null}));
  assert.deepEqual(folderEntries(ordered).map(({folder}) => folder.id), [2,4,1,5,3,6]);
  assert.deepEqual(folderSiblings(ordered, 1).map(folder => folder.id), [5]);
});
test('new siblings append after explicit positions and renames keep their positions', () => {
  const ordered = [{id: 1, name: 'Z', parent_id: null, sort_order: 0}, {id: 2, name: 'A', parent_id: null}];
  assert.deepEqual(folderSiblings(ordered, null).map(folder => folder.id), [1,2]);
  ordered[0].name = '重命名';
  assert.deepEqual(folderSiblings(ordered, null).map(folder => folder.id), [1,2]);
});
test('an explicit drag can override the pending-last default', () => {
  const ordered = [{id: 1, name: '待整理', parent_id: null, sort_order: 0}, {id: 2, name: '个人', parent_id: null, sort_order: 1}];
  assert.deepEqual(folderSiblings(ordered, null).map(folder => folder.id), [1,2]);
});
test('legacy cycles and orphaned directories remain visible once and terminate', () => {
  const broken = [{id:1, name:'A', parent_id:2}, {id:2, name:'B', parent_id:1}, {id:3, name:'C', parent_id:99}];
  assert.deepEqual(folderEntries(broken).map(({folder}) => folder.id).sort(), [1,2,3]);
});
test('drag insertion handles both directions, before and after, with no lost or duplicated IDs', () => {
  const ids = [1,2,3,4];
  assert.deepEqual(reorderedIds(ids, 4, 1, 'before'), [4,1,2,3]);
  assert.deepEqual(reorderedIds(ids, 1, 3, 'after'), [2,3,1,4]);
  assert.deepEqual(reorderedIds(ids, 4, 3, 'after'), ids);
  for (const pair of [[1,1],[99,1],[1,99]]) assert.deepEqual(reorderedIds(ids, ...pair, 'before'), ids);
  assert.deepEqual(ids, [1,2,3,4]);
});
test('keyboard placement reaches first, last and intermediate slots without crossing group boundaries', () => {
  const ids = [1,2,3,4];
  for (const [index, expected] of [[0,[2,1,3,4]], [1,[1,2,3,4]], [2,[1,3,2,4]], [99,[1,3,4,2]]]) {
    const target = keyboardPlacement(ids, 2, index);
    assert.deepEqual(reorderedIds(ids, 2, target.target, target.placement), expected);
  }
  assert.equal(keyboardPlacement([1], 1, 0), null);
});
