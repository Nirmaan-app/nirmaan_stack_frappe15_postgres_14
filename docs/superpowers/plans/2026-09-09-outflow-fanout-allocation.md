# Fan-out Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one imported bank transfer settle several `Approved` `Project Payments`, allocated incrementally over several sittings, until nothing is left to allocate.

**Architecture:** An `Outflow Import Row` stops being a switch flipped once and becomes a wallet drawn down over time. Each leg writes one `Outflow Row Match` (a table whose unique key was already on the *(transfer, TARGET)* pair, so fan-out was always representable). `allocated`, `remaining` and `row_status` are **recomputed from source** on every write — there is no leg counter, no group id and no completion flag, because a balance answers "is it finished?" and a count cannot.

**Tech Stack:** Frappe v15 / Python 3.10+ / PostgreSQL 14 backend; React 18 + TypeScript 5 + Vite frontend. Tests: `unittest` (pure services, no bench), `unittest` + bench runner (api), `vitest` (frontend, node env, no DOM).

**Spec:**
- `frontend/.claude/plans/outflow-fanout-allocation-plan.md` (the design)
- `docs/adr/0020-one-transfer-many-payments.md` (the decision, reverses owner ruling Q4)
- `.claude/context/domain/outflow-import.md` (the feature's own reference — read the sections *Status vocabulary*, *Doctypes*, *Partial settlement*, *The invariants that break silently*)

## Global Constraints

- **No new amount constant.** `AMOUNT_TOLERANCE = Decimal("5")` lives only in `services/outflow_import/amounts.py`, and a test refuses any `Decimal` constant declared outside that file. Import it; never re-declare it.
- **Derived means recomputed from source.** Root `CLAUDE.md`: *"a derived field must be RECOMPUTED FROM SOURCE, never incremented by a delta."* `allocated` is always a fresh `SUM`, never `+= leg`.
- **Raw SQL and `frappe.db.set_value` bypass the document lifecycle.** Say so at the call site and either invoke the affected recompute or state why skipping it is correct.
- **`sheet_name`-style verbatim matching does not apply here, but `transfer_id` does:** never `.strip()` a `transfer_id` for comparison; the codebase compares stored values as-is on this path by owner ruling.
- **Money writes go through `doc.save()`, not `db.set_value`** (slice X1) — the audit `Version` row and the `doc_events` are the point.
- **`services/` may never import from `api/`.** api -> service is the one legal direction.
- **Explicit index names always.** PostgreSQL index names are unique per SCHEMA and `CREATE INDEX IF NOT EXISTS` matches by NAME ONLY, so a generic name colliding with another table's index is a SILENT no-op.
- **Pins are in scope.** Root `CLAUDE.md`: *"WHEN A SLICE CHANGES BEHAVIOUR, EVERY TEST THAT PINS THAT BEHAVIOUR IS IN ITS BLAST RADIUS AND BELONGS IN ITS SCOPE."* Retire a pin by **INVERTING** it (assert the new truth, keep it failing for anything else), never by deleting it.

### Test commands (verified 2026-09-09)

```bash
# Pure service tests -- no bench needed. Run from the app root INSIDE the container.
docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack \
  frappe_docker_devcontainer-frappe-1 ../../env/bin/python \
  -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py"

# One pure module
docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack \
  frappe_docker_devcontainer-frappe-1 ../../env/bin/python \
  -m unittest nirmaan_stack.services.outflow_import.test_status -v

# API tests -- need bench (they import frappe and hit the LIVE localhost site)
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
  bench --site localhost run-tests --app nirmaan_stack \
  --module nirmaan_stack.api.outflow_import.test_expenses

# Frontend
cd frontend && yarn test
```

Baselines to beat: `test_status` **172** pure tests today; `test_expenses` 34, `test_review` 148, `test_settle_payment` 54.

⚠️ **Windows only:** prefix every `docker exec` / `docker cp` with `MSYS_NO_PATHCONV=1`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `nirmaan_stack/services/outflow_import/status.py` | **MODIFY** — the single status deriver. Gains `ROW_PARTIALLY_ALLOCATED` + `ACTIVE_ROW_STATUSES`; `derive_batch_status` and the summary's open figures switch to the ACTIVE set | 1 |
| `nirmaan_stack/services/outflow_import/test_status.py` | **MODIFY** — invert the partition pin, add the batch-status regression pins | 1 |
| `nirmaan_stack/api/outflow_import/review.py` | **MODIFY** — `_FROZEN_ROW_STATUSES`, `_SCOPE_STATUSES`, `skip_row`'s guard | 1, 6 |
| `.../doctype/outflow_import_row/outflow_import_row.json` | **MODIFY** — `row_status` Select option + field description | 1 |
| `frontend/src/pages/outflow-import/outflowImportStatus.ts` | **MODIFY** — the parity mirror: constant, sets, tone | 1 |
| `frontend/src/pages/outflow-import/outflowImportStatus.test.ts` | **MODIFY** — the TS half of the parity pin | 1 |
| `frontend/src/pages/outflow-import/outflowTableModel.ts` | **MODIFY** — the 4th tab + its scope | 1, 7 |
| `frontend/src/pages/outflow-import/components/OutflowRowsTable.tsx` | **MODIFY** — de-hardcode the terminal set (line 701) | 1 |
| `.../doctype/outflow_row_match/outflow_row_match.json` | **MODIFY** — 6 new fields, widened `match_kind` | 2 |
| `.../doctype/outflow_row_match/outflow_row_match.py` | **MODIFY** — the narrowed immutability `validate()`, the partial unique index, the new target index | 2 |
| `nirmaan_stack/patches/v3_0/outflow_match_partial_unique.py` | **CREATE** — heal, then swap the plain unique for the partial one | 2 |
| `nirmaan_stack/patches.txt` | **MODIFY** — wire this patch AND the four unwired outflow index patches | 2 |
| `nirmaan_stack/services/outflow_import/allocation.py` | **CREATE** — the PURE deriver: `allocated_of`, `remaining_of`, `status_for_allocation`, `allocation_fits` | 3 |
| `nirmaan_stack/services/outflow_import/test_allocation.py` | **CREATE** — its unit tests | 3 |
| `nirmaan_stack/services/outflow_import/settle.py` | **MODIFY** — `settle_payment(..., rewrite_amount_to_bank=True)`; the shared UTR sibling helper | 4 |
| `nirmaan_stack/api/outflow_import/expenses.py` | **MODIFY** — `allocate_row`, `reverse_allocation`, `_refresh_row_allocation`, `_record_settlement` loses its row-flip | 3, 4, 5 |
| `nirmaan_stack/api/payments/project_payments.py` | **MODIFY** — the manual fulfil's UTR guard calls the same shared helper | 4 |
| `frontend/src/pages/outflow-import/components/SettleableRecordTable.tsx` | **MODIFY** — radio -> checkbox | 7 |
| `frontend/src/pages/outflow-import/components/DecisionDialog.tsx` | **MODIFY** — allocated list, balance bar, endpoint routing | 7 |

---

### Task 1: The status vocabulary — `Partially Allocated`

**Inert by construction.** Nothing writes the new status yet. This task exists so the vocabulary,
the sets, the badge and both parity pins are correct *before* anything can produce one.

**Files:**
- Modify: `nirmaan_stack/services/outflow_import/status.py:116-231, 709-729, 1013-1014`
- Modify: `nirmaan_stack/services/outflow_import/test_status.py:134-194` (class `TestVocabulary`)
- Modify: `nirmaan_stack/api/outflow_import/review.py:119` (`_FROZEN_ROW_STATUSES`), `:1709-1727` (`_SCOPE_STATUSES`), `:1029` (`skip_row`'s guard)
- Modify: `nirmaan_stack/nirmaan_stack/doctype/outflow_import_row/outflow_import_row.json:228-237`
- Modify: `frontend/src/pages/outflow-import/outflowImportStatus.ts:25-95, 127-134`
- Modify: `frontend/src/pages/outflow-import/outflowImportStatus.test.ts:38-119`
- Modify: `frontend/src/pages/outflow-import/outflowTableModel.ts:472-504`
- Modify: `frontend/src/pages/outflow-import/components/OutflowRowsTable.tsx:701`

**Interfaces:**
- Produces: `status.ROW_PARTIALLY_ALLOCATED: str` (= `"Partially Allocated"`), `status.ACTIVE_ROW_STATUSES: frozenset[str]`; TS `ROW_PARTIALLY_ALLOCATED`, `ACTIVE_ROW_STATUSES: ReadonlySet<string>`, `isActive(status: string): boolean`. Every later task imports these rather than spelling the literal.

⚠️ **The design spec says "amber" for the badge. Amber is already `Mismatched`'s tone**
(`ROW_STATUS_TONE[ROW_MISMATCHED] = "bg-amber-50 text-amber-700"`), and two statuses sharing a tone
is exactly the "renders as accidental grey" defect that map exists to prevent. **Use sky**
(`bg-sky-50 text-sky-700`) — distinct from Mismatched's amber, Settled's indigo, Matched's emerald
and Error's red, which `test("reserves red for Error alone")` protects.

- [ ] **Step 1: Write the failing Python tests**

Append to `class TestVocabulary` in `nirmaan_stack/services/outflow_import/test_status.py`, and
**replace** the two tests named below (they assert the old six-status world; invert them rather
than delete them):

```python
    # REPLACES test_exactly_six_row_statuses_in_reviewer_order
    def test_exactly_seven_row_statuses_in_reviewer_order(self):
        """`Partially Allocated` sits between Mismatched and Settled -- the order a reviewer meets
        it: nothing lined up, then part of it did, then all of it did."""
        self.assertEqual(
            ROW_STATUSES,
            (
                "Pending match run",
                "Matched",
                "Mismatched",
                "Partially Allocated",
                "Settled",
                "Skipped",
                "Error",
            ),
        )

    # REPLACES test_open_and_terminal_partition_the_vocabulary -- INVERTED, not deleted.
    def test_open_and_terminal_no_longer_partition_the_vocabulary(self):
        """⚠️ THE PARTITION IS DELIBERATELY BROKEN (ADR-0020 D5). `Partially Allocated` is the first
        status where MONEY IS ALREADY WRITTEN BUT WORK REMAINS, so it is in neither set. Kept as an
        inverted pin rather than deleted: a future reader restoring the partition would put the
        status into one of the two sets, and either choice is a silent defect -- OPEN enrols it in
        cross-batch claim contention, TERMINAL tells the screen it is finished.
        """
        self.assertNotIn(ROW_PARTIALLY_ALLOCATED, OPEN_ROW_STATUSES)
        self.assertNotIn(ROW_PARTIALLY_ALLOCATED, TERMINAL_ROW_STATUSES)
        self.assertNotEqual(set(ROW_STATUSES), OPEN_ROW_STATUSES | TERMINAL_ROW_STATUSES)
        self.assertFalse(OPEN_ROW_STATUSES & TERMINAL_ROW_STATUSES)

    def test_active_and_terminal_partition_the_vocabulary(self):
        """The partition that replaced it. ACTIVE means 'still needs a human'."""
        self.assertEqual(set(ROW_STATUSES), ACTIVE_ROW_STATUSES | TERMINAL_ROW_STATUSES)
        self.assertFalse(ACTIVE_ROW_STATUSES & TERMINAL_ROW_STATUSES)

    def test_active_is_exactly_open_plus_partially_allocated(self):
        self.assertEqual(
            ACTIVE_ROW_STATUSES, OPEN_ROW_STATUSES | {ROW_PARTIALLY_ALLOCATED}
        )

    def test_a_batch_of_only_partially_allocated_rows_is_not_completed(self):
        """⚠️ THE BUG THIS TASK EXISTS TO PREVENT. `derive_batch_status`'s first branch is
        `if not open_rows: return BATCH_COMPLETED`. A status in NEITHER set makes that branch fire
        on a batch full of unfinished work -- and `batch_is_open` then drops the statement out of
        `match_period` forever, the invisible-exclusion class its own docstring warns about.
        """
        self.assertEqual(
            derive_batch_status([ROW_PARTIALLY_ALLOCATED] * 3), BATCH_PARTIALLY_SETTLED
        )
        self.assertEqual(
            derive_batch_status([ROW_PARTIALLY_ALLOCATED, ROW_MATCHED]),
            BATCH_PARTIALLY_SETTLED,
        )

    def test_batch_status_is_byte_identical_for_every_pre_existing_shape(self):
        """ACTIVE == OPEN until a partial allocation exists, so nothing already in the database
        moves. Pinned so the substitution can never be a silent behaviour change."""
        self.assertEqual(derive_batch_status([]), BATCH_DRAFT)
        self.assertEqual(derive_batch_status([ROW_SETTLED, ROW_SKIPPED]), BATCH_COMPLETED)
        self.assertEqual(derive_batch_status([ROW_MATCHED, ROW_MISMATCHED]), BATCH_IN_REVIEW)
        self.assertEqual(
            derive_batch_status([ROW_MATCHED, ROW_SETTLED]), BATCH_PARTIALLY_SETTLED
        )

    def test_a_partial_allocation_is_reviewed_but_not_settled(self):
        """`derive_batch_counters` needs NO change -- `settled_rows` keys on `== ROW_SETTLED` and
        `reviewed_rows` on `!= ROW_PENDING_MATCH`, both of which are already right. Pinned so a
        later 'tidy-up' cannot fold the new status into settled_rows."""
        counters = derive_batch_counters([ROW_PARTIALLY_ALLOCATED])
        self.assertEqual(counters["settled_rows"], 0)
        self.assertEqual(counters["reviewed_rows"], 1)
        self.assertEqual(counters["total_rows"], 1)
```

Extend the import block at the top of the file (`from nirmaan_stack.services.outflow_import.status import (...)`) with `ROW_PARTIALLY_ALLOCATED`, `ACTIVE_ROW_STATUSES`, `derive_batch_counters`, `BATCH_DRAFT`, `BATCH_IN_REVIEW`, `BATCH_COMPLETED`, `BATCH_PARTIALLY_SETTLED` if they are not already there.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack \
  frappe_docker_devcontainer-frappe-1 ../../env/bin/python \
  -m unittest nirmaan_stack.services.outflow_import.test_status -v 2>&1 | tail -20
```

Expected: `ImportError: cannot import name 'ROW_PARTIALLY_ALLOCATED'`.

- [ ] **Step 3: Add the constant and the set to `status.py`**

In `__all__` (line 116-162), add `"ROW_PARTIALLY_ALLOCATED"` after `"ROW_MISMATCHED"` and
`"ACTIVE_ROW_STATUSES"` after `"OPEN_ROW_STATUSES"`.

At line 166, after `ROW_MISMATCHED = "Mismatched"`:

```python
# ⚠️ MONEY IS WRITTEN AND WORK REMAINS -- the first status for which both are true (ADR-0020 D5).
# One bank transfer may settle several approved payments, allocated over several sittings; a row
# holds this status while `allocated < amount`. It is derived exactly like every other status here:
# `allocation.status_for_allocation` compares a fresh SUM over `Outflow Row Match` against the
# row's own amount. There is no leg counter and no completion flag, because a BALANCE answers
# "is this finished?" and a CARDINALITY cannot -- an aggregate over an open set needs no count,
# which is what makes an unbounded number of legs safe.
ROW_PARTIALLY_ALLOCATED = "Partially Allocated"
```

Insert into `ROW_STATUSES` (line 178-185) between `ROW_MISMATCHED` and `ROW_SETTLED`:

```python
ROW_STATUSES = (
    ROW_PENDING_MATCH,
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
    ROW_SKIPPED,
    ROW_ERROR,
)
```

Leave `TERMINAL_ROW_STATUSES` (193) and `OPEN_ROW_STATUSES` (196) **exactly as they are**, then add
after line 196:

```python
# Active = this row still needs a human, whether or not money has already moved against it.
#
# ⚠️ THIS IS NOT `not TERMINAL`, AND `Partially Allocated` IS WHY. That status is in NEITHER
# `OPEN_ROW_STATUSES` NOR `TERMINAL_ROW_STATUSES`, on purpose:
#
#   - putting it in OPEN would enrol it in the four cross-batch reads that walk that set
#     (`review._disambiguate_matched`, `_enforce_single_claim`, `_load_open_rows_for_keys`), so a
#     half-allocated row would start contending for records a different row already holds;
#   - putting it in TERMINAL would tell `derive_batch_status`, `batch_is_open` and the screen that
#     a transfer with money still to allocate is finished.
#
# So the "does anybody still owe this row a decision?" question moved to its OWN set, and the two
# readers that ask it -- `derive_batch_status` and `derive_import_summary`'s open figures -- read
# THIS one. `ACTIVE == OPEN` until the first partial allocation exists, so nothing already in the
# database moves; that equivalence is pinned by test rather than left to be noticed.
ACTIVE_ROW_STATUSES = OPEN_ROW_STATUSES | {ROW_PARTIALLY_ALLOCATED}
```

- [ ] **Step 4: Switch the two readers to the ACTIVE set**

`derive_batch_status`, replacing lines 722-729 **only** (the docstring above is unchanged):

```python
    # ⚠️ `active`, NOT `open`. A status in neither OPEN nor TERMINAL would make the branch below
    # fire on a batch full of unfinished work and report `Completed` -- and `batch_is_open` would
    # then drop that statement out of `match_period` forever. See `ACTIVE_ROW_STATUSES`.
    active_rows = [s for s in statuses if s in ACTIVE_ROW_STATUSES]
    # `banked` = money has landed, or a decision was taken. A partially allocated row qualifies:
    # some of its money HAS been written, which is precisely what `Partially Settled` means.
    banked_rows = [
        s
        for s in statuses
        if s in TERMINAL_ROW_STATUSES or s == ROW_PARTIALLY_ALLOCATED
    ]

    if not active_rows:
        return BATCH_COMPLETED
    if banked_rows:
        return BATCH_PARTIALLY_SETTLED
    return BATCH_IN_REVIEW
```

`derive_import_summary`, lines 1013-1014 and inside `open_side` at 1034:

```python
    # ⚠️ ACTIVE, NOT OPEN -- a partially allocated row's money is NOT settled, so it must stay in
    # the "still open" figure or the summary panel's `Total = Settled + Still open` band silently
    # stops adding up. `settled_rows + open_rows == total_rows` is the invariant being preserved.
    open_rows = sum(rows(s) for s in ACTIVE_ROW_STATUSES)
    open_value = sum((value(s) for s in ACTIVE_ROW_STATUSES), Decimal("0"))
```

and in `open_side`'s comprehension, `if status in OPEN_ROW_STATUSES` becomes
`if status in ACTIVE_ROW_STATUSES` (its docstring's reference to `OPEN_ROW_STATUSES` becomes
`ACTIVE_ROW_STATUSES` in the same edit — the "walks the same set" claim must stay true).

Leave `decided_rows = rows(ROW_SETTLED)` at line 1046 **unchanged**. A half-allocated row is not
decided, and its comment's claim `settled_rows + open_rows == total_rows` still holds because the
row is now inside `open_rows`.

- [ ] **Step 5: Run the Python tests to verify they pass**

```bash
docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack \
  frappe_docker_devcontainer-frappe-1 ../../env/bin/python \
  -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py" 2>&1 | tail -5
```

Expected: `OK`, with **more than 172** tests in `test_status` and no failures anywhere else in the
pure suite.

- [ ] **Step 6: Widen the three server-side status gates**

`nirmaan_stack/api/outflow_import/review.py`, line 119 — import `ROW_PARTIALLY_ALLOCATED` from
`status` at the top (line 90-112 block), then:

```python
# ⚠️ `Partially Allocated` JOINS THIS SET AND THAT IS THE WHOLE SAFETY ARGUMENT FOR ADR-0020.
# `match_batch` skips these rows; everything else re-persists an outcome, and `_persist_row_outcome`
# ends with `frappe.db.delete(MATCH_DOCTYPE, {"import_row": row.name})`. A partially allocated row
# reaching that line would have its settlement evidence deleted while the payments stayed Paid --
# silently. Frozen does NOT mean finished here: the row is still ACTIVE and still needs a human.
_FROZEN_ROW_STATUSES = (ROW_SKIPPED, ROW_SETTLED, ROW_PARTIALLY_ALLOCATED)
```

`_SCOPE_STATUSES` (~1709-1727) gains a fourth working scope. `SCOPE_ALL` is derived from
`ROW_STATUSES` and picks the new status up on its own — do not hand-edit it:

```python
SCOPE_ALL = "all"
SCOPE_NOT_MATCHED = "not_matched"
SCOPE_PARTLY = "partly"
SCOPE_MATCHED = "matched"
SCOPE_SKIPPED = "skipped"

_SCOPE_STATUSES = {
    # `all` still excludes only Skipped, and picks the new status up on its own.
    SCOPE_ALL: tuple(s for s in ROW_STATUSES if s != ROW_SKIPPED),
    SCOPE_NOT_MATCHED: (ROW_PENDING_MATCH, ROW_MISMATCHED, ROW_ERROR),
    # ⚠️ ITS OWN SCOPE, NOT FOLDED INTO `matched`. `outflowTableModel.tabCountParts` splits the
    # Matched tab into exactly TWO chips (Matched + Settled); a third status there makes the chips
    # stop summing to the tab total -- the precise defect that function was written to fix. It is
    # also a different job: "money moved, finish the allocation" is not "nothing matched, go find
    # something", and the screen's default landing tab is Not-Matched.
    SCOPE_PARTLY: (ROW_PARTIALLY_ALLOCATED,),
    SCOPE_MATCHED: (ROW_MATCHED, ROW_SETTLED),
    SCOPE_SKIPPED: (ROW_SKIPPED,),
}
```

⚠️ Keep the existing comments on `SCOPE_ALL` and `SCOPE_SKIPPED` verbatim — they record owner
rulings, not implementation notes.

`skip_row` (~1029) currently refuses only `ROW_SETTLED`. Widen it:

```python
    # ⚠️ A PARTIALLY ALLOCATED ROW MAY NOT BE SKIPPED. Money has already been written against it,
    # and `Skipped` is terminal -- skipping would strand live `Outflow Row Match` records under a
    # row that claims nothing was ever done. Reverse the allocations first (`reverse_allocation`),
    # which returns the row to `Matched`/`Mismatched` and makes it skippable again.
    if row.row_status in (ROW_SETTLED, ROW_PARTIALLY_ALLOCATED):
```

(Keep the existing message for `Settled` and add a second, distinct message for the new case —
`review.py`'s D1 slice established that a refusal must say WHICH rule it broke.)

- [ ] **Step 7: Add the doctype Select option**

`nirmaan_stack/nirmaan_stack/doctype/outflow_import_row/outflow_import_row.json`, the `row_status`
field object. Change `options` and extend `description`:

```json
   "options": "Pending match run\nMatched\nMismatched\nPartially Allocated\nSettled\nSkipped\nError"
```

Append to the existing `description` string, before the closing `DERIVED ONLY by ...` sentence:

```
Partially Allocated = one or more approved payments have been settled from this transfer but money is still unallocated; allocated = SUM(target_amount) over its Settled Outflow Row Match rows, and the row becomes Settled when the remainder falls within AMOUNT_TOLERANCE.
```

Then run the migrate so the runtime column accepts the value:

```bash
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
  bench --site localhost migrate
```

⚠️ Root `CLAUDE.md`: *"passing tests do not guarantee the runtime database has the new column."*
Verify: `frappe.get_meta("Outflow Import Row").get_field("row_status").options` contains the value.

- [ ] **Step 8: Write the failing frontend parity tests**

In `frontend/src/pages/outflow-import/outflowImportStatus.test.ts`, replace the two tests below
inside the existing `describe("row status vocabulary ...")` block:

```typescript
    // REPLACES "is exactly these six statuses, in reviewer order"
    it("is exactly these seven statuses, in reviewer order", () => {
        expect(ROW_STATUSES).toEqual([
            "Pending match run",
            "Matched",
            "Mismatched",
            "Partially Allocated",
            "Settled",
            "Skipped",
            "Error",
        ]);
    });

    // REPLACES "partitions cleanly into terminal and open" -- INVERTED, not deleted.
    it("no longer partitions into terminal and open, because Partially Allocated is in neither", () => {
        // ⚠️ DELIBERATE (ADR-0020 D5). Money is written and work remains. Kept as an inverted pin:
        // restoring the partition means putting the status into one of the two sets, and both
        // choices are silent defects -- see the Python half in test_status.TestVocabulary.
        expect(isOpen(ROW_PARTIALLY_ALLOCATED)).toBe(false);
        expect(isTerminal(ROW_PARTIALLY_ALLOCATED)).toBe(false);
        expect(TERMINAL_ROW_STATUSES.size + OPEN_ROW_STATUSES.size).not.toBe(
            ROW_STATUSES.length,
        );
    });

    it("partitions cleanly into active and terminal", () => {
        for (const status of ROW_STATUSES) {
            expect(isActive(status) || isTerminal(status)).toBe(true);
            expect(isActive(status) && isTerminal(status)).toBe(false);
        }
        expect(ACTIVE_ROW_STATUSES.size + TERMINAL_ROW_STATUSES.size).toBe(
            ROW_STATUSES.length,
        );
    });

    it("gives Partially Allocated its own tone, distinct from every other status", () => {
        // ⚠️ NOT amber -- amber is Mismatched's. Two statuses sharing a tone is the same defect
        // as no tone at all: the chip stops telling them apart.
        const tone = ROW_STATUS_TONE[ROW_PARTIALLY_ALLOCATED];
        expect(tone).toBeTruthy();
        const others = ROW_STATUSES.filter((s) => s !== ROW_PARTIALLY_ALLOCATED);
        expect(others.map((s) => ROW_STATUS_TONE[s])).not.toContain(tone);
    });
```

Add `ROW_PARTIALLY_ALLOCATED`, `ACTIVE_ROW_STATUSES` and `isActive` to the file's import list.

- [ ] **Step 9: Run the frontend tests to verify they fail**

```bash
cd frontend && yarn vitest run src/pages/outflow-import/outflowImportStatus.test.ts
```

Expected: FAIL — `ROW_PARTIALLY_ALLOCATED` is not exported.

- [ ] **Step 10: Mirror the vocabulary in `outflowImportStatus.ts`**

After line 27 (`ROW_MISMATCHED`):

```typescript
/**
 * Money is written and work remains -- the first status for which both are true (ADR-0020).
 * One transfer may settle several approved payments, allocated over several sittings.
 */
export const ROW_PARTIALLY_ALLOCATED = "Partially Allocated";
```

Add it to `RowStatus` (32-38) and to `ROW_STATUSES` (41-48) between `ROW_MISMATCHED` and
`ROW_SETTLED`. Leave `TERMINAL_ROW_STATUSES` and `OPEN_ROW_STATUSES` unchanged, then after line 64:

```typescript
/**
 * Still needs a human, whether or not money has already moved against it.
 *
 * ⚠️ NOT `!isTerminal`. `Partially Allocated` is in neither `OPEN_ROW_STATUSES` nor
 * `TERMINAL_ROW_STATUSES` -- see the Python `ACTIVE_ROW_STATUSES` comment for why each of the two
 * obvious placements is a silent defect. `ACTIVE === OPEN` until a partial allocation exists.
 */
export const ACTIVE_ROW_STATUSES: ReadonlySet<string> = new Set([
    ...OPEN_ROW_STATUSES,
    ROW_PARTIALLY_ALLOCATED,
]);

export const isActive = (status: string): boolean => ACTIVE_ROW_STATUSES.has(status);
```

`deriveBatchStatus` (88-95) mirrors the Python change exactly:

```typescript
export function deriveBatchStatus(rowStatuses: string[]): string {
    if (!rowStatuses.length) return BATCH_DRAFT;
    // ⚠️ `active`, not `open` -- see the Python twin. A status in neither set would make the
    // `!active.length` branch report `Completed` on a batch full of unfinished work.
    const active = rowStatuses.filter(isActive);
    const banked = rowStatuses.filter(
        (s) => isTerminal(s) || s === ROW_PARTIALLY_ALLOCATED,
    );
    if (!active.length) return BATCH_COMPLETED;
    if (banked.length) return BATCH_PARTIALLY_SETTLED;
    return BATCH_IN_REVIEW;
}
```

`deriveBatchCounters` (106-114) is **unchanged** — `settled_rows` already keys on `=== ROW_SETTLED`.

`ROW_STATUS_TONE` (127-134) gains one entry between Mismatched and Settled:

```typescript
    [ROW_PARTIALLY_ALLOCATED]: "bg-sky-50 text-sky-700",
```

- [ ] **Step 11: Add the 4th tab and de-hardcode the terminal check**

`frontend/src/pages/outflow-import/outflowTableModel.ts` (472-504):

```typescript
export type OutflowTab = "all" | "notMatched" | "partlyAllocated" | "matched";

export const OUTFLOW_TABS: { id: OutflowTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "notMatched", label: "Not-Matched" },
    { id: "partlyAllocated", label: "Partly Allocated" },
    { id: "matched", label: "Matched / Settled" },
];

export const SCOPE_FOR_TAB: Record<OutflowTab, OutflowScope> = {
    all: "all",
    notMatched: "not_matched",
    partlyAllocated: "partly",
    matched: "matched",
};
```

⚠️ **Do NOT touch `tabCountParts` (538-564).** It hard-splits the Matched tab into exactly two
chips, and the new status gets its own tab precisely so that stays true.

`frontend/src/pages/outflow-import/components/OutflowRowsTable.tsx:701` — replace the hardcoded
literals with the module's own set (import `TERMINAL_ROW_STATUSES` from `../outflowImportStatus`):

```typescript
    // ⚠️ READ THE SET, never re-spell it. This was two string literals, the one place in the
    // client that duplicated the terminal vocabulary -- so a change to the module could not reach
    // it. A `Partially Allocated` row must keep its Outcome button: it is frozen against
    // re-matching, but a person still owes it a decision.
    const terminal = TERMINAL_ROW_STATUSES.has(row.row_status);
```

- [ ] **Step 12: Run the whole frontend suite**

```bash
cd frontend && yarn test 2>&1 | tail -20
```

Expected: PASS. `outflowTableModel.test.ts:965-988` pins the tab ids/labels and `SCOPE_FOR_TAB`
totality — update those assertions to the four-tab shape in the same commit if they fail.

- [ ] **Step 13: Run the api suite to prove nothing regressed**

```bash
for m in test_review test_expenses test_settle_payment test_upload; do
  docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
    bench --site localhost run-tests --app nirmaan_stack \
    --module nirmaan_stack.api.outflow_import.$m 2>&1 | tail -3
done
```

Expected: all OK. `test_review::test_the_two_working_scopes_partition_everything_except_skipped`
(line 1581) asserts `not_matched + matched == all` — it now needs `+ partly` and belongs in this
commit.

- [ ] **Step 14: Commit**

```bash
git add nirmaan_stack/services/outflow_import/status.py \
        nirmaan_stack/services/outflow_import/test_status.py \
        nirmaan_stack/api/outflow_import/review.py \
        nirmaan_stack/api/outflow_import/test_review.py \
        nirmaan_stack/nirmaan_stack/doctype/outflow_import_row/outflow_import_row.json \
        frontend/src/pages/outflow-import/outflowImportStatus.ts \
        frontend/src/pages/outflow-import/outflowImportStatus.test.ts \
        frontend/src/pages/outflow-import/outflowTableModel.ts \
        frontend/src/pages/outflow-import/outflowTableModel.test.ts \
        frontend/src/pages/outflow-import/components/OutflowRowsTable.tsx
git commit -m "feat(outflow-import): the Partially Allocated row status, open AND frozen

Inert -- nothing writes it yet. It is in NEITHER OPEN_ROW_STATUSES nor
TERMINAL_ROW_STATUSES, so derive_batch_status and the summary's open figures
move to the new ACTIVE_ROW_STATUSES; without that a batch of only-partially-
allocated rows would report Completed and drop out of match_period forever.

_FROZEN_ROW_STATUSES gains it, which is the safety argument for ADR-0020:
_persist_row_outcome deletes a row's match records, and a frozen row never
reaches it.

Both parity pins are INVERTED rather than deleted, and OutflowRowsTable stops
re-spelling the terminal set as two string literals.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `Outflow Row Match` — the six fields and the partial unique index

**Still inert.** No code writes a `Reversed` row or a snapshot yet; this makes the table able to hold one.

**Files:**
- Modify: `nirmaan_stack/nirmaan_stack/doctype/outflow_row_match/outflow_row_match.json` (`field_order` at 8-24, `match_kind` at 88-98)
- Modify: `nirmaan_stack/nirmaan_stack/doctype/outflow_row_match/outflow_row_match.py` (docstring, `validate`, `on_doctype_update`)
- Create: `nirmaan_stack/patches/v3_0/outflow_match_partial_unique.py`
- Modify: `nirmaan_stack/patches.txt`
- Create: `nirmaan_stack/api/outflow_import/test_match_record.py`

**Interfaces:**
- Produces: `Outflow Row Match` fields `reversed_at`, `reversed_by`, `reversal_reason`, `target_project`, `target_vendor`; `match_kind` accepts `"Settled"` and `"Reversed"`. Task 3+ read these. Module constants `MATCH_SETTLED = "Settled"`, `MATCH_REVERSED = "Reversed"` are defined in Task 3's `allocation.py`, **not here** — the doctype file must not become a second home for the vocabulary.

⚠️ **`ofm_match_target_unique` is a table CONSTRAINT, not a bare index.** `frappe.db.add_unique`
issues `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE(...)`, and `pg_indexes` renders the
constraint-backed index identically to a plain one. **`DROP INDEX` will fail on it.** The patch must
drop the CONSTRAINT and create a differently-named partial index, and `on_doctype_update` must stop
calling `add_unique` — otherwise the next migrate silently re-adds the non-partial constraint
alongside the partial one, and a reversed-then-reallocated payment fails on the old key.

- [ ] **Step 1: Write the failing test**

Create `nirmaan_stack/api/outflow_import/test_match_record.py`:

```python
# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The `Outflow Row Match` record's own rules (ADR-0020 D3/D4).

Runs against the LIVE localhost site, so every row this suite creates is torn down by name.
"""

import unittest

import frappe

MATCH_DOCTYPE = "Outflow Row Match"


class MatchRecordFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._created = []

    @classmethod
    def tearDownClass(cls):
        for name in cls._created:
            frappe.delete_doc(MATCH_DOCTYPE, name, force=True, ignore_permissions=True)
        frappe.db.commit()
        super().tearDownClass()

    def _match(self, **overrides):
        doc = frappe.new_doc(MATCH_DOCTYPE)
        doc.update(
            {
                "import_row": overrides.get("import_row", "OFR-TEST-000001"),
                "import_batch": overrides.get("import_batch", "OFI-TEST-00001"),
                "transfer_id": overrides.get("transfer_id", frappe.generate_hash(length=10)),
                "target_doctype": "Project Payments",
                "target_name": overrides.get("target_name", "PAY-TEST-001"),
                "target_amount": overrides.get("target_amount", 1000.0),
                "match_kind": overrides.get("match_kind", "Settled"),
                "match_basis": "Manual",
            }
        )
        doc.insert(ignore_permissions=True)
        type(self)._created.append(doc.name)
        return doc


class TestTheNewFieldsExist(MatchRecordFixture):
    def test_the_six_new_fields_are_on_the_doctype(self):
        meta = frappe.get_meta(MATCH_DOCTYPE)
        for fieldname in (
            "reversed_at",
            "reversed_by",
            "reversal_reason",
            "target_project",
            "target_vendor",
        ):
            self.assertIsNotNone(
                meta.get_field(fieldname), f"{fieldname} is missing from {MATCH_DOCTYPE}"
            )

    def test_match_kind_offers_exactly_settled_and_reversed(self):
        options = frappe.get_meta(MATCH_DOCTYPE).get_field("match_kind").options
        self.assertEqual(options.split("\n"), ["Settled", "Reversed"])

    def test_the_runtime_table_really_has_the_columns(self):
        """⚠️ Root CLAUDE.md: passing tests do not prove the RUNTIME database has the column.
        Tests use a separate auto-migrated database; this asserts the live one."""
        for column in ("reversed_at", "reversed_by", "reversal_reason", "target_project", "target_vendor"):
            self.assertTrue(
                frappe.db.has_column(MATCH_DOCTYPE, column), f"{column} missing from the live table"
            )


class TestTheImmutabilityRuleIsNarrowedNotDropped(MatchRecordFixture):
    def test_a_match_is_created_as_settled(self):
        with self.assertRaises(frappe.ValidationError):
            self._match(match_kind="Reversed")

    def test_settled_may_become_reversed(self):
        doc = self._match()
        doc.match_kind = "Reversed"
        doc.reversed_by = "tester@example.com"
        doc.reversal_reason = "wrong PO"
        doc.save(ignore_permissions=True)
        self.assertEqual(
            frappe.db.get_value(MATCH_DOCTYPE, doc.name, "match_kind"), "Reversed"
        )

    def test_reversed_may_never_become_settled_again(self):
        """A correction SUPERSEDES; it never un-happens. Re-allocating that payment mints a NEW
        record, which the partial unique index now permits."""
        doc = self._match()
        doc.match_kind = "Reversed"
        doc.reversal_reason = "wrong PO"
        doc.save(ignore_permissions=True)
        doc.match_kind = "Settled"
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)

    def test_the_identity_fields_stay_immutable(self):
        doc = self._match()
        doc.target_name = "PAY-TEST-999"
        with self.assertRaises(frappe.ValidationError):
            doc.save(ignore_permissions=True)


class TestThePartialUniqueIndex(MatchRecordFixture):
    def test_two_settled_legs_of_one_transfer_are_allowed(self):
        """Fan-out. The key is on (transfer, TARGET), not on the transfer alone."""
        transfer = frappe.generate_hash(length=10)
        self._match(transfer_id=transfer, target_name="PAY-TEST-A")
        self._match(transfer_id=transfer, target_name="PAY-TEST-B")

    def test_the_same_target_twice_on_one_transfer_is_still_refused(self):
        transfer = frappe.generate_hash(length=10)
        self._match(transfer_id=transfer, target_name="PAY-TEST-C")
        with self.assertRaises(Exception):
            self._match(transfer_id=transfer, target_name="PAY-TEST-C")
        frappe.db.rollback()

    def test_a_reversed_leg_releases_the_key(self):
        """⚠️ THE WHOLE POINT OF THE PARTIAL INDEX (ADR-0020 D4). Without `WHERE match_kind =
        'Settled'` a correctly-reversed payment could never be re-allocated to that transfer."""
        transfer = frappe.generate_hash(length=10)
        first = self._match(transfer_id=transfer, target_name="PAY-TEST-D")
        first.match_kind = "Reversed"
        first.reversal_reason = "wrong PO"
        first.save(ignore_permissions=True)
        frappe.db.commit()
        self._match(transfer_id=transfer, target_name="PAY-TEST-D")

    def test_the_old_non_partial_constraint_is_gone(self):
        """⚠️ If `on_doctype_update` still calls `add_unique`, a migrate re-adds the plain
        constraint beside the partial index and the test above starts failing months later."""
        rows = frappe.db.sql(
            """SELECT conname FROM pg_constraint
               WHERE conrelid = '"tabOutflow Row Match"'::regclass AND contype = 'u'"""
        )
        self.assertEqual(rows, [], f"a non-partial UNIQUE constraint survives: {rows}")
```

- [ ] **Step 2: Run it to verify it fails**

```bash
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
  bench --site localhost run-tests --app nirmaan_stack \
  --module nirmaan_stack.api.outflow_import.test_match_record 2>&1 | tail -20
```

Expected: FAIL — `reversed_at is missing from Outflow Row Match`.

- [ ] **Step 3: Add the fields to the doctype JSON**

`field_order` (lines 8-24) becomes:

```json
  "field_order": [
   "identity_section",
   "import_row",
   "import_batch",
   "transfer_id",
   "target_section",
   "target_doctype",
   "target_name",
   "target_amount",
   "target_project",
   "target_vendor",
   "classification_section",
   "match_kind",
   "match_basis",
   "settlement_origin",
   "provenance_section",
   "matched_at",
   "matched_by",
   "reversed_at",
   "reversed_by",
   "reversal_reason"
  ],
```

`match_kind` (88-98) — widen `options` and extend the `description`; everything else unchanged:

```json
   {
    "default": "Settled",
    "description": "Settled = money was written: a payment or expense marked Paid, or an expense created at Paid. Reversed = that settlement was undone by reverse_allocation; the record is KEPT so the mistake stays auditable, and it is excluded from the allocated SUM and from the partial unique index, so the same payment may be allocated to this transfer again. The transition is one-way: Settled -> Reversed, once, never back -- a correction supersedes rather than un-happens. The v2 kind 'Reconciled' (matched, nothing written) was retired at the v3 reversal because a suggestion and a settlement addressing the same record would contend for the (transfer_id, target_doctype, target_name) key.",
    "fieldname": "match_kind",
    "fieldtype": "Select",
    "in_list_view": 1,
    "in_standard_filter": 1,
    "label": "Match Kind",
    "options": "Settled\nReversed",
    "reqd": 1
   },
```

Add these five field objects (place them so the JSON matches `field_order`):

```json
   {
    "description": "SNAPSHOT of the settled record's project AT ALLOCATION TIME -- not a derived field and never recomputed. If the payment is later re-pointed at another project this record keeps what was true when the money was allocated, which is what an immutable audit row should say. Blank on Non Project Expenses, which has no project column. Exists so a fan-out view can group by project without joining three ledgers. Same disposition as Internal Transfer Memo.estimated_rate.",
    "fieldname": "target_project",
    "fieldtype": "Link",
    "label": "Target Project",
    "options": "Projects",
    "read_only": 1
   },
   {
    "description": "SNAPSHOT of the settled record's vendor AT ALLOCATION TIME. See target_project -- same rule, same reason. Blank on Non Project Expenses.",
    "fieldname": "target_vendor",
    "fieldtype": "Link",
    "label": "Target Vendor",
    "options": "Vendors",
    "read_only": 1
   },
   {
    "fieldname": "reversed_at",
    "fieldtype": "Datetime",
    "label": "Reversed At",
    "read_only": 1
   },
   {
    "fieldname": "reversed_by",
    "fieldtype": "Data",
    "label": "Reversed By",
    "read_only": 1
   },
   {
    "description": "Why this settlement was undone. REQUIRED by reverse_allocation, not by this field -- a JSON reqd would refuse every ordinary Settled insert. Same standard skip_row already holds: undoing money needs a stated reason.",
    "fieldname": "reversal_reason",
    "fieldtype": "Small Text",
    "label": "Reversal Reason"
   },
```

- [ ] **Step 4: Narrow the immutability rule in the controller**

`nirmaan_stack/nirmaan_stack/doctype/outflow_row_match/outflow_row_match.py`. Replace the
module-docstring sentence *"Immutable once written (track_changes 0) -- a correction supersedes
rather than edits."* with:

```
IMMUTABLE EXCEPT FOR ONE ONE-WAY STAMP (narrowed at ADR-0020 D3, not dropped). `match_kind` may go
`Settled -> Reversed` exactly once, together with `reversed_at` / `reversed_by` /
`reversal_reason`; every other field stays frozen, and `Reversed -> Settled` is refused. Re-allocating
that payment mints a NEW record, which the PARTIAL unique index permits -- so a correction still
supersedes rather than edits. `track_changes` stays 0: these rows would flood the Version table, and
the reversal stamp IS the audit.
```

Replace `validate` and `on_doctype_update`:

```python
_SETTLED = "Settled"
_REVERSED = "Reversed"

# The fields a reversal is allowed to touch. Everything else is frozen after insert.
_REVERSAL_FIELDS = ("match_kind", "reversed_at", "reversed_by", "reversal_reason")


class OutflowRowMatch(Document):
    def validate(self):
        if not (self.transfer_id or "").strip():
            frappe.throw("transfer_id is required for an outflow row match.")
        if not (self.target_doctype or "").strip() or not (self.target_name or "").strip():
            frappe.throw("target_doctype and target_name are required for an outflow row match.")
        self._assert_kind_is_legal()

    def _assert_kind_is_legal(self):
        """The one-way stamp, and the freeze around it (ADR-0020 D3)."""
        if self.is_new():
            if (self.match_kind or "") != _SETTLED:
                frappe.throw(
                    "A match record is created as 'Settled'. A row here means money was written; "
                    "'Reversed' is a stamp applied later, never an initial state."
                )
            return

        before = self.get_doc_before_save()
        if not before:
            return

        if before.match_kind == _REVERSED and self.match_kind == _SETTLED:
            frappe.throw(
                "A reversed settlement cannot be un-reversed. Allocate the payment again -- that "
                "mints a new match record, which the partial unique index permits."
            )

        # ⚠️ EVERY OTHER FIELD IS FROZEN. Without this the "immutable" claim in the docstring is a
        # comment rather than a rule, and a re-pointed target_name would silently move a settlement
        # onto a record nobody allocated.
        for field in ("import_row", "import_batch", "transfer_id", "target_doctype",
                      "target_name", "target_amount", "match_basis", "matched_at", "matched_by"):
            if (before.get(field) or "") != (self.get(field) or ""):
                frappe.throw(
                    f"'{field}' is immutable on a match record. A correction supersedes rather "
                    f"than edits: reverse this record and allocate again."
                )


def on_doctype_update():
    """Three read indexes, one target lookup index, and the PARTIAL unique constraint.

    EXPLICIT NAMES throughout. PostgreSQL index names are unique per SCHEMA, not per table, and
    Frappe generates them with no table prefix; `CREATE INDEX IF NOT EXISTS` matches by NAME ONLY,
    so a generic generated name colliding with another table's index makes the call a SILENT no-op.

    ⚠️ `frappe.db.add_unique` IS DELIBERATELY NO LONGER CALLED HERE (ADR-0020 D4). It issues
    `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE(...)`, and a PostgreSQL table CONSTRAINT can never
    carry a `WHERE` clause -- only `CREATE UNIQUE INDEX ... WHERE` can. Leaving the call in place
    would re-add the non-partial constraint on every migrate, beside the partial index, and a
    correctly-reversed payment could then never be re-allocated to its transfer. The old constraint
    is dropped by `patches/v3_0/outflow_match_partial_unique.py`.

    ⚠️ `ofm_match_target_idx` SERVES A READ THAT DOES NOT EXIST YET AND CANNOT WITHOUT IT. The
    unique index leads with `transfer_id`, so PostgreSQL cannot use it to answer "which transfer
    paid this payment?" -- every reverse-lookup view would be a sequential scan.
    """
    frappe.db.add_index("Outflow Row Match", ["import_batch"], "ofm_match_batch_idx")
    frappe.db.add_index("Outflow Row Match", ["transfer_id"], "ofm_match_transfer_idx")
    frappe.db.add_index("Outflow Row Match", ["import_row"], "ofm_match_import_row_idx")
    frappe.db.add_index(
        "Outflow Row Match", ["target_doctype", "target_name"], "ofm_match_target_idx"
    )
    ensure_settled_target_unique()


def ensure_settled_target_unique():
    """The idempotency guarantee, as a PARTIAL unique index.

    One bank transfer may never settle the same record twice -- but a REVERSED leg must release the
    key, or a corrected mistake could never be re-made correctly. `IF NOT EXISTS` makes re-running
    a migrate safe; the patch calls this function rather than re-inlining the SQL, so the controller
    stays the single source of truth for the index shape.
    """
    frappe.db.sql(
        """CREATE UNIQUE INDEX IF NOT EXISTS ofm_match_settled_target_unique
           ON "tabOutflow Row Match" (transfer_id, target_doctype, target_name)
           WHERE match_kind = 'Settled'"""
    )
```

- [ ] **Step 5: Write the migration patch**

Create `nirmaan_stack/patches/v3_0/outflow_match_partial_unique.py`:

```python
# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Swap `Outflow Row Match`'s plain unique CONSTRAINT for a PARTIAL unique INDEX (ADR-0020 D4).

WHY A PATCH AT ALL
    This is a CONTROLLER-ONLY change to a doctype already synced everywhere, and a plain
    `bench migrate` does NOT re-sync a doctype whose JSON is unchanged -- confirmed on a
    test-server deploy when the D3d BoQ indexes silently never landed. The JSON *is* changing here
    too, but the DROP has no other home.

WHY A CONSTRAINT CANNOT SIMPLY BE ALTERED
    `frappe.db.add_unique` issues `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE(...)`, and a
    PostgreSQL table constraint can never be partial. `DROP INDEX` fails on a constraint-backed
    index; it has to be `ALTER TABLE ... DROP CONSTRAINT`. `pg_indexes` renders both shapes
    identically, which is why this probes `pg_constraint` rather than trusting a name.

HEAL FIRST, THEN CONSTRAIN
    Same shape as `boq_commit_current_unique_guard`. Verified on live data 2026-09-09: no
    `import_row` holds more than one match and no transfer holds a duplicate target, so the heal
    is a no-op today -- it is here because a patch that assumes clean data is a patch that fails
    on the one site where it is not.

CALLS THE HOOK, DOES NOT RE-INLINE IT
    `ensure_settled_target_unique` lives on the controller so the index shape has one owner.
"""

import frappe

from nirmaan_stack.nirmaan_stack.doctype.outflow_row_match.outflow_row_match import (
    ensure_settled_target_unique,
    on_doctype_update as _outflow_row_match_indexes,
)

TABLE = "tabOutflow Row Match"


def _drop_old_unique_constraints() -> int:
    """Drop every non-partial UNIQUE constraint on the table. Returns how many went."""
    rows = frappe.db.sql(
        """SELECT conname FROM pg_constraint
           WHERE conrelid = %s::regclass AND contype = 'u'""",
        (f'"{TABLE}"',),
    )
    for (conname,) in rows:
        frappe.db.sql(f'ALTER TABLE "{TABLE}" DROP CONSTRAINT "{conname}"')
        print(f"    dropped non-partial UNIQUE constraint {conname}")
    return len(rows)


def _drop_old_unique_indexes() -> int:
    """And any bare unique INDEX left over from an earlier hand-run. Never the new partial one."""
    rows = frappe.db.sql(
        """SELECT indexname FROM pg_indexes
           WHERE tablename = %s AND indexname = 'ofm_match_target_unique'""",
        (TABLE,),
    )
    for (indexname,) in rows:
        frappe.db.sql(f'DROP INDEX IF EXISTS "{indexname}"')
        print(f"    dropped legacy unique index {indexname}")
    return len(rows)


def _heal() -> int:
    """Demote duplicate Settled legs so the partial index can be created.

    Keeps the OLDEST leg per (transfer_id, target_doctype, target_name) -- the one that actually
    wrote the money -- and reverses the rest, stamping a reason so the row is never mistaken for
    a decision somebody made.
    """
    groups = frappe.db.sql(
        """SELECT transfer_id, target_doctype, target_name, COUNT(*) AS c
           FROM "tabOutflow Row Match"
           WHERE match_kind = 'Settled'
           GROUP BY transfer_id, target_doctype, target_name
           HAVING COUNT(*) > 1""",
        as_dict=True,
    )
    demoted = 0
    for g in groups:
        rows = frappe.db.sql(
            """SELECT name FROM "tabOutflow Row Match"
               WHERE match_kind = 'Settled' AND transfer_id = %s
                 AND target_doctype = %s AND target_name = %s
               ORDER BY matched_at ASC, name ASC""",
            (g["transfer_id"], g["target_doctype"], g["target_name"]),
            as_dict=True,
        )
        for loser in rows[1:]:
            frappe.db.set_value(
                "Outflow Row Match",
                loser["name"],
                {
                    "match_kind": "Reversed",
                    "reversed_at": frappe.utils.now_datetime(),
                    "reversed_by": "Administrator",
                    "reversal_reason": (
                        "Duplicate settlement demoted by "
                        "patches/v3_0/outflow_match_partial_unique."
                    ),
                },
                update_modified=False,
            )
            demoted += 1
        print(
            f"    ({g['transfer_id']}, {g['target_name']}) had {g['c']} settled"
            f" -> kept {rows[0]['name']}, reversed {len(rows) - 1}"
        )
    return demoted


def execute():
    print("[outflow_match_partial_unique] HEAL then CONSTRAIN")
    if not frappe.db.table_exists("Outflow Row Match"):
        print("  table absent -- a fresh sync will fire the hook. Nothing to do.")
        return

    demoted = _heal()
    if demoted:
        frappe.db.commit()
        print(f"  healed: reversed {demoted} duplicate settled leg(s).")
    else:
        print("  healed: nothing to demote (data already clean).")

    dropped = _drop_old_unique_constraints() + _drop_old_unique_indexes()
    if not dropped:
        print("  no legacy unique key found (already migrated, or a fresh site).")
    frappe.db.commit()

    # Calls the controller hook so the index shape has exactly one definition.
    _outflow_row_match_indexes()
    ensure_settled_target_unique()

    # A brand-new index has no planner statistics until ANALYZE runs; without it PostgreSQL may
    # keep sequential-scanning until autovacuum gets round to the table.
    frappe.db.sql(f'ANALYZE "{TABLE}"')
    frappe.db.commit()
    print("[outflow_match_partial_unique] done.")
```

- [ ] **Step 6: Wire `patches.txt` — including the four that were never wired**

⚠️ **Verified 2026-09-09: `grep -i outflow nirmaan_stack/patches.txt` returns NOTHING.** All four
existing outflow index patches are unwired, so `ofm_match_import_row_idx` may be absent in
production even though the controller declares it. Append to `nirmaan_stack/patches.txt`:

```
nirmaan_stack.patches.v3_0.add_outflow_master_index
nirmaan_stack.patches.v3_0.add_outflow_stack_index
nirmaan_stack.patches.v3_0.add_outflow_match_import_row_index
nirmaan_stack.patches.v3_0.outflow_match_partial_unique
```

(Order matters: the three index patches are idempotent and cheap, and running them first means the
new patch starts from a schema matching what the controller declares.)

- [ ] **Step 7: Migrate and verify the live schema**

```bash
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
  bench --site localhost migrate 2>&1 | tail -30
```

Then confirm the index shape actually changed:

```bash
cat > /tmp/q_idx2.py <<'EOF'
import os; os.chdir('/workspace/development/frappe-bench/sites')
import frappe; frappe.init(site='localhost'); frappe.connect()
print("indexes:")
for x in frappe.db.sql("""SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename='tabOutflow Row Match' ORDER BY indexname""", as_dict=True):
    print(" ", x['indexname']); print("     ", x['indexdef'])
print("unique CONSTRAINTS (must be empty):")
print(frappe.db.sql("""SELECT conname FROM pg_constraint
  WHERE conrelid='"tabOutflow Row Match"'::regclass AND contype='u'"""))
frappe.destroy()
EOF
docker cp /tmp/q_idx2.py frappe_docker_devcontainer-frappe-1:/tmp/q_idx2.py
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
  env/bin/python /tmp/q_idx2.py
```

Expected: `ofm_match_settled_target_unique` present **with `WHERE (match_kind = 'Settled'::text)`**,
`ofm_match_target_idx` present, and the unique-constraint list **empty**.

- [ ] **Step 8: Run the new tests to verify they pass**

```bash
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
  bench --site localhost run-tests --app nirmaan_stack \
  --module nirmaan_stack.api.outflow_import.test_match_record 2>&1 | tail -10
```

Expected: OK. Then re-run `test_expenses`, `test_settle_payment` and `test_review` — the new
`validate()` freeze touches every path that writes a match record.

- [ ] **Step 9: Commit**

```bash
git add nirmaan_stack/nirmaan_stack/doctype/outflow_row_match/ \
        nirmaan_stack/patches/v3_0/outflow_match_partial_unique.py \
        nirmaan_stack/patches.txt \
        nirmaan_stack/api/outflow_import/test_match_record.py
git commit -m "feat(outflow-import): Outflow Row Match gains a Reversed kind and a PARTIAL unique index

match_kind may go Settled -> Reversed exactly once; every other field is now
frozen by validate(), so the docstring's immutability claim is a rule rather
than a comment.

The unique key becomes a PARTIAL index over match_kind='Settled', so a reversed
leg releases it and a corrected mistake can be re-made correctly. add_unique
could not express this -- a Postgres table CONSTRAINT can never be partial -- so
on_doctype_update stops calling it and a patch drops the old constraint.

Also wires the four outflow index patches into patches.txt, which had none:
ofm_match_import_row_idx may never have landed in production.

target_project / target_vendor are SNAPSHOTS at allocation time, never recomputed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `allocation.py` — the pure deriver, and the row's status recompute

**Files:**
- Create: `nirmaan_stack/services/outflow_import/allocation.py`
- Create: `nirmaan_stack/services/outflow_import/test_allocation.py`
- Modify: `nirmaan_stack/api/outflow_import/expenses.py` (add `_refresh_row_allocation`; `_record_settlement` loses its row-flip)

**Interfaces:**
- Consumes: `status.ROW_PARTIALLY_ALLOCATED`, `status.ROW_SETTLED` (Task 1); `Outflow Row Match.match_kind == "Reversed"` (Task 2).
- Produces:
  - `allocation.MATCH_SETTLED: str`, `allocation.MATCH_REVERSED: str`
  - `allocation.allocated_of(legs: Iterable[Mapping]) -> Decimal`
  - `allocation.remaining_of(row_amount, legs) -> Decimal`
  - `allocation.is_fully_allocated(row_amount, legs) -> bool`
  - `allocation.status_for_allocation(row_amount, legs, *, fallback: str) -> str`
  - `allocation.allocation_fits(row_amount, legs, candidate_amount) -> bool`
  - `allocation.is_over_allocated(row_amount, legs) -> bool`
  - `expenses._refresh_row_allocation(row_name: str, actor: str) -> str` (returns the new `row_status`)

⚠️ **`allocation.py` is a PURE module.** No `frappe` import, no DB. It takes plain dicts. That is
what lets its tests run without bench, and it is the `services/` half of ADR-0010 B1.

- [ ] **Step 1: Write the failing tests**

Create `nirmaan_stack/services/outflow_import/test_allocation.py`:

```python
# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Tests for the allocation deriver (ADR-0020).

THE PROPERTY UNDER TEST IS THAT THERE IS NO COUNT. Every question this module answers is answered
from a BALANCE, so an unbounded number of legs is safe and a reversed leg simply stops contributing.
"""

import unittest
from decimal import Decimal

from nirmaan_stack.services.outflow_import.allocation import (
    MATCH_REVERSED,
    MATCH_SETTLED,
    allocated_of,
    allocation_fits,
    is_fully_allocated,
    is_over_allocated,
    remaining_of,
    status_for_allocation,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)


def _leg(amount, kind=MATCH_SETTLED):
    return {"target_amount": amount, "match_kind": kind}


# The real group from the live ledger that this feature exists for.
_REAL = [
    _leg("55819"), _leg("5310"), _leg("63720"),
    _leg("33268"), _leg("47208"), _leg("8071"),
]
_REAL_TOTAL = Decimal("213396")


class TestAllocatedOf(unittest.TestCase):
    def test_no_legs_is_zero(self):
        self.assertEqual(allocated_of([]), Decimal("0"))

    def test_it_sums_the_settled_legs(self):
        self.assertEqual(allocated_of(_REAL), _REAL_TOTAL)

    def test_a_reversed_leg_contributes_nothing(self):
        legs = [_leg("55819"), _leg("5310", MATCH_REVERSED)]
        self.assertEqual(allocated_of(legs), Decimal("55819"))

    def test_it_never_goes_through_float(self):
        """Paise survive. `Decimal(0.1)` is not `Decimal('0.1')`, and this module is summing money."""
        self.assertEqual(allocated_of([_leg("18678.69"), _leg("0.31")]), Decimal("18679.00"))

    def test_an_unknown_kind_contributes_nothing(self):
        """Fail CLOSED. A kind this module has never heard of must not silently count as money
        allocated -- that would let a row read Settled with nothing behind it."""
        self.assertEqual(allocated_of([_leg("1000", "Reconciled")]), Decimal("0"))


class TestRemainingOf(unittest.TestCase):
    def test_the_whole_transfer_is_remaining_when_nothing_is_allocated(self):
        self.assertEqual(remaining_of(_REAL_TOTAL, []), _REAL_TOTAL)

    def test_it_shrinks_leg_by_leg(self):
        self.assertEqual(remaining_of(_REAL_TOTAL, _REAL[:2]), Decimal("152267"))

    def test_it_reaches_zero_on_the_last_leg(self):
        self.assertEqual(remaining_of(_REAL_TOTAL, _REAL), Decimal("0"))

    def test_reversing_a_leg_raises_it_again(self):
        legs = list(_REAL[:2])
        self.assertEqual(remaining_of(_REAL_TOTAL, legs), Decimal("152267"))
        legs[1] = _leg("5310", MATCH_REVERSED)
        self.assertEqual(remaining_of(_REAL_TOTAL, legs), Decimal("157577"))


class TestIsFullyAllocated(unittest.TestCase):
    def test_exact(self):
        self.assertTrue(is_fully_allocated(_REAL_TOTAL, _REAL))

    def test_within_the_settle_window(self):
        """Paise gaps land here -- the allocation path never rewrites a payment's amount, so this
        is where a rounding difference is absorbed."""
        self.assertTrue(is_fully_allocated("213400", _REAL))   # Rs 4 over
        self.assertTrue(is_fully_allocated("213391", _REAL))   # Rs 5 under, inclusive
        self.assertFalse(is_fully_allocated("213402", _REAL))  # Rs 6 over

    def test_nothing_allocated_is_not_full(self):
        self.assertFalse(is_fully_allocated(_REAL_TOTAL, []))


class TestStatusForAllocation(unittest.TestCase):
    def test_no_settled_legs_returns_the_fallback(self):
        """A row with no money written is whatever the matcher last made it -- this module does not
        invent a status for it."""
        self.assertEqual(
            status_for_allocation(_REAL_TOTAL, [], fallback=ROW_MISMATCHED), ROW_MISMATCHED
        )
        self.assertEqual(
            status_for_allocation(_REAL_TOTAL, [], fallback=ROW_MATCHED), ROW_MATCHED
        )

    def test_every_leg_reversed_returns_the_fallback(self):
        legs = [_leg("55819", MATCH_REVERSED)]
        self.assertEqual(
            status_for_allocation(_REAL_TOTAL, legs, fallback=ROW_MATCHED), ROW_MATCHED
        )

    def test_some_allocated_is_partially_allocated(self):
        self.assertEqual(
            status_for_allocation(_REAL_TOTAL, _REAL[:2], fallback=ROW_MATCHED),
            ROW_PARTIALLY_ALLOCATED,
        )

    def test_all_allocated_is_settled(self):
        self.assertEqual(
            status_for_allocation(_REAL_TOTAL, _REAL, fallback=ROW_MATCHED), ROW_SETTLED
        )

    def test_a_single_leg_covering_the_whole_transfer_is_settled(self):
        """The ordinary 1:1 case, expressed through the same deriver. This is what keeps
        `settle_row`'s outcome unchanged when it starts routing through here."""
        self.assertEqual(
            status_for_allocation("5000", [_leg("5000")], fallback=ROW_MATCHED), ROW_SETTLED
        )

    def test_over_allocation_still_reads_settled_rather_than_inventing_a_status(self):
        """The GATE refuses over-allocation (`is_over_allocated`); the DERIVER does not get a
        fourth status for a state the write path cannot produce."""
        self.assertEqual(
            status_for_allocation("1000", [_leg("5000")], fallback=ROW_MATCHED), ROW_SETTLED
        )


class TestTheGates(unittest.TestCase):
    def test_a_leg_within_the_remainder_fits(self):
        self.assertTrue(allocation_fits(_REAL_TOTAL, _REAL[:2], "63720"))

    def test_a_leg_larger_than_the_remainder_does_not(self):
        self.assertFalse(allocation_fits(_REAL_TOTAL, _REAL[:5], "8078"))

    def test_the_boundary_is_inclusive_of_the_tolerance(self):
        """Same window as everywhere else, and inclusive at the edge for the same reason:
        'within five rupees, but not exactly five' cannot be said to an accountant."""
        self.assertTrue(allocation_fits("1000", [], "1005"))
        self.assertFalse(allocation_fits("1000", [], "1006"))

    def test_over_allocation_is_detected(self):
        self.assertFalse(is_over_allocated("1000", [_leg("1005")]))
        self.assertTrue(is_over_allocated("1000", [_leg("1006")]))

    def test_an_empty_row_is_not_over_allocated(self):
        self.assertFalse(is_over_allocated("1000", []))
```

- [ ] **Step 2: Run to verify it fails**

```bash
docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack \
  frappe_docker_devcontainer-frappe-1 ../../env/bin/python \
  -m unittest nirmaan_stack.services.outflow_import.test_allocation -v 2>&1 | tail -10
```

Expected: `ModuleNotFoundError: No module named '...allocation'`.

- [ ] **Step 3: Write `allocation.py`**

```python
# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""How much of a bank transfer has been allocated, and what that makes its row (ADR-0020).

PURE MODULE -- no frappe, no DB, no request context. It takes plain mappings so its tests run
without bench, and so the one arithmetic that decides a row's status has exactly one home.

⚠️ THERE IS NO COUNT ANYWHERE IN HERE, AND THAT IS THE DESIGN. "Have all the adjustments been made
against this transfer?" is answered by a BALANCE, never by a CARDINALITY. An aggregate over an open
set needs no count, which is precisely what makes an UNBOUNDED number of legs safe: no group id has
to be closed, no completion flag has to be flipped, and a leg arriving next month costs nothing.
The alternative -- a group id on the row plus a subset-sum search -- was analysed and rejected on
2026-08-10; the reasoning is kept struck-through under "Known limits" in
`.claude/context/domain/outflow-import.md`.

⚠️ `allocated` IS ALWAYS A FRESH SUM, NEVER `+= leg`. Root `CLAUDE.md`: "a derived field must be
RECOMPUTED FROM SOURCE, never incremented by a delta, so that any later ordinary save repairs it
exactly and a reconcile pass can always prove it."

⚠️ A REVERSED LEG CONTRIBUTES NOTHING, and an UNRECOGNISED kind contributes nothing either. Failing
closed matters here: a kind this module has never heard of counting as money would let a row read
`Settled` with nothing behind it.
"""

from decimal import Decimal
from typing import Iterable, Mapping

from nirmaan_stack.services.outflow_import.amounts import (
    AMOUNT_TOLERANCE,
    amounts_match,
    to_decimal,
)
from nirmaan_stack.services.outflow_import.status import (
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)

__all__ = [
    "MATCH_SETTLED",
    "MATCH_REVERSED",
    "allocated_of",
    "remaining_of",
    "is_fully_allocated",
    "status_for_allocation",
    "allocation_fits",
    "is_over_allocated",
]

# The `Outflow Row Match.match_kind` vocabulary, owned here rather than on the doctype controller,
# so the arithmetic and the write path read one definition.
MATCH_SETTLED = "Settled"
MATCH_REVERSED = "Reversed"


def _is_live(leg: Mapping) -> bool:
    return (leg.get("match_kind") or "").strip() == MATCH_SETTLED


def allocated_of(legs: Iterable[Mapping]) -> Decimal:
    """How much of the transfer has actually been written, right now."""
    return sum(
        (to_decimal(leg.get("target_amount")) for leg in legs if _is_live(leg)),
        Decimal("0"),
    )


def remaining_of(row_amount, legs: Iterable[Mapping]) -> Decimal:
    """What is left to allocate. Signed: negative means over-allocated."""
    return to_decimal(row_amount) - allocated_of(legs)


def is_fully_allocated(row_amount, legs: Iterable[Mapping]) -> bool:
    """⚠️ THE SAME `AMOUNT_TOLERANCE` AS EVERY OTHER WINDOW IN THIS FEATURE, and this is where a
    paise gap lands: the allocation path never rewrites a payment's amount (it cannot -- the bank's
    figure is the whole transfer, not any one leg), so rounding is absorbed here instead."""
    return amounts_match(allocated_of(legs), to_decimal(row_amount))


def status_for_allocation(row_amount, legs: Iterable[Mapping], *, fallback: str) -> str:
    """The row's status, derived from its legs.

    `fallback` is what the row becomes when NOTHING is allocated -- after the last leg is reversed,
    say. It is the CALLER's to decide (`Matched` if a suggestion survives, else `Mismatched`),
    because this module cannot see the row's suggestion and must not guess one.
    """
    if not allocated_of(legs):
        return fallback
    return ROW_SETTLED if is_fully_allocated(row_amount, legs) else ROW_PARTIALLY_ALLOCATED


def allocation_fits(row_amount, legs: Iterable[Mapping], candidate_amount) -> bool:
    """May this record be allocated to what is left?

    ⚠️ DELIBERATELY WEAKER THAN `settle_row`'s guard, which demands the record match the WHOLE
    transfer. A leg is by definition smaller than the transfer, so the only thing that can be
    asserted is that it does not exceed the remainder. What catches a wildly wrong pick instead is
    that the row never reaches `Settled` -- it sits at `Partially Allocated` with a visible leftover
    balance. Visible, not silent, which is the whole argument for the weakening (ADR-0020).
    """
    return to_decimal(candidate_amount) <= remaining_of(row_amount, legs) + AMOUNT_TOLERANCE


def is_over_allocated(row_amount, legs: Iterable[Mapping]) -> bool:
    """More has been written than the bank moved. The write path refuses to leave a row here."""
    return remaining_of(row_amount, legs) < -AMOUNT_TOLERANCE
```

- [ ] **Step 4: Run to verify it passes**

```bash
docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack \
  frappe_docker_devcontainer-frappe-1 ../../env/bin/python \
  -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py" 2>&1 | tail -5
```

Expected: `OK`.

- [ ] **Step 5: Move the row-flip out of `_record_settlement`**

In `nirmaan_stack/api/outflow_import/expenses.py`, `_record_settlement` (725-779) currently inserts
the match record **and** flips the row. Split it: keep the insert, delete the `frappe.db.set_value`
block, and add the recompute below it.

```python
def _record_settlement(staged, doc, result, actor) -> None:
    """The import-side half: the match record. THE ROW'S OWN STATUS IS NO LONGER WRITTEN HERE.

    ⚠️ THE FLIP MOVED TO `_refresh_row_allocation` (ADR-0020). It used to set `row_status` to
    `Settled` unconditionally, plus `outcome_note` / `decided_at` / `decided_by` /
    `settlement_origin`. Under incremental allocation this function runs once PER LEG, so the last
    leg would overwrite every earlier leg's facts and a 10%-allocated transfer would read `Settled`
    on the master table. The status is now DERIVED from the legs, which is the only form that can
    be right for both one leg and six.

    [... the rest of the existing docstring is unchanged ...]
    """
    origin = settlement_origin(doc.get("suggested_name"), result.name)
    match = frappe.new_doc(MATCH_DOCTYPE)
    match.update(
        {
            "import_row": staged.name,
            "import_batch": doc["import_batch"],
            "transfer_id": staged.transfer_id,
            "target_doctype": result.doctype,
            "target_name": result.name,
            "target_amount": float(result.amount),
            "match_kind": MATCH_SETTLED,
            "match_basis": (doc.get("match_basis") or "").strip() or "Manual",
            "settlement_origin": origin,
            "matched_at": frappe.utils.now_datetime(),
            "matched_by": actor,
            # SNAPSHOTS at allocation time -- never recomputed. See the field descriptions.
            **_target_snapshot(result.doctype, result.name),
        }
    )
    match.insert(ignore_permissions=True)


# ⚠️ THE PROJECT FIELD IS NAMED DIFFERENTLY ON EACH LEDGER, and `Non Project Expenses` has neither
# a project nor a vendor. A single `doc.get("project")` would silently snapshot None on every
# Project Expense -- correct-looking and wrong.
_SNAPSHOT_FIELDS = {
    "Project Payments": ("project", "vendor"),
    "Project Expenses": ("projects", "vendor"),
    "Non Project Expenses": (None, None),
}


def _target_snapshot(doctype: str, name: str) -> dict:
    project_field, vendor_field = _SNAPSHOT_FIELDS.get(doctype, (None, None))
    fields = [f for f in (project_field, vendor_field) if f]
    if not fields:
        return {"target_project": None, "target_vendor": None}
    values = frappe.db.get_value(doctype, name, fields, as_dict=True) or {}
    return {
        "target_project": values.get(project_field) if project_field else None,
        "target_vendor": values.get(vendor_field) if vendor_field else None,
    }


def _refresh_row_allocation(row_name: str, actor: str) -> str:
    """Recompute a row's allocation from its legs and write the derived status. Returns it.

    ⚠️ THE SUM IS ALWAYS FRESH. Nothing is incremented, so a reversal, a re-allocation and an
    ordinary settle all repair the row exactly, and a reconcile pass can prove the figure at any
    time.

    ⚠️ THE FALLBACK IS THE CALLER'S DECISION IN `allocation.py` AND IS MADE HERE: a row whose last
    leg was reversed returns to `Matched` if its suggestion survived and `Mismatched` otherwise.
    Both are ACTIVE and neither is frozen, so a later re-match can reconsider the row -- which is
    exactly right, because nothing is written against it any more.

    ⚠️ `frappe.db.set_value` bypasses the document lifecycle, and that is correct here: this row
    carries no `doc_events`, and the batch rollup it feeds is invoked explicitly by the caller.
    """
    row = frappe.db.get_value(
        ROW_DOCTYPE, row_name, ["name", "amount", "suggested_name"], as_dict=True
    )
    legs = frappe.db.get_all(
        MATCH_DOCTYPE,
        filters={"import_row": row_name},
        fields=["name", "target_doctype", "target_name", "target_amount", "match_kind"],
        order_by="matched_at asc, name asc",
    )
    fallback = ROW_MATCHED if (row.get("suggested_name") or "").strip() else ROW_MISMATCHED
    new_status = status_for_allocation(row.get("amount"), legs, fallback=fallback)

    frappe.db.set_value(
        ROW_DOCTYPE,
        row_name,
        {
            "row_status": new_status,
            "outcome_note": _allocation_note(row.get("amount"), legs, new_status),
            "decided_at": frappe.utils.now_datetime(),
            "decided_by": actor,
        },
        update_modified=False,
    )
    return new_status


def _allocation_note(row_amount, legs, new_status: str) -> str:
    """The sentence a reviewer reads. It states the BALANCE, never a leg count.

    ⚠️ A COUNT WOULD BE THE ONE NUMBER THAT CANNOT BE CHECKED. "3 of 6 allocated" invites the
    question "six according to whom?", and nothing in the data answers it -- the transfer does not
    know how many payments it was meant to cover. The remaining amount is checkable against the
    statement line by eye, which is what a reviewer actually needs.
    """
    live = [leg for leg in legs if (leg.get("match_kind") or "") == MATCH_SETTLED]
    if not live:
        return "Nothing is allocated against this transfer."
    names = ", ".join(f"{leg['target_doctype']} {leg['target_name']}" for leg in live)
    if new_status == ROW_SETTLED:
        return f"Fully allocated. Settled {names}."
    return (
        f"Partly allocated: {allocated_of(legs)} of {to_decimal(row_amount)}, "
        f"{remaining_of(row_amount, legs)} still to allocate. Settled {names}."
    )
```

Add to the module's import block (line 88-108 region):

```python
from nirmaan_stack.services.outflow_import.allocation import (
    MATCH_REVERSED,
    MATCH_SETTLED,
    allocated_of,
    allocation_fits,
    is_over_allocated,
    remaining_of,
    status_for_allocation,
)
from nirmaan_stack.services.outflow_import.amounts import to_decimal
```

and extend the `status` import with `ROW_MATCHED`, `ROW_MISMATCHED`, `ROW_PARTIALLY_ALLOCATED`.

- [ ] **Step 6: Call the recompute from `settle_row`**

In `settle_row` (line 156), after `_record_settlement(staged, doc, result, actor)`:

```python
        _record_settlement(staged, doc, result, actor)
        # ⚠️ INSIDE THE SAVEPOINT. The status is derived from the legs, so it must be recomputed in
        # the same transaction that added one -- otherwise a rolled-back settle leaves a row
        # claiming money that was never written.
        _refresh_row_allocation(staged.name, actor)
```

The existing `settlement_origin` denormalisation onto the row is preserved by adding it back inside
`_refresh_row_allocation`'s `set_value` **only when the row reaches `ROW_SETTLED`** — it answers
"did the settlement take the machine's pick", which is meaningless while a row is still being
allocated. State that at the call site.

- [ ] **Step 7: Prove the ordinary 1:1 settle is unchanged**

```bash
for m in test_settle_payment test_expenses test_review; do
  docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
    bench --site localhost run-tests --app nirmaan_stack \
    --module nirmaan_stack.api.outflow_import.$m 2>&1 | tail -3
done
```

Expected: all OK, same counts as the baseline (54 / 34 / 148). A single-leg settle now routes
through the deriver and must still land on `Settled` with an equivalent note — if a note assertion
fails, that is the intended visible change and the assertion belongs in this commit.

- [ ] **Step 8: Commit**

```bash
git add nirmaan_stack/services/outflow_import/allocation.py \
        nirmaan_stack/services/outflow_import/test_allocation.py \
        nirmaan_stack/api/outflow_import/expenses.py \
        nirmaan_stack/api/outflow_import/test_settle_payment.py
git commit -m "feat(outflow-import): derive a row's status from its allocation, not from one write

allocation.py is pure: allocated_of / remaining_of / status_for_allocation /
allocation_fits. There is no count anywhere in it -- a balance answers 'is this
finished?' and a cardinality cannot, which is what makes an unbounded number of
legs safe.

_record_settlement stops flipping the row. It runs once per leg, so the last leg
would have overwritten every earlier leg's facts and a 10%-allocated transfer
would have read Settled. The status is now recomputed from a fresh SUM.

target_project / target_vendor snapshots go in here, with a per-ledger field map:
it is 'project' on Payments and 'projects' on Project Expenses.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `allocate_row` — N targets, one savepoint

**The first behaviour change.** Everything before this was inert.

**Files:**
- Create: `nirmaan_stack/services/outflow_import/reference_guard.py`
- Create: `nirmaan_stack/services/outflow_import/test_reference_guard.py`
- Modify: `nirmaan_stack/services/outflow_import/settle.py` (`settle_payment` gains one keyword; `_assert_reference_is_free` delegates)
- Modify: `nirmaan_stack/api/payments/project_payments.py:364-371` (the manual fulfil's guard)
- Modify: `nirmaan_stack/api/outflow_import/expenses.py` (the `allocate_row` endpoint)
- Create: `nirmaan_stack/api/outflow_import/test_allocate_row.py`

**Interfaces:**
- Consumes: `allocation.*` and `expenses._refresh_row_allocation` (Task 3).
- Produces:
  - `reference_guard.sibling_payments_of(reference: str, transfer_id: str) -> set[str]`
  - `reference_guard.assert_reference_is_free(reference, target_name, *, transfer_id=None) -> None`
  - `settle.settle_payment(..., transfer_id: str | None = None, rewrite_amount_to_bank: bool = True)`
  - endpoint `nirmaan_stack.api.outflow_import.expenses.allocate_row(row, targets)` where `targets` is a JSON array of `{"target_doctype": str, "target_name": str}`. Returns `{"row", "row_status", "allocated", "remaining", "legs": [...], "batch_status"}`.

- [ ] **Step 1: Write the failing test for the shared UTR guard**

Create `nirmaan_stack/services/outflow_import/test_reference_guard.py` — this one is pure except
for the sibling lookup, so it tests the pure predicate and leaves the DB read to Task 4's api tests:

```python
# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""The UTR guard, shared by the import and the manual fulfil (ADR-0020 D2).

⚠️ BOTH SITES MUST MOVE TOGETHER, and the failure is asymmetric: miss the manual one and a human
fulfilling by hand is refused on a UTR the import wrote thirty seconds earlier, with a message
telling them to do it by hand.
"""

