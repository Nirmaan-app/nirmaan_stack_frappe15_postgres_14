# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Test helper: a stored file URL of real length (#1678). Every test that stores an uploaded file's URL uses it,
never a short hand-made one."""

import hashlib
import re
from urllib.parse import quote

_SHORTEST = 220


def cloud_url(file_name: str, doctype: str = "File") -> str:
    """A file URL as the cloud storage app (`frappe_gcp_attachment`) stores it, 200 to 270 characters.

    Production's shape: `generate_file?key=attachments/<day>/<doctype>/<8 random>_<name, `_` for spaces>` then
    `&file_name=<name, URL-encoded>`. Real ones run 141 to 299 characters (2026-10-28 data), so a short name is
    padded with " copy" before its extension until the URL is real length: a field too short for a real URL fails
    in the test, not on real data. The bug this exists for: spec #1637 made `Expense Bill.bill_file` a 140-character
    Data field, and every test passed on 94-character URLs."""
    stem, dot, ext = file_name.rpartition(".")
    if not dot:
        stem, ext = file_name, ""
    # The storage app picks 8 random characters; here they come from the name, so one name gives one URL and a
    # test can build the URL it expects again.
    prefix = hashlib.sha1(f"{doctype}/{file_name}".encode()).hexdigest()[:8].upper()
    while True:
        name = f"{stem}{dot}{ext}"
        key_name = re.sub(r"[^\w.\-]", "", name.replace(" ", "_"))
        url = (
            "/api/method/frappe_gcp_attachment.controller.generate_file"
            f"?key=attachments/2026/11/07/{doctype}/{prefix}_{key_name}&file_name={quote(name)}"
        )
        if len(url) >= _SHORTEST:
            return url
        stem += " copy"
