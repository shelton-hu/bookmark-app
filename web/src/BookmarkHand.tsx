import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type HandPosition = { index: number; count: number; activeIndex: number | null; centerIndex?: number };

/** Input rank stays in reading/Tab order; visual slots expand center, left, right. */
export function rankToHandSlot(rank: number, count: number): number {
  const center = Math.floor(count / 2);
  return center + (rank % 2 ? -Math.ceil(rank / 2) : rank / 2);
}

/** Stable slots own pointer targeting; only the card faces move. */
export function BookmarkHand<T extends { id: number }>({ items, children }: {
  items: T[];
  children: (item: T, hand: HandPosition) => ReactNode;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const firstSlot = rankToHandSlot(0, items.length);
  const lastSlot = rankToHandSlot(Math.max(0, items.length - 1), items.length);
  const [centerIndex, setCenterIndex] = useState(firstSlot);
  const railId = useId();
  const railRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: NaN, y: NaN });
  const pointerDown = useRef(false);
  const activeIndex = hovered ?? focused;
  const identity = items.map((item) => item.id).join(",");
  const scrollBehavior = (): ScrollBehavior => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  useLayoutEffect(() => {
    const rail = railRef.current;
    const hand = handRef.current;
    if (!rail || !hand) return;
    setHovered(null);
    setFocused(null);
    const geometry = () => {
      const step = hand.firstElementChild?.getBoundingClientRect().width ?? 0;
      const width = hand.querySelector<HTMLElement>(".hand-card")?.offsetWidth ?? step;
      const viewportCenter = rail.getBoundingClientRect().left + rail.clientLeft + rail.clientWidth / 2;
      return { step, width, viewportCenter, start: hand.getBoundingClientRect().left };
    };
    let visibleCenter = firstSlot;
    const align = (index: number) => {
      const { start, step, width, viewportCenter } = geometry();
      rail.scrollTo({ left: rail.scrollLeft + start + index * step + width / 2 - viewportCenter, behavior: "instant" });
    };
    align(firstSlot);
    const updateEdges = () => {
      const left = rail.scrollLeft > 1;
      const right = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1;
      setEdges((previous) => previous.left === left && previous.right === right ? previous : { left, right });
      const { step, width, viewportCenter, start } = geometry();
      if (step) {
        visibleCenter = Math.max(0, Math.min(items.length - 1, Math.round((viewportCenter - start - width / 2) / step)));
        setCenterIndex(visibleCenter);
      }
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail.clientWidth : 1);
      const next = Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, rail.scrollLeft + delta));
      if (Math.abs(next - rail.scrollLeft) < 1) return;
      event.preventDefault();
      rail.scrollLeft = next;
    };
    const observer = new ResizeObserver(() => { align(visibleCenter); updateEdges(); });
    observer.observe(rail);
    if (handRef.current) observer.observe(handRef.current);
    rail.addEventListener("scroll", updateEdges, { passive: true });
    rail.addEventListener("wheel", wheel, { passive: false });
    updateEdges();
    return () => {
      observer.disconnect();
      rail.removeEventListener("scroll", updateEdges);
      rail.removeEventListener("wheel", wheel);
    };
  }, [identity]);
  useEffect(() => {
    const settle = () => setHovered(null);
    const keyboard = () => { pointerDown.current = false; };
    const resetPose = () => { setHovered(null); setFocused(null); pointer.current = { x: NaN, y: NaN }; };
    window.addEventListener("bookmark-hand-settle", resetPose);
    window.addEventListener("keydown", keyboard, true);
    window.addEventListener("scroll", settle, { capture: true, passive: true });
    window.addEventListener("blur", settle);
    return () => {
      window.removeEventListener("bookmark-hand-settle", resetPose);
      window.removeEventListener("keydown", keyboard, true);
      window.removeEventListener("scroll", settle, true);
      window.removeEventListener("blur", settle);
    };
  }, []);

  const scroll = (direction: number) => {
    const rail = railRef.current;
    if (!rail) return;
    setHovered(null);
    setFocused(null);
    rail.scrollBy({ left: direction * Math.max(200, rail.clientWidth * .75), behavior: scrollBehavior() });
  };
  const focusCard = (index: number) => {
    const slot = handRef.current?.querySelector<HTMLElement>(`[data-hand-slot="${index}"]`);
    slot?.querySelector<HTMLButtonElement>(".clow-art")?.focus({ preventScroll: true });
    const rail = railRef.current;
    const card = slot?.querySelector<HTMLElement>(".hand-card");
    if (slot && rail) rail.scrollBy({
      left: slot.getBoundingClientRect().left + (card?.offsetWidth ?? slot.offsetWidth) / 2
        - rail.getBoundingClientRect().left - rail.clientLeft - rail.clientWidth / 2,
      behavior: scrollBehavior(),
    });
    setHovered(null);
    setFocused(index);
  };

  return <section className="hand-section" aria-label="连续书签牌列">
    <div className="hand-caption">
      <span>全部 {items.length} 张 · 左右滑动浏览</span>
      <div className="hand-navigation" role="group" aria-label="牌列导航">
        <button type="button" aria-label="跳到第一张书签" aria-controls={railId} disabled={!items.length || (activeIndex ?? centerIndex) === firstSlot} onClick={() => focusCard(firstSlot)}>首张</button>
        <button type="button" aria-label="向左浏览书签" aria-controls={railId} disabled={!edges.left} onClick={() => scroll(-1)}><ChevronLeft size={18} /></button>
        <button type="button" aria-label="向右浏览书签" aria-controls={railId} disabled={!edges.right} onClick={() => scroll(1)}><ChevronRight size={18} /></button>
        <button type="button" aria-label="跳到最后一张书签" aria-controls={railId} disabled={!items.length || (activeIndex ?? centerIndex) === lastSlot} onClick={() => focusCard(lastSlot)}>末张</button>
      </div>
    </div>
    <div ref={railRef} id={railId} className="hand-rail" tabIndex={0} role="region" aria-label="书签牌列，可左右滑动或使用左右方向键，Home 到首张，End 到末张"
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse" || event.buttons) return;
        if (pointer.current.x === event.clientX && pointer.current.y === event.clientY) return;
        pointer.current = { x: event.clientX, y: event.clientY };
        setFocused(null);
        const bounds = handRef.current?.getBoundingClientRect();
        const step = handRef.current?.firstElementChild?.getBoundingClientRect().width;
        if (!bounds || !step) return;
        const face = (event.target as HTMLElement).closest<HTMLElement>(".hand-card");
        if (event.clientY < bounds.top) {
          setHovered(face ? Number(face.dataset.handIndex) : null);
          return;
        }
        if (event.clientY > bounds.bottom || (!face && (event.clientX < bounds.left || event.clientX > bounds.right))) {
          setHovered(null);
          return;
        }
        const width = handRef.current?.querySelector<HTMLElement>(".hand-card")?.offsetWidth ?? step;
        const x = event.clientX - bounds.left;
        // Center exposes its whole face; neighbors expose their outer edges.
        // Hit regions stay fixed while the faces lift and shift.
        const index = x < centerIndex * step ? Math.floor(x / step)
          : x > centerIndex * step + width ? Math.ceil((x - width) / step) : centerIndex;
        setHovered(Math.max(0, Math.min(items.length - 1, index)));
      }}
      onPointerLeave={() => { setHovered(null); pointer.current = { x: NaN, y: NaN }; }}
      onPointerDownCapture={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        pointerDown.current = true;
        setFocused(null);
        if (event.pointerType !== "mouse") setHovered(null);
      }}
      onKeyDownCapture={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        pointerDown.current = false;
        const slot = (event.target as HTMLElement).closest<HTMLElement>("[data-hand-slot]");
        const index = slot ? Number(slot.dataset.handSlot) : activeIndex ?? centerIndex;
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && !event.altKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          const next = event.key === "Home" ? firstSlot : event.key === "End" ? lastSlot
            : index === null ? 0 : index + (event.key === "ArrowRight" ? 1 : -1);
          focusCard(Math.max(0, Math.min(items.length - 1, next)));
        } else if (event.key === "Escape") { setHovered(null); setFocused(null); }
        else if (slot) setFocused(Number(slot.dataset.handSlot));
      }}
      onFocusCapture={(event) => {
        if (pointerDown.current) return;
        const slot = (event.target as HTMLElement).closest<HTMLElement>("[data-hand-slot]");
        if (slot) { setHovered(null); setFocused(Number(slot.dataset.handSlot)); }
      }}
      onBlurCapture={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(null);
      }}>
      <div ref={handRef} className="bookmark-hand" data-active-index={activeIndex ?? ""} data-center-index={centerIndex}
        style={{ "--hand-count": items.length } as CSSProperties}>
        {items.map((item, rank) => {
          const index = rankToHandSlot(rank, items.length);
          return <div className="hand-slot" data-hand-slot={index} data-bookmark-rank={rank + 1}
            style={{ gridColumn: index + 1, gridRow: 1 }} key={item.id}>
            {children(item, { index, count: items.length, activeIndex, centerIndex })}
          </div>;
        })}
      </div>
    </div>
  </section>;
}

export function handPose({ index, count, activeIndex, centerIndex = Math.floor(count / 2) }: HandPosition, selected: boolean): CSSProperties {
  const active = index === activeIndex;
  const distance = activeIndex === null ? 0 : index - activeIndex;
  const proximity = distance ? Math.max(0, 1 - (Math.abs(distance) - 1) * 0.18) : 0;
  const fromCenter = index - centerIndex;
  const priority = Math.abs(fromCenter) * 2 - (fromCenter < 0 ? 1 : 0);
  const order = count * 2 - priority;
  return {
    "--hand-x": `${Math.sign(distance) * 42 * proximity}px`,
    "--hand-y": `${active ? (selected ? -80 : -72) : selected ? -32 : 0}px`,
    "--hand-angle": "0deg",
    "--hand-scale": active ? (selected ? 1.1 : 1.08) : selected ? 1.03 : 1,
    "--hand-order": active ? count * 4 + 1 : selected ? count * 2 + order : order,
  } as CSSProperties;
}
