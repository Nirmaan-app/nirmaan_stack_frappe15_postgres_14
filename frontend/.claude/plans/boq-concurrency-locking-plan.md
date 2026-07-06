# BoQ Concurrency & Locking — Plan

**Status:** Design locked (20 decisions, grill-driven). Migration-critical facts adversarially verified.
**No code written.** Pending owner (Nitesh) sign-off + the D11 call.
**Companion docs:** explainer `docs/boq/concurrency-locking.html` · decision record `docs/adr/0011-boq-concurrency-locking.md`
**Last updated:** 2026-07-03.

---

## Execution Strategy (per CLAUDE.md Plan-to-Parallel — read before building)

Execute via TaskCreate → TaskUpdate (dependencies) → parallel subagents. Waves:

- **Wave 1 (parallel, independent):** `A1` commit-race fix ‖ `A2` fused primitive + pricing retrofit. Also `C0` the directional **state-floor** guards (pure existence checks) may ride here — they have almost no dependency and kill the silent rug-pull early.
- **Wave 2 (after A2):** `B1` draft-tier lock (Config+Review) → then `B2` presence overlay ‖ `B3` general-specs fix.
- **Wave 3 (after B1):** `C1` directional **presence-upgrade + attribution + tiered confirm/override + orphan-surfacing** (reuses the D8 locks as the presence signal).
- **Wave 4:** `D` polish (admin override UI, data-loss refinements, exported-pricing acknowledgment UI).

Each wave = TaskCreate the items, set `addBlockedBy` deps, launch each unblocked task as a `general-purpose` subagent with full context (files below). Every subagent prompt must include the **why**.

---

## The reframe (why this design)

The app is multi-user but has almost **no** concurrency control in the BoQ wizard — only the pricing editor has a real lock. Two orthogonal truths drive everything:

- **Presence ≠ Lock.** The In-Progress PR "banner" is Frappe-core `doc_viewers` presence — realtime but zero enforcement (blocking was coded and *commented out*). You cannot build a write-block on "who's in the room."
- **Server-authoritative ≠ Realtime-notified.** The BoQ pricing lock *does* enforce (server `frappe.throw`) but never *pushes* — a 2nd user learns on page-load or on a failed save. It works; it surfaces late.

The build = **pricing-lock enforcement core + `useEditingLock`/commission realtime+cleanup layer**, spread across **three lock dimensions**:

| Dimension | Question | Scope |
|---|---|---|
| Draft-tier lock (same-stage) | peer editing Config/Review now? | `(boq, sheet)` |
| Pricing lock (same-stage) | peer pricing this version now? | `(boq, sheet, version)` |
| **Directional guard (cross-stage)** | does a LATER stage hold work my EARLIER action would orphan? | across the ladder |

---

## Decision log

### Same-stage single-editor lock (D1–D13)

| # | Decision |
|---|---|
| D1 | Correctness-first for destructive phases (Config/Review/Commit = hard lock); awareness for recoverable (Hub status/Finalize = soft alert). |
| D2 | Acquire on **first edit-intent** (first focus/keystroke) — not on mount, not on save. |
| D3 | Broadcast `boq:lock_changed` (acquired/released/taken_over), both directions, sub-second + `onReconnect`/on-load `mutate()` self-heal backstop. |
| D4 | Release-on-leave (`sendBeacon`) + heartbeat-driven TTL (~30s beat / ~2-min TTL); **no cron sweep**; hard-crash frees lazily within TTL. |
| D5 | Auto-takeover on stale + **Admin-only** force-override; displaced holder gets a live `taken_over` push (never silent). |
| D6 | Preserve unsaved drafts visibly + flag "not saved"; no auto-reload-over-draft, no auto-merge; `beforeunload` guard. |
| D7 | Viewing always allowed + "🔒 Being edited by X" banner (core) + free `doc_viewers` "also here" list; cell-level cursors **out**. |
| D8 | Two locks by tier: **draft-tier** lock per `(boq, sheet)` spanning Config+Review; existing **committed-tier** pricing lock per `(boq, sheet, version)`. Generalize the primitive's identity to be version-optional. |
| D9 | Commit race in scope: commit-in-progress serialization **+** partial unique index (heal-then-constrain migration). |
| D10 | **BoQ-only** build; PR left presence-only (proven primitive applied to PR later, separately). |
| D11 | Hub general-specs lost-update fixed at the endpoint. **⚠ OPEN:** (a) additive per-sheet toggle vs (b, lean) optimistic compare-and-set. |
| D12 | Ship A → B → C → D (commit-fix first, prove-on-pricing before draft-tier). |
| D13 | Server-side break-glass flag (default enforcing) + `localStorage` client dev override. |

