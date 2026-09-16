# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Test-only: a Work Order payment built the way production builds it, tax row and all (#1284).

Shared by the payments suites (`api/payments/`) and the Bulk Import suites (`api/outflow_import/`,
`services/outflow_import/`). Not a `test_` module, so the runner never collects it.

WHY IT EXISTS
-------------
The Bulk Import and payment-split suites plant payments by raw SQL with NO VENDOR, so
`payment_tds.is_deductible` is always false and no `Payment TDS Deduction` row is ever written. Every
tax path in those suites was therefore unreachable -- which is how both double-TDS bugs in #1283
(unreconcile re-taxing a payment; a part payment's leftover taxed on top of the original) went unseen.

WHAT "THE WAY PRODUCTION DOES" MEANS HERE
-----------------------------------------
  * a `Project Payments` row against a `Service Requests` parent (a Work Order payment -- the only
    deductible ledger, `payment_tds.DEDUCTIBLE_PARENTS`);
  * a vendor carrying a non-zero `tds_deduction_percentage`;
  * APPROVED THROUGH THE REAL ENDPOINT, `ceo_approve_payment`, as the CEO user -- so `pay.save()` runs
    every `doc_event`, `on_update` sees CEO Pending -> Approved, the deduction row is written and the
    amount is netted by the same code a real approval runs.

⚠️ THE ROWS BEFORE THE APPROVAL ARE PLANTED BY RAW SQL, DELIBERATELY. The project, vendor and Service
Request are inputs, not the thing under test, and `Projects.after_insert` (`generate_pwm`) alone would
demand dates and scopes the tax path never reads. Inserting the payment at
`Requested` through `doc.insert()` fires `after_insert`'s admin fan-out, which pushes a notification to
every admin on the LIVE site and commits per recipient. The approval is the thing under test's input;
the request is not. The fresh project carries no `Nirmaan User Permissions`, so the approval's
accountant notification finds nobody and mints nothing (`services/test_payment_tds.py` relies on the
same fact).

⚠️ IT REFUSES TO HAND BACK A PAYMENT WITH NO TAX ROW. A fixture that silently stopped reaching the tax
code would turn every test built on it back into the blind raw-SQL fixture it replaces.

USAGE
-----
    self.taxed = TaxedWorkOrderFixture.attach(self)   # registers purge via addCleanup
    made = self.taxed.payment()                      # 50,000 gross at 2% -> 49,000 net
    made.name, made.deduction, made.gross, made.tds, made.net, made.service_request, ...

⚠️ RUNS AGAINST THE LIVE SITE DATABASE. Everything it plants is `TEST-TWO-*`; `purge` also sweeps the
payments the code under test mints under its projects (split leftovers), and never deletes a project
it was handed rather than created.
"""

import frappe
from frappe.utils import flt, nowdate

from nirmaan_stack.api.payments.project_payments import ceo_approve_payment
from nirmaan_stack.constants.authorized_users import CEO_AUTHORIZED_USER
from nirmaan_stack.services import payment_tds

PREFIX = "TEST-TWO-"
DEFAULT_GROSS = 50000.0
DEFAULT_RATE = 2.0

PAYMENT = "Project Payments"
SR = "Service Requests"
TDS = payment_tds.TDS_DOCTYPE
U = "Administrator"

#: Where **Mark as Done** puts an Approved payment, and so where the Bulk Import settles it FROM
#: (#1289). Spelled here rather than read from `outflow_import.ledgers`: this fixture belongs to the
#: payments module and must not grow a dependency on the import to describe its own lifecycle.
RECONCILIATION_PENDING = "Reconciliation Pending"


class TaxedWorkOrderFixture:
    """Plants projects, vendors, Service Requests and taxed payments, and purges all of them."""

    def __init__(self):
        self.projects: list[str] = []
        self.vendors: list[str] = []
        self.service_requests: list[str] = []
        self.payments: list[str] = []

    @classmethod
    def attach(cls, test) -> "TaxedWorkOrderFixture":
        """A fixture whose purge runs after the test, pass or fail. Needs only `addCleanup`."""
        fixture = cls()
        test.addCleanup(fixture.purge)
        return fixture

    # -- the rows ahead of the approval ---------------------------------------------------------
    def project(self) -> str:
        """A throwaway `Won` project. Its OWN project, so the CEO-Hold recompute a Paid payment
        triggers (`project_cashflow_hold_update`) can never touch a real one."""
        name = self._name("PROJ")
        frappe.db.sql(
            """INSERT INTO "tabProjects" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project_name, status, tendering_status)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, 'Created', 'Won')""",
            (name, U, U, name),
        )
        self.projects.append(name)
        return name

    def vendor(self, rate: float = DEFAULT_RATE) -> str:
        name = self._name("VEN")
        frappe.db.sql(
            """INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner,
                   docstatus, idx, vendor_name, tds_deduction_percentage)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s)""",
            (name, U, U, name, flt(rate)),
        )
        self.vendors.append(name)
        return name

    def service_request(self, project: str, vendor: str, total: float = 10000000) -> str:
        """`total_amount` is generous on purpose: `ProjectPayments.before_insert` refuses a payment
        above its parent's total, and a later test may add several payments to one SR."""
        name = self._name("SR")
        frappe.db.sql(
            """INSERT INTO "tabService Requests" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project, vendor, status, total_amount, amount_paid, gst)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, 'Approved', %s, 0, 'false')""",
            (name, U, U, project, vendor, flt(total)),
        )
        self.service_requests.append(name)
        return name

    # -- the payment ----------------------------------------------------------------------------
    def payment(
        self,
        gross: float = DEFAULT_GROSS,
        *,
        rate: float = DEFAULT_RATE,
        project: str | None = None,
        vendor: str | None = None,
        service_request: str | None = None,
    ) -> frappe._dict:
        """An Approved, taxed Work Order payment. Omitted parents are created; `rate` applies only
        to a vendor created here. Commits."""
        project = project or self.project()
        vendor = vendor or self.vendor(rate)
        service_request = service_request or self.service_request(project, vendor)

        name = self._name("PAY")
        frappe.db.sql(
            """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project, vendor, amount, status, document_type, document_name,
                   approval_date)
               VALUES (%s, NOW(), NOW(), %s, %s, 0, 0, %s, %s, %s, 'CEO Pending', %s, %s, %s)""",
            (name, U, U, project, vendor, flt(gross), SR, service_request, nowdate()),
        )
        self.payments.append(name)
        frappe.db.commit()

        previous = frappe.session.user
        frappe.set_user(CEO_AUTHORIZED_USER)
        try:
            ceo_approve_payment(name)
            # The endpoint leaves the commit to the request; a test has no request to do it.
            frappe.db.commit()
        finally:
            frappe.set_user(previous)

        deduction = payment_tds.existing_deduction(name)
        if not deduction:
            raise AssertionError(
                f"{name} was approved but no {TDS} row was written -- the fixture no longer reaches "
                f"the tax code, so no test built on it can see a tax bug."
            )
        tax = frappe.db.get_value(TDS, deduction, ["gross_amount", "tds_amount"], as_dict=True)
        return frappe._dict(
            name=name,
            project=project,
            vendor=vendor,
            service_request=service_request,
            deduction=deduction,
            gross=flt(tax.gross_amount),
            tds=flt(tax.tds_amount),
            net=flt(frappe.db.get_value(PAYMENT, name, "amount")),
        )

    def mark_as_done(self, payment: str) -> str:
        """Move an Approved payment to `Reconciliation Pending`, as an Accountant's **Mark as Done**
        does. Commits. Returns the status written, so a caller can assert against one name.

        ⚠️ THE IMPORT CANNOT SETTLE A PAYMENT WITHOUT THIS STEP FROM #1289 ON, which is why the
        fixture grew it rather than each suite writing its own. `payment()` leaves a payment exactly
        where its CEO approval leaves it -- `Approved`, taxed once -- and that is now one step short
        of what a bank line can settle.

        ⚠️ `doc.save()`, NOT `db.set_value`. The whole reason this fixture exists is to reach the tax
        code: a `set_value` fires no `on_update`, so a test built on it could not see a deduction
        written (or wrongly written) on this transition. It also proves the transition ITSELF taxes
        nothing -- `payment_tds.is_approval_from_an_earlier_step` is what makes that true, and a
        fixture that stepped around the hooks could never have shown it.
        """
        doc = frappe.get_doc(PAYMENT, payment)
        doc.status = RECONCILIATION_PENDING
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        return RECONCILIATION_PENDING

    # -- cleanup --------------------------------------------------------------------------------
    def purge(self) -> None:
        """Delete everything planted, plus every payment under a project this fixture created and
        every split leftover of a payment it planted -- the code under test mints both."""
        payments = set(self.payments)
        if self.projects:
            payments.update(frappe.get_all(PAYMENT, filters={"project": ["in", self.projects]}, pluck="name"))
        frontier = list(payments)
        while frontier:
            children = frappe.get_all(PAYMENT, filters={"split_from": ["in", frontier]}, pluck="name")
            frontier = [c for c in children if c not in payments]
            payments.update(frontier)
        payments = sorted(payments)

        if payments:
            frappe.db.delete(TDS, {"project_payment": ["in", payments]})
            frappe.db.delete("Nirmaan Notifications", {"docname": ["in", payments]})
            frappe.db.delete("Comment", {"reference_doctype": PAYMENT, "reference_name": ["in", payments]})
            frappe.db.delete("Version", {"ref_doctype": PAYMENT, "docname": ["in", payments]})
            frappe.db.delete("Nirmaan Versions", {"ref_doctype": PAYMENT, "docname": ["in", payments]})
            frappe.db.delete("Deleted Document", {"deleted_doctype": PAYMENT, "deleted_name": ["in", payments]})
            frappe.db.delete(PAYMENT, {"name": ["in", payments]})
        if self.service_requests:
            frappe.db.delete("Version", {"ref_doctype": SR, "docname": ["in", self.service_requests]})
            frappe.db.delete(SR, {"name": ["in", self.service_requests]})
        if self.vendors:
            frappe.db.delete("Vendors", {"name": ["in", self.vendors]})
        if self.projects:
            frappe.db.delete("Nirmaan Notifications", {"project": ["in", self.projects]})
            # A payment minted through `doc.insert()` names itself `PAY-<project suffix>-NNN` and
            # leaves that prefix's counter behind.
            frappe.db.delete("Series", {"name": ["in", [f"PAY-{p.split('-')[-1]}-" for p in self.projects]]})
            frappe.db.delete("Projects", {"name": ["in", self.projects]})
        frappe.db.commit()
        self.projects, self.vendors, self.service_requests, self.payments = [], [], [], []

    @staticmethod
    def _name(kind: str) -> str:
        return f"{PREFIX}{kind}-{frappe.generate_hash(length=10)}"
