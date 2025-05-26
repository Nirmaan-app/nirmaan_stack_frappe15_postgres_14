import { useCallback, useEffect, useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom"; // Removed useSearchParams, will use urlStateManager
import { useFrappeGetDocList, useFrappePostCall } from "frappe-react-sdk";
import { Radio } from 'antd'; // Assuming Ant Design is installed and configured

import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Ellipsis, Package, CirclePlus } from "lucide-react"; // Added CirclePlus for potential Add New button

import { useServerDataTable } from '@/hooks/useServerDataTable';
import { Vendors as VendorsType } from "@/types/NirmaanStack/Vendors";
import { Category as CategoryType } from "@/types/NirmaanStack/Category";
import { formatDate } from "@/utils/FormatDate";
import { urlStateManager } from '@/utils/urlStateManager'; // Your custom URL manager

import {
    VENDOR_DOCTYPE, VENDOR_LIST_FIELDS_TO_FETCH, VENDOR_SEARCHABLE_FIELDS, VENDOR_DATE_COLUMNS,
    VENDOR_TYPE_OPTIONS, CATEGORY_DOCTYPE, CATEGORY_LIST_FIELDS_FOR_FACETS
} from "./vendors.constants";
import { VendorsOverallSummaryCard } from "./components/VendorsOverallSummaryCard"; // Optional component

interface VendorTypeCount {
    type: string;
    count: number | undefined;
    isLoading: boolean;
}

