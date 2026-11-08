import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/summonSequence.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { summonFrame, beginSummon, spiritPalette, SUMMON_TOTAL_MS, SUMMON_TURNS } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
const deckSource = await readFile(new URL('../src/clowDeck.ts', import.meta.url), 'utf8');
const { clowDeck } = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(deckSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64')}`);

function frameClock() {
  let next = 0;
  const callbacks = new Map();
  return { request(callback) { callbacks.set(++next, callback); return next; }, cancel(id) { callbacks.delete(id); },
    tick(time) { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(time)); },
    get pending() { return callbacks.size; } };
}

test('the spin comes to rest on the card face before the spirit leaves it', () => {
  const settled = summonFrame(900);
  assert.equal(settled.spin % 360, 0);
  assert.equal(summonFrame(SUMMON_TOTAL_MS).spin, SUMMON_TURNS * 360);
  assert.ok(summonFrame(900).lift < .01, 'the card is back in the plane when the spirit emerges');
  assert.equal(summonFrame(700).emerge, 0);
});

test('every channel stays within 0..1 and the story keeps its order', () => {
  for (let time = -50; time <= SUMMON_TOTAL_MS + 50; time += 10) {
    const f = summonFrame(time);
    for (const key of ['travel', 'lift', 'circle', 'glow', 'empty', 'emerge', 'dissolve', 'rush', 'flash']) assert.ok(f[key] >= 0 && f[key] <= 1, `${key} at ${time}`);
    if (f.dissolve > 0) assert.ok(f.emerge > .5, 'the card only breaks after the spirit has risen');
    if (f.flash > 0) assert.ok(f.rush > 0, 'the flash follows the rush');
  }
  const end = summonFrame(SUMMON_TOTAL_MS);
  assert.equal(end.flash, 1); assert.equal(end.dissolve, 1); assert.equal(end.circle, 0);
});

test('summoning finishes once after its last frame and cancelling prevents navigation', () => {
  const clock = frameClock(), events = [];
  beginSummon({ reducedMotion: false, clock, onFrame: f => events.push(f.elapsed), onFinish: () => events.push('open') });
  clock.tick(1000); clock.tick(1000 + SUMMON_TOTAL_MS - 1);
  assert.ok(!events.includes('open'));
  clock.tick(1000 + SUMMON_TOTAL_MS + 30);
  assert.equal(events.at(-1), 'open'); assert.equal(clock.pending, 0);
  for (const at of [0, 500, 1500]) {
    const c = frameClock(), seen = [];
    const cancel = beginSummon({ reducedMotion: false, clock: c, onFrame: () => {}, onFinish: () => seen.push('open') });
    c.tick(0); c.tick(at); cancel(); c.tick(10000);
    assert.deepEqual(seen, []); assert.equal(c.pending, 0);
  }
  const reduced = [];
  beginSummon({ reducedMotion: true, clock: frameClock(), onFrame: () => reduced.push('frame'), onFinish: () => reduced.push('open') });
  assert.deepEqual(reduced, ['open']);
});

test('every card in the deck has a spirit colour', () => {
  for (const card of clowDeck) {
    const palette = spiritPalette(card.key);
    for (const colour of Object.values(palette)) assert.match(colour, /^#[0-9a-f]{6}$/);
  }
});
