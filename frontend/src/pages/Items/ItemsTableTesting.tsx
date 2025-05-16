// import { DataTable } from "@/components/data-table/data-table";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { Badge } from "@/components/ui/badge";
// import { useUrlParam } from "@/hooks/useUrlParam";
// import { Items as ItemsType } from "@/types/NirmaanStack/Items";
// import { formatDate } from "@/utils/FormatDate";
// import { ColumnDef } from "@tanstack/react-table";
// import { FrappeConfig, FrappeContext, useFrappeGetDocList, useSWR } from "frappe-react-sdk";
// import { useContext, useMemo } from "react";
// import { Link } from "react-router-dom";
// import { FilterParameters } from "../projects/project";

// export const ItemsQueryKeys = {
//   items: (parameters: FilterParameters) => ['Items', 'list', JSON.stringify(parameters)],
//   count: (parameters: (string | string[])[][]) => ['Items', 'count', JSON.stringify(parameters)]
// }

// export default function ItemsTesting() {

//   // const [pageIndex] = useStateSyncedWithParams("pageIdx", "0");
//   // const [pageSize] = useStateSyncedWithParams("rows", "10");
//   const pageSize = useUrlParam("rows") || "10";
//   const pageIndex = useUrlParam("pageIdx") || "0";

//   const searchText = useUrlParam("search");

//   const categoryFilter = useUrlParam("Category");

//   // console.log("pageIndex", pageIndex)

//   // console.log("pageSize", pageSize)

//   // console.log("categoryFilter ", categoryFilter?.split(','))


//   // console.log("searchText", searchText)
//   // console.log("categoryFilter", categoryFilter)

//   // {db, call, app, auth, file, socket, tokenParams, url}
//   const frappe = useContext(FrappeContext) as FrappeConfig

//   // const fetchSearchItems = async (searchText: string) => {
//   //   const response = await frappe.call.get("frappe.client.get_list", {
//   //     doctype: "Items",
//   //     fields: ["name", "item_name", "unit_name", "make_name", "category", "creation"],
//   //     filters: [["item_name", "like", `%${searchText}%`]],
//   //     limit_page_length: 10000,
//   //     orderBy: { field: "creation", order: "desc" },
//   //   });
//   //   return response.message
//   // }

//   const allFilters = useMemo(() => {
//     return [
//       ['item_name', 'like', `%${searchText}%`],
//       ['category', 'in', categoryFilter?.split(',') || ""]
//     ].filter(f => f[2] !== undefined && f[2] !== '' && f[2] !== '%null%' && f[2] !== '%%');
//   }, [searchText, categoryFilter]);
  


//   console.log("allFilters", allFilters)

//   const itemFilters = useMemo(() =>  {
//     return {
//       doctype: "Items",
//       fields: ["name", "item_name", "unit_name", "make_name", "category", "creation"],
//       filters: allFilters,
//       // limit_start: allFilters.length ? 0 : parseInt(pageIndex) * parseInt(pageSize),
//       // limit_page_length: allFilters.length ? 10000 : parseInt(pageSize),
//       limit_start: parseInt(pageIndex) * parseInt(pageSize),
//       limit_page_length: parseInt(pageSize),
//       orderBy: { field: "creation", order: "desc" },
//     }
//   },[allFilters, pageIndex, pageSize])

//   const fetchItems = async () => {
//     const response = await frappe.call.get("frappe.client.get_list", itemFilters);
//     console.log("fetchItems response", response)
//     return response.message
//   }

//   const {data, isLoading} = useSWR(
//     ItemsQueryKeys.items(itemFilters),
//     () => fetchItems(),
//     // {
//     //   keepPreviousData: true
//     // }
//   )

//   console.log("fetchItems call data", data)

//   const fetchDocCount = async () => {
//     const response = await frappe.call.get("frappe.client.get_count", {
//       doctype: "Items",
//       filters: allFilters,
//       // debug: false, 
//       // cache: true
//     });
//     console.log("fetchDocCount response", response)
//     return response.message
//   }
  
