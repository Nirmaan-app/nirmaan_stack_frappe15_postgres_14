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
| `recheck12d4b_build_set.py` | 12d-4b item 1: the re-check SET stated before any call -- changed rows (the two 12d-4a sweep diffs), instruction rows (D5 / D8 / D9a / D13 by the row's own text), the 12d-3 hand-WRONG rows, 20 stratified controls; the per-sheet row lists + the call / token estimate | **12d-4b, 2026-10-08** -- 108 rows / 53 sheets, 161 calls |
| `recheck12d4b_runner.py` | 12d-4b step 3: the 12d-3 runner scoped to the set (`_suggest_worker(only_rows=...)`), cap-guarded at 300 calls, one resume-retry, resumable progress | **12d-4b, 2026-10-08** -- 0 errors / halts / retries |
| `recheck12d4b_analyse.py` | 12d-4b item 4 a-f + the Review Pack's P1 / P2 / P4: stored 12d-3 answers vs the fresh ones, both priced through the current rules; the Excel | **12d-4b, 2026-10-08** |
| `audit12d3_analyse.py` | 12d-3 analysis: the automatic reading + rule checks, the stratified 60-row hand-review dump, the second-opinion merge, the Excel (host; openpyxl) | **12d-3, 2026-10-08** — `2026-10-10_12d3_Audit_Rows.xlsx` |
| `mint_hvac_v34_piping.py` | 12e-1: mints HVAC v34 = v33 + the 40-row Piping catalogue (`build`: workbook sheet -> candidate, uids through the ONE mint, validated offline, no DB write; `load`: pre-load snapshot, `load_rate_master(replace=True)`, canonical export). 12e-1b: `name` phase -- v35 = v34 + `attributes.item_name` (the sheet's column A, verbatim, MANDATORY on every Piping item) + its definition FIRST in the Piping config; uids kept, no mint. 12e-2: `price` phase -- v36 = v35 + `cost_supply` = the sheet's BCS Pipe (column G) on the 40 Piping items (VERIFY-FIRST: ROUNDUP(G x (1 + the family's accessories)) == column I on all 40, the MS links hold on G, else it stops naming the rows) + four `hvac_pricing_input` accessories items (uids through the ONE mint) + the item-list Piping config (families by pipe_type, the P5 pipeline, the P1-P4 keys; `item_name` under ADP's two flags). 12e-3a: `sections` phase -- v37 = v36 + two additions to the Piping config's `list_spec` and nothing else: the per-item `insulated` (Yes / No) definition, last, and `sections` (the config's own items + one section delegating to `hvac_insulation`: the two ruled families, `include_when`, `absent`, `mirror`). No item touched, no uid minted: the candidate is the base file with that one config edited in place (it stops if re-dumping the unedited base does not reproduce its bytes), validated offline by the config validator AND the cross-category check. Container, bench python; `--base` / `--out` must be ABSOLUTE paths (the script changes directory to `sites/`) | **12e-3a, 2026-10-11** -- `sections` 379 / 10, Piping questions `pipe_type, size_mm, pipe_class` -> `+ insulated`; load batch `rmbulk-28e5a8d53518`, pre-load snapshot `BRMS-26-00300`, retirements_without_reason 0; NO hand step this time (the candidate already carries the series order and `intentional_removals`; live == the file by content, 0 items / 0 configs differing); mint gate v36 -> v37 PASS. (12e-2, 2026-10-10: `price` 379 / 10, 40 re-based, inputs `rmi-67fd225ee50b` / `rmi-8ee2e7eafdcd` / `rmi-59a191e345dc` / `rmi-f9e817c46120`; load batch `rmbulk-a656afd62046`, pre-load snapshot `BRMS-26-00185`, retirements_without_reason 0; the same two hand steps after the export (series order, `intentional_removals`); mint gate v35 -> v36 PASS. (12e-1b, 2026-10-10: `name` 375 / 10, 40 named, definitions `item_name, pipe_type, size_mm`; load batch `rmbulk-d012e907473f`, pre-load snapshot `BRMS-26-00127`, retirements_without_reason 0; the same two hand steps after the export (re-order into the series convention, carry `intentional_removals`); mint gate v34 -> v35 PASS; 12e-1, 2026-10-09: build 375 / 10, load batch `rmbulk-fede1f42b846`, snapshot `BRMS-26-00069`, gate PASS)) |

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

### `mint_hvac_v34_piping.py` — the Piping catalogue mint (12e-1)

Two explicit phases, both in-container under the bench python. `build` reads the owner's HVAC workbook
sheet `Piping` (header shape pinned in the file) plus the base asset, mints one `item_uid` per row through
`csv_importer.mint_item_uid` (never inline), assembles the candidate (base items + 40 Piping items; base
configs + the one data-only `hvac_piping` config carrying the two LIVE MS `derived_rates` links) and
validates it offline with the loader's own config / item validators and `derived_rate_updates`; it writes
no database row. `load` takes the pre-load snapshot, runs `loader.load_rate_master(replace=True)` on the
candidate and exports the text from the database. Re-running `build` mints fresh uids by design; the
committed file is the record. ⚠️ TWO HAND STEPS FOLLOW THE EXPORT, both measured in 12e-1: (1) the
exporter orders items `kind asc, item_uid asc` and configs `category_id asc`, but the HVAC series files
(v32 / v33 checked) hold items in GLOBAL `item_uid` order and configs in creation order with the newest
last -- and the cross-version pins compare ORDERED lists -- so the export is re-ordered into that
convention (content asserted byte-equal to the previous asset per uid / category while doing so);
(2) the exporter does not emit the top-level `intentional_removals` key that v29 onwards carry (the
declared `calculator_only` removal), so it is carried from the previous asset -- without it
`mint_completeness_check.py` reports one UNDECLARED removal (`top:intentional_removals`).

12e-1b added the third phase, `name` (owner 2026-10-10: the item name "should be kept exactly as per the
excel file. we cant drop it."; ruling option (a)): v35 = v34 + `attributes.item_name` on every Piping item --
the sheet's column A text verbatim, matched by `source.row`, uids KEPT (nothing is minted) -- plus the
`item_name` definition FIRST in the Piping config (a plain choice over the four sheet texts, label "Item", no
`attributes_from_spec`: the spec reader has no Piping rules). The key is MANDATORY: the offline validation
refuses a Piping item without it, and `build` now carries it too, so a future re-mint cannot drop it. The
viewer and the rate file show an attribute ONLY when the config declares it, which is why the key and the
definition travel together. `load` and the two hand steps are unchanged.

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
