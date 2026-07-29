## Build slice ST-1 (freeze_classification stamps the MULTI-ENGINE resolved read -- owner Option A 2026-07-26) COMPLETE

**What shipped.** `freeze_classification` no longer sources its stamp targets from the SINGLE-DISCIPLINE
`get_sheet_categories`; it now reads the MULTI-ENGINE resolved read, so a sheet classified under two (or N)
disciplines stamps rows from EVERY vocabulary in ONE freeze -- each on the ladder winner's `is_current` row. This
closes the R2a recon asymmetry (the freeze COUNT already read the resolved ladder via `get_freeze_summary`, but the
STAMP still read one discipline). Owner ruled Option A (resolved-read stamping), forward-looking only -- any existing
stamped inaccuracy is ACCEPTED, no audit.

**The new service helper (owner-locked).** `persist.resolved_category_stamp_targets(boq, sheet_name, committed_version)`
-- the exact INVERSE of `persist.blank_category_eligible_rows`: same eligible NODE denominator (`node_type` in
{Line Item, Preamble}), same `persist.resolve_row_ladder`, same fail-open guard (a never-classified row resolves to
`""` -> blank -> NOT a target). Returns `[{excel_row, effective_category_id, resolved_discipline}]` for the NON-blank
rows only. Lives in the service layer beside its twin so both share the ONE ladder (no service->api import; mirrors
the 1a relocation).

**The freeze rewrite (`classify.freeze_classification`, in scope).**
- Stamp SOURCE repointed: `targets = persist.resolved_category_stamp_targets(boq, sheet, cv)`.
- Stamps GROUPED by `resolved_discipline`, reusing the no-commit `persist.stamp_human_verdicts_bulk` once per group,
  so each stamp lands on the ladder winner's identity (human wins > auto-accepted > higher-confidence auto > blank).
- Snapshots carry the per-row `resolved_discipline` (was the call param), `label_category_id = effective_category_id`.
- `rows_stamped` now summed across the discipline groups; `snapshots_banked = len(targets)`; return shape unchanged.
- Validation, cv-resolution, already-frozen guard, the `frozen_by/at` flag write, and the atomic single end-commit +
  rollback are ALL UNCHANGED.

**Discipline-parameter disposition (spec item 3, resolved WITHOUT a STOP).** The `discipline` param is KEPT in the
signature and STILL drives `engines.is_discipline_available(discipline)` -- removing that guard would let a freeze with
an unavailable discipline succeed where it previously threw (an observable behaviour change -> a spec-3 STOP), so it
was deliberately preserved. The param no longer selects which rows are stamped (whole-sheet by construction) -- it is
accepted-but-unused for the stamp set, mirroring `get_freeze_summary`'s existing disposition. The frontend already
calls `freeze_classification({boq_name, sheet_name})` with NO discipline arg (defaults to "Electrical", always
available), so no frontend behaviour changes.

**`get_sheet_categories` BYTE-UNTOUCHED (the freeze trap).** It is not edited; it now backs ONLY the tests' regression
pin. A new pin (`test_get_sheet_categories_stays_single_discipline`) asserts that on a multi-trade sheet it still
returns ONLY the asked discipline's rows.

**Fifth-surface one number.** snapshot_count == `resolved_category_stamp_targets` count == the resolved non-blank
eligible count == the complement of `get_freeze_summary`'s blank counts. Pinned by
`test_freeze_multitrade_fifth_surface_one_number`.

**Single-trade equivalence (spec item 5).** On a one-discipline sheet the resolved stamp source equals the old
single-discipline `get_sheet_categories` non-blank source (same excel_rows, same effective labels, same resolving
discipline). Pinned by `test_freeze_single_trade_equivalence`; the pre-existing `test_freeze_sets_flag_stamps_and_banks`
(discipline="Electrical", 3 stamped, labels earthing/db_switchgear) stays green unchanged.

**Tests (`test_classify`, +7 -> 77).** New in `TestFreezeClassification`:
`test_freeze_multitrade_stamps_both_vocabularies` (both vocab, ONE batch, per-row resolving discipline),
`test_freeze_multitrade_human_precedence_and_placement` (human wins + lands on the resolving discipline's row; the
non-resolving discipline's row is NOT stamped), `test_freeze_multitrade_blank_rows_skipped` (blank rows get no stamp,
no snapshot, no minted record), `test_freeze_multitrade_fifth_surface_one_number`, `test_freeze_single_trade_equivalence`,
`test_get_sheet_categories_stays_single_discipline`, `test_freeze_multitrade_rollback_holds` (a mid-batch failure on a
multi-trade freeze writes NOTHING -- 0 snapshots, flag unset, in-place stamps rolled back). All 8 pre-existing freeze
tests stay green (the resolved ladder reproduces the Auto-accepted + one-human single-trade fixture exactly).

