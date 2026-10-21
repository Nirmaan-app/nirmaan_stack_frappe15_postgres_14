"""The Work Order lifecycle rules, pure (#1529, #1539). The checks through a real save are in
`nirmaan_stack/doctype/service_requests/test_work_order_lifecycle.py`.

Run: DEVENV unit nirmaan_stack.services.test_work_order_lifecycle
"""

import unittest
from pathlib import Path

from nirmaan_stack.services.work_order_lifecycle import (
    DECIDE_REFUSAL,
    FINALIZE_FLAG_REFUSAL,
    FINALIZED_REFUSAL,
    approval_record,
    change_problem,
    delete_problem,
)

#: The banner on the WO page shows the server's message word for word (#1539).
BANNER_SOURCE = Path(__file__).resolve().parents[2] / "frontend/src/pages/ServiceRequests/config/finalizedLock.ts"


def _wo(status):
    return {"status": status}


def _finalized(**changes):
    """An Approved, Finalized Work Order as it is stored: rows carry their own name and timestamps."""
    doc = {
        "status": "Approved",
        "is_finalized": 1,
        "vendor": "VEN-1",
        "project": "PROJ-1",
        "gst": "true",
        "project_gst": "29ABFCS9095N1Z9",
        "notes": {"list": [{"id": "a", "note": "Pay in 30 days"}]},
        "service_category_list": {"list": [{"name": "Civil"}]},
        "work_order_items": [
            {"name": "row-1", "modified": "2026-10-01", "item_name": "Plaster", "category": "Civil",
             "uom": "Sqm", "quantity": 10.0, "rate": 500.0},
        ],
        "total_amount": 5900.0,
        "amount_paid": 0.0,
        "latest_payment_date": None,
        "invoice_no": None,
    }
    doc.update(changes)
    return doc


class TestWhoDecides(unittest.TestCase):
    def test_moves_into_approved_or_rejected_need_an_approver(self):
        for before, after in (
            ("Vendor Selected", "Approved"),
            ("Vendor Selected", "Rejected"),
            ("Amendment", "Approved"),
        ):
            with self.subTest(before=before, after=after):
                self.assertEqual(change_problem(_wo(before), _wo(after), may_decide=False), DECIDE_REFUSAL)
                self.assertIsNone(change_problem(_wo(before), _wo(after), may_decide=True))

    def test_a_new_work_order_saved_straight_as_approved_needs_an_approver(self):
        self.assertEqual(change_problem(None, _wo("Approved"), may_decide=False), DECIDE_REFUSAL)
        self.assertIsNone(change_problem(None, _wo("Vendor Selected"), may_decide=False))

    def test_other_saves_need_no_approver(self):
        for before, after in (
            ("Approved", "Approved"),       # GST switch, Edit terms
            ("Approved", "Amendment"),      # Amend
            ("Rejected", "Vendor Selected"),  # edit and resend
            ("Rejected", "Rejected"),
        ):
            with self.subTest(before=before, after=after):
                self.assertIsNone(change_problem(_wo(before), _wo(after), may_decide=False))


class TestFinalizedLocksItsScope(unittest.TestCase):
    def _refusal(self, **changes):
        return change_problem(_finalized(), _finalized(**changes), may_decide=True)

    def test_amend_gst_terms_items_vendor_and_total_are_refused(self):
        row = _finalized()["work_order_items"][0]
        for changes in (
            {"status": "Amendment"},
            {"gst": "false"},
            {"notes": {"list": [{"id": "a", "note": "Pay in 60 days"}]}},
            {"work_order_items": [{**row, "rate": 600.0}]},
            {"work_order_items": [row, {**row, "name": "row-2", "item_name": "Paint"}]},
            {"work_order_items": []},
            {"service_category_list": {"list": [{"name": "Electrical"}]}},
            {"total_amount": 1.0},
            {"vendor": "VEN-2"},
        ):
            with self.subTest(changes=list(changes)):
                self.assertEqual(self._refusal(**changes), FINALIZED_REFUSAL)

    def test_payments_invoices_and_the_nirmaan_gst_stay_open(self):
        for changes in (
            {"amount_paid": 2000.0, "latest_payment_date": "2026-10-22"},
            {"invoice_no": "INV-1"},
            {"project_gst": "27ABFCS9095N1Z1"},
        ):
            with self.subTest(changes=list(changes)):
                self.assertIsNone(self._refusal(**changes))

    def test_a_desk_save_that_changes_nothing_locked_passes(self):
        """Desk sends JSON fields as text, numbers as it parsed them, and rows with fresh timestamps."""
        row = {**_finalized()["work_order_items"][0], "modified": "2026-10-22", "quantity": 10, "rate": 500}
        desk = _finalized(
            notes='{"list": [{"id": "a", "note": "Pay in 30 days"}]}',
            service_category_list='{"list":[{"name":"Civil"}]}',
            work_order_items=[row],
            total_amount=5900,
            invoice_no="",
        )
        self.assertIsNone(change_problem(_finalized(), desk, may_decide=False))

    def test_match_gst_to_vendor_may_change_the_gst_flag(self):
        self.assertIsNone(
            change_problem(_finalized(), _finalized(gst="false"), may_decide=False, gst_from_vendor=True)
        )

    def test_a_work_order_that_is_not_finalized_is_not_locked(self):
        open_wo = _finalized(is_finalized=0)
        self.assertIsNone(
            change_problem(open_wo, {**open_wo, "status": "Amendment", "total_amount": 1.0}, may_decide=False)
        )


