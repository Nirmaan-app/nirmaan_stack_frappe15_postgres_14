### Category-engine TUNING ROUND 2 -- un-freeze v2.0-build2b -> v2.1-tuning2 + AI prompt v1.1 -> v1.2 -- 2026-07-05, COMMITTED on feature/boq-phase-5

Un-froze the electrical category classifier (frozen at tip 67af6d7c) and applied 8 validated
rule-side fixes + one AI-prompt boundary. Feat commits: `8a14a4bc` (rules+runner+harness+tests),
`7e0b4bc9` (AI prompt v1.2), this docs commit. Files: `rules_electrical.json` (46 -> 53 rules,
version 2.1-tuning2), `runner.py` (headers_only + geometry), `harness/electrical_classification_harness.py`
(ancestor-headers feed), `prompts/electrical_ai_category_prompt.md` (v1.2), `tests/test_runner_electrical.py`
(62 -> 82).

**Provenance:** every fix was validated in-memory against the Set-2 committed corpus (12 BoQs, 2,888
scorable line items) before this build; full spec = `Classification_Fix_Spec_v1_0.md` (OneDrive). The
build implements the spec EXACTLY (no re-tune).

**The 8 fixes (JSON = rules_electrical.json; runner = runner.py):**
1. **EARTH-ANC headers_only (runner+JSON+harness).** EARTH-ANC now matches an ancestor DESCRIPTION/
   header, not a note -- an incidental 'earthed' in a raceway/box preamble note no longer false-fires
   earthing. `classify_line` gains keyword-only `ancestor_headers`; the harness passes headers (desc-only)
   parallel to `anc_texts` (desc+notes). Backward-compatible (None -> legacy full-blob behaviour).
2. **popup (JSON).** Trim SS-ANC (drop 'pop-up boxes'/'floor outlet'); extend PU-BOX; add PU-ANC +
   SS-EXCL-BOXFRAME. popup_boxes 3.8 -> 88.5%.
3. **LMS (JSON).** Modern KNX/Lutron/GrydSense/DALI-gateway vocab on LMS-KW + new LMS-ANC. 32.4 -> 80.3%.
4. **light_fixtures (JSON).** LF-KW 0.5 -> 0.6 + luminaire vocab; LF-ANC; LF-EXCL-POINTFRAME (protects
   point_wiring from the higher weight). 64.8 -> 96.9%. (DALI-luminaire false-friend fixed by the weight.)
5. **SS-SWSOCK (JSON).** New switched-socket rule ('socket controlled by'); ships WITH #2's box-frame
   guard (else it steals floor boxes). switches_sockets 49.7 -> 61.9%.
6. **conduit geometry (runner).** A single-diameter 'Xmm dia' leaf under a conduit section -> conduit.
   57.7 -> 88.3% (composed).
7. **JB geometry (runner).** A 3-dim W x H x D box (depth 40-600mm; tray-name-only exclusions; gauge/SWG
   allowed -- v2 gate) under a raceway/box section -> junction_box. 0 -> 88.3%.
8. **miscellaneous (JSON).** Safety/service vocab on MISC-KW/MISC-SAFETY + low-weight (0.35) MISC-ANC
   (never overrides a real signal). 17.4 -> 66.7%.
Geometry = one dimension-count override (1-num+dia=conduit, 2-num=tray, 3-num=box) applied to a
cabletray/earthing/blank winner only. Evaluation order in `classify_line`: keyword/ancestor scoring
(with headers_only EARTH) -> JB geometry -> conduit geometry. Exclusion guards rebuild automatically
in `load_ruleset` (no runner change for them).

**AI prompt v1.2 (#9, feat 7e0b4bc9):** one new Boundary rule -- "Panel-assembly precedence": a switchgear
device (MCCB/MCB/MCOS/meter/busbar/starter/EPO) itemised in a panel build ("LT PANELS"/MDB/"shall consist
of" section) is `panels`, not `db_switchgear`. DIAGNOSED only (AI voter put 77/120 team=panels into
db_switchgear); its effect is CERTIFIED in the upcoming full-corpus AI rerun, NOT in this rules-only
certification. JB/SS framing prompt edits were NOT drafted/validated -> out of scope.

**OWNER DECISION -- JB-ANC DROPPED (2026-07-04, reversing an earlier "implement").** A row-level review of
the 33 cabletray->junction_box regressions showed only 3 were true team mislabels (3-dim boxes); the other
30 were genuine 2-dim RACEWAYS the team labelled correctly, wrongly flipped by JB-ANC (which fires on any
'junction box' anywhere in the ancestor incl. notes -- and sections like "Floor raceways with respective
Junction Box" hold BOTH raceways and boxes). Geometry alone tells them apart. So JB-ANC is NOT built;
junction_box is recovered by geometry (3-dim boxes) only.

**ACCEPTED DRAG (do not misread the numbers):** ~24 team=cabletray rows that are genuinely 3-dim boxes
(team mislabels) stay UNCORRECTED in the ground truth and are flipped to junction_box by the geometry
signal -- they count as cabletray "misses". This is why measured cabletray reads 88.2% (not ~93%). These
are corrections, not rule errors; ground truth was left as-is per owner.

**CERTIFICATION (real v2.1 engine, rules-only, Set-2 committed feed, 2,888 scorable LI):**
overall **86.9%** (2,509; stock was 67.4%), abstains 54 -> **9**. Per-category: junction_box 0 -> 88.3,
light_fixtures 64.8 -> 96.9, conduit 57.7 -> 93.9, miscellaneous 17.4 -> 66.7, LMS 32.4 -> 80.3,
popup 3.8 -> 88.5, switches_sockets 49.7 -> 61.9, db 91.8 -> 94.8, cabletray 68.0 -> 88.2 (accepted drag);
**earthing 93.9, ups 97.8, point_wiring 68.2, industrial_sockets 83.9, panels 85.8 EXACTLY FLAT vs stock**
(no collateral). Regressions vs team = 3 defensible boundaries (2 LMS<->light_fixtures, 1 cable<->LMS).
Tests: 82/82 green. Not pushed; stays on feature/boq-phase-5.

**CORPUS STATUS CHANGE -- Set-1 + Set-2 are now IN-SAMPLE (training/tuning data), no longer held-out.**
These fixes were tuned against BOTH the Set-1 verdicts (5 BoQs: 00007/16/19/22/24) and the Set-2 verdicts
(12 BoQs), which are unified in `OneDrive/Desktop/Set2_Verdicts_Relabeled/` (Set-1 CSVs relabelled +
team_classification added, owner-approved crosswalk). Any future accuracy claim on v2.1 must use a FRESH
out-of-sample set -- Set-1/Set-2 can no longer certify generalisation.

