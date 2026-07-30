# WBC-S6c — the structural carve of both `CLAUDE.md` files

**Date:** 2026-07-30 · **Tier:** Full · **Branch:** `feature/boq-within-boq-carry`
**Supersedes:** `WBC-S6b-correct-and-prune` — byte-by-byte pruning to buy room for
corrections. S6b was not wrong; it was working at the wrong altitude. The carve
removes the need for it.

---

## Why this slice exists

S6b hit a wall that was not a budget problem but a **design** problem. Recorded in
the S6 fragment as F9, and worth restating because it is the whole justification:

> The size guard allowed a write iff `projected <= current`, computed per tool
> call. So a prune and a correction only offset each other when they sit in ONE
> contiguous span. For backlog #2 — the carried-verdict cue in
> `frontend/CLAUDE.md` — the best achievable after losslessly tightening both
> carry bullets, dropping the optional F1 note and maximally compressing the new
> text was **+133 B over a 3,329 B span**. Nothing in that span is duplicated
> anywhere in the repo (0/30 lines). Closing the last 133 B would have meant
> paraphrasing owner rationale prose. No edit was attempted.

That is the process working correctly and the guard punishing it. Two root causes
sat underneath:

1. **The ceilings were targets, enforced as invariants.** When the guard was
   installed, `frontend/CLAUDE.md` was already 104,028 B against a 40,000 B
   ceiling (2.6x) and `CLAUDE.md` was 63,829 B (1.6x). Both files were born
   non-compliant, so the only permitted operation was "shrink" — and because a
   correction usually ADDS bytes, the documents were frozen in a state known to
   be wrong. Being over budget must not mean being unable to tell the truth.
2. **`CLAUDE.md` got a ceiling but never got a rotation rule.** The two documents
   that were fixed before this — `boq-frontend.md` (287 KB → 10 surface files) and
   `boq-upload-plan.md` (1.29 MB → trunk + fragments + registers) — each got a
   *partition axis*. `CLAUDE.md` got only a number. A ceiling without a rotation
   rule is a wall, not a policy.

`CLAUDE.md` cannot be carved the way `boq-frontend.md` was, because its whole
value is being **auto-loaded**. Split it into ten peers and nothing reads them. So
it takes the shape the delivery skill already uses on itself: `SKILL.md` is 88
lines routing to nine references. `CLAUDE.md` becomes a router.

---

## What changed

### The carve

| File | Before | After | Ratio |
|---|---|---|---|
| `frontend/CLAUDE.md` | 105,817 B | **16,301 B** router | 6.5x smaller |
| `CLAUDE.md` | 71,995 B | **19,048 B** router | 3.8x smaller |
| **auto-loaded total** | **177,812 B** | **35,349 B** | **5.0x — ~35,600 tokens per session** |

147,900 B moved to eleven on-demand surfaces:

| New file | Bytes |
|---|---|
| `frontend/.claude/context/conventions/frontend-pricing-editor.md` | 41,173 |
| `frontend/.claude/context/conventions/frontend-pricing-module.md` | 23,824 |
| `frontend/.claude/context/conventions/frontend-gotchas.md` | 14,228 |
| `frontend/.claude/context/conventions/frontend-rate-master.md` | 6,792 |
| `frontend/.claude/context/conventions/frontend-wizard.md` | 3,416 |
| `frontend/.claude/context/conventions/frontend-review-invariants.md` | 3,251 |
| `.claude/context/conventions/backend-active-features.md` | 37,687 |
| `.claude/context/conventions/backend-rate-master.md` | 6,829 |
| `.claude/context/conventions/backend-domain-gotchas.md` | 4,303 |
| `.claude/context/conventions/backend-pricing-module.md` | 3,919 |
| `.claude/context/conventions/backend-rate-suggestion.md` | 2,478 |

**Method — structural, never regex on content.** Phase 1 learned this the
expensive way, when a regex classifier filed eight slice records as design
records because their headings looked like design headings. Sections here were
located by heading level and byte span, each span ending at "the next heading at
the same or a shallower level".

