### Phase 5 Pricing Editor -- Phase-2 prefill -- cross-area proposed rates (proposed-until-touched) (FRONTEND, feat pending, 2026-06-21)

**Goal.** On a MULTI-AREA sheet, saving a PER-AREA rate in one area OFFERS the same value as a PROPOSED (display-only)
rate in the CORRESPONDING rate column of the OTHER area(s) for that SAME ROW, ONLY into EMPTY cells. The proposal is
VISIBLE but NEVER saved on its own -- the user touches it (promotes to a real edit on the existing save path) or ignores
it (never committed). NO backend, NO boqTypes change, `SheetPricingPage.tsx` UNCHANGED.

**THE INVARIANT (future slices MUST respect): proposals live in a SEPARATE `proposedRates` map, NEVER in `draftRates`.**
`const [proposedRates, setProposedRates] = useState<Record<string,string>>({})`, keyed by the SAME `cellKey(row.row_index,
d.col)`. **No save path reads `proposedRates`** -- `commitRate`, `commitActiveRate` (keyboard nav), `scheduleAutoSave`,
the `flush()` handle, and the unmount-flush all read `draftRates[key] ?? savedRateStr(...)` ONLY. Anything in `draftRates`
is committable; a proposal must never be written there until the user touches the cell. Do NOT merge the two maps.

**Correspondence helper (NEW, pure, exported, unit-tested).** `findCorrespondingRateDescriptors(sourceD, descriptors)`
next to `findPairedRateDescriptor`, reusing `PER_AREA_RATE_FIELD`. Returns descriptors C where source AND C are both
`value_field === "rate_by_area"`, SAME `rate_subkey` (non-null), DIFFERENT `value_key` (non-null). `[]` for
scalar/non-rate_by_area/half-populated sources (FAIL-CLOSED -- scalar rate columns have no cross-area analog).

**Trigger + render + cleanup.** Trigger in `commitRate`'s success `.then` (after saveCellPrice + mutate resolve), gated
`d.value_field === PER_AREA_RATE_FIELD`; sets `proposedRates[ck]` only when the corresponding cell is EMPTY
(`!isCellPriced(freshRow, C)` via a new `rowsRef` AND no `draftRatesRef.current[ck]`). Render precedence `draft ??
proposed ?? savedRateStr`; `isProposed` -> the Input gets `text-muted-foreground italic`; the emerald tint stays gated on
`isCellPriced` (false for a proposal). **Promotion:** the input onChange deletes the cell's `proposedRates` entry (a
touched proposal becomes a normal draft). **Cleanup:** a `useEffect([rows])` drops any proposal whose cell is priced on
refetch. Proposals are NOT wholesale-cleared on sheet change (matches draftRates).

**Tests + verification.** `PricingGrid.test.ts` 27 -> **33** (+6 `findCorrespondingRateDescriptors`). Vitest **50 -> 56
GREEN**; tsc 3178, 0 in touched; Vite build exit 0 (PWA 166). (See frontend CLAUDE.md `**Status (... Phase-2 PREFILL
...)**`.)

