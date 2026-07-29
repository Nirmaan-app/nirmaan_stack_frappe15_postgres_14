### Hub footer toolbar rework -- export overflow menu + compact + rename (FRONTEND, presentational, NO migrate, base tip d3539e5b, 2026-06-25)

**Declutter the hub parse-gate footer action row** (was 6 buttons -> too crowded; squeezed the status line into a thin
column). Frontend-only, presentational -- NO backend / schema / migrate / dialog-logic change.

- **4 buttons stay visible** (reordered, Parse first): **Parse workbook** (primary) / **Re-parse** / **Commit** /
  **Tendering**. Their gate expressions (`!canParse || parseInFlight`, `!canReparse || parseInFlight`,
  `committableSheets.length === 0`, `committedMap.size === 0`), `onClick` handlers, and Tooltip-as-disabled-reason wrappers
  are UNCHANGED -- only order + size changed.
- **The 2 export actions moved into an "Export" overflow `DropdownMenu`** (mirrors the in-file header "More options"
  pattern; reuses `@/components/ui/dropdown-menu`). The trigger is a labelled **"Export" + `ChevronDown`** Button (NOT the
  bare `MoreHorizontal` "More options" card menu -- distinct on purpose). Items: **Export Parsed BoQ** (renamed; D2b;
  `setExportDialogOpen(true)`; gate `exportEligibleSheetNames.length === 0`) + **Download priced tender** (5b;
  `setPricedDialogOpen(true)`; gate `committedMap.size === 0`), each with a `<Download/>` icon. The dialogs + open-state
  setters + mounts are UNTOUCHED -- only the triggers relocated (purely presentational; same gate, same handler).
- **Disabled-reason in the menu (option c):** a disabled Radix menu item suppresses pointer events, so a hover-tooltip is
  unreliable -- instead each export item is `disabled` when its gate is unmet AND a muted inline reason line
  (`DropdownMenuLabel`, `text-xs font-normal text-muted-foreground pl-8`) renders ONLY when disabled, reusing the EXISTING
  reason strings ("No checked sheets to export" / "No committed sheets to price yet"). When enabled, no reason line. The
  menu **trigger stays always-clickable** (the two gates are independent -- the menu must open to show which export is
  available + why the other is greyed).
- **`size="sm"` on all 4 buttons + the Export trigger** -> a tighter row; the status line (the `justify-between` sibling,
  content/structure UNCHANGED) regains horizontal space.
- **Rename "Export Finalized" -> "Export Parsed BoQ":** the menu item label + the `ExportWorkbookDialog` title
  ("Export Parsed BoQ to Excel") + stale comments (BoqHubPage + PricedTenderDialog). Internal identifiers
  (`ExportWorkbookDialog` / `exportReviewXlsx` / `exportEligibleSheetNames` / `setExportDialogOpen`) UNCHANGED. No test
  asserts the old literal (grep-verified).

tsc 3175 (0 new), vitest 307 (unchanged -- no testable pure helper added; presentational). NO backend tests, NO migrate.
The visual result (uncluttered row, menu opens, disabled reasons show, rename reads correctly) is OWNER-CERTIFIED LIVE
(not unit-provable headless).

