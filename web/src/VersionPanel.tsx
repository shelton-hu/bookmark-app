import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, CircleHelp, RefreshCw } from "lucide-react";
import { api } from "./api";
import "./version.css";

export interface VersionInfo {
  version: string;
  revision: string | null;
  repository: string | null;
  status: "unchecked" | "latest" | "update_available" | "ahead" | "unknown" | "development" | "disabled";
  latest_version: string | null;
  checked_at: string | null;
  error: string | null;
  release_url: string | null;
}

export function useVersion(authenticated: boolean) {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const load = useCallback(async (force = false) => {
    if (!authenticated) return;
    const id = ++request.current;
    setChecking(true);
    setFailed(false);
    try {
      let result = await api<VersionInfo>(force ? "/version?check=true&force=true" : "/version");
      if (id !== request.current) return;
      setInfo(result);
      if (!force && !["development", "disabled"].includes(result.status)) {
        result = await api<VersionInfo>("/version?check=true");
        if (id !== request.current) return;
        setInfo(result);
      }
    } catch {
      if (id === request.current) setFailed(true);
    } finally {
      if (id === request.current) setChecking(false);
    }
  }, [authenticated]);
  useEffect(() => {
    if (authenticated) void load();
    else setInfo(null);
    return () => { ++request.current; };
  }, [authenticated, load]);
  useEffect(() => {
    if (!authenticated) return;
    const focused = () => void load();
    window.addEventListener("focus", focused);
    return () => window.removeEventListener("focus", focused);
  }, [authenticated, load]);
  useEffect(() => {
    if (!info?.checked_at || !["latest", "update_available", "ahead"].includes(info.status)) return;
    const remaining = new Date(info.checked_at).getTime() + 6 * 3600_000 - Date.now();
    const timer = window.setTimeout(() => {
      setInfo((current) => current ? { ...current, status: "unknown" } : null);
      void load();
    }, Math.max(1000, remaining));
    return () => window.clearTimeout(timer);
  }, [info, load]);
  return { info, checking, failed, check: () => void load(true) };
}

type VersionState = ReturnType<typeof useVersion>;
function statusText({ info, checking, failed }: VersionState): string {
  if (checking) return "正在检查更新…";
  if (failed) return "暂时无法检查";
  switch (info?.status) {
    case "latest": return "已是最新版本";
    case "update_available": return `可更新至 ${info.latest_version}`;
    case "ahead": return "当前版本领先于发布源";
    case "development": return "本地开发版";
    case "disabled": return "更新检查已关闭";
    case "unknown": return "暂时无法检查";
    default: return "尚未检查更新";
  }
}

export function VersionFooter({ state, enjoy = false }: { state: VersionState; enjoy?: boolean }) {
  return <footer className={`app-footer${enjoy ? " enjoy-version-footer" : ""}`}>
    <span>拾页 · 你的收藏，你来掌握</span>
    {!enjoy ? <span>数据保存在自己的 NAS</span> : <a className="version-footer-link"
      title={enjoy ? "切换管理版，在应用设置中检查更新" : "查看版本与更新"}>
      <span>{state.info ? state.info.version === "development" ? "开发版" : state.info.version : state.failed ? "版本暂不可用" : "版本读取中"}</span>
      <span aria-hidden="true">·</span>
      <span>{statusText(state)}</span>
    </a>}
  </footer>;
}

export function BrandVersion({ state, onOpen }: { state: VersionState; onOpen: () => void }) {
  const { info, checking, failed } = state;
  const available = !failed && info?.status === "update_available";
  const uncertain = failed || !info || ["unknown", "unchecked", "development", "disabled"].includes(info.status);
  const version = info ? info.version === "development" ? "开发版" : info.version : failed ? "版本暂不可用" : "读取中…";
  return <a href="#settings"
    onClick={(event) => { event.preventDefault(); onOpen(); }}
    className={`brand-version${available ? " has-update" : uncertain ? " is-uncertain" : ""}`}
    title={`${version} · ${statusText(state)}，点击查看版本与更新`}
    aria-label={`当前版本 ${version}，${statusText(state)}，查看版本与更新`}>
    {version}{available && <span>可升级</span>}
    {checking && <span className="sr-only">正在检查更新</span>}
  </a>;
}

export default function VersionPanel({ state }: { state: VersionState }) {
  const { info, checking, failed, check } = state;
  const available = !checking && !failed && info?.status === "update_available";
  const latest = !checking && !failed && info?.status === "latest";
  const disabled = info?.status === "development" || info?.status === "disabled";
  return <section className="panel version-panel" aria-labelledby="version-heading">
    <div className="version-heading">
      <div><h2 id="version-heading">版本与更新</h2><p>查看当前运行版本，确认是否有新版本可用。</p></div>
      <button className="secondary" onClick={check} disabled={checking || disabled}>
        <RefreshCw size={17} className={checking ? "version-spinning" : ""} />
        {checking ? "检查中…" : "检查更新"}
      </button>
    </div>
    <div className="version-summary">
      <div><span className="version-caption">当前版本</span>
        <strong className="version-number">{info ? info.version === "development" ? "开发版" : info.version : failed ? "暂时无法读取" : "读取中…"}</strong>
        {info?.revision && <span className="version-revision">源码 {info.revision.slice(0, 8)}</span>}
      </div>
      <div className={`version-status${available ? " has-update" : ""}`} role="status">
        {latest ? <CheckCircle2 size={20} /> : available ? <ArrowUpRight size={20} /> : <CircleHelp size={20} />}
        <div><strong>{statusText(state)}</strong>
          {info?.checked_at && <span>上次检查 {new Date(info.checked_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>}
        </div>
      </div>
    </div>
    {available && <div className="version-update-note">
      <p>已有新版本。请在 NAS 中拉取新镜像并重新创建容器，更新后这里会显示新版本号。</p>
      {info?.release_url && <a href={info.release_url} target="_blank" rel="noreferrer">查看新版本 <ArrowUpRight size={15} /></a>}
    </div>}
    {disabled ? <p className="helper">{info?.status === "development"
      ? "当前直接运行本地源码，未标记正式版本；正式发布镜像会自动写入版本号。"
      : "此部署未启用在线更新检查，仍可查看当前运行版本。"}</p>
      : <p className="helper">只向 GitHub 查询公开版本号，不发送书签或账号资料。检查结果缓存 6 小时，手动检查间隔至少 1 分钟。</p>}
    {(failed || info?.status === "unknown") && <p className="version-error">暂时无法确认是否最新，请检查网络后重试。{info?.latest_version && ` 上次查到的版本为 ${info.latest_version}，仅供参考。`}</p>}
  </section>;
}
