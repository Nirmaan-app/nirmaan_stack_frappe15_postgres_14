# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""Reimbursements end to end: the own bank account, raise / edit / delete, approve / reject, who sees what.

⚠️ These run against the LIVE localhost site, so every fixture is namespaced `reimb_test_` and removed.
Storage is never touched: the local site points at the production bucket, so the IFSC lookup, reading a
file, storing the merged PDF and deleting Files are all stubbed (`_Storage`), and the Files the tests need
are inserted as fake cloud URLs.

Run:
  bench --site localhost run-tests --module nirmaan_stack.api.reimbursements.test_reimbursements
"""

from __future__ import annotations

import io
import threading
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.approvals import expense_actions
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.api.reimbursements import bank_accounts, claims, month_totals, queue, review
from nirmaan_stack.services.payees import own_accounts
from nirmaan_stack.services.reimbursements import access, convert, expense_link, receipts
from nirmaan_stack.services.reimbursements.month_total import month_totals as totals_of
from nirmaan_stack.services.reimbursements.rules import (
    APPROVED,
    PAID,
    PENDING,
    RECONCILIATION_PENDING,
    REJECTED,
    REQUESTED,
)
from nirmaan_stack.integrations.controllers.test_nirmaan_users import set_role_copy_for_test
from nirmaan_stack.services.expense_type_flag_guard import ExpenseTypeFlagGuard

NPE = "Non Project Expenses"

PM = "reimb_test_pm@example.com"
PM2 = "reimb_test_pm2@example.com"  # also carries System Manager, as several real profiles do
HR = "reimb_test_hr@example.com"
HRL = "reimb_test_hrl@example.com"
ADMIN = "reimb_test_admin@example.com"
ACC = "reimb_test_acc@example.com"
LEAVER = "reimb_test_leaver@example.com"  # deleted by its own test
LEAVER2 = "reimb_test_leaver2@example.com"  # deleted by its own test
USERS = (PM, PM2, HR, HRL, ADMIN, ACC, LEAVER, LEAVER2)

#: Account numbers no real Payee holds (the 9 prefix + the test IFSC keep them apart from live data).
IFSC = "HDFC0009991"
PREFIX = "99000777"


def _pdf(pages: int = 1) -> bytes:
    from pypdf import PdfWriter

    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=595, height=842)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _png() -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (60, 90), "white").save(out, format="PNG")
    return out.getvalue()


def _make_user(email: str, profile: str, roles: tuple[str, ...]):
    """A User (whose `after_insert` also creates the Nirmaan Users row) holding exactly `roles`, with
    `profile` on the Nirmaan Users row, which is what this feature's rules read."""
    if not frappe.db.exists("User", email):
        user = frappe.new_doc("User")
        user.update({"email": email, "first_name": email.split("@")[0], "send_welcome_email": 0})
        user.flags.no_welcome_mail = True
        user.insert(ignore_permissions=True)
    user = frappe.get_doc("User", email)
    stale = [r.role for r in user.roles if r.role not in roles]
    if stale:
        user.remove_roles(*stale)
    user.add_roles(*roles)
    set_role_copy_for_test(email, profile)


class _Storage:
    """Stands in for the storage app: file bytes by URL, stored PDFs as fake-URL File rows, deletes as raw
    row deletes (recorded)."""

    def __init__(self):
        self.content: dict[str, bytes] = {}
        self.deleted: list[str] = []

    def fetch(self, url):
        return self.content.get(url)

    def store_file(self, fname, content, dt, dn, df=None, is_private=1, **_):
        url = f"/api/method/reimb_test/{frappe.generate_hash(length=8)}/{fname}"
        doc = frappe.get_doc({
            "doctype": "File", "file_name": fname, "file_url": url, "is_private": 1,
            "attached_to_doctype": dt, "attached_to_name": dn, "attached_to_field": df,
        })
        doc.db_insert()
        self.content[url] = content
        return SimpleNamespace(name=doc.name)

    def delete_files(self, filters):
        names = frappe.get_all("File", filters=filters, pluck="name")
        for name in names:
            frappe.db.delete("File", {"name": name})
        self.deleted.extend(names)
        return len(names)

    def loose(self, owner: str, file_name: str, content: bytes) -> str:
        """A receipt `owner` uploaded and nothing claims yet; returns its URL."""
        url = f"/api/method/reimb_test/{frappe.generate_hash(length=8)}/{file_name}"
        doc = frappe.get_doc({"doctype": "File", "file_name": file_name, "file_url": url, "is_private": 1})
        # Inserted AS the uploader: `db_insert` stamps the session user as owner, whatever `owner` says.
        current = frappe.session.user
        frappe.set_user(owner)
        try:
            doc.db_insert()
        finally:
            frappe.set_user(current)
        self.content[url] = content
        return url