import unittest

from nirmaan_stack.services.outflow_import.reference_guard import reference_is_blocked


class TestReferenceIsBlocked(unittest.TestCase):
    def test_a_free_reference_is_not_blocked(self):
        self.assertFalse(reference_is_blocked(existing=None, target_name="PAY-1", siblings=set()))

    def test_the_same_payment_is_not_a_conflict(self):
        self.assertFalse(
            reference_is_blocked(existing="PAY-1", target_name="PAY-1", siblings=set())
        )

    def test_another_payment_is_blocked(self):
        self.assertTrue(
            reference_is_blocked(existing="PAY-2", target_name="PAY-1", siblings=set())
        )

    def test_a_sibling_on_the_same_transfer_is_allowed(self):
        """⚠️ THE WHOLE POINT. Six payments settled from one transfer all carry the RAW bank
        reference -- which is what accountants already do by hand: 39 groups / 92 payments on the
        live ledger share one bank-shaped UTR today."""
        self.assertFalse(
            reference_is_blocked(
                existing="PAY-2", target_name="PAY-1", siblings={"PAY-2", "PAY-3"}
            )
        )

    def test_a_payment_settled_from_a_DIFFERENT_transfer_is_still_blocked(self):
        """The sibling set is scoped to ONE transfer_id. Without that scope the guard would be
        switched off entirely -- any payment already carrying the reference would excuse any other."""
        self.assertTrue(
            reference_is_blocked(
                existing="PAY-9", target_name="PAY-1", siblings={"PAY-2", "PAY-3"}
            )
        )

    def test_no_transfer_context_means_the_old_strict_rule(self):
        """`siblings=set()` is what the manual fulfil passes when it has no transfer to check
        against, and it reproduces the pre-ADR-0020 behaviour exactly."""
        self.assertTrue(
            reference_is_blocked(existing="PAY-2", target_name="PAY-1", siblings=set())
        )