**Losslessness — verified, not asserted.** Independently of the migration
script, every non-blank line of `git show HEAD:CLAUDE.md` and
`git show HEAD:frontend/CLAUDE.md` was confirmed present in either the new router
or exactly one destination file. **954 + 359 content lines, 0 lost.**

A byte-accounting bug was caught mid-run and fixed before apply: the script
reported `len(str)` while the guard measures UTF-8 **bytes**, and these documents
are full of em-dashes, arrows and warning glyphs — a ~1% under-report (105,001 vs
105,817). Every number above is bytes.

### Correction #2 — finally landed

The carried-verdict cue in `frontend-pricing-editor.md` now states **three**
inputs instead of one:

- `carried_from_boq` — the row's origin BoQ. **The STATE still keys on this field
  alone**; the other two shape the tooltip, never the verdict.
- `carried_from_version` (R3) — which VERSION a within-BoQ carry came from.
- `carried_from_other_boq` (R16) — **derived SERVER-SIDE** in
  `get_sheet_categories_resolved`. Do not re-derive cross-BoQ-ness in the client.

The tooltip reads `carried from Version N` within a BoQ and `carried from BOQ-…`
across one. Rendering the BoQ form for both was the pre-R16 bug.

The correction **grew** its file by ~1.2 KB — precisely the write the old guard
denied. It landed because the file is now 42 KB against a 100 KB ceiling. The
debt S6b recorded as "accepted, structurally uncorrectable" is closed.

### Fragment repatriated

`.claude/plans/boq/slices/2026-07-29-within-boq-carry-parity.md` (24,752 B) was
living in a **second, orphaned plan tree at the app root** — one file, while the
real tree under `frontend/` holds 175 and owns `_slices.md`. Its record existed
but was unreachable from the map, which is the literal form of "the documentation
stopped making sense".

Cause: `process-config.md` declares `fragments: frontend/.claude/plans/boq/…`,
but the slice-state examples in `planner.md` and `orchestration.md` both showed
`.claude/plans/boq/…` with no `frontend/` prefix — while `orchestration.md`
simultaneously *mandates* launching from the app root. A relative `.claude/…`
therefore resolved to the app root, and `guard_scope.py` waved it through because
`plan_fragment` is always in scope.

`git mv`d into the real tree, indexed in `_slices.md`, stray directories removed.

---

## Follow-on state

- `.claude/context/domain/boq-backend.md` is **187,338 B against a 100,000 B
  ceiling (1.9x)** and is now in repair mode. It has 20 `##` sections and is the
  next carve. It is on-demand rather than auto-loaded, so it costs nothing per
  session — but it can only take corrections up to 2 KB until it is split.
- The facts doc is **51 commits behind `develop`, 75 behind HEAD**. A fold is owed.
- The restructure (this slice plus `0060499e` and `dbd51571`) is **24 commits
  ahead of `develop`, a clean fast-forward, published nowhere.** Until it merges,
  every other clone still sees the 1.35 MB monolith and no `plans/boq/` tree.

## Ratified process changes

Recorded in `process-config.md`'s changelog on 2026-07-30, owner-approved:

1. **Repair band.** A file over ceiling may still grow by up to 2,000 B per call,
   so a document over budget stays correctable. Bounded and reported — the
   session-open digest lists every over-ceiling file with its ratio.
2. **Ceilings derived from the measured corpus**, with the derivation recorded
   inline in `nirmaan_ceilings.py`, shared by the guard and the digest so the two
   cannot disagree.
3. **Fragment chaining.** Fragments stay write-once, but a slice too large for one
   opens `<slug>-part2.md` and adds its own row beside part 1. Hard ceiling
   22 KB warn / 32 KB deny.
4. **Monotonic files rotate at the WARN band, not the deny band.** `_slices.md`
   grows one row per slice forever; at the old 45,000 B deny it had roughly 100
   slices left before no slice could register itself.
5. **Path form.** Every slice-state path is repo-root-relative and carries the
   `frontend/` prefix where the tree lives there.
