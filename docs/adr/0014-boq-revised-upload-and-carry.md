# 14. Revised BoQ — upload a revision of an existing BoQ and carry forward what still matches

Date: 2026-07-17

## Status

**Proposed — pending owner (Nitesh) sign-off. No code written.**

Charted and resolved as a wayfinder map:
[#1086](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1086) — nine tickets,
**T1–T8 decision tickets all closed**, this ADR + `frontend/.claude/plans/boq-revised-upload-plan.md` are
T9's close-out. Each decision below carries its ticket link; **the ticket holds the full argument,
the rejected alternatives, and the live-data measurements** — this ADR is the locked summary, not a
replacement for them.

Numbered `0014` (highest tracked is `0013`; the untracked local `0012-crm-stack-unification.md` holds `0012`.
Historical `0002`/`0007`/`0008`/`0009` collisions are **not** renumbered — out of scope).

**Every measurement quoted below is from the local dev bench** (70 BOQs / 554 committed sheets /
41,519 nodes / 506 draft sheets), not production. Where a number is load-bearing this is flagged inline.
See *Consequences → Evidentiary caveat*.

## Context

A BoQ is uploaded once and walked through **Configure → Parse → Review → Finalize → Commit → Price**.
Estimators then receive a **revised workbook** for the same scope — a handful of inserted rows, some
edited quantities, occasionally a new sheet. Today the only path is a fresh upload: every sheet
re-configured, every row re-classified and re-parented by hand, every rate re-typed. The human work that
made the original correct is thrown away because the file changed.

**The destination:** upload the revised workbook against an already-committed BOQ and walk the wizard so
that **only the deltas need human attention** — everything that still matches carries forward.

Three structural facts frame every decision below:

- **Commit is freeze-and-supersede per `(boq, sheet_name)` `commit_version`.** There is no first-class
  "a BOQ has versions" object — `BOQs.version` / `status=Superseded` / `parent_boq` are schema-only or
  retired. A revision therefore cannot be "a new version of the same doc" without inventing that object.
- **Re-parse is destructive.** `parse_run` unconditionally deletes the sheet's `BoQ Review Row`s
  (`parse_run.py:842-844`) — and with them every human classification and parenting edit. Any review-tier
  carry must run *around* this, never before it.
- **The only carry primitive that exists is copy-forward** (`pricing.py` `apply_copy_forward`): rates only,
  version-to-version *within one boq*, matched on exact `source_row_number` + description. It is a
  **same-file** key — one inserted row shifts every row number below it — so it cannot serve a revision.
  Cross-BOQ carry does not exist at all.

`create_from_template._clone_worker` is the closest analog (seed a new BOQ from existing structure) but it
hard-assumes row-identity and name-equality, so it informs the shape without being reusable.

## Decision

### D1 — Entry is a radio on the upload screen; eligibility is "same project + ≥1 committed sheet" ([T1](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1087))

**New | Revise** is a radio in the right pane of `BoqUploadScreen`, **default New**; flipping to Revise
reveals an inline `react-select` of the project's revisable BOQs directly beneath it. The existing
top-level `Upload a BoQ | Create from Template` toggle is **untouched** — Revise is a sub-modifier of the
*Upload* path (it still drops a workbook), while Template is a genuinely different flow (no workbook).

Options render `{boq_name} — v{version}` with muted `uploaded {date}`, **latest-uploaded first**.

**Eligible iff same project AND ≥1 committed sheet.** Partial commit qualifies — an original sheet that was
never committed has no baseline and simply falls through as a *new* sheet in the revision (D4).
Committed-ness has **no field to filter on** (`BOQs.status` never leaves `Draft` in practice), so it is
computed by a backend helper consistent with `get_committed_state`. **Filter, don't grey** — only eligible
BOQs are listed; a project with none disables the radio with a hint.

**Chains are allowed** — a committed revision is itself revisable. Safe by construction (the source must
pre-exist and be committed ⇒ `source_boq` is a strict DAG, no cycles), the carry is depth-agnostic ⇒ zero
new code, and chaining is *better for value-freshness* than forcing a re-revision of the ultimate original.
This **removed "revising a revision" from the map's out-of-scope list.**

Single screen, order-independent: file-drop and original-pick may happen in either order. Continue requires
the existing gates **and** an original selected.

### D2 — A revision is a new `BOQs` doc, and carry is a parse-authoritative overlay ([T2](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1088))

**The spine. Every other decision inherits it.**

A revision is a **new `BOQs` doc** — `origin="revision"`, `source_boq` → the original — *not* a new
commit_version on the same doc. It reuses the existing `boqs.py` `before_insert` version auto-bump by
carrying the **same `boq_name`**, so `version` becomes N+1 for free. The original stays frozen as the diff
baseline; nothing about it is mutated.

**Carry is not one event.** The revision walks the same fixed pipeline, and the carry is an **overlay
slotted into each phase in pipeline order**, with the **revised file authoritative for all structure**
(sheets, columns, rows):

| Phase | What carries | Ticket |
|---|---|---|
| **Config** (pre-parse) | the original's committed column config | D5 / T5 |
| **Review** (post-parse) | classification + parenting *overrides* | D7 / T6 |
| **Commit** (silent overlay) | formulas · remarks · colors · `remark` dismissals · categories | D8 / T8 |
| **Post-commit** (explicit action) | **rates** | D9 / T7 |

**Rejected: seed-clone-then-diff.** Pre-cloning the original creates a *second* row source to reconcile
against a full revised workbook, and fights the destructive re-parse. With an overlay there is exactly
**one** row source: removed rows simply don't appear, new rows appear un-classified, matched rows inherit.

**Carry reads the committed tier only** (`is_current`) — never the original's transient drafts or review
rows. One uniform source; no draft fallback. Provenance is pinned **per sheet** on the revision's committed
`BoQ Sheet` (`source_boq` + `source_commit_version`), so a carried sheet stays auditable and stable even if
the original is re-committed mid-flight. Cell/row-level provenance is **not** stored — it is reconstructible
from the sheet pin plus the D6 key.

### D3 — Sheets pair by N2 + per-side count-guard, confirmed by a human on an always-shown screen ([T4, re-resolved](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1090#issuecomment-re-resolution))

T4's decision #1 was **reopened and re-resolved** after a code + live-data pass. The original framing —
*"a renamed sheet → new+removed, or fuzzy-matched?"* — was **a false binary**: auto-verbatim vs auto-fuzzy.
**A human-confirmed mapping was never on the ballot.** Rejecting fuzzy correctly rules out an *algorithm*
as the pairing authority; it says nothing about a *human*, whose risk profile is different.

**The premise correction that reframed everything: the mapping screen cannot catch a wrong-original pick.**
If the user means to revise *"XORIANT HVAC BOQ **Unpriced**"* but picks *"XORIANT HVAC BOQ"*, the screen
proposes `HVAC ↔ HVAC` and it looks perfect — because **the pairing is genuinely name-correct**. The error
is upstream. ⇒ **two independent failures, two controls, one screen:**

- **F1 — rename/drift** (`'Electrical'` → `'Electrical '`) → **the pairing zone**.
- **F2 — wrong original picked** → **an identity panel**.

**Key = N2-normalized `sheet_name`** (trim + collapse internal whitespace + nbsp/unicode fold +
case-insensitive) — **T3/T5's normalizer verbatim, one home, no fork**. T4 was **the map's lone exact-byte
user on hand-typed Excel text**, while T5 explicitly *rejected* exact-byte for the identical reason.
**#152 (`sheet_name` verbatim) is an ADDRESSING convention** — how you look up a sheet *within one
document*, and it exists precisely *because* stray whitespace is real. Pairing across two separately
uploaded files is a different job and the fragility profile inverts. Live: **12.1% of sheet names (61/506)
carry leading/trailing whitespace**; 21 N2 keys have 2+ variants; and **N2 never over-merges** — 286
verbatim names → 259 N2 keys, all 21 multi-variant keys being pure case/space variants of one name.

**Plus a PER-SIDE count-guard.** The committed tier is provably clean (0 collisions across all 285
`is_current` rows) but **the incoming workbook is draft-shaped and can self-collide**: `BOQ-26-00006` holds
both `'SUMMARY '` (`sheet_order=1`) and `'Summary'` (`sheet_order=3`) as distinct tabs. Guarding only the
committed side would find nothing and pass.

**The screen is ALWAYS shown.** *"Skip it when the auto-pair looks clean"* is **disproven and
anti-correlated with safety**. The reassuring symmetric read (both BOQs eligible ⇒ 0 identical sheet-sets)
is **the wrong model** — the revised workbook is a fresh upload and never needs to be eligible; only the
picked *original* does. The directed surface (X's workbook tabs ∩ Y's *committed* sheets, for every
eligible Y) gives **119 mis-pick combinations: 20 (17%) silently mis-carry ≥1 sheet, 7 mis-carry ≥50%, and
2 are TOTAL mis-carries with zero unmatched sheets to flag** — `BOQ-26-00037`→`00039` carries 100% of the
wrong BOQ and **is live in the picker today**. **The heuristic inverts: an original with FEW committed
sheets is MORE likely to match fully by accident ⇒ "looks clean" means higher risk.**

**Pre-filled, not blank** — this revises the owner's opening full-manual instinct, and he accepted the
argument. **A pre-filled pair is name-identical by construction** (N2 + guard can never propose
`Electrical ↔ HVAC`), so pre-filling **cannot introduce an F1 error**; the only way a pre-filled pair is
wrong is F2, which has its own control. A blank screen's extra "ownership" therefore buys nothing on F1
while costing median **5** dropdowns per revision (mean 7.2, max 38) — the exact shape of work people learn
to click through. **A rubber-stamped screen is worse than no screen: it looks like a control.**

**Strict 1:1**, everything editable, **unmatched = hard stop** (explicitly pick an original *or* declare the
sheet New), and **nothing is written until Confirm — the screen is a staging area and Confirm is where
irreversibility begins**. Read-only "confident" claims were rejected: strict 1:1 + locked pre-fills creates
an **unescapable dead end** (a stale `'Electrical'` tab confidently claims the original, and the real
`'Electrical New'` can never be given it).

**Zone 1 — the F2 control** shows the picked original's identity **plus what will carry**:
*"Revising **XORIANT @ BLR HVAC BOQ** v2 · committed 12-Jun-2026 — 2 committed sheets (Approved Make List,
HVAC). This will carry **1,234 rates** and **89 classifications**."* Restating the choice does **not** catch
a mis-choice — the user picked it 30 seconds ago; the panel must show something they *didn't* see at pick
time and that *differs* between right and wrong original. Both counts are cheap `COUNT`s on the committed
tier — **no parse needed**.

