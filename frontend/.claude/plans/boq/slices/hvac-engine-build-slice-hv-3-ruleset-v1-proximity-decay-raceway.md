## HVAC engine -- Build slice HV-3 (ruleset v1 + proximity decay + raceway) COMPLETE

Applies the evidence-mandated ruleset improvements from the Set-1 label scoring, wires the HVAC
proximity-decay curve, and adds the owner's new `hvac_raceway` category across the assets. On
`feature/boq-classification-eval` (one feat commit + this docs commit). **RULES ONLY -- no AI calls
anywhere in this slice** (the saved v0 AI predictions are reused verbatim as the comparison column).
Registry stays OFF (HV-1 gate untouched); `scoring.json`, `routing_config.json`, `engines.py`,
`orchestrator.py`, `ai_voter.py`, `routing.py`, `persist.py` and all electrical assets are UNTOUCHED.
No doctype change, so no migrate. No user-visible change.

### The evidence base

`_classification_review/hvac_labels_and_scoring/SCORING_V0.md` -- the team's provisional Set-1 hand
labels scored against the saved v0 predictions over **1,366 line items** (11 sheets). Rules v0 = 52.49%,
AI v1.0 = 84.33%. That scoring is what mandated (and, twice, what REFUTED) the changes below.

**Feed fidelity, proven BEFORE any edit.** The re-score rebuilds each row's classifier feed with the
tracked `harness/decay_sweep.py` `_ancestor_feed` (parent_excel_row walk, root-first
`[sheet] + [desc+notes]`, matching `context_builder.py:181-184`). Run against the UNMODIFIED v0 assets it
reproduced the saved `rule_category` on **1847/1847 eligible rows (100.00%)** and the saved headline
exactly (52.49% / HIGH 77.41% / n=1366). Every v1 number below is therefore a like-for-like comparison
on the same rows, same truth, same feed.

### What shipped (rules_hvac.json 0.1-hv1-v0 -> 1.0-hv3-v1)

Every v1 rule carries `source: "set1-scoring 2026-07-20 (provisional labels)"`.

- **(a) RACEWAY CARVE-OUT** (owner ruling). New category `hvac_raceway` ("Raceway" / "cable trays,
  raceways, and tray accessories") = the 17th HVAC category. New `RCW-KW` (0.55) + `RCW-ANC` (0.4,
  mirroring electrical's `CT-ANC`). Tray tokens REMOVED from `CBL-KW`/`CBL-ANC` -- Cables is cabling
  only. Guards BOTH ways: `CBL-TRAY-EXCL` (a tray line never scores Cables -- necessary because every
  tray line contains the word "cable") and `RCW-DRIPTRAY-EXCL` (a unit drip/drain/condensate tray never
  scores Raceway).
- **(b) H4 CONFIRMED (100%, n=66) -- the owner's 4A ruling encoded.** New `INS-ATTRIBUTE-EXCL`, a
  regex exclusion on `hvac_insulation`: an insulation word that is an ATTRIBUTE of a pipe or valve line
  ("insulated pipe", "pipe with insulation", "insulated butterfly valve", "with 13 mm insulation") does
  NOT claim the row. Insulation claims a row only when insulation is the SUBJECT.
- **(d) H1 + H7 REFUTED -- their proposed edits deliberately NOT applied.** H1's bare duct tokens
  (15.6% agreement) and any BTU->Sensors rule (0/31 -- truth said Valve Package on every labelled meter
  row) are absent, and there are negative tests locking both absences. In H7's place: `VLV-METER-PROV`,
  a deliberately WEAK (0.2, lands LOW) BTU/energy/flow-meter -> Valve Package rule, `plain`-stamped
  PROVISIONAL on noisy labels and owed a re-check at clean labels.

### What was mandated, measured, and REJECTED

- **(c) Raising `ADP-ANC`.** The slice mandated raising the ADP ancestor weight so air-distribution
  children reach HIGH/MED. Measured on the same 1,366 rows: **ADP-ANC 0.4 -> 52.86%, 0.45 -> 50.29%,
  0.5 -> 50.29%** (flat). Raising it costs ~35 rows net -- drift 45 ducting / 31 AHU / 23 VRF into ADP,
  ducting recall collapsing 53.6% -> 21.6% and VRF 97.8% -> 73.1%. 0.45 is no safe middle: it TIES the
  sibling 0.45 ancestors (`DUCT-ANC`/`AHU-ANC`/`VRF-ANC`) and still wins the alphabetical tiebreak.
  **Root cause of the mis-mandate:** H2's "ancestor right 84%" was measured on rows ADP ALREADY won;
  raising the weight extends the rule into a DIFFERENT population where truth says ducting/AHU/VRF.
  **Correct reading of H2: KEEP the `air distribution` token (H2 wanted it deleted), do not amplify it.**
  OWNER-RULED to keep 0.4. Locked by `test_adp_ancestor_weight_not_amplified` +
  `test_ducting_ancestor_beats_adp_ancestor`.

### Proximity decay -- MEASURED FLAT, wired EXPLICITLY, stamped PROVISIONAL-FIT

The tracked `harness/decay_sweep.py` was run over the 1,366 labelled rows (same exclusions as the
scoring: dummies, illegal-value rows, blanks) across the certified 20-value ladder. **Flat m=1.0 won at
52.86%; no multiplier beat it** -- best non-flat `m=0.90` = 52.27% (-8 rows), `m<=0.75` fell to ~49.4%.
This mirrors the Electrical D2/D2b outcome exactly.

`rules_hvac.json` therefore carries an EXPLICIT top-level `decay` block at `1.0` with
`_fit: "PROVISIONAL-FIT"` -- wired on the record rather than left to the implicit default, with the
measured grid in its own `_note`. PROVISIONAL-FIT = fitted on the team's PROVISIONAL labels (known
vocabulary drift + an unfinished preamble pass); **a re-sweep is OWED at clean labels and the value is
not certified until then.** Electrical is untouched and stays flat-by-default (no block), asserted twice
in `test_decay.py::test_electrical_decay_locked_flat`.

