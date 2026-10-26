# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The TDS preview, as a Procurement Executive requesting a Work Order payment sees it (#1541, spec #1528
stories 55-61).

The server answers the forecast with the rule approval uses: the vendor's rate today
(`payment_tds.vendor_rate`), the company-borne category rule (`payment_tds.is_company_borne`), the tax
rounded as `record_deduction` rounds it, on the amount the request will store (rounded to the rupee by
`create_payment_request_for_service`). Nothing is written before approval.

⚠️ RUNS AGAINST THE SITE DATABASE. Everything is `TEST-TWO-*`, purged by `TaxedWorkOrderFixture`; the
user is created and deleted here.
"""

import json
from unittest.mock import patch

import frappe
from frappe.utils import flt

from nirmaan_stack.api.payments.project_payments import create_payment_request_for_service
from nirmaan_stack.api.payments.tds_forecast import forecast_payments_tds, forecast_work_order_tds
from nirmaan_stack.api.payments.work_order_tds import get_work_order_tds
from nirmaan_stack.services import payment_tds
from nirmaan_stack.services.test_tds_borne_by import MISC, MISC_AND_ELECTRICAL, BorneByFixture

PAYMENT = "Project Payments"
SR = "Service Requests"
PROCUREMENT = "Nirmaan Procurement Executive"
CONTROLLER = "nirmaan_stack.integrations.controllers.project_payments"


class ProcurementFixture(BorneByFixture):
    def setUp(self):
        super().setUp()
        self.email = f"test-1541-tds-{frappe.generate_hash(length=6)}@example.com"
        frappe.get_doc({
            "doctype": "User", "email": self.email, "first_name": "TDS Preview", "send_welcome_email": 0,
            "roles": [{"role": PROCUREMENT}],
        }).insert(ignore_permissions=True)
        frappe.db.commit()
        self.addCleanup(self._drop_user)
        # A new request notifies every real admin on the live site -- keep it off.
        for target in ("_notify_admins_auto_approved", "get_admin_users"):
            quiet = patch(f"{CONTROLLER}.{target}", return_value=[])
            quiet.start()
            self.addCleanup(quiet.stop)

    def _drop_user(self):
        frappe.set_user("Administrator")
        frappe.db.rollback()
        frappe.db.delete("User Permission", {"user": self.email})
        frappe.delete_doc("User", self.email, force=True, ignore_permissions=True)
        for contact in frappe.get_all("Contact", {"email_id": self.email}, pluck="name"):
            frappe.delete_doc("Contact", contact, force=True, ignore_permissions=True)
        frappe.db.commit()

    def _as_procurement(self, fn, *args, **kwargs):
        frappe.set_user(self.email)
        try:
            return fn(*args, **kwargs)
        finally:
            frappe.set_user("Administrator")

    def _plant(self, wo, amount, status, gst=False):
        """A payment already waiting on the Work Order, as the request endpoint leaves it."""
        name = self.fx._name("PAY")
        frappe.db.sql(
            """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner, docstatus,
                   idx, project, vendor, amount, status, document_type, document_name, is_gst_payment)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s, %s)""",
            (name, "Administrator", "Administrator", self.project, self.vendor, flt(amount), status, SR, wo,
             1 if gst else 0),
        )
        self.fx.payments.append(name)
        frappe.db.commit()
        return name


class TestTheRequestDialogForecast(ProcurementFixture):
    def _forecast(self, wo, amount, **kwargs):
        return self._as_procurement(forecast_work_order_tds, wo, amount, **kwargs)

    def test_a_vendor_borne_payment_is_cut_by_the_tax(self):
        answer = self._forecast(self._wo(MISC_AND_ELECTRICAL), 20000)
        self.assertEqual(answer["forecast"], {"rate": 2.0, "tds": 400.0, "vendor_gets": 19600.0, "borne_by": "Vendor"})

    def test_ten_thousand_at_two_percent(self):
        """The ticket's worked case: 200 tax, the vendor gets 9,800; on Misc / Transport 10,000 and 200 on top."""
        self.assertEqual(
            self._forecast(self._wo(MISC_AND_ELECTRICAL), 10000)["forecast"],
            {"rate": 2.0, "tds": 200.0, "vendor_gets": 9800.0, "borne_by": "Vendor"},
        )
        self.assertEqual(
            self._forecast(self._wo(MISC), 10000)["forecast"],
            {"rate": 2.0, "tds": 200.0, "vendor_gets": 10000.0, "borne_by": "Company"},
        )

    def test_a_gst_payment_has_no_forecast(self):
        self.assertIsNone(self._forecast(self._wo(MISC_AND_ELECTRICAL), 10000, is_gst_payment=1)["forecast"])

    def test_the_tax_is_taken_on_the_rounded_amount_the_request_stores(self):
        """9,999.60 is stored as 10,000, and approval taxes the stored figure: 200, not 199.99."""
        forecast = self._forecast(self._wo(MISC_AND_ELECTRICAL), 9999.6)["forecast"]
        self.assertEqual((forecast["tds"], forecast["vendor_gets"]), (200.0, 9800.0))

    def test_the_vendors_rate_today_is_used(self):
        wo = self._wo(MISC_AND_ELECTRICAL)
        frappe.db.set_value("Vendors", self.vendor, "tds_deduction_percentage", 1)
        frappe.db.commit()
        self.assertEqual(self._forecast(wo, 10000)["forecast"]["tds"], 100.0)

    def test_a_vendor_with_no_rate_has_no_forecast(self):
        wo = self._wo(MISC_AND_ELECTRICAL)
        frappe.db.set_value("Vendors", self.vendor, "tds_deduction_percentage", 0)
        frappe.db.commit()
        self.assertIsNone(self._forecast(wo, 10000)["forecast"])

    def test_under_fifteen_thousand_the_tax_is_cut_now(self):
        """Below the auto-approve line the request is approved, and taxed, the moment it is made."""
        wo = self._wo(MISC_AND_ELECTRICAL)
        self.assertTrue(self._forecast(wo, 10000)["cut_now"])
        self.assertFalse(self._forecast(wo, 20000)["cut_now"])

    def test_a_user_who_cannot_read_the_work_order_is_refused(self):
        wo = self._wo(MISC)
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                forecast_work_order_tds(wo, 10000)
        finally:
            frappe.set_user("Administrator")


