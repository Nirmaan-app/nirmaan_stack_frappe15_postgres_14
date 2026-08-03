# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Tests for the RELOCATED BCS readiness predicate -- slice BCS-S6.

`bcs_is_ready` answers one question: may a BCS cost value be written onto this committed
sheet+version? It is BCS enabled AND both columns confirmed, and nothing else.

WHY IT MOVED HERE, and why that move is not cosmetic. BCS-S6 registers BCS costs as a fifth
opt-in CARRY layer, dispatched from `api/boq/wizard/committed_carry.py`. The carry has to ask
the readiness question about its DESTINATION sheet -- a carry into a sheet with no BCS section
must land nothing. Asking it by importing `api/boq/wizard/bcs.py` closes an import ring:

    committed_carry -> bcs -> pricing -> committed_carry

verified at module level (`bcs.py` imports `pricing`; `pricing.py` imports `committed_carry`).
`pricing.py`'s own header records the one-way rule this would have broken, and no placement
inside `api/` avoids it -- `cross_boq_carry` imports both, `commit_pipeline` is a third
dependent. So the predicate moved DOWN to the service layer, which both sides may import
(api -> service is the one legal direction). This is the `boq_category.persist` pattern
exactly: `committed_carry` already imports that service module rather than the sibling api one.

⚠️ THE PREDICATE IS DEFINED ONCE. `api/boq/wizard/bcs.py` imports the name straight back, so
`bcs.bcs_is_ready` still resolves and every existing caller is untouched. Two copies of a
readiness rule would be bad anywhere; here they would sit on either side of a carry and could
disagree about the same sheet at exactly the moment it mattered -- the plan read offering a
layer the apply then silently drops. `test_the_predicate_has_exactly_one_definition` pins it.

⚠️ THIS SUITE IS NOT PURE, unlike its sibling `test_sources.py`. The predicate reads
`BoQ Sheet` and therefore needs a real committed fixture. See `readiness.py`'s own docstring
for the package-docstring conflict this creates and the one-line correction it is owed.

Run:
    bench --site localhost run-tests --module nirmaan_stack.services.boq_bcs.test_readiness

Coverage:
  Group 1  the RULE      -- enabled + both confirmations, and each way of not being ready.
  Group 2  the COERCION  -- a string committed_version answers identically to an int.
  Group 3  ONE DEFINITION -- `bcs.bcs_is_ready` IS this function, not a copy of it.
"""
import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_bcs.readiness import bcs_is_ready

_BOQ_SHEET = "BoQ Sheet"


class _BcsReadinessFixture(FrappeTestCase):
    """One committed sheet at version 1 with a real scalar quantity column and a real scalar
    amount column, confirmed THROUGH the live endpoints -- setup drives the gate rather than
    writing its output (the convention test_bcs.py records on its own helpers)."""

    SHEET = "RDY Fix "  # VERBATIM trailing space (#152)
    CV = 1

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Imported inside setUpClass, not at module import time: these are api-layer TEST
        # helpers, and a service test module that pulled them in at import would make the
        # service package look like it depends on `api/` to anything grepping imports.
        from nirmaan_stack.api.boq.wizard.test_bcs import (
            _SCALAR_ROLE_MAP,
            _cleanup_committed,
            _seed_sheet,
        )
        from nirmaan_stack.api.boq.wizard.test_review_screen import (
            _cleanup_project,
            _make_project,
        )

        cls._cleanup_committed = staticmethod(_cleanup_committed)
        cls._cleanup_project = staticmethod(_cleanup_project)

        cls.test_project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.test_project.name
        boq.boq_name = "BCS Readiness Test BoQ"
        boq.insert(ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name
        _seed_sheet(cls.boq, cls.SHEET, cls.CV, _SCALAR_ROLE_MAP, [], 1)
        cls.sheet_row = frappe.db.get_value(
            _BOQ_SHEET,
            {"boq": cls.boq, "sheet_name": cls.SHEET, "commit_version": cls.CV},
            "name",
        )

    @classmethod
    def tearDownClass(cls):
        cls._cleanup_committed(cls.boq)
        cls._cleanup_project(cls.test_project.name)
        super().tearDownClass()

    def setUp(self):
        """Reset to READY: enabled, both columns confirmed. D is the scalar qty_total column
        and F the scalar amount_total column of `_SCALAR_ROLE_MAP`."""
        from nirmaan_stack.api.boq.wizard.bcs import confirm_bcs_columns, set_bcs_enabled

        set_bcs_enabled(
            boq_name=self.boq, sheet_name=self.SHEET, committed_version=self.CV, enabled=1
        )
        confirm_bcs_columns(
            boq_name=self.boq, sheet_name=self.SHEET, committed_version=self.CV,
            qty_cols='["D"]', amount_cols='["F"]',
        )
        frappe.db.commit()


# ===========================================================================
# Group 1: the rule
# ===========================================================================
class TestReadinessRule(_BcsReadinessFixture):
    def test_enabled_and_both_columns_confirmed_is_ready(self):
        self.assertTrue(bcs_is_ready(self.boq, self.SHEET, self.CV))

    def test_disabled_is_not_ready_even_with_both_confirmations_intact(self):
        """Disabling PRESERVES the confirmation (re-enabling must not force a re-pick), so
        `bcs_enabled` alone has to be able to say no."""
        frappe.db.set_value(_BOQ_SHEET, self.sheet_row, "bcs_enabled", 0, update_modified=False)
        frappe.db.commit()
        self.assertFalse(bcs_is_ready(self.boq, self.SHEET, self.CV))

    def test_an_unconfirmed_quantity_column_is_not_ready(self):
        frappe.db.set_value(_BOQ_SHEET, self.sheet_row, "bcs_qty_source", None,
                            update_modified=False)
        frappe.db.commit()
        self.assertFalse(bcs_is_ready(self.boq, self.SHEET, self.CV))

    def test_an_unconfirmed_amount_column_is_not_ready(self):
        frappe.db.set_value(_BOQ_SHEET, self.sheet_row, "bcs_amount_source", None,
                            update_modified=False)
        frappe.db.commit()
        self.assertFalse(bcs_is_ready(self.boq, self.SHEET, self.CV))

    def test_a_version_that_was_never_committed_is_not_ready_rather_than_throwing(self):
        """A pure read: an uncommitted / re-committed-away version is simply not ready. The
        carry leans on this -- it asks about a destination it has not otherwise validated."""
        self.assertFalse(bcs_is_ready(self.boq, self.SHEET, 99))

    def test_sheet_name_is_matched_VERBATIM(self):
        """#152: real sheet names carry trailing spaces. A trimmed name is a DIFFERENT sheet,
        and answering `True` for it would let a carry write onto the wrong sheet's address."""
        self.assertTrue(bcs_is_ready(self.boq, self.SHEET, self.CV))
        self.assertFalse(bcs_is_ready(self.boq, self.SHEET.strip(), self.CV))


