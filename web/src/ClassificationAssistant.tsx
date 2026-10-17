import { useEffect, useId, useRef, useState } from "react";
import { api, post, message } from "./api";
import type { Job, Settings } from "./api";
import "./classification-assistant.css";

interface ClassificationAssistantProps {
  bookmarkIds: number[];
  modelConfigured: boolean;
  onApplied: (job: Job) => void;
  onSaved: () => void;
  openSettings: () => void;
}
interface ChatMessage { role: "user" | "assistant"; content: string }
interface Sample {
  bookmark_id: number;
  title: string;
  url: string;
  current_path: string[];
  path: string[];
  tags: string[];
  summary: string;
  reason: string;
  manual_classification: boolean;
  preserve_import_folder: boolean;
}
type Operation = "chat" | "preview" | "save" | "apply";
const guidance = "你好，我们可以一起梳理书签的分类方式。告诉我你常收藏哪些内容、希望用什么目录层级，以及哪些类别需要分开。我会与你讨论并提出规则，你也可以直接修改右侧的规则，再试分几条看看原因。";
const pathText = (path: string[]) => path.join(" / ") || "未归档";
const invalidResponse = "服务器返回了不完整的分类结果，请重试。你的草案和讨论已保留。";
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
function isSample(value: unknown): value is Sample {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<Sample>;
  return typeof item.bookmark_id === "number" && typeof item.title === "string" &&
    typeof item.url === "string" && stringList(item.current_path) && stringList(item.path) &&
    stringList(item.tags) && typeof item.summary === "string" && typeof item.reason === "string" &&
    typeof item.manual_classification === "boolean" && typeof item.preserve_import_folder === "boolean";
}

