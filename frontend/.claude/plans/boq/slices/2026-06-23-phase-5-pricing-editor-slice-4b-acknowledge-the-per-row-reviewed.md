### Phase 5 Pricing Editor -- Slice 4b-ACKNOWLEDGE -- the per-row "reviewed / looks OK" dismiss layer (FULL-STACK, MIGRATE, feat f60fe231, 2026-06-23)

**Branch-history note (owed from the b8c44dec merge):** commit **3908f733** `feat(boq-review-export): add Parent Level
column to review CSV/XLSX export` -- a Phase-3 review-export change that rode into this branch via the PR #1027 merge; the
review CSV/XLSX writers (`exportReviewCsv.ts` / `exportReviewXlsx.ts` / `buildReviewSheet`) gained a Parent Level column.
Recorded here for branch-history completeness; not part of this slice.

**What this is.** A per-entry DISMISS ("reviewed / looks OK") on the pricing-editor review strip. The strip (Slice 4b-A)
shows computed FLAGS (needs_rate / qty_anomaly / broken / not_yet) + user REMARKS. This slice lets a user acknowledge an
entry so it stops cluttering the active view -- WITHOUT changing the underlying condition (the flag clears for real only
when its condition clears, e.g. the row gets priced). A "show dismissed" toggle keeps nothing lost; a RATE EDIT on a row
RE-ARMS that row's dismissed COMPUTED flags (a material change -> re-see the computed state), but NOT a dismissed remark.

**The §6 ACKNOWLEDGE spec, recorded as BUILT (the owner-locked D1-D8):**
- **D1 STORE KEY** = (boq, sheet_name VERBATIM #152, excel_row, **flag_kind**, committed_version). Per-ROW (like
  BoQ Cell Remark) + a flag_kind discriminator. **NO per-area dimension** -- a `ReviewEntry`'s identity is (excel_row, kind)
  (needs_rate/not_yet fold their per-area detail into ONE entry per row per kind before the strip). BUILT.
- **D2 flag_kind VALUE SET** = exactly five tokens, ONE Select: `needs_rate | qty_anomaly | broken | not_yet | remark`
  (the four computed kinds + "remark"). ONE store, not a separate remark-dismissal doctype. BUILT.
- **D3 RE-ARM = ROW-LEVEL, COMPUTED-FLAGS-ONLY.** A successful `save_cell_price` freezes the row's current dismissals for
  the four computed kinds, EXCLUDING "remark" (the remark dismissal survives a rate edit). BUILT (`_rearm_row_dismissals`,
  `flag_kind IN _DISMISSAL_REARM_KINDS`). Test T6 is the load-bearing exclusion proof.
- **D4 RE-ARM IS A FREEZE, NOT A DELETE.** `set_value(is_current=0)`, the re-armed record becomes a frozen historical row;
  the read returns only is_current=1, so a re-armed dismissal vanishes from BOTH active and show-all. BUILT.
- **D5 WRITE ENDPOINT** `save_cell_dismissal(boq, sheet, excel_row, committed_version, flag_kind, dismissed, description)`:
  truthy -> freeze prior current for (row, kind) + insert fresh current; falsy -> freeze current, insert nothing (the
  explicit un-dismiss / the toggle's "show again"). Own trailing commit; lock-on-write + resolve-committed-row (no
  priceability gate -- a dismissal is allowed on any row); HTTP-string coercion of `dismissed`. BUILT (mirrors
  `save_row_remark`).
- **D6 is_finalized DECLARED but INERT** (Check default 0) -- mirrors BoQ Cell Pricing; Slice 6 wires enforcement. BUILT.
- **D7 description copy-forward GUARD** included now, NO copy-forward logic built. BUILT (field present, never branched on).
- **D8 READ PATH = a SEPARATE sheet-level map** (like column_formulas, NOT merged per-row): an additive `dismissals` key on
  `get_priced_rows` = a flat `[{excel_row, flag_kind}, ...]`. The frontend turns it into an O(1) set keyed
  `"<flag_kind>:<excel_row>"`. **CHOSEN concrete shape = the flat list** (the natural `get_all` output, mirrors
  pricing/remarks/colors; the frontend builds the membership set with the SAME composite the strip's `<li>` key already
  uses). BUILT.

