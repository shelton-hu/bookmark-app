import type { WorkspaceMode } from "./workspaceMode";

export function bookmarkQuery({ mode, page, query, searchMode, folderId, tag, listPage, pageSize = 20, searchId }: {
  mode: WorkspaceMode; page: string; query: string; searchMode: "keyword" | "semantic"; folderId: string; tag: string;
  listPage?: number; pageSize?: number;
  searchId?: string;
}): URLSearchParams {
  const managing = mode === "manage";
  const params = new URLSearchParams({ q: query, mode: searchMode, trash: String(managing && page === "trash"), pending: String(managing && page === "pending") });
  // Folder scope is visible in both modes; only management exposes tags and private lists.
  if (folderId && !(managing && page === "pending")) { params.set("folder_id", folderId); params.set("include_children", "true"); }
  if (managing && tag.trim()) params.set("tag", tag.trim());
  // Callers opting into the lightweight list get server pagination in management only.
  if (listPage !== undefined) {
    params.set("view", "summary");
    if (managing) {
      params.set("page", String(listPage));
      params.set("page_size", String(pageSize));
      params.set("include_ids", "true");
    }
  }
  if (searchMode === "semantic" && searchId) params.set("search_id", searchId);
  return params;
}