```

- [ ] **Step 2: Run to verify it fails**

```bash
docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack \
  frappe_docker_devcontainer-frappe-1 ../../env/bin/python \
  -m unittest nirmaan_stack.services.outflow_import.test_reference_guard -v 2>&1 | tail -6
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Write `reference_guard.py`**

```python
# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Is this bank reference free to write onto this payment? (ADR-0020 D2)

ONE DEFINITION, TWO CALL SITES -- `settle._assert_reference_is_free` (the import) and
`api/payments/project_payments._fulfil_payment` (the manual fulfil). ⚠️ THEY MUST MOVE TOGETHER,
and the failure of missing one is asymmetric: an accountant fulfilling a payment by hand would be
refused on a UTR the import wrote thirty seconds earlier -- and the message would tell them to do
it by hand, which is what they were doing.

⚠️ `Project Payments.utr` KEEPS THE RAW BANK REFERENCE ON EVERY LEG. A decorated string --
"<utr> (part 1/6)" -- would make each value unique and remove the need for this guard entirely, and
it was rejected: `candidates._payments_by_reference` compares `upper(btrim(utr))` and the re-import
duplicate check compares the raw string, so a decorated UTR is INVISIBLE to both. Repeating the raw
reference is also what accountants already do by hand -- 39 groups covering 92 payments on the live
ledger, measured 2026-09-09.

⚠️ THE SIBLING SET IS SCOPED TO ONE `transfer_id`, and that scope is the whole safety of the
relaxation. Without it, any payment already carrying the reference would excuse any other, and the
guard would be switched off rather than narrowed.

⚠️ THE COMPARISON IS ON THE STORED VALUE AS-IS, unchanged from before -- this is not the normalised
matcher key. 226 stored values are whitespace-padded and so already invisible to it; widening the
comparison here would change a guard the owner chose to leave alone, in the same edit as relaxing
it, and the two effects would be impossible to tell apart afterwards.
"""

import frappe

__all__ = ["reference_is_blocked", "sibling_payments_of", "assert_reference_is_free"]

PAYMENT_DOCTYPE = "Project Payments"
MATCH_DOCTYPE = "Outflow Row Match"


def reference_is_blocked(*, existing: str | None, target_name: str, siblings) -> bool:
    """PURE. `existing` is the payment already holding the reference, or None."""
    if not existing or existing == target_name:
        return False
    return existing not in set(siblings or ())


def sibling_payments_of(reference: str, transfer_id: str | None) -> set:
    """Payments this transfer has already settled. Empty when there is no transfer context.

    Reversed legs are excluded: a reversed payment no longer carries this transfer's money, so it
    is not a sibling and must not excuse a collision.
    """
    if not transfer_id:
        return set()
    rows = frappe.db.get_all(
        MATCH_DOCTYPE,
        filters={
            "transfer_id": transfer_id,
            "target_doctype": PAYMENT_DOCTYPE,
            "match_kind": "Settled",
        },
        pluck="target_name",
    )
    return set(rows)


def assert_reference_is_free(
    reference: str, target_name: str, *, transfer_id: str | None = None, error_class=None
) -> None:
    """Throw unless this reference may be written onto this payment.

    `transfer_id=None` reproduces the pre-ADR-0020 strict rule exactly, which is what the manual
    fulfil passes: it has no transfer to check against.
    """
    existing = frappe.db.get_value(PAYMENT_DOCTYPE, {"utr": reference}, "name")
    siblings = sibling_payments_of(reference, transfer_id)
    if not reference_is_blocked(existing=existing, target_name=target_name, siblings=siblings):
        return
    message = (
        f"Bank reference {reference} is already recorded on payment {existing}, which was not "
        f"settled from this transfer."
    )
    if error_class:
        frappe.throw(message, error_class, title="Reference already used")
    frappe.throw(message, title="Reference already used")
```

