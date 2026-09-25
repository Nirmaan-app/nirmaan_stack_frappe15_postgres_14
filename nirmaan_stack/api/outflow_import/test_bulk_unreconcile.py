# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Bulk Unreconcile: undo the ticked lines (#1320, parent #1317, ADR-0022 Amendment F).

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.outflow_import.test_bulk_unreconcile

Through `bulk_unreconcile_rows(rows, reason)`, the one bulk write. What is pinned is what a user sees:
each line undone whole or left Settled with a sentence, one line never stopping another.

⚠️ `set_value` / raw `INSERT` in the fixtures SKIP hooks ON PURPOSE: they fake "somebody changed this record
since" (a payment amount) or plant a vendor / PO link, exactly as the one-line suites this borrows from do. No
derived field they skip is asserted on.

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Everything a test makes is purged by the fixtures' tearDown.
"""

import json
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import cashbook as cb
from nirmaan_stack.api.outflow_import import unreconcile as unreconcile_module
from nirmaan_stack.api.outflow_import.bulk_unreconcile import (
    BULK_UNRECONCILE_LIMIT,
    NOT_SETTLED_REFUSAL,
    UNEXPECTED_REFUSAL,
    _status_label,
    bulk_unreconcile_rows,
    get_bulk_unreconcile_plan,
)
from nirmaan_stack.api.outflow_import.expenses import settle_row
from nirmaan_stack.api.outflow_import.test_cashbook_undo import CashbookUndoCase
from nirmaan_stack.api.outflow_import.test_inflows import InflowFixture
from nirmaan_stack.api.outflow_import.test_skip_row import ACCOUNTANT, ACCOUNTANT_LEAD
from nirmaan_stack.api.outflow_import.test_unreconcile_cleanup import CleanupFixture
from nirmaan_stack.api.outflow_import.test_unreconcile_payments import PaymentUnreconcileFixture
from nirmaan_stack.api.outflow_import.unreconcile import REASON_REQUIRED, unreconcile_row
from nirmaan_stack.api.vendor_credit import _compute_credit_used
from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import (
    _compute_cashflow_gap,
)
from nirmaan_stack.services.ceo_hold import core as ceo_hold
from nirmaan_stack.services.outflow_import.ledgers import VENDOR_REFUND_DOCTYPE
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)

ROW_DOCTYPE = "Outflow Import Row"
MATCH_DOCTYPE = "Outflow Row Match"
PAYMENT = "Project Payments"
PO = "Procurement Orders"
LEDGER = "Vendor Credit Ledger"
REASON = "the whole run went to the wrong bills"


def _comments(row):
    return frappe.get_all(
        "Comment",
        filters={"reference_doctype": ROW_DOCTYPE, "reference_name": row, "comment_type": "Comment"},
        pluck="content",
    )


def _by_row(result):
    return {entry["row"]: entry for entry in result["lines"]}


class BulkFixture(PaymentUnreconcileFixture):
    def tearDown(self):
        rows = getattr(self, "_bulk_rows", [])
        if rows:
            frappe.db.delete(
                "Comment", {"reference_doctype": ROW_DOCTYPE, "reference_name": ["in", rows]}
            )
            frappe.db.commit()
        super().tearDown()

    def _track(self, *rows):
        self._bulk_rows = getattr(self, "_bulk_rows", []) + list(rows)
        return rows

    def _confirmed(self, amount="100"):
        """A line settled by confirming its suggestion: it reopens Matched, keeping the pick."""
        pay = self._approved_payment(amount)
        row = self._staged_row(amount=amount)
        frappe.db.set_value(
            ROW_DOCTYPE, row, {"suggested_doctype": PAYMENT, "suggested_name": pay},
            update_modified=False,
        )
        frappe.db.commit()
        settle_row(row=row, target_doctype=PAYMENT, target_name=pay)
        self._track(row)
        return row, pay

    def _split(self):
        row, pays = self._allocated()
        self._track(row)
        return row, pays

    def _refused(self):
        """A split whose third payment was edited since: its undo is refused."""
        row, pays = self._split()
        frappe.db.set_value(PAYMENT, pays[2], "amount", 11.0, update_modified=False)
        frappe.db.commit()
        return row, pays

    def _status(self, row):
        return frappe.db.get_value(ROW_DOCTYPE, row, "row_status")

    def _live_legs(self, row):
        return frappe.db.count(MATCH_DOCTYPE, {"import_row": row, "match_kind": "Settled"})


class TestEachLineStandsOnItsOwn(BulkFixture):
    def test_three_lines_one_refused_two_undone_one_untouched(self):
        first, first_pay = self._confirmed()
        refused, refused_pays = self._refused()
        split, split_pays = self._split()
        refusal = next(
            leg["reason"]
            for leg in get_bulk_unreconcile_plan(rows=[refused])["lines"][0]["legs"]
            if leg["reason"]
        )

        result = bulk_unreconcile_rows(rows=json.dumps([first, refused, split]), reason=REASON)

        self.assertEqual(result["count"], 3)
        self.assertEqual([entry["row"] for entry in result["lines"]], [first, refused, split])
        lines = _by_row(result)
        self.assertTrue(lines[first]["undone"])
        self.assertTrue(lines[split]["undone"])
        self.assertFalse(lines[refused]["undone"])
        self.assertIn(refusal, lines[refused]["reason"])

        # The refused line is untouched: still Settled, every record still on it, Paid.
        self.assertEqual(self._status(refused), ROW_SETTLED)
        self.assertEqual(self._live_legs(refused), 3)
        for pay in refused_pays[:2]:
            self.assertEqual(self._payment(pay).status, "Paid")
        # The other two are undone whole, and every record is free.
        self._assert_free(first_pay)
        for pay in split_pays:
            self._assert_free(pay)
        self.assertEqual(self._live_legs(first), 0)
        self.assertEqual(self._live_legs(split), 0)

    def test_an_undone_entry_carries_the_one_line_response(self):
        row, pay = self._confirmed()
        [entry] = bulk_unreconcile_rows(rows=[row], reason=REASON)["lines"]
        self.assertEqual(entry["row_status"], ROW_MATCHED)
        self.assertEqual(entry["allocated"], 0.0)
        self.assertEqual(entry["remaining"], 100.0)
        self.assertTrue(entry["batch_status"])
        self.assertEqual([leg["target_name"] for leg in entry["reversed"]], [pay])

    def test_undone_lines_land_matched_and_confirm_by_hand(self):
        row, pay = self._confirmed()
        bulk_unreconcile_rows(rows=[row], reason=REASON)
        stored = frappe.db.get_value(
            ROW_DOCTYPE, row, ["row_status", "suggested_name", "confirm_by_hand"], as_dict=True
        )
        self.assertEqual(stored.row_status, ROW_MATCHED)
        self.assertEqual(stored.suggested_name, pay)
        self.assertEqual(stored.confirm_by_hand, 1)

    def test_the_reason_is_stamped_and_each_comment_names_the_bulk_run(self):
        first, first_pay = self._confirmed()
        split, _ = self._split()
        bulk_unreconcile_rows(rows=[first, split], reason=REASON)

        leg = frappe.db.get_value(
            MATCH_DOCTYPE, self._leg(first, first_pay), ["match_kind", "reversal_reason"], as_dict=True
        )
        self.assertEqual(leg.match_kind, "Reversed")
        self.assertEqual(leg.reversal_reason, REASON)
        for row in (first, split):
            [comment] = [c for c in _comments(row) if "Unreconciled by" in c]
            self.assertIn(REASON, comment)
            self.assertIn("(bulk unreconcile of 2 lines)", comment)

    def test_the_one_line_undo_comment_carries_no_bulk_note(self):
        row, _ = self._confirmed()
        unreconcile_row(row=row, legs="all", reason=REASON)
        [comment] = [c for c in _comments(row) if "Unreconciled by" in c]
        self.assertNotIn("bulk unreconcile", comment)

    def test_a_refused_line_queues_no_message_for_the_screen(self):
        refused, _ = self._refused()
        frappe.local.message_log = []
        bulk_unreconcile_rows(rows=[refused], reason=REASON)
        self.assertEqual(frappe.local.message_log, [])


class TestEveryLineIsRecheckedAtWriteTime(BulkFixture):
    def test_a_line_whose_record_changed_after_the_plan_is_blocked(self):
        row, pays = self._split()
        plan = get_bulk_unreconcile_plan(rows=[row])
        self.assertEqual(plan["lines"][0]["refused_count"], 0)
        frappe.db.set_value(PAYMENT, pays[0], "amount", 59.0, update_modified=False)
        frappe.db.commit()

        [entry] = bulk_unreconcile_rows(rows=[row], reason=REASON)["lines"]

        self.assertFalse(entry["undone"])
        self.assertTrue(entry["reason"])
        self.assertEqual(self._status(row), ROW_SETTLED)
        self.assertEqual(self._live_legs(row), 3)

    def test_a_line_no_longer_settled_is_blocked_with_its_status(self):
        row, pays = self._split()
        get_bulk_unreconcile_plan(rows=[row])
        # Someone undid one record of it since the check step.
        unreconcile_row(row=row, legs=[self._leg(row, pays[1])], reason="just this one")
        self.assertEqual(self._status(row), ROW_PARTIALLY_ALLOCATED)

        [entry] = bulk_unreconcile_rows(rows=[row], reason=REASON)["lines"]

        self.assertFalse(entry["undone"])
        self.assertEqual(entry["reason"], NOT_SETTLED_REFUSAL.format(status=ROW_PARTIALLY_ALLOCATED))
        self.assertEqual(self._status(row), ROW_PARTIALLY_ALLOCATED)
        self.assertEqual(self._live_legs(row), 2)

    def test_a_line_that_no_longer_exists_is_blocked_on_its_own(self):
        row, pay = self._confirmed()
        lines = _by_row(bulk_unreconcile_rows(rows=["NOT-A-ROW", row], reason=REASON))
        self.assertFalse(lines["NOT-A-ROW"]["undone"])
        self.assertTrue(lines[row]["undone"])
        self._assert_free(pay)


class TestAnErrorAfterTheCommit(BulkFixture):
    def test_a_line_undone_before_a_failure_is_reported_undone(self):
        row, pay = self._confirmed()
        with patch.object(unreconcile_module, "_amount_after", side_effect=RuntimeError("read-back failed")):
            [entry] = bulk_unreconcile_rows(rows=[row], reason=REASON)["lines"]
        self.assertTrue(entry["undone"])
        self.assertEqual(entry["row_status"], ROW_MATCHED)
        self.assertEqual(entry["reversed"], [])
        self._assert_free(pay)
        frappe.db.delete("Error Log", {"method": f"Bulk unreconcile: {row}"})
        frappe.db.commit()

    def test_the_mismatched_status_reads_as_the_screen_names_it(self):
        self.assertEqual(_status_label(ROW_MISMATCHED), "Not-Matched")
        self.assertEqual(_status_label(ROW_PARTIALLY_ALLOCATED), ROW_PARTIALLY_ALLOCATED)


class TestAnErrorMidWrite(BulkFixture):
    def test_it_rolls_back_only_that_line(self):
        first, first_pay = self._confirmed()
        broken, broken_pays = self._split()
        last, last_pay = self._confirmed()
        real = unreconcile_module._carry_out
        calls = {"broken": 0}

        def breaks_on_the_second_leg(verdict, leg, *args, **kwargs):
            if leg.import_row == broken:
                calls["broken"] += 1
                if calls["broken"] == 2:
                    raise RuntimeError("a hook failed half way through the line")
            return real(verdict, leg, *args, **kwargs)

        with patch.object(unreconcile_module, "_carry_out", side_effect=breaks_on_the_second_leg):
            lines = _by_row(
                bulk_unreconcile_rows(rows=[first, broken, last], reason=REASON)
            )

        self.assertEqual(calls["broken"], 2)
        self.assertFalse(lines[broken]["undone"])
        self.assertEqual(lines[broken]["reason"], UNEXPECTED_REFUSAL)
        # The broken line's first leg, already written in the savepoint, went back with it.
        self.assertEqual(self._status(broken), ROW_SETTLED)
        self.assertEqual(self._live_legs(broken), 3)
        for pay in broken_pays:
            self.assertEqual(self._payment(pay).status, "Paid")
        # Lines on either side stay undone.
        for row, pay in ((first, first_pay), (last, last_pay)):
            self.assertTrue(lines[row]["undone"])
            self._assert_free(pay)
        frappe.db.delete("Error Log", {"method": f"Bulk unreconcile: {broken}"})
        frappe.db.commit()


class TestWhatItRefuses(BulkFixture):
    def test_an_empty_reason_is_refused_and_nothing_is_written(self):
        row, _ = self._confirmed()
        for reason in ("", "   "):
            with self.assertRaises(frappe.ValidationError) as caught:
                bulk_unreconcile_rows(rows=[row], reason=reason)
            self.assertIn(REASON_REQUIRED, str(caught.exception))
        self.assertEqual(self._status(row), ROW_SETTLED)

    def test_more_than_the_limit_is_refused_and_nothing_is_written(self):
        row, _ = self._confirmed()
        too_many = [row] + [f"NOT-A-ROW-{i}" for i in range(BULK_UNRECONCILE_LIMIT)]
        with self.assertRaises(frappe.ValidationError) as caught:
            bulk_unreconcile_rows(rows=too_many, reason=REASON)
        self.assertIn(str(BULK_UNRECONCILE_LIMIT), str(caught.exception))
        self.assertEqual(self._status(row), ROW_SETTLED)

    def test_a_line_that_is_not_settled_is_refused(self):
        open_row = self._staged_row(amount="100")
        self._track(open_row)
        before = self._status(open_row)
        [entry] = bulk_unreconcile_rows(rows=[open_row], reason=REASON)["lines"]
        self.assertFalse(entry["undone"])
        self.assertEqual(entry["reason"], NOT_SETTLED_REFUSAL.format(status=_status_label(before)))
        self.assertEqual(self._status(open_row), before)

    def test_a_plain_accountant_is_refused(self):
        row, _ = self._confirmed()
        frappe.set_user(self.users.make(ACCOUNTANT))
        try:
            with self.assertRaises(frappe.PermissionError):
                bulk_unreconcile_rows(rows=[row], reason=REASON)
        finally:
            frappe.set_user("Administrator")
        self.assertEqual(self._status(row), ROW_SETTLED)

    def test_an_accountant_lead_may_run_it(self):
        row, pay = self._confirmed()
        frappe.set_user(self.users.make(ACCOUNTANT_LEAD))
        try:
            [entry] = bulk_unreconcile_rows(rows=[row], reason=REASON)["lines"]
        finally:
            frappe.set_user("Administrator")
        self.assertTrue(entry["undone"])
        self._assert_free(pay)

    def test_it_is_whitelisted_for_post_only(self):
        from frappe import allowed_http_methods_for_whitelisted_func, whitelisted

        self.assertIn(bulk_unreconcile_rows, whitelisted)
        self.assertEqual(allowed_http_methods_for_whitelisted_func[bulk_unreconcile_rows], ["POST"])


class TestCleanupRunsPerLine(CleanupFixture):
    """Vendor credit and CEO Hold are put right on every line, not once for the run."""

    def setUp(self):
        super().setUp()
        self.vendor = f"TEST-OFI-BULK-VEN-{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            """INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner,
                   docstatus, idx, vendor_name, vendor_category, credit_used, available_credit)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s,
                   '{"categories": []}', 0, 50000)""",
            (self.vendor, self.vendor),
        )
        frappe.db.set_value(
            PO,
            self._allocation_po(),
            {"vendor": self.vendor, "status": "PO Approved", "po_amount_delivered": 100},
            update_modified=False,
        )
        frappe.db.commit()

    def tearDown(self):
        # ⚠️ NEVER `self.rows or [""]` here (the cad54f738 rule): `reference_name` is a nullable
        # Dynamic Link, so an `in ('')` filter would sweep every Comment on an import row with no
        # reference. A test that fails before it sets `rows` simply has nothing to clean.
        if self.rows:
            frappe.db.delete(
                "Comment", {"reference_doctype": ROW_DOCTYPE, "reference_name": ["in", self.rows]}
            )
            frappe.db.commit()
        super().tearDown()

    rows = None

    def test_vendor_credit_and_ceo_hold_equal_a_fresh_recompute_after_the_run(self):
        first, _ = self._one_settled_payment("60")
        second, _ = self._one_settled_payment("30")
        self.rows = [first, second]
        project = self._allocation_project()
        frappe.db.set_value("Projects", project, "cashflow_gap_limit", 35, update_modified=False)
        ceo_hold.set_reason(project, ceo_hold.SOURCE_CASHFLOW, ceo_hold.cashflow_reason_text(90, 35))
        frappe.db.commit()
        frappe.flags.pop(f"ceo_hold_checked:{project}", None)
        before = frappe.get_all(LEDGER, {"parent": self.vendor}, pluck="name")

        result = bulk_unreconcile_rows(rows=[first, second], reason=REASON)

        self.assertTrue(all(entry["undone"] for entry in result["lines"]))
        vendor = frappe.get_doc("Vendors", self.vendor)
        self.assertEqual(float(vendor.credit_used), float(_compute_credit_used(vendor)))
        self.assertEqual(float(vendor.credit_used), 100.0)
        entries = frappe.get_all(
            LEDGER,
            filters={"parent": self.vendor, "name": ["not in", before or [""]]},
            fields=["entry_type", "delta_amount"],
        )
        # One ledger entry per line: the clean-up ran once for each.
        self.assertEqual(sorted(float(e.delta_amount) for e in entries), [30.0, 60.0])
        self.assertTrue(all(e.entry_type == "Payment Unreconciled" for e in entries))
        gap = _compute_cashflow_gap(project)
        self.assertEqual(ceo_hold.SOURCE_CASHFLOW in ceo_hold.active_sources(project), gap > 35)


class TestACashbookImportUndoneWhole(CashbookUndoCase):
    def test_every_line_lands_not_matched_with_no_pick(self):
        settled = [r.name for r in self._rows(row_status=ROW_SETTLED)]
        self.assertGreater(len(settled), 1)
        created = [self._leg(row) for row in settled]

        result = bulk_unreconcile_rows(rows=settled, reason=REASON)

        self.assertTrue(all(entry["undone"] for entry in result["lines"]), result)
        for row, leg in zip(settled, created):
            self.assertFalse(frappe.db.exists(leg.target_doctype, leg.target_name))
            stored = self._stored(row)
            self.assertEqual(stored.row_status, ROW_MISMATCHED)
            self.assertFalse(stored.suggested_name)
            self.assertEqual(stored.confirm_by_hand, 1)
        self.assertEqual(
            {entry["row_status"] for entry in result["lines"]}, {ROW_MISMATCHED}
        )
        # The job leaves them alone afterwards.
        cb._cashbook_worker(self.batch, "Administrator")
        for row in settled:
            self.assertEqual(self._stored(row).row_status, ROW_MISMATCHED)


class TestAVendorRefundLine(InflowFixture):
    def test_it_is_undone_whole(self):
        first, second = self.refund_pos
        row, summary = self._refund(allocations=[self._po(first, "600"), self._po(second, "400")])
        names = [r["name"] for r in summary["records"]]

        [entry] = bulk_unreconcile_rows(rows=[row["name"]], reason="test: bulk vendor refund")["lines"]

        self.assertTrue(entry["undone"], entry)
        self.assertEqual([leg["verdict"] for leg in entry["reversed"]], ["delete_created"] * 2)
        for name in names:
            self.assertFalse(frappe.db.exists(VENDOR_REFUND_DOCTYPE, name))
        self.assertNotEqual(frappe.db.get_value(ROW_DOCTYPE, row["name"], "row_status"), ROW_SETTLED)
