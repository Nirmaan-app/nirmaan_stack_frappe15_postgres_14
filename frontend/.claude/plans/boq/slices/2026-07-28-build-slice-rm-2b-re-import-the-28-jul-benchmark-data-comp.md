<!-- Recovered 2026-07-30 from frontend/.claude/plans/boq/archive/boq-upload-plan-pre-split.md.
     This record shipped in PR #1133 (2bd6032f) but was never
     distributed into the rotated plan tree: the rotation was
     computed from a 1,286,655 B plan doc and the rebase archived
     develop's 1,352,991 B version. Verbatim copy, write-once. -->

## Build slice RM-2b (re-import the 28-Jul benchmark data) COMPLETE

Data-only micro-slice. Branch `feature/boq-pricing-helper`. feat `943ace2f` + docs (this entry).
Pipelines verified UNCHANGED; owner ruled the 28-Jul workbook is the BENCHMARK going forward
(supersedes the 25-Jul reference).

### What changed
- Data asset swapped: `rate_master_wiring_cabling_v2.json` -> `rate_master_wiring_cabling_v3.json`
  (byte-identical to the owner's Desktop `rm1_import_wiring_cabling_v3.json`, sha256
  `dcc9b2ea69f072bba400fdd0e87c388732b188ed86feba5415bc95f833ad239a`), v2 removed in the same commit.
- Pre-flight verified read-only: category_config / pipelines / attribute_definitions / normalization_rule
  are BYTE-IDENTICAL v2<->v3; same 588-item key set; ZERO non-rate item changes. **57 changed cable rates:
  55 UNARMOURED install fills (0 -> 12/20) + 2 ALUMINIUM/UNARMOURED corrections (2C/2.5 15->12, 2C/4.0
  25->12).** (The RM-2b prompt mis-named the two corrections as COPPER 5C/0.5 & 5C/0.75; those are ordinary
  0->12 fills -- owner acknowledged the mis-attribution, CC's DB-verified read is authoritative.)
- `loader.py`: `DEFAULT_DATA_FILE` v2 -> v3 (the one-line change the rename forces; owner-approved widening).

### THE RUN
`load_rate_master(path=<v3 asset>, replace=True)` on discipline Electrical. Old batch
`rmbulk-c57cfe18194e` superseded (588 rows retained, active=0); new batch `rmbulk-f676a178e05a` active
(588 items + 1 config); 1176 total item rows + 2 configs; zero duplicate-active.

### CERT (CC-driven) -- ALL PASS
- **V1** replace outcome: old batch fully inactive (588/0), new batch `rmbulk-f676a178e05a` active (588 +
  1 config), total 1176 items + 2 configs, active batches == exactly the new one.
- **V2** spot-checks (post-load active DB): COPPER/UNARMOURED/2C/0.5 install 0->12 (fill); the two REAL
  corrections ALUMINIUM/UNARMOURED 2C/2.5 15->12 and 2C/4.0 25->12; COPPER 5C/0.5 & 5C/0.75 0->12 (fills,
  prompt mis-named); COPPER/UNARMOURED/3C/10.0 install 0->20 (new-golden row); lug rows 117/217/228 still
  106.04.
- **V3** tests: `nirmaan_stack.api.boq.test_rate_master` 8 OK + `test_pricing` 230 OK, both UNCHANGED (the
  loader constant now resolves to v3; the assertions -- 292/296/1, 106.04, normalization, idempotency,
  endpoints, config integrity -- all still hold).
- **V4** RM-2 page goldens (browser, fresh tab, header on the NEW batch `rmbulk-f676a178e05a`): the four
  standing goldens UNCHANGED on screen (120/20 * 80/20 * 87; 200/28 * 70/20 * 150; 210/44 * 130/40 * 160;
  940/240 with the >=35 band) AND the NEW affected-row golden COPPER/UNARMOURED/3C/10.0 -> cable supply
  630, install 40 (was 0 pre-change -- the fix visible), BCS 469.
- **V5** read-only elsewhere: the loader writes ONLY the two rate-master doctypes (no BoQ / pricing record
  touched); git clean apart from the pre-declared standing noise + the in-scope asset swap + loader edit.

### KNOWN WART (flagged for a future slice)
`loader.DEFAULT_DATA_FILE` is a **version-pinned constant** hardcoding the asset filename. This is the
underlying wart that turned a "data-only" swap into a code+scope decision: the RM-2b rename forced a
loader edit AND (had the constant been left at v2) would have broken `test_rate_master`'s `setUpClass`
`open(loader.DEFAULT_DATA_FILE)`. **A future slice should make the loader resolve the canonical asset
WITHOUT a version-pinned filename constant** (e.g. a stable `rate_master_wiring_cabling.json`, or
glob/latest resolution), so the next benchmark revision does not repeat this stop.

### Files
Swapped `services/boq_rate_master/data/rate_master_wiring_cabling_v2.json` -> `...v3.json`; edited
`services/boq_rate_master/loader.py` (DEFAULT_DATA_FILE). Docs: this entry + root CLAUDE.md (28-Jul
benchmark ruling). Out of scope (untouched): both doctypes, the endpoints, the RM-2 page, all tests,
patches.txt, .claude/settings.local.json.
