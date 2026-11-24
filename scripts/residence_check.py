#!/usr/bin/env python3
"""Residence ratchet — enforce ADR-0010 module-residence rules by trend, not by fiat.

ADR-0010 (docs/adr/0010-module-residence-rules.md) defines the "residence" rules:
a concept (a business calculation, a JSON/child-table shape, a document's
``workflow_state``, a write path) must have ONE owning module and not scatter across
call sites.

The 2026-11-18 amendment keeps two of its counters here (B1, B3); its other rules are review rules.

A RATCHET fixes the drift in one direction. Each check counts the current violations
of one rule and compares against a committed baseline in ``residence_baseline.json``.
The policy (see ``compare`` below) fails only when a count INCREASES — you cannot add
violation N+1 — while a count that DROPS tightens the baseline automatically, so retired
debt can never silently creep back. Old debt is paid down incrementally; new debt is
blocked at the door.

Usage:
    python3 scripts/residence_check.py --init   # (re)generate the baseline file
    python3 scripts/residence_check.py          # check current tree against baseline
    python3 scripts/residence_check.py --list   # ... and print each counted violation (P1)
    python3 scripts/residence_check.py --check --only ci     # CI: the CI_SUBSET checks, baseline never rewritten
    python3 scripts/residence_check.py --check --only S1,R1  # named checks (check or rule ids), check-only
    python3 scripts/residence_check.py --prune-disable-comments  # D1: lower the frozen disable-comment counts

W1's code is in walk_graduation.py. D1's code is in disable_comment_check.py; what J1, D1 and L2 share (TypeScript's parser run by node) in
frozen_counts.py. Stdlib only, plus node for J1, D1 and L2 (frontend/scripts/json_calls.mjs, disable_comments.mjs
and socket_listeners.mjs, with
frontend/node_modules); run from anywhere (repo root is resolved from __file__).
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, NamedTuple

import frozen_counts
from disable_comment_check import DISABLE_SUPPRESSIONS, PRUNE_FLAG, disable_comments_unfrozen, prune_disable_comments
from frozen_counts import TsParserError, frozen_drift, node_cannot_run, read_frozen, run_ts_parser
from walk_graduation import LEDGER as GRADUATION_LEDGER, graduation_gaps

# Repo root = the parent of this scripts/ directory (NOT the cwd).
REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE_PATH = Path(__file__).resolve().parent / "residence_baseline.json"

# Directories never worth walking (generated / vendored / compiled output).
SKIP_DIRS = {"node_modules", "dist", "__pycache__", "public", ".git"}

# --- Rule B1 -----------------------------------------------------------------
# Modules DECLARED pure: no frappe.db / get_all / get_doc / sql. Extend this list
# as more domain rules are extracted into pure modules.
# services/finance.py is deliberately NOT here: it makes live frappe.get_all calls.
PURE_MODULES = [
    "nirmaan_stack/services/procurement_approval.py",
    # The two BCS column-confirmation rules (BCS-S1a relocation). Pure by contract: its
    # ONE framework touch is frappe.throw, which this check does not count.
    "nirmaan_stack/services/boq_bcs/sources.py",
    # The Non Project Inflows type rule (#1266): read by the doctype validate and the import service.
    "nirmaan_stack/services/non_project_inflows.py",
    # The refund link rule (#1399): how much of each Received refund settles a PO Adjustment.
    "nirmaan_stack/services/refund_links.py",
    # The waiting-refund suggestion rule (#1402): which waiting Vendor Refund a bank credit line may be.
    "nirmaan_stack/services/outflow_import/refund_suggestion.py",
    # The date a money row counts on, and its range clauses (#1451 review): project money and vendor paid.
    "nirmaan_stack/services/money_dates.py",
    # The cashflow CEO Hold rule (#1508 review): the hold check and the WO recount patch's preview.
    "nirmaan_stack/services/ceo_hold/rules.py",
]


# --- file walking + counting helpers -----------------------------------------

def iter_files(subpath: str, exts: tuple[str, ...]) -> list[Path]:
    """All files under REPO_ROOT/subpath with one of ``exts``, skipping SKIP_DIRS."""
    base = REPO_ROOT / subpath
    if not base.exists():
        return []
    out = []
    for p in base.rglob("*"):
        if p.suffix not in exts or not p.is_file():
            continue
        if SKIP_DIRS & set(p.parts):
            continue
        out.append(p)
    return out


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def count_lines(files: list[Path], pattern: re.Pattern) -> int:
    """Number of LINES (across all files) that contain a pattern match."""
    total = 0
    for p in files:
        for line in read(p).splitlines():
            if pattern.search(line):
                total += 1
    return total


_DB_ACCESS = {"db", "qb", "sql", "get_all", "get_list", "get_doc", "get_cached_doc", "get_cached_value", "get_single"}
_DB_ACCESS_TEXT = re.compile(r"frappe\.(db|qb|sql|get_all|get_list|get_doc|get_cached_doc|get_cached_value|get_single)\b")


def db_access_lines(src: str) -> list[int]:
    """Lines of a Python source that reach the database through ``frappe`` (``frappe.db``, ``frappe.qb``,
    ``frappe.get_all``, ``frappe.get_cached_value``, ...), under an alias or a ``from frappe import``.
    Strings and comments never count."""
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return [i + 1 for i, line in enumerate(src.splitlines()) if _DB_ACCESS_TEXT.search(line)]
    frappe_names = {"frappe"}
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            frappe_names |= {a.asname for a in node.names if a.name == "frappe" and a.asname}
        elif isinstance(node, ast.ImportFrom) and node.module == "frappe":
            imported |= {a.asname or a.name for a in node.names if a.name in _DB_ACCESS}
    return sorted({
        node.lineno for node in ast.walk(tree)
        if (isinstance(node, ast.Attribute) and node.attr in _DB_ACCESS
            and isinstance(node.value, ast.Name) and node.value.id in frappe_names)
        or (isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id in imported)
    })


def pure_module_impurities() -> list[str]:
    return [f"{rel}:{n}" for rel in PURE_MODULES if (REPO_ROOT / rel).exists()
            for n in db_access_lines(read(REPO_ROOT / rel))]


# --- Rule P1: adding up Project Payments to show a paid figure (ADR-0034) ------
# The rule's code lives here, ahead of the registry, because its measure is more than one regex.

# A payment row's amount added to a running total: `sum + parseNumber(p.amount)`,
# `total += payment.amount`. Payment rows are called p / pp / pay / payment across the app.
_TS_PAYMENT_SUMS = (
    re.compile(r"\+=?\s*(?:parseNumber|Number|parseFloat)?\(?\s*(?:p|pp|pay|payment)\??\.amount\b"),
    # The shared helpers that add up payment rows: each CALL is a copy (a definition has no `(`).
    re.compile(r"\bgetTotalAmountPaid\("),
    re.compile(r"\buseOrderPayments\("),
)

# A payment cap inside a screen file (the WO page's Request Payment limit) is an allowed owner: it ignores
# refunds on purpose (ADR-0032). It says so with this text on the line, or on a comment line right above it.
CAP_MARKER = "ADR-0034 payment cap"


def _is_comment_line(line: str) -> bool:
    return line.strip().startswith(("//", "*", "/*", "{/*"))


def payment_sum_lines_ts(src: str) -> list[int]:
    """1-based lines of a TS/TSX source that add up Project Payments amounts."""
    lines = src.splitlines()
    out = []
    for i, line in enumerate(lines):
        if _is_comment_line(line) or not any(p.search(line) for p in _TS_PAYMENT_SUMS):
            continue
        above = lines[i - 1] if i > 0 else ""
        if CAP_MARKER in line or (_is_comment_line(above) and CAP_MARKER in above):
            continue
        out.append(i + 1)
    return out


_PAYMENTS = "Project Payments"
_FETCHERS = {"get_all", "get_list", "get_value", "get_values"}


def _is_payment_fetch(node: ast.AST) -> bool:
    """`frappe.get_all("Project Payments", ...)` and its get_list / get_value cousins."""
    if not (isinstance(node, ast.Call) and node.args):
        return False
    name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", None)
    first = node.args[0]
    return name in _FETCHERS and isinstance(first, ast.Constant) and first.value == _PAYMENTS


def _reads_amount(expr: ast.AST, var: str) -> bool:
    """`var.amount`, `var["amount"]` or `var.get("amount")` somewhere inside `expr`."""
    for n in ast.walk(expr):
        if isinstance(n, ast.Attribute) and n.attr == "amount" and getattr(n.value, "id", None) == var:
            return True
        if (isinstance(n, ast.Subscript) and getattr(n.value, "id", None) == var
                and isinstance(n.slice, ast.Constant) and n.slice.value == "amount"):
            return True
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "get"
                and getattr(n.func.value, "id", None) == var and n.args
                and isinstance(n.args[0], ast.Constant) and n.args[0].value == "amount"):
            return True
    return False


_JINJA_PAYMENT_LOOP = re.compile(r'\{%-?\s*for\s+(\w+)\s+in\s+frappe\.get_all\(\s*["\']' + _PAYMENTS)
_JINJA_ENDFOR = re.compile(r"\{%-?\s*endfor")


def payment_sum_lines_jinja(src: str) -> list[int]:
    """1-based lines of a Jinja print format that add up the rows of a Project Payments loop."""
    out, var = [], None
    for i, line in enumerate(src.splitlines()):
        loop = _JINJA_PAYMENT_LOOP.search(line)
        if loop:
            var = loop.group(1)
        elif var and _JINJA_ENDFOR.search(line):
            var = None
        elif var and re.search(r"\+\s*\(?\s*" + var + r"\.amount\b", line):
            out.append(i + 1)
    return out


# SUM(amount), SUM(pp.amount), SUM(CAST(amount AS numeric)), COALESCE inside or out. Group 1: the alias.
_SQL_SUM_AMOUNT = re.compile(r'SUM\(\s*(?:(?:CAST|COALESCE)\(\s*)*(?:"?(\w+)"?\.)?"?amount"?\b', re.IGNORECASE)
_SQL_FIRST_FROM = re.compile(r'FROM\s+[`"]?tab([^`"]+)[`"]?', re.IGNORECASE)


def _sql_payment_sums(sql: str) -> list[int]:
    """Offsets of each SUM over a Project Payments amount in one SQL string. With an alias the alias must
    name the payments table; without one, the first FROM after the SUM must be the payments table."""
    out = []
    for m in _SQL_SUM_AMOUNT.finditer(sql):
        alias = m.group(1)
        if alias:
            hit = re.search(r'tab' + _PAYMENTS + r'[`"]?\s+(?:AS\s+)?' + re.escape(alias) + r'\b', sql, re.IGNORECASE)
        else:
            nxt = _SQL_FIRST_FROM.search(sql, m.end())
            hit = nxt is not None and nxt.group(1) == _PAYMENTS
        if hit:
            out.append(m.start())
    return out


def _string_values(node: ast.AST, str_names: dict[str, list[str]]) -> list[str]:
    """String constants inside `node`, with a bare Name read through its assignments (`fields=[sum_field]`)."""
    out = []
    for n in ast.walk(node):
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            out.append(n.value)
        elif isinstance(n, ast.Name):
            out.extend(str_names.get(n.id, []))
    return out


def payment_sum_lines_py(src: str) -> list[int]:
    """1-based lines of a Python source that add up Project Payments amounts."""
    tree = ast.parse(src)

    # Docstrings are prose, not SQL.
    docstrings = {
        id(body[0].value) for body in (getattr(n, "body", None) for n in ast.walk(tree))
        if isinstance(body, list) and body and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str)
    }
    str_names: dict[str, list[str]] = {}
    for n in ast.walk(tree):
        if isinstance(n, ast.Assign) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    str_names.setdefault(t.id, []).append(n.value.value)

    # Names that hold fetched payment rows: `x = get_all("Project Payments")`, `x.extend(get_all(...))`.
    row_names: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Assign) and _is_payment_fetch(n.value):
            row_names.update(t.id for t in n.targets if isinstance(t, ast.Name))
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "extend"
                and isinstance(n.func.value, ast.Name) and n.args and _is_payment_fetch(n.args[0])):
            row_names.add(n.func.value.id)

    def is_rows(it: ast.AST) -> bool:
        return _is_payment_fetch(it) or (isinstance(it, ast.Name) and it.id in row_names)

    lines: set[int] = set()
    for n in ast.walk(tree):
        # SQL: SUM over the payments table, in a plain or f-string literal.
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docstrings:
            lines.update(n.lineno + n.value[:at].count("\n") for at in _sql_payment_sums(n.value))
        # get_all("Project Payments", fields=["sum(amount) ..."])
        if _is_payment_fetch(n):
            fields = [kw.value for kw in n.keywords if kw.arg in ("fields", "fieldname")] + n.args[2:3]
            if any(re.search(r"sum\s*\(.*amount", s, re.IGNORECASE)
                   for f in fields for s in _string_values(f, str_names)):
                lines.add(n.lineno)
        # sum(<amount of p> for p in <payment rows>)
        if (isinstance(n, ast.Call) and getattr(n.func, "id", None) == "sum" and n.args
                and isinstance(n.args[0], (ast.GeneratorExp, ast.ListComp))):
            gen = n.args[0].generators[0]
            if is_rows(gen.iter) and isinstance(gen.target, ast.Name) and _reads_amount(n.args[0].elt, gen.target.id):
                lines.add(n.lineno)
        # for p in <payment rows>: total += <amount of p>
        if isinstance(n, ast.For) and is_rows(n.iter) and isinstance(n.target, ast.Name):
            for s in ast.walk(n):
                if (isinstance(s, ast.AugAssign) and isinstance(s.op, (ast.Add, ast.Sub))
                        and _reads_amount(s.value, n.target.id)):
                    lines.add(s.lineno)
                    break
    return sorted(lines)


# The allowed owners of a payment sum (ADR-0034), and why. Anything else that adds up payments to show a
# paid figure must read the order's stored `amount_paid` / `amount_due` instead.
PAYMENT_SUM_OWNERS: dict[str, str] = {
    # The Amount Paid rule itself and its judge.
    "nirmaan_stack/services/amount_paid.py": "amount_paid_of: THE rule (Paid payments, plus a WO's TDS withheld from the vendor, less Received refunds)",
    "nirmaan_stack/services/amount_paid_drift.py": "the mismatch service: recomputes the rule to judge the stored figure",
    # Project outflow is cash, a payment sum by definition (ADR-0034 point 5, #1456).
    "nirmaan_stack/services/project_money.py": "project outflow / Current Liabilities / cashflow gap: the one server figure",
    # Amount Paid carries no date; a vendor's paid figure for a period applies the same rule to dated rows (#1461).
    "nirmaan_stack/services/vendor_paid.py": "Vendor report's dated paid figures: payments plus WO TDS withheld, less Received refunds, each on its own date",
    # Payment caps: ignore refunds on purpose (ADR-0032).
    "nirmaan_stack/services/finance.py": "server caps: get_total_paid / _pending / _reconciliation_pending",
    "nirmaan_stack/services/payment_summary.py": "the request / approve 'left to request' cap",
    "nirmaan_stack/services/order_payments.py": "the Work Order payment limit",
    "nirmaan_stack/nirmaan_stack/doctype/project_payments/project_payments.py":
        "the payment's insert cap (payment total <= order total)",
    # Bank cash-out lists: list payments, never a paid figure of an order.
    "nirmaan_stack/api/payments/get_project_payment_summary.py": "payments dashboard, incl. the 30-day outflow card",
    "frontend/src/pages/reports/hooks/useOutflowReportData.ts": "the Outflow report",
    "frontend/src/pages/reports/components/WOPaymentVoucherReport.tsx": "the WO Payment Voucher report",
    # Not an owner: the generic helper. Each `getTotalAmountPaid(` CALL is counted instead of its body.
    "frontend/src/utils/getAmounts.ts": "getTotalAmountPaid's body (its call sites are counted)",
}


def payment_sum_copies() -> list[str]:
    """Every `path:line` outside PAYMENT_SUM_OWNERS that adds up Project Payments amounts. Test files and
    patches (append-only history) are not scanned. A cap inside a screen file carries CAP_MARKER."""
    found = []
    scans = (
        (iter_files("nirmaan_stack", (".py",)), payment_sum_lines_py),
        (iter_files("frontend/src", (".ts", ".tsx")), payment_sum_lines_ts),
        (iter_files("frontend/src", (".html",)), payment_sum_lines_jinja),
    )
    for files, lines_of in scans:
        for p in files:
            rel = p.relative_to(REPO_ROOT).as_posix()
            if rel in PAYMENT_SUM_OWNERS or p.name.startswith("test_") or ".test." in p.name or "/patches/" in rel:
                continue
            try:
                hits = lines_of(read(p))
            except SyntaxError:
                hits = []
            found.extend((rel, n) for n in hits)
    return [f"{rel}:{n}" for rel, n in sorted(found)]


# --- Rules S1, R1: what the code review kept finding by hand (retro of spec #1442) --------------
# (A1, the `any` count, moved to the lint's no-explicit-any: ADR-0049; oxlint since #1699.)
# Hand-written source only: tests, patches (append-only) and shadcn's generated components are left out.

def _hand_written(p: Path) -> bool:
    rel = p.relative_to(REPO_ROOT).as_posix()
    return not (p.name.startswith("test_") or ".test." in p.name or "/patches/" in rel
                or rel.startswith("frontend/src/components/ui/"))


def _source_files() -> list[Path]:
    return [p for p in iter_files("nirmaan_stack", (".py",)) + iter_files("frontend/src", (".ts", ".tsx"))
            if _hand_written(p)]


MAX_FILE_LINES = 500  # CODING_STANDARDS.md § Where code goes, "File size"


def oversized_files() -> list[str]:
    """Every hand-written source file over MAX_FILE_LINES, as `path (N lines)`."""
    found = []
    for p in _source_files():
        n = read(p).count("\n")
        if n > MAX_FILE_LINES:
            found.append(f"{p.relative_to(REPO_ROOT).as_posix()} ({n} lines)")
    return sorted(found)


# A function that turns a number into "₹1,234" text. The homes stay; every other one is a copy.
RUPEE_FORMATTER_HOMES = {
    "nirmaan_stack/services/outflow_import/amounts.py",  # amounts.rupees(amount, paise=...)
    "frontend/src/utils/FormatPrice.ts",                 # formatToIndianRupee and its rounded forms
}
_PY_RUPEE_DEF = re.compile(r"^\s*def\s+\w*rupee\w*\s*\(", re.IGNORECASE)
_TS_RUPEE_DEF = re.compile(
    r"^\s*(?:export\s+)?(?:function\s+\w*rupee\w*\s*[(<]|const\s+\w*rupee\w*\s*=\s*(?:\(|async\b|function\b|\w+\s*=>))",
    re.IGNORECASE,
)


def rupee_formatter_lines(src: str, suffix: str) -> list[int]:
    """1-based lines that define a rupee formatter, in a .py or a .ts/.tsx source."""
    pattern = _PY_RUPEE_DEF if suffix == ".py" else _TS_RUPEE_DEF
    return [i + 1 for i, line in enumerate(src.splitlines()) if pattern.search(line)]


def rupee_formatters() -> list[str]:
    found = []
    for p in _source_files():
        rel = p.relative_to(REPO_ROOT).as_posix()
        if rel not in RUPEE_FORMATTER_HOMES:
            found.extend(f"{rel}:{n}" for n in rupee_formatter_lines(read(p), p.suffix))
    return found


# P1's second shape (#1509): a Work Order's tax added onto its Amount Paid. Since ADR-0034 Amendment A the
# stored `amount_paid` already holds the TDS withheld from the vendor, so `amount_paid + total_tds` (or a
# deduction's `tds_amount`) counts it twice. Either order, one line, any language (TS, Python, SQL, Jinja).
_TAX = r"\b(?:total_tds|tds_amount)\b"
_TDS_ONTO_AMOUNT_PAID = (
    re.compile(r"\bamount_paid\b[^;\n]*?\+[^;\n]*?" + _TAX),
    re.compile(_TAX + r"[^;\n]*?\+[^;\n]*?\bamount_paid\b"),
)


def tds_added_to_amount_paid_lines(src: str) -> list[int]:
    """1-based lines of a source (TS, Python, SQL, Jinja) that add a Work Order's tax onto its Amount Paid.
    Comment lines (`//`, `*`, `#`) are prose, not code."""
    return [
        i + 1 for i, line in enumerate(src.splitlines())
        if not (_is_comment_line(line) or line.strip().startswith("#"))
        and any(p.search(line) for p in _TDS_ONTO_AMOUNT_PAID)
    ]


def tds_added_to_amount_paid() -> list[str]:
    """Every `path:line` outside PAYMENT_SUM_OWNERS that adds `total_tds` / `tds_amount` onto
    `amount_paid`. Test files and patches are not scanned."""
    found = []
    for p in iter_files("nirmaan_stack", (".py",)) + iter_files("frontend/src", (".ts", ".tsx", ".html")):
        rel = p.relative_to(REPO_ROOT).as_posix()
        if rel in PAYMENT_SUM_OWNERS or p.name.startswith("test_") or ".test." in p.name or "/patches/" in rel:
            continue
        found.extend(f"{rel}:{n}" for n in tds_added_to_amount_paid_lines(read(p)))
    return sorted(found)


# --- Rule J1: the `.json()` ban of ADR-0049 ----------------------------------------
# `response.json()` returns `any`; parseJson(await response.text()) returns `unknown`. ESLint banned it with
# no-restricted-syntax, which oxlint does not have (#1699), so it lives here. Its old calls are frozen per file in
# JSON_CALL_SUPPRESSIONS, in oxlint's suppressions shape, so a new call fails even where another file loses one.

JSON_CALL_SUPPRESSIONS = "frontend/json-call-suppressions.json"
JSON_CALL_RULE = "no-json-call"
# The ban's own home, and the generated shadcn/ui primitives the lint does not read either.
JSON_CALL_EXEMPT = ("frontend/src/lib/parseJson.ts", "frontend/src/components/ui/")
# J1's parser: TypeScript's own (frontend/scripts/json_calls.mjs), run by node with frontend/node_modules.
JSON_CALL_PARSER = "frontend/scripts/json_calls.mjs"


def json_call_counts(sources: dict[str, str]) -> dict[str, int]:
    """The `.json()` calls in each TS/TSX source, keyed as given (a key ending in .tsx is parsed as TSX)."""
    return run_ts_parser(JSON_CALL_PARSER, sources)


def json_call_count(src: str) -> int:
    """The `.json()` calls in one TS source's code (not its comments or strings)."""
    return json_call_counts({"source.ts": src})["source.ts"]


