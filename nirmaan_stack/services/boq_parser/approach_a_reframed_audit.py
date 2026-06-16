"""
Approach A-reframed audit -- two-fixture diagnostic.

READ-ONLY diagnostic. NO parser source files modified. NO test changes.

Compares two hierarchy resolution pipelines side-by-side on two real fixtures
to surface per-firing data for user sample inspection:

  Pipeline X (current production):
    classify_row -> _apply_unit_based_demotion_post_pass (sec 7.28)
    -> production resolve_hierarchy()

  Pipeline Y (Approach A-reframed):
    classify_row -> _apply_unit_based_demotion_post_pass (sec 7.28)
    -> custom resolver with Rule A1 + Rule A2-reframed

Both pipelines apply sec 7.28 so the diff isolates only the A1+A2 effect.

Rule A1 - lowercase-letter cascade fix:
  Applied in PREAMBLE level determination only. When a PREAMBLE sl_no's
  pattern_signature starts with 'l' (lowercase letter as first character,
  e.g. "a", "a.", "b.", "ai)", "iv."), scan the resolver stack top-down
  (deepest first), find the first "numbered ancestor" whose signature does
  NOT start with 'l', and set level = anchor.level + 1. Fall back to
  production behaviour (stack_depth + 1) if no anchor found.

Rule A2-reframed - LINE_ITEM signature sibling fix:
  Applied at LINE_ITEM attachment step only (NOT in _determine_preamble_level).
  Proximity = stack top only (stack[-1]). Trigger: top is not None AND
  signature(LINE_ITEM.sl_no) == signature(top.sl_no) AND
  first_numeric_token differs AND both tokens are not None. When triggered:
  attach LINE_ITEM to top.parent (one level up; root if top has no parent).
  LINE_ITEM never pushes onto the stack (unchanged from production).

Fixtures:
  - snitch_electrical.xlsx '6. Electrical'    (Rule A1 cascade case)
  - Bill of Quantities.xlsx 'ELECTRICAL & ELV BOQ'  (Rule A2-reframed case)

Output: per-firing rows in diagnostic_snapshots/. Aggregate counts + sample
first 20 per fixture. NO auto-bucket misfire classification -- user reviews
sample, calls misfires.

Gating audit for exit criterion E3 (closing Phase 2c bug-fix cycle).
Decision criterion: low misfire rate on sample => land A1+A2 next sub-phase;
appreciable misfires => park + codify "no more parser fuzzy rules" as
working agreement #40 candidate.

Script: nirmaan_stack/services/boq_parser/approach_a_reframed_audit.py
Generated: 2026-05-23
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).parent
_APP_ROOT = _SCRIPT_DIR.parent.parent.parent
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from nirmaan_stack.services.boq_parser.classifier import (
    ClassifiedRow,
    RowClassification,
    _apply_unit_based_demotion_post_pass,
    classify_row,
)
from nirmaan_stack.services.boq_parser.config import (
    ColumnRole,
    MappingConfig,
    MasterBoqMetadata,
    SheetConfig,
)
from nirmaan_stack.services.boq_parser.hierarchy import (
    ResolvedRow,
    ResolvedSheet,
    _L1_STYLES,
    _MID_SHEET_RESET_RE,
    _categorize_sl_no_style,
    _detect_level_1_style,
    _top_non_none,
    resolve_hierarchy,
)
from nirmaan_stack.services.boq_parser.reader import BoqReader


# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------

OUTPUT_DIR = _SCRIPT_DIR / "diagnostic_snapshots"
FIXTURES_DIR = _SCRIPT_DIR / "tests" / "fixtures"

FIXTURES = [
    {
        "fixture_file": "snitch_electrical.xlsx",
        "sheet_name": "6. Electrical",
        "output_stem": "approach_a_reframed_audit_snitch",
    },
    {
        "fixture_file": "Bill of Quantities.xlsx",
        "sheet_name": "ELECTRICAL & ELV BOQ",
        "output_stem": "approach_a_reframed_audit_bill_of_quantities",
    },
]


# ------------------------------------------------------------------
# MappingConfig factories (reused from precedent audit scripts)
# ------------------------------------------------------------------

def _snitch_config() -> MappingConfig:
    """Reused verbatim from unit_demotion_orphan_audit.py (feat 8a126846)."""
    _elec_cols = {
        "A": ColumnRole(role="sl_no"),
        "B": ColumnRole(role="description"),
        "C": ColumnRole(role="unit"),
        "D": ColumnRole(role="qty"),
        "E": ColumnRole(role="rate_supply"),
        "F": ColumnRole(role="rate_install"),
        "G": ColumnRole(role="rate_combined"),
        "I": ColumnRole(role="amount_total"),
    }
    return MappingConfig(
        project="snitch",
        master_boq=MasterBoqMetadata(boq_name="Snitch Electrical"),
        sheets=[
            SheetConfig(sheet_name="OVERALL SUMMARY", skip=True, column_role_map={}),
            SheetConfig(sheet_name="SUMMARY MEP", skip=True, column_role_map={}),
            SheetConfig(sheet_name="6. Electrical", header_row=1, column_role_map=_elec_cols),
            SheetConfig(sheet_name="7. Light Fixtures", header_row=2, column_role_map=_elec_cols),
            SheetConfig(sheet_name="MAKE LIST (to be updated)", skip=True, column_role_map={}),
        ],
    )


def _boq_config() -> MappingConfig:
    """Reused verbatim from boq_electrical_elv_rows_4_22_audit.py (feat 3b0790f0)."""
    _cols = {
        "A": ColumnRole(role="sl_no"),
        "B": ColumnRole(role="append_to_notes"),
        "C": ColumnRole(role="description"),
        "D": ColumnRole(role="unit"),
        "E": ColumnRole(role="qty"),
        "F": ColumnRole(role="rate_supply"),
        "G": ColumnRole(role="rate_install"),
        "H": ColumnRole(role="amount_supply"),
        "I": ColumnRole(role="amount_install"),
    }
    return MappingConfig(
        project="bill_of_quantities_audit",
        master_boq=MasterBoqMetadata(boq_name="Bill Of Quantities Audit"),
        sheets=[
            SheetConfig(
                sheet_name="ELECTRICAL & ELV BOQ",
                header_row=2,
                header_row_count=2,
                column_role_map=_cols,
            ),
        ],
    )


# ------------------------------------------------------------------
# Algorithm helpers (per spec)
# ------------------------------------------------------------------

def pattern_signature(sl_no: str) -> str:
    """
    Map each char: digit->D, uppercase->U, lowercase->l, other->literal.
    Case-preserving. Examples: "1.0"->"D.D", "a."->"l.", "10.3"->"DD.D",
    "1a"->"Dl", "A."->"U.", "1.2.3"->"D.D.D".
    """
    result = []
    for ch in sl_no:
        if ch.isdigit():
            result.append("D")
        elif ch.isupper():
            result.append("U")
        elif ch.islower():
            result.append("l")
        else:
            result.append(ch)
    return "".join(result)


def first_numeric_token(sl_no: str) -> int | None:
    """
    Longest digit-only prefix of sl_no (after stripping leading whitespace).
    Returns int if non-empty, else None.
    Examples: "1.0"->1, "10.3"->10, "a."->None, "1a"->1, "  2.0"->2.
    """
    prefix = ""
    for ch in sl_no.lstrip():
        if ch.isdigit():
            prefix += ch
        else:
            break
    return int(prefix) if prefix else None


def _trunc(s: str | None, n: int = 60) -> str:
    if not s:
        return ""
    return s if len(s) <= n else s[:n] + "..."


def _get_parent_sl_no(rr: ResolvedRow, resolved: list[ResolvedRow]) -> str | None:
    """Return the parent's sl_no_value, or None if root or unparented."""
    if rr.parent_index is None:
        return None
    return resolved[rr.parent_index].classified_row.sl_no_value


