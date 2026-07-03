# 10. Module residence rules (which module owns a rule, a shape, state, and write-safety)

Date: 2026-07-01

## Status

**Proposed — pending owner (Nitesh) sign-off.**

Derived from the pass-3 architecture review *"Architecture review — Procurement + codebase
residence rules"* (2026-06-25) and the procurement **performance investigation** (2026-07-01).
This ADR ratifies the residence rules; its first worked proof is the `sidebar_counts` aggregate
rewrite (below). Terms in [CONTEXT.md](../../CONTEXT.md) ("Module residence"). Numbered `0010`
because `0007`–`0009` are already taken (existing files collide on `0002`/`0007`/`0008`; those
are **not** renumbered here — out of scope).

## Context

`CLAUDE.md` already legislates **placement** — *which folder* a file goes in (controllers →
`integrations/controllers/`, endpoints → `api/<feature>/` snake_case, doctype `.py` minimal,
split > 500 lines). That is largely followed.

The gap the findings expose is **residence** — *which module **owns** a concept*: a business
calculation, a JSON/child-table shape, a document's `workflow_state`, write-safety. Every one of
the nine architecture findings is an **ownership** failure, not a placement failure: the file is
in the right folder, but the rule has no home, so it scatters and drifts. Because this codebase
is AI-co-developed, agents pattern-match the surrounding code, so scatter is self-reinforcing
(the PR/SB approval twin is what an agent produces when told "do for SB what we did for PR").

There is a **residence gradient**: the newer modules (BoQ, ITM, PO Adjustments) are deep and
score well; the older ones (Service Requests, Procurement) are shallow. Procurement scores
lowest. The rules below are not imposed doctrine — they **name the good half of the codebase**
(BoQ / ITM / PO-Adjustments) as the default, and every rule cites a real in-house precedent.

**The performance dimension (new, 2026-07-01).** The same disease also surfaces as *latency*,
not only correctness. One `/frontend/purchase-orders` navigation issued **2,494–3,493 SQL
queries / 23.6–139.4 s of backend worker-time** (two Frappe Recorder captures). The dominant
culprit, `sidebar_counts` (runs on every page via the sidebar), executed **403 SQL queries /
2.7 s per call** — a `frappe.get_doc`-in-loop N+1 — plus a ~6,000-row Python fetch to tally
rows by `workflow_state`. Root cause: **computation residing on the wrong side of the
row↔aggregate and client↔server seams** (counting done row-by-row in Python instead of the DB;
per-PO aggregation done in the browser instead of the server). This is a residence failure whose
cost is speed. (The realtime-subscription storm was a separate issue, already fixed by upgrading
`frappe-react-sdk` to 1.17.0 — verified in source and at runtime; it needs a prod frontend
rebuild + deploy to take effect.)

## Decision

Adopt **ten residence rules** (five backend, five frontend). Each is backed by a real finding,
anchored to an in-house precedent, and **checkable** by a test, a grep, or a one-line reviewer
question — if a rule can't be checked, it's documentation and it drifts.

### Backend (Frappe)

| Rule | Prevents | In-house precedent | Checked by |
|---|---|---|---|
| **B1** · Domain rules are **pure modules** (no `frappe.db`, no request ctx) | findings 1, 8 | `services/finance.py` · `po_adjustments/_payment_utils.py` | unit test on the fn |
| **B2** · **One owner per data shape** (keying/parsing lives once) | findings 3, 4 | `itm/_build_metadata_snapshot` | grep: parsed in ≤1 module |
| **B3** · **State is derived**, never written ad-hoc | finding 6 | ITM `ALLOWED_TRANSITIONS` | grep: `workflow_state =` in the deriver only |
| **B4** · Endpoints are **thin orchestrators** (no API→controller validator) | findings 7, 8 | `itm/create_itms.py` (savepoint) | review + grep imports |
| **B5** · Side-effects in controllers; **calculations don't** live there | accretion | `boq_nodes.py` (capture-only) | existing convention |

### Frontend (React)

| Rule | Prevents | In-house precedent | Checked by |
|---|---|---|---|
| **F1** · A domain rule has **one home**, pinned to the backend's | finding 1 | boq `reconcile.ts` · `priceability.ts` | parity test FE↔BE |
| **F2** · Backend shapes parsed at **one accessor** | findings 3, 4 | itm `useITM()` typed payload | grep inline parses |
| **F3** · Near-twin flows are **one parametric module** | finding 2 | boq: one hub, not duplicated | review: "is this a copy?" |
| **F4** · Pages/hooks **thin over pure logic** | god-hooks | boq `amountFormula.ts` (pure) | rule unit-tested without React |
| **F5** · Writes go through **one safety seam** | finding 7 | `useEditingLock` (extend it) | grep raw `updateDoc` |

### The residence map (the one-screen artifact to consult before writing)

