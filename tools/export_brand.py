"""Export extension icons from the restored transparent sealed-book master.

Run from any directory: python tools/export_brand.py
Requires Pillow and librsvg's rsvg-convert.
"""
from io import BytesIO
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web/public/brand/sealed-book-transparent.svg"
EXTENSION_SVG = ROOT / "extension/icons/bookmark.svg"
RENDERER = shutil.which("rsvg-convert")

if not RENDERER:
    raise SystemExit("Install librsvg (rsvg-convert) to export brand icons.")

master = SOURCE.read_text(encoding="utf-8")
root = ET.fromstring(master)
if root.attrib.get("viewBox") != "0 0 64 64":
    raise SystemExit("Brand master must use a 0 0 64 64 viewBox.")

for element in root.iter():
    if element.tag.rsplit("}", 1)[-1] != "rect":
        continue
    if element.attrib.get("width") == "64" and element.attrib.get("height") == "64":
        raise SystemExit("Brand master must remain transparent; remove the full-canvas rectangle.")

# The web favicon uses the separately committed simplified online artwork.
EXTENSION_SVG.write_text(master, encoding="utf-8")


def raster(size: int) -> Image.Image:
    data = subprocess.run(
        [RENDERER, "-w", str(size * 4), "-h", str(size * 4)],
        input=master.encode(),
        capture_output=True,
        check=True,
    ).stdout
    return Image.open(BytesIO(data)).convert("RGBA").resize(
        (size, size), Image.Resampling.LANCZOS
    )


for size in (16, 32, 48, 128):
    icon = raster(size)
    icon.save(ROOT / f"extension/icons/icon-{size}.png")
    print(f"Exported transparent extension icon: {size} x {size}")

# Review the same transparent artwork on product light and browser dark surfaces.
preview = Image.new("RGB", (1200, 640), "#F8F0E1")
draw = ImageDraw.Draw(preview)
font_path = "/System/Library/Fonts/Supplemental/Songti.ttc"
heading = ImageFont.truetype(font_path, 34)
body = ImageFont.truetype(font_path, 22)

for x, color, label in (
    (30, "#FFFDFC", "浅色页面"),
    (315, "#352335", "深色浏览器栏"),
):
    draw.rounded_rectangle((x, 30, x + 255, 315), radius=16, fill=color)
    icon = raster(160)
    preview.paste(icon, (x + 48, 74), icon)
    text_color = "#493B35" if color == "#FFFDFC" else "#F4E4BE"
    draw.text((x + 78, 255), label, font=body, fill=text_color)

draw.text((640, 45), "拾页 · 封印之书", font=heading, fill="#512638")
draw.text((640, 95), "透明底 / 酒红书封 / 古金星月", font=body, fill="#756354")
for x, size in ((645, 64), (770, 48), (875, 32), (960, 16)):
    icon = raster(size)
    preview.paste(icon, (x, 165), icon)
    draw.text((x, 245), f"{size}px", font=body, fill="#756354")

draw.rounded_rectangle((630, 330, 1150, 435), radius=10, fill="#FFFDFC")
icon = raster(48)
preview.paste(icon, (654, 358), icon)
draw.text((720, 355), "拾页", font=heading, fill="#493B35")
draw.text((830, 365), "个人书签库", font=body, fill="#756354")

draw.text((640, 490), "所有导出资源共享同一透明主稿", font=heading, fill="#512638")
draw.text((640, 545), "16px 仍保留书封与星月轮廓。", font=body, fill="#756354")

output = ROOT / ".test-data/design-previews/logo/sealed-book-preview.png"
output.parent.mkdir(parents=True, exist_ok=True)
preview.save(output)
print(output)