# ------------------------------------------------------------------
# Pipeline Y: A1 level determination for PREAMBLE rows
# ------------------------------------------------------------------

def _determine_preamble_level_y(
    classified_row: ClassifiedRow,
    level_1_style: str | None,
    stack: list[int | None],
    resolved: list[ResolvedRow],
    sheet_config: SheetConfig,
    a1_firing_rows: set[int],
) -> int:
    """
    PREAMBLE level determination with Rule A1 applied.

    Rule A1 trigger: pattern_signature(sl_no) starts with 'l'.
    Action: scan stack reversed (deepest first), find first entry whose
    signature does NOT start with 'l' (numbered ancestor), set
    level = anchor.level + 1. Fall back to stack_depth + 1 if no anchor.

    All other sl_no patterns use standard production logic from
    _determine_preamble_level (hierarchy.py), replicated inline.
    """
    sl_no = (classified_row.sl_no_value or "").strip()
    stack_depth = len(stack)

    if not sl_no:
        return stack_depth + 1

    sig = pattern_signature(sl_no)

    if sig.startswith("l"):
        # Rule A1: find nearest non-lowercase ancestor in stack
        anchor_level: int | None = None
        for entry_idx in reversed(stack):
            if entry_idx is None:
                continue
            entry_row = resolved[entry_idx]
            entry_sl = (entry_row.classified_row.sl_no_value or "").strip()
            if not pattern_signature(entry_sl).startswith("l"):
                anchor_level = entry_row.level
                break
        if anchor_level is not None:
            a1_firing_rows.add(classified_row.raw_row.row_number)
            return anchor_level + 1
        return stack_depth + 1  # no non-lowercase ancestor: production fallback

    # Standard production logic for all other sl_no patterns
    style = _categorize_sl_no_style(sl_no)

    if style == "multi_dot_numeric":
        normalized = sl_no.rstrip(".")
        return 1 + normalized.count(".")

    if style is not None and style == level_1_style:
        return 1

    if level_1_style == "letter" and style == "roman" and len(sl_no.rstrip(".")) == 1:
        return 1

    if style in _L1_STYLES:
        return 2

    # Unknown style: indent fallback then stack_depth + 1
    sl_no_col: str | None = None
    for col_letter, col_role in sheet_config.column_role_map.items():
        if col_role.role == "sl_no":
            sl_no_col = col_letter
            break

    if sl_no_col:
        sl_no_cell = classified_row.raw_row.cells.get(sl_no_col)
        if sl_no_cell and sl_no_cell.indent > 0:
            return sl_no_cell.indent + 1

    return stack_depth + 1


