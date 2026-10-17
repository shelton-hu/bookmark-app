import { useEffect, useState } from "react";
import { api, message } from "./api";
import type { Bookmark } from "./api";

/** Keep full content local to the open row/card; discard stale or cancelled reads. */
export function useBookmarkDetails(bookmark: Bookmark, active: boolean) {
  const revision = `${bookmark.id}:${bookmark.updated_at}`;
  const [loaded, setLoaded] = useState<{ revision: string; bookmark: Bookmark } | null>(null);
  const [failure, setFailure] = useState<{ revision: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const needsRead = bookmark.details_loaded === false && loaded?.revision !== revision;
  useEffect(() => {
    if (!active || !needsRead) return;
    const controller = new AbortController();
    setFailure(null);
    api<Bookmark>(`/bookmarks/${bookmark.id}`, { signal: controller.signal })
      .then((detail) => {
        if (!controller.signal.aborted) setLoaded({ revision, bookmark: detail });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure({ revision, message: message(error) });
      });
    return () => controller.abort();
  }, [active, needsRead, bookmark.id, revision, attempt]);
  const error = failure?.revision === revision ? failure.message : "";
  return {
    bookmark: loaded?.revision === revision ? loaded.bookmark : bookmark,
    loading: active && needsRead && !error,
    error,
    retry: () => { setFailure(null); setAttempt((value) => value + 1); },
  };
}
