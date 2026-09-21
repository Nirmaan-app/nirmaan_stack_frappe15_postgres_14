"""Payments dashboard stats -- the Non-Project Inflow (30 days) figure (#1267, ADR-0016 A-D4)
and Total Unreconciled Outflow (#1286).

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.payments.test_payment_dashboard_stats

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, which already holds real inflows and expenses. Every assertion
is therefore a DELTA: read the stats, insert a record, read again. Each record inserted here is purged
in `tearDownClass` together with its `Version` rows (the doctype carries `track_changes`).
"""

import unittest

import frappe
from frappe.utils import add_days, today

from nirmaan_stack.api.outflow_import.review import get_outflow_summary
from nirmaan_stack.api.payments.get_project_payment_summary import get_payment_dashboard_stats
from nirmaan_stack.services.outflow_import.parser import (
    BANK_SUCCESS_STATUS,
    DIRECTION_CREDIT,
    DIRECTION_DEBIT,
)
from nirmaan_stack.services.outflow_import.status import (
    ACTIVE_ROW_STATUSES,
    ROW_ERROR,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_PENDING_MATCH,
    ROW_SETTLED,
    ROW_SKIPPED,
)

DOCTYPE = "Non Project Inflows"

BATCH_DOCTYPE = "Outflow Import Batch"
ROW_DOCTYPE = "Outflow Import Row"


class TestNonProjectInflowDashboardFigure(unittest.TestCase):
    created: list = []

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.created = []

    @classmethod
    def tearDownClass(cls):
        # Raw deletes skip the doctype's hooks on purpose: its only hook is `on_update` (receipt
        # adoption), nothing runs on delete, and these rows carry no receipt.
        for name in cls.created:
            frappe.db.delete("Version", {"ref_doctype": DOCTYPE, "docname": name})
            frappe.db.delete(DOCTYPE, {"name": name})
        frappe.db.commit()
        super().tearDownClass()

    def _insert(self, payment_date, amount):
        doc = frappe.get_doc({
            "doctype": DOCTYPE,
            "inflow_type": "Interest Payouts",
            "amount": amount,
            "payment_date": payment_date,
            "utr": f"TEST-DASH-{frappe.generate_hash(length=8)}",
        })
        doc.insert(ignore_permissions=True)
        self.created.append(doc.name)
        return doc

    def _delta(self, before, after, key):
        return after[key] - before[key]

    def test_a_record_inside_the_window_is_counted(self):
        before = get_payment_dashboard_stats()
        self._insert(today(), 12345)
        after = get_payment_dashboard_stats()
        self.assertEqual(self._delta(before, after, "total_non_project_inflow_30_days_count"), 1)
        self.assertAlmostEqual(self._delta(before, after, "total_non_project_inflow_30_days_amount"), 12345)

    def test_the_window_is_thirty_days_inclusive(self):
        # The window starts at today - 29, the same inclusive 30 days every other 30-day figure uses.
        before = get_payment_dashboard_stats()
        self._insert(add_days(today(), -29), 700)
        self._insert(add_days(today(), -30), 900)
        self._insert(add_days(today(), -45), 1100)
        after = get_payment_dashboard_stats()
        self.assertEqual(self._delta(before, after, "total_non_project_inflow_30_days_count"), 1)
        self.assertAlmostEqual(self._delta(before, after, "total_non_project_inflow_30_days_amount"), 700)

    def test_non_project_outflow_is_not_netted(self):
        before = get_payment_dashboard_stats()
        self._insert(today(), 5000)
        after = get_payment_dashboard_stats()
        self.assertEqual(self._delta(before, after, "total_non_project_expense_30_days_count"), 0)
        self.assertAlmostEqual(self._delta(before, after, "total_non_project_expense_30_days_amount"), 0)

    def test_project_inflow_is_not_touched(self):
        before = get_payment_dashboard_stats()
        self._insert(today(), 5000)
        after = get_payment_dashboard_stats()
        self.assertEqual(self._delta(before, after, "total_inflow_30_days_count"), 0)
        self.assertAlmostEqual(self._delta(before, after, "total_inflow_30_days_amount"), 0)