class ReimbursementTestCase(ExpenseTypeFlagGuard, FrappeTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        for email, profile, roles in (
            (PM, "Nirmaan Project Manager Profile", ("Nirmaan Project Manager",)),
            (PM2, "Nirmaan Project Manager Profile", ("Nirmaan Project Manager", "System Manager")),
            (HR, "Nirmaan HR Executive Profile", ("Nirmaan HR Executive",)),
            (HRL, "Nirmaan HR Lead Profile", ("Nirmaan HR Executive", "Nirmaan HR Lead")),
            (ADMIN, "Nirmaan Admin Profile", ("System Manager",)),
            (ACC, "Nirmaan Accountant Profile", ("Nirmaan Accountant",)),
        ):
            _make_user(email, profile, roles)
        frappe.db.commit()

    @classmethod
    def tearDownClass(cls):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        _purge()
        super().tearDownClass()

    def setUp(self):
        frappe.set_user("Administrator")
        self.storage = _Storage()
        patches = [
            patch.object(receipts, "fetch_attachment_content", self.storage.fetch),
            patch.object(receipts, "store_file", self.storage.store_file),
            patch.object(claims, "delete_files", self.storage.delete_files),
            patch("nirmaan_stack.services.payees.writer.lookup_ifsc",
                  lambda ifsc: SimpleNamespace(bank_name="HDFC Bank", bank_branch="Test Branch")),
            patch.object(review, "notify_decided", lambda *a, **k: None),
            # The suite's claimants are Project Managers who raise large claims on purpose (the monthly limit, the
            # CEO band), so the Project Manager cap is off here; `TestProjectManagerCap` turns it back on.
            patch.object(claims, "is_capped", lambda user: False),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(frappe.set_user, "Administrator")
        self.fresh_month()

    # --- helpers ---------------------------------------------------------------------------------

    @staticmethod
    def fresh_month() -> None:
        """Start the test users on an empty month: move every claim they hold back a year, so a claim raised next
        has a month total of its own amount (ADR-0040 Amendment B). Claims from earlier tests otherwise stay until
        the class ends and count. Raw write on the suite's own `reimb_test_` claims: nothing derives from their
        `creation`, so no hook is owed."""
        frappe.db.sql(
            """UPDATE "tabReimbursement" SET creation = creation - INTERVAL '1 year' WHERE owner IN %(users)s""",
            {"users": USERS},
        )
        frappe.db.commit()

    _seq = 0

    def account(self, user: str) -> str:
        """`user`'s bank account (one per person), added fresh when they have none; returns its Payee."""
        mine = own_accounts.my_account(user)
        if mine:
            return mine.name
        ReimbursementTestCase._seq += 1
        frappe.set_user(user)
        reply = bank_accounts.add_my_bank_account(user.split("@")[0], f"{PREFIX}{ReimbursementTestCase._seq:06d}", IFSC)
        frappe.set_user("Administrator")
        return reply["payee"]

    @staticmethod
    def no_account(*users: str) -> None:
        """Start `users` with no bank account. Raw write: test setup, past the `check_own_account` guard."""
        for user in users:
            frappe.db.set_value("Nirmaan Users", user, "payee", None, update_modified=False)
        frappe.db.commit()

    def raise_claim(self, user: str, amount=1450, files=None, **kw) -> str:
        payee = kw.pop("payee", None) or self.account(user)
        kw.setdefault("description", "Site visit")  # needed above ₹2,000
        kw.setdefault("reimbursement_type", "Travel")
        urls = files if files is not None else [self.storage.loose(user, "cab.png", _png())]
        frappe.set_user(user)
        try:
            return claims.raise_reimbursement(kw.pop("title", "Cab to site"), amount, payee, urls, **kw)["name"]
        finally:
            frappe.set_user("Administrator")

    def as_user(self, user, fn, *args, **kw):
        frappe.set_user(user)
        try:
            return fn(*args, **kw)
        finally:
            frappe.set_user("Administrator")


def _purge():
    """Remove every record the suite made. Each scope in its own try, committed on its own, so one
    failure can't strand the rest (CODING_STANDARDS § Writing tests)."""
    def test_expenses():
        claims_ = frappe.get_all("Reimbursement", {"owner": ["in", USERS]}, pluck="name")
        # ⚠️ NEVER `claims_ or [""]`: `reimbursement` is a nullable Link, so `["in", [""]]` renders as
        # `ifnull(reimbursement, '') in ('')` and matches EVERY ordinary Non-Project Expense. On 2026-10-27 a
        # single-test run (no claim left to purge) raw-deleted ~891 real expenses that way.
        names = frappe.get_all(NPE, {"reimbursement": ["in", claims_]}, pluck="name") if claims_ else []
        if names:
            frappe.db.delete("Comment", {"reference_doctype": NPE, "reference_name": ["in", names]})
            frappe.db.delete(NPE, {"name": ["in", names]})
        frappe.db.delete(NPE, {"description": ["like", "reimb_test %"]})

    def tombstones():
        # Every `delete_doc` (a claim, an expense, a receipt File, the users at the end) leaves a Deleted Document
        # and a "Deleted" Comment (subject "<doctype> <name>", no reference_name). Only the suite's own: its users
        # by name, the rest by the `reimb_test_` owner or receipt URL in the deleted record's JSON.
        named = [(dt, u) for dt in ("User", "Nirmaan Users", "Notification Settings") for u in USERS]
        for dt, pattern in (("Reimbursement", '%"owner": "reimb_test_%'), (NPE, '%"owner": "reimb_test_%'),
                            ("File", "%/api/method/reimb_test/%"),
                            # A deleted person's own account goes with them (owner, 2026-10-28).
                            ("Payee", f'%"normalized_account": "{PREFIX}%')):
            gone = frappe.get_all("Deleted Document", {"deleted_doctype": dt, "data": ["like", pattern]},
                                  pluck="deleted_name")
            named += [(dt, n) for n in gone]
        for dt, name in named:
            frappe.db.delete("Comment", {"comment_type": "Deleted", "reference_doctype": dt, "subject": f"{dt} {name}"})
            frappe.db.delete("Deleted Document", {"deleted_doctype": dt, "deleted_name": name})

    scopes = [
        ("notifications", lambda: frappe.db.delete("Nirmaan Notifications", {"recipient": ["in", USERS]})),
        # Before the claims: each links to its claim (ADR-0040). Raw deletes, past the on_trash refusal.
        ("expenses", test_expenses),
        ("claims", lambda: [frappe.db.delete("Reimbursement", {"name": n})
                            for n in frappe.get_all("Reimbursement", {"owner": ["in", USERS]}, pluck="name")]),
        ("files", lambda: frappe.db.delete("File", {"file_url": ["like", "/api/method/reimb_test/%"]})),
        ("bank accounts", lambda: [frappe.db.set_value("Nirmaan Users", email, "payee", None, update_modified=False)
                                   for email in USERS if frappe.db.exists("Nirmaan Users", email)]),
        ("payees", lambda: frappe.db.delete("Payee", {"ifsc": IFSC, "normalized_account": ["like", f"{PREFIX}%"]})),
        ("users", lambda: [frappe.delete_doc(dt, email, force=True, ignore_permissions=True)
                           for email in USERS for dt in ("Nirmaan Users", "User") if frappe.db.exists(dt, email)]),
        # Last: the deletes above leave tombstones of their own.
        ("tombstones", tombstones),
    ]
    failures = []
    for name, action in scopes:
        try:
            action()
            frappe.db.commit()
        except Exception as e:  # noqa: BLE001 -- report, never strand the later scopes
            frappe.db.rollback()
            failures.append(f"{name}: {e}")
    if failures:
        print("reimb_test purge left records behind:", failures)


class TestOwnBankAccount(ReimbursementTestCase):
    def setUp(self):
        super().setUp()
        self.no_account(PM, PM2)

    def test_a_new_account_becomes_a_payee_and_yours(self):
        payee = self.account(PM)
        self.assertEqual(self.as_user(PM, bank_accounts.my_bank_account).name, payee)
        self.assertEqual(own_accounts.holder_of(payee), PM)
        self.assertEqual(frappe.db.get_value("Nirmaan Users", PM, "payee"), payee)
        # Made from Raise Reimbursement, so its Payee Type is Users, for good (owner, 2026-10-23).
        self.assertEqual(frappe.db.get_value("Payee", payee, "payee_type"), "Users")

    def test_the_same_account_again_is_already_yours(self):
        frappe.set_user(PM)
        first = bank_accounts.add_my_bank_account("PM", f"{PREFIX}900001", IFSC)
        again = bank_accounts.add_my_bank_account("PM", f"{PREFIX}900001", IFSC)
        frappe.set_user("Administrator")
        self.assertEqual(again["outcome"], own_accounts.ALREADY_YOURS)
        self.assertEqual(again["payee"], first["payee"])

    def test_a_second_account_is_refused_and_the_first_stays(self):
        first = self.account(PM)
        with self.assertRaises(own_accounts.AlreadyHasAccountError):
            self.as_user(PM, bank_accounts.add_my_bank_account, "PM", f"{PREFIX}900004", IFSC)
        self.assertEqual(frappe.db.get_value("Nirmaan Users", PM, "payee"), first)
        self.assertFalse(frappe.db.exists("Payee", {"normalized_account": f"{PREFIX}900004", "ifsc": IFSC}))

    def test_another_persons_account_is_refused(self):
        frappe.set_user(PM)
        bank_accounts.add_my_bank_account("PM", f"{PREFIX}900002", IFSC)
        frappe.set_user(PM2)
        with self.assertRaises(own_accounts.OtherPersonsAccountError):
            bank_accounts.add_my_bank_account("PM2", f"{PREFIX}900002", IFSC)

    @staticmethod
    def loose_payee(number: str, payee_type: str) -> str:
        return frappe.get_doc({"doctype": "Payee", "account_name": "Loose", "account_number": number, "ifsc": IFSC,
                               "bank_name": "HDFC Bank", "bank_branch": "Test", "payee_type": payee_type}).insert(
            ignore_permissions=True).name

    def test_a_users_account_on_record_with_nobody_is_linked_to_you(self):
        payee = self.loose_payee(f"{PREFIX}900003", "Users")
        reply = self.as_user(PM2, bank_accounts.add_my_bank_account, "PM2", f"{PREFIX}900003", IFSC)
        self.assertEqual((reply["outcome"], reply["payee"]), (own_accounts.LINKED, payee))
        self.assertEqual(own_accounts.holder_of(payee), PM2)

    def test_an_others_or_vendors_account_on_record_is_refused(self):
        # Payee Type is never retyped, so linking one would keep it out of `is_own_account` (owner, 2026-10-28).
        for number, payee_type in ((f"{PREFIX}900005", "Others"), (f"{PREFIX}900006", "Vendors")):
            with self.subTest(payee_type):
                payee = self.loose_payee(number, payee_type)
                with self.assertRaises(own_accounts.NotUsersPayeeError):
                    self.as_user(PM2, bank_accounts.add_my_bank_account, "PM2", number, IFSC)
                self.assertFalse(frappe.db.get_value("Nirmaan Users", PM2, "payee"))
                self.assertIsNone(own_accounts.holder_of(payee))
                self.assertEqual(frappe.db.get_value("Payee", payee, "payee_type"), payee_type)

    def test_a_vendors_account_refusal_names_the_vendor(self):
        payee = self.loose_payee(f"{PREFIX}900007", "Vendors")
        with patch.object(own_accounts, "linked_vendors", lambda name: [{"name": "VEN-X", "vendor_name": "Acme Traders"}]):
            with self.assertRaisesRegex(own_accounts.NotUsersPayeeError, "Acme Traders"):
                self.as_user(PM2, bank_accounts.add_my_bank_account, "PM2", f"{PREFIX}900007", IFSC)
        self.assertIsNone(own_accounts.holder_of(payee))

    def test_a_profile_shows_the_account_to_the_person_and_to_admin_hr_and_accounts(self):
        payee = self.account(PM)
        for viewer in (PM, ADMIN, HR, ACC):
            with self.subTest(viewer):
                self.assertEqual(self.as_user(viewer, bank_accounts.bank_account_of, PM).name, payee)
        with self.assertRaises(frappe.PermissionError):
            self.as_user(PM2, bank_accounts.bank_account_of, PM)

    def test_the_person_corrects_their_own_account_and_past_claims_keep_theirs(self):
        payee = self.account(PM)
        claim = self.raise_claim(PM, payee=payee)
        old_number = frappe.db.get_value("Reimbursement", claim, "pay_to_account_number")
        reply = self.as_user(PM, bank_accounts.edit_my_bank_account, payee, "PM Corrected", f"{PREFIX}800001", IFSC)
        self.assertEqual(reply["payee"]["account_name"], "PM Corrected")
        self.assertEqual(frappe.db.get_value("Payee", payee, "account_number"), f"{PREFIX}800001")
        self.assertEqual(frappe.db.get_value("Reimbursement", claim, "pay_to_account_number"), old_number)

    def test_someone_elses_account_cannot_be_edited(self):
        payee = self.account(PM)
        with self.assertRaises(frappe.PermissionError):
            self.as_user(PM2, bank_accounts.edit_my_bank_account, payee, "Mine", f"{PREFIX}800002", IFSC)

    def test_an_account_a_vendor_is_paid_into_is_left_to_accounts(self):
        payee = self.account(PM)
        with patch.object(own_accounts, "linked_vendors", lambda name: [{"name": "VEN-X", "vendor_name": "Acme Traders"}]):
            with self.assertRaises(frappe.PermissionError) as e:
                self.as_user(PM, bank_accounts.edit_my_bank_account, payee, "PM", f"{PREFIX}800003", IFSC)
        self.assertIn("Acme Traders", str(e.exception))

    def test_editing_into_an_account_on_record_is_answered_as_a_duplicate(self):
        mine = self.account(PM)
        theirs = self.account(PM2)
        number = frappe.db.get_value("Payee", theirs, "account_number")
        reply = self.as_user(PM, bank_accounts.edit_my_bank_account, mine, "PM", number, IFSC)
        self.assertEqual(reply["duplicate"]["name"], theirs)
        self.assertNotEqual(frappe.db.get_value("Payee", mine, "account_number"), number)

    def test_the_payee_page_names_the_person_it_belongs_to(self):
        from nirmaan_stack.services.payees.links import payee_page
        payee = self.account(PM)
        self.assertEqual(payee_page(payee)["linked_user"]["name"], PM)
        loose = frappe.get_doc({"doctype": "Payee", "account_name": "Nobody", "account_number": f"{PREFIX}700001",
                                "ifsc": IFSC, "bank_name": "HDFC Bank", "bank_branch": "Test"}).insert(ignore_permissions=True)
        self.assertIsNone(payee_page(loose.name)["linked_user"])

    def test_the_account_cannot_be_set_by_saving_the_profile(self):
        payee = self.account(PM)
        doc = frappe.get_doc("Nirmaan Users", PM2)
        doc.payee = payee
        with self.assertRaises(frappe.PermissionError):
            doc.save(ignore_permissions=True)
        doc = frappe.get_doc("Nirmaan Users", PM)
        doc.payee = None
        with self.assertRaises(frappe.PermissionError):
            doc.save(ignore_permissions=True)


class TestRaiseEditDelete(ReimbursementTestCase):
    def test_raise_copies_the_account_and_merges_pictures_and_pdfs(self):
        payee = self.account(PM)
        urls = [self.storage.loose(PM, "bill.pdf", _pdf(2)), self.storage.loose(PM, "photo.png", _png()),
                self.storage.loose(PM, "log.xlsx", b"not a receipt pdf")]
        name = self.raise_claim(PM, amount=1450, payee=payee, files=urls)
        claim = frappe.get_doc("Reimbursement", name)
        self.assertEqual((claim.owner, claim.status), (PM, PENDING))
        self.assertEqual(claim.pay_to_account_number, frappe.db.get_value("Payee", payee, "account_number"))

        from pypdf import PdfReader
        merged = self.storage.content[claim.attachment]
        self.assertEqual(len(PdfReader(io.BytesIO(merged)).pages), 3)  # 2 PDF pages + 1 picture
        files = claims.get_claim_files(name)
        self.assertEqual([f["file_name"] for f in files][1:], ["log.xlsx"])
        self.assertTrue(files[0]["is_receipts_pdf"])
        # The uploads that went into the PDF are deleted; the spreadsheet is kept on the claim.
        self.assertEqual(len(self.storage.deleted), 2)

    def test_the_claim_keeps_the_claimants_name_and_role(self):
        name = self.raise_claim(PM)
        claim = frappe.get_doc("Reimbursement", name)
        self.assertEqual(claim.claimant_name, frappe.db.get_value("Nirmaan Users", PM, "full_name"))
        self.assertEqual(claim.claimant_role, "Nirmaan Project Manager Profile")

    def test_raise_refuses_someone_elses_account(self):
        other = self.account(PM2)
        with self.assertRaises(frappe.PermissionError):
            self.raise_claim(PM, payee=other)

    def test_raise_refuses_a_file_someone_else_uploaded(self):
        url = self.storage.loose(PM2, "cab.png", _png())
        with self.assertRaises(receipts.ReceiptError):
            self.raise_claim(PM, files=[url])

    def test_raise_needs_a_receipt_and_an_amount(self):
        with self.assertRaises(frappe.ValidationError):
            self.raise_claim(PM, files=[])
        with self.assertRaises(frappe.ValidationError):
            self.raise_claim(PM, amount=0)

    def test_raise_needs_a_type_and_keeps_it(self):
        with self.assertRaises(frappe.ValidationError):
            self.raise_claim(PM, reimbursement_type=None)
        with self.assertRaises(frappe.ValidationError):
            self.raise_claim(PM, reimbursement_type="Hotel")
        name = self.raise_claim(PM, reimbursement_type="Food")
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "reimbursement_type"), "Food")

    def test_a_claim_above_2000_needs_a_description_on_raise_and_edit(self):
        with self.assertRaises(frappe.ValidationError):
            self.raise_claim(PM, amount=2500, description="  ")
        name = self.raise_claim(PM, amount=2000, description="")
        payee = own_accounts.my_account(PM).name
        with self.assertRaises(frappe.ValidationError):
            self.as_user(PM, claims.update_reimbursement, name, "Cab", 2500, payee, description="",
                         reimbursement_type="Travel")
        self.as_user(PM, claims.update_reimbursement, name, "Cab", 2500, payee, description="Two site visits",
                     reimbursement_type="Travel")
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "amount"), 2500)

    def test_edit_while_pending_adds_pages_and_removes_files(self):
        payee = self.account(PM)
        name = self.raise_claim(PM, payee=payee, files=[self.storage.loose(PM, "a.png", _png()),
                                                        self.storage.loose(PM, "note.txt", b"x")])
        note_url = [f["file_url"] for f in claims.get_claim_files(name) if f["file_name"] == "note.txt"][0]
        self.as_user(PM, claims.update_reimbursement, name, "Cab and parking", 1600, payee, reimbursement_type="Food",
                     file_urls=[self.storage.loose(PM, "b.pdf", _pdf(1))], remove_file_urls=[note_url])
        claim = frappe.get_doc("Reimbursement", name)
        from pypdf import PdfReader
        self.assertEqual(len(PdfReader(io.BytesIO(self.storage.content[claim.attachment])).pages), 2)
        self.assertEqual((claim.title, claim.amount, claim.reimbursement_type), ("Cab and parking", 1600, "Food"))
        self.assertEqual([f["file_name"] for f in claims.get_claim_files(name)], [f"{name}-receipts.pdf"])

    def test_removing_every_receipt_is_refused(self):
        name = self.raise_claim(PM)
        pdf_url = frappe.db.get_value("Reimbursement", name, "attachment")
        payee = own_accounts.my_account(PM).name
        with self.assertRaises(frappe.ValidationError):
            self.as_user(PM, claims.update_reimbursement, name, "Cab", 100, payee, remove_file_urls=[pdf_url],
                         reimbursement_type="Travel")

    def test_only_the_claimant_edits_and_only_while_pending(self):
        name = self.raise_claim(PM)
        payee2 = self.account(PM2)
        with self.assertRaises(frappe.PermissionError):
            self.as_user(PM2, claims.update_reimbursement, name, "Mine now", 10, payee2, reimbursement_type="Travel")
        self.as_user(HR, review.approve_reimbursement, name)
        payee = own_accounts.my_account(PM).name
        with self.assertRaises(frappe.ValidationError):
            self.as_user(PM, claims.update_reimbursement, name, "Changed", 10, payee, reimbursement_type="Travel")

    def test_delete_while_pending_or_rejected_but_never_approved(self):
        """Owner, 2026-10-27: the claimant deletes a Pending or Rejected claim. One HR rejected has no expense."""
        pending = self.raise_claim(PM)
        self.as_user(PM, claims.delete_reimbursement, pending)
        self.assertFalse(frappe.db.exists("Reimbursement", pending))

        rejected = self.raise_claim(PM)
        self.as_user(HR, review.reject_reimbursement, rejected, "Receipt unreadable")
        self.as_user(PM, claims.delete_reimbursement, rejected)
        self.assertFalse(frappe.db.exists("Reimbursement", rejected))

        approved = self.raise_claim(PM)
        self.as_user(HR, review.approve_reimbursement, approved)
        with self.assertRaises(frappe.ValidationError):
            self.as_user(PM, claims.delete_reimbursement, approved)

    def test_deleting_takes_the_receipts(self):
        name = self.raise_claim(PM)
        attachment = frappe.db.get_value("Reimbursement", name, "attachment")
        self.as_user(PM, claims.delete_reimbursement, name)
        self.assertFalse(frappe.db.exists("File", {"file_url": attachment}))