//     const {data: totalItems} = useSWR(
//       ItemsQueryKeys.count(allFilters),
//       () => fetchDocCount(),
//       {
//         onError: (error) => console.error('Count fetch error:', error),
//         onSuccess: (data) => console.log('Count success:', data)
//       }
//     )

//     console.log("fetchDocCount call data", totalItems)

//     // console.log("totalItems", totalItems)

//   // console.log("data", data)

//   const { data: category_list, isLoading: category_loading, error: category_error } = useFrappeGetDocList("Category", {
//       fields: ["*"],
//       orderBy: { field: "work_package", order: "asc" },
//       limit: 1000,
//     });
   

//   // const {data: totalItems} = useFrappeGetDocCount("Items", allFilters, true)


//   // const {data: items} = useSWR(
//   //   ItemsQueryKeys.items({fields: ["name", "item_name", "unit_name", "make_name", "category", "creation"], limit: parseInt(pageSize), limit_start: parseInt(pageIndex) * parseInt(pageSize), orderBy: { field: "creation", order: "desc" }}),
//   //   () => fetchItems(pageIndex, pageSize)
//   // )

//   // console.log("items", items)

//   // const { data, isLoading } = useFrappeGetDocList<ItemsType>("Items", {
//   //   fields: ["name", "item_name", "unit_name", "make_name", "category", "creation"],
//   //   limit_start: parseInt(pageIndex) * parseInt(pageSize),
//   //   limit: parseInt(pageSize),
//   //   orderBy: { field: "creation", order: "desc" },
//   // }, ItemsQueryKeys.items({fields: ["name", "item_name", "unit_name", "make_name", "category", "creation"], limit: parseInt(pageSize), limit_start: parseInt(pageIndex) * parseInt(pageSize), orderBy: { field: "creation", order: "desc" }}), 
//   // {
//   //   keepPreviousData: true, // Smooth pagination experience
//   // });


//   const columns: ColumnDef<ItemsType>[] = useMemo(
//     () => [
//       {
//         accessorKey: "name",
//         header: ({ column }) => {
//           return <DataTableColumnHeader column={column} title="Product ID" />;
//         },
//         cell: ({ row }) => {
//           return (
//             <div className="font-medium">
//               <Link
//                 className="underline hover:underline-offset-2 whitespace-nowrap"
//                 to={`${row.getValue("name")}`}
//               >
//                 {row.getValue("name").slice(-6)}
//               </Link>
//             </div>
//           );
//         },
//       },
//       {
//         accessorKey: "item_name",
//         header: ({ column }) => {
//           return <DataTableColumnHeader column={column} title="Product Name" />;
//         },
//         cell: ({ row }) => {
//           return (
//             <div className="font-medium">
//               <Link
//                 className="underline hover:underline-offset-2"
//                 to={`${row.getValue("name")}`}
//               >
//                 {row.getValue("item_name")}
//               </Link>
//               {/* `${item.item_name} ${ ? "-" + row.getValue("make_name") : ""}` */}
//             </div>
//           );
//         },
//       },
//       // {
//       //   accessorKey: "make_name",
//       //   header: ({ column }) => {
//       //     return <DataTableColumnHeader column={column} title="Make" />;
//       //   },
//       //   cell: ({ row }) => {
//       //     return (
//       //       <div className="font-medium">
//       //         {row.getValue("make_name") || "--"}
//       //         `${item.item_name} ${ ? "-" + row.getValue("make_name") : ""}`
//       //       </div>
//       //     );
//       //   },
//       // },
//       {
//         accessorKey: "creation",
//         header: ({ column }) => {
//           return <DataTableColumnHeader column={column} title="Date Created" />;
//         },
//         cell: ({ row }) => {
//           return (
//             <div className="font-medium">
//               {formatDate(row.getValue("creation")?.split(" ")[0])}
//             </div>
//           );
//         },
//       },
//       {
//         accessorKey: "unit_name",
//         header: ({ column }) => {
//           return <DataTableColumnHeader column={column} title="Unit" />;
//         },
//         cell: ({ row }) => {
//           return <div className="font-medium">{row.getValue("unit_name")}</div>;
//         },
//       },
//       {
//         accessorKey: "category",
//         header: ({ column }) => {
//           return <DataTableColumnHeader column={column} title="Category" />;
//         },
//         cell: ({ row }) => {
//           return (
//             <div className="font-medium">
//               <Badge>{row.getValue("category")}</Badge>
//             </div>
//           );
//         },
//         filterFn: (row, id, value) => {
//           return value.includes(row.getValue(id));
//         },
//       },
//     ], [data]);

