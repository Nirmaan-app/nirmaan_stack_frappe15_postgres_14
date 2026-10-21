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
  /**
   * ADP-4b (owner D7 / AC3): a spec-driven grid shows EXACTLY the download's columns by default; this toggle ("Show
   * spec details", off by default) adds the spec verdict, the "read from spec" columns, the source sheet and row.
   * Read only in `specMode`.
   */
  showSpecDetails?: boolean;
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
/** ADP-4b (owner D7): the file's three identity columns, on a spec-driven grid -- shown as the file writes them. */
export const COL_ITEM_UID = "file:item_uid";
export const COL_DISCIPLINE = "file:discipline";
export const COL_CATEGORY = "file:category";

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
  /**
   * ADP-4b (owner D7, 2026-10-21: "a toggle, off by default, so the screen equals the file"): a SPEC-DRIVEN grid is the
   * download's columns in the download's order (`csv_exporter.build_category_rows`: item_uid, discipline, category,
   * [kind], brand, unit, the text pair, the rates, the two formula columns). The toggle adds the spec verdict and the
   * "read from spec" columns after the text pair, and the source sheet and row before the formulas. This SUPERSEDES the
   * slice-1c U3 order (the text pair first) on this grid. The admin `actions` column stays first (owner, 2026-10-21).
   */
  if (o.specMode && !o.piMode) {
    keys.push(COL_ITEM_UID, COL_DISCIPLINE, COL_CATEGORY);
    if (o.showKindCol) keys.push(COL_KIND);
    keys.push(COL_BRAND, COL_UNIT);
    for (const d of o.textCols) keys.push(attrColKey(d.id));
    if (o.showSpecDetails) {
      keys.push(COL_SPEC);
      for (const d of o.attrCols) keys.push(attrColKey(d.id));
    }
    for (const k of o.rateCols) keys.push(rateColKey(k));
    if (o.showSpecDetails) keys.push(COL_SOURCE_SHEET, COL_SOURCE_ROW);
    keys.push(COL_FORMULA_SUPPLY, COL_FORMULA_INSTALL);
    return keys;
  }
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

/**
 * ADP-4b (owner D7 / AC3) -- PURE. The download's own column id for a grid column, shown beneath its plain header so a
 * person can match the screen to the file; null for a column the file does not carry (actions, the spec verdict, the
 * source sheet and row, the Pricing-Inputs extras). An `attr:` column is the file's only where the grid passes it as a
 * file column (`fileAttrIds`): a spec-driven file carries the text pair, never the "read from spec" columns.
 */
export function fileColumnId(key: GridColumnKey, fileAttrIds: ReadonlySet<string>): string | null {
  const fixed: Record<string, string> = {
    [COL_ITEM_UID]: "item_uid", [COL_DISCIPLINE]: "discipline", [COL_CATEGORY]: "category", [COL_KIND]: "kind",
    [COL_BRAND]: "brand", [COL_UNIT]: "unit", [COL_FORMULA_SUPPLY]: "supply_formula", [COL_FORMULA_INSTALL]: "install_formula",
  };
  if (fixed[key]) return fixed[key];
  if (key.startsWith("rate:")) return key.slice(5);
  if (key.startsWith("attr:")) return fileAttrIds.has(key.slice(5)) ? key.slice(5) : null;
  return null;
}

/**
 * ADP-4b (owner D7; block 38: no internal name on its own) -- PURE. The plain header label for a file column whose
 * screen label is not a definition's: the identity columns by name, a rate id read as words ("cost_install" ->
 * "Install cost", "supply_markup" -> "Supply markup"). The id itself sits beneath it (`fileColumnId`).
 */
export function plainFileColumnLabel(id: string): string {
  const named: Record<string, string> = {
    item_uid: "Item ID", discipline: "Discipline", category: "Category", kind: "Kind", brand: "Brand", unit: "Unit",
  };
  if (named[id]) return named[id];
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const cost = /^cost_(.+)$/.exec(id);
  if (cost) return `${cap(cost[1].replace(/_/g, " "))} cost`;
  return cap(id.replace(/_/g, " "));
}
