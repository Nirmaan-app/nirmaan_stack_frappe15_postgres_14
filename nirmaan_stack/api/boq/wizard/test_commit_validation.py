"""
Tests for the BoQ commit-validation module (Phase 5 commit-preflight slice 1):
``nirmaan_stack/api/boq/wizard/commit_validation.py``.

Two layers of coverage:

  (A) Endpoint glue (no full fixture) -- the tolerant subset coercion, the frozen
      per_sheet entry assembly, the general-specs short-circuit, and the frozen-shape
      constant. (TestCoercePreflightSubset / TestMakePreflightEntry /
      TestEvaluateSheetGeneralSpecs / TestPreflightResponseShapeConstant.)

  (B) The real logic-bearing derivation + validator (this file's reason to exist per the
      "pure modules get REAL tests with fixtures" rule):
        TestValidateNodePlanPure  -- PURE Python over hand-built node plans:
            * the relaxed #7 preamble-parent rule -- a level-3 heading under a level-1
              heading now PASSES (the gap that used to false-positive); same-level /
              inverted / under a line-item still FAIL;
            * #8 -- an item under a non-heading fails; an item under a heading passes;
            * every KEEPER warning: #15 (deep), #16 (priced heading w/ child), #20
              (undeclared area, GROUPED per area name w/ count), #22 (level-less squeeze),
              orphan;
            * a structurally-clean plan yields zero errors / zero warnings;
            * the FROZEN finding shape (keys, message phrasing, ~60-char truncation).
        TestBuildSheetNodePlan    -- DB: build_sheet_node_plan derives correct
            node_type / level / parent from seeded BoQ Review Rows (spacer dropped, note ->
            Other), level-less-preamble assignment, the #22 squeeze surfaced as a
            level_warning, and the relaxed-#7 happy build (L3-under-L1 -> validate clean).
        TestEvaluateSheet         -- DB: evaluate_sheet short-circuits a general-specs sheet
            to 0/0 (no build) and runs build+validate for a finalized sheet (clean + a
            #20 warning).
        TestCommitPreflight       -- DB: the whitelisted commit_preflight endpoint returns
            the FROZEN per_sheet response shape for a finalized + a general-specs sheet,
            omitting ineligible sheets and honouring a JSON-string subset.

Conventions reused from the proven BoQ wizard suites: the Projects-row fixture pattern
(``_make_project`` / ``_cleanup_project`` from test_review_screen), sheet_name carried
VERBATIM with a trailing space (#152), and the -1 "no parent" sentinel on review rows.
"""
from __future__ import annotations

import json
import unittest

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard import commit_validation as cv
from nirmaan_stack.api.boq.wizard.commit_validation import (
    PREFLIGHT_RESPONSE_SHAPE,
    build_sheet_node_plan,
    commit_preflight,
    derive_effective_levels,
    evaluate_sheet,
    make_preflight_entry,
    preamble_parent_ok,
    validate_node_plan,
)
from nirmaan_stack.api.boq.wizard.test_review_screen import (
    _cleanup_project,
    _make_project,
)

# The full set of finding keys the frozen shape guarantees on every finding.
_FINDING_KEYS = {
    "kind", "code", "sheet_name", "source_row_number", "description",
    "message", "what_to_do", "group_key", "count",
}


# ---------------------------------------------------------------------------
# Pure helpers -- build node-plan dicts + seed review rows.
# ---------------------------------------------------------------------------

def _node(
    row_index,
    node_type,
    level=None,
    parent_index=None,
    description=None,
    qty=None,
    supply_rate=None,
    install_rate=None,
    combined_rate=None,
    qty_by_area=None,
    source_row_number=None,
    row_class=None,
):
    """Build ONE plan dict in the exact shape build_sheet_node_plan emits."""
    if row_class is None:
        row_class = {
            "Preamble": "preamble",
            "Line Item": "line_item",
        }.get(node_type, "other")
    return {
        "row_index": row_index,
        "source_row_number": source_row_number if source_row_number is not None else row_index + 2,
        "node_type": node_type,
        "level": level,
        "parent_index": parent_index,
        "description": description if description is not None else f"row {row_index}",
        "qty": qty,
        "supply_rate": supply_rate,
        "install_rate": install_rate,
        "combined_rate": combined_rate,
        "qty_by_area": qty_by_area or [],
        "row_class": row_class,
    }


def _by_code(findings, code):
    return [f for f in findings if f["code"] == code]


def _nr(row_index, cls, parent_index=None, source_row_number=None):
    """Build ONE (d, eff) node_rows pair in the shape derive_effective_levels reads.

    eff is a FRESH mutable dict so a test can re-parent a node (flip
    effective_parent_index) and re-derive to prove the cascade."""
    d = {
        "row_index": row_index,
        "source_row_number": source_row_number if source_row_number is not None else row_index + 2,
    }
    eff = {"effective_classification": cls, "effective_parent_index": parent_index}
    return (d, eff)


def _plan_from_rows(node_rows, levels_by_idx):
    """Project (d, eff) node_rows + derived levels into validate_node_plan's plan shape."""
    nt = {"preamble": "Preamble", "line_item": "Line Item"}
    return [
        _node(
            d["row_index"],
            nt.get(e["effective_classification"], "Other"),
            level=levels_by_idx[d["row_index"]],
            parent_index=e["effective_parent_index"],
            source_row_number=d["source_row_number"],
            row_class=e["effective_classification"],
        )
        for d, e in node_rows
    ]


