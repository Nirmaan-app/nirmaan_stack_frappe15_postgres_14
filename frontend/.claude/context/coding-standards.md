# Coding Standards

## Date Format
**All dates displayed to users must use `dd-MMM-yyyy` format** (e.g., "15-Jan-2026").

- Use `formatDate()` from `src/utils/FormatDate.ts` for standard date formatting
- Use `formatDeadlineShort()` from page-specific utils if available
- For date-fns operations, use format pattern `dd-MMM-yyyy`
- Never use formats like `MM/dd/yyyy`, `yyyy-MM-dd`, or ordinal formats ("15th Jan") for display

```typescript
// Correct - dd-MMM-yyyy format
import { formatDate } from "@/utils/FormatDate";
formatDate(dateString); // Returns "15-Jan-2026"

// For manual formatting
const day = date.toLocaleString('default', { day: '2-digit' });
const month = date.toLocaleString('default', { month: 'short' });
const year = date.toLocaleString('default', { year: 'numeric' });
return `${day}-${month}-${year}`; // "15-Jan-2026"
```

---

## React-Select Search Pattern

When using react-select for searchable dropdowns with >50 options, use `FuzzySearchSelect` from `@/components/ui/fuzzy-search-select.tsx` instead of plain ReactSelect.

**Why:** Default react-select uses simple substring matching on label only. FuzzySearchSelect provides:
- Multi-field search (label + value/ID)
- Token-based matching ("proj 2024" finds items matching both tokens)
- Partial word matching ("act" finds "actuators")
- Relevance scoring and ranking
- Field weighting (label > value)

**Pattern:**
```tsx
import { FuzzySearchSelect, TokenSearchConfig } from "@/components/ui/fuzzy-search-select";

const searchConfig: TokenSearchConfig = {
    searchFields: ['label', 'value'],
    partialMatch: true,
    fieldWeights: { label: 2.0, value: 1.5 }
};

<FuzzySearchSelect
    allOptions={options}
    tokenSearchConfig={searchConfig}
    onChange={handleChange}
    // ...other react-select props
/>
```

**Components using this pattern:**
- `ProjectSelect` (`components/custom-select/project-select.tsx`) - Project selection dropdowns
- `ItemSelectorControls` - Item selection in PR creation

When reviewing or creating react-select components, check if FuzzySearchSelect would improve the UX.

---

## React-Select in Radix UI Dialogs (AlertDialog/Dialog)

**Problem:** When using react-select inside Radix UI AlertDialog or Dialog, the dropdown menu becomes unclickable and unscrollable.

**Root Cause:** Radix UI dialogs set `pointer-events: none` on the `<body>` when modal. When react-select portals its menu to `document.body`, those elements inherit `pointer-events: none`.

**Solution:** The centralized theme in `src/config/selectTheme.ts` includes `pointerEvents: 'auto'` on menu, menuPortal, menuList, and option styles.

**Usage with ProjectSelect:**
```tsx
// Inside a dialog, use the usePortal prop
<ProjectSelect
    onChange={handleChange}
    universal={false}
    usePortal  // Enables menuPortalTarget={document.body} with proper pointer-events
/>
```

**If creating a new select component:**
```tsx
import { getSelectStyles } from "@/config/selectTheme";

// The default styles already include the pointer-events fix
<ReactSelect
    styles={getSelectStyles()}
    menuPortalTarget={document.body}
    menuPosition="fixed"
    // ...other props
/>
```

**Key files:**
- `src/config/selectTheme.ts` - Centralized theme with pointer-events fix
- `src/components/ui/fuzzy-search-select.tsx` - Applies theme automatically
- `src/components/custom-select/project-select.tsx` - Has `usePortal` prop