class TestNoDeductionBeforeApproval(ProcurementFixture):
    def test_a_request_left_at_requested_creates_no_deduction(self):
        wo = self._wo(MISC_AND_ELECTRICAL)
        name = json.loads(self._as_procurement(
            create_payment_request_for_service, json.dumps({"doctype": SR, "docname": wo, "amount": 20000})
        ))["name"]
        self.fx.payments.append(name)
        frappe.db.commit()

        payment = frappe.db.get_value(PAYMENT, name, ["status", "amount"], as_dict=True)
        self.assertEqual((payment.status, flt(payment.amount)), ("Requested", 20000.0))
        self.assertIsNone(payment_tds.existing_deduction(name))
        # And the page's preview for it is there, worked out by the server.
        forecasts = self._as_procurement(get_work_order_tds, wo)["forecasts"]
        self.assertEqual(forecasts[name], {"rate": 2.0, "tds": 400.0, "vendor_gets": 19600.0, "borne_by": "Vendor"})


class TestTheWorkOrderTableForecasts(ProcurementFixture):
    def test_each_waiting_payment_carries_its_forecast(self):
        wo = self._wo(MISC_AND_ELECTRICAL)
        requested = self._plant(wo, 20000, "Requested")
        ceo_pending = self._plant(wo, 60000, "CEO Pending")

        forecasts = self._as_procurement(get_work_order_tds, wo)["forecasts"]

        self.assertEqual(forecasts, {
            requested: {"rate": 2.0, "tds": 400.0, "vendor_gets": 19600.0, "borne_by": "Vendor"},
            ceo_pending: {"rate": 2.0, "tds": 1200.0, "vendor_gets": 58800.0, "borne_by": "Vendor"},
        })

    def test_a_kept_whole_work_orders_waiting_payment_reads_company(self):
        wo = self._wo(MISC)
        requested = self._plant(wo, 20000, "Requested")
        self.assertEqual(
            self._as_procurement(get_work_order_tds, wo)["forecasts"][requested],
            {"rate": 2.0, "tds": 400.0, "vendor_gets": 20000.0, "borne_by": "Company"},
        )

    def test_approved_rejected_and_gst_payments_have_no_forecast(self):
        """An approved payment carries its real deduction (`payments`); a rejected one is not waiting;
        a GST payment is never taxed."""
        wo = self._wo(MISC_AND_ELECTRICAL)
        approved = self._approve(wo, 10000)
        self._plant(wo, 20000, "Rejected")
        self._plant(wo, 1800, "Requested", gst=True)

        answer = self._as_procurement(get_work_order_tds, wo)

        self.assertEqual(answer["forecasts"], {})
        self.assertIn(approved.name, answer["payments"])


class TestReqAmountIsTheFullBill(ProcurementFixture):
    """All Payments and the accountant tabs: "Req. Amount" is the full bill whatever the status (owner
    ruling X4-A); an approved payment's stored amount is already cut, so its withheld tax is added back."""

    def _queue_row(self, name):
        from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue

        rows = get_approval_queue(filters=[["name", "=", name]], limit_page_length=5)["data"]
        self.assertEqual(len(rows), 1)
        return rows[0]

    def test_an_approved_vendor_borne_payment_reads_the_full_bill(self):
        made = self._approve(self._wo(MISC_AND_ELECTRICAL), 10000)
        row = self._queue_row(made.name)
        self.assertEqual((row["requested_amount"], row["amount"]), (10000.0, 9800.0))

    def test_a_kept_whole_payment_and_a_waiting_one_read_their_amount(self):
        kept_whole = self._approve(self._wo(MISC), 10000)
        waiting = self._plant(self._wo(MISC_AND_ELECTRICAL), 20000, "Requested")
        self.assertEqual(self._queue_row(kept_whole.name)["requested_amount"], 10000.0)
        self.assertEqual(self._queue_row(waiting)["requested_amount"], 20000.0)


