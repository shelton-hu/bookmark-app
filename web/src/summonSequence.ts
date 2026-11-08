/**
 * Summoning a card: it rises and spins to rest on its face, a magic circle wakes, the
 * card's light leaves the artwork and gathers into a spirit, the card scatters into
 * motes, and the spirit rushes the viewer in a flash that hands off to the website.
 * One clock drives every layer, so a late frame can never desynchronise them.
 */
export const SUMMON_TOTAL_MS = 1800;
/** Two full turns: the spin always comes to rest on the card's face. */
export const SUMMON_TURNS = 2;

export type SummonFrame = {
  elapsed: number;
  /** 0..1 travel from the card's slot to the centre of the screen. */
  travel: number;
  /** Rotation in degrees; ends at a whole number of turns (face forward). */
  spin: number;
  /** 0..1 lift toward the viewer while turning; back to 0 when the card settles. */
  lift: number;
  /** 0..1 the magic circle projected onto the floor beneath the spirit. */
  circle: number;
  /** 0..1 light rising in the card before the spirit leaves it. */
  glow: number;
  /** 0..1 the artwork dims and greys: the spirit has left the card. */
  empty: number;
  /** 0..1 the spirit rising out of the card and taking shape. */
  emerge: number;
  /** 0..1 the card breaking into motes that stream into the spirit. */
  dissolve: number;
  /** 0..1 the spirit rushing toward the viewer. */
  rush: number;
  /** 0..1 the closing flash. */
  flash: number;
};

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const span = (time: number, start: number, end: number) => clamp((time - start) / (end - start));
export const easeOut = (x: number, power = 3) => 1 - Math.pow(1 - clamp(x), power);
export const easeInOut = (x: number) => { const v = clamp(x); return v < .5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2; };
export const easeIn = (x: number, power = 2) => Math.pow(clamp(x), power);

export function summonFrame(time: number): SummonFrame {
  const t = Math.min(SUMMON_TOTAL_MS, Math.max(0, time));
  const turning = span(t, 0, 820);
  const circleIn = easeOut(span(t, 120, 620));
  const circleOut = easeIn(span(t, 1380, 1700));
  return {
    elapsed: t,
    travel: easeOut(span(t, 0, 480)),
    // Fast start, long deceleration: the card is thrown, then settles on its face.
    spin: easeOut(turning, 4) * SUMMON_TURNS * 360,
    lift: Math.sin(Math.PI * easeOut(turning, 2)),
    circle: circleIn * (1 - circleOut),
    glow: easeInOut(span(t, 460, 800)),
    empty: easeInOut(span(t, 760, 1120)),
    emerge: easeOut(span(t, 720, 1260), 3),
    dissolve: easeInOut(span(t, 1100, 1500)),
    rush: easeIn(span(t, 1380, SUMMON_TOTAL_MS), 2.4),
    flash: easeIn(span(t, 1540, SUMMON_TOTAL_MS), 1.6),
  };
}

/** Finish only after drawing the last frame; cancelling leaves no late navigation. */
export function beginSummon({ reducedMotion, onFrame, onFinish, clock = {
  request: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
  cancel: (id: number) => cancelAnimationFrame(id),
} }: {
  reducedMotion: boolean; onFrame: (frame: SummonFrame) => void; onFinish: () => void;
  clock?: { request: (callback: FrameRequestCallback) => number; cancel: (id: number) => void };
}): () => void {
  let active = true, frame = 0;
  let start: number | undefined;
  const draw = (time: number) => {
    if (!active) return;
    start ??= time;
    const elapsed = time - start;
    onFrame(summonFrame(elapsed));
    if (!active) return;
    if (elapsed >= SUMMON_TOTAL_MS) { active = false; onFinish(); }
    else frame = clock.request(draw);
  };
  if (reducedMotion) { active = false; onFinish(); }
  else frame = clock.request(draw);
  return () => { active = false; clock.cancel(frame); };
}

/** Each card's spirit takes the colour of its element. */
export type SpiritPalette = { core: string; glow: string; trail: string };
const palettes: Record<string, SpiritPalette> = {
  fire: { core: "#fff4e0", glow: "#ff8a3d", trail: "#ffc46b" },
  water: { core: "#eefaff", glow: "#4fb3ff", trail: "#9fe0ff" },
  wind: { core: "#f1fff8", glow: "#45d6a8", trail: "#b5f5dc" },
  thunder: { core: "#fffde8", glow: "#ffd23f", trail: "#fff08a" },
  light: { core: "#fffaf0", glow: "#f5c76b", trail: "#ffe7ad" },
  dark: { core: "#f6eeff", glow: "#9a6cff", trail: "#cdb5ff" },
  earth: { core: "#fbf7ea", glow: "#b6a05a", trail: "#e3d49b" },
  bloom: { core: "#fff3f8", glow: "#ff7fb8", trail: "#ffc2dd" },
};
const elements: Record<string, keyof typeof palettes> = {
  firey: "fire", power: "fire", fight: "fire", shot: "fire", dash: "fire", arrow: "fire", sword: "fire",
  watery: "water", rain: "water", wave: "water", bubbles: "water", freeze: "water", snow: "water", mist: "water", cloud: "water",
  windy: "wind", fly: "wind", float: "wind", storm: "wind", jump: "wind", move: "wind", wood: "wind",
  thunder: "thunder", glow: "thunder",
  light: "light", create: "light", big: "light", little: "light", twin: "light", libra: "light", return: "light", time: "light",
  shadow: "dark", dark: "dark", silent: "dark", sleep: "dark", illusion: "dark", erase: "dark", maze: "dark", loop: "dark",
  mirror: "dark", change: "dark", through: "dark", lock: "dark", dream: "dark",
  earthy: "earth", sand: "earth", shield: "earth",
  flower: "bloom", sweet: "bloom", song: "bloom", voice: "bloom",
};
export function spiritPalette(cardKey: string): SpiritPalette {
  return palettes[elements[cardKey] ?? "light"];
}
