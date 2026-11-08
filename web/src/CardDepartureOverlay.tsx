import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cardForBookmark } from "./clowDeck";
import { beginDeparture } from "./cardDeparture";
import { createBackTexture, prepareShatter } from "./departureCanvas";

/** A temporary copy breaks apart; the real card and its layout slot never move. */
export default function CardDeparture({ bookmarkId, title, origin, front, onFinish, onCancel }: {
  bookmarkId: number; title: string; origin: DOMRect; front: ReactNode; onFinish: () => void; onCancel: () => void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const flight = useRef<HTMLDivElement>(null);
  const flipper = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLCanvasElement>(null);
  const fragments = useRef<HTMLCanvasElement>(null);
  const cancelSequence = useRef<() => void>(() => {});
  const settled = useRef(false);
  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    cancelSequence.current();
    onCancel();
  };
  useLayoutEffect(() => {
    const dialog = modal.current, element = flight.current, flip = flipper.current;
    const backCanvas = back.current, shardCanvas = fragments.current;
    if (!dialog || !element || !flip || !backCanvas || !shardCanvas) return;
    settled.current = false;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const width = element.offsetWidth, height = element.offsetHeight;
    const x = origin.left + origin.width / 2 - window.innerWidth / 2;
    const y = origin.top + origin.height / 2 - window.innerHeight / 2;
    const scale = origin.width / width;
    element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
    const card = cardForBookmark(bookmarkId), ratio = Math.min(window.devicePixelRatio || 1, 2);
    const texture = createBackTexture(width, height, ratio, title, card.glyph, card.name);
    const paint = texture && prepareShatter(shardCanvas, texture, width, height, ratio);
    const backContext = backCanvas.getContext("2d");
    const faces = [flip.firstElementChild, backCanvas].filter((face): face is HTMLElement => face instanceof HTMLElement);
    const finish = () => {
      if (settled.current) return;
      settled.current = true;
      dialog.close();
      onFinish();
    };
    let frame = requestAnimationFrame(() => {
      // Canvas unavailable: finish the visit without visual effects.
      if (!texture || !paint || !backContext) { finish(); return; }
      backCanvas.width = texture.width; backCanvas.height = texture.height;
      backContext.drawImage(texture, 0, 0);
      cancelSequence.current = beginDeparture({
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        onFrame: ({ flip: progress, phase, scatterMs }) => {
          // Travel leads, the turn follows slightly behind, and the card lifts toward the viewer mid-turn.
          const travel = 1 - Math.pow(1 - progress, 3);
          const lag = Math.min(1, Math.max(0, (progress - .08) / .92));
          // Ease in, swing a few degrees past the back, then settle: the card lands rather than stops.
          const u = lag ** 1.6 - 1, overshoot = 1.15;
          const turn = 1 + (overshoot + 1) * u ** 3 + overshoot * u ** 2;
          const lift = Math.sin(Math.PI * Math.min(1, turn));
          element.style.transform = `translate(-50%, -50%) translate(${x * (1 - travel)}px, ${y * (1 - travel)}px) scale(${scale + (1 - scale) * travel})`;
          flip.style.transform = `translateZ(${lift * 70}px) rotateX(${lift * 7}deg) rotateZ(${lift * -2.5}deg) rotateY(${turn * 180}deg)`;
          // The face turning away dims and the back brightens as it meets the light.
          const shade = `brightness(${1 - .42 * lift})`;
          const shadow = `0 ${8 + lift * 26}px ${18 + lift * 40}px #0d061866`;
          for (const face of faces) { face.style.filter = shade; face.style.boxShadow = face === backCanvas ? shadow : `1px 1px #ae8a56, ${shadow}`; }
          if (phase === "shattering") {
            if (!dialog.classList.contains("is-shattering")) dialog.classList.add("is-shattering");
            paint(scatterMs);
            flip.style.visibility = "hidden";
            shardCanvas.style.visibility = "visible";
          }
        },
        onFinish: finish,
      });
    });
    const hidden = () => { if (document.hidden) cancel(); };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (motion.matches) { cancelSequence.current(); finish(); } };
    motion.addEventListener("change", reduce);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      settled.current = true;
      cancelAnimationFrame(frame); cancelSequence.current();
      motion.removeEventListener("change", reduce);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cancel);
      window.removeEventListener("resize", cancel);
      document.body.style.overflow = overflow;
      dialog.close();
    };
  }, []);
  return createPortal(<dialog ref={modal} className="clow-departure" aria-label={`打开 ${title}`}
    onCancel={event => { event.preventDefault(); cancel(); }}
    onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) cancel(); }}
    onPointerMove={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <button className="clow-departure-cancel" autoFocus onClick={cancel} aria-label="取消打开网页"><X size={20} /></button>
    <div ref={flight} className="clow-departure-flight" aria-hidden="true">
      <div ref={flipper} className="clow-departure-flipper">
        <div className="clow-departure-front">{front}</div>
        <canvas ref={back} className="clow-departure-back" />
      </div>
      <canvas ref={fragments} className="clow-shards" />
    </div>
    <p className="clow-departure-status" role="status">正在打开 {title}</p>
  </dialog>, document.body);
}
