# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Create: a validated Porter import becomes one Expense per completed order (#1445, spec #1442, ADR-0032).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_porter_create

Each test uploads the synthetic statement through the real endpoint, runs the validation job with Gemini
and the PDF download faked (`test_porter_validation`), presses Create through its endpoint, then runs the
Create job DIRECTLY, as the queue would. It asserts on what is left: Porter Orders, Expenses, matches,
lines, Files, the import's state and the project's CEO-Hold cashflow gap.

⚠️ Every test removes what it made: matches, expenses and Porter Orders here; lines, invoices, their
files and the batch through `test_porter_import._purge_batches`; CEO Hold reasons and projects at class end.
"""

import json
from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import import porter as porter_api
from nirmaan_stack.api.outflow_import import porter_records
from nirmaan_stack.api.outflow_import import porter_create
from nirmaan_stack.api.outflow_import.test_porter_import import INVOICE_DOCTYPE, ROW_DOCTYPE, SOURCE
from nirmaan_stack.api.outflow_import.test_porter_validation import PorterValidationCase
from nirmaan_stack.integrations.controllers.project_cashflow_hold_update import _compute_cashflow_gap
from nirmaan_stack.services.ceo_hold import core as ceo_hold
from nirmaan_stack.services.outflow_import.porter import EXPENSE_TYPE, MATCH_BASIS
from nirmaan_stack.services.outflow_import.porter_state import NEEDS_PERSON

MATCH_DOCTYPE = "Outflow Row Match"
ORDER_DOCTYPE = "Porter Order"
PROJECT_EXPENSE = "Project Expenses"
NON_PROJECT_EXPENSE = "Non Project Expenses"


def _purge_created(batch: str) -> None:
    """Matches, the expenses they point at, and the Porter Orders of the import's invoices. Raw, per scope."""
    frappe.db.rollback()
    matches = frappe.get_all(
        MATCH_DOCTYPE, filters={"import_batch": batch}, fields=["name", "target_doctype", "target_name"]
    )
    invoices = frappe.get_all(INVOICE_DOCTYPE, filters={"import_batch": batch}, pluck="name")
    scopes = [(MATCH_DOCTYPE, {"import_batch": batch})]
    for doctype in (PROJECT_EXPENSE, NON_PROJECT_EXPENSE):
        names = [m.target_name for m in matches if m.target_doctype == doctype]
        if names:
            scopes.append((doctype, {"name": ["in", names]}))
    if invoices:
        scopes.append((ORDER_DOCTYPE, {"porter_invoice": ["in", invoices]}))
    for doctype, filters in scopes:
        try:
            frappe.db.delete(doctype, filters)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
            print(f"porter create test purge: could not delete {doctype} of {batch}")


