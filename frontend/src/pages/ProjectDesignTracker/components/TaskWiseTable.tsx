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
import { ColumnDef } from "@tanstack/react-table";

// Type and Hook imports
import { DesignTrackerTask, AssignedDesignerDetail } from "../types"; 
import { useDesignMasters } from "../hooks/useDesignMasters"; 
import { TaskEditModal } from '../project-design-tracker-details';
import { useFrappeUpdateDoc } from "frappe-react-sdk";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
// --- CONSTANTS ---
const PARENT_DOCTYPE = 'Project Design Tracker';
const CHILD_DOCTYPE = 'Design Tracker Task Child Table';

export const TASK_DATE_COLUMNS = ["deadline"];
// --- FACET FILTER OPTIONS STRUCTURE --- // <-- 🎯 INSERT THIS BLOCK

// --- HELPER FUNCTIONS ---
const getOrdinalNum = (n: number) => n + (n > 0 ? ['th', 'st', 'nd', 'rd'][(n > 3 && n < 21) || n % 10 > 3 ? 0 : n % 10] : '');

const formatDate = (dateString: string): string => {
    if (!dateString) return '...';
    try {
        const date = new Date(dateString);
        const day = date.getDate();
        const month = date.toLocaleString('en-US', { month: 'short' });
        const year = date.getFullYear();
        return `${getOrdinalNum(day)} ${month}, ${year}`;
    } catch (e) { return '...'; }
};

const formatDeadlineShort = (dateString: string) => {
    if (!dateString) return '...';
    return formatDate(dateString).replace(/, 20(\d{2})$/, ', $1');
};

const getStatusBadgeStyle = (status: string) => {
    const lowerStatus = status?.toLowerCase() || '';
    
    if (lowerStatus.includes('in progress')) return 'bg-blue-100 text-blue-700 border-blue-500 rounded-full';
    if (lowerStatus.includes('on hold') || lowerStatus.includes('blocked')) return 'bg-yellow-100 text-yellow-700 border-yellow-500 rounded-full';
    if (lowerStatus.includes('done')) return 'bg-green-100 text-green-700 border-green-500 rounded-full';
    if (lowerStatus.includes('todo')) return 'bg-gray-100 text-gray-700 border-gray-300 rounded-full';
    return 'bg-gray-100 text-gray-700 border-gray-300 rounded-full';
};

const getSubStatusBadgeStyle = (subStatus?: string) => {
    if (!subStatus || subStatus === '...') return 'bg-gray-100 text-gray-700 border border-gray-300 rounded-full';
    
    const lowerSubStatus = subStatus.toLowerCase();
    if (lowerSubStatus.includes('clarification') || lowerSubStatus.includes('sub-status 1') || lowerSubStatus.includes('sub-status 2')) { 
        return 'bg-red-100 text-red-700 border border-red-500 rounded-full'; 
    }
    return 'bg-gray-100 text-gray-700 border border-gray-300 rounded-full';
};

// --- FLATTENED TASK TYPE ---
interface FlattenedTask extends DesignTrackerTask {
    project_name: string;
    parent_docname: string;
    tracker_status?: string;
}

// --- PROPS INTERFACE ---
interface TaskWiseTableProps {
    refetchList: () => void;
}

// // --- COLUMN DEFINITION ---
// const getTaskWiseColumns = (handleEditClick: (task: FlattenedTask) => void): ColumnDef<FlattenedTask>[] => {
    
//     return [
//         {
//             accessorKey: "project", 
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Project Name" />,
//             cell: ({ row }) => (
//                 <Link 
//                     to={`/design-tracker/${row.original.prjname}`} 
//                     className="text-red-700 underline-offset-2 hover:underline font-medium"
//                 >
//                     {row.original.project_name}
//                 </Link>
//             ),
//             enableColumnFilter: true,
//         },
//         {
//             accessorKey: "design_category",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Task Category" />,
//             enableColumnFilter: true,
//         },
//         {
//             accessorKey: "task_name",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Task Name" />,
//         },
//         {
//             accessorKey: "deadline",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Deadlines" />,
//             cell: ({ row }) => (
//                 <div className="whitespace-nowrap text-center">
//                     {row.original.deadline ? formatDeadlineShort(row.original.deadline) : '...'}
//                 </div>
//             ),
//         },
//         {
//             accessorKey: "task_status",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
//             cell: ({ row }) => (
//                 <Badge className={`h-7 px-3 justify-center ${getStatusBadgeStyle(row.original.task_status || '...')}`}>
//                     {row.original.task_status || '...'}
//                 </Badge>
//             ),
//             enableColumnFilter: true,
//         },
//         {
//             accessorKey: "task_sub_status",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Sub-Status" />,
//             cell: ({ row }) => (
//                 <Badge className={`h-7 px-3 justify-center ${getSubStatusBadgeStyle(row.original.task_sub_status)}`}>
//                     {row.original.task_sub_status || '...'}
//                 </Badge>
//             ),
//             enableColumnFilter: true,
//         },
//         {
//             id: "file_link",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Link" />,
//             cell: ({ row }) => (
//                 <div className="text-left">
                   
