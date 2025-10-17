import { useCallback, useMemo } from 'react';
import { useFrappeGetCall, useFrappeGetDocList } from 'frappe-react-sdk';
import { memoize } from 'lodash';
import { ProjectEstimates } from '@/types/NirmaanStack/ProjectEstimates';
import { po_item_data_item } from '../project';
import { parseNumber } from '@/utils/parseNumber';
import { useOrderTotals } from '@/hooks/useOrderTotals';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { DeliveryStatus, MaterialUsageDisplayItem, OverallItemPOStatus, POStatus } from '../components/ProjectMaterialUsageTab';
import { determineDeliveryStatus, determineOverallItemPOStatus } from '../config/materialUsageHelpers';
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
  //

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
  // --- END NEW MAP ---



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
          categoryName: poItem.category,
          itemName: poItem.item_name || estimate?.item_name,
          unit: poItem.unit || estimate?.uom,
          orderedQuantity: safeParseFloat(poItem.quantity),
          deliveredQuantity: safeParseFloat(poItem.received_quantity),
          estimatedQuantity: safeParseFloat(estimate?.quantity_estimate),
          // === ADDED: Initialize total amount ===
          totalAmount: amountWithGst,
          poNumbers: individualPOsForItem,
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
        currentItemUsage.deliveryStatus = deliveryStatusInfo.deliveryStatusText;
        currentItemUsage.overallPOPaymentStatus = poPaymentStatusInfo;
      }
      usageByItemKey.set(itemKey, currentItemUsage);
    });

    const flatList = Array.from(usageByItemKey.values());

    flatList.sort((a, b) => {
      if (a.categoryName.localeCompare(b.categoryName) !== 0) {
        return a.categoryName.localeCompare(b.categoryName);
      }
      return (a.itemName || "").localeCompare(b.itemName || "");
    });

    return flatList;
  }, [po_item_data, projectEstimates, getIndividualPOStatus,billingCategoryMap]);

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
    isLoading: po_item_loading || estimatesLoading,
    error: po_item_error || estimatesError,
    categoryOptions,
    deliveryStatusOptions,
    poStatusOptions,
  };
}