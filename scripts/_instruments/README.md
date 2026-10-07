# `scripts/_instruments/` — hand-run instruments

**Not product code. Not tests. Nothing here runs in CI, and no tracked module imports any of it.**

These are the rigs and proofs that survived the 2026-09-29 cleanup, which deleted 50 spent one-off
scripts from the repo root. Each file here earned its place by being **re-used after the slice that
created it**, or by being **cited as provenance by shipped code**. Everything else was disposable and
is gone; the assets, digests and conclusions they produced live in git and in the plan doc.

They sit beside `scripts/mint_completeness_check.py`, which is the same kind of thing: run by hand at a
decision point, tracked because the decision recurs.

---

## ⚠️ LAST-RUN LINES — read these first

A tracked script that nothing exercises **rots silently**: the two `.ts` rigs import frontend modules
by relative path, so moving one of those modules breaks the rig with nothing going red. The dates below
are the guard — if a last-run date is old, assume the rig needs checking before you trust it.

| instrument | what it does | last run |
|---|---|---|
| `replay_catalogue.ts` + `replay_diff.py` | whole-catalogue no-op replay + SHA-256 run digest | **v66 slice, 2026-09-29** — 1,762 records, digest `1d2aaec5…2dc3`, and re-verified from this folder on the same day |
| `replay_itemlist.ts` + `replay_check.py` | item-list replay over stored replies vs a given asset | **slice 10, 2026-09-25** (the rig itself was written for slice 8 and re-used unmodified) |
| `capture_tools.py` | capture surgery (`reconstruct` / `merge`) that feeds `replay_itemlist` | **slice 9, 2026-09-24** |
| `foldproof.py` | IEEE-754 bit-exactness proof for a fold migration | **12b(A), 2026-09-27** |
| `foldsearch.py` | finds further folds by signature | **12b(A), 2026-09-27** |
| `valsweep.py` | runs the config validator over **every asset on disk** | **12b(A), 2026-09-27** |
| `hvac_v1_attrs_for.py` | **PROVENANCE ONLY — NEVER RUN** | never; it is not an instrument |
| `audit12d3_build_rows.py` | 12d-3 Insulation audit, stage 1-3 capture: joins the capture log, the run doc, the node unit, hand rates and the gate per extracted row (container, read-only) | **12d-3, 2026-10-08** — 466 rows, 92 sheets |
| `audit12d3_pricing.ts` | 12d-3 stage 4-5: every captured row through the 12c-P `runParity` driver (BOTH real paths), per-row fields / rules / figures / divergence cause; esbuild-bundled in-container (recipe in its header) | **12d-3, 2026-10-08** — 466 rows, 36 divergences, 0 errors |
| `audit12d3_analyse.py` | 12d-3 analysis: the automatic reading + rule checks, the stratified 60-row hand-review dump, the second-opinion merge, the Excel (host; openpyxl) | **12d-3, 2026-10-08** — `2026-10-10_12d3_Audit_Rows.xlsx` |

---

## What each one is for

### `replay_catalogue.ts` + `replay_diff.py` — the no-op proof

The pair that answers *"did any figure move?"* across the whole Electrical catalogue. `replay_catalogue.ts`
sweeps every SKU through the product's own interpreter against a **given asset path** and writes one
record per SKU, floats serialised as 17-significant-digit **text** so the digest cannot hide a low-bit
difference. `replay_diff.py` then does two jobs:

- `coverage <run.json>` — what the sweep actually exercises, per category. **Read this before trusting
  any AFTER figure**: a no-op proof over a sweep that never reaches the changed step is vacuous.
- `diff <before.json> <after.json>` — the verdict. A single moved figure is a STOP, never a rounding
  allowance.

**Baselines are deliberately NOT kept here.** The rig takes the asset path as an argument and every
asset version is committed, so any historical baseline regenerates exactly — which is why the 2026-09-29
cleanup deleted 5.0 MB of stored run JSON and kept these two files instead.

```
node <bundled>.js <asset.json> <out.json> [assemblyDepth]
python replay_diff.py coverage <run.json>
python replay_diff.py diff <before.json> <after.json>
```

### `replay_itemlist.ts` + `replay_check.py` — the item-list (ADP) replay

Replays every stored model reply through the pure `itemListPricing` module against a given asset, so a
pricing change can be proven over real rows **without spending another AI call**. `replay_check.py check`
first proves the BEFORE replay reproduces the captured run exactly (refusal text and figures) — the
anti-vacuity step — and `diff` then reports newly priced, changed-while-priced, and priced → blank.

### `capture_tools.py` — capture surgery

`reconstruct` builds a capture in which every item carries a new answer mechanically derived from older
fields, so a pricing change can be replayed over rows a paid re-read does not reach. **That output is
not evidence about the model** and is labelled as such wherever it appears. `merge` then substitutes the
real answers for the rows a paid re-read did cover, recording which those were.

### `foldproof.py` / `foldsearch.py` — the fold proofs

`foldproof.py` asks whether rewriting a folded literal as its two inputs multiplied is **bit-exact in
IEEE-754** — and records the cases where it is not (`(1-0.70)*(1+0.65) != 0.495`,
`(1-0.57)*(1+0.40) != 0.602`). No test states those facts; this file is where they live.

`foldsearch.py` looks for further folds. Its header carries the lesson that makes it usable: an early
version graded a candidate CONFIRMED whenever both factors merely existed somewhere in the catalogue,
and "confirmed" 38 of 48 groups — arithmetically true, meaningless. **A search that flags everything has
found nothing.**

### `valsweep.py` — the standing-rule instrument

Runs the config validator over every asset JSON on disk. This is the mechanical form of a rule in
`CLAUDE.md`: *before switching such a gate on, sweep every asset on disk* — a new refusal that lands on
a HISTORICAL asset is a defect in the current slice, not in that asset. It chdirs into the bench `sites/`
directory, so it runs **in-container**.

### `hvac_v1_attrs_for.py` — ⚠️ PROVENANCE ONLY, NEVER RUN

Not an instrument. It is the slice-1b HVAC mint, kept solely because
`nirmaan_stack/services/boq_rate_master/spec_reader.py` states that its shipped deterministic rule set
was carried over **verbatim** from the `attrs_for` table inside this file. Deleting it would orphan that
reference and remove the only way to check `spec_reader` against what it was derived from.

It mints `rate_master_hvac_all_v1.json`, which is long superseded, and reads a workbook copy that no
longer needs to exist. **Running it would at best rebuild a dead asset.**

---

## Running them

Both `.ts` rigs import frontend modules by path relative to this folder (`../../frontend/src/...`) and
are bundled with esbuild before running. The Python ones that touch the database chdir into the bench
`sites/` directory, so **they run in-container**, not on the host.
