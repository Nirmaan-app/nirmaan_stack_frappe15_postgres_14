// // CustomerPODetailsCard.tsx (Updated with useServerDataTable)

// import React, { useMemo } from "react";
// import { ColumnDef } from "@tanstack/react-table";
// import { LinkIcon, FileTextIcon, CirclePlus, Info, } from "lucide-react";
// import { TailSpin } from "react-loader-spinner";
// import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
// import { DataTable, SearchFieldOption, } from "@/components/data-table/new-data-table"; // Assuming new-data-table exports DataTable
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { useServerDataTable, SimpleAggregationConfig, CustomAggregationConfig } from "@/hooks/useServerDataTable"; // Import the hook and types
// import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
// import { AddCustomerPODialog, CustomerPODetail } from "./AddCustomerPODialog"; 
// import { useFrappeGetDocList ,useFrappeGetDoc} from "frappe-react-sdk"; // Needed to fetch current POs for the dialog
// import { parseNumber } from "@/utils/parseNumber"; // Utility to convert string/unknown to number
// import { formatDate } from "@/utils/FormatDate";
// // NEW IMPORTS: Tooltip components (assuming standard ShadCN/Radix paths)
// import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
// import { EditCustomerPODialog } from "./EditCustomerPODialog";


// // --- NEW CONSTANTS (Simulating a constant file) ---
// const CUSTOMER_PO_CHILD_TABLE_DOCTYPE = 'Projects'; // ASSUMPTION
// export const CUSTOMER_PO_LIST_FIELDS_TO_FETCH = [
//     'name','project_name',
//     '`tabCustomer PO Child Table`.customer_po_number', 
//     '`tabCustomer PO Child Table`.customer_po_value_inctax',
//     '`tabCustomer PO Child Table`.customer_po_value_exctax', 
//     '`tabCustomer PO Child Table`.customer_po_link', 
//     '`tabCustomer PO Child Table`.customer_po_attachment', 
//     '`tabCustomer PO Child Table`.customer_po_payment_terms',
//     '`tabCustomer PO Child Table`.customer_po_creation_date',

// ];
// export const CUSTOMER_PO_SEARCHABLE_FIELDS: SearchFieldOption[] = [
//     { value: "customer_po_number", label: "PO Number", default: true },
//     // { value: "project_name", label: "Project Name" },
// ];
// export const CUSTOMER_PO_DATE_COLUMNS: string[] = ["creation", "customer_po_creation_date"];
// // const CUSTOMER_PO_AGGREGATES_CONFIG: (SimpleAggregationConfig | CustomAggregationConfig)[] = [
// //     { field: 'customer_po_value_inctax', function: 'sum', alias: 'total_incl_tax' }, 
// //     { field: 'customer_po_value_exctax', function: 'sum', alias: 'total_excl_tax' }, 
// // ];
// // --- END CONSTANTS ---

// // Data structure for the table rows
// interface CustomerPOTableRow extends CustomerPODetail {
//     project: string; // The parent Project DocName (from 'parent as project' alias)
//     handleEditClick: () => Promise<any>; 
// }

// interface CustomerPODetailsCardProps {
//     projectId?: string; 
//     refetchProjectData: () => Promise<any>; 
// }


// // --- COLUMN DEFINITION (similar to getCreditsColumns) ---
// const getCustomerPOColumns = (
//   projectId?: string,
//   handleEditClick?: (po: CustomerPOTableRow) => void
// ): ColumnDef<CustomerPOTableRow>[] => {
    
//     const columns: ColumnDef<CustomerPOTableRow>[] = [
//              {
//                // Date -> Center Align
//                accessorKey: "customer_po_creation_date",
//                header: ({ column }) => (
//                  <div className="flex justify-center">
//                    <DataTableColumnHeader column={column} title="Creation" />
//                  </div>
//                ),
//                cell: ({ row }) => (
//                  <div className="text-left">{formatDate(row.original.customer_po_creation_date)}</div>
//                ),
//                enableColumnFilter: true,
//              },
//         {
//             accessorKey: "customer_po_number",
//             header: ({ column }) => (
//                 <DataTableColumnHeader column={column} title="PO Number" />
//             ),
//             cell: ({ row }) => (
//                 <div className="font-medium">{row.original.customer_po_number}</div>
//             ),
//             enableColumnFilter: false,
//             enableSorting: false, 

