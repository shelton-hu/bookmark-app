import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/bookmarkPagination.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { paginateItems, pageInfo } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("109 bookmarks cover six pages without duplicates or gaps", () => {
  const items = Array.from({ length: 109 }, (_, id) => ({ id }));
  const pages = Array.from({ length: 6 }, (_, i) => paginateItems(items, i + 1, 20));
  assert.deepEqual(pages.map((p) => p.items.length), [20, 20, 20, 20, 20, 9]);
  assert.deepEqual(pages.flatMap((p) => p.items), items);
  assert.deepEqual([pages[5].start, pages[5].end], [101, 109]);
  assert.equal(items.length, 109);
});
test("deleting the last page or shrinking results clamps to an existing page", () => {
  const result = paginateItems(Array.from({ length: 100 }, (_, i) => i), 6, 20);
  assert.equal(result.page, 5);
  assert.equal(result.totalPages, 5);
  assert.deepEqual([result.start, result.end], [81, 100]);
  const empty = paginateItems([], 6, 20);
  assert.deepEqual([empty.page, empty.totalPages, empty.start, empty.end], [1, 1, 0, 0]);
});
test("page sizes and bounded navigation preserve first, current and last pages", () => {
  const items = Array.from({ length: 109 }, (_, i) => i);
  assert.equal(paginateItems(items, 1, 10).totalPages, 11);
  assert.equal(paginateItems(items, 1, 50).totalPages, 3);
  assert.deepEqual(paginateItems(items, 6, 10).pages, [1, 5, 6, 7, 11]);
});

test("server totals produce bounded navigation without downloading the full library", () => {
  const result = pageInfo(109, 6, 20);
  assert.deepEqual([result.page, result.totalPages, result.start, result.end], [6, 6, 101, 109]);
  assert.deepEqual(pageInfo(0, 5, 20).pages, [1]);
  assert.deepEqual(pageInfo(100, 6, 20).page, 5);
  const huge = pageInfo(1_000_000_000, 200, 20);
  assert.deepEqual(huge.pages, [1, 199, 200, 201, 50_000_000]);
});
