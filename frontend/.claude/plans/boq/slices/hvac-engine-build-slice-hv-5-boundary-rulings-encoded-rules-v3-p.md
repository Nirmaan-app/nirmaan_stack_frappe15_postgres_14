## HVAC engine -- Build slice HV-5 (boundary rulings encoded: rules v3 + prompt v1.2) COMPLETE

Encodes the owner's Boundary Rulings register into BOTH voters, plus the two mechanical fixes the
deep-dive priced. On `feature/boq-classification-eval` (one feat commit + this docs commit).
**RULES-ONLY MEASUREMENT -- no AI calls; the prompt v1.2 edits take effect and are measured at the
next AI run.** Registry stays OFF; Set-2 never opened; no doctype change, so no migrate.

### Headline -- two views

| view | truth used | accuracy |
|---|---|---:|
| HV-4 baseline (v2 assets) | current | 66.91% |
| **(a) v3 vs CURRENT truth** | current, unedited | **73.87%** |
| **(b) v3 vs OWNER-CORRECTED truth** | 65-row packet applied | **77.75%** |

View (a) is the comparable number (+6.96 pp, +95 rows). View (b) is the honest one: it scores against
the truth the register now defines. **No truth file was edited** -- the packet is
`_classification_review/hvac_rules_v3_rescore/LABEL_CORRECTIONS.csv` and is applied only in memory.

**Band shift, and this is the result that matters for routing:** LOW **935 -> 470**, HIGH **270 -> 629**
at 81.7% (view a) / 85.5% (view b). M1 did its job -- the 1.000/HIGH confident-wrong composite family
is gone. 414 rows improved against 122 regressions.

### Step-0 gate -- the r208 discrepancy: class (a), print-layer slip

