### Phase 1.9n --- Re-run single-area diagnostic on subset + metric correction (1.9j-1.9n cycle closes) ✅ COMPLETE

Final sub-phase of the 1.9j-1.9n locked plan. Diagnostic-script-only re-run on the 9
single-area-candidate targets (3-11) from the original 1.9i target list, using the
Phase 1.9j three-count metric to measure the cumulative effect of Phase 1.9k (Mode B/F/F3c),
Phase 1.9l (Mode D), and Phase 1.9m (Mode A) on those targets.

No parser source touched. Parser tests unchanged at 337 PASS. No Frappe boundary crossed.

**Implementation:** Option A — extended `single_area_triage_1_9i.py` with a `--subset 1_9n`
CLI flag. Changed `main()` signature to `main(subset: str | None = None)`. When
`--subset 1_9n` is passed, filters `TARGETS[2:]` (targets 3-11) and writes to
`single_area_triage_1_9n_output.{json,txt}`. Original 1.9j output paths unaffected.
~18 lines net new/changed — well under the 30-line Option-B threshold.

**Metric correction: `_QTY_FAMILY_ROLES` widened to include `qty_total`:**

Initial run showed three apparent regressions (Kohler HVAC, Inovalon, Electrical Unpriced
all moved from 0 to fully-unassigned qty). STOP triggered. Investigation confirmed these
are NOT parser regressions — Phase 1.9l Mode D's longest-match-wins precedence fix
correctly reclassified "Total Qty" column headers from `qty` → `qty_total`. The 1.9j
metric definition `frozenset({"qty"})` excluded `qty_total`, so `qty_role_assigned` was
False for those sheets despite the column being correctly typed. Fix: widened to
`frozenset({"qty", "qty_total"})`. A single constant change; no parser source touched.

**Outputs:**
- `single_area_triage_1_9n_output.json` (66,055 bytes)
- `single_area_triage_1_9n_output.txt` (36,982 bytes)

**Headline finding: clean-parse count 2 of 9** (Bill of Quantities + Kohler Electrical).
Same count as the 1.9i baseline on the strict zero-default=0 definition — but the
semantic coverage is meaningfully better after the metric correction and 1.9k/l/m fixes.

**Per-target qty role_unassigned at 1.9n (vs 1.9j baseline, 9 kept targets):**

| Target | 1.9j unassigned | 1.9n unassigned | Delta | Notes |
|---|---|---|---|---|
| 3. Bill of Quantities | 0/449 | 0/449 | 0 | CLEAN |
| 4. Paytm ELEC | 553/553 | 553/553 | 0 | Mode A promotes to hrc=2 but Supply/Installation reserved kws block pattern; unchanged as predicted |
| 5. Paytm HVAC | 170/170 | 0/336 | −170 | Improved: Mode B QNT synonym assigned qty role; total doubled 170→336 due to Mode F rstrip reclassifying header-repeat rows as LINE_ITEM; 184 real + 152 zero_default |
| 6. Electrical BoQ | 0/230 | 0/261 | 0 | 31 zero_default; total grew (Mode F rstrip effect) |
| 7. Electrical Unpriced | 0/155 | 0/154 | 0 | Metric gap corrected: column is qty_total, not qty; real=149, zero_def=5 |
| 8. Inovalon | 0/106 | 0/106 | 0 | Metric gap corrected: column is qty_total; real=93, zero_def=13 |
| 9. K Mall HVAC | 0/67 | 0/67 | 0 | No regression ✓ |
| 10. Kohler Electrical | 0/236 | 0/236 | 0 | CLEAN; no regression ✓ |
| 11. Kohler HVAC | 0/69 | 0/69 | 0 | Metric gap corrected: column is qty_total; real=66, zero_def=3 |

**Aggregate three-count metric (9 targets, corrected):**

```
Total line items across all targets: 2231
qty:    real=1472  zero_default=206  role_unassigned=553
rate:   real=688   zero_default=1543 role_unassigned=0
amount: real=2208  zero_default=23   role_unassigned=0
```

Aggregate qty_unassigned: 723 (1.9j 9-target baseline) → 553 (1.9n corrected), delta=−170.
Sole residual: Paytm ELEC (553 items). All other targets have qty assigned.

**Strategic observation:** The 1.9j-1.9n cycle delivered one empirical gain: Paytm HVAC's
170 qty items moved from role_unassigned to assigned (via Mode B QNT synonym in 1.9k).
The three apparent regressions were a metric definitional gap exposed by 1.9l's semantic
precision improvement — a win for correctness, not a loss. Paytm ELEC (553 items) remains
the sole unresolved target, requiring either non-reserved area names or Pattern 6 detection
(not in any current sub-phase plan). The Mode A auto-detect (1.9m) fires correctly for
Paytm but is blocked by reserved keywords at the pattern-detection step — confirming the
1.9m design constraint documented in the 1.9m section above.

**Empirical input for the strategic re-evaluation conversation (v5.17 §22.8):** the
1.9j-1.9n cycle reduced the 9-target qty_unassigned from 723 to 553 (−170, Paytm HVAC
alone). The metric correction also revealed that 1.9l improved semantic precision beyond
what the original metric could measure.

**Audit-script regression check (#25): NOT APPLICABLE this sub-phase.** No parser source
touched, classifier dictionary unchanged.

**Phase 1.x Frappe tests:** NOT RE-RUN. Diagnostic-script-only; no parser/Frappe boundary
crossed per agreement #20.

**§9 #54 ECHO check:** 11 synthetic xlsx fixtures perturbed by both diagnostic runs.
Restored via `git restore "nirmaan_stack/services/boq_parser/tests/fixtures/synthetic_*.xlsx"`
(broad glob, confirmed safe when all 11 are modified per session verification).

**Status:** CLOSED. Chore commit `3af8e828`. Docs commit see git log.

**The 1.9j-1.9n locked cycle is now complete.** Next: strategic re-evaluation chat
(per v5.17 §22.8) with this 1.9n empirical data as input.

