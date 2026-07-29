## Slice F2 -- hub-card "needs attention" indicator (FRONTEND, feat 1f1828d4, 2026-06-18)

**What & why.** The frontend half of the "needs attention" arc: finally SHOW the user the per-sheet
failure/staleness signals the backend now captures. A consolidated indicator on each hub `SheetCard`, COLLAPSED by
default (just a chip in the badge cluster), CLICK-TO-EXPAND to list whichever of three signals apply, each with its
reason and (for parse/commit) the timestamp of the failed attempt. FRONTEND ONLY -- 1a (`parse_failure_*`), 1b
(`get_stale_sheets`), and F1 (`commit_failure_*`) already provide the data; F2 reads + renders. F3/F4 (the parse +
commit completion modals highlighting failures) are SEPARATE later slices, NOT this one.

**The three signals (all per-sheet).** (1) STALE CONFIG -- from `get_stale_sheets(boq_name)`, a SEPARATE live call
(computed on read, no stored field): reason only, NO timestamp. (2) PARSE FAILURE -- `parse_failure_category` /
`parse_failure_reason` / `parse_failure_at` on the draft (ride the BOQs payload): category + reason + timestamp.
(3) COMMIT FAILURE -- `commit_failure_reason` / `commit_failure_at` on the draft (F1, ride the BOQs payload): reason
+ timestamp. A card may carry MORE THAN ONE -> one chip, expand lists each applicable line.

**Files (3) + the ONE new fetch.**
- `boqTypes.ts` (additive only): `BoQSheetDraft` gains the five optional failure fields (the type just lets the
  frontend READ what already arrives on the doc); new `StaleSheet` + `GetStaleSheetsResponse` mirroring
  `GetCommittedStateResponse`.
- `BoqHubPage.tsx`: ONE new `useFrappeGetCall("...parse_run.get_stale_sheets")` (same bare-whitelist GET + null-key
  gotcha as `get_committed_state`) -> `staleMap: Map<sheet_name VERBATIM #152, reason>` (mirrors `committedMap`),
  passed as `staleReason` to `SheetCard` at BOTH render sites (main list + hidden-sheets reveal). The parse/commit
  stamps ride the existing `useFrappeGetDoc("BOQs")` doc, so this is the ONLY fetch added. `void mutateStale()` wired
  into `applyParseOutcome` (parse success), `handleCommitted`, and `handleSaved` so the LIVE stale signal
  clears/updates on the same triggers (fix config + re-parse -> indicator clears; fresh commit failure -> appears).
- `SheetCard.tsx`: new optional `staleReason?: string`; a clickable chip (`AlertTriangle` + "N issue(s)") in the
  badge cluster, shown iff >= 1 distinct signal -- RED when any failure STAMP present (parse or commit), AMBER when
  only stale; an inline expand block (local `attnOpen` useState, mirrors the `editingLabel` idiom -- no new
  Popover/Collapsible) listing each line with the existing `fmtCommittedAt` for timestamps.

**The de-dup rule (the one render subtlety, owner-locked).** 1a and 1b describe the SAME staleness with BYTE-IDENTICAL
reason text (shared `_stale_invalid_reason`/`_stale_empty_reason`; re-proven live this slice). When a live stale
reason is present AND `draft.parse_failure_category === "Config stale"` AND `draft.parse_failure_reason ===
staleReason`, collapse to ONE "Stale config" line (carrying the parse timestamp). Other categories (Parser/Insert
error) + commit failures are always their own line. N (chip count) = distinct lines after de-dup; chip hides at N==0.
Empty state: no stale entry AND no parse_failure_reason AND no commit_failure_reason (guard on the REASON STRINGS,
not category -- category can be "" with no reason) -> NO chip. SHOW + EXPAND only; no per-signal action buttons.

**Verification.** `tsc` 0 new wizard-file errors (filtered `boq-wizard|SheetCard|BoqHubPage|boqTypes` -> empty; 3177
baseline unchanged) + in-container Vite build exit 0 (`Done in 1285.37s`). DATA-SIDE live cert on BOQ-26-00145
(capture-and-restore; workbook RESTORED to baseline -- non-negotiable for the cert workbook): on a "Lights" config
broken with one invalid role token, `get_stale_sheets` flips `[] -> ["Lights"]` (stale_fired); the de-dup
string-equality holds -- 1b's reason `===` the reason `_record_parse_failure` would store for the same blob
(`dedup_helper_equal`) AND the stamped `draft.parse_failure_reason === staleReason` with category `"Config stale"`
(`frontend_dedup_equal`), so the frontend de-dup `===` provably fires; `_record_commit_failure` on "Washroom" stamps
`commit_failure_reason`/`_at` (commit_stamped); RESTORE verified -- stale gone, parse/commit stamps cleared, the
broken role token reverted to `sl_no`. **The VISUAL hub render (chip paints, expand lists the right lines, healthy
cards show nothing) is an OWNER-OWNED later manual pass -- not headlessly confirmable here; the data + build are
certed.** NOTE: a mid-cert crash (Frappe returns the JSON `sheet_config` field as a parsed dict, not a string, so a
naive `json.loads` threw and the first restore attempt `set_value`'d a raw dict) left "Lights" broken briefly; it was
re-restored (column A role -> `sl_no`, `get_stale_sheets` -> `[]`) before the clean re-run -- the workbook ends at
baseline.

**Scope.** FRONTEND ONLY -- no backend, no completion modals (F3/F4), no `get_stale_sheets`/`commit_boq` change.
Pure-frontend -> this plan + frontend/CLAUDE.md substantive; root CLAUDE.md deliberately NOT touched (build-prompt
scope: a frontend slice updates frontend/CLAUDE.md, not root). NEXT = F3/F4 (parse + commit completion modals
highlighting failures with reasons).

