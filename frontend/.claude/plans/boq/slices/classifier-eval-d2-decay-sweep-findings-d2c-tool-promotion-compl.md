## Classifier eval -- D2 decay sweep FINDINGS + D2c tool promotion COMPLETE

Offline measurement of the D1 proximity-decay knob against the human-labelled electrical corpus
(`Set2_Verdicts_Relabeled`: 61 files / 17 BoQs / **4,159 scorable line items** = Line Item rows with a
non-blank `team_classification`), then promotion of the proven scratch sweep into a tracked tool. No
runner/asset change this build (one NEW harness file + this docs commit); the D1 flat default stands,
now as a MEASURED conclusion, not just a safe default.

**D2 measured result (electrical) -- decay does NOT help; LOCKED FLAT (1.0):**
- Flat `m=1.0` = **84.68%** (3522/4159). Across the full 20-value ladder (1.0 .. 0.05) accuracy stays
  **84.61-84.76%** -- the best point beats flat by **+3 rows** (m=0.90/0.95), within noise. Blank/
  route-to-human constant at 100; HIGH-band accuracy holds **96.5-96.7%** at every multiplier (NO 95%
  guardrail breach anywhere); routing barely moves (auto-accept ~2971-2979 @ ~97.5%, AI held at the
  Jul-4 export / prompt v1.2 era).
- WHY flat: electrical line items are mostly carried by DIRECT keyword signals or single-level (d=0)
  immediate-parent headers, so decay rarely bites. Where it does, the effects CANCEL: decay drains the
  over-propagated `EARTHING` banner (gains `wiring_cabling` +10, `conduit_piping` +3 at m=0.15) but
  over-suppresses legitimate distant sole-signal banners (`ups` **97.2% -> 88.8%**, the only >2pp
  per-category move; `earthing` -3). Net ~0.
- **D2b topmost-exempt variant shapes tested + REJECTED for electrical:** VARIANT A (topmost real
  ancestor exempt) / VARIANT B (sheet + topmost exempt), per-rule contribution = MAX of per-ancestor
  factors. Both RECOVER the ups/earthing losses (back to flat) but ERASE the wiring_cabling gains --
  same-distance-banner cancellation (the winners and losers are the same kind of row: a topmost section
  banner as the only ancestor signal). Both land TOTAL at ~84.68-84.71%, indistinguishable from flat.
  The variant shapes are therefore NOT shipped in the tracked tool; a shape option gets built only if a
  measured HVAC sweep wins with it.

**Faithfulness caveat (accepted):** flat prediction vs the files' stored `rule_category` = 81.05%, but
that column is a PRE-tuning2 (Jul-4) engine-tip export -- ~100% of the divergence maps to known runner
advances (geometry -> junction_box/conduit, blank->placed via new ancestor rules, LF/MISC/popup
propagation), with correctly-rebuilt ancestors. The feed reconstruction is faithful; the oracle is
stale. Faithfulness is therefore REPORT-ONLY in the tool, never a gate (team labels are tip-independent).

**D2c tool -- `services/boq_category/harness/decay_sweep.py` (NEW, tracked):** a parameterized offline
sweep consolidating the D2 pipeline. Pure offline (imports only the framework-free `runner` +
`routing`; NO frappe/DB/AI/network in the hot path). Feed rebuilt from `parent_excel_row`, byte-faithful
to `context_builder.py:181-184` (context_builder itself is DB-bound and cannot be imported for a
file-based tool). INPUT via env `BOQ_SWEEP_INPUT` or a positional arg (no default; never inside
`_classification_review/`); `--discipline` (default Electrical), `--ladder` (comma-separated, default the
20-value D2 ladder), `--out` (REQUIRED, must exist, refused if inside `_classification_review/`). Emits:
faithfulness report (report-only + stale-oracle note), the main sweep table (printed + `sweep_table.csv`),
`per_category_accuracy_matrix.csv` (categories x multipliers recall vs team labels, `*` = >2pp move), and
per-candidate `per_category_delta_m*.csv` diagnostics. Routing-impact columns only when the corpus carries
the AI columns, else skipped with a printed note (never invented). Canonical invocation in the module
docstring. **Verification:** no new unittest module (offline analysis tool -- same harness-stays-thin
convention as `electrical_classification_harness.py`; the logic it drives, `classify_line` decay, is
covered by `test_decay.py`'s 12). SMOKE (in-session, `--ladder 1.0` on the Set2 corpus): reproduces
**84.68% (3522/4159)** and denominator **4,159** exactly; the `--out inside _classification_review/`
guard refuses with exit 2. Regression `test_runner_electrical` 82 + `test_runner_hvac` 21 +
`test_hv2_voter_harness` 14 + `test_decay` 12 = **129, unchanged** (no runner code touched).

**Invocation:** `BOQ_SWEEP_INPUT=<labelled_dir> env/bin/python
apps/nirmaan_stack/nirmaan_stack/services/boq_category/harness/decay_sweep.py --out <OUTPUT_DIR>`


