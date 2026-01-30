
// import React, { useMemo, useCallback, useContext } from "react";
// import { ColumnDef } from "@tanstack/react-table";
// import { Link, useNavigate } from "react-router-dom"; 
// import { useFrappeGetDocList, FrappeDoc } from "frappe-react-sdk";
// import { Info, ExternalLink, Users, User, Briefcase, Calculator } from "lucide-react"; // ✨ Added Users, User, Briefcase, Calculator

// // --- UI Components ---
// import { DataTable } from '@/components/data-table/new-data-table';
// import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
// import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
// import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
// import { Badge } from "@/components/ui/badge";
// import { toast } from "@/components/ui/use-toast";
// import { Button } from "@/components/ui/button"; 
// // ✨ Imported Tooltip components
// import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
// import { facetedFilterFn } from "@/utils/tableFilters";

// // --- Hooks & Utils ---
// import { useServerDataTable } from '@/hooks/useServerDataTable';
// import { exportToCsv } from "@/utils/exportToCsv";
// import { startOfToday, subDays, format } from 'date-fns';

// // --- Types & Config ---
// // Assuming these new fields are added to the Projects interface in "@/types/NirmaanStack/Projects"
// import { Projects } from "@/types/NirmaanStack/Projects"; 


// import { UserContext } from "@/utils/auth/UserProvider"; 


// // Mock Type for the Progress Report Doctype
// interface ProjectProgressReportDoc extends FrappeDoc {
//     project: string; // Link to Project
//     report_date: string; // Date (YYYY-MM-DD format)
//     name: string; // The report ID/Name is needed
// }

// // Merged Row Data: Project fields + dynamic date fields
// interface ProjectProgressReportRow extends Projects {
//     // Add the new Project Lead/Role fields
//     project_lead?: string;
//     procurement_lead?: string;
//     design_lead?: string;
//     project_manager?: string;
//     estimates_exec?: string;
//     accountant?: string;
//     [key: string]: any; 
// }

// const DOCTYPE_PROJECTS = 'Projects';
// const DOCTYPE_PROGRESS_REPORTS = 'Project Progress Reports';
// const URL_SYNC_KEY = 'project_progress_report_table';
// const PROGRESS_REPORTS_ROUTE = DOCTYPE_PROGRESS_REPORTS.toLowerCase().replace(/\s/g, '-');


// // --- Helper: Generate Dynamic Date Columns (LAST 7 DAYS) ---
// const getDynamicDateColumns = () => {
//     const today = startOfToday();
//     const dateHeaders: { date: Date, id: string, title: string, isoDate: string }[] = [];

//     for (let i = 0; i <= 6; i++) { 
//         const date = subDays(today, i);
//         const dayOfWeek = format(date, 'EEE');
//         const dayMonthYear = format(date, 'dd-MM-yyyy'); 
//         const isoDate = format(date, 'yyyy-MM-dd');
//         const title = `${dayMonthYear} \n ${dayOfWeek}`; 
//         const id = `report_${isoDate}`; 

//         dateHeaders.push({ date, id, title, isoDate });
//     }
    
//     return dateHeaders;
// };

// // --- Helper: Get Icon for Role ---
// const getRoleIcon = (role: string) => {
//     switch(role) {
//         case 'Project Lead':
//         case 'Project Manager':
//             return <Users className="w-4 h-4 text-orange-600" />;
//         case 'Procurement Lead':
//             return <Briefcase className="w-4 h-4 text-green-600" />;
//         case 'Design Lead':
//             return <User className="w-4 h-4 text-blue-600" />;
//         case 'Estimates Executive':
//         case 'Accountant':
//             return <Calculator className="w-4 h-4 text-purple-600" />;
//         default:
//             return <User className="w-4 h-4 text-gray-500" />;
//     }
// }

// export function ProjectProgressReports() {
    
//     // --- Context and Hooks ---
//     const navigate = useNavigate(); 

//     // --- 1. Dynamic Date Configuration (useMemo) ---
//     const dynamicDateColumns = useMemo(() => getDynamicDateColumns(), []);
    
//     const relevantISODates = useMemo(() => dynamicDateColumns.map(c => c.isoDate), [dynamicDateColumns]);
//     // The date range for fetching all progress reports
//     const relevantFromDate = useMemo(() => relevantISODates[relevantISODates.length - 1], [relevantISODates]); // Oldest date
//     const relevantToDate = useMemo(() => relevantISODates[0], [relevantISODates]); // Newest date

//     // Memoize the SWR key for progress reports to ensure hook stability
//     const swrProgressReportsKey = useMemo(() => ["progress_reports_for_range", relevantFromDate, relevantToDate], [relevantFromDate, relevantToDate]);

//     // --- 2. Data Fetching (useFrappeGetDocList) ---
    
//     // Fetch all active projects (for table rows)
//     // ✨ ADDED lead fields to the fields array
//     const PROJECT_FIELDS = [
//         "name", 
//         "project_name", 
//         "status", 
//         "project_lead", 
//         "procurement_lead", 
//         "design_lead", 
//         "project_manager", 
//         "estimates_exec", 
//         "accountant"
//     ];