def json_call_drift(found: dict[str, int], frozen: dict[str, dict]) -> list[str]:
    """Each file whose `.json()` calls differ from its frozen count, one line each; empty when all hold.

    ``found`` and ``frozen`` are keyed by paths relative to frontend/; ``frozen`` is in oxlint's suppressions shape
    ({path: {rule: {"count": n}}}), and only its JSON_CALL_RULE entries count. A lower count fails too
    (frozen_counts.frozen_drift)."""
    calls = {path: {JSON_CALL_RULE: {"count": n}} for path, n in found.items()}
    allowed = {path: {JSON_CALL_RULE: rules[JSON_CALL_RULE]}
               for path, rules in frozen.items() if JSON_CALL_RULE in rules}
    over, under = frozen_drift(calls, allowed,
                               lambda path, _, now, was: f"frontend/{path}: {now} .json() calls, {was} frozen")
    return sorted([f"{line} (a new call: use parseJson)" for line in over]
                  + [f"{line} (fewer: lower its count in {JSON_CALL_SUPPRESSIONS})" for line in under])


def reasoned_drift(found: dict[str, int], frozen: dict[str, dict], rule: str, *, what: str, new_hint: str,
                   frozen_file: str, prefix: str = "") -> list[str]:
    """Q1's and L2's drift: each file whose count of ``what`` differs from its frozen count (frozen_counts.frozen_drift,
    over and under), and each frozen entry with no one-line ``reason`` why it stays; empty when all hold.

    ``frozen`` is in oxlint's suppressions shape and only its ``rule`` entries count; ``prefix`` turns a key of
    ``found`` into a repo path."""
    counts = {path: {rule: {"count": n}} for path, n in found.items()}
    entries = {path: {rule: rules[rule]} for path, rules in frozen.items() if rule in rules}
    over, under = frozen_drift(counts, entries, lambda path, _, now, was: f"{prefix}{path}: {now} {what}, {was} frozen")
    no_reason = [f"{prefix}{path}: frozen with no reason (say in one line why it is not a background operation)"
                 for path, rules in entries.items()
                 if found.get(path, 0) == rules[rule].get("count", 0) and not str(rules[rule].get("reason", "")).strip()]
    return sorted([f"{line} ({new_hint})" for line in over]
                  + [f"{line} (fewer: lower its count in {frozen_file})" for line in under]
                  + no_reason)


