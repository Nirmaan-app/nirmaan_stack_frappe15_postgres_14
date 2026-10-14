# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Test-only: make Payees through the Payee module with no network, and purge every one (spec #1420).

Shared by the Payee suites. Not a `test_` module, so the runner never collects it.

USAGE
-----
    self.payees = PayeeFixture.attach(self)        # IFSC lookups answered offline; purge after the test
    name = self.payees.payee()                     # a fresh Active Payee, made by `writer.create_payee`
    vendor = self.payees.vendor(name)              # a vendor inserted raw, paid into it; purged too
    number = self.payees.account_number()          # a fresh account number nobody holds
    self.payees.fail_ifsc_lookup()                 # the next lookups find nothing
    PayeeFixture.class_payee(holder, number, ifsc) # in setUpClass, with PayeeFixture.insert_vendor(...);
                                                   # call PayeeFixture.purge(vendors=[...]) in tearDownClass
    delete_each([(doctype, name), ...], raw={...})  # any other row a Payee suite planted

Every Payee it makes carries `TEST_IFSC` and a `TESTPYE` holder name, and `purge` sweeps every
Payee with either, so a test that dies before it records a name strands nothing. Links to a
purged Payee (`Vendors`, `Expense Request`, `Project Expenses`, `Non Project Expenses`) are cleared
first, raw: `payee` is a plain link no hook reads.

⚠️ `purge` ROLLS BACK FIRST, so a test's own delete must come AFTER it (or be committed before it):
an uncommitted delete made before the purge is undone by it. That is how #1427's class fixtures
stranded a `Testvendor Theta Ltd` vendor per run, which `TestAmbiguityIsNotResolved` then matched
by name. Hand the vendors to `purge(vendors=...)` instead; it deletes them in their own scope.

`clean_each` is the one clean-up loop of the Payee suites (CODING_STANDARDS § Writing tests: roll back
first, each scope in its own try, report every failure); `purge` and `delete_each` run through it.

⚠️ RUNS AGAINST THE ENV DATABASE (the endpoints commit).
"""

import random
from collections.abc import Callable, Collection, Iterable
from unittest import mock

import frappe

from nirmaan_stack.services.payees.rules import PAYEE_DOCTYPE, parse_details
from nirmaan_stack.services.payees.writer import create_payee, existing_payee

TEST_IFSC = "TEST0PYE001"
HOLDER_PREFIX = "TESTPYE"
VENDOR_PREFIX = "TESTPYE-VEN-"
BANK = {"BANK": "Test Bank", "BRANCH": "Test Branch"}
LINKING_DOCTYPES = ("Vendors", "Expense Request", "Project Expenses", "Non Project Expenses")


class PayeeFixture:
    """Answers IFSC lookups offline, hands out test account numbers and vendors, and purges both."""

    def __init__(self):
        self.lookup = mock.patch("nirmaan_stack.services.payees.ifsc.fetch_ifsc", return_value=dict(BANK))
        self.vendors: list[str] = []

    @classmethod
    def attach(cls, test) -> "PayeeFixture":
        """A fixture live for one test: lookups patched now, purge after the test, pass or fail."""
        fixture = cls()
        fixture.lookup_mock = fixture.lookup.start()
        test.addCleanup(fixture.lookup.stop)
        test.addCleanup(lambda: cls.purge(vendors=fixture.vendors))
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

    def vendor(self, payee: str | None = None, *, vendor_name: str | None = None) -> str:
        """A vendor inserted raw (`insert_vendor`), paid into `payee`; purged after the test."""
        name = self.insert_vendor(payee, vendor_name=vendor_name)
        self.vendors.append(name)
        return name

    @staticmethod
    def insert_vendor(payee: str | None = None, *, name: str | None = None, vendor_name: str | None = None) -> str:
        """Insert a bare vendor paid into `payee` and commit; returns its name. Raw, so no vendor hook
        runs (a vendor's hooks read its categories, which a test vendor has none of). The caller
        deletes it: `purge(vendors=[name])`."""
        name = name or f"{VENDOR_PREFIX}{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            """INSERT INTO "tabVendors" (name, creation, modified, modified_by, owner, docstatus, idx,
                                         vendor_name, payee)
               VALUES (%s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0, %s, %s)""",
            (name, vendor_name or f"{HOLDER_PREFIX} Vendor {name}", payee),
        )
        frappe.db.commit()
        return name

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
    def purge(vendors=()) -> None:
        """Delete `vendors`, every test Payee, its links and its audit rows, each scope on its own
        (`clean_each`, which rolls back first)."""
        frappe.db.rollback()
        names = frappe.get_all(
            PAYEE_DOCTYPE,
            or_filters={"ifsc": TEST_IFSC, "account_name": ["like", f"{HOLDER_PREFIX}%"]},
            pluck="name",
        )
        steps = []
        if vendors:
            steps.append(("Vendors", lambda: frappe.db.delete("Vendors", {"name": ["in", list(vendors)]})))
        if names:
            linked = {"names": tuple(names)}
            steps += [
                (f"{doctype} links", lambda d=doctype: frappe.db.sql(
                    f'UPDATE "tab{d}" SET payee = NULL WHERE payee IN %(names)s', linked))
                for doctype in LINKING_DOCTYPES
            ]
            steps += [
                ("Version", lambda: frappe.db.delete(
                    "Version", {"ref_doctype": PAYEE_DOCTYPE, "docname": ["in", names]})),
                ("Comment", lambda: frappe.db.delete(
                    "Comment", {"reference_doctype": PAYEE_DOCTYPE, "reference_name": ["in", names]})),
                (PAYEE_DOCTYPE, lambda: frappe.db.delete(PAYEE_DOCTYPE, {"name": ["in", names]})),
            ]
        clean_each(steps)


def clean_each(steps: Iterable[tuple[str, Callable[[], object]]]) -> None:
    """Run each `(label, step)` of a test's clean-up in its own scope: roll back first, so a poisoned
    transaction strands nothing; commit after each step; try them all, then raise one AssertionError
    naming every step that failed. A stranded row is permanent dev data, so nothing is swallowed."""
    frappe.db.rollback()
    failures = []
    for label, step in steps:
        try:
            step()
            frappe.db.commit()
        except Exception as e:  # report, never swallow: a stranded row is permanent dev data
            frappe.db.rollback()
            failures.append(f"{label}: {e}")
    if failures:
        raise AssertionError("Clean-up failed: " + "; ".join(failures))


def delete_each(scopes: Iterable[tuple[str, str]], *, raw: Collection[str] = ()) -> None:
    """Delete each `(doctype, name)` in its own scope (`clean_each`). A doctype in `raw` loses the row
    and its Version rows, raw: a row inserted raw has no hooks to undo. Any other is deleted with
    `frappe.delete_doc`, when it exists."""
    clean_each((f"{doctype} {name}", lambda d=doctype, n=name: _delete(d, n, d in raw)) for doctype, name in scopes)


def _delete(doctype: str, name: str, raw: bool) -> None:
    if raw:
        frappe.db.delete("Version", {"ref_doctype": doctype, "docname": name})
        frappe.db.delete(doctype, {"name": name})
    elif frappe.db.exists(doctype, name):
        frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
