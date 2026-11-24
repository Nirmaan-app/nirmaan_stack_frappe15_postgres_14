import { useCallback, useMemo } from 'react';
import { useFrappeGetCall, useFrappeGetDocList } from 'frappe-react-sdk';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { po_item_data_item } from '../project';
import { parseNumber } from '@/utils/parseNumber';
import { orderPaymentStatus } from '@/utils/projects/projectPaid';
import { DCMIRItemDisplay, DCMIRWiseDisplayItem, DeliveryDocumentInfo, DeliveryStatus, ItemITMEntry, MaterialUsageDisplayItem, OrderSourceType, OverallItemPOStatus, POStatus, POWiseChildItem, POWiseDisplayItem } from '../components/ProjectMaterialUsageTab';
import { determineDeliveryStatus, determineOverallItemPOStatus, itmDeliveryLookups, itmSourceName } from '../config/materialUsageHelpers';
import { PODeliveryDocuments } from '@/types/NirmaanStack/PODeliveryDocuments';
import formatToIndianRupee from "@/utils/FormatPrice";
const safeParseFloat = (value: string | number | undefined | null, defaultValue = 0): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
};

// Item-level DC/MIR lists carry this item's qty in each document (summed when a doc lists the item twice).
// Pushes a copy so the shared docInfo (also used by PO-level lists) stays qty-free.
const addItemDoc = (list: DeliveryDocumentInfo[], docInfo: DeliveryDocumentInfo, qty: number) => {
  const existing = list.find(d => d.name === docInfo.name);
  if (existing) existing.quantity = (existing.quantity || 0) + qty;
  else list.push({ ...docInfo, quantity: qty });
};

const ITM_DOCTYPE = "Internal Transfer Memo";

// An ITM has no payments: it counts as paid once Delivered, unpaid before that.
const itmPaidStatus = (itmStatus: string): POStatus => itmStatus === "Delivered" ? "Fully Paid" : "Unpaid";

/** One incoming ITM line for an item, as returned by `get_transfer_summary`. */
interface TransferSummaryITM {
  itm: string;
  status: string;
  /** "Project" or "Warehouse"; a Warehouse ITM has no source project. */
  source_type: string | null;
  source_project: string | null;
  source_project_name: string | null;
  ordered_qty: number;
  received_qty: number;
}

/** Per-item ITM aggregates from `get_transfer_summary`. */
interface TransferSummaryItem {
  transferred_out: number;
  transferred_in: number;
  ordered_in?: number;
  itms?: TransferSummaryITM[];
  item_name?: string;
  unit?: string;
  category?: string;
}

