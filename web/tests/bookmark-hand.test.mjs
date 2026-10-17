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
const { handPose, BookmarkHand } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

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