//                 {row.original.file_link ? (
//                                                                                            <TooltipProvider>
//                                                                                                <Tooltip delayDuration={300}>
//                                                                                                    <TooltipTrigger asChild>
//                                                                                                        <a 
//                                                                                                            href={row.original.file_link} 
//                                                                                                            target="_blank" 
//                                                                                                            rel="noopener noreferrer" 
//                                                                                                            className="block w-full h-full cursor-pointer hover:scale-110 transition-transform"
//                                                                                                        >
//                                                                                                            <LinkIcon className="h-4 w-4 text-blue-500 mx-auto" />
//                                                                                                        </a>
//                                                                                                    </TooltipTrigger>
//                                                                                                    <TooltipContent className="p-2 bg-gray-900 text-white shadow-lg">
//                                                                                                       <a 
//                                                                                                            href={row.original.file_link} 
//                                                                                                            target="_blank" 
//                                                                                                            rel="noopener noreferrer" 
//                                                                                                            className="block w-full h-full cursor-pointer hover:scale-110 transition-transform"
//                                                                                                        >
//                                                                                                            {row.original.file_link.substring(0, 30)}...
//                                                                                                        </a>
//                                                                                                    </TooltipContent>
//                                                                                                </Tooltip>
//                                                                                            </TooltipProvider>
//                                                                                        ) : (
//                                                                                            <LinkIcon className="h-4 w-4 text-gray-300 mx-auto" />
//                                                                                        )}
//                 </div>
//             ),
//             meta: { excludeFromExport: true },
//         },
//         {
//             id: "comments",
//             header: () => <div className="text-center">Comments</div>,
//             cell: ({ row }) => (
//                 <div className="text-left">
//                      <TooltipProvider>
//                                                                                            <Tooltip delayDuration={300}>
//                                                                                                <TooltipTrigger asChild>
//                                                                                                    {/* We use cursor-default here as the trigger handles the hover interaction */}
//                                                                                                    <MessageCircle 
//                                                                                                        className={`h-4 w-4 mx-auto cursor-default ${row.original.comments ? 'text-gray-600' : 'text-gray-300'}`} 
//                                                                                                    />
//                                                                                                </TooltipTrigger>
//                                                                                                {row.original.comments && (
//                                                                                                    <TooltipContent className="max-w-xs p-3 bg-white text-gray-900 border shadow-lg">
//                                                                                                        {/* <p className="font-semibold text-xs mb-1">Comments:</p> */}
//                                                                                                        <p className="text-sm">{row.original.comments}</p>
//                                                                                                    </TooltipContent>
//                                                                                                )}
//                                                                                            </Tooltip>
//                                                                                        </TooltipProvider>
//                 </div>
//             ),
//             meta: { excludeFromExport: true },
//         },
//         {
//             id: "actions",
//             header: () => <div className="text-center">Actions</div>,
//             cell: ({ row }) => (
//                 <div className="text-left">
//                     <Button 
//                         variant="outline" 
//                         size="sm" 
//                         onClick={() => {
//                           console.log("Edit clicked for task:", row.original);
//                           handleEditClick(row.original)}} 
//                         className="h-8"
//                     >
//                         <Edit className="h-3 w-3 mr-1" /> Edit
//                     </Button>
//                 </div>
//             ),
//             meta: { excludeFromExport: true },
//         },
//     ];
// };

// --- COLUMN DEFINITION ---
const getTaskWiseColumns = (handleEditClick: (task: FlattenedTask) => void): ColumnDef<FlattenedTask>[] => {
    
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
            accessorKey: "deadline",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Deadlines" />,
            cell: ({ row }) => (
                // Deadlines should be centered for visual consistency with the screenshot style
                <div className="whitespace-nowrap text-center">
                    {row.original.deadline ? formatDeadlineShort(row.original.deadline) : '...'}
                </div>
            ),
        },
        {
    // Status
    accessorKey: "task_status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => (
        <div className="flex justify-center">
            <Badge 
                className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getStatusBadgeStyle(row.original.task_status || '...')}`}
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
        <div className="flex justify-center">
            {row.original.task_sub_status ? (
                <Badge 
                    className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getSubStatusBadgeStyle(row.original.task_sub_status)}`}
                >
                    {row.original.task_sub_status}
                </Badge>
            ) : (
                "--"
            )}
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
                </div>
            ),
            meta: { excludeFromExport: true },
        },
    ];
};


// --- MAIN COMPONENT ---
export const TaskWiseTable: React.FC<TaskWiseTableProps> = ({ refetchList }) => {
    
    const { usersList,statusOptions, subStatusOptions, categoryData,categories,FacetProjectsOptions } = useDesignMasters();
    const [editingTask, setEditingTask] = useState<FlattenedTask | null>(null);

    console.log("categoryData",categoryData,categories,FacetProjectsOptions)
    // Hook for updating tasks
    const { updateDoc: updateTask } = useFrappeUpdateDoc();

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
};


    // Fetch fields from child table with parent reference
    // Following Frappe's child table field naming convention
    const SearchFieldOptions=[
        { value: "task_name", label: "Task Name", default: true },
        { value: "`tabProject Design Tracker`.project_name", label: "Project Name" },
        { value: "design_category", label: "Category" },
    ];
    const FETCH_FIELDS = [
        "name as prjname",
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

    // Use the server data table hook
    const serverDataTable = useServerDataTable<FlattenedTask>({
        doctype: PARENT_DOCTYPE, 
        columns: useMemo(() => getTaskWiseColumns(setEditingTask), []), 
        fetchFields: FETCH_FIELDS,
        searchableFields: [
            { value: "task_name", label: "Task Name", default: true },
            { value: "`tabProject Design Tracker`.project_name", label: "Project Name" },
            { value: "design_category", label: "Category" },
        ],
        // defaultSort: 'modified desc',
        defaultSort: '`tabDesign Tracker Task Child Table`.modified desc',

        urlSyncKey: 'dt_task_wise',
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
                        table={serverDataTable.table}
                        columns={serverDataTable.table.options.columns}
                        isLoading={serverDataTable.isLoading}
                        error={serverDataTable.error}
                        totalCount={serverDataTable?.data?.length}
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
                />
            )}
        </>
    );
};

