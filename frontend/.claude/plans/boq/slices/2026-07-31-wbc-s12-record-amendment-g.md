# WBC-S12 — record Amendment G, and correct three residues

**Branch** `feature/boq-within-boq-carry` · **Base** `8b845cd4` · **Tier** STANDARD · **Date** 2026-07-31

**This slice changes NO behaviour.** Every edit is prose — a docstring, an ADR, two plan documents.
No function body, no signature, no test. The one `.py` file touched was verified docstring-only by
AST comparison, not by eye (see *Verification*).

WBC-S11 shipped the serial second-pass match on an owner ruling made **mid-slice**. The ruling was
recorded in the slice fragment and in code docstrings, but **never in the ADR** — so the canonical
decision record still read as though Amendment F were the latest word, and a future reader consulting
it would not know the boundary had moved. This slice writes it down, and clears three factual
residues found alongside it.

---

## 1. ADR-0014 gains **Amendment G** — the point of the slice

Two blocks, matching the file's established structure (a summary block in `## Status`, a detail block
under the decision it amends):

- **`## Status`** — a `⚠️ AMENDMENT G — 2026-07-30, owner-directed` block, placed directly after
  Amendment B's and before F's, which is where this file puts its newest amendment.
- **`### D6`** (the row match key) — the detail block, placed **after** Amendment B's block and
  before D6's original superseded prose. G *layers on* B rather than superseding it: pass 1 **is**
  B's key, unchanged; G adds a fallback for the rows B leaves unmatched.

**The letter G was free.** Latest in the file was F (2026-07-29). The blocks record the rule, the
one enabled call site, the two seams that stay strict, the sanctioned-exception framing against
`row_match.py`'s four-narrowings warning, the no-float-repair rejection, and the live-corpus
evidence — cross-referencing the S11 fragment as the as-built record.

**The boundary, stated correctly.** It is **structure vs. everything else**, NOT rates vs. layers.
The original build prompt drew it at rates-vs-layers; the owner corrected that mid-S11. All three
supporting arguments are carried into the ADR: the split was **not achievable** (one match object,
four consumers), **not desirable** (the structural risk is stale-heading re-parenting, which lives
in the parse-time carry), and would have **partly undone Amendment E** by letting a moved row arrive
priced-but-uncategorised.

## 2. The S11 fragment contradicted itself on test counts

It asserted *"Zero tests deleted in this slice"* two sections above a disposition table whose row 2
records a **SPLIT** — one test renamed away into two. Corrected to the true figure: **40 added, 1
renamed away as a disclosed split, net +39**, with the note that coverage is strictly stronger after
the split.

**The same claim appeared twice.** `"+39 tests, 0 deleted"` in the Verification section made the
identical assertion. Correcting only the named sentence would have left the document still
contradicting itself, so both were fixed. Minimal edits — this fragment is write-once and this is a
factual repair, not a rewrite.

## 3. A bisect warning on commit `72933a60`

`72933a60`'s message says the flag exists so *"the three consumers that must not get it (the
cross-BoQ layer carry, the within-BoQ copy-forward, the parse-time classification/parenting carry)
are unaffected"*. **The first of those three is wrong.** The owner's ruling arrived *after* that
commit, and the cross-BoQ layer carry **does** get pass 2 — it reads the same match object as the
rate carry and was never separable. Corrected one commit later in `bce47806`.

**Commit history is immutable, so the message cannot be fixed.** A clearly-headed note in the S11
fragment is now the correction of record, so anyone bisecting to `72933a60` is not misled.

## 4. A stale Amendment-D-era sentence in `committed_carry.py`

`stamp_revision_provenance`'s docstring claimed *"no seam anywhere copies row content between a
revision and its original except the rates"*. **Amendment E falsified this on 2026-07-28** — the
cross-BoQ per-sheet action moves categories, remarks, colours and dismissals too, opt-in and
stamped. Corrected in place rather than deleted, so the claim is not reintroduced by someone reading
the surrounding Amendment-C/D history. The surviving distinction is **COMMIT vs. explicit ACTION**,
not rates vs. layers.

Pre-existing rot, unrelated to S11 — the file's own module docstring has recorded Amendment E
correctly since July; only this one function-level sentence was left behind.

---

## ⚠️ Two ADRs are numbered 0014

`docs/adr/` holds **both** `0014-boq-revised-upload-and-carry.md` (this one) and
`0014-invoice-mutation-permissions.md`. The collision is pre-existing and untouched. ADR-0014's own
Status section already declares that historical `0002`/`0007`/`0008`/`0009` collisions are
deliberately **not** renumbered as out of scope; this is a fourth instance of the same situation and
is recorded here so the next person editing "ADR-0014" checks which file they have open. **Not
fixed** — renumbering a referenced ADR is its own decision, not a documentation slice's to take.

---

## Verification

No behaviour changed, so no suite run was owed. One smoke check was run because a `.py` file was
edited:

| Suite | Result |
|---|---|
| `test_committed_carry` | **Ran 58 — OK** (expected 58, matching S11's final count) |

Before the smoke check, the docstring-only claim was proved **structurally** rather than by reading
the diff: both revisions of `committed_carry.py` were parsed with `ast`, every module/class/function
docstring stripped, and the resulting trees compared — **identical**. A prose edit that had
accidentally landed inside a statement would have failed that check.

**No red run (A22).** A red run is structurally impossible for this slice: there is no behaviour to
fail. The `.py` edit is inside a docstring, and the other four files are documents. The honest
verification is the AST equality above plus the unchanged suite count, and that is what was done.

---

## Findings

1. **The prompt located the stale sentence at "around line 150"; it is at lines 88–90**, inside
   `stamp_revision_provenance`'s docstring. Line ~150 holds a *different* docstring, the Amendment G
   note on `committed_excel_row_match`. The quoted text was unambiguous, so this was a stale line
   reference rather than a spec conflict, and the edit was made where the sentence actually lives.

2. **⚠️ Commit `8b845cd4`'s message overclaims.** It reads *"docs(boq): record slice WBC-S11 **and
   ADR-0014 Amendment G**"*, but it touched only `_slices.md` and the S11 fragment — **the ADR was
   never opened**. That is exactly the gap this slice closes, and it is the second immutable commit
   message in this arc whose text outran what it did (see the `72933a60` note in the S11 fragment).
   Recorded, not fixable.

3. **The prompt's corpus statistics differed slightly from the measured record.** It described `'a'`
   ×999 / `'b'` ×849 / `'i)'` ×71 as all being within *one sheet*; the S11 fragment records `'a'`,
   `'b'`, `'c'`, `'a.'` as **corpus-wide** counts and `'i)'` ×71 / `'ii'` ×62 as the *single-sheet*
   ones. The fragment is the measurement record, so the ADR follows the fragment. The point both
   versions make — serial alone is unusable, the pair rescues it — is unaffected.

4. No hook denied any write. No guard fired. No scope violation attempted. Nothing was pushed.

---

## Deliberately NOT done

- **The duplicate ADR number not resolved** — see above.
- **`committed_carry.py`'s module-level opening line still reads `(ADR-0014, Amendment D)`.** Only
  the sentence the prompt named was corrected. The line is arguably stale too, but the module
  docstring immediately below it walks D → E → G accurately, so it is not misleading in place; a
  slice that owns the file should decide it.
- **S11 Finding 4 (`_NODE_MATCH_FIELDS` fetches an unused `level`) still not fixed** — still out of
  scope, still owed a slice that owns the file.
- **No other suite run, and no browser session against localhost** (the `tabSeries` naming-lock
  collision rule).
