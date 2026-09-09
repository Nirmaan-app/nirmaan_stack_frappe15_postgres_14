# Fan-out allocation — one transfer, many payments, allocated over time

**Status:** design approved 2026-09-09, not yet built.
**Decision record:** `docs/adr/0020-one-transfer-many-payments.md`
**Feature doc:** `.claude/context/domain/outflow-import.md` (read it first)
**Sibling plan:** `frontend/.claude/plans/outflow-partial-settle-plan.md` (the INVERSE problem —
one payment, several transfers. This plan does not change it.)

---

## The problem, in one picture

```
Bank transfer  Rs 2,13,396   UTR 429116657328   VEN-Material-0029   17-Oct-2024
  |
  +-- PAY-00017-053   Rs 55,819   PO/019/00017/24-25
  +-- PAY-00017-054   Rs  5,310   PO/020/00017/24-25
  +-- PAY-00017-055   Rs 63,720   PO/018/00017/24-25
  +-- PAY-00017-056   Rs 33,268   PO/001/00017/24-25
  +-- PAY-00017-057   Rs 47,208   PO/005/00017/24-25
  +-- PAY-00017-058   Rs  8,071   PO/024/00017/24-25
```

That is a real group from the live ledger. Today the screen cannot express it, and the
accountant records it by hand with the same raw UTR on all six.

---

## The model — a wallet, not a switch

```
Outflow Import Row  OFR-26-000123          amount  Rs 2,13,396
       |
       +-- Outflow Row Match -> PAY-053   Rs 55,819   Settled
       +-- Outflow Row Match -> PAY-054   Rs  5,310   Settled
       +-- Outflow Row Match -> PAY-057   Rs 47,208   Reversed   <- ignored by the SUM
                                          -----------
                       allocated           Rs 61,129
                       remaining           Rs 1,52,267
                       row_status          Partially Allocated
```

```
allocated  = SUM(target_amount) WHERE transfer_id = X AND match_kind = 'Settled'
remaining  = row.amount - allocated
row_status = 'Settled' if abs(remaining) <= AMOUNT_TOLERANCE else 'Partially Allocated'
```

`AMOUNT_TOLERANCE` is the existing +/- Rs 5 from `services/outflow_import/amounts.py`. **No new
constant** — that module refuses any `Decimal` constant declared outside it, by test.

**There is no leg counter, no group id and no completion flag.** The question "have all the
adjustments been made?" is answered by a BALANCE, never a CARDINALITY. An aggregate over an open
set needs no count, which is what makes an unbounded number of legs safe.

---

## Part 1 — Status vocabulary

### The new status is OPEN *and* FROZEN

That combination does not exist today; `open` and `frozen` are currently opposites.
`Partially Allocated` is the first status where money is written but work remains.

| Set | `Partially Allocated`? | If wrong |
|---|---|---|
| `_FROZEN_ROW_STATUSES` (`review.py:119`) | **YES** | `match_batch` reaches the row; `review.py:433` `frappe.db.delete`s every settlement record for it. **Silent data loss.** |
| `OPEN_ROW_STATUSES` (`status.py:196`) | **no** | four queries (`review.py:506,537,650,968`) would enrol it in cross-batch claim contention and stack pairing, silently re-shuffling other rows' suggestions |
| `TERMINAL_ROW_STATUSES` (`status.py:193`) | no | work remains |
| **`ACTIVE_ROW_STATUSES`** (new) | **YES** | the set meaning "still needs a human" |

### Edits

