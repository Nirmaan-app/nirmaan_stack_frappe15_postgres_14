import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, ExternalLink } from "lucide-react";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { DataTable } from "@/components/data-table/new-data-table";
import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useFrappeDeleteDoc } from "frappe-react-sdk";
import { toast } from "@/components/ui/use-toast";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HelpRepository } from "@/types/NirmaanStack/HelpRepository";
import { AddHelpDialog } from "./AddHelpDialog";
import { EditHelpDialog } from "./EditHelpDialog";

const HelpDataTableWrapper: React.FC<{
    columns: ColumnDef<HelpRepository>[];
    searchableFields: { label: string; value: string }[];
    refetchRef: React.MutableRefObject<(() => void) | null>;
}> = ({ columns, searchableFields, refetchRef }) => {
    const {
        table,
        totalCount,
        isLoading,
        error: tableError,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        refetch,
    } = useServerDataTable<HelpRepository>({
        doctype: "Help Repository",
        columns,
        fetchFields: ["name", "title", "description", "video_link", "creation"],
        defaultSort: "creation desc",
        searchableFields,
        urlSyncKey: "help_repository",
    });

    React.useEffect(() => {
        refetchRef.current = refetch;
    }, [refetch, refetchRef]);

    return (
        <DataTable
            table={table}
            columns={columns}
            isLoading={isLoading}
            error={tableError}
            totalCount={totalCount}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            searchFieldOptions={searchableFields}
            selectedSearchField={selectedSearchField}
            onSelectedSearchFieldChange={setSelectedSearchField}
        />
    );
};

export const HelpManageTab: React.FC = () => {
    const [editItem, setEditItem] = useState<HelpRepository | null>(null);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [deleteItem, setDeleteItem] = useState<HelpRepository | null>(null);
    const { deleteDoc, loading: deleting } = useFrappeDeleteDoc();
    const tableRefetchRef = React.useRef<(() => void) | null>(null);

    const handleRefetch = () => {
        tableRefetchRef.current?.();
    };

    const handleDelete = async () => {
        if (!deleteItem) return;
        try {
            await deleteDoc("Help Repository", deleteItem.name);
            toast({ title: "Success", description: "Help article deleted", variant: "success" });
            handleRefetch();
        } catch (e) {
            console.error("Delete error:", e);
            toast({ title: "Error", description: "Failed to delete article", variant: "destructive" });
        } finally {
            setDeleteItem(null);
        }
    };

    const columns = useMemo<ColumnDef<HelpRepository>[]>(() => [
        {
            accessorKey: "title",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("title")}</div>,
        },
        {
            accessorKey: "description",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
            cell: ({ row }) => (
                <div className="truncate max-w-[300px] text-gray-600" title={row.getValue("description")}>
                    {row.getValue("description") || "--"}
                </div>
            ),
        },
        {
            accessorKey: "video_link",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Video Link" />,
            cell: ({ row }) => {
                const url = row.getValue("video_link") as string;
                return (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2"
                        onClick={() => window.open(url, "_blank")}
                    >
                        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                        Open
                    </Button>
                );
            },
        },
        {
            id: "actions",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Actions" />,
            cell: ({ row }) => (
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-600 hover:text-blue-600"
                        onClick={() => {
                            setEditItem(row.original);
                            setIsEditOpen(true);
                        }}
                        title="Edit"
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-600 hover:text-red-600"
                        onClick={() => setDeleteItem(row.original)}
                        title="Delete"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ),
        },
    ], []);

    const searchableFields = [
        { label: "Title", value: "title" },
        { label: "Description", value: "description" },
    ];

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <AddHelpDialog onSuccess={handleRefetch} />
            </div>

            <HelpDataTableWrapper
                columns={columns}
                searchableFields={searchableFields}
                refetchRef={tableRefetchRef}
            />

            <EditHelpDialog
                open={isEditOpen}
                onOpenChange={setIsEditOpen}
                item={editItem}
                onSuccess={() => {
                    handleRefetch();
                    setEditItem(null);
                }}
            />

            <AlertDialog open={!!deleteItem} onOpenChange={(open) => !open && setDeleteItem(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete help article?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete "{deleteItem?.title}". This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                            {deleting ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
