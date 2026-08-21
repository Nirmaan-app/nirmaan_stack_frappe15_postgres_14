# Cashbook duplicate guard — one slice, three gaps

**Status: SHIPPED 2026-08-21** (slice CB-DUP). All three gaps closed. As-built now lives in
`.claude/context/domain/outflow-import.md` § "The Cashbook duplicate guard — TWO lookups, one
identity"; this file is kept as the record of what was found and why each call was made.

**Verification:** 504 tests green across the 8 affected suites (`test_duplicates` 34,
`test_cashbook` 37, `test_parser` 62, `test_cashbook_import` 31, `test_cashbook_rules` 13,
`test_upload` 39, `test_review` 180, `test_status` 108). Mutation-checked: stubbing `_already_booked`
to `{}` turns 4 tests red, including `2 != 1` on the second-expense count — so the guard is proven
to be doing the work, not merely present. Live DB verified clean afterwards (0 test leftovers;
2,594 / 718 expenses and 792 import rows, all unchanged).

**Two deviations from the plan below, both deliberate:**
1. **`SKIP_ALREADY_BOOKED` takes ONE placeholder, not two.** `find_prior_sighting` returns a single
   opaque label by contract; a two-placeholder message would have to split it on a separator, and a
   record name containing that separator would be silently truncated. The api layer composes
   `"<ledger> <name>"` because it is the layer that knows which ledger it queried.
2. **The in-file `seen` check was NOT moved onto the new helper.** It was, briefly, and then
   reverted: `parser.duplicate_transfer_ids` and the Cashfree `_stage_batch` marking key on the same
   exact triple, and the parser's own note says two of them disagreeing would call one pair of rows
   repeated in one surface and distinct in another. Widening all three is a separate slice.

**Scope ruling (owner, 2026-08-21):** the `payment_ref` check is folded IN. The key is the triple
**`payment_ref` + amount + `payment_date`**, so the corpus narrows before it is compared and the
comparison is exact.

**One sentence:** Cashbook's duplicate guard only ever asks *"did a previous import batch stage this
transfer?"*. It must also ask *"does an expense already exist for this transfer?"* — and both
questions must use the same identity, with the same missing-date fallback.

---

## What was found (measured on live data, 2026-08-21)

`api/outflow_import/cashbook.py:_already_imported` runs exactly one query, against
`tabOutflow Import Row`. It never reads `payment_ref` on either expense doctype. The import *writes*
that field on create (`cashbook.py:270`, `payment_ref=transfer_id`) and never reads it back.

```
Non Project Expenses carrying a wallet-style ref (OBO…):   25
   … created by this import:                                8
   … typed in BY HAND — invisible to the guard:            17   ← the hole
Project Expenses, same check:                                0
```

Those 17 are dated March–April. If a Cashbook statement covering those dates is uploaded, **all 17
become duplicate expenses, silently.** No live duplicate exists yet (all 25 refs are distinct), so
this is latent, not an incident.

**The triple is a sound key on the real data.** All 17 hand-entered rows carry a `payment_date`
(17/17), and it is the transaction date, not the entry date — entry trails it by 1–12 days. Decoding
each wallet id's own epoch-millis prefix into IST and comparing:

```
17/17 agree between the wallet id's own timestamp and the typed payment_date
```

Two of the 17 share an amount and a date (`544.87` on 2026-03-13) under different refs — so
amount+date alone would be ambiguous and ref+amount+date is not. That is the case for keeping all
three.

**Cost of the narrowing.** The whole unnarrowed pool is 701 rows (12 Project Expenses + 689 Non
Project). Filtering by `payment_ref IN (this statement's transfer ids)` returns **0** against the
current batch. A 137-row statement sends ≤137 ids.

**Also still true, and re-litigating it is out of scope:** re-uploading the same wallet statement IS
handled today. `_already_imported` queries every `Outflow Import Row` in a terminal `status_raw`, a
hit is planned as a skip, and `_cashbook_worker` only picks up rows still `Pending match run`.

