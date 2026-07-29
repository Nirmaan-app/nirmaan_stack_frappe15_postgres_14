## MC-5 -- pricing editor faithful description columns + Option-1 freeze COMPLETE

Fans the pricing grid's single Description anchor into one column per mapped description column, all INSIDE
the frozen anchor pane (Option 1), Category still the first scrolling column immediately after -- mirroring
MC-4 under the pricing grid's colIndex coordinate system. Frontend-only, `PricingGrid.tsx` + its test; two
commits. No backend/schema. `PricingGrid.test.ts` 131 -> 143; reviewRender 25 unchanged; tsc 0; build green.

**THE SEAM (the arc's riskiest logic):** a per-render `anchorWidthKeys` list is the SINGLE SOURCE OF TRUTH.
`effectiveAnchorCount = anchorWidthKeys.length`, `descriptorColStart = length + 1`. Every consumer that used
the module const `FIXED_ANCHOR_COUNT`/`DESCRIPTOR_COL_START` (Category colIndex, nav pane boundary,
`descriptorAt`, rate guard, Category Enter guard, `remarksColIndex`, `colIndexFromColKey`, `anchorPaneWidth`,
`anchorCols` colgroup, `widthOf`) now reads the per-render value. **LEGACY-BY-CONSTRUCTION:** when no row
carries `description_parts_raw` (`sheetHasDescriptionParts` false -- pre-MC-2 committed BoQs, which this
screen serves indefinitely), `buildAnchorWidthKeys` returns today's `[a0..a4]` -> `effectiveAnchorCount = 5`,
`descriptorColStart = 6`, byte-identical to the module consts. The exported `FIXED_ANCHOR_COUNT` /
`DESCRIPTOR_COL_START` are retained as the legacy source + test exports.

**Three new pure exported helpers** (the riskiest logic, made testable): `buildAnchorWidthKeys(descriptionColumns,
fanOut)` (`[a0..a3, desc:<col>...]` fan-out / `[a0..a4]` legacy); `descriptionWidthSeeds(descriptionColumns)`
(`desc:<firstCol>`->280, extras->160 -- the split-the-280-budget rule; drag-resize covers preference);
`colIndexFromColKeyPure(colkey, anchorWidthKeys, descWidthKeys, descriptorColStart, remarksColIndex)`
(extracted from the closure so the fan-out `desc:<col>` key resolution is unit-tested).

**Fan-out columns:** width-keyed by EXCEL LETTER (`desc:<col>`, collision-free, distinct from descriptors'
`d:<col>`); set/order/labels/values via the MC-4 `reviewRender` helpers (imported -- reviewRender is a leaf,
no cycle). Each is a READ-ONLY nav cell at colIndex `4..4+N-1` (`< descriptorColStart` -> excluded from the
rate/editable path). ONLY the first gets the depth indent + collapse chevron (which lives IN the description
cell on this screen) + `(no description)` fallback + the 280 seed, via a shared `DescriptionAnchorInner` --
**the SAME inner the legacy single anchor renders, so legacy is provably byte-identical** (A10). None get the
priced-tint row background or the remark-color left border. The grid header is a single flat `<th>` row (no
colspans) so the N columns are independent peers. Grid-level geometry (`descriptionColumns`, `fanOut`,
`effectiveAnchorCount`, `descriptorColStart`) threads to the memoized row as props (identity for the columns,
equality for the scalars); `descriptionColumns` is `useMemo`'d on `[columnDescriptors, rows]` and pricing
`rows` is the stable committed set (edits go through `draftRates`), so the row memo is not defeated.

**L7 joined-string guards UNCHANGED (correctness-critical):** search (`searchMatches`/`buildSearchHits`),
every save payload's `description` (the copy-forward match guard -- the backend matches rows on the joined
string), and the rollup/review-strip all keep reading `row.description`; the `buildRateCell` passthrough tests
are untouched.

**Tests:** +12 fan-out-geometry cases (anchor keys legacy/fan-out; effective count 4+N + legacy 5; Category
colIndex; letter-keyed width seeds; `colIndexFromColKeyPure` resolution + read-only description colIndices;
legacy = exactly today). **The two identified geometry fixtures needed NO change** -- `nextCell` is pure over
`colCount`, and the `pricingRowPropsAreEqual` fixture tolerates the new (undefined-in-fixture) props -- they
stand as the legacy single-description case. Helper semantics are already covered by `reviewRender.test.ts` (25).

