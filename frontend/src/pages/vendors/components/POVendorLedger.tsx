// src/pages/vendors/components/POVendorLedger.tsx

import React, { useMemo, useState, useCallback } from 'react';
import { useFrappeGetCall, useFrappeGetDoc, useFrappeUpdateDoc } from 'frappe-react-sdk';
import Fuse from 'fuse.js';
import { Radio } from 'antd';
import { Button } from '@/components/ui/button';
import { FileUp } from 'lucide-react';
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
import { EditBalancingDialog } from './EditBalancingDialog';

// Type definitions
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

// --- UPDATED: Using your confirmed field names ---
interface VendorDoc {
    po_amount_balance: number;
    invoice_balance: number;
    payment_balance: number;
    vendor_name: string;
}

// A raw transaction entry before balance is calculated
type RawLedgerEntry = Omit<LedgerEntry, 'balance'>;


export const POVendorLedger: React.FC<{ vendorId: string }> = ({ vendorId }) => {
    // UI State
    const [activeSubTab, setActiveSubTab] = useState('poLedger');
    const [searchTerm, setSearchTerm] = useState('');
    const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
    const [dateFilter, setDateFilter] = useState<DateFilterValue | undefined>(undefined);
    const [isBalancingDialogOpen, setIsBalancingDialogOpen] = useState(false);
    const { user_id, role } = useUserData();

    const canExport = useMemo(() => {
        const allowedRoles = ["Nirmaan Accountant Profile", "Nirmaan Admin Profile"];
        return user_id === "Administrator" || allowedRoles.includes(role);
    }, [user_id, role]);

    // --- Data Fetching Hooks ---
    // --- UPDATED: Using your confirmed field names in the 'fields' array ---
    const { data: vendorDoc, isLoading: isVendorLoading, mutate: mutateVendorDoc } = useFrappeGetDoc<VendorDoc>('Vendors', vendorId, {
        fields: ["po_amount_balance", "invoice_balance", "payment_balance", "vendor_name"]
    });
    const { data: apiResponse, isLoading: isLedgerLoading, error } = useFrappeGetCall<{ message: EnrichedPO[] }>(
        'nirmaan_stack.api.vendor.get_vendor_po_invoices.get_po_ledger_data',
        { vendor_id: vendorId },
        `po_ledger_data_for_vendor_${vendorId}`
    );
    const { updateDoc, loading: isSaving } = useFrappeUpdateDoc();

    const poDataFromApi = apiResponse?.message;

    // --- CORE LOGIC ---
    // --- UPDATED: Using your confirmed field names to read from vendorDoc ---
    const poAmountBalancing = vendorDoc?.po_amount_balance || 0;
    const invoiceBalancing = vendorDoc?.invoice_balance || 0;
    const paymentBalancing = vendorDoc?.payment_balance || 0;

    const poLedgerOpeningBalance = useMemo(() => poAmountBalancing - paymentBalancing, [poAmountBalancing, paymentBalancing]);
    const invoiceLedgerOpeningBalance = useMemo(() => invoiceBalancing - paymentBalancing, [invoiceBalancing, paymentBalancing]);
    const activeOpeningBalance = activeSubTab === 'poLedger' ? poLedgerOpeningBalance : invoiceLedgerOpeningBalance;

    const handleSaveBalancingFigures = (values: { po: number; invoice: number; payment: number }) => {
        // --- UPDATED: Using your confirmed field names in the update object ---
        updateDoc('Vendors', vendorId, {
            po_amount_balance: values.po,
            invoice_balance: values.invoice,
            payment_balance: values.payment,
        })
        .then(() => {
            toast({ title: "Success", description: "Balancing figures updated." });
            mutateVendorDoc();
            setIsBalancingDialogOpen(false);
        })
        .catch((err) => {
            toast({ variant: "destructive", title: "Error", description: err.message });
        });
    };

    // --- REVISED LOGIC (No changes needed here from previous fix) ---
    const allTransactions = useMemo((): RawLedgerEntry[] => {
        if (!poDataFromApi) return [];
        const entries: RawLedgerEntry[] = [];
        poDataFromApi.forEach(po => {
            entries.push({
                date: po.creation,
                transactionType: 'PO Created',
                project: po.project_name || 'N/A',
                details: `PO: ${po.name || 'N/A'}`,
                amount: po.total_amount,
                payment: 0
            });
            po.invoices.forEach(invoice => {
                const isCreditNote = invoice.amount < 0;
                entries.push({
                    date: invoice.date,
                    transactionType: isCreditNote ? 'Credit Note Recorded' : 'Invoice Recorded',
                    project: po.project_name || 'N/A',
                    details: `Invoice No: ${invoice.invoice_no}\nFor PO: ${po.name}`,
                    amount: invoice.amount,
                    payment: 0
                });
            });
            po.project_payments.forEach(payment => {
                const isRefund = payment.amount < 0;
                entries.push({
                    date: payment.creation,
                    transactionType: isRefund ? 'Refund Received' : 'Payment Made',
                    project: po.project_name || 'N/A',
                    details: `UTR: ${payment.utr || 'N/A'}\nFor PO: ${po.name}`,
                    amount: 0,
                    payment: payment.amount
                });
            });
        });
        return entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }, [poDataFromApi]);

    const projectFacetOptions = useMemo(() => {
        if (!poDataFromApi) return [];
        const projectNames = new Set(poDataFromApi.map(po => po.project_name).filter(Boolean as any));
        return Array.from(projectNames).map((name) => ({ label: name, value: name }));
    }, [poDataFromApi]);

    const processedItems = useMemo(() => {
        // Step A: Filter by active tab
        let items = allTransactions.filter(item => {
            // --- THIS IS THE FIX ---
            if (activeSubTab === 'poLedger') {
                // For the PO Ledger, we want to exclude anything invoice-related.
                return item.transactionType !== 'Invoice Recorded' && item.transactionType !== 'Credit Note Recorded';
            }
            // For the Invoices Ledger, we only exclude the initial PO creation.
            return item.transactionType !== 'PO Created';
        });

        // Step B: Apply user-driven filters (date, search, project)
        if (dateFilter?.value) {
            items = items.filter(item => {
                const mockRow = { getValue: (columnId: string) => item[columnId as keyof RawLedgerEntry] };
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

        // Step C: Calculate running balance on the *final, filtered* list
        let runningBalance = Number(activeOpeningBalance);
        return items.map(entry => {
            runningBalance += entry.amount - entry.payment;
            return { ...entry, balance: runningBalance };
        });

    }, [allTransactions, activeSubTab, activeOpeningBalance, dateFilter, searchTerm, projectFilter]);
    const totals = useMemo(() => {
        return processedItems.reduce((acc, item) => {
            acc.amount += item.amount;
            acc.payment += item.payment;
            return acc;
        }, { amount: 0, payment: 0 });
    }, [processedItems]);

    const endBalance = processedItems.length > 0 ? processedItems[processedItems.length - 1].balance : activeOpeningBalance;
   // --- UPDATED & FINAL handleExportCsv ---
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

        // Determine which opening amount to use based on the active tab
        const openingAmountForExport = activeSubTab === 'poLedger' ? poAmountBalancing : invoiceBalancing;

        const openingBalanceRow = {
            date: '',
            transactionType: '',
            project: '',
            details: 'Opening Balance',
            // Populate with the specific balancing figures
            amount: Number(openingAmountForExport).toFixed(2),
            payment: Number(paymentBalancing).toFixed(2),
            balance: Number(activeOpeningBalance).toFixed(2),
        };
        
        const formattedTransactionData = processedItems.map(item => ({
            date: formatDate(new Date(item.date)),
            transactionType: item.transactionType,
            project: item.project,
            details: item.details.replace(/\n/g, ' | '),
            amount: item.amount !== 0 ? Number(item.amount).toFixed(2) : '',
            payment: item.payment !== 0 ? Number(item.payment).toFixed(2) : '',
            balance: Number(item.balance).toFixed(2)
        }));

        const footerRow = {
            date: '',
            transactionType: '',
            project: '',
            details: 'Totals & Closing Balance',
            amount: Number(totals.amount).toFixed(2),
            payment: Number(totals.payment).toFixed(2),
            balance: Number(endBalance).toFixed(2)
        };

        const dataToExport = [ openingBalanceRow, ...formattedTransactionData, footerRow ];

        if (dataToExport.length === 2) {
            toast({ title: "No Transactions", description: "Exporting balances only." });
        }

        const vendorName = vendorDoc?.vendor_name || vendorId;
        const sanitizedVendorName = vendorName.replace(/[/\\?%*:|"<>]/g, '-');
        const fileName = `${sanitizedVendorName}_${activeSubTab}_Ledger.csv`;
        
        exportToCsv(fileName, dataToExport, exportColumns);
        toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`});

    }, [
        processedItems, 
        vendorId, 
        activeSubTab, 
        activeOpeningBalance, 
        totals, 
        endBalance, 
        vendorDoc,
        // Add specific dependencies for the opening balance row
        poAmountBalancing,
        invoiceBalancing,
        paymentBalancing
    ]);



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
                openingBalance={activeOpeningBalance}
                // --- Pass down the correctly named variables ---
                poAmountBalancing={poAmountBalancing}
                invoiceBalancing={invoiceBalancing}
                paymentBalancing={paymentBalancing}
                onEditBalancing={() => setIsBalancingDialogOpen(true)}
                isSavingBalance={isSaving}
                totals={totals}
                endBalance={endBalance}
                dateFilter={dateFilter}
                onSetDateFilter={setDateFilter}
            />

            <EditBalancingDialog
                isOpen={isBalancingDialogOpen}
                onClose={() => setIsBalancingDialogOpen(false)}
                onSave={handleSaveBalancingFigures}
                isSaving={isSaving}
                initialData={{
                    // --- Pass down the correctly named variables ---
                    po: poAmountBalancing,
                    invoice: invoiceBalancing,
                    payment: paymentBalancing
                }}
                 activeTab={activeSubTab as 'poLedger' | 'invoicesLedger'}
            />
        </div>
    );
};

export default POVendorLedger;
   


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
// import { dateFilterFn } from '@/utils/tableFilters';
// import { DateFilterValue } from './AdvancedDateFilter';
// import { useUserData } from '@/hooks/useUserData';


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
//     const [dateFilter, setDateFilter] = useState<DateFilterValue | undefined>(undefined);
//     const { user_id, role } = useUserData();


//  const canExport = useMemo(() => {
//         const allowedRoles = ["Nirmaan Accountant Profile", "Nirmaan Admin Profile"];
//         // Check if user is Administrator OR if their role is in the allowed list
//         return user_id === "Administrator" || allowedRoles.includes(role);
//     }, [user_id, role]); // Dependency array now uses your hook's return values

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

//    const calculateLedger = useCallback((
//         baseData: EnrichedPO[] | undefined,
//         type: 'po' | 'invoice',
//         startBalance: number
//     ): LedgerEntry[] => {
//         if (!baseData) return [];

//         const allEntries: Omit<LedgerEntry, 'balance'>[] = [];

//         baseData.forEach(po => {
//             if (type === 'po') {
//                 allEntries.push({
//                     date: po.creation,
//                     transactionType: 'PO Created',
//                     project: po.project_name || 'N/A',
//                     details: `PO: ${po.name || 'N/A'}`,
//                     amount: po.total_amount,
//                     payment: 0
//                 });
//             } else {
//                 po.invoices.forEach(invoice => {
//                     // **MODIFIED LOGIC**
//                     const isCreditNote = invoice.amount < 0;
//                     allEntries.push({
//                         date: invoice.date,
//                         // If amount is negative, it's a Credit Note
//                         transactionType: isCreditNote ? 'Credit Note Recorded' : 'Invoice Recorded',
//                         project: po.project_name || 'N/A',
//                         // Add PO ID to invoice details
//                         details: `Invoice No: ${invoice.invoice_no}\nFor PO: ${po.name}`,
//                         amount: invoice.amount, // This will now correctly handle negative amounts
//                         payment: 0
//                     });
//                 });
//             }

//             po.project_payments.forEach(payment => {
//                 // **MODIFIED LOGIC**
//                 const isRefund = payment.amount < 0;
//                 allEntries.push({
//                     date: payment.creation,
//                     // If payment is negative, it's a Refund
//                     transactionType: isRefund ? 'Refund Received' : 'Payment Made',
//                     project: po.project_name || 'N/A',
//                     details: `UTR: ${payment.utr || 'N/A'}\nFor PO: ${po.name}`,
//                     amount: 0,
//                     payment: payment.amount
//                 });
//             });
//         });

//         allEntries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

//         let runningBalance = Number(startBalance);
//         return allEntries.map(entry => {
//             // For credit notes, the negative amount is added to the balance
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

//     const processedItems = useMemo(() => {
//         let items = activeData;
        
//         if (dateFilter?.value) {
//             items = items.filter(item => {
//                 const mockRow = { getValue: (columnId: string) => item[columnId as keyof LedgerEntry] };
//                 return dateFilterFn(mockRow as any, 'date', dateFilter, () => {});
//             });
//         }

//         if (searchTerm.trim()) {
//             const fuse = new Fuse(items, { keys: ['details', 'project', 'transactionType'], threshold: 0.3 });
//             items = fuse.search(searchTerm).map(result => result.item);
//         }
        
//         if (projectFilter.size > 0) {
//             items = items.filter(item => projectFilter.has(item.project));
//         }
//         return items;
//     }, [activeData, dateFilter, searchTerm, projectFilter]);

//     const totals = useMemo(() => {
//         return processedItems.reduce((acc, item) => {
//             acc.amount += item.amount;
//             acc.payment += item.payment;
//             return acc;
//         }, { amount: 0, payment: 0 });
//     }, [processedItems]);

//     const endBalance = processedItems.length > 0 ? processedItems[processedItems.length - 1].balance : openingBalance;

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

//         const openingBalanceRow = {
//             date: '', transactionType: '', project: '', details: 'Opening Balance',
//             amount: '', payment: '', balance: Number(openingBalance).toFixed(2),
//         };
        
//         const formattedTransactionData = processedItems.map(item => ({
//             date: formatDate(new Date(item.date)),
//             transactionType: item.transactionType,
//             project: item.project,
//             details: item.details.replace(/\n/g, ' | '),
//             amount: item.amount > 0 ? Number(item.amount).toFixed(2) : '',
//             payment: item.payment !== 0 ? Number(item.payment).toFixed(2) : '',
//             balance: Number(item.balance).toFixed(2)
//         }));

//         const footerRow = {
//             date: '', transactionType: '', project: '', details: 'Closing Balance / Totals',
//             amount: Number(totals.amount).toFixed(2),
//             payment: Number(totals.payment).toFixed(2),
//             balance: Number(endBalance).toFixed(2)
//         };

//         const dataToExport = [ openingBalanceRow, ...formattedTransactionData, footerRow ];

//         if (dataToExport.length === 2 && formattedTransactionData.length === 0) {
//             toast({ title: "No Transactions", description: "Exporting balances only." });
//         }

//         // --- THIS IS THE MODIFIED PART ---
//         // 1. Get the vendor name from the fetched document. Use the ID as a fallback.
//         // Assuming the display field is `vendor_name`. If it's different (e.g., `name1`), change it here.
//         const vendorName = vendorDoc?.vendor_name || vendorId;
        
//         // 2. Sanitize the name to remove characters that are invalid in filenames.
//         const sanitizedVendorName = vendorName.replace(/[/\\?%*:|"<>]/g, '-');

//         // 3. Construct the new, more descriptive filename.
//         const fileName = `${sanitizedVendorName}_${activeSubTab}_Ledger.csv`;
        
//         exportToCsv(fileName, dataToExport, exportColumns);
//         toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`});

//     // --- Add vendorDoc to the dependency array ---
//     }, [processedItems, vendorId, activeSubTab, openingBalance, totals, endBalance, vendorDoc]);

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
//             <div className="flex justify-end items-center gap-4">
//                 {/* <div className="relative w-full max-w-md">
//                   <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
//                   <Input type="search" placeholder="Search details or project..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-9" />
//                 </div> */}
//                 <div className="flex items-center gap-2">
//                      {canExport && (
//                         <Button onClick={handleExportCsv} variant="outline" size="sm" className="h-9">
//                           <FileUp className="mr-2 h-4 w-4" /> Export
//                         </Button>
//                     )}
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
//                 dateFilter={dateFilter}
//                 onSetDateFilter={setDateFilter}
//             />
//         </div>
//     );
// };

// export default POVendorLedger;
