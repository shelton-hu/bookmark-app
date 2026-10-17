import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {userError, validPage} from '../core.mjs';

// Run the real popup with isolated browser/DOM boundaries; collection must require confirmation.
const source = (await readFile(new URL('../popup.js', import.meta.url), 'utf8')).replace(/^import .*?;\s*/u, '');
const runPopup = new (Object.getPrototypeOf(async function () {}).constructor)('document', 'chrome', 'window', 'userError', 'validPage', source);

async function popup(response) {
  const elements = new Map();
  const documentEvents = {};
  const calls = [];
  let closed = false;
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        textContent: '', dataset: {}, disabled: false, hidden: false, events: {},
        focus() {}, addEventListener(name, handler) { this.events[name] = handler; },
      });
      return elements.get(id);
    },
    addEventListener(name, handler) { documentEvents[name] = handler; },
  };
  const chrome = {
    tabs: {query: async () => [{id: 7, title: 'Reading', url: 'https://example.com/reading'}]},
    runtime: {
      sendMessage: async message => { calls.push(message); return response; },
      openOptionsPage: async () => {},
    },
  };
  await runPopup(document, chrome, {close() { closed = true; }}, userError, validPage);
  return {element: id => elements.get(id), calls, documentEvents, isClosed: () => closed};
}

test('only confirmation collects, and successful new collection points to the inbox', async () => {
  const ui = await popup({ok: true, result: {status: 'saved'}});
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.element('page-title').textContent, 'Reading');
  assert.equal(ui.element('confirm').disabled, false);
  await ui.element('confirm').events.click();
  assert.deepEqual(ui.calls, [{type: 'collect', tabId: 7}]);
  assert.equal(ui.element('confirm').textContent, '已加入待整理');
  assert.match(ui.element('status').textContent, /「待整理箱」.*AI 整理/);
  assert.equal(ui.element('confirm').disabled, true);
  assert.equal(ui.element('confirm').dataset.complete, 'true');
});

test('offline and unconfigured captures remain clearly distinguished from server success', async () => {
  for (const configured of [true, false]) {
    const ui = await popup({ok: true, result: {status: 'queued', configured}});
    await ui.element('confirm').events.click();
    assert.equal(ui.element('confirm').textContent, '已加入待同步');
    assert.match(ui.element('status').textContent, /同步到「待整理箱」/);
    assert.match(ui.element('status').textContent, configured ? /网络恢复后/ : /已保存到本机/);
  }
});

test('duplicate collection preserves the existing filing message, while errors allow retry', async () => {
  const duplicate = await popup({ok: true, result: {status: 'duplicate'}});
  await duplicate.element('confirm').events.click();
  assert.equal(duplicate.element('confirm').textContent, '已经收藏');
  assert.match(duplicate.element('status').textContent, /原分类和备注保持不变/);
  assert.doesNotMatch(duplicate.element('status').textContent, /加入待整理/);

  const failed = await popup({ok: false, error: 'Connection failed'});
  await failed.element('confirm').events.click();
  assert.equal(failed.element('status').className, 'error');
  assert.equal(failed.element('confirm').disabled, false);
  assert.equal(failed.element('confirm').dataset.complete, undefined);
});

test('cancel and Escape close without collecting', async () => {
  const cancel = await popup({ok: true});
  cancel.element('cancel').events.click();
  assert.equal(cancel.isClosed(), true);
  assert.equal(cancel.calls.length, 0);
  const escape = await popup({ok: true});
  escape.documentEvents.keydown({key: 'Escape'});
  assert.equal(escape.isClosed(), true);
  assert.equal(escape.calls.length, 0);
});
