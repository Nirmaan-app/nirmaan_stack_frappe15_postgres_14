// CustomerPODetailsCard.tsx (Updated with useServerDataTable)

import React, { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { LinkIcon, FileTextIcon, CirclePlus, Info } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DataTable, SearchFieldOption, } from "@/components/data-table/new-data-table"; // Assuming new-data-table exports DataTable
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useServerDataTable, SimpleAggregationConfig, CustomAggregationConfig } from "@/hooks/useServerDataTable"; // Import the hook and types
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { AddCustomerPODialog, CustomerPODetail } from "./AddCustomerPODialog"; 
import { useFrappeGetDocList ,useFrappeGetDoc} from "frappe-react-sdk"; // Needed to fetch current POs for the dialog
import { parseNumber } from "@/utils/parseNumber"; // Utility to convert string/unknown to number
import { formatDate } from "@/utils/FormatDate";
// NEW IMPORTS: Tooltip components (assuming standard ShadCN/Radix paths)
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


// --- NEW CONSTANTS (Simulating a constant file) ---
const CUSTOMER_PO_CHILD_TABLE_DOCTYPE = 'Projects'; // ASSUMPTION
export const CUSTOMER_PO_LIST_FIELDS_TO_FETCH = [
    'name','project_name',
    '`tabCustomer PO Child Table`.customer_po_number', 
    '`tabCustomer PO Child Table`.customer_po_value_inctax',
    '`tabCustomer PO Child Table`.customer_po_value_exctax', 
    '`tabCustomer PO Child Table`.customer_po_link', 
    '`tabCustomer PO Child Table`.customer_po_attachment', 
    '`tabCustomer PO Child Table`.customer_po_payment_terms',
    '`tabCustomer PO Child Table`.customer_po_creation_date',

];
export const CUSTOMER_PO_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "customer_po_number", label: "PO Number", default: true },
    // { value: "project_name", label: "Project Name" },
];
export const CUSTOMER_PO_DATE_COLUMNS: string[] = ["creation", "customer_po_creation_date"];
// const CUSTOMER_PO_AGGREGATES_CONFIG: (SimpleAggregationConfig | CustomAggregationConfig)[] = [
//     { field: 'customer_po_value_inctax', function: 'sum', alias: 'total_incl_tax' }, 
//     { field: 'customer_po_value_exctax', function: 'sum', alias: 'total_excl_tax' }, 
// ];
// --- END CONSTANTS ---

// Data structure for the table rows
interface CustomerPOTableRow extends CustomerPODetail {
    project: string; // The parent Project DocName (from 'parent as project' alias)
    project_name: string;
}

interface CustomerPODetailsCardProps {
    projectId?: string; 
    refetchProjectData: () => Promise<any>; 
}