class PorterCreateCase(PorterValidationCase):
    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        for project in cls.projects:
            try:
                ceo_hold.clear_all_reasons(project)
                frappe.db.commit()
            except Exception:
                frappe.db.rollback()
                print(f"porter create test purge: could not clear the CEO Hold reasons of {project}")
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        self.addCleanup(_purge_created, self.batch)

    def _validate(self):
        self._run_job()

    def _confirm_what_needs_a_person(self):
        """A person keeps every order that needs one where it is suggested (#1560): its project, or Not a
        project. Through Review's own endpoint, as the Accountant does before Create."""
        from nirmaan_stack.api.outflow_import.porter_review import get_porter_review, set_porter_placement

        by_destination: dict[str | None, list[str]] = {}
        for line in get_porter_review(self.batch)["lines"]:
            if line["placement"] == NEEDS_PERSON:
                destination = line["project"] if line["ledger"] == PROJECT_EXPENSE else None
                by_destination.setdefault(destination, []).append(line["name"])
        for destination, names in by_destination.items():
            set_porter_placement(self.batch, json.dumps(names), destination)

    def _press_create(self, *, confirm_first: bool = True):
        """Press Create. `confirm_first` (the default): a person first confirms every order that needs
        one, as Create refuses otherwise (#1560)."""
        if confirm_first and porter_records.is_validated(self.batch):
            self._confirm_what_needs_a_person()
        jobs = []
        with patch.object(frappe, "enqueue", side_effect=lambda *a, **kw: jobs.append(kw)):
            result = porter_create.create_porter_expenses(self.batch)
        return result, jobs

    def _run_create(self):
        porter_create.create_porter_import(self.batch, "Administrator")

    def _lines(self):
        return {
            row.transfer_id[-3:]: row
            for row in frappe.get_all(ROW_DOCTYPE, filters={"import_batch": self.batch}, fields=["*"])
        }

    def _expense_of(self, suffix: str):
        line = self._lines()[suffix]
        doctype = frappe.db.get_value(
            MATCH_DOCTYPE, {"import_row": line.name, "match_kind": "Settled"}, "target_doctype"
        )
        return frappe.get_doc(doctype, line.suggested_name)

    def _expenses(self):
        matches = frappe.get_all(
            MATCH_DOCTYPE,
            filters={"import_batch": self.batch, "match_kind": "Settled"},
            fields=["target_doctype", "target_name"],
        )
        return [frappe.get_doc(m.target_doctype, m.target_name) for m in matches]

    def _orders(self):
        return frappe.get_all(
            ORDER_DOCTYPE,
            filters={"porter_invoice": ["in", list(self.numbers.values())]},
            fields=["*"],
        )

    def _crn(self, suffix: str) -> str:
        return self._lines()[suffix].transfer_id


class TestCreateWaitsForEveryInvoice(PorterCreateCase):
    def test_create_is_refused_while_the_invoices_are_still_being_checked(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            self._press_create()
        self.assertIn("Validating", str(caught.exception))
        self.assertEqual(self._expenses(), [])

    def test_create_is_refused_when_one_invoice_failed_and_the_job_writes_nothing_either(self):
        self.replies[self.numbers["24SS27A0900002"]]["net_amount"] = 1.0
        self._validate()
        with self.assertRaises(frappe.ValidationError) as caught:
            self._press_create()
        self.assertIn("Validation failed", str(caught.exception))
        # Even a job enqueued some other way refuses to write.
        self._run_create()
        self.assertEqual(self._expenses(), [])
        self.assertEqual(self._orders(), [])


class TestPressingCreate(PorterCreateCase):
    def setUp(self):
        super().setUp()
        self._validate()

    def test_it_starts_one_job_de_duplicated_per_import(self):
        result, jobs = self._press_create()
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]["job_id"], f"porter-create-{self.batch}")
        self.assertTrue(jobs[0]["deduplicate"])
        self.assertEqual(jobs[0]["batch"], self.batch)
        self.assertEqual(result["batch"], self.batch)
        self.assertEqual(result["state"], "Validated")
        self.assertEqual(result["to_create"], 11)
        self.assertEqual(result["created"], 0)


class TestCreateWaitsForEveryOrderThatNeedsAPerson(PorterCreateCase):
    """#1560: no order becomes a Non-Project Expense unless someone chose it. Create is refused while
    any order needs a person (a Check, no placement, a remark group placed differently)."""

    def setUp(self):
        super().setUp()
        self._validate()

    def _needing(self):
        from nirmaan_stack.api.outflow_import.porter_review import get_porter_review

        return [line for line in get_porter_review(self.batch)["lines"] if line["placement"] == NEEDS_PERSON]

    def test_create_is_refused_naming_how_many_orders_are_left_and_queues_nothing(self):
        left = len(self._needing())
        self.assertGreater(left, 1)
        with self.assertRaises(frappe.ValidationError) as caught:
            self._press_create(confirm_first=False)
        self.assertIn(f"{left} orders still need a project", str(caught.exception))
        self.assertEqual(self._expenses(), [])

    def test_one_order_left_is_still_refused(self):
        from nirmaan_stack.api.outflow_import.porter_review import set_porter_placement

        needing = self._needing()
        for line in needing[1:]:
            set_porter_placement(self.batch, json.dumps([line["name"]]), None)
        with self.assertRaises(frappe.ValidationError) as caught:
            self._press_create(confirm_first=False)
        self.assertIn("1 order still needs a project", str(caught.exception))

    def test_create_starts_once_a_person_has_placed_every_one(self):
        self._confirm_what_needs_a_person()
        self.assertEqual(self._needing(), [])
        _, jobs = self._press_create(confirm_first=False)
        self.assertEqual(len(jobs), 1)


