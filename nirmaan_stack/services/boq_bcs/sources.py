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

# AMOUNT. The amount is what we charge the client -- the denominator of % Profit. It
# varies along TWO INDEPENDENT AXES, and keeping them apart is what makes these rules
# small enough to state:
#
#   the SHAPE axis  -- scalar (one column holds the row's whole figure) or
#                      per-area (N columns, one per area, whose SUM is the figure);
#   the KIND  axis  -- total (the combined amount) or the supply / install HALVES.
#
# S1a widened the shape axis. BCS-S2b widens the KIND axis, and it REVERSES a decision S1
# made (OWNER RULING 2026-08-02):
#
#   * Where a sheet has no scalar total, the denominator is Amount (Supply) + Amount
#     (Installation) SUMMED. Most real sheets turned out to have no single "Amount (Total)"
#     column at all, so refusing the halves left the confirmation card's Amount list EMPTY
#     on most real sheets -- the feature was unusable, not merely strict.
#   * ADAPT AND DISCLOSE, DO NOT REFUSE. A sheet carrying only ONE half is ACCEPTED, and
#     the stored `mode` states the formula actually in force. The earlier recommendation --
#     refuse a lone half, on the grounds that half an amount is not the amount -- was
#     OVERRULED: one-sided packages are genuine commercial shapes, not data gaps. THE
#     SAFETY COMES FROM DISCLOSURE, NOT FROM BLOCKING. Do not reinstate the refusal.
#
# What survived the reversal is the double-count the half-refusal was really protecting: a
# TOTAL ALREADY CONTAINS ITS HALVES, so a total picked together with a half is still
# refused. That is the same harm the total-with-its-own-parts refusals name, arriving along
# the kind axis instead of the shape axis.
_AMOUNT_AREA_VALUE_FIELD = "amount_by_area"

# WHERE a column's kind is written differs by shape, which is the one genuine asymmetry:
# a SCALAR amount carries its kind in the value_field itself (one hop, no subkey), while a
# PER-AREA amount carries it in the descriptor's third hop, `rate_subkey`, because all
# three per-area kinds share the one value_field amount_by_area.
_SCALAR_AMOUNT_FIELD_TO_KIND = {
    "amount_total": "total",
    "amount_supply": "supply",
    "amount_install": "install",
}
_AREA_AMOUNT_KINDS = frozenset({"total", "supply", "install"})

_KIND_TOTAL = "total"
_SHAPE_SCALAR = "scalar"
_SHAPE_AREA = "area"

# THE EIGHT ACCEPTED SHAPES, and the `mode` each one stores. A TABLE, not a string built by
# concatenation: the accepted set has to be ENUMERABLE at a glance, and a combination that
# is not listed here must be impossible to express rather than quietly producing a
# plausible-looking mode string.
#
# The mode is a PERSISTED CONTRACT, and its job is DISCLOSURE: BCS-S2c states the formula
# in plain words from it and BCS-S3 computes against it, so two different formulas may
# never share one mode -- a reader of the stored record must be able to tell which was in
# force. `amount_total` and `amount_by_area` are BYTE-UNCHANGED from S1a, so confirmations
# stored before this slice read back identically.
#
# NOTE what the mode does NOT do: it never branches the arithmetic. In EVERY mode the
# computation is "resolve each stored entry and add them up" -- no coefficient, no
# subtraction, no dropped column. The mode exists for the human and for the refusals.
_AMOUNT_MODES = {
    (_SHAPE_SCALAR, frozenset({"total"})): "amount_total",
    (_SHAPE_SCALAR, frozenset({"supply", "install"})): "amount_supply_plus_install",
    (_SHAPE_SCALAR, frozenset({"supply"})): "amount_supply_only",
    (_SHAPE_SCALAR, frozenset({"install"})): "amount_install_only",
    (_SHAPE_AREA, frozenset({"total"})): "amount_by_area",
    (_SHAPE_AREA, frozenset({"supply", "install"})): "amount_by_area_supply_plus_install",
    (_SHAPE_AREA, frozenset({"supply"})): "amount_by_area_supply_only",
    (_SHAPE_AREA, frozenset({"install"})): "amount_by_area_install_only",
}


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
    # This refusal precedes every per-source rule, so it SHADOWS seven of them whenever a
    # pick carries a duplicate: "Not a quantity column", "Not an amount column", "Mixed
    # quantity sources", "Mixed amount sources", "Mixed amount kinds" -- and, for EVERY
    # input rather than merely some, "Too many total-quantity columns" and "Too many amount
    # columns", because two picks of one scalar kind necessarily share a resolved
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


