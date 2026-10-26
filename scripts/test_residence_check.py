"""Tests for the P1, A1 and R1 rules of residence_check.py, and for what a failure prints.

Stdlib only, like the check itself:  python3 scripts/test_residence_check.py
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from residence_check import (  # noqa: E402
    explicit_any_lines_ts,
    locations_to_show,
    payment_sum_lines_jinja,
    payment_sum_lines_py,
    payment_sum_lines_ts,
    rupee_formatter_lines,
    tds_added_to_amount_paid_lines,
)


class FrontendPaymentSums(unittest.TestCase):
    def test_a_reduce_over_payment_amounts_is_a_copy(self):
        src = "const x = 1;\nconst paid = payments.reduce((sum, p) => sum + parseNumber(p.amount), 0);\n"
        self.assertEqual(payment_sum_lines_ts(src), [2])

    def test_each_call_of_the_shared_payment_sum_helpers_is_a_copy(self):
        src = (
            "export const getTotalAmountPaid = memoize(\n"
            "const paid = useMemo(() => getTotalAmountPaid(rows), [rows]);\n"
            "const { getAmount } = useOrderPayments();\n"
            "export const useOrderPayments = () => {\n"
        )
        self.assertEqual(payment_sum_lines_ts(src), [2, 3])

    def test_a_commented_out_sum_is_not_a_copy(self):
        src = "// const paid = getTotalAmountPaid(rows);\n   * sum + parseNumber(p.amount)\n"
        self.assertEqual(payment_sum_lines_ts(src), [])

    def test_a_payment_cap_marked_on_or_above_the_line_is_an_allowed_owner(self):
        src = (
            "// ADR-0034 payment cap: the Request Payment limit\n"
            "const pending = getTotalAmountPaid(open);\n"
            "const left = getTotalAmountPaid(open); // ADR-0034 payment cap\n"
            "const paid = getTotalAmountPaid(paidRows);\n"
        )
        self.assertEqual(payment_sum_lines_ts(src), [4])

    def test_other_amounts_are_not_payment_sums(self):
        src = "const t = terms.reduce((s, t) => s + parseNumber(t.amount), 0);\nconst x = sum + toPaise(p.amount);\n"
        self.assertEqual(payment_sum_lines_ts(src), [])


class PrintFormatPaymentSums(unittest.TestCase):
    def test_a_jinja_loop_adding_up_payment_rows_is_a_copy(self):
        src = (
            '{%- for r in frappe.get_all("Procurement Orders", fields=["amount_invoiced"]) -%}\n'
            "    {%- set inv.invoiced = inv.invoiced + (r.amount_invoiced or 0) -%}\n"
            "{%- endfor -%}\n"
            '{%- for r in frappe.get_all("Project Payments", filters={"status": "Paid"}, fields=["amount"]) -%}\n'
            "    {%- set inv.paid = inv.paid + (r.amount or 0) -%}\n"
            "{%- endfor -%}\n"
            "{%- set due = inv.invoiced - r.amount -%}\n"
        )
        self.assertEqual(payment_sum_lines_jinja(src), [5])


class BackendPaymentSums(unittest.TestCase):
    def test_summing_fetched_payment_rows_is_a_copy(self):
        src = (
            "def gap(project):\n"
            "    paid = frappe.get_all(\n"
            "        'Project Payments', filters={'project': project}, fields=['amount'])\n"
            "    inflows = frappe.get_all('Project Inflows', fields=['amount'])\n"
            "    inflow = sum(flt(i.amount) for i in inflows)\n"
            "    return sum(flt(p.amount) for p in paid) - inflow\n"
        )
        self.assertEqual(payment_sum_lines_py(src), [6])

    def test_a_loop_adding_up_payment_rows_is_a_copy(self):
        src = (
            "rows = []\n"
            "for chunk in batches:\n"
            "    rows.extend(frappe.get_all('Project Payments', fields=['project', 'amount']))\n"
            "for r in rows:\n"
            "    b[r.project] += flt(r.get('amount'))\n"
            "for r in frappe.get_all('Project Expenses', fields=['amount']):\n"
            "    b['x'] += flt(r.get('amount'))\n"
        )
        self.assertEqual(payment_sum_lines_py(src), [5])

    def test_a_sql_sum_over_the_payments_table_is_a_copy(self):
        src = (
            'rows = frappe.db.sql("""\n'
            "    SELECT p.name,\n"
            '           (SELECT SUM(t.amount) FROM "tabPO Payment Terms" t WHERE t.parent = p.name) AS terms,\n'
            '           (SELECT SUM(pp.amount) FROM "tabProject Payments" pp WHERE pp.document_name = p.name) AS paid,\n'
            '           (SELECT SUM(d.tds_amount) FROM "tabPayment TDS Deduction" d) AS tds\n'
            '    FROM "tabProcurement Orders" p""")\n'
            "x = frappe.db.sql('SELECT COALESCE(SUM(amount), 0) FROM \"tabProject Payments\" WHERE status = %s', s)\n"
        )
        self.assertEqual(payment_sum_lines_py(src), [4, 7])

    def test_a_sum_field_on_a_payments_fetch_is_a_copy(self):
        src = (
            "def paid(names):\n"
            "    sum_field = 'sum(CAST(amount as numeric)) as total_paid'\n"
            "    r = frappe.get_all('Project Payments', filters={'name': ['in', names]},\n"
            "                       fields=[sum_field])\n"
            "    s = frappe.get_all('Project Expenses', fields=['sum(amount) as t'])\n"
            "    return r\n"
        )
        self.assertEqual(payment_sum_lines_py(src), [3])

    def test_a_docstring_or_comment_naming_the_sum_is_not_a_copy(self):
        src = (
            'def f():\n'
            '    """Was: SELECT SUM(amount) FROM "tabProject Payments"."""\n'
            '    # sum(flt(p.amount) for p in frappe.get_all("Project Payments", fields=["amount"]))\n'
            '    return 0\n'
        )
        self.assertEqual(payment_sum_lines_py(src), [])


