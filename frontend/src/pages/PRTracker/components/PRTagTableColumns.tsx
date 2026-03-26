import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { CriticalPRTag } from "../types";
import { CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

// Custom filter function for faceted (multi-select) filters
const facetedFilterFn = (row: any, columnId: string, filterValue: string[]) => {
    if (!filterValue || filterValue.length === 0) return true;
    const cellValue = row.getValue(columnId);
    return filterValue.includes(cellValue);
};

export const getPRTagTableColumns = (projectId: string): ColumnDef<CriticalPRTag>[] => {
    return [
        {
            accessorKey: "header",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Headers" />,
            cell: ({ row }) => (
                <Badge variant="outline" className="text-xs truncate max-w-[150px]">
                    {row.original.header}
                </Badge>
            ),
            enableColumnFilter: true,
            filterFn: facetedFilterFn,
            size: 150,
        },
        {
            accessorKey: "name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Tag Name" />,
            cell: ({ row }) => (
                <span className="font-medium text-gray-900 text-xs truncate block max-w-[200px]">
                    {row.original.name}
                </span>
            ),
            size: 200,
        },
        {
            accessorKey: "package",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Package" />,
            cell: ({ row }) => (
                <span className="text-xs text-gray-500 truncate block max-w-[150px]">
                    {row.original.package || "--"}
                </span>
            ),
            enableColumnFilter: true,
            filterFn: facetedFilterFn,
            size: 150,
        },
        {
            accessorKey: "associated_prs",
            header: () => <div className="text-center w-full text-[10px] text-gray-500 uppercase font-bold tracking-wider">Linked PRs</div>,
            accessorFn: (row) => {
                const prsRaw = row.associated_prs;
                const prs = typeof prsRaw === "string" 
                    ? JSON.parse(prsRaw || '{"prs":[]}').prs 
                    : prsRaw?.prs;
                return prs?.length > 0 ? prs.map((pr: string) => `• ${pr}`).join("\n") : "";
            },
            cell: ({ row }) => {
                const prsRaw = row.original.associated_prs;
                const prs = typeof prsRaw === "string" 
                    ? JSON.parse(prsRaw || '{"prs":[]}').prs 
                    : prsRaw?.prs;
                const count = prs?.length || 0;

                if (count === 0) {
                    return <span className="text-xs text-gray-400 text-center block w-full">--</span>;
                }

                return (
                    <div className="flex items-center justify-center w-full">
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="h-6 text-[10px] px-2 py-0.5 hover:bg-blue-100 transition-colors"
                            >
                                {count} PR{count > 1 ? "s" : ""}
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle className="text-base text-gray-900 font-semibold">
                                    Linked Procurement Requests
                                </DialogTitle>
                                <p className="text-sm text-gray-500 mt-1">
                                    {row.original.name}
                                </p>
                            </DialogHeader>
                            <div className="space-y-2 mt-4 max-h-[300px] overflow-y-auto pr-1">
                                {prs.map((pr: string) => (
                                    <Link
                                        key={pr}
                                        to={`/projects/${projectId}/${pr}`}
                                        className="flex items-center gap-3 text-sm text-blue-600 hover:text-blue-800 py-2.5 px-3 rounded-md hover:bg-blue-50 border border-gray-100 transition-all font-medium"
                                    >
                                        <ExternalLink className="h-4 w-4 flex-shrink-0" />
                                        <span>{pr}</span>
                                    </Link>
                                ))}
                            </div>
                        </DialogContent>
                    </Dialog>
                    </div>
                );
            },
            size: 150,
        }
    ];
};
