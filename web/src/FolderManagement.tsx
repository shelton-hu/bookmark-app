import { useState } from "react";
import type { Folder, FolderDeletePreview } from "./api";

export function FolderSummary({ folder, path }: { folder: Folder; path: string }) {
  return <div className="folder-row-summary">
    <span className="folder-row-path">{path}</span>
    <span className="folder-row-counts">
      <strong>{folder.bookmark_count === undefined ? "数量待刷新" : `${folder.bookmark_count} 条书签`}</strong>
      <span>含子目录{folder.direct_bookmark_count !== undefined && ` · 本目录 ${folder.direct_bookmark_count} 条`}</span>
    </span>
  </div>;
}

export function FolderDeleteForm({ preview, names, busy, cancel, recheck, confirm }: {
  preview: FolderDeletePreview; names: string[]; busy: boolean;
  cancel: () => void; recheck: () => void; confirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const hasBookmarks = preview.bookmarks_affected > 0 || preview.descendant_bookmarks_preserved > 0;
  return <div className="folder-delete-form">
    <p className="modal-description">将删除 {preview.folders_deleted} 个目录，书签本身不会删除。</p>
    <ul className="folder-delete-names">{names.slice(0, 5).map((name, index) => <li key={index}>{name}</li>)}
      {names.length > 5 && <li>另有 {names.length - 5} 个所选目录</li>}</ul>
    <div className="folder-delete-impact" aria-label="删除影响">
      <p><strong>{preview.active_bookmarks_affected} 条</strong>直属正常书签将移入<strong>待整理箱</strong>。</p>
      {preview.trashed_bookmarks_affected > 0 && <p><strong>{preview.trashed_bookmarks_affected} 条</strong>回收站书签仅解除目录归属，仍留在回收站。</p>}
      {preview.descendant_bookmarks_preserved > 0 && <p>未选子目录中的 <strong>{preview.descendant_bookmarks_preserved} 条</strong>正常书签保留原目录归属。</p>}
      {preview.children_reparented > 0 && <p><strong>{preview.children_reparented} 个</strong>未选子目录将提升到最近保留的上级目录。</p>}
    </div>
    {hasBookmarks && <label className="folder-delete-ack">
      <input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />
      <span>我已核对数量，确认只删除目录并保留书签。</span>
    </label>}
    <div className="modal-actions">
      <button type="button" className="secondary" disabled={busy} onClick={cancel}>取消</button>
      <button type="button" className="secondary" disabled={busy} onClick={recheck}>重新核对数量</button>
      <button type="button" className="primary" disabled={busy || (hasBookmarks && !acknowledged)} onClick={confirm}>{busy ? "正在处理…" : "确认删除目录"}</button>
    </div>
  </div>;
}
