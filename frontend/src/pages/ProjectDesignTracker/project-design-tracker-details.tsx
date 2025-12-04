


// // frontend/src/pages/DesignTracker/project-design-tracker-details.tsx

// import React, { useCallback, useMemo, useState } from 'react';
// import { useParams } from 'react-router-dom';
// import { ProjectDesignTracker, DesignTrackerTask, User, AssignedDesignerDetail } from './types';
// import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

// import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
// import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
// import { Button } from '@/components/ui/button';
// import { Badge } from "@/components/ui/badge"; 
// import { Edit, Save, Link as LinkIcon, MessageCircle, ChevronUp, ChevronDown, Download } from 'lucide-react';
// import { toast } from '@/components/ui/use-toast';
// import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
// import { Input } from '@/components/ui/input';
// import ReactSelect from 'react-select';
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
// import { Label } from '@/components/ui/label';
// import { useDesignTrackerLogic } from './hooks/useDesignTrackerLogic';

// const DOCTYPE = 'Project Design Tracker';
// const FE_TASK_STATUS_OPTIONS = ["Todo", "In Progress", "Done", "Blocked", "On Hold", "Submitted"]; 

// // --- DATE & STYLE HELPERS ---
// const getOrdinalNum = (n: number) => {
//     return n + (n > 0 ? ['th', 'st', 'nd', 'rd'][(n > 3 && n < 21) || n % 10 > 3 ? 0 : n % 10] : '');
// };

// const formatDate = (dateString?: string): string => {
//     if (!dateString) return 'N/A';
//     try {
//         const date = new Date(dateString);
//         const day = date.getDate();
//         const month = date.toLocaleString('en-US', { month: 'short' });
//         const year = date.getFullYear();
//         return `${getOrdinalNum(day)} ${month}, ${year}`;
//     } catch (e) {
//         return dateString; // Fallback to raw string if date parsing fails
//     }
// };

// const getTaskStatusStyle = (status: string) => {
//     const lowerStatus = status.toLowerCase();
    
//     if (lowerStatus.includes('in progress')) {
//         return 'bg-blue-100 text-blue-700 border border-blue-500';
//     }
//     if (lowerStatus.includes('on hold')) {
//         return 'bg-yellow-100 text-yellow-700 border border-yellow-500';
//     }
//     if (lowerStatus.includes('submitted')) {
//         return 'bg-green-100 text-green-700 border border-green-500';
//     }
//     if (lowerStatus.includes('done') || lowerStatus.includes('completed')) {
//         return 'bg-green-100 text-green-700 border border-green-500';
//     }
//     if (lowerStatus.includes('blocked')) {
//         return 'bg-red-100 text-red-700 border border-red-500';
//     }
//     return 'bg-gray-100 text-gray-700 border border-gray-300';
// };

// const getSubStatusStyle = (subStatus?: string) => {
//     if (!subStatus || subStatus === '...') return 'bg-gray-100 text-gray-700 border border-gray-300';
    
//     const lowerSubStatus = subStatus.toLowerCase();
//     if (lowerSubStatus.includes('clarification') || lowerSubStatus.includes('rework') || lowerSubStatus.includes('sub-status 1')) {
//         return 'bg-red-100 text-red-700 border border-red-500';
//     }
//     return 'bg-gray-100 text-gray-700 border border-gray-300';
// };


// // --- Task Edit Modal Components (Master Definition) ---
// interface DesignerOption {
//     value: string; // userId
//     label: string; // fullName
//     email: string;
// }

// interface TaskEditModalProps {
//     task: DesignTrackerTask;
//     onSave: (updatedTask: { [key: string]: any }) => Promise<void>; 
//     usersList: User[];
//     isOpen: boolean;
//     onOpenChange: (open: boolean) => void;
// }

// // NOTE: This modal definition is exported (conceptually) for reuse in design-tracker-list.tsx
// export const TaskEditModal: React.FC<TaskEditModalProps> = ({ task, onSave, usersList, isOpen, onOpenChange }) => {
//     const [selectedDesigners, setSelectedDesigners] = useState<DesignerOption[]>([]);
//     const [editState, setEditState] = useState<Partial<DesignTrackerTask>>({});
//     const [isSaving, setIsSaving] = useState(false);

//     const designerOptions: DesignerOption[] = useMemo(() => 
//         usersList.map(u => ({ label: u.full_name || u.name, value: u.name, email: u.email || '' }))
//     , [usersList]);

//     const getInitialDesigners = useCallback((designerField: AssignedDesignerDetail[] | string | undefined): DesignerOption[] => {
//         let designerDetails: AssignedDesignerDetail[] = [];

//          if (designerField && typeof designerField === 'object' && Array.isArray(designerField.list)) {
//         designerDetails = designerField.list;
//     } 
        
//         if (Array.isArray(designerField)) {
//             designerDetails = designerField;
//         } else if (typeof designerField === 'string' && designerField.trim() !== '') {
//             try { 
//                 const parsed = JSON.parse(designerField); 
                
//                 if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list)) {
//                     designerDetails = parsed.list;
//                 } 
//                 else if (Array.isArray(parsed)) {
//                     designerDetails = parsed; 
//                 }
                
//             } catch (e) { /* silent fail on parsing */ }
//         }
        
//         if (!Array.isArray(designerDetails)) designerDetails = [];

//         return designerDetails.map(stored => 
//             designerOptions.find(opt => opt.value === stored.userId) || 
//             { label: stored.userName, value: stored.userId, email: stored.userEmail } 
//         ).filter((d): d is DesignerOption => !!d);

