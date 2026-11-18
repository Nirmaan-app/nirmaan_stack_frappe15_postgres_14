# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Every reject saves its reason on the payment (`rejection_reason`), and the 30-day rule rejects an Online
payment nobody approved (`services/stale_payment_reject.py`).

Written to BREAK the feature, not to walk it: the 30-day boundary to the day, every status and mode the
rule must leave alone, a CEO Hold project, a payment on a live cheque, an approval that lands between the
selection and the reject, one payment that fails while the rest go on, a second run, a dry run, and every
reject path (single save, bulk L1, cheque) writing the field, plus the queue's column and counts.

⚠️ RUNS AGAINST THE ENV DATABASE. Rows are planted and purged by `PendingChequeCase`'s fixtures, on their
own project. ⚠️ THE RULE'S SELECTION IS REAL BUT FILTERED TO THIS TEST'S PAYMENTS (`_only_mine`): an
unfiltered run would reject every real stale payment on the site.
"""

from unittest.mock import patch

import frappe
from frappe.utils import add_days, getdate, nowdate

from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue, get_approval_queue_counts
from nirmaan_stack.api.payments.bulk_actions import bulk_lead_approve_payments
from nirmaan_stack.api.payments.cheque_approval import reject_cheque_payments
from nirmaan_stack.api.payments.test_cheque_approval import PAYMENT, PendingChequeCase
from nirmaan_stack.integrations.controllers import project_payments as rule_controller
from nirmaan_stack.services import stale_payment_reject as rule

MODULE = "nirmaan_stack.services.stale_payment_reject"
TODAY = getdate(nowdate())


class RejectionReasonCase(PendingChequeCase):
    def setUp(self):
        super().setUp()
        self.mine: set[str] = set()

    # -- planting -------------------------------------------------------------------------------
    def _aged(self, days_ago: int, status: str = "Requested", amount: float = 20000, mode: str | None = "Online"):
        """A PO payment requested `days_ago` days ago (at noon, so the time of day never decides a boundary)."""
        name = self._payment(amount, status)
        requested = f"{add_days(TODAY, -days_ago)} 12:00:00"
        frappe.db.sql(
            'UPDATE "tabProject Payments" SET creation = %s, mode_of_payment = %s WHERE name = %s',
            (requested, mode, name),
        )
        frappe.db.commit()
        self.mine.add(name)
        return name

    def _only_mine(self):
        """The rule's real selection, filtered to this test's payments."""
        real = rule.select_stale
        return patch.object(rule, "select_stale", side_effect=lambda today=None: [
            r for r in real(today) if r.name in self.mine
        ])

    def _selected(self, today=TODAY):
        return sorted(r.name for r in rule.select_stale(today) if r.name in self.mine)

    def _reason(self, payment):
        return frappe.db.get_value(PAYMENT, payment, "rejection_reason")

    def _comments(self, payment):
        return frappe.get_all(
            "Comment",
            filters={"reference_doctype": PAYMENT, "reference_name": payment, "comment_type": "Comment"},
            pluck="content",
        )


class TestWhichPaymentsTheRuleSelects(RejectionReasonCase):
    def test_the_30_day_boundary_to_the_day(self):
        day_30, day_31, day_45 = self._aged(30), self._aged(31), self._aged(45)
        # 30 days after the request it can still be approved; from day 31 it is stale.
        self.assertEqual(self._selected(), sorted([day_31, day_45]))
        # The next day the 30-day one is stale too.
        self.assertEqual(self._selected(add_days(TODAY, 1)), sorted([day_30, day_31, day_45]))

    def test_the_boundary_ignores_the_time_of_day(self):
        early, late = self._aged(31), self._aged(30)
        frappe.db.sql('UPDATE "tabProject Payments" SET creation = %s WHERE name = %s',
                      (f"{add_days(TODAY, -31)} 23:59:59", early))
        frappe.db.sql('UPDATE "tabProject Payments" SET creation = %s WHERE name = %s',
                      (f"{add_days(TODAY, -30)} 00:00:00", late))
        frappe.db.commit()
        self.assertEqual(self._selected(), [early])

    def test_only_requested_and_ceo_pending(self):
        requested, ceo = self._aged(40, "Requested"), self._aged(40, "CEO Pending", amount=60000)
        for status in ("Approved", "Reconciliation Pending", "Paid", "Rejected"):
            self._aged(40, status)
        self.assertEqual(self._selected(), sorted([requested, ceo]))

    def test_never_a_cheque_payment_and_an_empty_mode_counts_as_online(self):
        online, blank, null = self._aged(40), self._aged(40, mode=""), self._aged(40, mode=None)
        self._aged(40, mode="Cheque")
        self.assertEqual(self._selected(), sorted([online, blank, null]))

    def test_never_on_a_ceo_hold_project(self):
        self._aged(40)
        frappe.db.set_value("Projects", self.project, "status", "CEO Hold", update_modified=False)
        frappe.db.commit()
        self.assertEqual(self._selected(), [])

    def test_the_rule_is_not_callable_from_the_browser(self):
        self.assertNotIn(rule.reject_stale_payments, frappe.whitelisted)
        self.assertNotIn(rule.run_nightly, frappe.whitelisted)


class TestTheRuleRejects(RejectionReasonCase):
    def test_a_stale_payment_is_rejected_with_the_reason_like_a_persons_reject(self):
        stale, fresh = self._aged(31), self._aged(5)

        with self._only_mine():
            out = rule.reject_stale_payments()

        self.assertEqual(out["rejected"], [stale])
        self.assertEqual(out["failed"], [])
        self.assertEqual(self._statuses(stale, fresh), ["Rejected", "Requested"])
        self.assertEqual(self._reason(stale), rule.REASON)
        self.assertFalse(self._reason(fresh))
        # The same save a person's reject runs: the PO term follows.
        self.assertEqual(self._terms(stale, fresh), ["Rejected", "Requested"])
        self.assertEqual(self._comments(stale), [f"Rejected: {rule.REASON}"])

    def test_a_ceo_pending_payment_is_rejected_too(self):
        ceo = self._aged(60, "CEO Pending", amount=75000)
        with self._only_mine():
            rule.reject_stale_payments()
        self.assertEqual(self._statuses(ceo), ["Rejected"])
        self.assertEqual(self._reason(ceo), rule.REASON)

    def test_a_dry_run_writes_nothing_and_lists_what_it_would_reject(self):
        stale = self._aged(31)
        with self._only_mine():
            out = rule.reject_stale_payments(dry_run=True)
        self.assertEqual([r["name"] for r in out["rows"]], [stale])
        self.assertEqual(out["rows"][0]["requested_on"], str(add_days(TODAY, -31)))
        self.assertEqual((out["rejected"], out["failed"], out["skipped"]), ([], [], []))
        self.assertEqual(self._statuses(stale), ["Requested"])
        self.assertFalse(self._reason(stale))
        self.assertEqual(self._comments(stale), [])

    def test_a_second_run_finds_nothing(self):
        stale = self._aged(31)
        with self._only_mine():
            rule.reject_stale_payments()
            again = rule.reject_stale_payments()
        self.assertEqual(again["selected"], 0)
        self.assertEqual(self._comments(stale), [f"Rejected: {rule.REASON}"])

    def test_an_approval_landing_after_the_selection_wins(self):
        stale = self._aged(31)
        real = rule.select_stale

        def select_then_approve(today=None):
            rows = [r for r in real(today) if r.name in self.mine]
            # The CEO / an approver acts between the selection and the reject.
            frappe.db.set_value(PAYMENT, stale, "status", "Approved", update_modified=False)
            return rows

        with patch.object(rule, "select_stale", side_effect=select_then_approve):
            out = rule.reject_stale_payments()

        self.assertEqual(out["rejected"], [])
        self.assertEqual(out["skipped"], [{"name": stale, "reason": "Status is now Approved"}])
        self.assertEqual(self._statuses(stale), ["Approved"])
        self.assertFalse(self._reason(stale))

    def test_a_payment_switched_to_cheque_after_the_selection_is_skipped(self):
        stale = self._aged(31)
        real = rule.select_stale

        def select_then_switch(today=None):
            rows = [r for r in real(today) if r.name in self.mine]
            frappe.db.set_value(PAYMENT, stale, "mode_of_payment", "Cheque", update_modified=False)
            return rows

        with patch.object(rule, "select_stale", side_effect=select_then_switch):
            out = rule.reject_stale_payments()
        self.assertEqual(out["skipped"], [{"name": stale, "reason": "Mode of payment is now Cheque"}])
        self.assertEqual(self._statuses(stale), ["Requested"])

    def test_a_payment_on_a_live_cheque_is_never_rejected_alone(self):
        # An Online-mode row on a Pending Payment cheque: rejecting it alone would cascade over the cheque.
        on_cheque = self._aged(31)
        cheque = self._cheque((on_cheque, 20000))
        frappe.db.set_value(PAYMENT, on_cheque, "mode_of_payment", "Online", update_modified=False)
        frappe.db.commit()

        with self._only_mine():
            out = rule.reject_stale_payments()

        self.assertEqual(out["rejected"], [])
        self.assertEqual(self._statuses(on_cheque), ["Requested"])
        self.assertEqual(frappe.db.get_value("Cheques", cheque, "status"), "Approval Pending")

    def test_one_failing_payment_does_not_stop_the_rest_and_is_left_untouched(self):
        a, b, c = self._aged(40), self._aged(35), self._aged(31)
        real_one = rule._reject_one

        def fail_on_b(row, cutoff):
            if row.name == b:
                # Half-written, then a failure: the savepoint must undo the half.
                frappe.db.set_value(PAYMENT, b, "rejection_reason", "half written", update_modified=False)
                raise frappe.ValidationError("boom")
            return real_one(row, cutoff)

        with self._only_mine(), patch.object(rule, "_reject_one", side_effect=fail_on_b):
            out = rule.reject_stale_payments()

        self.assertEqual(sorted(out["rejected"]), sorted([a, c]))
        self.assertEqual(out["failed"], [{"name": b, "reason": "boom"}])
        self.assertEqual(self._statuses(a, b, c), ["Rejected", "Requested", "Rejected"])
        self.assertFalse(self._reason(b))
        self.assertTrue(frappe.db.exists("Error Log", {"method": f"Stale payment reject failed ({b})"}))
        frappe.db.delete("Error Log", {"method": f"Stale payment reject failed ({b})"})
        frappe.db.commit()

    def test_a_payment_whose_po_term_does_not_follow_is_rolled_back_and_reported(self):
        """The save's term sync only LOGS a failed PO save (`_find_and_update_po_term`); the rule must not count such a
        payment as rejected while its term still waits."""
        stuck, fine = self._aged(40), self._aged(35)
        real_sync = rule_controller._find_and_update_po_term

        def sync_except_stuck(payment_doc, new_status, clear_link=False):
            if payment_doc.name == stuck:
                return  # the PO save "failed" and was only logged
            return real_sync(payment_doc, new_status, clear_link)

        with self._only_mine(), patch.object(rule_controller, "_find_and_update_po_term", side_effect=sync_except_stuck):
            out = rule.reject_stale_payments()

        self.assertEqual(out["rejected"], [fine])
        self.assertEqual([f["name"] for f in out["failed"]], [stuck])
        self.assertIn("stayed Requested", out["failed"][0]["reason"])
        self.assertEqual(self._statuses(stuck, fine), ["Requested", "Rejected"])
        self.assertEqual(self._terms(stuck, fine), ["Requested", "Rejected"])
        self.assertFalse(self._reason(stuck))
        self.assertEqual(self._comments(stuck), [])
        frappe.db.delete("Error Log", {"method": f"Stale payment reject failed ({stuck})"})
        frappe.db.commit()

    def test_deleting_the_rejected_payment_frees_its_term(self):
        # A delete recounts the vendor's credit and saves the vendor, whose category hook needs the field a real
        # vendor always has (the fixture's bare vendor has none); same setup as test_cheque_request.
        frappe.db.set_value("Vendors", self.vendor, "vendor_category", '{"categories": []}', update_modified=False)
        frappe.db.commit()
        stale = self._aged(31)
        with self._only_mine():
            rule.reject_stale_payments()
        term = frappe.db.get_value("PO Payment Terms", {"project_payment": stale}, "name")
        frappe.delete_doc(PAYMENT, stale, ignore_permissions=True)
        frappe.db.commit()
        self.assertEqual(frappe.db.get_value("PO Payment Terms", term, "term_status"), "Created")

    def test_the_nightly_entry_point_runs_the_rule(self):
        stale = self._aged(31)
        with self._only_mine():
            out = rule.run_nightly()
        self.assertEqual(out["rejected"], [stale])
        self.assertEqual(self._statuses(stale), ["Rejected"])


class TestEveryRejectSavesItsReason(RejectionReasonCase):
    def test_a_single_reject_saves_the_typed_reason(self):
        """The approve dialog's L1 / CEO reject: a plain save of the status with the reason."""
        p = self._payment(20000)
        doc = frappe.get_doc(PAYMENT, p)
        doc.update({"status": "Rejected", "rejection_reason": "Rate not agreed with vendor"})
        doc.save()
        frappe.db.commit()
        self.assertEqual(self._reason(p), "Rate not agreed with vendor")
        self.assertEqual(self._terms(p), ["Rejected"])
        # The same timeline comment bulk and cheque reject write, exactly once.
        self.assertEqual(self._comments(p), ["Rejected: Rate not agreed with vendor"])

    def test_a_reject_with_no_reason_writes_no_comment(self):
        """Desk, REST or an old cached screen can still save Rejected without a reason (the field is not mandatory)."""
        p = self._payment(20000)
        doc = frappe.get_doc(PAYMENT, p)
        doc.status = "Rejected"
        doc.save()
        frappe.db.commit()
        self.assertEqual(self._statuses(p), ["Rejected"])
        self.assertFalse(self._reason(p))
        self.assertEqual(self._comments(p), [])

    def test_bulk_reject_saves_the_reason_on_every_payment(self):
        a, b = self._payment(20000), self._payment(25000)
        out = bulk_lead_approve_payments([a, b], "reject", "  Duplicate request  ")
        self.assertEqual(sorted(out["data"]["succeeded"]), sorted([a, b]))
        # The field is trimmed...
        self.assertEqual([self._reason(a), self._reason(b)], ["Duplicate request"] * 2)
        # ...and the timeline comment stays exactly as before this change: the reason as typed, untrimmed.
        # One comment only: the save hook stays out of a bulk save (`bulk_approval`).
        self.assertEqual(self._comments(a), ["Rejected:   Duplicate request  "])

    def test_bulk_approve_writes_no_reason(self):
        a = self._payment(20000)
        bulk_lead_approve_payments([a], "approve")
        self.assertFalse(self._reason(a))

    def test_a_cheque_reject_saves_the_reason_on_every_payment_on_it(self):
        a, b = self._payment(15000), self._payment(15000)
        self._cheque((a, 15000), (b, 15000))
        reject_cheque_payments(a, "Cheque book lost")
        self.assertEqual([self._reason(a), self._reason(b)], ["Cheque book lost"] * 2)
        # One comment each: the cheque writes it, the save hook stays out (`DECIDING_FLAG`).
        self.assertEqual([self._comments(a), self._comments(b)], [["Rejected: Cheque book lost"]] * 2)


