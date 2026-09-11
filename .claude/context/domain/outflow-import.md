# Bulk Import Transactions

*(Renamed from **Bulk Import Outflow** at slice B8a, 2026-09-07 — the module now carries money IN as
well as OUT. **The screen and the route were renamed; nothing else was.** The folder
`services/outflow_import` + `api/outflow_import`, and all five doctypes — `Outflow Import Batch`,
`Outflow Import Row`, `Outflow Row Match`, `Outflow Import Expense Rule`, `Outflow Import Project
Alias` — keep their `outflow_import` names by owner ruling Q1: a doctype rename is a migration with
dynamic links and a unique index riding on it and buys nothing. A user-facing name and an internal
module name do not have to match, and this doc is the bridge between them.)*

An accountant uploads a statement and maps each line to the record it settles, or to the record it
should CREATE. Three settle-side ledgers: `Project Payments`, `Project Expenses`,
`Non Project Expenses`; and, since the bank-statement source, two create-side ones on the money-IN
side: `Project Inflows` and a **negative** `Non Project Expense`.

> ⚠️ **THE PRIME DIRECTIVE IS SCOPED BY SOURCE *AND* DIRECTION — IT IS NOT ABSOLUTE, AND IT USED TO
> READ AS IF IT WERE.** The line below is still the whole truth for **Cashfree**, and the last clause
> is still the whole truth for **every** source:
>
> > **The import PAYS what someone has already approved. It never approves, and it never creates a
> > `Project Payment`.**
>
> Per source:
>
> | Source | Direction | What it does |
> |---|---|---|
> | `Cashfree` | out only (no `direction` stated) | **PAYS** what someone approved. Never creates |
> | `Cashbook` | out only (no `direction` stated) | **CREATES** what a wallet already spent (ADR-0015). Never settles |
> | `ICICI Bank Statement` | **Debit and Credit**, stated per row | **CREATES**, in both directions. Settles NOTHING — all three matcher tiers are dead on this source, measured (ADR-0016). A debit becomes an expense; a credit becomes a `Project Inflow` or a negative `Non Project Expense` |
>
> **Nothing here creates a `Project Payment`, from any source, in either direction.** That would only
> happen via **Vendor Refund**, which is deliberately deferred — it is a negative `Project Payments`
> row minted inside a `PO Adjustments` doc plus a negative `RA Vendor` term, so it cannot be created
> from a bank row without picking a PO. `settle.create_expense_from_row` still hard-guards
> `is_expense_doctype`, and the inflow path is a **new function beside it, never a widened one**.

The three settle-side ledgers all settle `Approved → Paid` and nothing else. It is an *alternative
bulk route chosen per batch* (owner ruling Q12) — nothing about how the team works today changes, so a
**half-hand-ticked statement is the normal case**, not an edge case.

**Route: `/bulk-import-transactions`** (renamed from `/bulk-import-outflow` at B8a). ⚠️ **There is
DELIBERATELY NO REDIRECT** (owner ruling Q27, option a) — existing bookmarks 404, and that was
accepted rather than mitigated. Adding one later is a reversal of the ruling, not a tidy-up. ⚠️ And
the router carries a `basename` (`VITE_BASE_NAME`: `""` dev, `'frontend'` prod), which has already
produced a production-only 404 in this feature (§ E3) — navigate through the router, never a raw
`<a href>`.

Spec: `docs/outflow-import/workflow.html` **section 0** (14 owner rulings; sections 1–12 describe the
superseded v2 design — history, not instructions).
ADRs: **[ADR-0015](../../../docs/adr/0015-cashbook-import-creates-expenses.md)** (Cashbook creates —
the per-SOURCE scoping) and
**[ADR-0016](../../../docs/adr/0016-bank-statement-import-creates-inflows.md)** (the bank statement
creates in BOTH directions and settles nothing — the per-DIRECTION widening, the three dead matcher
tiers with their measurements, the negative-Non-Project-Expense decision, and the source-aware
duplicate key). ⚠️ `0016` is a duplicate number by the repo's own long-standing convention — cite
that ADR **by filename**.
Live status + slice record: `frontend/.claude/plans/outflow-import-plan.md`;
bank statement: `frontend/.claude/plans/bank-statement-ingestion-plan.md`.

---

## Residence — concept → owner (ADR-0010)

This manifest names the **one owning module** for each concept in this feature. **No-new-scatter
rule:** an edit that touches one of these must route through its owner — or at minimum must not
create a *new* copy of the rule. An **UNASSIGNED** owner means no single home exists yet — do **not**
pick one ad-hoc; ask.

