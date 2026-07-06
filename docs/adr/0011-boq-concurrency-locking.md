# 11. BoQ concurrency & locking (fused single-editor lock + cross-stage directional guard)

Date: 2026-07-03

## Status

**Proposed — pending owner (Nitesh) sign-off.** One open sub-decision (D11) awaits a call.

> **Amendment A1 (2026-07-03):** Phase C's *response* is reshaped from a tiered **block** (D15/D16) to a
> **presence-escalated warn-only** model — grill-locked (Q1–Q9). Detection (the state floor, D14) is
> retained; the hard block, the Author-or-Admin gate, and the `committed_by`/`priced_by` attribution
> fields + migration are **dropped**. See **"Amendment A1"** at the end of this ADR.

Grill-locked design (20 decisions, D1–D20). Migration-critical facts adversarially verified against
live code + data. Full build plan: `frontend/.claude/plans/boq-concurrency-locking-plan.md`.
Illustrated explainer (diagrams): `docs/boq/concurrency-locking.html`. Numbered `0011` (highest existing
is `0010`; historical `0002`/`0007`/`0008` collisions are **not** renumbered — out of scope).

## Context

The app is multi-user, but the BoQ wizard has almost **no** concurrency control — only the pricing editor
holds a real lock. Two structural facts frame the problem:

- **Presence ≠ Lock.** The In-Progress PR "someone is editing" banner is Frappe-core `doc_viewers`
  presence — realtime, but zero enforcement (an input-block was coded and *deliberately commented out*,
  `ProcurementProgressView.tsx:88-89`). Presence has no ownership, no server reject; you cannot build a
  write-block on "who has the doc open."
- **Server-authoritative ≠ Realtime-notified.** The BoQ pricing lock *does* enforce (server
  `frappe.throw` on a 2nd writer) but never `publish_realtime`s a lock event (verified: `grep -c
  publish_realtime` = 0 in `pricing_lock.py`/`pricing.py`). A 2nd user learns on page-load or on a failed
  save; a holder who leaves strands the sheet for up to 5 min. The data is safe; it surfaces late.

Two concrete, verified hazards make this urgent:

1. **Commit duplicate-`is_current` race (CONFIRMED, 2 independent skeptics + live-data check).**
   `commit_pipeline._next_commit_version` (`:265-274`) is `max(commit_version)+1` on a plain read, followed
   by freeze-then-insert (`:499/:545`) with **no** `SELECT FOR UPDATE`, **no** in-progress flag, **no**
   unique index; `commit_boq` never touches the pricing lock. Two concurrent commits of one `(boq, sheet)`
   both write `is_current=1`. Downstream reads resolve by `is_current=1` (not `max(version)`), so a
   duplicate silently and non-deterministically corrupts the invariant the entire pricing layer depends on.
   Live data is clean today (223 BoQ Sheet / 220 grid rows) — nothing *prevents* it.

2. **Cross-stage rug-pull (verified).** BoQ phases are a one-way ladder
   (Config → Review → Commit → Tendering/Pricing), but every backward endpoint is a role-less
   `@frappe.whitelist`, and every existing guard is a **user-agnostic** state freeze. A user in an earlier
   stage can **Force Re-parse** (`parse_run.py:238-240`, deletes review rows) + **re-commit** a sheet another
   user has priced. Pricing keys on `committed_version`; re-commit mints `v+1`, freezes the prior, and the
   editor only ever loads `is_current` — so the downstream pricer's work is **silently orphaned** on the
   frozen version (invisible), recoverable only via manual, partial copy-forward (rates only,
   `pricing.py:2490-2509`; formulas/remarks/colors lost). No guard anywhere asks "is there a user
   downstream whom this would disturb?"

## Decision

Build concurrency control along **three orthogonal dimensions** on `(boq, sheet)`, reusing existing
in-house patterns rather than inventing a new subsystem.

**Same-stage single-editor lock (D1–D13).** A fused primitive = the pricing lock's *enforcement core*
(deterministic-PK `acquire_or_refresh` → `DuplicateEntryError` exactly-one-winner) + a *realtime* layer
(broadcast `boq:lock_changed`, model on `commission_report/editing_lock`) + a *cleanup* layer (heartbeat +
`sendBeacon` release, model on `useEditingLock`). Acquire on **first edit-intent**; block writes
server-side; read-only-gate by withholding save callbacks client-side. Two tiers, one primitive:
a **draft-tier** lock spanning Config+Review per `(boq, sheet)` (reuse the `BoQ Sheet Pricing Lock` doctype
with a `committed_version=0` sentinel — **no new doctype, no migration**), and the existing
**committed-tier** pricing lock per `(boq, sheet, version)`. Auto-takeover on stale + Admin-only
force-override; unsaved drafts preserved-and-flagged, never auto-discarded. Presence (`doc_viewers`) is
kept as a complementary "who else is here" overlay. A server-side break-glass flag (default enforcing)
disables all enforcement if it misbehaves in prod.

