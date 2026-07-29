## Build slice G2d (clear the override on re-classify + close three test gaps) COMPLETE -- CATEGORY GATE ARC CLOSED

**What shipped.** The last behavioural gap in the category-gate arc: a successful WHOLE-SHEET re-classify now
CLEARS the admin category-gate override on that sheet's current committed version (flag + actor + timestamp +
reason). Plus three test gaps closed. With this slice the **category gate arc (G2a-G3b + G2d) is functionally
complete.**

**Re-classify entry point (established from code, V1-V4).** ONE production path: `classify.start_classify`
(whitelisted) enqueues `classify._classify_worker` (background `long` queue) -> `orchestrator.classify_sheet_rows`.
A re-classify is ALWAYS single-discipline and can be whole-sheet (`scope.mode=="sheet"`) or a partial row-range.
**Owner correction (mid-slice): a re-classify CAN be multi-engine at the user-facing level** -- `ClassifySheetDialog`
lets the user tick MANY engines and LOOPS `start_classify` once per engine, spawning N independent
`_classify_worker` runs with **NO all-engines completion barrier** (each publishes its own
`boq:classify_sheet_done`); they run in parallel on the queue. Since the only completion signal is PER-ENGINE, the
clear lives in `_classify_worker` (owner decision rule), and a test asserts the per-engine edge (below).

**The clear (owner-locked rules).**
- `classify._clear_override_after_reclassify(boq, sheet_name, scope)` is called in `_classify_worker` AFTER the
  classify `frappe.db.commit()`, inside the `try` (so it only runs on SUCCESS -- never in the `except`).
- **WHOLE-SHEET ONLY:** returns False for `scope.mode != "sheet"` (a partial row-range run leaves the override
  INTACT). **IDEMPOTENT:** a sheet with no override is a clean no-op (returns False, no write). **NEVER fails the
  run:** the whole helper is wrapped in try/except that logs (`frappe.log_error`) + returns False -- a classify
  succeeding matters more than the override state, and the gate fails SAFE (an uncleared override only leaves
  editing unlocked, which the admin already chose).
- RATIONALE (in the code comment): a re-classify changes which rows have categories, so an override granted
  against the OLD picture must not silently carry forward -- the admin re-asserts against the new state.
- The actual write is `pricing.reset_category_gate_override_on_reclassify(boq, sheet, version)` (NOT whitelisted,
  NO admin gate -- a SYSTEM action; the re-classifier need not be admin). It reuses the SHARED
  `pricing._write_category_gate_override_cleared(sheet_row_name)` extracted from `clear_category_override` (the
  admin endpoint now calls it too -- ONE clear write, not a third `set_value`; the endpoint's behaviour is
  byte-preserved). `classify.py` imports `pricing` (api->api, no cycle -- verified).
- **ADDITIVE payload key:** the worker's success terminal payload carries `category_override_cleared` (bool),
  placed AFTER `**summary` so it can't be clobbered. No new response shape, no UI built for it (the banner
  reflects the change on next load).
- Does NOT clear on `set_row_category`, freeze/unfreeze, or any partial run.

**Three test gaps closed.**
- **Gap A (carry atomicity with a PRE-EXISTING rate)** -- both carry refusal messages promise "Your existing
  rates are untouched," but every prior test used an EMPTY destination (proving no rate APPEARED, not that a
  pre-existing one SURVIVED). New `test_j_preexisting_dest_rate_survives_refused_carry` in BOTH `test_pricing`
  (copy-forward) and `test_cross_boq_carry` (cross-BoQ): seed the DEST with a rate on the very carried row, refuse
  the carry (blank categories), assert the rate is byte-identical AND no superseded history row was minted.
- **Gap B (the FAILED-clear revert)** -- G3a's optimistic category-clear makes the live count RISE; the SUCCESS
  path was cert-covered but the FAILURE path was untested. New `describe("failed category clear reverts the
  optimistic count (Gap B)")` in `PricingGrid.test.ts` reproduces the component's `catData + overrides` merge over
  the REAL pure helpers (`buildOptimisticVerdict` + `countMasterSetBlankRows`) and asserts the count round-trip
  the revert guarantees (clear raises the count; dropping the override returns it to pre-clear). The `dropOverride`
  setState wiring itself is not unit-testable in this node-env harness (no jsdom/@testing-library) -- stated
  plainly, and covered live by cert C5-equivalent.
