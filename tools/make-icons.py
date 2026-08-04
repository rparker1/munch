#!/usr/bin/env python3
"""Generate the Munch app icons.

No image libraries are available in this environment, so the icons are
rasterised here from signed distance fields (3x3 supersampled) and written as
PNGs by hand. Re-run after changing the mark:

    python3 tools/make-icons.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"

# --- palette (matches css/app.css) -----------------------------------------
# The plate is the same mint gradient as the hero card; the mark is the deep
# ink the app prints on top of any pastel fill.
MINT_LIGHT = (0xB4, 0xEC, 0xCF)
MINT_DARK = (0x5C, 0xC4, 0x95)
GLOW = (0xF9, 0xD0, 0x8A)      # amber, warming the top-right corner
MARK = (0x0B, 0x1F, 0x16)


# --- signed distance helpers ----------------------------------------------
def sd_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def sd_rounded_rect(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - r


def sd_ellipse(px, py, cx, cy, rx, ry):
    """Cheap ellipse: the unit-circle distance scaled back. Not exact away from the
    outline, which does not matter here — every use is a coverage test near the edge."""
    dx, dy = (px - cx) / rx, (py - cy) / ry
    return (math.hypot(dx, dy) - 1.0) * min(rx, ry)


def sd_capsule(px, py, ax, ay, bx, by, r):
    pax, pay = px - ax, py - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay
    h = 0.0 if denom == 0 else max(0.0, min(1.0, (pax * bax + pay * bay) / denom))
    return math.hypot(pax - bax * h, pay - bay * h) - r


def rotate(px, py, cx, cy, deg):
    a = math.radians(deg)
    dx, dy = px - cx, py - cy
    return (dx * math.cos(a) - dy * math.sin(a), dx * math.sin(a) + dy * math.cos(a))


def smin(a, b, k):
    """Smooth union. A plain min() leaves a visible crease where the head meets the
    handle; this blends them into one organic waist, which is what makes the mark read
    as a single utensil rather than two shapes stuck together."""
    h = max(0.0, 1.0 - abs(a - b) / k) if k > 0 else 0.0
    return min(a, b) - h * h * k * 0.25


# --- the mark, in a 0..1 square -------------------------------------------
# A spork: one broad head blended into a slim handle, with slots cut down from the
# top to make the tines. Built from a handful of exact primitives rather than a
# tapered cone, because a smooth union of a disc and a capsule gives the same
# silhouette for a fraction of the sampling cost.
HEAD_C = (0.5, 0.335)
HEAD_RX = 0.176          # taller than wide, so the head reads as a bowl not a ball
HEAD_RY = 0.212

HANDLE_TOP = (0.5, 0.520)
HANDLE_BOT = (0.5, 0.935)
HANDLE_R = 0.053

WAIST_K = 0.115          # how softly the head flows into the handle

TINE_XS = (-0.066, 0.0, 0.066)   # three slots, so four tines
TINE_TOP = 0.070         # above the head, so the slots open outward
TINE_BOT = 0.352
TINE_R = 0.0175


def sd_body(x, y):
    head = sd_ellipse(x, y, HEAD_C[0], HEAD_C[1], HEAD_RX, HEAD_RY)
    handle = sd_capsule(x, y, HANDLE_TOP[0], HANDLE_TOP[1],
                        HANDLE_BOT[0], HANDLE_BOT[1], HANDLE_R)
    return smin(head, handle, WAIST_K)


def sd_tines(x, y):
    d = 1e9
    for dx in TINE_XS:
        d = min(d, sd_capsule(x, y, 0.5 + dx, TINE_TOP, 0.5 + dx, TINE_BOT, TINE_R))
    return d


def sd_mark(x, y):
    return max(sd_body(x, y), -sd_tines(x, y))   # cut the slots back out


# --- background -----------------------------------------------------------
def background(x, y):
    """Diagonal green ramp with a warm glow in the top-right corner."""
    t = max(0.0, min(1.0, (x * 0.55 + y * 0.75)))
    t = t * t * (3 - 2 * t)  # smoothstep, so the ramp is not linear-flat
    r = MINT_LIGHT[0] + (MINT_DARK[0] - MINT_LIGHT[0]) * t
    g = MINT_LIGHT[1] + (MINT_DARK[1] - MINT_LIGHT[1]) * t
    b = MINT_LIGHT[2] + (MINT_DARK[2] - MINT_LIGHT[2]) * t

    glow = 1.0 - min(1.0, math.hypot(x - 1.06, y + 0.10) / 0.62)
    glow = max(0.0, glow) ** 1.8 * 0.75
    r += (GLOW[0] - r) * glow
    g += (GLOW[1] - g) * glow
    b += (GLOW[2] - b) * glow
    return r, g, b


# --- rasteriser -----------------------------------------------------------
SS = 3  # supersample factor per axis


def coverage(fn, x, y, step):
    """Fraction of a pixel covered by the shape `fn` (<0 inside)."""
    hits = 0
    for j in range(SS):
        for i in range(SS):
            sx = x + (i + 0.5) / SS * step
            sy = y + (j + 0.5) / SS * step
            if fn(sx, sy) < 0:
                hits += 1
    return hits / (SS * SS)


def render(size, *, rounded=True, mark_scale=1.0, corner=0.222):
    """Return RGBA bytes for one icon."""
    step = 1.0 / size
    rows = []

    def mark_fn(sx, sy):
        # Scale the mark about the centre so maskable icons keep a safe zone.
        mx = (sx - 0.5) / mark_scale + 0.5
        my = (sy - 0.5) / mark_scale + 0.5
        return sd_mark(mx, my)

    def plate_fn(sx, sy):
        if not rounded:
            return -1.0
        return sd_rounded_rect(sx, sy, 0.5, 0.5, 0.5, 0.5, corner)

    for py in range(size):
        row = bytearray()
        y = py * step
        for px in range(size):
            x = px * step
            plate = coverage(plate_fn, x, y, step)
            if plate <= 0:
                row += b"\x00\x00\x00\x00"
                continue

            r, g, b = background(x + step / 2, y + step / 2)
            m = coverage(mark_fn, x, y, step)
            if m > 0:
                r += (MARK[0] - r) * m
                g += (MARK[1] - g) * m
                b += (MARK[2] - b) * m

            a = int(round(plate * 255))
            row += bytes((int(round(r)), int(round(g)), int(round(b)), a))
        rows.append(bytes(row))
    return rows


# --- PNG writer -----------------------------------------------------------
def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: Path, rows: list[bytes], size: int) -> None:
    raw = b"".join(b"\x00" + r for r in rows)  # filter type 0 per scanline
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)
    print(f"  {path.name}  {size}x{size}  {len(png) / 1024:.1f} kB")


# --- SVG favicon ----------------------------------------------------------
def write_svg(path: Path) -> None:
    s = 64

    def c(v):
        return round(v * s, 2)

    # The mark is defined twice: as SDFs above for the PNGs, and as paths here for the
    # vector favicon. Keep them in step. The SVG cannot express the smooth waist the
    # smin() gives, so it overlaps a disc and a rounded handle instead — at the 16–32px
    # a favicon is actually drawn, the difference is invisible.
    hx, hy = HEAD_C
    slots = "\n    ".join(
        f'<rect x="{c(0.5 + dx - TINE_R)}" y="{c(TINE_TOP)}" '
        f'width="{c(TINE_R * 2)}" height="{c(TINE_BOT - TINE_TOP)}" rx="{c(TINE_R)}" '
        f'fill="url(#g)"/>'
        for dx in TINE_XS
    )

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}" role="img" aria-label="Munch">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#{MINT_LIGHT[0]:02X}{MINT_LIGHT[1]:02X}{MINT_LIGHT[2]:02X}"/>
      <stop offset="1" stop-color="#{MINT_DARK[0]:02X}{MINT_DARK[1]:02X}{MINT_DARK[2]:02X}"/>
    </linearGradient>
    <radialGradient id="w" cx="1.03" cy="-0.05" r="0.62">
      <stop offset="0" stop-color="#{GLOW[0]:02X}{GLOW[1]:02X}{GLOW[2]:02X}" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#{GLOW[0]:02X}{GLOW[1]:02X}{GLOW[2]:02X}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="{s}" height="{s}" rx="{c(0.222)}" fill="url(#g)"/>
  <rect width="{s}" height="{s}" rx="{c(0.222)}" fill="url(#w)"/>
  <g fill="#{MARK[0]:02X}{MARK[1]:02X}{MARK[2]:02X}">
    <ellipse cx="{c(hx)}" cy="{c(hy)}" rx="{c(HEAD_RX)}" ry="{c(HEAD_RY)}"/>
    <rect x="{c(0.5 - HANDLE_R)}" y="{c(HANDLE_TOP[1] - HANDLE_R)}"
          width="{c(HANDLE_R * 2)}" height="{c(HANDLE_BOT[1] - HANDLE_TOP[1] + HANDLE_R * 2)}"
          rx="{c(HANDLE_R)}"/>
  </g>
  {slots}
</svg>
"""
    path.write_text(svg)
    print(f"  {path.name}  vector  {len(svg) / 1024:.1f} kB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print("Writing icons to", OUT)

    write_png(OUT / "icon-192.png", render(192), 192)
    write_png(OUT / "icon-512.png", render(512), 512)
    # iOS applies its own mask, so this one is a full square.
    write_png(OUT / "apple-touch-icon.png", render(180, rounded=False), 180)
    # Maskable: full bleed, mark pulled in to the 80% safe zone.
    write_png(
        OUT / "icon-512-maskable.png",
        render(512, rounded=False, mark_scale=0.74),
        512,
    )
    write_svg(OUT / "favicon.svg")


if __name__ == "__main__":
    main()