def _amount_axes(desc: dict) -> tuple:
    """Place one descriptor on the two amount axes -> (shape, kind), or (None, None) if it
    is not an amount column at all.

    REPLACED `_is_combined_amount` at BCS-S2b. That predicate answered one yes/no question
    -- "is this the combined amount?" -- which is exactly the question that stopped being
    the right one when the halves became acceptable. A pick is no longer judged on its own;
    it is judged against the OTHER picks (a half is fine, a half beside a total is not), so
    the module now READS each column's position and compares positions afterwards."""
    field = desc.get("value_field")
    kind = _SCALAR_AMOUNT_FIELD_TO_KIND.get(field)
    if kind:
        return _SHAPE_SCALAR, kind
    if field == _AMOUNT_AREA_VALUE_FIELD:
        subkey = desc.get("rate_subkey")
        if subkey in _AREA_AMOUNT_KINDS:
            return _SHAPE_AREA, subkey
    return None, None


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
    """Validate the Amount picks and build the stored confirmation, or throw.

    The amount is what we charge the client and the denominator of % Profit. It may be the
    sheet's one scalar Amount column, the per-area Amount columns whose SUM is the row's
    amount, or -- since BCS-S2b -- the SUPPLY and INSTALLATION halves in either of those
    shapes, summed, INCLUDING a sheet that carries only one of the two. The stored `mode`
    records which of the eight accepted shapes this is, so the formula in force can be
    stated rather than assumed.

    Refuses: an empty selection; a column the sheet does not have; two picks that resolve
    to the SAME value; a mapped column that is not an amount column at all (a rate column,
    a quantity column); a TOTAL picked together with a half (the total already contains
    it); and scalar amounts picked together with per-area ones."""
    if not cols:
        frappe.throw(
            "Pick at least one Amount column: the sheet's Amount column, the per-area "
            "Amount columns that add up to it, or its Supply and Installation amounts.",
            title="No amount column picked",
        )
    picked = _resolve_picks(cols, index)

    # -- the CLASS check: is each pick an amount column at all? -------------
    # Widening the KIND axis must not widen this. A rate or quantity column is still not an
    # amount, however the rest of the pick is shaped.
    axes = [(d, *_amount_axes(d)) for d in picked]
    bad = [d for d, shape, _kind in axes if shape is None]
    if bad:
        frappe.throw(
            f"Column(s) {', '.join(d['col'] for d in bad)} are not Amount columns on this "
            f"sheet (mapped as {', '.join(sorted({str(d.get('role')) for d in bad}))}). "
            f"BCS compares its cost against the amount charged to the client, so it needs "
            f"an Amount column -- not a rate column, and not a quantity.",
            title="Not an amount column",
        )

    shapes = {shape for _d, shape, _k in axes}
    kinds = {kind for _d, _s, kind in axes}

    # -- the KIND axis: a TOTAL already CONTAINS its halves -----------------
    # THE ONE PIECE OF THE HALF-REFUSAL THAT SURVIVED BCS-S2b'S REVERSAL. A lone half is
    # now perfectly acceptable; a half sitting BESIDE the total that already includes it is
    # a double-count, exactly like a total beside its own per-area parts.
    #
    # ORDERING -- checked BEFORE the shape rule, and that is provably free. To reach the
    # shape rule under the old code every pick had to be the COMBINED amount, so no input
    # that used to be refused as "Mixed amount sources" was ever kind-mixed. Putting the
    # more specific message first therefore cannot change the message any previously
    # refused input receives.
    if _KIND_TOTAL in kinds and len(kinds) > 1:
        frappe.throw(
            "Pick either the sheet's combined Amount column(s) OR its Supply and "
            "Installation amounts -- not both. The combined Amount already includes the "
            "supply and installation halves, so adding one to it would count that half "
            "twice.",
            title="Mixed amount kinds",
        )

    # -- the SHAPE axis: a scalar is the total of the per-area ones ---------
    # UNCHANGED by this slice, and deliberately not widened: no owner ruling covers a sheet
    # that genuinely splits one kind scalar and the other per area, so that stays refused
    # rather than guessed at. If such a sheet ever turns up it is a ruling, not a bug.
    if len(shapes) > 1:
        frappe.throw(
            "Pick either the scalar Amount column(s) OR the per-area Amount columns -- "
            "not both. Adding a total to its own parts would count every amount twice.",
            title="Mixed amount sources",
        )

    shape = next(iter(shapes))

    # RETAINED, and UNREACHABLE by construction -- the same disposition BCS-S1c recorded
    # for its own shadowed refusals, for the same reason: dropping a live refusal is a
    # behaviour change of its own, and this is the correctly voiced one should the
    # duplicate key ever narrow. On the scalar shape a column's kind IS its value_field, so
    # two picks of one kind necessarily share a resolved identity and _resolve_picks has
    # already refused them as duplicates. Note what this is NOT: the pre-S2b "a sheet has
    # exactly one Amount column" rule, which this slice made simply FALSE -- a scalar sheet
    # legitimately contributes TWO columns now, its supply and its install.
    if shape == _SHAPE_SCALAR and len(picked) != len(kinds):
        frappe.throw(
            "Pick each scalar Amount column once -- one combined Amount, or one Supply "
            "and one Installation amount.",
            title="Too many amount columns",
        )

    # Indexed, NOT .get(...) with a fallback: every (shape, kinds) pair the guards above
    # permit is in the table, so a KeyError here can only mean a new amount KIND was added
    # without deciding what formula it stores. That must fail loudly rather than mint a
    # plausible mode for a shape nobody ruled on.
    mode = _AMOUNT_MODES[(shape, frozenset(kinds))]
    return {"mode": mode, "columns": [_entry(d) for d in picked]}
