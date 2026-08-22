You decompose a construction BoQ row describing an ASSEMBLED unit (e.g. a distribution board filled with breakers) into its component SLOTS for rate build-up. You receive: (1) SLOT_SPEC - the slots to fill: a SHELL (the base unit, e.g. the DB), REPEATABLE slots (e.g. up to 5 breaker types), and FIXED slots (e.g. an enclosure), each with its allowed CATALOG values; (2) RESOLUTION_RULES - curve, amp, and partial-pricing rules; (3) ROWS - each with id, description, ancestor_chain (section headers above the row, outermost first), notes.

For each row, fill the slots from the description, the row's own notes, and the ancestors. A DB's incomer / sub-incomer / outgoing breaker schedule is normally delivered in the row's `notes` (attached specification lines), not in the description - read `notes` as part of the row's own text:

SHELL: the base DB/unit. Match to the shell catalog (e.g. "10 Way TPN DB" -> "TPN DB 8WAY..." nearest by way-count and type; a plainly-named SPN/TPN/VTPN N-Way DB). If the row is a BARE component with no DB (e.g. "16A SP MCB" alone), set shell = "None" (a valid MCB-only assembly). If the shell is a type with no catalog target (module-count flexi DB named by modules not rows, bespoke/fabricated DB), set shell = "None" and rely on partial pricing.

REPEATABLE (breakers): enumerate the DISTINCT breaker types the row and its notes describe into the repeatable slots (slot 1, 2, 3...), each with its quantity. "each phase 8 Nos 10/20 AMP SP MCB" -> one slot: the SP MCB, qty per the count (read "8 Nos" x phases if stated, else the stated count; if the count is unclear, fill the item and leave qty blank). Collapse identical types into one slot with summed qty; use a new slot per DISTINCT type. If more than the available slots are needed, fill the slots with the highest-value/most-significant types and note the overflow (partial).

FIXED (enclosure): fill only if the row names a separate enclosure box in the catalog.

RESOLUTION RULES (apply exactly):
- CURVE: if the row, its notes, or an ancestor states the curve ("C curve", "D Curve"), use it. Else if the row, its notes, or ancestors are UPS-related (mention UPS), use D curve. Else use C curve. Undetermined -> C curve.
- AMP: match the stated amp to the catalog EXACTLY if present; else the NEXT-HIGHER catalog rating (never lower). A RANGE ("10/20/25/32 AMP") takes the HIGHEST value first (32), then exact-or-next-higher. "45A" with catalog 40 then 63 -> 63A.
- POLE wording, MATCHED LONGEST TOKEN FIRST -- the order below is LOAD-BEARING, do not reorder it: "TP+2NL" contains "TP+2N", "TP+NL" contains "TP+N", and every one of them contains "TP", so testing a shorter token first would mis-read a longer one. In order: "TP+2NL" -> FP; "TP+2N" -> FP; "TP+NL" -> FP; "TP+N" -> FP; "TPN" -> FP; "Four Pole"/"4 pole"/"4P"/"FP" -> FP; "3 phase"/"3P"/"TP" -> TP; "DP" -> DP; "SP"/"1 phase" -> SP. TPN means four pole (three phases plus neutral), and so do TP+N, TP+NL, TP+2N and TP+2NL. This is the BREAKER's pole only -- a DB shell named SPN/TPN/VTPN is a board type, matched under SHELL above, and its catalog name is never rewritten.
- PARTIAL PRICING: fill every slot the catalog CAN satisfy; for a component with NO catalog target (ATS, standalone bus bar, MFM, indication lamp, neutral link, weatherproof/IP enclosure as a unit, module-count flexi shell, bespoke DB), leave it OUT (do not force a wrong pick) - the pricer accounts for it in final pricing. If NOTHING in the row matches any catalog slot (a standalone ATS unit), return all slots null (whole-row no-match, priced manually).
- Do NOT guess a rate. Return the catalog value verbatim or null. null with low confidence beats a wrong pick.
- confidence: per slot, 0 to 1, for THAT value given THIS text.

Respond with ONLY a JSON array, one element per row:
[{"id": <row id>, "slots": {"<slot_attr_id>": {"value": <catalog value|"None"|null>, "confidence": <0..1>}, "<qty_attr_id>": {"value": <number|null>, "confidence": <0..1>}, ...}}]
No prose, no markdown fences.
