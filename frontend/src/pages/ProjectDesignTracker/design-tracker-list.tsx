// import React, { useMemo, useState, useCallback } from "react";
// import { Link, useNavigate } from "react-router-dom";
// import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk";

// // Imports to keep/add for the new UI
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
// import { Input } from "@/components/ui/input"; 
// import { Card, CardContent } from "@/components/ui/card"; 
// import { TableSkeleton } from "@/components/ui/skeleton";
// import { ChevronDown, ChevronUp, Search, Filter, CirclePlus, Link as LinkIcon, MessageCircle, Edit } from "lucide-react";
// import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
// import { Label } from '@/components/ui/label';
// import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog";
// import { TailSpin } from "react-loader-spinner";
// import { toast } from "@/components/ui/use-toast";
// import { useDesignMasters, DESIGN_CATEGORIES } from "./hooks/useDesignMasters";
// import { ProjectDesignTracker, DesignTrackerTask, AssignedDesignerDetail } from "./types"; 
// import { useDesignTrackerLogic } from "./hooks/useDesignTrackerLogic"; 


// // --- CRUCIAL IMPORTS for URL Synchronization ---
// import { getUrlStringParam } from '@/hooks/useServerDataTable';
// import { urlStateManager } from '@/utils/urlStateManager';



// // 1. IMPORT THE TASK EDIT MODAL
// import { TaskEditModal } from './project-design-tracker-details'; 
// // 2. IMPORT THE NEW TASK WISE TABLE COMPONENT
// import { TaskWiseTable } from "./components/TaskWiseTable"; 

// const DOCTYPE = 'Project Design Tracker';
// const FE_TASK_STATUS_OPTIONS = ["Todo", "In Progress", "Done", "Blocked", "On Hold", "Submitted"]; 
// const DESIGN_TABS = {
//     PROJECT_WISE: 'project',
//     TASK_WISE: 'task',
// };

// // --- DATE & STYLE HELPERS ---
// const getOrdinalNum = (n: number) => {
//     return n + (n > 0 ? ['th', 'st', 'nd', 'rd'][(n > 3 && n < 21) || n % 10 > 3 ? 0 : n % 10] : '');
// };

// const formatDate = (dateString: string): string => {
//     try {
//         const date = new Date(dateString);
//         const day = date.getDate();
//         const month = date.toLocaleString('en-US', { month: 'short' });
//         const year = date.getFullYear();
//         return `${getOrdinalNum(day)} ${month}, ${year}`;
//     } catch (e) {
//         return 'N/A';
//     }
// };

// const getStatusBadgeStyle = (status: string) => {
//     const lowerStatus = status.toLowerCase();
    
//     if (lowerStatus.includes('pending')) {
//         return 'bg-red-100 text-red-700 border border-red-500 font-medium rounded-full';
//     }
//     if (lowerStatus.includes('in progress')) {
//         return 'bg-blue-100 text-blue-700 border border-blue-500 font-medium rounded-full';
//     }
//     if (lowerStatus.includes('on hold') || lowerStatus.includes('blocked')) {
//         return 'bg-yellow-100 text-yellow-700 border border-yellow-500 font-medium rounded-full';
//     }
//     if (lowerStatus.includes('submitted') || lowerStatus.includes('completed') || lowerStatus.includes('done')) {
//         return 'bg-green-100 text-green-700 border border-green-500 font-medium rounded-full';
//     }
//     return 'bg-gray-100 text-gray-700 border border-gray-300 font-medium rounded-full';
// };


// // --- Creation Modal Component (Unchanged) ---
// const NewTrackerModal: React.FC<any> = ({ isOpen, onClose, projectOptions, categoryData, onSuccess }) => {
//     const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
//     const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
//     const { createDoc, loading: createLoading } = useFrappeCreateDoc();

//     const handleCategoryToggle = (categoryName: string) => {
//         setSelectedCategories(prev =>
//             prev.includes(categoryName)
//                 ? prev.filter(c => c !== categoryName)
//                 : [...prev, categoryName]
//         );
//     };

//  const handleConfirm = async () => {
//         if (!selectedProjectId || selectedCategories.length === 0) {
//             toast({ title: "Error", description: "Select project and at least one category.", variant: "destructive" });
//             return;
//         }
        
//         const projectLabel = projectOptions.find(p => p.value === selectedProjectId)?.label;
//         if (!projectLabel) return;

//        const tasksToGenerate: Partial<DesignTrackerTask>[] = [];
       
//         selectedCategories.forEach(catName => {
//         const categoryDef = categoryData.find(c => c.category_name === catName);

//         // 1. Check for Category Definition and Tasks (The Core Change)
//         // Only proceed if categoryDef exists AND categoryDef.tasks is a non-empty array
//         if (categoryDef && Array.isArray(categoryDef.tasks) && categoryDef.tasks.length > 0) {
            
//             const taskItems = categoryDef.tasks;

//             // 2. Iterate and generate tasks from the defined task list
//             taskItems.forEach(taskDef => {

//                 // Ensure task_name is a string before pushing
//                 const taskName =taskDef.task_name
                   

//                 tasksToGenerate.push({
//                     task_name: taskName,
//                     design_category: catName, // This MUST be the string catName
//                     task_status: 'Not Applicable',
//                     deadline: undefined,
//                     // assigned_designers: "[]", // Ensure this JSON field is initialized
//                 });
//             });
            
//         } else {
//             // Optional: Show a toast notification for skipped categories
//             toast({
//                 title: "Category Skipped",
//                 description: `Category ${catName} has no tasks defined in master data and was skipped.`,
//                 variant:"destructive" // Using 'warning' or a similar variant might be better than 'destructive' here
//             });
//         }
//         });
//         try {
//             await createDoc(DOCTYPE, {
//                 project: selectedProjectId,
//                 project_name: projectLabel,
//                 status: 'Assign Pending', 
//                 design_tracker_task: tasksToGenerate,
//             });

