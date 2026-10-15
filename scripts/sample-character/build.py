#!/usr/bin/env python3
"""Draws Mugsy, the sample character, frame by frame and writes sprite atlases + manifest.

Mugsy is original artwork generated entirely by this script and dedicated to the public domain
(CC0-1.0). Requires Pillow (`pip install pillow`). Output: characters/sample/.

    python3 scripts/sample-character/build.py
"""
import json
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'characters', 'sample')
W, H = 150, 200          # frame size in image pixels
SS = 4                   # supersampling factor for smooth edges
INK = (43, 40, 46, 255)
CUP = (247, 242, 233, 255)
BAND = (228, 87, 46, 255)
COFFEE = (107, 62, 38, 255)
STEAM = (190, 190, 196, 200)
CHEEK = (240, 150, 140, 110)


def s(v):
    return int(round(v * SS))


def pt(x, y):
    return (s(x), s(y))


def draw_frame(*, bob=0.0, squash=1.0, tilt=0.0, legs=(0.0, 0.0), leg_len=26, arms=(0.0, 0.0),
               brows=0.0, eyes='open', mouth='flat', steam_phase=0.0, steam=True, look=0.0):
    """Returns one RGBA frame. Angles in degrees; brows 0 = neutral, 1 = deeply judgmental."""
    img = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lw = 4
    ground = H - 3
    # body box (before squash), anchored on the ground through the legs
    bw, bh = 76 * (2 - squash) ** 0.5, 104 * squash
    cx = W / 2
    bottom = ground - leg_len + bob
    top = bottom - bh

    # legs + shoes
    for i, ang in enumerate(legs):
        hx = cx + (-15 if i == 0 else 15)
        a = math.radians(ang)
        fx, fy = hx + math.sin(a) * leg_len, bottom + math.cos(a) * leg_len - bob
        d.line([pt(hx, bottom - 2), pt(fx, fy)], fill=INK, width=s(lw))
        d.ellipse([pt(fx - 9, fy - 5), pt(fx + 7, fy + 2)], fill=INK)

    body = Image.new('RGBA', img.size, (0, 0, 0, 0))
    b = ImageDraw.Draw(body)
    x0, x1 = cx - bw / 2, cx + bw / 2
    # handle
    b.ellipse([pt(x1 - 10, top + bh * 0.25), pt(x1 + 26, top + bh * 0.72)], outline=INK, width=s(lw + 3))
    b.ellipse([pt(x1 - 4, top + bh * 0.31), pt(x1 + 20, top + bh * 0.66)], outline=CUP, width=s(4))
    # cup
    b.rounded_rectangle([pt(x0, top), pt(x1, bottom)], radius=s(16), fill=CUP, outline=INK, width=s(lw))
    b.rectangle([pt(x0 + 2, top + bh * 0.62), pt(x1 - 2, top + bh * 0.62 + 12)], fill=BAND)
    # coffee surface
    b.ellipse([pt(x0 + 3, top - 7), pt(x1 - 3, top + 9)], fill=COFFEE, outline=INK, width=s(lw))
    # arms
    for i, ang in enumerate(arms):
        sx = x0 + 2 if i == 0 else x1 - 2
        a = math.radians(ang)
        dirx = -1 if i == 0 else 1
        ex, ey = sx + dirx * math.cos(a) * 18, top + bh * 0.55 - math.sin(a) * 18
        if i == 1:
            ex += 14  # step around the handle
        b.line([pt(sx, top + bh * 0.55), pt(ex, ey)], fill=INK, width=s(lw))
        b.ellipse([pt(ex - 4, ey - 4), pt(ex + 4, ey + 4)], fill=INK)
    # face
    ey = top + bh * 0.36
    for i, ex in enumerate((cx - 15 + look, cx + 15 + look)):
        if eyes == 'open':
            b.ellipse([pt(ex - 6, ey - 7), pt(ex + 6, ey + 7)], fill=INK)
            b.ellipse([pt(ex - 3 + look * 0.3, ey - 5), pt(ex + 1 + look * 0.3, ey - 1)], fill=(255, 255, 255, 255))
        elif eyes == 'narrow':
            b.line([pt(ex - 7, ey + 1), pt(ex + 7, ey + 1)], fill=INK, width=s(4))
        elif eyes == 'wide':
            b.ellipse([pt(ex - 8, ey - 9), pt(ex + 8, ey + 9)], fill=(255, 255, 255, 255), outline=INK, width=s(3))
            b.ellipse([pt(ex - 3, ey - 3), pt(ex + 3, ey + 3)], fill=INK)
        elif eyes == 'shut':
            b.arc([pt(ex - 7, ey - 5), pt(ex + 7, ey + 5)], 200, 340, fill=INK, width=s(3))
        # brows: inner end lowered when judging
        inner = 1 if i == 0 else -1
        bx0, bx1 = ex - 8, ex + 8
        yo = ey - 13
        drop = 7 * brows
        y_in, y_out = yo + drop, yo - drop * 0.3
        if i == 0:
            b.line([pt(bx0, y_out), pt(bx1, y_in)], fill=INK, width=s(3.5))
        else:
            b.line([pt(bx0, y_in), pt(bx1, y_out)], fill=INK, width=s(3.5))
        _ = inner
    # cheeks
    for ex in (cx - 26 + look, cx + 26 + look):
        b.ellipse([pt(ex - 6, ey + 8), pt(ex + 6, ey + 14)], fill=CHEEK)
    my = ey + 19
    if mouth == 'flat':
        b.line([pt(cx - 8 + look, my), pt(cx + 8 + look, my)], fill=INK, width=s(3.5))
    elif mouth == 'smirk':
        b.line([pt(cx - 8 + look, my + 1), pt(cx + 8 + look, my - 3)], fill=INK, width=s(3.5))
    elif mouth == 'o':
        b.ellipse([pt(cx - 5 + look, my - 4), pt(cx + 5 + look, my + 6)], fill=INK)
    elif mouth == 'wobble':
        b.line([pt(cx - 9, my), pt(cx - 3, my - 3), pt(cx + 3, my + 1), pt(cx + 9, my - 2)], fill=INK, width=s(3), joint='curve')

    if tilt:
        body = body.rotate(tilt, resample=Image.BICUBIC, center=pt(cx, bottom))
    img.alpha_composite(body)

    if steam:
        d = ImageDraw.Draw(img)
        for k, off in enumerate((-12, 10)):
            pts = []
            for j in range(9):
                yy = top - 14 - j * 4.2
                xx = cx + off + math.sin(steam_phase * 2 * math.pi + j * 0.8 + k * 1.7) * 4.5
                pts.append(pt(xx, yy))
            d.line(pts, fill=STEAM, width=s(3.2), joint='curve')

    return img.resize((W, H), Image.LANCZOS)


