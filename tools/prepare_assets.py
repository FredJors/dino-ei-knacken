"""Bereitet die KI-Bilder aus ../Bilder für das Spiel auf (→ ../game/assets).

- Magenta-Hintergrund wird freigestellt (Flutfüllung vom Rand + weiche Kanten
  + Farb-"Entmischung", damit kein rosa Saum bleibt).
- Motive werden eng beschnitten und auf Spielgröße verkleinert.
- Hintergründe werden fertig auf 1080×1920 gerechnet (Felskante an der richtigen Höhe).

Aufruf:  python tools/prepare_assets.py
Benötigt: Pillow, numpy, scipy
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'Bilder')
DST = os.path.join(ROOT, 'game', 'assets')

# Hintergrund: Skalierung + Versatz so, dass die Felskante (Bühne) auf Höhe des Eis liegt
BG = {
    'bg_cave': {'scale': 1.62, 'top': 57},
    'bg_cave_boss': {'scale': 1.62, 'top': 140},
}

# Motive: Ziel-Höhe (bzw. Breite) nach dem Zuschnitt, Löcher füllen (zwischen Beinen o. Ä.)?
SPRITES = {
    **{f'egg_{i}': {'h': 560, 'holes': False} for i in range(1, 7)},
    'egg_boss': {'h': 640, 'holes': False},
    'meteor': {'max': 380, 'holes': False},
    'fg_rocks': {'w': 820, 'holes': True},
    **{f'dino_{k}': {'max': 440, 'holes': True} for k in [
        'trex', 'triceratops', 'stegosaurus', 'brachiosaurus', 'velociraptor',
        'ankylosaurus', 'parasaurolophus', 'spinosaurus', 'dilophosaurus', 'pteranodon']},
}


def find_src(name):
    for ext in ('.png', '.jpg', '.jpeg', '.webp'):
        p = os.path.join(SRC, name + ext)
        if os.path.exists(p):
            return p
    return None


def key_out(rgb, holes):
    """rgb: float32 HxWx3 → (rgb, alpha) mit freigestelltem Magenta-Hintergrund."""
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[:3].reshape(-1, 3), rgb[-3:].reshape(-1, 3),
                             rgb[:, :3].reshape(-1, 3), rgb[:, -3:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    # Magenta-Anteil: hoch bei R & B, niedrig bei G
    mag = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    bg_mag = min(bg[0], bg[2]) - bg[1]

    cand = (dist < 95) | ((mag > bg_mag * 0.62) & (dist < 140))
    lab, n = ndimage.label(cand)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bgmask = np.isin(lab, list(edge))
    if holes:
        tight = dist < 62
        lab2, n2 = ndimage.label(tight & ~bgmask)
        if n2:
            sizes = ndimage.sum(np.ones_like(dist), lab2, index=np.arange(1, n2 + 1))
            for i, s in enumerate(sizes, start=1):
                if s >= 40:
                    bgmask |= lab2 == i

    fg = ~bgmask
    fg = ndimage.binary_opening(fg, iterations=1)
    # weiche Kante: Band um die Grenze, Alpha aus dem Farbabstand
    inner = ndimage.binary_erosion(fg, iterations=3)
    band = fg & ~inner
    alpha = np.where(fg, 1.0, 0.0)
    a_band = np.clip((dist - 30) / 150.0, 0, 1)
    alpha = np.where(band, a_band, alpha)
    alpha = np.where(inner, 1.0, alpha)
    # Farbe entmischen: P = a*F + (1-a)*B  →  F = (P - (1-a)B) / a
    a3 = np.maximum(alpha, 1e-3)[..., None]
    unmixed = (rgb - (1 - alpha[..., None]) * bg) / a3
    out = np.where(band[..., None], unmixed, rgb)
    # Rest-Magenta im Saum dämpfen (R/B nicht weit über G hinaus)
    sp = np.minimum(out[..., 0], out[..., 2]) - out[..., 1]
    spill = band & (sp > 30)
    if spill.any():
        lim = out[..., 1] + 30
        out[..., 0] = np.where(spill, np.minimum(out[..., 0], np.maximum(lim, out[..., 0] * 0.8)), out[..., 0])
        out[..., 2] = np.where(spill, np.minimum(out[..., 2], np.maximum(lim, out[..., 2] * 0.8)), out[..., 2])
    alpha = ndimage.gaussian_filter(alpha, 0.6) * (alpha > 0)
    return np.clip(out, 0, 255), np.clip(alpha, 0, 1)


def process_sprite(name, cfg):
    src = find_src(name)
    if not src:
        print('  fehlt:', name)
        return
    im = Image.open(src).convert('RGB')
    rgb = np.asarray(im, dtype=np.float32)
    col, a = key_out(rgb, cfg.get('holes', False))
    ys, xs = np.where(a > 0.04)
    pad = 6
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad + 1)
    rgba = np.dstack([col, a * 255]).astype(np.uint8)[y0:y1, x0:x1]
    img = Image.fromarray(rgba, 'RGBA')
    w, h = img.size
    if 'h' in cfg:
        s = cfg['h'] / h
    elif 'w' in cfg:
        s = cfg['w'] / w
    else:
        s = cfg['max'] / max(w, h)
    s = min(s, 1.0)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    img = img.convert('RGBa').resize((nw, nh), Image.LANCZOS).convert('RGBA')
    out = os.path.join(DST, name + '.webp')
    img.save(out, 'WEBP', quality=90, method=6)
    print(f'  {name}: {nw}x{nh}  {os.path.getsize(out) // 1024} KB')


def process_bg(name, cfg):
    src = find_src(name)
    if not src:
        print('  fehlt:', name)
        return
    im = Image.open(src).convert('RGB')
    s = cfg['scale']
    w, h = round(im.width * s), round(im.height * s)
    im = im.resize((w, h), Image.LANCZOS)
    x0 = (w - 1080) // 2
    im = im.crop((x0, cfg['top'], x0 + 1080, cfg['top'] + 1920))
    im = im.filter(ImageFilter.UnsharpMask(radius=2, percent=45, threshold=2))
    out = os.path.join(DST, name + '.jpg')
    im.save(out, 'JPEG', quality=88, optimize=True, progressive=True)
    print(f'  {name}: 1080x1920  {os.path.getsize(out) // 1024} KB')


def main():
    os.makedirs(DST, exist_ok=True)
    only = set(sys.argv[1:])
    print('Hintergründe:')
    for n, c in BG.items():
        if not only or n in only:
            process_bg(n, c)
    print('Motive:')
    for n, c in SPRITES.items():
        if not only or n in only:
            process_sprite(n, c)


if __name__ == '__main__':
    main()
