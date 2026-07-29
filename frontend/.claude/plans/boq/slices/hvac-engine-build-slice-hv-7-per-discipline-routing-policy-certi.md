## HVAC engine -- Build slice HV-7 (per-discipline routing policy + certification mode) COMPLETE

**Commits:** `b02597e0` (feat) + this docs commit. Branch `feature/boq-classification-eval`, base
tip `1103d8ec`. **Backend only; NO AI calls; NO frontend edits.** Registry stays OFF.

### The signed policy, shipped as CONFIG not code

`rules_hvac.json` v**4.2-hv7** carries a top-level `routing_policy` block (same opt-in precedent as
`ancestor_resolution` / `decay` / `matching_surface`; **absent = legacy R3d, byte-identical**):

```json
{"policy_id": "consensus_floor_v1", "min_ai_confidence": 0.80,
 "demoted_categories": ["hvac_ahu", "hvac_cables", "hvac_sensors"],
 "priority_max_ai_confidence": 0.70}
```

`routing.route_policy_v1` implements it; **`route_r3d` is untouched** and remains the Electrical
path. AUTO-ACCEPT iff both voters agree on the same non-blank category AND `ai_conf >= 0.80` AND
the category is not demoted; everything else routes to review with a **BLANK** `final_category_id`.

**THE DEMOTION LIST IS DATA, NEVER CODE.** It is re-derived from the in-segment grid at every eval
cycle and has already moved once (v4.0's {Cables, Ducting, Sensors} -> {AHU, Cables, Sensors} when
the HV-6b surface change fixed Ducting and exposed AHU). A test asserts that **no `hvac_` category
id appears anywhere in `routing.py`**.

### OWNER SCOPE ADDITION (ruled 2026-07-22) -- and the stop that earned it

`runner.py` was OUT of the declared scope, but the slice **STOPPED** at Part 5 on a real defect:
`load_ruleset` returns a **HAND-BUILT dict**, so a gating key not listed in that return is
invisible to every caller. `ruleset.get("routing_policy")` read back **None**, meaning the signed
policy would have been **silently inert** -- and the Electrical identity test would still have
PASSED, for entirely the wrong reason (nothing routing by the new policy at all). That is a
silently-green failure, exactly the class the stopping conditions exist to catch.

The owner ruled **EXACTLY one additive line** in `runner.py` (same precedent as the HV-3
`test_decay` ruling): `"routing_policy": rules_doc.get("routing_policy"),` alongside
`matching_surface`. **A negative test now pins the gap forever** -- Electrical must read
`routing_policy` as PRESENT-and-None, so a future key can never go missing silently again.

### OWNER POLICY AMENDMENT (2026-07-22) -- priority is telemetry, HV-7f CANCELLED

**The priority tier is REMOVED from the product surface.** All review rows are uniform: blank
`final_category_id`, `routing = "Needs review"`, **identical presentation, exactly as Electrical**.
The planned **HV-7f frontend slice is CANCELLED** and no frontend file was touched in this slice.

> **INVARIANT: `review_priority` is telemetry for eval / cockpit use; it must never drive
> reviewer-facing UI.**

`route_policy_v1` still computes it (`conf < 0.70` OR mutual blank), `persist` still writes it, and
`classify.get_sheet_categories` may still carry it in the payload -- but **nothing renders it and
nothing may**. The invariant is stated in three places so it cannot be lost: the doctype field
description, the certification report, and here. On the **AI-off fail-safe** path priority is
explicitly stamped **0** -- the AI never ran, so its absent confidence is not evidence of doubt,
and treating those rows as priority would flood the queue with a whole sheet.

### Migrate -- the sanctioned exception, verified

`review_priority` (Check, default 0) added to `BoQ Row Category`; `bench --site localhost migrate`
run; **`frappe.db.has_column("BoQ Row Category", "review_priority") = True`**, `smallint`, default
`0`, **10,818 existing rows backfilled to 0**. Checked against the LIVE site because passing tests
do not prove the runtime column exists (tests use a separate auto-migrated DB).

### Certification mode -- the new tracked instrument

