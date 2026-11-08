import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Reuse the visible face; only its transform animates before opening the website. */
export default function CardOpenOverlay({ title, origin, front, onFinish, onCancel }: {
  title: string; origin: DOMRect; front: ReactNode; onFinish: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const finish = useRef(() => {});
  const cancel = useRef(() => {});
  useLayoutEffect(() => {
    const modal = dialog.current, card = face.current;
    if (!modal || !card) return;
    let settled = false;
    let animation: Animation | undefined;
    let timeout: number | undefined;
    const settle = (open: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (animation) { animation.onfinish = null; animation.cancel(); }
      if (open) onFinish(); else onCancel();
    };
    finish.current = () => settle(true);
    cancel.current = () => settle(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.showModal();
    const x = origin.left + origin.width / 2 - window.innerWidth / 2;
    const y = origin.top + origin.height / 2 - window.innerHeight / 2;
    const scale = Math.max(1.05, Math.min(1.35, (window.innerWidth - 40) / origin.width, (window.innerHeight - 72) / origin.height));
    const start = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(0deg) scale(1)`;
    const end = `translate(-50%, -50%) translate(0px, 0px) rotate(360deg) scale(${scale})`;
    card.style.transform = start;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduce = () => { if (motion.matches) settle(true); };
    const hidden = () => { if (document.hidden) settle(false); };
    const interrupted = () => settle(false);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', interrupted);
    window.addEventListener('resize', interrupted);
    motion.addEventListener('change', reduce);
    if (motion.matches) queueMicrotask(() => settle(true));
    else {
      try {
        animation = card.animate([{ transform: start }, { transform: end }], {
          duration: 600, easing: 'cubic-bezier(.2,.65,.2,1)', fill: 'forwards',
        });
        animation.onfinish = () => settle(true);
        // Covers unavailable animation events without leaving a stuck modal.
        timeout = window.setTimeout(() => settle(true), 900);
      } catch {
        card.style.transform = end;
        timeout = window.setTimeout(() => settle(true), 600);
      }
    }
    return () => {
      settled = true;
      window.clearTimeout(timeout);
      if (animation) { animation.onfinish = null; animation.cancel(); }
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', interrupted);
      window.removeEventListener('resize', interrupted);
      motion.removeEventListener('change', reduce);
      document.body.style.overflow = overflow;
      modal.close();
    };
  }, []);
  return createPortal(<dialog ref={dialog} className="card-open" aria-label={`打开 ${title}`}
    onCancel={event => { event.preventDefault(); cancel.current(); }}
    onClick={event => { event.stopPropagation(); finish.current(); }}
    onPointerMove={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <div ref={face} className="card-open-face" aria-hidden="true" style={{ width: origin.width, height: origin.height }}>{front}</div>
    <button type="button" className="card-open-cancel" autoFocus aria-label="取消打开网页"
      onClick={event => { event.stopPropagation(); cancel.current(); }}><X size={20} /></button>
    <p className="card-open-status">正在打开 {title} · 点击任意处直接打开</p>
  </dialog>, document.body);
}