//     const { data: projects, isLoading: isProjectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
//         DOCTYPE_PROJECTS, 
//         { 
//             fields: PROJECT_FIELDS as (keyof Projects)[], // Type assertion for safety
//             filters: [["status", "not in", ["Completed", "Cancelled"]]], 
//             limit: 0 
//         }, 
//         "projects_for_progress_report"
//     );

//     // Fetch all progress reports for the relevant date range (for cell content)
//     const { data: progressReports, isLoading: isReportsLoading, error: reportsError } = useFrappeGetDocList<ProjectProgressReportDoc>(
//         DOCTYPE_PROGRESS_REPORTS,
//         {
//             fields: ["project", "report_date", "name"], // Fetching 'name'
//             filters: [
//                 ["report_date", ">=", relevantFromDate],
//                 ["report_date", "<=", relevantToDate],
//                 ["report_status", "=", "Completed"]
//             ],
//             limit: 0
//         },
//         swrProgressReportsKey // Use memoized key
//     );
    
//     // --- 3. Data Merging and Transformation (useMemo) ---
//     const mergedData = useMemo<ProjectProgressReportRow[]>(() => {
//         if (!projects || !progressReports) return [];

//         const progressLookup = progressReports.reduce((acc, report) => {
//             const project = report.project;
//             const isoDate = report.report_date;
//             const colId = `report_${isoDate}`;

//             if (!acc[project]) { acc[project] = {}; }
//             acc[project][colId] = report.name; 
//             return acc;
//         }, {} as Record<string, Record<string, string>>);


//         return projects.map(project => {
//             const row: ProjectProgressReportRow = {
//                 ...project,
//                 ...progressLookup[project.name]
//             };
//             return row;
//         });
//     }, [projects, progressReports]);


//     // ✨ NEW: 1. Define Facet Options for Project Name
//     const projectFacetOptions = useMemo(() => {
//         if (!projects) return [];
//         // Map the full list of project names to the required { label: name, value: name } format
//         return projects.map(p => ({
//             label: p.project_name || p.name,
//             value: p.project_name || p.name, // Use project_name for the filter value
//         }));
//     }, [projects]);
    
//     // 2. Define the Facet Options Config
//     const facetOptionsConfig = useMemo(() => ({
//         project_name: { title: "Project Name", options: projectFacetOptions }
//     }), [projectFacetOptions]);

//     // --- 4. Column Definitions (useMemo) ---
//     const allColumns = useMemo<ColumnDef<ProjectProgressReportRow>[]>(() => {
        
//         // Base Project Name column
//         const baseColumns: ColumnDef<ProjectProgressReportRow>[] = [
//             {
//                 accessorKey: "project_name",
//                 header: ({ column }) => <DataTableColumnHeader column={column} title="Project Name" />,
//                 cell: ({ row }) => (
//                     <div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
//                         <span className="truncate" title={row.original.project_name}>{row.original.project_name}</span>
//                         <Link to={`/projects/${row.original.name}`}><Info className="w-4 h-4 text-blue-600 opacity-70 group-hover:opacity-100" /></Link>
//                     </div>
//                 ),
//                 size: 200,
//                  // ✨ UPDATE: Add filterFn for faceted filtering
//                 filterFn: facetedFilterFn,
//             },
//             // ✨ NEW COLUMN: Assigned Users/Leads
//             {
//                 id: "assigned_users", 
//                 header: ({ column }) => <DataTableColumnHeader column={column} title="Assigned Users" />,
//                 cell: ({ row }) => {
//                     const leads = [
//                         { role: "Project Lead", name: row.original.project_lead },
//                         { role: "Project Manager", name: row.original.project_manager },
//                         { role: "Design Lead", name: row.original.design_lead },
//                         { role: "Procurement Lead", name: row.original.procurement_lead },
//                         { role: "Estimates Executive", name: row.original.estimates_exec },
//                         { role: "Accountant", name: row.original.accountant },
//                     ].filter(l => l.name); // Only include roles that are assigned

//                     if (leads.length === 0) {
//                         return <span className="text-gray-400 text-start block">--</span>;
//                     }

//                     return (
//                         <div className="flex space-x-2 justify-start">
//                             {leads.map((lead) => (
//                                 <TooltipProvider key={lead.role}>
//                                     <Tooltip>
//                                         <TooltipTrigger asChild>
//                                             <div className="cursor-pointer">
//                                                 {getRoleIcon(lead.role)}
//                                             </div>
//                                         </TooltipTrigger>
//                                         <TooltipContent>
//                                             <p className="font-semibold">{lead.role}</p>
//                                             <p>{lead.name}</p>
//                                         </TooltipContent>
//                                     </Tooltip>
//                                 </TooltipProvider>
//                             ))}
//                         </div>
//                     );
//                 },
//                 size: 150,
//                 enableSorting: false,
//                 enableColumnFilter: false,
//             },
//         ];

//         // Dynamic Date columns
//         const dynamicColumns: ColumnDef<ProjectProgressReportRow>[] = dynamicDateColumns.map(dateCol => ({
//             id: dateCol.id, // e.g., report_2025-11-11
//             header: ({ column }) => (
//                 <DataTableColumnHeader column={column} title={
//                     <div className="text-center">
//                         {dateCol.title.split('\n')[0]} 
//                         <div className="text-xs text-muted-foreground font-normal">{dateCol.title.split('\n')[1]}</div>
//                     </div>
//                 } />
//             ),
//             cell: ({ row }) => {
//                 // The content is the report's NAME (ID)
//                 const reportName = row.original[dateCol.id] as string | undefined;
//                 const projectId = row.original.name; // Get projectId from the row data

