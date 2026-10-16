# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and Contributors
# See license.txt

"""Paying reads each record's own pay-to account (spec #1420 tickets #1431, #1438, ADR-0033).

Drives `api/payees/paid_to` and the approval queue the way "Payment need to paid", Export for Payment
and Record Payment do, and reads back what the accountant sees: each row's Paid to, the "Pay ₹X to"
box for an expense and for a PO payment, and Change account.

Every row is paid into its own copy (`pay_to_*`), never into its vendor's Payee as it reads now: the
vendors here are pointed at a different Payee than the rows' copies to prove it.

⚠️ RUNS AGAINST THE ENV DATABASE. Payees come from `PayeeFixture`; every vendor, payment, expense,
request and expense type planted here is deleted by the test's own cleanup.

Run:
  devenv.sh test --module nirmaan_stack.api.payees.test_paid_to
"""

from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import today

from nirmaan_stack.api import payment_autofill
from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue
from nirmaan_stack.api.expense_requests.test_expense_requests import _make_user
from nirmaan_stack.api.payees.paid_to import (
    change_expense_account,
    get_paid_to,
    get_pay_to_box,
    take_vendor_accounts,
)
from nirmaan_stack.api.payees.payee_fixture import PayeeFixture, delete_each
from nirmaan_stack.api.test_cheque_photo_reader import _SETTINGS, _FakeModels
from nirmaan_stack.services.extraction.gemini import GeminiExtractor
from nirmaan_stack.services.payees.pay_to import PAY_TO_FIELDS
from nirmaan_stack.services.payees.rules import ACCOUNT_FIELDS
from nirmaan_stack.services.payees.writer import edit_payee

U = "Administrator"
PM_USER = "pye_paidto_pm@example.com"
PM_PROFILE = "Nirmaan Project Manager Profile"
#: Reads expenses but may not write them (the doctypes' DocPerm: PMO Executive is read-only).
PMO_USER = "pye_paidto_pmo@example.com"
PMO_PROFILE = "Nirmaan PMO Executive Profile"
#: Accounts: the roles the expense Edit dialog shows Who gets paid to (#1465). The Accountant also pays
#: on "Payment need to paid": Mark as Paid and Export for Payment (#1463).
ACCOUNTANT_USER = "pye_paidto_acct@example.com"
ACCOUNTANT_LEAD_USER = "pye_paidto_acct_lead@example.com"
PAYMENT = "Project Payments"
PE = "Project Expenses"
NPE = "Non Project Expenses"


