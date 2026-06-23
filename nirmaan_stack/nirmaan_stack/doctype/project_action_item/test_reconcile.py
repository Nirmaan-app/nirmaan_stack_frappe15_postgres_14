# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt
"""
Phase-1 tests for the Project Action Item ENGINE:
  * PURE predicate tests (no fixtures, many cases) covering the full §9 matrix.
  * RECONCILER integration tests (Projects + PO + item fixtures) proving the
    recompute-from-truth projection: create-on-pending, resolve-on-cleared,
    reopen-after-resolve, idempotency, concurrency-safe get-or-create, project
    gating, Merged/Cancelled exclusion, and DN+DC co-existence.

The predicates carry the ENTIRE business definition and are pure, so the bulk of the
proof is fixture-free. The reconciler tests then prove the DB upsert/lifecycle.

Fixture POs are inserted with the Procurement Orders doc_events SUPPRESSED (see
`_no_doc_events`) — the heavy PO controllers (notifications, AQ creation, tendering
guard) are irrelevant to the projection engine and would need a full PR fixture chain.
The reconciler under test never invokes PO controllers; it only reads PO/item/PDD rows.
"""

import contextlib

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.action_items.predicates import (
    ACTION_DC_PENDING,
    ACTION_DN_PENDING,
    ASSIGNED_ROLE_PM,
    is_billable,
    is_dc_pending,
    is_dn_pending,
    item_fully_delivered,
)
from nirmaan_stack.services.action_items.reconcile import (
    _dedup_key,
    reconcile_all,
    reconcile_project_action_items,
)


# ====================================================================== #
# PURE PREDICATE TESTS — no DB, no fixtures                              #
# ====================================================================== #


def _item(category="Cat A", is_dispatched=1, quantity=10, received_quantity=0):
    return {
        "category": category,
        "is_dispatched": is_dispatched,
        "quantity": quantity,
        "received_quantity": received_quantity,
    }


class TestPredicatesBillable(FrappeTestCase):
    def test_billable_default_when_blank(self):
        self.assertTrue(is_billable(None))
        self.assertTrue(is_billable(""))
        self.assertTrue(is_billable("Billable"))

    def test_non_billable_only_when_explicit(self):
        self.assertFalse(is_billable("Non-Billable"))


class TestItemFullyDelivered(FrappeTestCase):
    def test_integer_exact_not_delivered(self):
        self.assertFalse(item_fully_delivered(100, 99))

    def test_integer_exact_delivered(self):
        self.assertTrue(item_fully_delivered(100, 100))
        self.assertTrue(item_fully_delivered(100, 101))

    def test_integer_99_of_100_is_NOT_delivered(self):
        # Integer qty → exact rule, NO tolerance: 99/100 is short.
        self.assertFalse(item_fully_delivered(100, 99))

    def test_float_tolerance_975_of_100_IS_delivered(self):
        # Float qty (received has a fractional part) → 2.5% tolerance:
        # 100*(1-0.025)=97.5, so 97.5 received clears.
        self.assertTrue(item_fully_delivered(100, 97.5))

    def test_float_just_below_tolerance_not_delivered(self):
        self.assertFalse(item_fully_delivered(100, 97.4))

    def test_float_quantity_triggers_tolerance_branch(self):
        # quantity itself fractional → float branch. 10*(1-0.025)=9.75.
        self.assertTrue(item_fully_delivered(10.0, 9.75))
        self.assertFalse(item_fully_delivered(10.0, 9.74))


