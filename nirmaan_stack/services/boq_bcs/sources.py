# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The TWO BCS column confirmations -- the business rules, defined once.

BCS compares what a row costs US against what we charge the CLIENT, so it needs two
numbers off the committed sheet: the row's Total Quantity, and the AMOUNT CHARGED.
Neither is a single fixed column across BoQs -- a sheet may express either as one scalar
column or as several per-area columns -- so the human CONFIRMS which columns to use, once
per sheet, and that confirmation is stored re-resolvably.

⚠️ "THE ROW'S COMBINED AMOUNT" IS NOT THE RULE, AND HAS NOT BEEN SINCE BCS-S2b (corrected
at BCS-S2d). This header said exactly that, which is the pre-S2b world: the amount also
varies along a KIND axis, and the SUPPLY / INSTALLATION halves are accepted -- including a
sheet that carries only ONE of them. See the AMOUNT block below for the eight shapes. The
stale sentence mattered more here than anywhere else it appeared: this module DEFINES the
rules, so its own header is the first thing a reader trusts and the last thing they think
to doubt.

This module owns the decisions in that sentence: what a valid quantity source is, what a
valid amount source is, and which combinations are refused. They were relocated out of
`api/boq/wizard/bcs.py` at slice BCS-S1a for the reason ADR-0010 B1 gives -- a calculation
or decision the business NAMES belongs in a pure service module, not inside a whitelisted
endpoint. The `boq_category.persist.node_is_qty_bearing` / `resolve_row_ladder`
relocations are the precedent, and this follows their shape.

PURITY CONTRACT (the seam): every function here takes the picks and/or the sheet's own
column descriptors and returns a plain value. No `frappe.db`, no request context, no import
from `api/`. `frappe.throw` is the ONE framework touch, and it is deliberate -- a refusal
here is a user-facing, named refusal, and raising a bare ValueError would make every caller
re-voice it.

⚠️ THE SIGNATURE LINE ABOVE USED TO SAY `(picks, descriptor index) -> dict`, FULL STOP, and
the BCS-export slice widened it. The two DERIVATIONS at the foot of this file take
`(source, descriptors)` and `(descriptors)` -- they answer "which columns does BCS use when
nobody confirmed any", which is the same subject as the confirmations above and belongs in
the same home, but it is not the same shape. Stating the contract loosely is worse than
stating it wrongly, so it is stated as it now is.
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


# ── THE REFUSAL VOCABULARY (BCS-S2e) ─────────────────────────────────────────────
# Every refusal carries a short, stable CODE alongside the sentence a user reads. The code is
# the ONE thing this module and its browser mirror (`frontend/src/pages/boq-wizard/
# bcsColumns.ts`) can compare, and `parity_cases.json` -- read by BOTH test suites -- is where
# the comparison is written down.
#
# WHY A CODE WAS NEEDED AT ALL. The two sides refuse in deliberately different voices: this
# module throws a (title, message) pair, the card renders a friendlier sentence. Only the
# success `mode` was ever comparable between them, so a parity test built on what existed
# would have covered the ten modes and NONE of the refusal chain -- the partial test that makes
# a gap look closed. ADR-0010 F1 asks for a mirror to be pinned; this is what made it possible.
#
# ⚠️ THE CODE IS THE CONTRACT; THE WORDING IS NOT. Reword a message freely. Change a code, or
# the ORDER below, and you are changing what the browser must mirror -- update
# `parity_cases.json` in the same edit or both suites will tell you.
REFUSAL_CODES = frozenset({
    "no_pick",           # nothing was picked at all
    "unknown_column",    # a picked letter is not a mapped column on this sheet
    "duplicate_column",  # the same letter appears twice
    "aliased_columns",   # two DIFFERENT letters resolve to one value
    "wrong_class",       # a mapped column of the wrong class for this side
    "mixed_kinds",       # AMOUNT ONLY -- a total picked beside a half it already contains
    "mixed_shapes",      # scalar mixed with per-area
    "too_many_scalars",  # more than one scalar column of a single kind
})

# THE ORDER IS THE SPEC, and it is declared here so both suites can assert against it. It
# decides WHICH refusal a bad pick gets, and a user does not experience a different complaint
# for the same pick as a wording nit -- it reads as the screen and the server disagreeing about
# their sheet. `too_many_scalars` is RETAINED-but-shadowed on both sides (see the notes on
# `_resolve_picks` and `decide_amount_source`); the table records that, and pins the inputs
# that shadow it, rather than letting it look exercised.
QTY_REFUSAL_ORDER = (
    "no_pick", "unknown_column", "duplicate_column", "aliased_columns",
    "wrong_class", "mixed_shapes", "too_many_scalars",
)
AMOUNT_REFUSAL_ORDER = (
    "no_pick", "unknown_column", "duplicate_column", "aliased_columns",
    "wrong_class", "mixed_kinds", "mixed_shapes", "too_many_scalars",
)


