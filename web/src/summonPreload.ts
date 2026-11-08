import { cardForBookmark, clowDeck } from "./clowDeck";
import { CLOW_CIRCLE_ASSET } from "./clowCircle";
import { restoredSpirits } from "./spiritArtwork";
import { loadFigure, preparedFigure } from "./summonArtwork";
import { spiritPalette } from "./summonSequence";
import { downloadSummonAsset, pruneSummonAssets, removeSummonAssets } from "./summonAssetCache";

// Versioned source files use browser storage; only artwork cache retains decoded textures.
const downloaded = new Set<string>();
const listeners = new Set<() => void>();
let playing = 0;
const assets = [...Object.values(restoredSpirits).map(art => art.src), ...clowDeck.map(card => `/clow-deck/${card.key}.webp`), CLOW_CIRCLE_ASSET];
export type SummonPreloadState = { phase: 'loading' | 'ready' | 'error' | 'skipped'; completed: number; total: number; failed: number; prepared: number };
export const INITIAL_SUMMON_PRELOAD: SummonPreloadState = { phase: 'loading', completed: 0, total: assets.length, failed: 0, prepared: 0 };

export function suspendSummonPreload(): () => void {
  playing++;
  listeners.forEach(notify => notify());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    playing--;
    listeners.forEach(notify => notify());
  };
}

function idle(callback: () => void): () => void {
  if (window.requestIdleCallback) {
    const id = window.requestIdleCallback(callback, { timeout: 1000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 120);
  return () => window.clearTimeout(id);
}

/** One session for the page; browsing only adjusts which textures are kept ready. */
export function startSummonPreload() {
  const abort = new AbortController();
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let stopped = false;
  let priority: string[] = [];
  let preparing: string | null = null;
  let cancelIdle: (() => void) | undefined;
  const attempted = new Set<string>();
  const failedDownloads = new Set<string>();
  const failedPreparations = new Set<string>();
  const downloading = new Set<string>();
  const subscribers = new Set<() => void>();
  let snapshot = INITIAL_SUMMON_PRELOAD;
  const turns = new Set<(allowed: boolean) => void>();
  const allowed = () => !stopped && !playing && !document.hidden && !motion.matches;
  const src = (key: string) => restoredSpirits[key]?.src;
  void pruneSummonAssets(assets);
  const publish = () => {
    const completed = assets.filter(url => downloaded.has(url)).length;
    const prepared = priority.filter(key => preparedFigure(key, spiritPalette(key))).length;
    const failed = failedDownloads.size + failedPreparations.size;
    const phase = motion.matches ? 'skipped' : failed ? 'error' : completed === assets.length && prepared === priority.length ? 'ready' : 'loading';
    const next = { phase, completed, total: assets.length, failed, prepared } satisfies SummonPreloadState;
    if (Object.keys(next).every(key => next[key as keyof typeof next] === snapshot[key as keyof typeof next])) return;
    snapshot = next;
    subscribers.forEach(notify => notify());
  };

  const schedule = () => {
    if (!allowed() || cancelIdle) return;
    cancelIdle = idle(() => { cancelIdle = undefined; pump(); });
  };
  const waitForTurn = () => new Promise<boolean>(resolve => {
    if (stopped) { resolve(false); return; }
    turns.add(resolve);
    schedule();
  });
  const pump = () => {
    if (!allowed()) return;
    // Decoding can finish while an animation is playing. Canvas work waits here;
    // clicking that same card promotes its existing promise in loadFigure().
    for (const resolve of turns) resolve(true);
    turns.clear();
    if (!preparing && downloading.size < 2) {
      const next = priority.find(key => !attempted.has(key) && !downloading.has(src(key)) && !preparedFigure(key, spiritPalette(key)));
      if (next) {
        preparing = next;
        attempted.add(next);
        void loadFigure(next, spiritPalette(next), async () => await waitForTurn() && priority.includes(next), abort.signal).then(figure => {
          if (figure && !figure.retry) downloaded.add(src(next));
          if ((!figure || figure.retry) && !stopped && priority.includes(next)) failedPreparations.add(next);
        }).finally(() => { preparing = null; publish(); schedule(); });
      }
    }
    // Include the preparing image in the two-download limit, even when already cached.
    const capacity = preparing ? 1 : 2;
    const candidates = [...new Set([...priority.map(src), ...assets])];
    for (const url of candidates) {
      if (downloading.size >= capacity) break;
      if (!url || url === (preparing && src(preparing)) || downloaded.has(url) || downloading.has(url) || failedDownloads.has(url)) continue;
      downloading.add(url);
      const request = new AbortController();
      const cancel = () => request.abort();
      abort.signal.addEventListener('abort', cancel, { once: true });
      const deadline = setTimeout(cancel, 15_000);
      void downloadSummonAsset(url, request.signal).then(() => {
        downloaded.add(url);
      }).catch(() => { failedDownloads.add(url); }).finally(() => {
        clearTimeout(deadline);
        abort.signal.removeEventListener('abort', cancel);
        downloading.delete(url);
        publish();
        schedule();
      });
    }
  };
  const changed = () => {
    cancelIdle?.(); cancelIdle = undefined;
    publish();
    schedule();
  };
  listeners.add(changed);
  document.addEventListener("visibilitychange", changed);
  motion.addEventListener("change", changed);
  changed();
  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) { subscribers.add(notify); return () => { subscribers.delete(notify); }; },
    async retry() {
      await removeSummonAssets([...failedPreparations].map(src));
      attempted.clear(); failedDownloads.clear(); failedPreparations.clear(); changed();
    },
    prioritizeBookmarks(ids: number[]) { this.prioritize(ids.map(id => cardForBookmark(id).key)); },
    prioritize(keys: string[]) {
      priority = [...new Set(keys)].filter(key => Boolean(src(key))).slice(0, 5);
      attempted.clear();
      failedDownloads.clear();
      failedPreparations.clear();
      changed();
    },
    dispose() {
      stopped = true;
      cancelIdle?.(); cancelIdle = undefined;
      abort.abort();
      for (const resolve of turns) resolve(false);
      turns.clear();
      listeners.delete(changed);
      subscribers.clear();
      document.removeEventListener("visibilitychange", changed);
      motion.removeEventListener("change", changed);
    },
  };
}