def json_calls_unfrozen() -> list[str]:
    """J1 over the tree: the files whose `.json()` calls differ from JSON_CALL_SUPPRESSIONS.

    When the parser cannot run, that is J1's one finding (frozen_counts.node_cannot_run)."""
    sources = {}
    for p in iter_files("frontend/src", (".ts", ".tsx")):
        rel = p.relative_to(REPO_ROOT).as_posix()
        if not rel.startswith(JSON_CALL_EXEMPT):
            sources[rel.removeprefix("frontend/")] = read(p)
    try:
        found = {path: n for path, n in json_call_counts(sources).items() if n}
    except TsParserError as e:
        return node_cannot_run("J1", ".json() calls", e)
    return json_call_drift(found, read_frozen(JSON_CALL_SUPPRESSIONS))


# --- Rule L1: the SDK's listener hooks (#1670) --------------------------------------
# frappe-react-sdk's useFrappeEventListener, useFrappeDocumentEventListener and useFrappeDocTypeEventListener remove
# every listener of their event, and leave their document or doctype room for the whole tab, when one component
# unmounts. src/lib/frappe.ts exports safe listeners in their place and does not re-export these, so oxlint's
# SDK-import ban covers new files. It does not cover a file oxlint-suppressions.json already freezes for an SDK import:
# a raw name added to that import keeps the file's count. Retire L1 once that file holds no no-restricted-imports entry.