//             size: 150,
//         },
//         {
//             accessorKey: "customer_po_value_inctax",
//             header: ({ column }) => (
//                 <div className="text-right">
//                     <DataTableColumnHeader column={column} title="Value (Incl. Tax)" />
//                 </div>
//             ),
//             cell: ({ row }) => (
//                 <div className="text-left font-mono pr-4">
//                     {formatToRoundedIndianRupee(row.original.customer_po_value_inctax)}
//                 </div>
//             ),
//             enableColumnFilter: false,
//             enableSorting: false, 

//             size: 150,
//         },
//         {
//             accessorKey: "customer_po_value_exctax",
//             header: ({ column }) => (
//                 <div className="text-right">
//                     <DataTableColumnHeader column={column} title="Value (Excl. Tax)" />
//                 </div>
//             ),
        
//             cell: ({ row }) => (
//                 <div className="text-left font-mono pr-4">
//                     {formatToRoundedIndianRupee(row.original.customer_po_value_exctax)}
//                 </div>
//             ),
//             enableColumnFilter: false,
//             enableSorting: false, 


//             size: 150,
//         },
//         // // Only show Project column if fetching all POs (projectId is undefined)
//         // ...(projectId ? [{
//         //     accessorKey: "project_name",
//         //     header: ({ column }) => (
//         //         <DataTableColumnHeader column={column} title="Project" />
//         //     ),
//         //     cell: ({ row }) => (
//         //         <div className="text-blue-600 truncate">{row.original.project_name}</div>
//         //     ),
//         //     enableColumnFilter: true,
//         //     size: 200,
//         // } as ColumnDef<CustomerPOTableRow>] : []),
        
//        {
//             accessorKey: "customer_po_payment_terms",
//             header: ({ column }) => (
//                 <DataTableColumnHeader column={column} title="Payment Terms" />
//             ),
//             cell: ({ row }) => (
//                 // CHANGED: Use ShadCN/Radix Tooltip for styled hover text
//                 <TooltipProvider delayDuration={100}>
//                     <Tooltip>
//                         <TooltipTrigger asChild>
//                             {/* The inner div is what is visible and truncated */}
//                             <div className="text-sm text-blue-600 truncate link underline underline-blue underline-offset-2 cursor-help">
//                                 {row.original.customer_po_payment_terms || 'N/A'}
//                             </div>
//                         </TooltipTrigger>
//                         <TooltipContent className="max-w-xs whitespace-normal break-words">
//                             <p>{row.original.customer_po_payment_terms || 'No payment terms specified.'}</p>
//                         </TooltipContent>
//                     </Tooltip>
//                 </TooltipProvider>
//             ),
//             enableColumnFilter: false,
//             enableSorting: false, 

//             size: 150, 
//         },
//         {
//             id: "Link/ Attachment",
//             header: () => <div className="text-center">Link / Attachment</div>,
//             cell: ({ row }) => (
//                 <div className="flex justify-center gap-2">
//                     {row.original.customer_po_link && (
//                         <a href={row.original.customer_po_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800" title="PO Link">
//                             <LinkIcon className="w-4 h-4"/>
//                         </a>
//                     )}
//                     {row.original.customer_po_attachment && (
//                         <a href={row.original.customer_po_attachment} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:text-green-800" title="PO Attachment">
//                             <FileTextIcon className="w-4 h-4"/>
//                         </a>
//                     )}
//                 </div>
//             ),
//             enableColumnFilter: false,
//             enableSorting: false, 


//             meta: { excludeFromExport: true },
//             size: 100,
//         },
//         {
//     id: "actions",
//     header: () => <div className="text-center">Actions</div>,
//     cell: ({ row }) => {
//         const po = row.original;
//         return (
//             <div className="flex justify-center gap-3">
//                 <TooltipProvider delayDuration={100}>
//                     {/* Edit Icon */}
//                     <Tooltip>
//                         <TooltipTrigger asChild>
//                             <button
//                               onClick={() => handleEditClick(po)} // ✅ now triggers the dialog

//                                 className="text-blue-600 hover:text-blue-800 transition"
//                                 title="Edit PO"
//                             >
//                                 <CirclePlus className="w-4 h-4" />
//                             </button>
//                         </TooltipTrigger>
//                         <TooltipContent>Edit this Customer PO</TooltipContent>
//                     </Tooltip>
//                 </TooltipProvider>

