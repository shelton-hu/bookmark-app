import { useEffect, useRef, useState } from "react";
import { api, ApiError, folderPath, message } from "./api";
import type { Folder } from "./api";
import { folderEntries } from "./ordering";
import "./folder-ai.css";

export interface OrganizeSuggestion {
  id: string;
  kind: "folder" | "title" | "move";
  entity_id: number;
  before: string;
  name?: string;
  title?: string;
  context?: string;
  target_parent_id?: number;
  new_segments?: string[];
  reason: string;
}
interface OrganizePreview {
  preview_id: string;
  root_path: string;
  folders_count: number;
  bookmarks_count: number;
  protected_count: number;
  expires_at: string;
  items: OrganizeSuggestion[];
}
export interface OrganizeCounts {
  folders_renamed: number;
  bookmarks_renamed: number;
  bookmarks_moved: number;
  folders_created: number;
}

export function OrganizeReview({ items, folders, selected, disabled, toggle }: {
  items: OrganizeSuggestion[]; folders: Folder[]; selected: string[]; disabled: boolean;
  toggle: (id: string) => void;
}) {
  const renames = new Map(items.filter(item => item.kind === "folder" && selected.includes(item.id))
    .map(item => [item.entity_id, item.name!]));
  const proposed = folders.map(folder => ({ ...folder, name: renames.get(folder.id) ?? folder.name }));
  return <div className="folder-ai-review" aria-label="整理修改对照">
    {items.map(item => {
      const after = item.kind === "title" ? item.title : item.kind === "folder"
        ? folderPath(item.entity_id, proposed.map(f => f.id === item.entity_id ? { ...f, name: item.name! } : f))
        : [folderPath(item.target_parent_id!, proposed), ...(item.new_segments ?? [])].join(" / ");
      return <label key={item.id} className={`folder-ai-change${selected.includes(item.id) ? " is-selected" : ""}`}>
        <input type="checkbox" checked={selected.includes(item.id)} disabled={disabled}
          aria-label={`应用${item.kind === "folder" ? "目录改名" : item.kind === "title" ? "书签改名" : "归属调整"}：${item.before}`}
          onChange={() => toggle(item.id)} />
        <span className="folder-ai-change-body">
          <span className="folder-ai-kind">{item.kind === "folder" ? "子目录名称" : item.kind === "title" ? "书签名称" : "书签归属"}</span>
          {item.kind === "move" && <strong>{item.context}</strong>}
          <span className="folder-ai-comparison"><span>{item.before}</span><span aria-label="改为">→</span><strong>{after}</strong></span>
          {item.reason && <small>{item.reason}</small>}
        </span>
      </label>;
    })}
  </div>;
}