RAW_LISTENER_HOME = "frontend/src/lib/frappe.ts"
_RAW_LISTENER = re.compile(r"\buseFrappe(?:Event|DocumentEvent|DocTypeEvent)Listener\b")


def raw_listener_lines(src: str) -> list[int]:
    """The 1-based lines of one TS source that name a raw SDK listener hook, comments included."""
    return [i + 1 for i, line in enumerate(src.splitlines()) if _RAW_LISTENER.search(line)]


def raw_listener_uses() -> list[str]:
    """Every `path:line` under frontend/src, outside RAW_LISTENER_HOME, that names a raw SDK listener hook."""
    found = []
    for p in iter_files("frontend/src", (".ts", ".tsx")):
        rel = p.relative_to(REPO_ROOT).as_posix()
        if rel != RAW_LISTENER_HOME:
            found.extend(f"{rel}:{n}" for n in raw_listener_lines(read(p)))
    return sorted(found)


# --- Rule L2: a raw socket listener outside its homes (ADR-0047, #1671) ----------------------------------------------
# A screen follows a background operation with useBackgroundOperation (src/hooks/useBackgroundOperation.ts), which
# reads the operation's status record and takes the socket's message only as "read now". A raw `socket.on` of its own
# is where a screen took another operation's result. A live event that is not an operation (a doc change, a cheque)
# is listened to with useSocketEventListener (L1's safe hook, counted only when its event is an operation's) or
# registered globally in src/services/socketListeners.ts. The raw listeners that stay (locks) are frozen per file,
# each with its reason, in SOCKET_LISTENER_SUPPRESSIONS; scripts/frontend_ratchet_check.py refuses a count that rises
# in a pull request.

SOCKET_LISTENER_SUPPRESSIONS = "frontend/socket-listener-suppressions.json"
SOCKET_LISTENER_RULE = "no-socket-listener"
# The shared hook, the safe listeners' home (src/lib/frappe.ts: useSocketEventListener's own `socket.on`), and the
# tab's global notification listeners (frontend/CODING_STANDARDS.md § Realtime events).
SOCKET_LISTENER_HOMES = ("frontend/src/hooks/useBackgroundOperation.ts", "frontend/src/lib/frappe.ts",
                         "frontend/src/services/socketListeners.ts")
SOCKET_LISTENER_PARSER = "frontend/scripts/socket_listeners.mjs"


def socket_listener_counts(sources: dict[str, str]) -> dict[str, int]:
    """The raw socket listeners in each TS/TSX source, keyed as given."""
    return run_ts_parser(SOCKET_LISTENER_PARSER, sources)


def socket_listener_count(src: str, path: str = "source.ts") -> int:
    """The raw socket listeners in one TS source's code (not its comments or strings)."""
    return socket_listener_counts({path: src})[path]


def socket_listeners_found() -> dict[str, int]:
    """{path relative to frontend/: socket listeners} over frontend/src, outside SOCKET_LISTENER_HOMES and test files.

    Raises TsParserError when the parser cannot run."""
    sources = {}
    for p in iter_files("frontend/src", (".ts", ".tsx")):
        rel = p.relative_to(REPO_ROOT).as_posix()
        if rel not in SOCKET_LISTENER_HOMES and ".test." not in p.name:
            sources[rel.removeprefix("frontend/")] = read(p)
    return {path: n for path, n in socket_listener_counts(sources).items() if n}