//                 <TooltipProvider delayDuration={100}>
//                     {/* Delete Icon */}
//                     <Tooltip>
//                         <TooltipTrigger asChild>
//                             <button
//                                 onClick={() => console.log("Delete clicked:", po.customer_po_number)}
//                                 className="text-red-600 hover:text-red-800 transition"
//                                 title="Delete PO"
//                             >
//                                 <FileTextIcon className="w-4 h-4 rotate-45" />
//                             </button>
//                         </TooltipTrigger>
//                         <TooltipContent>Delete this Customer PO</TooltipContent>
//                     </Tooltip>
//                 </TooltipProvider>
//             </div>
//         );
//     },
//     enableColumnFilter: false,
//     enableSorting: false,
//     meta: { excludeFromExport: true },
//     size: 100,
// },

//     ];

//     return columns;
// };
// // --- END COLUMN DEFINITION ---


// export const CustomerPODetailsCard: React.FC<CustomerPODetailsCardProps> = ({ projectId }) => {
    
//     // Custom logic to fetch the *single* project data for the Dialog

//     // --- Edit Dialog State & Handlers ---
// const [selectedPO, setSelectedPO] = React.useState<CustomerPOTableRow | null>(null);
// const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);


// const handleEditClick = (po: CustomerPOTableRow) => {
//   setSelectedPO(po);
//   setIsEditDialogOpen(true);
// };

// const handleEditDialogClose = () => {
//   setIsEditDialogOpen(false);
//   setSelectedPO(null);
// };

// const handleEditSuccess = async () => {
//   await refetch();               // refresh the table
//   await projectMutateForDialog(); // refresh the aggregates
//   handleEditDialogClose();        // close dialog
// };

//     const { 
//         data: projectDataForDialog, 
//         mutate: projectMutateForDialog,
//         isLoading: projectDocLoading
//     } = useFrappeGetDoc<any>( // Use 'any' as we only need the child table array
//         "Projects", 
//         projectId, // Pass the projectId directly as the doc name
//         // Only enable the query if projectId is present
//         { enabled: !!projectId } 
//     );
    

//     // console.log("CustomerPODetailsCard: projectDataForDialog =", projectDataForDialog);
//     const poListForDialog = projectDataForDialog?.customer_po_details || [];
//     const projectNameForDialog = projectDataForDialog?.name;
//     // Memoized calculation of aggregates from the fetched PO list
//    const calculatedAggregates = useMemo(() => {
//         // Use reduce to sum up the values
//         const totalIncl = poListForDialog.reduce((sum, po: CustomerPODetail) => 
//             sum + parseNumber(po.customer_po_value_inctax, 0), 0);
//         const totalExcl = poListForDialog.reduce((sum, po: CustomerPODetail) => 
//             sum + parseNumber(po.customer_po_value_exctax, 0), 0);
        
//         return { total_incl_tax: totalIncl, total_excl_tax: totalExcl };
//     }, [poListForDialog]);
//     // Memoize the additional filters based on projectId
//     const additionalFilters = useMemo(() => {
//         const filters: Array<[string, string, any]> = [];
//         if (projectId) {
//             // Filter the child table records by the parent project name
//             // Assuming the child table has a link field back to Projects named 'parent'
//             filters.push(['name', '=', projectId]);
//         }
//         return filters;
//     }, [projectId]);

//     // useServerDataTable Hook for the paginated PO list
//     const {
//         table,
//         data: poDataForPage,
//         totalCount,
//         isLoading: listIsLoading,
//         error: listError,
//         aggregates, 
//         isAggregatesLoading, 
//         // ... other table props
//         refetch, 

//         searchTerm,
//         setSearchTerm,
//         selectedSearchField,
//         setSelectedSearchField,
//     } = useServerDataTable<CustomerPOTableRow>({
//         doctype: CUSTOMER_PO_CHILD_TABLE_DOCTYPE, // Use the child table DocType
//        columns: useMemo(() => getCustomerPOColumns(projectId, handleEditClick), [projectId]),

//         fetchFields: CUSTOMER_PO_LIST_FIELDS_TO_FETCH as string[],
//         searchableFields: CUSTOMER_PO_SEARCHABLE_FIELDS,
//         defaultSort: '`tabCustomer PO Child Table`.customer_po_creation_date',
//         urlSyncKey: projectId ? `po_child_list_${projectId}` : "po_child_list_all",
//         additionalFilters: additionalFilters, // Apply project filter here
//         // aggregatesConfig: CUSTOMER_PO_AGGREGATES_CONFIG, 
//     });

