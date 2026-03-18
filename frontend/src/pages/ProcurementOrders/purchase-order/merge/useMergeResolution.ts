import { useCallback, useMemo, useState } from "react";
import { ProcurementOrder, PurchaseOrderItem } from "@/types/NirmaanStack/ProcurementOrders";
import { detectConflicts, detectIncompatibilities } from "./detectConflicts";
import { ADDITIONAL_CHARGES_CATEGORY, DEFAULT_TAX } from "./constants";
import type {
  RegularItemResolution,
  ChargeResolution,
} from "./types";

export function useMergeResolution(
  basePO: ProcurementOrder | null,
  mergedPOs: ProcurementOrder[]
) {
  const [regularResolutions, setRegularResolutions] = useState<
    Record<string, RegularItemResolution>
  >({});
  const [chargeResolutions, setChargeResolutions] = useState<
    Record<string, ChargeResolution>
  >({});

  // Derived: detect conflicts from current basePO + mergedPOs
  const { regularConflicts, chargeConflicts } = useMemo(() => {
    if (!basePO || mergedPOs.length === 0) {
      return { regularConflicts: [], chargeConflicts: [] };
    }
    return detectConflicts(basePO, mergedPOs);
  }, [basePO, mergedPOs]);

  const hasConflicts = regularConflicts.length > 0 || chargeConflicts.length > 0;

  // Detect item variant incompatibilities (same item_id, different make/comment across POs)
  const incompatibilities = useMemo(() => {
    if (!basePO || mergedPOs.length === 0) return [];
    return detectIncompatibilities(basePO, mergedPOs);
  }, [basePO, mergedPOs]);

  const hasIncompatibilities = incompatibilities.length > 0;

  // Auto-initialize resolutions for new conflicts (default to first source's values)
  const effectiveRegularResolutions = useMemo(() => {
    const result: Record<string, RegularItemResolution> = {};
    for (const conflict of regularConflicts) {
      if (regularResolutions[conflict.key]) {
        result[conflict.key] = regularResolutions[conflict.key];
      } else {
        result[conflict.key] = {
          resolvedQuote: conflict.sources[0].quote,
          resolvedTax: DEFAULT_TAX,
        };
      }
    }
    return result;
  }, [regularConflicts, regularResolutions]);

  const effectiveChargeResolutions = useMemo(() => {
    const result: Record<string, ChargeResolution> = {};
    for (const conflict of chargeConflicts) {
      if (chargeResolutions[conflict.key]) {
        result[conflict.key] = chargeResolutions[conflict.key];
      } else {
        result[conflict.key] = {
          resolvedAmount: conflict.sources[0].quote,
          resolvedTax: conflict.sources[0].tax,
        };
      }
    }
    return result;
  }, [chargeConflicts, chargeResolutions]);

  // All conflicts have a resolution (always true since we auto-initialize)
  const allResolved = useMemo(() => {
    return (
      regularConflicts.every((c) => effectiveRegularResolutions[c.key]) &&
      chargeConflicts.every((c) => effectiveChargeResolutions[c.key])
    );
  }, [regularConflicts, chargeConflicts, effectiveRegularResolutions, effectiveChargeResolutions]);

  const setRegularResolution = useCallback(
    (key: string, res: RegularItemResolution) => {
      setRegularResolutions((prev) => ({ ...prev, [key]: res }));
    },
    []
  );

  const setChargeResolution = useCallback(
    (key: string, res: ChargeResolution) => {
      setChargeResolutions((prev) => ({ ...prev, [key]: res }));
    },
    []
  );

  // Reset all resolutions (called when sheet closes)
  const resetResolutions = useCallback(() => {
    setRegularResolutions({});
    setChargeResolutions({});
  }, []);

  /**
   * Build the final resolved order_data for the backend.
   * Algorithm:
   * 1. Collect all items from basePO + mergedPOs
   * 2. For regular conflict groups → one resolved item (summed qty, resolved quote/tax)
   * 3. For auto-merged groups (same quote+tax across POs) → merge into one (summed qty)
   * 4. For non-overlapping items → pass through
   * 5. For charge conflicts → one item (qty=1, resolved amount, resolved tax)
   * 6. For non-overlapping charges → pass through
   */
  const buildResolvedOrderData = useCallback((): PurchaseOrderItem[] => {
    if (!basePO) return [];

    const allPOs = [basePO, ...mergedPOs];
    const allItems = allPOs.flatMap((po) => po.items || []);

    const regularItems = allItems.filter(
      (i) => i.category !== ADDITIONAL_CHARGES_CATEGORY
    );
    const chargeItems = allItems.filter(
      (i) => i.category === ADDITIONAL_CHARGES_CATEGORY
    );

    // --- Process regular items ---
    const regularGroups = new Map<string, PurchaseOrderItem[]>();
    for (const item of regularItems) {
      const key = `${item.item_id}::${item.make || ""}`;
      const group = regularGroups.get(key) || [];
      group.push(item);
      regularGroups.set(key, group);
    }

    const resolvedRegular: PurchaseOrderItem[] = [];
    for (const [key, items] of regularGroups) {
      const distinctPOs = new Set(
        allPOs
          .filter((po) =>
            (po.items || []).some(
              (i) =>
                `${i.item_id}::${i.make || ""}` === key &&
                i.category !== ADDITIONAL_CHARGES_CATEGORY
            )
          )
          .map((po) => po.name)
      );

      if (distinctPOs.size < 2) {
        // No cross-PO overlap → pass through as-is
        resolvedRegular.push(...items);
        continue;
      }

      // Cross-PO overlap exists
      const resolution = effectiveRegularResolutions[key];
      const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
      const template = items[0];

      if (resolution) {
        // Conflict was detected → use resolved values
        const amt = totalQty * resolution.resolvedQuote;
        const taxAmt = amt * (resolution.resolvedTax / 100);
        resolvedRegular.push({
          ...template,
          quantity: totalQty,
          quote: resolution.resolvedQuote,
          tax: resolution.resolvedTax,
          amount: amt,
          total_amount: amt + taxAmt,
        });
      } else {
        // Auto-merge: same quote+tax across POs, just sum quantities
        const amt = totalQty * template.quote;
        const taxAmt = amt * (template.tax / 100);
        resolvedRegular.push({
          ...template,
          quantity: totalQty,
          amount: amt,
          total_amount: amt + taxAmt,
        });
      }
    }

    // --- Process charges ---
    const chargeGroups = new Map<string, PurchaseOrderItem[]>();
    for (const item of chargeItems) {
      const key = item.item_name;
      const group = chargeGroups.get(key) || [];
      group.push(item);
      chargeGroups.set(key, group);
    }

    const resolvedCharges: PurchaseOrderItem[] = [];
    for (const [key, items] of chargeGroups) {
      const distinctPOs = new Set(
        allPOs
          .filter((po) =>
            (po.items || []).some(
              (i) =>
                i.item_name === key &&
                i.category === ADDITIONAL_CHARGES_CATEGORY
            )
          )
          .map((po) => po.name)
      );

      if (distinctPOs.size < 2) {
        // No cross-PO overlap → pass through
        resolvedCharges.push(...items);
        continue;
      }

      const resolution = effectiveChargeResolutions[key];
      const template = items[0];

      const resolvedQuote = resolution?.resolvedAmount ?? template.quote;
      const resolvedTax = resolution?.resolvedTax ?? template.tax;
      const amt = resolvedQuote; // qty is always 1
      const taxAmt = amt * (resolvedTax / 100);
      resolvedCharges.push({
        ...template,
        quantity: 1,
        quote: resolvedQuote,
        tax: resolvedTax,
        amount: amt,
        total_amount: amt + taxAmt,
      });
    }

    return [...resolvedRegular, ...resolvedCharges];
  }, [basePO, mergedPOs, effectiveRegularResolutions, effectiveChargeResolutions]);

  // Live estimated total from resolved items
  const estimatedTotal = useMemo(() => {
    const items = buildResolvedOrderData();
    return items.reduce(
      (sum, item) => sum + item.quantity * item.quote * (1 + item.tax / 100),
      0
    );
  }, [buildResolvedOrderData]);

  return {
    regularConflicts,
    chargeConflicts,
    hasConflicts,
    allResolved,
    estimatedTotal,
    incompatibilities,
    hasIncompatibilities,
    effectiveRegularResolutions,
    effectiveChargeResolutions,
    setRegularResolution,
    setChargeResolution,
    resetResolutions,
    buildResolvedOrderData,
  };
}
