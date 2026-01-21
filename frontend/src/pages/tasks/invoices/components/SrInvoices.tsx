import React, { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { Info, Calendar, Edit2, FileText, CheckCircle2, FileCheck2, CircleDashed, CircleCheck } from "lucide-react";

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import SITEURL from "@/constants/siteURL";
import { useUserData } from "@/hooks/useUserData";
import { useInvoiceReconciliation } from "../hooks/useInvoiceReconciliation";
import { dateFilterFn } from "@/utils/tableFilters";

// --- Types ---
import { NirmaanAttachment } from "@/types/NirmaanStack/NirmaanAttachment";
import { Vendors } from "@/types/NirmaanStack/Vendors";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";

// --- Config ---
import { SR_INVOICE_SEARCHABLE_FIELDS, SR_INVOICE_DATE_COLUMNS, SR_INVOICE_RECONCILIATION_STATUS_OPTIONS } from '../config/srInvoicesTable.config';
import { ReconciliationStatus } from '../constants';

// --- Components ---
import { ReconciliationDialog } from "./ReconciliationDialog";

// --- Interfaces ---
interface Projects {
    name: string;
    project_name: string;
    customer: string;
    status: string;
}

interface SrInvoiceItem {
    name: string; // Generated unique identifier
    amount: number;
    reconciled_amount: number;
    invoice_no: string;
    date: string;
    updated_by: string;
    invoice_attachment_id: string;
    service_request: string;
    project?: string;
    vendor: string;
    vendor_name: string;
    reconciliation_status?: ReconciliationStatus;
    reconciled_date?: string | null;
    reconciled_by?: string | null;
    reconciliation_proof_attachment_id?: string | null;
}

interface AllSrInvoicesDataCallResponse {
    message: {
        message: {
            invoice_entries: SrInvoiceItem[];
            total_invoices: number;
            total_amount: number;
            total_fully_reconciled: number;
            total_partially_reconciled: number;
            pending_reconciliation: number;
            // New amount metrics
            total_reconciled_amount: number;
            total_fully_reconciled_amount: number;
            total_partially_reconciled_amount: number;
            total_not_reconciled_amount: number;
            pending_reconciliation_amount: number;
        };
        status: number;
    };
}

// --- Component Props ---
interface SrInvoicesProps {
    vendorId?: string; // Optional: filter to specific vendor
}

// --- Component ---
export const SrInvoices: React.FC<SrInvoicesProps> = ({ vendorId }) => {
    // --- User Role Check ---
    const { role } = useUserData();
    const canUpdateReconciliation = ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan PMO Executive Profile"].includes(role || "");

    // --- API Call for ALL SR Invoices ---
    const { data: invoicesData, isLoading: invoicesDataLoading, mutate: mutateInvoices } = useFrappeGetCall<AllSrInvoicesDataCallResponse>(
        "nirmaan_stack.api.invoices.sr_wise_invoice_data.generate_all_sr_invoice_data",
    );

    // --- Fetch Nirmaan Attachments ---
    const { data: attachmentsData, isLoading: attachmentsDataLoading, mutate: mutateAttachments } = useFrappeGetDocList<NirmaanAttachment>(
        "Nirmaan Attachments",
        {
            fields: ["name", "attachment"],
            filters: [],
            limit: 0,
        },
    );

    // --- Fetch all Projects data ---
    const { data: projectdata, isLoading: projectloading } = useFrappeGetDocList<Projects>("Projects", {
        fields: ['name', 'project_name', 'customer', "status"],
        limit: 1000,
        orderBy: { field: 'creation', order: 'desc' },
    });

    // --- Fetch all Vendors data ---
    const { data: vendors, isLoading: vendorsLoading } = useFrappeGetDocList<Vendors>("Vendors", {
        fields: ["name", "vendor_name"],
        limit: 0,
    }, 'Vendors');

    // --- Fetch all Nirmaan Users data ---
    const { data: users, isLoading: usersLoading } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
        fields: ["name", "full_name"],
        limit: 0,
    }, 'NirmaanUsers');

    // --- Lookup maps ---
    const projectValues = useMemo(() => projectdata?.map((item) => ({
        label: item?.project_name,
        value: item?.name,
    })) || [], [projectdata]);

    const vendorValues = useMemo(() => vendors?.map((item) => ({
        label: item?.vendor_name,
        value: item?.name,
    })) || [], [vendors]);

    const userValues = useMemo(() => users?.map((item) => ({
        label: item?.full_name,
        value: item?.name,
    })) || [], [users]);

    // Memoized function to get attachment URL
    const getAttachmentUrl = useMemo(() => memoize((id: string) => {
        const attachment = attachmentsData?.find((att) => att.name === id);
        return attachment?.attachment;
    }, (id: string) => id), [attachmentsData]);

    // --- Reconciliation Hook ---
    const {
        dialogState,
        openReconciliationDialog,
        closeDialog,
        updateReconciliation,
        isProcessing: isReconciliationProcessing,
    } = useInvoiceReconciliation({
        invoiceType: 'sr',
        onSuccess: () => {
            mutateInvoices();
            mutateAttachments();
        },
        getAttachmentUrl,
    });

    // Helper to get project name
    const getProjectName = useMemo(() => memoize((projectId: string) => {
        const project = projectValues.find(p => p.value === projectId);
        return project?.label || projectId;
    }), [projectValues]);

    // Helper to get vendor name
    const getVendorName = useMemo(() => memoize((vendorId: string) => {
        const vendor = vendorValues.find(v => v.value === vendorId);
        return vendor?.label || vendorId;
    }), [vendorValues]);

    // Helper to get user full name
    const getUserFullName = useMemo(() => memoize((userId: string) => {
        const user = userValues.find(u => u.value === userId);
        return user?.label || userId;
    }), [userValues]);

    // --- Invoice entries from API (with generated name field) ---
    const invoiceEntries = useMemo(() => {
        let entries = invoicesData?.message?.message?.invoice_entries || [];

        // Filter by vendorId if provided
        if (vendorId) {
            entries = entries.filter(entry => entry.vendor === vendorId);
        }

        return entries.map((entry, index) => ({
            ...entry,
            name: `${entry.service_request}-${entry.invoice_no}-${index}` // Generate unique name
        }));
    }, [invoicesData, vendorId]);

    // --- Column Definitions ---
    const columns: ColumnDef<SrInvoiceItem>[] = useMemo(() => {
        const baseColumns: ColumnDef<SrInvoiceItem>[] = [
            {
                accessorKey: "date",
                header: ({ column }) => <DataTableColumnHeader column={column} title={<span className="whitespace-normal leading-tight">Invoice Date</span>} />,
                cell: ({ row }) => {
                    const dateValue = row.original.date?.slice(0, 10);
                    return <div className="font-medium">{dateValue ? formatDate(dateValue) : '-'}</div>;
                },
                filterFn: dateFilterFn,
                size: 120,
            },
            {
                accessorKey: "invoice_no",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice No" />,
                cell: ({ row }) => {
                    const { invoice_no, invoice_attachment_id } = row.original;
                    const attachmentUrl = getAttachmentUrl(invoice_attachment_id);
                    return (
                        <div className="font-medium">
                            {invoice_attachment_id && attachmentUrl ? (
                                <HoverCard>
                                    <HoverCardTrigger>
                                        <span
                                            onClick={() => window.open(SITEURL + attachmentUrl, "_blank")}
                                            className="text-blue-500 underline cursor-pointer"
                                        >
                                            {invoice_no}
                                        </span>
                                    </HoverCardTrigger>
                                    <HoverCardContent className="w-auto rounded-md shadow-lg">
                                        <img
                                            src={`${SITEURL}${attachmentUrl}`}
                                            alt={`Invoice ${invoice_no}`}
                                            className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
                                        />
                                    </HoverCardContent>
                                </HoverCard>
                            ) : (
                                invoice_no
                            )}
                        </div>
                    );
                },
                size: 150,
            },
            {
                accessorKey: "amount",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
                cell: ({ row }) => (
                    <div className="font-medium text-green-600">
                        {formatToRoundedIndianRupee(row.original.amount)}
                    </div>
                ),
                size: 120,
            },
            {
                accessorKey: "reconciled_amount",
                header: ({ column }) => (
                    <DataTableColumnHeader
                        column={column}
                        title={<span className="whitespace-normal leading-tight">Reconciled Amount</span>}
                    />
                ),
                cell: ({ row }) => {
                    const reconciledAmount = row.original.reconciled_amount ?? 0;
                    const invoiceAmount = row.original.amount;

                    // Determine color based on comparison
                    let colorClass = "";
                    if (reconciledAmount === 0) {
                        colorClass = "text-red-600";  // Not reconciled
                    } else if (reconciledAmount !== invoiceAmount) {
                        colorClass = "text-yellow-600";  // Partial
                    } else {
                        colorClass = "text-green-600";  // Full
                    }

                    return (
                        <div className={`font-medium ${colorClass}`}>
                            {formatToRoundedIndianRupee(reconciledAmount)}
                        </div>
                    );
                },
                size: 130,
            },
            {
                accessorKey: "updated_by",
                header: ({ column }) => <DataTableColumnHeader column={column} title={<span className="whitespace-normal leading-tight">Invoice Uploaded By</span>} />,
                cell: ({ row }) => {
                    const userId = row.original.updated_by;
                    const fullName = getUserFullName(userId);
                    return <div className="font-medium">{fullName}</div>;
                },
                filterFn: (row, id, value) => value.includes(row.getValue(id)),
                size: 160,
            },
            {
                accessorKey: "service_request",
                header: ({ column }) => <DataTableColumnHeader column={column} title="SR ID" />,
                cell: ({ row }) => {
                    const sr = row.original.service_request;
                    return (
                        <div className="font-medium flex items-center gap-1">
                            <span>{sr}</span>
                            <HoverCard>
                                <HoverCardTrigger asChild>
                                    <Link to={`/service-requests/${sr.replaceAll('/', "&=")}?tab=approved-sr`}>
                                        <Info className="w-4 h-4 text-blue-600 cursor-pointer" />
                                    </Link>
                                </HoverCardTrigger>
                                <HoverCardContent className="text-xs w-auto p-1.5">
                                    View SR Details
                                </HoverCardContent>
                            </HoverCard>
                        </div>
                    );
                },
                size: 180,
            },
            {
                accessorKey: "project",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
                cell: ({ row }) => {
                    const projectId = row.original.project;
                    const projectName = projectId ? getProjectName(projectId) : '-';
                    return (
                        <div className="font-medium flex items-center gap-1">
                            <span className="truncate max-w-[150px]">{projectName}</span>
                            {projectId && (
                                <HoverCard>
                                    <HoverCardTrigger asChild>
                                        <Link to={`/projects/${projectId}?page=overview`}>
                                            <Info className="w-4 h-4 text-blue-600 cursor-pointer flex-shrink-0" />
                                        </Link>
                                    </HoverCardTrigger>
                                    <HoverCardContent className="text-xs w-auto p-1.5">
                                        View Project
                                    </HoverCardContent>
                                </HoverCard>
                            )}
                        </div>
                    );
                },
                filterFn: (row, id, value) => value.includes(row.getValue(id)),
                size: 200,
            },
        ];

        // Only include vendor column if not filtering by vendor
        if (!vendorId) {
            baseColumns.push({
                accessorKey: "vendor",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
                cell: ({ row }) => {
                    const vendorIdValue = row.original.vendor;
                    const vendorName = getVendorName(vendorIdValue);
                    return (
                        <div className="font-medium flex items-center gap-1">
                            <span className="truncate max-w-[150px]">{vendorName}</span>
                            <HoverCard>
                                <HoverCardTrigger asChild>
                                    <Link to={`/vendors/${vendorIdValue}`}>
                                        <Info className="w-4 h-4 text-blue-600 cursor-pointer flex-shrink-0" />
                                    </Link>
                                </HoverCardTrigger>
                                <HoverCardContent className="text-xs w-auto p-1.5">
                                    View Vendor
                                </HoverCardContent>
                            </HoverCard>
                        </div>
                    );
                },
                filterFn: (row, id, value) => value.includes(row.getValue(id)),
                size: 200,
            });
        }

        // Add remaining columns
        baseColumns.push(
            {
                accessorKey: "reconciliation_status",
                header: ({ column }) => <DataTableColumnHeader column={column} title={<span className="whitespace-normal leading-tight">Reconciled Status</span>} />,
                cell: ({ row }) => {
                    const reconciliationStatus = row.original.reconciliation_status || "";

                    // Show loading state while role is being fetched
                    if (role === "Loading") {
                        return <span className="text-gray-400">...</span>;
                    }

                    const getStatusBadge = () => {
                        switch (reconciliationStatus) {
                            case "full":
                                return (
                                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                                        <CircleCheck className="w-3 h-3 mr-1" /> Full
                                    </Badge>
                                );
                            case "partial":
                                return (
                                    <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
                                        <CircleDashed className="w-3 h-3 mr-1" /> Partial
                                    </Badge>
                                );
                            case "na":
                                return (
                                    <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                                        N/A
                                    </Badge>
                                );
                            default:
                                return (
                                    <Badge variant="outline" className="text-gray-500">
                                        None
                                    </Badge>
                                );
                        }
                    };

                    return (
                        <div className="flex items-center gap-1">
                            {getStatusBadge()}
                            {canUpdateReconciliation && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    onClick={() => openReconciliationDialog(row.original)}
                                    disabled={isReconciliationProcessing}
                                >
                                    <Edit2 className="w-3 h-3 text-purple-600" />
                                </Button>
                            )}
                        </div>
                    );
                },
                filterFn: (row, _id, value) => {
                    const reconciliationStatus = row.original.reconciliation_status || "";
                    return value.includes(reconciliationStatus);
                },
                size: 120,
            },
            {
                accessorKey: "reconciled_by",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Reconciled By" />,
                cell: ({ row }) => {
                    const reconciledBy = row.original.reconciled_by;

                    if (!reconciledBy) {
                        return <span className="text-gray-400">-</span>;
                    }

                    const fullName = getUserFullName(reconciledBy);
                    return <div className="font-medium">{fullName}</div>;
                },
                filterFn: (row, id, value) => value.includes(row.getValue(id)),
                size: 150,
            },
            {
                accessorKey: "reconciled_date",
                header: ({ column }) => <DataTableColumnHeader column={column} title={<span className="whitespace-normal leading-tight">Reconciled Date</span>} />,
                cell: ({ row }) => {
                    const reconciledDate = row.original.reconciled_date;

                    if (!reconciledDate) {
                        return <span className="text-gray-400">-</span>;
                    }

                    return (
                        <div className="flex items-center gap-1 text-sm">
                            <Calendar className="w-3 h-3 text-gray-500" />
                            {formatDate(reconciledDate)}
                        </div>
                    );
                },
                filterFn: dateFilterFn,
                size: 130,
            },
            {
                accessorKey: "reconciliation_proof_attachment_id",
                header: ({ column }) => <DataTableColumnHeader column={column} title={<span className="whitespace-normal leading-tight">Reconciliation Proof</span>} />,
                cell: ({ row }) => {
                    const proofAttachmentId = row.original.reconciliation_proof_attachment_id;

                    if (!proofAttachmentId) {
                        return <span className="text-gray-400">-</span>;
                    }

                    const proofUrl = getAttachmentUrl(proofAttachmentId);

                    if (!proofUrl) {
                        return <span className="text-gray-400">-</span>;
                    }

                    return (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-blue-600 hover:text-blue-800"
                            onClick={() => window.open(`${SITEURL}${proofUrl}`, "_blank")}
                        >
                            <FileCheck2 className="w-3 h-3 mr-1" />
                            View
                        </Button>
                    );
                },
                size: 80,
            }
        );

        return baseColumns;
    }, [getAttachmentUrl, getProjectName, getVendorName, getUserFullName, canUpdateReconciliation, openReconciliationDialog, isReconciliationProcessing, role, vendorId]);

    // --- Use Server Data Table Hook in Client Mode ---
    const {
        table,
        isLoading: tableLoading,
        error: tableError,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        columnFilters,
    } = useServerDataTable<SrInvoiceItem>({
        doctype: '', // Empty - client mode
        columns: columns,
        fetchFields: [],
        searchableFields: SR_INVOICE_SEARCHABLE_FIELDS,
        clientData: invoiceEntries,
        clientTotalCount: invoiceEntries.length,
        urlSyncKey: vendorId ? `vendor_sr_invoices_${vendorId}` : 'sr_invoices',
        defaultSort: 'date desc',
    });

    // --- Get filtered rows from table (after filters/search applied) ---
    const fullyFilteredData = table.getFilteredRowModel().rows.map((row) => row.original);
    const filteredRowCount = table.getFilteredRowModel().rows.length;

    // --- Dynamic Summary calculated from filtered data (updates when filters change) ---
    const dynamicSummary = useMemo(() => {
        if (!fullyFilteredData || fullyFilteredData.length === 0) {
            return {
                totalInvoices: 0,
                totalAmount: 0,
                totalReconciledAmount: 0,
                totalFullyReconciled: 0,
                totalFullyReconciledAmount: 0,
                totalPartiallyReconciled: 0,
                totalPartiallyReconciledAmount: 0,
                totalPartialReconciledValue: 0,
                pendingReconciliation: 0,
                totalNotReconciledAmount: 0,
                pendingReconciliationAmount: 0,
                totalNotApplicable: 0,
                totalNotApplicableAmount: 0,
            };
        }

        let totalAmount = 0;
        let totalReconciledAmount = 0;
        let totalFullyReconciledAmount = 0;
        let totalPartiallyReconciledAmount = 0;
        let totalPartialReconciledValue = 0;
        let totalNotReconciledAmount = 0;
        let totalFullyReconciled = 0;
        let totalPartiallyReconciled = 0;
        let pendingReconciliation = 0;
        let totalNotApplicable = 0;
        let totalNotApplicableAmount = 0;

        fullyFilteredData.forEach(entry => {
            const invoiceAmount = entry.amount || 0;
            const reconciledAmount = entry.reconciled_amount || 0;

            totalAmount += invoiceAmount;
            totalReconciledAmount += reconciledAmount;

            if (entry.reconciliation_status === "full") {
                totalFullyReconciled++;
                totalFullyReconciledAmount += invoiceAmount;
            } else if (entry.reconciliation_status === "partial") {
                totalPartiallyReconciled++;
                totalPartiallyReconciledAmount += invoiceAmount;
                totalPartialReconciledValue += reconciledAmount;
            } else if (entry.reconciliation_status === "na") {
                // N/A invoices are excluded from reconciliation metrics
                totalNotApplicable++;
                totalNotApplicableAmount += invoiceAmount;
            } else {
                pendingReconciliation++;
                totalNotReconciledAmount += invoiceAmount;
            }
        });

        return {
            totalInvoices: fullyFilteredData.length,
            totalAmount,
            totalReconciledAmount,
            totalFullyReconciled,
            totalFullyReconciledAmount,
            totalPartiallyReconciled,
            totalPartiallyReconciledAmount,
            totalPartialReconciledValue,
            pendingReconciliation,
            totalNotReconciledAmount,
            pendingReconciliationAmount: totalPartiallyReconciledAmount + totalNotReconciledAmount,
            totalNotApplicable,
            totalNotApplicableAmount,
        };
    }, [fullyFilteredData]);

    // --- Facet Filter Options from Client Data ---
    const facetFilterOptions = useMemo(() => {
        const uniqueProjects = [...new Set(invoiceEntries.map((i: SrInvoiceItem) => i.project).filter(Boolean))];
        const uniqueUpdatedBy = [...new Set(invoiceEntries.map((i: SrInvoiceItem) => i.updated_by).filter(Boolean))];

        const uniqueReconciledBy = [...new Set(invoiceEntries.map((i: SrInvoiceItem) => i.reconciled_by).filter(Boolean))];

        const options: Record<string, { title: string; options: { label: string; value: string }[] }> = {
            project: {
                title: "Project",
                options: uniqueProjects.map(p => ({
                    label: getProjectName(p as string),
                    value: p as string
                }))
            },
            updated_by: {
                title: "Invoice Uploaded By",
                options: uniqueUpdatedBy.map(u => ({
                    label: getUserFullName(u as string),
                    value: u as string
                }))
            },
            reconciliation_status: {
                title: "Reconciliation Status",
                options: SR_INVOICE_RECONCILIATION_STATUS_OPTIONS.map(opt => ({
                    label: opt.label,
                    value: opt.value
                }))
            },
            reconciled_by: {
                title: "Reconciled By",
                options: uniqueReconciledBy.map(u => ({
                    label: getUserFullName(u as string),
                    value: u as string
                }))
            }
        };

        // Only include vendor filter when not filtering by vendor
        if (!vendorId) {
            const uniqueVendors = [...new Set(invoiceEntries.map((i: SrInvoiceItem) => i.vendor).filter(Boolean))];
            options.vendor = {
                title: "Vendor",
                options: uniqueVendors.map(v => ({
                    label: getVendorName(v as string),
                    value: v as string
                }))
            };
        }

        return options;
    }, [invoiceEntries, getProjectName, getVendorName, getUserFullName, vendorId]);

    // --- Summary Card ---
    const summaryCard = useMemo(() => {
        // Use dynamicSummary - calculated from filtered data (updates when filters change)
        const {
            totalAmount,
            totalInvoices,
            totalFullyReconciled,
            totalPartiallyReconciled,
            pendingReconciliation,
            totalReconciledAmount,
            totalPartiallyReconciledAmount,
            totalPartialReconciledValue,
            totalNotReconciledAmount,
            pendingReconciliationAmount,
            totalNotApplicable,
        } = dynamicSummary;

        const hasFilters = columnFilters.length > 0 || !!searchTerm;

        return (
            <Card className="border-0 shadow-sm bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
                {/* ===== COMPACT MOBILE VIEW ===== */}
                <div className="sm:hidden">
                    <CardContent className="p-3">
                        <div className="flex items-center gap-3 mb-2">
                            {/* Color accent + Icon */}
                            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
                                <FileText className="h-5 w-5 text-white" />
                            </div>
                            {/* Primary metric - Total Amount */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-lg font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                        {formatToRoundedIndianRupee(totalAmount)}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase">
                                        Total
                                    </span>
                                </div>
                                {/* Filters inline */}
                                {hasFilters && (
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {searchTerm && (
                                            <span className="px-1.5 py-0.5 text-[9px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded">
                                                "{searchTerm.slice(0, 10)}"
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                            {/* Count badge */}
                            <div className="flex-shrink-0 text-right">
                                <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-md tabular-nums">
                                    {totalInvoices}
                                </span>
                                <span className="block text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                    invoices
                                </span>
                            </div>
                        </div>
                        {/* Reconciliation Status compact */}
                        <div className="flex flex-wrap items-center gap-2 bg-green-50 dark:bg-green-950/30 rounded-md p-2 border border-green-100 dark:border-green-900/50">
                            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                            <span className="text-[10px] font-medium text-green-600 dark:text-green-400 uppercase">Reconciled:</span>
                            <span className="text-sm font-bold text-green-700 dark:text-green-400 tabular-nums">
                                {formatToRoundedIndianRupee(totalReconciledAmount)}
                            </span>
                            <span className="text-[9px] text-amber-600 dark:text-amber-500">
                                | {pendingReconciliation} pending
                            </span>
                            {totalNotApplicable > 0 && (
                                <span className="text-[9px] text-slate-500 dark:text-slate-400 italic">
                                    | {totalNotApplicable} N/A
                                </span>
                            )}
                        </div>
                    </CardContent>
                </div>

                {/* ===== EXPANDED DESKTOP VIEW ===== */}
                <div className="hidden sm:block">
                    <CardHeader className="pb-2 pt-4 px-5">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                                {vendorId ? "Vendor SR Invoices" : "SR Invoices Summary"}
                            </CardTitle>
                            {hasFilters && (
                                <div className="flex flex-wrap gap-1.5 items-center">
                                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">Filtered:</span>
                                    {searchTerm && (
                                        <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                                            "{searchTerm}"
                                        </span>
                                    )}
                                    {columnFilters.map(filter => (
                                        <span
                                            key={filter.id}
                                            className="px-2 py-0.5 text-[10px] font-medium bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 rounded-full capitalize"
                                        >
                                            {filter.id.replace(/_/g, ' ')}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent className="px-5 pb-4 pt-0">
                        <div className="grid grid-cols-3 gap-3">
                            {/* Card 1: Total Invoices */}
                            <div className="bg-gradient-to-br from-cyan-50 to-blue-50/50 dark:from-cyan-950/40 dark:to-blue-950/30 rounded-lg p-4 border border-cyan-100 dark:border-cyan-900/50">
                                <dt className="text-xs font-medium text-cyan-600/80 dark:text-cyan-400/80 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                    <FileText className="h-3 w-3" />
                                    Total Invoices
                                </dt>
                                <dd className="text-xl font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                    {totalInvoices} <span className="text-sm font-normal text-slate-500">invoices</span>
                                </dd>
                                <dd className="text-lg font-semibold text-cyan-600 dark:text-cyan-400 tabular-nums mt-1">
                                    {formatToRoundedIndianRupee(totalAmount)}
                                </dd>
                            </div>
                            {/* Card 2: Fully Reconciled */}
                            <div className="bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/40 dark:to-emerald-950/30 rounded-lg p-4 border border-green-100 dark:border-green-900/50">
                                <dt className="text-xs font-medium text-green-600/80 dark:text-green-400/80 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Reconciled
                                </dt>
                                <dd className="text-xl font-bold text-green-700 dark:text-green-400 tabular-nums">
                                    {totalFullyReconciled} <span className="text-sm font-normal text-green-600/70">invoices</span>
                                </dd>
                                <dd className="text-lg font-semibold text-green-600 dark:text-green-400 tabular-nums mt-1">
                                    {formatToRoundedIndianRupee(totalReconciledAmount)}
                                </dd>
                                {totalNotApplicable > 0 && (
                                    <dd className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 italic">
                                        ({totalNotApplicable} N/A excluded)
                                    </dd>
                                )}
                            </div>
                            {/* Card 3: Pending Reconciliation */}
                            <div className="bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/40 dark:to-orange-950/30 rounded-lg p-4 border border-amber-100 dark:border-amber-900/50">
                                <dt className="text-xs font-medium text-amber-600/80 dark:text-amber-400/80 uppercase tracking-wide mb-1">
                                    Pending Reconciliation
                                </dt>
                                <dd className="text-xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                                    {pendingReconciliation + totalPartiallyReconciled} <span className="text-sm font-normal text-amber-600/70">invoices</span>
                                </dd>
                                <dd className="text-lg font-semibold text-amber-600 dark:text-amber-400 tabular-nums mt-1">
                                    {formatToRoundedIndianRupee(pendingReconciliationAmount)}
                                </dd>
                                {/* Sub-metrics */}
                                <div className="mt-2 pt-2 border-t border-amber-200/50 dark:border-amber-800/50 space-y-1">
                                    <div className="flex flex-col">
                                        <div className="flex items-center justify-between text-[11px]">
                                            <span className="text-yellow-600 dark:text-yellow-400">Partial</span>
                                            <span className="text-yellow-700 dark:text-yellow-400">
                                                {totalPartiallyReconciled} • {formatToRoundedIndianRupee(totalPartiallyReconciledAmount)}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-end text-[10px] text-yellow-600/70">
                                            ({formatToRoundedIndianRupee(totalPartialReconciledValue)} reconciled)
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-red-600 dark:text-red-400">Not Reconciled</span>
                                        <span className="text-red-700 dark:text-red-400">
                                            {pendingReconciliation} • {formatToRoundedIndianRupee(totalNotReconciledAmount)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </div>
            </Card>
        );
    }, [dynamicSummary, columnFilters, searchTerm, vendorId]);

    // --- Loading State ---
    const isDataLoading = invoicesDataLoading || attachmentsDataLoading || projectloading || vendorsLoading || usersLoading;

    if (isDataLoading) {
        return (
            <div className="flex-1 space-y-4 p-4">
                <TableSkeleton />
            </div>
        );
    }

    return (
        <div className="flex-1 space-y-4">
            <DataTable<SrInvoiceItem>
                table={table}
                columns={columns}
                isLoading={tableLoading}
                error={tableError}
                totalCount={filteredRowCount}
                searchFieldOptions={SR_INVOICE_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={SR_INVOICE_DATE_COLUMNS}
                showExportButton={true}
                onExport="default"
                exportFileName="sr_invoices"
                summaryCard={summaryCard}
            />

            {/* Reconciliation Dialog */}
            <ReconciliationDialog
                isOpen={dialogState.isOpen}
                onClose={closeDialog}
                onConfirm={updateReconciliation}
                isProcessing={isReconciliationProcessing}
                invoiceNo={dialogState.invoiceNo}
                currentReconciliationStatus={dialogState.currentReconciliationStatus}
                currentReconciledDate={dialogState.currentReconciledDate}
                currentProofAttachmentUrl={dialogState.currentProofAttachmentUrl}
                currentInvoiceAmount={dialogState.currentInvoiceAmount}
                currentReconciledAmount={dialogState.currentReconciledAmount}
            />
        </div>
    );
};

export default SrInvoices;
