import React, { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { useServerDataTable } from "@/hooks/useServerDataTable";
import { DataTable } from "@/components/data-table/new-data-table";
import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useFrappeDeleteDoc } from "frappe-react-sdk";
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
import { useFacetValues } from "@/hooks/useFacetValues";
import { useUserData } from "@/hooks/useUserData";

// --- Wrapper Component for Dynamic Facets ---
const TDSDataTableWrapper: React.FC<{
    doctype: string;
    columns: ColumnDef<TDSItem>[];
    searchableFields: any[];
    onEdit: (item: TDSItem) => void;
    onDelete: (item: TDSItem) => void;
    refetchRef: React.MutableRefObject<(() => void) | null>;
}> = ({ doctype, columns, searchableFields, onEdit, onDelete, refetchRef }) => {

    const {
        table,
        totalCount,
        isLoading,
        error: tableError,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        columnFilters,
        refetch,
    } = useServerDataTable<TDSItem>({
        doctype,
        columns,
        fetchFields: ["name", "work_package", "category", "tds_item_id", "tds_item_name", "description", "make", "tds_attachment", "creation"],
        defaultSort: "creation desc",
        searchableFields: searchableFields,
        urlSyncKey: "tds_repository_master", // Enable URL sync
    });

    // Expose refetch function to parent
    React.useEffect(() => {
        refetchRef.current = refetch;
    }, [refetch, refetchRef]);


    // --- Dynamic Facet Hooks ---
    const { facetOptions: wpFacetOptions, isLoading: isWPLoading } = useFacetValues({
        doctype,
        field: "work_package",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
    });

    const { facetOptions: catFacetOptions, isLoading: isCatLoading } = useFacetValues({
        doctype,
        field: "category",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
    });

    const { facetOptions: itemFacetOptions, isLoading: isItemLoading } = useFacetValues({
        doctype,
        field: "tds_item_name",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
    });

    const { facetOptions: makeFacetOptions, isLoading: isMakeLoading } = useFacetValues({
        doctype,
        field: "make",
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
    });

    // Combined Facet Options
    const facetFilterOptions = useMemo(() => ({
        work_package: { title: "Work Package", options: wpFacetOptions, isLoading: isWPLoading },
        category: { title: "Category", options: catFacetOptions, isLoading: isCatLoading },
        tds_item_name: { title: "Item Name", options: itemFacetOptions, isLoading: isItemLoading },
        make: { title: "Make", options: makeFacetOptions, isLoading: isMakeLoading },
    }), [wpFacetOptions, isWPLoading, catFacetOptions, isCatLoading, itemFacetOptions, isItemLoading, makeFacetOptions, isMakeLoading]);


    return (
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
            onSelectedSearchFieldChange={setSelectedSearchField}
            showExportButton={true}
            onExport="default"
            exportFileName="TDS_Repository_Data"
        />
    );
};

export const TDSRepositoryMaster: React.FC = () => {
    const doctype = "TDS Repository";
    const [editItem, setEditItem] = useState<TDSItem | null>(null);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [deleteItem, setDeleteItem] = useState<TDSItem | null>(null);
    const { deleteDoc, loading: deleting } = useFrappeDeleteDoc();
    const { role } = useUserData();

    // isPermission = true for roles NOT in this list (e.g., Nirmaan Admin Profile has edit rights)
    const isPermission = !["Nirmaan HR Executive Profile", "Nirmaan Accountant Profile", "Nirmaan Design Executive Profile", "Nirmaan Project Manager Profile"].includes(role);

    //  console.log("role",isPermission,role)



    // Ref to hold the refetch function from the datatable wrapper
    const tableRefetchRef = React.useRef<(() => void) | null>(null);

    const handleRefetch = () => {
        if (tableRefetchRef.current) {
            tableRefetchRef.current();
        }
    };

    const handleDelete = async () => {
        if (!deleteItem) return;
        try {
            await deleteDoc("TDS Repository", deleteItem.name);
            toast({ title: "Success", description: "Item deleted successfully", variant: "success" });
            handleRefetch();
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
            accessorKey: "tds_item_id",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Item ID" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("tds_item_id")}</div>,
            enableColumnFilter: true, 
        },
        {
            accessorKey: "work_package",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Work Package" />,
            cell: ({ row }) => <div className="font-medium mx-auto">{row.getValue("work_package")}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome", 
            meta: { enableFacet: true, facetTitle: "Work Package" }
        },
        {
            accessorKey: "category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => <div>{row.getValue("category")}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome",
            meta: { enableFacet: true, facetTitle: "Category" }
        },
        {
             accessorKey: "tds_item_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Item Name" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("tds_item_name")}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome",
            meta: { enableFacet: true, facetTitle: "Item Name" }
        },
        {
            accessorKey: "description",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
            cell: ({ row }) => (
                <div className="truncate max-w-[300px]" title={row.getValue("description")}>
                    {row.getValue("description") || "--"}
                </div>
            ),
        },
        {
            accessorKey: "make",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Make" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("make")}</div>,
            enableColumnFilter: true,
            filterFn: "arrIncludesSome",
            meta: { enableFacet: true, facetTitle: "Make" }
        },
        {
            accessorKey: "tds_attachment",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Doc" />,
            cell: ({ row }) => {
                const docUrl = row.getValue("tds_attachment") as string;
                const fileName = docUrl ? docUrl.split("/").pop() : "";
                
                return (
                    <div className="flex justify-start">
                        <Button
                            variant="ghost"
                            size="icon"
                            className={`h-8 w-8 ${docUrl ? "text-blue-600 hover:text-blue-800 hover:bg-blue-50" : "text-gray-300 cursor-not-allowed"}`}
                            onClick={() => docUrl && window.open(docUrl, "_blank")}
                            title={docUrl ? fileName : "No Attachment"}
                            disabled={!docUrl}
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
                        className={`h-8 w-8 text-gray-600 ${isPermission ? "hover:text-blue-600" : "opacity-50 cursor-not-allowed"}`}
                        onClick={() => {
                            if (isPermission) {
                                setEditItem(row.original);
                                setIsEditOpen(true);
                            }
                        }}
                        // disabled={!isPermission}
                        title={ "Edit Item"}
                    >
                        <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={`h-8 w-8 text-gray-600 ${isPermission ? "hover:text-red-600" : "opacity-50 cursor-not-allowed"}`}
                        onClick={() => {
                            if (isPermission) {
                                setDeleteItem(row.original);
                            }
                        }}
                        disabled={!isPermission}
                        title={!isPermission ? "Only Admin can delete" : "Delete Item"}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            )
        }
    ], [isPermission]);

    const searchableFields = [
        { label: "Item Name", value: "tds_item_name" }, 
        { label: "Description", value: "description" },
        { label: "Make", value: "make" }
    ];

    const handleEditSuccess = () => {
        handleRefetch();
        setEditItem(null);
    };

    return (
        <div className="flex-1 space-y-6 p-4 md:p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-gray-800">TDS Repository</h2>
                </div>
                <div className="flex items-center gap-2">
                    <AddTDSItemDialog onSuccess={() => handleRefetch()} />
                </div>
            </div>

            <Separator />

            <TDSDataTableWrapper 
                doctype={doctype}
                columns={columns}
                searchableFields={searchableFields}
                onEdit={(item) => {
                    setEditItem(item);
                    setIsEditOpen(true);
                }}
                onDelete={setDeleteItem}
                refetchRef={tableRefetchRef}
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