- **Gap C (non-admin control)** -- see cert C7: no non-admin account in the env, so it stays unit-test-only
  (`canAdminOverride`), reported (second slice carrying it).

**Backend re-classify clear tests (`test_classify`, +8 -> 70).** New `TestReclassifyClearsOverride`:
(a) whole-sheet success CLEARS a set override; (b) a FAILED run leaves it INTACT; (b2) a range run does NOT clear;
(c) `set_row_category` does NOT clear; (d) no-override whole-sheet is a clean no-op; (e) the clear is
SHEET-ISOLATED (A cleared, B untouched); (f) a clear FAILURE never fails the classification (status stays
success, `category_override_cleared` False, override untouched); and the PER-ENGINE edge
(`test_multi_engine_each_engine_clears_independently`): engine A clears -> override re-set -> engine B clears it
AGAIN (the reported behaviour with no all-engines barrier).

**Counts.** `test_classify` 62 -> **70**; `test_pricing` 229 -> **230**; `test_cross_boq_carry` 49 -> **50**;
vitest 931 -> **932**. tsc clean; residence holding. No Python signature/gate/message change beyond the additive
clear; the `clear_category_override` endpoint is behaviour-preserved.

**Browser live-cert (`admins@nirmaan.app`; SYNTHETIC `BOQ-26-00143` / `G2D Cert Sheet ` (trailing space),
scalar-rate sheet with 4 blank eligible rows; C8 on the REAL `BOQ-26-00114` / `Electrical `).** Stack fully
restarted (R1-R6) so the workers ran the new code; de-stale ritual run; bundle marker = the `Override the check`
control on screen.
- **C1** override set THROUGH the G3b button -> override banner appears (no reload; sentinel survived).
- **C2** with the override active, a rate SAVE (row 11 = 250) SUCCEEDED -- the join G3b did not exercise:
  button -> stored state -> gate open -> successful write (DB-confirmed).
- **C3** whole-sheet re-classify (Electrical) -> override GONE: on reload the LOCK banner returned ("4 rows still
  need a category. Rate editing is locked until every line item and preamble has one...") + the `Override the
  check` SET button, and ZERO editable rate cells (read-only). (AI was OFF -> the CL-5 fail-safe routes every row
  to Needs-review, so all 4 read as blank -- the documented AI-off shape; the override-clear is the point.)
- **C4** the four override fields are reset in the DB (flag 0, actor/timestamp/reason NULL); the terminal payload
  carried `category_override_cleared: True`, `ai_status: disabled`.
- **C5** a LIVE mid-worker classify failure cannot be induced safely through the UI (would require breaking the
  classifier); per the spec's allowance this relies on the unit test `test_failed_run_leaves_override_intact` --
  reported, not faked.
- **C6** a single-row category pick (`set_row_category`, the picker's exact endpoint) does NOT clear an active
  override (DB: flag still 1, actor still admins@nirmaan.app).
- **C7** NON-ADMIN not exercised on-screen -- no non-admin account, and logging in as one needs credentials that
  must not be obtained/guessed; unit-covered (`canAdminOverride`), reported (second slice carrying it).
- **C8** REAL-sheet regression on `BOQ-26-00114`/`Electrical ` (fully categorised): NO category banner, NO
  override control, rate cells editable; recorded the original (row 16/col K = 1800.0), saved 9999 (SUCCEEDED,
  DB-confirmed), restored 1800.0 (DB-confirmed), lock released. Done via the exact `acquire_pricing_lock` +
  `save_cell_price` endpoints (precision/safety on a real sheet given the renderer flap).
- Synthetic data DELETED, **zero residual verified**.
- **Harness artifact (banked v5.85):** on C3 the live in-editor refresh did NOT auto-flip -- the
  `ClassifyProgressModal` stuck at "Starting..." because a CDP-driven tab is `visibilityState: hidden`, which
  throttles the frontend's `setInterval` poll. The BACKEND `get_classify_status` returned `success` +
  `category_override_cleared: true` on demand, and a manual route reload showed the correct post-clear banner --
  so this is a POSSIBLY-ARTIFACT of the hidden-tab timer throttle, NOT a product defect; no code changed.

**ARC CLOSE (remaining items are process, not behaviour):** push; PK re-upload; the design-doc updates incl. the
Sec.6 priceability correction; the stale `review_screen.py` comment; the Abhishek `patches.txt` migrate heads-up;
the owner's branch-naming decision. The admin override's eventual REMOVAL stays conditioned on classification
engines covering all disciplines.

