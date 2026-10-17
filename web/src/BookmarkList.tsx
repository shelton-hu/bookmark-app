import { useId, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Folder, Pencil, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { date, folderPath } from "./api";
import type { Bookmark } from "./api";
import { BookmarkHand } from "./BookmarkHand";
import type { HandPosition } from "./BookmarkHand";
import type { BookmarkCardProps } from "./ClowBookmark";
import { useBookmarkDetails } from "./bookmarkDetails";

/** Keep the same result scope and actions while changing only the presentation. */
export function BookmarkResults({ managing, items, children }: {
  managing: boolean; items: Bookmark[];
  children: (bookmark: Bookmark, hand?: HandPosition) => ReactNode;
}) {
  return managing
    ? <div className="bookmark-rows" role="list" aria-label="逐条书签">{items.map((bookmark) => children(bookmark))}</div>
    : <div className="bookmark-hands"><BookmarkHand items={items}>{children}</BookmarkHand></div>;
}

export default function BookmarkRow({ bookmark: b, folders, selected, toggle, edit, refresh, remove, restore, filterTag, busy }: BookmarkCardProps) {
  const [expanded, setExpanded] = useState(false);
  const details = useBookmarkDetails(b, expanded);
  const detail = details.bookmark;
  const detailId = useId();
  const title = b.title || b.url;
  const safeUrl = /^https?:\/\//i.test(b.url) ? b.url : undefined;
  const status = b.classification_status === "failed" ? "failed" : b.folder_id === null ? "pending" : undefined;
  return <article className={`bookmark-row${selected ? " is-selected" : ""}`} role="listitem">
    <label className="bookmark-row-select"><input type="checkbox" checked={selected} disabled={busy} onChange={toggle} aria-label={`选择 ${title}`} /></label>
    <div className="bookmark-row-content">
      <h2>{safeUrl ? <a href={safeUrl} target="_blank" rel="noopener noreferrer">{title}</a> : title}</h2>
      <div className="bookmark-row-url">{b.url}</div>
      <div className="bookmark-row-meta"><span><Folder size={13} aria-hidden="true" />{folderPath(b.folder_id, folders)}</span>
        {!b.deleted_at && status && <span className={`bookmark-row-status ${status}`}>{status === "failed" ? "分类失败" : "待整理"}</span>}
      </div>
    </div>
    <div className="bookmark-row-actions" aria-label={`${title} 的操作`}>
      <button type="button" aria-label={`${expanded ? "收起" : "查看"} ${title} 的详情`} aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)}>详情<ChevronDown size={14} className={expanded ? "is-expanded" : ""} /></button>
      {b.deleted_at ? <>
        <button type="button" disabled={busy} onClick={restore} aria-label={`恢复 ${title}`}><RotateCcw size={15} />恢复</button>
        <button type="button" className="row-delete" disabled={busy} onClick={remove} aria-label={`彻底删除 ${title}`}><Trash2 size={15} />彻底删除</button>
      </> : <>
        <button type="button" disabled={busy} onClick={edit} aria-label={`编辑 ${title}`}><Pencil size={15} />编辑</button>
        <button type="button" className="row-delete" disabled={busy} onClick={remove} aria-label={`删除 ${title}`}><Trash2 size={15} />删除</button>
      </>}
    </div>
    <div id={detailId} className="bookmark-row-details" hidden={!expanded}>
      {expanded && <>
        {details.loading ? <p role="status">正在加载详情…</p> : details.error ?
          <div role="alert"><p>{details.error}</p><button type="button" className="text-button" onClick={details.retry}>重新加载详情</button></div> : <>
          <dl><dt>摘要</dt><dd>{detail.summary || detail.description || "暂无摘要。"}</dd>{detail.notes && <><dt>笔记</dt><dd>{detail.notes}</dd></>}</dl>
          {detail.tags.length > 0 && <div className="bookmark-row-tags" aria-label="标签">{detail.tags.map((tag) => <button type="button" key={tag} onClick={() => filterTag(tag)}># {tag}</button>)}</div>}
          {detail.error && <p className="bookmark-row-error">{detail.error}</p>}
        </>}
        <div className="bookmark-row-detail-footer"><span>收藏于 {date(b.created_at)}</span>{b.deleted_at ? <span>删除于 {date(b.deleted_at)}</span> : <button type="button" disabled={busy} onClick={refresh}><RefreshCw size={14} />刷新内容</button>}</div>
      </>}
    </div>
  </article>;
}