export function useMaterialUsageData(projectId: string) {
  const {
    data: po_item_data,
    isLoading: po_item_loading,
    error: po_item_error
  } = useFrappeGetCall<{
    message: {
      po_items: po_item_data_item[],
      custom_items: po_item_data_item[]
    }
  }>(
    "nirmaan_stack.api.procurement_orders.generate_po_summary",
    { project_id: projectId }
  );

    const {
    data: itemsData,
    isLoading: itemsLoading,
    error: itemsError,
  } = useFrappeGetDocList<{ name: string; billing_category: string }>('Items', {
    // Only need the ID and the Billing Category
    fields: ['name', 'billing_category'], 
    // For simplicity and speed, fetching all items is usually fine if the item count is reasonable.
    limit: 0,
  }, `all_items_billing_category`);

  const { data: poDeliveryDocsData, isLoading: poDeliveryLoading, error: poDeliveryError } = useFrappeGetCall<{
    message: PODeliveryDocuments[]
  }>(
    "nirmaan_stack.api.po_delivery_documentss.get_project_po_delivery_documents",
    // ITM-filed DCs/MIRs too: Item-wise and PO-wise views list them beside the PO ones.
    { project_id: projectId, include_itm: 1 },
    projectId ? `po_delivery_docs_${projectId}` : undefined
  );

  const { data: transferData } = useFrappeGetCall<{
    message: { data: Record<string, TransferSummaryItem> }
  }>(
    "nirmaan_stack.api.internal_transfers.project_transfers.get_transfer_summary",
    { project_id: projectId },
    projectId ? `transfer_summary_${projectId}` : undefined
  );

  // --- NEW MAP: Create Billing Category Lookup Map ---
  const billingCategoryMap = useMemo(() => {
    const map = new Map<string, string>();
    itemsData?.forEach(item => {
        if (item.name && item.billing_category) {
            map.set(item.name, item.billing_category);
        }
    });
    return map;
  }, [itemsData]);

  // Resolve billing category. Prefer the PO line item's own billing_status when present
  // (the live, per-PO value); otherwise fall back for non-PO rows (ITM / orphan DC) and
  // legacy-blank items: Items master lookup → "Additional Charges" = Non-Billable → Billable.
  const resolveBillingCategory = (itemId: string, category: string, poBillingStatus?: string | null): string => {
    return poBillingStatus
      || billingCategoryMap.get(itemId)
      || (category === "Additional Charges" ? "Non-Billable" : "Billable");
  };

  // Build maps from PO Delivery Documents data
  const { itemDeliveryMap, poDeliveryMap } = useMemo(() => {
    const itemMap = new Map<string, { dcQty: number; mirQty: number; dcs: DeliveryDocumentInfo[]; mirs: DeliveryDocumentInfo[] }>();
    const poMap = new Map<string, { dcs: DeliveryDocumentInfo[]; mirs: DeliveryDocumentInfo[] }>();

    const docs = poDeliveryDocsData?.message || [];

    for (const doc of docs) {
      const isStub = doc.is_stub === 1;
      // PO id resolution: parent_docname is the polymorphic field; procurement_order
      // is the deprecated legacy fallback for any pre-backfill row that slips through.
      const poId = doc.parent_docname || doc.procurement_order;
      if (!poId) continue;

      const docInfo: DeliveryDocumentInfo = {
        name: doc.name,
        referenceNumber: doc.reference_number || doc.name,
        dcDate: doc.dc_date,
        isSignedByClient: doc.is_signed_by_client === 1,
        attachmentUrl: doc.attachment_url,
        itemCount: doc.items?.length || 0,
        poNumber: poId,
        isStub,
        isITM: doc.parent_doctype === ITM_DOCTYPE,
      };

      const isDC = doc.type === "Delivery Challan";

      // Build poDeliveryMap (keyed by parent: a PO number or an ITM id)
      const poKey = poId;
      if (!poMap.has(poKey)) {
        poMap.set(poKey, { dcs: [], mirs: [] });
      }
      const poEntry = poMap.get(poKey)!;
      if (isDC) {
        poEntry.dcs.push(docInfo);
      } else {
        poEntry.mirs.push(docInfo);
      }

      // Build itemDeliveryMap - aggregate quantities per category_itemId
      // Stubs have no items, so skip them for item-level quantities
      if (!isStub && doc.items) {
        for (const item of doc.items) {
          const itemKey = `${item.category}_${item.item_id}`;
          if (!itemMap.has(itemKey)) {
            itemMap.set(itemKey, { dcQty: 0, mirQty: 0, dcs: [], mirs: [] });
          }
          const entry = itemMap.get(itemKey)!;
          if (isDC) {
            entry.dcQty += item.quantity || 0;
            addItemDoc(entry.dcs, docInfo, item.quantity || 0);
          } else {
            entry.mirQty += item.quantity || 0;
            addItemDoc(entry.mirs, docInfo, item.quantity || 0);
          }
        }
      }
    }

    return { itemDeliveryMap: itemMap, poDeliveryMap: poMap };
  }, [poDeliveryDocsData]);



  // This project's POs only, with their stored Amount Paid (refunds already off, ADR-0034).
  const { data: projectPOs } = useFrappeGetDocList<ProcurementOrder>('Procurement Orders', {
    fields: ['name', 'total_amount', 'amount_paid'],
    filters: [['project', '=', projectId], ['status', 'not in', ['Cancelled', 'Merged']]],
    limit: 0,
  }, projectId ? `material_usage_pos_${projectId}` : null);

  const poByName = useMemo(
    () => new Map((projectPOs || []).map(po => [po.name, po])),
    [projectPOs]
  );

  // The paid badge compares the PO's Amount Paid with its total (incl. GST).
  const getIndividualPOStatus = useCallback((poName: string): POStatus => {
    const po = poByName.get(poName);
    return orderPaymentStatus(parseNumber(po?.amount_paid), parseNumber(po?.total_amount));
  }, [poByName]);

  // Shared flat list of all PO items (regular + custom)
  const allPoItems = useMemo(() => [
    ...(po_item_data?.message?.po_items || []),
    ...(po_item_data?.message?.custom_items || [])
  ], [po_item_data]);

  const allMaterialUsageItems = useMemo((): MaterialUsageDisplayItem[] => {
    const usageByItemKey = new Map<string, MaterialUsageDisplayItem>();

    allPoItems.forEach((poItem, index) => {
      if (!poItem.item_id || !poItem.category) return;

      // === ADDED: Calculate amount for this specific PO item ===
      const basePrice = safeParseFloat(poItem.quantity) * safeParseFloat(poItem.quote);
      const taxRate = safeParseFloat(poItem.tax) / 100;
      const gstAmount = basePrice * (taxRate > 0 ? taxRate : 0.18); // Default to 18% if tax is invalid or 0
      const amountWithGst = basePrice + gstAmount;
      // =========================================================

      const itemKey = `${poItem.category}_${poItem.item_id}`;
      let currentItemUsage = usageByItemKey.get(itemKey);
      
      const individualPOsForItem: NonNullable<MaterialUsageDisplayItem['poNumbers']> = [...(currentItemUsage?.poNumbers || [])];

      if (poItem.po_number) {
        const existingPoEntry = individualPOsForItem.find(p => p.po === poItem.po_number);
        if (!existingPoEntry) {
          // === MODIFIED: Add the PO with its specific amount ===
          individualPOsForItem.push({
            po: poItem.po_number,
            status: getIndividualPOStatus(poItem.po_number),
            amount: amountWithGst,
            quote: safeParseFloat(poItem.quote),
            tax: taxRate > 0 ? safeParseFloat(poItem.tax) : 18,
            poCalculatedAmount:`(${poItem.quantity} x ${formatToIndianRupee(poItem.quote)}) + ${formatToIndianRupee(gstAmount)}(Gst)`,
          });
        }
      }

      const currentOrdered = (currentItemUsage?.orderedQuantity || 0) + safeParseFloat(poItem.quantity);
      const currentDelivered = (currentItemUsage?.deliveredQuantity || 0) + safeParseFloat(poItem.received_quantity);

      const deliveryStatusInfo = determineDeliveryStatus(currentDelivered, currentOrdered);
      const poPaymentStatusInfo = determineOverallItemPOStatus(individualPOsForItem);

      if (!currentItemUsage) {
          const itemBillingCategory = resolveBillingCategory(poItem.item_id, poItem.category, poItem.billing_status);
        currentItemUsage = {
          uniqueKey: itemKey + `_item_${index}`,
          itemId: poItem.item_id,
          categoryName: poItem.category,
          itemName: poItem.item_name,
          unit: poItem.unit,
          orderedQuantity: safeParseFloat(poItem.quantity),
          deliveredQuantity: safeParseFloat(poItem.received_quantity),
          dcQuantity: 0,
          mirQuantity: 0,
          // === ADDED: Initialize total amount ===
          totalAmount: amountWithGst,
          poNumbers: individualPOsForItem,
          vendorNames: poItem.vendor_name ? [poItem.vendor_name] : [],
          deliveryStatus: deliveryStatusInfo.deliveryStatusText,
          overallPOPaymentStatus: poPaymentStatusInfo,

           billingCategory: itemBillingCategory,
        };
      } else {
        currentItemUsage.orderedQuantity = currentOrdered;
        currentItemUsage.deliveredQuantity = currentDelivered;
        // === ADDED: Add the new amount to the existing total ===
        currentItemUsage.totalAmount = (currentItemUsage.totalAmount || 0) + amountWithGst;
        currentItemUsage.poNumbers = individualPOsForItem;
        // Collect vendor names from all POs for this item
        if (poItem.vendor_name && !currentItemUsage.vendorNames?.includes(poItem.vendor_name)) {
          currentItemUsage.vendorNames = [...(currentItemUsage.vendorNames || []), poItem.vendor_name];
        }
        currentItemUsage.deliveryStatus = deliveryStatusInfo.deliveryStatusText;
        currentItemUsage.overallPOPaymentStatus = poPaymentStatusInfo;
      }
      usageByItemKey.set(itemKey, currentItemUsage);
    });

    const flatList = Array.from(usageByItemKey.values());

    // Assign DC/MIR data from PO Delivery Documents
    flatList.forEach(item => {
      const itemKey = `${item.categoryName}_${item.itemId}`;
      const deliveryData = itemDeliveryMap.get(itemKey);

      item.dcQuantity = deliveryData?.dcQty || 0;
      item.mirQuantity = deliveryData?.mirQty || 0;
      item.deliveryChallans = deliveryData?.dcs || [];
      item.dcCount = deliveryData?.dcs?.length || 0;
      item.mirs = deliveryData?.mirs || [];
      item.mirCount = deliveryData?.mirs?.length || 0;
    });

    // Incoming ITMs (Approved or later) for an item, shaped for the PO / ITM Number(s) column.
    const toITMEntries = (itmData: TransferSummaryItem): ItemITMEntry[] =>
      (itmData.itms || []).map(i => ({
        itm: i.itm,
        itmStatus: i.status,
        status: itmPaidStatus(i.status),
        sourceName: itmSourceName(i),
        orderedQty: i.ordered_qty || 0,
      }));

    // Merge ITM transfer data into existing PO rows.
    // Ordered = PO ordered + ITM ordered (Approved or later); Delivered = PO received + ITM received.
    const transferSummary = transferData?.message?.data || {};
    flatList.forEach(item => {
      item.poOrderedQty = item.orderedQuantity; // PO-only value (Inventory Report reads this)
      if (!item.itemId) return;
      const itmData = transferSummary[item.itemId];
      if (itmData) {
        item.transferredOut = itmData.transferred_out || 0;
        item.itmDeliveredQty = itmData.transferred_in || 0;
        item.poDeliveredQty = item.deliveredQuantity; // save PO-only value
        item.deliveredQuantity += item.itmDeliveredQty; // combined
        item.itmOrderedQty = itmData.ordered_in || 0;
        item.orderedQuantity += item.itmOrderedQty; // combined
        item.itmNumbers = toITMEntries(itmData);
        item.deliveryStatus = determineDeliveryStatus(item.deliveredQuantity, item.orderedQuantity).deliveryStatusText;
        item.overallPOPaymentStatus = determineOverallItemPOStatus([...(item.poNumbers || []), ...item.itmNumbers]);
      }
    });

    // Create rows for items coming in by ITM but not in any PO for this project
    Object.entries(transferSummary).forEach(([itemId, itmData]) => {
      // Skip if item already exists in table (handled by merge above)
      const alreadyExists = Array.from(usageByItemKey.keys()).some(
        key => key.endsWith(`_${itemId}`)
      );
      if (alreadyExists) return;

      // Only create a row when an incoming ITM carries this item
      const orderedIn = itmData.ordered_in || 0;
      const transferredIn = itmData.transferred_in || 0;
      if (!(orderedIn > 0 || transferredIn > 0)) return;

      const category = itmData.category || "Transferred In";
      const itemKey = `${category}_${itemId}`;
      const itmNumbers = toITMEntries(itmData);
      const deliveryData = itemDeliveryMap.get(itemKey);

      const newItem: MaterialUsageDisplayItem = {
        uniqueKey: `itm_transfer_${itemId}`,
        itemId: itemId,
        categoryName: category,
        itemName: itmData.item_name || itemId,
        unit: itmData.unit || "",
        orderedQuantity: orderedIn,
        deliveredQuantity: transferredIn,
        dcQuantity: deliveryData?.dcQty || 0,
        mirQuantity: deliveryData?.mirQty || 0,
        deliveryChallans: deliveryData?.dcs || [],
        dcCount: deliveryData?.dcs?.length || 0,
        mirs: deliveryData?.mirs || [],
        mirCount: deliveryData?.mirs?.length || 0,
        totalAmount: 0,
        poNumbers: [],
        itmNumbers,
        deliveryStatus: determineDeliveryStatus(transferredIn, orderedIn).deliveryStatusText,
        overallPOPaymentStatus: determineOverallItemPOStatus(itmNumbers),
        billingCategory: resolveBillingCategory(itemId, category),
        transferredOut: itmData.transferred_out || 0,
        itmDeliveredQty: transferredIn,
        poDeliveredQty: 0,
        itmOrderedQty: orderedIn,
        poOrderedQty: 0,
        isTransferredInItem: true,
      };

      usageByItemKey.set(itemKey, newItem);
      flatList.push(newItem);
    });

    flatList.sort((a, b) => {
      if (a.categoryName.localeCompare(b.categoryName) !== 0) {
        return a.categoryName.localeCompare(b.categoryName);
      }
      return (a.itemName || "").localeCompare(b.itemName || "");
    });

    return flatList;
  }, [allPoItems, getIndividualPOStatus, billingCategoryMap, itemDeliveryMap, transferData]);

  // --- Vendor lookup by PO (shared by PO-wise and DC/MIR-wise) ---
  const vendorByPO = useMemo(() => {
    const map = new Map<string, string>();
    allPoItems.forEach(item => {
      if (item.po_number && !map.has(item.po_number)) {
        map.set(item.po_number, item.vendor_name);
      }
    });
    return map;
  }, [allPoItems]);

  // --- Compute PO-wise aggregated items (from raw po_item_data + incoming ITMs, NOT from allMaterialUsageItems) ---
  const poWiseItems = useMemo((): POWiseDisplayItem[] => {
    const transferSummary = transferData?.message?.data || {};

    // --- Step 1: Build per-PO DC/MIR item delivery map ---
    // Key: "poNumber_category_itemId" → { dcQty, mirQty, dcs[], mirs[] }
    const poItemDeliveryMap = new Map<string, {
      dcQty: number; mirQty: number;
      dcs: DeliveryDocumentInfo[]; mirs: DeliveryDocumentInfo[];
    }>();
    const docs = poDeliveryDocsData?.message || [];
    for (const doc of docs) {
      if (doc.is_stub === 1 || !doc.items) continue;
      const poId = doc.parent_docname || doc.procurement_order;
      if (!poId) continue;
      const isDC = doc.type === "Delivery Challan";
      const docInfo: DeliveryDocumentInfo = {
        name: doc.name,
        referenceNumber: doc.reference_number || doc.name,
        dcDate: doc.dc_date,
        isSignedByClient: doc.is_signed_by_client === 1,
        attachmentUrl: doc.attachment_url,
        itemCount: doc.items.length,
        poNumber: poId,
        isStub: false,
        isITM: doc.parent_doctype === ITM_DOCTYPE,
      };
      for (const item of doc.items) {
        const key = `${poId}_${item.category}_${item.item_id}`;
        if (!poItemDeliveryMap.has(key)) {
          poItemDeliveryMap.set(key, { dcQty: 0, mirQty: 0, dcs: [], mirs: [] });
        }
        const entry = poItemDeliveryMap.get(key)!;
        if (isDC) {
          entry.dcQty += item.quantity || 0;
          addItemDoc(entry.dcs, docInfo, item.quantity || 0);
        } else {
          entry.mirQty += item.quantity || 0;
          addItemDoc(entry.mirs, docInfo, item.quantity || 0);
        }
      }
    }

    // --- Step 2: Group raw PO items by PO, then by category_itemId within each PO ---
    // (Step 2b adds one group per incoming ITM, keyed by the ITM id.)
    const poGroupMap = new Map<string, {
      type: OrderSourceType;
      sourceName: string;           // ITM source project name; unused for POs
      categories: Set<string>;
      childItemMap: Map<string, POWiseChildItem>;
      totalOrderedQty: number;
      totalDeliveryNoteQty: number;
      totalDCQty: number;
      totalMIRQty: number;
      totalAmount: number;
      poStatus: POStatus;
    }>();

    for (const poItem of allPoItems) {
      if (!poItem.item_id || !poItem.category) continue;
      const poNumber = poItem.po_number;
      const itemKey = `${poItem.category}_${poItem.item_id}`;
      const deliveryKey = `${poNumber}_${itemKey}`;

      const qty = safeParseFloat(poItem.quantity);
      const quote = safeParseFloat(poItem.quote);
      const taxPct = safeParseFloat(poItem.tax);
      const basePrice = qty * quote;
      const effectiveTax = taxPct > 0 ? taxPct : 18;
      const gstAmount = basePrice * (effectiveTax / 100);
      const amount = basePrice + gstAmount;
      const recvQty = safeParseFloat(poItem.received_quantity);

      const delivery = poItemDeliveryMap.get(deliveryKey);

      if (!poGroupMap.has(poNumber)) {
        poGroupMap.set(poNumber, {
          type: "PO",
          sourceName: "",
          categories: new Set(),
          childItemMap: new Map(),
          totalOrderedQty: 0, totalDeliveryNoteQty: 0,
          totalDCQty: 0, totalMIRQty: 0, totalAmount: 0,
          poStatus: getIndividualPOStatus(poNumber),
        });
      }
      const group = poGroupMap.get(poNumber)!;
      group.categories.add(poItem.category);

      // Merge same-item lines within same PO (sum quantities)
      if (group.childItemMap.has(itemKey)) {
        const existing = group.childItemMap.get(itemKey)!;
        existing.orderedQuantity += qty;
        existing.deliveredQuantity += recvQty;
        existing.amount += amount;
      } else {
        group.childItemMap.set(itemKey, {
          itemId: poItem.item_id,
          itemName: poItem.item_name,
          categoryName: poItem.category,
          unit: poItem.unit,
          billingCategory: resolveBillingCategory(poItem.item_id, poItem.category, poItem.billing_status),
          orderedQuantity: qty,
          deliveredQuantity: recvQty,
          dcQuantity: delivery?.dcQty || 0,
          mirQuantity: delivery?.mirQty || 0,
          quote,
          tax: effectiveTax,
          amount,
          deliveryChallans: delivery?.dcs || [],
          dcCount: delivery?.dcs?.length || 0,
          mirs: delivery?.mirs || [],
          mirCount: delivery?.mirs?.length || 0,
        });
      }

      group.totalOrderedQty += qty;
      group.totalDeliveryNoteQty += recvQty;
      group.totalAmount += amount;
    }

    // --- Step 2b: One group per incoming ITM (Approved or later), children from the transfer summary ---
    for (const [itemId, itmData] of Object.entries(transferSummary)) {
      const category = itmData.category || "Transferred In";
      const itemKey = `${category}_${itemId}`;
      for (const itmLine of itmData.itms || []) {
        if (!poGroupMap.has(itmLine.itm)) {
          poGroupMap.set(itmLine.itm, {
            type: "ITM",
            sourceName: itmSourceName(itmLine),
            categories: new Set(),
            childItemMap: new Map(),
            totalOrderedQty: 0, totalDeliveryNoteQty: 0,
            totalDCQty: 0, totalMIRQty: 0, totalAmount: 0,
            poStatus: itmPaidStatus(itmLine.status),
          });
        }
        const group = poGroupMap.get(itmLine.itm)!;
        group.categories.add(category);
        const delivery = poItemDeliveryMap.get(`${itmLine.itm}_${itemKey}`);
        group.childItemMap.set(itemKey, {
          itemId,
          itemName: itmData.item_name || itemId,
          categoryName: category,
          unit: itmData.unit || "",
          billingCategory: resolveBillingCategory(itemId, category),
          orderedQuantity: itmLine.ordered_qty || 0,
          deliveredQuantity: itmLine.received_qty || 0,
          dcQuantity: delivery?.dcQty || 0,
          mirQuantity: delivery?.mirQty || 0,
          quote: 0,
          tax: 0,
          amount: 0,
          deliveryChallans: delivery?.dcs || [],
          dcCount: delivery?.dcs?.length || 0,
          mirs: delivery?.mirs || [],
          mirCount: delivery?.mirs?.length || 0,
        });
        group.totalOrderedQty += itmLine.ordered_qty || 0;
        group.totalDeliveryNoteQty += itmLine.received_qty || 0;
      }
    }

    // Compute PO-level DC/MIR totals from child items
    for (const group of poGroupMap.values()) {
      group.totalDCQty = 0;
      group.totalMIRQty = 0;
      for (const child of group.childItemMap.values()) {
        group.totalDCQty += child.dcQuantity;
        group.totalMIRQty += child.mirQuantity;
      }
    }

    // --- Step 3: Orphan DC/MIR item detection ---
    for (const doc of docs) {
      if (doc.is_stub === 1 || !doc.items || doc.items.length === 0) continue;
      const poNumber = doc.parent_docname || doc.procurement_order;
      if (!poNumber) continue;
      const existingGroup = poGroupMap.get(poNumber);

      for (const childItem of doc.items) {
        const childKey = `${childItem.category}_${childItem.item_id}`;
        if (existingGroup?.childItemMap.has(childKey)) continue;

        const orphanKey = `orphan_${childKey}`;
        if (existingGroup?.childItemMap.has(orphanKey)) {
          const orphan = existingGroup.childItemMap.get(orphanKey)!;
          const isDC = doc.type === "Delivery Challan";
          if (isDC) orphan.dcQuantity += childItem.quantity || 0;
          else orphan.mirQuantity += childItem.quantity || 0;
          continue;
        }

        const deliveryKey = `${poNumber}_${childKey}`;
        const delivery = poItemDeliveryMap.get(deliveryKey);
        const orphan: POWiseChildItem = {
          itemId: childItem.item_id,
          itemName: childItem.item_name,
          categoryName: childItem.category || 'Unknown',
          unit: childItem.unit,
          billingCategory: resolveBillingCategory(childItem.item_id, childItem.category || ""),
          orderedQuantity: 0,
          deliveredQuantity: 0,
          dcQuantity: delivery?.dcQty || 0,
          mirQuantity: delivery?.mirQty || 0,
          quote: 0,
          tax: 0,
          amount: 0,
          deliveryChallans: delivery?.dcs || [],
          dcCount: delivery?.dcs?.length || 0,
          mirs: delivery?.mirs || [],
          mirCount: delivery?.mirs?.length || 0,
          isOrphanDCItem: true,
        };

        if (!poGroupMap.has(poNumber)) {
          poGroupMap.set(poNumber, {
            type: doc.parent_doctype === ITM_DOCTYPE ? "ITM" : "PO",
            sourceName: "",
            categories: new Set([orphan.categoryName]),
            childItemMap: new Map([[orphanKey, orphan]]),
            totalOrderedQty: 0, totalDeliveryNoteQty: 0,
            totalDCQty: orphan.dcQuantity, totalMIRQty: orphan.mirQuantity,
            totalAmount: 0,
            poStatus: 'Unpaid' as POStatus,
          });
        } else {
          const group = poGroupMap.get(poNumber)!;
          group.childItemMap.set(orphanKey, orphan);
          group.categories.add(orphan.categoryName);
          group.totalDCQty += orphan.dcQuantity;
          group.totalMIRQty += orphan.mirQuantity;
        }
      }
    }

    // --- Step 4: Build final display items ---
    return Array.from(poGroupMap.entries()).map(([poNumber, group]) => {
      const deliveryDocs = poDeliveryMap.get(poNumber);
      const categories = Array.from(group.categories);
      const items = Array.from(group.childItemMap.values());

      return {
        type: group.type,
        poNumber,
        vendorName: group.type === "ITM" ? group.sourceName : (vendorByPO.get(poNumber) || ''),
        category: categories.length === 1 ? categories[0] : `Multiple (${categories.length})`,
        billingCategory: items.some(i => i.billingCategory === "Billable")
          ? "Billable"
          : items.some(i => i.billingCategory === "Non-Billable")
            ? "Non-Billable"
            : "N/A",
        totalOrderedQty: group.totalOrderedQty,
        totalDeliveryNoteQty: group.totalDeliveryNoteQty,
        totalDCQty: group.totalDCQty,
        totalMIRQty: group.totalMIRQty,
        totalAmount: group.totalAmount,
        deliveryStatus: determineDeliveryStatus(group.totalDeliveryNoteQty, group.totalOrderedQty).deliveryStatusText,
        paymentStatus: group.poStatus,
        dcs: deliveryDocs?.dcs || [],
        mirs: deliveryDocs?.mirs || [],
        items,
      };
    });
  }, [allPoItems, billingCategoryMap, poDeliveryDocsData, poDeliveryMap, vendorByPO, getIndividualPOStatus, transferData]);

  // --- Compute DC-wise and MIR-wise aggregated items ---
  const { dcWiseItems, mirWiseItems } = useMemo((): { dcWiseItems: DCMIRWiseDisplayItem[]; mirWiseItems: DCMIRWiseDisplayItem[] } => {
    const docs = poDeliveryDocsData?.message || [];
    const dcItems: DCMIRWiseDisplayItem[] = [];
    const mirItems: DCMIRWiseDisplayItem[] = [];

    // Build PO-item lookups keyed by "poNumber_category_itemId":
    //   - received quantity (existing)
    //   - billing_status (so DC/MIR-wise rows use the live per-PO billing value,
    //     falling back to the Items master only for stub/orphan rows not on a PO)
    const poItemReceivedMap = new Map<string, number>();
    const poItemBillingMap = new Map<string, string>();
    allPoItems.forEach(item => {
      const key = `${item.po_number}_${item.category}_${item.item_id}`;
      poItemReceivedMap.set(key, (poItemReceivedMap.get(key) || 0) + safeParseFloat(item.received_quantity));
      if (item.billing_status) poItemBillingMap.set(key, item.billing_status);
    });

    // ITM-filed DCs / MIRs are listed too, beside the PO ones. An ITM's "DN Qty" is its received quantity
    // per item, and its vendor is where the material came from, from the transfer summary.
    const itmLookups = itmDeliveryLookups(transferData?.message?.data || {});

    for (const doc of docs) {
      const isITM = doc.parent_doctype === ITM_DOCTYPE;
      const isStub = doc.is_stub === 1;
      const poId = doc.parent_docname || doc.procurement_order || "";

      const displayItems: DCMIRItemDisplay[] = (doc.items || []).map(item => {
        const recvKey = `${poId}_${item.category}_${item.item_id}`;
        return {
          itemId: item.item_id,
          itemName: item.item_name,
          category: item.category || "",
          unit: item.unit,
          receivedQuantity: isITM
            ? itmLookups.receivedQty.get(`${poId}_${item.item_id}`) || 0
            : poItemReceivedMap.get(recvKey) || 0,
          quantity: item.quantity || 0,
          make: item.make,
          billingCategory: resolveBillingCategory(item.item_id, item.category || "", poItemBillingMap.get(recvKey)),
        };
      });

      const docBillingCategory = displayItems.some(i => i.billingCategory === "Billable")
        ? "Billable"
        : displayItems.some(i => i.billingCategory === "Non-Billable")
          ? "Non-Billable"
          : "N/A";

      const displayItem: DCMIRWiseDisplayItem = {
        documentName: doc.name,
        referenceNumber: doc.reference_number || doc.name,
        dcReference: doc.dc_reference,
        type: isITM ? "ITM" : "PO",
        poNumber: poId,
        vendorName: isITM ? itmLookups.fromLabel.get(poId) || "" : vendorByPO.get(poId) || "",
        dcDate: doc.dc_date,
        creation: doc.creation,
        billingCategory: isStub ? "N/A" : docBillingCategory,
        totalReceivedQuantity: displayItems.reduce((sum, i) => sum + i.receivedQuantity, 0),
        totalQuantity: displayItems.reduce((sum, i) => sum + i.quantity, 0),
        itemCount: displayItems.length,
        isSignedByClient: doc.is_signed_by_client === 1,
        attachmentUrl: doc.attachment_url,
        isStub,
        items: displayItems,
      };

      if (doc.type === "Delivery Challan") {
        dcItems.push(displayItem);
      } else {
        mirItems.push(displayItem);
      }
    }

    return { dcWiseItems: dcItems, mirWiseItems: mirItems };
  }, [poDeliveryDocsData, billingCategoryMap, vendorByPO, allPoItems, transferData]);

  // --- Generate Filter Options ---
  const categoryOptions = useMemo(() => {
    if (!allMaterialUsageItems) return [];
    const uniqueCategories = new Set(allMaterialUsageItems.map(item => item.categoryName));
    return Array.from(uniqueCategories).sort().map(cat => ({ label: cat, value: cat }));
  }, [allMaterialUsageItems]);

  const deliveryStatusOptions: { label: string; value: DeliveryStatus }[] = useMemo(() => [
    { label: "Fully Delivered", value: "Fully Delivered" },
    { label: "Partially Delivered", value: "Partially Delivered" },
    { label: "Pending Delivery", value: "Pending Delivery" },
    { label: "Not Ordered", value: "Not Ordered" },
  ], []);

  const poStatusOptions: { label: string; value: OverallItemPOStatus }[] = useMemo(() => [
    { label: "Fully Paid", value: "Fully Paid" },
    { label: "Partially Paid", value: "Partially Paid" },
    { label: "Unpaid", value: "Unpaid" },
    { label: "N/A", value: "N/A" },
  ], []);

  const billingCategoryOptions = useMemo(() => {
    if (!allMaterialUsageItems) return [];
    const uniqueBillingCategories = new Set(allMaterialUsageItems.map(item => item.billingCategory || ""));
    const hasEmpty = uniqueBillingCategories.has("");
    const sorted = Array.from(uniqueBillingCategories).filter(Boolean).sort().map(bc => ({ label: bc, value: bc }));
    if (hasEmpty) sorted.push({ label: "N/A", value: "N/A" });
    return sorted;
  }, [allMaterialUsageItems]);

  return {
    allMaterialUsageItems,
    poWiseItems,
    dcWiseItems,
    mirWiseItems,
    poDeliveryMap,
    isLoading: po_item_loading || itemsLoading || poDeliveryLoading,
    error: po_item_error || itemsError || poDeliveryError,
    categoryOptions,
    billingCategoryOptions,
    deliveryStatusOptions,
    poStatusOptions,
  };
}