//             toast({ title: "Success", description: `Design Tracker created for ${projectLabel}.`, variant: "success" });
//             onSuccess();
//             onClose();

//         } catch (error: any) {
//             toast({ title: "Creation Failed", description: error.message || "Failed to create tracker.", variant: "destructive" });
//         }
//     };

//     return (
//         <AlertDialog open={isOpen} onOpenChange={onClose}>
//             <AlertDialogContent className="sm:max-w-lg">
//                 <AlertDialogHeader>
//                     <AlertDialogTitle className="text-center">Select Project</AlertDialogTitle>
//                     <AlertDialogDescription className="text-center">Step 1: Select a project that you want to add to the design tracker</AlertDialogDescription>
//                 </AlertDialogHeader>
                
//                 <div className="space-y-6 py-4">
//                     {/* Project Selection */}
//                     <div>
//                         {/* <select 
//                             className="w-full p-2 border rounded-md"
//                             value={selectedProjectId || ""}
//                             onChange={(e) => setSelectedProjectId(e.target.value)}
//                         >
//                             <option value="">Select Project</option>
//                             {projectOptions.map(p => (
//                                 <option key={p.value} value={p.value}>{p.label}</option>
//                             ))}
//                         </select> */}
//                         <Label htmlFor="Projects">Select Project *</Label>
//                                             <Select 
//                                                value={selectedProjectId || ""} 
//                                                onValueChange={(val) => setSelectedProjectId(val)}
//                                             >
//                                                 <SelectTrigger>
//                                                     <SelectValue placeholder="Select Project    " />
//                                                 </SelectTrigger>
//                                                 <SelectContent>
//                                                     {projectOptions.map(p=> (
//                                                         <SelectItem key={p.value} value={p.value}>
//                                                             {p.label}
//                                                         </SelectItem>
//                                                     ))}
//                                                 </SelectContent>
//                                             </Select>
//                     </div>
                   
                                            
                   

//                     {/* Task Categories Selection */}
//                     <div className="space-y-3">
//                         <AlertDialogDescription>Step 2: Choose one or more categories for this project</AlertDialogDescription>
//                         <div className="grid grid-cols-3 gap-3">
//                             {categoryData.map(cat => (
//                                 <Button
//                                     key={cat}
//                                     variant={selectedCategories.includes(cat.category_name) ? "default" : "outline"}
//                                     onClick={() => handleCategoryToggle(cat.category_name)}
//                                 >
//                                     {cat.category_name}
//                                 </Button>
//                             ))}
//                         </div>
//                     </div>
//                 </div>

//                 <AlertDialogFooter>
//                     <AlertDialogCancel disabled={createLoading} onClick={onClose}>Cancel</AlertDialogCancel>
//                     <Button onClick={handleConfirm} disabled={!selectedProjectId || selectedCategories.length === 0 || createLoading}>
//                         {createLoading ? <TailSpin width={20} height={20} color="white" /> : "Confirm"}
//                     </Button>
//                 </AlertDialogFooter>
//             </AlertDialogContent>
//         </AlertDialog>
//     );
// };


// // --- Nested Task View Component (Uses Hook) ---

// interface ExpandedProjectTasksProps {
//     trackerId: string;
//     refetchList: () => void; 
// }

// const ExpandedProjectTasks: React.FC<ExpandedProjectTasksProps> = ({ trackerId, refetchList }) => {
    
//     // 1. Use the centralized hook for data and actions related to this specific trackerId
//     const {
//         groupedTasks, isLoading, error, getDesignerName,
//         handleTaskSave, editingTask, setEditingTask, usersList,
//     } = useDesignTrackerLogic({ trackerId }); 

//     // 2. Local state for Category Accordion
//     const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

//     // Toggle handler for categories
//     const toggleCategory = useCallback((categoryName: string) => {
//         setExpandedCategories(prev => ({
//             ...prev,
//             [categoryName]: !prev[categoryName],
//         }));
//     }, []);

//     // 3. Task Save Handler (Wrapper for serialization before passing to handleTaskSave)
//     const inlineTaskSaveHandler = async (updatedFields: { [key: string]: any }) => {
//         if (!editingTask) return;
        
//         let fieldsToSend: { [key: string]: any } = { ...updatedFields };

//         // Serialization logic (matching the Detail Page)
//         if (Array.isArray(updatedFields.assigned_designers)) { 
//             const structuredDataForServer = {
//                 list: updatedFields.assigned_designers 
//             };
//             fieldsToSend.assigned_designers = JSON.stringify(structuredDataForServer); 
//         }
        
//         try {
//             await handleTaskSave(editingTask.name, fieldsToSend);
//             // After successful save, refresh the parent list view (in case status changed)
//             refetchList();
//         } catch (e) {
//             // Error handling is inside handleTaskSave, but we catch here to prevent further component failure.
//         }
//     };
    
//     // Helper function to render designer name (Bulleted list)
//     const getAssignedNameForDisplay = (task: DesignTrackerTask): React.ReactNode => {
//         const designerField = task.assigned_designers;
//         let designers: AssignedDesignerDetail[] = [];
        
//         if (designerField) {
//             // Check if already parsed object (which happens in useDesignTrackerLogic state)
//             if (designerField && typeof designerField === 'object' && Array.isArray(designerField.list)) {
//                 designers = designerField.list;
//             } else if (Array.isArray(designerField)) {
//                  designers = designerField;
//              } else if (typeof designerField === 'string' && designerField.trim() !== '') {
//                  try { 
//                      const parsed = JSON.parse(designerField); 
//                      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list)) {
//                         designers = parsed.list; 
//                      } else if (Array.isArray(parsed)) {
//                         designers = parsed; 
//                      }
//                  } catch (e) { /* silent fail */ }
//              }
//         }
        