- [ ] **Step 4: Point both call sites at it**

`nirmaan_stack/services/outflow_import/settle.py`, replacing `_assert_reference_is_free` (755-769):

```python
def _assert_reference_is_free(
    reference: str, target_name: str, transfer_id: str | None = None
) -> None:
    """Delegates to the ONE definition in `services/outflow_import/reference_guard.py`.

    ⚠️ THIS USED TO HOLD THE RULE, AND ITS ERROR TEXT SAID "One transfer covering several payments
    is settled by hand in the payments screen." That sentence described owner ruling Q4, which
    ADR-0020 reverses -- the import can do it now. The guard is not removed, it is NARROWED: a
    payment already carrying this reference is still refused unless it is a sibling settled from
    THIS SAME TRANSFER.
    """
    assert_reference_is_free(
        reference, target_name, transfer_id=transfer_id, error_class=DuplicateReferenceError
    )
```

`settle_payment`'s signature and its two behaviour switches:

```python
def settle_payment(
    row,
    target_name: str,
    actor: str,
    statement_file_url: str | None = None,
    tds: Decimal | None = None,
    transfer_id: str | None = None,
    rewrite_amount_to_bank: bool = True,
    expected_amount: Decimal | None = None,
) -> SettleResult:
```

Inside, three edits:

