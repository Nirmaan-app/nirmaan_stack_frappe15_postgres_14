import React, { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetCall, useFrappeGetDocList } from "frappe-react-sdk";
import memoize from "lodash/memoize";
import { Info, Check, X, Calendar, Edit2 } from "lucide-react";

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
import { PO_INVOICE_SEARCHABLE_FIELDS, PO_INVOICE_DATE_COLUMNS, PO_INVOICE_2B_STATUS_OPTIONS } from '../config/poInvoicesTable.config';

// --- Components ---
import { ReconciliationDialog } from "./ReconciliationDialog";

// --- Interfaces ---
interface Projects {
    name: string;
    project_name: string;
    customer: string;
    status: string;
}

interface InvoiceItem {
    name: string; // Generated unique identifier
    amount: number;
    invoice_no: string;
    date: string;
    updated_by: string;
    invoice_attachment_id: string;
    procurement_order: string;
    project?: string;
    vendor: string;
    vendor_name: string;
    is_2b_activated?: boolean;
    reconciled_date?: string | null;
    reconciled_by?: string | null;
}

interface AllInvoicesDataCallResponse {
    message: {
        message: {
            invoice_entries: InvoiceItem[];
            total_invoices: number;
            total_amount: number;
            total_2b_activated: number;
            pending_2b_activation: number;
        };
        status: number;
    };
}

// --- Component Props ---
interface PoInvoicesProps {
    vendorId?: string; // Optional: filter to specific vendor
}

// --- Component ---
export const PoInvoices: React.FC<PoInvoicesProps> = ({ vendorId }) => {
    // --- User Role Check ---
    const { role } = useUserData();
    const canUpdateReconciliation = ["Nirmaan Admin Profile", "Nirmaan Accountant Profile", "Nirmaan PMO Executive Profile"].includes(role || "");

    // --- API Call for ALL PO Invoices ---
    const { data: invoicesData, isLoading: invoicesDataLoading, mutate: mutateInvoices } = useFrappeGetCall<AllInvoicesDataCallResponse>(
        "nirmaan_stack.api.invoices.po_wise_invoice_data.generate_all_po_invoice_data",
    );

    // --- Reconciliation Hook ---
    const {
        dialogState,
        openReconciliationDialog,
        closeDialog,
        updateReconciliation,
        isProcessing: isReconciliationProcessing,
    } = useInvoiceReconciliation({
        invoiceType: 'po',
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
            name: `${entry.procurement_order}-${entry.invoice_no}-${index}` // Generate unique name
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
    const columns: ColumnDef<InvoiceItem>[] = useMemo(() => {
        const baseColumns: ColumnDef<InvoiceItem>[] = [
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
                accessorKey: "procurement_order",
                header: ({ column }) => <DataTableColumnHeader column={column} title="PO ID" />,
                cell: ({ row }) => {
                    const po = row.original.procurement_order;
                    return (
                        <div className="font-medium flex items-center gap-1">
                            <span>{po}</span>
                            <HoverCard>
                                <HoverCardTrigger asChild>
                                    <Link to={`/project-payments/${po.replaceAll('/', "&=")}`}>
                                        <Info className="w-4 h-4 text-blue-600 cursor-pointer" />
                                    </Link>
                                </HoverCardTrigger>
                                <HoverCardContent className="text-xs w-auto p-1.5">
                                    View PO Details
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
    } = useServerDataTable<InvoiceItem>({
        doctype: '', // Empty - client mode
        columns: columns,
        fetchFields: [],
        searchableFields: PO_INVOICE_SEARCHABLE_FIELDS,
        clientData: invoiceEntries,
        clientTotalCount: invoiceEntries.length,
        urlSyncKey: vendorId ? `vendor_po_invoices_${vendorId}` : 'po_invoices',
        defaultSort: 'date desc',
    });

    // --- Facet Filter Options from Client Data ---
    const facetFilterOptions = useMemo(() => {
        const uniqueProjects = [...new Set(invoiceEntries.map((i: InvoiceItem) => i.project).filter(Boolean))];
        const uniqueUpdatedBy = [...new Set(invoiceEntries.map((i: InvoiceItem) => i.updated_by).filter(Boolean))];

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
                options: PO_INVOICE_2B_STATUS_OPTIONS
            }
        };

        // Only include vendor filter when not filtering by vendor
        if (!vendorId) {
            const uniqueVendors = [...new Set(invoiceEntries.map((i: InvoiceItem) => i.vendor).filter(Boolean))];
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
            <Card>
                <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-lg">
                        {vendorId ? "Vendor PO Invoices (Approved)" : "PO Invoices Summary (Approved)"}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-2">
                    <div className="grid grid-cols-3 gap-4">
                        <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                            <dt className="text-sm font-medium text-gray-600">Total Amount</dt>
                            <dd className="text-xl font-bold text-green-600 mt-1">
                                {formatToRoundedIndianRupee(totalAmount)}
                            </dd>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                            <dt className="text-sm font-medium text-gray-600">Total Invoices</dt>
                            <dd className="text-xl font-bold text-blue-600 mt-1">
                                {totalInvoices}
                            </dd>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-3 border border-purple-100">
                            <dt className="text-sm font-medium text-gray-600">2B Activation</dt>
                            <dd className="mt-1">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-lg font-bold text-purple-600">
                                        {total2bActivated}/{totalInvoices}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {pending2bActivation} pending
                                    </span>
                                </div>
                                <Progress value={activationProgress} className="h-2" />
                            </dd>
                        </div>
                    </div>
                    {hasFilters && (
                        <div className="flex flex-wrap gap-2 items-center pt-3 mt-3 border-t border-gray-100">
                            <span className="text-xs font-medium text-gray-500">Active filters:</span>
                            {searchTerm && (
                                <Badge variant="outline" className="text-xs bg-gray-100">
                                    Search: "{searchTerm}"
                                </Badge>
                            )}
                            {columnFilters.map(filter => (
                                <Badge key={filter.id} variant="outline" className="text-xs bg-blue-50 text-blue-700">
                                    {filter.id}
                                </Badge>
                            ))}
                        </div>
                    )}
                </CardContent>
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
            <DataTable<InvoiceItem>
                table={table}
                columns={columns}
                isLoading={tableLoading}
                error={tableError}
                totalCount={totalCount}
                searchFieldOptions={PO_INVOICE_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={PO_INVOICE_DATE_COLUMNS}
                showExportButton={true}
                onExport="default"
                exportFileName="po_invoices"
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

export default PoInvoices;
