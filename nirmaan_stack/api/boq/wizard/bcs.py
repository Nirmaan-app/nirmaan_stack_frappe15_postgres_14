# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""BCS -- the per-row COST layer of the BoQ pricing editor (slice BCS-S1).

BCS is the cost side of a committed BoQ sheet: hand-typed cost rates per row representing
what the work costs US, sitting against the BoQ amount we charge the CLIENT. From those
numbers the screen LATER computes Total Amount (quantity x rate) and % Profit (how much of
the charged amount is margin).

THREE cost inputs are stored, and which of them a sheet uses is the SCREEN's decision, not
this module's (BCS-S2b, owner ruling 2026-08-02): a sheet that splits its quote carries a
Supply Rate and an Installation Rate; a sheet that quotes ONE undifferentiated figure
carries a Combined Rate instead. The third field exists so a combined-rate sheet's cost has
an honest home rather than riding in a field named "supply". `combined_rate` is NOT a total
of the other two -- never sum it with them, never derive it from them.

S1 is STORAGE + ENDPOINTS ONLY. Nothing renders; no frontend file is touched.

WHY THIS IS ITS OWN MODULE, and not more functions on pricing.py -- three owner-locked
properties become STRUCTURAL rather than conventional:

  1. ONLY THE INPUT RATES PERSIST. Total Amount and % Profit are ALWAYS computed downstream
     from the stored rates plus the sheet's confirmed quantity/amount columns. A stored
     copy could disagree with the live sheet, so there is deliberately no column for
     either.

  2. THE BCS READINESS GATE GUARDS BCS WRITES ONLY. It is NOT ANDed into save_cell_price's
     rate gate: an unconfirmed BCS section leaves ordinary client-facing pricing fully
     editable. Because the predicate lives HERE and `pricing` does not import this module,
     that separation cannot be violated by accident -- and a test in test_bcs.py greps
     pricing.py to keep it that way.
     DEPENDENCY DIRECTION: this module imports `pricing`; `pricing` must NEVER import
     `bcs` (the same one-way rule pricing.py already records for cross_boq_carry).

  3. BCS NEVER REACHES export_priced_workbook. That export reads "BoQ Cell Pricing" and
     names three fields explicitly (excel_row, col_letter, rate). BCS living in its own
     doctype is what keeps internal cost + margin out of a CLIENT-FACING workbook by
     construction. Pinned by a standing test in test_export_writeback.py.

THE BCS WRITE PATH IS DELIBERATELY INDEPENDENT OF THE CLIENT-FACING GATES
(OWNER-CONFIRMED 2026-08-02, slice BCS-S1a). save_row_bcs_rates runs exactly four gates:

    committed cell exists -> sheet not deliberately locked -> BCS readiness ->
    single-editor pricing lock

and it SKIPS, on purpose, the three that guard a CLIENT rate:

  * the MANDATORY amount-formula gate,
  * the ASYMMETRIC priceability gate (so a qty-less Preamble IS costable), and
  * the category gate.

Cost is a SEPARATE AXIS with its own two-column confirmation; it must not wait on the
client-facing side being finished. Someone should be able to cost a job while the amount
formulas are still being declared and the rows are still being categorised.

Do NOT add any of the three "to restore consistency with save_cell_price" -- the asymmetry
IS the decision. Each skip is pinned by its own test in
test_bcs.TestBcsWritesAreIndependentOfTheClientGates, so re-adding one fails loudly.

CARRY-FORWARD (S3, not this slice): because % Profit needs the live formula-evaluated
amount, a sheet with no declared amount formulas will show costs and a Total Amount but a
BLANK margin. S3 must render that blank WITH A REASON, not leave it mysteriously empty.