# ------------------------------------------------------------------
# Pipeline Y: custom resolver with A1 + A2-reframed
# ------------------------------------------------------------------

def _resolve_pipeline_y(
    classified_rows: list[ClassifiedRow],
    sheet_config: SheetConfig,
    global_settings: object,
    a1_firing_rows: set[int],
    a2_firing_rows: set[int],
) -> ResolvedSheet:
    """
    Inline replica of resolve_hierarchy() with:
      - PREAMBLE level determination: _determine_preamble_level_y (Rule A1)
      - LINE_ITEM attachment: Rule A2-reframed (stack top, proximity=1)

    Stack invariants, NOTE attachment, SUBTOTAL_MARKER reset, and
    SPACER/HEADER_REPEAT pass-through are identical to production.
    LINE_ITEM never pushes onto stack (unchanged from production).
    global_settings accepted for call-site compatibility; not used in walk.
    """
    resolved: list[ResolvedRow] = []
    path_cache: dict[int, str] = {}
    stack: list[int | None] = []
    notes_to_attach: dict[int, list[str]] = {}
    master_preamble_notes: list[str] = []
    sheet_warnings: list[str] = []

    if sheet_config.level_1_style_override is not None:
        level_1_style = sheet_config.level_1_style_override
    else:
        level_1_style = _detect_level_1_style(classified_rows, 0)

    for current_index, classified_row in enumerate(classified_rows):
        idx = len(resolved)
        cls = classified_row.classification

        if cls in (RowClassification.SPACER, RowClassification.HEADER_REPEAT):
            resolved.append(ResolvedRow(classified_row=classified_row))
            continue

        if cls == RowClassification.SUBTOTAL_MARKER:
            desc = classified_row.description or ""
            if _MID_SHEET_RESET_RE.match(desc):
                stack.clear()
                if sheet_config.level_1_style_override is None:
                    new_style = _detect_level_1_style(classified_rows, current_index + 1)
                    if new_style is not None:
                        level_1_style = new_style
            resolved.append(ResolvedRow(classified_row=classified_row))
            continue

        if cls == RowClassification.PREAMBLE:
            level = _determine_preamble_level_y(
                classified_row, level_1_style, stack, resolved, sheet_config, a1_firing_rows
            )
            stack = stack[: level - 1]
            while len(stack) < level - 1:
                stack.append(None)
            parent_index = stack[-1] if stack and stack[-1] is not None else None
            path = str(idx) if parent_index is None else path_cache[parent_index] + "/" + str(idx)
            while len(stack) < level:
                stack.append(None)
            stack[level - 1] = idx
            path_cache[idx] = path
            resolved.append(ResolvedRow(
                classified_row=classified_row,
                parent_index=parent_index,
                level=level,
                path=path,
            ))
            continue

        if cls == RowClassification.LINE_ITEM:
            row_num = classified_row.raw_row.row_number
            # Rule A2-reframed: check stack top only (proximity = 1)
            top_idx = stack[-1] if stack else None
            a2_fired = False
            parent_index = None

            if top_idx is not None:
                li_sl = (classified_row.sl_no_value or "").strip()
                top_sl = (resolved[top_idx].classified_row.sl_no_value or "").strip()
                li_sig = pattern_signature(li_sl)
                top_sig = pattern_signature(top_sl)
                li_fnt = first_numeric_token(li_sl)
                top_fnt = first_numeric_token(top_sl)
                if (
                    li_sig == top_sig
                    and li_fnt is not None
                    and top_fnt is not None
                    and li_fnt != top_fnt
                ):
                    # Attach to top's parent (one level up; root if top has no parent)
                    parent_index = resolved[top_idx].parent_index
                    a2_fired = True
                    a2_firing_rows.add(row_num)

            if not a2_fired:
                parent_index = _top_non_none(stack)
                if parent_index is None:
                    sheet_warnings.append(
                        f"Row {row_num}: standalone line item with no preamble parent"
                    )

            path = str(idx) if parent_index is None else path_cache[parent_index] + "/" + str(idx)
            path_cache[idx] = path
            resolved.append(ResolvedRow(
                classified_row=classified_row,
                parent_index=parent_index,
                path=path,
                qty_by_area_raw=classified_row.qty_by_area_raw,
                amount_by_area_raw=classified_row.amount_by_area_raw,
                qty_total=classified_row.qty_total_raw,
                amount_total=classified_row.amount_total,
            ))
            continue

        if cls == RowClassification.NOTE:
            preamble_index = _top_non_none(stack)
            note_text = classified_row.description or ""
            if preamble_index is not None:
                notes_to_attach.setdefault(preamble_index, []).append(note_text)
                attached_to_index = preamble_index
            else:
                master_preamble_notes.append(note_text)
                attached_to_index = None
            resolved.append(ResolvedRow(
                classified_row=classified_row,
                attached_to_index=attached_to_index,
            ))
            continue

        resolved.append(ResolvedRow(classified_row=classified_row))

    for preamble_idx, notes in notes_to_attach.items():
        resolved[preamble_idx].attached_notes = list(notes)

    return ResolvedSheet(
        rows=resolved,
        master_preamble_notes=master_preamble_notes,
        warnings=sheet_warnings,
    )


