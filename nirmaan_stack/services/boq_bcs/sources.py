# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The TWO BCS column confirmations -- the business rules, defined once.

BCS compares what a row costs US against what we charge the CLIENT, so it needs two
numbers off the committed sheet: the row's Total Quantity, and the row's combined Amount.
Neither is a single fixed column across BoQs -- a sheet may express either as one scalar
column or as several per-area columns -- so the human CONFIRMS which columns to use, once
per sheet, and that confirmation is stored re-resolvably.

This module owns the decisions in that sentence: what a valid quantity source is, what a
valid amount source is, and which combinations are refused. They were relocated out of
`api/boq/wizard/bcs.py` at slice BCS-S1a for the reason ADR-0010 B1 gives -- a calculation
or decision the business NAMES belongs in a pure service module, not inside a whitelisted
endpoint. The `boq_category.persist.node_is_qty_bearing` / `resolve_row_ladder`
relocations are the precedent, and this follows their shape.

PURITY CONTRACT (the seam): every function here is `(picks, descriptor index) -> dict`.
No `frappe.db`, no request context, no import from `api/`. `frappe.throw` is the ONE
framework touch, and it is deliberate -- a refusal here is a user-facing, named refusal,
and raising a bare ValueError would make every caller re-voice it.
"""
from __future__ import annotations

import frappe

# ── The two confirmations ────────────────────────────────────────────────────────
# QUANTITY. A sheet expresses its Total Quantity in one of exactly two shapes, and the
# confirmation records WHICH, so a later reader resolves the number instead of guessing:
#   scalar   -- one mapped qty_total column;
#   per-area -- N mapped per-area qty columns whose SUM is the total (the sheet has no
#               scalar total of its own).
# Mixing the two is REFUSED: summing a scalar total together with its own per-area parts
# double-counts the row.
_QTY_SCALAR_VALUE_FIELD = "qty_total"
_QTY_AREA_VALUE_FIELD = "qty_by_area"

# AMOUNT. The owner's "Amount (Combined)" IS the amount_total descriptor -- the scalar
# column recording what we charge the client, which is the denominator of % Profit.
# DELIBERATELY STRICT: a per-area amount column (amount_total_by_area) is NOT accepted
# here. Widening to that shape is a one-line change to _AMOUNT_COMBINED_VALUE_FIELDS with
# NO migration, so refusing now costs nothing and avoids inventing scope the owner did not
# name. See the slice record.
_AMOUNT_COMBINED_VALUE_FIELDS = frozenset({"amount_total"})


def _entry(desc: dict) -> dict:
    """One stored, RE-RESOLVABLE confirmation entry: the full descriptor identity, so a
    later reader resolves the value without re-deriving it from column_role_map."""
    return {
        "col": desc.get("col"),
        "role": desc.get("role"),
        "area": desc.get("area"),
        "value_field": desc.get("value_field"),
        "value_key": desc.get("value_key"),
    }


def build_qty_source(cols: list, index: dict) -> dict:
    """Validate the quantity picks and build the stored confirmation, or throw.

    Refuses: an empty selection; a column the sheet does not have; a mapped column that is
    not a quantity column; more than one scalar total; and a scalar total MIXED with
    per-area quantity columns (which would double-count)."""
    if not cols:
        frappe.throw(
            "Pick at least one quantity column: either the sheet's Total Quantity column "
            "or the per-area quantity columns that add up to it.",
            title="No quantity column picked",
        )
    picked = []
    for col in cols:
        desc = index.get(col)
        if not desc:
            frappe.throw(
                f"Column '{col}' is not a mapped column on this sheet. "
                f"Mapped columns: {', '.join(sorted(index)) or '(none)'}.",
                title="Unknown column",
            )
        picked.append(desc)

    fields = {d.get("value_field") for d in picked}
    if not fields <= {_QTY_SCALAR_VALUE_FIELD, _QTY_AREA_VALUE_FIELD}:
        bad = [d["col"] for d in picked
               if d.get("value_field") not in (_QTY_SCALAR_VALUE_FIELD,
                                               _QTY_AREA_VALUE_FIELD)]
        frappe.throw(
            f"Column(s) {', '.join(bad)} are not quantity columns on this sheet.",
            title="Not a quantity column",
        )
    if len(fields) > 1:
        frappe.throw(
            "Pick either the scalar Total Quantity column OR the per-area quantity "
            "columns -- not both. Adding a total to its own parts would count every "
            "quantity twice.",
            title="Mixed quantity sources",
        )

    if fields == {_QTY_SCALAR_VALUE_FIELD}:
        if len(picked) != 1:
            frappe.throw(
                "A sheet has exactly one Total Quantity column; pick one.",
                title="Too many total-quantity columns",
            )
        mode = "qty_total"
    else:
        mode = "qty_by_area"
    return {"mode": mode, "columns": [_entry(d) for d in picked]}


def build_amount_source(col: str, index: dict) -> dict:
    """Validate the amount pick and build the stored confirmation, or throw.

    The owner's 'Amount (Combined)' IS the amount_total descriptor -- what we charge the
    client, and the denominator of % Profit."""
    desc = index.get(col)
    if not desc:
        frappe.throw(
            f"Column '{col}' is not a mapped column on this sheet. "
            f"Mapped columns: {', '.join(sorted(index)) or '(none)'}.",
            title="Unknown column",
        )
    if desc.get("value_field") not in _AMOUNT_COMBINED_VALUE_FIELDS:
        frappe.throw(
            f"Column '{col}' is not this sheet's combined Amount column "
            f"(it is mapped as '{desc.get('role')}'). BCS compares its cost against the "
            f"amount charged to the client, so it needs the Amount (Combined) column.",
            title="Not the Amount (Combined) column",
        )
    return {"mode": "amount_total", "columns": [_entry(desc)]}