### Cross-stage directional guard (D14–D20)

> **Response model superseded by ADR-0011 Amendment A1** (presence-escalated warn-only): D15 hard-block → named warning; D16 Author-or-Admin gate + attribution fields **dropped**; D17/D19 trimmed. **Detection (D14) unchanged.** The table below is the original design record — see the Phase C section above + ADR § Amendment A1 for the in-force model.

| # | Decision |
|---|---|
| D14 | Trigger = **existence** of downstream work (durable state floor); live presence only hardens/names the block. |
| D15 | **Tiered** response: another user live downstream → hard block (named); their vacated artifact → loud named confirm; your own → light confirm; no downstream work → no guard. |
| D16 | **Author-or-Admin** to override another user's work — first role check in the (today role-less) wizard. Needs `committed_by`/`priced_by` attribution. |
| D17 | **Orphan-and-surface**: preserve on frozen version + loud attribution both ways + opt-in copy-forward. **Never** auto-migrate, **never** auto-delete. |
| D18 | Per-sheet by default; **per-BoQ** for `tax_treatment`/`version` on `update_boq_draft`; affected-sheet checks for replace-all actions. |
| D19 | **Exported** pricing → elevated typed/two-step "will desync a live tender" acknowledgment (still Admin-overridable). |
| D20 | Ship as **5 targeted `_guard_no_downstream_*` checks** (not a new lock subsystem); reuse D8 locks for presence + attribution for ownership. Preserve forward re-commit + the eligibility asymmetry. |

---

## Verified facts (adversarial)

- **Commit race — CONFIRMED (2 skeptics + live data).** `commit_pipeline._next_commit_version` (`:265-274`) = `max(commit_version)+1` on a plain read; `_write_grid`/`_write_committed_boq_sheet` (`:499/:545`) freeze-then-insert; no `SELECT FOR UPDATE`, no in-progress flag, no unique index; `commit_boq` never touches the pricing lock. Downstream reads (`get_committed_rows`, `get_committed_state`) resolve by `is_current=1` (not `max(version)`), so a duplicate is **catastrophic + non-deterministic**. Live DB clean today (223 BoQ Sheet / 220 grid) → constraint adds cleanly; keep heal-then-constrain for safety.
- **Draft lock reuse — simplification.** Reuse the existing `BoQ Sheet Pricing Lock` doctype with `committed_version = 0` sentinel (real commits start at 1, so 0 never collides) — **no new doctype, no migration**. Thin `draft_lock.py` wrapper + a distinct `BOQ_DRAFT_LOCKED` reject marker.
- **General-specs (D11) — needs UI change.** Hub submits the whole ticked set (`BoqHubPage.tsx:696-745`); backend `set_general_specs_sheet` (`update_sheet_draft.py:153`) delete-all-then-reinserts. Additive-toggle is **not** backend-only → the (b) optimistic compare-and-set option is lighter (keeps the one-Save endpoint, adds a baseline check).
- **Cross-stage cascade — the rug-pull (verified).** Pricing keys on `(boq, sheet_name, excel_row, col_letter, committed_version)` (`boq_cell_pricing.json`), decoupled from ephemeral node names. Re-parse is draft-tier-only (deletes `BoQ Review Row`, `parse_run.py:824-829`) but **inert to committed/pricing**. Re-commit mints `v+1` `is_current`, freezes prior — **prior-version pricing is orphaned** (preserved on frozen `vN`, invisible in the editor which only loads `is_current`). Copy-forward (`pricing.py:2379-2637`) recovers **rates only, partially** (hard-skips moved/reworded/reclassified rows `:2490-2509`); formulas/remarks/colors have **no** forward path. **Every backward endpoint is role-less; the only cross-user guard (pricing lock) is same-version/same-stage and 5-min-expiring.**

