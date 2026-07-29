## Classification Engine -- electrical category rule set + signal-agreement runner (2026-06-29)

NEW TRACKED MODULE: `nirmaan_stack/services/boq_category/` -- a pure-Python, framework-free
(NO frappe imports) rules layer that classifies a committed BoQ Line Item into one of the 12
electrical pricing categories (or `novel` = route-to-human). This is the deterministic RULES
half of the two-stage classification arc; the AI pass is a separate harness (NEXT), not in
this module.

WHY RULES-FIRST + EXPLAINABLE: every verdict carries a human-readable `reason` composed from
the fired rules' `plain` strings (abbreviations spelled out via a glossary -- MCB = small
circuit breaker, CRCA = cold-rolled steel panel body, etc.), so a non-technical reviewer can
see WHY a line landed in a category and WHY it is uncertain.

FILES:
- `categories_electrical.json` -- the 12 categories + `novel` (category_id / name / description /
  discipline). Descriptions are the signed-off Option-B reference; the AI harness reads this
  same file.
- `rules_electrical.json` -- the rule set. Each rule: rule_id (stable) + category_id +
  signal_type (item_keyword | ancestor | exclusion) + match[] + match_mode (any_token | phrase
  | regex) + weight + `plain` (human explanation) + optional exclude_if / ambiguous_with +
  `source` (provenance: live-corpus token doc-frequencies). Seeded from REAL committed
  electrical vocabulary mined 2026-06-29 (work_header='Electrical', is_current=1,
  node_type='Line Item', n=4282) -- NOT invented. Token freqs e.g. mcb 587, sq.mm 745,
  cable 649, termination 459, earthing 322, outgoing 175, panel 128, bus bar 42, crca 30.
- `scoring.json` -- the confidence model as DATA (nothing hardcoded in the runner): cap 1.0,
  agreement_bonus 0.15 (>=2 distinct signal_types agree), conflict_margin 0.6 + conflict_penalty
  0.30 (a close runner-up suppresses the top score and surfaces both), bands HIGH>=0.75 /
  MED>=0.45 / LOW>0 / ABSTAIN==0 -> novel. All numbers documented inline with rationale;
  PROVISIONAL -- to be recalibrated against team verdicts + AI agreement.
- `runner.py` -- the runner. Entry point:
    `classify_line(description: str, ancestor_texts: list[str], notes: list[str], *, discipline: str = "Electrical") -> dict`
  returns {category_id, score (0-1), band, signals_fired[], reason, runner_up, all_scores}.
  Deterministic + side-effect-free; loads JSON once (cached) via `load_ruleset()`; whole-token
  (alphanumeric-boundary) matching so short tokens do not fire inside longer words ('mcc' !=
  'mccb', 'panel' != 'patch panel').
- `tests/test_runner_electrical.py` -- fixture-backed unittest (boq_parser style, no live
  site). 14 tests GREEN in-session via
  `python -m unittest nirmaan_stack.services.boq_category.tests.test_runner_electrical`.

SIGNAL-AGREEMENT SCORING MODEL: rule weights sum per category; independent signal kinds
agreeing (item_keyword + ancestor section header) earn an agreement bonus; a genuinely close
runner-up triggers a conflict penalty (pushes the contested result down a band and names both
candidates in the reason); a false-friend exclusion zeroes a category. Final top score -> band.

THE DB-vs-PANELS DISCRIMINATOR (headline ambiguity), verified in-session:
- "Outgoing : 36 Nos. 16A SP MCB of 'D' curve" -> db_switchgear HIGH (schedule + curve + breaker).
- "LT Panel CRCA floor mounted with bus bar" -> panels HIGH (assembly noun + enclosure language).
- "63A 4P MCCB" (bare breaker) -> db_switchgear MED (single weak signal, review).
- "MCCB in panel" -> db_switchgear LOW + runner_up=panels, reason names both -- contested.
- "2X2 LED panel, CRCA housing" -> novel/ABSTAIN (LED/patch-panel exclusion -> NOT switchgear).
- earthing false-friend "...socket... 3 pin and earth" -> earthing zeroed (pin/socket exclusion).

NEXT: the scratch harness that runs `classify_line` over the committed electrical corpus +
the AI Option-B pass (reads `categories_electrical.json`), emitting a per-sheet CSV (rules
verdict vs AI verdict) for team review + scoring recalibration.

