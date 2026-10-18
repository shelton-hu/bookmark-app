import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { api, bookmarkFromList, message, post } from "./api";
import type { Bookmark, BookmarkListResult, Folder } from "./api";
import { folderEntries, keyboardPlacement, reorderedIds } from "./ordering";
import type { Placement } from "./ordering";

type SortItem = { id: number; label: string; group: number | null };
type Target = { target: number; placement: Placement };
type Session = { id: number; keyboard: boolean; index: number; x: number; y: number; startX: number; startY: number; active: boolean; target: Target | null };

function useDragOrder(items: SortItem[], disabled: boolean, move: (id: number, target: number, placement: Placement) => Promise<void>) {
  const root = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const frame = useRef(0);
  const [visual, setVisual] = useState<{ id: number; target: Target | null } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const instructions = useId();
  const current = useRef({ items, move });
  current.current = { items, move };
  const cancel = () => {
    session.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    setVisual(null);
  };
  useEffect(() => () => { cancelAnimationFrame(frame.current); session.current = null; }, []);
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  const groupItems = (id: number) => {
    const group = current.current.items.find(item => item.id === id)?.group;
    return current.current.items.filter(item => item.group === group).map(item => item.id);
  };
  const pointTarget = () => {
    const drag = session.current;
    if (!drag?.active || drag.keyboard) return;
    const element = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>("[data-sort-id]");
    const target = element && root.current?.contains(element) ? Number(element.dataset.sortId) : null;
    let next: Target | null = null;
    if (target !== null && target !== drag.id && groupItems(drag.id).includes(target)) {
      const body = element?.querySelector<HTMLElement>(":scope > [data-sort-body]") ?? element;
      const bounds = body!.getBoundingClientRect();
      next = { target, placement: drag.y < bounds.top + bounds.height / 2 ? "before" : "after" };
    }
    if (drag.target?.target !== next?.target || drag.target?.placement !== next?.placement) {
      drag.target = next;
      setVisual({ id: drag.id, target: next });
    }
  };
  const autoScroll = () => {
    const drag = session.current;
    if (!drag || drag.keyboard) return;
    if (drag.active && root.current) {
      let element: HTMLElement | null = root.current;
      while (element) {
        if (element.scrollHeight > element.clientHeight && /auto|scroll/.test(getComputedStyle(element).overflowY)) {
          const bounds = element.getBoundingClientRect();
          const delta = drag.y < bounds.top + 44 ? -12 : drag.y > bounds.bottom - 44 ? 12 : 0;
          if (delta) element.scrollTop += delta;
          break;
        }
        element = element.parentElement;
      }
      if (!element) {
        const delta = drag.y < 60 ? -12 : drag.y > window.innerHeight - 60 ? 12 : 0;
        if (delta) window.scrollBy(0, delta);
      }
      pointTarget();
    }
    frame.current = requestAnimationFrame(autoScroll);
  };
  const drop = () => {
    const drag = session.current;
    cancel();
    if (!drag?.active || !drag.target) return;
    const { id, target } = drag;
    setAnnouncement("正在保存顺序…");
    void current.current.move(id, target.target, target.placement).then(() => {
      setAnnouncement("顺序已保存。");
    }).catch(error => setAnnouncement(message(error))).finally(() => {
      root.current?.querySelector<HTMLButtonElement>(`[data-sort-handle="${id}"]`)?.focus({ preventScroll: true });
    });
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, id: number) => {
    if (disabled) return;
    const drag = session.current;
    if (drag && event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); cancel(); setAnnouncement("已取消拖动。");
      return;
    }
    if (!drag && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      const ids = groupItems(id);
      session.current = { id, keyboard: true, index: ids.indexOf(id), x: 0, y: 0, startX: 0, startY: 0, active: true, target: null };
      setVisual({ id, target: null });
      setAnnouncement("已拿起。使用上下方向键调整，回车放下，Esc 取消。");
    } else if (drag?.keyboard && drag.id === id) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault(); drop();
      } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const ids = groupItems(id);
        drag.index = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, drag.index + (event.key === "ArrowUp" ? -1 : 1)));
        drag.target = keyboardPlacement(ids, id, drag.index);
        setVisual({ id, target: drag.target });
        setAnnouncement(`将移至同级第 ${drag.index + 1} 项，回车保存。`);
        if (drag.target) root.current?.querySelector(`[data-sort-id="${drag.target.target}"]`)?.scrollIntoView({ block: "nearest" });
      }
    }
  };
  return {
    root,
    help: <><p className="sort-instructions" id={instructions}>按住六点手柄拖动，松开自动保存。键盘：空格拿起，上下键调整，回车放下。</p><span className="sr-only" role="status">{announcement}</span></>,
    rowClass: (id: number) => `sort-item${visual?.id === id ? " is-dragging" : ""}${visual?.target?.target === id ? ` drop-${visual.target.placement}` : ""}`,
    handle: (item: SortItem) => <button type="button" className="sort-handle" data-sort-handle={item.id} aria-label={`拖动排序 ${item.label}`} aria-describedby={instructions}
      aria-pressed={visual?.id === item.id} disabled={disabled || groupItems(item.id).length < 2}
      onKeyDown={event => keyDown(event, item.id)}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        if (disabled || event.button !== 0) return;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        session.current = { id: item.id, keyboard: false, index: 0, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false, target: null };
        frame.current = requestAnimationFrame(autoScroll);
      }}
      onPointerMove={event => {
        const drag = session.current;
        if (!drag || drag.keyboard || drag.id !== item.id) return;
        drag.x = event.clientX; drag.y = event.clientY;
        if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 5) {
          drag.active = true; setVisual({ id: item.id, target: null });
          setAnnouncement(`正在拖动 ${item.label}。`);
        }
        pointTarget();
      }}
      onPointerUp={drop} onPointerCancel={cancel} onLostPointerCapture={() => { if (session.current && !session.current.keyboard) cancel(); }}
      onClick={event => event.preventDefault()}><GripVertical size={18} aria-hidden="true" /></button>,
  };
}

