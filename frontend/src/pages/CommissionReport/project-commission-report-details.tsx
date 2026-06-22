

import React, { useMemo, useState } from 'react';
import { format } from "date-fns";
import { useParams, useNavigate } from 'react-router-dom';
import { ProjectCommissionReportType, CommissionReportTask } from './types';
import { AlertDestructive } from "@/components/layout/alert-banner/error-alert";

import LoadingFallback from '@/components/layout/loaders/LoadingFallback';
import { Button } from '@/components/ui/button';
import { Edit, Download, Plus, Check, ChevronDown, EyeOff, CheckCircle2 } from 'lucide-react';
import {
    Collapsible,
    CollapsibleTrigger,
    CollapsibleContent,
} from '@/components/ui/collapsible';
import { toast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCommissionTrackerLogic } from './hooks/useCommissionTrackerLogic';
import { TailSpin } from 'react-loader-spinner';
import { formatDeadlineShort, getExistingTaskNames } from './utils';
import { TaskEditModal } from './components/ReportEditModal';
import { GlobalApprovalsTable } from './components/GlobalApprovalsTable';
import { useUserData } from "@/hooks/useUserData";
import { useCEOHoldGuard } from "@/hooks/useCEOHoldGuard";
import { CEOHoldBanner } from "@/components/ui/ceo-hold-banner";

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
    RowSelectionState,
} from "@tanstack/react-table";
import { getTaskTableColumns, TASK_DATE_COLUMNS } from './config/commissionTableColumns';
import { useMasterTaskMap } from './report-wizard/data/useMasterTaskMap';

const DOCTYPE = 'Project Commission Report';

// --- TYPE DEFINITION for Category Items ---
interface CategoryItem {
    category_name: string;
    tasks: { task_name: string; deadline_offset?: number; report_type?: 'Field' | 'Vendor' }[];
}

// --- Project Overview Edit Modal ---
interface ProjectOverviewEditModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    currentDoc: ProjectCommissionReportType;
    onSave: (updatedFields: Partial<ProjectCommissionReportType>) => Promise<void>;
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

// --- Add Category Modal ---
interface AddCategoryModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    availableCategories: CategoryItem[];
    onAdd: (newTasks: Partial<CommissionReportTask>[]) => Promise<void>;
}

