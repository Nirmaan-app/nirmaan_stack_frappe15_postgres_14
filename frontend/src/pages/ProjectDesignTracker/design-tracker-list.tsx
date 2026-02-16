import React, { useMemo, useState, useCallback, useEffect } from "react";
import { addDays, format } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useNavigate } from "react-router-dom";
import { useFrappeCreateDoc, useFrappeGetDocList, useFrappeGetCall, useFrappeUpdateDoc } from "frappe-react-sdk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronUp, Search, Filter, CirclePlus, MessageCircle, Edit, ArrowUpRight, Check, EyeOff, CheckCircle2 } from "lucide-react";
import { FilesCell } from './components/FilesCell';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { NewTrackerModal } from "./components/NewTrackerModal";
import { TeamPerformanceSummary } from "./components/TeamPerformanceSummary";

const DOCTYPE = 'Project Design Tracker';
const FE_TASK_STATUS_OPTIONS = ["Todo", "In Progress", "Done", "Blocked", "On Hold", "Submitted"];

const DESIGN_TABS = {
    PROJECT_WISE: 'project',
    TASK_WISE: 'task'
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
                                            <th className="px-4 py-3 text-center w-[8%]">Files</th>
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

                                                {/* 2. Files Column (Design file + Approval proof) */}
                                                <td className="px-4 py-3 text-center">
                                                    <FilesCell
                                                        file_link={task.file_link}
                                                        approval_proof={task.approval_proof}
                                                        size="md"
                                                    />
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
    const hasEditStructureAccess = role === "Nirmaan Design Lead Profile" || role === "Nirmaan Admin Profile" || role === "Nirmaan PMO Executive Profile" || user_id === "Administrator";
    const isProjectManager = role === "Nirmaan Project Manager Profile";

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProjectFilters, setSelectedProjectFilters] = useState<string[]>([]);
    const [isHiddenSectionOpen, setIsHiddenSectionOpen] = useState(false);

    const initialTab = useMemo(() => getUrlStringParam("tab", DESIGN_TABS.PROJECT_WISE), []);
    const [activeTab, setActiveTab] = useState<string>(initialTab);
    const [expandedProject, setExpandedProject] = useState<string | null>(null);
    const [activeStatusTab, setActiveStatusTab] = useState<string>("All");

    const onClick = useCallback((value: string) => {
        if (activeTab === value || isProjectManager) return; // Disable tab switching for Project Managers
        setActiveTab(value)
    }, [activeTab, isProjectManager]);

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

    // Hook for updating tracker visibility
    const { updateDoc } = useFrappeUpdateDoc();

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

    const { projectOptions, projects, categories, categoryData, statusOptions,
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

    // Handler for toggling tracker visibility from card
    const handleHideToggle = useCallback(async (trackerId: string, newHiddenState: boolean) => {
        try {
            await updateDoc("Project Design Tracker", trackerId, {
                hide_design_tracker: newHiddenState ? 1 : 0
            });
            refetchList();
            toast({
                title: newHiddenState ? "Tracker Hidden" : "Tracker Visible",
                description: newHiddenState
                    ? "Hidden from Design Executives and Project Managers"
                    : "Now visible to all users",
            });
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to update tracker visibility",
                variant: "destructive"
            });
        }
    }, [updateDoc, refetchList]);

    // Split docs into active and hidden
    const activeDocs = useMemo(() =>
        filteredDocs.filter(doc => !doc.hide_design_tracker), [filteredDocs]);

    const hiddenDocs = useMemo(() =>
        filteredDocs.filter(doc => doc.hide_design_tracker === 1), [filteredDocs]);

    // Calculate aggregate summary stats for the list header
    const summaryStats = useMemo(() => {
        const total = trackerDocs.length;
        const active = activeDocs.length;
        const hidden = hiddenDocs.length;

        // Aggregate task stats across all visible (active) trackers
        const totalTasks = activeDocs.reduce((sum, doc) => sum + (doc.total_tasks || 0), 0);
        const completedTasks = activeDocs.reduce((sum, doc) => sum + (doc.completed_tasks || 0), 0);
        const overallCompletion = totalTasks > 0
            ? Math.round((completedTasks / totalTasks) * 100)
            : 0;

        return { total, active, hidden, totalTasks, completedTasks, overallCompletion };
    }, [trackerDocs, activeDocs, hiddenDocs]);

    if (isLoading) return <TableSkeleton />;
    if (error) return <AlertDestructive error={error} />;

    return (
        <div className="flex-1 space-y-5">
            {/* ═══════════════════════════════════════════════════════════════
                HEADER SECTION - Matches details page aesthetic
            ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border-b border-gray-200 px-4 py-4 md:px-6">
                {/* Row 1: Title + Summary Stats */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <div>
                        <h1 className="text-lg font-semibold text-gray-900">Design Trackers</h1>
                        <p className="text-sm text-gray-500">Track project design progress</p>
                    </div>

                    {/* Summary Pills - Only for privileged users */}
                    <div className="flex flex-wrap items-center gap-2">
                        {hasEditStructureAccess && (
                            <>
                                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 rounded border border-gray-200">
                                    <span className="text-xs text-gray-500">Projects:</span>
                                    <span className="text-sm font-semibold text-gray-700">{summaryStats.active}</span>
                                </div>
                                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-50 rounded border border-green-200">
                                    <CheckCircle2 className="h-3 w-3 text-green-600" />
                                    <span className="text-xs text-gray-500">Tasks:</span>
                                    <span className="text-sm font-semibold text-green-700">
                                        {summaryStats.completedTasks}/{summaryStats.totalTasks}
                                    </span>
                                </div>
                            </>
                        )}
                        {hasEditStructureAccess && summaryStats.hidden > 0 && (
                            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-50 rounded border border-orange-200">
                                <EyeOff className="h-3 w-3 text-orange-600" />
                                <span className="text-xs text-gray-500">Hidden:</span>
                                <span className="text-sm font-semibold text-orange-700">{summaryStats.hidden}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Row 2: Tab Switcher + Action Button */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    {/* Tab Switcher - Hidden for Project Managers */}
                    {!isProjectManager && (
                        <div className="inline-flex border border-gray-300 rounded-lg overflow-hidden bg-white">
                            <button
                                onClick={() => onClick(DESIGN_TABS.PROJECT_WISE)}
                                className={`px-4 py-2 text-sm font-medium transition-colors ${
                                    activeTab === DESIGN_TABS.PROJECT_WISE
                                        ? 'bg-primary text-white'
                                        : 'bg-white text-gray-700 hover:bg-gray-50'
                                } border-r border-gray-300`}
                            >
                                Project Wise
                            </button>
                            <button
                                onClick={() => onClick(DESIGN_TABS.TASK_WISE)}
                                className={`px-4 py-2 text-sm font-medium transition-colors ${
                                    activeTab === DESIGN_TABS.TASK_WISE
                                        ? 'bg-primary text-white'
                                        : 'bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                Task Wise
                            </button>
                        </div>
                    )}

                    {/* Action Button */}
                    {activeTab === DESIGN_TABS.PROJECT_WISE && hasEditStructureAccess && (
                        <Button onClick={() => setIsModalOpen(true)} className="whitespace-nowrap">
                            <CirclePlus className="h-4 w-4 mr-2" />
                            Track New Project
                        </Button>
                    )}
                </div>
            </div>

            {/* Search and Filter Section */}
            {activeTab === DESIGN_TABS.PROJECT_WISE && (
                <div className="flex flex-col sm:flex-row gap-3 px-4 md:px-6">
                    {/* Search Input */}
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                        <Input
                            placeholder="Search by project name or ID..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 h-10 border-gray-300 focus:ring-2 focus:ring-primary/20"
                        />
                    </div>

                    {/* Filter Button */}
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                className="flex items-center gap-2 h-10 border-gray-300 text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                            >
                                <Filter className="h-4 w-4" />
                                <span className="hidden sm:inline">Filter</span>
                                {selectedProjectFilters.length > 0 && (
                                    <Badge variant="secondary" className="h-5 min-w-[20px] px-1.5 bg-primary text-white text-xs">
                                        {selectedProjectFilters.length}
                                    </Badge>
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[280px] p-0" align="end">
                            <Command>
                                <CommandInput placeholder="Search projects..." className="h-9" />
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
                                                    className="cursor-pointer"
                                                >
                                                    <div className={cn(
                                                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                        isSelected
                                                            ? "bg-primary text-primary-foreground"
                                                            : "opacity-50 [&_svg]:invisible"
                                                    )}>
                                                        <Check className="h-4 w-4" />
                                                    </div>
                                                    <span className="flex-1 truncate">{option}</span>
                                                </CommandItem>
                                            )
                                        })}
                                    </CommandGroup>
                                </CommandList>
                                {selectedProjectFilters.length > 0 && (
                                    <div className="p-2 border-t bg-gray-50">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="w-full h-8 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50"
                                            onClick={() => setSelectedProjectFilters([])}
                                        >
                                            Clear filters
                                        </Button>
                                    </div>
                                )}
                            </Command>
                        </PopoverContent>
                    </Popover>
                </div>
            )}



            {/* Content based on Active Tab */}
            {activeTab === DESIGN_TABS.PROJECT_WISE && (
                <div className="space-y-4 px-4 md:px-6">
                    {/* Project Cards Grid - Active Trackers */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 md:gap-5">
                        {activeDocs.length === 0 && hiddenDocs.length === 0 ? (
                            <div className="col-span-full">
                                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                                    <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                                        <Search className="h-8 w-8 text-gray-400" />
                                    </div>
                                    <h3 className="text-lg font-medium text-gray-900 mb-1">
                                        No trackers found
                                    </h3>
                                    <p className="text-sm text-gray-500 max-w-sm">
                                        {searchTerm || selectedProjectFilters.length > 0
                                            ? "Try adjusting your search or filters"
                                            : "No design trackers available"}
                                    </p>
                                </div>
                            </div>
                        ) : activeDocs.length === 0 ? (
                            <div className="col-span-full">
                                <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                                    <p className="text-sm text-gray-500">
                                        No active trackers. Check the hidden trackers section below.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            activeDocs.map((doc: any) => (
                                <div key={doc.name} className="h-full">
                                    <ProjectWiseCard
                                        tracker={doc}
                                        onClick={() => navigate(`/design-tracker/${doc.name}`)}
                                        showHiddenBadge={hasEditStructureAccess}
                                        onHideToggle={hasEditStructureAccess ? handleHideToggle : undefined}
                                        currentUserId={user_id}
                                        isDesigner={isDesignExecutive || role === "Nirmaan Design Lead Profile"}
                                    />
                                </div>
                            ))
                        )}
                    </div>

                    {/* Hidden Trackers Section - Only visible to privileged users */}
                    {hasEditStructureAccess && hiddenDocs.length > 0 && (
                        <Collapsible
                            open={isHiddenSectionOpen}
                            onOpenChange={setIsHiddenSectionOpen}
                            className="mt-6"
                        >
                            <CollapsibleTrigger asChild>
                                <button className="flex items-center gap-2 w-full px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors">
                                    <EyeOff className="h-4 w-4 text-orange-600" />
                                    <span className="text-sm font-medium text-orange-700">
                                        Hidden Trackers
                                    </span>
                                    <Badge
                                        variant="secondary"
                                        className="px-2 py-0.5 text-xs bg-orange-200 text-orange-800 border-0"
                                    >
                                        {hiddenDocs.length}
                                    </Badge>
                                    <ChevronDown
                                        className={`h-4 w-4 text-orange-600 ml-auto transition-transform duration-200 ${
                                            isHiddenSectionOpen ? 'rotate-180' : ''
                                        }`}
                                    />
                                </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 md:gap-5">
                                    {hiddenDocs.map((doc: any) => (
                                        <div key={doc.name} className="h-full">
                                            <ProjectWiseCard
                                                tracker={doc}
                                                onClick={() => navigate(`/design-tracker/${doc.name}`)}
                                                showHiddenBadge={true}
                                                onHideToggle={handleHideToggle}
                                                currentUserId={user_id}
                                                isDesigner={isDesignExecutive || role === "Nirmaan Design Lead Profile"}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    )}


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
                <div className="space-y-5 px-4 md:px-6">
                    {/* Team Performance Summary - Admin/Lead Only */}
                    <TeamPerformanceSummary hasAccess={hasEditStructureAccess} />

                    {/* Status Filter Tabs - Enhanced Design */}
                    <div className="bg-gray-50/70 rounded-lg p-3 border border-gray-200">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Filter by Status</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {/* All Tasks Tab */}
                            <button
                                onClick={() => setActiveStatusTab("All")}
                                className={`
                                    px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150
                                    flex items-center gap-2
                                    ${activeStatusTab === "All"
                                        ? 'bg-gray-800 text-white shadow-md'
                                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100 hover:border-gray-400'
                                    }
                                `}
                            >
                                <span className={`w-2 h-2 rounded-full ${activeStatusTab === "All" ? 'bg-white' : 'bg-gray-400'}`} />
                                All Tasks
                            </button>

                            {/* Approved Tab - Green */}
                            <button
                                onClick={() => setActiveStatusTab("Approved")}
                                className={`
                                    px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150
                                    flex items-center gap-2
                                    ${activeStatusTab === "Approved"
                                        ? 'bg-green-600 text-white shadow-md'
                                        : 'bg-white text-green-700 border border-green-300 hover:bg-green-50 hover:border-green-400'
                                    }
                                `}
                            >
                                <CheckCircle2 className={`h-3.5 w-3.5 ${activeStatusTab === "Approved" ? 'text-white' : 'text-green-600'}`} />
                                Approved
                            </button>

                            {/* Dynamic Status Tabs with status-specific colors */}
                            {statusOptions
                                ?.filter(s => s.value !== 'Approved' && s.value !== 'Not Applicable')
                                .sort((a, b) => {
                                    // Custom sort order: In Progress first, then alphabetically
                                    if (a.value === 'In Progress') return -1;
                                    if (b.value === 'In Progress') return 1;
                                    if (a.value === 'Not Started') return -1;
                                    if (b.value === 'Not Started') return 1;
                                    return a.label.localeCompare(b.label);
                                })
                                .map((option) => {
                                    const isActive = activeStatusTab === option.value;
                                    const lowerValue = option.value.toLowerCase();

                                    // Determine color scheme based on status
                                    let activeStyles = 'bg-gray-700 text-white';
                                    let inactiveStyles = 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50';
                                    let dotColor = isActive ? 'bg-white' : 'bg-gray-400';

                                    if (lowerValue.includes('in progress')) {
                                        activeStyles = 'bg-blue-600 text-white';
                                        inactiveStyles = 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50 hover:border-blue-400';
                                        dotColor = isActive ? 'bg-white' : 'bg-blue-500';
                                    } else if (lowerValue.includes('blocked') || lowerValue.includes('on hold') || lowerValue.includes('revision') || lowerValue.includes('clarification')) {
                                        activeStyles = 'bg-orange-500 text-white';
                                        inactiveStyles = 'bg-white text-orange-700 border-orange-300 hover:bg-orange-50 hover:border-orange-400';
                                        dotColor = isActive ? 'bg-white' : 'bg-orange-500';
                                    } else if (lowerValue.includes('not started') || lowerValue.includes('todo')) {
                                        activeStyles = 'bg-gray-600 text-white';
                                        inactiveStyles = 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100 hover:border-gray-400';
                                        dotColor = isActive ? 'bg-white' : 'bg-gray-400';
                                    }

                                    return (
                                        <button
                                            key={option.value}
                                            onClick={() => setActiveStatusTab(option.value)}
                                            className={`
                                                px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150
                                                flex items-center gap-2 border
                                                ${isActive ? `${activeStyles} shadow-md` : inactiveStyles}
                                            `}
                                        >
                                            <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                                            {option.label}
                                        </button>
                                    );
                                })}
                        </div>
                    </div>

                    {/* Task Table */}
                    <TaskWiseTable
                        refetchList={refetchList}
                        searchTerm={searchTerm}
                        onSearchTermChange={setSearchTerm}
                        user_id={user_id}
                        isDesignExecutive={isDesignExecutive}
                        statusFilter={activeStatusTab}
                    />
                </div>
            )}

            {/* Modal for New Tracker */}
            <NewTrackerModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                projectOptions={projectOptions}
                projects={projects}
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