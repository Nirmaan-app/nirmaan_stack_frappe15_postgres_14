## HVAC engine -- Build slice HV-4 (nearest-hit ancestor resolution + mined ruleset v2) COMPLETE

The two structural fixes HV-3 proved necessary: a nearest-firing-ancestor resolution mechanism in
the rules engine (HVAC-gated, electrical untouched), and a label-mined vocabulary expansion of
`rules_hvac.json` (v2) grown iteratively against the Set-1 truth with measurement after every batch.
On `feature/boq-classification-eval` (one feat commit + this docs commit). **RULES ONLY -- no AI
calls; registry stays OFF; Set-2 never opened.** No doctype change, so no migrate. No prompt edits.
No user-visible change.

### THE HEADLINE, UNSPUN

**Set-1 rules accuracy 52.86% -> 66.91% on the same 1,366 rows. The owner's bar is 80%. The gap is
13.09 points and this slice does not close it.** That is the honest landing zone for rules-as-built,
not a way-point: of eight principled ancestor-vocabulary batches measured, the four that would have
pushed further all measured NEGATIVE (the BMS batch alone cost 135 rows). The errors that remain are
not lexical. The residual anatomy + fired-signal traces are at the top of
`_classification_review/hvac_rules_v2_rescore/RESCORE_V2.md`; whether the missing 13 points belong to
clean labels, to round-3 machinery, or to a genuine rules ceiling (meaning routing must carry more
weight for HVAC than it did for electrical, where rules reach 86.9%) is an owner conversation to have
with that report in hand.

### Gate 1 -- the seam (read before any code)

- **Ancestor signals are collected** in `classify_line`'s step 1-2 rule loop. Legacy flattens the
  WHOLE chain into one `anc_blob` and matches against it, so a banner four levels up scores exactly
  as hard as the immediate parent.
- **D1 decay interacts but does not fix it:** decay's "contributes ONCE at the nearest matching
  ancestor" is PER RULE, not per resolution point -- rule A can contribute at d=0 while rule B still
  contributes at d=3 (scaled). At the shipped flat m=1.0 the decay path does not even run.
- **Exclusion guards** zero a category in step 2-4, tested against `desc_blob` (own text + notes);
  the inheritance path applies them against the ancestor blob instead.
- **Ties resolved ALPHABETICALLY by `category_id`** (`_rank_key` returned `(-eff, cat)`), and the
  inheritance path additionally demanded strict dominance or abstained.
- **Where the gate cuts in:** a resolution index computed once per call, consumed by BOTH the main
  ancestor loop and the fragment-inheritance fallback -- the latter matters most, because a bare
  dimension leaf has no own signal and is decided entirely there.
- **Seam is clean:** the mechanism and the tie-break are both behind one opt-in key, so the
  electrical code path is untouched. No stop condition triggered.

### Part 1 -- the mechanism (runner.py, gated)

`ancestor_resolution: "nearest_hit"` in the discipline's rules JSON. ABSENT = legacy blob,
byte-identical. Semantics: walk ancestors nearest-first; the FIRST ancestor at which ANY ancestor
rule fires is the RESOLUTION POINT; only signals firing there contribute; farther ancestors
contribute **nothing** (not a decayed remnant). No ancestor fires anywhere -> behaviour unchanged.
Item-keyword signals on the row's own text are unaffected; exclusion guards still global;
inherited-stays-sub-HIGH cap unchanged. **Composed order of operations** is documented in the code
comment: own-text signals -> resolution point -> ancestor signals at that point scaled by `m**d` ->
agreement/cap -> exclusions -> ranking -> conflict/band/geometry.

**Tie-break chain (same gate):** score -> higher single rule WEIGHT -> more distinct signal types ->
STABLE declaration order. Never alphabetical. Legacy disciplines keep `(-eff, cat)` exactly.

**A10 electrical lock, proven at corpus scale:** the electrical decay sweep was run over its 2,888-row
labelled corpus BEFORE and AFTER the runner change -- `sweep_table.csv` and
`per_category_accuracy_matrix.csv` are byte-identical (86.88%, HIGH n=1247 @ 97.43%), plus
`test_runner_electrical` 82/82 unchanged and a dedicated gating test asserting electrical still SUMS
a far banner with a near header.

