# Bank statement ingestion — plan + as-built record

Ingests an **ICICI current/OD account statement** into the existing Bulk Import Outflow module,
which is renamed **Bulk Import Transactions** because it now carries money IN as well as OUT.

Sibling docs: `.claude/context/domain/outflow-import.md` (the module this extends),
`docs/adr/0015-cashbook-import-creates-expenses.md` (the precedent for a source that CREATES),
and **[ADR-0016](../../../docs/adr/0016-bank-statement-import-creates-inflows.md)** (this
feature — written at slice B8a). ⚠️ `0016` is a DUPLICATE ADR number: `0016-snag-category-is-free-text.md`
already carries it, as do the historical `0002` / `0007` / `0008` / `0014` / `0015` collisions. The
repo has never renumbered those, so this one is cited **by filename**, not by bare number.

Source data lives OUTSIDE the repo and must stay there: `~/Downloads/jan 26 to till date icici
statement.xlsx` (1,274 rows, 01-Jan-2026 → 20-Aug-2026) and its categorised companion. It is real
company financial data. **Every fixture in this feature is FABRICATED**, per the convention the
Cashfree and Cashbook fixtures already set.

---

## What this feature is

A third source. Cashfree PAYS what someone approved; Cashbook CREATES what a wallet spent; ICICI
does **both**, and adds a direction the module has never had.

| Direction | Rows | Value | Offered on the screen |
|---|---:|---:|---|
| Debit | 711 | ₹8.28 Cr | settle an Approved Payment / Project Expense / Non Project Expense · **or** create a new Project or Non Project Expense |
| Credit | 158 | ₹18.00 Cr | create a `Project Inflow` · **or** create a negative `Non Project Expense` |

405 further rows are excluded by rule and never become work.

**The module's prime directive survives intact.** Nothing here creates a `Project Payment`. That
would only happen via Vendor Refund, which is deliberately deferred — see "Deferred" below.

---

## Owner rulings (rounds 1–6, 2026-09-07)

| # | Decision |
|---|---|
| Q1 | Extend the existing module. Rename screen **and** route to Bulk Import Transactions / `/bulk-import-transactions`. Folders, backend modules and all five doctypes keep their `outflow_import` names — a doctype rename is a migration with dynamic links and a unique index riding on it, and buys nothing |
| Q2 | Debits match first, create as the fallback — both |
| Q3 | v1 credits = Project Inflow + non-project inflow (as a negative Non Project Expense) + Skip |
| Q4 | FD placement / FD closure / loan drawdown / loan principal are ingested and get the ordinary options. No special treasury disposition |
| Q5 | The exclusion ruleset lives in CODE, pinned by test |
| Q6 | Statements are re-pulled as a widening range and overlap. Dedup is core, not a nicety |
| Q7 | `SHOW_CREATE_NEW_EXPENSE` → on. `SHOW_SKIP_ROW` stays OFF |
| Q8 | Option (c) — the bank row IS the review gate. No status added to `Project Inflows` |
| Q9 | Screen and route only |
| Q10 | An explicit `direction` Select. **Never a signed amount** |
| Q11 | Credits do not run the matcher at all |
| Q12 | Accepted: a row with nothing to link has no manual terminal state in v1 |
| Q13 | Customer-required enforced in the new endpoint, never on the doctype |
| Q14 | Two summary blocks — Received and Paid. Never netted |
| Q15/Q21 | Adapter approved with two measured corrections (below) |
| Q16 | Exclusions run at STAGE time. All 1,274 rows are staged; 405 land `Skipped` carrying the rule's own sentence |
| Q17 | Source-aware duplicate key |
| Q18 | The 24 masked payroll rows are flagged in `outcome_note`, not a new status or badge |
| Q19 | New `non_project=1` Expense Type fixtures for the income kinds |
| Q20 | 503 payroll rows go one at a time in v1 |
| Q22 | `beneficiary_name` blank where there is no counterparty. Drop it from the required set |
| Q23 | `DTAX` / `GST` / `EPFO` become keyword rules in `Outflow Import Expense Rule`, not parser logic |
| Q24 | Source is named `ICICI Bank Statement` — the Select picks a column adapter, and a second bank is a different adapter |
| Q25 | Tier 1 stays untouched and unreachable. Do not loosen it |
| Q26 | One gate: the existing `OUTFLOW_IMPORT_PROFILES` governs everything on this screen |
| Q27 | Route renamed, no redirect. Bookmarks break — accepted |
| Q28 | One ADR |
| **Q2 REVISED** | **ICICI imports are CREATE-ONLY.** Superseded by measurement — see "Matching is dead on this source" below |
| **Q31** | Everything that is not excluded and not a duplicate lands **`Mismatched`** for a human |
| **Q31a** | **KEEP the paid-duplicate guard.** No settlement, but the already-recorded-as-Paid check still runs — it catches 41 of 711 real rows |
| Q29 | Answered by measurement, not by ruling: tier 2 fires zero times |
| Q30 | `porter` -> `\bporter\b` — OPEN |

---

## Measured facts — do not re-derive these, they cost real effort

### The duplicate key: the current comparator LOSES 5 REAL ROWS
`duplicates.row_identity` is `(transfer_id, amount, date)`. Against the real 1,274 rows:

| Key | Distinct | Rows silently lost |
|---|---:|---:|
| `(tid, amount, date)` — current | 1269 | **5** |
| `+ direction` | 1270 | 4 |
| `+ remarks` | 1273 | 1 |
| `+ direction + remarks` | **1274** | **0** |

**Both extra fields are load-bearing and each catches a different failure.**
*Remarks* catches four SGST/CGST pairs — same id, date, amount and direction, differing only in
narration (`SGST202603186870599968` / `CGST202603186870599971`, ₹18,630 each). These are
`bank_gst_on_fees`, an INGEST category, so the current key would swallow one leg of each pair.
*Direction* catches the general-ledger transfer, whose two legs carry byte-identical narration
(`Ac xfr from gl 05051 to 60010`, ₹3.19 Cr each way).

⚠️ These are bank-narration artefacts and would never appear in a payout export, which is why the
key is **source-aware**: Cashfree and Cashbook keep `(tid, amount, date)` byte-identical and proven.