```python
    if reference:
        _assert_reference_is_free(reference, target_name, transfer_id=transfer_id)
```

```python
    # ⚠️ `expected_amount` REPLACES THE BANK'S FIGURE IN THE WINDOW CHECK, FOR AN ALLOCATION LEG
    # ONLY. `settle_row` passes nothing and the assertion is byte-identical to before: the record
    # must equal the whole transfer. An allocation leg passes the payment's own amount, because a
    # leg is by definition smaller than the transfer -- `allocation.allocation_fits` is what
    # bounded it against the REMAINDER, and it has already run under this row's lock.
    current = _lock_and_assert_payment_settleable(
        target_name, expected_amount if expected_amount is not None else bank_amount, tds=tds
    )
```

```python
    written = current
    if tds is None and rewrite_amount_to_bank:
        # X1 ... [existing comment unchanged]
        exact = rewrite_amount(current, bank_amount)
        ...
```

⚠️ **This is the RED edge from the design spec.** `rewrite_amount_to_bank=False` is what stops an
allocation leg rewriting a Rs 55,819 payment to the transfer's Rs 2,13,396. Put that sentence in the
parameter's own docstring, not only here:

```
    `rewrite_amount_to_bank=False` is REQUIRED on an allocation leg and must never be defaulted
    away. X1's rule -- the record takes the bank's figure -- is about a record that should EQUAL
    the transfer. On a fan-out the bank's figure is the WHOLE TRANSFER, so applying it to leg 1
    rewrites a Rs 55,819 payment to Rs 2,13,396: a silent, catastrophic corruption that every
    existing test stays green through, because no existing test allocates. Paise gaps land in
    `allocation.is_fully_allocated`'s tolerance instead.
```

`nirmaan_stack/api/payments/project_payments.py`, replacing lines 364-371:

```python
    # ⚠️ THE SAME GUARD THE IMPORT USES -- `services/outflow_import/reference_guard.py` (ADR-0020).
    # `transfer_id=None` because a manual fulfil has no transfer to check against, which reproduces
    # the strict rule this block used to spell inline. It must stay in step with the import's call:
    # if only one site learns about siblings, an accountant fulfilling by hand is refused on a UTR
    # the import wrote seconds earlier.
    assert_reference_is_free(utr, pay.name)
```

with `from nirmaan_stack.services.outflow_import.reference_guard import assert_reference_is_free`
at the top. ⚠️ **api -> service is the legal direction**; do not move the guard the other way.

- [ ] **Step 5: Write the failing endpoint test**

Create `nirmaan_stack/api/outflow_import/test_allocate_row.py`. Reuse the existing
`PaymentSettlementFixture` from `test_settle_payment` so the Projects/PO/payment scaffolding is not
re-invented:

