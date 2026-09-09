# 16. A bank statement creates money in both directions, and settles nothing

Date: 2026-09-07

## Status

**Accepted — owner-ruled 2026-09-07**, over six rounds of grilling (Q1–Q31a) against a real
1,274-row ICICI current/OD statement covering 01-Jan-2026 → 20-Aug-2026.

⚠️ **The number `0016` is NOT free, and this is deliberate rather than an oversight.**
`0016-snag-category-is-free-text.md` already carries it, as do the historical `0002` / `0007` /
`0008` / `0014` / `0015` collisions. This repo has two parallel ADR sequences and never renumbered
them; renumbering here would break the pointers that already name **ADR-0016** in
`frontend/.claude/plans/bank-statement-ingestion-plan.md` and in
`.claude/context/domain/outflow-import.md`. This file is *this feature's* 0016 — cite it by
filename, not by bare number.

Direct precedent: **[ADR-0015](0015-cashbook-import-creates-expenses.md)**, which scoped the
module's prime directive **per source**. This ADR widens the same directive again, to **direction**.
Read 0015 first; every argument here is built on it.

Build record: `frontend/.claude/plans/bank-statement-ingestion-plan.md`. As-built detail:
`.claude/context/domain/outflow-import.md`.

## Context

Bulk Import Outflow began with one prime directive, stated in bold at the top of its domain doc:

> **The import PAYS what someone has already approved. It never approves, and it never creates a
> `Project Payment`.**

ADR-0015 amended the first sentence to be source-scoped: Cashfree pays, Cashbook creates. Both
sources still moved money **out**.

**An ICICI bank statement is neither, and it is the first source that carries money IN.** Of its
1,274 rows: 405 are not spending at all and never become work; 711 are debits worth ₹8.28 Cr; 158
are credits worth ₹18.00 Cr — client receipts, loan drawdowns, FD closures, refunds. There is no
"outflow" reading of a credit row, so the screen and the route are renamed **Bulk Import
Transactions** / `/bulk-import-transactions` (Q1, Q9).

Three structural facts separate it from both existing sources:

- **It states a DIRECTION per row**, by which of the Withdrawal / Deposit columns it filled in. A
  payout export has one amount column and states no direction at all.
- **Its narrations are bank-written channel strings, not system-generated remarks.** The only
  human-typed slot is the IMPS/INFT note, silently truncated to ~15 characters
  (`BULD67469766`, `WIB Office acco`, `Noida rent Jan `).
- **405 of its lines are not payments to anyone** — payout-wallet top-ups, the bank's own
  general-ledger shuffles, credit-card settlements, failed transfers bouncing home.

## Decision

### 1. The prime directive is now scoped by SOURCE **and** DIRECTION

> A **Cashfree** import pays what someone has already approved.
> A **Cashbook** import creates what a wallet already spent.
> An **ICICI Bank Statement** import creates, in **both** directions: a debit becomes an expense, a
> credit becomes an inflow. It settles nothing.

**The part of the directive that matters is untouched: nothing here creates a `Project Payment`.**
Money leaving the bank against an approved payment is still Cashfree's job; money arriving that
would have to become a negative `Project Payments` row is a **Vendor Refund**, which is deliberately
deferred (see *Deferred*). `settle.create_expense_from_row` still hard-guards
`is_expense_doctype`, and the inflow path is a **new function beside it, never a widened one**.

### 2. Credits create because there is nothing to settle — and debits create for the same reason

This is the load-bearing measurement of the whole feature. It is recorded here in full because the
numbers are what stop a future reader "restoring" matching on this source. Owner ruling **Q2 was
REVERSED by measurement**: ICICI is **create-only**, and everything not excluded and not a duplicate
lands `Mismatched` for a human (Q31).

All three matcher tiers fail, for three different reasons.

**Tier 1 — structurally unreachable.** `matcher.account_ifsc_vendors` is the tier-1 population, and
`ifsc_matches` is only ever set **inside the `index.by_account` loop** — an IFSC alone can never set
it. An ICICI narration carries no beneficiary account number anywhere. 517 debit rows carry an IFSC
and not one can reach tier 1. ⚠️ **Tier 1 must NOT be loosened to close this.** It is allowed to
auto-suggest precisely because it stands on the strong account+IFSC pair, and Cashfree has live
settled data depending on that (Q25).

