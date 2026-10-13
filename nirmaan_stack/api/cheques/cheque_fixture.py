# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Test-only: plant Cheques through the real endpoint and purge every one of them (spec #1407).

Shared by the cheques suites. Not a `test_` module, so the runner never collects it.

USAGE
-----
    self.fx = TaxedWorkOrderFixture.attach(self)   # vendors / projects / payments
    self.cheques = ChequeFixture.attach(self)       # AFTER it: cleanups run LIFO, so the Cheques
                                                    # (which link to those rows) go first
    no = self.cheques.number()                      # a fresh TESTCHQ cheque number
    self.cheques.track(name)                        # a Cheque the code under test made
    pay = self.cheques.plant_payment(self.fx, "Approved", project=p, vendor=v, document=(SR, sr))
    self.addCleanup(ChequeFixture.purge_rows, [("Version", {...}), (doctype, {"name": name})])

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Every cheque number it hands out starts with
`TESTCHQ`, and `purge` also sweeps every Cheque carrying such a number, so a test that dies between
the insert and `track` strands nothing.
"""

import frappe
from frappe.utils import add_days, flt, nowdate

CHEQUES = "Cheques"
CHILD_TABLES = ("Cheque Line", "Cheque Status History")
NUMBER_PREFIX = "TESTCHQ"
ADMIN = "Administrator"


class ChequeFixture:
    """Hands out test cheque numbers and purges the Cheques made with them."""

    def __init__(self):
        self.names: set[str] = set()

    @classmethod
    def attach(cls, test) -> "ChequeFixture":
        """A fixture whose purge runs after the test, pass or fail. Needs only `addCleanup`."""
        fixture = cls()
        test.addCleanup(fixture.purge)
        return fixture

    @staticmethod
    def number() -> str:
        return f"{NUMBER_PREFIX}{frappe.generate_hash(length=8)}"

    def track(self, name: str) -> str:
        self.names.add(name)
        return name

    @staticmethod
    def plant_payment(
        fx,
        status: str,
        *,
        project: str,
        vendor: str,
        document: tuple[str, str],
        amount=20000,
        cheque_no: str | None = None,
        cheque_date: str | None = None,
        on_hold: bool = False,
        utr: str | None = None,
        owner: str = ADMIN,
        days_ago: int = 0,
    ) -> str:
        """A Project Payment of `document` (`(doctype, name)` of its PO / Work Order) already sitting at
        `status`, raw-inserted so no approval hook runs. Online, or with `cheque_no` a Cheque payment
        on no Cheque (dated `cheque_date`, else the day it was made). `days_ago` sets when it was
        requested. Tracked in `fx.payments` (a `TaxedWorkOrderFixture`), which purges it; committed.
        """
        name = fx._name("PAY")
        frappe.db.sql(
            """INSERT INTO "tabProject Payments" (name, creation, modified, modified_by, owner,
                   docstatus, idx, project, vendor, amount, status, document_type, document_name,
                   mode_of_payment, cheque_no, cheque_date, on_hold, utr)
               VALUES (%s, NOW() - %s * INTERVAL '1 day', NOW(), %s, %s, 0, 0, %s, %s, %s, %s, %s, %s,
                       %s, %s, %s, %s, %s)""",
            (
                name, days_ago, ADMIN, owner, project, vendor, flt(amount), status, *document,
                "Cheque" if cheque_no else "Online", cheque_no,
                (cheque_date or add_days(nowdate(), -days_ago)) if cheque_no else None,
                1 if on_hold else 0, utr,
            ),
        )
        fx.payments.append(name)
        frappe.db.commit()
        return name

    @staticmethod
    def purge_rows(scopes, *, what: str = "Test purge") -> None:
        """Delete each `(doctype, filters)` scope, in order. For rows a test planted by hand.

        Rolls back first: a test that poisoned the transaction would otherwise make the first
        delete raise and strand everything after it. Each scope commits on its own; a scope that
        fails is rolled back and reported once the rest have run, never swallowed.
        """
        frappe.db.rollback()
        failures = []
        for doctype, filters in scopes:
            try:
                frappe.db.delete(doctype, filters)
                frappe.db.commit()
            except Exception as e:  # report, never swallow: a stranded row is permanent dev data
                frappe.db.rollback()
                failures.append(f"{doctype}: {e}")
        if failures:
            raise AssertionError(f"{what} failed: " + "; ".join(failures))

    def purge(self) -> None:
        """Delete the tracked Cheques and every TESTCHQ Cheque, with their child rows and audit rows."""
        frappe.db.rollback()
        names = set(self.names)
        names.update(frappe.get_all(CHEQUES, filters={"cheque_no": ["like", f"{NUMBER_PREFIX}%"]}, pluck="name"))
        names = sorted(names)
        self.names = set()
        if not names:
            return
        scopes = [(child, {"parenttype": CHEQUES, "parent": ["in", names]}) for child in CHILD_TABLES]
        scopes += [
            ("Version", {"ref_doctype": CHEQUES, "docname": ["in", names]}),
            ("Comment", {"reference_doctype": CHEQUES, "reference_name": ["in", names]}),
            (CHEQUES, {"name": ["in", names]}),
        ]
        self.purge_rows(scopes, what="Cheque purge")
