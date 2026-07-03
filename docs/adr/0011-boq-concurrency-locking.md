# 11. BoQ concurrency & locking (fused single-editor lock + cross-stage directional guard)

Date: 2026-07-03

## Status

**Proposed — pending owner (Nitesh) sign-off.** One open sub-decision (D11) awaits a call.

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
