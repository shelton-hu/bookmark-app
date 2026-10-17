import { beginWorkspaceRequest } from "./workspaceMode";

export interface Bookmark {
  id: number;
  url: string;
  title: string;
  description: string;
  excerpt: string;
  summary: string;
  notes: string;
  folder_id: number | null;
  tags: string[];
  source_folder: string;
  classification_status: "pending" | "done" | "failed";
  manual_classification: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  error?: string;
  details_loaded?: boolean;
}
type DetailField = "description" | "excerpt" | "summary" | "notes" | "error";
export type BookmarkListItem = Omit<Bookmark, DetailField> & Partial<Pick<Bookmark, DetailField>>;
export interface BookmarkListResult {
  items: BookmarkListItem[];
  total: number;
  page?: number;
  page_size?: number;
  ids?: number[];
  warning?: string;
}
export function bookmarkFromList(item: BookmarkListItem): Bookmark {
  return { ...item, description: item.description ?? "", excerpt: item.excerpt ?? "",
    summary: item.summary ?? "", notes: item.notes ?? "" };
}
export interface Folder {
  id: number;
  name: string;
  parent_id: number | null;
  bookmark_count?: number;
}
export interface ModelConfig {
  base_url: string;
  model: string;
  has_key: boolean;
  prompt?: string;
}
export interface Settings {
  classification: ModelConfig;
  embedding: ModelConfig;
  concurrency: number;
  send_excerpt: boolean;
  index_status: Record<string, unknown>;
}
export interface Job {
  id: number;
  kind: "classify" | "fetch" | "reindex";
  status: "queued" | "running" | "paused" | "completed" | "failed";
  total: number;
  completed: number;
  failed: number;
  error?: string;
  created_at: string;
}
export interface Token {
  id: number;
  name: string;
  created_at: string;
}
export interface Preview {
  preview_id: string;
  changes: {
    folder_id: number;
    name?: string;
    parent_id?: number | null;
    merge_into?: number;
  }[];
  description: string;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export function localized(text: string): string {
  const known: Record<string, string> = {
    "Authentication required": "请先登录后继续操作。",
    "Invalid username or password": "用户名或密码不正确，请重新输入。",
    "Account is already initialized": "账号已经建立，请使用现有账号登录。",
    "Bookmark not found": "书签不存在，可能已被移除。请刷新列表。",
    "Folder does not exist": "目录不存在，请重新选择目录。",
    "Folder not found": "目录不存在，请刷新目录列表。",
    "Folder name is empty": "目录名称不能为空。",
    "Origin is not allowed":
      "请求来源未被允许，请使用服务地址访问，或检查允许的开发来源。",
    "A reindex is already active": "已有索引重建任务，请先完成或继续该任务。",
    "Only active jobs can pause": "该任务已停止，无法暂停。请刷新任务状态。",
    "Job is not paused": "任务未处于暂停状态，请刷新任务状态。",
    "Only failed jobs can retry": "只有失败任务可以重试，请刷新任务状态。",
    "Preview not found or already applied":
      "预览已应用或不存在，请重新生成整理预览。",
    "Import exceeds 10 MB limit": "导入文件超过 10 MB，请拆分后重新导入。",
    "Classification assistant model request failed":
      "分类模型请求失败，请检查模型配置和网络后重试。你的规则草案仍保留。",
    "Invalid assistant response": "模型返回的分类结果不完整，请重试。",
    "Invalid classification path": "模型返回的目录不符合要求，请重试。",
    "Invalid classification tags": "模型返回的标签不符合要求，请重试。",
    "Invalid classification summary": "模型返回的摘要不符合要求，请重试。",
    "Invalid classification reason": "模型未提供有效的分类理由，请重试。",
    "Assistant requires active bookmarks":
      "所选书签已进入回收站，请关闭助手并重新选择书签。",
    "Some bookmarks are not indexed; rebuild the semantic index.":
      "部分书签尚未建立语义索引，请重建索引以获得完整搜索结果。",
  };
  if (known[text]) return known[text];
  const fallback = "Semantic search unavailable; using keyword search. ";
  if (text.startsWith(fallback))
    return (
      "语义搜索暂不可用，已回退关键词搜索。原因：" + text.slice(fallback.length)
    );
  return text;
}
function detailMessage(detail: unknown): string {
  if (typeof detail === "string") return localized(detail);
  if (Array.isArray(detail))
    return detail
      .map((d) =>
        typeof d === "object" && d !== null && "msg" in d
          ? String(d.msg)
          : String(d),
      )
      .join("；");
  return detail ? JSON.stringify(detail) : "请求失败，请稍后重试。";
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 45000,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const finishRequest = beginWorkspaceRequest(path, options.method);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch("/api" + path, {
      ...options,
      // Lists and account data must not reuse a response from before a mutation.
      cache: "no-store",
      headers,
      credentials: "same-origin",
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = undefined;
    }
    if (!response.ok) {
      if (response.status === 401)
        window.dispatchEvent(new Event("auth-expired"));
      const detail =
        typeof data === "object" && data !== null && "detail" in data
          ? data.detail
          : undefined;
      throw new ApiError(
        detail
          ? detailMessage(detail)
          : `请求失败（${response.status}），请重试。`,
        response.status,
      );
    }
    if (text && data === undefined)
      throw new Error("服务器返回了无法识别的数据，请检查服务状态。");
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("请求已取消或超时，请重试。");
    if (error instanceof TypeError)
      throw new Error("无法连接服务，请检查网络和 NAS 服务是否运行。");
    throw error;
  } finally {
    finishRequest();
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
export function folderPath(id: number | null, folders: Folder[]): string {
  const names: string[] = [];
  const visited = new Set<number>();
  while (id !== null && !visited.has(id)) {
    visited.add(id);
    const folder = folders.find((f) => f.id === id);
    if (!folder) break;
    names.unshift(folder.name);
    id = folder.parent_id;
  }
  return names.join(" / ") || "未归档";
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : "发生未知错误，请重试。";
export const modelReady = (model: ModelConfig | undefined) =>
  Boolean(model?.model && model?.base_url && model?.has_key);
export const date = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
      }).format(parsed);
};