### The payer extractor: IMPS is 69% of the file and the obvious rule is wrong
```
5 segments (123):  MMT/IMPS/600219693408/CASHFREEIDFC/IDFB0020101
                                         ^payer       ^IFSC
6 segments (758):  MMT/IMPS/601211625341/STRATOS REFUND /SAFETYWALA/Kotak Mahindra
                                         ^purpose        ^payer     ^bank
```
**The payer is the SECOND-TO-LAST segment.** 0 blanks across all 881 IMPS rows.

Two rules were tried and measured wrong — recorded so neither returns:
- `p[4]` (the original spec) returns the IFSC `IDFB0020101` on 122 rows.
- "last segment that is not an IFSC" returns the bank name `Kotak Mahindra` on the 6-segment shape.

`CLG/` and `TRF/` were missing from the original spec entirely and carry **client** names on inbound
cheques — 11 client receipts would otherwise arrive anonymous.

The payee field is TRUNCATED per channel and the cap is silent: IMPS at 10 chars (`CASHFREEID`,
`AbdulHanna`), ICICI internal at 15/20, CLG around 25 (`INGENIOUS CONTRACTORS I`). Any match against
a master list must allow a PREFIX match, never equality.

### Tier 1 of the matcher is structurally dead for this source
`account_ifsc_vendors` is the tier 1 population and `ifsc_matches` is only ever set inside the
`index.by_account` loop — an IFSC alone can never set it. ICICI carries no beneficiary account
number anywhere, so 517 debit rows carry an IFSC in the narration and not one can reach tier 1.

Tier 0 (reference) and tier 2 (amount + project in remark) work. **Tier 1 must not be loosened** —
it is allowed to auto-suggest precisely because it stands on the strong pair, and Cashfree has live
settled data depending on that.

### MATCHING IS DEAD ON THIS SOURCE — measured against the live DB, twice

**All three matcher tiers fail, for three different reasons. This is the single most important
finding in the feature and it is why ICICI is create-only.**

**Tier 1 — structurally unreachable.** `account_ifsc_vendors` is the tier-1 population and
`ifsc_matches` is only ever set inside the `index.by_account` loop, so an IFSC alone can never set
it. ICICI carries no beneficiary account number anywhere. 517 debit rows carry an IFSC in the
narration and not one can reach tier 1.

**Tier 0 — cannot settle, by construction.** `Project Payments.utr` is written only at fulfilment,
so every UTR belongs to an already-`Paid` payment, while `SETTLEABLE_STATUSES` is `Approved`-only.
Measured DB-wide: 7,643 of 7,644 `Paid` payments carry a UTR; **0 of 1 `Approved`, 0 of 131
`CEO Pending`, 0 of 24 `Requested` do.** So `load_payments_by_reference` (Approved-only) is empty for
every row of every statement. ⚠️ **This is not ICICI-specific — it applies to Cashfree too, and
`candidates.py` already records the same observation.** Tier 0 has always been a duplicate detector.
It hits **41 of 711** ICICI debits (5.8%) and every hit is an auto-skip. **That is why Q31a keeps it.**

**Tier 2 — fires ZERO times, and the rows that would fire are WRONG.**

| Measure | of 711 ingested debits |
|---|---:|
| remark resolves to exactly one project | **7 (1.0%)** |
| full tier-2 predicate vs `Project Payments` | **0** |
| full tier-2 predicate vs `Project Expenses` | **0** |
| ceiling: any Approved record, any ledger, amount only | **0** |

⚠️ **The small Approved pool is NOT the explanation, and this was tested.** Re-run against all
11,128 records as if every one were Approved: amount agrees with some record on **497 (69.9%)**,
with a `Project Payment` on **436 (61.3%)** — and the full tier-2 predicate is **still 0**. Amount
agreement is abundant; the PROJECT axis is dead. A fuller approval queue moves tier 2 from 0 to 0.

⚠️ **The 7 rows that resolve are all FALSE POSITIVES, and leaving tier 2 enabled would be unsafe:**
```
Rs 115,000  CLG/MR SAYED ALI/SBI             -> project "SBI"                  (x3)
Rs 247,133  CLG/XINERGY INNOVATION/PNB       -> "Schneider Innovation"         (x3)
Rs 126,732  CLG/INNOVATIVE TECHNOLOGIES/HDF  -> "Zing Technologies"
```
`SBI` matches a project whose whole name is `SBI` — but in a `CLG/` narration that segment is the
cheque **drawee bank code**, which `parser.py`'s own `_ICICI_DRAWEE_BANK_CODE` documents as such.
The other two match off the PAYEE's company name. **Do not "fix" this by loosening the project rule:
any widening makes wrong settlements more likely, not right ones more numerous.**

**Why 99% name no project is STRUCTURAL, not a data-quality accident.** The only human-typed slot in
an ICICI narration is the IMPS/INFT note, silently truncated to ~15 chars, and it carries a remitter
reference or a purpose fragment — `BULD67469766`, `KEKA Payment`, `WIB Office acco`, `Noida rent
Jan `. There is no field where a project name lands. Cashfree's remarks are system-generated and
name a project in full; ICICI's are bank-written channel strings. **Widening
`GENERIC_PROJECT_TOKENS` or adding aliases cannot fix this — there is nothing to alias.**
(`Outflow Import Project Alias` has 0 active rows today, so the two index builds are identical.)

Two candidate signals were also checked and both fail: `BULD*` batch references appear on 570 of 711
rows (80.2%) but match **0** `Project Payments.document_name` and 0 `Project Expenses.payment_ref`;
payee-name matching was deliberately deleted as "Pass B" by owner ruling 2026-08-07.

### The adapter reconciles exactly
1,274 rows · debits ₹23,42,82,889.06 · credits ₹21,39,29,845.64 · 0 corrupt · 0 unreadable dates ·
0 warnings. 1,104 Debit / 170 Credit.

---

## Slices