class TestDecisions(ReimbursementTestCase):
    def test_hr_approves_under_the_limit_and_saves_who(self):
        name = self.raise_claim(PM, amount=1999)
        self.as_user(HR, review.approve_reimbursement, name)
        claim = frappe.get_doc("Reimbursement", name)
        self.assertEqual((claim.status, claim.approved_by), (APPROVED, HR))

    def test_hr_approves_at_the_limit_once_the_warning_is_ticked(self):
        """Owner, 2026-10-28: HR approves any amount; at or above the monthly limit (₹2,000 counts) only with the tick."""
        name = self.raise_claim(PM, amount=2000)
        with self.assertRaises(frappe.ValidationError) as refused:
            self.as_user(HRL, review.approve_reimbursement, name)
        self.assertIn("Tick", str(refused.exception))
        self.assertIsNone(convert.expense_of(name))  # a refused approval leaves no expense
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), PENDING)
        self.as_user(HRL, review.approve_reimbursement, name, acknowledged=1)
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "approved_by"), HRL)

    def test_a_claim_raised_by_hr_is_admins_even_when_small(self):
        name = self.raise_claim(HR, amount=100)
        for hr in (HR, HRL):
            with self.assertRaises(frappe.PermissionError):
                self.as_user(hr, review.approve_reimbursement, name)
        self.as_user(ADMIN, review.approve_reimbursement, name)

    def test_the_role_saved_on_the_claim_decides_even_after_the_person_moves_role(self):
        name = self.raise_claim(HRL, amount=300)
        set_role_copy_for_test(HRL, "Nirmaan Project Manager Profile")
        try:
            with self.assertRaises(frappe.PermissionError):
                self.as_user(HR, review.approve_reimbursement, name)
            row = {r.name: r for r in self.as_user(HR, review.get_pending_for_me)}[name]
            self.assertFalse(row.can_decide)
        finally:
            set_role_copy_for_test(HRL, "Nirmaan HR Lead Profile")

    def test_admin_may_approve_their_own_claim(self):
        name = self.raise_claim(ADMIN, amount=5000)
        self.as_user(ADMIN, review.approve_reimbursement, name, acknowledged=1)
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), APPROVED)

    def test_accounts_cannot_decide(self):
        name = self.raise_claim(PM)
        with self.assertRaises(frappe.PermissionError):
            self.as_user(ACC, review.approve_reimbursement, name)

    def test_a_claim_is_decided_once(self):
        name = self.raise_claim(PM)
        self.as_user(HR, review.approve_reimbursement, name)
        with self.assertRaises(frappe.ValidationError):
            self.as_user(ADMIN, review.reject_reimbursement, name, "Too late")

    def test_reject_needs_a_reason_and_keeps_it(self):
        name = self.raise_claim(PM)
        with self.assertRaises(frappe.ValidationError):
            self.as_user(HR, review.reject_reimbursement, name, "  ")
        self.as_user(HR, review.reject_reimbursement, name, " Receipt unreadable ")
        claim = frappe.get_doc("Reimbursement", name)
        self.assertEqual((claim.status, claim.rejection_reason, claim.approved_by), (REJECTED, "Receipt unreadable", None))

    def test_the_pending_queue_shows_each_person_what_they_may_decide(self):
        small = self.raise_claim(PM, amount=500)
        large = self.raise_claim(PM, amount=9000)
        from_hr = self.raise_claim(HRL, amount=300)
        hr_queue = {r.name: r for r in self.as_user(HR, review.get_pending_for_me)}
        admin_queue = {r.name: r for r in self.as_user(ADMIN, review.get_pending_for_me)}
        # HR sees every pending claim, and may decide those raised outside HR, of any amount (owner, 2026-10-28).
        self.assertTrue({small, large, from_hr} <= set(hr_queue))
        self.assertTrue(hr_queue[small].can_decide)
        self.assertTrue(hr_queue[large].can_decide)
        self.assertFalse(hr_queue[from_hr].can_decide)
        self.assertIn("HR", hr_queue[from_hr].cannot_decide_reason)
        # Admin may decide them all.
        self.assertTrue(all(admin_queue[n].can_decide for n in (small, large, from_hr)))
        self.assertEqual(self.as_user(ACC, review.get_pending_for_me), [])