# ------------------------------------------------------------------
# Diff computation
# ------------------------------------------------------------------

def _build_lookup(resolved_rows: list[ResolvedRow]) -> dict[int, ResolvedRow]:
    return {rr.classified_row.raw_row.row_number: rr for rr in resolved_rows}


def _compute_diff(
    resolved_x: list[ResolvedRow],
    resolved_y: list[ResolvedRow],
    a1_firing_rows: set[int],
    a2_firing_rows: set[int],
) -> list[dict]:
    """
    Compare (parent_sl_no, level) for each row between X and Y.
    Returns firing records sorted by xlsx_row.
    rule_fired: "A1", "A2", "A1+A2", or "indirect".
    No auto-bucket misfire classification -- purely descriptive.
    """
    lookup_x = _build_lookup(resolved_x)
    lookup_y = _build_lookup(resolved_y)
    all_rows = sorted(set(lookup_x) | set(lookup_y))

    firings: list[dict] = []
    for xlsx_row in all_rows:
        rr_x = lookup_x.get(xlsx_row)
        rr_y = lookup_y.get(xlsx_row)
        if rr_x is None or rr_y is None:
            continue

        parent_x = _get_parent_sl_no(rr_x, resolved_x)
        parent_y = _get_parent_sl_no(rr_y, resolved_y)
        level_x = rr_x.level
        level_y = rr_y.level

        if parent_x == parent_y and level_x == level_y:
            continue

        cr = rr_x.classified_row
        in_a1 = xlsx_row in a1_firing_rows
        in_a2 = xlsx_row in a2_firing_rows
        if in_a1 and in_a2:
            rule_fired = "A1+A2"
        elif in_a1:
            rule_fired = "A1"
        elif in_a2:
            rule_fired = "A2"
        else:
            rule_fired = "indirect"

        firings.append({
            "xlsx_row": xlsx_row,
            "sl_no": cr.sl_no_value or "",
            "classification": cr.classification.value,
            "current_parent_sl_no": parent_x if parent_x is not None else "",
            "proposed_parent_sl_no": parent_y if parent_y is not None else "",
            "current_level": level_x if level_x is not None else "",
            "proposed_level": level_y if level_y is not None else "",
            "rule_fired": rule_fired,
            "desc": _trunc(cr.description, 60),
        })

    return firings