//     }, [designerOptions]);

//     React.useEffect(() => {
//         if (isOpen) {
//             console.log("Opening modal for task:", task.assigened_designers);
//             const initialDesigners = getInitialDesigners(task.assigned_designers);
//             setSelectedDesigners(initialDesigners);
            
//             setEditState({
//                 deadline: task.deadline,
//                 task_status: task.task_status,       
//                 task_sub_status: task.task_sub_status,
//                 file_link: task.file_link,
//                 comments: task.comments,
//             });
//         }
//     }, [isOpen, task, getInitialDesigners]);

//     const handleSave = async () => {
//         setIsSaving(true);
        
//         const assignedDesignerDetails: AssignedDesignerDetail[] = selectedDesigners.map(d => ({
//             userId: d.value,
//             userName: d.label,
//             userEmail: d.email,
//         }));
        
//         const payloadForServer: { [key: string]: any } = { 
//             ...editState,
//             assigned_designers: assignedDesignerDetails, 
//         };
        
//         try {
//             await onSave(payloadForServer);
//             onOpenChange(false);
//         } catch (error) {
//             toast({ title: "Save Failed", description: "Could not save task details.", variant: "destructive" });
//         } finally {
//             setIsSaving(false);
//         }
//     };

//     return (
//         <Dialog open={isOpen} onOpenChange={onOpenChange}>
//             <DialogContent className="sm:max-w-xl">
//                 <DialogHeader>
//                     <DialogTitle>{task.task_name} ({task.design_category})</DialogTitle>
//                 </DialogHeader>
//                 <div className="grid gap-4 py-4">
//                     {/* Assigned Designer (Multi-Select) */}
//                     <div className="space-y-1">
//                         <Label htmlFor="designer">Assign Designer(s)</Label>
//                         <ReactSelect
//                             isMulti
//                             value={selectedDesigners}
//                             options={designerOptions}
//                             onChange={(newValue) => setSelectedDesigners(newValue as DesignerOption[])}
//                             placeholder="Select designers..."
//                             classNamePrefix="react-select"
//                         />
//                     </div>

//                     {/* Status */}
//                      <div className="space-y-1">
//                         <Label htmlFor="status">Status</Label>
//                         <Select 
//                            value={editState.task_status || ''} 
//                            onValueChange={(val) => setEditState(prev => ({ ...prev, task_status: val as any }))}
//                         >
//                             <SelectTrigger>
//                                 <SelectValue placeholder="Select Status" />
//                             </SelectTrigger>
//                             <SelectContent>
//                                 {FE_TASK_STATUS_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
//                             </SelectContent>
//                         </Select>
//                     </div>
                    
//                     {/* Sub Status */}
//                     <div className="space-y-1">
//                         <Label htmlFor="sub_status">Sub Status</Label>
//                         <Input id="sub_status" value={editState.task_sub_status || ''} onChange={(e) => setEditState(prev => ({ ...prev, task_sub_status: e.target.value }))} placeholder="e.g., Submitted / Verification" />
//                     </div>

//                     {/* Deadline */}
//                     <div className="space-y-1">
//                         <Label htmlFor="deadline">Deadline</Label>
//                         <Input id="deadline" type="date" value={editState.deadline || ''} onChange={(e) => setEditState(prev => ({ ...prev, deadline: e.target.value }))} />
//                     </div>

//                     {/* File Link */}
//                     <div className="space-y-1">
//                         <Label htmlFor="file_link">Design File Link</Label>
//                         <Input id="file_link" type="url" value={editState.file_link || ''} onChange={(e) => setEditState(prev => ({ ...prev, file_link: e.target.value }))} placeholder="https://figma.com/..." />
//                     </div>

//                     {/* Remarks (Comments) */}
//                     <div className="space-y-1">
//                         <Label htmlFor="comments">Remarks</Label>
//                         <textarea id="comments" rows={3} value={editState.comments || ''} onChange={(e) => setEditState(prev => ({ ...prev, comments: e.target.value }))} className="w-full p-2 border rounded" />
//                     </div>

//                 </div>
//                 <DialogFooter>
//                     <DialogClose asChild><Button variant="outline" disabled={isSaving}>Cancel</Button></DialogClose>
//                     <Button onClick={handleSave} disabled={isSaving}>
//                         <Save className="h-4 w-4 mr-2" /> Save Changes
//                     </Button>
//                 </DialogFooter>
//             </DialogContent>
//         </Dialog>
//     );
// };


// // --- Main Detail Component ---
// export const ProjectDesignTrackerDetail: React.FC = () => {
//     const { id: trackerId } = useParams<{ id: string }>();
    
//     const {
//         trackerDoc, groupedTasks, isLoading, error, getDesignerName, handleTaskSave, editingTask, setEditingTask, usersList,handleParentDocSave
//     } = useDesignTrackerLogic({ trackerId: trackerId! });

//     const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
//      // Initialize overallDeadline state from doc
//     const [overallDeadline, setOverallDeadline] = useState(trackerDoc?.overall_deadline || '');
    
//     React.useEffect(() => {
//         if (trackerDoc?.overall_deadline) {
//             // Update state when doc data loads/changes
//             setOverallDeadline(trackerDoc.overall_deadline);
//         }
//     }, [trackerDoc?.overall_deadline]);


//     const toggleCategory = useCallback((categoryName: string) => {
//         setExpandedCategories(prev => ({
//             ...prev,
//             [categoryName]: !prev[categoryName],
//         }));
//     }, []);