export default function ClassificationAssistant({ bookmarkIds, modelConfigured, onApplied, onSaved, openSettings }: ClassificationAssistantProps) {
  const id = useId();
  const [rules, setRules] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [saveRules, setSaveRules] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<{ items: Sample[]; selection: string } | null>(null);
  const mounted = useRef(false);
  const operation = useRef<Operation | null>(null);
  const request = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const conversationLog = useRef<HTMLDivElement | null>(null);
  const previousBusy = useRef<Operation | null>(null);
  const ids = [...new Set(bookmarkIds)];
  const selection = ids.join(",");
  const disabled = loading || Boolean(loadError) || busy !== null;
  const samples = preview?.selection === selection ? preview.items : null;

  useEffect(() => {
    if (previousBusy.current === "chat" && busy === null) composer.current?.focus();
    previousBusy.current = busy;
  }, [busy]);
  useEffect(() => {
    const log = conversationLog.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    api<Settings>("/settings", { signal: controller.signal })
      .then((settings) => {
        if (!controller.signal.aborted && mounted.current) {
          setRules(settings.classification.prompt ?? ""); setPreview(null);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted && mounted.current) setLoadError(message(err));
      })
      .finally(() => {
        if (!controller.signal.aborted && mounted.current) setLoading(false);
      });
    return () => controller.abort();
  }, [loadAttempt]);

  function changeRules(value: string) { setRules(value); setPreview(null); setNotice(""); }
  async function run(kind: Operation) {
    if (operation.current || loading || loadError) return;
    if ((kind === "chat" || kind === "preview" || kind === "apply") && !modelConfigured) return;
    if (kind === "chat" && !draft.trim()) return;
    if ((kind === "preview" || kind === "apply") && !ids.length) return;
    if (kind !== "chat" && !rules.trim()) return;
    operation.current = kind;
    setBusy(kind); setError(""); setNotice("");
    const controller = new AbortController();
    request.current = controller;
    const currentRules = rules;
    try {
      if (kind === "chat") {
        const conversation: ChatMessage[] = [...messages.slice(-18), { role: "user", content: draft.trim() }];
        const context = conversation.map((entry) => ({ ...entry, content: entry.content.slice(0, 4000) }));
        while (context.length > 1 && context.reduce((total, entry) => total + entry.content.length, 0) > 20000) context.splice(0, 2);
        const result = await api<{ reply: string; rules: string }>("/classification-assistant/chat", {
          method: "POST", signal: controller.signal,
          body: JSON.stringify({ messages: context, rules: currentRules }),
        }, 60000);
        if (!mounted.current) return;
        if (!result || typeof result.reply !== "string" || !result.reply.trim() || result.reply.length > 4000 ||
          typeof result.rules !== "string" || !result.rules.trim() || result.rules.length > 20000) throw new Error(invalidResponse);
        const updatedMessages: ChatMessage[] = [...conversation, { role: "assistant", content: result.reply }];
        setMessages(updatedMessages.slice(-20));
        setDraft(""); changeRules(result.rules);
        setNotice("已更新规则草案，可以继续讨论或直接编辑。尚未保存、未修改书签。");
      } else if (kind === "preview") {
        setPreview(null);
        const result = await api<{ items: Sample[]; rules: string }>("/classification-assistant/preview", {
          method: "POST", signal: controller.signal,
          body: JSON.stringify({ bookmark_ids: ids.slice(0, 3), rules: currentRules }),
        }, 60000);
        if (!mounted.current) return;
        if (!result || typeof result.rules !== "string" || !result.rules.trim() || result.rules.length > 20000 ||
          !Array.isArray(result.items) || result.items.length > 3 || !result.items.every(isSample) ||
          result.items.some((item) => !ids.slice(0, 3).includes(item.bookmark_id)) ||
          new Set(result.items.map((item) => item.bookmark_id)).size !== result.items.length) throw new Error(invalidResponse);
        setRules(result.rules); setPreview({ items: result.items, selection });
        setNotice("试分类完成，书签未被修改。可对照原因继续调整规则。");
      } else if (kind === "save") {
        const result = await post<{ rules: string }>("/classification-assistant/rules", { rules: currentRules });
        if (!mounted.current) return;
        if (!result || typeof result.rules !== "string" || !result.rules.trim() || result.rules.length > 20000) throw new Error(invalidResponse);
        if (result.rules !== currentRules) changeRules(result.rules);
        setNotice("规则已保存，后续分类将使用这些规则。"); onSaved();
      } else {
        const result = await api<{ job: Job; skipped: number }>("/classification-assistant/apply", {
          method: "POST", signal: controller.signal,
          body: JSON.stringify({ bookmark_ids: ids, rules: currentRules, save_rules: saveRules }),
        }, 60000);
        if (!mounted.current) return;
        if (!result || !result.job || typeof result.job.id !== "number" || result.job.kind !== "classify" ||
          !["queued", "running", "paused", "completed", "failed"].includes(result.job.status) ||
          typeof result.skipped !== "number" || !Number.isInteger(result.skipped) || result.skipped < 0) throw new Error(invalidResponse);
        setNotice(`分类任务已创建${result.skipped ? `，跳过 ${result.skipped} 条受保护的书签` : ""}。`);
        if (saveRules) onSaved();
        onApplied(result.job);
      }
    } catch (err) {
      if (mounted.current) setError(message(err));
    } finally {
      operation.current = null; request.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  return (
    <div className="classification-assistant" aria-busy={loading || busy !== null}>
      <div className="ca-intro"><p>先讨论分类习惯，再编辑规则、试分样本，最后应用到所选书签。</p><span className="ca-selection">已选 {ids.length} 条</span></div>
      <div className={`ca-model-notice${modelConfigured ? "" : " ca-model-notice-warning"}`}>
        <p>{modelConfigured ? "分类模型已配置。发送消息、试分类和执行分类会调用模型，可能产生费用。" : "请先配置分类模型，再开始对话、试分类或执行分类。你仍可编辑并保存规则。"}</p>
        <button type="button" className="ca-button" onClick={openSettings} disabled={Boolean(busy)}>模型设置</button>
      </div>
      {!ids.length && <p className="ca-empty-selection">现在可以先讨论并保存规则。需要试分类或应用时，请关闭此窗口，在书签列表勾选书签后重新打开。</p>}
      {loading && <p className="ca-feedback" role="status">正在读取现有分类规则…</p>}
      {loadError && <div className="ca-feedback ca-error" role="alert"><p>读取规则失败：{loadError}</p><button type="button" className="ca-button" onClick={() => setLoadAttempt((value) => value + 1)}>重新读取</button></div>}
      <div className="ca-workspace">
        <section className="ca-panel ca-chat" aria-labelledby={`${id}-chat-title`}>
          <h3 id={`${id}-chat-title`}>一起讨论</h3>
          <div ref={conversationLog} className="ca-conversation" role="log" aria-label="分类规则讨论" aria-live="polite" aria-relevant="additions text">
            <article className="ca-message ca-message-assistant"><span className="ca-speaker">分类助手</span><p>{guidance}</p></article>
            {messages.map((entry, index) => <article key={index} className={`ca-message ca-message-${entry.role}`}><span className="ca-speaker">{entry.role === "user" ? "你" : "分类助手"}</span><p>{entry.content}</p></article>)}
            {busy === "chat" && <p className="ca-feedback" role="status">正在思考你的分类需求…</p>}
          </div>
          <form className="ca-composer" onSubmit={(event) => { event.preventDefault(); void run("chat"); }}>
            <label htmlFor={`${id}-draft`}>描述你的分类习惯</label>
            <textarea ref={composer} maxLength={4000} id={`${id}-draft`} rows={3} value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} placeholder="例如：技术资料按前端、后端分开，教程和工具也分别归档…" aria-describedby={`${id}-composer-help`} onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void run("chat"); }
            }} />
            <div className="ca-composer-actions"><span id={`${id}-composer-help`} className="ca-help">Ctrl / ⌘ + Enter 发送 · 保留最近 20 条消息</span><button type="submit" className="ca-button ca-button-primary" disabled={disabled || !modelConfigured || !draft.trim()}>{busy === "chat" ? "正在发送…" : "发送"}</button></div>
          </form>
        </section>
        <section className="ca-panel ca-rules" aria-labelledby={`${id}-rules-title`}>
          <div className="ca-panel-heading"><h3 id={`${id}-rules-title`}>规则草案</h3><span className="ca-help">可直接编辑</span></div>
          <label htmlFor={`${id}-rules`}>分类规则</label>
          <textarea maxLength={20000} id={`${id}-rules`} className="ca-rules-input" rows={12} value={rules} disabled={disabled} onChange={(event) => changeRules(event.target.value)} placeholder="可以先与助手讨论，也可以直接写下目录结构、标签和分类偏好。" aria-describedby={`${id}-rules-help`} />
          <p className="ca-help" id={`${id}-rules-help`}>草案不会自动保存。请先讨论形成规则或直接填写，再保存、试分类或应用；修改规则后需要重新试分类。</p>
          <button type="button" className="ca-button ca-preview-button" onClick={() => void run("preview")} disabled={disabled || !rules.trim() || !modelConfigured || !ids.length}>{busy === "preview" ? "正在试分类…" : `试分类前 ${Math.min(ids.length, 3)} 条`}</button>
          <p className="ca-help">试分类只展示建议目录、标签和原因，不修改书签。</p>
        </section>
      </div>
      <section className="ca-preview" aria-labelledby={`${id}-preview-title`}>
        <div className="ca-panel-heading"><h3 id={`${id}-preview-title`}>试分类结果</h3><span className="ca-help">最多 3 条样本</span></div>
        <p className="ca-protection">手动归档的书签保持原目录，应用时会跳过；受保护的导入目录会保留，不会被模型建议覆盖。</p>
        {samples ? samples.length ? <div className="ca-samples">{samples.map((sample) => <article className="ca-sample" key={sample.bookmark_id}>
          <h4>{sample.title || "未命名书签"}</h4><p className="ca-url">{sample.url}</p>
          <dl><div><dt>当前目录</dt><dd>{pathText(sample.current_path)}</dd></div><div><dt>建议目录</dt><dd>{pathText(sample.path)}</dd></div><div><dt>分类原因</dt><dd>{sample.reason || "未提供分类原因"}</dd></div>{sample.summary && <div><dt>内容摘要</dt><dd>{sample.summary}</dd></div>}<div><dt>建议标签</dt><dd>{sample.tags.length ? <span className="ca-tags">{sample.tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</span> : "无"}</dd></div></dl>
          {(sample.manual_classification || sample.preserve_import_folder) && <p className="ca-sample-protection">{sample.manual_classification ? "手动归档保护：应用时跳过此书签，保持原目录。" : "导入目录保护：实际分类时保留原导入目录。"}{sample.manual_classification && sample.preserve_import_folder ? " 原导入目录也受保护。" : ""}</p>}
        </article>)}</div> : <p className="ca-preview-empty">没有可展示的样本，请重新选择书签后试分类。</p> : <p className="ca-preview-empty">{busy === "preview" ? "正在分析样本，请稍候…" : "点击试分类，先看看这些规则会如何归档书签。"}</p>}
      </section>
      {error && <p className="ca-feedback ca-error" role="alert">{error}</p>}
      {notice && <p className="ca-feedback ca-success" role="status">{notice}</p>}
      <div className="ca-footer">
        <label className="ca-save-toggle"><input type="checkbox" checked={saveRules} disabled={disabled} onChange={(event) => setSaveRules(event.target.checked)} /><span>应用时保存为后续默认规则</span></label>
        <div className="ca-final-actions"><button type="button" className="ca-button" onClick={() => void run("save")} disabled={disabled || !rules.trim()}>{busy === "save" ? "正在保存…" : "保存规则"}</button><button type="button" className="ca-button ca-button-primary" onClick={() => void run("apply")} disabled={disabled || !rules.trim() || !modelConfigured || !ids.length}>{busy === "apply" ? "正在创建任务…" : `按此规则分类所选${ids.length ? `（${ids.length}）` : ""}`}</button></div>
      </div>
    </div>
  );
}
