# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Unit tests for the TWO BCS column confirmations -- the pure rules (slices BCS-S1b/S1c).

These test `services/boq_bcs/sources.py` DIRECTLY, at its own seam: the module's whole
interface is `(picked column letters, descriptor index) -> confirmation dict`, so a test
supplies both sides literally and reads the dict back. No BoQ, no committed sheet, no
project fixture, no endpoint.

WHY DIRECTLY, when test_bcs.py already drives these rules through confirm_bcs_columns:
BCS-S1a RELOCATED these decisions out of the endpoint precisely so they would stop being
reachable only through one (ADR-0010 B1). Covering them only end-to-end would leave the
relocation half-done -- the rules would live in a pure module but still be specified by a
test that needs a site, a project and three seeded sheets to say "a rate column is not an
amount column". The endpoint tests remain, and remain right: they pin that a refusal
SURFACES and stores NOTHING. These pin what the refusals ARE.

PURITY: no frappe.db, no fixtures, no request context, no document is created or read.
`frappe` is imported for exactly one thing -- `frappe.ValidationError`, the type
`frappe.throw` raises. That single framework touch is the module's own deliberate design
(see its docstring: a refusal here is user-facing and named, so raising a bare ValueError
would make every caller re-voice it), and it is why these run under the bench runner like
every sibling pure suite:

    bench --site localhost run-tests --module nirmaan_stack.services.boq_bcs.test_sources

