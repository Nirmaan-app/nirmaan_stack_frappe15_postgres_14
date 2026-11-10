# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Stored links that look cut by the old 140-character limit of five link fields (#1680). Read-only.

The five fields were Data (varchar 140) until #1680 made them Small Text. A longer link pasted before then may have
been stored cut, and a cut link cannot be recovered from the database: its owners paste it again. This lists each
one that looks cut, with its document and parent, so they can.

Run on a site:  bench --site <site> execute nirmaan_stack.services.cut_links.print_report
           or:  devenv.sh run execute nirmaan_stack.services.cut_links.print_report
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
    value = (value or "").strip()
    if not value:
        return None
    if len(value) == OLD_LIMIT:
        return f"exactly {OLD_LIMIT} characters, the old limit"
    ending = _MID_PARAMETER.search(value)
    if ending:
        return f"ends mid-parameter with `{ending.group(1)}`"
    return None


def find_cut_links() -> list[dict]:
    """Every stored value of the five fields that looks cut: doctype, field, name, parent, length, why, value."""
    import frappe

    found = []
    for (doctype, field), parent_field in LINK_FIELDS.items():
        rows = frappe.get_all(
            doctype,
            filters={field: ["is", "set"]},
            fields=["name", f"{parent_field} as parent", f"{field} as value"],
            order_by="name",
        )
        for row in rows:
            reason = why_cut(row.value)
            if reason:
                found.append(
                    {
                        "doctype": doctype,
                        "field": field,
                        "name": row.name,
                        "parent": row.parent,
                        "length": len(row.value.strip()),
                        "why": reason,
                        "value": row.value,
                    }
                )
    return found


def print_report() -> list[dict]:
    """Print the cut links, one per line, then a count per field. Writes nothing."""
    found = find_cut_links()
    for r in found:
        print(f"{r['doctype']}.{r['field']}\t{r['name']}\tparent {r['parent']}\t{r['length']} chars\t{r['why']}\t{r['value']}")
    for doctype, field in LINK_FIELDS:
        count = sum(1 for r in found if (r["doctype"], r["field"]) == (doctype, field))
        print(f"{doctype}.{field}: {count} look cut")
    return found
