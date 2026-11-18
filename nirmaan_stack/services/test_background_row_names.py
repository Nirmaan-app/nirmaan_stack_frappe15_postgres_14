"""Rows that background operations write never clash on their names (ADR 0048, spec #1654).

The fast two-connection clash test. Two background operations overlap when two `long` workers run them at once.
Every connection runs at REPEATABLE READ, and a counted name (`BRCT-.YY.-.#####`) is taken from one `tabSeries`
row under `SELECT ... FOR UPDATE`: the transaction that takes a number after the other committed fails with a
serialization error, however late it asks. Two connections prove that clash for any number of workers, so this
test overlaps exactly two transactions:

1. the second connection reads first, so its snapshot is taken (without this read the test passes even on counted
   names, because the second transaction would only start after the first committed);
2. the first connection inserts a row and commits;
3. the second connection inserts a row of the same doctype and commits.

Both inserts must commit. One case per doctype; a later ticket adds its doctype with one more `test_` method
that calls `assert_overlapping_inserts_both_commit`.
"""

import threading
import time

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.boq.wizard.test_review_screen import _cleanup_project, _make_project
from nirmaan_stack.api.boq.wizard.test_upload_file import _cleanup_for_project
from nirmaan_stack.api.boq.wizard.test_upload_file import _make_project_fixture as _make_upload_project
from nirmaan_stack.api.boq.wizard.test_upload_file import _run_worker as _run_upload_worker
from nirmaan_stack.services.boq_fixture_teardown import fixture_boq_name
from nirmaan_stack.services.series_lock import boq_series, recent_waits, series_lock

SHEET = "__row_names_clash__"