//     const categoryOptions = useMemo(() => category_list?.map((item) => ({
//         value: item.name,
//         label:
//           item.name + "(" + item.work_package.slice(0, 4).toUpperCase() + ")",
//       })) || [], [category_list]);

//   return (
//       <div className="flex-1 space-y-4">
//         {/* {isLoading ? (
//           <TableSkeleton />
//         ) : ( */}
//           <DataTable
//             // totalItems={(allFilters?.length ? data?.length : totalItems) || 0}
//             totalItems={totalItems}
//             columns={columns}
//             data={data || []}
//             loading={isLoading}
//             category_options={categoryOptions}
//           />
//         {/* )} */}
//     </div>
//   );
// }


// src/features/items/ItemsTable.tsx or src/pages/ItemsTable.tsx
import React, { useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom'; // Or your routing library
import { useFrappeGetDocList } from 'frappe-react-sdk'; // For fetching facet options

import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'; // Adjust path
import { useServerDataTable } from '@/hooks/useServerDataTable'; // Adjust path
import { Badge } from '@/components/ui/badge'; // Adjust path
import { Checkbox } from '@/components/ui/checkbox'; // For row selection column
import { formatDate } from '@/utils/FormatDate'; // Adjust path
import { DataTable } from '@/components/data-table/new-data-table';

// Define the type for your Item data, matching Frappe fields
interface Item {
    name: string; // Required by hook base constraint
    item_name: string;
    unit_name?: string;
    make_name?: string;
    category?: string;
    creation: string; // ISO date string from Frappe
    // Add other fields fetched in `fetchFields`
}

// Component to render the Items Table
export default function ItemsTesting() {
    // --- Configuration for the hook ---
    const doctype = 'Items'; // Or Item? Verify your DocType name
    const urlSyncKey = 'items'; // Unique key for URL state for this table instance

    // Define columns using TanStack's ColumnDef
    const columns = useMemo<ColumnDef<Item>[]>(() => [
        // Example: Row Selection Column (if needed)
        {
            id: 'select',
            header: ({ table }) => (
                <Checkbox
                    checked={table.getIsAllPageRowsSelected()}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all rows"
                    className="translate-y-[2px]"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                    className="translate-y-[2px]"
                />
            ),
            enableSorting: false,
            enableHiding: false,
            size: 40, // Smaller fixed size
        },
        // Your existing columns...
        {
            accessorKey: 'name', // Use 'name' from Frappe
            header: ({ column }) => <DataTableColumnHeader column={column} title="Product ID" />,
            cell: ({ row }) => (
                <Link
                    className="font-medium underline hover:underline-offset-2 whitespace-nowrap"
                    to={`/products/${row.original.name}`} // Use actual name for link
                >
                    {row.original.name.slice(-6)} {/* Display last 6 chars */}
                </Link>
            ),
            size: 100, // Example size
        },
        {
            accessorKey: 'item_name',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Product Name" />,
            cell: ({ row }) => (
                <Link
                    className="font-medium underline hover:underline-offset-2"
                    to={`/items/${row.original.name}`}
                >
                    {row.getValue('item_name')}
                    {/* Optionally include make_name if it exists */}
                    {row.original.make_name ? ` - ${row.original.make_name}` : ''}
                </Link>
            ),
            size: 300,
        },
        {
            accessorKey: 'creation',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Date Created" />,
            cell: ({ row }) => (
                <div className="font-medium whitespace-nowrap">
                    {formatDate(row.getValue<string>('creation')?.split(' ')[0])}
                </div>
            ),
            enableColumnFilter: false, // Disable filtering on this column if not needed
            size: 150,
        },
        {
            accessorKey: 'unit_name',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Unit" />,
            cell: ({ row }) => <div className="font-medium">{row.getValue('unit_name') || '--'}</div>,
            enableColumnFilter: true,
            size: 100,
        },
        {
            accessorKey: 'category',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            cell: ({ row }) => (
                row.getValue('category') ? <Badge>{row.getValue('category')}</Badge> : '--'
            ),
            // Enable filtering for this column - the hook/API handles the logic
            enableColumnFilter: true,
            size: 180,
            // filterFn: (row, id, value) => {
            //     console.log("row, id, value", row, id, value)
            //     return value.includes(row.getValue(id));
            // },
        },
        // Add more columns as needed
    ], []); // Empty dependency array if columns don't depend on external state

    // --- Fetch options for Faceted Filters ---
    const { data: categoryList } = useFrappeGetDocList<{ name: string, work_package?: string }>("Category", {
        fields: ["name", "work_package"], // Fetch only needed fields
        limit: 1000, // Fetch all relevant categories
    });

    const categoryOptions = useMemo(() => {
        return categoryList?.map(cat => ({
            value: cat.name,
            // Customize label as needed
            label: cat.work_package ? `${cat.name} (${cat.work_package.slice(0, 4).toUpperCase()})` : cat.name,
        })) || [];
    }, [categoryList]);

    // Prepare facet filter options map for the DataTable component
    const facetFilterOptions = useMemo(() => ({
        category: { // Matches the accessorKey/columnId
            title: "Category",
            options: categoryOptions,
        },
        unit_name: {
                title: "Unit",
                options: [],
        }
        // Add other facet filters here if needed
        // status: { title: "Status", options: statusOptions },
    }), [categoryOptions /*, statusOptions */]);


    // --- Use the Server Data Table Hook ---
    const {
        table,
        data,
        totalCount,
        isLoading,
        error,
        globalFilter,
        setGlobalFilter,
        isGlobalSearchEnabled,
        toggleGlobalSearch,
        // You can access other state/setters if needed: pagination, sorting, etc.
    } = useServerDataTable<Item>({
        doctype: doctype,
        columns: columns, // Pass columns definition
        fetchFields: ["name", "item_name", "unit_name", "make_name", "category", "creation"], // Fields for API
        defaultSearchField: "item_name", // Search this field when global is off
        enableRowSelection: true, // Example: Enable row selection
        urlSyncKey: urlSyncKey, // Enable URL state synchronization for 'items'
        // Optional initial state:
        // initialState: {
        //     sorting: [{ id: 'creation', desc: true }],
        // },
    });

    // Example: Handle Export
    const handleExport = () => {
        const selectedRowsData = table.getSelectedRowModel().rows.map(row => row.original);
        console.log("Exporting selected data:", selectedRowsData);
        // Implement your CSV export logic here using selectedRowsData
        alert(`Exporting ${selectedRowsData.length} selected items... (Check console)`);
        // Maybe clear selection after export?
        table.resetRowSelection();
    };

    return (
        <div className="container mx-auto py-6 px-4 sm:px-6 lg:px-8">
            <h1 className="text-2xl font-semibold mb-4">Items</h1>
            <DataTable<Item>
                table={table}
                columns={columns} // Pass columns again for rendering info
                isLoading={isLoading}
                error={error}
                totalCount={totalCount}
                globalFilterValue={globalFilter}
                onGlobalFilterChange={setGlobalFilter}
                globalSearchConfig={{
                    isEnabled: isGlobalSearchEnabled,
                    toggle: toggleGlobalSearch,
                    specificPlaceholder: "Search by Item Name...", // Custom placeholder
                    globalPlaceholder: "Search Items..." // Custom placeholder
                }}
                facetFilterOptions={facetFilterOptions}
                // Pass the URL base key if needed by faceted filters
                // urlBaseKey={urlSyncKey} // Not strictly needed if urlSyncKey in facet matches columnId
                showExport={true} // Enable export button
                onExport={handleExport} // Provide export handler
                // Example toolbar action:
                // toolbarActions={<Button size="sm">Add New Item</Button>}
            />
        </div>
    );
}