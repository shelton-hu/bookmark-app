import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { ReactNode, RefObject } from "react";
import { ArrowUpRight, BookOpen, Folder, Pencil, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import type { Bookmark, Folder as FolderType } from "./api";
import { date, folderPath } from "./api";
import { handPose } from "./BookmarkHand";
import type { HandPosition } from "./BookmarkHand";
import { cardForBookmark } from "./clowDeck";
import CardDeparture from "./CardDepartureOverlay";
import { bookmarkTarget, openBookmarkTab } from "./cardDeparture";
import { ribbonTitleLines } from "./ribbonTitle";
import { useBookmarkDetails } from "./bookmarkDetails";

function RibbonTitle({ title }: { title: string }) {
  const pathId = useId();
  const measureRef = useRef<SVGTextElement>(null);
  const [lines, setLines] = useState([title]);
  useLayoutEffect(() => {
    const node = measureRef.current;
    if (!node) return;
    let mounted = true;
    const fit = () => {
      if (!mounted) return;
      setLines(ribbonTitleLines(title, value => {
        node.textContent = value;
        return node.getComputedTextLength();
      }));
      node.textContent = "";
    };
    fit();
    void document.fonts.ready.then(fit);
    return () => { mounted = false; };
  }, [title]);
  return <svg className="clow-scroll-title" viewBox="0 0 600 1344" aria-hidden="true" focusable="false">
    <defs>{lines.map((_, index) => <path key={index} id={`${pathId}-${index}`}
      d={`M 110 ${lines.length === 1 ? 1218 : 1194 + index * 48} q 190 46 380 0`} />)}</defs>
    <text ref={measureRef} className="clow-title-measure" />
    {lines.map((line, index) => <text key={index} textAnchor="middle">
      <textPath href={`#${pathId}-${index}`} startOffset="50%">{line}</textPath>
    </text>)}
  </svg>;
}

export function CardFace({ id, title }: { id: number; title: string }) {
  const card = cardForBookmark(id);
  return <>
    <img className="clow-face-image" src={`/clow-deck/${card.key}.webp`} width="600" height="1344" alt="" draggable={false} decoding="async" loading="lazy" />
    <RibbonTitle title={title} />
  </>;
}

export type BookmarkCardProps = {
  managing: boolean; hand?: HandPosition; bookmark: Bookmark; folders: FolderType[];
  selected: boolean; toggle: () => void; edit: () => void; refresh: () => void;
  remove: () => void; restore: () => void; filterTag: (tag: string) => void; busy: boolean;
};

export default function ClowBookmark({ managing, hand, bookmark: b, folders, selected, toggle, edit, refresh, remove, restore, filterTag, busy }: BookmarkCardProps) {
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  const [departure, setDeparture] = useState<DOMRect | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const details = useBookmarkDetails(b, Boolean(origin));
  const detail = details.bookmark;
  const trigger = useRef<HTMLButtonElement>(null);
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const readerFocus = useRef<HTMLButtonElement | null>(null);
  const launching = useRef(false);
  const title = b.title || b.url;
  const drawn = Boolean(hand && hand.activeIndex === hand.index);
  const centered = Boolean(hand && hand.index === (hand.centerIndex ?? Math.floor((hand.count - 1) / 2)));
  const safeUrl = bookmarkTarget(b.url);
  const card = cardForBookmark(b.id);
  const open = (blocked = false) => {
    if (!busy && !launching.current && trigger.current) {
      document.dispatchEvent(new CustomEvent("bookmark-detail-open", { detail: b.id }));
      readerFocus.current = detailsTrigger.current || trigger.current;
      setPopupBlocked(blocked);
      setOrigin(trigger.current.getBoundingClientRect());
    }
  };
  const restoreCard = () => {
    // Commit the original face before navigation can put this page in the background.
    flushSync(() => setDeparture(null));
    launching.current = false;
    const rail = trigger.current?.closest<HTMLElement>(".hand-rail");
    (rail || trigger.current)?.focus({ preventScroll: true });
    flushSync(() => window.dispatchEvent(new Event("bookmark-hand-settle")));
  };
  const finishVisit = () => {
    restoreCard();
    if (safeUrl && !openBookmarkTab(safeUrl)) open(true);
  };
  const visit = () => {
    if (busy || launching.current || !trigger.current) return;
    if (managing || !safeUrl) { open(); return; }
    launching.current = true;
    document.dispatchEvent(new CustomEvent("bookmark-detail-open", { detail: b.id }));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finishVisit();
    else setDeparture(trigger.current.getBoundingClientRect());
  };
  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<number | null>).detail !== b.id) {
        launching.current = false;
        setOrigin(null);
        setDeparture(null);
      }
    };
    document.addEventListener("bookmark-detail-open", closeOther);
    return () => document.removeEventListener("bookmark-detail-open", closeOther);
  }, [b.id]);
  return <article className={`bookmark-card bookmark-ribbon clow-card ${hand ? "hand-card" : ""} ${drawn ? "is-drawn" : ""} ${centered ? "is-centered" : ""} ${selected ? "is-selected" : ""} ${origin ? "is-reading" : ""} ${departure ? "is-departing" : ""}`}
    style={hand ? handPose(hand, selected) : undefined} data-hand-index={hand?.index} data-card-kind={card.key}>
    {managing && <label className="ribbon-select"><input type="checkbox" aria-label={`选择 ${title}`} checked={selected} disabled={busy} onChange={toggle} /></label>}
    <button ref={trigger} className="clow-art" aria-label={managing || !safeUrl ? `翻牌查看 ${title}（${card.glyph}）` : `翻牌打开 ${title}（新标签页）`} title={managing || !safeUrl ? "翻牌查看详情" : "翻牌打开网站"} disabled={busy} onClick={visit}>
      <CardFace id={b.id} title={title} />
    </button>
    <button ref={detailsTrigger} className="clow-details-seal" aria-label={`翻牌查看 ${title} 的详情`} aria-haspopup="dialog" aria-expanded={Boolean(origin)} title="只查看详情，不打开网站" disabled={busy} onClick={() => open()}><BookOpen size={14} aria-hidden="true" /><span>翻阅</span></button>
    {departure && <CardDeparture bookmarkId={b.id} title={title} origin={departure} front={<CardFace id={b.id} title={title} />} onFinish={finishVisit} onCancel={restoreCard} />}
    {origin && <FlipDetail title={title} bookmarkId={b.id} origin={origin} trigger={trigger} returnFocus={readerFocus} onClosed={() => setOrigin(null)}>
      {(close) => <>
        <div className="clow-detail-heading">
          <span className="clow-detail-seal" aria-hidden="true">{card.glyph}</span>
          <div className="clow-detail-edition"><span>封印藏书</span><strong>{card.name}之牌</strong></div>
          <button className="clow-close" autoFocus aria-label="关闭书签详情" onClick={() => close()}><X size={20} /></button>
        </div>
        <h2>{title}</h2>
        {popupBlocked && <p className="clow-popup-notice" role="status">浏览器未允许自动打开，请点下方「打开网站」继续。</p>}
        <div className="clow-detail-rule" aria-hidden="true" />
        <div className="clow-detail-scroll" tabIndex={0} aria-label="书签详细信息">
          {details.loading ? <p role="status">正在加载详情…</p> : details.error ?
            <div role="alert"><p>{details.error}</p><button type="button" className="text-button" onClick={details.retry}>重新加载详情</button></div> : <>
          <dl>
            <div className="clow-detail-field clow-detail-address"><dt>网址</dt><dd className="clow-full-url">{b.url}</dd></div>
            <div className="clow-detail-field"><dt>分类</dt><dd><Folder size={14} aria-hidden="true" />{folderPath(b.folder_id, folders)}</dd></div>
            <div className="clow-detail-field clow-detail-summary"><dt>摘要</dt><dd>{detail.summary || detail.description || "这份收藏还没有摘要。"}</dd></div>
          </dl>
          {detail.notes && <section><h3>笔记</h3><p>{detail.notes}</p></section>}
          {detail.tags.length > 0 && <div className="clow-detail-tags" aria-label="标签">{detail.tags.map((tag) => <button key={tag} onClick={() => close(() => filterTag(tag))}># {tag}</button>)}</div>}
          <p className="clow-detail-date">收藏于 {date(b.created_at)}</p>
          {detail.error && <p className="card-error">{detail.error}</p>}
          </>}
        </div>
        <div className="clow-detail-footer">
          {safeUrl ? <a className="clow-open-site" href={safeUrl} target="_blank" rel="noopener noreferrer">打开网站 <ArrowUpRight size={18} /></a> : <p>此网址无法直接打开。</p>}
          {managing && <div className="clow-manage-actions">{b.deleted_at ? <button disabled={busy} onClick={() => close(restore)}><RotateCcw size={15} />恢复</button> : <>
            <button disabled={busy} onClick={() => close(edit)}><Pencil size={15} />编辑</button>
            <button disabled={busy} onClick={() => close(refresh)}><RefreshCw size={15} />刷新内容</button>
            <button disabled={busy} onClick={() => close(remove)}><Trash2 size={15} />删除</button>
          </>}</div>}
        </div>
      </>}
    </FlipDetail>}
  </article>;
}

/** The native modal owns focus/inertness; flight and flip are separate transforms. */
function FlipDetail({ title, bookmarkId, origin, trigger, returnFocus, onClosed, children }: {
  title: string; bookmarkId: number; origin: DOMRect; trigger: RefObject<HTMLButtonElement | null>;
  returnFocus: RefObject<HTMLButtonElement | null>;
  onClosed: () => void; children: (close: (action?: () => void) => void) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const flight = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const closing = useRef(false);
  const closeFrame = useRef(0);
  const mounted = useRef(true);
  const actionAfterClose = useRef<(() => void) | undefined>(undefined);
  const reduced = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const setOriginTransform = (rect: DOMRect) => {
    const element = flight.current;
    if (!element) return;
    element.style.setProperty("--card-ratio", `${origin.width / origin.height}`);
    const width = element.getBoundingClientRect().width;
    // offsetWidth ignores the active flight transform; use the laid-out card width.
    const layoutWidth = parseFloat(getComputedStyle(element).width) || width;
    element.style.setProperty("--flight-x", `${rect.left + rect.width / 2 - window.innerWidth / 2}px`);
    element.style.setProperty("--flight-y", `${rect.top + rect.height / 2 - window.innerHeight / 2}px`);
    element.style.setProperty("--flight-scale", `${rect.width / layoutWidth}`);
  };
  useLayoutEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    mounted.current = true;
    modal.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (flight.current) flight.current.style.transition = "none";
    setOriginTransform(origin);
    // Commit the source pose before enabling transitions for the real flight.
    flight.current?.getBoundingClientRect();
    let secondFrame = 0;
    const frame = requestAnimationFrame(() => {
      if (flight.current) flight.current.style.transition = "";
      secondFrame = requestAnimationFrame(() => { if (!closing.current) setReady(true); });
    });
    return () => {
      mounted.current = false;
      cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); cancelAnimationFrame(closeFrame.current);
      document.body.style.overflow = previousOverflow;
      modal.close();
    };
  }, []);
  const finish = () => {
    dialog.current?.close();
    onClosed();
    requestAnimationFrame(() => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      actionAfterClose.current?.();
    });
  };
  const close = (action?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    actionAfterClose.current = action;
    if (trigger.current) setOriginTransform(trigger.current.getBoundingClientRect());
    setReady(false);
    if (reduced.current) finish();
    else closeFrame.current = requestAnimationFrame(() => {
      const animations = flight.current?.getAnimations({ subtree: true }) || [];
      Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
        if (mounted.current) finish();
      });
    });
  };
  return createPortal(<dialog ref={dialog} className={`clow-reader ${ready ? "is-flipped" : ""}`} aria-label={`${title} 的详情`}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) close(); }}
    onPointerMove={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <div ref={flight} className="clow-flight">
      <div className="clow-flipper">
        <div className="clow-reader-front" aria-hidden="true"><CardFace id={bookmarkId} title={title} /></div>
        <div className="clow-reader-back">{children(close)}</div>
      </div>
    </div>
  </dialog>, document.body);
}
