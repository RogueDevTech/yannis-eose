#!/usr/bin/env python3
"""
Generate Yannis EOSE favicon/PWA icon set.

Design: Combines the logo's square-with-dot icon mark with the "Y" monogram.
- Rounded square background in brand blue (#1565C0)
- The logo's square frame outline (white) in the upper-left area
- A dot inside the square frame (matching the logo)
- A bold "Y" letterform that overlaps / integrates with the square mark
- 80% safe zone for maskable (10% padding each side)

Outputs:
  apps/web/public/assets/favicon-32.png    (32x32)
  apps/web/public/assets/icon-180.png      (180x180)
  apps/web/public/assets/icon-192.png      (192x192)
  apps/web/public/assets/icon-512-maskable.png (512x512)
"""

from PIL import Image, ImageDraw, ImageFont
import os

BRAND_BLUE = (21, 101, 192)       # #1565C0
BRAND_DARK = (13, 71, 161)        # #0d47a1
WHITE = (255, 255, 255)
WHITE_90 = (255, 255, 255, 230)   # slightly transparent white

OUT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', 'apps', 'web', 'public', 'assets'
)

def draw_rounded_rect(draw, xy, radius, fill):
    """Draw a rounded rectangle."""
    x0, y0, x1, y1 = xy
    # Corners
    draw.pieslice([x0, y0, x0 + 2*radius, y0 + 2*radius], 180, 270, fill=fill)
    draw.pieslice([x1 - 2*radius, y0, x1, y0 + 2*radius], 270, 360, fill=fill)
    draw.pieslice([x0, y1 - 2*radius, x0 + 2*radius, y1], 90, 180, fill=fill)
    draw.pieslice([x1 - 2*radius, y1 - 2*radius, x1, y1], 0, 90, fill=fill)
    # Fill center
    draw.rectangle([x0 + radius, y0, x1 - radius, y1], fill=fill)
    draw.rectangle([x0, y0 + radius, x1, y1 - radius], fill=fill)


def draw_rounded_rect_outline(draw, xy, radius, outline, width):
    """Draw a rounded rectangle outline using arcs and lines."""
    x0, y0, x1, y1 = xy
    # Top-left arc
    draw.arc([x0, y0, x0 + 2*radius, y0 + 2*radius], 180, 270, fill=outline, width=width)
    # Top-right arc
    draw.arc([x1 - 2*radius, y0, x1, y0 + 2*radius], 270, 360, fill=outline, width=width)
    # Bottom-left arc
    draw.arc([x0, y1 - 2*radius, x0 + 2*radius, y1], 90, 180, fill=outline, width=width)
    # Bottom-right arc
    draw.arc([x1 - 2*radius, y1 - 2*radius, x1, y1], 0, 90, fill=outline, width=width)
    # Lines
    draw.line([x0 + radius, y0, x1 - radius, y0], fill=outline, width=width)
    draw.line([x0 + radius, y1, x1 - radius, y1], fill=outline, width=width)
    draw.line([x0, y0 + radius, x0, y1 - radius], fill=outline, width=width)
    draw.line([x1, y0 + radius, x1, y1 - radius], fill=outline, width=width)


