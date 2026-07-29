### Phase 5 Pricing Editor -- single-editor lock Slice B -- frontend read-only gating + holder banner + takeover (FRONTEND, feat pending, 2026-06-21)

**Goal.** The frontend half of the single-editor pricing lock -- consumes Slice A's `editable` + `lock_info` from
get_priced_rows to make the grid HARD READ-ONLY when locked, show a holder-name banner, and flip the page to read-only on
a mid-edit takeover. FRONTEND ONLY -- NO backend, NO boqTypes runtime change (the `LockInfo` interface already landed in
Slice A). Slice A + Slice B together COMPLETE the single-editor lock.

**HARD READ-ONLY = WITHHOLD onSaveRate (the load-bearing reuse).** The grid's editability is a SINGLE root gate --
`onSaveRate` presence (every edit path guards on it). So the page passes `onSaveRate={locked ? undefined :
handleSaveRate}` and ALL gates collapse to the existing read-only render with ZERO new per-gate checks. `locked =
editable === false || takenOver`. **Do NOT add a per-cell `editable` check -- it duplicates the onSaveRate guard.**

**`isTakeoverError(msg)` (NEW pure exported helper, unit-tested):** `msg.includes("BOQ_PRICING_LOCKED")` -- `.includes`
NOT `.startsWith` because `getFrappeError` ", "-joins multiple `_server_messages` (the marker survives verbatim).

**Page.** (1) `locked` -> withhold onSaveRate. (2) Load-time HOLDER banner (house amber strip, `Lock` icon) shown ONLY
when `editable === false`, naming `lockInfo?.locked_by_name` + Reload + Go-to-hub. (3) `takenOver` state; in
`handleSaveRate`'s catch, `if (isTakeoverError(getFrappeError(e))) setTakenOver(true)` (else generic `setSaveError`),
still re-throws so the grid keeps the draft. (4) A distinct amber TAKEOVER banner (`AlertTriangle`) when `takenOver`,
precedence over the holder banner. (5) Reload = `void mutate()` (re-reads lock state in place). **Takeover reset = a
`useEffect` keyed on `pricedData`** (payload identity, fires on every refetch; an `[editable]` dep would miss a
true->true): clears `takenOver` when the refetch is editable.

**STALE = SILENT (NO banner).** A stale lock returns `editable === true`, so onSaveRate is NOT withheld and neither
banner shows -- the user edits normally and their first save auto-takes-over server-side. The banner condition is
`editable === false` (NOT lock_info presence). NO socket/poll/"take over" button.

**Tests + verification.** Vitest **56 -> 60 GREEN** (+4 `isTakeoverError`); tsc 3178, 0 in touched; Vite build exit 0.
**Single-editor lock COMPLETE (Slice A backend + Slice B frontend).** (See frontend CLAUDE.md `**Status (...
Single-Editor Lock Slice B ...)**`.)

