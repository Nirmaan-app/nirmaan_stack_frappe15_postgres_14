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
import math

import frappe
from frappe.utils import now_datetime

from nirmaan_stack.api.boq.wizard.review_screen import get_committed_rows, _build_column_descriptors
from nirmaan_stack.api.boq.wizard.pricing_lock import acquire_or_refresh, read_lock_info

_PRICING = "BoQ Cell Pricing"
_BOQ_SHEET = "BoQ Sheet"
_NODE = "BOQ Nodes"
_GRID = "BoQ Committed Sheet Grid"
_GRID_ROW = "BoQ Committed Sheet Grid Row"

# ── Amount-formula layer (Formula Builder F1) ────────────────────────────────────
# A per-COLUMN, per-committed-version USER-DECLARED amount FORMULA -- ADDITIVE, sits on
# top of the committed tier like BoQ Cell Pricing (never mutates it). F1 STORES + SERVES;
# it does NOT evaluate (the evaluator is F2, the grid display F4).
_FORMULA = "BoQ Cell Amount Formula"

# The AMOUNT value_fields a formula may TARGET (the amount-target gate -- a rate/qty target
# is rejected). amount_by_area = per-area; the three scalars = singleton amount columns.
# These mirror _SINGLETON_ROLE_TO_FIELD's amount entries + the per-area amount branch in
# review_screen._build_column_descriptors (the single source of the descriptor classes).
_AMOUNT_VALUE_FIELDS = frozenset(
    {"amount_by_area", "amount_total", "amount_supply", "amount_install"}
)

# The fields read back for a current formula record (the read + the merge share this).
_FORMULA_READ_FIELDS = [
    "name", "boq", "sheet_name", "committed_version",
    "target_value_field", "target_value_key", "target_rate_subkey",
    "target_col", "description", "formula",
    "formula_version", "is_current", "defined_at", "is_finalized",
]

# Structural-validation guard: the token tree must not nest pathologically deep (F1 does a
# STRUCTURAL check only -- F2 owns evaluation + the cycle guard).
_FORMULA_MAX_DEPTH = 50

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

# ── Acknowledge layer (Slice 4b-ACKNOWLEDGE) -- per-ROW review-flag/remark DISMISSAL ──
# A "reviewed / looks OK" acknowledgment that HIDES a review-strip entry (a computed flag or
# a remark) from the active view WITHOUT changing the underlying condition. ADDITIVE, sits on
# top of the committed tier like every other overlay (own freeze-and-supersede triple); the
# committed tier is NEVER mutated. DATA SHEETS ONLY (grid-only general-specs sheets are
# read-only and never reach the strip).
_DISMISSAL = "BoQ Cell Dismissal"

# The five dismissable entry kinds -- the four computed ReviewFlagKind tokens PLUS "remark"
# (one store, one discriminator). MUST stay in sync with the Select options in
# boq_cell_dismissal.json AND the frontend ReviewEntry["kind"] union.
_DISMISSAL_KINDS = frozenset({"needs_rate", "qty_anomaly", "broken", "not_yet", "remark"})

# The COMPUTED flag kinds a successful rate write RE-ARMS (freezes). "remark" is EXCLUDED --
# a remark dismissal is annotation on its own track and SURVIVES a rate edit (D3).
_DISMISSAL_REARM_KINDS = frozenset({"needs_rate", "qty_anomaly", "broken", "not_yet"})


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


def _is_nonzero_qty(v) -> bool:
    """A finite, non-zero numeric quantity -- mirrors the frontend isNonZeroNum
    (typeof number && Number.isFinite && !== 0). None / 0 / 0.0 / a bool / a non-numeric ->
    False; a finite non-zero number, INCLUDING a negative qty -> True. Committed qty coerces
    unset -> 0.0 (never NULL), but None is guarded defensively."""
    return (
        isinstance(v, (int, float))
        and not isinstance(v, bool)
        and math.isfinite(v)
        and v != 0
    )