`frappe.throw` needs `frappe.local` BOUND (bare `python -m unittest` raises "object is not
bound"); it needs no site DATA. Same shape as services/test_procurement_approval.py and
services/boq_revision/test_column_diff.py, both of which CI runs the same way.

The descriptor fixtures below are not invented -- each is exactly what
review_screen._build_column_descriptors emits for that role, which is what
bcs._descriptor_index feeds the module in production.

Coverage:
  Group 1  the QUANTITY shapes   -- scalar total, and per-area columns that SUM.
  Group 2  the AMOUNT shapes     -- the same two, per the S1a owner ruling.
  Group 3  the stored ENTRY      -- one shape for every source and every mode, incl. the
                                    rate_subkey THREE-hop a per-area amount needs.
  Group 4  the SHARED refusals   -- unknown column, and two picks that resolve to ONE
                                    value: the same letter twice (S1b), or two different
                                    letters carrying the same number (S1c).
  Group 5  the QUANTITY refusals -- empty, wrong class, two scalars, mixed.
  Group 6  the AMOUNT refusals   -- the mirror, plus the TOTAL-with-a-half guard that
                                    exists only on this source (BCS-S2b: it is the MIX
                                    that is refused now, never the half by itself).
  Group 7  the SPLIT amount shapes (BCS-S2b) -- supply + install SUMMED, and each half
                                    alone, scalar and per-area alike, with the `mode`
                                    that discloses which formula is in force.
"""

import unittest

import frappe

from nirmaan_stack.services.boq_bcs.sources import (
    build_amount_source,
    build_qty_source,
)

# The six keys a stored confirmation entry carries -- the full descriptor identity, so a
# later reader resolves the value without re-deriving it from column_role_map.
_ENTRY_KEYS = {"col", "role", "area", "value_field", "value_key", "rate_subkey"}


# ── descriptor fixtures: EXACTLY review_screen._build_column_descriptors' output ──
def _singleton(col, role, value_field):
    """A non-by-area descriptor (the _SINGLETON_ROLE_TO_FIELD branch): ONE hop."""
    return {"col": col, "role": role, "area": None,
            "value_field": value_field, "value_key": None, "rate_subkey": None}


def _qty_area(col, area):
    """A per-area QUANTITY descriptor (the `qty` branch): TWO hops -- qty_by_area[area].
    There is no third key, which is why quantity never needed rate_subkey."""
    return {"col": col, "role": "qty", "area": area,
            "value_field": "qty_by_area", "value_key": area, "rate_subkey": None}


def _amount_area(col, area, kind):
    """A per-area AMOUNT descriptor (the _AMOUNT_ROLE_TO_KIND branch): THREE hops --
    amount_by_area[area][kind]. `kind` is "total" (the combined amount charged to the
    client) / "supply" / "install", carried in the generic third-hop key `rate_subkey`."""
    role = {"total": "amount_total_by_area", "supply": "amount_supply_by_area",
            "install": "amount_install_by_area"}[kind]
    return {"col": col, "role": role, "area": area,
            "value_field": "amount_by_area", "value_key": area, "rate_subkey": kind}


def _index(*descriptors):
    """{col_letter: descriptor} -- the shape bcs._descriptor_index builds."""
    return {d["col"]: d for d in descriptors}


# A SCALAR sheet: one qty_total (D), one combined amount_total (F), and BOTH scalar
# halves (G, H). The halves are present on purpose, and what they are FOR changed at
# BCS-S2b: S1 kept them here to prove a half was REFUSED; they are now here to prove a
# half is ACCEPTED (owner ruling 2026-08-02 -- adapt and disclose, do not refuse). What
# this sheet can no longer show is a sheet with NO scalar total, which is why F's presence
# makes it the fixture for the one refusal that survived: a total picked WITH a half.
SCALAR = _index(
    _singleton("A", "sl_no", "sl_no_value"),
    _singleton("B", "description", "description"),
    _singleton("C", "unit", "unit"),
    _singleton("D", "qty_total", "qty_total"),
    _singleton("E", "rate_combined", "rate_combined"),
    _singleton("F", "amount_total", "amount_total"),
    _singleton("G", "amount_supply", "amount_supply"),
    _singleton("H", "amount_install", "amount_install"),
)

# A PER-AREA sheet: quantity mapped per area (D + E, NO scalar total) and amount mapped
# per area (F + G combined, NO scalar total), plus H -- a per-area SUPPLY half sitting
# BESIDE a combined amount for the same area. That co-existence is what makes this the
# fixture for the surviving per-area refusal: Zone A's combined amount ALREADY contains
# Zone A's supply, so picking F and H together counts Zone A's supply twice.
PER_AREA = _index(
    _singleton("B", "description", "description"),
    _qty_area("D", "Zone A"),
    _qty_area("E", "Zone B"),
    _amount_area("F", "Zone A", "total"),
    _amount_area("G", "Zone B", "total"),
    _amount_area("H", "Zone A", "supply"),
)

# A SPLIT PER-AREA sheet (BCS-S2b): no combined amount ANYWHERE -- every area carries its
# supply and install amounts separately. The row's amount is the sum across BOTH axes at
# once, area AND kind, which is the shape S1a's rules could not express at all: every
# column on this sheet was refused, so the sheet could not enable BCS.
PER_AREA_SPLIT = _index(
    _singleton("B", "description", "description"),
    _qty_area("C", "Zone A"),
    _amount_area("D", "Zone A", "supply"),
    _amount_area("E", "Zone A", "install"),
    _amount_area("F", "Zone B", "supply"),
    _amount_area("G", "Zone B", "install"),
)

# A sheet carrying BOTH a scalar total and its own per-area parts, for each source. Only
# a malformed or mid-migration sheet looks like this, which is exactly why picking across
# the two must be refused rather than quietly summed.
MIXED = _index(
    _singleton("D", "qty_total", "qty_total"),
    _qty_area("E", "Zone A"),
    _singleton("F", "amount_total", "amount_total"),
    _amount_area("G", "Zone A", "total"),
)

# A sheet mapping the same scalar role on two columns -- the "pick one" rule's fixture.
TWO_SCALARS = _index(
    _singleton("D", "qty_total", "qty_total"),
    _singleton("E", "qty_total", "qty_total"),
    _singleton("F", "amount_total", "amount_total"),
    _singleton("G", "amount_total", "amount_total"),
)

# A sheet where two DIFFERENT letters resolve to the SAME underlying value: D and E are
# both Zone A quantity, F and G are both the Zone A combined amount. Nothing forbids this
# shape -- review_screen._build_column_descriptors imposes no uniqueness on (role, area)
# across columns, so a duplicated export column or a mid-migration remap produces it -- and
# summing such a pair counts one number twice, which is the exact harm the duplicate rule
# exists to prevent. This is the fixture for BCS-S1c: S1b de-duplicated the picked LETTER,
# which this shape walks straight past.
ALIASED = _index(
    _singleton("B", "description", "description"),
    _qty_area("D", "Zone A"),
    _qty_area("E", "Zone A"),
    _amount_area("F", "Zone A", "total"),
    _amount_area("G", "Zone A", "total"),
)


# ===========================================================================
# Group 1: the QUANTITY shapes
# ===========================================================================
class TestQuantityShapes(unittest.TestCase):

    def test_a_scalar_total_yields_the_qty_total_mode(self):
        out = build_qty_source(["D"], SCALAR)
        self.assertEqual(out["mode"], "qty_total")
        self.assertEqual([c["col"] for c in out["columns"]], ["D"])
        self.assertEqual(out["columns"][0]["value_field"], "qty_total")
        self.assertEqual(out["columns"][0]["role"], "qty_total")
        self.assertIsNone(out["columns"][0]["area"])

    def test_per_area_columns_yield_the_summed_mode_and_keep_every_pick(self):
        """The second shape: a sheet with NO scalar total, whose Total Quantity is the
        SUM of its per-area columns. Every picked column must survive into the stored
        confirmation -- dropping one would silently under-count the row."""
        out = build_qty_source(["D", "E"], PER_AREA)
        self.assertEqual(out["mode"], "qty_by_area")
        self.assertEqual([c["col"] for c in out["columns"]], ["D", "E"])
        self.assertEqual([c["area"] for c in out["columns"]], ["Zone A", "Zone B"])
        self.assertTrue(all(c["value_field"] == "qty_by_area" for c in out["columns"]))

    def test_a_single_per_area_column_is_still_the_summed_mode(self):
        """A one-area sheet is per-area, not scalar. The mode records WHICH SHAPE the
        sheet expresses, not how many columns happened to be picked."""
        out = build_qty_source(["D"], PER_AREA)
        self.assertEqual(out["mode"], "qty_by_area")
        self.assertEqual(out["columns"][0]["value_key"], "Zone A")


# ===========================================================================
# Group 2: the AMOUNT shapes (the S1a owner ruling -- the same two)
# ===========================================================================
class TestAmountShapes(unittest.TestCase):

    def test_a_scalar_combined_amount_yields_the_amount_total_mode(self):
        out = build_amount_source(["F"], SCALAR)
        self.assertEqual(out["mode"], "amount_total")
        self.assertEqual([c["col"] for c in out["columns"]], ["F"])
        self.assertEqual(out["columns"][0]["value_field"], "amount_total")

    def test_per_area_combined_amounts_yield_the_summed_mode(self):
        out = build_amount_source(["F", "G"], PER_AREA)
        self.assertEqual(out["mode"], "amount_by_area")
        self.assertEqual([c["col"] for c in out["columns"]], ["F", "G"])
        self.assertEqual([c["area"] for c in out["columns"]], ["Zone A", "Zone B"])
        self.assertTrue(all(c["value_field"] == "amount_by_area" for c in out["columns"]))

    def test_the_two_sources_read_as_one_idea(self):
        """S1a's whole point: quantity and amount take the SAME two shapes. If these two
        modes ever stop being parallel, the confirmation has grown a special case."""
        qty = build_qty_source(["D", "E"], PER_AREA)
        amt = build_amount_source(["F", "G"], PER_AREA)
        self.assertEqual(qty["mode"], "qty_by_area")
        self.assertEqual(amt["mode"], "amount_by_area")
        self.assertEqual(len(qty["columns"]), len(amt["columns"]))
        self.assertEqual(set(qty["columns"][0]), set(amt["columns"][0]))


# ===========================================================================
# Group 3: the stored ENTRY -- one shape everywhere, and the three-hop resolve
# ===========================================================================
class TestStoredEntryShape(unittest.TestCase):

    def test_every_entry_carries_exactly_the_six_identity_keys(self):
        """ONE entry shape rather than a per-source special case -- the two-hop shapes
        carry rate_subkey None rather than omitting the key."""
        for out in (build_qty_source(["D"], SCALAR),
                    build_qty_source(["D", "E"], PER_AREA),
                    build_amount_source(["F"], SCALAR),
                    build_amount_source(["F", "G"], PER_AREA)):
            for entry in out["columns"]:
                self.assertEqual(set(entry), _ENTRY_KEYS)

    def test_a_per_area_amount_entry_carries_the_third_hop(self):
        """THE SUBTLE ONE. A per-area amount resolves in THREE hops --
        amount_by_area[area][kind] -- so the entry must carry the kind as well as the
        area. Without it a later reader cannot resolve the number at all, which is the
        whole reason the confirmation is stored rather than re-derived from the role map.
        This is what S1a added, and it is invisible on every other shape."""
        out = build_amount_source(["F", "G"], PER_AREA)
        for entry in out["columns"]:
            self.assertEqual(entry["value_field"], "amount_by_area")
            self.assertEqual(entry["value_key"], entry["area"])   # hop 2
            self.assertEqual(entry["rate_subkey"], "total")       # hop 3

    def test_the_two_hop_shapes_carry_no_third_hop(self):
        """Per-area QUANTITY is two hops (qty_by_area[area]) and both scalars are one, so
        rate_subkey is None on all three. A non-None here would mean the resolve walked a
        key that does not exist."""
        qty_area = build_qty_source(["D", "E"], PER_AREA)["columns"]
        qty_scalar = build_qty_source(["D"], SCALAR)["columns"]
        amt_scalar = build_amount_source(["F"], SCALAR)["columns"]
        for entry in qty_area + qty_scalar + amt_scalar:
            self.assertIsNone(entry["rate_subkey"])
        self.assertEqual([e["value_key"] for e in qty_area], ["Zone A", "Zone B"])
        self.assertIsNone(qty_scalar[0]["value_key"])
        self.assertIsNone(amt_scalar[0]["value_key"])


# ===========================================================================
# Group 4: the SHARED refusals -- both sources go through _resolve_picks
# ===========================================================================
class TestSharedRefusals(unittest.TestCase):

    def test_an_unmapped_column_is_refused_by_either_source(self):
        for build, other in ((build_qty_source, "quantity"), (build_amount_source, "amount")):
            with self.assertRaises(frappe.ValidationError, msg=other):
                build(["Z"], SCALAR)

    def test_the_unknown_column_refusal_names_the_column(self):
        """The message is the user's only clue about which pick was wrong.

        ANCHORED on purpose (BCS-S1c): a bare "Z" is one unanchored character, and would
        match vacuously the moment this test is repointed at a fixture whose text happens
        to contain one -- PER_AREA's "Zone A" is exactly that. An assertion that cannot
        fail is not an assertion."""
        with self.assertRaisesRegex(frappe.ValidationError,
                                    r"^Column 'Z' is not a mapped column"):
            build_qty_source(["D", "Z"], SCALAR)

    # -- the SIXTH refusal (BCS-S1b, correctly keyed at BCS-S1c) -----------
    def test_a_repeated_per_area_quantity_column_is_refused(self):
        """The letter route. Two identical entries would be summed, and the row would
        count that column's quantity twice.

        Pinned to the SPECIFIC message (BCS-S1c) rather than to "some refusal fired": the
        duplicate family is this slice's own, so which of the two voicings answered has to
        be unambiguous -- a bare assertRaises here would still pass if the pick were
        refused by an unrelated rule for an unrelated reason."""
        with self.assertRaisesRegex(frappe.ValidationError, "more than once"):
            build_qty_source(["D", "D"], PER_AREA)

    def test_a_repeated_per_area_amount_column_is_refused(self):
        with self.assertRaisesRegex(frappe.ValidationError, "more than once"):
            build_amount_source(["F", "F"], PER_AREA)

    def test_a_repeated_scalar_column_is_refused_on_purpose_now(self):
        """A repeated SCALAR pick was already refused before this slice -- but only by
        accident, as a side effect of the one-scalar-column rule. It is now refused for
        the reason that is actually true of it."""
        for build, cols, index in ((build_qty_source, ["D", "D"], SCALAR),
                                   (build_amount_source, ["F", "F"], SCALAR)):
            with self.assertRaisesRegex(frappe.ValidationError, "more than once"):
                build(cols, index)

    def test_a_repeat_is_reported_once_however_many_times_it_appears(self):
        with self.assertRaisesRegex(frappe.ValidationError, r"^Column\(s\) D are picked"):
            build_qty_source(["D", "D", "D"], PER_AREA)

    def test_an_unknown_column_beats_a_duplicate(self):
        """ORDERING, deliberate: a column the sheet does not have is reported as UNKNOWN
        -- the more fundamental fact about it -- rather than as a duplicate.

        That narrow claim is the whole of what the ordering buys, and this test is what
        pins it. BCS-S1b's docstring here claimed something wider and false -- that "every
        input that threw before throws identically" -- when in fact the duplicate refusal
        precedes every per-source rule and SHADOWS six titles (see the note in
        sources._resolve_picks, which enumerates them). Nothing breaks, because no test
        anywhere asserts on a shadowed title; the defect was the sentence."""
        with self.assertRaisesRegex(frappe.ValidationError, "not a mapped column"):
            build_qty_source(["Z", "Z"], SCALAR)

    # -- the same refusal, correctly KEYED (BCS-S1c) ------------------------
    def test_two_different_columns_resolving_to_one_quantity_are_refused(self):
        """THE GAP THIS SLICE CLOSES. S1b de-duplicated the picked LETTER, so two
        DIFFERENT letters that resolve to the SAME (value_field, value_key, rate_subkey)
        were still accepted -- and summing them double-counts the row, which is precisely
        what the duplicate rule exists to prevent. The letter case is not a separate rule;
        it is the degenerate case of this one (the same letter necessarily resolves
        identically), which is why widening the key costs the letter tests nothing."""
        with self.assertRaisesRegex(frappe.ValidationError, "same value"):
            build_qty_source(["D", "E"], ALIASED)

    def test_two_different_columns_resolving_to_one_amount_are_refused(self):
        """The mirror on the other source -- and the reason the rule stays in the shared
        _resolve_picks rather than being written twice."""
        with self.assertRaisesRegex(frappe.ValidationError, "same value"):
            build_amount_source(["F", "G"], ALIASED)

    def test_the_resolved_duplicate_refusal_names_the_offending_columns(self):
        """The user picked two columns that LOOK different; the message has to say which
        pair collapsed, or the refusal is unactionable."""
        with self.assertRaisesRegex(frappe.ValidationError, r"^Column\(s\) D, E resolve"):
            build_qty_source(["D", "E"], ALIASED)

    def test_columns_resolving_to_DIFFERENT_values_stay_accepted(self):
        """The negative control that keeps the widened key honest: per-area columns are
        the shape BCS is FOR, and two areas are two numbers that must still SUM. If this
        ever fails, the key has widened past the value identity into the value CLASS."""
        out = build_qty_source(["D", "E"], PER_AREA)      # Zone A + Zone B
        self.assertEqual([c["col"] for c in out["columns"]], ["D", "E"])
        amt = build_amount_source(["F", "G"], PER_AREA)   # Zone A + Zone B
        self.assertEqual([c["col"] for c in amt["columns"]], ["F", "G"])


# ===========================================================================
# Group 5: the QUANTITY refusals
# ===========================================================================
class TestQuantityRefusals(unittest.TestCase):

    def test_an_empty_selection_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            build_qty_source([], SCALAR)

    def test_a_mapped_column_of_the_wrong_class_is_refused(self):
        """Existing is not enough -- C is a real mapped column, but it is the Unit."""
        for col in ("B", "C", "E"):   # description, unit, rate
            with self.assertRaises(frappe.ValidationError, msg=col):
                build_qty_source([col], SCALAR)

    def test_an_amount_column_is_not_a_quantity_column(self):
        """The two confirmations are separate questions; a valid answer to one is not a
        valid answer to the other."""
        with self.assertRaises(frappe.ValidationError):
            build_qty_source(["F"], SCALAR)

    def test_two_scalar_totals_are_refused(self):
        with self.assertRaises(frappe.ValidationError):
            build_qty_source(["D", "E"], TWO_SCALARS)

    def test_a_scalar_total_mixed_with_its_own_per_area_parts_is_refused(self):
        """Summing a total together with the parts it is already the total OF counts
        every quantity twice."""
        with self.assertRaises(frappe.ValidationError):
            build_qty_source(["D", "E"], MIXED)


# ===========================================================================
# Group 6: the AMOUNT refusals -- the mirror, plus the HALF guard
# ===========================================================================
class TestAmountRefusals(unittest.TestCase):

    def test_an_empty_selection_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            build_amount_source([], SCALAR)

    def test_a_rate_column_is_refused(self):
        """A rate is not an amount; BCS's denominator is what we CHARGE, not the unit
        price it was derived from."""
        with self.assertRaises(frappe.ValidationError):
            build_amount_source(["E"], SCALAR)

    def test_a_quantity_column_is_not_an_amount_column(self):
        with self.assertRaises(frappe.ValidationError):
            build_amount_source(["D"], SCALAR)

    # -- the HALF family, REVERSED at BCS-S2b -------------------------------
    # These three pinned "a half is not the amount, refuse it". The owner reversed that on
    # 2026-08-02: a one-sided package is a genuine commercial shape, not a data gap, so the
    # software ADAPTS and DISCLOSES the formula it is using instead of refusing. What did
    # NOT change is the double-count they were really protecting: a TOTAL already contains
    # its halves. So the rule moved off the half itself and onto the MIX, and each test
    # below now pins that narrower, true thing.

    def test_a_scalar_total_picked_together_with_a_half_is_refused(self):
        """WAS: "a scalar supply or install half is refused" (BCS-S1).

        F is the combined amount and ALREADY CONTAINS G and H, so adding either to it
        counts that half twice -- the same harm the mixed total-and-parts refusals name,
        arriving by the kind axis rather than the shape axis. Both halves are checked
        because the rule is about the TOTAL's presence, not about which half joined it."""
        for half in ("G", "H"):   # amount_supply, amount_install
            with self.assertRaises(frappe.ValidationError, msg=half):
                build_amount_source(["F", half], SCALAR)

    def test_a_per_area_total_picked_together_with_a_per_area_half_is_refused(self):
        """WAS: "a per-area half is refused by its third hop" (BCS-S1).

        The per-area twin, and still the ONLY place rate_subkey decides a REFUSAL rather
        than a resolve -- but it now decides it by COMPARING kinds across the picked set
        instead of testing one column against the constant "total". F is Zone A's combined
        amount and H is Zone A's supply half, so the pair counts Zone A's supply twice."""
        with self.assertRaises(frappe.ValidationError):
            build_amount_source(["F", "H"], PER_AREA)

    def test_a_half_poisons_an_otherwise_valid_per_area_COMBINED_selection(self):
        """WAS: "a half poisons an otherwise valid per-area selection" (BCS-S1) -- and
        this one still REFUSES the same input, for a different reason.

        F and G are the two areas' combined amounts; H is Zone A's supply half. The pick
        must be refused WHOLE rather than quietly dropping H -- but the reason is no
        longer "H is a half", it is "H is already inside F". The distinction is what makes
        ["D", "E"] on PER_AREA_SPLIT (two areas' supply, no total anywhere) acceptable
        while this stays refused."""
        with self.assertRaises(frappe.ValidationError):
            build_amount_source(["F", "G", "H"], PER_AREA)

    def test_two_scalar_combined_amounts_are_refused(self):
        with self.assertRaises(frappe.ValidationError):
            build_amount_source(["F", "G"], TWO_SCALARS)

    def test_a_scalar_amount_mixed_with_its_own_per_area_parts_is_refused(self):
        with self.assertRaises(frappe.ValidationError):
            build_amount_source(["F", "G"], MIXED)


# ===========================================================================
# Group 7: the SPLIT amount shapes (BCS-S2b) -- the owner's 2026-08-02 reversal
# ===========================================================================
class TestSplitAmountShapes(unittest.TestCase):
    """OWNER RULING 2026-08-02, and it reverses a decision this suite used to pin.

    Real sheets turned out not to have a single "Amount (Total)" column: most carry
    Amount (Supply) and Amount (Installation) separately, and S1a refused BOTH -- so the
    confirmation card's Amount list came up EMPTY on most real sheets and the feature was
    unusable. Where there is no scalar total the denominator is now Supply + Installation
    SUMMED; and where a sheet carries only ONE half, that half is ACCEPTED rather than
    refused, because a one-sided package is a real commercial shape and not a data gap.
    The safety comes from DISCLOSURE -- the stored `mode` says which formula is in force
    -- not from blocking.

    The mode strings are pinned as LITERALS here on purpose. They are a persisted contract
    that S2c must state in words and S3 must compute against, and S2c reads them from
    TypeScript where a Python constant is unreachable -- so the test has to name the same
    strings a reader of the stored record sees, not re-derive them from the module."""

    # -- scalar: the two halves, SUMMED ------------------------------------
    def test_scalar_supply_plus_install_are_summed(self):
        out = build_amount_source(["G", "H"], SCALAR)
        self.assertEqual(out["mode"], "amount_supply_plus_install")
        self.assertEqual([c["col"] for c in out["columns"]], ["G", "H"])
        self.assertEqual([c["value_field"] for c in out["columns"]],
                         ["amount_supply", "amount_install"])

    def test_the_order_the_halves_were_picked_in_does_not_change_the_mode(self):
        """Addition commutes, so the FORMULA is the same either way; only the stored
        column order follows the pick. A mode that flipped on pick order would be
        disclosing something that is not true of the arithmetic."""
        out = build_amount_source(["H", "G"], SCALAR)
        self.assertEqual(out["mode"], "amount_supply_plus_install")
        self.assertEqual([c["col"] for c in out["columns"]], ["H", "G"])

    # -- scalar: ONE half alone (adapt and disclose) ------------------------
    def test_a_lone_scalar_supply_half_is_accepted_and_says_so(self):
        """THE REVERSAL. This exact input was refused before this slice. It is accepted
        now, and the mode carries the word that makes the one-sidedness impossible to miss
        downstream -- that disclosure IS the safety the refusal used to provide."""
        out = build_amount_source(["G"], SCALAR)
        self.assertEqual(out["mode"], "amount_supply_only")
        self.assertEqual([c["col"] for c in out["columns"]], ["G"])
        self.assertEqual(out["columns"][0]["value_field"], "amount_supply")

    def test_a_lone_scalar_install_half_is_accepted_and_says_so(self):
        out = build_amount_source(["H"], SCALAR)
        self.assertEqual(out["mode"], "amount_install_only")
        self.assertEqual(out["columns"][0]["value_field"], "amount_install")

    # -- per-area: summing across BOTH axes at once ------------------------
    def test_per_area_halves_sum_across_both_the_area_and_the_kind_axis(self):
        """The shape S1a could not express AT ALL: every column on this sheet was refused,
        so a split per-area sheet could not enable BCS. Four columns, two areas x two
        kinds, and the row's amount is the sum of all four."""
        out = build_amount_source(["D", "E", "F", "G"], PER_AREA_SPLIT)
        self.assertEqual(out["mode"], "amount_by_area_supply_plus_install")
        self.assertEqual([c["col"] for c in out["columns"]], ["D", "E", "F", "G"])
        self.assertEqual([c["area"] for c in out["columns"]],
                         ["Zone A", "Zone A", "Zone B", "Zone B"])
        self.assertEqual([c["rate_subkey"] for c in out["columns"]],
                         ["supply", "install", "supply", "install"])

    def test_per_area_halves_of_one_kind_are_the_one_sided_per_area_mode(self):
        """Two areas, supply only -- one-sided on the KIND axis while still summing on
        the AREA axis. The mode has to say both things at once."""
        out = build_amount_source(["D", "F"], PER_AREA_SPLIT)
        self.assertEqual(out["mode"], "amount_by_area_supply_only")
        self.assertEqual([c["area"] for c in out["columns"]], ["Zone A", "Zone B"])

    def test_a_lone_per_area_install_half_is_accepted(self):
        out = build_amount_source(["E"], PER_AREA_SPLIT)
        self.assertEqual(out["mode"], "amount_by_area_install_only")
        self.assertEqual(out["columns"][0]["rate_subkey"], "install")

    # -- the mode's WHOLE JOB: distinguishing the formulas ------------------
    def test_every_accepted_amount_shape_gets_its_own_mode(self):
        """The mode's whole job. S2c has to state the formula in plain words and S3 has to
        compute it, so two shapes sharing one mode would make one of them undisclosable --
        a reader of the stored record could not tell which formula was in force. Eight
        accepted shapes, eight distinct modes."""
        modes = [
            build_amount_source(["F"], SCALAR)["mode"],
            build_amount_source(["G", "H"], SCALAR)["mode"],
            build_amount_source(["G"], SCALAR)["mode"],
            build_amount_source(["H"], SCALAR)["mode"],
            build_amount_source(["F", "G"], PER_AREA)["mode"],
            build_amount_source(["D", "E", "F", "G"], PER_AREA_SPLIT)["mode"],
            build_amount_source(["D", "F"], PER_AREA_SPLIT)["mode"],
            build_amount_source(["E", "G"], PER_AREA_SPLIT)["mode"],
        ]
        self.assertEqual(len(set(modes)), len(modes), f"modes collided: {modes}")

    def test_the_two_pre_existing_modes_are_byte_unchanged(self):
        """The widening must cost the shapes that already worked NOTHING -- including the
        exact stored string, because confirmations persisted before this slice are read
        back by the same reader."""
        self.assertEqual(build_amount_source(["F"], SCALAR)["mode"], "amount_total")
        self.assertEqual(build_amount_source(["F", "G"], PER_AREA)["mode"],
                         "amount_by_area")

    def test_the_arithmetic_is_sum_every_entry_in_every_mode(self):
        """The property that keeps S3 simple and keeps this module HONEST: whatever the
        mode, the computation is "resolve each stored entry and add them up". No mode
        needs a different arithmetic, and no picked column is ever dropped -- so the mode
        is for DISCLOSURE and REFUSAL, never for branching the sum. If a future shape ever
        needs a subtraction or a coefficient, THAT is when this stops being true, and this
        test is where it will be noticed."""
        for cols, index in ((["F"], SCALAR),
                            (["G", "H"], SCALAR),
                            (["G"], SCALAR),
                            (["F", "G"], PER_AREA),
                            (["D", "E", "F", "G"], PER_AREA_SPLIT),
                            (["D", "F"], PER_AREA_SPLIT)):
            out = build_amount_source(cols, index)
            self.assertEqual([c["col"] for c in out["columns"]], cols,
                             f"every pick must survive to be summed: {cols}")

    def test_every_split_entry_still_carries_exactly_the_six_identity_keys(self):
        """The stored ENTRY shape does not fork per mode -- Group 3's rule, re-checked on
        the shapes this slice added, since a new shape is exactly where a special case
        would creep in."""
        for out in (build_amount_source(["G", "H"], SCALAR),
                    build_amount_source(["D", "E", "F", "G"], PER_AREA_SPLIT)):
            for entry in out["columns"]:
                self.assertEqual(set(entry), _ENTRY_KEYS)

    def test_a_scalar_half_carries_no_third_hop_but_a_per_area_half_does(self):
        """A scalar half is a ONE-hop resolve and a per-area half is THREE, exactly as the
        combined shapes already are. The half-ness lives in the value_field for one and in
        rate_subkey for the other, and the entry records whichever applies."""
        scalar_half = build_amount_source(["G"], SCALAR)["columns"][0]
        self.assertIsNone(scalar_half["value_key"])
        self.assertIsNone(scalar_half["rate_subkey"])
        area_half = build_amount_source(["D"], PER_AREA_SPLIT)["columns"][0]
        self.assertEqual(area_half["value_key"], "Zone A")
        self.assertEqual(area_half["rate_subkey"], "supply")

    # -- what the widening must NOT reopen ---------------------------------
    def test_two_letters_holding_one_half_are_still_refused(self):
        """The BCS-S1c duplicate-by-RESOLVED-VALUE rule must survive the widening: the new
        shapes add more columns that can alias, not fewer. Picking Zone A supply twice
        under two letters would double-count it just as before."""
        aliased_split = _index(
            _amount_area("D", "Zone A", "supply"),
            _amount_area("E", "Zone A", "supply"),
        )
        with self.assertRaisesRegex(frappe.ValidationError, "same value"):
            build_amount_source(["D", "E"], aliased_split)

    def test_a_non_amount_column_is_still_refused_among_halves(self):
        """Widening the KIND axis must not widen the CLASS check: a rate column is still
        not an amount, however the rest of the pick is shaped."""
        with self.assertRaises(frappe.ValidationError):
            build_amount_source(["G", "H", "E"], SCALAR)   # E is rate_combined

    def test_scalar_and_per_area_amounts_still_cannot_be_mixed(self):
        """The SHAPE axis is untouched by this slice. A scalar amount is the total of the
        per-area ones, so crossing the axes risks the same double-count -- and no owner
        ruling covers a sheet that genuinely splits one kind scalar and the other per
        area, so it stays refused rather than guessed at."""
        cross = _index(
            _singleton("D", "amount_supply", "amount_supply"),
            _amount_area("E", "Zone A", "install"),
        )
        with self.assertRaises(frappe.ValidationError):
            build_amount_source(["D", "E"], cross)


if __name__ == "__main__":
    unittest.main()
