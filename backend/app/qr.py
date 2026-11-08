import base64
import io
from urllib.parse import quote, urlencode

import qrcode


def build_upi_uri(upi_id: str, name: str, amount_paise: int, reference: str) -> str:
    params = {
        "pa": upi_id,
        "pn": name or "Merchant",
        "am": f"{amount_paise / 100:.2f}",
        "cu": "INR",
        "tn": reference,
        "tr": reference,
    }
    return "upi://pay?" + urlencode(params, quote_via=quote)


def qr_data_url(data: str) -> str:
    img = qrcode.make(data, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
