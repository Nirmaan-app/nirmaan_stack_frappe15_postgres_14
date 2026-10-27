# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The Version rows the Payee module reads as history (spec #1420, ADR-0033).

Some Payee facts are read from history rather than stored: when a Payee's holder name last changed
(the Payee page), when a vendor was linked to its Payee (Linked Vendors) and who last changed an
expense's Payee (Record Payment's "Named by"). Each is "the latest Version row of this record whose
diff changed this field", in the shape Frappe's own `Version.set_diff` writes:
`{"changed": [["<field>", <before>, <after>], ...]}`, compact, so a field change is found by
`changed_field_pattern`. Every record these read has `track_changes`, so its saves write the rows.

* `last_field_change` -- `{owner, creation}` of the latest row changing a field, or None.
* `changed_field_pattern` -- the LIKE pattern a query passes as a parameter to find such rows.
"""

from __future__ import annotations

import frappe


def changed_field_pattern(field: str) -> str:
    """The `LIKE` pattern of a Version row whose diff changed `field`. Pass it as a query parameter."""
    return f'%["{field}",%'


def last_field_change(doctype: str, name: str, field: str) -> dict | None:
    """`{owner, creation}` of the latest Version row of `doctype` `name` that changed `field`, or None."""
    rows = frappe.db.sql(
        """SELECT owner, creation FROM "tabVersion"
           WHERE ref_doctype = %(doctype)s AND docname = %(name)s AND data LIKE %(pattern)s
           ORDER BY creation DESC LIMIT 1""",
        {"doctype": doctype, "name": name, "pattern": changed_field_pattern(field)},
        as_dict=True,
    )
    return rows[0] if rows else None
