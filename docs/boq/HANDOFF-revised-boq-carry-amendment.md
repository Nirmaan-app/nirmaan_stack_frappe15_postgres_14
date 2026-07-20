# HANDOFF — Revised BoQ **Carry Amendment (ADR-0014 Amendment B)**: designed + owner-locked; ADR + code NOT written

**Created:** 2026-07-20 · **For:** a fresh-context agent implementing the amendment.
**Branch:** `feature/upload-revised-boq` (tip `d89153e8`, **local, NOT pushed** — owner pushes on their workflow).
**Companion spec (read it FIRST, it is the design of record):** `docs/boq/revised-boq-carry-amendment.html` —
self-contained, opens in a browser, no build step. Synthetic scenarios only, **no client data → safe to commit**
(unlike the two sibling docs below).
**Predecessor context:** `docs/adr/0014-boq-revised-upload-and-carry.md` (the ADR being amended),
`frontend/.claude/plans/boq-revised-upload-plan.md` (slices S1–S11, all AS-BUILT),
`docs/boq/revised-boq-explainer.html` + `docs/boq/revised-boq-workflow.html` (LOCAL/untracked — **real client BoQ
data on a PUBLIC repo, do NOT commit those two**).

---

## 0. TL;DR — where things stand

The revised-BoQ feature (slices S1–S11, tickets #1098–#1107) is **fully built and live-E2E-verified**. The owner then
reviewed it against stakeholder expectations, rejected three things, and — across four rounds of narrowing — locked a
**much simpler** replacement rule.

**Nothing has been written yet — no ADR amendment, no code.** That is your job.

| | State |
|---|---|
| Defect analysis | ✅ complete, every claim traced to `file:line` at `d89153e8` |
| Design decisions A1–A10 | ✅ **locked** (owner-confirmed, §2) |
| Companion HTML spec | ✅ written — `docs/boq/revised-boq-carry-amendment.html` |
| ADR-0014 Amendment B commit | ❌ **not written** — this is your first commit |
| Implementation | ❌ **not started** — plan in §6 |
| Open items | ⏳ **one** — the rate-carry version pin (§5), owner call |

**Do NOT re-litigate A1–A10.** Each was put to the owner with alternatives and costs, and answered. The rule went
through four deliberate simplifications (aligned-runs diff → prefix walk → position key); **the position key is the
final one.** Do not "improve" it back toward a diff.

---

## 1. What the amendment is — the defect in one paragraph

The shipped carry matches a revision's rows to the original's on **description identity alone**, with no positional
constraint (`services/boq_revision/row_match.py:115-169`). Two rows pair if their N2-normalised description occurs
exactly once on each side — row 3 can pair with row 900. It then follows the original's `parent_node` and
**overwrites the fresh parser's parenting** with it (`carry.py:128-133` → `review_carry.py:178-179`).

So when a revision inserts a new section heading, the rows beneath it still pair by description, their old parent
still resolves, `parent_lost` stays False, no advisory fires — and the carry silently drags them back under the *old*
heading. The inserted heading ends up childless and every affected row renders as a calm `Original`.

**Two facts to internalise before touching anything:**

1. **`d89153e8` doubled the blast radius.** Before it, the re-point was gated on `human_parent >= 0` — it fired for
   the ~13% of rows a human had manually re-parented. That commit (reading the *effective* value instead of the empty
   human-override layer) was correct in itself, but `parent_node` is always populated on a committed node, so the
   re-point now fires on **every matched row unconditionally**. **Do not revert it** — the effective-value read stays.
2. **The bug is currently a passing test.** `services/boq_revision/test_carry.py:95-113`,
   `test_pcc_reparented_row_lands_on_twin_new_row_index`, asserts the carry **beats the fresh parser**. Its premise is
   that the parser is repeating a mistake. **Rewrite it, do not preserve it.**

---

## 2. The ten decisions — design of record (LOCKED)

Full argument + ten worked scenarios in `docs/boq/revised-boq-carry-amendment.html`.

| # | Decision | Supersedes |
|---|---|---|
| **A1** | The New/Revise entry never locks. Origin is set *after* upload, not baked into it. | D1 *implementation* |
| **A2** | Config carry seeds the column map but always lands `Pending`. User clicks Mark Config as Done. | D5 *decision* |
| **A3** | Rows match on **Excel position + description**. The whole description-bucket engine is deleted. | D6 *entirely* |
| **A4** | A matched row copies classification **and** parenting together. Both, or neither. | D7 |
| **A5** | The parent must itself be a matched row, or the row does not copy. | D7 |
| **A6** | Status is `Copied` or nothing. Nothing renders as `Original`, exactly like a fresh upload. | D7 |
| **A7** | `Copied` ⟺ matched ⟺ rate-eligible. One number. | D9 framing |
| **A8** | The carry reports itself at parse, commit and rate carry. All three silent or wrong today. | — |
| **A9** | Every non-copied row is a normal parser row — all warnings, flags and checks flow unchanged. | D7 *affirmed* |
| **A10** | The rate-carry version pin must be resolved before this reaches a user. | D9 |

---

## 3. The carry rule — the spec you implement

### 3.1 The key

> **same Excel row + same description**

A row carries its decisions forward only if it is still in the same place with the same words.

**Sides:**

| | Original | Revision |
|---|---|---|
| Source | committed `BOQ Nodes`, current version, mapped source sheet | freshly-parsed `BoQ Review Row`s |
| Position | `source_row_number` | `source_row_number` |
| Text | `description` | `description` |
| Excluded | blank description | blank description |

**Text comparison** = `normalize_n2` (trim + lowercase + collapse whitespace), unchanged. **Nothing else folded** —
no punctuation, no synonyms, no fuzzy tier.

### 3.2 A row is `Copied` when all three hold

1. Its Excel row number appears **exactly once on each side**.
2. The original row at that same Excel position has an **identical** normalised description.
3. The original row's parent **also satisfies (1) and (2)** — or the original row is a root, which satisfies this
   trivially.

Then, and only then:

| Copy | From (committed `BOQ Nodes`) | To (revision `BoQ Review Row`) |
|---|---|---|
| Classification | `row_class` (already effective) | `classification` — the **parser** layer |
| Parent | `parent_node` → that node's Excel row → the revision row at the same Excel row | `parent_index` (`-1` for root) |

Everything else: **write nothing.** Status stays empty → the Status column's existing bottom rung renders
`Original` (`ReviewTree.tsx:2635-2638`) → identical to a fresh upload, with every classifier warning, review flag,
structural check and the finalize gate applying exactly as they always have **(A9)**.

### 3.3 Why position is the whole safety argument

A parent always sits **above** its child (`services/boq_parser/hierarchy.py:618`, `parent_index = stack[-1]`, a
monotonic stack of preceding indices), and any inserted or deleted row shifts every position below it. So the instant
a row is introduced, nothing beneath it can satisfy condition (1) — the carry simply stops and the parser's answer
flows through. **The failure this amendment exists to fix becomes structurally impossible rather than guarded
against.** No walk, no diff, no heading detection, no twin map, no ambiguity class.

### 3.4 Record this honestly in the ADR

`source_row_number` + description is **named and rejected in D6** as *"the same-file key — one inserted row shifts
everything below ⇒ mass non-match ⇒ defeats the feature's whole point."* D6 replaced it with description-only
matching to recover that yield. **The amendment's central finding is that the recovered yield was bought with
correctness.** Write it that way, or a future reader will see a rejected option quietly reinstated and assume
someone forgot to check.

### 3.5 Never copied

- **`level`** — always re-derived from the effective tree (ADR-0009, `commit_validation.derive_effective_levels`).
  Copying it fires the `BOQ Nodes` controller throws. *(Verified benign that a stale review-row `level` sits beside a
  copied parent: level is re-derived at commit AND at validation.)*
- **Human-layer fields** (`human_classification` / `human_parent` / `human_is_root`) — the write lands in the
  **parser** layer. Load-bearing: keeps the row rendering "Original", keeps `has_override` false so
  `_guard_row_at_parser_baseline` doesn't block Apply-AI sheet-wide, and sidesteps `_ASSIGNABLE_CLASSIFICATIONS`
  (which forbids `subtotal_marker` / `header_repeat`).
- **Anything on a non-matched row.**

---

## 4. Code map

### 4.1 The matcher and carry

| File | What changes |
|---|---|
| `nirmaan_stack/services/boq_revision/row_match.py` | **Rewrite → a keyed join.** Delete `_by_key`, `_disambiguate`, `_section_keys`, `_is_shallower`, and the `AMBIGUOUS` / `NEW` / `REMOVED` constants. `MatchRow` loses `order` and `level`, gains `excel_row`. |
| `nirmaan_stack/services/boq_revision/carry.py` | **Rewrite `build_review_carry`.** Conditions 1–3, copy both-or-neither, stamp `Copied`. Delete `parent_lost`. |
| `nirmaan_stack/api/boq/wizard/review_carry.py` | `_load_and_match` already fetches `source_row_number` on both sides. `_summarize` → `{copied, needs_review, total}`. **Delete `revision_review_advisories`** (§4.4). |
| `nirmaan_stack/api/boq/wizard/parse_run.py:867-874` | Seam stays. **Stop discarding the return value** (A8). |
| `nirmaan_stack/nirmaan_stack/doctype/boq_review_row/boq_review_row.json` | Add `Copied` to the `revision_carry_status` Select (`:580`). Leave `Matched`/`New`/`Ambiguous`/`Drifted` inert. **Fix the stale field `description` at `:576`.** |

**One pure matcher, three consumers** — `review_carry.py:130`, `commit_overlay.py:216`, `cross_boq_carry.py` (via
`commit_overlay.committed_excel_row_match`). ADR-0010's "one owner" was honoured, so **the algorithm swap propagates
to all three for free.** Do not fork it.

> **`commit_overlay._match_rows_from_nodes` (`:227-244`) already keys `row_id = n.source_row_number`** and already
> filters to non-blank N2 descriptions. It barely changes — drop the `level` it passes, and the committed-tier
> matcher is done.

> **Structural bonus to protect.** Today the parse-seam run and the committed-tier run can legitimately **disagree**
> (committed run gets ADR-0009 effective `level`, parse run gets parser `level`, and a human re-parent between review
> and commit changes one and not the other). Under a position key both inputs are immutable after parse and neither is
> a function of the tree, so the two runs are **provably identical**. This is what makes the owner's A7 choice
> (re-derive the `Copied` set at the committed tier, no new schema) safe. **Never let `level` back into the matcher.**

### 4.2 Entry un-lock (A1)

Baked at insert today, must move to a new conversion endpoint:

| What | Where |
|---|---|
| `origin` + `source_boq` | `api/boq/wizard/upload_file.py:252-255` |
| `boq_name` copied from the original | `upload_file.py:235-239` |
| `version` auto-bump (driven by `boq_name`) | `integrations/controllers/boqs.py:24-29` — `MAX(version)+1` scoped to project + `boq_name` |
| whether `sheet_drafts` get seeded | `upload_file.py:266-294` (skipped for a revision) + auto-guess loop `:304-322` |

There is **no server-side write-once guard** on origin — `read_only: 1` in `boqs.json:195/213` is a Desk-form flag
only, and `controllers/boqs.py validate()` has no guard. The lock is entirely a frontend invention
(`BoqMasterPanel.tsx:67-70`).

⚠️ **Sharp edge:** the version recompute must mirror `controllers/boqs.py:24-29` exactly, because `before_insert` has
already run against the *filename*-derived name by conversion time. Conversion must work in **both directions**
(Revise → New re-seeds drafts).

⚠️ **Do not** take the "defer the POST until Continue" shortcut: `BoqUploadScreen.tsx:164-176` (`fillFromParse`)
populates BoQ Name / Version / GST from the *parsed* doc and `confirmedFields` on those three gate Continue, so the
parse must precede Continue by construction.

### 4.3 Config → Pending (A2)

- `api/boq/wizard/revision.py:467` — write `"Pending"` unconditionally. **Leave `:461` `config_json` alone** and leave
  `status` in scope so the `dispositions` block at `:477-485` still returns the honest `clean`/`unsafe` diagnosis.
- Do **not** change `revision_carry.py:243` or `column_diff.py:203` — the disposition is also the payload for
  `reasons` / `dangling_roles` / `description_set_changed`.
- **Must ride along:** carry the `work_packages` child rows from the original's draft. Carried drafts get none today
  (fresh path auto-detects at `upload_file.py:271-293`), and `SheetConfigPanel.tsx:1806` disables the Config-Done
  attestation without one.
- Only behavioural cost: the hub Parse button stays disabled until ≥1 sheet is marked
  (`BoqHubPage.tsx:738-746`, `canParse = reviewedCount >= 1`). That is the intent.

### 4.4 Frontend

`frontend/src/pages/boq-wizard/`:

- **`revisionReviewDelta.ts`** — collapses hard. `RevisionCarryStatus` → `"" | "Copied"`. Delete
  `RevisionDeltaStatus`, `isDeltaStatus`, `DELTA_STATUS_SET`, `REVISION_DELTA_BADGE`'s New/Ambiguous entries.
  `computeRevisionDelta` → `{copiedCount, needsReviewCount, total, sourceVersion, mode}`.
  **Keep `isReviewRowEdited`** — it is the single home for the edited predicate (ADR-0010 F1) and `ReviewTree`
  imports it in three places.
- **`ReviewTree.tsx`** — Status ladder (`:2610-2640`): `Copied` slots where `New`/`Ambiguous` were; the `Original`
  fallthrough at `:2635-2638` stays untouched and is now what every non-copied row shows. Header chip carries the two
  counts. Delta filter becomes "show rows needing review". **Delete both advisory panels** (`:1952-1986`) — there are
  no removed-row or parent-lost advisories any more.
- **`boqTypes.ts`** — `RevisionReviewMeta` loses `removed_*` and `parent_lost_*`, gains the counts.
- **`review_screen.py:1370-1393`** — the meta block simplifies to counts + `source_version`.
- **`BoqMasterPanel.tsx`** — delete `entryLocked` (`:70`) and its three uses (`:132`, `:142` — **keep `noneToRevise`
  there**, `:169`).
- **`BoqDropZone.tsx`** — delete the `pendingFileRef` hold machinery (`:20`, `:36-38`, `:52-60`, `:121-128`,
  `:245-249`) and `fd.append("source_boq", src)` (`:77`).

### 4.5 Reporting (A8)

| Surface | Fix |
|---|---|
| Mapping screen | `revision.py:218-230` `_carry_counts` is wrong on **both** axes: rates counted `is_current=1` across every version *and* every sheet (unmapped + general-specs included); classifications counted `human_classification != ""`, which since `d89153e8` is not what carries at all. Scope to mapped sheets at the version the carry actually reads. |
| Parse completion | `merge_revision_review_carry` already returns a summary; `parse_run.py:872-874` throws it away. Thread it into the `boq:parse_run_done` payload and render per sheet in `BoqHubPage`'s completion modal. |
| Commit results | `carry_commit_overlay` returns a per-layer summary; `commit_pipeline.py:655` discards it. A failed layer surfaces **only** in the Error Log (`commit_overlay._guarded:179-183`). `CommitResultsModal.tsx` has zero revision awareness today. |

---

## 5. ⏳ OPEN — the one remaining owner call

### The rate-carry version pin — **HARD BLOCKER** (A10)

Confirmed live at branch tip, **not caused by this rework.**

- **Count site:** `revision.py:225` — `frappe.db.count("BoQ Cell Pricing", {"boq": source_boq, "is_current": 1})`,
  no `committed_version` filter.
- **Carry read site:** `cross_boq_carry.py:179-191` resolves the source sheet by `is_current=1` →
  `source_version = src.commit_version`, then `:233-236` calls
  `pricing.get_sheet_pricing(committed_version=ctx.source_version)`, which filters strictly (`pricing.py:666-673`).
- **Why they diverge:** `BoQ Cell Pricing.is_current` is scoped to the full identity **including `committed_version`**
  (`pricing.py:101`), and re-committing a sheet **orphans its pricing onto the now-frozen version** — stated outright
  at `commit_pipeline.py:473-474`, which warns but does not migrate.
- **Result:** a source priced at v1 then re-committed to v2 promises "3 rates" on the mapping screen and carries
  **zero**. Live-observed on `BOQ-26-00023` / sheet `'LMS '`.

**Owner must choose:** align the carry read to `is_current`, **or** keep the pin, make the count match it, and prompt
*"run Copy rates forward on the original first"* (the sanctioned same-BoQ remedy already exists in the Version
ribbon). **Without this, A7's "copied rows get filled rates" fails on day one.**

Settle at the same time: `BoQ Sheet.source_commit_version` is stamped at `commit_overlay.py:138` as a durable
provenance pin and **read nowhere in the entire branch** — `cross_boq_carry.py:150-153` deliberately refuses it. It is
currently write-only. ⚠️ A subagent asked to "verify the defect" once concluded *not confirmed* by grepping that field
name — **the pin is the VALUE, not the field.** Don't repeat that.

**Two earlier open items are now CLOSED by the rule itself:** the rootness guard (a heading inserted above a section
shifts it, so it can't copy anyway) and strict-vs-loose `Copied` (A4 makes them carry together or not at all).

---

## 6. IMPLEMENTATION PLAN

**Repo rule that governs every wave:** *output a written plan before writing any code; never write code in the same
turn as the plan.* Wait for owner review at each wave boundary.

### W0 — ADR-0014 Amendment B (do this FIRST, before any code)

The owner explicitly agreed to an **amendment to ADR-0014**, *not* a new ADR-0015.

1. Amend **D1** (implementation note: order-independence was specified but delivered only pre-POST), **D5**
   (Config Done → Pending), **D6** (entirely — the position key, incl. §3.4's honest framing of the rejected-option
   reinstatement) and **D7** (vocabulary + both-or-neither) **in place**, each with a dated
   `> ## ⚠️ AMENDED 2026-07-20 — owner-directed` block. **Mirror the style of the existing D7 amendment block already
   in that file** — it is the house pattern.
2. Update `frontend/.claude/plans/boq-revised-upload-plan.md` with the W1–W6 slice list below.
3. Commit `docs/boq/revised-boq-carry-amendment.html` and this handoff alongside (synthetic data → safe to commit).

**Gate:** owner affirmation on the ADR diff before W1.

---

### W1 — Matcher + carry `[backend]` · the core

**Files:** `services/boq_revision/row_match.py`, `services/boq_revision/carry.py`,
`api/boq/wizard/review_carry.py`, `doctype/boq_review_row/boq_review_row.json`.

**Shape of the new `row_match`:**

- `MatchRow(row_id, excel_row, description)` — `row_id` stays the caller's opaque identity (original = committed node
  name for the review carry, `source_row_number` for the committed-tier consumer; revised = `row_index`).
- `match_rows(original_rows, revised_rows) -> RowMatchResult` where the result exposes the matched pairing
  **keyed by `excel_row`** plus the original↔revised `row_id` maps the two consumers need.
- Build a dict per side keyed by `excel_row`; **drop any position appearing more than once on either side**
  (§8 hole 2); keep pairs whose `normalize_n2(description)` are equal.
- Blank-description rows never enter (caller already filters; keep the defensive skip).

**Shape of the new `build_review_carry`:** for each matched revised row, resolve the original's `parent_node` → that
node's `excel_row` → require **that** position be matched too → emit `classification` + `parent_index` together, or
emit nothing. Root (`parent_node` NULL) → `parent_index = -1`, condition satisfied trivially.

**Tests:**
- `services/boq_revision/test_row_match.py` — **rewrite**. Cover: exact match; shifted-by-insert; shifted-by-delete;
  in-place text edit; duplicate Excel position on either side; blank descriptions.
- `services/boq_revision/test_carry.py` — **rewrite**, including **deleting**
  `test_pcc_reparented_row_lands_on_twin_new_row_index` and replacing it with its inverse (an inserted row means the
  rows below are **not** carried). Keep `test_level_never_in_the_payload`.
- `api/boq/wizard/test_review_carry.py` — integration over real committed nodes; add a case per HTML scenario 5, 6
  and 8.
- **New fixtures required:** scenarios 4 (in-place edit → 499/500 shape), 6 (inserted heading), 8 (renamed heading →
  condition 3 fires), 10 (the documented hole — assert the known-wrong behaviour so it is pinned, with a comment
  pointing at §8).

**Acceptance:** a non-revision parse is byte-identical (prove with `parse_run` 102 + `review_screen` 260, not by
inspection). `test_carry` no longer asserts the carry beats the parser.

---

### W2 — Review screen `[frontend]`

**Files:** `revisionReviewDelta.ts` (+ its test), `ReviewTree.tsx`, `boqTypes.ts`,
`api/boq/wizard/review_screen.py:1370-1393`.

Per §4.4. The two advisory panels are **deleted**, not adapted. Header shows
*"412 of 500 rows copied from v1 · 88 need review"* with a filter to the 88.

**Acceptance:** upload and template review screens byte-identical (`revision_carry_status` empty on every row → the
whole layer is inert). `tsc` delta 0 in touched files. Existing `revisionReviewDelta` tests rewritten, not deleted
wholesale — the self-clearing behaviour and the Status-ladder precedence mirror still need pinning.

---

### W3 — Entry un-lock `[backend+frontend]`

Per §4.2. New endpoint in `api/boq/wizard/revision.py` (it already owns `assert_revisable_source`, reusable verbatim).
Extract the version computation from `controllers/boqs.py:24-29` into one shared helper so the hook and the endpoint
**cannot drift** — that is the whole risk of this wave.

**Acceptance:** a fresh upload is unchanged end to end. Switch New→Revise→New→Revise after upload and confirm
`boq_name` / `version` / `sheet_drafts` land correctly each time. `test_revision_entry` (17) extended.

---

### W4 — Config → Pending + work-package carry `[backend]`

Per §4.3. Flip the six assertions in `api/boq/wizard/test_column_carry.py` (`:130-136`, `:138-141`, `:143-145`,
`:147-150`, `:269-297`). **`:212-220` survives** if you change only the persisted `wizard_status` and leave
`dispositions[].status` as the diagnosis. `services/boq_revision/test_column_diff.py` is unaffected.

**Acceptance:** a seeded revision sheet opens with the map pre-filled, a work package pre-filled, warnings shown, and
`Mark Config as Done` enabled and un-clicked.

---

### W5 — Reporting `[backend+frontend]`

Per §4.5. Three independent surfaces; ship in any order.

**Acceptance:** the parse-completion modal, the mapping screen and the commit results modal each show a number that
matches what the DB actually did. Verify the mapping-screen count against a live `Copied` count after parse — they
should agree.

---

### W6 — Rate-carry version pin `[backend]` · **blocked on §5**

Whichever way the owner rules, **add a cross-version fixture** to `test_cross_boq_carry.py` and
`test_commit_overlay.py`. Both suites are green today **only because their fixtures are same-version**, which is
exactly why they miss this.

**Acceptance:** the end-to-end AC finally becomes exercisable — carry rates from an original whose pricing sits on an
older committed version than its sheet, and see them land.

---

## 7. Guardrails / invariants to keep

- **Non-revision flows must stay byte-identical.** Every seam is gated on `origin == "revision"`: the parse seam
  (`parse_run.py:873`), the review meta block (`review_screen.py:1370-1375`), the commit overlay's early return
  (`commit_overlay.py:112-114`). Prove it with the regression suites.
- **Write to the parser layer, never the human layer** (§3.5). This is why Apply-AI still works on a carried sheet.
- **`level` is never copied and must never re-enter the matcher** (§4.1).
- **One matcher, three consumers.** ADR-0010 B1 / "one owner". Do not fork.
- **`sheet_name` is matched VERBATIM (#152)** everywhere — trailing/leading spaces exist in real data; `.trim()` only
  for display.
- **Finalize gate stays fully hard and purely structural** (`review_screen.py:2865-2873`, errors #7/#8 + cycles, no
  override path). Do not add a revision condition (A9).
- **PricingGrid stays byte-identical.** The owner declined *any* new cell highlighting for the revised-BoQ work
  (S10/#1106); the existing "Show unpriced" filter is the review surface. Its 143 tests must not move.
- **Residence ratchet:** run `python3 scripts/residence_check.py` from the **app root** (not `frontend/`) before
  committing.
- **Docs discipline:** per-slice as-built detail goes in `frontend/.claude/plans/boq-revised-upload-plan.md` +
  `.claude/context/domain/boq-backend.md` + `frontend/.claude/context/domain/boq-frontend.md`. **Do NOT re-grow
  `CLAUDE.md` with changelog entries** — the `.claude/hooks/guard_claude_md.py` PreToolUse hook will block you.

---

## 8. Known holes — document, don't engineer around

1. **Insert + delete in one span.** A heading inserted at row 10 and a row deleted at row 20 realigns rows 21+ onto
   their original positions, so they copy a parent the new heading should have taken. Requires a net-zero row change
   with a heading among the insertions. Closing it means reintroducing a span scan — the complexity this amendment
   removes. **Pin it with a test that asserts the known-wrong behaviour** so nobody "fixes" it by accident.
2. **Non-unique Excel row numbers.** A synthetic row created during review on the original is committed with its
   `row_index` as its row number (`commit_pipeline.py:207`), which can collide with a real Excel row. Rule: if a
   position appears more than once on either side, skip it. 3 rows live.
3. **Description column set changed.** If the sheet's mapped description columns change, every joined description
   changes and nothing matches — zero carry. Correct, but the config screen must say so *before* the user parses.
4. **Template-origin originals** — no committed header baseline; config lands Pending (as it now always does) and row
   matching works normally. ~8 of 211 sheets.
5. **Excluded rows** — `is_excluded` rows never become committed nodes, so their positions never match.
   Template-origin concern only. 41 rows live.

---

## 9. ⚠️ ENV GOTCHAS

1. **`bench` lives at `/home/frappe/.local/bin/bench`**, not `env/bin/bench`. Container is
   `frappe_docker_devcontainer-frappe-1`.
2. **vitest runs INSIDE the container only.**
3. **`:8080` is live (yarn dev), `:8000` is stale.** Test in the browser on `:8080`.
4. **Pre-existing failures, not yours:** `test_update_sheet_draft` — 3 (legacy fixture).
5. **Ad-hoc DB queries from the host** need `os.chdir` to `sites/` before `frappe.init()` — recipe in root `CLAUDE.md`.
6. **The dev DB has zero `BoQ Row Category` rows**, so category carry is not live-exercisable. Unit-test it.
7. **Test revision `BOQ-26-00203` still exists** on the dev DB; original `BOQ-26-00023` is intact. Their revision xlsx
   remain in the **prod** S3 bucket (`nirmaan-stack-prod-bucket` — the dev bench uses it) as harmless test copies.
8. **chrome-devtools MCP `take_screenshot` / `upload_file` filePath is restricted to the `frontend/` workspace root**,
   not the app root. Save under `frontend/…` then `mv`.
9. **openpyxl round-trip artifacts** when building a synthetic revision for E2E: a numeric header cell `1.0` becomes
   `1` (spurious "header changed" — set it to text); a new column must go past the sheet's declared A–Z universe to
   register as new; the round-trip strips heading formatting, so Preamble headings re-parse as Notes and the finalize
   gate correctly blocks. None are product bugs.

---

## 10. Suite baselines (all green at `d89153e8` — do not regress)

**Revision suites:** `normalize` 10 · `sheet_match` 9 · `row_match` 10 · `carry` 12 · `column_diff` 17 ·
`revision_schema` 15 · `revision_entry` 17 · `revision_mapping` 22 · `review_carry` 10 · `column_carry` 17 ·
`commit_overlay` 18 · `cross_boq_carry` 17.

**Regression:** `commit_pipeline` 54 · `pricing` 185 · `review_screen` 260 · `parse_run` 102 · `classify` 38 ·
`commit_validation` 51 · `create_from_template` 35.

**Frontend:** boq-wizard vitest **590** · `tsc` delta **0** in touched files (≈3771 pre-existing errors live in
unrelated Retired-Components etc. — ignore them, measure the delta).

⚠️ `commit_overlay` (18) and `cross_boq_carry` (17) are **green but use same-version fixtures**, which is exactly why
they miss §5. Add cross-version fixtures in W6.

---

## 11. Context to load FIRST, in this order

1. `docs/boq/revised-boq-carry-amendment.html` — **the spec.** Scenarios 4, 5, 6, 8 and 10 are load-bearing.
2. `docs/adr/0014-boq-revised-upload-and-carry.md` — D1/D5/D6/D7/D9 and the existing D7 amendment block (the style
   your amendment must mirror).
3. `frontend/.claude/plans/boq-revised-upload-plan.md` — slices S1–S11 as-built.
4. `.claude/context/domain/boq-backend.md` + `frontend/.claude/context/domain/boq-frontend.md`.
5. Root `CLAUDE.md` + `frontend/CLAUDE.md` (always-loaded; conventions + owner-locked invariants only).

---

## 12. One-line status for MEMORY

> Revised-BoQ **carry amendment (ADR-0014 Amendment B)** — defect analysis COMPLETE, decisions A1–A10 LOCKED
> 2026-07-20, spec `docs/boq/revised-boq-carry-amendment.html`, plan in this handoff §6. **ADR + all code NOT
> written.** Final rule after 4 owner narrowings: **carry classification + parenting iff same Excel row AND same
> description AND the parent also matches** — a keyed join on `source_row_number`, which is D6's explicitly rejected
> same-file key, deliberately reinstated because D6's yield was bought with correctness. Status = `Copied` or empty
> (renders `Original`); `Copied` ⟺ matched ⟺ rate-eligible. Entry un-locks, config lands `Pending`. **One open owner
> item: the rate-carry version pin (blocker).** Branch `feature/upload-revised-boq` @ `d89153e8`, local/unpushed.
