import { createDepartureShards, DEPARTURE_SCATTER_MS } from "./cardDeparture";

// Load once; both the intact back and every fragment use the same frozen bitmap.
const circle = typeof Image === "undefined" ? null : new Image();
if (circle) circle.src = "/clow-scene/clow-circle.svg";
const shards = createDepartureShards();
const font = 'Georgia, "Songti SC", "Noto Serif SC", serif';

export function createBackTexture(width: number, height: number, ratio: number, title: string, glyph: string, name: string) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.beginPath(); ctx.roundRect(0, 0, width, height, 12); ctx.clip();
  const base = ctx.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#492b3c"); base.addColorStop(.8, "#2c2030");
  ctx.fillStyle = base; ctx.fillRect(0, 0, width, height);
  const light = ctx.createRadialGradient(width * .1, 0, 0, width * .1, 0, height * .7);
  light.addColorStop(0, "#75435365"); light.addColorStop(1, "#75435300");
  ctx.fillStyle = light; ctx.fillRect(0, 0, width, height);
  if (circle?.complete && circle.naturalWidth) {
    ctx.globalAlpha = .11;
    const side = width * 1.45;
    ctx.drawImage(circle, (width - side) / 2, (height - side) / 2, side, side);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = "#c7a368"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(.5, .5, width - 1, height - 1, 12); ctx.stroke();
  ctx.strokeStyle = "#d8ba8160";
  ctx.beginPath(); ctx.roundRect(7.5, 7.5, width - 15, height - 15, 7); ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#f3dfb5";
  const size = Math.min(22, width * .082);
  ctx.font = `600 ${size}px ${font}`;
  const lines: string[] = []; let line = "";
  for (const character of Array.from(title)) {
    if (ctx.measureText(line + character).width > width - 40 && line) { lines.push(line); line = character; }
    else line += character;
    if (lines.length === 3) break;
  }
  if (lines.length < 3 && line) lines.push(line);
  else if (lines.length === 3) lines[2] = lines[2].slice(0, -1) + "…";
  const total = 18 + 20 + 86 + 20 + lines.length * size * 1.5 + 20 + 20;
  let y = (height - total) / 2;
  ctx.font = `12px ${font}`; ctx.fillText("封 印 藏 书", width / 2, y + 9); y += 38;
  ctx.fillStyle = "#38223380"; ctx.strokeStyle = "#d8ba8180";
  ctx.beginPath(); ctx.arc(width / 2, y + 43, 43, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#f3dfb5"; ctx.font = `48px ${font}`; ctx.fillText(glyph, width / 2, y + 43); y += 106;
  ctx.font = `600 ${size}px ${font}`;
  for (const text of lines) { ctx.fillText(text, width / 2, y + size * .75); y += size * 1.5; }
  ctx.font = `13px ${font}`; ctx.fillText(`${name}之牌`, width / 2, y + 30);
  return canvas;
}

/** Prepare geometry once; each frame only clips and copies small regions of one texture. */
export function prepareShatter(canvas: HTMLCanvasElement, texture: HTMLCanvasElement, width: number, height: number, ratio: number) {
  const padding = 200;
  const context = canvas.getContext("2d");
  if (!context) return null;
  canvas.width = Math.ceil((width + padding * 2) * ratio);
  canvas.height = Math.ceil((height + padding * 2) * ratio);
  canvas.style.width = `${width + padding * 2}px`; canvas.style.height = `${height + padding * 2}px`;
  canvas.style.left = `${-padding}px`; canvas.style.top = `${-padding}px`;
  const prepared = shards.map(shard => {
    const points = shard.points.map(([x, y]) => [x * width / 100, y * height / 100]);
    const cx = points.reduce((sum, p) => sum + p[0], 0) / 3;
    const cy = points.reduce((sum, p) => sum + p[1], 0) / 3;
    // Subpixel overlap avoids source-over antialiasing cracks while pieces rest.
    const edgeDistances = points.map(([x, y], index) => {
      const [bx, by] = points[(index + 1) % 3];
      return Math.abs((bx - x) * (y - cy) - (x - cx) * (by - y)) / Math.hypot(bx - x, by - y);
    });
    const overlap = 1 + .6 / Math.min(...edgeDistances);
    const expanded = points.map(([x, y]) => [cx + (x - cx) * overlap, cy + (y - cy) * overlap]);
    const path = new Path2D();
    expanded.forEach(([x, y], i) => { if (i) path.lineTo(x - cx, y - cy); else path.moveTo(x - cx, y - cy); }); path.closePath();
    const left = Math.max(0, Math.min(...expanded.map(p => p[0])));
    const top = Math.max(0, Math.min(...expanded.map(p => p[1])));
    return { ...shard, path, cx, cy, left, top,
      width: Math.min(width, Math.max(...expanded.map(p => p[0]))) - left,
      height: Math.min(height, Math.max(...expanded.map(p => p[1]))) - top };
  });
  return (elapsed: number) => {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width + padding * 2, height + padding * 2);
    // First hand-off is pixel-identical, avoiding visible triangle seams at rest.
    if (elapsed <= 0) { context.drawImage(texture, padding, padding, width, height); return; }
    for (const shard of prepared) {
      const t = Math.min(1, Math.max(0, (elapsed - shard.delay) / DEPARTURE_SCATTER_MS));
      if (t === 1) continue;
      const ease = 1 - Math.pow(1 - t, 3), scale = 1 - .82 * ease;
      context.save();
      context.globalAlpha = 1 - Math.max(0, (t - .22) / .78);
      context.translate(padding + shard.cx + shard.x * ease, padding + shard.cy + shard.y * ease);
      context.rotate(shard.rotate * ease * Math.PI / 180);
      context.scale(scale * Math.cos(shard.tilt * ease * Math.PI / 180), scale);
      context.clip(shard.path);
      context.drawImage(texture, shard.left * ratio, shard.top * ratio, shard.width * ratio, shard.height * ratio,
        shard.left - shard.cx, shard.top - shard.cy, shard.width, shard.height);
      context.restore();
    }
  };
}
