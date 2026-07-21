# HANDOFF — Revised BoQ **Amendment B**: W0–W2 SHIPPED, W3–W6 pending, branch rebased onto create-from-template

**Created:** 2026-07-21 · **For:** a fresh-context agent implementing W3–W6.
**Branch:** `feature/upload-revised-boq` @ **`277afb3c`** — **local, NOT pushed** (owner pushes on their workflow).
**Base:** rebased onto `feature/boq-create-from-template` @ `e2168d83`, which is itself **already on
`upstream/develop`**. 18 commits sit on top of it.

**Predecessors (read in this order):**
1. `docs/boq/revised-boq-carry-amendment.html` — the design of record, ten worked scenarios (4, 5, 6, 8, 10 are load-bearing).
2. `docs/adr/0014-boq-revised-upload-and-carry.md` — D1/D5/D6/D7/D9 each carry an `⚠️ AMENDED 2026-07-20 (Amendment B)` block.
3. `docs/boq/HANDOFF-revised-boq-carry-amendment.md` — the ORIGINAL handoff. Still accurate on defect analysis and the A1–A10 decisions; **its wave scoping is now partly stale — see §6.1.**
4. `frontend/.claude/plans/boq-revised-upload-plan.md` — S1–S11 as-built + the W0–W6 wave table.

---

## 0. TL;DR — where things stand

| | State |
|---|---|
| Decisions A1–A10 | ✅ locked; **A10 RESOLVED** (§3.3) |
| **W0** ADR-0014 Amendment B | ✅ **shipped** `465ab1e1` |
| **W1** matcher + carry (backend core) | ✅ **shipped** `3f17db86` |
| **W2** review screen (frontend) | ✅ **shipped** `7ba86e9f` |
| Rebase onto create-from-template | ✅ **done + verified** `277afb3c` (§1) |
| **W3** entry un-lock | ❌ not started |
| **W4** config → `Pending` + WP carry | ❌ not started |
| **W5** reporting (3 surfaces) | ❌ not started |
| **W6** rate-carry `is_current` fix | ❌ not started |
| Open owner questions | **none** — all three calls made (§3) |

Everything green at `277afb3c`: **16 backend suites + 594 vitest + tsc delta 0 + residence ratchet holding** (§7).

---

## 1. The rebase — what changed under you

`feature/upload-revised-boq` was rebased from merge-base `2105c169` **onto** `feature/boq-create-from-template`
(`e2168d83`). Direction was forced: the template tip is published on `upstream/develop`, the revised tip was on
no remote.

**Only 2 files overlapped**, both resolved by hand:

| File | Template's change | Resolution |
|---|---|---|
| `api/boq/wizard/parse_run.py` | `frappe_s3_attachment` → **`frappe_gcp_attachment`** (lines ~957-1000) | No textual conflict — my merge seam is at ~867-874. **Both present; 0 `s3` leftovers.** |
| `frontend/src/pages/boq-wizard/ReviewTree.tsx` | `d61aecd8` template-review polish: hides the row-detail expander, inline delete, BoQ type column, `totalCols = 8 - (templateOrigin ? 3 : 0)` | 3 conflicts in the **Status-ladder `<td>`**, all caused by template's new `{!templateOrigin && (` wrapper shifting indentation by +4. Resolved by keeping **my semantics** at **template's indentation**. |

⚠️ **`frappe_s3_attachment` is now `frappe_gcp_attachment` app-wide.** The root `CLAUDE.md` "BoQ File Reading
(S3 safety)" section still says S3 — the *pattern* (read bytes into a `NamedTemporaryFile`, never build a local
path from `file_url`) is unchanged and still correct; only the package name moved. Do not "fix" `parse_run.py`
back to S3.

**Proof the rebase lost nothing:** `git diff --name-only backup/upload-revised-boq-prerebase feature/upload-revised-boq`
returns **exactly 22 files**, and every one of them is in the template branch's own touched-file set. No file of
mine differs from its pre-rebase content except through template changes.