| Concept | Owner (module) | Nothing else may… |
|---|---|---|
| Row + batch status derivation | `services/outflow_import/status.py` (`derive_row_outcome`, `derive_staged_row_outcome`, `derive_batch_status`, `derive_batch_counters`) — B3 | compute a `row_status` or a batch `status`. The frontend mirror `outflowImportStatus.ts` is a CONVENIENCE pinned by a parity test; this file is the authority |
| Which record the screen pre-selects | `services/outflow_import/status.py` (`sole_suggestion`) | re-derive "exactly one candidate" anywhere else — the browser did, from a different candidate list than the note counted, and the two disagreed |
| The two amount windows (settle ±₹5, tier 1 ±₹1) | `services/outflow_import/amounts.py` (`AMOUNT_TOLERANCE`, `TIER1_TOLERANCE`, `amounts_match`) | hold a copy of either, **or add a comparison that is not on the list**. SIX call sites: both SQL pool queries, the matcher, the settle guard, the already-paid duplicate check, and (N1) `similarity._amount_score`. The sixth decides NOTHING — it shapes the order of a browse list — and is listed anyway, because the rule is "every amount comparison in this feature", not "every one that writes". `TIER1_TOLERANCE ≤ AMOUNT_TOLERANCE` always — a tier wider than the settle window offers a record the confirm then refuses. The fifth site was *missing* until 2026-08-07 and flagged 8 of 26 rows in a live statement as discrepancies over sub-rupee rounding |
| What amount a settle WRITES (X1) | `services/outflow_import/amounts.py` (`rewrite_amount`) | decide it at a write site. It is **not a sixth window site**: the window already gated the pool and the write guard already re-asserted it, so this answers only "do these differ at all". ⚠️ Do not "finish" it by giving it a tolerance — that would put a second, quieter opinion about what may be settled inside a function whose job is to say what the number is |
| Does a remark name a project? | `services/outflow_import/project_match.py` (`build_project_index`, `ProjectIndex.sole_project`) | re-derive it. Tier 2 auto-suggests on this predicate, so a second copy is a second opinion about where money goes |
| Which words count when comparing free text to a master name | `services/outflow_import/project_match.comparable_tokens` (public since N1) | grow a private twin. Two readers now — tier 2's project index and the browse ranking — and a second copy would drift: change the length floor in one and the ranked list quietly stops agreeing with the matcher about what a word even is. ⚠️ Sharing the TOKENISER is not sharing a POLICY |
| How the browse list is ORDERED | `services/outflow_import/similarity.py` (`SimilarityPolicy`, `build_row_signals`, `score_record`, `ranked_records`) — N1 | let it reach anything that SETTLES. `matcher`, `disambiguate` and `status` must not import it, directly or transitively (pinned by a test both ways). Its weights exist to be tuned against reviewer feedback; a tweak made because a list felt wrongly ordered must not change which transfers move money unattended. It also must not reuse `matcher.VendorScoringPolicy` — sharing the dataclass retunes the matcher every time the list is retuned |
| Filtering + sorting that list on screen | `frontend/src/pages/outflow-import/recordPickerView.ts` — N1 | re-score a record in the client. The server sends the pool already ranked; `sortRecords(records, null)` MEANS "keep that order". A second scoring implementation here would be free to drift, and the symptom — a list ordered differently from the reasons printed on it — is invisible to every test on either side |
| **What that list is MEASURED AGAINST** (#1243) | `frontend/.../outflow-import/allocationView.ts` (`pickerComparisonAmount`) → the endpoint's `compare_amount` → `review._comparison_amount` → the ONE `bank_amount` derivation | measure a candidate against the transfer at a second site. The endpoint derives `bank_amount` ONCE and hands it as an ARGUMENT to all four consumers — the per-ledger SQL ordering, the `suggested` flag, the ranker's hard split and the amount score axis — so substituting it once moves all four together and there stays **exactly one amount-opinion per record**. ⚠️ The CLIENT's `bankAmount` prop (the "off by" mark) must be fed the SAME figure, or the mark contradicts the order it sits in. ⚠️ `pickerComparisonAmount` takes **no ticks**: the pool is ranked once per dialog open, against the BANKED remainder, never live per tick |
| **Whether the match run's marks may be shown** (#1243) | `frontend/.../outflow-import/allocationView.ts` (`matcherMarksVisible`) | teach `get_row_candidates` about the remainder. That live re-match has no frozen-status guard, so on a partly-allocated row it marks records against the WHOLE transfer — including records already settled as legs of that row. Making it remainder-aware would push RANKING into the matcher, which is the one fence this feature never crosses; the marks are a screen affordance, so they are suppressed on the screen |
| What may be settled, and from which status; and WHEN a record was decided | `services/outflow_import/ledgers.py` (`SETTLEABLE_STATUSES`, `settleable_statuses`, `DECIDED_ON_SQL`, `decided_on_sql`) | carry its own Approved-only list. Read by `candidates.py` (what may be OFFERED) and `settle.py` (what may be WRITTEN) so the two can never disagree about one record |
| Bank row → target matching | `services/outflow_import/matcher.py` (`match_row`, `match_by_reference`, `match_payments`, `match_expenses`, `resolve_vendors`) | decide anything. It PROPOSES ranked candidates; `status.py` derives the outcome and a person makes the choice |
| Choosing BETWEEN several admitted candidates | `services/outflow_import/disambiguate.py` (`pick_from_several`, `pick_note`, `RULE_*`) — the pure half; `review._disambiguate_matched` owns the writes | add a fourth way to separate candidates. It is **not a tier** and must never live in `matcher.py` — it cannot introduce a record the ladder did not admit |
| Which row keeps a contested record | `services/outflow_import/claims.py` (`resolve_claims`, `claim_note`) — pure; `review._enforce_single_claim` owns the writes | let two rows hold one record. `sole_suggestion` answers per row and cannot see the contest |
| How a suggestion was chosen | the `suggestion_rule` field + `disambiguate.RULE_LABELS` | invent a label. BLANK means "no suggestion", never "no rule" |
| Reading approved-and-unpaid across the three ledgers | `services/outflow_import/ledger_read.py` (`LEDGER_SOURCES`, `approved_rows`, `approved_count`, `approved_projects`) | write a fourth query that knows the three ledgers' asymmetries. `review._search_one_ledger` is the OTHER caller and stays separate deliberately |
| The settlement write | `services/outflow_import/settle.py` + the one orchestrator `api/outflow_import/expenses.settle_row` | write to a ledger from anywhere else in this feature |
| **Which endpoint a confirm calls** (B3 + B4) | `frontend/.../outflow-import/allocationView.ts` (`chooseSettleEndpoint`, `SettleEndpoint`, `effectiveSettleMode`, `settleModeLocked`) | answer *"is this a whole-transfer settle or an allocation?"* anywhere else. TWO readers since #1242: `OutflowMasterPage` ROUTES the confirm with it, and `confirmGate` PREDICTS that routing to decide whether the balance arithmetic governs the button. Which is why the gate is handed the endpoint itself rather than a boolean derived at the call site -- a second copy would be free to disagree with the router about the very pick it is gating, and the symptom is a live button whose refusal arrives from the server instead. ⚠️ **Both readers must also feed it the SAME TICK COUNT** (`decisionLinkKeys`), not the picker's resolved-record count -- see the #1242 slice below |
| **May a transfer pay PART of a record, or is the gap a DEDUCTION?** (PS + TD) | `services/outflow_import/partial_settle.py` (`partial_eligibility`, `deduction_eligibility`, `looks_like_tds`, `TDS_BAND_*`, `SERVICE_DOCTYPE`, `INTENT_*`) — pure. `deduction_eligibility` LAYERS on `partial_eligibility`; the shared shape half has one copy | let it reach the MATCHER. `matcher`, `disambiguate`, `status`, `stacks`, `claims` and `candidates` must not import it (pinned by a test). A partial sits OUTSIDE the ±₹5 settle window that gates every other write here; it is safe only because a person opens it on one specific row, and the moment the matcher can reach it that sentence stops being true. The frontend mirror `outflowTableModel.partialOffer` is a CONVENIENCE — the server re-asserts the whole gate under a row lock |
| **Splitting a Project Payment in two** (PS-1) | `services/payment_split.py` (`split_payment`; `split_and_approve` is a thin wrapper) — SHARED with the CEO partial approval | fork it for the second caller. ONE concept, ONE owner (ADR-0010 B1): two copies of the sum invariant and the PO-term surgery would drift, and the symptom is a PO whose terms stopped adding up, months later, with no way to tell which copy wrote it. **Every parameter defaults to the CEO behaviour**, which is what makes `test_payment_split`'s 26 original tests the proof that generalising it changed nothing |
| **Did a settlement take the machine's pick?** (Q1) | `services/outflow_import/status.py` (`settlement_origin`, `ORIGIN_*`) — pure | re-derive the accepted/overridden/no-suggestion test. THREE callers share it: the settle path, the summary aggregate, and the backfill patch. ⚠️ It is in `services/` because `api/expenses.py` imports `api/review.py`, so the reverse would be a cycle. ⚠️ NOT `auto_matched`, which means only "a suggestion existed" |
| **Which database failure means "another reviewer wrote to this transfer first"** (#1246, ADR-0020 B4) | `services/outflow_import/concurrency.py` (`is_concurrent_writer_refusal`) — pure; the ONE reader is `expenses.allocate_row`, which turns it into `CONCURRENT_ALLOCATION_MESSAGE` | widen it, or catch database errors broadly anywhere in this feature. Whatever it says yes to is told to a reviewer as a harmless race, on a screen that settles money. It recognises `SerializationFailure` (SQLSTATE 40001) ONLY — `InFailedSqlTransaction` and `DeadlockDetected` are deliberately outside, each pinned by a test. ⚠️ The translation ENDS AT THE COMMIT ("nothing was saved" is false after it). ⚠️ `settle_row` is NOT covered — out of scope, recorded in ADR-0020 B4, tracked as #1250 |
| **What makes two staged transfers THE SAME transfer** (D3; widened source-aware at B3) | `services/outflow_import/duplicates.py` (`row_identity`, `row_identity_of`, `WIDE_IDENTITY_SOURCES`, `dates_agree`, `RowIdentity`) — pure | key a duplicate check on anything else. THREE readers: the cross-batch lookup (`candidates.find_earlier_batches_for_rows`), the in-file repeat check in `upload._stage_batch`, and the parser's `_duplicate_transfer_ids`. They used to key on `transfer_id` independently; a key that differed between them would let one call two rows duplicates while another called them distinct, on the same file. ⚠️ It is **NOT** the `Outflow Row Match` unique constraint — that stays `(transfer_id, target_doctype, target_name)` and is the money guarantee; this is about WORK, and may be more discriminating | ⚠️ **THE KEY IS SOURCE-AWARE SINCE B3, and the DEFAULT is the guarantee.** `row_identity(..., source="")` — what every caller passing nothing gets — returns the old `(transfer_id, amount, date)` triple **BYTE-IDENTICALLY**, because Cashfree and Cashbook carry live settled data whose duplicate behaviour is proven in production. A source in `WIDE_IDENTITY_SOURCES` (today: `ICICI Bank Statement`) gets `+ (direction, remarks)`. **Both extra fields are load-bearing and each catches a different failure, measured on the real 1,274-row statement where the triple silently LOSES 5 REAL ROWS:** *remarks* catches four SGST/CGST pairs (same id, date, amount AND direction, differing only in narration), *direction* catches the GL transfer whose two legs carry byte-identical narration. These are bank-narration artefacts that cannot occur in a payout export — which is exactly why the widening is per-source and not global. ⚠️ `row_identity_of(row, source)` is the ADAPTER over the one rule, never a second rule: the widening added two fields that live ON the row, and forgetting `remarks` at a call site degrades ICICI silently back to the four-field key — it still works, it just loses four rows a statement and says nothing. ⚠️ It is a DIFFERENT set from `sources.BANK_STATEMENT_SOURCES` and they must not be merged "because they hold the same string today": this one answers *what makes two lines of this statement the same line?*, that one answers *what can this statement's rows DO?*. Full numbers: ADR-0016 § 4.
| Candidate pool queries | `services/outflow_import/candidates.py` | query a ledger for candidates inline in an endpoint |
| **Where a settled/matched record's link GOES** (E3) | `frontend/.../outflow-import/outflowTableModel.ts` (`settlementLink`, `orderPaymentsHref`) + `review._payment_order_names` / `_with_order_names` server-side | build a payments URL at a render site, or render one through a raw `<a href>`. A payment links to its ORDER (`/project-payments/<id>` with `/` escaped as `&=`) because that is what the app's other twelve call sites do; `paymentHref`'s search-param scheme is the FALLBACK only. ⚠️ The router carries a `basename` (`VITE_BASE_NAME`: `""` dev, `'frontend'` prod), so an anchor resolves to the SERVER ROOT and 404s in production while working in dev |
| **The record's date, and which date it IS** (E2) | `frontend/.../outflow-import/outflowTableModel.ts` (`recordDateParts`, `RECORD_DATE_LABELS`) | render an approval/updated distinction inline. `recordSortDate` merges the two for ORDERING only -- an ordering claims nothing about meaning; a LABEL does |
| **Why a picked record cannot be settled** (D1) | `frontend/.../outflow-import/outflowTableModel.ts` (`settleBlocker`, `settleBlockText`, `SettleBlockReason`) | write the refusal prose at a render site. The dialog used ONE fixed paragraph for every blocked pick and three of its claims went stale without anything failing — the worst told the reviewer to settle a TDS deduction "in the payments screen" after slice TD made that route live here |
| Browsable approved records (hand-linking) | `api/outflow_import/review.search_settleable_records` (+ `_search_one_ledger`, `_rank_browse_records`, `_browse_cap`) | reuse `get_row_candidates` for browsing — that is the MATCHER's output, and when the matcher finds nothing it is empty, which is exactly when hand-linking is needed. Since N1 it returns the WHOLE approved pool by default and `limit` is a safety ceiling, not a page size |
| What counts as "decided" on the screen | `frontend/src/pages/outflow-import/outflowTableModel.ts` (`isConfirmable`) | gate a confirm button on its own predicate — the dialog and the bulk bar both read this one |
| Which rows the master table shows (X3) | `api/outflow_import/review.get_outflow_rows` (+ `_row_filters`, `_scope_clause`, `get_outflow_facet_values`) | filter, sort or search rows in the browser. ⚠️ `_row_filters` is ONE builder shared by the page query, its count, the tab counts, the facet values **and — since P1 — the summary, the confirmable list and `match_period`** — a count computed under different filters than the page it labels is a lie that looks like a paging bug. ⚠️ Its two date clauses carry `OR r.added_on IS NULL` on purpose: an unparseable bank date would otherwise match no period and vanish from every surface at once |
| What the screen ASKS for (X3) | `outflowTableModel.serverQuery` | build endpoint params at a call site. It owns the MEANING of a filter; SQL owns the application |
| The screen's aggregate (X2, widened P1) | `services/outflow_import/status.py` (`derive_import_summary`, `StatusTally`) | count or sum the selected transfers anywhere else. The DB does the `GROUP BY`; this assembles. It is batch-agnostic and always was, which is why scoping it to a PERIOD needed no change here at all — only the WHERE clause moved |
| **The settled money, split by ledger** (2026-08-21; cut in two at B8b 2026-09-07) | `services/outflow_import/status.py` (`derive_settled_ledger_split`, `SettledLedgerEntry`, `SETTLED_LEDGER_OTHER`) | order, total or zero-fill that split anywhere else — in SQL, in an endpoint, or in the client. The order is **fixed** and bound from `ledgers.LEDGER_DOCTYPES`, never sorted by value: a value-sorted list reshuffles between periods and has to be re-read every time. ⚠️ Reordering `LEDGER_DOCTYPES` now reorders a rendered panel. ⚠️ The three figures must reconcile **EXACTLY** to `settled_value`, which is why the endpoint sums the **ROW** amount and not `m.target_amount` (they differ on a partial settle; live partials are currently 0, so the wrong column would have shipped as a latent defect) and why it applies the same failed-transfer exclusion the main query does. ⚠️ **`ledgers` IS A PARAMETER SINCE B8b** (default `LEDGER_DOCTYPES`, so every pre-B8b caller is byte-identical) — the received block walks a DIFFERENT tuple, and a second copy of this function differing only in which tuple it reads is how one of them would come to be missing a book |
| **Which way the settled money went** (B8b, 2026-09-07) | `services/outflow_import/status.py` (`derive_settled_direction_blocks`, `is_received_direction`, `ROW_DIRECTION_CREDIT`, `SETTLED_BLOCK_RECEIVED`/`_PAID`) + `ledgers.RECEIVED_LEDGER_DOCTYPES` | decide a block's membership, its order, its zero-fill or its total anywhere else — in SQL, in an endpoint, or in the client. **Owner ruling Q14 (a): TWO blocks, each reconciling to its OWN total, NEVER netted.** A single net figure hides both halves; folding receipts into the paid total adds money in to money out; excluding them makes the money this screen ingested invisible on the screen that ingested it. ⚠️ **EACH BLOCK'S TOTAL IS SUMMED FROM THE LINES IT RENDERS**, so the reconciliation is exact BY CONSTRUCTION, not by two numbers agreeing; the two block totals in turn add back to `settled_value` (pinned at the endpoint against a real batch). ⚠️ **MEMBERSHIP FOLLOWS THE ROW'S `direction`, NEVER THE TARGET DOCTYPE** — a non-project RECEIPT is stored as a NEGATIVE `Non Project Expense` (B7), so `Non Project Expenses` legitimately appears in BOTH blocks and the doctype genuinely cannot answer it. ⚠️ **A BLANK OR UNRECOGNISED DIRECTION IS `Paid`**, and it is a consequence rather than a guess: `settle.create_inflow_from_row` refuses anything that is not `Credit` at the write, so such a row is structurally incapable of having become a receipt. The predicate is a single POSITIVE test precisely so the two blocks PARTITION — the failure mode being a settled row that appears in NEITHER total. ⚠️ **PAID ALWAYS RENDERS, ZERO-FILLED; RECEIVED ONLY WHEN IT HOLDS ROWS, AND IT IS APPENDED SO PAID NEVER MOVES.** Cashfree and Cashbook are single-direction sources, so a zero-filled received block would sit on every gateway import forever claiming receipts were possible where none can occur. ⚠️ `settled_by_ledger` IS GONE from the payload, replaced by `settled_by_direction` — two keys totalling the same money are two chances to disagree about it |
| **The ledger a bank CREDIT can become** (B8b) | `services/outflow_import/ledgers.py` (`INFLOW_DOCTYPE`, `RECEIVED_LEDGER_DOCTYPES`) | add it to `LEDGER_DOCTYPES`, `EXPENSE_DOCTYPES` or `SETTLEABLE_STATUSES`. It is a **DISPLAY ORDER ONLY**: an inflow is CREATED, never SETTLED — there is no approved inflow waiting to be paid. ⚠️ The string is spelled in BOTH `ledgers.py` and `settle.py` because `ledgers` is a pure leaf `status.py` imports under a transitive purity test and `settle.py` imports `frappe`; the two are pinned against each other by `api/outflow_import/test_review.TestInflowDoctypeSpelling`, on the precedent `settle.DIRECTION_CREDIT` already set |
| **Which ledger a settled row settled against, in SQL** (2026-08-21) | `services/outflow_import/ledgers.py` (`SETTLED_LEDGER_SQL`) | write a second expression for it, and **never turn it into a `JOIN`**. It is a scalar correlated subquery precisely so it can drop into SELECT / WHERE / GROUP BY with no FROM change — five reads share `review._row_filters` and a JOIN would force a fork of the one shared builder. `LIMIT 1` is exact because a settled row carries at most one `Outflow Row Match` (verified live: 0 orphans, 0 multi-match); a fan-out shape would invalidate that, and the constant's own comment says so |
| **Exporting the transfers table** (2026-08-21) | `api/outflow_import/review.py` (`export_outflow_rows`, `_MAX_EXPORT`) | page a CSV, or build its filters separately. It reuses `_row_filters` + `_scope_clause` UNCHANGED, so the file and the tab count describe one population. ⚠️ It **REFUSES** over 20,000 naming both numbers — never a silent `LIMIT`, for the `_MAX_CONFIRMABLE` reason: a truncated file outlives the screen that could contradict it, over a set nobody chose. ⚠️ Do NOT raise `_MAX_PAGE_SIZE` (200) to serve an export; that constant guards the SCREEN's paging |
| **Exporting the approved inbox** (2026-08-21) | `api/outflow_import/approved.py` (`export_approved_records`, `_MAX_EXPORT`) | write a fourth query that knows the three ledgers' asymmetries — it reads through `ledger_read.approved_rows` like the page does. ⚠️ `approved_on` and `updated_on` stay SEPARATE COLUMNS in the CSV (asymmetry #1); a spreadsheet is where presenting a modification timestamp as an approval would be hardest to catch later |
| **This screen's columns → CSV columns** (2026-08-21) | `frontend/src/pages/outflow-import/outflowExport.ts` (`toExportColumns`, `exportFileBase`) | write a second CSV writer — `utils/exportToCsv.ts` is the one, and this only adapts `OUTFLOW_COLUMNS` into the shape it reads. ⚠️ It takes **no** `hidden` argument on purpose: a CSV is an archive, not a screenshot, and an export that depended on a menu somebody clicked would make two exports of the same table differ with nothing in either saying so. ⚠️ It exports `referenceValue` (the FULL reference), never `shortReference` |
| The screen's PERIOD, and the `added_on` filter (P1) | `frontend/.../outflow-import/outflowPeriod.ts` + `useOutflowPeriodStore.ts` | hold a second date filter for this column. ⚠️ **ONE VALUE, TWO EDITORS** — the `Period` control above the summary and the `Payment Date` column funnel read and write the same store entry. Two filters over one column would AND together, so "Last 30 days" plus "Is 01-Jan" selects nothing while neither control looks wrong. It is a STORE and not page state because four surfaces need it and one (the Skipped dialog's own `useOutflowRows` instance) is not a child |
| The screen's SOURCE scope (CF/S2) | `frontend/.../outflow-import/useOutflowSourceStore.ts` + `outflowTableModel.SOURCE_COLUMN_ID` | hold a second source filter for this column. ⚠️ **ONE VALUE, TWO EDITORS**, exactly as the period is — the `Source` control above the summary and the `Source` column funnel read and write the same store entry, so "Cashfree" above with "Cashbook" ticked below cannot AND into an empty screen. The stored shape is the FUNNEL's (`string[]`); the dropdown is the lossy editor and reads **Mixed** rather than "All" when the funnel holds both. Needed **no backend work at all** — `source` was already in `review._FACET_COLUMNS` and already on the row payload |
| Which imports the picker offers (CF/S2) | `outflowTableModel.importsForSource` | filter the import list at a render site. ⚠️ An import with **no** `source` survives every scope, on the period's `IS NULL` reasoning: a batch predating the column would otherwise vanish from the picker with no control able to bring it back |
| **Is a statement still worth re-matching?** (CF/S5) | `services/outflow_import/status.py` (`batch_is_open`) — pure | re-derive "finished". ⚠️ **THIS IS THE WHOLE OF "AUTO-CLOSE" AND IT REVERSES NOTHING** — see the ruling below. THREE readers: `match_period`'s filter, `_imports_in_scope`'s `is_open` flag, and (through that flag) the caption under the Re-run button. An unknown or missing status is **OPEN**, deliberately: failing towards "still has work" costs one wasted pass, failing the other way loses the work |
| Which batch `match_period` matches FIRST (CF/S3) | `api/outflow_import/review._match_order` | borrow this order from a reading surface. ⚠️ **IT DECIDES WHERE A CONTESTED RECORD LANDS**, so it is not presentation — see the trap recorded below |
| The reference a row is known by (CF/S1) | `outflowTableModel.referenceValue` / `shortReference` | truncate a reference anywhere a value is STORED or COMPARED. `referenceValue` falls back to the wallet's `transfer_id`; `shortReference` is **display only** and must never reach `column.get` (which feeds sort, funnels and facet values) or `settle.py` |
| A timespan word -> two dates | `frontend/src/utils/dateFilterRange.ts` | resolve "last 30 days" at a call site. It MIRRORS Frappe's `get_timespan_date_range`, including the odd ones (`this month` ends TODAY; `last 6 months` is quarter-aligned), so the same label selects the same rows on this screen as on every DataTable screen. ⚠️ The reports' `datePresets` define the SAME WORDS differently (its "Last 30 days" is 29 days) — the two vocabularies must not be mixed |
| The date filter CONTROL and its vocabulary | `components/data-table/dateFilterModel.ts` (pure) + `date-filter-popover.tsx` (the popover) | write a second date filter. `DataTableDateFilter` is now a thin TanStack binding over the same popover, so every screen offers one set of operators. Adding an operator or a timespan means teaching `dateFilterRange.ts` in the SAME change, or a control offers an option that silently filters nothing |
| Seeding decisions from the match run | `outflowTableModel.ts` (`suggestedDecision`, `seedDecisions`, `decisionOrigin`) | pre-select inside a component; the dialog used to, and it could only fire once a row was already open |
| Grouping + pairing interchangeable transfers | `services/outflow_import/stacks.py` (`stack_key`, `group_into_stacks`, `pair_stack`, `stack_note`, `stack_surplus_note`) | decide a stack's membership, its pairing, or why it did not pair, anywhere else. `review._resolve_stacks` owns the DATABASE half and nothing more |
| **What a STATEMENT SOURCE can DO** (B4) | `services/outflow_import/sources.py` (`BANK_STATEMENT_SOURCES`, `source_has_settlement_path`) — a PURE LEAF that imports nothing at all, not even from this package | spell the membership test out at a call site. It exists because the question got a SECOND caller with nowhere to ask it: the set lived as `upload._BANK_STATEMENT_SOURCES` while staging was the only thing that cared, and `review.match_batch` then needed the same answer — but an `api` module may not import another `api` module's private constant, so the alternatives were a second literal frozenset (two definitions of one fact, free to drift the day a source is added) or this. It moved DOWN to the layer both may import; `api` -> `services` is the one legal direction, and `upload` reads it back under its old private name so no call site changed. ⚠️ **CAPABILITIES ARE NAMED QUESTIONS, NOT A MEMBERSHIP TEST.** `source_has_settlement_path(source)` says what the caller wants to know; `source in BANK_STATEMENT_SOURCES` at a match-run call site would work today and say nothing about WHY the run behaves differently, and the next reader could not tell a deliberate capability gate from an incidental one. **FOUR things follow from membership and they are ONE decision, not four:** the statement states a `direction` per row, its non-spending lines are excluded at stage time, what survives lands `Mismatched` rather than `Pending match run` (Q31), and the match run offers it NO settlement candidate (Q31/Q31a). ⚠️ The strings are `parser.SUPPORTED_SOURCES` members VERBATIM and are also the `Outflow Import Batch.source` Select options — a rename moves all three together or every upload of that source fails Frappe's own Select validation with nothing on screen explaining why. ⚠️ **THE GATE IS ON THE AUTOMATIC PATH ONLY** — hand-linking is deliberately kept, so `get_row_candidates` and `search_settleable_records` still offer ranked records when a person opens one row |
| **Which bank-statement lines are NOT work for a human** (B2) | `services/outflow_import/bank_exclusions.py` (`EXCLUSION_RULES`, `should_skip`, the ten `category_id`s) — pure, no `frappe`, no DB | decide that a narration is noise anywhere else, and it **MUST NOT IMPORT THE MATCHER** (`matcher`, `disambiguate`, `status`, `stacks`, `claims`, `candidates` — pinned by a test, the same fence `partial_settle` and `similarity` sit behind). This module decides only whether a line REACHES them; a widening made here because a narration looked like noise must never be able to change what settles unattended. **THREE DESIGN RULES, all load-bearing:** (a) **FAIL OPEN** — an unmatched row is INGESTED, never dropped, because the two failure modes are not symmetric: a wrongly-ingested row is VISIBLE and un-mapped in seconds, a wrongly-dropped one is INVISIBLE and nobody ever learns it existed. `should_skip` has no default-skip branch and must never grow one. (b) **DIRECTION IS PART OF THE TEST, NOT DECORATION** — `Ac xfr from gl 05051 to 60010` appears twice byte-identically, once as a ₹3.19 Cr Debit and once as a ₹3.19 Cr Credit, and only the populated amount column tells the two categories apart; every rule leads with `wd` or `dp` and none is direction-blind. (c) **THE IFSC BEATS THE TYPED LABEL** — three rows read `Cashbook Balanc` while carrying Cashfree's IFSC and one reads `Cashfree Balanc` carrying Cashbook's, so each `platform_*` rule checks the IFSC FIRST and the free-text label is a fallback. ⚠️ **THE ORDER IS PART OF THE POLICY** (first match wins; the three `platform_*` rules come first so rule (c) can resolve), and the rules are DATA — an ordered `(category_id, predicate)` sequence — so a policy change is diffable without reading mechanism; `should_skip` holds no policy at all. ⚠️ **SKIPPING THE PAYOUT WALLETS COSTS ₹11.59 Cr OF REAL DEBITS, and that is still correct** — what left the bank is a wallet TOP-UP, not a payment to anyone, and the real disbursements happen inside Cashfree / Cashbook / Porter and appear in no bank narration. **The consequence is that NOBODY MAY READ THE INGESTED OUTFLOW TOTAL AS "WHAT THE COMPANY SPENT"** — it is what was spent THROUGH THIS ACCOUNT DIRECTLY, and any total-spend figure has to add the platforms back. ⚠️ Exclusions run at STAGE time (Q16): all 1,274 rows are staged and 405 land `Skipped` carrying the rule's own sentence — **EXCLUSION-FIRST precedence**, ahead of already-imported and duplicate-in-file, so a re-upload still names the ten rules rather than reading "already imported in batch X" |
| Access | `api/outflow_import/permissions.require_outflow_access` | gate an endpoint any other way |
| **What a Cashbook statement will CREATE** (Cashbook slice 4) | `services/outflow_import/cashbook.py` (`plan_statement`, `pick_expense_type`, `group_plan`) — pure | decide a ledger, a project or an expense type for a wallet row anywhere else. ⚠️ It must not reach `matcher`, `disambiguate`, `claims`, `stacks` or `settle` — pinned by a test, the same fence `similarity` and `partial_settle` sit behind. It decides what to CREATE; those decide what existing approved record a transfer PAYS, under an amount window this has no equivalent of |
| Which keyword means which expense type | the `Outflow Import Expense Rule` doctype, read by `candidates.load_expense_rules` | hardcode a keyword map. The rules are per-LEDGER because the two expense vocabularies are nearly disjoint, and they arrive LONGEST KEYWORD FIRST — that order is the rule, not presentation |
| What phrase means which project | the `Outflow Import Project Alias` doctype, read by `candidates.load_project_aliases` | grow a second nickname list. ⚠️ Deliberately NOT wired into `load_project_index`: Cashfree tier 2 settles money and its remarks name projects in full, so widening what it recognises would widen what settles unattended |
| The Cashbook write | `api/outflow_import/cashbook._cashbook_worker` (over `settle.create_expense_from_row`) | create an expense from a wallet row anywhere else |
| The Cashbook preview's shape | `frontend/src/pages/outflow-import/cashbookPreview.ts` | re-order or re-total the preview at a render site. `sortGroups` is the safety feature, not a style choice |

---

## Status vocabulary

Six row statuses. `status.py` is the only deriver.

| Status | Means | Reviewer does |
|---|---|---|
| `Pending match run` | staged from the sheet, nothing looked up | press Run match |
| `Matched` | ≥1 **approved** record found at this amount | confirm it |
| `Mismatched` | this transfer did not line up — **three causes, one status** | create, link, or pick one |
| `Settled` | we wrote; the record is now Paid and linked back | terminal |
| `Skipped` | nothing to do, and the reason says which nothing | terminal |
| `Error` | the write was attempted and rolled back | retry |

Batch: `Draft` → `In Review` → `Partially Settled` → `Completed`.

### ⚠️ `Unmatched` was merged into `Mismatched` (owner ruling 2026-08-10)

They were separate because their CAUSES differ — "the match ran and found nothing settleable"
versus "a record already recorded as Paid disagrees on amount beyond the rounding window". They are
the same JOB to the person holding the statement, and splitting them made a reviewer classify the
reason before they could act on either. **`Mismatched` went from the rarest status (0 on almost
every import) to the productive one carrying most of a statement's work** — which is why its
summary chip is now permanent instead of hidden-at-zero, and why the `unmatched_rows` /
`unmatched_value` summary keys are **absent, not zeroed** (a screen still reading them gets `None`
and breaks visibly, rather than reporting "0 transfers need a person").

**THE CAUSE IS NOT LOST — IT MOVED TO `outcome_note`.** `_nothing_found_note` and `_delta_note` are
unchanged and still say plainly which case a row is, in the sentence the Outcome column already
shows. Do not reintroduce a status to carry a distinction a sentence carries better. Two
consequences follow, and both are pinned by tests:

- `test_status.TestNothingFound::test_the_note_tells_this_apart_from_an_amount_disagreement` is the
  load-bearing test of the merge. The two sentences must never converge.
- `test_review::test_an_already_paid_payment_is_skipped_and_names_the_record` got **quieter**, not
  louder: before the merge, breaking the duplicate query produced a different STATUS from the
  correct behaviour; now both are `Mismatched` and only the note differs. Its note assertions are
  the whole test.

### ⚠️ A THIRD cause joined `Mismatched` (owner ruling 2026-08-11)

`_sweep_unresolved_to_mismatched` moves a row that found **several** approved records and had none
picked out of `Matched` — which shares a tab with `Settled` under the reviewer's heading *"this
transfer has a record"* — and into the Not-Matched worklist, where the decision is.

    _nothing_found_note   nothing matched at all          -> record or link one
    _delta_note           already Paid, amounts disagree   -> a deduction such as TDS
    several_found_note    several matched, none chosen     -> pick which one

**The dangerous pair is the FIRST and THIRD**, and it is why the third sentence had to exist before
the sweep could ship: telling a reviewer *"no approved payment or expense matches this transfer"*
about a transfer that matched six sends them to create a duplicate expense for money that is already
approved and waiting. Pinned by `test_status::test_all_THREE_mismatched_causes_stay_distinguishable`.

⚠️ **THE SWEEP NEVER TOUCHES A FAN-OUT, AND THAT COST A RED TEST TO FIND.** A fan-out is `Matched`
with no suggestion **by design** — one transfer covering several payments, carrying no
`suggested_name` only because a `(doctype, name)` pair cannot hold a GROUP. It is report-only by
ruling Q4, so it is meant to sit in `Matched` and say what it found. The guard reuses
`_disambiguation_candidates`, which already abstains on a set containing a fan-out, rather than
re-deriving "is this a fan-out" — the second opinion that list's docstring exists to warn about. A
single-candidate row is skipped on the same terms.

**Existing rows need `patches/v3_0/merge_outflow_unmatched_status.py`** — Frappe does not rewrite
stored values when a Select narrows, so pre-merge rows keep the retired string, invisible to every
tab and rendering as an untoned chip. Raw SQL, not per-row `set_value`: the status is DERIVED, so
there is nothing to audit, and a Version row per transfer would record a change nobody made. As
with `add_outflow_master_index`, **the `patches.txt` line is added by the maintainer, not the
patch**.

**Only `Settled` and `Skipped` are terminal** — narrower than v2, where a *finding* was terminal
because reporting it was the whole job. Under v3 the import settles, so a row that found something
and was never confirmed is unfinished work: `Matched` and `Mismatched` are both OPEN. That matters
MORE after the merge: `Mismatched` is now the bulk of the work, not the exception.

v2 → v3: `Reconciled` → `Skipped`/`Matched` · `Amount mismatch` → `Mismatched` ·
`Reference mismatch` → **deleted** · `Control exception` → **deleted** ·
`Completed with exceptions` → **deleted**. v3 → now: `Unmatched` → `Mismatched`.

---

## The matching rules, in one place

**Three tiers, owner-ruled 2026-08-07. The first that finds anything STOPS the ladder.**

```
1. STAGED     already imported / duplicate in file / not SUCCESS      -> Skipped
2. DUPLICATE  Paid payment with this reference, amounts agree         -> Skipped
                                              amounts differ          -> Mismatched
3. TIER 0     normalised UTR equal                     (finds fan-out; payments)
4. TIER 1     beneficiary account AND IFSC = a vendor's, amount +-Re 1 (payments)
5. TIER 2     amount +-Rs 5 AND the remark names the record's project  (payments + Project Expenses)
6. OUTCOME    >=1 approved candidate -> Matched     else -> Mismatched
```

**A lower tier never tops up a higher one.** Two candidates pre-select nothing, so reaching into
tier 2 after tier 1 found one would turn a confident row into an ambiguous one. Enforced in
`match_row`, which is why it orchestrates rather than calling both matchers.

**Vendor resolution** (≥2 survivors = ambiguous, nothing auto-recorded):
account+IFSC 0.95 · account 0.80 · exact name 0.75 · partial name 0.60×containment. Floor 0.35; a
name needs ≥2 non-noise words. **Containment, not Jaccard** — a statement name is routinely a subset
of the vendor name. ⚠️ **Only the `ifsc_matches` candidates admit anything to tier 1**; the name
scoring still runs and is still persisted as the row's resolved vendor, but it no longer MATCHES
anything. A name is a scoring form, never an identity.

**Project corroboration** (`project_match.py`): a remark names a project if it contains the project's
whole name (longest nested name wins — `Fujitsu Chennai` over `Fujitsu`), else a keyword unique to
one project. **Two projects named ⇒ nothing.** Distinctiveness is counted from the project list
itself, so cities self-tune; one small `GENERIC_PROJECT_TOKENS` list handles words common in English
but rare in the master (`site`, `office`, `work`). Measured: **172 of 194 live projects (88%) are
identifiable by their own name; the other 22 are all duplicate-named pairs** (two `Fidelity
Chennai`, two `SEBI Lucknow`, `ANSR` beside `ANSR - 2`).

**Never matches, by design:** non-Approved records · TDS payments (the bank sends `amount − tds`,
thousands off — neither window can reach it and **neither must be widened to**) · fan-out of a
settleable group (report-only, Q4) · `Non Project Expenses` (no project column, so nothing can
corroborate it) · a beneficiary whose account+IFSC resolves to no vendor and whose remark names no
project.

⚠️ **`match_expenses` REQUIRES the project — this REVERSED on 2026-08-07.** It used to match on
AMOUNT ALONE with the description only raising the score, which is why a round-number transfer with
an approved payment *and* an unrelated approved expense at the same amount honestly had **two**
candidates and pre-selected nothing. That was the practical ceiling on how often a row opened ready.
Description text (payee name / account / IFSC) still RANKS the candidates the project gate admitted.

⚠️ **DELETED, and not by oversight: the old Pass B** (vendor-by-name + amount + date ±3d). Rows it
used to catch now arrive `Mismatched` and are linked by hand. Owner's call, made with the loss stated.

---

### The Cashbook duplicate guard — TWO lookups, one identity (slice CB-DUP, 2026-08-21)

⚠️ **THE `Outflow Row Match` UNIQUE CONSTRAINT IS NOT THE BACKSTOP ON THIS PATH.** Several notes in
this document call that constraint "the real backstop against paying twice". It is the backstop for
**Cashfree**, which settles an EXISTING record. A Cashbook row **creates** its target, so
`target_name` is new every time and the key `(transfer_id, target_doctype, target_name)` is never
contended. **Do not read those sentences as covering both sources** — on the wallet path the two
lookups below ARE the guard, and nothing behind them will catch a miss.

A Cashbook spend is refused if either lookup recognises it, and they ask **different** questions:

| Lookup | Corpus | Asks | Message |
|---|---|---|---|
| `cashbook._already_imported` | `Outflow Import Row`, terminal `status_raw` only | did an earlier **batch** stage this transfer? | `Already imported in {batch}` |
| `cashbook._already_booked` | `Project Expenses` + `Non Project Expenses` | does an **expense** already exist for it? | `Already booked as {ledger} {name}` |

**`_already_booked` closes a real hole.** An expense can exist for a wallet spend without this
import ever having seen it — somebody keyed it in. Measured 2026-08-21: **17 live
`Non Project Expenses` carry a wallet transfer id in `payment_ref` that nobody imported.** Before
this slice, a statement covering those dates would have created 17 duplicate expenses silently. The
integration suite proves it: disabling the lookup makes
`test_no_second_expense_is_created_for_a_row_the_guard_blocked` fail `2 != 1`.

**ONE identity, both corpora: `reference` + amount + date**, via
`duplicates.index_prior_sightings` / `find_prior_sighting`.

- ⚠️ **THE SHAPE CHANGED BECAUSE THE RULE COULD NOT BE EXPRESSED IN THE OLD ONE.**
  `_already_imported` used to be an exact-triple `dict`, and a `dict` can only compare the date with
  `==` — which is exactly what `duplicates.dates_agree` refuses. The parser tolerates an unreadable
  `Added On` and stages `None` anyway, so under `NULL = NULL is false` a sheet whose dates we failed
  to read **imported a second time, silently.** Bucketing on `(reference, amount)` and settling the
  date separately is the only shape that can apply the fallback. `candidates.find_earlier_batches_for_rows`
  (Cashfree) has always had it, by hand.
- ⚠️ **THE AMOUNT IS EXACT AND MUST NEVER ACQUIRE A TOLERANCE.** `AMOUNT_TOLERANCE` is the *settle*
  window; at ₹5 two genuinely different ₹3 transfers would collapse and the second would never
  import. `amounts.py` refuses a `Decimal` constant declared outside it, so this cannot drift.
- ⚠️ **`ORDER BY creation ASC` IS LOAD-BEARING IN BOTH QUERIES.** `find_prior_sighting` returns the
  FIRST agreeing sighting, so earliest-first is what makes the message name the batch or record the
  transfer actually came from rather than a later one that merely also holds it. **A test asserts
  the right answer but cannot force the wrong one** — on a small heap-ordered table Postgres returns
  insertion order anyway, so the clause is insurance against a plan change, not something the suite
  can prove load-bearing.
- ⚠️ **A BLANK reference IS DROPPED, NEVER BUCKETED.** Otherwise every reference-less record shares
  one bucket keyed `("", amount)` and a duplicate verdict rests on the amount alone. Dropping means
  such a row is never recognised as a repeat — the recoverable direction.

**`_already_booked`'s query, and why it is two queries.** Narrowed in SQL by
`payment_ref IN (this statement's transfer ids)` — a few hundred at most, against the 701 expenses
that carry any reference at all. `payment_ref` is **unindexed** on both doctypes; at 2,594 + 718 rows
the sequential scan is free (revisit past ~100k). Two queries because
**`Project Expenses.amount` is a `Data` column of numeric STRINGS and must be CAST**, while
`Non Project Expenses.amount` is real `Currency` — the same asymmetry `candidates.load_expense_targets`
carries, and folding them would hide it.

⚠️ **NO STATUS FILTER, DELIBERATELY.** Measured: zero `Approved` and zero `Requested` expenses carry
any `payment_ref`, so `status = 'Paid'` narrows nothing today — and an unpaid expense holding the
reference is still a booking. A filter that buys nothing now and hides a real duplicate later is not
worth having.

**The skip order IS the message** (`plan_statement`): kind → outcome → amount → **already imported**
→ **already booked** → repeated in file. Batch before record because when an earlier batch created
the expense BOTH are true, and the batch is a screen in this feature; record before "further up this
sheet" because naming it tells the reader more.

⚠️ **THE IN-FILE CHECK DELIBERATELY DID NOT MOVE.** Three places ask "is this row repeated within one
file" — `plan_statement`'s `seen`, `parser.duplicate_transfer_ids` (the preview's warning) and the
Cashfree `_stage_batch` marking — and all three key on the exact `row_identity` triple. The parser's
own note says why: two of them disagreeing would call the same pair repeated in one surface and
distinct in another. Giving only one the missing-date fallback would recreate exactly that. Widening
all three is a separate, smaller slice.

⚠️ **`assess_duplicates` WAS NOT TOUCHED** — an already-**booked** row does not count toward the
refuse/warn ratio. `DUPLICATE_WARN_RATIO` is an owner ruling and its vocabulary is "already imported
*in batch X*", which is wrong for a hand-keyed row. Such rows still stage and skip with an exact
message; only the whole-file refusal is unaffected. Teaching it a second vocabulary is the change if
a mostly-hand-booked statement ever shows up.

**ONE IMPLEMENTATION, ONE DELIBERATE ARGUMENT (slice CB-DUP-2, 2026-08-21).** `_already_imported`
and `candidates.find_earlier_batches_for_rows` are no longer two hand-written copies: both go
through **`candidates.prior_import_sightings`** — one query, one terminal-status clause, one
identity, one `ORDER BY creation ASC`. `find_earlier_batches_for_rows` is now a thin adapter that
keeps its `dict[RowIdentity, str]` return, so **`upload.py` is byte-unchanged**.

⚠️ **THE PERIOD NARROWING IS THE ONE DIFFERENCE AND IT IS NOW DELIBERATE — DO NOT "FINISH THE JOB"
BY DEFAULTING IT ON.** Cashfree passes the statement's period; Cashbook passes nothing and searches
every batch. The earlier plan assumed this divergence should be collapsed. **Reading the licence for
it says otherwise:** `find_earlier_batches_for_rows` justifies the narrowing on the grounds that a
miss *"cannot cause double payment: the real backstop is the `Outflow Row Match` unique
constraint"*. **That licence does not exist on the Cashbook path** — a wallet row CREATES its target,
so `target_name` is new every time and the constraint can never fire. A missed duplicate costs
Cashfree a worse message; it costs Cashbook a **second expense**. Pinned from BOTH sides by
`TestCashbookDoesNotNarrowByPeriod` — one test proves Cashbook still finds a duplicate in a
far-dated batch, a second proves the Cashfree filter genuinely excludes that batch (without it the
first would also pass if the filter had quietly stopped excluding anything).

---

### ⚠️ A REAL .xlsx EXPORT LIES ABOUT ITS OWN SIZE (slice XLS-DIM, 2026-08-21)

**Every real .xlsx upload failed, both sources, from the day the format shipped until this fix** —
while the committed xlsx fixtures stayed green.

A Cashfree Transfers export writes this into its sheet XML:

```xml
<dimension ref="A1"/>
```

It declares the used range as **one cell**. `parser._read_xlsx` opens with `read_only=True`, and in
that mode **openpyxl trusts the declaration** — so it clips every row to column A. The
required-column check then reported `Missing column(s): Amount, Bank Reference No, Beneficiary Name,
Status, Transfer Id` — five of six, with `Added On` (column A) found. **"Everything except the first
column" is the signature of this bug.**

- ⚠️ **`reset_dimensions = True` DOES NOT FIX IT.** On openpyxl 3.1.5 a `ReadOnlyWorksheet` caches
  `max_row` / `max_column` from the parsed dimension at load; the flag is only read by the
  non-read-only reader. Measured: still 1 row, 1 column.
- **The fix is explicit bounds on `iter_rows`** (`_MAX_SCAN_ROWS`, `_MAX_SCAN_COLUMNS`), which
  override the declaration. Dropping `read_only=True` also works and costs 44 MB against 8 MB on a
  5,000-row sheet, for no gain — so the mode stays.
- `_MAX_SCAN_ROWS = 1_048_576` is **Excel's own row ceiling**, so it can never truncate a workbook
  Excel could open. It is not a performance guard and costs nothing — openpyxl stops at the last row
  holding data (measured: 5,001 rows in the same 5.0s as an unbounded pass).
- `_MAX_SCAN_COLUMNS = 200` **is** a real ceiling (every cell up to it is materialised per row: 14 MB
  at 200 vs 8 MB at the true width), so `_read_xlsx` **refuses** when the header fills the scan width
  rather than short-reading a statement's tail.

⚠️ **WHY THE SUITE MISSED IT, AND THE LESSON.** `cashfree_sample.xlsx` was generated by openpyxl,
which writes an honest `<dimension>`, and the test asserting csv == xlsx passed on it happily. Its
docstring claimed the fixture was "saved the way a real export saves it" — false, and corrected.
**A fixture built by the same library it is testing cannot see a defect in what real writers emit.**
`cashfree_bad_dimension.xlsx` is now committed: byte-identical to the twin except for the lie.

---

## The match run, in order — one per-row loop and FOUR global passes

`review.match_batch` is the only orchestrator. **The order is load-bearing at every joint** and each
comment in that function says which defect the position prevents.

```
for each unfrozen row:  match_row -> derive_row_outcome -> _persist_row_outcome
1. _enforce_single_claim         (claims.py)        a record is claimed once
2. _disambiguate_matched         (disambiguate.py)  Option B: separate several candidates
3. _resolve_stacks               (stacks.py)        pair interchangeable sets
4. _sweep_unresolved_to_mismatched                  leftovers read as Not-Matched
   _refresh_batch_rollup + commit
```

- **All three run AFTER the loop, never inside it.** `_persist_row_outcome` CLEARS every suggestion
  it does not re-find, so anything written mid-loop is wiped by the next row's clear.
- **Claims before Option B.** The claim pass frees records up; choosing between candidates while
  another row still held one would only produce a pick for the claim pass to release.
- **Option B before stacks.** The stack pass reads a `claimed` set built from the suggestions that
  now exist, so it must see a set already made consistent.
- **The sweep is LAST and could not be anywhere else.** "Several candidates and nobody picked one"
  only becomes a fact once every pass entitled to pick has declined, which is why it cannot live in
  `derive_row_outcome` — that runs in the per-row loop, before three passes have had their say.
- The run returns `stack_paired_rows` / `released_rows` / `rule_picked_rows` /
  `swept_to_mismatched_rows` beside the counters, so a run leaning hard on any pass is **visible
  rather than silent**.

---

## Several candidates, and the rules that tell them apart (Option B)

`sole_suggestion` pre-selects only when the matcher found EXACTLY ONE record. That refusal is right,
and on the first real statement it left **56 transfers with no pre-selection**. Measuring them showed
the evidence to separate the candidates was already on the row and nothing was looking at it.

**`disambiguate.py` decides BETWEEN candidates. It is not a fourth tier.** Every candidate it sees
was already admitted by the ladder and already passed the settle window, so it cannot widen what may
be matched — which is exactly why it does not live in `matcher.py`. It cannot widen what may be
SETTLED either: a pick is a PRE-SELECTION, the person still confirms, and `settle_row` still
re-asserts status and amount under a row lock.

| Rule | Fires when | The fence, and why |
|---|---|---|
| **M1** `project-in-remark` | the remark names exactly one project and exactly one candidate is on it | the ONLY rule allowed to fire across projects — it is the only one holding evidence about *which* project |
| **M2** `nearest-amount` | one candidate is strictly nearer the bank's amount than every other | **FENCED to a single project.** Across projects, 8 paise closer is not evidence about which job the money was for; within one project the worst case is the wrong document on the right job |
| **M3** `interchangeable` | every candidate is on the SAME project at the SAME amount | **FENCED HARDER** — and switched OFF for stack members (below) |
| **M4** `nearest-decision-date` | one candidate was decided strictly nearest the day the money moved, within **±3 days** | **NOT FENCED** — an owner ruling, held as the flippable `NEAREST_DATE_FENCE_TO_ONE_PROJECT` |

Measured: ready **807 → 833**, needs-a-person **56 → 30**.

### M4 — the nearest decision date (2026-08-11)

**Where the date comes from is `ledgers.DECIDED_ON_SQL`, the one owner:** payments use
`COALESCE(ceo_approval_date, approval_date)` (CEO first — a payment needing that signature is not
payable until it exists, and the two differ by days on exactly the high-value rows); **both expense
doctypes use `modified`, because neither has an approval date, an approver, or an approval step at
all.**

⚠️ **THAT MERGE IS FORBIDDEN ON THE APPROVED INBOX AND PERMITTED HERE, AND THE DIFFERENCE IS THE
WHOLE LICENCE.** `ledger_read.py` keeps `approved_on` and `updated_on` apart because a human reads
that column and a modification timestamp is not a sanction. `decided_on` is a MATCHING input nobody
reads as a label — **so every note built from it MUST name which date it used** (`_date_source`).
Without that, a reviewer cannot tell an approval from someone fixing a description, on the screen
where money is authorised.

⚠️ **M4 RUNS LAST, WHICH IS WHAT MAKES IT PURELY ADDITIVE** — it fires only where
`pick_from_several` previously returned None, so no M1/M2/M3 pick already in the database moves
because of it.

⚠️ **THE SINGLE-PROJECT FENCE HAD TO BECOME A BRANCH.** It used to `return None`, so a cross-project
set left the function outright and **no rule written below it could ever see one**. M4 is unfenced,
so it sits outside that branch — inside, it would have been silently reduced to the single-project
half of its own measurement.

⚠️ **A STACK MEMBER STILL REACHES M4.** M3's fence used to `return None`, short-circuiting it — but
declining M3 says only *"do not pick ARBITRARILY between interchangeable records"*, which is why M1
and M2 were always left on for stack members. M4 is evidence, so it belongs on the same side of that
line. Measured cost of the bug: two rows whose candidates were decided **seven days apart** were
handed to a person as though nothing distinguished them.

⚠️ **MEASURED HONESTLY, IT RESOLVES 2 OF 30 — not the 8 first projected.** Nearly every ambiguous row
is in a stack sharing one candidate pool, so the first row takes the nearest record and its siblings
find it gone. **A measurement that does not accumulate claims as the real pass does overstates this
by a factor of three**; two successive estimates (8, then 6) were wrong for exactly that reason. The
rest are batch approvals — identical dates, where the rule is silent by construction.

⚠️ **A BLANK PROJECT IS NOT A PROJECT.** If any candidate has no project the single-project fence
FAILS, so M2 and M3 stay out. Treating blanks as equal lets a missing value stand in for evidence,
which is the whole failure the fence exists to prevent.

⚠️ **M3 MUST BE OFF FOR A STACK MEMBER, AND THIS IS AN OWNER RULING, NOT A DETAIL.** An unbalanced
stack pairs NOTHING, not even partially; M3 applied per row does exactly that partial pairing — the
first six transfers each take a record and the seventh finds them all claimed. **Measured when it
shipped unfenced: 62 of 65 interchangeable picks landed on stack members and the leftovers screen
fell from 6 stacks to 3, because the pass had quietly consumed the difference.** The caller passes
`allow_interchangeable=False` for any row in a stack. **M1 and M2 stay ON for stack members**, and
that distinction IS the ruling: they act on evidence about one specific transfer; arbitrary-among-
interchangeable is the case the stack machinery owns.

⚠️ **CLAIM-AWARENESS IS WHAT MAKES M3 WORK.** Seven transfers against eight twin records only resolve
if each takes a DIFFERENT one, so the caller feeds back what it has already handed out. Without it
every twin row picks the same record and `_enforce_single_claim` releases all but one — turning the
best-covered rule into the worst.

### A record is claimed once (`claims.py`)

`sole_suggestion` asks a question about ONE row and answers it independently for every row, so **two
transfers can each correctly find the same single record**. Five records were in that state across 15
rows on the first real statement; **ten of the 807 confirms were doomed with `AlreadyPaidError`
before anybody pressed the button.**

⚠️ **THE VENDOR ROLLUP IS WHY THIS BECAME URGENT RATHER THAN MERELY WRONG.** The rival transfers are
usually to DIFFERENT beneficiaries — one record was suggested to four of them. A flat list sorted by
amount puts them near each other, so a person could notice. **A tree grouped by vendor puts them in
four separate branches and the conflict becomes invisible from every screen position.** The rollup
does not create the defect; it removes the last chance of seeing it.

- ⚠️ **`_resolve_stacks` already guarded this, and only for itself** — it reads a `claimed` set so the
  stack pass cannot take a record a 1:1 row holds. Nothing protected the per-row loop from itself.
- **`releasable` is the scope fence.** The pass READS across imports and WRITES only inside the batch
  being matched: clearing another import's pre-selection is not filling a blank, so it does not get
  the licence `_resolve_stacks` has. An unreleasable claim always wins.
- Contenders are ordered by `(added_on, row name)` — the name is unique, so no tie survives to be
  broken by query order, the same guarantee `pair_stack` relies on.

### ⚠️ `suggestion_rule`, `match_basis` and `auto_matched` answer THREE different questions

Blank used to mean both "no rule" **and** "no suggestion", and that ambiguity filed **112 arbitrary
stack pairings under "Only candidate"**.

| Field | Answers | Vocabulary |
|---|---|---|
| `suggestion_rule` | **how** was this one record chosen? | `sole` · `stack-pairing` · `project-in-remark` · `nearest-amount` · `interchangeable` |
| `match_basis` | **which tier** found the counterpart? | the tier ladder |
| `auto_matched` | Check, **stored** not derived, so Desk can filter on it | written in the SAME `set_value` as the pair at every site, so it cannot drift |

**Blank `suggestion_rule` now means only that there is no suggestion.** `RULE_SOLE` and
`RULE_STACK_PAIRING` live in `disambiguate.py` although it never produces them, because the FIELD
needs one vocabulary rather than one per writer.

---

## The invariants that break silently

0. **`_settleable_candidates` must read EVERY payment group, not `best_payment_group`.** This was
   the worst defect the feature has shipped, found on the first real 1,043-row statement
   (2026-08-10). `best_payment_group` is `payment_groups[0]`; taking only it collapsed N separate
   approved payments into ONE candidate, so `sole_suggestion` pre-selected an arbitrary record —
   breaking its own owner-locked "exactly one, or nothing" — and `_matched_note` announced *"One
   approved record at this amount"* when there were six. **Payment-vs-payment ambiguity, the common
   case on the main ledger, could not be represented at all**, which is why only 5 rows in 1,043
   ever read as ambiguous. Measured cost: 124 confirmations doomed before the button was pressed;
   58 of 117 rows claiming a sole record had several. ⚠️ **A fan-out group still counts ONCE** —
   its targets settle together, so there is nothing to choose between. ⚠️ **Every fixture built a
   single group, which is why a fully green suite said nothing.** `test_status._match_many` exists
   to build the N-separate-groups shape; use it for any new candidate test.

1. **Only `Approved` is ever matched.** `Requested` / `CEO Pending` → plain `Mismatched`. No status,
   no nudge, no approval deep link. This REVERSED an earlier goal (surfacing the 111 CEO-Pending
   payments); it was removed deliberately and must not be re-added.
2. **The already-Paid check is a SKIP, not a match** (Q14) — and it is the **only** route to
   `Mismatched`. Delete it and a hand-ticked payment reads `Mismatched` carrying the FOUND-NOTHING note, and the obvious next click
   books the same money twice.
3. **`Mismatched` is AMOUNTS ONLY, and only beyond the settle window.** The v2 `Reference mismatch`
   branch is deleted, not folded in. A reference is only ever *written into a blank*, never compared.
   ⚠️ This branch used **exact** equality until 2026-08-07, which made every hand-ticked payment
   carrying paise a "discrepancy" — 8 of 26 rows on a live statement, over gaps of 14 to 86 paise,
   each announced with a note suggesting TDS. `status.py` now imports `amounts.amounts_match`; that
   is its **one** permitted package import and the purity test was narrowed to say so.
   ⚠️ It reads the **settle** window (now ±₹5), not tier 1's ±₹1 — a duplicate guard asks the same
   question the write guard asks. Accepted consequence of the widening: a hand-ticked payment ₹4 off
   now reads `Skipped` rather than `Mismatched`.
4. **`for_update=True` must never carry `cache=True`.** Frappe skips the row lock on a cached read,
   which makes the concurrency guard decorative.
5. **Two payment hooks commit mid-save** — `update_parent_amount_paid` and the Approved→Paid
   notification cascade. Both are suppressed by `doc.flags.from_outflow_import` (set in exactly one
   place, read in exactly two). `amount_paid` is still recomputed, inside the same transaction. The
   test is not "is this side effect wanted" but **"does it commit"** — a commit inside the savepoint
   makes the rollback a silent no-op.
6. **Both amount windows live in ONE place** — see the residence manifest. ⚠️ **A fixture that pins a
   REFUSAL by amount must sit clearly OUTSIDE the settle window, never one step past its edge.** The
   edge has moved twice, and both times a `+1` / `+5` margin silently turned a refusal test into an
   acceptance test that still asserted a refusal (`test_expenses.py`, 2026-08-06 and 2026-08-07).
7. **`Outflow Row Match` records SETTLEMENTS ONLY.** A match run writes none. A suggestion stored
   there would take the `(transfer_id, target_doctype, target_name)` unique key before the settlement
   that needs it — failing the confirm on the happy path. The match run's suggestion therefore lives
   on **two read-only fields of the import row**, which go nowhere near that key. Do not "restore
   consistency" by moving them into the match table.
8. **The two expense doctypes are not twins.** `Project Expenses.amount` is a **Data** column of
   numeric strings; the non-project one is real **Currency**. `payment_by` exists only on the project
   side. `Non Project Expenses` has no vendor and no project column. Expense Type is **scoped** —
   switching ledger must clear the chosen type, because most types are available on one side only.

   ⚠️ **CORRECTED 2026-08-13: the two flags are NOT disjoint, and never were.** This line used to
   say they were. The schema has always allowed both, and the live master has always had
   counter-examples — `Travel Expenses (Bus)` and `Travel Expenses (Train)` carry `project = 1` AND
   `non_project = 1`. The real shape is 12 project-only, 25 non-project-only, 2 shared. It read as
   a constraint and was only ever a convention, which mattered the moment something needed a type
   usable on both sides: `Petty Cash`, the Cashbook import's fallback (ADR-0015), carries both
   deliberately. **Do not restore the stronger claim** — `settle._assert_type_scope` checks the
   flag for the side being written and is the only rule there is.
9. **Neither expense doctype has an approval date.** No field, no approver — only `Project Payments`
   records one (`approval_date` / `ceo_approval_date`). The search endpoint therefore returns
   `approved_on` for payments and `updated_on` (the modification timestamp) for expenses, under
   **separate keys**, and the screen labels them "approved" vs "updated". Merging them into one key
   would present a modification as an approval on two thirds of the list.
10. **`Outflow Import Row.remarks` must stay `Text`.** As `Data` it is `varchar(140)` and Frappe
    *throws* rather than truncating.
11. **A settle WRITES MONEY as of X1, and three things hold it safe.** The record takes the bank's
    amount whenever the two differ (`amounts.rewrite_amount`), both directions, all three ledgers.
    (a) **The ±₹5 guard still runs first** — the rewrite corrects what is written and never widens
    what may be written, so TDS is still unreachable. (b) **Every change is audited**, which is why
    the expense path had to move off `frappe.db.set_value` onto `doc.save()`: `set_value` skips the
    document lifecycle, so `track_changes` is inert for it and the rewrite would have left no record
    of who changed the figure or what it had been. (c) **The bank OVERPAYING rewrites too** — owner
    ruling, so this import can record spending slightly above an approval, and the Version log is
    the only thing that says so.
12. **That expense switch woke a third committer, and the suppression is narrow on purpose.**
    `project_cashflow_hold_update` is wired to `Project Payments` **and** `Project Expenses`
    `on_update`, and reaches a `frappe.db.commit()` in ONE branch — notifying the holder of a manual
    CEO Hold that has become releasable. `settle.py` sets `frappe.flags.outflow_import_settling`
    around its saves and that branch bails on it. ⚠️ **It guards the NOTIFY, not the RECOMPUTE:**
    `sync_cashflow_reason` never commits, so the gap still recalculates inside the import's
    transaction. A request-level flag rather than `doc.flags` because the commit sits in an inner
    helper that never sees the doc — restored in a `finally`, never blindly cleared. Two side notes:
    the payment path had been exposed to that same commit since V2 (X1 closes it, does not open it),
    and **settling an expense never moved the CEO-Hold gap at all before X1**, because `set_value`
    fires no hooks.
13. **A FAILED transfer is excluded from every figure the import summary reports** (owner ruling
    2026-08-10, "option B", chosen over dropping the row entirely). It is money the bank refused to
    move: counting it in `total_value` overstates the statement by exactly the amount that never
    left the account, and counting it in `total_rows` makes `decided_percent` a percentage of work
    that does not exist. ⚠️ **THE ROW IS STILL STAGED** — that is the whole of what option B chose
    over option A, and the evidence that the bank rejected a transfer survives on it. What was
    removed is its effect on the numbers, never its existence.
    - The split happens in the **aggregate**: `get_import_summary` groups by `(row_status, failed)`,
      because `Skipped` covers three different facts (failed at the bank, a duplicate, a payment
      hand-ticked Paid) and only the first leaves the figures.
    - ⚠️ **`StatusTally.failed` tallies are excluded from `by_status` TOO.** This used to
      be followed by "so `sum(by_status counts) == total_rows` still holds *in the aggregate*".
      **THAT INVARIANT IS RETIRED (owner ruling 2026-08-21) and must not be restored** — `Skipped`
      is now excluded from `total_rows` / `total_value` as well, via
      `status.SUMMARY_EXCLUDED_STATUSES`, so a status sits in `by_status` without counting toward
      the total by design. **What holds instead is `total_rows == open_rows + settled_rows`,
      exactly**, and `decided_rows` is now `settled_rows` alone rather than the sum over
      `TERMINAL_ROW_STATUSES`. The reason is measured, not aesthetic: 544 of 640 skipped rows on the
      live database are cross-batch duplicates already counted in an earlier statement, so a
      ₹2.85 crore "Total outflow" was mostly the same money counted twice. ⚠️
      **`TERMINAL_ROW_STATUSES` ITSELF IS UNTOUCHED AND MUST STAY SO** — `derive_batch_status`,
      `batch_is_open` and `review._FROZEN_ROW_STATUSES` all read it, so narrowing it to "fix" this
      would change which statements Re-run match touches. The exclusion is LOCAL to
      `derive_import_summary`. Pinned by
      `test_status.TestSkippedLeavesTheStatementTotals::test_TERMINAL_ROW_STATUSES_STILL_CONTAINS_SKIPPED`.
      ⚠️ **The Skipped chip and the failed footnote were deliberately NOT changed** (owner,
      same ruling), so the footnote still names only the failed rows as excluded. That is a known,
      accepted gap, not an oversight.
      **⚠️ THE SKIPPED CHIP NO LONGER RENDERS THAT FIGURE (owner, 2026-08-11).** `derive_import_summary`
      is UNCHANGED — `skipped_rows` is still 20 — but `summaryTiles` renders
      `skipped_rows + failed_rows`, because `row_status` is `Skipped` on all 47 and the chip is now a
      **door**: it opens the Skipped dialog, which holds 47. A chip reading 20 that opened a list of
      47 read as a bug however right both numbers were. The accepted cost is the one this bullet
      originally forbade — the four chips now sum to `total_rows + failed_rows` — and it is paid down
      by the split line beneath them (`N refused by the bank · N auto-skipped · N by hand`), which
      accounts for the chip exactly. **The failed footnote had to change with it:** it used to say
      "excluded from every figure above", which stopped being true the moment the chip counted them;
      it now names the MONEY figures only. Anything that reverts the chip must revert that sentence
      too, or the panel contradicts itself again in the other direction.
    - **`get_outflow_rows` takes `failed`** (tri-state: absent = both halves) so the two facts inside
      `Skipped` can be asked for separately — the Skipped dialog's `All / Already paid / Bank refused`
      control. It binds `parser.BANK_SUCCESS_STATUS` rather than spelling `'SUCCESS'` a second time,
      and it lives in `_row_filters`, so a filtered view's tab counts move with it.
    - ⚠️ **`auto_skipped` excludes them on the same terms**, or `manually_skipped_rows`
      (`skipped_rows - auto_skipped`) subtracts rows its minuend no longer contains.
    - `status.py` stays ignorant of the bank's vocabulary. The single definition of "successful" is
      `parser.is_success_status` / `parser.BANK_SUCCESS_STATUS`, which the SQL **binds** rather than
      spelling `'SUCCESS'` a second time. `RawRow.is_success` calls the same function.
    - **`gross_amount` already excluded failed rows at parse time and always had** — do NOT subtract
      them again anywhere downstream, or the same money is deducted twice.
    - Reported only as `failed_rows` / `failed_value`, which the summary panel renders as a
      footnote. ⚠️ **If that line goes, option B silently becomes option A.**
14. **`get_confirmable_rows` returns THREE buckets, and the third exists because two screens
    disagreed.** The summary panel's button reads `confirmable_rows` from `get_import_summary`,
    which counts `Matched` rows carrying a `suggested_name` **without checking the name still
    resolves**; the dialog checks. A row whose suggested record was deleted since the match ran was
    therefore inside the button's count and silently absent from the dialog — live-observed as
    *"button 688, table 893"*, where both numbers were right and nothing on screen reconciled them.
    - `matched_rows = ready + stale + needs_you`; `confirmable_rows (the button) = ready + stale`.
    - `needs_you` = the matcher found SEVERAL records and deliberately picked none. `stale` = it
      picked one and that record is gone. **Different problems, different fixes** — folded together,
      the gap was unexplainable from the screen.
    - ⚠️ **The fix is NOT to make the two numbers equal.** They measure different things and should
      not be forced to agree; the fix is that the funnel is now stateable, and the dialog states it.
15. **The settled record takes the statement as its `payment_attachment`, into a BLANK ONLY** (owner
    ruling 2026-08-10). All three ledgers spell the field the same way; the write is
    `settle.apply_statement_attachment`, called **before** `doc.save()` so the attachment rides the
    same save, the same audit Version and the same savepoint as the settlement — a write afterwards
    could survive a rolled-back settle.
    - ⚠️ **Blank-only is the same rule the `utr` write follows** (Q5b), for the same reason:
      `payment_attachment` is where an accountant puts the proof of THIS payment. Replacing that
      with a thousand-row statement swaps specific evidence for general evidence on a field nobody
      asked us to touch. A record that already has a proof keeps it.
    - ⚠️ **Copying the URL copies a link, not a permission.** The statement is `is_private=1` and
      attached to the *import batch*; Frappe authorises a private file through the document it is
      attached to. `expenses._link_statement_file_to_target` creates the second `File` row that
      makes it openable from the payment or expense.

16. **The browse ranking must never reach anything that SETTLES** (N1). `similarity.py` orders a list
    a person reads and then confirms; `matcher`, `disambiguate` and `status` decide what moves money.
    The weights in `SimilarityPolicy` exist **precisely to be tuned** against reviewer feedback — so
    if the two were connected, a tweak made because a list *felt* wrongly ordered would change which
    transfers settle unattended, and nothing would report it. Pinned **both ways** by
    `test_similarity.TestThePolicyIsSeparateFromTheMatchers`: `similarity` imports none of them, and
    none of them mentions `similarity`.
    - ⚠️ **The same reasoning forbids reusing `matcher.VendorScoringPolicy`.** The numbers are
      deliberately similar — they came from the same vendor master and it would be perverse to
      disagree with them for no reason — but sharing the dataclass would retune the matcher every
      time the browse list is retuned, which is the connection this invariant exists to prevent.
    - ⚠️ **Sharing the TOKENISER is not sharing a POLICY.** `project_match.comparable_tokens` is
      public and read by both, on purpose: "which words count" must have ONE owner or the ranked list
      quietly stops agreeing with the matcher about what a word even is. The WEIGHTS are what stay
      apart.
    - ⚠️ **That `File` insert runs AFTER the commit and outside the savepoint, and must never
      raise.** A `File` insert wakes the cloud-attachment hook, which commits inside the request —
      inside the caller's savepoint that would make the per-row rollback a silent no-op. And by the
      time it runs the money is already written, so failing the request would report a successful
      settlement as an error and invite a retry against a record that is already Paid. It logs and
      swallows; the degraded outcome is "the attachment may 403", which is far smaller.
    - A newly created expense always takes it — a record born from a statement should carry it.

---

## The screen

**ONE screen (X3 + X4), and the shape reversed there.** Until X3 a SHEET was a place: a list of
imports → open one → see its rows, which existed only inside it. Now the **transactions** are the
thing — one master table across every import at `/bulk-import-outflow` — and an import is an
*attribute* of a row: a column, a filter, and the subject of the summary panel above.

- **The table is SERVER-paged, filtered, sorted and searched** (`review.get_outflow_rows`). The
  client filter engine (`matchesQuery` / `passesFilters` / `visibleRows` / `facetValues`) was
  **deleted, not bypassed** — two engines answering "which rows match" disagree the day one is
  edited. What survives in the pure model is `serverQuery`, which owns the *meaning* of a filter;
  SQL owns the *application*. `rowsForTab` / `tabCounts` went too: the tab numbers now come from
  the endpoint, computed **under the current filters**, so a search matching four rows can never
  show "Settled 812" beside it.
- **The per-column funnels survived the move**, and keeping them was deliberate — dropping them
  would have been a silent capability cut in a refactor. Their distinct values come from
  `get_outflow_facet_values` over the whole filtered table, fetched lazily on first open. ⚠️ That
  endpoint deliberately does **not** apply the funnel's own selection: a funnel that filtered its
  own options would collapse to whatever is ticked and offer no way back.
- **Default scope is the work, not the archive** (owner ruling) — a worklist first. Since the retab
  that default is `not_matched`, **narrower than the old `open`**, which also held `Matched`.
- **`/bulk-import-outflow/:id` is KEPT** and renders the same page pre-scoped to that import, so
  every pre-X3 link still resolves. `/new` is gone; uploading is a dialog.
- **Three tabs — All / Not-Matched / Matched & Settled** (owner ruling 2026-08-10, replacing
  Pending / Settled / Skipped) — plus the per-row decision dialog, unchanged.

  | Tab | Scope | Holds |
  |---|---|---|
  | All | `all` | everything **except Skipped** |
  | Not-Matched | `not_matched` | `Pending match run` · `Mismatched` · `Error` |
  | Matched / Settled | `matched` | `Matched` · `Settled` |

  ⚠️ **ALL THREE TABS ARE SCOPED BY THE PERIOD SINCE P1**, and so is the Skipped dialog — the
  period is the `added_on` column's filter, and `_row_filters` applies it to every one of these
  reads. `tab_counts` therefore describes the period, exactly as it already described the search.

  ⚠️ **`Skipped` HAS NO TAB, AND IS EXCLUDED FROM `all` TOO.** "All" means everything a person might
  still act on, not every row. Skipped rows are bookkeeping — a failed transfer, a duplicate, a
  payment already ticked Paid by hand — and **the import summary panel's auto/manual split line is
  now the ONLY place they are reported.** Delete that line and a skipped transfer becomes invisible
  rather than merely out of the way. Pinned by `test_no_scope_will_show_a_skipped_row`.

  ⚠️ **`all` CARRIES A REAL WHERE CLAUSE NOW.** It used to fall through to "no clause", correct when
  it meant every row. `_scope_clause`'s unknown-scope fallback had to change with it — it falls back
  to **`all`**, not to no-clause, or a typo'd scope leaks skipped rows into the one view nobody
  would think to check.

  ⚠️ **`Matched` AND `Settled` SHARE A TAB, pairing an OPEN status with a TERMINAL one.** That is
  the reviewer's grouping ("this transfer has a record"), not the vocabulary's, and it has a
  consequence: **row selection is PER ROW, not per tab.** The old table took one `selectable`
  boolean because the tabs partitioned open from terminal; they no longer do, so the page passes
  `selectableRowNames` (derived from `OPEN_ROW_STATUSES`) and select-all acts only on those. The
  checkbox `<td>` still renders — empty — for an unselectable row, or every later cell in that row
  shifts one column left.

  `tab_counts` is keyed by SCOPE name, and every count is derived from `_SCOPE_STATUSES` rather than
  a second hand-written list — a count that disagrees with what its tab shows is worse than none.
- ⚠️ **THE SUMMARY PANEL SUMMARISES A PERIOD, NOT ONE IMPORT — owner ruling 2026-08-12 (slice P1),
  REVERSING the 2026-08-10 position recorded here.** That entry read: *"the summary panel above
  summarises ONE import while the table spans all of them. That is the design: 'how did that
  statement go?' and 'what do I still owe a decision on?' are different questions."* The owner took
  the other side. A **period control** above the panel now scopes the summary **and** the three
  tabs, and the import picker is gone.
  - **The two now describe ONE population, which is what let the ruling be revised rather than
    merely overridden.** The 2026-08-10 objection had two halves. The first was a POPULATION
    mismatch — *"a panel describing ONE import silently rewrote the filters of a table spanning ALL
    of them"* — and that dissolves when there is only one population. **The second half STANDS and
    is deliberately kept: a click must never MOVE THE TAB.** The status figures still REPORT,
    `SummaryTile.statuses` and `tabForStatus` stay deleted, and changing the period does not change
    which tab is open.
  - **Every sibling read takes the same filter set and builds it with the same `_row_filters`:**
    `get_outflow_summary`, `get_outflow_rows`, `get_confirmable_rows`, `match_period` and the facet
    values. The frontend passes ONE object (`useOutflowRows().filterQuery`, derived by stripping
    scope/sort/paging off the query the table just sent), so a panel figure and a tab count cannot
    be computed under different filters. **The scope (the tab) is excluded from all of them** — it
    partitions the population rather than narrowing it, the same rule `_tab_counts` follows.
  - **`derive_import_summary` needed NO change.** It folds a stream of `StatusTally` and has never
    known what a batch is, so widening from one import to a period was a WHERE-clause change only.
    **`get_import_summary(batch)` survives as a thin wrapper** over `get_outflow_summary(batch=X)`
    plus the statement's metadata — kept because `test_review` reads it and because it is the
    regression pin: `batch=X` and nothing else IS the pre-P1 clause, so the two can never drift
    (`test_one_batch_reproduces_the_old_endpoint_EXACTLY`).
  - ⚠️ **A ROW WITH NO `added_on` SURVIVES EVERY PERIOD, and the `IS NULL` in `_row_filters` is the
    whole point of those two clauses.** The bank's date column is free text and does not always
    parse — the parser stores NULL rather than guessing, and the fixture carries a literal
    `not-a-date` for the case. Under a plain `>=` / `<` bound such a row matches NO window, so once
    the period became the screen's SCOPE it would have vanished from the summary, all three tabs and
    the Skipped dialog simultaneously, **with no filter on screen able to bring it back**. The
    transfer still moved money and still needs settling. Found by a test, not by the screen.
  - ⚠️ **RE-MATCHING REACHES FURTHER THAN THE PERIOD, AND THE SCREEN SAYS SO.** `match_period`
    resolves which batches the filters touch and **loops `match_batch` per batch** — the matching
    unit stays a whole statement, because its four global passes reason over a batch at once and a
    partial picture would break claims and stacks. So a statement straddling the window is
    re-matched **in full**. `get_outflow_summary().imports` carries each batch's `row_count` (in
    scope) beside `total_rows` (in the batch) so `rematchWarning` can state the overspill *before*
    the click. Do not "fix" this by narrowing the match; keep the warning honest.
    - ⚠️ **`match_period` SORTS ITS OWN BATCH LIST, AND THE COUPLING IT REPLACED ALMOST SHIPPED A
      SILENT DEFECT (CF/S3).** It used to call `_imports_in_scope` and `.reverse()` the result to
      get oldest-first — borrowing its meaning from a PICKER'S sort order. That order decides where
      a **contested record lands**: a record two imports both match goes to the earlier transfer
      under `resolve_claims`' `(added_on, row name)` ordering, so the batch matched first places the
      claim. When CF/S3 re-ordered that reader by `period_to` — a presentation change, asked for as
      one — matching order would have changed with it, and **nothing would have failed anywhere.**
      The rule now lives in `_match_order`, in full, separately tested. A batch with no
      `uploaded_at` still sorts first (`DESC NULLS LAST` reversed is `ASC NULLS FIRST`); the unique
      name breaks ties so query order never decides.
    - ⚠️ **THE COUNT CAME OFF THE BUTTON AND THE FILENAME LIST WENT BEHIND AN ICON, IN THE SAME
      CHANGE (CF/S4 + CF/S5), SO THE CAPTION IS NOW LOAD-BEARING.** Two things used to state this
      action's reach. Both are gone, and `rematchReachLabel` ("Re-run reaches 3 open imports.")
      is the ONLY pre-click statement of scope left on the screen. It counts **open** imports, since
      `match_period` skips the finished ones — naming statements the button will not touch is the
      same class of lie as "button 688, table 893", pointing the other way. If this line goes, the
      overspill becomes something a reviewer discovers afterwards.
  - ⚠️ **"Confirm all matched" REFUSES a set too large to review rather than truncating it**
    (`_MAX_CONFIRMABLE`, 2000). The dialog is a SAFETY CONTROL that states what the button will
    write, including how many approved amounts it will REWRITE; a silent `LIMIT` would show a list
    shorter than the count on the button that opened it, over a set nobody chose, with the missing
    rows sharing no property anything on screen could name. The refusal names the number and says to
    narrow. Sized so any single real statement always fits, so narrowing to one import is always a
    way through.
  - ⚠️ **THE IMPORT SELECTOR IS BACK, DEMOTED (owner ruling 2026-08-12, same day).** A top-level
    `Import` control sits LEFT of the period. **Empty is the default and means "every import"** —
    the period-scoped screen above. Selecting a statement switches the whole screen to **that
    statement's own summary**, which is the pre-P1 view, now available on demand instead of being
    the only mode. System-wide by default; one statement when asked.
    - ⚠️ **SELECTING AN IMPORT IGNORES THE PERIOD — it does not AND with it (owner ruling).** "That
      sheet's summary" means the WHOLE statement. `useOutflowRows` withholds the period whenever a
      batch is pinned, which is the same rule that fixed the deep link (below) — one rule, not two.
    - ⚠️ **THE PERIOD CONTROL IS DISABLED, NOT HIDDEN, while an import is selected**, reading
      `Not applied · whole statement`. A control that VANISHES leaves the reader unable to tell "no
      period applies" from "a period applies and I cannot see it" — and the second is a defect this
      screen actually shipped (below). It must also not keep NAMING a window while greyed: showing
      "Last 30 days" disabled reads as "applied, just not editable", the opposite of the truth.
    - **`/bulk-import-outflow/:id` IS the selection** — the route param is the only copy of it, so
      the two can never contradict each other. Picking a statement navigates there; picking "All
      imports" navigates back to the bare path. Every pre-P1 bookmark resolves AND now has a way out
      of itself, which the old deep-linked mode did not. Switching remounts the page (two route
      entries), which is correct: different rows, so the ticked selection and un-confirmed decisions
      should reset. The period survives, because it lives in a module-level store.
    - `get_outflow_summary` returns the statement's metadata under `import` **only when a batch is
      selected** — absent across a period, because several statements have no single filename,
      uploader or declared period and inventing one captions the panel with the wrong statement.
      That moved INTO the period-scoped read so `get_import_summary` could become a **pure
      delegate**: one query answering "how did that statement go", never two that could drift.
  - ⚠️ **THE DEEP LINK SHIPPED SILENTLY FILTERED, AND IT IS THE REASON FOR THE RULES ABOVE.** Found
    in the browser walk, not by a test: `/bulk-import-outflow/OFI-26-00289` reported **274 transfers
    out of 1,043**, because a period left in the store by an earlier visit was still applied while
    the control was hidden. Every number wrong, everything looking right, and nothing on screen able
    to reveal or clear it. An invisible filter is the worst kind.
  - ⚠️ **A FRESH IMPORT NO LONGER MOVES THE PERIOD — IT PINS THE IMPORT SELECTOR INSTEAD**
    (owner ruling 2026-08-21, REVERSING the P1 behaviour recorded here). That entry read: *"a fresh
    import moves the screen to the statement's own declared period"*, on the reasoning that a
    statement uploaded weeks late lands outside `last 30 days`, so the page would refresh to a
    summary that does not mention it and a table that does not list it — **which reads as a failed
    upload**. That reasoning still stands and is what makes "do nothing" the wrong answer.
    - What replaced it: the page remembers the imported batch and PINS it through the existing
      `handleSelectImport`. **A pinned import IGNORES the period entirely** (the 2026-08-12 ruling
      above), so the whole statement is in view AND the reviewer's own period survives untouched in
      its store. One rule doing two jobs, rather than a second rule.
    - ⚠️ **IT FIRES ON THE DIALOG'S open → closed TRANSITION, NEVER IN `onImported`.** Pinning
      navigates to `/bulk-import-outflow/<id>`, which REMOUNTS the page. Cashbook closes its dialog
      immediately after import, but **Cashfree keeps it open through step 4** (CF/S7) — pinning at
      import time would unmount the wizard mid-flow. One transition covers both.
    - `setSources([])` and the Cashbook `setTab("matched")` are UNCHANGED and both still correct —
      clearing the source can only ever widen what is in view, and a pinned Cashbook import is 100%
      `Settled`, so the default worklist tab would otherwise be empty.