| File | Change |
|---|---|
| `services/outflow_import/status.py:164-196` | `ROW_PARTIALLY_ALLOCATED = "Partially Allocated"`; append to `ROW_STATUSES`; add to `_FROZEN`-side + the new `ACTIVE_ROW_STATUSES`; add to `__all__` (116-162) |
| `api/outflow_import/review.py:119` | `_FROZEN_ROW_STATUSES` gains it |
| `api/outflow_import/review.py:1029` | `skip_row` must refuse it too — today it guards `ROW_SETTLED` only, so a half-allocated row could be skipped, orphaning its matches |
| `api/outflow_import/review.py:1709-1727` | `_SCOPE_STATUSES` gains `SCOPE_PARTLY: (ROW_PARTIALLY_ALLOCATED,)`. `SCOPE_ALL` picks it up automatically (derived from `ROW_STATUSES`) |
| `doctype/outflow_import_row/outflow_import_row.json:231-237` | `row_status` Select gains the option; the field `description` gains a sentence |
| `services/outflow_import/status.py:709-729` `derive_batch_status` | **RED — see below.** Must read `ACTIVE_ROW_STATUSES`, not `OPEN_ROW_STATUSES` |
| `services/outflow_import/status.py:1013-1014` `open_rows` / `open_value` | must read `ACTIVE_ROW_STATUSES` too, or the summary's `Total = Settled + Still open` band stops reconciling |
| `services/outflow_import/status.py:1345-1361` `derive_batch_counters` | `settled_rows` must NOT count a partial — it is not settled |
| `services/outflow_import/status.py:1046` `decided_rows` | a half-allocated row counts 0% decided. Accepted; note it |
| `frontend/.../outflowImportStatus.ts:25-64,127-134` | mirror the constant, the sets, and **`ROW_STATUS_TONE`** — the fallback is grey, pixel-identical to `Pending match run`. ⚠️ **NOT amber: amber is already `Mismatched`'s tone** (`bg-amber-50 text-amber-700`), and two statuses sharing a tone is the same defect as no tone at all. Use **sky** (`bg-sky-50 text-sky-700`) |
| `frontend/.../outflowTableModel.ts:472-504` | a 4th tab `partlyAllocated` -> scope `partly`. `tabCountParts` (538-564) is UNTOUCHED |
| `frontend/.../OutflowRowsTable.tsx:701` | **stop hardcoding** `row.row_status === "Settled" \|\| === "Skipped"`; read `TERMINAL_ROW_STATUSES` |

### RED — a status in NEITHER set makes a batch read `Completed`

`derive_batch_status` (`status.py:717-728`) is:

```python
open_rows     = [s for s in statuses if s in OPEN_ROW_STATUSES]
terminal_rows = [s for s in statuses if s in TERMINAL_ROW_STATUSES]

if not open_rows:      return BATCH_COMPLETED      # <-- here
if terminal_rows:      return BATCH_PARTIALLY_SETTLED
return BATCH_IN_REVIEW
```

`Partially Allocated` is in NEITHER set, so a batch whose rows are all partially allocated gets
`open_rows == []` and returns **`Completed`** — and `batch_is_open` then returns `False`, dropping
the statement out of `match_period` forever. That is the "invisible exclusion" failure the
`batch_is_open` docstring says this feature keeps having to fix.

**The fix** — the "is there work left?" test reads the ACTIVE set, and the "has money landed?"
test gains the new status:

```python
active = [s for s in statuses if s in ACTIVE_ROW_STATUSES]          # OPEN u {Partially Allocated}
banked = [s for s in statuses
          if s in TERMINAL_ROW_STATUSES or s == ROW_PARTIALLY_ALLOCATED]

if not active:  return BATCH_COMPLETED
if banked:      return BATCH_PARTIALLY_SETTLED
return BATCH_IN_REVIEW
```

**Byte-identical on existing data**, because `ACTIVE == OPEN` until the first partial allocation
exists. Pin that with a test asserting the old fixtures derive unchanged.

The same substitution is needed at `status.py:1013-1014` (`open_rows` / `open_value`): a
partially-allocated row must count as STILL OPEN, or the summary panel's
`Total = Settled + Still open` band silently stops adding up.

### The parity pins will go red, deliberately

`test_status.TestVocabulary` (Python, line 134) and the
`"row status vocabulary (parity with services/outflow_import/status.py)"` block
(`outflowImportStatus.test.ts:37`) each spell the six statuses literally. **Both are in this
slice's blast radius and belong in its scope** — update them in the same commit, asserting the
new seven-status truth. That is the pin working, not breaking.