# ===========================================================================
# Group 2: the coercion -- the relocation's one behavioural trap
# ===========================================================================
class TestReadinessVersionCoercion(_BcsReadinessFixture):
    """⚠️ THE TRAP THE RELOCATION HAD TO AVOID, pinned.

    The predicate used to resolve its sheet through `pricing._current_sheet_name`, which
    COERCES: `"commit_version": _coerce_int(committed_version, ...)`. The obvious model for a
    service-layer rewrite is `boq_category.persist.is_sheet_classification_frozen`, which
    filters on the SAME doctype and the SAME key but passes `committed_version` RAW.

    Copying the raw form would be a silent behaviour change on a predicate whose failure mode
    is a SILENT SKIP: a not-ready answer makes the carry land nothing, report zero, and raise
    nothing -- and because the plan read shares the predicate, the dialog would agree with the
    broken answer and show the layer as having nothing to carry. There is no error anywhere to
    notice.

    So the coercion is preserved, and pinned here rather than trusted. Both assertions are
    TRUE, not merely equal: two Falses would agree vacuously and pin nothing at all."""

    def test_a_string_committed_version_answers_exactly_as_the_int_does(self):
        self.assertTrue(bcs_is_ready(self.boq, self.SHEET, self.CV))
        self.assertTrue(bcs_is_ready(self.boq, self.SHEET, str(self.CV)))
        self.assertEqual(
            bcs_is_ready(self.boq, self.SHEET, str(self.CV)),
            bcs_is_ready(self.boq, self.SHEET, self.CV),
        )

    def test_the_string_form_still_says_no_when_the_sheet_is_not_ready(self):
        """The coercion must not turn into a blanket yes -- a string version that resolves to a
        real but DISABLED sheet is still not ready."""
        frappe.db.set_value(_BOQ_SHEET, self.sheet_row, "bcs_enabled", 0, update_modified=False)
        frappe.db.commit()
        self.assertFalse(bcs_is_ready(self.boq, self.SHEET, str(self.CV)))

    def test_a_non_numeric_version_is_refused_by_name_rather_than_read_as_not_ready(self):
        """Preserved from the pre-relocation behaviour: `_coerce_int` throws a NAMED refusal on
        garbage. Answering `False` instead would be friendlier and worse -- 'not ready' is a
        real product state a caller acts on, and a malformed argument is not that state."""
        with self.assertRaises(frappe.ValidationError) as cm:
            bcs_is_ready(self.boq, self.SHEET, "not-a-number")
        self.assertIn("committed_version", str(cm.exception))


# ===========================================================================
# Group 3: one definition
# ===========================================================================
class TestOneDefinition(FrappeTestCase):
    """Two copies of a readiness rule sitting either side of a carry is the ADR-0010 failure
    this relocation exists to prevent. Pinned by IDENTITY, not by behaviour: a behavioural
    comparison would keep passing right up until the two copies diverged on the one input
    nobody tested."""

    def test_the_predicate_has_exactly_one_definition(self):
        from nirmaan_stack.api.boq.wizard import bcs
        from nirmaan_stack.services.boq_bcs import readiness

        self.assertIs(bcs.bcs_is_ready, readiness.bcs_is_ready)

    def test_the_api_module_does_not_redefine_it(self):
        """The identity check above passes for a re-export; it would ALSO pass for a moment if
        someone re-added a local `def` below the import. This reads the source."""
        import inspect

        from nirmaan_stack.api.boq.wizard import bcs

        self.assertNotIn("def bcs_is_ready(", inspect.getsource(bcs))

    def test_the_carry_engine_reaches_it_without_importing_the_api_module(self):
        """The whole point of the relocation. `committed_carry` importing `bcs` would close
        committed_carry -> bcs -> pricing -> committed_carry, which `pricing.py`'s header
        records as forbidden."""
        import inspect

        from nirmaan_stack.api.boq.wizard import committed_carry

        src = inspect.getsource(committed_carry)
        self.assertNotIn("wizard.bcs", src)
        self.assertNotIn("wizard import bcs", src)
        self.assertIn("services.boq_bcs.readiness", src)
