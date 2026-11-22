"""Seamless 128x128 pixel-art stone wall tile, palette from Toby's blue-grey brick icon."""
import random
from PIL import Image

W = H = 128
BRICK_W, BRICK_H, MORTAR = 64, 32, 4
rng = random.Random(7)

# Palette (from the icon): mortar, brick base, highlight, shadow
MORTAR_C = [(67, 80, 102), (77, 92, 117), (81, 97, 123)]
BASE = (138, 156, 179)
HI = (190, 203, 219)
SH = (104, 117, 135)
DEEP = (85, 96, 111)


def shade(c, d):
    return tuple(max(0, min(255, v + d)) for v in c)


img = Image.new("RGB", (W, H))
px = img.load()

# mortar with speckle
for y in range(H):
    for x in range(W):
        px[x, y] = rng.choice(MORTAR_C)

rows = H // BRICK_H
for r in range(rows):
    off = 0 if r % 2 == 0 else BRICK_W // 2
    y0 = r * BRICK_H
    for b in range(-1, W // BRICK_W + 1):
        x0 = b * BRICK_W + off
        tone = rng.choice([-10, -5, 0, 0, 4, 8])  # per-brick variation
        base = shade(BASE, tone)
        bw, bh = BRICK_W - MORTAR, BRICK_H - MORTAR
        for dy in range(bh):
            for dx in range(bw):
                x = (x0 + dx) % W
                y = (y0 + dy) % H
                c = base
                # stepped bevel: light top/left, dark bottom/right
                if dy <= 1 or dx <= 1:
                    c = shade(HI, tone) if (dy == 0 or dx == 0) else shade(base, 14)
                elif dy >= bh - 2 or dx >= bw - 2:
                    c = shade(SH, tone) if (dy == bh - 1 or dx == bw - 1) else shade(base, -14)
                elif 3 <= dy <= 5 and 6 <= dx <= bw // 2:
                    c = shade(base, 22)  # top-face highlight strip like the icon
                else:
                    n = rng.random()
                    if n < 0.07:
                        c = shade(base, -14)
                    elif n < 0.09:
                        c = shade(base, 12)
                px[x, y] = c
        # chips on corners
        for _ in range(rng.randint(1, 4)):
            cx = x0 + rng.choice([0, 1, bw - 1, bw - 2])
            cy = y0 + rng.choice([0, 1, bh - 1, bh - 2])
            for ex in (0,1):
                for ey in (0,1):
                    if rng.random()<0.6: px[(cx+ex) % W, (cy+ey) % H] = rng.choice(MORTAR_C)
        # occasional crack
        if rng.random() < 0.25:
            cx = x0 + rng.randint(10, bw - 11)
            cy = y0 + 2
            for _ in range(rng.randint(4, bh - 4)):
                px[cx % W, cy % H] = DEEP
                cx += rng.choice([-1, 0, 0, 1])
                cy += 1
                if cy >= y0 + bh - 2:
                    break

img.save("wall_stone_128.png")
img.resize((512, 512), Image.NEAREST).save("wall_stone_128_preview4x.png")
tiled = Image.new("RGB", (W * 3, H * 3))
for i in range(3):
    for j in range(3):
        tiled.paste(img, (i * W, j * H))
tiled.resize((W * 3 * 2, H * 3 * 2), Image.NEAREST).save("wall_stone_tiled3x3.png")
print("done")