> ⚠️ **F2 is MITIGATED, NOT SOLVED.** It catches the ABB case and one direction of XORIANT.
> **Mis-picking a *richer* original reads as good news, not an alarm.** Residual → fog, logged not papered over.

**The screen sits between upload and hub — forced, not chosen.** The diff is materialized at draft-seeding
and the hub *renders* seeded drafts ⇒ a human-driven mapping means **seeding waits for the human**.

### D4 — Hub sheet-diff: one uniform overlay, no fast-path, human finalize every sheet ([T4 #2–#7](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1090))

*(T4's decisions #2–#7 were untouched by the reopen and stand as originally resolved.)*

- **Every matched sheet walks the same overlay pipeline. There is no direct-clone fast-path and no
  raw-cell hash pre-check.** Rejected because it is **circular** (you cannot know a sheet is unchanged
  without reading its cells, and row-equality is a post-parse job), because a clone would stamp the
  revision's committed grid from the **old** file (violating D2's source-of-truth spine), and because the
  overlay already delivers the only win that matters — **a truly unchanged sheet surfaces zero rows for
  review, so "unchanged = zero human work" falls out for free.** The cost is paid in *compute*, not human
  effort.
- **A matched sheet re-enters at `Config Done`** — config is genuinely carried, but the sheet must
  **re-earn `Parsed` → `Finalized` against the revised file's cells**. Copying the original's `Finalized`
  was rejected: it would mark a sheet commit-eligible with **no parsed content behind it**.
