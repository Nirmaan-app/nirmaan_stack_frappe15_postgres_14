// // src/pages/vendors/components/POVendorLedger.tsx

// src/pages/vendors/components/POVendorLedger.tsx

import React, { useMemo, useState } from 'react';
import { useFrappeGetCall } from 'frappe-react-sdk';
import {
    ColumnDef,
    useReactTable,
    getCoreRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFilteredRowModel, // <-- This is essential for filtering to work
} from '@tanstack/react-table';
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { formatDate } from '@/utils/FormatDate';
import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { Radio } from 'antd';
// Assuming you have these filter functions available
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

// ... (Interfaces remain the same) ...
interface Invoice { date: string; invoice_no: string; project_name?: string; amount: number; status: string; }
interface EnrichedPO {
    name: string;
    creation: string;
    total_amount: number;
    project_name?: string;
    vendor_name?: string;
    project_payments: ProjectPayments[];
    invoices: Invoice[];
}
interface LedgerEntry {
    date: string;
    transactionType: 'PO Created' | 'Invoice Recorded' | 'Payment Made';
    project: string;
    details: string;
    amount: number;
    payment: number;
    balance: number;
}


export const POVendorLedger: React.FC<{ vendorId: string }> = ({ vendorId }) => {
    const [activeSubTab, setActiveSubTab] = useState('poLedger');

    const { data: apiResponse, isLoading, error } = useFrappeGetCall<{ message: EnrichedPO[] }>(
        'nirmaan_stack.api.vendor.get_vendor_po_invoices.get_po_ledger_data',
        { vendor_id: vendorId },
        `po_ledger_data_for_vendor_${vendorId}`
    );

    const poDataFromApi = apiResponse?.message;

    const projectFacetOptions = useMemo(() => {
        if (!poDataFromApi) return [];
        const projectNames = new Set<string>();
        poDataFromApi.forEach((po) => {
            if (po.project_name) projectNames.add(po.project_name);
        });
        return Array.from(projectNames).map((name) => ({ label: name, value: name }));
    }, [poDataFromApi]);

    const facetFilterOptions = useMemo(() => ({
        project: { title: "Project", options: projectFacetOptions },
    }), [projectFacetOptions]);

    const dateFilterColumns = useMemo(() => ["date"], []);

    // ... (Data processing logic is correct and remains the same) ...
    const poLedgerFlattenedData = useMemo<LedgerEntry[]>(() => {
        if (!poDataFromApi) return [];
        const allEntries: Omit<LedgerEntry, 'balance'>[] = [];
        poDataFromApi.forEach(po => {
            allEntries.push({ date: po.creation, transactionType: 'PO Created', project: po.project_name || 'N/A', details: `PO: ${po.name || 'N/A'}`, amount: po.total_amount, payment: 0 });
            po.project_payments.forEach(payment => {
                allEntries.push({ date: payment.creation, transactionType: 'Payment Made', project: po.project_name || 'N/A', details: `UTR: ${payment.utr || 'N/A'}\nFor PO: ${po.name}`, amount: 0, payment: payment.amount });
            });
        });
        allEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        let runningBalance = 0;
        return allEntries.map(entry => {
            runningBalance += entry.amount - entry.payment;
            return { ...entry, balance: runningBalance };
        });
    }, [poDataFromApi]);
    
    const invoiceLedgerFlattenedData = useMemo<LedgerEntry[]>(() => {
        if (!poDataFromApi) return [];
        const allEntries: Omit<LedgerEntry, 'balance'>[] = [];
        poDataFromApi.forEach(po => {
            po.invoices.forEach(invoice => {
                allEntries.push({ date: invoice.date, transactionType: 'Invoice Recorded', project: po.project_name || 'N/A', details: `Invoice No: ${invoice.invoice_no}\nStatus: ${invoice.status}`, amount: invoice.amount, payment: 0 });
            });
            po.project_payments.forEach(payment => {
                allEntries.push({ date: payment.creation, transactionType: 'Payment Made', project: po.project_name || 'N/A', details: `UTR: ${payment.utr || 'N/A'}\nFor Invoice against PO: ${po.name}`, amount: 0, payment: payment.amount });
            });
        });
        allEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        let runningBalance = 0;
        return allEntries.map(entry => {
            runningBalance += entry.amount - entry.payment;
            return { ...entry, balance: runningBalance };
        });
    }, [poDataFromApi]);
    
    // --- FIX: Correctly defined column headers and filter functions ---
    const ledgerColumns = useMemo<ColumnDef<LedgerEntry>[]>(() => [
        { 
            accessorKey: 'date', 
            header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />, 
            cell: ({ row }) => <div>{formatDate(row.getValue('date'))}</div>,
             enableColumnFilter: true,
            filterFn: dateFilterFn, 

        },
        { 
            accessorKey: 'transactionType', 
            header: 'Transactions', 
            enableColumnFilter: false,
        },
        { 
            accessorKey: 'project', 
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />, // Use the header component
            filterFn: facetedFilterFn, // Corrected typo from filterfn
        },
        { 
            accessorKey: 'details', 
            header: 'Details', 
            enableColumnFilter: false,
        },
        { 
            accessorKey: 'amount', 
            header: 'Amount', 
            cell: ({ row }) => <div className="text-center pr-2 font-medium">{row.original.amount > 0 ? formatToRoundedIndianRupee(row.original.amount / 100) : null}</div>,
            enableColumnFilter: false,
        },
        { 
            accessorKey: 'payment', 
            header: 'Payments', 
            cell: ({ row }) => <div className="text-center pr-2">{row.original.payment > 0 ? formatToRoundedIndianRupee(row.original.payment / 100) : null}</div>,
            enableColumnFilter: false,
        },
        { 
            accessorKey: 'balance', 
            header: 'Balance', 
            cell: ({ row }) => <div className="text-center pr-2 font-bold">{formatToRoundedIndianRupee(row.getValue('balance') / 100)}</div>,
            enableColumnFilter: false,
        },
    ], []);

    // --- FIX: Use a single, dynamic table instance to manage state correctly ---
    const table = useReactTable({
        data: activeSubTab === 'poLedger' ? poLedgerFlattenedData : invoiceLedgerFlattenedData,
        columns: ledgerColumns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(), // <-- This enables the filtering engine
        initialState: { pagination: { pageSize: 50 } },
    });

    if (error) return <AlertDestructive error={error} />;
    
    return (
        <div className="space-y-2">
            <div className="flex justify-end">
                <Radio.Group value={activeSubTab} onChange={(e) => setActiveSubTab(e.target.value)} optionType="button" buttonStyle="solid">
                    <Radio.Button value="poLedger">PO Ledger</Radio.Button>
                    <Radio.Button value="invoicesLedger">Invoices Ledger</Radio.Button>
                </Radio.Group>
            </div>

            {isLoading && <div>Loading data...</div>}

            {/* --- FIX: Render only ONE DataTable and pass all props to it --- */}
            {!isLoading && (
                <div className="overflow-x-auto">
                    <DataTable
                        table={table}
                        columns={ledgerColumns}
                        // totalCount now correctly reflects the number of rows after filtering
                        totalCount={table.getRowModel().rows.length}
                        showExportButton={true}
                        showSearchBar={false}
                        exportFileName={`${vendorId}_${activeSubTab}`}
                         searchFieldOptions={[]}
            searchTerm=""
            onSearchTermChange={() => {}}
            selectedSearchField=""
            onSelectedSearchFieldChange={() => {}}
                        // These props are now correctly passed to the single DataTable instance
                        facetFilterOptions={facetFilterOptions}
                        dateFilterColumns={dateFilterColumns}
                    />
                </div>
            )}
        </div>
    );
};