def socket_listener_drift(found: dict[str, int], frozen: dict[str, dict]) -> list[str]:
    """L2's drift, keyed by paths relative to frontend/."""
    return reasoned_drift(found, frozen, SOCKET_LISTENER_RULE, what="socket listeners",
                          new_hint="a new one: follow a background operation with useBackgroundOperation",
                          frozen_file=SOCKET_LISTENER_SUPPRESSIONS, prefix="frontend/")


def socket_listeners_unfrozen() -> list[str]:
    """L2 over the tree: the files whose socket listeners differ from SOCKET_LISTENER_SUPPRESSIONS. When the parser
    cannot run, that is L2's one finding."""
    try:
        found = socket_listeners_found()
    except TsParserError as e:
        return node_cannot_run("L2", "socket listeners", e)
    return socket_listener_drift(found, read_frozen(SOCKET_LISTENER_SUPPRESSIONS))


# --- Rule N1: no counted names on doctypes background operations write (ADR-0048, #1661) ------------------
# A counted name takes the next number from one `tabSeries` row under SELECT ... FOR UPDATE; two overlapping
# transactions that take one fail with SerializationFailure (REPEATABLE READ). These doctypes are written by
# background operations, so they are named `hash`.

DOCTYPE_DIR = REPO_ROOT / "nirmaan_stack/nirmaan_stack/doctype"
BACKGROUND_WRITTEN_DOCTYPES = [
    "BoQ Review Row", "BoQ Row Category",                  # #1656
    "BoQ Rate Suggestion Run", "BoQ Rate Match Run",       # #1657
    "BoQ Cell Pricing", "Project Action Item",             # #1658
    "Outflow Row Match", "Expense Bill", "Nirmaan Attachments",  # #1719
]
# The listed doctypes not switched yet, each with the ticket that switches it. It only shrinks: a doctype that
# switched fails until it leaves this list, and a new entry is a review question.
COUNTED_NAME_WAITING: dict[str, str] = {}

_COUNTING_CALLS = {"getseries", "make_autoname"}


def autoname_counts(autoname: str) -> bool:
    """Does a doctype's `autoname` take a number from tabSeries? Frappe's `set_name_from_naming_options`:
    `naming_series:` always counts, and `format:` or a plain pattern counts when it holds `#`. Everything else
    takes no number: `hash`, empty (hash), `UUID`, `autoincrement` (a DB sequence, no row lock), `field:`, `Prompt`."""
    lowered = autoname.strip().lower()
    if lowered.startswith("naming_series:"):
        return True
    return "#" in lowered and not lowered.startswith(("field:", "prompt"))


def counting_call_lines(src: str) -> list[int]:
    """1-based lines of a controller's code that call `getseries` or `make_autoname` with anything but the
    literal "hash" (comments and docstrings are not code). Either call takes a number from tabSeries."""
    lines = []
    for n in ast.walk(ast.parse(src)):
        if not isinstance(n, ast.Call):
            continue
        name = n.func.attr if isinstance(n.func, ast.Attribute) else getattr(n.func, "id", None)
        if name not in _COUNTING_CALLS:
            continue
        first = n.args[0] if n.args else None
        if name == "make_autoname" and isinstance(first, ast.Constant) and first.value == "hash":
            continue
        lines.append(n.lineno)
    return sorted(lines)


def counted_names_on_background_doctypes(doctype_dir: Path, doctypes: list[str],
                                         waiting: dict[str, str]) -> list[str]:
    """Each listed doctype that takes a counted name (its JSON `autoname`, or its controller `<scrub>.py`), one
    line each, skipping the ones in ``waiting``; and each ``waiting`` doctype that no longer counts (it must
    leave the waiting list). A listed doctype with no folder is a finding too (renamed: update the list)."""
    found = []
    for doctype in doctypes:
        scrub = doctype.lower().replace(" ", "_")
        spec, controller = doctype_dir / scrub / f"{scrub}.json", doctype_dir / scrub / f"{scrub}.py"
        if not spec.exists():
            found.append(f"{doctype}: no {scrub}/{scrub}.json (renamed? update BACKGROUND_WRITTEN_DOCTYPES)")
            continue
        where = []
        autoname = json.loads(read(spec)).get("autoname") or ""
        if autoname_counts(autoname):
            where.append(f"{doctype}: autoname {autoname!r} in {scrub}/{scrub}.json")
        if controller.exists():
            where.extend(f"{doctype}: counted name at {scrub}/{scrub}.py:{n}" for n in counting_call_lines(read(controller)))
        if doctype in waiting:
            if not where:
                found.append(f"{doctype}: no longer counted, remove it from COUNTED_NAME_WAITING ({waiting[doctype]})")
            continue
        found.extend(where)
    return found


def counted_names() -> list[str]:
    """N1's findings for this repo: BACKGROUND_WRITTEN_DOCTYPES read from the doctype folders, less
    COUNTED_NAME_WAITING. It reads only the JSON and the controller file, not the DB or hooks."""
    return counted_names_on_background_doctypes(DOCTYPE_DIR, BACKGROUND_WRITTEN_DOCTYPES, COUNTED_NAME_WAITING)


# --- Rule Q1: a raw RQ job enqueue outside the background-operation module (ADR-0047, #1671) -------------------------
# services/background_ops.start queues an RQ job only after writing the status record its owner's screen follows. A raw
# enqueue has no record, so its screen falls back to hand-written socket code. The old enqueues are frozen per file,
# each with its reason, in RAW_ENQUEUE_SUPPRESSIONS (oxlint's suppressions shape), so a new one fails even where
# another file loses one; scripts/frontend_ratchet_check.py refuses a count that rises in a pull request.

RAW_ENQUEUE_HOME = "nirmaan_stack/services/background_ops.py"
RAW_ENQUEUE_SUPPRESSIONS = "scripts/raw-enqueue-suppressions.json"
RAW_ENQUEUE_RULE = "no-raw-enqueue"
_ENQUEUE_CALLS = {"enqueue", "enqueue_doc"}
_ENQUEUE_MODULES = {"frappe", "frappe.utils.background_jobs"}


def _names_background_jobs(node: ast.AST, aliases: set[str]) -> bool:
    """`frappe`, `frappe.utils.background_jobs`, or a name bound to that module."""
    if isinstance(node, ast.Name):
        return node.id == "frappe" or node.id in aliases
    return isinstance(node, ast.Attribute) and node.attr == "background_jobs"


def _is_get_queue(node: ast.AST) -> bool:
    """`get_queue(...)` or `<module>.get_queue(...)`: RQ's queue, whose own `enqueue` queues an RQ job."""
    if not isinstance(node, ast.Call):
        return False
    return getattr(node.func, "id", None) == "get_queue" or getattr(node.func, "attr", None) == "get_queue"


