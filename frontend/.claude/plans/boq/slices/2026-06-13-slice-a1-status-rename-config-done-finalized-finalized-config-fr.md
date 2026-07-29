## Slice A1 — status rename (Config Done / Finalized) + Finalized config-freeze (un-mark-and-edit) + dirty-marker fix (BACKEND + FRONTEND + DATA MIGRATION, feat 6001e36e, 2026-06-13)

**Goal.** Rename the `BoQ Sheet Draft.wizard_status` values **"Reviewed" -> "Config Done"** and **"Parsed
Check Done" -> "Finalized"** (owner-locked, clearer names), fix the dirty-marker asymmetry (a config change
dropped Parsed->Reviewed but never dropped a checked sheet), and add an in-place un-mark affordance. Status
strings are compared LITERALLY across backend + frontend, so the rename is coverage-critical -- one missed
site silently breaks a branch; the owner's bar was a zero-hit grep gate.

**Recon basis.** A1 coverage recon (2026-06-13): exhaustive inventory of every "Reviewed" / "Parsed Check
Done" / "Export reviewed" site; flagged the doctype-options silent-miss (`\nReviewed` token), the
const-vs-literal split in review_screen, and that only `BoQ Sheet Draft.wizard_status` persists the strings.

**THE RENAME (Change 1).** Every rename-sensitive site: doctype options (`boq_sheet_draft.json`, both tokens
in one string -- edited FIRST + read back); parse_run `_RULE3_BASE_STATUSES` + force-arm + worker comparison;
update_sheet_draft `_DIRECT_SET_STATUSES` (now excludes "Reviewed" -- the old name is an INVALID status) +
dirty-drop write (-> "Config Done"); review_screen const `_PARSED_CHECK_DONE` -> `_SHEET_FINALIZED =
"Finalized"` with the mark/unmark preconditions + writes + messages all routed through the const (fixing the
const-vs-literal split -- one definition site); frontend `WizardStatus` union, `STATUS_PILL` keys+labels, all
effectiveStatus branches/comparisons (SheetCard/BoqHubPage/SheetReviewPage/ParseRunDialog/SheetConfigPanel),
the statusAtOpenRef compare, the `set_sheet_status` write, the hub "Export reviewed" -> "Export Finalized"
label; identifiers carrying the old name renamed (`newlyDesignatedReviewed`/`pendingReviewedNames`/
`dropIfReviewed`/`handleMarkReviewed` -> `*ConfigDone`); ~78 status literals renamed in the three test modules.

**THE DATA MIGRATION (Change 2).** `v3_0/migrate_boq_sheet_draft_status_rename` -- idempotent per-row
`frappe.db.set_value(..., update_modified=False)` rewriting `wizard_status` ('Reviewed'->'Config Done',
'Parsed Check Done'->'Finalized'). Option-string rename does NOT touch stored rows (option metadata only);
this is the entire migration surface (edit_log/exports/parse-history embed no status string). `bench migrate`
verified: 6 'Reviewed'->'Config Done', 0 'Parsed Check Done' (none in DB), **0 old-value rows remain**;
options string confirmed via get_meta.

**THE FINALIZED CONFIG-FREEZE + UN-MARK-AND-EDIT (Change 3, dirty-marker fix).** Backend: new shared
`_guard_sheet_not_finalized(boq, sheet)` (update_sheet_draft, leaf module; imported by review_screen) throws
iff wizard_status=="Finalized", called in ALL FIVE config writers immediately AFTER `_guard_sheet_not_parsing`
(per-named-sheet in `set_general_specs_sheet`) -- a Finalized sheet's config write is REJECTED, superseding the
old asymmetry; the Parsed->Config-Done dirty-drop is unchanged (a Finalized sheet is rejected first). Frontend
(SheetConfigPanel): `finalized = wizardStatus === "Finalized"` -> a TEAL ShieldCheck lock banner + "Un-mark and
edit" -> confirm AlertDialog -> the EXISTING `unmark_sheet_parsed_check_done` endpoint (function name unchanged;
returns status to "Parsed") -> `onSaveSuccess()` re-fetch unlocks; the form is `<fieldset disabled={isParsing
|| finalized}>` (parsing amber banner takes precedence over finalized teal); the AlertDialog renders outside
the fieldset (portals to body). SheetCard's Finalized branch gains an "Edit config" -> spoke button so the
affordance is reachable.

**TESTS (Change 4).** ~78 literals renamed in place (sed: ReviewedSheet->ConfigDoneSheet, then quoted
literals, then the phrase, then prose). NEW: `TestFinalizedConfigFreeze` (5 writer rejects on Finalized +
Config-Done pass-through control + REAL-unmark-then-config-writer round-trip + parse-guard-precedence over the
finalized guard) + `TestStatusRenameRegression` (old "Reviewed" rejected by set_sheet_status; new "Config Done"
accepted) + retired-value superset-marking hygiene (a draft holding "Reviewed" is NOT marked); mark-rejects-
Config-Done is covered by the renamed M2 test. Counts: test_parse_run 85->86, test_update_sheet_draft 72->82,
test_review_screen 152 (renamed in place), parser 588 unchanged.

**Verification.** bench migrate + 0-old-value query + get_meta options; parser 588; three wizard modules
green; ZERO-HIT GREP (residuals all justified: migration map / 2 intentional-old-name tests / ReviewTree
"Reviewed -- looks OK" flag text [out-of-scope file] / exportReviewCsv docstring); tsc 0 wizard errors (3177
baseline) + build exit 0 (`✓ built in 9m 17s`, PWA 168 entries). Live-cert LC1-LC6 pending Nitesh.

**Files (feat 6001e36e):** parse_run.py, update_sheet_draft.py, review_screen.py, boq_sheet_draft.json,
patches.txt + patches/v3_0/migrate_boq_sheet_draft_status_rename.py, the 3 test modules; frontend boqTypes.ts,
SheetCard.tsx, BoqHubPage.tsx, SheetReviewPage.tsx, SheetConfigPanel.tsx, ParseRunDialog.tsx,
ExportWorkbookDialog.tsx. SheetSpokePage.tsx unchanged (no status literals). ReviewTree.tsx out of scope.