**Backend (pricing.py + NEW doctype, MIGRATE).** NEW doctype **`BoQ Cell Dismissal`** (cloned from BoQ Cell Remark;
istable=0, track_changes=1, autoname `BDSM-.YY.-.#####`; fields per D1/D2/D6/D7 + freeze triple
`dismissal_version`/`is_current`/`dismissed_at` + `dismissed_by`). `pricing.py`: module consts `_DISMISSAL_KINDS` (5) +
`_DISMISSAL_REARM_KINDS` (4, no remark); helpers `_dismissal_identity_filters` / `_current_dismissal_names` /
`_next_dismissal_version` / `_rearm_row_dismissals`; endpoints `save_cell_dismissal` + `get_sheet_dismissals`; the re-arm
call INSIDE `save_cell_price` placed AFTER the price insert + BEFORE the single `frappe.db.commit()` (fires only on a
successful write -- every reject path threw earlier and mutated nothing -- and lands atomically under the one commit);
the additive sheet-level `dismissals` key built in `get_priced_rows`'s `if commit_version is not None` block via
`get_sheet_dismissals` (one query, no per-row query). ADDITIVE -- no existing doctype changed, get_priced_rows gains ONE
key (backwards-compat; a zero-dismissal sheet behaves byte-for-byte as before). `bench migrate` clean -- tabBoQ Cell
Dismissal, 22 columns (11 standard + 11 custom).

**Frontend (priceability.ts + SheetPricingPage.tsx + boqTypes.ts).** `priceability.ts` PURE helpers `dismissalKey` (=
`"<kind>:<excelRow>"`, EQUALS the strip's `<li>` key) / `reviewEntryKey` / `buildDismissedKeySet` / `isEntryDismissed` /
`filterActiveReviewEntries` (ONE pass over the already-built list -- no new page recompute, per the perf-slice-comes-next
constraint). `boqTypes.ts`: `DismissalRef` + `DismissalSaveArgs` + the `dismissals` key on `GetPricedRowsResponse`;
`ReviewEntry` UNCHANGED. `SheetPricingPage.tsx`: `allReviewEntries` -> `activeReviewEntries` ->
`reviewEntries = showDismissed ? all : active`; toolbar Review-count = ACTIVE count; strip header "Show dismissed (N)" /
"Hide dismissed" toggle (only when `dismissedCount > 0`, per-sheet, reset on tab switch); per-entry "Looks OK" / "Restore"
ghost button (`stopPropagation`; WITHHELD when `locked`); `handleSaveDismiss` (mirrors `handleSaveColor`:
in-flight/takeover/mutate) wired to `save_cell_dismissal`. NO client re-arm logic -- the server re-arms, the frontend
re-reads via `mutate()`.

**Tests.** Backend `test_pricing` **82 -> 96** (+14: `TestCellDismissal` -- T1 create/v1+read, T2 freeze-and-supersede, T3
two-kinds-independent, T4 un-dismiss-inserts-nothing, T5 rate-edit re-arms, T6 rate-edit EXCLUDES remark [load-bearing], T7
rejected rate save [non-priceable] leaves dismissals [success-only], T8 non-existent row, T9 bad/missing flag_kind, the
lock-reject guard, the HTTP-string coercion, T10 get_priced_rows surfaces/empty). Frontend Vitest **200 -> 203** (+3:
`priceability.test.ts` 27 -> 30 -- T11 active-vs-show-all filter + the remark-survives-while-flag-dismissed read-layer
mirror, T12 the strip-key composite match). tsc 0 new wizard-file errors; in-container Vite build exit 0 (167 PWA entries).

**Test coverage matrix (which D each guards).** T1/T2 = D5 freeze-and-supersede + the one-current invariant; T3 = D1/D2
(the flag_kind discriminator -> independent dismissals); T4 = D5 un-dismiss; T5 = D3 re-arm; T6 = D3 remark-exclusion
(THE load-bearing rule); T7 = re-arm-only-on-success (the 3e "rejected write mutates nothing" discipline); T8/T9 =
validation negatives; T10 = D8 additive read shape (+ backwards-compat empty); T11 = the strip filter; T12 = the
membership composite == the strip key.

**Cognitive scope (locked).** Acknowledge ONLY -- NOT the editor-perf fix, NOT the amount-formula-declaration gate, NOT
Cluster B. The frontend filter is one pass over the existing `ReviewEntry[]`; NO new page-level recompute was introduced.

**Manual live-cert (DESTRUCTIVE re-arm step -- pending Nitesh, on 145/150/166):** LC1 dismiss a needs_rate -> drops from
the active strip + the count; LC2 "show all" -> the dismissed entry reappears marked; LC3 dismiss a remark -> drops too;
LC4 edit a RATE on the dismissed row -> needs_rate re-arms (active again), the REMARK dismissal STAYS (D3); LC5 un-dismiss
via show-all -> returns to active; LC6 reload -> dismissals persist (per committed version).