def raw_enqueue_lines(src: str) -> list[int]:
    """1-based lines of a Python source that queue an RQ job: `frappe.enqueue` / `enqueue_doc`, the same names imported
    from frappe or frappe.utils.background_jobs (under any alias), and RQ's own `enqueue_call`, or `enqueue` on a
    `get_queue(...)`."""
    tree = ast.parse(src)
    imported, modules = set(), set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and n.module in _ENQUEUE_MODULES:
            imported.update(a.asname or a.name for a in n.names if a.name in _ENQUEUE_CALLS)
        if isinstance(n, ast.ImportFrom) and n.module == "frappe.utils":
            modules.update(a.asname or a.name for a in n.names if a.name == "background_jobs")
        if isinstance(n, ast.Import):
            modules.update(a.asname for a in n.names if a.name == "frappe.utils.background_jobs" and a.asname)
    lines = set()
    for n in ast.walk(tree):
        if not isinstance(n, ast.Call):
            continue
        func = n.func
        if isinstance(func, ast.Name) and func.id in imported:
            lines.add(n.lineno)
        elif isinstance(func, ast.Attribute) and (
                func.attr == "enqueue_call"
                or (func.attr in _ENQUEUE_CALLS and _names_background_jobs(func.value, modules))
                or (func.attr == "enqueue" and _is_get_queue(func.value))):
            lines.add(n.lineno)
    return sorted(lines)


def raw_enqueues_found() -> dict[str, int]:
    """{repo path: raw enqueues} over nirmaan_stack/, outside RAW_ENQUEUE_HOME and test files (`test_*.py`)."""
    found = {}
    for p in iter_files("nirmaan_stack", (".py",)):
        rel = p.relative_to(REPO_ROOT).as_posix()
        if rel == RAW_ENQUEUE_HOME or p.name.startswith("test_"):
            continue
        try:
            n = len(raw_enqueue_lines(read(p)))
        except SyntaxError:
            n = 0
        if n:
            found[rel] = n
    return found


def raw_enqueue_drift(found: dict[str, int], frozen: dict[str, dict]) -> list[str]:
    """Q1's drift, keyed by repo paths."""
    return reasoned_drift(found, frozen, RAW_ENQUEUE_RULE, what="raw enqueues",
                          new_hint="a new one: start a background operation with services/background_ops.start",
                          frozen_file=RAW_ENQUEUE_SUPPRESSIONS)


def raw_enqueues_unfrozen() -> list[str]:
    """Q1 over the tree: the files whose raw enqueues differ from RAW_ENQUEUE_SUPPRESSIONS."""
    return raw_enqueue_drift(raw_enqueues_found(), read_frozen(RAW_ENQUEUE_SUPPRESSIONS))


# --- check registry ----------------------------------------------------------

@dataclass
class Check:
    id: str
    rule: str            # ADR-0010 rule id (B1, B3, F2, ...)
    description: str
    route_hint: str      # printed on FAILURE — tells the violator where the concept lives
    measure: Callable[[], int]
    # Optional: each counted violation as `path:line`. Printed on failure, and for every check by --list.
    locate: Callable[[], list[str]] | None = None
    # Set: the count must be at most this, whatever the baseline file says (a PR edits that file too).
    pass_mark: int | None = None


_GET_VALUE_ANY_ROW = re.compile(r"""get_value\(\s*["'][^"']+["']\s*,\s*\{\s*\}""")


def tests_picking_any_row() -> list[str]:
    found = []
    for p in iter_files("nirmaan_stack", (".py",)):
        if p.name.startswith("test_"):
            rel = p.relative_to(REPO_ROOT).as_posix()
            found.extend(f"{rel}:{i + 1}" for i, line in enumerate(read(p).splitlines())
                         if _GET_VALUE_ANY_ROW.search(line))
    return sorted(found)



# freeze_time needs freezegun, which the dev bench does not install: a test using it errors at import (#1607).
_FREEZE_TIME = re.compile(r"\bfreeze_time\(")


def tests_freezing_time() -> list[str]:
    found = []
    for p in iter_files("nirmaan_stack", (".py",)):
        if p.name.startswith("test_"):
            rel = p.relative_to(REPO_ROOT).as_posix()
            found.extend(f"{rel}:{i + 1}" for i, line in enumerate(read(p).splitlines())
                         if _FREEZE_TIME.search(line) and not line.lstrip().startswith("#"))
    return sorted(found)

