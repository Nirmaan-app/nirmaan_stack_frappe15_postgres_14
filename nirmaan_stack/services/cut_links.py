# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Which stored link looks cut by the old 140-character limit of five link fields (#1680).

The five fields were Data (varchar 140) until #1680 made them Small Text. A longer link pasted before then may have
been stored cut, and a cut link cannot be recovered from the database: its owners paste it again. This is the
rule that picks them out.

Pure: no site, no DB. The listing that reads the stored values is `cut_links_report.py`.
"""

import re

OLD_LIMIT = 140

# (doctype, field) -> the field that names the document a person opens to fix it: a child row's parent, or the
# bill's billing tracker.
LINK_FIELDS = {
    ("Design Tracker Task Child Table", "file_link"): "parent",
    ("Project Drive Link Child Table", "drive_link"): "parent",
    ("Customer PO Child Table", "customer_po_link"): "parent",
    ("Commission Report Task Child Table", "file_link"): "parent",
    ("Project Billing", "bill_document_link"): "billing_tracker",
}

# A link that stops on a parameter separator, or inside a `%XX` escape, was cut there.
_MID_PARAMETER = re.compile(r"([&?=]|%[0-9A-Fa-f]?)$")


def why_cut(value: str | None) -> str | None:
    """Why `value` looks cut, or None when it looks whole."""
    if not (value or "").strip():
        return None
    if len(value) == OLD_LIMIT or len(value.strip()) == OLD_LIMIT:
        return f"exactly {OLD_LIMIT} characters, the old limit"
    ending = _MID_PARAMETER.search(value.strip())
    if ending:
        return f"ends mid-parameter with `{ending.group(1)}`"
    return None
