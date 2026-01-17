import { ColumnDef } from "@tanstack/react-table";
import { SR2BReconcileRowData } from "../../hooks/useSR2BReconcileData";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { Info, CircleCheck, CircleDashed, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import SITEURL from "@/constants/siteURL";

export const sr2BReconcileColumns: ColumnDef<SR2BReconcileRowData>[] = [
    {
        accessorKey: "invoiceDate",
        header: ({ column }) => <DataTableColumnHeader column={column} title={<span className="whitespace-normal leading-tight">Invoice Date</span>} />,
        cell: ({ row }) => {
            const dateValue = row.original.invoiceDate?.slice(0, 10);
            return <div className="font-medium">{dateValue ? formatDate(dateValue) : '-'}</div>;
        },
        filterFn: dateFilterFn,
        size: 120,
        meta: {
            exportHeaderName: "Invoice Date",
            exportValue: (row: SR2BReconcileRowData) => row.invoiceDate ? formatDate(row.invoiceDate.slice(0, 10)) : '-',
        },
    },
    {
        accessorKey: "invoiceNo",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice No" />,
        cell: ({ row }) => {
            const { invoiceNo, attachmentUrl } = row.original;
            return (
                <div className="font-medium">
                    {attachmentUrl ? (
                        <HoverCard>
                            <HoverCardTrigger>
                                <span
                                    onClick={() => window.open(SITEURL + attachmentUrl, "_blank")}
                                    className="text-blue-500 underline cursor-pointer"
                                >
                                    {invoiceNo}
                                </span>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-auto rounded-md shadow-lg">
                                <img
                                    src={`${SITEURL}${attachmentUrl}`}
                                    alt={`Invoice ${invoiceNo}`}
                                    className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
                                />
                            </HoverCardContent>
                        </HoverCard>
                    ) : (
                        invoiceNo
                    )}
                </div>
            );
        },
        size: 150,
        meta: {
            exportHeaderName: "Invoice No",
            exportValue: (row: SR2BReconcileRowData) => row.invoiceNo,
        },
    },
    {
        id: "updatedByName",
        accessorFn: (row) => row.updatedByName,
        header: ({ column }) => <DataTableColumnHeader column={column} title={<span className="whitespace-normal leading-tight">Invoice Uploaded By</span>} />,
        cell: ({ row }) => <div className="font-medium">{row.original.updatedByName}</div>,
        filterFn: facetedFilterFn,
        size: 150,
        meta: {
            exportHeaderName: "Invoice Uploaded By",
            exportValue: (row: SR2BReconcileRowData) => row.updatedByName,
        },
    },
    {
        accessorKey: "invoiceAmount",
        header: ({ column }) => <DataTableColumnHeader column={column} title={<span className="whitespace-normal leading-tight">Invoice Amount</span>} />,
        cell: ({ row }) => (
            <div className="font-medium text-green-600 tabular-nums">
                {formatToRoundedIndianRupee(row.original.invoiceAmount)}
            </div>
        ),
        size: 120,
        meta: {
            exportHeaderName: "Invoice Amount",
            exportValue: (row: SR2BReconcileRowData) => row.invoiceAmount,
            isNumeric: true,
        },
    },
    {
        accessorKey: "reconciledAmount",
        header: ({ column }) => (
            <DataTableColumnHeader
                column={column}
                title={<span className="whitespace-normal leading-tight">Reconciled Amount</span>}
            />
        ),
        cell: ({ row }) => {
            const reconciledAmount = row.original.reconciledAmount ?? 0;
            const invoiceAmount = row.original.invoiceAmount;

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
                <div className={`font-medium tabular-nums ${colorClass}`}>
                    {formatToRoundedIndianRupee(reconciledAmount)}
                </div>
            );
        },
        size: 130,
        meta: {
            exportHeaderName: "Reconciled Amount",
            exportValue: (row: SR2BReconcileRowData) => row.reconciledAmount ?? 0,
            isNumeric: true,
        },
    },
    {
        accessorKey: "srId",
        header: ({ column }) => <DataTableColumnHeader column={column} title="WO ID" />,
        cell: ({ row }) => {
            const sr = row.original.srId;
            return (
                <div className="font-medium flex items-center gap-1">
                    <span>{sr}</span>
                    <HoverCard>
                        <HoverCardTrigger asChild>
                            <Link to={`/project-payments/${sr.replaceAll('/', "&=")}`}>
                                <Info className="w-4 h-4 text-blue-600 cursor-pointer" />
                            </Link>
                        </HoverCardTrigger>
                        <HoverCardContent className="text-xs w-auto p-1.5">
                            View WO Details
                        </HoverCardContent>
                    </HoverCard>
                </div>
            );
        },
        size: 180,
        meta: {
            exportHeaderName: "WO ID",
            exportValue: (row: SR2BReconcileRowData) => row.srId,
        },
    },
    {
        id: "projectName",
        accessorFn: (row) => row.projectName,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
        cell: ({ row }) => {
            const { projectId, projectName } = row.original;
            return (
                <div className="font-medium flex items-center gap-1">
                    <span className="truncate max-w-[150px]">{projectName || '-'}</span>
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
        filterFn: facetedFilterFn,
        size: 200,
        meta: {
            exportHeaderName: "Project",
            exportValue: (row: SR2BReconcileRowData) => row.projectName || '-',
        },
    },
    {
        id: "vendorName",
        accessorFn: (row) => row.vendorName,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
        cell: ({ row }) => {
            const { vendorId, vendorName } = row.original;
            return (
                <div className="font-medium flex items-center gap-1">
                    <span className="truncate max-w-[150px]">{vendorName}</span>
                    <HoverCard>
                        <HoverCardTrigger asChild>
                            <Link to={`/vendors/${vendorId}`}>
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
        filterFn: facetedFilterFn,
        size: 200,
        meta: {
            exportHeaderName: "Vendor",
            exportValue: (row: SR2BReconcileRowData) => row.vendorName,
        },
    },
    {
        id: "is2bActivated",
        accessorFn: (row) => {
            // Map reconciliationStatus to display values for filtering
            switch (row.reconciliationStatus) {
                case "full": return "Full";
                case "partial": return "Partial";
                default: return "None";
            }
        },
        header: ({ column }) => <DataTableColumnHeader column={column} title={<span className="whitespace-normal leading-tight">Reconciled Status</span>} />,
        cell: ({ row }) => {
            const reconciliationStatus = row.original.reconciliationStatus || "";

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
                    default:
                        return (
                            <Badge variant="outline" className="text-gray-500">
                                None
                            </Badge>
                        );
                }
            };

            return <div className="flex items-center">{getStatusBadge()}</div>;
        },
        filterFn: facetedFilterFn,
        size: 140,
        meta: {
            exportHeaderName: "Reconciled Status",
            exportValue: (row: SR2BReconcileRowData) => {
                switch (row.reconciliationStatus) {
                    case "full": return "Full";
                    case "partial": return "Partial";
                    default: return "None";
                }
            },
        },
    },
    {
        id: "reconciledByName",
        accessorFn: (row) => row.reconciledByName,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Reconciled By" />,
        cell: ({ row }) => {
            const reconciledByName = row.original.reconciledByName;
            if (!reconciledByName) {
                return <span className="text-gray-400">-</span>;
            }
            return <div className="font-medium">{reconciledByName}</div>;
        },
        filterFn: facetedFilterFn,
        size: 150,
        meta: {
            exportHeaderName: "Reconciled By",
            exportValue: (row: SR2BReconcileRowData) => row.reconciledByName || '-',
        },
    },
    {
        accessorKey: "reconciledDate",
        header: ({ column }) => <DataTableColumnHeader column={column} title={<span className="whitespace-normal leading-tight">Reconciled Date</span>} />,
        cell: ({ row }) => {
            const reconciledDate = row.original.reconciledDate;
            if (!reconciledDate) {
                return <span className="text-gray-400">-</span>;
            }
            return (
                <div className="font-medium text-sm">
                    {formatDate(reconciledDate.slice(0, 10))}
                </div>
            );
        },
        filterFn: dateFilterFn,
        size: 140,
        meta: {
            exportHeaderName: "Reconciled Date",
            exportValue: (row: SR2BReconcileRowData) => row.reconciledDate ? formatDate(row.reconciledDate.slice(0, 10)) : '-',
        },
    },
    {
        id: "attachments",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Attachments" />,
        cell: ({ row }) => {
            const { attachmentUrl, proofAttachmentUrl, invoiceNo } = row.original;
            const hasInvoice = !!attachmentUrl;
            const hasProof = !!proofAttachmentUrl;

            if (!hasInvoice && !hasProof) {
                return <span className="text-gray-400">-</span>;
            }

            return (
                <div className="flex items-center gap-2">
                    {hasInvoice && (
                        <HoverCard>
                            <HoverCardTrigger asChild>
                                <button
                                    onClick={() => window.open(SITEURL + attachmentUrl, "_blank")}
                                    className="text-blue-500 hover:text-blue-700 cursor-pointer flex items-center gap-0.5"
                                    title="Invoice"
                                >
                                    <FileText className="w-4 h-4" />
                                    <span className="text-[10px]">Inv</span>
                                </button>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-auto rounded-md shadow-lg">
                                <img
                                    src={`${SITEURL}${attachmentUrl}`}
                                    alt={`Invoice ${invoiceNo}`}
                                    className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
                                />
                            </HoverCardContent>
                        </HoverCard>
                    )}
                    {hasProof && (
                        <HoverCard>
                            <HoverCardTrigger asChild>
                                <button
                                    onClick={() => window.open(SITEURL + proofAttachmentUrl, "_blank")}
                                    className="text-green-500 hover:text-green-700 cursor-pointer flex items-center gap-0.5"
                                    title="Reconciliation Proof"
                                >
                                    <FileText className="w-4 h-4" />
                                    <span className="text-[10px]">Proof</span>
                                </button>
                            </HoverCardTrigger>
                            <HoverCardContent className="w-auto rounded-md shadow-lg">
                                <img
                                    src={`${SITEURL}${proofAttachmentUrl}`}
                                    alt={`Proof for ${invoiceNo}`}
                                    className="max-w-xs max-h-64 object-contain rounded-md shadow-md"
                                />
                            </HoverCardContent>
                        </HoverCard>
                    )}
                </div>
            );
        },
        enableSorting: false,
        size: 120,
        meta: {
            exportHeaderName: "Has Attachments",
            exportValue: (row: SR2BReconcileRowData) => {
                const parts = [];
                if (row.attachmentUrl) parts.push("Invoice");
                if (row.proofAttachmentUrl) parts.push("Proof");
                return parts.length > 0 ? parts.join(", ") : "No";
            },
        },
    },
];
