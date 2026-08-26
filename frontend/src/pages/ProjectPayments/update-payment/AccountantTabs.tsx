import React, { useCallback, useContext, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ColumnDef, Row } from "@tanstack/react-table";
import { FrappeConfig, FrappeContext, FrappeDoc, GetDocListArgs, useFrappeGetDocList } from "frappe-react-sdk";
import { Info, Trash2 } from "lucide-react";
import { useCEOHoldProjects } from "@/hooks/useCEOHoldProjects";
import { CEO_HOLD_ROW_CLASSES } from "@/utils/ceoHoldRowStyles";

// --- UI Components ---
import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";

// --- Types and Constants ---
import { ProjectPayments } from "@/types/NirmaanStack/ProjectPayments";
import { Projects } from "@/types/NirmaanStack/Projects";


// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { FacetDeclaration, FacetOverrides } from '@/components/data-table/facetConfig';
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { parseNumber } from "@/utils/parseNumber";
import { NotificationType, useNotificationStore } from "@/zustand/useNotificationStore";
import { memoize } from "lodash";
import { DOC_TYPES } from "../approve-payments/constants";
import { getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { formatDateToDDMMYYYY, formatDate } from "@/utils/FormatDate";
import { unparse } from 'papaparse'; // For CSV export
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_PP_FIELDS_TO_FETCH, getProjectPaymentsStaticFilters, PP_DATE_COLUMNS, PP_SEARCHABLE_FIELDS } from "../config/projectPaymentsTable.config";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { useDialogStore } from "@/zustand/useDialogStore";
import UpdatePaymentRequestDialog, { ProjectPaymentUpdateFields } from "./UpdatePaymentDialog";
import { useOrderPayments } from "@/hooks/useOrderPayments";
import { useOrderTotals } from "@/hooks/useOrderTotals";

import PaymentSummaryCards from "../PaymentSummaryCards"

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
// Cashfree's contact columns are the payout-notification address, and Nirmaan wants those
// notifications coming back to its own accounts desk rather than out to each vendor. Fixed
// on every row by design -- the payee is identified by bankAccount + ifsc, not by these.
const CASHFREE_CONTACT_EMAIL = "accounts@nirmaan.app";
const CASHFREE_CONTACT_PHONE = "8904007419";

const ICICI_DEBIT_ACCOUNT = "093705003327";

// A vendor with no bank account / IFSC cannot be paid out at all, so its row is made inert
// rather than merely unselectable: dimmed, and pointer-events stripped so nothing inside it
// responds to a click. canPaymentRowBeSelected already kills the checkbox; this is the
// visual half, so it is obvious WHY the checkbox is dead instead of looking like a bug.
// NOTE: pointer-events-none covers the whole row, so the Pay button, the delete button and
// the PO/SR link on that row are unclickable too. That is the intent -- the row is not
// actionable until someone fills in the vendor's bank details.
const NO_BANK_DETAILS_ROW_CLASSES =
    "opacity-50 bg-muted/40 pointer-events-none select-none";

