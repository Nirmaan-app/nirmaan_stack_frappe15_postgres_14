"""Payments dashboard stats -- the Non-Project Inflow (30 days) figure (#1267, ADR-0016 A-D4)
and Total Unreconciled Outflow / Inflow (#1286; since 2026-09-22 the Bulk Import Not Matched tabs).

    bench --site localhost run-tests --app nirmaan_stack \
        --module nirmaan_stack.api.payments.test_payment_dashboard_stats

⚠️ RUNS AGAINST THE LIVE SITE DATABASE, which already holds real inflows and expenses. Every assertion
is therefore a DELTA: read the stats, insert a record, read again. Each record inserted here is purged
in `tearDownClass` together with its `Version` rows (the doctype carries `track_changes`).
"""

import unittest

import frappe
from frappe.utils import add_days, today

from nirmaan_stack.api.outflow_import.review import (
    SCOPE_NOT_MATCHED_INFLOW,
    SCOPE_NOT_MATCHED_OUTFLOW,
    SCOPE_PARTLY_OUTFLOW,
    _SCOPE_STATUSES,
    get_outflow_rows,
)
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

    ⚠️ IT MUST EQUAL BULK IMPORT'S OWN **Not Matched – Outflow** TAB WITH NO FILTERS, PLUS WHAT IS
    STILL UNALLOCATED ON EACH **Partly Allocated – Outflow** LINE (owner, 2026-09-22 -- it was
    *Still open / Paid out*, which also held Matched lines and the WHOLE of a part-used one), and
    the equality test below is the point of this class -- not the per-status deltas beside it. The
    two screens are allowed to disagree about nothing, so the assertion is EQUALITY against the real
    import endpoint, never a re-implementation of the population rule in the test. A test that
    re-spells the rule to check the rule passes whenever the two spellings agree, which is not the
    question.

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

    @staticmethod
    def _tab_totals(scope, *, unallocated_only=False):
        """A tab as the screen reads it, unfiltered and successful transfers only, paged to the end:
        `(amount, rows)`. `unallocated_only` counts each line by what its live slips have not yet
        taken -- the Partly Allocated tab's share of the figure."""
        amount, offset = 0.0, 0
        while True:
            page = get_outflow_rows(scope=scope, failed="0", limit=200, offset=offset)
            for row in page["rows"]:
                taken = (
                    sum(abs(m["target_amount"]) for m in row["matches"]) if unallocated_only else 0
                )
                amount += row["amount"] - taken
            offset += len(page["rows"])
            if not page["rows"] or offset >= page["total"]:
                return amount, page["total"]

    def _figure(self):
        stats = get_payment_dashboard_stats()
        return (
            stats["total_unreconciled_outflow_amount"],
            stats["total_unreconciled_outflow_count"],
        )

    # ------------------------------------------------------------------ the equality

    def test_it_equals_bulk_imports_not_matched_outflow_tab(self):
        """The one assertion this figure is about: the card and the tab it names agree.

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
        tab_amount, tab_count = self._tab_totals(SCOPE_NOT_MATCHED_OUTFLOW)
        partly_amount, partly_count = self._tab_totals(SCOPE_PARTLY_OUTFLOW, unallocated_only=True)

        self.assertAlmostEqual(amount, tab_amount + partly_amount, places=2)
        self.assertEqual(count, tab_count + partly_count)

    # ------------------------------------------------------------------ what is counted

    def test_only_the_not_matched_and_partly_allocated_statuses_are_counted(self):
        """Pending match run, Mismatched, Error and Partially Allocated count; Matched does not.

        Iterated over `ACTIVE_ROW_STATUSES` and read against the tabs' OWN status sets, so a status
        added to either later cannot quietly move this figure without the test noticing. A
        Partially Allocated line with no slip yet counts at its full amount -- nothing is taken.
        """
        not_matched = set(_SCOPE_STATUSES[SCOPE_NOT_MATCHED_OUTFLOW])
        self.assertEqual(not_matched, {ROW_PENDING_MATCH, ROW_MISMATCHED, ROW_ERROR})
        counted = not_matched | set(_SCOPE_STATUSES[SCOPE_PARTLY_OUTFLOW])
        self.assertEqual(counted - not_matched, {ROW_PARTIALLY_ALLOCATED})
        batch = self._batch("Cashfree")
        for status in sorted(ACTIVE_ROW_STATUSES):
            expected = 1 if status in counted else 0
            before_amount, before_count = self._figure()
            self._row(batch, status, DIRECTION_DEBIT, 250)
            after_amount, after_count = self._figure()
            self.assertEqual(after_count - before_count, expected, status)
            self.assertAlmostEqual(
                after_amount - before_amount, 250 * expected, places=2, msg=status
            )

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

    def test_inflow_equals_bulk_imports_not_matched_inflow_tab(self):
        """Total Unreconciled Inflow is Bulk Import's unfiltered **Not Matched – Inflow** tab --
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
        tab_amount, tab_count = self._tab_totals(SCOPE_NOT_MATCHED_INFLOW)

        self.assertAlmostEqual(amount, tab_amount, places=2)
        self.assertEqual(count, tab_count)

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