class TestClaimExpense(ReimbursementTestCase):
    """ADR-0040: approving a claim creates its Non-Project Expense; the claim follows its endings."""

    def setUp(self):
        super().setUp()
        p = patch("nirmaan_stack.services.stored_files.delete_files", self.storage.delete_files)
        p.start()
        self.addCleanup(p.stop)

    def approve(self, user, claimant=PM, amount=1450):
        """Raise and approve one claim on an empty month, so it routes by its own amount (`fresh_month`)."""
        self.fresh_month()
        name = self.raise_claim(claimant, amount=amount)
        self.as_user(user, review.approve_reimbursement, name, acknowledged=1)
        expense = convert.expense_of(name)
        self.assertTrue(expense, "approval created no expense")
        return name, frappe.get_doc(NPE, expense)

    def move(self, expense, status, reason=None):
        """The expense's status changed the way Payments changes it: a document save."""
        doc = frappe.get_doc(NPE, expense.name)
        doc.status = status
        if reason:
            doc.flags.rejection_reason = reason
        doc.save(ignore_permissions=True)
        return doc

    def test_approval_creates_the_expense_from_the_claim(self):
        name, expense = self.approve(HR)
        claim = frappe.get_doc("Reimbursement", name)
        self.assertFalse(expense.type)  # no Expense Type: the claim link marks it (owner, 2026-10-23)
        self.assertEqual(expense.reimbursement, name)
        self.assertEqual(float(expense.amount), 1450)
        self.assertEqual(expense.owner, PM)
        self.assertEqual(expense.invoice_attachment, claim.attachment)
        # The claim is the invoice: its ID and the day it was raised (owner, 2026-10-23).
        self.assertEqual(expense.invoice_ref, name)
        self.assertEqual(str(expense.invoice_date), str(frappe.utils.getdate(claim.creation)))
        for field in ("pay_to_account_name", "pay_to_account_number", "pay_to_ifsc", "pay_to_bank_name"):
            self.assertEqual(expense.get(field), claim.get(field), field)
        self.assertIn(f"[{name}]", expense.description)
        self.assertTrue(expense.description.startswith("Travel · Cab to site"))
        self.assertTrue(expense.comment.startswith("Approved by"))
        self.assertLessEqual(len(expense.comment), 140)
        self.assertFalse(expense.request_id)

    def test_a_reimbursement_link_typed_into_a_new_expense_is_refused(self):
        """Code review 2026-10-23: only the approval step sets the link, so a typed-in claim ID can't lend an
        expense the claim approver's level (skipping L1 / CEO), nor delete or pay someone else's claim."""
        name, _ = self.approve(ADMIN, amount=80000)  # an approved claim to point at
        forged = frappe.get_doc({
            "doctype": NPE, "amount": 80000,
            "description": "reimb_test forged link", "reimbursement": name,
        })
        with self.assertRaises(frappe.ValidationError):
            forged.insert(ignore_permissions=True)
        frappe.db.rollback()
        self.assertFalse(frappe.db.exists(NPE, {"description": "reimb_test forged link"}))

    def test_the_link_cannot_be_changed_or_removed(self):
        first, expense = self.approve(HR)
        second, _ = self.approve(HR)
        for value in (second, None):
            with self.subTest(value), self.assertRaises(frappe.ValidationError):
                doc = frappe.get_doc(NPE, expense.name)
                doc.reimbursement = value
                doc.save(ignore_permissions=True)
        self.assertEqual(frappe.db.get_value(NPE, expense.name, "reimbursement"), first)

    def test_a_duplicate_of_the_expense_drops_the_link_so_a_claim_has_one_expense(self):
        """`reimbursement` is `no_copy`: Desk's Duplicate (`copy_doc`) makes an ordinary expense, not a second payment
        of the claim. A copy that still carried the link would be refused (`guard_link`)."""
        name, expense = self.approve(ADMIN, amount=40000)
        # Desk's Duplicate copies in the browser, honouring `no_copy`; the server's `copy_doc` ignores `no_copy`
        # unless asked, so ask, to stand in for it.
        copy = frappe.copy_doc(frappe.get_doc(NPE, expense.name), ignore_no_copy=False)
        self.assertFalse(copy.reimbursement)
        copy.insert(ignore_permissions=True)
        self.addCleanup(lambda: frappe.db.delete(NPE, {"name": copy.name}) or frappe.db.commit())
        self.assertEqual(frappe.get_all(NPE, filters={"reimbursement": name}, pluck="name"), [expense.name])
        forged = frappe.copy_doc(frappe.get_doc(NPE, expense.name))
        forged.reimbursement = name  # as if the field were copied after all
        with self.assertRaises(frappe.ValidationError):
            forged.insert(ignore_permissions=True)
        frappe.db.rollback()

    def test_a_delete_rolled_back_to_a_savepoint_keeps_the_receipts(self):
        """Code review 2026-10-23: a savepoint rollback leaves `after_commit` queued; the receipt delete must
        then see the claim is back and leave its files alone."""
        name, expense = self.approve(HR)
        receipt_files = [f.name for f in receipts.claim_files(name)]
        frappe.db.savepoint("reimb_test_delete")
        frappe.delete_doc(NPE, expense.name, ignore_permissions=True)
        frappe.db.rollback(save_point="reimb_test_delete")
        frappe.db.commit()  # runs the queued receipt delete
        self.assertTrue(frappe.db.exists("Reimbursement", name))
        self.assertFalse(set(receipt_files) & set(self.storage.deleted))

    def test_a_local_disk_receipts_pdf_is_not_attached_to_the_expense(self):
        """Code review finding 7: on a local-disk site the receipts path stays off the expense, so Frappe makes no
        File for it there (which would open the receipts to every expense reader)."""
        name = self.raise_claim(PM)
        local = "/private/files/reimb_test_local_receipts.pdf"
        frappe.db.set_value("Reimbursement", name, "attachment", local, update_modified=False)  # test setup
        self.as_user(HR, review.approve_reimbursement, name)
        expense = frappe.get_doc(NPE, convert.expense_of(name))
        self.assertFalse(expense.invoice_attachment)
        expense.save(ignore_permissions=True)  # Frappe's attach step runs on every save
        self.assertFalse(frappe.db.exists("File", {"attached_to_doctype": NPE, "attached_to_name": expense.name}))
        self.assertEqual(expense.invoice_ref, name)

    def test_hr_approval_under_the_limit_is_auto_approved(self):
        _, expense = self.approve(HR, amount=1999)
        self.assertEqual((expense.status, expense.auto_approved), ("Approved", 1))

    def test_admin_approval_clears_l1_so_up_to_50000_is_approved_and_above_waits_for_the_ceo(self):
        _, mid = self.approve(ADMIN, amount=20000)
        self.assertEqual((mid.status, mid.auto_approved), ("Approved", 0))
        self.assertTrue(mid.approval_date)
        self.assertFalse(mid.ceo_approval_date)
        _, edge = self.approve(ADMIN, amount=50000)
        self.assertEqual(edge.status, "Approved")
        _, large = self.approve(ADMIN, amount=80000)
        self.assertEqual(large.status, "CEO Pending")

    def test_approval_needs_no_expense_type(self):
        """Owner, 2026-10-23: the expense depends on no Expense Type, so approval works with no "Reimbursements" type."""
        name, expense = self.approve(HR)
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), APPROVED)
        self.assertFalse(frappe.db.get_value(NPE, expense.name, "type"))

    def test_a_claim_rejected_by_hr_gets_no_expense(self):
        name = self.raise_claim(PM)
        self.as_user(HR, review.reject_reimbursement, name, "Receipt unreadable")
        self.assertIsNone(convert.expense_of(name))

    def test_the_claim_carries_each_expense_status_until_paid(self):
        """Owner, 2026-11-19: the claim's status is its expense's, by the same name."""
        name, expense = self.approve(HR)
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), APPROVED)
        self.move(expense, "Reconciliation Pending")
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), RECONCILIATION_PENDING)
        self.move(expense, "Paid")
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), PAID)

    def test_paid_or_rejected_in_payments_sends_the_claimant_no_bell(self):
        """Owner, 2026-10-23: no notification when the claim follows its expense (the bell was removed)."""
        paid_claim, paid = self.approve(HR)
        self.move(paid, "Paid")
        rejected_claim, rejected = self.approve(HR)
        self.move(rejected, "Rejected", "Bill is for a personal trip")
        self.assertFalse(frappe.get_all("Nirmaan Notifications",
                                        filters={"docname": ["in", [paid_claim, rejected_claim]]}))

    def test_an_undone_bank_match_puts_the_claim_back_to_reconciliation_pending(self):
        name, expense = self.approve(HR)
        self.move(expense, "Paid")
        self.move(expense, "Reconciliation Pending")
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), RECONCILIATION_PENDING)

    def test_rejecting_in_the_payments_queue_rejects_the_claim_with_that_reason(self):
        if not frappe.db.exists("User", CEO_AUTHORIZED_USER):
            self.skipTest("the CEO user is not on this site")
        name, expense = self.approve(ADMIN, amount=80000)
        self.assertEqual(frappe.db.get_value(NPE, expense.name, "status"), "CEO Pending")
        reply = self.as_user(
            CEO_AUTHORIZED_USER, expense_actions.decide_expenses,
            expense_ids=[expense.name], action="reject", reason=" Duplicate of an earlier claim ",
        )
        self.assertEqual(reply["data"]["failed"], [])  # the engine reports failures under data.failed
        claim = frappe.get_doc("Reimbursement", name)
        self.assertEqual((claim.status, claim.rejection_reason), (REJECTED, "Duplicate of an earlier claim"))

    def test_a_rejection_with_no_reason_reaching_the_save_gets_the_fallback(self):
        name, expense = self.approve(HR)
        self.move(expense, "Rejected")
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "rejection_reason"), expense_link.FALLBACK_REASON)

    def test_editing_the_expense_leaves_the_claim_alone(self):
        name, expense = self.approve(HR)
        doc = frappe.get_doc(NPE, expense.name)
        doc.amount = 1400
        doc.description = "Edited by Accounts"
        doc.save(ignore_permissions=True)
        claim = frappe.get_doc("Reimbursement", name)
        self.assertEqual((float(claim.amount), claim.status), (1450, APPROVED))

    def test_deleting_the_expense_in_any_status_deletes_the_claim_and_receipts(self):
        """As deleting a request's expense deletes the Expense Request (owner, 2026-10-23)."""
        name, expense = self.approve(HR)
        receipt_files = [f.name for f in receipts.claim_files(name)]
        self.assertTrue(receipt_files)
        frappe.delete_doc(NPE, expense.name, ignore_permissions=True)  # still Approved
        frappe.db.commit()  # runs the after-commit receipt delete
        self.assertFalse(frappe.db.exists("Reimbursement", name))
        self.assertTrue(set(receipt_files) <= set(self.storage.deleted))

    def test_a_rejected_expense_cannot_be_put_back_to_any_other_status(self):
        """Code review finding 3, fixed by the owner's rule (2026-10-23): Rejected is final; delete and re-raise."""
        name, expense = self.approve(HR)
        self.move(expense, "Rejected", "Wrong project")
        for status in ("Approved", "Reconciliation Pending", "Paid"):
            with self.subTest(status), self.assertRaises(frappe.ValidationError):
                self.move(expense, status)
        self.assertEqual(frappe.db.get_value(NPE, expense.name, "status"), "Rejected")
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), REJECTED)
        doc = frappe.get_doc(NPE, expense.name)
        doc.description = "Other fields still save"
        doc.save(ignore_permissions=True)

    def test_the_claimant_cannot_delete_their_own_claims_expense_directly(self):
        """Owner, 2026-10-27: the claimant removes a Rejected expense by deleting their claim (Reimbursements), never
        the expense itself, in any status. Project Managers and many other roles hold delete on Non-Project
        Expenses, so a direct delete would take an Approved or Paid claim around the claim's own rule."""
        name, expense = self.approve(HR)
        for status in (None, "Rejected"):
            if status:
                self.move(expense, status, "Wrong project")
            with self.subTest(status=status or "Approved"), self.assertRaises(frappe.ValidationError):
                self.as_user(PM, frappe.delete_doc, NPE, expense.name, ignore_permissions=True)
            frappe.db.rollback()
            self.assertTrue(frappe.db.exists("Reimbursement", name))
            self.assertTrue(frappe.db.exists(NPE, expense.name))

    def test_the_claimant_deleting_a_claim_rejected_in_payments_deletes_its_expense(self):
        """Owner, 2026-10-27: the claim and its Rejected expense go together, with the claim's receipts."""
        name, expense = self.approve(HR)
        self.move(expense, "Rejected", "Wrong project")
        frappe.db.commit()
        receipt_files = [f.name for f in receipts.claim_files(name)]
        self.as_user(PM, claims.delete_reimbursement, name)
        self.assertFalse(frappe.db.exists("Reimbursement", name))
        self.assertFalse(frappe.db.exists(NPE, expense.name))
        self.assertTrue(set(receipt_files) <= set(self.storage.deleted))

    def test_an_admin_deletes_a_rejected_claim_with_its_expense(self):
        """Owner, 2026-11-19: an Admin deletes anyone's claim once it is Rejected -- the same call as the claimant's,
        so a claim rejected in Payments takes its Rejected expense and receipts with it."""
        name, expense = self.approve(HR)
        self.move(expense, "Rejected", "Wrong project")
        frappe.db.commit()
        receipt_files = [f.name for f in receipts.claim_files(name)]
        self.as_user(ADMIN, claims.delete_reimbursement, name)
        self.assertFalse(frappe.db.exists("Reimbursement", name))
        self.assertFalse(frappe.db.exists(NPE, expense.name))
        self.assertTrue(set(receipt_files) <= set(self.storage.deleted))

    def test_only_an_admin_deletes_someone_elses_claim_and_only_once_rejected(self):
        rejected = self.raise_claim(PM)
        self.as_user(HR, review.reject_reimbursement, rejected, "reimb_test unreadable")
        for user in (HR, ACC):  # HR and Accounts may not, even rejected
            with self.assertRaises(frappe.PermissionError):
                self.as_user(user, claims.delete_reimbursement, rejected)
        self.as_user(ADMIN, claims.delete_reimbursement, rejected)  # HR rejected: no expense, the claim goes
        self.assertFalse(frappe.db.exists("Reimbursement", rejected))

        pending = self.raise_claim(PM)
        approved, expense = self.approve(HR)
        for name in (pending, approved):  # an Admin may not delete someone else's live claim
            with self.assertRaises(frappe.ValidationError):
                self.as_user(ADMIN, claims.delete_reimbursement, name)
            self.assertTrue(frappe.db.exists("Reimbursement", name))
        self.assertTrue(frappe.db.exists(NPE, expense.name))

    def test_the_claimant_cannot_delete_a_rejected_claim_whose_expense_was_revived(self):
        """A claim Rejected in Payments whose expense was later put back must not take that live expense with it,
        and the refusal says what Accounts can do (code review 2026-10-27, finding 4: a reject is refused there)."""
        name, expense = self.approve(HR)
        self.move(expense, "Rejected", "Wrong project")
        # Revival is refused through the document (Rejected is final); this stands in for an older row or a raw
        # write that got past it. Raw on purpose: test setup.
        frappe.db.set_value(NPE, expense.name, "status", "Approved", update_modified=False)
        frappe.db.commit()
        with self.assertRaises(frappe.ValidationError) as refused:
            self.as_user(PM, claims.delete_reimbursement, name)
        message = str(refused.exception)
        self.assertIn(expense.name, message)
        self.assertIn("Accounts can delete that expense there", message)
        self.assertNotIn("reject", message.lower().split("can't be deleted")[1])
        frappe.db.rollback()
        self.assertTrue(frappe.db.exists("Reimbursement", name))
        self.assertTrue(frappe.db.exists(NPE, expense.name))

    def test_the_claimants_delete_locks_the_expense_before_the_claim(self):
        """Code review 2026-10-27, finding 2: a decision or a delete from Payments locks the expense, then reaches
        the claim in its hooks. The claimant's delete takes the same order, so the two can never deadlock."""
        name, expense = self.approve(HR)
        self.move(expense, "Rejected", "Wrong project")
        frappe.db.commit()
        order = []
        real_lock, real_get_doc = claims.lock_expense_of, frappe.get_doc

        def lock(claim_name):
            order.append("expense")
            return real_lock(claim_name)

        def get_doc(*args, **kwargs):
            if kwargs.get("for_update") and args[:1] == ("Reimbursement",):
                order.append("claim")
            return real_get_doc(*args, **kwargs)

        with patch.object(claims, "lock_expense_of", lock), patch.object(frappe, "get_doc", get_doc):
            self.as_user(PM, claims.delete_reimbursement, name)
        self.assertEqual(order, ["expense", "claim"])
        self.assertFalse(frappe.db.exists(NPE, expense.name))

    def test_the_bank_import_links_settles_and_undoes_it_like_any_expense(self):
        """Bulk Import Transactions treats the claim's expense as an ordinary Non-Project Expense: it is offered
        for manual linking once Reconciliation Pending, a settle inside the import's savepoint (with its
        no-commit flag) turns the claim Paid, and Unreconcile's own revert turns it back to Reconciliation Pending."""
        from nirmaan_stack.api.outflow_import import link_lines, unreconcile
        from nirmaan_stack.services.outflow_import.settle import outflow_import_write

        name, expense = self.approve(HR)
        self.move(expense, "Reconciliation Pending")
        linkable = {r["name"]: r for r in link_lines.get_linkable_expenses()}
        self.assertEqual(linkable[expense.name]["expense_type"], "")
        self.assertEqual(linkable[expense.name]["remaining"], 1450)

        frappe.db.savepoint("reimb_test_settle")
        doc = frappe.get_doc(NPE, expense.name)
        doc.status = "Paid"
        doc.payment_ref = "REIMB-TEST-UTR"
        with outflow_import_write():
            doc.save(ignore_permissions=True, ignore_version=False)
        frappe.db.release_savepoint("reimb_test_settle")
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), PAID)
        self.assertEqual(claims.get_claim_payments([name])[name]["payment_ref"], "REIMB-TEST-UTR")

        unreconcile._revert_expense(NPE, expense.name, None)
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"),
                         frappe.db.get_value(NPE, expense.name, "status"))  # back with its expense

    def test_payments_are_read_only_for_claims_the_caller_may_read(self):
        name, expense = self.approve(HR)
        mine = self.as_user(PM, claims.get_claim_payments, [name])
        self.assertEqual(mine[name]["expense"], expense.name)
        self.assertEqual(self.as_user(PM2, claims.get_claim_payments, [name]), {})
        self.assertIn(name, self.as_user(ACC, claims.get_claim_payments, [name]))


