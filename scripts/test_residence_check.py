"""Tests for the P1 and R1 rules (and A1's retirement) of residence_check.py, and for what a failure prints.

Stdlib only, like the check itself (J1's tests also need node and frontend/node_modules):  python3 scripts/test_residence_check.py
"""

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from residence_check import (  # noqa: E402
    BASELINE_PATH,
    CHECKS,
    CI_SUBSET,
    Check,
    db_access_lines,
    locations_to_show,
    main,
    select_checks,
    payment_sum_lines_jinja,
    payment_sum_lines_py,
    payment_sum_lines_ts,
    rupee_formatter_lines,
    tds_added_to_amount_paid_lines,
    json_call_count,
    json_call_counts,
    json_call_drift,
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


class TheAnyCountIsTheLints(unittest.TestCase):
    """ADR-0049: oxlint's no-explicit-any (frontend/oxlint-suppressions.json) counts `any`, so this check does not."""

    def test_no_check_counts_any(self):
        self.assertNotIn("A1", [c.rule for c in CHECKS])

    def test_every_baseline_entry_belongs_to_a_check(self):
        baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(sorted(baseline), sorted(c.id for c in CHECKS))


class PureModules(unittest.TestCase):
    """B1: a module listed in PURE_MODULES reads no database."""

    def test_a_database_call_in_a_pure_module_is_counted(self):
        src = (
            "import frappe\n"
            "def rule(name):\n"
            "    row = frappe.db.get_value('Projects', name, 'status')\n"
            "    rows = frappe.get_all('Projects')\n"
            "    doc = frappe.get_doc('Projects', name)\n"
            "    return frappe.db.sql('select 1')\n"
        )
        self.assertEqual(db_access_lines(src), [3, 4, 5, 6])

    def test_a_docstring_or_comment_naming_the_database_is_not_counted(self):
        src = '"""Pure: no frappe.db, no frappe.get_doc(...)."""\n# frappe.get_all would break B1\nx = "frappe.db"\n'
        self.assertEqual(db_access_lines(src), [])

    def test_frappe_throw_is_allowed(self):
        self.assertEqual(db_access_lines("import frappe\nfrappe.throw('no')\n"), [])

    def test_cached_reads_lists_and_the_query_builder_are_counted(self):
        src = (
            "import frappe\n"
            "a = frappe.get_list('Projects')\n"
            "b = frappe.get_cached_value('Projects', 'P', 'status')\n"
            "c = frappe.get_cached_doc('Projects', 'P')\n"
            "d = frappe.get_single('Settings')\n"
            "e = frappe.qb.DocType('Projects')\n"
        )
        self.assertEqual(db_access_lines(src), [2, 3, 4, 5, 6])

    def test_an_aliased_or_directly_imported_database_name_is_counted(self):
        src = "import frappe as f\nfrom frappe import db, get_all\nx = f.db.get_value('A', 'b')\ny = get_all('A')\nz = db.sql('select 1')\n"
        self.assertEqual(db_access_lines(src), [3, 4, 5])

    def test_a_file_that_does_not_parse_is_read_line_by_line(self):
        self.assertEqual(db_access_lines("def broken(:\n    frappe.db.get_value('A', 'b')\n"), [2])


class RetiredCounters(unittest.TestCase):
    """ADR-0010 amendment (2026-11-18): B2, F2 and F5 stay as review rules; the script no longer counts them."""

    def test_no_check_counts_b2_f2_or_f5(self):
        self.assertEqual({"B2", "F2", "F5"} & {c.rule for c in CHECKS}, set())


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

def _fake_check(cid: str, rule: str, count: int) -> Check:
    return Check(id=cid, rule=rule, description=cid, route_hint="move it", measure=lambda: count)


class RunModes(unittest.TestCase):
    """The local run (all checks, tightening the baseline) and the CI run (a named subset, check-only)."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.baseline_path = Path(tmp.name) / "baseline.json"
        self.baseline = {
            "s1_big": {"count": 5, "rule": "S1", "description": ""},
            "b3_state": {"count": 5, "rule": "B3", "description": ""},
        }
        self.baseline_path.write_text(json.dumps(self.baseline), encoding="utf-8")

    def run_check(self, checks, *argv):
        rc, out, _ = self.run_check_err(checks, *argv)
        return rc, out

    def run_check_err(self, checks, *argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = main(list(argv), checks=checks, baseline_path=self.baseline_path)
        return rc, out.getvalue(), err.getvalue()

    def stored(self):
        return json.loads(self.baseline_path.read_text(encoding="utf-8"))

    def test_the_local_run_tightens_the_baseline_when_a_count_falls(self):
        rc, _ = self.run_check([_fake_check("s1_big", "S1", 3), _fake_check("b3_state", "B3", 5)])
        self.assertEqual(rc, 0)
        self.assertEqual(self.stored()["s1_big"]["count"], 3)

    def test_check_only_passes_a_fallen_count_and_leaves_the_baseline_file_alone(self):
        before = self.baseline_path.read_bytes()
        rc, _ = self.run_check([_fake_check("s1_big", "S1", 3), _fake_check("b3_state", "B3", 5)], "--check")
        self.assertEqual(rc, 0)
        self.assertEqual(self.baseline_path.read_bytes(), before)

    def test_check_only_fails_a_risen_count(self):
        rc, out = self.run_check([_fake_check("s1_big", "S1", 6)], "--check")
        self.assertEqual(rc, 1)
        self.assertIn("✗ s1_big", out)

    def test_only_runs_the_named_checks_by_rule_or_id(self):
        checks = [_fake_check("s1_big", "S1", 5), _fake_check("b3_state", "B3", 99)]
        rc, out = self.run_check(checks, "--check", "--only", "S1")
        self.assertEqual(rc, 0)
        self.assertNotIn("b3_state", out)
        rc, out = self.run_check(checks, "--check", "--only", "b3_state")
        self.assertEqual(rc, 1)
        self.assertNotIn("s1_big", out)

    def test_an_unknown_name_is_refused(self):
        rc, out, err = self.run_check_err([_fake_check("s1_big", "S1", 5)], "--check", "--only", "S1,Z9")
        self.assertEqual(rc, 2)
        self.assertIn("Z9", err)
        self.assertEqual(out, "")

    def test_only_with_init_is_refused_and_writes_no_baseline(self):
        before = self.baseline_path.read_bytes()
        rc, out, err = self.run_check_err([_fake_check("s1_big", "S1", 5)], "--init", "--only", "S1")
        self.assertEqual(rc, 2)
        self.assertIn("--init", err)
        self.assertEqual(out, "")
        self.assertEqual(self.baseline_path.read_bytes(), before)

    def test_only_ci_runs_the_ci_subset(self):
        checks = [_fake_check(n, n, 0) for n in CI_SUBSET] + [_fake_check("b3_state", "B3", 99)]
        rc, out = self.run_check(checks, "--check", "--only", "ci")
        self.assertEqual(rc, 0)
        self.assertNotIn("b3_state", out)
        for n in CI_SUBSET:
            self.assertIn(f"✓ {n} ", out)

    def test_ci_subset_names_the_seven_checks_outside_adr_0010(self):
        ids = [c.id for c in select_checks(CHECKS, CI_SUBSET)]
        self.assertEqual(sorted(ids), sorted([
            "s1_oversized_files", "r1_rupee_formatters", "p1_payment_sum_copies",
            "p1_tds_added_to_amount_paid", "t1_tests_pick_any_row", "t2_tests_freeze_time",
            "j1_json_calls_unfrozen",
        ]))

    def test_ci_runs_the_ci_subset_check_only(self):
        workflow = (Path(__file__).resolve().parent.parent / ".github/workflows/frontend.yml").read_text()
        self.assertIn("python3 scripts/residence_check.py --check --only ci\n", workflow)

    def test_ci_runs_the_residence_checks_after_install_for_j1s_parser(self):
        workflow = (Path(__file__).resolve().parent.parent / ".github/workflows/frontend.yml").read_text()
        self.assertLess(workflow.index("run: yarn install"), workflow.index("scripts/residence_check.py --check"))


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


class JsonCalls(unittest.TestCase):
    """J1, the `.json()` ban of ADR-0049: `response.json()` returns `any`; parseJson(await response.text()) does not."""

    def test_counts_each_json_call_in_code(self):
        src = (
            "const a = await response.json();\n"
            "const b = await r?.json();\n"
            "const c = await res.json<Row[]>();\n"
            "const d = await fetch(url).then((r) => r\n  .json());\n"
        )
        self.assertEqual(json_call_count(src), 4)

    def test_a_json_call_in_a_comment_or_a_string_is_not_counted(self):
        src = (
            "// do not call response.json() here\n"
            "/* nor res.json() */\n"
            "const hint = \"use r.json() never\";\n"
            "const t = `call ${\"x\"} r.json() in text`;\n"
        )
        self.assertEqual(json_call_count(src), 0)

    def test_a_json_call_inside_a_template_placeholder_is_counted(self):
        self.assertEqual(json_call_count("const t = `got ${await r.json()} rows`;\n"), 1)

    def test_a_regex_literal_with_a_quote_or_slashes_hides_no_call_after_it(self):
        src = (
            "const q = /'/; const a = await res.json();\n"
            "const t = /`/; const b = await res.json();\n"
            "const u = /https?:\\/\\//.test(url) && (await res.json());\n"
            "const v = s.replace(/[/'\"]/g, ''); const c = await res.json();\n"
            "if (ok) return /x'/.test(await r.json());\n"
        )
        self.assertEqual(json_call_count(src), 5)

    # Each probe below once blanked the call: the old hand-written scanner read the `/` as a regex's start.
    def test_a_call_after_a_template_divided_is_counted(self):
        self.assertEqual(json_call_count("const a = `x` / 2; const b = await r.json(); const c = n / 3;\n"), 1)

    def test_a_call_after_jsx_is_counted(self):
        src = "function P() {\n  return <p>hi</p>; const b = await r.json(); const c = n / 3;\n}\n"
        self.assertEqual(json_call_counts({"src/P.tsx": src}), {"src/P.tsx": 1})

    def test_a_call_after_a_regex_that_follows_a_paren_or_keyword_is_counted(self):
        for before in ("if (ok) /`/.test(s);", "if (ok) {} else /`/.test(s);", "do /`/.test(s); while (0);",
                       "export default /`/;"):
            with self.subTest(before=before):
                self.assertEqual(json_call_count(f"{before}\nconst b = await r.json();\n"), 1)

    def test_a_call_after_an_increment_divided_is_counted(self):
        self.assertEqual(json_call_count("let i = 0;\ni++ / 2; const b = await r.json(); const c = n / 3;\n"), 1)

    def test_a_json_call_count_reads_tsx_files_as_tsx(self):
        counts = json_call_counts({"src/A.tsx": "const a = <p>{x}</p>;\nr.json();\n", "src/b.ts": "r.json(); r.json();\n"})
        self.assertEqual(counts, {"src/A.tsx": 1, "src/b.ts": 2})

    def test_division_is_not_a_regex(self):
        src = "const half = total / 2; const r = await res.json(); const q = a / b / c;\n"
        self.assertEqual(json_call_count(src), 1)

    def test_a_private_or_escaped_json_method_call_is_counted(self):
        # ESLint's selector matched both: a private name's node is named `json`, and an escape is read decoded.
        src = "class A { #json() {} f() { this.#json(); } }\nr.j\\u0073on();\n"
        self.assertEqual(json_call_count(src), 2)

    def test_the_real_tree_sends_every_file_to_the_parser(self):
        with mock.patch("residence_check.json_call_counts", return_value={}) as counts, \
                redirect_stdout(io.StringIO()):
            main(["--check", "--only", "J1"])
        self.assertTrue("src/lib/frappe.ts" in counts.call_args.args[0], "a file without `json` was not sent")

    def test_a_field_or_function_called_json_is_not_a_call_of_it(self):
        src = "const x = row.json;\nconst y = toJson(row);\nconst z = row.jsonText();\nfunction json() {}\n"
        self.assertEqual(json_call_count(src), 0)

    def frozen(self, **counts):
        return {path.replace("__", "/") + ".ts": {"no-json-call": {"count": n}} for path, n in counts.items()}

    def test_the_frozen_counts_hold(self):
        found = {"src/a.ts": 2, "src/b.ts": 1}
        self.assertEqual(json_call_drift(found, self.frozen(src__a=2, src__b=1)), [])

    def test_a_new_call_fails_even_where_another_file_lost_one(self):
        found = {"src/a.ts": 3, "src/b.ts": 0}
        self.assertEqual(json_call_drift(found, self.frozen(src__a=2, src__b=1)), [
            "frontend/src/a.ts: 3 .json() calls, 2 frozen (a new call: use parseJson)",
            "frontend/src/b.ts: 0 .json() calls, 1 frozen (fewer: lower its count in frontend/json-call-suppressions.json)",
        ])

    def test_a_call_in_a_file_with_none_frozen_fails(self):
        self.assertEqual(json_call_drift({"src/new.ts": 1}, {}), [
            "frontend/src/new.ts: 1 .json() calls, 0 frozen (a new call: use parseJson)",
        ])

    def test_j1_fails_and_says_why_when_node_is_missing(self):
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"PATH": ""}), redirect_stdout(out):
            rc = main(["--check", "--only", "J1"])
        self.assertEqual(rc, 1, out.getvalue())
        self.assertIn("J1 could not count .json() calls: node could not run", out.getvalue())

    def test_in_the_commit_hook_j1_warns_and_passes_when_node_is_missing(self):
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"PATH": ""}), redirect_stdout(out):
            rc = main(["--hook", "--only", "J1"])
        self.assertEqual(rc, 0, out.getvalue())
        self.assertIn("⚠ J1 skipped: node could not run", out.getvalue())
        self.assertIn("CI counts .json() calls on every pull request", out.getvalue())

    def test_in_the_commit_hook_j1_still_refuses_a_new_call(self):
        out = io.StringIO()
        frozen = json.loads((Path(__file__).resolve().parent.parent / "frontend/json-call-suppressions.json")
                            .read_text())
        counts = {path: rules["no-json-call"]["count"] for path, rules in frozen.items()} | {"src/new.ts": 1}
        with mock.patch("residence_check.json_call_counts", return_value=counts), redirect_stdout(out):
            rc = main(["--hook", "--check", "--only", "J1"])
        self.assertEqual(rc, 1, out.getvalue())

    def test_a_raised_baseline_entry_does_not_let_a_new_call_pass(self):
        with tempfile.TemporaryDirectory() as d:
            baseline = Path(d) / "baseline.json"
            baseline.write_text(json.dumps({"j1_json_calls_unfrozen": {"count": 5, "rule": "J1"}}))
            out = io.StringIO()
            frozen = json.loads((Path(__file__).resolve().parent.parent / "frontend/json-call-suppressions.json")
                                .read_text())
            counts = {path: rules["no-json-call"]["count"] for path, rules in frozen.items()} | {"src/new.ts": 1}
            with mock.patch("residence_check.json_call_counts", return_value=counts), redirect_stdout(out):
                rc = main(["--check", "--only", "J1"], baseline_path=baseline)
        self.assertEqual(rc, 1, out.getvalue())
        self.assertIn("frontend/src/new.ts: 1 .json() calls, 0 frozen", out.getvalue())

    def test_the_real_tree_holds_its_frozen_counts(self):
        rc, out = 0, io.StringIO()
        with redirect_stdout(out):
            rc = main(["--check", "--only", "J1"])
        self.assertEqual(rc, 0, out.getvalue())


if __name__ == "__main__":
    unittest.main()
