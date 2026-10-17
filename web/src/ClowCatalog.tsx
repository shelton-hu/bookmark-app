import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Folder } from "./api";
import BrandMark from "./BrandMark";

function isPendingFolder(folder: Folder): boolean {
  return /^待整理(?:\s*(?:（[^）]*）|\([^)]*\)))?$/.test(folder.name.trim());
}

export function categoryTrail(folders: Folder[], selected: string): Folder[] {
  const trail: Folder[] = [];
  const seen = new Set<number>();
  let current = folders.find((folder) => String(folder.id) === selected);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    trail.unshift(current);
    current = folders.find((folder) => folder.id === current?.parent_id);
  }
  return trail;
}

export default function ClowCatalog({ folders, selected, onSelect, variant = "book" }: {
  folders: Folder[]; selected: string; onSelect: (id: string) => void; variant?: "book" | "compact";
}) {
  const compact = variant === "compact";
  const allLabel = "全部收藏";
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [expandedFolders, setExpandedFolders] = useState<Record<number, boolean>>({});
  const trail = categoryTrail(folders, selected);
  const current = trail.at(-1);
  const close = () => {
    panel.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  };
  const select = (value: string) => { onSelect(value); close(); };
  const place = () => {
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds && panel.current) {
      const mobile = window.innerWidth <= 760;
      const inset = mobile ? 8 : 16;
      const width = mobile ? window.innerWidth - inset * 2 : compact ? 360 : 440;
      const gap = compact ? 6 : mobile ? 8 : 12;
      panel.current.style.setProperty("--catalog-top", `${Math.max(inset, bounds.bottom + gap)}px`);
      panel.current.style.setProperty("--catalog-left", `${Math.max(inset, Math.min(bounds.left, window.innerWidth - width - inset))}px`);
    }
  };
  const open = () => {
    place();
    setExpandedFolders((value) => ({ ...value, ...Object.fromEntries(trail.map((folder) => [folder.id, true])) }));
  };
  useEffect(() => {
    const reposition = () => { if (panel.current?.matches(":popover-open")) place(); };
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [compact]);
  const render = (parent: number | null, level: number, seen: number[]): ReactNode => {
    const entries = folders.filter((folder) => folder.parent_id === parent && !seen.includes(folder.id))
      .sort((a, b) => Number(isPendingFolder(a)) - Number(isPendingFolder(b)));
    if (!entries.length) return null;
    return <ul className="catalog-branches">
      {entries.map((folder) => {
        const children = folders.some((child) => child.parent_id === folder.id && !seen.includes(child.id));
        const expanded = expandedFolders[folder.id] ?? trail.some((entry) => entry.id === folder.id);
        const branchId = `${id}-branch-${folder.id}`;
        return <li key={folder.id}>
          <div className={`catalog-row${children ? " has-children" : ""}${selected === String(folder.id) ? " is-current" : ""}`} data-depth={level} style={{ "--catalog-depth": Math.min(level, 6) } as CSSProperties}>
            {children ? <button className="catalog-expand" aria-label={`${expanded ? "折叠" : "展开"} ${folder.name}`}
              aria-expanded={expanded} aria-controls={branchId} onClick={() => setExpandedFolders((value) => ({ ...value, [folder.id]: !expanded }))}>
              <ChevronRight size={15} aria-hidden="true" />
            </button> : <span className="catalog-leaf" aria-hidden="true"><span /></span>}
            <button className="catalog-select" aria-current={selected === String(folder.id) ? "true" : undefined}
              onClick={() => select(String(folder.id))}>
              <span>{folder.name}</span>
              {folder.bookmark_count !== undefined && <small aria-label={`${folder.bookmark_count} 条收藏`}>{folder.bookmark_count}</small>}
            </button>
          </div>
          {children && <div id={branchId} hidden={!expanded} className="catalog-children" style={{ "--catalog-parent-depth": Math.min(level, 6) } as CSSProperties}>{render(folder.id, level + 1, [...seen, folder.id])}</div>}
        </li>;
      })}
    </ul>;
  };
  return <div className={`clow-catalog${compact ? " clow-catalog--compact" : ""}`}>
    <button ref={trigger} className="catalog-trigger" popoverTarget={id} onClick={open} aria-haspopup="dialog"
      aria-label={`${compact ? "筛选目录" : "选择分类"}：${current?.name ?? allLabel}`} title={trail.map((folder) => folder.name).join(" / ") || allLabel}>
      {compact ? <BookOpen size={16} aria-hidden="true" /> : <BrandMark size={32} transparent />}
      <span>{!compact && <small>藏书册</small>}<strong>{current?.name ?? allLabel}</strong></span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    <div ref={panel} id={id} popover="auto" className={`catalog-panel${compact ? " catalog-panel--compact" : ""}`} role="dialog" aria-label={compact ? "筛选目录" : "藏书册分类目录"}>
      <header className="catalog-heading"><div><h2>{compact ? "筛选目录" : "藏书目录"}</h2>
        {current && <button className="catalog-reset" aria-label="返回全部收藏" onClick={() => select("")}><ChevronLeft size={14} aria-hidden="true" />全部收藏</button>}
      </div>
        <button className="catalog-close" aria-label="关闭分类目录" onClick={close}><X size={19} /></button>
      </header>
      <div className="catalog-pages">
        {folders.length ? render(null, 0, []) : <p className="catalog-empty">这里还没有分类，可以在管理模式中整理收藏。</p>}
      </div>
      <footer className="catalog-footnote">选择父目录时包含其子目录</footer>
    </div>
  </div>;
}