class TestTheQueueShowsTheReason(RejectionReasonCase):
    def test_the_row_carries_the_reason(self):
        p = self._aged(31)
        with self._only_mine():
            rule.reject_stale_payments()
        page = get_approval_queue(filters=[["name", "=", p]])
        self.assertEqual([r["rejection_reason"] for r in page["data"]], [rule.REASON])

    def test_an_unrejected_row_carries_an_empty_reason(self):
        p = self._payment(20000)
        page = get_approval_queue(filters=[["name", "=", p]])
        self.assertEqual([r["rejection_reason"] for r in page["data"]], [""])

    def test_the_rejected_view_filter_and_the_by_me_counts(self):
        before = get_approval_queue_counts()
        p = self._aged(31)
        mid = get_approval_queue_counts()
        with self._only_mine():
            rule.reject_stale_payments()
        after = get_approval_queue_counts()

        self.assertEqual(sum(after["by_me_counts"].values()), after["by_me"])
        self.assertEqual(mid["by_me"], before["by_me"] + 1)
        self.assertEqual(after["by_me_counts"].get("Rejected", 0), mid["by_me_counts"].get("Rejected", 0) + 1)
        self.assertEqual(after["by_me_counts"].get("Requested", 0), mid["by_me_counts"].get("Requested", 0) - 1)

        rejected_view = get_approval_queue(
            filters=[["raised_by", "=", "@me"], ["status", "=", "Rejected"], ["name", "=", p]]
        )
        self.assertEqual([r["name"] for r in rejected_view["data"]], [p])
        paid_view = get_approval_queue(filters=[["raised_by", "=", "@me"], ["status", "=", "Paid"], ["name", "=", p]])
        self.assertEqual(paid_view["data"], [])
