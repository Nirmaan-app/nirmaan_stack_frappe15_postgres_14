import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { DeliveryNote } from "@/types/NirmaanStack/DeliveryNotes";

/** A single row in the pivot table — one per PO item */
export interface PivotRow {
  itemId: string;
  /** Item doctype ID (e.g. "ITEM-00123") — used by edit DN API */
  itemItemId: string;
  itemName: string;
  unit: string;
  orderedQty: number;
  /** Map of DN name → delivered quantity (delta for that DN) */
  dnQuantities: Record<string, number>;
  totalReceived: number;
  remainingQty: number;
  isFullyDelivered: boolean;
  isOverDelivered: boolean;
  comment?: string;
}

/** A single column header — one per Delivery Note */
export interface DNColumn {
  dnName: string;
  noteNo: number;
  deliveryDate: string;
  creationDate?: string;
  updatedBy?: string;
  hasAttachment: boolean;
  isReturn: boolean;
}

/** Complete pivot data derived from PO + DN records */
export interface PivotData {
  rows: PivotRow[];
  dnColumns: DNColumn[];
}

/** Category string for cost add-on items excluded from DN/DC/MIR */
export const ADDITIONAL_CHARGES_CATEGORY = "Additional Charges";

/** Roles allowed to edit delivery notes */
export const DELIVERY_EDIT_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Project Manager Profile",
  "Nirmaan Project Lead Profile",
  "Nirmaan Procurement Executive Profile",
] as const;

/** Roles allowed to create return notes */
export const RETURN_NOTE_ROLES = [
  "Nirmaan Admin Profile",
  "Nirmaan PMO Executive Profile",
  "Nirmaan Project Lead Profile",
  "Nirmaan Procurement Executive Profile",
] as const;

export interface DeliveryPivotTableProps {
  po: ProcurementOrder;
  dnRecords: DeliveryNote[];
  onPoMutate: () => void;
  onDnRefetch?: () => void;
  canEdit: boolean;
  /** true when rendered inside PO detail view (no metadata bar, tighter padding) */
  isEmbedded?: boolean;
  /** Hide the "Ordered" column for Project Managers */
  isProjectManager?: boolean;
  /**
   * Controls the pivot table display mode:
   * - "create": auto-opens new entry form, hides existing DN columns
   * - "view-only": read-only display, no edit/create actions
   * - "full": default interactive mode with all features
   */
  viewMode?: "create" | "view-only" | "full";
  canReturn?: boolean;
  returnCount?: number;
  isLocked?: boolean;
  /** Called after successful DN creation (e.g., to navigate away) */
  onAfterCreate?: () => void;
}

export interface PivotTableMetadataBarProps {
  po: ProcurementOrder;
  dnCount: number;
  returnCount?: number;
  /** Show navigation links to PO/PR (true on DN page, false on PO page) */
  showNavLinks?: boolean;
}
