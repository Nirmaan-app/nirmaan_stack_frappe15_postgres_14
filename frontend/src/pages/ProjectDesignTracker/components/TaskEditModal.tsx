// // frontend/src/pages/ProjectDesignTracker/components/TaskEditModal.tsx

// import React, { useCallback, useMemo, useState } from 'react';
// import { DesignTrackerTask, User, AssignedDesignerDetail } from '../types';
// import { toast } from '@/components/ui/use-toast';
// import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
// import { Button } from '@/components/ui/button';
// import { Input } from '@/components/ui/input';
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
// import { Label } from '@/components/ui/label';
// import ReactSelect from 'react-select';
// import { Save } from 'lucide-react';
// // Import the necessary static map for filtering sub-statuses
// import { SUB_STATUS_MAP } from '../hooks/useDesignMasters';

// // --- TYPE DEFINITIONS ---

// interface DesignerOption {
//     value: string; // userId
//     label: string; // fullName
//     email: string;
// }

// interface StatusOption {
//     label: string;
//     value: string;
// }

// interface TaskEditModalProps {
//     task: DesignTrackerTask;
//     onSave: (updatedTask: { [key: string]: any }) => Promise<void>; 
//     usersList: User[];
//     isOpen: boolean;
//     onOpenChange: (open: boolean) => void;
//     statusOptions: StatusOption[];       // Full list of status options (e.g., from useDesignMasters)
//     subStatusOptions: StatusOption[];    // Full list of sub-status options (e.g., from useDesignMasters)
// }

// // NOTE: This modal definition is exported (conceptually) for reuse in design-tracker-list.tsx
// export const TaskEditModal: React.FC<TaskEditModalProps> = ({ task, onSave, usersList, isOpen, onOpenChange, statusOptions, subStatusOptions }) => {
    
//     const [selectedDesigners, setSelectedDesigners] = useState<DesignerOption[]>([]);
//     const [editState, setEditState] = useState<Partial<DesignTrackerTask>>({});
//     const [isSaving, setIsSaving] = useState(false);

//     const designerOptions: DesignerOption[] = useMemo(() => 
//         usersList.map(u => ({ label: u.full_name || u.name, value: u.name, email: u.email || '' }))
//     , [usersList]);

//      // --- Dynamic Sub-Status Filtering ---
//      const allowedSubStatuses = useMemo(() => {
//         const currentStatus = editState.task_status;
//         const allowedValues = SUB_STATUS_MAP[currentStatus as keyof typeof SUB_STATUS_MAP];
        
//         if (!allowedValues || allowedValues.length === 0) {
//             // If the status is not mapped (e.g., Todo, In Progress), return only the empty option
//             return subStatusOptions.filter(opt => opt.value === ""); 
//         }

//         // Filter the full subStatusOptions list based on allowedValues, ensuring empty option is included
//         return subStatusOptions.filter(opt => 
//         opt.value === "" || allowedValues.includes(opt.value)
//     );
//     }, [editState.task_status, subStatusOptions]);
//     // ------------------------------------
    
//     // Cleanup sub-status when main status changes to an invalid state
//      React.useEffect(() => {
//         const isStatusMapped = !!SUB_STATUS_MAP[editState.task_status as keyof typeof SUB_STATUS_MAP];
        
//         // If the status changes to one that shouldn't have sub-status AND a sub-status is currently set, clear it.
//         if (!isStatusMapped && editState.task_sub_status) {
//              setEditState(prev => ({ ...prev, task_sub_status: "" }));
//         }
//     }, [editState.task_status]); 


//     const getInitialDesigners = useCallback((designerField: AssignedDesignerDetail[] | string | any): DesignerOption[] => {
//         let designerDetails: AssignedDesignerDetail[] = [];
        
//         if (designerField && typeof designerField === 'object' && Array.isArray(designerField.list)) {
//             designerDetails = designerField.list;
//         } 
//         else if (Array.isArray(designerField)) {
//             designerDetails = designerField;
//         } 
//         else if (typeof designerField === 'string' && designerField.trim() !== '') {
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
//             { label: stored.userName, value: stored.userId, email: stored.userEmail || '' } 
//         ).filter((d): d is DesignerOption => !!d);

//     }, [designerOptions]);

//     React.useEffect(() => {
//         if (isOpen) {
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