def _seed_review_row(boq_name, sheet, row_index, classification, **kw):
    """Insert ONE BoQ Review Row (committed). dict-JSON fields (qty_by_area) pass as
    dicts; parent_index / human_parent default to the -1 "no parent" sentinel.
    Mirrors test_commit_pipeline._seed_review_row."""
    doc = frappe.new_doc("BoQ Review Row")
    doc.boq = boq_name
    doc.sheet_name = sheet  # VERBATIM (#152)
    doc.row_index = row_index
    doc.source_row_number = kw.get("source_row_number", row_index + 2)
    doc.classification = classification
    doc.parent_index = kw.get("parent_index", -1)
    doc.human_parent = kw.get("human_parent", -1)
    for f in ("level", "preamble_level_override", "description", "qty_total",
              "rate_supply", "rate_install", "rate_combined",
              "human_classification", "human_is_root"):
        if f in kw:
            setattr(doc, f, kw[f])
    for f in ("qty_by_area", "rate_by_area", "amount_by_area"):
        if f in kw:
            setattr(doc, f, kw[f])
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc.name


# ===========================================================================
# (A) Endpoint glue -- no full fixture.
# ===========================================================================

class TestCoercePreflightSubset(FrappeTestCase):
    """_coerce_preflight_subset: None/empty -> None (preflight-all); lists pass through
    VERBATIM (#152); bad shapes throw."""

    def test_none_returns_none(self):
        self.assertIsNone(cv._coerce_preflight_subset(None))

    def test_empty_and_whitespace_string_returns_none(self):
        self.assertIsNone(cv._coerce_preflight_subset(""))
        self.assertIsNone(cv._coerce_preflight_subset("   "))

    def test_json_string_list_parsed_verbatim(self):
        # A trailing space MUST survive (the #152 landmine).
        out = cv._coerce_preflight_subset('["HVAC ", "Plumbing"]')
        self.assertEqual(out, ["HVAC ", "Plumbing"])

    def test_python_list_passthrough(self):
        self.assertEqual(cv._coerce_preflight_subset(["A", "B "]), ["A", "B "])

    def test_tuple_passthrough(self):
        self.assertEqual(cv._coerce_preflight_subset(("X",)), ["X"])

    def test_invalid_json_throws(self):
        with self.assertRaises(frappe.exceptions.ValidationError):
            cv._coerce_preflight_subset("{not json")

    def test_non_list_type_throws(self):
        with self.assertRaises(frappe.exceptions.ValidationError):
            cv._coerce_preflight_subset(42)


class TestMakePreflightEntry(FrappeTestCase):
    """make_preflight_entry assembles ONE per_sheet entry of the frozen shape."""

    def test_shape_and_defaults(self):
        entry = cv.make_preflight_entry("Sheet 1 ", "finalized")
        self.assertEqual(
            set(entry.keys()), {"sheet_name", "disposition", "errors", "warnings"}
        )
        self.assertEqual(entry["sheet_name"], "Sheet 1 ")  # verbatim
        self.assertEqual(entry["disposition"], "finalized")
        self.assertEqual(entry["errors"], [])
        self.assertEqual(entry["warnings"], [])

    def test_copies_lists(self):
        errs = [{"code": "x"}]
        entry = cv.make_preflight_entry("S", "finalized", errs, None)
        # The assembler copies (list(...)) so the caller's list isn't aliased.
        self.assertEqual(entry["errors"], errs)
        self.assertIsNot(entry["errors"], errs)


class TestEvaluateSheetGeneralSpecs(FrappeTestCase):
    """A non-finalized (general-specs) sheet short-circuits to 0 errors / 0 warnings
    with NO DB read -- no node tree exists for it."""

    def test_general_specs_zero_findings(self):
        entry = cv.evaluate_sheet(
            boq_name="DOES-NOT-MATTER",
            sheet_name="Specs ",
            disposition="general_specs",
            declared_areas=None,
        )
        self.assertEqual(entry["sheet_name"], "Specs ")
        self.assertEqual(entry["disposition"], "general_specs")
        self.assertEqual(entry["errors"], [])
        self.assertEqual(entry["warnings"], [])


class TestPreflightResponseShapeConstant(FrappeTestCase):
    """The frozen-shape doc constant is the contract the frontend types mirror."""

    def test_constant(self):
        self.assertEqual(
            cv.PREFLIGHT_RESPONSE_SHAPE,
            "{per_sheet:[{sheet_name, disposition, errors:[finding], warnings:[finding]}]}",
        )


# ===========================================================================
# (B0) derive_effective_levels -- PURE Python level derivation (ADR-0009, no DB).
# ===========================================================================