**Counts (in-container, bench-verified).** `test_classify` 70 -> **77**; `test_pricing` **230 -> 230** (regression --
persist is on its consumption path, zero change). Both OK.

**Browser live-cert (`admins@nirmaan.app`; SYNTHETIC only, real product path for classify + freeze).** AI settings
`enabled=1` confirmed (precondition). Bench + vite restarted; full de-stale ritual (storage/caches/SW cleared, tab
closed + reopened, root-then-deep load); bundle marker = the category-gate amber banner + `Override the check`
control rendered on the gated sheet.
- **V1** built SYNTHETIC `BOQ-26-00143` / sheet `ST1 Two Trade` (server-seeded committed sheet, owner-chosen path): 3
  Preambles (`ELECTRICAL WORKS`/`HVAC WORKS`/`GENERAL AND CONTINGENCY`) + 7 Line Items spanning electrical + HVAC
  descriptions, rows 14/15 deliberate blanks. Pricing editor loaded it; 10 rows need a category.
- **V2** classified BOTH engines (Electrical + HVAC, whole sheet) via the Classify dialog. Completed: 6/10 auto (Elec
  7 `earthing` / 8 `panels` / 9 `wiring_cabling`; HVAC 11 `hvac_ducting` / 12 `hvac_vrf` / 13 `hvac_piping`), 4 review.
  Resolved review rows via the picker: HUMAN Electrical `earthing` on row 6, HUMAN HVAC `hvac_chw_units` on row 10
  (one human per discipline). Rows 14/15 left blank.
- **V3** FROZE via the browser button (confirm reported "1 preamble and 1 line item" blank); frozen state rendered
  ("Frozen - 27-Jul-2026 - admins@nirmaan.app", Unfreeze button, Classify disabled).
- **V4** DB: 8 snapshots, ONE batch `gtfreeze-4ac32cbe8bf0`, source "Frozen in product" -- Electrical vocab
  {earthing, earthing, panels, wiring_cabling} AND HVAC vocab {hvac_chw_units, hvac_ducting, hvac_piping, hvac_vrf}.
  Both vocabularies -> the fix landed (a single-discipline stamp would have been Electrical-only).
- **V5** snapshot count 8 == `resolved_category_stamp_targets` 8; blank 2 (row 14 Preamble, row 15 Line Item);
  8 + 2 = 10 eligible; freeze dialog said "1 preamble + 1 line item". All surfaces agree.
- **V6** row 6 stamped `earthing` on the ELECTRICAL row; row 10 stamped `hvac_chw_units` on the HVAC row; auto rows
  stamped on their engines; row 12 resolved to HVAC (`hvac_vrf`) and its Electrical `is_current` row was left
  UNSTAMPED (stamp lands on the resolving discipline only).
- **V7** rows 14 & 15: no human on either discipline, 0 snapshots.
- **V8** INHERITANCE: unfreeze -> whole-sheet re-classify (both engines) -> re-freeze. Humans stranded (not carried
  forward, as designed). Second batch `gtfreeze-125b750c3f18` with 6 snapshots (fresh autos, both vocabularies); the
  original 8-row batch stayed PERMANENT (14 total snapshots, 2 batches). Fresh resolved read, new batch.
- **V9** SINGLE-TRADE regression: SYNTHETIC `BOQ-26-00144` / `ST1 Single Trade` (Electrical only). Classified
  Electrical, froze. 3 snapshots, ONE batch, ALL Electrical (earthing/panels/wiring_cabling on rows 7/8/9); blank rows
  6 & 10 skipped (0 snapshots). Equivalent to pre-change single-discipline behaviour.
- **V10** CLEANUP: both synthetic BoQs + all sheets/nodes/qty-children/Row Category/Truth Snapshot records + both
  synthetic Projects DELETED; residual check = **0**. No real BoQ touched at any point.
- **Harness note:** the classify progress modal reached its terminal "Classification complete" state correctly (not
  stuck) this run; completion + freeze were verified via DB throughout regardless.

**Files.** `nirmaan_stack/services/boq_category/persist.py` (+`resolved_category_stamp_targets`),
`nirmaan_stack/api/boq/wizard/classify.py` (`freeze_classification` body + docstring + the stale HV-10 comment),
`nirmaan_stack/api/boq/wizard/test_classify.py` (+7 tests). Docs: this plan + root `CLAUDE.md` freeze invariant.
`get_sheet_categories`, `get_freeze_summary`, all frontend, `patches.txt`, `settings.local.json` UNTOUCHED.

