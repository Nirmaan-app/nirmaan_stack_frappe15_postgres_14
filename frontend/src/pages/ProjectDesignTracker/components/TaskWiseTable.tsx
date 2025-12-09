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
import { TaskEditModal } from './TaskEditModal';
import { useFrappeUpdateDoc } from "frappe-react-sdk";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getStatusBadgeStyle,getTaskStatusStyle, getTaskSubStatusStyle ,formatDeadlineShort,getAssignedNameForDisplay} from "../utils";
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
}

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
            id:"deadline",
            accessorFn: (row) => row.original.deadline,
            // accessorKey: "deadline",
            header: ({ column }) => <DataTableColumnHeader column={column} title="Deadlines" />,
            cell: ({ row }) => (
                // Deadlines should be centered for visual consistency with the screenshot style
                <div className="whitespace-nowrap text-center">
                    {row.original.deadline ? formatDeadlineShort(row.original.deadline) : '...'}
                </div>
            ),
            filterFn: dateFilterFn,
        },
//         {
//     // Assigned Designer - with filtering support
//     id: "assigned_designers",
//     accessorFn: (row) => {
//         try {
//             const designers = JSON.parse(row.assigned_designers || '{"list":[]}');
//             return designers.list?.map((d: any) => d.designer_name || d.name).join(', ') || '';
//         } catch {
//             return '';
//         }
//     },
//     header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned Designer" />,
//     cell: ({ row }) => (
//         <div className="text-left py-2">
//             {getAssignedNameForDisplay(row.original)}
//         </div>
//     ),
//     enableColumnFilter: true, // This will enable text-based filtering on the formatted value
// },
       {
                // Assigned Designer
                id: "assigned_designers",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned Designer" />,
                cell: ({ row }) => (
                    <div className="text-left py-2">
                        {getAssignedNameForDisplay(row.original)}
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
            variant="outline"
                className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getTaskStatusStyle(row.original.task_status || '...')}`}
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
            variant="outline"

                    className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getTaskSubStatusStyle(row.original.task_sub_status)}`}
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
                />
            )}
        </>
    );
};


// // frontend/src/pages/ProjectDesignTracker/components/TaskWiseTable.tsx

// import React, { useMemo, useState } from "react";
// import { Link } from "react-router-dom";
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import { Link as LinkIcon, MessageCircle, Edit } from "lucide-react";
// import { toast } from '@/components/ui/use-toast';
// import { TableSkeleton } from "@/components/ui/skeleton";

// // DataTable imports
// import { DataTable } from "@/components/data-table/new-data-table"; 
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"; 
// import { useServerDataTable } from "@/hooks/useServerDataTable"; 
// import { ColumnDef } from "@tanstack/react-table";

// // Type and Hook imports
// import { DesignTrackerTask } from "../types"; 
// import { useDesignMasters } from "../hooks/useDesignMasters"; 
// import { TaskEditModal } from './TaskEditModal';
// import { useFrappeUpdateDoc } from "frappe-react-sdk";
// import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
// import { getTaskStatusStyle, getTaskSubStatusStyle ,formatDeadlineShort,getAssignedNameForDisplay} from "../utils";
// import { dateFilterFn } from "@/utils/tableFilters"

// // --- CONSTANTS ---
// const PARENT_DOCTYPE = 'Project Design Tracker';
// const CHILD_DOCTYPE = 'Design Tracker Task Child Table';

// export const TASK_DATE_COLUMNS = ["deadline"];

// // --- FLATTENED TASK TYPE ---
// interface FlattenedTask extends DesignTrackerTask {
//     project_name: string;
//     prjname: string; // Added this to match usage in columns
//     parent: string;
// }

// // --- PROPS INTERFACE ---
// interface TaskWiseTableProps {
//     refetchList: () => void;
// }

