# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BoQ pricing layer -- per-cell rate persist + read (Phase 5 Slice 1b).

The pricing layer (doctype "BoQ Cell Pricing") sits ON TOP of the committed tier
and stores the RATE a user fills into a specific committed Excel cell WITHOUT
mutating the committed tier (BOQ Nodes / grid / BoQ Sheet stay capture-only).

A priced cell is identified by its DURABLE Excel address + the committed version it
prices: (boq, sheet_name [VERBATIM #152], excel_row, col_letter, committed_version).
Within a committed version, pricing has its OWN freeze-and-supersede lifecycle
(pricing_version / is_current / priced_at), mirroring the committed tier's pattern
(commit_pipeline._next_commit_version / _current_names): exactly ONE current pricing
record per (boq, sheet_name, excel_row, col_letter, committed_version).

This module is the minimal WRITE (save one rate to a cell) + READ (current pricing for
a (boq, sheet, committed_version)) path. The overlay-onto-get_committed_rows read, the
finalize-pricing endpoints, copy-forward, and the editor UI are LATER slices.

Public API:
  save_cell_price(...)   -> dict   [whitelisted POST]
  get_sheet_pricing(...) -> dict   [whitelisted, GET-capable]
"""
from __future__ import annotations

import frappe

_PRICING = "BoQ Cell Pricing"
_BOQ_SHEET = "BoQ Sheet"
_NODE = "BOQ Nodes"

# Pricing identity = the durable Excel address + the committed version it prices.
_IDENTITY_FIELDS = ("boq", "sheet_name", "excel_row", "col_letter", "committed_version")


def _coerce_int(value, field: str) -> int:
    try:
        return int(value)
    except (ValueError, TypeError):
        frappe.throw(f"{field} must be an integer.", title="Invalid field")


def _identity_filters(boq_name, sheet_name, excel_row, col_letter, committed_version) -> dict:
    """The per-cell identity filter (sheet_name + col_letter matched VERBATIM #152)."""
    return {
        "boq": boq_name,
        "sheet_name": sheet_name,
        "excel_row": excel_row,
        "col_letter": col_letter,
        "committed_version": committed_version,
    }


def _current_pricing_names(boq_name, sheet_name, excel_row, col_letter, committed_version) -> list:
    """Names of the is_current=1 pricing record(s) for one cell identity. Mirrors
    commit_pipeline._current_names -- normally returns 0 or 1 name (the invariant)."""
    filters = _identity_filters(boq_name, sheet_name, excel_row, col_letter, committed_version)
    filters["is_current"] = 1
    return frappe.get_all(_PRICING, filters=filters, pluck="name")


def _next_pricing_version(boq_name, sheet_name, excel_row, col_letter, committed_version) -> int:
    """The next pricing version for one cell identity = max prior + 1 (first save = 1).
    Mirrors commit_pipeline._next_commit_version."""
    agg = frappe.get_all(
        _PRICING,
        filters=_identity_filters(boq_name, sheet_name, excel_row, col_letter, committed_version),
        fields=["max(pricing_version) as mv"],
    )
    return ((agg[0].mv if agg else None) or 0) + 1


def _resolve_committed_cell(boq_name, sheet_name, excel_row, committed_version):
    """Resolve + VALIDATE that a committed cell exists at (boq, sheet_name, excel_row) for
    the given committed_version. Returns the committed BOQ Nodes name (the node ref to store).
    Throws if the committed sheet or node at that address/version does not exist -- never
    create a price for a non-existent cell. sheet_name matched VERBATIM (#152)."""
    bqsh = frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": boq_name, "sheet_name": sheet_name, "commit_version": committed_version},
        "name",
    )
    if not bqsh:
        frappe.throw(
            f"No committed sheet '{sheet_name}' at committed_version {committed_version} "
            f"for BoQ '{boq_name}'.",
            title="No committed sheet",
        )
    node_name = frappe.db.get_value(
        _NODE,
        {
            "boq": boq_name,
            "sheet": bqsh,
            "source_row_number": excel_row,
            "commit_version": committed_version,
        },
        "name",
    )
    if not node_name:
        frappe.throw(
            f"No committed cell (node) at Excel row {excel_row} on sheet '{sheet_name}' "
            f"(committed_version {committed_version}).",
            title="No committed cell",
        )
    return node_name


@frappe.whitelist(methods=["POST"])
def save_cell_price(
    boq_name: str = None,
    sheet_name: str = None,
    excel_row=None,
    col_letter: str = None,
    committed_version=None,
    rate=None,
    area: str = None,
    rate_kind: str = None,
    description: str = None,
) -> dict:
    """Save a rate into one committed Excel cell -- upsert the CURRENT pricing record for
    that cell (freeze-and-supersede): freeze any prior current (set_value is_current=0),
    insert the new current (is_current=1, pricing_version=max(prior)+1, is_filled=1,
    priced_at=now). The committed sheet + node at that address/version MUST exist (resolved
    + validated server-side; the resolved node is stored as the re-resolvable pointer).

    Identity = (boq, sheet_name [VERBATIM #152], excel_row, col_letter, committed_version);
    col_letter is stored (it is not on the node). area / rate_kind / description are stored
    as semantic/guard fields, NOT part of the key. The committed tier is NOT mutated.

    Returns {ok, name, pricing_version, is_current, is_filled, froze_prior}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.save_cell_price
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if excel_row is None or excel_row == "":
        frappe.throw("excel_row is required.", title="Missing field: excel_row")
    if not col_letter:
        frappe.throw("col_letter is required.", title="Missing field: col_letter")
    if committed_version is None or committed_version == "":
        frappe.throw("committed_version is required.", title="Missing field: committed_version")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    excel_row = _coerce_int(excel_row, "excel_row")
    committed_version = _coerce_int(committed_version, "committed_version")
    try:
        rate_val = float(rate) if rate is not None and rate != "" else 0.0
    except (ValueError, TypeError):
        frappe.throw("rate must be a number.", title="Invalid rate")

    # The cell must exist in the committed tier (also yields the node pointer to store).
    node_name = _resolve_committed_cell(boq_name, sheet_name, excel_row, committed_version)

    # Freeze-and-supersede: freeze any prior current via set_value (NEVER doc.save), then
    # insert the new current under the next pricing version. Mirrors the committed tier.
    prior = _current_pricing_names(boq_name, sheet_name, excel_row, col_letter, committed_version)
    for name in prior:
        frappe.db.set_value(_PRICING, name, "is_current", 0)

    pricing_version = _next_pricing_version(
        boq_name, sheet_name, excel_row, col_letter, committed_version
    )

    doc = frappe.new_doc(_PRICING)
    doc.boq = boq_name
    doc.sheet_name = sheet_name  # VERBATIM (#152)
    doc.excel_row = excel_row
    doc.col_letter = col_letter
    doc.committed_version = committed_version
    doc.node = node_name
    doc.area = area
    doc.rate_kind = rate_kind
    doc.description = description
    doc.rate = rate_val
    doc.is_filled = 1
    doc.pricing_version = pricing_version
    doc.is_current = 1
    doc.priced_at = frappe.utils.now()
    doc.is_finalized = 0
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "ok": True,
        "name": doc.name,
        "pricing_version": pricing_version,
        "is_current": 1,
        "is_filled": 1,
        "froze_prior": len(prior),
    }


@frappe.whitelist()
def get_sheet_pricing(
    boq_name: str = None, sheet_name: str = None, committed_version=None
) -> dict:
    """Return the CURRENT pricing records (is_current=1) for one committed (boq, sheet,
    committed_version) -- the raw pricing layer a later slice overlays onto the
    get_committed_rows contract, and the version-view feature reads.

    @frappe.whitelist() bare -- GET-capable (mirrors get_review_rows / get_committed_rows).
    Pure read. sheet_name matched VERBATIM (#152).

    Returns {"pricing": [{<current BoQ Cell Pricing fields>}, ...]} (empty when unpriced).
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.get_sheet_pricing
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if committed_version is None or committed_version == "":
        frappe.throw("committed_version is required.", title="Missing field: committed_version")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    committed_version = _coerce_int(committed_version, "committed_version")

    pricing = frappe.get_all(
        _PRICING,
        filters={
            "boq": boq_name,
            "sheet_name": sheet_name,
            "committed_version": committed_version,
            "is_current": 1,
        },
        fields=[
            "name", "boq", "sheet_name", "excel_row", "col_letter", "committed_version",
            "node", "area", "rate_kind", "description",
            "rate", "is_filled", "pricing_version", "is_current", "priced_at", "is_finalized",
        ],
        order_by="excel_row asc, col_letter asc",
    )
    return {"pricing": pricing}