//         // Use the cleaned state which might have cleared task_sub_status if status changed.
//         let finalEditState = { ...editState };
//         if (editState.task_status && !SUB_STATUS_MAP[editState.task_status as keyof typeof SUB_STATUS_MAP]) {
//              finalEditState.task_sub_status = "";
//         }
        
//         const payloadForServer: { [key: string]: any } = { 
//             ...finalEditState,
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
//                      {/* <div className="space-y-1">
//                         <Label htmlFor="status">Status</Label>
//                         <Select 
//                            value={editState.task_status || ''} 
//                            onValueChange={(val) => setEditState(prev => ({ ...prev, task_status: val as any }))}
//                         >
//                             <SelectTrigger>
//                                 <SelectValue placeholder="Select Status" />
//                             </SelectTrigger>
//                             <SelectContent>
//                                 {statusOptions?.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
//                             </SelectContent>
//                         </Select>
//                     </div> */}

//                     <div className="space-y-1">
//                                             <Label htmlFor="status">Status</Label>
//                                             <ReactSelect
//                                                 options={statusOptions}
//                                                 value={statusOptions.find((c: any) => c.value === editState.task_status) || null}
//                                                 onChange={(option: any) => setEditState(prev => ({ ...prev, task_status: option ? option.value : '' }))}
//                                                 classNamePrefix="react-select"
                                               
//                                             />
//                                         </div>
                    
                    
//                     {/* Sub Status (CONDITIONAL VISIBILITY) */}
//                      {/* {(allowedSubStatuses.length > 1) && ( // Show only if more than the default empty option is available
//                        <div className="space-y-1">
//                             <Label htmlFor="sub_status">Sub Status</Label>
//                             <Select 
//                                value={editState.task_sub_status || ''} 
//                                onValueChange={(val) => setEditState(prev => ({ ...prev, task_sub_status: val as any }))}
//                             >
//                                 <SelectTrigger>
//                                     <SelectValue placeholder="Select Sub Status" />
//                                 </SelectTrigger>
//                                 <SelectContent>
//                                     {allowedSubStatuses.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
//                                 </SelectContent>
//                             </Select>
//                         </div>
//                     )} */}

//                     {(allowedSubStatuses.length > 1) && (
//                       <div className="space-y-1">
//                                             <Label htmlFor="sub_status">Sub Status</Label>
//                                             <ReactSelect
//                                                 options={allowedSubStatuses}
//                                                 value={allowedSubStatuses.find((c: any) => c.value === editState.task_sub_status) || null}
//                                                 onChange={(option: any) => setEditState(prev => ({ ...prev, task_sub_status: option ? option.value : '' }))}
//                                                 classNamePrefix="react-select"
                                               
//                                             />
//                                         </div>
//                     )}
                       
                    

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
//                         <Label htmlFor="comments">Comments</Label>
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


// frontend/src/pages/ProjectDesignTracker/components/TaskEditModal.tsx
// frontend/src/pages/ProjectDesignTracker/components/TaskEditModal.tsx
// frontend/src/pages/ProjectDesignTracker/components/TaskEditModal.tsx

import React, { useCallback, useMemo, useState } from 'react';
import { DesignTrackerTask, User, AssignedDesignerDetail } from '../types';
import { parseDesignersFromField } from '../utils';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ReactSelect from 'react-select';
import { Save } from 'lucide-react';
import { SUB_STATUS_MAP } from '../hooks/useDesignMasters';

interface DesignerOption {
    value: string;
    label: string;
    email: string;
}

interface StatusOption {
    label: string;
    value: string;
}

interface TaskEditModalProps {
    task: DesignTrackerTask;
    onSave: (updatedTask: { [key: string]: any }) => Promise<void>; 
    usersList: User[];
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    statusOptions: StatusOption[];
    subStatusOptions: StatusOption[];
    existingTaskNames: string[];
    disableTaskNameEdit?: boolean;
    isRestrictedMode?: boolean; // New prop for RBAC
}

