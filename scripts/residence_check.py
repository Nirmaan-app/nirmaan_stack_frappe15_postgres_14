#!/usr/bin/env python3
"""Residence ratchet — enforce ADR-0010 module-residence rules by trend, not by fiat.

ADR-0010 (docs/adr/0010-module-residence-rules.md) defines ten "residence" rules:
a concept (a business calculation, a JSON/child-table shape, a document's
``workflow_state``, a write path) must have ONE owning module and not scatter across
call sites. The rules are prose; nothing enforces them, and the codebase carries
measured drift (ad-hoc state writers, raw updateDoc call sites, inline JSON.parse).

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

Stdlib only; run from anywhere (repo root is resolved from __file__).
"""

from __future__ import annotations

import argparse
import ast
import io
import json
import re
import sys
import tokenize
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, NamedTuple

# Repo root = the parent of this scripts/ directory (NOT the cwd).
REPO_ROOT = Path(__file__).resolve().parent.parent
BASELINE_PATH = Path(__file__).resolve().parent / "residence_baseline.json"

# Directories never worth walking (generated / vendored / compiled output).
SKIP_DIRS = {"node_modules", "dist", "__pycache__", "public", ".git"}

# --- Rule B1 -----------------------------------------------------------------
# Modules DECLARED pure: no frappe.db / get_all / get_doc / sql. Extend this list
# as more domain rules are extracted into pure modules (that is the whole point —
# a shrinking violation surface as the good pattern spreads).
# NOTE: services/finance.py is deliberately NOT here — it makes live frappe.get_all
# calls; it is a mixed module, not a pure one, so it is out of scope for this check.
#
# ⚠️ THIS CHECK IS EFFECTIVELY INERT, AND ADDING A MODULE HERE BUYS ALMOST NOTHING TODAY.
# ``strip_strings_and_comments`` (below) space-joins tokens, so ``frappe.db.get_value(...)``
# reaches the regex as ``frappe . db . get_value ( )`` and the B1 pattern cannot match it.
# This is NOT specific to ``frappe.db``: ALL FOUR alternatives — ``frappe.db``,
# ``frappe.get_all(``, ``frappe.get_doc(``, ``frappe.sql(`` — are missed identically,
# because every one of them spans a token boundary the joiner pads.
#
# The one case that DOES still match is an UNPARSEABLE file: the tokenize/IndentationError/
# SyntaxError branch fails OPEN and returns the RAW source, which the pattern then matches
# — including inside comments and docstrings, where a mere MENTION of ``frappe.db`` counts
# as a violation. So the check is not uniformly blind; it is blind on every file that
# parses, and over-eager on any that does not. Either way a green b1 count is NOT evidence
# that a listed module was checked.
#
# The bug is repo-wide and belongs in its own slice (fixing it here would silently change
# what a shared enforcement script reports for every module); it is recorded as debt at
# slice BCS-S1b, and this note was corrected at BCS-S1c after the two claims above were
# reproduced by execution. Registration below is correct-in-principle and starts covering
# these modules the day the tokenizer is fixed.
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


def count_files(files: list[Path], pattern: re.Pattern) -> int:
    """Number of FILES that contain at least one pattern match."""
    return sum(1 for p in files if pattern.search(read(p)))


def strip_strings_and_comments(src: str) -> str:
    """Return only the CODE tokens of a Python source — string literals and
    comments removed. Lets a purity check ignore docstring mentions such as
    ``no frappe.db`` while still catching a real ``frappe.db.get_value(...)`` call."""
    kept = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            if tok.type in (tokenize.STRING, tokenize.COMMENT):
                continue
            kept.append(tok.string)
    except (tokenize.TokenError, IndentationError, SyntaxError):
        return src  # fail open: better to over-count than to hide a violation
    return " ".join(kept)


def count_pure_module_impurity(pattern: re.Pattern) -> int:
    """Total DB-access matches inside the declared PURE_MODULES (code only)."""
    total = 0
    for rel in PURE_MODULES:
        p = REPO_ROOT / rel
        if p.exists():
            total += len(pattern.findall(strip_strings_and_comments(read(p))))
    return total


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


# b2: files containing the state literal, minus the predicate home and test files.
_VENDOR_SELECTED = re.compile(r'"Vendor Selected"')

