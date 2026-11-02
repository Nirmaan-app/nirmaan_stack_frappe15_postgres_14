# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The bill downloader: one bill link in, the file's bytes and type out, or why not (#1591).

PURE MODULE -- no `frappe`. The transport (`get`) and the pause between tries (`sleep`) are handed in,
defaulting to `requests.get` and `time.sleep`, so the guard is tested with faked responses. Spec #1585
"The bill downloader"; the Porter invoice fetch (`porter_validation.fetch_invoice_pdf`) is the precedent
for the streaming cap and the first-bytes check.

THE GUARD, all of it inside `download_bill` (the first host allowlist in the app):
- https only, host exactly `storage.googleapis.com`, path under
  `/prod-payments-private/transaction-attachments/` (no `..` segment);
- redirects off: a 3xx is a refusal, never followed;
- at most `MAX_BILL_BYTES`, counted while streaming, so an oversized answer is never held whole;
- the first bytes must be JPEG, PNG or PDF.

Retries: a timeout, a dropped connection or a 5xx is tried again, 3 times (4 tries in all). A 4xx is
final at once: an expired or revoked link does not come back.

A refusal is a value (`BillRefused`), never an exception: the import job records the reason on the line
and carries on.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable
from urllib.parse import unquote, urlsplit

import requests

__all__ = ["MAX_BILL_BYTES", "BillFile", "BillRefused", "download_bill"]

MAX_BILL_BYTES = 10 * 1024 * 1024
RETRIES = 3
TIMEOUT_SECONDS = 30

_HOST = "storage.googleapis.com"
_PATH_PREFIX = "/prod-payments-private/transaction-attachments/"
_CHUNK = 64 * 1024
_BACKOFF_SECONDS = (1, 2, 4)

_MAGIC = ((b"\xff\xd8\xff", "jpeg"), (b"\x89PNG\r\n\x1a\n", "png"), (b"%PDF-", "pdf"))


@dataclass(frozen=True)
class BillFile:
    content: bytes
    kind: str
    """`jpeg`, `png` or `pdf`, read from the first bytes (never from the link or a header)."""


@dataclass(frozen=True)
class BillRefused:
    reason: str
    """A lower-case clause that reads after "Bill not copied: "."""


class _Retry(Exception):
    def __init__(self, reason: str):
        self.reason = reason


def download_bill(
    url: str,
    *,
    get: Callable | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> BillFile | BillRefused:
    """Fetch one bill link through the guard. Never raises for anything the link or the storage does."""
    problem = _link_problem(url)
    if problem:
        return BillRefused(problem)
    get = get or requests.get
    reason = ""
    for attempt in range(RETRIES + 1):
        if attempt:
            sleep(_BACKOFF_SECONDS[min(attempt - 1, len(_BACKOFF_SECONDS) - 1)])
        try:
            return _fetch_once(url, get)
        except _Retry as retry:
            reason = retry.reason
    return BillRefused(f"{reason} after {RETRIES + 1} tries")


def _link_problem(url: str) -> str | None:
    parts = urlsplit((url or "").strip())
    if parts.scheme.lower() != "https":
        return "the link is not https"
    segments = unquote(parts.path).split("/")
    if (
        parts.hostname != _HOST
        or parts.username is not None
        or parts.port not in (None, 443)
        or not parts.path.startswith(_PATH_PREFIX)
        or ".." in segments
    ):
        return "the link is not on the wallet's bill storage"
    return None


def _fetch_once(url: str, get: Callable) -> BillFile | BillRefused:
    try:
        response = get(url.strip(), stream=True, timeout=TIMEOUT_SECONDS, allow_redirects=False)
    except requests.Timeout as exc:
        raise _Retry("the storage did not answer (timed out)") from exc
    except requests.ConnectionError as exc:
        raise _Retry("the connection to the storage failed") from exc
    except requests.RequestException as exc:
        return BillRefused(f"the request failed ({exc.__class__.__name__})")

    with response:
        status = response.status_code
        if 300 <= status < 400:
            return BillRefused("the storage answered with a redirect")
        if status >= 500:
            raise _Retry(f"the storage failed (HTTP {status})")
        if status >= 400:
            return BillRefused(f"the storage refused it (HTTP {status})")
        chunks: list[bytes] = []
        size = 0
        try:
            for chunk in response.iter_content(_CHUNK):
                size += len(chunk)
                if size > MAX_BILL_BYTES:
                    return BillRefused(f"the bill is larger than {MAX_BILL_BYTES // (1024 * 1024)} MB")
                chunks.append(chunk)
        except requests.Timeout as exc:
            raise _Retry("the storage did not answer (timed out)") from exc
        except requests.RequestException as exc:
            raise _Retry("the connection to the storage failed") from exc

    content = b"".join(chunks)
    for magic, kind in _MAGIC:
        if content.startswith(magic):
            return BillFile(content=content, kind=kind)
    return BillRefused("the file is not a JPEG, PNG or PDF")