//     if (isLoading) return <LoadingFallback />;
//     if (error || !trackerDoc) return <AlertDestructive error={error} />;

//        // --- PARENT DOC UPDATE HANDLER ---
//     const handleDeadlineUpdate = async (newDate: string) => {
//         if (newDate === trackerDoc.overall_deadline) return;

//         try {
//             await handleParentDocSave({ overall_deadline: newDate });
//             toast({ title: "Success", description: "Overall deadline updated." });
//         } catch (e) {
//             toast({ title: "Error", description: "Failed to save deadline.", variant: "destructive" });
//         }
//     };
    
//     // --- INLINE SAVE HANDLER (TASK SERIALIZATION) ---
//     const inlineTaskSaveHandler = async (updatedFields: { [key: string]: any }) => {
//         if (!editingTask) return;
        
//         let fieldsToSend: { [key: string]: any } = { ...updatedFields };

//         // 1. SERIALIZE assigned_designers array into the specific JSON format: {"list": [...] }
//         if (Array.isArray(updatedFields.assigned_designers)) { 
//             const structuredDataForServer = {
//                 list: updatedFields.assigned_designers 
//             };
//             fieldsToSend.assigned_designers = JSON.stringify(structuredDataForServer); 
//         }
        
//         await handleTaskSave(editingTask.name, fieldsToSend);
//     };
    
//     // Helper function to render designer name from the complex field (for table display)
//     const getAssignedNameForDisplay = (task: DesignTrackerTask): React.ReactNode => {
//         const designerField = task.assigned_designers;
//         let designers: AssignedDesignerDetail[] = [];
        
//         if (designerField) {
//             if (Array.isArray(designerField)) {
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


//     return (
//         <div className="flex-1 space-y-6 p-6">
            
//             {/* --- TOP HEADER --- */}
//             <div className="flex justify-between items-start">
//                 <header>
//                     <h1 className="text-3xl font-bold text-red-700">{trackerDoc.project_name}</h1>
//                     <p className="text-sm text-gray-500">ID: {trackerDoc.project}</p>
//                 </header>
//                 <Button variant="destructive" className="flex items-center gap-2">
//                     <Download className="h-4 w-4" /> Export
//                 </Button>
//             </div>

//             {/* --- PROJECT OVERVIEW CARD --- */}
//             <Card className="shadow-lg p-6 bg-white">
//                 <CardTitle className="text-xl font-semibold mb-4">Project Overview</CardTitle>
//                 <div className="grid grid-cols-2 md:grid-cols-5 gap-6 text-sm text-gray-700">
                    
//                     {/* Project ID */}
//                     <div className="space-y-1">
//                         <Label className="uppercase text-xs font-medium text-gray-500">Project ID</Label>
//                         <p className="font-semibold">{trackerDoc.project}</p>
//                     </div>

//                     {/* Project Name */}
//                     <div className="space-y-1">
//                         <Label className="uppercase text-xs font-medium text-gray-500">Project Name</Label>
//                         <p className="font-semibold">{trackerDoc.project_name}</p>
//                     </div>

//                     {/* Created On */}
//                     <div className="space-y-1">
//                         <Label className="uppercase text-xs font-medium text-gray-500">Created On</Label>
//                         <p className="font-semibold">{formatDate(trackerDoc.creation)}</p>
//                     </div>

//                     {/* Project Status */}
//                     <div className="space-y-1">
//                         <Label className="uppercase text-xs font-medium text-gray-500">Project Status</Label>
//                         <p><Badge variant="outline" className={`h-8 px-4 justify-center ${getTaskStatusStyle(trackerDoc.status)}`}>
//                             {trackerDoc.status}
//                         </Badge></p>
                        
//                     </div>
                    
//                     {/* Overall Deadline (Editable Input) */}
//                     <div className="space-y-1">
//                         <Label className="uppercase text-xs font-medium text-gray-500">Overall Deadline</Label>
//                         <div className="relative">
//                             <Input
//                                 type="date"
//                                 value={overallDeadline}
//                                 onChange={(e) => setOverallDeadline(e.target.value)}
//                                 onBlur={(e) => handleDeadlineUpdate(e.target.value)}
//                                 className="pr-2" 
//                             />
//                         </div>
//                     </div>
//                 </div>
//             </Card>

//             {/* --- ON-BOARDING SECTION --- */}
//             <div className="flex justify-between items-center pt-4 border-t">
//                 <h2 className="text-2xl font-bold text-gray-800">On-Boarding</h2> 
//                 <Button variant="outline" className="text-red-700 border-red-700 hover:bg-red-50/50">
//                     Create Custom Task
//                 </Button>
//             </div>
            
//             {/* --- TASK LIST (ACCORDION STYLE) --- */}
//             <div className="space-y-4">
//                 {Object.entries(groupedTasks).map(([categoryName, tasks]) => {
//                     const isExpanded = expandedCategories[categoryName] ?? true; 

//                     return (
//                         <Card key={categoryName} className="shadow-lg border-red-200 border-l-4">
                            
//                             {/* Category Header */}
//                             <CardHeader 
//                                 className="bg-gray-50 flex flex-row justify-between items-center py-3 cursor-pointer"
//                                 onClick={() => toggleCategory(categoryName)}
//                             >
//                                 <CardTitle className="text-lg font-semibold text-gray-800">
//                                     {categoryName} ({tasks.length} Tasks)
//                                 </CardTitle>
//                                 {isExpanded ? <ChevronUp className="h-5 w-5 text-gray-600" /> : <ChevronDown className="h-5 w-5 text-gray-600" />}
//                             </CardHeader>

