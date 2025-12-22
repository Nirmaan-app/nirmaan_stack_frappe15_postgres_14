import React, { useMemo, useState, useCallback, useEffect } from "react";
import { addDays, format } from "date-fns";
import { Link, useNavigate } from "react-router-dom";
import { useFrappeCreateDoc, useFrappeGetDocList, useFrappeGetCall } from "frappe-react-sdk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp, Search, Filter, CirclePlus, Link as LinkIcon, MessageCircle, Edit, ArrowUpRight, Check } from "lucide-react";
import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ReactSelect from 'react-select';

// New Imports for Facet Filter
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { cn } from "@/lib/utils";

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
import { TaskEditModal } from './components/TaskEditModal';
import { TaskWiseTable } from "./components/TaskWiseTable";
import {formatDeadlineShort, getStatusBadgeStyle,getTaskStatusStyle, getTaskSubStatusStyle,getAssignedNameForDisplay ,getExistingTaskNames} from "./utils";
import { DesignPackagesMaster } from "./components/DesignPackagesmaster";
import { ProjectWiseCard } from "./components/ProjectWiseCard";
import {useUserData} from "@/hooks/useUserData";

const DOCTYPE = 'Project Design Tracker';
const FE_TASK_STATUS_OPTIONS = ["Todo", "In Progress", "Done", "Blocked", "On Hold", "Submitted"];

const DESIGN_TABS = { 
    PROJECT_WISE: 'project', 
    TASK_WISE: 'task' 
};


