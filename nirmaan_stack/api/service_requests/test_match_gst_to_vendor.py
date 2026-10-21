# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Match GST to vendor and the GST mismatch list (#1538, ADR-0028 Amendment A; GLOSSARY *Match GST to
vendor*), and the GST payment guard it meets (ADR-0030 decision 6, #1343).

Run:  DEVENV test --module nirmaan_stack.api.service_requests.test_match_gst_to_vendor

⚠️ RUNS AGAINST THE SITE DATABASE. Rows are planted with the GST Hold fixture (`TEST-GSTH-*`) and
purged after each test; `match_gst_to_vendor` commits, so a rollback alone would not clean up.
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt

from nirmaan_stack.api.service_requests.match_gst_to_vendor import (
    get_gst_mismatch_work_orders,
    match_gst_to_vendor,
    preview_match_gst_to_vendor,
)
from nirmaan_stack.api.vendor.test_gst_hold import U, _Fixture

SR = "Service Requests"
GSTIN = "29AADCU7527Q1ZG"


class MatchGstTestCase(FrappeTestCase):
    def setUp(self):
        super().setUp()
        frappe.set_user(U)
        self.addCleanup(frappe.set_user, U)
        self.fx = _Fixture()
        self.addCleanup(self.fx.purge)
        # Cleanups run LIFO: these run before the purge, so its commit keeps none of them.
        self.addCleanup(lambda: frappe.db.delete("Project Payments", {"document_name": ("in", self.fx.srs)}))
        self.addCleanup(lambda: frappe.db.delete("Nirmaan Comments", {"reference_name": ("in", self.fx.srs)}))
        self.project = self.fx.project()
        self.gst_vendor = self.fx.vendor(gst_number=GSTIN)
        self.no_gst_vendor = self.fx.vendor()

    def _wo(self, vendor, *, gst, amount=100_000, paid=0, **fields):
        wo = self.fx.work_order(self.project, vendor, amount, gst=gst)
        total = flt(frappe.db.get_value(SR, wo, "total_amount"))
        frappe.db.set_value(SR, wo, {"amount_paid": paid, "amount_due": total - paid, **fields})
        return wo

    def _pay(self, wo, vendor, *, gst_payment, status="Approved"):
        doc = frappe.new_doc("Project Payments")
        doc.update({
            "document_type": SR, "document_name": wo, "project": self.project, "vendor": vendor,
            "amount": 1_000, "status": status, "is_gst_payment": 1 if gst_payment else 0,
        })
        doc.name = f"TEST-GSTH-PAY-{frappe.generate_hash(length=8)}"
        doc.db_insert()  # no payment hooks: only the row's existence matters here
        return doc.name

    def _user(self, profile):
        user = frappe.db.get_value("Nirmaan Users", {"role_profile": profile}, "name")
        if not user:
            self.skipTest(f"no {profile} user on this site")
        return user

    def _state(self, wo):
        row = frappe.db.get_value(SR, wo, ["gst", "total_amount", "amount_due"], as_dict=True)
        return row.gst, flt(row.total_amount), flt(row.amount_due)


class TestPreview(MatchGstTestCase):
    def test_shows_the_new_total_and_amount_due_and_changes_nothing(self):
        wo = self._wo(self.gst_vendor, gst="false", paid=60_000)
        preview = preview_match_gst_to_vendor(wo)
        self.assertEqual(
            (preview["gst"], preview["target_gst"], preview["total_before"], preview["total_after"],
             preview["amount_paid"], preview["amount_due_before"], preview["amount_due_after"]),
            ("false", "true", 100_000, 118_000, 60_000, 40_000, 58_000),
        )
        self.assertFalse(preview["matches"])
        self.assertEqual(self._state(wo), ("false", 100_000, 40_000))

    def test_names_the_gst_payments_that_block_turning_off(self):
        wo = self._wo(self.no_gst_vendor, gst="true")
        gst_payment = self._pay(wo, self.no_gst_vendor, gst_payment=True, status="Rejected")
        self._pay(wo, self.no_gst_vendor, gst_payment=False)
        self.assertEqual(preview_match_gst_to_vendor(wo)["blocked_by"], [gst_payment])

    def test_a_work_order_that_already_matches_says_so(self):
        preview = preview_match_gst_to_vendor(self._wo(self.gst_vendor, gst="true"))
        self.assertTrue(preview["matches"])
        self.assertEqual(preview["total_after"], preview["total_before"])


class TestMatch(MatchGstTestCase):
    def test_turns_gst_on_for_a_vendor_with_a_gst_number(self):
        wo = self._wo(self.gst_vendor, gst="false", paid=60_000)
        result = match_gst_to_vendor(wo)
        self.assertEqual(self._state(wo), ("true", 118_000, 58_000))
        self.assertEqual((result["gst"], result["total_after"], result["amount_due_after"]), ("true", 118_000, 58_000))

    def test_turns_gst_off_for_a_vendor_without_one(self):
        wo = self._wo(self.no_gst_vendor, gst="true", paid=10_000)
        match_gst_to_vendor(wo)
        self.assertEqual(self._state(wo), ("false", 100_000, 90_000))

    def test_works_on_a_finalized_work_order(self):
        wo = self._wo(self.gst_vendor, gst="false", is_finalized=1)
        match_gst_to_vendor(wo)
        self.assertEqual(self._state(wo)[0], "true")

    def test_is_recorded_on_the_work_order(self):
        wo = self._wo(self.gst_vendor, gst="false", paid=60_000)
        match_gst_to_vendor(wo)
        remarks = frappe.get_all(
            "Nirmaan Comments",
            filters={"reference_doctype": SR, "reference_name": wo, "is_system_generated": 1},
            fields=["content", "comment_by"],
        )
        self.assertEqual(len(remarks), 1)
        self.assertEqual(remarks[0].comment_by, U)
        for figure in ("Match GST to vendor", "ON", "₹1,00,000", "₹1,18,000", "₹40,000", "₹58,000"):
            self.assertIn(figure, remarks[0].content)

    def test_a_work_order_that_already_matches_is_refused(self):
        wo = self._wo(self.gst_vendor, gst="true")
        with self.assertRaisesRegex(frappe.ValidationError, "already matches"):
            match_gst_to_vendor(wo)

    def test_a_work_order_not_approved_is_refused(self):
        wo = self._wo(self.gst_vendor, gst="false", status="Amendment")
        with self.assertRaisesRegex(frappe.ValidationError, "Amendment"):
            match_gst_to_vendor(wo)
        self.assertEqual(self._state(wo)[0], "false")

    def test_an_accountant_may_match(self):
        wo = self._wo(self.gst_vendor, gst="false")
        frappe.set_user(self._user("Nirmaan Accountant Profile"))
        match_gst_to_vendor(wo)
        frappe.set_user(U)
        self.assertEqual(self._state(wo)[0], "true")

    def test_other_roles_are_refused(self):
        wo = self._wo(self.gst_vendor, gst="false")
        for profile in ("Nirmaan Project Manager Profile", "Nirmaan Procurement Executive Profile",
                        "Nirmaan PMO Executive Profile"):
            user = frappe.db.get_value("Nirmaan Users", {"role_profile": profile}, "name")
            if not user:
                continue
            frappe.set_user(user)
            for call in (match_gst_to_vendor, preview_match_gst_to_vendor):
                with self.assertRaises(frappe.PermissionError, msg=f"{profile} {call.__name__}"):
                    call(wo)
            with self.assertRaises(frappe.PermissionError):
                get_gst_mismatch_work_orders()
            frappe.set_user(U)
        self.assertEqual(self._state(wo)[0], "false")


class TestGstPaymentGuard(MatchGstTestCase):
    """GST can't go off while a GST payment exists, at any status, Rejected included, until deleted."""

    def test_off_is_refused_and_names_every_gst_payment(self):
        wo = self._wo(self.no_gst_vendor, gst="true")
        paid = self._pay(wo, self.no_gst_vendor, gst_payment=True, status="Paid")
        rejected = self._pay(wo, self.no_gst_vendor, gst_payment=True, status="Rejected")
        base = self._pay(wo, self.no_gst_vendor, gst_payment=False)

        with self.assertRaises(frappe.ValidationError) as cm:
            match_gst_to_vendor(wo)
        message = str(cm.exception)
        self.assertIn(paid, message)
        self.assertIn(rejected, message)
        self.assertNotIn(base, message)
        self.assertEqual(self._state(wo)[0], "true")

    def test_off_with_only_base_payments_works(self):
        wo = self._wo(self.no_gst_vendor, gst="true")
        self._pay(wo, self.no_gst_vendor, gst_payment=False, status="Paid")
        match_gst_to_vendor(wo)
        self.assertEqual(self._state(wo)[:2], ("false", 100_000))

    def test_off_works_once_the_gst_payment_is_deleted(self):
        wo = self._wo(self.no_gst_vendor, gst="true")
        frappe.db.delete("Project Payments", {"name": self._pay(wo, self.no_gst_vendor, gst_payment=True)})
        match_gst_to_vendor(wo)
        self.assertEqual(self._state(wo)[0], "false")

    def test_on_is_never_refused(self):
        wo = self._wo(self.gst_vendor, gst="false")
        self._pay(wo, self.gst_vendor, gst_payment=True)
        match_gst_to_vendor(wo)
        self.assertEqual(self._state(wo)[:2], ("true", 118_000))


class TestMismatchList(MatchGstTestCase):
    def _listed(self):
        return {row["name"]: row for row in get_gst_mismatch_work_orders() if row["name"] in self.fx.srs}

    def test_lists_both_directions_and_nothing_that_matches(self):
        off_for_gst_vendor = self._wo(self.gst_vendor, gst="false")
        on_for_no_gst_vendor = self._wo(self.no_gst_vendor, gst="true")
        self._wo(self.gst_vendor, gst="true")
        self._wo(self.no_gst_vendor, gst="false")

        listed = self._listed()
        self.assertEqual(set(listed), {off_for_gst_vendor, on_for_no_gst_vendor})
        self.assertEqual(listed[off_for_gst_vendor]["target_gst"], "true")
        self.assertEqual(listed[on_for_no_gst_vendor]["target_gst"], "false")

    def test_a_blank_gst_number_counts_as_none(self):
        wo = self._wo(self.fx.vendor(gst_number="   "), gst="true")
        self.assertIn(wo, self._listed())

    def test_lists_finalized_work_orders_and_only_approved_ones(self):
        finalized = self._wo(self.gst_vendor, gst="false", is_finalized=1)
        self._wo(self.gst_vendor, gst="false", status="Amendment")
        self._wo(self.gst_vendor, gst="false", status="Vendor Selected")
        self.assertEqual(set(self._listed()), {finalized})

    def test_counts_the_gst_payments_in_the_way(self):
        wo = self._wo(self.no_gst_vendor, gst="true")
        self._pay(wo, self.no_gst_vendor, gst_payment=True)
        self.assertEqual(self._listed()[wo]["gst_payments"], 1)

    def test_a_matched_work_order_leaves_the_list(self):
        wo = self._wo(self.gst_vendor, gst="false")
        match_gst_to_vendor(wo)
        self.assertNotIn(wo, self._listed())