class TestDnPendingPredicate(FrappeTestCase):
    def test_dispatched_no_delivery_is_pending(self):
        self.assertTrue(
            is_dn_pending("Dispatched", "Billable", [_item(received_quantity=0)])
        )

    def test_partially_delivered_remaining_is_pending(self):
        self.assertTrue(
            is_dn_pending(
                "Partially Delivered", "Billable", [_item(quantity=10, received_quantity=4)]
            )
        )

    def test_delivered_status_never_pending(self):
        # PO status Delivered → no outstanding delivery obligation.
        self.assertFalse(
            is_dn_pending("Delivered", "Billable", [_item(received_quantity=0)])
        )

    def test_tolerance_delivered_not_pending(self):
        # 97.5/100 float → fully delivered → NOT DN pending, even on a live status.
        self.assertFalse(
            is_dn_pending(
                "Partially Delivered",
                "Billable",
                [_item(quantity=100, received_quantity=97.5)],
            )
        )

    def test_non_billable_never_pending(self):
        self.assertFalse(
            is_dn_pending("Dispatched", "Non-Billable", [_item(received_quantity=0)])
        )

    def test_additional_charges_only_never_pending(self):
        self.assertFalse(
            is_dn_pending(
                "Dispatched",
                "Billable",
                [_item(category="Additional Charges", received_quantity=0)],
            )
        )

    def test_undispatched_item_not_pending(self):
        # is_dispatched=0 → not counted even though undelivered.
        self.assertFalse(
            is_dn_pending(
                "Partially Dispatched",
                "Billable",
                [_item(is_dispatched=0, received_quantity=0)],
            )
        )

    def test_partially_dispatched_dispatched_undelivered_is_pending(self):
        self.assertTrue(
            is_dn_pending(
                "Partially Dispatched",
                "Billable",
                [
                    _item(is_dispatched=1, quantity=10, received_quantity=0),
                    _item(is_dispatched=0, quantity=5, received_quantity=0),
                ],
            )
        )

    def test_partially_dispatched_dispatched_item_fully_delivered_not_pending(self):
        # The dispatched item is fully delivered; the undispatched one doesn't count.
        self.assertFalse(
            is_dn_pending(
                "Partially Dispatched",
                "Billable",
                [
                    _item(is_dispatched=1, quantity=10, received_quantity=10),
                    _item(is_dispatched=0, quantity=5, received_quantity=0),
                ],
            )
        )

    def test_excluded_po_status_not_pending(self):
        for status in ("PO Approved", "Merged", "Cancelled", "Inactive", ""):
            self.assertFalse(
                is_dn_pending(status, "Billable", [_item(received_quantity=0)]),
                f"status {status!r} must not be DN pending",
            )


class TestDcPendingPredicate(FrappeTestCase):
    def test_delivered_no_dc_is_pending(self):
        self.assertTrue(
            is_dc_pending(
                "Delivered", "Billable", [_item(received_quantity=10)], has_delivery_challan=False
            )
        )

    def test_delivered_with_dc_not_pending(self):
        self.assertFalse(
            is_dc_pending(
                "Delivered", "Billable", [_item(received_quantity=10)], has_delivery_challan=True
            )
        )

    def test_no_delivery_yet_not_pending(self):
        # received_quantity == 0 → no DN exists → no DC obligation.
        self.assertFalse(
            is_dc_pending(
                "Dispatched", "Billable", [_item(received_quantity=0)], has_delivery_challan=False
            )
        )

    def test_sticky_partially_dispatched_with_delivery_is_pending(self):
        # THE red-team false-negative: status stuck at Partially Dispatched but an item
        # has received_quantity>0 (a DN was filed) and no DC → DC PENDING (item-level).
        self.assertTrue(
            is_dc_pending(
                "Partially Dispatched",
                "Billable",
                [_item(received_quantity=3)],
                has_delivery_challan=False,
            )
        )

    def test_mir_only_still_pending(self):
        # An MIR-only PO has no non-stub Delivery-Challan PDD → has_delivery_challan is
        # False (the caller's query filters type=='Delivery Challan'), so still pending.
        self.assertTrue(
            is_dc_pending(
                "Delivered", "Billable", [_item(received_quantity=5)], has_delivery_challan=False
            )
        )

    def test_additional_charges_only_never_pending(self):
        self.assertFalse(
            is_dc_pending(
                "Delivered",
                "Billable",
                [_item(category="Additional Charges", received_quantity=10)],
                has_delivery_challan=False,
            )
        )

    def test_non_billable_never_pending(self):
        self.assertFalse(
            is_dc_pending(
                "Delivered", "Non-Billable", [_item(received_quantity=10)], has_delivery_challan=False
            )
        )

    def test_excluded_po_status_not_pending(self):
        for status in ("PO Approved", "Merged", "Cancelled", ""):
            self.assertFalse(
                is_dc_pending(status, "Billable", [_item(received_quantity=5)], False),
                f"status {status!r} must not be DC pending",
            )