IDENTITY is PER-ROW -- (boq, sheet_name [VERBATIM #152], excel_row, committed_version).
There is NO col_letter: the BCS columns are screen-only and have no Excel origin.
LIFECYCLE is freeze-and-supersede (bcs_version / is_current / bcs_rated_at), mirroring
BoQ Cell Pricing exactly; a cost row is never overwritten in place.

Public API:
  set_bcs_enabled(...)      -> dict   [whitelisted POST]
  confirm_bcs_columns(...)  -> dict   [whitelisted POST]
  get_bcs_state(...)        -> dict   [whitelisted, GET-capable]
  get_sheet_bcs_rates(...)  -> dict   [whitelisted, GET-capable]
  save_row_bcs_rates(...)   -> dict   [whitelisted POST]
  bcs_is_ready(...)         -> bool   [the ONE shared readiness predicate -- RE-EXPORTED from
                                       services/boq_bcs/readiness.py since BCS-S6; still a
                                       supported name here, but no longer DEFINED here]
"""
from __future__ import annotations

import json

import frappe
from frappe.utils import now_datetime

# api -> api, one direction only (see the module docstring): we REUSE pricing's committed
# resolvers + the deliberate per-sheet lock guard so the two layers cannot drift. pricing
# is UNTOUCHED by this slice and must never import back.
from nirmaan_stack.api.boq.wizard.pricing import (
    _coerce_int,
    _committed_descriptors,
    _current_sheet_name,
    _guard_sheet_not_locked,
    _resolve_committed_cell,
)
from nirmaan_stack.api.boq.wizard.pricing_lock import acquire_or_refresh

# api -> service, the ONE-WAY direction ADR-0010 B1 asks for: the two column-confirmation
# RULES (what a valid quantity source is, what the amount denominator is, which
# combinations are refused) are decisions the business NAMES, so they live in a pure
# service module and this endpoint file orchestrates them. Relocated at BCS-S1a; the
# `boq_category.persist.node_is_qty_bearing` / `resolve_row_ladder` moves are the
# precedent. `services/boq_bcs` must never import back into `api/`.
from nirmaan_stack.services.boq_bcs.sources import (
    build_amount_source,
    build_qty_source,
)
# BCS-S6: the readiness predicate RELOCATED to the service layer and is imported straight back,
# so `bcs.bcs_is_ready` still resolves and no caller here or elsewhere changed. It had to move:
# `committed_carry` needs it for the BCS carry layer, and importing this module from there would
# close committed_carry -> bcs -> pricing -> committed_carry (see readiness.py for the full
# reasoning and the measured version-coercion note). ONE definition -- do NOT re-add a local
# `def bcs_is_ready` here; `test_readiness.TestOneDefinition` greps this file for exactly that.
from nirmaan_stack.services.boq_bcs.readiness import bcs_is_ready

_BCS = "BoQ Row BCS Rate"
_BOQ_SHEET = "BoQ Sheet"

# The BCS write identity (per-ROW -- deliberately no col_letter).
_IDENTITY_FIELDS = ("boq", "sheet_name", "excel_row", "committed_version")

# The fields a BCS read returns. Kept explicit (the export-writeback lesson: an explicit
# field list is what makes a read's blast radius legible).
_BCS_READ_FIELDS = [
    "name", "boq", "sheet_name", "excel_row", "committed_version",
    "node", "description", "supply_rate", "install_rate", "combined_rate", "is_filled",
    "rate_source", "bcs_version", "is_current", "bcs_rated_at",
    "carried_from_boq", "carried_from_version", "carried_at",
]

# "Amount (Combined)" until BCS-S2c. The KIND widening made that name wrong on most sheets --
# it points at a column the sheet is not required to have, and being told to confirm a column
# that does not exist is worse than being told nothing.
_NOT_READY_MESSAGE = (
    "BCS is not set up on this sheet yet. Turn BCS on and confirm the Total Quantity and "
    "Amount columns before entering any cost rates."
)


# ── small shared helpers ─────────────────────────────────────────────────────────
def _require(value, field: str) -> None:
    """Uniform required-arg refusal, mirroring the pricing endpoints' shape."""
    if value is None or value == "":
        frappe.throw(f"{field} is required.", title=f"Missing field: {field}")


def _parse_json_value(value, default):
    """A stored JSON column may arrive parsed (dict) or raw (str) depending on read path."""
    if isinstance(value, str):
        if not value:
            return default
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return default
    return value if isinstance(value, (dict, list)) else default


def _coerce_col_list(cols, field: str) -> list:
    """Normalize a column-letter pick (a JSON string over HTTP, or a Python list) to a
    list of column letters. Mirrors export_writeback._coerce_names. `field` names the
    argument in the refusal, so qty_cols and amount_cols voice their own errors while
    sharing ONE coercion -- the two picks are the same idea (BCS-S1a)."""
    if isinstance(cols, str):
        try:
            cols = json.loads(cols)
        except (ValueError, TypeError):
            frappe.throw(f"{field} must be a JSON list of column letters.",
                         title=f"Invalid {field}")
    if not isinstance(cols, (list, tuple)):
        frappe.throw(f"{field} must be a list of column letters.",
                     title=f"Invalid {field}")
    return [str(c) for c in cols]


def _resolve_sheet_row(boq_name, sheet_name, committed_version) -> str:
    """The current committed BoQ Sheet row name, or a clean refusal. The BCS config lives
    there, so the version scoping means a re-commit naturally starts BCS-disabled."""
    name = _current_sheet_name(boq_name, sheet_name, committed_version)
    if not name:
        frappe.throw(
            f"No current committed sheet '{sheet_name}' at version {committed_version}.",
            title="Not found",
        )
    return name


def _validate_common_args(boq_name, sheet_name, committed_version) -> int:
    _require(boq_name, "boq_name")
    _require(sheet_name, "sheet_name")
    _require(committed_version, "committed_version")
    if not frappe.db.exists("BOQs", boq_name):
        frappe.throw(f"BOQs '{boq_name}' not found.", title="Not found")
    return _coerce_int(committed_version, "committed_version")


# ── the ONE shared readiness predicate ───────────────────────────────────────────
# `bcs_is_ready` LIVES IN `services/boq_bcs/readiness.py` since BCS-S6 and is imported at the
# top of this file. Its behaviour is unchanged (including the version coercion the old body got
# for free from `pricing._current_sheet_name`); only its address moved, so that the carry engine
# could reach it without closing an import ring. The THROWING shape stays here, because throwing
# is an endpoint concern.


def _guard_bcs_ready(boq_name, sheet_name, committed_version) -> None:
    """The throwing shape of bcs_is_ready, used by the BCS write path. Named title, never
    a generic 500. Reject-mutates-nothing: called BEFORE any lock acquire or insert."""
    if not bcs_is_ready(boq_name, sheet_name, committed_version):
        frappe.throw(_NOT_READY_MESSAGE, title="BCS not set up")


# ── column confirmation: validated against the sheet's REAL descriptors ──────────
def _descriptor_index(boq_name, sheet_name, committed_version) -> dict:
    """{col_letter: descriptor} for the committed sheet. _committed_descriptors is the
    SAME certified resolver the amount-formula gate uses (review_screen
    ._build_column_descriptors over the committed column_role_map), so 'the columns this
    sheet really has' means exactly one thing across the app."""
    return {
        d["col"]: d
        for d in _committed_descriptors(boq_name, sheet_name, committed_version)
    }


# The two confirmation BUILDERS live in services/boq_bcs/sources.py (BCS-S1a) -- see the
# import block above. This file resolves the sheet's real descriptors and orchestrates;
# the rules about what may be picked are not its business.


# ── endpoints ────────────────────────────────────────────────────────────────────
@frappe.whitelist(methods=["POST"])
def set_bcs_enabled(boq_name=None, sheet_name=None, committed_version=None, enabled=None):
    """Turn the BCS cost section on or off for one committed sheet+version.

    Enabling alone does NOT permit a cost write -- the two columns must also be confirmed
    (bcs_is_ready). Disabling PRESERVES an existing confirmation, so re-enabling does not
    force the user to re-pick the same two columns; readiness simply goes false meanwhile.

    Written via frappe.db.set_value(update_modified=False) + commit -- NOT doc.save, which
    would re-serialize BoQ Sheet's list-valued area_dimensions JSON and throw. Mirrors
    pricing._set_sheet_lock. sheet_name VERBATIM (#152).
    Returns {ok, bcs_enabled, is_ready}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.bcs.set_bcs_enabled"""
    committed_version = _validate_common_args(boq_name, sheet_name, committed_version)
    # `enabled` is required but 0/"0"/False are all VALID (they mean disable) -- _require
    # rejects only None and "", never a falsy-but-present value.
    _require(enabled, "enabled")
    sheet_row = _resolve_sheet_row(boq_name, sheet_name, committed_version)

    # A deliberately-locked sheet is read-only for EVERY save path, this one included.
    _guard_sheet_not_locked(boq_name, sheet_name, committed_version)

    flag = 1 if frappe.utils.cint(enabled) else 0
    frappe.db.set_value(_BOQ_SHEET, sheet_row, "bcs_enabled", flag, update_modified=False)
    frappe.db.commit()
    return {
        "ok": True,
        "bcs_enabled": flag,
        "is_ready": bcs_is_ready(boq_name, sheet_name, committed_version),
    }


@frappe.whitelist(methods=["POST"])
def confirm_bcs_columns(boq_name=None, sheet_name=None, committed_version=None,
                        qty_cols=None, amount_cols=None):
    """Confirm the TWO columns BCS needs, validated against the sheet's REAL columns.

    BOTH picks are JSON lists of Excel column letters, and BOTH accept the SAME two SHAPES
    (owner ruling 2026-08-02, BCS-S1a -- they are one idea, not two):
      `qty_cols`    -- the one scalar Total Quantity column, OR the per-area quantity
                       columns whose SUM is the total (a sheet that maps quantity per area
                       has no scalar total of its own);
      `amount_cols` -- the one scalar Amount column, OR the per-area Amount columns whose
                       SUM is the row's amount. This is what we charge the client, and the
                       denominator of % Profit. BCS-S2b widened it along a SECOND axis: the
                       Supply and Installation HALVES are accepted too, summed, in either
                       shape and including a sheet that carries only ONE of them -- most
                       real sheets have no single "Amount (Total)" column at all. The
                       stored `mode` discloses which of the eight shapes is in force.

    Both are validated against _committed_descriptors, the same resolver the amount-formula
    gate uses. A column the sheet does not have, a mapped column of the wrong class (a rate
    or quantity column), a TOTAL picked together with a half (the total already contains
    it), or a scalar total mixed with its own per-area parts is REFUSED with a named error
    and NOTHING is stored -- validation runs to completion BEFORE the first write, so a
    partial confirmation is impossible.

    Stored as re-resolvable DICTs (never bare lists -- a list-valued JSON field throws in
    get_valid_dict), each entry carrying the full descriptor identity INCLUDING rate_subkey,
    which a three-hop per-area amount needs to resolve. Who + when are recorded and describe
    the CURRENT confirmation. sheet_name VERBATIM (#152).
    Returns {ok, bcs_qty_source, bcs_amount_source, bcs_confirmed_by, bcs_confirmed_at,
    is_ready}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.bcs.confirm_bcs_columns"""
    committed_version = _validate_common_args(boq_name, sheet_name, committed_version)
    sheet_row = _resolve_sheet_row(boq_name, sheet_name, committed_version)
    _guard_sheet_not_locked(boq_name, sheet_name, committed_version)

    index = _descriptor_index(boq_name, sheet_name, committed_version)
    # BOTH validations complete before ANY write -- a refusal stores nothing at all.
    qty_source = build_qty_source(_coerce_col_list(qty_cols, "qty_cols"), index)
    amount_source = build_amount_source(
        _coerce_col_list(amount_cols, "amount_cols"), index
    )

    user = frappe.session.user
    now = now_datetime()
    frappe.db.set_value(
        _BOQ_SHEET,
        sheet_row,
        {
            "bcs_qty_source": json.dumps(qty_source),
            "bcs_amount_source": json.dumps(amount_source),
            "bcs_confirmed_by": user,
            "bcs_confirmed_at": now,
        },
        update_modified=False,
    )
    frappe.db.commit()
    return {
        "ok": True,
        "bcs_qty_source": qty_source,
        "bcs_amount_source": amount_source,
        "bcs_confirmed_by": user,
        "bcs_confirmed_at": now,
        "is_ready": bcs_is_ready(boq_name, sheet_name, committed_version),
    }


@frappe.whitelist()
def get_bcs_state(boq_name=None, sheet_name=None, committed_version=None):
    """The BCS setup state of one committed sheet+version: whether it is enabled, both
    confirmations (parsed), who confirmed them and when, and the derived readiness.

    PURE READ. A sheet with no current committed row at this version returns the
    all-empty, not-ready shape rather than throwing -- the caller renders "BCS not set up",
    which is the truth. sheet_name VERBATIM (#152).
    Returns {boq, sheet_name, committed_version, bcs_enabled, bcs_qty_source,
    bcs_amount_source, bcs_confirmed_by, bcs_confirmed_at, is_ready}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.bcs.get_bcs_state"""
    committed_version = _validate_common_args(boq_name, sheet_name, committed_version)
    empty = {
        "boq": boq_name,
        "sheet_name": sheet_name,
        "committed_version": committed_version,
        "bcs_enabled": 0,
        "bcs_qty_source": None,
        "bcs_amount_source": None,
        "bcs_confirmed_by": None,
        "bcs_confirmed_at": None,
        "is_ready": False,
    }
    name = _current_sheet_name(boq_name, sheet_name, committed_version)
    if not name:
        return empty
    row = frappe.db.get_value(
        _BOQ_SHEET, name,
        ["bcs_enabled", "bcs_qty_source", "bcs_amount_source",
         "bcs_confirmed_by", "bcs_confirmed_at"],
        as_dict=True,
    )
    if not row:
        return empty
    qty = _parse_json_value(row.get("bcs_qty_source"), None)
    amount = _parse_json_value(row.get("bcs_amount_source"), None)
    return {
        **empty,
        "bcs_enabled": 1 if row.get("bcs_enabled") else 0,
        "bcs_qty_source": qty or None,
        "bcs_amount_source": amount or None,
        "bcs_confirmed_by": row.get("bcs_confirmed_by") or None,
        "bcs_confirmed_at": row.get("bcs_confirmed_at") or None,
        "is_ready": bcs_is_ready(boq_name, sheet_name, committed_version),
    }


@frappe.whitelist()
def get_sheet_bcs_rates(boq_name=None, sheet_name=None, committed_version=None):
    """Every CURRENT BCS cost row for one committed (boq, sheet_name VERBATIM #152,
    committed_version). Superseded versions are excluded (is_current=1).

    PURE READ. Returns {boq, sheet_name, committed_version, rows: [...]} -- the stored
    cost INPUTS only (all THREE of them: supply_rate, install_rate and, since BCS-S2b,
    combined_rate); Total Amount and % Profit are computed by the caller, never stored.
    Corrected at BCS-S2c: this said "the two rates only" in the one docstring describing
    the field list S2b widened to three, which reads as a promise that a combined-rate
    sheet's cost is not returned here. It is -- `_BCS_READ_FIELDS` names all three.
    URL: /api/method/nirmaan_stack.api.boq.wizard.bcs.get_sheet_bcs_rates"""
    committed_version = _validate_common_args(boq_name, sheet_name, committed_version)
    rows = frappe.get_all(
        _BCS,
        filters={
            "boq": boq_name,
            "sheet_name": sheet_name,   # VERBATIM (#152)
            "committed_version": committed_version,
            "is_current": 1,
        },
        fields=_BCS_READ_FIELDS,
        order_by="excel_row asc",
    )
    return {
        "boq": boq_name,
        "sheet_name": sheet_name,
        "committed_version": committed_version,
        "rows": rows,
    }


def _current_bcs_names(boq_name, sheet_name, excel_row, committed_version) -> list:
    """Names of the is_current=1 BCS record(s) for one ROW identity. Mirrors
    pricing._current_pricing_names -- normally 0 or 1 (the invariant)."""
    return frappe.get_all(
        _BCS,
        filters={
            "boq": boq_name, "sheet_name": sheet_name, "excel_row": excel_row,
            "committed_version": committed_version, "is_current": 1,
        },
        pluck="name",
    )


def _next_bcs_version(boq_name, sheet_name, excel_row, committed_version) -> int:
    """The next BCS version for one row identity = max prior + 1 (first save = 1).
    Mirrors pricing._next_pricing_version."""
    agg = frappe.get_all(
        _BCS,
        filters={
            "boq": boq_name, "sheet_name": sheet_name, "excel_row": excel_row,
            "committed_version": committed_version,
        },
        fields=["max(bcs_version) as mv"],
    )
    return ((agg[0].mv if agg else None) or 0) + 1


@frappe.whitelist(methods=["POST"])
def save_row_bcs_rates(boq_name=None, sheet_name=None, excel_row=None,
                       committed_version=None, supply_rate=None, install_rate=None,
                       combined_rate=None, description=None):
    """Save the BCS cost rates for ONE committed row -- freeze-and-supersede.

    ALL THREE rates are OPTIONAL and coerce absent/empty to 0.0. `combined_rate` (BCS-S2b)
    is accepted on exactly the same terms as the two halves -- deliberately NOT stricter,
    and deliberately NOT cross-validated against them. WHICH input a sheet offers is the
    SCREEN's decision, so storage refuses to have an opinion: a sheet that changes shape
    must never strand a number it already holds, and a write that silently blanked the
    other field would do exactly that. It is NOT a total of the halves.

    Freezes any prior current (set_value is_current=0, never doc.save), then inserts the
    new current (is_current=1, bcs_version = max(prior)+1, is_filled=1, bcs_rated_at=now).
    The committed sheet + node at that address/version MUST exist; the resolved node is
    stored as the re-resolvable pointer. The committed tier is NOT mutated.

    GATE ORDER -- the ORDERING follows save_cell_price (a refusal mutates NOTHING because
    every gate runs before any write), but the SET is deliberately SMALLER; see the module
    docstring's independence section, owner-confirmed 2026-08-02:
      1. the committed cell must exist  (_resolve_committed_cell)
      2. the sheet must not be deliberately locked  (_guard_sheet_not_locked)
      3. BCS must be set up on this sheet  (_guard_bcs_ready -- BCS CELLS ONLY)
      4. the single-editor pricing lock   (acquire_or_refresh; a fresh lock held by
         another user REJECTS with the BOQ_PRICING_LOCKED marker and writes nothing)
    NOT run here, on purpose: the mandatory amount-formula gate, the priceability gate and
    the category gate. Cost is a separate axis; do not add them for symmetry.
    Only then the freeze + insert, then ONE commit.

    Returns {ok, name, bcs_version, is_current, is_filled, froze_prior}.
    URL: /api/method/nirmaan_stack.api.boq.wizard.bcs.save_row_bcs_rates"""
    committed_version = _validate_common_args(boq_name, sheet_name, committed_version)
    _require(excel_row, "excel_row")
    excel_row = _coerce_int(excel_row, "excel_row")

    def _num(v, field):
        if v is None or v == "":
            return 0.0
        try:
            return float(v)
        except (ValueError, TypeError):
            frappe.throw(f"{field} must be a number.", title=f"Invalid {field}")

    supply_val = _num(supply_rate, "supply_rate")
    install_val = _num(install_rate, "install_rate")
    combined_val = _num(combined_rate, "combined_rate")

    # 1. the cell must exist in the committed tier (yields the node pointer).
    node = _resolve_committed_cell(boq_name, sheet_name, excel_row, committed_version)
    # 2. deliberate per-sheet read-only lock -- wins precedence, as in save_cell_price.
    _guard_sheet_not_locked(boq_name, sheet_name, committed_version)
    # 3. BCS readiness -- guards BCS CELLS ONLY (owner-locked; never the client rate gate).
    _guard_bcs_ready(boq_name, sheet_name, committed_version)
    # 4. single-editor lock, AFTER the guards and BEFORE the write.
    acquire_or_refresh(
        boq_name, sheet_name, committed_version, frappe.session.user, now_datetime()
    )

    prior = _current_bcs_names(boq_name, sheet_name, excel_row, committed_version)
    for name in prior:
        frappe.db.set_value(_BCS, name, "is_current", 0)

    bcs_version = _next_bcs_version(boq_name, sheet_name, excel_row, committed_version)

    doc = frappe.new_doc(_BCS)
    doc.boq = boq_name
    doc.sheet_name = sheet_name  # VERBATIM (#152)
    doc.excel_row = excel_row
    doc.committed_version = committed_version
    doc.node = node["name"]
    doc.description = description
    doc.supply_rate = supply_val
    doc.install_rate = install_val
    doc.combined_rate = combined_val
    doc.is_filled = 1
    # The provenance seam ships defaulted to manual entry; nothing in this arc sets it to
    # anything else (see boq_row_bcs_rate.json rate_source).
    doc.rate_source = "Manual"
    doc.bcs_version = bcs_version
    doc.is_current = 1
    doc.bcs_rated_at = frappe.utils.now()
    doc.insert(ignore_permissions=True)

    frappe.db.commit()
    return {
        "ok": True,
        "name": doc.name,
        "bcs_version": bcs_version,
        "is_current": 1,
        "is_filled": 1,
        "froze_prior": len(prior),
    }