---

## The three gaps

### Gap 1 — a missing date lets a statement import twice (severity: high)

`_already_imported` builds a plain `dict` on the exact triple and does a plain `in` lookup.
`candidates.find_earlier_batches_for_rows` — the Cashfree path — instead groups by
`(transfer_id, amount)` and applies `duplicates.dates_agree`, whose entire purpose is the
missing-date fallback: *a missing date is OUR failure to read the sheet, not evidence that the
transfer is a different one.*

Cashbook never calls it. One unreadable `Added On` on either side and the identities do not match,
so a second expense is created — the exact failure `dates_agree` exists to prevent.

### Gap 2 — the guard never looks at the expense ledgers (severity: high, now measured)

See "What was found". 17 real records.

⚠️ **And the docs claim otherwise.** Several notes call the `Outflow Row Match` unique constraint
`(transfer_id, target_doctype, target_name)` "the real backstop against paying twice". True for
**Cashfree**, which settles an existing record. **False for Cashbook**, which mints a new
`target_name` every time, so the key is never contended.

### Gap 3 — the wrong batch is named (severity: cosmetic)

`find_earlier_batches_for_rows` orders `creation ASC` so the batch it names is the earliest.
`_already_imported` has no `ORDER BY` and `setdefault`s whichever row Postgres hands back first, so
`Already imported in {batch}` may name a later one. Message only.

---

## Design

### D1 — ONE pure identity index, two corpora

Both questions are the same question over different tables. Add to
`services/outflow_import/duplicates.py`, beside the `row_identity` / `dates_agree` pair that already
owns "are these the same transfer":

```python
PriorSighting = (added_on_date: date | None, label: str)          # frozen dataclass

def index_prior_sightings(entries) -> dict[tuple[str, Decimal], tuple[PriorSighting, ...]]
def find_prior_sighting(index, transfer_id, amount, added_on_date) -> str | None
```

`entries` are `(transfer_id, amount, date|None, label)`. `find_prior_sighting` walks the bucket and
returns the **first** sighting whose date agrees under `dates_agree`.

- Grouping by `(transfer_id, amount)` and deciding the date separately is what fixes **Gap 1**.
- "First wins" plus an **earliest-first caller** is what fixes **Gap 3**, for free and in one place.
- It lives in `duplicates.py` because that module already owns this rule (ADR-0010 B1). Putting it in
  `cashbook.py` would make a third copy of a question that already has two.

⚠️ **Cashfree is NOT rewired onto it this slice.** `find_earlier_batches_for_rows` also narrows by
period, which Cashbook does not do; swapping it wholesale changes behaviour on a second axis. The
helper is shaped so it *could* later, and that is all.

### D2 — the amount stays EXACT

`normalize_amount` on both sides, `Decimal` equality, no tolerance. `row_identity`'s own note says
why: `AMOUNT_TOLERANCE` is the *settle* window, and at ₹5 two genuinely different ₹3 transfers would
collapse into one and the second would never import. `amounts.py` structurally refuses a fourth
`Decimal` constant declared outside it, so this cannot drift by accident.

### D3 — the date uses the SAME fallback on both corpora

`dates_agree`, symmetric. A NULL `payment_date` on a stored expense, or an unreadable `Added On` on
the incoming row, means "cannot compare on this axis" — not "different transfer". Measured cost
today: zero, since 17/17 carry a date.

### D4 — the corpus is narrowed in SQL, by ref

Two queries in `api/outflow_import/cashbook.py`, one per doctype, because the amount storage differs
and folding them would hide that:

