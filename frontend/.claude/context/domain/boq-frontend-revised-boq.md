# BoQ Frontend — Revised BoQ & ADR-0014 amendments

> Hub sheet-card redesign, header two-row refactor, Revised BoQ S2–S4, ADR-0014 Amendments B–E, template review and quantity keyboard nav.

> Split from `boq-frontend.md` (287KB) on 2026-07-29. Surfaces and pricing clusters defined by the owner.

## Contents

- Hub sheet-card stage redesign + footer simplifications (2026-07-06, branch `feature/boq-upload-enhancements`)
- Hub card UI refinements (2026-07-07, branch `feature/boq-upload-enhancements`)
- Review + Pricing header two-row refactor + Edit Row accordion + full-screen on Review (2026-07-07, branch `feature/boq-upload-enhancements`)
- Revised BoQ entry (S2, ADR-0014 D1/D2, branch `feature/upload-revised-boq`)
- Revised BoQ sheet-mapping screen + hub gate (S3/#1100, ADR-0014 D3)
- Revised BoQ config-screen dangling-role flag (S4/#1101, ADR-0014 D5)
- Revised BoQ — Amendment B W3 + W5 (frontend, 2026-07-21)
- What replaced it.
- KEEP, do not conflate with the lock
- Retired `"ambiguous"` skip reason dropped
- Suite deltas
- 143
- ⚠️ ADR-0014 Amendment E (2026-07-28) — the layer block returns, opt-in + attributed
- Single-sheet mode ONLY
- Defaults: `categories` ON, the three annotation layers OFF.
- New pure helpers
- Reading the plan's counts.
- disabled
- Three gates changed shape, and each matters
- The button no longer names its payload
- Ordering note
- Both gates built on this function are unaffected, and are pinned by test
- Verification.
- ⚠️ SUPERSEDED 2026-07-28 by Amendment E (above) — retained as the record of WHY the layers were removed, which is why they returned opt-in + attributed
- ⚠️ ADR-0014 Amendment D (2026-07-23) — the carry dialog is RATES-ONLY
- Removed
- Changed, and worth knowing
- Tests
- ⚠️ ADR-0014 Amendment C (2026-07-23) — the carry moves into the pricing editor
- A revision commit carries nothing
- removed
- Suite deltas
- Template review — qty review block + quantity keyboard nav (2026-07-23)
- 409'd the write
- Fix: acquire on `onFocus`, not in the save path
- Suite deltas
- 695
- Live E2E (`BOQ-26-00213` / `Electrical`, multi-area 3 zones, 203 rows, 65 gaps)
- ONE rule, not two

---

## Hub sheet-card stage redesign + footer simplifications (2026-07-06, branch `feature/boq-upload-enhancements`)

Design doc + mockups: `docs/boq/sheet-card-stage-redesign.html`. Plan: `docs/boq/hub-card-stage-redesign-plan.md`. All frontend-only; no backend change. Verified: tsc delta-0 (0 new errors in `boq-wizard/`; project baseline ~3162 unchanged), `sheetCardStages.test.ts` 13/13 green (run in devcontainer — host node_modules is linux-arm64, vitest/esbuild can't run natively on macOS), chrome-devtools E2E on BOQ-26-00035 (all zones, Commit dialog, Tendering nav).

- **SheetCard → persistent 3-zone stepper** (`SheetCard.tsx`, `sheetCardStages.ts` + `.test.ts`). Left rail (nodes ①②③ + emerald connectors on done zones); each zone = label + marker (dot/tick/badge/muted) + (button-bearing zone only) action row. `computeSheetStages({effectiveStatus, hasPriorParse, committed})` is the PURE mapping (switch over effective status; unknown → Pending fallback, mirroring the old `STATUS_PILL[...] ?? Pending`). It owns STRUCTURE (aside class, per-stage `state`, `buttonZone`, static marker text/tone/accent); the component interpolates DYNAMIC text (last-parsed date, parse-failure reason, committed v/timestamp). `SheetCardProps` interface UNCHANGED.
  - **State model:** `StageState = active | active-done | done | unreached | na | committed | hidden`. `buttonZone: 1 | 2 | null` (null = general-specs selector-governed / footer-only). Aside (`skip`/`hidden`/`general_specs`) collapses the rail: ② `na`, ③ `hidden` unless committed. A committed general-specs sheet → ③ `committed`. **Refinement over the plan table:** `Parsed`/`Parse failed` with a committed version still light ③ `committed` (so the downstream-orphan chip has a home).
  - **Header pill REMOVED.** Status now lives in the zone marker. Header = name (display-trim) + summary line (`sheet_label > workHeaders > keyword hint`) + right cluster: Parsing… (parse_in_progress), needs-re-parse chip (Config Done + has_prior_parse), N-issues attention chip (toggles the existing `attnLines` block — unchanged de-dup logic).
  - **Action rows relocated verbatim** into the button-bearing zone (Pending → Review/Skip; Config Done → Edit config/Set pending/[Re-parse if dirty]; Skip → Edit label/Include; Hidden → Include; Parse failed → Review/Skip; Parsed → Edit/Re-parse; Finalized → Review/Edit config/Export CSV/Re-parse). `canReparse` rule (Parse-failed excluded), `isSaving`/`isParsing` disabling, label editor, inline `cardError` all preserved.
  - **Stage ③ layout:** Committed badge (`◆ Committed v{n} · {date HH:MM}`) ALONE on the marker line; a stacked column below holds priced-since-export chip, the `downstreamState` orphan chip (rose `{holder} pricing now` / amber `will orphan {n}` + note), and the read-only hint. Reuses existing `committedState` / `downstreamState` props.
  - Colour register: an `ACCENT` map (SheetCard.tsx) mirrors the old `STATUS_PILL` semantics one-to-one (pending/config/skip/gspec/parsed/final/failed/hidden/committed) → node/marker Tailwind classes, ONE place. Dark variants kept.
- **Parse gate (`BoqHubPage.tsx`):** `canParse = reviewedCount >= 1` (dropped the `blockingCount === 0` term + the whole `blockingCount` computation). `parseGateReason` collapsed to a ternary. `ParseRunDialog` untouched (already renders pending/skip/hidden read-only, ticks only Config-Done). Backend `no_eligible_sheets` guard is the backstop.
- **Tendering direct-nav (`BoqHubPage.tsx`):** button onClick → `handleOpenPricing(firstCommittedSheet)` where `firstCommittedSheet` = raw `committed_state` sorted by `sheet_order` asc (nulls-last via `?? Number.POSITIVE_INFINITY`), `[0]?.sheet_name` VERBATIM. `TenderingDialog` render/state/import removed; **`TenderingDialog.tsx` deleted** (`git rm`). The pricing editor's in-editor sheet-tab strip (`SheetPricingPage` `Tabs`, ordered by `sheet_order`) is the replacement. `PricedTenderDialog.tsx` header comment de-referenced the deleted file.
- **Commit dialog (`CommitDialog.tsx`) → one step + errors-only:** `tickedSheets` seeds with ALL `eligibleSheets` (initializer + `useEffect([open])` reset); step-1 copy "All eligible sheets are selected by default; untick any you want to leave out"; primary button `Commit ({n})`. On click → `commit_preflight`: `errored.length === 0` → `fireCommit` directly (no step 2); else step-2 = slim notice listing ONLY errored/blocked sheets + "{M} will be committed" + `Commit {M}`. REMOVED: `ackedWarnings`/`toggleAck`/`requiredAckKeys`/`allWarningsAcked`/`ackKey`, all warning `<li>` + "Looks OK" checkboxes, Ready/warning badges, supersede notice, `anyWarning`/`anyRecommit` branches, `CheckCircle2` import. KEPT: `fireCommit`/`commit_boq({..confirm_orphan})`, `BOQ_DOWNSTREAM_ORPHAN` → `orphanPrompt` AlertDialog + "Re-commit anyway", `onCommitted` → results modal, not-dismissible-mid-flight, VERBATIM names, `commitEnabled = committableNames.length > 0 && !busy`.

---

## Hub card UI refinements (2026-07-07, branch `feature/boq-upload-enhancements`)

Design/plan: `docs/boq/hub-card-ui-refinements-plan.md`. Frontend-only, 2 files (`BoqHubPage.tsx`, `SheetCard.tsx`); **`sheetCardStages.ts` + test untouched** (zone-state mapping unchanged — only button copy + component-rendered CTA lines). Verified: tsc delta-0, `sheetCardStages.test.ts` 13/13 (devcontainer), chrome-devtools E2E across BOQ-26-00035 / 00013 / 00006 (8 of 10 states live; Config-Done "Ready to parse" + uncommitted-Finalized "Ready to commit" CTAs code-verified — no live data in those states).

- **Hub sections (`BoqHubPage.tsx`):** the general-specs selector is retitled **"Declare General Specification sheets"** and restyled to full sheet-card chrome (`bg-background`, header `px-4 pt-3 pb-2.5` → `border-t border-border/60` divider → checklist body); logic unchanged. A **"All Sheets"** header (+ `{nonHiddenDrafts.length} sheets` count) sits above the card grid. The bottom **"Review parsed sheets" section is KEPT** (owner choice — coexists with the per-card Review buttons).
- **SheetCard button labels (`renderActions`):** Pending → **Review Config** / **Skip Sheet**; Config Done → **Edit Config** / **Set Pending** / [**Re-parse Sheet**]; Parse failed → **Review Config** / **Skip Sheet** (owner-confirmed consistency with Pending — same handlers); Parsed → **Review** (`onOpenReview`, the review SCREEN) / **Edit Config** (`onOpenSpoke`) / [**Re-parse Sheet**] (was Edit/Re-parse); Finalized → **Review** / **Edit Config** / **Re-parse Sheet** / **Export CSV** (Re-parse now before Export). "Re-parse Sheet" is the consistent label everywhere. Every handler / disabled condition / `canReparse` gate is UNCHANGED — copy only.
- **Set-aside small buttons:** Skip (**Edit label** + **Include**) and Hidden (**Include**) use the compact `h-6 px-2 text-xs` profile (matches the "Review parsed sheets" list).
- **Three next-step CTA guidance lines** (`text-xs text-muted-foreground`, footer word bolded), each naming the footer button for the sheet's next step:
  - Config Done → below the ① action row (`n===1 && effectiveStatus==="Config Done"`): *"Ready to parse — click **Parse workbook** below."*
  - Finalized-uncommitted → zone ③, replacing the muted "— not committed" marker (`n===3 && effectiveStatus==="Finalized" && !committedState`): *"Ready to commit — click **Commit** below."* (all other uncommitted states keep the muted dash).
  - Committed → the zone-③ read-only hint text changed from "read-only · Commit / Tender in footer" → *"Ready for tendering — click **Tendering** below."*

---

## Review + Pricing header two-row refactor + Edit Row accordion + full-screen on Review (2026-07-07, branch `feature/boq-upload-enhancements`)

Frontend-only, 3 files (`SheetReviewPage.tsx`, `ReviewTree.tsx`, `SheetPricingPage.tsx`); no backend change. Owner brief: rearrange the review header so BADGES sit beside the title and BUTTONS drop to a section below; add the pricing full-screen toggle to the review screen; add an "Edit Row" accordion inside the row-detail panel; then MIGRATE the same two-row header to pricing. Verified: tsc delta-0 (0 new errors in `boq-wizard/`; project baseline ~3162 unchanged), JSX balance 0/0 both edited files, chrome-devtools E2E — Review `BOQ-26-00046/ELECTRICAL` (Parsed, editable) + Pricing `BOQ-26-00047/VRF - Critical Rooms` (committed v2).

### Two-row header (SHARED pattern — Review `SheetReviewPage.tsx` + Pricing `SheetPricingPage.tsx`)
The single header strip (`flex items-start gap-3` with an `ml-auto` cluster holding badges AND buttons) is split into a `space-y-3` wrapper with TWO rows:
- **Row 1 — title + status badges:** `flex items-center gap-3 flex-wrap`; Back (dropped its `mt-0.5`) + title column (`min-w-0 flex-1`, caption + h1, truncates first) + a RIGHT-ALIGNED badge cluster (`ml-auto shrink-0 flex flex-wrap items-center justify-end gap-*`). `items-center` centres the badges against the two-line title block; the outer `flex-wrap` drops the cluster to its own right-aligned line on a narrow viewport. Each badge self-truncates (WP pill gained `max-w-[16rem]`) so a long WP list / presence roster never crowds the truncating title.
- **Row 2 — action buttons:** `flex flex-wrap items-center gap-2`. **Full screen is the FIRST button** on both screens.
- **Badge vs button split (owner-chosen "split by meaning"):** persistent status → Row 1 badges; interactive actions → Row 2.
  - Review Row 1 badges: WP · `BoqPresence` ("Also here") · "All changes saved" anchor. Review Row 2: Full screen, Export CSV, Mark Finalized (`sheetStatus==="Parsed"`), Run AI pass (+ "AI pass running…" chip beside its trigger), Run Gemini (`geminiEnabled`, + its chip). The AI/Gemini "running…" chips stay in Row 2 beside their own triggers (NOT in the badge row).
  - Pricing Row 1 badges: WP · `BoqPresence` · save-status chip (`w-40` fixed footprint KEPT — prevents Saving↔Saved jitter of the cluster) · priced-count readout ("N of M priced · ready to finalize"). Both status readouts are `!isGridOnly`. Pricing Row 2: Full screen (always), then `!isGridOnly`: Lock/Unlock, Freeze columns, Summary, Review, Price any row, Save now — SAME relative order as before (Full screen just promoted to first). All state-colored variants (teal Lock / sky Freeze / amber Override), `onClick`/`disabled`/`title`, the `!isGridOnly` gate, `isViewingHistory` disables preserved verbatim. `BoqPresence` MUST stay mounted (it announces this client's presence).

### Full-screen on the Review screen (ported from Pricing Slice 4c)
`SheetReviewPage` gains `const [expanded, setExpanded] = useState(false)` + an Esc-to-exit effect that REUSES the exported pure `shouldExitFullscreenOnEsc` from `./PricingGrid` (no duplication). Root wrapper className swaps via `cn()`: `fixed inset-0 z-50 flex flex-col space-y-4 overflow-auto bg-background p-4` when expanded, else the normal `flex-1 space-y-4 max-w-5xl mx-auto …`. ONE JSX tree → no remount → open detail panel / search / collapse / draft-lock survive the toggle (same rationale as pricing; NOT a Dialog/portal). `ReviewTree` gained an `expanded?: boolean` prop (default false) that relaxes its scroll-container cap at the table div: `cn("overflow-auto", expanded ? "max-h-[calc(100vh-6rem)]" : "max-h-[calc(100vh-16rem)]")` — a generous viewport cap rather than pricing's `flex-1 min-h-0` chain (the review banner stack makes the full flex-col plumbing fragile; the overlay's own `overflow-auto` scrolls regardless).

### "Edit Row" accordion in the row-detail panel (`ReviewTree.tsx`)
The three inline EDIT surfaces are collapsed behind ONE `Accordion type="single" collapsible` (shadcn `@/components/ui/accordion`), single `AccordionItem value="edit-row"`, label **"Edit Row"**, **closed by default** (no `defaultValue`; each row's panel mounts fresh → re-opens collapsed). Wraps **Edit values + Edit text + Edit per-area values + the shared save-error** (owner: per-area INCLUDED). **Remarks is EXCLUDED** — stays its own section immediately below the accordion, both its `readOnly` and editable branches untouched. Outer gate `!readOnly && (editableDescriptors.length > 0 || editableTextDescriptors.length > 0 || editableAreaDescriptors.length > 0)` → on a read-only/Finalized sheet the accordion is suppressed entirely (nothing editable inside) and the inline read-only remark shows as today. Trigger restyled to a COMPACT INLINE toggle (`w-auto flex-none justify-start gap-1.5 … text-[10px] uppercase …`) neutralizing shadcn's default `flex-1 justify-between` so the chevron sits beside the label (not stranded at the wide panel's right edge), matching the panel's other `text-[10px]` section labels; a subtle `border-t border-border/60 pt-1` divider sets it off. Everything else in the panel (edited/original badge, Classification/Parent reclassify controls, ParentChain/ChildrenList, AI + Gemini accept blocks, Warnings, Edit history) stays OUTSIDE, unchanged.

## Revised BoQ entry (S2, ADR-0014 D1/D2, branch `feature/upload-revised-boq`)

Store (`useBoqWizardStore`): `revisionMode: "new"|"revise"` (default `"new"`) + `sourceBoq: string|null`.
`setRevisionMode` clears `sourceBoq` when leaving revise; `reset` (project change) clears both;
`resetUpload` ("Replace file" / "Try again") **preserves** them (shallow-merge omission — the entry
context survives a file replace, like `selectedProjectId` does).

`BoqMasterPanel` — the **New | Revise** radio + inline `react-select` original picker at the TOP of the
Master-details card (Upload path only; the top-level Upload | Create-from-Template toggle in
`BoqPickerPage` is untouched). Picker data = `revision.list_revisable_boqs` via `useFrappeGetCall`
(3rd-arg swrKey `null` until the project is known); options render `{boq_name} — v{version}` + muted
`uploaded {formatDate}` (`getSelectStyles`, `formatOptionLabel`). Empty eligible list ⇒ Revise radio
disabled + hint (`noneToRevise`, gated on having a project so it never flashes pre-fetch); a
settled-empty list while already in revise falls back to New via an effect. **`entryLocked =
uploadStatus !== "idle"`** disables the radio + picker once an upload has fired — the entry is baked
into the created BOQs doc, so it must not change under the user; "Replace file" returns to idle and
re-enables.

`BoqDropZone` — appends `source_boq` to the upload POST (read FRESH via `useBoqWizardStore.getState()`
since the upload can fire from an effect). **Order-independence (D1):** a file dropped BEFORE the
original is picked is HELD in a `pendingFileRef` and uploaded by a deferred effect once
`readyToUpload` (New, or Revise + a pick); the reset handlers clear the ref so a stale held file can't
auto-upload.

`BoqUploadScreen` — Continue gate adds `needsOriginal = revisionMode==="revise" && !sourceBoq` (with a
"select the original BoQ to revise" tooltip item; the held-file wait is NOT mislabelled "wait for
parsing"). Backend + minimum-shippable detail: `frontend/.claude/plans/boq-revised-upload-plan.md` §S2.

## Revised BoQ sheet-mapping screen + hub gate (S3/#1100, ADR-0014 D3)

The always-shown screen between upload and hub for a revision (a fresh upload NEVER sees it).
- **Route** `/upload-boq/revision/:boqId/map` (RR v6 `lazy()`; `RevisionMappingPage` dual-exports `Component`),
  sibling to the hub route. **`BoqHubPage` redirect gate:** after the `!boq` guard, `origin==="revision" &&
  (sheet_drafts ?? []).length === 0` → `<Navigate replace>` to the map (declarative, NOT imperative-in-render).
  `boqTypes.BOQsDoc.origin` widened to include `"revision"` + a `source_boq?` field. S2's Continue still targets
  the hub, which intercepts an unconfirmed revision — no `BoqUploadScreen` nav change.
- **`revisionMapping.ts` (pure, ADR-0010 F4):** client bookkeeping ONLY — `NEW_SHEET`/`UNDECIDED` sentinels,
  `initDecisions` (matched pre-fill, else undecided), `claimed/duplicate/unclaimedOriginals`, `isMappingComplete`
  (Confirm gate = no undecided + no double-claim), `toConfirmPayload`. **N2 lives ONLY in Python** — the helper
  consumes the backend's `proposed_source`, never re-derives N2 (F1: one home). `revisionMapping.test` 10 green.
- **Components:** `RevisionMappingPage` (orchestrator: `useFrappeGetCall(get_revision_mapping_proposal)` +
  `useFrappePostCall(confirm_revision_mapping)`; decisions seeded ONCE via a ref-guard so an SWR revalidation
  can't clobber edits; Confirm → hub by entity id; Back → `/projects/:project?page=boq`; self-collision banner) +
  `RevisionIdentityPanel` (Zone-1 F2 control — identity + committed-sheet badges + "will carry N rates and M
  classifications") + `SheetPairingRow` (Zone-2 F1 control — react-select of originals + "Declare as a New sheet",
  amber highlight on undecided rows, general-specs toggle shown when the chosen original is general-specs).
  Everything editable, nothing binds until Confirm; shadcn-only; inline errors via `getFrappeError` (no toast).
  boq-wizard vitest 550 green; tsc clean in touched files. Full detail: `boq-revised-upload-plan.md` §S3/§S5.

## Revised BoQ config-screen dangling-role flag (S4/#1101, ADR-0014 D5)

S4's backend carries the ORIGINAL's rectified role map into a matched revision sheet's seeded config; when the
revised workbook dropped a mapped column, the carried role now points at a column the sheet no longer has. The
config screen surfaces it:
- **Pure `revisionConfigFlags.ts` (F4):** `computeDanglingRoles(columnRoleMap, presentColumns, isRevisionSheet)`
  → the role-mapped column letters absent from the sheet's present columns; `hasDanglingDescription(...)` → any
  dangling column carries the `description` role (the config-time warning about the changed combined description).
  Empty `presentColumns` (preview not loaded) → NO dangling (never flag before the columns are known).
- **`SheetConfigPanel`** takes a new `sourceSheetName` prop (`BoQ Sheet Draft.source_sheet_name`, passed by
  `SheetSpokePage`, `?? undefined`); its PRESENCE = a revision-carried sheet. `danglingCols` is derived from the
  seeded map vs `allColumns` (the columns present in the WINDOWED preview). **REVISION-ONLY** (a normal upload's
  config is built against the preview, so it can never dangle → the normal flow is byte-identical) and a **SOFT
  flag** — per-column `border-destructive` + inline message (same shape as `hasStrandedRoles`) + an amber Section-3
  config-time warning banner — that **does NOT block Config Done**. The windowed preview can't authoritatively prove
  a column is gone, so a false positive must never trap the user (this is the deliberate departure from
  `hasStrandedRoles`, which is a pure-config check and DOES hard-gate). `BoQSheetDraft.source_sheet_name` widened in
  `boqTypes.ts`. Tests: `revisionConfigFlags.test.ts` (8); boq-wizard vitest 558 green; tsc clean in touched files.

---

## Revised BoQ — Amendment B W3 + W5 (frontend, 2026-07-21)

Backend contracts: `.claude/context/domain/boq-backend.md` § "Amendment B waves W3–W6".
Wave table + as-built narrative: `frontend/.claude/plans/boq-revised-upload-plan.md`.

### W3 — the New|Revise entry is LIVE after upload (A1)

`entryLocked` is **deleted** from `BoqMasterPanel.tsx` along with all three of its uses (the
RadioGroup, the Revise item, the original picker). It was a pure frontend invention — the server
never enforced it — and it forced a user who picked wrong to delete and start over.

**What replaced it.** A change now routes through the PURE `revisionEntry.ts`
(`planEntryChange` → `EntryAction`), which owns "what does this change mean" so the panel stays a
thin renderer (ADR-0010 F4). Four outcomes:

| Action | When | Effect |
|---|---|---|
| `local` | no BOQs doc yet | the store value IS the truth and rides the upload POST — **byte-identical to pre-W3** |
| `await-source` | Revise picked, no original yet | wait for the picker (the endpoint REQUIRES `source_boq`) rather than throwing at the user |
| `noop` | the server already holds this exact entry | skip the call |
| `convert` | otherwise | POST `revision.convert_revision_entry` |

⚠️ **Unknown server state resolves to `convert`, never `noop`.** While the doc is still loading,
a redundant convert is idempotent server-side, whereas a wrongly skipped one leaves the radio
disagreeing with the doc.

⚠️ **`file_name` must be sent on Revise → New.** The store's `droppedFile.name` is the only exact
source for the restored BoQ name — Frappe uniquifies a colliding upload, so the server's fallback
read of `File.file_name` can come back with a hash suffix. See the backend doc.

**KEEP, do not conflate with the lock:**
- `noneToRevise` — a DATA-AVAILABILITY gate ("this project has no committed BoQ to revise"),
  orthogonal to the upload lifecycle, plus the effect that force-switches back to `"new"` when the
  revisable list resolves empty.
- `BoqDropZone`'s `pendingFileRef` — ORDER-INDEPENDENCE (ADR-0014 D1: drop-then-pick must work as
  well as pick-then-drop). A different concern entirely; `BoqDropZone.tsx` is untouched by W3.

After a successful convert the screen re-reads the doc so BoQ Name / Version reflect the server's
recomputed values; `fillFromParse` resetting `confirmedFields` to all-false is CORRECT here — the
name and version genuinely changed, so the user must re-confirm them.

### W5 — the carry numbers are finally shown (A8)

Both backend payloads gained an OPTIONAL key, absent on non-revision flows (so those render
exactly as before): `boq:parse_run_done` → `revision_carry` (per sheet, VERBATIM sheet_name #152),
and each `committed[]` entry → `revision_overlay` (per layer).

Copy for both lives in the PURE `revisionCarryReport.ts` — formatting is out of JSX so it is
unit-testable and the two modals cannot drift apart on wording. Both of its functions return
`null` for "say nothing", which is the honest answer for a non-revision flow AND for a revision
sheet with nothing to match against (a declared-New / unmapped sheet, `total` 0). The per-sheet
breakdown is EMPTY when only one sheet carried — the headline already said it.

⚠️ `SheetCarryLine` carries BOTH `sheetName` (VERBATIM — the React key) and `label`
(display-trimmed). Never key off the display text.

The parse-completion modal's carry line is INFORMATIONAL → `text-muted-foreground`, following the
existing "independent sub-lines, each shown only if non-empty" convention. The commit-results
modal names only NON-ZERO layers and omits `provenance` from the human list (it is a 1/0
"this is a revision sheet" flag, not a count).

**Retired `"ambiguous"` skip reason dropped** from `boqTypes.ts` (`CrossBoqCarryPlanRow.skip_reason`,
`CrossBoqCarryCounts`, `CarryRatesDonePayload.skipped`), `CrossBoqCarryDialog.tsx` (two sums + the
`SKIP_REASON_LABEL` entry) and the fixtures — **together with the backend**, since a backend-only
removal would have left the dialog summing `undefined`.

> `CrossBoqCarryDialog.tsx` contains two INTENTIONAL literal NUL bytes (they document and
> implement a NUL key separator). Git treats the file as binary and plain `grep` reports no
> matches — use `grep -a`.

**Suite deltas:** boq-wizard vitest 594 → **618** (`revisionCarryReport.test.ts` 15,
`revisionEntry.test.ts` 9). `tsc` delta **0** in touched files. `PricingGrid.test.ts` stays at
**143** — the owner declined any new PricingGrid work for this feature (S10/#1106).

---

## ⚠️ ADR-0014 Amendment E (2026-07-28) — the layer block returns, opt-in + attributed

Owner-directed reversal of Amendment D. Backend: `.claude/context/domain/boq-backend.md`
§ Amendment E.

### The dialog's "Also carry" block (`CrossBoqCarryDialog.tsx`)

**Single-sheet mode ONLY** — the hub's whole-BoQ button was removed at Amendment C, so the pricing
editor is the one launch point a layer choice can come from. Disabled wholesale when the sheet is
blocked by the formula gate (the server refuses the whole call). Hidden entirely when `sheet.layers`
is absent, so a pre-Amendment-E server degrades to a working rate carry rather than four dead rows.

**Defaults: `categories` ON, the three annotation layers OFF.** ⚠️ The asymmetry is a **UI default
and lives only in `initialLayerChoices()`** — the backend carries nothing it is not explicitly asked
for, so an omitted payload is rates-only, which is exactly the Amendment D behaviour a client that
never learned about layers keeps getting. Do not push this default down into the server.

**New pure helpers** (all vitest-covered, ADR-0010 F4): `LAYER_LABEL` / `LAYER_HINT`,
`initialLayerChoices`, `layerOutcomeFor`, `layerHasWork`, `layerMoveCount`, `layerCountsText`,
`layerSkipNote`, `armedLayerReplacements`, `buildLayersPayload`, `nothingToCarry`,
`carrySelectionSummary`.

**Reading the plan's counts.** The plan walks every layer with **overwrite OFF**, so `carried` =
rows that would be written and `kept` = rows the destination already holds. Arming Overwrite moves
`kept` into `replaced` **without changing the walk's total** — hence `layerMoveCount(outcome,
overwrite) = carried + (overwrite ? kept : 0)`. A layer with `carried + kept === 0` renders
**disabled** ("Nothing to carry"), and the Keep/Overwrite pair appears only when `kept > 0` —
there is no choice to offer when nothing would be displaced.

**Three gates changed shape, and each matters:**

- **`nothingToCarry` replaces `selectedCount === 0`.** The pre-E gate spanned only the rate axis, so
  unticking every rate while leaving Categories ticked — real work — would have disabled the apply
  button. It also refuses to enable on a ticked layer that would move nothing.
- **The destructive footer spans both axes again**, counting rates and layer records **separately**:
  "12 rates" and "8 remarks" are not the same kind of loss, and one merged number would hide which
  the user actually armed.
- **`summarizeSheetCarry`'s "Nothing was carried." branch now keys off EVERY axis.** A category-only
  carry is the likeliest shape of all — a freshly committed revision whose rates all conflict can
  still take the whole category set — and reporting "nothing" there is flatly false.

**The button no longer names its payload** (`"Carry"` in single mode); a `Will carry 12 rates and
140 categories.` line above the footer says exactly what will move. **Emerald stays banned inside
the dialog** — it means priced/succeeded on this screen and belongs to the button + post-apply line.

### The "carried" verdict state

`deriveVerdictState` gains `"carried"`, driven by the one new `SheetCategoryRow.carried_from_boq`
field, which `sheetCategoryResolve.resolvedToSheetCategoryRow` passes through from
`get_sheet_categories_resolved` (surfaced for the discipline that **resolved** the row — a row can
be carried in one engine and local in another). `PricingGrid` renders it as **sky text +
`CornerDownRight` + a `carried from <BOQ>` tooltip**.

⚠️ **Owner ruling 2026-07-28: EVERY carried row is marked, machine or human.** Provenance is the
axis being reported; "who decided it" does not answer "was this inherited?". The check therefore
sits **above** the human check in `deriveVerdictState`. The cost is real and accepted — on a freshly
carried sheet most rows read sky and the auto-vs-human distinction is not visible on those rows
until they are worked through.

⚠️ **`carried_from_boq` is provenance, NOT telemetry** — unlike `cross_engine_conflict` /
`review_priority` / `votes`, which the adapter deliberately drops, this field MUST reach the
surface. Dropping it fails silently: every carried row simply renders as locally decided.

**Ordering note:** a carried row also routed "Needs review" with no human pick now reads `"carried"`
rather than `"needs_review"`. That combination is **unreachable from the resolved read** (a resolved
review row has a blank effective, which short-circuits to `"unclassified"` first), so no amber
review cue is masked. If a future read makes it reachable, review is an ACTION signal and should
win — move the routing check above the provenance check then.

**Both gates built on this function are unaffected, and are pinned by test:** `isRowEditable` keys
off `!== "unclassified"` (a carried row stays correctable) and `isMasterSetBlank` off
`=== "unclassified"` (an inherited category is still a category, so the rate gate opens).

### The consumer fix Amendment D's cleanup left behind

`SheetPricingPage`'s `onApplied` had dropped `void mutateCategories()` with the comment *"the carry
can no longer change a category, so refetching them here would be a wasted round-trip"*. **That
reasoning expired with the layer it was based on** — it is restored. Without it the grid renders the
pre-carry verdicts after an apply: no "carried" cue, and a stale blank count keeping the rate gate
shut on rows the carry had just filled.

> ⚠️ **Generalisable lesson.** A reversal-of-a-reversal must sweep for the *optimisations justified
> by the deletion*, not just the deleted feature's call sites. Grepping `layers` finds the feature;
> it does not find code that was **narrowed** because the feature was gone.
> `git grep -in "amendment d"` was the sweep that found this.

**Verification.** 1061 vitest across 45 files (was 999); `tsc` clean; residence holding at
40/0/8/116/207. Each new behaviour was verified by **deliberately breaking it and confirming the
tests failed** — the widening break failed *only* the machine-verdict case while the human case kept
passing, confirming the test targets the widening rather than the feature in general.

---

## ⚠️ SUPERSEDED 2026-07-28 by Amendment E (above) — retained as the record of WHY the layers were removed, which is why they returned opt-in + attributed

## ⚠️ ADR-0014 Amendment D (2026-07-23) — the carry dialog is RATES-ONLY

Amendment C's "Annotations & categories" block is DELETED from `CrossBoqCarryDialog.tsx` (1085 →
~690 lines), along with the `layers` field on the apply POST.

**Removed:** `CARRY_LAYERS`, `layerCountsOf`, `layerCountsLine`, `layerRowStates`,
`initialLayerChoices`, `armedOverwrites`, `buildLayersPayload`, `carryLayerItemTotal`, the
`LayerRow` component, the `LayerChoices` type, the `layerChoices` state, and the
`CrossBoqCarryLayerKey` / `...LayerCounts` / `...LayerChoice` types plus `CrossBoqCarrySheet.layers`
and `ApplySheetCarryResponse.layers` in `boqTypes.ts`.

**Changed, and worth knowing:**

- `carryButtonState` readiness is now `counts.clean + counts.conflict > 0`. A sheet whose only
  carryable content was annotations reads *"Nothing left to carry from the original"* — correct,
  since there is nothing left to carry. `CarryButtonState.ready` lost its `layerItems` field.
- The destructive footer was **re-pointed, not deleted**: the new pure `armedRateOverwrites(sheet,
  selected, overwrite)` counts SELECTED conflict cells with overwrite armed. Without this, removing
  the layers would have removed the dialog's only "there is no undo" warning while the genuinely
  destructive action (replacing a hand-typed rate) stayed silent.
- `summarizeSheetCarry` drops the `and N items` clause → `Carried 12 rates.`
- The `classificationFrozen` prop is gone from the dialog (it existed only to block the category
  layer). `SheetPricingPage` still uses the variable for the Category picker + Classify button; it
  just no longer passes it down. `onApplied` also dropped `void mutateCategories()` — the carry can
  no longer change a category, so that refetch was pure waste.

**Tests:** 5 layer `describe` blocks removed, `carryButtonState` + `summarizeSheetCarry` rewritten,
new `armedRateOverwrites` block added. 671/671 boq-wizard vitest green, tsc clean.

---

## ⚠️ ADR-0014 Amendment C (2026-07-23) — the carry moves into the pricing editor

Slices C3–C6, commits `580d113c`, `6453a3fd`, `0855527e`, `081de0f8` (local/UNPUSHED). Backend:
`.claude/context/domain/boq-backend.md` § Amendment C. Slice detail + the live sanity check:
`frontend/.claude/plans/boq-revised-upload-plan.md`.

**A revision commit carries nothing**, so the hub's whole-BoQ "Carry rates from original" surface is
**removed** and replaced by ONE per-sheet action in the pricing editor.

### `SheetPricingPage.tsx` — the button (C3)

- Action row, **immediately after `Save now`**, `bg-emerald-600` + dark variants when actionable
  (the row's loud-state convention: teal `Lock`, sky `Freeze columns`, amber `Price any row`).
- Four states from the PURE `carryButtonState` (ADR-0010 F4, in `CrossBoqCarryDialog.tsx`), precedence
  deliberate: **hidden** off a revision → loading → no mapped source → **locked** → formula gate →
  nothing to carry → ready. Locked outranks the formula gate (no write can land at all), and `locked`
  already folds the deliberate lock, a takeover, a foreign holder and history mode.
- An **already-present item counts as work** on both axes (rates `clean + conflict`, layers
  `carryable + present`) — overwrite is a real action. `unmatched`/`dropped` are excluded.
- `gridRef.current?.flush()` runs BEFORE opening: the carry writes underneath the grid, and a pending
  draft saved afterwards would silently overwrite a carried rate.
- Eligibility = ONE `get_cross_boq_carry_plan` scoped to `sheet_names: [sheetName]`, fired only when
  `origin === "revision" && source_boq`. The dialog fetches with identical args, so SWR serves both from
  one request (`CROSS_BOQ_CARRY_PLAN_METHOD` is exported so the two cannot drift on the key).
- Nothing new reaches `PricingGrid` — the V0/T2 memo shield is untouched.

### `CrossBoqCarryDialog.tsx` — single-sheet + the layer block (C4)

Thesis: **ONE GRAMMAR, TWO ZOOM LEVELS.** A layer row and a rate row have the same shape (a set split
into clean and conflict, with a Keep/Overwrite decision on the conflicts); rates expose it per cell
because money needs row-level review, a layer compresses it to one row using the same words and colours.

- `sheetName` set → one section + a header carrying the sheet and `v{src} → v{dst}`. The layer block sits
  **ABOVE** the rates because the rates section owns the scroll.
- ⚠️ **The Keep/Overwrite toggle is HIDDEN when a layer has 0 conflicts** — a visible toggle governing
  nothing implies a decision the user does not have.
- ⚠️ **The counts line IS the outcome preview**: the conflict word swaps in place with the toggle
  (`12 to copy · 3 kept` ⇄ `· 3 replaced`, destructive-tinted when armed). This is what makes an
  all-conflicts layer on Keep read as the no-op it is (`0 to copy · 340 kept`) instead of looking armed.
- The toggle is a real `role="radiogroup"` with `aria-checked` radios (the per-CELL rate control's bare
  buttons are a pre-existing a11y gap, deliberately not propagated).
- `buildLayersPayload` force-clears a blocked layer even if a stale choice says carry.
- ONE consolidated destructive footer, only when an armed overwrite will actually replace something.
- ⚠️ **Emerald is BANNED inside the dialog** — it means priced/succeeded in this screen and belongs to
  the launch button and the post-apply summary line.
- Apply is SYNCHRONOUS (`apply_sheet_carry`); `summarizeSheetCarry` formats the emerald summary line
  beside the copy-forward one and points at **"Show unpriced"** for rows the carry could never help.
- Pure + tested: `CARRY_LAYERS`, `layerCountsOf`, `layerCountsLine`, `layerRowStates`,
  `initialLayerChoices`, `armedOverwrites`, `applyTotals`, `buildLayersPayload`, `buildDecisions`,
  `carryButtonState`, `carryLayerItemTotal`, `summarizeSheetCarry`.

### Removed (C5/C6)

`BoqHubPage.tsx` (1812 → 1597): `canCarryRates`, the footer button, the carry state/refs, the
`boq:carry_rates_done` socket + reconnect self-heal, the 3s poll, the results modal, `CARRY_FAIL_REASON`.
⚠️ `isRevisionDoc` was declared INSIDE that block but is consumed by the ADR-0014 D4 removed-sheet
advisory — it is now declared beside that consumer. `revisionCarryReport.formatRevisionOverlay` /
`RevisionOverlaySummary` / `OVERLAY_LAYERS`, the `CommitResultsModal` overlay sub-line, and
`boqTypes.revision_overlay` / `CarryRatesDonePayload` / `CarryStatusResponse` are gone.
`summarizeRevisionCarry` (the PARSE-seam `revision_carry` report) is a DIFFERENT key and stays.

**Suite deltas:** `CrossBoqCarryDialog.test.ts` 14 → **49**; boq-wizard vitest **684** / 32 files;
`tsc --noEmit` clean; residence holds.

---

## Template review — qty review block + quantity keyboard nav (2026-07-23)

Two changes to the create-from-template review phase (`ReviewTree` in `templateOrigin` mode), plus the
lock-sequencing fix the second one forced.

### 1. The "needs a quantity" REVIEW BLOCK (replaces the T10 one-line advisory)

The old surface was a muted `N selected line items have no quantity.` — a bare count with no addresses,
while the Finalize gate stayed disabled. On a long sheet the offending rows could be collapsed or
filtered out of sight. Worse, the sentence was stale: the rule had widened to **missing OR zero OR
negative**, so a reviewer hunting for a blank cell would never find the row holding `-5`.

The RULE is unchanged (`isLineItemQtyGap` / backend `_template_line_item_qty_gap`, the ADR-0010 F1
parity pair). Only the surfacing changed, modelled on the pricing editor's review list and reusing this
screen's own `revealAndScrollToRow` idiom:

- `templateSelection.ts` gains `qtyGapReason` (`"missing" | "negative"`, negative tested FIRST — the
  actionable reading of a row that is both blank in total and negative in an area) and
  `buildQtyGapEntries`. **`countSelectedLineItemsNoQty` is now derived from that list** — one list, one
  length, so the block's count and the disabled-Finalize tooltip can never disagree (verified live: both
  read 64).
- The block: count + `Show list` (clickable `Row N · description · reason` entries -> reveal + scroll)
  + a `Filter to these rows` VIEW filter (a `passesFilter` predicate, so it composes with search;
  SELF-CLEARING with the same rows-LEFT guard as `deltaFilterOnly`).
- **Deliberately NOT dismissible** (unlike pricing's `needs_rate`): the gate is server-enforced at
  finalize, so a "Looks OK" that left Finalize blocked would be a lie.
- Per-row **amber attention fill** on the one cell the gate reads (the Total). Multi-area derives it
  LIVE inside `AreaQtyCells` from the same draft-or-saved values as `liveTotal` (`liveQtyGap`) — reading
  the saved `qty_total` would leave the cell amber while the Total already showed 25, waiting on the
  server re-sum. **Saved-state for the block, draft-state for the cell** — the same split
  `priceability.ts` documents ("PURE saved-state only … the live grid keeps its own draft-aware marker").
- **`placeholder="0"` REMOVED from both qty inputs.** A grey placeholder `0` in an empty cell was
  indistinguishable from a typed `0`, and BOTH are gaps — that ambiguity is what made the old bare-count
  advisory impossible to act on.

### 2. Quantity keyboard navigation (`qtyNav.ts`, pure + unit-tested)

`↓/↑` walk the qty column, `Tab`/`Shift-Tab` cross the areas and wrap rows, `Enter` = save + move down,
`Esc` reverts, and Tab at either end STOPS (focus stays in the grid).

- **DOM-focus driven, ZERO React state.** `PricingGrid` can hold an `activeCell` in state only because
  its rows are memoized behind an exhaustive comparator; `ReviewTree` renders rows inline (which is why
  `AreaQtyCells` owns its own draft), so a state tick per keystroke would re-render the whole tree. One
  `onKeyDown` on the `<tbody>`; each input carries `data-qtynav` + its identity, and a ref registry keyed
  on the DURABLE `row_index` (never an array position — collapse/filter reshuffles the order).
- **NO left/right** — a qty cell is a numeric `<input>` and the caret owns those keys.
- **`renderableRows` is now the ONE rendered-row list.** The three visibility predicates
  (`isVisible && classificationVisible && passesFilter`) compose once; both the `<tbody>` map and the nav
  matrix read it. Nav order MUST equal render order or ArrowDown lands on an off-screen row. A plain
  const, NOT `useMemo` (the predicates close over `collapsed` + four filter states; a dep list would be a
  drift hazard for no gain). Verified live: under the qty filter, ArrowDown skipped hidden rows 24/25.
- Rows are RAGGED (column visibility differs), so vertical moves CLAMP into the target row.

### 3. ⚠️ Draft-lock acquire moved to FOCUS (the regression the nav exposed)

`save_review_edit` DOES acquire the draft lock server-side (`review_screen.py` ->
`draft_lock.acquire_or_refresh`) — the `saveQtyInline` comment claiming otherwise was **wrong**. Firing
the client `onEditIntent` acquire from inside the save raced it on the lock's check-then-insert and
**409'd the write** (`DuplicateEntryError` on the deterministic PK — the same race the T10 selection
checkbox documents). What used to hide it was the human pause between focusing a cell and blurring it;
keyboard nav commits on `Enter` and closes that gap, making the latent race reproducible every time.

**Fix: acquire on `onFocus`, not in the save path** — restores the separation BY DESIGN rather than by
luck, and focusing an editable cell is what "edit intent" means anyway. `ensureLockAcquired` is
idempotent via `heldVersionRef`, so re-focusing costs nothing (verified live: 8 cell focuses -> exactly
ONE `acquire_draft_lock`). This preserves the takeover-banner escalation that dropping `onEditIntent`
entirely would have lost.

**Suite deltas:** `templateSelection.test.ts` 8 -> **15**; new `qtyNav.test.ts` **17**; boq-wizard vitest
**695** / 33 files; `tsc --noEmit` clean on touched files; residence holds.

**Live E2E (`BOQ-26-00213` / `Electrical`, multi-area 3 zones, 203 rows, 65 gaps):** block count matched
the DB exactly (65) and the Finalize tooltip; 609 nav inputs registered; Tab D->E->F->next-row-D, ArrowDown
held the column, Shift-Tab wrapped to the previous row's LAST area; amber cleared LIVE on keystroke; Enter
saved (server re-summed `qty_total`) + advanced focus, count 65->64->63; Esc reverted; Tab at the last
cell stayed put; filter narrowed 203 -> 64 rows. Zero console errors, zero 409s after the focus fix.

### 4. Quantity cells are ELIGIBLE-ROWS-ONLY (owner-directed follow-up, 2026-07-23)

**`isQtyEligibleRow` = an eligible CLASSIFICATION (`isSelectableRow`: preamble / line_item — the set the
backend calls `_ELIGIBLE_CLASSIFICATIONS` and the clone seeds `qty_by_area` for) **AND still SELECTED**.
It gates **both** the nav matrix and cell editability.

⚠️ **Classification alone is NOT eligibility.** A first pass gated on `isSelectableRow` only and left 13
DESELECTED rows still taking nav stops on a live sheet — a deselected row is never committed, so a
quantity on it is dead data. Both conditions live in this ONE predicate so "editable" and "navigable"
cannot drift apart. A note /
spacer / subtotal-marker row renders a READ-ONLY qty cell: a quantity there is meaningless, it saved
silently, nothing flagged it on this screen, and it only surfaced much later in the pricing editor as
`isQtyOnNonPriceable`. Evidence it is safe: across every template BoQ, note (111) + spacer (93) +
subtotal_marker (23) rows carry **zero** quantities; only line_item (28) and preamble (1) do.

**ONE rule, not two:** the non-eligible cell emits no input, so it drops out of the nav matrix by
construction — "nav skips it" is a consequence of "it is not editable", never a separate special case.
That also avoids the trap the nav-only fix would have created (a focusable cell that arrow-nav refuses
to leave). Any stored value still DISPLAYS via `renderDescriptorCell`, and `AreaQtyCells` emits the same
`<td>` set in the same order either way, so the column-alignment contract is untouched.

Live (`Electrical`, 203 rows): qty inputs 609 → **285** = 95 selected-eligible rows × 3 areas; spacers
(32) / notes (55) / subtotals (9) and every DESELECTED row have none (deselected-and-navigable 13 → **0**);
`<td>` counts identical on both row kinds; ArrowDown skipped a 4-row run of deselected/non-eligible rows
to land on the next selected eligible row, and Tab off the last area wrapped the same way.

### 5. DESELECT clears the row's quantities (2026-07-23)

`template_select.set_row_excluded` now zeroes `qty_total` + `qty_by_area` on every row it flips to
excluded — **cascade-wide**, which is the case that matters (deselecting one group can strand dozens of
typed quantities that silently return if the group is re-selected).

- `zeroed_qty_by_area` (pure, unit-tested) keeps the AREA KEYS and zeroes the values: the clone seeds
  `{area: 0.0}` per configured area and the grid reads that key set to decide a row is qty-bearing, so
  nulling it would blank the Total instead of showing 0. Single-area rows (no dict) skip the column.
- Written with `set_value` + **no provenance stamp**, matching the `is_excluded` write beside it: the
  user performed a SELECTION, not a per-row edit, and flipping a cascade to "Edited" would misattribute
  work they never did.
- **ONE-WAY by design (owner):** re-selecting restores the row, never the numbers.
- `test_template_select` 22 → **29** (3 pure + 6 endpoint, incl. the no-provenance and
  re-select-does-not-restore guarantees). Live-verified: typed 42 → deselect → `qty_total` 0,
  `qty_by_area` `{Area1:0,B2:0,B3:0}`, cell read-only, row out of the nav matrix.
