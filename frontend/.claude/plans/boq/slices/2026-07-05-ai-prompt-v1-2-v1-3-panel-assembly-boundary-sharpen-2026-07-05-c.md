### AI prompt v1.2 -> v1.3 -- panel-assembly boundary sharpen -- 2026-07-05, COMMITTED (feat 196d1e64)

Sharpen ONLY the AI voter's "Panel-assembly precedence" boundary (prompt file
`prompts/electrical_ai_category_prompt.md`, v1.2 -> v1.3). Three edits; the frozen 15, output
contract, and Option-B independence are VERBATIM. No code / rules / harness / test change.

WHY (evidence): the full-corpus (Set-1+Set-2) panels<->db boundary dump
(`Panels_DB_Boundary_Analysis_2026-07-05.md`) found **36 of 50 verified db->panels flips are
DB-SCHEDULE OVERSHOOT** -- distribution-board schedules ("N Way SPN/TPN MCB DB", "Outgoing: N Nos
MCB", "HUB Room UDB's") that v1.2 wrongly treated as panel builds. Root cause = v1.2's OWN wording,
which listed "MDB / DB-schedule" as a panel-build trigger; the AI cited it verbatim ("Outgoing MCB
itemised within the DB-schedule assembly -> panels"). Only 14/50 (genuine LT-PANEL-section rows) were
defensible (team label loose). The Q2 panels->db misses (53) are NOT overshoot (9 genuine panel MCCBs
the AI missed + 44 ambiguous motor starters).

THE THREE EDITS:
1. REMOVED "MDB / DB-schedule" from the Panel-assembly precedence trigger list; the trigger is now a
   FABRICATED LT/MCC/control PANEL section only ("LT PANELS", "shall consist of", a named main/sub panel).
2. ADDED an explicit exclusion sub-bullet: a distribution-board SCHEDULE (an "N Way MCB DB" itemising
   incomer / sub-incomer / outgoing breakers) is `db_switchgear`, NOT a panel.
3. ADDED the owner's standing pricing convention (approved verdict crosswalk) sub-bullet: motor starters
   (DOL / star-delta / starter panels) itemised as panel equipment are `panels`, not `db_switchgear`.

STATUS: **v1.3 is UNMEASURED.** Owner decision -- routing absorbs boundary disagreements, so v1.3 is NOT
re-run now; it is certified at the next out-of-sample (Set-3) cycle. **All routing / yield numbers on
record (94.7% auto-accept @ 91.0%, the §21.6 cross-tab, the auto-accept error analysis, the escalation
curve) remain v1.2-based** -- re-derive them on the Set-3 rerun if v1.3's boundary shift matters. No push.