//     // console.log("poDataForPage",poDataForPage)

//     // Handler to refetch data after a new PO is added
//     const handlePoAdded = async () => {
//         // 1. Refetch the main data table
//         await refetch();
//         await projectMutateForDialog(); 
//         // 3. Refetch the parent component's data (if needed)
//     }


//      const isDataInvalid = useMemo(() => {
//         // Check if the data is fetched (not loading) and is an array with at least one element,
//         // AND the first element has a null/empty po number.
//         if (!listIsLoading && poDataForPage?.length > 0) {
//             const firstPo = poDataForPage[0];
//             // Check for explicit null, undefined, or empty string
//             if (!firstPo.customer_po_number) {
//                 // console.log("Data integrity issue: First PO record has no PO number.", firstPo);
//                 return true;
//             }
//         }
//         return false;
//     }, [poDataForPage, listIsLoading]);

//     return (
//         <Card>
//             <CardHeader>
//                 <CardTitle className="flex justify-between items-center">
//                      <p className="text-2xl">Customer PO Details</p>
//                     {/* <p className="text-2xl">Customer PO Details {projectId ? `for ${poDataForPage?.[0]?.project_name || projectId}` : 'Overview'}</p> */}
//                     {projectId && projectNameForDialog && (
//                         <AddCustomerPODialog 
//                             projectName={projectNameForDialog}
//                             currentCustomerPODetails={poListForDialog as CustomerPODetail[]}
//                             refetchProjectData={handlePoAdded} 
//                         />
//                     )}
//                     {selectedPO && (
//   <EditCustomerPODialog
//     open={isEditDialogOpen}
//     onOpenChange={setIsEditDialogOpen}
//     customerPO={selectedPO}
//     projectName={projectNameForDialog}
//     onSuccess={handleEditSuccess}
//   />
// )}
//                 </CardTitle>
                
//                 {/* Aggregates Summary Card - Directly using aggregates from useServerDataTable */}
//                 <CardDescription className="pt-2">
//                     <div className="grid grid-cols-2 gap-4 text-sm font-semibold p-3 border rounded-md bg-gray-50">
//                         {/* Use projectDocLoading as the aggregate loading indicator */}
//                         {projectDocLoading ? (
//                             <div className="col-span-2 flex justify-center py-2"><TailSpin height={20} width={20} color="#4f46e5" /></div>
//                         ) : (
//                             <>
//                                 <p className="flex justify-between">
//                                     <span>Total PO Value (Incl. Tax):</span>
//                                     <span className="text-blue-600">
//                                         {/* CORRECTED: Use calculatedAggregates.total_incl_tax */}
//                                         {formatToRoundedIndianRupee(calculatedAggregates.total_incl_tax)}
//                                     </span>
//                                 </p>
//                                 <p className="flex justify-between">
//                                     <span>Total PO Value (Excl. Tax):</span>
//                                     <span className="text-blue-600">
//                                         {/* CORRECTED: Use calculatedAggregates.total_excl_tax */}
//                                         {formatToRoundedIndianRupee(calculatedAggregates.total_excl_tax)}
//                                     </span>
//                                 </p>
                                
//                             </>
//                         )}
//                     </div>
//                 </CardDescription>

//                 {/* END Aggregates Display */}
//             </CardHeader>
//             <CardContent>
//                {listIsLoading && !poDataForPage?.length ? (
//                     <div className="flex items-center justify-center p-8"><TailSpin color={"red"} height={20} width={20} /></div>
//                 ) : (isDataInvalid ? (
//                     // Display message when data is available but the first record is invalid
//                     <div className="flex items-center justify-center p-8 text-gray-500 font-semibold">
//                         <Info className="w-5 h-5 mr-2 text-yellow-600"/>
//                         Data is not available or contains invalid records. Please check the source data.
//                     </div>
//                 ) : (
//                     // Render the table if data is fetched and valid (or empty, which the DataTable handles)
//                     <DataTable<CustomerPOTableRow>
//                         table={table}
//                         columns={table.options.columns}
//                         isLoading={listIsLoading}
//                         error={listError}
//                         totalCount={totalCount}
//                         searchFieldOptions={CUSTOMER_PO_SEARCHABLE_FIELDS}
//                         selectedSearchField={selectedSearchField}
//                         onSelectedSearchFieldChange={setSelectedSearchField}
//                         searchTerm={searchTerm}
//                         onSearchTermChange={setSearchTerm}
//                         facetFilterOptions={{}} // Add facet options if needed
//                         dateFilterColumns={CUSTOMER_PO_DATE_COLUMNS}
//                         showExportButton={true}
//                         onExport={"default"}
//                         exportFileName={`Customer_PO_Details_${projectId || "all"}`}
//                         showRowSelection={false}
//                     />
//                 ))}
//             </CardContent>
//         </Card>
//     );
// };       


