import { ProcurementOrder, PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import { ADDITIONAL_CHARGES_CATEGORY } from "./constants";
import type { RegularItemConflict, ChargeConflict, ItemSourceEntry } from "./types";

interface TaggedItem extends PurchaseOrderItem {
  sourcePO: string;
}

function tagItems(po: ProcurementOrder): TaggedItem[] {
  return (po.items || []).map((item) => ({ ...item, sourcePO: po.name }));
}

/** Build a grouping key for regular items */
function regularKey(item: PurchaseOrderItem): string {
  return `${item.item_id}::${item.make || ""}`;
}

/** Build a grouping key for additional charges */
function chargeKey(item: PurchaseOrderItem): string {
  return item.item_name;
}

export function detectConflicts(
  basePO: ProcurementOrder,
  mergedPOs: ProcurementOrder[]
): { regularConflicts: RegularItemConflict[]; chargeConflicts: ChargeConflict[] } {
  const allItems: TaggedItem[] = [
    ...tagItems(basePO),
    ...mergedPOs.flatMap(tagItems),
  ];

  const regularItems = allItems.filter(
    (i) => i.category !== ADDITIONAL_CHARGES_CATEGORY
  );
  const chargeItems = allItems.filter(
    (i) => i.category === ADDITIONAL_CHARGES_CATEGORY
  );

  // --- Regular items ---
  const regularGroups = new Map<string, TaggedItem[]>();
  for (const item of regularItems) {
    const key = regularKey(item);
    const group = regularGroups.get(key) || [];
    group.push(item);
    regularGroups.set(key, group);
  }

  const regularConflicts: RegularItemConflict[] = [];
  for (const [key, items] of regularGroups) {
    // Only cross-PO overlaps matter
    const distinctPOs = new Set(items.map((i) => i.sourcePO));
    if (distinctPOs.size < 2) continue;

    // Check if there's actually a difference in quote or tax
    const quotes = items.map((i) => i.quote);
    const taxes = items.map((i) => i.tax);
    const hasQuoteDiff = new Set(quotes).size > 1;
    const hasTaxDiff = new Set(taxes).size > 1;
    if (!hasQuoteDiff && !hasTaxDiff) continue; // Auto-merge case, no conflict

    // Aggregate sources per PO
    const sourceMap = new Map<string, ItemSourceEntry>();
    for (const item of items) {
      const existing = sourceMap.get(item.sourcePO);
      if (existing) {
        // Same PO can have same item_id+make multiple times (unlikely but safe)
        existing.quantity += item.quantity;
      } else {
        sourceMap.set(item.sourcePO, {
          poName: item.sourcePO,
          quote: item.quote,
          tax: item.tax,
          quantity: item.quantity,
        });
      }
    }

    const sources = Array.from(sourceMap.values());
    const distinctQuotes = [...new Set(quotes)].sort((a, b) => a - b);
    const first = items[0];

    regularConflicts.push({
      key,
      item_id: first.item_id,
      item_name: first.item_name,
      make: first.make || "",
      unit: first.unit,
      category: first.category,
      totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0),
      sources,
      distinctQuotes,
      maxQuote: Math.max(...quotes),
    });
  }

  // --- Additional Charges ---
  const chargeGroups = new Map<string, TaggedItem[]>();
  for (const item of chargeItems) {
    const key = chargeKey(item);
    const group = chargeGroups.get(key) || [];
    group.push(item);
    chargeGroups.set(key, group);
  }

  const chargeConflicts: ChargeConflict[] = [];
  for (const [key, items] of chargeGroups) {
    const distinctPOs = new Set(items.map((i) => i.sourcePO));
    if (distinctPOs.size < 2) continue;

    // Charges always show resolution (even if same amount, sum option changes total)
    const sources: ItemSourceEntry[] = items.map((item) => ({
      poName: item.sourcePO,
      quote: item.quote,
      tax: item.tax,
      quantity: 1,
    }));

    chargeConflicts.push({
      key,
      item_name: key,
      item_id: items[0].item_id,
      sources,
      sumAmount: items.reduce((sum, i) => sum + i.quote, 0),
    });
  }

  return { regularConflicts, chargeConflicts };
}