**Undo, if ever needed:**
```bash
git branch -f feature/upload-revised-boq backup/upload-revised-boq-prerebase   # back to a43458bf
```
Backup refs (keep until the owner has pushed): `backup/upload-revised-boq-prerebase`,
`backup/boq-create-from-template-prerebase`.

**`git rerere` is enabled on this repo.** It auto-staged one of the three ReviewTree conflicts from a cached
resolution. It was verified correct, but if you hit a rebase here again, **always re-verify a rerere-resolved
hunk** rather than trusting the auto-stage.

---

## 2. What W0–W2 actually shipped

### W0 — `465ab1e1` (docs only)
ADR-0014 amended **in place** at D1 / D5 / D6 / D7 / D9, each a dated `⚠️ AMENDED 2026-07-20 (Amendment B)`
blockquote. **D7's Amendment B layers OVER Amendment A, which stays in force** — the effective-value read is NOT
reverted. Also: Status banner, `revision_carry_status` schema row (`+Copied`), the Considered-and-rejected table
(the `source_row_number`+desc row marked **REINSTATED**), Deferred item 1, and the W0–W6 wave table in the plan doc.

### W1 — `3f17db86` (backend core)
- `services/boq_revision/row_match.py` — **rewritten as a keyed join.** Deleted `_by_key`, `_disambiguate`,
  `_section_keys`, `_is_shallower` and the `MATCHED`/`NEW`/`REMOVED`/`AMBIGUOUS` constants. `MatchRow` lost
  `order`+`level`, gained `excel_row`. `RowMatchResult` exposes the two pair maps plus `original_ids`/`revised_ids`
  and `unmatched_original()`/`unmatched_revised()`.
