import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/cardDeparture.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { fileName: 'cardDeparture.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { bookmarkTarget, openBookmarkTab, beginDeparture, departureFrame, createDepartureShards, DEPARTURE_FLIP_MS, DEPARTURE_TOTAL_MS, DEPARTURE_STAGGER_MS } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

function frameClock() {
  let next = 0;
  const callbacks = new Map();
  return { request(callback) { callbacks.set(++next, callback); return next; }, cancel(id) { callbacks.delete(id); },
    tick(time) { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(time)); },
    get pending() { return callbacks.size; } };
}

test('flip hands off directly to fragments on the boundary with no hold', () => {
  assert.equal(departureFrame(DEPARTURE_FLIP_MS - 1).phase, 'flipping');
  assert.deepEqual(departureFrame(DEPARTURE_FLIP_MS), { phase: 'shattering', flip: 1, scatterMs: 0 });
  assert.equal(departureFrame(DEPARTURE_FLIP_MS + 16).scatterMs, 16);
});

test('departure finishes once after drawing its last frame, even with delayed frames', () => {
  const clock = frameClock(), events = [];
  const cancel = beginDeparture({ reducedMotion: false, clock, onFrame: f => events.push(f), onFinish: () => events.push('open') });
  assert.deepEqual(events, []);
  clock.tick(5000);
  clock.tick(5000 + DEPARTURE_FLIP_MS);
  assert.equal(events.at(-1).phase, 'shattering');
  clock.tick(5000 + DEPARTURE_TOTAL_MS - 1);
  assert.ok(!events.includes('open'));
  clock.tick(5000 + DEPARTURE_TOTAL_MS + 40);
  assert.equal(events.at(-1), 'open');
  assert.equal(events.at(-2).scatterMs, DEPARTURE_TOTAL_MS - DEPARTURE_FLIP_MS + 40);
  assert.equal(clock.pending, 0);
  cancel(); clock.tick(20000);
  assert.equal(events.filter(e => e === 'open').length, 1);
});

test('cancelling before the first frame or during either phase prevents navigation', () => {
  for (const elapsed of [-1, 0, DEPARTURE_FLIP_MS + 100]) {
    const clock = frameClock(), events = [];
    const cancel = beginDeparture({ reducedMotion: false, clock, onFrame: f => events.push(f), onFinish: () => events.push('open') });
    if (elapsed >= 0) { clock.tick(0); clock.tick(elapsed); }
    cancel(); cancel();
    const before = [...events];
    clock.tick(10000);
    assert.deepEqual(events, before);
    assert.equal(clock.pending, 0);
    assert.ok(!events.includes('open'));
  }
});

test('reduced motion opens immediately and schedules no animation frames', () => {
  const clock = frameClock(), events = [];
  const cancel = beginDeparture({ reducedMotion: true, clock, onFrame: f => events.push(f), onFinish: () => events.push('open') });
  cancel(); clock.tick(10000);
  assert.deepEqual(events, ['open']);
  assert.equal(clock.pending, 0);
});

test('shards cover the whole card with shared edges and bounded timings', () => {
  const shards = createDepartureShards();
  assert.equal(shards.length, 320);
  assert.deepEqual(shards, createDepartureShards());
  let area = 0;
  const edges = new Map();
  for (const shard of shards) {
    const [a, b, c] = shard.points;
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    assert.ok(shard.delay >= 0 && shard.delay <= DEPARTURE_STAGGER_MS);
    const { left, top, width, height } = shard.bounds;
    assert.ok(width > 0 && width < 20 && height > 0 && height < 8, 'each composited particle stays small');
    const local = [...shard.clip.matchAll(/([\d.]+)% ([\d.]+)%/g)].map(match => [Number(match[1]), Number(match[2])]);
    assert.equal(local.length, 3);
    local.forEach(([x, y], i) => {
      assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100);
      assert.ok(Math.abs(left + x / 100 * width - shard.points[i][0]) < .001);
      assert.ok(Math.abs(top + y / 100 * height - shard.points[i][1]) < .001);
    });
    for (const p of shard.points) for (const coordinate of p) assert.ok(coordinate >= 0 && coordinate <= 100);
    for (let i = 0; i < 3; i++) {
      const edge = [shard.points[i], shard.points[(i + 1) % 3]].map(p => p.join(',')).sort().join('|');
      edges.set(edge, (edges.get(edge) || 0) + 1);
    }
  }
  assert.ok(Math.abs(area - 10000) < 1e-6);
  for (const [edge, count] of edges) {
    assert.ok(count === 1 || count === 2);
    if (count === 1) {
      const [a, b] = edge.split('|').map(p => p.split(',').map(Number));
      assert.ok([0, 100].some(bound => (a[0] === bound && b[0] === bound) || (a[1] === bound && b[1] === bound)), 'unpaired edges must be on the perimeter');
    }
  }
});

test('navigation detaches the opener and suppresses referrer before setting the destination', () => {
  const order = [];
  const tab = { set opener(value) { assert.equal(value, null); order.push('detach'); }, document: { createElement() { return {}; }, head: { append(meta) { assert.deepEqual(meta, { name: 'referrer', content: 'no-referrer' }); order.push('referrer'); } } }, location: { replace(url) { order.push(url); } } };
  const host = { open(url, target) { assert.equal(url, 'about:blank'); assert.equal(target, '_blank'); return tab; } };
  assert.equal(openBookmarkTab('https://example.test/path', host), true);
  assert.deepEqual(order, ['detach', 'referrer', 'https://example.test/path']);
});

test('blocked popups, failed navigation and unsafe targets return a recoverable failure', () => {
  assert.equal(openBookmarkTab('https://example.test', { open: () => null }), false);
  let closed = false;
  const failed = { set opener(_) { throw new Error('unavailable'); }, close() { closed = true; } };
  assert.equal(openBookmarkTab('https://example.test', { open: () => failed }), false);
  assert.equal(closed, true);
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/x', 'not a url']) {
    assert.equal(bookmarkTarget(url), undefined);
    assert.equal(openBookmarkTab(url, { open() { assert.fail('must not open'); } }), false);
  }
});