//                             {/* Task Table Content */}
//                             {isExpanded && (
//                                 <CardContent className="p-0">
//                                     <div className="overflow-x-auto">
//                                         <table className="min-w-full divide-y divide-gray-200">
//                                             <thead className="bg-gray-100">
//                                                 <tr className='text-xs text-gray-500 uppercase font-medium'>
//                                                     <th className="px-4 py-3 text-left w-[15%]">Task Name</th>
//                                                     <th className="px-4 py-3 text-left w-[15%]">Assigned Designer</th>
//                                                     <th className="px-4 py-3 text-left w-[10%]">Deadline</th>
//                                                     <th className="px-4 py-3 text-left w-[10%]">Status</th>
//                                                     <th className="px-4 py-3 text-left w-[15%]">Sub-Status</th>
//                                                     <th className="px-4 py-3 text-center w-[10%]">Comments</th>
//                                                     <th className="px-4 py-3 text-center w-[10%]">Link</th>
//                                                     <th className="px-4 py-3 text-center w-[15%]">Actions</th>
//                                                 </tr>
//                                             </thead>
//                                             <tbody className="bg-white divide-y divide-gray-100">
//                                                 {tasks.map((task) => (
//                                                     <tr key={task.name}>
//                                                         <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{task.task_name}</td>
//                                                         <td className="px-4 py-3 text-sm text-gray-500">{getAssignedNameForDisplay(task)}</td>
//                                                         <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{formatDate(task.deadline)?.replace(/20(\d{2})$/, '$1') || '...'}</td>
                                                        
//                                                         {/* Status Badge */}
//                                                         <td className="px-4 py-3 text-sm">
//                                                             <Badge 
//                                                                 variant="outline" 
//                                                                 className={`h-7 w-full justify-center capitalize ${getTaskStatusStyle(task.task_status || '...')} rounded-full`}
//                                                             >
//                                                                 {task.task_status || '...'}
//                                                             </Badge>
//                                                         </td>

//                                                         {/* Sub-Status Badge */}
//                                                         <td className="px-4 py-3 text-sm">
//                                                             <Badge 
//                                                                 variant="outline" 
//                                                                 className={`h-7 w-full justify-center text-center ${getSubStatusStyle(task.task_sub_status || '...')} rounded-full`}
//                                                             >
//                                                                 {task.task_sub_status || '...'}
//                                                             </Badge>
//                                                         </td>
                                                        
//                                                         {/* Comments */}
//                                                         <td className="px-4 py-3 text-center">
//                                                             {task.comments ? <MessageCircle className="h-4 w-4 text-gray-600 mx-auto cursor-pointer" title={task.comments} /> : <MessageCircle className="h-4 w-4 text-gray-300 mx-auto" />}
//                                                         </td>
                                                        
//                                                         {/* Link */}
//                                                         <td className="px-4 py-3 text-center">
//                                                             {task.file_link ? <a href={task.file_link} target='_blank' rel='noopener noreferrer'><LinkIcon className='w-4 h-4 text-blue-500 mx-auto' /></a> : <LinkIcon className='w-4 h-4 text-gray-300 mx-auto' />}
//                                                         </td>
                                                        
//                                                         {/* Actions */}
//                                                         <td className="px-4 py-3 text-center">
//                                                             <Button variant="outline" size="sm" onClick={() => setEditingTask(task)} className="h-8">
//                                                                 <Edit className="h-3 w-3 mr-1" /> Edit
//                                                             </Button>
//                                                         </td>
//                                                     </tr>
//                                                 ))}
//                                             </tbody>
//                                         </table>
//                                     </div>
//                                 </CardContent>
//                             )}
//                         </Card>
//                     );
//                 })}
//             </div>

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

// export default ProjectDesignTrackerDetail;


// frontend/src/pages/DesignTracker/project-design-tracker-details.tsx

import React, { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ProjectDesignTracker, DesignTrackerTask, User, AssignedDesignerDetail } from './types';
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from "@/components/ui/badge"; 
import { Edit, Save, Link as LinkIcon, MessageCircle, ChevronUp, ChevronDown, Download } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import ReactSelect from 'react-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useDesignTrackerLogic } from './hooks/useDesignTrackerLogic';
import { DESIGN_CATEGORIES } from "./hooks/useDesignMasters"; // <-- ADDED IMPORT

const DOCTYPE = 'Project Design Tracker';
const FE_TASK_STATUS_OPTIONS = ["Todo", "In Progress", "Done", "Blocked", "On Hold", "Submitted"]; 

// --- DATE & STYLE HELPERS ---
const getOrdinalNum = (n: number) => {
    return n + (n > 0 ? ['th', 'st', 'nd', 'rd'][(n > 3 && n < 21) || n % 10 > 3 ? 0 : n % 10] : '');
};

const formatDate = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        const day = date.getDate();
        const month = date.toLocaleString('en-US', { month: 'short' });
        const year = date.getFullYear();
        return `${getOrdinalNum(day)} ${month}, ${year}`;
    } catch (e) {
        return dateString; // Fallback to raw string if date parsing fails
    }
};

