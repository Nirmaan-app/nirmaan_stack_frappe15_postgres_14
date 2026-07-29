## Phase 5 — X: commit all classified rows as semantic nodes (BACKEND, feat 711a792b, 2026-06-17)

**Goal.** Make the committed node tree a COMPLETE SEMANTIC MIRROR of the reviewed BoQ. Before X, only
`preamble` + `line_item` committed as BOQ Nodes; `note` / `subtotal_marker` / `header_repeat` were grid-only, so
the node layer was not a full semantic record. The dogfood surfaced a note (e.g. BOQ-26-00145 'Electrical ' "Aluminium
Cables" / its XLPE spec paragraph) losing its discrete classification + parent in the node tree. X commits every
classified row EXCEPT spacer, carrying its classification + parent + details — so the node tree equals the review
output minus only the dropped parser-QA fields.

**Read-only recon (prior turn) — the live corpus.** classification counts: line_item 465, note 268, spacer 225,
preamble 127, subtotal_marker 9, **header_repeat 0** (does not occur — handled defensively only). Parenting (via
`resolve_effective`): note→preamble 265 / note→root 3; spacer→root 225 (all); subtotal_marker→root 9 (all);
**zero non-priceable rows under non-priceable parents** (the tree stays clean: notes hang under preambles,
spacers/subtotals float at root). Field population: notes carry rich `description` + a real parent (+ occasionally
unit/row_notes), no money; subtotal_markers carry `description="TOTAL"`, no computed sum, root; spacers carry NOTHING
(no description) — pure layout.

**Node shape = OPTION A (owner-locked).** `node_type` stays the PRICEABILITY axis (Preamble / Line Item) + a NEW
neutral 3rd Select value `Other` for non-priceable rows; a NEW field `row_class` (Data) carries the FULL effective
classification (the taxonomy axis). A future external pricing engine selects priceable rows with exactly
`node_type in (Preamble, Line Item)` — unchanged, and without needing the full taxonomy. Option B (adding
note/spacer/etc. as node_type values) was rejected: it redefines node_type's domain and would force an audit of
every node_type consumer; Option A is strictly additive (existing two values' meaning byte-identical).

**Rows committed as nodes.** preamble, line_item, note, subtotal_marker, AND header_repeat (defensive — zero live
data). **SPACER alone stays grid-only** — pure layout, no semantic content; the faithful grid (3a) already preserves
its position. The filter is "commit everything EXCEPT spacer", not "only preamble+line_item".

**Per-type commit mapping.** preamble → node_type Preamble + level (existing rules + the Q8 fix); line_item →
Line Item (no level); note → Other, row_class note, description (the note text), parent_node = its preamble parent
(wired by pass 2), unit/row_notes carried if present, NO qty/rate/amount; subtotal_marker → Other, row_class
subtotal_marker, description ("TOTAL"), root, NO computed sum; header_repeat → Other, row_class header_repeat,
description carried (defensive). `row_class` = the full effective classification for EVERY node.

**NO note re-attach (critical).** The parser ALREADY rolls each descendant note's text onto its nearest-ancestor
preamble's `attached_notes` at parse time (recon: populated on 84 preamble review rows, NEVER on note rows; e.g.
'Electrical ' row 24 "LT CABLES" already carries all 7 of its descendant notes), and 3b carries `attached_notes`
verbatim onto the preamble node. X commits the note as its OWN discrete node WITHOUT a second walk-and-attach — a
second attach would DOUBLE the text. preamble/line_item commit exactly as before, including the existing
attached_notes carry. (The brief's premise that row 24 was empty was false; verified read-only first.)

**Implementation.**
- `boq_nodes.json`: `node_type` Select `Preamble\nLine Item` → `Preamble\nLine Item\nOther`; new `row_class` Data
  field placed after node_type. Migrate CLEAN (additive Select value + one Data field — verified `row_class`
  column + the `Other` option via `get_meta`).
- `integrations/controllers/boq_nodes.py`: the description-required throw is gated to
  `node_type in ("Preamble", "Line Item")` so an `Other` node may be contentless and no-ops. Recon confirmed EVERY
  other validation branch already falls through both `if/elif` for `Other` (Preamble level rules, Line-Item
  level-unset/qty-required, parent rules, combined_rate, qty_by_area) — no other relaxation needed. `row_class` is
  stored, never validated.
- `commit_pipeline.py`: `_NODE_CLASSIFICATIONS` retired → `_PRICEABLE_CLASSIFICATIONS` (={preamble,line_item}; drives
  node_type + the level calc) + `_GRID_ONLY_CLASSIFICATIONS` (={spacer}; the skip set). `_commit_node_tree`'s filter
  flips to "in grid-only-set → skip". `_build_node_pass1` sets `node.row_class = effective_classification` for every
  node and node_type via a 3-way branch (preamble→Preamble+level, line_item→Line Item, else→Other); the
  `qty None → 0` default stays Line-Item-only.
- **Q8 level-guard fix (mandatory — X breaks it otherwise).** `_compute_levelless_preamble_levels` now counts ONLY
  PRICEABLE (preamble/line_item) children toward `child_levels`; a note/subtotal carries level 0 and would wrongly
  pull a level-less preamble to level 0. A preamble whose only children are non-priceable now falls to the childless
  branch. The 3 existing level-less cases are unaffected (their children are preambles).

**Tests.** `test_commit_pipeline` 23→27 (+4: commit-all-except-spacer [note+subtotal→Other, correct row_class, note
wired to preamble, spacer NOT a node]; Other note carries description + no money; attached_notes NOT doubled; Q8
note-child excluded from the level calc; + the 2 existing node-tree tests retargeted in place — note now a node,
counts 3→4). `test_boq_nodes` 72→74 (+2: Other saves cleanly [no level/qty]; Other under a Preamble saves).
`test_review_screen` 158 UNCHANGED (import safe); parser 597 UNCHANGED. `bench migrate` CLEAN.

**OWED — SEPARATE NEXT runs before push:** RE-COMMIT all affected finalized sheets (the live committed nodes still
reflect the pre-X 2-type tree) + a round-trip RE-VERIFY with an attached_notes verification column. Pure-backend →
root CLAUDE.md + this plan; frontend/CLAUDE.md NOT touched (no frontend reads nodes).

