import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const code = ts.transpileModule(await readFile(new URL('../src/spiritArtwork.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { restoredSpirits } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const deckKeys = [...(await readFile(new URL('../src/clowDeck.ts', import.meta.url), 'utf8')).matchAll(/\["([a-z]+)",/g)].map(match => match[1]);
const provenance = JSON.parse(await readFile(new URL('../public/spirits/provenance.json', import.meta.url), 'utf8'));

test('all 52 cards have distinct original-art assets with complete, undistorted alpha crops and provenance', async () => {
  assert.deepEqual(Object.keys(restoredSpirits).sort(), [...deckKeys].sort(), 'every deck entry needs a restored subject');
  const hashes = new Set();
  for (const key of deckKeys) {
    const art = restoredSpirits[key];
    const image = await readFile(new URL(`../public${art.src}`, import.meta.url));
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
    assert.deepEqual([width, height], [art.size.w, art.size.h]);
    assert.equal(image[25], 6, 'RGBA alpha must survive asset delivery');
    assert.ok(art.crop.x >= 0 && art.crop.y >= 0 && art.crop.x + art.crop.w <= width && art.crop.y + art.crop.h <= height);
    assert.ok(art.placement.x >= .15 && art.placement.x + art.placement.w <= .85);
    assert.ok(art.placement.y >= .09 && art.placement.y + art.placement.h < .85, 'the complete subject must fit above the scroll');
    const ratio = art.crop.w / art.crop.h;
    assert.ok(Math.abs((art.placement.w * 600 / (art.placement.h * 1344)) / ratio - 1) < .01, 'character proportions must stay unchanged');
    const hash = createHash('sha256').update(image).digest('hex');
    hashes.add(hash);
    const record = provenance[art.src.split('/').at(-1)];
    assert.equal(record.sha256, hash, key);
    assert.equal(record.reference, `../clow-deck/${key}.webp`, key);
    assert.ok(record.prompt.includes('transparent'), key);
  }
  assert.equal(hashes.size, 52, 'each card needs its own subject');
});
