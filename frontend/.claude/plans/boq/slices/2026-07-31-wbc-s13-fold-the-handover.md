# WBC-S13 — fold the handover from git (v5.91 → v5.92)

**Branch** `feature/boq-within-boq-carry` · **Base** `9cc5e689` · **Tier** STANDARD · **Date** 2026-07-31

**This slice changes NO code.** One document was rewritten from git, plus this record and its index
row. No `.py`, `.ts` or `.tsx` file was opened for edit; no test suite was run, deliberately — there
is nothing for a test to observe.

`.claude/facts/handover.md` is the first thing a fresh session reads, and the owner is about to open
one. It was last folded at `e7f4602f`. **14 commits had landed since and it knew about none of
them** — its tip, commit count, test table, next action and risk list were all stale or wrong. Every
volatile fact was re-derived from `git log` / `git diff` in this checkout.

---

## 1. What was folded

**Range `e7f4602f..9cc5e689` — 14 commits, 21 files, +2,683 / −408, Abhishek sole author.**
Every figure verified against git; all three matched the build prompt exactly.

| Slice | Commits | Landed |
|---|---|---|
| **WBC-S10** | `283a0199` | Copy-forward may land rates on uncategorised rows |
| **WBC-S11** | `f289889a` `72933a60` `bce47806` `3cd922da` `8b845cd4` | Opt-in serial + description second-pass match, cross-BoQ only |
| **WBC-S12** | `50a437a4` `9cc5e689` | ADR-0014 Amendment G under D6; three residues corrected |

Lane state re-measured, not carried: **39 commits ahead of `develop`, 0 behind**; merge-base *is*
`develop` (`2bd6032f`), so the merge is **still a clean fast-forward** (`git merge-tree
--write-tree develop HEAD` returns a tree). `git branch -r --contains 9cc5e689` → 0, still unpushed.

## 2. What was corrected

- **Frontmatter** → `recorded_tip: 9cc5e689`, `v5.92`, dated 2026-07-31. Follows the established
  convention of recording the tip *before* the fold commit, as `e7f4602f` did.
- **Test table replaced.** The recorded `255 / 49 / 60` were historical. New figures are the
  in-container observations made this session by an independent agent, each **re-checked here as a
  static `def test_` count** — all six matched. Zero skips confirmed: no `@skip` decorator exists in
  any of these modules (every `grep` hit for "skip" is the carry plan's own `skip_reason` taxonomy,
  domain vocabulary, not a test skip).
- **Next action rewritten.** Owner live certification for **both** S10 and S11 is now item 1 and
  explicitly gates the merge, with the specific paired checks spelled out. Push/merge demoted to 2.
- **Risks refreshed** — added *the arc is code-complete but UNCERTIFIED in a browser* as the top
  risk; "25 commits unpushed" → 39.
- **Migration debt restated as carried, not new.** This range adds **no** new exposure: the
  doctype-JSON and `patches.txt` diffs over the range are both empty. The 4-new / 7-modified debt is
  v5.91's, still undischarged.
- **Standing noise:** `cert-shots/` added to the macOS list — it exists in `git status` and was
  unrecorded, which is exactly the A13 misfire the section warns about.
- **Plan-tree counts** refreshed: `_slices.md` 185 data rows, `slices/` 183 fragments.

## 3. Three deferred items added (register is now OVER ceiling)

The register was at its 5/5 ceiling. It is now **8**, and the doc says so plainly rather than
dropping anything. Each was verified in this checkout before being written down:

- **(f)** `_NODE_MATCH_FIELDS` (`committed_carry.py:77`) fetches `level`, but `_content_match_rows`
  projects only `source_row_number`, `description` and `code`. **Confirmed dead read**, pre-existing.
- **(g)** `docs/adr/` has **duplicate ADR numbers** — two files each at 0002, 0007, 0008, 0009 and
  0014. "ADR-0014" by number alone is genuinely ambiguous here
  (`0014-boq-revised-upload-and-carry.md` vs `0014-invoice-mutation-permissions.md`).
- **(h)** Two immutable commit messages overclaim. `72933a60`'s body lists "the cross-BoQ layer
  carry" among the consumers that must *not* get the second pass — the owner's ruling then changed
  exactly that, and `bce47806` enabled it there. `8b845cd4`'s subject claims it wrote ADR-0014
  Amendment G, but its diff touches only `_slices.md` and the S11 fragment; the ADR was not opened
  until `50a437a4`. Anyone bisecting to either commit will be misled.

Discharge candidates named in the doc: (a) and (b). (d) and (e) are marked load-bearing.

## 4. Where git and the prompt differed

**Nothing contradicted.** All 14 commits, both file/line totals, all six test counts, the
sole-caller claim, the dead read, the duplicate ADR numbers and both overclaiming messages verified
exactly as described. Two things the prompt did not mention, resolved by judgement and reported:

1. **The replacement test table omitted two rows that are still true.** `test_classify` (94) and
   `services.boq_category.tests` (235) were bench-verified at `f215d6a9`. `boq_category` is
   untouched in this range, and `test_classify`'s count is unchanged (94 at `f215d6a9`, 94 at
   `9cc5e689`). Replacing the table *literally* would have silently discarded two verified facts, so
   **both rows were retained with their observation commit and provenance shown**, visually separated
   from this session's six.
2. **The `Assertions` column was dropped.** The prompt's replacement table has no assertion figures
   and none were observed this session; inventing them by static grep would have added unverified
   numbers. The `Suite` column still satisfies agreement #20's suite-distinguishing intent.

## 5. Size

17,952 B / 220 lines → **19,902 B / 250 lines**. Above the ~18 KB target and reported as such.
~1.2 KB of genuinely historical content was deleted to make room rather than layered over: the
v5.90-noise-list incident forensics (superseded by the corrected list itself), the "was 177.8 KB"
before/after figures from the context restructure, the split/rotation commit trivia, and the
per-slice test bookkeeping in the S10/S11 blocks — the last of which belongs in a slice fragment
under the DOCS-UPDATE RULE, not in an always-read doc.

The residual growth is content the fold *required*: three new deferred items, and a certification
block the prompt asked to be explicit because it is what the next session acts on. **No owner
rationale or ruling was paraphrased away to buy bytes.** If the doc must return to 18 KB, the
honest carve is the 59-row Working-agreements index (3.3 KB, a pure lookup whose full text lives
elsewhere) — flagged, not taken, because it would break the "resume from this doc alone" property.

## 6. Verification

No behaviour to test. `git diff --stat` on the commit confirms **three files, all in scope**, and
**no `.py` / `.ts` / `.tsx` file present**.
