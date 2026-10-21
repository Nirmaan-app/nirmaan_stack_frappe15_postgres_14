"""The Work Order lifecycle rules, pure (#1529, #1539). The checks through a real save are in
`nirmaan_stack/doctype/service_requests/test_work_order_lifecycle.py`.

Run: DEVENV unit nirmaan_stack.services.test_work_order_lifecycle
"""

import unittest
from pathlib import Path

from nirmaan_stack.services.work_order_amendment import pre_amendment_values
from nirmaan_stack.services.work_order_lifecycle import (
    AMEND_PAYMENTS_REFUSAL,
    DECIDE_REFUSAL,
    FINALIZE_FLAG_REFUSAL,
    FINALIZED_REFUSAL,
    GST_HOLD_AMEND_REFUSAL,
    TOTAL_BELOW_REFUSAL,
    UNDER_AMENDMENT_PAYMENT_REFUSAL,
    VENDOR_CHANGE_REFUSAL,
    AmendmentFacts,
    approval_record,
    change_problem,
    delete_problem,
    payment_request_problem,
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


def _approved(**changes):
    """An Approved Work Order, not finalized: one line of 10 x 500, GST on, so its total is 5,900."""
    return _finalized(is_finalized=0, **changes)


def _amended(before=None, **changes):
    return {**(before or _approved()), "status": "Amendment", **changes}


def _rate(rate):
    return [{**_finalized()["work_order_items"][0], "name": "row-new", "rate": rate}]


class TestAmendmentRules(unittest.TestCase):
    """What an amendment may not do (#1540, GLOSSARY *Amendment (of a Work Order)*)."""

    def _problem(self, before, after, **facts):
        return change_problem(before, after, may_decide=True, amendment=AmendmentFacts(**facts))

    def test_amend_waits_for_every_payment_in_flight_and_names_them(self):
        problem = self._problem(
            _approved(), _amended(),
            open_payments=(("PAY-1", "Requested"), ("PAY-2", "CEO Pending"),
                           ("PAY-3", "Approved"), ("PAY-4", "Reconciliation Pending")),
        )
        self.assertTrue(problem.startswith(AMEND_PAYMENTS_REFUSAL))
        for listed in ("PAY-1 (Requested)", "PAY-2 (CEO Pending)", "PAY-3 (Approved)",
                       "PAY-4 (Reconciliation Pending)"):
            self.assertIn(listed, problem)

    def test_paid_and_rejected_payments_do_not_stop_an_amend(self):
        self.assertIsNone(self._problem(_approved(amount_paid=1000.0), _amended(), has_live_payment=True))

    def test_the_total_may_not_fall_below_amount_paid(self):
        before = _approved(amount_paid=4000.0)
        problem = self._problem(before, _amended(before, work_order_items=_rate(300.0)))   # 3,540
        self.assertTrue(problem.startswith(TOTAL_BELOW_REFUSAL))
        self.assertIn("Amount Paid", problem)
        self.assertIsNone(self._problem(before, _amended(before, work_order_items=_rate(400.0))))  # 4,720

    def test_the_total_may_not_fall_below_approved_invoices(self):
        before = _approved(amount_invoiced=5000.0)
        problem = self._problem(before, _amended(before, work_order_items=_rate(400.0)))   # 4,720
        self.assertTrue(problem.startswith(TOTAL_BELOW_REFUSAL))
        self.assertIn("approved invoices", problem)

    def test_accepting_an_amendment_that_lowers_the_total_is_held_to_the_same_floor(self):
        """The stored total is recomputed only when the amendment is decided, so until then it is still the
        total before the amendment."""
        before = _amended(_approved(amount_paid=4000.0), work_order_items=_rate(300.0))
        self.assertTrue(
            self._problem(_approved(amount_paid=4000.0), before).startswith(TOTAL_BELOW_REFUSAL)
        )
        accepted = {**before, "status": "Approved"}
        self.assertTrue(self._problem(before, accepted).startswith(TOTAL_BELOW_REFUSAL))
        reverted = {**accepted, "work_order_items": _approved()["work_order_items"]}
        self.assertIsNone(self._problem(before, reverted))

    def test_a_save_that_does_not_lower_the_total_is_never_refused_for_it(self):
        """A Work Order already paid a little over its total (the ₹10 tolerance) may still be amended
        upward, or reverted."""
        before = _approved(amount_paid=5905.0)
        self.assertIsNone(self._problem(before, _amended(before)))
        self.assertIsNone(self._problem(before, _amended(before, work_order_items=_rate(600.0))))

    def test_the_vendor_stays_once_money_or_an_invoice_exists(self):
        for facts in ({"has_live_payment": True}, {"invoices": 1}):
            with self.subTest(facts=facts):
                self.assertEqual(
                    self._problem(_approved(), _amended(vendor="VEN-2"), **facts), VENDOR_CHANGE_REFUSAL
                )
        self.assertIsNone(self._problem(_approved(), _amended(vendor="VEN-2")))

    def test_accepting_holds_the_vendor_to_the_one_before_the_amendment(self):
        swapped = _amended(vendor="VEN-2")
        accepted = {**swapped, "status": "Approved"}
        self.assertEqual(
            self._problem(swapped, accepted, vendor_before="VEN-1", has_live_payment=True),
            VENDOR_CHANGE_REFUSAL,
        )
        reverted = {**accepted, "vendor": "VEN-1"}
        self.assertIsNone(self._problem(swapped, reverted, vendor_before="VEN-1", has_live_payment=True))

    def test_a_vendor_on_gst_hold_cannot_be_swapped_in(self):
        problem = self._problem(_approved(), _amended(vendor="VEN-2"), vendor_on_gst_hold=True)
        self.assertTrue(problem.startswith(GST_HOLD_AMEND_REFUSAL))
        self.assertIn("VEN-2", problem)

    def test_amending_a_held_vendors_own_work_order_carries_on(self):
        """ADR-0028: a held vendor's existing Work Orders carry on; only swapping one in is refused."""
        self.assertIsNone(self._problem(_approved(), _amended(work_order_items=_rate(600.0)),
                                        vendor_on_gst_hold=True))

    def test_saves_outside_an_amendment_are_not_held_to_these_rules(self):
        before = _approved(amount_paid=4000.0)
        self.assertIsNone(
            self._problem(before, {**before, "invoice_no": "INV-1"}, open_payments=(("PAY-1", "Requested"),))
        )


class TestPaymentsWaitForTheAmendment(unittest.TestCase):
    def test_a_payment_request_on_a_work_order_under_amendment_is_refused(self):
        self.assertTrue(payment_request_problem("SR-1", "Amendment").startswith(UNDER_AMENDMENT_PAYMENT_REFUSAL))
        for status in ("Approved", "Vendor Selected"):
            with self.subTest(status=status):
                self.assertIsNone(payment_request_problem("SR-1", status))


class TestWhatARevertRestores(unittest.TestCase):
    """The Work Order before the amendment, read from its snapshot (the Version of the amend save)."""

    OLD_ROW = {"name": "row-1", "idx": 1, "parent": "SR-1", "parenttype": "Service Requests",
               "parentfield": "work_order_items", "modified": "2026-10-01", "item_name": "Plaster",
               "category": "Civil", "uom": "Sqm", "quantity": 10.0, "rate": 500.0}
    NEW_ROW = {**OLD_ROW, "name": "row-9", "item_name": "Paint", "category": "Painting", "rate": 900.0}

    def test_the_amend_sheet_save_restores_items_vendor_categories_and_nirmaan_gst(self):
        snapshot = {
            "changed": [
                ["vendor", "VEN-1", "VEN-2"],
                ["service_category_list", {"list": [{"name": "Civil"}]}, {"list": [{"name": "Painting"}]}],
                ["project_gst", "29ABFCS9095N1Z9", "27ABFCS9095N1Z1"],
                ["status", "Approved", "Amendment"],
            ],
            "added": [["work_order_items", self.NEW_ROW]],
            "removed": [["work_order_items", self.OLD_ROW]],
        }
        self.assertEqual(
            pre_amendment_values(snapshot, [self.NEW_ROW]),
            {
                "vendor": "VEN-1",
                "service_category_list": {"list": [{"name": "Civil"}]},
                "project_gst": "29ABFCS9095N1Z9",
                "work_order_items": [
                    {"item_name": "Plaster", "category": "Civil", "uom": "Sqm", "quantity": 10.0, "rate": 500.0}
                ],
            },
        )

    def test_a_row_edited_in_place_gets_its_old_values_back_and_untouched_rows_stay(self):
        kept = {**self.OLD_ROW, "name": "row-2", "idx": 2, "item_name": "Tiles"}
        edited = {**self.OLD_ROW, "rate": 450.0}
        snapshot = {
            "changed": [["status", "Approved", "Amendment"]],
            "row_changed": [["work_order_items", 1, "row-1", [["rate", 500.0, 450.0]]]],
        }
        restored = pre_amendment_values(snapshot, [edited, kept])["work_order_items"]
        self.assertEqual([(r["item_name"], r["rate"]) for r in restored], [("Plaster", 500.0), ("Tiles", 500.0)])

    def test_an_amendment_that_left_the_items_alone_does_not_touch_them(self):
        snapshot = {"changed": [["vendor", "VEN-1", "VEN-2"], ["status", "Approved", "Amendment"]]}
        self.assertEqual(pre_amendment_values(snapshot, [self.OLD_ROW]), {"vendor": "VEN-1"})


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