const getTaskStatusStyle = (status: string) => {
    const lowerStatus = status.toLowerCase();
    
    if (lowerStatus.includes('in progress')) {
        return 'bg-blue-100 text-blue-700 border border-blue-500';
    }
    if (lowerStatus.includes('on hold')) {
        return 'bg-yellow-100 text-yellow-700 border border-yellow-500';
    }
    if (lowerStatus.includes('submitted')) {
        return 'bg-green-100 text-green-700 border border-green-500';
    }
    if (lowerStatus.includes('done') || lowerStatus.includes('completed')) {
        return 'bg-green-100 text-green-700 border border-green-500';
    }
    if (lowerStatus.includes('blocked')) {
        return 'bg-red-100 text-red-700 border border-red-500';
    }
    return 'bg-gray-100 text-gray-700 border border-gray-300';
};

const getSubStatusStyle = (subStatus?: string) => {
    if (!subStatus || subStatus === '...') return 'bg-gray-100 text-gray-700 border border-gray-300';
    
    const lowerSubStatus = subStatus.toLowerCase();
    if (lowerSubStatus.includes('clarification') || lowerSubStatus.includes('rework') || lowerSubStatus.includes('sub-status 1')) {
        return 'bg-red-100 text-red-700 border border-red-500';
    }
    return 'bg-gray-100 text-gray-700 border border-gray-300';
};


// --- Task Edit Modal Components (Master Definition) ---
interface DesignerOption {
    value: string; // userId
    label: string; // fullName
    email: string;
}

interface TaskEditModalProps {
    task: DesignTrackerTask;
    onSave: (updatedTask: { [key: string]: any }) => Promise<void>; 
    usersList: User[];
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
}