---

## Part 2 — `Outflow Row Match`

### Six new fields

| Field | Type | Purpose |
|---|---|---|
| `match_kind` | widen Select -> `Settled\nReversed` | the soft-reverse state |
| `reversed_at` | Datetime, read-only | audit |
| `reversed_by` | Data, read-only | audit |
| `reversal_reason` | Small Text | required by the ENDPOINT, not by the JSON (a JSON `reqd` would break the Settled insert path) |
| `target_project` | Link -> Projects, nullable | view-readiness: group a fan-out by project with no join |
| `target_vendor` | Link -> Vendors, nullable | same. Nullable because `Non Project Expenses` has neither |

**Not added, on purpose:**

- **No leg counter / group id.** `matched_at` + `name` already give a total order (`name` is
  unique), so "leg 1, leg 2, leg 3" is a SORT, not a stored number.
- **No `target_status`.** The payment's status is live; a copy is a second truth that goes stale.

### `target_project` / `target_vendor` are SNAPSHOTS, not derived fields

If the payment is later re-pointed to another project, this row keeps what was true when the
money was allocated. That is correct for an immutable audit record, and it is the same call the
ITM feature already made with `estimated_rate`. **Nothing may recompute them.**

### The immutability rule is NARROWED, not dropped

The controller docstring says the row is *"immutable once written -- a correction supersedes
rather than edits"*. A soft reverse edits it. The rule becomes:

> `match_kind` may go `Settled -> Reversed` **once, and never back**. Every other field stays
> immutable. Enforced in `OutflowRowMatch.validate()`.

`track_changes` stays `0` — these rows would flood the Version table, and the reversal stamp
IS the audit.

### Indexes

⚠️ **CORRECTED WHILE PLANNING: `ofm_match_target_unique` is a table CONSTRAINT, not a bare index.**
`frappe.db.add_unique` issues `ALTER TABLE ... ADD CONSTRAINT`, and `pg_indexes` renders a
constraint-backed index identically to a plain one — so **`DROP INDEX` fails on it**. Two
consequences: the patch must `ALTER TABLE ... DROP CONSTRAINT`, and **`on_doctype_update` must stop
calling `add_unique`**, or the next migrate silently re-adds the non-partial key beside the partial
one and a reversed-then-reallocated payment fails on the old constraint. The new index therefore
takes a NEW name so the two can never be confused.

```sql
-- 1. REPLACE the plain unique CONSTRAINT with a PARTIAL unique INDEX
ALTER TABLE "tabOutflow Row Match" DROP CONSTRAINT ofm_match_target_unique;
CREATE UNIQUE INDEX ofm_match_settled_target_unique
  ON "tabOutflow Row Match" (transfer_id, target_doctype, target_name)
  WHERE match_kind = 'Settled';

-- 2. NEW - "which transfer paid this payment?"
CREATE INDEX ofm_match_target_idx
  ON "tabOutflow Row Match" (target_doctype, target_name);
```

- **`frappe.db.add_unique` structurally cannot express this.** It issues
  `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE(...)`, and a PostgreSQL table CONSTRAINT can never be
  partial. Only `CREATE UNIQUE INDEX ... WHERE` can. Precedent to copy:
  `patches/v3_0/boq_commit_current_unique_guard.py` (HEAL, commit, then CONSTRAIN).
- **The heal step is a no-op on current data** — verified 2026-09-09: 0 import_rows hold more
  than one match. Clean migration.
- Index 2 is a genuine gap today: the unique index leads with `transfer_id`, so PostgreSQL
  **cannot** use it for a target-side lookup. Every reverse-lookup view is a seq scan.
- **EXPLICIT index names throughout** — PG index names are unique per SCHEMA and
  `CREATE INDEX IF NOT EXISTS` matches by NAME ONLY, so a generic name colliding with another
  table's index is a SILENT no-op.