- **The import dialog runs the match itself** — there is no case where somebody imports a statement
  and does not want it matched. A manual **Re-run match** stays on the summary, because re-running is
  normal (payments get hand-ticked all day). ⚠️ If the upload succeeds and the match then fails, that
  is reported as a MATCH failure — the rows *are* staged, and saying "upload failed" would send
  someone to re-import a statement that is already in.
  - ⚠️ **IT NO LONGER CLOSES WHEN THE MATCH FINISHES (CF/S7).** It is a **4-step wizard** — Upload →
    Check → Import & match → **Confirm** — and the owner's ruling was that one dialog must not close
    so another can open. Cashbook keeps its own 3 steps (Upload → Review plan → Create); two step
    lists, because the jobs are opposite and a shared list would need a step meaning nothing on one
    side. The step is **DERIVED** from what the server has done (`importWizard.currentStepIndex`),
    never held as a separate pointer that could describe something that did not happen.
  - ⚠️ **STEP 4 IS DELIBERATELY UNFILTERED — every confirmable transfer, any import, any period**
    (owner ruling). The reason to press Re-run after an upload is that a payment approved yesterday
    belongs to an OLDER statement. A confirmable row is `Matched` **with a stored suggestion**, which
    only exists inside an open batch, so "no filters" already IS the open-import set with no new
    server concept. Two costs, accepted and designed for: an old unconfirmed statement appears there,
    and `_MAX_CONFIRMABLE` (2,000) is reachable — the panel renders that refusal and sends the
    reviewer to the summary, where the narrowing controls are.
  - ⚠️ **A FAILED MATCH STAYS ON STEP 3.** Advancing would show an honestly empty confirm list for
    entirely the wrong reason: *"nothing matched"* and *"the match never ran"* are different
    sentences and only the second has a Re-run as its answer. The footer's Re-run is the fix and
    there is deliberately no second copy in the body.
  - **Back is possible between steps 1 and 2 only**, and the boundary is *has anything been written*
    (`canStepBack`). From step 3 the rows are staged and "back" would offer a re-upload the
    duplicate guard will refuse. **Finish later** is always available once they are — the step says
    plainly that the transfers are already in.
  - The dialog refuses to close while anything is writing, including the settle loop inside step 4:
    that is the panel's own state, reported up through `onRunningChange`, because only a host knows
    what its dismiss is.
- **`ConfirmMatchedPanel` is the confirm tree; `ConfirmAllMatchedDialog` is a thin shell over it**
  (CF/S6). The summary button and wizard step 4 render ONE implementation — two copies of a tree
  that decides what a click WRITES (including how many approved amounts it rewrites) would be free
  to disagree about exactly that. ⚠️ **This is NOT the extraction the Cashbook slice rejected**: that
  one tried to share the tri-state TREE with `CashbookReviewTree`, and that finding stands. This
  moved the whole panel out of its `<Dialog>` shell, intact, sharing nothing with that file.
