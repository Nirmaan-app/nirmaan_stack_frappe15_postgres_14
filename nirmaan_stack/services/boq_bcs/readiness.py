# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""THE BCS readiness predicate -- defined once, for every caller (slice BCS-S6).

Readiness answers exactly one question: may a BCS cost value be written onto this committed
sheet+version? BCS is enabled for it AND both columns have been confirmed. Nothing else.

RELOCATED HERE FROM `api/boq/wizard/bcs.py` AT BCS-S6, and the move is structural, not tidying.
S6 registers BCS costs as a fifth opt-in CARRY layer, dispatched from
`api/boq/wizard/committed_carry.py`, which must ask this question about its DESTINATION sheet.
Asking it by importing `bcs` closes an import ring, verified at module level:

    committed_carry -> bcs -> pricing -> committed_carry
      (bcs.py imports `pricing`; pricing.py imports `committed_carry`)

`pricing.py`'s own header states the one-way rule this would have broken, and NO placement
inside `api/` avoids it -- `cross_boq_carry` imports both, `commit_pipeline` is a third
dependent. So the predicate moved DOWN to the layer both sides may import (api -> service is
the one legal direction). The precedent is exact: `committed_carry` already reaches
classification state through `services/boq_category/persist.py`, never the sibling api module.

⚠️ ONE DEFINITION. `api/boq/wizard/bcs.py` imports this name straight back, so `bcs.bcs_is_ready`
still resolves and every pre-existing caller is untouched. A second copy would be bad anywhere;
here the two copies would sit on either side of a carry and could disagree about the same sheet
at exactly the moment it mattered -- the plan read offering a layer the apply then silently
drops. Pinned by identity in `test_readiness.TestOneDefinition`.

⚠️⚠️ THE PACKAGE DOCSTRING IS NOW OUT OF DATE, and this module cannot fix it (BCS-S6 scope).
`services/boq_bcs/__init__.py` says of this package: "Nothing here may import from `api/`, touch
`frappe.db`, or read request context." That was written when the package held only `sources.py`,
a pure rule builder. THIS module reads `frappe.db` -- it must, since readiness is a fact about a
stored `BoQ Sheet` row -- exactly as `services/boq_category/persist.py` does. The api/ bar and
the request-context bar both still hold and are still load-bearing; only the `frappe.db` clause
is now false. It is owed a one-line correction in `__init__.py`, which was NOT in this slice's
file scope and is reported rather than made.

SCOPE (owner-locked, carried over verbatim from the pre-relocation docstring): this gates BCS
CELLS ONLY. It must NOT be ANDed into `save_cell_price`'s rate gate -- an unconfirmed BCS section
leaves ordinary client-facing pricing fully editable. `test_bcs.py` greps `pricing.py` to keep
that true.

Entry point: `bcs_is_ready(boq_name, sheet_name, committed_version) -> bool`
"""
import json

import frappe

_BOQ_SHEET = "BoQ Sheet"


def _coerce_int(value, field: str) -> int:
    """A DELIBERATE cross-layer duplicate of `pricing._coerce_int`, three lines long.

    It is copied rather than imported because importing it would re-close the very ring this
    module was created to break. It is copied rather than replaced with a bare `int()` because
    the pre-relocation predicate reached `pricing._coerce_int` through
    `pricing._current_sheet_name`, so a bare `int()` would change which EXCEPTION a malformed
    version raises -- from a named `frappe.ValidationError` a caller can voice, to a raw
    `ValueError` nobody handles.
    """
    try:
        return int(value)
    except (ValueError, TypeError):
        frappe.throw(f"{field} must be an integer.", title="Invalid field")


def _parse_json_value(value, default):
    """A stored JSON column may arrive parsed (dict) or raw (str) depending on read path.
    Twin of `bcs._parse_json_value`, which stays where it is -- `get_bcs_state` uses it for the
    same two columns and this module must not import `api/`."""
    if isinstance(value, str):
        if not value:
            return default
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return default
    return value if isinstance(value, (dict, list)) else default


def bcs_is_ready(boq_name, sheet_name, committed_version) -> bool:
    """THE readiness condition, defined ONCE and used by every BCS path: BCS is enabled for this
    sheet+version AND both columns have been confirmed.

    A pure read -- never mutates, never throws for a missing sheet (an uncommitted or
    re-committed-away version is simply not ready). sheet_name VERBATIM (#152).

    ⚠️ `committed_version` IS COERCED, and that is the one thing about this function a rewrite
    must not "simplify". The obvious model for a service-layer predicate over `BoQ Sheet` is
    `boq_category.persist.is_sheet_classification_frozen`, which filters on the same doctype and
    the same key but passes `committed_version` RAW. MEASURED AT BCS-S6, both halves:

      * a NUMERIC string is fine either way -- PostgreSQL casts the unknown-type literal `'1'`
        to bigint, so the raw form answers True exactly as the coerced one does. (The brief for
        this slice predicted a silent False here. It does not happen; the raw form was built and
        run to check.)
      * a NON-NUMERIC version is where the raw form fails, and it fails far worse than silently:
        PostgreSQL raises `invalid input syntax for type bigint`, which ABORTS THE ENCLOSING
        TRANSACTION (`InFailedSqlTransaction: current transaction is aborted, commands ignored
        until end of transaction block`) and takes every later statement with it. On the carry
        path that transaction also holds the rate writes, so a raw psycopg2 error would replace
        a named refusal and roll the whole carry back.

    That matters here more than it does at most call sites because THIS predicate's failure mode
    is a SILENT SKIP: a not-ready answer makes the carry land nothing, report zero and raise
    nothing, and the plan read shares the same predicate, so the dialog agrees with whatever it
    says. There is no error anywhere for a person to notice.
    """
    name = frappe.db.get_value(
        _BOQ_SHEET,
        {
            "boq": boq_name,
            "sheet_name": sheet_name,  # VERBATIM (#152)
            "commit_version": _coerce_int(committed_version, "committed_version"),
            "is_current": 1,
        },
        "name",
    )
    if not name:
        return False
    row = frappe.db.get_value(
        _BOQ_SHEET, name, ["bcs_enabled", "bcs_qty_source", "bcs_amount_source"], as_dict=True
    )
    if not row or not row.get("bcs_enabled"):
        return False
    qty = _parse_json_value(row.get("bcs_qty_source"), None)
    amount = _parse_json_value(row.get("bcs_amount_source"), None)
    return bool(qty and qty.get("columns")) and bool(amount and amount.get("columns"))