The deep-dive's underlying data was CORRECT. `deepdive.json` carries
`sheet='HVAC HIGH SIDE CHILLED WATER'` on that trace; the report's renderer prints only
`<boq> r<row>` and DROPS the sheet field, and BOQ-26-00009 has multiple sheets, so the address is
ambiguous. With the VERBATIM sheet name (note the TRAILING SPACE, #152) the live DB confirms
`BOQ-26-00009 / 'HVAC HIGH SIDE CHILLED WATER ' r208 = "200 mm Dia"` under the Ultrasonic BTU meters
parent -- exactly as claimed. `'HVAC LOWSIDE BOQ' r208` is the underdeck insulation row; both are real,
they are different rows. **Spot-audit run anyway: 10 rows across 5 piles, address -> live DB
description, 0 mismatches (0.0%).** No join defect; slice proceeded.

Two follow-ups worth carrying (neither in this slice's file scope): the deep-dive renderer should
print the sheet, and any address taken from a report to the DB must use the VERBATIM sheet name --
the corpus artefacts store the STRIPPED form.

### The register as law -- each ruling, one line

Every rule carries `source: "owner ruling 2026-07-21, workbook provenance <sheet>"`.

| # | ruling | mechanism shipped |
|---|---|---|
| R1 | flexible/foil duct -> ADP; Ducting is rigid fabricated sheet metal only | `ADP-FLEXDUCT` 0.55 + `ADP-FLEXDUCT-ANC` 0.5; `DUCT-FLEX-EXCL` and `DUCT-FLEX-ANC-EXCL` forbid Ducting in flex context (line AND ancestor) |
| R2 | pipeline instruments -> Valve Package; Sensors keeps the BMS basket | `VLV-METER-PROV` PROMOTED 0.2 -> 0.55 and extended (thermometer, thermowell, gauges, test points); new `VLV-INSTRUMENT-ANC` 0.5; `thermometer`/`pressure gauge` REMOVED from `SNS-KW` |
| R3 | plenum -> ADP, beating an AHU section | `ADP-PLENUM-ANC` 0.5 (> AHU-ANC 0.45) **and** `AHU-PLENUM-ANC-EXCL` forbidding AHU at a plenum resolution point |
| R4 | starter/control/VFD panel -> Panels, beating an AHU section | `PNL-ANC-TYPE` 0.5 + `AHU-PANEL-ANC-EXCL` (regex) -- same mechanism pair as R3 |
| R5 | damper accessories -> ADP, damper context ONLY | `ADP-DAMPER-ANC` 0.5 + `PNL-DAMPER-ANC-EXCL` + `SNS-DAMPER-ANC-EXCL`; both guards fire only at a damper resolution point, so generic panels and BMS sensors are untouched |
| R6 | canvas/flexible connections resolve by SERVED context | `ADP-CANVAS` at **0.42** -- a weight WINDOW, see the caution below |
| R7 | filters: standalone -> Misc, integral -> the unit | `MSC-FILTER-STANDALONE` 0.45 + `AHU-FILTER-EXCL` (regex on filter-as-subject) |
| R8 | air curtains -> Misc | `MSC-AIRCURTAIN` 0.55 + `FAN-AIRCURTAIN-EXCL` |
| R9 | FCU with factory-fitted valve package stays CHW Units | `VLV-FCU-ANC-EXCL` -- forbids Valve Package at an FCU resolution point; retires the 11-row known cost HV-4 accepted |
| R10 | work/service lines -> Misc regardless of system | `MSC-WORKLINE` at **0.6**, deliberately ABOVE the item-keyword band, guarded by `exclude_if` on SITC scopes |

**R6 CAUTION, on the record.** The rule grammar has no conditional, so "resolve by served context" is
expressed as a weight window: with the 0.05 direct-signal ranking bonus, `ADP-CANVAS` scores 0.47
effective -- clearing `DUCT-ANC` (0.45) so ADP wins under a duct header, staying under
`FAN-ANC-TYPE` (0.5) so Fans wins under a fan header. **That window is only 0.03 wide.** Any future
change to `DUCT-ANC`, `FAN-ANC-TYPE` or `scoring.direct_signal_bonus` will silently break the ruling.
It is covered by tests in both directions, and a proper conditional grammar is the durable fix.

**Two rulings needed a second pass, found by probing before writing tests, not after:** R6's canvas
token was already present in `ADP-KW` at 0.55, so the new rule STACKED to 0.95 and ADP won even in fan
context (fixed by removing the token from `ADP-KW`); and R10 at 0.5 lost to the system noun
("Dismantling of existing ducting" -> Ducting 0.55), fixed by lifting it to 0.6.

### Mechanical fixes

- **M1 ancestor-aware composite guard (runner, HVAC-gated).** New `applies_to_ancestor` flag on
  exclusion rules; those patterns are evaluated against the RESOLUTION POINT instead of the line, and
  are consumed ONLY on the nearest-hit path -- a legacy discipline has no resolution point, so
  electrical is structurally unable to reach them. `INS-COMPOSITE-ANC-EXCL` encodes the 4A ruling at
  ancestor level: a header describing a HOST (pipe/duct/valve) with insulation as an ATTRIBUTE cannot
  yield Insulation for its children. **The discriminator is DISTANCE, not vocabulary** -- the pattern
  requires >= 2 intervening words, so the compound-noun item forms ("duct insulation", "pipe
  insulation", "underdeck insulation") never match and the three 4A insulation-is-the-item families
  still win. Proven both directions by test.
- **M2 singular pipe tokens** added to `PIPE-ANC` -- hypothesis H5, deferred since HV-3, settled by
  the deep-dive trace: real headers say `DRAIN PIPE` / `REFRIGERANT PIPE`.
- **M3 uninformative-near-parent skip NOT built** -- held by the owner pending the r208 answer.
  Note that R2's new `VLV-INSTRUMENT-ANC` incidentally relieves part of pile 10 by making the
  instrument preamble an informative resolution point, so the walk now stops there.

### Label-correction packet (Part 4)

`LABEL_CORRECTIONS.csv`, 65 rows, no truth edited in place: 57 grille/diffuser neck-size leaves
Ducting -> ADP, and 8 work-line rows R10 overrules (ADP/Ducting/Piping/Panels -> Misc).

**Note on the count:** the brief said "the 43 grille rows". 43 was the SIZE OF THE FAILURE PILE (the
rows the classifier got wrong). The full population of Ducting-labelled rows sitting under a
grille/diffuser header is **57** -- the correction applies to the mislabelled rows, not only to the
ones that happened to be misclassified.

### Tests

`test_runner_hvac.py` 52 -> **79** (+27; the pre-run estimate was 73 -- I under-counted my own new
cases). All green. Every R-rule has a positive and, where it has one, its guard negative: R1 flex-duct
positive + Ducting-forbidden + rigid-ducting-unaffected; R2 thermometer + BTU-leaf inheritance + the
Sensors-keeps-BMS negative; R3 and R4 beating the AHU section with AHU proven zeroed; R5 damper panel
positive + generic-panel and BMS-sensor negatives; R6 both contexts; R7 standalone + integral; R8; R9
with Valve Package proven zeroed; R10 work-line + dismantling + the SITC guard negative. M1 is tested
in BOTH directions (composite pipe and composite valve -> host category; duct-insulation and underdeck
-> still Insulation) plus a gating assertion that electrical carries no ancestor-exclusion rules at
all. M2 positive + token presence.

**One HV-3 assertion updated, not preserved:** `test_btu_meter_is_valve_package_and_stays_low`
asserted band == LOW because HV-3 shipped that rule PROVISIONAL at weight 0.2. R2 promotes it to full
weight from the workbook, so the row is no longer LOW -- the promotion IS the ruling. Renamed to
`test_btu_meter_is_valve_package_at_full_weight` and now asserts the shipped weight. Reported, not
silently patched.

`test_decay.py` **12 -> 12, GREEN, untouched** -- no assertion collision, so the conditional scope
expansion was again not used. `test_runner_electrical.py` **82 -> 82 unchanged**.
`test_hv2_voter_harness.py` 14 -> 14. Suite 160 -> 187.

**A10 electrical proof, corpus scale:** the electrical sweep over its 2,888-row labelled corpus is
byte-identical to the HV-4 baseline (`sweep_table.csv` and `per_category_accuracy_matrix.csv` both
diff-clean; 86.88%, HIGH n=1247 @ 97.43%).

**KNOWN pre-existing failure, OUT of scope, unchanged:** `TestMigrateWorkPackageToMulti` in
`api/boq/wizard/test_update_sheet_draft.py` (3 errors of 82) --
`column "work_package" of relation "tabBoQ Sheet Draft" does not exist`.

### Residual for round 4

Full tables in `_classification_review/hvac_rules_v3_rescore/RESCORE_V3.md`. The register closed the
boundary piles it was written for; what remains is the pile-10 mechanism (held), the truth-side
questions the packet does not cover, and the ADP<->Ducting reading that survives even after the
corrections. The 80% bar is now within reach on view (b) -- 77.75% against 80% -- but the last points
look like they need the held mechanism and a clean-label re-mine, not more vocabulary.

