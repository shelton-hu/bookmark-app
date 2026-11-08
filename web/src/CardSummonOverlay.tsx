import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cardForBookmark } from "./clowDeck";
import { createBackTexture } from "./departureCanvas";
import { beginSummon, spiritPalette, summonFrame } from "./summonSequence";
import type { SpiritPalette, SummonFrame } from "./summonSequence";
import { restoredSpirits } from "./spiritArtwork";
import type { ArtWindow } from "./spiritArtwork";
import { CLOW_CIRCLE_ASSET, CLOW_CIRCLE_TURN_MS } from "./clowCircle";

const noise = (n: number) => { const value = Math.sin(n * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };

/** Motes start inside the card and curve into the spirit, each on its own delay. */
const motes = Array.from({ length: 220 }, (_, i) => ({
  x: noise(i + 1), y: noise(i + 501), delay: noise(i + 901) * .38,
  bend: (noise(i + 1301) - .5) * 1.6, size: .8 + noise(i + 1701) * 2.2,
}));
const sparks = Array.from({ length: 36 }, (_, i) => ({ angle: noise(i + 31) * Math.PI * 2, speed: .4 + noise(i + 77) * .9, radius: 1.3 + noise(i + 113) * 1.6, size: .6 + noise(i + 151) * 1.6 }));

/** The illustration window inside every card face, as fractions of the card. */
export const ART_WINDOW = { x: .15, y: .09, w: .7, h: .72 };
type Figure = { sharp: HTMLCanvasElement; glow: HTMLCanvasElement; window?: ArtWindow; retry?: boolean };
// Keep only the eight most recently used cards.
const figures = new Map<string, Promise<Figure | null>>();
const smoothstep = (a: number, b: number, v: number) => { const x = Math.min(1, Math.max(0, (v - a) / (b - a))); return x * x * (3 - 2 * x); };

/** Lift the light figure off the purple ground of this card's own illustration. */
function extractFigure(image: HTMLImageElement, palette: SpiritPalette): Figure | null {
  const sw = image.naturalWidth, sh = image.naturalHeight;
  const w = Math.round(sw * ART_WINDOW.w), h = Math.round(sh * ART_WINDOW.h);
  const sharp = document.createElement("canvas");
  sharp.width = w; sharp.height = h;
  const ctx = sharp.getContext("2d", { willReadFrequently: true });
  if (!ctx || !w || !h) return null;
  ctx.drawImage(image, Math.round(sw * ART_WINDOW.x), Math.round(sh * ART_WINDOW.y), w, h, 0, 0, w, h);
  let pixels: ImageData;
  try { pixels = ctx.getImageData(0, 0, w, h); } catch { return null; }
  const tint = [1, 3, 5].map((i) => parseInt(palette.core.slice(i, i + 2), 16));
  const data = pixels.data, featherX = w * .09, featherY = h * .05;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    // Cream line art is warm and light; the purple ground is cool and darker.
    // Gold frame and sun ornaments are strongly saturated; the line art is not.
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    const keep = smoothstep(.05, .2, (r + g) / 2 - b) * smoothstep(.42, .7, .3 * r + .59 * g + .11 * b) * (1 - smoothstep(.3, .45, saturation));
    const edge = Math.min(1, Math.min(x, w - 1 - x) / featherX, Math.min(y, h - 1 - y) / featherY);
    data[i] = Math.min(255, data[i] * .8 + tint[0] * .3);
    data[i + 1] = Math.min(255, data[i + 1] * .8 + tint[1] * .3);
    data[i + 2] = Math.min(255, data[i + 2] * .8 + tint[2] * .3);
    data[i + 3] = Math.round(255 * keep * edge);
  }
  ctx.putImageData(pixels, 0, 0);
  const glow = document.createElement("canvas");
  glow.width = w; glow.height = h;
  const blur = glow.getContext("2d");
  if (!blur) return null;
  blur.filter = `blur(${Math.max(4, w * .025)}px)`;
  blur.drawImage(sharp, 0, 0);
  return { sharp, glow };
}