def clip_frames(name):
    f = []
    if name == 'idle':
        for i in range(10):
            p = i / 10
            f.append(draw_frame(bob=math.sin(p * 2 * math.pi) * 1.2, steam_phase=p, eyes='shut' if i == 7 else 'open'))
    elif name == 'walk':
        for i in range(8):
            p = i / 8
            sw = math.sin(p * 2 * math.pi) * 26
            f.append(draw_frame(bob=-abs(math.sin(p * 2 * math.pi)) * 3, legs=(sw, -sw), arms=(-sw * 0.6, sw * 0.6),
                                steam_phase=p, tilt=-3, look=3))
    elif name == 'judge':
        seq = [0.2, 0.5, 0.8, 1, 1, 1, 1, 1, 1, 1, 0.8, 0.4]
        for i, br in enumerate(seq):
            f.append(draw_frame(brows=br, eyes='narrow' if 2 <= i <= 9 else 'open', mouth='smirk' if i >= 5 else 'flat',
                                steam_phase=i / len(seq), look=-2 if i < 6 else 2))
    elif name == 'held':
        for i in range(8):
            p = i / 8
            sw = math.sin(p * 2 * math.pi) * 18
            f.append(draw_frame(legs=(sw + 8, sw - 8), leg_len=28, arms=(70, 70), eyes='wide', mouth='o',
                                tilt=math.sin(p * 2 * math.pi) * 5, steam=False, bob=-4))
    elif name == 'drop':
        seq = [(0.8, 'shut', 'o'), (0.7, 'shut', 'wobble'), (0.82, 'shut', 'wobble'), (0.95, 'open', 'wobble'),
               (1.04, 'open', 'flat'), (1.0, 'open', 'flat'), (0.98, 'open', 'flat'), (1.0, 'open', 'flat')]
        for i, (sq, e, m) in enumerate(seq):
            f.append(draw_frame(squash=sq, eyes=e, mouth=m, legs=(-30, 30) if i < 3 else (0, 0), steam=i > 4,
                                steam_phase=i / 8, arms=(-30, -30) if i < 3 else (0, 0)))
    return f