# ------------------------------------------------------------------
# Per-fixture runner
# ------------------------------------------------------------------

def _run_fixture(
    fixture_file: str,
    sheet_name: str,
    mapping_config: MappingConfig,
    output_stem: str,
) -> dict:
    """Run both pipelines on one fixture+sheet. Write JSON + TXT. Return agg."""
    fixture_path = str(FIXTURES_DIR / fixture_file)
    sheet_config = next(sc for sc in mapping_config.sheets if sc.sheet_name == sheet_name)
    global_settings = mapping_config.global_settings
    header_row = sheet_config.header_row

    # Replicate orchestrator skip logic
    reader = BoqReader(fixture_path)
    skip_rows: set[int] = set()
    if header_row is not None:
        skip_rows.add(header_row)
        if sheet_config.header_row_count == 2:
            skip_rows.add(header_row + 1)
    skip_rows.update(sheet_config.skip_top_rows_after_header)

    raw_rows = [
        rr for rr in reader.iter_rows(sheet_name)
        if rr.row_number not in skip_rows
        and (header_row is None or rr.row_number >= header_row)
    ]

    classified_rows = [classify_row(rr, sheet_config, global_settings) for rr in raw_rows]

    # Apply sec 7.28 to BOTH pipelines (mutates in place once; both pipelines read same list)
    _apply_unit_based_demotion_post_pass(classified_rows)
    total_rows = len(classified_rows)

    # Pipeline X: production resolver
    resolved_x = resolve_hierarchy(classified_rows, sheet_config, global_settings).rows

    # Pipeline Y: custom resolver with A1 + A2-reframed
    a1_firing_rows: set[int] = set()
    a2_firing_rows: set[int] = set()
    resolved_y = _resolve_pipeline_y(
        classified_rows, sheet_config, global_settings, a1_firing_rows, a2_firing_rows
    ).rows

    firings = _compute_diff(resolved_x, resolved_y, a1_firing_rows, a2_firing_rows)

    a1_count = sum(1 for f in firings if f["rule_fired"] == "A1")
    a2_count = sum(1 for f in firings if f["rule_fired"] == "A2")
    combined = sum(1 for f in firings if f["rule_fired"] == "A1+A2")
    indirect = sum(1 for f in firings if f["rule_fired"] == "indirect")

    agg = {
        "fixture": fixture_file,
        "sheet_name": sheet_name,
        "total_rows": total_rows,
        "total_firings": len(firings),
        "a1_direct_firings": a1_count,
        "a2_direct_firings": a2_count,
        "a1_a2_combined_firings": combined,
        "indirect_firings": indirect,
        "firings": firings,
    }

    OUTPUT_DIR.mkdir(exist_ok=True)
    json_path = OUTPUT_DIR / f"{output_stem}.json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(agg, fh, indent=2)

    txt_path = OUTPUT_DIR / f"{output_stem}.txt"
    _write_txt(txt_path, agg)

    return agg