export default function FolderAiOrganizer({ folders, initialFolder, modelConfigured, onBusy, onApplied, cancel, openSettings }: {
  folders: Folder[]; initialFolder?: Folder; modelConfigured: boolean;
  onBusy: (busy: boolean) => void; onApplied: (counts: OrganizeCounts) => void;
  cancel: () => void; openSettings: () => void;
}) {
  const [folderId, setFolderId] = useState(initialFolder ? String(initialFolder.id) : "");
  const [includeChildren, setIncludeChildren] = useState(true);
  const [renameFolders, setRenameFolders] = useState(true);
  const [renameBookmarks, setRenameBookmarks] = useState(true);
  const [moveBookmarks, setMoveBookmarks] = useState(false);
  const [rules, setRules] = useState("");
  const [preview, setPreview] = useState<OrganizePreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<"generate" | "apply" | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  const previewSection = useRef<HTMLElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); }; }, []);
  useEffect(() => { if (preview) previewSection.current?.scrollIntoView({ block: "start" }); }, [preview]);
  function invalidate() { setPreview(null); setSelected([]); setError(""); }
  async function run(operation: "generate" | "apply") {
    if (running.current) return;
    running.current = true;
    setBusy(operation); onBusy(true); setError("");
    const controller = new AbortController();
    request.current = controller;
    try {
      if (operation === "generate") {
        setPreview(null); setSelected([]);
        const result = await api<OrganizePreview>("/folders/ai-organize-preview", {
          method: "POST", signal: controller.signal,
          body: JSON.stringify({ folder_id: Number(folderId), include_children: includeChildren,
            rename_folders: renameFolders && includeChildren, rename_bookmarks: renameBookmarks,
            move_bookmarks: moveBookmarks, rules }),
        }, 1200000);
        if (!alive.current || controller.signal.aborted) return;
        setPreview(result); setSelected(result.items.map(item => item.id));
      } else if (preview) {
        const result = await api<OrganizeCounts>("/folders/ai-organize-apply", {
          method: "POST", signal: controller.signal,
          body: JSON.stringify({ preview_id: preview.preview_id, selected }),
        });
        if (alive.current) onApplied(result);
      }
    } catch (err) {
      if (alive.current && !controller.signal.aborted) {
        setError(message(err));
        if (err instanceof ApiError && err.status === 409) { setPreview(null); setSelected([]); }
      }
    } finally {
      running.current = false;
      if (alive.current) setBusy(null);
      onBusy(false);
    }
  }
  const canGenerate = modelConfigured && folderId && (renameBookmarks || moveBookmarks || (renameFolders && includeChildren));
  return <div className="folder-ai-organizer" aria-busy={Boolean(busy)}>
    <p className="modal-description">选定父目录，单独整理名称或归属。父目录保持固定，每项建议都可以取消。</p>
    {!modelConfigured && <div className="notice">请先配置分类模型。<button type="button" className="text-button" onClick={openSettings}>前往设置</button></div>}
    <fieldset disabled={Boolean(busy)} className="folder-ai-options">
      <label className="field">整理范围
        <select value={folderId} onChange={event => { setFolderId(event.target.value); invalidate(); }}>
          <option value="">选择父目录</option>
          {folderEntries(folders).map(({ folder }) => <option key={folder.id} value={folder.id}>{folderPath(folder.id, folders)}</option>)}
        </select>
      </label>
      <label className="folder-ai-check"><input type="checkbox" checked={includeChildren} onChange={event => { setIncludeChildren(event.target.checked); invalidate(); }} />包含子目录中的书签</label>
      <div className="folder-ai-operation-list">
        <label><input type="checkbox" checked={renameFolders} disabled={!includeChildren} onChange={event => { setRenameFolders(event.target.checked); invalidate(); }} /><span><strong>整理子目录名称</strong><small>统一现有子目录的命名，保留目录层级。</small></span></label>
        <label><input type="checkbox" checked={renameBookmarks} onChange={event => { setRenameBookmarks(event.target.checked); invalidate(); }} /><span><strong>规范书签名称</strong><small>保留产品、用途与环境信息，清理无意义的标题。</small></span></label>
        <label><input type="checkbox" checked={moveBookmarks} onChange={event => { setMoveBookmarks(event.target.checked); invalidate(); }} /><span><strong>重新分配书签目录</strong><small>仅在所选父目录内归档，可建议新子目录。手动分类和保留导入目录的书签跳过此项。</small></span></label>
      </div>
      <label className="field">本次整理要求（选填）
        <textarea value={rules} maxLength={4000} rows={3} placeholder="例如：标题统一为“工具名 · 用途”，保留正式、测试环境的区分。"
          onChange={event => { setRules(event.target.value); invalidate(); }} />
      </label>
    </fieldset>
    <p className="helper">根据本范围内已有的标题、网址、备注及允许发送的网页内容生成建议；回收站书签不参与。每次最多 200 个目录、500 条书签。确认前不修改书签或目录。</p>
    {error && <p className="folder-ai-error" role="alert">{error}</p>}
    {busy === "generate" && <p role="status">正在分析所选目录，书签较多时需要一些时间…</p>}
    {preview && <section ref={previewSection} className="folder-ai-preview" aria-label="整理预览">
      <div className="folder-ai-preview-heading"><div><h3>{preview.root_path}</h3><p>{preview.folders_count} 个子目录 · {preview.bookmarks_count} 条书签{moveBookmarks && preview.protected_count > 0 ? ` · ${preview.protected_count} 条保留原归属` : ""}</p></div>
        {preview.items.length > 0 && <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => setSelected(selected.length === preview.items.length ? [] : preview.items.map(item => item.id))}>{selected.length === preview.items.length ? "取消全选" : "全选建议"}</button>}</div>
      {preview.items.length === 0 ? <p className="notice">当前范围没有需要修改的建议。可以调整整理要求后重新生成。</p> : <>
        <OrganizeReview items={preview.items} folders={folders} selected={selected} disabled={Boolean(busy)}
          toggle={id => setSelected(current => current.includes(id) ? current.filter(key => key !== id) : [...current, id])} />
        <p className="helper">已选 {selected.length} / {preview.items.length} 项。目录改名会同步更新路径显示，取消改名不会改变归档目标的身份。预览有效期 30 分钟。</p>
      </>}
    </section>}
    <div className="modal-actions">
      <button type="button" className="secondary" disabled={busy === "apply"} onClick={() => { request.current?.abort(); cancel(); }}>{busy === "generate" ? "停止并关闭" : "取消"}</button>
      <button type="button" className="secondary" disabled={Boolean(busy) || !canGenerate} onClick={() => void run("generate")}>{busy === "generate" ? "正在生成…" : preview ? "重新生成预览" : "生成整理预览"}</button>
      {preview && <button type="button" className="primary" disabled={Boolean(busy) || !selected.length} onClick={() => void run("apply")}>{busy === "apply" ? "正在应用…" : `确认应用 ${selected.length} 项`}</button>}
    </div>
  </div>;
}
