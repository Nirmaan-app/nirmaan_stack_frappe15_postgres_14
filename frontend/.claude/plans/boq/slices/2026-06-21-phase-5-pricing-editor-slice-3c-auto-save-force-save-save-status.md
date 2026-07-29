### Phase 5 Pricing Editor -- Slice 3c -- auto-save + force-save + save-status (FRONTEND, feat pending, 2026-06-21)

**Goal.** Adds a 1000ms `lodash`-debounced auto-save, a "Save now" force-save button, and a save-status chip -- all
REUSING the existing save (`commitRate -> onSaveRate -> save_cell_price -> mutate`). The save MECHANISM is unchanged; 3c
adds TRIGGERS + VISIBILITY. NO new endpoint, NO backend, NO lock.

**Debounced auto-save (1000ms).** The rate input's onChange (after `setDraftRates`) calls `scheduleAutoSave(row, d)`,
get-or-creating a per-cell debounced fn in `debouncersRef` (keyed by `cellKey`); ~1s after the last keystroke it commits
that cell. **Latest-draft-at-fire:** the debounced fn calls `autoSaveCellRef.current(...)` (capturing only stable
primitives); `autoSaveCellRef`/`draftRatesRef` re-synced every render in a no-deps effect, so the fire reads CURRENT
state and routes through the EXISTING `commitRate`. `AUTOSAVE_MS = 1000`.

**Cancel-debounce-on-gesture (same-cell race guard).** `commitRate` computes `key` FIRST and
`debouncersRef.current.get(key)?.cancel()`s the pending debounce on EVERY commit -- a gesture cancels the timer so a
later auto-save can't fire a stale value out of order. **Flush-on-unmount** -- a cleanup effect `.flush()`es all pending
debouncers on grid unmount (a just-typed value persists on navigate-away). This flush-on-unmount is also the load-bearing
mechanic that makes the Slice-3d keyed remount safe.

**Force-save = imperative grid handle.** `PricingGrid` is now a `forwardRef<PricingGridHandle, PricingGridProps>`
exposing `flush()` via `useImperativeHandle` (deps `[]`, reads current state through refs): flushes all debouncers then
retries any remaining draft. The page holds `gridRef`; the header "Save now" button calls `gridRef.current?.flush()`.

**Save-status chip.** Pure exported `deriveSaveStatus({inFlight, hasUnsaved, hasSaved, hasError})` -> idle/unsaved/
saving/saved/failed, priority **error > saving > unsaved > saved > idle**. The page owns the inputs: an IN-FLIGHT count
(`onSaveRate` +1 before await, -1 in finally), a client-clock `lastSavedAt` (save_cell_price returns no timestamp),
`saveError`, and `hasUnsaved` from the grid's new `onDirtyChange` prop. `editable`/`lock_info` stay INERT.

**Tests + verification.** `PricingGrid.test.ts` 22 -> **27** (+5 `deriveSaveStatus` priority tests). Vitest **39/39
GREEN**; tsc 3178, 0 in touched; Vite build exit 0 (PWA 166). 3c is the last core-editor save slice. (See frontend
CLAUDE.md `**Status (... Slice 3c ...)**`.)

