import React, { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { DataTable } from "@/components/data-table/new-data-table";
import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { toast } from "@/components/ui/use-toast";
import { TDSItem } from "./components/types";
import { AddTDSItemDialog } from "./components/AddTDSItemDialog";
import { EditTDSItemDialog } from "./components/EditTDSItemDialog";
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

export const TDSRepositoryMaster: React.FC = () => {
    const doctype = "TDS Repository";
    const [editItem, setEditItem] = useState<TDSItem | null>(null);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [deleteItem, setDeleteItem] = useState<TDSItem | null>(null);
    const { deleteDoc, loading: deleting } = useFrappeDeleteDoc();

    const handleDelete = async () => {
        if (!deleteItem) return;
        try {
            await deleteDoc("TDS Repository", deleteItem.name);
            toast({ title: "Success", description: "Item deleted successfully", variant: "success" });
            refetch();
        } catch (e) {
            console.error("Delete error:", e);
            toast({ title: "Error", description: "Failed to delete item", variant: "destructive" });
        } finally {
            setDeleteItem(null);
        }
    };

    // --- Columns Definition ---
    const columns = useMemo<ColumnDef<TDSItem>[]>(() => [
        {
            accessorKey: "name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>,
            enableColumnFilter: true, 
        },
        {
            accessorKey: "work_package",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Work Package" />,
            cell: ({ row }) => <div className="font-medium mx-auto">{row.getValue("work_package")}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome", 
        },
        {
            accessorKey: "category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => <div>{row.getValue("category")}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome",
        },
        {
            // id: "item_name",
             accessorKey: "tds_item_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Item Name" />,

            // accessorFn: (row) => row["tds_item_name.item_name"] || row.tds_item_name,
            // header: ({ column }) => <DataTableColumnHeader column={column} title="Item Name" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("tds_item_name")}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome",
        },
        {
            accessorKey: "description",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
            cell: ({ row }) => (
                <div className="truncate max-w-[300px]" title={row.getValue("description")}>
                    {row.getValue("description")}
                </div>
            ),
        },
        {
            accessorKey: "make",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Make" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("make")}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome",
        },
        {
            accessorKey: "tds_attachment",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Doc" />,
            cell: ({ row }) => {
                const docUrl = row.getValue("tds_attachment") as string;
                if (!docUrl) return null;
                const fileName = docUrl.split("/").pop();
                return (
                    <div className="flex justify-start">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                            onClick={() => window.open(docUrl, "_blank")}
                            title={fileName}
                        >
                            <FileText className="h-4 w-4" />
                        </Button>
                    </div>
                );
            },
        },
        {
            id: "actions",
            meta: { excludeFromExport: true }, // Exclude from export
            header: ({ column }) => <DataTableColumnHeader column={column} title="Actions" />,
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-600 hover:text-blue-600"
                        onClick={() => {
                            setEditItem(row.original);
                            setIsEditOpen(true);
                        }}
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-600 hover:text-red-600"
                        onClick={() => setDeleteItem(row.original)}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            )
        }
    ], []);

    // --- Fetch Options for Faceted Filters ---
    const { data: wpList } = useFrappeGetDocList("Procurement Packages", {
        fields: ["name", "work_package_name"],
        limit: 1000,
    });
    const wpOptions = useMemo(() => wpList?.map(d => ({ label: d.work_package_name, value: d.name })) || [], [wpList]);

    const { data: catList } = useFrappeGetDocList("Category", {
        fields: ["name", "category_name"],
        limit: 1000,
    });
    const catOptions = useMemo(() => catList?.map(d => ({ label: d.category_name, value: d.name })) || [], [catList]);

    const { data: makeList } = useFrappeGetDocList("Makelist", {
        fields: ["name", "make_name"],
        limit: 1000,
    });
    const makeOptions = useMemo(() => makeList?.map(d => ({ label: d.make_name, value: d.name })) || [], [makeList]);

    const facetFilterOptions = useMemo(() => ({
        work_package: { title: "Work Package", options: wpOptions },
        category: { title: "Category", options: catOptions },
        make: { title: "Make", options: makeOptions },
    }), [wpOptions, catOptions, makeOptions]);

    const searchableFields = [
        { label: "Item Name", value: "tds_item_name" }, 
        { label: "Description", value: "description" },
        { label: "Make", value: "make" }
    ];

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
    } = useServerDataTable<TDSItem>({
        doctype,
        columns,
        fetchFields: ["name", "work_package", "category", "tds_item_id", "tds_item_name", "description", "make", "tds_attachment", "creation"],
        defaultSort: "creation desc",
        searchableFields: searchableFields,
    });

    const handleEditSuccess = () => {
        refetch();
        setEditItem(null);
    };

    return (
        <div className="flex-1 space-y-6 p-4 md:p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-gray-800">TDS Repository</h2>
                </div>
                <div className="flex items-center gap-2">
                    <AddTDSItemDialog onSuccess={() => refetch()} />
                </div>
            </div>

            <Separator />

            <DataTable
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={tableError}
                totalCount={totalCount}
                facetFilterOptions={facetFilterOptions}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                searchFieldOptions={searchableFields}
                selectedSearchField={selectedSearchField}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                showExportButton={true}
                onExport="default"
                exportFileName="TDS_Repository_Data"
            />

            <EditTDSItemDialog 
                open={isEditOpen} 
                onOpenChange={setIsEditOpen} 
                item={editItem} 
                onSuccess={handleEditSuccess} 
            />

            <AlertDialog open={!!deleteItem} onOpenChange={(open) => !open && setDeleteItem(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the TDS Item.
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

export default TDSRepositoryMaster;