//        if (designers.length > 0) {
//             return (
//                 <ul className="list-disc ml-4 p-0 m-0 space-y-0.5 text-xs"> 
//                     {designers.map((d, index) => (
//                         <li key={index}>
//                             {d.userName || d.userId}
//                         </li>
//                     ))}
//                 </ul>
//             );
//         }
//         return getDesignerName(undefined);
//     };
    
//     const getDeadlineDisplay = (task: DesignTrackerTask) => {
//         return task.deadline ? new Date(task.deadline).toLocaleDateString('en-GB').replace(/20(\d{2})$/, '$1') : '...';
//     }


//     if (isLoading) return <LoadingFallback />;
//     if (error) return <AlertDestructive error={error} />;
    
//     return (
//         <div className="space-y-4 px-1 py-2">
//             {Object.entries(groupedTasks).map(([categoryName, tasks]) => {
//                 const isCategoryExpanded = expandedCategories[categoryName] ?? true;
                
//                 return (
//                     <div key={categoryName} className="border rounded-lg bg-white shadow-sm">
//                         {/* Category Header (Clickable for toggle) */}
//                         <div 
//                             className={`flex justify-between items-center px-4 py-3 cursor-pointer 
//                                 ${isCategoryExpanded ? 'border-b bg-gray-50 rounded-t-lg' : 'bg-gray-50 rounded-lg'}`}
//                             onClick={() => toggleCategory(categoryName)}
//                         >
//                             <h4 className="font-semibold text-gray-800">{categoryName} ({tasks.length} Tasks)</h4>
//                             {isCategoryExpanded ? <ChevronUp className="h-4 w-4 text-gray-600" /> : <ChevronDown className="h-4 w-4 text-gray-600" />}
//                         </div>

//                         {/* Task Table (Conditionally rendered) */}
//                         {isCategoryExpanded && (
//                             <div className="overflow-x-auto">
//                                 <table className="min-w-full divide-y divide-gray-200">
//                                     <thead className="bg-gray-100 text-xs text-gray-500 uppercase">
//                                         <tr>
//                                             <th className="px-4 py-3 text-left">Task Name</th>
//                                             <th className="px-4 py-3 text-left">Assigned Designer</th>
//                                             <th className="px-4 py-3 text-left">Deadline</th>
//                                             <th className="px-4 py-3 text-left">Status</th>
//                                             <th className="px-4 py-3 text-left">Sub-Status</th>
//                                             <th className="px-4 py-3 text-center">Comments</th>
//                                             <th className="px-4 py-3 text-center">Link</th>
//                                             <th className="px-4 py-3 text-center">Actions</th>
//                                         </tr>
//                                     </thead>
//                                     <tbody className="divide-y divide-gray-100">
//                                         {tasks.map((task) => (
//                                             <tr key={task.name} className="text-sm text-gray-800">
//                                                 <td className="px-4 py-3 font-medium">{task.task_name}</td>
//                                                 <td className="px-4 py-3">{getAssignedNameForDisplay(task)}</td>
//                                                 <td className="px-4 py-3 whitespace-nowrap">{getDeadlineDisplay(task)}</td>
                                                
//                                                 <td className="px-4 py-3">
//                                                     <Badge variant="outline" className="w-full justify-center bg-gray-100 text-gray-700 border-gray-300 rounded-full h-8">
//                                                         {task.task_status || '...'}
//                                                     </Badge>
//                                                 </td>
                                                
//                                                 <td className="px-4 py-3">
//                                                     <Badge variant="outline" className="w-full justify-center bg-gray-100 text-gray-700 border-gray-300 rounded-full h-8">
//                                                         {task.task_sub_status || '...'}
//                                                     </Badge>
//                                                 </td>
                                                
//                                                 <td className="px-4 py-3 text-center">
//                                                     {task.comments ? <MessageCircle className="h-4 w-4 text-gray-500 mx-auto" title={task.comments} /> : <MessageCircle className="h-4 w-4 text-gray-300 mx-auto" />}
//                                                 </td>
                                                
//                                                 <td className="px-4 py-3 text-center">
//                                                     {task.file_link ? <a href={task.file_link} target="_blank" rel="noopener noreferrer"><LinkIcon className="h-4 w-4 text-blue-500 mx-auto" /></a> : <LinkIcon className="h-4 w-4 text-gray-300 mx-auto" />}
//                                                 </td>
                                                
//                                                 {/* Actions: Triggers Modal */}
//                                                 <td className="px-4 py-3 text-center">
//                                                     <Button variant="outline" size="sm" className="h-8" onClick={() => setEditingTask(task)}>
//                                                         <Edit className="h-3 w-3 mr-1" /> Edit
//                                                     </Button>
//                                                 </td>
//                                             </tr>
//                                         ))}
//                                     </tbody>
//                                 </table>
//                             </div>
//                         )}
//                     </div>
//                 );
//             })}
            
//             {/* Task Edit Modal (Visible only if editingTask is set) */}
//             {editingTask && (
//                 <TaskEditModal
//                     isOpen={!!editingTask}
//                     onOpenChange={(open) => { if (!open) setEditingTask(null); }}
//                     task={editingTask}
//                     onSave={inlineTaskSaveHandler}
//                     usersList={usersList || []}
//                 />
//             )}
//         </div>
//     );
// };


// // --- Main Component: DesignTrackerList ---
// export const DesignTrackerList: React.FC = () => {
//     const navigate = useNavigate();
//     const [isModalOpen, setIsModalOpen] = useState(false);
//     const [searchTerm, setSearchTerm] = useState('');
//     const [activeTab, setActiveTab] = useState<'project' | 'task'>('project');
    
//     const [expandedProject, setExpandedProject] = useState<string | null>(null);