**Tier 0 — cannot settle, by construction.** `Project Payments.utr` is written only at
**fulfilment**, so every UTR in the database belongs to an already-`Paid` payment, while
`ledgers.SETTLEABLE_STATUSES` is `Approved`-only. Measured DB-wide:

| Payment status | Carry a UTR |
|---|---|
| `Paid` | **7,643 of 7,644** |
| `Approved` | **0 of 1** |
| `CEO Pending` | **0 of 131** |
| `Requested` | **0 of 24** |

So `load_payments_by_reference` is empty for every row of every statement. ⚠️ **This is not
ICICI-specific — it applies to Cashfree too**, and `candidates.py` already records the same
observation. Tier 0 has always been a **duplicate detector**, not a settler. It hits **41 of 711**
ICICI debits (5.8%) and every hit is an auto-skip.

**Tier 0 therefore SURVIVES as the duplicate guard, and the owner explicitly kept it (Q31a).** This
is why ICICI rows land `Mismatched` and not `Skipped`: `review._FROZEN_ROW_STATUSES` is
`(Skipped, Settled)`, so a `Skipped` row is frozen out of every later match run — landing them there
would have silently deleted the guard.

**Tier 2 — fires ZERO times, and the rows that would fire are ALL FALSE POSITIVES.**

| Measure | of 711 ingested debits |
|---|---:|
| remark resolves to exactly one project | **7 (1.0%)** |
| full tier-2 predicate vs `Project Payments` | **0** |
| full tier-2 predicate vs `Project Expenses` | **0** |
| ceiling: any Approved record, any ledger, amount only | **0** |

⚠️ **The small Approved pool is NOT the explanation, and this was tested.** Re-run against all
11,128 records **as if every one were Approved**: the amount agrees with some record on **497 rows
(69.9%)** and with a `Project Payment` on 436 (61.3%) — and the full tier-2 predicate is **still 0**.
Amount agreement is abundant; the **project axis is dead**. A fuller approval queue moves tier 2
from 0 to 0.

And the 7 rows that do resolve a project are all wrong:

```
Rs 115,000  CLG/MR SAYED ALI/SBI             -> project "SBI"           (x3)
Rs 247,133  CLG/XINERGY INNOVATION/PNB       -> "Schneider Innovation"  (x3)
Rs 126,732  CLG/INNOVATIVE TECHNOLOGIES/HDF  -> "Zing Technologies"
```

`SBI` matches a project whose entire name is `SBI` — but in a `CLG/` narration that segment is the
cheque **drawee bank code**, which `parser._ICICI_DRAWEE_BANK_CODE` documents as exactly that. The
other two match off the **payee's** company name.

⚠️ **Do NOT "fix" this by loosening the project rule. Any widening makes wrong settlements more
likely, not right ones more numerous.** 99% of rows naming no project is **structural**, not a
data-quality accident: there is no field in an ICICI narration where a project name lands. Widening
`GENERIC_PROJECT_TOKENS` or adding `Outflow Import Project Alias` rows cannot fix it — there is
nothing to alias. (Two further candidate signals were checked and both fail: `BULD*` batch
references appear on 570 of 711 rows and match **0** `Project Payments.document_name` and 0
`Project Expenses.payment_ref`; payee-name matching was deliberately deleted as "Pass B" by owner
ruling 2026-08-07.)

**⚠️ HAND-LINKING IS DELIBERATELY KEPT (owner ruling).** `review.get_row_candidates` still offers
ranked browse candidates when a person opens one row, and `search_settleable_records` still returns
the whole approved pool. **The fence is on the AUTOMATIC path only** — `source_has_settlement_path`
gates what the match RUN may offer unattended, never what a human may choose after opening a row.

### 3. A non-project inflow is a NEGATIVE `Non Project Expense`, not a new doctype

A credit that names no project (an FD closure, a loan drawdown, a bank interest credit) has nowhere
to go on the project side. Rather than mint a doctype for it, it becomes a `Non Project Expense`
with a **negative amount** — a construct that **already exists, is already documented, and already
renders correctly**:

