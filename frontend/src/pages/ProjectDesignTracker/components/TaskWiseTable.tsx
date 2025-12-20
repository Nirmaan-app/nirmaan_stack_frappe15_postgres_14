// frontend/src/pages/ProjectDesignTracker/components/TaskWiseTable.tsx

import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link as LinkIcon, MessageCircle, Edit } from "lucide-react";
import { toast } from '@/components/ui/use-toast';
import { TableSkeleton } from "@/components/ui/skeleton";

// DataTable imports
import { DataTable } from "@/components/data-table/new-data-table"; 
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"; 
import { useServerDataTable } from "@/hooks/useServerDataTable"; 
import { 
    ColumnDef,
    useReactTable,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues
} from "@tanstack/react-table";

// Type and Hook imports
import { DesignTrackerTask, AssignedDesignerDetail } from "../types"; 
import { useDesignMasters } from "../hooks/useDesignMasters"; 
import { TaskEditModal } from './TaskEditModal';
import { useFrappeUpdateDoc } from "frappe-react-sdk";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getUnifiedStatusStyle, getTaskSubStatusStyle ,formatDeadlineShort,getAssignedNameForDisplay } from "../utils";
import {dateFilterFn} from "@/utils/tableFilters"
// --- CONSTANTS ---
const PARENT_DOCTYPE = 'Project Design Tracker';
const CHILD_DOCTYPE = 'Design Tracker Task Child Table';

export const TASK_DATE_COLUMNS = ["deadline"];
// --- FLATTENED TASK TYPE ---
interface FlattenedTask extends DesignTrackerTask {
    project_name: string;
    parent_docname: string;
    tracker_status?: string;
}

// --- PROPS INTERFACE ---
interface TaskWiseTableProps {
    refetchList: () => void;
    searchTerm?: string;
    onSearchTermChange?: (term: string) => void;
    user_id: string; // Recieve from parent
    isDesignExecutive: boolean; // Receive from parent
}