//                 if (reportName) {
//                     // Extract the ISO date from the column ID: 'report_YYYY-MM-DD'
//                     const reportDateIso = dateCol.id.replace('report_', '');
                    
//                    const handleReportClick = (projectId: string, reportId: string) => {
//                         // Navigate to the new report detail page with the date and project ID parameters
//                         const detailPath = `/prs&milestones/milestone-report/daily-summary`; // NEW PATH

//                         // URL: Include both report_date and project_id as query parameters
//                         const url = `${detailPath}?report_date=${reportDateIso}&project_id=${projectId}`;

//                         navigate(url);
//                     };

//                     return (
//                         <Button variant="ghost" 
//                                 size="sm"
//                                 className="h-auto w-full p-1 text-xs text-blue-600 hover:text-blue-700 flex items-center justify-center gap-1 font-medium"
//                                 onClick={() => handleReportClick(projectId, reportName)} // Pass projectId and reportName
//                                 title={`View Report: ${reportName} on ${reportDateIso}`}
//                         >
//                             {reportName.slice(-4)} <ExternalLink className="h-3 w-3" />
//                         </Button>
//                     );
//                 }
//                 return <span className="text-gray-400 text-center block">--</span>;
//             },
//             size: 100,
//             enableSorting: false,
//             enableColumnFilter: false,
//         }));

//         // UPDATED Dependency Array for useMemo
//         return [...baseColumns, ...dynamicColumns];
//     }, [dynamicDateColumns, navigate]); 

//     // --- 5. Use Server Data Table (Client Mode) ---
//     const {
//         table,
//         isLoading: isTableHookLoading,
//         error: tableHookError,
//         totalCount: totalRowCount,
//         searchTerm, setSearchTerm,
//         selectedSearchField, setSelectedSearchField,
//     } = useServerDataTable<ProjectProgressReportRow>({
//         doctype: DOCTYPE_PROJECTS,
//         columns: allColumns,
//         fetchFields: [],
//         searchableFields: [{ value: "project_name", label: "Project Name", placeholder: "Search by Name...", default: true }],
//         clientData: mergedData,
//         clientTotalCount: mergedData.length,
//         urlSyncKey: URL_SYNC_KEY,
//         defaultSort: 'project_name asc',
//         enableRowSelection: false,
//     });

//     // --- 6. Custom Export Handler (useCallback) ---
//     const handleCustomExport = useCallback(() => {
//         // ... (Export logic remains the same)
//         const fullyFilteredData = table.getFilteredRowModel().rows.map(row => row.original);
//         if (!fullyFilteredData || fullyFilteredData.length === 0) {
//             toast({ title: "Export", description: "No data available to export.", variant: "default" });
//             return;
//         }

//         const dataToExport = fullyFilteredData.map(original => {
//             const exportRow: Record<string, any> = {
//                 "Project Name": original.project_name,
//                 "Project ID": original.name,
//                 "Project Lead": original.project_lead || "--",
//                 "Project Manager": original.project_manager || "--",
//                 "Design Lead": original.design_lead || "--",
//                 "Procurement Lead": original.procurement_lead || "--",
//                 "Estimates Executive": original.estimates_exec || "--",
//                 "Accountant": original.accountant || "--",
//             };
            
//             dynamicDateColumns.forEach(col => {
//                 exportRow[col.title.replace('\n', ' ')] = original[col.id] || "--";
//             });
//             return exportRow;
//         });

//         const exportColumns: ColumnDef<any, any>[] = [
//             { header: "Project Name", accessorKey: "Project Name" },
//             { header: "Project ID", accessorKey: "Project ID" },
//             // Added new export columns
//             { header: "Project Lead", accessorKey: "Project Lead" },
//             { header: "Project Manager", accessorKey: "Project Manager" },
//             { header: "Design Lead", accessorKey: "Design Lead" },
//             { header: "Procurement Lead", accessorKey: "Procurement Lead" },
//             { header: "Estimates Executive", accessorKey: "Estimates Executive" },
//             { header: "Accountant", accessorKey: "Accountant" },
//             ...dynamicDateColumns.map(col => ({
//                 header: col.title.replace('\n', ' '), 
//                 accessorKey: col.title.replace('\n', ' ')
//             }))
//         ];

//         try {
//             exportToCsv("Project_Progress_Report_IDs", dataToExport, exportColumns);
//             toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success" });
//         } catch (e) {
//             console.error("Export failed:", e);
//             toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive" });
//         }
//     }, [table, dynamicDateColumns]); // Added `table` to dependencies


//     const isLoadingOverall = isProjectsLoading || isReportsLoading || isTableHookLoading;
//     const overallError = projectsError || reportsError || tableHookError;

//     if (overallError) {
//         // Ensure you return a component here, not just the error object
//         return <AlertDestructive error={overallError as Error} />;
//     }

//     if (isLoadingOverall && !mergedData.length) {
//         return <LoadingFallback />;
//     }

  

