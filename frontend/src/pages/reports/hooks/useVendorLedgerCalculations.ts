// frontend/src/pages/reports/hooks/useVendorLedgerCalculations.ts
import { useFrappeGetDocList,useFrappeGetDoc, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
import { useMemo, useCallback } from 'react';
import memoize from 'lodash/memoize';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { getPOTotal, getSRTotal, getTotalInvoiceAmount } from '@/utils/getAmounts';
import { parseNumber } from '@/utils/parseNumber';
import { isWithinInterval, parseISO, isBefore } from 'date-fns';
import { Vendors } from '@/types/NirmaanStack/Vendors'; 


// Define a type for the parameters for better readability
interface VendorLedgerParams {
    startDate?: Date | null;
    endDate?: Date | null;
}

// 1. Define the structure for the calculated fields (no change)
export interface VendorCalculatedFields {
    totalPO: number; // Will now be total for the period
    totalSR: number; // Will now be total for the period
    totalInvoiced: number; // Will now be total for the period
    totalPaid: number; // Will now be total for the period
    balance: number; // Will be the CUMULATIVE balance up to endDate
}

// 2. The hook's return type (no change)
export interface UseVendorLedgerCalculationsResult {
    getVendorCalculatedFields: (vendorId: string) => VendorCalculatedFields | null;
    isLoadingGlobalDeps: boolean;
    globalDepsError: Error | null;
}

// Helper function to safely check if a date string is within the period
export const isDateInPeriod = (dateStr: string | null | undefined, startDate: Date | null, endDate: Date | null): boolean => {
    if (!dateStr || !startDate || !endDate) return false;
    try {
        const date = parseISO(dateStr);
        return isWithinInterval(date, { start: startDate, end: endDate });
    } catch {
        return false;
    }
};

// Helper function to safely check if a date is before or on the end of the period
export const isDateOnOrAfter = (dateStr: string | null | undefined, compareDate: Date | null): boolean => {
    if (!dateStr || !compareDate) return false;
    try {
        const date = parseISO(dateStr);
        // isBefore includes the time, so we check if it's before the next day, or use <=
        return date >= compareDate;
    } catch {
        return false;
    }
}

export const useVendorLedgerCalculations = (params: VendorLedgerParams = {}): UseVendorLedgerCalculationsResult => {
    const { startDate, endDate } = params;

    // 3. Fetch all underlying data (one-time fetches, no date filters here)
     const { data: vendors, isLoading: isLoadingVendors, error: errorVendors } = useFrappeGetDocList<Vendors>('Vendors', {
        fields: ['name', 'invoice_balance', 'payment_balance'],
        limit: 0
    }, 'all-vendors-with-opening-balances');

    const { data: purchaseOrders, isLoading: isLoadingPOs, error: errorPOs } = useFrappeGetDocList<ProcurementOrder>('Procurement Orders', {
        fields: ['name', 'vendor', 'total_amount', 'invoice_data', 'creation'],
        limit: 0
    }, 'all-pos-for-vendor-ledger');

    const { data: serviceRequests, isLoading: isLoadingSRs, error: errorSRs } = useFrappeGetDocList<ServiceRequests>('Service Requests', {
        fields: ['name', 'vendor', 'gst', 'service_order_list', 'invoice_data', 'creation'],
        limit: 0
    }, 'all-srs-for-vendor-ledger');

    const { data: paymentsData, isLoading: isLoadingPayments, error: errorPayments } = useFrappeGetDocList<ProjectPayments>('Project Payments', {
        fields: ['name', 'vendor', 'amount', 'payment_date', 'creation'],
        filters: [['status', '=', 'Paid']],
        limit: 0
    }, 'all-payments-for-vendor-ledger');
    
   
        // --- 👇 STEP 2: CREATE A MAP FOR VENDORS FOR QUICK LOOKUP ---
    const vendorsMap = useMemo(() =>
        vendors?.reduce((acc, vendor) => {
            acc.set(vendor.name, vendor);
            return acc;
        }, new Map<string, Vendors>()) ?? new Map(),
    [vendors]);

    // 4. Group ALL data by vendor ID. NO DATE FILTERING is done at this stage.
    const posByVendor = useMemo(() =>
        purchaseOrders?.reduce((acc, po) => {
            if (po.vendor) {
                (acc.get(po.vendor) || acc.set(po.vendor, []).get(po.vendor))!.push(po);
            }
            return acc;
        }, new Map<string, ProcurementOrder[]>()) ?? new Map(),
    [purchaseOrders]);

    const srsByVendor = useMemo(() =>
        serviceRequests?.reduce((acc, sr) => {
            if (sr.vendor) {
                (acc.get(sr.vendor) || acc.set(sr.vendor, []).get(sr.vendor))!.push(sr);
            }
            return acc;
        }, new Map<string, ServiceRequests[]>()) ?? new Map(),
    [serviceRequests]);

    // Group the full payment documents, not just the sum.
    const paymentsByVendor = useMemo(() =>
        paymentsData?.reduce((acc, payment) => {
            if (payment.vendor) {
                (acc.get(payment.vendor) || acc.set(payment.vendor, []).get(payment.vendor))!.push(payment);
            }
            return acc;
        }, new Map<string, ProjectPayments[]>()) ?? new Map(),
    [paymentsData]);

    // 5. Create the memoized function that performs the detailed ledger calculation.
    const getVendorCalculatedFields = useCallback(
        memoize((vendorId: string): VendorCalculatedFields | null => {
            const isLoading = isLoadingVendors || isLoadingPOs || isLoadingSRs || isLoadingPayments;
            if (isLoading) {
                return null; // Data not ready
            }

            const relatedPOs = posByVendor.get(vendorId) || [];
            const relatedSRs = srsByVendor.get(vendorId) || [];
            const relatedPayments = paymentsByVendor.get(vendorId) || [];

            const vendorDoc = vendorsMap.get(vendorId);

            // --- PERIOD-SPECIFIC CALCULATIONS ---
            // These sum up values for transactions created/paid WITHIN the date range.
//------------------ Date Filter Start -----------------
            const totalPO = relatedPOs.reduce((sum, po) => {
                if (isDateInPeriod(po.creation, startDate, endDate)) {
                    return sum + parseNumber(po.total_amount);
                }
                return sum;
            }, 0);

            const totalSR = relatedSRs.reduce((sum, sr) => {
                if (isDateInPeriod(sr.creation, startDate, endDate)) {
                    const amount = getSRTotal(sr) || 0;
                    return sum + (sr?.gst === "true" ? amount * 1.18 : amount);
                }
                return sum;
            }, 0);

            const totalInvoiced = [...relatedPOs, ...relatedSRs].reduce((sum, doc) => {
                const invoiceData = doc.invoice_data?.data;
                if (!invoiceData) return sum;
                
                let invoiceSum = 0;
                for (const dateStr in invoiceData) {
                    if (isDateInPeriod(dateStr, startDate, endDate)) {
                        invoiceSum += parseNumber(invoiceData[dateStr].amount);
                    }
                }
                return sum + invoiceSum;
            }, 0);
            
            const totalPaid = relatedPayments.reduce((sum, p) => {
                if (isDateInPeriod(p.payment_date || p.creation, startDate, endDate)) {
                    console.log("DEBUG: p.amount", p.amount, "vendor", vendorId, "sum", sum)
                    return sum + parseNumber(p.amount);
                }
                return sum;
            }, 0);

            //------------------ Date Filter Start END-----------------

             const openingInvoiceBalance = parseNumber(vendorDoc?.invoice_balance);
            const openingPaymentBalance = parseNumber(vendorDoc?.payment_balance);
            const openingBalance = openingInvoiceBalance - openingPaymentBalance;



            // --- CUMULATIVE BALANCE CALCULATION ---
            // This sums up ALL historical transactions up to the endDate to get the true running balance.

            const cumulativeInvoiced = [...relatedPOs, ...relatedSRs].reduce((sum, doc) => {
                const invoiceData = doc.invoice_data?.data;
                // console.log("DEBUG: invoiceData", invoiceData)
                if (!invoiceData) return sum;
                
                let invoiceSum = 0;
                for (const dateStr in invoiceData) {
                    if (isDateOnOrAfter(dateStr, new Date("2025-04-01"))) {
                        invoiceSum += parseNumber(invoiceData[dateStr].amount);
                        // console.log("DEBUG: invoiceSum", invoiceSum)
                    }
                }
                // console.log("DEBUG: sum", sum+invoiceSum, "vendor", vendorId)
                return sum + invoiceSum;
            }, 0);

            const cumulativePaid = relatedPayments.reduce((sum, p) => {
                if (isDateOnOrAfter(p.payment_date || p.creation, new Date("2025-04-01"))) {
                    return sum + parseNumber(p.amount);
                }
                return sum;
            }, 0);
            
            
            // const balance = cumulativeInvoiced - cumulativePaid;
            // console.log("DEBUG: cumulativeInvoiced", cumulativeInvoiced, "cumulativePaid", cumulativePaid, "vendor", vendorId, "openingBalance", openingBalance)
            const balance = openingBalance + (cumulativeInvoiced - cumulativePaid);

            return { totalPO, totalSR, totalInvoiced, totalPaid, balance };
        }),
        // Dependencies now include the dates, so this function is re-created when they change.
        [posByVendor, srsByVendor, paymentsByVendor, isLoadingPOs, isLoadingSRs, isLoadingPayments, startDate, endDate]
    );

    const isLoadingGlobalDeps = isLoadingVendors || isLoadingPOs || isLoadingSRs || isLoadingPayments;
    const globalDepsError = errorVendors || errorPOs || errorSRs || errorPayments;

    return {
        getVendorCalculatedFields,
        isLoadingGlobalDeps,
        globalDepsError: globalDepsError instanceof Error ? globalDepsError : null,
    };
};

// // frontend/src/pages/reports/hooks/useVendorLedgerCalculations.ts
// import { useFrappeGetDocList, FrappeDoc, GetDocListArgs } from 'frappe-react-sdk';
// import { useMemo, useCallback } from 'react';
// import memoize from 'lodash/memoize';
// import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
// import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
// import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
// import { getPOTotal, getSRTotal, getTotalInvoiceAmount } from '@/utils/getAmounts';
// import { parseNumber } from '@/utils/parseNumber';
// import { queryKeys } from '@/config/queryKeys';
// import { isWithinInterval, parseISO } from 'date-fns'; // 👈 Import date-fns helpers

// // Define a type for the parameters for better readability
// interface VendorLedgerParams {
//     startDate?: Date | null;
//     endDate?: Date | null;
// }

// // 1. Define the structure for the calculated fields (no change)
// export interface VendorCalculatedFields {
//     totalPO: number;
//     totalSR: number;
//     totalInvoiced: number;
//     totalPaid: number;
//     balance: number;
// }

// // 2. The hook's return type (no change)
// export interface UseVendorLedgerCalculationsResult {
//     getVendorCalculatedFields: (vendorId: string) => VendorCalculatedFields | null;
//     isLoadingGlobalDeps: boolean;
//     globalDepsError: Error | null;
// }

// // 👇 UPDATE hook signature
// export const useVendorLedgerCalculations = (params: VendorLedgerParams = {}): UseVendorLedgerCalculationsResult => {
//     const { startDate, endDate } = params; // Destructure the dates

//     // 3. Fetch all underlying data (one-time fetches)
//     const { data: purchaseOrders, isLoading: isLoadingPOs, error: errorPOs } = useFrappeGetDocList<ProcurementOrder>('Procurement Orders', {
//         fields: ['name', 'vendor', 'total_amount', 'invoice_data', 'creation'], // Added 'creation'
//         limit: 0
//     }, 'all-pos-for-vendor-ledger');

//     const { data: serviceRequests, isLoading: isLoadingSRs, error: errorSRs } = useFrappeGetDocList<ServiceRequests>('Service Requests', {
//         fields: ['name', 'vendor', 'gst', 'service_order_list', 'invoice_data', 'creation'], // Added 'creation'
//         limit: 0
//     }, 'all-srs-for-vendor-ledger');

//     const { data: paymentsData, isLoading: isLoadingPayments, error: errorPayments } = useFrappeGetDocList<ProjectPayments>('Project Payments', {
//         fields: ['name', 'vendor', 'amount', 'payment_date', 'creation'], // Added 'payment_date' and 'creation'
//         filters: [['status', '=', 'Paid']],
//         limit: 0
//     }, 'all-payments-for-vendor-ledger');

//     // 👇 4. Pre-process and group data, APPLYING THE DATE FILTER
//     const posByVendor = useMemo(() => {
//         const filteredPOs = purchaseOrders?.filter(po => {
//             if (!startDate && !endDate) return true; // No filter applied
//             try {
//                 const poDate = parseISO(po.creation);
//                 return isWithinInterval(poDate, { start: startDate || new Date(0), end: endDate || new Date() });
//             } catch { return false; }
//         }) || [];

//         return filteredPOs.reduce((acc, po) => {
//             if (po.vendor) {
//                 (acc.get(po.vendor) || acc.set(po.vendor, []).get(po.vendor))!.push(po);
//             }
//             return acc;
//         }, new Map<string, ProcurementOrder[]>());
//     }, [purchaseOrders, startDate, endDate]); // 👈 Add dates to dependency array

//     const srsByVendor = useMemo(() => {
//         const filteredSRs = serviceRequests?.filter(sr => {
//             if (!startDate && !endDate) return true;
//             try {
//                 const srDate = parseISO(sr.creation);
//                 return isWithinInterval(srDate, { start: startDate || new Date(0), end: endDate || new Date() });
//             } catch { return false; }
//         }) || [];

//         return filteredSRs.reduce((acc, sr) => {
//             if (sr.vendor) {
//                 (acc.get(sr.vendor) || acc.set(sr.vendor, []).get(sr.vendor))!.push(sr);
//             }
//             return acc;
//         }, new Map<string, ServiceRequests[]>());
//     }, [serviceRequests, startDate, endDate]); // 👈 Add dates to dependency array

//     const paymentsByVendor = useMemo(() => {
//         const filteredPayments = paymentsData?.filter(p => {
//             if (!startDate && !endDate) return true;
//             try {
//                 // Project Payments have a 'payment_date' which is more relevant
//                 const paymentDate = parseISO(p.payment_date || p.creation);
//                 return isWithinInterval(paymentDate, { start: startDate || new Date(0), end: endDate || new Date() });
//             } catch { return false; }
//         }) || [];

//         return filteredPayments.reduce((acc, payment) => {
//             if (payment.vendor) {
//                 acc.set(payment.vendor, (acc.get(payment.vendor) || 0) + parseNumber(payment.amount));
//             }
//             return acc;
//         }, new Map<string, number>());
//     }, [paymentsData, startDate, endDate]); // 👈 Add dates to dependency array


//     // 5. Create the memoized function that performs the calculation for a single vendor
//     const getVendorCalculatedFields = useCallback(
//         memoize((vendorId: string): VendorCalculatedFields | null => {
//             const isLoading = isLoadingPOs || isLoadingSRs || isLoadingPayments;
//             if (isLoading) {
//                 return null; // Data not ready
//             }

//             const relatedPOs = posByVendor.get(vendorId) || [];
//             const relatedSRs = srsByVendor.get(vendorId) || [];

           
// console.log("DEBUG: totalSR",totalSR)
//             const totalInvoicedFromPOs = relatedPOs.reduce((sum, po) => sum + getTotalInvoiceAmount(po.invoice_data), 0);
//             const totalInvoicedFromSRs = relatedSRs.reduce((sum, sr) => sum + getTotalInvoiceAmount(sr.invoice_data), 0);
//             const totalInvoiced = totalInvoicedFromPOs + totalInvoicedFromSRs;

//              const totalPO = relatedPOs.reduce((sum, po) => sum + parseNumber(po.total_amount), 0);

//             const totalSR = relatedSRs.reduce((sum, sr) => {
//                 const amount = getSRTotal(sr) || 0;
//                 return sum + (sr?.gst === "true" ? amount * 1.18 : amount);
//             }, 0);

//             const totalPaid = paymentsByVendor.get(vendorId) || 0;
//             const balance = totalInvoiced - totalPaid;

//             return { totalPO, totalSR, totalInvoiced, totalPaid, balance };
//         }),
//         // Dependencies are now the re-calculated maps
//         [posByVendor, srsByVendor, paymentsByVendor, isLoadingPOs, isLoadingSRs, isLoadingPayments]
//     );

//     const isLoadingGlobalDeps = isLoadingPOs || isLoadingSRs || isLoadingPayments;
//     const globalDepsError = errorPOs || errorSRs || errorPayments;

//     return {
//         getVendorCalculatedFields,
//         isLoadingGlobalDeps,
//         globalDepsError: globalDepsError instanceof Error ? globalDepsError : null,
//     };
// };