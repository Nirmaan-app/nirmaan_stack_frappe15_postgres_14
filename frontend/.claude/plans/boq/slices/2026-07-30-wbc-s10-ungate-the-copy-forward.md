# WBC-S10 — ungate the within-BoQ copy-forward

**Branch** `feature/boq-within-boq-carry` · **Base** `cb1241ba` · **Tier** FULL · **Date** 2026-07-30

The within-BoQ "copy rates forward" action (`apply_copy_forward`) refused when the destination sheet
had rows without a category. That gate is removed. Nothing else about the action changed.

---

## The owner's reasoning — the part that must survive

The gate exists to stop a **HAND-TYPED** rate landing on an uncategorised row. A **copy** moves known
values from a known-good source, which is a **different risk**.

Rates still cannot be **EDITED** until categories are complete. That protection lives in
`_guard_categories_complete` on the SAVE path and is **untouched** — byte-identical, verified.

This is the **identical reasoning already recorded in `cross_boq_carry.py`** for the cross-BoQ carry
(the Amendment E comment block). **This slice is NOT a reversal of Amendment E; it is an extension of
its logic to the same-sheet copy.** Do not "restore consistency" by re-adding the gate.

The resulting state is one the owner explicitly accepts: a copy into an uncategorised destination
arrives with **rates visible but rate editing locked**, the amber banner naming the rows still
missing a category — exactly the shape the revision carry already produces.

### Gate sequence

```
was (G2c):        lock -> formulas -> CATEGORY GATE -> acquire -> rates -> commit
was (Amend F R2): lock -> formulas -> acquire -> CARRY LAYERS -> CATEGORY GATE -> rates -> commit
now (S10):        lock -> formulas -> acquire -> CARRY LAYERS -> rates -> commit
```

The mandatory amount-formula gate is **unaffected and keeps precedence** — still first, before the
lock and the layers.

---

## Seam

`apply_copy_forward`'s **interface** — specifically its documented refusal set. The change removes one
condition from that set. It is the right seam because the refusal set is what both callers cross:
`CopyForwardDialog` (which mirrors gates into `disabled`) and the tests. The gate was never a
property of the write loop or of `_write_cell_price_record`; it was a sheet-level precondition
evaluated once at the endpoint, which is precisely where an endpoint-level policy belongs.

`_categories_gate_ok` itself was NOT removed — it survives as `rate_master._guard_suggest_gate`'s
condition. After this slice it has **exactly one caller**, `api/boq/rate_master.py:203`.

---

## What changed

| File | Change |
|---|---|
| `nirmaan_stack/api/boq/wizard/pricing.py` | Gate block + its 12-line justification comment deleted from `apply_copy_forward`. Docstring gate diagram rewritten. `_categories_gate_ok` docstring caller list corrected. `_resolve_and_guard_cell` docstring corrected. Formula-gate comment re-voiced. |
| `nirmaan_stack/api/boq/wizard/test_pricing.py` | 8 refusal tests disposed (see table). 1 new test. 2 class docstrings + 6 stale comments corrected. |
| `frontend/src/pages/boq-wizard/CopyForwardDialog.tsx` | **Comment-only.** Docblock note corrected. |

### Documentation corrected because this change made it false

- `_categories_gate_ok`'s docstring named `apply_copy_forward` as a caller (about to be untrue) **and**
  claimed `cross_boq_carry` maps `False` to a `'categories_incomplete'` reason tuple — **that half was
  already untrue at HEAD**; Amendment E removed the gate from that path and no such reason code
  exists. Both corrected.
- The "AMENDMENT F R2 REORDERS THE GATES" diagram in `apply_copy_forward`'s docstring.
- `_resolve_and_guard_cell`'s docstring claimed **both** carry paths run "the deliberate-lock +
  formula + category gates" — false for `cross_boq_carry` since Amendment E, and now false here too.

---

## Test dispositions

Eight tests asserted this copy REFUSES. None were bulk-deleted and none were merely made to pass.