export default POVendorLedger;

// import React, { useMemo, useState } from "react";
// import { useFrappeGetCall } from "frappe-react-sdk";
// import {
//   ColumnDef,
//   useReactTable,
//   getCoreRowModel,
//   getPaginationRowModel,
//   getSortedRowModel,
//   getFilteredRowModel,
//   SortingState,
// } from "@tanstack/react-table";
// import { DataTable } from "@/components/data-table/new-data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { formatDate } from "@/utils/FormatDate";
// import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
// import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
// import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
// import { Radio } from "antd";
// import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

// // ... (Interfaces remain the same) ...
// interface Invoice {
//   date: string;
//   invoice_no: string;
//   project: string;
//   amount: number;
//   status: string;
// }
// interface EnrichedPO {
//   name: string;
//   creation: string;
//   total_amount: number;
//   project_name?: string;
//   vendor_name?: string;
//   project_payments: ProjectPayments[];
//   invoices: Invoice[];
// }
// interface LedgerEntry {
//   date: string;
//   transactionType: "PO Created" | "Invoice Recorded" | "Payment Made";
//   project: string;
//   details: string;
//   amount: number;
//   payment: number;
//   balance: number;
// }

// export const POVendorLedger: React.FC<{ vendorId: string }> = ({
//   vendorId,
// }) => {
//   const [activeSubTab, setActiveSubTab] = useState("poLedger");

