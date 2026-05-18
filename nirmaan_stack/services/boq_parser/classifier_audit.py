"""
Phase 2c §9 #48 classifier-dictionary audit (audit half).

Scans the first 15 rows of every sheet in all 25 non-synthetic BoQ fixtures
and reports which column-header strings are NOT matched by the classifier's
_HEADER_KW dictionary.  Results drive the expansion-half sub-phase.

No Frappe imports; no test imports; no source-module changes.

References: §9 #48 (handover doc), §17.11.E (plan doc).
Script: nirmaan_stack/services/boq_parser/classifier_audit.py
Generated: 2026-05-16
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from openpyxl.utils import column_index_from_string

_SCRIPT_DIR = Path(__file__).parent
_APP_ROOT = _SCRIPT_DIR.parent.parent.parent  # .../apps/nirmaan_stack/ — makes nirmaan_stack importable
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from nirmaan_stack.services.boq_parser.reader import BoqReader  # noqa: E402

FIXTURES_DIR = _SCRIPT_DIR / "tests" / "fixtures"
_SCAN_ROWS = 15
_MIN_NON_EMPTY = 3


# ------------------------------------------------------------------
# Read-only replica of _HEADER_KW from classifier.py::classify_row()
# Source of truth: nirmaan_stack/services/boq_parser/classifier.py :: _HEADER_KW
# Normalization: str(value).strip().lower().rstrip(".:") — Phase 1.9k Mode F added trailing-punct strip.
# Matching: substring — any(kw in cell_text for kw in kws).
# Synced with classifier.py as of Phase 1.9k Mode B expansion.
# Update this replica whenever _HEADER_KW in classifier.py changes.
# ------------------------------------------------------------------

_CLASSIFIER_HEADER_KW: dict[str, frozenset[str]] = {
    "sl_no": frozenset({
        "sl.no", "s.no", "sno", "sr.no",
        "sl. no", "s. no", "sr. no", "si no", "si.no",
        "serial no", "item no", "s.l",
        "sl no",  # Phase 1.9k Mode B — synced from classifier.py
    }),
    "description": frozenset({
        "description",
        "particulars", "item description", "discription", "desciption",
        "description of item", "description of work",
        "specs", "specifications",
    }),
    "unit": frozenset({
        "unit",
        "uom", "u.o.m",
        # Phase 1.9k Mode B — synced from classifier.py
        "um",
        "sq.ft", "sqm",
        "rmt", "rft", "mtr",
        "set", "each",
    }),
    "qty": frozenset({
        "qty", "quantity", "nos",
        "qnty", "boq qty", "boq quantity",
        # Phase 1.9k Mode B — synced from classifier.py
        "qnt", "qnt.",
        "no's",
    }),
    "qty_total": frozenset({
        "qty", "quantity", "nos",
        "total qty", "total quantity",
    }),
    "rate_combined": frozenset({
        "rate", "rates", "rate in", "rate (",
        "sitc rate", "sitc",
        "s&i rate", "s+i rate",
        "supply & installation rate", "supply and installation rate",
        "supply, install & commissioning rate",
        "combined rate", "total rate",
    }),
    "rate_supply": frozenset({
        "supply rate", "material rate", "dsr rate",
        "rate (supply)",
    }),
    "rate_install": frozenset({
        "installation rate", "install rate", "erection rate",
        "labour rate", "labor rate",
        "ndsr rate", "non-dsr rate", "non dsr rate",
        "rate (install)", "rate (installation)",
    }),
    "amount_total": frozenset({
        "amount", "total amount", "amount in", "amount (", "amt",
        "as per boq total amount",
    }),
    "amount_combined": frozenset({
        "sitc amount",
        "s&i amount", "s+i amount",
        "supply & installation amount", "supply and installation amount",
        "combined amount",
    }),
    "amount_supply": frozenset({
        "supply amount", "material amount", "dsr amount",
        "amount (supply)", "as per boq total supply",
    }),
    "amount_install": frozenset({
        "installation amount", "install amount", "erection amount",
        "labour amount", "labor amount",
        "non-dsr amount", "non dsr amount",
        "amount (install)", "amount (installation)",
        "as per boq total erection", "as per boq total installation",
    }),
    "make_model": frozenset({
        "make", "model", "brand", "manufacturer", "manufacturers",
        "approved make", "approved makes",
        "make/model", "make/manufacturer",
        "details of materials", "material code", "part code",
        "model no",
    }),
    "row_notes": frozenset({
        "remark", "remarks", "note", "notes",
        "comment", "comments",
    }),
}


def _match_role(header_str: str) -> str | None:
    """
    Map a header string to a column role using the classifier's matching logic.

    Read-only replica of header-repeat detection from classifier.py::classify_row().
    Returns role name (e.g. "sl_no") or None if unrecognised.
    """
    cell_text = header_str.strip().lower().rstrip(".:") # Phase 1.9k Mode F sync
    if not cell_text:
        return None
    # Phase 1.9l Mode D — longest matched keyword wins. Tie-break by iteration order.
    # Sync with _auto_guess.py Phase 1 fix per agreement #21.
    best_role: str | None = None
    best_kw_len: int = -1
    for role, kws in _CLASSIFIER_HEADER_KW.items():
        matched_kws = [kw for kw in kws if kw in cell_text]
        if not matched_kws:
            continue
        longest_match = max(len(kw) for kw in matched_kws)
        if longest_match > best_kw_len:
            best_kw_len = longest_match
            best_role = role
    return best_role


# ------------------------------------------------------------------
# Per-sheet scan
# ------------------------------------------------------------------

def _scan_sheet(reader: BoqReader, fixture_name: str, sheet_name: str) -> list[dict]:
    """
    Iterate first _SCAN_ROWS rows of one sheet.

    Returns row records for rows with non_empty_cell_count >= _MIN_NON_EMPTY.
    Marks the row with the highest classified_cell_count as is_likely_header=True
    (ties broken by lowest row_index).
    """
    row_records: list[dict] = []

    for raw_row in reader.iter_rows(sheet_name, start_row=1, end_row=_SCAN_ROWS):
        cells: list[dict] = []

        for col_letter in sorted(raw_row.cells.keys(), key=column_index_from_string):
            cell_info = raw_row.cells[col_letter]
            if cell_info.value is None:
                continue
            val_str = str(cell_info.value).strip()
            if not val_str:
                continue
            col_idx = column_index_from_string(col_letter) - 1  # 0-based
            role = _match_role(val_str)
            cells.append({"col": col_idx, "value": val_str, "role": role})

        if len(cells) < _MIN_NON_EMPTY:
            continue

        classified_count = sum(1 for c in cells if c["role"] is not None)
        row_records.append({
            "fixture": fixture_name,
            "sheet": sheet_name,
            "row_index": raw_row.row_number,
            "non_empty_cell_count": len(cells),
            "classified_cell_count": classified_count,
            "cells": cells,
        })

    # Mark likely header row: highest classified_cell_count; tie → lowest row_index
    if row_records:
        best = max(
            row_records,
            key=lambda r: (r["classified_cell_count"], -r["row_index"]),
        )
        best["is_likely_header"] = True

    return row_records


# ------------------------------------------------------------------
# Entry point
# ------------------------------------------------------------------

def main() -> None:
    output_path = _SCRIPT_DIR / "classifier_audit_output.json"

    real_fixtures = sorted(
        p for p in FIXTURES_DIR.glob("*.xlsx") if not p.name.startswith("synthetic_")
    )

    per_fixture: dict[str, dict] = {}
    fixture_failures: list[dict] = []

    # Unclassified rollup accumulators
    unclassified_freq: dict[str, int] = defaultdict(int)
    unclassified_occurrences: dict[str, list[dict]] = defaultdict(list)

    # Summary counters
    fixtures_scanned = 0
    sheets_scanned = 0
    rows_scanned = 0
    total_cells_scanned = 0
    total_classified = 0
    total_unclassified = 0

    for path in real_fixtures:
        fname = path.name
        try:
            reader = BoqReader(str(path))
        except Exception as exc:
            fixture_failures.append({
                "fixture": fname,
                "error_type": type(exc).__name__,
                "error_message": str(exc),
            })
            continue

        fixtures_scanned += 1
        per_fixture[fname] = {"sheets": {}}

        for sheet_name in reader.list_sheets():
            try:
                row_records = _scan_sheet(reader, fname, sheet_name)
            except Exception as exc:
                fixture_failures.append({
                    "fixture": fname,
                    "sheet": sheet_name,
                    "error_type": type(exc).__name__,
                    "error_message": str(exc),
                })
                continue

            sheets_scanned += 1

            for rec in row_records:
                rows_scanned += 1
                total_cells_scanned += rec["non_empty_cell_count"]
                total_classified += rec["classified_cell_count"]
                unclassified_in_row = rec["non_empty_cell_count"] - rec["classified_cell_count"]
                total_unclassified += unclassified_in_row

                for cell in rec["cells"]:
                    if cell["role"] is None:
                        hdr = cell["value"]
                        unclassified_freq[hdr] += 1
                        unclassified_occurrences[hdr].append({
                            "fixture": rec["fixture"],
                            "sheet": rec["sheet"],
                            "row_index": rec["row_index"],
                            "col": cell["col"],
                        })

            if row_records:
                per_fixture[fname]["sheets"][sheet_name] = row_records

    # Build rollup sorted by frequency desc, then alphabetical
    unclassified_rollup = sorted(
        [
            {
                "header_string": hdr,
                "frequency": unclassified_freq[hdr],
                "occurrences": unclassified_occurrences[hdr],
            }
            for hdr in unclassified_freq
        ],
        key=lambda x: (-x["frequency"], x["header_string"]),
    )

    summary = {
        "fixtures_scanned": fixtures_scanned,
        "fixtures_attempted": len(real_fixtures),
        "fixture_failures": len(fixture_failures),
        "sheets_scanned": sheets_scanned,
        "rows_scanned": rows_scanned,
        "total_cells_scanned": total_cells_scanned,
        "total_classified": total_classified,
        "total_unclassified": total_unclassified,
        "unique_unclassified_strings": len(unclassified_freq),
    }

    payload = {
        "summary": summary,
        "fixture_failures": fixture_failures,
        "unclassified_rollup": unclassified_rollup,
        "per_fixture": per_fixture,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(json.dumps(summary, indent=2))
    if fixture_failures:
        print(f"\nWARNING: {len(fixture_failures)} fixture/sheet failure(s) — see output JSON for details.")


if __name__ == "__main__":
    main()