class ExplicitAny(unittest.TestCase):
    def test_each_way_of_typing_as_any_is_counted(self):
        src = (
            "} catch (err: any) {\n"
            "const rows = data as any;\n"
            "const list: any[] = [];\n"
            "type R = Record<string, any>;\n"
            "function f(a: any, b: number) {}\n"
        )
        self.assertEqual(explicit_any_lines_ts(src), [1, 2, 3, 4, 5])

    def test_unknown_prose_and_comments_are_not_counted(self):
        src = (
            "} catch (err: unknown) {\n"
            'const note = "Note: any value works";\n'
            "// const rows = data as any;\n"
            "const company = anyCompany;\n"
        )
        self.assertEqual(explicit_any_lines_ts(src), [])


class RupeeFormatters(unittest.TestCase):
    def test_a_python_rupee_function_is_a_formatter(self):
        src = "def format_rupee(val):\n    pass\ndef rupees(amount, *, paise=False):\n    pass\nlabel = rupees(1)\n"
        self.assertEqual(rupee_formatter_lines(src, ".py"), [1, 3])

    def test_a_frontend_rupee_function_is_a_formatter_and_a_value_is_not(self):
        src = (
            "const rupees = (amount: number) => formatToRoundedIndianRupee(amount);\n"
            "export function formatRupee(v: number) {}\n"
            'const rupeeSymbol = "₹";\n'
            "const total = rupees(5);\n"
        )
        self.assertEqual(rupee_formatter_lines(src, ".tsx"), [1, 2])


class WhatAFailurePrints(unittest.TestCase):
    def test_it_prints_the_violations_in_the_files_this_change_touches(self):
        where = ["a.py (600 lines)", "b.ts:3", "c.ts:9"]
        self.assertEqual(locations_to_show(where, {"b.ts"}), ["b.ts:3"])

    def test_with_none_in_touched_files_it_caps_a_long_list(self):
        where = [f"f{i}.ts:1" for i in range(25)]
        shown = locations_to_show(where, set())
        self.assertEqual(len(shown), 21)
        self.assertEqual(shown[-1], "... 5 more (--list prints them all)")

class TaxAddedOntoAmountPaid(unittest.TestCase):
    """A Work Order's `amount_paid` already holds the TDS withheld from the vendor (ADR-0034 Amendment A),
    so adding `total_tds` or a deduction's `tds_amount` onto it counts the tax twice."""

    def test_a_screen_adding_the_stored_tds_back_onto_amount_paid_is_a_copy(self):
        src = (
            "const paid = parseNumber(orderData?.amount_paid);\n"
            "const gross = parseNumber(orderData?.amount_paid) + parseNumber(orderData?.total_tds);\n"
            "const g2 = (wo.total_tds || 0) + (wo.amount_paid || 0);\n"
        )
        self.assertEqual(tds_added_to_amount_paid_lines(src), [2, 3])

    def test_a_deductions_tax_added_onto_amount_paid_is_a_copy(self):
        src = "    paid = flt(row.amount_paid) + flt(d.tds_amount)\n"
        self.assertEqual(tds_added_to_amount_paid_lines(src), [1])

    def test_sql_adding_the_stored_tds_onto_amount_paid_is_a_copy(self):
        src = '        SELECT o.amount_paid + o.total_tds AS gross FROM "tabService Requests" o\n'
        self.assertEqual(tds_added_to_amount_paid_lines(src), [1])

    def test_a_comment_or_a_subtraction_or_another_sum_is_not_a_copy(self):
        src = (
            "// Gross paid used to be amount_paid + total_tds.\n"
            "    # amount_paid + total_tds counts the tax twice\n"
            "const toVendor = parseNumber(orderData?.amount_paid) - parseNumber(tds?.withheld);\n"
            "const t = parseNumber(row.total_amount) + parseNumber(row.total_tds);\n"
        )
        self.assertEqual(tds_added_to_amount_paid_lines(src), [])


if __name__ == "__main__":
    unittest.main()