// CustomerPODetailsCard.tsx (Updated with Delete Dialog and Logic)

import React, { useMemo, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { LinkIcon, FileTextIcon, CirclePlus, Info, FilePenLine, Trash2, Loader2 } from "lucide-react";
import { TailSpin } from "react-loader-spinner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DataTable, SearchFieldOption, } from "@/components/data-table/new-data-table"; 
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { useServerDataTable } from "@/hooks/useServerDataTable"; 
import { formatToRoundedIndianRupee } from "@/utils/FormatPrice";
import { AddCustomerPODialog, CustomerPODetail } from "./AddCustomerPODialog"; 
// Import useFrappePostCall and the dialog components for the delete dialog
import { useFrappeGetDoc, useFrappePostCall } from "frappe-react-sdk"; 
import { parseNumber } from "@/utils/parseNumber"; 
import { formatDate } from "@/utils/FormatDate";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EditCustomerPODialog } from "./EditCustomerPODialog"; // Assuming this is imported or defined elsewhere
import { Button } from "@/components/ui/button"; 
import { toast } from "@/components/ui/use-toast";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"; // Import dialog components

import { useUserData } from "@/hooks/useUserData";


// --- CONSTANTS ---
const CUSTOMER_PO_CHILD_TABLE_DOCTYPE = 'Projects'; // ASSUMPTION
export const CUSTOMER_PO_LIST_FIELDS_TO_FETCH = [
    'project_name',
    '`tabCustomer PO Child Table`.customer_po_number', 
    '`tabCustomer PO Child Table`.customer_po_value_inctax',
    '`tabCustomer PO Child Table`.customer_po_value_exctax', 
    '`tabCustomer PO Child Table`.customer_po_link', 
    '`tabCustomer PO Child Table`.customer_po_attachment', 
    '`tabCustomer PO Child Table`.customer_po_payment_terms',
    '`tabCustomer PO Child Table`.customer_po_creation_date',
    '`tabCustomer PO Child Table`.name' // Child row ID
];
export const CUSTOMER_PO_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: "customer_po_number", label: "PO Number", default: true },
];
export const CUSTOMER_PO_DATE_COLUMNS: string[] = ["creation", "customer_po_creation_date"];
const CUSTOM_API_DELETE_METHOD =  "nirmaan_stack.api.projects.add_customer_po.delete_customer_po";
// --- END CONSTANTS ---

// Data structure for the table rows
interface CustomerPOTableRow extends CustomerPODetail {
    project_name: string;
}

interface CustomerPODetailsCardProps {
    projectId?: string; 
    refetchProjectData: () => Promise<any>; 
    role:string;
}

// ----------------------------------------------------------------------
// --- NEW COMPONENT: DeleteCustomerPODialog (Defined under CustomerPODetailsCard) ---
// ----------------------------------------------------------------------

interface DeleteCustomerPODialogProps {
    open: boolean;
    onClose: () => void;
    poDetail: CustomerPODetail;
    projectName: string;
    refetchProjectData: () => Promise<void>;
}

export const DeleteCustomerPODialog: React.FC<DeleteCustomerPODialogProps> = ({ 
    open, 
    onClose, 
    poDetail, 
    projectName, 
    refetchProjectData 
}) => {
    
    const { call: CustomerPoDelete, loading: deleteLoading } = useFrappePostCall<{ message: string }>(CUSTOM_API_DELETE_METHOD); 
    
    const handleDelete = async () => {
        if (!projectName || !poDetail.name) {
            toast({ title: "Error", description: "Project Name or PO ID is missing.", variant: "destructive" });
            return;
        }

        try {
            // Call the backend API
            await CustomerPoDelete({
                project_name: projectName, // Parent DocName
                po_doc_name: poDetail.name // Child Row DocName
            });

            toast({ title: "Success", description: `Customer PO ${poDetail.customer_po_number} deleted successfully.`, variant: "success" });
            
            await refetchProjectData(); // Refresh data table and aggregates
            onClose();

        } catch (error: any) {
            console.error("Failed to delete PO:", error);
            // Extract a more meaningful error message
            const rawException = error?.exception;
            const errorMessage = rawException 
                ? rawException.split(': ').slice(1).join(': ').trim() 
                : (error?.messages?.[0]?.message || error?.message || "An unknown error occurred.");
            
            toast({ 
                title: "Error", 
                description: `Failed to delete Customer PO: ${errorMessage.replace(/<[^>]*>?/gm, '')}`, 
                variant: "destructive" 
            });
        }
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center text-red-600">
                        <Trash2 className="w-6 h-6 mr-2" /> Confirm Deletion
                    </DialogTitle>
                    <DialogDescription className="pt-2">
                        Are you absolutely sure you want to delete Customer PO: **{poDetail.customer_po_number}**? 
                        This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                
                <DialogFooter className="pt-4">
                    <Button variant="outline" onClick={onClose} disabled={deleteLoading}>
                        Cancel
                    </Button>
                    <Button 
                        variant="destructive" 
                        onClick={handleDelete} 
                        disabled={deleteLoading}
                    >
                        {deleteLoading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        {deleteLoading ? "Deleting..." : "Delete PO"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


// ----------------------------------------------------------------------
// --- COLUMN DEFINITION (Updated to pass delete handler) ---
// ----------------------------------------------------------------------
const getCustomerPOColumns = (
  projectId?: string,
  handleEditClick?: (po: CustomerPOTableRow) => void,
  handleDeleteClick?: (po: CustomerPOTableRow) => void,// PASSED
  role?: string
): ColumnDef<CustomerPOTableRow>[] => {
    
    const columns: ColumnDef<CustomerPOTableRow>[] = [
             {
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
               enableSorting: true,
             },
        {
            accessorKey: "customer_po_number",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="PO Number" />
            ),
            cell: ({ row }) => (
                <div className="font-medium truncate">{row.original.customer_po_number}</div>
            ),
            enableColumnFilter: false,
            enableSorting: true, 
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
            enableSorting: true, 
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
            enableSorting: true, 
            size: 150,
        },
       {
            accessorKey: "customer_po_payment_terms",
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title="Payment Terms" />
            ),
            cell: ({ row }) => {
                const raw = row.original.customer_po_payment_terms;
                let terms: { label: string; percentage: number; description: string }[] = [];
                let isStructured = false;
                try {
                    const parsed = JSON.parse(raw || '');
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        terms = parsed;
                        isStructured = true;
                    }
                } catch {
                    // Legacy plain text or empty
                }

                const cellLabel = isStructured
                    ? `${terms.length} term${terms.length > 1 ? 's' : ''}`
                    : (raw || 'N/A');

                return (
                    <TooltipProvider delayDuration={100}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="text-sm text-blue-600 truncate underline underline-offset-2 cursor-help">
                                    {cellLabel}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs p-0 bg-white border border-gray-200 rounded-lg shadow-lg" side="bottom">
                                {isStructured ? (
                                    <div>
                                        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-lg">
                                            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Payment Terms</p>
                                        </div>
                                        <div className="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
                                            {terms.map((t, i) => (
                                                <div key={i} className="px-3 py-2">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-xs font-semibold text-gray-800">{t.label}</span>
                                                        <span className="text-[11px] font-mono font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">{t.percentage}%</span>
                                                    </div>
                                                    {t.description && (
                                                        <p className="text-[11px] text-gray-500 mt-1 break-words leading-relaxed">{t.description}</p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="px-3 py-2">
                                        <p className="text-xs text-gray-600">{raw || 'No payment terms specified.'}</p>
                                    </div>
                                )}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                );
            },
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
        // ACTIONS COLUMN
          
        {
            id: "actions",
            header: () => <div className="text-center">Actions</div>,
            cell: ({ row }) => {
                const po = row.original;
                return (
                    <div className="flex justify-center gap-3">
                        {/* Edit Icon */}
                        <TooltipProvider delayDuration={100}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                      onClick={() => handleEditClick?.(po)}
                                      variant="ghost"
                                      className="h-8 w-8 p-0 text-blue-600 hover:text-blue-800 transition"
                                      title="Edit PO"
                                      disabled={!role||!projectId}
                                    >
                                        <FilePenLine className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Edit this Customer PO</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

                        {/* Delete Icon */}
                        <TooltipProvider delayDuration={100}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={() => handleDeleteClick?.(po)} // CALL DELETE HANDLER
                                        variant="ghost"
                                        className="h-8 w-8 p-0 text-red-600 hover:text-red-800 transition"
                                        title="Delete PO"
                                        disabled={!role||!projectId}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete this Customer PO</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                );
            },
            enableColumnFilter: false,
            enableSorting: false,
            meta: { excludeFromExport: true },
            size: 100,
        },
    ];

    return columns;
};
// --- END COLUMN DEFINITION ---


// ----------------------------------------------------------------------
// --- MAIN COMPONENT: CustomerPODetailsCard ---
// ----------------------------------------------------------------------

export const CustomerPODetailsCard: React.FC<CustomerPODetailsCardProps> = ({ projectId }) => {
    
      const {role} = useUserData();
      const isAdmin = role === "Nirmaan Admin Profile" || role === "Nirmaan PMO Executive Profile" 
    //   console.log("CustomerPODetailsCard: Current User Data =", role);
    
    // --- Edit Dialog State & Handlers ---
    const [selectedPO, setSelectedPO] = React.useState<CustomerPOTableRow | null>(null);
    const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);

    // --- Delete Dialog State & Handlers ---
    const [deletingPO, setDeletingPO] = React.useState<CustomerPOTableRow | null>(null);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);

    // --- Data Fetching ---
    const { 
        data: projectDataForDialog, 
        mutate: projectMutateForDialog,
        isLoading: projectDocLoading
    } = useFrappeGetDoc<any>(
        "Projects", 
        projectId,
        { enabled: !!projectId } 
    );
    
    // Ensure we have an array, even if undefined
    const poListForDialog: CustomerPOTableRow[] = useMemo(() => {
        return (projectDataForDialog?.customer_po_details || []) as CustomerPOTableRow[];
    }, [projectDataForDialog]);

    const projectNameForDialog = projectDataForDialog?.name;

    // --- Aggregate Calculation ---
    const calculatedAggregates = useMemo(() => {
        const totalIncl = poListForDialog.reduce((sum, po) => 
            sum + parseNumber(po.customer_po_value_inctax, 0), 0);
        const totalExcl = poListForDialog.reduce((sum, po) => 
            sum + parseNumber(po.customer_po_value_exctax, 0), 0);
        return { total_incl_tax: totalIncl, total_excl_tax: totalExcl };
    }, [poListForDialog]);

    // --- Filtering (Not used for client-side mode, but kept for reference) ---
    // const additionalFilters = useMemo(() => { ... }, [projectId]);


    // --- Edit Handlers Implementation ---
    const handleEditClick = (po: CustomerPOTableRow) => {
      setSelectedPO(po);
      setIsEditDialogOpen(true);
    };

    const handleEditDialogClose = useCallback(() => {
      setIsEditDialogOpen(false);
      setSelectedPO(null);
    }, []);

    // --- Delete Handlers Implementation ---
    const handleDeleteClick = useCallback((po: CustomerPOTableRow) => {
        setDeletingPO(po);
        setIsDeleteDialogOpen(true);
    }, []);

    const handleDeleteDialogClose = useCallback(() => {
        setIsDeleteDialogOpen(false);
        setDeletingPO(null);
    }, []);

    // --- useServerDataTable Hook (Client-Side Mode) ---
    // We pass `clientData` and `clientTotalCount` to enable client-side processing
    const {
        table,
        data: poDataForPage,
        totalCount,
        isLoading: listIsLoading,
        error: listError,
        refetch, 
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
    } = useServerDataTable<CustomerPOTableRow>({
        doctype: CUSTOMER_PO_CHILD_TABLE_DOCTYPE, // Kept as 'Projects' but not used for fetch
        columns: useMemo(() => getCustomerPOColumns(projectId, handleEditClick, handleDeleteClick,isAdmin), [projectId, isAdmin]), 
        fetchFields: CUSTOMER_PO_LIST_FIELDS_TO_FETCH as string[],
        searchableFields: CUSTOMER_PO_SEARCHABLE_FIELDS,
        defaultSort: 'customer_po_creation_date desc', // Client-side sort field
        urlSyncKey: projectId ? `po_child_list_${projectId}` : "po_child_list_all",
        
        // --- Client-Side Configuration ---
        clientData: poListForDialog,
        clientTotalCount: poListForDialog.length,
        shouldCache: false // Rely on useFrappeGetDoc's cache
    });

    // --- Refetch Handler (Shared for Add/Edit/Delete Success) ---
    const handleRefetchAllData = async () => {
        // Since we are using clientData derived from projectDataForDialog,
        // we just need to re-fetch the project document.
        await projectMutateForDialog(); 
        // We can also call refetch() but it might not do much in client-mode unless it resets states
        refetch();
    }
    const handlePoAdded = handleRefetchAllData; 

    const isDataInvalid = useMemo(() => {
        if (!listIsLoading && !projectDocLoading && poDataForPage?.length > 0) {
            // Check validity of first item if needed, or generally if data seems malformed
            const firstPo = poDataForPage[0];
            if (!firstPo.customer_po_number && !firstPo.name) {
                 return true;
            }
        }
        return false;
    }, [poDataForPage, listIsLoading, projectDocLoading]);

    const combinedLoading = listIsLoading || projectDocLoading;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex justify-between items-center">
                     <p className="text-2xl">Customer PO Details</p>
                    {projectId && projectNameForDialog && (
                        <AddCustomerPODialog 
                            projectName={projectNameForDialog}
                            currentCustomerPODetails={poListForDialog as CustomerPODetail[]}
                            refetchProjectData={handlePoAdded} 
                        />
                    )}
                    
                    {/* EDIT DIALOG */}
                    {selectedPO && projectNameForDialog && (
                        <EditCustomerPODialog
                            open={isEditDialogOpen}
                            onClose={handleEditDialogClose}
                            poDetail={selectedPO}
                            projectName={projectNameForDialog}
                            refetchProjectData={handleRefetchAllData}
                        />
                    )}
                    
                    {/* DELETE DIALOG (Using the component defined above) */}
                    {deletingPO && projectNameForDialog && (
                        <DeleteCustomerPODialog
                            open={isDeleteDialogOpen}
                            onClose={handleDeleteDialogClose}
                            poDetail={deletingPO}
                            projectName={projectNameForDialog}
                            refetchProjectData={handleRefetchAllData}
                        />
                    )}
                </CardTitle>
                
                {/* Aggregates Summary Card */}
                <CardDescription className="pt-2">
                    <div className="grid grid-cols-2 gap-4 text-sm font-semibold p-3 border rounded-md bg-gray-50">
                        {combinedLoading ? (
                            <div className="col-span-2 flex justify-center py-2"><TailSpin height={20} width={20} color="#4f46e5" /></div>
                        ) : (
                            <>
                                <p className="flex justify-between">
                                    <span>Total Custom PO Value (Incl. Tax):</span>
                                    <span className="text-blue-600">
                                        {formatToRoundedIndianRupee(calculatedAggregates.total_incl_tax)}
                                    </span>
                                </p>
                                <p className="flex justify-between">
                                    <span>Total Custom PO Value (Excl. Tax):</span>
                                    <span className="text-blue-600">
                                        {formatToRoundedIndianRupee(calculatedAggregates.total_excl_tax)}
                                    </span>
                                </p>
                            </>
                        )}
                    </div>
                </CardDescription>

            </CardHeader>
            <CardContent>
               {combinedLoading && !poDataForPage?.length ? (
                    <div className="flex items-center justify-center p-8"><TailSpin color={"red"} height={20} width={20} /></div>
                ) : (isDataInvalid ? (
                    <div className="flex items-center justify-center p-8 text-gray-500 font-semibold">
                        <Info className="w-5 h-5 mr-2 text-yellow-600"/>
                        Data is not available or contains invalid records. Please check the source data.
                    </div>
                ) : (
                    <DataTable<CustomerPOTableRow>
                        table={table}
                        columns={table.options.columns}
                        isLoading={combinedLoading}
                        error={listError}
                        totalCount={totalCount}
                        searchFieldOptions={CUSTOMER_PO_SEARCHABLE_FIELDS}
                        selectedSearchField={selectedSearchField}
                        onSelectedSearchFieldChange={setSelectedSearchField}
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                        facetFilterOptions={{}} 
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