```sql
-- Project Expenses: amount is a Data column of numeric STRINGS
SELECT name, BTRIM(payment_ref) AS ref,
       CAST(NULLIF(BTRIM(amount), '') AS numeric) AS amount, payment_date
FROM "tabProject Expenses"
WHERE BTRIM(COALESCE(payment_ref, '')) IN (%s, …)
  AND COALESCE(BTRIM(amount), '') <> ''
ORDER BY creation ASC

-- Non Project Expenses: amount is real Currency
SELECT name, BTRIM(payment_ref) AS ref, amount, payment_date
FROM "tabNon Project Expenses"
WHERE BTRIM(COALESCE(payment_ref, '')) IN (%s, …)
ORDER BY creation ASC
```

- **`ORDER BY creation ASC` is load-bearing**, not tidiness — it is the earliest-first contract D1
  depends on.
- The `amount <> ''` guard on the project side mirrors `candidates.load_expense_targets`. Verified
  safe today: **0** of 2,594 `Project Expenses` hold an amount that would break the cast.
- `payment_ref` is **not indexed** on either table. At 2,594 + 718 rows a seq scan is nothing.
  Revisit if `Non Project Expenses` passes ~100k.

### D5 — NO status filter, deliberately

Measured: **0** Approved and **0** Requested expenses carry any `payment_ref` at all, so a
`status = 'Paid'` filter narrows nothing today. And a non-Paid expense holding the ref is still a
booking — creating a second one is still a duplicate. A filter that costs nothing now and hides a
real duplicate later is not worth having.

### D6 — the skip order, and why

`plan_statement`'s note already says the order of the tests *is* the message. New order:

```
1  not a Wallet Spend        → "Moves money between our own balances, not a spend"
2  did not succeed           → "Did not succeed at the wallet"
3  amount <= 0               → "No amount was debited"
4  already imported          → "Already imported in {batch}"
5  already booked   ← NEW    → "Already booked as {ledger} {name}"
6  repeated in this file     → "The same transfer appears earlier in this file"
```

**4 before 5** because if an earlier batch created the expense then *both* are true, and the batch
name is the answer somebody can act on. **5 before 6** because naming the existing record tells the
reader more than "it's further up this sheet".

New constant `SKIP_ALREADY_BOOKED = "Already booked as {ledger} {name}"`. Per-record strings are
fine here: `_preview_payload["skipped"]` is a flat per-row list and `CashbookReviewTree.tsx:133`
renders `row.reason` verbatim — there is no group-by-reason to split.

### D7 — `assess_duplicates` is NOT touched (decision, flag if you disagree)

An already-booked row does not count toward the refuse/warn ratio this slice.