class TestDeriveEffectiveLevels(unittest.TestCase):
    """The heart of the fix: level is DERIVED from the effective tree (nesting depth),
    not the frozen parser level. A preamble's level = 1 + (preamble ancestors); any
    non-preamble is level-less (None). Order-independent, cycle-safe, and -- crucially --
    re-parenting CASCADES to every descendant."""

    def test_root_preamble_is_level_one(self):
        levels, warns = derive_effective_levels([_nr(0, "preamble")])
        self.assertEqual(levels[0], 1)
        self.assertEqual(warns, [])

    def test_nesting_adds_one_per_tier(self):
        rows = [
            _nr(0, "preamble"),
            _nr(1, "preamble", parent_index=0),
            _nr(2, "preamble", parent_index=1),
        ]
        levels, warns = derive_effective_levels(rows)
        self.assertEqual([levels[0], levels[1], levels[2]], [1, 2, 3])
        self.assertEqual(warns, [], "a consistent nested tree trips no tripwire")

    def test_non_preamble_is_levelless_none(self):
        rows = [
            _nr(0, "preamble"),
            _nr(1, "line_item", parent_index=0),
            _nr(2, "note", parent_index=0),
        ]
        levels, _ = derive_effective_levels(rows)
        self.assertIsNone(levels[1], "a line_item carries NO level (None, not 0)")
        self.assertIsNone(levels[2], "a note carries NO level (None, not 0)")

    def test_reclassified_preamble_to_line_item_is_none(self):
        # A row whose EFFECTIVE classification is line_item (e.g. the human reclassified a
        # parser preamble) derives level None and stops counting as a preamble ancestor.
        rows = [
            _nr(0, "preamble"),
            _nr(1, "line_item", parent_index=0),   # was a preamble, now reclassified
            _nr(2, "preamble", parent_index=1),
        ]
        levels, _ = derive_effective_levels(rows)
        self.assertIsNone(levels[1], "reclassified-to-line_item -> level None")
        self.assertEqual(levels[2], 2, "row 1 no longer counts as a preamble ancestor")

    def test_preamble_under_line_item_counts_only_preamble_ancestors(self):
        # A preamble whose parent is a line_item still counts the line_item's own preamble
        # ancestors (so #7 can correctly flag it -- see the validate test below).
        rows = [
            _nr(0, "preamble"),
            _nr(1, "line_item", parent_index=0),
            _nr(2, "preamble", parent_index=1),
        ]
        levels, _ = derive_effective_levels(rows)
        self.assertEqual(levels[2], 2, "1 preamble ancestor (row 0); the line_item is skipped")

    def test_valves_four_tier_passes_relaxed_7(self):
        """The live repro shape: CHILLD WATER=1 -> VALVES=2 -> PN-16 Butterfly=3 /
        BTU METER=3 -> Ultrasonic BTUH=4. Derived levels are internally consistent, so
        #7 passes at EVERY edge (the bug clears honestly, not by weakening the rule)."""
        rows = [
            _nr(0, "preamble"),                  # CHILLD WATER -> 1
            _nr(1, "preamble", parent_index=0),  # VALVES -> 2
            _nr(2, "preamble", parent_index=1),  # PN-16 Butterfly valves -> 3
            _nr(3, "preamble", parent_index=1),  # BTU METER -> 3
            _nr(4, "preamble", parent_index=3),  # Ultrasonic BTUH -> 4
            _nr(5, "line_item", parent_index=2), # item under PN-16 -> None
        ]
        levels, warns = derive_effective_levels(rows)
        self.assertEqual([levels[i] for i in range(5)], [1, 2, 3, 3, 4])
        self.assertIsNone(levels[5])
        self.assertEqual(warns, [], "derivation is internally consistent -> no tripwire")

        plan = _plan_from_rows(rows, levels)
        res = validate_node_plan(plan, None, "VALVES ")
        self.assertEqual(
            _by_code(res["errors"], "preamble_parent_level"), [],
            "every derived sub-heading sits under a strictly-shallower heading -> #7 clean",
        )
        self.assertEqual(_by_code(res["errors"], "line_item_parent_not_preamble"), [])

    def test_cascade_reparent_shifts_descendants_in_lockstep(self):
        """LOAD-BEARING cascade: A>B>C>D>E preamble chain. Re-parenting the MIDDLE node C
        from B(L2) up to A(L1) drops C AND every descendant (D, E) one level in lockstep;
        B is untouched. The symmetric move back restores the original levels."""
        A, B, C, D, E = 0, 1, 2, 3, 4
        rows = [
            _nr(A, "preamble"),
            _nr(B, "preamble", parent_index=A),
            _nr(C, "preamble", parent_index=B),
            _nr(D, "preamble", parent_index=C),
            _nr(E, "preamble", parent_index=D),
        ]
        before, _ = derive_effective_levels(rows)
        self.assertEqual([before[i] for i in (A, B, C, D, E)], [1, 2, 3, 4, 5])

        # Re-parent C: B(L2) -> A(L1). rows[C] is (d, eff); flip eff's parent pointer.
        rows[C][1]["effective_parent_index"] = A
        after, warns = derive_effective_levels(rows)
        self.assertEqual(
            [after[i] for i in (A, B, C, D, E)], [1, 2, 2, 3, 4],
            "C and ALL its descendants (D, E) shift in lockstep; B untouched",
        )
        self.assertEqual(warns, [], "the re-parented tree is still internally consistent")

        # Symmetric move back.
        rows[C][1]["effective_parent_index"] = B
        back, _ = derive_effective_levels(rows)
        self.assertEqual([back[i] for i in (A, B, C, D, E)], [1, 2, 3, 4, 5])

    def test_cycle_is_safe(self):
        # A 2-node parent cycle (0<->1) must terminate (seen-set guard), not hang.
        rows = [
            _nr(0, "preamble", parent_index=1),
            _nr(1, "preamble", parent_index=0),
        ]
        levels, _ = derive_effective_levels(rows)  # must return, not loop forever
        # Each preamble counts the OTHER once before the guard halts the walk.
        self.assertEqual(levels[0], 2)
        self.assertEqual(levels[1], 2)

    def test_hop_cap_terminates_on_very_deep_chain(self):
        # A 70-deep preamble chain exceeds the hop-cap (60); the walk must still terminate.
        rows = [_nr(0, "preamble")]
        for i in range(1, 70):
            rows.append(_nr(i, "preamble", parent_index=i - 1))
        levels, _ = derive_effective_levels(rows)  # must return
        self.assertEqual(levels[10], 11, "a row within the cap derives its exact depth")
        # The deepest row's walk is capped at 60 hops -> at most 60 ancestors -> level 61.
        self.assertEqual(levels[69], 61)

    def test_tripwire_inconsistent_level_still_fires_7(self):
        """Derivation always produces consistent levels, but #7 is KEPT as a defensive
        tripwire: if a future regression injected an inconsistent level (here a preamble
        manually stamped L3 directly under an L3 parent), #7 must STILL fire."""
        plan = [
            _node(0, "Preamble", level=3),
            _node(1, "Preamble", level=3, parent_index=0),  # injected inconsistency
        ]
        errs = _by_code(
            validate_node_plan(plan, None, "Tripwire ")["errors"], "preamble_parent_level"
        )
        self.assertEqual(len(errs), 1, "the #7 backstop fires on an inconsistent level")


