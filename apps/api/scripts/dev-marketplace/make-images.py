# Generates the development marketplace imagery (category cards, vendor logos, covers and gallery
# images) as flat illustrations from the Material Community Icons font that the mobile app already
# ships (Apache 2.0) and the Manrope typeface (OFL). No photographs of real businesses or people.
#
#   python3 make-images.py <data.json> <output dir>
# Needs Pillow. Paths to the fonts are resolved from apps/mobile/node_modules.
import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'mobile', 'node_modules'))
ICONS = os.path.join(ROOT, '@expo/vector-icons/build/vendor/react-native-vector-icons')
GLYPHS = json.load(open(os.path.join(ICONS, 'glyphmaps/MaterialCommunityIcons.json')))
ICON_FONT = os.path.join(ICONS, 'Fonts/MaterialCommunityIcons.ttf')
HEADING_FONT = os.path.join(ROOT, '@expo-google-fonts/manrope/800ExtraBold/Manrope_800ExtraBold.ttf')

# Per category: two background tones and the related glyphs used in its scenes.
THEMES = {
    'home-cleaning': (('#0F766E', '#5EC4B6'), ['broom', 'spray-bottle', 'vacuum-outline', 'bucket-outline', 'shimmer']),
    'plumbing': (('#1E56A8', '#6FA8F0'), ['pipe-wrench', 'faucet', 'water', 'pipe', 'water-pump']),
    'electrical-services': (('#875800', '#F5B83D'), ['flash', 'lightbulb-on-outline', 'power-plug-outline', 'ev-station', 'flash-outline']),
    'beauty-salon': (('#A3285C', '#F08DB8'), ['content-cut', 'hair-dryer-outline', 'lipstick', 'spray', 'shimmer']),
    'massage-wellness': (('#166534', '#7FD3A0'), ['spa-outline', 'flower-outline', 'candle', 'leaf', 'hand-heart-outline']),
    'photography': (('#5338C2', '#A897F5'), ['camera-outline', 'camera-iris', 'image-filter-hdr', 'flash-outline', 'shimmer']),
    'hvac-services': (('#035E8F', '#6CC5F0'), ['air-conditioner', 'thermometer', 'snowflake', 'fire', 'fan']),
    'lawn-garden': (('#3F6212', '#A3D16B'), ['grass', 'sprout-outline', 'flower-outline', 'tree-outline', 'shovel']),
    'handyman-services': (('#B23A0C', '#F59E6B'), ['hammer-wrench', 'screwdriver', 'toolbox-outline', 'ruler', 'tape-measure']),
    'moving-services': (('#3F35B5', '#9C95F2'), ['truck-outline', 'package-variant-closed', 'dolly', 'home-export-outline', 'map-marker-path']),
}


def glyph(name):
    code = GLYPHS.get(name) or GLYPHS['shape-outline']
    return chr(code)


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def gradient(size, c1, c2, angle=35):
    w, h = size
    img = Image.new('RGB', size)
    px = img.load()
    a = math.radians(angle)
    dx, dy = math.cos(a), math.sin(a)
    corners = [cx * dx + cy * dy for cx in (0, w) for cy in (0, h)]
    lo, span = min(corners), max(corners) - min(corners)
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            t = (x * dx + y * dy - lo) / span
            c = mix(c1, c2, t)
            for oy in (0, 1):
                for ox in (0, 1):
                    if x + ox < w and y + oy < h:
                        px[x + ox, y + oy] = c
    return img


def pattern(img, names, rng, count, size_range, alpha):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w, h = img.size
    for _ in range(count):
        s = rng.randint(*size_range)
        f = ImageFont.truetype(ICON_FONT, s)
        d.text((rng.randint(-s // 3, w - s // 2), rng.randint(-s // 3, h - s // 2)), glyph(rng.choice(names)), font=f, fill=(255, 255, 255, alpha))
    img.paste(layer, (0, 0), layer)


def badge(img, center, radius, name, fg):
    shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([center[0] - radius, center[1] - radius + radius * 0.08, center[0] + radius, center[1] + radius + radius * 0.08], fill=(0, 0, 0, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius * 0.08))
    img.paste(shadow, (0, 0), shadow)
    d = ImageDraw.Draw(img)
    d.ellipse([center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius], fill=(255, 255, 255))
    f = ImageFont.truetype(ICON_FONT, int(radius * 1.15))
    d.text(center, glyph(name), font=f, fill=fg, anchor='mm')


def scene(size, cat, seed, main, shade=0.0):
    (c1, c2), names = THEMES[cat]
    rng = random.Random(seed)
    a, b = hex_rgb(c1), hex_rgb(c2)
    if shade:
        a, b = mix(a, (20, 36, 58), shade), mix(b, (255, 255, 255), shade / 2)
    img = gradient(size, a, b, angle=rng.choice([25, 35, 145, 160]))
    pattern(img, names, rng, count=max(8, size[0] * size[1] // 60000), size_range=(size[1] // 10, size[1] // 4), alpha=26)
    return img, hex_rgb(c1), names


def initials(name):
    words = [w for w in name.replace('&', ' ').split() if w[0].isalnum()]
    return ''.join(w[0] for w in words[:2]).upper()


def main(data_path, out):
    data = json.load(open(data_path))
    os.makedirs(out, exist_ok=True)
    for i, c in enumerate(data['categories']):
        img, fg, names = scene((1200, 900), c['slug'], 100 + i, None)
        badge(img, (600, 450), 200, names[0], fg)
        img.save(os.path.join(out, f"category-{c['slug']}.jpg"), quality=86)
    for v in data['vendors']:
        cat = v['category']
        (c1, c2), names = THEMES[cat]
        n = v['n']
        shade = (n % 3) * 0.12
        # Logo: monogram on the category colour with the category glyph.
        logo = gradient((512, 512), mix(hex_rgb(c1), (20, 36, 58), shade), hex_rgb(c2), angle=45)
        d = ImageDraw.Draw(logo)
        d.text((256, 232), initials(v['name']), font=ImageFont.truetype(HEADING_FONT, 190), fill=(255, 255, 255), anchor='mm')
        d.text((256, 400), glyph(names[n % len(names)]), font=ImageFont.truetype(ICON_FONT, 90), fill=(255, 255, 255, 230), anchor='mm')
        logo.save(os.path.join(out, f"vendor-{n:02d}-logo.jpg"), quality=90)
        # Cover: wide scene, subject centred so 4:1 (web) and ~1.6:1 (app) crops both keep it.
        cover, fg, _ = scene((2000, 600), cat, 1000 + n, None, shade)
        for k, (dx, r) in enumerate([(-380, 120), (0, 175), (380, 120)]):
            badge(cover, (1000 + dx, 300), r, names[(n + k) % len(names)], fg)
        cover.save(os.path.join(out, f"vendor-{n:02d}-cover.jpg"), quality=86)
        # Gallery: three scenes, each built around a different related glyph.
        for g in range(3):
            img, fg, _ = scene((1200, 900), cat, 5000 + n * 10 + g, None, shade + g * 0.06)
            badge(img, (600, 450), 230, names[(n + g + 1) % len(names)], fg)
            img.save(os.path.join(out, f"vendor-{n:02d}-gallery-{g + 1}.jpg"), quality=86)
    print('images written to', out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