class TestClaimTabs(ReimbursementTestCase):
    """ADR-0040 Amendment C: each step of a claim has its own tab, and an Approved claim's tab is its expense's
    status (`queue.get_claims`, `queue.get_claim_tab_counts`). The claim keeps its four statuses."""

    # TestClaimExpense's helpers, borrowed rather than inherited (inheriting would run its tests again). Its
    # `setUp` can't be borrowed: its zero-argument `super()` is bound to its own class.
    approve = TestClaimExpense.approve
    move = TestClaimExpense.move

    def setUp(self):
        super().setUp()
        p = patch("nirmaan_stack.services.stored_files.delete_files", self.storage.delete_files)
        p.start()
        self.addCleanup(p.stop)

    #: Every tab but the CEO's, which only the CEO may list.
    OPEN_TABS = ("pending", "l1", "approved", "reconciliation", "paid", "mine", "all")

    def listed(self, user, tab, name):
        reply = self.as_user(user, queue.get_claims, tab, fields=["name", "status"], filters=[["name", "=", name]])
        return reply["data"]

    def tabs_of(self, name, user=ACC):
        """The tabs that list claim `name` for `user` (Accounts by default: sees every claim, raised none)."""
        return [tab for tab in self.OPEN_TABS if self.listed(user, tab, name)]

    def test_a_new_claim_is_in_pending_approval_and_its_owners_lists(self):
        name = self.raise_claim(PM)
        self.assertEqual(self.tabs_of(name), ["pending", "all"])
        self.assertEqual(self.tabs_of(name, user=PM), ["pending", "mine", "all"])
        row = self.listed(ACC, "pending", name)[0]
        self.assertIsNone(row["expense"])  # no expense before the first approval
        self.assertIsNone(row["expense_status"])

    def test_hr_under_the_limit_sends_it_to_payment_need_to_be_paid(self):
        name, expense = self.approve(HR)
        self.assertEqual(self.tabs_of(name), ["approved", "all"])
        row = self.listed(ACC, "approved", name)[0]
        self.assertEqual(row["status"], APPROVED)  # the claim's own status stays one of the four
        self.assertEqual(row["expense"], expense.name)
        self.assertEqual(row["expense_status"], "Approved")
        self.assertTrue(row["expense_created"])

    def test_hr_at_the_limit_sends_it_to_pending_l1_approval(self):
        name, expense = self.approve(HR, amount=2500)
        self.assertEqual(frappe.db.get_value(NPE, expense.name, "status"), "Requested")
        self.assertEqual(self.tabs_of(name), ["l1", "all"])

    def test_it_moves_through_reconciliation_pending_to_paid(self):
        name, expense = self.approve(HR)
        self.move(expense, "Reconciliation Pending")
        self.assertEqual(self.tabs_of(name), ["reconciliation", "all"])
        self.move(expense, "Paid")
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), PAID)
        self.assertEqual(self.tabs_of(name), ["paid", "all"])

    def test_a_rejected_claim_is_only_in_all(self):
        name = self.raise_claim(PM)
        self.as_user(HR, review.reject_reimbursement, name, "reimb_test not claimable")
        self.assertEqual(self.tabs_of(name), ["all"])

    def test_pending_ceo_approval_is_the_ceos_alone(self):
        for user in (ADMIN, ACC, HR, PM):
            with self.subTest(user):
                with self.assertRaises(frappe.PermissionError):
                    self.as_user(user, queue.get_claims, "ceo", fields=["name"])
                self.assertNotIn("ceo", self.as_user(user, queue.get_claim_tab_counts))
        if not frappe.db.exists("User", CEO_AUTHORIZED_USER):
            self.skipTest("the CEO user is not on this site")
        name, expense = self.approve(ADMIN, amount=80000)
        self.assertEqual(frappe.db.get_value(NPE, expense.name, "status"), "CEO Pending")
        self.assertEqual([r["name"] for r in self.listed(CEO_AUTHORIZED_USER, "ceo", name)], [name])
        self.assertIn("ceo", self.as_user(CEO_AUTHORIZED_USER, queue.get_claim_tab_counts))
        self.assertEqual(self.tabs_of(name), ["all"])  # in no tab Accounts may open but All

    def test_people_who_see_only_their_own_claims_list_and_count_only_those(self):
        mine, theirs = self.raise_claim(PM), self.raise_claim(PM2)
        listed = self.as_user(PM, queue.get_claims, "all", fields=["name"], filters=[["name", "in", [mine, theirs]]])
        self.assertEqual([r["name"] for r in listed["data"]], [mine])
        counts = self.as_user(PM, queue.get_claim_tab_counts)
        own = frappe.db.count("Reimbursement", {"owner": PM})
        self.assertEqual((counts["all"], counts["mine"]), (own, own))

    def test_the_counts_follow_the_claim_from_tab_to_tab(self):
        before = self.as_user(ACC, queue.get_claim_tab_counts)
        name = self.raise_claim(PM)
        raised = self.as_user(ACC, queue.get_claim_tab_counts)
        self.assertEqual(raised["pending"] - before["pending"], 1)
        self.assertEqual(raised["all"] - before["all"], 1)
        self.as_user(HR, review.approve_reimbursement, name, acknowledged=1)
        approved = self.as_user(ACC, queue.get_claim_tab_counts)
        self.assertEqual(approved["pending"], before["pending"])
        self.assertEqual(approved["approved"] - before["approved"], 1)
        self.assertEqual(approved["all"] - before["all"], 1)

    def test_an_unknown_or_retired_tab_is_refused(self):
        for tab in ("rejected", "payments", None):
            with self.subTest(tab), self.assertRaises(frappe.PermissionError):
                self.as_user(ACC, queue.get_claims, tab, fields=["name"])

    def test_the_claims_view_gets_the_expenses_details(self):
        name, expense = self.approve(HR)
        got = claims.get_claim_payments([name])[name]
        for key in ("expense", "status", "payment_date", "payment_ref", "creation", "amount", "description",
                    "invoice_ref", "invoice_date", "comment", "approval_date", "ceo_approval_date",
                    "pay_to_account_name", "pay_to_account_number", "pay_to_ifsc", "pay_to_bank_name",
                    "pay_to_bank_branch", "payment_source"):
            self.assertIn(key, got)
        self.assertEqual(got["expense"], expense.name)
        self.assertEqual(got["invoice_ref"], name)  # the claim is the invoice
        self.assertEqual(float(got["amount"]), 1450)
        self.assertIsNone(got["payment_source"])  # no bank line matched yet