class TestAValidatedImportCreated(PorterCreateCase):
    def setUp(self):
        super().setUp()
        self._validate()
        self.files_before = frappe.db.count("File")
        self._press_create()
        self._run_create()

    def test_each_completed_order_is_one_porter_order_and_one_expense_and_a_cancelled_one_neither(self):
        lines = self._lines()
        completed = {suffix for suffix, line in lines.items() if line.skip_kind != "Porter order cancelled"}
        self.assertEqual(len(completed), 11)
        orders = self._orders()
        self.assertEqual(sorted(o.crn for o in orders), sorted(lines[s].transfer_id for s in completed))
        expenses = self._expenses()
        self.assertEqual(len(expenses), 11)
        self.assertEqual(sorted(e.porter_order for e in expenses), sorted(o.crn for o in orders))
        self.assertFalse(frappe.db.exists(ORDER_DOCTYPE, self._crn("011")))

    def test_a_project_expense_carries_exactly_the_porter_fields(self):
        expense = self._expense_of("002")  # Arjun Pillai (trailing space in the file), "quillon site"
        invoice = frappe.get_doc(INVOICE_DOCTYPE, self.numbers["29SS27A0900001"])
        self.assertEqual(expense.doctype, PROJECT_EXPENSE)
        self.assertEqual(expense.projects, self.quillon)
        self.assertEqual(expense.status, "Paid")
        self.assertEqual(float(expense.amount), 133.0)  # the fare; its GST 6.66 is never added
        self.assertEqual(str(expense.payment_date), "2026-09-05")
        self.assertEqual(expense.payment_ref, self._crn("002"))
        self.assertEqual(expense.invoice_ref, invoice.invoice_number)
        self.assertEqual(str(expense.invoice_date), "2026-10-01")
        self.assertEqual(expense.invoice_attachment, invoice.invoice_file)
        self.assertTrue(expense.invoice_attachment)
        self.assertEqual(expense.payment_by, "Arjun Pillai")
        self.assertFalse(expense.vendor)
        self.assertFalse(expense.payment_attachment)
        self.assertEqual(expense.type, EXPENSE_TYPE)
        self.assertEqual(expense.description, "Porter Delivery raised by Arjun Pillai for Quillon Park")
        self.assertEqual(expense.comment, f"Imported from {self.batch}")
        self.assertEqual(expense.porter_order, self._crn("002"))

    def test_a_line_a_person_chose_not_a_project_for_becomes_a_non_project_expense(self):
        expense = self._expense_of("003")  # Ravi Testkumar, no remark: confirmed Not a project
        self.assertEqual(expense.doctype, NON_PROJECT_EXPENSE)
        self.assertEqual(float(expense.amount), 382.0)
        self.assertEqual(expense.status, "Paid")
        self.assertEqual(expense.type, EXPENSE_TYPE)
        self.assertEqual(expense.description, "Porter Delivery raised by Ravi Testkumar")
        self.assertEqual(expense.payment_ref, self._crn("003"))
        self.assertEqual(str(expense.payment_date), "2026-09-12")
        self.assertEqual(expense.invoice_ref, self.numbers["29SS27A0900001"])
        self.assertEqual(expense.porter_order, self._crn("003"))

    def test_the_porter_order_holds_the_order_and_its_reverse_charge_gst(self):
        order = frappe.get_doc(ORDER_DOCTYPE, self._crn("004"))
        self.assertEqual(order.porter_invoice, self.numbers["29SS27A0900001"])
        self.assertEqual(order.import_row, self._lines()["004"].name)
        self.assertEqual(str(order.completed_at), "2026-09-18 17:34:40")
        self.assertEqual(order.vehicle_type, "Tata 407")
        self.assertEqual(order.booked_by, "Kavya Menon")
        self.assertEqual(order.booked_by_mobile, "9000000001")
        self.assertEqual(order.booked_by_email, "kavya.menon@example.com")
        self.assertEqual(order.waypoint_addresses, "Demo Hardware  KR Market  Bengaluru  Karnataka 560002  India")
        self.assertEqual(order.remark, "zephyr tower project")
        self.assertEqual(order.order_status, "completed")
        self.assertEqual(order.city, "Bangalore")
        self.assertAlmostEqual(order.distance_km, 12.49)
        self.assertEqual(float(order.fare), 1616.0)
        self.assertAlmostEqual(float(order.rcm_gst), 80.8, places=2)

    def test_an_invoices_expenses_share_its_one_pdf_and_no_file_row_is_added(self):
        for old, number in self.numbers.items():
            url = frappe.db.get_value(INVOICE_DOCTYPE, number, "invoice_file")
            attachments = {e.invoice_attachment for e in self._expenses() if e.invoice_ref == number}
            self.assertEqual(attachments, {url}, old)
        self.assertEqual(frappe.db.count("File"), self.files_before)

    def test_every_expense_has_a_settled_porter_match_and_its_line_is_settled(self):
        for suffix, line in self._lines().items():
            with self.subTest(line=suffix):
                if suffix == "011":
                    self.assertEqual(line.row_status, "Skipped")
                    continue
                self.assertEqual(line.row_status, "Settled")
                [match] = frappe.get_all(
                    MATCH_DOCTYPE, filters={"import_row": line.name}, fields=["*"]
                )
                self.assertEqual(match.match_kind, "Settled")
                self.assertEqual(match.match_basis, MATCH_BASIS)
                self.assertEqual(match.created_by_import, 1)
                self.assertEqual(match.target_name, line.suggested_name)
                self.assertEqual(match.transfer_id, line.transfer_id)
                self.assertEqual(float(match.target_amount), float(line.amount))
                expected_project = line.resolved_project if line.suggested_doctype == PROJECT_EXPENSE else None
                self.assertEqual(match.target_project, expected_project)

    def test_the_import_reads_created_with_its_counts(self):
        status = porter_api.get_porter_status(self.batch)
        self.assertEqual(status["state"], "Created")
        self.assertEqual((status["to_create"], status["created"], status["failed"]), (0, 11, 0))
        self.assertTrue(porter_records.is_validated(self.batch))
        from nirmaan_stack.api.outflow_import.review import list_imports

        listed = next(
            item for item in list_imports(sources=json.dumps([SOURCE]), month="2026-09")
            if item["name"] == self.batch
        )
        self.assertEqual(listed["status"], "Created")

    def test_running_it_again_creates_nothing_more(self):
        self._run_create()
        self.assertEqual(len(self._expenses()), 11)
        self.assertEqual(len(self._orders()), 11)
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_batch": self.batch}), 11)

    def test_pressing_create_on_a_created_import_is_refused(self):
        with self.assertRaises(frappe.ValidationError) as caught:
            self._press_create()
        self.assertIn("already", str(caught.exception))


