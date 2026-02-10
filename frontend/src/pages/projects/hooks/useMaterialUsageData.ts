import { useCallback, useMemo } from 'react';
import { useFrappeGetCall, useFrappeGetDocList } from 'frappe-react-sdk';
import { memoize } from 'lodash';
import { ProjectEstimates } from '@/types/NirmaanStack/ProjectEstimates';
import { po_item_data_item } from '../project';
import { parseNumber } from '@/utils/parseNumber';
import { useOrderTotals } from '@/hooks/useOrderTotals';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { DeliveryDocumentInfo, DeliveryStatus, MaterialUsageDisplayItem, OverallItemPOStatus, POStatus, POWiseDisplayItem } from '../components/ProjectMaterialUsageTab';
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
  } = useFrappeGetDocList<ItemBillingCategory>('Items', {
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
      if (doc.is_stub) continue; // Skip stub documents

      const docInfo: DeliveryDocumentInfo = {
        name: doc.name,
        referenceNumber: doc.reference_number || doc.name,
        dcDate: doc.dc_date,
        isSignedByClient: doc.is_signed_by_client === 1,
        attachmentUrl: doc.attachment_url,
        itemCount: doc.items?.length || 0,
        poNumber: doc.procurement_order,
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
      if (doc.items) {
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

  const allMaterialUsageItems = useMemo((): MaterialUsageDisplayItem[] => {
    if (!po_item_data?.message || !projectEstimates) {
      return [];
    }

    const allPoItems = [
      ...(po_item_data.message.po_items || []),
      ...(po_item_data.message.custom_items || [])
    ];

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
      
      // === MODIFIED: The type for this array now includes `amount` ===
      const individualPOsForItem: { po: string; status: POStatus; amount: number;poCalculatedAmount: string;
       }[] = currentItemUsage?.poNumbers || [];

      if (poItem.po_number) {
        const existingPoEntry = individualPOsForItem.find(p => p.po === poItem.po_number);
        if (!existingPoEntry) {
          // === MODIFIED: Add the PO with its specific amount ===
          individualPOsForItem.push({
            po: poItem.po_number,
            status: getIndividualPOStatus(poItem.po_number),
            amount: amountWithGst,
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
          const itemBillingCategory = billingCategoryMap.get(poItem.item_id) || "";
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
  }, [po_item_data, projectEstimates, getIndividualPOStatus, billingCategoryMap, itemDeliveryMap]);

  // --- Compute PO-wise aggregated items ---
  const poWiseItems = useMemo((): POWiseDisplayItem[] => {
    if (!allMaterialUsageItems || allMaterialUsageItems.length === 0) return [];

    // Group items by PO
    const poGroupMap = new Map<string, {
      vendorName: string;
      categories: Set<string>;
      items: MaterialUsageDisplayItem[];
      totalOrderedQty: number;
      totalDeliveryNoteQty: number;
      totalDCQty: number;
      totalMIRQty: number;
      totalAmount: number;
      poStatus: POStatus;
    }>();

    for (const item of allMaterialUsageItems) {
      if (!item.poNumbers) continue;
      for (const poInfo of item.poNumbers) {
        if (!poGroupMap.has(poInfo.po)) {
          poGroupMap.set(poInfo.po, {
            vendorName: '',
            categories: new Set(),
            items: [],
            totalOrderedQty: 0,
            totalDeliveryNoteQty: 0,
            totalDCQty: 0,
            totalMIRQty: 0,
            totalAmount: 0,
            poStatus: poInfo.status,
          });
        }
        const group = poGroupMap.get(poInfo.po)!;
        group.categories.add(item.categoryName);
        group.items.push(item);
        group.totalOrderedQty += item.orderedQuantity;
        group.totalDeliveryNoteQty += item.deliveredQuantity;
        group.totalDCQty += item.dcQuantity;
        group.totalMIRQty += item.mirQuantity;
        group.totalAmount += poInfo.amount;
      }
    }

    // --- Orphan DC/MIR item detection ---
    // Find items in DC/MIR documents that don't match any PO line item
    const docs = poDeliveryDocsData?.message || [];
    for (const doc of docs) {
      if (doc.is_stub === 1 || !doc.items || doc.items.length === 0) continue;

      const poNumber = doc.procurement_order;
      const isDC = doc.type === "Delivery Challan";

      // Build set of already-matched category_itemId keys for this PO
      const matchedKeys = new Set<string>();
      const existingGroup = poGroupMap.get(poNumber);
      if (existingGroup) {
        for (const item of existingGroup.items) {
          matchedKeys.add(`${item.categoryName}_${item.itemId}`);
        }
      }

      // Track orphans per PO to aggregate across multiple docs
      const orphanMap = new Map<string, MaterialUsageDisplayItem>();

      for (const childItem of doc.items) {
        const childKey = `${childItem.category}_${childItem.item_id}`;
        if (matchedKeys.has(childKey)) continue;

        // This is an orphan item
        const orphanKey = `${poNumber}_orphan_${childItem.category}_${childItem.item_id}`;

        let orphanItem = orphanMap.get(orphanKey);
        if (!orphanItem) {
          // Check if this orphan was already added to the group by a previous doc
          orphanItem = existingGroup?.items.find(i => i.uniqueKey === orphanKey);
        }

        if (!orphanItem) {
          orphanItem = {
            uniqueKey: orphanKey,
            itemId: childItem.item_id,
            itemName: childItem.item_name,
            categoryName: childItem.category || 'Unknown',
            unit: childItem.unit,
            estimatedQuantity: 0,
            orderedQuantity: 0,
            deliveredQuantity: 0,
            dcQuantity: 0,
            mirQuantity: 0,
            totalAmount: 0,
            deliveryStatus: "Not Ordered" as DeliveryStatus,
            overallPOPaymentStatus: "N/A" as OverallItemPOStatus,
            isOrphanDCItem: true,
            deliveryChallans: [],
            dcCount: 0,
            mirs: [],
            mirCount: 0,
          };
          orphanMap.set(orphanKey, orphanItem);
        }

        // Accumulate quantities
        if (isDC) {
          orphanItem.dcQuantity += childItem.quantity || 0;
        } else {
          orphanItem.mirQuantity += childItem.quantity || 0;
        }

        // Build doc info and deduplicate
        const docInfo: DeliveryDocumentInfo = {
          name: doc.name,
          referenceNumber: doc.reference_number || doc.name,
          dcDate: doc.dc_date,
          isSignedByClient: doc.is_signed_by_client === 1,
          attachmentUrl: doc.attachment_url,
          itemCount: doc.items?.length || 0,
          poNumber: doc.procurement_order,
        };

        if (isDC) {
          if (!orphanItem.deliveryChallans!.find(d => d.name === doc.name)) {
            orphanItem.deliveryChallans!.push(docInfo);
            orphanItem.dcCount = orphanItem.deliveryChallans!.length;
          }
        } else {
          if (!orphanItem.mirs!.find(d => d.name === doc.name)) {
            orphanItem.mirs!.push(docInfo);
            orphanItem.mirCount = orphanItem.mirs!.length;
          }
        }
      }

      // Push orphan items into the PO group
      if (orphanMap.size > 0) {
        if (!poGroupMap.has(poNumber)) {
          // Create a new PO group for orphans-only case
          let totalOrphanDC = 0;
          let totalOrphanMIR = 0;
          const orphanItems: MaterialUsageDisplayItem[] = [];
          const orphanCategories = new Set<string>();

          for (const orphan of orphanMap.values()) {
            orphanItems.push(orphan);
            orphanCategories.add(orphan.categoryName);
            totalOrphanDC += orphan.dcQuantity;
            totalOrphanMIR += orphan.mirQuantity;
          }

          poGroupMap.set(poNumber, {
            vendorName: '',
            categories: orphanCategories,
            items: orphanItems,
            totalOrderedQty: 0,
            totalDeliveryNoteQty: 0,
            totalDCQty: totalOrphanDC,
            totalMIRQty: totalOrphanMIR,
            totalAmount: 0,
            poStatus: 'Unpaid' as POStatus,
          });
        } else {
          const group = poGroupMap.get(poNumber)!;
          for (const orphan of orphanMap.values()) {
            // Only push if not already in the group (from a previous doc iteration)
            if (!group.items.find(i => i.uniqueKey === orphan.uniqueKey)) {
              group.items.push(orphan);
              group.categories.add(orphan.categoryName);
            }
            group.totalDCQty += orphan.dcQuantity;
            group.totalMIRQty += orphan.mirQuantity;
          }
        }
      }
    }

    // Get vendor names from po_item_data
    const allPoItems = [
      ...(po_item_data?.message?.po_items || []),
      ...(po_item_data?.message?.custom_items || [])
    ];
    const vendorByPO = new Map<string, string>();
    allPoItems.forEach(item => {
      if (item.po_number && !vendorByPO.has(item.po_number)) {
        vendorByPO.set(item.po_number, item.vendor_name);
      }
    });

    return Array.from(poGroupMap.entries()).map(([poNumber, group]) => {
      const deliveryDocs = poDeliveryMap.get(poNumber);
      const categories = Array.from(group.categories);

      return {
        poNumber,
        vendorName: vendorByPO.get(poNumber) || '',
        category: categories.length === 1 ? categories[0] : `Multiple (${categories.length})`,
        totalOrderedQty: group.totalOrderedQty,
        totalDeliveryNoteQty: group.totalDeliveryNoteQty,
        totalDCQty: group.totalDCQty,
        totalMIRQty: group.totalMIRQty,
        totalAmount: group.totalAmount,
        deliveryStatus: determineDeliveryStatus(group.totalDeliveryNoteQty, group.totalOrderedQty).deliveryStatusText,
        paymentStatus: group.poStatus,
        dcs: deliveryDocs?.dcs || [],
        mirs: deliveryDocs?.mirs || [],
        items: group.items,
      };
    });
  }, [allMaterialUsageItems, po_item_data, poDeliveryMap, poDeliveryDocsData]);

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

  return {
    allMaterialUsageItems,
    poWiseItems,
    poDeliveryMap,
    isLoading: po_item_loading || estimatesLoading || itemsLoading || poDeliveryLoading,
    error: po_item_error || estimatesError || itemsError || poDeliveryError,
    categoryOptions,
    deliveryStatusOptions,
    poStatusOptions,
  };
}