# ===========================================================================
# (B1) validate_node_plan + preamble_parent_ok -- PURE Python (no DB).
# ===========================================================================

class TestValidateNodePlanPure(unittest.TestCase):

    SHEET = "Pure Plan "  # VERBATIM trailing space (#152)

    def _validate(self, plan, declared_areas=None, level_warnings=None):
        return validate_node_plan(plan, declared_areas, self.SHEET, level_warnings)

    # -- the shared relaxed-#7 predicate, in isolation ----------------------

    def test_preamble_parent_ok_predicate(self):
        # L0 / L1 are unconstrained -> always OK (regardless of parent).
        self.assertTrue(preamble_parent_ok(None, "Line Item", None))
        self.assertTrue(preamble_parent_ok(0, "Line Item", None))
        self.assertTrue(preamble_parent_ok(1, None, None))
        # level > 1: OK iff parent is a STRICTLY-shallower section heading.
        self.assertTrue(preamble_parent_ok(3, "Preamble", 1), "L3 under L1 -> the relax")
        self.assertTrue(preamble_parent_ok(3, "Preamble", 2))
        self.assertFalse(preamble_parent_ok(3, "Preamble", 3), "same level -> not OK")
        self.assertFalse(preamble_parent_ok(3, "Preamble", 4), "deeper parent -> not OK")
        self.assertFalse(preamble_parent_ok(3, "Line Item", None), "non-heading parent")
        self.assertFalse(preamble_parent_ok(3, "Preamble", None), "parent has no level")

    # -- ERROR #7 (relaxed) --------------------------------------------------

    def test_error7_l3_under_l1_passes_the_relax(self):
        """The gap that used to FALSE-POSITIVE: a level-3 heading filed directly under a
        level-1 heading is now ACCEPTED (any strictly-shallower heading qualifies)."""
        plan = [
            _node(0, "Preamble", level=1),                   # L1 root heading
            _node(1, "Preamble", level=3, parent_index=0),   # L3 under L1 -> OK
        ]
        res = self._validate(plan)
        self.assertEqual(
            _by_code(res["errors"], "preamble_parent_level"), [],
            "L3-under-L1 must NOT raise the preamble-parent error (relaxed #7)",
        )

    def test_error7_same_level_parent_fails(self):
        """A level-3 heading under an EQUAL-level (L3) heading still fails -- the parent
        must be STRICTLY shallower."""
        plan = [
            _node(0, "Preamble", level=3),                   # L3 root
            _node(1, "Preamble", level=3, parent_index=0),   # L3 under L3 -> FAIL
        ]
        errs = _by_code(self._validate(plan)["errors"], "preamble_parent_level")
        self.assertEqual(len(errs), 1, "exactly the L3-under-L3 child is flagged")
        self.assertEqual(errs[0]["source_row_number"], 3)   # row_index 1 -> source 3

    def test_error7_inverted_deeper_parent_fails(self):
        """A level-3 heading under a DEEPER (L4) heading fails (inverted hierarchy)."""
        plan = [
            _node(0, "Preamble", level=4),                   # L4 root
            _node(1, "Preamble", level=3, parent_index=0),   # L3 under L4 -> FAIL
        ]
        errs = _by_code(self._validate(plan)["errors"], "preamble_parent_level")
        self.assertEqual(len(errs), 1)

    def test_error7_preamble_under_line_item_fails(self):
        plan = [
            _node(0, "Preamble", level=1),                   # L1 root heading
            _node(1, "Line Item", parent_index=0),           # item under heading (OK for #8)
            _node(2, "Preamble", level=3, parent_index=1),   # L3 under an ITEM -> FAIL
        ]
        res = self._validate(plan)
        self.assertEqual(len(_by_code(res["errors"], "preamble_parent_level")), 1)

    # -- ERROR #8 ------------------------------------------------------------

    def test_error8_line_item_under_non_heading_fails(self):
        plan = [
            _node(0, "Preamble", level=1),
            _node(1, "Line Item", parent_index=0),           # item under heading -> OK
            _node(2, "Line Item", parent_index=1),           # item under an ITEM -> FAIL #8
        ]
        errs = _by_code(self._validate(plan)["errors"], "line_item_parent_not_preamble")
        self.assertEqual(len(errs), 1, "only the item-under-an-item is flagged")
        self.assertEqual(errs[0]["source_row_number"], 4)   # row_index 2 -> source 4

    # -- a clean plan yields nothing ----------------------------------------

    def test_clean_plan_no_errors_no_warnings(self):
        plan = [
            _node(0, "Preamble", level=1),
            _node(1, "Preamble", level=2, parent_index=0),                 # L2 under L1 OK
            _node(2, "Line Item", parent_index=1, qty=5.0,                 # item under heading OK
                  qty_by_area=[{"area_name": "Phase 1", "qty": 5.0}]),
        ]
        res = self._validate(plan, declared_areas=["Phase 1"])
        self.assertEqual(res["errors"], [])
        self.assertEqual(res["warnings"], [])

    # -- WARNING #15 (deep) --------------------------------------------------

    def test_warning15_deep_heading(self):
        plan = [_node(0, "Preamble", level=6)]  # level > 5, root -> no #7, just #15
        warns = _by_code(self._validate(plan)["warnings"], "preamble_level_deep")
        self.assertEqual(len(warns), 1)
        self.assertIn("level 6", warns[0]["message"])

    # -- WARNING #16 (priced heading that also has children) ----------------

    def test_warning16_priced_heading_with_children(self):
        plan = [
            _node(0, "Preamble", level=1, qty=12.0),   # heading carries its own qty
            _node(1, "Line Item", parent_index=0),     # ...and has a child
        ]
        warns = _by_code(self._validate(plan)["warnings"], "preamble_priced_with_children")
        self.assertEqual(len(warns), 1)
        self.assertEqual(warns[0]["source_row_number"], 2)  # the heading (row_index 0)

    def test_warning16_priced_heading_childless_no_warning(self):
        # A priced heading with NO children must NOT warn (only priced + has-child fires).
        plan = [_node(0, "Preamble", level=1, combined_rate=99.0)]
        warns = _by_code(self._validate(plan)["warnings"], "preamble_priced_with_children")
        self.assertEqual(warns, [])

    # -- WARNING #20 (undeclared area, grouped per area) --------------------

    def test_warning20_undeclared_area_grouped_with_count(self):
        plan = [
            _node(0, "Preamble", level=1),
            _node(1, "Line Item", parent_index=0,
                  qty_by_area=[{"area_name": "Phase 1", "qty": 10},
                               {"area_name": "Phase Z", "qty": 5}]),
            _node(2, "Line Item", parent_index=0,
                  qty_by_area=[{"area_name": "Phase Z", "qty": 3}]),
        ]
        warns = _by_code(
            self._validate(plan, declared_areas=["Phase 1"])["warnings"],
            "undeclared_area",
        )
        self.assertEqual(len(warns), 1, "the two 'Phase Z' rows fold into ONE finding")
        w = warns[0]
        self.assertEqual(w["count"], 2, "the row count is carried")
        self.assertEqual(w["group_key"], "undeclared_area:Phase Z")
        self.assertIsNone(w["source_row_number"], "a grouped finding has no single row")
        self.assertIn("Phase Z", w["message"])

    def test_warning20_silent_when_no_areas_declared(self):
        # With NO declared areas, the #20 check is skipped entirely (can't judge a typo).
        plan = [_node(0, "Line Item", parent_index=None,
                      qty_by_area=[{"area_name": "Anything", "qty": 1}])]
        warns = _by_code(self._validate(plan, declared_areas=[])["warnings"], "undeclared_area")
        self.assertEqual(warns, [])

    # -- WARNING orphan ------------------------------------------------------

    def test_warning_orphan_line_item(self):
        plan = [_node(0, "Line Item", parent_index=None)]  # item with no parent group
        warns = _by_code(self._validate(plan)["warnings"], "orphan_line_item")
        self.assertEqual(len(warns), 1)
        self.assertEqual(warns[0]["source_row_number"], 2)

    # -- WARNING #22 (level-less squeeze, fed via level_warnings) -----------

    def test_warning22_levelless_squeeze_from_level_warnings(self):
        plan = [_node(1, "Preamble", level=0, parent_index=0, description="squeezed head")]
        level_warnings = [{
            "row_index": 1, "source_row_number": 3,
            "computed_level": 0, "parent_level": 2,
        }]
        warns = _by_code(
            self._validate(plan, level_warnings=level_warnings)["warnings"],
            "levelless_preamble_squeeze",
        )
        self.assertEqual(len(warns), 1)
        w = warns[0]
        self.assertEqual(w["source_row_number"], 3)
        self.assertEqual(w["count"], 1)
        self.assertIn("level 0", w["message"])
        self.assertIn("level 2", w["message"])
        self.assertEqual(w["description"], "squeezed head")

    # -- finding shape contract ---------------------------------------------

    def test_finding_shape_and_message_phrasing(self):
        plan = [
            _node(0, "Preamble", level=3),
            _node(1, "Preamble", level=3, parent_index=0, description="Sub heading"),
        ]
        f = _by_code(self._validate(plan)["errors"], "preamble_parent_level")[0]
        self.assertEqual(set(f.keys()), _FINDING_KEYS, "finding carries the full frozen key set")
        self.assertEqual(f["kind"], "error")
        self.assertEqual(f["sheet_name"], self.SHEET, "sheet_name carried verbatim (#152)")
        self.assertEqual(f["count"], 1)
        self.assertEqual(f["group_key"], "preamble_parent_level:1")
        self.assertTrue(f["message"].startswith("Row 3 "), "message leads with the source row")
        self.assertIn("·", f["message"], "middot separates row + description")
        self.assertIn("—", f["message"], "em-dash separates the prefix from the body")
        self.assertTrue(f["what_to_do"], "a remediation tail is present")

    def test_description_truncation_at_60_chars(self):
        long_desc = "X" * 90
        plan = [_node(0, "Line Item", parent_index=None, description=long_desc)]
        f = _by_code(self._validate(plan)["warnings"], "orphan_line_item")[0]
        self.assertLessEqual(len(f["description"]), 60, "description truncated to ~60 chars")
        self.assertTrue(f["description"].endswith("…"), "truncation uses an ellipsis")


