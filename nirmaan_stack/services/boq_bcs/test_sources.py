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

import json
import os
import unittest

import frappe

from nirmaan_stack.services.boq_bcs.sources import (
    AMOUNT_REFUSAL_ORDER,
    QTY_REFUSAL_ORDER,
    REFUSAL_CODES,
    _PER_AREA_RATE_SUBKEY_TO_BCS_KIND,
    build_amount_source,
    build_qty_source,
    decide_amount_source,
    decide_qty_source,
    derive_qty_columns,
    live_rate_kinds,
)

# The SHARED rule-parity table (BCS-S2e), read from disk rather than imported, so the ONE
# artifact both languages consume has no build step and no duplicate. `bcsColumns.test.ts`
# reaches the same file by a plain BUNDLER IMPORT of this path (`resolveJsonModule`); see its
# Group "rule parity" and the file's own `_readme` for why it lives beside the authority
# rather than beside the mirror.
#
# CORRECTED AT BCS-S2e-fix: this comment used to say the vitest suite read the file off
# `import.meta.url`. That was the ABANDONED first draft, not what ships -- and the same false
# sentence sat in the JSON's `_readme` too, so the one artifact both languages share described
# its own consumer wrongly in both places at once.
_PARITY_CASES_PATH = os.path.join(os.path.dirname(__file__), "parity_cases.json")


def _load_parity_cases() -> dict:
    with open(_PARITY_CASES_PATH, encoding="utf-8") as fh:
        return json.load(fh)

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
    #
    # THEY PIN IT BY MESSAGE, CORRECTED AT BCS-S2c. Until then all three asserted the
    # exception TYPE alone, in a class where ten other refusals are message-pinned -- and
    # since every refusal in this module raises the one ValidationError, a type-only assert
    # says "something was refused", not "THIS was refused".
    #
    # BE PRECISE ABOUT WHAT THAT BUYS, because it is easy to overclaim and BCS-S2c measured
    # both halves rather than reasoning about them:
    #
    #   * It does NOT catch the pre-S2b rule coming back (`if kinds - {_KIND_TOTAL}` --
    #     refuse ANY half). Every input below carries a total AND a half, so the old rule
    #     and the new one refuse all three in the same words; the pin cannot see a
    #     difference that is not there. What catches THAT regression is the acceptance
    #     side -- TestSplitAmountShapes goes 11 red, which is the honest guard for it.
    #   * It DOES catch this refusal firing with the WRONG WORDS -- its message drifting
    #     onto a neighbour's, or the input being caught by a different rule that also
    #     throws. Verified: give the kind refusal the shape refusal's sentence and all
    #     three go red, where the type-only version stayed green.
    #
    # That second case is a live risk, not a hypothetical: BCS-S2c reworded the SHAPE
    # refusal sitting immediately below the kind one, so the two messages are now adjacent,
    # similar in purpose and easy to edit into each other.
    #
    # The marker is the kind refusal's own words, unique to it: the shape refusal says "of
    # ONE shape", and neither the duplicate nor the class refusal mentions halves at all.
    _KIND_REFUSAL = "already includes the supply and installation"

    def test_a_scalar_total_picked_together_with_a_half_is_refused(self):
        """WAS: "a scalar supply or install half is refused" (BCS-S1).

        F is the combined amount and ALREADY CONTAINS G and H, so adding either to it
        counts that half twice -- the same harm the mixed total-and-parts refusals name,
        arriving by the kind axis rather than the shape axis. Both halves are checked
        because the rule is about the TOTAL's presence, not about which half joined it."""
        for half in ("G", "H"):   # amount_supply, amount_install
            with self.assertRaisesRegex(frappe.ValidationError, self._KIND_REFUSAL,
                                        msg=half):
                build_amount_source(["F", half], SCALAR)

    def test_a_per_area_total_picked_together_with_a_per_area_half_is_refused(self):
        """WAS: "a per-area half is refused by its third hop" (BCS-S1).

        The per-area twin, and still the ONLY place rate_subkey decides a REFUSAL rather
        than a resolve -- but it now decides it by COMPARING kinds across the picked set
        instead of testing one column against the constant "total". F is Zone A's combined
        amount and H is Zone A's supply half, so the pair counts Zone A's supply twice."""
        with self.assertRaisesRegex(frappe.ValidationError, self._KIND_REFUSAL):
            build_amount_source(["F", "H"], PER_AREA)

    def test_a_half_poisons_an_otherwise_valid_per_area_COMBINED_selection(self):
        """WAS: "a half poisons an otherwise valid per-area selection" (BCS-S1) -- and
        this one still REFUSES the same input, for a different reason.

        F and G are the two areas' combined amounts; H is Zone A's supply half. The pick
        must be refused WHOLE rather than quietly dropping H -- but the reason is no
        longer "H is a half", it is "H is already inside F". The distinction is what makes
        ["D", "E"] on PER_AREA_SPLIT (two areas' supply, no total anywhere) acceptable
        while this stays refused. Message-pinned for the same reason as its two
        neighbours: "refused" and "refused FOR THE STATED REASON" are different claims,
        and only the second one survives a rule moving."""
        with self.assertRaisesRegex(frappe.ValidationError, self._KIND_REFUSAL):
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


