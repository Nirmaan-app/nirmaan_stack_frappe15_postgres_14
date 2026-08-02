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

# AMOUNT. The owner's "Amount (Combined)" is what we charge the client -- the denominator
# of % Profit. It comes in the SAME two shapes as quantity, and is validated and summed the
# same way (OWNER RULING 2026-08-02, slice BCS-S1a):
#   scalar   -- one mapped amount_total column;
#   per-area -- N mapped per-area COMBINED amount columns whose SUM is the row's amount.
# S1 accepted the scalar shape ONLY. That meant a sheet mapping its amounts per area could
# not enable BCS at all -- and that is the shape of the shared committed fixture, so it was
# never hypothetical. The two sources now read as ONE idea, not two.
_AMOUNT_SCALAR_VALUE_FIELD = "amount_total"
_AMOUNT_AREA_VALUE_FIELD = "amount_by_area"

# A per-area amount column carries its KIND in the descriptor's third hop (`rate_subkey`):
# "total" is the per-area COMBINED amount (role amount_total_by_area), while "supply" and
# "install" are the split halves. Only the combined kind is what we charge the client --
# accepting a half here would silently compare our cost against a fraction of the charged
# amount. This is the per-area twin of refusing the scalar amount_supply / amount_install.
_AMOUNT_AREA_COMBINED_SUBKEY = "total"


def _entry(desc: dict) -> dict:
    """One stored, RE-RESOLVABLE confirmation entry: the full descriptor identity, so a
    later reader resolves the value without re-deriving it from column_role_map.

    `rate_subkey` is load-bearing for a PER-AREA AMOUNT, which is a THREE-hop resolve
    (amount_by_area[area][kind]); quantity never needed it because qty_by_area[area] is
    two hops. Recording it for every entry (None on the two-hop shapes) keeps one entry
    shape rather than a per-source special case."""
    return {
        "col": desc.get("col"),
        "role": desc.get("role"),
        "area": desc.get("area"),
        "value_field": desc.get("value_field"),
        "value_key": desc.get("value_key"),
        "rate_subkey": desc.get("rate_subkey"),
    }


def _resolve_picks(cols: list, index: dict) -> list:
    """Map picked column letters onto the sheet's REAL descriptors, or throw naming the
    column. Shared by both sources, so the two refusals living here -- an unknown column,
    and two picks that resolve to the same value -- read identically either way and
    cannot drift into two copies."""
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

    # TWO picks that resolve to the SAME number would be stored as two entries and summed,
    # and the row would count that number twice -- the same harm the mixed total-and-parts
    # refusals name ("would count every amount twice"), arriving by a different route.
    #
    # ONE rule, two voicings. BCS-S1b keyed it on the picked LETTER, which turned out to be
    # only the DEGENERATE case: two DIFFERENT letters can resolve to one value, because
    # review_screen._build_column_descriptors imposes no uniqueness on (role, area) across
    # columns. A sheet mapping Zone A quantity on both D and E therefore let ["D", "E"]
    # straight through and double-counted exactly what S1b existed to prevent. The key is
    # now the RESOLVED IDENTITY (value_field, value_key, rate_subkey), which SUBSUMES the
    # letter case -- the same letter necessarily resolves identically. The letter check is
    # kept ahead of it only to voice that case in its own words, never to decide a
    # different outcome (BCS-S1c).
    #
    # ORDERING -- what it promises, and what it does NOT. The resolve loop above runs
    # FIRST, so an unknown column is still reported as UNKNOWN, the more fundamental fact
    # about it, rather than as a duplicate. That is the whole of the promise; it is NOT
    # true that every input throwing before this rule existed still throws the same TITLE.
    # This refusal precedes every per-source rule, so it SHADOWS six of them whenever a
    # pick carries a duplicate: "Not a quantity column", "Not the Amount (Combined)
    # column", "Mixed quantity sources", "Mixed amount sources" -- and, for EVERY input
    # rather than merely some, "Too many total-quantity columns" and "Too many amount
    # columns", because two scalar totals of one role necessarily share a resolved
    # identity. Those last two are UNREACHABLE as of BCS-S1c. They are RETAINED, not
    # deleted: they are the correctly voiced refusal should this key ever narrow, and
    # dropping a live refusal is a behaviour change of its own. No test anywhere asserts
    # on a shadowed title, so nothing breaks -- but a reader debugging a surprising
    # message should know where it went.
    seen: set = set()
    dupes: list = []
    for col in cols:
        if col in seen:
            if col not in dupes:
                dupes.append(col)
        else:
            seen.add(col)
    if dupes:
        frappe.throw(
            f"Column(s) {', '.join(dupes)} are picked more than once. Pick each column "
            f"once -- repeating one would count its value twice.",
            title="Duplicate column",
        )

    by_value: dict = {}
    for desc in picked:
        key = (desc.get("value_field"), desc.get("value_key"), desc.get("rate_subkey"))
        by_value.setdefault(key, []).append(desc.get("col"))
    aliased = [group for group in by_value.values() if len(group) > 1]
    if aliased:
        frappe.throw(
            f"Column(s) {'; '.join(', '.join(g) for g in aliased)} resolve to the same "
            f"value on this sheet, so picking them together would count that value twice. "
            f"Pick one column per value.",
            title="Duplicate column",
        )
    return picked


