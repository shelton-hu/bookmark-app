import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const url = source => `data:text/javascript;base64,${Buffer.from(transpile(source)).toString('base64')}`;
const departureUrl = url(await readFile(new URL('../src/cardDeparture.ts', import.meta.url), 'utf8'));
const source = (await readFile(new URL('../src/departureCanvas.ts', import.meta.url), 'utf8')).replace('"./cardDeparture"', JSON.stringify(departureUrl));
const { prepareShatter } = await import(url(source));

test('320 canvas fragments copy bounded regions of the same texture and disappear completely', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Path2D');
  Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: class { moveTo() {} lineTo() {} closePath() {} } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'Path2D', previous); else delete globalThis.Path2D; });
  for (const [width, height, ratio] of [[268, 600, 2], [146, 327, 1]]) {
    const draws = [];
    let depth = 0;
    const finite = (...values) => values.forEach(v => assert.ok(Number.isFinite(v)));
    const ctx = { setTransform: finite, clearRect: finite, translate: finite, rotate: finite, scale: finite,
      save() { depth++; }, restore() { depth--; }, clip() {}, drawImage(...args) { draws.push(args); } };
    const canvas = { style: {}, getContext: () => ctx };
    const texture = { width: width * ratio, height: height * ratio };
    const draw = prepareShatter(canvas, texture, width, height, ratio);
    draw(0);
    assert.equal(draws.length, 1);
    draws.length = 0;
    draw(10); // A real frame commonly skips directly past the flip boundary.
    assert.equal(draws.length, 320);
    for (const [image, sx, sy, sw, sh, dx, dy, dw, dh] of draws) {
      assert.equal(image, texture);
      finite(sx, sy, sw, sh, dx, dy, dw, dh);
      assert.ok(sx >= 0 && sy >= 0 && sw > 0 && sh > 0);
      assert.ok(sx + sw <= texture.width + 1e-6 && sy + sh <= texture.height + 1e-6);
      assert.ok(dw < width / 4 && dh < height / 8, 'only small texture regions are copied');
    }
    draws.length = 0;
    draw(495);
    assert.equal(draws.length, 0);
    assert.equal(depth, 0);
  }
});

// Node has no Path2D; supply only the geometry API for the renderer contract test.