def generate_icon(size, is_maskable=False):
    """
    Generate a single icon at the given size.

    Design breakdown (relative to size):
    - Background: rounded square in brand blue
    - Logo mark: square frame outline + dot in upper-left quadrant
    - "Y" letterform: bold, positioned to overlap with the mark
    """
    # Use 4x supersampling for anti-aliasing
    ss = 4
    s = size * ss
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Maskable: full fill. Non-maskable: slight padding for rounded shape
    if is_maskable:
        pad = 0
        corner_r = int(s * 0.18)
    else:
        pad = int(s * 0.04)
        corner_r = int(s * 0.20)

    # Background rounded rectangle
    draw_rounded_rect(draw, (pad, pad, s - pad, s - pad), corner_r, BRAND_BLUE)

    # Safe zone for maskable = 10% from each edge
    safe_pad = int(s * 0.10) if is_maskable else int(s * 0.10)
    content_x0 = pad + safe_pad
    content_y0 = pad + safe_pad
    content_x1 = s - pad - safe_pad
    content_y1 = s - pad - safe_pad
    cw = content_x1 - content_x0  # content width
    ch = content_y1 - content_y0  # content height

    # ── Logo square frame (upper-left, ~40% of content area) ──────
    sq_size = int(cw * 0.36)
    sq_x0 = content_x0
    sq_y0 = content_y0 + int(ch * 0.08)
    sq_x1 = sq_x0 + sq_size
    sq_y1 = sq_y0 + sq_size
    sq_line_w = max(2, int(s * 0.018))
    sq_corner = max(2, int(sq_size * 0.08))

    draw_rounded_rect_outline(draw, (sq_x0, sq_y0, sq_x1, sq_y1), sq_corner, WHITE, sq_line_w)

    # Dot inside the square (lower-left area of the square, matching logo)
    dot_r = int(sq_size * 0.10)
    dot_cx = sq_x0 + int(sq_size * 0.28)
    dot_cy = sq_y0 + int(sq_size * 0.72)
    draw.ellipse(
        [dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r],
        fill=WHITE
    )

    # ── "Y" letterform ───────────────────────────────────────────
    # Position Y to the right of the square, slightly overlapping
    # We draw the Y using polygon shapes for pixel-perfect control

    y_left = sq_x1 - int(cw * 0.02)   # slight overlap with square
    y_right = content_x1
    y_top = content_y0 + int(ch * 0.05)
    y_bottom = content_y1 - int(ch * 0.02)
    y_width = y_right - y_left
    y_height = y_bottom - y_top

    # Y geometry: two diagonal arms meeting at a junction, then a vertical stem
    stroke_w = int(y_width * 0.22)     # stroke thickness
    junction_y = y_top + int(y_height * 0.48)  # where arms meet

    # Left arm of Y
    arm_l_top_left = (y_left, y_top)
    arm_l_top_right = (y_left + stroke_w, y_top)
    arm_l_mid_right = (y_left + int(y_width * 0.52), junction_y)
    arm_l_mid_left = (y_left + int(y_width * 0.52) - stroke_w, junction_y)

    draw.polygon([arm_l_top_left, arm_l_top_right, arm_l_mid_right, arm_l_mid_left], fill=WHITE)

    # Right arm of Y
    arm_r_top_right = (y_right, y_top)
    arm_r_top_left = (y_right - stroke_w, y_top)
    arm_r_mid_left = (y_left + int(y_width * 0.48), junction_y)
    arm_r_mid_right = (y_left + int(y_width * 0.48) + stroke_w, junction_y)

    draw.polygon([arm_r_top_left, arm_r_top_right, arm_r_mid_right, arm_r_mid_left], fill=WHITE)

    # Vertical stem of Y
    stem_cx = y_left + int(y_width * 0.50)
    stem_left = stem_cx - int(stroke_w * 0.5)
    stem_right = stem_cx + int(stroke_w * 0.5)
    stem_top = junction_y - int(stroke_w * 0.3)

    draw.rectangle([stem_left, stem_top, stem_right, y_bottom], fill=WHITE)

    # ── Subtle brand dark accent stripe at bottom ────────────────
    # Small accent at bottom of background for depth
    accent_h = int(s * 0.015)
    accent_y = s - pad - accent_h
    draw.rectangle([pad + corner_r, accent_y, s - pad - corner_r, s - pad], fill=BRAND_DARK)

    # Downsample with high-quality resampling
    img = img.resize((size, size), Image.LANCZOS)
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    sizes = {
        'favicon-32.png': (32, False),
        'icon-180.png': (180, False),
        'icon-192.png': (192, False),
        'icon-512-maskable.png': (512, True),
    }

    for filename, (size, maskable) in sizes.items():
        path = os.path.join(OUT_DIR, filename)
        img = generate_icon(size, is_maskable=maskable)
        img.save(path, 'PNG', optimize=True)
        file_kb = os.path.getsize(path) / 1024
        print(f'  {filename:30s} {size:>4d}x{size:<4d}  {file_kb:.1f} KB  {"(maskable)" if maskable else ""}')

    print(f'\nAll icons saved to {os.path.abspath(OUT_DIR)}')


if __name__ == '__main__':
    main()
