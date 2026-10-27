"""Asset returns were REMOVED (owner, 2026-10-26; commit "feat(assets): remove returns").

What went, and why: the holder's Return, the managers' Approve / Reject (`api/assets/returns.py`), the
"Return Requested" / "Return Rejected" history events, and the monthly audit skipping an assignment whose
return waited. An asset now comes back only through Unassign (Admin / HR), so nothing may ask for a return
that nobody can approve. The patch `v3_0.remove_asset_returns` cleared what returns left in the data.

These tests fail at once if any of that comes back, and if something that must STAY goes with it: Unassign's
"Returned – no longer needed" reason, the Received flag, and the two unused `returned` columns (dropping a
column is its own migration). They read code and metadata only: nothing is written.
Frontend twin: frontend/src/pages/Assets/returnsRemoved.test.ts.

Run: bench --site localhost run-tests --module nirmaan_stack.api.assets.test_returns_removed
"""

import importlib
import inspect
import os

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services import asset_audit, asset_audit_open, asset_history
from nirmaan_stack.services.asset_unassign import UNASSIGN_REASONS

WHY = "asset returns were removed (owner, 2026-10-26) -- see api/assets/test_returns_removed.py"
KEPT = "kept on purpose when returns were removed (owner, 2026-10-26) -- see api/assets/test_returns_removed.py"
RETURN_EVENTS = ("Return Requested", "Return Rejected")
APP = os.path.dirname(frappe.get_app_path("nirmaan_stack"))


class TestReturnsStayRemoved(FrappeTestCase):
    def test_the_return_endpoints_are_gone(self):
        with self.assertRaises(ImportError, msg=WHY):
            importlib.import_module("nirmaan_stack.api.assets.returns")
        for method in ("request_return", "approve_return", "reject_return"):
            with self.assertRaises(Exception, msg=f"{WHY}: {method}"):
                frappe.get_attr(f"nirmaan_stack.api.assets.returns.{method}")

    def test_no_code_calls_a_return_endpoint(self):
        callers = []
        for root, _, files in os.walk(frappe.get_app_path("nirmaan_stack")):
            for name in files:
                if name.endswith(".py") and not name.startswith("test_"):
                    path = os.path.join(root, name)
                    if "api.assets.returns" in open(path, encoding="utf-8").read():
                        callers.append(os.path.relpath(path, APP))
        self.assertEqual(callers, [], WHY)

    def test_the_history_has_no_return_events(self):
        options = frappe.get_meta("Asset History").get_field("event").options.split("\n")
        for event in RETURN_EVENTS:
            self.assertNotIn(event, options, WHY)
        self.assertFalse(hasattr(asset_history, "RETURN_REQUESTED"), WHY)
        self.assertFalse(hasattr(asset_history, "RETURN_REJECTED"), WHY)

    def test_no_audit_note_says_a_return_was_rejected(self):
        self.assertFalse(hasattr(asset_audit, "NOTE_RETURN_REJECTED"), WHY)

    def test_the_monthly_audit_does_not_skip_a_returned_row(self):
        """Behaviour is pinned in test_audits (`..._even_with_a_leftover_returned_flag`); this catches the rule
        coming back in the one query that decides who owes an audit."""
        self.assertNotIn("returned", inspect.getsource(asset_audit_open.due_assignments), WHY)

    def test_the_clean_up_patch_is_registered_once_and_the_old_one_is_not(self):
        patches = open(os.path.join(frappe.get_app_path("nirmaan_stack"), "patches.txt"), encoding="utf-8").read()
        self.assertEqual(patches.count("nirmaan_stack.patches.v3_0.remove_asset_returns\n"), 1, WHY)
        self.assertNotIn("cancel_pending_asset_returns", patches, WHY)


class TestWhatStaysWhenReturnsWent(FrappeTestCase):
    def test_unassign_still_records_a_hand_back(self):
        self.assertIn("Returned – no longer needed", UNASSIGN_REASONS, KEPT)

    def test_the_other_history_events_stay(self):
        options = frappe.get_meta("Asset History").get_field("event").options.split("\n")
        self.assertEqual(
            options,
            ["Asset Added", "Assigned", "Declaration Signed", "Declaration Uploaded", "Unassigned", "Department Set",
             "Audit Requested", "Audit Fulfilled", "Audit Missed"],
            KEPT,
        )

    def test_received_stays_and_the_unused_return_columns_are_not_dropped(self):
        for field in ("received", "received_on"):
            self.assertIsNotNone(frappe.get_meta("Asset Management").get_field(field), f"{KEPT}: {field}")
        for column in ("returned", "returned_on"):
            self.assertTrue(frappe.db.has_column("Asset Management", column), f"{KEPT}: {column} (unused)")

    def test_the_other_audit_notes_stay(self):
        self.assertEqual((asset_audit.NOTE_HANDOVER, asset_audit.NOTE_CATEGORY_ON),
                         ("handover", "category audit switched on"), KEPT)
