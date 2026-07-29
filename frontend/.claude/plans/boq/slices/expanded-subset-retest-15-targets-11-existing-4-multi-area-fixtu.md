### Expanded-subset retest --- 15 targets (11 existing + 4 multi-area fixtures) ✅ COMPLETE

What landed: TARGETS list in single_area_triage_1_9i.py extended from 11 to 15
by appending the 4 synthetic multi-area fixture sheets specified by Nitesh. The
original chore (9d4abf36) used incorrect filenames (missing multi_area_ prefix);
a cleanup chore (c8c9f234) corrected the 4 "file" fields. The empirical findings
below come from the corrected run.

Fixture file references:
- multi_area_merged_header_v1.xlsx: ELECTRICAL & ELV BOQ
- multi_area_merged_header_v2.xlsx: ELECTRICAL & ELV BOQ
- multi_area_single_header_v1.xlsx: HVAC BOQ
- multi_area_single_header_v2.xlsx: HVAC BOQ

Snapshot convention introduced: diagnostic_snapshots/ folder for preserving
named copies of significant diagnostic runs. The live output files are
overwritten each run; snapshots provide historical comparison points. Chore #2
smoke-run (commit 63bead94) snapshotted as chore_2_smoke_run.json + .txt before
the expanded run regenerated the live output.

Key findings from the corrected empirical run:

merged_header_v1 (ELECTRICAL & ELV BOQ):
- hrc: Mode 1=2 (auto-detect bumped), Mode 2=1. Pattern=None. Classification: single-area.
- Tier A-merged did NOT fire. The fixture was parsed as single-area despite the
  auto-detect bump. total=449, qty real=449 (100%), rate real=200/449, amount
  real=449 (100%). No src_present_unparsed. Clean parse.
- Mode 1 vs Mode 2 delta: ZERO (identical metrics at hrc=2 and hrc=1).
- Note: Phase 1.9o commit notes cited v1 ELECTRICAL sheet as the empirical case
  where tier_a_merged fires. The multi_area_merged_header_v1.xlsx diagnostic here
  shows pattern=None / single-area. Either the fixture on disk differs from the one
  used in 1.9o tests, or auto-detect at hrc=2 is routing through a different code
  path than the tier_a_merged shape expects. Requires investigation.

merged_header_v2 (ELECTRICAL & ELV BOQ):
- hrc: Mode 1=2 (auto-detect bumped), Mode 2=1. Pattern=Pattern 1. Classification:
  multi-area, 2 areas. total=370.
- 100% role_unassigned across all 3 families (qty/rate/amount). Auto_guess could
  not assign any column roles to either area. No src_present_unparsed (vacuously
  0 -- no roles assigned so no source walk).
- Mode 1 vs Mode 2 delta: ZERO (Pattern 1 fires in both modes).
- This aligns with the prediction that v2 "falls through to Pattern 1 top-row
  fallback with partial handling" -- though the result is worse than partial:
  total role_unassigned for all 370 items. The role_unassigned = 100% finding
  makes this the most critical gap in the current corpus after Paytm HVAC.

single_header_v1 (HVAC BOQ):
- hrc: Mode 1=1, Mode 2=1 (no auto-detect bump). Pattern=Pattern 1. Classification:
  multi-area, 3 areas. total=67.
- qty: real=65, zero_default=2, src_present_unparsed=2 (NEW parser-side finding).
- rate: real=60, zero_default=7, src_present_unparsed=0.
- amount: real=47, zero_default=20, src_present_unparsed=0.
- Mode 1 vs Mode 2 delta: ZERO (no hrc delta as expected for single-header shape).

single_header_v2 (HVAC BOQ):
- hrc: Mode 1=1, Mode 2=1 (no auto-detect bump). Pattern=Pattern 1. Classification:
  multi-area, 3 areas. total=67.
- qty: real=65, zero_default=2, src_present_unparsed=2 (same as v1).
- rate: real=0, zero_default=67, src_present_unparsed=0 (ALL zero -- rate column
  not assigned in v2 vs 60 real in v1). This is the sharpest v1 vs v2 difference.
- amount: real=47, zero_default=20, src_present_unparsed=0 (same as v1).
- Mode 1 vs Mode 2 delta: ZERO.

Summary table (Mode 1 only, no Mode 1 vs Mode 2 delta on any new fixture):

  Fixture          | hrc | pattern   | class       | areas | total | qty_real | rate_real | amt_real | src_unp
  merged_hdr_v1    |  2  | None      | single-area |   0   |  449  |   449    |    200    |   449    |   0
  merged_hdr_v2    |  2  | Pattern 1 | multi-area  |   2   |  370  |     0    |      0    |     0    |   0
  single_hdr_v1    |  1  | Pattern 1 | multi-area  |   3   |   67  |    65    |     60    |    47    |   2
  single_header_v2 |  1  | Pattern 1 | multi-area  |   3   |   67  |    65    |      0    |    47    |   2

New parser-side findings to queue:
1. single_header_v1 + v2: qty src_present_but_unparsed=2 each -- 2 rows have a
   qty source cell value that the parser dropped. Candidate for the Phase 1.9q
   investigation queue alongside Paytm HVAC.
2. merged_header_v2: 100% role_unassigned across all families. The Pattern 1
   multi-area detection fires but auto_guess assigns nothing -- either the column
   layout is not recognizable by any keyword or the per-area assignment logic
   doesn't match this shape.
3. merged_header_v1 tier_a_merged miss: needs a follow-up diagnostic or direct
   inspection of the fixture to understand why pattern=None for a fixture named
   "merged_header".

Existing 11 targets: numbers identical to Chore #2 snapshot. Spot-checked:
- Paytm HVAC: qty src_present_unparsed=150/336 baseline confirmed.
- Kohler Electrical: total=236, qty real=236, clean.
- Electrical Unpriced: total=154, unchanged.
Mode 1 vs Mode 2 delta: zero for all 11 (consistent with prior chores).

Implications for queue positions 4 and 5: The merged_header_v2 100%
role_unassigned gap and the single_header src_present_unparsed=2 finding both
strengthen the case for Phase 1.9q work on the role-assignment + text-coercion
front before proceeding to the strategic re-evaluation chat. The merged_header_v1
tier_a_merged miss is the most unexpected finding and warrants ground-truth
inspection before the re-eval chat.

Parser tests 375 unchanged --- agreement 27 strict.

Chore commits: 9d4abf36 (TARGETS extension) + c8c9f234 (filename correction)
Docs commit: 483b53bd (original, now amended)

