import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { POAttachmentReconcileRowData, InvoiceHoverItem, AttachmentHoverItem } from "../../hooks/usePOAttachmentReconcileData";
import { formatToRoundedIndianRupee, formatForReport } from "@/utils/FormatPrice";
import { formatDate } from "@/utils/FormatDate";
import { Info, FileText, Truck, ClipboardCheck, X } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";
import SITEURL from "@/constants/siteURL";

// Helper component for Invoice Count with Popover
const InvoiceCountCell = ({ invoices, count }: { invoices: InvoiceHoverItem[]; count: number }) => {
    const [isOpen, setIsOpen] = useState(false);

    if (count === 0) {
        return <Badge variant="outline" className="text-gray-400">0</Badge>;
    }

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsOpen(!isOpen);
    };

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    onClick={handleClick}
                    className="inline-flex items-center rounded-full border border-blue-300 px-2.5 py-0.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 cursor-pointer"
                >
                    <FileText className="w-3 h-3 mr-1" />
                    {count}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] max-h-[60vh] overflow-auto p-0" align="start">
                {/* Sticky Header */}
                <div className="sticky top-0 bg-white z-20 flex justify-between items-center px-3 py-2 border-b">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-blue-600" />
                        Invoices ({count})
                    </h4>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 rounded-full hover:bg-gray-100"
                        onClick={() => setIsOpen(false)}
                        aria-label="Close"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <div className="p-2">
                    <Table>
                        <TableHeader className="bg-gray-50">
                            <TableRow>
                                <TableHead className="text-xs">Invoice No</TableHead>
                                <TableHead className="text-xs">Date</TableHead>
                                <TableHead className="text-xs text-right">Amount</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {invoices.map((inv, i) => (
                                <TableRow key={i}>
                                    <TableCell className="font-medium text-sm py-2">{inv.invoiceNo}</TableCell>
                                    <TableCell className="text-sm text-gray-600 py-2">{formatDate(inv.date.slice(0, 10))}</TableCell>
                                    <TableCell className="text-sm font-medium text-green-600 text-right py-2">
                                        {formatToRoundedIndianRupee(inv.amount)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </PopoverContent>
        </Popover>
    );
};

// Helper component for DC Count with Popover
const DCCountCell = ({ dcs, count }: { dcs: AttachmentHoverItem[]; count: number }) => {
    const [isOpen, setIsOpen] = useState(false);

    if (count === 0) {
        return <Badge variant="outline" className="text-gray-400">0</Badge>;
    }

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsOpen(!isOpen);
    };

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    onClick={handleClick}
                    className="inline-flex items-center rounded-full border border-amber-300 px-2.5 py-0.5 text-xs font-semibold text-amber-600 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 cursor-pointer"
                >
                    <Truck className="w-3 h-3 mr-1" />
                    {count}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-[350px] max-h-[60vh] overflow-auto p-0" align="start">
                {/* Sticky Header */}
                <div className="sticky top-0 bg-white z-20 flex justify-between items-center px-3 py-2 border-b">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5">
                        <Truck className="w-4 h-4 text-amber-600" />
                        Delivery Challans ({count})
                    </h4>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 rounded-full hover:bg-gray-100"
                        onClick={() => setIsOpen(false)}
                        aria-label="Close"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <div className="p-2">
                    <Table>
                        <TableHeader className="bg-gray-50">
                            <TableRow>
                                <TableHead className="text-xs">Uploaded On</TableHead>
                                <TableHead className="text-xs text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {dcs.map((dc, i) => (
                                <TableRow key={i}>
                                    <TableCell className="text-sm text-gray-600 py-2">{formatDate(dc.creation)}</TableCell>
                                    <TableCell className="text-right py-2">
                                        <Button
                                            variant="link"
                                            size="sm"
                                            className="h-auto p-0 text-blue-500 hover:text-blue-700"
                                            onClick={() => window.open(`${SITEURL}${dc.attachment}`, "_blank")}
                                        >
                                            View
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </PopoverContent>
        </Popover>
    );
};