- **Human finalize on every matched sheet — no auto-advance**, even byte-identical zero-delta sheets
  (owner: per-sheet sign-off is an audit norm). **Never auto-commit.**
- **New sheet** → normal fresh treatment. **Removed sheet** → **not carried + hub advisory**; nothing is
  deleted, the original keeps it frozen as baseline. Read-only carry (a phantom sheet with no backing in
  the revised file) and a hard block were both rejected.
- **General-specs** → **carry the designation** (a smart default, re-toggleable), but **`preamble_text`
  always re-extracts** from the revised file. New sheets are never auto-general-specs.

### D5 — Config column-diff: letter key, header text as a guard, everything unsafe → `Pending` + seed ([T5](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1091))

**Two of this ticket's own premises were wrong:**

1. **"Diff against the original's committed `column_role_map`" is impossible.** A role map only knows
   *mapped* columns; unmapped ones are implicitly `ignore`. So "a revised column absent from the role map"
   cannot distinguish *genuinely new* from *always existed, ignored* — it would flag every ignored column
   as new on every revision.
2. **`column_headers` is DEAD DATA — 548/554 committed sheets hold `{}`.** This is **structural, not an
   accident**: `_enrich_column_headers` captures header text **in memory only** and the stored blob is never
   written back, so commit faithfully pins an empty dict.

⇒ **Baseline = the committed GRID.** The column universe *and* the real header text both come from
`BoQ Committed Sheet Grid Row.cells` at `row_number == header_row`; the committed `column_role_map` layers
roles on top. **`column_headers` is not used anywhere in this design** — header text is recoverable, just
not from the field named for it.

**Match key = the Excel LETTER. Header text is a GUARD, never a key. The T3 symmetry inverts — do not
mirror it:**

| | Rows (D6) | Columns (D5) |
|---|---|---|
| Position stability | shifts constantly (the point of a revision) | rarely moves (same workbook, edited) |
| Content quality | `description` — rich, near-unique | header text — **69%** of sheets have ≥1 blank mapped header, **35%** have duplicates |

Position is a *good* key for columns and a bad one for rows; content is the reverse. **Guard-not-key is what
makes the 35%-duplicate hazard irrelevant** — the hazard only bites if you look *up* by text; compared
positionally ("does the text at `C` still agree?") duplicates are harmless. Blank headers degrade the
guard's *coverage*, never its *correctness*.

**Guard scope = the FULL header row** (mapped *and* unmapped), blanks silent, **N2 verbatim**. Mapped-only
was rejected: with 69% of sheets carrying a blank mapped header it goes quiet exactly where it is needed.
Accepted cost: a renamed *unmapped* column raises a false positive → one config screen the human confirms —
cheap versus a missed shift, which silently corrupts the whole revision.

| Condition | Outcome |
|---|---|
| Guard mismatch (shift / mid-sheet insert or delete) | **`Pending` + seed** — *carve-out from D4* |
| New column (appended) | **`Pending` + seed** |
| Removed **mapped** column | **`Pending` + seed**, dangling role **flagged** |
| Removed **unmapped** column | silent no-op |
| Structurally clean | **`Config Done`**, no prompt |

**The seed is ALWAYS the original's rectified role map — never a fresh auto-guess.** We cannot distinguish
a true shift from a false positive, so we optimise for not destroying human work. Auto-guess **provably
cannot** reproduce a rectified config: `_auto_guess.py` keeps its **own** `_SINGLETON_ROLES` copy that
wrongly **includes `description`**, so it can never map a second description column.

**Removed-mapped flags, never auto-clears** — matching the codebase's stated stance
(`SheetConfigPanel.tsx:695-699`). A silent drop has **no server backstop**: `parserRequiredSatisfied` is
client-only and `set_sheet_status` never reads `sheet_config`.