# ====================================================================== #
# RECONCILER INTEGRATION TESTS — Projects + PO + item fixtures           #
# ====================================================================== #


@contextlib.contextmanager
def _no_doc_events():
    """Temporarily suppress all doc_events during fixture insert/delete.

    The PO controllers (notifications/AQ/tendering guard) are irrelevant to the
    projection engine under test and need a full PR fixture chain. `Document.hook`
    resolves controller handlers via `frappe.get_doc_hooks()` (cached in
    frappe.local.doc_events_hooks), so we monkeypatch THAT to return an empty map —
    .insert()/.delete() still run autoname + child naming + defaults but fire no
    controller code.
    """
    orig = frappe.get_doc_hooks
    frappe.get_doc_hooks = lambda: {}
    try:
        yield
    finally:
        frappe.get_doc_hooks = orig


class TestReconciler(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        project = frappe.new_doc("Projects")
        project.project_name = f"_TEST_PAI_RECON_{frappe.generate_hash(length=6)}"
        project.project_start_date = frappe.utils.now()[:19]
        project.project_end_date = frappe.utils.add_to_date(
            frappe.utils.now()[:19], years=1
        )[:19]
        project.project_scopes = {"scopes": []}
        project.insert(ignore_permissions=True)
        cls.project_name = project.name
        cls._po_names = []
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        with _no_doc_events():
            for po in getattr(cls, "_po_names", []):
                if frappe.db.exists("Procurement Orders", po):
                    frappe.delete_doc(
                        "Procurement Orders", po, force=True, ignore_permissions=True
                    )
            frappe.db.delete("PO Delivery Documents", {"project": cls.project_name})
            frappe.db.delete("Project Action Item", {"project": cls.project_name})
            frappe.delete_doc(
                "Projects", cls.project_name, force=True, ignore_permissions=True
            )
            frappe.db.commit()
        super().tearDownClass()

    # -- fixture helpers ------------------------------------------------- #

    def _make_po(self, status="Dispatched", billing_status="Billable", items=None):
        """Insert a PO with items (doc_events suppressed), then force exact state via
        set_value so no PO controller derives status/billing/received for us.

        items: list of dicts with keys category, is_dispatched, quantity,
               received_quantity. Defaults to one dispatched-undelivered Billable item.
        """
        if items is None:
            items = [
                {
                    "category": "Cat A",
                    "is_dispatched": 1,
                    "quantity": 10,
                    "received_quantity": 0,
                }
            ]
        with _no_doc_events():
            po = frappe.new_doc("Procurement Orders")
            po.project = self.project_name
            po.status = status
            po.billing_status = billing_status
            for it in items:
                po.append(
                    "items",
                    {
                        "item_id": frappe.generate_hash(length=6),
                        "item_name": "Test Item",
                        "unit": "Nos",
                        "quote": 100,
                        "category": it.get("category", "Cat A"),
                        "is_dispatched": it.get("is_dispatched", 1),
                        "quantity": it.get("quantity", 10),
                        "received_quantity": it.get("received_quantity", 0),
                    },
                )
            po.insert(ignore_permissions=True, ignore_links=True)
            # Force exact parent state (validate may have rolled up billing_status).
            frappe.db.set_value(
                "Procurement Orders",
                po.name,
                {"status": status, "billing_status": billing_status},
                update_modified=False,
            )
            frappe.db.commit()
        self.__class__._po_names.append(po.name)
        return po.name

    def _make_dc(self, po_name, is_stub=0, type_="Delivery Challan"):
        with _no_doc_events():
            dc = frappe.new_doc("PO Delivery Documents")
            dc.parent_doctype = "Procurement Orders"
            dc.parent_docname = po_name
            dc.project = self.project_name
            dc.type = type_
            dc.is_stub = is_stub
            dc.insert(ignore_permissions=True, ignore_links=True)
            frappe.db.commit()
        return dc.name

    def _open_keys(self):
        rows = frappe.get_all(
            "Project Action Item",
            filters={"project": self.project_name, "status": "Open"},
            fields=["dedup_key"],
        )
        return {r["dedup_key"] for r in rows}

    def _row(self, po_name, action_type):
        return frappe.db.get_value(
            "Project Action Item",
            {"dedup_key": _dedup_key(self.project_name, po_name, action_type)},
            ["name", "status", "assigned_role", "first_opened_at", "resolved_at"],
            as_dict=True,
        )

    def _cleanup_rows_and_pos(self):
        """Wipe action items + delivery docs + POs between tests so each starts clean."""
        with _no_doc_events():
            for po in list(self.__class__._po_names):
                if frappe.db.exists("Procurement Orders", po):
                    frappe.delete_doc(
                        "Procurement Orders", po, force=True, ignore_permissions=True
                    )
            self.__class__._po_names = []
            frappe.db.delete("PO Delivery Documents", {"project": self.project_name})
            frappe.db.delete("Project Action Item", {"project": self.project_name})
            frappe.db.commit()

    def setUp(self):
        # Each test starts from a clean projection + PO set.
        self._cleanup_rows_and_pos()

    # -- tests ----------------------------------------------------------- #

    def test_create_on_pending(self):
        po = self._make_po(status="Dispatched")
        result = reconcile_project_action_items(self.project_name)
        self.assertEqual(result["opened"], 1)
        key = _dedup_key(self.project_name, po, ACTION_DN_PENDING)
        self.assertIn(key, self._open_keys())
        row = self._row(po, ACTION_DN_PENDING)
        self.assertEqual(row["status"], "Open")
        self.assertEqual(row["assigned_role"], ASSIGNED_ROLE_PM)
        self.assertIsNotNone(row["first_opened_at"])

    def test_resolve_on_cleared(self):
        po = self._make_po(status="Dispatched")
        reconcile_project_action_items(self.project_name)
        self.assertEqual(
            self._row(po, ACTION_DN_PENDING)["status"], "Open"
        )

        # Now fully deliver the item → the DN obligation clears (status still live, not
        # Delivered, but received==quantity → fully delivered → not DN pending).
        # NOTE: delivering also creates a NEW DC_PENDING obligation (received>0, no DC),
        # so the TOTAL open count does not drop to 0 — we assert the DN row specifically.
        item = frappe.get_all(
            "Purchase Order Item", filters={"parent": po}, fields=["name", "quantity"]
        )[0]
        frappe.db.set_value(
            "Purchase Order Item",
            item["name"],
            "received_quantity",
            item["quantity"],
            update_modified=False,
        )
        frappe.db.commit()

        result = reconcile_project_action_items(self.project_name)
        self.assertEqual(result["resolved"], 1)  # the DN row resolved
        dn_key = _dedup_key(self.project_name, po, ACTION_DN_PENDING)
        self.assertNotIn(dn_key, self._open_keys())
        row = self._row(po, ACTION_DN_PENDING)
        self.assertEqual(row["status"], "Resolved")
        self.assertIsNotNone(row["resolved_at"])
        # And a DC obligation now exists in its place.
        self.assertIn(
            _dedup_key(self.project_name, po, ACTION_DC_PENDING), self._open_keys()
        )

    def test_reopen_after_resolve(self):
        po = self._make_po(status="Dispatched")
        reconcile_project_action_items(self.project_name)
        item = frappe.get_all(
            "Purchase Order Item", filters={"parent": po}, fields=["name", "quantity"]
        )[0]
        # deliver → resolve
        frappe.db.set_value(
            "Purchase Order Item", item["name"], "received_quantity", item["quantity"],
            update_modified=False,
        )
        frappe.db.commit()
        reconcile_project_action_items(self.project_name)
        self.assertEqual(self._row(po, ACTION_DN_PENDING)["status"], "Resolved")

        # undeliver (e.g. a DN was deleted) → must re-open the SAME row in place
        frappe.db.set_value(
            "Purchase Order Item", item["name"], "received_quantity", 0,
            update_modified=False,
        )
        frappe.db.commit()
        result = reconcile_project_action_items(self.project_name)
        self.assertEqual(result["reopened"], 1)
        row = self._row(po, ACTION_DN_PENDING)
        self.assertEqual(row["status"], "Open")
        self.assertIsNone(row["resolved_at"])
        # exactly one row for the key (re-opened in place, not duplicated)
        self.assertEqual(
            frappe.db.count(
                "Project Action Item",
                {"dedup_key": _dedup_key(self.project_name, po, ACTION_DN_PENDING)},
            ),
            1,
        )

    def test_idempotency_three_runs(self):
        po = self._make_po(status="Dispatched")
        # DN pending + (deliver something so DC also pending) — make it richer:
        # one item dispatched-undelivered (DN), set received>0 won't help DN here; keep DN.
        for _ in range(3):
            reconcile_project_action_items(self.project_name)
        self.assertEqual(
            frappe.db.count("Project Action Item", {"project": self.project_name}), 1
        )
        self.assertEqual(len(self._open_keys()), 1)

    def test_concurrency_safe_get_or_create(self):
        # Simulate a concurrent winner by pre-inserting the row, then reconcile: the
        # create path must hit the dup, roll back the savepoint, and re-open instead of
        # escaping with a DuplicateError.
        po = self._make_po(status="Dispatched")
        key = _dedup_key(self.project_name, po, ACTION_DN_PENDING)
        pre = frappe.new_doc("Project Action Item")
        pre.project = self.project_name
        pre.action_type = ACTION_DN_PENDING
        pre.reference_doctype = "Procurement Orders"
        pre.reference_name = po
        pre.status = "Resolved"  # resolved so reconcile must re-open it
        pre.dedup_key = key
        pre.first_opened_at = frappe.utils.now_datetime()
        pre.resolved_at = frappe.utils.now_datetime()
        pre.insert(ignore_permissions=True, ignore_links=True)
        frappe.db.commit()

        # The desired set contains `key`; existing_by_key already has it (Resolved) →
        # the reconcile takes the in-memory re-open branch (no dup), which still proves
        # no escape. To exercise the SAVEPOINT dup path directly, delete from the
        # existing snapshot's perspective is hard; instead assert no exception + 1 row.
        result = reconcile_project_action_items(self.project_name)
        self.assertEqual(
            frappe.db.count("Project Action Item", {"dedup_key": key}), 1
        )
        self.assertEqual(self._row(po, ACTION_DN_PENDING)["status"], "Open")
        self.assertEqual(result["reopened"], 1)

    def test_savepoint_dup_path_directly(self):
        # Directly exercise _create_or_reopen's dup branch: a row exists under the key
        # but is NOT in the reconcile's existing snapshot (simulating a row created by a
        # concurrent reconcile after the snapshot was read). We call the helper itself.
        from nirmaan_stack.services.action_items.reconcile import _create_or_reopen

        po = self._make_po(status="Dispatched")
        key = _dedup_key(self.project_name, po, ACTION_DN_PENDING)
        payload = {
            "action_type": ACTION_DN_PENDING,
            "reference_name": po,
            "title": "x",
            "action_url": "y",
        }
        ts = frappe.utils.now_datetime()
        # First call creates.
        out1 = _create_or_reopen(self.project_name, key, payload, ts)
        frappe.db.commit()
        self.assertEqual(out1, "opened")
        # Second call with the SAME key → dup → savepoint rollback → re-open path.
        out2 = _create_or_reopen(self.project_name, key, payload, ts)
        frappe.db.commit()
        self.assertEqual(out2, "reopened")
        self.assertEqual(frappe.db.count("Project Action Item", {"dedup_key": key}), 1)

    def test_project_gating_completed_resolves_all(self):
        po = self._make_po(status="Dispatched")
        reconcile_project_action_items(self.project_name)
        self.assertEqual(len(self._open_keys()), 1)

        frappe.db.set_value("Projects", self.project_name, "status", "Completed")
        frappe.db.commit()
        try:
            result = reconcile_project_action_items(self.project_name)
            self.assertEqual(len(self._open_keys()), 0)
            self.assertGreaterEqual(result["resolved"], 1)
        finally:
            frappe.db.set_value("Projects", self.project_name, "status", "WIP")
            frappe.db.commit()

    def test_project_gating_halted_resolves_all(self):
        po = self._make_po(status="Dispatched")
        reconcile_project_action_items(self.project_name)
        self.assertEqual(len(self._open_keys()), 1)
        frappe.db.set_value("Projects", self.project_name, "status", "Halted")
        frappe.db.commit()
        try:
            reconcile_project_action_items(self.project_name)
            self.assertEqual(len(self._open_keys()), 0)
        finally:
            frappe.db.set_value("Projects", self.project_name, "status", "WIP")
            frappe.db.commit()

    def test_merged_cancelled_po_excluded(self):
        # A PO that is NOT in the live-status set must never produce a row.
        for status in ("Merged", "Cancelled", "PO Approved"):
            self._cleanup_rows_and_pos()
            self._make_po(status=status)
            reconcile_project_action_items(self.project_name)
            self.assertEqual(
                len(self._open_keys()),
                0,
                f"PO with status {status!r} must not generate action items",
            )

    def test_po_drops_out_of_desired_resolves(self):
        # A live PO opens a row; flip it to Cancelled (drops from desired) → resolve.
        po = self._make_po(status="Dispatched")
        reconcile_project_action_items(self.project_name)
        self.assertEqual(self._row(po, ACTION_DN_PENDING)["status"], "Open")
        frappe.db.set_value(
            "Procurement Orders", po, "status", "Cancelled", update_modified=False
        )
        frappe.db.commit()
        result = reconcile_project_action_items(self.project_name)
        self.assertEqual(result["resolved"], 1)
        self.assertEqual(self._row(po, ACTION_DN_PENDING)["status"], "Resolved")

    def test_coexistence_dn_and_dc_rows(self):
        # One PO that is BOTH DN-pending (dispatched item undelivered) AND DC-pending
        # (another item delivered, no DC). Two independent rows.
        po = self._make_po(
            status="Partially Delivered",
            billing_status="Billable",
            items=[
                # delivered item → drives DC_PENDING (received>0, no DC)
                {"category": "Cat A", "is_dispatched": 1, "quantity": 5, "received_quantity": 5},
                # dispatched-undelivered item → drives DN_PENDING
                {"category": "Cat B", "is_dispatched": 1, "quantity": 8, "received_quantity": 0},
            ],
        )
        result = reconcile_project_action_items(self.project_name)
        self.assertEqual(result["opened"], 2)
        keys = self._open_keys()
        self.assertIn(_dedup_key(self.project_name, po, ACTION_DN_PENDING), keys)
        self.assertIn(_dedup_key(self.project_name, po, ACTION_DC_PENDING), keys)

    def test_dc_pending_clears_when_dc_filed(self):
        po = self._make_po(
            status="Delivered",
            items=[
                {"category": "Cat A", "is_dispatched": 1, "quantity": 5, "received_quantity": 5}
            ],
        )
        reconcile_project_action_items(self.project_name)
        self.assertIn(
            _dedup_key(self.project_name, po, ACTION_DC_PENDING), self._open_keys()
        )
        # File a real (non-stub) DC → DC obligation clears.
        self._make_dc(po, is_stub=0)
        reconcile_project_action_items(self.project_name)
        self.assertNotIn(
            _dedup_key(self.project_name, po, ACTION_DC_PENDING), self._open_keys()
        )
        self.assertEqual(
            self._row(po, ACTION_DC_PENDING)["status"], "Resolved"
        )

    def test_stub_dc_does_not_clear(self):
        po = self._make_po(
            status="Delivered",
            items=[
                {"category": "Cat A", "is_dispatched": 1, "quantity": 5, "received_quantity": 5}
            ],
        )
        self._make_dc(po, is_stub=1)  # stub DC ignored by the predicate query filter
        reconcile_project_action_items(self.project_name)
        self.assertIn(
            _dedup_key(self.project_name, po, ACTION_DC_PENDING), self._open_keys()
        )

    def test_reconcile_all_includes_this_project(self):
        # reconcile_all must process the active project and open its row.
        self._make_po(status="Dispatched")
        totals = reconcile_all()
        self.assertGreaterEqual(totals["projects"], 1)
        self.assertEqual(self._row_count_open(), 1)

    def _row_count_open(self):
        return frappe.db.count(
            "Project Action Item", {"project": self.project_name, "status": "Open"}
        )