---

## The unified lock primitive

```
Enforcement core (reuse pricing_lock.py; generalize identity → version-optional)
  acquire_or_refresh(entity, sub_key, version, user, now)   # version=0 ⇒ draft tier
  read_lock_info(...)                                        # PURE read (never acquires)
  deterministic sha1 PK ⇒ DuplicateEntryError ⇒ exactly-one-winner   [exists]

+ Realtime (NEW — model on commission editing_lock._emit_lock_event, broadcast)
  publish_realtime('boq:lock_changed', {boq, sheet_name VERBATIM, version, action,
                   locked_by, locked_by_name, timestamp})  AFTER the caller's commit
  screen-scoped socket.on in the page; guard (boq, sheet_name, version); suppress self
  onReconnect → mutate() self-heal (events aren't replayed)

+ Cleanup (NEW — model on useEditingLock)
  heartbeat (~30s) while editor mounted   |   sendBeacon release on unload
  short TTL (~2-min) ⇒ crash frees fast   |   explicit release endpoint → emits 'released'

+ Break-glass: server setting (default enforcing) + localStorage dev override
```

---

## Phased build

### Phase A — foundation + the dangerous bug (independently shippable)

**A1 · Commit-race fix** — files: `commit_pipeline.py`, `boqs.json`, `patches/`, `frontend/.../CommitDialog.tsx`.
- Migration **heal-then-constrain**: read-only audit → dedupe rule "per `(boq, sheet_name)`: keep highest `commit_version` as `is_current=1`, demote the rest to 0 (never delete frozen rows); pick the **same** winning version across BoQ Sheet + BoQ Committed Sheet Grid".
- Partial unique indexes: `(boq, sheet_name) WHERE is_current=1` on **BoQ Sheet**; `(boq, source_sheet_name) WHERE is_current=1` on **BoQ Committed Sheet Grid**. (BOQ Nodes tier likely not needed — node identity is per-node under a version-specific parent; confirm.)
- App-level serialization (D9): `commit_in_progress` flag on BOQs (mirror `parse_in_progress`) or per-`boq` `SELECT FOR UPDATE` so the 2nd commit computes `N+2` rather than colliding on `N+1`. Index = durable backstop; serialization = graceful UX.

**A2 · Fused primitive + pricing retrofit** — files: `pricing_lock.py`, `pricing.py`, `frontend/.../SheetPricingPage.tsx`.
- Generalize `_lock_identity` (version-optional); add broadcast `_emit_lock_event('boq:lock_changed')` after commit; add explicit release + heartbeat endpoints.
- Retrofit `SheetPricingPage`: acquire on first edit-intent; screen-scoped `boq:lock_changed` listener (guard `boq/sheet_name/version`, suppress self); `sendBeacon` release + heartbeat; wire the server break-glass flag.

### Phase B — same-stage draft lock (on a proven base)

**B1 · Draft-tier lock (Config + Review)** — reuse `BoQ Sheet Pricing Lock` w/ `version=0`; thin `draft_lock.py`; marker `BOQ_DRAFT_LOCKED`.
- Acquire inside (after existing guards, before write, share the single commit): `set_sheet_config`, `set_sheet_work_packages`, `set_sheet_status`, `set_sheet_label` (`update_sheet_draft.py`); `save_review_edit`, `save_review_restructure`, `revert_to_parser` + AI-accept writers (`review_screen.py`/`ai_assist.py`/`gemini_assist.py`). **Do NOT** acquire on annotation-only `save_review_remark`/`dismiss_row_flags`.
- Client hooks: config = `SheetConfigPanel` `touchS1-4`/`dropIfConfigDone`; review = `ReviewTree` `confirmValueSave`/`saveTextField`/`restructureCall`/`handleApplyAi`/`handleRevertToParser`. Surface `lock_info` in `get_review_rows` + the config/draft read.
- **Invariant:** the draft lock persists across Config↔Review nav for the same `(boq, sheet)` — do **not** key it on `wizard_status` (which flips mid-edit).