class TestClaimMonth(ReimbursementTestCase):
    """Owner, 2026-11-19: Paid and All take a month -- Paid by the expense's paid-on date, All by the raised date --
    and the totals the screen shows come from the same call, over every matching row (`queue.get_claims`)."""

    approve = TestClaimExpense.approve
    move = TestClaimExpense.move

    def setUp(self):
        super().setUp()
        p = patch("nirmaan_stack.services.stored_files.delete_files", self.storage.delete_files)
        p.start()
        self.addCleanup(p.stop)

    THIS_MONTH = frappe.utils.nowdate()[:7]

    def names(self, tab, month, **kw):
        reply = self.as_user(ACC, queue.get_claims, tab, fields=["name", "amount", "status"],
                             filters=[["owner", "in", [PM, PM2]]], month=month, **kw)
        return reply

    def test_all_lists_the_claims_raised_in_the_month(self):
        now = self.raise_claim(PM, amount=300)
        old = self.raise_claim(PM2, amount=500)
        frappe.db.sql("""UPDATE "tabReimbursement" SET creation = creation - INTERVAL '40 days' WHERE name = %s""", old)
        frappe.db.commit()
        listed = {r["name"] for r in self.names("all", self.THIS_MONTH)["data"]}
        self.assertIn(now, listed)
        self.assertNotIn(old, listed)
        self.assertIn(old, {r["name"] for r in self.names("all", None)["data"]})  # no month: every claim

    def test_paid_lists_the_claims_paid_in_the_month_by_paid_on_date(self):
        name, expense = self.approve(HR)
        self.move(expense, "Reconciliation Pending")
        self.move(expense, "Paid")
        frappe.db.set_value(NPE, expense.name, "payment_date", frappe.utils.nowdate(), update_modified=False)
        frappe.db.commit()
        self.assertEqual([r["name"] for r in self.names("paid", self.THIS_MONTH)["data"]], [name])
        last_month = frappe.utils.add_months(frappe.utils.nowdate(), -1)[:7]
        self.assertEqual(self.names("paid", last_month)["data"], [])

    def test_the_totals_cover_the_month_with_a_breakdown(self):
        self.raise_claim(PM, amount=300)
        self.raise_claim(PM2, amount=700)
        reply = self.names("all", self.THIS_MONTH,
                           aggregates_config='[{"field": "amount", "function": "sum"}, {"field": "amount", "function": "count"}]',
                           group_by_config='{"groupByField": "status", "aggregateField": "amount", "aggregateFunction": "sum", "limit": 10}')
        self.assertEqual(float(reply["aggregates"]["sum_of_amount"]), 1000)
        self.assertEqual(int(reply["aggregates"]["count_of_amount"]), 2)
        self.assertEqual({g["group_key"]: float(g["aggregate_value"]) for g in reply["group_by_result"]}, {PENDING: 1000})

    def test_all_totals_show_each_step_by_its_status(self):
        """Owner, 2026-11-19: the All totals show every step -- the claim's status names it."""
        self.fresh_month()
        self.raise_claim(PM, amount=300)                        # Pending Approval
        to_pay = self.raise_claim(PM2, amount=700)
        self.as_user(ADMIN, review.approve_reimbursement, to_pay, acknowledged=1)  # Admin, small: to be paid
        at_l1 = self.raise_claim(PM, amount=2500)
        self.as_user(HR, review.approve_reimbursement, at_l1, acknowledged=1)     # HR at the limit: L1
        reply = self.names("all", self.THIS_MONTH,
                           aggregates_config='[{"field": "amount", "function": "sum"}]',
                           group_by_config='{"groupByField": "status", "aggregateField": "amount", "aggregateFunction": "sum", "limit": 10}')
        groups = {g["group_key"]: float(g["aggregate_value"]) for g in reply["group_by_result"]}
        self.assertEqual(groups, {PENDING: 300, APPROVED: 700, REQUESTED: 2500})
        self.assertEqual(sum(groups.values()), float(reply["aggregates"]["sum_of_amount"]))

    def test_the_month_summary_counts_each_month_for_the_picker(self):
        a = self.raise_claim(PM, amount=300)
        b = self.raise_claim(PM2, amount=700)
        frappe.db.sql("""UPDATE "tabReimbursement" SET creation = %s WHERE name = %s""", ("2025-12-10 10:00:00", b))
        frappe.db.commit()
        this_year = int(frappe.utils.nowdate()[:4])
        mine = {r["name"] for r in self.names("all", None)["data"]} & {a, b}
        self.assertEqual(mine, {a, b})
        summary = self.as_user(ACC, queue.get_claim_month_summary, "all", 2025)
        self.assertGreaterEqual(summary["months"]["12"]["count"], 1)
        self.assertGreaterEqual(summary["months"]["12"]["total"], 700)
        self.assertLessEqual(summary["first_year"], 2025)
        now = self.as_user(ACC, queue.get_claim_month_summary, "all", this_year)
        self.assertGreaterEqual(now["months"][str(int(frappe.utils.nowdate()[5:7]))]["total"], 300)
        # A claimant reads only their own claims, on All and on Raised By Me.
        theirs = self.as_user(PM2, queue.get_claim_month_summary, "all", 2025)
        self.assertEqual(theirs["months"]["12"], {"count": 1, "total": 700.0})
        self.assertEqual(self.as_user(PM2, queue.get_claim_month_summary, "mine", 2025)["months"]["12"],
                         {"count": 1, "total": 700.0})
        # Pending Approval counts its own claims by raised month (owner, 2026-11-19: every tab has months).
        pending = self.as_user(ACC, queue.get_claim_month_summary, "pending", this_year)
        self.assertGreaterEqual(pending["months"][str(int(frappe.utils.nowdate()[5:7]))]["count"], 1)
        with self.assertRaises(frappe.ValidationError):
            self.as_user(ACC, queue.get_claim_month_summary, "nonsense", 2025)

    def test_payment_need_to_be_paid_narrows_by_the_raised_month(self):
        name, _ = self.approve(HR)  # small: born Approved, so it waits to be paid
        listed = [r["name"] for r in self.names("approved", self.THIS_MONTH)["data"]]
        self.assertIn(name, listed)
        last_month = frappe.utils.add_months(frappe.utils.nowdate(), -1)[:7]
        self.assertNotIn(name, [r["name"] for r in self.names("approved", last_month)["data"]])
        summary = self.as_user(ACC, queue.get_claim_month_summary, "approved", int(self.THIS_MONTH[:4]))
        self.assertGreaterEqual(summary["months"][str(int(self.THIS_MONTH[5:]))]["count"], 1)

    def test_every_tab_narrows_by_the_raised_month_and_a_bad_month_is_refused(self):
        name = self.raise_claim(PM, amount=300)
        self.assertIn(name, {r["name"] for r in self.names("pending", self.THIS_MONTH)["data"]})
        self.assertNotIn(name, {r["name"] for r in self.names("pending", "1999-01")["data"]})
        mine = self.as_user(PM, queue.get_claims, "mine", fields=["name"], month="1999-01")
        self.assertNotIn(name, {r["name"] for r in mine["data"]})
        for bad in ("2026-13", "Nov 2026", "2026/11"):
            with self.subTest(bad=bad), self.assertRaises(frappe.ValidationError):
                self.names("all", bad)


class TestBulkDecisions(ReimbursementTestCase):
    """ADR-0040 Amendment C point 5: Approve selected / Reject selected on Pending Approval run the single call's
    steps per claim, each in its own savepoint (`review.bulk_approve_reimbursements`, `bulk_reject_reimbursements`)."""

    def setUp(self):
        super().setUp()
        p = patch("nirmaan_stack.services.stored_files.delete_files", self.storage.delete_files)
        p.start()
        self.addCleanup(p.stop)

    def bulk_approve(self, user, names, acknowledged=1):
        return self.as_user(user, review.bulk_approve_reimbursements, names, acknowledged=acknowledged)["data"]

    def bulk_reject(self, user, names, reason="reimb_test duplicate"):
        return self.as_user(user, review.bulk_reject_reimbursements, names, reason)["data"]

    @staticmethod
    def status(name):
        return frappe.db.get_value("Reimbursement", name, "status")

    def test_each_claim_lands_in_its_own_tab(self):
        small = self.raise_claim(PM, amount=1450)
        at_limit = self.raise_claim(PM2, amount=2500)
        data = self.bulk_approve(HR, [small, at_limit])
        self.assertEqual(sorted(data["succeeded"]), sorted([small, at_limit]))
        self.assertEqual(data["failed"], [])
        self.assertEqual((data["results"][small]["tab"], data["results"][small]["expense_status"]), ("approved", "Approved"))
        self.assertEqual((data["results"][at_limit]["tab"], data["results"][at_limit]["expense_status"]), ("l1", "Requested"))
        # The claim carries its expense's status (owner, 2026-11-19): Approved to be paid, Requested waiting for L1.
        self.assertEqual((self.status(small), self.status(at_limit)), (APPROVED, REQUESTED))
        for name in (small, at_limit):
            self.assertEqual(convert.expense_of(name), data["results"][name]["expense"])

    def test_admin_over_50000_sends_it_to_the_ceo(self):
        big = self.raise_claim(PM, amount=60000)
        data = self.bulk_approve(ADMIN, [big])
        self.assertEqual((data["results"][big]["tab"], data["results"][big]["expense_status"]), ("ceo", "CEO Pending"))

    def test_the_same_persons_second_claim_counts_the_first(self):
        """Decided in name order: the second claim's month total includes the first, approved just before it."""
        first, second = sorted([self.raise_claim(PM, amount=1200), self.raise_claim(PM, amount=1000)])
        data = self.bulk_approve(HR, [second, first])
        self.assertEqual(data["succeeded"], [first, second])
        self.assertEqual(data["results"][first]["tab"], "approved")  # ₹1,200 alone
        self.assertEqual(data["results"][second]["tab"], "l1")  # ₹1,000 + ₹1,200 = ₹2,200

    def test_a_refused_claim_never_takes_the_batch_with_it(self):
        good = self.raise_claim(PM, amount=500)
        from_hr = self.raise_claim(HRL, amount=300)  # HR can't decide a claim raised in HR
        decided = self.raise_claim(PM2, amount=400)
        self.as_user(ADMIN, review.reject_reimbursement, decided, "reimb_test earlier")
        data = self.bulk_approve(HR, [good, from_hr, decided])
        self.assertEqual(data["succeeded"], [good])
        reasons = {f["name"]: f["reason"] for f in data["failed"]}
        self.assertEqual(set(reasons), {from_hr, decided})
        self.assertIn("HR", reasons[from_hr])
        self.assertIn("Rejected", reasons[decided])
        frappe.db.rollback()  # what follows reads only what the call committed
        self.assertEqual(self.status(good), APPROVED)
        self.assertTrue(convert.expense_of(good))
        self.assertEqual(self.status(from_hr), PENDING)
        self.assertIsNone(convert.expense_of(from_hr))

    def test_without_the_confirm_a_claim_at_the_limit_is_refused_and_left_untouched(self):
        under = self.raise_claim(PM, amount=800)
        over = self.raise_claim(PM2, amount=2000)
        data = self.bulk_approve(HR, [under, over], acknowledged=0)
        self.assertEqual(data["succeeded"], [under])
        self.assertEqual([f["name"] for f in data["failed"]], [over])
        self.assertIn("Tick", data["failed"][0]["reason"])
        self.assertEqual(self.status(over), PENDING)
        self.assertIsNone(convert.expense_of(over))  # the savepoint undid the half-done approval

    def test_reject_selected_uses_one_reason_for_all(self):
        names = [self.raise_claim(PM, amount=300), self.raise_claim(PM2, amount=700)]
        data = self.bulk_reject(HR, names, " reimb_test no receipts ")
        self.assertEqual(sorted(data["succeeded"]), sorted(names))
        for name in names:
            claim = frappe.get_doc("Reimbursement", name)
            self.assertEqual((claim.status, claim.rejection_reason), (REJECTED, "reimb_test no receipts"))
            self.assertIsNone(data["results"][name]["tab"])  # Rejected is only in All
            self.assertIsNone(convert.expense_of(name))

    def test_a_blank_reason_is_refused_before_any_claim_is_touched(self):
        name = self.raise_claim(PM, amount=300)
        with self.assertRaises(frappe.ValidationError):
            self.bulk_reject(HR, [name], "   ")
        self.assertEqual(self.status(name), PENDING)

    def test_accounts_cannot_decide_in_bulk_either(self):
        name = self.raise_claim(PM, amount=300)
        data = self.bulk_approve(ACC, [name])
        self.assertEqual(data["succeeded"], [])
        self.assertEqual(self.status(name), PENDING)
        data = self.bulk_reject(ACC, [name])
        self.assertEqual(data["succeeded"], [])
        self.assertEqual(self.status(name), PENDING)

    def test_the_batch_is_one_to_a_hundred_unique_claims(self):
        with self.assertRaises(frappe.ValidationError):
            self.bulk_approve(HR, [])
        with self.assertRaises(frappe.ValidationError):
            self.bulk_approve(HR, [f"reimb_test-{i}" for i in range(101)])
        name = self.raise_claim(PM, amount=300)
        data = self.bulk_approve(HR, f'["{name}", "{name}"]')  # JSON, as the screen sends it; a repeat counts once
        self.assertEqual((data["succeeded"], data["total"]), ([name], 1))

    def test_unknown_claims_fail_by_name(self):
        data = self.bulk_approve(HR, ["reimb_test-missing"])
        self.assertEqual([f["name"] for f in data["failed"]], ["reimb_test-missing"])

    def test_only_the_claims_that_went_through_are_notified_after_the_commit(self):
        good = self.raise_claim(PM, amount=300)
        from_hr = self.raise_claim(HRL, amount=300)
        told = []
        with patch.object(review, "notify_decided", lambda claim, decision: told.append((claim.name, decision))):
            self.bulk_approve(HR, [good, from_hr])
        self.assertEqual(told, [(good, APPROVED)])

    def test_the_single_approve_now_says_where_the_claim_went(self):
        name = self.raise_claim(PM, amount=2500)
        reply = self.as_user(HR, review.approve_reimbursement, name, acknowledged=1)
        self.assertEqual((reply["status"], reply["expense_status"], reply["tab"]), (REQUESTED, "Requested", "l1"))