- Add `ANALYZE "tabOutflow Row Match"` after creation (the `add_boq_read_indexes` step the
  outflow patches omit) — a brand-new index has no planner stats.

---

## Part 3 — Endpoints

### `allocate_row(row, targets)`

`targets = [{target_doctype, target_name}, ...]` — **one call, N targets, one savepoint.**
Not N calls: a half-landed tick-set leaves a remaining balance nobody can explain.

```
require_outflow_access()
_load_allocatable_row(row)          # accepts Matched | Mismatched | Partially Allocated
_guard_is_a_debit(doc)
targets = parse + dedupe
savepoint:
    remaining = row.amount - allocated_now()          # recomputed under lock, from source
    for target in targets:
        assert payment.amount <= remaining + AMOUNT_TOLERANCE
        settle_payment(..., rewrite=False)             # SEE THE RED FLAG BELOW
        insert Outflow Row Match  (+ target_project, target_vendor snapshots)
        remaining -= payment.amount
    assert remaining >= -AMOUNT_TOLERANCE              # no over-allocation
    _refresh_row_allocation(row)                       # recompute allocated -> row_status
commit
_link_statement_file_to_target(...)
```

### `reverse_allocation(match_name, reason)`

```
require_outflow_access()
assert match_kind == 'Settled'          # never un-reverse
reason must be non-blank                # mirrors skip_row
payment: Paid -> Approved, clear utr, clear payment_date
match:   match_kind -> Reversed, + reversed_at / reversed_by / reversal_reason
_refresh_row_allocation(row)            # remaining rises; Settled may drop to Partially Allocated
```

The partial unique index releases the key, so that payment CAN be re-allocated to this transfer
later. That is the entire reason D4 exists.

---

## Part 4 — Three sharp edges

### RED — `allocate_row` must NEVER call `rewrite_amount`

`settle_payment` rewrites the payment's amount to the BANK's figure (slice X1). On a fan-out the
bank figure is the WHOLE TRANSFER. Applying it to leg 1 rewrites PAY-053 from Rs 55,819 to
Rs 2,13,396 — a silent, catastrophic corruption that every existing test would stay green through.

**Rule: on the allocation path the payment keeps its own amount, always.** Paise gaps land in the
`remaining` tolerance instead. This re-accepts the pre-X1 behaviour for this path only, and must
be stated at the call site.

### AMBER — the per-leg amount guard is weaker, and that IS the feature

| | Guard |
|---|---|
| `settle_row` (unchanged) | `abs(payment.amount - transfer.amount) <= AMOUNT_TOLERANCE` |
| `allocate_row` (new) | `payment.amount <= remaining + AMOUNT_TOLERANCE` |

So a wildly wrong small payment is no longer refused at the tick. What catches it: the row never
reaches `Settled` and sits at `Partially Allocated` with a visible leftover balance forever.
**Visible, not silent.**

`settle_row` stays **byte-unchanged**, so every settle that works today keeps taking the identical
code path.

### AMBER — the UTR sibling check is ONE shared helper, used at BOTH sites

| Path | Site |
|---|---|
| import | `services/outflow_import/settle.py:755` `_assert_reference_is_free` |
| manual fulfil | `api/payments/project_payments.py:365` `_fulfil_payment` |

New rule: *refuse a UTR sitting on another payment — **unless** that payment is a `Settled`
sibling on the SAME `transfer_id`.*

**Both move together or they disagree**, and the failure is asymmetric: miss the manual site and a
human fulfilling by hand is refused on a UTR the import wrote thirty seconds earlier.

`Project Payments.utr` keeps the RAW bank reference on all N legs (ADR-0020 D2) — which is also
what accountants already do by hand, measured at 39 groups / 92 payments.

---

## Part 5 — The reads that break silently

**Nothing here fails loudly.** Every one is a wrong number on a screen.