Reasoning: `DUPLICATE_WARN_RATIO` is an explicit owner ruling ("say a different number and it
moves"), and its message vocabulary is "already imported *in batch X*" — which is wrong for a row
somebody booked by hand outside the import. The rows still stage and skip with an exact message, so
nothing is lost; only the whole-file refusal is unaffected.

Overrule this if a mostly-hand-booked statement shows up in practice — the change is then to teach
`assess_duplicates` a second vocabulary, not to reuse the first one.

### D8 — the pure/impure line holds

`services/outflow_import/cashbook.py` stays pure: `plan_statement` gains one more `Mapping` param
(`already_booked`), defaulted to `None` exactly as `already_imported` is, so every existing caller
and test keeps working. All SQL lives in `api/outflow_import/cashbook.py`, in a new `_already_booked`
beside `_already_imported`, both feeding `_build_plan`.

---

## Files touched

| File | Change |
|---|---|
| `services/outflow_import/duplicates.py` | ADD `PriorSighting`, `index_prior_sightings`, `find_prior_sighting`. `row_identity` / `dates_agree` / `assess_duplicates` / `DUPLICATE_WARN_RATIO` **unchanged**. |
| `services/outflow_import/cashbook.py` | ADD `SKIP_ALREADY_BOOKED`; `plan_statement(..., already_booked=None)`; `_skip_reason` gains test 5 and moves to `find_prior_sighting` for test 4. |
| `api/outflow_import/cashbook.py` | ADD `_already_booked(parsed)`; `_already_imported` rewritten onto `index_prior_sightings` (+ `ORDER BY creation ASC`); `_build_plan` passes both. |
| `services/outflow_import/test_duplicates.py` | +6 |
| `services/outflow_import/test_cashbook.py` | +5 |
| `api/outflow_import/test_cashbook_import.py` | +6 |
| `.claude/context/domain/outflow-import.md` | Rewrite the gaps section as as-built; scope-mark the line-1617 "backstop" sentence as Cashfree-only. |

**No schema change. No doctype JSON. No `bench migrate`. No patch. No frontend change.**

## Tests owed

**Pure — `test_duplicates.py`**
1. exact triple hits
2. stored date NULL + incoming date → hit (Gap 1)
3. incoming NULL + stored date → hit (Gap 1, other side)
4. both NULL → hit
5. same id + date, different amount → miss (D2, no tolerance)
6. several agreeing sightings → the FIRST is returned (Gap 3)

**Pure — `test_cashbook.py`**
7. a booked transfer plans as a skip naming the ledger and record
8. imported AND booked → the imported message wins (D6)
9. booked AND repeated-in-file → the booked message wins (D6)
10. a genuinely new transfer still plans as create
11. the five skip reasons fire in the D6 order

**Integration — `test_cashbook_import.py`**
12. `_already_booked` finds a hand-created Non Project Expense on ref + amount + date
13. …misses when the amount differs by ₹1 (D2)
14. …finds a Project Expense despite the varchar amount (`'2935'` vs `Decimal("2935")`)
15. …returns `{}` when the statement carries no transfer ids (no empty `IN ()`)
16. `_already_imported` names the EARLIEST of two batches holding the same transfer (Gap 3)
17. full preview → confirm with one already-booked row: **no second expense created**, row staged
    `Skipped` with the record named

## Doc corrections owed

- `.claude/context/domain/outflow-import.md:215-226` — rewrite from "what is missing" to as-built.
- `.claude/context/domain/outflow-import.md:1617` — "the real backstop against paying twice is the
  `Outflow Row Match` unique constraint" sits in a Cashfree passage but reads as universal. Mark it
  Cashfree-scoped in the same change. (Line 222 already carries the correction.)

## What must NOT change

- The Cashfree path. `candidates.find_earlier_batches_for_rows` keeps its period narrowing and its
  own lookup; this slice does not collapse the two.
- `duplicates.row_identity`, `dates_agree`, `assess_duplicates`, `DUPLICATE_WARN_RATIO`.
- `amounts.py` — no new `Decimal` constant, anywhere.
- The Cashbook classification rules (ledger choice, `pick_expense_type`, the `Petty Cash` fallback).
  This slice only decides whether a row is imported at all.

---

## Follow-up shipped 2026-08-21 — CB-DUP-2

The plan's remaining item ("the two lookups are still two copies; Cashfree narrows by period and
Cashbook does not") is closed, **but not by making them the same**.

- **Mechanism unified.** Both go through `candidates.prior_import_sightings` — one query, one
  terminal-status clause, one identity, one `ORDER BY creation ASC`.
  `find_earlier_batches_for_rows` became a thin adapter keeping its old return shape, so
  `upload.py` is byte-unchanged and its 39 tests were never at risk.
- **The period narrowing stays Cashfree-only, deliberately.** Its licence is that a miss cannot
  cause double payment because the `Outflow Row Match` constraint catches it — and that licence does
  not exist on a path that CREATES its target. A miss costs Cashfree a worse message and costs
  Cashbook a second expense.
- Pinned by `TestCashbookDoesNotNarrowByPeriod`, from both sides: one test proves Cashbook still
  finds a duplicate in a far-dated batch, a second proves the Cashfree filter genuinely excludes
  that batch — without it the first would pass even if the filter had quietly stopped filtering.
