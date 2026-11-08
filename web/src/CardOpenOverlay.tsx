import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const OPEN_MS = 1200;
// Constant angular deceleration makes the three turns take about 0.22, 0.29 and
// 0.69 seconds. Sample once; the browser plays them without a JavaScript frame loop.
const spinFrames = Array.from({ length: 31 }, (_, index) => {
  const t = index / 30;
  const progress = 1 - (1 - t) ** 2;
  const lift = Math.sin(Math.PI * progress);
  return { offset: t, transform: `translateZ(${lift * 90}px) rotateX(${lift * 8}deg) rotateY(${progress * 1080}deg)` };
});

/** Keep the old rapid vertical-axis spin, then open without the summoning scene. */
export default function CardOpenOverlay({ title, glyph, name, origin, front, onFinish, onCancel }: {
  title: string; glyph: string; name: string; origin: DOMRect; front: ReactNode; onFinish: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const flipper = useRef<HTMLDivElement>(null);
  const finish = useRef(() => {});
  const cancel = useRef(() => {});
  useLayoutEffect(() => {
    const modal = dialog.current, card = face.current, flip = flipper.current;
    if (!modal || !card || !flip) return;
    let settled = false;
    const animations: Animation[] = [];
    let timeout: number | undefined;
    const settle = (open: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      for (const animation of animations) { animation.onfinish = null; animation.cancel(); }
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
    const start = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(1)`;
    const end = `translate(-50%, -50%) translate(0px, 0px) scale(${scale})`;
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
        animations.push(card.animate([{ transform: start }, { transform: end }], {
          duration: OPEN_MS, easing: 'cubic-bezier(.2,.65,.2,1)', fill: 'forwards',
        }));
        const spin = flip.animate(spinFrames, { duration: OPEN_MS, easing: 'linear', fill: 'forwards' });
        animations.push(spin);
        spin.onfinish = () => settle(true);
        // Covers unavailable animation events without leaving a stuck modal.
        timeout = window.setTimeout(() => settle(true), OPEN_MS + 300);
      } catch {
        for (const animation of animations) { animation.onfinish = null; animation.cancel(); }
        card.style.transform = end;
        flip.style.transform = spinFrames[spinFrames.length - 1].transform;
        timeout = window.setTimeout(() => settle(true), OPEN_MS);
      }
    }
    return () => {
      settled = true;
      window.clearTimeout(timeout);
      for (const animation of animations) { animation.onfinish = null; animation.cancel(); }
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
    <div ref={face} className="card-open-face" aria-hidden="true" style={{ width: origin.width, height: origin.height }}>
      <div ref={flipper} className="card-open-flipper">
        <div className="card-open-front">{front}</div>
        <div className="card-open-back">
          <span className="card-open-edition">封 印 藏 书</span>
          <span className="card-open-seal">{glyph}</span>
          <strong className="card-open-title">{title}</strong>
          <span className="card-open-name">{name}之牌</span>
        </div>
      </div>
    </div>
    <button type="button" className="card-open-cancel" autoFocus aria-label="取消打开网页"
      onClick={event => { event.stopPropagation(); cancel.current(); }}><X size={20} /></button>
    <p className="card-open-status">正在打开 {title} · 点击任意处直接打开</p>
  </dialog>, document.body);
}