// NOTE: This modal definition is exported (conceptually) for reuse in design-tracker-list.tsx
export const TaskEditModal: React.FC<TaskEditModalProps> = ({ task, onSave, usersList, isOpen, onOpenChange }) => {
    const [selectedDesigners, setSelectedDesigners] = useState<DesignerOption[]>([]);
    const [editState, setEditState] = useState<Partial<DesignTrackerTask>>({});
    const [isSaving, setIsSaving] = useState(false);

    const designerOptions: DesignerOption[] = useMemo(() => 
        usersList.map(u => ({ label: u.full_name || u.name, value: u.name, email: u.email || '' }))
    , [usersList]);

    // FIX: Updated getInitialDesigners to handle both stringified JSON (from get_doc)
    // and already parsed object/array (from TaskWiseTable/get_list).
    const getInitialDesigners = useCallback((designerField: AssignedDesignerDetail[] | string | any): DesignerOption[] => {
        let designerDetails: AssignedDesignerDetail[] = [];
        
        // 1. Handle already parsed object structure (common when fetching via child table server-side)
        if (designerField && typeof designerField === 'object' && Array.isArray(designerField.list)) {
            designerDetails = designerField.list;
        } 
        // 2. Handle standard array structure
        else if (Array.isArray(designerField)) {
            designerDetails = designerField;
        } 
        // 3. Handle stringified JSON structure (common when fetching via parent doc)
        else if (typeof designerField === 'string' && designerField.trim() !== '') {
            try { 
                const parsed = JSON.parse(designerField); 
                
                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list)) {
                    designerDetails = parsed.list;
                } 
                else if (Array.isArray(parsed)) {
                    designerDetails = parsed; 
                }
                
            } catch (e) { /* silent fail on parsing */ }
        }
        
        if (!Array.isArray(designerDetails)) designerDetails = [];

        return designerDetails.map(stored => 
            designerOptions.find(opt => opt.value === stored.userId) || 
            { label: stored.userName, value: stored.userId, email: stored.userEmail || '' } 
        ).filter((d): d is DesignerOption => !!d);

    }, [designerOptions]);

    React.useEffect(() => {
        if (isOpen) {
            const initialDesigners = getInitialDesigners(task.assigned_designers);
            setSelectedDesigners(initialDesigners);
            
            setEditState({
                deadline: task.deadline,
                task_status: task.task_status,       
                task_sub_status: task.task_sub_status,
                file_link: task.file_link,
                comments: task.comments,
            });
        }
    }, [isOpen, task, getInitialDesigners]);

    const handleSave = async () => {
        setIsSaving(true);
        
        const assignedDesignerDetails: AssignedDesignerDetail[] = selectedDesigners.map(d => ({
            userId: d.value,
            userName: d.label,
            userEmail: d.email,
        }));
        
        const payloadForServer: { [key: string]: any } = { 
            ...editState,
            assigned_designers: assignedDesignerDetails, 
        };
        
        try {
            await onSave(payloadForServer);
            onOpenChange(false);
        } catch (error) {
            toast({ title: "Save Failed", description: "Could not save task details.", variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{task.task_name} ({task.design_category})</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {/* Assigned Designer (Multi-Select) */}
                    <div className="space-y-1">
                        <Label htmlFor="designer">Assign Designer(s)</Label>
                        <ReactSelect
                            isMulti
                            value={selectedDesigners}
                            options={designerOptions}
                            onChange={(newValue) => setSelectedDesigners(newValue as DesignerOption[])}
                            placeholder="Select designers..."
                            classNamePrefix="react-select"
                        />
                    </div>

                    {/* Status */}
                     <div className="space-y-1">
                        <Label htmlFor="status">Status</Label>
                        <Select 
                           value={editState.task_status || ''} 
                           onValueChange={(val) => setEditState(prev => ({ ...prev, task_status: val as any }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select Status" />
                            </SelectTrigger>
                            <SelectContent>
                                {FE_TASK_STATUS_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    
                    {/* Sub Status */}
                    <div className="space-y-1">
                        <Label htmlFor="sub_status">Sub Status</Label>
                        <Input id="sub_status" value={editState.task_sub_status || ''} onChange={(e) => setEditState(prev => ({ ...prev, task_sub_status: e.target.value }))} placeholder="e.g., Submitted / Verification" />
                    </div>

                    {/* Deadline */}
                    <div className="space-y-1">
                        <Label htmlFor="deadline">Deadline</Label>
                        <Input id="deadline" type="date" value={editState.deadline || ''} onChange={(e) => setEditState(prev => ({ ...prev, deadline: e.target.value }))} />
                    </div>

                    {/* File Link */}
                    <div className="space-y-1">
                        <Label htmlFor="file_link">Design File Link</Label>
                        <Input id="file_link" type="url" value={editState.file_link || ''} onChange={(e) => setEditState(prev => ({ ...prev, file_link: e.target.value }))} placeholder="https://figma.com/..." />
                    </div>

                    {/* Remarks (Comments) */}
                    <div className="space-y-1">
                        <Label htmlFor="comments">Remarks</Label>
                        <textarea id="comments" rows={3} value={editState.comments || ''} onChange={(e) => setEditState(prev => ({ ...prev, comments: e.target.value }))} className="w-full p-2 border rounded" />
                    </div>

                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleSave} disabled={isSaving}>
                        <Save className="h-4 w-4 mr-2" /> Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


// --- New Task Modal Component ---
interface NewTaskModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (newTask: Partial<DesignTrackerTask>) => Promise<void>;
    usersList: User[];
    categories: typeof DESIGN_CATEGORIES;
}

const NewTaskModal: React.FC<NewTaskModalProps> = ({ isOpen, onOpenChange, onSave, usersList, categories }) => {
    const [taskState, setTaskState] = useState<Partial<DesignTrackerTask>>({
        task_name: '',
        design_category: categories[0]?.category_name || '',
        deadline: '',
        task_status: 'Todo',
        file_link: '',
        comments: ''
    });
    const [selectedDesigners, setSelectedDesigners] = useState<DesignerOption[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const designerOptions: DesignerOption[] = useMemo(() => 
        usersList.map(u => ({ label: u.full_name || u.name, value: u.name, email: u.email || '' }))
    , [usersList]);

    React.useEffect(() => {
        if (!isOpen) {
            // Reset state upon close
            setTaskState({
                task_name: '',
                design_category: categories[0]?.category_name || '',
                deadline: '',
                task_status: 'Todo',
            });
            setSelectedDesigners([]);
        }
    }, [isOpen, categories]);


    const handleSave = async () => {
        if (!taskState.task_name || !taskState.design_category) {
            toast({ title: "Error", description: "Task Name and Category are required.", variant: "destructive" });
            return;
        }

        setIsSaving(true);
        
        const assignedDesignerDetails: AssignedDesignerDetail[] = selectedDesigners.map(d => ({
            userId: d.value,
            userName: d.label,
            userEmail: d.email,
        }));

        // Serialize designers list into the required JSON string format
        const structuredDataForServer = { list: assignedDesignerDetails };
        const assigned_designers_string = JSON.stringify(structuredDataForServer); 

        const newTaskPayload: Partial<DesignTrackerTask> = {
            ...taskState,
            assigned_designers: assigned_designers_string,
        };
        
        try {
            await onSave(newTaskPayload);
            onOpenChange(false);
            toast({ title: "Success", description: `Task '${taskState.task_name}' created successfully.`, variant: "success" });
        } catch (error) {
            toast({ title: "Creation Failed", description: "Failed to create task.", variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Create Custom Task</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {/* Task Name */}
                    <div className="space-y-1">
                        <Label htmlFor="task_name">Task Name *</Label>
                        <Input id="task_name" value={taskState.task_name} onChange={(e) => setTaskState(prev => ({ ...prev, task_name: e.target.value }))} required />
                    </div>

                    {/* Category */}
                    <div className="space-y-1">
                        <Label htmlFor="category">Design Category *</Label>
                        <Select 
                           value={taskState.design_category || ''} 
                           onValueChange={(val) => setTaskState(prev => ({ ...prev, design_category: val }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select Category" />
                            </SelectTrigger>
                            <SelectContent>
                                {categories.map(cat => (
                                    <SelectItem key={cat.category_name} value={cat.category_name}>
                                        {cat.category_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Assigned Designer (Multi-Select) */}
                    <div className="space-y-1">
                        <Label htmlFor="designer">Assign Designer(s)</Label>
                        <ReactSelect
                            isMulti
                            value={selectedDesigners}
                            options={designerOptions}
                            onChange={(newValue) => setSelectedDesigners(newValue as DesignerOption[])}
                            placeholder="Select designers..."
                            classNamePrefix="react-select"
                        />
                    </div>

                    {/* Deadline */}
                    <div className="space-y-1">
                        <Label htmlFor="deadline">Deadline</Label>
                        <Input id="deadline" type="date" value={taskState.deadline || ''} onChange={(e) => setTaskState(prev => ({ ...prev, deadline: e.target.value }))} />
                    </div>
                    
                    {/* Status (Default to Todo) */}
                     <div className="space-y-1">
                        <Label htmlFor="status">Status</Label>
                        <Select 
                           value={taskState.task_status || 'Todo'} 
                           onValueChange={(val) => setTaskState(prev => ({ ...prev, task_status: val as any }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select Status" />
                            </SelectTrigger>
                            <SelectContent>
                                {FE_TASK_STATUS_OPTIONS.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* File Link */}
                    <div className="space-y-1">
                        <Label htmlFor="file_link">Design File Link</Label>
                        <Input id="file_link" type="url" value={taskState.file_link || ''} onChange={(e) => setTaskState(prev => ({ ...prev, file_link: e.target.value }))} placeholder="https://figma.com/..." />
                    </div>

                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleSave} disabled={isSaving || !taskState.task_name || !taskState.design_category}>
                        <Save className="h-4 w-4 mr-2" /> Create Task
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}


// --- Main Detail Component ---
export const ProjectDesignTrackerDetail: React.FC = () => {
    const { id: trackerId } = useParams<{ id: string }>();
    
    const {
        trackerDoc, groupedTasks, isLoading, error, getDesignerName, handleTaskSave, editingTask, setEditingTask, usersList,handleParentDocSave,
        handleNewTaskCreation // <-- Destructure new action
    } = useDesignTrackerLogic({ trackerId: trackerId! });

    const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
     // Initialize overallDeadline state from doc
    const [overallDeadline, setOverallDeadline] = useState(trackerDoc?.overall_deadline || '');
    const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false); // <-- New State
    
    React.useEffect(() => {
        if (trackerDoc?.overall_deadline) {
            // Update state when doc data loads/changes
            setOverallDeadline(trackerDoc.overall_deadline);
        }
    }, [trackerDoc?.overall_deadline]);


    const toggleCategory = useCallback((categoryName: string) => {
        setExpandedCategories(prev => ({
            ...prev,
            [categoryName]: !prev[categoryName],
        }));
    }, []);

    if (isLoading) return <LoadingFallback />;
    if (error || !trackerDoc) return <AlertDestructive error={error} />;

       // --- PARENT DOC UPDATE HANDLER ---
    const handleDeadlineUpdate = async (newDate: string) => {
        if (newDate === trackerDoc.overall_deadline) return;

        try {
            await handleParentDocSave({ overall_deadline: newDate });
            toast({ title: "Success", description: "Overall deadline updated." });
        } catch (e) {
            toast({ title: "Error", description: "Failed to save deadline.", variant: "destructive" });
        }
    };
    
    // --- INLINE SAVE HANDLER (TASK SERIALIZATION) ---
    const inlineTaskSaveHandler = async (updatedFields: { [key: string]: any }) => {
        if (!editingTask) return;
        
        let fieldsToSend: { [key: string]: any } = { ...updatedFields };

        // 1. SERIALIZE assigned_designers array into the specific JSON format: {"list": [...] }
        if (Array.isArray(updatedFields.assigned_designers)) { 
            const structuredDataForServer = {
                list: updatedFields.assigned_designers 
            };
            fieldsToSend.assigned_designers = JSON.stringify(structuredDataForServer); 
        }
        
        await handleTaskSave(editingTask.name, fieldsToSend);
    };
    
    // Helper function to render designer name from the complex field (for table display)
    const getAssignedNameForDisplay = (task: DesignTrackerTask): React.ReactNode => {
        const designerField = task.assigned_designers;
        let designers: AssignedDesignerDetail[] = [];
        
        if (designerField) {
            // Check if already an object (from useDesignTrackerLogic state)
            if (designerField && typeof designerField === 'object' && Array.isArray(designerField.list)) {
                designers = designerField.list;
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
                 } catch (e) { /* silent fail */ }
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
            );
        }
        return getDesignerName(undefined);
    };


    return (
        <div className="flex-1 space-y-6 p-6">
            
            {/* --- TOP HEADER --- */}
            <div className="flex justify-between items-start">
                <header>
                    <h1 className="text-3xl font-bold text-red-700">{trackerDoc.project_name}</h1>
                    <p className="text-sm text-gray-500">ID: {trackerDoc.project}</p>
                </header>
                <Button variant="destructive" className="flex items-center gap-2">
                    <Download className="h-4 w-4" /> Export
                </Button>
            </div>

            {/* --- PROJECT OVERVIEW CARD --- */}
            <Card className="shadow-lg p-6 bg-white">
                <CardTitle className="text-xl font-semibold mb-4">Project Overview</CardTitle>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-6 text-sm text-gray-700">
                    
                    {/* Project ID */}
                    <div className="space-y-1">
                        <Label className="uppercase text-xs font-medium text-gray-500">Project ID</Label>
                        <p className="font-semibold">{trackerDoc.project}</p>
                    </div>

                    {/* Project Name */}
                    <div className="space-y-1">
                        <Label className="uppercase text-xs font-medium text-gray-500">Project Name</Label>
                        <p className="font-semibold">{trackerDoc.project_name}</p>
                    </div>

                    {/* Created On */}
                    <div className="space-y-1">
                        <Label className="uppercase text-xs font-medium text-gray-500">Created On</Label>
                        <p className="font-semibold">{formatDate(trackerDoc.creation)}</p>
                    </div>

                    {/* Project Status */}
                    <div className="space-y-1">
                        <Label className="uppercase text-xs font-medium text-gray-500">Project Status</Label>
                        <p><Badge variant="outline" className={`h-8 px-4 justify-center ${getTaskStatusStyle(trackerDoc.status)}`}>
                            {trackerDoc.status}
                        </Badge></p>
                        
                    </div>
                    
                    {/* Overall Deadline (Editable Input) */}
                    <div className="space-y-1">
                        <Label className="uppercase text-xs font-medium text-gray-500">Overall Deadline</Label>
                        <div className="relative">
                            <Input
                                type="date"
                                value={overallDeadline}
                                onChange={(e) => setOverallDeadline(e.target.value)}
                                onBlur={(e) => handleDeadlineUpdate(e.target.value)}
                                className="pr-2" 
                            />
                        </div>
                    </div>
                </div>
            </Card>

            {/* --- ON-BOARDING SECTION --- */}
            <div className="flex justify-between items-center pt-4 border-t">
                <h2 className="text-2xl font-bold text-gray-800">On-Boarding</h2> 
                <Button 
                    variant="outline" 
                    className="text-red-700 border-red-700 hover:bg-red-50/50"
                    onClick={() => setIsNewTaskModalOpen(true)} // <-- Open New Task Modal
                >
                    Create Custom Task
                </Button>
            </div>
            
            {/* --- TASK LIST (ACCORDION STYLE) --- */}
            <div className="space-y-4">
                {Object.entries(groupedTasks).map(([categoryName, tasks]) => {
                    const isExpanded = expandedCategories[categoryName] ?? true; 

                    return (
                        <Card key={categoryName} className="shadow-lg border-red-200 border-l-4">
                            
                            {/* Category Header */}
                            <CardHeader 
                                className="bg-gray-50 flex flex-row justify-between items-center py-3 cursor-pointer"
                                onClick={() => toggleCategory(categoryName)}
                            >
                                <CardTitle className="text-lg font-semibold text-gray-800">
                                    {categoryName} ({tasks.length} Tasks)
                                </CardTitle>
                                {isExpanded ? <ChevronUp className="h-5 w-5 text-gray-600" /> : <ChevronDown className="h-5 w-5 text-gray-600" />}
                            </CardHeader>

                            {/* Task Table Content */}
                            {isExpanded && (
                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-gray-200">
                                            <thead className="bg-gray-100">
                                                <tr className='text-xs text-gray-500 uppercase font-medium'>
                                                    <th className="px-4 py-3 text-left w-[15%]">Task Name</th>
                                                    <th className="px-4 py-3 text-left w-[15%]">Assigned Designer</th>
                                                    <th className="px-4 py-3 text-left w-[10%]">Deadline</th>
                                                    <th className="px-4 py-3 text-left w-[10%]">Status</th>
                                                    <th className="px-4 py-3 text-left w-[15%]">Sub-Status</th>
                                                    <th className="px-4 py-3 text-center w-[10%]">Comments</th>
                                                    <th className="px-4 py-3 text-center w-[10%]">Link</th>
                                                    <th className="px-4 py-3 text-center w-[15%]">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="bg-white divide-y divide-gray-100">
                                                {tasks.map((task) => (
                                                    <tr key={task.name}>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{task.task_name}</td>
                                                        <td className="px-4 py-3 text-sm text-gray-500">{getAssignedNameForDisplay(task)}</td>
                                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{formatDate(task.deadline)?.replace(/20(\d{2})$/, '$1') || '...'}</td>
                                                        
                                                        {/* Status Badge */}
                                                        <td className="px-4 py-3 text-sm">
                                                            <Badge 
                                                                variant="outline" 
                                                                className={`h-7 w-full justify-center capitalize ${getTaskStatusStyle(task.task_status || '...')} rounded-full`}
                                                            >
                                                                {task.task_status || '...'}
                                                            </Badge>
                                                        </td>

                                                        {/* Sub-Status Badge */}
                                                        <td className="px-4 py-3 text-sm">
                                                            <Badge 
                                                                variant="outline" 
                                                                className={`h-7 w-full justify-center text-center ${getSubStatusStyle(task.task_sub_status || '...')} rounded-full`}
                                                            >
                                                                {task.task_sub_status || '...'}
                                                            </Badge>
                                                        </td>
                                                        
                                                        {/* Comments */}
                                                        <td className="px-4 py-3 text-center">
                                                            {task.comments ? <MessageCircle className="h-4 w-4 text-gray-600 mx-auto cursor-pointer" title={task.comments} /> : <MessageCircle className="h-4 w-4 text-gray-300 mx-auto" />}
                                                        </td>
                                                        
                                                        {/* Link */}
                                                        <td className="px-4 py-3 text-center">
                                                            {task.file_link ? <a href={task.file_link} target='_blank' rel='noopener noreferrer'><LinkIcon className='w-4 h-4 text-blue-500 mx-auto' /></a> : <LinkIcon className='w-4 h-4 text-gray-300 mx-auto' />}
                                                        </td>
                                                        
                                                        {/* Actions */}
                                                        <td className="px-4 py-3 text-center">
                                                            <Button variant="outline" size="sm" onClick={() => setEditingTask(task)} className="h-8">
                                                                <Edit className="h-3 w-3 mr-1" /> Edit
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </CardContent>
                            )}
                        </Card>
                    );
                })}
            </div>

            {editingTask && (
                <TaskEditModal
                    isOpen={!!editingTask}
                    onOpenChange={(open) => { if (!open) setEditingTask(null); }}
                    task={editingTask}
                    onSave={inlineTaskSaveHandler}
                    usersList={usersList || []}
                />
            )}
            
            <NewTaskModal
                isOpen={isNewTaskModalOpen}
                onOpenChange={setIsNewTaskModalOpen}
                onSave={handleNewTaskCreation} 
                usersList={usersList || []}
                categories={DESIGN_CATEGORIES}
            />
        </div>
    );
};

export default ProjectDesignTrackerDetail;