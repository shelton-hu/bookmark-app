import sys, numpy as np
from PIL import Image
src, out = sys.argv[1], sys.argv[2]; names = sys.argv[3:]
X, Y, W, H = .15, .09, .7, .72
def ss(a, b, v): x = np.clip((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x)
tiles = []
for n in names:
    im = np.asarray(Image.open(f'{src}/{n}.webp').convert('RGB')).astype(float) / 255
    h0, w0 = im.shape[:2]; x0, y0, w, h = round(w0*X), round(h0*Y), round(w0*W), round(h0*H)
    c = im[y0:y0+h, x0:x0+w]; r, g, b = c[..., 0], c[..., 1], c[..., 2]
    sat = c.max(-1) - c.min(-1)
    keep = ss(.05, .2, (r+g)/2 - b) * ss(.42, .7, .3*r+.59*g+.11*b) * (1 - ss(.3, .45, sat))
    yy, xx = np.mgrid[0:h, 0:w]
    edge = np.minimum(1, np.minimum(np.minimum(xx, w-1-xx) / (w*.09), np.minimum(yy, h-1-yy) / (h*.05)))
    a = keep * edge
    bg = np.array([.09, .05, .14])
    comp = c * a[..., None] + bg * (1 - a[..., None])
    tiles.append(np.concatenate([c, comp], 1))
Image.fromarray((np.concatenate(tiles, 1) * 255).astype(np.uint8)).resize((1800, 610)).save(out)