class TestBackgroundRowNamesDoNotClash(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project = _make_project()
        boq = frappe.new_doc("BOQs")
        boq.project = cls.project.name
        boq.boq_name = "Row names clash fixture"
        boq.insert(set_name=fixture_boq_name("ROW-NAMES"), ignore_permissions=True)
        frappe.db.commit()
        cls.boq = boq.name

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        _cleanup_project(cls.project.name)
        super().tearDownClass()

    def assert_overlapping_inserts_both_commit(self, doctype, fields, on_boq=True, ignore_links=False):
        """Insert one `doctype` row on each of two overlapping transactions; assert both commit.

        `fields(n)` gives the n-th row's own fields, beside `boq` and `sheet_name` when `on_boq` (a doctype
        that does not hang off a BoQ passes `on_boq=False` and gives all its fields). `ignore_links` lets the
        fields name made-up records (a statement line, an Expense) the case does not need to build."""
        made = []
        base = {"boq": self.boq, "sheet_name": SHEET} if on_boq else {}

        def insert(n):
            doc = frappe.get_doc({"doctype": doctype, **base, **fields(n)})
            doc.flags.ignore_links = ignore_links
            doc.insert(ignore_permissions=True)
            frappe.db.commit()
            made.append(doc.name)

        try:
            with self.secondary_connection():
                frappe.db.sql("select count(*) from `tabBOQs`")  # takes this transaction's snapshot
            with self.primary_connection():
                insert(1)
            with self.secondary_connection():
                try:
                    insert(2)
                except Exception as e:
                    self.fail(f"the second, overlapping {doctype} insert did not commit: {type(e).__name__}: {e}")
        finally:
            with self.secondary_connection():
                frappe.db.rollback()
            with self.primary_connection():
                frappe.db.rollback()
                for name in made:
                    frappe.db.delete(doctype, {"name": name})
                frappe.db.commit()
        self.assertEqual(len(made), 2)

    def test_two_overlapping_row_category_inserts_both_commit(self):
        self.assert_overlapping_inserts_both_commit(
            "BoQ Row Category",
            lambda n: {"excel_row": n, "committed_version": 0, "discipline": "Electrical", "category_version": 1},
        )

    def test_two_overlapping_review_row_inserts_both_commit(self):
        self.assert_overlapping_inserts_both_commit("BoQ Review Row", lambda n: {})

    def test_two_overlapping_rate_suggestion_run_inserts_both_commit(self):
        self.assert_overlapping_inserts_both_commit(
            "BoQ Rate Suggestion Run",
            lambda n: {"committed_version": 0, "run_id": f"row-names-clash-{n}", "status": "running", "active": 0},
        )

    def test_two_overlapping_rate_match_run_inserts_both_commit(self):
        self.assert_overlapping_inserts_both_commit(
            "BoQ Rate Match Run", lambda n: {"commit_version": 0, "status": "queued", "active": 0}
        )

    def test_two_overlapping_cell_pricing_inserts_both_commit(self):
        self.assert_overlapping_inserts_both_commit(
            "BoQ Cell Pricing",
            lambda n: {"excel_row": n, "col_letter": "F", "committed_version": 1, "pricing_version": 1,
                       "is_current": 1, "rate": 100},
        )

    def test_two_overlapping_action_item_inserts_both_commit(self):
        self.assert_overlapping_inserts_both_commit(
            "Project Action Item",
            lambda n: {"project": self.project.name, "action_type": "DN_PENDING", "reference_doctype": "Projects",
                       "reference_name": self.project.name, "status": "Open",
                       "dedup_key": f"row-names-clash-{frappe.generate_hash(length=10)}-{n}"},
            on_boq=False,
        )

    # #1719: the import and upload operations' rows. Their names are made up here: no statement line, batch or
    # Expense is built, as the clash is in the name alone.
    def test_two_overlapping_outflow_row_match_inserts_both_commit(self):
        """The card import's Create and the Cashbook import write these, as do web reconciles."""
        self.assert_overlapping_inserts_both_commit(
            "Outflow Row Match",
            lambda n: {"import_row": f"OFR-CLASH-{n}", "import_batch": "OFI-CLASH",
                       "transfer_id": f"row-names-clash-{frappe.generate_hash(length=10)}-{n}",
                       "target_doctype": "Non Project Expenses", "target_name": f"NPE-CLASH-{n}",
                       "target_amount": 100, "match_kind": "Settled", "match_basis": "Manual"},
            on_boq=False, ignore_links=True,
        )

    def test_two_overlapping_expense_bill_inserts_both_commit(self):
        """The Cashbook import writes these when it attaches bills."""
        self.assert_overlapping_inserts_both_commit(
            "Expense Bill",
            lambda n: {"expense_doctype": "Non Project Expenses", "expense": f"NPE-CLASH-{n}", "is_latest": 1,
                       "bill_file": f"/private/files/bill_clash_{n}.pdf", "status": "Pending",
                       "bill_check": "Not checked"},
            on_boq=False, ignore_links=True,
        )

    def test_two_overlapping_attachment_inserts_on_one_project_both_commit(self):
        """The BoQ upload writes these, as do many web requests; one project, so today one counter."""
        self.assert_overlapping_inserts_both_commit(
            "Nirmaan Attachments",
            lambda n: {"project": self.project.name, "attachment_type": "boq",
                       "attachment": f"/private/files/att_clash_{n}.xlsx"},
            on_boq=False,
        )


class TestBoqNumbersStayCounted(FrappeTestCase):
    """BoQ numbers keep their counter (`BOQ-.YY.-.#####`, users see them), so two operations that create BoQs
    must not clash on it: each takes the BoQ series lock and starts its transaction after the lock is granted
    (ADR 0048, #1659). The upload's Nirmaan Attachments row is named by `hash` since #1719."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.projects = [_make_upload_project().name, _make_upload_project().name]

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        for project in cls.projects:
            _cleanup_for_project(project)
            frappe.delete_doc("Projects", project, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def tearDown(self):
        frappe.db.rollback()
        for project in self.projects:
            _cleanup_for_project(project)

    def upload(self, project, n):
        _run_upload_worker(project_id=project, file_url=f"/private/files/boq_clash_{n}.xlsx",
                           file_name=f"Clash fixture {n}.xlsx", user="Administrator")

    def assert_overlapping_uploads_both_commit(self, first_project, second_project):
        """The second upload's transaction began before the first upload committed; both must commit."""
        with self.secondary_connection():
            frappe.db.sql("select count(*) from `tabBOQs`")  # takes this transaction's snapshot
        with self.primary_connection():
            self.upload(first_project, 1)
        with self.secondary_connection():
            try:
                self.upload(second_project, 2)
            except Exception as e:
                self.fail(f"the second, overlapping BoQ upload did not commit: {type(e).__name__}: {e}")
        frappe.db.rollback()
        names = frappe.get_all("BOQs", filters={"project": ["in", self.projects]}, pluck="name", order_by="creation")
        self.assertEqual(len(names), 2)
        return names

    def assert_counted(self, names):
        """BoQ numbers stay counted: `BOQ-<yy>-<5 digits>`, the second one right after the first."""
        for name in names:
            self.assertRegex(name, r"^BOQ-\d{2}-\d{5}$")
        first, second = (int(n.rsplit("-", 1)[1]) for n in names)
        self.assertEqual(second, first + 1, names)

    def test_two_overlapping_boq_uploads_both_commit_with_counted_numbers(self):
        self.assert_counted(self.assert_overlapping_uploads_both_commit(*self.projects))

    def test_two_overlapping_uploads_on_one_project_both_commit(self):
        """Same project: both uploads write a Nirmaan Attachments row for it (counted `ATT-<project>-` before #1719)."""
        project = self.projects[0]
        self.assert_counted(self.assert_overlapping_uploads_both_commit(project, project))
        atts = frappe.get_all("Nirmaan Attachments", filters={"project": project, "associated_doctype": "BOQs"},
                              pluck="associated_docname")
        self.assertEqual(len(atts), 2)

    def test_a_boq_creation_waits_for_the_lock_holder_then_takes_the_next_number(self):
        """Two BoQ creations really at once: the second, on its own connection in a thread, waits on the series
        lock while the first holds it, then commits the next number."""
        site, sites_path = frappe.local.site, frappe.local.sites_path
        second = {}

        def create_second():
            frappe.init(site=site, sites_path=sites_path)
            frappe.connect()
            try:
                frappe.set_user("Administrator")
                with series_lock(boq_series()):
                    second["name"] = _new_boq(self.projects[1], "Clash fixture second")
            except Exception as e:
                second["error"] = f"{type(e).__name__}: {e}"
            finally:
                frappe.destroy()

        thread = threading.Thread(target=create_second)
        began = time.time()
        with series_lock(boq_series()):
            first = _new_boq(self.projects[0], "Clash fixture first")
            thread.start()
            waiting = _wait_for_an_advisory_lock_waiter()
            self.assertTrue(waiting, "the second creation did not wait on the BoQ series lock")
            self.assertTrue(thread.is_alive())
        thread.join(30)
        self.assertFalse(thread.is_alive(), "the second creation never finished")
        self.assertNotIn("error", second)
        self.assert_counted([first, second["name"]])
        self.assertEqual(len(recent_waits(boq_series(), began)), 1, "the second creation's wait was not recorded")


def _new_boq(project, boq_name):
    doc = frappe.new_doc("BOQs")
    doc.project = project
    doc.boq_name = boq_name
    doc.insert(ignore_permissions=True)
    return doc.name


def _wait_for_an_advisory_lock_waiter(timeout=10):
    """True once another session of this database waits for an advisory lock (`pg_locks` shows live state)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if frappe.db.sql(
            """select count(*) from pg_locks where locktype = 'advisory' and not granted
               and pid <> pg_backend_pid() and database = (select oid from pg_database where datname = current_database())"""
        )[0][0]:
            return True
        time.sleep(0.05)
    return False
