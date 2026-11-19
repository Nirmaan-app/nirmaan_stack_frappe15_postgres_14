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
    raw_listener_lines,
    raw_listener_uses,
    BACKGROUND_WRITTEN_DOCTYPES,
    COUNTED_NAME_WAITING,
    counted_names_on_background_doctypes,
    raw_enqueue_drift,
    raw_enqueue_lines,
    raw_enqueues_found,
    socket_listener_count,
    socket_listener_drift,
    socket_listeners_found,
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

    def test_ci_subset_names_the_eleven_checks_outside_adr_0010(self):
        ids = [c.id for c in select_checks(CHECKS, CI_SUBSET)]
        self.assertEqual(sorted(ids), sorted([
            "s1_oversized_files", "r1_rupee_formatters", "p1_payment_sum_copies",
            "p1_tds_added_to_amount_paid", "t1_tests_pick_any_row", "t2_tests_freeze_time",
            "j1_json_calls_unfrozen", "l1_raw_listener_hooks", "n1_counted_names_on_background_doctypes",
            "q1_raw_enqueues_unfrozen", "l2_socket_listeners_unfrozen",
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


class RawListenerHooks(unittest.TestCase):
    """L1 (#1670): the SDK's three listener hooks drop other components' listeners and rooms. src/lib/frappe.ts
    exports safe ones in their place; outside it no file names the raw ones, not even inside an SDK import that
    oxlint-suppressions.json already freezes for that file."""

    def test_a_raw_hook_added_to_a_frozen_sdk_import_is_found(self):
        src = ('import { useFrappeGetDoc, useFrappeDocTypeEventListener } from "frappe-react-sdk";\n'
               "const a = 1;\n"
               'useFrappeDocTypeEventListener("Projects", () => mutate());\n')
        self.assertEqual(raw_listener_lines(src), [1, 3])

    def test_each_of_the_three_raw_hooks_is_found(self):
        src = ("useFrappeEventListener('po:new', f);\n"
               "useFrappeDocumentEventListener('Projects', id, f);\n"
               "useFrappeDocTypeEventListener('Projects', f);\n")
        self.assertEqual(raw_listener_lines(src), [1, 2, 3])

    def test_the_safe_listeners_are_not_found(self):
        src = ('import { useDocTypeEventListener, useDocumentEventListener, useSocketEventListener } '
               'from "@/lib/frappe";\n')
        self.assertEqual(raw_listener_lines(src), [])

    def test_its_home_is_exempt_and_every_other_file_is_read(self):
        with mock.patch("residence_check.read", return_value="useFrappeEventListener('x', f);\n"):
            found = raw_listener_uses()
        self.assertNotIn("frontend/src/lib/frappe.ts:1", found)
        self.assertIn("frontend/src/lib/frappe.test.ts:1", found)
        self.assertGreater(len(found), 1000)

    def test_l1_passes_at_zero_whatever_the_baseline_file_says(self):
        with tempfile.TemporaryDirectory() as d:
            baseline = Path(d) / "baseline.json"
            baseline.write_text(json.dumps({"l1_raw_listener_hooks": {"count": 5, "rule": "L1"}}))
            out = io.StringIO()
            new_file = Path(__file__).resolve().parent.parent / "frontend/src/new.tsx"
            with mock.patch("residence_check.iter_files", return_value=[new_file]), \
                    mock.patch("residence_check.read", side_effect=lambda path: (
                        "\n\nuseFrappeEventListener('x', f);\n" if path == new_file else path.read_text())), \
                    redirect_stdout(out):
                rc = main(["--check", "--only", "L1"], baseline_path=baseline)
        self.assertEqual(rc, 1, out.getvalue())
        self.assertIn("frontend/src/new.tsx:3", out.getvalue())

    def test_the_real_tree_names_no_raw_hook(self):
        out = io.StringIO()
        with redirect_stdout(out):
            rc = main(["--check", "--only", "L1"])
        self.assertEqual(rc, 0, out.getvalue())


class CountedNamesOnBackgroundDoctypes(unittest.TestCase):
    """N1 (#1661, ADR-0048): a doctype background operations write never takes a counted name."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.doctype_dir = Path(tmp.name)

    def doctype(self, name, autoname="hash", controller="class X(Document):\n    pass\n"):
        folder = self.doctype_dir / name.lower().replace(" ", "_")
        folder.mkdir(exist_ok=True)
        (folder / f"{folder.name}.json").write_text(json.dumps({"name": name, "autoname": autoname}))
        (folder / f"{folder.name}.py").write_text(controller)

    def findings(self, names, waiting=None):
        return counted_names_on_background_doctypes(self.doctype_dir, names, waiting or {})

    def test_a_counted_autoname_in_the_doctype_json_is_refused(self):
        for autoname in ("BRR-.YY.-.#####", "naming_series:", "format:BRR-{YY}-{#####}", "BRR.####"):
            with self.subTest(autoname=autoname):
                self.doctype("Sample Row", autoname=autoname)
                found = self.findings(["Sample Row"])
                self.assertEqual(len(found), 1, found)
                self.assertIn("Sample Row", found[0])

    def test_a_controller_that_counts_is_refused(self):
        for line in ('self.name = getseries(f"ATT-{self.project}-", 3)',
                     'self.name = make_autoname("SR-.#####")',
                     "self.name = frappe.model.naming.make_autoname(self.prefix + '.####')"):
            with self.subTest(line=line):
                self.doctype("Sample Row", autoname="",
                             controller=f"class X(Document):\n    def autoname(self):\n        {line}\n")
                found = self.findings(["Sample Row"])
                self.assertEqual(len(found), 1, found)
                self.assertIn("sample_row.py:3", found[0])

    def test_hash_and_names_that_take_no_number_pass(self):
        controller = (
            "# getseries( in a comment\n"
            "class X(Document):\n"
            "    '''make_autoname(\"A.#\") in a docstring'''\n"
            "    def autoname(self):\n"
            "        self.name = make_autoname(\"hash\")\n"
        )
        for autoname in ("hash", "", "UUID", "autoincrement", "field:title", "Prompt"):
            with self.subTest(autoname=autoname):
                self.doctype("Sample Row", autoname=autoname, controller=controller)
                self.assertEqual(self.findings(["Sample Row"]), [])

    def test_a_doctype_not_on_the_list_is_ignored(self):
        self.doctype("Sample Row")
        self.doctype("Other Ledger", autoname="OL-.#####",
                     controller="def autoname(self):\n    self.name = getseries('OL', 3)\n")
        self.assertEqual(self.findings(["Sample Row"]), [])

    def test_a_doctype_waiting_on_its_ticket_passes_until_it_switches(self):
        self.doctype("Sample Row", autoname="SR-.#####")
        self.assertEqual(self.findings(["Sample Row"], {"Sample Row": "#9999"}), [])

    def test_a_waiting_doctype_that_switched_must_leave_the_waiting_list(self):
        self.doctype("Sample Row")
        found = self.findings(["Sample Row"], {"Sample Row": "#9999"})
        self.assertEqual(len(found), 1, found)
        self.assertIn("COUNTED_NAME_WAITING", found[0])

    def test_a_listed_doctype_with_no_folder_is_refused(self):
        found = self.findings(["Renamed Row"])
        self.assertEqual(len(found), 1, found)
        self.assertIn("Renamed Row", found[0])

    def test_the_list_names_the_nine_doctypes_and_none_waits(self):
        self.assertEqual(sorted(BACKGROUND_WRITTEN_DOCTYPES), sorted([
            "BoQ Review Row", "BoQ Row Category", "BoQ Rate Suggestion Run", "BoQ Rate Match Run",
            "BoQ Cell Pricing", "Project Action Item", "Outflow Row Match", "Expense Bill", "Nirmaan Attachments",
        ]))
        self.assertEqual(COUNTED_NAME_WAITING, {})

    def test_the_real_tree_has_no_counted_name_on_a_listed_doctype(self):
        out = io.StringIO()
        with redirect_stdout(out):
            rc = main(["--check", "--only", "N1"])
        self.assertEqual(rc, 0, out.getvalue())
        self.assertIn("✓ n1_counted_names_on_background_doctypes", out.getvalue())

    def test_a_raised_baseline_entry_does_not_let_a_counted_name_pass(self):
        self.doctype("Sample Row", autoname="SR-.#####")
        baseline = self.doctype_dir / "baseline.json"
        baseline.write_text(json.dumps({"n1_counted_names_on_background_doctypes": {"count": 5, "rule": "N1"}}))
        out = io.StringIO()
        with mock.patch("residence_check.DOCTYPE_DIR", self.doctype_dir), \
                mock.patch("residence_check.BACKGROUND_WRITTEN_DOCTYPES", ["Sample Row"]), redirect_stdout(out):
            rc = main(["--check", "--only", "N1"], baseline_path=baseline)
        self.assertEqual(rc, 1, out.getvalue())
        self.assertIn("Sample Row", out.getvalue())


class RawEnqueues(unittest.TestCase):
    """Q1 (#1671, ADR 0047): a job is queued only by the background-operation module, which writes the status record
    the screen follows. Every other enqueue is frozen per file in scripts/raw-enqueue-suppressions.json."""

    def test_each_way_of_queuing_a_job_is_found(self):
        src = ("import frappe\n"
               "from frappe import enqueue\n"
               "from frappe.utils.background_jobs import enqueue as queue_it, enqueue_doc\n"
               "from frappe.utils import background_jobs\n"
               "frappe.enqueue('m.f', queue='long')\n"
               "enqueue('m.f')\n"
               "queue_it('m.f')\n"
               "enqueue_doc('ToDo', 'x', 'f')\n"
               "frappe.enqueue_doc('ToDo', 'x', 'f')\n"
               "background_jobs.enqueue('m.f')\n"
               "frappe.utils.background_jobs.enqueue('m.f')\n"
               "get_queue('long').enqueue_call('m.f')\n"
               "background_jobs.get_queue('long').enqueue('m.f')\n")
        self.assertEqual(raw_enqueue_lines(src), [5, 6, 7, 8, 9, 10, 11, 12, 13])

    def test_a_mention_a_patch_or_another_enqueue_is_not_a_job_queued(self):
        src = ('import frappe\n'
               '# frappe.enqueue("m.f")\n'
               '"""frappe.enqueue("m.f")"""\n'
               'patch.object(frappe, "enqueue", side_effect=jobs.append)\n'
               'patch("frappe.enqueue")\n'
               'ai_run_log.enqueue_after_parse(boq, sheets)\n'
               'enqueue_sheet_cards(boq, sheet, 1)\n'
               'is_job_enqueued(job_id)\n'
               'jobs.enqueue("x")\n')
        self.assertEqual(raw_enqueue_lines(src), [])

    def frozen(self, **entries):
        return {path.replace("__", "/") + ".py": {"no-raw-enqueue": {"count": n, "reason": "a cron job"}}
                for path, n in entries.items()}

    def test_the_frozen_counts_hold(self):
        found = {"nirmaan_stack/a.py": 2, "nirmaan_stack/b.py": 1}
        self.assertEqual(raw_enqueue_drift(found, self.frozen(nirmaan_stack__a=2, nirmaan_stack__b=1)), [])

    def test_a_new_enqueue_fails_even_where_another_file_lost_one(self):
        found = {"nirmaan_stack/a.py": 3, "nirmaan_stack/b.py": 0}
        self.assertEqual(raw_enqueue_drift(found, self.frozen(nirmaan_stack__a=2, nirmaan_stack__b=1)), [
            "nirmaan_stack/a.py: 3 raw enqueues, 2 frozen "
            "(a new one: start a background operation with services/background_ops.start)",
            "nirmaan_stack/b.py: 0 raw enqueues, 1 frozen "
            "(fewer: lower its count in scripts/raw-enqueue-suppressions.json)",
        ])

    def test_an_enqueue_in_a_file_with_none_frozen_fails(self):
        self.assertEqual(raw_enqueue_drift({"nirmaan_stack/new.py": 1}, {}), [
            "nirmaan_stack/new.py: 1 raw enqueues, 0 frozen "
            "(a new one: start a background operation with services/background_ops.start)",
        ])

    def test_a_frozen_file_must_say_why_it_stays_a_raw_enqueue(self):
        frozen = {"nirmaan_stack/a.py": {"no-raw-enqueue": {"count": 1, "reason": " "}}}
        self.assertEqual(raw_enqueue_drift({"nirmaan_stack/a.py": 1}, frozen), [
            "nirmaan_stack/a.py: frozen with no reason (say in one line why it is not a background operation)",
        ])

    def test_the_module_is_exempt_and_tests_are_not_read(self):
        with mock.patch("residence_check.read", return_value="import frappe\nfrappe.enqueue('m.f')\n"):
            found = raw_enqueues_found()
        self.assertNotIn("nirmaan_stack/services/background_ops.py", found)
        self.assertNotIn("nirmaan_stack/services/test_background_ops.py", found)
        self.assertEqual(found["nirmaan_stack/hooks.py"], 1)

    def test_q1_refuses_a_new_file_whatever_the_baseline_file_says(self):
        with tempfile.TemporaryDirectory() as d:
            baseline = Path(d) / "baseline.json"
            baseline.write_text(json.dumps({"q1_raw_enqueues_unfrozen": {"count": 5, "rule": "Q1"}}))
            found = raw_enqueues_found() | {"nirmaan_stack/api/new_flow.py": 1}
            out = io.StringIO()
            with mock.patch("residence_check.raw_enqueues_found", return_value=found), redirect_stdout(out):
                rc = main(["--check", "--only", "Q1"], baseline_path=baseline)
        self.assertEqual(rc, 1, out.getvalue())
        self.assertIn("nirmaan_stack/api/new_flow.py: 1 raw enqueues, 0 frozen", out.getvalue())

    def test_the_statement_imports_stay_raw_by_name_and_say_why(self):
        frozen = json.loads((Path(__file__).resolve().parent.parent / "scripts/raw-enqueue-suppressions.json")
                            .read_text())
        for path in ("nirmaan_stack/api/outflow_import/porter_validation.py",
                     "nirmaan_stack/api/outflow_import/porter_create.py",
                     "nirmaan_stack/api/outflow_import/card_import.py",
                     "nirmaan_stack/api/outflow_import/card_create.py",
                     "nirmaan_stack/api/outflow_import/cashbook.py"):
            with self.subTest(path):
                self.assertTrue(frozen[path]["no-raw-enqueue"]["reason"].strip())

    def test_the_real_tree_holds_its_frozen_counts(self):
        out = io.StringIO()
        with redirect_stdout(out):
            rc = main(["--check", "--only", "Q1"])
        self.assertEqual(rc, 0, out.getvalue())


class SocketListeners(unittest.TestCase):
    """L2 (#1671, ADR 0047): a screen follows a background operation through useBackgroundOperation, never through its
    own socket listener. Every other listener (locks, notifications, doc changes) is frozen per file, each with its
    reason, in frontend/socket-listener-suppressions.json."""

    def test_each_socket_listener_is_counted(self):
        src = (
            "socket.on('boq:parse_done', onDone);\n"
            "socket.off('boq:parse_done', onDone);\n"
            "socket?.on(EV_READY, onReady);\n"
            "frappe.socket.on('tds_export_ready', f);\n"
            "(socket.on)('x', f);\n"
            "handlers.forEach(([e, h]) => socket.on(e, h));\n"
        )
        self.assertEqual(socket_listener_count(src), 6)

    def test_connection_events_and_other_calls_are_not_counted(self):
        src = (
            "// socket.on('boq:parse_done', f)\n"
            "const hint = \"socket.on('x', f)\";\n"
            "socket.on('connect', onReconnect);\n"
            "socket.off(\"disconnect\", onDrop);\n"
            "socket.on(`connect_error`, onError);\n"
            "socket.emit('x');\n"
            "emitter.on('x', f);\n"
            "useSocketEventListener('cheques:changed', f);\n"
            "useDocTypeEventListener('Projects', f);\n"
            "useDocumentEventListener('Projects', id, f);\n"
        )
        self.assertEqual(socket_listener_count(src), 0)

    def test_a_safe_listener_hook_or_a_wrapper_listening_for_an_operation_event_is_counted(self):
        src = (
            "useSocketEventListener('background_op:read_now', f);\n"
            "useSocketEventListener(READ_NOW_EVENT, f);\n"
            "useSocketEventListener(`background_op:${kind}`, f);\n"
            "frappe.useSocketEventListener(\"background_op:done\", f);\n"
            "useExportEventListener('background_op:read_now', f);\n"
            "useSocketEventListener('cheques:changed', f);\n"
            "useSocketEventListener(eventName, f);\n"
            "track('background_op:read_now');\n"
        )
        self.assertEqual(socket_listener_count(src), 5)

    def test_a_tsx_source_is_read_as_tsx(self):
        src = "const A = () => <div>{x}</div>;\nsocket.on('po:new', f);\n"
        self.assertEqual(socket_listener_count(src, "a.tsx"), 1)

    def frozen(self, **counts):
        return {path.replace("__", "/") + ".ts": {"no-socket-listener": {"count": n, "reason": "a lock's presence"}}
                for path, n in counts.items()}

    def test_a_new_listener_fails_even_where_another_file_lost_one(self):
        found = {"src/a.ts": 3, "src/b.ts": 0}
        self.assertEqual(socket_listener_drift(found, self.frozen(src__a=2, src__b=1)), [
            "frontend/src/a.ts: 3 socket listeners, 2 frozen "
            "(a new one: follow a background operation with useBackgroundOperation)",
            "frontend/src/b.ts: 0 socket listeners, 1 frozen "
            "(fewer: lower its count in frontend/socket-listener-suppressions.json)",
        ])

    def test_a_frozen_file_must_say_why_it_listens(self):
        frozen = {"src/a.ts": {"no-socket-listener": {"count": 1}}}
        self.assertEqual(socket_listener_drift({"src/a.ts": 1}, frozen), [
            "frontend/src/a.ts: frozen with no reason (say in one line why it is not a background operation)",
        ])

    def test_the_shared_hook_the_safe_listeners_and_the_global_listeners_are_exempt_and_tests_are_not_read(self):
        with mock.patch("residence_check.socket_listener_counts", side_effect=lambda sources: {p: 1 for p in sources}):
            found = socket_listeners_found()
        self.assertNotIn("src/hooks/useBackgroundOperation.ts", found)
        self.assertNotIn("src/lib/frappe.ts", found)
        self.assertNotIn("src/services/socketListeners.ts", found)
        self.assertNotIn("src/lib/frappeListeners.dom.test.tsx", found)
        self.assertIn("src/pages/boq-wizard/SheetPricingPage.tsx", found)

    def test_l2_refuses_a_new_file_whatever_the_baseline_file_says(self):
        with tempfile.TemporaryDirectory() as d:
            baseline = Path(d) / "baseline.json"
            baseline.write_text(json.dumps({"l2_socket_listeners_unfrozen": {"count": 5, "rule": "L2"}}))
            found = socket_listeners_found() | {"src/pages/new/useExport.ts": 1}
            out = io.StringIO()
            with mock.patch("residence_check.socket_listeners_found", return_value=found), redirect_stdout(out):
                rc = main(["--check", "--only", "L2"], baseline_path=baseline)
        self.assertEqual(rc, 1, out.getvalue())
        self.assertIn("frontend/src/pages/new/useExport.ts: 1 socket listeners, 0 frozen", out.getvalue())

    def test_l2_fails_and_says_why_when_node_is_missing_and_only_warns_in_the_commit_hook(self):
        for argv, rc_wanted, said in ((["--check", "--only", "L2"], 1, "L2 could not count socket listeners: node"),
                                      (["--hook", "--only", "L2"], 0, "⚠ L2 skipped: node could not run")):
            with self.subTest(argv):
                out = io.StringIO()
                with mock.patch.dict(os.environ, {"PATH": ""}), redirect_stdout(out):
                    rc = main(argv)
                self.assertEqual(rc, rc_wanted, out.getvalue())
                self.assertIn(said, out.getvalue())

    def test_the_real_tree_holds_its_frozen_counts(self):
        out = io.StringIO()
        with redirect_stdout(out):
            rc = main(["--check", "--only", "L2"])
        self.assertEqual(rc, 0, out.getvalue())


if __name__ == "__main__":
    unittest.main()