export const AccountantTabs: React.FC<AccountantTabsProps> = ({ tab = "New Payments" }) => {
    const { toast } = useToast();
    const { db } = useContext(FrappeContext) as FrappeConfig;

    // --- CEO Hold Highlighting ---
    const { ceoHoldProjectIds } = useCEOHoldProjects();

    const { getAmount: getTotalAmountPaidForPO } = useOrderPayments()
    const { getTotalAmount, getDeliveredAmount } = useOrderTotals()

    const [dialogMode, setDialogMode] = useState<"fulfil" | "delete">("fulfil");
    const [currentPayment, setCurrent] = useState<ProjectPaymentUpdateFields | null>(null);
    const { togglePaymentDialog } = useDialogStore();


    // --- State for Export Dialog ---
    const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
    const [debitAccountNumber, setDebitAccountNumber] = useState(ICICI_DEBIT_ACCOUNT); // Default
    const [paymentMode, setPaymentMode] = useState("IMPS");
    // Which bulk-transfer file to emit. "icici" is the original ICICI PAB_VENDOR layout;
    // "cashfree" is Cashfree's payout template -- a completely different column set, not a
    // variation on the same one, which is why the two builders below stay separate.
    const [exportTarget, setExportTarget] = useState<"icici" | "cashfree">("icici");

    // --- Supporting Data Fetches ---
    const projectsFetchOptions = getProjectListOptions();

    // --- Generate Query Keys ---
    const projectQueryKey = queryKeys.projects.list(projectsFetchOptions);

    const { data: projects, isLoading: projectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
        DOC_TYPES.PROJECTS, projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, projectQueryKey
    );


    const { data: vendors, isLoading: vendorsLoading, error: vendorsError } = useFrappeGetDocList<Vendors>(
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

    const openDialog = (p: ProjectPayments, m: "fulfil" | "delete") => {
        setCurrent({
            name: p.name,
            project: p.project,  // Project ID for CEO Hold check
            project_label: projectOptions.find(o => o.value === p.project)?.label ?? p.project,
            vendor_label: (vendorOptions.find(o => o.value === p.vendor)?.label ?? p.vendor)!,
            document_name: p.document_name,
            document_type: p.document_type,
            amount: p.amount,
            status: p.status
        });
        setDialogMode(m);
        togglePaymentDialog();
    };

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
            accessorKey: "approval_date", header: ({ column }) => <DataTableColumnHeader column={column} title={tab === "New Payments" ? "Approved On" : "Created On"} />,
            cell: ({ row }) => {
                const payment = row.original;
                const eventId = tab === "New Payments" ? "payment:ceo_approved" : "payment:paid";
                const isNew = notifications.find(n => n.docname === payment.name && n.seen === "false" && n.event_id === eventId);
                return (
                    <div role="button" tabIndex={0} onClick={() => handleNewPaymentSeen(isNew)} className="font-medium relative whitespace-nowrap">
                        {isNew && <div className="w-2 h-2 bg-red-500 rounded-full absolute top-1.5 -left-5 animate-pulse" />}
                        {formatDate(payment.approval_date)}
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
                    <HoverCard><HoverCardTrigger asChild><Link to={docLink}><Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" /></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View linked {data.document_type === DOC_TYPES.PROCUREMENT_ORDERS ? "PO" : "SR"}</HoverCardContent></HoverCard>
                </div>);
            }, size: 200,
        },
        {
            accessorKey: "vendor", header: "Vendor",
            cell: ({ row }) => {
                const vendorName = getVendorName(row.original.vendor);
                return (<div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
                    <span className="max-w-[150px] truncate" title={vendorName}>{vendorName}</span>
                    <HoverCard><HoverCardTrigger asChild><Link to={`/vendors/${row.original.vendor}`}><Info className="w-4 h-4 text-blue-600 cursor-pointer opacity-70 group-hover:opacity-100" /></Link></HoverCardTrigger><HoverCardContent className="text-xs w-auto p-1.5">View linked vendor</HoverCardContent></HoverCard>
                </div>);
            },
            enableColumnFilter: true, size: 200,
            meta: {
                facet: { field: "vendor", title: "Vendor" } satisfies FacetDeclaration,
            },
        },
        {
            accessorKey: "project", header: "Project",
            cell: ({ row }) => {
                const project = projectOptions.find(p => p.value === row.original.project);
                return <div className="font-medium truncate max-w-[150px]" title={project?.label}>{project?.label || row.original.project}</div>;
            },
            enableColumnFilter: true, size: 180,
            meta: {
                facet: { field: "project", title: "Project" } satisfies FacetDeclaration,
            },
        },
        {
            id: "po_value", header: ({ column }) => <DataTableColumnHeader column={column} title="WO/PO Value" />,
            cell: ({ row }) => {
                const totalValue = getTotalAmount(row.original.document_name, row.original.document_type).totalWithTax;
                return <div className="font-medium pr-2">{formatToRoundedIndianRupee(totalValue)}</div>;
            }, size: 100, enableSorting: false,
            meta: {
                exportHeaderName: "WO/PO Value",
                exportValue: (row: ProjectPayments) => formatToRoundedIndianRupee(getTotalAmount(row.document_name, row.document_type).totalWithTax),
            }
        },
        {
            id: "total_paid_for_doc", header: ({ column }) => <DataTableColumnHeader column={column} title="Total Paid" />,
            cell: ({ row }) => {
                const amountPaid = getTotalAmountPaidForPO(row.original.document_name, ['Paid']);
                return <div className="font-medium pr-2">{formatToRoundedIndianRupee(amountPaid)}</div>;
            }, size: 100, enableSorting: false,
            meta: {
                exportHeaderName: "Total Paid",
                exportValue: (row: ProjectPayments) => formatToRoundedIndianRupee(getTotalAmountPaidForPO(row.document_name, ['Paid'])),
            }
        },
        {
            id: "payable_against_delivery",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Payable Against Delivery" />,
            cell: ({ row }) => {
                const delivered = parseNumber(getDeliveredAmount(row.original.document_name, row.original.document_type));
                return <div className="font-medium pr-2">{delivered ? formatToRoundedIndianRupee(delivered) : "N/A"}</div>;
            },
            size: 100, enableSorting: false,
            meta: {
                exportHeaderName: "Payable Against Delivery",
                exportValue: (row: ProjectPayments) => parseNumber(getDeliveredAmount(row.document_name, row.document_type)),
            }
        },
        {
            accessorKey: "amount", header: ({ column }) => <DataTableColumnHeader column={column} title="Req. Amt" />,
            cell: ({ row }) => <div className="font-medium pr-2 text-emerald-500 dark:text-emerald-300">{formatToRoundedIndianRupee(row.original.amount)}</div>,
            enableColumnFilter: true,
            size: 100,
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
                    <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700" onClick={() => openDialog(row.original, "fulfil")}>Pay</Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive/80" onClick={() => openDialog(row.original, "delete")}><Trash2 className="h-4 w-4" /></Button>
                </div>
            ), size: 90,
        } as ColumnDef<ProjectPayments>] : []),
    ], [tab, projectOptions, vendorOptions, notifications, getVendorName, handleNewPaymentSeen, openDialog, getTotalAmountPaidForPO, getTotalAmount, getDeliveredAmount]); // Add dependencies

    // Function to determine if a row can be selected (passed to hook)
    //
    // This is the gate that keeps an unpayable vendor out of the export file: the checkbox
    // renders disabled off row.getCanSelect(), so the row cannot be selected and therefore
    // cannot reach either CSV builder.
    //
    // BOTH halves of the bank details are required, not just the account number. An account
    // number on its own still exports a blank `ifsc` -- Cashfree and ICICI both reject a
    // payout row without it, and the failure only surfaces after upload. The beneficiary
    // name needs no check: it falls back to vendor_name, which is mandatory on the doctype.
    const hasBankDetails = useCallback((vendorId?: string): boolean => {
        const vendor = vendors?.find(v => v.name === vendorId);
        const account = String(vendor?.account_number ?? '').trim();
        const ifsc = String(vendor?.ifsc ?? '').trim();
        return !!account && !!ifsc;
    }, [vendors]);

    const canPaymentRowBeSelected = useCallback((row: Row<ProjectPayments>): boolean => {
        if (tab === "New Payments") {
            return hasBankDetails(row.original.vendor);
        }
        return false; // By default, other tabs might not have selectable rows
    }, [hasBankDetails, tab]);

    // --- CEO Hold Row Highlighting ---
    const getRowClassName = useCallback(
        (row: Row<ProjectPayments>) => {
            // CEO hold stays first: it is a safety signal and must not be dimmed away. Such a
            // row is already unpayable, and its checkbox is disabled by the bank-details rule
            // anyway, so nothing is lost by letting the red win.
            const projectId = row.original.project;
            if (projectId && ceoHoldProjectIds.has(projectId)) {
                return CEO_HOLD_ROW_CLASSES;
            }
            if (tab === "New Payments" && !hasBankDetails(row.original.vendor)) {
                return NO_BANK_DETAILS_ROW_CLASSES;
            }
            return undefined;
        },
        [ceoHoldProjectIds, hasBankDetails, tab]
    );

    // --- useServerDataTable Hook Instantiation (moved up for columnFilters access) ---
    const {
        table, data, totalCount, isLoading: listIsLoading, error: listError,
        selectedSearchField, setSelectedSearchField,
        searchTerm, setSearchTerm,
        isRowSelectionActive,
        refetch,
        exportAllRows,
        isExporting,
    } = useServerDataTable<ProjectPayments>({
        doctype: DOCTYPE,
        columns: columns,
        searchableFields: accountantSearchableFields,
        fetchFields: fieldsToFetch,
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

        const buildIciciRows = () => rowsToExport.map(row => {
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

        // One stamp per export, shared by every row in the file. Cashfree keys a payout on
        // transferId and rejects one it has already processed, so ids must never repeat
        // across files -- the old position-based ids ("transferId12", "transferId22", ...)
        // were identical in every export and would have failed on the second upload.
        //
        // Date.now() rather than Math.random(): guaranteed unique per export, where a random
        // number is only probably unique. Kept to its last 10 digits to hold the id short --
        // that block only repeats every 10^10 ms (~115 days) and would need two exports
        // landing on the same millisecond 115 days apart to collide.
        const batchStamp = String(Date.now()).slice(-10);

        const buildCashfreeRows = () => rowsToExport.map((row, idx) => {
            const payment = row.original;
            const vendorDetails = getVendorDetails(payment.vendor);
            const projectLabel = projectOptions.find(o => o.value === payment.project)?.label ?? payment.project;

            // The beneficiary name must be the ACCOUNT HOLDER's name, which is why this reads
            // account_name and not vendor_name -- the two legitimately differ (proprietor vs
            // trading name). But some vendor records have the account NUMBER typed into
            // account_name (SAFETYWALA EQUIPMENTS LLP is one), which put a bare number in this
            // column. A name contains at least one letter; if it does not, it is not a name,
            // so fall back to vendor_name rather than send Cashfree a number to match on.
            const accountName = (vendorDetails?.account_name || '').trim();
            const beneficiaryName = /[A-Za-z]/.test(accountName)
                ? accountName
                : (vendorDetails?.vendor_name || '');

            return {
                'transferId': `${batchStamp}${String(idx + 1).padStart(2, '0')}`,
                'bankAccount': vendorDetails?.account_number || '',
                'ifsc': vendorDetails?.ifsc || '',
                'name': beneficiaryName,
                'email': CASHFREE_CONTACT_EMAIL,
                'phone': CASHFREE_CONTACT_PHONE,
                'amount': parseNumber(payment.amount),
                'remarks': `${projectLabel} - ${payment.document_name}`,
                'transferMode': paymentMode.toLowerCase(),
            };
        });

        // Widened to a common row type: the two layouts share no columns, and papaparse's
        // unparse() will not accept a union of two different object shapes.
        // `undefined` is in the value type because formatDateToDDMMYYYY is typed to return
        // `string | undefined`; papaparse writes an empty cell for it either way.
        const csvData: Record<string, string | number | undefined>[] =
            exportTarget === "cashfree" ? buildCashfreeRows() : buildIciciRows();

        const csv = unparse(csvData);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', exportTarget === "cashfree"
            ? `Cashfree_Payments_${formatDate(new Date())}.csv`
            : `New_Payments_${formatDate(new Date())}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({ title: "Export Successful", description: `${csvData.length} payments exported.`, variant: "success" });
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
                    summaryCard={
                        <PaymentSummaryCards totalCount={totalCount} />
                    }
                    // globalFilterValue={globalFilter}
                    // onGlobalFilterChange={setGlobalFilter}
                    // searchPlaceholder={`Search ${tab}...`}
                    // showItemSearchToggle={showItemSearchToggle} // Will be false
                    // itemSearchConfig={{
                    //     isEnabled: isItemSearchEnabled,
                    //     toggle: toggleItemSearch,
                    //     label: "Item Search"
                    // }}
                    facetDoctype={DOCTYPE}
                    facetOverrides={{
                        project: { additionalFilters: staticFilters },
                        vendor: { additionalFilters: staticFilters },
                    } satisfies FacetOverrides}
                    dateFilterColumns={dateColumns}
                    showExportButton={true}
                    onExport={tab === "New Payments" ? handlePrepareExport : 'default'}
                    onExportAll={exportAllRows}
                    isExporting={isExporting}
                    exportFileName={`${tab.replace(/\s+/g, '_')}_${formatDate(new Date())}`}
                    showRowSelection={isRowSelectionActive}
                    getRowClassName={getRowClassName}
                />
            )}

            <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-center">Export Payments to CSV</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <h2 className="font-semibold text-primary text-sm">Debit Account Details</h2>
                        <RadioGroup
                            value={exportTarget}
                            onValueChange={(v) => {
                                const target = v as "icici" | "cashfree";
                                setExportTarget(target);
                                // Picking ICICI re-seeds the debit account, matching what the
                                // radio did before it also selected the file format.
                                if (target === "icici") setDebitAccountNumber(ICICI_DEBIT_ACCOUNT);
                            }}
                            className="space-y-2"
                        >
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="icici" id="icici_0937" />
                                <Label htmlFor="icici_0937">ICICI - XXXX3327</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="cashfree" id="cashfree" />
                                <Label htmlFor="cashfree">Cashfree</Label>
                            </div>
                            {/* Add more accounts if needed */}
                        </RadioGroup>
                        {/* Cashfree's template has no debit-account column -- the source account
                            is fixed on the Cashfree side -- so this input only applies to ICICI. */}
                        {exportTarget === "icici" && (
                            <div className="grid grid-cols-3 items-center gap-4">
                                <Label htmlFor="debitAccNo" className="col-span-1">Custom Acc No:</Label>
                                <Input id="debitAccNo" value={debitAccountNumber} onChange={(e) => setDebitAccountNumber(e.target.value)} className="col-span-2 h-8" />
                            </div>
                        )}
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

            {currentPayment && (
                <UpdatePaymentRequestDialog
                    mode={dialogMode}
                    payment={currentPayment}
                    onSuccess={() => refetch()}   // your list refetch
                />
            )}
        </div>
    );
};

export default AccountantTabs;