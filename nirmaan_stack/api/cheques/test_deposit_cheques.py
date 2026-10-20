# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Security Deposit cheques through the endpoints (#1486, spec #1477, ADR-0035).

Drives what the Add Cheque dialog, the PO / Work Order page card, the Edit dialog and the Cancel dialog call
(`save_cheque.save_cheque` with `cheque_type`, `cheque_status.cancel_cheque`, the bank import's
`status.clear`, `pickers.get_securable_records`, `list_cheques.get_cheques`) and reads back what a user sees: the Cheque's
type, status, issue date, lines and history, the tracker's tabs and the PO card's list, or the refusal.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Vendors, projects and Work Orders come from
`TaxedWorkOrderFixture`, POs from `ChequeFixture.plant_po`; every Cheque carries a TESTCHQ number and is
purged by `ChequeFixture`.
"""

import json

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, nowdate

from nirmaan_stack.api.cheques.cheque_fixture import ChequeFixture
from nirmaan_stack.api.cheques.cheque_status import cancel_cheque
from nirmaan_stack.api.cheques.list_cheques import get_cheques
from nirmaan_stack.api.cheques.pickers import get_securable_records
from nirmaan_stack.api.cheques.save_cheque import save_cheque
from nirmaan_stack.api.payments.taxed_work_order_fixture import TaxedWorkOrderFixture
from nirmaan_stack.services.cheques.status import clear

U = "Administrator"
PO = "Procurement Orders"
WO = "Service Requests"
SD = "Security Deposit"
ACCOUNTANT = "Nirmaan Accountant Profile"
PROJECT_MANAGER = "Nirmaan Project Manager Profile"
PROCUREMENT = (
    "Nirmaan Procurement Executive Profile",
    "Nirmaan Procurement Lead Profile",
    "Nirmaan Material Procurement Executive Profile",
    "Nirmaan Service Procurement Executive Profile",
)
PHOTO = "https://storage.example.invalid/private/files/deposit-cheque-test.jpg"
NEW_PHOTO = "https://storage.example.invalid/private/files/deposit-cheque-test-2.jpg"
#: The Cheque Tracker's tab filters (`frontend/src/utils/cheques/chequeTabs.ts`).
ISSUED_TAB = [["status", "=", "Issued"], ["cheque_type", "=", "Payment"]]
DEPOSITS_TAB = [["cheque_type", "=", SD]]


class TestSecurityDepositCheques(FrappeTestCase):
    def setUp(self):
        frappe.set_user(U)
        self.fx = TaxedWorkOrderFixture.attach(self)
        self.cheques = ChequeFixture.attach(self)
        self.vendor = self.fx.vendor()
        self.project = self.fx.project()
        self.po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor)
        self.wo = self.fx.service_request(self.project, self.vendor)
        frappe.db.commit()  # a refusal below rolls back; the rows must outlive it

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _secures(self, *records):
        return [{"line_type": "Secured PO/WO", "record_doctype": dt, "record_name": name} for dt, name in records]

    def _values(self, **overrides):
        values = {
            "cheque_type": SD,
            "bank": "ICICI Bank",
            "cheque_no": self.cheques.number(),
            "cheque_date": nowdate(),
            "issue_date": nowdate(),
            "amount": 200000,
            "vendor": self.vendor,
            "attachment": PHOTO,
            "lines": [],
        }
        values.update(overrides)
        return {k: v for k, v in values.items() if v is not None}

    def _save(self, **overrides):
        return self.cheques.track(save_cheque(**self._values(**overrides))["cheque"])

    def _refused(self, phrase, fn=None, *args, **kwargs):
        with self.assertRaisesRegex(frappe.ValidationError, phrase):
            (fn or self._save)(*args, **kwargs)
        frappe.db.rollback()

    def _user(self, profiles, *, other_than=()):
        for user in frappe.get_all(
            "Nirmaan Users", filters={"role_profile": ["in", list(profiles)]}, pluck="name", limit=20
        ):
            if user and user != U and user not in other_than and frappe.db.exists("User", user):
                return user
        self.skipTest(f"no user with {profiles} on this site")

    def _as(self, user, fn, *args, **kwargs):
        previous = frappe.session.user
        frappe.set_user(user)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user(previous)

    def _lines(self, cheque):
        return [
            (r.line_type, r.record_doctype, r.record_name, r.project, r.payment_name, float(r.amount or 0))
            for r in frappe.get_all("Cheque Line", filters={"parent": cheque, "parenttype": "Cheques"},
                                    fields=["line_type", "record_doctype", "record_name", "project", "payment_name",
                                            "amount"], order_by="idx asc")
        ]

    def _history(self, cheque):
        return [
            (h.from_status, h.to_status, h.changed_by, h.note)
            for h in frappe.get_all("Cheque Status History", filters={"parent": cheque, "parenttype": "Cheques"},
                                    fields=["from_status", "to_status", "changed_by", "note"], order_by="idx asc")
        ]

    def _listed(self, filters):
        return {r["name"] for r in get_cheques(filters=json.dumps(filters), limit_page_length=500)["data"]}

    # -- recording one ----------------------------------------------------------------------------
    def test_a_deposit_cheque_is_issued_when_recorded_on_its_typed_issue_date(self):
        issued_on = add_days(nowdate(), -3)
        result = save_cheque(**self._values(issue_date=issued_on))
        name = self.cheques.track(result["cheque"])

        self.assertEqual(result["status"], "Issued")
        cheque = frappe.get_doc("Cheques", name)
        self.assertEqual((cheque.cheque_type, cheque.status, str(cheque.issue_date)), (SD, "Issued", issued_on))
        self.assertFalse(cheque.clearance_date)
        self.assertEqual(self._history(name), [(None, "Issued", U, None)])
        self.assertEqual(self._lines(name), [])

    def test_it_may_be_made_out_to_a_typed_name_and_secure_nothing(self):
        name = self._save(vendor=None, payee_name="Kavitha Properties", description="Site office lease deposit")
        cheque = frappe.get_doc("Cheques", name)
        self.assertEqual((cheque.vendor, cheque.payee_name, cheque.status), (None, "Kavitha Properties", "Issued"))

    def test_it_names_the_vendor_s_pos_and_work_orders_it_secures_as_records_only(self):
        name = self._save(lines=self._secures((PO, self.po), (WO, self.wo)))

        self.assertEqual(self._lines(name), [
            ("Secured PO/WO", PO, self.po, self.project, None, 0.0),
            ("Secured PO/WO", WO, self.wo, self.project, None, 0.0),
        ])

    def test_the_issue_date_is_required_and_never_after_today(self):
        self._refused("Enter the issue date", issue_date="")
        self._refused("The issue date cannot be after today", issue_date=add_days(nowdate(), 1))

    def test_the_photo_is_required(self):
        self._refused("Upload the photo of the cheque", attachment=None)

    def test_it_cannot_carry_a_payment_line(self):
        line = {"line_type": "PO/WO Payment", "project": self.project, "record_doctype": PO,
                "record_name": self.po, "amount": 200000}
        self._refused("a Security Deposit cheque pays nothing", lines=[line])

    def test_it_secures_only_its_vendor_s_records_and_a_typed_payee_none(self):
        other_po = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.fx.vendor())
        self._refused("is not a PO or Work Order of this cheque's Vendor", lines=self._secures((PO, other_po)))
        self._refused("a cheque made out to a typed payee names no PO or Work Order",
                      vendor=None, payee_name="Kavitha Properties", lines=self._secures((PO, self.po)))
        self._refused("is on two lines", lines=self._secures((PO, self.po), (PO, self.po)))

    def test_a_payment_cheque_cannot_name_a_secured_record(self):
        # The Tracker's Payment cheque rule refuses it first; the `validate` controller would too.
        self._refused("a Payment cheque pays PO payments only", cheque_type=None, issue_date=None, lines=self._secures((PO, self.po)))

    def test_the_same_bank_and_number_as_any_cheque_is_refused(self):
        number = self.cheques.number()
        first = self._save(cheque_no=number)
        self._refused(f"already recorded as {first}", cheque_no=number)

    # -- where it shows ---------------------------------------------------------------------------
    def test_it_shows_in_security_deposits_and_on_its_po_and_wo_but_never_in_the_issued_tab(self):
        name = self._save(lines=self._secures((PO, self.po), (WO, self.wo)))
        elsewhere = self._save(lines=[])

        self.assertIn(name, self._listed(DEPOSITS_TAB))
        self.assertNotIn(name, self._listed(ISSUED_TAB))
        # The PO and Work Order page cards: the deposit cheques whose lines name that record.
        self.assertEqual(self._listed(DEPOSITS_TAB + [["record_name", "=", self.po]]), {name})
        self.assertEqual(self._listed(DEPOSITS_TAB + [["record_name", "=", self.wo]]), {name})
        self.assertNotIn(elsewhere, self._listed(DEPOSITS_TAB + [["record_name", "=", self.po]]))

    def test_the_secures_picker_offers_the_vendor_s_open_pos_and_work_orders(self):
        merged = ChequeFixture.plant_po(self, self.fx, project=self.project, vendor=self.vendor, status="Merged")
        offered = {(r["doctype"], r["name"]): r for r in get_securable_records(self.vendor)}

        self.assertIn((PO, self.po), offered)
        self.assertIn((WO, self.wo), offered)
        self.assertNotIn((PO, merged), offered)
        self.assertEqual(offered[(WO, self.wo)]["project"], self.project)

    # -- cancel: the one move ---------------------------------------------------------------------
    def test_accounts_cancel_it_with_a_note_and_no_other_move_exists(self):
        name = self._save(lines=self._secures((PO, self.po)))
        accountant = self._user((ACCOUNTANT,))

        self._refused("Write a note", self._as, accountant, cancel_cheque, name, "  ")
        out = self._as(accountant, cancel_cheque, name, "Returned by vendor at handover")

        self.assertEqual(out["status"], "Cancelled")
        self.assertEqual(frappe.db.get_value("Cheques", name, "status"), "Cancelled")
        self.assertEqual(self._history(name)[-1], ("Issued", "Cancelled", accountant, "Returned by vendor at handover"))
        self.assertEqual(self._lines(name), [("Secured PO/WO", PO, self.po, self.project, None, 0.0)])
        self._refused("already Cancelled", cancel_cheque, name, "again")

    def test_a_deposit_is_never_cleared_even_by_a_line_with_its_number_and_amount(self):
        number = f"{self.cheques.number()}0760"
        name = self._save(cheque_no=number)
        batch = frappe.new_doc("Outflow Import Batch")
        batch.update({"source": "ICICI Bank Statement", "status": "In Review"})
        batch.insert(ignore_permissions=True)
        row = frappe.new_doc("Outflow Import Row")
        row.update({
            "import_batch": batch.name, "source": "ICICI Bank Statement", "direction": "Debit",
            "transfer_id": f"chq-{frappe.generate_hash(length=10)}", "amount": 200000, "reference_id": number,
            "added_on": f"{nowdate()} 00:00:00", "row_status": "Mismatched",
        })
        row.insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(ChequeFixture.purge_rows, [
            ("Outflow Import Row", {"name": row.name}), ("Outflow Import Batch", {"name": batch.name}),
        ])

        self._refused("a Security Deposit cheque is never cashed", clear, name, bank_line=row.name, user=U)
        self.assertEqual(frappe.db.get_value("Cheques", name, "status"), "Issued")
        self.assertEqual(frappe.db.get_value("Outflow Import Row", row.name, "row_status"), "Mismatched")

    def test_procurement_cannot_cancel_a_deposit(self):
        name = self._save()
        with self.assertRaises(frappe.PermissionError):
            self._as(self._user(PROCUREMENT), cancel_cheque, name, "returned")
        frappe.db.rollback()

    # -- who may add and edit ---------------------------------------------------------------------
    def test_procurement_adds_one_and_edits_its_own_while_issued(self):
        buyer = self._user(PROCUREMENT)
        name = self.cheques.track(self._as(buyer, save_cheque, **self._values())["cheque"])
        self.assertEqual(frappe.db.get_value("Cheques", name, "owner"), buyer)

        earlier = add_days(nowdate(), -10)
        self._as(buyer, save_cheque, **self._values(
            name=name, cheque_no=frappe.db.get_value("Cheques", name, "cheque_no"), amount=150000,
            issue_date=earlier, lines=self._secures((WO, self.wo)),
        ))
        cheque = frappe.get_doc("Cheques", name)
        self.assertEqual((cheque.amount, str(cheque.issue_date), cheque.status), (150000, earlier, "Issued"))
        self.assertEqual(self._lines(name), [("Secured PO/WO", WO, self.wo, self.project, None, 0.0)])

        other = self._user(PROCUREMENT, other_than=(buyer,))
        with self.assertRaisesRegex(frappe.PermissionError, "Issued Security Deposit cheques you created"):
            self._as(other, save_cheque, **self._values(name=name, cheque_no=cheque.cheque_no))
        frappe.db.rollback()

    def test_a_cancelled_deposit_changes_only_its_photo(self):
        name = self._save(lines=self._secures((PO, self.po)))
        cancel_cheque(name, "Returned by vendor")
        cheque_no = frappe.db.get_value("Cheques", name, "cheque_no")
        kept = {"name": name, "cheque_no": cheque_no, "lines": self._secures((PO, self.po))}

        self._refused("is Cancelled: only its photo can change", **kept, amount=1)
        self._save(**kept, attachment=NEW_PHOTO)
        self.assertEqual(frappe.db.get_value("Cheques", name, "attachment"), NEW_PHOTO)

    def test_a_project_manager_cannot_add_one(self):
        with self.assertRaises(frappe.PermissionError):
            self._as(self._user((PROJECT_MANAGER,)), save_cheque, **self._values())
        frappe.db.rollback()