// // --- COLUMN DEFINITION ---
// const getTaskWiseColumns = (handleEditClick: (task: FlattenedTask) => void): ColumnDef<FlattenedTask>[] => {
    
//     return [
//         {
//             // Project Name
//             accessorKey: "project_name", 
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Project Name" />,
//             cell: ({ row }) => (
//                 <Link 
//                     // We mapped 'parent' to 'prjname' in fetchFields
//                     to={`/design-tracker/${row.original.prjname}`} 
//                     className="text-red-700 underline-offset-2 hover:underline font-medium"
//                 >
//                     {row.original.project_name}
//                 </Link>
//             ),
//             enableColumnFilter: true,
//         },
//         {
//             // Task Category
//             accessorKey: "design_category",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Task Category" />,
//             enableColumnFilter: true,
//         },
//         {
//             // Task Name
//             accessorKey: "task_name",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Task Name" />,
//         },
//         {
//             // Deadlines
//             id:"deadline",
//             accessorFn: (row) => row.deadline,
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Deadlines" />,
//             cell: ({ row }) => (
//                 <div className="whitespace-nowrap text-center">
//                     {row.original.deadline ? formatDeadlineShort(row.original.deadline) : '...'}
//                 </div>
//             ),
//             filterFn: dateFilterFn,
//         },
//         {
//             // Assigned Designer
//             id: "assigned_designers",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned Designer" />,
//             cell: ({ row }) => (
//                 <div className="text-left py-2">
//                     {getAssignedNameForDisplay(row.original)}
//                 </div>
//             ),
//         },
//         {
//             // Status
//             accessorKey: "task_status",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
//             cell: ({ row }) => (
//                 <div className="flex justify-center">
//                     <Badge 
//                         variant="outline"
//                         className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getTaskStatusStyle(row.original.task_status || '...')}`}
//                     >
//                         {row.original.task_status || '...'}
//                     </Badge>
//                 </div>
//             ),
//             enableColumnFilter: true,
//         },
//         {
//             // Sub-Status
//             accessorKey: "task_sub_status",
//             header: ({ column }) => <DataTableColumnHeader column={column} title="Sub-Status" />,
//             cell: ({ row }) => (
//                 <div className="flex justify-center">
//                     {row.original.task_sub_status ? (
//                         <Badge 
//                             variant="outline"
//                             className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getTaskSubStatusStyle(row.original.task_sub_status)}`}
//                         >
//                             {row.original.task_sub_status}
//                         </Badge>
//                     ) : (
//                         "--"
//                     )}
//                 </div>
//             ),
//             enableColumnFilter: true,
//         },
//         {
//             // Link Column
//             accessorKey: "file_link",
//             header: () => <div className="text-center">Link</div>,
//             cell: ({ row }) => (
//                 <div className="flex justify-start items-center">
//                     <TooltipProvider>
//                         <Tooltip delayDuration={300}>
//                             <TooltipTrigger asChild>
//                                 <a 
//                                     href={row.original.file_link} 
//                                     target="_blank" 
//                                     rel="noopener noreferrer" 
//                                     className="hover:scale-110 transition-transform"
//                                 >
//                                     <LinkIcon className={`h-6 w-6 p-1 bg-gray-100 rounded-md ${row.original.file_link ? 'cursor-pointer text-blue-500' : 'text-gray-300'}`} />
//                                 </a>
//                             </TooltipTrigger>
//                             {row.original.file_link && (
//                                 <TooltipContent className="max-w-xs p-2 bg-white text-gray-900 border shadow-lg">
//                                     <a 
//                                         href={row.original.file_link} 
//                                         target="_blank" 
//                                         rel="noopener noreferrer" 
//                                         className="cursor-pointer hover:scale-110 transition-transform"
//                                     >
//                                         {row.original.file_link.substring(0, 30)}...
//                                     </a>
//                                 </TooltipContent>
//                             )}
//                         </Tooltip>
//                     </TooltipProvider>
//                 </div>
//             ),
//             size: 80, 
//             maxSize: 80, 
//             meta: { excludeFromExport: true },
//         },
//         {
//             // Comments Column
//             accessorKey: "comments",
//             header: () => <div className="text-center">Comments</div>,
//             cell: ({ row }) => (
//                 <div className="flex justify-center items-center ">
//                     <TooltipProvider>
//                         <Tooltip delayDuration={300}>
//                             <TooltipTrigger asChild>
//                                 <MessageCircle 
//                                     className={`h-6 w-6 p-1 bg-gray-100 rounded-md ${row.original.comments ? 'cursor-pointer text-gray-600 hover:scale-110 transition-transform' : 'text-gray-300'}`} 
//                                 />
//                             </TooltipTrigger>
//                             {row.original.comments && (
//                                 <TooltipContent className="max-w-xs p-2 bg-white text-gray-900 border shadow-lg">
//                                     <p className="text-xs">{row.original.comments}</p>
//                                 </TooltipContent>
//                             )}
//                         </Tooltip>
//                     </TooltipProvider>
//                 </div>
//             ),
//             size: 100, 
//             maxSize: 100,
//             meta: { excludeFromExport: true },
//         },
//         {
//             // Actions Column
//             id: "actions",
//             header: () => <div className="text-center">Actions</div>,
//             cell: ({ row }) => (
//                 <div className="flex justify-start">
//                     <Button 
//                         variant="outline" 
//                         size="sm" 
//                         onClick={() => {
//                           handleEditClick(row.original)
//                         }} 
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


