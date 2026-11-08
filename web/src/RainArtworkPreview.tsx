import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Layers2, Play, X } from 'lucide-react';
import CardSummon from './CardSummonOverlay';
import { CardFace } from './ClowBookmark';
import { restoredSpirits } from './spiritArtwork';
import { clowDeck } from './clowDeck';
import './rain-artwork-preview.css';

function RestoredFigure({ cardKey, name }: { cardKey: string; name: string }) {
  const art = restoredSpirits[cardKey];
  if (!art) return null;
  return <svg className="rain-art-character" style={{ left: `${art.placement.x * 100}%`, top: `${art.placement.y * 100}%`, width: `${art.placement.w * 100}%`, height: `${art.placement.h * 100}%` }}
    viewBox={`${art.crop.x} ${art.crop.y} ${art.crop.w} ${art.crop.h}`} role="img" aria-label={`保留原牌形象的完整${name}之牌召唤物`}>
    <image href={art.src} width={art.size.w} height={art.size.h} />
  </svg>;
}

export default function RainArtworkPreview() {
  const trigger = useRef<HTMLButtonElement>(null);
  const originalFrame = useRef<HTMLDivElement>(null), restoredFrame = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() => {
    const requested = new URLSearchParams(location.search).get('summon-preview');
    return Math.max(0, clowDeck.findIndex(card => card.key === (requested === 'rain-3d' ? 'rain' : requested)));
  });
  const card = clowDeck[index];
  const [overlay, setOverlay] = useState(false), [origin, setOrigin] = useState<DOMRect | null>(null);
  const [status, setStatus] = useState('保留原牌形象，只补齐抠图缺失的部分。');
  useEffect(() => { document.title = `${card.name}之牌 · 原画补齐预览`; }, [card.name]);
  const selectCard = (next: number) => {
    const nextIndex = (next + clowDeck.length) % clowDeck.length;
    setIndex(nextIndex); setStatus('保留原牌形象，只补齐抠图缺失的部分。');
    const url = new URL(location.href); url.searchParams.set('summon-preview', clowDeck[nextIndex].key);
    history.replaceState(null, '', url);
  };
  const finish = (cancelled = false) => {
    setOrigin(null); setStatus(cancelled ? '已取消召唤。' : '播放完成，可以再次召唤。');
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  return <main className="rain-art-preview">
    <header className="rain-art-header"><a href="/#library"><ArrowLeft size={17} />返回书签库</a><h1>{card.name}之牌 · 原画补齐</h1></header>
    <nav className="rain-art-picker" aria-label="切换卡牌">
      <button type="button" aria-label="上一张牌" onClick={() => selectCard(index - 1)}><ChevronLeft size={18} /></button>
      <label><span className="rain-art-picker-label">选择卡牌</span><select aria-label="选择卡牌" value={card.key} onChange={event => selectCard(clowDeck.findIndex(item => item.key === event.target.value))}>
        {clowDeck.map(item => <option key={item.key} value={item.key}>{item.name}之牌 · {item.key.toUpperCase()}</option>)}
      </select></label>
      <button type="button" aria-label="下一张牌" onClick={() => selectCard(index + 1)}><ChevronRight size={18} /></button>
      <span>{index + 1} / {clowDeck.length}</span>
    </nav>
    <p className="rain-art-intro" role="status">{status}</p>
    <section className={`rain-art-comparison${overlay ? ' is-overlaid' : ''}`} aria-label="原牌与完整人物对照">
      <figure className="rain-art-original"><div ref={originalFrame} className="rain-art-frame"><img src={`/clow-deck/${card.key}.webp`} alt={`原版${card.name}之牌`} /></div><figcaption>原牌</figcaption></figure>
      <figure className="rain-art-restored"><div ref={restoredFrame} className="rain-art-frame rain-art-transparent">
        {overlay && <img className="rain-art-underlay" src={`/clow-deck/${card.key}.webp`} alt="" />}
        <RestoredFigure cardKey={card.key} name={card.name} />
      </div><figcaption>{overlay ? '叠加对照 · 检查脸、姿态与比例' : '完整人物 · 保留原有线条与配色'}</figcaption></figure>
    </section>
    <div className="rain-art-actions">
      <button ref={trigger} className="rain-art-play" onClick={() => {
        const source = (overlay ? restoredFrame : originalFrame).current;
        if (source) setOrigin(source.getBoundingClientRect());
      }}><Play size={17} />播放召唤</button>
      <button aria-pressed={overlay} onClick={() => setOverlay(value => !value)}>{overlay ? <X size={17} /> : <Layers2 size={17} />}{overlay ? '退出叠加对照' : '原牌叠加对照'}</button>
    </div>
    <p className="rain-art-note">沿用原来的召唤节奏。点击动画可跳过，按 Esc 或 × 取消。</p>
    {origin && <CardSummon bookmarkId={index + 1} title={`${card.name}之牌`} origin={origin} front={<CardFace id={index + 1} title={`${card.name}之牌`} />} onFinish={() => finish()} onCancel={() => finish(true)} />}
  </main>;
}
