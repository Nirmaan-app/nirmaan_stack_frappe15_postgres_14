import React, { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { Info, Check, X, Calendar, Edit2, FileText, CheckCircle2 } from "lucide-react";

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

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
import { SR_INVOICE_SEARCHABLE_FIELDS, SR_INVOICE_DATE_COLUMNS, SR_INVOICE_2B_STATUS_OPTIONS } from '../config/srInvoicesTable.config';

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
    invoice_no: string;
    date: string;
    updated_by: string;
    invoice_attachment_id: string;
    service_request: string;
    project?: string;
    vendor: string;
    vendor_name: string;
    is_2b_activated?: boolean;
    reconciled_date?: string | null;
    reconciled_by?: string | null;
}

interface AllSrInvoicesDataCallResponse {
    message: {
        message: {
            invoice_entries: SrInvoiceItem[];
            total_invoices: number;
            total_amount: number;
            total_2b_activated: number;
            pending_2b_activation: number;
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

    // --- Reconciliation Hook ---
    const {
        dialogState,
        openReconciliationDialog,
        closeDialog,
        updateReconciliation,
        isProcessing: isReconciliationProcessing,
    } = useInvoiceReconciliation({
        invoiceType: 'sr',
        onSuccess: () => mutateInvoices(),
    });

    // --- Fetch Nirmaan Attachments ---
    const { data: attachmentsData, isLoading: attachmentsDataLoading } = useFrappeGetDocList<NirmaanAttachment>(
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

    // --- Calculate vendor-specific summary when vendorId is provided ---
    const vendorSummary = useMemo(() => {
        if (!vendorId) return null;

        const totalAmount = invoiceEntries.reduce((sum, entry) => sum + (entry.amount || 0), 0);
        const totalInvoices = invoiceEntries.length;
        const total2bActivated = invoiceEntries.filter(entry => entry.is_2b_activated).length;
        const pending2bActivation = totalInvoices - total2bActivated;

        return { totalAmount, totalInvoices, total2bActivated, pending2bActivation };
    }, [invoiceEntries, vendorId]);

    // --- Column Definitions ---
    const columns: ColumnDef<SrInvoiceItem>[] = useMemo(() => {
        const baseColumns: ColumnDef<SrInvoiceItem>[] = [
            {
                accessorKey: "date",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Date" />,
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
                accessorKey: "updated_by",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Updated By" />,
                cell: ({ row }) => {
                    const userId = row.original.updated_by;
                    const fullName = getUserFullName(userId);
                    return <div className="font-medium">{fullName}</div>;
                },
                filterFn: (row, id, value) => value.includes(row.getValue(id)),
                size: 150,
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
                accessorKey: "is_2b_activated",
                header: ({ column }) => <DataTableColumnHeader column={column} title="2B Activated" />,
                cell: ({ row }) => {
                    const is2bActivated = row.original.is_2b_activated;

                    // Show loading state while role is being fetched
                    if (role === "Loading") {
                        return <span className="text-gray-400">...</span>;
                    }

                    return (
                        <div className="flex items-center gap-2">
                            {is2bActivated ? (
                                <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                                    <Check className="w-3 h-3 mr-1" /> Yes
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="text-gray-500">
                                    <X className="w-3 h-3 mr-1" /> No
                                </Badge>
                            )}
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
                    const is2bActivated = row.original.is_2b_activated;
                    const stringValue = is2bActivated ? "true" : "false";
                    return value.includes(stringValue);
                },
                size: 140,
            },
            {
                accessorKey: "reconciled_date",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Reconciled Date" />,
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
            }
        );

        return baseColumns;
    }, [getAttachmentUrl, getProjectName, getVendorName, getUserFullName, canUpdateReconciliation, openReconciliationDialog, isReconciliationProcessing, role, vendorId]);

    // --- Use Server Data Table Hook in Client Mode ---
    const {
        table,
        totalCount,
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

    // --- Facet Filter Options from Client Data ---
    const facetFilterOptions = useMemo(() => {
        const uniqueProjects = [...new Set(invoiceEntries.map((i: SrInvoiceItem) => i.project).filter(Boolean))];
        const uniqueUpdatedBy = [...new Set(invoiceEntries.map((i: SrInvoiceItem) => i.updated_by).filter(Boolean))];

        const options: Record<string, { title: string; options: { label: string; value: string }[] }> = {
            project: {
                title: "Project",
                options: uniqueProjects.map(p => ({
                    label: getProjectName(p as string),
                    value: p as string
                }))
            },
            updated_by: {
                title: "Updated By",
                options: uniqueUpdatedBy.map(u => ({
                    label: getUserFullName(u as string),
                    value: u as string
                }))
            },
            is_2b_activated: {
                title: "2B Activated",
                options: SR_INVOICE_2B_STATUS_OPTIONS
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
        // Use vendor-specific summary if vendorId is provided, otherwise use API totals
        const totalAmount = vendorSummary?.totalAmount ?? invoicesData?.message?.message?.total_amount ?? 0;
        const totalInvoices = vendorSummary?.totalInvoices ?? invoicesData?.message?.message?.total_invoices ?? 0;
        const total2bActivated = vendorSummary?.total2bActivated ?? invoicesData?.message?.message?.total_2b_activated ?? 0;
        const pending2bActivation = vendorSummary?.pending2bActivation ?? invoicesData?.message?.message?.pending_2b_activation ?? 0;
        const activationProgress = totalInvoices > 0 ? (total2bActivated / totalInvoices) * 100 : 0;
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
                                    <span className="text-lg font-bold text-cyan-700 dark:text-cyan-400 tabular-nums">
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
                        {/* 2B Status compact */}
                        <div className="flex items-center gap-2 bg-violet-50 dark:bg-violet-950/30 rounded-md p-2 border border-violet-100 dark:border-violet-900/50">
                            <CheckCircle2 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                            <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400 uppercase">2B:</span>
                            <span className="text-sm font-bold text-violet-700 dark:text-violet-400 tabular-nums">
                                {total2bActivated}/{totalInvoices}
                            </span>
                            <Progress value={activationProgress} className="h-1.5 flex-1 max-w-[60px]" />
                            <span className="text-[9px] text-slate-400 dark:text-slate-500">
                                {pending2bActivation} pending
                            </span>
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
                            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 dark:text-slate-500">
                                <FileText className="h-3.5 w-3.5" />
                                <span className="uppercase tracking-wider">
                                    {totalInvoices} Invoice{totalInvoices !== 1 ? 's' : ''} (Approved)
                                </span>
                            </div>
                        </div>
                        {hasFilters && (
                            <div className="flex flex-wrap gap-1.5 items-center mt-2">
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
                    </CardHeader>
                    <CardContent className="px-5 pb-4 pt-0">
                        <div className="grid grid-cols-3 gap-3">
                            {/* Total Amount */}
                            <div className="bg-gradient-to-br from-cyan-50 to-blue-50/50 dark:from-cyan-950/40 dark:to-blue-950/30 rounded-lg p-4 border border-cyan-100 dark:border-cyan-900/50">
                                <dt className="text-xs font-medium text-cyan-600/80 dark:text-cyan-400/80 uppercase tracking-wide mb-1">
                                    Total Amount
                                </dt>
                                <dd className="text-2xl font-bold text-cyan-700 dark:text-cyan-400 tabular-nums">
                                    {formatToRoundedIndianRupee(totalAmount)}
                                </dd>
                            </div>
                            {/* Total Invoices */}
                            <div className="bg-slate-50/80 dark:bg-slate-800/50 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                                <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                                    Total Invoices
                                </dt>
                                <dd className="text-2xl font-bold text-slate-700 dark:text-slate-300 tabular-nums">
                                    {totalInvoices}
                                </dd>
                            </div>
                            {/* 2B Activation */}
                            <div className="bg-gradient-to-br from-violet-50 to-purple-50/50 dark:from-violet-950/40 dark:to-purple-950/30 rounded-lg p-4 border border-violet-100 dark:border-violet-900/50">
                                <dt className="text-xs font-medium text-violet-600/80 dark:text-violet-400/80 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                    <CheckCircle2 className="h-3 w-3" />
                                    2B Activation
                                </dt>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xl font-bold text-violet-700 dark:text-violet-400 tabular-nums">
                                        {total2bActivated}/{totalInvoices}
                                    </span>
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                        {pending2bActivation} pending
                                    </span>
                                </div>
                                <Progress value={activationProgress} className="h-2" />
                            </div>
                        </div>
                    </CardContent>
                </div>
            </Card>
        );
    }, [invoicesData, columnFilters, searchTerm, vendorSummary, vendorId]);

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
                totalCount={totalCount}
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
                currentIs2bActivated={dialogState.currentIs2bActivated}
                currentReconciledDate={dialogState.currentReconciledDate}
            />
        </div>
    );
};

export default SrInvoices;