# ------------------------------------------------------------------
# TXT output
# ------------------------------------------------------------------

_HDR = (
    f"{'xlsx_row':<9} | {'sl_no':<12} | {'classification':<18} | "
    f"{'curr_parent':<14} | {'prop_parent':<14} | "
    f"{'curr_lvl':<8} | {'prop_lvl':<8} | {'rule_fired':<10} | desc[:60]"
)
_SEP = "-" * len(_HDR)


def _fmt_row(f: dict) -> str:
    return (
        f"{str(f['xlsx_row']):<9} | {str(f['sl_no']):<12} | "
        f"{str(f['classification']):<18} | "
        f"{str(f['current_parent_sl_no']):<14} | {str(f['proposed_parent_sl_no']):<14} | "
        f"{str(f['current_level']):<8} | {str(f['proposed_level']):<8} | "
        f"{str(f['rule_fired']):<10} | {f['desc']}"
    )


def _write_txt(path: Path, agg: dict) -> None:
    firings = agg["firings"]
    lines: list[str] = []

    lines += [
        "=" * 72,
        "Approach A-reframed Audit -- per-fixture diagnostic",
        "=" * 72,
        f"Fixture:               {agg['fixture']}",
        f"Sheet:                 {agg['sheet_name']}",
        f"Total rows processed:  {agg['total_rows']}",
        f"Total firings (X!=Y):  {agg['total_firings']}",
        f"  Rule A1 direct:      {agg['a1_direct_firings']}",
        f"  Rule A2 direct:      {agg['a2_direct_firings']}",
        f"  A1+A2 combined:      {agg['a1_a2_combined_firings']}",
        f"  Indirect-effect:     {agg['indirect_firings']}",
        "",
        "Pipeline X: classify -> sec-7.28 -> production resolve_hierarchy()",
        "Pipeline Y: classify -> sec-7.28 -> custom resolver (A1 + A2-reframed)",
        "NO auto-bucket misfire classification -- user reviews sample, calls misfires.",
        "=" * 72,
        "",
    ]

    lines.append(f"--- Sample: first 20 firings (for quick eyeball) ---")
    lines.append(_HDR)
    lines.append(_SEP)
    for f in firings[:20]:
        lines.append(_fmt_row(f))
    if not firings:
        lines.append("  (no firings)")
    lines.append("")

    lines.append(f"--- All {len(firings)} firings ---")
    lines.append(_HDR)
    lines.append(_SEP)
    for f in firings:
        lines.append(_fmt_row(f))
    if not firings:
        lines.append("  (no firings)")
    lines.append("")
    lines.append("=== END ===")

    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------

def main() -> None:
    print("Approach A-reframed audit -- starting")
    print(f"Output directory: {OUTPUT_DIR}")
    print()

    for entry in FIXTURES:
        fixture_file = entry["fixture_file"]
        sheet_name = entry["sheet_name"]
        output_stem = entry["output_stem"]

        mapping_config = _snitch_config() if "snitch" in fixture_file else _boq_config()

        print(f"Processing: {fixture_file} / {sheet_name}")
        agg = _run_fixture(fixture_file, sheet_name, mapping_config, output_stem)

        print(f"  Total rows:    {agg['total_rows']}")
        print(f"  Total firings: {agg['total_firings']}")
        print(f"    A1 direct:   {agg['a1_direct_firings']}")
        print(f"    A2 direct:   {agg['a2_direct_firings']}")
        print(f"    A1+A2:       {agg['a1_a2_combined_firings']}")
        print(f"    Indirect:    {agg['indirect_firings']}")
        print(f"  JSON: {output_stem}.json")
        print(f"  TXT:  {output_stem}.txt")
        print()

    print("Done. Both fixtures processed.")
    print()
    print("Decision criterion:")
    print("  Low misfire rate on sample => land A1+A2 next sub-phase")
    print("  Appreciable misfires       => park + codify 'no more parser fuzzy rules'")


if __name__ == "__main__":
    main()