class TestTheFinalizeFlag(unittest.TestCase):
    def test_it_moves_only_through_finalize_and_revert(self):
        for before, after in ((0, 1), (1, 0), (None, 1)):
            with self.subTest(before=before, after=after):
                self.assertEqual(
                    change_problem(_finalized(is_finalized=before), _finalized(is_finalized=after),
                                   may_decide=True),
                    FINALIZE_FLAG_REFUSAL,
                )
                self.assertIsNone(
                    change_problem(_finalized(is_finalized=before), _finalized(is_finalized=after),
                                   may_decide=True, finalize_action=True)
                )

    def test_revert_may_not_carry_a_scope_change(self):
        self.assertEqual(
            change_problem(_finalized(), _finalized(is_finalized=0, total_amount=1.0),
                           may_decide=True, finalize_action=True),
            FINALIZED_REFUSAL,
        )


class TestDelete(unittest.TestCase):
    def test_a_finalized_work_order_is_not_deleted(self):
        self.assertEqual(delete_problem(_finalized()), FINALIZED_REFUSAL)
        self.assertIsNone(delete_problem(_finalized(is_finalized=0)))


class TestTheBannerSaysWhatTheServerSays(unittest.TestCase):
    def test_the_banner_text_is_the_refusal(self):
        self.assertIn(FINALIZED_REFUSAL, BANNER_SOURCE.read_text())


APPROVER, NOW = "approver@example.com", "2026-10-22 11:30:00"
STAMPED = {"approved_on": "2026-01-05 10:00:00", "approved_by": "first@example.com"}


class TestApprovalRecord(unittest.TestCase):
    """What a save stores as the Work Order's approved-on and approved-by (#1532)."""

    def _record(self, before, after):
        return approval_record(before, after, user=APPROVER, now=NOW)

    def test_approving_stamps_who_and_when(self):
        for before in (_wo("Vendor Selected"), None):
            with self.subTest(before=before):
                self.assertEqual(
                    self._record(before, _wo("Approved")), {"approved_on": NOW, "approved_by": APPROVER}
                )

    def test_later_saves_keep_the_stamp_whatever_they_send(self):
        """A payment, invoice, GST or notes save of an Approved WO, an amend, and the accept or revert of
        an amendment (which moves it back into Approved) all keep the first approval."""
        sent = {"approved_on": NOW, "approved_by": "someone-else@example.com"}
        for before, after in (("Approved", "Approved"), ("Approved", "Amendment"), ("Amendment", "Approved")):
            with self.subTest(before=before, after=after):
                self.assertEqual(self._record({**_wo(before), **STAMPED}, {**_wo(after), **sent}), STAMPED)

    def test_an_unapproved_work_order_has_no_stamp(self):
        sent = {"approved_on": NOW, "approved_by": APPROVER}
        for before, after in ((None, "Vendor Selected"), ("Vendor Selected", "Rejected")):
            with self.subTest(before=before, after=after):
                self.assertEqual(
                    self._record(_wo(before) if before else None, {**_wo(after), **sent}),
                    {"approved_on": None, "approved_by": None},
                )


if __name__ == "__main__":
    unittest.main()
