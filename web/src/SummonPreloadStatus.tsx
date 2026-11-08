import { useSyncExternalStore } from "react";
import { INITIAL_SUMMON_PRELOAD } from "./summonPreload";
import type { startSummonPreload } from "./summonPreload";

const subscribe = () => () => {};
const initial = () => INITIAL_SUMMON_PRELOAD;

export default function SummonPreloadStatus({ session }: { session: ReturnType<typeof startSummonPreload> | null }) {
  const state = useSyncExternalStore(session?.subscribe ?? subscribe, session?.getSnapshot ?? initial, initial);
  const waiting = state.phase === 'loading';
  return <section id="summon-preload-status" className="summon-preload-status" data-state={state.phase} aria-live="polite">
    <span>{waiting ? state.completed === state.total ? '正在准备卡牌动画…' : `正在准备召唤资源 ${state.completed} / ${state.total}` : state.phase === 'error' ? '部分召唤资源准备失败' : state.phase === 'skipped' ? '已减少动态效果，点牌直接打开' : '召唤已就绪'}</span>
    {waiting && state.completed < state.total && <progress aria-label="召唤资源准备进度" value={state.completed} max={state.total} />}
    {state.phase === 'error' && <><button type="button" onClick={() => session?.retry()}>重试</button><span>可先用「翻阅」打开网址</span></>}
  </section>;
}
