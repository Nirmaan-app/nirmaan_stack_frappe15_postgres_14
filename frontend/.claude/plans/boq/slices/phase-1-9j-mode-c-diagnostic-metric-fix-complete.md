### Phase 1.9j --- Mode C diagnostic metric fix ✅ COMPLETE

Diagnostic-script-only sub-phase. Replaces the broken `line_items_with_non_none_qty_count`
metric with three mutually-exclusive counts per role family (qty / rate / amount).
No parser source touched. Parser tests unchanged at 291 PASS / 0 FAIL.

**What changed in `single_area_triage_1_9i.py`:**

- Added `_role_metric(role_assigned, real_flags)` helper returning three-count dict.
- Added role-family membership constants `_QTY_FAMILY_ROLES`, `_RATE_FAMILY_ROLES`,
  `_AMOUNT_FAMILY_ROLES`.
- In `_run_target()`: per-LINE_ITEM-row appending of qty/rate/amount real-flags;
  per-target three-count computation; sum-invariant assertion raises ValueError if
  `real + zero_default + role_unassigned != total_line_items_count` for any role family
  on any target.
- New output fields per target: `line_items_with_real_<role>_count`,
  `line_items_with_<role>_zero_default_count`,
  `line_items_with_<role>_role_unassigned_count` for role in {qty, rate, amount}.
- Deprecated `line_items_with_non_none_qty_count` retained with inline comment for
  one transition cycle of comparability with 1.9i baseline.
- TXT renderer per-target block + new aggregate-summary three-count block.
- Output filenames changed from `_1_9i_output.{json,txt}` to `_1_9j_output.{json,txt}`;
  1.9i baseline files at `c3b2ed1d` preserved untouched.
- Added `_self_test()` callable via `--self-test` CLI flag; 3 synthetic cases
  verify the helper's three-count logic. Kept in-script (no test file added) so
  parser test count stays at 291.

**Real-flag definition (per role family):**

`real` = role assigned in `SheetConfig.column_role_map` AND
`ClassifiedRow.<role_field>` is not None. For qty: also excludes `cr.is_rate_only`
rows (§9 #66 blank-to-zero coercion and rate-only markers). Rate family checks
`rate_combined`/`rate_supply`/`rate_install`. Amount family checks
`amount_total`/`amount_supply`/`amount_install`.

**Sum invariant:** `real + zero_default + role_unassigned == total_line_items_count`
for each of qty / rate / amount on every target. Asserted in `_run_target` via
explicit `raise ValueError` on violation. Re-run on the 11 original 1.9i targets
showed no violations.

**Empirical headline from re-run** (`single_area_triage_1_9j_output.txt` aggregate,
2372 total line items across 11 targets):

```
qty   : real=  1617  zero_default=    32  role_unassigned=   723
rate  : real=   733  zero_default=  1639  role_unassigned=     0
amount: real=  2339  zero_default=    33  role_unassigned=     0
```

vs deprecated `line_items_with_non_none_qty_count` which scored 100% non-None on
every target (because 0.0 was treated as non-None). Mode C confirmed: the prior metric
was structurally incapable of distinguishing "parser found qty" from "qty unassigned
and defaulting to 0."

**Top finding: 723/2372 (30.5%) of line items have NO qty column assigned at all.**
Largest single contributor: Target 4 (Paytm ELEC, 553 items, role_unassigned=553)
— confirmed Mode A failure (merged-cell two-row header, hrc=1 misses the area names).
Target 5 (Paytm HVAC, 170 items) similarly: role_unassigned=170. Combined these two
targets account for 723/723 of the unassigned bucket. All other 9 targets show
role_unassigned=0 for qty — clean single-area sheets with qty column correctly mapped.
Mode A fix in Phase 1.9m should collapse role_unassigned for these targets.

Selected per-target highlights:
- Target 4 (Paytm ELEC, 553 items): qty real=0, zero_default=0, role_unassigned=553 — Mode A failure confirmed.
- Target 9 (K Mall HVAC, 67 items): qty real=65, zero_default=2, role_unassigned=0 — clean parse; 2 rate-only rows coerced.
- Target 11 (Kohler HVAC, 69 items): qty real=66, zero_default=3, role_unassigned=0 — clean; rate all zero_default (rate column absent or unrecognized).

**Caveat for follow-up refinement:** The real flag uses `cr.<role_field> is not None`
as a proxy for "source cell was non-empty." This is accurate if the parser preserves
None for blank cells at the `ClassifiedRow` layer. Step 0 verify-current-state
confirmed the type signatures (`qty: float | None = None`, etc.) but did not trace
every parsing code path to confirm None-preservation end-to-end. If any §9 #66-style
blank-to-zero coercion occurs at the `ClassifiedRow` layer (beyond the documented
`is_rate_only` path), real counts for qty/amount are slightly inflated and
zero_default slightly deflated; headline signals (role_unassigned distribution,
rate zero_default ratio) are unaffected. Verification recommended in a future
refinement (1.9j.1 candidate, low priority) or as a side-check during 1.9n re-run
analysis.

**Test impact:** Parser tests 291 unchanged. Script `--self-test` adds 3 synthetic
cases (all-real, all-zero-default, role-unassigned), all PASS. No new files in `tests/`.

**§9 #54 ECHO check:** xlsx fixtures perturbed by parser re-run; cleared via
`git restore nirmaan_stack/services/boq_parser/tests/fixtures/*.xlsx` before commit.

**Status:** CLOSED. Chore commit `68befb2e`. Docs commit see git log.

