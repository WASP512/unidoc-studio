#!/usr/bin/env python3
"""
Fetch UniFi product photos from techspecs.ui.com and bundle them with the app.

    python3 scripts/fetch_unifi_photos.py            # needs Pillow with WebP support

For every product card on the Cloud Gateways, Switching and WiFi listings it
downloads the listing photo (the plain product shot), trims the empty margin,
and writes public/hardware/unifi/<SKU>.webp plus src/data/unifi-photos.json
(sku, name, category, file, aspect, source URL).

Photos are bundled at build time so reports never contact ui.com at runtime
(the PDF renderer may only load this app's own origin).

Photo rules: the photo must show the device alone, with no packaging, spec
callouts, dimension lines, overlaid words, readable screen content or printed
model names (see CLEAN). Products whose listing photo
breaks the rule are listed in OVERRIDES with a replacement image from the same
Ubiquiti product CDN, cleaned as described. Re-check new products visually
(contact sheet: --sheet) before committing.
"""
from __future__ import annotations

import html
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "hardware" / "unifi"
MANIFEST = ROOT / "src" / "data" / "unifi-photos.json"
CATEGORIES = {"cloud-gateways": "gateway", "switching": "switch", "wifi": "ap"}
UA = {"User-Agent": "Mozilla/5.0 (UniDoc Studio photo fetch)", "Accept": "image/png,image/*,text/html"}
MAX_W = 640


def blank_ux7(im: Image.Image) -> Image.Image:
    """UX7: front view; switch the status screen off and remove the printed model name."""
    im = im.convert("RGBA").resize((640, 640))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([277, 286, 362, 325], radius=19, fill=(22, 26, 40, 255))
    px = im.load()
    for y in range(333, 358):
        t = (y - 331) / (359 - 331)
        for x in range(284, 368):
            a, b = px[x, 331], px[x, 359]
            px[x, y] = tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(4))
    return im


# The techspecs listing photo for UX7 shows the retail box (printed text) and its
# gallery images carry dimension callouts, so the store's plain front view is used.
OVERRIDES = {
    "UX7": {
        "url": "https://cdn.ecomm.ui.com/products/d3220754-f4a9-4ecc-a0bd-64e1520ef471/3c825279-5f12-4420-8f9f-acb8019bb192.png",
        "fix": blank_ux7,
        "note": "store.ui.com front view; status screen blanked and printed model name removed",
    },
}

# Devices with a front display or printed model name. Coordinates are in the
# trimmed output image (same source => same trim). Each screen is switched "off"
# (convex hull of its dark pixels filled with an unlit-panel colour) and each
# printed wordmark is painted out by interpolating the surrounding body
# ("h" = across columns for flat fronts, "v" = across rows for curved bodies).
CLEAN: dict[str, dict] = {
    "UTR": {"screens": [(190, 205, 282, 357)], "text": [((200, 374, 274, 402), "h")]},
    "UTR-LR": {"screens": [(140, 595, 240, 718)], "text": []},
    "UDR-5G-Max": {"screens": [(245, 245, 355, 692)], "text": [((262, 697, 340, 721), "v")]},
    "UDW": {"screens": [(295, 358, 345, 534)], "text": [((290, 709, 352, 727), "h")]},
    "UDR7": {"screens": [(250, 424, 316, 542)], "text": []},
    "UDR": {"screens": [(250, 424, 316, 542)], "text": []},
    "UX": {"screens": [(96, 60, 176, 124)], "text": [((105, 125, 167, 148), "h")]},
    "UCG-Max": {"screens": [(112, 52, 173, 100)], "text": [((110, 99, 181, 115), "h")]},
    "UCG-Ultra": {"screens": [(117, 52, 173, 99)], "text": [((114, 99, 183, 116), "h")]},
    "UCG-Fiber": {"screens": [(147, 44, 198, 89)], "text": [((145, 84, 205, 98), "h")]},
    # dark body: the screen is found by its lit (blue / bright / green) pixels instead
    "U-AirWire": {"screens": [(262, 92, 372, 143)], "lit": True, "text": [((286, 150, 354, 176), "h")]},
}
SCREEN_OFF = (17, 21, 34, 255)


