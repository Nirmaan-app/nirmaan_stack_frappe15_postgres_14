# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the concurrent-writer classifier (issue #1246, ADR-0020 Amendment B4), and for the unique-index
classifier `is_unique_refusal_by_index` (#1588, #1606, #1611).

THE PROPERTY UNDER TEST IS THE NEGATIVE ONE. Recognising the one refusal is easy; what matters is
that NOTHING ELSE is recognised, because whatever this says yes to gets reported to a reviewer as a
harmless race on a screen that settles money.
"""

import unittest

import psycopg2
import psycopg2.errors as pg_errors

import frappe

from nirmaan_stack.services.outflow_import.concurrency import (
    is_concurrent_writer_refusal,
    is_unique_refusal_by_index,
)


class TestTheOneRefusalIsRecognised(unittest.TestCase):
    def test_a_serialization_failure_is_the_concurrent_writer_refusal(self):
        """What the losing reviewer's row read raises when the winner committed first (measured,
        Amendment B2): SQLSTATE 40001, which psycopg2 raises as exactly this class."""
        exc = pg_errors.SerializationFailure("could not serialize access due to concurrent update")
        self.assertTrue(is_concurrent_writer_refusal(exc))


class TestNothingElseIsRecognised(unittest.TestCase):
    def test_a_failed_transaction_is_NOT_recognised(self):
        """⚠️ THE NEAREST MISS, AND THE ONE THAT MATTERS MOST. With the row lock removed, the loser
        of the same race surfaces as this (Amendment B2) -- but so does ANY statement after ANY
        earlier swallowed error in the transaction. It cannot name its cause, so it must not be
        translated into one."""
        exc = pg_errors.InFailedSqlTransaction("current transaction is aborted")
        self.assertFalse(is_concurrent_writer_refusal(exc))

    def test_a_deadlock_is_NOT_recognised(self):
        """A SIBLING of the serialization failure (both are `TransactionRollbackError`), which is
        exactly why the check is on the class and never on the parent: a deadlock can be two
        unrelated writers, and saying "another user resolved this transfer" would be a guess."""
        self.assertFalse(is_concurrent_writer_refusal(pg_errors.DeadlockDetected("deadlock")))
        self.assertFalse(is_concurrent_writer_refusal(frappe.QueryDeadlockError("deadlock")))

    def test_a_unique_violation_is_NOT_recognised(self):
        self.assertFalse(is_concurrent_writer_refusal(pg_errors.UniqueViolation("duplicate key")))

    def test_a_generic_database_error_is_NOT_recognised(self):
        self.assertFalse(is_concurrent_writer_refusal(psycopg2.OperationalError("server closed")))
        self.assertFalse(is_concurrent_writer_refusal(psycopg2.DatabaseError("anything")))

    def test_an_application_error_is_NOT_recognised(self):
        self.assertFalse(is_concurrent_writer_refusal(frappe.ValidationError("More than is left")))
        self.assertFalse(is_concurrent_writer_refusal(ValueError("bad")))


ASKED_INDEX = "made_up_unique_index"


def _unique_violation_by(constraint_name: str) -> pg_errors.UniqueViolation:
    """A `UniqueViolation` as Postgres reports it: the refusing index's name is on `diag.constraint_name`, which
    psycopg2 fills in only for an error read off the wire, so the test gives it here."""

    class _OffTheWire(pg_errors.UniqueViolation):
        diag = type("Diag", (), {"constraint_name": constraint_name})()

    return _OffTheWire("duplicate key value violates unique constraint")


class TestAUniqueRefusalIsRecognisedByItsIndexName(unittest.TestCase):
    def test_a_unique_violation_by_the_named_index_is_recognised(self):
        self.assertTrue(is_unique_refusal_by_index(_unique_violation_by(ASKED_INDEX), ASKED_INDEX))

    def test_the_violation_wrapped_the_way_frappe_wraps_it_is_recognised(self):
        """Frappe re-raises a unique violation as `UniqueValidationError(doctype, name, exc)`, chained from it."""
        violation = _unique_violation_by(ASKED_INDEX)
        try:
            try:
                raise violation
            except pg_errors.UniqueViolation as exc:
                raise frappe.UniqueValidationError("Outflow Row Match", "ofm-0001", exc) from exc
        except frappe.UniqueValidationError as wrapped:
            self.assertTrue(is_unique_refusal_by_index(wrapped, ASKED_INDEX))

    def test_the_violation_carried_only_in_the_wrappers_args_is_recognised(self):
        wrapped = frappe.UniqueValidationError("Outflow Row Match", "ofm-0001", _unique_violation_by(ASKED_INDEX))
        self.assertTrue(is_unique_refusal_by_index(wrapped, ASKED_INDEX))

    def test_a_unique_violation_by_another_index_is_NOT_recognised(self):
        """⚠️ THE NAME IS THE TEST, NEVER THE CLASS: another unique key must not be relabelled as this one."""
        self.assertFalse(is_unique_refusal_by_index(_unique_violation_by("some_other_unique_index"), ASKED_INDEX))

    def test_a_unique_violation_with_no_index_name_is_NOT_recognised(self):
        self.assertFalse(is_unique_refusal_by_index(pg_errors.UniqueViolation("duplicate key"), ASKED_INDEX))

    def test_a_deadlock_is_NOT_recognised(self):
        self.assertFalse(is_unique_refusal_by_index(pg_errors.DeadlockDetected("deadlock"), ASKED_INDEX))
        self.assertFalse(is_unique_refusal_by_index(frappe.QueryDeadlockError("deadlock"), ASKED_INDEX))

    def test_an_application_error_is_NOT_recognised(self):
        self.assertFalse(is_unique_refusal_by_index(frappe.ValidationError(ASKED_INDEX), ASKED_INDEX))


if __name__ == "__main__":
    unittest.main()
