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
import { VirtualizedLedgerTable } from './VirtualizedLedgerTable';
import { exportToCsv } from '@/utils/exportToCsv';
import { formatDate } from '@/utils/FormatDate';
import { LedgerEntry } from './LedgerTableRow';
import { dateFilterFn } from '@/utils/tableFilters';
import { DateFilterValue } from './AdvancedDateFilter';
import { useUserData } from '@/hooks/useUserData';
import { EditBalancingDialog } from './EditBalancingDialog';

// Interface matching the flat object from the API (all amounts in rupees)
interface ApiTransaction {
    type: 'PO Created' | 'SR Created'| 'Invoice Recorded' | 'Payment Made' | 'Refund Received' | 'Credit Note Recorded';
    date: string;
    project: string;
    details: string;
    amount: number; // in rupees
    payment: number; // in rupees
}

// Vendor Doc interface (all amounts in rupees)
interface VendorDoc {
    vendor_type: "Material" | "Service" | "Material & Service";
    sr_amount_balance: number;
    po_amount_balance: number;
    invoice_balance: number;
    payment_balance: number;
    vendor_name: string;
}

type LedgerTab = 'poLedger' | 'srLedger' | 'invoicesLedger';

export const POVendorLedger: React.FC<{ vendorId: string }> = ({ vendorId }) => {
    // UI State
    const [activeSubTab, setActiveSubTab] = useState<LedgerTab>('invoicesLedger');
    const [searchTerm, setSearchTerm] = useState('');
    const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
    const [dateFilter, setDateFilter] = useState<DateFilterValue | undefined>(undefined);
    const [isBalancingDialogOpen, setIsBalancingDialogOpen] = useState(false);
    const { user_id, role } = useUserData();

    const canExport = useMemo(() => {
        const allowedRoles = ["Nirmaan Accountant Profile", "Nirmaan Admin Profile"];
        return user_id === "Administrator" || allowedRoles.includes(role);
    }, [user_id, role]);

    // Data Fetching Hooks
    const { data: vendorDoc, isLoading: isVendorLoading, mutate: mutateVendorDoc } = useFrappeGetDoc<VendorDoc>('Vendors', vendorId, {
        fields: ["vendor_type","po_amount_balance","po_amount_balance", "invoice_balance", "payment_balance", "vendor_name"]
    });

    const { data: apiResponse, isLoading: isLedgerLoading, error } = useFrappeGetCall<{ message: ApiTransaction[] }>(
        'nirmaan_stack.api.vendor.get_vendor_po_invoices.get_po_ledger_data',
        { vendor_id: vendorId },
        `flat_ledger_data_for_vendor_${vendorId}`
    );
    const { updateDoc, loading: isSaving } = useFrappeUpdateDoc();

    const flatTransactionsFromApi = apiResponse?.message;
    const vendorType = vendorDoc?.vendor_type;

    

    // Core Logic for Balancing Figures
    const srAmountBalancing = vendorDoc?.sr_amount_balance || 0;
    const poAmountBalancing = vendorDoc?.po_amount_balance || 0;
    const invoiceBalancing = vendorDoc?.invoice_balance || 0;
    const paymentBalancing = vendorDoc?.payment_balance || 0;

    const poLedgerOpeningBalance = useMemo(() => poAmountBalancing - paymentBalancing, [poAmountBalancing, paymentBalancing]);
    const srLedgerOpeningBalance = useMemo(() => srAmountBalancing - paymentBalancing, [srAmountBalancing, paymentBalancing]);
    const invoiceLedgerOpeningBalance = useMemo(() => invoiceBalancing - paymentBalancing, [invoiceBalancing, paymentBalancing]);

       const activeOpeningBalance = useMemo(() => {
        switch (activeSubTab) {
            case 'poLedger': return poLedgerOpeningBalance;
            case 'srLedger': return srLedgerOpeningBalance;
            case 'invoicesLedger': return invoiceLedgerOpeningBalance;
            default: return 0;
        }
    }, [activeSubTab, poLedgerOpeningBalance, srLedgerOpeningBalance, invoiceLedgerOpeningBalance]);


    const handleSaveBalancingFigures = (values: { po: number;sr: number; invoice: number; payment: number }) => {
        updateDoc('Vendors', vendorId, {
            po_amount_balance: values.po,
             sr_amount_balance: values.sr,
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

    const projectFacetOptions = useMemo(() => {
        if (!flatTransactionsFromApi) return [];
        const projectNames = new Set(flatTransactionsFromApi.map(t => t.project).filter(Boolean));
        return Array.from(projectNames).map((name) => ({ label: name, value: name }));
    }, [flatTransactionsFromApi]);

    // Processing logic to filter and calculate running balance
    const processedItems = useMemo(() => {
        let items = flatTransactionsFromApi || [];

         items = items.filter(item => {
            if (activeSubTab === 'poLedger') {
                // This logic keeps POs and their payments, but excludes all invoices.
                return (item.type !== 'Invoice Recorded' && item.type !== 'Credit Note Recorded' && item.details.includes('PO'));
            }
            if(activeSubTab ==="srLedger"){
                // This logic keeps SRs and their payments, but excludes all invoices.
                return (item.type !== 'Invoice Recorded' && item.type !== 'Credit Note Recorded' && item.details.includes('SR'));
            }
            if(activeSubTab ==="invoicesLedger"){
                // This correctly shows ALL invoices/payments but hides the initial PO/SR creation events.
                return item.type !== 'PO Created' && item.type !== 'SR Created';
            }
            return false;
        });

        if (dateFilter?.value) {
            items = items.filter(item => {
                const mockRow = { getValue: (columnId: string) => item[columnId as keyof ApiTransaction] };
                return dateFilterFn(mockRow as any, 'date', dateFilter, () => {});
            });
        }
        if (searchTerm.trim()) {
            const fuse = new Fuse(items, { keys: ['details', 'project', 'type'], threshold: 0.3 });
            items = fuse.search(searchTerm).map(result => result.item);
        }
        if (projectFilter.size > 0) {
            items = items.filter(item => projectFilter.has(item.project));
        }

        let runningBalance = Number(activeOpeningBalance);
        return items.map((entry): LedgerEntry => {
            runningBalance += entry.amount - entry.payment;
            return { ...entry, transactionType: entry.type as LedgerEntry['transactionType'], balance: runningBalance };
        });

    }, [flatTransactionsFromApi, activeSubTab, activeOpeningBalance, dateFilter, searchTerm, projectFilter]);

    // The rest of your component (totals, export, JSX) does not need to change
    // because it correctly consumes the `processedItems` array.

    const totals = useMemo(() => {
        return processedItems.reduce((acc, item) => {
            acc.amount += item.amount;
            acc.payment += item.payment;
            return acc;
        }, { amount: 0, payment: 0 });
    }, [processedItems]);

    const endBalance = processedItems.length > 0 ? processedItems[processedItems.length - 1].balance : activeOpeningBalance;

    const handleExportCsv = useCallback(() => {
        const exportColumns = [
            { header: 'Date', accessorKey: 'date' }, { header: 'Transaction', accessorKey: 'transactionType' },
            { header: 'Project', accessorKey: 'project' }, { header: 'Details', accessorKey: 'details' },
            { header: 'Amount', accessorKey: 'amount' }, { header: 'Payment', accessorKey: 'payment' },
            { header: 'Balance', accessorKey: 'balance' },
        ];

        const openingAmountForExport = activeSubTab === 'poLedger' ? poAmountBalancing :activeSubTab === 'srLedger' ? srAmountBalancing : invoiceBalancing;

        const openingBalanceRow = {
            date: '', transactionType: '', project: '', details: 'Opening Balance (as on 31st March 2025)',
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
            date: '', transactionType: '', project: '', details: 'Totals & Closing Balance',
            amount: Number(totals.amount).toFixed(2),
            payment: Number(totals.payment).toFixed(2),
            balance: Number(endBalance).toFixed(2)
        };

        const dataToExport = [ openingBalanceRow, ...formattedTransactionData, footerRow ];
        const vendorName = vendorDoc?.vendor_name || vendorId;
        const sanitizedVendorName = vendorName.replace(/[/\\?%*:|"<>]/g, '-');
        const fileName = `${sanitizedVendorName}_${activeSubTab}_Ledger.csv`;
        
        exportToCsv(fileName, dataToExport, exportColumns);
        toast({ title: "Export Successful" });

    }, [
        processedItems, vendorId, activeSubTab, activeOpeningBalance, 
        totals, endBalance, vendorDoc, poAmountBalancing, invoiceBalancing, paymentBalancing
    ]);

    if (error) return <AlertDestructive error={error} />;
    if (isLedgerLoading || isVendorLoading) return <div className="p-4"><Skeleton className="h-48 w-full" /></div>;

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

                        
                         {/* {(vendorType === 'Material' || vendorType === 'Material & Service') && (
                            <Radio.Button value="poLedger">PO Ledger</Radio.Button>
                        )}
                        
                        {(vendorType === 'Service' || vendorType === 'Material & Service') && (
                            <Radio.Button value="srLedger">SR Ledger</Radio.Button>
                        )}
                         */}
                        <Radio.Button value="invoicesLedger">Invoices Ledger</Radio.Button>
                    </Radio.Group>
                </div>
            </div>

            <VirtualizedLedgerTable
                items={processedItems}
                activeSubTab={activeSubTab}
                projectOptions={projectFacetOptions}
                projectFilter={projectFilter}
                onSetProjectFilter={setProjectFilter}
                openingBalance={activeOpeningBalance}
                poAmountBalancing={poAmountBalancing}
                 srAmountBalancing={srAmountBalancing}
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
                initialData={{ po: poAmountBalancing, sr: srAmountBalancing, invoice: invoiceBalancing, payment: paymentBalancing }}
                activeTab={activeSubTab}
                vendorType={vendorType}
            />
        </div>
    );
};

export default POVendorLedger;


// import React, { useMemo, useState, useCallback } from 'react';
// import { useFrappeGetCall, useFrappeGetDoc, useFrappeUpdateDoc } from 'frappe-react-sdk';
// import Fuse from 'fuse.js';
// import { Radio } from 'antd';
// import { Button } from '@/components/ui/button';
// import { FileUp } from 'lucide-react';
// import { Skeleton } from '@/components/ui/skeleton';
// import { toast } from '@/components/ui/use-toast';
// import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
// import { VirtualizedLedgerTable } from './VirtualizedLedgerTable';
// import { exportToCsv } from '@/utils/exportToCsv';
// import { formatDate } from '@/utils/FormatDate';
// import { LedgerEntry } from './LedgerTableRow';
// import { dateFilterFn } from '@/utils/tableFilters';
// import { DateFilterValue } from './AdvancedDateFilter';
// import { useUserData } from '@/hooks/useUserData';
// import { EditBalancingDialog } from './EditBalancingDialog';

// // Interface matching the flat object from the API (all amounts in rupees)
// interface ApiTransaction {
//     type: 'PO Created' | 'Invoice Recorded' | 'Payment Made' | 'Refund Received' | 'Credit Note Recorded';
//     date: string;
//     project: string;
//     details: string;
//     amount: number; // in rupees
//     payment: number; // in rupees
// }

// // Vendor Doc interface (all amounts in rupees)
// interface VendorDoc {
//     po_amount_balance: number;
//     invoice_balance: number;
//     payment_balance: number;
//     vendor_name: string;
// }

// export const POVendorLedger: React.FC<{ vendorId: string }> = ({ vendorId }) => {
//     // UI State
//     const [activeSubTab, setActiveSubTab] = useState('poLedger');
//     const [searchTerm, setSearchTerm] = useState('');
//     const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set());
//     const [dateFilter, setDateFilter] = useState<DateFilterValue | undefined>(undefined);
//     const [isBalancingDialogOpen, setIsBalancingDialogOpen] = useState(false);
//     const { user_id, role } = useUserData();

//     const canExport = useMemo(() => {
//         const allowedRoles = ["Nirmaan Accountant Profile", "Nirmaan Admin Profile"];
//         return user_id === "Administrator" || allowedRoles.includes(role);
//     }, [user_id, role]);

//     // Data Fetching Hooks
//     const { data: vendorDoc, isLoading: isVendorLoading, mutate: mutateVendorDoc } = useFrappeGetDoc<VendorDoc>('Vendors', vendorId, {
//         fields: ["po_amount_balance", "invoice_balance", "payment_balance", "vendor_name"]
//     });

//     const { data: apiResponse, isLoading: isLedgerLoading, error } = useFrappeGetCall<{ message: ApiTransaction[] }>(
//         'nirmaan_stack.api.vendor.get_vendor_po_invoices.get_po_ledger_data',
//         { vendor_id: vendorId },
//         `flat_ledger_data_for_vendor_${vendorId}`
//     );
//     const { updateDoc, loading: isSaving } = useFrappeUpdateDoc();

//     const flatTransactionsFromApi = apiResponse?.message;

//     // Core Logic for Balancing Figures
//     const poAmountBalancing = vendorDoc?.po_amount_balance || 0;
//     const invoiceBalancing = vendorDoc?.invoice_balance || 0;
//     const paymentBalancing = vendorDoc?.payment_balance || 0;

//     const poLedgerOpeningBalance = useMemo(() => poAmountBalancing - paymentBalancing, [poAmountBalancing, paymentBalancing]);
//     const invoiceLedgerOpeningBalance = useMemo(() => invoiceBalancing - paymentBalancing, [invoiceBalancing, paymentBalancing]);
//     const activeOpeningBalance = activeSubTab === 'poLedger' ? poLedgerOpeningBalance : invoiceLedgerOpeningBalance;

//     const handleSaveBalancingFigures = (values: { po: number; invoice: number; payment: number }) => {
//         updateDoc('Vendors', vendorId, {
//             po_amount_balance: values.po,
//             invoice_balance: values.invoice,
//             payment_balance: values.payment,
//         })
//         .then(() => {
//             toast({ title: "Success", description: "Balancing figures updated." });
//             mutateVendorDoc();
//             setIsBalancingDialogOpen(false);
//         })
//         .catch((err) => {
//             toast({ variant: "destructive", title: "Error", description: err.message });
//         });
//     };

//     const projectFacetOptions = useMemo(() => {
//         if (!flatTransactionsFromApi) return [];
//         const projectNames = new Set(flatTransactionsFromApi.map(t => t.project).filter(Boolean));
//         return Array.from(projectNames).map((name) => ({ label: name, value: name }));
//     }, [flatTransactionsFromApi]);

//     // Processing logic to filter and calculate running balance
//     const processedItems = useMemo(() => {
//         let items = flatTransactionsFromApi || [];

//         items = items.filter(item => {
//             if (activeSubTab === 'poLedger') {
//                 return item.type !== 'Invoice Recorded' && item.type !== 'Credit Note Recorded' && item.details.includes('PO');
//             }
//             if(activeSubTab ==="srLedger"){
//                 return item.type !== 'Invoice Recorded' && item.type !== 'Credit Note Recorded' && item.details.includes('SR');
//             }

//             return item.type !== 'PO Created';
//         });

//         if (dateFilter?.value) {
//             items = items.filter(item => {
//                 const mockRow = { getValue: (columnId: string) => item[columnId as keyof ApiTransaction] };
//                 return dateFilterFn(mockRow as any, 'date', dateFilter, () => {});
//             });
//         }
//         if (searchTerm.trim()) {
//             const fuse = new Fuse(items, { keys: ['details', 'project', 'type'], threshold: 0.3 });
//             items = fuse.search(searchTerm).map(result => result.item);
//         }
//         if (projectFilter.size > 0) {
//             items = items.filter(item => projectFilter.has(item.project));
//         }

//         let runningBalance = Number(activeOpeningBalance);
//         return items.map((entry): LedgerEntry => {
//             runningBalance += entry.amount - entry.payment;
//             return { ...entry, transactionType: entry.type, balance: runningBalance };
//         });

//     }, [flatTransactionsFromApi, activeSubTab, activeOpeningBalance, dateFilter, searchTerm, projectFilter]);

//     // The rest of your component (totals, export, JSX) does not need to change
//     // because it correctly consumes the `processedItems` array.

//     const totals = useMemo(() => {
//         return processedItems.reduce((acc, item) => {
//             acc.amount += item.amount;
//             acc.payment += item.payment;
//             return acc;
//         }, { amount: 0, payment: 0 });
//     }, [processedItems]);

//     const endBalance = processedItems.length > 0 ? processedItems[processedItems.length - 1].balance : activeOpeningBalance;

//     const handleExportCsv = useCallback(() => {
//         const exportColumns = [
//             { header: 'Date', accessorKey: 'date' }, { header: 'Transaction', accessorKey: 'transactionType' },
//             { header: 'Project', accessorKey: 'project' }, { header: 'Details', accessorKey: 'details' },
//             { header: 'Amount', accessorKey: 'amount' }, { header: 'Payment', accessorKey: 'payment' },
//             { header: 'Balance', accessorKey: 'balance' },
//         ];

//         const openingAmountForExport = activeSubTab === 'poLedger' ? poAmountBalancing : invoiceBalancing;

//         const openingBalanceRow = {
//             date: '', transactionType: '', project: '', details: 'Opening Balance (as on 31st March 2025)',
//             amount: Number(openingAmountForExport).toFixed(2),
//             payment: Number(paymentBalancing).toFixed(2),
//             balance: Number(activeOpeningBalance).toFixed(2),
//         };
        
//         const formattedTransactionData = processedItems.map(item => ({
//             date: formatDate(new Date(item.date)),
//             transactionType: item.transactionType,
//             project: item.project,
//             details: item.details.replace(/\n/g, ' | '),
//             amount: item.amount !== 0 ? Number(item.amount).toFixed(2) : '',
//             payment: item.payment !== 0 ? Number(item.payment).toFixed(2) : '',
//             balance: Number(item.balance).toFixed(2)
//         }));

//         const footerRow = {
//             date: '', transactionType: '', project: '', details: 'Totals & Closing Balance',
//             amount: Number(totals.amount).toFixed(2),
//             payment: Number(totals.payment).toFixed(2),
//             balance: Number(endBalance).toFixed(2)
//         };

//         const dataToExport = [ openingBalanceRow, ...formattedTransactionData, footerRow ];
//         const vendorName = vendorDoc?.vendor_name || vendorId;
//         const sanitizedVendorName = vendorName.replace(/[/\\?%*:|"<>]/g, '-');
//         const fileName = `${sanitizedVendorName}_${activeSubTab}_Ledger.csv`;
        
//         exportToCsv(fileName, dataToExport, exportColumns);
//         toast({ title: "Export Successful" });

//     }, [
//         processedItems, vendorId, activeSubTab, activeOpeningBalance, 
//         totals, endBalance, vendorDoc, poAmountBalancing, invoiceBalancing, paymentBalancing
//     ]);

//     if (error) return <AlertDestructive error={error} />;
//     if (isLedgerLoading || isVendorLoading) return <div className="p-4"><Skeleton className="h-48 w-full" /></div>;

//     return (
//         <div className="space-y-4">
//             <div className="flex justify-end items-center gap-4">
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
//                 openingBalance={activeOpeningBalance}
//                 poAmountBalancing={poAmountBalancing}
//                 invoiceBalancing={invoiceBalancing}
//                 paymentBalancing={paymentBalancing}
//                 onEditBalancing={() => setIsBalancingDialogOpen(true)}
//                 isSavingBalance={isSaving}
//                 totals={totals}
//                 endBalance={endBalance}
//                 dateFilter={dateFilter}
//                 onSetDateFilter={setDateFilter}
//             />

//             <EditBalancingDialog
//                 isOpen={isBalancingDialogOpen}
//                 onClose={() => setIsBalancingDialogOpen(false)}
//                 onSave={handleSaveBalancingFigures}
//                 isSaving={isSaving}
//                 initialData={{ po: poAmountBalancing, invoice: invoiceBalancing, payment: paymentBalancing }}
//                 activeTab={activeSubTab as 'poLedger' | 'invoicesLedger'}
//             />
//         </div>
//     );
// };

// export default POVendorLedger;

