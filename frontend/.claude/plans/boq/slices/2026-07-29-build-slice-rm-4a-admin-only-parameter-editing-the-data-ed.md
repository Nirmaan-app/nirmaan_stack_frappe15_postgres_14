<!-- Recovered 2026-07-30 from frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md.
     This record shipped in PR #1133 (2bd6032f) but was never
     distributed into the rotated plan tree: the rotation was
     computed from a 1,286,655 B plan doc and the rebase archived
     develop's 1,352,991 B version. Verbatim copy, write-once. -->

## Build slice RM-4a (admin-only parameter editing + the data editor) COMPLETE

Session 4 of the rate-master box. Editing goes live -- ADMIN-ONLY (owner option (a): Estimates sees
everything READ-ONLY). PARAM VALUES ONLY -- pipeline STRUCTURE / condition editing / attribute definitions
are RM-4b. Branch `feature/boq-pricing-helper`. feat `3080ccc0` + docs (this entry). NO migration (no
doctype JSON changed), NO interpreter change.

### Backend -- four write endpoints (`api/boq/rate_master.py`, all `@frappe.whitelist(methods=["POST"])`)
All gate on the IMPORTED `pricing._is_nirmaan_admin` (never a third copy), admin gate BEFORE any resolution
or write (`_require_rate_admin` -> `frappe.PermissionError`). The AUDITED write recipe is
`doc.save(ignore_permissions=True, ignore_version=False)` (get_doc -> json.loads -> mutate parsed dict ->
json.dumps -> save -> commit): both doctypes are `track_changes:1` + DICT-valued JSON only
(config/attributes/rates -- no BoQ-Sheet-style list-valued field), so doc.save is safe AND records a
`Version` diff. `set_value` is FORBIDDEN for these edits -- it bypasses the doc lifecycle, so it would skip
the Version audit. The explicit `ignore_version=False` is load-bearing: Frappe defaults `ignore_version =
frappe.flags.in_test`, so WITHOUT it the audit Version is suppressed under `bench run-tests` (found live).
- `update_rate_config_param(name, pipeline_id, step_index, param_key, new_value, condition_index=None)`:
  numeric-only; the addressed path (`config.pipelines[id].steps[i].params[key]` / `...conditions[j].params`)
  MUST already exist -- adding/removing a param is structure editing (RM-4b) -> validation error, NO write.
- `update_rate_master_item(name, rates_patch, attributes_patch)`: dict merges; rates numeric-or-null;
  attribute keys validated vs the discipline's active-config attribute ids (skipped "where determinable");
  material/insulation canonicalised (reuses `loader._canonicalize_attributes`).
- `create_rate_master_item(...)`: inserts an ACTIVE row with MANUAL provenance -- `import_batch =
  "manual-"+hash`, `source_sheet = "Manual entry"`, `source_row = 0`.
- `deactivate_rate_master_item(name)`: `active = 0` (freeze-and-supersede -- RETAINED, never deleted).
Tests (`test_rate_master.py` 8 -> 14): happy path per endpoint; negatives -- non-admin PermissionError on
all four, non-numeric param, nonexistent param path (no write), bad attribute key; the FIRST Version doc a
config edit creates (captures the `config` diff); deactivate retains the row. `tearDownClass` also deletes
the synthetic docs' Version rows so the live count returns to 0.

### Frontend (`pages/pricing/rate-master/`)
- `rateMasterEdit.ts` (NEW, pure + vitested +8): `isRateMasterAdmin(role,userId)` (mirrors
  `canAdminOverride` / server; false while "Loading"/"Error"); `matchedConditionIndex(step,matchedAttrs)`
  re-derives the interpreter's matched branch EXACTLY to address the config path WITHOUT touching the
  interpreter; `isEditableParam` (finite-number only) + `parseFiniteInput`.
- `RateMasterPage.tsx`: `role` off the already-warm `useUserData()` -> `isAdmin`; captures both `mutate`s +
  the config doc `name`; four `useFrappePostCall` hooks wrapped in `onSaveParam`/`onSaveItem`/`onCreateItem`/
  `onDeactivateItem` that call the endpoint then refetch.
