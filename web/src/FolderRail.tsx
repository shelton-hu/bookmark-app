import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ChevronRight, Folder, Library } from "lucide-react";
import type { Folder as FolderItem } from "./api";
import { folderSiblings } from "./ordering";

/** Wide-screen folder column: one click filters the list; narrow screens keep the dropdown. */
export default function FolderRail({ folders, selected, onSelect }: {
  folders: FolderItem[]; selected: string; onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const render = (parent: number | null, level: number, seen: number[]): ReactNode => {
    const entries = folderSiblings(folders, parent).filter((folder) => !seen.includes(folder.id));
    if (!entries.length) return null;
    return <ul role={level ? "group" : undefined}>
      {entries.map((folder) => {
        const children = folders.some((child) => child.parent_id === folder.id && !seen.includes(child.id));
        const open = children && !collapsed[folder.id];
        const current = selected === String(folder.id);
        return <li key={folder.id}>
          <div className={`folder-rail-row${current ? " is-current" : ""}`} style={{ "--rail-depth": Math.min(level, 5) } as CSSProperties}>
            {children
              ? <button type="button" className="folder-rail-toggle" aria-expanded={open} aria-label={`${open ? "折叠" : "展开"} ${folder.name}`}
                onClick={() => setCollapsed((value) => ({ ...value, [folder.id]: open }))}><ChevronRight size={14} aria-hidden="true" /></button>
              : <span className="folder-rail-toggle" aria-hidden="true" />}
            <button type="button" className="folder-rail-select" aria-current={current ? "true" : undefined} title={folder.name}
              onClick={() => onSelect(current ? "" : String(folder.id))}>
              <Folder size={15} aria-hidden="true" />
              <span>{folder.name}</span>
              {folder.bookmark_count !== undefined && <small>{folder.bookmark_count}</small>}
            </button>
          </div>
          {open && render(folder.id, level + 1, [...seen, folder.id])}
        </li>;
      })}
    </ul>;
  };
  return <nav className="folder-rail" aria-label="按目录筛选">
    <h2>目录</h2>
    <div className={`folder-rail-row${selected ? "" : " is-current"}`} style={{ "--rail-depth": 0 } as CSSProperties}>
      <span className="folder-rail-toggle" aria-hidden="true" />
      <button type="button" className="folder-rail-select" aria-current={selected ? undefined : "true"} onClick={() => onSelect("")}>
        <Library size={15} aria-hidden="true" /><span>全部收藏</span>
      </button>
    </div>
    {folders.length ? render(null, 0, []) : <p className="folder-rail-empty">还没有目录</p>}
  </nav>;
}