// Helper component for MIR Count with Popover
const MIRCountCell = ({ mirs, count }: { mirs: AttachmentHoverItem[]; count: number }) => {
    const [isOpen, setIsOpen] = useState(false);

    if (count === 0) {
        return <Badge variant="outline" className="text-gray-400">0</Badge>;
    }

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsOpen(!isOpen);
    };

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    onClick={handleClick}
                    className="inline-flex items-center rounded-full border border-purple-300 px-2.5 py-0.5 text-xs font-semibold text-purple-600 hover:bg-purple-50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-1 cursor-pointer"
                >
                    <ClipboardCheck className="w-3 h-3 mr-1" />
                    {count}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-[350px] max-h-[60vh] overflow-auto p-0" align="start">
                {/* Sticky Header */}
                <div className="sticky top-0 bg-white z-20 flex justify-between items-center px-3 py-2 border-b">
                    <h4 className="font-semibold text-sm flex items-center gap-1.5">
                        <ClipboardCheck className="w-4 h-4 text-purple-600" />
                        Material Inspection Reports ({count})
                    </h4>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 rounded-full hover:bg-gray-100"
                        onClick={() => setIsOpen(false)}
                        aria-label="Close"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <div className="p-2">
                    <Table>
                        <TableHeader className="bg-gray-50">
                            <TableRow>
                                <TableHead className="text-xs">Uploaded On</TableHead>
                                <TableHead className="text-xs text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {mirs.map((mir, i) => (
                                <TableRow key={i}>
                                    <TableCell className="text-sm text-gray-600 py-2">{formatDate(mir.creation)}</TableCell>
                                    <TableCell className="text-right py-2">
                                        <Button
                                            variant="link"
                                            size="sm"
                                            className="h-auto p-0 text-blue-500 hover:text-blue-700"
                                            onClick={() => window.open(`${SITEURL}${mir.attachment}`, "_blank")}
                                        >
                                            View
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </PopoverContent>
        </Popover>
    );
};