**Commit-race fix (D9).** Defense-in-depth: an app-level `commit_in_progress` serialization (mirror
`parse_in_progress`) for clean UX + a **partial unique index** `(boq, sheet_name) WHERE is_current=1`
(and `(boq, source_sheet_name)` on the grid tier) as the unbypassable DB backstop. A **heal-then-constrain**
migration reconciles any duplicates (keep highest `commit_version`, same winner across tiers) before the
index. Shipped **first, standalone** — it's the only *silent* corruption and is independent of the locks.

**Cross-stage directional guard (D14–D20).** A **third** dimension, orthogonal to the same-stage locks and
above the version axis (the pricing lock is version-scoped and *drops* on re-commit, which is exactly why it
cannot see the rug-pull). Implemented as **5 targeted `_guard_no_downstream_*` existence checks** (not a new
lock doctype) extending the existing freeze idiom, wired into the 5 unguarded holes:

| Hole | Endpoint |
|---|---|
| Parsed reviewer window | review writes on a `Parsed` sheet |
| Un-finalize | `unmark_sheet_parsed_check_done` |
| Force re-parse | `run_parse(force_reparse=True)` |
| Re-commit over priced | `commit_boq` |
| Root metadata | `update_boq_draft` (`tax_treatment`/`version`) |

The guard keys on **existence** of orphanable downstream work (durable state floor, D14) and escalates by
presence + ownership (D15): no downstream work → **allow**; your own → **light confirm**; another user's
vacated work → **named confirm** gated **Author-or-Admin** (D16, the first role check in the role-less
wizard); another user *live* downstream → **hard block** (named, reusing the D8 lock as the presence
signal); **exported** pricing → **elevated typed acknowledgment** (D19). On a permitted regression the
displaced pricing is **orphan-and-surfaced** (preserved + attributed both ways + opt-in copy-forward; never
auto-migrated, never auto-deleted, D17). Per-sheet by default; per-BoQ for root-metadata and replace-all
blast radius (D18). Re-committing a sheet with *no* downstream pricing stays free forward progress, and the
parse-vs-commit eligibility asymmetry is untouched (D20).

Rollout A → B → C → D (D12): commit-fix + fused primitive + pricing retrofit → draft-tier lock + presence →
directional guard → polish. The directional guard's state-floor half can ride Phase A to kill the silent
rug-pull early.

## Considered options

- **Harden the PR `doc_viewers` presence into the lock** — rejected: presence has no ownership, no server
  reject, is client-only and racy; the author already commented the block out. Kept as awareness only.
- **Same-stage: presence-only warning (like PR) vs advisory lock (like `useEditingLock`) vs enforced lock**
  — chose enforced (pricing-core) + realtime/cleanup: Config/Review collisions are *destructive*
  (whole-blob clobber, cross-row tree corruption), which a warning can't prevent.
- **Directional guard: M1 presence-based vs M2 state-based vs M3 hybrid** — chose **M3**. M1 (block only
  while a later stage is live) fails the verified worst case (the pricing lock auto-expires in 5 min, so a
  pricer who closes the tab is unprotected). M2 (pure state freeze) protects vacated work but over-blocks
  the *sanctioned* re-version flow. M3 = M2's durable floor + M1's presence to set severity.
- **Directional guard: new blanket cross-stage lock doctype vs targeted freeze-extension** — chose targeted:
  the existing Finalized freeze already covers most backward writes; the real gap is 5 specific holes.
- **Commit race: app flag only vs DB index only vs both** — chose both (index is the durable guarantee
  even across workers / check-then-set gaps; the flag is graceful UX).
- **Cascade on permitted regression: orphan-and-surface vs auto-copy-forward vs block-until-discarded** —
  chose orphan-and-surface; auto-copy-forward is a partial migration that *looks* complete (a silent-data
  trap); block-until-discarded destroys recoverable work.
- **New draft-lock doctype vs reuse pricing-lock with `version=0`** — chose reuse (real versions start at 1,
  so 0 never collides): no new table, no migration.

## Consequences

- Destructive collisions (Config blob clobber, Review tree corruption, commit duplicate-current, cross-stage
  rug-pull) become impossible or loudly-gated; recoverable ones (hub status) stay friction-free.
- The pricing lock gains a realtime + cleanup layer (kills the 5-min false-block and the discover-on-failed-
  save); the same primitive extends to Config/Review.
- The wizard gains its **first ownership/role check** (Author-or-Admin), scoped narrowly to overriding
  another user's downstream work — deliberately, because the requirement demands it.
- No schema loss: all pricing/committed data remains versioned and preserved; the fixes are guard/UX-level
  plus one DB uniqueness constraint. A break-glass flag bounds prod risk.