| # | Test | Disposition | Why |
|---|---|---|---|
| a | `test_a_refused_when_destination_blank` | **INVERTED** → `test_a_copies_into_a_blank_destination` | Asserted the G3a refusal text. Now asserts the opposite over the same fixture, plus the stronger fact: the destination has zero categories **before and after**, so the rate demonstrably landed on an uncategorised row. |
| b | `test_b_refusal_writes_nothing` | **DELETED** | Protected "a category refusal writes nothing". Void — no category refusal exists. Refusal-writes-nothing on the surviving axes is pinned by the lock test, the formula-precedence test, and `test_apply_rolls_back_on_mid_batch_failure`. |
| d | `test_d_admin_override_unlocks` | **DELETED** | Protected "the admin override is the escape from the copy-path gate". Void — there is no gate to escape. The override's surviving job (the SAVE path) is covered by `TestCategoryGate` `test_d`/`test_e`. *(This test still PASSED after the change — deleted anyway, because a passing test whose subject no longer exists is worse than none.)* |
| f | `test_f_replay_and_no_double_apply` | **MODIFIED** | Kept; only its opening "refused while blank" step removed. Its real subject — replay without double-apply — is untouched and still asserted. |
| h | `test_h_qtyless_preamble_gates_carry` | **DELETED** | Protected the G2e "empty is empty" widening **as a carry refusal**. Void. The widening still governs the SAVE path and is covered by `TestCategoryGate` `test_g` and the whole of `TestEligibleGateWidened`. |
| j | `test_j_preexisting_dest_rate_survives_refused_carry` | **INVERTED** → `test_j_preexisting_dest_rate_is_kept_as_a_conflict_not_overwritten` | Same fixture now proves the thing worth protecting: ungating did **not** turn a conflict into an overwrite. Row 30 holds 777.0, so the copy runs, classifies it outcome 3, and KEEPS it — byte-identical, no superseded history row. |
| r2-1 | `test_r2_without_the_category_layer_the_gate_still_refuses` | **INVERTED** → `test_without_the_category_layer_the_rates_still_land` | Rates land; destination legitimately left priced-but-uncategorised; the ticked layer still carries. |
| r2-2 | `test_r2_incomplete_source_categories_refuse_and_roll_back_every_layer` | **INVERTED** → `test_incomplete_source_categories_carry_what_exists_and_still_price_both_rows` | The most valuable inversion. Source row 51 has no category, so destination row 51 ends up **priced but uncategorised** — exactly the state the removed gate existed to prevent and exactly the state the owner ruled is fine. Asserts both rates land, only the one existing category carries, and the other three layers carry normally. |
| r2-3 | `test_r2_a_refused_carry_leaves_a_preexisting_destination_rate_byte_identical` | **DELETED** | Protected "a CATEGORY-refused carry leaves a pre-existing rate byte-identical under R2's post-carry ordering". Void. Refusal-on-a-surviving-axis is pinned by the lock + formula tests; non-refused conflict-keep is now pinned by the inverted `j`. |

### `test_k` — kept, deliberately

`test_k_gate_sees_uncommitted_category_writes_in_the_same_transaction` calls `_categories_gate_ok`
**directly**, never through `apply_copy_forward`, so S10 does not touch what it exercises. It was
written to prove the Amendment F R2 precondition, which is void — **but it is the only direct test of
a helper that survives** and still gates Rate Master. Kept and re-voiced: what it now pins is that
`_categories_gate_ok` is a **live** read, not a committed-only one.

*(Checked: `rate_master._guard_suggest_gate` is a pre-flight endpoint check, so transaction
visibility is not load-bearing for it. The test is kept for coverage of the helper, not for R2.)*

### New test

`TestCopyForwardLayers.test_rates_only_carry_lands_on_a_destination_with_no_categories` — the
headline. Layers **omitted** entirely (so nothing in the call could populate categories) into a
destination with **no categories at all**. Asserts `copied == 1`, `layers == {}`, the rate lands, and
— the assertion no other test makes — **the destination still has zero category rows afterwards**.

**Red run shown before green:** the test failed with
`ValidationError: Nothing was copied. The destination sheet 'CFL Fix ' still has rows without a
category…` (`Ran 1 test … FAILED (errors=1)`), then passed after the gate removal (`Ran 1 test … OK`).

### Verified unchanged

`_guard_categories_complete` and `_get_category_gate_override` confirmed **byte-identical** by
extraction-and-compare against HEAD (1566 B and 468 B, unchanged). `_categories_gate_ok`'s **body**
byte-identical (docstring only was corrected). `save_cell_price`'s call site untouched. Formula-gate
precedence, lock-held refusal, duplicate-source-position drop, replay/no-double-apply, per-layer tick
behaviour, and both save-path gate classes (`TestCategoryGate`, `TestEligibleGateWidened`) all pass
unchanged.

### Fixture setup removed as newly-pointless

Three `_categorise_fixture_eligible_rows` calls existed **only** to stop the removed gate refusing:
`TestCopyForward.setUpClass`, `test_apply_re_resolves_drifted_column`, `test_omitted_layers_is_rates_only`,
and `test_a_classification_frozen_destination_takes_no_category_write`. Removed with their comments —
keeping the call would have required keeping a comment that is now false. Those tests now run against
uncategorised destinations, which is the more honest fixture. The bare call in
`TestCopyForwardN2Matching.setUpClass` was **left alone** (no false comment attached to it).

