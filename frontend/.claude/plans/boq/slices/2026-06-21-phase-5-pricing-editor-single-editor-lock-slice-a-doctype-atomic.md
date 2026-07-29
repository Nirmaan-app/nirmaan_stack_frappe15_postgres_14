### Phase 5 Pricing Editor -- single-editor lock Slice A -- doctype + atomic acquire-on-first-edit (BACKEND, feat pending, 2026-06-21)

**Goal.** The pricing editor's single-editor lock, backend half + the atomicity guarantee, certified ALONE (frontend
gating / holder-name banner / takeover-reload UX = Slice B). NEW doctype **`BoQ Sheet Pricing Lock`** (istable:0,
track_changes:0 -- volatile lock state) keyed by `(boq, sheet_name [VERBATIM #152], committed_version)` with fields
`locked_by` (Link->User) + `last_edit_at` (Datetime).

**ATOMICITY = a DETERMINISTIC PRIMARY KEY (exactly-one-winner) (the load-bearing architectural fact).** The controller's
`autoname()` sets `name = _lock_identity(...)` = a **sha1 hex of `f"{boq}\x00{sheet_name}\x00{int(version)}"`**
(NUL-joined, so "Elec "/"Elec" are DISTINCT #152; arbitrary chars/length never break the PK). Two concurrent first-edits
both INSERT the SAME name -> the Postgres PK collision raises `frappe.exceptions.DuplicateEntryError`; exactly one insert
wins, the loser re-reads + is rejected/takes-over. BENCH-PROVEN live (a duplicate insert raises `duplicate key value
violates unique constraint "tabBoQ Sheet Pricing Lock_pkey"`, txn stays usable after `rollback(save_point=...)`).
Deterministic-NAME chosen over a composite unique index (the PK is the strongest, most portable atomic guarantee + needs
no separate index).

**NEW module `api/boq/wizard/pricing_lock.py`.** `LOCK_STALE_SECONDS = 300` (5-min edit-driven expiry, **NO heartbeat,
NO release endpoint, NO socket** -- expiry is edit-driven; release is implicit via staleness); `_lock_identity` /
`_read_lock` / `_is_stale`; `acquire_or_refresh(boq, sheet, version, user, now)` -- the 4-branch core: (1) FREE ->
savepoint + INSERT (atomic; on DuplicateEntryError `rollback(save_point=_ACQUIRE_SAVEPOINT)` + re-read + fall through);
(2) MINE -> refresh `last_edit_at`; (3) OTHER + FRESH -> REJECT via `frappe.throw` prefixed with the stable marker
**`_LOCK_HELD_MARKER = "BOQ_PRICING_LOCKED"`** + the holder's full name (**writes NOTHING -- a lock reject mutates
nothing**); (4) OTHER + STALE -> TAKEOVER (locked_by=user, last_edit_at=now). `read_lock_info(...)` -> the structured
dict (PURE READ). Holder name via `pr_editing_lock._get_user_full_name` (REUSED -- handles "Administrator" + Nirmaan
Users fallback).

**Gate in `save_cell_price`.** `acquire_or_refresh(... frappe.session.user, now_datetime())` slots AFTER
`_resolve_committed_cell` and BEFORE the freeze `_current_pricing_names` -- **so a REJECTED save mutates NOTHING**; the
lock write shares the request txn + the single trailing `frappe.db.commit()` (lock-touch + price atomic).

**`get_priced_rows` lock_info.** Now returns structured `lock_info` (None when free, else
`{locked_by_user, locked_by_name, is_locked_by_me, last_edit_at iso, is_stale}`) computed against
`frappe.session.user` -- a PURE READ (never acquires); `editable` = True if FREE/MINE/STALE, False only when held FRESH
by another (precomputes the Slice-B gate). `boqTypes.ts` (the only frontend touch this slice): `lock_info: unknown |
null` -> a structured `LockInfo | null` interface; PricingGrid/SheetPricingPage UNTOUCHED.

**Per-sheet isolation (test-certified).** The lock is per-(sheet, version), NOT per-workbook -- by construction, since
the deterministic name `sha1(boq \x00 sheet_name \x00 version)` makes a different sheet_name a different PK. A
`TestLockPerSheetIsolation` (2 committed sheets on ONE boq, one trailing-space #152) certifies two users on two DIFFERENT
sheets acquire two INDEPENDENT locks with ZERO contention, at BOTH `acquire_or_refresh` AND `save_cell_price`, plus a
same-sheet CONTRAST guard (other holds A fresh -> me's save on A is rejected with `_LOCK_HELD_MARKER`).

**Tests.** `test_pricing` **22 -> 31 -> 36** (+9 `TestSingleEditorLock`: acquire-on-first-save; holder-refresh;
reject-fresh-mutates-nothing [marker + holder name + no pricing row + holder untouched]; stale-takeover; THE ATOMICITY
TEST [monkeypatch first `_read_lock`->None so user B attempts the INSERT against A's existing row -> collision RAISES + is
handled -> exactly ONE row survives, holder stays A]; lock_info free/mine/other-fresh-blocks/other-stale-allows; +5
`TestLockPerSheetIsolation`). `bench migrate` CLEAN (deterministic-PK collision proven). (See root CLAUDE.md `// prior:`
"Single-Editor Lock -- Slice A".)

