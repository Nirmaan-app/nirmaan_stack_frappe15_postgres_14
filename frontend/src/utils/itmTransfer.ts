/**
 * Rules for the New Transfer page (`pages/InternalTransferMemos/Create/CreateITMPage.tsx`).
 *
 * A transfer moves stock in one of three directions and has exactly ONE source and ONE
 * destination, so one submit creates one Internal Transfer Memo. The warehouse side of a
 * direction is fixed: there is a single warehouse, which `create_itms` identifies by
 * `source_type` / `target_type` alone (its `source_project` is "", its `target_project` null).
 */
import { ITM_CREATE_ROLES, ITM_PROJECT_RETURN_ROLES } from "@/constants/itm";

export type TransferDirection =
  | "project-to-project"
  | "project-to-warehouse"
  | "warehouse-to-project";

export const TRANSFER_DIRECTIONS: readonly TransferDirection[] = [
  "project-to-project",
  "project-to-warehouse",
  "warehouse-to-project",
];

/** Reads the `?type=` URL param; anything unrecognised starts with no direction chosen. */
export function parseTransferDirection(raw: string | null | undefined): TransferDirection | null {
  return TRANSFER_DIRECTIONS.find((d) => d === raw) ?? null;
}

/** True when the material comes from the warehouse. */
export const sourceIsWarehouse = (d: TransferDirection | null): boolean =>
  d === "warehouse-to-project";

/** True when the material goes to the warehouse. */
export const targetIsWarehouse = (d: TransferDirection | null): boolean =>
  d === "project-to-warehouse";

/**
 * Directions a user may start, in display order. Admin / PMO / Material Procurement get
 * all three; Project Managers and Project Leads only return stock to the warehouse
 * (Project → Warehouse). Empty = no access, which also hides the "Create Internal
 * Transfer Memo" buttons.
 */
export function allowedTransferDirections(
  role: string,
  userId?: string
): TransferDirection[] {
  if (userId === "Administrator" || ITM_CREATE_ROLES.includes(role)) {
    return [...TRANSFER_DIRECTIONS];
  }
  if (ITM_PROJECT_RETURN_ROLES.includes(role)) return ["project-to-warehouse"];
  return [];
}

/**
 * The direction in effect: the chosen one when this user may use it (a `?type=` they
 * may not use counts as unchosen), else their only direction when they have exactly one.
 */
export function effectiveDirection(
  chosen: TransferDirection | null,
  allowed: TransferDirection[]
): TransferDirection | null {
  if (chosen && allowed.includes(chosen)) return chosen;
  return allowed.length === 1 ? allowed[0] : null;
}

/** One pickable (item, make) bucket of the chosen source. */
export interface TransferStockRow {
  /** `${item_id}|${make}`: distinct makes of one item are separate rows. */
  key: string;
  item_id: string;
  item_name: string;
  make: string | null;
  category: string;
  unit: string;
  available_quantity: number;
  estimated_rate: number;
}

/** The fields of a `get_inventory_picker_data` node this module reads. */
interface PickerItemLike {
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  sources: {
    source_project: string;
    source_project_name: string;
    make: string | null;
    available_quantity: number;
    estimated_rate: number;
  }[];
}

/** The fields of a `get_warehouse_stock` row this module reads. */
interface WarehouseRowLike {
  item_id: string;
  item_name: string;
  unit: string;
  category: string;
  make?: string | null;
  available_quantity: number;
  estimated_rate: number;
}

export const stockRowKey = (itemId: string, make: string | null | undefined): string =>
  `${itemId}|${make ?? ""}`;

const hasStock = (qty: number) => Number(qty) > 0;

/**
 * Projects that have any available stock, for the "From" list, sorted by name.
 * `onlyProjects`, when given, keeps just those projects (a source-scoped role's own).
 */
export function projectsWithStock(
  items: PickerItemLike[],
  onlyProjects?: ReadonlySet<string>
): { value: string; label: string }[] {
  const byName = new Map<string, string>();
  for (const item of items) {
    for (const src of item.sources) {
      if (onlyProjects && !onlyProjects.has(src.source_project)) continue;
      if (hasStock(src.available_quantity) && !byName.has(src.source_project)) {
        byName.set(src.source_project, src.source_project_name || src.source_project);
      }
    }
  }
  return Array.from(byName, ([value, label]) => ({ value, label })).sort((a, b) =>
    a.label.localeCompare(b.label)
  );
}

