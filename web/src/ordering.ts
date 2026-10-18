import type { Folder } from "./api";

export type Placement = "before" | "after";

export function reorderedIds(ids: number[], id: number, target: number, placement: Placement): number[] {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return [...ids];
  const result = ids.filter(value => value !== id);
  result.splice(result.indexOf(target) + Number(placement === "after"), 0, id);
  return result;
}

function compareFolders(a: Folder, b: Folder): number {
  const order = (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity);
  if (order && !Number.isNaN(order)) return order;
  // Preserve the existing pending-last default until the user explicitly sorts.
  const pending = (name: string) => Number(/^待整理(?:\s*(?:（[^）]*）|\([^)]*\)))?$/.test(name.trim()));
  return pending(a.name) - pending(b.name) || a.name.localeCompare(b.name, "zh-CN") || a.id - b.id;
}

export function folderSiblings(folders: Folder[], parent: number | null): Folder[] {
  return folders.filter(folder => folder.parent_id === parent).sort(compareFolders);
}

export function folderEntries(folders: Folder[]): { folder: Folder; depth: number }[] {
  const entries: { folder: Folder; depth: number }[] = [];
  const seen = new Set<number>();
  const visit = (folder: Folder, depth: number) => {
    if (seen.has(folder.id)) return;
    seen.add(folder.id);
    entries.push({ folder, depth });
    folderSiblings(folders, folder.id).forEach(child => visit(child, depth + 1));
  };
  folderSiblings(folders, null).forEach(folder => visit(folder, 0));
  // Corrupt legacy cycles or orphaned parents must not hide directories.
  [...folders].sort(compareFolders).forEach(folder => visit(folder, 0));
  return entries;
}

export function keyboardPlacement(ids: number[], id: number, index: number): { target: number; placement: Placement } | null {
  const others = ids.filter(value => value !== id);
  if (!others.length) return null;
  const bounded = Math.max(0, Math.min(index, others.length));
  return bounded < others.length ? { target: others[bounded], placement: "before" } : { target: others[others.length - 1], placement: "after" };
}