```python
# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""One transfer, many payments, allocated over several calls (ADR-0020)."""

import json

import frappe

from nirmaan_stack.api.outflow_import.expenses import allocate_row
from nirmaan_stack.api.outflow_import.test_settle_payment import PaymentSettlementFixture
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)

MATCH_DOCTYPE = "Outflow Row Match"
ROW_DOCTYPE = "Outflow Import Row"


class AllocationFixture(PaymentSettlementFixture):
    """A Rs 100 transfer and three approved payments of Rs 60 / Rs 30 / Rs 10.

    Deliberately NOT the real Rs 2,13,396 group: round numbers make an assertion legible, and the
    real group is exercised in the pure `test_allocation` suite where no fixtures are needed.
    """

    def _three_payments(self):
        return [self._approved_payment(amount) for amount in ("60", "30", "10")]

    def _targets(self, payments):
        return json.dumps(
            [{"target_doctype": "Project Payments", "target_name": p} for p in payments]
        )


class TestAllocatingInOneGo(AllocationFixture):
    def test_three_payments_in_one_call_settle_the_row(self):
        row = self._staged_row(amount="100")
        pays = self._three_payments()
        result = allocate_row(row=row, targets=self._targets(pays))
        self.assertEqual(result["row_status"], ROW_SETTLED)
        self.assertEqual(float(result["remaining"]), 0.0)
        for p in pays:
            self.assertEqual(frappe.db.get_value("Project Payments", p, "status"), "Paid")

    def test_every_leg_gets_its_own_match_record(self):
        row = self._staged_row(amount="100")
        allocate_row(row=row, targets=self._targets(self._three_payments()))
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"import_row": row, "match_kind": "Settled"}), 3
        )

    def test_every_leg_carries_the_RAW_bank_reference(self):
        """⚠️ NOT decorated. ADR-0020 D2 -- the re-import duplicate guard and tier 0 both compare
        the raw string, so a "(part 1/3)" suffix is invisible to them."""
        row = self._staged_row(amount="100")
        reference = frappe.db.get_value(ROW_DOCTYPE, row, "bank_reference_no")
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        for p in pays:
            self.assertEqual(frappe.db.get_value("Project Payments", p, "utr"), reference)

    def test_no_payment_amount_is_rewritten_to_the_transfer(self):
        """⚠️ THE RED EDGE. Without `rewrite_amount_to_bank=False` leg 1 would become Rs 100."""
        row = self._staged_row(amount="100")
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        amounts = sorted(
            float(frappe.db.get_value("Project Payments", p, "amount")) for p in pays
        )
        self.assertEqual(amounts, [10.0, 30.0, 60.0])


class TestAllocatingOverSeveralSittings(AllocationFixture):
    def test_the_row_reads_partially_allocated_between_calls(self):
        row = self._staged_row(amount="100")
        a, b, c = self._three_payments()
        first = allocate_row(row=row, targets=self._targets([a]))
        self.assertEqual(first["row_status"], ROW_PARTIALLY_ALLOCATED)
        self.assertEqual(float(first["remaining"]), 40.0)
        second = allocate_row(row=row, targets=self._targets([b, c]))
        self.assertEqual(second["row_status"], ROW_SETTLED)
        self.assertEqual(float(second["remaining"]), 0.0)

    def test_a_partially_allocated_row_is_frozen_against_a_re_match(self):
        """⚠️ THE SAFETY ARGUMENT FOR ADR-0020. `_persist_row_outcome` ends with
        `frappe.db.delete(MATCH_DOCTYPE, {"import_row": ...})`. If the status were not frozen, a
        re-run would delete the settlement evidence while the payments stayed Paid."""
        from nirmaan_stack.api.outflow_import.review import match_batch

        row = self._staged_row(amount="100")
        a, _, _ = self._three_payments()
        allocate_row(row=row, targets=self._targets([a]))
        batch = frappe.db.get_value(ROW_DOCTYPE, row, "import_batch")
        match_batch(batch=batch)
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"import_row": row, "match_kind": "Settled"}), 1
        )
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_PARTIALLY_ALLOCATED
        )

    def test_a_partially_allocated_row_cannot_be_skipped(self):
        from nirmaan_stack.api.outflow_import.review import skip_row

        row = self._staged_row(amount="100")
        a, _, _ = self._three_payments()
        allocate_row(row=row, targets=self._targets([a]))
        with self.assertRaises(frappe.ValidationError):
            skip_row(row=row, reason="changed my mind")


class TestRefusals(AllocationFixture):
    def test_over_allocation_is_refused_and_writes_nothing(self):
        row = self._staged_row(amount="50")
        pays = self._three_payments()  # 60 + 30 + 10
        with self.assertRaises(frappe.ValidationError):
            allocate_row(row=row, targets=self._targets(pays))
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row}), 0)
        for p in pays:
            self.assertEqual(
                frappe.db.get_value("Project Payments", p, "status"), "Approved"
            )
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_MATCHED)

    def test_a_failing_leg_rolls_back_every_earlier_leg_in_the_same_call(self):
        """⚠️ ONE SAVEPOINT OVER ALL N. A half-landed tick-set leaves a remaining balance nobody
        can explain -- which is why this is one call taking N targets, not N calls."""
        row = self._staged_row(amount="100")
        a, b, _ = self._three_payments()
        frappe.db.set_value("Project Payments", b, "status", "Paid")
        with self.assertRaises(frappe.ValidationError):
            allocate_row(row=row, targets=self._targets([a, b]))
        self.assertEqual(frappe.db.count(MATCH_DOCTYPE, {"import_row": row}), 0)
        self.assertEqual(frappe.db.get_value("Project Payments", a, "status"), "Approved")

    def test_a_credit_row_is_refused(self):
        row = self._staged_row(amount="100", direction="Credit")
        with self.assertRaises(Exception):
            allocate_row(row=row, targets=self._targets(self._three_payments()[:1]))

    def test_the_same_payment_twice_in_one_call_is_refused(self):
        row = self._staged_row(amount="100")
        a, _, _ = self._three_payments()
        with self.assertRaises(frappe.ValidationError):
            allocate_row(row=row, targets=self._targets([a, a]))

    def test_an_empty_target_list_is_refused(self):
        row = self._staged_row(amount="100")
        with self.assertRaises(frappe.ValidationError):
            allocate_row(row=row, targets=json.dumps([]))

    def test_a_settled_row_cannot_be_allocated_again(self):
        row = self._staged_row(amount="100")
        allocate_row(row=row, targets=self._targets(self._three_payments()))
        extra = self._approved_payment("5")
        with self.assertRaises(frappe.ValidationError):
            allocate_row(row=row, targets=self._targets([extra]))


class TestTheOrdinarySettleIsUntouched(AllocationFixture):
    def test_settle_row_still_refuses_a_payment_that_does_not_match_the_transfer(self):
        """`settle_row` keeps its STRICT guard. Only `allocate_row` bounds against the remainder."""
        from nirmaan_stack.api.outflow_import.expenses import settle_row
        from nirmaan_stack.services.outflow_import.settle import AmountMismatchError

        row = self._staged_row(amount="100")
        small = self._approved_payment("10")
        with self.assertRaises(AmountMismatchError):
            settle_row(row=row, target_doctype="Project Payments", target_name=small)
```

⚠️ **`PaymentSettlementFixture` does not currently expose `_staged_row(amount=...)`,
`_approved_payment(amount)` or a `direction` override.** Add those three helpers to it in this
commit, built from the fixture's existing setup — do not duplicate the scaffolding in the new file.

- [ ] **Step 6: Run to verify it fails**

```bash
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
  bench --site localhost run-tests --app nirmaan_stack \
  --module nirmaan_stack.api.outflow_import.test_allocate_row 2>&1 | tail -20
```

Expected: `ImportError: cannot import name 'allocate_row'`.

- [ ] **Step 7: Write the endpoint**

In `nirmaan_stack/api/outflow_import/expenses.py`, after `settle_row`:

```python
@frappe.whitelist(methods=["POST"])
def allocate_row(row: str, targets):
    """Allocate part or all of one bank transfer across several approved Project Payments.

    URL: /api/method/nirmaan_stack.api.outflow_import.expenses.allocate_row

    ⚠️ ONE CALL, N TARGETS, ONE SAVEPOINT -- and that is the opposite of `settle_row`'s
    one-row-per-call rule, deliberately. There, N rows were each DECIDED separately, so partial
    success is the honest shape. Here the N legs are one decision about one transfer: a half-landed
    tick-set leaves a remaining balance nobody can explain, and the reviewer cannot tell which half
    landed without re-reading the match table.

    ⚠️ IT DOES NOT REPLACE `settle_row`, AND THE SCREEN STILL CALLS THAT ONE FOR A SINGLE TICK.
    `settle_row`'s amount guard is STRICT (the record must equal the whole transfer); this one is
    bounded against the REMAINDER, which is necessarily weaker. Keeping both means every settle
    that worked before ADR-0020 takes the identical code path, and the weaker guard is reachable
    only on the new shape.

    ⚠️ WHAT CATCHES A WILDLY WRONG PICK IS NOT A GUARD. A small, wrong payment fits the remainder
    and is allowed. What stops it disappearing is that the row never reaches `Settled` -- it sits
    at `Partially Allocated` with a visible leftover balance, forever, on its own tab. Visible, not
    silent, is the trade this endpoint makes.

    PROJECT PAYMENTS ONLY. Neither expense doctype is offered: `Non Project Expenses` has no
    project column and cannot be corroborated, and an expense fan-out has never been observed.
    Widening it is a separate decision with its own evidence.
    """
    actor = require_outflow_access()
    targets = _parse_targets(targets)
    staged, doc = _load_allocatable_row(row)
    _guard_is_a_debit(doc)
    statement_file_url = _statement_file_url(doc["import_batch"])

    savepoint = f"ofi_alloc_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        legs = _live_legs(staged.name)
        for target in targets:
            amount = _approved_payment_amount(target["target_name"])
            if not allocation_fits(doc["amount"], legs, amount):
                frappe.throw(
                    f"{target['target_name']} is for {amount}, but only "
                    f"{remaining_of(doc['amount'], legs)} of this transfer is unallocated.",
                    title="More than is left",
                )
            result = settle_payment(
                staged,
                target["target_name"],
                actor,
                statement_file_url=statement_file_url,
                transfer_id=staged.transfer_id,
                # ⚠️ THE TWO SWITCHES THAT MAKE A LEG A LEG. See settle_payment's docstring: the
                # bank's figure is the WHOLE transfer, so it must not reach this payment's amount,
                # and the window must be checked against the payment's own figure.
                rewrite_amount_to_bank=False,
                expected_amount=amount,
            )
            _record_settlement(staged, doc, result, actor)
            legs = _live_legs(staged.name)
        if is_over_allocated(doc["amount"], legs):
            frappe.throw(
                f"Those records come to {allocated_of(legs)}, more than the "
                f"{to_decimal(doc['amount'])} this transfer moved.",
                title="More than the transfer",
            )
        new_status = _refresh_row_allocation(staged.name, actor)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)

    statuses = _refresh_batch_rollup(doc["import_batch"])
    frappe.db.commit()
    _link_statement_file_to_target(statement_file_url, result)
    legs = _live_legs(staged.name)
    return {
        "row": row,
        "row_status": new_status,
        "allocated": float(allocated_of(legs)),
        "remaining": float(remaining_of(doc["amount"], legs)),
        "legs": legs,
        "batch_status": derive_batch_status(statuses),
    }


def _parse_targets(targets) -> list:
    """A JSON array of {target_doctype, target_name}. Refuses an empty list and a repeat.

    ⚠️ THE DUPLICATE CHECK IS HERE AS WELL AS IN THE DATABASE. The partial unique index would catch
    it, but as an IntegrityError after the first leg has already written money -- and the savepoint
    would then roll back a settlement the reviewer had every reason to expect.
    """
    if isinstance(targets, str):
        targets = frappe.parse_json(targets)
    if not targets:
        frappe.throw("Select at least one approved payment to allocate.", title="Nothing selected")
    parsed, seen = [], set()
    for target in targets:
        doctype = (target.get("target_doctype") or "").strip()
        name = (target.get("target_name") or "").strip()
        if doctype != PAYMENT_DOCTYPE:
            frappe.throw(
                f"Only {PAYMENT_DOCTYPE} can be allocated from one transfer. "
                f"Settle a '{doctype}' on its own.",
                title="Not a payment",
            )
        if not name:
            frappe.throw("A target payment is required.", title="Missing target")
        if name in seen:
            frappe.throw(f"{name} is selected twice.", title="Repeated record")
        seen.add(name)
        parsed.append({"target_doctype": doctype, "target_name": name})
    return parsed


def _load_allocatable_row(row: str):
    """Like `_load_settleable_row`, but a `Partially Allocated` row is ALLOWED through.

    ⚠️ THAT IS THE ONE DIFFERENCE, AND IT IS WHY THIS IS A SECOND FUNCTION RATHER THAN A FLAG ON
    THE FIRST. `_load_settleable_row` guards the ordinary settle, which must stay unable to reach a
    row that has already written money.
    """
    doc = frappe.db.get_value(ROW_DOCTYPE, row, "*", as_dict=True)
    if not doc:
        frappe.throw(f"Import row '{row}' not found.", title="Not found")
    if doc.get("row_status") == ROW_SETTLED:
        frappe.throw(
            "This transfer is fully allocated. Reverse an allocation to change it.",
            title="Fully allocated",
        )
    if doc.get("row_status") == ROW_SKIPPED:
        frappe.throw(
            "This row was skipped. Re-run the match to reconsider it.", title="Row skipped"
        )
    return _StagedRow(doc), doc


def _live_legs(row_name: str) -> list:
    """This row's Settled match records, oldest first. Always re-read, never cached across a leg."""
    return frappe.db.get_all(
        MATCH_DOCTYPE,
        filters={"import_row": row_name, "match_kind": MATCH_SETTLED},
        fields=["name", "target_doctype", "target_name", "target_amount", "match_kind"],
        order_by="matched_at asc, name asc",
    )


def _approved_payment_amount(name: str):
    """The payment's own figure, read BEFORE the lock so the fit can be judged.

    ⚠️ THIS IS NOT THE AUTHORITY. `settle_payment` re-reads it under `FOR UPDATE` and re-asserts
    everything; this read only decides whether to attempt the leg at all.
    """
    amount = frappe.db.get_value(PAYMENT_DOCTYPE, name, "amount")
    if amount is None:
        frappe.throw(f"Payment '{name}' not found.", title="Not found")
    return normalize_amount(amount)
```

Add `derive_batch_status` to the `review` import if it is not already there.

- [ ] **Step 8: Run everything**

```bash
docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack \
  frappe_docker_devcontainer-frappe-1 ../../env/bin/python \
  -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py" 2>&1 | tail -4
for m in test_allocate_row test_settle_payment test_expenses test_review; do
  docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
    bench --site localhost run-tests --app nirmaan_stack \
    --module nirmaan_stack.api.outflow_import.$m 2>&1 | tail -3
done
```

Expected: all OK. ⚠️ `test_settle_payment::TestRefusals` includes a case asserting the OLD UTR
refusal message (*"settled by hand in the payments screen"*). **Invert it** — assert the sibling
case is now allowed and the non-sibling case is still refused.

- [ ] **Step 9: Commit**

```bash
git add nirmaan_stack/services/outflow_import/reference_guard.py \
        nirmaan_stack/services/outflow_import/test_reference_guard.py \
        nirmaan_stack/services/outflow_import/settle.py \
        nirmaan_stack/api/payments/project_payments.py \
        nirmaan_stack/api/outflow_import/expenses.py \
        nirmaan_stack/api/outflow_import/test_allocate_row.py \
        nirmaan_stack/api/outflow_import/test_settle_payment.py
git commit -m "feat(outflow-import): allocate_row -- one transfer settles N payments atomically

One call, N targets, one savepoint: the legs are one decision about one transfer,
so partial success would leave a balance nobody can explain.

settle_row is BYTE-UNCHANGED and the screen still calls it for a single tick, so
every settle that worked before takes the identical path. Only allocate_row uses
the weaker guard (a leg must fit the REMAINDER, not equal the transfer); what
catches a wrong pick is that the row never reaches Settled.

rewrite_amount_to_bank=False is the load-bearing switch: the bank's figure is the
WHOLE transfer, so X1's rewrite would turn a Rs 55,819 payment into Rs 2,13,396.

The UTR guard moves to one shared reference_guard module used by BOTH the import
and the manual fulfil, narrowed to allow a sibling settled from the same transfer.
The raw bank reference lands on every leg -- decorating it would hide the payment
from tier 0 and from the re-import duplicate guard.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `reverse_allocation` — undo one leg

**Files:**
- Modify: `nirmaan_stack/api/outflow_import/expenses.py`
- Create: `nirmaan_stack/api/outflow_import/test_reverse_allocation.py`

**Interfaces:**
- Consumes: `allocation.MATCH_REVERSED`, `expenses._refresh_row_allocation` (Task 3); the partial unique index (Task 2).
- Produces: endpoint `expenses.reverse_allocation(match: str, reason: str)` returning `{"match", "row", "row_status", "allocated", "remaining"}`.

- [ ] **Step 1: Write the failing test**

Create `nirmaan_stack/api/outflow_import/test_reverse_allocation.py`:

```python
# Copyright (c) 2026, Nirmaan (Stratos Infra Technologies Pvt. Ltd.) and contributors
# See license.txt

"""Undoing one leg of an allocation (ADR-0020 D3/D4)."""

import frappe

from nirmaan_stack.api.outflow_import.expenses import allocate_row, reverse_allocation
from nirmaan_stack.api.outflow_import.test_allocate_row import AllocationFixture
from nirmaan_stack.services.outflow_import.status import (
    ROW_MATCHED,
    ROW_MISMATCHED,
    ROW_PARTIALLY_ALLOCATED,
    ROW_SETTLED,
)

MATCH_DOCTYPE = "Outflow Row Match"
ROW_DOCTYPE = "Outflow Import Row"


