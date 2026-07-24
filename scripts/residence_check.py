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

Stdlib only; run from anywhere (repo root is resolved from __file__).
"""

from __future__ import annotations

import argparse
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
PURE_MODULES = ["nirmaan_stack/services/procurement_approval.py"]


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


# --- check registry ----------------------------------------------------------

@dataclass
class Check:
    id: str
    rule: str            # ADR-0010 rule id (B1, B3, F2, ...)
    description: str
    route_hint: str      # printed on FAILURE — tells the violator where the concept lives
    measure: Callable[[], int]


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


def do_check() -> int:
    if not BASELINE_PATH.exists():
        print(f"No baseline at {BASELINE_PATH} — run with --init first.", file=sys.stderr)
        return 2
    baseline = json.loads(read(BASELINE_PATH))

    failed = False
    rewrites: dict[str, int] = {}
    for c in CHECKS:
        current = c.measure()
        base_count = baseline.get(c.id, {}).get("count", 0)
        verdict = compare(c.id, current, base_count)
        mark = "✓" if verdict.ok else "✗"
        print(f"{mark} {c.id} (rule {c.rule}): current={current} baseline={base_count} — {verdict.message}")
        if not verdict.ok:
            failed = True
            print(f"    -> {c.route_hint}")
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
    args = parser.parse_args()
    return do_init() if args.init else do_check()


if __name__ == "__main__":
    sys.exit(main())