//   const {
//     data: apiResponse,
//     isLoading,
//     error,
//   } = useFrappeGetCall<{ message: EnrichedPO[] }>(
//     "nirmaan_stack.api.vendor.get_vendor_po_invoices.get_po_ledger_data",
//     { vendor_id: vendorId },
//     `po_ledger_data_for_vendor_${vendorId}`
//   );

//   const poDataFromApi = apiResponse?.message;

//   // --- FIX STARTS HERE: Derive project filter options directly from the API data ---
//   const projectFacetOptions = useMemo(() => {
//     if (!poDataFromApi) {
//       return [];
//     }
//     // Use a Set to get unique project names automatically
//     const projectNames = new Set<string>();
//     poDataFromApi.forEach((po) => {
//       if (po.project_name) {
//         projectNames.add(po.project_name);
//       }
//     });
//     // Convert the Set of unique names into the required options format
//     return Array.from(projectNames).map((name) => ({
//       label: name,
//       value: name,
//     }));
//   }, [poDataFromApi]); // This now depends only on the data we already have
//   // --- FIX ENDS HERE ---

//   const facetFilterOptions = useMemo(
//     () => ({
//       project: { title: "Project", options: projectFacetOptions },
//     }),
//     [projectFacetOptions]
//   );

//   const dateFilterColumns = useMemo(() => ["date"], []);

//   // --- (Data processing logic remains the same) ---
//   const poLedgerFlattenedData = useMemo<LedgerEntry[]>(() => {
//     if (!poDataFromApi) return [];
//     const allEntries: Omit<LedgerEntry, "balance">[] = [];
//     poDataFromApi.forEach((po) => {
//       allEntries.push({
//         date: po.creation,
//         transactionType: "PO Created",
//         project: po.project_name,
//         details: `Project: ${po.project_name || "N/A"}\nPO: ${
//           po.name || "N/A"
//         }`,
//         amount: po.total_amount,
//         payment: 0,
//       });
//       po.project_payments.forEach((payment) => {
//         allEntries.push({
//           date: payment.creation,
//           transactionType: "Payment Made",
//           project: po.project_name,
//           details: `UTR: ${payment.utr || "N/A"}\nFor PO: ${po.name}`,
//           amount: 0,
//           payment: payment.amount,
//         });
//       });
//     });
//     allEntries.sort(
//       (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
//     );
//     let runningBalance = 0;
//     return allEntries.map((entry) => {
//       runningBalance += entry.amount - entry.payment;
//       return { ...entry, balance: runningBalance };
//     });
//   }, [poDataFromApi]);

//   const invoiceLedgerFlattenedData = useMemo<LedgerEntry[]>(() => {
//     if (!poDataFromApi) return [];
//     const allEntries: Omit<LedgerEntry, "balance">[] = [];
//     poDataFromApi.forEach((po) => {
//       po.invoices.forEach((invoice) => {
//         allEntries.push({
//           date: invoice.date,
//           transactionType: "Invoice Recorded",
//           project: po.project_name,
//           details: `Invoice No: ${invoice.invoice_no}\nStatus: ${invoice.status}`,
//           amount: invoice.amount,
//           payment: 0,
//         });
//       });
//       po.project_payments.forEach((payment) => {
//         allEntries.push({
//           date: payment.creation,
//           transactionType: "Payment Made",
//           project: po.project_name,
//           details: `UTR: ${payment.utr || "N/A"}\nFor Invoice against PO: ${
//             po.name
//           }`,
//           amount: 0,
//           payment: payment.amount,
//         });
//       });
//     });
//     allEntries.sort(
//       (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
//     );
//     let runningBalance = 0;
//     return allEntries.map((entry) => {
//       runningBalance += entry.amount - entry.payment;
//       return { ...entry, balance: runningBalance };
//     });
//   }, [poDataFromApi]);
//   const ledgerColumns = useMemo<ColumnDef<LedgerEntry>[]>(
//     () => [
//       {
//         accessorKey: "date",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Date" />
//         ),
//         cell: ({ row }) => <div>{formatDate(row.getValue("date"))}</div>,
//         filterFn: dateFilterFn,
//       },
//       {
//         accessorKey: "transactionType",
//         header: "Transactions",
//         cell: ({ row }) => (
//           <div
//             className={
//               row.original.transactionType !== "Payment Made" ? "font-bold" : ""
//             }
//           >
//             {row.original.transactionType}
//           </div>
//         ),