def _hull(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _is_screen(p: tuple[int, int, int, int], lit: bool) -> bool:
    r, g, b = p[0], p[1], p[2]
    lum = (r * 299 + g * 587 + b * 114) / 1000
    bluish = b - r > 40 and b > 110
    if lit:  # panel on a dark body
        return bluish or lum > 165 or g - r > 50
    return lum < 150 or bluish


def clean_device(im: Image.Image, spec: dict) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    for x1, y1, x2, y2 in spec["screens"]:
        dark = [
            (x, y)
            for y in range(y1, min(y2, im.height))
            for x in range(x1, min(x2, im.width))
            if px[x, y][3] > 128 and _is_screen(px[x, y], spec.get("lit", False))
        ]
        hull = _hull(dark)
        if len(hull) < 3:
            raise SystemExit(f"no screen found in {(x1, y1, x2, y2)}")
        k = 4  # supersampled, anti-aliased mask
        mask = Image.new("L", (im.width * k, im.height * k), 0)
        ImageDraw.Draw(mask).polygon([(x * k + k // 2, y * k + k // 2) for x, y in hull], fill=255)
        mask = mask.resize(im.size, Image.LANCZOS)
        im = Image.composite(Image.new("RGBA", im.size, SCREEN_OFF), im, mask)
        px = im.load()
    for (x1, y1, x2, y2), mode in spec["text"]:
        for y in range(y1, y2):
            for x in range(x1, x2):
                if mode == "v":
                    a, b, t = px[x, y1 - 1], px[x, y2], (y - y1 + 1) / (y2 - y1 + 1)
                else:
                    a, b, t = px[x1 - 1, y], px[x2, y], (x - x1 + 1) / (x2 - x1 + 1)
                px[x, y] = tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(4))
    return im


CARD_RE = re.compile(
    r'<a class="ProductCard[^"]*" href="(?P<href>/unifi/[^"?]+)[^"]*">\s*<img alt="(?P<alt>[^"]*)".*?'
    r'src="https://images\.svc\.ui\.com/\?u=(?P<u>[^"&]+)[^"]*"\s*/?>.*?'
    r'<h6[^>]*>(?P<name>[^<]*)</h6>\s*<p[^>]*>(?P<sku>[^<]*)</p>',
    re.S,
)


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
        return r.read()


def resized_url(cdn_url: str, width: int = 1200) -> str:
    return f"https://images.svc.ui.com/?u={urllib.parse.quote(cdn_url, safe='')}&q=90&w={width}"


def trim(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    alpha_box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    # Some photos are on opaque white instead of transparency: trim near-white too.
    rgb = im.convert("RGB")
    nonwhite = Image.eval(rgb, lambda v: 255 - v).convert("L").point(lambda v: 255 if v > 10 else 0)
    white_box = nonwhite.getbbox()
    box = alpha_box if alpha_box and alpha_box != (0, 0, *im.size) else white_box
    if box:
        pad = 4
        box = (max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad))
        im = im.crop(box)
    if im.width > MAX_W:
        im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
    return im


def safe_name(sku: str) -> str:
    return re.sub(r"[^A-Za-z0-9.-]+", "_", sku.replace("+", "-Plus"))


def main() -> None:
    products: dict[str, dict] = {}
    for cat, kind in CATEGORIES.items():
        page = get(f"https://techspecs.ui.com/unifi/{cat}").decode("utf-8", "replace")
        for m in CARD_RE.finditer(page):
            sku = html.unescape(m["sku"]).strip()
            if sku in products:
                continue
            products[sku] = {
                "sku": sku,
                "name": html.unescape(m["name"]).strip(),
                "category": kind,
                "page": "https://techspecs.ui.com" + m["href"],
                "source": urllib.parse.unquote(html.unescape(m["u"])),
            }
        print(f"{cat}: {sum(1 for p in products.values() if p['category'] == kind)} products", file=sys.stderr)
    if len(products) < 50:
        sys.exit(f"only {len(products)} products parsed — the techspecs markup probably changed")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    def work(p: dict) -> dict:
        override = OVERRIDES.get(p["sku"])
        src = override["url"] if override else p["source"]
        im = Image.open(io.BytesIO(get(resized_url(src))))
        if override:
            im = override["fix"](im)
            p = {**p, "source": src, "note": override["note"]}
        im = trim(im)
        if p["sku"] in CLEAN:
            im = clean_device(im, CLEAN[p["sku"]])
            p = {**p, "note": "display switched off and printed model name removed"}
        file = f"{safe_name(p['sku'])}.webp"
        im.save(OUT_DIR / file, "WEBP", quality=86, method=6)
        return {**p, "file": f"/hardware/unifi/{file}", "aspect": round(im.width / im.height, 3)}

    with ThreadPoolExecutor(8) as ex:
        rows = sorted(ex.map(work, products.values()), key=lambda r: (r["category"], r["sku"]))
    MANIFEST.write_text(json.dumps(rows, indent=1) + "\n")
    print(f"wrote {len(rows)} photos to {OUT_DIR.relative_to(ROOT)} and {MANIFEST.relative_to(ROOT)}", file=sys.stderr)

    if "--sheet" in sys.argv:
        cell, cols = 260, 8
        sheet = Image.new("RGB", (cell * cols, (cell + 18) * ((len(rows) + cols - 1) // cols)), "white")
        d = ImageDraw.Draw(sheet)
        for i, r in enumerate(rows):
            im = Image.open(ROOT / "public" / r["file"].lstrip("/")).convert("RGBA")
            im.thumbnail((cell - 10, cell - 10))
            bg = Image.new("RGBA", im.size, "white")
            bg.alpha_composite(im)
            x, y = (i % cols) * cell, (i // cols) * (cell + 18)
            sheet.paste(bg.convert("RGB"), (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
            d.rectangle([x, y + cell, x + cell, y + cell + 18], fill=(30, 41, 59))
            d.text((x + 4, y + cell + 3), r["sku"], fill="yellow")
        out = ROOT / "unifi-photos-sheet.png"
        sheet.save(out)
        print(f"contact sheet: {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
