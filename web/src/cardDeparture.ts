/** One animation clock drives the flight, flip, fragments and final navigation. */
export const DEPARTURE_FLIP_MS = 340;
export const DEPARTURE_SCATTER_MS = 430;
export const DEPARTURE_STAGGER_MS = 65;
export const DEPARTURE_TOTAL_MS = DEPARTURE_FLIP_MS + DEPARTURE_SCATTER_MS + DEPARTURE_STAGGER_MS;

export function bookmarkTarget(url: string): string | undefined {
  try {
    const target = new URL(url);
    return target.protocol === "https:" || target.protocol === "http:" ? target.href : undefined;
  } catch { return undefined; }
}

/** Detach the new tab before giving it any external content; null means blocked. */
export function openBookmarkTab(url: string, host: Pick<Window, "open"> = window): boolean {
  const target = bookmarkTarget(url);
  if (!target) return false;
  let tab: Window | null = null;
  try {
    tab = host.open("about:blank", "_blank");
    if (!tab) return false;
    tab.opener = null;
    const referrer = tab.document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    tab.document.head.append(referrer);
    tab.location.replace(target);
    return true;
  } catch {
    tab?.close();
    return false;
  }
}

export type DepartureFrame = { phase: "flipping" | "shattering"; flip: number; scatterMs: number };
export function departureFrame(elapsed: number): DepartureFrame {
  return { phase: elapsed < DEPARTURE_FLIP_MS ? "flipping" : "shattering",
    flip: Math.min(1, Math.max(0, elapsed / DEPARTURE_FLIP_MS)),
    scatterMs: Math.max(0, elapsed - DEPARTURE_FLIP_MS) };
}

/** Finish only after drawing the last frame; cancellation leaves no late navigation. */
export function beginDeparture({ reducedMotion, onFrame, onFinish, clock = {
  request: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
  cancel: (id: number) => cancelAnimationFrame(id),
} }: {
  reducedMotion: boolean; onFrame: (frame: DepartureFrame) => void; onFinish: () => void;
  clock?: { request: (callback: FrameRequestCallback) => number; cancel: (id: number) => void };
}): () => void {
  let active = true, frame = 0;
  let start: number | undefined;
  const draw = (time: number) => {
    if (!active) return;
    start ??= time;
    const elapsed = time - start;
    onFrame(departureFrame(elapsed));
    if (!active) return;
    if (elapsed >= DEPARTURE_TOTAL_MS) { active = false; onFinish(); }
    else frame = clock.request(draw);
  };
  if (reducedMotion) { active = false; onFinish(); }
  else frame = clock.request(draw);
  return () => { active = false; clock.cancel(frame); };
}

type Point = [number, number];
const noise = (n: number) => { const value = Math.sin(n * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };

/** Shared vertices give 320 adjoining, fine triangles without missing pieces. */
export function createDepartureShards() {
  const columns = 8, rows = 20;
  const vertices: Point[][] = Array.from({ length: rows + 1 }, (_, y) => Array.from({ length: columns + 1 }, (_, x) => [
    x * 100 / columns + (x > 0 && x < columns ? (noise(y * 17 + x) - .5) * 100 / columns * .5 : 0),
    y * 100 / rows + (y > 0 && y < rows ? (noise(y * 19 + x + 73) - .5) * 100 / rows * .5 : 0),
  ]));
  const triangles: Point[][] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const a = vertices[y][x], b = vertices[y][x + 1], c = vertices[y + 1][x + 1], d = vertices[y + 1][x];
    triangles.push(...((x + y) % 2 ? [[a, b, d], [b, c, d]] : [[a, b, c], [a, c, d]]));
  }
  return triangles.map((points, index) => {
    const cx = points.reduce((sum, p) => sum + p[0], 0) / 3;
    const cy = points.reduce((sum, p) => sum + p[1], 0) / 3;
    const left = Math.min(...points.map(p => p[0])), top = Math.min(...points.map(p => p[1]));
    const width = Math.max(...points.map(p => p[0])) - left, height = Math.max(...points.map(p => p[1])) - top;
    return {
      points,
      bounds: { left, top, width, height },
      origin: `${(cx - left) / width * 100}% ${(cy - top) / height * 100}%`,
      clip: `polygon(${points.map(([x, y]) => `${((x - left) / width * 100).toFixed(3)}% ${((y - top) / height * 100).toFixed(3)}%`).join(",")})`,
      x: (cx - 50) * (1.6 + noise(index + 18)) + (noise(index + 301) - .5) * 36,
      y: (cy - 50) * (1.3 + noise(index + 42)) - 28 + (noise(index + 401) - .5) * 36,
      rotate: (noise(index + 87) - .5) * 100,
      tilt: (noise(index + 124) - .5) * 120,
      delay: Math.round(noise(index + 234) * DEPARTURE_STAGGER_MS),
    };
  });
}
