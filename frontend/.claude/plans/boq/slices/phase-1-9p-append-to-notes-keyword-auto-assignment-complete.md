### Phase 1.9p --- append_to_notes keyword auto-assignment ✅ COMPLETE

**What landed:** Added `append_to_notes` as a new key in `_HEADER_KW`
(classifier.py) with 12 reference-code keyword entries:
`ref no`, `refno`, `ref no.`, `ref. no`, `ref. no.`, `ref code`,
`ref number`, `reference`, `dsr`, `ndsr`, `code`, `item code`.
Synced `_CLASSIFIER_HEADER_KW` replica in classifier_audit.py per agreement #21.

**Why no _auto_guess.py change was needed:** Pre-flight code verification at tip
62e676e0 confirmed the existing Phase 1 longest-match loop (post-1.9l) correctly
handles `append_to_notes` without any guard blocks:
- `append_to_notes` is NOT in `_SINGLETON_ROLES` → multi-column assignment works.
- `append_to_notes` is NOT in `_PER_AREA_ONLY_ROLES` → universal role,
  assigned in Phase 1 (single-area path), not Phase 2 (per-area-only).

**Section 7.34 framing evolution (two-layer model):** Reference-code columns
(`Ref No`, `DSR`, `NDSR`, `Code`, etc.) are the first bounded carve-out from the
original "parser never auto-detects append_to_notes" rule. The revised model:
- Layer 1 (parser): auto-detects the bounded reference-code keyword family.
- Layer 2 (wizard): remains authoritative on user intent; wizard can
  confirm, override, or add any append_to_notes assignment.
Formal section 7.34 amendment owed in the handover doc on next chat-Claude cycle
per agreement #17 (manual sync).

**Longest-match-wins guards confirmed:** `DSR Rate` (8c) beats `dsr` (3c) →
stays rate_supply. `NDSR Rate` (9c) beats `ndsr` (4c) → stays rate_install.
`Material Code` (13c) beats `code` (4c) → stays make_model.

**Tests landed:** 11 in test_classifier.py `TestPhase1_9pAppendToNotesKeywords`
(9 positive recognition + 2 longest-match-wins regression). 7 in test_auto_guess.py
`TestPhase1_9pAppendToNotesAutoGuess` (3 positive auto-assign + 1 multi-column
lock-in + 3 longest-match-wins regression). Total: +18 (357 → 375).

**Audit regression check (agreement #25):** Pre-1.9p baseline with current corpus
(28 fixtures, 343 sheets): classified=4663, unclassified=12926,
unique_unclassified=2598. Post-1.9p: classified=4789, unclassified=12800,
unique_unclassified=2580. Delta: classified +126, unclassified -126, unique -18.
Direction correct. Magnitude +126 slightly above expected +20-+100 range but
plausible for reference-code family (DSR/NDSR/Reference/Code headers appear across
multiple sheets in the 28-fixture corpus). Note: direct comparison to the v5.18
baseline (3970/10709/2536) is not meaningful because the fixture corpus grew by
4 files between the committed audit snapshot and the current state; the stash-based
pre/post delta method was used instead to isolate the 1.9p contribution.

**Agreement #27 verified:** No diagnostic-script changes made. Agreement still holds.

**Feat commit:** `5d348e4a`