class TestPaidTo(FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _make_user(PM_USER, PM_PROFILE, ("Nirmaan Project Manager",))
        _make_user(PMO_USER, PMO_PROFILE, ("Nirmaan PMO Executive",))
        _make_user(ACCOUNTANT_USER, "Nirmaan Accountant Profile", ("Nirmaan Accountant",))
        _make_user(ACCOUNTANT_LEAD_USER, "Nirmaan Accountant Lead Profile", ("Nirmaan Accountant Lead",))
        cls.types = {}
        for rule in ("Required", "Optional", "Not asked"):
            name = f"pye_paidto_{rule.replace(' ', '_').lower()}_{frappe.generate_hash(length=5)}"
            doc = frappe.new_doc("Expense Type")
            doc.update({"expense_name": name, "non_project": 1, "expense_category": "Uncategorized",
                        "payee_rule": rule})
            doc.insert(ignore_permissions=True)
            cls.types[rule] = doc.name
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user(U)
        scopes = [("Expense Type", name) for name in cls.types.values()]
        for user in (PM_USER, PMO_USER, ACCOUNTANT_USER, ACCOUNTANT_LEAD_USER):
            scopes += [("Nirmaan Users", user), ("User", user)]
        try:
            delete_each(scopes)
        finally:
            super().tearDownClass()

    def setUp(self):
        frappe.set_user(U)
        self.payees = PayeeFixture.attach(self)
        self.planted: list[tuple[str, str]] = []
        self.addCleanup(self._purge)

    def tearDown(self):
        frappe.set_user(U)

    # -- helpers --------------------------------------------------------------------------------
    def _purge(self):
        delete_each(reversed(self.planted), raw={doctype for doctype, _ in self.planted})

    def _insert(self, doctype, values, owner=U):
        name = f"TEST-PAIDTO-{frappe.generate_hash(length=10)}"
        columns = ", ".join(f'"{c}"' for c in values)
        marks = ", ".join(["%s"] * len(values))
        frappe.db.sql(
            f"""INSERT INTO "tab{doctype}" (name, creation, modified, modified_by, owner, docstatus, idx,
                    {columns})
                VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, {marks})""",
            (name, owner, owner, *values.values()),
        )
        self.planted.append((doctype, name))
        frappe.db.commit()
        return name

    def _copy_of(self, payee):
        """A pay-to copy of `payee`'s account, as the record's own fields."""
        if not payee:
            return {field: None for field in PAY_TO_FIELDS}
        values = frappe.db.get_value("Payee", payee, list(ACCOUNT_FIELDS))
        return dict(zip(PAY_TO_FIELDS, values))

    def _account(self, payee):
        """`payee`'s account as the paid-to reader answers it."""
        return dict(zip(ACCOUNT_FIELDS, frappe.db.get_value("Payee", payee, list(ACCOUNT_FIELDS))))

    def _vendor(self, payee=None):
        return self._insert("Vendors", {"vendor_name": f"TESTPYE Vendor {frappe.generate_hash(length=5)}",
                                        "payee": payee})

    def _payment(self, vendor, copy_of=None, status="Approved", *, saved=False, mode="Online"):
        """A PO payment. One the test saves again (`saved`) names no PO: the planted PO number names
        no record, a save checks the link, and marking it paid would sync that PO's term."""
        po = {} if saved else {"document_type": "Procurement Orders", "document_name": "PO/TEST/PAIDTO"}
        return self._insert(PAYMENT, {"vendor": vendor, "amount": 78000, "status": status,
                                      "mode_of_payment": mode, **po, **self._copy_of(copy_of)})

    def _expense(self, doctype=NPE, *, rule="Optional", copy_of=None, vendor=None, request_id=None,
                 status="Approved"):
        values = {"type": self.types[rule], "amount": 25000, "status": status,
                  "request_id": request_id, "description": "Advance for shuttering labour",
                  **self._copy_of(copy_of)}
        if vendor:
            values["vendor"] = vendor
        return self._insert(doctype, values)

    def _request(self, copy_of, owner=PM_USER):
        return self._insert("Expense Request", {"type": self.types["Required"], "amount": 25000,
                                                "status": "Approved", **self._copy_of(copy_of)},
                            owner=owner)

    def _receipt_match(self, payment, beneficiary):
        """Read a receipt attached to `payment` whose beneficiary is `beneficiary`, as Record Payment's
        autofill does, and return its soft name check."""
        receipt = SimpleNamespace(name="FILE-RCPT", file_name="receipt.pdf",
                                  attached_to_doctype=PAYMENT, attached_to_name=payment)
        client = SimpleNamespace(models=_FakeModels({"utr": "UTR12345678", "beneficiary_name": beneficiary}))
        with patch.object(payment_autofill, "get_file_doc_by_url", return_value=receipt), \
                patch.object(payment_autofill, "get_extraction_settings", return_value=_SETTINGS), \
                patch.object(payment_autofill, "fetch_file_content", return_value=b"%PDF-canned"), \
                patch.object(GeminiExtractor, "_build_client", return_value=client):
            out = payment_autofill.extract_payment_fields("/private/files/receipt.pdf")
        return out["validation"]["vendor_match"]

    def _as(self, user, fn, **kw):
        frappe.set_user(user)
        try:
            return fn(**kw)
        finally:
            frappe.set_user(U)

    # -- Paid to on "Payment need to paid" and in the bank file -----------------------------------
    def test_each_row_holds_its_own_copy_not_its_vendors_payee_now(self):
        # An expense is paid into its own copy whatever its vendor's Payee says now. A PO payment's copy
        # is still the one it was raised with: it takes the vendor's account only when paid (#1463).
        raised_with = self.payees.payee(self.payees.holder("Kaveri Ductfab"))
        vendor_now = self.payees.payee(self.payees.holder("Kaveri Ductfab New Bank"))
        expense_copy = self.payees.payee(self.payees.holder("Ramesh Kumar Yadav"))
        payment = self._payment(self._vendor(vendor_now), copy_of=raised_with)
        expense = self._expense(PE, copy_of=expense_copy, vendor=self._vendor(vendor_now))

        paid_to = get_paid_to([{"doctype": PAYMENT, "name": payment}, {"doctype": PE, "name": expense}])

        self.assertEqual([row["account"] for row in paid_to],
                         [self._account(raised_with), self._account(expense_copy)])
        self.assertEqual([row["missing"] for row in paid_to], [None, None])
        self.assertIsNone(paid_to[1]["switch_to"])

    def test_a_row_with_no_account_says_why(self):
        # Neither the payment nor its vendor has an account; the expenses hold none.
        payment = self._payment(self._vendor())
        optional = self._expense(rule="Optional")
        required = self._expense(rule="Required")

        paid_to = get_paid_to([{"doctype": PAYMENT, "name": payment},
                               {"doctype": NPE, "name": optional},
                               {"doctype": NPE, "name": required}])

        self.assertEqual(
            [(row["account"], row["missing"], row["payee_rule"], row["switch_to"]) for row in paid_to],
            [(None, "payment_has_no_account", None, None),
             (None, "expense_has_no_account", "Optional", None),
             (None, "expense_has_no_account", "Required", None)],
        )

    def test_the_queue_rows_carry_their_own_copy(self):
        raised_with, vendor_now = self.payees.payee(), self.payees.payee()
        payment = self._payment(self._vendor(vendor_now), copy_of=raised_with)
        expense = self._expense(PE, copy_of=raised_with)
        no_account = self._expense(PE, rule="Not asked")

        result = get_approval_queue(filters=[["name", "in", [payment, expense, no_account]]],
                                    limit_page_length=10)

        by_name = {row["name"]: row["paid_to"] for row in result["data"]}
        self.assertEqual(by_name[payment]["account"], self._account(raised_with))
        self.assertEqual(by_name[expense]["account"], self._account(raised_with))
        self.assertEqual((by_name[no_account]["missing"], by_name[no_account]["payee_rule"]),
                         ("expense_has_no_account", "Not asked"))

    def test_paid_rows_in_the_queue_keep_saying_where_the_money_went(self):
        # Spec story 56/60: the Reconciliation Pending and Paid tabs show each row's account read-only.
        raised_with, vendor_now = self.payees.payee(), self.payees.payee()
        paid = []
        for status in ("Reconciliation Pending", "Paid"):
            paid += [self._payment(self._vendor(vendor_now), copy_of=raised_with, status=status),
                     self._expense(PE, copy_of=raised_with, status=status),
                     self._expense(NPE, copy_of=raised_with, status=status)]

        result = get_approval_queue(filters=[["name", "in", paid]], limit_page_length=10)

        self.assertEqual({row["name"]: row["paid_to"]["account"] for row in result["data"]},
                         {name: self._account(raised_with) for name in paid})

    # -- Paid into the vendor's current account (#1463, replacing #1439's "reject and raise again") --
    def _edit_account(self, payee, *, account_name=None, account_number=None):
        """Edit `payee` through the Payee module, as the Payees page and the vendor screens do."""
        current = frappe.db.get_value("Payee", payee, ["account_name", "account_number", "ifsc"], as_dict=True)
        edit_payee(payee, account_name or current.account_name, account_number or current.account_number,
                   current.ifsc)
        frappe.db.commit()

    def _every_reader(self, doctype, name):
        """What the bank file, the approval queue and the Pay box each answer for one row."""
        queue = get_approval_queue(filters=[["name", "in", [name]]], limit_page_length=10)["data"]
        return {
            "bank file": get_paid_to([{"doctype": doctype, "name": name}])[0],
            "queue": queue[0]["paid_to"],
            "box": get_pay_to_box(doctype, name),
        }

    def test_a_payment_whose_vendors_account_was_edited_since_is_offered_at_the_vendors_current_account(self):
        payee = self.payees.payee()
        payment = self._payment(self._vendor(payee), copy_of=payee)
        raised_with = self._account(payee)
        new_number = self.payees.account_number()

        self._edit_account(payee, account_number=new_number)

        for reader, answer in self._every_reader(PAYMENT, payment).items():
            with self.subTest(reader=reader):
                self.assertEqual(answer["account"], raised_with)
                self.assertEqual(answer["switch_to"]["account_number"], new_number)
                self.assertEqual(answer["switch_to"], self._account(payee))
                self.assertIsNone(answer["missing"])

    def test_a_payment_with_no_copy_takes_its_vendors_account(self):
        payee = self.payees.payee()
        payment = self._payment(self._vendor(payee))

        for reader, answer in self._every_reader(PAYMENT, payment).items():
            with self.subTest(reader=reader):
                self.assertEqual((answer["account"], answer["missing"]), (None, None))
                self.assertEqual(answer["switch_to"], self._account(payee))

    def test_a_payment_whose_vendor_has_no_payee_any_more_keeps_its_own_copy(self):
        payee = self.payees.payee()
        vendor = self._vendor(payee)
        payment = self._payment(vendor, copy_of=payee)

        frappe.db.set_value("Vendors", vendor, "payee", None, update_modified=False)
        frappe.db.commit()

        for reader, answer in self._every_reader(PAYMENT, payment).items():
            with self.subTest(reader=reader):
                self.assertIsNone(answer["switch_to"])
                self.assertEqual(answer["account"], self._account(payee))

    def test_a_payment_whose_vendor_keeps_the_same_account_is_not_switched(self):
        renamed = self.payees.payee(holder=self.payees.holder("Kaveri Ductfab"))
        unchanged = self.payees.payee()
        renamed_payment = self._payment(self._vendor(renamed), copy_of=renamed)
        # The same account written another way: leading zeros, spaces and a lower-case IFSC.
        unchanged_payment = self._payment(self._vendor(unchanged))
        number, ifsc = frappe.db.get_value("Payee", unchanged, ["account_number", "ifsc"])
        frappe.db.set_value(PAYMENT, unchanged_payment, {
            "pay_to_account_name": "someone", "pay_to_account_number": f"00{number[:4]} {number[4:]}",
            "pay_to_ifsc": f" {ifsc.lower()} "}, update_modified=False)
        frappe.db.commit()

        self._edit_account(renamed, account_name=self.payees.holder("Kaveri Ductfab Pvt Ltd"))

        for payment in (renamed_payment, unchanged_payment):
            for reader, answer in self._every_reader(PAYMENT, payment).items():
                with self.subTest(payment=payment, reader=reader):
                    self.assertIsNone(answer["switch_to"])

    def test_an_expense_and_a_paid_payment_never_switch(self):
        payee, vendor_now = self.payees.payee(), self.payees.payee()
        expense = self._expense(PE, copy_of=payee, vendor=self._vendor(vendor_now))
        blank_expense = self._expense(PE, vendor=self._vendor(vendor_now))
        paid = [self._payment(self._vendor(vendor_now), copy_of=payee, status=status)
                for status in ("Reconciliation Pending", "Paid")]
        paid_blank = self._payment(self._vendor(vendor_now), status="Paid")

        answers = get_paid_to([{"doctype": PE, "name": expense}, {"doctype": PE, "name": blank_expense},
                               *({"doctype": PAYMENT, "name": name} for name in (*paid, paid_blank))])

        self.assertEqual([a["switch_to"] for a in answers], [None] * 5)
        self.assertEqual(answers[-1]["missing"], "payment_has_no_account")
        self.assertIsNone(get_pay_to_box(PAYMENT, paid[0])["switch_to"])
        self.assertIsNone(get_pay_to_box(PE, expense)["switch_to"])

    def test_a_cheque_payment_says_so_and_never_takes_its_vendors_account(self):
        # #1464, ADR-0033 decision 10: a cheque pays no account, so it keeps its copy (or none) and is
        # kept out of the bank file; the screens read `by_cheque`.
        raised_with, vendor_now = self.payees.payee(), self.payees.payee()
        changed = self._payment(self._vendor(vendor_now), copy_of=raised_with, mode="Cheque")
        raised_with_none = self._payment(self._vendor(vendor_now), mode="Cheque")
        online = self._payment(self._vendor(vendor_now), copy_of=raised_with)

        for payment, account in ((changed, self._account(raised_with)), (raised_with_none, None)):
            for reader, answer in self._every_reader(PAYMENT, payment).items():
                with self.subTest(payment=payment, reader=reader):
                    self.assertEqual((answer["by_cheque"], answer["switch_to"], answer["account"]),
                                     (True, None, account))
        for reader, answer in self._every_reader(PAYMENT, online).items():
            with self.subTest(payment=online, reader=reader):
                self.assertEqual((answer["by_cheque"], answer["switch_to"]), (False, self._account(vendor_now)))
        expense = self._expense(PE, copy_of=raised_with)
        self.assertFalse(get_paid_to([{"doctype": PE, "name": expense}])[0]["by_cheque"])

    def test_paying_a_cheque_payment_leaves_its_account_as_it_is(self):
        raised_with, vendor_now = self.payees.payee(), self.payees.payee()
        payment = self._payment(self._vendor(vendor_now), copy_of=raised_with, saved=True, mode="Cheque")

        switched = self._as(ACCOUNTANT_USER, take_vendor_accounts, names=[payment])

        self.assertEqual(switched, [])
        self.assertEqual(self._stored_copy(payment), self._copy_of(raised_with))

    # -- Mark as Paid and Export for Payment write the vendor's account first (#1463) --------------
    def _stored_copy(self, payment):
        return frappe.db.get_value(PAYMENT, payment, list(PAY_TO_FIELDS), as_dict=True)

    def _mark_paid(self, payment):
        """Mark as Paid, as the screen writes it (`updateDoc`, through `frappe.client.set_value`)."""
        frappe.client.set_value(PAYMENT, payment, "status", "Reconciliation Pending")
        frappe.db.commit()

    def test_paying_a_payment_whose_vendors_account_changed_writes_the_vendors_account_with_who_and_when(self):
        raised_with, vendor_now = self.payees.payee(), self.payees.payee()
        payment = self._payment(self._vendor(vendor_now), copy_of=raised_with, saved=True)

        switched = self._as(ACCOUNTANT_USER, take_vendor_accounts, names=[payment])
        self._as(ACCOUNTANT_USER, self._mark_paid, payment=payment)

        self.assertEqual(switched, [payment])
        self.assertEqual(self._stored_copy(payment), self._copy_of(vendor_now))
        box = get_pay_to_box(PAYMENT, payment)
        self.assertEqual((box["account"], box["switch_to"], box["paid"]), (self._account(vendor_now), None, True))
        self.assertEqual((box["named_by"]["how"], box["named_by"]["user"], box["named_by"]["on"]),
                         ("changed", ACCOUNTANT_USER, today()))

    def test_paying_a_payment_with_no_copy_writes_its_vendors_account(self):
        vendor_now = self.payees.payee()
        payment = self._payment(self._vendor(vendor_now), saved=True)

        switched = self._as(ACCOUNTANT_USER, take_vendor_accounts, names=[payment])

        self.assertEqual(switched, [payment])
        self.assertEqual(self._stored_copy(payment), self._copy_of(vendor_now))
        self.assertEqual(get_pay_to_box(PAYMENT, payment)["named_by"]["user"], ACCOUNTANT_USER)

    def test_paying_leaves_a_payment_whose_vendors_account_did_not_change_untouched(self):
        payee = self.payees.payee()
        unchanged = self._payment(self._vendor(payee), copy_of=payee, saved=True)
        renamed_payee = self.payees.payee()
        renamed = self._payment(self._vendor(renamed_payee), copy_of=renamed_payee, saved=True)
        self._edit_account(renamed_payee, account_name=self.payees.holder("Kaveri Ductfab Pvt Ltd"))
        nowhere = self._payment(self._vendor(), saved=True)
        before = {name: (self._stored_copy(name), frappe.db.get_value(PAYMENT, name, "modified"))
                  for name in (unchanged, renamed, nowhere)}

        switched = self._as(ACCOUNTANT_USER, take_vendor_accounts, names=list(before))
        for name in before:
            self._as(ACCOUNTANT_USER, self._mark_paid, payment=name)

        self.assertEqual(switched, [])
        for name, (copy, modified) in before.items():
            with self.subTest(payment=name):
                self.assertEqual(self._stored_copy(name), copy)
                self.assertNotEqual((get_pay_to_box(PAYMENT, name)["named_by"] or {}).get("how"), "changed")
                self.assertIsNone(frappe.db.get_value(
                    "Version", {"ref_doctype": PAYMENT, "docname": name, "data": ["like", '%"pay_to_%']}))

    def test_paying_refuses_a_payment_that_is_no_longer_approved(self):
        # The screen sends only Approved rows; a paid one keeps saying where its money went.
        raised_with, vendor_now = self.payees.payee(), self.payees.payee()
        paid = self._payment(self._vendor(vendor_now), copy_of=raised_with, status="Reconciliation Pending",
                             saved=True)

        with self.assertRaises(frappe.ValidationError):
            self._as(ACCOUNTANT_USER, take_vendor_accounts, names=[paid])
        self.assertEqual(self._stored_copy(paid), self._copy_of(raised_with))

    def test_paying_asks_write_permission_on_the_payment(self):
        raised_with, vendor_now = self.payees.payee(), self.payees.payee()
        payment = self._payment(self._vendor(vendor_now), copy_of=raised_with, saved=True)

        with self.assertRaises(frappe.PermissionError):
            self._as(PMO_USER, take_vendor_accounts, names=[payment])
        self.assertEqual(self._stored_copy(payment), self._copy_of(raised_with))

    # -- payment autofill's name check ------------------------------------------------------------
    def test_a_receipt_is_checked_against_the_payments_own_holder_name(self):
        raised_with = self.payees.payee(holder="KRISHNA METALS")
        vendor_now = self.payees.payee(holder="SHARMA STEEL NEWBANK")
        payment = self._payment(self._vendor(vendor_now), copy_of=raised_with)

        paid_into_copy = self._receipt_match(payment, "Krishna Metals")
        paid_into_vendor_now = self._receipt_match(payment, "Sharma Steel Newbank")

        self.assertEqual((paid_into_copy["match"], paid_into_copy["by"]), (True, "account_name"))
        self.assertEqual(paid_into_copy["expected_account_name"], "KRISHNA METALS")
        self.assertIs(paid_into_vendor_now["match"], False)

    # -- the "Pay ₹X to" box -----------------------------------------------------------------------
    def test_the_box_names_the_raiser_who_set_the_account_on_the_request(self):
        payee = self.payees.payee()
        expense = self._expense(copy_of=payee, request_id=self._request(payee))

        box = get_pay_to_box(NPE, expense)

        self.assertEqual(box["account"], self._account(payee))
        self.assertEqual(box["account"]["bank_name"], "Test Bank")
        self.assertEqual(box["amount"], 25000)
        self.assertEqual((box["named_by"]["how"], box["named_by"]["user"]), ("request", PM_USER))
        self.assertEqual(box["named_by"]["on"], today())

    def test_the_box_names_the_expense_and_its_types_rule_whether_or_not_it_has_an_account(self):
        # Change account words its line by the type's rule and offers Remove only when the type allows it.
        payee = self.payees.payee()
        for rule in ("Required", "Optional", "Not asked"):
            for copy_of in (payee, None):
                with self.subTest(rule=rule, account=bool(copy_of)):
                    box = get_pay_to_box(NPE, self._expense(rule=rule, copy_of=copy_of))
                    self.assertEqual((box["payee_rule"], box["description"]),
                                     (rule, "Advance for shuttering labour"))

        payment = get_pay_to_box(PAYMENT, self._payment(self._vendor(payee), copy_of=payee))
        self.assertEqual((payment["payee_rule"], payment["description"]), (None, None))

    def test_the_box_shows_a_po_payments_own_copy_from_the_vendor(self):
        raised_with, vendor_now = self.payees.payee(), self.payees.payee()
        payment = self._payment(self._vendor(vendor_now), copy_of=raised_with)

        box = get_pay_to_box(PAYMENT, payment)

        self.assertEqual(box["account"], self._account(raised_with))
        self.assertEqual(box["amount"], 78000)
        self.assertEqual(box["named_by"]["how"], "vendor")
        self.assertFalse(box["paid"])

    def test_change_account_overwrites_the_copy_and_records_who_and_when(self):
        first, second = self.payees.payee(), self.payees.payee()
        expense = self._expense(rule="Required", copy_of=first, request_id=self._request(first))

        box = change_expense_account(NPE, expense, second)

        self.assertEqual(frappe.db.get_value(NPE, expense, list(PAY_TO_FIELDS), as_dict=True),
                         self._copy_of(second))
        self.assertEqual(box["account"], self._account(second))
        self.assertEqual((box["named_by"]["how"], box["named_by"]["user"], box["named_by"]["on"]),
                         ("changed", U, today()))
        self.assertEqual(get_pay_to_box(NPE, expense)["named_by"]["how"], "changed")

    def test_the_box_says_paid_once_money_has_left_approved(self):
        payee = self.payees.payee()
        for status, paid in (("Approved", False), ("Reconciliation Pending", True), ("Paid", True)):
            with self.subTest(status=status):
                self.assertEqual(get_pay_to_box(NPE, self._expense(copy_of=payee, status=status))["paid"], paid)

    def test_an_expense_can_be_left_without_an_account(self):
        expense = self._expense(rule="Optional", copy_of=self.payees.payee())

        box = change_expense_account(NPE, expense, None)

        self.assertIsNone(box["account"])
        self.assertEqual(box["missing"], "expense_has_no_account")
        self.assertIsNone(frappe.db.get_value(NPE, expense, "pay_to_account_number"))

    def test_a_user_who_may_not_write_the_expense_cannot_change_its_account(self):
        first, second = self.payees.payee(), self.payees.payee()
        expense = self._expense(copy_of=first)
        with self.assertRaises(frappe.PermissionError):
            self._as(PMO_USER, change_expense_account, doctype=NPE, name=expense, payee=second)
        self.assertEqual(frappe.db.get_value(NPE, expense, "pay_to_account_number"),
                         self._copy_of(first)["pay_to_account_number"])

    def test_any_user_who_may_write_the_expense_changes_its_account(self):
        # Showing Change account to Accounts only is a screen rule (spec #1420 Drops): the server asks
        # Frappe's own write permission, which a Project Manager holds on expenses.
        first, second = self.payees.payee(), self.payees.payee()
        expense = self._expense(copy_of=first)

        box = self._as(PM_USER, change_expense_account, doctype=NPE, name=expense, payee=second)

        self.assertEqual(box["account"], self._account(second))
        self.assertEqual(frappe.db.get_value(NPE, expense, "pay_to_account_number"),
                         self._copy_of(second)["pay_to_account_number"])

    def test_accounts_save_the_edit_dialog_and_its_picked_payee_onto_an_approved_expense(self):
        # The expense Edit dialog (the pencil on "Payment need to paid", #1465) saves its fields the
        # way the SDK's updateDoc does, then copies the picked Payee through Change account's endpoint.
        first, picked = self.payees.payee(), self.payees.payee()
        for doctype in (PE, NPE):
            for user in (ACCOUNTANT_USER, ACCOUNTANT_LEAD_USER):
                with self.subTest(doctype=doctype, user=user):
                    expense = self._expense(doctype, rule="Required", copy_of=first)

                    def save_the_dialog():
                        doc = frappe.get_doc(doctype, expense)
                        doc.update({"description": "Shuttering labour, second week", "vendor": ""}
                                   if doctype == PE else {"description": "Shuttering labour, second week"})
                        doc.save()
                        return change_expense_account(doctype=doctype, name=expense, payee=picked)

                    box = self._as(user, save_the_dialog)

                    self.assertEqual(frappe.db.get_value(doctype, expense, list(PAY_TO_FIELDS), as_dict=True),
                                     self._copy_of(picked))
                    self.assertEqual(frappe.db.get_value(doctype, expense, "description"),
                                     "Shuttering labour, second week")
                    self.assertEqual(box["account"], self._account(picked))
                    self.assertEqual((box["named_by"]["how"], box["named_by"]["user"]), ("changed", user))

    def test_the_endpoints_refuse_a_doctype_that_is_not_paid(self):
        payment = self._payment(self._vendor(), copy_of=self.payees.payee())
        with self.assertRaises(frappe.ValidationError):
            change_expense_account(PAYMENT, payment, self.payees.payee())
        with self.assertRaises(frappe.ValidationError):
            get_pay_to_box("Vendors", "x")
        with self.assertRaises(frappe.ValidationError):
            get_paid_to([{"doctype": "Vendors", "name": "x"}])
