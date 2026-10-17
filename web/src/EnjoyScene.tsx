import { useEffect, useId, useRef } from "react";
import type { RefObject } from "react";
import { BookOpen, MoreHorizontal, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import ClowCatalog from "./ClowCatalog";
import type { Folder } from "./api";
import type { WorkspaceMode } from "./workspaceMode";

export function EnjoyAtmosphere() {
  const circle = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const syncVisibility = () => {
      if (circle.current) circle.current.style.animationPlayState = document.hidden ? "paused" : "running";
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);
  useEffect(() => {
    document.body.classList.add("enjoy-surface");
    const theme = document.querySelector('meta[name="theme-color"]');
    const previous = theme?.getAttribute("content");
    theme?.setAttribute("content", "#160f24");
    return () => {
      document.body.classList.remove("enjoy-surface");
      if (previous) theme?.setAttribute("content", previous);
    };
  }, []);
  return <div className="enjoy-atmosphere" aria-hidden="true">
    <div className="enjoy-ground"><img ref={circle} style={{ animationPlayState: "paused" }} src="/clow-scene/clow-circle.svg" alt="" width="788" height="788" draggable={false} /></div>
  </div>;
}

export function WorkspaceModeSwitch({ mode, busy, onChange }: {
  mode: WorkspaceMode; busy: boolean; onChange: (mode: WorkspaceMode) => void;
}) {
  const enjoying = mode === "enjoy";
  return <button type="button" className="secondary workspace-mode-link" disabled={busy}
    onClick={() => onChange(enjoying ? "manage" : "enjoy")}
    title={enjoying ? "添加、编辑和整理书签" : "按分类浏览、搜索和打开收藏"}>
    {enjoying ? <SlidersHorizontal size={17} aria-hidden="true" /> : <BookOpen size={17} aria-hidden="true" />}
    <span>{enjoying ? "去管理版" : "去纯享版"}</span>
  </button>;
}

type SearchProps = {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string; onQuery: (query: string) => void;
  searchMode: "keyword" | "semantic"; onSearchMode: (mode: "keyword" | "semantic") => void;
  folders: Folder[]; folderId: string; onFolder: (id: string) => void;
  onMode: (mode: WorkspaceMode) => void; onRefresh: () => void; busy: boolean;
};

export function EnjoySearch({ inputRef, query, onQuery, searchMode, onSearchMode, folders, folderId, onFolder, onMode, onRefresh, busy }: SearchProps) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const act = (action: () => void) => { menu.current?.hidePopover(); action(); };
  const category = folders.find((folder) => String(folder.id) === folderId);
  const scope = category ? `搜索 ${category.name} 中的收藏` : "搜索全部收藏";
  return <div className="enjoy-toolbar">
    <ClowCatalog folders={folders} selected={folderId} onSelect={onFolder} />
    <section className="enjoy-search" aria-label={scope}>
      <Search size={21} aria-hidden="true" />
      <input ref={inputRef} aria-label={scope} aria-keyshortcuts="Control+k Meta+k" type="search"
        placeholder={searchMode === "semantic" ? `${scope} · 描述你想找的内容…` : scope}
        value={query} onChange={(event) => onQuery(event.target.value)} />
      {query && <button className="enjoy-search-clear" aria-label="清除搜索" onClick={() => onQuery("")}><X size={18} /></button>}
      <button className="enjoy-menu-trigger" aria-label="搜索选项" popoverTarget={id}><MoreHorizontal size={21} /></button>
      <div ref={menu} id={id} popover="auto" className="enjoy-menu" aria-label="搜索选项">
        <div className="enjoy-search-kind" role="group" aria-label="搜索方式">
          <button aria-pressed={searchMode === "keyword"} onClick={() => act(() => onSearchMode("keyword"))}>关键词</button>
          <button aria-pressed={searchMode === "semantic"} onClick={() => act(() => onSearchMode("semantic"))}>语义搜索</button>
        </div>
        <button onClick={() => act(onRefresh)}><RefreshCw size={16} />刷新收藏</button>
      </div>
    </section>
    <WorkspaceModeSwitch mode="enjoy" busy={busy} onChange={onMode} />
  </div>;
}