//     // Fetch Design Tracker List
//     const { data: trackerDocs, isLoading, error, mutate: refetchList } = useFrappeGetDocList<ProjectDesignTracker>(
//         DOCTYPE, 
//         { fields: ["name", "project", "project_name", "status", "creation", "modified", "overall_deadline"], orderBy: { field: "creation", order: "desc" }, limit: 100 }
//     );
    
//     // Fetch master data (we only need project options for creation modal here)
//     const { projectOptions,categories ,categoryData} = useDesignMasters();

//     console.log("useDesignMasters",categoryData,categories);

//     const filteredDocs = useMemo(() => {
//         if (!trackerDocs) return [];
        
//         const lowerCaseSearch = searchTerm.toLowerCase();
        
//         return trackerDocs
//             .filter(doc => 
//                 doc.project_name.toLowerCase().includes(lowerCaseSearch) ||
//                 doc.name.toLowerCase().includes(lowerCaseSearch)
//             );
//     }, [trackerDocs, searchTerm]);
    
//     const handleToggleCollapse = useCallback((docName: string) => {
//         setExpandedProject(prev => prev === docName ? null : docName);
//     }, []);

//     if (isLoading) return <TableSkeleton />;
//     if (error) return <AlertDestructive error={error} />;


//     return (
//         <div className="flex-1 space-y-6 p-4 md:p-8">
//             <header className="flex justify-between items-center">
//                 <h1 className="text-2xl font-bold text-red-700">Design Tracker</h1>
//                 <Button onClick={() => setIsModalOpen(true)} className="flex items-center gap-1 bg-red-700 hover:bg-red-800">
//                     <CirclePlus className="h-4 w-4" /> Track New Project
//                 </Button>
//             </header>

//             {/* Tabs */}
//             <div className="flex space-x-2 border-b border-gray-200">
//                 <button
//                     onClick={() => setActiveTab('project')}
//                     className={`px-4 py-2 text-sm font-medium ${activeTab === 'project' ? 'border-b-2 border-red-700 text-red-700' : 'text-gray-500'}`}
//                 >
//                     Project Wise
//                 </button>
//                 <button
//                     onClick={() => setActiveTab('task')}
//                     className={`px-4 py-2 text-sm font-medium ${activeTab === 'task' ? 'border-b-2 border-red-700 text-red-700' : 'text-gray-500'}`}
//                 >
//                     Task Wise
//                 </button>
//             </div>

//             {/* PROJECT WISE VIEW */}
//             {activeTab === 'project' && (
//                 <>
//                     {/* Search and Filter (Project Wise) */}
//                     <div className="flex items-center space-x-3">
//                         <div className="relative flex-grow">
//                             <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
//                             <Input
//                                 placeholder="Search Projects"
//                                 value={searchTerm}
//                                 onChange={(e) => setSearchTerm(e.target.value)}
//                                 className="pl-10 h-10" 
//                             />
//                         </div>
//                         <Button variant="outline" className="flex items-center gap-2 h-10">
//                             <Filter className="h-4 w-4" /> Filter
//                         </Button>
//                     </div>

//                     {/* List View (Project Wise) */}
//                     <div className="space-y-3">
//                         {filteredDocs.length === 0 ? (
//                             <p className="text-center text-gray-500 p-10">No design trackers found matching your search criteria.</p>
//                         ) : (
//                             filteredDocs.map((doc) => {
//                                 const isPending = doc.status.toLowerCase().includes('assign pending');
//                                 const isExpanded = expandedProject === doc.name;

//                                 return (
//                                     <div key={doc.name}>
//                                         <Card 
//                                             className={`p-4 transition-all duration-200 cursor-pointer 
//                                                 ${isPending ? 'border-red-600 border' : 'border-gray-200 border'} 
//                                                 ${isExpanded ? 'rounded-b-none border-b-0' : 'rounded-lg hover:shadow-md'}`}
//                                             onClick={() => handleToggleCollapse(doc.name)} 
//                                         >
//                                             <CardContent className="p-0 flex flex-wrap justify-between items-center text-sm md:text-base relative">
                                                
//                                                 {/* Row 1: Project Name (Link) */}
//                                                 <div className="w-full md:w-1/4  pr-4 order- mb-2 md:mb-0">
//                                                     <Link 
//                                                         to={`/design-tracker/${doc.name}`} 
//                                                         className={`text-base font-semibold underline-offset-2 hover:underline 
//                                                             ${isPending ? 'text-red-700' : 'text-gray-900'}`}
//                                                         onClick={(e) => e.stopPropagation()} 
//                                                     >
//                                                         {doc.project_name}
//                                                     </Link>
//                                                 </div>
                                                
//                                                 {/* Row 2: Date & Status */}
                                             
                                                    
//                                                     {/* Date Section */}
//                                                     <div className="text-gray-600 flex flex-col items-start md:items-center w-1/2 md:w-auto">
//                                                         <div className="text-xs text-gray-500 capitalize font-medium">Task Created On:</div>
//                                                         <div className="text-sm font-medium text-gray-900">
//                                                             {formatDate(doc.creation)}
//                                                         </div>
//                                                     </div>

//                                                     {/* Status Section */}
//                                                     <div className="text-right flex flex-col items-end md:items-center w-1/2 md:w-auto">
//                                                         <div className="text-xs text-gray-500 capitalize font-medium">Status</div>
//                                                         <Badge 
//                                                             className={`capitalize text-sm ${getStatusBadgeStyle(doc.status)}`}
//                                                         >
//                                                             {doc.status}
//                                                         </Badge>
//                                                     </div>
                                               

//                                                 {/* Row 3: Action Icon */}
//                                                 <div className="absolute right-0 top-0 md:static md:order-3 md:ml-4">
//                                                     <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:bg-gray-100">
//                                                         {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
//                                                     </Button>
//                                                 </div>
//                                             </CardContent>
//                                         </Card>
                                        
