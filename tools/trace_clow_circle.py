#!/usr/bin/env python3
"""Trace the existing Clow reference into scalable, transparent gold linework.

Tool-only dependencies: Pillow, numpy, potracer==0.0.4.
Usage: python tools/trace_clow_circle.py SOURCE OUTPUT.svg
This smooths supplied contours; it does not invent missing source detail.
"""
from pathlib import Path
import argparse
import xml.etree.ElementTree as ET

from PIL import Image
import potrace


def trace(source: Path, output: Path) -> None:
    # Same crop as the previous raster: preserve composition and placement.
    image = Image.open(source).convert("L").crop((56, 56, 844, 844))
    curves = potrace.Bitmap(image, blacklevel=160 / 255).trace(
        turdsize=2, alphamax=1.0, opticurve=True, opttolerance=0.15,
    )
    def point(value):
        return f"{value.x:.3f},{value.y:.3f}"
    commands = []
    for curve in curves:
        commands.append(f"M{point(curve.start_point)}")
        for segment in curve:
            if segment.is_corner:
                commands.append(f"L{point(segment.c)} {point(segment.end_point)}")
            else:
                commands.append(f"C{point(segment.c1)} {point(segment.c2)} {point(segment.end_point)}")
        commands.append("Z")
    # One compound path with explicit holes preserves thin enclosed outlines.
    root = ET.Element("svg", {"xmlns": "http://www.w3.org/2000/svg",
        "viewBox": "0 0 788 788", "width": "788", "height": "788"})
    ET.SubElement(root, "path", {"fill": "#f3cf8f", "fill-rule": "evenodd", "d": " ".join(commands)})
    output.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)
    print(f"{output}: {len(curves)} contours, {output.stat().st_size:,} bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    trace(arguments.source, arguments.output)
