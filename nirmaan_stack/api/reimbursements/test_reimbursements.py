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
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.approvals import expense_actions
from nirmaan_stack.api.reimbursements import bank_accounts, claims, review
from nirmaan_stack.services.payees import own_accounts
from nirmaan_stack.services.reimbursements import convert, expense_link, receipts
from nirmaan_stack.services.reimbursements.rules import APPROVED, PAID, PENDING, REJECTED

NPE = "Non Project Expenses"

PM = "reimb_test_pm@example.com"
PM2 = "reimb_test_pm2@example.com"  # also carries System Manager, as several real profiles do
HR = "reimb_test_hr@example.com"
HRL = "reimb_test_hrl@example.com"
ADMIN = "reimb_test_admin@example.com"
ACC = "reimb_test_acc@example.com"
LEAVER = "reimb_test_leaver@example.com"  # deleted by its own test
USERS = (PM, PM2, HR, HRL, ADMIN, ACC, LEAVER)

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
    frappe.db.set_value("Nirmaan Users", email, "role_profile", profile, update_modified=False)


class _Storage:
    """Stands in for the storage app: file bytes by URL, stored PDFs as fake-URL File rows, deletes as raw
    row deletes (recorded)."""

    def __init__(self):
        self.content: dict[str, bytes] = {}
        self.deleted: list[str] = []

    def fetch(self, url):
        return self.content.get(url)

    def save_file(self, fname, content, dt, dn, df=None, is_private=1, **_):
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


