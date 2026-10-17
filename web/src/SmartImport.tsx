import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, ArrowUpRight, Check, CheckCircle2, FileSearch, Folder, Loader2, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import { api, message, post } from "./api";
import "./smart-import.css";

type ImportMode = "preserve" | "reorganize";
type ImportPreview = {
  preview_id: string;
  filename: string;
  format: string;
  method: "local" | "model";
  mode: ImportMode;
  counts: { total: number; importable: number; duplicates: number; invalid: number; folders: number };
  folders: (string[] | string)[];
  items: { title: string; url: string; path: string[]; status: "new" | "duplicate"; duplicate_reason?: string }[];
  rejected: { reason: string; title?: string; url?: string }[];
  warnings: string[];
  expires_at: string;
  has_more?: boolean;
};
type ImportResult = { imported: number; duplicates: number; folders_created: number; invalid: number };
type SmartImportProps = {
  busy: string;
  run: (label: string, action: () => Promise<void>) => Promise<void>;
  imported: (text: string) => void;
  modelConfigured: boolean;
};

function readablePath(path: string[] | string) {
  return (Array.isArray(path) ? path.join(" / ") : path) || "未归档";
}

function safeLink(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

export default function SmartImport({ busy, run, imported, modelConfigured }: SmartImportProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const feedback = useRef<HTMLHeadingElement>(null);
  const requestVersion = useRef(0);
  const requestActive = useRef(false);
  const mounted = useRef(true);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<ImportMode>("preserve");
  const [useModel, setUseModel] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<"analyze" | "commit" | null>(null);
  const [expired, setExpired] = useState(false);
  const locked = Boolean(busy) || operation !== null;

  const clearPreview = () => {
    requestVersion.current += 1;
    setPreview(null);
    setResult(null);
    setError("");
    setExpired(false);
  };
  const reset = () => {
    clearPreview();
    setFile(null);
    if (input.current) input.current.value = "";
    requestAnimationFrame(() => input.current?.focus());
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
    };
  }, []);

  useEffect(() => {
    requestVersion.current += 1;
    setPreview(null);
    setResult(null);
    setError("");
    setExpired(false);
    if (!modelConfigured) setUseModel(false);
  }, [modelConfigured]);

  useEffect(() => {
    if (!preview || result) return;
    const remaining = new Date(preview.expires_at).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    setExpired(remaining <= 0);
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, Math.min(remaining, 2147483647)));
    return () => window.clearTimeout(timer);
  }, [preview, result]);

  useEffect(() => {
    if (preview || result) feedback.current?.focus();
  }, [preview, result]);

  const analyze = async () => {
    if (!file || locked || requestActive.current) return;
    clearPreview();
    const version = requestVersion.current;
    requestActive.current = true;
    setOperation("analyze");
    const current = () => mounted.current && version === requestVersion.current;
    try {
      await run("分析导入文件", async () => {
        try {
          const body = new FormData();
          body.append("file", file);
          body.append("mode", mode);
          body.append("use_model", String(useModel && modelConfigured));
          const next = await api<ImportPreview>("/import/preview", { method: "POST", body });
          if (current()) setPreview(next);
        } catch (cause) {
          if (current()) setError(message(cause));
        }
      });
    } catch (cause) {
      if (current()) setError(message(cause));
    } finally {
      requestActive.current = false;
      if (mounted.current) setOperation(null);
    }
  };

  const canCommit = preview && !expired && !result &&
    (preview.counts.importable > 0 || (preview.mode === "preserve" && preview.counts.folders > 0));
  const commit = async () => {
    if (!preview || !canCommit || locked || requestActive.current) return;
    if (Date.parse(preview.expires_at) <= Date.now()) {
      setExpired(true);
      setError("预览已过期，请重新分析文件后确认导入。");
      return;
    }
    const version = requestVersion.current;
    requestActive.current = true;
    setOperation("commit");
    setError("");
    const current = () => mounted.current && version === requestVersion.current;
    try {
      await run("确认导入书签", async () => {
        try {
          // Keep the same preview ID on retries: the server makes commits idempotent.
          const next = await post<ImportResult>("/import/commit", { preview_id: preview.preview_id });
          if (current()) setResult(next);
          imported(`导入完成：新增 ${next.imported} 条，跳过重复 ${next.duplicates} 条，创建 ${next.folders_created} 个目录，无效 ${next.invalid} 条。`);
        } catch (cause) {
          if (current()) setError(message(cause));
        }
      });
    } catch (cause) {
      if (current()) setError(message(cause));
    } finally {
      requestActive.current = false;
      if (mounted.current) setOperation(null);
    }
  };

  return (
    <section className="panel smart-import" aria-labelledby={`${id}-title`} aria-busy={operation !== null}>
      <header className="si-heading"><h2 id={`${id}-title`}>导入书签</h2><p className="muted">先预览，再确认写入。</p></header>
      <ol className="si-steps" aria-label="导入步骤">
        <li aria-current={!preview && !result ? "step" : undefined}><span>1</span>选择文件</li>
        <li aria-current={preview && !result ? "step" : undefined}><span>2</span>检查预览</li>
        <li aria-current={result ? "step" : undefined}><span>3</span>完成</li>
      </ol>

      {(preview || result) && file && <div className="si-file-summary"><FileSearch size={18} aria-hidden="true" /><span><strong>{file.name}</strong><small>{(file.size / 1024).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} KB · {mode === "preserve" ? "保留原目录" : "放入待整理"}</small></span>{!result && <button className="text-button" type="button" disabled={locked} onClick={reset}>重新选择</button>}</div>}
      {!preview && !result && <form onSubmit={(event) => { event.preventDefault(); void analyze(); }}>
        <label className={`si-dropzone${dragging ? " is-dragging" : ""}${locked ? " is-disabled" : ""}`}
          onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={event => {
            event.preventDefault(); setDragging(false);
            if (locked) return;
            const files = event.dataTransfer.files;
            if (files.length !== 1) { setError("请一次选择一个文件。"); return; }
            clearPreview(); setFile(files[0]);
            if (input.current) input.current.value = "";
          }}>
          <Upload size={26} aria-hidden="true" />
          <strong>{file ? file.name : "拖入文件，或点击选择"}</strong>
          <span>{file ? `${(file.size / 1024).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} KB · 点击更换文件` : "HTML · JSON · CSV · MD · TXT"}</span>
          <input ref={input} type="file" disabled={locked} aria-label="选择收藏文件" aria-describedby={`${id}-file-help`}
            onChange={event => { if (event.target.files?.[0]) { clearPreview(); setFile(event.target.files[0]); } }} />
        </label>
        <p className="si-file-help helper" id={`${id}-file-help`}>自动识别格式，单个文件最大 10 MB。确认前不会写入书签。</p>

        <fieldset className="import-modes" disabled={locked}>
          <legend>如何处理目录？</legend>
          {(["preserve", "reorganize"] as const).map((choice) => (
            <label key={choice} className={`mode-choice${mode === choice ? " selected" : ""}`}>
              <input type="radio" name={`${id}-mode`} value={choice} checked={mode === choice}
                onChange={() => { clearPreview(); setMode(choice); }} />
              <span><strong>{choice === "preserve" ? "保留原目录" : "放入待整理"}</strong>
                <small>{choice === "preserve" ? "保留层级与空目录。" : "保留来源路径，稍后手动分类。"}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <details className="si-advanced"><summary>高级选项{useModel ? " · 已启用模型辅助" : ""}</summary>
        <p className="helper">支持 HTML / HTM、JSON、CSV / TSV、Markdown（MD / MARKDOWN）、TXT，以及其他含网址的文本文件，无需固定字段结构。</p>
        <label className={`si-model-choice${!modelConfigured ? " si-unavailable" : ""}`}>
          <input type="checkbox" checked={useModel} disabled={locked || !modelConfigured}
            aria-describedby={`${id}-model-help`} onChange={(event) => { clearPreview(); setUseModel(event.target.checked); }} />
          <span><strong><Sparkles size={16} aria-hidden="true" />允许模型辅助识别</strong>
            <small id={`${id}-model-help`}>勾选即同意：仅在本地解析需要帮助时，将文件片段发送给已配置的模型服务。默认仅使用本地解析。</small>
          </span>
        </label>
        {!modelConfigured && <p className="helper si-settings-hint">尚未配置分类模型，请先到「设置」完成模型配置后再启用辅助识别。</p>}
        </details>

        {!result && <div className="si-actions">
          <button className={preview ? "secondary" : "primary"} type="submit" disabled={!file || locked}>
            {operation === "analyze" ? <Loader2 className="si-spin" size={17} aria-hidden="true" /> : <FileSearch size={17} aria-hidden="true" />}
            {operation === "analyze" ? "正在分析…" : preview ? "重新分析" : "分析并预览"}
          </button>
          {(file || preview) && <button className="text-button" type="button" disabled={locked} onClick={reset}><X size={16} aria-hidden="true" />{preview ? "取消并重新选择" : "清除文件"}</button>}
        </div>}
      </form>}

      <div className="si-announcement" role="status" aria-live="polite" aria-atomic="true">
        {operation === "analyze" ? "正在分析文件，请稍候。" : operation === "commit" ? "正在确认导入，请稍候。" : result ? `导入完成，新增 ${result.imported} 条书签，创建 ${result.folders_created} 个目录。` : preview ? `预览已生成，可导入 ${preview.counts.importable} 条，重复 ${preview.counts.duplicates} 条，无效 ${preview.counts.invalid} 条。` : ""}
      </div>
      {error && <div className="notice error si-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}

      {preview && !result && <div className="si-preview">
        <div className="si-preview-heading">
          <h3 tabIndex={-1} ref={feedback}><FileSearch size={19} aria-hidden="true" />导入预览</h3>
          <span className="si-badge">{preview.method === "model" ? "模型辅助解析" : "本地解析"}</span>
        </div>
        <p className="si-preview-meta">{preview.filename} · {preview.format} · {preview.mode === "preserve" ? "保留原目录" : "重新整理"}</p>
        <dl className="si-stats">
          {([["识别总数", preview.counts.total], ["可导入", preview.counts.importable], ["重复跳过", preview.counts.duplicates], ["无效条目", preview.counts.invalid], ["目录", preview.counts.folders]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count.toLocaleString("zh-CN")}</dd></div>)}
        </dl>

        {preview.warnings.length > 0 && <div className="si-warnings"><strong><AlertCircle size={16} aria-hidden="true" />解析提醒</strong><ul tabIndex={0} aria-label="解析提醒列表">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        {preview.folders.length > 0 && <details className="si-details">
          <summary><Folder size={16} aria-hidden="true" />目录路径（展示 {preview.folders.length} 个）</summary>
          <ul className="si-scroll si-paths" tabIndex={0} aria-label="目录路径列表">{preview.folders.map((path, index) => <li key={index}>{readablePath(path)}</li>)}</ul>
          {preview.counts.folders > preview.folders.length && <p className="helper">最多展示 200 个目录路径，目录计数包含全部目录。</p>}
        </details>}

        <div className="si-list-heading"><h4>书签明细</h4><span>展示 {preview.items.length} 条，最多 100 条</span></div>
        {preview.items.length > 0 ? <div className="si-scroll si-items" tabIndex={0} role="region" aria-label="书签预览明细">
          <ul>{preview.items.map((item, index) => {
            const href = safeLink(item.url);
            return <li className="si-item" key={index}>
              <div className="si-item-title"><strong>{item.title || "未命名书签"}</strong><span className={`si-badge${item.status === "duplicate" ? " si-duplicate" : ""}`}>{item.status === "duplicate" ? "重复 · 跳过" : "新增"}</span></div>
              {href ? <a className="si-url" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${item.title || "未命名书签"}：${item.url}（在新窗口打开）`}>{item.url}<ArrowUpRight size={14} aria-hidden="true" /></a> : <span className="si-url">{item.url}</span>}
              <p className="si-directory"><Folder size={14} aria-hidden="true" /><span>目录：{readablePath(item.path)}</span></p>
              {item.duplicate_reason && <p className="helper">重复原因：{item.duplicate_reason}</p>}
            </li>;
          })}</ul>
        </div> : <p className="helper">没有可展示的书签条目。保留原目录时，仍可确认导入文件中的目录。</p>}
        {(preview.has_more || preview.counts.total - preview.counts.invalid > preview.items.length) && <p className="helper si-limit-note">这里只展示部分条目；上方统计为完整文件计数，确认时处理全部可导入内容。</p>}

        {preview.counts.invalid > 0 && <details className="si-details">
          <summary><AlertCircle size={16} aria-hidden="true" />无效条目与原因（{preview.counts.invalid} 条）</summary>
          <ul className="si-scroll si-rejected" tabIndex={0} aria-label="无效条目列表">{preview.rejected.map((item, index) => <li key={index}><strong>{item.title || item.url || "未命名条目"}</strong>{item.title && item.url && <span>{item.url}</span>}<p>原因：{item.reason}</p></li>)}</ul>
          <p className="helper">最多展示 50 条无效记录；这些条目不会导入。{preview.counts.invalid > preview.rejected.length ? `另有 ${preview.counts.invalid - preview.rejected.length} 条未展示。` : ""}</p>
        </details>}

        <div className="si-confirm-note"><ShieldCheck size={18} aria-hidden="true" /><p>规范化后相同的网址会跳过，包括回收站中的书签。确认时会重新检查重复项，实际导入数可能与预览不同。预览有效期为 30 分钟{Number.isFinite(Date.parse(preview.expires_at)) ? `（至 ${new Date(preview.expires_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}）` : ""}。</p></div>
        {expired && <p className="si-expired" role="status">预览已过期，请重新分析文件后确认导入。</p>}
        {!canCommit && !expired && <p className="helper">没有可导入的书签或可保留的目录，请重新选择文件。</p>}
        <div className="si-actions">
          <button className="primary" type="button" disabled={locked || !canCommit} onClick={() => void commit()}>
            {operation === "commit" ? <Loader2 className="si-spin" size={17} aria-hidden="true" /> : <Check size={17} aria-hidden="true" />}
            {operation === "commit" ? "正在导入…" : `确认导入（${preview.counts.importable} 条）`}
          </button>
          <button className="secondary" type="button" disabled={locked} onClick={() => void analyze()}>重新分析</button>
          <button className="secondary" type="button" disabled={locked} onClick={reset}>取消导入</button>
        </div>
      </div>}

      {result && <div className="si-result">
        <h3 tabIndex={-1} ref={feedback}><CheckCircle2 size={21} aria-hidden="true" />导入完成</h3>
        <p>新增 <strong>{result.imported}</strong> 条书签，跳过重复 <strong>{result.duplicates}</strong> 条，创建 <strong>{result.folders_created}</strong> 个目录，无效 <strong>{result.invalid}</strong> 条。</p>
        <p className="helper">以上为确认时的实际处理结果。{preview?.mode === "reorganize" ? "新书签已进入待整理，可手动启动分类。" : "已按原目录结构导入。"}</p>
        <button className="secondary" type="button" disabled={locked} onClick={reset}><Upload size={17} aria-hidden="true" />导入另一个文件</button>
      </div>}
    </section>
  );
}