| Read | File | Today | Under fan-out |
|---|---|---|---|
| `SETTLED_LEDGER_SQL` | `ledgers.py:208-211` | `LIMIT 1`, no `ORDER BY` | picks one leg arbitrarily; the `settled_ledger` funnel can HIDE a row matching the label it was ticked from |
| `_SETTLED_NAME_SQL` | `review.py:1910` | `LIMIT 1`, no `ORDER BY` | export only |
| `_SETTLED_TARGET_AMOUNT_SQL` | `review.py:1914` | `LIMIT 1`, no `ORDER BY` | export only |

The three subqueries are **independent**, so one CSV line could carry PAY-053's name beside
PAY-057's amount. Worse than picking one leg consistently.

**Disposition — follow the `settled_by_ledger` precedent:** when that key became wrong it was
**deleted, not patched**, so *"a stale reader now gets `undefined` and renders no breakdown, which
is the intended loud failure."* These three scalar keys are **replaced, not silently widened**.

**`_row_filters` cannot grow a JOIN.** It has **six callers and nine statements** (page, count,
tab counts, facet values, summary, export x2, confirmable x2, match_period) and returns
single-table fragments against alias `r`. Any fan-out-correct filter must be an **`EXISTS`**
subquery, which drops into a WHERE fragment without touching anybody's FROM clause.

**`_settled_by_direction` (`review.py:3052`) sums `r.amount`, NOT `m.target_amount`,** on purpose:
its block totals must reconcile against `settled_value`, which is a sum of ROW amounts. Its own
docstring predicts this exact slice — *"green everywhere, until the first partial settlement
quietly makes a breakdown stop adding up to the total above it."* A fan-out-correct ledger
breakdown needs a different reconciliation story, not a different SUM column.

**`_record_settlement` (`expenses.py:725`) overwrites `outcome_note`, `decided_at`, `decided_by`
and `settlement_origin` on every call.** Under incremental allocation the LAST leg wins and the
earlier legs' facts are discarded. `_refresh_row_allocation` must own these instead, writing a
fan-out-shaped note.

**The already-correct read to copy:** `get_batch_rows` (`review.py:1055-1067,1089`) fetches
batch-wide and buckets into `dict[str, list]`, then ships `"matches": [...]` per row. That is the
shape to generalise.

---

## Part 6 — The screen

### The picker: radio -> checkbox

| Now (`SettleableRecordTable.tsx`) | New |
|---|---|
| `<tbody role="radiogroup">` (:161) | `role="group"` |
| `<input type="radio" name="settleable-record">` (:285-297) | `<input type="checkbox">` |
| `RowDecision.linkTo: string \| null` (`outflowTableModel.ts:174-180`) | `linkTargets: ReadonlySet<recordKey>` |

`recordKey()` / `parseRecordKey()` already exist (`outflowTableModel.ts:2671,2675`) and yield
`"Project Payments|PAY-053"`. **Reuse them** — do not mint a second identity function.

### The dialog

```
+- OFR-26-000123 . VEN-Material-0029 . Rs 2,13,396 . 17-Oct-2024 ------+
| ref 429116657328   a/c ****4471   "NEFT VENDOR PAYMENT"              |
|                                                                       |
| -- Already allocated ---------------------------------------------    |
|   PAY-00017-053   PO/019   Rs 55,819   03-Sep 14:02   [ Reverse ]     |
|   PAY-00017-054   PO/020   Rs  5,310   03-Sep 14:02   [ Reverse ]     |
|                                                                       |
| -- Link approved records -----------------------------------------    |
|   [x] PAY-00017-055   PO/018   Rs 63,720   PUNE-PROJ-00017            |
|   [x] PAY-00017-056   PO/001   Rs 33,268   PUNE-PROJ-00017            |
|   [ ] PAY-00017-057   PO/005   Rs 47,208   PUNE-PROJ-00017            |
|   [ ] PAY-00017-058   PO/024   Rs  8,071   PUNE-PROJ-00017            |
|                                                                       |
|   ############........  allocated Rs 1,58,117 . left Rs 55,279        |
|                                                                       |
|                              [ Cancel ]  [ Allocate 2 records ]       |
+-----------------------------------------------------------------------+
```

