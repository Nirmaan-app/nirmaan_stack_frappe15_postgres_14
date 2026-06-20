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
  get_priced_rows(...)   -> dict   [whitelisted, GET-capable]  -- the overlay read
"""
from __future__ import annotations

import frappe

from nirmaan_stack.api.boq.wizard.review_screen import get_committed_rows

_PRICING = "BoQ Cell Pricing"
_BOQ_SHEET = "BoQ Sheet"
_NODE = "BOQ Nodes"

# A rate cell is the ONLY cell a price overlays onto. A column_descriptor identifies a
# rate cell by its value_field: per-area rates nest under "rate_by_area"; scalar rates use
# one of these singleton fields. Amount / qty descriptors use other value_fields and are
# NEVER stamped (a saved price must never land on an amount or qty cell).
_PER_AREA_RATE_FIELD = "rate_by_area"
_SCALAR_RATE_FIELDS = frozenset({"rate_supply", "rate_install", "rate_combined"})

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


@frappe.whitelist()
def get_priced_rows(boq_name: str = None, sheet_name: str = None) -> dict:
    """Return the committed rows for (boq_name, sheet_name) WITH the current saved prices
    merged in -- so the pricing grid consumes ONE already-merged structure instead of
    joining two reads on the client.

    Composes the two certified reads (it reimplements NEITHER):
      - get_committed_rows(boq, sheet)            [review_screen.py]
      - get_sheet_pricing(boq, sheet, version)    [this module]
    PURE READ -- never writes, never mutates the committed tier, never creates/changes a
    BoQ Cell Pricing record. @frappe.whitelist() bare (GET-capable; mirrors both sources).
    sheet_name is passed VERBATIM (#152) to both source calls -- never stripped. Arg /
    not-found guards are inherited from get_committed_rows (called first, throws on missing
    boq_name / sheet_name / unknown BOQs).

    THE MERGE (descriptor-driven -- col_letter is NOT on the committed row):
      - committed_version comes from get_committed_rows' (additive) commit_version key --
        the single source of truth for "which version is current"; it is passed to
        get_sheet_pricing so the prices read match the rows read.
      - Only RATE descriptors carry a price (value_field == "rate_by_area" or a scalar rate
        field); amount / qty descriptors are NEVER stamped.
      - The join is (price.excel_row == row.source_row_number) AND
        (price.col_letter == descriptor.col). source_row_number is the Excel row; row_index
        (= sort_order) is a DIFFERENT integer space and is NOT used for the join.
      - PRICED MARKER comes from the PRESENCE of a current price record + its is_filled,
        NEVER from a zero-check: a committed rate of 0.0 is a valid value, not "un-priced".
        For a priced cell the saved rate is stamped IN PLACE (the per-area nested cell
        rate_by_area[area][kind], or the scalar rate field) AND a parallel marker is set:
        priced_by_area[area][kind] = True for per-area cells, priced_<scalar field> = True
        for scalar cells. Un-priced cells keep their committed value and carry no marker.

    Returns:
      {
        "rows": [...],                # committed rows, rate cells stamped + markers added
        "column_descriptors": [...],  # passed through from get_committed_rows UNCHANGED
        "commit_version": <int|None>, # the version that was priced (None if uncommitted)
        "editable": True,             # RESERVED placeholder for the future lock slice
        "lock_info": None,            # RESERVED placeholder for the future lock slice
      }
    `editable` / `lock_info` are INERT placeholders ONLY -- reserved so a future
    single-editor-lock slice does not have to reshape this contract. No locking logic,
    lock doctype, or acquire/release exists or is built here.

    Graceful empties: an uncommitted / grid-only sheet (no committed rows, or no current
    version) returns the same shape with pricing merged as a no-op (no throw).
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.get_priced_rows
    """
    # get_committed_rows owns the arg / not-found guards (throws) + sheet_name VERBATIM.
    committed = get_committed_rows(boq_name=boq_name, sheet_name=sheet_name)
    rows = committed.get("rows") or []
    column_descriptors = committed.get("column_descriptors") or []
    commit_version = committed.get("commit_version")

    base = {
        "rows": rows,
        "column_descriptors": column_descriptors,
        "commit_version": commit_version,
        # RESERVED for the future single-editor-lock slice -- inert placeholders, no logic.
        "editable": True,
        "lock_info": None,
    }

    # Nothing committed (no rows or no current version) -> no-op merge, graceful passthrough.
    if not rows or commit_version is None:
        return base

    pricing = get_sheet_pricing(
        boq_name=boq_name, sheet_name=sheet_name, committed_version=commit_version
    )["pricing"]

    # Index current, FILLED prices by the durable cell key (excel_row, col_letter). The
    # is_filled gate (not a zero-check) is what makes a cell "priced"; a current record
    # that is not filled is treated as un-priced (its value is left untouched).
    price_by_cell = {
        (p["excel_row"], p["col_letter"]): p for p in pricing if p.get("is_filled")
    }
    if not price_by_cell:
        return base

    # Only RATE descriptors are eligible to receive a price (see _SCALAR_RATE_FIELDS doc).
    rate_descs = [
        d for d in column_descriptors
        if d.get("value_field") == _PER_AREA_RATE_FIELD
        or d.get("value_field") in _SCALAR_RATE_FIELDS
    ]

    for row in rows:
        excel_row = row.get("source_row_number")
        if excel_row is None:
            continue
        for d in rate_descs:
            price = price_by_cell.get((excel_row, d.get("col")))
            if price is None:
                continue  # un-priced: leave the committed value untouched, no marker
            rate_val = price.get("rate")
            if d.get("value_field") == _PER_AREA_RATE_FIELD:
                area = d.get("value_key")
                kind = d.get("rate_subkey")
                row.setdefault("rate_by_area", {}).setdefault(area, {})[kind] = rate_val
                row.setdefault("priced_by_area", {}).setdefault(area, {})[kind] = True
            else:
                field = d.get("value_field")  # a scalar rate field
                row[field] = rate_val
                row["priced_" + field] = True

    return base