// --- COLUMN DEFINITION ---
const getTaskWiseColumns = (
    handleEditClick: (task: FlattenedTask) => void,
    isDesignExecutive: boolean,
    checkIfUserAssigned: (task: FlattenedTask) => boolean
): ColumnDef<FlattenedTask>[] => {
    
    return [
        {
            // Project Name
            accessorKey: "project", 
            header: ({ column }) => <DataTableColumnHeader column={column} title="Project Name" />,
            cell: ({ row }) => (
                <Link 
                    to={`/design-tracker/${row.original.prjname}`} 
                    className="text-red-700 underline-offset-2 hover:underline font-medium"
                >
                    {row.original.project_name}
                </Link>
            ),
            enableColumnFilter: true,
        },
        {
            // Task Category
            accessorKey: "design_category",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Task Category" />,
            enableColumnFilter: true,
        },
        {
            // Task Name
            accessorKey: "task_name",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Task Name" />,
        },
      {
    // Deadlines
    id: "deadline",
    accessorKey: "deadline",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Deadlines"/>,
    cell: ({ row }) => (
        <div className={row.original.deadline ? "px-4" : "text-center"}>
            {row.original.deadline ? formatDeadlineShort(row.original.deadline) : '--'}
        </div>
    ),
    // filterFn: dateFilterFn,
},
        {
    // Assigned Designer - with filtering support
    id: "assigned_designers",
    accessorFn: (row) => {
        try {
            const designers = JSON.parse(row.assigned_designers || '{"list":[]}');
            return designers.list?.map((d: any) => d.designer_name || d.name).join(', ') || '';
        } catch {
            return '';
        }
    },
    header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned Designer" />,
    cell: ({ row }) => (
        <div className="text-left py-2">
            {getAssignedNameForDisplay(row.original)}
        </div>
    ),
    enableColumnFilter: true, // This will enable text-based filtering on the formatted value
},
        // ...(isDesignExecutive ? [] : [{
        //     // Assigned Designer
        //     id: "assigned_designers",
        //     header: ({ column }: { column: any }) => <DataTableColumnHeader column={column} title="Assigned Designer" />,
        //     cell: ({ row }: { row: any }) => (
        //         <div className="text-left py-2">
        //             {getAssignedNameForDisplay(row.original)}
        //         </div>
        //     ),
        // }]),
        
     {
    // Status
    accessorKey: "task_status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => (
        <div className="">
            <Badge 
            variant="outline"
                className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getUnifiedStatusStyle(row.original.task_status || '...')}`}
            >
                {row.original.task_status || '...'}
            </Badge>
        </div>
    ),
    enableColumnFilter: true,
},
{
    // Sub-Status
    accessorKey: "task_sub_status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Sub-Status" />,
    cell: ({ row }) => (
        <div className="">
            <Badge 
                variant="outline"
                className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getTaskSubStatusStyle(row.original.task_sub_status)}`}
            >
                {row.original.task_sub_status || '--'}
            </Badge>
        </div>
    ),
    enableColumnFilter: true,
},
       {
    // Link Column
    accessorKey: "file_link",
    header: () => <div className="text-center">Link</div>,
    cell: ({ row }) => (
        <div className="flex justify-start items-center">
        
                <TooltipProvider>
                    <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                            <a 
                                href={row.original.file_link} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="hover:scale-110 transition-transform"

                            >
                                <LinkIcon className={`h-6 w-6 p-1 bg-gray-100  rounded-md  ${row.original.file_link ? 'cursor-pointer text-blue-500' : 'text-gray-300'}`} />
                            </a>
                        </TooltipTrigger>
                        {row.original.file_link && (
                        <TooltipContent className="max-w-xs p-2 bg-white text-gray-900 border shadow-lg">
                            <a 
                                href={row.original.file_link} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="cursor-pointer hover:scale-110 transition-transform"
                            >
                                {row.original.file_link.substring(0, 30)}...
                            </a>
                        </TooltipContent>
                        )}
                    </Tooltip>
                </TooltipProvider>
            
        </div>
    ),
    size: 80, // Add this - restricts column width
    maxSize: 80, // Add this - maximum width
    meta: { excludeFromExport: true },
},
{
    // Comments Column
    accessorKey: "comments",
    header: () => <div className="text-center">Comments</div>,
    cell: ({ row }) => (
        <div className="flex justify-center items-center ">
            <TooltipProvider>
                <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                        <MessageCircle 
                            className={`h-6 w-6  p-1 bg-gray-100  rounded-md ${row.original.comments ? 'cursor-pointer text-gray-600 hover:scale-110 transition-transform' : 'text-gray-300'}`} 
                        />
                    </TooltipTrigger>
                    {row.original.comments && (
                        <TooltipContent className="max-w-xs p-2 bg-white text-gray-900 border shadow-lg">
                            <p className="text-xs">{row.original.comments}</p>
                        </TooltipContent>
                    )}
                </Tooltip>
            </TooltipProvider>
        </div>
    ),
    size: 100, // Add this - restricts column width
    maxSize: 100, // Add this - maximum width
    meta: { excludeFromExport: true },
},
        {
            // Actions Column
            id: "actions",
            header: () => <div className="text-center">Actions</div>,
            cell: ({ row }) => (
                // Cell content explicitly centered
                <div className="flex justify-start">
                    {(!isDesignExecutive || (isDesignExecutive && checkIfUserAssigned(row.original))) ? (
                        <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => {
                              console.log("Edit clicked for task:", row.original);
                              handleEditClick(row.original)}} 
                            className="h-8"
                        >
                            <Edit className="h-3 w-3 mr-1" /> Edit
                        </Button>
                    ) : (
                         <Button variant="outline" size="sm" className="h-8 opacity-50 cursor-not-allowed" disabled>
                            <Edit className="h-3 w-3 mr-1" /> Edit
                        </Button>
                    )}
                </div>
            ),
            meta: { excludeFromExport: true },
        },
    ];
};