def _measure_b2() -> int:
    files = [
        p for p in iter_files("nirmaan_stack", (".py",))
        if p.name != "procurement_approval.py" and not p.name.startswith("test_")
    ]
    return count_files(files, _VENDOR_SELECTED)


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
        description="frappe.db/get_all/get_doc/sql usages inside declared PURE_MODULES (a pure module must have none).",
        route_hint="a PURE_MODULES entry reached into frappe.db — move the data access to a thin orchestrator "
                   "and keep the module pure, or remove it from PURE_MODULES (see ADR-0010 rule B1).",
        measure=lambda: count_pure_module_impurity(re.compile(r"frappe\.(db\b|get_all\(|get_doc\(|sql\()")),
    ),
    Check(
        id="b2_predicate_literal_scatter",
        rule="B2",
        description='Files hardcoding the "Vendor Selected" state literal instead of importing the shared predicate.',
        route_hint="the awaiting-approval predicate lives in services/procurement_approval.py "
                   "(AWAITING_APPROVAL_STATES / is_awaiting_approval) — import it, don't hardcode states.",
        measure=_measure_b2,
    ),
    Check(
        id="f5_raw_updatedoc_files",
        rule="F5",
        description="Frontend files calling useFrappeUpdateDoc / updateDoc( directly instead of one write-safety seam.",
        route_hint="writes to shared docs should go through the write-safety seam (useEditingLock) — "
                   "extend it, don't add a raw updateDoc call (ADR-0010 rule F5).",
        measure=lambda: count_files(
            iter_files("frontend/src", (".ts", ".tsx")),
            re.compile(r"useFrappeUpdateDoc|updateDoc\("),
        ),
    ),
    Check(
        id="f2_inline_json_parse_pages",
        rule="F2",
        description="Inline JSON.parse occurrences in pages/ (backend shapes should be parsed at one typed accessor).",
        route_hint="parse a backend JSON shape once, in a typed accessor (e.g. useITM()), not inline in a page "
                   "(ADR-0010 rule F2).",
        measure=lambda: count_lines(
            iter_files("frontend/src/pages", (".ts", ".tsx")),
            re.compile(r"JSON\.parse"),
        ),
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
        measure=lambda: count_lines(
            [p for p in iter_files("nirmaan_stack", (".py",)) if p.name.startswith("test_")],
            re.compile(r"""get_value\(\s*["'][^"']+["']\s*,\s*\{\s*\}"""),
        ),
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


# --- baseline I/O + entry points ---------------------------------------------

def measure_all() -> dict[str, dict]:
    return {
        c.id: {"count": c.measure(), "rule": c.rule, "description": c.description}
        for c in CHECKS
    }


def write_baseline(data: dict[str, dict]) -> None:
    BASELINE_PATH.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def do_init() -> int:
    data = measure_all()
    write_baseline(data)
    print(f"Wrote baseline -> {BASELINE_PATH.relative_to(REPO_ROOT)}")
    for cid, entry in sorted(data.items()):
        print(f"  {cid}: {entry['count']}")
    return 0


def do_check(list_all: bool = False) -> int:
    if not BASELINE_PATH.exists():
        print(f"No baseline at {BASELINE_PATH} — run with --init first.", file=sys.stderr)
        return 2
    baseline = json.loads(read(BASELINE_PATH))

    failed = False
    rewrites: dict[str, int] = {}
    for c in CHECKS:
        where = c.locate() if c.locate else None
        current = len(where) if where is not None else c.measure()
        base_count = baseline.get(c.id, {}).get("count", 0)
        verdict = compare(c.id, current, base_count)
        mark = "✓" if verdict.ok else "✗"
        print(f"{mark} {c.id} (rule {c.rule}): current={current} baseline={base_count} — {verdict.message}")
        if not verdict.ok:
            failed = True
            print(f"    -> {c.route_hint}")
        if where and (list_all or not verdict.ok):
            for loc in where:
                print(f"       {loc}")
        if verdict.new_baseline is not None:
            rewrites[c.id] = verdict.new_baseline

    if rewrites:
        for cid, new_count in rewrites.items():
            baseline[cid]["count"] = new_count
        write_baseline(baseline)
        print(f"Tightened baseline for: {', '.join(sorted(rewrites))}")

    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="ADR-0010 module-residence ratchet.")
    parser.add_argument("--init", action="store_true",
                        help="Measure all checks and (over)write the baseline file, then exit.")
    parser.add_argument("--list", action="store_true",
                        help="Also print each counted violation (path:line) of the checks that can locate them.")
    args = parser.parse_args()
    return do_init() if args.init else do_check(list_all=args.list)


if __name__ == "__main__":
    sys.exit(main())