class TestCreateHonoursTheReviewedPlan(PorterCreateCase):
    def test_a_line_moved_in_review_lands_where_it_was_moved(self):
        from nirmaan_stack.api.outflow_import.porter_review import set_porter_placement

        self._validate()
        lines = self._lines()
        # Through Review's own endpoint (#1446): one Non-Project order to a project, one project order
        # to Non-Project.
        set_porter_placement(self.batch, json.dumps([lines["003"].name]), self.zephyr)
        set_porter_placement(self.batch, json.dumps([lines["002"].name]), None)
        self._press_create()
        self._run_create()
        moved = self._expense_of("003")
        self.assertEqual((moved.doctype, moved.projects), (PROJECT_EXPENSE, self.zephyr))
        self.assertEqual(moved.description, "Porter Delivery raised by Ravi Testkumar for Zephyr Tower")
        unplaced = self._expense_of("002")
        self.assertEqual(unplaced.doctype, NON_PROJECT_EXPENSE)
        self.assertEqual(unplaced.description, "Porter Delivery raised by Arjun Pillai")


class TestAnOrderWithNoBookedByName(PorterCreateCase):
    def test_paid_by_is_left_blank_never_the_importer(self):
        """Story 47: Paid by is who booked the order. A blank name records nobody, not the accountant."""
        self._validate()
        line = self._lines()["002"]
        statement = json.loads(line.porter_line) if isinstance(line.porter_line, str) else dict(line.porter_line)
        statement["customer_name"] = "  "
        frappe.db.set_value(ROW_DOCTYPE, line.name, "porter_line", json.dumps(statement), update_modified=False)
        frappe.db.commit()
        self._press_create()
        self._run_create()
        expense = self._expense_of("002")
        self.assertFalse(expense.payment_by)
        self.assertEqual(expense.description, "Porter Delivery for Quillon Park")