//     return (
//         <div className="space-y-4">
//             {/* <h2 className="text-xl font-bold tracking-tight">Project Progress Report</h2> */}
//             {/* <p className="text-sm text-muted-foreground">Report IDs for progress recorded over the last 7 days (including today).</p> */}
            
//             <DataTable<ProjectProgressReportRow>
//                 table={table}
//                 columns={allColumns}
//                 isLoading={isLoadingOverall}
//                 error={overallError as Error | null}
//                 totalCount={totalRowCount}
//                 searchFieldOptions={[{ value: "project_name", label: "Project Name", placeholder: "Search by Name..." }]}
//                 selectedSearchField={selectedSearchField}
//                 onSelectedSearchFieldChange={setSelectedSearchField}
//                 searchTerm={searchTerm}
//                 onSearchTermChange={setSearchTerm}
//                 // ✨ ADDED FACET FILTER OPTIONS
//                 facetFilterOptions={facetOptionsConfig} 
//                 showExportButton={true}
//                 // onExport={handleCustomExport}

//                 exportFileName={'Project_Progress_Report_IDs'}
//                 showRowSelection={false}
//                 dateFilterColumns={[]}
//             />
//         </div>
//     );
// }



import React, { useMemo, useCallback, useContext } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Link, useNavigate } from "react-router-dom"; 
import { useFrappeGetDocList, FrappeDoc,useFrappeGetCall } from "frappe-react-sdk";
import { Info, ExternalLink, Users, User, Briefcase, Calculator,XIcon } from "lucide-react"; 

// --- UI Components ---
import { DataTable } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import LoadingFallback from "@/components/layout/loaders/LoadingFallback";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button"; 
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card"; 
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { facetedFilterFn } from "@/utils/tableFilters";

// --- Hooks & Utils ---
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { exportToCsv } from "@/utils/exportToCsv";
import { startOfToday, subDays, format } from 'date-fns';

// --- Types & Config ---
import { Projects } from "@/types/NirmaanStack/Projects"; 


import { UserContext } from "@/utils/auth/UserProvider"; 


// --- NEW TYPES FOR NEW DATA SOURCES ---

// 1. Nirmaan User Permissions Doctype
interface NirmaanUserPermissionDoc extends FrappeDoc {
    user: string; // User Email ID
    allow: string; // The role/permission name (e.g., 'Nirmaan Project Manager')
    for_value: string; // The Project Name/ID
}

// 2. Nirmaan Users Doctype
interface NirmaanUserDoc extends FrappeDoc {
    email: string; // Primary key/Email ID
    full_name: string; 
    role_profile: string; // The role name we need to filter by
}

// Mock Type for the Progress Report Doctype
interface ProjectProgressReportDoc extends FrappeDoc {
    project: string; // Link to Project
    report_date: string; // Date (YYYY-MM-DD format)
    name: string; // The report ID/Name is needed
    report_zone?: string; // NEW FIELD for Zone
}

// Merged Row Data: Project fields + dynamic date fields
interface ProjectProgressReportRow extends Projects {
    // NEW STRUCTURE: Hold all assigned leads/managers from permissions
    assigned_leads: { role: string; name: string }[]; 
    [key: string]: any; 
}

const DOCTYPE_PROJECTS = 'Projects';
const DOCTYPE_PROGRESS_REPORTS = 'Project Progress Reports';

// NEW DOCTYPES
const DOCTYPE_USER_PERMISSIONS = 'Nirmaan User Permissions';
const DOCTYPE_NIRMAAN_USERS = 'Nirmaan Users';

const URL_SYNC_KEY = 'project_progress_report_table';


// --- Helper: Generate Dynamic Date Columns (LAST 7 DAYS) ---
const getDynamicDateColumns = () => {
    const today = startOfToday();
    const dateHeaders: { date: Date, id: string, title: string, isoDate: string }[] = [];

    for (let i = 0; i <= 6; i++) { 
        const date = subDays(today, i);
        const dayOfWeek = format(date, 'EEE');
        const dayMonthYear = format(date, 'dd-MM-yyyy'); 
        const isoDate = format(date, 'yyyy-MM-dd');
        const title = `${dayMonthYear} \n ${dayOfWeek}`; 
        const id = `report_${isoDate}`; 

        dateHeaders.push({ date, id, title, isoDate });
    }
    
    return dateHeaders;
};

// --- Helper: Get Icon for Role (Retained, but not used in the final cell) ---
const getRoleIcon = (role: string) => {
    // This helper is not used in the final column implementation (single icon), 
    // but retained for completeness as it was present in the user's base code.
    if (role.includes('Project Lead') || role.includes('Project Manager')) {
        return <Users className="w-4 h-4 text-orange-600" />;
    } else if (role.includes('Procurement')) {
        return <Briefcase className="w-4 h-4 text-green-600" />;
    } else if (role.includes('Design')) {
        return <User className="w-4 h-4 text-blue-600" />;
    } else if (role.includes('Estimates') || role.includes('Accountant')) {
        return <Calculator className="w-4 h-4 text-purple-600" />;
    }
    return <User className="w-4 h-4 text-gray-500" />;
}


