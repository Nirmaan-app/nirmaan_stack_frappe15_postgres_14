# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import json

import frappe
from frappe.tests.utils import FrappeTestCase

_TEST_PROJECT = "_TEST_BOQ_PROJECT_NODES"


class TestBOQNodes(FrappeTestCase):
    """
    Tests for the BOQ Nodes controller (integrations/controllers/boq_nodes.py).

    A single shared BOQ and a shared L1 preamble are created in setUpClass
    (committed) and reused by all tests. Individual node inserts inside each
    test are NOT committed, so FrappeTestCase's tearDown rollback cleans them
    up automatically.

    Exception: test_audit_entry_written_on_edit_with_reason — the _write_audit
    helper calls frappe.db.commit(), committing both the node and the Nirmaan
    Versions entry. That test performs explicit cleanup in a finally block.

    _make_line_item defaults parent_node to the shared preamble (cls.default_preamble)
    so that most tests don't trigger the standalone-line-item warning. Pass
    parent_node=None explicitly to test standalone behaviour.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = "Shared Test BoQ"
        boq.insert(ignore_permissions=True, ignore_links=True)

        # P4-2: nodes link to a BoQ Sheet (the sheet tier); boq is denormalized and
        # auto-filled from the sheet by the controller. A shared sheet under the
        # shared BoQ gives every test a valid sheet to link.
        sheet = frappe.new_doc("BoQ Sheet")
        sheet.boq = boq.name
        sheet.sheet_name = "_TEST"
        sheet.sheet_order = 1
        sheet.insert(ignore_permissions=True)

        preamble = frappe.new_doc("BOQ Nodes")
        preamble.sheet = sheet.name
        preamble.node_type = "Preamble"
        preamble.level = 1
        preamble.description = "Shared L1 Preamble for Line Item Tests"
        preamble.insert(ignore_permissions=True)

        frappe.db.commit()
        cls.boq_name = boq.name
        cls.sheet_name = sheet.name
        cls.default_preamble = preamble.name

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "boq_name"):
            frappe.db.delete("BOQ Nodes", {"boq": cls.boq_name})
            frappe.db.delete("BoQ Sheet", {"boq": cls.boq_name})
            frappe.db.delete("BOQs", {"name": cls.boq_name})
            frappe.db.commit()
        super().tearDownClass()

    # ------------------------------------------------------------------ #
    # Helpers                                                              #
    # ------------------------------------------------------------------ #

    def _make_preamble(self, level=1, parent_node=None, description="Test Preamble"):
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = level
        node.description = description
        node.parent_node = parent_node
        node.insert(ignore_permissions=True)
        return node

    def _make_line_item(self, parent_node="DEFAULT", description="Test Line Item",
                        qty=10, supply_rate=None, install_rate=None,
                        combined_rate=None, amount_override=0):
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = description
        node.parent_node = self.default_preamble if parent_node == "DEFAULT" else parent_node
        node.qty = qty
        node.supply_rate = supply_rate
        node.install_rate = install_rate
        node.combined_rate = combined_rate
        node.amount_override = amount_override
        node.insert(ignore_permissions=True)
        return node

    # ------------------------------------------------------------------ #
    # validate: required-field guards                                      #
    # ------------------------------------------------------------------ #

    def test_validate_requires_sheet(self):
        # P4-2: the BoQ Sheet is now the required upward tie (boq is denormalized and
        # auto-filled from the sheet). A node with no sheet must be rejected.
        with self.assertRaises(frappe.ValidationError):
            node = frappe.new_doc("BOQ Nodes")
            node.sheet = ""
            node.node_type = "Preamble"
            node.level = 1
            node.description = "Missing sheet"
            node.insert(ignore_permissions=True, ignore_links=True)

    def test_node_sheet_boq_sync(self):
        # P4-2 sync invariant: node.boq must equal its sheet's boq.
        # (a) boq blank + sheet set -> boq is auto-filled from the sheet.
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Sync auto-fill test"
        node.insert(ignore_permissions=True)
        self.assertEqual(node.boq, self.boq_name)

        # (b) boq set to a DIFFERENT value than the sheet's boq -> rejected.
        other_boq = frappe.new_doc("BOQs")
        other_boq.project = _TEST_PROJECT
        other_boq.boq_name = "Other BoQ for sync mismatch"
        other_boq.insert(ignore_permissions=True, ignore_links=True)
        try:
            with self.assertRaises(frappe.ValidationError):
                bad = frappe.new_doc("BOQ Nodes")
                bad.sheet = self.sheet_name      # sheet's boq == self.boq_name
                bad.boq = other_boq.name         # deliberate mismatch
                bad.node_type = "Preamble"
                bad.level = 1
                bad.description = "Sync mismatch test"
                bad.insert(ignore_permissions=True, ignore_links=True)
        finally:
            frappe.db.delete("BOQs", {"name": other_boq.name})
            frappe.db.commit()

    def test_validate_requires_node_type(self):
        with self.assertRaises(frappe.ValidationError):
            node = frappe.new_doc("BOQ Nodes")
            node.sheet = self.sheet_name
            node.description = "Missing node_type"
            node.insert(ignore_permissions=True)

    def test_validate_requires_description(self):
        with self.assertRaises(frappe.ValidationError):
            node = frappe.new_doc("BOQ Nodes")
            node.sheet = self.sheet_name
            node.node_type = "Preamble"
            node.level = 1
            node.insert(ignore_permissions=True)

    # ------------------------------------------------------------------ #
    # validate: "Other" node_type (X -- non-priceable rows)                #
    # ------------------------------------------------------------------ #

    def test_other_node_saves_cleanly(self):
        # X: a non-priceable "Other" node (note/subtotal_marker/header_repeat) saves with
        # no level and no qty -- the Preamble/Line Item validation branches no-op for it.
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Other"
        node.row_class = "note"
        node.description = "Site note: rates inclusive of taxes"
        node.insert(ignore_permissions=True)
        self.assertEqual(node.node_type, "Other")
        self.assertEqual(node.row_class, "note")
        self.assertIsNone(node.level)

    def test_other_node_under_preamble_saves(self):
        # X: a note's effective parent is a preamble -> an Other node parented to a
        # Preamble must save (the Line-Item-parent-must-be-Preamble rule no-ops for Other).
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Other"
        node.row_class = "note"
        node.description = "note under preamble"
        node.parent_node = self.default_preamble
        node.insert(ignore_permissions=True)
        self.assertEqual(node.parent_node, self.default_preamble)

    # ------------------------------------------------------------------ #
    # validate: Preamble level rules                                       #
    # ------------------------------------------------------------------ #

    def test_preamble_level_zero_saves(self):
        """Phase 5 level-less-preamble fix: level 0 is now ALLOWED for a Preamble
        (the commit pipeline assigns 0 to a level-less preamble); it must SAVE."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 0
        node.description = "Level-zero preamble"
        node.insert(ignore_permissions=True)
        self.assertEqual(node.level, 0)

    def test_preamble_level_negative_rejected(self):
        """A negative Preamble level is still invalid and must be rejected."""
        with self.assertRaises(frappe.ValidationError):
            node = frappe.new_doc("BOQ Nodes")
            node.sheet = self.sheet_name
            node.node_type = "Preamble"
            node.level = -1
            node.description = "Bad negative level"
            node.insert(ignore_permissions=True)

    def test_preamble_level_four_saves_successfully(self):
        """Level 4 preambles are valid since Phase 1.5 removed the L1–L3 cap."""
        l1 = self._make_preamble(level=1, description="L1 for L4 test")
        l2 = self._make_preamble(level=2, parent_node=l1.name, description="L2 for L4 test")
        l3 = self._make_preamble(level=3, parent_node=l2.name, description="L3 for L4 test")
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 4
        node.description = "L4 preamble"
        node.parent_node = l3.name
        node.insert(ignore_permissions=True)
        self.assertEqual(node.level, 4)
        self.assertEqual(node.path, f"{l1.name}/{l2.name}/{l3.name}/{node.name}")

    def test_preamble_level_six_warns_but_saves(self):
        """Level 6 exceeds the soft limit of 5; a warning is emitted but save succeeds."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 6
        node.description = "Deep preamble level 6"
        node.insert(ignore_permissions=True)
        self.assertEqual(node.level, 6)

    # ------------------------------------------------------------------ #
    # validate: Line Item rules                                            #
    # ------------------------------------------------------------------ #

    def test_line_item_with_level_set_is_rejected(self):
        with self.assertRaises(frappe.ValidationError):
            node = frappe.new_doc("BOQ Nodes")
            node.sheet = self.sheet_name
            node.node_type = "Line Item"
            node.level = 1
            node.description = "Line Item with level"
            node.qty = 5
            node.supply_rate = 100
            node.insert(ignore_permissions=True)

    def test_line_item_with_null_qty_rejected(self):
        """qty left as None (not set) must be blocked — zero is valid, None is not."""
        with self.assertRaises(frappe.ValidationError):
            node = frappe.new_doc("BOQ Nodes")
            node.sheet = self.sheet_name
            node.node_type = "Line Item"
            node.description = "Line Item without qty"
            node.supply_rate = 100
            # node.qty intentionally not set → stays None
            node.insert(ignore_permissions=True)

    def test_line_item_with_zero_qty_succeeds(self):
        """qty=0 is valid for rate-only items; the null guard uses 'is None', not falsy check."""
        node = self._make_line_item(qty=0, supply_rate=100,
                                    description="Zero qty line item")
        self.assertEqual(node.qty, 0)

    def test_line_item_with_zero_level_saves_treated_as_unset(self):
        """ADR-0009: a non-preamble is level-less. The commit pipeline leaves a Line Item's
        level unset (None), but the controller's `if doc.level:` guard treats an explicit 0
        as falsy too -- so a Line Item with level 0 SAVES (0 == 'no level set'). Only a
        truthy (>=1) level is rejected (test_line_item_with_level_set_is_rejected)."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.level = 0
        node.description = "Line Item with explicit zero level"
        node.parent_node = self.default_preamble
        node.qty = 5
        node.supply_rate = 100
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)

    def test_derived_preamble_chain_saves(self):
        """ADR-0009: a committed Preamble's level is the DERIVED tree depth (>=1). A
        consistent L1 -> L2 -> L3 chain (each parent strictly shallower) saves through the
        controller's #7 backstop -- this is the shape the commit pipeline now produces."""
        l1 = self._make_preamble(level=1, description="Derived L1")
        l2 = self._make_preamble(level=2, parent_node=l1.name, description="Derived L2")
        l3 = self._make_preamble(level=3, parent_node=l2.name, description="Derived L3")
        self.assertEqual([l1.level, l2.level, l3.level], [1, 2, 3])
        self.assertEqual(l3.path, f"{l1.name}/{l2.name}/{l3.name}")

    # ------------------------------------------------------------------ #
    # is_rate_only auto-computation                                        #
    # ------------------------------------------------------------------ #

    def test_is_rate_only_not_auto_set_for_zero_qty_with_rate(self):
        """CAPTURE-ONLY: is_rate_only is NO LONGER auto-set. qty=0 + a rate, with
        is_rate_only left unset, persists the default 0 -- the controller does not
        derive it; the Slice-3 pipeline carries the parser's value through verbatim."""
        node = self._make_line_item(qty=0, supply_rate=100,
                                    description="Rate only no longer auto-set")
        self.assertEqual(node.is_rate_only, 0)

    def test_is_rate_only_persists_when_set_true(self):
        """CAPTURE-ONLY: a written is_rate_only=1 persists even with qty>0 -- the
        controller never resets it (no auto-derivation)."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Rate only carried through"
        node.parent_node = self.default_preamble
        node.qty = 5
        node.supply_rate = 100
        node.is_rate_only = 1
        node.insert(ignore_permissions=True)
        self.assertEqual(node.is_rate_only, 1)

    def test_is_rate_only_defaults_zero_when_unset(self):
        """CAPTURE-ONLY: is_rate_only left unset stays at its 0 default (not derived)."""
        node = self._make_line_item(qty=0, description="No rate zero qty")
        self.assertEqual(node.is_rate_only, 0)

    # ------------------------------------------------------------------ #
    # validate: parent-child consistency                                   #
    # ------------------------------------------------------------------ #

    def test_l2_preamble_parent_must_be_l1_preamble(self):
        """L2 whose parent is a Line Item must be rejected."""
        wrong_parent = self._make_line_item(qty=5, supply_rate=100,
                                            description="Wrong Parent LI")
        with self.assertRaises(frappe.ValidationError):
            node = frappe.new_doc("BOQ Nodes")
            node.sheet = self.sheet_name
            node.node_type = "Preamble"
            node.level = 2
            node.description = "L2 with Line Item parent"
            node.parent_node = wrong_parent.name
            node.insert(ignore_permissions=True)

    def test_l3_preamble_under_shallower_l1_now_allowed_relaxed(self):
        """RELAXED #7: an L3 directly under an L1 (skipping L2) is now ALLOWED -- the
        parent only needs to be a STRICTLY shallower section heading, not exactly one
        level up. (Was rejected pre-relax.)"""
        l1 = self._make_preamble(level=1, description="L1 for relaxed L3 parent test")
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 3
        node.description = "L3 under L1 (relaxed-OK)"
        node.parent_node = l1.name
        node.insert(ignore_permissions=True)
        self.assertEqual(node.level, 3)
        self.assertEqual(node.path, f"{l1.name}/{node.name}")

    def test_l3_preamble_under_equal_level_parent_still_rejected(self):
        """RELAXED #7 still BLOCKS a non-shallower parent: an L3 under another L3 (parent
        not strictly shallower) must raise -- the relax only widens 'exactly one up' to
        'any strictly shallower heading', it does NOT allow an equal/deeper parent."""
        l3_parent = self._make_preamble(level=3, description="L3 parent (equal level)")
        with self.assertRaises(frappe.ValidationError):
            node = frappe.new_doc("BOQ Nodes")
            node.sheet = self.sheet_name
            node.node_type = "Preamble"
            node.level = 3
            node.description = "L3 under equal-level L3 (wrong)"
            node.parent_node = l3_parent.name
            node.insert(ignore_permissions=True)

    def test_line_item_parent_must_be_a_preamble(self):
        """Line Item whose parent is another Line Item must be rejected."""
        li_parent = self._make_line_item(qty=5, supply_rate=100,
                                         description="Line Item Parent")
        with self.assertRaises(frappe.ValidationError):
            node = frappe.new_doc("BOQ Nodes")
            node.sheet = self.sheet_name
            node.node_type = "Line Item"
            node.description = "Line Item child of Line Item"
            node.qty = 3
            node.supply_rate = 50
            node.parent_node = li_parent.name
            node.insert(ignore_permissions=True)

    def test_standalone_line_item_with_no_parent_succeeds(self):
        """
        A Line Item with no parent_node emits a warning but saves successfully.
        Standalone line items are allowed from Phase 1.5 onwards.
        """
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Standalone line item"
        node.qty = 5
        node.supply_rate = 100
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)
        # (capture-only: total_amount is no longer computed -- the structural
        # "standalone Line Item saves" assertion is what this test certifies)

    # ------------------------------------------------------------------ #
    # Path computation                                                     #
    # ------------------------------------------------------------------ #

    def test_path_of_root_node_equals_its_name(self):
        l1 = self._make_preamble(level=1, description="Root Path Test")
        self.assertEqual(l1.path, l1.name)

    def test_path_of_child_node_includes_parent(self):
        l1 = self._make_preamble(level=1, description="L1 for child path")
        l2 = self._make_preamble(level=2, parent_node=l1.name,
                                  description="L2 for child path")
        self.assertEqual(l2.path, f"{l1.name}/{l2.name}")

    def test_path_of_three_level_chain(self):
        l1 = self._make_preamble(level=1, description="L1 deep path")
        l2 = self._make_preamble(level=2, parent_node=l1.name,
                                  description="L2 deep path")
        l3 = self._make_preamble(level=3, parent_node=l2.name,
                                  description="L3 deep path")
        self.assertEqual(l3.path, f"{l1.name}/{l2.name}/{l3.name}")

    def test_path_updates_on_reparent(self):
        """
        Moving a node to a different parent must recompute its own path.

        Note: only the moved node's path is verified here. Propagating the
        path change to the node's descendants (if any) is a known Phase 5
        concern and is intentionally out of scope for this Phase 1 test.
        """
        l1_a = self._make_preamble(level=1, description="L1-A reparent test")
        l1_b = self._make_preamble(level=1, description="L1-B reparent test")
        l2 = self._make_preamble(level=2, parent_node=l1_a.name,
                                  description="L2 reparent test")

        self.assertEqual(l2.path, f"{l1_a.name}/{l2.name}")

        l2.parent_node = l1_b.name
        l2.save(ignore_permissions=True)

        self.assertEqual(l2.path, f"{l1_b.name}/{l2.name}")
        db_path = frappe.db.get_value("BOQ Nodes", l2.name, "path")
        self.assertEqual(db_path, f"{l1_b.name}/{l2.name}")

    # ------------------------------------------------------------------ #
    # Amount capture-only (no auto-computation -- Phase 5 Slice 2.5)       #
    # ------------------------------------------------------------------ #

    def test_supply_amount_not_auto_computed(self):
        """CAPTURE-ONLY: amounts are NOT derived from qty x rate. Rates set, amounts
        left blank -> every amount field stays blank (None)."""
        node = self._make_line_item(qty=10, supply_rate=100,
                                    description="Supply only, amounts not computed")
        self.assertIsNone(node.supply_amount)
        self.assertIsNone(node.install_amount)
        self.assertIsNone(node.total_amount)

    def test_install_amount_not_auto_computed(self):
        """CAPTURE-ONLY: install_rate set, amounts blank -> all amounts stay None."""
        node = self._make_line_item(qty=4, install_rate=50,
                                    description="Install only, amounts not computed")
        self.assertIsNone(node.supply_amount)
        self.assertIsNone(node.install_amount)
        self.assertIsNone(node.total_amount)

    def test_combined_amount_not_auto_computed(self):
        """CAPTURE-ONLY: combined_rate set, amounts blank -> all amounts stay None."""
        node = self._make_line_item(qty=5, combined_rate=200,
                                    description="Combined only, amounts not computed")
        self.assertIsNone(node.supply_amount)
        self.assertIsNone(node.install_amount)
        self.assertIsNone(node.total_amount)

    def test_supply_install_amounts_not_auto_computed(self):
        """CAPTURE-ONLY: supply + install rates set, amounts blank -> all stay None."""
        node = self._make_line_item(qty=3, supply_rate=100, install_rate=50,
                                    description="Supply+install, amounts not computed")
        self.assertIsNone(node.supply_amount)
        self.assertIsNone(node.install_amount)
        self.assertIsNone(node.total_amount)

    def test_set_amounts_persist_verbatim(self):
        """CAPTURE-ONLY: written amounts persist UNCHANGED for ALL writes (no
        amount_override needed) -- even when they do NOT equal qty x rate (qty*supply
        would be 1000, but the written 999 must survive)."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Amounts persist verbatim"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.supply_rate = 100
        node.supply_amount = 999.0
        node.total_amount = 999.0
        node.insert(ignore_permissions=True)
        self.assertEqual(node.supply_amount, 999.0)
        self.assertEqual(node.total_amount, 999.0)

    def test_leaf_preamble_amounts_not_computed(self):
        """CAPTURE-ONLY: a leaf preamble with qty + rate but blank amounts keeps the
        amounts blank -- they are NOT computed."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Leaf preamble, amounts not computed"
        node.qty = 5
        node.supply_rate = 100
        node.insert(ignore_permissions=True)
        self.assertIsNone(node.supply_amount)
        self.assertIsNone(node.total_amount)

    def test_non_leaf_preamble_with_qty_emits_warning_but_saves(self):
        """
        A non-leaf preamble (has children) with qty/rate set must emit a
        warning but still save — the check is informational, not blocking.
        """
        parent = frappe.new_doc("BOQ Nodes")
        parent.sheet = self.sheet_name
        parent.node_type = "Preamble"
        parent.level = 1
        parent.description = "Non-leaf preamble with qty"
        parent.qty = 5
        parent.supply_rate = 100
        parent.insert(ignore_permissions=True)

        child = frappe.new_doc("BOQ Nodes")
        child.sheet = self.sheet_name
        child.node_type = "Preamble"
        child.level = 2
        child.description = "Child of non-leaf preamble"
        child.parent_node = parent.name
        child.insert(ignore_permissions=True)

        # Save the parent again — it's now a non-leaf, warning fires but no throw
        parent.description = "Non-leaf preamble with qty (saved again)"
        parent.save(ignore_permissions=True)
        self.assertEqual(parent.description, "Non-leaf preamble with qty (saved again)")

    def test_preamble_set_amount_persists(self):
        """CAPTURE-ONLY: a preamble's written amount persists verbatim -- there is no
        compute to skip, and amount_override is no longer consulted for amounts."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Preamble amount persists"
        node.qty = 5
        node.supply_rate = 100
        node.total_amount = 123.0
        node.insert(ignore_permissions=True)
        self.assertEqual(node.total_amount, 123.0)

    # ------------------------------------------------------------------ #
    # Combined Rate consistency validation                                 #
    # ------------------------------------------------------------------ #

    def test_combined_rate_mismatch_warns_not_throws(self):
        """CAPTURE-ONLY (Slice 3b): combined_rate != supply+install now WARNS, not throws --
        the node SAVES and the captured values persist verbatim (tendering reconciles)."""
        node = self._make_line_item(
            qty=10, supply_rate=400, install_rate=200, combined_rate=700,
            description="Mismatched combined rate",
        )
        self.assertIsNotNone(node.name)
        self.assertEqual(node.combined_rate, 700)
        self.assertEqual(node.supply_rate, 400)
        self.assertEqual(node.install_rate, 200)

    def test_combined_rate_matches_supply_plus_install_succeeds(self):
        """STRUCTURAL: combined_rate == supply_rate + install_rate passes the consistency
        check and saves. (total_amount is no longer computed -- capture-only.)"""
        node = self._make_line_item(
            qty=10, supply_rate=400, install_rate=200, combined_rate=600,
            description="Exact match combined rate",
        )
        self.assertIsNotNone(node.name)

    def test_only_combined_rate_set_succeeds(self):
        """STRUCTURAL: only combined_rate set (no supply/install) -> no consistency check
        fires; the node saves. (total_amount is no longer computed -- capture-only.)"""
        node = self._make_line_item(
            qty=10, combined_rate=500,
            description="Only combined rate",
        )
        self.assertIsNotNone(node.name)

    def test_only_supply_install_set_succeeds(self):
        """STRUCTURAL: supply + install with no combined_rate -> no consistency check
        fires; the node saves. (total_amount is no longer computed -- capture-only.)"""
        node = self._make_line_item(
            qty=10, supply_rate=400, install_rate=200,
            description="Supply and install only",
        )
        self.assertIsNotNone(node.name)

    def test_combined_rate_zero_does_not_trigger_validation(self):
        """STRUCTURAL: combined_rate=0 is treated as not-set, so the consistency check
        does not fire and the node saves. (total_amount is no longer computed.)"""
        node = self._make_line_item(
            qty=10, supply_rate=400, install_rate=200, combined_rate=0,
            description="Zero combined rate",
        )
        self.assertIsNotNone(node.name)

    def test_leaf_preamble_combined_rate_mismatch_warns(self):
        """CAPTURE-ONLY (Slice 3b): a leaf preamble with mismatched combined_rate now WARNS,
        not throws -- the node SAVES."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Leaf preamble mismatched rate"
        node.qty = 10
        node.supply_rate = 400
        node.install_rate = 200
        node.combined_rate = 700
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)
        self.assertEqual(node.combined_rate, 700)

    # ------------------------------------------------------------------ #
    # Audit log (Nirmaan Versions)                                         #
    # ------------------------------------------------------------------ #

    def test_audit_entry_written_on_edit_with_reason(self):
        """
        Saving a node with edit_reason set must create a Nirmaan Versions
        entry recording the reason and the changed fields.

        _write_audit calls frappe.db.commit(), so the node and the audit
        entry are both committed. The finally block deletes them and
        commits the cleanup.
        """
        node = self._make_line_item(qty=5, supply_rate=100,
                                    description="Audit original")
        node_name = node.name

        node.description = "Audit updated"
        node.edit_reason = "Correcting description"
        node.save(ignore_permissions=True)

        audit_entries = frappe.get_all(
            "Nirmaan Versions",
            filters={"ref_doctype": "BOQ Nodes", "docname": node_name},
            fields=["name", "reason", "new_state", "data"],
        )

        try:
            self.assertEqual(len(audit_entries), 1)
            entry = audit_entries[0]
            self.assertEqual(entry.reason, "Correcting description")
            self.assertEqual(entry.new_state, "Edited")

            diff = json.loads(entry.data) if isinstance(entry.data, str) else entry.data
            changed_by_field = {c[0]: c for c in diff["changed"]}
            self.assertIn("description", changed_by_field)
            self.assertEqual(changed_by_field["description"][1], "Audit original")
            self.assertEqual(changed_by_field["description"][2], "Audit updated")
        finally:
            frappe.db.delete(
                "Nirmaan Versions",
                {"ref_doctype": "BOQ Nodes", "docname": node_name},
            )
            frappe.db.delete("BOQ Nodes", {"name": node_name})
            frappe.db.commit()

    def test_audit_entry_without_reason_defaults_to_desk_edit(self):
        """Saving with a tracked-field change but no edit_reason creates an audit entry with reason 'Desk edit'."""
        node = self._make_line_item(qty=5, supply_rate=100,
                                    description="No reason test")
        node_name = node.name

        node.description = "No reason updated"
        # edit_reason intentionally not set — must default to "Desk edit"
        node.save(ignore_permissions=True)

        audit_entries = frappe.get_all(
            "Nirmaan Versions",
            filters={"ref_doctype": "BOQ Nodes", "docname": node_name},
            fields=["name", "reason"],
        )
        try:
            self.assertEqual(len(audit_entries), 1)
            self.assertEqual(audit_entries[0].reason, "Desk edit")
        finally:
            frappe.db.delete(
                "Nirmaan Versions",
                {"ref_doctype": "BOQ Nodes", "docname": node_name},
            )
            frappe.db.delete("BOQ Nodes", {"name": node_name})
            frappe.db.commit()

    def test_audit_entry_not_written_on_initial_insert(self):
        """
        Setting edit_reason on a new doc before insert() must not produce
        an audit entry. on_update skips audit when old_doc is None (first
        insert), regardless of whether edit_reason is set.
        """
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Insert with reason test"
        node.parent_node = self.default_preamble
        node.qty = 5
        node.supply_rate = 100
        node.edit_reason = "Initial setup"  # set before insert — must be ignored
        node.insert(ignore_permissions=True)

        audit_entries = frappe.get_all(
            "Nirmaan Versions",
            filters={"ref_doctype": "BOQ Nodes", "docname": node.name},
            fields=["name"],
        )
        try:
            self.assertEqual(len(audit_entries), 0)
        finally:
            if audit_entries:
                frappe.db.delete(
                    "Nirmaan Versions",
                    {"ref_doctype": "BOQ Nodes", "docname": node.name},
                )
                frappe.db.delete("BOQ Nodes", {"name": node.name})
                frappe.db.commit()

    # ------------------------------------------------------------------ #
    # on_trash guard                                                       #
    # ------------------------------------------------------------------ #

    def test_cannot_delete_node_from_approved_boq(self):
        """
        Deleting a node linked to an Approved BoQ must raise ValidationError.
        Both the BOQ and node are created within this test's transaction and
        are rolled back by tearDown (no commit is called on the happy path
        since the delete throws before completing).
        """
        approved_boq = frappe.new_doc("BOQs")
        approved_boq.project = _TEST_PROJECT
        approved_boq.boq_name = "Approved BoQ Trash Test"
        approved_boq.insert(ignore_permissions=True, ignore_links=True)
        frappe.db.set_value("BOQs", approved_boq.name, "status", "Approved")

        sheet = frappe.new_doc("BoQ Sheet")
        sheet.boq = approved_boq.name
        sheet.sheet_name = "_TEST_APPROVED"
        sheet.sheet_order = 1
        sheet.insert(ignore_permissions=True)

        node = frappe.new_doc("BOQ Nodes")
        node.sheet = sheet.name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Node in approved BoQ"
        node.insert(ignore_permissions=True)

        with self.assertRaises(frappe.ValidationError):
            frappe.delete_doc("BOQ Nodes", node.name, ignore_permissions=True)

    def test_can_delete_node_from_draft_boq(self):
        """
        Deleting a node from a Draft BoQ must succeed — the on_trash guard
        only blocks Approved BoQs. The setUpClass BoQ is in Draft status.
        """
        node = self._make_preamble(level=1, description="Delete from draft BoQ")
        node_name = node.name

        frappe.delete_doc("BOQ Nodes", node_name, ignore_permissions=True)

        self.assertFalse(frappe.db.exists("BOQ Nodes", node_name))

    # ------------------------------------------------------------------ #
    # Group D — qty_by_area validation (7 tests)                         #
    # ------------------------------------------------------------------ #

    def test_qty_by_area_duplicate_area_name_rejected(self):
        """Two rows sharing the same area_name must raise ValidationError."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Duplicate area names"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.append("qty_by_area", {"area_name": "B1", "qty": 5})
        node.append("qty_by_area", {"area_name": "B1", "qty": 5})
        with self.assertRaises(frappe.ValidationError):
            node.insert(ignore_permissions=True)

    def test_qty_by_area_sum_matches_qty_saves_without_error(self):
        """Sum of qty_by_area rows equal to qty must save without error."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Matching qty_by_area sum"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.append("qty_by_area", {"area_name": "B1", "qty": 6})
        node.append("qty_by_area", {"area_name": "B2", "qty": 4})
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)

    def test_qty_by_area_sum_mismatch_warns_but_saves(self):
        """Sum of qty_by_area != qty emits a warning but must not block save."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Mismatched qty_by_area sum"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.append("qty_by_area", {"area_name": "B1", "qty": 3})
        node.insert(ignore_permissions=True)  # sum=3, qty=10 → warning only
        self.assertIsNotNone(node.name)

    def test_qty_by_area_empty_table_saves_fine(self):
        """No qty_by_area rows — must save without error."""
        node = self._make_line_item(qty=10, supply_rate=100,
                                    description="No qty_by_area rows")
        self.assertIsNotNone(node.name)

    def test_qty_by_area_no_boq_dimensions_no_area_warning(self):
        """BOQ has no area_dimensions set — undeclared-area check must not fire."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name  # shared BOQ has no area_dimensions
        node.node_type = "Line Item"
        node.description = "BOQ without dims"
        node.parent_node = self.default_preamble
        node.qty = 5
        node.append("qty_by_area", {"area_name": "AnyArea", "qty": 5})
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)

    def test_qty_by_area_undeclared_area_warns_but_saves(self):
        """area_name absent from BOQ's area_dimensions fires a warning but must not block save."""
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = "Area Dims Warn Test BoQ"
        boq.area_dimensions = '["B1", "B2"]'
        boq.insert(ignore_permissions=True, ignore_links=True)

        sheet = frappe.new_doc("BoQ Sheet")
        sheet.boq = boq.name
        sheet.sheet_name = "_TEST_WARN"
        sheet.sheet_order = 1
        sheet.insert(ignore_permissions=True)

        preamble = frappe.new_doc("BOQ Nodes")
        preamble.sheet = sheet.name
        preamble.node_type = "Preamble"
        preamble.level = 1
        preamble.description = "Preamble for undeclared area test"
        preamble.insert(ignore_permissions=True)

        node = frappe.new_doc("BOQ Nodes")
        node.sheet = sheet.name
        node.node_type = "Line Item"
        node.description = "Node with undeclared area"
        node.parent_node = preamble.name
        node.qty = 5
        node.append("qty_by_area", {"area_name": "B3", "qty": 5})
        node.insert(ignore_permissions=True)  # B3 not in [B1, B2] → warning only
        self.assertIsNotNone(node.name)

    def test_qty_by_area_declared_area_saves_cleanly(self):
        """area_name present in BOQ's area_dimensions — must save without any warning."""
        boq = frappe.new_doc("BOQs")
        boq.project = _TEST_PROJECT
        boq.boq_name = "Area Dims Clean Test BoQ"
        boq.area_dimensions = '["B1", "B2"]'
        boq.insert(ignore_permissions=True, ignore_links=True)

        sheet = frappe.new_doc("BoQ Sheet")
        sheet.boq = boq.name
        sheet.sheet_name = "_TEST_CLEAN"
        sheet.sheet_order = 1
        sheet.insert(ignore_permissions=True)

        preamble = frappe.new_doc("BOQ Nodes")
        preamble.sheet = sheet.name
        preamble.node_type = "Preamble"
        preamble.level = 1
        preamble.description = "Preamble for declared area test"
        preamble.insert(ignore_permissions=True)

        node = frappe.new_doc("BOQ Nodes")
        node.sheet = sheet.name
        node.node_type = "Line Item"
        node.description = "Node with declared area"
        node.parent_node = preamble.name
        node.qty = 5
        node.append("qty_by_area", {"area_name": "B1", "qty": 5})
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)

    # ------------------------------------------------------------------ #
    # Group E — make_model (3 tests)                                     #
    # ------------------------------------------------------------------ #

    def test_make_model_persists(self):
        """Setting make_model on insert must persist the value."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Make model test"
        node.parent_node = self.default_preamble
        node.qty = 5
        node.supply_rate = 100
        node.make_model = "Brand XYZ / Model ABC"
        node.insert(ignore_permissions=True)
        self.assertEqual(node.make_model, "Brand XYZ / Model ABC")

    def test_make_model_null_is_valid(self):
        """make_model not set must save without error."""
        node = self._make_line_item(qty=5, supply_rate=100,
                                    description="No make_model")
        self.assertFalse(node.make_model)

    def test_make_model_update_persists(self):
        """Updating make_model after initial save must persist the new value."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Make model update test"
        node.parent_node = self.default_preamble
        node.qty = 5
        node.insert(ignore_permissions=True)
        node.make_model = "Updated Brand / Model"
        node.save(ignore_permissions=True)
        self.assertEqual(node.make_model, "Updated Brand / Model")

    # ------------------------------------------------------------------ #
    # Group F — Phase 1.8: qty_by_area rates, amounts, audit (11 tests)  #
    # ------------------------------------------------------------------ #

    def test_qty_by_area_supply_rate_not_inherited(self):
        """CAPTURE-ONLY: a child with a blank supply_rate STAYS blank -- it does NOT
        inherit the parent's rate (the rate-fallback compute was removed)."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Supply rate not inherited test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.supply_rate = 100
        node.append("qty_by_area", {"area_name": "B1", "qty": 10})
        node.insert(ignore_permissions=True)
        self.assertIsNone(node.qty_by_area[0].supply_rate)

    def test_qty_by_area_install_rate_not_inherited(self):
        """CAPTURE-ONLY: a child with a blank install_rate STAYS blank (no inheritance)."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Install rate not inherited test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.install_rate = 50
        node.append("qty_by_area", {"area_name": "B1", "qty": 10})
        node.insert(ignore_permissions=True)
        self.assertIsNone(node.qty_by_area[0].install_rate)

    def test_qty_by_area_combined_rate_not_inherited(self):
        """CAPTURE-ONLY: a child with a blank combined_rate STAYS blank (no inheritance)."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Combined rate not inherited test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.combined_rate = 150
        node.append("qty_by_area", {"area_name": "B1", "qty": 10})
        node.insert(ignore_permissions=True)
        self.assertIsNone(node.qty_by_area[0].combined_rate)

    def test_parent_supply_rate_persists_when_per_area_diverges(self):
        """CAPTURE-ONLY: a written parent supply_rate is NOT overwritten by a per-area
        weighted average, even when the child rows' supply_rates diverge."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Supply rate persists test"
        node.parent_node = self.default_preamble
        node.qty = 30
        node.supply_rate = 150
        node.append("qty_by_area", {"area_name": "B1", "qty": 10, "supply_rate": 100})
        node.append("qty_by_area", {"area_name": "B2", "qty": 20, "supply_rate": 200})
        node.insert(ignore_permissions=True)
        # The weighted average would be 166.67; capture-only keeps the written 150.
        self.assertAlmostEqual(node.supply_rate, 150.0, places=2)

    def test_parent_install_rate_persists_when_per_area_diverges(self):
        """CAPTURE-ONLY: written parent supply_rate AND install_rate both persist even
        when the child rows' install_rates diverge (no weighted-average overwrite)."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Install rate persists test"
        node.parent_node = self.default_preamble
        node.qty = 30
        node.supply_rate = 100
        node.install_rate = 50
        node.append("qty_by_area", {"area_name": "B1", "qty": 10, "install_rate": 40})
        node.append("qty_by_area", {"area_name": "B2", "qty": 20, "install_rate": 70})
        node.insert(ignore_permissions=True)
        # Weighted avg would be 60; capture-only keeps the written 50 (and 100).
        self.assertAlmostEqual(node.install_rate, 50.0, places=2)
        self.assertAlmostEqual(node.supply_rate, 100.0, places=2)

    def test_parent_combined_rate_persists_when_per_area_diverges(self):
        """CAPTURE-ONLY: a written parent combined_rate persists when the child rows'
        combined_rates diverge (no weighted-average overwrite)."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Combined rate persists test"
        node.parent_node = self.default_preamble
        node.qty = 30
        node.combined_rate = 150
        node.append("qty_by_area", {"area_name": "B1", "qty": 10, "combined_rate": 100})
        node.append("qty_by_area", {"area_name": "B2", "qty": 20, "combined_rate": 200})
        node.insert(ignore_permissions=True)
        # Weighted avg would be 166.67; capture-only keeps the written 150.
        self.assertAlmostEqual(node.combined_rate, 150.0, places=2)

    def test_child_combined_rate_consistency_rule_accepted_when_correct_sum(self):
        """Child row with combined_rate == supply_rate + install_rate saves without error."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Combined rate consistency valid test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.append("qty_by_area", {
            "area_name": "B1", "qty": 10,
            "supply_rate": 50, "install_rate": 30, "combined_rate": 80,
        })
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)

    def test_child_combined_rate_mismatch_warns_not_throws(self):
        """CAPTURE-ONLY (Slice 3b): a child row with combined_rate != supply+install now
        WARNS, not throws -- the node SAVES and the per-area rates persist verbatim."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Combined rate consistency invalid test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.append("qty_by_area", {
            "area_name": "B1", "qty": 10,
            "supply_rate": 50, "install_rate": 30, "combined_rate": 100,
        })
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)
        self.assertEqual(node.qty_by_area[0].combined_rate, 100)

    def test_child_zero_cost_row_allowed_when_all_rates_none(self):
        """CAPTURE-ONLY: a child row with no rates saves and its rates STAY None -- no
        compute fills them (the rate-fallback was removed)."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Zero cost child row test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.append("qty_by_area", {"area_name": "B1", "qty": 10})
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)
        row = node.qty_by_area[0]
        self.assertIsNone(row.supply_rate)
        self.assertIsNone(row.install_rate)
        self.assertIsNone(row.combined_rate)

    def test_child_amounts_persist_verbatim(self):
        """CAPTURE-ONLY: a child's written supply_amount persists UNCHANGED (no
        amount_override needed) even though qty x rate would be 1000 -- the child amount
        compute was removed."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Child amounts persist verbatim test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.supply_rate = 100
        node.append("qty_by_area", {
            "area_name": "B1", "qty": 10,
            "supply_rate": 100, "supply_amount": 999,
        })
        node.insert(ignore_permissions=True)
        self.assertEqual(node.qty_by_area[0].supply_amount, 999)

    def test_make_model_edit_generates_nirmaan_versions_audit_entry(self):
        """Editing make_model with edit_reason creates a Nirmaan Versions audit entry with the diff."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Make model audit test"
        node.parent_node = self.default_preamble
        node.qty = 5
        node.supply_rate = 100
        node.make_model = "Brand X"
        node.insert(ignore_permissions=True)
        node_name = node.name

        node.make_model = "Brand Y"
        node.edit_reason = "Updating brand specification"
        node.save(ignore_permissions=True)

        audit_entries = frappe.get_all(
            "Nirmaan Versions",
            filters={"ref_doctype": "BOQ Nodes", "docname": node_name},
            fields=["name", "data"],
        )

        try:
            self.assertEqual(len(audit_entries), 1)
            diff = json.loads(audit_entries[0].data) if isinstance(audit_entries[0].data, str) else audit_entries[0].data
            changed_by_field = {c[0]: c for c in diff["changed"]}
            self.assertIn("make_model", changed_by_field)
            self.assertEqual(changed_by_field["make_model"][1], "Brand X")
            self.assertEqual(changed_by_field["make_model"][2], "Brand Y")
        finally:
            frappe.db.delete(
                "Nirmaan Versions",
                {"ref_doctype": "BOQ Nodes", "docname": node_name},
            )
            frappe.db.delete("BOQ Nodes", {"name": node_name})
            frappe.db.commit()

    def test_audit_entry_not_written_when_no_fields_change(self):
        """Saving a node without changing any tracked field must not create an audit entry."""
        node = self._make_line_item(qty=5, supply_rate=100,
                                    description="No change audit test")
        node_name = node.name

        # Save with no tracked-field changes — _write_audit returns early on empty diff
        node.save(ignore_permissions=True)

        audit_entries = frappe.get_all(
            "Nirmaan Versions",
            filters={"ref_doctype": "BOQ Nodes", "docname": node_name},
            fields=["name"],
        )
        self.assertEqual(len(audit_entries), 0)

    # ------------------------------------------------------------------ #
    # Group G — Phase 1.8.1: F1 per-child partial-rate guard (2 tests)   #
    # ------------------------------------------------------------------ #

    def test_child_supply_only_no_consistency_error(self):
        """Child row with supply_rate set but install_rate=None, combined_rate=None saves without error."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Supply only partial rate"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.append("qty_by_area", {"area_name": "B1", "qty": 10, "supply_rate": 100})
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)
        self.assertIsNone(node.qty_by_area[0].install_rate)
        self.assertIsNone(node.qty_by_area[0].combined_rate)

    def test_child_install_only_no_consistency_error(self):
        """Child row with install_rate set but supply_rate=None, combined_rate=None saves without error."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Install only partial rate"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.append("qty_by_area", {"area_name": "B1", "qty": 10, "install_rate": 50})
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)
        self.assertIsNone(node.qty_by_area[0].supply_rate)
        self.assertIsNone(node.qty_by_area[0].combined_rate)

    # ------------------------------------------------------------------ #
    # Group H — Phase 4 P4-4: human-layer, edit-provenance, remarks,     #
    # attached_notes storage fields (7 tests). Storage only; no controller #
    # logic populates these yet (the commit pipeline is Phase 5).          #
    # ------------------------------------------------------------------ #

    def test_human_layer_fields_persist(self):
        """human_classification / human_parent / human_is_root persist round-trip."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Human layer test"
        node.human_classification = "note"
        node.human_parent = 5
        node.human_is_root = 1
        node.insert(ignore_permissions=True)

        reloaded = frappe.get_doc("BOQ Nodes", node.name)
        self.assertEqual(reloaded.human_classification, "note")
        self.assertEqual(reloaded.human_parent, 5)
        self.assertEqual(reloaded.human_is_root, 1)

    def test_human_parent_negative_sentinel_persists(self):
        """human_parent=-1 (the no-override sentinel) is a real stored value, not 'empty'."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Sentinel persistence test"
        node.human_parent = -1
        node.insert(ignore_permissions=True)

        reloaded = frappe.get_doc("BOQ Nodes", node.name)
        self.assertEqual(reloaded.human_parent, -1)

    def test_edited_by_at_persist(self):
        """edited_by (Data) + edited_at (Datetime) persist round-trip."""
        stamp = frappe.utils.now()
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Edited provenance test"
        node.edited_by = "tester@nirmaan.app"
        node.edited_at = stamp
        node.insert(ignore_permissions=True)

        reloaded = frappe.get_doc("BOQ Nodes", node.name)
        self.assertEqual(reloaded.edited_by, "tester@nirmaan.app")
        self.assertIsNotNone(reloaded.edited_at)

    def test_remarks_persist(self):
        """remarks (Small Text) persists round-trip."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Remarks test"
        node.remarks = "Checked against drawing rev-2; qty confirmed."
        node.insert(ignore_permissions=True)

        reloaded = frappe.get_doc("BOQ Nodes", node.name)
        self.assertEqual(reloaded.remarks, "Checked against drawing rev-2; qty confirmed.")

    def test_edit_log_json_round_trip(self):
        """edit_log stores the rich review-side shape opaquely, incl. a per-area entry
        carrying area + rate_subkey -- read back unchanged."""
        log = [
            {"field": "qty", "from": 1, "to": 2, "by": "u", "at": "2026-06-16 10:00:00", "reason": "fix"},
            {"field": "rate_by_area", "area": "Phase 1", "rate_subkey": "supply",
             "from": 0, "to": 9, "by": "u", "at": "2026-06-16 10:01:00", "reason": "x"},
        ]
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Edit log round-trip test"
        # list-JSON caveat: a JSON field rejects a raw Python list on insert; pre-serialize.
        node.edit_log = json.dumps(log)
        node.insert(ignore_permissions=True)

        reloaded = frappe.get_doc("BOQ Nodes", node.name)
        stored = reloaded.edit_log
        if isinstance(stored, str):
            stored = json.loads(stored)
        self.assertEqual(stored, log)
        # explicit proof the per-area sub-keys survived opaquely
        self.assertEqual(stored[1]["area"], "Phase 1")
        self.assertEqual(stored[1]["rate_subkey"], "supply")

    def test_attached_notes_json_round_trip(self):
        """attached_notes stores a structured list opaquely -- read back unchanged."""
        notes = ["See general spec clause 4.2", "Excludes painting", "Ref drawing A-101"]
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Attached notes round-trip test"
        node.attached_notes = json.dumps(notes)
        node.insert(ignore_permissions=True)

        reloaded = frappe.get_doc("BOQ Nodes", node.name)
        stored = reloaded.attached_notes
        if isinstance(stored, str):
            stored = json.loads(stored)
        self.assertEqual(stored, notes)

    def test_new_fields_absent_do_not_break_existing_save(self):
        """A node with NONE of the 8 new fields set still saves cleanly (all optional)."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "No new fields set"
        node.parent_node = self.default_preamble
        node.qty = 5
        node.supply_rate = 100
        node.insert(ignore_permissions=True)
        self.assertIsNotNone(node.name)
        # the new fields default to empty/None, not erroring
        self.assertFalse(node.human_classification)
        self.assertFalse(node.remarks)
        self.assertFalse(node.attached_notes)
        self.assertEqual(node.human_is_root, 0)