class TestAProjectNoLongerWon(PorterCreateCase):
    def test_its_lines_stop_in_error_naming_the_project_and_the_rest_are_created(self):
        """A project Review placed a line on may stop being Won before Create runs: Create refuses that
        line rather than put spend on it (or move it to Non-Project behind the reviewer's back)."""
        self._validate()
        self._press_create()
        frappe.db.set_value("Projects", self.quillon, "tendering_status", "Tendering", update_modified=False)
        frappe.db.commit()
        self.addCleanup(self._won_again, self.quillon)
        self._run_create()
        on_quillon = [line for line in self._lines().values() if line.resolved_project == self.quillon]
        self.assertTrue(on_quillon)
        for line in on_quillon:
            self.assertEqual(line.row_status, "Error")
            self.assertIn("Quillon Park", line.outcome_note)
            self.assertIn("not Won", line.outcome_note)
        self.assertFalse(
            frappe.get_all(PROJECT_EXPENSE, filters={"projects": self.quillon, "porter_order": ["is", "set"]})
        )
        status = porter_api.get_porter_status(self.batch)
        self.assertEqual(status["failed"], len(on_quillon))
        self.assertEqual(status["created"], 11 - len(on_quillon))

    @staticmethod
    def _won_again(project: str) -> None:
        frappe.db.rollback()
        frappe.db.set_value("Projects", project, "tendering_status", "Won", update_modified=False)
        frappe.db.commit()


class TestTheNextImportRemembersThePlacement(PorterCreateCase):
    """Signal 5 (#1448): what a person kept in this import is suggested for the same remark and city in
    the next one. Read off the LIVE Expense of each earlier Porter Order."""

    def _next_import(self):
        from nirmaan_stack.api.outflow_import.test_porter_import import _fresh_fixture

        content, _ = _fresh_fixture()
        batch = self._upload(content)["batch"]
        return {
            row.transfer_id[-3:]: row
            for row in frappe.get_all(ROW_DOCTYPE, filters={"import_batch": batch}, fields=["*"])
        }

    def test_a_placement_kept_last_time_is_suggested_for_the_same_remark_and_city(self):
        from nirmaan_stack.api.outflow_import.porter_review import set_porter_placement

        self._validate()
        # "quillon site" in Bangalore is moved to Zephyr Tower; "misc delivery" is kept Non-Project.
        set_porter_placement(self.batch, json.dumps([self._lines()["002"].name]), self.zephyr)
        self._press_create()
        self._run_create()

        lines = self._next_import()
        moved = lines["002"]
        self.assertEqual((moved.resolved_project, moved.suggested_doctype), (self.zephyr, PROJECT_EXPENSE))
        self.assertEqual((moved.placement_reason, moved.placement_strength), ("history", "Strong"))
        # The same remark in another city is another group: kept on Quillon Park, where it was created.
        self.assertEqual((lines["006"].resolved_project, lines["006"].placement_reason), (self.quillon, "history"))
        kept_off = lines["005"]
        self.assertEqual((kept_off.suggested_doctype, kept_off.placement_reason), (NON_PROJECT_EXPENSE, "history"))
        self.assertIsNone(kept_off.resolved_project)

    def test_an_unreconciled_order_is_forgotten(self):
        from nirmaan_stack.api.outflow_import.porter_review import set_porter_placement
        from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row

        self._validate()
        set_porter_placement(self.batch, json.dumps([self._lines()["002"].name]), self.zephyr)
        self._press_create()
        self._run_create()
        unreconcile_row(row=self._lines()["002"].name, legs="all", reason="placed on the wrong project")

        moved = self._next_import()["002"]
        self.assertEqual((moved.resolved_project, moved.placement_reason), (self.quillon, "name"))


