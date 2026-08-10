import React, { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { useFrappeGetDocList } from "frappe-react-sdk";

import { DataTable } from "@/components/data-table/new-data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { FacetDeclaration } from "@/components/data-table/facetConfig";
import { Badge } from "@/components/ui/badge";
import { FilePenLine } from "lucide-react";

import { useServerDataTable } from "@/hooks/useServerDataTable";
import { Items as ItemsType } from "@/types/NirmaanStack/Items";

import { EditItemDialog } from "@/pages/Items/components/EditItemDialog";
import {
    ITEM_DOCTYPE,
    ITEM_LIST_FIELDS_TO_FETCH,
    ITEM_SEARCHABLE_FIELDS,
    ITEM_DATE_COLUMNS,
} from "@/pages/Items/items.constants";

// ─────────────────────────────────────────────────────────────────────────────
// Items SKU tab — an embedded, focused mirror of the Items master table for the
// TDS Repository curation hub (ADR-0004). An admin sees all catalog SKUs
// (including untagged ones via the "Not Linked" facet bucket) and links /
// changes / unlinks the `linked_tds_item` group inline via the shared
// EditItemDialog — without leaving the page.
//
// NOT a route: no page header / p-6 shell (it renders inside the tab area).
// Reuses Items' constants + EditItemDialog verbatim. The ID column is plain text
// (no router <Link> — a relative link would resolve under /tds).
//
// SWR keys and `urlSyncKey` are suffixed so this table and the Items page table
// never collide in cache or in the URL.
//
// Facets use the SELF-FETCHING path (ADR-0010 Option 2): declared on the column
// via `meta.facet` + the `facetDoctype` prop, NOT a page-level `useFacetValues` +
// `facetFilterOptions` memo (that legacy path is dual-supported but slated for
// sunset). Group-id -> group-name resolution happens SERVER-side via the
// `LINK_FIELD_MAP` entry for `linked_tds_item`, so nothing here re-maps labels.
// ─────────────────────────────────────────────────────────────────────────────

interface ItemsSKUTabProps {
    isAdmin: boolean;
}

export const ItemsSKUTab: React.FC<ItemsSKUTabProps> = ({ isAdmin }) => {
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editItem, setEditItem] = useState<ItemsType | null>(null);

    // Label map for the Linked TDS Item CELL only. (The FACET's labels are
    // resolved server-side — see the LINK_FIELD_MAP note above.)
    const { data: tdsItemList } = useFrappeGetDocList<{
        name: string;
        tds_item_name?: string;
    }>(
        "TDS Items",
        { fields: ["name", "tds_item_name"], limit: 0 },
        "tds_items_label_map_for_tds_sku_tab"
    );

    const tdsItemLabelMap = useMemo(() => {
        const map: Record<string, string> = {};
        (tdsItemList || []).forEach((t) => {
            map[t.name] = t.tds_item_name || t.name;
        });
        return map;
    }, [tdsItemList]);

    const columns = useMemo<ColumnDef<ItemsType>[]>(() => {
        const baseColumns: ColumnDef<ItemsType>[] = [
            {
                accessorKey: "name",
                header: ({ column }) => (
                    <DataTableColumnHeader column={column} title="ID" />
                ),
                cell: ({ row }) => (
                    <span className="font-mono text-xs whitespace-nowrap">
                        {row.original.name}
                    </span>
                ),
                size: 200,
                meta: {
                    exportHeaderName: "ID",
                    exportValue: (row: ItemsType) => row.name,
                },
            },
            {
                accessorKey: "item_name",
                header: ({ column }) => (
                    <DataTableColumnHeader column={column} title="Product Name" />
                ),
                cell: ({ row }) => {
                    const itemName = row.getValue<string>("item_name");
                    const makeName = row.original.make_name;
                    return (
                        <div className="font-medium">
                            {makeName ? `${itemName} - ${makeName}` : itemName}
                        </div>
                    );
                },
                size: 300,
                meta: {
                    exportHeaderName: "Product Name",
                    exportValue: (row: ItemsType) => {
                        const itemName = row.item_name;
                        const makeName = row.make_name;
                        return makeName ? `${itemName} - ${makeName}` : itemName;
                    },
                },
            },
            {
                accessorKey: "category",
                header: ({ column }) => (
                    <DataTableColumnHeader column={column} title="Category" />
                ),
                cell: ({ row }) => (
                    <Badge variant="outline">
                        {row.getValue<string>("category") || "N/A"}
                    </Badge>
                ),
                enableColumnFilter: true,
                size: 220,
                meta: {
                    facet: { field: "category", title: "Category" } satisfies FacetDeclaration,
                    exportHeaderName: "Category",
                    exportValue: (row: ItemsType) => row.category || "N/A",
                },
            },
            {
                accessorKey: "linked_tds_item",
                header: ({ column }) => (
                    <DataTableColumnHeader column={column} title="Linked TDS Item" />
                ),
                cell: ({ row }) => {
                    const linkedId = row.getValue<string>("linked_tds_item");
                    const groupName = linkedId
                        ? tdsItemLabelMap[linkedId] || linkedId
                        : null;
                    return (
                        <div className={groupName ? "font-medium" : "font-medium text-muted-foreground"}>
                            {groupName || "—"}
                        </div>
                    );
                },
                enableColumnFilter: true,
                size: 220,
                meta: {
                    // The whole point of this tab is finding UNTAGGED SKUs, and an
                    // unlinked row is invisible to a normal facet (every query branch
                    // filters out NULL/''). `includeBlankBucket` is what makes
                    // "show me what still needs a group" expressible at all.
                    facet: {
                        field: "linked_tds_item",
                        title: "Linked TDS Item",
                        includeBlankBucket: true,
                        blankLabel: "Not Linked",
                    } satisfies FacetDeclaration,
                    exportHeaderName: "Linked TDS Item",
                    exportValue: (row: ItemsType) => {
                        const linkedId = row.linked_tds_item;
                        return linkedId ? tdsItemLabelMap[linkedId] || linkedId : "";
                    },
                },
            },
        ];

        if (isAdmin) {
            baseColumns.push({
                id: "actions",
                header: "Actions",
                cell: ({ row }) => (
                    <div className="flex items-center justify-center">
                        <FilePenLine
                            className="w-5 h-5 text-blue-500 cursor-pointer hover:text-blue-700 transition-colors"
                            onClick={() => {
                                setEditItem(row.original);
                                setIsEditDialogOpen(true);
                            }}
                        />
                    </div>
                ),
                size: 80,
                meta: { excludeFromExport: true },
            });
        }

        return baseColumns;
    }, [tdsItemLabelMap, isAdmin]);

    const {
        table,
        totalCount,
        isLoading,
        error,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        refetch: refetchTable,
        exportAllRows,
        isExporting,
    } = useServerDataTable<ItemsType>({
        doctype: ITEM_DOCTYPE,
        columns,
        fetchFields: ITEM_LIST_FIELDS_TO_FETCH as string[],
        searchableFields: ITEM_SEARCHABLE_FIELDS,
        defaultSort: "creation desc",
        urlSyncKey: "tds_sku_tab",
        enableRowSelection: false,
        shouldCache: false,
    });

    return (
        <div className="space-y-4">
            <DataTable<ItemsType>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error as Error}
                totalCount={totalCount}
                searchFieldOptions={ITEM_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetDoctype={ITEM_DOCTYPE}
                dateFilterColumns={ITEM_DATE_COLUMNS}
                showExportButton={true}
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName="tds_items_sku_data"
                showRowSelection={false}
            />

            {isAdmin && (
                <EditItemDialog
                    item={editItem}
                    isOpen={isEditDialogOpen}
                    onOpenChange={setIsEditDialogOpen}
                    onItemUpdated={refetchTable}
                    // This tab lives on the Admin-only TDS master page, and linking
                    // is the reason the tab exists.
                    canLinkTds={isAdmin}
                />
            )}
        </div>
    );
};

export default ItemsSKUTab;
