// src/pages/vendors/components/POVendorLedger.tsx

import React, { useMemo, useState, useCallback } from 'react';
import { useFrappeGetCall, useFrappeGetDoc, useFrappeUpdateDoc } from 'frappe-react-sdk';
import Fuse from 'fuse.js';
import { Radio } from 'antd';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FileUp, SearchIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/use-toast';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
import { VirtualizedLedgerTable } from './VirtualizedLedgerTable';
import { exportToCsv } from '@/utils/exportToCsv';
import { formatDate } from '@/utils/FormatDate';
import { LedgerEntry } from './LedgerTableRow';
import { dateFilterFn } from '@/utils/tableFilters';
import { DateFilterValue } from './AdvancedDateFilter';
import { useUserData } from '@/hooks/useUserData';


// Type definition for the data coming from the custom API
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

export const POVendorLedger: React.FC<{ vendorId: string }> = ({ vendorId }) => {
    // UI State
    const [activeSubTab, setActiveSubTab] = useState('poLedger');
    const [searchTerm, setSearchTerm] = useState('');
    const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
    const [dateFilter, setDateFilter] = useState<DateFilterValue | undefined>(undefined);
    const { user_id, role } = useUserData();


 const canExport = useMemo(() => {
        const allowedRoles = ["Nirmaan Accountant Profile", "Nirmaan Admin Profile"];
        // Check if user is Administrator OR if their role is in the allowed list
        return user_id === "Administrator" || allowedRoles.includes(role);
    }, [user_id, role]); // Dependency array now uses your hook's return values

    // --- Data Fetching Hooks ---
    const { data: vendorDoc, isLoading: isVendorLoading, mutate: mutateVendorDoc } = useFrappeGetDoc('Vendors', vendorId);
    const { data: apiResponse, isLoading: isLedgerLoading, error } = useFrappeGetCall<{ message: EnrichedPO[] }>(
        'nirmaan_stack.api.vendor.get_vendor_po_invoices.get_po_ledger_data',
        { vendor_id: vendorId },
        `po_ledger_data_for_vendor_${vendorId}`
    );
    const { updateDoc, loading: isSaving } = useFrappeUpdateDoc();

    const poDataFromApi = apiResponse?.message;
    const openingBalance = vendorDoc?.opening_balance || 0;

    // --- Core Logic ---
    const handleSaveOpeningBalance = (newBalance: number) => {
        updateDoc('Vendors', vendorId, { opening_balance: newBalance })
            .then(() => {
                toast({ title: "Success", description: "Opening balance updated." });
                mutateVendorDoc();
            })
            .catch((err) => {
                toast({ variant: "destructive", title: "Error", description: err.message });
            });
    };

   const calculateLedger = useCallback((
        baseData: EnrichedPO[] | undefined,
        type: 'po' | 'invoice',
        startBalance: number
    ): LedgerEntry[] => {
        if (!baseData) return [];

        const allEntries: Omit<LedgerEntry, 'balance'>[] = [];

        baseData.forEach(po => {
            if (type === 'po') {
                allEntries.push({
                    date: po.creation,
                    transactionType: 'PO Created',
                    project: po.project_name || 'N/A',
                    details: `PO: ${po.name || 'N/A'}`,
                    amount: po.total_amount,
                    payment: 0
                });
            } else {
                po.invoices.forEach(invoice => {
                    // **MODIFIED LOGIC**
                    const isCreditNote = invoice.amount < 0;
                    allEntries.push({
                        date: invoice.date,
                        // If amount is negative, it's a Credit Note
                        transactionType: isCreditNote ? 'Credit Note Recorded' : 'Invoice Recorded',
                        project: po.project_name || 'N/A',
                        // Add PO ID to invoice details
                        details: `Invoice No: ${invoice.invoice_no}\nFor PO: ${po.name}`,
                        amount: invoice.amount, // This will now correctly handle negative amounts
                        payment: 0
                    });
                });
            }

            po.project_payments.forEach(payment => {
                // **MODIFIED LOGIC**
                const isRefund = payment.amount < 0;
                allEntries.push({
                    date: payment.creation,
                    // If payment is negative, it's a Refund
                    transactionType: isRefund ? 'Refund Received' : 'Payment Made',
                    project: po.project_name || 'N/A',
                    details: `UTR: ${payment.utr || 'N/A'}\nFor PO: ${po.name}`,
                    amount: 0,
                    payment: payment.amount
                });
            });
        });

        allEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        let runningBalance = startBalance;
        return allEntries.map(entry => {
            // For credit notes, the negative amount is added to the balance
            runningBalance += entry.amount - entry.payment;
            return { ...entry, balance: runningBalance };
        });
    }, []);
    const poLedgerFlattenedData = useMemo(() => calculateLedger(poDataFromApi, 'po', openingBalance), [poDataFromApi, openingBalance, calculateLedger]);
    const invoiceLedgerFlattenedData = useMemo(() => calculateLedger(poDataFromApi, 'invoice', openingBalance), [poDataFromApi, openingBalance, calculateLedger]);

    const projectFacetOptions = useMemo(() => {
        if (!poDataFromApi) return [];
        const projectNames = new Set<string>();
        poDataFromApi.forEach((po) => { if (po.project_name) projectNames.add(po.project_name); });
        return Array.from(projectNames).map((name) => ({ label: name, value: name }));
    }, [poDataFromApi]);

    const activeData = useMemo(() => {
        return activeSubTab === 'poLedger' ? poLedgerFlattenedData : invoiceLedgerFlattenedData;
    }, [activeSubTab, poLedgerFlattenedData, invoiceLedgerFlattenedData]);

    const processedItems = useMemo(() => {
        let items = activeData;
        
        if (dateFilter?.value) {
            items = items.filter(item => {
                const mockRow = { getValue: (columnId: string) => item[columnId as keyof LedgerEntry] };
                return dateFilterFn(mockRow as any, 'date', dateFilter, () => {});
            });
        }

        if (searchTerm.trim()) {
            const fuse = new Fuse(items, { keys: ['details', 'project', 'transactionType'], threshold: 0.3 });
            items = fuse.search(searchTerm).map(result => result.item);
        }
        
        if (projectFilter.size > 0) {
            items = items.filter(item => projectFilter.has(item.project));
        }
        return items;
    }, [activeData, dateFilter, searchTerm, projectFilter]);

    const totals = useMemo(() => {
        return processedItems.reduce((acc, item) => {
            acc.amount += item.amount;
            acc.payment += item.payment;
            return acc;
        }, { amount: 0, payment: 0 });
    }, [processedItems]);

    const endBalance = processedItems.length > 0 ? processedItems[processedItems.length - 1].balance : openingBalance;

    const handleExportCsv = useCallback(() => {
        const exportColumns = [
            { header: 'Date', accessorKey: 'date' },
            { header: 'Transaction', accessorKey: 'transactionType' },
            { header: 'Project', accessorKey: 'project' },
            { header: 'Details', accessorKey: 'details' },
            { header: 'Amount', accessorKey: 'amount' },
            { header: 'Payment', accessorKey: 'payment' },
            { header: 'Balance', accessorKey: 'balance' },
        ];

        const openingBalanceRow = {
            date: '', transactionType: '', project: '', details: 'Opening Balance',
            amount: '', payment: '', balance: (openingBalance).toFixed(2),
        };
        
        const formattedTransactionData = processedItems.map(item => ({
            date: formatDate(new Date(item.date)),
            transactionType: item.transactionType,
            project: item.project,
            details: item.details.replace(/\n/g, ' | '),
            amount: item.amount > 0 ? (item.amount).toFixed(2) : '',
            payment: item.payment !== 0 ? (item.payment).toFixed(2) : '',
            balance: (item.balance).toFixed(2)
        }));

        const footerRow = {
            date: '', transactionType: '', project: '', details: 'Closing Balance / Totals',
            amount: (totals.amount).toFixed(2),
            payment: (totals.payment).toFixed(2),
            balance: (endBalance).toFixed(2)
        };

        const dataToExport = [ openingBalanceRow, ...formattedTransactionData, footerRow ];

        if (dataToExport.length === 2 && formattedTransactionData.length === 0) {
            toast({ title: "No Transactions", description: "Exporting balances only." });
        }

        // --- THIS IS THE MODIFIED PART ---
        // 1. Get the vendor name from the fetched document. Use the ID as a fallback.
        // Assuming the display field is `vendor_name`. If it's different (e.g., `name1`), change it here.
        const vendorName = vendorDoc?.vendor_name || vendorId;
        
        // 2. Sanitize the name to remove characters that are invalid in filenames.
        const sanitizedVendorName = vendorName.replace(/[/\\?%*:|"<>]/g, '-');

        // 3. Construct the new, more descriptive filename.
        const fileName = `${sanitizedVendorName}_${activeSubTab}_Ledger.csv`;
        
        exportToCsv(fileName, dataToExport, exportColumns);
        toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`});

    // --- Add vendorDoc to the dependency array ---
    }, [processedItems, vendorId, activeSubTab, openingBalance, totals, endBalance, vendorDoc]);

    // --- Render Logic ---
    if (error) return <AlertDestructive error={error} />;
    
    if (isLedgerLoading || isVendorLoading) {
        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
                <Skeleton className="h-9 w-full max-w-md" />
                <div className="flex items-center gap-2"><Skeleton className="h-9 w-24" /><Skeleton className="h-9 w-48" /></div>
            </div>
            <div className="rounded-md border">
              <Skeleton className="h-12 w-full" />
              <div className="p-4 space-y-2">{[...Array(10)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            </div>
          </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-end items-center gap-4">
                {/* <div className="relative w-full max-w-md">
                  <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input type="search" placeholder="Search details or project..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-9" />
                </div> */}
                <div className="flex items-center gap-2">
                     {canExport && (
                        <Button onClick={handleExportCsv} variant="outline" size="sm" className="h-9">
                          <FileUp className="mr-2 h-4 w-4" /> Export
                        </Button>
                    )}
                    <Radio.Group value={activeSubTab} onChange={(e) => setActiveSubTab(e.target.value)} optionType="button" buttonStyle="solid">
                        <Radio.Button value="poLedger">PO Ledger</Radio.Button>
                        <Radio.Button value="invoicesLedger">Invoices Ledger</Radio.Button>
                    </Radio.Group>
                </div>
            </div>

            <VirtualizedLedgerTable
                items={processedItems}
                activeSubTab={activeSubTab as 'poLedger' | 'invoicesLedger'}
                projectOptions={projectFacetOptions}
                projectFilter={projectFilter}
                onSetProjectFilter={setProjectFilter}
                openingBalance={openingBalance}
                onSaveOpeningBalance={handleSaveOpeningBalance}
                isSavingBalance={isSaving}
                totals={totals}
                endBalance={endBalance}
                dateFilter={dateFilter}
                onSetDateFilter={setDateFilter}
            />
        </div>
    );
};

export default POVendorLedger;

// ---Before Date Filter is added---

// import React, { useMemo, useState, useCallback } from 'react';
// import { useFrappeGetCall, useFrappeGetDoc, useFrappeUpdateDoc } from 'frappe-react-sdk';
// import Fuse from 'fuse.js';
// import { Radio } from 'antd';
// import { Input } from '@/components/ui/input';
// import { Button } from '@/components/ui/button';
// import { FileUp, SearchIcon } from 'lucide-react';
// import { Skeleton } from '@/components/ui/skeleton';
// import { toast } from '@/components/ui/use-toast';
// import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
// import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
// import { VirtualizedLedgerTable } from './VirtualizedLedgerTable';
// import { exportToCsv } from '@/utils/exportToCsv';
// import { formatDate } from '@/utils/FormatDate';
// import { LedgerEntry } from './LedgerTableRow';

// // Type definition for the data coming from the custom API
// interface Invoice { date: string; invoice_no: string; project_name?: string; amount: number; status: string; }
// interface EnrichedPO {
//     name: string;
//     creation: string;
//     total_amount: number;
//     project_name?: string;
//     vendor_name?: string;
//     project_payments: ProjectPayments[];
//     invoices: Invoice[];
// }

// export const POVendorLedger: React.FC<{ vendorId: string }> = ({ vendorId }) => {
//     // UI State
//     const [activeSubTab, setActiveSubTab] = useState('poLedger');
//     const [searchTerm, setSearchTerm] = useState('');
//     const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());

//     // --- Data Fetching Hooks ---
//     const { data: vendorDoc, isLoading: isVendorLoading, mutate: mutateVendorDoc } = useFrappeGetDoc('Vendors', vendorId);
//     const { data: apiResponse, isLoading: isLedgerLoading, error } = useFrappeGetCall<{ message: EnrichedPO[] }>(
//         'nirmaan_stack.api.vendor.get_vendor_po_invoices.get_po_ledger_data',
//         { vendor_id: vendorId },
//         `po_ledger_data_for_vendor_${vendorId}`
//     );
//     const { updateDoc, loading: isSaving } = useFrappeUpdateDoc();

//     const poDataFromApi = apiResponse?.message;
//     const openingBalance = vendorDoc?.opening_balance || 0;

//     // --- Core Logic ---
//     const handleSaveOpeningBalance = (newBalance: number) => {
//         updateDoc('Vendors', vendorId, { opening_balance: newBalance })
//             .then(() => {
//                 toast({ title: "Success", description: "Opening balance updated." });
//                 mutateVendorDoc();
//             })
//             .catch((err) => {
//                 toast({ variant: "destructive", title: "Error", description: err.message });
//             });
//     };

//     const calculateLedger = useCallback((
//         baseData: EnrichedPO[] | undefined,
//         type: 'po' | 'invoice',
//         startBalance: number
//     ): LedgerEntry[] => {
//         if (!baseData) return [];
//         const allEntries: Omit<LedgerEntry, 'balance'>[] = [];
//         baseData.forEach(po => {
//             if (type === 'po') {
//                 allEntries.push({ date: po.creation, transactionType: 'PO Created', project: po.project_name || 'N/A', details: `PO: ${po.name || 'N/A'}`, amount: po.total_amount, payment: 0 });
//             } else {
//                 po.invoices.forEach(invoice => {
//                     allEntries.push({ date: invoice.date, transactionType: 'Invoice Recorded', project: po.project_name || 'N/A', details: `Invoice No: ${invoice.invoice_no}\nStatus: ${invoice.status}`, amount: invoice.amount, payment: 0 });
//                 });
//             }
//             po.project_payments.forEach(payment => {
//                 const isNegative = payment.amount < 0;
//                 let transactionType: LedgerEntry['transactionType'] = 'Payment Made';
//                 let details = `UTR: ${payment.utr || 'N/A'}\nFor PO: ${po.name}`;
//                 if (isNegative) {
//                     transactionType = type === 'po' ? 'Refund Received' : 'Credit Note Received';
//                     details = `${transactionType} against PO: ${po.name}`;
//                 }
//                 allEntries.push({ date: payment.creation, transactionType, project: po.project_name || 'N/A', details, amount: 0, payment: payment.amount });
//             });
//         });
//         allEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
//         let runningBalance = startBalance;
//         return allEntries.map(entry => {
//             runningBalance += entry.amount - entry.payment;
//             return { ...entry, balance: runningBalance };
//         });
//     }, []);

//     const poLedgerFlattenedData = useMemo(() => calculateLedger(poDataFromApi, 'po', openingBalance), [poDataFromApi, openingBalance, calculateLedger]);
//     const invoiceLedgerFlattenedData = useMemo(() => calculateLedger(poDataFromApi, 'invoice', openingBalance), [poDataFromApi, openingBalance, calculateLedger]);

//     const projectFacetOptions = useMemo(() => {
//         if (!poDataFromApi) return [];
//         const projectNames = new Set<string>();
//         poDataFromApi.forEach((po) => { if (po.project_name) projectNames.add(po.project_name); });
//         return Array.from(projectNames).map((name) => ({ label: name, value: name }));
//     }, [poDataFromApi]);

//     const activeData = useMemo(() => {
//         return activeSubTab === 'poLedger' ? poLedgerFlattenedData : invoiceLedgerFlattenedData;
//     }, [activeSubTab, poLedgerFlattenedData, invoiceLedgerFlattenedData]);

//     const fuseInstance = useMemo(() => new Fuse(activeData, { keys: ['details', 'project', 'transactionType'], threshold: 0.3 }), [activeData]);

//     const processedItems = useMemo(() => {
//         let items = activeData;
//         if (searchTerm.trim()) {
//             items = fuseInstance.search(searchTerm).map(result => result.item);
//         }
//         if (projectFilter.size > 0) {
//             items = items.filter(item => projectFilter.has(item.project));
//         }
//         return items;
//     }, [activeData, searchTerm, projectFilter, fuseInstance]);

//     const totals = useMemo(() => {
//         return processedItems.reduce((acc, item) => {
//             acc.amount += item.amount;
//             acc.payment += item.payment;
//             return acc;
//         }, { amount: 0, payment: 0 });
//     }, [processedItems]);

//     const endBalance = processedItems.length > 0 ? processedItems[processedItems.length - 1].balance : openingBalance;

//     // --- UPDATED EXPORT FUNCTION ---
//     const handleExportCsv = useCallback(() => {
//         const exportColumns = [
//             { header: 'Date', accessorKey: 'date' },
//             { header: 'Transaction', accessorKey: 'transactionType' },
//             { header: 'Project', accessorKey: 'project' },
//             { header: 'Details', accessorKey: 'details' },
//             { header: 'Amount', accessorKey: 'amount' },
//             { header: 'Payment', accessorKey: 'payment' },
//             { header: 'Balance', accessorKey: 'balance' },
//         ];

//         // 1. Create the opening balance row object with the requested format
//         const openingBalanceRow = {
//             date: '',
//             transactionType: '',
//             project: '',
//             details: '',
//             amount: '',
//             payment: 'Opening Balance',
//             balance: (openingBalance / 100).toFixed(2),
//         };
        
//         // 2. Format the main transaction data
//         const formattedTransactionData = processedItems.map(item => ({
//             date: formatDate(new Date(item.date)),
//             transactionType: item.transactionType,
//             project: item.project,
//             details: item.details.replace(/\n/g, ' | '),
//             amount: item.amount > 0 ? (item.amount/100).toFixed(2) : '',
//             payment: item.payment !== 0 ? (item.payment/100).toFixed(2) : '',
//             balance: (item.balance/100).toFixed(2)
//         }));

//         // 3. Create the footer/totals row object with the requested format
//         const footerRow = {
//             date: '',
//             transactionType: '',
//             project: '',
//             details: 'Closing Balance / Totals',
//             amount: (totals.amount / 100).toFixed(2),
//             payment: (totals.payment / 100).toFixed(2),
//             balance: (endBalance / 100).toFixed(2)
//         };

//         // 4. Combine all parts into the final array for export
//         const dataToExport = [
//             openingBalanceRow,
//             ...formattedTransactionData,
//             footerRow
//         ];

//         if (dataToExport.length === 2 && formattedTransactionData.length === 0) {
//             toast({ title: "No Transactions", description: "Exporting balances only." });
//         }

//         exportToCsv(`${vendorId}_${activeSubTab}.csv`, dataToExport, exportColumns);
//         toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`});

//     }, [processedItems, vendorId, activeSubTab, openingBalance, totals, endBalance]);

//     // --- Render Logic ---
//     if (error) return <AlertDestructive error={error} />;
    
//     if (isLedgerLoading || isVendorLoading) {
//         return (
//           <div className="space-y-4">
//             <div className="flex justify-between items-center">
//                 <Skeleton className="h-9 w-full max-w-md" />
//                 <div className="flex items-center gap-2"><Skeleton className="h-9 w-24" /><Skeleton className="h-9 w-48" /></div>
//             </div>
//             <div className="rounded-md border">
//               <Skeleton className="h-12 w-full" />
//               <div className="p-4 space-y-2">{[...Array(10)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
//             </div>
//           </div>
//         );
//     }

//     return (
//         <div className="space-y-4">
//             <div className="flex justify-between items-center gap-4">
//                 <div className="relative w-full max-w-md">
//                   <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
//                   <Input type="search" placeholder="Search details or project..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-9" />
//                 </div>
//                 <div className="flex items-center gap-2">
//                     <Button onClick={handleExportCsv} variant="outline" size="sm" className="h-9">
//                       <FileUp className="mr-2 h-4 w-4" /> Export
//                     </Button>
//                     <Radio.Group value={activeSubTab} onChange={(e) => setActiveSubTab(e.target.value)} optionType="button" buttonStyle="solid">
//                         <Radio.Button value="poLedger">PO Ledger</Radio.Button>
//                         <Radio.Button value="invoicesLedger">Invoices Ledger</Radio.Button>
//                     </Radio.Group>
//                 </div>
//             </div>

//             <VirtualizedLedgerTable
//                 items={processedItems}
//                 activeSubTab={activeSubTab as 'poLedger' | 'invoicesLedger'}
//                 projectOptions={projectFacetOptions}
//                 projectFilter={projectFilter}
//                 onSetProjectFilter={setProjectFilter}
//                 openingBalance={openingBalance}
//                 onSaveOpeningBalance={handleSaveOpeningBalance}
//                 isSavingBalance={isSaving}
//                 totals={totals}
//                 endBalance={endBalance}
//             />
//         </div>
//     );
// };

// export default POVendorLedger;

// import React, { useMemo, useState } from 'react';
// import { useFrappeGetCall } from 'frappe-react-sdk';
// import {
//     ColumnDef,
//     useReactTable,
//     getCoreRowModel,
//     getPaginationRowModel,
//     getSortedRowModel,
//     getFilteredRowModel,
// } from '@tanstack/react-table';
// import { DataTable } from '@/components/data-table/new-data-table';
// import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
// import { formatDate } from '@/utils/FormatDate';
// import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
// import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
// import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
// import { Radio } from 'antd';
// import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

// interface Invoice { date: string; invoice_no: string; project_name?: string; amount: number; status: string; }
// interface EnrichedPO {
//     name: string;
//     creation: string;
//     total_amount: number;
//     project_name?: string;
//     vendor_name?: string;
//     project_payments: ProjectPayments[];
//     invoices: Invoice[];
// }
// interface LedgerEntry {
//     date: string;
//     transactionType: 'PO Created' | 'Invoice Recorded' | 'Payment Made' | 'Refund Received' | 'Credit Note Received';
//     project: string;
//     details: string;
//     amount: number;
//     payment: number;
//     balance: number;
// }


// export const POVendorLedger: React.FC<{ vendorId: string }> = ({ vendorId }) => {
//     const [activeSubTab, setActiveSubTab] = useState('poLedger');

//     const { data: apiResponse, isLoading, error } = useFrappeGetCall<{ message: EnrichedPO[] }>(
//         'nirmaan_stack.api.vendor.get_vendor_po_invoices.get_po_ledger_data',
//         { vendor_id: vendorId },
//         `po_ledger_data_for_vendor_${vendorId}`
//     );

//     const poDataFromApi = apiResponse?.message;

//     const projectFacetOptions = useMemo(() => {
//         if (!poDataFromApi) return [];
//         const projectNames = new Set<string>();
//         poDataFromApi.forEach((po) => {
//             if (po.project_name) projectNames.add(po.project_name);
//         });
//         return Array.from(projectNames).map((name) => ({ label: name, value: name }));
//     }, [poDataFromApi]);

//     const facetFilterOptions = useMemo(() => ({
//         project: { title: "Project", options: projectFacetOptions },
//     }), [projectFacetOptions]);

//     const dateFilterColumns = useMemo(() => ["date"], []);

//     const poLedgerFlattenedData = useMemo<LedgerEntry[]>(() => {
//         if (!poDataFromApi) return [];
//         const allEntries: Omit<LedgerEntry, 'balance'>[] = [];
//         poDataFromApi.forEach(po => {
//             allEntries.push({ date: po.creation, transactionType: 'PO Created', project: po.project_name || 'N/A', details: `PO: ${po.name || 'N/A'}`, amount: po.total_amount, payment: 0 });
//             po.project_payments.forEach(payment => {
//                 const isRefund = payment.amount < 0;
//                 allEntries.push({ date: payment.creation, transactionType: isRefund ? 'Refund Received' : 'Payment Made', project: po.project_name || 'N/A', details: isRefund ? `Refund against PO: ${po.name}` : `UTR: ${payment.utr || 'N/A'}\nFor PO: ${po.name}`, amount: 0, payment: payment.amount });
//             });
//         });
//         allEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
//         let runningBalance = 0;
//         return allEntries.map(entry => {
//             runningBalance += entry.amount - entry.payment;
//             return { ...entry, balance: runningBalance };
//         });
//     }, [poDataFromApi]);
    
//     const invoiceLedgerFlattenedData = useMemo<LedgerEntry[]>(() => {
//         if (!poDataFromApi) return [];
//         const allEntries: Omit<LedgerEntry, 'balance'>[] = [];
//         poDataFromApi.forEach(po => {
//             po.invoices.forEach(invoice => {
//                 allEntries.push({ date: invoice.date, transactionType: 'Invoice Recorded', project: invoice.project_name || 'N/A', details: `Invoice No: ${invoice.invoice_no}\nStatus: ${invoice.status}`, amount: invoice.amount, payment: 0 });
//             });
//             po.project_payments.forEach(payment => {
//                 const isCreditNote = payment.amount < 0;
//                 allEntries.push({ date: payment.creation, transactionType: isCreditNote ? 'Credit Note Received' : 'Payment Made', project: po.project_name || 'N/A', details: isCreditNote ? `Credit Note against PO: ${po.name}` : `UTR: ${payment.utr || 'N/A'}\nFor Invoice against PO: ${po.name}`, amount: 0, payment: payment.amount });
//             });
//         });
//         allEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
//         let runningBalance = 0;
//         return allEntries.map(entry => {
//             runningBalance += entry.amount - entry.payment;
//             return { ...entry, balance: runningBalance };
//         });
//     }, [poDataFromApi]);
    
//     const ledgerColumns = useMemo<ColumnDef<LedgerEntry>[]>(() => [
//         { accessorKey: 'date', header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />, cell: ({ row }) => <div>{formatDate(row.getValue('date'))}</div>, filterFn: dateFilterFn },
//         { accessorKey: 'transactionType', header: 'Transactions', cell: ({ row }) => <div className={row.original.transactionType !== 'Payment Made' ? 'font-bold' : ''}>{row.original.transactionType}</div>, enableColumnFilter: false },
//         { accessorKey: 'project', header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />, filterFn: facetedFilterFn },
//         { accessorKey: 'details', header: 'Details', cell: ({ row }) => <div style={{ whiteSpace: 'pre-wrap' }}>{row.getValue('details')}</div>, enableColumnFilter: false },
//         { accessorKey: 'amount', header: ({ column }) => <DataTableColumnHeader column={column} title={activeSubTab === 'poLedger' ? 'PO Amount' : 'Invoice Amount'} />, cell: ({ row }) => <div className="text-center pr-2 font-medium">{row.original.amount > 0 ? formatToRoundedIndianRupee(row.original.amount / 100) : null}</div>, enableColumnFilter: false },
//         { accessorKey: 'payment', header: 'Payments', cell: ({ row }) => <div className="text-center pr-2">{row.original.payment !== 0 ? formatToRoundedIndianRupee(row.original.payment / 100) : null}</div>, enableColumnFilter: false },
//         { accessorKey: 'balance', header: 'Balance', cell: ({ row }) => <div className="text-center pr-2 font-bold">{formatToRoundedIndianRupee(row.getValue('balance') / 100)}</div>, enableColumnFilter: false },
//     ], [activeSubTab]);

//     const table = useReactTable({
//         data: activeSubTab === 'poLedger' ? poLedgerFlattenedData : invoiceLedgerFlattenedData,
//         columns: ledgerColumns,
//         getCoreRowModel: getCoreRowModel(),
//         getPaginationRowModel: getPaginationRowModel(),
//         getSortedRowModel: getSortedRowModel(),
//         getFilteredRowModel: getFilteredRowModel(),
//         initialState: { pagination: { pageSize: 50 } },
//     });

//     if (error) return <AlertDestructive error={error} />;
    
//     return (
//         <div className="space-y-2">
//             <div className="flex justify-end">
//                 <Radio.Group value={activeSubTab} onChange={(e) => setActiveSubTab(e.target.value)} optionType="button" buttonStyle="solid">
//                     <Radio.Button value="poLedger">PO Ledger</Radio.Button>
//                     <Radio.Button value="invoicesLedger">Invoices Ledger</Radio.Button>
//                 </Radio.Group>
//             </div>

//             {isLoading && <div>Loading data...</div>}

//             {!isLoading && (
//                 <div className="overflow-x-auto">
//                     <DataTable
//                         table={table}
//                         columns={ledgerColumns}
//                         totalCount={table.getRowModel().rows.length}
//                         showExportButton={true}
//                         showSearchBar={false}
//                         exportFileName={`${vendorId}_${activeSubTab}`}
//                         facetFilterOptions={facetFilterOptions}
//                         dateFilterColumns={dateFilterColumns}
//                         // --- FIX: Restored the necessary dummy props to prevent crashing the Toolbar ---
//                         searchFieldOptions={[]}
//                         searchTerm=""
//                         onSearchTermChange={() => {}}
//                         selectedSearchField=""
//                         onSelectedSearchFieldChange={() => {}}
//                     />
//                 </div>
//             )}
//         </div>
//     );
// };

// export default POVendorLedger;



// import React, { useMemo, useState } from 'react';
// import { useFrappeGetCall } from 'frappe-react-sdk';
// import {
//     ColumnDef,
//     useReactTable,
//     getCoreRowModel,
//     getPaginationRowModel,
//     getSortedRowModel,
//     getFilteredRowModel, // <-- This is essential for filtering to work
// } from '@tanstack/react-table';
// import { DataTable } from '@/components/data-table/new-data-table';
// import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
// import { formatDate } from '@/utils/FormatDate';
// import { formatToRoundedIndianRupee } from '@/utils/FormatPrice';
// import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
// import { ProjectPayments } from '@/types/NirmaanStack/ProjectPayments';
// import { Radio } from 'antd';
// // Assuming you have these filter functions available
// import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";

// // ... (Interfaces remain the same) ...
// interface Invoice { date: string; invoice_no: string; project_name?: string; amount: number; status: string; }
// interface EnrichedPO {
//     name: string;
//     creation: string;
//     total_amount: number;
//     project_name?: string;
//     vendor_name?: string;
//     project_payments: ProjectPayments[];
//     invoices: Invoice[];
// }
// interface LedgerEntry {
//     date: string;
//     transactionType: 'PO Created' | 'Invoice Recorded' | 'Payment Made';
//     project: string;
//     details: string;
//     amount: number;
//     payment: number;
//     balance: number;
// }


// export const POVendorLedger: React.FC<{ vendorId: string }> = ({ vendorId }) => {
//     const [activeSubTab, setActiveSubTab] = useState('poLedger');

//     const { data: apiResponse, isLoading, error } = useFrappeGetCall<{ message: EnrichedPO[] }>(
//         'nirmaan_stack.api.vendor.get_vendor_po_invoices.get_po_ledger_data',
//         { vendor_id: vendorId },
//         `po_ledger_data_for_vendor_${vendorId}`
//     );

//     const poDataFromApi = apiResponse?.message;

//     const projectFacetOptions = useMemo(() => {
//         if (!poDataFromApi) return [];
//         const projectNames = new Set<string>();
//         poDataFromApi.forEach((po) => {
//             if (po.project_name) projectNames.add(po.project_name);
//         });
//         return Array.from(projectNames).map((name) => ({ label: name, value: name }));
//     }, [poDataFromApi]);

//     const facetFilterOptions = useMemo(() => ({
//         project: { title: "Project", options: projectFacetOptions },
//     }), [projectFacetOptions]);

//     const dateFilterColumns = useMemo(() => ["date"], []);

//     // ... (Data processing logic is correct and remains the same) ...
//     const poLedgerFlattenedData = useMemo<LedgerEntry[]>(() => {
//         if (!poDataFromApi) return [];
//         const allEntries: Omit<LedgerEntry, 'balance'>[] = [];
//         poDataFromApi.forEach(po => {
//             allEntries.push({ date: po.creation, transactionType: 'PO Created', project: po.project_name || 'N/A', details: `PO: ${po.name || 'N/A'}`, amount: po.total_amount, payment: 0 });
//             po.project_payments.forEach(payment => {
//                 allEntries.push({ date: payment.creation, transactionType: 'Payment Made', project: po.project_name || 'N/A', details: `UTR: ${payment.utr || 'N/A'}\nFor PO: ${po.name}`, amount: 0, payment: payment.amount });
//             });
//         });
//         allEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
//         let runningBalance = 0;
//         return allEntries.map(entry => {
//             runningBalance += entry.amount - entry.payment;
//             return { ...entry, balance: runningBalance };
//         });
//     }, [poDataFromApi]);
    
//     const invoiceLedgerFlattenedData = useMemo<LedgerEntry[]>(() => {
//         if (!poDataFromApi) return [];
//         const allEntries: Omit<LedgerEntry, 'balance'>[] = [];
//         poDataFromApi.forEach(po => {
//             po.invoices.forEach(invoice => {
//                 allEntries.push({ date: invoice.date, transactionType: 'Invoice Recorded', project: po.project_name || 'N/A', details: `Invoice No: ${invoice.invoice_no}\nStatus: ${invoice.status}`, amount: invoice.amount, payment: 0 });
//             });
//             po.project_payments.forEach(payment => {
//                 allEntries.push({ date: payment.creation, transactionType: 'Payment Made', project: po.project_name || 'N/A', details: `UTR: ${payment.utr || 'N/A'}\nFor Invoice against PO: ${po.name}`, amount: 0, payment: payment.amount });
//             });
//         });
//         allEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
//         let runningBalance = 0;
//         return allEntries.map(entry => {
//             runningBalance += entry.amount - entry.payment;
//             return { ...entry, balance: runningBalance };
//         });
//     }, [poDataFromApi]);
    
//     // --- FIX: Correctly defined column headers and filter functions ---
//     const ledgerColumns = useMemo<ColumnDef<LedgerEntry>[]>(() => [
//         { 
//             accessorKey: 'date', 
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />, 
//             cell: ({ row }) => <div>{formatDate(row.getValue('date'))}</div>,
//              enableColumnFilter: true,
//             filterFn: dateFilterFn, 

//         },
//         { 
//             accessorKey: 'transactionType', 
//             header: 'Transactions', 
//             enableColumnFilter: false,
//         },
//         { 
//             accessorKey: 'project', 
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />, // Use the header component
//             filterFn: facetedFilterFn, // Corrected typo from filterfn
//         },
//         { 
//             accessorKey: 'details', 
//             header: 'Details', 
//             enableColumnFilter: false,
//         },
//         { 
//             accessorKey: 'amount', 
//             header: 'Amount', 
//             cell: ({ row }) => <div className="text-center pr-2 font-medium">{row.original.amount > 0 ? formatToRoundedIndianRupee(row.original.amount / 100) : null}</div>,
//             enableColumnFilter: false,
//         },
//         { 
//             accessorKey: 'payment', 
//             header: 'Payments', 
//             cell: ({ row }) => <div className="text-center pr-2">{row.original.payment > 0 ? formatToRoundedIndianRupee(row.original.payment / 100) : null}</div>,
//             enableColumnFilter: false,
//         },
//         { 
//             accessorKey: 'balance', 
//             header: 'Balance', 
//             cell: ({ row }) => <div className="text-center pr-2 font-bold">{formatToRoundedIndianRupee(row.getValue('balance') / 100)}</div>,
//             enableColumnFilter: false,
//         },
//     ], []);

//     // --- FIX: Use a single, dynamic table instance to manage state correctly ---
//     const table = useReactTable({
//         data: activeSubTab === 'poLedger' ? poLedgerFlattenedData : invoiceLedgerFlattenedData,
//         columns: ledgerColumns,
//         getCoreRowModel: getCoreRowModel(),
//         getPaginationRowModel: getPaginationRowModel(),
//         getSortedRowModel: getSortedRowModel(),
//         getFilteredRowModel: getFilteredRowModel(), // <-- This enables the filtering engine
//         initialState: { pagination: { pageSize: 50 } },
//     });

//     if (error) return <AlertDestructive error={error} />;
    
//     return (
//         <div className="space-y-2">
//             <div className="flex justify-end">
//                 <Radio.Group value={activeSubTab} onChange={(e) => setActiveSubTab(e.target.value)} optionType="button" buttonStyle="solid">
//                     <Radio.Button value="poLedger">PO Ledger</Radio.Button>
//                     <Radio.Button value="invoicesLedger">Invoices Ledger</Radio.Button>
//                 </Radio.Group>
//             </div>

//             {isLoading && <div>Loading data...</div>}

//             {/* --- FIX: Render only ONE DataTable and pass all props to it --- */}
//             {!isLoading && (
//                 <div className="overflow-x-auto">
//                     <DataTable
//                         table={table}
//                         columns={ledgerColumns}
//                         // totalCount now correctly reflects the number of rows after filtering
//                         totalCount={table.getRowModel().rows.length}
//                         showExportButton={true}
//                         showSearchBar={false}
//                         exportFileName={`${vendorId}_${activeSubTab}`}
//                          searchFieldOptions={[]}
//             searchTerm=""
//             onSearchTermChange={() => {}}
//             selectedSearchField=""
//             onSelectedSearchFieldChange={() => {}}
//                         // These props are now correctly passed to the single DataTable instance
//                         facetFilterOptions={facetFilterOptions}
//                         dateFilterColumns={dateFilterColumns}
//                     />
//                 </div>
//             )}
//         </div>
//     );
// };

// export default POVendorLedger;
