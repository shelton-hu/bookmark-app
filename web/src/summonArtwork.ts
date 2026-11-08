import type { SpiritPalette } from "./summonSequence";
import { restoredSpirits } from "./spiritArtwork";
import type { ArtWindow } from "./spiritArtwork";
import { summonImageSource } from "./summonAssetCache";

/** The illustration window inside every card face, as fractions of the card. */
export const ART_WINDOW = { x: .15, y: .09, w: .7, h: .72 };
export type Figure = { sharp: HTMLCanvasElement; glow: HTMLCanvasElement; window?: ArtWindow; retry?: boolean };
// Keep only the eight most recently used cards.
type Entry = { promise: Promise<Figure | null>; figure?: Figure; promote: () => void };
const figures = new Map<string, Entry>();
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

/** Background preparation yields again after decoding; a click promotes the same job. */
export function loadFigure(cardKey: string, palette: SpiritPalette, beforePrepare?: () => Promise<boolean>, signal?: AbortSignal): Promise<Figure | null> {
  const key = `${cardKey}:${palette.core}`;
  let entry = figures.get(key);
  if (!entry) {
    let urgent = !beforePrepare;
    let abandoned = false;
    let promote = () => {};
    const priority = new Promise<boolean>(resolve => { promote = () => { urgent = true; resolve(true); }; });
    const turn = async () => urgent || !beforePrepare || await Promise.race([beforePrepare(), priority]) || urgent;
    const decode = async (image: HTMLImageElement) => {
      let cancel = () => {};
      const interrupted = new Promise<never>((_, reject) => {
        cancel = () => {
          if (urgent) return;
          abandoned = true;
          if (figures.get(key) === entry) figures.delete(key);
          image.src = "";
          reject(new Error('Background artwork cancelled'));
        };
      });
      // A stalled download must not monopolize the one background preparation slot.
      const timeout = beforePrepare ? setTimeout(cancel, 8_000) : undefined;
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      try { await Promise.race([image.decode(), interrupted]); }
      finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
    };
    const art = new Image();
    const restored = restoredSpirits[cardKey];
    art.decoding = "async";
    art.fetchPriority = beforePrepare ? "low" : "high";
    const source = restored?.src ?? `/clow-deck/${cardKey}.webp`;
    art.dataset.summonSource = source;
    let releaseSource = () => {};
    const promise = summonImageSource(source, signal).then(async loaded => {
      releaseSource = loaded.release;
      art.src = loaded.url;
      await decode(art);
      if (!await turn()) return null;
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
      if (abandoned || !restored || !await turn()) return null;
      const original = new Image(); original.decoding = 'async'; original.src = `/clow-deck/${cardKey}.webp`;
      try {
        await decode(original);
        if (!await turn()) return null;
        const fallback = extractFigure(original, palette);
        return fallback ? { ...fallback, retry: true } : null;
      } catch { return null; }
    });
    entry = { promise, promote: () => { art.fetchPriority = "high"; promote(); } };
    const pending = entry;
    // Failed and fallback results must be retried on the next request.
    void promise.then(figure => {
      releaseSource();
      pending.promote = () => {};
      if (figure) pending.figure = figure;
      if ((!figure || figure.retry) && figures.get(key) === pending) figures.delete(key);
    });
  } else if (!beforePrepare) entry.promote();
  figures.delete(key);
  figures.set(key, entry);
  if (figures.size > 8) figures.delete(figures.keys().next().value!);
  return entry.promise;
}

export function preparedFigure(cardKey: string, palette: SpiritPalette): Figure | null {
  const key = `${cardKey}:${palette.core}`, entry = figures.get(key);
  if (entry?.figure) { figures.delete(key); figures.set(key, entry); }
  return entry?.figure ?? null;
}
