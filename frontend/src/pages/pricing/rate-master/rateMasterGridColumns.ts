/**
 * THE ONE ORDERING OF THE RATE MASTER DATA VIEWER'S COLUMNS.
 *
 * ⚠️ WHY THIS MODULE EXISTS. The header row, the formula row and every body row each used to carry
 * their OWN copy of the column order, written out as JSX. On 2026-10-03 commit `8fa8d3262` moved the
 * `unit` HEADER to sit just after `brand` -- "where the rate file puts it" -- and left the body cell
 * after the rate columns. From that moment every grid of every category except Pricing Inputs rendered
 * its values ONE PLACE LEFT of their headings: on Electrical's wiring grid the unit "Set" appeared
 * under `lug_list`, "COPPER" under `Insulation`, a price under `Conduit size (mm)`; on HVAC Insulation
 * the material sat under `Type` and a markup under `cost_supply`.
 *
 * ⚠️ THE DEFECT WAS INVISIBLE BECAUSE EVERY FIGURE ON THE SCREEN WAS STILL PLAUSIBLE -- only its label
 * was wrong. The DOWNLOAD was correct throughout, so nothing downstream broke and no test noticed; the
 * grid simply lied to whoever read it. That is the whole argument for one list: a second ordering does
 * not announce itself when it drifts, it just mislabels money.
 *
 * So: this function is the single source of the order, and the header, the formula row and the body
 * all MAP OVER IT. A column cannot move in one place any more -- there is only one place.
 *
 * It is PURE and imports nothing from React, so it is unit-testable in this repo's node-only vitest
 * environment (frontend/CLAUDE.md records that there is deliberately no DOM environment, which is
 * exactly why the order had to be extracted rather than tested through a render).
 */

/** A column's stable key. Attribute and rate columns carry their own id after the prefix. */
export type GridColumnKey = string;

export interface GridColumnInputs {
  /** The admin actions column -- absent entirely for a non-admin. */
  canEdit: boolean;
  /** The `kind` column, shown only for a category whose items span more than one kind. */
  showKindCol: boolean;
  /** Pricing Inputs render: a different column set, and `unit` sits AFTER the numbers. */
  piMode: boolean;
  /** A spec-driven category: the text pair leads and the spec verdict follows. */
  specMode: boolean;
  /** Pricing Inputs only: the distinct-SKU count column. */
  showImpactCol: boolean;
  /** Spec-driven text columns, in order. */
  textCols: ReadonlyArray<{ id: string }>;
  /** Attribute columns, in order. */
  attrCols: ReadonlyArray<{ id: string }>;
  /** Rate columns, in order. */
  rateCols: ReadonlyArray<string>;
}

export const COL_ACTIONS = "actions";
export const COL_KIND = "kind";
export const COL_SPEC = "spec";
export const COL_PI_NAME = "pi:name";
export const COL_BRAND = "brand";
export const COL_UNIT = "unit";
export const COL_PI_SHARED_BY = "pi:shared_by";
export const COL_PI_USED_BY = "pi:used_by";
export const COL_PI_ITEMS = "pi:items";
export const COL_SOURCE_SHEET = "source_sheet";
export const COL_SOURCE_ROW = "source_row";
export const COL_FORMULA_SUPPLY = "formula:supply";
export const COL_FORMULA_INSTALL = "formula:install";

export const attrColKey = (id: string): GridColumnKey => `attr:${id}`;
export const rateColKey = (k: string): GridColumnKey => `rate:${k}`;

/**
 * The columns of one grid, in render order. The header, the formula row and every body row map over
 * exactly this list.
 *
 * ⚠️ `unit` APPEARS ONCE, IN ONE OF TWO PLACES, AND THAT IS THE RULE THE DEFECT BROKE: right after
 * `brand` for a SKU grid (where the rate file puts it), and after the rate columns in Pricing Inputs
 * (where that page has always put it). Because both the header and the body read this list, the two
 * can no longer disagree about which it is.
 */
export function gridColumnKeys(o: GridColumnInputs): GridColumnKey[] {
  const keys: GridColumnKey[] = [];
  if (o.canEdit) keys.push(COL_ACTIONS);
  if (o.showKindCol) keys.push(COL_KIND);
  for (const d of o.textCols) keys.push(attrColKey(d.id));
  if (o.specMode) keys.push(COL_SPEC);
  if (o.piMode) keys.push(COL_PI_NAME);
  if (!o.piMode) {
    keys.push(COL_BRAND);
    keys.push(COL_UNIT);
  }
  for (const d of o.attrCols) keys.push(attrColKey(d.id));
  for (const k of o.rateCols) keys.push(rateColKey(k));
  if (o.piMode) {
    keys.push(COL_UNIT);
    keys.push(COL_PI_SHARED_BY);
    keys.push(COL_PI_USED_BY);
    if (o.showImpactCol) keys.push(COL_PI_ITEMS);
  } else {
    keys.push(COL_SOURCE_SHEET);
    keys.push(COL_SOURCE_ROW);
    keys.push(COL_FORMULA_SUPPLY);
    keys.push(COL_FORMULA_INSTALL);
  }
  return keys;
}

/**
 * The subset of the order that corresponds to a column of the DOWNLOAD, in the same order.
 *
 * The grid shows columns the file does not (the admin `actions`, the Pricing-Inputs `shared by` /
 * `used by` / `items`) and the file carries columns the grid does not (`item_uid`, `discipline`,
 * `category`), so the two lists are not equal -- but the columns they SHARE must appear in the same
 * sequence, which is what `8fa8d3262` set out to achieve and what the tests assert.
 */
export function gridColumnsSharedWithFile(keys: ReadonlyArray<GridColumnKey>): GridColumnKey[] {
  const screenOnly = new Set<GridColumnKey>([
    COL_ACTIONS, COL_SPEC, COL_PI_SHARED_BY, COL_PI_USED_BY, COL_PI_ITEMS,
    COL_SOURCE_SHEET, COL_SOURCE_ROW, COL_FORMULA_SUPPLY, COL_FORMULA_INSTALL, COL_PI_NAME,
  ]);
  return keys.filter((k) => !screenOnly.has(k));
}
