// frontend/src/pages/reports/components/VendorReports.tsx

import { useMemo, useState, useEffect,useCallback } from "react";
import { DateRange } from "react-day-picker";
import { DataTable } from "@/components/data-table/new-data-table";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { useVendorLedgerCalculations } from "../hooks/useVendorLedgerCalculations";
import { getVendorColumns } from "./columns/vendorColumns";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { SearchFieldOption } from '@/components/data-table/new-data-table';
import { StandaloneDateFilter } from "@/components/ui/StandaloneDateFilter";
import { urlStateManager } from "@/utils/urlStateManager";
import { parse, formatISO, startOfDay, format } from 'date-fns'; 
import { toast } from "@/components/ui/use-toast"; // 👈 Import toast for feedback
import { exportToCsv } from "@/utils/exportToCsv"; // 👈 Import the CSV utility
import { ColumnDef } from "@tanstack/react-table"; // 
import { formatForReport } from "@/utils/FormatPrice"

// Configuration for this specific table
const VENDOR_REPORTS_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "vendor_name", label: "Vendor Name", placeholder: "Search by Name...", default: true },
    { value: "name", label: "Vendor ID", placeholder: "Search by ID..." },
    { value: "vendor_type", label: "Type", placeholder: "Search by Type..." },
];

const URL_SYNC_KEY = "vendor_ledger_report"; // Use a specific key for URL state
const getDefaultDateRange = (): DateRange => ({
    from: new Date('2025-04-01'),
    to: startOfDay(new Date()),
});


export default function VendorReports() {
    // 1. Manage date range state, initialized from URL or with a default
    const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
        const fromParam = urlStateManager.getParam(`${URL_SYNC_KEY}_from`);
        const toParam = urlStateManager.getParam(`${URL_SYNC_KEY}_to`);
        if (fromParam && toParam) {
            try {
                return {
                    from: parse(fromParam, 'yyyy-MM-dd', new Date()),
                    to: parse(toParam, 'yyyy-MM-dd', new Date()),
                };
            } catch (e) {
                console.error("Error parsing date from URL:", e);
                // Fall through to default if parsing fails
            }
        }
        // Default date range: April 1, 2025 to today
        return getDefaultDateRange()
    });

    // 2. Pass the date range state into the calculation hook.
    const {
        getVendorCalculatedFields,
        isLoadingGlobalDeps,
        globalDepsError,
    } = useVendorLedgerCalculations({
        startDate: dateRange?.from,
        endDate: dateRange?.to
    });

    // 3. Effect to sync state changes back to the URL
    useEffect(() => {
        const fromISO = dateRange?.from ? formatISO(dateRange.from, { representation: 'date' }) : null;
        const toISO = dateRange?.to ? formatISO(dateRange.to, { representation: 'date' }) : null;

        urlStateManager.updateParam(`${URL_SYNC_KEY}_from`, fromISO);
        urlStateManager.updateParam(`${URL_SYNC_KEY}_to`, toISO);
    }, [dateRange]);


    const tableColumns = useMemo(() => getVendorColumns(), []);

    const {
        table,
        data: vendorsData,
        isLoading: isVendorsLoading,
        error: vendorsError,
        totalCount,
        searchTerm, setSearchTerm,
        selectedSearchField, setSelectedSearchField,
    } = useServerDataTable<Vendors>({
        doctype: "Vendors",
        columns: tableColumns,
        fetchFields: ['name', 'vendor_name', 'vendor_type', 'creation'],
        searchableFields: VENDOR_REPORTS_SEARCHABLE_FIELDS,
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'vendor_name asc',
        meta: { getVendorCalculatedFields, isLoadingGlobalDeps }
    });

    const isLoading = isLoadingGlobalDeps || isVendorsLoading;
    const error = globalDepsError || vendorsError;
        // --- 👇 THIS IS THE NEW CUSTOM EXPORT HANDLER ---
    const handleCustomExport = useCallback(() => {
        if (isLoadingGlobalDeps) {
            toast({ title: "Export Canceled", description: "Please wait for calculations to finish before exporting.", variant: "default" });
            return;
        }
        if (!vendorsData || vendorsData.length === 0) {
            toast({ title: "Export Canceled", description: "No data available to export.", variant: "default" });
            return;
        }

        // 1. Manually construct the data array for the CSV
        const dataToExport = vendorsData.map(vendor => {
            const calculated = getVendorCalculatedFields(vendor.name);
            return {
                vendor_name: vendor.vendor_name || vendor.name,
                vendor_type: vendor.vendor_type || 'N/A',
                total_po: calculated ? formatForReport(calculated.totalPO) : '0',
                total_sr: calculated ? formatForReport(calculated.totalSR) : '0',
                total_invoiced: calculated ? formatForReport(calculated.totalInvoiced) : '0',
                total_paid: calculated ? formatForReport(calculated.totalPaid) : '0',
                balance: calculated ? formatForReport(calculated.balance) : '0',
            };
        });

        // 2. Define the columns for the CSV export
        const exportColumns: ColumnDef<any, any>[] = [
            { header: "Vendor Name", accessorKey: "vendor_name" },
            { header: "Type", accessorKey: "vendor_type" },
            { header: "Total PO Value", accessorKey: "total_po" },
            { header: "Total SR Value", accessorKey: "total_sr" },
            { header: "Total Invoiced", accessorKey: "total_invoiced" },
            { header: "Total Paid", accessorKey: "total_paid" },
            { header: "Balance Payable", accessorKey: "balance" },
        ];

         // --- 👇 THIS IS THE FIX ---
        // 1. Define a base name for the report.
        const baseName = 'Vendor_Ledger_Report';
        let exportFileName = `${baseName}.csv`; // Default filename

        // 2. Check if a date range exists and format it into a string.
        if (dateRange?.from && dateRange?.to) {
            const fromStr = format(dateRange.from, 'ddMMMyyyy');
            const toStr = format(dateRange.to, 'ddMMMyyyy');
            exportFileName = `${baseName}_${fromStr}_to_${toStr}.csv`;
        }
        // --- END OF FIX ---
        // 3. Call the exporter utility
        try {
              exportToCsv(exportFileName, dataToExport, exportColumns);
            toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success" });
        } catch (e) {
            console.error("Export failed:", e);
            toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive" });
        }
    }, [vendorsData, getVendorCalculatedFields, isLoadingGlobalDeps]);
    

    console.log("dateRange", dateRange)

     const handleClearDateFilter = useCallback(() => {
        setDateRange(getDefaultDateRange());
    }, []);

    if (error) {
        return <AlertDestructive error={error as Error} />;
    }
    
    return (
        <div className={`flex flex-col gap-2 ${totalCount > 0 ? 'h-[calc(100vh-130px)] overflow-hidden' : ''}`}>
            {/* 4. The external controls section */}
            <div className="flex items-center gap-4">
                <StandaloneDateFilter value={dateRange} onChange={setDateRange} onClear={handleClearDateFilter} />
                {/* You can add more global controls here later */}
            </div>

            { (isLoading && !vendorsData?.length) ? (
                 <LoadingFallback />
            ) : (
                <DataTable<Vendors>
                    table={table}
                    columns={tableColumns}
                    isLoading={isLoading}
                    error={error as Error | null}
                    totalCount={totalCount}
                    searchFieldOptions={VENDOR_REPORTS_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    showExportButton={true}
                    onExport={handleCustomExport} // 👈 Use the custom handler instead of 'default'
                    exportFileName={'Vendor_Ledger_Report'}
                    showRowSelection={false}
                />
            )}
        </div>
    );
}