//                                         {/* Expanded Content */}
//                                         {isExpanded && (
//                                             <div 
//                                                 className={`bg-white border rounded-b-lg p-0 
//                                                     ${isPending ? 'border-red-600 border-t-0' : 'border-gray-200 border-t-0'}`}
//                                             >
//                                                 <ExpandedProjectTasks 
//                                                     trackerId={doc.name} 
//                                                     refetchList={refetchList}
//                                                 />
//                                             </div>
//                                         )}
//                                     </div>
//                                 );
//                             })
//                         )}
//                     </div>
//                 </>
//             )}

//             {/* TASK WISE VIEW */}
//             {activeTab === 'task' && (
//                 // Renders the TaskWiseTable component which handles its own data/search
//                  <TaskWiseTable refetchList={refetchList} searchTerm={searchTerm} onSearchTermChange={setSearchTerm} />
//             )}

//             <NewTrackerModal
//                 isOpen={isModalOpen}
//                 onClose={() => setIsModalOpen(false)}
//                 projectOptions={projectOptions}
//                 categoryData={categoryData}
//                 onSuccess={() => refetchList()}
//             />
//         </div>
//     );
// };

// export default DesignTrackerList;


import React, { useMemo, useState, useCallback, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFrappeCreateDoc, useFrappeGetDocList } from "frappe-react-sdk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp, Search, Filter, CirclePlus, Link as LinkIcon, MessageCircle, Edit } from "lucide-react";
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel
} from "@/components/ui/alert-dialog";
import { TailSpin } from "react-loader-spinner";
import { toast } from "@/components/ui/use-toast";
import { useDesignMasters, DESIGN_CATEGORIES } from "./hooks/useDesignMasters";
import { ProjectDesignTracker, DesignTrackerTask, AssignedDesignerDetail } from "./types";
import { getUrlStringParam } from '@/hooks/useServerDataTable';
import { urlStateManager } from '@/utils/urlStateManager';
import { useDesignTrackerLogic } from "./hooks/useDesignTrackerLogic";
import { TaskEditModal } from './project-design-tracker-details';
import { TaskWiseTable } from "./components/TaskWiseTable";

const DOCTYPE = 'Project Design Tracker';
const FE_TASK_STATUS_OPTIONS = ["Todo", "In Progress", "Done", "Blocked", "On Hold", "Submitted"];
const DESIGN_TABS = { PROJECT_WISE: 'project', TASK_WISE: 'task' };

const getOrdinalNum = (n: number) => {
    return n + (n > 0 ? ['th', 'st', 'nd', 'rd'][(n > 3 && n < 21) || n % 10 > 3 ? 0 : n % 10] : '')
};

const formatDate = (dateString: string): string => {
    try {
        const date = new Date(dateString);
        const day = date.getDate();
        const month = date.toLocaleString('en-US', { month: 'short' });
        const year = date.getFullYear();
        return `${getOrdinalNum(day)} ${month}, ${year}`
    } catch (e) {
        return 'N/A'
    }
};

const getStatusBadgeStyle = (status: string) => {
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('pending') || lowerStatus.includes('assign pending')) {
        return 'bg-red-100 text-red-700 border border-red-500 font-medium rounded-full'
    }
    if (lowerStatus.includes('in progress')) {
        return 'bg-blue-100 text-blue-700 border border-blue-500 font-medium rounded-full'
    }
    if (lowerStatus.includes('on hold') || lowerStatus.includes('blocked')) {
        return 'bg-yellow-100 text-yellow-700 border border-yellow-500 font-medium rounded-full'
    }
    if (lowerStatus.includes('submitted') || lowerStatus.includes('completed') || lowerStatus.includes('done')) {
        return 'bg-green-100 text-green-700 border border-green-500 font-medium rounded-full'
    }
    return 'bg-gray-100 text-gray-700 border border-gray-300 font-medium rounded-full'
};

