# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""`patches/v3_0/project_inflows_amount_to_currency.py` --a zero-loss text -> Currency cast (#1255).

⚠️ THE FIXTURE IS A SCRATCH TABLE, NEVER `tabProject Inflows`. The real column is converted once,
by `bench migrate`; a test that converted it would leave the live site's column numeric behind
the migration's back, and a test that needed it TEXT would fail forever after the first migrate.
The conversion is a function of (table, column) for exactly this reason: `execute()` is a one-line
call, and everything worth asserting happens on a table this suite owns and drops.
"""

import unittest
from decimal import Decimal
from unittest import mock

import frappe

from nirmaan_stack.patches.v3_0 import project_inflows_amount_to_currency as patch_module
from nirmaan_stack.patches.v3_0.project_inflows_amount_to_currency import (
    convert_text_column_to_currency,
)


class TestInflowAmountCurrencyPatch(unittest.TestCase):
    def setUp(self):
        self.table = f"_test_inflow_amount_{frappe.generate_hash(length=8)}"
        frappe.db.sql(
            f'CREATE TABLE "{self.table}" (name varchar(140) PRIMARY KEY, amount varchar(140))'
        )
        frappe.db.commit()

    def tearDown(self):
        frappe.db.rollback()
        frappe.db.sql(f'DROP TABLE IF EXISTS "{self.table}"')
        frappe.db.commit()

    # -- helpers ---------------------------------------------------------------------------------

    def _seed(self, rows):
        for name, amount in rows:
            frappe.db.sql(
                f'INSERT INTO "{self.table}" (name, amount) VALUES (%s, %s)', (name, amount)
            )
        frappe.db.commit()

    def _data_type(self):
        return frappe.db.sql(
            """SELECT data_type FROM information_schema.columns
               WHERE table_name = %s AND column_name = 'amount'""",
            (self.table,),
        )[0][0]

    def _values(self):
        return dict(frappe.db.sql(f'SELECT name, amount FROM "{self.table}"'))

    # -- refusal ---------------------------------------------------------------------------------

    def test_junk_value_refuses_names_every_offender_and_alters_nothing(self):
        clean = [("INF-OK-1", "1500.50"), ("INF-OK-2", "200")]
        junk = [
            ("INF-BAD-EMPTY", ""),
            ("INF-BAD-COMMA", "1,000"),
            ("INF-BAD-WORD", "abc"),
            ("INF-BAD-NAN", "NaN"),
            ("INF-BAD-EXP", "1e3"),
            ("INF-BAD-TOO-BIG", "1234567890123"),
            ("INF-BAD-TOO-FINE", "1.0000000001"),
            # Arabic-Indic digits: Python's `Decimal` accepts them, PostgreSQL's cast does not.
            ("INF-BAD-NON-ASCII", "١٢"),
        ]
        self._seed(clean + junk)
        before = self._values()

        with self.assertRaises(frappe.ValidationError) as ctx:
            convert_text_column_to_currency(self.table, "amount")

        message = str(ctx.exception)
        for name, _ in junk:
            self.assertIn(name, message)
        for name, _ in clean:
            self.assertNotIn(name, message)

        frappe.db.rollback()
        self.assertEqual(self._data_type(), "character varying")
        self.assertEqual(self._values(), before)

    # -- conversion ------------------------------------------------------------------------------

    def test_clean_data_converts_with_identical_count_and_sum(self):
        rows = [
            ("INF-1", "532471152.36"),
            ("INF-2", " 1200.5 "),
            ("INF-3", "-45.10"),
            ("INF-4", "0"),
            ("INF-5", None),
            ("INF-6", "999999999999.999999999"),
        ]
        self._seed(rows)
        expected_sum = sum(Decimal(a.strip()) for _, a in rows if a is not None)

        result = convert_text_column_to_currency(self.table, "amount")
        frappe.db.commit()

        self.assertEqual(result["status"], "converted")
        self.assertEqual(result["count"], len(rows))
        self.assertEqual(result["sum"], expected_sum)
        self.assertEqual(self._data_type(), "numeric")

        count, total = frappe.db.sql(f'SELECT COUNT(*), SUM(amount)::text FROM "{self.table}"')[0]
        self.assertEqual(count, len(rows))
        self.assertEqual(Decimal(total), expected_sum)

        values = self._values()
        self.assertIsNone(values["INF-5"])
        self.assertEqual(Decimal(str(values["INF-2"])), Decimal("1200.5"))
        self.assertEqual(Decimal(str(values["INF-3"])), Decimal("-45.10"))

    def test_a_count_or_sum_that_moves_rolls_the_alter_back(self):
        """The re-assert is the proof. PostgreSQL cannot lose a clean value in this cast, so the
        mismatch is forced by making the post-ALTER measurement disagree."""
        self._seed([("INF-1", "10.25"), ("INF-2", "5")])
        before = self._values()

        with mock.patch.object(
            patch_module, "_measure", return_value=(2, 2, Decimal("15.24"))
        ), self.assertRaises(frappe.ValidationError) as ctx:
            convert_text_column_to_currency(self.table, "amount")

        self.assertIn("rolled back", str(ctx.exception))
        self.assertEqual(self._data_type(), "character varying")
        self.assertEqual(self._values(), before)

    def test_second_run_is_a_no_op(self):
        self._seed([("INF-1", "10.25"), ("INF-2", "5")])
        convert_text_column_to_currency(self.table, "amount")
        frappe.db.commit()
        before = self._values()

        result = convert_text_column_to_currency(self.table, "amount")

        self.assertEqual(result["status"], "skipped")
        self.assertEqual(self._data_type(), "numeric")
        self.assertEqual(self._values(), before)
