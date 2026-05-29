# 1. Project Tendering Status

Date: 2026-05-28

## Status

Accepted. **Revised 2026-05-29 (v3 — dual-field model).** This revision supersedes
the single-field model that overloaded `status` with `Tendering`/`Won` and retired
`Created`. The dual-field model splits the bid lifecycle and the execution lifecycle
into two orthogonal fields: a NEW `tendering_status` (`Tendering` / `Won` / `Lost`)
governs the bid/prospect dimension; the EXISTING `status` field returns to being a
pure execution lifecycle (`Created` / `WIP` / `Completed` / `Halted` / `Handover` /
`CEO Hold`). `Tendering` and `Won` leave `status`; `Created` is restored as the
post-convert initial execution stage.

### Revision history
- v1 (2026-05-28): orthogonal `tendering_status` field proposed (never implemented).
- v2 (2026-05-29 AM): single-field model — added `Tendering`/`Won` to `status`,
  retired `Created`. Code was written but **never deployed**: the
  `migrate_project_status_created_to_won` patch never ran in production, no
  prod project ever carried `status="Tendering"` or `status="Won"`, and the
  v2 entries were removed from `patches.txt` before cutover.
- v3 (2026-05-29 PM): **dual-field model adopted and shipped (this revision).**
  Because v2 never reached prod, v3 doesn't have to "revert" anything — it's a
  clean cutover from the original pre-v2 state. `tendering_status` is a new
  Select field; `status` keeps its original `Created` / `WIP` / `Completed` /
  `Halted` / `Handover` / `CEO Hold` value set; `Lost` is added as a new bid
  outcome.

## Context

The business needs to track projects that are still being bid/tendered for, separately
from projects that have been awarded. The 6-step creation wizard hard-requires an end
date, at least one work package, and a valid city/state (Pincode lookup) and always
creates an `Address` doc, so it cannot register a bare prospect. Autoname builds
`{city}-PROJ-#####` and is frozen at insert.

**Why v2 was scrapped pre-deploy.** v2 overloaded the single `status` field with
two distinct concerns — *was this awarded?* (a one-shot bid outcome) and *where
in the execution lifecycle is it?* (Created → WIP → …). Because `status` is
single-valued, v2 had no permanent "was-won" marker once a project moved past
`Won`, no place to record **`Lost`** bids (a real business need that surfaced
during v2 review), and made the manual status dropdown harder to reason about.
Splitting the two concerns resolves all three.

## Decision

Adopt a **dual-field model**.

1. **NEW field `tendering_status` on Projects** — Select, values: `Tendering`,
   `Won`, `Lost`. Single source of truth for whether a record is a prospect, an
   awarded job, or a closed-out lost bid. **Not** part of the execution lifecycle;
   **not** exposed in the manual status-change dropdown.

2. **Existing `status` field is execution-only.** Keeps its original value set:
   `Created`, `WIP`, `Completed`, `Halted`, `Handover`, `CEO Hold`. (Note: the
   `status` field is `Data`/free-form on the doctype — the valid values are
   enforced in the frontend vocabulary in
   `src/components/common/projectStatus.ts`, not by a Select option list.)
   `Created` is the post-convert / direct-create initial execution stage.

3. **Default values at insert.**
   - **Stub path** (Tendering minimal create form): `tendering_status = "Tendering"`,
     `status` is empty/null (the row has no execution stage yet).
   - **Direct full-create path** (6-step wizard, user picked "Won" on the choice
     screen): `tendering_status = "Won"`, `status = "Created"` — set in one shot,
     skipping the stub stage entirely.

4. **Convert (Tendering → Won) runs the full creation setup.** The Convert flow
   opens the same 6-step wizard pre-filled from the stub; on submit the system runs
   the full real-project setup (`apply_full_project_details` — Address, work
   packages, work headers; plus client-side design tracker, work milestones,
   critical PO, team permissions) — identical to direct creation — and then sets
   `tendering_status = "Won"` AND `status = "Created"`. The project identity
   (docname) is preserved.

5. **Lost flow.** A new "Mark as Lost" action on the stub detail view (and the
   Tendering list row actions, Admin/PMO only) sets `tendering_status = "Lost"`.
   Lost is **terminal** — no reverse to Tendering, no convert to Won. Lost
   projects stay in the DB for pipeline reporting; the stub detail view becomes
   read-only. Lost projects are deletable by Admin/PMO (same as Tendering). They
   are hidden from every project picker and shown via a sub-toggle on the
   Tendering tab (default: Tendering; toggle: Lost).