const NewTrackerModal: React.FC<any> = ({ isOpen, onClose, projectOptions, categoryData, onSuccess }) => {
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();

    const handleCategoryToggle = (categoryName: string) => {
        setSelectedCategories(prev => prev.includes(categoryName) ? prev.filter(c => c !== categoryName) : [...prev, categoryName])
    };

    const handleConfirm = async () => {
        if (!selectedProjectId || selectedCategories.length === 0) {
            toast({ title: "Error", description: "Select project and at least one category.", variant: "destructive" });
            return;
        }

        const projectLabel = projectOptions.find(p => p.value === selectedProjectId)?.label;
        if (!projectLabel) return;

        const tasksToGenerate: Partial<DesignTrackerTask>[] = [];

        selectedCategories.forEach(catName => {
            const categoryDef = categoryData.find(c => c.category_name === catName);

            // Updated logic: Skip category if tasks array is missing or empty
            if (categoryDef && Array.isArray(categoryDef.tasks) && categoryDef.tasks.length > 0) {
                const taskItems = categoryDef.tasks;

                taskItems.forEach(taskDef => {
                    const taskName = taskDef.task_name;
                    tasksToGenerate.push({
                        task_name: taskName,
                        design_category: catName,
                        task_status: 'Todo',
                        deadline: undefined,
                    })
                });
            } else {
                // Category is skipped, provide feedback via toast
                toast({
                    title: "Category Skipped",
                    description: `Category ${catName} has no tasks defined in master data and was skipped.`,
                    variant: "destructive"
                });
                return; // Skip to the next category in the forEach loop
            }
        });

        if (tasksToGenerate.length === 0) {
            toast({ title: "Error", description: "No tasks could be generated from selected categories.", variant: "destructive" });
            return;
        }

        try {
            await createDoc(DOCTYPE, {
                project: selectedProjectId,
                project_name: projectLabel,
                status: 'Assign Pending',
                design_tracker_task: tasksToGenerate
            });
            toast({ title: "Success", description: `Design Tracker created for ${projectLabel}.`, variant: "success" });
            onSuccess();
            onClose();
        } catch (error: any) {
            toast({ title: "Creation Failed", description: error.message || "Failed to create tracker.", variant: "destructive" })
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={onClose}>
            <AlertDialogContent className="sm:max-w-lg">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center">Select Project</AlertDialogTitle>
                    <AlertDialogDescription className="text-center">Step 1: Select a project that you want to add to the design tracker</AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-6 py-4">
                    {/* Project Selection */}
                    <div>
                        <Label htmlFor="Projects">Select Project *</Label>
                        <Select value={selectedProjectId || ""} onValueChange={(val) => setSelectedProjectId(val)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select Project" />
                            </SelectTrigger>
                            <SelectContent>
                                {projectOptions.map(p => (
                                    <SelectItem key={p.value} value={p.value}>
                                        {p.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Category Selection */}
                    <div className="space-y-3">
                        <AlertDialogDescription>Step 2: Choose one or more categories for this project</AlertDialogDescription>
                        <div className="grid grid-cols-3 gap-3">
                            {categoryData.map(cat => (
                                <Button
                                    key={cat.category_name}
                                    variant={selectedCategories.includes(cat.category_name) ? "default" : "outline"}
                                    onClick={() => handleCategoryToggle(cat.category_name)}
                                >
                                    {cat.category_name}
                                </Button>
                            ))}
                        </div>
                    </div>
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={createLoading} onClick={onClose}> Cancel</AlertDialogCancel>
                    <Button
                        onClick={handleConfirm}
                        disabled={!selectedProjectId || selectedCategories.length === 0 || createLoading}
                    >
                        {createLoading ? <TailSpin width={20} height={20} color="white" /> : "Confirm"}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
};

interface ExpandedProjectTasksProps {
    trackerId: string;
    refetchList: () => void;
}

const ExpandedProjectTasks: React.FC<ExpandedProjectTasksProps> = ({ trackerId, refetchList }) => {
    const {
        groupedTasks, isLoading, error, getDesignerName,
        handleTaskSave, editingTask, setEditingTask, usersList,statusOptions,
        subStatusOptions,
    } = useDesignTrackerLogic({ trackerId });

    const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

    // ✅ FIX: Move useEffect outside of the map loop (Rules of Hooks violation)
    useEffect(() => {
        // Automatically expand the first category when data loads, if none are expanded
        if (Object.keys(groupedTasks).length > 0 && !Object.keys(expandedCategories).length) {
            setExpandedCategories({ [Object.keys(groupedTasks)[0]]: true });
        }
    }, [groupedTasks]); // Dependency on groupedTasks to trigger when data is fetched

    const toggleCategory = useCallback((categoryName: string) => {
        setExpandedCategories(prev => ({ ...prev, [categoryName]: !prev[categoryName] }))
    }, []);

    const inlineTaskSaveHandler = async (updatedFields: { [key: string]: any }) => {
        if (!editingTask) return;

        let fieldsToSend: { [key: string]: any } = { ...updatedFields };

        // Handle assigned_designers array transformation for Frappe
        if (Array.isArray(updatedFields.assigned_designers)) {
            const structuredDataForServer = { list: updatedFields.assigned_designers };
            fieldsToSend.assigned_designers = JSON.stringify(structuredDataForServer);
        }

        try {
            await handleTaskSave(editingTask.name, fieldsToSend);
            refetchList();
        } catch (e) {
            // Error handling, if needed
        }
    };

    const getAssignedNameForDisplay = (task: DesignTrackerTask): React.ReactNode => {
        const designerField = task.assigned_designers;
        let designers: AssignedDesignerDetail[] = [];

        if (designerField) {
            if (designerField && typeof designerField === 'object' && Array.isArray(designerField.list)) {
                designers = designerField.list
            } else if (Array.isArray(designerField)) {
                designers = designerField
            } else if (typeof designerField === 'string' && designerField.trim() !== '') {
                try {
                    const parsed = JSON.parse(designerField);
                    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list)) {
                        designers = parsed.list
                    } else if (Array.isArray(parsed)) {
                        designers = parsed
                    }
                } catch (e) {
                    // JSON parsing failed
                }
            }
        }

        if (designers.length > 0) {
            return (
                <ul className="list-disc ml-4 p-0 m-0 space-y-0.5 text-xs">
                    {designers.map((d, index) => (
                        <li key={index}>
                            {d.userName || d.userId}
                        </li>
                    ))}
                </ul>
            )
        }
        return getDesignerName(undefined); // Fallback or handle null case
    };

    const getDeadlineDisplay = (task: DesignTrackerTask) => {
        if (!task.deadline) return '...';
        try {
            return new Date(task.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '/')
        } catch {
            return '...'
        }
    }

    if (isLoading) return <LoadingFallback />;
    if (error) return <AlertDestructive error={error} />;

    return (
        <div className="space-y-4 px-1 py-2">
            {Object.entries(groupedTasks).map(([categoryName, tasks]) => {
                const isCategoryExpanded = expandedCategories[categoryName] ?? false;

                return (
                    <div key={categoryName} className="border rounded-lg bg-white shadow-sm">
                        {/* Category Header */}
                        <div
                            className={`flex justify-between items-center px-4 py-3 cursor-pointer
                                ${isCategoryExpanded ? 'border-b bg-white rounded-t-lg' : 'bg-gray-50 rounded-lg'}`}
                            onClick={() => toggleCategory(categoryName)}
                        >
                            <h4 className="font-semibold text-gray-800">{categoryName} ({tasks.length} Tasks)</h4>
                            {isCategoryExpanded ? <ChevronUp className="h-4 w-4 text-gray-600" /> : <ChevronDown />}
                        </div>

                        {/* Task Table */}
                        {isCategoryExpanded && (
                            <div className="overflow-x-auto">
                               <table className="min-w-full divide-y divide-gray-200 table-fixed"> {/* Added table-fixed */}
                                    <thead className="bg-gray-100 text-xs text-gray-500 uppercase">
                                        <tr>
                                            {/* Fixed widths applied to ensure alignment across all tables */}
                                            <th className="px-4 py-3 text-left w-[18%]">Task Name</th> 
                                            <th className="px-4 py-3 text-left w-[14%]">Assigned Designer</th>
                                            <th className="px-4 py-3 text-left w-[10%]">Deadline</th>
                                            <th className="px-4 py-3 text-left w-[12%]">Status</th>
                                            <th className="px-4 py-3 text-left w-[16%]">Sub-Status</th>
                                            <th className="px-4 py-3 text-center w-[8%]">Comments</th>
                                            <th className="px-4 py-3 text-center w-[8%]">Link</th>
                                            <th className="px-4 py-3 text-center w-[14%]">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {tasks.map((task) => (
                                            <tr key={task.name} className="text-sm text-gray-800">
                                                <td className="px-4 py-3 font-medium truncate">{task.task_name}</td>
                                                <td className="px-4 py-3">{getAssignedNameForDisplay(task)}</td>
                                                <td className="px-4 py-3 whitespace-nowrap">{getDeadlineDisplay(task)}</td>
                                                
                                                <td className="px-4 py-3">
                                                    <Badge variant="outline" className="w-full justify-center bg-gray-100 text-gray-700 border-gray-300 rounded-full h-8">
                                                        {task.task_status || '...'}
                                                    </Badge>
                                                </td>
                                                
                                                <td className="px-4 py-3">
                                                    <Badge variant="outline" className="w-full justify-center bg-gray-100 text-gray-700 border-gray-300 rounded-full h-8">
                                                        {task.task_sub_status || '...'}
                                                    </Badge>
                                                </td>
        <td className="px-4 py-3 text-center">
            <TooltipProvider>
                <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                        {/* We use cursor-default here as the trigger handles the hover interaction */}
                        <MessageCircle 
                            className={`h-4 w-4 mx-auto cursor-default ${task.comments ? 'text-gray-600' : 'text-gray-300'}`} 
                        />
                    </TooltipTrigger>
                    {task.comments && (
                        <TooltipContent className="max-w-xs p-3 bg-white text-gray-900 border shadow-lg">
                            {/* <p className="font-semibold text-xs mb-1">Comments:</p> */}
                            <p className="text-sm">{task.comments}</p>
                        </TooltipContent>
                    )}
                </Tooltip>
            </TooltipProvider>
        </td>
        
        {/* 2. Link Column (Using Tooltip) */}
        <td className="px-4 py-3 text-center">
            {task.file_link ? (
                <TooltipProvider>
                    <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                            <a 
                                href={task.file_link} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="block w-full h-full cursor-pointer hover:scale-110 transition-transform"
                            >
                                <LinkIcon className="h-4 w-4 text-blue-500 mx-auto" />
                            </a>
                        </TooltipTrigger>
                        <TooltipContent className="p-2 bg-gray-900 text-white shadow-lg">
                           <a 
                                href={task.file_link} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="block w-full h-full cursor-pointer hover:scale-110 transition-transform"
                            >
                                {task.file_link.substring(0, 30)}...
                            </a>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            ) : (
                <LinkIcon className="h-4 w-4 text-gray-300 mx-auto" />
            )}
        </td> 
                                                {/* Actions: Triggers Modal */}
                                                <td className="px-4 py-3 text-center">
                                                    <Button variant="outline" size="sm" className="h-8" onClick={() => setEditingTask(task)}>
                                                        <Edit className="h-3 w-3 mr-1" /> Edit
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )
            })}
            {/* Task Edit Modal */}
            {editingTask && (
                <TaskEditModal
                    isOpen={!!editingTask}
                    onOpenChange={(open) => { if (!open) setEditingTask(null); }}
                    task={editingTask}
                    onSave={inlineTaskSaveHandler}
                    usersList={usersList || []}
                    statusOptions={statusOptions}
                    subStatusOptions={subStatusOptions}
                />
            )}
        </div>
    )
};

export const DesignTrackerList: React.FC = () => {
    const navigate = useNavigate();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const initialTab = useMemo(() => getUrlStringParam("tab", DESIGN_TABS.PROJECT_WISE), []);
    const [activeTab, setActiveTab] = useState<string>(initialTab);
    const [expandedProject, setExpandedProject] = useState<string | null>(null);

    const onClick = useCallback((value: string) => {
        if (activeTab === value) return;
        setActiveTab(value)
    }, [activeTab]);

    useEffect(() => {
        if (urlStateManager.getParam("tab") !== activeTab) {
            urlStateManager.updateParam("tab", activeTab)
        }
    }, [activeTab]);

    useEffect(() => {
        const unsubscribe = urlStateManager.subscribe("tab", (_, value) => {
            const newTab = value || DESIGN_TABS.PROJECT_WISE;
            if (activeTab !== newTab) {
                setActiveTab(newTab)
            }
        });
        return unsubscribe;
    }, []);

    const {
        data: trackerDocs, isLoading, error, mutate: refetchList
    } = useFrappeGetDocList<ProjectDesignTracker>(DOCTYPE, {
        fields: ["name", "project", "project_name", "status", "creation", "modified", "overall_deadline"],
        orderBy: { field: "creation", order: "desc" },
        limit: 100
    });

    const { projectOptions, categories, categoryData, statusOptions,
            subStatusOptions, } = useDesignMasters();

    const filteredDocs = useMemo(() => {
        if (!trackerDocs) return [];
        const lowerCaseSearch = searchTerm.toLowerCase();
        return trackerDocs.filter(doc =>
            doc.project_name.toLowerCase().includes(lowerCaseSearch) ||
            doc.name.toLowerCase().includes(lowerCaseSearch)
        )
    }, [trackerDocs, searchTerm]);

    const handleToggleCollapse = useCallback((docName: string) => {
        setExpandedProject(prev => prev === docName ? null : docName)
    }, []);

    if (isLoading) return <TableSkeleton />;
    if (error) return <AlertDestructive error={error} />;

    return (
        <div className="flex-1 space-y-6 p-2 md:p-2">
            <header className="flex justify-between items-center">
                {/* <h1 className="text-2xl font-bold text-red-700">Design Tracker</h1> */}
                 <div className="flex space-x-0 border border-gray-300 rounded-md overflow-hidden w-fit">
    
    <Button
        onClick={() => onClick(DESIGN_TABS.PROJECT_WISE)}
        className={`px-4 py-2 text-sm font-medium h-auto shadow-none 
            ${activeTab === DESIGN_TABS.PROJECT_WISE ? 'bg-primary text-white hover:bg-primary-dark' : 'bg-white text-gray-700 '}
            
            /* Apply border-right to create the visual divider */
            border-r border-gray-300 
            
            /* Ensure right side is square, left side gets rounding from parent div */
            rounded-r-none 
        `}
    >
        Project Wise
    </Button>
    
    <Button
        onClick={() => onClick(DESIGN_TABS.TASK_WISE)}
        className={`px-4 py-2 text-sm font-medium h-auto shadow-none 
            ${activeTab === DESIGN_TABS.TASK_WISE ? 'bg-primary text-white hover:bg-primary-dark' : 'bg-white text-gray-800 '}
            
            /* Ensure left side is square, right side gets rounding from parent div */
            rounded-l-none 
        `}
    >
        Task Wise
    </Button>
</div>
           {activeTab !== DESIGN_TABS.TASK_WISE && (
                <Button onClick={() => setIsModalOpen(true)} className="">
                    <CirclePlus className="h-5 w-5 pr-1" /> Track New Project
                </Button>
            )}
                
            </header>

        
            {/* Search and Filter */}
            {
                activeTab !==DESIGN_TABS.TASK_WISE &&(
 <div className="flex items-center space-x-3">
                <div className="relative flex-grow">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                    <Input
                        placeholder="Search Projects"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 h-10 border-gray-300"
                    />
                </div>
                <Button variant="outline" className="flex items-center gap-2 h-10 border-gray-300 text-gray-700">
                    <Filter className="h-4 w-4" /> Filter
                </Button>
            </div>
                )
            }
           

            {/* Content based on Active Tab */}
            {activeTab === DESIGN_TABS.PROJECT_WISE && (
                <div className="space-y-3">
                    {filteredDocs.length === 0 ? (
                        <p className="text-center text-gray-500 p-10">No design trackers found matching your search criteria.</p>
                    ) : (
                        filteredDocs.map((doc) => {
                            const isPending = doc.status.toLowerCase().includes('assign pending');
                            const isExpanded = expandedProject === doc.name;

                            return (
                                <div key={doc.name}>
                                    <Card
                                        className={`p-4 transition-all duration-200 cursor-pointer
                                                ${isPending ? 'border-destructive border-2' : 'border-gray-200 borde-2'}
                                                ${isExpanded ? 'rounded-b-none border-b-0' : 'rounded-lg hover:shadow-md'}`}
                                        onClick={() => handleToggleCollapse(doc.name)}
                                    >
                                        <CardContent className="p-0 flex flex-wrap justify-between items-center text-sm md:text-base relative">
                                            {/* Project Name */}
                                            <div className="w-full md:w-1/4 min-w-[150px] pr-4 order1 mb-2 md:mb-0">
                                                <Link
                                                    to={`/design-tracker/${doc.name}`}
                                                    className={`text-lg font-extrabold underline-offset-2 hover:underline
                                                            ${isPending ? 'text-destructive' : 'text-Black'}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    {doc.project_name}
                                                </Link>
                                            </div>

                                            {/* Details */}
                                            {/* Date Section */}
                                                    <div className="text-gray-600 flex flex-col items-start md:items-center w-1/2 md:w-auto">
                                                        <div className="text-xs text-gray-500 capitalize font-medium">Task Created On:</div>
                                                        <div className="text-sm font-medium text-gray-900">
                                                            {formatDate(doc.creation)}
                                                        </div>
                                                    </div>

                                                    {/* Status Section */}
                                                    <div className="text-right flex flex-col items-end md:items-center w-1/2 md:w-auto">
                                                        <div className="text-xs text-gray-500 capitalize font-medium">Status</div>
                                                        <Badge 
                                                            className={`capitalize text-sm ${getStatusBadgeStyle(doc.status)}`}
                                                        >
                                                            {doc.status}
                                                        </Badge>
                                                    </div>

                                             {/* Row 3: Action Icon */}
                                                <div className="absolute right-0 top-0 md:static md:order-3 md:ml-4">
                                                    <Button variant="outline" size="icon" className="h-8 w-8 bg-gray-100  hover:bg-gray-200">
                                                        {isExpanded ? <ChevronUp className="h-5 w-5 " /> : <ChevronDown className="h-5 w-5 " />}
                                                    </Button>
                                                </div>
                                        </CardContent>
                                    </Card>

                                    {/* Expanded Task List */}
                                    {isExpanded && (
                                        <div className={`bg-white border-2 rounded-b-lg p-0
                                                ${isPending ? 'border-destructive border-t-2' : 'border-gray-200 border-t-2'}`}>
                                            <ExpandedProjectTasks trackerId={doc.name} refetchList={refetchList} />
                                        </div>
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
            )}

            {activeTab === DESIGN_TABS.TASK_WISE && (
                <TaskWiseTable refetchList={refetchList} searchTerm={searchTerm} onSearchTermChange={setSearchTerm} />
            )}

            {/* Modal for New Tracker */}
            <NewTrackerModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                projectOptions={projectOptions}
                categoryData={categoryData}
                onSuccess={() => refetchList()}
            />
        </div>
    )
};

export default DesignTrackerList;