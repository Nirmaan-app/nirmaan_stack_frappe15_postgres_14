### Diagnostic metric repair --- source_present + two-mode output (chores, no parser source touched)

Two back-to-back diagnostic-script-only chores extending `single_area_triage_1_9i.py`.
No parser source touched. Parser tests unchanged at 375 PASS / 0 FAIL.

**Chore #1 (78ea7d49) --- `source_present_but_unparsed` signal + multi-area frozensets:**

- `_role_metric()` gains a 3rd arg `source_present_flags: list[bool]` and returns a 4th
  bucket: `source_present_but_unparsed` = line items where the role is assigned, the value
  is None (zero_default), AND the raw source cell was non-blank. Distinguishes "BoQ is
  unpriced" from "parser failed to parse a value that was present."
- New `_source_present_for_family(cr, sc, family_roles)` helper: walks `sc.column_role_map`
  to find columns mapped to any role in the given frozenset; checks `cr.raw_row.cells` for
  non-blank values.
- Multi-area role names added to family frozensets: `rate_combined_by_area`,
  `rate_supply_by_area`, `rate_install_by_area` added to `_RATE_FAMILY_ROLES`;
  `amount_by_area` added to `_AMOUNT_FAMILY_ROLES`. Without these, multi-area sheets
  would falsely register `role_assigned=False` for rate/amount families.
- 4 new `--self-test` cases (Cases 4-7): all-source-blank, all-source-present-and-parsed,
  mixed-with-1-parser-bug, role-unassigned-ignores-phantom-flags. Total: 7 cases, all PASS.

**Chore #2 (63bead94) --- two-mode output + `_run_mode` extraction:**

- Extracted `_run_mode(reader, wp, fname, sheet_name, header_row, hrc, hcells)` helper.
  Builds SheetConfig, runs `auto_guess_sheet_config` with given hrc, parses the sheet,
  collects the full 4-bucket metric per role family. Returns result dict or
  `_load_exception_result` on exception.
- `_run_target()` calls `_run_mode` twice: Mode 1 (`hrc=None`, production auto-detect)
  and Mode 2 (`hrc=1`, forced-debug). Output JSON structure:
  `diagnostic.mode_1_auto_detect` + `diagnostic.mode_2_hrc_1`.
- `_render_txt` rewritten with two-mode blocks per target.
- Module docstring rewritten to document 4-bucket metric definition and two-mode design intent.
- Output filenames unchanged: `single_area_triage_1_9j_output.{json,txt}`.

**Key empirical finding (Chore #2):** All 11 targets show zero Mode 1 vs Mode 2 delta.
Paytm HVAC's 150 `source_present_but_unparsed` qty rows are a parser-side text-coercion
issue, not a header-detection issue. Column D "QNT" has text values in those rows that
numeric coercion fails on. A two-row-header fix (Mode A) would not help --- `hrc=2`
auto-detect already fires correctly; forcing `hrc=1` produces identical metrics.
Investigation of the coercion gap is queued as Phase 1.9q candidate
(requires ground-truth pass per agreement #28).

**Test impact:** Parser tests 375 unchanged. `--self-test` total: 7 synthetic cases,
all PASS. No new files in `tests/`. Kept in-script so parser test count stays at 375.

**Status:** CLOSED. Chore commits: `78ea7d49` (Chore #1), `63bead94` (Chore #2).
Docs commit see git log.

