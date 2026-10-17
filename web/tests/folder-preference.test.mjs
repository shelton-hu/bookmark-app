import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/folderPreference.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { FOLDER_PREFERENCE_KEY, readFolderPreference, writeFolderPreference, availableFolder } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test("last directory survives a new read; returning to all collections clears it", () => {
  const browser = storage();
  assert.equal(readFolderPreference(browser), "");
  writeFolderPreference("23", browser);
  assert.equal(readFolderPreference(browser), "23");
  assert.equal(availableFolder(readFolderPreference(browser), [{ id: 23, name: "Renamed folder" }]), "23");
  writeFolderPreference("", browser);
  assert.equal(readFolderPreference(browser), "");
});

test("deleted directories and malformed stored IDs fall back to all collections", () => {
  const browser = storage();
  writeFolderPreference("23", browser);
  assert.equal(availableFolder(readFolderPreference(browser), [{ id: 24 }]), "");
  assert.equal(availableFolder("23", []), "");
  for (const value of ["0", "-1", "01", "1.2", "not-a-folder", "9007199254740992"]) {
    browser.setItem(FOLDER_PREFERENCE_KEY, value);
    assert.equal(readFolderPreference(browser), "");
  }
});

test("unavailable or denied browser storage never blocks browsing", () => {
  const denied = {
    getItem() { throw new Error("Storage denied"); },
    setItem() { throw new Error("Storage denied"); },
    removeItem() { throw new Error("Storage denied"); },
  };
  assert.equal(readFolderPreference(denied), "");
  assert.doesNotThrow(() => writeFolderPreference("23", denied));
  assert.doesNotThrow(() => writeFolderPreference("", denied));
  assert.equal(readFolderPreference(null), "");
  assert.doesNotThrow(() => writeFolderPreference("23", null));
});
