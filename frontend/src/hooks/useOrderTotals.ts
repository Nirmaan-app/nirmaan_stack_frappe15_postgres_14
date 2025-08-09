import { ProcurementOrder } from "@/types/NirmaanStack/ProcurementOrders";
import { ServiceRequests } from "@/types/NirmaanStack/ServiceRequests";
import { getPOTotal, getSRTotal } from "@/utils/getAmounts";
import { parseNumber } from "@/utils/parseNumber";
import { useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { useMemo } from "react";
import { useVendorsList } from "../pages/ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";


export const useOrderTotals = () => {
  const { data: purchaseOrders, isLoading: poLoading, error: poError } = useFrappeGetDocList<ProcurementOrder>(
    'Procurement Orders',
    {
      fields: ['name', "amount","vendor","total_amount", "tax_amount", "po_amount_delivered"],
      filters: [['status', 'not in', ['Cancelled', 'Merged']]],
      limit: 0,
      orderBy: { field: 'modified', order: 'desc' },
    },
    "All_POs_for_order_totals"
  );

  const { data: serviceOrders, isLoading: srLoading, error: srError } = useFrappeGetDocList<ServiceRequests>(
    'Service Requests',
    {
      fields: ['name', 'service_order_list', 'gst',"vendor"],
      // filters: [['status', '=', 'Approved']],
      limit: 0,
      orderBy: { field: 'modified', order: 'desc' },
    },
    "All_SRs_for_order_totals"
  );

    const { data: allVendors, isLoading: vendorsLoading, error: vendorsError } = useVendorsList({
    vendorTypes: ["Material", "Service", "Material & Service"] // <-- THE CHANGE IS HERE
  });

    // console.log("Vendors",allVendors)

  const vendorMap = useMemo(() => {
    if (!allVendors) return {};
    // This creates an object like: { "V-001": "Vendor Name A", "V-002": "Vendor Name B" }
    // for instant O(1) lookups.
    return allVendors.reduce((acc, vendor) => {
      if (vendor.name && vendor.vendor_name) {
        acc[vendor.name] = vendor.vendor_name;
      }
      return acc;
    }, {} as Record<string, string>);
  }, [allVendors]); // This map is only rebuilt if the list of all vendors changes.


    // console.log("vendorMap",vendorMap)


  const getTotalAmount = useMemo(
    () => memoize((orderId: string, type: string) => {
      if (['Procurement Orders', 'Purchase Order'].includes(type)) {
        const order = purchaseOrders?.find(i => i?.name === orderId);
        // --- (FIXED) Directly return the result of the corrected getPOTotal ---
        // The new getPOTotal already returns the object in the desired shape.
        // console.log("getPOTotal", orderId, type, order);
        return getPOTotal(order);
      }
      if (['Service Requests', 'Service Order'].includes(type)) {
        const order = serviceOrders?.find(i => i?.name === orderId);
        const total = getSRTotal(order);
        const totalWithTax = order?.gst === "true" ? total * 1.18 : total;
        return { total, totalWithTax, totalGst: totalWithTax - total };
      }
      return { total: 0, totalWithTax: 0, totalGst: 0 };
    },
      (orderId: string, type: string) => orderId + type), [purchaseOrders, serviceOrders]
  );

  // --- (THE FIX) Create a new memoized getter for the delivered amount ---
  const getDeliveredAmount = useMemo(
    () => memoize((orderId: string, type: string): number => {
      if (['Procurement Orders'].includes(type)) {
        const order = purchaseOrders?.find(i => i?.name === orderId);
        // console.log("getDeliveredAmount", orderId, type, order);
        // Directly return the pre-calculated value from the document
        return order?.po_amount_delivered
      }
      // Return 0 for other doctypes like Service Requests
      return 0;
    },
      (orderId: string, type: string) => `${orderId}-${type}`), // Unique cache key
    [purchaseOrders]
  );

  const getVendorName = useMemo(
    () => memoize((orderId: string, type: string): string => {
        let vendorId: string | undefined;

        // First, find the vendor ID from the correct order list
        if (['Procurement Orders', 'Purchase Order'].includes(type)) {
            const order = purchaseOrders?.find(i => i?.name === orderId);
            vendorId = order?.vendor;
        } else if (['Service Requests', 'Service Order'].includes(type)) {
            const order = serviceOrders?.find(i => i?.name === orderId);
            vendorId = order?.vendor;
        }

        // If no vendor ID was found, return a default value
        if (!vendorId) {
            return 'N/A';
        }

        // Now, use the efficient map to find the name.
        // If the name isn't in the map for some reason, fallback to showing the ID.
        return vendorMap[vendorId] || vendorId;

    },
    // The cache key for lodash-memoize is a combination of orderId and type
    (orderId: string, type: string) => `${orderId}-${type}`),
    // This function will only be recreated if the underlying data changes
    [purchaseOrders, serviceOrders, vendorMap]
  );

   const getEffectiveGST = useMemo(
    () => memoize((orderId: string, type: string): number => {
      // Logic for Procurement Orders
      if (['Procurement Orders', 'Purchase Order'].includes(type)) {
        const order = purchaseOrders?.find(i => i?.name === orderId);
        if (!order) return 0;
        if(orderId=="PO/071/00041/24-25"){
      // console.log("DEBUG EFFECTIVE GST",orderId)

        }
        const taxAmount = parseNumber(order.tax_amount);
        // const totalAmount = parseNumber(order.total_amount);
        const baseAmount = parseNumber(order.amount);

        // Avoid division by zero and return the calculated rate
        if (baseAmount > 0 && taxAmount > 0) {
          // console.log("DEBUG EFFECTIVE GST6",orderId,parseNumber(taxAmount/baseAmount)*100)
          return parseNumber((taxAmount / baseAmount) * 100);
        }
        return 0;
      }

      // Logic for Service Requests (as requested)
      if (['Service Requests', 'Service Order'].includes(type)) {
        const order = serviceOrders?.find(i => i?.name === orderId);
        // If the gst flag is true, we assume a fixed 18% rate. Otherwise, 0.
        if (order?.gst === "true") {
          return 18;
        }
        return 0;
      }

      // Default case: return 0 if order type is not recognized
      return 0;
    },
      // Unique cache key for this function
      (orderId: string, type: string) => `${orderId}-${type}-gst`),
    // Dependencies for this memoized function
    [purchaseOrders, serviceOrders]
  );


  return {
    purchaseOrders,
    poLoading,
    poError,
    serviceOrders,
    srLoading,
    srError,
    getTotalAmount,
    getDeliveredAmount, // --- (THE FIX) Expose the new function ---
    //--For Getting Vendor Name ----
    getVendorName,
    vendorsLoading,
    vendorsError,

    //Effective GST 
    getEffectiveGST
  };
};
