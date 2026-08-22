"""S3-safe file materialisation for the Snag import wizard.

`frappe_s3_attachment` / `frappe_gcp_attachment` is active on this site: after a File
is inserted the plugin uploads the bytes to object storage, DELETES the local copy and
rewrites `file_url` to an API redirect
(`/api/method/frappe_gcp_attachment.controller.generate_file?key=<KEY>&file_name=<name>`).
`frappe.get_doc("File", ...).get_content()` reads LOCAL DISK ONLY, so it silently fails
for every stored workbook. Anything that needs a stored workbook's bytes must download
them and write them to a tempfile.

This is a deliberate small COPY of the BoQ wizard's twin
(`api/boq/wizard/parse_run._fetch_boq_file_to_tempfile`) rather than an import: that one
also runs BoQ-specific openpyxl workbook REPAIR, which the snag reader must not inherit,
and reaching across features for it is exactly the coupling ADR-0010 forbids.

Caller contract: unlink the returned path in a `finally` block.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import urllib.parse

import frappe

MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB
ALLOWED_EXTENSIONS = frozenset({".xlsx", ".xlsm"})

_S3_URL_MARKER = "frappe_gcp_attachment"


def _suffix_for(name: str) -> str:
    _, ext = os.path.splitext(name or "")
    ext = ext.lower()
    return ext if ext in ALLOWED_EXTENSIONS else ".xlsx"


def _derive_s3_key(file_url: str) -> str:
    """Return the object-storage key for a plugin-rewritten private file URL.

    Primary: the `key` query param the plugin puts on the URL.
    Fallback: the plugin also stores the key in the File row's `content_hash` column,
    so a direct DB lookup works when the URL has been stripped of its params.
    """
    params = urllib.parse.parse_qs(urllib.parse.urlparse(file_url).query)
    key_list = params.get("key")
    if key_list:
        return key_list[0]

    key = frappe.db.get_value("File", {"file_url": file_url}, "content_hash")
    if key:
        return key

    frappe.throw(
        f"Cannot derive the storage key from file_url: {file_url!r}.",
        title="Snag file not found",
    )


def _fetch_file_to_tempfile(file_url: str) -> str:
    """Materialise `file_url` to a NamedTemporaryFile; return its path.

    Routing (mirrors the BoQ twin):
      - URL without the plugin marker  -> local/dev path. `/private/...` and `/files/...`
        resolve through `frappe.get_site_path()`; a bare absolute path is used as-is
        (that is the path tests and fixtures take). The file is COPIED, so the caller's
        unlink can never destroy the source.
      - otherwise                      -> download from object storage.

    The tempfile is only created once the bytes are in hand on the S3 path, so a failed
    fetch never leaves an orphan.
    """
    if not file_url:
        frappe.throw("file_url is required.", title="Missing field: file_url")

    if _S3_URL_MARKER not in file_url:
        if file_url.startswith("/private/") or file_url.startswith("/files/"):
            local_path = frappe.get_site_path(file_url.lstrip("/"))
        else:
            local_path = file_url

        tmp = tempfile.NamedTemporaryFile(suffix=_suffix_for(local_path), delete=False)
        tmp.close()
        try:
            shutil.copy2(local_path, tmp.name)
        except Exception as exc:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
            frappe.throw(
                f"Failed to read the snag file: {exc}",
                title="File access failed",
            )
        return tmp.name

    from frappe_gcp_attachment.controller import S3Operations  # noqa: PLC0415

    params = urllib.parse.parse_qs(urllib.parse.urlparse(file_url).query)
    file_name_list = params.get("file_name")
    suffix = _suffix_for(urllib.parse.unquote(file_name_list[0])) if file_name_list else ".xlsx"

    key = _derive_s3_key(file_url)
    try:
        s3 = S3Operations()
        response = s3.read_file_from_s3(key)
        file_bytes = response["Body"].read()
    except Exception as exc:
        frappe.throw(
            f"Failed to fetch the snag file from storage (key={key!r}): {exc}",
            title="File fetch failed",
        )

    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(file_bytes)
    finally:
        tmp.close()

    return tmp.name


def write_bytes_to_tempfile(file_bytes: bytes, file_name: str) -> str:
    """Write freshly-uploaded bytes to a NamedTemporaryFile; return its path.

    The upload endpoint parses from THIS, never from a path built out of `file_url`
    (root CLAUDE.md, "BoQ File Reading (S3 safety)"): at the moment of upload the bytes
    are in memory and the stored file may already be gone from local disk.
    Caller unlinks in a `finally` block.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=_suffix_for(file_name), delete=False)
    try:
        tmp.write(file_bytes)
    finally:
        tmp.close()
    return tmp.name


def validate_upload(file_name: str, file_bytes: bytes) -> None:
    """Extension + size gate for an uploaded workbook. Throws on refusal."""
    _, ext = os.path.splitext(file_name or "")
    if ext.lower() not in ALLOWED_EXTENSIONS:
        frappe.throw(
            f"We support .xlsx and .xlsm files only. You uploaded a "
            f"{ext.lower() or 'file with no extension'}.",
            title="Unsupported file type",
        )

    if len(file_bytes) > MAX_FILE_BYTES:
        mb = len(file_bytes) / (1024 * 1024)
        frappe.throw(f"This file is {mb:.1f} MB. Maximum is 25 MB.", title="File too large")
