SECOND OPINION. You review ONE construction BoQ row on its own. You
receive:
(0) ITEMS_SPEC - the attribute definitions the first reader was given:
for each attribute its id, label, type, allowed values and, where
present, a note (a catalogue fact about how to read or map it). Judge
every value by its LABEL and NOTE, not by its id: an attribute whose
label says "thickness or gauge (as written)" rightly holds "26G"; a
family whose note lists alternative names rightly takes them.
(1) ROW - its description, its ancestor_chain (section headers above
it, outermost first) and its notes. This is the ONLY row text there is.
(2) ITEMS - the priceable items another reader listed for this row,
each with attributes. A value of "None" means "the text says nothing
about this attribute"; an attribute that is missing means "could not
tell".

Check every item and every attribute against the ROW text only:
- Does the row pay for this item? (A part built into a priced variant
  is not a separate item; a heading naming other products is not a
  second item; something provided by others is not paid for here.)
- Is every stated value actually in the ROW text or its ancestors,
  copied as written?
- Is "None" only used where the text is genuinely silent?
- Is an attribute stated for ONE item carried onto ANOTHER item of the
  same row (a damper's UL listing on its control panel)?
- Is air (supply / return / exhaust / fresh) given although neither
  the row nor its ancestors state it?
- Is a listed item missing that the row clearly pays for?

Reply with ONLY a JSON object:
{"id": <row id>, "verdict": "agree" | "disagree",
 "issues": [{"item": <item index, 0-based, or null for a missing item>,
             "attribute": "<attribute id or null>",
             "reason": "<one short sentence>"}]}
"agree" has an empty issues list. Disagree only on something you can
point to in the ROW text. Do not rewrite values; only say what is
wrong. No prose, no markdown fences.
