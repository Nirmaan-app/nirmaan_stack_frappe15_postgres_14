### Module 3 Slice 3e -- two-layer review gate

**Status:** COMPLETE (feat e60e768c). Frontend-only (no .py files touched). Files changed: `SheetConfigPanel.tsx`, `SheetSpokePage.tsx`, `SheetCard.tsx`. boqTypes.ts unchanged. Parser tests 588 unchanged. Wizard tests 89/89 OK. tsc: 0 errors. Production build: exit 0.

**Current state:** Module 3 COMPLETE (3a-3f); Module 4 next.

**What landed:**

**Section-grain Layer 1 (section:rows / section:areas / section:roles keys):**
- Three stable keys added to the existing `confirmedFields: Set<string>` in SheetConfigPanel. No new state structure.
- Section 1 h3: sparkle when `isUnconfirmed("section:rows", hasPrefill)`. Section 2 h3: sparkle when either field-level OR section:areas unconfirmed. Section 3 h3: same pattern for section:roles.
- `touchS1/touchS2/touchS3` helpers set BOTH the field key AND the section key in one `setConfirmedFields` call.
- Section keys are set on all: `onChange`/`onValueChange` (genuine change events); `onFocus`/`onClick` (focus-type events, which also confirm the field). Drop (M3.12) is wired to `onChange`/`onValueChange`/add/remove only -- not onFocus/onClick/onOpenChange.
- Save sets all three section keys in `setConfirmedFields` (alongside existing field keys). Save = natural confirmation.

**Bulk-accept:**
- Button "Accept all sections as-is" appears when `hasPrefill && !allSectionsConfirmed`. One click adds all three section keys to confirmedFields.
- **3e-fix (feat 7aaa0525):** Bulk-accept now calls `setConfirmedFields((prev) => new Set([...prev, ...SAVE_ALL_FIELDS]))` -- adds the full SAVE_ALL_FIELDS set (all 6 per-field keys + 3 section keys) rather than only the 3 section keys. Sections 2 and 3 heading sparkles checked the per-field key (area_dimensions / column_role_map) in an OR with the section key; adding only section keys left those sparkles live. Fix: bulk-accept now matches Save semantics -- clears every sparkle. Manual test confirmed: Cases 1 (all sparkles clear on bulk-accept), 2 (gate logic correct, drop works), 3 (no false-drop) all pass.

**Coverage summary:**
- `getContentBearingColumns()` helper extracted from handleSave's inline scan -- single source of truth.
- Save-time amber warning: `contentBearing.filter(unmapped)` -- unchanged behavior.
- Coverage block: all content-bearing columns shown with role label or "Ignore (unmapped)". Non-blocking.

**Layer 2 attestation checkbox:**
- Enabled when `allSectionsConfirmed && parserRequiredSatisfied`. Parser-required: header_row non-NaN + description + (qty|qty_total) + any rate-family + any amount-family.
- `disabled` HTML attr prevents ticking while disabled (no JS guard needed beyond that).

**Mark as reviewed (save-anchored):**
- `buildConfigPayload()` helper extracted (shared by handleSave and handleMarkReviewed to avoid blob-build duplication).
- `SAVE_ALL_FIELDS` constant (Set) shared for `setConfirmedFields` on both paths.
- Two-call sequence: `callSetConfig` first; on success `callSetStatus("Reviewed")`. Config-save failure stops before status call. Status-flip failure: inline error "Config saved but status update failed..." (config stays saved). Full success: `setConfirmedFields(SAVE_ALL_FIELDS)` + `onSaveSuccess()`.

**M3.12 re-edit drop:**
- `wizardStatus?: WizardStatus` new prop on SheetConfigPanel. SheetSpokePage passes `draft.wizard_status` (was already available, previously unused in the panel).
- `statusAtOpenRef = useRef(wizardStatus)` captures status at mount (panel remounts per sheet via `key={decodedSheetName}`).
- `dropFiredRef = useRef(false)` once-per-open guard.
- `dropIfReviewed()`: if `statusAtOpenRef.current === "Reviewed"` and not yet fired: sets `dropFiredRef.current = true`, clears `attestChecked`, calls `callSetStatus("Pending")`.
- Wired to: `onValueChange` on Header Type Select; `onChange` on all text Inputs; Yes/No toggle button onClick (these ARE value changes); area box onChange + add/remove buttons; all Section 3 handlers (addRow, commitPendingRow, changeColumn, changeRole, changeArea, removeRow, removePendingRow). NOT wired to: `onOpenChange` (dropdown open), `onFocus`, `onClick` on inputs.

**Hub Mark-reviewed retirement (M3.4):**
- `MARK_REVIEWED_CLASS` constant removed from SheetCard.tsx.
- "Mark reviewed" button removed from Pending block and Parse-failed block (found in exactly 2 places as expected).
- "Set pending" button (Reviewed block) untouched.
- A sheet can now only reach Reviewed via the spoke gate.

**Manual test checklist (live test required -- backend must be running):**
1. Open a Pending sheet with prefill. Sections show sparkle. Click "Accept all sections as-is" -- all sparkles clear. Map minimum required columns. Tick attestation checkbox. Click "Mark as reviewed" -- hub shows Reviewed pill.
2. Re-open the Reviewed sheet. Status-as-opened is Reviewed. Change one dropdown -- sheet drops to Pending (hub pill changes). Re-confirm sections, re-tick, mark reviewed again.
3. Re-open the Reviewed sheet. Focus a field (click into input) WITHOUT changing its value -- sheet stays Reviewed.
4. Hub: Pending and Parse-failed cards have no "Mark reviewed" button. Reviewed cards still have "Set pending" button.

---