class TestReversingALeg(AllocationFixture):
    def _allocated(self, amount="100"):
        row = self._staged_row(amount=amount)
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        return row, pays

    def test_the_payment_returns_to_approved_with_no_utr(self):
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        reverse_allocation(match=leg, reason="wrong PO")
        self.assertEqual(frappe.db.get_value("Project Payments", a, "status"), "Approved")
        self.assertFalse((frappe.db.get_value("Project Payments", a, "utr") or "").strip())
        self.assertIsNone(frappe.db.get_value("Project Payments", a, "payment_date"))

    def test_the_record_is_kept_and_stamped(self):
        """SOFT reverse. The mistake stays auditable -- that is the whole difference from a delete."""
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        reverse_allocation(match=leg, reason="wrong PO")
        doc = frappe.db.get_value(
            MATCH_DOCTYPE, leg, ["match_kind", "reversed_by", "reversal_reason"], as_dict=True
        )
        self.assertEqual(doc.match_kind, "Reversed")
        self.assertEqual(doc.reversal_reason, "wrong PO")
        self.assertTrue(doc.reversed_by)

    def test_the_row_drops_from_settled_back_to_partially_allocated(self):
        row, (a, _, _) = self._allocated()
        self.assertEqual(frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED)
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        result = reverse_allocation(match=leg, reason="wrong PO")
        self.assertEqual(result["row_status"], ROW_PARTIALLY_ALLOCATED)
        self.assertEqual(float(result["remaining"]), 60.0)

    def test_reversing_every_leg_returns_the_row_to_an_open_status(self):
        row, pays = self._allocated()
        for p in pays:
            leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": p}, "name")
            result = reverse_allocation(match=leg, reason="all wrong")
        self.assertIn(result["row_status"], (ROW_MATCHED, ROW_MISMATCHED))
        self.assertEqual(float(result["allocated"]), 0.0)

    def test_the_same_payment_can_be_allocated_again_afterwards(self):
        """⚠️ THE PARTIAL UNIQUE INDEX EARNING ITS KEEP. With a plain unique key the reversed row
        would still hold (transfer, target) and this would fail with an IntegrityError."""
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        reverse_allocation(match=leg, reason="mis-clicked")
        allocate_row(row=row, targets=self._targets([a]))
        self.assertEqual(frappe.db.get_value("Project Payments", a, "status"), "Paid")
        self.assertEqual(
            frappe.db.get_value(ROW_DOCTYPE, row, "row_status"), ROW_SETTLED
        )
        # Both records survive: one Reversed, one Settled.
        self.assertEqual(
            frappe.db.count(MATCH_DOCTYPE, {"import_row": row, "target_name": a}), 2
        )


class TestRefusals(AllocationFixture):
    def test_a_reason_is_required(self):
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=leg, reason="   ")

    def test_an_already_reversed_leg_cannot_be_reversed_twice(self):
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        reverse_allocation(match=leg, reason="wrong PO")
        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=leg, reason="again")

    def test_a_payment_someone_else_changed_is_refused_and_writes_nothing(self):
        """The payment is no longer the one that was settled. Refuse rather than guess."""
        row, (a, _, _) = self._allocated()
        leg = frappe.db.get_value(MATCH_DOCTYPE, {"import_row": row, "target_name": a}, "name")
        frappe.db.set_value("Project Payments", a, "utr", "SOMEONE-ELSE")
        with self.assertRaises(frappe.ValidationError):
            reverse_allocation(match=leg, reason="wrong PO")
        self.assertEqual(
            frappe.db.get_value(MATCH_DOCTYPE, leg, "match_kind"), "Settled"
        )
```

- [ ] **Step 2: Run to verify it fails**

```bash
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
  bench --site localhost run-tests --app nirmaan_stack \
  --module nirmaan_stack.api.outflow_import.test_reverse_allocation 2>&1 | tail -15
```

Expected: `ImportError: cannot import name 'reverse_allocation'`.

- [ ] **Step 3: Write the endpoint**

```python
@frappe.whitelist(methods=["POST"])
def reverse_allocation(match: str, reason: str):
    """Undo one leg of an allocation. The match record is KEPT and stamped.

    URL: /api/method/nirmaan_stack.api.outflow_import.expenses.reverse_allocation

    ⚠️ SOFT, NOT A DELETE (ADR-0020 D3). A deleted record loses the fact that this was tried and
    undone, and that fact is the point of a table whose rows mean money was written. The reversed
    leg stops contributing to `allocated_of` and stops holding the partial unique key, so the same
    payment can be allocated again -- which is the ONLY reason the index had to become partial.

    ⚠️ A REASON IS REQUIRED. Same standard `skip_row` already holds: a decision that moves money
    has to say why. There is no system-generated case here, so unlike a skip there is no exemption.

    ⚠️ IT REFUSES A PAYMENT THAT CHANGED UNDERNEATH IT rather than forcing it back. If the utr or
    the status is not what this leg wrote, somebody else has touched the record and this function
    cannot know what they meant. Refusing leaves both halves consistent; guessing does not.
    """
    actor = require_outflow_access()
    reason = (reason or "").strip()
    if not reason:
        frappe.throw("A reason is required to reverse an allocation.", title="Missing reason")

    leg = frappe.db.get_value(
        MATCH_DOCTYPE,
        match,
        ["name", "import_row", "import_batch", "transfer_id", "target_doctype",
         "target_name", "match_kind"],
        as_dict=True,
    )
    if not leg:
        frappe.throw(f"Match record '{match}' not found.", title="Not found")
    if leg.match_kind != MATCH_SETTLED:
        frappe.throw(
            "This allocation was already reversed. A correction supersedes rather than un-happens.",
            title="Already reversed",
        )
    if leg.target_doctype != PAYMENT_DOCTYPE:
        frappe.throw(
            f"Only a {PAYMENT_DOCTYPE} allocation can be reversed here.", title="Not a payment"
        )

    row = frappe.db.get_value(
        ROW_DOCTYPE, leg.import_row, ["name", "bank_reference_no", "import_batch"], as_dict=True
    )

    savepoint = f"ofi_rev_{frappe.generate_hash(length=10)}"
    frappe.db.savepoint(savepoint)
    try:
        _revert_payment(leg.target_name, row.bank_reference_no, actor)
        doc = frappe.get_doc(MATCH_DOCTYPE, leg.name)
        doc.match_kind = MATCH_REVERSED
        doc.reversed_at = frappe.utils.now_datetime()
        doc.reversed_by = actor
        doc.reversal_reason = reason
        doc.save(ignore_permissions=True)
        new_status = _refresh_row_allocation(leg.import_row, actor)
    except Exception:
        frappe.db.rollback(save_point=savepoint)
        raise
    frappe.db.release_savepoint(savepoint)

    _refresh_batch_rollup(leg.import_batch)
    frappe.db.commit()

    legs = _live_legs(leg.import_row)
    amount = frappe.db.get_value(ROW_DOCTYPE, leg.import_row, "amount")
    return {
        "match": leg.name,
        "row": leg.import_row,
        "row_status": new_status,
        "allocated": float(allocated_of(legs)),
        "remaining": float(remaining_of(amount, legs)),
    }


def _revert_payment(name: str, expected_reference: str, actor: str) -> None:
    """Put the payment back to Approved, under a row lock, only if it still looks like ours.

    ⚠️ `doc.save()`, NOT `db.set_value`. The status is going `Paid -> Approved`, which is exactly
    the transition `update_parent_amount_paid` watches -- and it SUMS the Paid payments rather than
    incrementing, so the PO's `amount_paid` self-corrects with no code here. A `set_value` would
    fire no hooks and leave the parent claiming money that is no longer paid.

    ⚠️ THE AMOUNT IS NOT RESTORED, because the allocation path never changed it
    (`rewrite_amount_to_bank=False`). If a future path ever does rewrite an allocated leg's amount,
    this function needs the pre-settle figure stored on the match record -- it is not stored today,
    and that is a deliberate consequence of the no-rewrite rule rather than an oversight.
    """
    current = frappe.db.get_value(
        PAYMENT_DOCTYPE, name, ["status", "utr"], as_dict=True, for_update=True
    )
    if not current:
        frappe.throw(f"Payment '{name}' not found.", title="Not found")
    if (current.get("status") or "").strip() != "Paid":
        frappe.throw(
            f"{name} is '{current.get('status')}', not Paid. Somebody has already changed it.",
            title="Changed elsewhere",
        )
    stored = (current.get("utr") or "").strip()
    if stored and stored != (expected_reference or "").strip():
        frappe.throw(
            f"{name} carries reference '{stored}', not this transfer's. Somebody has re-pointed "
            f"it, so this allocation cannot be safely reversed.",
            title="Changed elsewhere",
        )

    doc = frappe.get_doc(PAYMENT_DOCTYPE, name)
    doc.status = "Approved"
    doc.utr = None
    doc.payment_date = None
    doc.flags.from_outflow_import = True
    with _outflow_import_write():
        doc.save(ignore_permissions=True, ignore_version=False)
```

Import `_outflow_import_write` from `services.outflow_import.settle` alongside the existing names.

- [ ] **Step 4: Run to verify it passes, and re-run the suites**

```bash
for m in test_reverse_allocation test_allocate_row test_settle_payment test_expenses test_review; do
  docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
    bench --site localhost run-tests --app nirmaan_stack \
    --module nirmaan_stack.api.outflow_import.$m 2>&1 | tail -3
done
```

- [ ] **Step 5: Commit**

```bash
git add nirmaan_stack/api/outflow_import/expenses.py \
        nirmaan_stack/api/outflow_import/test_reverse_allocation.py
git commit -m "feat(outflow-import): reverse_allocation -- undo one leg, keep the record

Soft reverse: the match record is stamped Reversed rather than deleted, so the
mistake stays auditable. It stops contributing to allocated_of AND stops holding
the partial unique key, so the same payment can be allocated again.

The payment goes Paid -> Approved through doc.save(), which is the transition
update_parent_amount_paid watches -- and it SUMS rather than increments, so the
PO self-corrects with no code here.

A payment somebody else re-pointed is REFUSED, not forced back.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The reads that go silently wrong

**Files:**
- Modify: `nirmaan_stack/services/outflow_import/ledgers.py:174-211`
- Modify: `nirmaan_stack/api/outflow_import/review.py:1853, 1896-1917, 2018, 2403-2405, 3052-3110`
- Modify: `frontend/src/types/NirmaanStack/OutflowImportBatch.ts:187, 202-203`
- Modify: `frontend/src/pages/outflow-import/outflowTableModel.ts:416`, `outflowExport.ts:81-94`
- Modify: `nirmaan_stack/api/outflow_import/test_review.py`

**Interfaces:**
- Consumes: fan-out match rows (Tasks 4-5).
- Produces: row payload key `settled_ledgers: string[]` (**replacing** the scalar `settled_ledger`); export keys `settled_target_names: string`, `settled_target_amounts: string` (**replacing** the two scalars).

⚠️ **Three independent `LIMIT 1` subqueries, none with an `ORDER BY`.** On a fan-out they can each
pick a *different* leg, so one CSV line could carry PAY-053's name beside PAY-057's amount — worse
than picking one leg consistently. **Follow the `settled_by_ledger` precedent: replace the scalar
keys rather than widening them in place**, so a stale reader gets `undefined` and renders nothing
(*"the intended loud failure"*, `review.py:3034-3037`).

⚠️ **`_row_filters` cannot grow a JOIN.** It has **six callers and nine statements** and returns
single-table fragments against alias `r`. The fan-out-correct filter is an **`EXISTS`** subquery,
which drops into a WHERE fragment without touching anybody's FROM clause.

- [ ] **Step 1: Write the failing tests**

Add to `nirmaan_stack/api/outflow_import/test_review.py`:

```python
class TestTheSettledReadsSurviveAFanOut(AllocationFixture):
    """⚠️ EVERY FAILURE IN THIS AREA IS SILENT -- a wrong number on a screen, never an exception.
    These tests are the only thing that can see it."""

    def test_a_fan_out_row_reports_every_ledger_it_settled_into(self):
        row = self._staged_row(amount="100")
        allocate_row(row=row, targets=self._targets(self._three_payments()))
        page = get_outflow_rows(scope="all", search=row)
        payload = next(r for r in page["rows"] if r["name"] == row)
        self.assertEqual(payload["settled_ledgers"], ["Project Payments"])

    def test_the_scalar_settled_ledger_key_is_GONE(self):
        """Replaced, not widened. A stale reader must get `undefined` and render nothing rather
        than one arbitrarily-picked leg -- the disposition `settled_by_ledger` established."""
        row = self._staged_row(amount="100")
        allocate_row(row=row, targets=self._targets(self._three_payments()))
        page = get_outflow_rows(scope="all", search=row)
        payload = next(r for r in page["rows"] if r["name"] == row)
        self.assertNotIn("settled_ledger", payload)

    def test_the_ledger_facet_never_hides_a_row_matching_its_own_label(self):
        """⚠️ THE WORST SHAPE AVAILABLE, in review.py's own words: a filter that hides rows
        matching the label it was ticked from looks like it worked."""
        row = self._staged_row(amount="100")
        allocate_row(row=row, targets=self._targets(self._three_payments()))
        page = get_outflow_rows(
            scope="all", facets=json.dumps({"settled_ledger": ["Project Payments"]})
        )
        self.assertIn(row, [r["name"] for r in page["rows"]])

    def test_the_export_lists_every_leg_rather_than_one(self):
        row = self._staged_row(amount="100")
        pays = self._three_payments()
        allocate_row(row=row, targets=self._targets(pays))
        rows = export_outflow_rows(scope="all", search=row)["rows"]
        payload = next(r for r in rows if r["name"] == row)
        for p in pays:
            self.assertIn(p, payload["settled_target_names"])
        self.assertNotIn("settled_target_name", payload)

    def test_the_export_and_the_screen_agree_on_how_many_transfers_there_are(self):
        """A JOIN here would multiply the row out. The subquery shape is what prevents it."""
        row = self._staged_row(amount="100")
        allocate_row(row=row, targets=self._targets(self._three_payments()))
        screen = get_outflow_rows(scope="all", search=row)["total"]
        exported = len(export_outflow_rows(scope="all", search=row)["rows"])
        self.assertEqual(screen, exported)
```

- [ ] **Step 2: Run to verify they fail**

```bash
docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
  bench --site localhost run-tests --app nirmaan_stack \
  --module nirmaan_stack.api.outflow_import.test_review 2>&1 | tail -15
```

- [ ] **Step 3: Aggregate the three subqueries**

`ledgers.py` — replace `SETTLED_LEDGER_SQL` (208-211), keeping the surrounding comment block and
**rewriting its `LIMIT 1` paragraph**, which is now historical:

```python
# ⚠️ AN AGGREGATE, NOT `LIMIT 1` (changed at ADR-0020). One transfer may settle several payments,
# so `LIMIT 1` -- which had no `ORDER BY` -- would pick one leg arbitrarily and quietly mis-report
# the row. The previous note here asked the next reader to re-check the multi-match count before
# relying on it; that count is no longer zero, and this is the re-decision it asked for.
#
# STILL A SCALAR CORRELATED SUBQUERY, for the reason the rest of this comment gives: five reads
# share `_row_filters` (nine statements across six callers, in fact) and a JOIN would change the
# FROM clause of every one of them. `string_agg` keeps the result one value per row.
#
# REVERSED LEGS ARE EXCLUDED, matching `allocation.allocated_of`. A reversed settlement no longer
# landed anywhere, and reporting its ledger would claim money that is no longer there.
SETTLED_LEDGER_SQL = (
    "(SELECT string_agg(DISTINCT m.target_doctype, '|' ORDER BY m.target_doctype) "
    'FROM "tabOutflow Row Match" m '
    "WHERE m.import_row = r.name AND m.match_kind = 'Settled')"
)
```

`review.py` — the two export companions (1910-1917), same treatment, and **now with an explicit
`ORDER BY` so the two columns line up leg-for-leg**:

```python
# ⚠️ THE `ORDER BY` IS NOT COSMETIC. These two are INDEPENDENT subqueries, so without a shared,
# total ordering the names and the amounts on one CSV line could come from different legs -- which
# is worse than picking one leg consistently. `matched_at, name` is total because `name` is unique.
_SETTLED_NAME_SQL = (
    "(SELECT string_agg(m.target_name, ' | ' ORDER BY m.matched_at, m.name) "
    'FROM "tabOutflow Row Match" m '
    "WHERE m.import_row = r.name AND m.match_kind = 'Settled')"
)
_SETTLED_TARGET_AMOUNT_SQL = (
    "(SELECT string_agg(m.target_amount::text, ' | ' ORDER BY m.matched_at, m.name) "
    'FROM "tabOutflow Row Match" m '
    "WHERE m.import_row = r.name AND m.match_kind = 'Settled')"
)
```

Rename the SELECT aliases at 2018 and 2403-2405 to `settled_ledgers`, `settled_target_names`,
`settled_target_amounts`, and split the pipe-joined ledger string into a list in the row-shaping
loop (`review.py` around 2040-2064):

```python
        # ⚠️ SPLIT INTO A LIST HERE, not on the client. The pipe is a transport detail of
        # `string_agg`; a client splitting it would be a second place that has to know the
        # separator, and the two would drift the day it changes.
        row["settled_ledgers"] = [
            part for part in (row.pop("settled_ledgers", "") or "").split("|") if part
        ]
```

- [ ] **Step 4: Make the facet fan-out-correct with `EXISTS`**

In `_FACET_COLUMNS` (1853) `settled_ledger` can no longer be an expression shared between the
filter and the DISTINCT, because the filter must now ask "does ANY leg land in this ledger?".
Give it a dedicated branch in `_row_filters` (around 2162-2165):

```python
    if column == "settled_ledger":
        # ⚠️ `EXISTS`, NOT A COMPARISON AGAINST THE AGGREGATE. A row settling into two ledgers
        # would never equal either label, so ticking one would HIDE it -- a filter that hides rows
        # matching the label it was ticked from is the worst shape available, because it looks like
        # it worked. `EXISTS` also keeps `_row_filters` single-table: it is a WHERE fragment, so
        # none of the nine statements built from this function grows a JOIN.
        placeholders = ", ".join(["%s"] * len(chosen))
        where.append(
            f'EXISTS (SELECT 1 FROM "tabOutflow Row Match" m '
            f"WHERE m.import_row = r.name AND m.match_kind = 'Settled' "
            f"AND m.target_doctype IN ({placeholders}))"
        )
        params.extend([str(v) for v in chosen])
    else:
        ... existing branch unchanged ...
```

and give `get_outflow_facet_values` its own DISTINCT for this column, over the match table rather
than over the aggregate string.

⚠️ **`ofm_match_import_row_idx` is what makes both of these affordable.** Verify it exists on the
target database (Task 2 wired the patch that guarantees it).

- [ ] **Step 5: Decide `_settled_by_direction` — the open item**

