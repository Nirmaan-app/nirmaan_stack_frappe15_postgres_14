"""Rules for an employee e-signing their own asset declaration -- pure, no database.

The signing endpoint (`api/assets/declaration.sign_declaration`) loads the records and asks this module two
things: may this person sign this assignment now, and is the drawn signature a real, safe PNG. Keeping both
here makes them testable without a site and gives each rule one home.
"""

import base64
import binascii
import io

from PIL import Image, ImageOps

PNG_DATA_URI_PREFIX = "data:image/png;base64,"
MAX_SIGNATURE_BYTES = 500 * 1024
MAX_SIGNATURE_SIDE = 4000
# A pixel darker than this (0 = black, 255 = white) counts as ink. Leaves room for anti-aliasing haze.
INK_THRESHOLD = 215
SIGNATURE_PADDING = 12

# The "Asset Master Form" print format must contain this to place the signature. A format without it
# (never pasted, or put back by a fixture re-import on migrate) would print an UNSIGNED declaration.
PRINT_FORMAT_MARKER = "doc.declaration"

NOT_ASSIGNEE = "not_assignee"
ALREADY_SIGNED = "already_signed"
OUT_OF_SYNC = "out_of_sync"

NOT_PNG_MESSAGE = "The signature must be a PNG drawing."
TOO_LARGE_MESSAGE = "The signature image is too large."
UNREADABLE_MESSAGE = "The signature could not be read. Clear it and draw it again."
BLANK_MESSAGE = "Draw your signature before submitting."

REFUSAL_MESSAGES = {
    NOT_ASSIGNEE: "Only the person this asset is assigned to can sign its declaration.",
    ALREADY_SIGNED: "This assignment already has a declaration.",
    OUT_OF_SYNC: "This asset's holder and its assignment record don't match. Ask HR to fix the assignment before signing.",
}


def sign_refusal(signer: str, assigned_to: str, current_assignee: str | None, has_declaration: bool) -> str | None:
    """Return why `signer` may not sign this assignment (one of the refusal codes), or None if they may.

    `current_assignee` is the asset's holder on Asset Master. The declaration prints the holder's name, so an
    assignment that names someone else would produce a PDF with the wrong person on it.
    """
    if signer != assigned_to:
        return NOT_ASSIGNEE
    if has_declaration:
        return ALREADY_SIGNED
    if current_assignee != assigned_to:
        return OUT_OF_SYNC
    return None


def clean_signature_png(data_uri: str) -> bytes:
    """Check a drawn signature and return it as a cropped PNG on a white background.

    Accepts only a `data:image/png;base64,` URI of at most MAX_SIGNATURE_BYTES. Raises ValueError with a
    message for the person signing when the image is not a PNG, too large, or has no ink on it.
    """
    if not isinstance(data_uri, str) or not data_uri.startswith(PNG_DATA_URI_PREFIX):
        raise ValueError(NOT_PNG_MESSAGE)

    encoded = data_uri[len(PNG_DATA_URI_PREFIX):]
    if len(encoded) > MAX_SIGNATURE_BYTES * 4 // 3 + 4:
        raise ValueError(TOO_LARGE_MESSAGE)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError(UNREADABLE_MESSAGE) from None
    if len(raw) > MAX_SIGNATURE_BYTES:
        raise ValueError(TOO_LARGE_MESSAGE)

    # Read the header first: format and size are checked before any pixel is decoded.
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            image_format, width, height = probe.format, probe.width, probe.height
            probe.verify()
    except Image.DecompressionBombError:
        raise ValueError(TOO_LARGE_MESSAGE) from None
    except Exception:  # noqa: BLE001 -- PIL raises many types for a corrupt file; all mean "unreadable"
        raise ValueError(UNREADABLE_MESSAGE) from None
    if image_format != "PNG":
        raise ValueError(NOT_PNG_MESSAGE)
    if width > MAX_SIGNATURE_SIDE or height > MAX_SIGNATURE_SIDE:
        raise ValueError(TOO_LARGE_MESSAGE)

    # verify() leaves the image unusable; open it again to read the pixels.
    try:
        with Image.open(io.BytesIO(raw)) as image:
            rgba = image.convert("RGBA")
    except Exception:  # noqa: BLE001 -- see above
        raise ValueError(UNREADABLE_MESSAGE) from None

    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    flat = Image.alpha_composite(white, rgba).convert("RGB")

    ink = ImageOps.invert(flat.convert("L")).point(lambda p: 255 if p > 255 - INK_THRESHOLD else 0)
    box = ink.getbbox()
    if box is None:
        raise ValueError(BLANK_MESSAGE)

    left, top, right, bottom = box
    cropped = flat.crop((
        max(left - SIGNATURE_PADDING, 0),
        max(top - SIGNATURE_PADDING, 0),
        min(right + SIGNATURE_PADDING, flat.width),
        min(bottom + SIGNATURE_PADDING, flat.height),
    ))
    out = io.BytesIO()
    cropped.save(out, format="PNG", optimize=True)
    return out.getvalue()


def png_data_uri(png: bytes) -> str:
    """Wrap PNG bytes as a data URI for the print format (wkhtmltopdf has no session to fetch a file)."""
    return PNG_DATA_URI_PREFIX + base64.b64encode(png).decode("ascii")
