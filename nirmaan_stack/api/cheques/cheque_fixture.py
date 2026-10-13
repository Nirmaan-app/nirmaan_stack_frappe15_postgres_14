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

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit). Every cheque number it hands out starts with
`TESTCHQ`, and `purge` also sweeps every Cheque carrying such a number, so a test that dies between
the insert and `track` strands nothing.
"""

import frappe

CHEQUES = "Cheques"
CHILD_TABLES = ("Cheque Line", "Cheque Status History")
NUMBER_PREFIX = "TESTCHQ"


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

    def purge(self) -> None:
        """Delete the tracked Cheques and every TESTCHQ Cheque, with their child rows and audit rows.

        Rolls back first: a test that poisoned the transaction would otherwise make the first
        delete raise and strand everything after it. Each scope commits on its own.
        """
        frappe.db.rollback()
        names = set(self.names)
        names.update(frappe.get_all(CHEQUES, filters={"cheque_no": ["like", f"{NUMBER_PREFIX}%"]}, pluck="name"))
        names = sorted(names)
        if not names:
            return
        failures = []
        scopes = [(child, {"parenttype": CHEQUES, "parent": ["in", names]}) for child in CHILD_TABLES]
        scopes += [
            ("Version", {"ref_doctype": CHEQUES, "docname": ["in", names]}),
            ("Comment", {"reference_doctype": CHEQUES, "reference_name": ["in", names]}),
            (CHEQUES, {"name": ["in", names]}),
        ]
        for doctype, filters in scopes:
            try:
                frappe.db.delete(doctype, filters)
                frappe.db.commit()
            except Exception as e:  # report, never swallow: a stranded row is permanent dev data
                frappe.db.rollback()
                failures.append(f"{doctype}: {e}")
        self.names = set()
        if failures:
            raise AssertionError("Cheque purge failed: " + "; ".join(failures))
