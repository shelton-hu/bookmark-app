import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import BookmarkCard from "./ClowBookmark";
import BrandMark from "./BrandMark";
import ClowCatalog from "./ClowCatalog";
import { EnjoyAtmosphere, EnjoySearch, WorkspaceModeSwitch } from "./EnjoyScene";
import { bookmarkQuery } from "./bookmarkQuery";
import { availableFolder, readFolderPreference, writeFolderPreference } from "./folderPreference";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import BookmarkRow, { BookmarkResults } from "./BookmarkList";
import { pageInfo } from "./bookmarkPagination";
import { createRoot } from "react-dom/client";
import {
  Bookmark as BookmarkIcon,
  Library,
  Folder as FolderIcon,
  Search,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  ArrowUpRight,
  X,
  Sparkles,
  Upload,
  ListTodo,
  LogOut,
  Menu,
  RefreshCw,
  Pencil,
  RotateCcw,
  Check,
  ShieldCheck,
  KeyRound,
  AlertCircle,
  Loader2,
  SlidersHorizontal,
  Globe,
  Copy,
  Pause,
  Play,
  CheckCircle2,
  FolderPlus,
} from "lucide-react";
import {
  api,
  post,
  message,
  modelReady,
  date,
  folderPath,
  localized,
  bookmarkFromList,
} from "./api";
import type {
  Bookmark,
  Folder,
  Settings,
  Job,
  Token,
  Preview,
  ModelConfig,
  BookmarkListResult,
} from "./api";
import ClassificationAssistant from "./ClassificationAssistant";
import TransferPage from "./TransferPage";
import "./style.css";
import "./green-workspace.css";
import "./clow-cards.css";
import "./clow-theme.css";
import "./clow-material.css";
import "./enjoy-scene.css";
import "./clow-catalog.css";
import "./bookmark-list.css";
import "./brand.css";
import "./card-departure.css";
import "./transfer-page.css";
import { accessiblePage, getWorkspaceMode, resetWorkspaceMode, setWorkspaceMode } from "./workspaceMode";
import type { WorkspaceMode } from "./workspaceMode";

type Page =
  | "library"
  | "pending"
  | "trash"
  | "jobs"
  | "transfer"
  | "settings"
  | "folders";
type DialogState =
  | { type: "bookmark"; bookmark?: Bookmark }
  | { type: "folder"; folder?: Folder }
  | { type: "refresh"; bookmark: Bookmark }
  | { type: "organize"; preview: Preview }
  | { type: "classification-assistant"; bookmarkIds: number[] }
  | {
      type: "confirm";
      title: string;
      description: string;
      confirmLabel?: string;
      action: () => Promise<void>;
    };
const pageNames: Record<Page, string> = {
  library: "书签管理",
  pending: "书签整理",
  trash: "书签回收",
  jobs: "任务中心",
  transfer: "导入导出",
  settings: "应用设置",
  folders: "目录管理",
};
const jobNames: Record<Job["kind"], string> = {
  classify: "AI 分类",
  fetch: "抓取网页",
  reindex: "重建语义索引",
};
const jobStatuses: Record<Job["status"], string> = {
  queued: "排队中",
  running: "进行中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
};
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function ErrorBox({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss?: () => void;
}) {
  return (
    <div role="alert" className="notice error">
      <AlertCircle size={18} />
      <span>{error}</span>
      {onDismiss && (
        <button
          className="icon-button"
          onClick={onDismiss}
          aria-label="关闭错误提示"
        >
          <X size={17} />
        </button>
      )}
    </div>
  );
}
function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BookmarkIcon size={29} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
function Modal({
  title,
  children,
  close,
  error,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="关闭窗口">
          <X size={20} />
        </button>
      </div>
      {error && <ErrorBox error={error} />}
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <Loader2 className="spin" size={22} />
      正在加载…
    </div>
  );
}