export const TaskEditModal: React.FC<TaskEditModalProps> = ({ 
    task, 
    onSave, 
    usersList, 
    isOpen, 
    onOpenChange, 
    statusOptions, 
    subStatusOptions,
    existingTaskNames,
    disableTaskNameEdit = false,
    isRestrictedMode = false // Default to false
}) => {
    
    const [selectedDesigners, setSelectedDesigners] = useState<DesignerOption[]>([]);
    const [editState, setEditState] = useState<Partial<DesignTrackerTask>>({});
    const [isSaving, setIsSaving] = useState(false);

    const designerOptions: DesignerOption[] = useMemo(() => 
        usersList.map(u => ({ label: u.full_name || u.name, value: u.name, email: u.email || '' }))
    , [usersList]);

    // Check if current status requires custom text input for substatus
    const requiresCustomSubStatus = useMemo(() => {
        const currentStatus = editState.task_status;
        const allowedValues = SUB_STATUS_MAP[currentStatus as keyof typeof SUB_STATUS_MAP];
        return allowedValues === "__CUSTOM_TEXT__";
    }, [editState.task_status]);

     const allowedSubStatuses = useMemo(() => {
        const currentStatus = editState.task_status;
        const allowedValues = SUB_STATUS_MAP[currentStatus as keyof typeof SUB_STATUS_MAP];

        // If custom text is required, return empty array (we'll show text input instead)
        if (allowedValues === "__CUSTOM_TEXT__") {
            return [];
        }

        if (!allowedValues || allowedValues.length === 0) {
            return subStatusOptions.filter(opt => opt.value === "");
        }
        return subStatusOptions.filter(opt =>
            opt.value === "" || allowedValues.includes(opt.value)
        );
    }, [editState.task_status, subStatusOptions]);
    
    React.useEffect(() => {
        const isStatusMapped = !!SUB_STATUS_MAP[editState.task_status as keyof typeof SUB_STATUS_MAP];
        
        // If status is Not Applicable, clear the deadline
        if (editState.task_status === "Not Applicable") {
            setEditState(prev => ({ ...prev, deadline: undefined }));
        }

        // Only clear sub_status if status changes to one that doesn't support sub-status at all
        // Preserve sub_status for custom text input statuses
        if (!isStatusMapped && editState.task_sub_status) {
             setEditState(prev => ({ ...prev, task_sub_status: "" }));
        }
    }, [editState.task_status]); 


    const getInitialDesigners = useCallback((designerField: AssignedDesignerDetail[] | string | any): DesignerOption[] => {
        const designerDetails = parseDesignersFromField(designerField);

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
                task_name: task.task_name,
                deadline: task.deadline,
                task_status: task.task_status,       
                task_sub_status: task.task_sub_status,
                file_link: task.file_link,
                comments: task.comments,
            });
        }
    }, [isOpen, task, getInitialDesigners]);


    const handleSave = async () => {
        const newTaskName = editState.task_name?.trim();

        if (!newTaskName) {
            toast({ title: "Validation Error", description: "Task Name is required.", variant: "destructive" });
            return;
        }

        // Only check duplicates if name editing is allowed
        if (!disableTaskNameEdit && !isRestrictedMode) {
            const normalizedNewName = newTaskName.toLowerCase();
            const normalizedCurrentName = task.task_name.toLowerCase();

            const isDuplicate = existingTaskNames.some(existingName => {
                const normalizedExisting = existingName.toLowerCase();
                const namesMatch = normalizedExisting === normalizedNewName;
                const isNotSelf = normalizedExisting !== normalizedCurrentName;
                return namesMatch && isNotSelf;
            });

            if (isDuplicate) {
                toast({ 
                    title: "Duplicate Task Name", 
                    description: `The task name "${newTaskName}" is already used by another task in this project.`, 
                    variant: "destructive" 
                });
                return;
            }
        }

        setIsSaving(true);
        
        const assignedDesignerDetails: AssignedDesignerDetail[] = selectedDesigners.map(d => ({
            userId: d.value,
            userName: d.label,
            userEmail: d.email,
        }));

        let finalEditState = { ...editState };
        // Only clear sub_status if the status doesn't support sub-status at all
        // Preserve custom text sub-status for statuses that use "__CUSTOM_TEXT__"
        const statusSubStatusConfig = SUB_STATUS_MAP[editState.task_status as keyof typeof SUB_STATUS_MAP];
        if (editState.task_status && !statusSubStatusConfig) {
             finalEditState.task_sub_status = "";
        }
        
        const payloadForServer: { [key: string]: any } = { 
            ...finalEditState,
            task_name: newTaskName, 
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
            <DialogContent className="sm:max-w-xl overflow-visible">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="text-base font-semibold">Edit Task</DialogTitle>
                    {/* Task Context Header */}
                    <div className="flex flex-col gap-1.5 pt-1 pb-2 border-b border-gray-200">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            {task.task_zone && (
                                <div className="flex items-center gap-1">
                                    <span className="text-[10px] uppercase tracking-wider text-gray-400">Zone:</span>
                                    <span className="font-medium text-gray-700">{task.task_zone}</span>
                                </div>
                            )}
                            <div className="flex items-center gap-1">
                                <span className="text-[10px] uppercase tracking-wider text-gray-400">Category:</span>
                                <span className="font-medium text-gray-700">{task.design_category}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] uppercase tracking-wider text-gray-400">Task:</span>
                            <span className="text-sm font-medium text-gray-900 truncate">
                                {task.task_name}
                            </span>
                        </div>
                    </div>
                </DialogHeader>
                <div className="grid gap-3 py-3">
                    
                    {/* Task Name */}
                    <div className="space-y-1">
                        <Label htmlFor="task_name">Task Name</Label>
                        <Input 
                            id="task_name" 
                            value={editState.task_name || ''} 
                            onChange={(e) => setEditState(prev => ({ ...prev, task_name: e.target.value }))} 
                            disabled={disableTaskNameEdit || isRestrictedMode} 
                            className={(disableTaskNameEdit || isRestrictedMode) ? "bg-gray-100 text-gray-500 cursor-not-allowed" : ""}
                        />
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
                            isDisabled={isRestrictedMode} 
                        />
                    </div>

                    
                    {/* Status */}
                    <div className="space-y-1">
                        <Label htmlFor="status">Status</Label>
                        <ReactSelect
                            options={statusOptions}
                            value={statusOptions.find((c: any) => c.value === editState.task_status) || null}
                            onChange={(option: any) => setEditState(prev => ({ ...prev, task_status: option ? option.value : '' }))}
                            classNamePrefix="react-select"
                           
                        />
                    </div>

                    {/* Sub Status - Conditional Rendering */}
                    {requiresCustomSubStatus ? (
                        // Custom text input for statuses like "Revision Pending"
                        <div className="space-y-1">
                            <Label htmlFor="sub_status_custom">Sub Status (Custom)</Label>
                            <Input
                                id="sub_status_custom"
                                type="text"
                                value={editState.task_sub_status || ''}
                                onChange={(e) => setEditState(prev => ({ ...prev, task_sub_status: e.target.value }))}
                                placeholder="Enter custom sub-status..."
                                className="w-full"
                            />
                        </div>
                    ) : (
                        // Predefined dropdown for statuses with fixed options
                        (allowedSubStatuses.length > 1) && (
                            <div className="space-y-1">
                                <Label htmlFor="sub_status">Sub Status</Label>
                                <ReactSelect
                                    options={allowedSubStatuses}
                                    value={allowedSubStatuses.find((c: any) => c.value === editState.task_sub_status) || null}
                                    onChange={(option: any) => setEditState(prev => ({ ...prev, task_sub_status: option ? option.value : '' }))}
                                    classNamePrefix="react-select"
                                />
                            </div>
                        )
                    )}
                       
                    {/* Deadline */}
                    <div className="space-y-1">
                        <Label htmlFor="deadline">Deadline</Label>
                        <Input 
                            id="deadline" 
                            type="date" 
                            value={editState.deadline || ''} 
                            onChange={(e) => setEditState(prev => ({ ...prev, deadline: e.target.value }))} 
                            disabled={isRestrictedMode} 
                        />
                    </div>

                    {/* File Link */}
                    <div className="space-y-1">
                        <Label htmlFor="file_link">Design File Link</Label>
                        <Input 
                            id="file_link" 
                            type="url" 
                            value={editState.file_link || ''} 
                            onChange={(e) => setEditState(prev => ({ ...prev, file_link: e.target.value }))} 
                            placeholder="https://figma.com/..." 
                        />
                    </div>

                    {/* Remarks */}
                    <div className="space-y-1">
                        <Label htmlFor="comments">Comments</Label>
                        <textarea 
                            id="comments" 
                            rows={3} 
                            value={editState.comments || ''} 
                            onChange={(e) => setEditState(prev => ({ ...prev, comments: e.target.value }))} 
                            className="w-full p-2 border rounded" 
                        />
                    </div>

                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                    <DialogClose asChild>
                        <Button variant="outline" size="sm" disabled={isSaving}>Cancel</Button>
                    </DialogClose>
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving || !editState.task_name}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        <Save className="h-3 w-3 mr-1.5" /> Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};