- **The History dialog holds the last 10 imports** (CF/S4), behind a clock icon beside *Import
  statement*; it replaced the filename list at the foot of the summary card. Fed by the SAME
  `list_imports` the picker reads, so the two can never disagree about what exists. Obeys the Source
  scope, **ignores** the period (it lists FILES, and a file's period is a column in it). ⚠️ Its count
  is `successful_rows`, never `total_rows`, because it sits beside `gross_amount` — which has
  excluded bank-refused transfers since parse time. Two figures describing different populations on
  one line is the Skipped-chip defect in a smaller frame.
- **The `Reference` column is no longer "Reference (UTR)"** (CF/S1). It falls back to the wallet's
  `transfer_id`, so a Cashbook row stops rendering blank while the expense it created carries a
  reference. Shown as the **last 12 characters** when longer — ⚠️ **display only**: the stored
  `payment_ref` keeps its full value (a truncated one is the blank-reference defect wearing a value),
  and the shortening must never reach `column.get`, which feeds sort, funnels and facet values.
- **The `Import` column is HIDDEN by default, not deleted** (CF/S1). In this table a filter IS a
  column header, so deleting it would have taken the Import facet with it — a request about screen
  width silently cutting the ability to filter by statement.
- **The `Ledger` column is VISIBLE by default, and the asymmetry with its two hidden neighbours is
  deliberate** (2026-08-21). It shows which of the three ledgers a row settled against, sits between
  `Status` and `Outcome` because it qualifies the status ("Settled, against what"), and is blank on
  an unsettled row.
  - Its value is DERIVED at read time through `ledgers.SETTLED_LEDGER_SQL`, not stored — unlike
    `settlement_origin`, which is denormalised onto the row.
  - ⚠️ **IT IS DELIBERATELY NOT SORTABLE.** It is absent from `_SORTABLE_COLUMNS` server-side and
    from `SERVER_SORT_COLUMNS` client-side, which is what withholds the header's sort affordance —
    `HeaderCell` renders a plain `<span>` for a column outside that list, and `serverQuery`
    independently falls back to `added_on`, so even a forced sort state cannot reach the server.
    Sorting a per-row correlated probe over the whole filtered table is the cost; blank on most rows
    is the reason it would buy little. Adding it needs a measurement, not symmetry.
  - ⚠️ **REGISTERING THE FACET TAKES THREE LISTS, NOT ONE**: the server's `_FACET_COLUMNS`, the
    server's SELECT list, and the client's `SERVER_FACET_COLUMNS`. `settlement_origin` shipped with
    only the first and rendered an em dash on 849 settled rows; a column added to only the third
    registers a tick box whose row set never moves. All three or none.
  - Empty on the Not-Matched tab is HONEST — nothing in that scope has settled — and the Columns
    menu removes it in one click. ⚠️ Per-tab hiding through `useOutflowRows`'s `alsoHidden` was
    considered and REJECTED: it would re-hide the column on every tab change for somebody who had
    just un-hidden it.
- **Export is one control whose meaning follows the screen you are on** (2026-08-21). It sits in the
  toolbar's `ml-auto` group, immediately LEFT of the "N transfers" count — Columns and Clear-filters
  CHANGE the view, Export TAKES it with you, so it pairs with the count that states what you are
  looking at rather than with the controls that alter it. The same `ExportButton` serves the master
  table, the Skipped dialog (over that dialog's OWN `useOutflowRows` instance, so the file and the
  list cannot come apart) and the Approved panel.
  - **It exports the WHOLE filtered set, never the loaded page.** `export_outflow_rows` reuses
    `_row_filters` + `_scope_clause` unchanged, so the file and the tab count describe one
    population — a 50-row CSV under a tab reading 1,043 is this feature's own "button 688, table
    893" defect in a form that outlives the screen.
  - ⚠️ **OVER 20,000 IT REFUSES AND NAMES BOTH NUMBERS.** Never a silent `LIMIT`. The dialog is
    titled **"Could not export"** rather than naming the cap, because a dropped connection and a
    permission failure land in the same catch and a heading naming a limit above an unrelated
    message is a confident wrong answer; the BODY is always the server's own sentence, rendered
    verbatim so the two cannot drift.
  - ⚠️ **EVERY COLUMN SHIPS, INCLUDING THE HIDDEN ONES.** `toExportColumns` takes no `hidden`
    argument — not defaulted off, ABSENT — so no call site can make the file a function of a menu
    somebody clicked and leave two exports of one table differing with nothing saying so.
  - **Two columns exist ONLY in the file:** `settled_target_name` and `settled_target_amount`, in
    `outflowExport.EXPORT_ONLY_COLUMNS`, appended after the screen's columns. ⚠️ **They must never
    be given an `OUTFLOW_COLUMNS` entry** — `get_outflow_rows` does not select them, so a screen
    column would render an em dash on every row forever. `settled_target_amount` is BLANK, never 0,
    on an unsettled row.
  - The Approved panel keeps `Approved on` and `Updated on` as **two separate columns**
    (`ledger_read` asymmetry #1). A spreadsheet is where presenting a modification timestamp as an
    approval would be hardest to catch later.
- **The Settled tile carries a three-way ledger split** (2026-08-21) — Project Payments / Project
  Expenses / Non Project Expenses, one line each under the tile's own sub-line, behind a 2px emerald
  left rule that marks them as CHILDREN of the figure above rather than three more figures.
  - The order is the server's and is FIXED, never sorted by value: a value-sorted list reshuffles
    between periods and has to be re-read every time. A zero ledger still prints, on the same
    reasoning `derive_import_summary` already gives for zero-filling every status.
  - ⚠️ **THE THREE MUST RECONCILE EXACTLY TO `settled_value`.** That is why the endpoint sums the
    ROW amount rather than `m.target_amount`, and why it applies the same failed-transfer exclusion
    the main query does.
  - `settledLedgerRows` returns `[]` for an ABSENT payload key, so an older server degrades to
    rendering nothing rather than a confident `Project Payments 0` over a settled table.
- **The Import selector is a searchable Combobox, not a `Select`** (2026-08-21) — up to 60 statements
  is past what a plain select serves. Two-line items: filename + source micro-label, then
  `period · uploader`. Period first, because `list_imports` is ORDERED by period and that is what a
  reader scans for. The uploader is the email's local part (`importUploaderLabel`), full address in
  a `title`.
  - ⚠️ **THE TRIGGER STAYS ONE LINE AT `h-8`.** Source / Import / Period sit in one row and all
    three are `h-8`; a two-line trigger breaks that alignment.
  - ⚠️ **`All imports` IS A REAL cmdk ITEM WITH A CUSTOM FILTER SCORING IT 1, NOT `forceMount`.**
    `forceMount` de-registers an item from cmdk's store, which would silently kill arrow-key and
    Enter selection on the one item that must always be reachable.
  - The control is NOT disabled while pinned (Source and Period are) — it is the only way back out
    of a pinned statement, including from a deep link.
- **"Confirm all matched" is CONFIRM, never APPROVE** (owner ruling 2026-08-09). This feature never
  approves anything; a button saying otherwise would tell an accountant they are approving payments.
  It acts only on `Matched` rows **carrying a stored suggestion** — a row that matched several
  records has nothing to confirm against and is listed read-only as "needs you". It loops **one call
  per row**, preserving the per-row savepoint isolation, and shows each row's **amount delta before
  the click** (since X1, confirming rewrites amounts).
- ⚠️ **EVERY AMOUNT DELTA IS FORMATTED TO THE PAISE, never with `formatToRoundedIndianRupee`.** That
  formatter `Math.ceil`s, and **nearly every correction this feature makes is sub-rupee** — 313 of
  them on the first real statement, all under a rupee. Rounded, the confirm dialog's change notice
  read `₹27,504 → ₹27,504`: a warning showing no change, on the screen where the reviewer is being
  asked to authorise it; and the candidate tables read `off by ₹1` for a 31-paise gap. The three
  delta/gap sites (`ConfirmAllMatchedDialog`'s before→after pair, `SettleableRecordTable`'s
  `AmountMark`, `DecisionDialog`'s two "differs by" lines) use the exact `formatToIndianRupee`.
  Plain amounts elsewhere keep the rounded form — the rule is about **differences**, where the
  rounding is the entire signal.

Everything that is not a React semantic lives in the pure `outflowTableModel.ts`, because
there is **no DOM test environment in this repository, by deliberate choice**: the table, the dialog
and the selection behaviour are structurally untestable here and the honest verification is a live
browser walk.

- **Decisions are client state until confirmed.** A reviewer works down the list and confirms a batch
  of rows; nothing is written until they do. That is why the bulk bar counts **decided** rows, not
  selected ones — "Confirm 4 decided" when 5 are ticked.
- **A matched row is pre-selected before it is opened.** The match run stores its single pick on the
  row (`suggested_doctype` / `suggested_name`); the page seeds every untouched row's decision when
  the batch loads, and the outcome button NAMES the record. Seeding never overwrites a decision a
  reviewer made — including one they deliberately **cleared**, which leaves an entry with a null link
  and is what makes "cleared" distinguishable from "never touched".
- **Seeding is not settling.** It fills in the choice a person would have clicked; the row still has
  to be ticked and confirmed, and that confirmation is still the only thing that writes.
- **One "Link payment" list, not three ledger cards.** Picking a ledger first asks the reviewer a
  question the bank statement does not answer — a transfer to a vendor may have been raised as a
  Project Payment or booked as a Project Expense. The **ledger arrives with the chosen record**
  rather than from a card clicked beforehand.
- **That list is a RADIO TABLE, not a dropdown** (owner, 2026-08-07 — `SettleableRecordTable.tsx`).
  Type · Record · Vendor · Project · Approved/Updated · Amount are COLUMNS, so three approved
  records can be compared down the page instead of read as eight stacked facts three times over.
  The facts did not change; their arrangement did. Fixed **260px** height with the header sticky
  inside the scroll container, so the dialog's own height never moves however many records come
  back — a list that grows pushes Confirm, the one control the dialog exists for, out of reach. The
  column model lives in `outflowTableModel.RECORD_COLUMNS` so the header and body cannot drift, and
  it is a real `<input type="radio">` in a real radiogroup because this is the control that decides
  where money is written.
- **"Create a new expense" is HIDDEN, not deleted** — one `const` in `DecisionDialog.tsx`. The form,
  `RowDecision.newExpense`, the `new` branch of `isConfirmable` and the `create_expense` endpoint are
  all intact.
- **"Skip this row" is HIDDEN too** (owner ruling 2026-08-10), same treatment, same one `const`
  (`SHOW_SKIP_ROW`). `review.skip_row`, its required-reason guard, the `Skipped` status and the
  Skipped tab are untouched, and AUTOMATIC skips (failed transfer, already-recorded duplicate) still
  happen. ⚠️ **Consequence, stated rather than discovered:** linking an approved record is now the
  only way a person can resolve an open row, so a transfer with genuinely nothing to settle against
  — 145 of them on the first real statement — has no terminal state and keeps counting against
  "Still open". Closing the import does not change a row's status.
- **The Link payment table is FIVE columns, not six** (owner ruling 2026-08-10). The ledger label
  was its own `type` column and the sixth column pushed **Amount** off the right edge — the one fact
  that decides whether a record can be settled needed a horizontal scroll to reach. The label now
  stacks above the id it qualifies inside `Record`. A test pins the total width against the dialog.
- **Records outside the tolerance are shown and marked, never hidden.** Someone hunting a TDS payment
  needs to SEE the one that differs by ₹2,000 to learn it cannot be settled here; filtering it out
  looks like the record does not exist.
- **A manual skip requires a typed reason** (owner ruling). An automatic skip does not — making
  someone type "duplicate" forty times is theatre, not a control.

---

## The confirm dialog is a TREE, and the Skipped chip is a DOOR

**833 rows in a flat list with one checkbox each is not a thing anyone reviews; grouped by vendor it
is.** `buildConfirmTree` / `confirmSelectionSummary` / `toggleNode` are pure and vitested — the rest
is a browser walk, because there is no DOM test environment here.

- **The project level renders only when it has something to say.** 147 of 210 vendors sit on exactly
  ONE project and 79 have a single transfer, so a rigid three-level tree was two expands to reach one
  row, past a middle level repeating what the vendor row already said. A single-project vendor reads
  inline: `Sri Sai Enterprises - Nagarjuna Olive`.
- **The summary bar is a SAFETY CONTROL, not a status line.** It states what the button will WRITE at
  all times, including the one figure that appears nowhere else: **how many approved AMOUNTS the
  confirm will rewrite** (312 of 807 on the real statement, nearly all sub-rupee). It also carries
  *"N selected are hidden by these filters"* — **selection survives filtering**, so without it you
  could narrow to one vendor, read 12, and confirm 142.
- ⚠️ **THE SHARED CHECKBOX CANNOT SHOW "PARTIAL", and it fails in the dangerous direction.** Radix
  mounts the Indicator for `indeterminate` too, so a half-selected vendor rendered with a **TICK**.
  `components/ui/` is shadcn-generated and not ours to edit, so the third state is drawn in this
  dialog — Radix keeps the state, the keyboard behaviour and `aria-checked="mixed"`; only the mark is
  ours.
- The confirm payload carries **which order** the record is against — 602 Procurement Orders against
  193 Service Requests on the real statement, so it is never labelled "PO" wholesale.

**`useOutflowRows` extracts the table's whole query** so the Skipped dialog can share it. Selection
and decisions deliberately stayed on the page: it is a worklist, the dialog is read-only, and folding
those in would hand the dialog affordances it must not have behind a flag. **The dialog is read-only
BY CONSTRUCTION** — `Skipped` is terminal so the table renders no action, and an empty
`selectableRowNames` removes the checkbox column. Its `All / Already paid / Bank refused` control is
what makes the split inside `Skipped` actionable.

---

## The Resolve dialog's record list — the whole pool, ranked (chunk N1, 2026-08-11)

The Link-payment table inside `DecisionDialog` is the ONE way a person resolves a Not-Matched
transfer. It is a **browse** list, not the matcher's output, and until N1 it was ordered by amount
alone.

### What was wrong, in two parts

`search_settleable_records` asked each ledger for **50 rows ORDERED BY AMOUNT CLOSENESS** and cut the
merge to 50. Both halves bit:

- **The right record was INVISIBLE unless its amount happened to be near.** The vendor could be right
  and the project could be right and it still would not appear. Typing in the search box was the only
  way to reach it — and that box re-queried the SERVER on every keystroke.
- **A whole ledger could vanish.** 50 near-amount payments filled the merge before the 14 approved
  project expenses could get in, from a list that claims to span all three.

### The ranking (`services/outflow_import/similarity.py`)

Owner priority, 2026-08-11: **project > vendor name > vendor nickname / contact person > amount.**

| Owner decision | Ruling |
|---|---|
| **Q1b** | A **weighted sum**, not a strict tier ladder. The project signal comes from free-typed remark text — the noisiest input in this feature — so an exact vendor name plus a nickname plus an identical amount must be able to outrank one loose shared project word. |
| **Q2** | **Settleability is a HARD SPLIT above the score**, not a fifth axis. A record `settle.py` would refuse can never sit above one it would accept. Unsettleable records are still **returned and ranked among themselves** — a TDS hunter has to SEE the one that cannot be settled in order to learn that it cannot. |
| **Q3** | **Both bank fields feed both text axes.** The matcher keeps `beneficiary_name` and `remarks` apart because each tier stands on one clean signal; a browse list that refuses to look in both just fails to find things. |

Sort key, and every part is load-bearing:
`(not settleable, -total, |amount − bank|, doctype, name)`. **It ends in a unique field on purpose** —
`(doctype, name)` is unique across the three ledgers, so the order is TOTAL and two loads of the same
dialog cannot disagree.

⚠️ **IT READS `ProjectIndex.projects_mentioned`, NOT `sole_project`.** `sole_project` abstains the
moment two projects fit — exactly right for tier 2, where inventing an answer settles money on a coin
flip. Ranking is under no such obligation: it boosts **both** and lets the reviewer choose. **The
asymmetry is deliberate and must not be "made consistent".**

⚠️ **A MISSING FIELD SCORES ZERO AND IS NEVER A PENALTY.** Non Project Expenses have no vendor and no
project *at all* — no column, no join to make — so every one of them scores on amount alone.
Penalising them would push an entire ledger to the bottom for having a different shape, which is a
fact about the data rather than evidence about the transfer.

**Measured end to end** on a real transfer (beneficiary `CoolFreez Systems Private Limited`, remark
`Alorica materials`, ₹5,00,000): 322 records returned against 322 approved on file, and the record
that transfer actually paid ranks **first**, on vendor-exact plus project-named. By amount it sits
₹88,000 away and would not have been in the old list at all.

⚠️ **HOW BIG THE POOL IS, IS NOT A FIXED FACT.** Measured twice on 2026-08-11, five hours apart:
**1,164 records, then 322** — the same pool, after a batch was settled. It drains as an import is
confirmed and refills as approvals happen. Both readings are far inside `_MAX_BROWSE` (5000). What
would NOT be fine is sizing a future decision on one reading of a number that moves 4× in an
afternoon.

### The reasons are RENDERED (slice N2, 2026-08-12)

`similarity.py` computes `similarity` + `similarity_reasons` per record and `_rank_browse_records`
attaches them — and **until N2 nothing on the frontend read either**, despite that module's docstring
saying "the screen renders `reasons`". A record sat third in a ranked list with nothing saying why.

The pure `recordPickerView.reasonCaption(record, sort)` now drives a muted sub-caption under the
record id (full text in the `title`; 210px truncates the common two-reason case).

- ⚠️ **IT GOES SILENT UNDER AN EXPLICIT SORT.** `sort === null` IS the ranking; under any other sort
  a "why it ranks here" caption explains an order that is not on screen — worse than silence,
  because it reads as authoritative.
- ⚠️ **THE NUMERIC SCORE IS NOT SURFACED.** It is a weighted sum on an arbitrary scale, so nobody can
  calibrate 1.35 against 0.9, and a number on a screen where money is confirmed invites being read as
  a confidence.
- The reason ORDER is the server's (project → vendor → alias → amount) and must not be re-sorted.

### The matcher's candidates are MARKED (slice N3, 2026-08-12)

`several_found_note(count)` says *"6 approved records match this transfer and nothing could separate
them. Open the row and pick which one it settled."* — and the row opened into the whole approved pool
with those 6 **unmarked**. The instruction pointed at nothing.

`get_row_candidates` gained one **additive** key, `settleable_candidates` (`[{doctype, name}]`),
computed by `_disambiguation_candidates` — the SAME list `sole_suggestion` reads and the note counts.
`DecisionDialog` fetches it once at the top and marks matching browse rows with a neutral chip.

- ⚠️ **NOT re-derived from `payment_groups`**, in the endpoint or the client. The sentence and the
  marks must come from one list, or they disagree about the same row — the `best_payment_group`
  collapse is what that failure looks like.
- ⚠️ **`[]` for a fan-out** (inherited from Option B's abstention), but **a list of ONE for a single
  candidate** — the `< 2` threshold belongs to `_sweep_unresolved_to_mismatched`, which asks a
  different question. Copying it into the endpoint would give this feature a second place to change
  one rule.
- ⚠️ **The chip says FOUND, never AVAILABLE.** This endpoint re-runs the match live and applies none
  of the four global passes, so a marked record may already be claimed by another open row. Promising
  availability would surface as a confirm failing with `AlreadyPaidError` after the click.
- ⚠️ **The stored note stands down when the live line appears** (`suppressOutcomeNote`, keyed on the
  COUNT and never on the sentence's wording). The note was frozen at match time and the marks are
  fetched now; two counts of one thing, free to disagree, is worse than one that is current.

### The screen (`recordPickerView.ts`, `RecordColumnHeader.tsx`)

Vendor, Project, Approved and Amount each carry a sort arrow and a filter — facets for the first two,
ranges for the last two. The pure model is `recordPickerView.ts`; the whole pool arrives in ONE call
so every narrowing is local, and the SWR key is stable per row (it used to carry the search text).

- **Q4 — the Approved column sorts a payment's approval date and an expense's update date TOGETHER.**
  ⚠️ `recordDateLabel` still renders them **apart** ("approved …" vs "updated …"). Ordering makes no
  claim about what a value MEANS; a LABEL does. Neither expense doctype has an approval date, an
  approver, or an approval step at all. **If `recordSortDate` ever feeds a label, that ruling has been
  broken.**
- **Q5 — Clear filters resets the filters AND the sort.** "Normal" is the similarity ranking, so
  `hasActiveFilters` counts a sort as active; otherwise a reviewer who has only sorted has no way
  back.
- Search is **token-AND across every field, in any order** — `hakimi 4471` finds what the old
  `LIKE '%needle%'` could not, because that needed the words in the order the record stored them.

---

## The approved inbox — what is sanctioned and not yet paid

A button on the tab strip (`ApprovedRecordsPanel`), opening `approved.list_approved_records` over
**`Project Payments` + `Project Expenses` + `Non Project Expenses`**. Filters: ledger, project,
search, sort. **Nothing here writes** — settling is still reached from a transfer, through
`settle_row`. A screen that could mark an approved payment Paid with no transfer in front of it would
be a second, quieter way to spend money.

⚠️ **THIS IS NOT THE DELETED REVERSE VIEW, and the two are one step apart.**
`get_reconciliation_report` went at V5 and read BACKWARDS from records already Paid — *"is every
payment we recorded backed by a real transfer?"*. This reads FORWARDS from records still Approved:
the queue this import exists to consume. It answers "what is waiting", not "what did we get wrong".

⚠️ **A BUTTON, NOT A FOURTH TAB (owner, 2026-08-11).** The three tabs are three SCOPES over ONE
population — `Outflow Import Row` — so their counts sit in a row precisely because they can be
compared and subtracted. This opens a view over three OTHER doctypes with no import row in it at all.
**`ml-auto` is load-bearing, not alignment taste**: pushing it to the far right is what stops it
reading as the next item in the sequence.

**`ledger_read.py` is ONE PLACE THAT KNOWS THE ASYMMETRIES, NOT ONE QUERY THAT HIDES THEM.** Each
ledger keeps its own `LedgerSource` — joins, amount expression, date expression, searchable columns —
written out in full; what is shared is the SHAPE every row comes back in. It is a second caller
alongside `review._search_one_ledger`, which stays separate deliberately. Each asymmetry below has
already caused a defect somewhere in this feature:

1. ⚠️ **Only `Project Payments` has an approval date.** `approved_on` and `updated_on` are SEPARATE
   KEYS and a row fills exactly one — a modification timestamp is not an approval and must never be
   rendered as one. One column would have presented it as one on 82 of 1,164 records.
2. ⚠️ **`Project Expenses.amount` is a DATA column of numeric strings.** The cast is **REGEX-GUARDED**
   so junk yields NULL rather than taking the whole page down: the record still appears with a blank
   where the number would be. There is no junk today (measured: zero); the column permits it, and the
   test plants some.
3. ⚠️ **`Non Project Expenses` has NO vendor and NO project column.** Selecting either is a hard SQL
   error, not a blank, so the literal NULLs are spelled out. **A project filter drops that ledger
   entirely** rather than contributing an always-false predicate — "which of these are on project X"
   has one honest answer for a doctype that records no project.

**Two defects the new tests caught before the screen did.** The project filter built its options from
ONE page of 200 rows against a set of 332, so a project could appear in the table and be missing from
its own filter — it is a DISTINCT query now. And the first union filtered OUTSIDE the subquery, where
`p.name` and `v.vendor_name` do not exist; every predicate now sits where its columns are, which also
lets the index on `status` work.

⚠️ **The totals are computed under the SAME filters as the page** — the `_row_filters` rule, on the
other side of the feature. **This feature has already shipped that defect once.** `by_ledger` is
returned beside the total because the three are not comparable.

---

## Doctypes

⚠️ **THE DOCTYPES KEEP THEIR `Outflow ...` NAMES AFTER THE B8a RENAME (owner ruling Q1).** The screen
is *Bulk Import Transactions*; these five are not renamed, and must not be. A doctype rename is a
migration with dynamic links and a unique index (`Outflow Row Match`'s
`(transfer_id, target_doctype, target_name)`) riding on it, and buys nothing.

| Doctype | Holds |
|---|---|
| `Outflow Import Batch` | one uploaded statement: `source`, period, counters |
| `Outflow Import Row` | one staged transfer + its derived outcome, resolved vendor, `direction`, denormalised `source`, and the match run's `suggested_doctype`/`suggested_name` |
| `Outflow Row Match` | **settlements only** — a row here means money was written |
| `Outflow Import Expense Rule` | keyword → expense type, per ledger (Cashbook; extended with `DTAX` / `GST` / `EPFO` keyword rules for the bank statement, Q23 — **rules, never parser logic**) |
| `Outflow Import Project Alias` | phrase → project. ⚠️ Deliberately NOT wired into `load_project_index`; 0 active rows today |

### The three sources

| `source` | Shape | `direction` | What a row can become |
|---|---|---|---|
| `Cashfree` | payout gateway export, one amount column | **blank** — the export states none | settle an `Approved` `Project Payment` / `Project Expense` / `Non Project Expense` |
| `Cashbook` | petty-cash wallet export, one amount column | **blank** — see above | CREATE a `Project Expense` or `Non Project Expense` at `Paid` (ADR-0015) |
| `ICICI Bank Statement` | bank passbook, **two** amount columns (Withdrawal / Deposit) | **`Debit` or `Credit`, stated per row** | **Debit** → create a `Project Expense` / `Non Project Expense`. **Credit** → create a `Project Inflow`, or a **negative** `Non Project Expense`. **Never a settle** — ADR-0016 |

⚠️ **`ICICI Bank Statement` IS ONE STRING IN FIVE PLACES AND THEY ARE PINNED TOGETHER BY TEST:**
`parser._ADAPTERS` key · the `Outflow Import Batch.source` Select option · `sources.BANK_STATEMENT_SOURCES`
(read back by `upload._BANK_STATEMENT_SOURCES`) · `duplicates.WIDE_IDENTITY_SOURCES` · the frontend
`OutflowImportBatch.source` union. `upload._read_and_parse` validates the posted source against
`SUPPORTED_SOURCES` and `_stage_batch` writes that same string straight into the Select, so a spelling
that differs between the adapter key and the Select fails Frappe validation on **every** batch insert
for that source. It shipped briefly as `ICICI` and was renamed before anything was imported. The Select
picks a **column adapter** — a second bank is a different adapter, and therefore a different source
string (Q24).

### `Outflow Import Row.direction` — an explicit Select, NEVER a signed amount

Owner ruling Q10. `amounts.amounts_match`, both SQL pool queries, the settle guard and every summary
sum assume a **positive magnitude**, so a negative amount would pass all of them and settle the wrong
way round in silence.

- Values: `Debit` / `Credit` / **blank**, copied verbatim from `parser.RawRow.direction`.
- ⚠️ **BLANK MEANS THE STATEMENT DID NOT SAY, AND MUST NEVER BE READ AS "`Debit` BY DEFAULT."** A
  gateway export has a single amount column and states no direction at all, so it stages blank. On a
  bank passbook, blank means **both** money columns were populated — corrupt input the parser refused
  to guess about, and which the exclusion rules therefore cannot judge either. **A blank direction
  fails OPEN: the row is ingested.**
- ⚠️ **The backfill patch `patches/v3_0/backfill_outflow_row_direction.py` is SCOPED to
  `b.source IN ('Cashfree','Cashbook')`, not a bare `WHERE direction = ''`.** An unscoped re-run
  against a DB that has since imported a statement would stamp `Debit` on an ICICI row whose blank
  means *the parser refused to guess* — manufacturing the exact answer it declined to invent,
  invisibly. Pinned by `test_it_never_stamps_debit_on_a_bank_statement_row`.
- **Known gap:** direction is inconsistent across gateway sources — pre-B3 Cashfree/Cashbook rows are
  backfilled `Debit`; post-B3 ones stay BLANK. Closing it means teaching the parser that a
  single-amount-column source states `Debit`.

⚠️ **THERE IS NO "CLOSE IMPORT" (owner ruling 2026-08-10), and the reasoning is worth keeping so it
is not re-added as an obvious gap.** Closing stamped `closed_at` / `closed_by` / `close_reason` on
the batch and did nothing else: no row status changed, nothing froze, and once
`Completed with exceptions` was retired it stopped feeding the derived batch status too. The screen
showed a banner; no other code read the flag. At X3 an import stopped being a **place** — there is
one master table across every import — so "close this import" no longer marks anything as finished
with, and a control that writes three fields nobody reads is worse than no control, because people
reasonably assume it must do something. `close_batch` / `reopen_batch` / `get_close_preview` and
`CloseBatchDialog.tsx` are deleted; `test_close.py` went with them.

**The three fields stay on the doctype.** Dropping them is a migrate that destroys the close history
of every batch already closed, to save nothing. They are simply never written, and no longer
returned by `get_import_summary` or `list_imports`.

**Closing never converted open rows to `Skipped`** — a skip is a DECISION, and auto-skipping would
have manufactured decisions nobody made. That reasoning outlives the feature and is why no future
"finish this import" action may do it either.

### ⚠️ "Auto-close" (CF/S5) is a READ of a derived status, and does NOT reopen the ruling above

The owner asked for finished imports to stop being re-matched. That sounds like the deleted control
and is not: **nothing is written.** `derive_batch_status` already returns `Completed` when a batch
has no open rows, and `_refresh_batch_rollup` runs on **every settle and every skip** — so a batch
closes itself, and a statement whose last transfer was settled a year ago already reads `Completed`
today. No field, no patch, no backfill.

- The one predicate is `status.batch_is_open`. `match_period` skips the closed ones; everything else
  — the picker, the History dialog, every figure — still lists them. **Finished, not hidden.**
- ⚠️ **`closed_at` / `closed_by` / `close_reason` MUST STAY UNWRITTEN.** They are still on the
  doctype (dropping them would destroy the close history of every batch already closed). If a future
  change makes auto-close a WRITE, that is the deleted control returning and it needs to be a
  decision rather than a drift. Pinned by
  `test_status::test_it_does_not_resurrect_the_deleted_close_fields`.
- ⚠️ **IT IS A COST FIX, NEVER A CORRECTNESS ONE, and the distinction stops it being "improved" into
  something that skips real work.** `match_batch` already skips `_FROZEN_ROW_STATUSES` row by row,
  so re-matching a finished statement was ALWAYS a no-op — it just walked all 1,043 rows to find
  that out, on every run, forever. What changed is the work done and the number reported.

---

## Stacks — several interchangeable transfers, several interchangeable records (chunk E)

A vendor with six approved payments of ₹9,000 and six transfers of ₹9,000. Row by row the matcher
correctly refuses to pick one; for the SET there is exactly one sensible outcome. 58 rows were in
that state on the first real statement.

**Membership** is `(normalized_account, EXACT amount)`, and both halves are load-bearing:

- **The account, never the beneficiary name.** A row with **no account is never stacked** — grouping
  on amount alone would put two unrelated vendors who both happened to be paid ₹9,000 into one
  stack, and a "balanced" stack of those auto-pairs strangers to each other's payments. It is the
  worst failure this module could produce and it is one missing guard away.
- **The amount is EXACT**, deliberately narrower than the ±₹1 window used everywhere else. A
  tolerance window **is not an equivalence relation** (1.00/1.90/2.80 overlap pair-wise but do not
  form a group), so grouping by one depends on iteration order. And there is nothing to absorb: the
  window exists for bank rounding between a transfer and a RECORD.

**Balanced stacks auto-pair (owner ruling 2026-08-10).** ⚠️ **This is an accepted risk, not a safe
inference.** Six payments of one amount may sit on six DIFFERENT PROJECTS, and nothing in a bank
statement says which transfer paid which. The owner took it against hand-pairing 58 rows a
statement. Two mitigations are part of the ruling and must not be dropped as cosmetic:

1. **Every auto-paired row says the pairing was arbitrary** and tells the reader to check the
   project (`stacks.stack_note`). Pinned at both the pure and endpoint layers.
2. **Pairing is deterministic** — by DECISION DATE first (below), else transfers by
   `(added_on, name)` and records by `(doctype, name)`, then zipped. Both keys end in a UNIQUE field, so no tie survives to be broken by query order. A
   reshuffle between runs would move a suggestion out from under a reviewer mid-decision.
   ⚠️ `pair_stack` re-sorts **both** sides itself rather than trusting `stack.transfers`; a function
   whose contract is "same input, same pairing" cannot delegate half of it to its caller.

**Unbalanced stacks pair NOTHING** — not even partially. With 7 transfers and 6 records, SOME
transfer settles nothing, and choosing which is a judgement about money.

### ⚠️ The "Resolve N stacks" screen is DELETED (owner ruling 2026-08-11)

`get_unpaired_stacks`, `_load_unstacked_open_rows`, `_stack_payload`, `UnpairedStacksDialog.tsx`, the
page button and the eight stack helpers in `outflowTableModel.ts` are all gone. Unbalanced stacks now
fall into the ordinary worklist as `Not-Matched` and are resolved like any other row.

⚠️ **THE EXPLANATION IT CARRIED HAD TO SURVIVE IT.** That dialog stated the surplus in words —
*seven transfers, six records, one settles nothing*. A row sitting in the worklist with a generic
"could not choose" tells a reviewer nothing about WHY it is unresolvable, and they would hunt for a
seventh record that does not exist. `stacks.stack_surplus_note` is that sentence, written by
`_resolve_stacks` onto every member. **Deleting a screen is allowed; deleting the reasoning it
carried is not.**

⚠️ **THE NOTE IS ONLY CORRECT COMPUTED ACROSS IMPORTS**, which is why the pass writes it from a read
that spans them — the other six transfers may sit in last month's batch, and a per-batch count would
state a surplus that is not the real one. Pinned by
`test_review::test_the_stack_pass_spans_imports`, which matches only the SECOND batch and asserts a
FIRST-batch row now carries the cross-import count.

⚠️ **IT IS NOT WRITTEN WHEN THE STACK HAS NO RECORDS AT ALL.** Empty means either "every record was
claimed by another transfer" or "the stack was DISQUALIFIED by a fan-out" — and the pass cannot tell
them apart. In the second case the row is a perfectly good fan-out MATCH carrying `_matched_note`,
and a surplus note would replace a true statement with a false one. **A note that cannot tell two
cases apart must assert neither.**

### The pairing key is DECISION DATE first, the arbitrary zip second (2026-08-11)

`pair_stack` builds every `(transfer, record)` pair that carries dates on both sides, sorts by
`(gap, transfer index, record index)` over already-ordered sequences, and assigns greedily; whatever
the date pass cannot speak for is zipped in the original order. It returns `StackPair` objects
carrying a **basis** — `date` or `arbitrary` — because a pairing decided by evidence and a coin flip
between twins are different facts, and a caller that cannot tell them apart must either waste the
evidence or overclaim on the majority.

⚠️ **NO DATES, OR EVERY GAP TIED, REPRODUCES THE OLD ZIP EXACTLY** — not by luck, but because the
greedy is keyed on the indices of already-ordered sequences, so a total tie IS the zip. The dateless
fixtures in `test_stacks` are the guard, and they assert the same pairings they always did.

⚠️ **EVIDENCE MEANS "STRICTLY NEARER THAN EVERY OTHER RECORD IN THE STACK", not than the ones still
free** — judged against the free ones, the LAST pair of any stack could never be evidence, and the
note it produced then claimed the records were *"interchangeable on amount"* about records decided a
week apart. Whether another transfer got there first has no bearing on whether the dates favour
**this** pairing. A transfer that LOST a nearer record to a rival still comes out arbitrary, which is
correct: it took what was left.

⚠️ **THE DATE VARIANT OF THE NOTE STILL ASKS FOR THE PROJECT CHECK.** A decision date says the
records are distinguishable; it does not say the pairing is on the right project. The evidence
changes the claim, never the caution.

**Measured, and smaller than it sounds:** of 112 live stack pairings, **25 come out evidence-decided
and 76 arbitrary — but only TWO point at a different record than the zip already chose.** Most of
what this buys is a TRUE SENTENCE about a pairing that was already right. Do not let a later reader
mistake the 25 for 25 corrections.

⚠️ **THE PASS WRITES ACROSS IMPORTS, and that is the point of it.** A stack does not respect batch
boundaries, so matching batch B can change rows in batch A. Safe because it only ever fills a BLANK
suggestion on an OPEN row, changes no status (so no other batch's rollup goes stale), and both
batches compute the same pairing. Pinned by a test that matches a second import and asserts the
first import's rows paired.

⚠️ **A record is claimed once, globally.** `zip` covers one stack; an explicit claimed-set covers
across stacks and against the per-row matcher. Without it two transfers get the same payment and the
second confirm fails with `AlreadyPaidError` — the exact failure the candidate-collapse fix exists to
prevent.

⚠️ **A REAL LIMIT, pinned on purpose:** the stack key is an exact amount but the candidate set uses
the ±₹1 tier-1 window, so a payment 50 paise away is a candidate **without being a member** — 3
transfers, 4 records, unbalanced, nothing pairs. Correct, not a defect. Near-identical amounts fall
through to a person, which is the right side to fail on.

⚠️ **A FAN-OUT DISQUALIFIES A WHOLE STACK.** One transfer covering several payments is report-only
(ruling Q4) and cannot be one end of a 1:1 pairing, so `_stack_records` returns nothing and the stack
falls to a person untouched.

---

## Partial settlement — one approved payment, several transfers (slice PS, 2026-08-12)

A vendor is approved ONE payment of ₹5,00,000 and the bank pays it as ₹2,00,000 + ₹3,00,000. Before
PS both transfers were unresolvable: `settle_row` refuses each with `AmountMismatchError`, and the
dialog's other two exits (`SHOW_SKIP_ROW`, `SHOW_CREATE_NEW_EXPENSE`) are switched off.

**`settle_row_partial(row, target_name, intent)` splits the record, then settles one half through
the UNCHANGED `settle_payment`.** The kept half takes the bank's figure and goes `Paid`; the balance
becomes a new `Approved` payment linked by `split_from`.

### The five owner rulings (2026-08-12)

| | Ruling |
|---|---|
| **R1** | Same access as the rest of outflow — Accountant, Accountant Lead, Admin. It changes no approved total, so it is not an approval and does not need the CEO gate |
| **R2** | `settle.py`'s spine is **restated, not broken**: *this import never approves and never increases what is sanctioned*. A split re-partitions an existing sanction. Anything in this repo still reading "it cannot create a payment" is pre-PS |
| **R3** | **The matcher never auto-suggests a partial.** Reviewer-initiated only, forever |
| **R4** | The balance half is `Approved`. The money already was |
| **R6** | `Project Payments` only. Neither expense doctype has split machinery, `split_from`, or PO terms |

### ⚠️ TDS AND A PART PAYMENT ARE INDISTINGUISHABLE IN THE DATA

A ₹5,00,000 payment against a ₹4,50,000 transfer is EITHER a part payment (₹50,000 still owed) OR a
deduction (nothing more owed, ₹50,000 withheld). **`Project Payments.tds` is blank on every
approved-unpaid payment** — it is written at fulfilment by a human who knows the figure — so there is
nothing to read. 709 of 7,421 paid payments carry one.

Guess it wrong in the part-payment direction and this feature **creates an approved payment that will
never be paid, inflating what the PO thinks it still owes, forever** — worse than the dead end it
replaces. Hence:

- **`intent` is REQUIRED with no default**, server-side. Missing or unrecognised → throw.
- **Neither option is pre-selected** on screen, and the primary button is disabled until one is.
- `partial_settle.looks_like_tds` flags a shortfall sitting on 1/2/5/10% — **a warning beside the
  choice, never a gate.** A 2% gap is still eligible; a part payment can land on 2% by coincidence.
- `intent="deduction"` **throws and writes nothing**, routing to the payments screen.

### The gate (`services/outflow_import/partial_settle.py`, pure)

`Project Payments` · status `Approved` · record **strictly larger** than the transfer · gap
**exceeds** `AMOUNT_TOLERANCE` (₹5) · both amounts positive. Every refusal is **named**
(`REFUSAL_*`), so the endpoint, the screen and the tests cannot disagree about which rule stopped a
row. ⚠️ The window boundary is **exclusive on the split side** — exactly ₹5 belongs to the ordinary
settle, which is inclusive at its own boundary; otherwise both paths would claim the same gap.

⚠️ **The gap exceeding ₹5 is also what makes `payment_split`'s own `MIN_SPLIT_AMOUNT` (₹1) floors
unreachable from here.** That relation crosses a purity boundary (the pure module cannot import a
frappe-importing service), so it is pinned by `test_settle_payment.TestTheWindowsStayInTheirRelation`
— the one layer that may import both.

### The transaction, and the two flags

```
require_outflow_access -> intent guard -> _load_settleable_row
savepoint:
   _assert_partially_settleable   (row lock, re-asserts the whole gate)
   split_payment(...)             expect/remainder Approved, stamp_ceo_approval=False
   settle_payment(...)            UNCHANGED
   _record_settlement             UNCHANGED
commit -> _link_statement_file_to_target -> _record_partial_provenance
```

- ⚠️ **ONE SAVEPOINT OVER SPLIT + SETTLE.** A split that succeeded with a settle that failed leaves a
  payment partitioned for a settlement that never happened. Pinned by a test that forces the UTR
  guard to fire after a successful split and asserts no orphan balance survives.
- ⚠️ **`remainder.flags.split_child`** — the balance inserts AS `Approved`, and `after_insert`'s
  `if doc.status == "Approved"` branch fans out notifications that `frappe.db.commit()` **per
  recipient**. Inside the outflow savepoint that ends isolation, and "Confirm 8" could leave four
  rows written and four not with nothing recording which.
- ⚠️ **`pay.flags.split_approval`** — set even though it is currently redundant (the trim is
  `Approved → Approved`, so `on_update` early-returns). Relying on an early return in another
  function to keep a PO lock safe is agreement by coincidence.
- ⚠️ **`stamp_ceo_approval=False`** — `ceo_approval_date` records when the CEO approved this money,
  and `ledgers.DECIDED_ON_SQL` reads exactly that column to decide which record a later transfer was
  nearest to. Stamping today would overwrite an approval fact with a bank fact and quietly re-order
  every future match against that vendor.

### Verified against the real machinery, not assumed

- **`update_parent_amount_paid` SUMS the Paid payments** rather than incrementing, so a PO paid in
  two halves reports the right total with no new code. Pinned.
- **The PO's terms are written twice in one transaction** — by the split, then by
  `_find_and_update_po_term` when the settle flips the status to `Paid` (a fresh `get_doc` + a second
  save). This was the one joint reasoning could not settle; it is now proven: the terms come out
  `Paid` + `Approved` and still sum to the original.
- **`settle_row` still refuses the same payment** with `AmountMismatchError` — pinned, so the
  ordinary path is proven un-widened.
- **The bulk confirm cannot reach this**: a different endpoint name the confirm tree never calls, and
  `get_confirmable_rows` only offers rows carrying a `suggested_name`, which a partial has not got.

### The OTHER answer: recording the shortfall as TDS (slice TD, 2026-08-12)

The same dialog, the same shortfall, the opposite reading. `intent="deduction"` used to throw; it now
**writes `Project Payments.tds` and settles the payment in full** — in one narrow, measured case.

```
tds    = amount − bank        DERIVED, never typed
amount = UNCHANGED            the record keeps its invoiced figure
status = Paid, + utr + payment_date
```

**Owner rulings:** band **0.95–2.05%** (T-R1) · **`Service Requests` only** (T-R2) · no new approval
gate (T-R4) · the amount never changes (T-R5).

**Measured on the live ledger, 2026-08-12** — 671 Paid payments carry a TDS figure:

- **584 are Service Requests** (87%); **505 sit at exactly 1.00% and 60 at exactly 2.00%**
- the band captures **584 of 671**; widening to 0.5–2.5% adds **two**
- service-only costs **5** in-band rows
- ⚠️ **TDS is computed on `amount` DIRECTLY, not a pre-GST base.** Checked, because the opposite
  would have mattered: `/1.18` turns those clean 1.00 / 2.00 into 1.18 / 2.36, and a band built on
  that assumption misses almost every real deduction while every test stays green.

⚠️ **`Project Payments.tds` IS EMPTY ON AN APPROVED PAYMENT — an INVARIANT, not a description of the
table.** 39 rows violate it: every one is residue from a fulfilment undone by a hand write outside
the document lifecycle (33 carry a `Version` row reading `Approved → Paid` and none for the way back;
all 39 had `utr` and `payment_date` cleared and `tds` missed). **So nothing on this path READS the
field** — `deduction_eligibility` has no `stored_tds` parameter and must never grow one. Residue is
simply replaced by the figure this transfer implies, and `track_changes` records the replacement.
**The 39 rows are a separate data-cleanup item**; spot the class with `status='Approved'` and a
non-empty `tds`, no `utr`, no `payment_date`.

⚠️ **THE WINDOW IS NOT WIDENED — IT IS POINTED AT THE RIGHT NUMBER.** With a `tds`,
`_lock_and_assert_payment_settleable` asserts `|amount − tds − bank| ≤ AMOUNT_TOLERANCE`, because
`amount − tds` is what the bank was expected to move. `tds=None` is byte-identical to before, and
`rewrite_amount` is skipped entirely on the deduction path (X1's take-the-bank's-figure rule is for a
record that should EQUAL the transfer; here it is deliberately larger).

⚠️ **THE DEDUCTION OPTION IS GREYED, NEVER HIDDEN, AND THAT IS THE SAFETY ARGUMENT.** A reviewer
looking at a genuine 2% TDS on a **materials PO**, offered only "part payment", will take it — and
that creates an approved balance for money nobody owes, the exact phantom the PS slice exists to
prevent. `deductionOffer` therefore always returns a verdict with a REASON, and the screen renders it
beside the disabled option.

⚠️ **THE CLIENT MIRROR IS FLOAT AND THE SERVER IS `Decimal`.** `2050/100000*100` is exactly `2.05`
server-side and `2.0500000000000003` in IEEE-754 — so a naive comparison greys out an option the
server accepts, on the very boundary the band is defined by. `BAND_EDGE_EPSILON` fixes it, and **the
direction is the rule: the mirror may never be STRICTER than the server.** Erring toward offering is
safe (the server re-asserts under a row lock); erring the other way hides the choice.

⚠️ **`format_tds` is SEPARATE from `format_amount_for`.** That one keys on the DOCTYPE and would be
right here only by coincidence — it is about `amount`, a real Currency column, while `tds` on the
same doctype is a **Data** column of stringified numbers. The live column already holds both
`'1000.0'` and `'1000'` because two writers disagreed; this path must not add a third shape, so it
matches `_fulfil_payment`'s `flt()` exactly (pinned by test).

⚠️ **NAME COLLISION — READ BEFORE GREPPING.** `TDS Items`, `TDS Repository`, `Project TDS Setting`
and `TDS Items Child Table` are **Technical Data Sheets** (materials approval: `make`,
`work_package`, `Verified / Not Verified`), and the "TDS Approval" tab with its Admin+PL approvers
belongs to *that* feature. `Project Payments.tds` is **Tax Deducted at Source** and is unrelated to
any of it. Same three letters, two concepts — the same trap this repo documents for "BCS".

**`looks_like_tds` and the band are DIFFERENT QUESTIONS and must not be merged.** The first asks
*"does this look like a deduction?"* (1/2/5/10%) and warns before a part payment is chosen; the second
asks *"may we record it here?"* and gates the button. They deliberately disagree at 5% and 10%, which
are real rates this path does not write.

### What it does NOT solve

**A transfer with genuinely nothing to link still has no terminal state.** `SHOW_SKIP_ROW` and
`SHOW_CREATE_NEW_EXPENSE` remain `false`; 145 such rows existed on the first real statement. PS
narrows that gap, it does not close it. Flipping either const is a separate decision.

**There is no undo, and a wrong partial is worse than a wrong settle** because it created a document.
Manual repair: delete the balance payment in the payments screen (`on_trash` reverts its PO term),
then correct the original's amount. ⚠️ **After that repair the PO's terms will not sum to the PO
total until someone fixes the remaining term** — the PO card warns, nothing fixes it automatically.
A reverse-split utility is a reasonable follow-up and is out of scope.

---

## Three repairs on the decision path (slices D1–D3, 2026-08-12)

Three independent changes, shipped together because they all landed on the Resolve dialog and the
upload that feeds it. Each rolls back on its own.

### D1 — the refusal says WHICH rule it broke

The dead-end branch of `AmountOutsideWindowDialog` printed **one fixed paragraph for every blocked
pick**, and by this date three of its claims were false:

| The old sentence | Why it was wrong |
|---|---|
| *"This gap is far larger than that"* | It had never checked. A gap of ₹6 trips this branch |
| *"A deduction such as TDS looks exactly like this — settle those in the payments screen"* | ⚠️ **Slice TD made that route live HERE** and did not touch this sentence |
| *"or record it as a new expense"* | `SHOW_CREATE_NEW_EXPENSE` is `false` — that route is not on this dialog |

It also read identically whether the record was bigger or smaller than the transfer — and since PS
took the *bigger* case away into its own two-answer dialog, the **smaller** case is the common
arrival here, the one shape the old wording described least well.

**`settleBlocker` now carries a `reason`**, and `settleBlockText` owns the wording:

| Reason | When | Says |
|---|---|---|
| `not_positive` | either amount ≤ 0 | nothing to settle against |
| `bank_paid_more` | record **smaller** than the transfer | the bank moved more than this record is for |
| `expense_exact_only` | record larger, but it is an expense | expenses settle at their exact amount only |
| `record_larger` | record larger and IS a payment | reachable only with `SHOW_PARTIAL_SETTLE` off |

⚠️ **IT REFINES THE MESSAGE, NEVER THE VERDICT.** `kind` stays the single `"amount_outside_window"`
and the block still fires on exactly one thing — the server's `suggested === false`, which is a pure
amount comparison over a list already filtered to settleable statuses. **The amount is the only
reason a listed record can be blocked**, so the classification was already right; only the prose was
stale.

⚠️ **An absent `target_doctype` is NEVER read as an expense** — the same fail-open as `suggested`.
Otherwise an older payload gets told "an expense can only be settled at its exact amount" about a
payment: confident, specific and wrong.

⚠️ **The sentence carries no amounts, deliberately.** The dialog's first paragraph already prints
the record figure, the bank figure and the difference; repeating one here is a second copy free to
drift. It is also what keeps the function a plain unit-testable string.

`PROJECT_PAYMENTS_DOCTYPE` is now a shared constant because `settleBlockReason` and `partialOffer`
must agree about the ledger — pinned by a test. If they drifted, the dialog would explain a refusal
that had not happened, or offer a split the endpoint would reject.

### D2 — the Why block is gone, and the dialog stops scrolling

**`WhyThisSuggestion` is DELETED** (owner). It was a bulleted card at the top of the body carrying
at most three sentences — the bank reference not being on any payment yet, the row's stored
`outcome_note`, and *"Only approved records are ever offered here."* All three predate the record
TABLE: since N2 the table prints a per-row similarity reason and since N3 it marks the rows the
match run actually found, so the card restated — one level less precisely, and for the whole row
rather than per record — what the reviewer can now read against each candidate.

**Nothing server-side changed.** `outcome_note`, `related_payments` and `bank_reference_no` are all
still written, still returned and still read elsewhere. Only the one rendering is gone.

`suppressOutcomeNote` went with it — it answered "should the dialog stop printing the stored note?",
and with no printer there is no question. ⚠️ This is deliberately unlike `orderBySuggestion`, which
is KEPT as a documented-unused export: that one still implements a rule the server applies, this one
did not.

**The scrollbar.** Two nested scrollers exist by design — the dialog body (`max-h-[85vh]`) and the
record table. The table's bound was a fixed `420px`, which is right about the table and wrong about
the SCREEN: on a short viewport the body overflowed, and **"Clear selection", which sits below the
table, went under the fold**. It was then unreachable, because the thing that scrolled it out of
view was the thing you would scroll to reach it.

`max-h-[min(420px,38vh)]` keeps today's size at 1080p and lets the table give way first on a short
screen, so only the INNER scroller is ever used. ⚠️ **Do not simplify to a bare `vh`** — the 420px
ceiling stops the table filling a very tall monitor and pushing the same controls down again.

### D3 — duplicate identity is `(transfer_id, amount, date)`

> ⚠️ **AMENDED BY D4 (2026-08-17), AND THE AMENDMENT IS NOT TO THE KEY.** The identity below is
> UNCHANGED. What changed is which STORED ROWS are allowed to be a duplicate at all — see
> [D4](#d4--a-stored-row-must-be-terminal-before-it-can-be-a-duplicate-2026-08-17). Read both
> before touching either.

**What it was:** `transfer_id` alone — one column, read verbatim from the sheet's *Transfer Id*
header, `.strip()`ed. Not a computed fingerprint. No amount, no date, no beneficiary, no reference.

**What it is now:** the triple, owned by `duplicates.row_identity`.

⚠️ **WIDENING MEANS STRICTER, AND THE INSTINCT RUNS THE OTHER WAY.** A longer key matches FEWER
things, so this catches FEWER duplicates than before. A statement re-issued with the same transfer
id but a corrected amount now imports as **new work** instead of being silently skipped. That is the
point — a different amount is a different fact — but it is a live behaviour change, not a tightening.

Four rules, each for its own reason:

- **The amount compares EXACTLY. No tolerance.** `AMOUNT_TOLERANCE` is the SETTLE window — what may
  be WRITTEN against a record — and has no business deciding whether two rows are the same row: at
  ₹5 two genuinely different ₹3 transfers would collapse and the second would never import.
  `amounts.py` also guards this structurally by failing any `Decimal` constant declared outside it.
- **The DATE, not the datetime.** `added_on` is a Datetime and two exports of one transfer can carry
  different clock times; comparing the timestamp would make every re-export look like new work.
- ⚠️ **A MISSING DATE FALLS BACK TO id + amount** (owner ruling) — `dates_agree`, deliberately NOT
  SQL `NULL = NULL`. The parser tolerates an unreadable Added On and stages the row anyway, so under
  NULL semantics a sheet whose dates we failed to read would stop being recognised on re-upload and
  **import a second time, silently**. A missing date is our failure to read the sheet, not evidence
  of a different transfer. It is symmetric — either side may be the unreadable one.
- **The in-file check widened identically.** `_stage_batch`'s `seen_in_file` and the parser's
  `_duplicate_transfer_ids` both key on the identity now. ⚠️ The parser still RETURNS ids, because
  `duplicate_transfer_ids` is an API payload field typed `string[]` on the client.

**The SQL still narrows on `transfer_id` only; the triple is applied in Python.** Twice deliberate:
`transfer_id` is the indexed column and stays the cheap first cut, and `amount` is a **Currency**
column — a float in Postgres — so an `=` against it in SQL is exactly the binary-floating-point
comparison that `normalize_amount` returning `Decimal` exists to avoid.

`find_earlier_batches_for_transfers` was **renamed** to `find_earlier_batches_for_rows` and takes
rows. The old name is deliberately not kept as an alias: a caller passing ids would otherwise keep
getting the old, looser answer with nothing failing.

⚠️ **THE TWO KEYS ARE NOW DIFFERENT, AND MUST STAY DIFFERENT.** `Outflow Row Match`'s unique
constraint is `(transfer_id, target_doctype, target_name)` — untouched, and still the real
guarantee that one transfer cannot settle one record twice. Do not "align" them: widening the
constraint to a triple would let the same transfer settle the same record twice under a corrected
amount.

⚠️ **EVERY PRE-EXISTING `test_upload` TEST PASSED UNCHANGED WHEN THE KEY WIDENED.** A suite that
cannot tell the old behaviour from the new is evidence of neither, so six tests were added and
three of them were **proven to fail** against a temporarily reverted key before being accepted. The
other three assert behaviour that is the same either way (same-day different time still duplicate,
the missing-date fallback, an unchanged re-upload) and are regression guards, not change-detectors.

---

### D4 — a stored row must be TERMINAL before it can be a duplicate (2026-08-17)

**The defect, found in production data.** A transfer still `QUEUED` when a statement was exported
stages with **no bank reference** and settles nothing. Nothing about its identity changes when it
later completes — same `transfer_id`, same amount, same *Added On* — so the next export's `SUCCESS`
row matched the queued placeholder on all three axes of D3 and was skipped as *"Already imported in
batch X."*

The money then **never reached a record, and could not**:

- `Skipped` is in `review._FROZEN_ROW_STATUSES`, so `match_batch` never revisits it;
- there is no unskip endpoint;
- `expenses._load_settleable_row` **refuses** a skipped row outright;
- every later export repeats the same collision.

So the loss is **permanent, not late**. Measured live on `OFI-26-00002`: **2 transfers stranded**
(₹8,142 *IN Engineering Works*, ₹7,500 *PARVATHAMA LABOUR CONTRACTOR*), both against payments still
sitting at `Approved`.

⚠️ **THE USER-FACING SYMPTOM IS MISLEADING, WHICH IS WHY IT WENT UNNOTICED.** On the sheet it reads
as *"two rows, same vendor, same amount, different UTRs, both skipped"* — one a genuine repeat, one
the completed transfer. Nothing on screen distinguishes them, and the reported cause ("already
imported") is true of the wrong one.

**The fix — eligibility, not identity.** `duplicates.row_identity` is **untouched**. A queued row and
its later success ARE the same transfer, and saying otherwise would be a lie that happened to produce
the right outcome. The corrected question is whether the stored row is the **final account** of that
transfer. Both duplicate lookups now require it:

| Site | Source |
|---|---|
| `candidates.find_earlier_batches_for_rows` | Cashfree |
| `api/outflow_import/cashbook._already_imported` | Cashbook |
| `upload._stage_batch`'s `seen_in_file` | the in-file half of the same rule |

⚠️ **TERMINAL, *NOT* SUCCESSFUL — and the first cut got this wrong.** Filtering on `= SUCCESS` is the
intuitive reading and is a **regression**: a `FAILED` transfer moved no money either, but it is
final (a retry gets a NEW transfer id), so excluding it stops a re-uploaded statement being
recognised as fully imported. `assess_duplicates` then sees one "new" row that is skipped anyway,
declines to refuse, and stages a batch with nothing in it to action — precisely what the refusal
exists to prevent. **Nine `test_upload` tests went red at once**, which is what the negative half of
a guard is for.

`parser.BANK_TERMINAL_STATUSES` = `{SUCCESS, FAILED, REJECTED, REVERSED}`, with
`parser.is_terminal_status` as its predicate, bound into SQL rather than spelled — the same
discipline `review.get_import_summary` already applies to `BANK_SUCCESS_STATUS`.

⚠️ **AN UNRECOGNISED STATUS IS TREATED AS IN FLIGHT, DELIBERATELY.** The two mistakes are not
symmetric: calling an in-flight status final **loses real money with no trace and no way back**,
while calling a final status in-flight costs a re-staged row that is skipped anyway. Only one is
recoverable, so the unknown case falls on the recoverable side.

**Direction of risk:** this can only ever make the guard **looser** — more rows import, never fewer.
Safe for the same reason the D3 period narrowing is: the real backstop against paying twice is the
`Outflow Row Match` unique constraint, untouched. ⚠️ **That last sentence is CASHFREE-SCOPED.** On
the Cashbook path the constraint cannot fire at all (a create mints a new `target_name`), so the
looseness there is held by `_already_imported` + `_already_booked` and by nothing else — see
"The Cashbook duplicate guard" above.

#### The repair patch — and why a re-upload cannot do it

`patches/v3_0/unstrand_outflow_queued_reimports.py` re-opens rows the defect froze, setting them back
to `Pending match run`; the reviewer then presses **Run match**. It writes no money — a patch that
settled at migrate time, with no screen showing what it chose, would be doing the reviewer's job
unasked.

⚠️ **RE-UPLOADING THE STATEMENT DOES NOT RECOVER THESE ROWS.** The obvious move, and it fails: the
stranded row is itself stored `SUCCESS` (it was skipped for being a duplicate, not for failing), so
under the corrected rule it is a valid duplicate **of itself** — a re-upload finds every row already
imported, `new == 0`, and `assess_duplicates` **refuses** the file. A newer statement hits the same
wall. Only re-opening the stored row works.

The predicate is narrow on purpose — skipped-as-already-imported **and** itself terminal **and** the
batch named in its own `skip_reason` holds that transfer id still in flight. All three together
describe only rows this defect created; on the owner's database that is 2 rows beside 34 correct
duplicates that must be left exactly as they are.

⚠️ **POSTGRES GOTCHA, AND IT FAILED SILENTLY.** `SUBSTRING(string FROM x)` is **overloaded**: with an
`INTEGER` it is the positional form, with `TEXT` it is the **POSIX-regex** form. A bound parameter
arrives typed as text, so `FROM 27` was read as the pattern `/27/` and matched the `27` inside
`OFI-26-00271`, yielding the batch name `27`. Nothing errored — the `EXISTS` simply never matched,
the `UPDATE` touched 0 rows, and the patch reported success while repairing nothing. **The
`::integer` cast is load-bearing.** Caught only because `TestUnstrandPatch` builds a row it is
supposed to fix and then checks that it did.

#### Tests

`TestQueuedThenSuccessfulReimport` + `TestUnstrandPatch` (`test_upload.py`, 37 → 39) and
`TestPendingThenSuccessfulReimport` (`test_cashbook_import.py`). Each pairs the fix with its
**negative**: a successful row must still block a re-upload, a `FAILED` row must still count as
imported, and the patch must leave genuine duplicates alone.

⚠️ **`TestUnstrandPatch` BUILDS THE STRANDED STATE BY HAND**, because the corrected code can no
longer produce it — a patch tested only against a database that cannot contain its target is a patch
nobody has run. It is also the one test in that file whose writes are **not scoped to its own
fixtures**: `execute()` sweeps the whole table by design, so it also repairs any genuinely stranded
row the site carries. Acceptable because that is the repair it exists to perform and it is
idempotent — but a future edit widening the patch's `WHERE` widens this blast radius with it.

#### Still open

`expenses._load_settleable_row` tells a user *"This row was skipped. Re-run the match to reconsider
it."* — but `match_batch` treats `Skipped` as frozen, so re-running the match **never** reconsiders
it. The message names a remedy that does not exist. Not fixed here; it is a separate decision about
whether skipped rows should be re-openable from the screen at all.

---

## Three more, and the production link defect (slices E1–E3, 2026-08-12)

### E1 — the screen opens on ALL TIME

`outflowPeriod.DEFAULT_PERIOD` is now `null`. ⚠️ **This REVERSES the 2026-08-09 worklist ruling**,
and the reasoning it reverses is kept in the code rather than deleted, because it was not wrong —
it was a trade decided the other way. The old default (`last 30 days`) was justified by first-paint
cost and by burying a fresh statement under settled history; **both costs are now accepted**,
because a reviewer looking for an older transfer was shown nothing with no reason to suspect a date
filter.

⚠️ **The first paint now scales with the whole table.** If that bites, the fix is paging or a
server-side cap — **not** quietly reinstating a default period. An invisible filter is
indistinguishable from missing data, which is the whole reason this changed.

`activeFilterCount` still excludes the period, but for the reason that always mattered more (it has
its own always-visible control), not the one that expired (it is always set).

### E2 — `Approval Date`, as a badge over the date

The column was headed `Approved` and the cell read `approved 12-Jul-2026` — the qualifier a
lowercase word mid-cell, in the same weight as the date. `recordDateLabel` is replaced by
`recordDateParts`, returning `{kind, date}`; the cell renders an **Approved** (solid) or **Updated**
(muted outline) badge above the full date.

⚠️ **The rule is unchanged and this makes it LOUDER.** Only `Project Payments` carries an approval
date; both expense ledgers contribute a modification timestamp. Under a column now headed *Approval
Date*, the badge is what stops that reading as an approval on two thirds of the list.
`recordSortDate` still merges the two for ORDERING, which claims nothing about meaning.

### E3 — the payment and expense links did not work in production

**Two defects, one confirmed as production-only.**

**① A raw `<a href>` cannot survive the router's basename.** `App.tsx` sets
`basename: /${VITE_BASE_NAME}` — `""` in `.env`, `'frontend'` in `.env.production`. React Router
prepends it; a raw anchor does not, so `/project-payments` resolved to the **server root** and 404'd
in production while working perfectly in dev. `ApprovedRecordsPanel` was the one outflow site doing
this. ⚠️ **Anything navigating in-app from this feature must go through the router.** (One other
raw internal anchor exists in the app — `TDSRepository/components/TdsCreateForm.tsx` — deliberately
left alone, out of scope.)

**② The feature had invented its own link scheme.** `paymentHref` pre-seeds the payments TABLE's
search params with the payment name, and only lands correctly while **four** things agree: the tab
name, the url-sync key format, `name` being a searchable field, and the table reading the seeded
params before overwriting them. Its own docstring already recorded that it *"fails SILENTLY by
landing on an unfiltered table"*.

**The fix is the app's own convention.** Twelve call sites across reports, approved quotations,
invoices and the payments screen navigate to `/project-payments/<PO-or-SR id>` with slashes escaped
as `&=`; `OrderPaymentSummary` reverses that with `id.replace(/&=/g, "/")`. `settlementLink` now
takes an optional order and builds that route (`orderPaymentsHref`).

⚠️ **THE TRADE, STATED:** the order route lands on the PO/SR page listing that document's payments,
**not** on the individual payment row. Less precise than what the old scheme *promised* — more
precise than what it *delivered*. `paymentHref` remains the FALLBACK when no order is known, so a
payload predating the field keeps its link rather than losing it.

**The row payload had to grow the order id.** Matches, related payments and the stored suggestion
all travel as `(doctype, name)` pairs naming the PAYMENT, so `review._payment_order_names` +
`_with_order_names` stamp `order_name` onto the two lists and `suggested_order_name` onto the row —
**one lookup for all three**, at BOTH `get_batch_rows` and `get_outflow_rows`. ⚠️ **Both reads or
neither**: the master table is where most of these links are clicked, and enriching only the batch
view would leave the route working in one place and not the other, which is harder to diagnose than
it not working at all.

⚠️ **EXPENSES ARE STRUCTURALLY LIST-ONLY, and that is not an omission.** `PE_SEARCHABLE_FIELDS` and
`NPE_SEARCHABLE_FIELDS` cover description, comment, type, vendor, amount — never the record id — and
there is no `/expense/:id` route. Also **`document_name` holds the expense TYPE on both expense
ledgers**, so an order id passed there would be a category name; `settlementLink` never routes an
expense to the payments route whatever it is handed.

⚠️ **A SECOND, UNFIXED CAUSE IS ON RECORD.** `paymentHref`'s docstring documents that a COLD LOAD
bounces: opening any of these links in a fresh tab redirects to `/` because the app navigates before
auth resolves. That hits `<Link>` sites too, is not addressed here, and is the next suspect if links
still fail.

### ⚠️ All three slices' tests were checked against a reverted implementation

Every pre-existing test passed unchanged after each change — the `settleBlocker` fixtures carry no
`target_doctype`, the fixture payments carry no `document_name`, and the `activeFilterCount` test
was passing `DEFAULT_PERIOD`, which became `null` and is skipped by the null guard before the period
rule is ever reached. **A test that passes before and after is evidence of neither.** The
change-detecting tests were run against a temporarily reverted implementation and confirmed RED
(3 frontend, 2 backend + 1 error) before being accepted, and the `activeFilterCount` test was
rewritten to use a real period value instead of the default.

---

## Which settlements the machine actually found (slice Q1, 2026-08-13)

**The question could not be answered at all**, and three things stood in the way.

### ⚠️ The money record claimed a human found everything

`expenses._record_settlement` hardcoded `match_basis = "Manual"` on EVERY settlement. It was not
merely lazy: **`Outflow Row Match.match_basis` was a Select whose options were
`Bank reference / Vendor+amount+date / Manual`, and neither of the first two is a tier the matcher
produces** — so `Manual` was the only value that would validate. Measured before the fix: **849
settlements, all stamped `Manual`, of which 843 had been found by the machine.**

The Select now carries the matcher's own vocabulary (`reference` / `account+IFSC` /
`project in remark` / `Manual`) — the same one `Outflow Import Row.match_basis` has always used.

### ⚠️ `auto_matched` does not mean "auto-matched"

It is `1 if suggestion else 0` — **"this row HAS a suggestion"**, a fact about a proposal, not an
outcome. It is test-pinned to track `suggested_name` exactly, and `suggested_name` is blanked on
every re-run that no longer finds a single candidate. It was accurate on live data by luck (843,
matching the derived count) because nobody had ever overridden a suggestion; the moment somebody
does, it still reads 1. **It is untouched — renaming means a migration and Desk filters — and it is
NOT the field to read.**

### The new fact: `settlement_origin`

Three values, on BOTH `Outflow Row Match` and (denormalised) `Outflow Import Row`:

| Value | Means |
|---|---|
| `Suggestion accepted` | The matcher proposed this record; a person confirmed it unchanged |
| `Suggestion overridden` | The matcher proposed a different record; the person chose this one |
| `No suggestion` | The matcher offered nothing; the person found it |

⚠️ **DELIBERATELY NOT CALLED "AUTO".** A human clicks confirm on every settlement this feature
makes, so *accepted* is true where *automatic* would not be.

⚠️ **A BLANK SUGGESTION IS NOT A MISMATCHED ONE.** A fan-out has no single suggestion by design and
a row the matcher never touched has none either — both are "the person found it", a different fact
from "the person disagreed with us". Collapsing them reports every hand-found settlement as a
disagreement with a machine that never spoke.

⚠️ **`match_basis` AND `settlement_origin` ARE TWO QUESTIONS SIDE BY SIDE** — *how was it found* and
*did a person accept that*. A row can legitimately read `account+IFSC` + `Suggestion overridden`:
the matcher found something on a strong tier and the reviewer still chose otherwise.

**The verdict lives in `status.settlement_origin`** — pure, and shared by three callers (the settle
path, the summary aggregate, the backfill patch). ⚠️ **It is in `services/` and had to be**:
`api/expenses.py` imports from `api/review.py`, so `review.py` importing back for the summary's
count would be a cycle. api → service is the one legal direction.

### The 849 historical settlements were RECOVERED, not written off

`patches/v3_0/backfill_outflow_settlement_origin.py`. ⚠️ **This was only possible because a match
run touches OPEN rows only** (`WHERE row_status IN %(open)s`) and `Settled` is terminal — so a
settled row keeps its `suggested_name` indefinitely. **Do not "tidy" the match run into clearing
terminal rows.** Idempotent (only blank rows are touched), dry-run verified to reproduce the
measured **843 / 6 / 0** split before writing, and it uses `set_value(update_modified=False)` so an
audit does not read as though all 849 were edited today.

### Surfacing it

**Filter:** one line in `_FACET_COLUMNS`. Every consumer inherits it — page query, its count, the
tab counts, the facet values AND the summary — because they all read `_row_filters`. That is the
payoff of the shared builder, and it needed no new query.

⚠️ **The column is HIDDEN BY DEFAULT because in this table a FILTER IS A COLUMN HEADER.** The owner
asked for a filter and a summary number, not a column; the funnel lives in the `<th>`, so
hidden-by-default is the honest resolution. **Do not add a second filter path to avoid the column** —
the single builder is what stops the panel and the tabs disagreeing.

**Summary:** `settled_from_suggestion` on the tally and the summary dict. ⚠️ **NOT `with_suggestion`**,
which counts rows *carrying* a pick (only ever non-zero on `Matched`) — work waiting to be
confirmed. A row moves from one to the other by being confirmed, so summing them double-counts the
same transfer at two moments of its life. The hand-found count is the remainder and is deliberately
**not** sent as its own key: two numbers that must sum to a third are two chances to disagree.

Verified end to end on live data: summary **849 / 843 / 6**, facet filters to 843 and 6.

### ⚠️ Migrate-carrying

Two new fields plus a widened Select. Pullers need `bench --site localhost migrate`. The
`patches.txt` wiring line is added EXTERNALLY by the maintainer, per this repo's convention.

### ⚠️ What the browser walk found that every green suite missed (2026-08-13)

Three defects, none visible to any test. Recorded because each is a CLASS, not a one-off.

**① A FACET NEEDS THREE LISTS, AND MISSING ONE FAILS SILENTLY.** `settlement_origin` was added to
`OUTFLOW_COLUMNS` (draws the funnel) and `review._FACET_COLUMNS` (lets the server apply it) but not
to `outflowTableModel.SERVER_FACET_COLUMNS` — which is the only one that decides whether the
selection is ever **sent**. The tick box registered, "Clear filters (1)" appeared, and the row set
did not move. Each list was internally consistent, so nothing could see it. Now pinned by a test
comparing the lists in both directions.

**② `_FACET_COLUMNS` DOES NOT SHIP A COLUMN TO THE SCREEN.** That map governs FILTERING; the SELECT
lists in `get_outflow_rows` and `_load_rows` govern what a row CARRIES. Q1 changed only the first,
so the "Settled via" column rendered an em dash on all 849 settled rows while the summary beside it
correctly reported 843 auto-matched. ⚠️ **Asserting the KEY is present is the test that catches
this** — a value assertion passes on a payload that omits the key, because `.get()` returns None
either way.

**③ THE STALE TDS SENTENCE HAD THREE HOMES, AND D1 FIXED ONE.** *"A deduction such as TDS looks like
this; settle it in the payments screen"* also lived in the record verdict line and the amount-mark
tooltip. It was not simply wrong — outside the 0.95–2.05% service band the payments screen IS still
the answer — it stated unconditionally something slice TD had made conditional. Both now read the
ONE shared `AMOUNT_GAP_HINT`, which points at the affordance instead of predicting the outcome.

**⚠️ AND A PRE-EXISTING ONE, NOT FIXED: the `time` column's funnel does nothing.** It renders a value
DERIVED in the client from `added_on`; there is no `time` column to filter on, so it appears in
neither facet list. It is named in `DEAD_FUNNELS` in the test rather than silently exempted, so the
rule stays enforced for every other column. Fixing it means faceting on an expression or dropping
the funnel — out of scope, and now written down.

### ⚠️ The scrollbar fix (D2) is PARTIAL, and the recommendation behind it was wrong

Measured in the browser at three viewport heights:

| Viewport | "Clear selection" |
|---|---|
| 816px+ | visible |
| 677px (laptop) | **below the fold** |
| 557px | **below the fold** |

Capping the table (`max-h-[min(420px,38vh)]`) saves ~160px and is a real improvement, but the
dialog's FIXED chrome — header, search, count line, verdict line, footer — plus even a shrunken
table still exceeds the 85vh body cap on a laptop. **The option rejected as "belt-and-braces" (move
the control into the sticky footer) is the one that actually closes it**, because a footer control
cannot be scrolled away at any height. Recorded so the next reader does not re-derive the same
wrong conclusion from the same reasoning.

---

## Known limits, accepted with numbers

- **TDS payments will not MATCH** — the matcher is untouched and a deduction-sized gap reaches no
  tier. ⚠️ **But since slice TD they can be SETTLED by hand**, in one narrow case — see the
  Deductions section above. Measured 2026-08-12: **671 of 7,642** Paid payments carry a TDS figure
  (the 709 / 7,421 recorded here on 2026-08-10 is superseded). A tolerance pass (Q11) is still
  **next version**.
- **No undo of a settle** from inside the import (Q9). Fix it in the payments screen.
- **Fan-out is report-only** (Q4) — which is why the existing UTR guard is never challenged. Chunk E
  did NOT change this: a fan-out disqualifies its whole stack rather than being paired.
- ~~**N transfers summing to ONE record is not built**~~ **SOLVED FROM THE OTHER END, 2026-08-12
  (slice PS).** The struck-through analysis below was correct about the design it examined and is
  kept because the next reader is entitled to see why that design was abandoned rather than built:
  *"It cannot reuse `settle_row`: transfer 1 of ₹2L against a ₹5L payment fails
  `AmountMismatchError`, and transfers 2..N would fail `AlreadyPaidError`. It needs one new atomic
  write taking N rows, a group id on the row (the per-row `suggested_*` pair cannot express a
  group), and a bounded search — finding which transfers sum to a payment is subset-sum, where the
  danger is false positives, not compute. `Project Payments.utr` is `varchar(140)`, so ~10
  slash-joined references before Frappe hard-fails."*
  **PS inverts it: SPLIT THE RECORD FIRST, then settle each half as an ordinary 1-to-1.** Every one
  of those four walls disappears rather than being climbed — `settle_payment` is unchanged, each
  half carries its own UTR in its own field, no group id is needed, and there is no search at all
  because the reviewer names the record and the bank names the amount. Two invariants survive
  untouched, which is the strongest argument for the shape: `_enforce_single_claim` sees two records
  claimed by two transfers, and `Outflow Row Match`'s unique `(transfer_id, target_doctype,
  target_name)` sees two different targets.
  **The remaining limits are stated in the PS section below**, and the sharp one is that TDS and a
  part payment are indistinguishable in the data.
- ~~**The paise difference is not recorded.**~~ **REVERSED 2026-08-09 (slice X1).** It used to say:
  *"Settling an ₹18,678.69 payment from an ₹18,679.00 transfer leaves the payment at ₹18,678.69.
  Accepted explicitly."* The record now takes the **bank's** amount, in **both directions**, on all
  three ledgers — see the invariant below. Kept struck through rather than deleted: both positions
  were held deliberately, and the next reader is entitled to see that.
- **There is no reverse view.** `get_reconciliation_report` was deleted at V5, and with it the answer
  to "is every payment we recorded backed by a real transfer?". The three tabs answer only "is this
  transfer recorded?". Deliberate scope decision, not an oversight.
- **Fixtures stay synthetic — the repo is public.** Real statements carry live beneficiary names,
  accounts and IFSC codes.

---

## Tests

| Suite | How |
|---|---|
| pure services (**878** tests, measured 2026-09-11) | `python -m unittest discover -s nirmaan_stack/services/outflow_import -t . -p "test_*.py"` — no bench needed (862 before #1244, 441 before D3, 409 before PS) |
| api (`test_upload`/`test_review`/`test_expenses`/`test_settle_payment`/`test_approved`) | `bench --site localhost run-tests --app nirmaan_stack --module nirmaan_stack.api.outflow_import.<module>` — measured 2026-09-11: `test_upload` **83** (76 before #1244), `test_review` **258** (251 before #1243), `test_expenses` **45**, `test_settle_payment` **63** (56 before #1244), `test_approved` **29**, `test_cashbook_import` **35** (34 before #1244), `test_cashbook_rules` **13**, `test_inflows` **44**, `test_allocate_row` **17**, `test_reverse_allocation` **17**, `test_match_record` **12** |
| ⚠️ a suite against a WORKTREE | `bench` resolves `nirmaan_stack` through the MAIN checkout, so worktree backend code is invisible to it. Set `PYTHONPATH=<worktree root>` — it wins, and the doctype JSON follows (Frappe locates it from the module's `__file__`). The binary is `/home/frappe/.local/bin/bench`, NOT under `env/bin`. |
| the SHARED split (CEO + partial settlement) | `… --module nirmaan_stack.api.payments.test_payment_split` — **31** (26 before PS-1; those 26 are the proof the CEO path is unchanged) |
| frontend | `yarn test` (vitest, `node` environment — pure helpers only). **639** across 12 files under `src/pages/outflow-import` (622 across 11 before #1243); **3,504** repo-wide (3,487 before #1243). ⚠️ The older figure recorded here was *"317 across this feature"*, counted before several suites joined the folder — read the folder total, not a remembered number. ⚠️ `POAdjustment/writeOffControl.test.ts` has a PRE-EXISTING flake unrelated to this feature -- one case `await import`s the very large `SheetPricingPage` and trips vitest's 5s default on a loaded machine; it passes at `--testTimeout=60000`. |

⚠️ **A TEST THAT PASSES BEFORE AND AFTER A BEHAVIOUR CHANGE IS EVIDENCE OF NEITHER.** Every
pre-existing `test_upload` test stayed green when the duplicate key widened at D3, because none of
them varied an amount or a date. The change-detecting tests added there were **run against a
temporarily reverted key and confirmed RED** before being accepted. Do this for any change to the
identity, the windows, or the gates — a green suite is the easiest thing in this feature to obtain
by accident.

⚠️ **The pure suite needs the BENCH env python, not the container's system python**
(`/workspace/development/frappe-bench/env/bin/python -m unittest discover …`, run from the app root).
The system interpreter has no `firebase_admin`, so it dies importing `nirmaan_stack/__init__.py`
before reaching a test — a failure that does not look like a test failure.

⚠️ **Both runners must be invoked INSIDE the dev container.** The host has no `firebase_admin`, so
`python -m unittest` fails at `nirmaan_stack/__init__.py` before reaching a test; and the host
`node_modules` is linux-arm64, so `yarn vitest` dies on a missing rolldown binding. Neither failure
looks like a test failure.
⚠️ **`tsc --noEmit` over the whole project is NOT a gate** — the repo carries ~3,200 pre-existing
errors elsewhere. Grep the output for the paths you touched.

⚠️ **Never run the bench suite and a browser session against localhost together** — they collide on
the `tabSeries` naming lock.
⚠️ **The api suites write to the LIVE dev database** and purge in teardown. If `setUpClass` raises,
residue survives — clean with `frappe.db.delete` on the three doctypes filtered to
`source_file LIKE '%test-statement.csv'`.
⚠️ **The api suites also SEE the live ledger.** An assertion that pins an exact candidate count will
fail when real data drifts; assert partitions and invariants, and where a specific amount matters,
assert the precondition so a drift reports itself instead of looking like a broken deriver.

⚠️ **Every fixture payment in `test_review` carries its own row's bank reference, so the bulk of that
suite exercises TIER 0 and nothing else.** `TestTheTierLadderEndToEnd` is the deliberate exception —
it plants junk-UTR payments plus a fabricated vendor and project to drive tiers 1 and 2 through the
real endpoint. It exists to cover the WIRING (that `_load_pools` loads a project index and that it
reaches `match_row`), which every pure test would pass without. Its **control** — row 0006, identical
in every respect except that its remark names no project, and which must stay `Mismatched` — is the
assertion that fails first if tier 2 ever stops requiring one.

---

## Cashbook — the second source (2026-08-13)

**A Cashfree import PAYS what someone approved. A Cashbook import CREATES what a wallet already
spent.** Same screen, opposite job. The prime directive at the top of this doc stopped being
absolute here — it became **source**-scoped, and at the bank statement it became **direction**-scoped
too (ADR-0016). The reasoning, the measurements and the four accepted risks are in
**[ADR-0015](../../../docs/adr/0015-cashbook-import-creates-expenses.md)**, which is the document to
read before changing any of this.

### The three phases, and nothing is written until the third

```
preview_cashbook_statement   parse -> plan -> rollup      WRITES NOTHING
confirm_cashbook_import      save file, stage, enqueue    batch + rows only
_cashbook_worker             create the expenses          one row, one transaction
get_cashbook_status          counts the rows              reads only
```

An abandoned import leaves no trace. Confirm RE-PLANS from the re-posted file and trusts nothing
the browser computed — the preview renders the server's decision, it is never an input to it.

### What a row becomes

| Step | Rule |
|---|---|
| Importable? | `Wallet Spend` + `SUCCESS` + amount > 0 + not already imported. Anything else is a VISIBLE skip carrying its own sentence |
| Ledger | remark names exactly one project → `Project Expenses`, else `Non Project Expenses`. **There is no third answer** (R2) |
| Expense type | keyword rules **for that ledger**, longest match wins, ties → `Petty Cash` |

⚠️ **Ledger is decided BEFORE type, and they are not independent.** 12 expense types are
project-only, 25 non-project-only, 2 carry both — so `Material Transportation Charges` does not
exist for a Non-Project Expense at all. `Courier charges veeva project` is Material Transportation
Charges; `Courier charges` alone is Postage & Courier.

⚠️ **A keyword matches at the START OF A WORD.** People write "unloading" where the rule says
"unload" and "printout" where it says "print", so whole-word matching would miss most of a real
statement — but a bare substring finds "print" inside "blueprint". No regex: the haystack is
space-normalised and padded, so a word start is exactly a preceding space.

### Invariants that break silently

1. **It must never run `match_batch`.** A wallet statement has no UTR and no account, so the ladder
   can find nothing — except a real approved payment sharing an amount. Pinned by a test that reads
   the module's **AST, not its source text**: the first version scanned raw source and failed on
   the docstring explaining the prohibition, and a prose scan cannot tell a prohibition from a
   violation.
2. **The plan is STORED on the row, not recomputed by the job.** `suggested_doctype`,
   `resolved_project` and `suggested_expense_type` are written at confirm time. Re-planning would
   be a second computation of the decision a person just approved — an alias edited in the seconds
   between is all it would take — and the row is the only place a reviewer can see the decision
   afterwards.
3. **The worker commits PER ROW.** Killed at row 60 it leaves 59 durable expenses; re-running picks
   up only what is still pending, and `Outflow Row Match`'s unique key refuses a second settlement
   even if it did not. A failing row marks itself `Error` and the run CONTINUES — the reviewer
   approved the whole batch, and halting would leave them unable to tell what went through.
4. **`payment_by` and `payment_ref` come from the STATEMENT, not the importer.** A wallet names who
   actually spent (`From`) and issues no UTR, so its transaction id is the only value that finds
   the spend again. The live run caught this: 115 expenses were created with a blank reference
   before `payment_ref` became a parameter. Cashfree keeps both defaults.
5. **`Petty Cash` must carry BOTH `project` and `non_project`.** It is the fallback on either
   ledger, and `settle._assert_type_scope` refuses a type lacking the flag for its side. It ships as
   a fixture; without it a Cashbook import writes nothing at all.
6. **The lookup tables are DOCTYPES because their rows name other records.** A JSON asset would keep
   a dead name after a rename and either throw mid-batch or quietly book everything to the fallback.
   `docs/outflow-import/cashbook-expense-rules.md` is GENERATED from them by
   `scripts/generate_cashbook_rules_doc.py` — re-run it after editing rules in Desk.
7. **`Outflow Import Row.source` is denormalised and needs its backfill.** The Source funnel filters
   `r.source`; `_row_filters` builds single-table clauses shared by five readers, not all of which
   carry the batch join. All 1,043 pre-existing rows were blank until
   `v3_0.backfill_outflow_row_source` — shipping the facet without it would have drawn a funnel
   offering one option reading "(blank)".

### Two patches need `patches.txt` lines (maintainer, per the existing convention)

```
nirmaan_stack.patches.v3_0.seed_cashbook_import_rules
nirmaan_stack.patches.v3_0.backfill_outflow_row_source
```

---

## ICICI Bank Statement — the third source, and the first that carries money IN (2026-09-07)

**Cashfree PAYS what someone approved. Cashbook CREATES what a wallet spent. ICICI CREATES in BOTH
directions and settles nothing.** Same screen, a third job, and a direction the module never had.
The reasoning, the measurements and the accepted risks are in
**[ADR-0016](../../../docs/adr/0016-bank-statement-import-creates-inflows.md)**, which is the
document to read before changing any of this. Slice-by-slice as-built + the owner-ruling register:
`frontend/.claude/plans/bank-statement-ingestion-plan.md`.

The prime directive at the top of this doc is now scoped by **source AND direction**, not just by
source — see the table there. **Nothing here creates a `Project Payment`**; that would only happen
via Vendor Refund, which is deferred.

### What a row becomes

| Direction | Rows | Value | Offered on the screen |
|---|---:|---:|---|
| Debit | 711 | ₹8.28 Cr | create a `Project Expense` / `Non Project Expense` |
| Credit | 158 | ₹18.00 Cr | create a `Project Inflow` **or** a **negative** `Non Project Expense` |

405 further rows are excluded by rule at stage time and never become work
(`services/outflow_import/bank_exclusions.py`).

### ⚠️ MATCHING IS DEAD ON THIS SOURCE — all three tiers, for three different reasons

The single most important finding in the feature, measured against the live DB twice. **Do not
re-derive it, and do not "fix" it.** Full numbers in ADR-0016 § 2.

1. **Tier 1 is STRUCTURALLY UNREACHABLE.** `matcher.account_ifsc_vendors` only sets `ifsc_matches`
   inside the `index.by_account` loop, and an ICICI narration carries **no beneficiary account
   number**. 517 debit rows carry an IFSC and not one can reach tier 1. ⚠️ **Tier 1 must not be
   loosened** — it may auto-suggest precisely because it stands on the strong account+IFSC pair, and
   Cashfree has live settled data depending on that (Q25).
2. **Tier 0 CANNOT SETTLE, by construction — and this is NOT ICICI-specific.**
   `Project Payments.utr` is written only at **fulfilment**, so every UTR belongs to an already-`Paid`
   payment while `SETTLEABLE_STATUSES` is `Approved`-only. Measured: **7,643 of 7,644 `Paid`** carry a
   UTR; **0 of 1 `Approved`, 0 of 131 `CEO Pending`, 0 of 24 `Requested`**. `candidates.py` already
   records the same observation for Cashfree. **It survives as the DUPLICATE GUARD — 41 of 711 real
   rows (5.8%), every hit an auto-skip — and the owner explicitly KEPT it (Q31a).**
3. **Tier 2 fires ZERO times, and the 7 rows that WOULD fire are ALL FALSE POSITIVES.**
   `CLG/MR SAYED ALI/SBI` resolves to a project literally named `SBI` — but in a `CLG/` narration that
   segment is the cheque **drawee bank code**, which `parser._ICICI_DRAWEE_BANK_CODE` documents as
   such; the other two match off the payee's company name. ⚠️ **The small Approved pool is NOT the
   explanation and this was tested:** re-run against all 11,128 records as if every one were Approved,
   the amount agrees on **497 rows (69.9%)** and the full tier-2 predicate is **still 0**. Amount
   agreement is abundant; the **project axis is dead**. ⚠️ **Do NOT "fix" this by loosening the project
   rule — any widening makes wrong settlements MORE likely, not right ones more numerous.** Widening
   `GENERIC_PROJECT_TOKENS` or adding aliases cannot help: there is no field in an ICICI narration
   where a project name lands, so there is nothing to alias.

⚠️ **HAND-LINKING IS DELIBERATELY KEPT (owner ruling).** `get_row_candidates` still offers ranked
browse candidates when a person opens one row, and `search_settleable_records` still returns the whole
approved pool. **The fence — `sources.source_has_settlement_path` — is on the AUTOMATIC path only.**

### Invariants that break silently

1. **Rows land `Mismatched`, and that choice is load-bearing.** `review._FROZEN_ROW_STATUSES` is
   `(Skipped, Settled)` and `match_batch` filters on it, so a `Mismatched` row is still examined by a
   later match run — which is what keeps the Q31a duplicate guard alive. **Landing them `Skipped`
   would have frozen them and silently deleted that guard.** The landing note says *"no settlement
   path"* and never *"the matcher never runs"* — there is a NEGATIVE pin
   (`test_the_landing_note_does_not_claim_the_matcher_never_runs`) so a later reader cannot harden the
   weaker claim into the stronger one. **No source gate exists anywhere on the match run itself.**
2. **The duplicate key is source-aware, and its DEFAULT is the guarantee.** See the manifest row. The
   old triple loses 5 real rows of 1,274; Cashfree and Cashbook keep it byte-identically.
3. **A non-project inflow is a NEGATIVE `Non Project Expense`, not a new doctype.** The construct
   already exists: `nonProjectExpensesColumns.tsx` renders a negative amount **green**, and
   `utils/expenseApproval.ts` states in its own header that a negative amount is **NOT** auto-approved
   (the `0 < amount <= 10000` band is positive-only, so it takes the full `Requested → Approved → Paid`
   path). ⚠️ **The honest cost: money coming IN lives in a doctype called *Expenses*.** New
   `non_project=1` Expense Type fixtures name the income kinds (Q19) so the row at least says what it is.
4. **`Project Inflows` HAS NO STATUS AND EVERY CONSUMER SUMS IT UNFILTERED.** That sum feeds
   `cashflow_gap` and therefore **CEO Hold**, so a created inflow is **live the instant it is written**
   — no draft state, no approval queue, nothing downstream that holds it back. The owner ruled
   (Q8, option c) that **the bank row IS the review gate**: a credit is not written until a person
   opens that row and chooses a disposition, and **no status is added to `Project Inflows`** to
   compensate. Adding one would mean auditing every unfiltered consumer.
5. **Customer-required is enforced in the IMPORT ENDPOINT, never on the doctype (Q13).** A
   `Project Inflow` needs a customer, and the obvious home — `Project Inflows.validate` — is exactly
   wrong: `validate` fires for **every** writer, so putting it there would start rejecting saves from
   screens nobody asked to change, months later, with the refusal blaming a doctype rather than an
   import.
6. **The `Outflow Row Match` unique key CANNOT guard a create.** `(transfer_id, target_doctype,
   target_name)` never contends when a freshly created record gets a new `target_name` every time.
   Cashbook needed two extra lookups instead (`_already_imported` + `_already_booked`), and the second
   caught a real hole: 17 live Non Project Expenses carrying a wallet id nobody had imported. **Every
   disposition on this source is a create, so all of them need this.**
7. **The payer is the SECOND-TO-LAST narration segment** — IMPS is 69% of the file and comes in both
   5-segment and 6-segment shapes. Two rules were measured wrong and must not return: `p[4]` (the
   original spec) returns the **IFSC** on 122 rows; "last segment that is not an IFSC" returns the
   **bank name** on the 6-segment shape. ⚠️ The payee field is TRUNCATED per channel and the cap is
   silent (IMPS at 10 chars, ICICI internal at 15/20, CLG around 25), so **any match against a master
   list must allow a PREFIX match, never equality**.

### Screen + route

**Renamed at B8a: `/bulk-import-transactions`, heading "Bulk Import Transactions"** (Q1, Q9, Q27) —
screen and route only, no redirect, no folder/module/doctype rename. See the header of this doc.

---

## Slices D5–D11 (2026-09-08) — the inflow half of the screen catches up with the inflow half of the data

Nine B-slices taught this module to CREATE money-in. The SCREEN was still written as if every row
were money-out: a deposit rendered under a column headed *Amount Paid*, the summary had no figure
for receipts at all, and — the one that mattered — **the settle dialog offered a credit row the
entire debit-side surface and the server accepted it.** These slices close that gap. Owner
decisions were taken up front and are recorded per slice below; none of them is re-openable
without a fresh ruling.

### ⚠️ D6 — A CREDIT ROW COULD SETTLE A DEBIT-SIDE APPROVED PAYABLE, AND NOTHING STOPPED IT

The most important thing in this section. **Measured, then proven RED before the fix**, on both
sides:

- **Client:** `isConfirmable`'s settle branch was `return Boolean(decision.target && decision.linkTo)`
  and its `new`-expense branch was likewise direction-blind. Three new cases run against the
  unmodified function returned `true` where `false` was required — a credit row was genuinely
  confirmable against an approved payable.
- **Server:** `expenses.settle_row`, `expenses.create_expense` **and `expenses.settle_row_partial`**
  had no direction guard at all; `_load_settleable_row` checked only `row_status`. With the guard's
  three call sites disabled, `test_a_credit_can_never_settle_an_approved_expense` **succeeds** — the
  deposit is booked as a payment out, everything else about the settlement being valid. That single
  test is the cleanest statement of the bug.

⚠️ **THE THIRD DOOR WAS FOUND DURING THE FIX, NOT PLANNED FOR.** `settle_row_partial` also performs
surgery on a PO's payment terms via `split_payment`, so an unguarded credit would have left a split
sanction behind it as well as a wrongly-`Paid` record. **A guard on this path must always be applied
to all three entry points; guarding two of three is the same defect with a smaller footprint.**

⚠️ **THE GUARD IS THE EXACT NEGATION OF `status.is_received_direction`, NEVER A SECOND RULE.**
`_guard_is_a_debit` imports that predicate rather than re-spelling `direction == "Credit"`. A second
copy is free to drift, and **the drift presents as money settled on the debit side and then reported
under Received** — the two halves of this feature disagreeing about which way the money went.
Pinned by `test_expenses.TestTheGuardIsOnePredicate`.

⚠️ **A BLANK DIRECTION MUST STILL SETTLE, AND THIS IS THE HALF THAT BREAKS UNDER "TIDYING".**
Cashfree and Cashbook state no direction at all; a guard refusing anything not explicitly `Debit`
would refuse every row from both sources — the two the feature was built for. There is deliberately
**no service-layer twin** on the debit side: `settle_payment` / `settle_existing_expense` /
`create_expense_from_row` take no `direction` argument, because direction chooses a *sign* only on
the credit paths. Do not "restore symmetry" by inventing one.

⚠️ **`test_a_blank_direction_still_settles` NOW STATES ITS INPUT INSTEAD OF ASSERTING A FIXTURE
FACT.** It first asserted that the Cashfree fixture stores no direction. **It stores `"Debit"`** — so
the test failed while the guard was working perfectly, and, worse, had the fixture happened to agree,
the blank case would have been covered *by luck* and would have stopped being covered the day the
fixture changed. It now sets `direction = ""` explicitly, exactly as its `Debit` sibling always did.
**A fixture's incidental value is not the fact under test.**

### D5 — one named predicate, replacing four hand-written copies

`(row.direction ?? "") !== "Credit"` appeared twice in `outflowTableModel.ts` and
`row.direction === "Credit"` twice in `DecisionDialog.tsx`. Four copies, none named. Now:
`outflowTableModel.isCreditRow(row)` (**it TRIMS**, mirroring the server's `is_received_direction`
exactly) and `availableDecisionTargets(row)` — credit → `["inflow","receipt"]`, debit/blank →
`["Project Payments","Project Expenses","Non Project Expenses","new"]`, **disjoint, and their union
is the whole `DecisionTarget` union** (pinned).

⚠️ The refactor closed a live disagreement: `isCreditRow` trims and the inline compares did not, so a
`" Credit "` row had its inflow cards HIDDEN by the dialog while `isConfirmable` treated it as a
credit.

### D7 — the dialog hides what the row cannot become, and SAYS SO

`<LinkPaymentSection>` and the create-expense card are now **conditionally MOUNTED** on
`availableDecisionTargets` membership. ⚠️ **NOT via the existing `dimmed` prop** — `dimmed` only
lowers opacity and does not prevent selection, which is precisely the failure mode. A credit row
gets one line in their place, in the D1 refusal register, naming the rule and pointing at the two
cards that do apply. **A hidden option with no explanation reads as a broken screen**, and
`isConfirmable` alone would have produced exactly that: a selectable list above a permanently
disabled Confirm.

### D8 — "Amount Paid" → "Amount", plus a per-row direction marker

`amount` is stored as a **positive magnitude on every row by design**, so a deposit rendered as a
plain positive number under a header reading *Amount Paid*. The column is now `"Amount"` and each
cell carries a `Received` / `Paid` marker from `isCreditRow`.

⚠️ **THE MARKER LEADS THE FIGURE, AND THAT IS ARITHMETIC, NOT TASTE.** "Received" is wider than
"Paid", so a trailing marker shifts each row's digits by a different amount and destroys the
`tabular-nums` column. ⚠️ `column.get` is **byte-untouched** — it feeds sort, the range funnel,
`get_outflow_facet_values` and the CSV export, whose header legitimately becomes "Amount".
⚠️ Blank lands on `Paid` as a **consequence** (the receipt write paths refuse non-`Credit`), never as
a claim that blank means Debit.

### D9 — `Total transferred` → `Total paid out` + `Total received` (owner ruling Q14 (a))

`derive_import_summary` grew the direction axis it deliberately lacked: `StatusTally.direction`
(**defaulted**, on the `SettledLedgerEntry` precedent, so every existing positional construction
still lands on Paid), **one** extra `SELECT` and `GROUP BY` term on the **same** `get_outflow_summary`
query under the **same** `_row_filters` clause, and four new totals.

⚠️ **THEY PARTITION `total_rows` / `total_value` — NOT `settled_rows` / `settled_value`.** Every row
the panel counts, whatever its status. Proven live: `246 = 241 + 5`, `13,920,686.20 = 9,651,806.00 +
4,268,880.20`. They share the *axis* of `settled_by_direction` and **nothing else**; `status.py`
carries an explicit warning that the two deliberately total DIFFERENT money. **An earlier version of
the TypeScript comment on these very keys claimed the settled population** — exactly the confusion
that warning exists to prevent, and it was caught by a reader, not a test.

⚠️ **READ AS SENT, NEVER DERIVED.** Neither figure may be obtained by subtracting the other from
`total_value`, or a rounding disagreement becomes a number nothing on the server ever computed.
⚠️ **`Total received` renders only when it holds rows, and is APPENDED so `Total paid out` never
moves** — the same rule the settled blocks follow, for the same reason: Cashfree and Cashbook are
single-direction, so a zero-filled Received tile would claim receipts were possible where none can
occur. ⚠️ All four keys are **optional**, and an older server falls back to the single
`Total transferred` tile — checked with `!== undefined`, never falsiness, because **a real `0` and an
unsent key are different facts**.

### D10 — Remarks wrap at 64 instead of clipping

Pure `wrapRemarks` + `REMARKS_WRAP_CHARS = 64` beside `shortReference`, plus the `title` tooltip the
sibling cells always had and this one did not.

⚠️ **THE WRAP RUNS BEFORE `Highlight`, NEVER AFTER.** `highlightSegments` computes offsets over the
RAW string; feeding it text with inserted breaks corrupts them. A search hit spanning a wrap boundary
becomes two `<mark>`s — accepted, and commented as such.
⚠️ **A CONTENT WIDTH WAS REQUIRED, NOT OPTIONAL.** This table is AUTO-LAYOUT (`OutflowRowsTable`
states it in full at its own `OUTCOME_CELL_WIDTH`), so `<th style={{width}}>` is only a hint: a
64-char line is ~380px against a declared 230px and the column would simply have widened, stealing
space from Reference / Status / Outcome. `REMARKS_CELL_WIDTH = "w-[214px]"` is kept in step with that
230px minus `px-2` each side.

### D11 — the Record column drops the id; Vendor becomes Vendor / Description

Two **deliberately unshared** surfaces, two edits: `SettleableRecordTable` (the Link-payment picker)
and `ApprovedRecordsPanel`. Record now reads `Against <PO/WO>` for `Project Payments` and the expense
type for the two expense ledgers; the ledger badge, the `candidate` chip and the N2 `reasonCaption`
all stay.

⚠️ **`expense_type` IS A NEW FIRST-CLASS KEY, AND THE OLD OVERLOAD STAYS.** The value was reachable
only as `document_name`, a field the client types and documents as *"the PO/SR this payment is
against"*. The overload is **kept** because `recordPickerView.matchesText` has it in its search
haystack — removing it would silently stop a reviewer finding an expense by typing its type. A test
pins the two equal on the expense ledgers so they cannot drift apart before a deliberate removal.
⚠️ **THE MISSING-VALUE FALLBACK IS THE RECORD ID, NOT A DASH.** A dash would leave the row with
nothing naming it — strictly worse than the id this change replaced. `record.name` also moved to the
cell `title`, so search-by-id still finds it *and* the reviewer can still see what they searched for.
⚠️ **IN THE APPROVED PANEL THE NEW LABEL BECOMES THE `<Link>`** (owner decision) — dropping the id
without rehoming the link would have removed that panel's only navigation affordance. The
`<Link>`-vs-`<a>` E3 comment is untouched.
⚠️ **`Non Project Expenses` RENDER THE DESCRIPTION ALONE, WITH NO EM-DASH** (owner decision): that
ledger has no vendor column at all, and a leading "—" reads as missing data rather than as
not-applicable. The dash now appears only when the cell would otherwise be entirely empty.
⚠️ **THE CSV EXPORTS THE RAW DESCRIPTION**, never `vendorDescriptionLabel`'s capped/wrapped form — a
truncated description in a spreadsheet has nothing beside it to catch it.

`vendorDescriptionLabel` caps the **description alone** at 48 chars (owner decision — the vendor name
is not part of that budget) then wraps at 16.

### ⚠️ A LIVE-DATA TRAP THIS WORK SURFACED (not caused)

`test_review.TestTheOrderNameForLinking.test_the_master_table_carries_it_too` read
`get_outflow_rows(scope="all", limit=200)` **unscoped**. `_MAX_PAGE_SIZE` caps that read at 200 while
this suite runs against the LIVE dev database — which has passed 200 open rows (899 total / 246
non-skipped, measured) and pushed the fixture off the first page. It failed as `StopIteration`,
**reporting a broken deriver when nothing was broken**. It is now scoped with the `batch` filter:
that changes WHICH rows come back, not WHICH FUNCTION returns them, so "both reads or neither" is
tested exactly as before. **Passing on an empty DB and failing on a full one was never evidence about
`suggested_order_name`** — this is the same hazard the Tests section warns about, arriving as a
paging bound rather than a count.

### Test state

| Suite | Result | Baseline |
|---|---|---|
| `services/outflow_import` (pure) | **800 OK** | 790 |
| `api…test_review` | **227 OK / 1 skip** | 216 / 1 |
| `api…test_expenses` | 45 run, **2 failures — PRE-EXISTING**, both present in `HEAD` | 2 pre-existing |
| `api…test_approved` | **29 OK** | 26 |
| `api…test_upload` / `test_inflows` / `test_cashbook_import` / `test_cashbook_rules` | 76 / 44 / 34 / 13 OK | unchanged |
| frontend `vitest` (whole repo) | **3250 passing / 87 files** | 3221 / 87 |
| `tsc --noEmit` | **0 errors** under `src/pages/outflow-import/` and on `OutflowImportBatch.ts` | — |

⚠️ **NONE OF THE RENDERING ABOVE IS COVERED BY A TEST.** `vitest.config.ts` is `environment: "node"`
by deliberate choice, so the direction marker, the wrapped remarks, the hidden dialog cards, the two
summary tiles and both record tables are verified by **nothing but their code**. Every decision that
could be phrased as "given this input, what does the screen say" was pushed into the pure model and
IS covered; the JSX is not. **A live browser pass is owed** — and it is owed on top of the C1–C8 pass
that was already outstanding.

---

## Slices D12–D14 (2026-09-09) — direction gets its own column, and the summary gets two bands

Three owner rulings, one of which REVERSES a D8 placement decision from the day before.

### D12 — the `Paid`/`Received` marker moves OUT of the Amount cell into a `Direction` column

⚠️ **THIS REVERSES D8's PLACEMENT, NOT ITS SUBSTANCE.** D8 put the marker inside the amount cell and
had to lead the figure with it, because "Received" is wider than "Paid" and a trailing marker shifts
each row's digits by a different amount, destroying the `tabular-nums` column. **The owner moved the
marker to its own column, so that constraint is gone with it** — the Amount cell is a plain figure
again and `AmountCell` was deleted rather than left as a component whose docstring described
behaviour it no longer had. **The `amount` column entry is byte-unchanged** (title, `get`,
`filter: "range"`, `align`, width).

⚠️ **A `filter: "facet"` COLUMN NEEDS *THREE* REGISTRATIONS OR IT FAILS SILENTLY** — the column entry,
the frontend `SERVER_FACET_COLUMNS`, and the backend `_FACET_COLUMNS`. Miss the second and the funnel
draws, "Clear filters (1)" appears, and the row set never moves. That is the slice Q1 defect
("the 'Settled via' column rendered an em dash on all 849 settled rows while the summary beside it
reported 843") arriving from the other direction. A test caught it here; nothing else would have.

⚠️ **THE FACET IS THE DERIVED TWO-VALUE LABEL, NEVER THE RAW COLUMN.** Registered as an EXPRESSION
(the map already held a correlated subquery, so this is an established shape):
`CASE WHEN TRIM(r.direction) = 'Credit' THEN 'Received' ELSE 'Paid' END`.
The stored field has THREE values — `Debit`, `Credit` and **blank** — while the screen shows TWO
badges. On the raw column the funnel grows a **third, unlabelled option**, and a `Debit` tick
**silently drops every blank row whose own badge reads `Paid`**.
⚠️ **MEASURED 2026-09-09: the live table holds `Debit` 894 / `Credit` 5 / blank 0 — raw and derived
are INDISTINGUISHABLE on production data today. That is exactly why the raw form would have shipped
green and broken later.** The tests PLANT the blank row for that reason; a test that passes because
the failing case is absent proves nothing. One expression serves both the `IN (...)` WHERE and the
`SELECT DISTINCT` funnel read, so what is offered and what is matched cannot drift.

⚠️ **THE `TRIM()` IS THE MIRROR, NOT TIDINESS — AND IT WAS MISSING WHEN THE SLICE FIRST LANDED.**
`status.is_received_direction` is `(direction or "").strip() == "Credit"`, and the client's
`isCreditRow` trims for the same reason (D5 named that rule precisely because four untrimmed copies
had drifted). Without `TRIM`, a `" Credit "` row renders a **Received** badge and is filed by the
facet under **Paid** — so ticking `Received` **hides a row whose own badge says Received**, and the
summary band counts it on the opposite side from the funnel. No production row carries padding, so it
would have shipped green and stayed green. Caught by a cross-file review of the two spellings, not by
a suite. Pinned by `test_a_PADDED_credit_is_Received_on_both_sides_of_the_wire` and by
`test_the_facet_agrees_with_the_python_predicate_on_every_stored_spelling`, which asserts through the
REAL endpoint rather than re-implementing the `CASE` in Python — a test that re-spells the rule to
check the rule passes whenever the two spellings match each other, which is not the question. **Both
were verified RED against the untrimmed expression.**
⚠️ Widening that fixture broke two sibling pins that hardcoded "exactly one credit row"; they were
**widened to a set**, via a single `CREDIT_ROWS` accessor, so planting another spelling later carries
the expectations with it instead of leaving a stale literal.

⚠️ `get` RETURNS THE DERIVED LABEL, and that is **not** a breach of the `shortReference` rule. That
rule forbids a *display transform* reaching `get` (which feeds sort, the funnel, the facet values and
the CSV). Here the two-value label IS the column's value, and the CSV must read `Paid`/`Received`,
never a blank.

### D13 — Vendor / Description widens to 24 / 72

`VENDOR_DESCRIPTION_WRAP_CHARS` 16 → **24**, `VENDOR_DESCRIPTION_MAX_CHARS` 48 → **72**. The 72 still
measures the **description alone**.
⚠️ **A WIDTH REBALANCE WAS REQUIRED, NOT OPTIONAL:** 24 chars at `text-sm` is ≈168px against a 164px
content box. `RECORD_COLUMNS` moves `vendor` 180→**220px** and `record` 210→**190px** (it lost its
document id at D11, so it had the room to give). Sum **850px** against the unchanged pinned cap of
876; the test now pins the sum exactly as well as the cap.
⚠️ **TWO TESTS WOULD HAVE GONE ON PASSING WHILE TESTING NOTHING** — `"Site wiring materials"` (21
chars) no longer wraps at 24, and the hard-break token `SUPERCALIFRAGILISTIC` (20 chars) now *fits*
inside 24. Both were inverted, and the token test now pins `token.length > WRAP_CHARS` so it cannot
silently decay again the next time the width moves.

### D14 — the summary becomes two bands (owner ruling)

`PAID OUT` and `RECEIVED`, each holding **Total · Settled · Still open**, with **Decided shared**
below. ⚠️ **WHEN ONLY ONE DIRECTION HOLDS ROWS THE BAND HEADERS ARE DROPPED AND TODAY'S FLAT ROW
RENDERS, UNCHANGED** (owner ruling) — every import staged to date is debit-only, so this is the
common case, and a `PAID OUT` heading over the only band is noise implying a missing section.

⚠️ **ONLY *STILL OPEN* IS A NEW FIGURE. SETTLED IS NOT RE-DERIVED.** `settled_by_direction` already
provides it **with the per-ledger breakdown lines the card renders**; a second tally-derived settled
figure would be two keys totalling the same money — the thing this feature's rules forbid. The four
new keys are `open_paid_rows` / `open_paid_value` / `open_received_rows` / `open_received_value`,
from a `by_status_direction` dict filled **in lockstep with the existing `by_status` bucket** and
**summed over `OPEN_ROW_STATUSES`, never subtracted** (the rule `open_value` already states). They
reach the wire with **zero change to `review.py`** — `_jsonable_summary` is generic.

⚠️ **THE BAND'S THREE CARDS COME FROM TWO DIFFERENT QUERIES, SO THE RECONCILIATION WAS MEASURED
BEFORE THE PANEL WAS BUILT, NOT ASSUMED.** `settled_&lt;dir&gt; + open_&lt;dir&gt; == &lt;dir&gt;_total`, verified
live across the whole system **and all 19 imports**: paid `146 + 95 = 241` rows /
`3,798,616.00 + 5,853,190.00 = 9,651,806.00`; received `0 + 5 = 5` / `0 + 4,268,880.20 = 4,268,880.20`.
**A band whose three cards do not add up is worse than no band.**

⚠️ **A DIRECTION WITH ROWS BUT NOTHING SETTLED RENDERS "nothing settled yet", NOT `₹0`** — the server
SUPPRESSES that `settled_by_direction` block, and manufacturing the zero would be the panel counting,
which its docstring forbids. This is the live Received case today (5 rows, 0 settled). Total equalling
Still open is the reader's own proof. Making it a hard `₹0` means the SERVER zero-filling the block in
a band context, not the client inventing it.
⚠️ The flat-row fallback also fires when a settled block names an **unknown** direction: the flat row
renders such a block verbatim, but a band looks blocks up BY NAME and would silently drop it.
⚠️ `Decided` is built ONCE and used by both layouts, so the two cannot drift.

### Test state

| Suite | Result | Baseline |
|---|---|---|
| `services/outflow_import` (pure) | **811 OK** | 800 |
| `api…test_review` | **237 OK / 1 skip** | 227 / 1 |
| `api…test_expenses` | 45 run, **2 failures — PRE-EXISTING**, both in `HEAD` | same 2 |
| `api…test_approved` / `test_upload` / `test_inflows` / `test_cashbook_*` | 29 / 76 / 44 / 34 / 13 OK | unchanged |
| frontend `vitest` (whole repo) | **3262 passing / 87 files** | 3250 / 87 |
| `tsc --noEmit` | **0 errors** under `src/pages/outflow-import/` and on `OutflowImportBatch.ts` | — |

Live end-to-end: the funnel offers exactly `['Paid', 'Received']`; ticking Paid returns 241 and
Received 5; both ticked returns 246, equal to the unfiltered total — a partition.

⚠️ **NONE OF THE RENDERING IS COVERED BY A TEST** (`vitest.config.ts` is `environment: "node"`,
deliberate). The band/flat fork especially is a render decision inside a component and is
structurally untestable here. **The live browser pass is owed, and now larger.**

### ⚠️ Found, not fixed — the `direction` doctype description is stale

`Outflow Import Row.direction`'s description says a gateway export "stages blank". `parser
._CASHFREE_COLUMNS` maps the amount through `_StatesWhenPopulated(..., label=DIRECTION_DEBIT)`, so a
Cashfree row stages **`Debit`** today — which the 894/5/0 live split confirms. **The RULE is
unaffected** (blank is still possible, from a Cashbook top-up or a both-columns-filled ICICI row, and
must still never read as Debit), so nothing in code changed. Correcting the description is the
root `CLAUDE.md` sanctioned description-only exception and **requires a `bench migrate`** — left for
the owner rather than done silently.

---

## Slices D15–D17 (2026-09-09) — three small corrections, two of them to sentences rather than code

### D15 — the `Decided` tile is REMOVED (owner ruling, for a cleaner panel)

It rendered `decided_percent` over `decided_rows of total_rows settled`. Nothing replaced it: Settled and
Still open are the two halves of that ratio and sit side by side, so the fact stays legible.

⚠️ **`decided_rows` / `decided_percent` ARE STILL DERIVED AND STILL ON THE WIRE, deliberately.** They
carry their own load-bearing rule in `derive_import_summary` — Skipped rows leave `total_rows`, so
`decided_rows` is SETTLED ONLY or the percentage could exceed 100 — and that rule is worth keeping
proven whether or not a tile shows it. **A screen dropping a figure is not a reason to stop computing
it; deleting the keys would take their tests with them.**
⚠️ The tile-count arithmetic moved in the same edit (`+ 2` → `+ 1`). A stale count would not error —
it would ask for one more column than there are tiles and stretch the row.

### D16 — "Re-run reaches N open imports" described ONE action while the button did TWO

⚠️ **THE ENGINE WAS ALREADY CORRECT, AND THE FIRST ANSWER TO THIS REQUEST WAS TO CHANGE NOTHING.**
The ask was to stop the matcher running on ICICI statements. `match_batch` **already forks above
everything** on `source_has_settlement_path`: such a batch never loads a settlement pool and never
calls `match_row` — it runs the duplicate guard and returns. There was no matcher work to remove and
no wasted pass to save. **What was wrong was the caption**, which counted a bank statement
identically to a gateway one and so named the wider action for every statement in the set — the
"button 688, table 893" failure this very sentence was written to prevent, arriving from a third
direction.

⚠️ **THE DUPLICATE GUARD IS KEPT (owner decision, re-affirming Q31a).** Excluding ICICI from Re-run
outright would have dropped it, and it is not idle: it compares each row's bank reference against
already-`Paid` payments, a set that grows all day as people tick payments by hand, so a duplicate
invisible at import time surfaces only on a later re-run.

`_imports_in_scope` now ships **`has_settlement_path`** per batch. ⚠️ **THE DERIVED BOOLEAN, NEVER
`b.source`** — the rule has an owner and the fork reads the same function, so the caption and the
fork cannot come to disagree about a source. Handing the client the string would put a second copy of
"which sources match" in the frontend, free to drift the day a fourth source lands. ⚠️ A legacy batch
answers `""`, which `source_has_settlement_path` treats as HAVING a path — stated because the default
decides the caption too: such a batch is a gateway import, and calling it duplicate-checked-only
would understate the button.

Wording: `Re-run matches 2 open imports; 1 duplicate-checked only.` — and, when every statement is a
bank one, `Re-run duplicate-checks N open imports; none will be matched.` ⚠️ **That last form is NOT
silenced at a single import**, unlike the reach sentence: the single-import silence rule is about
REACH, and this sentence is instead the only thing on screen saying the button will not match at all.
⚠️ **A FINISHED bank statement counts on NEITHER side** — `match_period` skips it, so calling it
duplicate-checked would name an action that does not run. ⚠️ **An ABSENT flag means MATCHED**, never
duplicate-checked: the other default would report every gateway import as doing almost nothing.
⚠️ The tooltip keeps its **whole list** and qualifies it — a bank statement IS touched, so dropping
its name would understate the reach, which is the opposite of that sentence's job. Only the VERB was
wrong. A regression pin asserts the gateway-only wording is byte-identical to before the split.

### D17 — a settled expense linked to a tab it could not be in

The Outcome column's expense link went to the bare list page, landing on each page's **default** tab
— which is role-based and **never `Paid`**: `Requested` for most users, `Approved` for an Accountant.
A settled expense is `Paid` by definition, this import having just written it, so the reviewer was
sent to a tab that provably could not contain it, with nothing on screen explaining the empty table.
**Exactly the defect the payment branch beside it already records finding live.**

Both lists read a namespaced status param documented in their own files as supporting an external
deep link — `pe_status` (`ProjectExpensesList`) and `npe_status` (`NonProjectExpensesPage`) — so the
href now carries it.

⚠️ **THE TAB FOLLOWS `settled`; IT IS NOT HARDCODED TO `Paid`.** A SUGGESTION has settled nothing and
its expense is still `Approved` (`SETTLEABLE_STATUSES` is Approved-only), so pinning `Paid` would
reproduce the same defect pointing the other way. Verified RED: hardcoding it fails three tests.
⚠️ **`exact` STAYS `false`, AND THE TAB DOES NOT CHANGE THAT.** `exact` means "this lands on the
record". Neither table has the id in its searchable fields (`PE_SEARCHABLE_FIELDS` /
`NPE_SEARCHABLE_FIELDS` cover description, type, vendor, amount — never `name`) and there is no
`/expense/:id` route, so the reviewer still arrives at a filtered LIST. **Narrowing the tab must not
be mistaken for pinpointing the row**; making it exact means adding the id to those two lists, which
is a visible change to two other pages' search dropdowns and was NOT done here.
⚠️ The param keys are pinned as literals **because they are a contract with another module** — they
are namespaced there precisely so they cannot collide with a project page's own `?tab=`. A rename
there would silently strand this link on the default tab, so it must break a test here.

### Test state

| Suite | Result | Baseline |
|---|---|---|
| `services/outflow_import` (pure) | **811 OK** | 811 |
| `api…test_review` | **239 OK / 1 skip** | 237 / 1 |
| frontend `vitest` (whole repo) | **3275 passing / 87 files** | 3262 / 87 |
| `tsc --noEmit` | **0 errors** in `src/pages/outflow-import/` + `OutflowImportBatch.ts` | — |

⚠️ The 22 `tsc` errors under `ProjectExpenses` / `NonProjectExpenses` are **PRE-EXISTING** — those
files were READ for their param contract and never edited (`git status` shows them unmodified).

---

## The selector split and the fan-out seams (2026-09-10) — SHIPPED, BROWSER-VERIFIED 2026-09-11

✅ **SHIPPED.** Everything this section describes was built and passed an 18-step browser walk plus a
final re-test (spec #1236 and walk #1245, both closed; the walk record is `docs/browser-walk-1245.md`).
This section was written *before* any of it was built, and its banner said so — that banner is retired
here because it stopped being true. The measurements below are kept because several decisions rest on
them. The authority for WHAT was built remains **`docs/adr/0020-one-transfer-many-payments.md`
§ Amendment B**, and each slice's as-built detail sits in the sections the implementing sessions added.

### The one-line version

The fan-out arithmetic (ADR-0020) is sound. Every defect found was at a **seam** where it met a
pre-existing flow, and every one of them was invisible to the branch's own suites — which is the
standing rule in root `CLAUDE.md` doing exactly what it says: *"A test on each side of a boundary is
not a test of the boundary."*

### Measured facts — expensive to re-derive, cheap to record

All measured against the live `localhost` DB on 2026-09-10.

| Fact | Value | Why it mattered |
|---|---|---|
| `Partially Allocated` rows in existence | **1** of 2,511 | killed the batch-exemption decision outright (Amendment B6) |
| Batches: total / open | 79 / 16 | |
| Batches where every remaining active row is partly allocated | **0** | the "true no-op" case is unreachable |
| Batches reading `Partially Settled` with NO partly-allocated row | **15 of 16** | the status is driven by SKIPPED rows, with no threshold |
| Settled bank rows settling against an EXPENSE | **236 of 574 (41%)** | the Split control is inapplicable on a large share of rows |
| Rows whose candidate pool mixes ledgers | **44 of 44** | the pool is never ledger-scoped |
| Open rows giving NO amount signal in any ledger | **26 of 44** | so the control cannot be hidden by inference |
| Multi-leg rows in production | **2**, both created 2026-09-10 | fan-out has no production history yet — it is all test data |
| Cashfree rows with a blank `bank_reference_no` | **61** (not 17) — **all `Skipped`** | the blank-`utr` defect has ZERO live instances |
| Blank-`utr` payments among 344 settled legs | **0** | |
| Distinct `reference_id` values across 2,237 Cashfree rows | **523** | `reference_id` is NOT unique |
| Settled Cashbook expenses carrying the wallet `transfer_id` | **222 of 222** | Cashbook is already remedied, differently |

### Load-bearing things a future reader will otherwise get wrong

- **Routing must read INTENT, not tick count.** A single tick on a fresh row went to `settle_row`
  and its whole-transfer guard, so a first-leg-then-second-leg workflow had no path. The mode radio
  is the fix, and Split ALWAYS routes via `allocate_row` — even a full-amount tick, because
  `reverse_allocation` acts on legs and `settle_row` writes none.
- **`bar.over` and the part-payment detour fire on the SAME band.** `SETTLE_WINDOW` and
  `AMOUNT_TOLERANCE` are literally the same constant, so a Confirm gate on `bar.over` made the
  TDS / part-payment detour unreachable from the product. Narrow the gate to the allocate path; do
  not delete it. `legsUnknown` is a separate, innocent concern.
- **The refusal on a partly-allocated row must stay on THREE callers** — `settle_row`,
  `settle_row_partial` and `create_expense` — because all three write the whole transfer amount and
  nothing downstream is leg-aware. It is unpinned by any test. On the two INFLOW callers it is dead
  code (credit rows can never become partly allocated) and stays, with a comment.
- **`search_settleable_records` derives its comparison amount at ONE line**, and every consumer
  below takes it as a parameter. The "ten sites" framing over-states the work by an order of
  magnitude.
- **`get_row_candidates` re-runs the matcher LIVE with no frozen guard**, on every dialog open. It
  is the one matcher-shaped surface a partly-allocated row can reach. Suppress its marker
  client-side; do NOT make it remainder-aware (the ranker is test-pinned out of the matcher).
- **A full reversal returns the row to `Matched`/`Mismatched` and every gate unlocks for free** —
  verified in code, in an existing test, and on live row `OFR-26-002185`. The status is RE-DERIVED,
  never restored. There is no stuck-row trap.
- ⚠️ **`inflows.py` was BROKEN by the Task 3 status-derivation commit** — 44 tests, 3 failures,
  4 errors — and `create_non_project_receipt` lost its only duplicate guard as a result. Live blast
  radius zero (no credit rows exist). Fixed first. See Amendment B7.
- ⚠️ **The blank-reference field must be WRITE-ONLY, and FIVE surfaces must never read it** —
  `normalize_reference`, `candidates._payments_by_reference`, `matcher.match_by_reference`, the
  parser's stored `normalized_reference` column, and `reference_guard.assert_reference_is_free`.
  The last is the one earlier notes missed, and given `reference_id`'s non-uniqueness it is where a
  mis-wire bites first.

### Verification shape

⚠️ **Most of the frontend half is STRUCTURALLY untestable here** — nothing pins `confirmDisabled`,
and this repo has no DOM environment (`frontend/CLAUDE.md`, deliberate). A green suite proves
nothing about the mode radio, the narrowed gate or the error copy. The honest verification is a live
browser A/B: revert, reproduce, restore, re-verify. The manual walk lands at the end of the mode-split
slice, **except** the two-browser concurrency check, which exercises the Amendment A1 server lock and
is pulled forward.

⚠️ **A baseline is only as good as its coverage.** The branch's gate was *"no NEW failures vs BASE"*
and the recorded baseline named `test_expenses` and `test_settle_payment` as though complete.
`test_inflows` was never run, and that is how B7 shipped unnoticed.

---

## Slice 0 (2026-09-10) — the inflow row-status regression, repaired; and the branch baseline, measured

**AS-BUILT.** Issue #1238, ADR-0020 § B7 + B7a. The first slice of the selector-split spec above.

### What was wrong, and what it took to fix

`inflows.py` never referenced `_refresh_row_allocation`, because the commit that moved the `Settled`
flip out of `_record_settlement` predates nothing in that module — it simply missed it. Both credit
endpoints wrote their leg and then wrote no status at all, so a recorded credit stayed `Mismatched`.

**Two changes, and the second is the one a reader will not predict:**

1. `create_inflow` and `create_non_project_receipt` each call
   `_refresh_row_allocation(staged.name, actor, result)` immediately after `_record_settlement`,
   **inside the savepoint** — the same shape as all five outflow call sites. `result` is passed so
   `allocation_note` renders **"Recorded"** rather than "Settled": both credit paths CREATE their
   record.
2. `allocation.allocated_of` now sums **`abs(target_amount)`**. See ADR-0020 § B7a for the full
   reasoning. The short version: a non-project receipt's leg is legitimately NEGATIVE (it writes a
   negative `Non Project Expense`) while a row's amount is a MAGNITUDE by ADR-0016's explicit
   decision, so a signed sum made `remaining_of` read `2X` and pinned every recorded receipt at
   `Partially Allocated` for ever — taking the duplicate protection down with it, since that
   protection IS the status flip. `abs()` is a no-op on every outflow path (all legs are positive by
   construction), so it is a units fix, not a loosening.

The duplicate protection returns as a **consequence**: `_load_settleable_row` refuses a row already
reading `Settled`, so `create_non_project_receipt` — which by design has no duplicate lookup of its
own — is once again callable exactly once per staged row. The module header's claim is true again.

### ⚠️ The honest baseline — every suite in the area, measured both sides

Run per module, `bench --site localhost run-tests --module <mod>`, against the live `localhost` site
on 2026-09-10. **29 modules, 1,556 tests.** This replaces the recorded baseline that named two
suites as though the list were complete.

| | Before slice 0 | After slice 0 |
|---|---|---|
| Modules failing | **2** | **1** |
| `api.outflow_import.test_inflows` | 44 tests — **3 failures, 4 errors** | **44 OK** (2 skipped) |
| `api.outflow_import.test_expenses` | 45 tests — **2 failures** | 45 tests — **2 failures** (unchanged) |
| Every other module (27) | OK | OK |
| `services.outflow_import.test_allocation` | 35 OK | **38 OK** (+3 new sign pins) |

**No new failures. Seven fixed.**

⚠️ **The two surviving `test_expenses` failures are PRE-EXISTING and unrelated to this branch, and
the spec mis-stated their cause.** They are NOT "a hardcoded project fixture whose tendering status
refuses payment creation" — they are `test_a_requested_project_expense_is_refused` and
`test_a_requested_non_project_expense_is_now_refused_too`, both failing with `WrongStatusError not
raised`. Cause: `_make_expense(..., status="Requested")` plants an expense at the open row's own
amount, and the expense doctype's create-time ladder **auto-approves anything at or below
`AUTO_APPROVE_LIMIT`** — so the planted expense is `Approved` by the time the settle runs, and the
settle is correctly allowed. It is **data-dependent** on which row the fixture picks. Fixing it is
not this slice's business; naming it correctly is.

⚠️ **Four of the seven `test_inflows` failures were CASCADES, not independent defects**, and the
cascade is worth knowing because it will recur. `_next_credit_row` filters on
`row_status not in ("Settled", "Skipped")`. A row that never flips is never consumed, so every test
in the class recorded against the SAME row — and the second one hit the duplicate guard, reporting
"already recorded" rather than the missing flip. **A fixture that consumes rows by status turns one
status defect into a suite-wide failure that names the wrong cause.**

### Tests

- `services.outflow_import.test_allocation` — three new pins on the pure side: a negative leg counts
  as the money it moved; a recorded receipt leaves `remaining_of` at zero, `is_fully_allocated`
  true and `status_for_allocation` at `Settled`.
- `api.outflow_import.test_inflows` — **not modified except for one stale comment.** Its
  `test_the_row_flips_to_settled_and_gets_a_match_record` (both classes) and
  `test_a_settled_row_cannot_be_recorded_twice` already crossed the boundary and were already red;
  green is the gate, exactly as the spec asked. The corrected comment used to claim the leg amount
  "is NOT summed anywhere" — true when written, stale the day status became derived.

---

## Slice 1 prefactor (2026-09-10) — the single-select picker is restored, the fan-out moves out, and the decision model keeps BOTH pick fields

**Issue #1240** (parent #1236, ADR-0020 Amendment B § B3). **No user-visible change**, deliberately:
this is the "make the next change easy" half of slice 1, landed before the mode radio so the risky
part can be reviewed on its own.

### What moved, and the proof that nothing else did

| File | Change |
|---|---|
| `components/SettleableRecordTable.tsx` | **restored to `develop`** — the single-select `<input type="radio">` picker, byte-identical apart from one added docstring paragraph naming its twin |
| `components/FanOutRecordTable.tsx` | **NEW** — the multi-select checkbox table Task 7 had converted `SettleableRecordTable` into, moved out verbatim. Diff against the pre-change file: the header path comment, the exported name, one `@see` word, and one added docstring paragraph. Nothing else. |
| `components/DecisionDialog.tsx` | one import site + one JSX site repointed; `RecordPicker` is otherwise untouched and still renders the fan-out table, which is what makes this invisible on screen |
| `outflowTableModel.ts` | `RowDecision.linkTo` restored beside `linkTargets`; new `decisionLinkKeys`; `isConfirmable` + `decisionOrigin` read through it |
| `OutflowMasterPage.tsx` | `settleOne` builds its `targets` through `decisionLinkKeys` instead of reading `linkTargets` |

⚠️ **THE DUPLICATION IS SANCTIONED AND MUST NOT BE CONSOLIDATED** (owner ruling, the same one
`GridColumnFilter` carries against `RateMasterDataViewer`'s `ColumnFilter`). Task 7 converted the
single-select table **in place**, which is why the dialog ended up with no way to offer the ordinary
one-record settle at all. Merging the two behind a `multiple` flag would put the control that decides
where money is written behind a boolean, and would re-couple two things that are free to diverge: the
fan-out side is payments-only, ranks against a REMAINDER rather than the transfer, and withholds rows
its endpoint would refuse. None of that belongs in the ordinary settle.

### ⚠️ `decisionLinkKeys` — the one reader, and why a field read is the trap

`RowDecision` now carries **both** pick fields, optional: `linkTo` (Normal, a bare name under
`target`'s ledger) and `linkTargets` (Split, whole `recordKey`s). **The readers of those fields serve
the BULK "confirm all matched" path, which has no dialog and therefore no mode** — so neither field
can be read directly:

- reverting a reader to `decision.target && decision.linkTo` **rejects every fan-out decision**
  (`decisionOrigin` stopped comparing `target` at Task 7, and the fan-out picker clears `target` on
  every tick);
- leaving it at `linkTargets` alone **rejects every Normal decision** once the mode radio lands.

All three readers — `isConfirmable`, `decisionOrigin`, `settleOne` — now normalise through
`decisionLinkKeys` first. `decisionOrigin` compares normalised **key sets**, never field against
field, so a person picking the suggested record in Normal mode (`linkTo`) still reads as
`suggested` against a suggestion banked as a `linkTargets` singleton.

⚠️ **PRECEDENCE + THE WRITER CONTRACT, which are one rule in two halves.** A non-empty `linkTargets`
wins; `linkTo` speaks only when nothing is ticked. That is safe **only** because each picker owns one
field and clears the other. The fan-out picker now clears `linkTo` on every tick and on Clear
selection (added here). **The Normal picker must clear `linkTargets` on every pick** — a seeded
decision arrives carrying `linkTargets`, so a Normal picker that forgets would settle the machine's
old record instead of the person's new one, silently and with the right record named on screen.

`suggestedDecision` is deliberately **unchanged** — it still emits the `linkTargets` singleton, and
its two `toEqual` pins stay byte-green. Making it emit both fields would have been the other way to
fix `decisionOrigin`; normalising at the reader keeps one shape being produced and two being accepted.

### Tests

`outflowTableModel.test.ts` +10 (380 → 390). A new `decisionLinkKeys` block (both shapes, the
half-written and non-settleable-`target` cases, the emptied Split selection, and both precedence
directions), plus the Normal shape added to the `isConfirmable`, `decisionOrigin` and `seedDecisions`
blocks — the last of which pins that a `linkTo: null` clear is not re-seeded, the mirror of the
already-pinned empty-`linkTargets` clear.

**Measured both sides.** `src/pages/outflow-import/`: 567 → **577**, all green. Whole frontend suite:
baseline **3431 passed / 1 failed**, after **3441 passed / 1 failed** — the same failure both sides,
`POAdjustment/writeOffControl.test.ts > mirrors the sibling admin predicates`, a **5 s timeout on a
test that takes ~2.1 s alone**: a load flake under 90-file parallelism, not a regression. `tsc` over
`src/pages/outflow-import/`: **0 errors** (the repo carries many pre-existing errors elsewhere).

⚠️ **The two browser acceptance criteria are NOT met by this record.** Bulk "confirm all matched" on
an ordinary row, and the existing fan-out flow, are React semantics with no DOM test environment in
this repo — they are verified by a live walk, and that walk needs a signed-in session. What IS
established here is that the fan-out table is byte-identical to its pre-move self, that the dialog's
only behavioural diff is two `linkTo: null` writes on a field nothing reads yet, and that every
decision shape the app can currently produce normalises to exactly what the old field reads returned.

### The review of this prefactor — three taken, one refused

⚠️ **Every finding was about the CONTRACT this slice leaves behind, not about the code it ships.**
The reviewer independently confirmed the move is verbatim and the normalisation byte-equivalent for
every decision shape the app can currently produce. That is the shape a good prefactor review takes:
the risk is not in what runs today, it is in what the next slice inherits.

1. **`Clear selection` was gated on `linkTargets.size > 0`** — byte-equivalent today, but once the
   Normal picker lands its pick leaves `linkTargets` empty, the control stops rendering, and **a
   `<input type="radio">` cannot be un-ticked by clicking it**: no way back to undecided, while the
   bulk bar still counts the row as ready against a record the reviewer rejected. Now gated on
   `decisionLinkKeys(decision).size > 0`.
2. **The prune effect is a THIRD writer of `linkTargets`, and it is not a picker** — it rewrites the
   set when a ticked record leaves the approved pool, and never touched `linkTo`. If it prunes to
   empty, a leftover `linkTo` becomes the effective pick with nothing on screen showing it. It now
   writes `linkTo: null` too. **The writer contract has to hold for every writer, not just the two
   that look like pickers.**
3. **A new pin was banking a shape the server refuses** — `isConfirmable` on a `Partially Allocated`
   row with a `Project Expenses` `linkTo`. A single tick on that status routes to `allocate_row`,
   which refuses every non-payment target; the fan-out picker withholds those rows via
   `tickAllowedForFanOut`, but a single-select picker has no equivalent. The pin now uses a payment
   and says in its own comment that **the Normal picker owes that withholding when it lands**.

⚠️ **REFUSED, DELIBERATELY: `<tbody role="radiogroup">` in `SettleableRecordTable`.** It overrides
the implicit `rowgroup` role and drops table semantics for assistive tech, and the native
`name="settleable-record"` grouping already supplies the group — a real defect. But it is
**pre-existing on `develop`**, and the whole value of this slice rests on the restored file being
provably its pre-branch self: the diff against `develop` is comments only, which is the evidence that
no post-Task-7 fix was silently reverted with it. Trading that for an a11y correction is the wrong
exchange **in this slice**. It is a standalone fix, and the checkbox twin carries the same defect as
`role="group"` — fix both together or neither.

### The browser walk — run 2026-09-10, signed in as Administrator, against the worktree on :8081

⚠️ **A SECOND VITE ON :8081 IS THE WAY TO WALK A WORKTREE WITHOUT DISTURBING THE OWNER'S :8080.**
The devcontainer publishes 8000-8005, 8080, 8081, 9000, 9001, so a worktree can serve itself:
`docker exec -w <worktree>/frontend -e NODE_OPTIONS=--max-http-header-size=8192 <container>
./node_modules/.bin/vite --host 0.0.0.0 --port 8081 --strictPort`, after symlinking the worktree's
`frontend/node_modules` at the main checkout's (the host copy is linux-arm64 and cannot run vite).
Cookies ignore port, so the session is shared with :8080. ⚠️ **`/login` renders BLANK on a cold
load; `/` redirects to it and renders** — do not read the blank page as a broken build.

**Verified on the seeded `ZTEST` fixture world, WITHOUT confirming anything:**

| Reader changed | What was observed |
|---|---|
| `isConfirmable` (`linkTargets`, open row) | ticking one record on `ZTEST Bank Match Co` ₹44,393 armed the footer button |
| `isConfirmable` (`Partially Allocated`) | `ZTEST Fanout Traders` ₹1,00,000 with ₹40,000 + ₹25,000 legs: ticking the ₹35,000 record armed **"Allocate 1 record · completes this transfer"** — the remaining-balance arithmetic intact |
| `decisionOrigin` | the row's Outcome cell flipped to the **Decided / Review** badge on tick, and back on untick |
| `decidedRows` (**the bulk path, which has no dialog**) | selecting the decided row raised the bar reading **"1 selected · 1 decided"** with **"Confirm 1 decided"** enabled |
| the moved `FanOutRecordTable` | checkbox table, 52 records, `off by ₹X` marks, the verdict line, and `disabledKeys` still **dimming the `Project Expense` rows** on the partly-allocated row |
| review fix 1 (`Clear selection` on `decisionLinkKeys`) | rendered on the first tick and cleared every tick, the badge and the button |

Console across the whole walk: **one** exception, the pre-existing `index.html` jinja placeholder
(`frappe.boot = {{ boot }}`, line 32) that any vite dev server raises because it serves the RAW
template — it fires identically on :8080. No React errors.

⚠️ **WHAT THE WALK DELIBERATELY DID NOT DO: click Confirm.** `settleOne`'s target-building is the one
changed reader a click would exercise, and **a whole-transfer `settle_row` writes no legs, so it
cannot be reversed from the screen** (ADR-0020 D1/A3) — irreversible even on fixture data. The
evidence standing in its place: the "1 decided" count the bar shows comes from the SAME
`decisionLinkKeys` call `settleOne` builds its `targets` from, and the swap it replaced
(`decision.linkTargets ?? []`) returns the identical Set for every shape the app can produce today.

---

## The Confirm gate is a pure predicate returning a REASON (#1239, prefactor — 2026-09-10)

**No user-visible change.** The rule deciding whether Confirm is available moved out of
`DecisionDialog` and into `allocationView.confirmGate`, the module that already owns the allocation
view's pure logic. It was an inline OR-expression in the footer:

```ts
busy || !isConfirmable(row, decision) || (isLinkDecision && (bar.over || legsUnknown))
```

which this repo has **no way to test where it sat** — there is no DOM environment, by deliberate
choice (`frontend/CLAUDE.md`) — and that is how it survived four review passes while making the
part-payment and TDS-deduction detours unreachable from the product (#1236 defect 1). The narrowing
that fixes that is a later ticket; this one only moves the rule somewhere a test can see it.

### It returns a reason, not a boolean, and the reason is ONE value with the message

`ConfirmGate` = `{ reason, balanceReason, balanceMessage }`. The gate and the sentence beside it
used to be derived at two different places — the gate in the footer, the wording as two separate
JSX conditions in the balance bar — with nothing tying them together, so a change to one could
silently stop describing the other. One call now answers every part, and a test asserts
`reason === balanceReason` whenever the balance is what disables. **Do NOT re-derive any of them
from `bar.over` / `legsUnknown` at a render site.** THREE readers take it: the button's `disabled`,
the bar's branch + text, and the button's LABEL (whose completion claim used to read raw
`legsUnknown`).

⚠️ **THERE IS DELIBERATELY NO `disabled: boolean` ON `ConfirmGate` — the button reads
`gate.reason !== null`.** A convenience projection is exactly what lets a caller take the boolean
and never consult the reason, which is the "bare boolean" shape this ticket exists to remove; the
requirement is that the dialog render the disabled state FROM the reason. **Do not add one back** —
the "nothing blocks" test is a WHOLE-OBJECT `toEqual`, so it goes red if anyone does.

⚠️ **`reason` IS TOTAL, which is why `busy` and `decision-incomplete` are members** even though
nothing on screen says either out loud today (neither had a message before this change, and this is
a prefactor with no user-visible change). Without them `reason` would read `null` — "Confirm is
available" — on a row where the button is plainly dead, and the narrowing ticket needs to know WHICH
blocker won in order to narrow the right one. Branch ORDER is precedence and nothing else: every
branch yields the same `reason !== null`, because the expression this replaced was a plain OR.

⚠️ **`balanceMessage` IS NOT ONE SHAPE, and the caller still asks WHICH reason before rendering it.**
`balance-unknown` is a standalone sentence filling the whole bar (with no balance to print, there is
nothing for a figure to sit beside); `over-allocated` is a trailing fragment that follows the
figures, em dash included. Both are the pre-change strings, byte-for-byte.

`ConfirmGateReason` is `busy | decision-incomplete | balance-unknown | over-allocated`, in that
precedence. `balance-unknown` outranks `over-allocated`, matching the bar's own short-circuit — an
over-tick measured against a balance nobody has read is not a fact worth reporting.

### ⚠️ `balanceReason` is DELIBERATELY NOT GATED ON `balanceGoverns`, and that asymmetry is the design

`disabled` respects which path is being confirmed (`balanceGoverns`, today `isLinkDecision`);
`balanceReason` does not. A `Partially Allocated` row whose reviewer has opened the "create a new
expense" card still has legs nobody has read yet, and the bar must keep saying so — collapsing the
two would print a confident `allocated ₹0 · left ₹<the whole transfer>` there, which is the exact
false-confidence defect **review fix 1** removed. Both still come out of ONE call, which is what
stops the gate and the message disagreeing.

`balanceGoverns` is an INPUT, not a constant: the narrowing ticket will pass "the allocation endpoint
is the one being called" (reusing `chooseSettleEndpoint`) with no change to this module.

⚠️ **THE ONE THING STILL ALLOWED TO READ `legsUnknown` RAW IS THE BAR'S VISIBILITY**
(`canLinkPayment && (legsUnknown || ticks > 0 || allocatedLegs.length > 0)`). That is LAYOUT —
whether the bar is on screen at all — and it is deliberately WIDER than the gate, for the same
reason `balanceReason` is: it must render on a linkable row whose reviewer has opened a
"create something new" card. Reasons and visibility are different questions; only reasons come from
`gate`.

### Pinned by

`allocationView.test.ts` — 12 new cases: a **combinatorial pin** walking all 32 input combinations
and asserting `reason !== null` equals the inline expression this replaced; a pin that
`balanceReason === "balance-unknown"` tracks `legsUnknown` on BOTH sides of `balanceGoverns` (the
equivalence the label's swap relied on); and the whole-object `toEqual` guarding against a
re-added `disabled`.

Full suite after the change: **3454 passed / 90 files**. ⚠️ `writeOffControl.test.ts` FLAKES in a
worktree on a cold vite cache — its dynamic import of `SheetPricingPage` takes ~4.8 s against a 5 s
`testTimeout`; it passes on a warm cache and in the main checkout. Not this change.
⚠️ **`tsc --noEmit` is NOT clean on this repo and never was** — 3770 pre-existing errors, of which
**0 are in `outflow-import`**, and every importer of `allocationView` lives in that folder.
`residence_check.py` is unchanged from the branch baseline (its two ✗ lines pre-date this work —
identical counts on the untouched checkout).

### The browser walk — run 2026-09-10, Administrator, worktree on :8081

Four states walked on `ZTEST Fanout Traders` ₹1,00,000 (legs ₹40,000 + ₹25,000, ₹35,000 remaining),
**without clicking Confirm** — same discipline as the walk above:

| State | What was observed |
|---|---|
| no tick (`decision-incomplete`) | `Confirm → Paid` greyed; bar neutral **`allocated ₹65,000 · left ₹35,000`** |
| tick that fits (available) | button armed, reading **`Allocate 1 record · completes this transfer`**; bar **`allocated ₹1,00,000 · left ₹0`**, neutral |
| over-tick (`over-allocated`) | button greyed, label drops the completion claim; bar RED reading **`allocated ₹1,30,100 · left ₹-30,100 — untick something before confirming`** |
| the `balanceGoverns: false` corner | selecting **Create a new expense** clears the ticks, dims the picker, and returns the footer to `Confirm → Paid` disabled **by the form** — the balance no longer governs while the bar still reports |

Console: the pre-existing `{{ boot }}` jinja placeholder exception, plus the pre-existing Radix
`DialogContent requires a DialogTitle` a11y warning already recorded above as a standalone fix. No
new errors. ⚠️ **The `balance-unknown` neutral box was NOT reproduced in the browser** — it needs the
legs fetch in flight or failed, which the fixture world does not hold still for; it is covered by
the unit test and by the branch condition being mechanically equivalent to the one it replaced.

The fitting-tick and over-tick states were **re-walked after the two-axis review's fixes** (the
button reading `gate.reason !== null`, the label reading `gate.balanceReason`) and rendered
identically, which is the point of re-walking: those fixes touched render code the first walk had
already signed off.

⚠️ **A `--port 8081` vite started through `docker exec` SURVIVES stopping the exec client** — the
process keeps running in the container and a restart then fails with `Port 8081 is already in use`.
It also keeps WATCHING, so it serves current code; verify with
`curl -s localhost:8081/src/<path> | grep <a token only the new version has>` rather than assuming
either way. Kill it with `docker exec <container> pkill -f "port 8081"`.

---

## The settlement reference, resolved once at ingest (#1244 / ADR-0020 B9 — 2026-09-11)

The last slice of the fan-out arc, sequenced last because it had **zero live instances**: 61 Cashfree
rows carry a blank `bank_reference_no`, all 61 are `Skipped`, and blank-`utr` payments in the database
were 0 of 344 settled legs. Latent, not bleeding.

### What was wrong

`settle_payment` read ONE field, `row.bank_reference_no`, and wrote it `if reference:` — **a blank
reference was a silent skip, not an error.** The row also carried `reference_id`, the gateway's own
reference, extracted since the first slice and never used. With no group id by deliberate design, a
shared reference is the only thing linking the several payments of one transfer on the Payments
screen, so the blank cost an accountant the only handle they had. It was **five write sites**, not
one — the other four already wrote an explicit `None`.

### The shape

A new **`Outflow Import Row.settlement_reference`** (Data, read-only), resolved ONCE at ingest by the
new pure leaf `services/outflow_import/settlement_reference.resolve_settlement_reference`:

| rung | value | scope |
|---|---|---|
| 1 | `bank_reference_no` | every source |
| 2 | `reference_id` | every source |
| 3 | `transfer_id` | **`sources.TRANSFER_ID_REFERENCE_SOURCES` only — today `{"Cashbook"}`** |

⚠️ **THE PER-SOURCE RUNG LIVES IN THE RESOLUTION, NEVER AT A WRITE SITE.** That is the whole point of
resolving once. The wallet's old remedy — `cashbook.py` passing `payment_ref=transfer_id` into the
EXPENSE path by hand — is exactly the per-path divergence this replaces, and it is why the PAYMENT
path stayed broken for that source: a remedy at one write site fixes one write site. Both the
`payment_ref` parameter on `create_expense_from_row` and the `utr` parameter on
`create_inflow_from_row` were **deleted** in the same change; re-adding either puts a second answer
back in the codebase, free to drift.

The third rung asks a NAMED capability question (`sources.source_transfer_id_is_its_reference`),
following that module's own stated convention. ⚠️ Its default for an unknown source is **`False`** —
the OPPOSITE of `source_has_settlement_path`'s, deliberately: that one keeps an unrecognised source on
the path it has always been on; this one declines to WRITE a value into the ledger on a source nobody
has thought about yet.

### Two ingest sites, one resolver

`upload._stage_batch` (gateway + passbook) and `cashbook._stage` (the wallet's own staging path) both
call it. The wallet path always lands on rung 3, so writing `raw.transfer_id` there directly would
produce the identical string today and be the **second definition of the ladder** — at the very source
that made the ladder necessary.

### ⚠️ THE LOAD-BEARING CONSTRAINT — THE MATCHER NEVER READS IT

`reference_id` is **NOT unique**: 2,237 Cashfree rows carry 523 distinct values, and one value
(`2386126381`) was measured on three separate rows. Five surfaces are **byte-unchanged** and none may
ever be pointed at the new field — `normalize_reference`, `candidates._payments_by_reference`,
`matcher.match_by_reference`, the parser's stored `normalized_reference` column, and
`reference_guard.assert_reference_is_free`. No file among `normalize.py` / `candidates.py` /
`matcher.py` / `reference_guard.py` / `parser.py` appears in this slice's diff.

**`settle_payment` therefore GUARDS on `bank_reference_no` and WRITES `settlement_reference`** — two
values, two jobs. Collapsing them back into one variable is the mis-wire, and the COLLISION GUARD is
where it bites first: a gateway id fed to it would refuse the second of two unrelated transfers
outright, with a message about a duplicate that is not one.

Accepted cost (owner, unchanged): a gateway id in `Project Payments.utr` is invisible to tier 0 and to
the re-import duplicate guard. Invisible-but-present loses nothing against the blank it replaces.

### ⚠️ IT IS FIVE WRITERS AND ONE READER — the sixth site the spec did not count

`expenses.reverse_allocation` READS BACK what the payment write site wrote: `_revert_payment` refuses
to unwind a payment whose `utr` is not this transfer's. It compared `bank_reference_no`. After B9 a
blank-bank-reference row settles with its GATEWAY reference, so that guard would see a stored `GW-…`
against an expected `""` and refuse — **the exact 61 rows this slice exists for would settle and then
be PERMANENTLY UN-REVERSIBLE**, with a message blaming a third party for re-pointing the payment.

It now reads the same resolved value. **Found by the spec review, not by a test** — no suite settled
such a row and then reversed it. `test_reverse_allocation.TestReversingALegSettledWithAResolvedReference`
now does, with the re-pointed guard as its positive control, and was confirmed RED against the old line.

### ⚠️ THE DEPLOY-WINDOW FLOOR — one function, both readers, and it keeps every rung

`settlement_reference_of_row(doc)` takes the stored column and recomputes the ladder **only when it is
blank**. Both api readers (`review._StagedRow`, `expenses.reverse_allocation`) call it. **Without it
this slice is a REGRESSION**: the backfill's `patches.txt` wiring is added by the maintainer, by this
repo's own convention, so the code can be live while the column is still NULL on every existing row,
and reading the column alone would settle every one of them with a BLANK.

⚠️ **The recompute goes through `resolve_settlement_reference`, never a shorter ladder.** A first draft
floored on `bank_reference_no` alone; it looked harmless and silently dropped the WALLET rung, so a
pre-backfill wallet row would have written a blank where the deleted per-site override wrote its
transaction id — the very source B9 exists to reach. Caught by the spec review.

⚠️ **REMOVAL CONDITION** (on the function): delete the recompute once the backfill is wired into
`patches.txt` and has run everywhere. Pinned by
`test_allocate_row.test_every_leg_carries_the_RAW_bank_reference`, whose fixture builds a row the
pre-B9 way — `_staged_row`'s default shape is deliberately NOT modernised for that reason.

`review._load_rows` gained `settlement_reference` and `source`: `_StagedRow` builds the value for every
row it adapts, and a projection omitting them would silently hand the wallet rung a blank.

### The backfill

`patches/v3_0/backfill_outflow_settlement_reference.py`: one `UPDATE … FROM`, `has_column` guard,
idempotent, source names spelled literally rather than imported (a patch is append-only history).
**Run against the live dev database 2026-09-11: 2,511 rows, 2,237 Cashfree + 274 Cashbook, blanks
2,511 → 0, and a second run changed nothing.** All 61 of the blank-bank-reference rows resolved on
**rung 2** (`reference_id`); none needed rung 3. A post-run audit found **0** non-wallet rows stamped
with their own transfer id.

⚠️ **The `patches.txt` wiring IS part of this change**, unlike its two siblings — the maintainer
asked for it inline (2026-09-11), so the `[post_model_sync]` line ships in the same commit. That
closes the deploy window on THIS database only; the floor stays, because a database that has not yet
run the migrate still has the column NULL on every row.

### Tests — and every new one was proven to go RED

| suite | before → after |
|---|---|
| pure services | 862 → **883** |
| `test_upload` | 76 → **84** (the ingest ladder, per rung + per source; the backfill patch, incl. its scope negative and a resolver-vs-SQL parity pin) |
| `test_settle_payment` | 56 → **63** (the five write sites; the collision negative + its positive control; the deploy-window floor) |
| `test_reverse_allocation` | 17 → **19** (the sixth site — settle with a resolved reference, then reverse; plus the re-pointed guard as control) |
| `test_cashbook_import` | 34 → **35** (the wallet's own ingest site) |
| unchanged and green | `test_review` 251, `test_expenses` 45, `test_inflows` 44, `test_approved` 29, `test_allocate_row` 17, `test_match_record` 12, `test_cashbook_rules` 13, `payments/test_payment_split` 31 |

⚠️ **THE SQL RESTATEMENT IS PINNED AGAINST THE RESOLVER.** The patch restates the ladder rather than
importing it (deliberate — a patch is append-only history), and the two never meet at runtime: the
resolver runs at ingest, the SQL once at migrate. Each side's own tests would stay green through a
divergence. Verified against **all 2,511 live rows — 0 mismatches** — and pinned per rung and per
source by `test_the_sql_restatement_agrees_with_the_resolver_on_every_rung`.

⚠️ **THE MOST IMPORTANT TEST IS THE NEGATIVE ONE, AND IT WAS PROVEN.** Three deliberate breaks were
run and each produced the expected red:

| break | went red |
|---|---|
| guard re-pointed at `settlement_reference` | `test_a_colliding_gateway_reference_does_not_block_the_settle` |
| payment write reverted to `bank_reference` | that one, plus `…_settles_with_the_gateway_reference` and `…_carries_its_wallet_reference` |
| backfill's `b.source = 'Cashbook'` unscoped to `1 = 1` | `test_it_never_gives_a_gateway_row_its_own_transfer_id` |
| the sixth site reverted to `row.bank_reference_no` | `test_a_leg_settled_with_the_gateway_reference_reverses`, with the live refusal text |

Proving the write works is the easy half; proving the read stayed put is the half that protects
matching. The collision test ships with a **positive control** — the same colliding value in
`bank_reference_no` must still raise `DuplicateReferenceError` — so it cannot pass because the guard
was switched off or the planted holder never found.

⚠️ **`dataclasses.replace` does NOT re-derive.** Clearing `bank_reference_no` on a parsed `RawRow`
leaves `normalized_reference` holding the old value — a row no parser could produce. The ingest test
that pins the matcher's column blanks both, and said so; an earlier draft asserted against a fixture
that lied.

### Running a suite against a worktree

`bench` resolves `nirmaan_stack` through the main checkout, so a worktree's backend code is invisible
to it by default. **`PYTHONPATH=<worktree root>` wins** — verified by printing `nirmaan_stack.__file__`
— and the doctype JSON follows, since Frappe locates it from the module's own `__file__`. The bench
binary is at `/home/frappe/.local/bin/bench`, not under `env/bin`. A single doctype can be synced with
`frappe.reload_doctype(...)` instead of a full migrate.

`residence_check.py`: B1/B2/B3 hold at baseline. Its two ✗ lines are **F2 and F5, both frontend
rules**, and this slice's diff contains **zero frontend files** — pre-existing branch drift.

---

## Slice 1 (2026-09-11) — the mode radio: routing reads INTENT, not tick count

**Issue #1241** (parent #1236, ADR-0020 Amendment B § B3). This is the owner's actual blocker: a
reviewer could not tick one approved payment worth less than the bank transfer, confirm it as the
first leg, and come back in a later sitting for the next. The dialog chose its endpoint from the
NUMBER of ticked records, so a single tick on an untouched row always went down `settle_row`, whose
guard demands the record equal the WHOLE transfer.

### The routing rule now takes a mode, and the old pins were INVERTED, not deleted

`allocationView.chooseSettleEndpoint` keeps its single home and gains `mode?: SettleMode`:

```ts
if (ticks <= 0) return null;
if (effectiveSettleMode(mode, rowStatus) === "split") return "allocate_row";
if (ticks > 1) return "allocate_row";   // a CAPACITY rule now, see below
return "settle_row";
```

- **Split always routes through `allocate_row`, including a single tick that equals the whole
  transfer.** The function cannot see an amount at all, which is what makes an amount-based shortcut
  impossible rather than merely discouraged. Reversal operates on LEGS and `settle_row` writes none,
  so a shortcut would make two identical-looking actions behave differently on undo with nothing on
  screen saying which one you got.
- ⚠️ **The `ticks > 1` clause is NOT the old tick-count rule surviving.** It is a CAPACITY rule:
  `settle_row` takes ONE target, so routing a multi-pick there would settle the first record and
  silently DROP the rest. Normal's picker is single-select by construction, so the shape is
  unreachable from the product; the clause exists so that a writer which ever produced it lands on
  the endpoint that can EXPRESS it and is refused loudly, rather than half-written in silence.
- ⚠️ **An ABSENT mode means Normal, and that default is load-bearing.** The BULK "confirm all
  matched" path has no dialog and therefore no radio; it calls `settleOne(row, decision)` with no
  mode and keeps taking `settle_row`'s stricter path. **Permanently** — do not give the bulk caller
  a mode to pass.
- ⚠️ **The old `describe("chooseSettleEndpoint")` block asserted the rule this replaces. It was
  RETIRED BY INVERSION** (`allocationView.test.ts`), per the repo's standing rule: each case now
  states the NEW truth about the very inputs the old rule got wrong, so a revert to counting ticks
  fails loudly instead of passing on a suite that no longer mentions the question. Two cases carry an
  `INVERTED:` prefix and the retired clause carries its own explanatory case. **A deleted pin checks
  nothing.**

### The status clause survives as a CONSEQUENCE, not a rule of its own

`settleModeLocked(rowStatus)` is `rowStatus === ROW_PARTIALLY_ALLOCATED`; `effectiveSettleMode`
forces `"split"` there. So the old "a single tick on a `Partially Allocated` row goes to
`allocate_row`" behaviour is byte-identical — including on the bulk path, which passes no mode —
but it now falls out of the mode rule rather than sitting beside it.

**On such a row the radio is LOCKED, not hidden**, with the reason beside it ("This transfer already
has money allocated against it… Reverse every allocation above to get the choice back"). Only the
OTHER option is disabled: greying the chosen one too would grey out the answer the reviewer needs to
read. The lock **unlocks for free after a full reversal** — every gate keys off `row_status`, and
`_refresh_row_allocation` re-derives it back to `Matched`/`Mismatched`. Verified in code, in
`test_reversing_every_leg_returns_the_row_to_an_open_status`, and on live row `OFR-26-002185`.

### Where the mode lives, and why

**On the PAGE (`OutflowMasterPage.settleMode`), not in the dialog.** `settleOne` is on the page, so
the mode must be readable at confirm time; a copy in the dialog would have to be shipped up on every
change and trusted to agree at the one moment it decides where money is written.

- **Reset rides the OPEN** (`openDecisionRow`), not an effect on `openRow`: "opening a row" and "the
  mode it opens on" are then one action and cannot come apart. `closeDecisionRow` resets too, but
  that is belt-and-braces — every route back in goes through the open. **Mode is never remembered
  between rows**; a sticky mode is how a transfer gets split by accident.
- **Switching mode CLEARS the pick** (`handleSettleModeChange`), and clears **BOTH** fields. The two
  modes store the pick in different fields and mean different things by it — one record that settles
  the whole transfer, versus one leg of several. `decisionLinkKeys` lets a non-empty `linkTargets`
  win, so a `linkTo` left behind is invisible while ticks exist and speaks again the moment the last
  one comes off. Same writer contract every other writer of these fields holds.
- The dialog receives the CHOSEN mode and derives `effectiveMode` / `modeLocked` **once**, handing
  `effectiveMode` down to `LinkPaymentSection` → `RecordPicker`. The picker must never re-derive it,
  or the control collecting the pick and the rule routing it could disagree about the endpoint.

### The picker forks on the mode — two components, still not consolidated

`RecordPicker` renders `SettleableRecordTable` (Normal: one `<input type="radio">`, all three
ledgers) or `FanOutRecordTable` (Split: checkboxes). The duplication stays sanctioned by owner
ruling — see either file's header.

- **Normal's `onSelect` writes `linkTo` + `target` and CLEARS `linkTargets`.** A seeded decision
  arrives carrying `linkTargets` (`seedDecisions` writes a singleton set), which
  `decisionLinkKeys` lets WIN — so a Normal pick that forgot to clear it would settle the machine's
  old record instead of the person's new one, silently, with the person's choice on screen.
- **`selectedRecords` now resolves through `decisionLinkKeys`, not `decision.linkTargets`.** Same
  reason: a seeded suggestion would otherwise be invisible in the Normal table while the footer still
  counted the row as decided. The prune effect, `disabledKeys` and both tables' `selected` prop all
  read that one memoised `linkKeys`, so the ticked boxes and the balance bar can never count
  different things. **`EMPTY_LINK_TARGETS` was deleted** — `decisionLinkKeys` already returns a
  module-level empty set, so the identity stability is inherited from the one function that had to
  have it. Do not add a second.

### Split lists payments only — a narrowing, with two sentences

`recordPickerView.splitCandidates(pool)` keeps only `Project Payments`, applied **before** any
filter, facet or sort runs, so the count line, the facets and the "Showing N of M" arithmetic all
describe the list the reviewer can act on.

- It **adds no rule** — `allocate_row` throws on the first non-payment target and
  `tickAllowedForFanOut` already withheld the checkbox. It stops OFFERING what would be refused.
- **No fallback to the whole pool when it comes back empty.** That would offer the very records the
  endpoint refuses, on the screen whose job is to stop that.
- `SPLIT_PAYMENTS_ONLY_NOTE` renders **always in Split**, not only when something was dropped: a
  reviewer hunting an expense they can SEE in Normal needs the reason at the moment they look for it.
- `SPLIT_NO_CANDIDATES_NOTE` replaces the Normal empty sentence when the narrowed pool is empty — a
  silent empty list, or "there are no approved payments or expenses to link to" over a pool that
  still holds expenses, both read as a broken screen. It NAMES the way out (switch back to Normal).
- ⚠️ **`disabledKeys` / `tickAllowedForFanOut` are now belt-and-braces and are KEPT ON PURPOSE.**
  Nothing can fire them while the pool is narrowed. They stay because they mirror a SERVER refusal,
  not because they decorate the narrowing: if the pool is ever widened again the withholding has to
  already be in place rather than be remembered.
- **Filters and sort reset on a mode change**, as they already did on a row change. Split narrows
  before the facets are computed, so a vendor filter set in Normal can survive into a Split facet
  list that no longer offers it — an active filter with no chip on screen, exactly the shape that
  reset exists to prevent.

### ⚠️ Two changes NOT in the ticket that the slice could not ship without

1. **The amount-window detour is gated on Normal mode.** `handleConfirmClick` ran `settleBlocker`
   whenever exactly one record was ticked. `suggested` is false for any record outside the settle
   window of the FULL transfer, so **a deliberate first leg would have opened "this record is
   ₹2,19,000 away from the transfer" instead of being allocated** — acceptance criterion 1
   unreachable. Task 7 had already exempted a multi-tick fan-out ("governed by the balance bar
   instead"); Split is that same fan-out at ONE tick, so the exemption follows the MODE, not the
   count.
2. **The Confirm label says "Allocate" only when it is going to allocate.** It keyed on `ticks > 0`
   alone, so a single pick routed to `settle_row` still read `Allocate 1 record`. Survivable while
   the routing was invisible; with a mode radio directly above it, "Allocate" one line under a chosen
   "Normal" is a straight contradiction. Normal keeps `Confirm → Paid`, which is also what the
   endpoint actually does.

### The label must not say "partial", and the ban is MECHANICAL

The same dialog renders `PartialIntentChoice`'s radio labelled **"A part payment"**, belonging to the
INVERSE feature (one approved payment split across several TRANSFERS). Two radio groups in one dialog
with near-identical labels and opposite meanings is the worst available outcome. The visible copy
lives in `allocationView.SETTLE_MODE_LABEL` / `SETTLE_MODE_HINT` and a test in
`recordPickerView.test.ts` asserts that neither those nor either split note contains
`part payment` or `partial`. **Do not move the copy inline** — the ban would become a note somebody
has to remember.

### The radio's placement

Directly ABOVE the picker it governs, BELOW `AlreadyAllocatedSection`, and **gated on
`canLinkPayment`**. That is "the top of the settle dialog" in the only sense that is true: a CREDIT
row has no settle picker at all (it is recorded as an inflow or a receipt), so the question there
would be offering a choice about a control that is not on the screen. It sits below the legs for the
same reason those sit above the picker — the money already written against the transfer is the
evidence for why the mode is locked.

### Verification

- `vitest run` — **90 files, 3465 tests, all green** (baseline before the slice: 3454 with one
  container-timing flake in `POAdjustment/writeOffControl.test.ts`, which passes on a re-run). Eleven
  new tests: the inverted routing block, `effectiveSettleMode` / `settleModeLocked`, `splitCandidates`
  and the copy ban.
- `tsc --noEmit` — **zero errors under `src/pages/outflow-import/`** (the repo carries a large
  pre-existing backlog elsewhere).
- ⚠️ **NOT verified in a browser by this slice.** Everything the mode touches that a unit test can
  see is pinned; everything it touches that a unit test CANNOT see — the radio rendering, the lock,
  the mode switch clearing a tick, the Normal radio table, and the first-leg-then-second-leg walk
  itself — is a React semantic in a repo with no DOM environment, by deliberate choice. **Issue
  #1245 is the browser walk and is where those criteria are actually discharged.**

### The two-axis review wave (same day) — AC10 answered, and one reachable defect found

The Standards axis and the Spec axis were run as separate agents against `d13aecdc`. Between them
they produced one real defect, one documented-standard breach and the acceptance criterion the first
pass had missed. All three are fixed in the follow-up commit; the rest were judgement calls, recorded
below with the reason they were not taken.

#### AC10 — the ledger-withholding gap: **ANSWER 2 IS TAKEN, and this is the record of it**

The ticket offers two ways to close it and demands one be chosen deliberately:

> either the radio picker withholds non-payment rows with a reason, or a test pins that a
> `Partially Allocated` row can never reach the radio picker

**Answer 2** — proved unreachable. `tickAllowedForFanOut` + `disabledKeys` are wired ONLY to
`FanOutRecordTable`; the restored `SettleableRecordTable` has no equivalent, so if it could render on
a `Partially Allocated` row a reviewer could pick an expense, press Confirm, and be refused by the
server for a reason nothing on screen hinted at.

⚠️ **The ticket forbids answering "it can't happen" without pinning it**, and the pin has to be of
the JOIN, not of either half: `effectiveSettleMode` forcing `"split"` and the render fork consuming
it are two facts that can both be true while the wire between them is cut. So the fork was extracted
out of the JSX into `allocationView.settlePickerFor(mode): "radio" | "checkbox"`, and
`allocationView.test` pins the composition the screen actually runs —
`settlePickerFor(effectiveSettleMode(chosen, "Partially Allocated")) === "checkbox"` for **every**
chosen mode, plus the negative half so the pin cannot pass on a function that returns `"checkbox"`
for everything. Same reason `PricingGrid` keeps `selectRenderPath` outside its JSX: this repo has no
DOM environment, so a ternary in a render is beyond every test it has. **Do not inline it back.**

Answer 1 was rejected: it would add a `disabledKeys` prop to a component restored byte-identical one
commit earlier, to withhold rows that can never be shown — dead code standing in for a proof.

#### ⚠️ A REACHABLE DEFECT: a decision OUTLIVES the dialog, but the mode does not

**Tick two payments in Split, close the dialog WITHOUT confirming, reopen.** The mode resets to
Normal on every open; the decision does not reset at all — it lives in the page's `decisions` map. So
the radio table renders showing ONE of the two, while `settleOne` still reads both through
`decisionLinkKeys` and, by the capacity rule, posts them to `allocate_row`. **The screen would show
one record and settle two.** No mode switch is involved, so `handleSettleModeChange`'s clearing never
fires; reversing every leg of a `Partially Allocated` row reaches the same shape by a second route.

Fixed at the open: `openDecisionRow` drops a pick the opening mode cannot represent, via the pure
`outflowTableModel.pickFitsSingleSelect`. ⚠️ **It CLEARS, it never truncates** — taking the first key
would silently settle one of two records the reviewer deliberately chose, and a wrong write is worse
than a lost selection, which the reviewer can at least see.

#### ADR-0010 F4 — the clearing rule moved out of the page

`handleSettleModeChange` spelled the clearing inline as `{...current, target: undefined, linkTo: null,
linkTargets: new Set()}` — a domain rule about `outflowTableModel`'s own two-field shape, living in a
page component where this repo cannot test it, while every neighbouring rule in the same commit
(`effectiveSettleMode`, `settleModeLocked`, `splitCandidates`) had been extracted and pinned. It is
now `outflowTableModel.clearedPick`, pinned in `outflowTableModel.test` — including that `linkTo` is
present-and-`null` (a deliberate clear) rather than dropped (never picked), which `seedDecisions`
reads.

#### Judgement calls NOT taken, and why

- **`isPartiallyAllocated` and `settleModeLocked` are the same comparison three lines apart.** Kept
  as two, with a note. They are two different questions — "does this transfer already have legs?"
  (gating the legs fetch and the already-allocated section) and "does the reviewer get a choice of
  mode?" — that happen to share one answer today. The mode question must read the function
  `chooseSettleEndpoint` also reads, or a change to the locking rule would move the routing and leave
  the radio behind.
- **The mode copy lives in `allocationView` while the split notes live in `recordPickerView`.** Each
  constant sits with the concept it describes — the mode vocabulary, and the pool view. The
  "partial"-ban test spans both deliberately, because the ban is about the DIALOG, not either module.
- **Effect deps carry a `Set` and an array** (`linkKeys`, `selectedRecords`). Both are `useMemo`'d,
  so identity is stable; the standing rule is about inline objects/arrays minting a new identity per
  render.
- **Three `setOpenRow(null)` closes** (reverse / partial-settle / skip) do not call
  `closeDecisionRow`. Harmless because the reset rides the OPEN and every route back in goes through
  `openDecisionRow` — which is also where the multi-pick guard now sits, so those paths inherit it.

#### Two further scope items the Spec axis flagged, both deliberate

- The `decisionLinkKeys` / `linkKeys` rewrite of `selectedRecords`, the prune effect and
  `disabledKeys` is **required**, not incidental: the Normal table takes a SCALAR `selected`, and
  `seedDecisions` writes its suggestion into `linkTargets` on a row that opens in Normal mode — so
  reading `decision.linkTargets` alone would have left every seeded suggestion invisible in the
  Normal table while the footer still counted the row as decided.
- The `LinkPaymentSection` subtitle follows the mode because the old line ("the approved record(s)
  this transfer paid — payment or expense") is false in both halves under Split, and it sits directly
  above the control it describes.

**Verification after the wave:** `vitest run` — 3471 of 3472 green; the one failure is
`POAdjustment/writeOffControl.test.ts` timing out at 5s under full-suite parallelism in the
container, **which passes 19/19 in isolation and is present in the pre-slice baseline** — unrelated.
`src/pages/outflow-import` alone: **10 files, 607 tests, all green** (600 before the wave).
`tsc --noEmit`: zero errors under `src/pages/outflow-import/`.


---

## Slice 1b (2026-09-11) — the Confirm gate is NARROWED to the allocation path

**Issue #1242** (parent #1236, ADR-0020 Amendment B § B4). The gate disabled Confirm whenever a
ticked record exceeded the transfer by more than the tolerance. On a fresh row `banked = 0`, so
`bar.over` reduces to *"the ticked record exceeds the transfer by more than the tolerance"* —
**algebraically the same condition** that opens the part-payment / TDS detour, since the settle
window and `AMOUNT_TOLERANCE` are literally the same constant. That detour's ONLY trigger is
`handleConfirmClick`, which a disabled button never fires. **So every pick that could open the
detour was a pick whose Confirm was dead**, and both paths sat live in source and unreachable from
the product.

⚠️ **Two corrections to the record, for anyone bisecting.** The clause was **not** introduced by the
"six review fixes" commit — that added only the `|| legsUnknown` disjunct, which is innocent. It came
from the **feature commit** and was present from the start. And it was **plan-mandated, not a review
finding**: the design spec said *"over-ticking is allowed; Confirm is not"*, a rationale entirely
about WHICH control disables. Nothing in the plan, brief, report or four review passes considered
its effect on the single-tick path. **So narrowing it reopens nothing.**

### The routing rule IS the predicate — `confirmGate` takes the endpoint, not a boolean

`confirmGate` gains `endpoint: SettleEndpoint | null` — `chooseSettleEndpoint`'s own return value,
passed straight through from `DecisionDialog` off the same chosen `settleMode` the page routes the
confirm with. Inside:

```ts
const allocationGoverns = balanceGoverns && endpoint === "allocate_row";
```

⚠️ **THE ENDPOINT IS PASSED, NOT A BOOLEAN DERIVED AT THE CALL SITE.** ADR-0020 B4: *"the predicate
already exists and is already single-homed."* A boolean built in the dialog would be a second,
untestable copy of "does allocation govern here?" — the exact shape #1239 removed — and it is the
pass-through that makes the narrowing pinnable at all, which is why #1239 ran first.

**Nothing is lost.** `settle_row` keeps its strict whole-transfer guard server-side and refuses an
oversized tick regardless; the client gate was never the boundary.

### ⚠️ `legsUnknown` is NOT narrowed, and the two terms must not be folded back together

`balance-unknown` keeps `balanceGoverns` alone; only `over-allocated` reads `allocationGoverns`:

```ts
busy -> "busy"
!decisionConfirmable -> "decision-incomplete"
balanceGoverns && legsUnknown -> "balance-unknown"
allocationGoverns && over -> "over-allocated"
```

`legsUnknown` is innocent (ADR-0020 B4, explicitly): it is already scoped to `Partially Allocated`
rows, so it is always false on a fresh one, and such a row is FORCED to Split and therefore inside
the narrowed set anyway. Ruling U — *never draw a confident balance over an unknown leg set* — must
keep biting on every endpoint. ⚠️ **Branch order is no longer merely cosmetic**: the last two carry
DIFFERENT conditions now, so re-ordering them changes which reason is NAMED (though still never, on
any input, whether Confirm is available).

### The red bar survives; only the instruction changes

The bar still goes red and still says the ticks exceed the transfer — the over-tick is a real fact on
a money screen whichever endpoint is about to be called. But *"— untick something before confirming"*
is advice about a tick-set the gate is REFUSING, and beside a live button it is simply wrong, so the
message tracks whether the gate bites:

| Path | `balanceMessage` |
|---|---|
| gate bites (`allocationGoverns`) | `— untick something before confirming` (unchanged) |
| narrowed away | `— press Confirm to see your options` |

Both still come out of the ONE `confirmGate` call, which is what stops the gate and the message
disagreeing — the whole point of #1239's one-value shape.

### The server refusal names Split mode, not TDS

`settle.py`'s payment amount-mismatch throw dropped *"A deduction such as TDS looks like this; settle
it in the payments screen."* It sent a reviewer off the screen for a problem most of them do not
have: the commonest arrival here is now a DELIBERATE first leg — a payment smaller than the transfer,
which Split mode allocates and this whole-transfer path is right to refuse. A real deduction is
answered on the screen itself by `AmountOutsideWindowDialog`, which opens when the record is LARGER
than the transfer. It now reads:

⚠️ **THE REMEDY IS DIRECTION-AWARE, and it has to be — the throw fires on BOTH directions.** An
unconditional *"choose Split"* would be a newly-wrong sentence for half its arrivals: Split allocates
several records against one transfer, so a record LARGER than the transfer would be over-allocated by
following it. `settleBlockText` already splits the two cases client-side (`bank_paid_more` vs
`record_larger`); this now matches:

| Direction | What it says |
|---|---|
| record **smaller** than the transfer (`amount < bank_amount`) | *To settle it as one part of this transfer, choose 'Split across several payments' on the row.* |
| record **larger** | *This record is larger than the transfer. Open the row and confirm the pick to see the options for the difference.* |

⚠️ **That second row is NOT redundant with the dialog.** The BULK *"confirm all matched"* button
reaches this function with no dialog in front of it to intercept the pick, so the sentence has to
carry the answer itself.

⚠️ **The quoted label MIRRORS `allocationView.SETTLE_MODE_LABEL.split`, AND IS NOW PINNED** —
`settleModeLabelParity.test.ts` reads `settle.py` as text and asserts the TypeScript label appears in
it, that the retired TDS sentence does not, and that the record-larger branch still answers. Naming a
control the reviewer cannot find is the same defect as naming the wrong screen, and a comment saying
*"reword both together"* is prose where this repo mandates a test (root `CLAUDE.md`'s
`INFLOW_DOCTYPE` precedent; ADR-0010 F1). Two properties of that pin are load-bearing: its FIRST case
asserts the file was actually found and is non-trivial (every other case is a substring check, so a
rotted path would make them all vacuously pass), and the absence check scans the file **with `#`
comment lines stripped** — `settle.py` deliberately quotes the retired sentence in the comment
explaining why it went, and the naive check went red on the very change it protects.

⚠️ **HONEST LIMIT: `vitest` is a LOCAL gate, not run by CI** (`frontend/CLAUDE.md`), which runs the
Python suite only. A bench-side twin would run in CI but would have to read the TypeScript file as
text in the other direction; one pin, not two, is the rule, and this is the side that could be run
and proven at the moment it was written.

The EXPENSE mismatch throw (`settle_existing_expense`'s) never cited TDS and is untouched.

### ⚠️ The gate predicts with the reader the PAGE routes with, not the picker's count

`DecisionDialog` holds TWO tick counts and they diverge **by design** (REVIEW FIX 3): `ticks` comes
from `pickedRecords` — the records the pool actually resolved — and drives the button LABEL and the
bar, which must agree with each other. `OutflowMasterPage` routes the confirm from
`decisionLinkKeys(decision)` instead, which counts every ticked KEY including one the pool has not
resolved yet or no longer holds.

A gate that PREDICTS the endpoint has to read what the confirm will read, so it is fed
`decisionLinkKeys(decision).size`. Feeding it `ticks` left a real hole: an unresolved key reads as
`endpoint === null`, the over-tick guard is skipped, and the row it is skipped on is one whose
ALREADY-BANKED legs exceed the transfer — precisely the row that must not be confirmed. It is also
the same reader `isConfirmable` uses, so a `null` endpoint can never outlive a confirmable decision,
and the test suite pins that composition rather than only the bare input.

### Parked with a ruling (do not rediscover as new)

On a `Partially Allocated` row with a single tick, the detour's own comparisons read the WHOLE
transfer rather than the remainder. B1 makes that shape unreachable — such a row is forced to Split,
and `handleConfirmClick` gates the detour on `effectiveMode === "normal"` — **so the bug dies rather
than being fixed.**

### Verification

`allocationView.test` grew a `confirmGate — the narrowing` block; the pre-existing *"matches the
inline expression it replaced"* pin was **RETIRED BY INVERSION, never deleted** — it now asserts the
old algebra still holds on `allocate_row` AND that the same formula **with `over` struck out** is the
truth on `settle_row`. **Mutation-checked:** reverting `allocationGoverns` to plain `balanceGoverns`
fails 5 of the new cases.

`vitest run` (in-container): **91 files, 3487 tests, all green.** `src/pages/outflow-import` alone:
11 files, 622 tests. `tsc --noEmit`: zero errors anywhere under `src/pages/outflow-import/`.

The label parity pin is **mutation-checked too**: rewording `SETTLE_MODE_LABEL.split` to *"Split
across many payments"* turns it red. It also went red once for a REAL reason during the change — on
`settle.py`'s own comment quoting the retired TDS sentence — which is the best evidence available
that it is reading the file it claims to read.

✅ **AC1 + AC2 ARE OWNER-VERIFIED IN THE BROWSER (2026-09-11): the dialog opens.** That is the
verification this slice was gated on, and it is recorded here because nothing else can hold it —
the dialog is STRUCTURALLY untestable in this repo (no DOM environment, deliberate), so *"Confirm is
clickable on a single oversized tick and the amount-window dialog opens"* is pinned only at the
predicate. Before the walk, the runtime path had merely been traced by hand (gate → `disabled` →
`handleConfirmClick` → `settleBlocker` → `setBlocked`, with `SHOW_PARTIAL_SETTLE = true` and
`partialOffer` firing on the same over-tick shape). ⚠️ **A later change to any link in that chain
re-opens the question and needs its own walk** — a green suite will not notice, which is the whole
reason the gate was able to make two features unreachable in the first place.

⚠️ **STILL OWED: the `settle.py` throw is not EXERCISED.** Its COPY is pinned by
`settleModeLabelParity.test.ts` and it is syntax-checked, but no bench suite was run against it —
and CI runs the Python side, so the first real exercise will be a genuine amount mismatch on a live
row. The direction-aware branch is the half to watch: a record LARGER than the transfer, arriving
through bulk *"confirm all matched"*, is the shape with no dialog in front of it.

---

## Slice 1c (2026-09-11) — the picker measures the REMAINING BALANCE, not the full transfer

**Issue #1243** (parent #1236, blocked by #1241 — the mode had to exist before the picker could
measure differently inside it).

On a partly-allocated transfer the record picker was answering a question nobody had asked. The
payment that would **complete** the row scored zero on the amount axis, came back
`suggested: False`, and therefore sorted **below every record too large to fit** — because
settleability is a HARD SPLIT above the score (`similarity.ranked_records`). It was then labelled
with a large "off by" figure, and a single tick on it was refused with a message untrue of the
balance actually left. The one record the reviewer needed was presented as the least plausible.

⚠️ **FAR SMALLER THAN THE HANDOFF'S "TEN SITES" FRAMING.** The endpoint derives its comparison
amount at **ONE point** and every consumer below it already takes it as an **argument** — the
per-ledger SQL `ORDER BY`, the `suggested` flag, the ranker's hard split (which rides in on
`suggested`, never recomputed) and `_amount_score`. **One substitution moves all four**, which is
exactly what preserves the existing invariant that there is ONE amount-opinion per record.

### The shape: a parameter on the existing endpoint, never a second endpoint

`search_settleable_records(..., compare_amount=None)`. The dialog already computes the remainder
client-side, so the parameter costs **zero additional requests**. A new read endpoint would have put
a serialised round trip on this dialog's critical path to fetch a number already in memory one
component up — and would not even have removed the direct `Outflow Row Match` read that appears to
justify it.

- **`_comparison_amount(row_amount, compare_amount)` FAILS BACK, NEVER THROWS.** Blank, zero,
  negative or unparseable → the transfer's own amount, byte-identically to before. This figure only
  ORDERS and MARKS a list a person then confirms; `settle_row` / `allocate_row` re-read every leg
  under a row lock and re-assert the real fit, so denying the reviewer the screen over a garbled
  query parameter would trade a slightly worse ordering for no ordering at all.
- ⚠️ **A NON-POSITIVE FIGURE IS REFUSED ON BOTH SIDES, AND THE PAIR IS PINNED** (`if wanted <= 0` on
  the server; `remaining > 0 ? remaining : null` on the client; `comparisonAmountParity.test.ts`
  holds them together). No approved record can be "within ₹5" of a negative or zero target, so
  honouring one would return a list in which NOTHING is settleable, with no sentence on screen
  saying why. ⚠️ **The first cut kept the negative on the client and refused it on the server, and a
  review pass caught it after both suites were green**: the two then measured DIFFERENT THINGS on
  the same row — an emerald "this can be settled" from the server beside a large client-side "off
  by" — which is exactly the contradiction this slice exists to remove. An over-allocated row is not
  hidden by this: the **balance bar** reports it, in the words written for it.
- ⚠️ **THE CONSEQUENCE THAT MAKES THE CALLER SAFE: a non-`null` `pickerComparisonAmount` is ALWAYS
  POSITIVE.** That is what lets `pickerBankAmount = compareAmount ?? row.amount` stand without a
  second `> 0` test — and a second test is how one rule becomes two copies free to drift. A test
  asserts the property directly, not just the cases.
- ⚠️ **`normalize_amount` ALREADY RETURNS `Decimal("0")` FOR RUBBISH** rather than raising, so
  "blank" and "unparseable" arrive as the same falsy zero. Do not wrap it in a `try` expecting an
  exception that cannot come.
- ⚠️ **`_rank_browse_records` NOW TAKES THE TWO TEXT FIELDS EXPLICITLY, NOT THE WHOLE ROW.** Once
  `bank_amount` may differ from `doc["amount"]`, handing both to the ranker would put two
  disagreeing amounts one argument apart — a trap for the next reader.

### Rank once per dialog open, against the BANKED remainder — never live per tick

`allocationView.pickerComparisonAmount(rowAmount, legs)` returns the banked remainder, or **`null`**
when the row has no settled legs.

- ⚠️ **`null` IS NOT `rowAmount`, AND THE DIFFERENCE IS THE WHOLE OF AC4.** They are arithmetically
  equal on an untouched row, but `null` is what lets the caller send the params and the SWR key it
  has always sent. A number there would mint a new parameter and a new cache key on **every open row
  in the system**, to say something the endpoint already knew.
- ⚠️ **IT TAKES NO TICKS, AND THE ABSENT PARAMETER IS THE ENFORCEMENT.** `allocationBar` folds ticks
  in because the bar must move live; this must not, because a list that re-ranks under the cursor
  mid-selection is worse than a static answer — and the bar beside it already shows the live figure.
  There is no third parameter for a caller to pass ticks through by accident. A test pins
  `pickerComparisonAmount.length === 2`.
- **It shares `allocationBar`'s arithmetic rather than repeating it**, so the remainder the reviewer
  READS and the remainder the picker RANKS BY cannot disagree about the same row.
- ⚠️ **THE SWR KEY CARRIES THE AMOUNT, AND IT HAS TO.** SWR caches on the key alone, so a remainder
  that arrives after the first render — which is every partly-allocated row, because the legs are a
  SECOND fetch — would otherwise never reach the server at all. **And the key is `null` while the
  balance is unknown**, which is what stops that being a race: fetching against a provisional
  whole-transfer figure would cache the wrong ranking under the wrong key and leave the reviewer
  reading it. The banked legs do not move when a box is ticked, so neither does the key.
- ⚠️ **AN UNKNOWN BALANCE IS LOADING, NOT EMPTY** (`poolLoading = isLoading || compareUnknown`).
  With a `null` key SWR never fires, so `isLoading` is `false` and `data` is `undefined` — which
  would fall through to *"There are no approved payments or expenses to link to."* on a row that has
  plenty. Same `legsUnknown` distinction the bar already draws, one component further down: **absent
  is not unknown.**
- ⚠️ **BUT `compareUnknown` IS THE LOADING HALF OF `legsUnknown` ONLY — NEVER THE ERROR HALF**
  (review finding). `legsUnknown` is `legsLoading || legsError`, and **the error half never clears
  while the dialog is open**, so passing all of it withheld the record fetch permanently: the picker
  read *"Loading records…"* forever, with the count line and Clear control hidden, on a row whose
  pool had loaded fine before this slice. **That is strictly worse than the defect being fixed** —
  the reviewer could see and link nothing at all. On a failed legs fetch the honest fallback is the
  ORDINARY list ranked against the whole transfer, which is what `compareAmount` already is there
  (`allocatedLegs` is `[]`); the bar still says the balance is unknown and `confirmGate` still
  refuses the click, so nothing can be written off the wrong number.
- ⚠️ **THE CLIENT "off by" MARK IS FED THE SAME FIGURE** (`pickerBankAmount = compareAmount ??
  row.amount`, one const, three render sites). `AmountMark` renders the SERVER's `suggested` beside a
  CLIENT-computed difference; measuring them against different amounts would print "off by ₹65,000"
  on the record the server has just flagged as the one that fits.

### The matcher-found marker is SUPPRESSED on a partly-allocated row

⚠️ **The automatic matcher is out of scope and stays out.** Partly-allocated rows are frozen from
matching and the ranker is architecturally forbidden from feeding the matcher (pinned both ways in
`test_similarity`). **One exception leaked:** `get_row_candidates` re-runs the match LIVE on every
dialog open with **no frozen-status guard**, so on such a row it marked records against the WHOLE
transfer — including records **already settled as legs of that very row**.

`matcherMarksVisible(rowStatus)` (`= !settleModeLocked(rowStatus)`) suppresses them client-side.

- ⚠️ **SUPPRESSED, NEVER MADE REMAINDER-AWARE** (owner ruling). That would push RANKING into the
  matcher, which is the one fence this feature never crosses.
- ⚠️ **THE COUNT SENTENCE GOES WITH IT, AND THAT IS WHY IT IS ONE VARIABLE.**
  `matcherCandidateLine` reads `.size` off the same set, so an empty set silences the sentence too.
  Suppressing the marks while leaving *"6 approved records match this transfer … pick which one it
  settled"* on screen would recreate the **slice-N3 defect the marks were built to fix**: an
  instruction pointing at nothing.
- It reads the SAME status `settleModeLocked` reads, so the marks and the mode can never come to
  describe different rows — pinned as a composition, the same guard `settlePickerFor` carries.

### ⚠️ A comment in the dialog was FALSE, and is corrected rather than deleted

It claimed *"the `legs` a write returns only cover THAT write"*. **`allocate_row` returns every LIVE
leg on the row, and therefore an authoritative balance.** The real reason the dialog reads
`Outflow Row Match` directly is that it needs the balance **before any write** — on open, with
nothing submitted. Left corrected in place, with the old sentence quoted: it was load-bearing enough
to be believed, and the next reader is entitled to know it was wrong.

### ⚠️ What the review pass caught, after both sides' suites were green

Both findings were **cross-seam**, which is the standing warning in this repo's testing conventions:
a test on each side of a boundary is not a test of the boundary. Each side's suite was green and
each side was internally consistent; only the JOIN was wrong.

1. **The client kept a non-positive remainder the server refuses.** Covered above and now pinned by
   `comparisonAmountParity.test.ts`, a dedicated FE↔BE parity file on the `rateFieldParity` /
   `settleModeLabelParity` precedent. The old client case was **retired by INVERSION, never
   deleted**: it now asserts `null` AND `not.toBe(-60)`.
2. **A failed legs fetch hung the picker on "Loading records…" permanently**, because
   `compareUnknown` was handed all of `legsUnknown` including its never-clearing error half. Covered
   above. ⚠️ **It was a REGRESSION STRICTLY WORSE THAN THE DEFECT BEING FIXED** — the reviewer could
   see and link nothing at all, where before they at least got a whole-transfer-ranked list. Worth
   recording as a shape: a new gate wired onto an existing "unknown" flag inherits every state that
   flag can be stuck in, and `legsError` persists until the dialog is closed.

### Verification

- `test_review` **258** (251 before), including a `#1243` block: an absent/zero/blank/rubbish
  `compare_amount` leaves the payload **byte-identical**; the `suggested` flag follows the figure;
  the completing record **outranks where it sat before**; it never sits below a record that can no
  longer fit; the **score axis** reports "the amount is identical"; and the value arrives as a
  **string**, the way Frappe hands every whitelisted argument over from HTTP.
- `vitest run`: **92 files, 3,504 tests** (3,487 before); `src/pages/outflow-import` alone **12
  files, 639 tests** (11 files / 622 before). `tsc --noEmit`: zero errors under
  `src/pages/outflow-import/`.
- Pure services suite unchanged at **883**. All ten original frontend cases were confirmed **RED**
  before the helpers existed, and all seven backend cases RED against the old signature; the seven
  added for the two review findings were written against the fixed behaviour, with the inverted case
  carrying an explicit `not.toBe(-60)` so the retired claim stays failing.
- ⚠️ **`scripts/residence_check.py` fails on this branch for PRE-EXISTING drift** (`f5` 116→119,
  `f2` 207→223). Both are frontend FILE-COUNT rules and the two files this slice touches contain
  **zero** `updateDoc` / `JSON.parse` occurrences, so it cannot have moved either count. The
  baseline has not been refreshed since the branch diverged; do not `--init` it to go green, that
  would hide real drift.

### ⚠️ STILL OWED: a browser walk on a partly-allocated row

The dialog is STRUCTURALLY untestable in this repo (no DOM environment, deliberate), so every
acceptance criterion here is pinned at the PREDICATE and at the ENDPOINT, and the join between them
— *does the computed remainder actually reach the request?* — is exactly the cross-seam shape the
standing rule says a test on each side does not cover. What a walk must observe on a
`Partially Allocated` row: the completing payment **first** in the list, marked `same` rather than
`off by`, the candidate chips **gone**, the ordering **unmoved** while boxes are ticked, and an
untouched row's list **unchanged**.