| # | Slice | State |
|---|---|---|
| B1 | ICICI parser adapter (pure) | **DONE** — 103 parser tests OK (66 pre-existing + 37 new); whole service package 671 OK; real file reconciles exactly |
| B2 | Exclusion ruleset (pure, wired to nothing) | **DONE** — 55 tests OK; real file 405 skipped / 0 wrongly dropped / 0 leaked, per-category exact on all ten |
| B3 | Schema + staging ⚠️ MIGRATE | **DONE** — 692 service tests OK (baseline 672) · `test_upload` 62 OK (baseline 39) · `bench migrate` run, `direction` column verified live |
| B4 | Match run: duplicate guard ONLY, no settlement (RESCOPED by measurement + Q31a) | **DONE** — match run FORKS to a duplicate-guard-only path; 4 pins incl. an anti-vacuity test proving the blank is the ruling, not an empty DB |
| B5 | Turn on Create-new-expense — **this is now the slice that delivers the feature**, the primary path for ~670 of 711 debits, not a fallback | **DONE** — `SHOW_CREATE_NEW_EXPENSE` on; full chain re-traced, all 5 hazards clear |
| B6 | The inflow create path | **DONE** — `create_inflow_from_row` + `api/outflow_import/inflows.py`; 44 tests; no doctype edit needed |
| B7 | Negative Non Project Expense | **DONE** — `create_non_project_receipt_from_row`; 4 income Expense Types; fixtures synced |
| B8a | **Rename (screen + route), ADR-0016, domain doc, plan doc** | **DONE** — 3153 vitest OK (baseline 3153, unchanged) · tsc error set byte-identical (3,228 pre-existing repo-wide, **0** under `src/pages/outflow-import/`) · `yarn build` OK · 0 stale `bulk-import-outflow` references left in `frontend/src/` |
| B8b | Summary split (Received / Paid, never netted — Q14) | **DONE** — each block reconciles EXACTLY by construction (sums the split it rendered, not a second query); blank direction lands Paid as a CONSEQUENCE (`create_inflow_from_row` throws on non-Credit, so a blank row cannot be a receipt) making the two blocks a PARTITION; Cashfree/Cashbook proven byte-identical on live data |

Nothing before **B5** changes what an existing user sees. **B3 is the first real checkpoint** — the
statement uploads and all 1,274 rows are visible, with nothing new yet resolvable.

### B6 — the one trap worth stating early
`settle.create_expense_from_row` hard-guards `is_expense_doctype`, so the inflow path is a **NEW
function beside it**, never a widened one. And the `Outflow Row Match` unique key
`(transfer_id, target_doctype, target_name)` CANNOT guard a create — a freshly created record has a
new `target_name` every time and never contends. Cashbook needed two extra lookups instead
(`_already_imported` + `_already_booked`), and the second caught a real hole: 17 live Non Project
Expenses carrying a wallet id nobody had imported. Every credit disposition here is a create, so all
of them need this.

---

## B3 as-built — the parts that would be re-derived otherwise

**The source string is `ICICI Bank Statement` in FOUR places and they are pinned together by test:**
`parser._ADAPTERS` key · `Outflow Import Batch.source` Select option · `upload._BANK_STATEMENT_SOURCES`
· `duplicates.WIDE_IDENTITY_SOURCES`, plus the frontend `OutflowImportBatch.source` union.
⚠️ **`upload._read_and_parse` validates the posted source against `SUPPORTED_SOURCES` and
`_stage_batch` writes that same string straight into the Select — so a spelling that differs between
the adapter key and the Select fails Frappe validation on EVERY batch insert for that source.**
It shipped briefly as `ICICI` and was renamed before anything was imported; widen it in one change or
not at all.

**Rows land `Mismatched`, and that choice is load-bearing.** `review._FROZEN_ROW_STATUSES` is
`(Skipped, Settled)` and `match_batch` filters on it, so a `Mismatched` row is still examined by a
later match run — which is what keeps the Q31a paid-duplicate guard alive. **Landing them `Skipped`
would have frozen them and silently deleted that guard.** Pinned by a test in each suite. The
landing note says "no settlement path" and never "the matcher never runs" — there is a NEGATIVE pin
(`test_the_landing_note_does_not_claim_the_matcher_never_runs`) so a later reader cannot harden the
weaker claim into the stronger one. No source gate exists anywhere on the match run.

**Skip precedence is EXCLUSION FIRST**, ahead of already-imported and duplicate-in-file. Every branch
ends at `Skipped` so precedence changes no status — only the sentence. The decisive case is a
re-upload: already-imported-first would make 405 of 1,274 rows read "already imported in batch X"
instead of naming the ten rules, destroying the per-category counts that are how a NEW narration form
gets noticed.

**A blank direction fails open.** The parser blanks direction when BOTH money columns are populated;
with no direction there is no honest way to run a rule that leads with one, so the row is ingested.

**The backfill patch is SCOPED to `b.source IN ('Cashfree','Cashbook')`, not a bare
`WHERE direction = ''`.** An unscoped re-run against a DB that has since imported a statement would
stamp `Debit` on an ICICI row whose blank means *the parser refused to guess* — manufacturing the
exact answer it declined to invent, invisibly. Pinned by
`test_it_never_stamps_debit_on_a_bank_statement_row`.

## B8a as-built — the rename, and the four things that had to move together

**Old → new, exactly:** route path `bulk-import-outflow` → **`bulk-import-transactions`**; screen
name `Bulk Import Outflow` → **`Bulk Import Transactions`**.

**⚠️ NO REDIRECT (owner ruling Q27, option a).** Existing bookmarks 404 and that was accepted rather
than mitigated. A redirect added later is a **reversal of the ruling, not a tidy-up**; the route
comment in `routesConfig.tsx` says so at the site.

**⚠️ THE FOLDER, THE BACKEND MODULES AND ALL FIVE DOCTYPES ARE UNCHANGED (Q1).** `services/outflow_import`,
`api/outflow_import`, `src/pages/outflow-import/`, `Outflow Import Batch`, `Outflow Import Row`,
`Outflow Row Match`, `Outflow Import Expense Rule`, `Outflow Import Project Alias`. A doctype rename is a
migration with dynamic links and a unique index riding on it. **A user-facing name and an internal
module name do not have to match** — `.claude/context/domain/outflow-import.md` is the bridge, and its
header now states the split.