const NewTrackerModal: React.FC<any> = ({ isOpen, onClose, projectOptions, categoryData, onSuccess }) => {
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    
    // Zone State
    const [zones, setZones] = useState<string[]>([]);
    const [currentZoneInput, setCurrentZoneInput] = useState("");
    const [isManualZone, setIsManualZone] = useState<boolean | null>(null); // null = not selected, true = yes, false = no

    const { createDoc, loading: createLoading } = useFrappeCreateDoc();

    const visibleCategories = useMemo(() => {
        if (!categoryData) return [];
        return categoryData.filter((cat: any) => Array.isArray(cat.tasks) && cat.tasks.length > 0);
    }, [categoryData]);

    const handleCategoryToggle = (categoryName: string) => {
        setSelectedCategories(prev => prev.includes(categoryName) ? prev.filter(c => c !== categoryName) : [...prev, categoryName])
    };

    const handleManualZoneChange = (value: string) => {
        const isManual = value === "yes";
        setIsManualZone(isManual);
        
        if (isManual) {
            // Reset to empty to allow manual entry
            setZones([]);
        } else {
            // Set to default zone
            setZones(["Default"]);
        }
        setCurrentZoneInput("");
    };

    const handleAddZone = () => {
        if (currentZoneInput.trim()) {
            // Validation: Alphanumeric only
            const trimmed = currentZoneInput.trim();
             const isValidFormat = /^[a-zA-Z0-9 ]+$/.test(trimmed);
            if (!isValidFormat) {
                toast({ title: "Invalid Format", description: "Zone name must contain only letters and numbers.", variant: "destructive" });
                return;
            }

            // Duplicate Check (Case Insensitive)
            const isDuplicate = zones.some(z => z.toLowerCase() === trimmed.toLowerCase());
            
            if (isDuplicate) {
                toast({ title: "Duplicate Zone", description: "This zone name already exists.", variant: "destructive" });
                return;
            }

            setZones([...zones, trimmed]);
            setCurrentZoneInput("");
        }
    };

    const handleRemoveZone = (zoneToRemove: string) => {
        setZones(zones.filter(z => z !== zoneToRemove));
    };

    const handleConfirm = async () => {
        if (!selectedProjectId || selectedCategories.length === 0) {
            toast({ title: "Error", description: "Select project and at least one category.", variant: "destructive" });
            return;
        }

        if (zones.length === 0) {
            toast({ title: "Error", description: "Please add at least one Zone.", variant: "destructive" });
            return;
        }

        const projectLabel = projectOptions.find(p => p.value === selectedProjectId)?.label;
        if (!projectLabel) return;

        const tasksToGenerate: Partial<DesignTrackerTask>[] = [];

        // Loop through Zones first (or tasks, order doesn't strictly matter for DB, but logical for UI)
        zones.forEach(zoneName => {
            selectedCategories.forEach(catName => {
                const categoryDef = categoryData.find(c => c.category_name === catName);

                if (categoryDef && Array.isArray(categoryDef.tasks) && categoryDef.tasks.length > 0) {
                    const taskItems = categoryDef.tasks;

                    taskItems.forEach(taskDef => {
                        const taskName = taskDef.task_name;
                        let calculatedDeadline = undefined;
                        if (taskDef.deadline_offset !== undefined && taskDef.deadline_offset !== null) {
                             const offset = Number(taskDef.deadline_offset);
                             if (!isNaN(offset)) {
                                 calculatedDeadline = format(addDays(new Date(), offset), 'yyyy-MM-dd');
                             }
                        }

                        tasksToGenerate.push({
                            task_name: taskName,
                            design_category: catName,
                            task_status: 'Not Started',
                            deadline: calculatedDeadline,
                            task_zone: zoneName // Set the Zone
                        })
                    });
                }
            });
        });

        if (tasksToGenerate.length === 0) {
            toast({ title: "Error", description: "No tasks could be generated from selected categories.", variant: "destructive" });
            return;
        }

        // Prepare Zone Child Table Data
        const zoneChildTableData = zones.map(z => ({ tracker_zone: z }));

        try {
            await createDoc(DOCTYPE, {
                project: selectedProjectId,
                project_name: projectLabel,
                status: 'Assign Pending',
                design_tracker_task: tasksToGenerate,
                zone: zoneChildTableData // Send Zones to backend
            });
            toast({ title: "Success", description: `Design Tracker created for ${projectLabel}.`, variant: "success" });
            
            // Reset State
            setSelectedProjectId(null);
            setSelectedCategories([]);
            setZones([]);
            setCurrentZoneInput("");
            setIsManualZone(null);
            
            onSuccess();
            onClose();
        } catch (error: any) {
            toast({ title: "Creation Failed", description: error.message || "Failed to create tracker.", variant: "destructive" })
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={onClose}>
            <AlertDialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-center">Create Design Tracker</AlertDialogTitle>
                </AlertDialogHeader>
                <div className="space-y-6 py-2">
                    {/* Step 1: Project Selection */}
                     <div className="space-y-2">
                        <Label>Step 1: Select Project *</Label>
                        <ReactSelect
                            options={projectOptions}
                            value={projectOptions.find((p: any) => p.value === selectedProjectId) || null}
                            onChange={(option: any) => setSelectedProjectId(option ? option.value : null)}
                            classNamePrefix="react-select"
                            menuPosition={'auto'} 
                            placeholder="Search Project..."
                        />
                    </div>

                    {/* Step 2: Zone Selection */}
                    <div className="space-y-3">
                        <Label>Step 2: Add Zones *</Label>
                        
                        <div className="space-y-2">
                             <Label className="text-sm font-normal text-muted-foreground">Do you want to setup manual zones for this Project?</Label>
                             <div className="flex gap-4">
                                <div className="flex items-center space-x-2">
                                    <input 
                                        type="radio" 
                                        id="r-yes" 
                                        name="manual-zones" 
                                        value="yes" 
                                        checked={isManualZone === true}
                                        onChange={() => handleManualZoneChange('yes')}
                                        className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                    />
                                    <Label htmlFor="r-yes">Yes</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <input 
                                        type="radio" 
                                        id="r-no" 
                                        name="manual-zones" 
                                        value="no" 
                                        checked={isManualZone === false}
                                        onChange={() => handleManualZoneChange('no')}
                                        className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                    />
                                    <Label htmlFor="r-no">No</Label>
                                </div>
                             </div>
                        </div>

                        {/* Input Box - Only show if Manual is Yes */}
                        {isManualZone === true && (
                            <div className="flex gap-2">
                                <Input 
                                    value={currentZoneInput}
                                    onChange={(e) => setCurrentZoneInput(e.target.value)}
                                    placeholder="Enter Zone Name (e.g. Tower A)"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleAddZone();
                                        }
                                    }}
                                />
                                <Button type="button" onClick={handleAddZone} variant="secondary">Add</Button>
                            </div>
                        )}

                        {/* Zone List Display */}
                        <div className="flex flex-wrap gap-2 min-h-[40px] items-center">
                            {zones.length === 0 && <span className="text-gray-400 text-sm italic">No zones selected.</span>}
                             
                            {zones.map((zone) => (
                                <Badge key={zone} variant="secondary" className="px-3 py-1 text-sm bg-white border shadow-sm">
                                    {zone}
                                    {isManualZone && (
                                        <button onClick={() => handleRemoveZone(zone)} className="ml-2 text-gray-400 hover:text-red-500">
                                            ×
                                        </button>
                                    )}
                                </Badge>
                            ))}
                        </div>
                    </div>


                    {/* Step 3: Category Selection */}
                    <div className="space-y-2">
                        <Label>Step 3: Choose Categories</Label>
                        
                        {visibleCategories.length > 0 ? (
                            <div className="grid grid-cols-3 gap-2">
                                {visibleCategories.map((cat: any) => (
                                    <Button
                                        key={cat.category_name}
                                        variant={selectedCategories.includes(cat.category_name) ? "default" : "outline"}
                                        onClick={() => handleCategoryToggle(cat.category_name)}
                                        size="sm"
                                        className="text-xs h-auto py-2 whitespace-normal h-full min-h-[40px]"
                                    >
                                        {cat.category_name}
                                    </Button>
                                ))}
                            </div>
                        ) : (
                            <div className="p-4 text-center text-sm text-gray-500 bg-gray-50 rounded-md">
                                No categories available with defined tasks.
                            </div>
                        )}
                    </div>
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={createLoading} onClick={onClose}> Cancel</AlertDialogCancel>
                    <Button
                        onClick={handleConfirm}
                        disabled={!selectedProjectId || selectedCategories.length === 0 || zones.length === 0 || createLoading}
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
    user_id: string; // Recieve from parent
    isDesignExecutive: boolean; // Receive from parent
}

