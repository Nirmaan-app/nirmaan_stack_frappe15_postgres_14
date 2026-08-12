# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ Rate Master Retirement -- the durable record of what has been deliberately retired.

WHY THIS EXISTS
---------------
`retired_kinds` and `retired_category_ids` are the ONLY two loader inputs consumed to drive
behaviour and never persisted: `_load_multi` reads them from the payload, hands them to
`_deactivate_scope`, and the entire effect is `active = 0` -- which is INDISTINGUISHABLE from an
ordinary supersede. There is no flag, no timestamp, no reason recorded anywhere. Once the database
becomes the source of truth and the asset is built FROM it, an export walking rows alone would drop
the lists silently.

WHY NOT DERIVE THEM
-------------------
The obvious derivation -- "a kind/category with rows but none active" -- was measured and matches the
four known entries exactly today. It was REJECTED anyway, and the decisive reason is that it returns
EMPTY on a fresh bootstrap database: the lists would vanish in precisely the case the asset exists to
serve. It is also coupled to history retention (archiving superseded rows would silently shrink it)
and cannot tell "deliberately retired" from "happens to have no active rows just now".

PAYLOAD IS THE INSTRUCTION, TABLE IS THE RECORD
-----------------------------------------------
This table is written by the loader as a SIDE EFFECT of a payload declaring a retirement. It is NEVER
read to drive deactivation -- `_deactivate_scope` still takes its scope from the payload alone.
Mixing the two would change import behaviour, which is deliberately out of scope.

UNIQUENESS IS STRUCTURAL, NOT CHECKED
-------------------------------------
`autoname` is `format:{discipline}::{scope_type}::{scope_value}`, so the primary key IS the
uniqueness constraint -- a duplicate is a PK collision, not a validation that could race or be
skipped. This mirrors the pricing lock's deterministic-PK precedent. No unique index and no
duplicate-checking validate hook is needed, and none is added.
"""

import frappe
from frappe.model.document import Document

SCOPE_TYPES = ("kind", "category")


class BoQRateMasterRetirement(Document):
    def validate(self):
        if not (self.discipline or "").strip():
            frappe.throw("discipline is required for a retirement record.")
        if not (self.scope_value or "").strip():
            frappe.throw("scope_value is required for a retirement record.")
        if self.scope_type not in SCOPE_TYPES:
            frappe.throw(
                "scope_type must be one of %s (got %r)." % (", ".join(SCOPE_TYPES), self.scope_type)
            )


def on_doctype_update():
    """Composite read index for the one query this table serves: every retirement for a discipline,
    split by axis. `discipline` and `scope_value` each carry their own single-column index via
    search_index on the field."""
    frappe.db.add_index("BoQ Rate Master Retirement", ["discipline", "scope_type"])