function loadFigure(cardKey: string, palette: SpiritPalette): Promise<Figure | null> {
  const key = `${cardKey}:${palette.core}`;
  let result = figures.get(key);
  if (!result) {
    const art = new Image();
    const restored = restoredSpirits[cardKey];
    art.decoding = "async";
    art.src = restored?.src ?? `/clow-deck/${cardKey}.webp`;
    result = art.decode().then(() => {
      if (!restored) return extractFigure(art, palette);
      // Preserve all original colours, dark outlines and the authored alpha.
      const { crop } = restored;
      const sharp = document.createElement('canvas'); sharp.width = crop.w; sharp.height = crop.h;
      const ctx = sharp.getContext('2d'); if (!ctx) return null;
      ctx.drawImage(art, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
      const glow = document.createElement('canvas'); glow.width = crop.w; glow.height = crop.h;
      const blur = glow.getContext('2d'); if (!blur) return null;
      blur.filter = `blur(${Math.max(4, crop.w * .025)}px)`; blur.drawImage(sharp, 0, 0);
      return { sharp, glow, window: restored.placement };
    }).catch(async () => {
      if (!restored) return null;
      const original = new Image(); original.src = `/clow-deck/${cardKey}.webp`;
      try {
        await original.decode(); const fallback = extractFigure(original, palette);
        return fallback ? { ...fallback, retry: true } : null;
      } catch { return null; }
    });
    const pending = result;
    // A failed or unavailable image must be retried on the next summon.
    void pending.then(figure => { if ((!figure || figure.retry) && figures.get(key) === pending) figures.delete(key); });
  }
  figures.delete(key);
  figures.set(key, result);
  if (figures.size > 8) figures.delete(figures.keys().next().value!);
  return result;
}

type Stage = { width: number; height: number; cx: number; cy: number; cardW: number; cardH: number };

function spiritPosition(s: Stage, f: SummonFrame) {
  const risen = s.cy - s.cardH * .14 * f.emerge;
  return { x: s.cx, y: risen + (s.cy - risen) * f.rush };
}

/** An original light sprite: head, slender body, two pairs of beating wings and a swaying tail. */
function drawSprite(ctx: CanvasRenderingContext2D, u: number, form: number, time: number, palette: SpiritPalette, alpha: number) {
  const beat = Math.sin(time * 15);
  // Tail: a tapering ribbon that sways behind the body.
  ctx.lineCap = "round"; ctx.strokeStyle = palette.trail;
  let previous: [number, number] = [0, u * .42];
  for (let i = 1; i <= 26; i++) {
    const k = i / 26;
    const point: [number, number] = [Math.sin(time * 5 - i * .32) * u * .38 * k, u * (.42 + k * 1.7 * form)];
    ctx.globalAlpha = alpha * form * (1 - k) * .9;
    ctx.lineWidth = Math.max(.6, u * .13 * (1 - k));
    ctx.beginPath(); ctx.moveTo(previous[0], previous[1]); ctx.lineTo(point[0], point[1]); ctx.stroke();
    previous = point;
  }
  // Wings: upper pair long and raised, lower pair short; both beat, slightly out of phase.
  const wing = (length: number, width: number, angle: number) => {
    ctx.save();
    ctx.rotate(angle);
    const fill = ctx.createLinearGradient(0, 0, length, 0);
    fill.addColorStop(0, palette.core + "dd"); fill.addColorStop(.6, palette.trail + "66"); fill.addColorStop(1, palette.glow + "18");
    ctx.fillStyle = fill; ctx.strokeStyle = palette.trail; ctx.lineWidth = Math.max(.6, u * .025);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(length * .3, -width, length * .85, -width * .8, length, 0);
    ctx.bezierCurveTo(length * .8, width * .55, length * .3, width * .45, 0, 0);
    ctx.globalAlpha = alpha * form * .95; ctx.fill();
    ctx.globalAlpha = alpha * form * .8; ctx.stroke();
    ctx.globalAlpha = alpha * form * .45;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(length * .5, -width * .35, length * .92, -width * .05); ctx.stroke();
    ctx.restore();
  };
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    wing(u * 1.55 * form, u * .62, -.62 - beat * .38 * form);
    wing(u * 1.05 * form, u * .4, .38 + beat * .28 * form);
    ctx.restore();
  }
  // Body and head.
  const body = ctx.createRadialGradient(0, 0, 0, 0, 0, u * .55);
  body.addColorStop(0, "#ffffff"); body.addColorStop(.6, palette.core); body.addColorStop(1, palette.glow + "00");
  ctx.globalAlpha = alpha; ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -u * .3);
  ctx.bezierCurveTo(u * .2, -u * .22, u * .14, u * .3, 0, u * .5);
  ctx.bezierCurveTo(-u * .14, u * .3, -u * .2, -u * .22, 0, -u * .3);
  ctx.fill();
  const head = ctx.createRadialGradient(0, -u * .5, 0, 0, -u * .5, u * .26);
  head.addColorStop(0, "#ffffff"); head.addColorStop(.55, palette.core); head.addColorStop(1, palette.glow + "00");
  ctx.fillStyle = head;
  ctx.beginPath(); ctx.arc(0, -u * .5, u * .26, 0, Math.PI * 2); ctx.fill();
  // Two fine antennae with bright tips.
  ctx.strokeStyle = palette.trail; ctx.lineWidth = Math.max(.5, u * .025); ctx.globalAlpha = alpha * form;
  for (const side of [-1, 1]) {
    const sway = Math.sin(time * 3 + side) * u * .05;
    ctx.beginPath(); ctx.moveTo(side * u * .06, -u * .68);
    ctx.quadraticCurveTo(side * u * .12, -u * .95, side * u * .28 + sway, -u * 1.02); ctx.stroke();
    ctx.fillStyle = palette.core;
    ctx.beginPath(); ctx.arc(side * u * .28 + sway, -u * 1.02, Math.max(1, u * .045), 0, Math.PI * 2); ctx.fill();
  }
}