export default function VendorsPage() {
    const [currentVendorType, setCurrentVendorType] = useState<string>(() => urlStateManager.getParam('type') || VENDOR_TYPE_OPTIONS[0].value);

    const [vendorTypeCounts, setVendorTypeCounts] = useState<VendorTypeCount[]>([]);

    const { call } = useFrappePostCall('frappe.client.get_count')

    // Fetch counts for each vendor type for the Radio Group
    useEffect(() => {
        const fetchCounts = async () => {
            const countsPromises = VENDOR_TYPE_OPTIONS.map(opt =>
                call({
                    doctype: VENDOR_DOCTYPE,
                    filters: { vendor_type: opt.value },
                    cache: true,
                },
                ).then(res => ({ type: opt.value, count: res.message, isLoading: false }))
                    .catch(() => ({ type: opt.value, count: 0, isLoading: false }))
            );
            const resolvedCounts = await Promise.all(countsPromises);
            setVendorTypeCounts(resolvedCounts as VendorTypeCount[]);
        };
        fetchCounts();
    }, []);

    // Subscribe to URL changes for the 'type' parameter
    useEffect(() => {
        const handleUrlTypeChange = (_key: string, value: string | null) => {
            setCurrentVendorType(value || VENDOR_TYPE_OPTIONS[0].value);
        };
        const unsubscribe = urlStateManager.subscribe('type', handleUrlTypeChange);

        // Ensure initial state matches URL if it was set by something else before mount
        const initialUrlType = urlStateManager.getParam('type') || VENDOR_TYPE_OPTIONS[0].value;
        if (currentVendorType !== initialUrlType) {
            setCurrentVendorType(initialUrlType);
        }
        return unsubscribe;
    }, []); // currentVendorType is not a dependency here to avoid re-subscribing on its own change

    const handleVendorTypeChange = useCallback((newType: string) => {
        if (currentVendorType === newType) return;
        // setCurrentVendorType(newType); // State will be updated by URL subscription or directly
        urlStateManager.updateParam('type', newType);
        // The change in additionalFilters (derived from currentVendorType) will trigger table refetch
    }, [currentVendorType]);


    // Fetch categories for faceted filter options
    const { data: categoryListRaw, isLoading: categoryUiLoading, error: categoryUiError } = useFrappeGetDocList<CategoryType>(
        CATEGORY_DOCTYPE,
        { fields: CATEGORY_LIST_FIELDS_FOR_FACETS, limit: 10000 },
        'category_list_for_vendor_facets'
    );

    const categoryFacetOptions = useMemo(() =>
        categoryListRaw?.map(cat => ({
            label: `${cat.name} (${cat.work_package?.slice(0, 4).toUpperCase() || 'N/A'})`,
            value: cat.name, // This is the category name stored in vendor_category.categories
        })) || [],
        [categoryListRaw]
    );

    const columns = useMemo<ColumnDef<VendorsType>[]>(() => [
        {
            accessorKey: "name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor ID" />,
            cell: ({ row }) => {
                const vendor = row.original;
                const typePrefix = vendor.vendor_type === "Material" ? "M"
                    : vendor.vendor_type === "Service" ? "S"
                        : vendor.vendor_type === "Material & Service" ? "MS"
                            : "V";
                return (
                    <Link className="text-blue-600 hover:underline font-medium whitespace-nowrap" to={`/vendors/${vendor.name}`}>
                        {typePrefix}-{vendor.name.slice(-4)}
                    </Link>
                );
            }, size: 120,
            meta: {
                exportHeaderName: "Vendor ID",
                exportValue: (row) => {
                    return row.name
                }
            }
        },
        {
            accessorKey: "vendor_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Vendor Name" />,
            cell: ({ row }) => (
                <Link className="hover:underline font-medium whitespace-nowrap" to={`/vendors/${row.original.name}`}>
                    {row.getValue("vendor_name")}
                </Link>
            ), size: 250,
            meta: {
                exportHeaderName: "Vendor Name",
                exportValue: (row) => {
                    return row.vendor_name
                }
            }
        },
        // {
        //     accessorKey: "vendor_type",
        //     header: ({ column }) => <DataTableColumnHeader column={column} title="Type" />,
        //     cell: ({ row }) => <Badge variant="outline">{row.getValue("vendor_type")}</Badge>,
        //     size: 180,
        // },
        {
            accessorKey: "vendor_category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Categories" />,
            cell: ({ row }) => {
                const categories = row.original.vendor_category?.categories || [];
                if (categories.length === 0) return <span className="text-xs text-muted-foreground">N/A</span>;
                const displayCategories = categories.slice(0, 2);
                const remainingCount = categories.length - displayCategories.length;
                return (
                    <div className="flex flex-wrap gap-1 items-center">
                        {displayCategories.map(cat => <Badge key={cat} variant="secondary" className="text-xs">{cat}</Badge>)}
                        {remainingCount > 0 && (
                            <HoverCard>
                                <HoverCardTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
                                        <Ellipsis className="h-4 w-4" />
                                    </Button>
                                </HoverCardTrigger>
                                <HoverCardContent className="w-auto max-w-xs p-2">
                                    <div className="flex flex-wrap gap-1">
                                        {categories.slice(2).map(cat => <Badge key={cat} variant="secondary" className="text-xs">{cat}</Badge>)}
                                    </div>
                                </HoverCardContent>
                            </HoverCard>
                        )}
                    </div>
                );
            },
            size: 250,
            meta: {
                excludeFromExport: true, // Exclude from export if needed
            }
        },
        {
            id: "vendor_address", // Using id because it's derived from multiple fields
            header: ({ column }) => <DataTableColumnHeader column={column} title="Address" />,
            cell: ({ row }) => {
                const { vendor_city, vendor_state } = row.original;
                if (!vendor_city && !vendor_state) return <span className="text-xs text-muted-foreground">N/A</span>;
                return <div className="font-medium text-sm">{`${vendor_city || ''}${vendor_city && vendor_state ? ', ' : ''}${vendor_state || ''}`}</div>;
            }, size: 200,
            meta: {
                exportHeaderName: "Address",
                exportValue: (row) => {
                    const { vendor_city, vendor_state } = row;
                    return `${vendor_city || ''}${vendor_city && vendor_state ? ', ' : ''}${vendor_state || ''}`;
                }
            }
        },
        {
            accessorKey: "creation",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Date Created" />,
            cell: ({ row }) => <div className="font-medium whitespace-nowrap">{formatDate(row.getValue("creation"))}</div>,
            size: 120,
            meta: {
                exportHeaderName: "Date Created",
                exportValue: (row) => {
                    return formatDate(row.creation)
                }
            }
        },
    ], []);

    const additionalFilters = useMemo(() => [
        ['vendor_type', '=', currentVendorType]
    ], [currentVendorType]);

    const {
        table, totalCount, isLoading: tableIsLoading, error: tableError,
        searchTerm, setSearchTerm, selectedSearchField, setSelectedSearchField,
        refetch: refetchTable,
    } = useServerDataTable<VendorsType>({
        doctype: VENDOR_DOCTYPE,
        columns: columns,
        fetchFields: VENDOR_LIST_FIELDS_TO_FETCH as string[],
        searchableFields: VENDOR_SEARCHABLE_FIELDS,
        defaultSort: 'creation desc',
        urlSyncKey: `vendors_list`, // Does not include type; type is a separate param
        additionalFilters: additionalFilters,
        enableRowSelection: false, // Adjust if selection is needed
        shouldCache: true
    });

    const radioOptions = useMemo(() => VENDOR_TYPE_OPTIONS.map(opt => {
        const countData = vendorTypeCounts.find(c => c.type === opt.value);
        const countDisplay = countData?.isLoading ? '...' : (countData?.count ?? 0);
        return {
            label: <div className="flex items-center px-1">{opt.label} <Badge variant="secondary" className="ml-2">{countDisplay}</Badge></div>,
            value: opt.value,
        };
    }), [vendorTypeCounts]);

    const facetFilterOptions = useMemo(() => ({
        // For vendor_type, it's controlled by Radio. But if you want a facet too:
        // vendor_type: { title: "Vendor Type", options: VENDOR_TYPE_OPTIONS },
        // For vendor_category, using the fetched category names
        // Column ID for filtering should match what backend expects for JSON field or be mapped
        // vendor_category: { title: "Specialized In", options: categoryFacetOptions },
    }), [categoryFacetOptions]);


    return (
        <div className="flex-1 space-y-4">

            {/* <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"> */}
            <VendorsOverallSummaryCard />
            {/* Add other summary cards if needed */}
            {/* </div> */}

            <div className="pb-4">
                <Radio.Group
                    options={radioOptions}
                    value={currentVendorType}
                    onChange={(e) => handleVendorTypeChange(e.target.value)}
                    optionType="button"
                    buttonStyle="solid"
                />
            </div>

            <DataTable<VendorsType>
                table={table}
                columns={columns}
                isLoading={tableIsLoading || categoryUiLoading}
                error={(tableError || categoryUiError) as Error}
                totalCount={totalCount}
                searchFieldOptions={VENDOR_SEARCHABLE_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                dateFilterColumns={VENDOR_DATE_COLUMNS}
                showExportButton={true}
                onExport={'default'}
                exportFileName={`vendors_${currentVendorType.toLowerCase().replace(/ & /g, '_')}`}
                showRowSelection={false}
            />
            {/* <div className="text-xs text-muted-foreground pt-2">
                * Filtering by 'Specialized In' (Categories) on this JSON field currently has limited backend support and may not work as expected for all scenarios.
            </div> */}
        </div>
    );
}