**Mechanism measured ALONE** (v1 rules unchanged, flag on): overall 52.86% -> **52.93%** (+1 row), but
the bare-dimension-leaf pile **36.2% -> 43.6%**. The structural fix lands exactly where HV-3 predicted;
it just does not show as headline accuracy until mined vocabulary gives it something to resolve to.

**Performance note:** the nearest-hit scan tests every rule against every ancestor, so the ancestor
feed is normalised ONCE per call (`_norm_ancestors`). Without that the offline scorer took minutes
per run; with it, 1.4s for 1,366 rows. Semantics identical (verified: same 52.93% / same pile 43.6%).

### Part 2 -- mining (floor-gated, batch-measured)

**Floor (declared up front):** a shipped rule needs support >= 8 truth rows, spanning >= 2 distinct
BoQs, precision >= 85% for its category -- recorded in each rule's own `source` string so the asset is
self-auditing.

**Keep-rule (owner-ruled, and now loop policy that round 3 inherits): keep a batch if overall improves
AND gain >= 5x total rows lost.** This replaced a per-category percentage-point guard that was
vetoing a +127-row batch over a 4-row wobble in a 37-row category. The ratio rule is what we actually
care about -- the quality of the trade -- and it earns its keep on the ADP batch, which was NET
POSITIVE (+3) yet lost ~30 rows elsewhere: both flat caps would have waved it through on arithmetic;
the ratio rejected it. Stamped fitted-on-provisional like everything else: the same 5x rule applies
fresh at the clean-label re-mine.

**Shipped (2 rules, both clearing the floor):**

| rule | category | support | boqs | precision | effect |
|---|---|---:|---:|---:|---:|
| `VLV-ANC-TYPE` | Valve Package | 136 | 5 | 86.1% | +127 rows (14.1x) |
| `FAN-ANC-TYPE` | Fans | 76 | 6 | 96.2% | +64 rows (64.0x) |

`VLV-ANC-TYPE` **reopens hypothesis H3**, deferred at HV-3 to clean labels and reopened here on the
owner's ruling: under nearest-hit its pile is genuinely different. The valve size leaves were losing a
three-way **0.40 tie** (insulation / valve / chilled-water) at the SAME ancestor -- a valve spec
paragraph incidentally mentions insulation and chilled water -- broken only by declaration order. It
was never a vocabulary gap: VLV-ANC already fired. KNOWN COST: 9 rows where a valve is itemised INSIDE
an AHU/CHW package, the contested boundary `VLV-KW`'s own plain already flags.

`FAN-ANC-TYPE` **was narrowed by the floor and this is the floor working.** Proposed with nine tokens
it measured 75.0% precision -- below the bar -- so every token was scored individually and only two
survived (`inline fan` 97.2%/5 BoQs, `fresh air fan` 97.3%/5 BoQs). `exhaust air` (53.3%),
`ventilation unit`/`ventilation units` (0%) and `centrifugal fan` (single BoQ) were rejected.

**REJECTED and recorded for retry at clean labels:** a piping ancestor batch (no token could clear
>= 2 BoQs -- `copper pipe` 100% and `refrigerant pipe` 88.9% were both single-BoQ), duct / ADP /
insulation / BMS ancestor vocabulary (all measured NEGATIVE), and the ADP batch (+3 gained, ~30 lost,
0.1x -- rejected by the ratio rule). Grids for all of them are in RESCORE_V2.md.

### The boilerplate queue and the spread test -- a NEGATIVE result worth recording

The n-gram miner surfaced ~1,873 ancestor candidates that clear the numeric floor but are **spec
boilerplate**: `aluminum cladding` (support 146, precision 97%, 4 BoQs), `body` (146, 100%),
`cast iron` (115, 100%), `32mm insulations` (118, 100%), `media temperature` (60, 100%) -- fragments of
one long valve specification paragraph, not category vocabulary.

