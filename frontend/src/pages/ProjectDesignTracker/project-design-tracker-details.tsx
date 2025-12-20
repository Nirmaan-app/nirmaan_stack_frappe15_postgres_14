import React, { useCallback, useMemo, useState } from 'react';
import { format } from "date-fns";
import { useParams } from 'react-router-dom';
import { ProjectDesignTracker, DesignTrackerTask, User, AssignedDesignerDetail } from './types';
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Edit, Save, Link as LinkIcon, MessageCircle, ChevronUp, ChevronDown, Download, Plus } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import ReactSelect from 'react-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useDesignTrackerLogic } from './hooks/useDesignTrackerLogic';
import { TailSpin } from 'react-loader-spinner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SUB_STATUS_MAP } from './hooks/useDesignMasters';
import { getStatusBadgeStyle, getTaskStatusStyle, getTaskSubStatusStyle, formatDeadlineShort ,getAssignedNameForDisplay,getExistingTaskNames} from './utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TaskEditModal } from './components/TaskEditModal';
import { useUserData } from "@/hooks/useUserData";


const DOCTYPE = 'Project Design Tracker';

const PROJECT_STATUS_OPTIONS = [
    { value: 'Draft', label: 'Draft' },
    { value: 'Assign Pending', label: 'Assign Pending' },
    { value: 'In Progress', label: 'In Progress' },
    { value: 'Completed', label: 'Completed' },
    { value: 'On Hold', label: 'On Hold' },
    // { value: 'Archived', label: 'Archived' },
];
// --- TYPE DEFINITION for Category Items ---
interface CategoryItem {
    category_name: string;
    tasks: { task_name: string; deadline_offset?: number }[];
    // Add other fields if needed, but keeping it minimal for UI/Task generation
}

// --- Project Overview Edit Modal ---
interface ProjectOverviewEditModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    currentDoc: ProjectDesignTracker;
    onSave: (updatedFields: Partial<ProjectDesignTracker>) => Promise<void>;
}

