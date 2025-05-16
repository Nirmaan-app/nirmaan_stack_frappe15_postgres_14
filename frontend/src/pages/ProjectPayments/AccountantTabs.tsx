import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ColumnDef, Row } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, FrappeDoc, GetDocListArgs, useFrappeDeleteDoc, useFrappeFileUpload, useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { CircleCheck, CircleX, Info, SquarePen, Trash2 } from "lucide-react";

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TailSpin } from "react-loader-spinner";

// --- Dialog Component (If PaymentActionDialog is too specific for "Fulfill") ---
// Consider if a more generic "PaymentFulfillDialog" or similar is needed, or adapt PaymentActionDialog
import { CustomAttachment } from "@/components/helpers/CustomAttachment";

// --- Types and Constants ---
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";


// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { memoize } from "lodash";
import { DOC_TYPES, PAYMENT_STATUS } from "./approve-payments/constants";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { Separator } from "@/components/ui/separator";
import { formatDate } from "date-fns";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDateToDDMMYYYY } from "@/utils/FormatDate";
import { unparse } from 'papaparse'; // For CSV export
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_PP_FIELDS_TO_FETCH, getProjectPaymentsStaticFilters, PP_DATE_COLUMNS, PP_SEARCHABLE_FIELDS } from "./config/projectPaymentsTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

// --- Constants ---
const DOCTYPE = DOC_TYPES.PROJECT_PAYMENTS;

interface AccountantTabsProps {
  tab?: string; // "New Payments" or "Fulfilled Payments"
}

interface SelectOption { label: string; value: string; }

/**
 * AccountantTabs component for handling payments for a project.
 * For now, only supports "New Payments" tab.
 * tab prop is optional, defaulting to "New Payments".
 */