### The one non-obvious trap: the sidebar matches on the LABEL STRING

`NewSidebar.tsx` decides flat-nav-button vs collapsible-group by testing `item?.label` against a
literal `Set`. **The menu entry's `label` and that Set membership string had to move in ONE edit** —
changing either alone drops the item into the collapsible-group branch and renders it wrong, with no
error anywhere. A comment now says so at the Set. Three further sidebar sites carry the route string:
the entry `key`, the `allKeys` active-item set, and the `groupMappings` deep-link fallback.

### Files changed

| File | What |
|---|---|
| `components/helpers/routesConfig.tsx` | route `path` + the rename/no-redirect/no-doctype-rename note |
| `components/layout/NewSidebar.tsx` | entry `key` + `label`, the flat-nav label Set, `allKeys`, `groupMappings`, comments |
| `utils/auth/ProtectedRoute.tsx` | `OutflowImportRoute` docstring + the Access Denied sentence |
| `pages/outflow-import/OutflowMasterPage.tsx` | the `<h2>`, the module docstring title, both `navigate()` paths |
| `pages/outflow-import/useOutflowRows.ts` | route string in a comment |
| `pages/outflow-import/outflowTableModel.test.ts` | route string in a comment |

⚠️ **`VITE_BASE_NAME` matters here** (`""` dev, `'frontend'` prod) — it has already produced a
production-only 404 in this feature (domain doc § E3). Every navigation to the new path goes through
the router; there is no raw `<a href>` on it.

⚠️ **The unrelated `src/pages/reports/**/outflow*` feature (project cash-outflow reports) was NOT
touched.** It merely shares the word.

**Left deliberately un-renamed:** prose in files outside the rename's scope that names the module
rather than the screen (`types/NirmaanStack/OutflowImportBatch.ts`, `utils/dateFilterRange.ts`, the two
`data-table` date-filter modules, `useOutflowPeriodStore.ts`, `useOutflowSourceStore.ts`,
`outflowPeriod.ts`). Those are internal comments about a module whose name did not change.

### ADR-0016

`docs/adr/0016-bank-statement-import-creates-inflows.md`. Records the four decisions a future reader
would otherwise reverse by accident: the direction widening (and that nothing here creates a
`Project Payment`); **why credits create rather than settle, and why debits do too — with the tier-0 /
tier-1 / tier-2 measurements in full, because the numbers are what stop someone "fixing" it**; why a
non-project inflow is a negative `Non Project Expense` rather than a new doctype (with the cost stated
honestly); and the source-aware duplicate key with its 5-lost-rows measurement. Plus: `Project Inflows`
has no status and every consumer sums it unfiltered, so a created inflow is live immediately and the
bank row is the review gate (Q8c); and customer-required lives in the import endpoint, never on the
doctype (Q13).

---

## Known gaps left open after B3