function figurePlacement(s: Stage, f: SummonFrame, window = ART_WINDOW) {
  const w = s.cardW * window.w, h = s.cardH * window.h;
  const homeX = s.cx - s.cardW / 2 + s.cardW * window.x + w / 2, homeY = s.cy - s.cardH / 2 + s.cardH * window.y + h / 2;
  const risenY = homeY - s.cardH * .17 * f.emerge;
  const breath = 1 + .015 * Math.sin(f.elapsed / 1000 * 3.4) * f.emerge;
  return { x: homeX, y: risenY + (s.cy - risenY) * f.rush, w, h, scale: (1 + .2 * f.emerge) * breath * (1 + 3 * f.rush * f.rush) };
}

function drawOver(ctx: CanvasRenderingContext2D, s: Stage, f: SummonFrame, palette: SpiritPalette, figure: Figure | null) {
  ctx.clearRect(0, 0, s.width, s.height);
  const time = f.elapsed / 1000, place = figurePlacement(s, f, figure?.window);
  const spirit = figure ? { x: place.x, y: place.y } : spiritPosition(s, f);
  const left = s.cx - s.cardW / 2, top = s.cy - s.cardH / 2;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // A soft plume of light lifts out of the card as it wakes.
  if (f.glow > 0 && f.rush < 1) {
    const plume = s.cardH * (.35 + .25 * f.glow), py = s.cy - s.cardH * .18;
    ctx.save();
    ctx.translate(s.cx, py); ctx.scale(.45, 1);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, plume);
    glow.addColorStop(0, palette.trail + "66"); glow.addColorStop(.5, palette.glow + "22"); glow.addColorStop(1, palette.glow + "00");
    ctx.globalAlpha = f.glow * (1 - f.dissolve);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, plume, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // The card breaks into motes that stream into the spirit.
  if (f.dissolve > 0) {
    ctx.fillStyle = palette.trail;
    for (const mote of motes) {
      const t = Math.min(1, Math.max(0, (f.dissolve - mote.delay) / .62));
      if (t <= 0 || t >= 1) continue;
      const sx = left + mote.x * s.cardW, sy = top + mote.y * s.cardH;
      const k = t * t, mx = (sx + spirit.x) / 2 + mote.bend * s.cardW * .5, my = (sy + spirit.y) / 2;
      const x = (1 - k) * (1 - k) * sx + 2 * (1 - k) * k * mx + k * k * spirit.x;
      const y = (1 - k) * (1 - k) * sy + 2 * (1 - k) * k * my + k * k * spirit.y;
      ctx.globalAlpha = Math.sin(Math.PI * t);
      ctx.beginPath(); ctx.arc(x, y, mote.size * 1.3 * (1 - .5 * t), 0, Math.PI * 2); ctx.fill();
    }
  }
  // The card's own creature lifts out of its illustration, glowing.
  if (figure && f.emerge > 0) {
    const w = place.w * place.scale, h = place.h * place.scale, x = place.x - w / 2, y = place.y - h / 2;
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) * .7);
    halo.addColorStop(0, palette.glow + "55"); halo.addColorStop(1, palette.glow + "00");
    ctx.save();
    ctx.translate(place.x, place.y); ctx.scale(w / h, 1);
    ctx.globalAlpha = f.emerge * .8; ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, Math.max(w, h) * .7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = f.emerge * .55;
    ctx.drawImage(figure.glow, x - w * .03, y - h * .03, w * 1.06, h * 1.06);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = f.emerge;
    ctx.drawImage(figure.sharp, x, y, w, h);
    ctx.globalCompositeOperation = "lighter";
    for (const spark of sparks) {
      const life = (time * spark.speed + spark.angle) % 1;
      const sx = place.x + Math.cos(spark.angle * 7) * w * .42, sy = place.y + (Math.sin(spark.angle * 5) * .45 - life * .25) * h;
      ctx.globalAlpha = f.emerge * Math.sin(Math.PI * life) * .9;
      ctx.fillStyle = palette.core;
      ctx.beginPath(); ctx.arc(sx, sy, spark.size * 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Fallback while the artwork is unavailable: a ball of light that unfolds into a winged sprite.
  if (!figure && f.emerge > 0) {
    const r = s.cardW * .27 * (.3 + .7 * f.emerge) * (1 + 10 * f.rush);
    const form = Math.min(1, Math.max(0, (f.emerge - .3) / .7));
    const bob = Math.sin(time * 4.2) * r * .06 * (1 - f.rush);
    const halo = ctx.createRadialGradient(spirit.x, spirit.y, 0, spirit.x, spirit.y, r * 3.2);
    halo.addColorStop(0, palette.glow + "99"); halo.addColorStop(.4, palette.glow + "2a"); halo.addColorStop(1, palette.glow + "00");
    ctx.globalAlpha = f.emerge; ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(spirit.x, spirit.y, r * 3.2, 0, Math.PI * 2); ctx.fill();
    for (const spark of sparks) {
      const d = r * (spark.radius + ((time * spark.speed) % 1) * 1.2), a = spark.angle + time * spark.speed;
      ctx.globalAlpha = f.emerge * (1 - ((time * spark.speed) % 1)) * .8;
      ctx.fillStyle = palette.core;
      ctx.beginPath(); ctx.arc(spirit.x + Math.cos(a) * d, spirit.y + Math.sin(a) * d, spark.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.translate(spirit.x, spirit.y + bob);
    if (form > 0) drawSprite(ctx, r, form, time, palette, f.emerge);
    ctx.restore();
    // The ball of light it starts as fades while the body takes shape.
    const orb = ctx.createRadialGradient(spirit.x, spirit.y, 0, spirit.x, spirit.y, r * 1.1);
    orb.addColorStop(0, "#ffffff"); orb.addColorStop(.45, palette.core); orb.addColorStop(1, palette.glow + "00");
    ctx.globalAlpha = f.emerge * (1 - form * .85); ctx.fillStyle = orb;
    ctx.beginPath(); ctx.arc(spirit.x, spirit.y, r * 1.1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // Closing flash hands off to the website.
  if (f.flash > 0) {
    const reach = Math.hypot(s.width, s.height);
    const flash = ctx.createRadialGradient(spirit.x, spirit.y, 0, spirit.x, spirit.y, reach * (.2 + .8 * f.flash));
    flash.addColorStop(0, "#ffffff"); flash.addColorStop(.5, palette.core); flash.addColorStop(1, palette.core + "00");
    ctx.globalAlpha = Math.min(1, f.flash * 1.15);
    ctx.fillStyle = flash; ctx.fillRect(0, 0, s.width, s.height);
    ctx.globalAlpha = Math.max(0, f.flash - .6) / .4;
    ctx.fillStyle = "#fffaf0"; ctx.fillRect(0, 0, s.width, s.height);
    ctx.globalAlpha = 1;
  }
}

/** A temporary copy is summoned; the real card and its layout slot never move. */
export default function CardSummon({ bookmarkId, title, origin, front, onFinish, onCancel }: {
  bookmarkId: number; title: string; origin: DOMRect; front: ReactNode; onFinish: () => void; onCancel: () => void;
}) {
  const restored = restoredSpirits[cardForBookmark(bookmarkId).key];
  const artworkWindow = { ...ART_WINDOW, h: Math.max(ART_WINDOW.h, restored ? restored.placement.y + restored.placement.h - ART_WINDOW.y : 0) };
  const modal = useRef<HTMLDialogElement>(null);
  const flight = useRef<HTMLDivElement>(null);
  const flipper = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLCanvasElement>(null);
  const light = useRef<HTMLDivElement>(null);
  const hollow = useRef<HTMLDivElement>(null);
  const ground = useRef<HTMLDivElement>(null);
  const circle = useRef<HTMLImageElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const stop = useRef<() => void>(() => {});
  const settled = useRef(false);
  const finishRef = useRef<() => void>(() => {});
  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    stop.current();
    onCancel();
  };
  useLayoutEffect(() => {
    const dialog = modal.current, element = flight.current, flip = flipper.current, backCanvas = back.current;
    const wash = light.current, hollowEl = hollow.current, groundPlane = ground.current, circleImage = circle.current, overCanvas = over.current;
    if (!dialog || !element || !flip || !backCanvas || !wash || !hollowEl || !groundPlane || !circleImage || !overCanvas) return;
    settled.current = false;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const card = cardForBookmark(bookmarkId), palette = spiritPalette(card.key);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const cardW = element.offsetWidth, cardH = element.offsetHeight;
    const circleSize = Math.min(cardH * 1.28, window.innerWidth - 32);
    // The upright card stands at the centre of the floor circle. Reserve room
    // below its baseline for the front half of the projected disc and controls.
    const baseline = window.innerHeight - 56 - circleSize * .18;
    const stage: Stage = { width: window.innerWidth, height: window.innerHeight, cx: window.innerWidth / 2, cy: baseline - cardH / 2, cardW, cardH };
    element.style.top = `${stage.cy}px`;
    overCanvas.width = Math.ceil(stage.width * ratio); overCanvas.height = Math.ceil(stage.height * ratio);
    const overCtx = overCanvas.getContext("2d");
    overCtx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    // Keep the fixed floor projection separate from the artwork's in-plane turn.
    groundPlane.style.width = `${circleSize}px`;
    groundPlane.style.height = `${circleSize}px`;
    groundPlane.style.top = `${baseline}px`;
    const texture = createBackTexture(cardW, cardH, ratio, title, card.glyph, card.name);
    const backCtx = backCanvas.getContext("2d");
    if (texture && backCtx) { backCanvas.width = texture.width; backCanvas.height = texture.height; backCtx.drawImage(texture, 0, 0); }
    const x = origin.left + origin.width / 2 - stage.cx, y = origin.top + origin.height / 2 - stage.cy;
    const scale = origin.width / cardW;
    let figure: Figure | null = null;
    void loadFigure(card.key, palette).then(loaded => {
      if (!settled.current) { figure = loaded; dialog.dataset.artwork = loaded?.window ? 'restored' : 'extracted'; }
    });
    const faces = [flip.firstElementChild, backCanvas].filter((face): face is HTMLElement => face instanceof HTMLElement);
    const render = (f: SummonFrame) => {
      const travel = f.travel, size = scale + (1 - scale) * travel;
      // Let the card shrink into light around its foot, keeping it on the seal.
      const dissolveDrop = cardH * size * .03 * f.dissolve;
      element.style.transform = `translate(-50%, -50%) translate(${x * (1 - travel)}px, ${y * (1 - travel) + dissolveDrop}px) scale(${size * (1 - .06 * f.dissolve)})`;
      element.style.opacity = String(1 - f.dissolve ** 1.5);
      flip.style.transform = `translateZ(${f.lift * 90}px) rotateX(${f.lift * 8}deg) rotateY(${f.spin}deg)`;
      const edge = Math.abs(Math.sin(f.spin * Math.PI / 180));
      const awake = f.glow * (1 - f.empty);
      const shade = `brightness(${(1 - .4 * edge) * (1 + .45 * awake) * (1 - .2 * f.empty)}) saturate(${1 - .3 * f.empty})`;
      const shadow = `0 0 ${10 + 40 * awake}px ${awake * 6}px ${palette.glow}${Math.round(awake * 160).toString(16).padStart(2, "0")}, 0 ${10 + f.lift * 30}px ${20 + f.lift * 40}px #0d061866`;
      for (const face of faces) { face.style.filter = shade; face.style.boxShadow = shadow; }
      // Light gathers in the artwork as it wakes, then leaves with the spirit.
      wash.style.opacity = String(awake * .55);
      wash.style.background = `radial-gradient(ellipse at 50% 40%, #ffffff, ${palette.glow}88 55%, transparent 80%)`;
      hollowEl.style.opacity = String(f.empty * .94);
      const circleScale = (.5 + .14 * f.circle) / .64;
      circleImage.style.transform = `scale(${circleScale}) rotate(${f.elapsed / CLOW_CIRCLE_TURN_MS * 360}deg)`;
      circleImage.style.opacity = String(f.circle * (.55 + .17 * f.glow));
      if (overCtx) drawOver(overCtx, stage, f, palette, figure);
      dialog.classList.toggle("is-flashing", f.flash > 0);
    };
    render(summonFrame(0));
    const finish = () => {
      if (settled.current) return;
      settled.current = true;
      stop.current();
      dialog.close();
      onFinish();
    };
    finishRef.current = finish;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const frame = requestAnimationFrame(() => {
      stop.current = beginSummon({ reducedMotion: motion.matches || !overCtx, onFrame: render, onFinish: finish });
    });
    const hidden = () => { if (document.hidden) cancel(); };
    const reduce = () => { if (motion.matches) finish(); };
    motion.addEventListener("change", reduce);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      settled.current = true;
      cancelAnimationFrame(frame); stop.current();
      motion.removeEventListener("change", reduce);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cancel);
      window.removeEventListener("resize", cancel);
      document.body.style.overflow = overflow;
      dialog.close();
    };
  }, []);
  return createPortal(<dialog ref={modal} className="clow-summon" aria-label={`召唤 ${title}`}
    onCancel={event => { event.preventDefault(); cancel(); }}
    // Clicking anywhere but the close button skips straight to the website.
    onClick={event => { event.stopPropagation(); finishRef.current(); }}
    onPointerMove={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <div ref={ground} className="clow-summon-ground" aria-hidden="true">
      <img ref={circle} className="clow-summon-circle" src={CLOW_CIRCLE_ASSET} width="788" height="788" alt="" draggable={false} />
    </div>
    <div ref={flight} className="clow-summon-flight" aria-hidden="true">
      <div ref={flipper} className="clow-summon-flipper">
        <div className="clow-summon-front">{front}<div ref={hollow} className="clow-summon-hollow" style={{ left: `${artworkWindow.x * 100}%`, top: `${artworkWindow.y * 100}%`, width: `${artworkWindow.w * 100}%`, height: `${artworkWindow.h * 100}%` }} /><div ref={light} className="clow-summon-wash" /></div>
        <canvas ref={back} className="clow-summon-back" />
      </div>
    </div>
    <canvas ref={over} className="clow-summon-layer" aria-hidden="true" />
    <button className="clow-summon-cancel" autoFocus onClick={event => { event.stopPropagation(); cancel(); }} aria-label="取消打开网页"><X size={20} /></button>
    <p className="clow-summon-status" role="status">正在召唤 {title} · 点击任意处直接打开</p>
  </dialog>, document.body);
}
