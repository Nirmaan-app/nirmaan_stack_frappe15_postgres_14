import { ColumnDef } from "@tanstack/react-table";
import { PO2BReconcileRowData } from "../../hooks/usePO2BReconcileData";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { Info, Check, X, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import SITEURL from "@/constants/siteURL";

export const po2BReconcileColumns: ColumnDef<PO2BReconcileRowData>[] = [
    {
        accessorKey: "invoiceDate",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice Date" />,
        cell: ({ row }) => {
            const dateValue = row.original.invoiceDate?.slice(0, 10);
            return <div className="font-medium">{dateValue ? formatDate(dateValue) : '-'}</div>;
        },
        filterFn: dateFilterFn,
        size: 120,
        meta: {
            exportHeaderName: "Invoice Date",
            exportValue: (row: PO2BReconcileRowData) => row.invoiceDate ? formatDate(row.invoiceDate.slice(0, 10)) : '-',
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
            exportValue: (row: PO2BReconcileRowData) => row.invoiceNo,
        },
    },
    {
        accessorKey: "invoiceAmount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
        cell: ({ row }) => (
            <div className="font-medium text-green-600 tabular-nums">
                {formatToRoundedIndianRupee(row.original.invoiceAmount)}
            </div>
        ),
        size: 120,
        meta: {
            exportHeaderName: "Amount",
            exportValue: (row: PO2BReconcileRowData) => row.invoiceAmount,
            isNumeric: true,
        },
    },
    {
        accessorKey: "poId",
        header: ({ column }) => <DataTableColumnHeader column={column} title="PO ID" />,
        cell: ({ row }) => {
            const po = row.original.poId;
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
        meta: {
            exportHeaderName: "PO ID",
            exportValue: (row: PO2BReconcileRowData) => row.poId,
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
            exportValue: (row: PO2BReconcileRowData) => row.projectName || '-',
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
            exportValue: (row: PO2BReconcileRowData) => row.vendorName,
        },
    },
    {
        id: "is2bActivated",
        accessorFn: (row) => row.is2bActivated ? "Reconciled" : "Pending",
        header: ({ column }) => <DataTableColumnHeader column={column} title="2B Status" />,
        cell: ({ row }) => {
            const is2bActivated = row.original.is2bActivated;
            return (
                <div className="flex items-center">
                    {is2bActivated ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                            <Check className="w-3 h-3 mr-1" /> Reconciled
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-300">
                            <X className="w-3 h-3 mr-1" /> Pending
                        </Badge>
                    )}
                </div>
            );
        },
        filterFn: facetedFilterFn,
        size: 140,
        meta: {
            exportHeaderName: "2B Status",
            exportValue: (row: PO2BReconcileRowData) => row.is2bActivated ? "Reconciled" : "Pending",
        },
    },
    {
        accessorKey: "reconciledDate",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Reconciled Date" />,
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
            exportValue: (row: PO2BReconcileRowData) => row.reconciledDate ? formatDate(row.reconciledDate.slice(0, 10)) : '-',
        },
    },
    {
        id: "updatedByName",
        accessorFn: (row) => row.updatedByName,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Updated By" />,
        cell: ({ row }) => <div className="font-medium">{row.original.updatedByName}</div>,
        filterFn: facetedFilterFn,
        size: 150,
        meta: {
            exportHeaderName: "Updated By",
            exportValue: (row: PO2BReconcileRowData) => row.updatedByName,
        },
    },
    {
        id: "attachment",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Attachment" />,
        cell: ({ row }) => {
            const { attachmentUrl, invoiceNo } = row.original;
            if (!attachmentUrl) {
                return <span className="text-gray-400">-</span>;
            }
            return (
                <HoverCard>
                    <HoverCardTrigger asChild>
                        <button
                            onClick={() => window.open(SITEURL + attachmentUrl, "_blank")}
                            className="text-blue-500 hover:text-blue-700 cursor-pointer"
                        >
                            <FileText className="w-5 h-5" />
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
            );
        },
        enableSorting: false,
        size: 100,
        meta: {
            exportHeaderName: "Has Attachment",
            exportValue: (row: PO2BReconcileRowData) => row.attachmentUrl ? "Yes" : "No",
        },
    },
];
