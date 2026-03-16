export type MergeStep = "selection" | "resolution";

export interface ItemSourceEntry {
  poName: string;
  quote: number;
  tax: number;
  quantity: number;
}

export interface RegularItemConflict {
  /** Identity key: `${item_id}::${make || ""}` */
  key: string;
  item_id: string;
  item_name: string;
  make: string;
  unit: string;
  category: string;
  totalQuantity: number;
  sources: ItemSourceEntry[];
  distinctQuotes: number[];
  maxQuote: number;
}

export interface ChargeConflict {
  /** Identity key: item_name */
  key: string;
  item_name: string;
  item_id: string;
  sources: ItemSourceEntry[];
  sumAmount: number;
}

export interface RegularItemResolution {
  resolvedQuote: number;
  resolvedTax: number;
}

export interface ChargeResolution {
  resolvedAmount: number;
  resolvedTax: number;
}