`BOQ_HARNESS_MODE=certify` on `harness/electrical_classification_harness.py` (default `classify` =
the existing run, byte-identical when the var is absent). Inputs `BOQ_CERT_PREDICTIONS` (folder of
per-sheet prediction CSVs) + `BOQ_CERT_TRUTH` (node_id -> truth JSON); outputs `CERTIFICATION.md` +
`certification_rows.csv`. It applies the discipline's policy IN MEMORY, joins truth, and reports
per-tier population/accuracy/coverage, review + priority share, the in-segment grid, and the
wrong-rows-auto-accepted list verbatim. **NO DB WRITES, EVER.** This promotes the previously
**untracked** `accept41*.py` scoring logic into tracked code -- the exact gap the HV-7 recon found
(every per-tier number in the exam, HV-6 and HV-6b came from scratch scripts).

### Acceptance -- reproduces the HV-6b grid exactly

| measure | HV-6b target | HV-7 certification | |
|---|---:|---:|---|
| auto-accept, combined | 70.4% @ 98.67% | **70.4% @ 98.67%** (1,658 rows) | PASS |
| auto-accept, Set-2 | 67.8% @ 98.53% | **67.8% @ 98.53%** | PASS |
| review share | 29.6% | **29.6%** | PASS |
| wrong rows auto-accepted | 22 | **22** (9 Set-2 / 13 Set-1) | PASS |
| priority share (telemetry) | -- | 3.7% (88 rows) | -- |

**All three invariants PASS:** blank-final on every review row; **auto-accept final == the agreed
category** (the positive twin, added at owner condition 3); priority == (conf < floor OR mutual
blank). The 22 wrong auto-accepts are listed verbatim in
`_classification_review/hv7_acceptance/cert/CERTIFICATION.md` -- they cluster on bare dimension
leaves (`150 mm dia`, `0.63MM`, `40 mm dia`) and the Misc-as-commercial-bucket rows the Set-2 exam
already identified as owner questions, not model defects.

### Tests

**New `tests/test_routing_policy.py` -- 23 tests** (placed beside the runner tests because it
exercises a service module + the loader; the legacy R3d tests stay in
`api/boq/wizard/test_row_category.py`, untouched): auto-accept cell incl. the inclusive floor
boundary; the positive twin (final == agreed category); rule band is irrelevant to this policy;
below-floor, demoted, disagreement-at-0.99 (the exam's law) and one-blank all route to review;
**blank-final swept across every review shape**; priority at 0.69, NOT priority at exactly 0.70,
mutual blank is priority, auto-accept never priority; HVAC exposes the signed values;
**the NEGATIVE that pins the stop -- Electrical reads `routing_policy` present-and-None**;
Electrical falls back to R3d identically; the legacy R3d config is untouched; **no `hvac_` id is
hard-coded in `routing.py`**; thresholds are read from the argument; and a certification-mode
smoke (mode selector, truth-shape parsing, per-file isolation).

`api/boq/wizard/test_row_category.py` **26 -> 29**: priority round-trips through persist; **the
negative -- it defaults to 0 on the legacy path, never None**; the endpoint exposes it.
`test_runner_hvac.py` 101 -> 101, `test_runner_electrical.py` **82 -> 82 lock held**,
`test_decay.py` 12 -> 12, `test_hv2_voter_harness.py` 14 -> 14.
**Services suites 209 -> 232; DB-backed suite 26 -> 29. All green.**

**One assertion collision, SURFACED not silently fixed:** the HV-6b test pinned
`version == "4.1-hv6b"` and failed on the declared bump to `4.2-hv7`. The pin was relaxed to the
`4.x` line; the `matching_surface` flag -- what that test is really about -- stays pinned exactly.
No behaviour was changed to make a test pass.

### A10 Electrical proof (run AFTER the loader fix, per owner condition 1)

`rules_electrical.json` untouched and carries no `routing_policy`; `load_ruleset("Electrical")`
returns it present-and-None -> the `route_r3d` branch. Byte-identity measured by reverting
**`runner.py` itself** to its HEAD bytes and re-classifying: **1,384 line items, 0 differ**,
identical verdict hash `818dd8f1...1a5f` -- the same digest recorded at HV-6 and HV-6b, so
Electrical is now stable across three consecutive slices.

### Carried forward

1. **Set-3 confirmation is OWED** -- Set-1 and Set-2 are both spent; these policy values (floor,
   demotion list, priority floor) are fitted on a closed corpus.
2. **HV-7f is CANCELLED.** No frontend differentiation of review rows, ever.
3. `PNL-ANC-TYPE` distance restriction + the `DX-VRF-EXCL` whole-chain variant remain deferred.
4. The pre-MC append-to-notes sub-hypothesis remains untested (one sheet, 13 rows).
5. HVAC engine registry stays **OFF** (`engines.py` `available=False`).

