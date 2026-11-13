"""Built-in QR centre logos, drawn with Pillow (no image files needed)."""
import base64
import io
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

S = 4  # supersampling factor
INK, BLUE, GREEN = (15, 23, 42, 255), (37, 99, 235, 255), (16, 185, 129, 255)

PRESETS = {
    "bolt": "Bolt", "rupee": "Rupee", "store": "Shop", "wallet": "Wallet",
    "heart": "Heart", "star": "Star", "initial": "Initial letter",
}


def _pts(points):
    return [(x * S, y * S) for x, y in points]


def _bolt(d):
    d.polygon(_pts([(94, 10), (38, 92), (76, 92), (62, 150), (124, 62), (84, 62)]), fill=BLUE)


def _rupee(d):
    w = 12 * S
    d.rounded_rectangle((38 * S, 34 * S, 122 * S, 34 * S + w), radius=w // 2, fill=INK)
    d.rounded_rectangle((38 * S, 62 * S, 122 * S, 62 * S + w), radius=w // 2, fill=INK)
    d.arc((22 * S, 34 * S, 112 * S, 112 * S), start=-90, end=90, fill=INK, width=w)
    d.line((44 * S, 106 * S, 118 * S, 148 * S), fill=INK, width=w, joint="curve")
    d.line((44 * S, 106 * S, 78 * S, 106 * S), fill=INK, width=w)


def _store(d):
    d.polygon(_pts([(22, 62), (36, 24), (124, 24), (138, 62)]), fill=BLUE)
    for i in range(4):
        x0 = 22 + i * 29
        d.pieslice((x0 * S, 44 * S, (x0 + 29) * S, 80 * S), 0, 180, fill=BLUE)
    d.rounded_rectangle((32 * S, 76 * S, 128 * S, 140 * S), radius=6 * S, fill=INK)
    d.rounded_rectangle((68 * S, 98 * S, 92 * S, 140 * S), radius=4 * S, fill=(255, 255, 255, 255))


def _wallet(d):
    d.rounded_rectangle((18 * S, 38 * S, 142 * S, 134 * S), radius=16 * S, fill=INK)
    d.rounded_rectangle((18 * S, 26 * S, 124 * S, 58 * S), radius=12 * S, fill=BLUE)
    d.rounded_rectangle((96 * S, 74 * S, 150 * S, 112 * S), radius=14 * S, fill=(255, 255, 255, 255))
    d.ellipse((108 * S, 86 * S, 126 * S, 104 * S), fill=GREEN)


def _heart(d):
    import math
    pts = []
    for i in range(0, 360, 4):
        t = math.radians(i)
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((80 + x * 4.2, 74 - y * 4.2))
    d.polygon(_pts(pts), fill=(225, 29, 72, 255))


def _star(d):
    import math
    pts = []
    for i in range(10):
        r = 66 if i % 2 == 0 else 28
        a = math.radians(-90 + i * 36)
        pts.append((80 + r * math.cos(a), 84 + r * math.sin(a)))
    d.polygon(_pts(pts), fill=(245, 158, 11, 255))


def _initial(d, letter):
    d.ellipse((12 * S, 12 * S, 148 * S, 148 * S), fill=BLUE)
    try:
        font = ImageFont.load_default(size=88 * S)
        box = d.textbbox((0, 0), letter, font=font)
        d.text((80 * S - (box[0] + box[2]) / 2, 80 * S - (box[1] + box[3]) / 2), letter, font=font, fill=(255, 255, 255, 255))
    except Exception:  # very old Pillow: draw a plain dot instead of failing
        d.ellipse((60 * S, 60 * S, 100 * S, 100 * S), fill=(255, 255, 255, 255))


@lru_cache(maxsize=64)
def preset_b64(preset_id: str, initial: str = "M") -> str:
    if preset_id not in PRESETS:
        raise ValueError("Unknown logo")
    img = Image.new("RGBA", (160 * S, 160 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if preset_id == "initial":
        _initial(d, (initial or "M")[:1].upper())
    else:
        {"bolt": _bolt, "rupee": _rupee, "store": _store, "wallet": _wallet, "heart": _heart, "star": _star}[preset_id](d)
    buf = io.BytesIO()
    img.resize((160, 160), Image.LANCZOS).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def initial_of(name: str | None) -> str:
    for ch in (name or ""):
        if ch.isalnum():
            return ch.upper()
    return "M"