function App() {
  const [mode, setMode] = useState<WorkspaceMode>(getWorkspaceMode);
  const managing = mode === "manage";
  const BookmarkView = managing ? BookmarkRow : BookmarkCard;
  const [auth, setAuth] = useState<{
    initialized: boolean;
    authenticated: boolean;
  } | null>(null);
  const [authError, setAuthError] = useState("");
  const [username, setUsername] = useState("");
  const [page, setPage] = useState<Page>(() => {
    const hash = location.hash.slice(1);
    return accessiblePage(hash in pageNames ? hash : "library", getWorkspaceMode()) as Page;
  });
  const [mobileNav, setMobileNav] = useState(false);
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia("(max-width: 1100px)").matches);
  const drawerOpen = compactLayout && mobileNav;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const changed = () => {
      setCompactLayout(media.matches);
      if (!media.matches) setMobileNav(false);
    };
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    navRef.current?.querySelector("nav")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [page]);
  const navToggleRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = navRef.current;
    document.dispatchEvent(new CustomEvent("bookmark-detail-open", { detail: null }));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawer?.querySelector<HTMLButtonElement>("button")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNav(false);
      }
      if (event.key === "Tab" && drawer) {
        const controls = [...drawer.querySelectorAll<HTMLElement>('button:not(:disabled), input, a[href], select')];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      navToggleRef.current?.focus();
    };
  }, [drawerOpen]);
  useEffect(() => {
    const searchShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !drawerOpen && !document.querySelector("dialog[open]") && ["library", "pending", "trash"].includes(page)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", searchShortcut);
    return () => document.removeEventListener("keydown", searchShortcut);
  }, [page, drawerOpen]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<number[]>([]);
  useEffect(() => { setSelectedFolders([]); }, [page]);
  useEffect(() => {
    const available = new Set(folders.map((folder) => folder.id));
    setSelectedFolders((current) => {
      const next = current.filter((id) => available.has(id));
      return next.length === current.length ? current : next;
    });
  }, [folders]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [items, setItems] = useState<Bookmark[]>([]);
  const [resultIds, setResultIds] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [warning, setWarning] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"keyword" | "semantic">(
    "keyword",
  );
  const [folderId, setFolderId] = useState(readFolderPreference);
  const rememberedFolder = useRef(folderId);
  const selectFolder = (id: string) => {
    rememberedFolder.current = id;
    writeFolderPreference(id);
    setFolderId(id);
  };
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const selectionAfterReload = useRef<number[] | null>(null);
  const [pagination, setPagination] = useState({ scope: "", page: 1, size: 20 });
  const listPanelRef = useRef<HTMLElement>(null);
  const resultScope = JSON.stringify([mode, page, query, searchMode, folderId, tag]);
  const requestedPage = managing && pagination.scope === resultScope ? pagination.page : 1;
  const paged = pageInfo(total, requestedPage, pagination.size);
  const visibleItems = items;
  const allPageSelected = visibleItems.length > 0 && visibleItems.every((b) => selected.includes(b.id));
  const somePageSelected = visibleItems.some((b) => selected.includes(b.id));
  useEffect(() => {
    setSelected([]);
    selectionAfterReload.current = null;
  }, [resultScope, pagination.size]);
  const changeListPage = (next: number, size = pagination.size) => {
    setSelected([]);
    setPagination({ scope: resultScope, page: next, size });
    listPanelRef.current?.focus({ preventScroll: true });
    listPanelRef.current?.scrollIntoView({ block: "start" });
  };
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [reload, setReload] = useState(0);
  // A nonsecret grouping key must also work on ordinary LAN HTTP origins.
  const searchId = useMemo(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`, [resultScope, reload]);

  const listRequest = useRef(0);
  const loadedListKey = useRef("");
  const previousQuery = useRef(query);
  const checkAuth = useCallback(async () => {
    try {
      setAuthError("");
      setAuth(await api("/auth/status"));
    } catch (e) {
      setAuthError(message(e));
    }
  }, []);
  useEffect(() => {
    void checkAuth();
    const expired = () => {
      resetWorkspaceMode();
      setMode("enjoy");
      setPage("library");
      setSelected([]);
      setAuth((s) => (s ? { ...s, authenticated: false } : s));
      setMobileNav(false);
      setDialog(null);
      setItems([]);
      setResultIds([]);
      loadedListKey.current = "";
      selectionAfterReload.current = null;
      setTokens([]);
      setSettings(null);
      setError("");
      setAuthError("登录已过期，请重新登录。");
    };
    window.addEventListener("auth-expired", expired);
    return () => window.removeEventListener("auth-expired", expired);
  }, [checkAuth]);
  useEffect(() => {
    const changed = () => {
      const hash = location.hash.slice(1);
      const next = accessiblePage(hash in pageNames ? hash : "library", getWorkspaceMode()) as Page;
      if (hash !== next) history.replaceState(null, "", `#${next}`);
      setPage(next);
      if (next === "library") setFolderId(rememberedFolder.current);
      setSelected([]);
    };
    changed();
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const supporting = useCallback(async () => {
    const results = await Promise.allSettled([
      api<Folder[]>("/folders"),
      api<Settings>("/settings"),
      api<Job[]>("/jobs"),
      api<Token[]>("/tokens"),
      api<{ username: string }>("/auth/me"),
    ]);
    if (results[0].status === "fulfilled") {
      const nextFolders = results[0].value;
      setFolders(nextFolders);
      const remembered = availableFolder(rememberedFolder.current, nextFolders);
      if (remembered !== rememberedFolder.current) {
        rememberedFolder.current = remembered;
        writeFolderPreference(remembered);
      }
      setFolderId((current) => availableFolder(current, nextFolders));
    }
    if (results[1].status === "fulfilled") setSettings(results[1].value);
    if (results[2].status === "fulfilled") setJobs(results[2].value);
    if (results[3].status === "fulfilled") setTokens(results[3].value);
    if (results[4].status === "fulfilled")
      setUsername(results[4].value.username);
    const failed = results.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") setError(message(failed.reason));
  }, []);
  useEffect(() => {
    if (auth?.authenticated) void supporting();
  }, [auth?.authenticated, supporting, reload]);
  useEffect(() => {
    if (!auth?.authenticated || !["library", "pending", "trash"].includes(page)) {
      loadedListKey.current = "";
      return;
    }
    const requestKey = JSON.stringify([resultScope, requestedPage, pagination.size, reload]);
    if (loadedListKey.current === requestKey) return;
    const delay = previousQuery.current === query ? 0 : 250;
    previousQuery.current = query;
    const controller = new AbortController();
    const request = ++listRequest.current;
    setLoading(true);
    if (selectionAfterReload.current === null) setSelected([]);
    const timer = setTimeout(async () => {
      try {
        const params = bookmarkQuery({ mode, page, query, searchMode, folderId, tag,
          listPage: requestedPage, pageSize: pagination.size, searchId });
        const data = await api<BookmarkListResult>("/bookmarks?" + params, { signal: controller.signal });
        if (request === listRequest.current) {
          const ids = data.ids ?? data.items.map((item) => item.id);
          const actualPage = data.page ?? 1;
          loadedListKey.current = JSON.stringify([resultScope, actualPage, pagination.size, reload]);
          setItems(data.items.map(bookmarkFromList));
          setResultIds(ids);
          setTotal(data.total);
          setWarning(localized(data.warning ?? ""));
          if (selectionAfterReload.current !== null) {
            const available = new Set(ids);
            setSelected(selectionAfterReload.current.filter((id) => available.has(id)));
            selectionAfterReload.current = null;
          }
          if (managing && (actualPage !== requestedPage || pagination.scope !== resultScope))
            setPagination({ scope: resultScope, page: actualPage, size: pagination.size });
        }
      } catch (e) {
        if (!controller.signal.aborted && request === listRequest.current) {
          setError(message(e));
          setItems([]);
          setResultIds([]);
          setTotal(0);
        }
      } finally {
        if (request === listRequest.current && !controller.signal.aborted)
          setLoading(false);
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [auth?.authenticated, mode, page, query, searchMode, folderId, tag, reload, resultScope, requestedPage, pagination.size, pagination.scope, managing, searchId]);
  useEffect(() => {
    if (
      !auth?.authenticated ||
      !jobs.some((j) => ["running", "queued"].includes(j.status))
    )
      return;
    const timer = setInterval(() => {
      api<Job[]>("/jobs")
        .then(setJobs)
        .catch((e) => setError(message(e)));
    }, 4000);
    return () => clearInterval(timer);
  }, [auth?.authenticated, jobs]);
  const navigate = (requested: Page) => {
    const next = accessiblePage(requested, getWorkspaceMode()) as Page;
    location.hash = next;
    setPage(next);
    setMobileNav(false);
    setSelected([]);
    setError("");
    if (next === "library" || next === "pending" || next === "trash") {
      setFolderId(next === "library" ? rememberedFolder.current : "");
      setTag("");
      setQuery("");
    }
  };
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  };
  const switchMode = (next: WorkspaceMode) => {
    if (next === mode || busy) return;
    if (!setWorkspaceMode(next)) {
      setToast("当前操作正在提交，完成后即可切换到纯享模式。");
      return;
    }
    setMode(next);
    setDialog(null);
    setSelected([]);
    setSelectedFolders([]);
    setError("");
    setMobileNav(false);
    document.dispatchEvent(new CustomEvent("bookmark-detail-open", { detail: null }));
    if (next === "enjoy") {
      setTag("");
      location.hash = "library";
      setPage("library");
    }
    setToast(next === "manage" ? "已进入管理模式，可以添加、编辑和整理收藏。" : "已进入纯享模式，安心查阅你的收藏。");
  };
  const updated = (text: string) => {
    setToast(text);
    setReload((n) => n + 1);
  };
  const open = (state: DialogState) => {
    if (getWorkspaceMode() !== "manage") return;
    setError("");
    setDialog(state);
  };
  const openBookmarkAction = (type: "bookmark" | "refresh", bookmark: Bookmark) => {
    if (bookmark.details_loaded !== false) { open({ type, bookmark }); return; }
    void run("读取书签", async () => {
      const detail = await api<Bookmark>(`/bookmarks/${bookmark.id}`);
      open({ type, bookmark: detail });
    });
  };
  const confirm = (
    title: string,
    description: string,
    action: () => Promise<void>,
  ) => open({ type: "confirm", title, description, action });
  const requestDeleteFolders = () => {
    const ids = [...selectedFolders];
    if (!ids.length || busy) return;
    void run("统计所选目录", async () => {
      const counts = await post<{ folders_deleted: number; bookmarks_affected: number; children_reparented: number }>(
        "/folders/delete-preview", { folder_ids: ids },
      );
      confirm(
        `删除所选 ${counts.folders_deleted} 个目录？`,
        `所选目录内的 ${counts.bookmarks_affected} 条书签（含回收站记录）会保留，并移到未归档；回收站记录仍留在回收站。未选中的子目录会提升到最近保留的上级，共 ${counts.children_reparented} 个。此操作只删除目录。`,
        async () => {
          const result = await post<{ folders_deleted: number; bookmarks_affected: number }>(
            "/folders/bulk-delete", { folder_ids: ids },
          );
          setSelectedFolders([]);
          setFolderId("");
          setDialog(null);
          updated(`已删除 ${result.folders_deleted} 个目录，保留 ${result.bookmarks_affected} 条书签`);
        },
      );
    });
  };
  const requestPurge = (ids?: number[]) => {
    if (busy || (ids && !ids.length)) return;
    const scope = ids ? { bookmark_ids: [...ids] } : { all: true };
    void run("统计回收站", async () => {
      const preview = await post<{ count: number; snapshot: string }>("/trash/delete-preview", scope);
      if (!preview.count) { updated("回收站已经是空的"); return; }
      open({
        type: "confirm",
        title: ids ? `彻底删除所选 ${preview.count} 条书签？` : `清空整个回收站（${preview.count} 条）？`,
        description: `${ids ? `仅永久删除已选中的 ${preview.count} 条回收站记录。` : `将永久删除整个回收站的 ${preview.count} 条记录，包含当前搜索、目录和标签筛选之外的内容。`}网址、摘要、备注和关联索引将被删除，无法恢复。正常书签不受影响。`,
        confirmLabel: ids ? "彻底删除" : "清空整个回收站",
        action: async () => {
          // The server rejects the entire operation if this exact preview has changed.
          const result = await post<{ deleted: number }>("/trash/delete", { ...scope, snapshot: preview.snapshot });
          setSelected([]);
          updated(`已彻底删除 ${result.deleted} 条回收站记录`);
        },
      });
    });
  };
  const restoreTrash = async (ids: number[]) => {
    const result = await post<{ restored: number[]; conflicts: number[] }>("/trash/restore", { bookmark_ids: ids });
    const restored = new Set(result.restored);
    setItems((current) => current.filter((bookmark) => !restored.has(bookmark.id)));
    setTotal((current) => Math.max(0, current - restored.size));
    setSelected(result.conflicts);
    selectionAfterReload.current = result.conflicts;
    setReload((value) => value + 1);
    setToast(`已恢复 ${restored.size} 条书签${result.conflicts.length ? `；${result.conflicts.length} 条因网址重复仍留在回收站，已保留选中。` : ""}`);
  };
  const requestRestoreSelected = () => {
    const ids = [...selected];
    if (!ids.length || busy) return;
    confirm(`恢复所选 ${ids.length} 条书签？`, "将恢复到原目录；原目录已删除的记录恢复到未归档。已有相同网址或所选记录中网址重复的项会留在回收站。", () => restoreTrash(ids));
  };
  const requestDeleteSelected = () => {
    const ids = [...selected];
    if (!ids.length || busy) return;
    confirm(
      `将 ${ids.length} 条书签移到回收站？`,
      `仅删除已选中的 ${ids.length} 条书签。它们会在回收站保留 30 天，期间可以恢复。`,
      async () => {
        const removed = new Set<number>();
        const failed: number[] = [];
        let failureReason = "";
        for (const id of ids) {
          try {
            await api("/bookmarks/" + id, { method: "DELETE" });
            removed.add(id);
          } catch (e) {
            failed.push(id);
            if (!failureReason) failureReason = message(e);
          }
        }
        setDialog(null);
        if (failed.length) {
          setItems((current) => current.filter((bookmark) => !removed.has(bookmark.id)));
          setTotal((current) => Math.max(0, current - removed.size));
          setSelected(failed);
          selectionAfterReload.current = failed;
          setReload((value) => value + 1);
          if (removed.size) setToast(`已将 ${removed.size} 条书签移到回收站`);
          throw new Error(`有 ${failed.length} 条书签删除失败，已保留选中，可重试。${failureReason}`);
        }
        setSelected([]);
        updated(`已将 ${removed.size} 条书签移到回收站`);
      },
    );
  };
  const startJob = async (kind: Job["kind"], force = false, ids?: number[]) => {
    const job = await post<Job>("/jobs", {
      kind,
      ...(kind === "reindex"
        ? {}
        : ids
          ? { bookmark_ids: ids }
          : selected.length
            ? { bookmark_ids: selected }
            : {}),
      force,
    });
    setJobs((old) => [job, ...old.filter((j) => j.id !== job.id)]);
    setSelected([]);
    setToast("任务已创建，可在任务中心查看进度。");
    navigate("jobs");
  };
  const requestJob = (kind: Job["kind"]) => {
    if (kind === "classify" && !modelReady(settings?.classification)) {
      setError("请先在设置中填写分类服务地址、模型和 API Key。");
      return;
    }
    if (kind === "reindex" && !modelReady(settings?.embedding)) {
      setError("请先在设置中填写 Embedding 服务地址、模型和 API Key。");
      return;
    }
    if (kind === "reindex")
      confirm(
        "重建语义索引？",
        "这会调用 Embedding 服务处理所有有效书签，可能产生费用。新索引全部成功后才会发布；失败会保留旧索引。",
        () => startJob(kind),
      );
    else if (kind === "fetch")
      confirm(
        "抓取网页内容？",
        `将抓取${selected.length ? `选中的 ${selected.length} 条` : "全部有效"}书签。抓取结果用于摘要与后续分类，可能耗时较长。`,
        () => startJob(kind),
      );
    else
      void run("检查分类范围", async () => {
        const data = await api<{ items: Bookmark[] }>("/bookmarks?view=summary");
        const eligible = data.items.filter(
          (b) =>
            !b.manual_classification &&
            (selected.length
              ? selected.includes(b.id)
              : b.classification_status === "pending"),
        );
        if (!eligible.length) {
          setToast("没有符合条件的书签；手动分类受保护。");
          return;
        }
        confirm(
          "开始 AI 分类？",
          `将处理 ${eligible.length} 条${selected.length ? "所选" : "待分类"}书签，生成摘要、目录和标签。内容会发送至你配置的分类服务，可能产生费用。手动分类不会被覆盖。`,
          () =>
            startJob(
              kind,
              false,
              eligible.map((b) => b.id),
            ),
        );
      });
  };
  const download = async (format: "html" | "json") => {
    const response = await fetch("/api/export/" + format, {
      credentials: "same-origin",
    });
    if (!response.ok) {
      let detail = "";
      try {
        detail = message(new Error((await response.json()).detail));
      } catch {
        detail = `导出失败（${response.status}）`;
      }
      throw new Error(detail);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `拾页备份-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("导出已生成，请查看浏览器下载。");
  };
  if (!auth || !auth.authenticated)
    return (
      <AuthScreen
        auth={auth}
        error={authError}
        retry={checkAuth}
        onSuccess={async (name) => {
          setWorkspaceMode("manage");
          setMode("manage");
          setPage("library");
          setUsername(name);
          setAuth({ initialized: true, authenticated: true });
          setAuthError("");
        }}
      />
    );
  const activeJobs = jobs.filter((j) =>
    ["queued", "running", "paused"].includes(j.status),
  ).length;
  const libraryPage = ["library", "pending", "trash"].includes(page);
  return (
    <div className={`app-shell clarity-shell clow-theme mode-${mode}`} data-mode={mode}>
      {!managing && <EnjoyAtmosphere />}
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        跳到主要内容
      </a>
      {managing && <aside
        ref={navRef}
        className={`sidebar ${drawerOpen ? "visible" : ""}`}
        role={compactLayout ? "dialog" : undefined}
        aria-modal={drawerOpen || undefined}
        aria-hidden={compactLayout && !drawerOpen}
        inert={compactLayout && !drawerOpen}
        aria-label="导航与目录"
      >
        <div className="brand">
          <div className="brand-mark">
            <BrandMark transparent />
          </div>
          <div>
            <strong>拾页</strong>
            <span>THE BOOK OF BOOKMARKS</span>
          </div>
          <button
            className="icon-button sidebar-close mobile-only"
            onClick={() => setMobileNav(false)}
            aria-label="关闭导航"
          >
            <X size={20} />
          </button>
        </div>
        <nav>
          <button
            className={page === "library" ? "nav-item active" : "nav-item"}
            aria-current={page === "library" ? "page" : undefined}
            onClick={() => navigate("library")}
          >
            <Library size={19} />
            {pageNames.library}
          </button>
          <button
            className={page === "pending" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("pending")}
          >
            <Sparkles size={19} />
            {pageNames.pending}
          </button>
          {managing && <>
          <button
            className={page === "folders" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("folders")}
          >
            <SlidersHorizontal size={18} />
            {pageNames.folders}
          </button>
          <button
            className={page === "jobs" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("jobs")}
          >
            <ListTodo size={19} />
            {pageNames.jobs}
            {activeJobs > 0 && <span className="nav-count">{activeJobs}</span>}
          </button>
          <button
            className={page === "transfer" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("transfer")}
          >
            <Upload size={19} />
            {pageNames.transfer}
          </button>
          <button
            className={page === "trash" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("trash")}
          >
            <Trash2 size={19} />
            {pageNames.trash}
          </button>
          <button
            className={page === "settings" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("settings")}
          >
            <SettingsIcon size={19} />
            {pageNames.settings}
          </button>
          </>}
        </nav>
        <div className="sidebar-bottom">
          <div className="avatar">
            {username.slice(0, 1).toUpperCase() || "我"}
          </div>
          <div className="account">
            <strong>{username}</strong>
            <span>私有收藏 · 局域网</span>
          </div>
          <button
            className="icon-button"
            disabled={Boolean(busy)}
            aria-label="退出登录"
            onClick={() =>
              void run("退出登录", async () => {
                await post("/auth/logout");
                resetWorkspaceMode();
                setMode("enjoy");
                setPage("library");
                setSelected([]);
                setAuth({ initialized: true, authenticated: false });
                setMobileNav(false);
                setSettings(null);
                setTokens([]);
                setDialog(null);
                setItems([]);
                setToast("");
              })
            }
          >
            <LogOut size={19} />
          </button>
        </div>
      </aside>}
      {managing && drawerOpen && (
        <button
          className="nav-scrim"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="workspace" inert={drawerOpen}>
        {managing && <header className="topbar">
          <button className="workbench-brand" onClick={() => navigate("library")} aria-label="拾页，返回书签库">
            <BrandMark size={32} transparent />
            <strong>拾页</strong>
            <small>书签管理</small>
          </button>
          <div className="workbench-tools">
            <WorkspaceModeSwitch mode={mode} busy={Boolean(busy)} onChange={switchMode} />
            {managing && <button className="icon-button settings-toggle" aria-label="设置" aria-current={page === "settings" ? "page" : undefined} onClick={() => navigate("settings")}><SettingsIcon size={19} /></button>}
            <button ref={navToggleRef} className="icon-button navigation-toggle mobile-only" aria-label="打开导航与目录" aria-expanded={drawerOpen} onClick={() => setMobileNav(true)}><Menu size={21} /></button>
            {managing && libraryPage && page !== "trash" && <button className="primary action-add" onClick={() => open({ type: "bookmark" })}><Plus size={17} />添加网址</button>}
          </div>
        </header>}
        <main id="main" className={libraryPage ? "library-main" : page === "transfer" ? "transfer-main" : undefined} tabIndex={-1}>
          {managing && <div className="page-heading management-heading">
            <div className="welcome-copy">
              <h1>
                {folderId && page === "library"
                  ? folderPath(Number(folderId), folders)
                  : pageNames[page]}
              </h1>
              <p>
                {libraryPage
                  ? page === "trash"
                    ? "删除的书签会保留 30 天，你可以随时恢复。"
                    : page === "pending"
                      ? "为尚未归档的内容找到合适的位置。"
                      : folderId ? `显示目录「${folderPath(Number(folderId), folders)}」及其子目录中的网址。` : "搜索、编辑和整理你的书签。"
                  : page === "jobs"
                    ? "让整理在后台继续，随时掌握每一步。"
                    : page === "settings"
                      ? "连接你的 AI 服务，按自己的方式整理与搜索。"
                      : page === "folders"
                        ? "新建、编辑和调整目录层级。"
                        : "把浏览器里的收藏带进来，也把你的资料安全带走。"}
              </p>
            </div>

          </div>}
          {error && !dialog && (
            <ErrorBox error={error} onDismiss={() => setError("")} />
          )}
          <div
            role="status"
            aria-live="polite"
            className={toast ? "toast" : "sr-only"}
          >
            {toast && (
              <>
                <CheckCircle2 size={18} />
                <span className="toast-message">{toast}</span>
                <button
                  className="icon-button"
                  onClick={() => setToast("")}
                  aria-label="关闭通知"
                >
                  <X size={15} />
                </button>
              </>
            )}
          </div>
          {libraryPage && (
            <>
              {!managing ? <EnjoySearch inputRef={searchRef} query={query} onQuery={setQuery}
                searchMode={searchMode} onSearchMode={setSearchMode} folders={folders} folderId={folderId}
                onFolder={(id) => { selectFolder(id); setTag(""); }} onMode={switchMode}
                onRefresh={() => setReload((n) => n + 1)} busy={Boolean(busy)} /> :
              <section className="search-panel" aria-label="搜索与筛选">
                <div className="search-row">
                  <div className="search-input">
                    <Search size={20} />
                    <input
                      ref={searchRef}
                      aria-keyshortcuts="Control+k Meta+k"
                      aria-label="搜索书签"
                      placeholder={
                        searchMode === "semantic"
                          ? "描述你想找的内容…"
                          : "搜索标题、网址、笔记…"
                      }
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                      <button
                        className="icon-button"
                        aria-label="清除搜索"
                        onClick={() => setQuery("")}
                      >
                        <X size={17} />
                      </button>
                    )}
                  </div>
                  <div className="segmented" aria-label="搜索方式">
                    <button
                      aria-pressed={searchMode === "keyword"}
                      className={searchMode === "keyword" ? "selected" : ""}
                      onClick={() => setSearchMode("keyword")}
                    >
                      关键词
                    </button>
                    <button
                      aria-pressed={searchMode === "semantic"}
                      className={searchMode === "semantic" ? "selected" : ""}
                      onClick={() => setSearchMode("semantic")}
                    >
                      <Sparkles size={15} />
                      语义
                    </button>
                  </div>
                </div>
                <div className="filter-row">
                  <ClowCatalog variant="compact" folders={folders} selected={folderId} onSelect={selectFolder} />
                  <label>
                    <span className="hash">#</span>
                    <input
                      aria-label="按标签筛选"
                      placeholder="筛选标签"
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                      list="bookmark-tags"
                    />
                    <datalist id="bookmark-tags">
                      {[...new Set(items.flatMap((b) => b.tags))]
                        .sort()
                        .map((t) => (
                          <option key={t} value={t} />
                        ))}
                    </datalist>
                  </label>
                  {(query || folderId || tag) && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setQuery("");
                        selectFolder("");
                        setTag("");
                      }}
                    >
                      清除筛选
                    </button>
                  )}
                  <button
                    className="text-button filter-refresh"
                    disabled={loading}
                    onClick={() => {
                      setError("");
                      setReload((n) => n + 1);
                    }}
                  >
                    <RefreshCw size={15} className={loading ? "spin" : ""} />
                    刷新列表
                  </button>
                </div>
              </section>}
              {searchMode === "semantic" &&
                !modelReady(settings?.embedding) && (
                  <div className="notice">
                    <Sparkles size={18} />
                    <span>
                      {managing ? "尚未配置语义搜索模型，可在设置中配置；暂时使用关键词搜索。" : "语义搜索暂不可用，已使用关键词搜索。可切换管理模式配置搜索模型。"}
                    </span>
                    {managing && <button className="text-button" onClick={() => navigate("settings")}>
                      前往设置<ArrowUpRight size={15} />
                    </button>}
                  </div>
                )}
              {warning && (
                <div className="notice">
                  <AlertCircle size={18} />
                  <span>{warning}</span>
                </div>
              )}
              <section ref={listPanelRef} tabIndex={-1} className="library-panel" aria-label="书签列表">
              {managing && <div className={`list-toolbar${selected.length ? " has-selection" : ""}`}>
              {managing && <div className="results-toolbar">
                <div className="list-selection-summary">
                  <label className="page-select-all">
                    <span className="page-select-box"><input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(input) => { if (input) input.indeterminate = somePageSelected && !allPageSelected; }}
                      disabled={Boolean(busy) || loading || visibleItems.length === 0}
                      onChange={(e) => setSelected(e.target.checked ? visibleItems.map((b) => b.id) : [])}
                    /></span>
                    全选本页
                  </label>
                  <div className="result-count">
                    <strong>{total}</strong> 条书签
                    {selected.length > 0 && <span> · 已选 {selected.length} 条</span>}
                  </div>
                </div>
                <div className="toolbar-actions">
                  {selected.length > 0 && (
                    <button
                      className="text-button"
                      onClick={() => setSelected([])}
                    >
                      取消选择
                    </button>
                  )}
                  {allPageSelected && selected.length < resultIds.length && (
                    <button className="text-button" disabled={Boolean(busy) || loading}
                      onClick={() => setSelected([...resultIds])}>选择当前结果（{total}）</button>
                  )}
                  {page === "trash" && <>
                    {selected.length > 0 && <>
                      <button className="secondary" disabled={Boolean(busy) || loading} onClick={requestRestoreSelected}>恢复所选（{selected.length}）</button>
                      <button className="secondary danger" disabled={Boolean(busy) || loading} onClick={() => requestPurge(selected)}>彻底删除所选（{selected.length}）</button>
                    </>}
                    <button className="secondary danger" disabled={Boolean(busy) || loading} onClick={() => requestPurge()}>清空回收站</button>
                  </>}
                  {page !== "trash" && (
                    <>
                      {selected.length > 0 && (
                        <button
                          className="secondary danger"
                          disabled={Boolean(busy) || loading}
                          onClick={requestDeleteSelected}
                        >
                          <Trash2 size={16} />
                          删除所选（{selected.length}）
                        </button>
                      )}
                      <button
                        className="secondary"
                        disabled={Boolean(busy)}
                        onClick={() => open({ type: "classification-assistant", bookmarkIds: [...selected] })}
                      >
                        <Sparkles size={16} />
                        分类助手
                      </button>
                      <button
                        className="secondary"
                        disabled={Boolean(busy)}
                        onClick={() => requestJob("classify")}
                      >
                        <Sparkles size={16} />
                        {selected.length ? "分类所选" : "整理待分类"}
                      </button>
                      {selected.length > 0 && (
                        <button
                          className="secondary"
                          disabled={Boolean(busy)}
                          onClick={() => requestJob("fetch")}
                        >
                          <Globe size={16} />
                          抓取所选
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>}
              </div>}
              {loading ? (
                <div
                  className={managing ? "bookmark-row-skeletons skeletons" : "bookmark-grid skeletons"}
                  data-columns={3}
                  style={{ "--bookmark-columns": 3 } as CSSProperties}
                  aria-label="书签加载中"
                  aria-busy="true"
                >
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="skeleton-card">
                      <div />
                      <div />
                      <div />
                    </div>
                  ))}
                </div>
              ) : items.length === 0 ? (
                <Empty
                  title={
                    query || tag || folderId
                      ? "没有找到匹配的书签"
                      : page === "trash"
                        ? "回收站是空的"
                        : page === "pending"
                          ? "所有收藏都已安排妥当"
                          : "从一个好链接开始"
                  }
                  description={
                    query || tag || folderId
                      ? managing ? "试试更短的关键词，或调整目录和标签筛选。" : "试试更短的关键词，或清除搜索重新浏览。"
                      : page === "trash"
                        ? "删除的书签会暂存在这里，30 天后自动清理。"
                        : page === "pending"
                          ? "新收藏或未分类的书签会出现在这里。"
                          : managing ? "粘贴一个网址，或从浏览器导入已有书签。" : "切换到管理模式，添加或导入你的第一份收藏。"
                  }
                >
                  {managing && page === "library" && !query && !folderId && !tag && (
                    <div className="button-row">
                      <button
                        className="primary"
                        onClick={() => open({ type: "bookmark" })}
                      >
                        <Plus size={18} />
                        添加第一条书签
                      </button>
                      <button
                        className="secondary"
                        onClick={() => navigate("transfer")}
                      >
                        导入书签
                      </button>
                    </div>
                  )}
                </Empty>
              ) : (
                <BookmarkResults managing={managing} items={visibleItems} key={`${mode}:${page}:${folderId}:${query}:${tag}:${searchMode}:${managing ? paged.page : 0}`}>
                   {(bookmark, hand) => (
                     <BookmarkView
                      managing={managing}
                       hand={hand}
                      key={bookmark.id}
                      bookmark={bookmark}
                      folders={folders}
                      selected={selected.includes(bookmark.id)}
                      toggle={() =>
                        setSelected((s) =>
                          s.includes(bookmark.id)
                            ? s.filter((id) => id !== bookmark.id)
                            : [...s, bookmark.id],
                        )
                      }
                      edit={() => openBookmarkAction("bookmark", bookmark)}
                      refresh={() => openBookmarkAction("refresh", bookmark)}
                      remove={() =>
                        bookmark.deleted_at ? requestPurge([bookmark.id]) : confirm(
                          "移到回收站？",
                          `“${bookmark.title || bookmark.url}”会保留 30 天，期间可以恢复。`,
                          async () => {
                            await api("/bookmarks/" + bookmark.id, {
                              method: "DELETE",
                            });
                            setDialog(null);
                            updated("已移到回收站");
                          },
                        )
                      }
                      restore={() => void run("恢复书签", () => restoreTrash([bookmark.id]))}
                      filterTag={(t) => { if (managing) setTag(t); else setQuery(t); }}
                      busy={Boolean(busy)}
                    />
                   )}
                </BookmarkResults>
              )}
              {managing && <nav className="bookmark-pagination" aria-label="书签分页">
                <span className="page-range" role="status">{loading ? "正在加载…" : `第 ${paged.start}–${paged.end} 条，共 ${total} 条`}</span>
                <label className="page-size">每页
                  <select value={pagination.size} disabled={Boolean(busy) || loading}
                    aria-label="每页条数" onChange={(e) => changeListPage(1, Number(e.target.value))}>
                    {[10, 20, 50].map((size) => <option key={size} value={size}>{size} 条</option>)}
                  </select>
                </label>
                <div className="page-buttons">
                  <button type="button" disabled={Boolean(busy) || loading || paged.page === 1}
                    onClick={() => changeListPage(paged.page - 1)}>上一页</button>
                  {paged.pages.map((number, index) => <span className="page-number-group" key={number}>
                    {index > 0 && number - paged.pages[index - 1] > 1 && <span className="page-ellipsis" aria-hidden="true">…</span>}
                    <button type="button" aria-label={`第 ${number} 页`} aria-current={number === paged.page ? "page" : undefined}
                      disabled={Boolean(busy) || loading} onClick={() => changeListPage(number)}>{number}</button>
                  </span>)}
                  <button type="button" disabled={Boolean(busy) || loading || paged.page === paged.totalPages}
                    onClick={() => changeListPage(paged.page + 1)}>下一页</button>
                </div>
              </nav>}
              </section>
            </>
          )}
          {managing && page === "jobs" && (
            <JobsPage
              jobs={jobs}
              busy={busy}
              settings={settings}
              start={requestJob}
              action={(id, action) =>
                void run("更新任务", async () => {
                  const result = await post<Job>(`/jobs/${id}/${action}`);
                  setJobs((old) => old.map((j) => (j.id === id ? result : j)));
                  setToast("任务状态已更新");
                })
              }
              refresh={() =>
                void run("刷新任务", async () => setJobs(await api("/jobs")))
              }
            />
          )}
          {managing && page === "transfer" && (
            <TransferPage
              busy={busy}
              run={run}
              imported={updated}
              download={download}
              modelConfigured={Boolean(settings && modelReady(settings.classification))}
            />
          )}
          {managing && page === "settings" &&
            (settings ? (
              <SettingsPage
                settings={settings}
                tokens={tokens}
                busy={busy}
                save={(body) =>
                  void run("保存设置", async () => {
                    const saved = await api<Settings>("/settings", {
                      method: "PUT",
                      body: JSON.stringify(body),
                    });
                    setSettings(saved);
                    updated("设置已保存；历史书签不会自动重新分类。");
                  })
                }
                createToken={async (name) => {
                  const result = await post<{
                    id: number;
                    name: string;
                    token: string;
                  }>("/tokens", { name });
                  try {
                    setTokens(await api<Token[]>("/tokens"));
                  } catch {
                    setToast("令牌已创建，令牌清单暂未刷新。请先保存新令牌。");
                  }
                  return result.token;
                }}
                revoke={(token) =>
                  confirm(
                    "撤销此访问令牌？",
                    `使用“${token.name}”的浏览器扩展将无法继续保存书签。`,
                    async () => {
                      await api("/tokens/" + token.id, { method: "DELETE" });
                      setTokens((old) => old.filter((t) => t.id !== token.id));
                      setDialog(null);
                      setToast("令牌已撤销");
                    },
                  )
                }
                reindex={() => requestJob("reindex")}
              />
            ) : (
              <div className="panel">
                <ErrorBox error="设置暂不可用，请重新加载。" />
                <button
                  className="secondary"
                  onClick={() => setReload((n) => n + 1)}
                >
                  重新加载设置
                </button>
              </div>
            ))}
          {managing && page === "folders" && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <h2>目录结构</h2>
                  <p>自动分类最多三级，手动目录可按需扩展。</p>
                </div>
                <div className="button-row">
                  <button
                    className="secondary"
                    disabled={
                      Boolean(busy) || !modelReady(settings?.classification)
                    }
                    title={
                      !modelReady(settings?.classification)
                        ? "请先配置分类模型"
                        : undefined
                    }
                    onClick={() =>
                      void run("生成整理预览", async () => {
                        const preview = await post<Preview>(
                          "/folders/organize-preview",
                        );
                        open({ type: "organize", preview });
                      })
                    }
                  >
                    <Sparkles size={17} />
                    {busy === "生成整理预览" ? "正在生成…" : "AI 整理预览"}
                  </button>
                  <button
                    className="primary"
                    onClick={() => open({ type: "folder" })}
                  >
                    <FolderPlus size={18} />
                    新建目录
                  </button>
                </div>
              </div>
              {!modelReady(settings?.classification) && (
                <div className="notice">
                  <AlertCircle size={17} />
                  AI 目录整理需要先在设置中配置分类模型。
                </div>
              )}
              {folders.length === 0 ? (
                <Empty
                  title="还没有目录"
                  description="创建第一个目录，或配置 AI 让新书签自动归档。"
                />
              ) : (
                <div className="folder-list">
                  <div className="folder-bulk-toolbar">
                    <label className="folder-select-all">
                      <input
                        type="checkbox"
                        checked={selectedFolders.length === folders.length}
                        ref={(input) => { if (input) input.indeterminate = selectedFolders.length > 0 && selectedFolders.length < folders.length; }}
                        disabled={Boolean(busy)}
                        onChange={(event) => setSelectedFolders(event.target.checked ? folders.map((folder) => folder.id) : [])}
                      />
                      全选目录
                    </label>
                    <span role="status">已选 {selectedFolders.length} / {folders.length} 个目录</span>
                    <div className="button-row">
                      <button className="secondary" disabled={Boolean(busy) || !selectedFolders.length} onClick={() => setSelectedFolders([])}>取消选择</button>
                      <button className="secondary danger" disabled={Boolean(busy) || !selectedFolders.length} onClick={requestDeleteFolders}>
                        <Trash2 size={17} />
                        {busy === "统计所选目录" ? "正在统计…" : "删除所选"}
                      </button>
                    </div>
                  </div>
                  {[...folders]
                    .sort((a, b) =>
                      folderPath(a.id, folders).localeCompare(
                        folderPath(b.id, folders),
                        "zh-CN",
                      ),
                    )
                    .map((folder) => (
                      <div className={`folder-row${selectedFolders.includes(folder.id) ? " folder-row-selected" : ""}`} key={folder.id}>
                        <label className="folder-checkbox">
                          <input
                            type="checkbox"
                            aria-label={`选择目录 ${folderPath(folder.id, folders)}`}
                            checked={selectedFolders.includes(folder.id)}
                            disabled={Boolean(busy)}
                            onChange={(event) => setSelectedFolders((current) => event.target.checked ? [...current, folder.id] : current.filter((id) => id !== folder.id))}
                          />
                        </label>
                        <FolderIcon size={21} />
                        <span>{folderPath(folder.id, folders)}</span>
                        <button
                          className="secondary"
                          onClick={() => open({ type: "folder", folder })}
                        >
                          <Pencil size={15} />
                          编辑
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label={`删除目录 ${folder.name}`}
                          onClick={() =>
                            confirm(
                              "删除目录？",
                              `删除“${folder.name}”后，目录内的书签会移到未归档。子目录由服务安全处理。`,
                              async () => {
                                await api("/folders/" + folder.id, {
                                  method: "DELETE",
                                });
                                setDialog(null);
                                updated("目录已删除");
                              },
                            )
                          }
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </section>
          )}
        </main>
        {managing && <footer className="app-footer">
          <span>拾页 · 你的收藏，你来掌握</span>
          <span>数据保存在自己的 NAS</span>
        </footer>}
      </div>
      {managing && dialog && (
        <Modal
          title={
            dialog.type === "bookmark"
              ? dialog.bookmark
                ? "编辑书签"
                : "添加书签"
              : dialog.type === "folder"
                ? dialog.folder
                  ? "编辑目录"
                  : "新建目录"
                : dialog.type === "refresh"
                  ? "刷新书签内容"
                  : dialog.type === "classification-assistant"
                    ? "分类助手"
                    : dialog.type === "organize"
                      ? "AI 目录整理预览"
                      : dialog.title
          }
          close={() => {
            if (!busy) {
              setDialog(null);
              setError("");
            }
          }}
          error={error}
        >
          {dialog.type === "classification-assistant" && (
            <ClassificationAssistant
              bookmarkIds={dialog.bookmarkIds}
              modelConfigured={modelReady(settings?.classification)}
              onSaved={() => updated("分类规则已保存，后续分类会使用这些要求。")}
              onApplied={(job) => {
                setJobs((old) => [job, ...old.filter((j) => j.id !== job.id)]);
                setDialog(null);
                navigate("jobs");
                updated("分类任务已创建，可在任务中心查看进度。");
              }}
              openSettings={() => {
                setDialog(null);
                navigate("settings");
              }}
            />
          )}
          {dialog.type === "bookmark" && (
            <BookmarkForm
              bookmark={dialog.bookmark}
              folders={folders}
              currentFolder={folderId}
              busy={busy}
              cancel={() => setDialog(null)}
              save={(body) =>
                void run("保存书签", async () => {
                  if (dialog.bookmark) {
                    await api("/bookmarks/" + dialog.bookmark.id, {
                      method: "PATCH",
                      body: JSON.stringify(body),
                    });
                    setDialog(null);
                    updated("书签已更新");
                  } else {
                    const result = await post<{
                      bookmark: Bookmark;
                      duplicate: boolean;
                    }>("/bookmarks", body);
                    setDialog(null);
                    updated(
                      result.duplicate
                        ? result.bookmark.deleted_at
                          ? "该链接已在回收站中，请到回收站恢复。"
                          : "该链接已收藏，原有内容保持不变。"
                        : "书签已保存",
                    );
                  }
                })
              }
            />
          )}
          {dialog.type === "folder" && (
            <FolderForm
              folder={dialog.folder}
              folders={folders}
              busy={busy}
              cancel={() => setDialog(null)}
              save={(body) =>
                confirm(
                  dialog.folder ? "确认修改目录？" : "确认创建目录？",
                  `${body.name} · ${folderPath(body.parent_id, folders)}。这是手动目录操作。`,
                  async () => {
                    if (dialog.folder)
                      await api("/folders/" + dialog.folder.id, {
                        method: "PATCH",
                        body: JSON.stringify(body),
                      });
                    else await post("/folders", body);
                    setDialog(null);
                    updated(dialog.folder ? "目录已更新" : "目录已创建");
                  },
                )
              }
            />
          )}
          {dialog.type === "refresh" && (
            <RefreshForm
              bookmark={dialog.bookmark}
              busy={busy}
              cancel={() => setDialog(null)}
              save={(body) =>
                void run("刷新书签", async () => {
                  await post(
                    "/bookmarks/" + dialog.bookmark.id + "/refresh",
                    body,
                  );
                  setDialog(null);
                  updated("内容已刷新，语义索引已标记为需要更新");
                })
              }
            />
          )}
          {dialog.type === "organize" && (
            <>
              <p className="modal-description">{dialog.preview.description}</p>
              <div className="notice">
                <ShieldCheck size={18} />
                应用前不会修改任何目录。手动分类的书签仍受保护。
              </div>
              {dialog.preview.changes.length === 0 ? (
                <p>当前目录已经很整齐，没有建议改动。</p>
              ) : (
                <div className="preview-list">
                  {dialog.preview.changes.map((change) => (
                    <div key={change.folder_id}>
                      <strong>{folderPath(change.folder_id, folders)}</strong>
                      <ArrowUpRight size={16} />
                      <span>
                        {change.merge_into !== undefined ? (
                          `合并到 ${folderPath(change.merge_into, folders)}`
                        ) : (
                          <>
                            {change.name ??
                              folders.find((f) => f.id === change.folder_id)
                                ?.name}{" "}
                            {change.parent_id !== undefined &&
                              `→ ${change.parent_id === null ? "顶层目录" : folderPath(change.parent_id, folders)}`}
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="modal-actions">
                <button
                  className="secondary"
                  disabled={Boolean(busy)}
                  onClick={() => setDialog(null)}
                >
                  取消
                </button>
                <button
                  className="primary"
                  disabled={Boolean(busy) || !dialog.preview.changes.length}
                  onClick={() =>
                    void run("应用目录整理", async () => {
                      await post("/folders/organize-apply", {
                        preview_id: dialog.preview.preview_id,
                      });
                      setDialog(null);
                      updated("目录整理已应用");
                    })
                  }
                >
                  {busy ? "正在应用…" : "确认应用"}
                </button>
              </div>
            </>
          )}
          {dialog.type === "confirm" && (
            <>
              <p className="modal-description">{dialog.description}</p>
              <div className="modal-actions">
                <button
                  className="secondary"
                  disabled={Boolean(busy)}
                  onClick={() => setDialog(null)}
                >
                  取消
                </button>
                <button
                  className="primary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("确认操作", async () => {
                      await dialog.action();
                      setDialog(null);
                    })
                  }
                >
                  {busy ? "正在处理…" : dialog.confirmLabel || "确认"}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function AuthScreen({
  auth,
  error,
  retry,
  onSuccess,
}: {
  auth: { initialized: boolean; authenticated: boolean } | null;
  error: string;
  retry: () => Promise<void>;
  onSuccess: (name: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);
  const setup = auth && !auth.initialized;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (setup && password !== repeat) {
      setLocalError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    setLocalError("");
    try {
      const result = await post<{ username: string }>(
        setup ? "/auth/setup" : "/auth/login",
        { username, password },
      );
      await onSuccess(result.username);
    } catch (e) {
      setLocalError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <div className="brand">
          <div className="brand-mark">
            <BrandMark />
          </div>
          <strong>拾页</strong>
        </div>
        <div>
          <div className="eyebrow">YOUR BOOKMARK WORKSPACE</div>
          <h1>
            收藏、整理，
            <br />
            快速找到。
          </h1>
          <p>
            集中管理网页书签，
            <br />
            用目录、标签与搜索找回内容。
          </p>
          <div className="auth-features">
            <span>
              <ShieldCheck size={19} />
              私有 NAS 存储
            </span>
            <span>
              <Sparkles size={19} />
              AI 整理与搜索
            </span>
            <span>
              <FolderIcon size={19} />
              熟悉的目录结构
            </span>
          </div>
        </div>
        <small>你的书签、目录和标签，在同一个工作台。</small>
      </div>
      <main className="auth-main">
        <section className="auth-card">
          <div className="auth-icon">
            <BrandMark />
          </div>
          <h2>
            {!auth
              ? "连接你的收藏空间"
              : setup
                ? "建立你的私人书签库"
                : "欢迎回来"}
          </h2>
          <p>
            {setup
              ? "首次使用，请创建唯一的管理员账号。"
              : "登录后，继续探索你的收藏。"}
          </p>
          {(localError || error) && <ErrorBox error={localError || error} />}{" "}
          {!auth ? (
            error ? (
              <button className="primary" onClick={() => void retry()}>
                重新连接服务
              </button>
            ) : (
              <Loading />
            )
          ) : (
            <form onSubmit={submit}>
              <Field label="用户名">
                <input
                  required
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={100}
                />
              </Field>
              <Field
                label="密码"
                hint={setup ? "建议使用至少 8 位的独立密码。" : undefined}
              >
                <input
                  required
                  type="password"
                  minLength={setup ? 8 : 1}
                  autoComplete={setup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {setup && (
                <Field label="确认密码">
                  <input
                    required
                    type="password"
                    minLength={8}
                    autoComplete="new-password"
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                  />
                </Field>
              )}
              <button className="primary full" disabled={busy}>
                {busy ? (
                  <Loader2 className="spin" size={18} />
                ) : (
                  <ArrowUpRight size={18} />
                )}{" "}
                {busy ? "正在处理…" : setup ? "创建账号，开始收藏" : "登录"}
              </button>
            </form>
          )}
          <div className="auth-footnote">
            <ShieldCheck size={15} />
            账号与书签保存在你的服务器上
          </div>
        </section>
      </main>
    </div>
  );
}
function BookmarkForm({
  bookmark,
  folders,
  currentFolder,
  busy,
  cancel,
  save,
}: {
  bookmark?: Bookmark;
  folders: Folder[];
  currentFolder: string;
  busy: string;
  cancel: () => void;
  save: (body: Record<string, unknown>) => void;
}) {
  const [url, setUrl] = useState(bookmark?.url ?? "");
  const [title, setTitle] = useState(bookmark?.title ?? "");
  const [notes, setNotes] = useState(bookmark?.notes ?? "");
  const [folder, setFolder] = useState(
    bookmark?.folder_id === null
      ? ""
      : String(bookmark?.folder_id ?? currentFolder),
  );
  const [tags, setTags] = useState(bookmark?.tags.join(", ") ?? "");
  const [manual, setManual] = useState(
    Boolean(bookmark ? bookmark.manual_classification : currentFolder),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { title, notes };
    if (!bookmark) body.url = url;
    if (manual)
      Object.assign(body, {
        folder_id: folder ? Number(folder) : null,
        tags: [
          ...new Set(
            tags
              .split(/[,，\n]/)
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ],
      });
    save(body);
  };
  return (
    <form onSubmit={submit}>
      <Field label="网址 *">
        <input
          type="url"
          required
          readOnly={Boolean(bookmark)}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          pattern="https?://.*"
        />
      </Field>
      <Field label="标题">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="给这条收藏起个名字"
        />
      </Field>
      <Field label="我的笔记">
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="为什么收藏它？记下你的想法。"
        />
      </Field>
      <label className="check-label manual-toggle">
        <input
          type="checkbox"
          checked={manual}
          onChange={(e) => setManual(e.target.checked)}
        />
        手动指定目录和标签
      </label>
      <small className="helper">
        {bookmark
          ? "不勾选时，本次只更新标题和笔记，不改变已有分类。"
          : "不勾选时，配置模型后会自动加入 AI 分类队列。"}
        手动指定的分类不会被自动任务覆盖。
      </small>
      {manual && (
        <div className="form-inset">
          <Field label="目录">
            <select value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">未归档</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {folderPath(f.id, folders)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="标签" hint="多个标签用逗号分隔。">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="阅读, 工作, 灵感"
            />
          </Field>
        </div>
      )}
      <div className="modal-actions">
        <button
          type="button"
          className="secondary"
          disabled={Boolean(busy)}
          onClick={cancel}
        >
          取消
        </button>
        <button className="primary" disabled={Boolean(busy)}>
          {busy ? "正在保存…" : "保存书签"}
        </button>
      </div>
    </form>
  );
}
function FolderForm({
  folder,
  folders,
  busy,
  cancel,
  save,
}: {
  folder?: Folder;
  folders: Folder[];
  busy: string;
  cancel: () => void;
  save: (body: { name: string; parent_id: number | null }) => void;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [parent, setParent] = useState(
    folder?.parent_id ? String(folder.parent_id) : "",
  );
  const isDescendant = (id: number): boolean => {
    const seen = new Set<number>();
    let current: number | null = id;
    while (current !== null && !seen.has(current)) {
      if (current === folder?.id) return true;
      seen.add(current);
      current = folders.find((f) => f.id === current)?.parent_id ?? null;
    }
    return false;
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({ name: name.trim(), parent_id: parent ? Number(parent) : null });
      }}
    >
      <Field label="目录名称 *">
        <input
          required
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="上级目录">
        <select value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">顶层目录</option>
          {folders
            .filter((f) => !isDescendant(f.id))
            .map((f) => (
              <option key={f.id} value={f.id}>
                {folderPath(f.id, folders)}
              </option>
            ))}
        </select>
      </Field>
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={cancel}>
          取消
        </button>
        <button className="primary" disabled={Boolean(busy) || !name.trim()}>
          继续确认
        </button>
      </div>
    </form>
  );
}
function RefreshForm({
  bookmark,
  busy,
  cancel,
  save,
}: {
  bookmark: Bookmark;
  busy: string;
  cancel: () => void;
  save: (body: Record<string, string>) => void;
}) {
  const [title, setTitle] = useState(bookmark.title);
  const [description, setDescription] = useState(bookmark.description);
  const [excerpt, setExcerpt] = useState(bookmark.excerpt);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({ title, description, excerpt });
      }}
    >
      <div className="notice">
        <RefreshCw size={18} />
        明确替换已有页面信息，并使此书签的 Embedding
        失效。要从网址重新抓取，请在列表勾选后运行抓取任务。
      </div>
      <Field label="页面标题">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="页面描述">
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field label="页面正文摘录" hint="最多 12,000 个字符。">
        <textarea
          rows={6}
          maxLength={12000}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
        />
      </Field>
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={cancel}>
          取消
        </button>
        <button className="primary" disabled={Boolean(busy)}>
          {busy ? "正在刷新…" : "确认替换内容"}
        </button>
      </div>
    </form>
  );
}

function JobsPage({
  jobs,
  busy,
  settings,
  start,
  action,
  refresh,
}: {
  jobs: Job[];
  busy: string;
  settings: Settings | null;
  start: (kind: Job["kind"]) => void;
  action: (id: number, action: "pause" | "resume" | "retry") => void;
  refresh: () => void;
}) {
  const [force, setForce] = useState(false);
  const [forceError, setForceError] = useState("");
  const [forceBusy, setForceBusy] = useState(false);
  const forceClassify = async () => {
    setForceBusy(true);
    setForceError("");
    try {
      const all = await api<{ ids: number[]; total: number }>("/bookmarks?view=ids");
      if (!all.ids.length) {
        setForceError("没有有效书签可重新分类。");
        return;
      }
      if (
        !window.confirm(
          `将强制重新分类 ${all.total} 条有效书签，覆盖手动目录和标签，并调用分类模型。确认继续？`,
        )
      )
        return;
      await post("/jobs", {
        kind: "classify",
        force: true,
        bookmark_ids: all.ids,
      });
      setForce(false);
      refresh();
    } catch (e) {
      setForceError(message(e));
    } finally {
      setForceBusy(false);
    }
  };
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>新建后台任务</h2>
            <p>分类默认处理待分类书签；抓取和重建索引默认处理所有有效书签。</p>
          </div>
          <button
            className="text-button"
            onClick={refresh}
            disabled={Boolean(busy)}
          >
            <RefreshCw size={16} />
            刷新进度
          </button>
        </div>
        <div className="job-launch">
          <button
            className="secondary"
            disabled={Boolean(busy) || !modelReady(settings?.classification)}
            onClick={() => start("classify")}
          >
            <Sparkles size={18} />
            整理待分类书签
          </button>
          <button
            className="secondary"
            disabled={Boolean(busy)}
            onClick={() => start("fetch")}
          >
            <Globe size={18} />
            抓取全部网页
          </button>
          <button
            className="secondary"
            disabled={Boolean(busy) || !modelReady(settings?.embedding)}
            onClick={() => start("reindex")}
          >
            <RefreshCw size={18} />
            重建语义索引
          </button>
        </div>
        {(!modelReady(settings?.classification) ||
          !modelReady(settings?.embedding)) && (
          <p className="helper">
            未配置的模型任务暂不可用。请到设置填写对应服务地址、模型和 API Key。
          </p>
        )}
        <details className="advanced">
          <summary>高级操作：重新分类历史书签</summary>
          <p>
            强制分类会覆盖手动归档。只有确认需要重新整理整个收藏库时才使用。
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            我了解此操作会覆盖手动分类
          </label>
          <button
            className="secondary danger"
            disabled={
              !force ||
              forceBusy ||
              Boolean(busy) ||
              !modelReady(settings?.classification)
            }
            onClick={() => void forceClassify()}
          >
            {forceBusy ? "正在创建…" : "强制重新分类全部书签"}
          </button>
          {forceError && <ErrorBox error={forceError} />}
        </details>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>任务记录</h2>
          <span className="muted">任务持久化保存，服务重启后可恢复</span>
        </div>
        {jobs.length === 0 ? (
          <Empty
            title="还没有后台任务"
            description="创建一个任务，进度会实时显示在这里。"
          />
        ) : (
          <div className="job-list">
            {jobs.map((job) => {
              const completed = Math.min(job.total, job.completed + job.failed);
              const progress =
                job.total > 0 ? Math.round((completed / job.total) * 100) : 0;
              return (
                <article className="job-card" key={job.id}>
                  <div className="job-title">
                    <span className="job-icon">
                      {job.kind === "classify" ? (
                        <Sparkles size={22} />
                      ) : job.kind === "fetch" ? (
                        <Globe size={22} />
                      ) : (
                        <RefreshCw size={22} />
                      )}
                    </span>
                    <div>
                      <h3>
                        {jobNames[job.kind]} <small>#{job.id}</small>
                      </h3>
                      <p>
                        {date(job.created_at)} · 成功 {job.completed} /{" "}
                        {job.total}
                        {job.failed > 0 && ` · 失败 ${job.failed}`}
                      </p>
                    </div>
                    <span className={`status job-${job.status}`}>
                      {jobStatuses[job.status]}
                    </span>
                  </div>
                  <div className="progress-row">
                    <progress
                      max={100}
                      value={progress}
                      aria-label={`${jobNames[job.kind]}进度 ${progress}%`}
                    />
                    <span>{progress}%</span>
                  </div>
                  {job.error && <ErrorBox error={job.error} />}
                  <div className="job-actions">
                    {["queued", "running"].includes(job.status) && (
                      <button
                        className="secondary"
                        disabled={Boolean(busy)}
                        onClick={() => action(job.id, "pause")}
                      >
                        <Pause size={15} />
                        暂停
                      </button>
                    )}
                    {job.status === "paused" && (
                      <button
                        className="secondary"
                        disabled={Boolean(busy)}
                        onClick={() => action(job.id, "resume")}
                      >
                        <Play size={15} />
                        继续
                      </button>
                    )}
                    {job.status === "failed" && (
                      <button
                        className="secondary"
                        disabled={Boolean(busy)}
                        onClick={() => action(job.id, "retry")}
                      >
                        <RotateCcw size={15} />
                        重试失败项
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
type EditableModel = {
  base_url: string;
  model: string;
  api_key?: string;
  prompt?: string;
};
function SettingsPage({
  settings,
  tokens,
  busy,
  save,
  createToken,
  revoke,
  reindex,
}: {
  settings: Settings;
  tokens: Token[];
  busy: string;
  save: (body: {
    classification: EditableModel;
    embedding: EditableModel;
    concurrency: number;
    send_excerpt: boolean;
  }) => void;
  createToken: (name: string) => Promise<string>;
  revoke: (token: Token) => void;
  reindex: () => void;
}) {
  const [classification, setClassification] = useState(settings.classification);
  const [embedding, setEmbedding] = useState(settings.embedding);
  const [classificationKey, setClassificationKey] = useState("");
  const [embeddingKey, setEmbeddingKey] = useState("");
  const [clearClass, setClearClass] = useState(false);
  const [clearEmbed, setClearEmbed] = useState(false);
  const [concurrency, setConcurrency] = useState(settings.concurrency);
  const [sendExcerpt, setSendExcerpt] = useState(settings.send_excerpt);
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setClassification(settings.classification);
    setEmbedding(settings.embedding);
    setConcurrency(settings.concurrency);
    setSendExcerpt(settings.send_excerpt);
    setClassificationKey("");
    setEmbeddingKey("");
    setClearClass(false);
    setClearEmbed(false);
  }, [settings]);
  const editModel = (
    model: ModelConfig,
    key: string,
    clear: boolean,
  ): EditableModel => ({
    base_url: model.base_url,
    model: model.model,
    ...(model.prompt !== undefined ? { prompt: model.prompt } : {}),
    ...(clear ? { api_key: "" } : key.trim() ? { api_key: key.trim() } : {}),
  });
  return (
    <div className="settings-stack">
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          save({
            classification: editModel(
              classification,
              classificationKey,
              clearClass,
            ),
            embedding: editModel(embedding, embeddingKey, clearEmbed),
            concurrency,
            send_excerpt: sendExcerpt,
          });
        }}
      >
        <div className="section-heading">
          <div>
            <h2>AI 服务</h2>
            <p>支持 OpenAI 兼容接口。分类和语义搜索可使用不同的服务与密钥。</p>
          </div>
          <span className="section-icon">
            <Sparkles size={23} />
          </span>
        </div>
        <div className="notice">
          <ShieldCheck size={18} />
          <span>
            服务端保存密钥，已存密钥永不显示。启用 AI
            后，书签标题、网址、描述与笔记会发送到你配置的服务；正文摘录可在下方关闭。
          </span>
        </div>
        <div className="model-grid">
          <ModelFields
            title="分类模型"
            subtitle="生成摘要、目录与标签"
            model={classification}
            onChange={setClassification}
            apiKey={classificationKey}
            setKey={setClassificationKey}
            clear={clearClass}
            setClear={setClearClass}
          />
          <ModelFields
            title="Embedding 模型"
            subtitle="建立向量索引，用自然语言找书签"
            model={embedding}
            onChange={setEmbedding}
            apiKey={embeddingKey}
            setKey={setEmbeddingKey}
            clear={clearEmbed}
            setClear={setClearEmbed}
          />
        </div>
        <div className="settings-divider" />
        <Field
          label="分类提示词"
          hint="模型和提示词修改后，已有书签不会自动重新分类。网页内容应作为不可信资料处理。"
        >
          <textarea
            className="prompt-editor"
            rows={8}
            value={classification.prompt ?? ""}
            onChange={(e) =>
              setClassification({ ...classification, prompt: e.target.value })
            }
          />
        </Field>
        <div className="settings-bottom">
          <Field
            label="任务并发数"
            hint="较低并发更适合家庭 NAS 和限流模型服务。"
          >
            <select
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} 个任务
                </option>
              ))}
            </select>
          </Field>
          <label className="check-label excerpt-toggle">
            <input
              type="checkbox"
              checked={sendExcerpt}
              onChange={(e) => setSendExcerpt(e.target.checked)}
            />
            <span>
              <strong>向 AI 服务发送正文摘录</strong>
              <small>仅发送截取的文本；关闭后使用书签元信息。</small>
            </span>
          </label>
        </div>
        <div className="form-footer">
          <span className="helper">
            留空密钥保留已有值；勾选清除才会删除密钥。
          </span>
          <button className="primary" disabled={Boolean(busy)}>
            <Check size={18} />
            {busy === "保存设置" ? "正在保存…" : "保存设置"}
          </button>
        </div>
      </form>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>语义搜索索引</h2>
            <p>更换 Embedding 服务或模型后，请重新建立索引。</p>
          </div>
          <button
            className="secondary"
            disabled={Boolean(busy) || !modelReady(settings.embedding)}
            onClick={reindex}
          >
            <RefreshCw size={17} />
            重建索引
          </button>
        </div>
        {Object.keys(settings.index_status ?? {}).length > 0 ? (
          <dl className="index-status">
            {Object.entries(settings.index_status)
              .filter(([key]) =>
                [
                  "rebuild_needed",
                  "needs_rebuild",
                  "status",
                  "count",
                  "model",
                  "active_model",
                  "dimension",
                  "updated_at",
                  "indexed",
                  "total",
                  "active",
                  "rebuild_required",
                ].includes(key),
              )
              .map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {(
                      {
                        rebuild_needed: "需要重建",
                        needs_rebuild: "需要重建",
                        status: "索引状态",
                        count: "索引数量",
                        model: "当前模型",
                        active_model: "活动模型",
                        dimension: "向量维度",
                        updated_at: "更新时间",
                        indexed: "已索引",
                        total: "总数",
                        active: "活动索引",
                        rebuild_required: "需要重建",
                      } as Record<string, string>
                    )[key] ?? key}
                  </dt>
                  <dd>
                    {typeof value === "boolean"
                      ? value
                        ? "是"
                        : "否"
                      : value === null
                        ? "—"
                        : typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
        ) : (
          <p className="muted">
            尚未建立索引。配置 Embedding 模型后可启动首次重建。
          </p>
        )}
        <p className="helper">
          重建完成前继续使用旧索引；新索引只有全部成功后才会替换。调用模型可能产生费用。
        </p>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>浏览器扩展访问令牌</h2>
            <p>令牌只能保存书签和检查连接，可随时撤销。</p>
          </div>
          <span className="section-icon">
            <KeyRound size={23} />
          </span>
        </div>
        {tokenError && <ErrorBox error={tokenError} />}{" "}
        {newToken ? (
          <div className="token-once">
            <div className="notice">
              <KeyRound size={18} />
              新令牌仅显示这一次。请立即复制到浏览器扩展；关闭后无法再查看。
            </div>
            <Field label="新令牌">
              <input
                readOnly
                value={newToken}
                onFocus={(e) => e.target.select()}
              />
            </Field>
            <div className="button-row">
              <button
                className="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(newToken);
                    setCopied(true);
                  } catch {
                    setTokenError(
                      "浏览器不允许自动复制，请选中上方令牌手动复制。",
                    );
                  }
                }}
              >
                <Copy size={16} />
                {copied ? "已复制" : "复制令牌"}
              </button>
              <button
                className="primary"
                onClick={() => {
                  setNewToken("");
                  setCopied(false);
                  setTokenError("");
                }}
              >
                我已保存，关闭显示
              </button>
            </div>
          </div>
        ) : (
          <form
            className="token-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setTokenBusy(true);
              setTokenError("");
              try {
                setNewToken(await createToken(name.trim()));
                setName("");
              } catch (e) {
                setTokenError(message(e));
              } finally {
                setTokenBusy(false);
              }
            }}
          >
            <Field label="令牌名称">
              <input
                required
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：工作电脑 Chrome"
              />
            </Field>
            <button
              className="secondary"
              disabled={tokenBusy || Boolean(busy) || !name.trim()}
            >
              <Plus size={17} />
              {tokenBusy ? "正在创建…" : "创建令牌"}
            </button>
          </form>
        )}
        {tokens.length > 0 ? (
          <div className="token-list">
            {tokens.map((token) => (
              <div key={token.id}>
                <KeyRound size={17} />
                <span>
                  <strong>{token.name}</strong>
                  <small>创建于 {date(token.created_at)}</small>
                </span>
                <button
                  className="text-button danger"
                  disabled={Boolean(busy) || tokenBusy}
                  onClick={() => revoke(token)}
                >
                  撤销
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="helper">还没有访问令牌。需要浏览器扩展时再创建即可。</p>
        )}
      </section>
    </div>
  );
}
function ModelFields({
  title,
  subtitle,
  model,
  onChange,
  apiKey,
  setKey,
  clear,
  setClear,
}: {
  title: string;
  subtitle: string;
  model: ModelConfig;
  onChange: (model: ModelConfig) => void;
  apiKey: string;
  setKey: (key: string) => void;
  clear: boolean;
  setClear: (clear: boolean) => void;
}) {
  return (
    <fieldset className="model-fieldset">
      <legend>
        {title}
        <span
          className={`status ${modelReady(model) ? "status-done" : "status-pending"}`}
        >
          {modelReady(model) ? "已配置" : "未完成配置"}
        </span>
      </legend>
      <p className="muted">{subtitle}</p>
      <Field
        label="OpenAI 兼容服务地址"
        hint="填写完整 API 基础路径，例如 https://api.openai.com/v1。"
      >
        <input
          type="url"
          value={model.base_url}
          onChange={(e) => onChange({ ...model, base_url: e.target.value })}
          placeholder="https://api.openai.com/v1"
        />
      </Field>
      <Field label="模型名称">
        <input
          value={model.model}
          onChange={(e) => onChange({ ...model, model: e.target.value })}
          placeholder={
            title === "分类模型"
              ? "例如 gpt-4o-mini"
              : "例如 text-embedding-3-small"
          }
        />
      </Field>
      <Field
        label="服务端 API Key"
        hint={
          model.has_key
            ? "已有密钥保存在服务端；留空保留，不会显示原值。"
            : "尚未保存密钥。密钥提交后仅保存在服务端。"
        }
      >
        <input
          type="password"
          autoComplete="new-password"
          value={apiKey}
          disabled={clear}
          onChange={(e) => setKey(e.target.value)}
          placeholder={model.has_key ? "输入新密钥以替换" : "输入此服务的密钥"}
        />
      </Field>
      {model.has_key && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={clear}
            onChange={(e) => {
              setClear(e.target.checked);
              if (e.target.checked) setKey("");
            }}
          />
          保存时清除此服务的密钥
        </label>
      )}
    </fieldset>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