# ===========================================================================
# Group 8: THE RULE PARITY TABLE (BCS-S2e) -- this side of it
# ===========================================================================
class TestRuleParityTable(unittest.TestCase):
    """★ THE PARITY NET. One case table, `parity_cases.json`, consumed by THIS suite and by
    `frontend/src/pages/boq-wizard/bcsColumns.test.ts`. If the two rule chains disagree about
    any case, exactly one of the two suites goes red -- which is the whole point.

    WHY IT DID NOT EXIST BEFORE, AND WHAT HAD TO CHANGE. The two sides shared no refusal
    IDENTIFIER: this module threw a (title, message) pair, the card returned {ok:false,
    message}. Only the success `mode` was comparable, so a pin built on what was available
    would have covered the ten modes and NONE of the refusal chain whose ORDER is load-bearing
    -- the partial test that makes a gap look closed, which is worse than no test. BCS-S2e
    split the DECISION from its VOICING (`decide_qty_source` / `decide_amount_source` return a
    refusal as a VALUE carrying a short code; `build_*_source` are thin throwing wrappers over
    them, with every thrown message byte-unchanged). The code is what parity compares.

    WHAT IT IS NOT. It does not pin the WORDING -- the two sides refuse in deliberately
    different voices, and forcing one voice on both would trade a real property for a fake one.
    It pins the CONDITIONS and their PRECEDENCE, which is what a user actually experiences.

    ANTI-VACUITY IS EXPLICIT HERE, because a precedence table is the easiest thing in the world
    to write green: a `beats` case whose losing rule never fires anywhere proves nothing at all.
    `test_every_beats_case_names_a_rule_that_is_actually_live` closes that, and
    `test_the_shared_table_is_not_trivially_satisfiable` closes the other end.
    """

    _PARITY = _load_parity_cases()
    _INDEX = {d["col"]: d for d in _PARITY["descriptors"]}
    _DECIDE = {"qty": decide_qty_source, "amount": decide_amount_source}
    _ORDER = {"qty": QTY_REFUSAL_ORDER, "amount": AMOUNT_REFUSAL_ORDER}

    # -- the cases themselves ---------------------------------------------
    def test_every_case_in_the_shared_table(self):
        """The table, case by case. The TS suite runs this exact list against the browser's
        rules; a divergence in either direction turns one of the two red."""
        for case in self._PARITY["cases"]:
            with self.subTest(case=case["id"]):
                out = self._DECIDE[case["side"]](case["cols"], self._INDEX)
                expect = case["expect"]
                self.assertEqual(out["ok"], expect["ok"], case["why"])
                if expect["ok"]:
                    self.assertEqual(out["source"]["mode"], expect["mode"], case["why"])
                else:
                    self.assertEqual(out["code"], expect["code"], case["why"])

    def test_an_accepted_case_stores_exactly_the_columns_that_were_picked(self):
        """Parity on the MODE alone would let one side silently drop a column and still agree
        about which formula is in force -- and a dropped column under-counts the row forever.
        Every mode's arithmetic is "resolve each stored entry and add them up", so the picked
        list surviving intact IS the arithmetic."""
        for case in self._PARITY["cases"]:
            if not case["expect"]["ok"]:
                continue
            with self.subTest(case=case["id"]):
                out = self._DECIDE[case["side"]](case["cols"], self._INDEX)
                self.assertEqual([c["col"] for c in out["source"]["columns"]], case["cols"])

    # -- the ORDER, which is the half a naive pin would have missed --------
    def test_the_tables_order_is_this_modules_own_declared_order(self):
        """The table's `order` is not decoration: both suites assert it against their OWN
        module's declared chain, so a rule added to one side alone goes red on that side."""
        for side in ("qty", "amount"):
            self.assertEqual(list(self._PARITY["order"][side]), list(self._ORDER[side]), side)

    def test_the_declared_order_matches_the_code_this_module_can_actually_emit(self):
        """The declared order is a CLAIM about the chain below it, and a claim can go stale.
        Every code the module names must be in the shared vocabulary, and every code in the
        vocabulary must appear in at least one side's chain -- so a code cannot be minted,
        used, and left out of the contract both suites read."""
        vocabulary = set(self._PARITY["codes"])
        chained = set(self._ORDER["qty"]) | set(self._ORDER["amount"])
        self.assertEqual(chained, vocabulary)
        self.assertEqual(set(REFUSAL_CODES), vocabulary)

    def test_every_code_is_exercised_or_explicitly_declared_unreachable(self):
        """No code may sit in the chain unexercised and unexplained. `too_many_scalars` is
        RETAINED-but-shadowed on both sides (see `unreachable` in the table), and the input
        that shadows it is itself a case -- so the shadow is pinned rather than assumed."""
        answered = {c["expect"]["code"] for c in self._PARITY["cases"]
                    if not c["expect"]["ok"]}
        unreachable = self._PARITY["unreachable"]
        for side in ("qty", "amount"):
            for code in self._ORDER[side]:
                with self.subTest(side=side, code=code):
                    self.assertTrue(
                        code in answered or code in unreachable,
                        f"{code} is in the {side} chain but no case answers it and it is not "
                        f"declared unreachable",
                    )
        for code, note in unreachable.items():
            self.assertNotIn(code, answered, f"{code} is declared unreachable but a case answers it")
            for case_id in note["shadowed_by"]:
                case = next(c for c in self._PARITY["cases"] if c["id"] == case_id)
                self.assertEqual(case.get("beats"), code)

    def test_every_beats_case_names_a_rule_that_is_actually_live(self):
        """★ THE ANTI-VACUITY GUARD. A precedence case claims "this input violates BOTH rules
        and the EARLIER one answers". Two things have to hold or the claim is empty: the
        winner must really come earlier in the declared chain, and the loser must really be a
        rule that answers somewhere (or be the declared-unreachable one). Without this a
        `beats` case naming a rule that never fires anywhere would pass forever while pinning
        nothing."""
        answered = {c["expect"]["code"] for c in self._PARITY["cases"]
                    if not c["expect"]["ok"]}
        for case in self._PARITY["cases"]:
            beaten = case.get("beats")
            if not beaten:
                continue
            with self.subTest(case=case["id"]):
                order = list(self._ORDER[case["side"]])
                winner = case["expect"]["code"]
                self.assertIn(winner, order)
                self.assertIn(beaten, order)
                self.assertLess(order.index(winner), order.index(beaten),
                                "a precedence case must name a LATER rule as the loser")
                self.assertTrue(
                    beaten in answered or beaten in self._PARITY["unreachable"],
                    f"{beaten} never answers any case, so beating it proves nothing",
                )

    def test_every_constructible_adjacency_in_the_chain_has_a_precedence_case(self):
        """★ THE COVERAGE FLOOR (BCS-S2e-fix), and it REPLACES a count.

        Until this slice both suites asked only for `>= 8` `beats` cases while the table carried
        11 -- three cases of slack in the guard whose entire job is to stop a precedence claim
        going unpinned. It is not a hypothetical: deleting `amount-precedence-kind-beats-shape`,
        the case the table itself labels THE LOAD-BEARING ONE, left BOTH suites green. A count
        cannot see WHICH case vanished, which is the only thing worth knowing here.

        So the floor is now per-ADJACENCY: walk each side's declared chain pairwise and require
        every neighbouring pair to be settled -- by a real `beats` case, or by an entry in
        `unconstructible_adjacencies` saying why no input can violate both at once. Two
        properties follow that the count never had. A NAMED case cannot be dropped in silence,
        because dropping it strands its pair. And adding a case needs no edit here at all, so
        the guard cannot drift behind the table the way the number did.

        NOT BOTH, deliberately: an exemption is a claim that a pair is unbuildable, so a table
        that also BUILDS it has one of the two wrong, and silently preferring either would be
        this guard making the same mistake it was written to catch.

        NOTE what this does NOT cover, so the claim stays honest: a NON-adjacent `beats` pair --
        today only the `aliased_columns` > `too_many_scalars` shadow on each side. Those two are
        pinned BY NAME through `unreachable.shadowed_by` instead, in the test above this one, so
        all 11 of the table's precedence cases are load-bearing somewhere.
        """
        exemptions = self._PARITY["unconstructible_adjacencies"]
        for side in ("qty", "amount"):
            order = list(self._ORDER[side])
            covered = {(c["expect"]["code"], c["beats"]) for c in self._PARITY["cases"]
                       if c["side"] == side and c.get("beats") and not c["expect"]["ok"]}
            exempt = {(e["earlier"], e["later"]) for e in exemptions if e["side"] == side}
            for earlier, later in zip(order, order[1:]):
                with self.subTest(side=side, pair=f"{earlier}>{later}"):
                    self.assertFalse(
                        (earlier, later) in covered and (earlier, later) in exempt,
                        f"{side} {earlier} > {later} is declared unconstructible AND a case "
                        f"constructs it -- one of the two is wrong",
                    )
                    self.assertTrue(
                        (earlier, later) in covered or (earlier, later) in exempt,
                        f"{side}: no case pins that {earlier} beats its neighbour {later}, and "
                        f"the pair is not declared unconstructible. Add a `beats` case, or say "
                        f"in `unconstructible_adjacencies` why no input can violate both.",
                    )

    def test_every_declared_unconstructible_adjacency_is_a_real_neighbouring_pair(self):
        """The exemption list is the one way to satisfy the floor without a case, so it has to
        be unable to grow into a blanket. Every entry must name a pair that really IS adjacent in
        that side's chain -- so a reorder that strands an exemption goes red rather than quietly
        widening it -- and must carry a reason a reader can weigh."""
        for e in self._PARITY["unconstructible_adjacencies"]:
            with self.subTest(side=e["side"], pair=f"{e['earlier']}>{e['later']}"):
                order = list(self._ORDER[e["side"]])
                self.assertIn(e["earlier"], order)
                self.assertIn(e["later"], order)
                self.assertEqual(order.index(e["later"]), order.index(e["earlier"]) + 1,
                                 "an exemption may only excuse ADJACENT rules")
                self.assertGreater(len(e["why"]), 30, "an exemption without a reason is a waiver")

    def test_the_shared_table_is_not_trivially_satisfiable(self):
        """The other end of anti-vacuity: a table of only-accepts (or only-refuses) would sail
        through both suites while comparing almost nothing. Pins that the table really carries
        both outcomes, every accepted mode, and a precedence case for each constructible
        adjacency."""
        cases = self._PARITY["cases"]
        accepted = [c for c in cases if c["expect"]["ok"]]
        refused = [c for c in cases if not c["expect"]["ok"]]
        self.assertGreater(len(accepted), 0)
        self.assertGreater(len(refused), 0)
        # All TEN stored modes -- the persisted contract S2c states in words and S3 computes
        # against. A mode missing here is a formula neither suite is comparing.
        self.assertEqual(
            {c["expect"]["mode"] for c in accepted},
            {"qty_total", "qty_by_area", "amount_total", "amount_supply_plus_install",
             "amount_supply_only", "amount_install_only", "amount_by_area",
             "amount_by_area_supply_plus_install", "amount_by_area_supply_only",
             "amount_by_area_install_only"},
        )
        # The `beats` COUNT that used to sit here (`>= 8`, against a table of 11) is gone on
        # purpose: it was three cases of slack, and a number cannot say WHICH precedence claim
        # went missing. `test_every_constructible_adjacency_in_the_chain_has_a_precedence_case`
        # replaced it with the property the number was standing in for.

    def test_the_client_only_code_is_deliberately_outside_the_vocabulary(self):
        """The ONE place the two sides answer differently on purpose. The client's amount-mode
        table miss returns a refusal; this module's equivalent is a bare KeyError on
        `_AMOUNT_MODES` -- 'fail loudly rather than mint a plausible mode for a shape nobody
        ruled on'. Both are unreachable by construction. The asymmetry is RECORDED in the
        table rather than papered over, and pinned here so nobody 'restores consistency' by
        quietly adding it to the chain."""
        for code in self._PARITY["client_only_codes"]:
            self.assertNotIn(code, self._PARITY["codes"])
            self.assertNotIn(code, self._ORDER["qty"])
            self.assertNotIn(code, self._ORDER["amount"])