---

## Frontend finding (item 5)

**`CopyForwardDialog.tsx` contains no user-visible category messaging at all — there was nothing to
remove.** Stated explicitly rather than silently changing nothing:

- No banner, warning, label, or helper text mentions categories or the category gate.
- The only user-facing gate banner is the **amount-formula** one ("The current version still has
  amount columns without a formula. Declare them before copying.") — **unchanged**.
- `disabled={!formulasComplete}` on both the layer block and the apply button — **unchanged**, as
  required.
- The word "categories" appears only as the label of the opt-in **layer** checkbox, supplied by the
  shared `CarryLayersBlock` (out of scope, and not gate messaging).
- `grep` for `Categories incomplete` / `Categorise the destination` across `frontend/src/` — **no
  matches**. The frontend never special-cased the removed server message.
- One coincidence worth not misreading: the post-apply summary string `"Nothing was copied into the
  current version."` (line ~200) is `summarizeCopyForward`'s zero-write branch. It shares wording
  with the deleted server refusal but is unrelated. **Left alone.**

The only category-gate content in the file was the **docblock**, which promised "the server still
refuses and rolls the whole transaction back" and "R8 keeps that gate UNCONDITIONAL". That is now
false, so it was corrected. **The frontend diff is comment-only** — verified by reading the diff.

---

## Verification — observed output

| Suite | Baseline | Final |
|---|---|---|
| `test_pricing` | **Ran 255 — OK** | **Ran 252 — OK** |
| `test_committed_carry` | **Ran 49 — OK** | **Ran 49 — OK** |
| `test_cross_boq_carry` | **Ran 60 — OK** | **Ran 60 — OK** |
| vitest (in-container) | **1222 passed, 53 files** | **1222 passed, 53 files** |

`test_pricing` 255 → 252 reconciles exactly: **−4 deleted** (b, d, h, r2-3) **+1 new** = 252.

Intermediate red state after the gate removal and before the dispositions: **8 failures**, exactly
the 8 refusal tests listed above and nothing else — which is itself the evidence that the removal's
blast radius was confined to the category axis.

Run in-container via `docker exec … bench --site localhost run-tests --module …`. `test_pricing`
prints a SQL traceback from the deliberate lock-race test (`duplicate key … tabBoQ Sheet Pricing
Lock_pkey`) — expected noise; the suite still reports OK. No browser session ran against localhost
during the bench runs (`tabSeries` naming-lock collision).

**`tsc --noEmit`: 3236 errors repo-wide, ALL pre-existing — `CopyForwardDialog.tsx` contributes
NONE.** Recorded because the number is alarming out of context; the frontend diff here is a comment.

---

## Findings

1. **A pre-existing false claim was found while correcting a true one.** `_categories_gate_ok`'s
   docstring said `cross_boq_carry` maps `False` to a `'categories_incomplete'` reason tuple. That
   was **already wrong at HEAD** — Amendment E removed the gate from that path and no such reason
   code exists anywhere. Corrected as part of item 3.

2. **⚠️ OWNER RULING NEEDED — a stale clause survives inside a byte-identical function.**
   `_guard_categories_complete`'s docstring (`pricing.py:360`) still reads *"(the carry paths keep
   delegating to `_categories_gate_ok`, whose bool needs no count)"*. **No carry path delegates to it
   any more** — Amendment E removed one, S10 the other. This is now false.
   **It was NOT corrected**, because the build prompt required that function to survive
   **byte-identical**, and that instruction carried an explicit failure test ("if editing stops being
   gated, the change is wrong"). Obeying the stricter constraint and reporting the residue is the
   safe order of operations; silently editing a function declared byte-identical is not.
   **Owed: a one-line docstring fix, in a slice that puts `_guard_categories_complete` in scope.**

3. No hook denied any write. No guard fired. No scope violation attempted.

---

## Deliberately NOT done

- **`cross_boq_carry.py` not touched** — out of scope, already ungated. Read once for voice only.
- **`rate_master.py` not touched** — out of scope. Confirmed it is now `_categories_gate_ok`'s sole
  caller; its behaviour is unchanged.
- **`_categories_gate_ok` not deleted** — it still has a live caller.
- **Save path not touched** — the whole point of the slice is that editing stays gated.
- **No browser E2E.** The frontend change is a comment, so there is nothing to see. The behaviour
  change is server-side and fully covered by bench tests. A live check would be worth it only as part
  of the arc's certification pass, against the pricing grid's amber-banner behaviour on a
  freshly-copied uncategorised sheet.
- **Finding 2 not fixed** — see above; needs the guarded function in scope.