CHECKS: list[Check] = [
    Check(
        id="b3_workflow_state_writers",
        rule="B3",
        description="Lines that assign workflow_state in api/ + integrations/ (state should be derived, not written ad-hoc).",
        route_hint="workflow_state has no assigned deriver yet (ADR-0010 Candidate 6) — do NOT add a new writer; "
                   "see the Residence manifest in .claude/context/domain/procurement.md",
        measure=lambda: count_lines(
            iter_files("nirmaan_stack/api", (".py",)) + iter_files("nirmaan_stack/integrations", (".py",)),
            re.compile(r"workflow_state\s*=(?!=)"),
        ),
    ),
    Check(
        id="b1_pure_module_purity",
        rule="B1",
        description="Database reads through frappe (db, qb, get_all, get_doc, get_cached_value, ...) inside declared PURE_MODULES (a pure module must have none).",
        route_hint="a PURE_MODULES entry reached into frappe.db — move the data access to a thin orchestrator "
                   "and keep the module pure, or remove it from PURE_MODULES (see ADR-0010 rule B1).",
        measure=lambda: len(pure_module_impurities()),
        locate=pure_module_impurities,
    ),
    # Not an ADR-0010 residence rule: a test-data rule that rides this ratchet because it is the
    # repo's one counting check. `get_value(doctype, {})` returns the most recently MODIFIED row,
    # so any unrelated write (a recount touching every Vendor) changes which record a test gets.
    Check(
        id="t1_tests_pick_any_row",
        rule="T1",
        description="Lines in test_*.py fetching a row with empty filters (get_value(doctype, {}...)): "
                    "the record depends on whatever was modified last.",
        route_hint="put the property the test needs in the filters (e.g. {\"vendor_nickname\": [\"is\", \"set\"]}) "
                   "or create the record in the test's setUp.",
        measure=lambda: len(tests_picking_any_row()),
        locate=tests_picking_any_row,
    ),
    # Baseline 0 from the day it was added (#1607): the bench has no freezegun, so `freeze_time` never runs.
    Check(
        id="t2_tests_freeze_time",
        rule="T2",
        description="Lines in test_*.py calling freeze_time( (FrappeTestCase.freeze_time needs freezegun, "
                    "which the dev bench does not install).",
        route_hint="stop Frappe's clock by patching now_datetime, as api/payees/test_paid_to.py `_site_clock_at` "
                   "does (CODING_STANDARDS.md § Writing tests, Repeatable).",
        measure=lambda: len(tests_freezing_time()),
        locate=tests_freezing_time,
    ),
    # Not an ADR-0010 rule either: ADR-0034 (stored Amount Paid is the one paid figure). Each screen ticket
    # of spec #1451 lowers it; at zero, a new copy fails here. `--list` prints every copy.
    Check(
        id="p1_payment_sum_copies",
        rule="P1",
        description="Lines that add up Project Payments amounts (frontend, backend, print formats) outside the "
                    "allowed owners in PAYMENT_SUM_OWNERS: the Amount Paid rule, the payment caps, the bank "
                    "cash-out lists.",
        route_hint="read the order's stored amount_paid / amount_due (ADR-0034), or the server's project outflow "
                   "for a project total; never add up payments again. A payment cap in a screen file says "
                   f"'{CAP_MARKER}' on the line or the comment line above it.",
        measure=lambda: len(payment_sum_copies()),
        locate=payment_sum_copies,
    ),
    # The two below are not ADR-0010 rules: they are review findings a script can make, so a change
    # meets them at commit time instead of in review (.githooks/pre-commit runs this file).
    Check(
        id="s1_oversized_files",
        rule="S1",
        description=f"Hand-written source files (not tests, patches or components/ui) over {MAX_FILE_LINES} lines.",
        route_hint=f"split the file into focused submodules before it passes {MAX_FILE_LINES} lines "
                   "(CODING_STANDARDS.md § Where code goes, File size).",
        measure=lambda: len(oversized_files()),
        locate=oversized_files,
    ),
    Check(
        id="r1_rupee_formatters",
        rule="R1",
        description="Functions that format rupees outside RUPEE_FORMATTER_HOMES.",
        route_hint="format with services/outflow_import/amounts.rupees (backend) or utils/FormatPrice.ts "
                   "(frontend); never write another rupee formatter.",
        measure=lambda: len(rupee_formatters()),
        locate=rupee_formatters,
    ),
    # P1's second shape (#1509, ADR-0034 Amendment A): baseline 0 from the day it was added.
    Check(
        id="p1_tds_added_to_amount_paid",
        rule="P1",
        description="Lines adding a Work Order's total_tds (or a deduction's tds_amount) onto amount_paid outside "
                    "PAYMENT_SUM_OWNERS: amount_paid already holds the TDS withheld from the vendor, so the "
                    "sum counts it twice.",
        route_hint="read amount_paid as it is (it includes the vendor's TDS); for its parts ask the server "
                   "(api/payments/work_order_tds.get_work_order_tds: withheld, company).",
        measure=lambda: len(tds_added_to_amount_paid()),
        locate=tds_added_to_amount_paid,
    ),
    # ADR-0049's `.json()` ban (#1699), here because oxlint has no no-restricted-syntax. Baseline 0 for good: the
    # old calls are frozen per file in JSON_CALL_SUPPRESSIONS (the ratchet check guards it), and any file off its
    # frozen count fails. Its pass mark is 0, not the baseline file's entry, which a PR could raise.
    Check(
        id="j1_json_calls_unfrozen",
        rule="J1",
        description=f"Frontend files whose .json() calls differ from their frozen count in {JSON_CALL_SUPPRESSIONS}.",
        route_hint="a new call: use parseJson(await response.text()) from '@/lib/parseJson' (ADR-0049); "
                   f"fewer calls: lower that file's count in {JSON_CALL_SUPPRESSIONS} (remove it at 0).",
        measure=lambda: len(json_calls_unfrozen()),
        locate=json_calls_unfrozen,
        pass_mark=0,
    ),
    # #1670: baseline 0 from the day it was added, and its pass mark is 0 whatever the baseline file says.
    Check(
        id="l1_raw_listener_hooks",
        rule="L1",
        description="Frontend lines naming the SDK's useFrappeEventListener, useFrappeDocumentEventListener or "
                    "useFrappeDocTypeEventListener outside src/lib/frappe.ts.",
        route_hint="use useSocketEventListener, useDocumentEventListener or useDocTypeEventListener from "
                   "'@/lib/frappe': they take the same arguments and remove only their own listener and room.",
        measure=lambda: len(raw_listener_uses()),
        locate=raw_listener_uses,
        pass_mark=0,
    ),
    # ADR-0048 (#1661): the doctypes not yet switched wait in COUNTED_NAME_WAITING, by name, so the pass mark is 0
    # and a doctype switched back to a counted name fails even where another one switches.
    Check(
        id="n1_counted_names_on_background_doctypes",
        rule="N1",
        description="Doctypes in BACKGROUND_WRITTEN_DOCTYPES that take a counted name (a tabSeries number from the "
                    "doctype's autoname or its controller's getseries / make_autoname) and are not in "
                    "COUNTED_NAME_WAITING. It reads the doctype JSON and controller only, so it cannot see a "
                    "Document Naming Rule record in the DB, set_name_by_naming_series, or a name set from hooks.",
        route_hint="name it `hash` (Naming Rule Random) through the DocType form, never by hand (ADR-0048); a user-seen "
                   "number keeps its counter behind a session lock per series instead (BoQ numbers, #1659).",
        measure=lambda: len(counted_names()),
        locate=counted_names,
        pass_mark=0,
    ),
    # ADR-0047 (#1671): the listeners that stay are frozen per file, each with its reason, so the pass mark is 0.
    Check(
        id="l2_socket_listeners_unfrozen",
        rule="L2",
        description=f"Frontend files whose raw socket listeners (socket.on / socket.off for an event other than the "
                    f"connection's own) outside {', '.join(SOCKET_LISTENER_HOMES)} differ from their frozen count in "
                    f"{SOCKET_LISTENER_SUPPRESSIONS}.",
        route_hint="follow a background operation with useBackgroundOperation (src/hooks/useBackgroundOperation.ts), "
                   "which reads its status record; never listen for its result. Any other live event: "
                   "useSocketEventListener from '@/lib/frappe'. Fewer listeners: lower that file's count in "
                   f"{SOCKET_LISTENER_SUPPRESSIONS} (remove it at 0).",
        measure=lambda: len(socket_listeners_unfrozen()),
        locate=socket_listeners_unfrozen,
        pass_mark=0,
    ),
    # ADR-0047 (#1671): the old enqueues are frozen per file, each with its reason, in RAW_ENQUEUE_SUPPRESSIONS, so the
    # pass mark is 0 and a new enqueue fails even where another file loses one.
    Check(
        id="q1_raw_enqueues_unfrozen",
        rule="Q1",
        description=f"Backend files whose raw RQ job enqueues (frappe.enqueue / enqueue_doc, RQ's enqueue_call) "
                    f"outside {RAW_ENQUEUE_HOME} differ from their frozen count in {RAW_ENQUEUE_SUPPRESSIONS}.",
        route_hint="queue the work as a background operation: services/background_ops.start (its screen follows it "
                   "with useBackgroundOperation; CODING_STANDARDS.md § Queuing a background operation). Fewer "
                   f"enqueues: lower that file's count in {RAW_ENQUEUE_SUPPRESSIONS} (remove it at 0).",
        measure=lambda: len(raw_enqueues_unfrozen()),
        locate=raw_enqueues_unfrozen,
        pass_mark=0,
    ),
    # ADR-0049's ratchet through a disable comment (#1705): oxlint honours `eslint-disable` and `oxlint-disable`
    # comments, so one above a new `any` passed `yarn lint`. Frozen per file and rule in DISABLE_SUPPRESSIONS (the
    # ratchet check guards it); pass mark 0, as J1's.
    Check(
        id="d1_disable_comments_unfrozen",
        rule="D1",
        description=f"Frontend files and rules with more lint disable comments for an ADR-0049 rule (or naming no "
                    f"rule) than frozen in {DISABLE_SUPPRESSIONS}.",
        route_hint="a new comment: fix the violation instead of disabling the rule (ADR-0049); a comment removed: "
                   f"lower its count with python3 scripts/residence_check.py {PRUNE_FLAG}",
        measure=lambda: len(disable_comments_unfrozen()),
        locate=disable_comments_unfrozen,
        pass_mark=0,
    ),
    # Not an ADR-0010 rule: a merged PR's walk must become rerunnable feature walks (pr-walk SKILL.md step 9). A
    # ratchet, not pass mark 0: PRs 1731 and 1732 merged before the rule, and their graduation lowers it.
    Check(
        id="w1_walks_not_graduated",
        rule="W1",
        description=f"Gaps in the graduation of merged PR walks (.claude/skills/pr-walk/bin/walk_pr_<n>.py): a "
                    f"claimed change with no walk or skip reason in {GRADUATION_LEDGER}, or a named walk that is "
                    "missing, unlisted in the features README, bound to a PR env, or without a passing "
                    "Last walked stamp in its feature file.",
        route_hint="graduate the PR's walk: pr-walk SKILL.md step 9",
        measure=lambda: len(graduation_gaps(REPO_ROOT)),
        locate=lambda: graduation_gaps(REPO_ROOT),
    ),
]


