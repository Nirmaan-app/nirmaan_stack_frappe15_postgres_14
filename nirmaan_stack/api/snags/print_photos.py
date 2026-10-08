"""Snag photos for the "Project Snag" print format (owner 2026-10-08: one photo per snag, shown
50x50 in an Attachment column, and again larger on the photo pages at the end of the report).

WHY EMBEDDED: the photo is a PRIVATE file, and neither wkhtmltopdf nor the Download All job has a
session to fetch it with -- a bare `<img src="/api/method/...generate_file...">` renders as a
broken image. So every photo is fetched server-side and embedded as a data URI, like the HOD
prints do (`api/hod/print_context._data_uri`).

WHY SHRUNK HERE, NOT STORED: the owner ruled out a stored thumbnail field. A report holds every
snag of a project, so the photos are fetched IN PARALLEL, once per render, and each download is
encoded twice before it goes into the PDF -- the full photo would make the file balloon:
  - `thumb`: a small CROPPED square for the table's Attachment column;
  - `grid`: a larger PADDED square for the photo pages. Padded, never cropped: a snag photo is
    evidence, and the defect may sit at its edge.
Both are squared here because wkhtmltopdf's WebKit predates CSS `object-fit`.

A photo that cannot be fetched is logged once per render: it never fails the PDF.
"""

from __future__ import annotations

import base64
import functools
import io
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import frappe
import requests

from nirmaan_stack.api.pdf_helper.pdf_merger_api import fetch_attachment_content

#: Drawn at 50x50 in the PDF. Three times that, so it stays sharp when printed.
THUMB_PX = 150
#: Drawn about 42 mm wide on the photo pages (4 per row): ~240 dpi. The PDF's size is the cost --
#: one of these is ~25-35 KB -- so lower this (or the quality) if a big project's file grows too far.
GRID_PX = 400
GRID_QUALITY = 70
#: The padding around a photo that is not square: the print format's light grey (#F3F4F6).
GRID_PAD_RGB = (243, 244, 246)
#: Parallel downloads per render. Enough to hide GCS latency without hammering the bucket.
FETCH_WORKERS = 16
#: (connect, read), PER ATTEMPT. Short on purpose: a stored snag photo is a small JPEG (shrunk
#: before upload; 14-363 KB on localhost), so a read this slow has stalled, and a stalled read
#: does not recover by waiting -- a fresh request does (`FETCH_ATTEMPTS`).
FETCH_TIMEOUT_SECONDS = (5, 10)
#: Tries per cloud photo, each with a NEWLY SIGNED URL. A GCS read now and then stalls on an
#: ordinary small file (a 70 KB photo printed as unavailable, 2026-10-08).
FETCH_ATTEMPTS = 3
#: Pause before retry n is n times this. The PDF is built in a background job, so a few seconds
#: cost nothing a user waits on.
FETCH_RETRY_PAUSE_SECONDS = 1
#: Answers worth asking again: throttled, or a server-side hiccup. A 403 / 404 never heals.
_RETRY_STATUSES = {429, 500, 502, 503, 504}

_GCS_PROXY = "frappe_gcp_attachment.controller.generate_file"


def snag_print_photos(rows) -> dict:
    """`{snag name: {"thumb", "grid"}}` for every row in `rows` that has a photo.

    `rows` are the snag rows the print format already fetched (each with `name` and
    `attachment`), so this makes no query of its own.
      - `thumb` -- a THUMB_PX cropped-square JPEG data URI, or None when the photo could not be
        fetched;
      - `grid`  -- a GRID_PX padded-square JPEG data URI (the whole photo), or None likewise.
    Exposed to Jinja through `hooks.py` `jinja.methods`.
    """
    photos = {row.get("name"): row.get("attachment") for row in rows or [] if row.get("attachment")}
    if not photos:
        return {}

    images = _encoded(set(photos.values()))
    result = {}
    for name, url in photos.items():
        thumb, grid = images.get(url) or (None, None)
        result[name] = {"thumb": thumb, "grid": grid}
    return result