**B2 · Presence overlay** — hub soft alert + `doc_viewers` "also here" list. **B3 · General-specs fix** (per D11).

### Phase C — cross-stage directional guard  — **RESHAPED by ADR-0011 Amendment A1 (presence-escalated warn-only)**

> **Model (Amendment A1, grill-locked Q1–Q9).** *Detect* = state floor (`downstream_priced_count > 0`, **always** warns).
> *Escalate* = the **pricing lock** names a **Live** other-user editor (else **Vacated** = count-only; a self-held lock =
> count-only). *Respond* = **warn-only, never block** — an interrupting acknowledge-to-proceed modal on save. *Surface* at
> **two touchpoints**: a persistent **banner on entry** (Review/Config + Hub per-card + root-metadata note) and the **modal on
> save** (which re-reads live state). **Dropped:** hard block, Author-or-Admin gate, `committed_by`/`priced_by` attribution +
> migration. Full rationale + grill trail: `docs/adr/0011-boq-concurrency-locking.md` § Amendment A1.

**C0 · State-floor guards — 3 of 5 wired + shipped as warn-only confirms (verified live 2026-07-03).**
Wired: re-commit (`commit_boq`), un-finalize (`unmark_sheet_parsed_check_done`), root-metadata (`update_boq_draft`, per-BoQ).
Pending: force re-parse, Parsed-reviewer window — both re-cast as warnings below. (The 3 shipped guards are already warn-only
confirms; they are **repurposed, not replaced**.)

**C1 (amended) · Presence-escalated warning** — no new subsystem; enrich C0 + add read-side banners:
- **Enrich the guard message with the Live name** — `guard_no_downstream_orphan` also reads the pricing lock: a fresh
  *other-user* lock → "X is pricing v{N} now — proceeding orphans their {count} cells"; else count-only. Self-held → count-only.
- **On-entry banner** — a small "downstream state for (boq, sheet)" read → persistent banner on Review + Config, a per-sheet
  **card indicator** on the Hub, a note by the root-metadata controls. On-mount read; **no** live-refresh in v1.
- **The 2 remaining guards (revised 2026-07-06, owner):** force re-parse = a **soft inline warning** in `ParseRunDialog` — the
  slice-4 server `confirm_orphan` gate + reject-marker round-trip is **reverted** (`parse_run.py`, **by hand**); the dialog shows a
  per-sheet Live-named / Vacated-count line from `get_boq_downstream_state`, and the user proceeds normally. Review/config first-edit
  ack = **dropped**. Rationale: both are non-destructive gateways; the orphan is realized only at re-commit (keystone-guarded) and
  `is_current` preserves the prior priced commit. `directional_guard.py` untouched.
- **Recovery (D17, trimmed)** — rely on existing freeze-and-supersede + partial copy-forward; proactive "prior v{N} had {count}
  priced cells — copy forward" surfacing UI **deferred**.
- **Exported/tendered (D19, softened)** — same warn-only; message **notes the export**; no typed-confirm / block in v1.
- **Dropped from the old C1:** the `committed_by`/`priced_by` fields + migration, the Author-or-Admin role check, and the hard block.

**The 5 guards → endpoints (Amendment A1 treatment)**