- `services/boq_revision/carry.py` — **rewritten.** `COPIED` is the only status; `parent_lost` retired; both-or-neither.
- `api/boq/wizard/review_carry.py` — `level` dropped from both field lists; `revision_review_advisories` **deleted**
  and replaced by `revision_review_counts` (one raw aggregate off the persisted stamp, using
  `COALESCE(TRIM(description),'') <> ''` so `total` matches the matcher's blank test *exactly*).
- `api/boq/wizard/commit_overlay.py` + `cross_boq_carry.py` — adopted the new `MatchRow`; ambiguity class collapsed
  to one not-carried reason; unmatched dest rows counted via `unmatched_revised()`.
- `api/boq/wizard/review_screen.py` — revision meta block → `copied_count` / `needs_review_count` / `total_count`.
- `doctype/boq_review_row/boq_review_row.json` — `+Copied`, stale description corrected. **Migrated + verified live**
  (`DocField.options` reads `\nCopied\nMatched\nNew\nAmbiguous\nDrifted`).

### W2 — `7ba86e9f` (frontend)
- `revisionReviewDelta.ts` — **polarity inverted.** `RevisionCarryStatus` → `"" | "Copied"`. Deleted
  `RevisionDeltaStatus`, `isDeltaStatus`, `DELTA_STATUS_SET`, `REVISION_DELTA_BADGE`; added `isRowCopied`,
  `REVISION_COPIED_BADGE`, `COPIED_STATUS`. `computeRevisionDelta` now publishes `needsActionRowIndexes`.
  `isReviewRowEdited` **kept** — single home for the edited predicate (ADR-0010 F1), imported by ReviewTree 3×.
- `ReviewTree.tsx` — Status ladder renders `Copied` where the delta badges were; the `Original` fallthrough is
  untouched and is now what every non-copied row shows. **Both muted advisory panels deleted.** Panel header carries
  `"N of M rows copied from vX"` + the self-clearing live count. Tree filter tests `needsActionRowIndexes` membership.

---

## 3. The three owner calls — do NOT re-litigate

### 3.1 The match key is `source_row_number` + description
Owner, verbatim: *"use source_row_number + description instead."* **"Sr no" meant `source_row_number`, NOT the
BoQ's S.No column.**

⚠️ **Do not re-explore an `sl_no`-based key.** It was investigated and ruled out. For the record it *was*
implementable with no schema change (`BoQ Review Row.sl_no_value` / `BOQ Nodes.code`, stamped at
`commit_pipeline.py:967`), and the dev-bench profile was: 65.8% of nodes coded; `sl_no` alone only **50.7%**
sheet-unique (numbering restarts per section, so it is not a key alone); `sl_no`+desc 91.8% unique; Preambles
coded 94.0%. Recorded so nobody re-runs the analysis.

### 3.2 Duplicate Excel position ⇒ **drop both**
Conservative; can never mis-pair. Measured dev-bench: `source_row_number` is unique within its sheet for **all
29,752** current committed nodes, so this is defence, not a live workaround. The known collider is a synthetic
review row committed with its `row_index` as its row number (`commit_pipeline.py:207`).

### 3.3 Rate carry reads `is_current = 1` — **A10 RESOLVED, no longer a blocker**
Owner: *"use the pricing sheet price values for copied rows where is_current is 1."* ⇒ **drop the
`committed_version` pin.** This is W6 and is now unblocked.

**Deliberate asymmetry to preserve:** rates read **cross-version** (`is_current`), structure reads **per-commit**.
Pricing is a living layer that gets re-edited after the structure freezes. **Do not "fix" this into symmetry.**

---

## 4. The rule as shipped (so you don't re-derive it)

> A row copies the original's classification **and** parenting **iff** it is at the **same Excel row**
> (`source_row_number`) with the **same** `normalize_n2(description)`, **and its parent satisfies the same test**.
> Both, or neither. Status is `Copied` or blank; blank renders `Original`.

Three conditions: (1) the Excel row appears exactly once on each side; (2) the descriptions at that position are
identical; (3) the original row's parent also satisfies (1)+(2) — a root satisfies it trivially.

**Why position is the whole safety argument:** a parent always sits above its child (`hierarchy.py:618`, a
monotonic stack of preceding indices), and any insert/delete shifts every position below it. So the instant a row
is introduced, nothing beneath it can satisfy (1) — the carry stops and the fresh parser wins. The defect becomes
*structurally impossible* rather than guarded against. **This is why no "did the parser find a new parent?" check
exists anywhere — and why one must never be added.**

**Never copied:** `level` (ADR-0009 re-derives it; a planted value makes the `BOQ Nodes` controller throw), the
human layer (`human_*` — would flip `has_override` and block Apply-AI sheet-wide), anything on a non-matched row.

⚠️ **`level` must never re-enter the matcher.** Both remaining inputs are immutable after parse and are not
functions of the tree, which is what makes the parse-seam run and the committed-tier run **provably identical** —
and that is what lets the committed tier re-derive the `Copied` set with no new schema.

---

## 5. WHAT IS PENDING — W3–W6

**Repo rule that governs every wave:** *output a written plan before writing any code; never write code in the same
turn as the plan.* Wait for owner review at each wave boundary.

W3–W6 are **mutually independent** — ship in any order. **W6 is the one with live user impact** (the mapping screen
currently promises rates that carry zero); consider it first.

### W3 — Entry un-lock (A1) `[backend+frontend]`

Today `origin`/`source_boq` are baked at insert, so the New|Revise radio freezes after the file drops. There is
**no server-side write-once guard** — `read_only: 1` in `boqs.json:195/213` is a Desk-form flag only, and the lock
is a pure frontend invention (`BoqMasterPanel.tsx:67-70`).

| What | Where |
|---|---|
| `origin` + `source_boq` baked | `api/boq/wizard/upload_file.py:252-255` |
| `boq_name` copied from the original | `upload_file.py:235-239` |
| `version` auto-bump (driven by `boq_name`) | `integrations/controllers/boqs.py:24-29` — `MAX(version)+1` scoped to project + `boq_name` |
| whether `sheet_drafts` get seeded | `upload_file.py:266-294` (skipped for a revision) + auto-guess loop `:304-322` |

Build a conversion endpoint in `api/boq/wizard/revision.py` (it already owns `assert_revisable_source`, reusable
verbatim). Must work in **both directions** (Revise → New re-seeds drafts). Delete `entryLocked` + its three uses
in `BoqMasterPanel.tsx` (**keep `noneToRevise`**) and `BoqDropZone.tsx`'s `pendingFileRef` hold machinery.

⚠️ **The whole risk of this wave:** the version recompute must mirror `controllers/boqs.py:24-29` **exactly**,
because `before_insert` has already run against the *filename*-derived name by conversion time. **Extract it into
ONE shared helper so the hook and the endpoint cannot drift.**

⚠️ **Do not** take the "defer the POST until Continue" shortcut: `BoqUploadScreen.tsx:164-176` (`fillFromParse`)
populates BoQ Name / Version / GST from the *parsed* doc and `confirmedFields` on those three gate Continue, so the
parse must precede Continue by construction.

**Acceptance:** a fresh upload unchanged end to end; New→Revise→New→Revise after upload lands `boq_name`/`version`/
`sheet_drafts` correctly each time; `test_revision_entry` (17) extended.

### W4 — Config → `Pending` + work-package carry (A2) `[backend]`

- `api/boq/wizard/revision.py:467` — write `"Pending"` unconditionally. **Leave `:461` `config_json` alone** and
  leave `status` in scope so the `dispositions` block at `:477-485` still returns the honest `clean`/`unsafe`
  diagnosis (it is also the payload for `reasons` / `dangling_roles` / `description_set_changed`).
- **Do NOT** change `revision_carry.py:243` or `column_diff.py:203`.
- **Must ride along:** carry the `work_packages` child rows from the original's draft. Carried drafts get none today
  (the fresh path auto-detects at `upload_file.py:271-293`), and `SheetConfigPanel.tsx:1806` **disables the
  Config-Done attestation without one** — landing `Pending` without this makes the button we now depend on
  unclickable. These ship together or not at all.
- Flip the six assertions in `api/boq/wizard/test_column_carry.py` (`:130-136`, `:138-141`, `:143-145`, `:147-150`,
  `:269-297`). **`:212-220` survives** if you change only the persisted `wizard_status` and leave
  `dispositions[].status` as the diagnosis. `services/boq_revision/test_column_diff.py` is unaffected.

**Accepted cost:** the hub Parse button stays disabled until ≥1 sheet is marked
(`BoqHubPage.tsx:738-746`, `canParse = reviewedCount >= 1`). **That is the intent.**

### W5 — Reporting (A8) `[backend+frontend]`

Three independent surfaces:

| Surface | Fix |
|---|---|
| Mapping screen | `revision.py:218-230` `_carry_counts` is wrong on **both** axes: rates counted `is_current=1` across every version *and* every sheet (unmapped + general-specs included); classifications counted `human_classification != ""`, which is **not what carries** any more. Scope to mapped sheets at the version the carry actually reads. |
| Parse completion | `merge_revision_review_carry` already returns `{copied, needs_review, total}`; `parse_run.py:872-874` **throws it away**. Thread it into the `boq:parse_run_done` payload and render per sheet in `BoqHubPage`'s completion modal. |
| Commit results | `carry_commit_overlay` returns a per-layer summary; `commit_pipeline.py:655` discards it. A failed layer surfaces **only** in the Error Log (`commit_overlay._guarded:179-183`). `CommitResultsModal.tsx` has zero revision awareness. |

**Also do here (deferred from W1 on purpose):** drop the retired `"ambiguous"` skip reason from
`cross_boq_carry._PLAN_SKIP_REASONS` **and** from `boqTypes.ts` + `CrossBoqCarryDialog.test.ts` fixtures **together**.
It currently emits a constant `0` so the API shape stays stable for the frontend; removing it backend-only would
leave the FE reading `undefined`. See the comment at `_PLAN_SKIP_REASONS`.

**Acceptance:** each surface shows a number that matches what the DB actually did; verify the mapping-screen count
against a live `Copied` count after parse — they should agree.

### W6 — Rate-carry `is_current` fix (A10) `[backend]` — **highest user impact**

The defect, confirmed live (**not** caused by this rework):

| | |
|---|---|
| Count site | `revision.py:225` — `frappe.db.count("BoQ Cell Pricing", {"boq": source_boq, "is_current": 1})`, no `committed_version` filter |
| Carry read site | `cross_boq_carry.py:179-191` resolves the source sheet by `is_current=1` → `source_version = src.commit_version`, then `:233-236` calls `pricing.get_sheet_pricing(committed_version=ctx.source_version)`, which filters **strictly** (`pricing.py:666-673`) |
| Why they diverge | `BoQ Cell Pricing.is_current` is scoped to the full identity **including `committed_version`** (`pricing.py:101`), and re-committing a sheet **orphans its pricing onto the now-frozen version** — stated at `commit_pipeline.py:473-474`, which warns but does not migrate |

**Result:** a source priced at v1 then re-committed to v2 promises *"3 rates"* on the mapping screen and carries
**zero**. Live-observed on `BOQ-26-00023` / sheet `'LMS '`.

**Fix:** align the read to `is_current` (drop the pin) and scope `revision.py:225`'s count to match.

⚠️ **`BoQ Sheet.source_commit_version` stays WRITE-ONLY provenance** (stamped at `commit_overlay.py:138`, read
nowhere; `cross_boq_carry.py:150-153` deliberately refuses it). *A verification pass once concluded "defect not
confirmed" by grepping that field name — **the pin is the VALUE (`ctx.source_version`), not the field.** Do not
repeat that.*

**Testing:** `test_cross_boq_carry` and `test_commit_overlay` are green **only because their fixtures are
same-version**, which is exactly why they miss this. **A cross-version fixture is required in both.**

---

## 6. Things discovered during W1/W2 that the original handoff does not say

### 6.1 The original handoff **under-scoped W1**
`test_commit_overlay` and `test_cross_boq_carry` broke immediately (15 failures) because **both fixtures were built
on the OPPOSITE invariant** — dest rows shifted **+10** and **+100** respectively, with docstrings stating the shift
existed *"so a naive same-row-number carry would land on the WRONG row; the twin map must follow the description."*
The original handoff assigned those suites to W6. They had to be rebuilt in W1 onto aligned Excel rows.
**Any future matcher change will break them the same way — they are the tripwire.**

### 6.2 `source_excel_row == dest_excel_row` is now always true for a carried pair
D9's plan entry carries both numbers because *"cross-BOQ the source and destination excel_row differ (D6 matches on
description, not row number)"* — **that premise is gone.** The dual-key machinery still works, just redundantly.
Left in place deliberately (D9's shape is locked); recorded so nobody reads it as a bug.

### 6.3 One matcher, three consumers
`review_carry.py:130`, `commit_overlay.py:216`, `cross_boq_carry.py` (via `commit_overlay.committed_excel_row_match`).
ADR-0010's "one owner" was honoured, so an algorithm change propagates to all three for free. **Do not fork it.**

### 6.4 The defect used to ship as a PASSING TEST
`test_carry.py`'s `test_pcc_reparented_row_lands_on_twin_new_row_index` asserted the carry **beats the fresh
parser**. It was DELETED in W1 and replaced by its inverse. `TestKnownHole` now pins the net-zero insert+delete hole
(ADR §8 hole 1) as **known-wrong on purpose** — if that test fails you have changed match semantics; read the ADR
before deciding that is correct.

---

## 7. Suite baselines — all measured at `277afb3c`, post-rebase

**Revision:** `normalize` 10 · `sheet_match` 9 · `row_match` **17** · `carry` **21** · `column_diff` 17 ·
`revision_schema` **16** · `revision_entry` 17 · `revision_mapping` 22 · `review_carry` **17** · `column_carry` 17 ·
`commit_overlay` **20** · `cross_boq_carry` 17.

**Regression:** `create_from_template` **35** · `review_screen` 260 · `parse_run` 102 · `commit_pipeline` 54 ·
`pricing` 185 · `commit_validation` 51 · `classify` 38.

**Frontend:** boq-wizard vitest **594** · `tsc` **delta 0** in touched files (~3771 pre-existing errors live in
unrelated Retired-Components etc. — ignore them, measure the delta).

**Residence ratchet:** all five holding — b1 0 · b2 8 · b3 40 · f2 **201** · f5 114.
⚠️ f2 was reconciled 200→201 in `277afb3c`: the 201st `JSON.parse` arrived with the template branch
(`350f3530`, a Frappe `_server_messages` unwrap in `ApprovedReportsDialog.tsx:205`), **not** with the revised-BoQ
work. Verified by measuring the merge-base (200), the pre-rebase branch (200) and the template branch (201).

⚠️ `PricingGrid.test.ts` must stay at **143** — the owner declined *any* new PricingGrid highlighting for this
work (S10/#1106); the existing "Show unpriced" filter is the review surface.

---

## 8. Guardrails to keep

- **Non-revision flows must stay byte-identical.** Every seam is gated on `origin == "revision"`: the parse seam
  (`parse_run.py:873`), the review meta block (`review_screen.py`), the commit overlay's early return
  (`commit_overlay.py:112-114`). Prove it with `parse_run` (102) + `review_screen` (260), not by inspection.
- **Write to the parser layer, never the human layer.** This is why Apply-AI still works on a carried sheet.
- **`sheet_name` is matched VERBATIM (#152)** everywhere — trailing/leading spaces exist in real data; `.trim()`
  only for display.
- **Finalize gate stays fully hard and purely structural** (`review_screen.py`, errors #7/#8 + cycles, no override
  path). Do not add a revision condition (A9).
- **`frappe.db.commit()` after DML, BEFORE `publish_realtime()`.**
- **Run `python3 scripts/residence_check.py` from the APP ROOT** (not `frontend/`) before committing.
- **Docs discipline:** per-slice as-built detail goes to `frontend/.claude/plans/boq-revised-upload-plan.md` +
  `.claude/context/domain/boq-backend.md` + `frontend/.claude/context/domain/boq-frontend.md`. **Never a changelog
  entry in the always-loaded `CLAUDE.md` files** — the `.claude/hooks/guard_claude_md.py` PreToolUse hook blocks it.

---

## 9. ⚠️ ENV GOTCHAS

1. **`bench` lives at `/home/frappe/.local/bin/bench`**, not `env/bin/bench`. Container is
   `frappe_docker_devcontainer-frappe-1`.
2. **vitest runs INSIDE the container only:**
   `docker exec -w /workspace/development/frappe-bench/apps/nirmaan_stack/frontend frappe_docker_devcontainer-frappe-1 npx vitest run src/pages/boq-wizard/`
3. **`:8080` is live (yarn dev), `:8000` is stale.** Test in the browser on `:8080`.
4. **After any doctype JSON edit:** `bench --site localhost migrate`, then verify with a real DB read —
   passing tests do NOT prove the runtime DB has the column.
5. **Ad-hoc DB queries from the host** need `os.chdir` to `sites/` before `frappe.init()` — recipe in root `CLAUDE.md`.
6. **The dev DB has zero `BoQ Row Category` rows**, so category carry is not live-exercisable. Unit-test it.
7. **Test revision `BOQ-26-00203`** still exists on the dev DB; original `BOQ-26-00023` is intact.
8. **The repo is PUBLIC.** `docs/boq/revised-boq-explainer.html` and `docs/boq/revised-boq-workflow.html` contain
   **real client BoQ data and must never be committed** (they are untracked; keep them that way). The amendment
   spec + these handoffs are synthetic and safe.
9. **`git rerere` is enabled** — re-verify any auto-staged conflict resolution (§1).

---

## 10. One-line status for MEMORY

> Revised-BoQ **Amendment B**: W0 `465ab1e1` + W1 `3f17db86` + W2 `7ba86e9f` SHIPPED and green; branch
> **rebased onto `feature/boq-create-from-template`** (`277afb3c`, 18 commits over `e2168d83` which is on
> upstream/develop) with only ReviewTree.tsx + parse_run.py overlapping, both resolved and verified. **W3–W6 NOT
> written** — plan in `docs/boq/HANDOFF-revised-boq-amendment-b-w3-w6.md` §5; W6 has the live user impact and is
> unblocked. No open owner questions. Local/unpushed; backups at `backup/upload-revised-boq-prerebase`.
