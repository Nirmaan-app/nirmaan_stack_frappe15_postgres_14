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
import ReactSelect from 'react-select';
import { ArrowUpRight } from "lucide-react";

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
import {useUserData} from "@/hooks/useUserData";

const DOCTYPE = 'Project Design Tracker';
const FE_TASK_STATUS_OPTIONS = ["Todo", "In Progress", "Done", "Blocked", "On Hold", "Submitted"];

const DESIGN_TABS = { 
    DESIGN_PACKAGES: 'packages', 
    PROJECT_WISE: 'project', 
    TASK_WISE: 'task' 
};


const NewTrackerModal: React.FC<any> = ({ isOpen, onClose, projectOptions, categoryData, onSuccess }) => {
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const { createDoc, loading: createLoading } = useFrappeCreateDoc();

    const visibleCategories = useMemo(() => {
        if (!categoryData) return [];
        return categoryData.filter((cat: any) => Array.isArray(cat.tasks) && cat.tasks.length > 0);
    }, [categoryData]);

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
                        task_status: 'Not Applicable',
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
                     <div className="flex flex-col gap-2">
                        <Label htmlFor="Projects">Select Project *</Label>
                        <ReactSelect
                            options={projectOptions}
                            value={projectOptions.find((p: any) => p.value === selectedProjectId) || null}
                            onChange={(option: any) => setSelectedProjectId(option ? option.value : null)}
                            classNamePrefix="react-select"
                            menuPosition={'auto'}
                        
                        />
                    </div>

                    {/* Category Selection */}
                          <div className="space-y-3">
                        <AlertDialogDescription>Step 2: Choose one or more categories for this project</AlertDialogDescription>
                        
                        {visibleCategories.length > 0 ? (
                            <div className="grid grid-cols-3 gap-3">
                                {visibleCategories.map((cat: any) => (
                                    <Button
                                        key={cat.category_name}
                                        variant={selectedCategories.includes(cat.category_name) ? "default" : "outline"}
                                        onClick={() => handleCategoryToggle(cat.category_name)}
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
                                            <th className="px-4 py-3 text-center w-[18%]">Assigned Designer</th>
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
                                                <td className="px-4 py-3 text-center">{getAssignedNameForDisplay(task)}</td>
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
                                                                        className="block w-full h-full cursor-pointer hover:scale-110 transition-transform"
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
                    {!isDesignExecutive && (
                    <Button
                        variant="primary"
                        onClick={() => onClick(DESIGN_TABS.DESIGN_PACKAGES)}
                        className={`px-4 py-2 text-sm font-medium h-auto shadow-none 
                        ${activeTab === DESIGN_TABS.DESIGN_PACKAGES ? 'bg-primary text-white' : 'bg-white text-gray-700 '}
                        border-r border-gray-300 rounded-r-none`}
                    >
                        Design Packages
                    </Button>
                    )}


                    <Button
                    variant="primary"
                        onClick={() => onClick(DESIGN_TABS.PROJECT_WISE)}
                        className={`px-4 py-2 text-sm font-medium h-auto shadow-none 
            ${activeTab === DESIGN_TABS.PROJECT_WISE ? 'bg-primary text-white' : 'bg-white text-gray-700 '}
            
            /* Apply border-right to create the visual divider */
            border-r border-gray-300 
            
            /* Ensure right side is square, left side gets rounding from parent div */
            rounded-none 
        `}
                    >
                        Project Wise
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
                {activeTab === DESIGN_TABS.PROJECT_WISE && !isDesignExecutive && (
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
                        <Button variant="outline" className="flex items-center gap-2 h-10 border-gray-300 text-gray-700">
                            <Filter className="h-4 w-4" /> Filter
                        </Button>
                    </div>
                )
            }

             {activeTab === DESIGN_TABS.DESIGN_PACKAGES && (
                <DesignPackagesMaster />
            )}

            {/* Content based on Active Tab */}
            {activeTab === DESIGN_TABS.PROJECT_WISE && (
                <div className="space-y-3">
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
                                            {/* Project Name */}
                                            <div className="w-full md:w-2/4 min-w-[150px] pr-4 order1 mb-2 md:mb-0">
                                                {/* <Link
                                                    to={`/design-tracker/${doc.name}`}
                                                    className={`text-lg font-extrabold underline hover:underline
                                                            ${isPending ? 'text-destructive' : 'text-Black'}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    {doc.project_name}
                                                </Link> */}
                                                <Link
    to={`/design-tracker/${doc.name}`}
    className={`group flex items-center gap-2 text-lg font-bold w-fit
        ${isPending ? 'text-destructive' : 'text-gray-900 hover:text-blue-600'}`}
    onClick={(e) => e.stopPropagation()}
>
    <span className="underline underline-offset-4 group-hover:underline underline-offset-4">
        {doc.project_name}
    </span>
    {/* Icon appears/moves slightly on hover */}
    <ArrowUpRight className="h-4 w-4 opacity-90 group-hover:opacity-100 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all" />
</Link>
                                            </div>

                                            {/* Details */}
                                            {/* Date Section */}
                                            <div className="text-gray-600 flex flex-col items-start md:items-center w-1/2 md:w-auto">
                                                <div className="text-xs text-gray-500 capitalize font-medium">Task Created On:</div>
                                                <div className="text-sm font-medium text-gray-900">
                                                    {formatDeadlineShort(doc.creation)}
                                                </div>
                                            </div>

                                            {/* Status Section */}
                                            <div className="text-right flex flex-col items-end md:items-center w-1/2 md:w-auto">
                                                <div className="text-xs text-gray-500 capitalize font-medium">Status</div>
                                                <Badge
                                                    variant="outline" 
                                                        className={`w-[120px] min-h-[28px] h-auto py-1 px-2 justify-center whitespace-normal break-words text-center leading-tight ${getStatusBadgeStyle(doc.status || '...')} rounded-full`}
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
                onSuccess={() => refetchList()}
            />
        </div>
    )
};

export default DesignTrackerList;