### The v0 -> v1 re-score (rules only)

Full report: `_classification_review/hvac_rules_v1_rescore/RESCORE_V1.md`.

| | v0 | v1 |
|---|---:|---:|
| Overall accuracy | 52.49% | **52.86%** (+5 rows) |
| HIGH band | n=270, 77.4% | n=263, 79.5% |
| LOW band | n=935 | n=949 (LOW did NOT shrink, +14) |
| Bare-dimension-leaf pile (589) | 36.2% | 36.2% (unchanged) |
| Rows improved / regressed | -- | 6 / 1 |

**H-change ledger (by ablation -- rules_hvac.json rewritten with one change removed, re-scored, then
restored byte-identical):** (a) raceway -1, (b) H4 guard 0, (d) BTU rule +6. Net +5.

**Two changes are honestly near-zero on this row set, and the report says why rather than hiding it:**

- **(a) Raceway scores 0 predictions -- UNMEASURABLE here, not broken.** The team labelled 28 tray line
  items with the out-of-legend value `CableTray & Raceway` (Reason: Electrical), so all 28 are among the
  73 illegal-value rows EXCLUDED from scoring. Of 60 Set-1 line items in a tray context, only 2 name a
  tray in their own text; the rest are bare dimension leaves reached via `RCW-ANC` inheritance. The
  carve-out is owed a real measurement once `Raceway` is a legal label.
- **(b) The H4 guard fires on 17 scored rows and changes 0 verdicts.** The guard tests the LINE's own
  text (runner step 4 matches `desc_blob`), which is where "insulated pipe" lives. The 66-row H4 pile is
  mostly bare dimension leaves that INHERIT insulation from an ancestor carrying the word -- the line
  itself says nothing, so no line-level guard can reach them. **That pile needs the STRUCTURAL
  nearest-ancestor inheritance change (runner-level), not another keyword.** The guard is still correct
  and shipped: it encodes the 4A ruling and bites the moment composite lines enter a scored set.

**The standing verdict is unchanged by this slice:** rules are not a viable primary voter on HVAC
(52.9% vs the AI's 84.3%), the bare-dimension-leaf pile is the single largest failure at 36.2%, and
neither more keywords nor a decay curve moves it. The durable lift is the runner-level nearest-parent
inheritance change.

### Tests

`test_runner_hvac.py` 21 -> **38** (+17), all green: 17-category validation + the owner-brief
name/description check; raceway carve-out 4 (tray -> Raceway with Cables zeroed; plain cable -> Cables
with Raceway zeroed; drip-tray false friend; bare-size-leaf inheritance); H4 guard 4 (insulated pipe /
4A composite / insulated valve all NOT insulation, plus a POSITIVE CONTROL that standalone insulation
still wins, so the guard is proven not to over-fire); ADP 3 (token still places ADP, weight locked at
0.4, ducting ancestor still beats it); provisional meter 3 (BTU -> Valve Package and stays LOW, no
BTU->Sensors rule, no H1 duct tokens); decay config 2 (explicit flat + PROVISIONAL-FIT stamp;
near-beats-far proven live on HVAC assets under `decay_override`).

`test_decay.py` 12 -> **12** (owner-ruled scope addition; 2 tests strengthened in place, no count change):
the HVAC assertion changed from "defaults flat (no block)" to "wired explicitly + PROVISIONAL-FIT", and
the electrical one now ALSO asserts `rules_electrical.json` carries no `decay` block at all.

`test_runner_electrical.py` **82 -> 82 unchanged** (A10 backwards-compat: electrical behaviour is
byte-identical). `test_hv2_voter_harness.py` 14 -> 14. Suite 115 -> 132.

**KNOWN pre-existing failure, OUT of scope, unchanged at `a7b8237c`:** `TestMigrateWorkPackageToMulti`
in `api/boq/wizard/test_update_sheet_draft.py` still errors (3 errors of 82) --
`column "work_package" of relation "tabBoQ Sheet Draft" does not exist`. Unrelated to HV-3; reported,
not touched.


