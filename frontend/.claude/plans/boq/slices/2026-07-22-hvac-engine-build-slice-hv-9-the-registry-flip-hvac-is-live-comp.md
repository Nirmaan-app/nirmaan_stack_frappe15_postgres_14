## HVAC engine -- Build slice HV-9 (THE REGISTRY FLIP -- HVAC IS LIVE) COMPLETE

**Commits:** `16d3fb47` (feat) + this docs commit. Branch `feature/boq-classification-eval`, base
tip `eed13469`. **Owner GO 2026-07-22. This slice closes the HVAC build arc.**

### The flip

`engines.py`: the HVAC entry's `available` flag **False -> True**. One line; nothing else in the
file. `is_discipline_available("HVAC")` now returns True, so `start_classify`,
`set_row_category` and `get_category_catalog` all admit HVAC. The certified stack behind the
switch: **rules `4.2-hv7`** + the **notes-fallback matching surface** + **prompt `hvac-v1.3`** +
the **`consensus_floor_v1` routing policy** + the **blank-review invariant**.

### Tests

`test_classify.py` **38 -> 40**. The HVAC-disabled assertions flip to enabled; **ELV takes over as
the unavailable exemplar** for the two gate negatives (catalog throws, `start_classify` throws),
since HVAC can no longer play that role. Two NEW guards: **exactly two engines available**
(Electrical + HVAC; ELV still LISTED but disabled) and **ELV remains present-but-unavailable**.
The HVAC catalog assertion checks all **17** categories incl. `hvac_raceway`.
`test_runner_electrical` **82 -> 82 lock held**; services suite **232**; DB-backed
`test_row_category` **29**. All green.

### The live smoke -- the first production HVAC classify

`BOQ-26-00017 | Piping ` (verbatim trailing space, #152), via the **real `start_classify`
endpoint** after a worker restart (the flip is server-side config; workers do not hot-reload).

| measure | result |
|---|---|
| eligible classified | 23 (18 line items + 5 preambles); 1 subtotal skipped |
| `ai_status` | **ran** |
| routing split | **14 auto-accepted / 9 needs review** |
| INVARIANT blank-final on every review row | **PASS** |
| INVARIANT auto-accept final == the agreed category | **PASS** |
| `review_priority` | all 0, stored; **nothing renders it** |
| provenance | `prompt_version` = `hvac-v1.3` on all 23; model `claude-opus-4-8` |
| catalog | 17 HVAC categories returned (the picker's source) |

**Certification-shape comparison (HV-8 `certification_rows.csv`, same sheet): 18/18 comparable
rows land in the SAME tier, 61% auto-accept in both.** The live AI ran independently and still
reproduced the certified shape exactly -- the strongest available evidence that production
behaviour matches what was certified.

The 9 review rows are the **piping-vs-insulation boundary** (rule `hvac_piping` vs AI
`hvac_insulation` at 0.94-0.95), plus one row where the AI abstained. That is the known corpus
boundary, arriving in production exactly as the certification predicted.

**Electrical untouched:** `BOQ-26-00009 | ELECTRICAL WORKS` 939 -> 939 rows, total Electrical
10,818 -> 10,818, 3/3 spot-checked rows byte-identical.

### The AI-toggle incident (recorded, because it shaped the slice)

The first smoke attempt returned **`ai_status: "disabled"`** and persisted 23 rule-only rows. The
`BOQ Upload Review AI Settings.enabled` flag read **True at pre-flight** and **False** minutes
later (`tabSingles.modified 2026-07-22 02:04:03`, `modified_by Administrator`); **change tracking
is not enabled on that doctype, so the flip is unattributable**. The slice **STOPPED** rather than
report a pass: with the AI off, the owner-locked **CL-5 fail-safe** adopts the RULE category as
`final_category_id` and flags every row for review -- correct behaviour, but it trips the stated
stopping condition *"any review row with a non-blank final"*.

The owner re-enabled the toggle and the smoke was re-run. **Freeze-and-supersede did its job**:
the AI-off rows are now `category_version 1, is_current 0` (superseded history) and the certified
run is `category_version 2, is_current 1`. No dirty data survived into the current tier.
**Lesson for production: `ai_status` must be checked on every run, because an AI-off run looks
successful and silently produces rule-only verdicts.**

### KNOWN DEFECT found by the smoke (reported, NOT fixed -- out of scope)

**`rules_version` is stored EMPTY on every persisted row.** `orchestrator` sets it from
`ruleset.get("version", "")`, but `load_ruleset` returns a **hand-built dict that does not surface
`version`** -- the SAME class of gap that stopped HV-7 over `routing_policy`. `prompt_version` and
`model` are stamped correctly; only the ruleset provenance is blank. Harmless to routing, but it
means **persisted rows cannot be attributed to a ruleset version** -- which matters the moment two
ruleset versions coexist in production. Fix is one additive loader line
(`"version": rules_doc.get("version")`), same precedent as HV-7's. **Deferred to its own slice.**

### The production era opens

1. **Set-3 accrual is LIVE.** Every production HVAC classify from here is unseen out-of-sample
   evidence. The first 23 rows are banked.
2. **The Ducting demotion call is HELD** for gate review (HV-8 re-derived
   {AHU, Cables, Ducting, Sensors} vs the shipped three; Ducting at 94.5%, half a point under the
   rule). It should now ride **production** evidence rather than the spent corpus.
3. **The demotion list must be re-derived from production data**, not re-fitted on Set-1/Set-2.
4. **The electrical debt register** (`PNL-ANC-TYPE` distance restriction, the `DX-VRF-EXCL`
   whole-chain variant, the electrical notes-fallback adoption) rides production evidence too.
5. **`review_priority` stays telemetry-only** -- never reviewer-facing (owner amendment
   2026-07-22); HV-7f remains cancelled.
6. Stale comment to tidy in a later slice: `engines.py`'s docstring still says *"Today only
   Electrical is available"*. Left untouched because this slice's scope was "NOTHING else in the
   file".