def _encoded(urls) -> dict:
    """`{url: (thumb, grid)}` for every photo that could be fetched. Failures are logged once."""
    sources, failed = _sources(urls)
    images = {}
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        for url, (pair, error) in zip(sources, pool.map(_encode, sources.values())):
            if pair:
                images[url] = pair
            else:
                failed[url] = error
    if failed:
        frappe.log_error(
            title=f"Snag print: {len(failed)} photo(s) not embedded",
            message="\n\n".join(f"{url}\n{error}" for url, error in failed.items()),
        )
    return images

def _sources(urls):
    """`(sources, failed)`: each photo resolved, ON THIS THREAD, to what a worker can fetch
    without Frappe, or `{url: reason}` when it cannot be.

    A cloud photo becomes a way to SIGN its URL, not a signed URL: the worker signs it the moment
    before its download (signing is local -- the service-account key, no network). Signing every
    URL up front let the later ones expire (`signed_url_expiry_time`, ~2 min) while a big render
    was still working through the earlier ones, and those photos printed as unavailable.
    Anything else is read here, since reading it needs the site context the workers lack.
    Only a SITE path is fetched: a snag photo is always one (the `before_save` controller
    insists on a File uploaded to the snag), and `fetch_attachment_content` would request an
    absolute URL from the server.
    """
    sources, failed, gcs = {}, {}, None
    for url in urls:
        if not url.startswith("/") or url.startswith("//"):
            failed[url] = "not a file on this site"
            continue
        try:
            if _GCS_PROXY in url:
                if gcs is None:
                    from frappe_gcp_attachment.controller import S3Operations

                    gcs = S3Operations()
                query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
                sign = functools.partial(
                    gcs.get_url, query["key"][0], (query.get("file_name") or [None])[0]
                )
                sources[url] = ("gcs", sign)
            else:
                content = fetch_attachment_content(url)
                if content:
                    sources[url] = ("bytes", content)
                else:
                    failed[url] = "not readable"
        except Exception:
            failed[url] = frappe.get_traceback()
    return sources, failed


def _encode(source):
    """`((thumb, grid), None)` or `(None, error)`. Runs on a worker thread: NO Frappe calls here
    (`gcs.get_url` reads only the settings it already loaded, and signs locally)."""
    kind, value = source
    try:
        if kind == "gcs":
            value = _download(value)
        return encode_photo(value), None
    except Exception as e:
        return None, repr(e)


def _download(sign) -> bytes:
    """A cloud photo's bytes: up to FETCH_ATTEMPTS tries, each signing a fresh URL, retrying
    only what can heal (a timeout, a dropped connection, `_RETRY_STATUSES`)."""
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            response = requests.get(sign(), timeout=FETCH_TIMEOUT_SECONDS)
            response.raise_for_status()
            return response.content
        except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            heals = not isinstance(e, requests.HTTPError) or status in _RETRY_STATUSES
            if not heals or attempt == FETCH_ATTEMPTS:
                raise
            time.sleep(FETCH_RETRY_PAUSE_SECONDS * attempt)


def encode_photo(content: bytes) -> tuple[str, str]:
    """`(thumb, grid)` JPEG data URIs for one photo's bytes. Pure: no Frappe, no network.

    `thumb` is cropped to a THUMB_PX square; `grid` keeps the WHOLE photo, scaled to fit a
    GRID_PX square and padded with GRID_PAD_RGB.
    """
    from PIL import Image, ImageOps

    img = Image.open(io.BytesIO(content))
    # Decode a JPEG at a fraction of its size: far faster, and both copies are shrunk anyway.
    # `draft` never goes below the size asked for, so the grid copy is still a downscale.
    img.draft("RGB", (GRID_PX, GRID_PX))
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")
    thumb = _data_uri(ImageOps.fit(img, (THUMB_PX, THUMB_PX)), quality=75)
    grid = _data_uri(ImageOps.pad(img, (GRID_PX, GRID_PX), color=GRID_PAD_RGB), quality=GRID_QUALITY)
    return thumb, grid


def _data_uri(img, *, quality: int) -> str:
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=quality)
    return f"data:image/jpeg;base64,{base64.b64encode(out.getvalue()).decode()}"