export function SortableFolders({ folders, active, disabled, move, children }: {
  folders: Folder[]; active: boolean; disabled: boolean; move: (id: number, target: number, placement: Placement) => Promise<void>;
  children: (folder: Folder, handle: ReactNode) => ReactNode;
}) {
  const entries = folderEntries(folders);
  const drag = useDragOrder(entries.map(({ folder }) => ({ id: folder.id, label: folder.name, group: folder.parent_id })), disabled || !active, move);
  const render = (start: number, depth: number): ReactNode[] => {
    const result: ReactNode[] = [];
    for (let i = start; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.depth < depth) break;
      if (entry.depth !== depth) continue;
      result.push(<div key={entry.folder.id} className={drag.rowClass(entry.folder.id)} data-sort-id={entry.folder.id}>
        <div data-sort-body>{children(entry.folder, active ? drag.handle({ id: entry.folder.id, label: entry.folder.name, group: entry.folder.parent_id }) : null)}</div>
        {entries[i + 1]?.depth > depth && <div className="folder-sort-children">{render(i + 1, depth + 1)}</div>}
      </div>);
    }
    return result;
  };
  return <>{active && <>{drag.help}<p className="sort-scope-note">目录仅在同级内排序，子目录会随父目录一起移动。</p></>}<div ref={drag.root}>{render(0, 0)}</div></>;
}

export interface BookmarkOrderingScope {
  folderId: string;
  pending: boolean;
  setSaving: (saving: boolean) => void;
  saved: () => void;
}

export function SortableBookmarks({ folderId, pending, setSaving, saved, children }: BookmarkOrderingScope & {
  children: (bookmark: Bookmark) => ReactNode;
}) {
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, saveState] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const query = new URLSearchParams({ view: "summary", include_children: "true" });
  if (folderId) query.set("folder_id", folderId);
  if (pending) query.set("pending", "true");
  const url = "/bookmarks?" + query.toString();
  const read = async () => (await api<BookmarkListResult>(url)).items.map(bookmarkFromList);
  useEffect(() => {
    const controller = new AbortController();
    void api<BookmarkListResult>(url, { signal: controller.signal }).then(data => setItems(data.items.map(bookmarkFromList))).catch(e => {
      if (!controller.signal.aborted) setError(message(e));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url]);
  const move = async (id: number, target: number, placement: Placement) => {
    const order = reorderedIds(items.map(item => item.id), id, target, placement);
    if (order.every((value, i) => value === items[i].id)) return;
    const byId = new Map(items.map(item => [item.id, item]));
    setItems(order.map(identifier => byId.get(identifier)!));
    saveState(true); setSaving(true); setError(""); setStatus("正在保存…");
    try {
      await post("/bookmarks/reorder", { bookmark_id: id, target_id: target, placement });
      saved(); setItems(await read()); setStatus("顺序已保存，管理版和纯享版同步生效。");
    } catch (e) {
      setError(message(e)); setStatus("未能确认保存，请重新读取后再拖动。");
      try { setItems(await read()); } catch { /* Keep the error and offer an explicit retry. */ }
      throw e;
    } finally { saveState(false); setSaving(false); }
  };
  const drag = useDragOrder(items.map(item => ({ id: item.id, label: item.title || item.url, group: null })), saving || loading || Boolean(error), move);
  return <div className="inline-bookmark-sort">
    <div className="inline-sort-status">{drag.help}
      <p className="sort-scope-note" role="status">{loading ? "正在读取全部书签…" : status || `当前范围共 ${items.length} 条，排序时连续显示，完成后恢复分页。`}</p>
    </div>
    {error && <div role="alert" className="error-box">{error}<button type="button" className="text-button" disabled={saving || loading} onClick={async () => {
      setLoading(true); try { setItems(await read()); setError(""); setStatus(""); } catch (e) { setError(message(e)); } finally { setLoading(false); }
    }}>重新读取</button></div>}
    <div className="bookmark-rows is-sorting" ref={drag.root} role="list" aria-label="逐条书签（拖拽排序）" aria-busy={loading || saving}>
      {!loading && items.map(item => <div key={item.id} data-sort-id={item.id} className={drag.rowClass(item.id)}>
        {drag.handle({ id: item.id, label: item.title || item.url, group: null })}{children(item)}
      </div>)}
      {!loading && items.length === 0 && <p>当前范围没有书签。</p>}
    </div>
  </div>;
}
