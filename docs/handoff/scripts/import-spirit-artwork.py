"""Copy approved ImageGen PNGs unchanged and record alpha bounds and placement.

Input JSON maps deck keys to {path, prompt}. This script never edits image pixels.
The existing rain placement stays unchanged; other shapes fit the illustration
window uniformly, preserving the generated original-art proportions.
"""
import argparse
import hashlib
import json
import re
import shutil
from datetime import date
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('inputs', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]
public = root / 'web/public/spirits'
provenance_file = public / 'provenance.json'
provenance = json.loads(provenance_file.read_text())
inputs = json.loads(args.inputs.read_text())
for key, item in inputs.items():
    source = Path(item['path'])
    with Image.open(source) as image:
        assert image.mode == 'RGBA', (key, image.mode)
        alpha = image.getchannel('A')
        transparent, opaque = alpha.getextrema()
        assert transparent == 0 and opaque >= 250, (key, 'real transparency and an opaque subject required')
        bounds = alpha.getbbox()
        assert bounds, key
        x, y, right, bottom = bounds
        width, height = image.size
    crop = {'x': x, 'y': y, 'w': right - x, 'h': bottom - y}
    # Place the complete silhouette inside the original illustration region.
    scale = min(600 * .68 / crop['w'], 1344 * .73 / crop['h'])
    w, h = crop['w'] * scale / 600, crop['h'] * scale / 1344
    placement = {name: round(value, 10) for name, value in {'x': (1 - w) / 2, 'y': .09 + (.73 - h) / 2, 'w': w, 'h': h}.items()}
    filename = f"{key}-restored-v{item.get('version', 1)}.png"
    target = public / filename
    if target.exists():
        assert target.read_bytes() == source.read_bytes(), f'Refusing to replace {target}'
    else:
        shutil.copyfile(source, target)
    provenance[filename] = {
        'method': 'Built-in ImageGen: original-card extraction and conservative completion',
        'date': date.today().isoformat(), 'reference': f'../clow-deck/{key}.webp',
        'reference_sha256': hashlib.sha256((root / f'web/public/clow-deck/{key}.webp').read_bytes()).hexdigest(),
        'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'size': {'w': width, 'h': height}, 'crop': crop, 'placement': placement,
        'prompt': item['prompt'],
    }
provenance_file.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
deck = re.findall(r'\["([a-z]+)",', (root / 'web/src/clowDeck.ts').read_text())
artwork = {}
for key in deck:
    candidates = [name for name in provenance if name.startswith(key + '-restored-v')]
    if not candidates:
        continue
    filename = max(candidates, key=lambda name: int(re.search(r'-v(\d+)\.png$', name)[1]))
    record = provenance[filename]
    artwork[key] = {'src': '/spirits/' + filename, **{field: record[field] for field in ['size', 'crop', 'placement']}}
header = '''export type ArtWindow = { x: number; y: number; w: number; h: number };
/** Original-art PNGs. Metadata is maintained by import-spirit-artwork.py. */
export const restoredSpirits: Record<string, {
  src: string;
  size: { w: number; h: number };
  crop: { x: number; y: number; w: number; h: number };
  placement: ArtWindow;
}> = '''
(root / 'web/src/spiritArtwork.ts').write_text(header + json.dumps(artwork, indent=2) + ';\n')
print(f'{len(artwork)} / {len(deck)} cards registered; PNG bytes preserved unchanged.')
