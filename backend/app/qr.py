import base64
import io
import re
from urllib.parse import quote, urlencode

import qrcode
from PIL import Image, ImageDraw
from qrcode.constants import ERROR_CORRECT_H


def build_upi_uri(upi_id: str, name: str, amount_paise: int, reference: str) -> str:
    params = {"pa": upi_id, "pn": name or "Merchant", "am": f"{amount_paise / 100:.2f}", "cu": "INR", "tn": reference, "tr": reference}
    return "upi://pay?" + urlencode(params, quote_via=quote)


def qr_data_url(data: str, logo_b64: str | None = None) -> str:
    """PNG data URL. With a logo, error correction is raised to H and the logo is centred (<= ~22% of width)."""
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H if logo_b64 else qrcode.constants.ERROR_CORRECT_M, box_size=8, border=2)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    if logo_b64:
        try:
            logo = Image.open(io.BytesIO(base64.b64decode(logo_b64))).convert("RGBA")
            size = int(img.width * 0.22)
            logo = logo.resize((size, size))
            pad = max(4, size // 10)
            plate = Image.new("RGBA", (size + 2 * pad, size + 2 * pad), (0, 0, 0, 0))
            ImageDraw.Draw(plate).rounded_rectangle((0, 0, plate.width - 1, plate.height - 1), radius=pad * 2, fill=(255, 255, 255, 255))
            plate.alpha_composite(logo, (pad, pad))
            img.paste(plate, ((img.width - plate.width) // 2, (img.height - plate.height) // 2), plate)
        except Exception:
            pass  # a bad logo must never break the QR
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def process_avatar(data_url: str) -> str:
    """Validate an uploaded image data URL and return a 160x160 PNG as base64. Raises ValueError."""
    m = re.fullmatch(r"data:image/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)", data_url or "")
    if not m:
        raise ValueError("Upload a PNG, JPG or WEBP image")
    raw = base64.b64decode(m.group(2))
    if len(raw) > 2_000_000:
        raise ValueError("Image is too large (max 2 MB)")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception:
        raise ValueError("That file is not a valid image")
    side = min(img.size)
    img = img.crop(((img.width - side) // 2, (img.height - side) // 2, (img.width + side) // 2, (img.height + side) // 2)).resize((160, 160))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()