| Hole | Endpoint | Status → treatment |
|---|---|---|
| Re-commit over priced | `commit_boq` | ✅ shipped confirm → enrich with Live name |
| Un-finalize | `unmark_sheet_parsed_check_done` | ✅ shipped confirm → enrich with Live name |
| Root metadata (per-BoQ, D18) | `update_boq_draft` (`tax_treatment`/`version`) | ✅ shipped confirm → enrich with Live name |
| Force re-parse | `run_parse(force_reparse=True)` | ✅ **shipped 2026-07-06** → soft inline warning in `ParseRunDialog` (built + E2E; no server `confirm_orphan` gate; slice-4 guard reverted) |
| Parsed-reviewer window | review / config writes on a committed+priced sheet | ❌ **dropped 2026-07-06** (entry banner + re-commit keystone suffice) |

**Invariants:** re-committing a sheet with **no** downstream pricing = free forward progress (guard keys on orphanable-work-existing, never the action). Do not conflate the general-specs-outranks-`wizard_status` rule or the parse-excludes-Finalized / commit-requires-Finalized asymmetry.

### Phase D — polish
Data-loss / `beforeunload` refinements (D6); admin force-override / takeover UI (D5); the **deferred** proactive orphan-surfacing UI + exported-pricing acknowledgment. *(The D16 Author-or-Admin override UI is **dropped** — Amendment A1.)*

---

## Open item (needs owner call)

**D11 — Hub general-specs.** (a) additive per-sheet toggle (eliminates the race by construction; FE+BE change) vs **(b, recommended)** optimistic compare-and-set (keep the one-Save endpoint; reject if the set changed since load → "specs changed, reload"; smaller, preserves current UX, turns silent clobber into a visible recoverable conflict).

---

## Future scope (deferred; owner-directed)

1. Harden the **PR "In-Progress"** surface into a real lock (apply the proven primitive; separate stakeholder review).
2. Extract the primitive as an **app-wide shared module** (`useEntityLock` + a generic backend lock) for SR/PO/other domains.
3. **Cell-level live cursors** on the grids.
4. **Crash-free realtime push** — a scheduled sweep emitting `expired` so a passively-waiting user is pushed the instant a crashed holder's TTL lapses (today: lazy).
5. Hub per-sheet status beyond soft-alert if it ever proves painful.

---

## Key file / endpoint references

- **Locks:** `api/boq/wizard/pricing_lock.py` (`acquire_or_refresh:82`, `_lock_identity:52-60`, `LOCK_STALE_SECONDS=300 :40`, marker `BOQ_PRICING_LOCKED`), consumed in `pricing.py:548`. Doctype `boq_sheet_pricing_lock`.
- **Realtime precedents:** `pr_editing_lock._emit_lock_event:73-93` (room-targeted, commit-before-publish), `commission_report/editing_lock._emit_lock_event:80-100` (broadcast-then-filter — the model), `parse_run.py:1131` (`boq:parse_run_done`). Frontend screen-scoped listener: `BoqHubPage.tsx:281-301`.
- **Commit:** `commit_pipeline.py` (`_next_commit_version:265-274`, `_write_grid:499`, `_write_committed_boq_sheet:545`, `_commit_node_tree:625`).
- **Draft writers:** `update_sheet_draft.py` (`set_sheet_config:227`, `set_sheet_work_packages:325`, `set_sheet_status:71`, `set_sheet_label:122`, `set_general_specs_sheet:153`, guards `_guard_sheet_not_parsing:25`/`_guard_sheet_not_finalized:278`).
- **Review writers:** `review_screen.py` (`save_review_edit:1606`, `save_review_restructure:1831`, `revert_to_parser:2309`, `save_review_remark:2443`, `dismiss_row_flags:2525`, `mark_sheet_parsed_check_done:2684`, `unmark:2793`, `_guard_sheet_not_frozen:725`).
- **Re-parse:** `parse_run.py` (`run_parse:486`, `force_reparse:238-240`, worker delete review rows `:824-829`).
- **Pricing identity + copy-forward:** `boq_cell_pricing.json` (5-tuple + `committed_version` Int), `pricing.py` copy-forward `:2379-2637`, hard-skips `:2490-2509`.
- **Root metadata (unguarded):** `update_boq_draft.py`.