**Role change on a matched column is UNDETECTABLE by construction** (same letter + same text = zero signal)
⇒ user-initiated only; a structurally clean sheet gets **no prompt** (a nudge on every matched sheet fires
on provably-clean sheets ⇒ wallpaper, violating the codebase's no-cry-wolf stance).

**T3 coupling:** changing the description-column set away from the carried one raises a **config-time
warning** naming the cost. Blast radius is **partial, not total** — `_description_parts` skips blank cells,
so an added column that is blank on a row leaves that row's join unchanged.

### D6 — Row match key: parser-symmetric content; the human-rectified path is the payload, not the key ([T3](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1089))

**The core reframe.** Match rows on **parser-symmetric** content and carry the human's corrections as an
overlay re-applied *through* the match map.

**Why the framed options fail:**
- **`source_row_number` + description** (today's copy-forward key) is the **same-file** key — one inserted
  row shifts everything below ⇒ mass non-match ⇒ defeats the feature's whole point.
- **description + _rectified_ ancestor-path** is **self-defeating**: the original's path is human-rectified,
  the revised side's is raw parser output, and the parser repeats its mistakes on the same content — so a
  row the human re-parented **never matches**, and we fail to carry precisely the most valuable human work.

**Parenting carries relationally.** The only human contribution is the *override set*; everything else is
the parser's `parent_index`, which the revised parse reproduces for free. Carry = **follow the pointer →
match the target row → re-point to the twin's `row_index`** — a foreign-key remap, **not** an index copy.
*Worked example:* the parser puts "PCC 1:4:8 backfill" under Section B; the human re-parents it to Section A.
The revised parse repeats the mistake (B again). Relational carry matches PCC↔PCC and Section A↔Section A,
then re-points the revision's PCC override to Section A's **new** `row_index`. The correction survives and
the human never touches it again.

**Key = N2-normalized joined `description`, description-primary, with the nearest preceding shallower-`level`
section header as the duplicate tiebreak, count-guarded:**

| case | outcome |
|---|---|
| **N=1, M=1** | **MATCHED** — section ignored (forced pairing ⇒ rename-proof) |
| **N=M>1** | disambiguate by section header then physical ordinal; else **AMBIGUOUS** |
| **N≠M** | whole group **AMBIGUOUS** |
| N>0, M=0 | **REMOVED** |
| N=0, M>0 | **NEW** |

*Why section is relaxed at N=M=1:* it is dropped **only** when the description is globally unique on both
sides, so exactly one candidate exists each way — the pairing is forced, no collision is possible, **no
added false-match risk** — and it rescues the common cosmetic **section rename** that a strict composite
would dump into review wholesale.

*Why the nearest header, not the full chain:* a typo-fix on any ancestor would non-match its whole subtree.
Both inputs (physical order + **parser** `level`) are parser-native and human-edit-immune — a row moved
*logically* B→A still sits **physically** under B on both sides.

**N2 folds only provably meaning-preserving noise.** Not punctuation or synonyms — mix ratios (`1:4:8`) and
dimensions (`100mm` vs `100 mm`) are semantic, so a difference is a real edit → review. **No fuzzy tier in
v1**: fuzzy similarity is exactly what silently carries a wrong rate.

**Four outcomes, no fuzzy: MATCHED / NEW / REMOVED / AMBIGUOUS.**

### D7 — Review carry: the override set only, at a post-parse merge seam ([T6](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1092))

**Two more premise corrections:**

- **`node_type` is the WRONG carry field** — a lossy 3-value projection. Proven arithmetically on live data:
  `Other` (10,294) = `note` (9,307) + `subtotal_marker` (977) + `header_repeat` (10). The full taxonomy
  survives on **`row_class`** ⇒ **the carry reads `row_class`, never `node_type`.**
- **Category cannot carry in review — there is no landing field.** `BoQ Review Row` has no
  category/discipline column (verified live). Category is a **committed-tier** overlay ⇒ **re-homed to D8.**

**Carry the override set only** — exactly as D6 locked for parenting. Live: only **12%** of 19,502 current
nodes carry a `human_classification`, 13% a `human_parent` ⇒ **~87% of rows need nothing carried**; the
revision's own parse reproduces the parser layer for free.

**Wholesale-stamping the effective value was rejected** on three counts: it flips `_row_has_override` true
everywhere, so `_guard_row_at_parser_baseline` would **block the AI flow on every matched row**; it renders
a zero-delta sheet 100% "Edited" — the exact opposite of D4's "unchanged = zero human work"; and it
attributes to a human what the parser decided.

| carry | source (committed `BOQ Nodes`) | write (revision `BoQ Review Row`) |
|---|---|---|
| classification override | `human_classification` (non-blank only) | `human_classification` |
| parent override | `human_parent >= 0` ⇒ `parent_node` → parent's `source_row_number` → D6 twin → twin's `row_index` | `human_parent` |
| root override | `human_is_root = 1` (`parent_node IS NULL`) | `human_is_root = 1`, `human_parent = -1` |

**Load-bearing:** re-point via `parent_node`, **never `sort_order`** (which is the *original's* `row_index`
— a trap). Write **`-1`** explicitly for no-override (Frappe coerces Int `None`→`0`, and `0` is a valid
`row_index`). **Root ≠ no-parent.** **Do NOT carry `level`** — ADR-0009 makes it a function of the effective
tree; re-derive, or the `BOQ Nodes` controller's throws fire.

**The seam:** inside `run_parse_worker`'s per-sheet `try`, **after** the review-row insert loop and
**before** `_set_draft_status("Parsed")`. Same transaction as the existing compensating delete; final
`row_index`es exist for the relational re-point; the human never observes an un-merged state. **This is why
carry cannot be pre-seeded** — re-parse's unconditional delete annihilates anything written before it.

**Delta surfacing: carried rows get NO treatment.** ~90% of rows carry; marking them paints the sheet and
the rows that matter stop standing out. **Carried = the calm default.** This is also forced by the channel
inventory — backgrounds (green=edited, indigo=Claude, violet=Gemini, amber=flash, muted=preamble),
rings=search, left-border=Gemini, opacity=excluded are **all already taken**. Only **New / Ambiguous /
Drifted** are marked, in the **existing Status column** — no new anchor, no new column.

**Needs-action = `revision_carry_status in (New, Ambiguous, Drifted) AND NOT isEdited`** — **self-clearing**
(CL-6's pattern; do not add clearing code). The panel reuses the **R4 warnings-panel** shape verbatim, with
the removed-row advisory as a muted non-clickable line.

**Finalize stays ADVISORY — no second gate.** D4's human finalize click *is* the sign-off;
`structural_errors_for_sheet` remains the only hard backstop. Accepted cost: a human *can* finalize without
opening a new row.

**Parser drift is surfaced** — the hole override-only opens. On a MATCHED row with **no** carried override,
if the original's effective `row_class` differs from the revision's fresh parser `classification` ⇒
**`Drifted`** ⇒ needs-action. Rejected: force-carrying effective there — it would silently override the
revised parse exactly where the file context changed, i.e. where the new parse is most likely **right**.

**Measured holes** (committed-only source), documented not designed around: **11** `spacer` overrides
(grid-only ⇒ no node), **3** synthetic rows, **41** `is_excluded` rows.

### D8 — Annotation/formula/category carry: the re-arm taxonomy IS the carry taxonomy ([T8](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1094))

**The carry taxonomy is not a matter of taste — the code already encodes it.** `_rearm_*` encodes *what a
rate edit invalidates*. A revision is the **maximal value change** — a whole new workbook. Therefore:

> **Carry exactly what the system exempts from re-arm. Never carry what it re-arms.**

| Layer | Carries? | Why (from the code, not taste) |
|---|---|---|
| **Amount Formula** | ✅ | a *declaration*, not a condition (+ forced by D9) |
| **Remark** | ✅ | explicitly excluded from `_DISMISSAL_REARM_KINDS` because it *"survives a rate edit"* |
| **Dismissal, kind `remark`** | ✅ | same exclusion |
| **Color** | ✅ | never re-armed at all; pure visual, no condition behind it |
| **Dismissal — `needs_rate`/`qty_anomaly`/`broken`/`not_yet`** | ❌ | acknowledgments of **computed** conditions a revision recomputes |
| **Reconciliation Choice** | ❌ | a decision about a divergence between *document* and *formula* amounts; a revision replaces the document amounts wholesale ⇒ carrying `keep_document` pins a decision about numbers that no longer exist |

**T8's "ordering is load-bearing" question is DISSOLVED, not answered** — everything carried is re-arm-exempt
⇒ D9's rate carry cannot clobber it ⇒ ordering stops mattering. Carrying the re-armed set would be
self-defeating anyway: a carried rate lands via `_write_cell_price_record`, which re-arms those very
dismissals on that same row, and since the read path returns only `is_current=1`, **the carried record would
vanish moments after arriving.**

**Three ticket premises were wrong.** (a) The layers are **not one key** — they are **three addressing
families**: row-addressed (Remark, Dismissal → **D6 only**), cell-addressed-by-letter (Color, Recon →
**D6 × D5**), and logical-axis (**Formula → neither**). (b) The no-schema premise is true but the inference
incomplete — there is **zero provenance on any layer** (Remark/Color/Formula lack even a `_by` field).
(c) The re-arm claim is **half wrong** — dismissal re-arm is unconditional, **recon-choice re-arm is
surgical** (it walks the amount column's formula token-tree and frequently re-arms zero), and **"re-arm" =
freeze (`is_current=0`), never delete**.

**Formulas don't follow columns — D9's handoff question was malformed.** A formula's identity is the
**logical axis** `(target_value_field, target_value_key, target_rate_subkey)` — **no `excel_row`, no
`col_letter`**. `target_col` is a **guard-never-key** (the same shape D5 found for header text), and
`target_value_key`'s **nullability IS the wildcard/override discriminator**. ⇒ **the D5 coupling runs
through `column_role_map`, not letters**, and since D5 seeds the original's rectified role map, **the axis
re-resolves for free — a role SWAP is correct for free, where a letter key would have failed.** Carry =
re-validate against the **destination's** committed amount descriptors via `_formula_target_matches_column`;
no match → **drop silently** (D5's config gate already flagged it); an uncovered destination amount column →
**gate fails, user declares** (fail-closed).

**Category: T6 re-homed it on a void premise.** T6's "12%" is `BOQ Nodes.human_classification` (real, and
it correctly grounds T6's *own* design) — but the layer re-homed here is
**`BoQ Row Category.human_category_id` = 0 rows.** Different field, different doctype. **There is no human
category work to preserve.**

**Decided: carry the whole category layer (machine + human), no re-classify.** D6's match key **is** the N2
description and the AI feed is description/ancestor_chain/notes only ⇒ **a MATCHED row would classify
identically** ⇒ re-running Opus re-derives a **provably identical** answer — against ~$6 for the largest
BOQ and a **600s worker timeout** the largest live sheet already brushes (939 eligible rows = 47 sequential
calls ≈ 565s) **with all-or-nothing persist**. **Carry PRESERVES THE FIELD SPLIT** — machine → machine,
human → human, via a `write_row_categories`-shaped INSERT, **never** `set_human_verdict` (collapsing a
carried machine label into `human_category_id` would replicate the freeze bug inside carry). **NEW rows
land blank** → CL-6's amber + Check-Category filter; **no auto-classify**. `hasRun` resolves itself.

**Timing: money needs a confirmed action; everything else rides the commit overlay.** This generalizes D9's
own rationale — it rejected ambient auto-carry *only* because it would be "a silent bulk **money** write",
and separately conceded "a formula is a declaration, not money". That objection has no force against a
formula, a remark, a colour or a label.

| Rides D2's commit overlay (silent, no confirm) | Explicit hub-footer action (D9) |
|---|---|
| Amount Formula · Remark · Color · `remark` dismissal · Category | **Rates only** |

**A committed revision is therefore fully annotated, categorised and formula-complete on arrival. The one
deliberate act left is pulling the money across.** **Bonus: this retires D9's near-feature-killer by
construction** — formulas land before `_sheet_formulas_complete` is ever evaluated.

**The dormant `description` guard stays dormant.** `BoQ Row Category.description` is documented as a guard
for *"a future copy-forward slice"* — it **names this exact slice** — but it is write-only with zero readers,
and **D6's N2 key subsumes it**: an exact guard fires only on N2-equivalent-but-not-byte-identical text
(pure noise), and N2-normalizing it makes it tautological.

### D9 — Cross-BOQ rate carry: carry-all, whole-BOQ, one explicit post-commit action ([T7](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1093))

**Headline: this is not net-new plumbing — it is the commit pipeline's long-job pattern pointed at rates.**
`BoQ Cell Pricing` needs **no migration**: `boq` is already in its 5-part identity, so destination records
land correctly as-is. Only the API surface and UX are new.

**Shape: carry-all, whole BOQ, one explicit user action, post-commit** — reading the owner's *"after commit
the user can copy all the values"* literally. Rejected: **per-sheet mirror** (a 9-sheet revision = 9 trips);
**ambient auto-carry at commit** (a silent bulk money write, breaking the invariant that every rate write
goes through the single-editor lock + an explicit user action).

Whole-BOQ scoping **does not exist today** (`CopyForwardDialog` is hard-scoped to one sheet) and is the one
genuinely new dimension. Build it as **a loop over the per-sheet plan with per-sheet failure isolation** —
*not* one giant transaction — reusing the commit pipeline's precedent (per-sheet isolation + a
`{carried, failed}` results modal) and the `parse_run` long-job scaffolding (worker + `boq:` socket
done-event + on-mount recovery + reconnect self-heal).

**Decision identity is destination-keyed** — `(dest_excel_row, area, rate_kind)`. Cross-BOQ the source and
destination `excel_row` **differ** (D6 matches on description, not row number), so the plan entry carries
**both**. Safe by construction: D6's MATCHED is 1:1, so two source rows can never target one dest cell.
The `(area, rate_kind)` re-resolution is **verified true** (`pricing.py:2594` — the source cell's own
`col_letter` is *never* a write target) and **survives cross-BOQ unchanged**; it is orthogonal to D5
(letter-key governs *config* carry; `(area, rate_kind)` governs *rate-column re-resolution at price time*).

**Skip taxonomy: `non_match` splits.** Today it conflates *"gone"* with *"can't tell"*, which cross-BOQ
demand **different human responses** (removed → ignore, correct; ambiguous → go price it by hand):

| reason | meaning |
|---|---|
| `removed` | D6 `REMOVED` — source row has no twin |
| `ambiguous` | D6 `AMBIGUOUS` — **new slot** |
| `no_rate_column` | `(area, rate_kind)` unresolvable in the revision |
| `non_priceable` | dest node fails `_node_priceable_without_override` |
| `invalid` | apply-time only |

**NEW rows never enter the plan** (they have no source rate, and the plan stays **source-driven**) — **the
grid is their review surface**, reusing CL-6's amber attention-fill + filter verbatim, with a count in the
results modal (*"150 carried · 11 rows need new values"*). Rejected: listing them in the dialog (mixes
*"what I can carry"* with *"what you must type"* in a table whose checkboxes imply action).

**Lock: destination-only, per-sheet.** The source is read-only ⇒ never lock it. A sheet whose lock is held
**fails in isolation** and is reported — it does not abort the batch. **Classification freeze does NOT gate
this** (owner-locked: it is deliberately not ORed into the pricing gate).

**Conflicts keep today's model** (default keep, per-cell toggle, bulk overwrite/keep) — a near-non-case on a
first carry into a fresh revision, but **re-carry after edits is real**.

**Must-fix:** the `from_version == current_version` guard (`pricing.py:2506`) throws *"The selected version
is already the current version"* — **two different BOQs can legitimately both be at v1, so this rejects the
single most common cross-BOQ case.** It must become **`(boq, version)`-pair aware**.

**Entry = a hub footer action** (*"Carry rates from original"*), beside Commit / Tender. Net-new: today's
launch point **does not exist** — `VersionRibbon` returns `null` below 2 versions and its copy-forward
button renders only in read-only history mode, so a fresh revision at v1 has neither. The hub already owns
every whole-BOQ action, and the shipped SheetCard rule (stage ③ read-only; Commit + Tender footer-only)
makes a footer action the existing pattern. **Visibility:** `origin == "revision"` AND `source_boq` set AND
≥1 committed sheet.

### New schema — 7 fields across 4 doctypes (all additive, nullable, inert for existing flows)

| Doctype | Field | Type | From |
|---|---|---|---|
| `BOQs` | `origin` | Select — **add `revision`** to `upload\ntemplate` | D2 |
| `BOQs` | `source_boq` | Link → BOQs (model on the existing `source_template`) | D2 |
| `BoQ Sheet Draft` | `source_sheet_name` | Data, nullable, **write-once** | D3 |
| `BoQ Sheet` | `source_boq` | Link → BOQs | D2 |
| `BoQ Sheet` | `source_commit_version` | Int | D2 |
| `BoQ Sheet` | `source_sheet_name` | Data, nullable, **write-once** | D3 |
| `BoQ Review Row` | `revision_carry_status` | Select: *(blank)*/`Matched`/`New`/`Ambiguous`/`Drifted` | D7 |

**D5, D8 and D9 add none.** `BoQ Cell Pricing` + the four annotation layers + `BoQ Row Category` all already
carry `boq` in their identity tuples, so cross-BOQ writes need no migration.

**Why `source_sheet_name` is not avoidable** (D3): the zero-schema alternative — **rename-on-ingest** —
**breaks the parser**. `upload_file` seeds drafts with the raw openpyxl tab name; `parse_run:214-215` feeds
the **stored** name into `SheetConfig`; and `reader.py` does `self._wb_values[sheet_name]` at **six** sites —
openpyxl indexed **by name**. Store `'Electrical'` while the file's tab is `'Electrical Rev2'` ⇒ **`KeyError`**.
To rename on ingest you must store the true tab name anyway — i.e. the field you were avoiding. The only
no-new-field variant (overloading the de-facto-dead `sheet_label`) makes **`sheet_name` stop meaning "the
file's tab"** — the identity the whole subsystem joins on across ~30 sites — and promotes a *display* field
to **file-I/O-critical**. **"No new field" is a false economy.**

**Write-once, and irreversibility makes it SAFER, not weaker:** stamped once at seeding, never mutated,
never migrated, no drift. **Escape hatch = delete + re-upload** (a revision is a fresh `BOQs` doc — cheap and
clean). **No remap affordance** — a remap would silently invalidate carried config.

## Consequences

**What gets better**
- A revision surfaces **only its deltas**. A truly unchanged sheet needs one finalize click and nothing else
  — that falls out of the overlay for free, with no fast-path to maintain.
- **~87% of rows carry nothing and need nothing** — the parser reproduces its own layer; only the human's
  corrections move, and they move *relationally*, so re-parenting survives row shifts.
- A committed revision arrives **fully annotated, categorised and formula-complete**; the one deliberate act
  left is pulling the money across.
- **One normalizer (N2) across rows, sheets and headers** — one home, no fork.

**What it costs**
- **Compute, not human effort:** every matched sheet is re-parsed and re-committed even if byte-identical
  (D4's accepted price for having no fast-path).
- **One extra screen per revision** (D3), always — deliberately, because the conditional version is
  anti-correlated with safety.
- **`sheet_name` gains a cross-doc sibling.** ~30 existing join sites are **untouched** — they join *within*
  one BOQs doc and keep using the revision's own verbatim name ⇒ **#152 is not violated**; N2 only ever
  *proposes* the cross-doc pairing.
- **F2 (wrong original) is mitigated, not solved.** 20 of 119 directed combos still silently mis-carry ≥1
  sheet; mis-picking a *richer* original still reads as good news.
- **N2 slightly widens the mis-pick surface** — `'MAKE LIST'`/`'Make List '` across *different* BOQs now pair
  where exact-byte didn't. The two axes fix different failures and pull opposite on one: the **key** fixes
  carry-loss (silent, **guaranteed** — needs no error, just a trailing space); the **screen** fixes mis-carry
  (needs a human mis-pick, but is catastrophic). **Ship both.**
- **A human can still finalize without opening a new row** (D7's advisory-only stance).

**Blast radius on the existing codebase: mechanical, not decisional.** T3/T5/T6/T7 are all cross-BOQ reads
that already need the source sheet identity threaded in; they only implicitly pass `sheet_name` because the
original T4 assumed both sides share it. Under a mapping they pass `source_sheet_name` — **one parameter,
same call shape. No downstream decision is overturned.**

**Evidentiary caveat (load-bearing).** Every number in this ADR is from the **local dev bench**. Two classes
of finding differ in strength:
- **Structural findings hold regardless** — `column_headers` being dead has **no writer anywhere**; the
  `node_type`→`row_class` projection is arithmetic; the formula identity is the code's own unique key.
- **Distributions are dev-only and were load-bearing** — the 69%/35% header quality (D5's key choice), the
  12.1% whitespace + 119 mis-pick combos (D3), and **every "zero rows" count in D8** (Recon 0, Dismissal 0,
  Row Category 0, Remark 1, Color 4, Formula 32/all-wildcard; 45 priced cells vs 31,225 priceable nodes =
  **0.14%**; `classification_frozen` **0/554** — freeze has never been used). Pricing and classification are
  recently shipped, so "zero here" is weaker evidence than for a mature feature. **Confirm prod counts before
  building the D8 annotation carry** — it is cheap and it is the one thing that could reshape a slice.

**The contested founding premise is now irrelevant.** T4 originally rested on *"estimators do not rename
sheets across a revision"* (Nitesh's). Live: there are **zero genuine revisions in the database** — the three
chains that superficially look like revisions were the same file uploaded twice, 86s/85s/31s apart. The claim
is **neither confirmed nor falsified — and this design no longer depends on it**, which is the point. A cheap
honest test if ever wanted: log sheet-name sets on the first N real revision uploads.

## Considered and rejected (the load-bearing ones)

| Rejected | Why |
|---|---|
| Revision = a new commit_version on the same `BOQs` doc | No first-class "BOQ has versions" object exists; the original must stay frozen as the diff baseline |
| Seed-clone-then-diff (create-from-template's shape) | Creates a second row source to reconcile, and fights the destructive re-parse |
| Direct-clone fast-path for unchanged sheets | Circular (can't know it's unchanged without reading cells); would stamp the grid from the **old** file; the overlay already delivers the win |
| Copying the original's `Finalized` status | Marks a sheet commit-eligible with no parsed content behind it |
| `source_row_number` + description as the row key | The same-file key — one inserted row shifts everything below ⇒ mass non-match |
| description + rectified ancestor-path | Self-defeating — the rectified row is exactly the one that never matches |
| Fuzzy row matching in v1 | Fuzzy similarity is exactly what silently carries a wrong rate |
| Fuzzy sheet-name suggestions | Anchors the human toward a plausible-but-wrong pair — lands on the exact failure the screen exists to prevent |
| Exact-byte sheet pairing | Excel tab names are hand-typed; 12.1% carry stray whitespace; T5 rejected exact-byte for the identical reason |
| Confirm screen only when the auto-pair is unclean | Disproven — **anti-correlated with safety**; the 2 total mis-carries have zero unmatched sheets to flag |
| Blank (full-manual) pairing screen | A pre-filled pair is name-identical by construction ⇒ can't be F1-wrong; blank buys nothing and costs median-5 dropdowns = click-through |
| Locking confident pre-fills | Strict 1:1 + read-only claims = an unescapable dead end |
| Rename-on-ingest (to avoid `source_sheet_name`) | **Breaks the parser** — openpyxl is indexed by name at 6 sites ⇒ `KeyError` |
| Header text as the column *key* | 69% blank / 35% duplicate; guard-not-key makes the duplicate hazard irrelevant |
| Seeding config from a fresh auto-guess | `_auto_guess` **provably cannot** reproduce a rectified config (its own `_SINGLETON_ROLES` wrongly includes `description`) |
| Auto-clearing a dangling role | The codebase's stated stance is flag-never-clear; a silent drop has **no server backstop** |
| Wholesale-stamping effective classification | Blocks the AI flow on every matched row; renders a zero-delta sheet 100% "Edited"; attributes to a human what the parser decided |
| Carrying `node_type` | A lossy 3-value projection — flattens `note`/`subtotal_marker`/`header_repeat` into one |
| Carrying `level` | ADR-0009 — it's a function of the effective tree; the `BOQ Nodes` controller throws |
| Marking carried rows | ~90% of rows carry ⇒ paints the sheet; and every colour channel is already taken |
| A second finalize gate for new rows | D4's finalize click is already the sign-off; would need a per-row acknowledge affordance |
| Force-carrying effective on drifted rows | Would override the revised parse exactly where the new parse is most likely right |
| Carrying computed dismissals / recon choices | They acknowledge conditions a revision recomputes — and D9's own rate carry re-arms them on arrival |
| Re-classifying the revision from scratch | A MATCHED row has an identical description + AI feed ⇒ provably identical answer, for ~$6 and a 600s timeout |
| Collapsing carried machine labels into `human_category_id` | Would replicate the freeze bug (#1096) inside carry |
| Ambient auto-carry of rates at commit | A silent bulk **money** write; breaks the lock + explicit-action invariant |
| Per-sheet rate carry | A 9-sheet revision = 9 trips, and it needs a new entry point anyway |
| Folding formula carry into D9's pass | Couples a declaration write to a money write in one endpoint |

## Deferred (documented, not built in v1)

1. **Near-match / "looks like original row 24"** (D6/D7). The typo case (`IP42` → `IP-42`) is REMOVED + NEW
   under the locked key, so the human redoes work they already did. D6 proved the fuzzy tier **layers on
   without changing the key** ⇒ additive later with zero rework. **Must be human-confirmed, never
   auto-applied.**
2. **Fuzzy suggestions in the unmatched-sheet dropdown** (D3). Sheets are median 5 / max 38 with meaningful
   names — a human reading `'Electrical Rev2'` against a list containing `'Electrical'` needs no algorithm,
   and fuzzy's anchoring cost lands on the exact failure being prevented.
3. **Prod count confirmation for the D8 annotation carry** — see the evidentiary caveat.
4. **Prod sanity check of D5's header-quality distributions** (69% / 35%) — dev-only, and load-bearing for
   the letter-key + full-row-guard choices.

## Fog (in scope, not yet specifiable)

- **Concurrency** — the original edited / re-committed while a revision is in flight; two people revising the
  same original. D2's `source_commit_version` pin fixes *audit and stability*, not the *UX* of "the original
  changed under you". D9 settled the carry path (destination-only lock, per-sheet, isolated failure).
- **Canonical/latest marker for revision chains** (opened by D1 allowing chains). The picker lists ancestor
  and descendant revisions with no is-latest hint; latest-first ordering is the v1 mitigation.
- **Wrong-original mis-pick hardening beyond Zone 1** (the F2 residual). What would actually close it is
  unclear — scope/discipline signal? a diff preview? a carry dry-run? — hence fog, not a ticket.

## Out of scope (ruled beyond this effort)

- **Auto-superseding the original** (wiring `BOQs.status=Superseded` / an is-latest flag).
- **Freeze banks MACHINE verdicts as permanent human ground truth**
  ([#1096](https://github.com/Nirmaan-app/nirmaan_stack_frappe15_postgres_14/issues/1096), surfaced by T8).
  `freeze_classification` filters on `effective_category_id` non-blank — **not "a human touched it"** — so one
  Freeze click stamps every *machine* auto-accepted verdict into `human_category_id` and banks it as permanent
  ground truth, while `stamp_human_verdicts_bulk` **overwrites the real reviewer's identity and timestamp**;
  `unfreeze` reverts none of it. A classifier evaluated against its own auto-accepted output scores itself
  correct by construction. **This indicts freeze, not carry** — carry only *duplicates* labels (D6's key
  guarantees the same text ⇒ a duplicate, **not a lie**); freeze is what *falsifies* them, and D8's field-split
  rule means carry does not replicate it. Exists today **with zero revisions in the world**; needs an owner
  call on what Freeze was *intended* to bank.
- **The 600s classify timeout + all-or-nothing persist** — bites the original's first classify identically, so
  not a revision problem.
- **Orphaned formula data** (BOQs `00058`/`00060`/`00069`/`00080`, sheet `'Lock Fix '`) — lock-test fixture
  leftovers, unreachable from a real pricing screen. Data hygiene, not design.
- **The three diverging role-vocabulary copies** (`config.py` 22 roles / `_auto_guess.py`'s own
  `_SINGLETON_ROLES` / `SheetConfigPanel.tsx`'s 21-role mirror) — a **pre-existing defect** D5 **routes
  around** (by never seeding from auto-guess) rather than fixes.