class TestSimultaneousDecisions(ReimbursementTestCase):
    """Two people approve one claim at the same moment (browser walk 2026-11-19: the second got a raw 500
    `SerializationFailure`). The loser runs on its own connection, its snapshot taken before the winner commits --
    the request's first transaction, REPEATABLE READ -- so its lock read is refused; `expense_link.lock_claim` turns
    that into a sentence. Exactly one expense either way."""

    def race(self, loser_call) -> dict:
        """Take the loser's snapshot, let HR approve and commit, then run `loser_call(name)` on the loser's
        connection. Returns `{name, exc | result}`."""
        name = self.raise_claim(PM, amount=450)
        out: dict = {"name": name}
        snapshot_taken, winner_done = threading.Event(), threading.Event()
        site, sites_path = frappe.local.site, frappe.local.sites_path

        def loser():
            frappe.init(site=site, sites_path=sites_path)
            try:
                frappe.connect()
                frappe.set_user(ADMIN)
                # The first statement fixes this transaction's REPEATABLE READ snapshot, before the winner commits.
                frappe.db.sql('SELECT status FROM "tabReimbursement" WHERE name = %s', name)
                snapshot_taken.set()
                winner_done.wait(30)
                try:
                    out["result"] = loser_call(name)
                except Exception as exc:  # noqa: BLE001 -- the test asserts on it
                    out["exc"] = exc
                frappe.db.rollback()
            finally:
                frappe.destroy()

        thread = threading.Thread(target=loser)
        thread.start()
        self.assertTrue(snapshot_taken.wait(30))
        self.as_user(HR, review.approve_reimbursement, name)
        winner_done.set()
        thread.join(60)
        self.assertEqual(frappe.db.count(NPE, {"reimbursement": name}), 1)
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "approved_by"), HR)
        return out

    def test_the_second_single_approve_is_told_not_crashed(self):
        out = self.race(lambda name: review.approve_reimbursement(name))
        self.assertIsInstance(out.get("exc"), frappe.ValidationError, out)
        self.assertIn("a moment ago", str(out["exc"]))

    def test_the_second_bulk_approve_reports_the_claim_it_lost(self):
        out = self.race(lambda name: review.bulk_approve_reimbursements([name])["data"])
        data = out.get("result")
        self.assertIsNotNone(data, out)
        self.assertEqual(data["succeeded"], [])
        self.assertEqual([f["name"] for f in data["failed"]], [out["name"]])
        self.assertIn("a moment ago", data["failed"][0]["reason"])

    def test_a_reject_racing_an_approve_is_told_too(self):
        out = self.race(lambda name: review.reject_reimbursement(name, "reimb_test too late"))
        self.assertIsInstance(out.get("exc"), frappe.ValidationError, out)
        self.assertEqual(frappe.db.get_value("Reimbursement", out["name"], "status"), APPROVED)


class TestProjectManagerCap(ReimbursementTestCase):
    """Owner, 2026-11-18: a Project Manager's claims raised in one calendar month may add up to ₹2,000 and no more,
    refused at raise and at edit (`claims._check_cap`, `rules.cap_problem`). Pending, Approved and Paid claims count;
    a rejected one frees its amount."""

    def setUp(self):
        super().setUp()
        p = patch.object(claims, "is_capped", access.is_capped)  # the real check, for these tests only
        p.start()
        self.addCleanup(p.stop)

    def mine_this_month(self, user=PM):
        return frappe.get_all("Reimbursement", {"owner": user, "creation": [">=", frappe.utils.get_first_day(frappe.utils.nowdate())]},
                              pluck="name")

    def test_a_project_manager_can_claim_up_to_2000_in_a_month(self):
        self.raise_claim(PM, amount=1200)
        self.raise_claim(PM, amount=800)  # exactly ₹2,000: allowed
        with self.assertRaises(frappe.ValidationError) as refused:
            self.raise_claim(PM, amount=1)
        self.assertIn("You have used this month's ₹2,000", str(refused.exception))

    def test_one_claim_of_exactly_2000_is_allowed_and_one_above_it_is_not(self):
        with self.assertRaises(frappe.ValidationError) as refused:
            self.raise_claim(PM, amount=2000.01)
        self.assertIn("up to ₹2,000 more", str(refused.exception))
        self.raise_claim(PM, amount=2000)

    def test_a_refused_claim_saves_nothing_and_says_what_is_left(self):
        self.raise_claim(PM, amount=1500)
        with self.assertRaises(frappe.ValidationError) as refused:
            self.raise_claim(PM, amount=600)
        self.assertIn("You can claim up to ₹500 more this month", str(refused.exception))
        self.assertEqual(len(self.mine_this_month()), 1)

    def test_pending_claims_count_and_a_rejected_one_frees_its_amount(self):
        first = self.raise_claim(PM, amount=1500)
        with self.assertRaises(frappe.ValidationError):
            self.raise_claim(PM, amount=600)
        self.as_user(HR, review.reject_reimbursement, first, "reimb_test wrong receipt")
        self.raise_claim(PM, amount=600)

    def test_approved_claims_count(self):
        first = self.raise_claim(PM, amount=1500)
        self.as_user(HR, review.approve_reimbursement, first)
        with self.assertRaises(frappe.ValidationError):
            self.raise_claim(PM, amount=501)
        self.raise_claim(PM, amount=500)

    def test_a_new_month_starts_again(self):
        self.raise_claim(PM, amount=1800)
        self.fresh_month()  # moves the claims back a year
        self.raise_claim(PM, amount=1800)

    def test_an_edit_is_checked_and_replaces_its_own_old_amount(self):
        payee = self.account(PM)
        first = self.raise_claim(PM, amount=1500)
        self.as_user(PM, claims.update_reimbursement, first, "Cab", 2000, payee, description="Site visit",
                     reimbursement_type="Travel")  # its own ₹1,500 is replaced, so ₹2,000 fits
        with self.assertRaises(frappe.ValidationError):
            self.raise_claim(PM, amount=1)
        self.as_user(PM, claims.update_reimbursement, first, "Cab", 1500, payee, reimbursement_type="Travel")
        self.raise_claim(PM, amount=500)
        with self.assertRaises(frappe.ValidationError) as refused:
            self.as_user(PM, claims.update_reimbursement, first, "Cab", 1600, payee, reimbursement_type="Travel")
        self.assertIn("up to ₹1,500 more", str(refused.exception))
        self.assertEqual(frappe.db.get_value("Reimbursement", first, "amount"), 1500)

    def test_only_project_managers_are_capped(self):
        self.raise_claim(PM2, amount=1500)  # also a Project Manager (with System Manager)
        with self.assertRaises(frappe.ValidationError):
            self.raise_claim(PM2, amount=600)
        for user in (HR, ACC, ADMIN):
            self.raise_claim(user, amount=2500)
            self.raise_claim(user, amount=2500)

    def test_my_month_tells_the_dialog_what_is_left(self):
        first = self.raise_claim(PM, amount=1200)
        self.assertEqual(self.as_user(PM, claims.get_my_month), {"capped": True, "cap": 2000, "used": 1200, "left": 800})
        # Editing `first`: the month without it.
        self.assertEqual(self.as_user(PM, claims.get_my_month, exclude=first)["used"], 0)
        # Someone else's claim is never left out.
        other = self.raise_claim(PM2, amount=300)
        self.assertEqual(self.as_user(PM, claims.get_my_month, exclude=other)["used"], 1200)
        self.assertEqual(self.as_user(ACC, claims.get_my_month), {"capped": False, "cap": 2000, "used": 0, "left": None})