// --- MAIN COMPONENT ---
export const TaskWiseTable: React.FC<TaskWiseTableProps> = ({ refetchList, user_id, isDesignExecutive }) => {
    
    const { usersList,statusOptions, subStatusOptions, categoryData,categories,FacetProjectsOptions } = useDesignMasters();
    const [editingTask, setEditingTask] = useState<FlattenedTask | null>(null);
    
    const checkIfUserAssigned = (task: FlattenedTask) => {
        const designerField = task.assigned_designers;
        if (!designerField) return false;
        
        let designers: AssignedDesignerDetail[] = [];
         if (designerField && typeof designerField === 'object' && Array.isArray((designerField as any).list)) {
            designers = (designerField as any).list;
        } else if (Array.isArray(designerField)) {
            designers = designerField;
        } else if (typeof designerField === 'string' && designerField.trim() !== '') {
            try {
                const parsed = JSON.parse(designerField);
                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list)) {
                    designers = parsed.list;
                } else if (Array.isArray(parsed)) {
                    designers = parsed;
                }
            } catch (e) {
                // JSON parsing failed
            }
        }
        return designers.some(d => d.userId === user_id);
    };

    // REMOVED: const { role, user_id } = useUserData();
    // REMOVED: const isDesignExecutive = role === "Nirmaan Design Executive Profile";

    // Hook for updating tasks
    const { updateDoc: updateTask } = useFrappeUpdateDoc();

    console.log("FacetProjectsOptions",FacetProjectsOptions)

   const TASK_FACET_FILTER_OPTIONS = {
    // 1. Project Name (uses parent doc field)
    "project": {
        title: "Project",
        options: FacetProjectsOptions||[], // Dynamic: Will be populated with distinct project names
    },
    // 2. Task Category (uses child doc field)
    "design_category": {
        title: "Category",
        options: categoryData?.map(cat => ({ label: cat.category_name, value: cat.category_name }))||[], // Dynamic/Static: Populate with master categories
    },
    // 3. Task Status (uses child doc field - known enum values)
    "task_status": {
        title: "Status",
        options:statusOptions ||[],
    },
    // 4. Task Sub-Status (uses child doc field)
    "task_sub_status": {
        title: "Sub-Status",
        options: subStatusOptions||[],
    },
    "assigned_designers": {
        title: "Assigned Designer",
        options: usersList?.map(user => ({ 
            label: user.full_name || user.name, 
            value: user.name 
        })) || [],
    },
};


    // Fetch fields from child table with parent reference
    // Following Frappe's child table field naming convention
    const SearchFieldOptions=[
        { value: "task_name", label: "Task Name", default: true },
        { value: "`tabProject Design Tracker`.project_name", label: "Project Name" },
        { value: "design_category", label: "Category" },

    ];
    const FETCH_FIELDS = [
        'name as prjname',
        "project_name",
        "project",
        "status",
        // Child table fields (Design Tracker Task)
        '`tabDesign Tracker Task Child Table`.name',                              // Child row DocName
        '`tabDesign Tracker Task Child Table`.task_name',                         // Task name
        '`tabDesign Tracker Task Child Table`.design_category',                   // Category
        '`tabDesign Tracker Task Child Table`.task_type',                         // Task type (optional)
        '`tabDesign Tracker Task Child Table`.deadline',                          // Deadline date
        '`tabDesign Tracker Task Child Table`.assigned_designers',                // JSON string field
        '`tabDesign Tracker Task Child Table`.task_status',                       // Status enum
        '`tabDesign Tracker Task Child Table`.task_sub_status',                   // Sub-status
        '`tabDesign Tracker Task Child Table`.file_link',                         // File link
        '`tabDesign Tracker Task Child Table`.comments',
        '`tabDesign Tracker Task Child Table`.modified',
          '`tabDesign Tracker Task Child Table`.assigned_designers',                            // Comments
        
        // Parent table fields (Project Design Tracker) - using backticks
       
    ];
  // Filters are now handled by Custom API logic or standard pass-through
  const additionalFilters = useMemo(() => {
     return [['Design Tracker Task Child Table', 'task_name', '!=', undefined]];
  }, []);
    // Use the server data table hook
    const serverDataTable = useServerDataTable<FlattenedTask>({
        doctype:PARENT_DOCTYPE , // Target Tasks directly
        apiEndpoint: 'nirmaan_stack.api.design_tracker.get_task_wise_list.get_task_wise_list',
        customParams: { user_id, is_design_executive: isDesignExecutive },
        columns: useMemo(() => getTaskWiseColumns(setEditingTask, isDesignExecutive, checkIfUserAssigned), [isDesignExecutive, user_id]), 
        fetchFields: FETCH_FIELDS,
        searchableFields: [
            { value: "task_name", label: "Task Name", default: true },
            { value: "project_name", label: "Project Name" }, // Field name match API alias
            { value: "design_category", label: "Category" },
        ],
        // defaultSort: 'modified desc',
        defaultSort: 'deadline asc', // Standard field name

        urlSyncKey: 'dt_task_wise',
        additionalFilters: additionalFilters,
    });

    // Client-side filtering removed as API handles it natively
    const table = useReactTable({
        data: serverDataTable.data || [],
        columns: serverDataTable.table.options.columns,
        getCoreRowModel: getCoreRowModel(),
        manualPagination: true, // Maintain manual pagination to sync with server
        pageCount: serverDataTable.table.getPageCount(),
        state: {
            pagination: serverDataTable.pagination,
            sorting: serverDataTable.sorting,
            columnFilters: serverDataTable.columnFilters,
            globalFilter: serverDataTable.searchTerm,
        },
        onPaginationChange: serverDataTable.setPagination,
        onSortingChange: serverDataTable.setSorting,
        onColumnFiltersChange: serverDataTable.setColumnFilters,
        onGlobalFilterChange: serverDataTable.setSearchTerm,
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
    });

    console.log("TaskWiseTable - serverDataTable", serverDataTable);
    // Task Save Handler
    const handleTaskSave = async (updatedFields: { [key: string]: any }) => {
        if (!editingTask) return;
        
        let fieldsToSend: { [key: string]: any } = { ...updatedFields };

        // Serialize assigned_designers if it's an array
        if (Array.isArray(updatedFields.assigned_designers)) { 
            const structuredDataForServer = { list: updatedFields.assigned_designers };
            fieldsToSend.assigned_designers = JSON.stringify(structuredDataForServer); 
        }

        try {
            // Update the child document directly
            await updateTask(CHILD_DOCTYPE, editingTask.name, fieldsToSend);
            
            toast({ 
                title: "Success", 
                description: "Task updated successfully.", 
                variant: "success" 
            });
            
            // Refresh both tables
            serverDataTable.refetch(); 
            refetchList(); 
            setEditingTask(null);
        } catch (error: any) {
            toast({ 
                title: "Save Failed", 
                description: error?.message || "Failed to save task.", 
                variant: "destructive" 
            });
        }
    };

    return (
        <>
            {serverDataTable.isLoading && !serverDataTable.data?.length ? (
                <TableSkeleton />
            ) : (
                <div className="overflow-x-auto  rounded-lg shadow-sm bg-white">
                    <DataTable<FlattenedTask>
                        table={table}
                        columns={table.options.columns}
                        isLoading={serverDataTable.isLoading}
                        error={serverDataTable.error}
                        // totalCount={serverDataTable?.data?.length}
                        totalCount={serverDataTable.totalCount}
                        searchFieldOptions={SearchFieldOptions}
                        selectedSearchField={serverDataTable.selectedSearchField}
                        onSelectedSearchFieldChange={serverDataTable.setSelectedSearchField}
                        facetFilterOptions= {TASK_FACET_FILTER_OPTIONS}
                        dateFilterColumns={TASK_DATE_COLUMNS}
                        searchTerm={serverDataTable.searchTerm}
                        onSearchTermChange={serverDataTable.setSearchTerm}
                        showExportButton={true}
                        exportFileName="Design_Tasks_Wise"
                        onExport="default"
                        tableHeight="60vh"
                    />
                </div>
            )}
             
            {/* Task Edit Modal */}
            {editingTask && (
                <TaskEditModal
                    isOpen={!!editingTask}
                    onOpenChange={(open) => { if (!open) setEditingTask(null); }}
                    task={editingTask}
                    onSave={handleTaskSave} 
                    usersList={usersList || []}
                    statusOptions={statusOptions}       // <-- Pass status options
                    subStatusOptions={subStatusOptions}
                    existingTaskNames={[]} // Not needed when editing is disabled
                    disableTaskNameEdit={true} 
                    isRestrictedMode={isDesignExecutive}
                />
            )}
        </>
    );
};





