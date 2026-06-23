# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Phase-2 tests for the Project Action Item EVENT HOOKS (doc_hooks.py).

These prove the timeliness layer's contract WITHOUT touching the heavy host
controllers: `frappe.enqueue` is monkeypatched to CAPTURE its call kwargs, and the
thin hook fns are called directly with lightweight stub docs. We assert:

  * a PO/DN/DC change enqueues a reconcile for the right project with
    enqueue_after_commit=True, deduplicate=True, and job_id="pai::{project}";
  * an ITM-parented DN/DC change does NOT enqueue (out of v1 scope);
  * a blank/None/legacy link is a no-op AND never raises (must not break a save);
  * the enqueue itself NEVER raises out of the hook even if frappe.enqueue blows up
    (the §2 invariant 6 "never break a host save" guarantee).

A single real Projects + PO fixture is created so the PO→project resolution
(`frappe.db.get_value`) used by the DN/PDD hooks runs against a true row.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.action_items import doc_hooks


class _StubDoc:
    """A bare attribute bag standing in for a Frappe doc (the hooks use getattr only)."""

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


class TestActionItemDocHooks(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Real Projects + PO so the DN/PDD project-resolution get_value hits a true row.
        project = frappe.new_doc("Projects")
        project.project_name = f"_TEST_PAI_HOOKS_{frappe.generate_hash(length=6)}"
        project.project_start_date = frappe.utils.now()[:19]
        project.project_end_date = frappe.utils.add_to_date(
            frappe.utils.now()[:19], years=1
        )[:19]
        project.project_scopes = {"scopes": []}
        project.insert(ignore_permissions=True)
        cls.project_name = project.name

        # A minimal PO (doc_events suppressed) so parent_docname / procurement_order
        # resolves to cls.project_name.
        orig = frappe.get_doc_hooks
        frappe.get_doc_hooks = lambda: {}
        try:
            po = frappe.new_doc("Procurement Orders")
            po.project = cls.project_name
            po.status = "Dispatched"
            po.billing_status = "Billable"
            po.append(
                "items",
                {
                    "item_id": frappe.generate_hash(length=6),
                    "item_name": "Test Item",
                    "unit": "Nos",
                    "quote": 100,
                    "category": "Cat A",
                    "is_dispatched": 1,
                    "quantity": 10,
                    "received_quantity": 0,
                },
            )
            po.insert(ignore_permissions=True, ignore_links=True)
            cls.po_name = po.name
            frappe.db.commit()
        finally:
            frappe.get_doc_hooks = orig

    @classmethod
    def tearDownClass(cls):
        orig = frappe.get_doc_hooks
        frappe.get_doc_hooks = lambda: {}
        try:
            if getattr(cls, "po_name", None) and frappe.db.exists(
                "Procurement Orders", cls.po_name
            ):
                frappe.delete_doc(
                    "Procurement Orders", cls.po_name, force=True, ignore_permissions=True
                )
            frappe.delete_doc(
                "Projects", cls.project_name, force=True, ignore_permissions=True
            )
            frappe.db.commit()
        finally:
            frappe.get_doc_hooks = orig
        super().tearDownClass()

    # -- enqueue capture harness ---------------------------------------- #

    def setUp(self):
        self._calls = []
        self._orig_enqueue = frappe.enqueue

        def _capture(method, **kwargs):
            self._calls.append({"method": method, **kwargs})

        frappe.enqueue = _capture

    def tearDown(self):
        frappe.enqueue = self._orig_enqueue

    def _assert_one_enqueue_for(self, project):
        self.assertEqual(len(self._calls), 1, f"expected exactly one enqueue, got {self._calls}")
        call = self._calls[0]
        self.assertEqual(
            call["method"],
            "nirmaan_stack.services.action_items.reconcile.reconcile_project_action_items",
        )
        self.assertEqual(call["project_name"], project)
        self.assertEqual(call["queue"], "short")
        self.assertTrue(call["deduplicate"])
        self.assertEqual(call["job_id"], f"pai::{project}")
        self.assertTrue(
            call["enqueue_after_commit"],
            "enqueue_after_commit=True is MANDATORY (else the job reads uncommitted state)",
        )

    # -- enqueue_project_reconcile ------------------------------------- #

    def test_enqueue_helper_with_project(self):
        doc_hooks.enqueue_project_reconcile(self.project_name)
        self._assert_one_enqueue_for(self.project_name)

    def test_enqueue_helper_blank_is_noop(self):
        for blank in (None, "", 0):
            doc_hooks.enqueue_project_reconcile(blank)
        self.assertEqual(self._calls, [], "blank project must not enqueue")

    def test_enqueue_helper_never_raises(self):
        # Even if frappe.enqueue blows up, the helper must swallow + log, not raise.
        def _boom(*a, **k):
            raise RuntimeError("queue down")

        frappe.enqueue = _boom
        try:
            doc_hooks.enqueue_project_reconcile(self.project_name)  # must not raise
        finally:
            pass  # tearDown restores frappe.enqueue

    # -- on_po_update --------------------------------------------------- #

    def test_on_po_update_enqueues(self):
        doc_hooks.on_po_update(_StubDoc(project=self.project_name))
        self._assert_one_enqueue_for(self.project_name)

    def test_on_po_update_blank_project_noop(self):
        doc_hooks.on_po_update(_StubDoc(project=None))
        self.assertEqual(self._calls, [])

    # -- on_dn_update / on_dn_delete ------------------------------------ #

    def test_on_dn_update_enqueues_via_po(self):
        dn = _StubDoc(parent_doctype=None, procurement_order=self.po_name)
        doc_hooks.on_dn_update(dn)
        self._assert_one_enqueue_for(self.project_name)

    def test_on_dn_delete_enqueues_via_po(self):
        dn = _StubDoc(parent_doctype=None, procurement_order=self.po_name)
        doc_hooks.on_dn_delete(dn)
        self._assert_one_enqueue_for(self.project_name)

    def test_on_dn_itm_parented_does_not_enqueue(self):
        dn = _StubDoc(
            parent_doctype="Internal Transfer Memo",
            parent_docname="ITM/0001",
            procurement_order=None,
        )
        doc_hooks.on_dn_update(dn)
        doc_hooks.on_dn_delete(dn)
        self.assertEqual(self._calls, [], "ITM-parented DN must not enqueue PO action items")

    def test_on_dn_blank_link_noop_no_raise(self):
        # Legacy/blank procurement_order → no enqueue, no exception (host save safe).
        dn = _StubDoc(parent_doctype=None, procurement_order=None)
        doc_hooks.on_dn_update(dn)  # must not raise
        doc_hooks.on_dn_delete(dn)
        self.assertEqual(self._calls, [])

    def test_on_dn_unknown_po_noop(self):
        # A procurement_order that doesn't resolve to a project → no enqueue, no raise.
        dn = _StubDoc(parent_doctype=None, procurement_order="PO/DOES-NOT-EXIST")
        doc_hooks.on_dn_update(dn)
        self.assertEqual(self._calls, [])

    # -- on_pdd_insert / on_pdd_delete ---------------------------------- #

    def test_on_pdd_insert_enqueues_via_po(self):
        dc = _StubDoc(parent_doctype="Procurement Orders", parent_docname=self.po_name)
        doc_hooks.on_pdd_insert(dc)
        self._assert_one_enqueue_for(self.project_name)

    def test_on_pdd_delete_enqueues_via_po(self):
        dc = _StubDoc(parent_doctype="Procurement Orders", parent_docname=self.po_name)
        doc_hooks.on_pdd_delete(dc)
        self._assert_one_enqueue_for(self.project_name)

    def test_on_pdd_itm_parented_does_not_enqueue(self):
        dc = _StubDoc(parent_doctype="Internal Transfer Memo", parent_docname="ITM/0001")
        doc_hooks.on_pdd_insert(dc)
        doc_hooks.on_pdd_delete(dc)
        self.assertEqual(self._calls, [], "non-PO-parented PDD must not enqueue")

    def test_on_pdd_blank_docname_noop_no_raise(self):
        dc = _StubDoc(parent_doctype="Procurement Orders", parent_docname=None)
        doc_hooks.on_pdd_insert(dc)  # must not raise
        doc_hooks.on_pdd_delete(dc)
        self.assertEqual(self._calls, [])

    def test_on_pdd_missing_parent_doctype_noop(self):
        # No parent_doctype at all → treated as not-Procurement-Orders → skip.
        dc = _StubDoc(parent_docname=self.po_name)
        doc_hooks.on_pdd_insert(dc)
        self.assertEqual(self._calls, [])
