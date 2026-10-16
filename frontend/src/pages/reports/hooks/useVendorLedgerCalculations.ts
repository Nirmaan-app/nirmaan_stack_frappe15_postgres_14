// frontend/src/pages/reports/hooks/useVendorLedgerCalculations.ts
import { useFrappeGetCall, useFrappeGetDocList } from 'frappe-react-sdk';
import { useMemo, useCallback } from 'react';
import { ProcurementOrder } from '@/types/NirmaanStack/ProcurementOrders';
import { ServiceRequests } from '@/types/NirmaanStack/ServiceRequests';
import { VendorInvoice } from '@/types/NirmaanStack/VendorInvoice';
import { parseNumber } from '@/utils/parseNumber';
import { isWithinInterval, parseISO, endOfDay, format } from 'date-fns';
import { Vendors } from '@/types/NirmaanStack/Vendors';
import { LEDGER_START } from '@/pages/vendors/utils/vendorLedgerStatement';
import { vendorPaidFigures } from '../utils/vendorReportPaid';


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
    totalPaid: number; // All time: the orders' Amount Paid; in a period: paid less refunds dated in it
    currentFYPaid: number; // Paid less refunds dated in the current financial year, whatever the period
    balance: number; // The vendor's Ledger tab closing balance
}

// The Indian financial year (1 Apr - 31 Mar) that `today` falls in, e.g. "FY 26-27".
export const getCurrentFinancialYear = (today: Date = new Date()) => {
    const startYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    return {
        start: new Date(startYear, 3, 1),
        end: endOfDay(new Date(startYear + 1, 2, 31)),
        label: `FY ${String(startYear % 100).padStart(2, "0")}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    };
};

// 2. The hook's return type (no change)
export interface UseVendorLedgerCalculationsResult {
    vendors: Vendors[] | undefined; // Every vendor, for building the report rows
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

const GET_VENDORS_PAID = 'nirmaan_stack.api.vendor.vendor_paid.get_vendors_paid';
const NO_PAID: Record<string, number> = {};
const day = (date: Date) => format(date, 'yyyy-MM-dd');

// `{vendor: paid}` for a date range from the server: Paid payments less Received refunds, each on its
// own date (ADR-0034). `swrKey` null skips the call.
const useVendorsPaid = (fromDate: string | null, toDate: string | null, swrKey: string | null) => {
    const { data, isLoading, error } = useFrappeGetCall<{ message: Record<string, number> }>(
        GET_VENDORS_PAID,
        { ...(fromDate && { from_date: fromDate }), ...(toDate && { to_date: toDate }) },
        swrKey
    );
    return { paid: data?.message, isLoading, error };
};


export const useVendorLedgerCalculations = (params: VendorLedgerParams = {}): UseVendorLedgerCalculationsResult => {
    const { startDate, endDate } = params;

    // 3. Fetch all underlying data (one-time fetches, no date filters here)
     const { data: vendors, isLoading: isLoadingVendors, error: errorVendors } = useFrappeGetDocList<Vendors>('Vendors', {
        fields: ['name', 'vendor_name', 'vendor_type', 'invoice_balance', 'payment_balance'],
        limit: 0
    }, 'all-vendors-with-opening-balances');

    const { data: purchaseOrders, isLoading: isLoadingPOs, error: errorPOs } = useFrappeGetDocList<ProcurementOrder>('Procurement Orders', {
        fields: ['name', 'vendor', 'total_amount', 'amount_paid', 'creation'],
        limit: 0
    }, 'all-pos-for-vendor-ledger');

    const { data: serviceRequests, isLoading: isLoadingSRs, error: errorSRs } = useFrappeGetDocList<ServiceRequests>('Service Requests', {
        // total_amount is fresh on every save (incl. GST when sr.gst === "true").
        fields: ['name', 'vendor', 'gst', 'total_amount', 'amount_paid', 'creation'],
        limit: 0
    }, 'all-srs-for-vendor-ledger');

    // Fetch Vendor Invoices for ledger calculations
    const { data: vendorInvoices, isLoading: isLoadingInvoices, error: errorInvoices } = useFrappeGetDocList<VendorInvoice>('Vendor Invoices', {
        fields: ['name', 'vendor', 'invoice_amount', 'invoice_date'],
        filters: [['status', '=', 'Approved']],
        limit: 0
    }, 'all-invoices-for-vendor-ledger');

    // --- KEY CHANGE: Calculate flag once in the hook scope ---
    const shouldFilterByPeriod = useMemo(() => startDate && endDate, [startDate, endDate]);
    // ---------------------------------------------------

    const currentFY = useMemo(() => getCurrentFinancialYear(), []);

    // Dated paid figures: the server applies the Amount Paid rule to dated rows (a refund on its own date).
    const periodFrom = startDate && endDate ? day(startDate) : null;
    const periodTo = startDate && endDate ? day(endDate) : null;
    const period = useVendorsPaid(periodFrom, periodTo, periodFrom ? `vendors-paid-${periodFrom}-${periodTo}` : null);
    const fyFrom = day(currentFY.start);
    const fyTo = day(currentFY.end);
    const fy = useVendorsPaid(fyFrom, fyTo, `vendors-paid-${fyFrom}-${fyTo}`);
    const sinceLedgerStart = useVendorsPaid(LEDGER_START, null, `vendors-paid-${LEDGER_START}-`);

    // Group Vendor Invoices by vendor
    const invoicesByVendor = useMemo(() =>
        vendorInvoices?.reduce((acc, invoice) => {
            if (invoice.vendor) {
                (acc.get(invoice.vendor) || acc.set(invoice.vendor, []).get(invoice.vendor))!.push(invoice);
            }
            return acc;
        }, new Map<string, VendorInvoice[]>()) ?? new Map(),
    [vendorInvoices]);

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

    const isLoadingPaid = period.isLoading || fy.isLoading || sinceLedgerStart.isLoading;
    const isLoadingGlobalDeps = isLoadingVendors || isLoadingPOs || isLoadingSRs || isLoadingInvoices || isLoadingPaid;

    // 5. Create the memoized function that performs the detailed ledger calculation.
    const getVendorCalculatedFields = useCallback(
        (vendorId: string): VendorCalculatedFields | null => {
            if (isLoadingGlobalDeps) {
                return null; // Data not ready
            }

            const relatedPOs = posByVendor.get(vendorId) || [];
            const relatedSRs = srsByVendor.get(vendorId) || [];

            const vendorDoc = vendorsMap.get(vendorId);

            // --- PERIOD-SPECIFIC CALCULATIONS ---
            // These sum up values for transactions created/paid WITHIN the date range.
            //------------------ Date Filter Start -----------------
           // totalPO: Filtered by PO Creation Date
            const totalPO = relatedPOs.reduce((sum, po) => {
                const shouldInclude = !shouldFilterByPeriod || isDateInPeriod(po.creation, startDate, endDate);
                return shouldInclude ? sum + parseNumber(po.total_amount) : sum;
            }, 0);

            // totalSR: Filtered by SR Creation Date. total_amount on parent
            // already includes GST when sr.gst === "true".
            const totalSR = relatedSRs.reduce((sum, sr) => {
                const shouldInclude = !shouldFilterByPeriod || isDateInPeriod(sr.creation, startDate, endDate);
                return shouldInclude ? sum + parseNumber(sr.total_amount) : sum;
            }, 0);

            // totalInvoiced: Filtered by INVOICE DATE within the range - using Vendor Invoices
            const relatedInvoices = invoicesByVendor.get(vendorId) || [];
            const totalInvoiced = relatedInvoices.reduce((sum, invoice) => {
                const shouldInclude = !shouldFilterByPeriod || isDateInPeriod(invoice.invoice_date, startDate || null, endDate || null);
                return shouldInclude ? sum + parseNumber(invoice.invoice_amount) : sum;
            }, 0);

            // Invoices since the ledger start (the opening balance holds everything before it).
            const cumulativeInvoiced = relatedInvoices.reduce((sum, invoice) => {
                if (isDateOnOrAfter(invoice.invoice_date, new Date(LEDGER_START))) {
                    return sum + parseNumber(invoice.invoice_amount);
                }
                return sum;
            }, 0);

            // Total Paid, Current FY Paid and Balance Payable: the orders' Amount Paid, or the server's
            // dated figures (ADR-0034). Opening balance: the Vendors balancing fields, as on 31 Mar 2025.
            const { totalPaid, currentFYPaid, balance } = vendorPaidFigures(
                vendorId,
                [...relatedPOs, ...relatedSRs],
                {
                    periodPaid: shouldFilterByPeriod ? period.paid ?? NO_PAID : null,
                    currentFYPaid: fy.paid ?? NO_PAID,
                    paidSinceLedgerStart: sinceLedgerStart.paid ?? NO_PAID,
                },
                {
                    invoice: parseNumber(vendorDoc?.invoice_balance),
                    payment: parseNumber(vendorDoc?.payment_balance),
                },
                cumulativeInvoiced
            );

            return { totalPO, totalSR, totalInvoiced, totalPaid, currentFYPaid, balance };
        },
        // Dependencies now include the dates, so this function is re-created when they change.
        [posByVendor, srsByVendor, invoicesByVendor, vendorsMap, isLoadingGlobalDeps, startDate, endDate, shouldFilterByPeriod, period.paid, fy.paid, sinceLedgerStart.paid]
    );

    const globalDepsError = errorVendors || errorPOs || errorSRs || errorInvoices || period.error || fy.error || sinceLedgerStart.error;

    return {
        vendors,
        getVendorCalculatedFields,
        isLoadingGlobalDeps,
        globalDepsError: globalDepsError instanceof Error ? globalDepsError : null,
    };
};