export const poAttachmentReconcileColumns: ColumnDef<POAttachmentReconcileRowData>[] = [
    {
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="#PO" />,
        cell: ({ row }) => {
            const name = row.original.name;
            return (
                <div className="font-medium flex items-center gap-1">
                    <span>{name}</span>
                    <HoverCard>
                        <HoverCardTrigger asChild>
                            <Link to={`/project-payments/${name.replaceAll('/', "&=")}`}>
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
            exportHeaderName: "#PO",
            exportValue: (row: POAttachmentReconcileRowData) => row.name,
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
                    <span className="truncate max-w-[120px]">{vendorName}</span>
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
        size: 160,
        meta: {
            exportHeaderName: "Vendor",
            exportValue: (row: POAttachmentReconcileRowData) => row.vendorName,
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
                    <span className="truncate max-w-[120px]">{projectName || '-'}</span>
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
        size: 160,
        meta: {
            exportHeaderName: "Project",
            exportValue: (row: POAttachmentReconcileRowData) => row.projectName || '-',
        },
    },
    {
        id: "creation",
        accessorFn: (row) => row.creation,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Created On" />,
        cell: ({ row }) => {
            const date = row.original.creation;
            return <div className="font-medium">{date ? formatDate(date) : '-'}</div>;
        },
        filterFn: dateFilterFn,
        size: 120,
        meta: {
            exportHeaderName: "Created On",
            exportValue: (row: POAttachmentReconcileRowData) => row.creation ? formatDate(row.creation) : '-',
        },
    },
    {
        id: "latestDeliveryDate",
        accessorFn: (row) => row.latestDeliveryDate,
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title={
                <div className="text-left whitespace-normal">Latest Delivery</div>
            } />
        ),
        cell: ({ row }) => {
            const date = row.original.latestDeliveryDate;
            return <div className="font-medium">{date ? formatDate(date) : '-'}</div>;
        },
        filterFn: dateFilterFn,
        size: 120,
        meta: {
            exportHeaderName: "Latest Delivery Date",
            exportValue: (row: POAttachmentReconcileRowData) => row.latestDeliveryDate ? formatDate(row.latestDeliveryDate) : '-',
        },
    },
    {
        id: "status",
        accessorFn: (row) => row.status,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => {
            const status = row.original.status;
            return (
                <Badge
                    className={
                        status === "Delivered"
                            ? "bg-green-100 text-green-800 hover:bg-green-100"
                            : "bg-amber-100 text-amber-800 hover:bg-amber-100"
                    }
                >
                    {status}
                </Badge>
            );
        },
        filterFn: facetedFilterFn,
        size: 130,
        meta: {
            exportHeaderName: "Status",
            exportValue: (row: POAttachmentReconcileRowData) => row.status,
        },
    },
    {
        accessorKey: "totalPOAmount",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title={
                <div className="text-center whitespace-normal">Total PO Amt</div>
            } />
        ),
        cell: ({ row }) => (
            <div className="tabular-nums text-right">
                {formatToRoundedIndianRupee(row.original.totalPOAmount)}
            </div>
        ),
        size: 120,
        meta: {
            exportHeaderName: "Total PO Amt",
            exportValue: (row: POAttachmentReconcileRowData) => formatForReport(row.totalPOAmount),
            isNumeric: true,
        },
    },
    {
        accessorKey: "totalAmountPaid",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amt Paid" />,
        cell: ({ row }) => (
            <div className="tabular-nums text-right">
                {formatToRoundedIndianRupee(row.original.totalAmountPaid)}
            </div>
        ),
        size: 110,
        meta: {
            exportHeaderName: "Amt Paid",
            exportValue: (row: POAttachmentReconcileRowData) => formatForReport(row.totalAmountPaid),
            isNumeric: true,
        },
    },
    {
        accessorKey: "totalInvoiceAmount",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title={
                <div className="text-center whitespace-normal">Invoice Amt</div>
            } />
        ),
        cell: ({ row }) => (
            <div className="tabular-nums text-right">
                {formatToRoundedIndianRupee(row.original.totalInvoiceAmount)}
            </div>
        ),
        size: 110,
        meta: {
            exportHeaderName: "Invoice Amt",
            exportValue: (row: POAttachmentReconcileRowData) => formatForReport(row.totalInvoiceAmount),
            isNumeric: true,
        },
    },
    {
        accessorKey: "poAmountDelivered",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title={
                <div className="text-center whitespace-normal">Delivered Amt</div>
            } />
        ),
        cell: ({ row }) => (
            <div className="tabular-nums text-right">
                {formatToRoundedIndianRupee(row.original.poAmountDelivered)}
            </div>
        ),
        size: 110,
        meta: {
            exportHeaderName: "Delivered Amt",
            exportValue: (row: POAttachmentReconcileRowData) => formatForReport(row.poAmountDelivered),
            isNumeric: true,
        },
    },
    {
        id: "invoiceCount",
        accessorFn: (row) => row.invoiceCount,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Invoices" />,
        cell: ({ row }) => (
            <InvoiceCountCell invoices={row.original.invoices} count={row.original.invoiceCount} />
        ),
        size: 90,
        meta: {
            exportHeaderName: "Invoice Count",
            exportValue: (row: POAttachmentReconcileRowData) => row.invoiceCount.toString(),
        },
    },
    {
        id: "dcCount",
        accessorFn: (row) => row.dcCount,
        header: ({ column }) => <DataTableColumnHeader column={column} title="DCs" />,
        cell: ({ row }) => (
            <DCCountCell dcs={row.original.deliveryChallans} count={row.original.dcCount} />
        ),
        size: 80,
        meta: {
            exportHeaderName: "DC Count",
            exportValue: (row: POAttachmentReconcileRowData) => row.dcCount.toString(),
        },
    },
    {
        id: "mirCount",
        accessorFn: (row) => row.mirCount,
        header: ({ column }) => <DataTableColumnHeader column={column} title="MIRs" />,
        cell: ({ row }) => (
            <MIRCountCell mirs={row.original.mirs} count={row.original.mirCount} />
        ),
        size: 80,
        meta: {
            exportHeaderName: "MIR Count",
            exportValue: (row: POAttachmentReconcileRowData) => row.mirCount.toString(),
        },
    },
    // Hidden column for mismatch filtering (Invoice count ≠ DC count)
    {
        id: "isMismatched",
        accessorFn: (row) => row.invoiceCount !== row.dcCount ? "yes" : "no",
        header: () => null,
        cell: () => null,
        enableHiding: true,
        enableSorting: false,
        filterFn: facetedFilterFn,
        size: 0,
        meta: {
            hidden: true,
        },
    },
];