**The judgment test applied (stated so it is auditable and reusable): would this phrase still predict
this category in a BoQ written by a different consultant who had never seen this template? If the
phrase only identifies the category because a specific document says it that way, it is boilerplate.**

The owner-mandated **per-BoQ spread test** was built and run, and it **FAILED to discriminate**:
1,601 of 1,873 candidates came back "spread-validated" -- including `body` and `32mm` -- with 100%
precision independently in each of 2-4 BoQs and no BoQ holding >60% of support. The reason is that
those BoQs **share a copy-pasted specification template**, so cross-BoQ spread is not evidence of
independence and the test's premise does not hold on this corpus. **Nothing from the queue was
shipped.** All 1,873 candidates are written to `REJECTED_CANDIDATES.csv` with phrase, target
category, support, BoQ count, pooled precision, per-BoQ precision, biggest-BoQ support share, verdict
and reason class -- the promotion queue for the Set-2 out-of-sample pass, which is the only test that
can actually settle them. That deviation from the literal instruction is deliberate and flagged here
rather than buried: shipping 1,601 boilerplate rules would have inflated the Set-1 number and
collapsed on Set-2.

### Results

| stage | accuracy | correct |
|---|---:|---:|
| v0 (HV-2 assets) | 52.49% | 717 |
| v1 (HV-3 shipped) | 52.86% | 722 |
| + nearest-hit mechanism ALONE | 52.93% | 723 |
| + B1 valve-type ancestor (mined) | 62.23% | 850 |
| **+ B2 fan-type ancestor = v2 SHIPPED** | **66.91%** | **914** |

**Band shift -- LOW mass moved for the first time:** LOW 935 -> 747, HIGH 270 -> 463 and HIGH got MORE
accurate (77.4% -> 85.7%). The engine is now confident more often AND right more often when confident,
which is the calibration result that matters for routing.

**The bare-dimension-leaf pile: 36.2% -> 70.5%** (589 rows). HV-3 named this the single largest rules
failure and predicted only a structural fix could move it. It nearly doubled.

**Regressions:** 62 rows v0-right -> v2-wrong, against 259 v0-wrong -> v2-right (net +197). Ten verbatim
examples in RESCORE_V2.md.

**Rules-only-right vs the AI rose from 51 to 122** -- the engine now contributes independent signal the
AI does not have, which is what makes a two-voter routing policy worth anything.

### Tests

`test_runner_hvac.py` 38 -> **52** (+14), all green: nearest-hit resolution 5 (near beats far banner;
farther ancestor contributes NOTHING rather than a decayed remnant; silent immediate parent falls
through to grandparent; no-fire-anywhere = legacy abstain; symmetry -- flip the order and ducting wins);
gating 3 (electrical carries no flag, HVAC does, and **the gating negative**: electrical still SUMS a
far banner with a near header); tie-break 2 (deterministic across repeats; higher weight beats the
alphabetically-earlier category that used to win); mined-rule validation 3 (targets known categories;
every mined rule records support/boqs/prec in `source`; the fan rule's floor-rejected tokens are
absent); decay composition 1.

**One HV-3 assertion was updated, not preserved:** `test_hvac_near_ancestor_beats_far_under_decay`
asserted that a far banner wins at FLAT and only decay flips it. Nearest-hit makes the flat run
resolve at the near ancestor by itself -- that IS the slice's point -- so it became
`test_nearest_hit_subsumes_what_decay_used_to_be_needed_for`. In-scope file; reported, not silently
patched.

`test_decay.py` **12 -> 12, GREEN, untouched** -- the anticipated collision did not materialise, so the
conditional scope expansion was not used. `test_runner_electrical.py` **82 -> 82 unchanged** (A10).
`test_hv2_voter_harness.py` 14 -> 14. Suite 146 -> 160.

**KNOWN pre-existing failure, OUT of scope, unchanged:** `TestMigrateWorkPackageToMulti` in
`api/boq/wizard/test_update_sheet_draft.py` still errors (3 errors of 82) --
`column "work_package" of relation "tabBoQ Sheet Draft" does not exist`. Unrelated to HV-4.