- `RateMasterDerivation.tsx`: `InlineParamEdit` -- each numeric param in the step `detail` cell is an admin
  pencil -> input (Enter saves, Escape cancels). Condition `when` + string params stay read-only. Non-admins
  get the read-only render (`isAdmin && onSaveParam` gate).
- `RateMasterDataViewer.tsx`: an admin-only trailing ACTIONS column (inline row rate/attr edit -> endpoint 2;
  deactivate via AlertDialog confirm -> endpoint 4); an ADD ROW `AddItemDialog` (form built from the
  attribute definitions + rate keys -> endpoint 3); manual rows render "Manual entry" provenance. Owner
  option (a): every affordance is `{isAdmin && ...}` -- HIDDEN for non-admins, not disabled.
- The helper connection needs NO code -- the page refetch + persistence split carry an edited param/rate
  into the next pricing-panel compute with no AI re-run (cert-proven).

### Gates
backend `test_rate_master` 8 -> 14; `test_pricing` 230 unchanged. Full vitest 1001 (baseline 993 + 8; zero
regressions). tsc 3240 baseline, 0 new. vite build exit 0.

### Cert (live, batch rmbulk-f676a178e05a + BOQ-26-00106 / ELECTRICAL BOQ; every edit reverted)
Backend restarted mid-cert (the running honcho had the STALE module -- new endpoints 417'd "has no
attribute" until `bench start` restart; tests passed because run-tests re-imports fresh). V1 param edit
(cable_boq ARMOURED discount 0.75 -> 0.70) recomputed COPPER/ARMOURED/3C/2.5 supply 200 -> 240 on screen;
FIRST Version `g7i1418iue` (owner admins@nirmaan.app, changed=['config']). V2 pricing panel on ARMOURED
badged row 268 showed supply 2460 (0.70; 0.75 = 2050) with NO re-run -- persistence split proven. V3 revert
-> config canonical BYTE-IDENTICAL to pre-V1 (sha 3f26e068...), SECOND Version records the revert. V4 both
golden suites pass (interpreter 11 + helper 12): the five standing goldens = COPPER/UNARMOURED/1C/6.0
(120/20/BCS87), COPPER/ARMOURED/3C/2.5 (200/28/BCS150), ALUMINIUM/ARMOURED/4C/16 (210/44/BCS160),
COPPER/ARMOURED/3C/50 (term 940/240) + the RM-2b fill COPPER/UNARMOURED/3C/10 (630/40). V5 item edit
(BRMI-26-12367 list 570 -> 999) reflected in viewer + derivation (supply 200 -> 340), REVERT byte-identical,
2 item Versions. V6 manual item (COPPER/UNARMOURED/1C/777, "Manual entry" + manual- batch) matched in
derivation (supply 540), deactivated (dropped from active, retained inactive), hard-DELETED at cleanup (zero
residual, items back to 588). V7 admin-only: server PermissionError negatives green + `isRateMasterAdmin`
vitest; affordances HIDDEN (no live non-admin session -- relied on vitest + server negatives, not faked).
V8 zero NET business-data writes: config + item BYTE-IDENTICAL, items 588 / config 1 active, no residual
manual rows, BoQ Cell Pricing 311 / Suggestion Events 2 unchanged. Intended audit residue: 2 config + 2 item
Version docs record the cert's edit+revert (the "first Version docs now exist" per V1).

### Files
MODIFIED: `api/boq/rate_master.py`, `api/boq/test_rate_master.py`,
`frontend/.../rate-master/{RateMasterPage,RateMasterDerivation,RateMasterDataViewer}.tsx`. NEW:
`frontend/.../rate-master/rateMasterEdit.ts(+.test.ts)`. Docs: this entry + `frontend/CLAUDE.md` + root
`CLAUDE.md` (backend endpoints). Out of scope (untouched): pipeline structure / conditions / attribute-
definition mutation (RM-4b), the interpreter, the registry, run/persistence, all wizard endpoints beyond
the `_is_nirmaan_admin` import, patches.txt, `.claude/settings.local.json`.
