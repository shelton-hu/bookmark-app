import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Execute the real TS request boundary without adding a browser or test dependency.
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString("base64")}`;
const modeUrl = moduleUrl(await readFile(new URL("../src/workspaceMode.ts", import.meta.url), "utf8"));
const mode = await import(modeUrl);
const apiSource = (await readFile(new URL("../src/api.ts", import.meta.url), "utf8"))
  .replace('"./workspaceMode"', JSON.stringify(modeUrl));
const { api, post } = await import(moduleUrl(apiSource));
const originalFetch = globalThis.fetch;
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
test.afterEach(() => { globalThis.fetch = originalFetch; mode.resetWorkspaceMode(); });

test("fresh workspace starts in management; explicit enjoy mode restricts management pages", () => {
  assert.equal(mode.getWorkspaceMode(), "manage");
  for (const page of ["settings", "folders", "transfer", "jobs", "trash"]) {
    assert.equal(mode.accessiblePage(page, "enjoy"), "library");
    assert.equal(mode.accessiblePage(page, "manage"), page);
  }
  assert.equal(mode.accessiblePage("library", "enjoy"), "library");
  assert.equal(mode.accessiblePage("pending", "enjoy"), "library");
  assert.equal(mode.accessiblePage("pending", "manage"), "pending");
});
test("read-only blocks every write path before fetch, including delayed callbacks", async () => {
  let sent = 0;
  globalThis.fetch = async () => { sent++; return ok(); };
  const writes = [["/bookmarks", "POST"], ["/bookmarks/1", "PATCH"], ["/bookmarks/1", "DELETE"],
    ["/bookmarks/1/restore", "POST"], ["/folders", "POST"], ["/folders/bulk-delete", "POST"],
    ["/settings", "PUT"], ["/tokens/1", "DELETE"], ["/import/confirm", "POST"], ["/jobs", "POST"],
    ["/assistant/apply", "POST"], ["/folders/organize-apply", "POST"],
    ["/folders/move-bookmarks-preview", "POST"], ["/folders/move-bookmarks", "POST"],
    ["/trash/delete-preview", "POST"], ["/trash/delete", "POST"], ["/trash/restore", "POST"]];
  mode.setWorkspaceMode("manage");
  const delayedSave = () => post("/bookmarks", { title: "stale" });
  mode.setWorkspaceMode("enjoy");
  for (const [path, method] of writes) await assert.rejects(api(path, { method }), /纯享模式/);
  await assert.rejects(delayedSave(), /纯享模式/);
  assert.equal(sent, 0);
});
test("search, detail reads and login/logout continue working in enjoy mode", async () => {
  const sent = [];
  globalThis.fetch = async (path) => { sent.push(path); return ok(); };
  await api("/bookmarks?q=moon");
  await api("/folders");
  for (const action of ["login", "logout", "setup"]) await post(`/auth/${action}`);
  assert.equal(sent.length, 5);
});
test("management permits writes; returning to enjoy blocks subsequent writes", async () => {
  let sent = 0;
  globalThis.fetch = async () => { sent++; return ok(); };
  mode.setWorkspaceMode("manage");
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) await api("/bookmarks/1", { method });
  assert.equal(mode.setWorkspaceMode("enjoy"), true);
  await assert.rejects(post("/bookmarks"), /纯享模式/);
  assert.equal(sent, 4);
});
test("in-flight writes must finish before switching to enjoy", async () => {
  let resolve;
  globalThis.fetch = () => new Promise((done) => { resolve = done; });
  mode.setWorkspaceMode("manage");
  const pending = post("/bookmarks");
  assert.equal(mode.setWorkspaceMode("enjoy"), false);
  assert.equal(mode.getWorkspaceMode(), "manage");
  resolve(ok());
  await pending;
  assert.equal(mode.setWorkspaceMode("enjoy"), true);
});
test("failed and cancelled requests release the mode switch", async () => {
  for (const error of [new TypeError("network"), new DOMException("cancelled", "AbortError")]) {
    mode.setWorkspaceMode("manage");
    globalThis.fetch = async () => { throw error; };
    await assert.rejects(post("/bookmarks"));
    assert.equal(mode.setWorkspaceMode("enjoy"), true);
  }
  mode.setWorkspaceMode("manage");
  globalThis.fetch = async () => new Response('{"detail":"conflict"}', { status: 409 });
  await assert.rejects(post("/bookmarks"), /conflict/);
  assert.equal(mode.setWorkspaceMode("enjoy"), true);
});
test("authentication reset revokes writes even while an earlier write settles", async () => {
  mode.setWorkspaceMode("manage");
  const finish = mode.beginWorkspaceRequest("/bookmarks", "POST");
  mode.resetWorkspaceMode();
  await assert.rejects(post("/bookmarks"), /纯享模式/);
  finish();
  finish(); // completion is idempotent
  assert.equal(mode.setWorkspaceMode("enjoy"), true);
});

test("identical list URLs bypass stored responses after delete and restore", async () => {
  mode.setWorkspaceMode("manage");
  let liveIds = [1, 2];
  const storedIds = [...liveIds];
  globalThis.fetch = async (path, options) => {
    if (options.method === "DELETE") liveIds = liveIds.filter(id => id !== 1);
    else if (options.method === "POST") liveIds = [1, ...liveIds];
    else {
      const ids = options.cache === "no-store" ? liveIds : storedIds;
      return new Response(JSON.stringify({ ids: [...ids] }), { status: 200 });
    }
    return ok();
  };
  const url = "/bookmarks?view=summary&page=1&include_ids=true";
  assert.deepEqual((await api(url)).ids, [1, 2]);
  await api("/bookmarks/1", { method: "DELETE" });
  assert.deepEqual((await api(url)).ids, [2]);
  // The private API boundary must also override a caller's cache preference.
  assert.deepEqual((await api(url, { cache: "force-cache" })).ids, [2]);
  await post("/bookmarks/1/restore");
  assert.deepEqual((await api(url)).ids, [1, 2]);
});

test("folder reads bypass a proxy that caches by URL despite no-store", async () => {
  mode.setWorkspaceMode("manage");
  const path = "/bookmarks?q=&folder_id=7&include_children=true&view=summary&page=1&page_size=20&include_ids=true";
  const snapshot = (ids) => JSON.stringify({ ids: [...ids], total: ids.length });
  let liveIds = [1, 2];
  const proxyCache = new Map([["/api" + path, snapshot(liveIds)]]);
  const reads = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options.cache, "no-store");
    if (options.method === "DELETE") {
      assert.equal(url, "/api/bookmarks/1");
      liveIds = [2];
      return ok();
    }
    if (options.method === "POST") {
      assert.equal(url, "/api/bookmarks/1/restore");
      liveIds = [1, 2];
      return ok();
    }
    reads.push(url);
    const parsed = new URL(url, "https://example.test");
    assert.equal(parsed.searchParams.get("folder_id"), "7");
    assert.equal(parsed.searchParams.get("include_children"), "true");
    // Deliberately ignore Fetch cache mode and cache-control request headers,
    // just as a forced reverse-proxy cache does.
    if (!proxyCache.has(url)) proxyCache.set(url, snapshot(liveIds));
    return new Response(proxyCache.get(url), {
      headers: { "Cache-Control": "no-store" },
    });
  };
  assert.deepEqual(await api(path), { ids: [1, 2], total: 2 });
  await api("/bookmarks/1", { method: "DELETE" });
  assert.deepEqual(await api(path), { ids: [2], total: 1 });
  await post("/bookmarks/1/restore");
  assert.deepEqual(await api(path), { ids: [1, 2], total: 2 });
  assert.equal(new Set(reads).size, 3);
});

test("account and directory reads also bypass a forced URL cache", async () => {
  let loggedIn = false;
  const proxyCache = new Map();
  globalThis.fetch = async (url, options) => {
    if (options.method === "POST") { loggedIn = true; return ok(); }
    if (!proxyCache.has(url)) proxyCache.set(url, JSON.stringify({ authenticated: loggedIn }));
    return new Response(proxyCache.get(url));
  };
  for (const path of ["/auth/status", "/folders", "/bookmarks/1"]) {
    loggedIn = false;
    assert.equal((await api(path)).authenticated, false);
    await post("/auth/login", { username: "example", password: "synthetic" });
    assert.equal((await api(path)).authenticated, true);
  }
});