# ===========================================================================
# Group 9: the decision / voicing split itself (BCS-S2e)
# ===========================================================================
class TestDecideAndBuildAreOneRule(unittest.TestCase):
    """`build_*_source` is now a THIN THROWING WRAPPER over `decide_*_source`. That is what
    makes the parity table possible -- but it is only safe while the two cannot disagree, so
    the relationship is pinned rather than trusted.

    THE RISK THIS CLOSES is the one BCS-S2e was written to avoid in the first place: a
    code-returning function that has drifted from the throwing function every caller actually
    uses would make the parity table a test of something nothing runs. Sweeping the shared
    table through BOTH entry points is what stops that."""

    _PARITY = _load_parity_cases()
    _INDEX = {d["col"]: d for d in _PARITY["descriptors"]}
    _BUILD = {"qty": build_qty_source, "amount": build_amount_source}
    _DECIDE = {"qty": decide_qty_source, "amount": decide_amount_source}

    def test_build_throws_exactly_when_decide_refuses(self):
        for case in self._PARITY["cases"]:
            with self.subTest(case=case["id"]):
                decided = self._DECIDE[case["side"]](case["cols"], self._INDEX)
                if decided["ok"]:
                    built = self._BUILD[case["side"]](case["cols"], self._INDEX)
                    self.assertEqual(built, decided["source"])
                else:
                    with self.assertRaises(frappe.ValidationError):
                        self._BUILD[case["side"]](case["cols"], self._INDEX)

    def test_the_built_source_carries_no_decision_bookkeeping(self):
        """`confirm_bcs_columns` json.dumps this dict straight into `bcs_qty_source` /
        `bcs_amount_source`, so the wrapper must hand back the SOURCE and not the decision
        envelope. An `ok` key leaking into the stored blob would change a persisted contract
        that BCS-S3 reads."""
        for cols, side in ((["D"], "qty"), (["B", "C"], "qty"),
                           (["F"], "amount"), (["J", "P"], "amount")):
            out = self._BUILD[side](cols, self._INDEX)
            self.assertEqual(set(out), {"mode", "columns"})

    def test_a_refusal_still_carries_its_user_facing_words(self):
        """The split moved the VOICE into the returned refusal; it did not delete it. Each
        refusal still carries the title and the message the endpoint throws, so nothing about
        what a user reads changed at BCS-S2e."""
        out = decide_qty_source(["Z"], self._INDEX)
        self.assertFalse(out["ok"])
        self.assertEqual(out["title"], "Unknown column")
        self.assertRegex(out["message"], r"^Column 'Z' is not a mapped column")
        self.assertEqual(out["code"], "unknown_column")

    def test_the_thrown_message_is_the_refusals_own_message(self):
        """Byte-for-byte, so the wrapper cannot become a second place wording lives."""
        refusal = decide_amount_source(["F", "J"], self._INDEX)
        with self.assertRaises(frappe.ValidationError) as caught:
            build_amount_source(["F", "J"], self._INDEX)
        self.assertIn(refusal["message"], str(caught.exception))