const AddCategoryModal: React.FC<AddCategoryModalProps> = ({
    isOpen, onOpenChange, availableCategories, onAdd
}) => {
    const [selectedCategories, setSelectedCategories] = useState<CategoryItem[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const { id: trackerId } = useParams<{ id: string }>();
    const { trackerDoc } = useCommissionTrackerLogic({ trackerId: trackerId! });

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

        const tasksToGenerate: Partial<CommissionReportTask>[] = [];

        selectedCategories.forEach(cat => {
            const taskItems = cat.tasks;
            taskItems.forEach(taskDef => {
                let calculatedDeadline: string | undefined = undefined;
                if (taskDef.deadline_offset !== undefined && taskDef.deadline_offset !== null) {
                    const baseDate = trackerDoc?.start_date ? new Date(trackerDoc.start_date) : new Date();
                    const d = new Date(baseDate);
                    d.setDate(baseDate.getDate() + Number(taskDef.deadline_offset));
                    calculatedDeadline = d.toISOString().split('T')[0];
                }
                // For Commission Report, we ONLY create Handover tasks
                const handoverDeadline = new Date();
                handoverDeadline.setDate(handoverDeadline.getDate() + 7);
                tasksToGenerate.push({
                    task_name: taskDef.task_name,
                    commission_category: cat.category_name,
                    task_status: 'Pending',
                    report_type: taskDef.report_type || 'Field',
                    deadline: calculatedDeadline || handoverDeadline.toISOString().split('T')[0],
                    task_phase: "Handover",
                });
            });
        });

        try {
            await onAdd(tasksToGenerate);
            const phaseMsg = "";
            toast({ title: "Success", description: `${selectedCategories.length} categories added${phaseMsg}.`, variant: "success" });
            onOpenChange(false);
        } catch (error) {
            toast({ title: "Creation Failed", description: "Failed to add categories.", variant: "destructive" });
        } finally {
            setIsSaving(false);
        }
    };

    // Calculate total tasks that will be created
    const totalTasksToCreate = selectedCategories.reduce(
        (sum, cat) => sum + (cat.tasks?.length || 0), 0
    );

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-base font-semibold">Add Categories</DialogTitle>
                    <p className="text-xs text-gray-500">
                        Select categories to add.
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
                                        className={`h-auto py-2 px-2.5 text-xs whitespace-normal min-h-[44px] justify-start text-left relative ${isSelected ? 'bg-red-600 hover:bg-red-700' : ''
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

// --- Main Detail Component ---
interface ProjectCommissionReportTypeDetailProps {
    trackerId?: string;
}

export const ProjectCommissionReportDetail: React.FC<ProjectCommissionReportTypeDetailProps> = ({ trackerId: propTrackerId }) => {
    const { role, user_id } = useUserData();
    const navigate = useNavigate();

    // Get trackerId early to fetch tracker data
    const { id: paramTrackerId } = useParams<{ id: string }>();
    const trackerId = propTrackerId || paramTrackerId;

    const {
        trackerDoc, categoryData, isLoading, error, handleTaskSave, editingTask, setEditingTask, usersList, handleParentDocSave, statusOptions,
        refetchTracker
    } = useCommissionTrackerLogic({ trackerId: trackerId! });

    // CEO Hold guard - use project ID from tracker document
    const { isCEOHold } = useCEOHoldGuard(trackerDoc?.project);

    const isDesignExecutive = role === "Nirmaan Design Executive Profile";
    const isProjectManager = role === "Nirmaan Project Manager Profile";
    const isRestrictedAssigneeRole = isDesignExecutive || isProjectManager;
    const hasEditStructureAccess = role === "Nirmaan Design Lead Profile" || role === "Nirmaan Admin Profile" || role === "Nirmaan PMO Executive Profile" || user_id === "Administrator";
    // Approvers (Admin / PMO) get the Approvals queue tab + Approve/Reject actions.
    const isApprover = role === "Nirmaan Admin Profile" || role === "Nirmaan PMO Executive Profile" || user_id === "Administrator";
    // Status-filter tabs above the table. All / per-status filter the task table;
    // 'Pending Approval' (approver-only, last after a divider) opens the approvals queue.
    const [activeStatusTab, setActiveStatusTab] = useState<string>('All');

    const [isAddCategoryModalOpen, setIsAddCategoryModalOpen] = useState(false);
    const [isProjectOverviewModalOpen, setIsProjectOverviewModalOpen] = useState(false);

    // Mobile summary accordion state (collapsed by default to show more table)
    const [isMobileSummaryOpen, setIsMobileSummaryOpen] = useState(false);

    // Phase Tab State (Handover only)
    const activePhase = "Handover";
    const hasHandover = true; // Commission Reports only use Handover phase

    // --- DataTable State ---
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedSearchField, setSelectedSearchField] = useState("task_name");

    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'deadline', desc: false }]);
    const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

    // --- Progress Calculations for Header (phase-scoped) ---
    // Phase-scoped tasks for progress metrics
    const phaseTasks = useMemo(() => {
        if (!trackerDoc?.commission_report_task) return [];
        if (hasHandover) {
            return trackerDoc.commission_report_task.filter(t => t.task_phase === activePhase);
        }
        return trackerDoc.commission_report_task;
    }, [trackerDoc?.commission_report_task, hasHandover, activePhase]);

    // Note: Exclude "Not Applicable" tasks from metrics to match backend calculation
    const applicableTasks = phaseTasks.filter(t => t.task_status !== 'Not Applicable');
    const totalTasks = applicableTasks.length;
    const completedTasks = applicableTasks.filter(t => t.task_status === 'Client Accepted').length;
    // Calculate status counts for breakdown (excluding "Not Applicable")
    const statusCounts = useMemo(() => {
        return phaseTasks
            .filter(t => t.task_status !== 'Not Applicable')
            .reduce((acc, task) => {
                const status = task.task_status || 'Unknown';
                acc[status] = (acc[status] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
    }, [phaseTasks]);

    // Flatten tasks from tracker document (filter by phase)
    const flattenedTasks = useMemo(() => {
        if (!trackerDoc?.commission_report_task) return [];
        let tasks = [...trackerDoc.commission_report_task];

        // Filter by phase when handover exists
        if (hasHandover) {
            tasks = tasks.filter(t => t.task_phase === activePhase);
        }

        return tasks;
    }, [trackerDoc?.commission_report_task, hasHandover, activePhase]);

    // Tasks shown in the table, narrowed by the active status tab. 'All' shows
    // everything; 'Pending Approval' is served by the approvals queue, not this table.
    const displayedTasks = useMemo(() => {
        if (activeStatusTab === 'All' || activeStatusTab === 'Pending Approval') return flattenedTasks;
        return flattenedTasks.filter(t => t.task_status === activeStatusTab);
    }, [flattenedTasks, activeStatusTab]);

    // Active categories in tracker
    const activeCategoriesInTracker = useMemo(() => {
        if (!trackerDoc?.commission_report_task || !categoryData) return [];

        const uniqueCategoryNames = new Set(
            trackerDoc.commission_report_task.map(t => t.commission_category)
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
    }, [trackerDoc?.commission_report_task, categoryData]);

    // Categories available to be ADDED
    const availableNewCategories: CategoryItem[] = useMemo(() => {
        if (!trackerDoc?.commission_report_task || !categoryData) return [];

        const activeCategoryNames = new Set(
            trackerDoc.commission_report_task.map(t => t.commission_category)
        );

        return categoryData.filter(masterCat =>
            !activeCategoryNames.has(masterCat.category_name) &&
            masterCat.category_name !== "Others" &&
            Array.isArray(masterCat.tasks) &&
            masterCat.tasks.length > 0
        );
    }, [trackerDoc?.commission_report_task, categoryData]);

    // --- Faceted Filter Options (Zone is handled by tabs, not filter) ---
    const facetFilterOptions = useMemo(() => ({
        commission_category: {
            title: "Category",
            options: activeCategoriesInTracker.map(c => ({ label: c.category_name, value: c.category_name })),
        },
        report_type: {
            title: "Report Type",
            options: [
                { label: "Field", value: "Field" },
                { label: "Vendor", value: "Vendor" },
            ],
        },
    }), [activeCategoriesInTracker]);

    // Search field options
    const searchFieldOptions = [
        { value: "task_name", label: "Report Name", default: true },
        { value: "commission_category", label: "Category" },
    ];

    // Master template map for the "Report" wizard column.
    const { map: masterTaskMap } = useMasterTaskMap();

    // Column definitions
    const columns = useMemo(
        () => getTaskTableColumns(
            setEditingTask,
            masterTaskMap,
            trackerId || '',
            refetchTracker,
            trackerDoc?.start_date || '',
        ),
        [masterTaskMap, trackerId, refetchTracker, trackerDoc?.start_date]
    );

    // Tasks awaiting approval — drives the Pending Approval tab.
    const approvalTasks = useMemo(
        () => (trackerDoc?.commission_report_task ?? []).filter(
            t => t.task_status === 'Pending Approval'
        ),
        [trackerDoc?.commission_report_task]
    );

    // Client-side TanStack Table instance
    const table = useReactTable({
        data: displayedTasks,
        columns,
        state: {
            columnFilters,
            sorting,
            pagination,
            globalFilter: searchTerm,
            rowSelection,
        },
        onColumnFiltersChange: setColumnFilters,
        onSortingChange: setSorting,
        onPaginationChange: setPagination,
        onGlobalFilterChange: setSearchTerm,
        onRowSelectionChange: setRowSelection,
        enableRowSelection: (hasEditStructureAccess || role === "Nirmaan Design Lead Profile")
            ? (row) => row.original.task_status !== 'Not Applicable'
            : false,
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
    const handleAddCategories = async (newTasks: Partial<CommissionReportTask>[]) => {
        if (!trackerDoc) return;
        const updatedTasks = [...(trackerDoc.commission_report_task || []), ...newTasks as CommissionReportTask[]];
        await handleParentDocSave({ commission_report_task: updatedTasks });
    };

    const handleDownloadReport = async (isFullReport: boolean = false) => {
        const printFormatName = "Project Commission Report";
        const params = new URLSearchParams({
            doctype: DOCTYPE,
            name: trackerId!,
            format: printFormatName,
            no_letterhead: "0",
            _lang: "en",
            phase: isFullReport ? "All" : activePhase, // Pass 'All' or current phase
        });

        const downloadUrl = `/api/method/frappe.utils.print_format.download_pdf?${params.toString()}`;

        try {
            toast({ title: "Generating PDF...", description: "Please wait while we generate your report." });

            const response = await fetch(downloadUrl);
            if (!response.ok) throw new Error('PDF generation failed.');

            const blob = await response.blob();

            const now = new Date();
            const dateStr = format(now, "dd_MMM_yyyy");
            const projectNameClean = (trackerDoc?.project_name || "Project").replace(/[^a-zA-Z0-9-_]/g, "_");

            const filename = `${projectNameClean}-${activePhase}-${dateStr}-CommissionReport.pdf`;

            const url = window.URL.createObjectURL(blob);
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
        await handleTaskSave(editingTask.name, { ...updatedFields });
    };

    if (isLoading) return <LoadingFallback />;

    if (error || !trackerDoc) return <AlertDestructive error={error} />;

    // Block direct URL access for non-privileged users to hidden trackers
    const isDependentUser = isRestrictedAssigneeRole;
    const isHiddenTracker = trackerDoc?.hide_commission_report === 1;

    if (isDependentUser && isHiddenTracker) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center">
                    <EyeOff className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                    <h2 className="text-lg font-semibold text-gray-900 mb-2">Access Restricted</h2>
                    <p className="text-sm text-gray-500 mb-4">This commission report is currently hidden.</p>
                    <Button variant="outline" onClick={() => navigate('/commission-tracker')}>
                        Back to List
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 md:p-4">
            {isCEOHold && <CEOHoldBanner className="mb-4 mx-4 md:mx-0" />}
            {/* ═══════════════════════════════════════════════════════════════
                HEADER / SUMMARY SECTION - Mobile Collapsible + Desktop Static
            ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border-b border-gray-200">

                {/* ─────────────────────────────────────────────────────────────
                    MOBILE VIEW: Collapsible (< sm breakpoint)
                ───────────────────────────────────────────────────────────── */}
                <div className="sm:hidden">
                    <Collapsible open={isMobileSummaryOpen} onOpenChange={setIsMobileSummaryOpen}>
                        {/* Always visible: Title + Toggle */}
                        <div className="px-4 py-3 flex items-center justify-between">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                                    Commission Report
                                </span>
                                <h1 className="text-base font-semibold text-gray-900 truncate max-w-[200px]">
                                    {trackerDoc.project_name}
                                </h1>
                            </div>
                            <CollapsibleTrigger asChild>
                                <button className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors">
                                    <span>Details</span>
                                    <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isMobileSummaryOpen ? 'rotate-180' : ''}`} />
                                </button>
                            </CollapsibleTrigger>
                        </div>

                        {/* Collapsible content: Meta pills + Actions */}
                        <CollapsibleContent>
                            <div className="px-4 pb-3 space-y-3 border-t border-gray-100">
                                {/* Meta Pills */}
                                <div className="flex flex-wrap items-center gap-2 pt-3 text-xs">
                                    {/* Start Date Pill */}
                                    <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-50 rounded border border-gray-200">
                                        <span className="text-gray-500">Start:</span>
                                        <span className="font-medium text-gray-700">{formatDeadlineShort(trackerDoc.start_date || '')}</span>
                                    </div>
                                    {/* Deadline Pill */}
                                    <div className="flex items-center gap-1.5 px-2 py-1 bg-red-50 rounded border border-red-200">
                                        <span className="text-gray-500">Deadline:</span>
                                        <span className="font-semibold text-red-700">{formatDeadlineShort(trackerDoc.overall_deadline || '')}</span>
                                        {!isRestrictedAssigneeRole && (
                                            <Edit
                                                className="h-3 w-3 text-red-400 hover:text-red-600 cursor-pointer"
                                                onClick={() => setIsProjectOverviewModalOpen(true)}
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* Mobile Reports completed */}
                                {totalTasks > 0 && (
                                    <div className="flex items-center gap-2 pt-3 border-t border-gray-100 text-sm">
                                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                                        <span className="text-gray-500">Reports Completed:</span>
                                        <span className="font-bold tabular-nums text-gray-800">{completedTasks}/{totalTasks}</span>
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-50">
                                    {hasEditStructureAccess && !isRestrictedAssigneeRole && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs gap-1"
                                            onClick={() => setIsAddCategoryModalOpen(true)}
                                            disabled={availableNewCategories.length === 0}
                                        >
                                            <Plus className="h-3 w-3" /> Category
                                        </Button>
                                    )}
                                    <Button
                                        variant="default"
                                        size="sm"
                                        className="h-7 text-xs gap-1 bg-red-600 hover:bg-red-700 ml-auto"
                                        onClick={() => handleDownloadReport(true)}
                                    >
                                        <Download className="h-3 w-3" /> Download Tracker
                                    </Button>
                                    {/* <TooltipProvider>
                                <Tooltip delayDuration={200}>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 text-xs gap-1"
                                            onClick={() => handleDownloadReport(undefined, true)}
                                        >
                                            <FileText className="h-3 w-3" /> Download Tracker
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="text-xs">
                                        Download full report for all zones
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider> */}
                                </div>
                            </div>
                        </CollapsibleContent>
                    </Collapsible>
                </div>

                {/* ─────────────────────────────────────────────────────────────
                    DESKTOP VIEW: Static two-row layout (≥ sm breakpoint)
                ───────────────────────────────────────────────────────────── */}
                <div className="hidden sm:block px-4 py-4 md:px-6">
                    {/* Row 1: Title + Actions */}
                    <div className="flex items-start justify-between gap-4">
                        <h1 className="min-w-0 truncate text-xl font-bold text-red-600">
                            {trackerDoc.project_name}
                        </h1>
                        <div className="flex items-center gap-2 shrink-0">
                            {hasEditStructureAccess && !isRestrictedAssigneeRole && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-xs gap-1"
                                    onClick={() => setIsAddCategoryModalOpen(true)}
                                    disabled={availableNewCategories.length === 0}
                                >
                                    <Plus className="h-3 w-3" /> Add Category
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-xs gap-1"
                                onClick={() => handleDownloadReport(true)}
                            >
                                <Download className="h-3 w-3" /> Download Tracker
                            </Button>
                        </div>
                    </div>

                    {/* Row 2: Meta — Start | Deadline | Reports Completed (under the project name) */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-gray-600">
                        <span>
                            Start: <span className="font-medium text-gray-800">{formatDeadlineShort(trackerDoc.start_date || '') || '--'}</span>
                        </span>
                        <span className="text-gray-300">|</span>
                        <span className="flex items-center gap-1">
                            Deadline: <span className="font-semibold text-red-700">{formatDeadlineShort(trackerDoc.overall_deadline || '') || '--'}</span>
                            {!isRestrictedAssigneeRole && (
                                <Edit
                                    className="h-3 w-3 text-blue-500 hover:text-blue-700 cursor-pointer"
                                    onClick={() => setIsProjectOverviewModalOpen(true)}
                                />
                            )}
                        </span>
                        {totalTasks > 0 && (
                            <>
                                <span className="text-gray-300">|</span>
                                <span>
                                    Reports Completed: <span className="font-semibold text-gray-800 tabular-nums">{completedTasks}/{totalTasks}</span>
                                </span>
                            </>
                        )}
                    </div>
                </div>
            </div>


            {/* ═══════════════════════════════════════════════════════════════
                STATUS FILTER TABS (All / per-status filter the table; Pending Approval, approver-only + last, opens the approvals queue)
            ═══════════════════════════════════════════════════════════════ */}
            <div className="bg-white border-b border-gray-200 px-4 py-2 md:px-6">
                <div className="flex items-center gap-1 overflow-x-auto">
                    {[
                        { key: 'All', label: 'All', count: flattenedTasks.length },
                        { key: 'Submitted', label: 'Submitted', count: statusCounts['Submitted'] || 0 },
                        { key: 'Pending', label: 'Pending', count: statusCounts['Pending'] || 0 },
                        { key: 'Client Accepted', label: 'Client Accepted', count: statusCounts['Client Accepted'] || 0 },
                    ].map(tab => {
                        const isActive = activeStatusTab === tab.key;
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setActiveStatusTab(tab.key)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${isActive ? 'bg-red-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                            >
                                <span>{tab.label}</span>
                                <span className={`text-xs tabular-nums ${isActive ? 'text-white/80' : 'text-gray-400'}`}>
                                    {String(tab.count).padStart(2, '0')}
                                </span>
                            </button>
                        );
                    })}
                    {isApprover && (
                        <>
                            <div className="h-5 w-px bg-gray-300 mx-1 shrink-0" />
                            <button
                                onClick={() => setActiveStatusTab('Pending Approval')}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${activeStatusTab === 'Pending Approval' ? 'bg-indigo-600 text-white' : 'text-indigo-600 hover:bg-indigo-50'}`}
                            >
                                <span>Pending Approval</span>
                                <span className={`text-xs tabular-nums ${activeStatusTab === 'Pending Approval' ? 'text-white/80' : 'text-indigo-400'}`}>
                                    {String(approvalTasks.length).padStart(2, '0')}
                                </span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                DATA TABLE
            ═══════════════════════════════════════════════════════════════ */}
            <div className="p-4 md:px-6 overflow-x-auto">
                {isApprover && activeStatusTab === 'Pending Approval' ? (
                    /* Pending Approval queue (same table as the list page, scoped to this project) */
                    <GlobalApprovalsTable trackerName={trackerId || ''} onRefresh={refetchTracker} />
                ) : (
                /* DataTable for all tasks */
                <DataTable<CommissionReportTask>
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
                    exportFileName={`${(trackerDoc?.project_name || "Project").replace(/[^a-zA-Z0-9]/g, '_')}_Tasks`}
                    onExport="default"
                    tableHeight="60vh"
                    showRowSelection={hasEditStructureAccess || role === "Nirmaan Design Lead Profile"}
                />
                )}
            </div>

            {/* --- MODALS --- */}
            {editingTask && (
                <TaskEditModal
                    isOpen={!!editingTask}
                    onOpenChange={(open) => { if (!open) setEditingTask(null); }}
                    task={editingTask}
                    onSave={inlineTaskSaveHandler}
                    usersList={usersList || []}
                    statusOptions={statusOptions}
                    existingTaskNames={getExistingTaskNames(trackerDoc)}
                    isRestrictedMode={false}
                />
            )}

            <AddCategoryModal
                isOpen={isAddCategoryModalOpen}
                onOpenChange={setIsAddCategoryModalOpen}
                availableCategories={availableNewCategories}
                onAdd={handleAddCategories}
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

export default ProjectCommissionReportDetail;