MATCH_DOCTYPE = "Outflow Row Match"
PAYMENT_DOCTYPE = "Project Payments"
PROJECT_EXPENSE = "Project Expenses"
NON_PROJECT_EXPENSE = "Non Project Expenses"


class TestPartReconciledOutflow(unittest.TestCase):
    """The bank-confirmed part of a Reconciliation Pending record, inside the 30-day outflow.

    A record in Reconciliation Pending is money already sent that the bank has only partly
    confirmed. Its status keeps it out of both outflow queries (they read Paid records and
    stamped `payment_date`s), and the card no longer counts the confirmed part as pending
    either -- so unless it is added here, that money is reported nowhere. These tests pin
    WHICH figure it lands in, WHICH window decides, and that nothing is counted twice.

    ⚠️ RUNS AGAINST THE LIVE SITE DATABASE like the classes above, so every assertion is a
    DELTA and every fixture is planted raw and purged in `tearDown`. The expense ledgers are
    written with SQL on purpose: their `validate` is the bank-links controller, which would
    re-derive the very status these tests need to hold still.
    """

    PREFIX = "TEST-PARTREC"

    def setUp(self):
        self.batches, self.rows, self.matches = [], [], []
        self.planted = []  # (doctype, name)
        self.non_project_type = frappe.db.get_value(
            "Expense Type", {"non_project": 1, "project": 0}, "name"
        )
        self.project_type = frappe.db.get_value(
            "Expense Type", {"project": 1}, "name"
        )

    def tearDown(self):
        # Slips first: they are what points at a row, and at a record that is about to go.
        for name in self.matches:
            frappe.db.delete(MATCH_DOCTYPE, {"name": name})
        for name in self.rows:
            frappe.db.delete(ROW_DOCTYPE, {"name": name})
        for name in self.batches:
            frappe.db.delete(BATCH_DOCTYPE, {"name": name})
        for doctype, name in self.planted:
            frappe.db.delete("Version", {"ref_doctype": doctype, "docname": name})
            frappe.db.delete(doctype, {"name": name})
        frappe.db.commit()

    # --- arrange ---------------------------------------------------------------------------

    def _line(self, amount, added_on):
        """One successful debit line, already `Settled`, dated `added_on` -- its own batch."""
        batch = frappe.get_doc({
            "doctype": BATCH_DOCTYPE,
            "source": "Cashfree",
            "original_filename": f"{self.PREFIX}-{frappe.generate_hash(length=8)}.csv",
        })
        batch.insert(ignore_permissions=True)
        self.batches.append(batch.name)

        row = frappe.get_doc({
            "doctype": ROW_DOCTYPE,
            "import_batch": batch.name,
            "transfer_id": f"{self.PREFIX}-{frappe.generate_hash(length=10)}",
            "amount": amount,
            "row_status": ROW_SETTLED,
            "direction": DIRECTION_DEBIT,
            "status_raw": BANK_SUCCESS_STATUS,
            "added_on": added_on,
        })
        row.insert(ignore_permissions=True)
        self.rows.append(row.name)
        frappe.db.commit()
        return row.name

    def _record(self, doctype, *, amount, status, payment_date=None):
        """A ledger row planted raw: no hooks, nothing else moves."""
        name = f"{self.PREFIX}-{frappe.generate_hash(length=12)}"
        columns = ["name", "creation", "modified", "modified_by", "owner", "docstatus", "idx",
                   "amount", "status", "payment_date"]
        values = [name, "Administrator", "Administrator", 0, 0, float(amount), status,
                  payment_date]
        if doctype != PAYMENT_DOCTYPE:
            columns += ["description", "type"]
            values += ["Part-reconciled outflow test",
                       self.non_project_type if doctype == NON_PROJECT_EXPENSE else self.project_type]
        placeholders = ", ".join(["%s", "NOW()", "NOW()"] + ["%s"] * (len(columns) - 3))
        frappe.db.sql(
            f'''INSERT INTO "tab{doctype}" ({", ".join(columns)}) VALUES ({placeholders})''',
            tuple(values),
        )
        self.planted.append((doctype, name))
        frappe.db.commit()
        return name

    def _slip(self, row, doctype, name, amount):
        """One live `Settled` slip: the link an import wrote between the line and the record."""
        staged = frappe.db.get_value(
            ROW_DOCTYPE, row, ["import_batch", "transfer_id"], as_dict=True
        )
        match = frappe.get_doc({
            "doctype": MATCH_DOCTYPE,
            "import_row": row,
            "import_batch": staged.import_batch,
            "transfer_id": staged.transfer_id,
            "target_doctype": doctype,
            "target_name": name,
            "target_amount": float(amount),
            "match_kind": "Settled",
            "match_basis": "Manual",
        })
        match.insert(ignore_permissions=True)
        self.matches.append(match.name)
        frappe.db.commit()
        return match.name

    @staticmethod
    def _delta(before, after, key):
        return after[key] - before[key]

    # --- assert ----------------------------------------------------------------------------

    def test_the_confirmed_part_of_a_pending_record_is_outflow(self):
        before = get_payment_dashboard_stats()
        expense = self._record(NON_PROJECT_EXPENSE, amount=10000, status="Reconciliation Pending")
        self._slip(self._line(4000, add_days(today(), -3)), NON_PROJECT_EXPENSE, expense, 4000)
        after = get_payment_dashboard_stats()

        self.assertEqual(self._delta(before, after, "total_non_project_expense_30_days_count"), 1)
        self.assertAlmostEqual(
            self._delta(before, after, "total_non_project_expense_30_days_amount"), 4000
        )
        # The card's "incl. ..." note -- the same 4,000, reported as the SUBSET it is.
        self.assertEqual(
            self._delta(before, after, "total_non_project_expense_30_days_part_reconciled_count"), 1
        )
        self.assertAlmostEqual(
            self._delta(before, after, "total_non_project_expense_30_days_part_reconciled_amount"),
            4000,
        )
        self.assertEqual(
            self._delta(before, after, "total_project_outflow_30_days_part_reconciled_count"), 0
        )
        # And the pending side reports the SAME split, so the card's row -- amount minus
        # reconciled -- shows the 6,000 that is genuinely still waiting on the bank.
        self.assertEqual(self._delta(before, after, "total_reconciliation_pending_count"), 1)
        self.assertAlmostEqual(
            self._delta(before, after, "total_reconciliation_pending_amount"), 10000
        )
        self.assertAlmostEqual(
            self._delta(before, after, "total_reconciliation_pending_reconciled_amount"), 4000
        )

    def test_a_record_whose_newest_line_is_old_is_out_of_the_window(self):
        """The NEWEST BANK LINE decides, and a 45-day-old one is outside the 30 days.

        ⚠️ INVERTS THE 2026-09-23 PIN `test_the_bank_line_s_own_date_does_not_decide`, which held
        that a dateless record always counts. The owner reversed that on 2026-09-24: a July salary
        run paid on 1 Aug was still "last 30 days" in late September. The record has no
        `payment_date`, so its newest line is the date that decides (`latest_line_in_range`).
        """
        before = get_payment_dashboard_stats()
        expense = self._record(NON_PROJECT_EXPENSE, amount=10000, status="Reconciliation Pending")
        self._slip(self._line(4000, add_days(today(), -45)), NON_PROJECT_EXPENSE, expense, 4000)
        after = get_payment_dashboard_stats()

        self.assertEqual(self._delta(before, after, "total_non_project_expense_30_days_count"), 0)
        self.assertAlmostEqual(
            self._delta(before, after, "total_non_project_expense_30_days_amount"), 0
        )
        self.assertAlmostEqual(
            self._delta(before, after, "total_non_project_expense_30_days_part_reconciled_amount"),
            0,
        )
        # The money is gone, just not recently: the pending row still nets it off, all time.
        self.assertAlmostEqual(
            self._delta(before, after, "total_reconciliation_pending_reconciled_amount"), 4000
        )

    def test_one_recent_line_brings_the_whole_confirmed_part_in(self):
        """ALL OR NOTHING: an old line and a recent one count TOGETHER, on the recent one's date.

        The same way a Paid record is dated by its newest line and counted in full -- so the figure
        does not jump when the last line lands and the record flips to Paid.
        """
        before = get_payment_dashboard_stats()
        expense = self._record(NON_PROJECT_EXPENSE, amount=10000, status="Reconciliation Pending")
        self._slip(self._line(4000, add_days(today(), -45)), NON_PROJECT_EXPENSE, expense, 4000)
        self._slip(self._line(2000, add_days(today(), -3)), NON_PROJECT_EXPENSE, expense, 2000)
        after = get_payment_dashboard_stats()

        self.assertEqual(self._delta(before, after, "total_non_project_expense_30_days_count"), 1)
        self.assertAlmostEqual(
            self._delta(before, after, "total_non_project_expense_30_days_amount"), 6000
        )

    def test_a_record_whose_lines_carry_no_date_is_out_of_the_window(self):
        """A slip whose import row was deleted has no date; nothing can place it in 30 days."""
        before = get_payment_dashboard_stats()
        expense = self._record(NON_PROJECT_EXPENSE, amount=10000, status="Reconciliation Pending")
        row = self._line(4000, add_days(today(), -3))
        self._slip(row, NON_PROJECT_EXPENSE, expense, 4000)
        frappe.db.delete(ROW_DOCTYPE, {"name": row})
        self.rows.remove(row)
        frappe.db.commit()
        after = get_payment_dashboard_stats()

        self.assertEqual(self._delta(before, after, "total_non_project_expense_30_days_count"), 0)
        self.assertAlmostEqual(
            self._delta(before, after, "total_reconciliation_pending_reconciled_amount"), 4000
        )

    def test_the_record_s_own_payment_date_does_not_decide(self):
        """A `payment_date` on a pending record is not what dates its confirmed part.

        ⚠️ INVERTS `test_a_record_dated_outside_the_window_does_not_count` (2026-09-23), which held
        the record to its own `payment_date`. The confirmed money moved on its bank line's date; a
        stale date on the record says nothing about when that happened.
        """
        before = get_payment_dashboard_stats()
        expense = self._record(
            NON_PROJECT_EXPENSE, amount=10000, status="Reconciliation Pending",
            payment_date=add_days(today(), -45),
        )
        self._slip(self._line(4000, add_days(today(), -1)), NON_PROJECT_EXPENSE, expense, 4000)
        after = get_payment_dashboard_stats()

        self.assertEqual(self._delta(before, after, "total_non_project_expense_30_days_count"), 1)
        self.assertAlmostEqual(
            self._delta(before, after, "total_non_project_expense_30_days_amount"), 4000
        )

    def test_what_leaves_the_pending_row_is_what_lands_in_outflow(self):
        """The tie the single read exists for: pending loses exactly what outflow gains."""
        before = get_payment_dashboard_stats()
        expense = self._record(PROJECT_EXPENSE, amount=20000, status="Reconciliation Pending")
        self._slip(self._line(7000, add_days(today(), -2)), PROJECT_EXPENSE, expense, 7000)
        after = get_payment_dashboard_stats()

        netted_off = self._delta(before, after, "total_reconciliation_pending_reconciled_amount")
        landed = (
            self._delta(before, after, "total_project_outflow_30_days_part_reconciled_amount")
            + self._delta(before, after, "total_non_project_expense_30_days_part_reconciled_amount")
        )
        self.assertAlmostEqual(netted_off, 7000)
        self.assertAlmostEqual(landed, netted_off)

    def test_a_project_expense_lands_in_the_project_figure(self):
        before = get_payment_dashboard_stats()
        expense = self._record(PROJECT_EXPENSE, amount=8000, status="Reconciliation Pending")
        self._slip(self._line(2500, add_days(today(), -1)), PROJECT_EXPENSE, expense, 2500)
        after = get_payment_dashboard_stats()

        self.assertEqual(self._delta(before, after, "total_project_outflow_30_days_count"), 1)
        self.assertAlmostEqual(
            self._delta(before, after, "total_project_outflow_30_days_amount"), 2500
        )
        self.assertAlmostEqual(
            self._delta(before, after, "total_project_outflow_30_days_part_reconciled_amount"), 2500
        )
        self.assertEqual(self._delta(before, after, "total_non_project_expense_30_days_count"), 0)
        self.assertAlmostEqual(
            self._delta(before, after, "total_non_project_expense_30_days_part_reconciled_amount"), 0
        )

    def test_a_pending_payment_is_not_counted_in_full_as_outflow(self):
        """Bug fixed 2026-09-24: the payment window now reads Paid records only.

        ⚠️ INVERTS `test_a_record_the_window_already_counted_in_full_is_not_counted_twice`. A
        Project Payment used to enter the 30-day outflow on its `payment_date` with NO status
        filter, so one still in Reconciliation Pending was counted at its FULL 9,000 as gone while
        the pending row counted the same money as still waiting. Now only its bank-confirmed 3,000
        is outflow, and the pending row nets that 3,000 off -- 3,000 out, 6,000 waiting, 9,000 total.
        """
        before = get_payment_dashboard_stats()
        payment = self._record(
            PAYMENT_DOCTYPE, amount=9000, status="Reconciliation Pending",
            payment_date=add_days(today(), -2),
        )
        self._slip(self._line(3000, add_days(today(), -2)), PAYMENT_DOCTYPE, payment, 3000)
        after = get_payment_dashboard_stats()

        self.assertEqual(self._delta(before, after, "total_project_outflow_30_days_count"), 1)
        self.assertAlmostEqual(
            self._delta(before, after, "total_project_outflow_30_days_amount"), 3000
        )
        self.assertAlmostEqual(
            self._delta(before, after, "total_project_outflow_30_days_part_reconciled_amount"), 3000
        )
        self.assertAlmostEqual(
            self._delta(before, after, "total_reconciliation_pending_amount"), 9000
        )
        self.assertAlmostEqual(
            self._delta(before, after, "total_reconciliation_pending_reconciled_amount"), 3000
        )

    def test_a_pending_payment_with_no_bank_line_is_not_outflow(self):
        """Bug 2 at its plainest: a dated pending payment with nothing confirmed is not outflow."""
        before = get_payment_dashboard_stats()
        self._record(
            PAYMENT_DOCTYPE, amount=5000, status="Reconciliation Pending",
            payment_date=add_days(today(), -1),
        )
        after = get_payment_dashboard_stats()

        self.assertEqual(self._delta(before, after, "total_project_outflow_30_days_count"), 0)
        self.assertAlmostEqual(
            self._delta(before, after, "total_project_outflow_30_days_amount"), 0
        )
        self.assertEqual(self._delta(before, after, "total_reconciliation_pending_count"), 1)