1. **`parser._duplicate_transfer_ids` is still on the old triple.** It is the third `row_identity`
   reader and is called from inside `parse_statement` without a source. Consequence is bounded and
   fail-open: on an ICICI statement the PREVIEW WARNING over-reports ("N transfer ids appear more
   than once") about rows that staging then correctly keeps as distinct. Nothing is lost. Two-line
   fix in `parse_statement`.
2. **Direction is inconsistent across gateway sources.** Pre-B3 Cashfree/Cashbook rows are backfilled
   `Debit`; post-B3 ones stay BLANK, because the parser only sets direction for a two-amount-column
   source. Closing it means teaching the parser that a single-amount-column source states `Debit`.

## Deferred, with reasons

- **Vendor Refund from a bank credit.** A vendor refund is not free-standing: it is a negative
  `Project Payments` row minted inside a `PO Adjustments` doc, plus a negative `RA Vendor` payment
  term. It needs a PO and an existing adjustment with remaining impact, so it cannot be created from
  a bank row without picking that PO. 15 rows, ₹3.5 L.
- **Matching credits against unpaid `Project Invoices`.** Real value — 120 of 158 credits are client
  receipts — but it is a new candidate pool, new ranking and a new meaning of "match". Addable later
  without changing anything built for v1; the payer name is already extracted.
- **Bulk create for the 503 payroll rows.** Cashbook's worker earns its complexity from a PLANNER
  that decides ledger and type from keyword rules. These 503 rows are marked HUMAN precisely because
  no rule reproduces the decision, so a bulk path would still need 503 human choices. Revisit once
  the expense-rule table has been fed real ICICI narrations.
- **`SHOW_SKIP_ROW`.** One line, if "Still open" stops reaching zero.

## Accepted risks

- FD placements and loan principal booked as expenses would overstate spend by ~₹3.9 Cr. The owner
  ruled they get the ordinary options; the codebase's own `write_off_adjustment` carries the matching
  reasoning about not manufacturing a money record.
- Route rename breaks existing bookmarks. No redirect, by ruling.
- **There is no DOM test environment.** Anything turning on a React semantic needs a live browser
  check; a green `vitest` proves nothing there.

## Maintainer action

Two patches will need `patches.txt` lines added by hand, per the existing convention: B3's
`direction` backfill and B8's expense-rule seed.


---

## FINAL STATE (2026-09-07) — all slices landed, nothing committed

| Suite | Result |
|---|---|
| `services/outflow_import` (pure) | **743 OK** |
| `api…test_upload` | 62 OK |
| `api…test_review` | 216 OK / 1 skip |
| `api…test_inflows` | 44 OK |
| `api…test_cashbook_import` / `test_cashbook_rules` / `test_approved` | 34 / 13 / 26 OK |
| frontend `yarn test` | **3188 passing / 86 files** |
| `npx tsc` | **0 errors under `src/pages/outflow-import/`** (~3,228 pre-existing repo-wide; not a gate) |
| `yarn build` | green |

⚠️ **`test_expenses` (2 failures) and `test_settle_payment` (8 errors) are PRE-EXISTING and were PROVEN so** — the identical counts appear with every file of this feature stashed. Do not attribute them here, and do not "fix" them as part of this work.

### B6a — a latent transaction bug this work made live, then closed
`create_expense_from_row`'s `doc.insert()` was NOT wrapped in `_outflow_import_write()`, while
`project_cashflow_hold_update.on_project_expense` fires on an insert at `Paid` and can reach a
branch that inserts a notification and calls `frappe.db.commit()`. **A commit inside
`expenses.create_expense`'s per-row savepoint makes that rollback a silent no-op.** It was harmless
only because the path was DARK (`SHOW_CREATE_NEW_EXPENSE` was `false` from R2 until B5 turned it
on). **The general lesson: enabling a path is what makes a latent transaction bug live.**

### Owner actions still outstanding
1. **`patches.txt`**, under `[post_model_sync]`:
   `nirmaan_stack.patches.v3_0.backfill_outflow_row_direction`
2. **Other sites need `bench migrate`** for the four new `Expense Type` fixture rows
   (`Interest Received`, `Fixed Deposit Proceeds`, `Loan Received`, `Advance Returned`).
   localhost was synced via `frappe.utils.fixtures.sync_fixtures`.
3. **ADR number** — `0016` collides with `0016-snag-category-is-free-text.md`. The repo has seven
   such collisions already (0002 x3, 0007, 0008, 0009, 0014, 0015) and has never renumbered. `0020`
   is free. UNDECIDED.
4. **THE LIVE BROWSER PASS.** There is NO DOM test environment (`vitest.config.ts` is
   `environment: "node"`, deliberately), so every React semantic in this feature is verified by
   nothing but its code. Highest-value single check: **import the real statement and confirm 1,274
   rows arrive — 405 `Skipped` carrying rule sentences, 869 `Mismatched`.** That one action
   exercises the parser, the ten exclusion rules, the direction field, the source-aware duplicate
   key and the whole staging path.

---

## SLICES C1–C8 (2026-09-08) — raw bank downloads, header detection, and the 3-step wizard

The nine B-slices assumed a HAND-CLEANED sheet: 8 columns, header on row 1, no preamble, no
trailer. A raw `DetailedStatement (NN).xlsx` straight off ICICI net banking is none of those, and
it is now the format that gets uploaded. These slices ingest it as-is.

### Owner rulings (2026-09-08)

| # | Decision |
|---|---|
| C-Q1 | `ICICI Bank Statement` gets its OWN 3-step wizard — **Upload · Check · Import**. It ends where the work ends; Cashfree's `Confirm` step is structurally empty for this source |
| C-Q2 | The header picker lives INSIDE the Check step, not as a 4th step. One screen: pick a row, watch the counts move under it |
| C-Q3 | `added_on` moves from the `Value Date` column to **`Transaction Date`** |
| C-Q4 | The columns list is READ-ONLY DISPLAY. There is NO column-mapping UI and none is to be built |

### Measured facts — do not re-derive

A raw download (`(12)` = 145 rows, `(13)` = 1450 rows) has the SAME layout at both sizes:

| Rows | Content |
|---|---|
| 1–16 | account preamble (`Name:`, `A/C No:`, `Transaction Date from:`, `Advanced Search`) |
| **17** | the header row |
| 18 … | transactions |
| +1 | **blank** |
| next 5 | `Page Total`, `Opening Bal:`, `Withdrawls:`, `Deposits:`, `Closing Bal:` |
| +1 | **blank** |
| last 31 | `Legends Used in Account Statement` heading + 30 entries |

⚠️ **THE TRAILER HOLDS 36 NON-BLANK ROWS AND *TWO* BLANK ROWS, NOT ONE.** The planning note first
said 37; that counted the second blank row (between the balances and the legends heading) as
content. Both real files independently report 36. `sheetHeaderPicker.test.ts` now pins 36 with the
off-by-one named at the site.

⚠️ **FINDING THE HEADER IS NOT ENOUGH — THE TRAILER STAGES FAKE TRANSACTIONS.** The four balance
lines put their FIGURE in column B, which is the `Tran. Id` column. Measured on file 12: header
found, trailer left on ⇒ **94 rows = 90 real + 4 junk**, with transfer ids like `-4,87,90,566.06`
and eight warnings. The `Legends` lines are column A only, so a blank `Tran. Id` already drops them.
**Start detection and end detection are two jobs.**

Raw file 13 parsed AS-IS after C1–C5: header row 17 · table 18–1412 · 36 trailing rows ignored ·
**1395 rows · 0 warnings** · Debit 1213 / Credit 182 · 2026-01-01 → 2026-09-08. After the ten
exclusion rules: **433 Skipped / 962 Mismatched** (315 platform_cashfree, 53 platform_cashbook,
35 platform_porter, 12 credit_facility_auto_debit, 7 gateway_wallet_return, 5
credit_card_bill_payment, 3 neft_return_failed, 1 each internal_gl_transfer_in /
internal_gl_transfer / bank_card_adjustment). File 12: header 17, 90 rows, **zero junk rows**.

⚠️ **THE `Transaction Date` SWITCH WAS FREE, AND ONLY BECAUSE IT WAS DONE NOW.** Measured
2026-09-08: the live DB holds **ZERO `ICICI Bank Statement` batches** (Cashfree 16, Cashbook 2). The
bank row identity is `(transfer_id, amount, date, direction, remarks)`, so changing which column
feeds `date` changes row identity — with prior data it would have opened a duplicate hole on the
**11 of 1395** rows where the two columns disagree (all interest postings, `Transaction Date` one
day later; e.g. `S47648361` VD=01/Jan/2026 TD=02/Jan/2026). Doing it after the first real import
would have needed a migration.

### As-built

- **C1 `_read_grid`** — reading the bytes is now split from finding the table; one format-blind grid
  for csv and xlsx. ⚠️ The `_MAX_SCAN_ROWS` / `_MAX_SCAN_COLUMNS` bounds moved over verbatim (a real
  Cashfree export declares `<dimension ref="A1"/>` and `read_only=True` believes it). The slice's
  proof is that every pre-existing parser test passes unchanged. The `_MAX_SCAN_COLUMNS` refusal
  **widened from the header row to every row** — which row is the header is no longer known at read
  time, and a full row is the same evidence of a short read wherever it sits.
- **C2 `locate_table`** — header = the first row carrying EVERY required column name (exact match
  after strip); no match ⇒ a refusal naming the closest row and what it lacks. End = the first
  wholly-blank row after the header, with the non-blank rows below it COUNTED and reported.
  ⚠️ **GATED on the new `sources.source_has_preamble()`.** Cashfree and Cashbook keep header-is-row-1
  and blank-rows-are-skipped, byte-identical — they carry live settled data, and a universal
  end-rule could SILENTLY TRUNCATE a gateway export. ⚠️ The flag is named `has_preamble`, not
  `stops_at_blank_row`: it decides BOTH halves. ⚠️ An override posted for a gateway source is
  REFUSED, not ignored — except `header_row=1`, which is the same answer rather than a disagreement.
  ⚠️ Near-miss pinned: preamble row 8 reads `Transaction Date from:` and must never be mistaken for
  the required `Transaction Date`. Exact matching is what makes that safe.
- **C3 `header_row` rides the request** — an optional 1-based multipart field, read ONCE inside the
  SHARED `_read_and_parse`. That sharing IS the safety property: preview and upload physically
  cannot disagree about which row was the header, and it preserves the "the browser re-posts the
  file, the server holds no session state" design.
- **C4 capability 6, `_FirstPopulated`** — first NON-EMPTY column in declared order;
  `added_on = _FirstPopulated(("Transaction Date", "Value Date"))`. ⚠️ No existing capability fits: a
  tuple JOINS (`"01/Jan - 02/Jan"`) and `_WhicheverIsPopulated` demands EXACTLY ONE be populated —
  here both are. ⚠️ `_ICICI_REQUIRED` keeps the SAME five columns, so the legacy 8-column format
  still imports through the `Value Date` fallback; `icici_sample.csv` was deliberately NOT
  regenerated and is now the legacy-format guard. The old `Value Date` pin was **INVERTED**, not
  deleted.
- **C5 the `sheet` payload** — `preview_outflow_statement` gains ONE optional key, ABSENT for
  Cashfree/Cashbook. ⚠️ `columns_read` is DERIVED from the adapter's own column map, never a second
  hand-written list — the screen states what the parser will do and the two must not be able to
  disagree. ⚠️ `ParseResult` carries the grid so the rows the picker shows and the rows the parser
  read come from ONE read. ⚠️ **The grid ALWAYS contains `header_row_used`**: the row count is
  `min(total, max(60, header_row_used + 5))` with NO upper cap. A hard cap of 60 was specified first
  and was wrong — a header detected at row 70 would have been excluded from the very preview whose
  job is to let a person see and re-pick it. Pinned by a deep-header test.
- **C6 the 3-step wizard** — `BANK_STEPS` (upload · check · import) and ONE `SOURCE_FLOWS` lookup
  replacing the two-way `source === "Cashbook"` branches in `importSteps` AND `currentStepIndex`.
  ⚠️ Each entry holds the step list AND the index function together, so an index can never point
  past the end of the list it indexes. ⚠️ `onConfirmStep` now derives from the step KEY
  (`=== "confirm"`), not the magic `stepIndex === 3`. ⚠️ The bank index deliberately ignores
  `matched` — there is no 4th step to be wrongly advanced to — and the "nothing matched" vs "the
  match never ran" distinction survives on screen through the error banner and the footer's Re-run
  button, both of which render from step 3 on.
- **C7 `SheetHeaderPicker`** — pure presentation over `StatementSheetInfo`; every decision that can
  be phrased as "given this payload, what does the screen say" lives in the pure
  `sheetHeaderPicker.ts` (28 tests) because there is no DOM environment. ⚠️ Row numbers print
  UNGROUPED (`1412`, never `1,412`) — they are Excel's own gutter numbers. ⚠️ The summary quotes no
  row COUNT: `table_end_row - table_start_row + 1` is a span of SHEET rows and the parser drops rows
  inside it, so a count here could contradict `total_rows` on the same screen. ⚠️ An Excel letter
  strip sits above the grid so the letters in `columns_read` can be located without counting columns
  by hand.
- **C8 the landing tab** — the `source === "Cashbook"` ternary became a `POST_IMPORT_TAB` lookup
  whose DEFAULT is "don't move". The bank source is absent from the map on purpose: its rows all
  land `Mismatched`, so the Not-Matched worklist IS where the work is.
- **Dialog plumbing** — `headerRow` state, reset on a file change AND on a source change (a row
  number from another sheet is meaningless); the picked row rides the IMPORT post, not only the
  preview; `handlePickHeaderRow` is ref-frozen because `readStatement` re-identifies on every
  `isBusy` flip. ⚠️ **A re-read disables Import.** While it is in flight the counts on screen belong
  to the PREVIOUS header row while the button would post the NEW one — importing a different number
  of rows than the screen shows, silently. Cashfree/Cashbook can never reach that state.

### Test state after C1–C8

```
services/outflow_import   790 OK   (baseline 743)
api  test_upload           76 OK   (baseline 62)
     test_review          216 OK / 1 skip     (unchanged)
     test_inflows          44 OK              (unchanged)
     test_cashbook_import  34 · test_cashbook_rules 13 · test_approved 26   (unchanged)
frontend  yarn test  3221 passing / 87 files  (baseline 3188 / 86)
          tsc  3228 errors repo-wide (the pre-existing figure, unchanged) · ZERO under
               src/pages/outflow-import/
```
⚠️ `test_expenses` (2 failures) and `test_settle_payment` (8 errors) remain PRE-EXISTING.

### STILL OWED — the live browser pass

Nothing in this UI is covered by a test; `vitest.config.ts` is `environment: "node"` deliberately.
**A green suite proves none of the following.**

| Check | Expect |
|---|---|
| Upload file 13 RAW | header **17**, table 18–1412, **36** rows ignored |
| Staged | **1395 rows — 433 Skipped, 962 Mismatched**, 0 warnings |
| No junk rows | zero rows whose transfer id is a balance figure |
| Pick a wrong header row | a refusal naming the missing column |
| **Upload file 13 a SECOND time** | **all 1395 refused as duplicates** |
| Upload file 12 RAW | header 17, 90 rows, no junk |

⚠️ The second-upload check is the one that matters most going forward: this format is uploaded
FREQUENTLY as a widening range, so every upload overlaps the last one heavily, and the source-aware
duplicate key has never been exercised on real data.

---

## SLICES D5–D11 (2026-09-08) — the screen catches up with the data

The nine B-slices taught the module to CREATE money-in. The SCREEN was still written as if every
row were money-out. Full as-built, with every owner ruling and every load-bearing invariant:
`.claude/context/domain/outflow-import.md` § *Slices D5–D11*.

### Owner rulings (2026-09-08)

| # | Question | Ruling |
|---|---|---|
| D-a | Deposits render under a column headed *Amount Paid* | Rename to **`Amount`** + a per-row `Paid`/`Received` marker. Not two columns (blank cell on every row), not a green negative (the header would still lie) |
| D-b | No inflow analytic | **SPLIT** `Total transferred` into `Total paid out` + `Total received`. Not "keep it and add one" — the two would overlap and not add up on screen |
| D-c | `Non Project Expenses` have no vendor at all | Render the **description alone, no em-dash**. A leading "—" reads as missing data, not as not-applicable |
| D-d | Dropping the doc id removes the Approved panel's only link | **The new label becomes the link.** Not "drop the link" — that is a capability cut hidden inside a display change |
| D-e | The credit-settle hole is a screen problem or a rule? | **A rule.** Screen gate **plus** a server guard, mirroring the `_guard_is_a_credit` that already existed on the inflow side |
| D-f | What does "strip after 48 characters" measure? | **The description alone.** The vendor name is not part of that budget |

### Slices

| # | Slice | State |
|---|---|---|
| D5 | One named direction predicate (`isCreditRow` / `availableDecisionTargets`), replacing 4 hand-written copies | **DONE** — also closed a live trim disagreement between the dialog and `isConfirmable` |
| D6 | ⚠️ **The credit-settle money bug** — `isConfirmable` mirror check + `_guard_is_a_debit` on **three** server doors | **DONE** — proven RED on both sides before the fix |
| D7 | Dialog hides debit-side cards on a credit row, and says why | **DONE** — conditional MOUNT, never `dimmed` |
| D8 | `Amount Paid` → `Amount` + direction marker | **DONE** — `column.get` byte-untouched |
| D9 | Summary split into paid/received, partitioning `total_*` | **DONE** — one extra GROUP BY term, same `_row_filters` |
| D10 | Remarks wrap at 64 + tooltip + a content width the auto-layout table required | **DONE** |
| D11 | Record column drops the id; Vendor → Vendor / Description | **DONE** — `expense_type` promoted to a first-class key, old overload deliberately kept |

### The one thing found rather than planned

**`settle_row_partial` was a THIRD unguarded door**, not the two the plan named — and the one that
also performs surgery on a PO's payment terms via `split_payment`, so an unguarded credit would have
left a split sanction behind it as well as a wrongly-`Paid` record. **Guarding two of three would
have been the same defect with a smaller footprint.**

### Test state after D5–D11

```
services/outflow_import   800 OK   (baseline 790)
api  test_review          227 OK / 1 skip   (baseline 216 / 1)
     test_expenses         45 run, 2 failures — PRE-EXISTING, both present in HEAD
     test_approved         29 OK  (baseline 26)
     test_upload 76 · test_inflows 44 · test_cashbook_import 34 · test_cashbook_rules 13 — all OK
frontend  vitest  3250 passing / 87 files   (baseline 3221 / 87)
          tsc     0 errors under src/pages/outflow-import/ and on OutflowImportBatch.ts
```

⚠️ **A pre-existing live-data trap was surfaced and fixed** — `test_the_master_table_carries_it_too`
read the master table UNSCOPED at `_MAX_PAGE_SIZE` (200) while the dev DB passed 200 open rows, so
the fixture fell off the first page and it failed as `StopIteration`. Not caused by this work
(`get_outflow_rows` contains none of these slices' identifiers, checked mechanically). Now scoped by
`batch`.

### STILL OWED — the live browser pass, now larger

The C1–C8 browser pass was already outstanding; these slices add to it. **`vitest.config.ts` is
`environment: "node"` deliberately, so none of the rendering below is covered by any test.**

| Check | Expect |
|---|---|
| Open a CREDIT row's Resolve dialog | NO record table, NO create-expense card; one line saying why; only the inflow + receipt cards |
| Open a DEBIT row's Resolve dialog | Byte-identical to before — record table + create-expense present, inflow/receipt absent |
| The rows table | Header reads `Amount`; each row carries `Paid` / `Received`; figures still right-aligned in one column |
| A long remark | Wraps at ~64 chars inside its column; Reference / Status / Outcome do NOT shift; full text on hover |
| Summary panel, a bank import | `Total paid out` + `Total received`, adding to what `Total transferred` used to show |
| Summary panel, a Cashfree import | `Total received` ABSENT (not a zero tile); `Total paid out` in the first tile's old position |
| Link-payment picker | Record shows `Against <PO>` / expense type, no id; hover reveals the id; Vendor shows name + wrapped description |
| Approved panel | Same, and the new label is CLICKABLE and lands on the right record |
| Approved CSV | Carries a `Description` column with the FULL text |

---

## SLICES D12–D14 (2026-09-09) — direction as a column, summary as two bands

Full as-built + every invariant: `.claude/context/domain/outflow-import.md` § *Slices D12–D14*.

### Owner rulings (2026-09-09)

| # | Ruling |
|---|---|
| D-g | **REVERSES D8's placement.** Amount keeps its title, value, funnel and sort; the `Paid`/`Received` marker moves to its OWN column named **Direction**, which gets a filter |
| D-h | Vendor / Description: **24** char wrap, **72** char trim (description alone) |
| D-i | Summary splits into **PAID OUT** and **RECEIVED** bands, each with Total · Settled · Still open; **Decided shared** |
| D-j | With only one direction present, **drop the band headers and render today's flat row** |

### Slices

| # | Slice | State |
|---|---|---|
| D12 | `Direction` column + facet filter; Amount back to a plain figure | **DONE** — the facet is the DERIVED label, and a missing `TRIM()` was caught and pinned RED |
| D13 | Vendor / Description 24 / 72 + width rebalance | **DONE** — 850px against the unchanged 876px cap |
| D14 | Summary bands; **Still open** split by direction | **DONE** — band arithmetic measured live on all 19 imports before the panel was built |

### The three things found rather than planned

1. **A `filter: "facet"` column needs THREE registrations, not two.** The brief named the column entry
   and the backend map; the frontend `SERVER_FACET_COLUMNS` was missed. Without it the funnel draws,
   "Clear filters (1)" appears, and **the row set never moves** — the slice Q1 defect from the other
   side. A test caught it.
2. **The facet `CASE` did not `TRIM` while both readers of the axis do.** A `" Credit "` row would show
   a **Received** badge and be filed under **Paid** — ticking `Received` hiding a row whose badge says
   Received. No production row carries padding, so it would have shipped green and stayed green. Fixed,
   pinned two ways, and **verified RED** against the untrimmed expression.
3. **The `direction` doctype description is stale** — it says a gateway export stages blank; Cashfree
   stages `Debit` (the live 894/5/0 split confirms). The rule is unaffected, so no code changed.
   Correcting it is the sanctioned description-only exception and **needs a `bench migrate`** — left
   for the owner.

### Test state after D12–D14

```
services/outflow_import   811 OK   (baseline 800)
api  test_review          237 OK / 1 skip   (baseline 227 / 1)
     test_expenses         45 run, 2 failures — PRE-EXISTING, both in HEAD
     test_approved 29 · test_upload 76 · test_inflows 44 · cashbook 34 / 13 — all OK
frontend  vitest  3262 passing / 87 files   (baseline 3250 / 87)
          tsc     0 errors under src/pages/outflow-import/ and OutflowImportBatch.ts
live      funnel offers exactly ['Paid','Received']; Paid 241 + Received 5 = 246 = unfiltered
          open + total partitions both hold
```

### STILL OWED — the live browser pass, larger again

| Check | Expect |
|---|---|
| Rows table | `Amount` is a plain right-aligned figure again — **no chip inside it** |
| Rows table | A `Direction` column beside it showing `Paid` / `Received` |
| Direction funnel | Offers exactly two options; ticking one narrows the table AND the tab counts |
| Summary, bank import | Two bands with headers; each band's Total = Settled + Still open by eye |
| Summary, Received band today | Settled reads **"nothing settled yet"**, not `₹0` — and Total equals Still open |
| Summary, Cashfree import | **No band headers at all** — the old flat row |
| Link-payment picker | Vendor / Description wraps at ~24 chars, cuts at 72, column visibly wider |
| Record column | Still narrower, and nothing clipped by the 20px it gave up |

---

## SLICES D15–D17 (2026-09-09) — a removed tile and two sentences that lied

Full as-built: `.claude/context/domain/outflow-import.md` § *Slices D15–D17*.

| # | Slice | State |
|---|---|---|
| D15 | Remove the `Decided` summary tile (owner ruling, cleaner panel) | **DONE** — payload keys deliberately KEPT; tile-count arithmetic moved with it |
| D16 | The Re-run caption stops describing one action while the button does two | **DONE** — `has_settlement_path` on the payload; RED-verified |
| D17 | A settled expense's Outcome link lands on the **Paid** tab | **DONE** — RED-verified |

### ⚠️ D16 — the first honest answer was "there is nothing to change"

The ask was to stop the matcher running on ICICI statements. **It already does not run.**
`match_batch` forks above everything on `source_has_settlement_path`: such a batch never loads a
settlement pool and never calls `match_row`. No matcher work to remove, no wasted pass to save.
Reporting that — rather than manufacturing a change to match the request — is what turned this into
the right slice: **the caption was the thing that was wrong**, counting a bank statement identically
to a gateway one and so naming the wider action for every statement in the set.

The owner then chose to KEEP the duplicate guard (re-affirming Q31a). It is not idle: it compares
each row's bank reference against already-`Paid` payments, a set that grows all day as people tick
payments by hand, so a duplicate invisible at import time surfaces only on a later re-run.

### ⚠️ D17 — the link went to a tab the record could not be in

Expense links landed on each page's DEFAULT tab, which is role-based and never `Paid` — `Requested`
for most users, `Approved` for an Accountant. A settled expense is `Paid`. The same defect the
payment branch beside it already records finding live, in the other ledger.

The tab **follows `settled`** rather than being hardcoded: a suggestion's expense is still
`Approved`, so pinning `Paid` would reproduce the defect pointing the other way. `exact` stays
`false` — a tab is not a record, and making it exact means adding the id to two other pages'
searchable fields, which was NOT done.

### Test state after D15–D17

```
services/outflow_import   811 OK      (unchanged)
api  test_review          239 OK / 1 skip   (baseline 237 / 1)
frontend  vitest  3275 passing / 87 files   (baseline 3262 / 87)
          tsc     0 errors under src/pages/outflow-import/ and OutflowImportBatch.ts
```
⚠️ 22 `tsc` errors under `ProjectExpenses` / `NonProjectExpenses` are PRE-EXISTING — read for their
param contract, never edited.

### STILL OWED — the browser pass, final list

| Check | Expect |
|---|---|
| Summary panel | **No `Decided` tile**; the row does not stretch to fill its place |
| Re-run caption, mixed period | `Re-run matches N open imports; M duplicate-checked only.` |
| Re-run caption, gateway-only period | Byte-identical to before — `Re-run reaches N open imports.` |
| Re-run caption, bank-only period | `Re-run duplicate-checks N open imports; none will be matched.` |
| Re-run tooltip | Lists every statement, then names how many are duplicate-checked |
| Outcome link, settled Project Expense | Lands on `/expense/project` with the **Paid** tab active |
| Outcome link, settled Non Project Expense | Lands on `/expense/non-project` with the **Paid** tab active |
| Outcome link, a SUGGESTED expense | Lands on the **Approved** tab, not Paid |
