## Build slice HV-11 (rules_version provenance + AI-settings change tracking + ai_status surfaced) COMPLETE

Three owed hygiene fixes, one slice (migrate-carrying). Branch `feature/boq-classification-eval`,
base tip `12dbc0e7`.

**Part 1 -- rules_version provenance (closes the HV-9 finding).** The classify path already threaded
the version end-to-end -- `orchestrator.classify_sheet_rows` reads `ruleset.get("version")`
(`orchestrator.py:125`), stamps it into the row dict (`:221`), and `persist.write_row_categories`
writes `doc.rules_version` (`persist.py:109`). The SOLE gap was upstream: `runner.load_ruleset`
returns a HAND-BUILT dict that never surfaced `"version"`, so the getter saw None and rules_version
persisted EMPTY. **Fix = ONE additive loader line** (`"version": rules_doc.get("version")`, the exact
HV-7 routing_policy precedent). The provenance chain is now WHOLE. Live: an AI-off HVAC classify
stamped `rules_version = "4.2-hv7"` on the new rows (prompt_version/model unchanged); Electrical
ruleset version = `2.1-tuning2` (additive provenance for the legacy engine too).

**Part 2 -- AI-settings change tracking.** `track_changes: 1` on the `BOQ Upload Review AI Settings`
doctype JSON (nothing else), `bench migrate` applied. A toggle OFF->ON flip produced two Version
docs (`gbs0rqa5fo` enabled 1->0, `gbvh3ucc0g` enabled 0->1) with user + timestamp. From this slice
any toggle flip is attributable via the Version log -- the standing incident's instrument (the four
prior unattributed self-flips would each now get a name).

**Part 3 -- ai_status on the completion surfaces.** The done payload already carried `ai_status`
(`ran | disabled | no_key | null`). The new pure `aiStatusWarning(aiStatusByDiscipline)`
(`ClassifyProgressModal.tsx`) renders on BOTH the modal + the post-close toast. Per-discipline
accumulation over the run set (`aiStatusByDisciplineRef` in `SheetPricingPage`, reset each
`onStarted`, one entry per engine's done); the HEALTHY path (`ran`/null) yields "" so the completion
text is byte-identical (zero noise), while ANY `disabled`/`no_key` yields ONE plain line NAMING those
disciplines (multi-engine names ONLY the off one). Replaced the old single-status `aiStatusNote`
render (which was last-engine-wins + un-named). Live: AI OFF shows *"AI voter was OFF for HVAC - ..."*
on modal AND toast; AI ON shows no warning on either.

**Tests (bench-verified):** backend `test_runner_hvac` 101 -> 104 (+3: loader surfaces HVAC +
Electrical version; a present-and-None gap-class monkeypatch pin), `test_classify` 54 -> 55 (+1:
persist stamps a provided rules_version). Frontend `vitest` 560 -> 567 (+7 `aiStatusWarning`), `tsc`
net-zero (3235, 0 in touched files). Report + live evidence:
`_classification_review/hv11_report/HV11_REPORT.md`.

**Env note:** `bench migrate` clears sessions -- recovery needed a fresh `bench start` + Vite restart
+ clear-site-data + re-login before start_classify stopped returning the CSRF "Invalid Request".