# --- the ratchet policy -------------------------------------------------------

class Verdict(NamedTuple):
    ok: bool
    message: str
    new_baseline: int | None  # non-None => rewrite this check's baseline to this value


def compare(check_id: str, current: int, baseline: int) -> Verdict:
    """The auto-tightening ratchet: counts may only move down.

    Above baseline fails the run; below baseline passes AND lowers the committed
    baseline, so retired debt can never silently creep back. Pure — no I/O; the
    main loop applies ``new_baseline`` and rewrites the JSON.
    """
    if current > baseline:
        delta = current - baseline
        return Verdict(
            ok=False,
            message=f"{delta} NEW violation(s) introduced ({baseline} -> {current}) — remove them or route through the owner",
            new_baseline=None,
        )
    if current < baseline:
        return Verdict(
            ok=True,
            message=f"debt retired ({baseline} -> {current}) — baseline tightened, nice",
            new_baseline=current,
        )
    return Verdict(ok=True, message=f"holding at {current}", new_baseline=None)


def changed_paths() -> set[str] | None:
    """Repo-relative paths changed since HEAD (staged, unstaged, untracked); None outside git."""
    paths: set[str] = set()
    for cmd in (["diff", "--name-only", "HEAD"], ["ls-files", "--others", "--exclude-standard"]):
        try:
            out = subprocess.run(["git", "-C", str(REPO_ROOT), *cmd], capture_output=True, text=True, check=True)
        except (OSError, subprocess.CalledProcessError):
            return None
        paths.update(filter(None, out.stdout.splitlines()))
    return paths


LOCATIONS_SHOWN = 20


def locations_to_show(where: list[str], changed: set[str] | None = None) -> list[str]:
    """On a failure, the violations in files this change touches; with none of those, the first few."""
    changed = changed_paths() if changed is None else changed
    mine = [loc for loc in where if re.split(r"[: ]", loc, maxsplit=1)[0] in (changed or set())]
    if mine:
        return mine
    if len(where) <= LOCATIONS_SHOWN:
        return where
    return where[:LOCATIONS_SHOWN] + [f"... {len(where) - LOCATIONS_SHOWN} more (--list prints them all)"]


# --- baseline I/O + entry points ---------------------------------------------

def measure_all() -> dict[str, dict]:
    return {
        c.id: {"count": c.measure(), "rule": c.rule, "description": c.description}
        for c in CHECKS
    }


def write_baseline(data: dict[str, dict], path: Path = BASELINE_PATH) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def do_init() -> int:
    data = measure_all()
    write_baseline(data)
    print(f"Wrote baseline -> {BASELINE_PATH.relative_to(REPO_ROOT)}")
    for cid, entry in sorted(data.items()):
        print(f"  {cid}: {entry['count']}")
    return 0


# The checks CI runs on every pull request: the ones that are not ADR-0010 rules (ADR-0049). ADR-0010's two
# counters (B1, B3) run in the local hook only (ADR-0010 amendment, 2026-11-18).
CI_SUBSET = ["S1", "R1", "p1_payment_sum_copies", "p1_tds_added_to_amount_paid", "T1", "T2", "J1", "D1", "L1", "N1",
             "Q1", "L2", "W1"]


def select_checks(checks: list[Check], names: list[str]) -> list[Check]:
    """The checks a name list picks: each name is a check id or a rule id (a rule picks all its checks).
    Raises ValueError naming the names that match no check."""
    unknown = [n for n in names if not any(n in (c.id, c.rule) for c in checks)]
    if unknown:
        raise ValueError(", ".join(unknown))
    return [c for c in checks if c.id in names or c.rule in names]


def do_check(checks: list[Check], baseline_path: Path, list_all: bool = False, tighten: bool = True) -> int:
    if not baseline_path.exists():
        print(f"No baseline at {baseline_path} — run with --init first.", file=sys.stderr)
        return 2
    baseline = json.loads(read(baseline_path))

    failed = False
    rewrites: dict[str, int] = {}
    for c in checks:
        where = c.locate() if c.locate else None
        current = len(where) if where is not None else c.measure()
        base_count = c.pass_mark if c.pass_mark is not None else baseline.get(c.id, {}).get("count", 0)
        verdict = compare(c.id, current, base_count)
        mark = "✓" if verdict.ok else "✗"
        message = verdict.message
        if verdict.new_baseline is not None and not tighten:
            message = f"debt retired ({base_count} -> {current}) — check-only, the baseline file is left as it is"
        print(f"{mark} {c.id} (rule {c.rule}): current={current} baseline={base_count} — {message}")
        if not verdict.ok:
            failed = True
            print(f"    -> {c.route_hint}")
        if where and (list_all or not verdict.ok):
            for loc in where if list_all else locations_to_show(where):
                print(f"       {loc}")
        if verdict.new_baseline is not None:
            rewrites[c.id] = verdict.new_baseline

    if rewrites and tighten:
        for cid, new_count in rewrites.items():
            baseline[cid]["count"] = new_count
        write_baseline(baseline, baseline_path)
        print(f"Tightened baseline for: {', '.join(sorted(rewrites))}")

    return 1 if failed else 0


def main(argv: list[str] | None = None, checks: list[Check] | None = None,
         baseline_path: Path = BASELINE_PATH) -> int:
    parser = argparse.ArgumentParser(description="ADR-0010 module-residence ratchet.")
    parser.add_argument("--init", action="store_true",
                        help="Measure all checks and (over)write the baseline file, then exit.")
    parser.add_argument("--list", action="store_true",
                        help="Also print each counted violation (path:line) of the checks that can locate them.")
    parser.add_argument("--only", metavar="NAMES",
                        help="Comma-separated check ids or rule ids (S1, P1, ...) to run instead of all checks; "
                             f"'ci' names the checks CI runs ({','.join(CI_SUBSET)}).")
    parser.add_argument("--check", action="store_true",
                        help="Check only: a count that fell passes but the baseline file is not rewritten (CI).")
    parser.add_argument("--hook", action="store_true",
                        help="Run from a commit hook: J1, D1 and L2 warn and pass when node or TypeScript cannot run.")
    parser.add_argument(PRUNE_FLAG, action="store_true", dest="prune_disables",
                        help=f"Lower {DISABLE_SUPPRESSIONS} to today's counts after removing disable comments (D1).")
    args = parser.parse_args(argv)
    frozen_counts.NODE_MAY_SKIP = args.hook
    if args.init and args.only:
        print("--only cannot be combined with --init: --init measures every check and rewrites the whole baseline.",
              file=sys.stderr)
        return 2
    if args.init:
        return do_init()
    if args.prune_disables:
        if args.check or args.only or args.init:
            print(f"{PRUNE_FLAG} runs alone: it rewrites {DISABLE_SUPPRESSIONS}, which --check promises not to do.",
                  file=sys.stderr)
            return 2
        return prune_disable_comments()
    checks = CHECKS if checks is None else checks
    if args.only:
        try:
            names = [n.strip() for n in args.only.split(",") if n.strip()]
            names = [x for n in names for x in (CI_SUBSET if n == "ci" else [n])]
            checks = select_checks(checks, names)
        except ValueError as e:
            print(f"--only names no check: {e}", file=sys.stderr)
            return 2
    return do_check(checks, baseline_path, list_all=args.list, tighten=not args.check)


if __name__ == "__main__":
    sys.exit(main())
