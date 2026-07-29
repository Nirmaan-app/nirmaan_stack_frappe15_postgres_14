## Slice A2 — edit-log clarity pass (FRONTEND ONLY, render-time, feat cefaf3c0, 2026-06-13)

**Goal.** Make ReviewTree's row-detail "Edit history" block readable: (1) parent moves show Excel row numbers
instead of internal `row_index`; (2) an honest verb instead of the raw field name; (3) a `YYYY-MM-DD HH:MM`
timestamp. **Render-only** -- the stored `edit_log` entry shape (`{field, from, to, by, at, reason[, area]
[, rate_subkey]}`) is UNCHANGED. NO backend, NO doctype, NO migration. `ReviewTree.tsx` is the ONLY file
touched (root CLAUDE.md deliberately not touched -- no backend change; boqTypes.ts not touched -- `EditLogEntry`
already exists + is exported, only ReviewTree's import line gained it).

**Recon basis.** A2 edit-log recon 2026-06-13: stored entry shape confirmed; `human_parent` from/to are INTERNAL
`row_index` (from = effective_parent_index, to = raw value, null = root); the Parent COLUMN already translates
index -> Excel row via the component-scoped `byIdx` map (`byIdx.get(pIdx)?.source_row_number`); `CLS_LABELS`
module-level; `at` = `frappe.utils.now()` local `"YYYY-MM-DD HH:MM:SS.ffffff"` string; the #162 standalone
Change-parent door writes a no-op same-value `human_classification` entry alongside the real `human_parent` move.

**CHANGE 1 -- Excel-row parents.** New in-component `editParentLabel(v)` (closes over the SAME `byIdx` map the
Parent column uses): `null`/`undefined`/negative -> `root`; number with a `byIdx` hit -> `row {source_row_number}`;
number with no hit -> raw number (defensive). Root copy = lowercase `root` to MATCH the detail panel's own
`origParentLabel`/`effParentLabel` (the Parent COLUMN renders BLANK for root -- unusable in a `from -> to`
phrase, so the in-panel sibling copy was matched). Applied ONLY to `human_parent` entries; non-parent fields
keep raw from/to.

**CHANGE 2 -- honest verb + #162 suppression.** New in-component `describeEditEntry(entry) -> {verb, detail,
showField} | null`: `human_classification` + from!==to -> "Reclassified" (detail = CLS_LABELS[from] -> [to]);
`human_classification` + from===to -> **null (SUPPRESS -- the #162 no-op)**; `human_parent` -> "Moved parent"
(detail = editParentLabel from -> to); else -> "Edited" (detail = raw from->to, showField=true so the field name
still shows). The render IIFE reverses the log (latest-first), maps to `{entry, d}`, and a type-guarded `.filter`
drops `d === null` BEFORE the `.map`, so the suppressed no-op never produces an `<li>`; "No edits yet." reflects
the post-suppression list. The area/rate_subkey suffix render is kept verbatim.

**CHANGE 3 -- timestamp.** New module-level `formatEditAt(at)` = `typeof at === "string" ? at.slice(0,16) : ""`
-> `"YYYY-MM-DD HH:MM"`. String slice (no date library, no TZ reparse); no `formatDate` import added.

**Backwards-compat.** Old entries read unchanged (old indices translate or raw-number fallback; odd/missing `at`
-> empty string; non-parent -> "Edited" + raw). Purely how existing data is displayed.

**Verification.** tsc 0 NEW wizard errors (filtered `boq-wizard|boqTypes` -> empty; 3177 baseline unchanged) +
in-container Vite build exit 0 (`✓ built in 4m 50s`, PWA 168 entries). No Frappe unit tests (frontend
render-only -- agreement #50). Manual live-cert LC1-LC7 pending Nitesh: LC1 parent-move shows "Moved parent" +
Excel rows matching the Parent column; LC2 real reclassify -> "Reclassified" + class labels; LC3 #162
Change-parent entry suppressed (move shown once); LC4 move-to-root reads `root`; LC5 value/text/per-area raw
from->to unchanged; LC6 timestamps no seconds/micros; LC7 old entries don't crash.

**Files (feat cefaf3c0):** frontend ReviewTree.tsx ONLY. Helpers added: module-level `formatEditAt` +
`DescribedEditEntry` interface; in-component `editParentLabel` + `describeEditEntry`. `EditLogEntry` added to the
existing `./boqTypes` type import. No backend, no doctype, no migration, no tests.