Three rules for the balance bar:

1. **Over-ticking is ALLOWED; Confirm is not.** The bar turns red and the button disables.
   Disabling the ROWS instead makes it a puzzle — the reviewer may want to untick something else.
2. The bar counts ticks PLUS already-allocated legs, live, client-side.
3. `left Rs 0` flips the button label to `Allocate 2 records . completes this transfer`.

`Reverse` opens a small confirm requiring a **typed reason** — reversing money needs a why, the
same standard `skip_row` already holds.

### Which endpoint the screen calls

| Situation | Endpoint |
|---|---|
| exactly **1** tick, row is `Matched` / `Mismatched` | `settle_row` — **unchanged, strict guard** |
| **2+** ticks, **or** row is already `Partially Allocated` | `allocate_row` |
| expenses / inflows / bulk Confirm-all | `settle_row` — untouched |

Every settle that works today keeps the identical code path. New code runs only on the new shape.

### Memo safety

The `Row` component is `memo`'d and receives **its own booleans**, never the shared `Set`
(`OutflowRowsTable.tsx:164-169`). Same rule here: pass `allocated` / `remaining` as **per-row
numbers**, never a Map keyed by row name.

### Tabs

```
[ All ]  [ Not-Matched ]  [ Partly Allocated 3 ]  [ Matched / Settled ]
```

A 4th tab with its own scope. `tabCountParts` (`outflowTableModel.ts:538-564`) hard-splits the
Matched tab into exactly TWO chips, so folding the new status in there would make the chips stop
summing to the tab total — the precise defect that function was written to fix.

---

## Part 7 — Order of work

| # | Slice | Ships |
|---|---|---|
| 1 | **Status vocabulary** | the constant, the four sets, the Select option, the doctype description, both parity pins, the `OutflowRowsTable.tsx:701` de-hardcode. Nothing behaves differently yet |
| 2 | **Schema + indexes** | the 6 fields, the narrowed `validate()`, the partial unique index + `ofm_match_target_idx`, the heal-then-constrain patch, `ANALYZE`, and the `patches.txt` line |
| 3 | **`_refresh_row_allocation`** | the pure `allocated` / `remaining` / `row_status` deriver + its unit tests, plus taking `outcome_note` / `decided_*` ownership off `_record_settlement` |
| 4 | **`allocate_row`** | the endpoint, the shared UTR sibling helper at BOTH sites, the no-rewrite rule |
| 5 | **`reverse_allocation`** | the endpoint |
| 6 | **The reads** | replace the three `LIMIT 1` scalars; `EXISTS`-shape the `settled_ledger` facet; decide `_settled_by_direction`'s reconciliation story |
| 7 | **The screen** | checkbox picker, allocated list, balance bar, the 4th tab, the endpoint routing rule |

Slices 1-3 are inert by construction and can land ahead of the decision to ship the feature.

---

## Open items

- **`_settled_by_direction`'s reconciliation story** is genuinely unresolved. It sums ROW amounts
  so its blocks add up to `settled_value`; switching to `SUM(m.target_amount)` breaks that. A
  partially-allocated row's money currently appears in NEITHER block. Needs a decision in slice 6.
- **`patches.txt` has zero outflow lines** (verified 2026-09-09). All four existing outflow index
  patches are unwired, so `ofm_match_import_row_idx` may not exist in production even though the
  controller declares it. **Check `pg_indexes` on the production DB before slice 2.**
- **No bulk allocation.** `get_confirmable_rows` is `Matched`-only and stays that way. Allocating
  a fan-out is deliberately one row at a time.


---

## Implementation plan

`docs/superpowers/plans/2026-09-09-outflow-fanout-allocation.md` — 7 tasks, 61 TDD steps, written
against this document. Two corrections were found while writing it and are folded back in above:
the badge tone (amber was already taken by `Mismatched`) and the constraint-vs-index shape of the
unique key.