const ExpandedProjectTasks: React.FC<ExpandedProjectTasksProps> = ({ trackerId, refetchList, user_id, isDesignExecutive }) => {
    const {
        groupedTasks,trackerDoc, isLoading, error, getDesignerName,
        handleTaskSave, editingTask, setEditingTask, usersList, statusOptions,
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

    // const getAssignedNameForDisplay = (task: DesignTrackerTask): React.ReactNode => {
    //     const designerField = task.assigned_designers;
    //     let designers: AssignedDesignerDetail[] = [];

    //     if (designerField) {
    //         if (designerField && typeof designerField === 'object' && Array.isArray(designerField.list)) {
    //             designers = designerField.list
    //         } else if (Array.isArray(designerField)) {
    //             designers = designerField
    //         } else if (typeof designerField === 'string' && designerField.trim() !== '') {
    //             try {
    //                 const parsed = JSON.parse(designerField);
    //                 if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list)) {
    //                     designers = parsed.list
    //                 } else if (Array.isArray(parsed)) {
    //                     designers = parsed
    //                 }
    //             } catch (e) {
    //                 // JSON parsing failed
    //             }
    //         }
    //     }

    //     if (designers.length > 0) {
    //         return (
    //             <p className="text-center">
    //             {/* <ul className="list-disc ml-0 p-0 m-0 space-y-0.5 text-xs"> */}
    //                 {designers.map((d, index) => (
    //                     <span className="text-xs block text-center" key={index}>
    //                         {d.userName || d.userId}
    //                     </span>
    //                 ))}
    //             {/* </ul> */}
    //             </p>
    //         )
    //     }else{
    //         return <p className="text-xs text-center text-gray-500">--</p>;
    //     }
    //     return getDesignerName(undefined); // Fallback or handle null case
    // };

    // const getDeadlineDisplay = (task: DesignTrackerTask) => {
    //     if (!task.deadline) return '...';
    //     try {
    //         return new Date(task.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '/')
    //     } catch {
    //         return '...'
    //     }
    // }

    if (isLoading) return <LoadingFallback />;
    if (error) return <AlertDestructive error={error} />;

    // REMOVED: const { role, user_id } = useUserData();
    // REMOVED: const isDesignExecutive = role === "Nirmaan Design Executive Profile";

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

    return (
        <div className="space-y-4 px-3 py-2">
            {Object.entries(groupedTasks).map(([categoryName, tasks]) => {
                const isCategoryExpanded = expandedCategories[categoryName] ?? false;

                return (
                <>
                       {/* <div
                            className={`flex justify-between items-center px-4 py-3 cursor-pointer
                                ${isCategoryExpanded ? 'border-b bg-white rounded-t-lg' : 'bg-gray-50 rounded-lg'}`}
                            onClick={() => toggleCategory(categoryName)}
                        > */}
                        <div
                            className={`flex justify-between items-center px-2 py-3 cursor-pointer 
                                ${isCategoryExpanded ? 'border-none bg-white rounded-t-lg' : 'border bg-[#f2f2fb] rounded-lg'}`}
                            onClick={() => toggleCategory(categoryName)}
                        >
                            <h2 className="font-semibold text-gray-800">{categoryName} ({tasks.length} Tasks)</h2>
                            {isCategoryExpanded ? <ChevronUp className="text-gray-600" /> : < ChevronDown />}
                        </div>

                    <div key={categoryName} className="mx-4 rounded-lg bg-white shadow-sm">
                        {/* Category Header */}
                       

                        {/* Task Table */}
                        {isCategoryExpanded && (
                            <div className=" overflow-x-auto rounded-lg border border-gray-300">
                                <table className="min-w-full divide-y divide-gray-300 table-fixed"> {/* Added table-fixed */}
                                    <thead className="bg-gray-100 text-xs text-gray-500 uppercase" style={{ backgroundColor: '#f2f2fb' }}>
                                        <tr>
                                            {/* Fixed widths applied to ensure alignment across all tables */}
                                            <th className="px-4 py-3 text-left w-[18%]">Task Name</th>
                                            <th className="px-4 py-3 text-left w-[18%]">Assigned Designer</th>
                                            <th className="px-4 py-3 text-left w-[10%]">Deadline</th>
                                            <th className="px-4 py-3 text-center w-[12%]">Status</th>
                                            <th className="px-4 py-3 text-center w-[16%]">Sub-Status</th>
                                            <th className="px-4 py-3 text-center w-[8%]">Comments</th>
                                            <th className="px-4 py-3 text-center w-[8%]">Link</th>
                                            <th className="px-4 py-3 text-center w-[14%]">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {tasks.map((task) => (
                                            <tr key={task.name} className="text-sm text-gray-800">
                                                <td className="px-4 py-3 font-medium truncate">{task.task_name}</td>
                                                <td className="px-4 py-3 text-left">{getAssignedNameForDisplay(task)}</td>
                                                {/* <td className="px-4 py-3 whitespace-nowrap">{getDeadlineDisplay(task)}</td> */}
                                                   <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{formatDeadlineShort(task.deadline) || '...'}</td>

                                                {/* Task Status */}
                                                {/* Task Status */}
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
                                                {/* Actions: Triggers Modal */}
                                                <td className="px-4 py-3 text-center">
                                                    {(!isDesignExecutive || (isDesignExecutive && checkIfUserAssigned(task))) ? (
                                                        <Button variant="outline" size="sm" className="h-8" onClick={() => setEditingTask(task)}>
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
                        )}
                    </div>
                    </>
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
                    existingTaskNames={getExistingTaskNames(trackerDoc)}
                    isRestrictedMode={isDesignExecutive}
                />
            )}
        </div>
    )
};

export const DesignTrackerList: React.FC = () => {
    const navigate = useNavigate();
    const { role,user_id } = useUserData();
    // console.log("role-Nirmaan Design Executive Profile",role,user_id)
    const isDesignExecutive = role === "Nirmaan Design Executive Profile";
    const hasEditStructureAccess = role === "Nirmaan Design Lead Profile" || role === "Nirmaan Admin Profile" || user_id === "Administrator";
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProjectFilters, setSelectedProjectFilters] = useState<string[]>([]);

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
        data: trackerDocsData, isLoading, error, mutate: refetchList
    } = useFrappeGetCall<any>('nirmaan_stack.api.design_tracker.get_tracker_list.get_trackers_with_stats', {}, "cache-first");

    // Safe access to array data
    const trackerDocs = useMemo(() => {
        if (!trackerDocsData) return [];
        if (Array.isArray(trackerDocsData)) return trackerDocsData;
        if (Array.isArray(trackerDocsData.message)) return trackerDocsData.message;
        return [];
    }, [trackerDocsData]);
    
    // Previous DocList call commented out
    /*
    const {
        data: trackerDocs, isLoading, error, mutate: refetchList
    } = useFrappeGetDocList<ProjectDesignTracker>(DOCTYPE, {
        fields: ["name", "project", "project_name", "status", "creation", "modified", "overall_deadline"],
        orderBy: { field: "creation", order: "desc" },
        limit: 100
    });
    */

    const { projectOptions, categories, categoryData, statusOptions,
        subStatusOptions, mutateMasters } = useDesignMasters();

    useEffect(() => {
        if (activeTab === DESIGN_TABS.PROJECT_WISE && mutateMasters) {
            mutateMasters();
        }
    }, [activeTab, mutateMasters]);

    // Derive Unique Project Names for Filter
    const projectFilterOptions = useMemo(() => {
        if (!trackerDocs) return [];
        const unique = new Set<string>();
        trackerDocs.forEach(doc => {
             if(doc.project_name) unique.add(doc.project_name);
        });
        return Array.from(unique).sort();
    }, [trackerDocs]);

    const filteredDocs = useMemo(() => {
        if (!trackerDocs) return [];
        const lowerCaseSearch = searchTerm.toLowerCase();

        return trackerDocs.filter(doc => {
            const matchesSearch = doc.project_name.toLowerCase().includes(lowerCaseSearch) ||
            doc.name.toLowerCase().includes(lowerCaseSearch);
            
            const matchesProject = selectedProjectFilters.length === 0 || selectedProjectFilters.includes(doc.project_name);

            return matchesSearch && matchesProject;
        })
    }, [trackerDocs, searchTerm, selectedProjectFilters]);

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
                    variant="primary"
                        onClick={() => onClick(DESIGN_TABS.PROJECT_WISE)}
                        className={`px-4 py-2 text-sm font-medium h-auto shadow-none 
            ${activeTab === DESIGN_TABS.PROJECT_WISE ? 'bg-primary text-white' : 'bg-white text-gray-700 '}
            
            /* Apply border-right to create the visual divider */
            border-r border-gray-300 
            
            /* Ensure right side is square, left side gets rounding from parent div */
            rounded-r-none 
        `}
                    >
                       Project Wise
                       {/* {trackerDocs?.length > 0 && (
                           <span className="ml-2 bg-white text-red-700 px-2 rounded-full text-xs py-1">
                               {trackerDocs?.length || 0}
                           </span>
                       )} */}
                    </Button>

                    <Button
                    variant="primary"

                        onClick={() => onClick(DESIGN_TABS.TASK_WISE)}
                        className={`px-4 py-2 text-sm font-medium h-auto shadow-none 
            ${activeTab === DESIGN_TABS.TASK_WISE ? 'bg-primary text-white' : 'bg-white text-gray-800 '}
            
            /* Ensure left side is square, right side gets rounding from parent div */
            rounded-l-none 
        `}
                    >
                        Task Wise
                    </Button>
                </div>
                {activeTab === DESIGN_TABS.PROJECT_WISE && hasEditStructureAccess && (
                    <Button onClick={() => setIsModalOpen(true)} className="">
                        <CirclePlus className="h-5 w-5 pr-1" /> Track New Project
                    </Button>
                )}

            </header>


            {/* Search and Filter */}
            {
                activeTab === DESIGN_TABS.PROJECT_WISE && (
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
                        <Popover>
                             <PopoverTrigger asChild>
                                 <Button variant="outline" className="flex items-center gap-2 h-10 border-gray-300 text-gray-700">
                                     <Filter className="h-4 w-4" /> Filter
                                    {selectedProjectFilters.length > 0 && (
                                        <Badge variant="secondary" className="ml-1 h-5 px-1 bg-gray-200 text-xs">
                                            {selectedProjectFilters.length}
                                        </Badge>
                                    )}
                                 </Button>
                             </PopoverTrigger>
                             <PopoverContent className="w-[250px] p-0" align="start">
                                 <Command>
                                     <CommandInput placeholder="Filter Project..." />
                                     <CommandList>
                                         <CommandEmpty>No project found.</CommandEmpty>
                                         <CommandGroup>
                                             {projectFilterOptions.map(option => {
                                                  const isSelected = selectedProjectFilters.includes(option);
                                                  return (
                                                      <CommandItem
                                                         key={option}
                                                         onSelect={() => {
                                                             if (isSelected) {
                                                                 setSelectedProjectFilters(prev => prev.filter(p => p !== option));
                                                             } else {
                                                                 setSelectedProjectFilters(prev => [...prev, option]);
                                                             }
                                                         }}
                                                      >
                                                         <div className={cn("mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                             isSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                                                         )}>
                                                             <Check className={cn("h-4 w-4")} />
                                                         </div>
                                                         <span>{option}</span>
                                                      </CommandItem>
                                                  )
                                             })}
                                         </CommandGroup>
                                     </CommandList>
                                     {selectedProjectFilters.length > 0 && (
                                        <div className="p-1 border-t bg-white sticky bottom-0 z-10">
                                            <Button 
                                                variant="ghost" 
                                                size="sm"
                                                className="w-full justify-center text-xs h-7 font-normal hover:bg-transparent text-red-600 hover:text-red-700 hover:underline"
                                                onClick={() => setSelectedProjectFilters([])}
                                            >
                                                Clear
                                            </Button>
                                        </div>
                                     )}
                                 </Command>
                             </PopoverContent>
                        </Popover>
                    </div>
                )
            }



            {/* Content based on Active Tab */}
            {activeTab === DESIGN_TABS.PROJECT_WISE && (
                <div className="space-y-3">
                    {/* New Grid View Logic */}
                     {/* Use useFrappeGetCall instead of GetDocList for Custom API */}
                     {/* Note: I'm casting the fetched data to match the expected structure */}
                  
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredDocs.length === 0 ? (
                            <div className="col-span-full text-center text-gray-500 p-10">
                                No design trackers found matching your search criteria.
                            </div>
                        ) : (
                            filteredDocs.map((doc: any) => (
                                <div key={doc.name} className="h-full">
                                    <ProjectWiseCard 
                                        tracker={doc} 
                                        onClick={() => navigate(`/design-tracker/${doc.name}`)}
                                    />
                                </div>
                            ))
                        )}
                    </div>


                    {/* 
                     ================================================================
                     PREVIOUS LOGIC (COLLAPSIBLE CARDS) - COMMENTED OUT AS REQUESTED
                     ================================================================
                    
                    {filteredDocs.length === 0 ? (
                        <p className="text-center text-gray-500 p-10">No design trackers found matching your search criteria.</p>
                    ) : (
                        filteredDocs.map((doc) => {
                            const isPending = doc.status.toLowerCase().includes('assign pending');
                            // const isPending = true
                            
                            const isExpanded = expandedProject === doc.name;

                            return (
                                <div key={doc.name}>
                                    <Card
                                        className={`p-4 transition-all duration-200 cursor-pointer
                                                ${isPending ? 'border-destructive border' : 'border-gray-200 borde'}
                                                ${isExpanded ? 'rounded-b-none border-b-0' : 'rounded-lg hover:shadow-md'}`}
                                        onClick={() => handleToggleCollapse(doc.name)}
                                    >
                                        <CardContent className="p-0 flex flex-wrap justify-between items-center text-sm md:text-base relative">
                                            {/* Project Name * /}
                                            <div className="w-full md:w-2/4 min-w-[150px] pr-4 order1 mb-2 md:mb-0">
                                                {/* <Link
                                                    to={`/design-tracker/${doc.name}`}
                                                    className={`text-lg font-extrabold underline hover:underline
                                                            ${isPending ? 'text-destructive' : 'text-Black'}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    {doc.project_name}
                                                </Link> * /}
                                                <Link
    to={`/design-tracker/${doc.name}`}
    className={`group flex items-center gap-2 text-lg font-bold w-fit
        ${isPending ? 'text-destructive' : 'text-gray-900 hover:text-blue-600'}`}
    onClick={(e) => e.stopPropagation()}
>
    <span className="underline underline-offset-4 group-hover:underline underline-offset-4">
        {doc.project_name}
    </span>
    {/* Icon appears/moves slightly on hover * /}
    <ArrowUpRight className="h-4 w-4 opacity-90 group-hover:opacity-100 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all" />
</Link>
                                            </div>

                                            {/* Details * /}
                                            {/* Date Section * /}
                                            <div className="text-gray-600 flex flex-col items-start md:items-center w-1/2 md:w-auto">
                                                <div className="text-xs text-gray-500 capitalize font-medium">Task Created On:</div>
                                                <div className="text-sm font-medium text-gray-900">
                                                    {formatDeadlineShort(doc.creation)}
                                                </div>
                                            </div>

                                            {/* Status Section * /}
                                            <div className="text-right flex flex-col items-end md:items-center w-1/2 md:w-auto">
                                                <div className="text-xs text-gray-500 capitalize font-medium">Status</div>
                                                <Badge
                                                    variant="outline" 
                                                        className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getStatusBadgeStyle(doc.status || '...')} rounded-full`}
                                                >
                                                    {doc.status}
                                                </Badge>
                                            </div>

                                            {/* Row 3: Action Icon * /}
                                            <div className="absolute right-0 top-0 md:static md:order-3 md:ml-4">
                                                <Button variant="outline" size="icon" className="h-8 w-8 bg-gray-100  hover:bg-gray-200">
                                                    {isExpanded ? <ChevronUp className="h-5 w-5 " /> : <ChevronDown className="h-5 w-5 " />}
                                                </Button>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* Expanded Task List * /}
                                    {isExpanded && (
                                        <div className={`bg-white border rounded-b-lg p-0
                                                ${isPending ? 'border-destructive border-t' : 'border-gray-200 border-t'}`}>
                                            <ExpandedProjectTasks 
                                                trackerId={doc.name} 
                                                refetchList={refetchList}    
                                                user_id={user_id}
                                                isDesignExecutive={isDesignExecutive}
                                            />
                                        </div>
                                    )}
                                </div>
                            )
                        })
                    )}
                    */}
                </div>
            )}

            {activeTab === DESIGN_TABS.TASK_WISE && (
                <TaskWiseTable 
                    refetchList={refetchList} 
                    searchTerm={searchTerm} 
                    onSearchTermChange={setSearchTerm}
                    user_id={user_id}
                    isDesignExecutive={isDesignExecutive}
                />
            )}

            {/* Modal for New Tracker */}
            <NewTrackerModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                projectOptions={projectOptions}
                categoryData={categoryData}
                onSuccess={() => {
                    refetchList();
                    if (mutateMasters) mutateMasters();
                }}
            />
        </div>
    )
};

export default DesignTrackerList;