export function ProjectProgressReports() {
    
    // --- Context and Hooks ---
    const navigate = useNavigate(); 

    // --- 1. Dynamic Date Configuration (useMemo) ---
    const dynamicDateColumns = useMemo(() => getDynamicDateColumns(), []);
    
    const relevantISODates = useMemo(() => dynamicDateColumns.map(c => c.isoDate), [dynamicDateColumns]);
    const relevantFromDate = useMemo(() => relevantISODates[relevantISODates.length - 1], [relevantISODates]); 
    const relevantToDate = useMemo(() => relevantISODates[0], [relevantISODates]); 

    const swrProgressReportsKey = useMemo(() => ["progress_reports_for_range", relevantFromDate, relevantToDate], [relevantFromDate, relevantToDate]);

    // --- 2. Data Fetching (useFrappeGetDocList) ---
    
    // // // // 2a. Fetch all active projects (for table rows)
    // const PROJECT_FIELDS = ["name", "project_name", "status","enable_project_milestone_tracking","project_zones"];

    // const { data: projects, isLoading: isProjectsLoading, error: projectsError } = useFrappeGetDocList<Projects>(
    //     DOCTYPE_PROJECTS, 
    //     { 
    //         fields: PROJECT_FIELDS as (keyof Projects)[], 
    //         filters: [["status", "not in", ["Completed", "Cancelled"]],["enable_project_milestone_tracking", "=", 1]], 
    //         limit: 0 
    //     }, 
    //     "projects_for_progress_report"
    // );

const {
  data: reportsData,
  isLoading:isProjectsLoading,
  error:projectsError,
  mutate: refetch,
} = useFrappeGetCall(
  "nirmaan_stack.api.projects.get_full_project_list.get_active_projects_for_progress_report"
);

const projects = reportsData?.message?.data

console.log("Fetched Projects:", projects);
 
    // 2b. Fetch all relevant users/permissions
    const RELEVANT_ROLES = ["Nirmaan Project Manager Profile", "Nirmaan Project Lead Profile"];
    
    // Fetch all User Permissions for the relevant roles and all projects
    const { data: permissions, isLoading: isPermissionsLoading, error: permissionsError } = useFrappeGetDocList<NirmaanUserPermissionDoc>(
        DOCTYPE_USER_PERMISSIONS,
        {
            fields: ["user", "allow", "for_value"],
            limit: 0
        },
        "nirmaan_project_permissions"
    );

    // 2c. Fetch Nirmaan Users data to get full names (assuming this is required)
    const userEmails = useMemo(() => {
        if (!permissions) return [];
        return Array.from(new Set(permissions.map(p => p.user)));
    }, [permissions]);

    const { data: nirmaanUsers, isLoading: isUsersLoading, error: usersError } = useFrappeGetDocList<NirmaanUserDoc>(
        DOCTYPE_NIRMAAN_USERS,
        {
            fields: ["email", "full_name", "role_profile"],
            filters: [
                ["role_profile", "in", RELEVANT_ROLES] // Re-filter to be safe
            ],
            limit: 0
        },
        userEmails.length > 0 ? ["nirmaan_users_for_roles", userEmails] : null // Skip if no emails
    );


    // 2d. Fetch all progress reports for the relevant date range (for cell content)
    const { data: progressReports, isLoading: isReportsLoading, error: reportsError } = useFrappeGetDocList<ProjectProgressReportDoc>(
        DOCTYPE_PROGRESS_REPORTS,
        {
            fields: ["project", "report_date", "name","report_zone"], 
            filters: [
                ["report_date", ">=", relevantFromDate],
                ["report_date", "<=", relevantToDate],
                ["report_status", "=", "Completed"]
            ],
            limit: 0
        },
        swrProgressReportsKey
    );
    
const ALLOWED_ROLE_PROFILES = [
    "Nirmaan Project Manager Profile",
    "Nirmaan Project Lead Profile"
];

const mergedData = useMemo<ProjectProgressReportRow[]>(() => {
    if (!projects || !progressReports || !permissions || !nirmaanUsers) return [];

    // STEP 1: Build user lookup with full_name + role_profile
    const userLookup = nirmaanUsers.reduce((acc, user) => {
        acc[user.email] = {
            name: user.full_name,
            role_profile: user.role_profile
        };
        return acc;
    }, {} as Record<string, { name: string; role_profile: string | null }>);

     const progressLookup = progressReports.reduce((acc, report) => {
        const project = report.project;
        const isoDate = report.report_date;
        const colId = `report_${isoDate}`;
        const zone = report.report_zone; // NEW

        if (!acc[project]) acc[project] = {};
        if (!acc[project][colId]) {
            acc[project][colId] = {
                totalReported: 0,
                reportNames: {}, // Key: zone_name, Value: report_id
            };
        }

        acc[project][colId].totalReported += 1;
        acc[project][colId].reportNames[zone] = report.name;

        return acc;
    }, {} as Record<string, Record<string, { totalReported: number; reportNames: Record<string, string> }>>);

    // STEP 3: Build assignments lookup from permissions
    const assignmentsLookup = permissions.reduce((acc, perm) => {
        const project = perm.for_value;
        const role = perm.allow;
        const userInfo = userLookup[perm.user];

        // Skip assigned user if not found or role_profile not allowed
        if (!userInfo || !ALLOWED_ROLE_PROFILES.includes(userInfo.role_profile || "")) {
            return acc;
        }

        if (!acc[project]) acc[project] = [];

        const assignment = {
            project,
            email: perm.user,
            name: userInfo.name,
            role_profile: userInfo.role_profile
        };

        // prevent duplicates by email + role_profile
        if (!acc[project].some(a =>
            a.email === assignment.email &&
            a.role_profile === assignment.role_profile
        )) {
            acc[project].push(assignment);
        }

        return acc;
    }, {} as Record<string, {
        project: string;
        name: string;
        email: string;
        role_profile: string | null;
    }[]>);

    // STEP 4: Build final rows
   return projects.map(project => {
        const totalZones = project.project_zones?.length || 0; // Get the total zone count for this project

        const row: ProjectProgressReportRow = {
            ...project,
            assigned_leads: assignmentsLookup[project.name] || [],
        } as ProjectProgressReportRow; // Cast to include dynamic columns

        // Inject the ZoneReportStatus object into the dynamic columns
        dynamicDateColumns.forEach(dateCol => {
            const reportStatus = progressLookup[project.name]?.[dateCol.id];
            
            if (reportStatus) {
                const reportedCount = reportStatus.totalReported;
                const progress = totalZones > 0 ? (reportedCount / totalZones) * 100 : 0;
                
                row[dateCol.id] = { 
                    totalZones: totalZones,
                    reportedCount: reportedCount,
                    reportNames: reportStatus.reportNames,
                    progress: progress
                } as ZoneReportStatus;
            } else {
                 // If no reports found, initialize with zero reported, but the correct total zones
                row[dateCol.id] = { totalZones: totalZones, reportedCount: 0, reportNames: {}, progress: 0 } as ZoneReportStatus;
            }
        });

        return row;
    });
}, [projects, progressReports, permissions, nirmaanUsers, dynamicDateColumns]);

console.log("mergedData",mergedData);

    // --- Facet Filters Configuration ---
    const projectFacetOptions = useMemo(() => {
        if (!projects) return [];
        return projects.map(p => ({
            label: p.project_name || p.name,
            value: p.project_name || p.name, 
        }));
    }, [projects]);
    
    const facetOptionsConfig = useMemo(() => ({
        project_name: { title: "Project Name", options: projectFacetOptions }
    }), [projectFacetOptions]);


    // --- 4. Column Definitions (useMemo) ---
    const allColumns = useMemo<ColumnDef<ProjectProgressReportRow>[]>(() => {
        
        // Base Project Name column
        const baseColumns: ColumnDef<ProjectProgressReportRow>[] = [
            {
                accessorKey: "project_name",
                header: ({ column }) => <DataTableColumnHeader column={column} title="Project Name" />,
                cell: ({ row }) => (
                    <div className="font-medium flex items-center gap-1.5 group min-w-[170px]">
                        <span className="truncate" title={row.original.project_name}>{row.original.project_name}</span>
                        <Link to={`/projects/${row.original.name}`}><Info className="w-4 h-4 text-blue-600 opacity-70 group-hover:opacity-100" /></Link>
                    </div>
                ),
                size: 200,
                filterFn: facetedFilterFn,
            },
            // MODIFIED COLUMN: Consolidated Assigned Users/Leads
            {
                id: "assigned_users", 
                header: ({ column }) => <DataTableColumnHeader column={column} title="Assignees" className="justify-start" />,
                cell: ({ row }) => {
                    // Use the pre-merged array
                    const leads = row.original.assigned_leads; 
                    // console.log("leads",leads)
                    if (leads.length === 0) {
                        return <span className="text-gray-400 text-center block">--</span>;
                    }

                    // Group by Role
                    const grouped = leads.reduce((acc, user) => {
                        const roleName = user.role_profile?.replace(/Nirmaan\s|\sProfile/g, "") || "Others";
                        if (!acc[roleName]) acc[roleName] = [];
                        acc[roleName].push(user);
                        return acc;
                    }, {} as Record<string, typeof leads>);

                    return (
                        <div className="flex justify-center w-full">
                            <HoverCard openDelay={200} closeDelay={100}>
                                <HoverCardTrigger asChild>
                                    <div className="cursor-pointer p-1.5 hover:bg-gray-100 rounded-full transition-colors group">
                                        <Users className="w-5 h-5 text-gray-500 group-hover:text-blue-600" />
                                    </div>
                                </HoverCardTrigger>
                                <HoverCardContent className="w-72 p-0 shadow-lg" side="left" align="start">
                                    <div className="p-3 border-b bg-gray-50/50 flex justify-between items-center">
                                        <h4 className="font-semibold text-sm text-gray-900">Responsible Team</h4>
                                        <Badge variant="outline" className="bg-white text-xs font-normal">
                                            {leads.length} Members
                                        </Badge>
                                    </div>
                                    <div className="max-h-[300px] overflow-y-auto p-2 space-y-3 custom-scrollbar">
                                        {Object.entries(grouped).map(([role, users]) => (
                                            <div key={role} className="space-y-1">
                                                <div className="flex items-center gap-1 px-2">
                                                    <h5 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                                        {role}
                                                    </h5>
                                                    <div className="h-px bg-gray-100 flex-1 ml-2" />
                                                </div>
                                                <div className="space-y-1">
                                                    {users.map((user, idx) => (
                                                        <div 
                                                            key={`${user.name}-${idx}`} 
                                                            className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 transition-colors"
                                                        >
                                                            <div className="h-6 w-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0 border border-blue-100">
                                                                <span className="text-[10px] font-bold text-blue-600">
                                                                    {user.name.charAt(0).toUpperCase()}
                                                                </span>
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <span className="text-sm font-medium text-gray-900 leading-none">
                                                                    {user.name}
                                                                </span>
                                                                {/* <span className="text-[10px] text-gray-500 mt-0.5">
                                                                    {user.email || 'Nirmaan User'}
                                                                </span> */}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </HoverCardContent>
                            </HoverCard>
                        </div>
                    );
                },
                size: 70, 
                enableSorting: false,
                enableColumnFilter: false,
            },
        ];

        // Dynamic Date columns
        const dynamicColumns: ColumnDef<ProjectProgressReportRow>[] = dynamicDateColumns.map(dateCol => ({
            id: dateCol.id, // e.g., report_2025-11-11
            header: ({ column }) => (
                <DataTableColumnHeader column={column} title={
                    <div className="text-center">
                        {dateCol.title.split('\n')[0]} 
                        <div className="text-xs text-muted-foreground font-normal">{dateCol.title.split('\n')[1]}</div>
                    </div>
                } />
            ),
            // Hoverable cell with clickable report names in tooltip

cell: ({ row }) => {
    const status = row.original[dateCol.id] as ZoneReportStatus;
    const projectId = row.original.name;
    const reportDateIso = dateCol.isoDate;

    const { totalZones, reportedCount, reportNames } = status || { 
        totalZones: 0, 
        reportedCount: 0, 
        reportNames: {} 
    };
    
    // Determine badge color based on completion status
    let badgeClass = "bg-red-100 text-red-700";
    if (reportedCount === totalZones && totalZones > 0) {
        badgeClass = "bg-green-100 text-green-700";
    } else if (reportedCount > 0) {
        badgeClass = "bg-yellow-100 text-yellow-700";
    } else {
        badgeClass = "bg-gray-100 text-gray-700";
    }
    
    const handleReportClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        const detailPath = `/prs&milestones/milestone-report/daily-summary`; 
        const url = `${detailPath}?report_date=${reportDateIso}&project_id=${projectId}`;
        navigate(url);
    };

    const handleZoneReportClick = (e: React.MouseEvent, reportId: string,zoneName:string) => {
        e.preventDefault();
        e.stopPropagation();
         const detailPath = `/prs&milestones/milestone-report/daily-summary`; 
        // Navigate to specific report detail page
       const url = `${detailPath}?report_date=${reportDateIso}&project_id=${projectId}&zone=${zoneName}`;
        navigate(url);
    };

    const reportedZonesArray = Object.entries(reportNames);
      
    // --- NEW LOGIC: Determine if we should skip the Tooltip ---
    const skipTooltip = totalZones === 1 && reportedCount === 1;
    let singleZoneName: string | undefined;
    let singleReportId: string | undefined;

    if (skipTooltip) {
        // Since it's a single zone, get the name and ID from the first (and only) entry
        [singleZoneName, singleReportId] = reportedZonesArray[0];
    }
    // --- END NEW LOGIC ---


   if (reportedZonesArray.length === 0) {
                    // MODIFIED SECTION
                    return (
                        <span className="text-red-500 text-center block" title="No Reports Found">
                            <XIcon className="w-4 h-4 mx-auto" />
                        </span>
                    );
                    // END MODIFIED SECTION
                }

     if (skipTooltip && singleZoneName && singleReportId) {
        return (
            <div 
                className={`h-auto w-full p-2 text-xs flex items-center justify-center font-medium transition-colors cursor-pointer rounded ${badgeClass} hover:bg-opacity-80`}
                title={`View Report for ${singleZoneName}`}
                // Direct navigation without Tooltip
                onClick={(e) => handleZoneReportClick(e, singleReportId, singleZoneName)}
            >
                {reportedCount}/{totalZones}
                <ExternalLink className="h-3 w-3 ml-1" />
            </div>
        );
    }
    return (
        <TooltipProvider delayDuration={200}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div 
                        className={`h-auto w-full p-2 text-xs flex items-center justify-center font-medium transition-colors cursor-pointer rounded ${badgeClass} hover:bg-opacity-80`}
                        title={`Reported ${reportedCount}/${totalZones} Zones`}
                    >
                        {reportedCount}/{totalZones}
                        {reportedCount > 0 && <ExternalLink className="h-3 w-3 ml-1" />}
                    </div>
                </TooltipTrigger>
                <TooltipContent 
                    side="top" 
                    align="center"
                     className="p-0 z-50 bg-white border shadow-lg w-[180px]"
                    sideOffset={8}
                >
                    <div className="p-3 pt-2 pb-2">

                        {reportedZonesArray.length > 0 ? (
                            <div className="space-y-1 text-gray-500">
                                {reportedZonesArray.map(([zoneName, reportId], index) => (
                                    <div 
                                        key={index} 
                                        className="flex justify-between items-center text-base py-1.5 px-0.5 rounded transition-colors hover:bg-gray-50 -mx-1"
                                        style={{ height: '36px' }} // Explicit height based on image 
                                        onClick={(e) => handleZoneReportClick(e, reportId,zoneName)}
                                    >
                                        <span className="font-medium text-xs text-left flex-1">
                                            {zoneName}
                                        </span>
                                        <button
                                            onClick={(e) => handleZoneReportClick(e, reportId,zoneName)}
                                            className="text-blue-600 hover:text-blue-800 hover:underline text-xs font-medium flex items-center gap-1 transition-colors"
                                            title={`View Report: ${reportId}`}
                                        >
                                          
                                            <ExternalLink className="h-3 w-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500 py-3 text-center">
                                No reports submitted.
                            </p>
                        )}
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
},
            size: 100,
            enableSorting: false,
            enableColumnFilter: false,
        }));



        // UPDATED Dependency Array for useMemo
        return [...baseColumns, ...dynamicColumns];
    }, [dynamicDateColumns, navigate]); 

    // --- 5. Use Server Data Table (Client Mode) ---
    const {
        table,
        isLoading: isTableHookLoading,
        error: tableHookError,
        totalCount: totalRowCount,
        searchTerm, setSearchTerm,
        selectedSearchField, setSelectedSearchField,
    } = useServerDataTable<ProjectProgressReportRow>({
        doctype: DOCTYPE_PROJECTS,
        columns: allColumns,
        fetchFields: [],
        searchableFields: [{ value: "project_name", label: "Project Name", placeholder: "Search by Name...", default: true }],
        clientData: mergedData,
        clientTotalCount: mergedData.length,
        urlSyncKey: URL_SYNC_KEY,
        defaultSort: 'project_name asc',
        enableRowSelection: false,
         additionalFilters: [["status", "not in", ["Completed", "Cancelled"]],["enable_project_milestone_tracking", "=", 1]],
    });

    console.log("table data",table.getRowModel().rows);
    // --- 6. Custom Export Handler (useCallback) ---
    const handleCustomExport = useCallback(() => {
        const fullyFilteredData = table.getFilteredRowModel().rows.map(row => row.original);
        if (!fullyFilteredData || fullyFilteredData.length === 0) {
            toast({ title: "Export", description: "No data available to export.", variant: "default" });
            return;
        }

        const dataToExport = fullyFilteredData.map(original => {
            // Flatten the assigned_leads array for export
            const leadRoles = original.assigned_leads.reduce((acc, lead) => {
                // Use the exact role name as the key
                acc[lead.role] = lead.name; 
                return acc;
            }, {} as Record<string, string>);

            const exportRow: Record<string, any> = {
                "Project Name": original.project_name,
                "Project ID": original.name,
                "Project Lead": leadRoles["Nirmaan Project Lead"] || "--",
                "Project Manager": leadRoles["Nirmaan Project Manager"] || "--",
            };
            
            dynamicDateColumns.forEach(col => {
                exportRow[col.title.replace('\n', ' ')] = original[col.id] || "--";
            });
            return exportRow;
        });

        // Define export columns based on the flattened data
        const exportColumns: ColumnDef<any, any>[] = [
            { header: "Project Name", accessorKey: "Project Name" },
            { header: "Project ID", accessorKey: "Project ID" },
            // Only export the roles fetched by permissions
            { header: "Project Lead", accessorKey: "Project Lead" },
            { header: "Project Manager", accessorKey: "Project Manager" },
            ...dynamicDateColumns.map(col => ({
                header: col.title.replace('\n', ' '), 
                accessorKey: col.title.replace('\n', ' ')
            }))
        ];

        try {
            exportToCsv("Project_Progress_Report_IDs", dataToExport, exportColumns);
            toast({ title: "Export Successful", description: `${dataToExport.length} rows exported.`, variant: "success" });
        } catch (e) {
            console.error("Export failed:", e);
            toast({ title: "Export Error", description: "Could not generate CSV file.", variant: "destructive" });
        }
    }, [table, dynamicDateColumns]); 


    const isLoadingOverall = isProjectsLoading || isReportsLoading || isPermissionsLoading || isUsersLoading || isTableHookLoading;
    const overallError = projectsError || reportsError || permissionsError || usersError || tableHookError;

    if (overallError) {
        return <AlertDestructive error={overallError as Error} />;
    }

    if (isLoadingOverall && !mergedData.length) {
        return <LoadingFallback />;
    }

    return (
        <div className="space-y-4">
            {/* <h2 className="text-xl font-bold tracking-tight">Project Progress Report</h2>
            <p className="text-sm text-muted-foreground">Report IDs for progress recorded over the last 7 days (including today), showing assigned Project Leads/Managers.</p> */}
            
            <DataTable<ProjectProgressReportRow>
                table={table}
                columns={allColumns}
                isLoading={isLoadingOverall}
                error={overallError as Error | null}
                totalCount={totalRowCount}
                searchFieldOptions={[{ value: "project_name", label: "Project Name", placeholder: "Search by Name..." }]}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetOptionsConfig} 
                showExportButton={true}
                onExport={handleCustomExport}
                exportFileName={'Project_Progress_Report_IDs'}
                showRowSelection={false}
                dateFilterColumns={[]}
            />
        </div>
    );
}