`review.py:3052-3136` sums `r.amount` (the ROW's amount) so its two block totals reconcile against
`settled_value`. A `Partially Allocated` row is now excluded from **both** blocks and from
`settled_value`, and it is inside `open_value` (Task 1) — **so the band still reconciles, and the
minimum correct change here is none.**

Add a test pinning exactly that, rather than changing the query:

```python
    def test_a_partly_allocated_transfer_is_reported_as_open_not_as_settled(self):
        """⚠️ THE RECONCILIATION IS PRESERVED BY DOING NOTHING HERE. `_settled_by_direction` sums
        ROW amounts and filters `row_status = 'Settled'`, so a partly-allocated transfer is in
        neither block -- and Task 1 put it inside `open_value`, so `Total = Settled + Still open`
        still adds up. Its own docstring predicted this exact slice ("green everywhere, until the
        first partial settlement quietly makes a breakdown stop adding up"); this is the test that
        answers it.

        THE COST, STATED: the money already written against a partly-allocated transfer is reported
        as open. That is the honest reading -- the TRANSFER is not settled -- but it means the
        settled figure understates what has been paid. Reporting it per-leg would need
        `SUM(m.target_amount)`, which breaks the reconciliation. Deferred deliberately.
        """
        row = self._staged_row(amount="100")
        a, _, _ = self._three_payments()
        allocate_row(row=row, targets=self._targets([a]))
        summary = get_outflow_summary(batch=frappe.db.get_value(ROW_DOCTYPE, row, "import_batch"))
        self.assertEqual(summary["settled_rows"], 0)
        self.assertEqual(summary["open_rows"], 1)
        self.assertEqual(
            summary["total_rows"], summary["settled_rows"] + summary["open_rows"]
        )
```

- [ ] **Step 6: Update the frontend types and readers**

`frontend/src/types/NirmaanStack/OutflowImportBatch.ts`:

```typescript
    /** Every ledger this transfer settled into. Was a scalar `settled_ledger` before ADR-0020;
     *  RENAMED rather than widened so a stale reader fails visibly. Empty on an unsettled row. */
    settled_ledgers?: string[];
    /** EXPORT-ONLY, pipe-separated in leg order. */
    settled_target_names?: string;
    settled_target_amounts?: string;
```

`outflowTableModel.ts:416` — the Ledger column reads the list:

```typescript
    { id: "settled_ledger", title: "Ledger",
      get: (r) => (r.settled_ledgers ?? []).join(", "),
      filter: "facet", width: "150px" },
```

`outflowExport.ts:81-94` — rename the two export columns to the plural keys.

- [ ] **Step 7: Run everything**

```bash
docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack \
  frappe_docker_devcontainer-frappe-1 ../../env/bin/python \
  -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py" 2>&1 | tail -4
for m in test_review test_allocate_row test_reverse_allocation test_expenses; do
  docker exec -w /workspace/development/frappe-bench frappe_docker_devcontainer-frappe-1 \
    bench --site localhost run-tests --app nirmaan_stack \
    --module nirmaan_stack.api.outflow_import.$m 2>&1 | tail -3
done
cd frontend && yarn test 2>&1 | tail -10
```

- [ ] **Step 8: Commit**

```bash
git add nirmaan_stack/services/outflow_import/ledgers.py \
        nirmaan_stack/api/outflow_import/review.py \
        nirmaan_stack/api/outflow_import/test_review.py \
        frontend/src/types/NirmaanStack/OutflowImportBatch.ts \
        frontend/src/pages/outflow-import/outflowTableModel.ts \
        frontend/src/pages/outflow-import/outflowExport.ts
git commit -m "fix(outflow-import): the three LIMIT 1 settled reads become aggregates

None of them had an ORDER BY, so on a fan-out the ledger, the settled record name
and the settled amount on one CSV line could each come from a different leg.

The scalar keys are REPLACED, not widened -- a stale reader now gets undefined
and renders nothing, the same loud failure settled_by_ledger established.

The ledger facet becomes an EXISTS subquery: comparing against the aggregate
would hide a two-ledger row from BOTH labels it belongs to, and EXISTS keeps
_row_filters single-table across its six callers and nine statements.

_settled_by_direction is deliberately UNCHANGED -- a partly-allocated row is in
open_value, so Total = Settled + Still open still reconciles. Pinned by test,
with the cost stated.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The screen

**Files:**
- Modify: `frontend/src/pages/outflow-import/components/SettleableRecordTable.tsx:161, 285-297`
- Modify: `frontend/src/pages/outflow-import/outflowTableModel.ts:174-180` (`RowDecision`), `:2006-2024` (`isConfirmable`)
- Modify: `frontend/src/pages/outflow-import/components/DecisionDialog.tsx:819-1146`
- Modify: `frontend/src/pages/outflow-import/OutflowMasterPage.tsx:286-330, 412-459`
- Create: `frontend/src/pages/outflow-import/allocationView.ts` + `allocationView.test.ts`

**Interfaces:**
- Consumes: `allocate_row`, `reverse_allocation` (Tasks 4-5); `settled_ledgers` (Task 6).
- Produces: `RowDecision.linkTargets: ReadonlySet<string>` (recordKeys) **replacing** `linkTo`; pure helpers `allocationBar`, `chooseSettleEndpoint`, `allocateButtonLabel`.

⚠️ **There is NO DOM test environment** (`frontend/CLAUDE.md`). Anything that is a React *semantic*
is structurally untestable here. So the arithmetic and the endpoint choice go into a **pure**
`allocationView.ts` with real unit tests, and the component work is verified by a **live browser
A/B** — revert, reproduce, restore, re-verify — not by a green suite.

- [ ] **Step 1: Write the failing pure tests**

Create `frontend/src/pages/outflow-import/allocationView.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
    allocateButtonLabel,
    allocationBar,
    chooseSettleEndpoint,
} from "./allocationView";

const leg = (amount: number) => ({ target_amount: amount, match_kind: "Settled" });

describe("allocationBar", () => {
    it("reports the whole transfer as remaining when nothing is allocated", () => {
        expect(allocationBar(213396, [], [])).toEqual({
            allocated: 0, remaining: 213396, over: false, complete: false,
        });
    });

    it("counts already-allocated legs and the current ticks together", () => {
        const bar = allocationBar(213396, [leg(55819), leg(5310)], [63720, 33268]);
        expect(bar.allocated).toBe(158117);
        expect(bar.remaining).toBe(55279);
        expect(bar.over).toBe(false);
    });

    it("ignores a reversed leg", () => {
        const legs = [leg(55819), { target_amount: 5310, match_kind: "Reversed" }];
        expect(allocationBar(213396, legs, []).allocated).toBe(55819);
    });

    it("flags an over-tick without refusing to compute it", () => {
        // ⚠️ Over-ticking is ALLOWED; the BUTTON is what disables. Disabling the rows instead
        // makes it a puzzle -- the reviewer may want to untick something else first.
        const bar = allocationBar(100, [], [60, 30, 20]);
        expect(bar.over).toBe(true);
        expect(bar.remaining).toBe(-10);
    });

    it("is complete inside the same +/- 5 window the server uses", () => {
        expect(allocationBar(100, [], [98]).complete).toBe(true);
        expect(allocationBar(100, [], [95]).complete).toBe(true);
        expect(allocationBar(100, [], [94]).complete).toBe(false);
    });
});

describe("chooseSettleEndpoint", () => {
    it("uses settle_row for a single tick on an untouched row", () => {
        // ⚠️ THE SAFETY RULE. Every settle that worked before ADR-0020 keeps the identical path,
        // including its STRICTER amount guard.
        expect(chooseSettleEndpoint({ ticks: 1, rowStatus: "Matched" })).toBe("settle_row");
        expect(chooseSettleEndpoint({ ticks: 1, rowStatus: "Mismatched" })).toBe("settle_row");
    });

    it("uses allocate_row for two or more ticks", () => {
        expect(chooseSettleEndpoint({ ticks: 2, rowStatus: "Matched" })).toBe("allocate_row");
    });

    it("uses allocate_row for a single tick on an already-allocated row", () => {
        // settle_row would refuse it: _load_settleable_row does not admit this status.
        expect(
            chooseSettleEndpoint({ ticks: 1, rowStatus: "Partially Allocated" }),
        ).toBe("allocate_row");
    });

    it("chooses nothing when nothing is ticked", () => {
        expect(chooseSettleEndpoint({ ticks: 0, rowStatus: "Matched" })).toBeNull();
    });
});

describe("allocateButtonLabel", () => {
    it("names the count of records, not the money", () => {
        expect(allocateButtonLabel({ ticks: 2, complete: false })).toBe("Allocate 2 records");
        expect(allocateButtonLabel({ ticks: 1, complete: false })).toBe("Allocate 1 record");
    });

    it("says so when the tick-set finishes the transfer", () => {
        expect(allocateButtonLabel({ ticks: 2, complete: true })).toBe(
            "Allocate 2 records · completes this transfer",
        );
    });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd frontend && yarn vitest run src/pages/outflow-import/allocationView.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `allocationView.ts`**

```typescript
// src/pages/outflow-import/allocationView.ts
//
// PURE MODULE -- no React, no fetching. The screen's half of the allocation arithmetic
// (ADR-0020), and the rule for which endpoint a confirm should call.
//
// ⚠️ THE SERVER IS THE AUTHORITY. It re-reads every leg under a row lock and re-asserts the fit.
// This exists so the balance bar can move as the reviewer ticks, without a round trip.
//
// ⚠️ IT MIRRORS `services/outflow_import/allocation.py` AND MUST NOT BE STRICTER THAN IT. The
// same rule the TDS band mirror already carries: erring toward OFFERING is safe, because the
// server re-asserts; erring the other way hides a choice the server would have accepted.

/** Mirrors `amounts.AMOUNT_TOLERANCE`. ⚠️ The ONLY copy on this side -- do not inline it again. */
export const AMOUNT_TOLERANCE = 5;

export interface AllocationLeg {
    target_amount: number;
    match_kind: string;
}

export interface AllocationBar {
    allocated: number;
    remaining: number;
    over: boolean;
    complete: boolean;
}

/** What is allocated once these ticks are added to what is already banked. */
export function allocationBar(
    rowAmount: number,
    legs: readonly AllocationLeg[],
    tickedAmounts: readonly number[],
): AllocationBar {
    const banked = legs
        .filter((leg) => leg.match_kind === "Settled")
        .reduce((sum, leg) => sum + (leg.target_amount || 0), 0);
    const ticked = tickedAmounts.reduce((sum, amount) => sum + (amount || 0), 0);
    const allocated = banked + ticked;
    const remaining = rowAmount - allocated;
    return {
        allocated,
        remaining,
        over: remaining < -AMOUNT_TOLERANCE,
        complete: Math.abs(remaining) <= AMOUNT_TOLERANCE,
    };
}

/**
 * Which endpoint a confirm should call.
 *
 * ⚠️ THE SAFETY RULE OF THE WHOLE SLICE. A single tick on an untouched row keeps going to
 * `settle_row`, which is byte-unchanged and carries the STRICTER guard (the record must equal the
 * whole transfer). So every settle that worked before ADR-0020 takes the identical code path, and
 * the weaker remainder-bounded guard is reachable only on the new shape.
 */
export function chooseSettleEndpoint({
    ticks,
    rowStatus,
}: {
    ticks: number;
    rowStatus: string;
}): "settle_row" | "allocate_row" | null {
    if (ticks <= 0) return null;
    if (ticks > 1) return "allocate_row";
    return rowStatus === "Partially Allocated" ? "allocate_row" : "settle_row";
}

export function allocateButtonLabel({
    ticks,
    complete,
}: {
    ticks: number;
    complete: boolean;
}): string {
    const noun = ticks === 1 ? "record" : "records";
    const base = `Allocate ${ticks} ${noun}`;
    return complete ? `${base} · completes this transfer` : base;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd frontend && yarn vitest run src/pages/outflow-import/allocationView.test.ts
```

- [ ] **Step 5: Turn the picker into a checkbox group**

`SettleableRecordTable.tsx`:

```tsx
// line 161
<tbody role="group" aria-label="Approved records to allocate">
```

```tsx
// lines 285-297 -- one checkbox per row, no shared `name`
<input
    type="checkbox"
    checked={selected.has(recordKey(record))}
    onChange={() => onToggle(recordKey(record))}
    aria-label={`Allocate ${record.name}`}
/>
```

`outflowTableModel.ts` — `RowDecision` (174-180):

```typescript
export interface RowDecision {
    target?: DecisionTarget;
    /** ⚠️ REPLACES `linkTo: string | null` (ADR-0020). A Set of recordKeys, so the same
     *  `recordKey`/`parseRecordKey` pair already used everywhere stays the one identity function.
     *  An EMPTY set is "nothing picked"; ABSENT is "never touched" -- `seedDecisions` relies on the
     *  distinction to avoid overwriting a deliberately-cleared decision. */
    linkTargets?: ReadonlySet<string>;
    newExpense?: { /* unchanged */ };
    newInflow?: { /* unchanged */ };
    newReceipt?: { /* unchanged */ };
}
```

Update `isConfirmable`, `seedDecisions` and `suggestedDecision` to read `linkTargets` (a
one-element Set where they read a single `linkTo`), and add `ROW_PARTIALLY_ALLOCATED` to
`isConfirmable`'s allowed statuses — it is not in `OPEN_ROW_STATUSES`, so the existing gate at
line 2010 would refuse it.

- [ ] **Step 6: Build the dialog**

In `DecisionDialog.tsx`, above `LinkPaymentSection`, add an **Already allocated** block listing the
row's Settled legs (from `get_row_allocation`, or the `legs` returned by the last write) with a
`Reverse` action per leg that opens a small confirm requiring a typed reason.

Below the picker, render the balance bar from `allocationBar(...)`. Three rules:

```tsx
{/* ⚠️ OVER-TICKING IS ALLOWED AND THE BUTTON IS WHAT DISABLES. Disabling the rows instead makes
    it a puzzle: the reviewer may want to untick something else first. */}
<div className={bar.over ? "text-red-600" : "text-muted-foreground"}>
    allocated {formatAmount(bar.allocated)} · left {formatAmount(bar.remaining)}
</div>
...
<Button disabled={busy || bar.over || ticks === 0}>
    {allocateButtonLabel({ ticks, complete: bar.complete })}
</Button>
```

`OutflowMasterPage.tsx` — add the two postcalls beside the existing ones (286-330):

```typescript
const { call: allocateRow } = useFrappePostCall(
    "nirmaan_stack.api.outflow_import.expenses.allocate_row",
);
const { call: reverseAllocation } = useFrappePostCall(
    "nirmaan_stack.api.outflow_import.expenses.reverse_allocation",
);
```

and route the confirm through `chooseSettleEndpoint`, **never an inline condition** — the rule has
one home so a later edit cannot send a single tick down the weaker path.

- [ ] **Step 7: Verify in a live browser — the honest verification**

⚠️ `frontend/CLAUDE.md`: *"anything whose correctness is a React semantic is STRUCTURALLY
untestable here… the honest verification is a live browser A/B."*

Walk it: `yarn dev` (:8080 — **not :8000, which serves a stale build**), open
`/bulk-import-transactions`, and confirm each of:

1. Tick two payments → the bar sums both → **Allocate 2 records**.
2. Confirm → the row moves to the **Partly Allocated** tab with a sky badge and a leftover balance.
3. Re-open it → the two legs appear under **Already allocated**; the picker no longer offers them.
4. Tick the rest → button reads **· completes this transfer** → the row lands on Matched / Settled.
5. Reverse one leg with a reason → the row returns to **Partly Allocated**, the balance rises, and
   that payment is offered in the picker again.
6. Press **Re-run match** while a row is partly allocated → **its legs survive** (this is the one
   that would have destroyed data).
7. Tick exactly one payment equal to the whole transfer on an untouched row → it still goes through
   `settle_row` (check the network tab).

- [ ] **Step 8: Run the whole suite and commit**

```bash
cd frontend && yarn test 2>&1 | tail -10 && yarn build 2>&1 | tail -5
```

```bash
git add frontend/src/pages/outflow-import/
git commit -m "feat(outflow-import): the allocation screen -- checkbox picker and a balance bar

The picker becomes a checkbox group and RowDecision.linkTo becomes linkTargets,
a Set of the recordKeys already used everywhere else.

Over-ticking is allowed and the BUTTON disables; disabling the rows instead makes
it a puzzle when the reviewer wants to untick something else first.

chooseSettleEndpoint has one home: a single tick on an untouched row still goes
to settle_row, so every settle that worked before takes the identical path.

Verified by a live browser A/B, not by the suite -- there is no DOM environment,
so a React semantic is structurally untestable here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** — every section of `frontend/.claude/plans/outflow-fanout-allocation-plan.md` maps
to a task: Part 1 → Task 1; Part 2 → Task 2; the derived numbers → Task 3; Part 3 → Tasks 4-5;
Part 4's three sharp edges → Task 4 (no-rewrite switch, weaker guard, shared UTR helper); Part 5 →
Task 6; Part 6 → Task 7; Part 7's slice order is this plan's task order.

**Corrections made to the spec while planning** — both are fixed above and should be folded back
into the design doc:

1. **The badge cannot be amber.** Amber is already `Mismatched`'s tone. Task 1 uses sky.
2. **`ofm_match_target_unique` is a table CONSTRAINT, not a bare index.** `DROP INDEX` fails on it,
   and `on_doctype_update` must stop calling `add_unique` or the next migrate re-adds the
   non-partial key beside the partial one. Task 2 handles both.

**Type consistency** — `MATCH_SETTLED`/`MATCH_REVERSED` are defined once (Task 3, `allocation.py`)
and imported everywhere; `_refresh_row_allocation(row_name, actor) -> str` has one signature across
Tasks 3-5; `linkTargets` replaces `linkTo` in Task 7 only, and Task 7 is the only consumer.

**Known gaps, stated rather than hidden:**

- `PaymentSettlementFixture` needs three new helpers (`_staged_row(amount=, direction=)`,
  `_approved_payment(amount)`, `_targets`). Task 4 Step 5 says so; they must be built from the
  fixture's existing scaffolding, not duplicated.
- `_settled_by_direction` is left unchanged **by decision**, with the cost written into a test
  docstring: money already written against a partly-allocated transfer is reported as open.
- No bulk allocation. `get_confirmable_rows` stays `Matched`-only.
- Expense and inflow ledgers are not allocatable. `Non Project Expenses` has no project column and
  an expense fan-out has never been observed; widening is a separate decision with its own evidence.
