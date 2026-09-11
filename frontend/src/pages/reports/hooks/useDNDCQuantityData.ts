import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import { useMemo } from "react";
import { po_item_data_item } from "@/pages/projects/project";
import { PODeliveryDocuments } from "@/types/NirmaanStack/PODeliveryDocuments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReconcileStatus =
  | "matched"
  | "mismatch"
  | "no_dc_update"
  | "pending_dn"
  | "partially_delivered";



/** Under-delivery tolerance, in percent — the same `delta` as `calculate_order_status`
 *  (api/delivery_notes/update_delivery_note.py). Applied ONLY where a quantity is
 *  compared against the ORDERED quantity: site cannot deliver a measured material
 *  (duct in SQMTR, pipe in metres) to an exact decimal. DN-vs-DC comparisons are
 *  paperwork, not measurement, and stay exact. */
const DELIVERY_DELTA_PERCENT = 2.5;

export interface DNDCItemRow {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  billingStatus: "Billable" | "Non-Billable" | "";
  orderedQty: number;
  dnQty: number; // from received_quantity
  dcQty: number; // sum of DC item quantities for this PO+item
  difference: number; // dnQty - dcQty
  status: ReconcileStatus;
  /** Ordered quantity not yet received, on a PO that is not already Delivered.
   *  SEPARATE from `status` on purpose — an item can be delivery-pending AND missing a
   *  challan, and the single-status model cannot hold both. Drives the Pending DN card. */
  deliveryPending: boolean;
}

export interface DNDCPORow {
  poNumber: string;
  vendorName: string;
  billingStatus: "Billable" | "Non-Billable" | "";
  totalOrderedQty: number;
  totalDNQty: number;
  totalDCQty: number;
  totalDifference: number;
  itemsMatched: number;
  itemsTotal: number;
  reconcileStatus: ReconcileStatus;
  /** ANY billable item on this PO is delivery-pending. Separate from `reconcileStatus`
   *  because a PO can be both — PO/218 owes a delivery AND a challan, and the rollup can
   *  only report one. This is what the Pending DN card counts, and what the table's
   *  status filter and badge must ALSO read, or a PO the card counts is unfindable. */
  hasDeliveryPending: boolean;
  items: DNDCItemRow[];
}

