import { useMemo, useState, useCallback } from "react";
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { toast } from "@/components/ui/use-toast";

export interface CategoryOption {
  label: string;
  value: string;
}

export interface TaskOption {
  label: string;
  value: string;
  data: CriticalPOTask;
}

export interface UseCriticalPOTaskLinkingProps {
  projectId: string;
  poName: string;
  enabled?: boolean;
}

export interface UseCriticalPOTaskLinkingReturn {
  // Data states
  tasks: CriticalPOTask[];
  isLoading: boolean;
  error: Error | null;
  hasCriticalPOSetup: boolean;

  // Options for react-select
  categoryOptions: CategoryOption[];
  taskOptions: TaskOption[];
  filteredTaskOptions: TaskOption[];

  // Selection state
  selectedCategory: CategoryOption | null;
  selectedTask: TaskOption | null;
  selectedStatus: "Partially Released" | "Released" | null;

  // Selection handlers
  setSelectedCategory: (option: CategoryOption | null) => void;
  setSelectedTask: (option: TaskOption | null) => void;
  setSelectedStatus: (status: "Partially Released" | "Released" | null) => void;

  // Derived data
  selectedTaskDetails: CriticalPOTask | null;
  linkedPOsToSelectedTask: string[];

  // Actions
  linkPOToTask: () => Promise<boolean>;
  isLinking: boolean;

  // Reset
  resetSelection: () => void;

  // Refetch
  mutate: () => Promise<any>;
}

/**
 * Hook to manage Critical PO Task linking during PO dispatch
 */
export const useCriticalPOTaskLinking = ({
  projectId,
  poName,
  enabled = true,
}: UseCriticalPOTaskLinkingProps): UseCriticalPOTaskLinkingReturn => {
  // Selection state
  const [selectedCategory, setSelectedCategoryState] = useState<CategoryOption | null>(null);
  const [selectedTask, setSelectedTaskState] = useState<TaskOption | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<"Partially Released" | "Released" | null>(null);
  const [isLinking, setIsLinking] = useState(false);

  const { updateDoc } = useFrappeUpdateDoc();

  // Fetch Critical PO Tasks for the project
  const {
    data: tasks = [],
    isLoading,
    error,
    mutate,
  } = useFrappeGetDocList<CriticalPOTask>("Critical PO Tasks", {
    fields: [
      "name",
      "project",
      "critical_po_category",
      "project_name",
      "item_name",
      "sub_category",
      "po_release_date",
      "status",
      "associated_pos",
      "revised_date",
      "remarks",
    ],
    filters: [["project", "=", projectId]],
    limit: 0,
    orderBy: { field: "po_release_date", order: "asc" },
  }, enabled ? undefined : null);

  // Check if Critical PO setup exists
  const hasCriticalPOSetup = tasks.length > 0;

  // Extract unique categories for dropdown
  const categoryOptions = useMemo<CategoryOption[]>(() => {
    const uniqueCategories = [...new Set(tasks.map((t) => t.critical_po_category))];
    return uniqueCategories
      .filter(Boolean)
      .sort()
      .map((cat) => ({
        label: cat,
        value: cat,
      }));
  }, [tasks]);

  // Create task options with "Item Name (SubCategory)" format
  const taskOptions = useMemo<TaskOption[]>(() => {
    return tasks.map((task) => ({
      label: task.sub_category
        ? `${task.item_name} (${task.sub_category})`
        : task.item_name,
      value: task.name,
      data: task,
    }));
  }, [tasks]);

  // Filter task options by selected category
  const filteredTaskOptions = useMemo<TaskOption[]>(() => {
    if (!selectedCategory) {
      return taskOptions;
    }
    return taskOptions.filter(
      (option) => option.data.critical_po_category === selectedCategory.value
    );
  }, [taskOptions, selectedCategory]);

  // Get selected task details
  const selectedTaskDetails = useMemo<CriticalPOTask | null>(() => {
    return selectedTask?.data || null;
  }, [selectedTask]);

  // Get linked POs to selected task
  const linkedPOsToSelectedTask = useMemo<string[]>(() => {
    if (!selectedTaskDetails?.associated_pos) return [];

    try {
      const associated = selectedTaskDetails.associated_pos;
      if (typeof associated === "string") {
        const parsed = JSON.parse(associated);
        return parsed?.pos || [];
      } else if (associated && typeof associated === "object") {
        return associated.pos || [];
      }
      return [];
    } catch {
      return [];
    }
  }, [selectedTaskDetails]);

  // Handler for category selection
  const setSelectedCategory = useCallback((option: CategoryOption | null) => {
    setSelectedCategoryState(option);
    // Clear task selection when category changes
    setSelectedTaskState(null);
    setSelectedStatus(null);
  }, []);

  // Handler for task selection - auto-set category if not already set
  const setSelectedTask = useCallback((option: TaskOption | null) => {
    setSelectedTaskState(option);

    if (option && !selectedCategory) {
      // Auto-set category from task
      const taskCategory = option.data.critical_po_category;
      const matchingCategory = categoryOptions.find((c) => c.value === taskCategory);
      if (matchingCategory) {
        setSelectedCategoryState(matchingCategory);
      }
    }

    // Reset status when task changes
    setSelectedStatus(null);
  }, [selectedCategory, categoryOptions]);

  // Reset all selections
  const resetSelection = useCallback(() => {
    setSelectedCategoryState(null);
    setSelectedTaskState(null);
    setSelectedStatus(null);
  }, []);

  // Link PO to the selected task
  const linkPOToTask = useCallback(async (): Promise<boolean> => {
    if (!selectedTaskDetails || !selectedStatus) {
      toast({
        title: "Incomplete Selection",
        description: "Please select a task and status before linking.",
        variant: "destructive",
      });
      return false;
    }

    setIsLinking(true);

    try {
      // Get current linked POs and add this PO
      const currentPOs = linkedPOsToSelectedTask;

      // Check if PO is already linked
      if (currentPOs.includes(poName)) {
        toast({
          title: "Already Linked",
          description: "This PO is already linked to the selected task.",
          variant: "destructive",
        });
        setIsLinking(false);
        return false;
      }

      const updatedPOs = [...currentPOs, poName];

      // Update the Critical PO Task
      await updateDoc("Critical PO Tasks", selectedTaskDetails.name, {
        associated_pos: JSON.stringify({ pos: updatedPOs }),
        status: selectedStatus,
      });

      toast({
        title: "Success",
        description: `PO linked to "${selectedTaskDetails.item_name}" and status updated to "${selectedStatus}".`,
        variant: "success",
      });

      await mutate();
      return true;
    } catch (error: any) {
      console.error("Error linking PO to Critical Task:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to link PO to Critical PO Task.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLinking(false);
    }
  }, [selectedTaskDetails, selectedStatus, linkedPOsToSelectedTask, poName, updateDoc, mutate]);

  return {
    // Data states
    tasks,
    isLoading,
    error,
    hasCriticalPOSetup,

    // Options for react-select
    categoryOptions,
    taskOptions,
    filteredTaskOptions,

    // Selection state
    selectedCategory,
    selectedTask,
    selectedStatus,

    // Selection handlers
    setSelectedCategory,
    setSelectedTask,
    setSelectedStatus,

    // Derived data
    selectedTaskDetails,
    linkedPOsToSelectedTask,

    // Actions
    linkPOToTask,
    isLinking,

    // Reset
    resetSelection,

    // Refetch
    mutate,
  };
};