/** One project's available stock, and nothing from any other project. */
export function projectStockRows(items: PickerItemLike[], project: string): TransferStockRow[] {
  const rows: TransferStockRow[] = [];
  for (const item of items) {
    for (const src of item.sources) {
      if (src.source_project !== project || !hasStock(src.available_quantity)) continue;
      rows.push({
        key: stockRowKey(item.item_id, src.make),
        item_id: item.item_id,
        item_name: item.item_name,
        make: src.make || null,
        category: item.category,
        unit: item.unit,
        available_quantity: src.available_quantity,
        estimated_rate: src.estimated_rate,
      });
    }
  }
  return rows;
}

/** The warehouse's available stock. */
export function warehouseStockRows(rows: WarehouseRowLike[]): TransferStockRow[] {
  return rows
    .filter((r) => hasStock(r.available_quantity))
    .map((r) => ({
      key: stockRowKey(r.item_id, r.make),
      item_id: r.item_id,
      item_name: r.item_name,
      make: r.make || null,
      category: r.category,
      unit: r.unit,
      available_quantity: r.available_quantity,
      estimated_rate: r.estimated_rate,
    }));
}

/**
 * Totals of the ticked rows for the summary bar and the preview: how many items, and their
 * estimated value (quantity × the row's estimated rate, the same snapshot rate the ITM
 * stores). A pick whose row is gone, or with no quantity yet, adds no value.
 */
export function pickedTotals(
  rows: TransferStockRow[],
  picks: Record<string, number>
): { items: number; value: number } {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  let value = 0;
  for (const [key, qty] of Object.entries(picks)) {
    const row = byKey.get(key);
    if (row && qty > 0) value += qty * (row.estimated_rate || 0);
  }
  return { items: Object.keys(picks).length, value };
}

/** What the user has chosen so far. */
export interface TransferDraft {
  direction: TransferDirection | null;
  /** Source project name; ignored when the source is the warehouse. */
  sourceProject: string | null;
  /** Destination project name; ignored when the destination is the warehouse. */
  targetProject: string | null;
  /** Row key → quantity to transfer. */
  picks: Record<string, number>;
}

/** The `create_itms` arguments for one transfer. */
export interface CreateTransferPayload {
  target_type: "Project" | "Warehouse";
  target_project: string | null;
  selections: {
    item_id: string;
    make: string | null;
    source_type: "Project" | "Warehouse";
    source_project: string;
    transfer_quantity: number;
  }[];
}

export type TransferCheck =
  | { ok: true; payload: CreateTransferPayload }
  | { ok: false; reason: string };

/**
 * Validates a draft against the source's current rows and builds the `create_itms`
 * payload. `rows` must be the rows of the draft's source, so a pick whose row has
 * since gone (stock used elsewhere, list refetched) is refused, not sent.
 */
export function buildTransferPayload(draft: TransferDraft, rows: TransferStockRow[]): TransferCheck {
  const { direction, sourceProject, targetProject, picks } = draft;
  if (!direction) return { ok: false, reason: "Choose a transfer type" };
  const fromWarehouse = sourceIsWarehouse(direction);
  const toWarehouse = targetIsWarehouse(direction);
  if (!fromWarehouse && !sourceProject) return { ok: false, reason: "Choose the source project" };
  if (!toWarehouse && !targetProject) return { ok: false, reason: "Choose the destination project" };
  if (!fromWarehouse && !toWarehouse && sourceProject === targetProject) {
    return { ok: false, reason: "Source and destination cannot be the same project" };
  }

  const keys = Object.keys(picks);
  if (!keys.length) return { ok: false, reason: "Select at least one item" };

  const byKey = new Map(rows.map((r) => [r.key, r]));
  const selections: CreateTransferPayload["selections"] = [];
  for (const key of keys) {
    const row = byKey.get(key);
    if (!row) return { ok: false, reason: "A selected item is no longer available; clear it and pick again" };
    const qty = picks[key];
    if (!(qty > 0)) return { ok: false, reason: `Enter a quantity for ${row.item_name}` };
    if (qty > row.available_quantity) {
      return { ok: false, reason: `${row.item_name}: only ${row.available_quantity} available` };
    }
    selections.push({
      item_id: row.item_id,
      make: row.make,
      source_type: fromWarehouse ? "Warehouse" : "Project",
      source_project: fromWarehouse ? "" : (sourceProject as string),
      transfer_quantity: qty,
    });
  }

  return {
    ok: true,
    payload: {
      target_type: toWarehouse ? "Warehouse" : "Project",
      target_project: toWarehouse ? null : targetProject,
      selections,
    },
  };
}
