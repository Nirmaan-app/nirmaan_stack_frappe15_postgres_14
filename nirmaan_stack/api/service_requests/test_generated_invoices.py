# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Generated invoices on a GST-off Work Order: generate, print and void, as the roles that use them
(#1546, spec #1528; GLOSSARY *Generated invoice*, *RA number*).

Run:  DEVENV test --module nirmaan_stack.api.service_requests.test_generated_invoices

⚠️ RUNS AGAINST THE SITE DATABASE. Rows are planted with the GST Hold fixture (`TEST-GSTH-*`) and
purged after each test; generate and void commit, so a rollback alone would not clean up.
"""

import threading
import time
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, getdate, set_request, today

from nirmaan_stack.api.delivery_notes.update_invoice_data import delete_invoice_entry
from nirmaan_stack.api.invoices.approve_vendor_invoice import approve_vendor_invoice
from nirmaan_stack.api.service_requests import generated_invoices as api
from nirmaan_stack.api.service_requests.generated_invoices import (
    generate_invoice,
    get_generated_invoices,
    upload_signed_copy,
    void_invoice,
)
from nirmaan_stack.api.vendor.test_gst_hold import U, _Fixture

SR = "Service Requests"
GI = "WO Generated Invoice"
NIRMAAN_GST = "29ABFCS9095N1Z9"
PROCUREMENT = "Nirmaan Procurement Executive Profile"
ACCOUNTANT = "Nirmaan Accountant Profile"


class GeneratedInvoiceTestCase(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.addCleanup(frappe.set_user, U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)
        # Cleanups run LIFO: these run before the purge, so its commit keeps none of them.
        self.addCleanup(self._purge_invoices)
        self.project = self.fx.project()
        self.vendor = self.fx.vendor()

    def _purge_invoices(self):
        frappe.db.rollback()  # a failed test may leave a poisoned transaction
        srs = self.fx.srs or [""]
        names = frappe.get_all(GI, filters={"work_order": ("in", srs)}, pluck="name")
        if names:
            frappe.db.delete("Version", {"ref_doctype": GI, "docname": ("in", names)})
            frappe.db.delete(GI, {"name": ("in", names)})
        invoices = frappe.get_all("Vendor Invoices", filters={"document_name": ("in", srs)}, pluck="name") or [""]
        frappe.db.delete("Nirmaan Attachments", {"associated_docname": ("in", srs + invoices)})
        frappe.db.delete("Version", {"ref_doctype": "Vendor Invoices", "docname": ("in", invoices)})
        frappe.db.delete("Vendor Invoices", {"name": ("in", invoices)})
        frappe.db.delete("Nirmaan Notifications", {"docname": ("in", srs)})

    def _wo(self, *, amount=100_000, paid=0, gst="false", **fields):
        """An Approved WO of `amount` with `paid` of Amount Paid (incl. TDS) and a Nirmaan GST."""
        wo = self.fx.work_order(self.project, self.vendor, amount, gst=gst)
        total = flt(frappe.db.get_value(SR, wo, "total_amount"))
        frappe.db.set_value(SR, wo, {"amount_paid": paid, "amount_due": total - paid,
                                     "project_gst": NIRMAAN_GST, **fields})
        return wo

    def _vendor_invoice(self, wo, amount, status, invoice_no=""):
        doc = frappe.new_doc("Vendor Invoices")
        doc.update({"document_type": SR, "document_name": wo, "project": self.project, "vendor": self.vendor,
                    "invoice_no": invoice_no or frappe.generate_hash(length=6), "invoice_date": today(),
                    "invoice_amount": amount, "invoice_base_amount": amount, "status": status})
        doc.name = f"TEST-GSTH-VI-{frappe.generate_hash(length=8)}"
        doc.db_insert()  # no invoice hooks: only the row matters here
        return doc.name

    def _user(self, profile):
        user = frappe.db.get_value("Nirmaan Users", {"role_profile": profile, "name": ("!=", U)}, "name")
        if not user:
            self.skipTest(f"no {profile} user on this site")
        return user

    def _on_project(self, user, project=None):
        """A real user only sees projects they are on: put them on the fixture's (or `project`) for this test."""
        perm = frappe.get_doc({"doctype": "User Permission", "user": user, "allow": "Projects",
                               "for_value": project or self.project}).insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(self._remove_permission, perm.name)
        return user

    @staticmethod
    def _remove_permission(name):
        """Must survive a poisoned transaction: it would otherwise leave a real user on a test project."""
        frappe.db.rollback()
        frappe.db.delete("User Permission", {"name": name})
        frappe.db.commit()

    def _as(self, user, fn, *args, **kwargs):
        frappe.set_user(user)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user(U)

    def _ra(self, wo, amount, **kw):
        return generate_invoice(wo, "RA", amount=amount, **kw)

    def _stored(self, name):
        return frappe.db.get_value(GI, name, ["ra_number", "invoice_type", "amount", "invoice_no", "status",
                                              "void_reason", "invoice_date"], as_dict=True)


class TestRaNumbers(GeneratedInvoiceTestCase):
    def test_two_generates_get_ra_1_and_ra_2_with_the_amount_and_number_saved(self):
        wo = self._wo(paid=60_000)
        first = self._ra(wo, 10_000, invoice_date="2026-10-21")
        second = self._ra(wo, 5_000.5, invoice_date="2026-10-21")

        stored = self._stored(first["name"])
        self.assertEqual((stored.ra_number, stored.invoice_type, flt(stored.amount), stored.status),
                         (1, "RA", 10_000, "Generated"))
        self.assertEqual(stored.invoice_no, f"INV-26-27-{self.project[-5:]}-{wo[-5:]}-RA-1")
        self.assertEqual(getdate(stored.invoice_date), getdate("2026-10-21"))
        self.assertEqual((self._stored(second["name"]).ra_number, flt(self._stored(second["name"]).amount)),
                         (2, 5_000.5))

    def test_a_void_burns_its_number(self):
        wo = self._wo(paid=60_000)
        void_invoice(self._ra(wo, 10_000)["name"], "Wrong amount")
        self.assertEqual(self._stored(self._ra(wo, 9_000)["name"]).ra_number, 2)

    def test_an_older_work_order_starts_after_the_highest_ra_already_used(self):
        wo = self._wo(paid=60_000, invoice_no=f"INV-25-26-{self.project[-5:]}-RA-3")
        self._vendor_invoice(wo, 1_000, "Rejected", invoice_no="RA-5")
        self.assertEqual(self._stored(self._ra(wo, 1_000)["name"]).ra_number, 6)

    def test_the_number_is_never_typed(self):
        wo = self._wo(paid=60_000)
        with self.assertRaises(TypeError):
            generate_invoice(wo, "RA", amount=1_000, ra_number=7)

    def test_a_concurrent_pair_never_shares_a_number(self):
        """Two generates at once on one WO: the second waits for the first, then takes the next
        number. Each runs on its own connection and commits, as two web requests would."""
        wo = self._wo(paid=60_000)
        frappe.db.commit()  # the other connections see committed rows only

        first_inside, release_first = threading.Event(), threading.Event()
        first_out, second_out = {}, {}
        real_new_record = api._new_record

        def paused_new_record(fields):
            if threading.current_thread() is first:
                first_inside.set()
                release_first.wait(30)
            return real_new_record(fields)

        site = (frappe.local.site, frappe.local.sites_path, wo)
        first = threading.Thread(target=_generate_on_own_connection, args=(*site, 10_000, first_out))
        second = threading.Thread(target=_generate_on_own_connection, args=(*site, 5_000, second_out))
        with patch.object(api, "_new_record", paused_new_record):
            first.start()
            try:
                self.assertTrue(first_inside.wait(30), first_out.get("error"))
                second.start()
                time.sleep(1.5)
                self.assertTrue(second.is_alive(), "the second generate did not wait for the first")
            finally:
                release_first.set()
                first.join(30)
                if second.ident:
                    second.join(30)

        self.assertNotIn("error", first_out, first_out.get("error"))
        self.assertNotIn("error", second_out, second_out.get("error"))
        self.assertEqual((first_out["ra_number"], second_out["ra_number"]), (1, 2))

    def test_the_database_refuses_a_second_record_with_the_same_number(self):
        wo = self._wo(paid=60_000)
        first = frappe.get_doc(GI, self._ra(wo, 1_000)["name"])
        copy = frappe.copy_doc(first)
        copy.flags.made_by_generate = True
        frappe.db.savepoint("duplicate")
        with self.assertRaises(frappe.DuplicateEntryError):
            copy.insert(ignore_permissions=True)
        frappe.db.rollback(save_point="duplicate")


def _generate_on_own_connection(site, sites_path, wo, amount, out):
    frappe.init(site=site, sites_path=sites_path)
    try:
        frappe.connect()
        frappe.set_user("Administrator")
        result = generate_invoice(wo, "RA", amount=amount)
        frappe.db.commit()
        out["ra_number"] = result["ra_number"]
    except Exception as e:
        frappe.db.rollback()
        out["error"] = e
    finally:
        frappe.destroy()


class TestAmountLimit(GeneratedInvoiceTestCase):
    def _wo_with_bills(self):
        """1,00,000 WO, 60,000 paid; billed 30,000: a Pending and an Approved invoice and a generated
        one not yet uploaded. A Rejected invoice and a Voided generated one count for nothing."""
        wo = self._wo(paid=60_000)
        self._vendor_invoice(wo, 10_000, "Pending")
        self._vendor_invoice(wo, 5_000, "Approved")
        self._vendor_invoice(wo, 20_000, "Rejected")
        self._ra(wo, 15_000)
        void_invoice(self._ra(wo, 7_000)["name"], "Duplicate")
        return wo

    def test_an_amount_above_the_limit_is_refused_with_the_limit_in_the_message(self):
        wo = self._wo_with_bills()
        with self.assertRaisesRegex(frappe.ValidationError, "₹30,000"):
            self._ra(wo, 30_000.01)
        self.assertEqual(flt(self._stored(self._ra(wo, 30_000)["name"]).amount), 30_000)

    def test_the_limit_is_the_work_order_amount_once_paid_beyond_it(self):
        wo = self._wo(paid=118_000)
        with self.assertRaisesRegex(frappe.ValidationError, "₹1,00,000"):
            self._ra(wo, 100_001)

    def test_the_screen_is_told_the_limit_and_next_number(self):
        wo = self._wo_with_bills()
        state = get_generated_invoices(wo)
        self.assertEqual((state["left"], state["next_ra_number"], state["fully_paid"]), (30_000, 3, False))
        self.assertEqual([(r["ra_number"], r["status"]) for r in state["invoices"]],
                         [(2, "Voided"), (1, "Generated")])

    def test_an_amount_of_nothing_is_refused(self):
        wo = self._wo(paid=60_000)
        for amount in (0, -5, None):
            with self.assertRaises(frappe.ValidationError, msg=amount):
                self._ra(wo, amount)


class TestFinal(GeneratedInvoiceTestCase):
    def test_final_is_refused_until_the_work_order_is_fully_paid(self):
        wo = self._wo(paid=60_000)
        with self.assertRaisesRegex(frappe.ValidationError, "fully paid"):
            generate_invoice(wo, "FINAL")

    def test_final_bills_what_is_left_whatever_amount_is_sent(self):
        wo = self._wo(paid=100_000)
        self._ra(wo, 40_000)
        final = generate_invoice(wo, "FINAL", amount=1)
        stored = self._stored(final["name"])
        self.assertEqual((stored.invoice_type, flt(stored.amount), stored.ra_number), ("FINAL", 60_000, 2))
        self.assertTrue(stored.invoice_no.endswith(f"{wo[-5:]}-FINAL"))

    def test_nothing_is_generated_after_final(self):
        wo = self._wo(paid=100_000)
        self._ra(wo, 40_000)
        generate_invoice(wo, "FINAL")
        with self.assertRaisesRegex(frappe.ValidationError, "FINAL"):
            self._ra(wo, 1)
        with self.assertRaisesRegex(frappe.ValidationError, "FINAL"):
            generate_invoice(wo, "FINAL")
        self.assertTrue(get_generated_invoices(wo)["has_final"])

    def test_a_regenerated_final_prints_its_own_number(self):
        """A voided FINAL's number is never given again, so the next FINAL prints FINAL-2, and so on."""
        wo = self._wo(paid=100_000)
        first = generate_invoice(wo, "FINAL")
        void_invoice(first["name"], "Wrong date")
        second = generate_invoice(wo, "FINAL")
        void_invoice(second["name"], "Wrong amount")
        third = generate_invoice(wo, "FINAL")
        numbers = [self._stored(r["name"]).invoice_no for r in (first, second, third)]
        self.assertEqual([n.split(f"{wo[-5:]}-")[-1] for n in numbers], ["FINAL", "FINAL-2", "FINAL-3"])

    def test_a_voided_final_frees_the_work_order_again(self):
        wo = self._wo(paid=100_000)
        void_invoice(generate_invoice(wo, "FINAL")["name"], "Wrong date")
        self.assertEqual(self._stored(self._ra(wo, 1_000)["name"]).ra_number, 2)

    def test_final_with_nothing_left_is_refused(self):
        wo = self._wo(paid=100_000)
        self._vendor_invoice(wo, 100_000, "Approved")
        with self.assertRaisesRegex(frappe.ValidationError, "Nothing is left"):
            generate_invoice(wo, "FINAL")


class TestWhereAndWho(GeneratedInvoiceTestCase):
    def test_refused_on_a_gst_on_work_order_or_one_without_an_explicit_gst_off_flag(self):
        for gst in ("true", ""):
            wo = self._wo(paid=60_000, gst=gst)
            with self.assertRaisesRegex(frappe.ValidationError, "GST", msg=gst):
                self._ra(wo, 1_000)
            self.assertFalse(frappe.db.exists(GI, {"work_order": wo}))

    def test_refused_on_a_work_order_that_is_not_approved_or_has_no_nirmaan_gst(self):
        for fields, message in (({"status": "Amendment"}, "Approved"), ({"project_gst": ""}, "Nirmaan GST")):
            wo = self._wo(paid=60_000, **fields)
            with self.assertRaisesRegex(frappe.ValidationError, message):
                self._ra(wo, 1_000)

    def test_works_on_a_finalized_work_order(self):
        wo = self._wo(paid=60_000, is_finalized=1)
        self.assertEqual(self._ra(wo, 1_000)["ra_number"], 1)

    def test_an_accountant_may_not_generate_or_void(self):
        wo = self._wo(paid=60_000)
        name = self._ra(wo, 1_000)["name"]
        accountant = self._on_project(self._user(ACCOUNTANT))
        with self.assertRaises(frappe.PermissionError):
            self._as(accountant, self._ra, wo, 1_000)
        with self.assertRaises(frappe.PermissionError):
            self._as(accountant, void_invoice, name, "No")
        self.assertFalse(self._as(accountant, get_generated_invoices, wo)["can_generate"])
        self.assertEqual(frappe.db.count(GI, {"work_order": wo}), 1)
        self.assertEqual(self._stored(name).status, "Generated")

    def test_a_procurement_executive_generates_and_voids(self):
        wo = self._wo(paid=60_000)
        procurement = self._on_project(self._user(PROCUREMENT))
        self.assertTrue(self._as(procurement, get_generated_invoices, wo)["can_generate"])
        name = self._as(procurement, self._ra, wo, 1_000)["name"]
        self._as(procurement, void_invoice, name, "Vendor asked for a new date")
        self.assertEqual((self._stored(name).status, self._stored(name).void_reason),
                         ("Voided", "Vendor asked for a new date"))

    def test_a_user_who_cannot_see_the_work_order_is_refused(self):
        wo = self._wo(paid=60_000)
        procurement = self._user(PROCUREMENT)
        if not frappe.get_all("User Permission", filters={"user": procurement, "allow": "Projects"}, limit=1):
            self.skipTest("this procurement user is on every project")
        with self.assertRaises(frappe.PermissionError):
            self._as(procurement, self._ra, wo, 1_000)


class TestVoid(GeneratedInvoiceTestCase):
    def test_a_void_needs_a_reason(self):
        name = self._ra(self._wo(paid=60_000), 1_000)["name"]
        with self.assertRaisesRegex(frappe.ValidationError, "reason"):
            void_invoice(name, "  ")
        self.assertEqual(self._stored(name).status, "Generated")

    def test_only_an_invoice_not_yet_uploaded_is_voided(self):
        name = self._ra(self._wo(paid=60_000), 1_000)["name"]
        void_invoice(name, "Typo")
        with self.assertRaises(frappe.ValidationError):
            void_invoice(name, "Again")
        frappe.db.set_value(GI, name, "status", "Signed")
        with self.assertRaisesRegex(frappe.ValidationError, "Signed"):
            void_invoice(name, "After upload")


class TestNeverEdited(GeneratedInvoiceTestCase):
    def test_a_saved_change_to_its_figures_is_refused_even_for_administrator(self):
        name = self._ra(self._wo(paid=60_000), 1_000)["name"]
        for field, value in (("amount", 2_000), ("invoice_no", "INV-X"), ("ra_number", 9)):
            doc = frappe.get_doc(GI, name)
            doc.set(field, value)
            with self.assertRaisesRegex(frappe.ValidationError, "never edited", msg=field):
                doc.save()
        self.assertEqual(flt(self._stored(name).amount), 1_000)

    def test_it_is_made_only_by_generate_and_never_deleted(self):
        wo = self._wo(paid=60_000)
        with self.assertRaisesRegex(frappe.ValidationError, "Generate"):
            frappe.get_doc({"doctype": GI, "work_order": wo, "ra_number": 1, "invoice_type": "RA",
                            "amount": 1_000, "invoice_date": today(), "invoice_no": "INV-1"}).insert()
        name = self._ra(wo, 1_000)["name"]
        with self.assertRaisesRegex(frappe.ValidationError, "never deleted"):
            frappe.delete_doc(GI, name)
        self.assertTrue(frappe.db.exists(GI, name))


class TestPrint(GeneratedInvoiceTestCase):
    def _print(self, name):
        """The print's HTML, rendered inside a GET request as the WO page's download_pdf is: the format
        reads the vendor's bank account through a GET-only endpoint."""
        previous = getattr(frappe.local, "request", None)
        set_request(method="GET", path="/api/method/frappe.utils.print_format.download_pdf")
        try:
            return frappe.get_print(GI, name, print_format=api.PRINT_FORMAT, no_letterhead=1)
        finally:
            frappe.local.request = previous

    def test_the_print_shows_the_records_amount_and_number_titled_invoice(self):
        wo = self._wo(paid=60_000)
        record = self._ra(wo, 12_345.5)
        html = self._print(record["name"])
        self.assertIn(record["invoice_no"], html)
        self.assertIn("12,345.50", html)
        self.assertIn("RA-1", html)
        self.assertIn(">INVOICE<", html.replace(" ", ""))
        self.assertNotIn("TAX INVOICE", html)

    def test_changing_the_print_link_changes_nothing(self):
        record = self._ra(self._wo(paid=60_000), 12_345.5)
        plain = self._print(record["name"])
        frappe.local.form_dict.update({"custom_amount": "99999", "custom_ra_no": "42", "custom_invoice_type": "Full"})
        self.addCleanup(lambda: [frappe.local.form_dict.pop(k, None) for k in ("custom_amount", "custom_ra_no", "custom_invoice_type")])
        tampered = self._print(record["name"])
        self.assertEqual(tampered, plain)
        self.assertNotIn("99,999", tampered)

    def test_printing_from_desk_is_off(self):
        self.assertFalse([p.role for p in frappe.get_meta(GI).permissions if p.get("print")])
        self.assertTrue(frappe.db.get_value("Print Format", "SR Invoice", "disabled"))


SCAN = "/private/files/signed-copy.pdf"


class SignedUploadTestCase(GeneratedInvoiceTestCase):
    def _vi(self, name):
        return frappe.db.get_value(GI, name, "vendor_invoice")

    def _invoice(self, vi):
        return frappe.db.get_value("Vendor Invoices", vi, ["document_type", "document_name", "invoice_no",
                                                           "invoice_date", "invoice_amount", "invoice_base_amount",
                                                           "invoice_gst_amount", "invoice_attachment", "status"],
                                   as_dict=True)

    def _uploaded(self, wo, amount=10_000):
        record = self._ra(wo, amount)
        upload_signed_copy(record["name"], SCAN)
        return record["name"]


class TestSignedUpload(SignedUploadTestCase):
    def test_the_upload_marks_it_signed_and_creates_one_pending_vendor_invoice_for_its_figures(self):
        wo = self._wo(paid=60_000)
        record = self._ra(wo, 12_345.5, invoice_date="2026-10-21")

        row = upload_signed_copy(record["name"], SCAN)

        self.assertEqual(row["status"], "Signed")
        invoices = frappe.get_all("Vendor Invoices", filters={"document_name": wo}, pluck="name")
        self.assertEqual(invoices, [self._vi(record["name"])])
        vi = self._invoice(invoices[0])
        self.assertEqual(
            (vi.document_type, vi.document_name, vi.invoice_no, getdate(vi.invoice_date), flt(vi.invoice_amount),
             flt(vi.invoice_base_amount), flt(vi.invoice_gst_amount), vi.status),
            (SR, wo, record["invoice_no"], getdate("2026-10-21"), 12_345.5, 12_345.5, 0, "Pending"),
        )
        self.assertEqual(frappe.db.get_value("Nirmaan Attachments", vi.invoice_attachment, "attachment"), SCAN)
        self.assertEqual(frappe.db.get_value(GI, record["name"], "signed_attachment"), vi.invoice_attachment)

    def test_a_signed_invoice_still_counts_once_against_the_limit(self):
        wo = self._wo(paid=60_000)
        self._uploaded(wo, 10_000)
        self.assertEqual(get_generated_invoices(wo)["left"], 50_000)

    def test_it_cannot_be_uploaded_twice(self):
        wo = self._wo(paid=60_000)
        name = self._uploaded(wo)
        with self.assertRaisesRegex(frappe.ValidationError, "already uploaded"):
            upload_signed_copy(name, "/private/files/another.pdf")
        self.assertEqual(frappe.db.count("Vendor Invoices", {"document_name": wo}), 1)

    def test_a_voided_invoice_cannot_be_uploaded(self):
        name = self._ra(self._wo(paid=60_000), 1_000)["name"]
        void_invoice(name, "Typo")
        with self.assertRaisesRegex(frappe.ValidationError, "Voided"):
            upload_signed_copy(name, SCAN)

    def test_the_upload_needs_the_signed_copy(self):
        name = self._ra(self._wo(paid=60_000), 1_000)["name"]
        with self.assertRaisesRegex(frappe.ValidationError, "signed copy"):
            upload_signed_copy(name, "  ")
        self.assertEqual(self._stored(name).status, "Generated")

    def test_accountants_on_the_project_are_told(self):
        wo = self._wo(paid=60_000)
        accountant = self._on_project(self._user(ACCOUNTANT))
        self._uploaded(wo)
        notes = frappe.get_all("Nirmaan Notifications", filters={"docname": wo, "recipient": accountant},
                               fields=["event_id"])
        self.assertEqual([n.event_id for n in notes], ["wo_invoice:signed_uploaded"])

    def test_an_accountant_on_no_project_sees_every_project_and_is_told(self):
        restricted = frappe.get_all("User Permission", filters={"allow": "Projects"}, pluck="user", distinct=True)
        accountant = frappe.db.get_value("Nirmaan Users", {"role_profile": ACCOUNTANT, "name": ("not in", restricted or [""])})
        if not accountant:
            self.skipTest("every Accountant on this site is put on projects")
        wo = self._wo(paid=60_000)
        self._uploaded(wo)
        self.assertTrue(frappe.db.exists("Nirmaan Notifications", {"docname": wo, "recipient": accountant}))

    def test_an_accountant_put_only_on_other_projects_is_not_told(self):
        accountant = self._user(ACCOUNTANT)
        other = self.fx.project()
        frappe.db.commit()
        self._on_project(accountant, other)
        wo = self._wo(paid=60_000)
        self._uploaded(wo)
        self.assertFalse(frappe.db.exists("Nirmaan Notifications", {"docname": wo, "recipient": accountant}))

    def test_a_procurement_executive_uploads_and_an_accountant_may_not(self):
        wo = self._wo(paid=60_000)
        first, second = self._ra(wo, 1_000)["name"], self._ra(wo, 1_000)["name"]
        accountant = self._on_project(self._user(ACCOUNTANT))
        with self.assertRaises(frappe.PermissionError):
            self._as(accountant, upload_signed_copy, first, SCAN)
        self.assertEqual(self._stored(first).status, "Generated")

        procurement = self._on_project(self._user(PROCUREMENT))
        self.assertEqual(self._as(procurement, upload_signed_copy, second, SCAN)["status"], "Signed")


class TestTheUploadsVendorInvoiceIsFixed(SignedUploadTestCase):
    """The Vendor Invoice a signed upload creates carries the number and amount the vendor signed: nobody
    edits them, Admin included, and once rejected it stays rejected (its generated invoice is Voided)."""

    def _desk_save(self, user, vi, **changes):
        doc = frappe.get_doc("Vendor Invoices", vi)
        doc.update(changes)
        self._as(user, doc.save, ignore_permissions=True)

    def test_its_amount_number_and_date_are_never_changed(self):
        vi = self._vi(self._uploaded(self._wo(paid=60_000), 10_000))
        accountant = self._on_project(self._user(ACCOUNTANT))
        for user in (accountant, U):
            for changes in ({"invoice_amount": 9_000, "invoice_base_amount": 9_000}, {"invoice_no": "NEW-NO"},
                            {"invoice_date": "2026-01-01"}):
                with self.subTest(user=user, changes=changes):
                    with self.assertRaisesRegex(frappe.ValidationError, "signed copy of a generated invoice"):
                        self._desk_save(user, vi, **changes)
        self.assertEqual(flt(self._invoice(vi).invoice_amount), 10_000)

    def test_the_edit_dialog_is_refused_even_unchanged_so_the_signed_scan_stays(self):
        import json
        from nirmaan_stack.api.delivery_notes.update_invoice_data import update_invoice_data
        wo = self._wo(paid=60_000)
        vi = self._vi(self._uploaded(wo, 10_000))
        row = self._invoice(vi)
        res = update_invoice_data(docname=wo, isSR=True, invoice_id=vi, invoice_attachment="/private/files/other.pdf",
                                  invoice_data=json.dumps({"invoice_no": row.invoice_no, "date": str(row.invoice_date),
                                                           "amount": 10_000, "base_amount": 10_000, "gst_amount": 0}))
        self.assertEqual(res["status"], 400, res)
        self.assertIn("signed copy of a generated invoice", res["message"])
        self.assertEqual(frappe.db.get_value("Nirmaan Attachments", row.invoice_attachment, "attachment"), SCAN)

    def test_a_rejected_one_stays_rejected(self):
        wo = self._wo(paid=60_000)
        name = self._uploaded(wo, 10_000)
        vi = self._vi(name)
        approve_vendor_invoice(vi, "Rejected", "Signature missing")
        for status in ("Pending", "Approved"):
            with self.subTest(status=status):
                with self.assertRaisesRegex(frappe.ValidationError, "Voided"):
                    self._desk_save(U, vi, status=status)
        self.assertEqual((self._invoice(vi).status, self._stored(name).status), ("Rejected", "Voided"))

    def test_the_upload_is_refused_once_the_work_order_is_gst_on(self):
        wo = self._wo(paid=60_000)
        name = self._ra(wo, 1_000)["name"]
        frappe.db.set_value(SR, wo, "gst", "true")
        frappe.db.commit()
        with self.assertRaisesRegex(frappe.ValidationError, "GST-off"):
            upload_signed_copy(name, SCAN)
        self.assertEqual(self._stored(name).status, "Generated")
        self.assertEqual(frappe.db.count("Vendor Invoices", {"document_name": wo}), 0)


class TestApprovalMovesIt(SignedUploadTestCase):
    def _decide(self, name, action, reason=None):
        """Decide its Vendor Invoice the normal way, as an Accountant on the project."""
        if not getattr(self, "_accountant", None):
            self._accountant = self._on_project(self._user(ACCOUNTANT))
        result = self._as(self._accountant, approve_vendor_invoice, self._vi(name), action, reason)
        self.assertEqual(result["status"], 200, result)
        return result

    def test_approving_its_vendor_invoice_marks_it_approved_and_it_is_invoiced(self):
        wo = self._wo(paid=60_000)
        name = self._uploaded(wo, 10_000)
        self._decide(name, "Approved")
        self.assertEqual(self._stored(name).status, "Approved")
        self.assertEqual(flt(frappe.db.get_value(SR, wo, "amount_invoiced")), 10_000)
        self.assertEqual(get_generated_invoices(wo)["left"], 50_000)

    def test_rejecting_its_vendor_invoice_voids_it_frees_its_amount_and_the_next_gets_a_new_ra(self):
        wo = self._wo(paid=60_000)
        name = self._uploaded(wo, 10_000)
        self._decide(name, "Rejected", "Signature missing")
        stored = self._stored(name)
        self.assertEqual(stored.status, "Voided")
        self.assertIn("Signature missing", stored.void_reason)
        self.assertEqual(get_generated_invoices(wo)["left"], 60_000)
        self.assertEqual(self._ra(wo, 1_000)["ra_number"], 2)

    def test_rejecting_it_after_approval_voids_it_too(self):
        wo = self._wo(paid=60_000)
        name = self._uploaded(wo, 10_000)
        self._decide(name, "Approved")
        self._decide(name, "Rejected", "Wrong period")
        self.assertEqual(self._stored(name).status, "Voided")
        self.assertEqual(flt(frappe.db.get_value(SR, wo, "amount_invoiced")), 0)

    def test_its_vendor_invoice_cannot_be_deleted(self):
        wo = self._wo(paid=60_000)
        name = self._uploaded(wo)
        vi = self._vi(name)
        result = delete_invoice_entry(wo, isSR=True, invoice_id=vi)
        self.assertNotEqual(result["status"], 200)
        self.assertIn("Reject", result["message"])
        self.assertTrue(frappe.db.exists("Vendor Invoices", vi))
        with self.assertRaisesRegex(frappe.ValidationError, "Reject"):
            frappe.delete_doc("Vendor Invoices", vi, force=True)
        self.assertEqual(self._stored(name).status, "Signed")