# ===========================================================================
# (B2) build_sheet_node_plan -- DB-backed derivation from review rows.
# ===========================================================================

class TestBuildSheetNodePlan(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Commit-Validation Build BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def _seed(self, sheet, row_index, classification, **kw):
        return _seed_review_row(self.boq, sheet, row_index, classification, **kw)

    @staticmethod
    def _by_row(plan):
        return {p["row_index"]: p for p in plan}

    # -- type / level / parent derivation -----------------------------------

    def test_build_derives_type_level_parent_and_drops_spacer(self):
        sheet = "Build Basic "  # VERBATIM trailing space (#152)
        self._seed(sheet, 0, "preamble", level=1, description="GROUP", source_row_number=5)
        self._seed(sheet, 1, "line_item", parent_index=0, description="Item A",
                   qty_total=10.0, qty_by_area={"Phase 1": 10.0}, source_row_number=6)
        self._seed(sheet, 2, "note", parent_index=0, description="Site note",
                   source_row_number=7)
        self._seed(sheet, 3, "spacer", description="", source_row_number=8)

        plan, level_warnings = build_sheet_node_plan(self.boq, sheet)

        self.assertEqual(len(plan), 3, "spacer is grid-only -> dropped from the node plan")
        self.assertEqual(level_warnings, [], "no level-less preamble -> no squeeze")
        by_row = self._by_row(plan)

        pre = by_row[0]
        self.assertEqual(pre["node_type"], "Preamble")
        self.assertEqual(pre["level"], 1)
        self.assertIsNone(pre["parent_index"], "root -> effective parent None")
        self.assertEqual(pre["row_class"], "preamble")

        li = by_row[1]
        self.assertEqual(li["node_type"], "Line Item")
        self.assertIsNone(li["level"], "a Line Item never carries a level")
        self.assertEqual(li["parent_index"], 0)
        self.assertEqual(li["qty"], 10.0)
        self.assertEqual(li["qty_by_area"], [{"area_name": "Phase 1", "qty": 10.0}])

        note = by_row[2]
        self.assertEqual(note["node_type"], "Other", "a note commits as an Other node")
        self.assertEqual(note["parent_index"], 0)
        self.assertEqual(note["row_class"], "note")

    # -- level derived from the tree, stored parser level ignored (ADR-0009) ---

    def test_build_derives_levels_from_tree_ignoring_stored_parser_level(self):
        """ADR-0009: the stored parser `level` is IGNORED -- level is the effective-tree
        nesting depth. A root preamble derives 1 and its preamble child derives 2,
        regardless of the (here deliberately mismatched) stored levels."""
        sheet = "Build Derive "
        self._seed(sheet, 0, "preamble", level=0, description="root")                  # stored 0
        self._seed(sheet, 1, "preamble", level=1, parent_index=0, description="child")  # stored 1
        self._seed(sheet, 2, "line_item", level=0, parent_index=1, qty_total=5.0)

        plan, warns = build_sheet_node_plan(self.boq, sheet)
        by_row = self._by_row(plan)
        self.assertEqual(by_row[0]["level"], 1, "root preamble -> derived 1 (stored 0 ignored)")
        self.assertEqual(by_row[1]["level"], 2, "preamble under a preamble -> derived 2 (stored 1 ignored)")
        self.assertIsNone(by_row[2]["level"], "a line_item carries no level (None)")
        self.assertEqual(warns, [], "a consistent derived tree trips no tripwire")

    # -- the fix: an inconsistent stored level is overridden -> #7 clean -----

    def test_build_overrides_inconsistent_stored_level_and_validates_clean(self):
        """The bug this fix closes: a preamble stored with an INCONSISTENT parser level
        (here 3, directly under an L1) used to trip #7. Derivation now recomputes it to 2
        (parent depth + 1), so the built tree validates CLEAN -- not by weakening #7, but
        because the level is honest."""
        sheet = "Build Override "
        self._seed(sheet, 0, "preamble", level=1, description="L1 HEAD")
        self._seed(sheet, 1, "preamble", level=3, parent_index=0, description="SUB (stored L3)")
        self._seed(sheet, 2, "line_item", parent_index=1, qty_total=5.0)

        plan, consistency_warnings = build_sheet_node_plan(self.boq, sheet)
        by_row = self._by_row(plan)
        self.assertEqual(by_row[1]["level"], 2, "stored L3 overridden to the derived L2")
        res = validate_node_plan(plan, [], sheet, consistency_warnings)
        self.assertEqual(
            _by_code(res["errors"], "preamble_parent_level"), [],
            "the derived (consistent) tree validates clean end-to-end",
        )
        self.assertEqual(
            _by_code(res["warnings"], "levelless_preamble_squeeze"), [],
            "no squeeze tripwire under correct derivation",
        )

    # -- the old #22 squeeze cannot arise under derivation ------------------

    def test_build_no_squeeze_warning_under_derivation(self):
        """The old 'level-less squeeze' #22 cannot arise under derivation: the same inputs
        that used to squeeze (a level-less mid preamble) now derive a consistent depth, so
        the consistency tripwire stays empty."""
        sheet = "Build NoSqueeze "
        self._seed(sheet, 0, "preamble", level=2, description="PARENT")               # stored 2
        self._seed(sheet, 1, "preamble", level=0, parent_index=0, description="mid")  # stored 0
        self._seed(sheet, 2, "line_item", level=1, parent_index=1, qty_total=5.0)

        plan, consistency_warnings = build_sheet_node_plan(self.boq, sheet)
        by_row = self._by_row(plan)
        self.assertEqual(by_row[0]["level"], 1, "root preamble -> 1 (stored 2 ignored)")
        self.assertEqual(by_row[1]["level"], 2, "mid preamble -> 2 (stored 0 ignored)")
        self.assertEqual(consistency_warnings, [], "no squeeze: the derived tree is consistent")

        res = validate_node_plan(plan, [], sheet, consistency_warnings)
        self.assertEqual(
            _by_code(res["warnings"], "levelless_preamble_squeeze"), [],
            "no #22 squeeze warning surfaces",
        )

    def test_build_empty_sheet_returns_empty_plan(self):
        plan, level_warnings = build_sheet_node_plan(self.boq, "No Such Sheet ZZ ")
        self.assertEqual(plan, [])
        self.assertEqual(level_warnings, [])


# ===========================================================================
# (B3) evaluate_sheet -- general-specs short-circuit vs finalized build (DB).
# ===========================================================================

class TestEvaluateSheet(FrappeTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Commit-Validation Evaluate BoQ"
        boq.tax_treatment = "Pre-tax"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        cls.sheet = "Eval Fin "  # VERBATIM trailing space (#152)
        _seed_review_row(cls.boq, cls.sheet, 0, "preamble", level=1, description="HEAD")
        _seed_review_row(cls.boq, cls.sheet, 1, "line_item", parent_index=0,
                         description="Item", qty_total=4.0,
                         qty_by_area={"Phase 1": 4.0})

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def test_general_specs_sheet_is_empty_and_skips_build(self):
        # disposition != "finalized" -> grid-only -> NO node tree -> 0 errors / 0 warnings.
        entry = evaluate_sheet(self.boq, "SOW", "general_specs", [])
        self.assertEqual(entry, make_preflight_entry("SOW", "general_specs", [], []))

    def test_finalized_sheet_builds_and_validates_clean(self):
        entry = evaluate_sheet(self.boq, self.sheet, "finalized", ["Phase 1"])
        self.assertEqual(entry["sheet_name"], self.sheet)
        self.assertEqual(entry["disposition"], "finalized")
        # A clean structure (heading + item-under-heading, declared area) -> 0 / 0.
        self.assertEqual(entry["errors"], [])
        self.assertEqual(entry["warnings"], [])

    def test_finalized_sheet_surfaces_undeclared_area_warning(self):
        # When the row's area is NOT in the declared set -> a #20 warning (no errors).
        entry = evaluate_sheet(self.boq, self.sheet, "finalized", ["Bogus Only"])
        self.assertEqual(entry["errors"], [])
        self.assertEqual(
            [w["code"] for w in entry["warnings"]], ["undeclared_area"],
            "the row's 'Phase 1' area is undeclared against ['Bogus Only']",
        )


# ===========================================================================
# (B4) commit_preflight -- the frozen per_sheet response shape (DB).
# ===========================================================================

class TestCommitPreflight(FrappeTestCase):
    """The whitelisted READ-ONLY endpoint: derive + validate the commit-eligible sheets
    and return the FROZEN per_sheet shape for a finalized + a general-specs sheet."""

    FIN_SHEET = "Preflight Fin "   # VERBATIM trailing space (#152), wizard_status Finalized
    GEN_SHEET = "Preflight SOW"    # general-specs designated via the pointer overlay

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.test_project = _make_project()
        sheet_cfg = json.dumps({
            "header_row": 1, "header_row_count": 1,
            "column_role_map": {}, "column_headers": {},
            "area_dimensions": ["Phase 1"],
        })
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "Commit-Validation Preflight BoQ"
        boq.tax_treatment = "Pre-tax"
        # Finalized line-item sheet (declares Phase 1).
        boq.append("sheet_drafts", {
            "sheet_name": cls.FIN_SHEET, "sheet_order": 1,
            "wizard_status": "Finalized", "sheet_config": sheet_cfg,
        })
        # General-specs designated sheet (pointer membership outranks wizard_status).
        boq.append("sheet_drafts", {
            "sheet_name": cls.GEN_SHEET, "sheet_order": 2,
            "wizard_status": "Skip", "sheet_config": sheet_cfg,
        })
        # An ineligible (Pending) sheet -- must be OMITTED from the preflight result.
        boq.append("sheet_drafts", {
            "sheet_name": "Preflight Pending", "sheet_order": 3,
            "wizard_status": "Pending",
        })
        boq.append("general_specs_sheets", {"source_sheet_name": cls.GEN_SHEET})
        boq.insert(ignore_permissions=True)
        cls.boq = boq.name
        frappe.db.commit()

        # Finalized-sheet review rows: a clean heading + a child item whose qty_by_area
        # carries one DECLARED area ("Phase 1") + one UNDECLARED ("Bogus Area") -> the
        # finalized entry must have 0 errors but >= 1 (undeclared_area) warning.
        _seed_review_row(cls.boq, cls.FIN_SHEET, 0, "preamble", level=1, description="HEAD")
        _seed_review_row(cls.boq, cls.FIN_SHEET, 1, "line_item", parent_index=0,
                         description="Item", qty_total=10.0,
                         qty_by_area={"Phase 1": 10.0, "Bogus Area": 5.0})
        # General-specs sheet intentionally gets NO review rows (grid-only path).

    @classmethod
    def tearDownClass(cls):
        frappe.db.delete("BoQ Review Row", {"boq": cls.boq})
        frappe.db.delete("BOQs", {"name": cls.boq})
        frappe.db.commit()
        _cleanup_project(cls.test_project.name)
        super().tearDownClass()

    @staticmethod
    def _entry(per_sheet, sheet_name):
        return next((e for e in per_sheet if e["sheet_name"] == sheet_name), None)

    def test_preflight_returns_frozen_per_sheet_shape(self):
        res = commit_preflight(boq_name=self.boq)
        self.assertIn("per_sheet", res)
        per_sheet = res["per_sheet"]
        # Exactly the two commit-eligible sheets (Pending omitted).
        names = {e["sheet_name"] for e in per_sheet}
        self.assertEqual(names, {self.FIN_SHEET, self.GEN_SHEET})
        self.assertNotIn("Preflight Pending", names, "an ineligible sheet is omitted")
        # Every entry carries the frozen per_sheet keys + list-typed errors/warnings.
        for e in per_sheet:
            self.assertEqual(
                set(e.keys()), {"sheet_name", "disposition", "errors", "warnings"},
            )
            self.assertIsInstance(e["errors"], list)
            self.assertIsInstance(e["warnings"], list)

    def test_finalized_entry_zero_errors_with_undeclared_warning(self):
        per_sheet = commit_preflight(boq_name=self.boq)["per_sheet"]
        fin = self._entry(per_sheet, self.FIN_SHEET)
        self.assertIsNotNone(fin)
        self.assertEqual(fin["disposition"], "finalized")
        self.assertEqual(fin["errors"], [], "a clean finalized structure has no errors")
        self.assertIn(
            "undeclared_area", [w["code"] for w in fin["warnings"]],
            "the 'Bogus Area' cell surfaces an undeclared-area warning",
        )
        # Each finding carries the full frozen key set.
        for w in fin["warnings"]:
            self.assertEqual(set(w.keys()), _FINDING_KEYS)

    def test_general_specs_entry_is_grid_only_zero_zero(self):
        per_sheet = commit_preflight(boq_name=self.boq)["per_sheet"]
        gen = self._entry(per_sheet, self.GEN_SHEET)
        self.assertIsNotNone(gen)
        self.assertEqual(gen["disposition"], "general_specs")
        self.assertEqual(gen["errors"], [], "general-specs -> no node tree -> no errors")
        self.assertEqual(gen["warnings"], [], "general-specs -> no node tree -> no warnings")

    def test_sheet_subset_filters_to_requested(self):
        # A JSON-string subset (the HTTP form) narrows the result to the requested sheet.
        res = commit_preflight(boq_name=self.boq, sheet_subset=json.dumps([self.GEN_SHEET]))
        names = {e["sheet_name"] for e in res["per_sheet"]}
        self.assertEqual(names, {self.GEN_SHEET})

    def test_missing_boq_throws(self):
        with self.assertRaises(frappe.ValidationError):
            commit_preflight(boq_name=None)
        with self.assertRaises(frappe.ValidationError):
            commit_preflight(boq_name="NOPE-DOES-NOT-EXIST")


class TestPreflightCommitParity(unittest.TestCase):
    """The preflight and the real commit MUST feed resolve_effective IDENTICAL inputs, or the
    preview diverges from the write (the bug this slice set out to close). A partially-accepted
    AI row (ai_suggestion_status == "Accepted" with only ONE axis folded to human_*) would, if
    the plan builder read the ai_* fields, re-apply the UN-accepted AI suggestion and resolve a
    different parent/classification than the commit. Guard it STRUCTURALLY: both field lists
    spread RESOLVE_EFFECTIVE_COMMIT_INPUT_FIELDS, and NEITHER may carry an ai_* field into
    resolve_effective."""

    def test_resolve_effective_inputs_are_shared_and_ai_free(self):
        from nirmaan_stack.api.boq.wizard.commit_pipeline import _REVIEW_ROW_FIELDS

        shared = cv.RESOLVE_EFFECTIVE_COMMIT_INPUT_FIELDS
        # The shared resolve_effective inputs appear in BOTH the commit field list and the
        # preflight plan field list.
        for f in shared:
            self.assertIn(f, _REVIEW_ROW_FIELDS, f"commit field list missing {f!r}")
            self.assertIn(f, cv._PLAN_REVIEW_ROW_FIELDS, f"plan field list missing {f!r}")
        # NEITHER list may carry an ai_* field into resolve_effective: doing so would re-apply
        # an UN-accepted AI suggestion on a partially-accepted row -> preview/commit divergence.
        self.assertEqual(
            [f for f in _REVIEW_ROW_FIELDS if f.startswith("ai_")], [],
            "commit must NOT feed resolve_effective any ai_* field",
        )
        self.assertEqual(
            [f for f in cv._PLAN_REVIEW_ROW_FIELDS if f.startswith("ai_")], [],
            "preflight must NOT feed resolve_effective any ai_* field (parity with commit)",
        )