// --- COLUMN DEFINITION (similar to getCreditsColumns) ---
const getCustomerPOColumns = (projectId?: string): ColumnDef<CustomerPOTableRow>[] => {
    
    const columns: ColumnDef<CustomerPOTableRow>[] = [
             {
               // Date -> Center Align
               accessorKey: "customer_po_creation_date",
               header: ({ column }) => (
                 <div className="flex justify-center">
                   <DataTableColumnHeader column={column} title="Creation" />
                 </div>
               ),
               cell: ({ row }) => (
                 <div className="text-left">{formatDate(row.original.customer_po_creation_date)}</div>
               ),
               enableColumnFilter: true,
             },
        {
            accessorKey: "customer_po_number",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="PO Number" />
            ),
            cell: ({ row }) => (
                <div className="font-medium">{row.original.customer_po_number}</div>
            ),
            enableColumnFilter: false,
            enableSorting: false, 

            size: 150,
        },
        {
            accessorKey: "customer_po_value_inctax",
            header: ({ column }) => (
                <div className="text-right">
                    <DataTableColumnHeader column={column} title="Value (Incl. Tax)" />
                </div>
            ),
            cell: ({ row }) => (
                <div className="text-left font-mono pr-4">
                    {formatToRoundedIndianRupee(row.original.customer_po_value_inctax)}
                </div>
            ),
            enableColumnFilter: false,
            enableSorting: false, 

            size: 150,
        },
        {
            accessorKey: "customer_po_value_exctax",
            header: ({ column }) => (
                <div className="text-right">
                    <DataTableColumnHeader column={column} title="Value (Excl. Tax)" />
                </div>
            ),
        
            cell: ({ row }) => (
                <div className="text-left font-mono pr-4">
                    {formatToRoundedIndianRupee(row.original.customer_po_value_exctax)}
                </div>
            ),
            enableColumnFilter: false,
            enableSorting: false, 


            size: 150,
        },
        // // Only show Project column if fetching all POs (projectId is undefined)
        // ...(projectId ? [{
        //     accessorKey: "project_name",
        //     header: ({ column }) => (
        //         <DataTableColumnHeader column={column} title="Project" />
        //     ),
        //     cell: ({ row }) => (
        //         <div className="text-blue-600 truncate">{row.original.project_name}</div>
        //     ),
        //     enableColumnFilter: true,
        //     size: 200,
        // } as ColumnDef<CustomerPOTableRow>] : []),
        
       {
            accessorKey: "customer_po_payment_terms",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Payment Terms" />
            ),
            cell: ({ row }) => (
                // CHANGED: Use ShadCN/Radix Tooltip for styled hover text
                <TooltipProvider delayDuration={100}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            {/* The inner div is what is visible and truncated */}
                            <div className="text-sm text-blue-600 truncate link underline underline-blue underline-offset-2 cursor-help">
                                {row.original.customer_po_payment_terms || 'N/A'}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs whitespace-normal break-words">
                            <p>{row.original.customer_po_payment_terms || 'No payment terms specified.'}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            ),
            enableColumnFilter: false,
            enableSorting: false, 

            size: 150, 
        },
        {
            id: "Link/ Attachment",
            header: () => <div className="text-center">Link / Attachment</div>,
            cell: ({ row }) => (
                <div className="flex justify-center gap-2">
                    {row.original.customer_po_link && (
                        <a href={row.original.customer_po_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800" title="PO Link">
                            <LinkIcon className="w-4 h-4"/>
                        </a>
                    )}
                    {row.original.customer_po_attachment && (
                        <a href={row.original.customer_po_attachment} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:text-green-800" title="PO Attachment">
                            <FileTextIcon className="w-4 h-4"/>
                        </a>
                    )}
                </div>
            ),
            enableColumnFilter: false,
            enableSorting: false, 


            meta: { excludeFromExport: true },
            size: 100,
        },
    ];

    return columns;
};
// --- END COLUMN DEFINITION ---


