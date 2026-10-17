export type WorkspaceMode = "enjoy" | "manage";

// Each page load opens in management mode; enjoy mode is an explicit choice.
// Account authorization stays on the server; auth resets still revoke UI writes.
let currentMode: WorkspaceMode = "manage";
let pendingWrites = 0;
export function getWorkspaceMode(): WorkspaceMode { return currentMode; }
export function resetWorkspaceMode(): void { currentMode = "enjoy"; }
export function setWorkspaceMode(mode: WorkspaceMode): boolean {
  // Let an already submitted write settle before presenting the page as read-only.
  if (mode === "enjoy" && pendingWrites > 0) return false;
  currentMode = mode;
  return true;
}
export function accessiblePage(page: string, mode: WorkspaceMode): string {
  return mode === "manage" ? page : "library";
}
export function beginWorkspaceRequest(path: string, method = "GET"): () => void {
  const read = ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  const auth = ["/auth/login", "/auth/logout", "/auth/setup"].includes(path);
  if (read || auth) return () => {};
  if (currentMode !== "manage") throw new Error("纯享模式下不能修改数据，请先切换到管理模式。");
  pendingWrites++;
  let finished = false;
  return () => {
    if (!finished) { pendingWrites--; finished = true; }
  };
}