//          enableColumnFilter: false, 
//       },
//       {
//         accessorKey: "project",
//         header: "Project",
//         cell: ({ row }) => <div>{row.original.project}</div>,
//         filterfn: facetedFilterFn,
//       },
//       {
//         accessorKey: "details",
//         header: "Details",
//         cell: ({ row }) => (
//           <div style={{ whiteSpace: "pre-wrap" }}>
//             {row.getValue("details")}
//           </div>
//         ),
//          enableColumnFilter: false, 
//       },
//       {
//         accessorKey: "amount",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Amount" />
//         ),
//         cell: ({ row }) => (
//           <div className="text-center pr-2 font-medium">
//             {row.original.amount > 0
//               ? formatToRoundedIndianRupee(row.original.amount / 100)
//               : null}
//           </div>
//         ),
//          enableColumnFilter: false, 
//       },
//       {
//         accessorKey: "payment",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Payments" />
//         ),
//         cell: ({ row }) => (
//           <div className="text-center pr-2">
//             {row.original.payment > 0
//               ? formatToRoundedIndianRupee(row.original.payment / 100)
//               : null}
//           </div>
//         ),
//          enableColumnFilter: false, 
//       },
//       {
//         accessorKey: "balance",
//         header: ({ column }) => (
//           <DataTableColumnHeader column={column} title="Balance" />
//         ),
//         cell: ({ row }) => (
//           <div className="text-center pr-2 font-bold">
//             {formatToRoundedIndianRupee(row.getValue("balance") / 100)}
//           </div>
//         ),
//         enableColumnFilter: false, 
//       },
       
//     ],
//     []
//   );

//   const poLedgerTable = useReactTable({
//     data: poLedgerFlattenedData,
//     columns: ledgerColumns,
//     getCoreRowModel: getCoreRowModel(),
//     getPaginationRowModel: getPaginationRowModel(),
//     getFilteredRowModel: getFilteredRowModel(),
//     initialState: { pagination: { pageSize: 50 } },
//   });
//   const invoiceLedgerTable = useReactTable({
//     data: invoiceLedgerFlattenedData,
//     columns: ledgerColumns,
//     getCoreRowModel: getCoreRowModel(),
//     getPaginationRowModel: getPaginationRowModel(),
//     getFilteredRowModel: getFilteredRowModel(),
//     initialState: { pagination: { pageSize: 50 } },
//   });

//   if (error) return <AlertDestructive error={error} />;

//   return (
//     <div className="space-y-2">
//       <div className="flex justify-end">
//         <Radio.Group
//           value={activeSubTab}
//           onChange={(e) => setActiveSubTab(e.target.value)}
//           optionType="button"
//           buttonStyle="solid"
//         >
//           <Radio.Button value="poLedger">PO Ledger</Radio.Button>
//           <Radio.Button value="invoicesLedger">Invoices Ledger</Radio.Button>
//         </Radio.Group>
//       </div>

//       {isLoading && <div>Loading data...</div>}

//       {/* --- FIX: Added a scrolling wrapper div around the DataTable --- */}
//       {!isLoading && activeSubTab === "poLedger" && (
//         <div className="overflow-x-auto">
//           <DataTable
//             table={poLedgerTable}
//             columns={ledgerColumns}
//             totalCount={poLedgerFlattenedData.length}
//             showExportButton={true}
//             showSearchBar={false}
//             exportFileName={`${vendorId}_po_ledger`}
//             searchFieldOptions={[]}
//             searchTerm=""
//             onSearchTermChange={() => {}}
//             selectedSearchField=""
//             onSelectedSearchFieldChange={() => {}}
//             facetFilterOptions={facetFilterOptions}
//             dateFilterColumns={dateFilterColumns}
//           />
//         </div>
//       )}

//       {/* --- FIX: Added a scrolling wrapper div around the DataTable --- */}
//       {!isLoading && activeSubTab === "invoicesLedger" && (
//         <div className="overflow-x-auto">
//           <DataTable
//             table={invoiceLedgerTable}
//             columns={ledgerColumns}
//             totalCount={invoiceLedgerFlattenedData.length}
//             showExportButton={true}
//             showSearchBar={false}
//             exportFileName={`${vendorId}_invoice_ledger`}
//             searchFieldOptions={[]}
//             searchTerm=""
//             onSearchTermChange={() => {}}
//             selectedSearchField=""
//             onSelectedSearchFieldChange={() => {}}
//             facetFilterOptions={facetFilterOptions}
//             dateFilterColumns={dateFilterColumns}
//           />
//         </div>
//       )}
//     </div>
//   );
// };

// export default POVendorLedger;
