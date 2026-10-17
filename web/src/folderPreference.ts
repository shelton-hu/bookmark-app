type FolderStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const FOLDER_PREFERENCE_KEY = "bookmark:last-folder-id";

function browserStorage(): FolderStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

function folderId(value: unknown): string {
  return typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? value : "";
}

export function readFolderPreference(storage: FolderStorage | null = browserStorage()): string {
  try { return folderId(storage?.getItem(FOLDER_PREFERENCE_KEY)); }
  catch { return ""; }
}

export function writeFolderPreference(value: string, storage: FolderStorage | null = browserStorage()): void {
  try {
    const id = folderId(value);
    if (id) storage?.setItem(FOLDER_PREFERENCE_KEY, id);
    else storage?.removeItem(FOLDER_PREFERENCE_KEY);
  } catch { /* Browsing still works when local storage is unavailable. */ }
}

export function availableFolder(value: string, folders: readonly { id: number }[]): string {
  const id = folderId(value);
  return id && folders.some((folder) => folder.id === Number(id)) ? id : "";
}
