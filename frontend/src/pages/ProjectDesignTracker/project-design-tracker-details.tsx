// frontend/src/pages/ProjectDesignTracker/project-design-tracker-details.tsx
// Uses unified DataTable with faceted filters and zone tabs
// Original accordion-based version available in: project-design-tracker-details-original.tsx

import React, { useCallback, useMemo, useState } from 'react';
import { format } from "date-fns";
import { useParams } from 'react-router-dom';
import { ProjectDesignTracker, DesignTrackerTask, User, AssignedDesignerDetail } from './types';
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { Button } from '@/components/ui/button';
import { Edit, Download, Plus, Check, Info, X } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import ReactSelect from 'react-select';
import { Label } from '@/components/ui/label';
import { useDesignTrackerLogic } from './hooks/useDesignTrackerLogic';
import { TailSpin } from 'react-loader-spinner';
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDeadlineShort, getExistingTaskNames } from './utils';
import { TaskEditModal } from './components/TaskEditModal';
import { RenameZoneDialog } from './components/RenameZoneDialog';
import { useUserData } from "@/hooks/useUserData";

// DataTable imports
import { DataTable } from "@/components/data-table/new-data-table";
import {
    useReactTable,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    ColumnFiltersState,
    SortingState,
    PaginationState,
} from "@tanstack/react-table";
import { getTaskTableColumns, TASK_DATE_COLUMNS } from './config/taskTableColumns';

const DOCTYPE = 'Project Design Tracker';

// --- TYPE DEFINITION for Category Items ---
interface CategoryItem {
    category_name: string;
    tasks: { task_name: string; deadline_offset?: number }[];
}

// --- Project Overview Edit Modal ---
interface ProjectOverviewEditModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    currentDoc: ProjectDesignTracker;
    onSave: (updatedFields: Partial<ProjectDesignTracker>) => Promise<void>;
}

const ProjectOverviewEditModal: React.FC<ProjectOverviewEditModalProps> = ({ isOpen, onOpenChange, currentDoc, onSave }) => {
    const [editState, setEditState] = useState<{ overall_deadline?: string }>({
        overall_deadline: currentDoc.overall_deadline,
    });
    const [isSaving, setIsSaving] = useState(false);

    React.useEffect(() => {
        setEditState({
            overall_deadline: currentDoc.overall_deadline,
        });
    }, [isOpen, currentDoc]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onSave({ overall_deadline: editState.overall_deadline });
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
};

// --- Designer Option Interface ---
interface DesignerOption {
    value: string;
    label: string;
    email: string;
}

// --- New Task Modal ---
interface NewTaskModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onAdd: (newTask: Partial<DesignTrackerTask>) => Promise<void>;
    usersList: User[];
    categories: any[];
    existingTaskNames: string[];
    statusOptions: { label: string; value: string }[];
    activeZone: string; // Pre-filled from active tab
}

