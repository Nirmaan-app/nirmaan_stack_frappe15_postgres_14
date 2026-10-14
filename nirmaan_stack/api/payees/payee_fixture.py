# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Test-only: make Payees through the Payee module with no network, and purge every one (spec #1420).

Shared by the Payee suites. Not a `test_` module, so the runner never collects it.

USAGE
-----
    self.payees = PayeeFixture.attach(self)        # IFSC lookups answered offline; purge after the test
    name = self.payees.payee()                     # a fresh Active Payee, made by `writer.create_payee`
    number = self.payees.account_number()          # a fresh account number nobody holds
    self.payees.fail_ifsc_lookup()                 # the next lookups find nothing
    PayeeFixture.class_payee(holder, number, ifsc) # in setUpClass; call PayeeFixture.purge() in tearDownClass

Every Payee it makes carries `TEST_IFSC` and a `TESTPYE` holder name, and `purge` sweeps every
Payee with either, so a test that dies before it records a name strands nothing. Links to a
purged Payee (`Vendors`, `Expense Request`, `Project Expenses`, `Non Project Expenses`) are cleared
first, raw: `payee` is a plain link no hook reads.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit).
"""

import random
from unittest import mock

import frappe

from nirmaan_stack.services.payees.rules import PAYEE_DOCTYPE, parse_details
from nirmaan_stack.services.payees.writer import create_payee, existing_payee

TEST_IFSC = "TEST0PYE001"
HOLDER_PREFIX = "TESTPYE"
BANK = {"BANK": "Test Bank", "BRANCH": "Test Branch"}
LINKING_DOCTYPES = ("Vendors", "Expense Request", "Project Expenses", "Non Project Expenses")


class PayeeFixture:
    """Answers IFSC lookups offline, hands out test account numbers and purges the Payees made."""

    def __init__(self):
        self.lookup = mock.patch("nirmaan_stack.services.payees.ifsc.fetch_ifsc", return_value=dict(BANK))

    @classmethod
    def attach(cls, test) -> "PayeeFixture":
        """A fixture live for one test: lookups patched now, purge after the test, pass or fail."""
        fixture = cls()
        fixture.lookup_mock = fixture.lookup.start()
        test.addCleanup(fixture.lookup.stop)
        test.addCleanup(fixture.purge)
        return fixture

    def fail_ifsc_lookup(self) -> None:
        """From now on the lookup finds no bank for any IFSC (Razorpay's 404)."""
        self.lookup_mock.return_value = None

    @staticmethod
    def account_number() -> str:
        """Fourteen digits starting 9, unlikely to be anyone's: the purge sweeps by IFSC and name anyway."""
        return "9" + "".join(random.choice("0123456789") for _ in range(13))

    @staticmethod
    def holder(name: str = "Payee") -> str:
        return f"{HOLDER_PREFIX} {name} {frappe.generate_hash(length=5)}"

    def payee(self, holder: str | None = None, account_number: str | None = None, ifsc: str = TEST_IFSC) -> str:
        """A fresh Active Payee made through the Payee module, committed. Returns its name."""
        doc = create_payee(holder or self.holder(), account_number or self.account_number(), ifsc)
        frappe.db.commit()
        return doc.name

    @classmethod
    def class_payee(cls, holder: str, account_number: str, ifsc: str) -> str:
        """A Payee for a class-level fixture (`setUpClass`), lookups patched only for the create.

        Reuses the Payee already holding this account + IFSC (a run that died before its purge), so
        the fixture never trips the duplicate refusal. `holder` must start with `HOLDER_PREFIX`: the
        caller's `tearDownClass` calls `purge`, which sweeps by holder name and test IFSC."""
        assert holder.startswith(HOLDER_PREFIX), holder
        existing = existing_payee(parse_details(holder, account_number, ifsc))
        if existing:
            return existing
        fixture = cls()
        with fixture.lookup:
            return fixture.payee(holder=holder, account_number=account_number, ifsc=ifsc)

    @staticmethod
    def purge() -> None:
        """Delete every test Payee, its links and its audit rows. Rolls back first, so a poisoned
        transaction cannot strand rows; each step commits on its own and a failure is reported."""
        frappe.db.rollback()
        names = frappe.get_all(
            PAYEE_DOCTYPE,
            or_filters={"ifsc": TEST_IFSC, "account_name": ["like", f"{HOLDER_PREFIX}%"]},
            pluck="name",
        )
        if not names:
            return
        failures = []
        steps = [
            (f'UPDATE "tab{doctype}" SET payee = NULL WHERE payee IN %(names)s', doctype)
            for doctype in LINKING_DOCTYPES
        ]
        for sql, what in steps:
            try:
                frappe.db.sql(sql, {"names": tuple(names)})
                frappe.db.commit()
            except Exception as e:  # report, never swallow: a stranded row is permanent dev data
                frappe.db.rollback()
                failures.append(f"{what}: {e}")
        for doctype, filters in (
            ("Version", {"ref_doctype": PAYEE_DOCTYPE, "docname": ["in", names]}),
            ("Comment", {"reference_doctype": PAYEE_DOCTYPE, "reference_name": ["in", names]}),
            (PAYEE_DOCTYPE, {"name": ["in", names]}),
        ):
            try:
                frappe.db.delete(doctype, filters)
                frappe.db.commit()
            except Exception as e:
                frappe.db.rollback()
                failures.append(f"{doctype}: {e}")
        if failures:
            raise AssertionError("Payee purge failed: " + "; ".join(failures))
