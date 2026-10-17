import { useId, useRef, useState } from "react";
import { CheckCircle2, Download, FileJson, FileText, RotateCcw, ShieldCheck, Upload } from "lucide-react";
import { api } from "./api";
import SmartImport from "./SmartImport";

type TransferProps = {
  busy: string;
  run: (label: string, action: () => Promise<void>) => Promise<void>;
  imported: (text: string) => void;
  download: (format: "html" | "json") => Promise<void>;
  modelConfigured: boolean;
};
const tabs = ["导入书签", "导出书签", "备份与恢复"];

export default function TransferPage(props: TransferProps) {
  const { busy, run, download } = props;
  const [active, setActive] = useState(0);
  const id = useId();
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  return <div className="transfer-workspace">
    <div className="transfer-tabs" role="tablist" aria-label="导入导出任务" onKeyDown={event => {
      if (busy) return;
      const next = event.key === "ArrowRight" ? (active + 1) % tabs.length
        : event.key === "ArrowLeft" ? (active + tabs.length - 1) % tabs.length
        : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      setActive(next);
      tabButtons.current[next]?.focus();
    }}>
      {tabs.map((label, index) => <button key={label} type="button" role="tab"
        ref={element => { tabButtons.current[index] = element; }}
        id={`${id}-tab-${index}`} aria-controls={`${id}-panel-${index}`} aria-selected={active === index}
        tabIndex={active === index ? 0 : -1} disabled={Boolean(busy)} onClick={() => setActive(index)}>{label}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel-0`} aria-labelledby={`${id}-tab-0`} hidden={active !== 0}>
      <SmartImport busy={props.busy} run={props.run} imported={props.imported} modelConfigured={props.modelConfigured} />
      <details className="transfer-compat">
        <summary>旧版 HTML 导入</summary>
        <p className="helper">兼容原有导入方式，提交后直接写入。需要先检查内容时，请使用上方的预览导入。</p>
        <RestoreImport {...props} format="html" />
      </details>
    </div>
    <div role="tabpanel" id={`${id}-panel-1`} aria-labelledby={`${id}-tab-1`} hidden={active !== 1}>
      <section className="panel transfer-card">
        <div className="transfer-card-heading"><FileText size={22} aria-hidden="true" /><div><h2>导出浏览器书签</h2><p>将收藏带到 Chrome、Edge 或 Firefox。</p></div></div>
        <div className="transfer-facts"><span>HTML 格式</span><span>保留目录层级</span><span>仅有效书签</span></div>
        <p className="helper">不包含回收站中的书签。如需保留笔记、标签和设置，请使用「备份与恢复」。</p>
        <div className="transfer-actions"><button className="primary" disabled={Boolean(busy)} onClick={() => void run("导出 HTML", () => download("html"))}><Download size={17} aria-hidden="true" />导出 HTML</button></div>
      </section>
    </div>
    <div role="tabpanel" id={`${id}-panel-2`} aria-labelledby={`${id}-tab-2`} hidden={active !== 2}>
      <section className="panel transfer-card">
        <div className="transfer-card-heading"><FileJson size={22} aria-hidden="true" /><div><h2>下载拾页备份</h2><p>以 JSON 保存收藏和可恢复的设置。</p></div></div>
        <p className="helper">包含目录、书签、笔记、标签、回收站和非敏感设置。</p>
        <div className="transfer-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => void run("导出 JSON", () => download("json"))}><Download size={17} aria-hidden="true" />下载 JSON 备份</button></div>
      </section>
      <section className="panel transfer-card">
        <div className="transfer-card-heading"><RotateCcw size={22} aria-hidden="true" /><div><h2>从备份恢复</h2><p>合并拾页 JSON 备份中的内容，不清空现有收藏。</p></div></div>
        <RestoreImport {...props} format="json" />
      </section>
      <p className="transfer-privacy"><ShieldCheck size={16} aria-hidden="true" />备份与恢复不包含 API Key、账号凭据或扩展访问令牌。</p>
    </div>
  </div>;
}

function RestoreImport({ format, busy, run, imported }: Pick<TransferProps, "busy" | "run" | "imported"> & { format: "html" | "json" }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"preserve" | "reorganize">("preserve");
  const [result, setResult] = useState<{ imported: number; duplicates: number } | null>(null);
  const pending = useRef(false);
  const label = format === "json" ? "合并恢复备份" : "旧版 HTML 导入";
  return <form className="transfer-restore" onSubmit={event => {
    event.preventDefault();
    if (!file || busy || pending.current) return;
    pending.current = true;
    void run(label, async () => {
      const data = new FormData();
      data.append("file", file);
      if (format === "html") data.append("mode", mode);
      const next = await api<{ imported: number; duplicates: number }>(`/import/${format}`, { method: "POST", body: data });
      setResult(next);
      setFile(null);
      if (input.current) input.current.value = "";
      imported(`${format === "json" ? "恢复" : "导入"}完成：新增 ${next.imported} 条，跳过重复 ${next.duplicates} 条。`);
    }).finally(() => { pending.current = false; });
  }}>
    {format === "html" && <fieldset className="transfer-legacy-modes" disabled={Boolean(busy)}>
      <legend>目录处理</legend>
      {(["preserve", "reorganize"] as const).map(choice => <label key={choice}><input type="radio" name={`${id}-mode`} checked={mode === choice} onChange={() => setMode(choice)} />{choice === "preserve" ? "保留原目录" : "放入待整理"}</label>)}
    </fieldset>}
    <label className="field"><span>{format === "json" ? "选择拾页 JSON 备份" : "选择 HTML 文件"}</span>
      <input type="file" ref={input} required disabled={Boolean(busy)} accept={format === "html" ? ".html,.htm,text/html" : ".json,application/json"}
        onChange={event => { setFile(event.target.files?.[0] ?? null); setResult(null); }} /></label>
    <p className="helper">{format === "json" ? "合并恢复目录、书签、回收站和非敏感设置。" : "导入不会自动发送内容给模型。"}重复网址将按现有规则跳过。</p>
    <div className="transfer-actions"><button className="primary" disabled={!file || Boolean(busy)}><Upload size={17} aria-hidden="true" />{busy === label ? "正在处理…" : label}</button></div>
    {result && <div className="import-result" role="status"><CheckCircle2 size={20} aria-hidden="true" /><div><strong>{format === "json" ? "恢复完成" : "导入完成"}</strong><p>新增 {result.imported} 条 · 跳过重复 {result.duplicates} 条</p></div></div>}
  </form>;
}