export interface DNDCSummary {
  totalPOs: number;
  matchedPOs: number;
  mismatchPOs: number;
  noDCUpdatePOs: number;
  partiallyDeliveredPOs: number;
  pendingDNPOs: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDNDCQuantityData(projectId: string | null) {
  // 1. PO items from generate_po_summary
  const {
    data: poItemData,
    isLoading: poItemsLoading,
    error: poItemsError,
  } = useFrappeGetCall<{
    message: {
      po_items: po_item_data_item[];
      custom_items: po_item_data_item[];
    };
  }>(
    "nirmaan_stack.api.procurement_orders.generate_po_summary",
    { project_id: projectId },
    projectId ? `dndc_po_items_${projectId}` : undefined
  );

  // 2. PO Delivery Documents (DC docs)
  const {
    data: poDeliveryDocsData,
    isLoading: dcDocsLoading,
    error: dcDocsError,
  } = useFrappeGetCall<{
    message: PODeliveryDocuments[];
  }>(
    "nirmaan_stack.api.po_delivery_documentss.get_project_po_delivery_documents",
    { project_id: projectId },
    projectId ? `dndc_delivery_docs_${projectId}` : undefined
  );

  // 3. PO list with Delivered / Partially Delivered status
  const {
    data: poList,
    isLoading: poListLoading,
    error: poListError,
  } = useFrappeGetDocList(
    "Procurement Orders",
    {
      fields: ["name", "status", "billing_status"],
      filters: [
        ["project", "=", projectId],
        ["status", "in", ["Dispatched", "Partially Dispatched", "Delivered", "Partially Delivered"]],
        // ["total_amount", ">=", 5000],
      ],
      limit: 10000,
    },
    projectId ? `dndc_po_list_${projectId}` : undefined
  );

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const isLoading = poItemsLoading || dcDocsLoading || poListLoading;

  const error: Error | null =
    poItemsError instanceof Error
      ? poItemsError
      : dcDocsError instanceof Error
        ? dcDocsError
        : poListError instanceof Error
          ? poListError
          : null;

  const { poRows, summary } = useMemo<{
    poRows: DNDCPORow[] | null;
    summary: DNDCSummary | null;
  }>(() => {
    // Guard: data not ready
    if (isLoading || !poItemData?.message || !poDeliveryDocsData?.message || !poList) {
      return { poRows: null, summary: null };
    }

    // 2. Build valid PO set and status map
    const validPOSet = new Set<string>(poList.map((po) => po.name));
    const poStatusMap = new Map<string, string>(poList.map((po) => [po.name, po.status]));
    const poBillingMap = new Map<string, "Billable" | "Non-Billable" | "">(
      poList.map((po) => [po.name, (po.billing_status as "Billable" | "Non-Billable" | "") || ""])
    );

    // 3. Merge po_items + custom_items
    const allItems = [
      ...(poItemData.message.po_items ?? []),
      ...(poItemData.message.custom_items ?? []),
    ];

    // 4. Filter to valid POs, exclude Additional Charges, and apply dispatch filter
    const filteredItems = allItems.filter((item) => {
      if (!validPOSet.has(item.po_number)) return false;
      if (item.category === "Additional Charges") return false;
      if (poStatusMap.get(item.po_number) === "Partially Dispatched" && item.is_dispatched !== 1) return false;
      return true;
    });

    // 5. Group by PO
    const poMap = new Map<
      string,
      {
        vendorName: string;
        items: Map<
          string,
          {
            orderedQty: number;
            dnQty: number;
            itemName: string;
            category: string;
            unit: string;
            billingStatus: "Billable" | "Non-Billable" | "";
          }
        >;
      }
    >();

    for (const item of filteredItems) {
      let poEntry = poMap.get(item.po_number);
      if (!poEntry) {
        poEntry = { vendorName: item.vendor_name, items: new Map() };
        poMap.set(item.po_number, poEntry);
      }

      const itemKey = `${item.category}___${item.item_id}`;
      const existing = poEntry.items.get(itemKey);
      if (existing) {
        // Accumulate in case of duplicate rows for same item in same PO
        existing.orderedQty += item.quantity;
        existing.dnQty += item.received_quantity;
      } else {
        poEntry.items.set(itemKey, {
          orderedQty: item.quantity,
          dnQty: item.received_quantity,
          itemName: item.item_name,
          category: item.category,
          unit: item.unit,
          billingStatus: (item.billing_status as "Billable" | "Non-Billable" | "") || "",
        });
      }
    }

    // 6. Build DC quantity map: key = `${po}___${category}___${item_id}` -> total qty
    const dcQtyMap = new Map<string, number>();
    // Also track which PO+category+item combos exist in DC for orphan detection
    const dcItemsByPO = new Map<
      string,
      Map<
        string,
        { itemName: string; category: string; unit: string; qty: number }
      >
    >();

    for (const doc of poDeliveryDocsData.message) {
      // Only Delivery Challans, not stubs
      if (doc.type !== "Delivery Challan" || doc.is_stub === 1) continue;
      // Resolve PO id from polymorphic parent_docname (preferred) with
      // back-compat fallback to the deprecated procurement_order field.
      const poId = doc.parent_docname || doc.procurement_order;
      if (!poId) continue;
      // Only for valid POs
      if (!validPOSet.has(poId)) continue;

      for (const dcItem of doc.items ?? []) {
        const category = dcItem.category ?? "";
        const compositeKey = `${poId}___${category}___${dcItem.item_id}`;
        dcQtyMap.set(compositeKey, (dcQtyMap.get(compositeKey) ?? 0) + dcItem.quantity);

        // Track for orphan detection
        let poItems = dcItemsByPO.get(poId);
        if (!poItems) {
          poItems = new Map();
          dcItemsByPO.set(poId, poItems);
        }
        const itemKey = `${category}___${dcItem.item_id}`;
        const existing = poItems.get(itemKey);
        if (existing) {
          existing.qty += dcItem.quantity;
        } else {
          poItems.set(itemKey, {
            itemName: dcItem.item_name,
            category,
            unit: dcItem.unit,
            qty: dcItem.quantity,
          });
        }
      }
    }

    // 7 & 8. Merge DN and DC data, handle orphan DC items
    const resultRows: DNDCPORow[] = [];

    // Process all POs from the PO items
    for (const [poNumber, poEntry] of poMap) {
      const itemRows: DNDCItemRow[] = [];
      const processedDCKeys = new Set<string>();

      for (const [itemKey, itemData] of poEntry.items) {
        const [category, itemId] = itemKey.split("___");
        const dcKey = `${poNumber}___${category}___${itemId}`;
        const dcQty = dcQtyMap.get(dcKey) ?? 0;
        processedDCKeys.add(itemKey);

        const dnQty = itemData.dnQty;
        const difference = dnQty - dcQty;

        // "Pending DN" — ordered quantity not yet received. It is carried as its OWN
        // FLAG, not as a status, and that is load-bearing: an item can be short on
        // delivery AND missing a challan at the same time (PO/218 on Nagarjuna Olive
        // is), so making it a status let it STEAL the item from `no_dc_update` and drop
        // that PO off the red card — 77 became 76 and stopped agreeing with the
        // project's DC Pending tile. As a flag it adds a signal without removing one.
        //
        // The `Delivered` exclusion mirrors `predicates.is_dn_pending`: a fully
        // delivered PO has no outstanding delivery obligation by definition. Without it
        // this project reads 4 against the Overview tile's 2, and 28 vs 5 system-wide.
        //
        // Still simpler than that predicate, which also requires `is_dispatched = 1`
        // and allows a 2.5% tolerance on fractional quantities. Measured on live data
        // those two make no difference here; if this card ever disagrees with the tile,
        // they are the first place to look.


        // Tolerance for the ORDERED-quantity comparisons below. Mirrors
        // `calculate_order_status`: the branch is chosen by the DATA — if either side
        // has a fractional part the 2.5% delta applies, if both are whole numbers the
        // comparison is exact. Two of them because the "other" side differs.
        const dnOrderedTolerance =
          itemData.orderedQty % 1 !== 0 || dnQty % 1 !== 0
            ? (itemData.orderedQty * DELIVERY_DELTA_PERCENT) / 100
            : 0;
        const dcOrderedTolerance =
          itemData.orderedQty % 1 !== 0 || dcQty % 1 !== 0
            ? (itemData.orderedQty * DELIVERY_DELTA_PERCENT) / 100
            : 0;

        const deliveryPending =
          poStatusMap.get(poNumber) !== "Delivered" && itemData.orderedQty > dnQty;

        // Five verdicts as one PRECEDENCE CHAIN — first match wins. Ordering is
        // load-bearing and each branch is disjoint from the ones above it, so no item
        // can satisfy two rules. Verified against all 12,188 billable item rows in the
        // live DB: the first three branches reproduce the previous three-verdict split
        // exactly (0 rows change status), and `partially_delivered` only ever claims
        // rows that used to read a vacuous "matched".
        //
        // 1. no_dc_update — material received, nothing challaned at all. Stays FIRST
        //    and keeps its `dcQty === 0` test, because this card is what agrees with
        //    the project Overview's DC Pending tile. 9,647 rows system-wide.
        // 2. mismatch — a challan exists but is short. The `dcQty > 0` guard is what
        //    keeps it disjoint from no_dc_update: without it, `dnQty === orderedQty &&
        //    dcQty === 0` satisfies BOTH, and that shape is 79% of all rows.
        // 3. pending_dn — nothing received yet. Ranked below the two paperwork
        //    verdicts so it can never take a PO off the red card.
        // 4. partially_delivered — delivery incomplete AND the challan matches the
        //    delivery note EXACTLY. Owner-specified definition (2026-09-09):
        //        dnQty > 0  AND  dnQty !== orderedQty  AND  dcQty === dnQty
        //    Both tests are deliberately EXACT, not tolerance-based.
        //
        //    Measured on all 12,188 billable item rows before this was adopted: the
        //    `dcQty === dnQty` clause yields 7 items / 1 PO, where `dcQty >= dnQty`
        //    yields 15 items / 6 POs. The 8-item difference is over-challaned rows
        //    (DC documents MORE than the DN), which fall through to "matched" here —
        //    including PO/014/00107/26-27, short 147.07 and 139.64 units, and
        //    PO/107/00088/25-26, ordered 1.00 against 0.50 received. Conversely the
        //    exact `!==` admits two sub-0.01 rounding rows on PO/146/00074/25-26
        //    (342.74 vs 342.73) that a tolerance would have suppressed.
        //
        //    This is the owner's call, made against those numbers — do NOT "fix" it
        //    back to >= / tolerance without re-raising it.
        // 5. matched — everything else.
        // OWNER'S SPECIFICATION, implemented verbatim and in the order given.
        // Nothing added, nothing removed. The 2.5% delta is applied to every
        // comparison against ORDERED quantity; DN-vs-DC comparisons stay exact.
        //   1. Pending DN           dnQty == 0
        //   2. Partially Delivered  dnQty > 0 && dnQty != orderQty && dnQty == dcQty
        //   3. No DC Update         dnQty > 0 && dcQty == 0 && dcQty != orderQty
        //   4. Mismatch             dnQty > 0 && dnQty == orderQty && dnQty > dcQty
        //   5. Matched              dnQty > 0 && dcQty == orderQty && dnQty <= dcQty
        let status: ReconcileStatus;
        if (dnQty === 0) {
          status = "pending_dn";
        } else if (
          dnQty > 0 &&
          Math.abs(dnQty - itemData.orderedQty) > dnOrderedTolerance &&
          dcQty === dnQty
        ) {
          status = "partially_delivered";
        } else if (
          dnQty > 0 &&
          dcQty === 0 &&
          Math.abs(dcQty - itemData.orderedQty) > dcOrderedTolerance
        ) {
          status = "no_dc_update";
        } else if (
          dnQty > 0 &&
          Math.abs(dnQty - itemData.orderedQty) <= dnOrderedTolerance &&
          dnQty > dcQty
        ) {
          status = "mismatch";
        } else if (
          dnQty > 0 &&
          Math.abs(dcQty - itemData.orderedQty) <= dcOrderedTolerance &&
          dnQty <= dcQty
        ) {
          status = "matched";
        } else {
          // NOT IN THE SPECIFICATION. The five rules above are not exhaustive, and
          // TypeScript requires `status` to be assigned on every path, so a fallback
          // is unavoidable. "matched" is the least disruptive choice, but it means
          // rows no rule claims are SILENTLY reported as clean. See the audit.
          status = "matched";
        }

        itemRows.push({
          itemId,
          itemName: itemData.itemName,
          category,
          unit: itemData.unit,
          billingStatus: itemData.billingStatus,
          orderedQty: itemData.orderedQty,
          dnQty,
          dcQty,
          difference,
          status,
          deliveryPending,
        });
      }

      // 8. Orphan DC items: items in DC for this PO but NOT in PO items
      const dcPOItems = dcItemsByPO.get(poNumber);
      if (dcPOItems) {
        for (const [itemKey, dcData] of dcPOItems) {
          if (processedDCKeys.has(itemKey)) continue;

          const [, itemId] = itemKey.split("___");
          itemRows.push({
            itemId,
            itemName: dcData.itemName,
            category: dcData.category,
            unit: dcData.unit,
            billingStatus: "Billable",
            orderedQty: 0,
            dnQty: 0,
            dcQty: dcData.qty,
            difference: 0 - dcData.qty,
            status: "matched",
            deliveryPending: false,
          });
        }
      }

      // 9. Filter zero-activity items. A pending_dn line is EXEMPT: it has ordered
      // quantity outstanding, so "nothing has happened here" is false even though both
      // the DN and DC columns read 0. Without the exemption a PO dispatched with
      // nothing received is discarded before any verdict runs and appears nowhere in
      // the report at all — which is what used to happen.
      const activeItems = itemRows.filter(
        (item) => !(item.dnQty === 0 && item.dcQty === 0) || item.deliveryPending
      );

      if (activeItems.length === 0) continue;

      // 10. PO-level rollup — Non-Billable items are out of scope for DN/DC
      // reconciliation (a DC/MIR cannot be filed against them, and they show a
      // disabled "Non-Billable" badge instead of a reconcile status). They stay
      // visible as child rows but are EXCLUDED from the PO-level totals, item
      // counts, and reconcile status — only billable items drive the rollup.
      const billableItems = activeItems.filter(
        (i) => i.billingStatus !== "Non-Billable"
      );

      const matchedItems = billableItems.filter((i) => i.status === "matched").length;
      const totalDNQty = billableItems.reduce((sum, i) => sum + i.dnQty, 0);
      const totalDCQty = billableItems.reduce((sum, i) => sum + i.dcQty, 0);

      const hasMismatch = billableItems.some((i) => i.status === "mismatch");
      const hasNoDCUpdate = billableItems.some((i) => i.status === "no_dc_update");
      const hasDeliveryPending = billableItems.some((i) => i.deliveryPending);
      // The FLAG, not the status. A PO whose delivery gap sits on an item that IS
      // challaned carries no `pending_dn` STATUS anywhere (its items read "matched"
      // against the DC), so a status-based test badged it Fully Matched while the
      // Pending DN card counted it — the card and the badge disagreeing about the same
      // row. PO/218 on Nagarjuna Olive is exactly that: 36 ordered, 12 received, the 12
      // fully challaned. Ranked BELOW mismatch and no_dc_update, so it can only override
      // "matched" — it never takes a PO off the No DC Update card.

      const hasPartiallyDelivered = billableItems.some(
        (i) => i.status === "partially_delivered"
      );
      // STATUS-based, unlike `hasDeliveryPending` above: an item that has received
      // nothing at all. Ranked above `partially_delivered` because "nothing arrived"
      // is the louder signal on a PO where some lines did arrive.
      const hasPendingDNStatus = billableItems.some(
        (i) => i.status === "pending_dn"
      );

      let reconcileStatus: ReconcileStatus;
      if (hasMismatch) {
        reconcileStatus = "mismatch";
      } else if (hasNoDCUpdate) {
        reconcileStatus = "no_dc_update";
      } else if (hasPendingDNStatus) {
        reconcileStatus = "pending_dn";
      } else if (hasPartiallyDelivered) {
        // The badge PO/218 on Nagarjuna Olive should always have had. Its 12-of-36
        // received are fully challaned, so every item reads "matched" against the DC
        // and the old rollup could only call it Fully Matched — a badge that flatly
        // contradicted the Pending DN card counting it. `partially_delivered` says the
        // true thing, so the flag is no longer needed to paper over it here.
        reconcileStatus = "partially_delivered";
      } else if (hasDeliveryPending) {
        // Safety net for one hairline case the statuses above cannot express: the flag
        // uses a strict `orderedQty > dnQty` while `partially_delivered` allows
        // QTY_TOLERANCE, so an item short by less than 0.01 sets the flag while every
        // status reads "matched". Keeping this branch preserves the invariant that a PO
        // counted by the Pending DN card can NEVER badge Fully Matched.
        reconcileStatus = "pending_dn";
      } else {
        reconcileStatus = "matched";
      }


      resultRows.push({
        poNumber,
        vendorName: poEntry.vendorName,
        billingStatus: poBillingMap.get(poNumber) ?? "",
        totalOrderedQty: billableItems.reduce((sum, i) => sum + i.orderedQty, 0),
        totalDNQty,
        totalDCQty,
        totalDifference: billableItems.reduce((sum, i) => sum + i.difference, 0),
        itemsMatched: matchedItems,
        itemsTotal: billableItems.length,
        reconcileStatus,
        hasDeliveryPending,
        items: activeItems,
      });
    }

    // Handle POs that exist only in DC data (no PO items at all)
    for (const [poNumber, dcPOItems] of dcItemsByPO) {
      if (poMap.has(poNumber)) continue; // already processed

      const itemRows: DNDCItemRow[] = [];
      for (const [itemKey, dcData] of dcPOItems) {
        const [, itemId] = itemKey.split("___");
        itemRows.push({
          itemId,
          itemName: dcData.itemName,
          category: dcData.category,
          unit: dcData.unit,
          // Pre-existing omission, surfaced once the summary began reading this field:
          // DNDCItemRow requires billingStatus and this DC-only branch never set it.
          // "Billable" matches the sibling orphan-item branch above.
          billingStatus: "Billable",
          orderedQty: 0,
          dnQty: 0,
          dcQty: dcData.qty,
          difference: 0 - dcData.qty,
          status: "matched",
          deliveryPending: false,
        });
      }

      const activeItems = itemRows.filter(
        (item) => !(item.dnQty === 0 && item.dcQty === 0)
      );
      if (activeItems.length === 0) continue;

      // Find vendor name from DC docs
      const dcDoc = poDeliveryDocsData.message.find(
        (d) => d.procurement_order === poNumber
      );

      resultRows.push({
        poNumber,
        // A DC-only PO has no PO items at all, so nothing can be delivery-pending.
        hasDeliveryPending: false,
        vendorName: dcDoc?.vendor ?? "",
        billingStatus: poBillingMap.get(poNumber) ?? "",
        totalOrderedQty: 0,
        totalDNQty: 0,
        totalDCQty: activeItems.reduce((sum, i) => sum + i.dcQty, 0),
        totalDifference: activeItems.reduce((sum, i) => sum + i.difference, 0),
        itemsMatched: 0,
        itemsTotal: activeItems.length,
        reconcileStatus: "matched",
        items: activeItems,
      });
    }

    // 11. Summary — Billable POs only. A DC/MIR cannot be filed against a
    // Non-Billable PO, so including them would inflate "No DC Update" with rows
    // that can never be reconciled. The cards therefore count the actionable
    // (Billable) universe, matching the table's default Billing filter.
    const billableRows = resultRows.filter((r) => r.billingStatus !== "Non-Billable");
    const matchedPOs = billableRows.filter((r) => r.reconcileStatus === "matched").length;
    const mismatchPOs = billableRows.filter((r) => r.reconcileStatus === "mismatch").length;
    const noDCUpdatePOs = billableRows.filter((r) => r.reconcileStatus === "no_dc_update").length;
    // Rollup-based like the three above, so it PARTITIONS with them. A PO that is both
    // partially delivered and missing a challan is counted under No DC Update only —
    // the paperwork gap is the actionable half. Deliberately NOT flag-based: unlike
    // Pending DN, this card is not mirroring an Overview tile it has to agree with.
    const partiallyDeliveredPOs = billableRows.filter(
      (r) => r.reconcileStatus === "partially_delivered"
    ).length;
    // Counted from the ITEMS, not from `reconcileStatus`. A PO can owe both a delivery
    // and a challan — PO/218 on Nagarjuna Olive does — and the rollup gives each PO one
    // verdict, so counting by rollup would drop such a PO off this card (it ranks below
    // no_dc_update). Ranking pending_dn higher instead would move it OFF "No DC Update",
    // breaking that card's agreement with the project's DC Pending tile. So this card
    // OVERLAPS the other three rather than partitioning with them, exactly as the
    // Overview page shows DC Pending and DN Pending as two independent tiles.
    // Consequence: the four cards no longer sum to the PO total.
    const pendingDNPOs = billableRows.filter((r) => r.hasDeliveryPending).length;

    return {
      poRows: resultRows,
      summary: {
        totalPOs: billableRows.length,
        matchedPOs,
        mismatchPOs,
        noDCUpdatePOs,
        pendingDNPOs,
        partiallyDeliveredPOs,
      },
    };
  }, [isLoading, poItemData, poDeliveryDocsData, poList]);

  return {
    poRows,
    isLoading,
    error,
    summary,
  };
}
