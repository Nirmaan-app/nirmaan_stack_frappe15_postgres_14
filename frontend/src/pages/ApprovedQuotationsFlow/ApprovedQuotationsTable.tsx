
import { useMemo, useEffect } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useFrappeGetDocList } from "frappe-react-sdk";

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";

import { useServerDataTable } from '@/hooks/useServerDataTable';
import { ApprovedQuotations as ApprovedQuotationsType } from "@/types/NirmaanStack/ApprovedQuotations";
import { Items as ItemsType } from "@/types/NirmaanStack/Items";

import { formatDate } from "@/utils/FormatDate";
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice"; // Assuming you have a rounded version too

import {
    APPROVED_QUOTATION_DOCTYPE, AQ_LIST_FIELDS_TO_FETCH, AQ_SEARCHABLE_FIELDS, AQ_DATE_COLUMNS,
    ITEM_DOCTYPE, ITEM_LOOKUP_FIELDS, getItemStaticFilters
} from "./approvedQuotations.constants";
import { useVendorsList } from "../ProcurementRequests/VendorQuotesSelection/hooks/useVendorsList";
import { UnitOptions } from "@/components/helpers/SelectUnit";
interface ApprovedQuotationsTableProps {
    productId?: string;
    item_name?: string; // Make the prop optional for reusability
}
// --- Helper Functions and Components ---


// Change component name and accept props
export default function ApprovedQuotationsTable({ productId, item_name }: ApprovedQuotationsTableProps) {


    const { data: vendorsList, vendorOptionsForSelect, isLoading: vendorsLoading } = useVendorsList({ vendorTypes: ['Service', 'Material & Service', 'Material'] });

    // Fetch Items if you need to display item-specific info not on AQ or for linking
    const { data: itemsList, isLoading: itemsLoading } = useFrappeGetDocList<ItemsType>(
        ITEM_DOCTYPE,
        { fields: ITEM_LOOKUP_FIELDS, limit: 0 },
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
            cell: ({ row }) => <div className="font-medium">{row.getValue("quantity") || "1"}</div>, // Default to 1 if not present
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

    //      const getProjectStaticFilters = (item_Name?: string): Array<[string, string, any]> => {
    //         const itemsList: Array<[string, string, any]> = [];
    //         if (item_Name) {
    //             itemsList.push(["item_name", "=", item_Name]);
    //         }
    //         return itemsList;
    //     };

    const staticFilters = useMemo(() => getItemStaticFilters(productId), [productId]);


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
        additionalFilters: staticFilters,

    });

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


    // useEffect(() => {
    //     if (productId,item_Name) {
    //         // Set the search dropdown to 'Item Name'
    //         setSelectedSearchField('item_name');
    //         // Set the search input value to the item name from the prop
    //         setSearchTerm(item_Name);

    //     }
    // }, [productId,item_Name, setSelectedSearchField, setSearchTerm]); // This effect runs when the prop changes


    const facetFilterOptions = useMemo(() => ({
        vendor: { title: "Vendor", options: vendorOptionsForSelect },
        item_name: { title: "Item Name", options: itemFacetOptions },
        unit: { title: "Unit", options: UnitOptions },
    }), [vendorOptionsForSelect, itemFacetOptions, UnitOptions]);

    const overallIsLoading = aqTableLoading || vendorsLoading || itemsLoading;
    const overallError = aqTableError; // Simplification, can combine errors if needed

    return (
        <div className="flex-1 space-y-4">
            {productId && (<div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Approved Quotations for {item_name && item_name}</h1>
            </div>)}


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