# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Financials -> Project Ledger: the customer receivable ledger narrowed to one project.

Fixtures are raw inserts (`db_insert`, no hooks) on scratch projects, never committed, rolled back
and then purged by name prefix in `tearDownClass`.
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.api.projects.project_ledger import get_project_ledger_data


def _raw(doctype, **fields):
    """Insert a row with only the given fields, skipping every hook and validation."""
    doc = frappe.new_doc(doctype)
    doc.update(fields)
    doc.name = f"TEST-PLEDGER-{frappe.generate_hash(length=10)}"
    doc.db_insert()
    return doc.name


class TestProjectLedger(FrappeTestCase):
    """Project P has, out of date order on purpose:

    - an invoice of 1,000 on 10-Feb (customer X);
    - an advance inflow of 400 on 05-Jan (customer X);
    - an undated inflow of 250 created 01-Mar, booked to customer Y (the project's customer changed);
    - two same-day invoices on 20-Feb (300 created first, 200 second).

    Project Q has an invoice of 9,999 that must not leak into P's ledger.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.P = _raw("Projects", project_name="TEST-PLEDGER-P", status="WIP")
        cls.Q = _raw("Projects", project_name="TEST-PLEDGER-Q", status="WIP")
        cls.inv = _raw("Project Invoices", project=cls.P, customer="X", invoice_no="INV-1",
                       invoice_date="2026-02-10", amount=1000, creation="2026-02-10 09:00:00")
        cls.adv = _raw("Project Inflows", project=cls.P, customer="X", utr="UTR-ADV",
                       payment_date="2026-01-05", amount=400, creation="2026-01-05 09:00:00")
        cls.undated = _raw("Project Inflows", project=cls.P, customer="Y", utr="UTR-NODATE",
                           amount=250, creation="2026-03-01 11:00:00")
        cls.second = _raw("Project Invoices", project=cls.P, customer="X", invoice_no="INV-3",
                          invoice_date="2026-02-20", amount=200, creation="2026-02-20 12:00:00")
        cls.first = _raw("Project Invoices", project=cls.P, customer="X", invoice_no="INV-2",
                         invoice_date="2026-02-20", amount=300, creation="2026-02-20 08:00:00")
        _raw("Project Invoices", project=cls.Q, customer="X", invoice_no="INV-Q",
             invoice_date="2026-02-15", amount=9999, creation="2026-02-15 09:00:00")

    @classmethod
    def tearDownClass(cls):
        frappe.db.rollback()
        # By name prefix, so the empty project made inside a test is caught too.
        for doctype in ("Project Invoices", "Project Inflows", "Projects"):
            frappe.db.delete(doctype, {"name": ["like", "TEST-PLEDGER-%"]})
        frappe.db.commit()
        super().tearDownClass()

    def test_rows_are_this_project_only_in_date_order(self):
        rows = get_project_ledger_data(self.P)

        self.assertEqual(
            [(r["date"], r["type"], r["invoice"], r["inflow"]) for r in rows],
            [
                ("2026-01-05", "Inflow Received", 0, 400),
                ("2026-02-10", "Invoice Raised", 1000, 0),
                # Same day: `creation` breaks the tie.
                ("2026-02-20", "Invoice Raised", 300, 0),
                ("2026-02-20", "Invoice Raised", 200, 0),
                # No payment_date: falls back to the creation date, not today.
                ("2026-03-01", "Inflow Received", 0, 250),
            ],
        )
        self.assertTrue(all(r["project_id"] == self.P for r in rows))
        self.assertEqual(rows[0]["project"], "TEST-PLEDGER-P")
        self.assertIn(f"Ref: {self.first}", rows[2]["details"])

    def test_closing_receivable(self):
        rows = get_project_ledger_data(self.P)
        self.assertEqual(sum(r["invoice"] - r["inflow"] for r in rows), 1000 + 300 + 200 - 400 - 250)

    def test_project_with_no_activity_is_empty(self):
        empty = _raw("Projects", project_name="TEST-PLEDGER-EMPTY", status="WIP")
        self.assertEqual(get_project_ledger_data(empty), [])

    def test_project_id_is_required(self):
        with self.assertRaises(frappe.ValidationError):
            get_project_ledger_data("")