export const AccountantTabs: React.FC<AccountantTabsProps> = ({ tab = "New Payments" }) => {
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;

    // --- State for Dialogs ---
    const [paymentToProcess, setPaymentToProcess] = useState<ProjectPayments | null>(null);
    const [dialogType, setDialogType] = useState<"fulfill" | "delete">("fulfill"); // To control dialog content
    const [isFulfillDialogOpen, setIsFulfillDialogOpen] = useState<boolean>(false);
    const [paymentScreenshot, setPaymentScreenshot] = useState<File | null>(null);

    // --- State for Export Dialog ---
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [debitAccountNumber, setDebitAccountNumber] = useState("093705003327"); // Default
    const [paymentMode, setPaymentMode] = useState("IMPS");

    // --- Data Mutators ---
    const { upload, loading: uploadLoading } = useFrappeFileUpload();
    const { updateDoc, loading: updateLoading } = useFrappeUpdateDoc();
    const { deleteDoc, loading: deleteLoading } = useFrappeDeleteDoc();

    // --- Supporting Data Fetches ---
    const projectsFetchOptions = getProjectListOptions();
            
    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        DOC_TYPES.PROJECTS, projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );


    const {data: vendors, isLoading: vendorsLoading, error: vendorsError} = useFrappeGetDocList<Vendors>(
        "Vendors",
        {
            fields: ["name", "vendor_name", "account_number", "account_name", "ifsc"],
            limit: 10000
        },
        "Vendors_For_Accountant"
    );

    // const { data: userList, isLoading: userListLoading, error: userError } = useUsersList();


    // --- Zustand Store & Memoized Lookups ---
    const { notifications, mark_seen_notification } = useNotificationStore();
    const projectOptions = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);
    const vendorOptions = useMemo<SelectOption[]>(() => vendors?.map(v => ({ label: v.vendor_name, value: v.name })) || [], [vendors]);

    const getVendorName = useCallback(memoize((vendorId: string | undefined): string => {
        return vendors?.find(vendor => vendor.name === vendorId)?.vendor_name || vendorId || "--";
    }), [vendors]);


    const getVendorDetails = useCallback(memoize((vendorId: string | undefined): Vendors | undefined => {
        return vendors?.find(vendor => vendor.name === vendorId);
    }), [vendors]);

    // const getRowSelectionDisabled = useCallback((vendorId: string | undefined): boolean => {
    //     const vendor = getVendorDetails(vendorId);
    //     return !vendor?.account_number; // Disable if no account number
    // }, [getVendorDetails]);

    // --- Notification Handling ---
    const handleNewPaymentSeen = useCallback((notification: NotificationType | undefined) => {
        if (notification && notification.seen === "false") {
            mark_seen_notification(db, notification);
        }
    }, [db, mark_seen_notification]);

    // --- Dialog Action Handlers ---
    const openFulfillDialog = useCallback((payment: ProjectPayments, type: "fulfill" | "delete") => {
        setPaymentToProcess(payment); // Set the full object for dialog display
        setDialogType(type);
        setPaymentScreenshot(null); // Reset screenshot on dialog open
        setIsFulfillDialogOpen(true);
    }, []);

    const closeFulfillDialog = useCallback(() => {
        setIsFulfillDialogOpen(false);
        setPaymentToProcess(null); // Clear payment data
        setPaymentScreenshot(null); // Clear screenshot
    }, []);

    const handleFulfillPayment = async () => {
        if (!paymentToProcess) return;
        try {
            // Assuming paymentData in dialog has updated utr, payment_date, tds
            const updatedValues: Partial<ProjectPayments> = {
                status: PAYMENT_STATUS.PAID,
                payment_date: paymentToProcess.payment_date, // From dialog state
                utr: paymentToProcess.utr,                 // From dialog state
                tds: parseNumber(paymentToProcess.tds),       // From dialog state
                // Amount is already set, but if it can be edited in dialog, include it here
                // amount: parseNumber(paymentToProcess.amount),
            };

            await updateDoc(DOCTYPE, paymentToProcess.name, updatedValues);

            if (paymentScreenshot) {
                await upload(paymentScreenshot, {
                    doctype: DOCTYPE, docname: paymentToProcess.name,
                    fieldname: "payment_attachment", isPrivate: true,
                });
            }
            refetch();
            toast({ title: "Success!", description: "Payment fulfilled successfully!", variant: "success" });
            closeFulfillDialog();
            // Refetch will be handled by useServerDataTable's listener or manual refetch call
        } catch (error: any) {
            console.error("Failed to fulfill payment:", error);
            toast({ title: "Fulfill Failed!", description: error.message || "Could not fulfill payment.", variant: "destructive" });
        }
    };

    const handleDeletePayment = async () => {
        if (!paymentToProcess) return;
        try {
            await deleteDoc(DOCTYPE, paymentToProcess.name);
            toast({ title: "Success!", description: "Payment deleted successfully!", variant: "success" });
            closeFulfillDialog();
            // Refetch will be handled by useServerDataTable's listener or manual refetch call
        } catch (error: any) {
            console.error("Failed to delete payment:", error);
            toast({ title: "Delete Failed!", description: error.message || "Could not delete payment.", variant: "destructive" });
        }
    };


    // --- Table Configuration for `useServerDataTable` ---
    const urlSyncKey = useMemo(() => `acct_pay_${tab.toLowerCase().replace(/\s+/g, '_')}`, [tab]);

    // const staticFilters = useMemo(() => {
    //     if (tab === "New Payments") return [["status", "=", PAYMENT_STATUS.APPROVED]];
    //     if (tab === "Fulfilled Payments") return [["status", "=", PAYMENT_STATUS.PAID]];
    //     return []; // Default if tab is unrecognized
    // }, [tab]);

    const staticFilters = useMemo(() => getProjectPaymentsStaticFilters(tab), [tab]);

    const accountantSearchableFields: SearchFieldOption[] = useMemo(() => PP_SEARCHABLE_FIELDS, []) 

    const fieldsToFetch = useMemo(() => DEFAULT_PP_FIELDS_TO_FETCH.concat(["modified"]), []);

    const dateColumns = useMemo(() => PP_DATE_COLUMNS, []);

    const columns = useMemo<ColumnDef<ProjectPayments>[]>(() => [
        {
            accessorKey: "modified", header: ({ column }) => <DataTableColumnHeader column={column} title={tab === "New Payments" ? "Approved On" : "Created On"} />,
            cell: ({ row }) => {
                const payment = row.original;
                const eventId = tab === "New Payments" ? "payment:approved" : "payment:paid";
                const isNew = notifications.find(n => n.docname === payment.name && n.seen === "false" && n.event_id === eventId);
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewPaymentSeen(isNew)} className="font-medium relative whitespace-nowrap">
                        {isNew && <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-5 animate-pulse" />}
                        {formatDate(payment.modified, "dd/MM/yyyy")}
                    </div>
                );
            }, size: 150,
        },
        {
            accessorKey: "document_name", header: "#PO / #SR",
            cell: ({ row }) => {
                const data = row.original;
                const docLink = data.document_name.replaceAll("/", "&=")
                 return (<div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
                    <span className="max-w-[150px] truncate" title={data.document_name}>{data.document_name}</span>
                    <HoverCard><HoverCardTrigger asChild><Link to={docLink} target="_blank" rel="noopener noreferrer"><Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100"/></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View linked {data.document_type === DOC_TYPES.PROCUREMENT_ORDERS ? "PO" : "SR"}</HoverCardContent></HoverCard>
                </div>);
            }, size: 200,
        },
        {
            accessorKey: "vendor", header: "Vendor",
            cell: ({ row }) => {
                const vendorName = getVendorName(row.original.vendor);
                    return (<div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
                        <span className="max-w-[150px] truncate" title={vendorName}>{vendorName}</span>
                        <HoverCard><HoverCardTrigger asChild><Link to={`/vendors/${row.original.vendor}`} target="_blank" rel="noopener noreferrer"><Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100"/></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View linked vendor</HoverCardContent></HoverCard>
                    </div>);
            },
            enableColumnFilter: true, size: 200,
        },
        {
            accessorKey: "project", header: "Project",
            cell: ({ row }) => {
                const project = projectOptions.find(p => p.value === row.original.project);
                return <div className="font-medium truncate max-w-[150px]" title={project?.label}>{project?.label || row.original.project}</div>;
            },
            enableColumnFilter: true, size: 180,
        },
        {
            accessorKey: "amount", header: ({ column }) => <DataTableColumnHeader column={column} title="Req. Amt" />,
            cell: ({ row }) => <div className="font-medium pr-2">{formatToRoundedIndianRupee(parseNumber(row.original.amount))}</div>,
            size: 130,
        },
        // // Columns specific to "Fulfilled Payments" tab
        // ...(tab === "Fulfilled Payments" ? [
        //     {
        //         accessorKey: "payment_date", header: ({ column }) => <DataTableColumnHeader column={column} title="Paid On" />,
        //         cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.original.payment_date)}</div>,
        //         size: 150,
        //     },
        //     {
        //         accessorKey: "utr", header: "UTR",
        //         cell: ({ row }) => (
        //             row.original.payment_attachment ? (
        //                 <a href={row.original.payment_attachment.startsWith("http") ? row.original.payment_attachment : `${db.host}${row.original.payment_attachment}`}
        //                    target="_blank" rel="noreferrer" className="font-medium text-blue-600 underline hover:underline-offset-2">
        //                     {row.original.utr || "View"}
        //                 </a>
        //             ) : <div className="font-medium">{row.original.utr || '--'}</div>
        //         ), size: 150,
        //     },
        //     {
        //         accessorKey: "tds", header: ({ column }) => <DataTableColumnHeader column={column} title="TDS" />,
        //         cell: ({ row }) => <div className="font-medium text-right pr-2">{row.original.tds ? formatToRoundedIndianRupee(parseNumber(row.original.tds)) : "--"}</div>,
        //         size: 100,
        //     }
        // ] as ColumnDef<ProjectPayments>[] : []), // Type assertion for conditional spread
        // Actions column for "New Payments" tab
        ...(tab === "New Payments" ? [{
            id: "actions", header: "Actions",
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700" onClick={() => openFulfillDialog(row.original, "fulfill")}>Pay</Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive/80" onClick={() => openFulfillDialog(row.original, "delete")}><Trash2 className="h-4 w-4" /></Button>
                </div>
            ), size: 120,
        } as ColumnDef<ProjectPayments>] : []),
    ], [tab, projectOptions, vendorOptions, notifications, getVendorName, handleNewPaymentSeen, openFulfillDialog]); // Add dependencies

    // Function to determine if a row can be selected (passed to hook)
    const canPaymentRowBeSelected = useCallback((row: Row<ProjectPayments>): boolean => {
        if (tab === "New Payments") {
            const vendor = vendors?.find(v => v.name === row.original.vendor);
            return !!vendor?.account_number;
        }
        return false; // By default, other tabs might not have selectable rows
    }, [vendors, tab]);

    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        // globalFilter, setGlobalFilter,
        // isItemSearchEnabled, toggleItemSearch, showItemSearchToggle, // Though item search is false
        selectedSearchField, setSelectedSearchField,
        searchTerm, setSearchTerm,
        isRowSelectionActive,
        refetch,
    } = useServerDataTable<ProjectPayments>({
        doctype: DOCTYPE,
        columns: columns,
        searchableFields: accountantSearchableFields,
        fetchFields: fieldsToFetch,
        // globalSearchFieldList: globalSearchFields,
        // enableItemSearch: false,
        urlSyncKey: urlSyncKey, 
        defaultSort: tab === "New Payments" ? 'modified desc' : 'payment_date desc',
        enableRowSelection: canPaymentRowBeSelected,
        additionalFilters: staticFilters,
    });


    // --- CSV Export Logic using papaparse ---
    const handlePrepareExport = () => {
        // This function is called when the custom "Export" button (outside DataTable) is clicked
        // It will open the dialog for selecting account number and payment mode.
        // Actual CSV generation happens in `exportSelectedToCSV`.
        if (!table.getSelectedRowModel().rows.length && tab === "New Payments") {
            toast({ title: "Export", description: "Please select payments to export.", variant: "default" });
            return;
        }
        setIsExportDialogOpen(true);
    };

    const exportSelectedToCSV = () => {
        const selectedRows = table.getSelectedRowModel().rows;
        if (selectedRows.length === 0 && tab === "New Payments") {
            toast({ title: "No Data", description: "No payments selected for export.", variant: "default" });
            setIsExportDialogOpen(false);
            return;
        }

        // Use all rows if not "New Payments" tab or if no rows are selected but still want to export all visible
        const rowsToExport = (tab === "New Payments" && selectedRows.length > 0)
            ? selectedRows
            : table.getCoreRowModel().rows; // Or table.getFilteredRowModel().rows for visible after table filters

        if (rowsToExport.length === 0) {
            toast({ title: "No Data", description: "No data available to export.", variant: "default" });
            setIsExportDialogOpen(false);
            return;
        }

        const csvData = rowsToExport.map(row => {
            const payment = row.original;
            const vendorDetails = getVendorDetails(payment.vendor); // Use the memoized helper
            return {
                'PYMT_PROD_TYPE_CODE': 'PAB_VENDOR', // Constant
                'PYMT_MODE': paymentMode,
                'DEBIT_ACC_NO': debitAccountNumber,
                'BNF_NAME': vendorDetails?.account_name || '',
                'BENE_ACC_NO': vendorDetails?.account_number || '',
                'BENE_IFSC': vendorDetails?.ifsc || '',
                'AMOUNT': parseNumber(payment.amount),
                'DEBIT_NARR': '', // Optional
                'CREDIT_NARR': '', // Optional
                'MOBILE_NUM': '', // Optional
                'EMAIL_ID': '', // Optional
                'REMARK': payment.document_name, // PO/SR number as remark
                'PYMT_DATE': formatDateToDDMMYYYY(new Date()), // Today's date for payment file
                'REF_NO': '',
                'ADDL_INFO1': '', 'ADDL_INFO2': '', 'ADDL_INFO3': '', 'ADDL_INFO4': '', 'ADDL_INFO5': '',
                'LEI_NUMBER': ''
            };
        });

        const csv = unparse(csvData);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${formatDateToDDMMYYYY(new Date())}_payments_${tab.replace(' ','_')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({ title: "Export Successful", description: `${csvData.length} payments exported.`, variant: "success"});
        setIsExportDialogOpen(false); // Close dialog
        table.resetRowSelection(); // Clear selection
    };


    const isLoadingOverall = projectsLoading || vendorsLoading;
    const combinedErrorOverall = projectsError || vendorsError || listError;

    if (combinedErrorOverall && !data?.length) { // Show prominent error if main list fails
        <AlertDestructive error={combinedErrorOverall} />
    }

    return (
        <div className="flex-1 space-y-4">
            {isLoadingOverall && !data?.length ? ( // Show skeleton on initial full load
                <TableSkeleton />
            ) : (
                <DataTable<ProjectPayments>
                    table={table}
                    columns={columns}
                    isLoading={listIsLoading} // Pass specific loading state for table
                    error={listError}
                    totalCount={totalCount}
                    searchFieldOptions={accountantSearchableFields}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    // globalFilterValue={globalFilter}
                    // onGlobalFilterChange={setGlobalFilter}
                    // searchPlaceholder={`Search ${tab}...`}
                    // showItemSearchToggle={showItemSearchToggle} // Will be false
                    // itemSearchConfig={{
                    //     isEnabled: isItemSearchEnabled,
                    //     toggle: toggleItemSearch,
                    //     label: "Item Search"
                    // }}
                    facetFilterOptions={{ project: { title: "Project", options: projectOptions }, vendor: { title: "Vendor", options: vendorOptions }}}
                    dateFilterColumns={dateColumns}
                    showExportButton={true}
                    onExport={tab === "New Payments" ? handlePrepareExport : 'default'}
                    showRowSelection={isRowSelectionActive}
                />
            )}

            <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-center">Export Payments to CSV</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <h2 className="font-semibold text-primary text-sm">Debit Account Details</h2>
                        <RadioGroup value={debitAccountNumber} onValueChange={setDebitAccountNumber} className="space-y-2">
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="093705003327" id="icici_0937" />
                                <Label htmlFor="icici_0937">ICICI - XXXX3327</Label>
                            </div>
                            {/* Add more accounts if needed */}
                        </RadioGroup>
                         <div className="grid grid-cols-3 items-center gap-4">
                            <Label htmlFor="debitAccNo" className="col-span-1">Custom Acc No:</Label>
                            <Input id="debitAccNo" value={debitAccountNumber} onChange={(e) => setDebitAccountNumber(e.target.value)} className="col-span-2 h-8" />
                        </div>
                        <div className="grid grid-cols-3 items-center gap-4">
                            <Label htmlFor="paymentMode" className="col-span-1">Payment Mode:</Label>
                            <Select value={paymentMode} onValueChange={setPaymentMode}>
                                <SelectTrigger className="col-span-2 h-8"> <SelectValue placeholder="Select mode" /> </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="IMPS">IMPS</SelectItem>
                                    <SelectItem value="NEFT">NEFT</SelectItem>
                                    {/* <SelectItem value="RTGS">RTGS</SelectItem> */}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="mt-2 flex items-center justify-end space-x-2">
                        <DialogClose asChild><Button variant={"outline"} onClick={() => setIsExportDialogOpen(false)}>Cancel</Button></DialogClose>
                        <Button onClick={exportSelectedToCSV} disabled={table.getSelectedRowModel().rows.length === 0}>Confirm & Export</Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Fulfill/Delete Payment Dialog */}
            {paymentToProcess && (
                 <AlertDialog open={isFulfillDialogOpen} onOpenChange={setIsFulfillDialogOpen}>
                    <AlertDialogContent className="py-8 max-sm:px-12 px-16 text-start overflow-auto">
                        <AlertDialogHeader className="text-start">
                            <AlertDialogTitle className="text-center">
                                {dialogType === "fulfill" ? "Fulfill Payment" : "Delete Payment Request"}
                            </AlertDialogTitle>
                            {dialogType === "fulfill" ? (
                                <div className="space-y-3 pt-2">
                                    <div className="flex items-center justify-between text-sm"><span className="font-medium text-muted-foreground">Project:</span> <span>{projectOptions.find(p=>p.value === paymentToProcess.project)?.label || paymentToProcess.project}</span></div>
                                    <div className="flex items-center justify-between text-sm"><span className="font-medium text-muted-foreground">Vendor:</span> <span>{getVendorName(paymentToProcess.vendor)}</span></div>
                                    <div className="flex items-center justify-between text-sm"><span className="font-medium text-muted-foreground">Doc #:</span> <span>{paymentToProcess.document_name}</span></div>
                                    <div className="flex items-center justify-between text-sm"><span className="font-medium text-muted-foreground">Req. Amt:</span> <span className="font-semibold">{formatToRoundedIndianRupee(paymentToProcess.amount)}</span></div>
                                    <Separator className="my-3"/>
                                    <div className="grid grid-cols-5 items-center gap-4">
                                        <Label htmlFor="utr" className="col-span-2 text-right">UTR <sup className="text-red-500">*</sup></Label>
                                        <Input id="utr" type="text" placeholder="Enter UTR" value={paymentToProcess.utr || ""} onChange={(e) => setPaymentToProcess(p => p ? {...p, utr: e.target.value} : null)} className="col-span-3 h-8" />
                                    </div>
                                    <div className="grid grid-cols-5 items-center gap-4">
                                        <Label htmlFor="tds" className="col-span-2 text-right">TDS Deduction</Label>
                                        <div className="col-span-3">
                                            <Input id="tds" type="number" placeholder="Enter TDS" value={paymentToProcess.tds?.toString() || ""} onChange={(e) => setPaymentToProcess(p => p ? {...p, tds: parseNumber(e.target.value)} : null)} className="h-8" />
                                            {(paymentToProcess.tds || 0) > 0 && <span className="text-xs text-muted-foreground">Amt Paid: {formatToRoundedIndianRupee(parseNumber(paymentToProcess.amount) - parseNumber(paymentToProcess.tds))}</span>}
                                        </div>
                                    </div>
                                     <div className="grid grid-cols-5 items-center gap-4">
                                        <Label htmlFor="payDate" className="col-span-2 text-right">Payment Date <sup className="text-red-500">*</sup></Label>
                                        <Input id="payDate" type="date" value={paymentToProcess.payment_date || ""} onChange={(e) => setPaymentToProcess(p => p ? {...p, payment_date: e.target.value} : null)} max={formatDate(new Date(), "yyyy-MM-dd")} className="col-span-3 h-8" />
                                    </div>
                                    <CustomAttachment label="Payment Proof" selectedFile={paymentScreenshot} onFileSelect={setPaymentScreenshot} maxFileSize={5 * 1024 * 1024} />
                                </div>
                            ) : (
                                <AlertDialogDescription>Are you sure you want to delete this payment request: {paymentToProcess.name}?</AlertDialogDescription>
                            )}
                            <div className="flex gap-2 items-center pt-6 justify-end">
                                {(updateLoading || uploadLoading || deleteLoading) ? <TailSpin color="red" width={24} height={24} /> : (
                                    <>
                                        <AlertDialogCancel asChild><Button variant="outline" onClick={closeFulfillDialog}>Cancel</Button></AlertDialogCancel>
                                        {dialogType === "fulfill" ?
                                            <Button onClick={handleFulfillPayment} disabled={!paymentToProcess?.utr || !paymentToProcess?.payment_date}>Confirm Payment</Button>
                                            :
                                            <Button variant="destructive" onClick={handleDeletePayment}>Confirm Delete</Button>
                                        }
                                    </>
                                )}
                            </div>
                        </AlertDialogHeader>
                    </AlertDialogContent>
                 </AlertDialog>
            )}
        </div>
    );
};

export default AccountantTabs;