// // --- MAIN COMPONENT ---
// export const TaskWiseTable: React.FC<TaskWiseTableProps> = ({ refetchList }) => {
    
//     const { usersList, statusOptions, subStatusOptions, categoryData, FacetProjectsOptions } = useDesignMasters();
//     const [editingTask, setEditingTask] = useState<FlattenedTask | null>(null);

//     // Hook for updating tasks
//     const { updateDoc: updateTask } = useFrappeUpdateDoc();

//     const TASK_FACET_FILTER_OPTIONS = {
//         // 1. Project Name - mapped to 'parent' field in child table
//         "project_name": {
//             title: "Project",
//             options: FacetProjectsOptions || [], 
//         },
//         // 2. Task Category
//         "design_category": {
//             title: "Category",
//             options: categoryData?.map(cat => ({ label: cat.category_name, value: cat.category_name })) || [],
//         },
//         // 3. Task Status
//         "task_status": {
//             title: "Status",
//             options: statusOptions || [],
//         },
//         // 4. Task Sub-Status
//         "task_sub_status": {
//             title: "Sub-Status",
//             options: subStatusOptions || [],
//         },
//         // 5. Assigned Designer
//         "assigned_designers": {
//             title: "Assigned Designer",
//             options: usersList?.map(user => ({ 
//                 label: user.full_name || user.name, 
//                 value: user.name 
//             })) || [],
//         },
//     };

//     // --- UPDATED SEARCH OPTIONS ---
//     // Note: Standard 'get_list' on Child Tables cannot join Parent fields easily for searching (like parent.project_name).
//     // We search by 'parent' (Project ID) or internal child fields.
//     const SearchFieldOptions = [
//         { value: "task_name", label: "Task Name", default: true },
//         { value: "parent", label: "Project ID" }, 
//         { value: "design_category", label: "Category" },
//     ];

//     // --- UPDATED FETCH FIELDS FOR CHILD TABLE ---
//     const FETCH_FIELDS = [
//         "name",                  // Unique Task ID (e.g., 'row-id' or 'DT-TASK-001')
//         "task_name",
//         "design_category",
//         "task_type",
//         "deadline",
//         "assigned_designers",
//         "task_status",
//         "task_sub_status",
//         "file_link",
//         "comments",
//         "modified",
        