class TestReqAmountAfterTdsPaidByCompany(ProcurementFixture):
    """Walk W5 (story 60): a payment whose tax was cut and then marked *TDS paid by company* before it was
    Paid keeps every figure (story 46), so it still reads its full bill under "Req. Amount": the deduction's
    gross, not the stored amount."""

    def test_its_req_amount_is_the_deductions_gross(self):
        from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue

        made = self._approve(self._wo(MISC_AND_ELECTRICAL), 10000)
        payment_tds.mark_tds_paid_by_company(made.name)
        frappe.db.commit()
        [row] = get_approval_queue(filters=[["name", "=", made.name]], limit_page_length=5)["data"]
        self.assertEqual((row["requested_amount"], row["amount"]), (10000.0, 9800.0))
        figures = get_work_order_tds(made.service_request)["payments"][made.name]
        self.assertEqual((figures["borne_by"], figures["requested_amount"]), ("Company", 10000.0))


class TestReqAmountSortsAndFilters(ProcurementFixture):
    """The "Req. Amount" column (id `amount`) sorts and filters on the full bill it shows (story 60)."""

    def _queue(self, names, **kwargs):
        from nirmaan_stack.api.approvals.get_approval_queue import get_approval_queue

        filters = [["name", "in", names], *kwargs.pop("filters", [])]
        return [r["name"] for r in get_approval_queue(filters=filters, limit_page_length=5, **kwargs)["data"]]

    def test_a_cut_payment_sorts_and_filters_at_its_full_bill(self):
        cut = self._approve(self._wo(MISC_AND_ELECTRICAL), 10000).name   # stored 9,800
        waiting = self._plant(self._wo(MISC_AND_ELECTRICAL), 9900, "Requested")
        self.assertEqual(self._queue([cut, waiting], order_by="amount desc"), [cut, waiting])
        self.assertEqual(self._queue([cut, waiting], filters=[["amount", ">=", 9950]]), [cut])


class TestTheApproveDialogsForecast(ProcurementFixture):
    """The approve dialogs read each payment's forecast from the server too (spec #1528 story 59): the
    vendor's rate today and the category rule, on the stored amount or a partial approval's figure."""

    def _ask(self, *asks):
        return forecast_payments_tds(json.dumps(list(asks)))["forecasts"]

    def test_each_payment_is_forecast_on_its_stored_amount(self):
        wo, kept_whole = self._wo(MISC_AND_ELECTRICAL), self._wo(MISC)
        withheld = self._plant(wo, 20000, "Requested")
        on_top = self._plant(kept_whole, 60000, "CEO Pending")
        self.assertEqual(self._ask({"name": withheld}, {"name": on_top}), {
            withheld: {"rate": 2.0, "tds": 400.0, "vendor_gets": 19600.0, "borne_by": "Vendor"},
            on_top: {"rate": 2.0, "tds": 1200.0, "vendor_gets": 60000.0, "borne_by": "Company"},
        })

    def test_a_partial_approval_is_forecast_on_the_figure_typed(self):
        pay = self._plant(self._wo(MISC_AND_ELECTRICAL), 60000, "CEO Pending")
        self.assertEqual(self._ask({"name": pay, "amount": 40000})[pay]["tds"], 800.0)

    def test_the_rate_is_the_vendors_today(self):
        pay = self._plant(self._wo(MISC_AND_ELECTRICAL), 20000, "Requested")
        frappe.db.set_value("Vendors", self.vendor, "tds_deduction_percentage", 1)
        frappe.db.commit()
        self.assertEqual(self._ask({"name": pay})[pay]["tds"], 200.0)

    def test_gst_approved_and_unknown_payments_have_none(self):
        wo = self._wo(MISC_AND_ELECTRICAL)
        gst = self._plant(wo, 1800, "Requested", gst=True)
        approved = self._approve(wo, 10000)
        self.assertEqual(self._ask({"name": gst}, {"name": approved.name}, {"name": "PE-NOT-A-PAYMENT"}), {})

    def test_a_user_who_cannot_read_the_payments_gets_none(self):
        pay = self._plant(self._wo(MISC_AND_ELECTRICAL), 20000, "Requested")
        frappe.set_user("Guest")
        try:
            with self.assertRaises(frappe.PermissionError):
                self._ask({"name": pay})
        finally:
            frappe.set_user("Administrator")