def _is_combined_amount(desc: dict) -> bool:
    """Is this descriptor a COMBINED amount column -- the thing we charge the client?

    Scalar: value_field amount_total (amount_supply / amount_install are halves, refused).
    Per-area: value_field amount_by_area AND rate_subkey "total" (the per-area supply and
    install halves carry "supply" / "install" and are refused for the same reason)."""
    field = desc.get("value_field")
    if field == _AMOUNT_SCALAR_VALUE_FIELD:
        return True
    if field == _AMOUNT_AREA_VALUE_FIELD:
        return desc.get("rate_subkey") == _AMOUNT_AREA_COMBINED_SUBKEY
    return False


def build_qty_source(cols: list, index: dict) -> dict:
    """Validate the quantity picks and build the stored confirmation, or throw.

    Refuses: an empty selection; a column the sheet does not have; two picks that resolve
    to the SAME value (the same letter twice, or two letters carrying one number); a
    mapped column that is not a quantity column; more than one scalar total; and a scalar
    total MIXED with per-area quantity columns (which would double-count)."""
    if not cols:
        frappe.throw(
            "Pick at least one quantity column: either the sheet's Total Quantity column "
            "or the per-area quantity columns that add up to it.",
            title="No quantity column picked",
        )
    picked = _resolve_picks(cols, index)

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


def build_amount_source(cols: list, index: dict) -> dict:
    """Validate the Amount (Combined) picks and build the stored confirmation, or throw.

    Deliberately the MIRROR of build_qty_source (owner ruling 2026-08-02): the amount is
    either the sheet's one scalar Amount (Combined) column, or the per-area combined-amount
    columns whose SUM is the row's amount. Same shape, same refusals, same reasons --
    an empty selection; a column the sheet does not have; two picks that resolve to the
    SAME value; a mapped column that is not a combined-amount column (a rate column, or
    the supply/install HALF of an amount); more than one scalar total; and a scalar total
    MIXED with its own per-area parts."""
    if not cols:
        frappe.throw(
            "Pick at least one Amount (Combined) column: either the sheet's combined "
            "Amount column or the per-area Amount columns that add up to it.",
            title="No amount column picked",
        )
    picked = _resolve_picks(cols, index)

    bad = [d["col"] for d in picked if not _is_combined_amount(d)]
    if bad:
        frappe.throw(
            f"Column(s) {', '.join(bad)} are not this sheet's combined Amount column(s) "
            f"(mapped as {', '.join(sorted({str(d.get('role')) for d in picked if not _is_combined_amount(d)}))}). "
            f"BCS compares its cost against the amount charged to the client, so it needs "
            f"the Amount (Combined) column -- not a rate column, and not the supply or "
            f"install half of an amount.",
            title="Not the Amount (Combined) column",
        )

    fields = {d.get("value_field") for d in picked}
    if len(fields) > 1:
        frappe.throw(
            "Pick either the scalar Amount (Combined) column OR the per-area Amount "
            "columns -- not both. Adding a total to its own parts would count every "
            "amount twice.",
            title="Mixed amount sources",
        )

    if fields == {_AMOUNT_SCALAR_VALUE_FIELD}:
        if len(picked) != 1:
            frappe.throw(
                "A sheet has exactly one combined Amount column; pick one.",
                title="Too many amount columns",
            )
        mode = "amount_total"
    else:
        mode = "amount_by_area"
    return {"mode": mode, "columns": [_entry(d) for d in picked]}
