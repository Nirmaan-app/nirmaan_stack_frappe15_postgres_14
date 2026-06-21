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
  save_cell_price(...)          -> dict   [whitelisted POST]
  get_sheet_pricing(...)        -> dict   [whitelisted, GET-capable]
  get_priced_rows(...)          -> dict   [whitelisted, GET-capable]  -- the overlay read
  get_committed_sheet_grid(...) -> dict   [whitelisted, GET-capable]  -- the faithful grid
"""
from __future__ import annotations

import json

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.api.boq.wizard.review_screen import get_committed_rows
from nirmaan_stack.api.boq.wizard.pricing_lock import acquire_or_refresh, read_lock_info

_PRICING = "BoQ Cell Pricing"
_BOQ_SHEET = "BoQ Sheet"
_NODE = "BOQ Nodes"
_GRID = "BoQ Committed Sheet Grid"
_GRID_ROW = "BoQ Committed Sheet Grid Row"

# A rate cell is the ONLY cell a price overlays onto. A column_descriptor identifies a
# rate cell by its value_field: per-area rates nest under "rate_by_area"; scalar rates use
# one of these singleton fields. Amount / qty descriptors use other value_fields and are
# NEVER stamped (a saved price must never land on an amount or qty cell).
_PER_AREA_RATE_FIELD = "rate_by_area"
_SCALAR_RATE_FIELDS = frozenset({"rate_supply", "rate_install", "rate_combined"})

# PRICEABILITY axis (Slice 3e): a rate may be saved only on a committed row whose node_type
# is one of these (verbatim). Every other type ("Other" -- note/spacer/subtotal/header_repeat)
# is non-priceable and is rejected by save_cell_price UNLESS the per-sheet override is asserted.
_PRICEABLE_NODE_TYPES = frozenset({"Preamble", "Line Item"})

# Pricing identity = the durable Excel address + the committed version it prices.
_IDENTITY_FIELDS = ("boq", "sheet_name", "excel_row", "col_letter", "committed_version")

# ── Annotation layers (Slice 4a) -- per-ROW remark + per-CELL color ───────────────
# Two ADDITIVE doctypes that sit ON TOP of the committed tier exactly like BoQ Cell
# Pricing (anchored to the durable Excel address + committed version, own freeze-and-
# supersede triple) -- but they carry NO rate/priceability/lock-identity semantics, so
# they are separate doctypes (NOT folded onto BoQ Cell Pricing). The committed tier is
# NEVER mutated. DATA SHEETS ONLY -- general-specs (grid-only) sheets are read-only and
# get no annotation (get_committed_sheet_grid / SheetDataGrid are untouched).
_REMARK = "BoQ Cell Remark"
_COLOR = "BoQ Cell Color"

# Per-row remark cap -- mirrors review_screen._REMARK_MAX_LEN (the review-screen remark).
_REMARK_MAX_LEN = 250

# The 8 color tokens (stable strings, NOT hex -- the frontend maps token -> swatch).
# MUST stay in sync with the Select options in boq_cell_color.json.
_COLOR_TOKENS = frozenset({"red", "orange", "yellow", "green", "blue", "purple", "pink", "grey"})


def _parse_json_field(value, default):
    """Return a stored JSON field's value as a Python object. The committed BoQ Sheet JSON
    columns are written via json.dumps (so a raw read returns a str) but some read paths
    (get_value as_dict) hand back an already-parsed dict/list -- handle both. None / "" /
    a parse failure fall back to `default`."""
    if value is None or value == "":
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return default
    return value


def _coerce_int(value, field: str) -> int:
    try:
        return int(value)
    except (ValueError, TypeError):
        frappe.throw(f"{field} must be an integer.", title="Invalid field")


def _coerce_bool(value) -> bool:
    """HTTP-safe truthiness: a whitelisted endpoint receives a STRING over HTTP, so the
    real bools True/1 AND the string forms "true"/"1"/"yes"/"on" all read truthy; everything
    else (None, "", "false", "0") is False. Mirrors the force_reparse coercion convention."""
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "on"}
    return bool(value)


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


def _resolve_committed_cell(boq_name, sheet_name, excel_row, committed_version) -> dict:
    """Resolve + VALIDATE that a committed cell exists at (boq, sheet_name, excel_row) for
    the given committed_version. Returns {"name": <BOQ Nodes name>, "node_type": <str>} -- the
    node ref to store + its PRICEABILITY axis (resolved at the SAME get_value, no extra query,
    for the Slice-3e priceability guard). Throws if the committed sheet or node at that
    address/version does not exist -- never create a price for a non-existent cell. sheet_name
    matched VERBATIM (#152)."""
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
    node = frappe.db.get_value(
        _NODE,
        {
            "boq": boq_name,
            "sheet": bqsh,
            "source_row_number": excel_row,
            "commit_version": committed_version,
        },
        ["name", "node_type"],
        as_dict=True,
    )
    if not node:
        frappe.throw(
            f"No committed cell (node) at Excel row {excel_row} on sheet '{sheet_name}' "
            f"(committed_version {committed_version}).",
            title="No committed cell",
        )
    return node


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
    allow_non_priceable=None,
) -> dict:
    """Save a rate into one committed Excel cell -- upsert the CURRENT pricing record for
    that cell (freeze-and-supersede): freeze any prior current (set_value is_current=0),
    insert the new current (is_current=1, pricing_version=max(prior)+1, is_filled=1,
    priced_at=now). The committed sheet + node at that address/version MUST exist (resolved
    + validated server-side; the resolved node is stored as the re-resolvable pointer).

    Identity = (boq, sheet_name [VERBATIM #152], excel_row, col_letter, committed_version);
    col_letter is stored (it is not on the node). area / rate_kind / description are stored
    as semantic/guard fields, NOT part of the key. The committed tier is NOT mutated.

    PRICEABILITY GUARD (Slice 3e -- a DELIBERATE, RECORDED §6 loosening of the §0 "server
    always rejects" rule): a rate may be saved only on a committed row whose node_type is
    priceable (Preamble / Line Item). A non-priceable row ("Other") is REJECTED by default;
    it is ACCEPTED only when `allow_non_priceable` is asserted (HTTP-coerced) -- the per-sheet
    override the human deliberately turns on. An override-priced cell (a rate on a
    non-priceable row) is a DERIVABLE "needs review" anomaly (node_type rides the read row +
    the priced flag) -- NO marker field is stamped.

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

    # The cell must exist in the committed tier (also yields the node pointer + node_type).
    node = _resolve_committed_cell(boq_name, sheet_name, excel_row, committed_version)
    node_name = node["name"]

    # PRICEABILITY GUARD (Slice 3e). Placed AFTER the committed-cell check (a non-cell still
    # throws first) and BEFORE the lock acquire / the freeze+insert below, so a REJECTED
    # non-priceable write mutates NOTHING (mirrors the lock reject-mutates-nothing discipline).
    # DELIBERATE, RECORDED §6 loosening: reject a non-priceable row by default, accept it ONLY
    # when the human asserts the per-sheet override (allow_non_priceable, HTTP-coerced).
    if node.get("node_type") not in _PRICEABLE_NODE_TYPES and not _coerce_bool(allow_non_priceable):
        frappe.throw(
            f"This row is not priceable (node type: {node.get('node_type') or 'unknown'}). "
            f"Enable the override to price it.",
            title="Not priceable",
        )

    # Single-editor lock (acquire-on-first-edit). Placed AFTER the committed-cell check (a
    # non-cell still throws first) and BEFORE the freeze/insert below, so a REJECTED save
    # (the sheet is held fresh by ANOTHER user) mutates NOTHING. The lock acquire/refresh/
    # takeover write shares THIS request's transaction + the single trailing commit below,
    # so the lock-touch and the price write land atomically together. Holder = session user.
    acquire_or_refresh(
        boq_name, sheet_name, committed_version, frappe.session.user, now_datetime()
    )

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


# ── Annotation write/read helpers (Slice 4a) ─────────────────────────────────────
# Freeze-and-supersede plumbing mirroring _current_pricing_names / _next_pricing_version,
# generalized over a doctype + its version field (the per-row remark has no col_letter).

def _annot_identity_filters(boq_name, sheet_name, excel_row, committed_version, col_letter=None):
    """Identity filter for an annotation record. col_letter is included ONLY for the
    per-cell color layer (the per-row remark omits it). sheet_name VERBATIM (#152)."""
    filters = {
        "boq": boq_name,
        "sheet_name": sheet_name,
        "excel_row": excel_row,
        "committed_version": committed_version,
    }
    if col_letter is not None:
        filters["col_letter"] = col_letter
    return filters


def _current_annot_names(doctype, boq_name, sheet_name, excel_row, committed_version, col_letter=None):
    """Names of the is_current=1 annotation record(s) for one identity (0 or 1 -- the
    invariant). Mirrors _current_pricing_names."""
    filters = _annot_identity_filters(boq_name, sheet_name, excel_row, committed_version, col_letter)
    filters["is_current"] = 1
    return frappe.get_all(doctype, filters=filters, pluck="name")


def _next_annot_version(doctype, version_field, boq_name, sheet_name, excel_row, committed_version, col_letter=None):
    """The next version for one annotation identity = max prior + 1 (first save = 1).
    Mirrors _next_pricing_version."""
    agg = frappe.get_all(
        doctype,
        filters=_annot_identity_filters(boq_name, sheet_name, excel_row, committed_version, col_letter),
        fields=[f"max({version_field}) as mv"],
    )
    return ((agg[0].mv if agg else None) or 0) + 1


@frappe.whitelist(methods=["POST"])
def save_row_remark(
    boq_name: str = None,
    sheet_name: str = None,
    excel_row=None,
    committed_version=None,
    remark: str = None,
    description: str = None,
) -> dict:
    """Save a per-ROW remark onto one committed Excel row -- upsert the CURRENT remark
    record for that row (freeze-and-supersede), mirroring save_cell_price.

    Identity = (boq, sheet_name [VERBATIM #152], excel_row, committed_version). The
    committed row at that address/version MUST exist (resolved + validated server-side via
    the SAME row-level _resolve_committed_cell save_cell_price uses -- it keys on the node's
    source_row_number, NOT col_letter, and a remark is allowed on ANY row, so its node_type
    is IGNORED here, no priceability gate). The committed tier is NOT mutated.

    LOCK: acquires/refreshes the single-editor lock (acquire_or_refresh) exactly like
    save_cell_price -- placed AFTER the row-resolve, BEFORE any freeze/insert, so a lock
    rejection (held fresh by another user) mutates NOTHING.

    CLEAR semantics: a blank / whitespace-only remark CLEARS -- it freezes the prior
    current (is_current=0) and inserts NO new current, so the row then has no is_current
    record and reads as "no remark" (it will not appear in the review-list).

    `description` is stored as the copy-forward MATCH GUARD (a future-slice carry, like
    BoQ Cell Pricing.description) -- not part of the key, never branched on.

    Returns {ok, name, remark_version, is_current, froze_prior, cleared}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.save_row_remark
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if excel_row is None or excel_row == "":
        frappe.throw("excel_row is required.", title="Missing field: excel_row")
    if committed_version is None or committed_version == "":
        frappe.throw("committed_version is required.", title="Missing field: committed_version")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    excel_row = _coerce_int(excel_row, "excel_row")
    committed_version = _coerce_int(committed_version, "committed_version")

    # Normalize: blank/whitespace-only -> None (clears the remark).
    if isinstance(remark, str):
        remark = remark.strip() or None
    if remark is not None and len(remark) > _REMARK_MAX_LEN:
        frappe.throw(
            f"Remark is too long ({len(remark)} chars). Maximum is {_REMARK_MAX_LEN}.",
            title="Remark too long",
        )

    # The committed ROW must exist (row-level check; node_type ignored -- a remark is
    # allowed on any row, no priceability gate).
    _resolve_committed_cell(boq_name, sheet_name, excel_row, committed_version)

    # Single-editor lock -- AFTER the row-resolve, BEFORE the freeze/insert (a rejected
    # write mutates nothing). Holder = session user; shares this request's transaction.
    acquire_or_refresh(
        boq_name, sheet_name, committed_version, frappe.session.user, now_datetime()
    )

    # Freeze any prior current via set_value (NEVER doc.save). Mirrors the pricing tier.
    prior = _current_annot_names(_REMARK, boq_name, sheet_name, excel_row, committed_version)
    for name in prior:
        frappe.db.set_value(_REMARK, name, "is_current", 0)

    # CLEAR: freeze only, insert no new current -> reads as "no remark".
    if remark is None:
        frappe.db.commit()
        return {
            "ok": True,
            "name": None,
            "remark_version": None,
            "is_current": 0,
            "froze_prior": len(prior),
            "cleared": True,
        }

    remark_version = _next_annot_version(
        _REMARK, "remark_version", boq_name, sheet_name, excel_row, committed_version
    )
    doc = frappe.new_doc(_REMARK)
    doc.boq = boq_name
    doc.sheet_name = sheet_name  # VERBATIM (#152)
    doc.excel_row = excel_row
    doc.committed_version = committed_version
    doc.description = description
    doc.remark = remark
    doc.remark_version = remark_version
    doc.is_current = 1
    doc.remarked_at = frappe.utils.now()
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "ok": True,
        "name": doc.name,
        "remark_version": remark_version,
        "is_current": 1,
        "froze_prior": len(prior),
        "cleared": False,
    }


@frappe.whitelist(methods=["POST"])
def save_cell_color(
    boq_name: str = None,
    sheet_name: str = None,
    excel_row=None,
    col_letter: str = None,
    committed_version=None,
    color: str = None,
    description: str = None,
) -> dict:
    """Save a per-CELL color tag onto one committed Excel cell -- upsert the CURRENT color
    record for that cell (freeze-and-supersede), mirroring save_cell_price.

    Identity = (boq, sheet_name [VERBATIM #152], excel_row, col_letter, committed_version).
    The committed row at that address/version MUST exist (resolved via the SAME row-level
    _resolve_committed_cell -- it keys on source_row_number, NOT col_letter, exactly as
    save_cell_price does when it stores col_letter without a per-column node check).

    NO PRICEABILITY GATE: a color is pure visual annotation, allowed on ANY cell
    (non-priceable / zero-rate / anything) -- _resolve_committed_cell does NOT gate on
    node_type (that guard is inline in save_cell_price only), so reusing it imposes no gate.

    LOCK: acquires/refreshes the single-editor lock exactly like save_cell_price (AFTER
    the resolve, BEFORE any freeze/insert -- a rejection mutates nothing).

    `color` must be one of the 8 enum tokens (else throw). A blank color CLEARS (freeze
    prior current, insert no new current -> no current color). A whole-row apply is N
    calls (the frontend fans out; this endpoint takes one cell).

    `description` is the copy-forward MATCH GUARD -- not part of the key, never branched on.

    Returns {ok, name, color_version, is_current, froze_prior, cleared}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.save_cell_color
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

    # Normalize: blank/whitespace-only -> None (clears the color).
    if isinstance(color, str):
        color = color.strip() or None
    if color is not None and color not in _COLOR_TOKENS:
        frappe.throw(
            f"Invalid color '{color}'. Must be one of: {', '.join(sorted(_COLOR_TOKENS))}.",
            title="Invalid color",
        )

    # The committed cell's ROW must exist (NO priceability gate -- color is allowed
    # anywhere). _resolve_committed_cell is row-level (keys on source_row_number).
    _resolve_committed_cell(boq_name, sheet_name, excel_row, committed_version)

    # Single-editor lock -- AFTER the resolve, BEFORE the freeze/insert.
    acquire_or_refresh(
        boq_name, sheet_name, committed_version, frappe.session.user, now_datetime()
    )

    prior = _current_annot_names(
        _COLOR, boq_name, sheet_name, excel_row, committed_version, col_letter=col_letter
    )
    for name in prior:
        frappe.db.set_value(_COLOR, name, "is_current", 0)

    # CLEAR: freeze only, insert no new current -> no current color.
    if color is None:
        frappe.db.commit()
        return {
            "ok": True,
            "name": None,
            "color_version": None,
            "is_current": 0,
            "froze_prior": len(prior),
            "cleared": True,
        }

    color_version = _next_annot_version(
        _COLOR, "color_version", boq_name, sheet_name, excel_row, committed_version,
        col_letter=col_letter,
    )
    doc = frappe.new_doc(_COLOR)
    doc.boq = boq_name
    doc.sheet_name = sheet_name  # VERBATIM (#152)
    doc.excel_row = excel_row
    doc.col_letter = col_letter
    doc.committed_version = committed_version
    doc.description = description
    doc.color = color
    doc.color_version = color_version
    doc.is_current = 1
    doc.colored_at = frappe.utils.now()
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "ok": True,
        "name": doc.name,
        "color_version": color_version,
        "is_current": 1,
        "froze_prior": len(prior),
        "cleared": False,
    }


@frappe.whitelist()
def get_sheet_remarks(
    boq_name: str = None, sheet_name: str = None, committed_version=None
) -> dict:
    """Current per-row remarks (is_current=1) for one committed (boq, sheet, committed_version).
    @frappe.whitelist() bare -- GET-capable (mirrors get_sheet_pricing). Pure read.
    sheet_name VERBATIM (#152). Returns {"remarks": [{...}]} (empty when none).
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.get_sheet_remarks
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

    remarks = frappe.get_all(
        _REMARK,
        filters={
            "boq": boq_name,
            "sheet_name": sheet_name,
            "committed_version": committed_version,
            "is_current": 1,
        },
        fields=["name", "excel_row", "remark", "description", "remark_version", "remarked_at"],
        order_by="excel_row asc",
    )
    return {"remarks": remarks}


@frappe.whitelist()
def get_sheet_colors(
    boq_name: str = None, sheet_name: str = None, committed_version=None
) -> dict:
    """Current per-cell colors (is_current=1) for one committed (boq, sheet, committed_version).
    @frappe.whitelist() bare -- GET-capable (mirrors get_sheet_pricing). Pure read.
    sheet_name VERBATIM (#152). Returns {"colors": [{...}]} (empty when none).
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.get_sheet_colors
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

    colors = frappe.get_all(
        _COLOR,
        filters={
            "boq": boq_name,
            "sheet_name": sheet_name,
            "committed_version": committed_version,
            "is_current": 1,
        },
        fields=["name", "excel_row", "col_letter", "color", "description", "color_version", "colored_at"],
        order_by="excel_row asc, col_letter asc",
    )
    return {"colors": colors}


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

    ANNOTATIONS (Slice 4a -- data sheets only): the current per-row remark + per-cell
    colors are merged in the SAME per-row loop (built once into indexes, no per-row query):
      - row["remark"]       = the current remark text for that excel_row (None when absent)
      - row["color_by_cell"]= {col_letter: color_token, ...} for that row (only when the
                              row has at least one current color; absent otherwise)
    Both sit on top of the committed tier (BoQ Cell Remark / BoQ Cell Color); the committed
    tier is never mutated.

    Returns:
      {
        "rows": [...],                # committed rows, rate cells stamped + markers + 4a annotations
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
        # Single-editor lock (slice A) -- PURE READ (this endpoint NEVER acquires/mutates
        # the lock; only save_cell_price does). Defaults below cover the uncommitted /
        # no-version case (free -> editable, lock_info None).
        "editable": True,
        "lock_info": None,
    }

    # A committed sheet+version has a lock identity -> surface its current lock state.
    # editable precomputes the slice-B gate: True if FREE / MINE / STALE, False only when
    # held FRESH by another user. lock_info still ships so the grid can show the holder.
    if commit_version is not None:
        lock_info = read_lock_info(
            boq_name, sheet_name, commit_version, frappe.session.user, now_datetime()
        )
        base["lock_info"] = lock_info
        base["editable"] = (
            lock_info is None
            or lock_info["is_locked_by_me"]
            or lock_info["is_stale"]
        )

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

    # Slice 4a annotations: build the remark index (per excel_row) + the color index
    # (per excel_row -> {col_letter: token}) ONCE, before the loop -- no per-row query.
    remark_by_row = {
        r["excel_row"]: r["remark"]
        for r in get_sheet_remarks(
            boq_name=boq_name, sheet_name=sheet_name, committed_version=commit_version
        )["remarks"]
    }
    colors_by_row: dict = {}
    for c in get_sheet_colors(
        boq_name=boq_name, sheet_name=sheet_name, committed_version=commit_version
    )["colors"]:
        colors_by_row.setdefault(c["excel_row"], {})[c["col_letter"]] = c["color"]

    # Nothing to merge at all (no prices, no remarks, no colors) -> graceful passthrough.
    if not price_by_cell and not remark_by_row and not colors_by_row:
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
        # 4a: per-ROW remark (None when absent) + per-CELL colors for this row.
        row["remark"] = remark_by_row.get(excel_row)
        row_colors = colors_by_row.get(excel_row)
        if row_colors:
            row["color_by_cell"] = row_colors
        # prices (existing behavior, unchanged).
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


@frappe.whitelist()
def get_committed_sheet_grid(
    boq_name: str = None, sheet_name: str = None, committed_version=None
) -> dict:
    """Return the FAITHFUL committed cell grid for one (boq, sheet_name [VERBATIM #152],
    committed_version) -- every committed Excel row in position + the per-sheet column-config
    snapshot -- so the pricing editor can render a GRID-ONLY (general-specs) sheet as a
    READ-ONLY reference. A general-specs sheet commits grid-only (a faithful grid, ZERO nodes),
    so the node-based get_priced_rows renders it empty; this read fills that gap.

    @frappe.whitelist() bare -- GET-capable (mirrors get_sheet_pricing / get_priced_rows).
    PURE READ -- never writes (no set_value / insert / save / commit). sheet_name matched
    VERBATIM (#152). Guards mirror the other committed reads (throw on missing/unknown).

    CRITICAL (the empty-config case): the grid rows are returned EVEN WHEN column_role_map /
    column_headers are empty ({}) -- a general-specs sheet like SOW carries no parser config;
    the row return is NEVER gated on a non-empty config (the frontend falls back to raw Excel
    column letters).

    Returns:
      {
        "rows": [{"row_number": int, "cells": {col_letter: value}}, ...],  # row_order asc
        "column_role_map": {...},   # from the committed BoQ Sheet snapshot (may be {})
        "column_headers": {...},    # (may be {})
        "area_dimensions": [...],   # (may be [])
        "header_row": int | None,
        "header_row_count": int,
      }
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.get_committed_sheet_grid
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

    # The committed faithful grid for this (boq, sheet_name VERBATIM, version).
    grid_name = frappe.db.get_value(
        _GRID,
        {"boq": boq_name, "source_sheet_name": sheet_name, "commit_version": committed_version},
        "name",
    )
    if not grid_name:
        frappe.throw(
            f"No committed grid for sheet '{sheet_name}' at committed_version "
            f"{committed_version} on BoQ '{boq_name}'.",
            title="No committed grid",
        )

    grid_rows = frappe.get_all(
        _GRID_ROW,
        filters={"parent": grid_name, "parenttype": _GRID},
        fields=["row_number", "row_order", "cells"],
        order_by="row_order asc",
    )
    rows = [
        {"row_number": r["row_number"], "cells": _parse_json_field(r.get("cells"), {})}
        for r in grid_rows
    ]

    # The per-sheet column-config snapshot lives on the committed BoQ Sheet (pinned at commit
    # for BOTH dispositions; a general-specs sheet has empty role/header maps -- still returned).
    sheet_doc = frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": boq_name, "sheet_name": sheet_name, "commit_version": committed_version},
        ["column_role_map", "column_headers", "area_dimensions", "header_row", "header_row_count"],
        as_dict=True,
    )

    return {
        "rows": rows,
        "column_role_map": _parse_json_field(
            sheet_doc.get("column_role_map") if sheet_doc else None, {}
        ),
        "column_headers": _parse_json_field(
            sheet_doc.get("column_headers") if sheet_doc else None, {}
        ),
        "area_dimensions": _parse_json_field(
            sheet_doc.get("area_dimensions") if sheet_doc else None, []
        ),
        "header_row": sheet_doc.get("header_row") if sheet_doc else None,
        "header_row_count": (sheet_doc.get("header_row_count") if sheet_doc else None) or 1,
    }
