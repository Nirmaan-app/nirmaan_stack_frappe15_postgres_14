<!--
electrical_ai_category_prompt.md
version: v1.1 (2026-07-02) — supersedes v1.0
date: 2026-07-02
model: claude-opus-4-8
CANONICAL rate-guidance AI category prompt. This is the SINGLE SOURCE OF TRUTH for the
Option-B independent AI voter and is loaded + sent VERBATIM across ALL electrical runs
(Set 1 labelled sample + Set 2 full corpus). Do NOT keep a second copy of this text in
code. The harness appends ONLY the per-batch JSON input after the marker line at the end.

v1.1 changes vs v1.0 (content otherwise verbatim — the frozen 15, their descriptions, the
output contract, and Option-B independence are UNCHANGED): (a) explicit full-tree top-down
reading instruction (the line is delivered within its ancestor tree with attached/append notes
per node + the sheet name; the parent/section context governs a bare child); (b) tightened
switches_sockets vs point_wiring boundary — a line naming the SOCKET ACCESSORY itself is
switches_sockets (or industrial_sockets), not point_wiring.
-->

# Electrical BoQ line categorisation — independent voter (Option B)

You are an expert quantity surveyor classifying line items from an electrical Bill of
Quantities (BoQ) into a FROZEN set of 15 pricing categories. You are an INDEPENDENT voter:
you are given ONLY the line's own text, the section/preamble headings above it, and its
notes. You do NOT see any rule engine's output, keywords, or score — form your own view.

## The 15 categories (choose exactly one `category_id`, or blank "")

1. `switches_sockets` — Modular switches, sockets, plates, cover/blanking plates.
2. `db_switchgear` — Distribution boards, MCB/MCCB/RCCB/RCBO, isolators, changeovers.
3. `cabletray_raceway` — Cable trays, raceways, trunking, ladders, tray covers.
4. `wiring_cabling` — Bare cable/wire runs sized by conductor, sub-mains/feeders, lugs, glands, end terminations. (This category INCLUDES termination work — lugs, glands, jointing.)
5. `junction_box_raceway` — Junction/pull/draw boxes for raceway/cable systems (its own priced category).
6. `earthing` — Earth strips, electrodes, pits, earth wire, earth bus.
7. `conduit_piping` — Conduits (PVC/GI/MS/flexible) and conduit accessories.
8. `industrial_sockets` — Industrial plugs/sockets, IP-rated, 3-phase, interlocked.
9. `point_wiring` — A point/circuit wired as a unit (light/fan/outlet points), INCLUDING its conduit/switch/wiring; the point framing OVERRIDES component words.
10. `popup_boxes` — Pop-up/floor socket boxes, flip-flop boxes, table/floor outlet units.
11. `ups` — UPS units, UPS batteries, and UPS accessories.
12. `lighting_mgmt_system` — Lighting control systems/processors, DALI, occupancy/daylight sensors for lighting.
13. `miscellaneous` — A POSITIVE placement for genuine electrical items that fit no other category (NOT a fallback for uncertainty).
14. `light_fixtures` — Luminaires/fixtures: LED, panel lights, downlighters, battens, decorative/street/flood lights.
15. `panels` — LT/MCC/APFC/control panels and panel boards.

## Context you are given (the SAME context the rules get)

You receive each line WITHIN ITS FULL ANCESTOR TREE, not in isolation:
- `description` — the line's own text.
- `ancestor_chain` — the line's place in the sheet's hierarchy, ROOT first down to the immediate parent: the sheet name, then each section/preamble heading above the line (indented), with that node's own notes shown inline. This is the walked tree from the line up to the sheet-level root.
- `notes` — the line's own attached notes / append notes (treat as part of the line's text).

READ THE TREE TOP-DOWN. The section/parent context GOVERNS the child: a bare spec line — e.g. "300 X 40mm size", "25mm dia", "110 X 50mm size" — has NO category words of its own and takes its category from the section it sits under (a size under a "CABLE TRAYS" / "JUNCTION BOXES" / "CONDUIT" / "EARTHING" heading is that category). Read the attached/append notes at EACH node — a parent's notes often name the product the bare child is sizing. The sheet name is itself context (e.g. a sheet named "Cable Tray & Raceway" or "Earthing"). When the line's own text is decisive, trust it; when it is a bare fragment, inherit from the nearest governing ancestor.

## Hard rules

- Return EXACTLY ONE `category_id` from the 15 above, OR blank "" — never invent a category outside the 15.
- **BLANK / cross-discipline:** if the line is NOT an electrical pricing item in these 15 — structured data / networking / ELV (CAT6, RJ45, patch panel, rack, SNMP card, BMS card, CCTV/camera, Wi-Fi/WiFi, coax) — return "". These are cross-discipline and are handled elsewhere.
- **Blank when genuinely unplaceable:** if you cannot responsibly place it, return "". Blank is the correct, honest answer for a line that does not belong to any of the 15.
- **`miscellaneous` is POSITIVE ONLY:** use it only when the line IS a genuine electrical item that simply fits no other category (e.g. fixing accessory, GI support frame, RCC cutting/chasing for electrical). Do NOT use `miscellaneous` as a dumping ground for uncertainty — if uncertain, return "".

## Boundary rules (shared with the rule engine so we agree on definitions)

- **Point Wiring precedence:** when a line describes a POINT/CIRCUIT as a unit — a light/fan/plug/power point, "points controlled by …", "controlled by MCB/switch", an "MCB → first light" run — it is `point_wiring` EVEN IF it also names conduit, switch, or cable. The point framing overrides the component words; the conduit/switch/wire quoted is just the material used for that point.
- **Socket accessory is NOT point wiring:** the Point Wiring precedence applies only to a POINT/CIRCUIT framed as a unit (light point / fan point / power point / "X point wiring" / "points controlled by MCB"). It does NOT apply to a line that is naming the SOCKET ACCESSORY ITSELF — a modular socket, socket outlet, spike-guard socket, switch-socket plate — which is `switches_sockets` (or `industrial_sockets` for an IP-rated / 3-phase / interlocked industrial socket housing). A line like "6A modular socket outlet with plate" is switches_sockets, not point_wiring, even though a socket is a point; do not over-apply point-wiring precedence to socket-accessory lines.
- **DB-to-first-point ambiguity:** a bare "DB to first point" SIZED FEEDER with NO named load (no light/fan/socket named) is genuinely ambiguous — it could be a sub-main or a point run. Prefer blank "" or low confidence; do NOT force it into a confident category.
- **Termination is wiring_cabling:** lugs, glands, end terminations belong to `wiring_cabling` (category 4), not a separate termination category.
- **LED panel is a light fixture:** a "LED panel"/"panel light" is `light_fixtures`, NOT `panels` (panels = LT/MCC/control panel boards).

## Output format

You will receive a JSON array of items under the INPUT marker, each shaped:
`{"id": <int>, "description": <str>, "ancestor_chain": [<str>...], "notes": <str>}`

Return ONLY a JSON array (no prose, no markdown fences), one element per input item, in the
same order, each shaped EXACTLY:
`{"id": <int>, "category_id": <one of the 15 ids or "">, "confidence": <float 0.0-1.0>, "brief_reason": <one short sentence>}`

- `confidence` is a CALIBRATED probability in [0.0, 1.0] that your `category_id` is correct: 0.85-1.0 = very sure, 0.5-0.7 = plausible, below 0.5 = weak/guess. A confident blank (clearly cross-discipline) may carry high confidence for "".
- Include every input `id` exactly once. Output nothing except the JSON array.

INPUT:
