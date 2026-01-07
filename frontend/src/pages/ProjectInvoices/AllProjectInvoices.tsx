import React, { useState, useMemo, useCallback } from "react";
import { FrappeDoc, GetDocListArgs, useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { TableSkeleton } from "@/components/ui/skeleton";

import { memoize } from 'lodash';
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
import {
  getProjectInvoiceColumns,
  DOCTYPE,
  PROJECT_INVOICE_FIELDS_TO_FETCH,
  PROJECT_INVOICE_SEARCHABLE_FIELDS,
  PROJECT_INVOICE_DATE_COLUMNS,
} from "./config/projectInvoices.config"
import { useUserData } from "@/hooks/useUserData";
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { getCustomerListOptions, getProjectListOptions, queryKeys } from "@/config/queryKeys";
import { useFacetValues } from "@/hooks/useFacetValues";
import { toast } from "@/components/ui/use-toast";
import { DataTable } from "@/components/data-table/new-data-table";
import { NewProjectInvoiceDialog } from "./components/NewProjectInvoiceDialog"; // Import the renamed/refactored create dialog
import { EditProjectInvoiceDialog } from "./components/EditProjectInvoiceDialog"; // Import the new edit dialog
import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
import { Projects } from "@/types/NirmaanStack/Projects";
import { useDialogStore } from "@/zustand/useDialogStore"; // For managing edit dialog state
import { Customers } from "@/types/NirmaanStack/Customers";
import { NirmaanUsers } from "@/types/NirmaanStack/NirmaanUsers";

export const AllProjectInvoices: React.FC<{ projectId?: string; customerId?: string }> = ({ projectId }) => {
    
    // =================================================================================
    // 1. STATE & ROLE MANAGEMENT
    // =================================================================================
    const { role } = useUserData();
    const isAdmin = role === "Nirmaan Admin Profile";

    const { 
        setEditProjectInvoiceDialog // Get the setter for edit dialog
    } = useDialogStore();

    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [invoiceToDelete, setInvoiceToDelete] = useState<ProjectInvoice | null>(null);
    // --- (Indicator) NEW: State for invoice to edit ---
    const [invoiceToEdit, setInvoiceToEdit] = useState<ProjectInvoice | null>(null);

    // =================================================================================
    // 2. DATA FETCHING (LOOKUPS & MAIN DATA)
    // =================================================================================
    
    const projectsFetchOptions = getProjectListOptions();
    const { data: projects, isLoading: isProjectsLoading } = useFrappeGetDocList<Projects>(
        "Projects", 
        projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, 
        queryKeys.projects.list(projectsFetchOptions)
    );

    const customersFetchOptions = getCustomerListOptions();
    const { data: customers, isLoading: isCustomersLoading } = useFrappeGetDocList<Customers>(
        "Customers", 
        customersFetchOptions as GetDocListArgs<FrappeDoc<Customers>>, 
        queryKeys.customers.list(customersFetchOptions)
    );

    // --- (2) NEW: Fetch user data for name mapping and filtering ---
    const { data: users, isLoading: isUsersLoading } = useFrappeGetDocList<NirmaanUsers>(
        "Nirmaan Users",
        { fields: ["name", "full_name"], orderBy: {field:"full_name", order: "asc"}, limit: 0 } // Fetch all users
    );

    const { deleteDoc, loading: isDeleting } = useFrappeDeleteDoc();

    // =================================================================================
    // 3. CALLBACKS & MEMOIZED VALUES
    // =================================================================================
    const getProjectName = useCallback(
      memoize((projId?: string) => projects?.find(p => p.name === projId)?.project_name || projId || "--"),
      [projects]
    );

    const getCustomerName = useCallback(
      memoize((custId?: string) => customers?.find(p => p.name === custId)?.company_name || custId || "--"),
      [customers]
    );
    // --- (3) NEW: Create a memoized resolver function for user names ---
    const getUserName = useCallback(
      memoize((userId?: string) => users?.find(u => u.name === userId)?.full_name || userId || "--"),
      [users]
    );

    const handleOpenDeleteDialog = useCallback((invoice: ProjectInvoice) => {
        setInvoiceToDelete(invoice);
        setIsDeleteDialogOpen(true);
    }, []);

    // --- (Indicator) NEW: Handler to open edit dialog ---
    const handleOpenEditDialog = useCallback((invoice: ProjectInvoice) => {
        setInvoiceToEdit(invoice);
        setEditProjectInvoiceDialog(true); // Open dialog via Zustand store
    }, [setEditProjectInvoiceDialog]);

    const confirmDelete = async () => {
        if (!invoiceToDelete) return;
        try {
            await deleteDoc(DOCTYPE, invoiceToDelete.name);
            toast({ title: "Success!", description: "Invoice deleted successfully.", variant: "success" });
            refetch();
        } catch (error: any) {
            toast({ title: "Deletion Failed!", description: error?.message || "An unknown error occurred.", variant: "destructive" });
        } finally {
            setIsDeleteDialogOpen(false);
            setInvoiceToDelete(null);
        }
    };

    const tableColumns = useMemo(
        () => getProjectInvoiceColumns({
            isAdmin,
            getProjectName,
            getCustomerName,
            getUserName, // --- (4) NEW: Pass the user name resolver ---
            onDelete: handleOpenDeleteDialog,
            onEdit: handleOpenEditDialog, // --- (Indicator) Pass onEdit handler ---
        }),
        [isAdmin, getProjectName, getCustomerName, getUserName, handleOpenDeleteDialog, handleOpenEditDialog] // Add handleOpenEditDialog to dependencies
    );

    const {      
        table,
        data: projectInvoicesData,
        isLoading: isDataLoading,
        error: dataError,
        totalCount,
        searchTerm, setSearchTerm,
        selectedSearchField, setSelectedSearchField,
        columnFilters, // Added columnFilters
        refetch
    } = useServerDataTable<ProjectInvoice>({
        doctype: DOCTYPE,
        columns: tableColumns,
        additionalFilters: projectId ? [["project", "=", projectId]] : [],
        fetchFields: PROJECT_INVOICE_FIELDS_TO_FETCH,
        searchableFields: PROJECT_INVOICE_SEARCHABLE_FIELDS,
        urlSyncKey: `project_invoices_${projectId || 'all'}`,
        defaultSort: 'invoice_date desc',
    });

    // --- Dynamic Facet Values ---
    const { facetOptions: projectFacetOptions, isLoading: isProjectFacetLoading } = useFacetValues({
        doctype: DOCTYPE,
        field: 'project',
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        enabled: true
    });

    const { facetOptions: customerFacetOptions, isLoading: isCustomerFacetLoading } = useFacetValues({
        doctype: DOCTYPE,
        field: 'customer',
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        enabled: true
    });

    const { facetOptions: ownerFacetOptions, isLoading: isOwnerFacetLoading } = useFacetValues({
        doctype: DOCTYPE,
        field: 'owner',
        currentFilters: columnFilters,
        searchTerm,
        selectedSearchField,
        enabled: true
    });

    const facetOptionsConfig = useMemo(() => ({
        project: { title: "Project", options: projectFacetOptions, isLoading: isProjectFacetLoading },
        customer: { title: "Customer", options: customerFacetOptions, isLoading: isCustomerFacetLoading },
        owner: { title: "Created By", options: ownerFacetOptions, isLoading: isOwnerFacetLoading },
    }), [projectFacetOptions, isProjectFacetLoading, customerFacetOptions, isCustomerFacetLoading, ownerFacetOptions, isOwnerFacetLoading]);
      
    // =================================================================================
    // 4. RENDER LOGIC
    // =================================================================================
    const isLoadingOverall = isDataLoading || isProjectsLoading || isCustomersLoading || isUsersLoading;

    return (
        <div className="flex-1 space-y-4">
            {(isLoadingOverall && !projectInvoicesData?.length) ? (
                <TableSkeleton />
            ) : (
                <DataTable<ProjectInvoice>
                    table={table}
                    columns={tableColumns}
                    isLoading={isLoadingOverall}
                    error={dataError as Error | null}
                    totalCount={totalCount}
                    searchFieldOptions={PROJECT_INVOICE_SEARCHABLE_FIELDS}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetFilterOptions={facetOptionsConfig}
                    dateFilterColumns={PROJECT_INVOICE_DATE_COLUMNS}
                    showExportButton={true}
                    onExport={'default'}
                    exportFileName={DOCTYPE}
                    showRowSelection={false}
                />
            )}
            
            {/* Render New Project Invoice Dialog */}
            <NewProjectInvoiceDialog 
                listMutate={refetch as any} 
                ProjectId={projectId}
                // onClose can be added if needed by NewProjectInvoiceDialog, but not strictly necessary for this split
            />

            {/* Render Edit Project Invoice Dialog conditionally */}
            {invoiceToEdit && (
                <EditProjectInvoiceDialog
                    invoiceToEdit={invoiceToEdit}
                    listMutate={refetch as any}
                    onClose={() => {
                        setInvoiceToEdit(null); 
                        // setEditProjectInvoiceDialog(false); // Dialog store handles its own closing via its onOpenChange
                    }}
                />
            )}

            <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete invoice
                            <strong className="px-1 font-semibold text-foreground">{invoiceToDelete?.invoice_no}</strong>
                            from the records.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setInvoiceToDelete(null)}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} disabled={isDeleting}>
                            {isDeleting ? "Deleting..." : "Continue"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AllProjectInvoices;

// import { toast } from "@/components/ui/use-toast";
// import { TableSkeleton } from "@/components/ui/skeleton";
// import { ProjectInvoice } from "@/types/NirmaanStack/ProjectInvoice";
// import { Projects } from "@/types/NirmaanStack/Projects";
// import { useServerDataTable } from '@/hooks/useServerDataTable';
// import { FrappeDoc, GetDocListArgs,useFrappeGetDocList ,useFrappeDeleteDoc } from "frappe-react-sdk";

// import React, { useMemo,useCallback } from "react";
// import { memoize } from "lodash";

// import { ProjectInvoiceDialog } from "./components/ProjectInvoiceDialog";

// import { PROJECT_INVOICE_FIELDS_TO_FETCH, PROJECT_INVOICE_SEARCHABLE_FIELDS, DOCTYPE,PROJECT_INVOICE_DATE_COLUMNS } from "./config/projectInvoices.config";
// import { getProjectListOptions, queryKeys } from "@/config/queryKeys";

// import { DataTable } from "@/components/data-table/new-data-table";
// import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
// interface SelectOption { label: string; value: string; }
// import { ColumnDef } from "@tanstack/react-table";
// import { Link } from "react-router-dom";

// import { formatDate } from "@/utils/FormatDate";
// import formatToIndianRupee from "@/utils/FormatPrice";
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import { dateFilterFn, facetedFilterFn } from "@/utils/tableFilters";



// export const AllProjectInvoices:  React.FC<{ projectId? : string, customerId?: string}> = ({ projectId, customerId}) => {

  

  

//     const projectsFetchOptions = getProjectListOptions();

//   const { data: projects, isLoading: projectsUiLoading, error: projectsUiError } = useFrappeGetDocList<Projects>(
//           "Projects", projectsFetchOptions as GetDocListArgs<FrappeDoc<Projects>>, queryKeys.projects.list(projectsFetchOptions)
//       );
//     const projectFacetOptions = useMemo<SelectOption[]>(() => projects?.map(p => ({ label: p.project_name, value: p.name })) || [], [projects]);

//   const getProjectName = useCallback(memoize((projId?: string) => projects?.find(p => p.name === projId)?.project_name || projId || "--"), [projects]);
    
//       const facetOptionsConfig = useMemo(() => ({
//             project: { title: "Project", options: projectFacetOptions },
//             }), [projectFacetOptions]);
    

//  const getProjectInvoiceColumns = (): ColumnDef<ProjectInvoice>[] => [
//   {
//     accessorKey: "invoice_no",
//     header: ({ column }) => <DataTableColumnHeader column={column} title="Invoice No" />,
//     cell: ({ row }) => (
//       // Corrected: The link should probably go to the invoice's detail page, not projects.
//       // row.original.name is the unique ID of the ProjectInvoice document (e.g., "PINV-00123").
//       <Link to={`${row.original.attachment}`} className="text-blue-600 hover:underline">
//         {row.original.invoice_no}
//       </Link>
//     ),
//     meta: { exportHeaderName: "Invoice No", exportValue: (row: ProjectInvoice) => row.invoice_no }
//   },
//   {
//     // If you fetch project details alongside the invoice, you could show project name
//     accessorKey: "project",
//     accessorFn: row => row.project || row.project, // For sorting/filtering if values are just IDs
//     header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
//     cell: ({ row }) => (
//       <Link to={`/projects/${row.original.project}`} className="text-blue-600 hover:underline">
//         {getProjectName(row.original.project)}
//       </Link>
//     ),
//     meta: {
//                     exportHeaderName: "Project",
//                     exportValue: (row) => {
//                         return getProjectName(row.project)
//                     }
//                 }, filterFn: facetedFilterFn,

//   },
//   {
//     accessorKey: "amount",
//     header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
//     cell: ({ row }) => <div className="tabular-nums">{formatToIndianRupee(row.original.amount)}</div>,
//     meta: { exportHeaderName: "Amount", exportValue: (row: ProjectInvoice) => row.amount, isNumeric: true }
//   },
//   {
//     accessorKey: "creation",
//     header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
//     cell: ({ row }) => <div>{formatDate(row.original.creation)}</div>,
//     meta: { exportHeaderName: "creation Date", exportValue: (row: ProjectInvoice) => formatDate(row.creation) }
//   },
//   {
//     accessorKey: "owner",
//     header: ({ column }) => <DataTableColumnHeader column={column} title="Created By" />,
//     cell: ({ row }) => <div>{row.original.owner}</div>,
//     meta: { exportHeaderName: "Created By", exportValue: (row: ProjectInvoice) => row.owner }
//   },
//   // Add other columns for owner, attachment, etc. as needed
// ];
//     const tableColumns =useMemo(() => getProjectInvoiceColumns(), []);
    
//   const {      
//           table,
//         data: projectInvoicesData, // This is Projects[] from the backend via useServerDataTable
//         isLoading: isProjectsInvoicesLoading,
//         error: projectsInvociesError,
//         totalCount,
//         searchTerm, setSearchTerm,
//         selectedSearchField, setSelectedSearchField,refetch
//       } = useServerDataTable<ProjectInvoice>({ // Generic is now Projects
//           doctype:DOCTYPE,
//           columns: tableColumns, // Pass the generated columns
//           filters: projectId ? [["project", "=", projectId]] : [],
//           fetchFields: PROJECT_INVOICE_FIELDS_TO_FETCH as string[],
//           searchableFields: PROJECT_INVOICE_SEARCHABLE_FIELDS, // For client-side search
//           urlSyncKey: "project_invoices", // Make specific if report type changes columns
//           defaultSort: 'creation desc',
//           enableRowSelection: false,

//       });
      

// const {deleteDoc, loading: deleteDocLoading} = useFrappeDeleteDoc()

// const handleDeleteInvoiceEntry = async(invoiceId: string) => {
//    try {
//         await deleteDoc(DOCTYPE, invoiceId);
//         await refetch();
        
//          toast({
//                         title: "Success!",
//                         description: `Invoice  deleted successfully.`,
//                         variant: "success"
//                     });
        
//       } catch (error: any) {
//         console.error("deleteTask error", error);
//         toast({
//           title: "Failed!",
//           description: error?.message || "Failed to delete task!",
//           variant: "destructive",
//         });
//       }
  
//   };
//   return (
//     <div className="flex-1 space-y-4">
     

// {(isProjectsInvoicesLoading && !projectInvoicesData?.length) ? (
//                 <LoadingFallback />
//             ) : (
//                 <DataTable<ProjectInvoice>
//                     table={table}
//                     columns={tableColumns}
//                     isLoading={isProjectsInvoicesLoading} // Overall loading state
//                     error={projectsInvociesError as Error | null}
//                     totalCount={totalCount}
//                     searchFieldOptions={PROJECT_INVOICE_SEARCHABLE_FIELDS}
//                     selectedSearchField={selectedSearchField}
//                     onSelectedSearchFieldChange={setSelectedSearchField}
//                     searchTerm={searchTerm}
//                     onSearchTermChange={setSearchTerm}
//                     facetFilterOptions={facetOptionsConfig}

//                     dateFilterColumns={PROJECT_INVOICE_DATE_COLUMNS}
//                     showExportButton={true}
//                     onExport={'default'}
//                     exportFileName={DOCTYPE} // Still useful for the handler
//                     showRowSelection={false}
//                 />
//             )}
    
//       {/* This renders the dialog and passes it the function to refresh the table */}
//       <ProjectInvoiceDialog listMutate={refetch} ProjectId={projectId} />
      

//     </div>
//   )
// };

// export default AllProjectInvoices;