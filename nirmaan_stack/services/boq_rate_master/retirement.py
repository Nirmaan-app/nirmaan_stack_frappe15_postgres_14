# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Retirement state -- the ONE owning module for "what has been deliberately retired".

WHY IT EXISTS
-------------
`retired_kinds` and `retired_category_ids` are the only two loader inputs consumed to drive
behaviour and never persisted. `_load_multi` reads them from the payload, hands them to
`_deactivate_scope`, and the entire effect is `active = 0` -- INDISTINGUISHABLE from an ordinary
supersede. Once the database is the source of truth and the asset is built FROM it, an export
walking rows alone would drop the lists silently.

⚠️ PAYLOAD IS THE INSTRUCTION, TABLE IS THE RECORD.
`record_retirements` is called by the loader as a SIDE EFFECT of a payload declaring a retirement.
Nothing here is ever read to drive deactivation -- `_deactivate_scope` still takes its scope from the
payload alone. Mixing the two would change import behaviour, which is deliberately out of scope.

⚠️ DERIVATION WAS REJECTED, and the reason is not stylistic.
"A kind/category with rows but none active" matches the four known entries exactly on the current
database. It still cannot be used: it returns EMPTY on a fresh bootstrap database, so the lists would
vanish in precisely the case the asset exists to serve. It is also coupled to history retention
(archiving superseded rows would silently shrink it) and cannot tell "deliberately retired" from
"happens to have no active rows just now".

⚠️ KNOWN GAP, deliberately not fixed here: the SINGULAR-config loader path
(`loader.load_rate_master`, the branch taken by a payload carrying `category_config` rather than
`category_configs`) ignores the retirement lists ENTIRELY -- it never reads them and therefore never
records them. No shipped asset takes that branch, but the gap is real.
"""

import frappe

RETIREMENT_DOCTYPE = "BoQ Rate Master Retirement"

SCOPE_KIND = "kind"
SCOPE_CATEGORY = "category"


def _clean(values):
    """Non-blank, stripped, de-duplicated, order preserved."""
    out, seen = [], set()
    for v in values or []:
        s = (v or "").strip() if isinstance(v, str) else v
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out


def record_retirements(discipline, retired_kinds=None, retired_category_ids=None):
    """Record any retirement entries not already present for this discipline.

    IDEMPOTENT: the doctype's autoname is `format:{discipline}::{scope_type}::{scope_value}`, so an
    entry that already exists is skipped by an existence check and could not be duplicated anyway --
    a second insert would be a primary-key collision. Uniqueness is therefore STRUCTURAL, not a
    validation that can race or be skipped.

    ⚠️ `retired_at` / `retired_by` / `reason` are left EMPTY. The loader has never recorded when, by
    whom, or why; the only available signal is a batch creation timestamp, which is approximate. A
    field asserting a precision it does not have is worse than an empty one.

    Does NOT commit -- the caller owns the transaction (the loader commits once at the end).
    Returns {"created": [...], "existing": [...]} of "scope_type::scope_value" strings.
    """
    discipline = (discipline or "").strip()
    if not discipline:
        return {"created": [], "existing": []}

    pairs = [(SCOPE_KIND, v) for v in _clean(retired_kinds)]
    pairs += [(SCOPE_CATEGORY, v) for v in _clean(retired_category_ids)]

    created, existing = [], []
    for scope_type, scope_value in pairs:
        if frappe.db.exists(
            RETIREMENT_DOCTYPE,
            {"discipline": discipline, "scope_type": scope_type, "scope_value": scope_value},
        ):
            existing.append(f"{scope_type}::{scope_value}")
            continue
        frappe.get_doc(
            {
                "doctype": RETIREMENT_DOCTYPE,
                "discipline": discipline,
                "scope_type": scope_type,
                "scope_value": scope_value,
                # retired_at / retired_by / reason deliberately absent -- see the docstring.
            }
        ).insert(ignore_permissions=True)
        created.append(f"{scope_type}::{scope_value}")
    return {"created": created, "existing": existing}


def get_retirement_lists(discipline):
    """The current retirement state for a discipline, IN THE EXACT SHAPE THE ASSET USES.

    Returns {"retired_kinds": [...], "retired_category_ids": [...]} -- two lists of plain strings,
    sorted for a stable export. The export (a later slice) calls this instead of carrying the lists
    forward from the previous asset file.
    """
    rows = frappe.get_all(
        RETIREMENT_DOCTYPE,
        filters={"discipline": (discipline or "").strip()},
        fields=["scope_type", "scope_value"],
        order_by="scope_value asc",
    )
    return {
        "retired_kinds": sorted(
            r["scope_value"] for r in rows if r["scope_type"] == SCOPE_KIND
        ),
        "retired_category_ids": sorted(
            r["scope_value"] for r in rows if r["scope_type"] == SCOPE_CATEGORY
        ),
    }
