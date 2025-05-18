import React, { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList, useFrappeDocTypeEventListener } from "frappe-react-sdk";

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";

import { useServerDataTable } from '@/hooks/useServerDataTable';
import { ApprovedQuotations as ApprovedQuotationsType } from "@/types/NirmaanStack/ApprovedQuotations";
import { Vendors as VendorsType } from "@/types/NirmaanStack/Vendors";
import { Items as ItemsType } from "@/types/NirmaanStack/Items";

import { formatDate } from "@/utils/FormatDate";
import formatToIndianRupee, { formatToRoundedIndianRupee } from "@/utils/FormatPrice"; // Assuming you have a rounded version too

import {
    APPROVED_QUOTATION_DOCTYPE, AQ_LIST_FIELDS_TO_FETCH, AQ_SEARCHABLE_FIELDS, AQ_DATE_COLUMNS,
    VENDOR_DOCTYPE, VENDOR_LOOKUP_FIELDS,
    ITEM_DOCTYPE, ITEM_LOOKUP_FIELDS,
    CATEGORY_DOCTYPE, CATEGORY_LOOKUP_FIELDS
} from "./approvedQuotations.constants";

export default function ApprovedQuotationsPage() {

    // Fetch supporting data for column rendering and facet options
    const { data: vendorsList, isLoading: vendorsLoading } = useFrappeGetDocList<VendorsType>(
        VENDOR_DOCTYPE,
        { fields: VENDOR_LOOKUP_FIELDS, limit: 10000 },
        'vendors_for_aq_page'
    );
    // Fetch Items if you need to display item-specific info not on AQ or for linking
    const { data: itemsList, isLoading: itemsLoading } = useFrappeGetDocList<ItemsType>(
        ITEM_DOCTYPE,
        { fields: ITEM_LOOKUP_FIELDS, limit: 10000 },
        'items_for_aq_page'
    );
    // const { data: categoryList, isLoading: categoriesLoading } = useFrappeGetDocList<CategoryType>(
    //     CATEGORY_DOCTYPE,
    //     { fields: CATEGORY_LOOKUP_FIELDS, limit: 10000 },
    //     'categories_for_aq_page'
    // );

    const vendorMap = useMemo(() => {
        const map = new Map<string, string>();
        vendorsList?.forEach(vendor => map.set(vendor.name, vendor.vendor_name));
        return map;
    }, [vendorsList]);

    const itemMap = useMemo(() => { // If you need to map item_id to a richer item object
        const map = new Map<string, ItemsType>();
        itemsList?.forEach(item => map.set(item.name, item));
        return map;
    }, [itemsList]);


    const columns = useMemo<ColumnDef<ApprovedQuotationsType>[]>(() => [
        {
            accessorKey: "name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Quote ID" />,
            cell: ({ row }) => (
                // Assuming no dedicated detail page for an Approved Quotation,
                // but you might link to the related PO or Item.
                <div className="font-medium whitespace-nowrap">{row.getValue("name")}</div>
            ), size: 180,
            meta: {
                exportHeaderName: "Quote ID",
                exportValue: (row) => {
                    return row.name
                }
            }
        },
        {
            accessorKey: "item_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Item" />,
            cell: ({ row }) => {
                const itemId = row.original.item_id;
                return itemId ? (
                    <Link className="text-blue-600 hover:underline font-medium" to={`/products/${itemId}`}>
                        {row.getValue("item_name")}
                    </Link>
                ) : (
                    <div className="font-medium">{row.getValue("item_name")}</div>
                );
            }, size: 250,
            meta: {
                exportHeaderName: "Item Name",
                exportValue: (row) => {
                    return row.item_name
                }
            }
        },
        {
            accessorKey: "vendor",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor" />,
            cell: ({ row }) => {
                const vendorId = row.getValue<string>("vendor");
                const vendorName = vendorMap.get(vendorId) || vendorId;
                return vendorId ? (
                    <Link className="text-blue-600 hover:underline font-medium" to={`/vendors/${vendorId}`}>
                        {vendorName}
                    </Link>
                ) : (
                    <div className="font-medium">{"--"}</div>
                );
            }, size: 220,
            meta: {
                exportHeaderName: "Vendor Name",
                exportValue: (row) => {
                    return vendorMap.get(row.vendor) || row.vendor
                }
            }
        },
        {
            accessorKey: "quote",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Quoted Price" />,
            cell: ({ row }) => <div className="font-medium pr-2">{formatToRoundedIndianRupee(row.getValue("quote"))}</div>,
            meta: {
                isNumeric: true,
                exportHeaderName: "Quoted Price",
                exportValue: (row) => {
                    return formatToRoundedIndianRupee(row.quote)
                }
            }, // For styling if needed
            size: 150,
        },
        {
            accessorKey: "quantity",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Qty" />,
            cell: ({ row }) => <div className="font-medium text-center">{row.getValue("quantity") || "1"}</div>, // Default to 1 if not present
            meta: {
                isNumeric: true,
                exportHeaderName: "Quantity",
                exportValue: (row) => {
                    return row.quantity || 1
                }
            },
            size: 80,
        },
        {
            accessorKey: "unit",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Unit" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("unit")}</div>,
            size: 100,
            meta: {
                exportHeaderName: "Unit",
                exportValue: (row) => {
                    return row.unit
                }
            }
        },
        {
            accessorKey: "make",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Make" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue("make") || "--"}</div>,
            size: 120,
            meta: {
                exportHeaderName: "Make",
                exportValue: (row) => {
                    return row.make || "--"
                }
            }
        },
        {
            accessorKey: "procurement_order",
            header: ({ column }) => <DataTableColumnHeader column={column} title="PO #" />,
            cell: ({ row }) => {
                const poId = row.getValue<string>("procurement_order");
                return poId ? (
                    <Link className="text-blue-600 hover:underline font-medium" to={`${poId.replaceAll("/", "&=")}`}> {/* Adjust PO link */}
                        {poId}
                    </Link>
                ) : (
                    <span className="text-xs text-muted-foreground">N/A</span>
                );
            }, size: 180,
            meta: {
                exportHeaderName: "PO #",
                exportValue: (row) => {
                    return row.procurement_order
                }
            }
        },
        {
            accessorKey: "creation",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Date Approved" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 150,
            meta: {
                isDate: true,
                exportHeaderName: "Date Approved",
                exportValue: (row) => {
                    return formatDate(row.creation)
                }
            }
        },
        // {
        //     accessorKey: "category", // Assuming 'category' is a Link field to Category Doctype
        //     header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
        //     cell: ({ row }) => <div className="font-medium">{row.getValue("category") || "--"}</div>,
        //     size: 150,
        // },
    ], [vendorMap, itemMap]); // itemMap included if used

    const {
        table, totalCount, isLoading: aqTableLoading, error: aqTableError,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        refetch: refetchTable,
    } = useServerDataTable<ApprovedQuotationsType>({
        doctype: APPROVED_QUOTATION_DOCTYPE,
        columns: columns,
        fetchFields: AQ_LIST_FIELDS_TO_FETCH as string[],
        searchableFields: AQ_SEARCHABLE_FIELDS,
        defaultSort: 'creation desc',
        urlSyncKey: 'approved_quotations_list',
        enableRowSelection: false,
        shouldCache: true,
    });

    const vendorFacetOptions = useMemo(() =>
        vendorsList?.map(v => ({ label: v.vendor_name, value: v.name })) || [],
        [vendorsList]);

    // Deriving item options from the actual approved quotes or from a full Items list
    const itemFacetOptions = useMemo(() => {
        // If you want options based on items *actually present* in approved quotes:
        // You would need to fetch all AQs first (not good for performance if many AQs)
        // Or, fetch unique item_name values from backend.
        // For now, using the fetched itemsList for consistency:
        return itemsList?.map(i => ({ label: i.item_name, value: i.item_name })) || [];
        // If filtering by item_id: itemsList?.map(i => ({ label: i.item_name, value: i.item_id }))
    }, [itemsList]);

    // const categoryFacetOptions = useMemo(() =>
    //     categoryList?.map(c => ({ label: c.name, value: c.name })) || [],
    // [categoryList]);


    const facetFilterOptions = useMemo(() => ({
        vendor: { title: "Vendor", options: vendorFacetOptions },
        item_name: { title: "Item Name", options: itemFacetOptions }, // If filtering by item_name
        // If your AQ doctype has 'category' as a Link field to the Category doctype,
        // and you want to filter by the category's name:
        // category: { title: "Category", options: categoryFacetOptions },
    }), [vendorFacetOptions, itemFacetOptions]);

    const overallIsLoading = aqTableLoading || vendorsLoading || itemsLoading;
    const overallError = aqTableError; // Simplification, can combine errors if needed

    return (
        <div className="flex-1 space-y-4">
            {/* <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Approved Quotations</h1>
            </div> */}

            {/* No summary card for now, add if needed */}

            <DataTable<ApprovedQuotationsType>
                table={table}
                columns={columns}
                isLoading={overallIsLoading}
                error={overallError}
                totalCount={totalCount}
                searchFieldOptions={AQ_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={AQ_DATE_COLUMNS}
                showExportButton={true}
                onExport={'default'}
                exportFileName="approved_quotations_data"
                showRowSelection={false}
            />
        </div>
    );
}