### Module 3 batched UI-fixes Part 3 -- Finding #4 + #5 copy fix

**Status:** COMPLETE (feat 25ed4b48). Frontend-only. File changed: `SheetConfigPanel.tsx` only. No .py files, no boqTypes.ts, no BoqHubPage.tsx, no SheetSpokePage.tsx, no SheetDataGrid.tsx touched. Parser tests 588 unchanged. tsc: 0 errors. Vite build: clean.

**This commit closes the batched UI-fixes slice.** All five findings are now done:
- Finding #1: Part 1 (feat bdf32e37) -- S1 top-header Yes/No conditional subform.
- Finding #2: Part 1 (feat bdf32e37) -- data-start-row plain inline text.
- Finding #3: Part 2 (feat 2f8bf533) -- hub back-to-project semantic route.
- Finding #4: Part 3 (feat 25ed4b48) -- Section-3 role helper text (helper-text-only; dropdown removal OFF per prior recon).
- Finding #5: Part 1 (feat bdf32e37) -- unmapped-column amber warning. Part 3 copy fix.

**Carry forward:** Module 3 COMPLETE (3a-3f). Module 4 (review-parsed-output screen) next.

**Finding #4 -- Section-3 role helper text (helper-text-only, dropdown removal OFF):**

Per prior recon (Part 1 session): auto-guess CAN emit `amount_combined` (5 keyword entries in classifier.py `_HEADER_KW["amount_combined"]`: "sitc amount", "s&i amount", "s+i amount", "supply & installation amount", "combined amount"). Removing the role from the dropdown would break pre-filled configs on SITC/S&I sheets -- OFF remains final.

A static `<p className="text-xs text-muted-foreground">` note was added between the Section 3 heading and the opacity-50 wrapper. Placement outside the wrapper means it stays readable at full opacity even when the map is unconfirmed (sparkle state). No new data structure, no tooltip component, no ROLE_LABELS extension -- the note is a one-off static string.

**Wording (three pairs from parser-checks B/C/D):**
- **amount_total vs amount_combined:** "same resolved amount -- pick whichever matches your sheet's header wording." (Parser-check B: output-equivalent; user distinction is purely terminological.)
- **row_notes vs append_to_notes:** "Row Notes replaces the notes field (one source); Append to Notes accumulates from multiple columns." (Parser-check C: genuinely distinct behaviors.)
- **qty vs qty_total:** "set distinct parser fields -- not interchangeable." (Parser-check D: REVISED the earlier assumption of equivalence; non-equivalence made explicit.)

**Finding #5 copy fix:**

The closing line of the unmapped-column amber warning was:
> "Assign roles above to include these columns, then save again."

"save again" implied the first save failed or was incomplete. The save is non-blocking and already completed before the warning renders. Changed to:
> "Assign roles above and save to include them."

Logic unchanged. Only the warning text was edited (line 968 in the updated file).

**Manual test plan (Part 3 -- restart Vite + hard-reload :8080 before testing):**
1. ~~HELPER TEXT~~ (superseded by Part 3b -- the inline paragraph is REMOVED in Part 3b).
2. **DROPDOWN UNCHANGED:** Open the role dropdown -- all 21 roles still present including amount_combined. No roles added or removed.
3. **#5 COPY FIX:** Map only some columns (leave one with data unmapped). Save -- amber warning appears. Last line should read "Assign roles above and save to include them." (not "save again").
4. **REGRESSION:** Section 1/2 controls, sparkle behavior, save logic, area reconciliation, singleton enforcement all unaffected.

---

