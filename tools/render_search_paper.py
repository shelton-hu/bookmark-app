"""Render a static, deterministic creased-paper texture for the search surface.

The texture includes its own transparent shadow; no browser filters or animated
noise are needed. Re-run with the bundled Python (numpy + Pillow).
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 2000, 220
rng = np.random.default_rng(704)
x, y = np.meshgrid(np.arange(W), np.arange(H))

def noise(w, h):
    a = rng.normal(128, 24, (h, w)).clip(0, 255).astype('uint8')
    return (np.asarray(Image.fromarray(a).resize((W, H), Image.Resampling.BICUBIC), dtype=float) - 128) / 24

# Broad uneven ageing, tiny paper fibres, and quiet grain.
tone = noise(28, 7) * 3.1 + noise(180, 28) * 1.2 + rng.normal(0, .95, (H, W))
top = 16 + 3*np.sin(x[0]/87) + 1.7*np.sin(x[0]/23) + .6*noise(600, 1)[0]
bottom = 201 + 3.6*np.sin(x[0]/106+.8) + 1.2*np.sin(x[0]/17)
dist = np.minimum(y - top, bottom - y)
tone -= 21*np.exp(-np.maximum(dist, 0)/7) + 4*np.exp(-np.maximum(dist, 0)/25)
# Non-periodic folds: a valley and adjacent highlight model a paper crease.
for position, slope, strength in [(430, .23, 15), (1190, -.17, 18), (1725, .12, 9)]:
    d = x - (position + slope*(y-110) + 3*np.sin(y/39))
    tone += -strength*np.exp(-(d/7)**2) + strength*.7*np.exp(-((d-9)/9)**2)
    tone -= strength*.2*np.exp(-((d+22)/26)**2)
# A shallow diagonal crumple near the right end, leaving the text area calm.
d = y - (160 - .08*(x-1360))
envelope = np.exp(-((x-1630)/280)**4)
tone += envelope * (-10*np.exp(-(d/3.4)**2) + 8*np.exp(-((d-4)/5)**2))
# Turned-over left lip, with a soft cast shadow, not a cylindrical metal rod.
tone += 13*np.exp(-((x-25)/9)**2) - 25*np.exp(-((x-47)/9)**2)
tone -= 9*np.exp(-((x-1948)/16)**2)
base = np.array([222, 207, 177], dtype=float)
rgb = np.clip(base + tone[:,:,None]*np.array([1, .97, .87]), 0, 255).astype('uint8')
paper = Image.fromarray(rgb).convert('RGBA')
mask = Image.new('L', (W,H))
points = [(int(i), int(top[i])) for i in range(12,W-15,2)]
points += [(W-17,181),(W-36,199)]
points += [(int(i), int(bottom[i])) for i in range(W-38,10,-2)]
points += [(14,161),(10,94)]
ImageDraw.Draw(mask).polygon(points, fill=255)
paper.putalpha(mask)
# Sparse fibres embedded into the surface rather than speckles on top.
fibres = Image.new('RGBA',(W,H))
fd = ImageDraw.Draw(fibres)
for _ in range(1900):
    xx, yy = int(rng.integers(16,W-20)), int(rng.integers(20,H-21))
    length = int(rng.integers(2,10))
    fd.line((xx,yy,xx+length,yy+int(rng.integers(-1,2))), fill=(99,78,53,int(rng.integers(4,13))))
paper = Image.alpha_composite(paper,fibres)
paper.putalpha(mask)
# A slightly lifted, small dog-ear at the lower-right edge.
draw = ImageDraw.Draw(paper)
draw.polygon([(1931,201),(1979,173),(1963,200)], fill=(166,143,107,255))
draw.polygon([(1931,201),(1966,174),(1960,193)], fill=(237,223,194,255))
draw.line([(1931,201),(1966,174)], fill=(249,237,211,220), width=1)
shadow = Image.new('RGBA',(W,H),(10,5,13,0))
shadow.putalpha(mask.filter(ImageFilter.GaussianBlur(5)).point(lambda v: int(v*.6)))
canvas = Image.new('RGBA',(W,H))
canvas.alpha_composite(shadow,(0,5))
canvas.alpha_composite(paper)
out = Path(__file__).resolve().parents[1] / 'web/public/clow-scene/creased-paper.webp'
canvas.save(out, 'WEBP', quality=90, method=6)
print(f'{out}: {out.stat().st_size} bytes')