6. **Operational guard switches predicate.** `_tendering_guard.is_tendering` /
   `validate_not_tendering` are renamed to `is_pre_won` / `validate_won`. The
   predicate flips from `status == "Tendering"` to `tendering_status != "Won"` — so
   both `Tendering` AND `Lost` projects are blocked from operational documents
   (PR / PO / SR / payments / inflows / invoices / DC). Defense-in-depth is
   unchanged: UI hides non-Won projects from pickers; backend refuses operational
   docs.

7. **One-way transitions.** `Tendering → Won` and `Tendering → Lost` are
   permanent. Convert and Mark-as-Lost endpoints reject the call unless the
   project is currently `tendering_status = "Tendering"`.

8. **Authorization (tightened in v3).** Nirmaan Admin + PMO Executive
   (plus the `Administrator` user) may create, edit, convert, mark-as-lost,
   and delete Tendering / Lost projects. v3 adds a server-side
   `_ensure_tendering_manager()` role check at the top of every whitelisted
   tendering endpoint — closing the pre-v3 gap where `ignore_permissions=True`
   let any authenticated user call those APIs directly.

9. **List & detail surfacing.**
   - **Projects list:** dedicated "Tendering" tab filtered to
     `tendering_status IN ("Tendering","Lost")`; a sub-toggle within the tab
     switches between `Tendering` (default) and `Lost`. All other status tabs
     (Created / WIP / Completed / Halted / Handover / CEO Hold) filter to
     `tendering_status = "Won"`. "Total Projects" counts only `tendering_status
     = "Won"`.
   - **Detail page:** `project.tsx` early-returns `TenderingProjectView`
     whenever `tendering_status != "Won"`. View renders Convert + Edit + Delete
     + "Mark as Lost" when `tendering_status = "Tendering"`; for `Lost` it
     renders read-only fields + Delete only.
   - The full edit-project form remains disabled for any non-Won project.

10. **`generate_pwm` guard.** The Projects `after_insert` hook no-ops when
    `tendering_status != "Won"`. Behaviour for Won projects is unchanged.

## Migration (one-shot patch)

The patch
[`nirmaan_stack/patches/v3_0/backfill_tendering_status_for_old_projects.py`](../../nirmaan_stack/patches/v3_0/backfill_tendering_status_for_old_projects.py)
stamps `tendering_status = "Won"` on every existing Projects row and leaves
`status` untouched.

Because v2 was never deployed, every pre-v3 row is by definition a real
awarded project — none carry `status="Tendering"` or `status="Won"`, they all
carry the original execution-stage values (`Created` / `WIP` / `Completed` /
`Halted` / `Handover` / `CEO Hold`), and that's exactly what `status` should
keep meaning. So the migration is a single uniform write:

```
For every Projects row where tendering_status is empty:
    tendering_status = "Won"   # status unchanged
```

No `Lost` rows exist yet — Lost is introduced in v3 via the new
`mark_tendering_project_lost` API. The patch is idempotent (filters
`tendering_status` IN `[""`, `None]`, so re-running on a v3 row is a no-op).
It must run before any v3 reader code goes live.

## Consequences

- Two fields to read instead of one. Any code that previously checked
  `status == "Tendering"` must check `tendering_status` (or use the renamed guard
  helper). Any code that previously checked `status == "Won"` must check
  `tendering_status == "Won"` — `status == "Won"` no longer exists.
- `Lost` is a new business state and gives a permanent record of dead pipeline,
  which the pre-v3 single-field model could not represent.
- Because v2 never reached prod, there's no v2 status migration to undo —
  `Created` was always the post-create initial execution stage, and stays that
  way.
- The manual status dropdown is execution-only (no `Tendering`/`Won`/`Lost`); a
  separate "Mark as Lost" action handles the only Tendering-side transition
  reachable from the UI.
- A Projects row can still legitimately exist with no work packages and no address
  (when `tendering_status` is `Tendering` or `Lost`). The dedicated stub detail view
  continues to hide that surface; operational entry points continue to be guarded.
- `autoname` is unchanged (uses Tendering-stage City, frozen at insert).
- The `generate_pwm` `after_insert` hook now guards on
  `tendering_status != "Won"` — so Tendering AND Lost stubs are both
  skipped (no PWMs generated) for the price of a single check.
