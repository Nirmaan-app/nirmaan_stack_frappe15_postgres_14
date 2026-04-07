import { useCallback, useMemo } from 'react';
import { useFrappeGetCall, useFrappeGetDocList } from 'frappe-react-sdk';
import { memoize } from 'lodash';
import { ProjectEstimates } from '@/types/NirmaanStack/ProjectEstimates';
import { po_item_data_item } from '../project';
import { parseNumber } from '@/utils/parseNumber';
import { useOrderTotals } from '@/hooks/useOrderTotals';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { DCMIRItemDisplay, DCMIRWiseDisplayItem, DeliveryDocumentInfo, DeliveryStatus, MaterialUsageDisplayItem, OverallItemPOStatus, POStatus, POWiseChildItem, POWiseDisplayItem } from '../components/ProjectMaterialUsageTab';
import { determineDeliveryStatus, determineOverallItemPOStatus } from '../config/materialUsageHelpers';
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

export function useMaterialUsageData(projectId: string, projectPayments?: ProjectPayments[]) {
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
    data: projectEstimates,
    isLoading: estimatesLoading,
    error: estimatesError,
  } = useFrappeGetDocList<ProjectEstimates>('Project Estimates', {
    fields: ['name', 'project', 'work_package', 'category', 'item', 'item_name', 'uom', 'quantity_estimate'],
    filters: [['project', '=', projectId]],
    limit: 0,
  }, `project_estimates_${projectId}`);

    const {
    data: itemsData,
    isLoading: itemsLoading,
    error: itemsError,
  } = useFrappeGetDocList<{ name: string; billing_category: string }>('Items', {
    // Only need the ID and the Billing Category
    fields: ['name', 'billing_category'], 
    // Filter to only include items that have estimates or PO items (Optimization is complex, fetching all is safest)
    // For simplicity and speed, fetching all items is usually fine if the item count is reasonable.
    limit: 0,
  }, `all_items_billing_category`);

  const { data: poDeliveryDocsData, isLoading: poDeliveryLoading, error: poDeliveryError } = useFrappeGetCall<{
    message: PODeliveryDocuments[]
  }>(
    "nirmaan_stack.api.po_delivery_documentss.get_project_po_delivery_documents",
    { project_id: projectId },
    projectId ? `po_delivery_docs_${projectId}` : undefined
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

  // Build maps from PO Delivery Documents data
  const { itemDeliveryMap, poDeliveryMap } = useMemo(() => {
    const itemMap = new Map<string, { dcQty: number; mirQty: number; dcs: DeliveryDocumentInfo[]; mirs: DeliveryDocumentInfo[] }>();
    const poMap = new Map<string, { dcs: DeliveryDocumentInfo[]; mirs: DeliveryDocumentInfo[] }>();

    const docs = poDeliveryDocsData?.message || [];

    for (const doc of docs) {
      const isStub = doc.is_stub === 1;

      const docInfo: DeliveryDocumentInfo = {
        name: doc.name,
        referenceNumber: doc.reference_number || doc.name,
        dcDate: doc.dc_date,
        isSignedByClient: doc.is_signed_by_client === 1,
        attachmentUrl: doc.attachment_url,
        itemCount: doc.items?.length || 0,
        poNumber: doc.procurement_order,
        isStub,
      };

      const isDC = doc.type === "Delivery Challan";

      // Build poDeliveryMap
      const poKey = doc.procurement_order;
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
            // Only add the doc reference if not already present
            if (!entry.dcs.find(d => d.name === doc.name)) {
              entry.dcs.push(docInfo);
            }
          } else {
            entry.mirQty += item.quantity || 0;
            if (!entry.mirs.find(d => d.name === doc.name)) {
              entry.mirs.push(docInfo);
            }
          }
        }
      }
    }

    return { itemDeliveryMap: itemMap, poDeliveryMap: poMap };
  }, [poDeliveryDocsData]);



  const { getTotalAmount } = useOrderTotals();

  const getAmountPaidForPO = useMemo(() => {
    if (!projectPayments) return () => 0;
    const paymentsMap = new Map<string, number>();
    projectPayments.forEach(p => {
      if (p.document_name && p.status === "Paid") {
        paymentsMap.set(p.document_name, (paymentsMap.get(p.document_name) || 0) + parseNumber(p.amount));
      }
    });
    return memoize((poName: string) => paymentsMap.get(poName) || 0);
  }, [projectPayments]);

  const getIndividualPOStatus = useCallback((poName: string): POStatus => {
    const amountPaid = getAmountPaidForPO(poName);
    const orderTotals = getTotalAmount(poName, 'Procurement Orders');

    if (!orderTotals || orderTotals.totalWithTax === 0 && amountPaid === 0) {
      return "Unpaid";
    }
    const totalAmount = orderTotals.totalWithTax;

    if (amountPaid <= 0) return "Unpaid";
    if (amountPaid >= totalAmount) return "Fully Paid";
    return "Partially Paid";
  }, [getAmountPaidForPO, getTotalAmount]);

  // Shared flat list of all PO items (regular + custom)
  const allPoItems = useMemo(() => [
    ...(po_item_data?.message?.po_items || []),
    ...(po_item_data?.message?.custom_items || [])
  ], [po_item_data]);

  const allMaterialUsageItems = useMemo((): MaterialUsageDisplayItem[] => {
    if (allPoItems.length === 0 || !projectEstimates) {
      return [];
    }

    const estimatesMap = new Map<string, ProjectEstimates>();
    projectEstimates.forEach(est => {
      if (est.item) {
        estimatesMap.set(est.item, est);
      }
    });

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
        const estimate = estimatesMap.get(poItem.item_id);
          const itemBillingCategory = billingCategoryMap.get(poItem.item_id) || (poItem.category === "Additional Charges" ? "" : poItem.item_id?.startsWith("ITEM-") ? "" : "Billable");
        currentItemUsage = {
          uniqueKey: itemKey + `_item_${index}`,
          itemId: poItem.item_id,
          categoryName: poItem.category,
          itemName: poItem.item_name || estimate?.item_name,
          unit: poItem.unit || estimate?.uom,
          orderedQuantity: safeParseFloat(poItem.quantity),
          deliveredQuantity: safeParseFloat(poItem.received_quantity),
          dcQuantity: 0,
          mirQuantity: 0,
          estimatedQuantity: safeParseFloat(estimate?.quantity_estimate),
          // === ADDED: Initialize total amount ===
          totalAmount: amountWithGst,
          poNumbers: individualPOsForItem,
          vendorNames: poItem.vendor_name ? [poItem.vendor_name] : [],
          deliveryStatus: deliveryStatusInfo.deliveryStatusText,
          overallPOPaymentStatus: poPaymentStatusInfo,

           billingCategory: itemBillingCategory||"",
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

    flatList.sort((a, b) => {
      if (a.categoryName.localeCompare(b.categoryName) !== 0) {
        return a.categoryName.localeCompare(b.categoryName);
      }
      return (a.itemName || "").localeCompare(b.itemName || "");
    });

    return flatList;
  }, [allPoItems, projectEstimates, getIndividualPOStatus, billingCategoryMap, itemDeliveryMap]);

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

  // --- Compute PO-wise aggregated items (from raw po_item_data, NOT from allMaterialUsageItems) ---
  const poWiseItems = useMemo((): POWiseDisplayItem[] => {
    if (allPoItems.length === 0) return [];

    // --- Step 1: Build per-PO DC/MIR item delivery map ---
    // Key: "poNumber_category_itemId" → { dcQty, mirQty, dcs[], mirs[] }
    const poItemDeliveryMap = new Map<string, {
      dcQty: number; mirQty: number;
      dcs: DeliveryDocumentInfo[]; mirs: DeliveryDocumentInfo[];
    }>();
    const docs = poDeliveryDocsData?.message || [];
    for (const doc of docs) {
      if (doc.is_stub === 1 || !doc.items) continue;
      const isDC = doc.type === "Delivery Challan";
      const docInfo: DeliveryDocumentInfo = {
        name: doc.name,
        referenceNumber: doc.reference_number || doc.name,
        dcDate: doc.dc_date,
        isSignedByClient: doc.is_signed_by_client === 1,
        attachmentUrl: doc.attachment_url,
        itemCount: doc.items.length,
        poNumber: doc.procurement_order,
        isStub: false,
      };
      for (const item of doc.items) {
        const key = `${doc.procurement_order}_${item.category}_${item.item_id}`;
        if (!poItemDeliveryMap.has(key)) {
          poItemDeliveryMap.set(key, { dcQty: 0, mirQty: 0, dcs: [], mirs: [] });
        }
        const entry = poItemDeliveryMap.get(key)!;
        if (isDC) {
          entry.dcQty += item.quantity || 0;
          if (!entry.dcs.find(d => d.name === doc.name)) entry.dcs.push(docInfo);
        } else {
          entry.mirQty += item.quantity || 0;
          if (!entry.mirs.find(d => d.name === doc.name)) entry.mirs.push(docInfo);
        }
      }
    }

    // --- Step 2: Group raw PO items by PO, then by category_itemId within each PO ---
    const poGroupMap = new Map<string, {
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
          billingCategory: billingCategoryMap.get(poItem.item_id) || "",
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
      const poNumber = doc.procurement_order;
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
          billingCategory: billingCategoryMap.get(childItem.item_id) || "",
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
        poNumber,
        vendorName: vendorByPO.get(poNumber) || '',
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
  }, [allPoItems, billingCategoryMap, poDeliveryDocsData, poDeliveryMap, vendorByPO, getIndividualPOStatus]);

  // --- Compute DC-wise and MIR-wise aggregated items ---
  const { dcWiseItems, mirWiseItems } = useMemo((): { dcWiseItems: DCMIRWiseDisplayItem[]; mirWiseItems: DCMIRWiseDisplayItem[] } => {
    const docs = poDeliveryDocsData?.message || [];
    const dcItems: DCMIRWiseDisplayItem[] = [];
    const mirItems: DCMIRWiseDisplayItem[] = [];

    // Build PO-item received quantity lookup: "poNumber_category_itemId" → received_quantity
    const poItemReceivedMap = new Map<string, number>();
    allPoItems.forEach(item => {
      const key = `${item.po_number}_${item.category}_${item.item_id}`;
      poItemReceivedMap.set(key, (poItemReceivedMap.get(key) || 0) + safeParseFloat(item.received_quantity));
    });

    for (const doc of docs) {
      const isStub = doc.is_stub === 1;

      const displayItems: DCMIRItemDisplay[] = (doc.items || []).map(item => {
        const recvKey = `${doc.procurement_order}_${item.category}_${item.item_id}`;
        return {
          itemId: item.item_id,
          itemName: item.item_name,
          category: item.category || "",
          unit: item.unit,
          receivedQuantity: poItemReceivedMap.get(recvKey) || 0,
          quantity: item.quantity || 0,
          make: item.make,
          billingCategory: billingCategoryMap.get(item.item_id) || "",
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
        poNumber: doc.procurement_order,
        vendorName: vendorByPO.get(doc.procurement_order) || "",
        dcDate: doc.dc_date,
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
  }, [poDeliveryDocsData, billingCategoryMap, vendorByPO, allPoItems]);

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
    isLoading: po_item_loading || estimatesLoading || itemsLoading || poDeliveryLoading,
    error: po_item_error || estimatesError || itemsError || poDeliveryError,
    categoryOptions,
    billingCategoryOptions,
    deliveryStatusOptions,
    poStatusOptions,
  };
}