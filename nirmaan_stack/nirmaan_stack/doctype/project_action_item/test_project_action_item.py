# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

import frappe
from frappe.database.database import savepoint
from frappe.exceptions import DuplicateEntryError, UniqueValidationError
from frappe.tests.utils import FrappeTestCase

# A duplicate dedup_key can surface as EITHER:
#   - UniqueValidationError -- when Frappe's in-app pre-check (validate_set_fields /
#     show_unique_validation_message) catches the clash before the INSERT, or
#   - DuplicateEntryError   -- when the DB unique index rejects the INSERT directly.
# The two are unrelated in the class hierarchy (UniqueValidationError <- ValidationError;
# DuplicateEntryError <- NameError), so the reconciler's savepoint get-or-create must
# catch BOTH. This Phase-0 test mirrors that.
_DUP_ERRORS = (UniqueValidationError, DuplicateEntryError)


class TestProjectActionItem(FrappeTestCase):
    """
    Phase-0 schema tests for the Project Action Item doctype.

    Project Action Item is a STANDALONE top-level doctype (istable=0) -- the
    durable, recompute-from-truth projection of pending per-PO obligations.
    It is SYSTEM-OWNED: the reconciler writes rows via ignore_permissions; the
    controller is a bare stub (no lifecycle hooks).

    These tests prove the two foundational schema guarantees Phase 1 depends on:
      1. the PAI- autoname prefix, and
      2. the UNIQUE index on dedup_key (the idempotency key that lets the
         reconciler run concurrently without DuplicateError escaping).

    A shared Projects row is created in setUpClass (committed) to satisfy the
    reqd `project` Link; Project Action Item inserts inside each test are NOT
    committed, so FrappeTestCase's tearDown rollback cleans them up.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Projects.after_insert -> generate_pwm requires start/end dates in
        # "YYYY-MM-DD HH:MM:SS" form and project_scopes as a {"scopes": ...} dict.
        project = frappe.new_doc("Projects")
        project.project_name = f"_TEST_PAI_PROJECT_{frappe.generate_hash(length=6)}"
        project.project_start_date = frappe.utils.now()[:19]
        project.project_end_date = frappe.utils.add_to_date(
            frappe.utils.now()[:19], years=1
        )[:19]
        project.project_scopes = {"scopes": []}
        project.insert(ignore_permissions=True)
        cls.project_name = project.name
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "project_name"):
            frappe.db.delete("Project Action Item", {"project": cls.project_name})
            frappe.delete_doc(
                "Projects", cls.project_name, force=True, ignore_permissions=True
            )
            frappe.db.commit()
        super().tearDownClass()

    # ------------------------------------------------------------------ #
    # Helper                                                             #
    # ------------------------------------------------------------------ #

    def _make_item(self, reference_name="PO/0001", action_type="DN_PENDING", **kwargs):
        item = frappe.new_doc("Project Action Item")
        item.project = self.project_name
        item.action_type = action_type
        item.reference_doctype = "Procurement Orders"
        item.reference_name = reference_name
        item.status = "Open"
        item.dedup_key = f"{self.project_name}::{reference_name}::{action_type}"
        for k, v in kwargs.items():
            setattr(item, k, v)
        # ignore_links: the Dynamic Link reference_name points at real PO
        # docnames in production, written by the reconciler with
        # ignore_permissions; a Phase-0 schema test should not be coupled to
        # creating a full Procurement Orders fixture.
        item.insert(ignore_permissions=True, ignore_links=True)
        return item

    # ------------------------------------------------------------------ #
    # 1. Creation + PAI- autoname prefix                                 #
    # ------------------------------------------------------------------ #

    def test_create_and_autoname_prefix(self):
        item = self._make_item()
        self.assertIsNotNone(item.name)
        self.assertTrue(
            item.name.startswith("PAI-"),
            f"autoname should start with 'PAI-', got {item.name!r}",
        )
        self.assertEqual(item.project, self.project_name)
        self.assertEqual(item.action_type, "DN_PENDING")
        self.assertEqual(item.status, "Open")
        # default applied
        self.assertEqual(item.source, "reconcile")

        reloaded = frappe.get_doc("Project Action Item", item.name)
        self.assertEqual(
            reloaded.dedup_key,
            f"{self.project_name}::PO/0001::DN_PENDING",
        )

    # ------------------------------------------------------------------ #
    # 2. UNIQUE index on dedup_key -- second insert must raise            #
    # ------------------------------------------------------------------ #

    def test_duplicate_dedup_key_rejected(self):
        # First row inserts cleanly.
        first = self._make_item(reference_name="PO/0002", action_type="DC_PENDING")
        self.assertIsNotNone(first.name)

        dedup = f"{self.project_name}::PO/0002::DC_PENDING"
        self.assertEqual(
            frappe.db.count("Project Action Item", {"dedup_key": dedup}), 1
        )

        # A second row carrying the SAME dedup_key must be rejected by the
        # unique index. On PostgreSQL the integrity error poisons the
        # surrounding transaction, so the insert is wrapped in the official
        # Frappe savepoint context manager (exactly the get-or-create pattern
        # the reconciler will use) -- it rolls back to its savepoint on the
        # duplicate error, recovering the transaction so teardown can run.
        raised = False
        try:
            with savepoint(catch=_DUP_ERRORS):
                self._make_item(reference_name="PO/0002", action_type="DC_PENDING")
        except _DUP_ERRORS:
            # Re-raised if it slipped the catch -- should not happen.
            raised = True
        self.assertFalse(raised, "savepoint context should have caught the dup")

        # Proof the unique index held: still exactly one row for that key.
        self.assertEqual(
            frappe.db.count("Project Action Item", {"dedup_key": dedup}),
            1,
            "duplicate dedup_key must not have created a second row",
        )