class TestAnInterruptedCreateResumes(PorterCreateCase):
    def test_a_line_that_failed_is_left_in_error_and_a_rerun_finishes_without_duplicates(self):
        self._validate()
        self._press_create()
        real = porter_create.create_expense_from_row
        calls = []

        def _third_fails(*args, **kwargs):
            calls.append(1)
            if len(calls) == 3:
                raise RuntimeError("worker died")
            return real(*args, **kwargs)

        with patch.object(porter_create, "create_expense_from_row", side_effect=_third_fails):
            self._run_create()
        status = porter_api.get_porter_status(self.batch)
        self.assertEqual(status["state"], "Creating")
        self.assertEqual((status["created"], status["failed"]), (10, 1))
        failed = [line for line in self._lines().values() if line.row_status == "Error"]
        self.assertEqual(len(failed), 1)
        self.assertIn("Could not create", failed[0].outcome_note)
        # The failed line's Porter Order went with its rolled-back transaction.
        self.assertFalse(frappe.db.exists(ORDER_DOCTYPE, failed[0].transfer_id))

        result, jobs = self._press_create()
        self.assertEqual(len(jobs), 1)
        self._run_create()
        self.assertEqual(porter_api.get_porter_status(self.batch)["state"], "Created")
        self.assertEqual(len(self._expenses()), 11)
        self.assertEqual(len(self._orders()), 11)


class TestAnUnreconciledLineIsCreatedAgain(PorterCreateCase):
    def test_a_rerun_recreates_it_on_the_same_porter_order(self):
        from nirmaan_stack.api.outflow_import.unreconcile import unreconcile_row

        self._validate()
        self._press_create()
        self._run_create()
        line = self._lines()["001"]
        first = line.suggested_name
        unreconcile_row(row=line.name, legs="all", reason="wrong project")
        self.assertFalse(frappe.db.exists(PROJECT_EXPENSE, first))
        self.assertTrue(frappe.db.exists(ORDER_DOCTYPE, line.transfer_id))
        self.assertEqual(porter_api.get_porter_status(self.batch)["state"], "Creating")

        self._press_create()
        self._run_create()
        again = self._lines()["001"]
        self.assertEqual(again.row_status, "Settled")
        self.assertNotEqual(again.suggested_name, first)
        self.assertEqual(frappe.db.get_value(PROJECT_EXPENSE, again.suggested_name, "porter_order"), line.transfer_id)
        self.assertEqual(len(self._orders()), 11)
        self.assertEqual(len(self._expenses()), 11)
        self.assertEqual(porter_api.get_porter_status(self.batch)["state"], "Created")


class TestTheProjectsNumbersIncludeTheExpenses(PorterCreateCase):
    def test_the_cashflow_gap_counts_every_created_expense_and_the_hold_follows_it(self):
        self._validate()
        gap_before = _compute_cashflow_gap(self.zephyr)
        # Over the limit only once MORE than the first Zephyr order is counted (858): the hook's per-request
        # check sees the first insert only, so this holds only if Create re-evaluates at the end.
        frappe.db.set_value(
            "Projects", self.zephyr, "cashflow_gap_limit", gap_before + 1000, update_modified=False
        )
        ceo_hold.clear_reason(self.zephyr, ceo_hold.SOURCE_CASHFLOW)
        frappe.db.commit()
        self._press_create()
        self._run_create()
        # 858 + 1616 + 528 + 456: the four Zephyr orders' fares.
        self.assertEqual(_compute_cashflow_gap(self.zephyr), gap_before + 3458)
        self.assertIn(ceo_hold.SOURCE_CASHFLOW, ceo_hold.active_sources(self.zephyr))