if __name__ == "__main__":
    unittest.main()


# ===========================================================================
# Group 9: THE TWO DERIVATIONS -- and their half of the parity table
# ===========================================================================
class TestTheTwoDerivations(unittest.TestCase):
    """★ `derive_qty_columns` / `live_rate_kinds` -- which columns BCS uses when nobody
    confirmed any. The cases live in `parity_cases.json` (`derived_qty_cases` /
    `rate_kinds_cases`) and the vitest suite runs the SAME list against the browser twins,
    so a divergence turns exactly one of the two red.

    WHY THE SERVER ANSWERS THIS AT ALL. It never computed a BCS number before; the BCS
    export does, and it has to know which cost boxes a sheet has and where its quantity
    lives. The CONFIRMATION cannot supply the answer -- BCS-S12 removed both column pickers,
    so `confirm_bcs_columns` has had no caller in the product since and six of the seven
    live BCS-enabled sheets carry no `bcs_qty_source` at all (measured 2026-08-19).

    ⚠️ THE ANTI-VACUITY HERE IS AIMED AT A SPECIFIC, ALREADY-REALISED FAILURE, not at a
    hypothetical. The browser's rate map keyed the per-area AMOUNT spelling (`supply` /
    `install` / `total`) where a per-area RATE spells its kind `supply_rate` /
    `install_rate` / `combined_rate` -- so it returned NO cost boxes for a per-area-rate
    sheet, and its own unit fixtures carried the same wrong spelling, so mirror and test
    were green together. Agreement between two mirrors could never have caught that. Hence
    `test_the_fixture_subkeys_come_from_the_producer`, which anchors the fixtures to
    `classifier`'s own maps -- the module that actually writes the value.
    """

    _PARITY = _load_parity_cases()

    # -- the cases themselves ---------------------------------------------
    def test_every_derived_qty_case_in_the_shared_table(self):
        for case in self._PARITY["derived_qty_cases"]:
            with self.subTest(case=case["id"]):
                out = derive_qty_columns(case["confirmed"], case["descriptors"])
                self.assertEqual(
                    [(c.get("col"), c.get("value_field"), c.get("value_key")) for c in out],
                    [(c["col"], c["value_field"], c["value_key"])
                     for c in case["expect"]["columns"]],
                    case["why"],
                )

    def test_every_rate_kinds_case_in_the_shared_table(self):
        for case in self._PARITY["rate_kinds_cases"]:
            with self.subTest(case=case["id"]):
                self.assertEqual(
                    live_rate_kinds(case["descriptors"]), case["expect"]["kinds"], case["why"]
                )

    # -- the fixtures are REAL, anchored to the module that writes them ----
    def test_every_fixture_descriptor_has_the_shape_the_builder_emits(self):
        """A descriptor with an invented shape is how the browser twin's fixtures came to
        agree with its own bug. `review_screen._build_column_descriptors` emits exactly six
        keys on every descriptor it makes; a fixture carrying five or seven is describing a
        sheet that cannot exist."""
        keys = {"col", "role", "area", "value_field", "value_key", "rate_subkey"}
        for case in self._all_cases():
            for d in case["descriptors"]:
                with self.subTest(case=case["id"], col=d.get("col")):
                    self.assertEqual(set(d), keys)

    def test_the_fixture_subkeys_come_from_the_producer(self):
        """★ THE GUARD THAT WOULD HAVE CAUGHT THE ORIGINAL BUG, and the reason it is written
        against `classifier` rather than against the other mirror.

        `rate_subkey` is a GENERIC third-hop slot: `review_screen._build_column_descriptors`
        fills it from `_RATE_ROLE_TO_KIND` for a per-area rate and from `_AMOUNT_ROLE_TO_KIND`
        for a per-area amount, and those two vocabularies do not overlap. Asserting the two
        mirrors agree with each other proves nothing if both copied the same wrong list --
        which is precisely what happened. This asserts against the module that WRITES the
        value, so the fixtures are right or they are red."""
        from nirmaan_stack.services.boq_parser.classifier import (
            _AMOUNT_ROLE_TO_KIND,
            _RATE_ROLE_TO_KIND,
        )

        legal_rate = set(_RATE_ROLE_TO_KIND.values())
        legal_amount = set(_AMOUNT_ROLE_TO_KIND.values())
        # The module's own map must speak the producer's vocabulary, not the amount side's.
        self.assertEqual(set(_PER_AREA_RATE_SUBKEY_TO_BCS_KIND), legal_rate)
        self.assertEqual(legal_rate & legal_amount, set(),
                         "the two vocabularies must stay disjoint, or this guard is toothless")
        for case in self._all_cases():
            for d in case["descriptors"]:
                with self.subTest(case=case["id"], col=d.get("col")):
                    if d["value_field"] == "rate_by_area":
                        self.assertIn(d["rate_subkey"], legal_rate)
                    elif d["value_field"] == "amount_by_area":
                        self.assertIn(d["rate_subkey"], legal_amount)

    # -- anti-vacuity ------------------------------------------------------
    def test_the_derived_qty_cases_exercise_every_branch(self):
        """Four branches, and a table missing one is a branch neither language is comparing:
        a stored confirmation wins; else the scalar total; else the per-area columns; else
        nothing at all."""
        outs = {c["id"]: derive_qty_columns(c["confirmed"], c["descriptors"])
                for c in self._PARITY["derived_qty_cases"]}
        cases = {c["id"]: c for c in self._PARITY["derived_qty_cases"]}
        self.assertTrue(any(c["confirmed"] and c["confirmed"].get("columns")
                            for c in cases.values()), "no case exercises the confirmed branch")
        fields = {f for out in outs.values() for f in (c.get("value_field") for c in out)}
        self.assertIn("qty_total", fields, "no case lands on the scalar branch")
        self.assertIn("qty_by_area", fields, "no case lands on the per-area branch")
        self.assertTrue(any(out == [] for out in outs.values()),
                        "no case lands on the empty branch")

    def test_the_rate_kinds_cases_exercise_every_kind_and_both_shapes(self):
        """Every box a sheet can get, the empty answer, and BOTH column shapes. The per-area
        shape is the one that was broken, so a table without it re-opens the hole."""
        results = [live_rate_kinds(c["descriptors"]) for c in self._PARITY["rate_kinds_cases"]]
        self.assertEqual({k for r in results for k in r}, {"supply", "install", "combined"})
        self.assertIn([], results, "no case pins the 'this sheet cannot do BCS' answer")
        shapes = {d["value_field"] for c in self._PARITY["rate_kinds_cases"]
                  for d in c["descriptors"]}
        self.assertIn("rate_by_area", shapes, "no case uses a PER-AREA rate column")
        self.assertTrue(shapes & {"rate_supply", "rate_install", "rate_combined"},
                        "no case uses a SCALAR rate column")

    def test_the_halves_and_the_combined_rate_are_never_returned_together(self):
        """★ THE RULING, as a property rather than a case. `bcs.py` forbids summing
        combined_rate with the two halves, so a returned set holding both would make BCS
        Total double-count. Swept over every subset of the three scalar rate columns AND over
        every case in the table, so it holds for inputs nobody thought to write down."""
        import itertools

        def rate(vf):
            return {"col": vf[-1].upper(), "role": vf, "area": None,
                    "value_field": vf, "value_key": None, "rate_subkey": None}

        for r in range(4):
            for combo in itertools.combinations(
                ("rate_supply", "rate_install", "rate_combined"), r
            ):
                kinds = live_rate_kinds([rate(vf) for vf in combo])
                with self.subTest(combo=combo):
                    self.assertFalse("combined" in kinds and len(kinds) > 1)
        for case in self._PARITY["rate_kinds_cases"]:
            kinds = case["expect"]["kinds"]
            with self.subTest(case=case["id"]):
                self.assertFalse("combined" in kinds and len(kinds) > 1)

    def test_a_confirmation_is_returned_untouched(self):
        """The confirmed branch hands back the STORED entries, not a rebuild of them. A
        rebuild would drop `rate_subkey` on a shape that needs three hops to resolve, and the
        loss would only surface as a wrong number much later."""
        stored = {"mode": "qty_by_area", "columns": [
            {"col": "B", "role": "qty", "area": "Zone A", "value_field": "qty_by_area",
             "value_key": "Zone A", "rate_subkey": None},
        ]}
        self.assertEqual(derive_qty_columns(stored, []), stored["columns"])

    def test_neither_derivation_touches_its_inputs(self):
        """Both are read-only on their arguments -- the export calls them per sheet against
        the same descriptor list the rest of the pass reads."""
        descriptors = [
            {"col": "D", "role": "qty_total", "area": None, "value_field": "qty_total",
             "value_key": None, "rate_subkey": None},
            {"col": "E", "role": "rate_supply", "area": None, "value_field": "rate_supply",
             "value_key": None, "rate_subkey": None},
        ]
        before = json.dumps(descriptors, sort_keys=True)
        derive_qty_columns(None, descriptors)
        live_rate_kinds(descriptors)
        self.assertEqual(json.dumps(descriptors, sort_keys=True), before)

    def test_both_derivations_tolerate_nothing_at_all(self):
        """None and [] are ordinary inputs: a grid-only sheet has no descriptors, and a
        sheet nobody confirmed has no source. Neither may raise -- the export walks many
        sheets in one pass and one odd sheet must not fail the file."""
        self.assertEqual(derive_qty_columns(None, None), [])
        self.assertEqual(derive_qty_columns({}, []), [])
        self.assertEqual(live_rate_kinds(None), [])
        self.assertEqual(live_rate_kinds([]), [])

    def _all_cases(self):
        return list(self._PARITY["derived_qty_cases"]) + list(self._PARITY["rate_kinds_cases"])