CLIPS = {
    # id: (frames, role, loop, load, ms per frame, mirror)
    'idle': ('idle', 'idle', True, 'initial', 160, False),
    'walk': ('walk', 'walk.right', True, 'initial', 105, True),
    'judge': ('judge', 'judge', False, 'lazy', 150, False),
    'held': ('held', 'held', True, 'lazy', 110, False),
    'drop': ('drop', 'drop', False, 'lazy', 110, False),
}


def alpha_bbox(frames):
    box = None
    for im in frames:
        b = im.getchannel('A').point(lambda a: 255 if a >= 64 else 0).getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box


def main():
    os.makedirs(os.path.join(OUT, 'atlas'), exist_ok=True)
    clips = {}
    for cid, (src, role, loop, load, ms, mirror) in CLIPS.items():
        frames = clip_frames(src)
        n = len(frames)
        cols = min(n, 8)
        rows = math.ceil(n / cols)
        atlas = Image.new('RGBA', (cols * W, rows * H), (0, 0, 0, 0))
        for i, im in enumerate(frames):
            atlas.alpha_composite(im, ((i % cols) * W, (i // cols) * H))
        path = os.path.join(OUT, 'atlas', f'{cid}.webp')
        atlas.save(path, 'WEBP', quality=82, alpha_quality=90, method=6, exact=False)
        x0, y0, x1, y1 = alpha_bbox(frames)
        clips[cid] = {
            'role': role,
            'loop': loop,
            'load': load,
            **({'mirror': True} if mirror else {}),
            'size': [W, H],
            'anchor': {'feet': [0.5, 1.0]},
            'hit': [x0, y0, x1 - x0, y1 - y0],
            'frameMs': [ms] * n,
            'durationMs': ms * n,
            'sources': [{
                'type': 'atlas', 'url': f'atlas/{cid}.webp', 'mime': 'image/webp',
                'bytes': os.path.getsize(path), 'grid': {'columns': cols, 'rows': rows, 'frames': n},
            }],
        }
        print(f'{cid:6} {n:2} frames  {os.path.getsize(path):6} bytes')

    manifest = {
        'schemaVersion': 1,
        'id': 'mugsy',
        'name': 'Mugsy',
        'licence': {'name': 'CC0-1.0', 'url': 'https://creativecommons.org/publicdomain/zero/1.0/'},
        'assetRevision': '1',
        'display': {'height': 170, 'minHeight': 110, 'walkSpeed': 70},
        'poster': {'clip': 'idle', 'frame': 0},
        'bubble': {'anchor': [0.5, 0.12]},
        'lines': json.load(open(os.path.join(os.path.dirname(__file__), 'lines.json'))),
        'clips': clips,
    }
    with open(os.path.join(OUT, 'character.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print('wrote', os.path.relpath(os.path.join(OUT, 'character.json'), ROOT))


if __name__ == '__main__':
    main()