const ProjectOverviewEditModal: React.FC<ProjectOverviewEditModalProps> = ({ isOpen, onOpenChange, currentDoc, onSave }) => {
    const [editState, setEditState] = useState<{ status: string; overall_deadline?: string }>({
        status: currentDoc.status,
        overall_deadline: currentDoc.overall_deadline,
    });
    const [isSaving, setIsSaving] = useState(false);

    React.useEffect(() => {
        setEditState({
            status: currentDoc.status,
            overall_deadline: currentDoc.overall_deadline,
        });
    }, [isOpen, currentDoc]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onSave(editState);
            toast({ title: "Success", description: "Project details updated." });
            onOpenChange(false);
        } catch (e) {
            toast({ title: "Error", description: "Failed to save project details.", variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit Project Overview</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {/* <div className="space-y-1">
                        <Label htmlFor="status">Project Status</Label>
                        <ReactSelect
                            options={PROJECT_STATUS_OPTIONS}
                            value={PROJECT_STATUS_OPTIONS.find(opt => opt.value === editState.status) || null}
                            onChange={(option) => setEditState(prev => ({ ...prev, status: option?.value || '' }))}
                            placeholder="Select Status"
                            classNamePrefix="react-select"
                            menuPosition="fixed" 
                        />
                    </div> */}
                    <div className="space-y-1">
                        <Label htmlFor="deadline">Overall Deadline</Label>
                        <Input
                            id="deadline"
                            type="date"
                            value={editState.overall_deadline || ''}
                            onChange={(e) => setEditState(prev => ({ ...prev, overall_deadline: e.target.value }))}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? <TailSpin width={20} height={20} color="white" /> : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}


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
    statusOptions: { label: string; value: string }[];
    subStatusOptions: { label: string; value: string }[];
}


interface NewTaskModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onAdd: (newTask: Partial<DesignTrackerTask>) => Promise<void>;
    usersList: User[];
    categories: any[]; // Now using the filtered list,
    existingTaskNames: string[];
    statusOptions: { label: string; value: string }[];
    existingZones: string[]; // NEW PROP
}

const NewTaskModal: React.FC<NewTaskModalProps> = ({ isOpen, onOpenChange, onAdd, usersList, categories, statusOptions,existingTaskNames, existingZones }) => {
    const initialCategoryName = categories[0]?.category_name || '';

    const [taskState, setTaskState] = useState<Partial<DesignTrackerTask>>({
        task_name: '',
        design_category: initialCategoryName,
        deadline: '',
        task_status: 'Not Started',
        file_link: '',
        comments: '',
        task_zone:'' // Default to first zone
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
                design_category: initialCategoryName,
                deadline: '',
                task_status: 'Not Started',
            });
            setSelectedDesigners([]);
        } else {
            // Reset category selection if the initial one disappears (or update based on new filtered list)
            if (!taskState.design_category || !categories.some(c => c.category_name === taskState.design_category)) {
                setTaskState(prev => ({ ...prev, design_category: initialCategoryName }));
            }
        }
    }, [isOpen, categories, initialCategoryName]);


    const handleSave = async () => {
        if (!taskState.task_name || !taskState.design_category || !taskState.task_zone) {
            toast({ title: "Error", description: "Task Name, Category, and Zone are required.", variant: "destructive" });
            return;
        }
        const normalizedCurrentName = taskState.task_name.toLowerCase().trim();

        const isDuplicate = existingTaskNames.some(existingName => {
            const normalizedExisting = existingName.toLowerCase().trim();
            return normalizedExisting === normalizedCurrentName;
        });

        if (isDuplicate) {
            toast({ 
                title: "Duplicate Task Name", 
                description: `The task name "${taskState.task_name}" is already used by another task in this project.`, 
                variant: "destructive" 
            });
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
            await onAdd(newTaskPayload);
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
                    {/* Category */}

                    {/* <div className="space-y-1">
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
                    </div> */}
                    {/* Zone Selection (NEW) */}
                    <div className="space-y-1">
                        <Label htmlFor="zone">Zone *</Label>
                        <ReactSelect
                            options={existingZones.map(z => ({ label: z, value: z }))}
                            value={existingZones.map(z => ({ label: z, value: z })).find(opt => opt.value === taskState.task_zone) || null}
                            onChange={(option) => setTaskState(prev => ({ ...prev, task_zone: option?.value || '' }))}
                            placeholder="Select Zone"
                            classNamePrefix="react-select"
                        />
                    </div>

                    <div className="space-y-1">
                        <Label htmlFor="category">Design Category *</Label>
                        <ReactSelect
                            options={categories}
                            value={categories.find((c: any) => c.value === taskState.design_category) || null}
                            onChange={(option: any) => setTaskState(prev => ({ ...prev, design_category: option ? option.value : '' }))}
                            classNamePrefix="react-select"
                           
                        />
                    </div>

                    {/* Task Name */}
                    <div className="space-y-1">
                        <Label htmlFor="task_name">Task Name *</Label>
                        <Input id="task_name" value={taskState.task_name} onChange={(e) => setTaskState(prev => ({ ...prev, task_name: e.target.value }))} required />
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

                    {/* Status (Default to Not Applicable) */}
                    {/* <div className="space-y-1">
                        <Label htmlFor="status">Status</Label>
                        <Select
                            value={taskState.task_status || 'Not Applicable'}
                            onValueChange={(val) => setTaskState(prev => ({ ...prev, task_status: val as any }))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select Status" />
                            </SelectTrigger>
                            <SelectContent>
                                {statusOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div> */}

                    {/* <div className="space-y-1">
                        <Label htmlFor="category">Status</Label>
                        <ReactSelect
                            options={statusOptions}
                            value={statusOptions.find((c: any) => c.value === taskState.task_status) || null}
                            onChange={(option: any) => setTaskState(prev => ({ ...prev, design_category: option ? option.value : '' }))}
                            classNamePrefix="react-select"
                           
                        />
                    </div> */}


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

// --- NEW: Add Category Modal Component ---
interface AddCategoryModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    availableCategories: CategoryItem[]; // Categories NOT currently in the tracker
    onAdd: (newTasks: Partial<DesignTrackerTask>[]) => Promise<void>;
}

const AddCategoryModal: React.FC<AddCategoryModalProps> = ({
    isOpen, onOpenChange, availableCategories, onAdd
}) => {
    const [selectedCategories, setSelectedCategories] = useState<CategoryItem[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    
    // START: Access tracker document to get existing zones
    const { id: trackerId } = useParams<{ id: string }>();
    const { trackerDoc } = useDesignTrackerLogic({ trackerId: trackerId! }); // Re-use connection to source of truth
    // END: Access tracker document

    React.useEffect(() => {
        if (!isOpen) {
            setSelectedCategories([]);
        }
    }, [isOpen]);

    const handleCategoryToggle = (category: CategoryItem) => {
        setSelectedCategories(prev =>
            prev.find(c => c.category_name === category.category_name)
                ? prev.filter(c => c.category_name !== category.category_name)
                : [...prev, category]
        );
    };

    const handleConfirm = async () => {
        if (selectedCategories.length === 0) {
            toast({ title: "Error", description: "Select at least one new category.", variant: "destructive" });
            return;
        }

        setIsSaving(true);

        const tasksToGenerate: Partial<DesignTrackerTask>[] = [];
        
        // Use existing zones from the tracker. If none (old data), fallback to a single pass (undefined zone).
        const existingZones = trackerDoc?.zone && trackerDoc.zone.length > 0 
            ? trackerDoc.zone.map(z => z.tracker_zone) 
            : [undefined]; // Loop at least once with no zone if no zones exist

        // Loop through Categories
        selectedCategories.forEach(cat => {
            const taskItems = cat.tasks;

            if (taskItems.length === 0) {
                 // Warning toast, but continue with other categories
                 // toast({ title: "Category Skipped", description: `Category ${cat.category_name} has no default tasks defined.`, variant: "warning" });
            }

            // Loop through Zones (Outer or Inner loop matters less, but tasks grouped by zone is usually better for reading)
            // Let's loop Zones inside Category to keep Cat grouping structure if needed, or simply flatten.
            
            existingZones.forEach(zoneName => {
                taskItems.forEach(taskDef => {
                    let calculatedDeadline: string | undefined = undefined;
                    if (taskDef.deadline_offset !== undefined && taskDef.deadline_offset !== null) {
                        const d = new Date();
                        d.setDate(d.getDate() + Number(taskDef.deadline_offset));
                        calculatedDeadline = d.toISOString().split('T')[0];
                    }

                    tasksToGenerate.push({
                        task_name: taskDef.task_name,
                        design_category: cat.category_name,
                        task_status: 'Not Started',
                        deadline: calculatedDeadline,
                        task_zone: zoneName, // Assign the Zone
                        deadline_offset: taskDef.deadline_offset
                    });
                });
            });
        });

        try {
            await onAdd(tasksToGenerate); 

            toast({ title: "Success", description: `${selectedCategories.length} categories added.`, variant: "success" });
            onOpenChange(false);
        } catch (error) {
            toast({ title: "Creation Failed", description: "Failed to add categories.", variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };


    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Select New Categories to Add</DialogTitle>
                    <div className="text-sm text-gray-500">
                        Choose categories not currently tracked for this project. Default tasks will be generated for all active zones.
                    </div>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="grid grid-cols-3 gap-3 max-h-80 overflow-y-auto p-2 border rounded-lg">
                        {availableCategories.length === 0 ? (
                            <p className="col-span-3 text-center text-gray-500 py-4">
                                All available master categories are already active.
                            </p>
                        ) : (
                            availableCategories.map(cat => (
                                <Button
                                    key={cat.category_name}
                                    variant={selectedCategories.find(c => c.category_name === cat.category_name) ? "default" : "outline"}
                                    onClick={() => handleCategoryToggle(cat)}
                                    disabled={isSaving}
                                >
                                    {cat.category_name}
                                </Button>
                            ))
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <DialogClose asChild><Button variant="outline" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button
                        onClick={handleConfirm}
                        disabled={selectedCategories.length === 0 || isSaving}
                    >
                        {isSaving ? <TailSpin width={20} height={20} color="white" /> : `Add ${selectedCategories.length} Categories`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};



// --- NEW: Add Zone Modal Component ---
interface AddZoneModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onAdd: (newMiddleware: { zones: string[] }) => Promise<void>;
    existingZones: string[];
}

const AddZoneModal: React.FC<AddZoneModalProps> = ({ isOpen, onOpenChange, onAdd, existingZones }) => {
    const [zoneInput, setZoneInput] = useState("");
    const [zones, setZones] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    React.useEffect(() => {
        if (!isOpen) {
            setZones([]);
            setZoneInput("");
        }
    }, [isOpen]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addZone();
        }
    };

    const addZone = () => {
        const trimmed = zoneInput.trim();
        if (!trimmed) return;

        const isValidFormat = /^[a-zA-Z0-9 ]+$/.test(trimmed);
        if (!isValidFormat) {
            toast({ title: "Invalid Format", description: "Zone name must contain only letters and numbers.", variant: "destructive" });
            return;
        }

        const isDuplicateInCurrent = zones.some(z => z.toLowerCase() === trimmed.toLowerCase());
        const isDuplicateInExisting = existingZones.some(z => z.toLowerCase() === trimmed.toLowerCase());

        if (isDuplicateInCurrent || isDuplicateInExisting) {
            toast({ title: "Duplicate Zone", description: "This zone name already exists.", variant: "destructive" });
            return;
        }

        setZones([...zones, trimmed]);
        setZoneInput("");
    };

    const removeZone = (zoneToRemove: string) => {
        setZones(zones.filter(z => z !== zoneToRemove));
    };

    const handleConfirm = async () => {
        const pendingZone = zoneInput.trim();
        const finalZones = pendingZone && !zones.includes(pendingZone) ? [...zones, pendingZone] : zones;

        if (finalZones.length === 0) {
            toast({ title: "Error", description: "Please add at least one zone.", variant: "destructive" });
            return;
        }

        setIsSaving(true);
        try {
            await onAdd({ zones: finalZones });
            onOpenChange(false);
        } catch (error) {
            toast({ title: "Error", description: "Failed to add zones.", variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add New Zones</DialogTitle>
                    <div className="text-sm text-center text-gray-500">
                        Add new zones to this tracker. Tasks for all currently active
                        categories will be generated for these new zones.
                    </div>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="flex gap-2">
                        <Input
                            placeholder="Type zone name (e.g. Tower C) and press Enter"
                            value={zoneInput}
                            onChange={(e) => setZoneInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                        />
                         <Button type="button" onClick={addZone} variant="secondary">Add</Button>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 min-h-[60px] p-2 border rounded-md bg-slate-50">
                        {zones.length === 0 && <span className="text-gray-400 text-sm p-1">No zones added yet.</span>}
                        {zones.map((zone) => (
                            <Badge key={zone} variant="secondary" className="px-3 py-1 text-sm bg-white border shadow-sm">
                                {zone}
                                <button onClick={() => removeZone(zone)} className="ml-2 text-gray-400 hover:text-red-500">
                                    ×
                                </button>
                            </Badge>
                        ))}
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button variant="outline" disabled={isSaving}>Cancel</Button></DialogClose>
                    <Button onClick={handleConfirm} disabled={isSaving || zones.length === 0}>
                        {isSaving ? <TailSpin width={20} height={20} color="white" /> : "Confirm Add Zones"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


// --- Main Detail Component ---
interface ProjectDesignTrackerDetailProps {
    trackerId?: string;
}

export const ProjectDesignTrackerDetail: React.FC<ProjectDesignTrackerDetailProps> = ({ trackerId: propTrackerId }) => {
    const { role, user_id } = useUserData();
    const isDesignExecutive = role === "Nirmaan Design Executive Profile";

    const checkIfUserAssigned = (task: DesignTrackerTask) => {
        const designerField = task.assigned_designers;
        if (!designerField) return false;
        
        let designers: AssignedDesignerDetail[] = [];
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
            } catch (e) {
                // JSON parsing failed
            }
        }
        return designers.some(d => d.userId === user_id);
    };

    const { id: paramTrackerId } = useParams<{ id: string }>();
    const trackerId = propTrackerId || paramTrackerId;

    const {
        trackerDoc, groupedTasks, categoryData, isLoading, error, getDesignerName, handleTaskSave, editingTask, setEditingTask, usersList, handleParentDocSave, statusOptions,
        subStatusOptions,
        handleNewTaskCreation
    } = useDesignTrackerLogic({ trackerId: trackerId! });

    const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
    const [overallDeadline, setOverallDeadline] = useState(trackerDoc?.overall_deadline || '');
    const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
    const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false); // Can likely remove now
    const [isAddZoneModalOpen, setIsAddZoneModalOpen] = useState(false); // NEW STATE
    const [isProjectOverviewModalOpen, setIsProjectOverviewModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState("all");

    // --- Master Category Calculation ---

    // Extract Unique Zones from Tracker Doc
    const uniqueZones = useMemo(() => {
        if (trackerDoc?.zone && trackerDoc.zone.length > 0) {
            return trackerDoc.zone.map(z => z.tracker_zone);
        }
        // Fallback: Check tasks for zones if child table is empty
        if (trackerDoc?.design_tracker_task) {
            const zonesFromTasks = new Set(trackerDoc.design_tracker_task.map(t => t.task_zone).filter(Boolean));
            return Array.from(zonesFromTasks);
        }
        return [];
    }, [trackerDoc]);


    // 1. Categories currently active in this tracker + 'Others' fallback
   // 1. Categories currently active in this tracker + 'Others' fallback
    const activeCategoriesInTracker = useMemo(() => {
        if (!trackerDoc?.design_tracker_task || !categoryData) return [];

        const uniqueCategoryNames = new Set(
            trackerDoc.design_tracker_task.map(t => t.design_category)
        );

        // Filter master categories to include only those currently active in the tracker
        const filteredCategories = categoryData.filter(masterCat =>
            uniqueCategoryNames.has(masterCat.category_name)
        );

        const othersCategory: CategoryItem = {
            category_name: "Others",
            tasks: [],
        };

        let resultList = filteredCategories;

        // If 'Others' category is not already in the list, append it
        if (!uniqueCategoryNames.has("Others")) {
            resultList = [...filteredCategories, othersCategory];
        }

        // Map to Label/Value format for React Select
        return resultList.map(cat => ({
            label: cat.category_name,
            value: cat.category_name,
            ...cat // Keep original fields (tasks, category_name)
        }));

    }, [trackerDoc?.design_tracker_task, categoryData]);
    console.log("Active Categories in Tracker:", activeCategoriesInTracker);

    // 2. Categories available to be ADDED (Master list minus categories already in tracker)
    const availableNewCategories: CategoryItem[] = useMemo(() => {
        if (!trackerDoc?.design_tracker_task || !categoryData) return [];

        const activeCategoryNames = new Set(
            trackerDoc.design_tracker_task.map(t => t.design_category)
        );

        // Filter master list:
        // 1. Not currently in the tracker
        // 2. Not "Others"
        // 3. Must have at least one task defined
        return categoryData.filter(masterCat =>
            !activeCategoryNames.has(masterCat.category_name) && 
            masterCat.category_name !== "Others" &&
            Array.isArray(masterCat.tasks) && 
            masterCat.tasks.length > 0
        );

    }, [trackerDoc?.design_tracker_task, categoryData]);

    // --- Action: Handle adding NEW categories (batch task creation) ---
    // This action appends the newly generated tasks to the existing document array.
    const handleAddCategories = async (newTasks: Partial<DesignTrackerTask>[]) => {
        if (!trackerDoc) return;

        // Append new tasks to the existing array and save the whole doc
        const updatedTasks = [...(trackerDoc.design_tracker_task || []), ...newTasks];

        // We use handleParentDocSave which safely calls updateDoc and refetches the tracker
        await handleParentDocSave({ design_tracker_task: updatedTasks });
    }

    const handleAddZone = async ({ zones }: { zones: string[] }) => {
        if (!trackerDoc) return;

        // 1. Identify Active Categories (we already have activeCategoriesInTracker)
        // activeCategoriesInTracker contains the master configurations for active cats
        // The `activeCategoriesInTracker` memo above returns categories that are *already* in the tracker.
        // For adding zones, we want categories that are *defined* in the master list and *have tasks*.
        // Let's use `categoryData` and filter for those that are actually active in the tracker.
        const activeCategoryNamesInTracker = new Set(trackerDoc.design_tracker_task?.map(t => t.design_category) || []);
        const catsToPopulate = categoryData.filter(cat => 
            activeCategoryNamesInTracker.has(cat.category_name) && 
            Array.isArray(cat.tasks) && 
            cat.tasks.length > 0
        );

        if (catsToPopulate.length === 0) {
             toast({ title: "Warning", description: "No active categories found to populate tasks for.", variant: "warning" });
             // We still might want to add the zone even if no tasks are created? Yes.
        }

        const newTasks: Partial<DesignTrackerTask>[] = [];

        // 2. Generate Tasks: New Zones x Active Categories
        zones.forEach(zoneName => {
            catsToPopulate.forEach(cat => {
                 cat.tasks.forEach(taskDef => { // taskDef comes from master data in activeCategoriesInTracker
                    let calculatedDeadline: string | undefined = undefined;
                    if (taskDef.deadline_offset !== undefined && taskDef.deadline_offset !== null) {
                         // Calculate based on today or project start? Usually creation date or today.
                         // Using current date as baseline for new zone addition
                        const d = new Date();
                        d.setDate(d.getDate() + Number(taskDef.deadline_offset));
                        calculatedDeadline = d.toISOString().split('T')[0];
                    }

                    newTasks.push({
                        task_name: taskDef.task_name,
                        design_category: cat.category_name,
                        task_status: 'Not Started',
                        deadline: calculatedDeadline,
                        task_zone: zoneName, 
                        deadline_offset: taskDef.deadline_offset
                        // assigned_designers? default empty
                    });
                 });
            });
        });

        // 3. Prepare Child Table Updates using handleParentDocSave logic or similar
        // We need to update: 'zone' child table AND 'design_tracker_task' child table.
        // handleNewTaskCreation only appends tasks. handleParentDocSave updates specific fields.
        // We probably need to manually construct the update payload for both tables.
        
        // Construct new Zone rows
        const existingZoneRows = trackerDoc.zone || [];
        const newZoneRows = zones.map(z => ({ tracker_zone: z }));
        const updatedZoneTable = [...existingZoneRows, ...newZoneRows];

        // Construct new Task rows (append to existing)
        const currentTasks = trackerDoc.design_tracker_task || [];
        const updatedTaskTable = [...currentTasks, ...newTasks];


        try {
            // Using handleParentDocSave might replace the whole table? 
            // The hook's handleParentDocSave is: onSave(updatedFields). 
            // Let's check `useDesignTrackerLogic` implementation via context or Assumption.
            // Assumption: onSave merges top-level fields but for child tables we must send the whole list if we want to update it.
            
            await handleParentDocSave({
                zone: updatedZoneTable,
                design_tracker_task: updatedTaskTable
            });

             // Force refresh or optimistic update is handled by the hook/SWR usually.
             toast({ title: "Success", description: `${zones.length} new zone(s) added.`, variant: "success" });
             setIsAddZoneModalOpen(false);
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Failed to add zone(s).", variant: "destructive" });
            throw e; // Re-throw for Modal to catch
        }
    };


    React.useEffect(() => {
        if (trackerDoc?.overall_deadline) {
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
    // const getAssignedNameForDisplay = (task: DesignTrackerTask): React.ReactNode => {
    //     const designerField = task.assigned_designers;
    //     let designers: AssignedDesignerDetail[] = [];

    //     if (designerField) {
    //         // Check if already an object (from useDesignTrackerLogic state)
    //         if (designerField && typeof designerField === 'object' && Array.isArray(designerField.list)) {
    //             designers = designerField.list;
    //         } else if (Array.isArray(designerField)) {
    //             designers = designerField;
    //         } else if (typeof designerField === 'string' && designerField.trim() !== '') {
    //             try {
    //                 const parsed = JSON.parse(designerField);
    //                 if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list)) {
    //                     designers = parsed.list;
    //                 } else if (Array.isArray(parsed)) {
    //                     designers = parsed;
    //                 }
    //             } catch (e) { /* silent fail */ }
    //         }
    //     }

    //     if (designers.length > 0) {
    //         return (
    //             <p className="text-center">
    //                 {/* <ul className="list-disc ml-0 p-0 m-0 space-y-0.5 text-xs"> */}
    //                 {designers.map((d, index) => (
    //                     <span className="text-xs block text-center" key={index}>
    //                         {d.userName || d.userId}
    //                     </span>
    //                 ))}
    //                 {/* </ul> */}
    //             </p>
    //         )
    //     } else {
    //         return <p className="text-xs text-center text-gray-500">--</p>;
    //     }
    //     return getDesignerName(undefined);
    // };

  
     

    // --- PDF DOWNLOAD HANDLER ---
    const handleDownloadReport = async () => {
        const printFormatName = "Project Design Tracker"; 
        const params = new URLSearchParams({
            doctype: DOCTYPE,
            name: trackerId!,
            format: printFormatName,
            no_letterhead: "0", 
            _lang: "en",
        });

        // Use the frappe.utils.print_format.download_pdf method which returns the PDF file directly
        const downloadUrl = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;

        try {
            toast({ title: "Generating PDF...", description: "Please wait while we generate your report." });
            
            const response = await fetch(downloadUrl);
            if (!response.ok) throw new Error('PDF generation failed.');
            
            const blob = await response.blob();
            
            // Custom Filename Logic
            const now = new Date();
            const dateStr = format(now, "dd_MMM_yyyy");
            const projectNameClean = (trackerDoc.project_name || "Project").replace(/[^a-zA-Z0-9-_]/g, "_");
            const filename = `${projectNameClean}-${dateStr}-DesignTracker.pdf`;

            const url = window.URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);

            toast({ title: "Success", description: "Report downloaded successfully.", variant: "success" });
        } catch (error) {
            console.error("Download Error:", error);
            toast({ title: "Error", description: "Failed to download PDF.", variant: "destructive" });
        }
    };

    return (
        <div className="flex-1 space-y-6 p-6">

            {/* --- TOP HEADER (Adding Add Categories button) --- */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center space-y-4 md:space-y-0">
                <header>
                    <h1 className="text-3xl font-bold text-red-700">{trackerDoc.project_name}</h1>
                    {/* <p className="text-sm text-gray-500">ID: {trackerDoc.project}</p> */}
                </header>

                <div className="flex flex-col md:flex-row w-full md:w-auto space-y-2 md:space-y-0 md:space-x-3">
                    {!isDesignExecutive && (
                    <Button
                        variant="outline"
                        className="flex items-center justify-center gap-1 text-red-700 border-red-700 hover:bg-red-50/50 w-full md:w-auto"
                        onClick={() => setIsAddCategoryModalOpen(true)}
                        disabled={availableNewCategories.length === 0}
                    >
                        <Plus className="h-4 w-4" /> Add Categories
                    </Button>
                    )}
                    {!isDesignExecutive && (
                    <Button
                        variant="outline"
                        className="flex items-center justify-center gap-1 text-red-700 border-red-700 hover:bg-red-50/50 w-full md:w-auto"
                        onClick={() => setIsAddZoneModalOpen(true)}
                    >
                        <Plus className="h-4 w-4" /> Add Zone
                    </Button>
                    )}
                    <Button 
                        variant="destructive" 
                        className="flex items-center justify-center gap-2 w-full md:w-auto"
                        onClick={handleDownloadReport}
                    >
                        <Download className="h-4 w-4" /> Export
                    </Button>

                   
                </div>
            </div>

            {/* --- PROJECT OVERVIEW CARD --- */}
            <Card className="shadow-lg p-6 bg-white relative">
                <div className="absolute top-4 right-4">
                   {/* Edit moved to Header Actions */}
                </div>
                <CardTitle className="text-xl font-semibold mb-4">Project Overview</CardTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 text-sm text-gray-700 border p-4 rounded-lg">

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
                    {/* <div className="space-y-1">
                        <Label className="uppercase text-xs font-medium text-gray-500">Created On</Label>
                        <p className="font-semibold">{formatDeadlineShort(trackerDoc.creation)}</p>
                    </div> */}

                    {/* Project Status */}
                    {/* <div className="space-y-1">
                        <Label className="uppercase text-xs font-medium text-gray-500">Project Status</Label>
                        <p>
                            <Badge
                                variant="outline"
                                className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getStatusBadgeStyle(trackerDoc.status || '...')} rounded-full`}
                            >
                                {trackerDoc.status}
                            </Badge>
                        </p>

                    </div> */}

                    {/* Overall Deadline (Editable Input) */}

                     {/* Overall Deadline (Editable Input) */}
    <div className="space-y-1">
        {/* 1. Label and Edit Button Container */}
        <div className="flex items-center justify-start gap-1">
            
            <Label className="uppercase text-xs font-medium text-muted-foreground tracking-wider">
                Deadline
            </Label>
            
            {!isDesignExecutive && (
                <Button
                    variant="ghost" 
                    size="icon"
                    onClick={() => setIsProjectOverviewModalOpen(true)}
                    className="h-6 w-6 p-1 text-primary/70 hover:text-primary transition-colors"
                    title="Edit Overall Deadline"
                >
                    <Edit className="h-3 w-3" /> 
                </Button>
            )}
            
        </div>
        
        {/* 2. Value: DEADLINE DATE */}
        <p className="text-xl font-bold text-red-700 tracking-tight"> {/* MATCHED TEXT-XL FONT-BOLD */}
            {formatDeadlineShort(trackerDoc.overall_deadline)}
        </p>
    </div>
                </div>
            </Card>

            {/* --- ON-BOARDING SECTION --- */}
            <div className="flex justify-between items-center pt-4">
                <h2 className="text-2xl font-bold text-gray-800">Task List</h2>
                {!isDesignExecutive && (
                <Button
                    variant="outline"
                    className="text-red-700 border-red-700 hover:bg-red-50/50"
                    onClick={() => {
                        if (activeCategoriesInTracker.length === 0) {
                            toast({
                                title: "Cannot Add Task",
                                description: "Failed to load active categories for this project.",
                                variant: "destructive"
                            });
                        } else {
                            setIsNewTaskModalOpen(true);
                        }
                    }}
                >
                    Create Custom Task
                </Button>
                )}
            </div>

            {/* --- TASK LIST (ACCORDION STYLE) --- */}
            
            <Tabs defaultValue="all" className="w-full" onValueChange={setActiveTab}>
                {uniqueZones.length > 0 && (
                    <TabsList className="mb-4">
                        <TabsTrigger value="all">All</TabsTrigger>
                        {uniqueZones.map(zone => (
                            <TabsTrigger key={zone} value={zone!}>{zone}</TabsTrigger>
                        ))}
                    </TabsList>
                )}

                 <TabsContent value="all" className="mt-0 space-y-4 bg-white border rounded-lg p-4">
                     {Object.entries(groupedTasks).map(([categoryName, tasks]) => {
                        const isExpanded = expandedCategories[categoryName] ?? true;

                        return (
                            <div key={categoryName} className="">

                                {/* Category Header */}
                                <div
                                    className={`flex justify-between items-center px-2 py-3 cursor-pointer 
                                    ${isExpanded ? 'border-none bg-white rounded-t-lg' : 'border bg-[#f2f2fb] rounded-lg'}`}
                                    onClick={() => toggleCategory(categoryName)}
                                >
                                    <h2 className="text-lg font-semibold text-gray-800">
                                        {categoryName} ({tasks.length} Tasks)
                                    </h2>
                                    {isExpanded ? <ChevronUp className="text-gray-600" /> : < ChevronDown />}
                                </div>

                                {/* Task Table Content */}
                                {isExpanded && (
                                    <div className=" overflow-x-auto rounded-lg border border-gray-300">
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-gray-100 text-xs text-gray-500 uppercase" style={{ backgroundColor: '#f2f2fb' }}>
                                                    <tr className='text-xs text-gray-500 uppercase font-medium'>
                                                        <th className="px-4 py-3 text-left w-[15%]">Task Name</th>
                                                        <th className="px-4 py-3 text-left w-[18%]">Assigned Designer</th>
                                                        <th className="px-4 py-3 text-left w-[10%]">Deadline</th>
                                                        <th className="px-4 py-3 text-center w-[10%]">Status</th>
                                                        <th className="px-4 py-3 text-center w-[15%]">Sub-Status</th>
                                                        <th className="px-4 py-3 text-center w-[10%]">Comments</th>
                                                        <th className="px-4 py-3 text-center w-[10%]">Link</th>
                                                        <th className="px-4 py-3 text-center w-[15%]">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white divide-y divide-gray-100">
                                                    {tasks.map((task) => (
                                                        <tr key={task.name}>
                                                            <td className="px-4 py-3 w-[15%] whitespace-wrap text-sm font-medium text-gray-900">{task.task_name}</td>
                                                            <td className="px-4 py-3 text-sm text-gray-500 text-left ">{getAssignedNameForDisplay(task)}</td>
                                                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{formatDeadlineShort(task.deadline) || '...'}</td>

                                                            {/* Status Badge */}
                                                            <td className="px-4 py-3 text-sm">
                                                                <div className="flex justify-center">
                                                                    <Badge
                                                                        variant="outline"
                                                                        className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center capitalize whitespace-normal break-words text-center leading-tight ${getTaskStatusStyle(task.task_status || '...')} rounded-full`}
                                                                    >
                                                                        {task.task_status || '...'}
                                                                    </Badge>
                                                                </div>
                                                            </td>

                                                            {/* Sub-Status Badge */}
                                                            <td className="px-4 py-3 text-sm">
                                                                <div className="flex justify-center">
                                                                    <Badge
                                                                        variant="outline"
                                                                        className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getTaskSubStatusStyle(task.task_sub_status || '...')} rounded-full`}
                                                                    >
                                                                        {task.task_sub_status || '...'}
                                                                    </Badge>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <TooltipProvider>
                                                                    <Tooltip delayDuration={300}>
                                                                        <TooltipTrigger asChild>
                                                                            {/* We use cursor-default here as the trigger handles the hover interaction */}
                                                                            <MessageCircle
                                                                                className={`h-6 w-6 p-1 bg-gray-100 rounded-md mx-auto  ${task.comments ? 'cursor-pointer text-gray-600 hover:scale-110 transition-transform ' : 'text-gray-300'}`}
                                                                            />
                                                                        </TooltipTrigger>
                                                                        {task.comments && (
                                                                            <TooltipContent className="max-w-xs p-2 bg-white text-gray-900 border shadow-lg">
                                                                                {/* <p className="font-semibold text-xs mb-1">Comments:</p> */}
                                                                                <p className="text-xs">{task.comments}</p>
                                                                            </TooltipContent>
                                                                        )}
                                                                    </Tooltip>
                                                                </TooltipProvider>
                                                            </td>

                                                            {/* 2. Link Column (Using Tooltip) */}
                                                            <td className="px-4 py-3 text-center">

                                                                <TooltipProvider>
                                                                    <Tooltip delayDuration={300}>
                                                                        <TooltipTrigger asChild>
                                                                            <a
                                                                                href={task.file_link}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                className="flex justify-center items-center w-full h-full cursor-pointer hover:scale-110 transition-transform"
                                                                            >
                                                                                <LinkIcon className={`h-6 w-6 p-1 bg-gray-100 rounded-md ${task.file_link ? 'cursor-pointer text-blue-500' : 'text-gray-300'}`} />
                                                                            </a>
                                                                        </TooltipTrigger>
                                                                        {task.file_link && (<TooltipContent className="p-2 bg-gray-900 text-white shadow-lg">
                                                                            <a
                                                                                href={task.file_link}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                className="block w-full h-full cursor-pointer hover:scale-110 transition-transform"
                                                                            >
                                                                                {task.file_link.substring(0, 30)}...
                                                                            </a>
                                                                        </TooltipContent>)}

                                                                    </Tooltip>
                                                                </TooltipProvider>

                                                            </td>

                                                            {/* Actions */}
                                                            <td className="px-4 py-3 text-center">
                                                                {(!isDesignExecutive || (isDesignExecutive && checkIfUserAssigned(task))) ? (
                                                                    <Button variant="outline" size="sm" onClick={() => setEditingTask(task)} className="h-8">
                                                                        <Edit className="h-3 w-3 mr-1" /> Edit
                                                                    </Button>
                                                                ) : (
                                                                    <Button variant="outline" size="sm" className="h-8 opacity-50 cursor-not-allowed" disabled>
                                                                        <Edit className="h-3 w-3 mr-1" /> Edit
                                                                    </Button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </TabsContent>

                {uniqueZones.map(zone => (
                    <TabsContent key={zone} value={zone!} className="mt-0 space-y-4 bg-white border rounded-lg p-4">
                        {Object.entries(groupedTasks).map(([categoryName, tasks]) => {
                             // --- FILTERING LOGIC ---
                             const filteredTasks = tasks.filter(t => t.task_zone === zone);
                             if (filteredTasks.length === 0) return null;

                             const isExpanded = expandedCategories[categoryName] ?? true;

                                return (
                                    <div key={`${categoryName}-${zone}`} className="">

                                        {/* Category Header */}
                                        <div
                                            className={`flex justify-between items-center px-2 py-3 cursor-pointer 
                                            ${isExpanded ? 'border-none bg-white rounded-t-lg' : 'border bg-[#f2f2fb] rounded-lg'}`}
                                            onClick={() => toggleCategory(categoryName)}
                                        >
                                            <h2 className="text-lg font-semibold text-gray-800">
                                                {categoryName} ({filteredTasks.length} Tasks)
                                            </h2>
                                            {isExpanded ? <ChevronUp className="text-gray-600" /> : < ChevronDown />}
                                        </div>

                                        {/* Task Table Content */}
                                        {isExpanded && (
                                            <div className=" overflow-x-auto rounded-lg border border-gray-300">
                                                <div className="overflow-x-auto">
                                                    <table className="min-w-full divide-y divide-gray-200">
                                                        <thead className="bg-gray-100 text-xs text-gray-500 uppercase" style={{ backgroundColor: '#f2f2fb' }}>
                                                            <tr className='text-xs text-gray-500 uppercase font-medium'>
                                                                <th className="px-4 py-3 text-left w-[15%]">Task Name</th>
                                                                <th className="px-4 py-3 text-left w-[18%]">Assigned Designer</th>
                                                                <th className="px-4 py-3 text-left w-[10%]">Deadline</th>
                                                                <th className="px-4 py-3 text-center w-[10%]">Status</th>
                                                                <th className="px-4 py-3 text-center w-[15%]">Sub-Status</th>
                                                                <th className="px-4 py-3 text-center w-[10%]">Comments</th>
                                                                <th className="px-4 py-3 text-center w-[10%]">Link</th>
                                                                <th className="px-4 py-3 text-center w-[15%]">Actions</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="bg-white divide-y divide-gray-100">
                                                            {filteredTasks.map((task) => (
                                                                <tr key={task.name}>
                                                                    <td className="px-4 py-3 w-[15%] whitespace-wrap text-sm font-medium text-gray-900">{task.task_name}</td>
                                                                    <td className="px-4 py-3 text-sm text-gray-500 text-left ">{getAssignedNameForDisplay(task)}</td>
                                                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{formatDeadlineShort(task.deadline) || '...'}</td>

                                                                    {/* Status Badge */}
                                                                    <td className="px-4 py-3 text-sm">
                                                                        <div className="flex justify-center">
                                                                            <Badge
                                                                                variant="outline"
                                                                                className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center capitalize whitespace-normal break-words text-center leading-tight ${getTaskStatusStyle(task.task_status || '...')} rounded-full`}
                                                                            >
                                                                                {task.task_status || '...'}
                                                                            </Badge>
                                                                        </div>
                                                                    </td>

                                                                    {/* Sub-Status Badge */}
                                                                    <td className="px-4 py-3 text-sm">
                                                                        <div className="flex justify-center">
                                                                            <Badge
                                                                                variant="outline"
                                                                                className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getTaskSubStatusStyle(task.task_sub_status || '...')} rounded-full`}
                                                                            >
                                                                                {task.task_sub_status || '...'}
                                                                            </Badge>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-4 py-3 text-center">
                                                                        <TooltipProvider>
                                                                            <Tooltip delayDuration={300}>
                                                                                <TooltipTrigger asChild>
                                                                                    {/* We use cursor-default here as the trigger handles the hover interaction */}
                                                                                    <MessageCircle
                                                                                        className={`h-6 w-6 p-1 bg-gray-100 rounded-md mx-auto  ${task.comments ? 'cursor-pointer text-gray-600 hover:scale-110 transition-transform ' : 'text-gray-300'}`}
                                                                                    />
                                                                                </TooltipTrigger>
                                                                                {task.comments && (
                                                                                    <TooltipContent className="max-w-xs p-2 bg-white text-gray-900 border shadow-lg">
                                                                                        {/* <p className="font-semibold text-xs mb-1">Comments:</p> */}
                                                                                        <p className="text-xs">{task.comments}</p>
                                                                                    </TooltipContent>
                                                                                )}
                                                                            </Tooltip>
                                                                        </TooltipProvider>
                                                                    </td>

                                                                    {/* 2. Link Column (Using Tooltip) */}
                                                                    <td className="px-4 py-3 text-center">

                                                                        <TooltipProvider>
                                                                            <Tooltip delayDuration={300}>
                                                                                <TooltipTrigger asChild>
                                                                                    <a
                                                                                        href={task.file_link}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        className="flex justify-center items-center w-full h-full cursor-pointer hover:scale-110 transition-transform"
                                                                                    >
                                                                                        <LinkIcon className={`h-6 w-6 p-1 bg-gray-100 rounded-md ${task.file_link ? 'cursor-pointer text-blue-500' : 'text-gray-300'}`} />
                                                                                    </a>
                                                                                </TooltipTrigger>
                                                                                {task.file_link && (<TooltipContent className="p-2 bg-gray-900 text-white shadow-lg">
                                                                                    <a
                                                                                        href={task.file_link}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        className="block w-full h-full cursor-pointer hover:scale-110 transition-transform"
                                                                                    >
                                                                                        {task.file_link.substring(0, 30)}...
                                                                                    </a>
                                                                                </TooltipContent>)}

                                                                            </Tooltip>
                                                                        </TooltipProvider>

                                                                    </td>

                                                                    {/* Actions */}
                                                                    <td className="px-4 py-3 text-center">
                                                                        {(!isDesignExecutive || (isDesignExecutive && checkIfUserAssigned(task))) ? (
                                                                            <Button variant="outline" size="sm" onClick={() => setEditingTask(task)} className="h-8">
                                                                                <Edit className="h-3 w-3 mr-1" /> Edit
                                                                            </Button>
                                                                        ) : (
                                                                            <Button variant="outline" size="sm" className="h-8 opacity-50 cursor-not-allowed" disabled>
                                                                                <Edit className="h-3 w-3 mr-1" /> Edit
                                                                            </Button>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                        })}
                         {Object.values(groupedTasks).every(tasks => tasks.filter(t => t.task_zone === zone).length === 0) && (
                            <div className="text-center text-gray-500 py-8">No tasks found for {zone}</div>
                         )}
                    </TabsContent>
                ))}

            </Tabs>


            {editingTask && (
                <TaskEditModal
                    isOpen={!!editingTask}
                    onOpenChange={(open) => { if (!open) setEditingTask(null); }}
                    task={editingTask}
                    onSave={inlineTaskSaveHandler}
                    usersList={usersList || []}
                    statusOptions={statusOptions}
                    subStatusOptions={subStatusOptions}
                    existingTaskNames={getExistingTaskNames(trackerDoc)} 
                    isRestrictedMode={isDesignExecutive}
                />
            )}

            {/* New Task Modal */}
            {activeCategoriesInTracker.length > 0 && (
                <NewTaskModal
                    isOpen={isNewTaskModalOpen}
                    onOpenChange={setIsNewTaskModalOpen}
                    onAdd={handleNewTaskCreation}
                    usersList={usersList || []}
                    statusOptions={statusOptions}
                    categories={activeCategoriesInTracker}
                    existingTaskNames={getExistingTaskNames(trackerDoc)} 
                    existingZones={uniqueZones}
                />
            )}


            {/* Project Overview Edit Modal (NEW) */}
            {/* Add Category Modal */}
            <AddCategoryModal
                isOpen={isAddCategoryModalOpen}
                onOpenChange={setIsAddCategoryModalOpen}
                availableCategories={availableNewCategories}
                onAdd={handleAddCategories}
            />

            {/* Add Zone Modal */}
             <AddZoneModal
                isOpen={isAddZoneModalOpen}
                onOpenChange={setIsAddZoneModalOpen}
                onAdd={handleAddZone}
                existingZones={uniqueZones}
            />

            {/* Project Overview Edit Modal */}
            {trackerDoc && (
                <ProjectOverviewEditModal
                    isOpen={isProjectOverviewModalOpen}
                    onOpenChange={setIsProjectOverviewModalOpen}
                    currentDoc={trackerDoc}
                    onSave={handleParentDocSave}
                />
            )}
        </div>
    );
};

export default ProjectDesignTrackerDetail;


