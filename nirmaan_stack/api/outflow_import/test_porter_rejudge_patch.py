# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# For license information, please see license.txt

"""The one-time patch that re-judges Failed Porter Invoices under the fare-and-date rule (#1562, spec #1554).

    devenv.sh test --module nirmaan_stack.api.outflow_import.test_porter_rejudge_patch

Each test uploads and validates the synthetic statement (`test_porter_validation`), then puts invoices
back the way the old rule left them -- Failed on a GSTIN alone, or on the fare -- and runs the patch on
those invoices only. ⚠️ It calls `rejudge(invoices=...)`, never `execute()`, which would re-judge every
Failed Porter Invoice on the site.
"""

from unittest.mock import patch

import frappe

from nirmaan_stack.api.outflow_import.test_porter_create import PorterCreateCase
from nirmaan_stack.api.outflow_import.test_porter_import import INVOICE_DOCTYPE
from nirmaan_stack.patches.v3_0.rejudge_failed_porter_invoices import rejudge


class RejudgeCase(PorterCreateCase):
    def setUp(self):
        super().setUp()
        self._run_job()
        self.gstin_only = self.numbers["29SS27A0900001"]
        self.fare = self.numbers["36SM27A0900004"]

    def _failed_by_the_old_rule(self):
        """What the rule before #1559 left: Failed on a customer GSTIN the PDF read differently, and
        Failed on a fare Rs 5 out. Raw, as the old validation job wrote it."""
        self._failed_on_the_gstin()
        fare = frappe.db.get_value(INVOICE_DOCTYPE, self.fare, "fare_total")
        frappe.db.set_value(
            INVOICE_DOCTYPE,
            self.fare,
            {
                "validation_status": "Failed",
                "validation_message": f"Invoice {self.fare} disagrees with the statement. Fare.",
                "read_fare": float(fare) + 5,
            },
            update_modified=False,
        )

    def _failed_on_the_gstin(self):
        frappe.db.set_value(
            INVOICE_DOCTYPE,
            self.gstin_only,
            {
                "validation_status": "Failed",
                "validation_message": f"Invoice {self.gstin_only} disagrees with the statement. Customer GSTIN.",
                "read_receiver_gstin": "29AAACN9999X1Z9",
            },
            update_modified=False,
        )

    def _shown(self, name):
        return next(i for i in self._status()["invoices"] if i["name"] == name)


class TestRejudgingAnImportNotCreated(RejudgeCase):
    def setUp(self):
        super().setUp()
        self._failed_by_the_old_rule()
        self.assertEqual(self._status()["state"], "Validation failed")
        with patch("nirmaan_stack.api.outflow_import.porter_validation.fetch_invoice_pdf") as download:
            rejudge(invoices=[self.gstin_only, self.fare])
        self.download = download

    def test_a_gstin_only_failure_passes_with_a_warning_without_a_download(self):
        shown = self._shown(self.gstin_only)
        self.assertEqual((shown["validation_status"], shown["validation_message"]), ("Passed", None))
        self.assertEqual(
            shown["warnings"],
            [{"figure": "Customer GSTIN", "statement": shown["customer_gstin"], "read": "29AAACN9999X1Z9"}],
        )
        self.download.assert_not_called()

    def test_a_fare_failure_stays_failed_under_the_new_wording(self):
        shown = self._shown(self.fare)
        self.assertEqual(shown["validation_status"], "Failed")
        self.assertRegex(shown["validation_message"], rf"^Invoice {self.fare} disagrees with the statement\. Fare: ")

    def test_the_import_stays_blocked_by_the_fare_failure_alone(self):
        status = self._status()
        self.assertEqual(status["state"], "Validation failed")
        self.assertEqual(status["progress"]["check"]["not_matching"], 1)


class TestAGstinOnlyFailureAloneUnblocksTheImport(RejudgeCase):
    def test_the_import_is_validated_after_the_patch(self):
        self._failed_on_the_gstin()
        self.assertEqual(self._status()["state"], "Validation failed")
        rejudge(invoices=[self.gstin_only])
        self.assertEqual(self._status()["state"], "Validated")


class TestAnImportAlreadyCreatedIsLeftAlone(RejudgeCase):
    def test_its_failed_invoice_is_not_touched(self):
        self._press_create()
        self._run_create()
        self._failed_by_the_old_rule()
        before = frappe.db.get_value(
            INVOICE_DOCTYPE, self.gstin_only, ["validation_status", "validation_message"], as_dict=True
        )
        rejudge(invoices=[self.gstin_only, self.fare])
        after = frappe.db.get_value(
            INVOICE_DOCTYPE, self.gstin_only, ["validation_status", "validation_message"], as_dict=True
        )
        self.assertEqual(after, before)
        self.assertEqual(frappe.db.get_value(INVOICE_DOCTYPE, self.fare, "validation_status"), "Failed")