- `pages/NonProjectExpenses/config/nonProjectExpensesColumns.tsx` renders a negative amount **green**.
- `utils/expenseApproval.ts` states, in its own header, that a **negative amount is NOT
  auto-approved** — the `0 < amount <= 10000` band is positive-only, so a refund takes the full
  `Requested → Approved → Paid` path. Both doctype controllers hold the identical predicate.

**The cost, stated honestly: money coming IN then lives in a doctype called *Expenses*.** Anyone
reading a Non-Project Expenses list, or summing that table, meets a negative row and has to know why.
That was accepted over a new doctype with new permissions, new list views, new reports and a new
place for money to hide. New `non_project=1` Expense Type fixtures name the income kinds (Q19), so
the row at least says what it is.

### 4. The duplicate key is SOURCE-AWARE

`duplicates.row_identity` was `(transfer_id, amount, date)`. Against the real 1,274 rows that key
**silently loses 5 real rows**:

| Key | Distinct | Rows silently lost |
|---|---:|---:|
| `(tid, amount, date)` — the old key | 1,269 | **5** |
| `+ direction` | 1,270 | 4 |
| `+ remarks` | 1,273 | 1 |
| `+ direction + remarks` | **1,274** | **0** |

**Both extra fields are load-bearing and each catches a different failure.** *Remarks* catches four
SGST/CGST pairs — same id, date, amount **and** direction, differing only in narration
(`SGST202603186870599968` / `CGST202603186870599971`, ₹18,630 each); these are an INGEST category, so
the old key would have swallowed one leg of each pair. *Direction* catches the general-ledger
transfer whose two legs carry **byte-identical narration** (`Ac xfr from gl 05051 to 60010`,
₹3.19 Cr each way).

⚠️ **Cashfree and Cashbook keep the triple, byte-identically.** These are bank-narration artefacts
that cannot occur in a payout export, and those two sources carry live settled data whose duplicate
behaviour is proven in production. `WIDE_IDENTITY_SOURCES` is the switch, and the default — what
every caller passing no source gets — is the old triple. That default is the guarantee, not laziness.

### 5. `Project Inflows` has no status, so the bank row IS the review gate

**Every consumer of `Project Inflows` sums it unfiltered.** There is no status field to filter on,
and the sum feeds `cashflow_gap` and therefore **CEO Hold**. So a created inflow is **live the
instant it is written** — there is no draft state, no approval queue, and nothing downstream that
will hold it back.

The owner ruled (Q8, option c) that **the bank row is the review gate**: a credit is not written
until a person opens that row and chooses a disposition, and no status is added to `Project Inflows`
to compensate. Adding one would mean auditing every unfiltered consumer, and the review has to happen
somewhere — it happens where the reviewer already is.

### 6. Customer-required is enforced in the IMPORT ENDPOINT, never on the doctype

A `Project Inflow` needs a customer. The obvious place to require it is `Project Inflows.validate` —
and that is exactly wrong: `validate` fires for **every** writer, so putting it there would start
rejecting saves from screens nobody asked to change, months after this feature shipped, with the
refusal blaming a doctype rather than an import. The check lives in the new inflow endpoint (Q13).

## Consequences

### Accepted risks

**R1 — bookmarks break (Q27).** The route moved `/bulk-import-outflow` → `/bulk-import-transactions`
with **no redirect**, by explicit ruling (option a). Every existing bookmark and pasted link 404s.
⚠️ Adding a redirect later is a **reversal of the ruling**, not a tidy-up. ⚠️ And the router carries
a `basename` (`VITE_BASE_NAME`: `""` dev, `'frontend'` prod), which has already produced a
production-only 404 in this feature (domain doc § E3) — so navigation to the new path must go
through the router, never a raw `<a href>`.

**R2 — the internal name and the user-facing name now differ, permanently (Q1).** The folder stays
`outflow_import`; the five doctypes stay `Outflow Import Batch` / `Outflow Import Row` /
`Outflow Row Match` / `Outflow Import Expense Rule` / `Outflow Import Project Alias`. A doctype
rename is a migration with dynamic links and a unique index riding on it, and buys nothing. Someone
grepping for "Bulk Import Transactions" in the backend finds nothing; the domain doc is the bridge.

