## HVAC engine -- Build slice HV-6b (notes-as-fallback matching surface, HVAC-gated) COMPLETE

**Commits:** `c60c6d1a` (feat) + this docs commit. Branch `feature/boq-classification-eval`, base
tip `a58890c6`. **Rules-only measurement; NO AI calls.** Registry stays OFF.

### The owner decision this slice implements

The notes probe (`_classification_review/hvac_notes_probe/NOTES_PROBE.md`) falsified the
notes-blindness hypothesis -- the rules ALREADY match notes everywhere (own notes in the item blob
at `runner.py`, ancestor notes in `anc_texts` at each level), so the proposed change measured as an
**exact no-op, 0 of 2,354 rows**. The informative counterfactual was the inverse, and it was large.

The probe's winning variant cleared three of four pre-fixed gates and failed the fourth by one row
(**ADP -6** against a `<=5` threshold). **The owner WAIVED that gate on 2026-07-21**, accepting the
trade explicitly: ADP gives up 6 correct rows and gains **+14.7 pp precision (67.4 -> 82.1)** on the
corpus's largest category (627 rows), while the corpus gains **+167 net rows** and the review share
falls to the 30% target. This slice ships that decision.

### Semantics shipped

Per-discipline OPT-IN via the rules file's top-level `"matching_surface": "notes_fallback"`:

- **PASS 1 (notes-free):** item/exclusion rules match the row DESCRIPTION only; ancestor rules match
  ancestor DESCRIPTIONS only, each at its own level.
- **PASS 2 (fallback):** ONLY when pass 1 abstains outright, re-run the LEGACY full surface
  (descriptions + all notes, own and ancestor). A pass-1 verdict wins as-is.
- **Flag absent = legacy single pass, byte-identical.** `rules_electrical.json` carries no key.

**Where the gate cuts in:** at the top of `classify_line`, after `load_ruleset` and before any blob
is built -- **outside every existing mechanism, changing none of them**. Each pass runs the complete
unmodified pipeline (nearest-hit, decay, ancestor-scoped guards, exclusion zeroing, agreement
bonus/cap, deterministic tie-break, conflict penalty, band, geometry override). Pass 1 re-enters
with `ancestor_texts := ancestor_headers`, so **no `context_builder` change and no new feed were
needed** -- the notes-free ancestor surface is the header list the builder already assembles.
A private `_notes_fallback_pass` kwarg guards recursion; without `ancestor_headers` the gate cannot
be honoured and legacy runs. Every verdict now carries a `matching_pass` stamp
(**2,310 `notes_free` + 44 `notes_fallback`** across the corpus).

### Acceptance -- reproduces the probe to the decimal

| metric | probe target | shipped v4.1 | delta |
|---|---:|---:|---:|
| combined (n=2,354) | 75.49% | **75.49%** | -0.00 |
| Set-2 | 73.07% | **73.07%** | -0.00 |
| agreement with AI v1.2 | 77.74% | **77.74%** | +0.00 |

From v4.0: **+7.10 pp** combined, **+8.94 pp** Set-2, **+7.94 pp** agreement. **193 gains, 26
regressions, +167 net.** (The probe predicted a ~32-row regression shape for full ablation; the
shipped fallback lands at 26 because the fallback pass rescues the Raceway fragment leaves full
ablation lost -- Raceway +8 here vs +4 under ablation.) Biggest gains: VAV Box +45, VRF +43,
Piping +21, AHU +15, Ducting +14. Full tables + verbatim regressions:
`_classification_review/hvac_v41_acceptance/ACCEPTANCE_V41.md`.

### Routing grid -- INPUT FOR HV-7 (evidence only, no policy code here)

Under **AGREE AND `ai_conf` >= 0.80** with the demotion list re-derived from v4.1's own in-segment
grid: **L3' = {AHU, Cables, Sensors}** -- as predicted. Note the shift from v4.0's
{Cables, Ducting, Sensors}: **Ducting leaves** (the surface change fixed it, 95.8% in-segment) and
**AHU joins** (the change exposed it at 55.6%). Auto-accept **70.4% combined @ 98.67%** (67.8% @
98.53% on Set-2); **review share 29.6%**, down from 37.6% -- landing the owner's 30% target with
auto-accept accuracy holding.

### Backwards compatibility -- Electrical

`rules_electrical.json` untouched and carries NO flag; `load_ruleset("Electrical")["matching_surface"]`
is `None`. **Because this slice edits `runner.py`, the byte-identity check is stronger than HV-6's:
it reverts `runner.py` ITSELF to its HEAD bytes and re-classifies the whole electrical corpus** --
**1,384 line items, 0 differ**, identical verdict hash `818dd8f1...1a5f` (the same digest recorded at
HV-6, so electrical is stable across both slices). 82/82 electrical tests pass. **Electrical adopts
this surface ONLY via its own measured re-run on its 2,888-row labelled corpus, as a rider on the
Set-3 item** -- not here.

### Tests

`test_runner_hvac.py` **92 -> 101 (+9)**: pass-1 resolution from ancestor descriptions; the
**boilerplate-does-not-pollute negative** (the reason this slice exists); fallback engages only on
abstain; both-surfaces-abstain stays blank; the gate cannot engage without `ancestor_headers`;
composition with nearest-hit + decay; flag/version `4.1-hv6b`; **electrical carries no flag and
reports the legacy pass**; the private recursion guard is not a caller knob.
`test_runner_electrical.py` **82 -> 82 lock held**; `test_decay.py` **12 -> 12 UNTOUCHED** (the
conditional scope expansion was not needed -- no assertion collision); `test_hv2_voter_harness.py`
14 -> 14. **Suite 200 -> 209, all green.**

**One assertion collision, SURFACED not silently fixed:** the HV-6 test
`test_rules_version_is_v4_and_new_rules_present` pinned `version == "4.0-hv6"` and failed on the
deliberate bump to `4.1-hv6b`. The four HV-6 rules are all still present; the pin was relaxed to the
`4.x` major line. No behaviour was changed to make a test pass.

**KNOWN pre-existing failure, OUT of scope, unchanged:** `TestMigrateWorkPackageToMulti` in
`api/boq/wizard/test_update_sheet_draft.py` (3 errors of 82).

### Caveats carried to HV-7

1. **Set-1 and Set-2 are both SPENT** -- confirm on **production Set-3** before re-cutting the
   routing policy. Mitigation: this change fits **zero parameters** (a binary surface flip), and
   Set-2 moved MORE than combined (+8.94 vs +7.10) -- the opposite of an overfitting signature.
2. **The AI feed is UNTOUCHED** -- `ai_voter.py` and the prompts are not in this slice. The voter
   still reads notes in full because it reads them semantically. **The divergence between the two
   voters' matching surfaces is now deliberate and load-bearing**, and must not be "tidied up".
3. **The pre-MC append-to-notes sub-hypothesis remains untested** -- exactly one committed sheet
   (`BOQ-26-00017 / AHU`, 13 scored rows) uses the workaround.
4. Routing policy code is still unwritten; the §3 grid is its input. Registry stays OFF.