| When you're writing… | it resides in… | precedent |
|---|---|---|
| a calculation/decision the business names (Benchmark, Loss %, auto-approval, **awaiting-approval**) | a **pure module** — backend `services/` · frontend `utils/<domain>` | `finance.py` · `amountFormula.ts` |
| anything that parses/reshapes a JSON blob or child table | **one shape-owner** module (parse + type + key) | `_build_metadata_snapshot` |
| a document's status / `workflow_state` | **one deriver** — `f(items, descendants)` | `ALLOWED_TRANSITIONS` |
| a whitelisted endpoint | a **thin orchestrator**: lock→load→call→persist→commit→publish | `create_itms.py` |
| a notification / cascade / side-effect | `integrations/controllers/` (capture-only) | `boq_nodes.py` |
| any mutation to a shared doc | the **write-safety seam** (lock + version + txn) | `useEditingLock` (extend) |
| a UI page/hook | thin orchestration; pure rules imported from `utils/` | `priceability.ts` spine |
| **a count/aggregate over many rows** | **the database** (GROUP BY / EXISTS), not a Python/JS row-loop | this ADR's first proof |

Keep this **small**. The rules generalize files you already ship; six rules people follow beat
thirty they don't. A 30-page bible would drift from the code and become finding 9 in prose.

## First proof — `sidebar_counts` (the residence rules' worked example)

Chosen as the first proof because it is the #1 measured performance cost, it runs on every page,
and it cleanly instantiates B1/B4 while seeding the correctness follow-on (Candidate 6).

**Problem.** `nirmaan_stack/api/sidebar_counts.py` (a) `frappe.get_doc`s every PR/SB in
`{Vendor Selected, Partially Approved}` and checks `order_list` for a Pending item — 91 PR + 55
SB `get_doc`s ≈ 438 queries to find the 2 that qualify; and (b) fetches ~4,977 PR + ~1,195 SB
rows into Python only to tally them by `workflow_state`/`type`. ~416 queries + ~6,000 rows
hydrated per call, on every page.

**Decision (Option A — narrow).**

1. New **pure module `services/procurement_approval.py`** (rule B1): owns
   `AWAITING_APPROVAL_STATES = {"Vendor Selected", "Partially Approved"}`, `PENDING_ITEM_STATUS`,
   and `is_awaiting_approval(workflow_state, order_list_items) -> bool`. **Shared by PR and SB**
   (same `order_list` child = `Procurement Request Item Detail`, identical rule). This becomes
   the single home for the `{Vendor Selected, Partially Approved}` + any-pending-item logic that
   is currently duplicated across `sidebar_counts.py`, `approve_vendor_quotes.py`,
   `reject_vendor_quotes.py`, `approve_reject_sb_vendor_quotes.py`, and the PR controller.
2. `sidebar_counts` becomes a **thin orchestrator** (rule B4): the two "approve" counts →
   **`EXISTS` aggregates**; the `workflow_state`/`type` tallies → **`GROUP BY`**. Result:
   ~416 queries + ~6,000 rows → **~15 aggregate queries + near-zero rows**.
3. **Real-time, no cache.** The aggregate is byte-identical to the loop — verified on live data
   (EXISTS count == loop count for both PR and SB). A cache was rejected: it adds staleness and
   fights the existing `invalidateSidebarCounts()` mutate-bridge immediacy.
4. **Parity test** binds the pure predicate to the aggregate (B1/F1 parity pattern, like boq
   `reconcile.ts`): over a sample of real rows, `sum(is_awaiting_approval(...))` must equal the
   aggregate.
5. **Small frontend trim** in `frontend/src/hooks/useSidebarCounts.ts`: `revalidateOnFocus:
   false`, drop/lengthen the 2-minute `refreshInterval`, longer `dedupingInterval` — collapses
   the observed 4–7× calls-per-navigation toward ~1 with no UX loss (badges still refresh on
   navigation, mutation, and reconnect).

## Considered options

- **Coupled** (build Candidate 6's full `deriveState(items, linkedSBs)` and rewire the 7 PR-state
  writers now) — rejected: mixes an urgent perf fix with a correctness refactor across 7
  correctness-critical write paths; too large a blast radius for a first proof.
- **Perf-only** (rewrite `sidebar_counts` to aggregates with no shared predicate home) —
  rejected: not a residence proof; the predicate can drift again.
- **Backend TTL cache** (`frappe.cache`) — rejected: the aggregate already makes each call cheap;
  a cache adds staleness and an invalidation seam that fights the mutate-bridge.
- **Narrow Option A** (chosen): establish the residence seam (one predicate home) with a small,
  low-risk, parity-proven diff; Candidate 6 extends the same home later.

## Consequences

- One home for the "awaiting-approval" predicate; the scattered state literals migrate to it
  **incrementally** — Candidate 6 (the full state deriver) is the next adopter.
- `sidebar_counts` stays real-time and byte-identical, just far cheaper (per-call ~403 → ~15
  queries; per-navigation ~1,400–1,600 → a handful once the frontend trim lands).