class TestMonthlyLimit(ReimbursementTestCase):
    """ADR-0040 Amendment B: the ₹2,000 monthly limit decides how far an approval goes, never who may approve."""

    def approve(self, user, amount, claimant=PM, acknowledged=1):
        name = self.raise_claim(claimant, amount=amount)
        self.as_user(user, review.approve_reimbursement, name, acknowledged=acknowledged)
        return name, frappe.get_doc(NPE, convert.expense_of(name))

    def l1(self, user, expense, action="l1_approve") -> dict:
        return self.as_user(user, expense_actions.decide_expenses, expense_ids=[expense.name], action=action)["data"]

    def test_the_month_total_counts_this_claim_and_approved_or_paid_ones_of_the_same_month(self):
        approved, _ = self.approve(HR, 1000)
        paid = self.raise_claim(PM, amount=150)
        frappe.db.set_value("Reimbursement", paid, "status", PAID, update_modified=False)  # setup: counted as Paid
        pending = self.raise_claim(PM, amount=300)
        rejected = self.raise_claim(PM, amount=400)
        self.as_user(HR, review.reject_reimbursement, rejected, "Duplicate")
        last_month = self.raise_claim(PM, amount=700)
        frappe.db.set_value("Reimbursement", last_month, "status", APPROVED, update_modified=False)
        frappe.db.sql("""UPDATE "tabReimbursement" SET creation = creation - INTERVAL '40 days' WHERE name = %s""",
                      last_month)  # setup: raised in an earlier month
        someone_else, _ = self.approve(HR, 900, claimant=PM2)
        frappe.db.commit()

        row = totals_of([pending])[pending]
        # 300 (this one) + 1000 approved + 150 paid; not the rejected 400, last month's 700 or another person's 900.
        self.assertEqual((row.month_total, row.claims, row.over_limit), (1450, 3, False))
        self.assertEqual(row.claimant, PM)
        self.assertTrue(row.month.endswith("-01"))
        # An approved claim counts itself once, as L1 sees it in Payments; the pending 300 is not counted for it.
        self.assertEqual(totals_of([approved])[approved].month_total, 1150)
        self.assertEqual(totals_of([someone_else])[someone_else].month_total, 900)

    def test_hr_under_the_limit_finishes_the_claim(self):
        self.approve(HR, 1500)
        name, expense = self.approve(HR, 499, acknowledged=0)  # month total ₹1,999: no tick needed
        self.assertEqual((expense.status, expense.auto_approved), ("Approved", 1))
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), APPROVED)

    def test_exactly_2000_for_the_month_reaches_the_limit(self):
        """Owner, 2026-10-28: only a month total under ₹2,000 is within the limit; exactly ₹2,000 needs the tick and L1."""
        self.approve(HR, 1500)
        name = self.raise_claim(PM, amount=500)  # the month comes to exactly ₹2,000
        with self.assertRaises(frappe.ValidationError):
            self.as_user(HR, review.approve_reimbursement, name)
        self.as_user(HR, review.approve_reimbursement, name, acknowledged=1)
        expense = frappe.get_doc(NPE, convert.expense_of(name))
        self.assertEqual((expense.status, expense.auto_approved), ("Requested", 0))

    def test_hr_above_the_limit_sends_even_a_small_claim_to_l1(self):
        self.approve(HR, 1500)
        second = self.raise_claim(PM, amount=1200)
        with self.assertRaises(frappe.ValidationError):
            self.as_user(HR, review.approve_reimbursement, second)  # no tick
        self.assertIsNone(convert.expense_of(second))
        self.as_user(HR, review.approve_reimbursement, second, acknowledged=1)
        expense = frappe.get_doc(NPE, convert.expense_of(second))
        # ₹1,200 is in the auto band, but HR's approval above the limit waits for L1.
        self.assertEqual((expense.status, expense.auto_approved), ("Requested", 0))
        self.assertFalse(expense.approval_date)
        self.assertEqual(frappe.db.get_value("Reimbursement", second, "status"), REQUESTED)

        self.assertEqual(self.l1(HR, expense)["succeeded"], [])  # HR is not L1
        self.assertEqual(self.l1(ADMIN, expense)["statuses"], {expense.name: "Approved"})
        self.assertEqual(frappe.db.get_value("Reimbursement", second, "status"), APPROVED)

    def test_a_large_claim_hr_approves_goes_to_l1_then_to_the_ceo_above_50000(self):
        _, mid = self.approve(HR, 20000)
        self.assertEqual(mid.status, "Requested")
        self.assertEqual(self.l1(ADMIN, mid)["statuses"], {mid.name: "Approved"})
        self.fresh_month()
        _, large = self.approve(HR, 60000)
        self.assertEqual(large.status, "Requested")
        self.assertEqual(self.l1(ADMIN, large)["statuses"], {large.name: "CEO Pending"})

    def test_admin_above_the_limit_ticks_and_still_counts_as_l1(self):
        name = self.raise_claim(PM, amount=20000)  # above the auto band, so Admin's L1 step shows
        with self.assertRaises(frappe.ValidationError):
            self.as_user(ADMIN, review.approve_reimbursement, name)
        self.as_user(ADMIN, review.approve_reimbursement, name, acknowledged=1)
        expense = frappe.get_doc(NPE, convert.expense_of(name))
        self.assertEqual((expense.status, expense.auto_approved), ("Approved", 0))
        self.assertTrue(expense.approval_date)

    def test_the_tick_does_not_fake_a_need_for_l1_under_the_limit(self):
        """`acknowledged` sent under the limit changes nothing: the expense still auto-approves."""
        _, expense = self.approve(HR, 800, acknowledged=1)
        self.assertEqual(expense.status, "Approved")

    def test_month_totals_by_claim_and_by_expense_for_hr_admin_and_accounts(self):
        first, _ = self.approve(HR, 1500)
        second, expense = self.approve(HR, 1200)
        by_claim = {r["claim"]: r for r in self.as_user(HR, month_totals.get_month_totals, claims=[second])}
        self.assertEqual((by_claim[second]["month_total"], by_claim[second]["claims"]), (2700, 2))
        self.assertTrue(by_claim[second]["over_limit"])
        self.assertIsNone(by_claim[second]["expense"])
        by_expense = self.as_user(ADMIN, month_totals.get_month_totals, expenses=[expense.name, "NO-SUCH-EXPENSE"])
        self.assertEqual([(r["expense"], r["claim"]) for r in by_expense], [(expense.name, second)])
        self.assertEqual(len(self.as_user(ACC, month_totals.get_month_totals, claims=[first, second])), 2)
        with self.assertRaises(frappe.PermissionError):
            self.as_user(PM, month_totals.get_month_totals, claims=[first])


class TestWhoSeesWhat(ReimbursementTestCase):
    def test_people_see_only_their_own_claims(self):
        mine = self.raise_claim(PM)
        theirs = self.raise_claim(PM2)
        doc = frappe.get_doc("Reimbursement", theirs)
        self.assertFalse(frappe.has_permission("Reimbursement", "read", doc=doc, user=PM))
        listed = self.as_user(PM, frappe.get_list, "Reimbursement", filters={"name": ["in", [mine, theirs]]},
                              pluck="name")
        self.assertEqual(listed, [mine])

    def test_hr_admin_and_accounts_see_every_claim(self):
        name = self.raise_claim(PM)
        doc = frappe.get_doc("Reimbursement", name)
        for user in (HR, HRL, ADMIN, ACC):
            with self.subTest(user):
                self.assertTrue(frappe.has_permission("Reimbursement", "read", doc=doc, user=user))

    def test_system_manager_cannot_write_a_claim_outside_the_endpoints(self):
        name = self.raise_claim(PM2)
        frappe.set_user(PM2)
        doc = frappe.get_doc("Reimbursement", name)
        doc.amount = 1
        with self.assertRaises(frappe.PermissionError):
            doc.save()


class TestDeletingAPerson(ReimbursementTestCase):
    """Owner, 2026-10-28 (ADR-0033 Amendment C): deleting a person deletes their own bank account too, unless a
    Vendor is also paid into it. The delete is never blocked, and the claims keep their own copy of the account."""

    def leaver(self, email):
        _make_user(email, "Nirmaan Project Manager Profile", ("Nirmaan Project Manager",))
        frappe.db.commit()

    def test_deleting_a_person_deletes_their_account_and_their_claims_keep_it(self):
        self.leaver(LEAVER)
        payee = self.account(LEAVER)
        number = frappe.db.get_value("Payee", payee, "account_number")
        pending = self.raise_claim(LEAVER, payee=payee)
        frappe.delete_doc("Nirmaan Users", LEAVER, ignore_permissions=True)
        self.assertFalse(frappe.db.exists("Nirmaan Users", LEAVER))
        self.assertFalse(frappe.db.exists("Payee", payee))
        self.assertTrue(frappe.db.exists("Deleted Document", {"deleted_doctype": "Payee", "deleted_name": payee}))

        claim = frappe.get_doc("Reimbursement", pending)
        self.assertEqual((claim.owner, claim.claimant_name), (LEAVER, "reimb_test_leaver"))
        self.assertEqual(claim.pay_to_account_number, number)
        # The pending claim is still Admin's or HR's to decide.
        self.as_user(ADMIN, review.reject_reimbursement, pending, "Left the company")
        self.assertEqual(frappe.db.get_value("Reimbursement", pending, "status"), REJECTED)

    def test_an_account_a_vendor_is_also_paid_into_stays(self):
        self.leaver(LEAVER2)
        payee = self.account(LEAVER2)
        with patch.object(own_accounts, "linked_vendors", lambda name: [{"name": "VEN-X", "vendor_name": "Acme"}]):
            frappe.delete_doc("Nirmaan Users", LEAVER2, ignore_permissions=True)
        self.assertFalse(frappe.db.exists("Nirmaan Users", LEAVER2))
        self.assertTrue(frappe.db.exists("Payee", payee))
        self.assertIsNone(own_accounts.holder_of(payee))

    def test_a_person_with_no_account_deletes_as_before(self):
        self.leaver(LEAVER2)
        self.no_account(LEAVER2)
        frappe.delete_doc("Nirmaan Users", LEAVER2, ignore_permissions=True)
        self.assertFalse(frappe.db.exists("Nirmaan Users", LEAVER2))

    def test_a_failed_account_delete_undoes_the_person_s_delete(self):
        self.leaver(LEAVER2)
        payee = self.account(LEAVER2)
        with patch.object(own_accounts, "delete_payee", side_effect=frappe.ValidationError("storage down")):
            with self.assertRaises(frappe.ValidationError):
                frappe.delete_doc("Nirmaan Users", LEAVER2, ignore_permissions=True)
        frappe.db.rollback()
        self.assertTrue(frappe.db.exists("Nirmaan Users", LEAVER2))
        self.assertEqual(frappe.db.get_value("Nirmaan Users", LEAVER2, "payee"), payee)


class TestDoctypeMatchesRules(ExpenseTypeFlagGuard, FrappeTestCase):
    def test_type_options_are_the_rules_types(self):
        from nirmaan_stack.services.reimbursements.rules import TYPES
        field = frappe.get_meta("Reimbursement").get_field("reimbursement_type")
        self.assertEqual(field.options.split("\n"), list(TYPES))
        self.assertTrue(field.reqd)

    def test_status_options_are_the_rules_statuses(self):
        from nirmaan_stack.services.reimbursements.rules import STATUSES
        options = frappe.get_meta("Reimbursement").get_field("status").options.split("\n")
        self.assertEqual(options, list(STATUSES))


class TestMergeToPdf(ExpenseTypeFlagGuard, FrappeTestCase):
    def test_pages_keep_their_order_and_pictures_become_pages(self):
        from pypdf import PdfReader
        merged = receipts.merge_to_pdf([("a.pdf", _pdf(2)), ("b.png", _png()), ("c.pdf", _pdf(1))])
        self.assertEqual(len(PdfReader(io.BytesIO(merged)).pages), 4)

    def test_a_file_that_is_neither_is_named(self):
        with self.assertRaises(ValueError) as e:
            receipts.merge_to_pdf([("notes.txt", b"hello")])
        self.assertIn("notes.txt", str(e.exception))

    def test_mergeable_by_extension(self):
        self.assertTrue(receipts.is_mergeable("Bill.PDF"))
        self.assertTrue(receipts.is_mergeable("photo.jpeg"))
        self.assertFalse(receipts.is_mergeable("log.xlsx"))
        self.assertFalse(receipts.is_mergeable(None))
