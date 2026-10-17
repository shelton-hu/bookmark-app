"""Prepare local Clow faces from the original 52-card image set.
Usage: python tools/prepare_clow_deck.py INPUT_DIR OUTPUT_DIR
Requires Pillow and numpy. Does not download or overwrite the originals.
"""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 600, 1344

def curve(a, b, c, steps=64):
    return [((1-t)**2*a[0]+2*(1-t)*t*b[0]+t*t*c[0], (1-t)**2*a[1]+2*(1-t)*t*b[1]+t*t*c[1]) for t in np.linspace(0,1,steps)]

def clean_face(path):
    image = Image.open(path).convert('RGB').resize((W,H), Image.Resampling.LANCZOS)
    # Local, edge-aware averaging reduces scan grain without blurring the ink contours.
    a = np.asarray(image.filter(ImageFilter.MedianFilter(3)), dtype=np.float32)
    padded = np.pad(a, ((2,2),(2,2),(0,0)), mode='edge')
    total = np.zeros_like(a); weights = np.zeros((H,W,1), dtype=np.float32)
    for dy in range(-2,3):
        for dx in range(-2,3):
            b = padded[2+dy:2+dy+H,2+dx:2+dx+W]
            weight = np.exp(-np.sum((a-b)**2,axis=2,keepdims=True)/(2*38**2)-(dx*dx+dy*dy)/8)
            total += b*weight; weights += weight
    image = Image.fromarray(np.clip(total/weights,0,255).astype('uint8')).convert('RGBA')
    # Replace the orange mottled outer stock with a quiet warm-gold print border.
    yy, xx = np.mgrid[0:H,0:W]
    blend = (0.5+0.25*np.cos(xx/W*np.pi)+0.25*np.cos(yy/H*np.pi))[...,None]
    border = np.array([202,155,81]) + blend*np.array([36,35,35])
    stock = Image.fromarray(border.astype('uint8')).convert('RGBA')
    inner = Image.new('L',(W,H)); d=ImageDraw.Draw(inner)
    d.rounded_rectangle((W*.078,H*.016,W*.922,H*.984),radius=W*.054,fill=255)
    stock.paste(image,(0,0),inner)
    # Redraw the central scroll panel, covering the original English card name.
    # The live website title is rendered in this panel by CardFace.
    points = curve((.16,.854),(.5,.895),(.84,.854)) + curve((.84,.939),(.5,.972),(.16,.939))
    points = [(x*W,y*H) for x,y in points]
    ribbon_mask = Image.new('L',(W,H)); ImageDraw.Draw(ribbon_mask).polygon(points,fill=255)
    shade = (.5+.5*np.cos((xx/W-.3)*np.pi*2))[...,None]
    ribbon = np.array([218,181,106])+shade*np.array([26,30,37])
    stock.paste(Image.fromarray(ribbon.astype('uint8')).convert('RGBA'),(0,0),ribbon_mask)
    draw=ImageDraw.Draw(stock)
    draw.line(points+[points[0]],fill=(105,73,40),width=3,joint='curve')
    highlight = curve((.17,.858),(.5,.899),(.83,.858))
    draw.line([(x*W,y*H) for x,y in highlight],fill=(255,235,171),width=2)
    # A single smooth silhouette, without white source-image corners.
    alpha=Image.new('L',(W,H));ImageDraw.Draw(alpha).rounded_rectangle((0,0,W-1,H-1),radius=30,fill=255)
    stock.putalpha(alpha)
    return stock

def main():
    parser=argparse.ArgumentParser();parser.add_argument('input',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    originals=sorted(args.input.glob('the-*.jpg'))
    for path in originals:
        key=path.stem.removeprefix('the-')
        target=args.output/f'{key}.webp'
        clean_face(path).save(target,'WEBP',quality=92,method=6)
        print(key,target.stat().st_size,flush=True)
    manifest={'source':'https://github.com/alvesmatheus/clow-cards/tree/master/server/public/cards','width':W,'height':H,'processing':'edge-aware scan denoise; clean outer stock; blank scroll panel; original glyph and matching illustration retained','cards':[{ 'key':p.stem.removeprefix('the-'),'original_sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in originals]}
    (args.output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print('Prepared',len(originals),'faces',flush=True)

if __name__=='__main__':main()
