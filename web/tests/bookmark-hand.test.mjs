import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = await readFile(new URL("../src/BookmarkHand.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace(/from "(react(?:\/jsx-runtime)?|lucide-react)"/g, (_, name) => `from ${JSON.stringify(import.meta.resolve(name))}`);
const { handPose, BookmarkHand, rankToHandSlot } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("bookmark ranks expand first in the center, then left, right, left, right for odd and even counts", () => {
  for (const count of [1, 2, 3, 7, 8, 52, 109, 5000]) {
    const slots = Array.from({ length: count }, (_, rank) => rankToHandSlot(rank, count));
    assert.equal(slots[0], Math.floor(count / 2));
    assert.deepEqual([...slots].sort((a, b) => a - b), Array.from({ length: count }, (_, index) => index));
    for (let rank = 1; rank < count; rank++) {
      assert.equal(slots[rank] - slots[0], (rank % 2 ? -1 : 1) * Math.ceil(rank / 2));
    }
  }
  assert.deepEqual(Array.from({length: 8}, (_, rank) => ({rank: rank + 1, slot: rankToHandSlot(rank, 8)}))
    .sort((a,b) => a.slot - b.slot).map(item => item.rank), [8, 6, 4, 2, 1, 3, 5, 7]);
});

test("visual slot mapping preserves ranked reading and tab order without mutating input", () => {
  const items = Array.from({ length: 8 }, (_, index) => Object.freeze({ id: index + 1 }));
  Object.freeze(items);
  const positions = [];
  const html = renderToStaticMarkup(createElement(BookmarkHand, { items,
    children: (item, hand) => {
      positions.push([item.id, hand.index, hand.centerIndex]);
      return createElement("button", { className: "clow-art" }, `bookmark-${item.id}`);
    },
  }));
  assert.deepEqual(positions.map(p => p[0]), [1,2,3,4,5,6,7,8]);
  assert.deepEqual(positions.map(p => p[1]), [4,3,5,2,6,1,7,0]);
  assert.ok(positions.every(p => p[2] === 4));
  assert.match(html, /data-hand-slot="4" data-bookmark-rank="1" style="grid-column:5;grid-row:1"/);
  assert.match(html, /data-hand-slot="0" data-bookmark-rank="8" style="grid-column:1;grid-row:1"/);
  assert.deepEqual(items.map(item => item.id), [1,2,3,4,5,6,7,8]);
});

test("long rows remain flat and the active card stacks above every selected card", () => {
  for (const count of [1, 6, 25, 109, 5000]) {
    for (const activeIndex of [0, Math.floor(count / 2), count - 1]) {
      const active = handPose({ index: activeIndex, count, activeIndex }, false);
      const picked = handPose({ index: activeIndex, count, activeIndex }, true);
      assert.ok(parseFloat(picked["--hand-y"]) <= parseFloat(active["--hand-y"]));
      for (let index = 0; index < count; index++) {
        const idle = handPose({ index, count, activeIndex: null }, false);
        const neighbor = handPose({ index, count, activeIndex }, false);
        const selected = handPose({ index, count, activeIndex }, true);
        assert.equal(idle["--hand-y"], "0px");
        assert.equal(neighbor["--hand-angle"], "0deg");
        assert.equal(selected["--hand-angle"], "0deg");
        if (index !== activeIndex) {
          assert.equal(neighbor["--hand-y"], "0px");
          assert.ok(active["--hand-order"] > selected["--hand-order"]);
        }
      }
    }
  }
});

test("resting stack prioritizes center, left one, right one, left two, right two", () => {
  for (const count of [1, 2, 6, 15, 109, 5000]) {
    for (const centerIndex of [0, Math.floor((count - 1) / 2), count - 1]) {
      const expected = [centerIndex];
      for (let distance = 1; distance < count; distance++) {
        if (centerIndex - distance >= 0) expected.push(centerIndex - distance);
        if (centerIndex + distance < count) expected.push(centerIndex + distance);
      }
      const actual = Array.from({ length: count }, (_, index) => ({ index,
        order: handPose({ index, count, activeIndex: null, centerIndex }, false)["--hand-order"],
      })).sort((a, b) => b.order - a.order);
      assert.deepEqual(actual.map(({ index }) => index), expected);
      assert.ok(actual.every(({ order }) => order > 0));
      const activeIndex = count - 1;
      const active = handPose({ index: activeIndex, count, activeIndex, centerIndex }, false);
      for (let index = 0; index < count; index++) {
        if (index !== activeIndex) assert.ok(active["--hand-order"] > handPose({ index, count, activeIndex, centerIndex }, true)["--hand-order"]);
      }
    }
  }
});

test("one continuous hand includes all 109 results and both endpoints", () => {
  const items = Array.from({ length: 109 }, (_, index) => ({ id: index + 1 }));
  const html = renderToStaticMarkup(createElement(BookmarkHand, { items,
    children: (item) => createElement("button", { className: "clow-art" }, `bookmark-${item.id}`),
  }));
  assert.equal((html.match(/class="hand-section"/g) ?? []).length, 1);
  assert.equal((html.match(/data-hand-slot=/g) ?? []).length, 109);
  assert.match(html, /bookmark-1</);
  assert.match(html, /bookmark-109</);
});
