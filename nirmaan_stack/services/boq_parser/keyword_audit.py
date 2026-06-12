"""Reserved keyword survey audit script.

Runs detect_multi_area_pattern() against header rows in all committed real
BoQ fixtures to surface candidate false-positive area names — header cells
that should be reserved keywords but aren't yet in
GlobalSettings.multi_area_reserved_keywords.

Per §9 #44 (handover doc) / §17.8 (plan doc). Re-runnable; output is a
markdown-formatted report printed to stdout.

Usage from inside the container:
    cd /workspace/development/frappe-bench/apps/nirmaan_stack/nirmaan_stack/services/boq_parser
    /workspace/development/frappe-bench/env/bin/python keyword_audit.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from openpyxl.utils import column_index_from_string

from reader import BoqReader
from multi_area_detection import detect_multi_area_pattern, MultiAreaPattern
from config import GlobalSettings

FIXTURES_DIR = Path(__file__).parent / "tests" / "fixtures"
_MAX_VAL_LEN = 40
_MAX_COLS = 12


def _fmt_val(v) -> str:
    if v is None:
        return "(empty)"
    s = str(v).strip()
    if not s:
        return "(empty)"
    return (s[:_MAX_VAL_LEN] + "…") if len(s) > _MAX_VAL_LEN else s


def _fmt_row(row) -> str:
    cols = sorted(row.cells.items(), key=lambda kv: column_index_from_string(kv[0]))
    parts = [f"{col}={_fmt_val(ci.value)}" for col, ci in cols[:_MAX_COLS]]
    if len(cols) > _MAX_COLS:
        parts.append(f"… ({len(cols) - _MAX_COLS} more)")
    return " | ".join(parts)


def _fmt_result(r) -> str:
    return "None" if r is None else f"Pattern {r.pattern}, areas={r.areas}"


def main():
    kws = GlobalSettings().multi_area_reserved_keywords

    real_fixtures = sorted(
        p for p in FIXTURES_DIR.glob("*.xlsx") if not p.name.startswith("synthetic_")
    )

    open_errors = []       # (fname, exc_type, exc_msg)
    all_findings = []      # (fname, sheet, hr, bot, top, r1, r2)
    skipped = []           # (fname, sheet, reason)
    stats = {}             # fname -> dict

    for path in real_fixtures:
        fname = path.name
        stats[fname] = dict(sheets_total=0, header_detected=0, det_1row=0, det_2row=0, open_error=False)

        try:
            reader = BoqReader(str(path))
        except Exception as e:
            open_errors.append((fname, type(e).__name__, str(e)))
            stats[fname]["open_error"] = True
            continue

        sheets = reader.list_sheets()
        stats[fname]["sheets_total"] = len(sheets)

        for sheet in sheets:
            hr = reader.detect_header_row(sheet)
            if hr is None:
                skipped.append((fname, sheet, "no_header_detected"))
                continue

            stats[fname]["header_detected"] += 1
            bot_rows = list(reader.iter_rows(sheet, start_row=hr, end_row=hr))
            if not bot_rows:
                skipped.append((fname, sheet, "empty_header_row"))
                continue

            bot = bot_rows[0]
            top = None
            if hr >= 2:
                top_rows = list(reader.iter_rows(sheet, start_row=hr - 1, end_row=hr - 1))
                if top_rows:
                    top = top_rows[0]

            r1 = detect_multi_area_pattern(bot, kws)
            r2 = detect_multi_area_pattern(bot, kws, top_header_row=top) if top is not None else None

            if r1 is not None:
                stats[fname]["det_1row"] += 1
            if r2 is not None:
                stats[fname]["det_2row"] += 1

            all_findings.append((fname, sheet, hr, bot, top, r1, r2))

    det_sheets = [
        (f, s, hr, b, t, r1, r2) for f, s, hr, b, t, r1, r2 in all_findings
        if r1 is not None or r2 is not None
    ]

    # --- Section 1: Header ---
    print("# Reserved Keyword Survey Audit\n")
    print(f"- Reserved keywords: {len(kws)}")
    print(f"- Real fixtures inspected: {len(real_fixtures)}")
    print(f"- Sheets with header detected: {sum(s['header_detected'] for s in stats.values())}")
    print(f"- Sheets skipped (no header): {len(skipped)}")
    print(f"- Fixtures failing to open: {len(open_errors)}")
    print()

    # --- Section 2: Open errors ---
    if open_errors:
        print("## Open Errors\n")
        for fname, exc_type, msg in open_errors:
            print(f"- **{fname}**: `{exc_type}` — {msg}")
        print()

    # --- Section 3: Non-None detections ---
    print("## Sheets with Non-None Detection\n")
    if not det_sheets:
        print("_No non-None detections across all real fixtures._\n")
    else:
        for fname, sheet, hr, bot, top, r1, r2 in det_sheets:
            print(f"### {fname} :: {sheet} (header row {hr})\n")
            print(f"**Bottom row:** {_fmt_row(bot)}")
            if top is not None:
                print(f"**Top row:** {_fmt_row(top)}")
            print(f"**1-row detection:** {_fmt_result(r1)}")
            if top is not None:
                print(f"**2-row detection:** {_fmt_result(r2)}")
            print()

    # --- Section 4: Per-fixture summary ---
    print("## Per-Fixture Summary\n")
    print("| Fixture | Sheets total | Header detected | Detections 1-row | Detections 2-row | Open error? |")
    print("|---------|-------------|-----------------|------------------|------------------|-------------|")
    for fname in sorted(stats):
        s = stats[fname]
        err = "YES" if s["open_error"] else "no"
        print(f"| {fname} | {s['sheets_total']} | {s['header_detected']} | {s['det_1row']} | {s['det_2row']} | {err} |")

    n_det = len(det_sheets)
    print(f"\n_Total non-None detection blocks (Section 3): {n_det}_")


if __name__ == "__main__":
    main()
