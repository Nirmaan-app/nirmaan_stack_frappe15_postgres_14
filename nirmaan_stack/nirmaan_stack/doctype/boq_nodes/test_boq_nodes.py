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
    # validate: Preamble level rules                                       #
    # ------------------------------------------------------------------ #

    def test_preamble_level_zero_rejected(self):
        """Level 0 is not a positive integer and must be rejected."""
        with self.assertRaises(frappe.ValidationError):
            node = frappe.new_doc("BOQ Nodes")
            node.sheet = self.sheet_name
            node.node_type = "Preamble"
            node.level = 0
            node.description = "Bad level"
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

    # ------------------------------------------------------------------ #
    # is_rate_only auto-computation                                        #
    # ------------------------------------------------------------------ #

    def test_is_rate_only_auto_set_for_zero_qty_with_rate(self):
        """qty=0 plus at least one rate → is_rate_only must be set to 1."""
        node = self._make_line_item(qty=0, supply_rate=100,
                                    description="Rate only auto-set")
        self.assertEqual(node.is_rate_only, 1)

    def test_is_rate_only_zero_when_qty_positive(self):
        """qty > 0 → is_rate_only stays 0 regardless of rates."""
        node = self._make_line_item(qty=5, supply_rate=100,
                                    description="Not rate only")
        self.assertEqual(node.is_rate_only, 0)

    def test_is_rate_only_zero_when_no_rate_set(self):
        """qty=0 but no rate fields set → is_rate_only stays 0."""
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

    def test_l3_preamble_parent_must_be_l2_preamble(self):
        """L3 whose parent is an L1 preamble (skipping L2) must be rejected."""
        l1 = self._make_preamble(level=1, description="L1 for L3 parent test")
        with self.assertRaises(frappe.ValidationError):
            node = frappe.new_doc("BOQ Nodes")
            node.sheet = self.sheet_name
            node.node_type = "Preamble"
            node.level = 3
            node.description = "L3 with L1 parent (wrong)"
            node.parent_node = l1.name
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
        self.assertEqual(node.total_amount, 500.0)

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
    # Amount auto-computation                                              #
    # ------------------------------------------------------------------ #

    def test_amount_supply_only(self):
        node = self._make_line_item(qty=10, supply_rate=100,
                                    description="Supply only")
        self.assertEqual(node.supply_amount, 1000.0)
        self.assertIsNone(node.install_amount)
        self.assertEqual(node.total_amount, 1000.0)

    def test_amount_install_only(self):
        node = self._make_line_item(qty=4, install_rate=50,
                                    description="Install only")
        self.assertIsNone(node.supply_amount)
        self.assertEqual(node.install_amount, 200.0)
        self.assertEqual(node.total_amount, 200.0)

    def test_amount_combined_rate(self):
        node = self._make_line_item(qty=5, combined_rate=200,
                                    description="Combined rate")
        self.assertIsNone(node.supply_amount)
        self.assertIsNone(node.install_amount)
        self.assertEqual(node.total_amount, 1000.0)

    def test_amount_supply_and_install(self):
        node = self._make_line_item(qty=3, supply_rate=100, install_rate=50,
                                    description="Supply and install")
        self.assertEqual(node.supply_amount, 300.0)
        self.assertEqual(node.install_amount, 150.0)
        self.assertEqual(node.total_amount, 450.0)

    def test_amount_override_preserves_manually_set_values(self):
        """With amount_override=1, _compute_amounts must not touch the amounts."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Amount override test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.supply_rate = 100
        node.supply_amount = 999.0
        node.total_amount = 999.0
        node.amount_override = 1
        node.insert(ignore_permissions=True)
        self.assertEqual(node.supply_amount, 999.0)
        self.assertEqual(node.total_amount, 999.0)

    def test_leaf_preamble_with_qty_and_rate_computes_amounts(self):
        """
        A leaf preamble (no children) with qty and supply_rate set must have
        amounts computed — the old node_type guard has been removed.
        """
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Leaf preamble with amounts"
        node.qty = 5
        node.supply_rate = 100
        node.insert(ignore_permissions=True)
        self.assertEqual(node.supply_amount, 500.0)
        self.assertEqual(node.total_amount, 500.0)

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

    def test_amount_override_skips_computation_for_preamble(self):
        """With amount_override=1, _compute_amounts returns early for any node type."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Preamble"
        node.level = 1
        node.description = "Preamble with override"
        node.qty = 5
        node.supply_rate = 100
        node.amount_override = 1
        node.insert(ignore_permissions=True)
        self.assertIsNone(node.supply_amount)
        self.assertIsNone(node.total_amount)

    # ------------------------------------------------------------------ #
    # Combined Rate consistency validation                                 #
    # ------------------------------------------------------------------ #

    def test_combined_rate_must_match_supply_plus_install(self):
        """combined_rate != supply_rate + install_rate must be rejected."""
        with self.assertRaises(frappe.ValidationError):
            self._make_line_item(
                qty=10, supply_rate=400, install_rate=200, combined_rate=700,
                description="Mismatched combined rate",
            )

    def test_combined_rate_matches_supply_plus_install_succeeds(self):
        """combined_rate == supply_rate + install_rate must save; total uses combined path."""
        node = self._make_line_item(
            qty=10, supply_rate=400, install_rate=200, combined_rate=600,
            description="Exact match combined rate",
        )
        self.assertEqual(node.total_amount, 6000.0)

    def test_only_combined_rate_set_succeeds(self):
        """Only combined_rate set (no supply/install): no consistency check fires."""
        node = self._make_line_item(
            qty=10, combined_rate=500,
            description="Only combined rate",
        )
        self.assertEqual(node.total_amount, 5000.0)

    def test_only_supply_install_set_succeeds(self):
        """supply_rate + install_rate with no combined_rate: no consistency check fires."""
        node = self._make_line_item(
            qty=10, supply_rate=400, install_rate=200,
            description="Supply and install only",
        )
        self.assertEqual(node.total_amount, 6000.0)

    def test_combined_rate_zero_does_not_trigger_validation(self):
        """combined_rate=0 is treated as not-set; supply+install path is used for total."""
        node = self._make_line_item(
            qty=10, supply_rate=400, install_rate=200, combined_rate=0,
            description="Zero combined rate",
        )
        self.assertEqual(node.total_amount, 6000.0)

    def test_leaf_preamble_combined_rate_validation(self):
        """Rate consistency check fires for leaf preambles with mismatched combined_rate."""
        with self.assertRaises(frappe.ValidationError):
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

    def test_qty_by_area_supply_rate_fallback_from_parent(self):
        """Child row with no supply_rate set inherits parent supply_rate on save."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Supply rate fallback test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.supply_rate = 100
        node.append("qty_by_area", {"area_name": "B1", "qty": 10})
        node.insert(ignore_permissions=True)
        self.assertEqual(node.qty_by_area[0].supply_rate, 100.0)

    def test_qty_by_area_install_rate_fallback_from_parent(self):
        """Child row with no install_rate set inherits parent install_rate on save."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Install rate fallback test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.install_rate = 50
        node.append("qty_by_area", {"area_name": "B1", "qty": 10})
        node.insert(ignore_permissions=True)
        self.assertEqual(node.qty_by_area[0].install_rate, 50.0)

    def test_qty_by_area_combined_rate_fallback_from_parent(self):
        """Child row with no combined_rate set inherits parent combined_rate on save."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Combined rate fallback test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.combined_rate = 150
        node.append("qty_by_area", {"area_name": "B1", "qty": 10})
        node.insert(ignore_permissions=True)
        self.assertEqual(node.qty_by_area[0].combined_rate, 150.0)

    def test_parent_supply_rate_weighted_average_when_per_area_diverges(self):
        """When per-area supply_rates diverge, parent supply_rate becomes weighted average."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Supply rate weighted avg test"
        node.parent_node = self.default_preamble
        node.qty = 30
        node.append("qty_by_area", {"area_name": "B1", "qty": 10, "supply_rate": 100})
        node.append("qty_by_area", {"area_name": "B2", "qty": 20, "supply_rate": 200})
        node.insert(ignore_permissions=True)
        # Expected: (10*100 + 20*200) / 30 = 5000/30 = 166.666...
        self.assertAlmostEqual(node.supply_rate, (10 * 100 + 20 * 200) / 30, places=2)

    def test_parent_install_rate_weighted_average_independent_of_supply(self):
        """install_rate weighted-avg fires for divergent per-area values; uniform supply_rate unchanged."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Install rate independent weighted avg test"
        node.parent_node = self.default_preamble
        node.qty = 30
        node.supply_rate = 100  # uniform — child rows get this via fallback → no weighted avg
        node.install_rate = 50  # diverges across areas → becomes weighted avg
        node.append("qty_by_area", {"area_name": "B1", "qty": 10, "install_rate": 40})
        node.append("qty_by_area", {"area_name": "B2", "qty": 20, "install_rate": 70})
        node.insert(ignore_permissions=True)
        # install_rate weighted avg: (10*40 + 20*70) / 30 = 1800/30 = 60.0
        self.assertAlmostEqual(node.install_rate, 60.0, places=2)
        # supply_rate: both child rows get 100 via fallback (uniform) → parent unchanged
        self.assertAlmostEqual(node.supply_rate, 100.0, places=2)

    def test_parent_combined_rate_weighted_average_independent(self):
        """combined_rate weighted-avg runs independently of supply/install rates."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Combined rate independent weighted avg test"
        node.parent_node = self.default_preamble
        node.qty = 30
        node.append("qty_by_area", {"area_name": "B1", "qty": 10, "combined_rate": 100})
        node.append("qty_by_area", {"area_name": "B2", "qty": 20, "combined_rate": 200})
        node.insert(ignore_permissions=True)
        # Expected: (10*100 + 20*200) / 30 = 5000/30 = 166.666...
        self.assertAlmostEqual(node.combined_rate, (10 * 100 + 20 * 200) / 30, places=2)

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

    def test_child_combined_rate_consistency_rule_rejected_when_wrong_sum(self):
        """Child row with combined_rate != supply_rate + install_rate raises ValidationError."""
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
        with self.assertRaises(frappe.ValidationError):
            node.insert(ignore_permissions=True)

    def test_child_zero_cost_row_allowed_when_all_rates_none(self):
        """Child row with no rates saves without error; rates remain None when parent also has none."""
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

    def test_child_amount_override_skips_auto_compute(self):
        """Child row with amount_override=1 keeps manually set supply_amount unchanged."""
        node = frappe.new_doc("BOQ Nodes")
        node.sheet = self.sheet_name
        node.node_type = "Line Item"
        node.description = "Child amount override test"
        node.parent_node = self.default_preamble
        node.qty = 10
        node.supply_rate = 100
        node.append("qty_by_area", {
            "area_name": "B1", "qty": 10,
            "supply_rate": 100, "supply_amount": 999, "amount_override": 1,
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