- **Open (D11):** the Hub general-specs lost-update fix — additive per-sheet toggle vs optimistic
  compare-and-set (lean) — is deferred to an owner call; it does not block the rest.

## Amendment A1 (2026-07-03) — Phase C reshaped to presence-escalated warnings

**Status:** Proposed — grill-locked (Q1–Q9), pending Nitesh sign-off. **Supersedes the _response model_ of
D14–D20.** The directional guard's **detection** (state floor, D14) is retained unchanged; its
**enforcement** changes from a tiered block to warn-only, and the presence layer is repurposed as the
escalation signal. Phases A (commit-race), A2/B1/B2 (same-stage locks + presence), and B3 are untouched.

### Why revisit

The owner's requirement sharpened: **do not lock users out of upstream stages.** Instead surface a **hard,
unmissable warning** — naming whoever is actively working downstream — at **two touchpoints** (on entering a
pre-phase screen, and on saving within it). A user may always proceed after acknowledging. This deliberately
reverses D15's "another user live → hard block": the earlier "no-one should be _able_ to alter" is now read as
"no-one should _accidentally_ alter" — enforced by an unmissable named warning, not a lock.

### Resolved model — "presence-escalated warning" (hybrid detect, warn-only respond)

- **Detection — hybrid, unchanged (Q1).** The durable state floor `downstream_priced_count(boq, sheet) > 0`
  is the baseline: it **always** warns when orphanable work exists. (Pure live-presence was rejected — it
  re-opens the verified vacated-work hole: a pricer who closes their tab / whose lock TTL lapses would be
  silently orphaned.)
- **Escalation — the pricing lock is the live signal (Q3).** B2 presence is **BoQ-level** (`doc_viewers` on
  the BOQs doc) and cannot pinpoint the pricing stage; the **pricing lock** (`(boq, sheet, version)`,
  `locked_by`) is version-precise and names the editor. A **fresh** lock held by **another** user → **Live**
  (named, stronger tone); orphanable work with no fresh other-user lock → **Vacated** (count-only). A
  self-held lock collapses to count-only — never name yourself (Q9).
- **Response — warn-only everywhere (Q2, supersedes D15/D16).** An **interrupting acknowledge-to-proceed**
  modal on save; **never a hard block**, even when another user is Live. No ownership gate.
- **Two touchpoints (new, extends D14).**
  1. **On entry** → a persistent **banner** on Review + Config, a per-sheet **card indicator** on the Hub, and
     a note by the root-metadata (tax/version) controls. On-mount read; **no** live-refresh in v1 (Q4).
  2. **On save** → the interrupting modal, which **re-reads live state authoritatively** (never trusts the
     entry banner) (Q5).
- **Save scope — subsumes the 5 holes (Q7).** _Decisive actions_ (re-commit, force re-parse, un-finalize,
  root-metadata) → interrupting modal every time. _Incremental edits_ (review row edits, restructure, revert,
  config toggles) → banner + a **one-time per-mount acknowledgment** on the first edit, then quiet (the
  backend still gates every save with `confirm_orphan`; the client asks once and auto-confirms the rest).
- **Recovery — D17 retained, trimmed (Q8).** Rely on the existing freeze-and-supersede preservation + partial
  copy-forward (nothing is destructively lost). A proactive "prior v{N} had {count} priced cells — copy
  forward" **surfacing UI is deferred**.
- **Exported/tendered pricing — D19 softened (Q8).** Same warn-only; the message **notes the export** ("will
  desync that tender"). No typed-confirm, no block in v1.

### Dropped vs the original D14–D20 (net simplification)

| Original | Amended |
|---|---|
| D15 hard block (another-user-live) | Named **warning** (proceed after ack) |
| D16 Author-or-Admin ownership gate | **Removed** — no block to gate |
| `committed_by` / `priced_by` fields + migration | **Not needed** — Live name from the lock; Vacated is count-only |
| M1-vs-M3 (presence-only vs hybrid) | Hybrid **detection** kept; presence used only to _escalate_, never as the sole trigger |

The wizard's would-be **first role check is eliminated**. Net build = enrich the 3 shipped guards' message with
Live-naming + add entry banners (Review/Config + Hub cards) + wire the 2 pending guards (force-reparse as a
decisive modal, review/config as a first-edit ack).

### Consequences

- Leaner than D14–D20: **no new schema, no migration, no role check, no hard block** — guard-message
  enrichment + read-side banners + two new guards.
- **Accepted trade-off (Q2):** warn-only means a careless user _can_ still orphan Live work after
  acknowledging — the warning kills **accidents**, not the **possibility**; preservation + copy-forward
  (retained) keep it recoverable.
- The 3 shipped guards are **repurposed, not replaced** — they are already warn-only confirms with state-floor
  detection (verified live 2026-07-03); only their message gains the Live name.
- Terms coined this session are in `CONTEXT.md` → **BoQ concurrency & directional guard**.