**R3 — money in a doctype called Expenses.** See decision 3. A negative `Non Project Expense` is
income, and only its expense type says so.

**R4 — an inflow is live on write.** See decision 5. A mistaken disposition on a credit row moves
`cashflow_gap` immediately, and CEO Hold reads that. The correction path is editing the inflow
afterwards, which nothing prompts anyone to do — the same shape as ADR-0015's R1.

**R5 — FD placements and loan principal booked as expenses overstate spend by ~₹3.9 Cr (Q4).** The
owner ruled they get the ordinary options rather than a treasury disposition of their own. The
codebase's own `write_off_adjustment` carries the matching reasoning about not manufacturing a money
record.

**R6 — a row with nothing to link has no manual terminal state in v1 (Q12).** `SHOW_SKIP_ROW` stays
off. Such a row stays `Mismatched` indefinitely.

**R7 — the ingested outflow total is NOT "what the company spent".** The three `platform_*`
exclusion rules drop ₹11.59 Cr of real debits, because a payout-wallet top-up is not a payment to
anyone — the actual disbursements happen inside Cashfree / Cashbook / Porter and are a separate
import. Any figure presented as total spend has to add them back.
`services/outflow_import/bank_exclusions.py` states this in its own header.

### What did NOT change

- **Cashfree and Cashbook are untouched.** Same matcher, same windows, same duplicate key, same
  statuses, same dialogs. The source-aware widenings all default to the old behaviour.
- **`Project Payments` still cannot be created by any import**, from any source, in any direction.
- **Tier 1 is unchanged and stays unreachable on this source.** It was not loosened.
- **Hand-linking is unchanged.** Only the automatic path is fenced.

### Rejected

- **Loosening tier 2's project rule so ICICI could settle something.** Measured: the 7 rows it would
  reach are all false positives off a drawee bank code or a payee's company name. Any widening makes
  wrong settlements more likely, not right ones more numerous.
- **A signed amount instead of an explicit `direction` field (Q10).** `amounts.amounts_match`, both
  SQL pool queries, the settle guard and every summary sum assume a positive magnitude — a negative
  amount would pass all of them and settle the wrong way round in silence.
- **Netting the two summary blocks (Q14).** Received and Paid are shown separately and never netted.
- **A status field on `Project Inflows`.** See decision 5.
- **Renaming the folder / modules / doctypes (Q1).** See R2.

### Deferred, with reasons

- **Vendor Refund from a bank credit.** Not free-standing: it is a negative `Project Payments` row
  minted inside a `PO Adjustments` doc, plus a negative `RA Vendor` payment term. It needs a PO and
  an existing adjustment with remaining impact, so it cannot be created from a bank row without
  picking that PO. 15 rows, ₹3.5 L. **This is the only route by which an import could ever create a
  `Project Payment`, and it is not built.**
- **Matching credits against unpaid `Project Invoices`.** Real value — 120 of 158 credits are client
  receipts — but it is a new candidate pool, a new ranking and a new meaning of "match". Addable
  later without changing anything built for v1; the payer name is already extracted.
- **Bulk create for the 503 payroll rows (Q20).** Cashbook's worker earns its complexity from a
  PLANNER that decides ledger and type from keyword rules. These rows are marked HUMAN precisely
  because no rule reproduces the decision, so a bulk path would still need 503 human choices.

## Open

- **Q30** — `porter` as a bare substring vs `\bporter\b` in the exclusion ruleset.
- **`parser._duplicate_transfer_ids` is still on the old triple.** Bounded and fail-open: the
  PREVIEW WARNING over-reports on an ICICI statement about rows staging then correctly keeps as
  distinct. Nothing is lost.
- **Direction is inconsistent across gateway sources.** Pre-B3 Cashfree/Cashbook rows were
  backfilled `Debit`; post-B3 ones stay BLANK, because the parser only sets direction for a
  two-amount-column source.
- Revisit **R4** if the monthly correction load on created inflows turns out material, and **R1** if
  the broken bookmarks generate real support traffic.
