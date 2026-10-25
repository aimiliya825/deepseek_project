#!/usr/bin/env python3
"""Software-project the model export into flat previews for composition QA."""
from pathlib import Path
import json
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / ".tmp" / "model-projected.json"
OUTDIR = ROOT / "screenshots"
OUTDIR.mkdir(exist_ok=True)


def font(size, bold=False):
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\bahnschrift.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ]
    for c in candidates:
        try:
            return ImageFont.truetype(c, size)
        except Exception:
            pass
    return ImageFont.load_default()


def render(view):
    w, h = view["width"], view["height"]
    base = Image.new("RGB", (w, h), (3, 7, 13))
    # background atmosphere
    bg = Image.new("RGB", (w, h), (2, 6, 11))
    dbg = ImageDraw.Draw(bg)
    for i in range(90):
        t = i / 90
        y0 = int(h * 0.18 + h * 0.55 * t)
        col = (int(5 + 9 * (1 - t)), int(12 + 15 * (1 - t)), int(20 + 20 * (1 - t)))
        dbg.rectangle([0, y0, w, h], fill=col)
    glow = Image.new("RGB", (w, h), (0, 0, 0))
    dg = ImageDraw.Draw(glow)
    dg.ellipse([w * 0.18, h * 0.05, w * 0.82, h * 0.85], fill=(6, 22, 30))
    glow = glow.filter(ImageFilter.GaussianBlur(110))
    bg = Image.blend(bg, glow, 0.55)

    # grid floor
    grid = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    dgr = ImageDraw.Draw(grid)
    horizon = int(h * 0.80)
    for i in range(1, 16):
        t = i / 15
        y = horizon + int((h - horizon) * (t ** 1.6))
        dgr.line([(0, y), (w, y)], fill=(40, 120, 145, int(36 * (1 - t * 0.5))), width=1)
    for i in range(-10, 11):
        x = w / 2 + i * 90
        dgr.line([(w / 2 + i * 12, horizon), (x * 1.4, h)], fill=(30, 100, 120, 24), width=1)
    bg = Image.alpha_composite(bg.convert("RGBA"), grid).convert("RGB")

    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for tri in view["triangles"]:
        ax, ay, az = tri[0], tri[1], tri[2]
        bx, by = tri[3], tri[4]
        cx, cy = tri[5], tri[6]
        r, g, b, a, screen = tri[7], tri[8], tri[9], tri[10], tri[11]
        if screen:
            # brighten screen quads and add scanline-ish gradient by height
            r = min(255, int(r * 1.15) + 8)
            g = min(255, int(g * 1.15) + 10)
            b = min(255, int(b * 1.15) + 14)
        draw.polygon([(ax, ay), (bx, by), (cx, cy)], fill=(r, g, b, a))
    layer = layer.filter(ImageFilter.GaussianBlur(0.35))
    out = Image.alpha_composite(bg.convert("RGBA"), layer).convert("RGB")

    # bloom-ish glow pass
    bright = layer.copy()
    px = bright.load()
    for y in range(h):
        for x in range(0, w, 2):
            r, g, b, a = px[x, y]
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            px[x, y] = (r, g, b, int(max(0, lum - 150) * 0.9))
            if x + 1 < w:
                px[x + 1, y] = px[x, y]
    bright = bright.filter(ImageFilter.GaussianBlur(14))
    out = Image.alpha_composite(out.convert("RGBA"), bright).convert("RGB")

    # annotations for composition QA
    d = ImageDraw.Draw(out)
    for ann in view.get("annotations", []):
        x, y = ann["x"], ann["y"]
        if x < 0 or x > w or y < 0 or y > h:
            continue
        col = ann["accent"]
        rgb = tuple(int(col[i:i + 2], 16) for i in (1, 3, 5))
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=rgb, outline=(0, 0, 0))
        label = "%s  %s" % (ann["no"], ann["en"])
        f = font(11)
        tw = d.textlength(label, font=f)
        d.rectangle([x + 7, y - 8, x + 13 + tw, y + 7], fill=(4, 10, 16))
        d.text((x + 10, y - 7), label, font=f, fill=(190, 220, 233))
    # frame metadata
    d.text((24, 24), "SOFTWARE PROJECTION / %s" % view["name"].upper(), font=font(12, True), fill=(90, 130, 145))
    d.text((24, 44), "camera distance %.1f  ·  triangles %d  ·  not a WebGL render" % (view["distance"], len(view["triangles"])), font=font(10), fill=(60, 90, 104))
    outp = OUTDIR / ("software-%s.png" % view["name"])
    out.save(outp, "PNG")
    print("wrote", outp)


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    for view in data["views"]:
        render(view)


if __name__ == "__main__":
    main()