- The ten rules are **Proposed** until owner sign-off; the `sidebar_counts` proof proceeds as
  their first instance regardless.

## Second proof — self-fetching facet component (`meta.facet`)

Chosen as the second proof because facet fetching was the clearest F2/F4 violation on the
frontend: `useFacetValues` was hand-wired at ~95 call sites across **38 pages**, each firing an
eager `get_facet_values` POST **on mount** (an unbounded name-match + `GROUP BY`), whether or not
the user ever opens the filter; and the one lazy adopter (`release-po-select`'s `touchedFacets`)
re-implemented the gate inline. The fetch pattern was copied, not owned.

**Decision.** One **self-fetching component** owns the fetch (F2/F4):

1. **`SelfFetchingFacetFilter`** (`components/data-table/`) is the single home for the
   `useFacetValues` call + a **sticky lazy gate** — first popover-open flips fetching on, it stays
   on and refetches cross-filter-correct. It reuses the presentational `DataTableFacetedFilter`
   unchanged, and `getColumnFacet` is the one typed accessor for the stored shape (F2).
2. **Config is declared, not fetched.** A column carries its STATIC facet identity in `meta.facet`
   (`{field, title, requirePendingItems?, decoupled?}`, co-located in `*.config.ts`, F4); the
   RENDER-scope bits (`additionalFilters`, an `enabled` render-gate) ride a `facetOverrides` prop.
   `facetDoctype` on `<DataTable>` is the **per-page opt-in** switch.
3. **Laziness is universal + automatic.** The eager-on-mount fetch is gone for every migrated
   facet; `release-po-select`'s hand-rolled `touchedFacets` machinery is deleted (subsumed by the
   internal gate). Runtime-verified: **0** `get_facet_values` on mount → exactly **1** on first
   popover-open.
4. **Dual-path, incremental** (see Migration & sunset). `<DataTable>` supports both the new
   `meta.facet` path and the legacy pre-fetched `facetFilterOptions`; a column uses the new path
   only when it declares `meta.facet` **and** the page passes `facetDoctype`, so an un-migrated
   sibling sharing a config is never broken.

**Worked coverage.** 8 pages migrated — one per distinct config-shape (search-coupled+static,
no-filters, route/tab-gated, decoupled-from-search, `requirePendingItems`, dynamic item-search,
and the lazy touched-gate). Each verified for **parity** (old-vs-new `useFacetValues` args
identical, adversarial), **tsc delta-0**, and **runtime** (0 mount fetches; one on open).

### Migration & sunset (the dual-path is transitional)

The `facetFilterOptions` prop + the page-level `useFacetValues` pattern are **scheduled for
removal**. The remaining **~28 pages** migrate incrementally to `meta.facet` (each a mechanical,
parity-checkable diff); once the last lands, delete the legacy `facetFilterOptions` branch in
`new-data-table.tsx` and the direct `useFacetValues` call sites. Until then the dual path is the
**intended, safe state** — do not treat the legacy branch as dead code.

## Deferred backlog (future implementation, in residence-rule order)

1. **Mutate-bridge freshness residence** — `invalidateSidebarCounts()` fired inline with
   `navigate()` across ~40 handlers → one freshness-policy home (fire on mutation success, not on
   the navigate click). Bypasses SWR dedup today.
2. **Candidate 6 — PR/SB state deriver** — `deriveState(items, linkedSBs)` for `workflow_state`
   (rule B3), rewiring the 7 writers; reuses `services/procurement_approval.py`. Correctness bug:
   a PR can read "Vendor Approved" with work still open in a linked SB.
3. **Facets — finish the migration + backend bound.** The self-fetching component (second proof,
   above) is **shipped and lazy**; label resolution is already one SQL `IN` join. Remaining:
   migrate the **~28 pages** still on the legacy path to `meta.facet`, then delete the legacy
   branch (see *Migration & sunset*); and bound the `matching_names` unbounded fetch
   (`facets.py:188`, `reportview_execute(limit_page_length=0)`) by pushing name-matching into SQL.
   `key={tab}` remount (#6) still resets per-tab laziness.
4. **#4 over-fetch** — a server **PO-summary endpoint** (B4) owning per-PO paid/invoice totals
   (replaces two `limit:0` whole-table pulls) + **one shared lookup accessor** (F2/B2) for
   Projects / Nirmaan Users / Vendors (fetched 7–13× per navigation today).
5. **#3 realtime residual** — a shared/deduplicated subscription registry + drop `key={tab}`
   remount. The SDK reconnect-handler leak that caused the ~180-check storm is **already fixed**
   in `frappe-react-sdk` 1.17.0 (verified); this residual is minor. **Prod needs a frontend
   rebuild + deploy for the SDK fix to take effect.**
6. **`key={tab}` full remount** (`release-po-select.tsx:654`) — a shared amplifier across #2, #3,
   and #4; removing it is high-leverage.
