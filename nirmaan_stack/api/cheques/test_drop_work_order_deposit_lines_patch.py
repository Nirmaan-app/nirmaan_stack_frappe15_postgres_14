# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one-time patch that takes Work Orders off existing Security Deposit cheques (#1518, spec #1514).

Drives the patch's entry function (`drop_work_order_lines`) on planted cheques only, the way `execute` runs
it over every deposit cheque, and reads back what a user then sees: each cheque's lines, status and history,
and what the patch prints.

Each planted deposit cheque is recorded through `save_cheque` naming a PO (or nothing), then given a Work
Order line with a raw insert: that is the old data the patch meets, a state today's rules refuse.

⚠️ RUNS AGAINST THE ENV DATABASE (`save_cheque` commits). Vendors, projects and Work Orders come from
`TaxedWorkOrderFixture`, POs from `ChequeFixture.plant_po`; every Cheque carries a TESTCHQ number and is
purged by `ChequeFixture`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.cheque_status import cancel_cheque
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.patches.v3_0.drop_work_order_deposit_lines import drop_work_order_lines, summary

U = "Administrator"
PO = "Procurement Orders"
WO = "Service Requests"
SECURED = "Secured PO/WO"
PHOTO = "https://storage.example.invalid/private/files/deposit-cheque-test.jpg"


class TestDropWorkOrderDepositLinesPatch(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor()
        self.project = self.fx.project()
        self.po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor)
        self.wo = self.fx.service_request(self.project, self.vendor)
        frappe.db.commit()
        self.planted = []

    def tearDown(self):
        frappe.db.rollback()
        frappe.set_user(U)

    # -- planting -------------------------------------------------------------------------------
    def _deposit(self, *records, wo_line=True, returned=False):
        """A deposit cheque securing `records` (PO names), Cancelled when `returned`, then given a Work Order
        line the old rules allowed."""
        result = save_cheque(
            cheque_type="Security Deposit", bank="ICICI Bank", cheque_no=self.cheques.number(),
            cheque_date=nowdate(), issue_date=nowdate(), amount=200000, vendor=self.vendor, attachment=PHOTO,
            lines=[{"line_type": SECURED, "record_doctype": PO, "record_name": r} for r in records],
        )
        name = self.cheques.track(result["cheque"])
        if returned:
            cancel_cheque(name, "Returned by vendor")
        if wo_line:
            # Raw on purpose: this plants old data, a line today's `validate` refuses.
            frappe.get_doc({
                "doctype": "Cheque Line", "parent": name, "parenttype": "Cheques", "parentfield": "lines",
                "idx": len(records) + 1, "line_type": SECURED, "project": self.project,
                "record_doctype": WO, "record_name": self.wo, "amount": 0,
            }).db_insert()
        frappe.db.commit()
        self.planted.append(name)
        return name

    def _migrate(self):
        result = drop_work_order_lines(cheques=self.planted)
        frappe.db.commit()
        return result

    def _lines(self, name):
        return [
            (r.record_doctype, r.record_name)
            for r in frappe.get_all("Cheque Line", filters={"parent": name, "parenttype": "Cheques"},
                                    fields=["record_doctype", "record_name"], order_by="idx asc")
        ]

    def _history(self, name):
        return [
            (h.from_status, h.to_status, h.note)
            for h in frappe.get_all("Cheque Status History", filters={"parent": name, "parenttype": "Cheques"},
                                    fields=["from_status", "to_status", "note"], order_by="idx asc")
        ]

    # -- the patch --------------------------------------------------------------------------------
    def test_it_drops_the_work_order_and_keeps_the_po_line_and_the_cheque(self):
        name = self._deposit(self.po)
        self.assertEqual(self._lines(name), [(PO, self.po), (WO, self.wo)])

        result = self._migrate()

        self.assertEqual(self._lines(name), [(PO, self.po)])
        self.assertEqual(frappe.db.get_value("Cheques", name, "status"), "Issued")
        self.assertEqual(self._history(name)[-1], (
            "Issued", "Issued", f"Work Order {self.wo} taken off: Work Orders have no cheques.",
        ))
        cheque_no = frappe.db.get_value("Cheques", name, "cheque_no")
        self.assertEqual(result, {"changed": [{"cheque": name, "cheque_no": cheque_no, "work_orders": [self.wo]}],
                                  "failed": []})
        self.assertEqual(summary(result), [
            "1 deposit cheque(s) changed, 0 refused",
            f"changed {name} ({cheque_no}): took off Work Order {self.wo}",
        ])

    def test_a_cheque_left_securing_nothing_is_kept_at_its_status(self):
        held = self._deposit()
        returned = self._deposit(returned=True)

        self._migrate()

        self.assertEqual(self._lines(held), [])
        self.assertEqual(self._lines(returned), [])
        self.assertEqual(frappe.db.get_value("Cheques", held, "status"), "Issued")
        self.assertEqual(frappe.db.get_value("Cheques", returned, "status"), "Cancelled")
        self.assertEqual(self._history(returned)[-1][:2], ("Cancelled", "Cancelled"))

    def test_a_second_run_changes_nothing(self):
        name = self._deposit(self.po)
        untouched = self._deposit(self.po, wo_line=False)
        self._migrate()
        history, modified = self._history(name), frappe.db.get_value("Cheques", name, "modified")

        result = self._migrate()

        self.assertEqual(result, {"changed": [], "failed": []})
        self.assertEqual(summary(result), ["0 deposit cheque(s) changed, 0 refused"])
        self.assertEqual(self._history(name), history)
        self.assertEqual(frappe.db.get_value("Cheques", name, "modified"), modified)
        self.assertEqual(self._lines(untouched), [(PO, self.po)])
        self.assertEqual(len(self._history(untouched)), 1)