class ReimbursementTestCase(FrappeTestCase):
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
            patch.object(receipts, "save_file", self.storage.save_file),
            patch.object(claims, "delete_files", self.storage.delete_files),
            patch("nirmaan_stack.services.payees.writer.lookup_ifsc",
                  lambda ifsc: SimpleNamespace(bank_name="HDFC Bank", bank_branch="Test Branch")),
            patch.object(review, "notify_decided", lambda *a, **k: None),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(frappe.set_user, "Administrator")

    # --- helpers ---------------------------------------------------------------------------------

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
        names = frappe.get_all(NPE, {"reimbursement": ["in", claims_ or [""]]}, pluck="name")
        if names:
            frappe.db.delete("Comment", {"reference_doctype": NPE, "reference_name": ["in", names]})
            frappe.db.delete(NPE, {"name": ["in", names]})
        frappe.db.delete(NPE, {"description": ["like", "reimb_test %"]})

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

    def test_an_account_on_record_with_nobody_is_linked_to_you(self):
        payee = frappe.get_doc({"doctype": "Payee", "account_name": "Loose", "account_number": f"{PREFIX}900003",
                                "ifsc": IFSC, "bank_name": "HDFC Bank", "bank_branch": "Test"}).insert(
            ignore_permissions=True).name
        reply = self.as_user(PM2, bank_accounts.add_my_bank_account, "PM2", f"{PREFIX}900003", IFSC)
        self.assertEqual((reply["outcome"], reply["payee"]), (own_accounts.LINKED, payee))
        self.assertEqual(own_accounts.holder_of(payee), PM2)

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
    def test_hr_approves_up_to_the_limit_and_saves_who(self):
        name = self.raise_claim(PM, amount=2000)
        self.as_user(HR, review.approve_reimbursement, name)
        claim = frappe.get_doc("Reimbursement", name)
        self.assertEqual((claim.status, claim.approved_by), (APPROVED, HR))

    def test_hr_cannot_approve_above_the_limit_but_admin_can(self):
        name = self.raise_claim(PM, amount=2000.01)
        with self.assertRaises(frappe.PermissionError):
            self.as_user(HRL, review.approve_reimbursement, name)
        self.as_user(ADMIN, review.approve_reimbursement, name)
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "approved_by"), ADMIN)

    def test_a_claim_raised_by_hr_is_admins_even_when_small(self):
        name = self.raise_claim(HR, amount=100)
        for hr in (HR, HRL):
            with self.assertRaises(frappe.PermissionError):
                self.as_user(hr, review.approve_reimbursement, name)
        self.as_user(ADMIN, review.approve_reimbursement, name)

    def test_the_role_saved_on_the_claim_decides_even_after_the_person_moves_role(self):
        name = self.raise_claim(HRL, amount=300)
        frappe.db.set_value("Nirmaan Users", HRL, "role_profile", "Nirmaan Project Manager Profile", update_modified=False)
        try:
            with self.assertRaises(frappe.PermissionError):
                self.as_user(HR, review.approve_reimbursement, name)
            row = {r.name: r for r in self.as_user(HR, review.get_pending_for_me)}[name]
            self.assertFalse(row.can_decide)
        finally:
            frappe.db.set_value("Nirmaan Users", HRL, "role_profile", "Nirmaan HR Lead Profile", update_modified=False)

    def test_admin_may_approve_their_own_claim(self):
        name = self.raise_claim(ADMIN, amount=5000)
        self.as_user(ADMIN, review.approve_reimbursement, name)
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
        # HR sees every pending claim, and may decide only the small one raised outside HR.
        self.assertTrue({small, large, from_hr} <= set(hr_queue))
        self.assertTrue(hr_queue[small].can_decide)
        self.assertFalse(hr_queue[large].can_decide)
        self.assertIn("2,000", hr_queue[large].cannot_decide_reason)
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
        name = self.raise_claim(claimant, amount=amount)
        self.as_user(user, review.approve_reimbursement, name)
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

    def test_hr_approval_is_auto_approved(self):
        _, expense = self.approve(HR, amount=2000)
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

    def test_the_claim_stays_approved_until_the_expense_is_paid(self):
        name, expense = self.approve(HR)
        self.move(expense, "Reconciliation Pending")
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), APPROVED)
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

    def test_an_undone_bank_match_puts_the_claim_back_to_approved(self):
        name, expense = self.approve(HR)
        self.move(expense, "Paid")
        self.move(expense, "Reconciliation Pending")
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), APPROVED)

    def test_rejecting_in_the_payments_queue_rejects_the_claim_with_that_reason(self):
        name, expense = self.approve(ADMIN, amount=80000)
        reply = expense_actions._bulk_expense_action(
            [expense.name], "reject", " Duplicate of an earlier claim ", "CEO Pending", "ceo_approval_date", True,
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

    def test_the_claimant_cannot_delete_their_own_claims_expense_unless_it_is_rejected(self):
        """Code review 2026-10-23: the claimant's delete is allowed only while Pending or Rejected (owner), so their
        own claim's expense can't be deleted around that rule (it would take an Approved / Paid claim with it)."""
        name, expense = self.approve(HR)
        with self.assertRaises(frappe.ValidationError):
            self.as_user(PM, frappe.delete_doc, NPE, expense.name, ignore_permissions=True)
        frappe.db.rollback()
        self.assertTrue(frappe.db.exists("Reimbursement", name))
        self.move(expense, "Rejected", "Wrong project")
        self.as_user(PM, frappe.delete_doc, NPE, expense.name, ignore_permissions=True)
        self.assertFalse(frappe.db.exists("Reimbursement", name))

    def test_the_claimant_cannot_delete_a_rejected_claim_whose_expense_was_revived(self):
        """Code review finding 2: a claim Rejected in Payments whose expense was later put back must not take
        that live expense with it."""
        name, expense = self.approve(HR)
        self.move(expense, "Rejected", "Wrong project")
        # Revival is refused through the document now (Rejected is final); this stands in for an older row or a
        # raw write that got past it, which the claim's delete must still refuse. Raw on purpose: test setup.
        frappe.db.set_value(NPE, expense.name, "status", "Approved", update_modified=False)
        frappe.db.commit()
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), REJECTED)
        with self.assertRaises(frappe.ValidationError) as refused:
            self.as_user(PM, claims.delete_reimbursement, name)
        self.assertIn(expense.name, str(refused.exception))
        frappe.db.rollback()
        self.assertTrue(frappe.db.exists("Reimbursement", name))
        self.assertTrue(frappe.db.exists(NPE, expense.name))

    def test_the_claimant_deleting_a_claim_rejected_in_payments_deletes_its_expense(self):
        name, expense = self.approve(HR)
        self.move(expense, "Rejected", "Wrong project")
        frappe.db.commit()
        self.as_user(PM, claims.delete_reimbursement, name)
        self.assertFalse(frappe.db.exists("Reimbursement", name))
        self.assertFalse(frappe.db.exists(NPE, expense.name))

    def test_the_bank_import_links_settles_and_undoes_it_like_any_expense(self):
        """Bulk Import Transactions treats the claim's expense as an ordinary Non-Project Expense: it is offered
        for manual linking once Reconciliation Pending, a settle inside the import's savepoint (with its
        no-commit flag) turns the claim Paid, and Unreconcile's own revert turns it back to Approved."""
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
        self.assertEqual(frappe.db.get_value("Reimbursement", name, "status"), APPROVED)

    def test_payments_are_read_only_for_claims_the_caller_may_read(self):
        name, expense = self.approve(HR)
        mine = self.as_user(PM, claims.get_claim_payments, [name])
        self.assertEqual(mine[name]["expense"], expense.name)
        self.assertEqual(self.as_user(PM2, claims.get_claim_payments, [name]), {})
        self.assertIn(name, self.as_user(ACC, claims.get_claim_payments, [name]))


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
    def test_a_person_with_claims_and_accounts_can_be_deleted_and_their_claims_stay(self):
        # No block (owner, 2026-10-22): HR or Admin decide any pending claim, and each claim keeps the
        # claimant's name, role and bank account on itself.
        _make_user(LEAVER, "Nirmaan Project Manager Profile", ("Nirmaan Project Manager",))
        frappe.db.commit()
        payee = self.account(LEAVER)
        pending = self.raise_claim(LEAVER, payee=payee)
        frappe.delete_doc("Nirmaan Users", LEAVER, ignore_permissions=True)
        self.assertFalse(frappe.db.exists("Nirmaan Users", LEAVER))

        claim = frappe.get_doc("Reimbursement", pending)
        self.assertEqual((claim.owner, claim.claimant_name), (LEAVER, "reimb_test_leaver"))
        self.assertEqual(claim.pay_to_account_number, frappe.db.get_value("Payee", payee, "account_number"))
        # The account stays in Payees, belonging to nobody; the pending claim is still Admin's or HR's to decide.
        self.assertIsNone(own_accounts.holder_of(payee))
        self.as_user(ADMIN, review.reject_reimbursement, pending, "Left the company")
        self.assertEqual(frappe.db.get_value("Reimbursement", pending, "status"), REJECTED)


class TestDoctypeMatchesRules(FrappeTestCase):
    def test_type_options_are_the_rules_types(self):
        from nirmaan_stack.services.reimbursements.rules import TYPES
        field = frappe.get_meta("Reimbursement").get_field("reimbursement_type")
        self.assertEqual(field.options.split("\n"), list(TYPES))
        self.assertTrue(field.reqd)

    def test_status_options_are_the_rules_statuses(self):
        from nirmaan_stack.services.reimbursements.rules import STATUSES
        options = frappe.get_meta("Reimbursement").get_field("status").options.split("\n")
        self.assertEqual(options, list(STATUSES))


class TestMergeToPdf(FrappeTestCase):
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