const NewTaskModal: React.FC<NewTaskModalProps> = ({ isOpen, onOpenChange, onAdd, usersList, categories, statusOptions: _statusOptions, existingTaskNames, activeZone }) => {
    const initialCategoryName = categories[0]?.category_name || '';

    const [taskState, setTaskState] = useState<Partial<DesignTrackerTask>>({
        task_name: '',
        design_category: initialCategoryName,
        deadline: '',
        task_status: 'Not Started',
        file_link: '',
        comments: '',
        task_zone: activeZone
    });
    const [selectedDesigners, setSelectedDesigners] = useState<DesignerOption[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const designerOptions: DesignerOption[] = useMemo(() =>
        usersList.map(u => ({ label: u.full_name || u.name, value: u.name, email: u.email || '' }))
        , [usersList]);

    // Update task_zone when activeZone changes or modal opens
    React.useEffect(() => {
        if (!isOpen) {
            setTaskState({
                task_name: '',
                design_category: initialCategoryName,
                deadline: '',
                task_status: 'Not Started',
                task_zone: activeZone,
            });
            setSelectedDesigners([]);
        } else {
            // Set zone from activeZone prop when modal opens
            setTaskState(prev => ({
                ...prev,
                task_zone: activeZone,
                design_category: prev.design_category || initialCategoryName
            }));
        }
    }, [isOpen, activeZone, categories, initialCategoryName]);

    const handleSave = async () => {
        if (!taskState.task_name || !taskState.design_category) {
            toast({ title: "Error", description: "Task Name and Category are required.", variant: "destructive" });
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

        const structuredDataForServer = { list: assignedDesignerDetails };
        const assigned_designers_string = JSON.stringify(structuredDataForServer);

        const newTaskPayload: Partial<DesignTrackerTask> = {
            ...taskState,
            task_zone: activeZone, // Ensure zone is set from prop
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
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-base font-semibold">Create Task</DialogTitle>
                </DialogHeader>

                <div className="space-y-3 py-2">
                    {/* Zone Display (Read-only) */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-md border border-gray-200">
                        <span className="text-xs text-gray-500">Creating task in zone:</span>
                        <Badge className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 border border-blue-200">
                            {activeZone}
                        </Badge>
                    </div>

                    {/* Category */}
                    <div className="space-y-1">
                        <Label htmlFor="category" className="text-xs font-medium">Category *</Label>
                        <ReactSelect
                            options={categories}
                            value={categories.find((c: any) => c.value === taskState.design_category) || null}
                            onChange={(option: any) => setTaskState(prev => ({ ...prev, design_category: option ? option.value : '' }))}
                            classNamePrefix="react-select"
                            styles={{
                                control: (base) => ({ ...base, minHeight: '36px', fontSize: '14px' }),
                                option: (base) => ({ ...base, fontSize: '14px' })
                            }}
                        />
                    </div>

                    {/* Task Name */}
                    <div className="space-y-1">
                        <Label htmlFor="task_name" className="text-xs font-medium">Task Name *</Label>
                        <Input
                            id="task_name"
                            value={taskState.task_name}
                            onChange={(e) => setTaskState(prev => ({ ...prev, task_name: e.target.value }))}
                            placeholder="Enter task name..."
                            className="h-9"
                            required
                        />
                    </div>

                    {/* Assign Designers */}
                    <div className="space-y-1">
                        <Label htmlFor="designer" className="text-xs font-medium">Assign Designer(s)</Label>
                        <ReactSelect
                            isMulti
                            value={selectedDesigners}
                            options={designerOptions}
                            onChange={(newValue) => setSelectedDesigners(newValue as DesignerOption[])}
                            placeholder="Select designers..."
                            classNamePrefix="react-select"
                            styles={{
                                control: (base) => ({ ...base, minHeight: '36px', fontSize: '14px' }),
                                option: (base) => ({ ...base, fontSize: '14px' })
                            }}
                        />
                    </div>

                    {/* Deadline & File Link in 2 columns */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label htmlFor="deadline" className="text-xs font-medium">Deadline</Label>
                            <Input
                                id="deadline"
                                type="date"
                                value={taskState.deadline || ''}
                                onChange={(e) => setTaskState(prev => ({ ...prev, deadline: e.target.value }))}
                                className="h-9"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="file_link" className="text-xs font-medium">File Link</Label>
                            <Input
                                id="file_link"
                                type="url"
                                value={taskState.file_link || ''}
                                onChange={(e) => setTaskState(prev => ({ ...prev, file_link: e.target.value }))}
                                placeholder="https://..."
                                className="h-9"
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <DialogClose asChild>
                        <Button variant="outline" size="sm" disabled={isSaving}>Cancel</Button>
                    </DialogClose>
                    <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={isSaving || !taskState.task_name || !taskState.design_category}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {isSaving ? <TailSpin width={16} height={16} color="white" /> : 'Create Task'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// --- Add Category Modal ---
interface AddCategoryModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    availableCategories: CategoryItem[];
    onAdd: (newTasks: Partial<DesignTrackerTask>[]) => Promise<void>;
}

const AddCategoryModal: React.FC<AddCategoryModalProps> = ({
    isOpen, onOpenChange, availableCategories, onAdd
}) => {
    const [selectedCategories, setSelectedCategories] = useState<CategoryItem[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const { id: trackerId } = useParams<{ id: string }>();
    const { trackerDoc } = useDesignTrackerLogic({ trackerId: trackerId! });

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
        const existingZones = trackerDoc?.zone && trackerDoc.zone.length > 0
            ? trackerDoc.zone.map(z => z.tracker_zone)
            : [undefined];

        selectedCategories.forEach(cat => {
            const taskItems = cat.tasks;
            existingZones.forEach(zoneName => {
                taskItems.forEach(taskDef => {
                    let calculatedDeadline: string | undefined = undefined;
                    if (taskDef.deadline_offset !== undefined && taskDef.deadline_offset !== null) {
                        const baseDate = trackerDoc?.start_date ? new Date(trackerDoc.start_date) : new Date();
                        const d = new Date(baseDate);
                        d.setDate(baseDate.getDate() + Number(taskDef.deadline_offset));
                        calculatedDeadline = d.toISOString().split('T')[0];
                    }

                    tasksToGenerate.push({
                        task_name: taskDef.task_name,
                        design_category: cat.category_name,
                        task_status: 'Not Started',
                        deadline: calculatedDeadline,
                        task_zone: zoneName,
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

    // Calculate total tasks that will be created
    const existingZonesCount = trackerDoc?.zone?.length || 1;
    const totalTasksToCreate = selectedCategories.reduce(
        (sum, cat) => sum + (cat.tasks?.length || 0), 0
    ) * existingZonesCount;

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-base font-semibold">Add Categories</DialogTitle>
                    <p className="text-xs text-gray-500">
                        Select categories to add. Tasks will be generated for all {existingZonesCount} zone{existingZonesCount !== 1 ? 's' : ''}.
                    </p>
                </DialogHeader>

                <div className="space-y-3 py-2">
                    {/* Section Header */}
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                            Available Categories
                        </span>
                        <span className="text-[10px] text-gray-400">
                            {availableCategories.length} available
                        </span>
                    </div>

                    {/* Category Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto p-1">
                        {availableCategories.length === 0 ? (
                            <p className="col-span-3 text-center text-gray-500 py-4 text-xs">
                                All categories are already active.
                            </p>
                        ) : (
                            availableCategories.map(cat => {
                                const isSelected = selectedCategories.some(c => c.category_name === cat.category_name);
                                const taskCount = cat.tasks?.length || 0;
                                return (
                                    <Button
                                        key={cat.category_name}
                                        type="button"
                                        variant={isSelected ? "default" : "outline"}
                                        onClick={() => handleCategoryToggle(cat)}
                                        disabled={isSaving}
                                        size="sm"
                                        className={`h-auto py-2 px-2.5 text-xs whitespace-normal min-h-[44px] justify-start text-left relative ${
                                            isSelected ? 'bg-red-600 hover:bg-red-700' : ''
                                        }`}
                                    >
                                        <div className="flex flex-col gap-0.5 w-full">
                                            <span className="truncate font-medium">{cat.category_name}</span>
                                            <span className={`text-[10px] ${isSelected ? 'text-red-100' : 'text-gray-400'}`}>
                                                ({taskCount} task{taskCount !== 1 ? 's' : ''})
                                            </span>
                                        </div>
                                        {isSelected && (
                                            <Check className="absolute top-1 right-1 h-3 w-3 text-white" />
                                        )}
                                    </Button>
                                );
                            })
                        )}
                    </div>

                    {/* Selection Summary */}
                    {selectedCategories.length > 0 && (
                        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-md border border-gray-200">
                            <span className="text-xs text-gray-600">
                                <span className="font-medium text-gray-900">{selectedCategories.length}</span> categor{selectedCategories.length !== 1 ? 'ies' : 'y'} selected
                            </span>
                            <span className="text-xs text-gray-500">
                                {totalTasksToCreate} task{totalTasksToCreate !== 1 ? 's' : ''} will be created
                            </span>
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <DialogClose asChild>
                        <Button variant="outline" size="sm" disabled={isSaving}>Cancel</Button>
                    </DialogClose>
                    <Button
                        size="sm"
                        onClick={handleConfirm}
                        disabled={selectedCategories.length === 0 || isSaving}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {isSaving ? <TailSpin width={16} height={16} color="white" /> : 'Add Categories'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

// --- Add Zone Modal ---
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
                    <DialogTitle className="text-base font-semibold">Add Zones</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Section 1: Current Zones */}
                    <div className="space-y-2">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                            Current Zones
                        </span>
                        <div className="flex flex-wrap gap-1.5 p-2 bg-gray-50 rounded-md border border-gray-200 min-h-[36px]">
                            {existingZones.length === 0 ? (
                                <span className="text-xs text-gray-400">No zones yet</span>
                            ) : (
                                existingZones.map(zone => (
                                    <Badge
                                        key={zone}
                                        variant="secondary"
                                        className="px-2 py-0.5 text-[11px] bg-gray-100 text-gray-600 border border-gray-200"
                                    >
                                        {zone}
                                    </Badge>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Section 2: Add New Zones */}
                    <div className="space-y-2">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                            Add New Zones
                        </span>
                        <div className="flex gap-2">
                            <Input
                                placeholder="Enter zone name..."
                                value={zoneInput}
                                onChange={(e) => setZoneInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="h-8 text-sm"
                            />
                            <Button
                                type="button"
                                onClick={addZone}
                                variant="outline"
                                size="sm"
                                className="h-8 px-3"
                            >
                                <Plus className="h-3 w-3 mr-1" /> Add
                            </Button>
                        </div>
                        {zones.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                <span className="text-[10px] text-gray-400 mr-1">Pending:</span>
                                {zones.map(zone => (
                                    <Badge
                                        key={zone}
                                        variant="secondary"
                                        className="px-2 py-0.5 text-[11px] bg-blue-50 text-blue-700 border border-blue-200 gap-1"
                                    >
                                        {zone}
                                        <X
                                            className="h-3 w-3 cursor-pointer hover:text-red-500"
                                            onClick={() => removeZone(zone)}
                                        />
                                    </Badge>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Section 3: Preview */}
                    {zones.length > 0 && (
                        <div className="space-y-2">
                            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                                Preview
                            </span>
                            <div className="p-2 bg-gray-50 rounded-md border border-gray-200">
                                <p className="text-[10px] text-gray-500 mb-2">Zone layout after adding:</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {existingZones.map(zone => (
                                        <Badge
                                            key={zone}
                                            variant="secondary"
                                            className="px-2 py-0.5 text-[11px] bg-gray-100 text-gray-600 border border-gray-200"
                                        >
                                            {zone}
                                        </Badge>
                                    ))}
                                    {zones.map(zone => (
                                        <Badge
                                            key={zone}
                                            variant="secondary"
                                            className="px-2 py-0.5 text-[11px] bg-blue-100 text-blue-700 border border-blue-300 font-medium"
                                        >
                                            {zone}
                                            <span className="text-[9px] ml-0.5 text-blue-500">new</span>
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Info Note */}
                    <div className="flex items-start gap-2 px-2 py-1.5 bg-blue-50/50 rounded border border-blue-100">
                        <Info className="h-3.5 w-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                        <p className="text-[11px] text-blue-700">
                            Tasks for all active categories will be generated for each new zone.
                        </p>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <DialogClose asChild>
                        <Button variant="outline" size="sm" disabled={isSaving}>Cancel</Button>
                    </DialogClose>
                    <Button
                        size="sm"
                        onClick={handleConfirm}
                        disabled={isSaving || zones.length === 0}
                        className="bg-red-600 hover:bg-red-700"
                    >
                        {isSaving ? <TailSpin width={16} height={16} color="white" /> : `Add ${zones.length} Zone${zones.length !== 1 ? 's' : ''}`}
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

export const ProjectDesignTrackerDetailV2: React.FC<ProjectDesignTrackerDetailProps> = ({ trackerId: propTrackerId }) => {
    const { role, user_id } = useUserData();
    const isDesignExecutive = role === "Nirmaan Design Executive Profile";
    const isProjectManager = role === "Nirmaan Project Manager Profile";
    const hasEditStructureAccess = role === "Nirmaan Design Lead Profile" || role === "Nirmaan Admin Profile" || role === "Nirmaan PMO Executive Profile" || user_id === "Administrator";

    const checkIfUserAssigned = useCallback((task: DesignTrackerTask) => {
        const designerField = task.assigned_designers;
        if (!designerField) return false;

        let designers: AssignedDesignerDetail[] = [];
        if (designerField && typeof designerField === 'object' && Array.isArray((designerField as any).list)) {
            designers = (designerField as any).list;
        } else if (Array.isArray(designerField)) {
            designers = designerField as any;
        } else if (typeof designerField === 'string' && designerField.trim() !== '') {
            try {
                const parsed = JSON.parse(designerField);
                if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list)) {
                    designers = parsed.list;
                } else if (Array.isArray(parsed)) {
                    designers = parsed;
                }
            } catch (e) { }
        }
        return designers.some(d => d.userId === user_id);
    }, [user_id]);

    const { id: paramTrackerId } = useParams<{ id: string }>();
    const trackerId = propTrackerId || paramTrackerId;

    const {
        trackerDoc, categoryData, isLoading, error, handleTaskSave, editingTask, setEditingTask, usersList, handleParentDocSave, statusOptions,
        subStatusOptions,
        handleNewTaskCreation
    } = useDesignTrackerLogic({ trackerId: trackerId! });

    const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
    const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
    const [isAddZoneModalOpen, setIsAddZoneModalOpen] = useState(false);
    const [isProjectOverviewModalOpen, setIsProjectOverviewModalOpen] = useState(false);

    // Rename Modal State
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [zoneToRename, setZoneToRename] = useState("");

    // Zone Tab State
    const [activeTab, setActiveTab] = useState<string>("");

    // --- DataTable State ---
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSearchField, setSelectedSearchField] = useState("task_name");
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'deadline', desc: false }]);
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });

    // Extract Unique Zones from Tracker Doc
    const uniqueZones = useMemo(() => {
        if (trackerDoc?.zone && trackerDoc.zone.length > 0) {
            return trackerDoc.zone.map(z => z.tracker_zone);
        }
        if (trackerDoc?.design_tracker_task) {
            const zonesFromTasks = new Set(trackerDoc.design_tracker_task.map(t => t.task_zone).filter(Boolean));
            return Array.from(zonesFromTasks);
        }
        return [];
    }, [trackerDoc]);

    // Task count per zone (includes all tasks)
    const taskCountByZone = useMemo(() => {
        if (!trackerDoc?.design_tracker_task) return new Map<string, number>();

        const countMap = new Map<string, number>();
        trackerDoc.design_tracker_task.forEach(task => {
            const zone = task.task_zone || '';
            countMap.set(zone, (countMap.get(zone) || 0) + 1);
        });
        return countMap;
    }, [trackerDoc?.design_tracker_task]);

    // Set initial active tab when zones load
    React.useEffect(() => {
        if (uniqueZones.length > 0 && !activeTab) {
            setActiveTab(uniqueZones[0] || "");
        }
    }, [uniqueZones, activeTab]);

    // Flatten tasks from tracker document (filter by active zone tab)
    const flattenedTasks = useMemo(() => {
        if (!trackerDoc?.design_tracker_task) return [];
        let tasks = [...trackerDoc.design_tracker_task];

        // Filter by active zone tab
        if (activeTab) {
            tasks = tasks.filter(t => t.task_zone === activeTab);
        }

        return tasks;
    }, [trackerDoc?.design_tracker_task, activeTab]);

    // Active categories in tracker
    const activeCategoriesInTracker = useMemo(() => {
        if (!trackerDoc?.design_tracker_task || !categoryData) return [];

        const uniqueCategoryNames = new Set(
            trackerDoc.design_tracker_task.map(t => t.design_category)
        );

        const filteredCategories = categoryData.filter(masterCat =>
            uniqueCategoryNames.has(masterCat.category_name)
        );

        const othersCategory: CategoryItem = {
            category_name: "Others",
            tasks: [],
        };

        let resultList = filteredCategories;

        if (!uniqueCategoryNames.has("Others")) {
            resultList = [...filteredCategories, othersCategory];
        }

        return resultList.map(cat => ({
            label: cat.category_name,
            value: cat.category_name,
            ...cat
        }));
    }, [trackerDoc?.design_tracker_task, categoryData]);

    // Categories available to be ADDED
    const availableNewCategories: CategoryItem[] = useMemo(() => {
        if (!trackerDoc?.design_tracker_task || !categoryData) return [];

        const activeCategoryNames = new Set(
            trackerDoc.design_tracker_task.map(t => t.design_category)
        );

        return categoryData.filter(masterCat =>
            !activeCategoryNames.has(masterCat.category_name) &&
            masterCat.category_name !== "Others" &&
            Array.isArray(masterCat.tasks) &&
            masterCat.tasks.length > 0
        );
    }, [trackerDoc?.design_tracker_task, categoryData]);

    // --- Faceted Filter Options (Zone is handled by tabs, not filter) ---
    const facetFilterOptions = useMemo(() => ({
        design_category: {
            title: "Category",
            options: activeCategoriesInTracker.map(c => ({ label: c.category_name, value: c.category_name })),
        },
        task_status: {
            title: "Status",
            options: statusOptions || [],
        },
        task_sub_status: {
            title: "Sub-Status",
            options: subStatusOptions || [],
        },
    }), [activeCategoriesInTracker, statusOptions, subStatusOptions]);

    // Search field options
    const searchFieldOptions = [
        { value: "task_name", label: "Task Name", default: true },
        { value: "design_category", label: "Category" },
    ];

    // Column definitions
    const columns = useMemo(
        () => getTaskTableColumns(setEditingTask, isDesignExecutive, isProjectManager, checkIfUserAssigned),
        [isDesignExecutive, isProjectManager, checkIfUserAssigned]
    );

    // Client-side TanStack Table instance
    const table = useReactTable({
        data: flattenedTasks,
        columns,
        state: {
            columnFilters,
            sorting,
            pagination,
            globalFilter: searchTerm,
        },
        onColumnFiltersChange: setColumnFilters,
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        onGlobalFilterChange: setSearchTerm,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        globalFilterFn: (row, _columnId, filterValue) => {
            const searchValue = filterValue.toLowerCase();
            const fieldValue = row.getValue(selectedSearchField);
            if (typeof fieldValue === 'string') {
                return fieldValue.toLowerCase().includes(searchValue);
            }
            return false;
        },
    });

    // --- Action Handlers ---
    const handleAddCategories = async (newTasks: Partial<DesignTrackerTask>[]) => {
        if (!trackerDoc) return;
        const updatedTasks = [...(trackerDoc.design_tracker_task || []), ...newTasks as DesignTrackerTask[]];
        await handleParentDocSave({ design_tracker_task: updatedTasks });
    };

    const handleAddZone = async ({ zones }: { zones: string[] }) => {
        if (!trackerDoc) return;

        const activeCategoryNamesInTracker = new Set(trackerDoc.design_tracker_task?.map(t => t.design_category) || []);
        const catsToPopulate = categoryData.filter(cat =>
            activeCategoryNamesInTracker.has(cat.category_name) &&
            Array.isArray(cat.tasks) &&
            cat.tasks.length > 0
        );

        const newTasks: Partial<DesignTrackerTask>[] = [];

        zones.forEach(zoneName => {
            catsToPopulate.forEach(cat => {
                cat.tasks.forEach(taskDef => {
                    let calculatedDeadline: string | undefined = undefined;
                    if (taskDef.deadline_offset !== undefined && taskDef.deadline_offset !== null) {
                        const baseDate = trackerDoc?.start_date ? new Date(trackerDoc.start_date) : new Date();
                        const d = new Date(baseDate);
                        d.setDate(baseDate.getDate() + Number(taskDef.deadline_offset));
                        calculatedDeadline = d.toISOString().split('T')[0];
                    }

                    newTasks.push({
                        task_name: taskDef.task_name,
                        design_category: cat.category_name,
                        task_status: 'Not Started',
                        deadline: calculatedDeadline,
                        task_zone: zoneName,
                    });
                });
            });
        });

        const existingZoneRows = trackerDoc.zone || [];
        const newZoneRows = zones.map(z => ({ tracker_zone: z }));
        const updatedZoneTable = [...existingZoneRows, ...newZoneRows];
        const currentTasks = trackerDoc.design_tracker_task || [];
        const updatedTaskTable = [...currentTasks, ...newTasks as DesignTrackerTask[]];

        try {
            await handleParentDocSave({
                zone: updatedZoneTable,
                design_tracker_task: updatedTaskTable
            });
            toast({ title: "Success", description: `${zones.length} new zone(s) added.`, variant: "success" });
            setIsAddZoneModalOpen(false);
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Failed to add zone(s).", variant: "destructive" });
            throw e;
        }
    };

    const handleRenameZone = (currentZoneName?: string) => {
        setZoneToRename(currentZoneName || "");
        setIsRenameModalOpen(true);
    };

    const handleDownloadReport = async (zoneName?: string) => {
        const printFormatName = "Project Design Tracker";
        const params = new URLSearchParams({
            doctype: DOCTYPE,
            name: trackerId!,
            format: printFormatName,
            no_letterhead: "0",
            _lang: "en",
        });

        if (zoneName) {
            params.append("zone", zoneName);
        }

        const downloadUrl = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;

        try {
            toast({ title: "Generating PDF...", description: "Please wait while we generate your report." });

            const response = await fetch(downloadUrl);
            if (!response.ok) throw new Error('PDF generation failed.');

            const blob = await response.blob();

            const now = new Date();
            const dateStr = format(now, "dd_MMM_yyyy");
            const projectNameClean = (trackerDoc?.project_name || "Project").replace(/[^a-zA-Z0-9-_]/g, "_");

            let filename = `${projectNameClean}-${dateStr}-DesignTracker`;
            if (zoneName) {
                filename += `-${zoneName.replace(/[^a-zA-Z0-9-_]/g, "_")}`;
            }
            filename += ".pdf";

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

    // --- Inline Task Save Handler ---
    const inlineTaskSaveHandler = async (updatedFields: { [key: string]: any }) => {
        if (!editingTask) return;

        let fieldsToSend: { [key: string]: any } = { ...updatedFields };

        if (Array.isArray(updatedFields.assigned_designers)) {
            const structuredDataForServer = {
                list: updatedFields.assigned_designers
            };
            fieldsToSend.assigned_designers = JSON.stringify(structuredDataForServer);
        }

        await handleTaskSave(editingTask.name, fieldsToSend);
    };

    if (isLoading) return <LoadingFallback />;
    if (error || !trackerDoc) return <AlertDestructive error={error} />;

    return (
        <div className="flex-1 md:p-4">
            {/* ═══════════════════════════════════════════════════════════════
                ROW 1: PROJECT CONTEXT BAR - Compact header with meta info
            ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 md:px-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    {/* Left: Project name + meta info */}
                    <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                                Design Tracker
                            </span>
                            <h1 className="text-lg font-semibold text-gray-900 truncate max-w-[300px]">
                                {trackerDoc.project_name}
                            </h1>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:gap-3 text-xs">
                            {/* Start Date Pill */}
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 rounded border border-gray-200">
                                <span className="text-gray-500">Start:</span>
                                <span className="font-medium text-gray-700">{formatDeadlineShort(trackerDoc.start_date || '')}</span>
                            </div>
                            {/* Deadline Pill */}
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-red-50 rounded border border-red-200">
                                <span className="text-gray-500">Deadline:</span>
                                <span className="font-semibold text-red-700">{formatDeadlineShort(trackerDoc.overall_deadline || '')}</span>
                                {!isDesignExecutive && !isProjectManager && (
                                    <Edit
                                        className="h-3 w-3 text-red-400 hover:text-red-600 cursor-pointer"
                                        onClick={() => setIsProjectOverviewModalOpen(true)}
                                    />
                                )}
                            </div>
                            {/* Zones Count Pill */}
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 rounded border border-gray-200">
                                <span className="text-gray-500">Zones:</span>
                                <span className="font-medium text-gray-700">{uniqueZones.length}</span>
                            </div>
                        </div>
                    </div>

                    {/* Right: Action buttons */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {hasEditStructureAccess && !isProjectManager && (
                            <>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs gap-1"
                                    onClick={() => setIsAddCategoryModalOpen(true)}
                                    disabled={availableNewCategories.length === 0}
                                >
                                    <Plus className="h-3 w-3" /> Category
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs gap-1"
                                    onClick={() => setIsAddZoneModalOpen(true)}
                                >
                                    <Plus className="h-3 w-3" /> Zone
                                </Button>
                            </>
                        )}
                        <TooltipProvider>
                            <Tooltip delayDuration={200}>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="default"
                                        size="sm"
                                        className="h-8 text-xs gap-1 bg-red-600 hover:bg-red-700"
                                        onClick={() => handleDownloadReport()}
                                    >
                                        <Download className="h-3 w-3" /> Download Tracker
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs">
                                    Download Design Tracker for all zones
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                ROW 2: ZONE NAVIGATION BAR - Zone tabs + task actions
            ═══════════════════════════════════════════════════════════════ */}
            {uniqueZones.length > 0 && (
                <div className="bg-gray-50/70 border-b border-gray-200 px-4 py-2 md:px-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                        {/* Zone Tabs */}
                        <div className="flex items-center gap-2 overflow-x-auto">
                            <span className="text-xs font-medium text-gray-500 hidden md:block">Zone:</span>
                            <div className="flex rounded-md border border-gray-300 overflow-hidden">
                                {uniqueZones.map(zone => {
                                    const taskCount = taskCountByZone.get(zone!) || 0;
                                    const isActive = activeTab === zone;
                                    return (
                                        <button
                                            key={zone}
                                            className={`px-2.5 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                                                isActive
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-white text-blue-600 hover:bg-blue-50'
                                            }`}
                                            onClick={() => setActiveTab(zone!)}
                                        >
                                            <span>{zone}</span>
                                            <Badge
                                                variant="secondary"
                                                className={`px-1 py-0 text-[10px] min-w-[18px] justify-center rounded-full ${
                                                    isActive
                                                        ? 'bg-white/25 text-white'
                                                        : 'bg-blue-100 text-blue-700'
                                                }`}
                                            >
                                                {taskCount}
                                            </Badge>
                                            {hasEditStructureAccess && !isProjectManager && (
                                                <Edit
                                                    className={`w-2.5 h-2.5 cursor-pointer ${
                                                        isActive ? 'text-white/70 hover:text-white' : 'text-blue-400 hover:text-blue-700'
                                                    }`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRenameZone(zone!);
                                                    }}
                                                />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Right: Create Task + Export Zone */}
                        <div className="flex items-center gap-2">
                            {!isDesignExecutive && !isProjectManager && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs gap-1"
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
                                    <Plus className="h-3 w-3" /> Create Task
                                </Button>
                            )}
                            {activeTab && (
                                <TooltipProvider>
                                    <Tooltip delayDuration={200}>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs gap-1 text-red-700 border-red-200 hover:bg-red-50"
                                                onClick={() => handleDownloadReport(activeTab)}
                                            >
                                                <Download className="h-3 w-3" /> {activeTab}
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" className="text-xs">
                                            Download Design Tracker for {activeTab}
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════
                DATA TABLE
            ═══════════════════════════════════════════════════════════════ */}
            <div className="p-4 md:px-6 overflow-x-auto">
                {/* DataTable for active zone */}
                <DataTable<DesignTrackerTask>
                    table={table}
                    columns={columns}
                    isLoading={isLoading}
                    error={error}
                    totalCount={table.getFilteredRowModel().rows.length}
                    searchFieldOptions={searchFieldOptions}
                    selectedSearchField={selectedSearchField}
                    onSelectedSearchFieldChange={setSelectedSearchField}
                    searchTerm={searchTerm}
                    onSearchTermChange={setSearchTerm}
                    facetFilterOptions={facetFilterOptions}
                    dateFilterColumns={TASK_DATE_COLUMNS}
                    showExportButton={true}
                    exportFileName={`${trackerDoc.project_name.replace(/[^a-zA-Z0-9]/g, '_')}_${activeTab || 'All'}_Tasks`}
                    onExport="default"
                    tableHeight="60vh"
                />
            </div>

            {/* --- MODALS --- */}
            <RenameZoneDialog
                isOpen={isRenameModalOpen}
                onClose={() => setIsRenameModalOpen(false)}
                trackerId={trackerId!}
                initialZone={zoneToRename}
                onSuccess={() => {
                    window.location.reload();
                }}
            />

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

            {activeCategoriesInTracker.length > 0 && activeTab && (
                <NewTaskModal
                    isOpen={isNewTaskModalOpen}
                    onOpenChange={setIsNewTaskModalOpen}
                    onAdd={handleNewTaskCreation}
                    usersList={usersList || []}
                    statusOptions={statusOptions}
                    categories={activeCategoriesInTracker}
                    existingTaskNames={getExistingTaskNames(trackerDoc)}
                    activeZone={activeTab}
                />
            )}

            <AddCategoryModal
                isOpen={isAddCategoryModalOpen}
                onOpenChange={setIsAddCategoryModalOpen}
                availableCategories={availableNewCategories}
                onAdd={handleAddCategories}
            />

            <AddZoneModal
                isOpen={isAddZoneModalOpen}
                onOpenChange={setIsAddZoneModalOpen}
                onAdd={handleAddZone}
                existingZones={uniqueZones}
            />

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

export default ProjectDesignTrackerDetailV2;