class TestTotalUnreconciledOutflow(unittest.TestCase):
    """The card's **Total Unreconciled Outflow** figure (#1286).

    ⚠️ IT MUST EQUAL BULK IMPORT'S OWN *Still open / Paid out* WITH NO FILTERS, and the equality
    test below is the point of this class -- not the per-status deltas beside it. The two screens
    are allowed to disagree about nothing, so the assertion is EQUALITY against the real import
    endpoint, never a re-implementation of the population rule in the test. A test that re-spells
    the rule to check the rule passes whenever the two spellings agree, which is not the question.

    ⚠️ THE PLANTED FIXTURE SPANS SEVERAL STATUSES, BOTH DIRECTIONS AND MORE THAN ONE SOURCE, and
    every one of those axes is load-bearing: the figure is a cut of the open statuses on the Paid
    side over every import, so a fixture with one status, one direction or one batch could not tell
    a correct implementation from several wrong ones.

    ⚠️ RUNS AGAINST THE LIVE SITE DATABASE, so the per-status assertions are DELTAS. The equality
    assertion is not, and does not need to be: it holds over whatever the site already contains.
    """

    #: Every row this suite stages carries it, and the sweep below keys on it.
    #
    # ⚠️ THE SWEEP RUNS AT setUp AS WELL AS tearDown, AND THAT IS LOAD-BEARING HERE IN A WAY IT IS
    # NOT FOR THE INFLOW FIXTURES ABOVE. These rows are staged with an OPEN status on the paid side,
    # so they land in an ALL-TIME, UNFILTERED figure that a real person reads on the Payments card
    # and on Bulk Import -- a run interrupted between a commit and `tearDownClass` would inflate
    # both, permanently, with nothing to tell the leftovers from real bank lines except this
    # prefix. Sweeping first makes a previous crashed run self-heal instead of accumulating.
    TRANSFER_PREFIX = "TEST-1286-"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._sweep()

    @classmethod
    def tearDownClass(cls):
        cls._sweep()
        super().tearDownClass()

    @classmethod
    def _sweep(cls):
        """Delete every row this suite could have staged, then the batches left empty by it.

        Keys on the transfer-id prefix rather than on a tracked list, so it also reaches rows a
        PREVIOUS interrupted run committed and never tracked.
        """
        stale = frappe.db.sql(
            """SELECT name, import_batch FROM "tabOutflow Import Row" WHERE transfer_id LIKE %s""",
            (cls.TRANSFER_PREFIX + "%",),
            as_dict=True,
        )
        for row in stale:
            frappe.db.delete(ROW_DOCTYPE, {"name": row["name"]})
        # ⚠️ ONLY BATCHES THIS SUITE NAMED, and only once their rows are gone. A batch is deleted
        # by its own `original_filename` marker, never by "has no rows left" -- a real import whose
        # rows were all settled has no open rows either.
        for name in frappe.db.sql_list(
            """SELECT name FROM "tabOutflow Import Batch" WHERE original_filename LIKE %s""",
            (cls.TRANSFER_PREFIX + "%",),
        ):
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        frappe.db.commit()

    @classmethod
    def _batch(cls, source: str) -> str:
        doc = frappe.get_doc({
            "doctype": BATCH_DOCTYPE,
            "source": source,
            "original_filename": f"TEST-1286-{frappe.generate_hash(length=8)}.csv",
        })
        doc.insert(ignore_permissions=True)
        return doc.name

    def _row(self, batch, status, direction, amount, status_raw=BANK_SUCCESS_STATUS):
        doc = frappe.get_doc({
            "doctype": ROW_DOCTYPE,
            "import_batch": batch,
            "transfer_id": f"TEST-1286-{frappe.generate_hash(length=10)}",
            "amount": amount,
            "row_status": status,
            "direction": direction,
            "status_raw": status_raw,
        })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return doc.name

    def _figure(self):
        stats = get_payment_dashboard_stats()
        return (
            stats["total_unreconciled_outflow_amount"],
            stats["total_unreconciled_outflow_count"],
        )

    # ------------------------------------------------------------------ the equality

    def test_it_equals_bulk_imports_unfiltered_still_open_paid_out(self):
        """The one assertion the ticket is actually about (#1286).

        The fixture spans five statuses, both directions and two sources, so the two figures are
        compared over a population where every rule this feature has can be got wrong.
        """
        cashfree = self._batch("Cashfree")
        icici = self._batch("ICICI Bank Statement")

        self._row(cashfree, ROW_PENDING_MATCH, DIRECTION_DEBIT, 1000)
        self._row(cashfree, ROW_MATCHED, DIRECTION_DEBIT, 2000)
        self._row(cashfree, ROW_SETTLED, DIRECTION_DEBIT, 3000)
        self._row(cashfree, ROW_SKIPPED, DIRECTION_DEBIT, 4000)
        self._row(icici, ROW_MISMATCHED, DIRECTION_DEBIT, 5000)
        self._row(icici, ROW_ERROR, DIRECTION_DEBIT, 6000)
        self._row(icici, ROW_PARTIALLY_ALLOCATED, DIRECTION_DEBIT, 7000)
        self._row(icici, ROW_MATCHED, DIRECTION_CREDIT, 8000)
        self._row(icici, ROW_PENDING_MATCH, DIRECTION_DEBIT, 9000, status_raw="FAILED")

        amount, count = self._figure()
        totals = get_outflow_summary()["totals"]

        self.assertAlmostEqual(amount, float(totals["open_paid_value"]), places=2)
        self.assertEqual(count, totals["open_paid_rows"])

    # ------------------------------------------------------------------ what is counted

    def test_every_active_status_is_counted(self):
        """Pending match run, Matched, Mismatched, Error and Partially Allocated all count.

        Iterated over `ACTIVE_ROW_STATUSES` itself so a status added to that set later cannot
        quietly fall out of this figure without the test noticing.
        """
        batch = self._batch("Cashfree")
        for status in sorted(ACTIVE_ROW_STATUSES):
            before_amount, before_count = self._figure()
            self._row(batch, status, DIRECTION_DEBIT, 250)
            after_amount, after_count = self._figure()
            self.assertEqual(after_count - before_count, 1, status)
            self.assertAlmostEqual(after_amount - before_amount, 250, places=2, msg=status)

    def test_a_blank_direction_counts_as_paid_out(self):
        """A statement that states no direction is money OUT -- the import's one definition of the
        axis is the positive test `direction == "Credit"`, so blank falls on the paid side."""
        batch = self._batch("Cashfree")
        before_amount, before_count = self._figure()
        self._row(batch, ROW_PENDING_MATCH, "", 310)
        after_amount, after_count = self._figure()
        self.assertEqual(after_count - before_count, 1)
        self.assertAlmostEqual(after_amount - before_amount, 310, places=2)

    # ------------------------------------------------------------------ what is NOT counted

    def test_an_inflow_line_is_not_counted(self):
        batch = self._batch("ICICI Bank Statement")
        before_amount, before_count = self._figure()
        self._row(batch, ROW_PENDING_MATCH, DIRECTION_CREDIT, 4321)
        after_amount, after_count = self._figure()
        self.assertEqual(after_count - before_count, 0)
        self.assertAlmostEqual(after_amount - before_amount, 0, places=2)

    def test_a_settled_line_is_not_counted(self):
        batch = self._batch("Cashfree")
        before_amount, before_count = self._figure()
        self._row(batch, ROW_SETTLED, DIRECTION_DEBIT, 5432)
        after_amount, after_count = self._figure()
        self.assertEqual(after_count - before_count, 0)
        self.assertAlmostEqual(after_amount - before_amount, 0, places=2)

    def test_a_skipped_line_is_not_counted(self):
        batch = self._batch("Cashfree")
        before_amount, before_count = self._figure()
        self._row(batch, ROW_SKIPPED, DIRECTION_DEBIT, 6543)
        after_amount, after_count = self._figure()
        self.assertEqual(after_count - before_count, 0)
        self.assertAlmostEqual(after_amount - before_amount, 0, places=2)

    def test_a_transfer_that_failed_at_the_bank_is_not_counted(self):
        """Money the bank refused to move never left the account, so it owes nobody a decision --
        the same option-B exclusion every other figure in the import summary carries."""
        batch = self._batch("Cashfree")
        before_amount, before_count = self._figure()
        self._row(batch, ROW_PENDING_MATCH, DIRECTION_DEBIT, 7654, status_raw="FAILED")
        after_amount, after_count = self._figure()
        self.assertEqual(after_count - before_count, 0)
        self.assertAlmostEqual(after_amount - before_amount, 0, places=2)

    # ------------------------------------------------------------------ the inflow twin

    def _inflow_figure(self):
        stats = get_payment_dashboard_stats()
        return (
            stats["total_unreconciled_inflow_amount"],
            stats["total_unreconciled_inflow_count"],
        )

    def test_inflow_equals_bulk_imports_unfiltered_still_open_received(self):
        """Total Unreconciled Inflow is Bulk Import's unfiltered *Still open / Received* --
        the same equality the outflow figure carries, on the other side of the direction axis."""
        cashfree = self._batch("Cashfree")
        icici = self._batch("ICICI Bank Statement")

        self._row(icici, ROW_PENDING_MATCH, DIRECTION_CREDIT, 1100)
        self._row(icici, ROW_MATCHED, DIRECTION_CREDIT, 2200)
        self._row(icici, ROW_SETTLED, DIRECTION_CREDIT, 3300)
        self._row(icici, ROW_SKIPPED, DIRECTION_CREDIT, 4400)
        self._row(icici, ROW_ERROR, DIRECTION_CREDIT, 5500, status_raw="FAILED")
        self._row(cashfree, ROW_MATCHED, DIRECTION_DEBIT, 6600)

        amount, count = self._inflow_figure()
        totals = get_outflow_summary()["totals"]

        self.assertAlmostEqual(amount, float(totals["open_received_value"]), places=2)
        self.assertEqual(count, totals["open_received_rows"])

    def test_an_open_inflow_line_counts_as_inflow_only(self):
        """An open Credit line moves the inflow figure by exactly its amount and leaves the
        outflow figure alone -- the two are the halves of one open population, never overlapping."""
        batch = self._batch("ICICI Bank Statement")
        in_amount, in_count = self._inflow_figure()
        out_amount, out_count = self._figure()
        self._row(batch, ROW_PENDING_MATCH, DIRECTION_CREDIT, 2468)
        in_amount2, in_count2 = self._inflow_figure()
        out_amount2, out_count2 = self._figure()
        self.assertEqual(in_count2 - in_count, 1)
        self.assertAlmostEqual(in_amount2 - in_amount, 2468, places=2)
        self.assertEqual(out_count2 - out_count, 0)
        self.assertAlmostEqual(out_amount2 - out_amount, 0, places=2)

    def test_a_settled_inflow_line_is_not_counted(self):
        batch = self._batch("ICICI Bank Statement")
        before_amount, before_count = self._inflow_figure()
        self._row(batch, ROW_SETTLED, DIRECTION_CREDIT, 1357)
        after_amount, after_count = self._inflow_figure()
        self.assertEqual(after_count - before_count, 0)
        self.assertAlmostEqual(after_amount - before_amount, 0, places=2)

    # ------------------------------------------------------------------ all time, both sides

    def test_both_figures_are_all_time_not_30_days(self):
        """A line dated far outside any 30-day window still counts, on BOTH sides. The two figures
        sit inside columns headed "(30 Days)", so a later date filter would look natural there --
        this pins that they are all time."""
        batch = self._batch("ICICI Bank Statement")
        old = frappe.utils.add_days(frappe.utils.nowdate(), -400)
        in_amount, in_count = self._inflow_figure()
        out_amount, out_count = self._figure()
        for direction, amount in ((DIRECTION_CREDIT, 1111), (DIRECTION_DEBIT, 2222)):
            name = self._row(batch, ROW_PENDING_MATCH, direction, amount)
            frappe.db.set_value(ROW_DOCTYPE, name, "added_on", old, update_modified=False)
        frappe.db.commit()
        in_amount2, in_count2 = self._inflow_figure()
        out_amount2, out_count2 = self._figure()
        self.assertEqual(in_count2 - in_count, 1)
        self.assertAlmostEqual(in_amount2 - in_amount, 1111, places=2)
        self.assertEqual(out_count2 - out_count, 1)
        self.assertAlmostEqual(out_amount2 - out_amount, 2222, places=2)