def _refuse(code: str, title: str, message: str) -> dict:
    """One refusal, as a VALUE. The code identifies the condition; the title and message are
    the voice, carried unchanged from where they have always been written.

    THE ASSERT IS DELIBERATE. A typo'd code would make the parity table compare a string that
    can never appear, which is precisely the silently-passing test this slice exists to
    prevent -- so an unknown code fails at the point it is minted rather than at the point
    somebody trusts the green suite."""
    assert code in REFUSAL_CODES, f"unknown BCS refusal code {code!r}"
    return {"ok": False, "code": code, "title": title, "message": message}


def _accept(mode: str, picked: list) -> dict:
    """One acceptance, as a VALUE. `source` is EXACTLY the dict `build_*_source` has always
    returned and `confirm_bcs_columns` json.dumps into the sheet -- the decision envelope must
    never leak into that persisted blob."""
    return {"ok": True, "source": {"mode": mode, "columns": [_entry(d) for d in picked]}}


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


def _resolve_picks(cols: list, index: dict) -> tuple:
    """Map picked column letters onto the sheet's REAL descriptors -> `(picked, refusal)`,
    where exactly one of the two is meaningful. Shared by both sources, so the three refusals
    living here -- an unknown column, a repeated letter, and two letters that resolve to the
    same value -- read identically either way and cannot drift into two copies.

    RETURNS a refusal rather than throwing since BCS-S2e. The decision has to be observable as
    a VALUE for the parity table to compare it; `build_*_source` still throws, one hop up."""
    picked = []
    for col in cols:
        desc = index.get(col)
        if not desc:
            return [], _refuse(
                "unknown_column",
                "Unknown column",
                f"Column '{col}' is not a mapped column on this sheet. "
                f"Mapped columns: {', '.join(sorted(index)) or '(none)'}.",
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
        return [], _refuse(
            "duplicate_column",
            "Duplicate column",
            f"Column(s) {', '.join(dupes)} are picked more than once. Pick each column "
            f"once -- repeating one would count its value twice.",
        )

    by_value: dict = {}
    for desc in picked:
        key = (desc.get("value_field"), desc.get("value_key"), desc.get("rate_subkey"))
        by_value.setdefault(key, []).append(desc.get("col"))
    aliased = [group for group in by_value.values() if len(group) > 1]
    if aliased:
        return [], _refuse(
            "aliased_columns",
            "Duplicate column",
            f"Column(s) {'; '.join(', '.join(g) for g in aliased)} resolve to the same "
            f"value on this sheet, so picking them together would count that value twice. "
            f"Pick one column per value.",
        )
    return picked, None


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


def decide_qty_source(cols: list, index: dict) -> dict:
    """★ THE QUANTITY DECISION, as a VALUE -- `{"ok": True, "source": {...}}` or a refusal
    carrying its code, title and message. `build_qty_source` is the throwing face of this.

    Refuses, IN THIS ORDER (`QTY_REFUSAL_ORDER`, mirrored by the browser and pinned by
    `parity_cases.json`): an empty selection; a column the sheet does not have; the same
    letter twice; two letters carrying one number; a mapped column that is not a quantity
    column; a scalar total MIXED with per-area quantity columns (which would double-count);
    and more than one scalar total."""
    if not cols:
        return _refuse(
            "no_pick",
            "No quantity column picked",
            "Pick at least one quantity column: either the sheet's Total Quantity column "
            "or the per-area quantity columns that add up to it.",
        )
    picked, refusal = _resolve_picks(cols, index)
    if refusal:
        return refusal

    fields = {d.get("value_field") for d in picked}
    if not fields <= {_QTY_SCALAR_VALUE_FIELD, _QTY_AREA_VALUE_FIELD}:
        bad = [d["col"] for d in picked
               if d.get("value_field") not in (_QTY_SCALAR_VALUE_FIELD,
                                               _QTY_AREA_VALUE_FIELD)]
        return _refuse(
            "wrong_class",
            "Not a quantity column",
            f"Column(s) {', '.join(bad)} are not quantity columns on this sheet.",
        )
    if len(fields) > 1:
        return _refuse(
            "mixed_shapes",
            "Mixed quantity sources",
            "Pick either the scalar Total Quantity column OR the per-area quantity "
            "columns -- not both. Adding a total to its own parts would count every "
            "quantity twice.",
        )

    if fields == {_QTY_SCALAR_VALUE_FIELD}:
        # RETAINED, and UNREACHABLE by construction -- two scalar totals necessarily share a
        # resolved identity, so `aliased_columns` has already answered. The shadow is pinned
        # on BOTH sides by the `qty-shadow-two-scalar-totals` parity case, so this cannot
        # quietly start answering on one side only.
        if len(picked) != 1:
            return _refuse(
                "too_many_scalars",
                "Too many total-quantity columns",
                "A sheet has exactly one Total Quantity column; pick one.",
            )
        mode = "qty_total"
    else:
        mode = "qty_by_area"
    return _accept(mode, picked)


def build_qty_source(cols: list, index: dict) -> dict:
    """The THROWING face of `decide_qty_source` -- what `confirm_bcs_columns` calls.

    A thin wrapper on purpose (BCS-S2e): one rule chain, two presentations. Every message and
    title is byte-unchanged from where it was before the split, because the wrapper does not
    compose wording -- it hands on the refusal's own. `test_the_thrown_message_is_the_refusals_
    own_message` pins that, so this can never become a second place wording lives."""
    out = decide_qty_source(cols, index)
    if not out["ok"]:
        frappe.throw(out["message"], title=out["title"])
    return out["source"]


def decide_amount_source(cols: list, index: dict) -> dict:
    """★ THE AMOUNT DECISION, as a VALUE -- `{"ok": True, "source": {...}}` or a refusal
    carrying its code, title and message. `build_amount_source` is the throwing face of this.

    The amount is what we charge the client and the denominator of % Profit. It may be the
    sheet's one scalar Amount column, the per-area Amount columns whose SUM is the row's
    amount, or -- since BCS-S2b -- the SUPPLY and INSTALLATION halves in either of those
    shapes, summed, INCLUDING a sheet that carries only one of the two. The stored `mode`
    records which of the eight accepted shapes this is, so the formula in force can be
    stated rather than assumed.

    Refuses, IN THIS ORDER (`AMOUNT_REFUSAL_ORDER`, mirrored by the browser and pinned by
    `parity_cases.json`): an empty selection; a column the sheet does not have; the same
    letter twice; two letters carrying one number; a mapped column that is not an amount
    column at all (a rate column, a quantity column); a TOTAL picked together with a half
    (the total already contains it); scalar amounts picked together with per-area ones; and
    more than one scalar amount of one kind."""
    if not cols:
        return _refuse(
            "no_pick",
            "No amount column picked",
            "Pick at least one Amount column: the sheet's Amount column, the per-area "
            "Amount columns that add up to it, or its Supply and Installation amounts.",
        )
    picked, refusal = _resolve_picks(cols, index)
    if refusal:
        return refusal

    # -- the CLASS check: is each pick an amount column at all? -------------
    # Widening the KIND axis must not widen this. A rate or quantity column is still not an
    # amount, however the rest of the pick is shaped.
    axes = [(d, *_amount_axes(d)) for d in picked]
    bad = [d for d, shape, _kind in axes if shape is None]
    if bad:
        return _refuse(
            "wrong_class",
            "Not an amount column",
            f"Column(s) {', '.join(d['col'] for d in bad)} are not Amount columns on this "
            f"sheet (mapped as {', '.join(sorted({str(d.get('role')) for d in bad}))}). "
            f"BCS compares its cost against the amount charged to the client, so it needs "
            f"an Amount column -- not a rate column, and not a quantity.",
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
        return _refuse(
            "mixed_kinds",
            "Mixed amount kinds",
            "Pick either the sheet's combined Amount column(s) OR its Supply and "
            "Installation amounts -- not both. The combined Amount already includes the "
            "supply and installation halves, so adding one to it would count that half "
            "twice.",
        )

    # -- the SHAPE axis: a scalar is the total of the per-area ones ---------
    # The RULE is UNCHANGED by BCS-S2b, and deliberately not widened: no owner ruling covers
    # a sheet that genuinely splits one kind scalar and the other per area, so that stays
    # refused rather than guessed at. If such a sheet ever turns up it is a ruling, not a bug.
    #
    # THE VOICING, HOWEVER, DID NOT FOLLOW THE WIDENING (corrected BCS-S2c). It read "Adding
    # a total to its own parts would count every amount twice", which was true of every input
    # that could reach here BEFORE S2b -- back then every pick had to be the combined amount,
    # so a shape mix was necessarily a total beside its own per-area parts. Two new families
    # reach this line now, and the old sentence is false about both:
    #
    #   scalar supply + per-area supply   -- no total is present anywhere in the pick;
    #   scalar supply + per-area install  -- not even the same figure, so nothing is being
    #                                        double-counted; this is the un-ruled shape.
    #
    # The replacement states the rule and gives BOTH reasons, so it is true of every input
    # that can reach it. A refusal that explains itself with a fact the user can see is false
    # sends them looking for a total they never picked.
    if len(shapes) > 1:
        return _refuse(
            "mixed_shapes",
            "Mixed amount sources",
            "Pick Amount columns of ONE shape -- either the scalar Amount column(s) or the "
            "per-area Amount columns, not a mix of the two. A scalar column holds the row's "
            "whole figure while the per-area columns split a figure across areas, so mixing "
            "them either counts the same amount twice or combines two figures BCS has no "
            "rule for adding together.",
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
        return _refuse(
            "too_many_scalars",
            "Too many amount columns",
            "Pick each scalar Amount column once -- one combined Amount, or one Supply "
            "and one Installation amount.",
        )

    # Indexed, NOT .get(...) with a fallback: every (shape, kinds) pair the guards above
    # permit is in the table, so a KeyError here can only mean a new amount KIND was added
    # without deciding what formula it stores. That must fail loudly rather than mint a
    # plausible mode for a shape nobody ruled on.
    #
    # ⚠️ THE ONE PLACE THE TWO SIDES ANSWER DIFFERENTLY ON PURPOSE (BCS-S2e). The browser's
    # equivalent miss returns a refusal coded `unruled_combination`; this raises a bare
    # KeyError. Both are unreachable by construction, and the asymmetry is RECORDED in
    # `parity_cases.json` under `client_only_codes` -- with a test on each side pinning that
    # the code stays OUT of the parity vocabulary -- rather than papered over by giving this
    # a code and a sentence it would never say.
    mode = _AMOUNT_MODES[(shape, frozenset(kinds))]
    return _accept(mode, picked)


def build_amount_source(cols: list, index: dict) -> dict:
    """The THROWING face of `decide_amount_source` -- what `confirm_bcs_columns` calls.

    A thin wrapper on purpose (BCS-S2e); see `build_qty_source` for why the split exists and
    what keeps the two from becoming two rule chains."""
    out = decide_amount_source(cols, index)
    if not out["ok"]:
        frappe.throw(out["message"], title=out["title"])
    return out["source"]


# ═════════════════════════════════════════════════════════════════════════════════
# THE TWO DERIVATIONS -- which columns BCS uses when nobody confirmed any
# ═════════════════════════════════════════════════════════════════════════════════
# Everything above answers "is this PICK valid?". These two answer the question that comes
# BEFORE a pick exists: given only the sheet's own shape, which columns does BCS use?
#
# WHY THAT QUESTION EXISTS AT ALL. BCS-S12 removed both column pickers from the BCS dialog,
# so `confirm_bcs_columns` has had NO caller in the product since -- grep the frontend: the
# UI calls `set_bcs_enabled`, `get_bcs_state`, `get_sheet_bcs_rates` and
# `save_row_bcs_rates`, and nothing else. A sheet enabled after S12 therefore carries NO
# `bcs_qty_source`, and there is no longer any way to give it one. MEASURED on the live
# bench 2026-08-19: of the 7 BCS-enabled current sheets, SIX have no confirmed quantity
# source and only the oldest (BOQ-26-00140, pre-S12) has one. A rule that required the
# confirmation would answer "no quantity" on six sheets out of seven, and on every sheet
# enabled from here on.
#
# The browser already answers it -- `bcsQuantityColumns` / `bcsLiveRateKinds` in
# `frontend/src/pages/boq-wizard/bcsColumns.ts`. Until now nothing on the server needed to,
# because nothing on the server ever computed a BCS number. The BCS export does: it writes
# the cost columns and an Excel Total formula into a copy of the client's workbook, so it
# has to know which cost boxes the sheet has and which cells its quantity lives in.
#
# ⚠️ SO THESE ARE A MIRROR, AND A MIRROR IS A LIABILITY UNLESS IT IS PINNED. ADR-0010 F1
# asks for a parity test, and `parity_cases.json` -- already read by BOTH suites for the
# confirmations -- gained two more case lists for exactly these two functions. The reason is
# not theoretical: at BCS-S2b the server widened to eight amount shapes while the browser
# silently refused six of them for a whole slice, with every test on both sides green. Do
# not add a third copy of either rule, and do not change one of these without changing its
# twin and the table in the same edit.


def derive_qty_columns(source: dict | None, descriptors: list | None) -> list:
    """★ WHICH COLUMNS HOLD THIS SHEET'S QUANTITY -- the multiplicand of BCS Total Amount.

    A stored CONFIRMATION wins wherever one exists, so every sheet configured before BCS-S12
    resolves EXACTLY as it always has. Otherwise the sheet's OWN quantity columns are used:
    the scalar Total Quantity column if it maps one, else the per-area quantity columns,
    whose SUM is the total.

    ⚠️ SCALAR BEATS PER-AREA, AND IT IS NOT A PREFERENCE. A sheet mapping both would have its
    quantity counted TWICE if the two were concatenated -- the same double count
    `decide_qty_source` refuses under `mixed_shapes` when a human picks both. The fallback
    must not be able to express what the confirmation forbids.

    Returns entries in the `_entry` shape (the stored-confirmation shape), so ONE reader
    resolves either branch without asking which one it got. Empty list = this sheet has no
    quantity at all, which is a real answer and not an error: the caller renders no Total
    rather than inventing one.

    Mirrors `bcsColumns.bcsQuantityColumns`. Pinned by `parity_cases.json`
    -> `derived_qty_cases`.
    """
    confirmed = (source or {}).get("columns") or []
    if confirmed:
        return list(confirmed)
    ds = descriptors or []
    scalar = [d for d in ds if d.get("value_field") == _QTY_SCALAR_VALUE_FIELD]
    if scalar:
        return [_entry(d) for d in scalar]
    return [_entry(d) for d in ds if d.get("value_field") == _QTY_AREA_VALUE_FIELD]


# WHICH COST BOXES A SHEET GETS -- the rate vocabulary, read from the sheet's OWN rate columns.
#
# ⚠️ A PER-AREA RATE SPELLS ITS KIND `supply_rate` / `install_rate` / `combined_rate`, NOT
# `supply` / `install` / `total`. That is the AMOUNT side's vocabulary, and the two are
# genuinely different: `classifier._RATE_ROLE_TO_KIND` maps the three rate_*_by_area roles to
# the first set and `_AMOUNT_ROLE_TO_KIND` maps the three amount_*_by_area roles to the second,
# and `review_screen._build_column_descriptors` writes whichever applies into the SAME generic
# `rate_subkey` slot. The browser twin had the amount spelling here and therefore matched no
# per-area rate column at all -- see the correction note in `bcsColumns.bcsLiveRateKinds`.
_SCALAR_RATE_FIELD_TO_BCS_KIND = {
    "rate_supply": "supply",
    "rate_install": "install",
    "rate_combined": "combined",
}
_PER_AREA_RATE_VALUE_FIELD = "rate_by_area"
_PER_AREA_RATE_SUBKEY_TO_BCS_KIND = {
    "supply_rate": "supply",
    "install_rate": "install",
    "combined_rate": "combined",
}
# Canonical box order -- NEVER the sheet's Excel column order, so two sheets mapping the same
# two rates in different orders present the same boxes in the same places.
_BCS_KIND_ORDER = ("supply", "install", "combined")


def live_rate_kinds(descriptors: list | None) -> list:
    """★ WHICH COST BOXES A SHEET GETS (owner ruling 2026-08-02): no Rate (Supply) column
    means no Supply box; a combined-rate sheet gets ONE undifferentiated box; a sheet with no
    rate column at all cannot do BCS and gets none.

    ⚠️ THE HALVES WIN OVER A COMBINED RATE MAPPED BESIDE THEM, and that is a RULING, not a
    detail. `bcs.py` forbids summing `combined_rate` with the two halves -- "never sum it with
    them, never derive it from them" -- so the returned set must NEVER hold both, or BCS Total
    double-counts. That makes the prohibition STRUCTURAL: the arithmetic downstream cannot
    express the forbidden sum, because the set it is handed never contains both. MEASURED: 22
    of 553 current committed sheets map all three (Supply | Install | Total Rate is an ordinary
    layout), and on the live bench BOQ-26-00161's Electrical sheet is one of them -- so this
    fires on real data, today.

    IT IS A NARROWING, NEVER A WIDENING. Reversing it is a one-function change and nothing
    downstream reads the rate columns again.

    Mirrors `bcsColumns.bcsLiveRateKinds`. Pinned by `parity_cases.json` -> `rate_kinds_cases`.
    """
    present = set()
    for d in descriptors or []:
        field = d.get("value_field")
        kind = _SCALAR_RATE_FIELD_TO_BCS_KIND.get(field)
        if kind:
            present.add(kind)
            continue
        if field == _PER_AREA_RATE_VALUE_FIELD:
            kind = _PER_AREA_RATE_SUBKEY_TO_BCS_KIND.get(d.get("rate_subkey"))
            if kind:
                present.add(kind)
    halves = [k for k in _BCS_KIND_ORDER if k != "combined" and k in present]
    if halves:
        return halves
    return ["combined"] if "combined" in present else []


# ── WHICH COLUMNS HOLD THIS SHEET'S AMOUNT -- the % Margin DENOMINATOR ───────────
#
# The third derivation, and it exists for the same reason as the other two: the BCS export
# writes a % Margin formula into the client's workbook, so the server has to know which
# cells the denominator reads. Until the export there was no server-side consumer, because
# nothing on the server ever computed a BCS number.
#
# ⚠️ THIS IS THE THIRD MIRROR OF A BCS RULE, AND THE LIABILITY IS THE SAME ONE. At BCS-S2b
# the server widened to eight amount shapes while the browser silently refused six of them
# for a whole slice, with every test on both sides green. That is why this is pinned by
# `parity_cases.json` -> `derived_amount_cases`, read by BOTH suites. Do not add a fourth
# copy, and do not change this without changing `bcsColumns.bcsAmountColumns` and the table
# in the SAME edit.
#
# THE TIER ORDER IS THE SPEC, not a preference, and it mirrors the kind-axis ruling the
# confirmations already enforce: a TOTAL ALREADY CONTAINS ITS HALVES, so a sheet mapping
# both must resolve to the total ALONE. Summing them would double-count the row -- exactly
# the harm `decide_amount_source` refuses under `mixed_kinds` when a human picks both. The
# fallback must not be able to express what the confirmation forbids.
#
# A LONE HALF IS ACCEPTED, and that is the standing owner ruling (2026-08-02): one-sided
# packages are genuine commercial shapes, not data gaps, and the safety comes from
# DISCLOSURE rather than from blocking. Tier 3 therefore returns whichever halves exist,
# one or two.
_AMOUNT_SCALAR_TOTAL_VALUE_FIELD = "amount_total"
_AMOUNT_SCALAR_HALF_VALUE_FIELDS = ("amount_supply", "amount_install")


def derive_amount_columns(source: dict | None, descriptors: list | None) -> list:
    """★ WHICH COLUMNS HOLD THIS SHEET'S AMOUNT -- what we charge the client, and the
    denominator of % Margin.

    A stored CONFIRMATION wins wherever one exists, so a sheet configured before BCS-S12
    resolves exactly as it always has. Otherwise the sheet's own amount columns are used, in
    a STRICT tier order:

        1. the confirmed pick;
        2. else the scalar Total Amount column(s);
        3. else the supply / install HALVES (one or both);
        4. else the per-area amount columns.

    ⚠️ THE TIERS ARE EXCLUSIVE AND THE FIRST HIT WINS. A total already contains its halves,
    so a sheet mapping both must never sum them -- see the block comment above.

    Returns entries in the `_entry` shape, so ONE reader resolves either branch without
    asking which one it got. An EMPTY list is a real answer, not an error: this sheet has no
    amount at all, so there is nothing to measure a margin against and the caller writes no
    margin column rather than inventing a denominator.

    Mirrors `bcsColumns.bcsAmountColumns`. Pinned by `parity_cases.json`
    -> `derived_amount_cases`.
    """
    confirmed = (source or {}).get("columns") or []
    if confirmed:
        return list(confirmed)
    ds = descriptors or []
    total = [d for d in ds if d.get("value_field") == _AMOUNT_SCALAR_TOTAL_VALUE_FIELD]
    if total:
        return [_entry(d) for d in total]
    halves = [d for d in ds if d.get("value_field") in _AMOUNT_SCALAR_HALF_VALUE_FIELDS]
    if halves:
        return [_entry(d) for d in halves]
    return [_entry(d) for d in ds if d.get("value_field") == _AMOUNT_AREA_VALUE_FIELD]