def _node_is_qty_bearing(node_name: str, node_qty) -> bool:
    """"qty anywhere" (owner-locked "Definition A") -- the node's scalar qty OR ANY of its
    BOQ Node Qty By Area child rows' qty is finite non-zero. The committed analog of the
    frontend isRowQtyBearing. DELIBERATELY LOOSER than the per-area / rate-column qty-bearing
    of isPriceableLine (the flags/count axis) -- this answers "can this row be priced at all?".
    Used ONLY for the Preamble branch of the rate-edit guard, so the (cheap) child read fires
    only when a Preamble is being priced without the override."""
    if _is_nonzero_qty(node_qty):
        return True
    child_qtys = frappe.get_all(
        "BOQ Node Qty By Area",
        filters={"parent": node_name, "parenttype": _NODE, "parentfield": "qty_by_area"},
        pluck="qty",
    )
    return any(_is_nonzero_qty(q) for q in child_qtys)


def _resolve_committed_cell(boq_name, sheet_name, excel_row, committed_version) -> dict:
    """Resolve + VALIDATE that a committed cell exists at (boq, sheet_name, excel_row) for
    the given committed_version. Returns {"name": <BOQ Nodes name>, "node_type": <str>,
    "qty": <float|None>} -- the node ref to store + its PRICEABILITY axis + its scalar qty
    (all resolved at the SAME get_value, no extra query, for the rate-edit guard's Preamble
    qty-bearing check). Throws if the committed sheet or node at that address/version does not
    exist -- never create a price for a non-existent cell. sheet_name matched VERBATIM (#152)."""
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
        ["name", "node_type", "qty"],
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

    # PRICEABILITY GUARD (Slice 3e + the Preamble qty-bearing gate -- ASYMMETRIC, owner-locked).
    # Placed AFTER the committed-cell check (a non-cell still throws first) and BEFORE the lock
    # acquire / the freeze+insert below, so a REJECTED write mutates NOTHING (mirrors the lock
    # reject-mutates-nothing discipline). The rule:
    #   - Line Item -> ALWAYS editable (a zero-qty Line Item is a valid rate-only line).
    #   - Preamble  -> editable ONLY when qty-bearing ("qty anywhere": scalar qty OR any per-area
    #                  qty non-zero); a zero-qty Preamble (nearly all Preambles) is read-only.
    #   - any other type ("Other") -> non-priceable.
    # The override (allow_non_priceable, HTTP-coerced) unlocks BOTH a zero-qty Preamble AND a
    # non-priceable type -- "price ANY row, ignore the gate". The Preamble/Line-Item asymmetry is
    # DELIBERATE (do not collapse it to uniformity). The frontend isRateEditableRow mirrors this
    # EXACTLY so the client UX and this server boundary never drift.
    if not _coerce_bool(allow_non_priceable):
        nt = node.get("node_type")
        if nt == "Line Item":
            pass  # always priceable
        elif nt == "Preamble":
            if not _node_is_qty_bearing(node_name, node.get("qty")):
                frappe.throw(
                    "This Preamble row has no quantity, so it is not priceable. "
                    "Enable the override to price it.",
                    title="Not priceable",
                )
        else:
            frappe.throw(
                f"This row is not priceable (node type: {nt or 'unknown'}). "
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

    # RE-ARM (Slice 4b-ACKNOWLEDGE): a successful rate write is a MATERIAL change, so freeze
    # this row's current dismissals for the four COMPUTED kinds -- the user should re-see the
    # row's computed review state. Placed AFTER the price insert + BEFORE the single trailing
    # commit, so it fires ONLY on a successful write (every rejection path -- cell-resolve,
    # priceability guard, lock reject -- threw earlier and mutated nothing) and lands atomically
    # with the price under this request's single commit. EXCLUDES flag_kind="remark" (D3).
    rearmed = _rearm_row_dismissals(boq_name, sheet_name, excel_row, committed_version)

    frappe.db.commit()

    return {
        "ok": True,
        "name": doc.name,
        "pricing_version": pricing_version,
        "is_current": 1,
        "is_filled": 1,
        "froze_prior": len(prior),
        "rearmed_dismissals": rearmed,
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


# ── Acknowledge write/read helpers + endpoints (Slice 4b-ACKNOWLEDGE) ─────────────
# Freeze-and-supersede plumbing for the per-(row, flag_kind) dismissal layer, mirroring
# _current_pricing_names / _next_pricing_version but keyed on flag_kind (no col_letter).

def _dismissal_identity_filters(boq_name, sheet_name, excel_row, flag_kind, committed_version) -> dict:
    """The per-(row, flag_kind) dismissal identity filter (sheet_name matched VERBATIM #152)."""
    return {
        "boq": boq_name,
        "sheet_name": sheet_name,
        "excel_row": excel_row,
        "flag_kind": flag_kind,
        "committed_version": committed_version,
    }


def _current_dismissal_names(boq_name, sheet_name, excel_row, flag_kind, committed_version) -> list:
    """Names of the is_current=1 dismissal record(s) for one (row, flag_kind) identity (0 or 1
    -- the invariant). Mirrors _current_pricing_names."""
    filters = _dismissal_identity_filters(boq_name, sheet_name, excel_row, flag_kind, committed_version)
    filters["is_current"] = 1
    return frappe.get_all(_DISMISSAL, filters=filters, pluck="name")


def _next_dismissal_version(boq_name, sheet_name, excel_row, flag_kind, committed_version) -> int:
    """The next dismissal version for one (row, flag_kind) identity = max prior + 1 (first save
    = 1). Mirrors _next_pricing_version."""
    agg = frappe.get_all(
        _DISMISSAL,
        filters=_dismissal_identity_filters(boq_name, sheet_name, excel_row, flag_kind, committed_version),
        fields=["max(dismissal_version) as mv"],
    )
    return ((agg[0].mv if agg else None) or 0) + 1


def _rearm_row_dismissals(boq_name, sheet_name, excel_row, committed_version) -> int:
    """RE-ARM: freeze (is_current=0) this row's current dismissals for the four COMPUTED kinds
    (EXCLUDING "remark"). Freeze, NEVER delete (D4 -- a re-armed dismissal becomes a frozen
    historical record; the read path returns only is_current=1, so it vanishes from BOTH the
    active AND the show-all view). Returns the count re-armed. sheet_name VERBATIM (#152).
    Called from save_cell_price's success path only (see the placement note there)."""
    names = frappe.get_all(
        _DISMISSAL,
        filters={
            "boq": boq_name,
            "sheet_name": sheet_name,
            "excel_row": excel_row,
            "committed_version": committed_version,
            "flag_kind": ["in", sorted(_DISMISSAL_REARM_KINDS)],
            "is_current": 1,
        },
        pluck="name",
    )
    for name in names:
        frappe.db.set_value(_DISMISSAL, name, "is_current", 0)
    return len(names)


@frappe.whitelist(methods=["POST"])
def save_cell_dismissal(
    boq_name: str = None,
    sheet_name: str = None,
    excel_row=None,
    committed_version=None,
    flag_kind: str = None,
    dismissed=None,
    description: str = None,
) -> dict:
    """Dismiss ("reviewed / looks OK") or un-dismiss one review-strip entry on a committed row
    -- upsert the CURRENT dismissal record for that (row, flag_kind) (freeze-and-supersede),
    mirroring save_row_remark. A dismissal HIDES the entry from the active view WITHOUT
    changing the underlying condition (an ACKNOWLEDGMENT, not a fix).

    Identity = (boq, sheet_name [VERBATIM #152], excel_row, flag_kind, committed_version).
    `flag_kind` is one of the five tokens (needs_rate / qty_anomaly / broken / not_yet /
    remark) -- the discriminator that lets one row carry several independent dismissals. NO
    per-area dimension (a ReviewEntry's identity is (excel_row, kind)). The committed tier is
    NOT mutated.

    The committed ROW at that address/version MUST exist (resolved + validated via the SAME
    row-level _resolve_committed_cell save_row_remark uses -- node_type is IGNORED here, a
    dismissal is allowed on ANY row, no priceability gate).

    LOCK: acquires/refreshes the single-editor lock (acquire_or_refresh) exactly like
    save_row_remark -- AFTER the row-resolve, BEFORE any freeze/insert, so a lock rejection
    (held fresh by another user) mutates NOTHING.

    `dismissed` truthy (HTTP "1"/"true"/"yes"/"on" coerced) -> freeze any prior current for
    this exact (row, flag_kind) + insert a fresh current (is_current=1). `dismissed` falsy ->
    freeze the current for that (row, flag_kind), insert NOTHING (the explicit un-dismiss / the
    toggle's "show this again"); the row then has no current dismissal for that kind and the
    entry reappears active.

    `description` is stored as the copy-forward MATCH GUARD (a future-slice carry, like
    BoQ Cell Pricing.description) -- NOT part of the key, never branched on.

    Returns {ok, name, dismissal_version, is_current, froze_prior, dismissed}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.save_cell_dismissal
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if excel_row is None or excel_row == "":
        frappe.throw("excel_row is required.", title="Missing field: excel_row")
    if committed_version is None or committed_version == "":
        frappe.throw("committed_version is required.", title="Missing field: committed_version")
    if not flag_kind:
        frappe.throw("flag_kind is required.", title="Missing field: flag_kind")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    excel_row = _coerce_int(excel_row, "excel_row")
    committed_version = _coerce_int(committed_version, "committed_version")

    if flag_kind not in _DISMISSAL_KINDS:
        frappe.throw(
            f"Invalid flag_kind '{flag_kind}'. Must be one of: {', '.join(sorted(_DISMISSAL_KINDS))}.",
            title="Invalid flag_kind",
        )

    is_dismissed = _coerce_bool(dismissed)

    # The committed ROW must exist (row-level check; node_type ignored -- a dismissal is
    # allowed on any row, no priceability gate).
    _resolve_committed_cell(boq_name, sheet_name, excel_row, committed_version)

    # Single-editor lock -- AFTER the row-resolve, BEFORE the freeze/insert (a rejected write
    # mutates nothing). Holder = session user; shares this request's transaction.
    acquire_or_refresh(
        boq_name, sheet_name, committed_version, frappe.session.user, now_datetime()
    )

    # Freeze any prior current for this exact (row, flag_kind) via set_value (NEVER doc.save).
    prior = _current_dismissal_names(
        boq_name, sheet_name, excel_row, flag_kind, committed_version
    )
    for name in prior:
        frappe.db.set_value(_DISMISSAL, name, "is_current", 0)

    # UN-DISMISS: freeze only, insert no new current -> the entry reappears active.
    if not is_dismissed:
        frappe.db.commit()
        return {
            "ok": True,
            "name": None,
            "dismissal_version": None,
            "is_current": 0,
            "froze_prior": len(prior),
            "dismissed": False,
        }

    dismissal_version = _next_dismissal_version(
        boq_name, sheet_name, excel_row, flag_kind, committed_version
    )
    doc = frappe.new_doc(_DISMISSAL)
    doc.boq = boq_name
    doc.sheet_name = sheet_name  # VERBATIM (#152)
    doc.excel_row = excel_row
    doc.flag_kind = flag_kind
    doc.committed_version = committed_version
    doc.description = description
    doc.dismissal_version = dismissal_version
    doc.is_current = 1
    doc.dismissed_at = frappe.utils.now()
    doc.dismissed_by = frappe.session.user
    doc.is_finalized = 0
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "ok": True,
        "name": doc.name,
        "dismissal_version": dismissal_version,
        "is_current": 1,
        "froze_prior": len(prior),
        "dismissed": True,
    }


@frappe.whitelist()
def get_sheet_dismissals(
    boq_name: str = None, sheet_name: str = None, committed_version=None
) -> dict:
    """Current per-(row, flag_kind) dismissals (is_current=1) for one committed (boq, sheet,
    committed_version). @frappe.whitelist() bare -- GET-capable (mirrors get_sheet_pricing).
    Pure read. sheet_name VERBATIM (#152). Returns {"dismissals": [{...}]} (empty when none).
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.get_sheet_dismissals
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

    dismissals = frappe.get_all(
        _DISMISSAL,
        filters={
            "boq": boq_name,
            "sheet_name": sheet_name,
            "committed_version": committed_version,
            "is_current": 1,
        },
        fields=[
            "name", "excel_row", "flag_kind", "description",
            "dismissal_version", "dismissed_at", "dismissed_by",
        ],
        order_by="excel_row asc, flag_kind asc",
    )
    return {"dismissals": dismissals}


# ── Amount-formula helpers + endpoints (Formula Builder F1) ──────────────────────


def _normalize_optional(value):
    """An optional Data arg -> None when blank/whitespace-only (the wire sends "" for an
    omitted field over HTTP); a non-empty value is kept VERBATIM (areas are matched against
    descriptor value_keys exactly -- never stripped of meaningful content)."""
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


def _validate_formula_structure(node, depth: int = 0) -> None:
    """STRUCTURAL validation of the token-tree JSON (Formula Builder F1 -- store-time only;
    F1 does NOT evaluate and does NOT cycle-check, those are F2). Throws on malformed.

    A node is EXACTLY ONE of:
      operator -> {"op": "+"|"*", "operands": [<node>, <node>, ...]}  (operands non-empty)
      leaf ref -> {"ref": {"value_field": <non-empty str>,
                           "value_key": <str|null>, "rate_subkey": <str|null>}}
    NO literal node (numeric literals are barred). A node carrying both "op" and "ref",
    neither, a "literal" key, a bad op, empty operands, or a wrong-typed ref -> throw.
    """
    if depth > _FORMULA_MAX_DEPTH:
        frappe.throw("Formula is nested too deeply.", title="Invalid formula")
    if not isinstance(node, dict):
        frappe.throw("Each formula node must be an object.", title="Invalid formula")
    if "literal" in node:
        frappe.throw("Numeric literals are not allowed in a formula.", title="Invalid formula")
    has_op = "op" in node
    has_ref = "ref" in node
    if has_op and has_ref:
        frappe.throw(
            "A formula node must be EITHER an operator or a ref, not both.",
            title="Invalid formula",
        )
    if not has_op and not has_ref:
        frappe.throw(
            "Each formula node must be an operator {op, operands} or a leaf {ref}.",
            title="Invalid formula",
        )
    if has_op:
        if node["op"] not in {"+", "*"}:
            frappe.throw(
                f"Unsupported operator {node['op']!r} (only + and * are allowed).",
                title="Invalid formula",
            )
        operands = node.get("operands")
        if not isinstance(operands, list) or len(operands) == 0:
            frappe.throw(
                "An operator node needs a non-empty 'operands' list.",
                title="Invalid formula",
            )
        for child in operands:
            _validate_formula_structure(child, depth + 1)
        return
    # leaf ref
    ref = node["ref"]
    if not isinstance(ref, dict):
        frappe.throw("A formula ref must be an object.", title="Invalid formula")
    vf = ref.get("value_field")
    if not vf or not isinstance(vf, str):
        frappe.throw("A formula ref needs a non-empty value_field.", title="Invalid formula")
    for k in ("value_key", "rate_subkey"):
        if k in ref and ref[k] is not None and not isinstance(ref[k], str):
            frappe.throw(f"A formula ref's {k} must be a string or null.", title="Invalid formula")


def _coerce_formula_obj(formula):
    """Accept the formula as a dict or a JSON string. Returns (obj, is_blank). A None /
    blank / whitespace-only value -> (None, True) (the CLEAR signal). A malformed JSON
    string -> throw (never silently swallow). A non-dict/non-str -> throw."""
    if formula is None:
        return None, True
    if isinstance(formula, str):
        if formula.strip() == "":
            return None, True
        try:
            return json.loads(formula), False
        except (ValueError, TypeError):
            frappe.throw("Formula is not valid JSON.", title="Invalid formula")
    if isinstance(formula, dict):
        return formula, False
    frappe.throw("Formula must be a JSON object.", title="Invalid formula")


def _formula_identity_filters(boq_name, sheet_name, committed_version,
                              target_value_field, target_value_key, target_rate_subkey) -> dict:
    """The per-COLUMN formula identity filter. sheet_name VERBATIM (#152). The three
    nullable identity slots (target_value_key / target_rate_subkey) use ['is','not set']
    when None so Postgres NULL semantics match (the default/scalar discriminator is NULL)."""
    filters = {
        "boq": boq_name,
        "sheet_name": sheet_name,
        "committed_version": committed_version,
        "target_value_field": target_value_field,
    }
    filters["target_value_key"] = (
        target_value_key if target_value_key is not None else ["is", "not set"]
    )
    filters["target_rate_subkey"] = (
        target_rate_subkey if target_rate_subkey is not None else ["is", "not set"]
    )
    return filters


def _current_formula_names(boq_name, sheet_name, committed_version,
                           target_value_field, target_value_key, target_rate_subkey) -> list:
    """Names of the is_current=1 formula record(s) for one column identity (0 or 1 -- the
    invariant). Mirrors _current_pricing_names."""
    filters = _formula_identity_filters(
        boq_name, sheet_name, committed_version,
        target_value_field, target_value_key, target_rate_subkey,
    )
    filters["is_current"] = 1
    return frappe.get_all(_FORMULA, filters=filters, pluck="name")


def _next_formula_version(boq_name, sheet_name, committed_version,
                          target_value_field, target_value_key, target_rate_subkey) -> int:
    """The next formula version for one column identity = max prior + 1 (first save = 1).
    Mirrors _next_pricing_version."""
    agg = frappe.get_all(
        _FORMULA,
        filters=_formula_identity_filters(
            boq_name, sheet_name, committed_version,
            target_value_field, target_value_key, target_rate_subkey,
        ),
        fields=["max(formula_version) as mv"],
    )
    return ((agg[0].mv if agg else None) or 0) + 1


def _committed_amount_descriptors(boq_name, sheet_name, committed_version) -> list:
    """The AMOUNT column descriptors of the committed sheet at (boq, sheet_name VERBATIM,
    committed_version) -- the source of truth for the amount-target gate. Reuses the
    certified review_screen._build_column_descriptors on the committed config snapshot.
    Throws if no committed sheet exists at that address/version (never define a formula on a
    non-existent sheet)."""
    sheet_cfg = frappe.db.get_value(
        _BOQ_SHEET,
        {"boq": boq_name, "sheet_name": sheet_name, "commit_version": committed_version},
        ["column_role_map", "column_headers"],
        as_dict=True,
    )
    if not sheet_cfg:
        frappe.throw(
            f"No committed sheet '{sheet_name}' at committed_version {committed_version} "
            f"for BoQ '{boq_name}'.",
            title="No committed sheet",
        )
    descriptors = _build_column_descriptors({
        "column_role_map": _parse_json_field(sheet_cfg.get("column_role_map"), {}),
        "column_headers": _parse_json_field(sheet_cfg.get("column_headers"), {}),
    })
    return [d for d in descriptors if d.get("value_field") in _AMOUNT_VALUE_FIELDS]


def _current_formula_records(boq_name, sheet_name, committed_version) -> list:
    """Current (is_current=1) formula records for one committed (boq, sheet, version), with
    the stored `formula` JSON parsed back to an object. Shared by the read endpoint + the
    get_priced_rows merge. sheet_name VERBATIM (#152)."""
    records = frappe.get_all(
        _FORMULA,
        filters={
            "boq": boq_name,
            "sheet_name": sheet_name,
            "committed_version": committed_version,
            "is_current": 1,
        },
        fields=_FORMULA_READ_FIELDS,
        order_by="target_value_field asc, target_col asc",
    )
    for r in records:
        r["formula"] = _parse_json_field(r.get("formula"), None)
    return records


@frappe.whitelist(methods=["POST"])
def save_amount_formula(
    boq_name: str = None,
    sheet_name: str = None,
    committed_version=None,
    target_value_field: str = None,
    target_value_key: str = None,
    target_rate_subkey: str = None,
    formula=None,
    target_col: str = None,
    description: str = None,
) -> dict:
    """Save a per-COLUMN amount FORMULA -- upsert the CURRENT formula record for that column
    identity (freeze-and-supersede), mirroring save_cell_price. F1 STORES + SERVES; it does
    NOT evaluate (F2) and does NOT cycle-check (F2).

    Identity = (boq, sheet_name [VERBATIM #152], committed_version, target_value_field,
    target_value_key, target_rate_subkey). DEFAULT-vs-OVERRIDE discriminator = whether
    `target_value_key` is NULL (the logical-column area-WILDCARD default, OR 'scalar' for a
    scalar amount column) or a CONCRETE area string (a PER-AREA OVERRIDE). target_col /
    description are stored GUARDS, NOT part of the key. The committed tier is NOT mutated.

    AMOUNT-TARGET GATE (the analog of the priceability gate): the target MUST be an AMOUNT
    column on the committed config -- target_value_field in the amount set AND a matching
    descriptor exists (for a per-area default, >=1 area's amount column of that
    value_field/rate_subkey). A rate/qty target -> throw, nothing written.

    STRUCTURAL VALIDATION: the formula JSON must be a well-formed token tree (operator
    {op,operands} or leaf {ref}; ops in {+,*}; no literal node; non-empty operands) -> throw
    if malformed. A blank/None formula CLEARS (freeze prior current, insert none) -- mirrors
    the remark/color clear semantics.

    LOCK: acquires/refreshes the single-editor lock (acquire_or_refresh) -- AFTER the
    target-resolve + structural validation, BEFORE any freeze/insert, so a lock rejection
    (held fresh by another user) or a validation throw mutates NOTHING.

    Returns {ok, name, formula_version, is_current, froze_prior, cleared}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.save_amount_formula
    """
    if not boq_name:
        frappe.throw("boq_name is required.", title="Missing field: boq_name")
    if not sheet_name:
        frappe.throw("sheet_name is required.", title="Missing field: sheet_name")
    if committed_version is None or committed_version == "":
        frappe.throw("committed_version is required.", title="Missing field: committed_version")
    if not target_value_field:
        frappe.throw("target_value_field is required.", title="Missing field: target_value_field")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")

    committed_version = _coerce_int(committed_version, "committed_version")
    # Normalize the nullable identity + guard fields (HTTP "" -> None). The NULL on
    # target_value_key IS the default/scalar-vs-override discriminator.
    target_value_key = _normalize_optional(target_value_key)
    target_rate_subkey = _normalize_optional(target_rate_subkey)
    target_col = _normalize_optional(target_col)
    description = _normalize_optional(description)

    # AMOUNT-TARGET GATE -- reject a non-amount target BEFORE any lock/write.
    if target_value_field not in _AMOUNT_VALUE_FIELDS:
        frappe.throw(
            f"Target value_field '{target_value_field}' is not an amount column. "
            f"A formula may only target an amount column.",
            title="Not an amount target",
        )
    amount_descs = _committed_amount_descriptors(boq_name, sheet_name, committed_version)
    if target_value_field == "amount_by_area":
        if target_value_key is None:
            # Wildcard DEFAULT: >=1 area's amount column of this value_field + rate_subkey.
            matched = any(
                d["value_field"] == "amount_by_area"
                and d["rate_subkey"] == target_rate_subkey
                for d in amount_descs
            )
        else:
            # Per-area OVERRIDE: the concrete (area, kind) amount column must exist.
            matched = any(
                d["value_field"] == "amount_by_area"
                and d["value_key"] == target_value_key
                and d["rate_subkey"] == target_rate_subkey
                for d in amount_descs
            )
    else:
        # Scalar amount column (value_key None == scalar): the scalar amount col must exist.
        matched = any(d["value_field"] == target_value_field for d in amount_descs)
    if not matched:
        frappe.throw(
            "No matching committed amount column for the requested formula target "
            f"(value_field={target_value_field!r}, area={target_value_key!r}, "
            f"kind={target_rate_subkey!r}).",
            title="No matching amount column",
        )

    # STRUCTURAL validation of the formula (or detect the CLEAR signal). Done BEFORE the
    # lock so a malformed formula mutates nothing.
    formula_obj, is_clear = _coerce_formula_obj(formula)
    if not is_clear:
        _validate_formula_structure(formula_obj)

    # Single-editor lock -- AFTER target-resolve + validation, BEFORE the freeze/insert
    # (a rejection mutates nothing). Holder = session user; shares this request's transaction.
    acquire_or_refresh(
        boq_name, sheet_name, committed_version, frappe.session.user, now_datetime()
    )

    # Freeze any prior current via set_value (NEVER doc.save). Mirrors the pricing tier.
    prior = _current_formula_names(
        boq_name, sheet_name, committed_version,
        target_value_field, target_value_key, target_rate_subkey,
    )
    for name in prior:
        frappe.db.set_value(_FORMULA, name, "is_current", 0)

    # CLEAR: freeze only, insert no new current -> the column has no formula.
    if is_clear:
        frappe.db.commit()
        return {
            "ok": True,
            "name": None,
            "formula_version": None,
            "is_current": 0,
            "froze_prior": len(prior),
            "cleared": True,
        }

    formula_version = _next_formula_version(
        boq_name, sheet_name, committed_version,
        target_value_field, target_value_key, target_rate_subkey,
    )
    doc = frappe.new_doc(_FORMULA)
    doc.boq = boq_name
    doc.sheet_name = sheet_name  # VERBATIM (#152)
    doc.committed_version = committed_version
    doc.target_value_field = target_value_field
    doc.target_value_key = target_value_key
    doc.target_rate_subkey = target_rate_subkey
    doc.target_col = target_col
    doc.description = description
    doc.formula = json.dumps(formula_obj)
    doc.formula_version = formula_version
    doc.is_current = 1
    doc.defined_at = frappe.utils.now()
    doc.is_finalized = 0
    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "ok": True,
        "name": doc.name,
        "formula_version": formula_version,
        "is_current": 1,
        "froze_prior": len(prior),
        "cleared": False,
    }


@frappe.whitelist()
def get_sheet_amount_formulas(
    boq_name: str = None, sheet_name: str = None, committed_version=None
) -> dict:
    """Current per-column amount formulas (is_current=1) for one committed (boq, sheet,
    committed_version). @frappe.whitelist() bare -- GET-capable (mirrors get_sheet_pricing).
    Pure read. sheet_name VERBATIM (#152). The stored token-tree `formula` is returned
    PARSED (an object, not a JSON string). Returns {"formulas": [{...}]} (empty when none).
    URL: /api/method/nirmaan_stack.api.boq.wizard.pricing.get_sheet_amount_formulas
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
    return {"formulas": _current_formula_records(boq_name, sheet_name, committed_version)}


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
        "column_formulas": [...],     # F1: per-COLUMN amount formulas (NOT per-row); each
                                      # {target_value_field, target_value_key,
                                      #  target_rate_subkey, target_col, formula(object)}
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
        # Amount formulas (Formula Builder F1) -- PER-COLUMN (NOT per-row), built ONCE below
        # when a version is committed. Empty for an uncommitted/grid-only sheet. The grid/F4
        # consumes this; F1 just delivers it.
        "column_formulas": [],
        # Dismissals (Slice 4b-ACKNOWLEDGE) -- the current "reviewed / looks OK" acknowledgments
        # for this committed version, delivered as a SHEET-LEVEL list (like column_formulas, NOT
        # merged per-row): a flat [{excel_row, flag_kind}, ...] the strip filter turns into an
        # O(1) membership set keyed "<flag_kind>:<excel_row>" (the strip's own list key). Empty
        # for an uncommitted/grid-only sheet. Built ONCE below when a version is committed.
        "dismissals": [],
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
        # Amount formulas (F1): the current per-column formulas for this committed version,
        # shaped PER-COLUMN for the grid lookup (built once; NOT stamped onto any row).
        base["column_formulas"] = [
            {
                "target_value_field": f["target_value_field"],
                "target_value_key": f["target_value_key"],
                "target_rate_subkey": f["target_rate_subkey"],
                "target_col": f["target_col"],
                "formula": f["formula"],  # already parsed to an object by the reader
            }
            for f in _current_formula_records(boq_name, sheet_name, commit_version)
        ]
        # Dismissals (Slice 4b-ACKNOWLEDGE): the current (excel_row, flag_kind) acknowledgments
        # for this committed version -- a flat sheet-level list (NOT stamped onto any row). The
        # strip filter consumes it; one query, no per-row query.
        base["dismissals"] = [
            {"excel_row": d["excel_row"], "flag_kind": d["flag_kind"]}
            for d in get_sheet_dismissals(
                boq_name=boq_name, sheet_name=sheet_name, committed_version=commit_version
            )["dismissals"]
        ]

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
