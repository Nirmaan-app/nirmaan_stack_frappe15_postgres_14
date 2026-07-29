### Module 3 batched UI-fixes Part 3b -- Section-3 role tooltips

**Status:** COMPLETE (feat 8943e9ce). Frontend-only. File changed: `SheetConfigPanel.tsx` only. No .py files, no boqTypes.ts, no BoqHubPage.tsx, no SheetSpokePage.tsx, no SheetDataGrid.tsx touched. Parser tests 588 unchanged. tsc: 0 errors. Vite build: clean (confirmed exit 0).

**This is a refinement of Finding #4 (Part 3), not a new finding.** Batched UI-fixes slice remains CLOSED. Carry forward: 3e + 3f unchanged.

**Why Part 3b replaces Part 3's inline paragraph:**
The Part 3 paragraph described mechanical behavior ("same resolved amount", "replaces the notes field") rather than decision-oriented guidance ("when should I use this?"). It also crammed three distinctions into one dense block that users had to parse before opening the dropdown. Per-role tooltips give the help exactly when needed -- while browsing roles -- and are scoped to just the 6 confusable roles.

**Recon findings (portal safety):**

Two issues were identified before implementing:

**Issue 1 (DismissableLayer -- manageable):** `TooltipContent` portals to `document.body`. Radix Select's `DismissableLayer` fires on `pointerdown` outside SelectContent, not on hover events. Tooltip is hover-only (no pointerdown on tooltip content needed). Select will not close when a tooltip appears.

**Issue 2 (ItemText cloning -- REAL blocker for naive approach):** shadcn's `SelectItem` wraps ALL children in `SelectPrimitive.ItemText`. Radix `SelectValue` in the closed trigger clones `ItemText` content, so an icon placed inside shadcn's `SelectItem` would ALSO appear in the trigger's selected-value display. This is a visual bug.

**Resolution -- SelectPrimitive approach:**
For the 6 confusable roles, `SelectPrimitive.Item` (from `@radix-ui/react-select`) is used directly instead of shadcn's `SelectItem`. The structure:
```tsx
<SelectPrimitive.Item value={r.value} disabled={...} className={SHADCN_ITEM_CLASSES}>
  <span className="absolute right-2 ...">
    <SelectPrimitive.ItemIndicator>
      <Check className="h-4 w-4" />  {/* lucide Check, not @radix-ui/react-icons CheckIcon */}
    </SelectPrimitive.ItemIndicator>
  </span>
  <SelectPrimitive.ItemText>{r.label}</SelectPrimitive.ItemText>  {/* label only → trigger display */}
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="ml-1.5 inline-flex items-center shrink-0">
        <Info className="h-3 w-3 text-muted-foreground/60" />
      </span>
    </TooltipTrigger>
    <TooltipContent side="right" className="max-w-56 leading-relaxed">
      {helpText}
    </TooltipContent>
  </Tooltip>
</SelectPrimitive.Item>
```

The icon is a sibling to `ItemText` (not inside it), so it does NOT appear in the trigger. Non-confusable roles continue to use shadcn's plain `SelectItem` unchanged.

**ROLE_HELP_TEXT constant (local to SheetConfigPanel -- not in boqTypes.ts):**
One-component copy, not shared across wizard files. boqTypes.ts has ROLE_LABELS (shared for badge sync); help text is display-only copy, no sharing needed.

**TooltipProvider:** Mounted at the SheetConfigPanel return wrapper (wraps the outer `<div>`). Pattern matches existing wizard uses (BoqHubPage, SheetCard, BoqUploadScreen all mount locally). `delayDuration={300}`.

**Tooltip wording (6 roles, owner-approved verbatim):**
- `qty`: "Use for a normal quantity column."
- `qty_total`: "Use ONLY when the column is a sum of other quantity columns -- usually the 'total' area in a multi-area sheet that adds up the individual areas."
- `amount_total`: "Standard amount column. Same result as Amount (Combined) -- pick the one whose header label matches your sheet."
- `amount_combined`: "Same result as Amount (Total). Choose this if your column header says 'SITC', 'S&I', or 'Combined'."
- `row_notes`: "Use for a single remarks/notes column. Replaces the notes field."
- `append_to_notes`: "Use when several columns should be combined together into the notes field."

**Manual test plan (Part 3b -- hard-reload :8080 before testing; no Vite restart needed):**
1. **INLINE PARAGRAPH REMOVED:** Section 3 heading should have NO dense muted-foreground paragraph below it. The heading is followed directly by the column-role rows.
2. **TOOLTIP ON CONFUSABLE ROLES:** Open the role dropdown. The 6 confusable roles (Quantity, Total Quantity, Amount (Total), Amount (Combined), Row Notes, Append to Notes) each have a small `ℹ` icon to the right of the label. Hover the icon -- tooltip appears to the right with the decision-oriented wording. The dropdown stays open while hovering.
3. **TRIGGER DISPLAY CLEAN:** Select "Quantity" as a role. The closed SelectTrigger shows "Quantity" (label only). No icon appears in the trigger display.
4. **NON-CONFUSABLE ROLES UNCHANGED:** Other roles (sl_no, description, unit, rate_*, amount_supply, amount_install, amount_by_area, make_model, reference_images, ignore) have no icon. Render as plain text items.
5. **SELECT STILL WORKS:** Clicking a confusable role item (anywhere on the row, including near the icon) still selects it. Icon is informational only.
6. **SPARKLE/OPACITY:** The column_role_map opacity-50 sparkle state does not affect the inline paragraph (it's gone). No regression on Section 1/2 sparkle.
7. **REGRESSION:** #5 unmapped-column warning text, Section 1/2 controls, save logic all unaffected.

---