//         // PARENT MAPPING:
//         // In a Child Table, 'parent' holds the DocName of the Parent Doc (Project Design Tracker)
//         "parent", 
//         "parent as project",      // Map for accessorKey: 'project' (if used)
//         "parent as project_name", // Map for accessorKey: 'project_name'
//         "parent as prjname"       // Map for Link URL
//     ];

//     // Use the server data table hook with CHILD_DOCTYPE
//     const serverDataTable = useServerDataTable<FlattenedTask>({
//         // ✅ Switch to Child Doctype to get correct count (56 tasks instead of 9 projects)
//         doctype: CHILD_DOCTYPE, 
        
//         columns: useMemo(() => getTaskWiseColumns(setEditingTask), []), 
//         fetchFields: FETCH_FIELDS,
        
//         searchableFields: SearchFieldOptions,
        
//         // ✅ Sort by the child table's modified date
//         defaultSort: 'modified desc',

//         urlSyncKey: 'dt_task_wise',
//     });

//     // Task Save Handler
//     const handleTaskSave = async (updatedFields: { [key: string]: any }) => {
//         if (!editingTask) return;
        
//         let fieldsToSend: { [key: string]: any } = { ...updatedFields };

//         // Serialize assigned_designers if it's an array
//         if (Array.isArray(updatedFields.assigned_designers)) { 
//             const structuredDataForServer = { list: updatedFields.assigned_designers };
//             fieldsToSend.assigned_designers = JSON.stringify(structuredDataForServer); 
//         }

//         try {
//             // Update the child document directly.
//             // editingTask.name is now the Child Row Name (because we queried the Child Table)
//             await updateTask(CHILD_DOCTYPE, editingTask.name, fieldsToSend);
            
//             toast({ 
//                 title: "Success", 
//                 description: "Task updated successfully.", 
//                 variant: "success" 
//             });
            
//             // Refresh both tables
//             serverDataTable.refetch(); 
//             refetchList(); 
//             setEditingTask(null);
//         } catch (error: any) {
//             toast({ 
//                 title: "Save Failed", 
//                 description: error?.message || "Failed to save task.", 
//                 variant: "destructive" 
//             });
//         }
//     };

//     return (
//         <>
//             {serverDataTable.isLoading && !serverDataTable.data?.length ? (
//                 <TableSkeleton />
//             ) : (
//                 <div className="overflow-x-auto rounded-lg shadow-sm bg-white">
//                     <DataTable<FlattenedTask>
//                         table={serverDataTable.table}
//                         columns={serverDataTable.table.options.columns}
//                         isLoading={serverDataTable.isLoading}
//                         error={serverDataTable.error}
                        
//                         // ✅ Use the total count from the server response (e.g., 56)
//                         totalCount={serverDataTable.totalCount}
                        
//                         searchFieldOptions={SearchFieldOptions}
//                         selectedSearchField={serverDataTable.selectedSearchField}
//                         onSelectedSearchFieldChange={serverDataTable.setSelectedSearchField}
//                         facetFilterOptions={TASK_FACET_FILTER_OPTIONS}
//                         dateFilterColumns={TASK_DATE_COLUMNS}
//                         searchTerm={serverDataTable.searchTerm}
//                         onSearchTermChange={serverDataTable.setSearchTerm}
//                         showExportButton={true}
//                         exportFileName="Design_Tasks_Wise"
//                         onExport="default"
//                         tableHeight="60vh"
//                     />
//                 </div>
//             )}
             
//             {/* Task Edit Modal */}
//             {editingTask && (
//                 <TaskEditModal
//                     isOpen={!!editingTask}
//                     onOpenChange={(open) => { if (!open) setEditingTask(null); }}
//                     task={editingTask}
//                     onSave={handleTaskSave} 
//                     usersList={usersList || []}
//                     statusOptions={statusOptions}
//                     subStatusOptions={subStatusOptions}
//                 />
//             )}
//         </>
//     );
// };
