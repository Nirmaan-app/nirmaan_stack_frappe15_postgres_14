# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""List the stored links that look cut by the old 140-character limit (#1680). Read-only: writes nothing.

Run on a site:  bench --site <site> execute nirmaan_stack.services.cut_links_report.print_report
           or:  devenv.sh run execute nirmaan_stack.services.cut_links_report.print_report

The rule for "looks cut" is `cut_links.why_cut`.
"""

import frappe

from nirmaan_stack.services.cut_links import LINK_FIELDS, why_cut


def find_cut_links() -> list[dict]:
    """Every stored value of the five fields that looks cut: doctype, field, name, parent, length, why, value."""
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