export const CustomerPODetailsCard: React.FC<CustomerPODetailsCardProps> = ({ projectId }) => {
    
    // Custom logic to fetch the *single* project data for the Dialog
    const { 
        data: projectDataForDialog, 
        mutate: projectMutateForDialog,
        isLoading: projectDocLoading
    } = useFrappeGetDoc<any>( // Use 'any' as we only need the child table array
        "Projects", 
        projectId, // Pass the projectId directly as the doc name
        // Only enable the query if projectId is present
        { enabled: !!projectId } 
    );
    

    // console.log("CustomerPODetailsCard: projectDataForDialog =", projectDataForDialog);
    const poListForDialog = projectDataForDialog?.customer_po_details || [];
    const projectNameForDialog = projectDataForDialog?.name;
    // Memoized calculation of aggregates from the fetched PO list
   const calculatedAggregates = useMemo(() => {
        // Use reduce to sum up the values
        const totalIncl = poListForDialog.reduce((sum, po: CustomerPODetail) => 
            sum + parseNumber(po.customer_po_value_inctax, 0), 0);
        const totalExcl = poListForDialog.reduce((sum, po: CustomerPODetail) => 
            sum + parseNumber(po.customer_po_value_exctax, 0), 0);
        
        return { total_incl_tax: totalIncl, total_excl_tax: totalExcl };
    }, [poListForDialog]);
    // Memoize the additional filters based on projectId
    const additionalFilters = useMemo(() => {
        const filters: Array<[string, string, any]> = [];
        if (projectId) {
            // Filter the child table records by the parent project name
            // Assuming the child table has a link field back to Projects named 'parent'
            filters.push(['name', '=', projectId]);
        }
        return filters;
    }, [projectId]);

    // useServerDataTable Hook for the paginated PO list
    const {
        table,
        data: poDataForPage,
        totalCount,
        isLoading: listIsLoading,
        error: listError,
        aggregates, 
        isAggregatesLoading, 
        // ... other table props
        refetch, 

        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
    } = useServerDataTable<CustomerPOTableRow>({
        doctype: CUSTOMER_PO_CHILD_TABLE_DOCTYPE, // Use the child table DocType
        columns: useMemo(() => getCustomerPOColumns(projectId), [projectId]),
        fetchFields: CUSTOMER_PO_LIST_FIELDS_TO_FETCH as string[],
        searchableFields: CUSTOMER_PO_SEARCHABLE_FIELDS,
        defaultSort: '`tabCustomer PO Child Table`.customer_po_creation_date',
        urlSyncKey: projectId ? `po_child_list_${projectId}` : "po_child_list_all",
        additionalFilters: additionalFilters, // Apply project filter here
        // aggregatesConfig: CUSTOMER_PO_AGGREGATES_CONFIG, 
    });

    // console.log("poDataForPage",poDataForPage)

    // Handler to refetch data after a new PO is added
    const handlePoAdded = async () => {
        // 1. Refetch the main data table
        await refetch();
        await projectMutateForDialog(); 
        // 3. Refetch the parent component's data (if needed)
    }


     const isDataInvalid = useMemo(() => {
        // Check if the data is fetched (not loading) and is an array with at least one element,
        // AND the first element has a null/empty po number.
        if (!listIsLoading && poDataForPage?.length > 0) {
            const firstPo = poDataForPage[0];
            // Check for explicit null, undefined, or empty string
            if (!firstPo.customer_po_number) {
                // console.log("Data integrity issue: First PO record has no PO number.", firstPo);
                return true;
            }
        }
        return false;
    }, [poDataForPage, listIsLoading]);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex justify-between items-center">
                     <p className="text-2xl">Customer PO Details</p>
                    {/* <p className="text-2xl">Customer PO Details {projectId ? `for ${poDataForPage?.[0]?.project_name || projectId}` : 'Overview'}</p> */}
                    {projectId && projectNameForDialog && (
                        <AddCustomerPODialog 
                            projectName={projectNameForDialog}
                            currentCustomerPODetails={poListForDialog as CustomerPODetail[]}
                            refetchProjectData={handlePoAdded} 
                        />
                    )}
                </CardTitle>
                
                {/* Aggregates Summary Card - Directly using aggregates from useServerDataTable */}
                <CardDescription className="pt-2">
                    <div className="grid grid-cols-2 gap-4 text-sm font-semibold p-3 border rounded-md bg-gray-50">
                        {/* Use projectDocLoading as the aggregate loading indicator */}
                        {projectDocLoading ? (
                            <div className="col-span-2 flex justify-center py-2"><TailSpin height={20} width={20} color="#4f46e5" /></div>
                        ) : (
                            <>
                                <p className="flex justify-between">
                                    <span>Total PO Value (Incl. Tax):</span>
                                    <span className="text-blue-600">
                                        {/* CORRECTED: Use calculatedAggregates.total_incl_tax */}
                                        {formatToRoundedIndianRupee(calculatedAggregates.total_incl_tax)}
                                    </span>
                                </p>
                                <p className="flex justify-between">
                                    <span>Total PO Value (Excl. Tax):</span>
                                    <span className="text-blue-600">
                                        {/* CORRECTED: Use calculatedAggregates.total_excl_tax */}
                                        {formatToRoundedIndianRupee(calculatedAggregates.total_excl_tax)}
                                    </span>
                                </p>
                                
                            </>
                        )}
                    </div>
                </CardDescription>

                {/* END Aggregates Display */}
            </CardHeader>
            <CardContent>
               {listIsLoading && !poDataForPage?.length ? (
                    <div className="flex items-center justify-center p-8"><TailSpin color={"red"} height={20} width={20} /></div>
                ) : (isDataInvalid ? (
                    // Display message when data is available but the first record is invalid
                    <div className="flex items-center justify-center p-8 text-gray-500 font-semibold">
                        <Info className="w-5 h-5 mr-2 text-yellow-600"/>
                        Data is not available or contains invalid records. Please check the source data.
                    </div>
                ) : (
                    // Render the table if data is fetched and valid (or empty, which the DataTable handles)
                    <DataTable<CustomerPOTableRow>
                        table={table}
                        columns={table.options.columns}
                        isLoading={listIsLoading}
                        error={listError}
                        totalCount={totalCount}
                        searchFieldOptions={CUSTOMER_PO_SEARCHABLE_FIELDS}
                        selectedSearchField={selectedSearchField}
                        onSelectedSearchFieldChange={setSelectedSearchField}
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                        facetFilterOptions={{}} // Add facet options if needed
                        dateFilterColumns={CUSTOMER_PO_DATE_COLUMNS}
                        showExportButton={true}
                        onExport={"default"}
                        exportFileName={`Customer_PO_Details_${projectId || "all"}`}
                        showRowSelection={false}
                    />
                ))}
            </CardContent>
        </Card>
    );
};       