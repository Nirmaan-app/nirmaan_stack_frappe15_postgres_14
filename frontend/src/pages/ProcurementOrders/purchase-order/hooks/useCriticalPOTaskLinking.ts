import { useMemo, useState, useCallback } from "react";
import { useFrappeGetDocList, useFrappeUpdateDoc } from "frappe-react-sdk";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { toast } from "@/components/ui/use-toast";

// Helper to parse associated_pos from string or object
const parseAssociatedPOs = (associated: any): string[] => {
  try {
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
};

export interface CategoryOption {
  label: string;
  value: string;
}

export interface TaskOption {
  label: string;
  value: string;
  data: CriticalPOTask;
}

// Type for cross-task PO conflict info
export interface POLinkedToOtherTask {
  taskName: string;
  itemName: string;
  category: string;
}

// Result type for multi-task linking operation
export interface LinkResult {
  success: boolean;
  linked: { task: string; itemName: string; status: 'linked' | 'already_linked' }[];
  failed: { task: string; itemName: string; error: any }[];
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
  error: unknown;
  hasCriticalPOSetup: boolean;
  isPoAlreadyLinked: boolean;

  // Options for react-select
  categoryOptions: CategoryOption[];
  taskOptions: TaskOption[];
  filteredTaskOptions: TaskOption[];

  // Selection state - NOW SUPPORTS MULTI-SELECT
  selectedCategory: CategoryOption | null;
  selectedTasks: TaskOption[];

  // Selection handlers
  setSelectedCategory: (option: CategoryOption | null) => void;
  setSelectedTasks: (options: TaskOption[]) => void;
  removeTask: (taskValue: string) => void;

  // Derived data
  selectedTasksDetails: CriticalPOTask[];
  linkedPOsToSelectedTasks: string[]; // Union of all POs linked to any selected task

  // Cross-task conflict detection (tasks this PO is already linked to, excluding selected)
  poLinkedToOtherTasks: POLinkedToOtherTask[];

  // Validation
  selectionValid: boolean; // True if selection meets minimum requirement

  // Actions - NOW LINKS TO ALL SELECTED TASKS
  linkPOToTasks: () => Promise<LinkResult>;
  isLinking: boolean;

  // Reset
  resetSelection: () => void;

  // Refetch
  mutate: () => Promise<any>;
}

/**
 * Hook to manage Critical PO Task linking during PO dispatch
 * Supports multi-select: allows linking a PO to multiple tasks at once
 */
export const useCriticalPOTaskLinking = ({
  projectId,
  poName,
  enabled = true,
}: UseCriticalPOTaskLinkingProps): UseCriticalPOTaskLinkingReturn => {
  // Selection state - MULTI-SELECT
  const [selectedCategory, setSelectedCategoryState] = useState<CategoryOption | null>(null);
  const [selectedTasks, setSelectedTasksState] = useState<TaskOption[]>([]);
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

  // Get selected tasks details (array of CriticalPOTask)
  const selectedTasksDetails = useMemo<CriticalPOTask[]>(() => {
    return selectedTasks.map((t) => t.data);
  }, [selectedTasks]);

  // Get union of all POs linked to any of the selected tasks
  const linkedPOsToSelectedTasks = useMemo<string[]>(() => {
    const allPOs = new Set<string>();
    selectedTasks.forEach((taskOption) => {
      const pos = parseAssociatedPOs(taskOption.data.associated_pos);
      pos.forEach((po) => allPOs.add(po));
    });
    return Array.from(allPOs);
  }, [selectedTasks]);

  // Check if this PO is already linked to tasks NOT in the current selection
  const poLinkedToOtherTasks = useMemo<POLinkedToOtherTask[]>(() => {
    const selectedTaskNames = new Set(selectedTasks.map((t) => t.value));
    return tasks
      .filter((t) => !selectedTaskNames.has(t.name)) // Exclude currently selected tasks
      .filter((t) => {
        const pos = parseAssociatedPOs(t.associated_pos);
        return pos.includes(poName);
      })
      .map((t) => ({
        taskName: t.name,
        itemName: t.item_name,
        category: t.critical_po_category,
      }));
  }, [tasks, selectedTasks, poName]);

  // Check if this PO is already linked to ANY task
  const isPoAlreadyLinked = useMemo<boolean>(() => {
    return tasks.some((task) => {
      const pos = parseAssociatedPOs(task.associated_pos);
      return pos.includes(poName);
    });
  }, [tasks, poName]);

  // Validation: is selection valid (meets minimum requirement)?
  const selectionValid = useMemo<boolean>(() => {
    // No Critical PO setup = no requirement
    if (!hasCriticalPOSetup) return true;
    // PO already linked to at least one task = valid
    if (isPoAlreadyLinked) return true;
    // Otherwise, need at least 1 task selected
    return selectedTasks.length >= 1;
  }, [hasCriticalPOSetup, isPoAlreadyLinked, selectedTasks]);

  // Handler for category selection - does NOT clear task selections (allows cross-category)
  const setSelectedCategory = useCallback((option: CategoryOption | null) => {
    setSelectedCategoryState(option);
    // Intentionally NOT clearing selectedTasks to allow cross-category selections
  }, []);

  // Handler for multi-select task selection
  const setSelectedTasks = useCallback((options: TaskOption[]) => {
    setSelectedTasksState(options);
  }, []);

  // Handler to remove a single task from selection
  const removeTask = useCallback((taskValue: string) => {
    setSelectedTasksState((prev) => prev.filter((t) => t.value !== taskValue));
  }, []);

  // Reset all selections
  const resetSelection = useCallback(() => {
    setSelectedCategoryState(null);
    setSelectedTasksState([]);
  }, []);

  // Link PO to ALL selected tasks using Promise.allSettled for parallel execution
  const linkPOToTasks = useCallback(async (): Promise<LinkResult> => {
    if (selectedTasks.length === 0) {
      toast({
        title: "No Tasks Selected",
        description: "Please select at least one task before linking.",
        variant: "destructive",
      });
      return { success: false, linked: [], failed: [] };
    }

    setIsLinking(true);

    try {
      const results = await Promise.allSettled(
        selectedTasks.map(async (taskOption) => {
          const task = taskOption.data;
          const currentPOs = parseAssociatedPOs(task.associated_pos);

          // Skip if PO is already linked to this task
          if (currentPOs.includes(poName)) {
            return {
              task: task.name,
              itemName: task.item_name,
              status: 'already_linked' as const,
            };
          }

          // Add PO to the task's associated_pos
          const updatedPOs = [...currentPOs, poName];
          await updateDoc("Critical PO Tasks", task.name, {
            associated_pos: JSON.stringify({ pos: updatedPOs }),
          });

          return {
            task: task.name,
            itemName: task.item_name,
            status: 'linked' as const,
          };
        })
      );

      // Separate successful and failed results
      const linked: LinkResult['linked'] = [];
      const failed: LinkResult['failed'] = [];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          linked.push(result.value);
        } else {
          failed.push({
            task: selectedTasks[index].data.name,
            itemName: selectedTasks[index].data.item_name,
            error: result.reason,
          });
        }
      });

      // Refresh data
      await mutate();

      // Show appropriate toast
      const newlyLinked = linked.filter((l) => l.status === 'linked').length;
      const alreadyLinked = linked.filter((l) => l.status === 'already_linked').length;

      if (failed.length === 0) {
        if (newlyLinked > 0) {
          toast({
            title: "Success",
            description: `PO linked to ${newlyLinked} task${newlyLinked > 1 ? 's' : ''}.${
              alreadyLinked > 0 ? ` (${alreadyLinked} already linked)` : ''
            }`,
            variant: "success",
          });
        } else if (alreadyLinked > 0) {
          toast({
            title: "Already Linked",
            description: `PO was already linked to all ${alreadyLinked} selected task${alreadyLinked > 1 ? 's' : ''}.`,
            variant: "default",
          });
        }
        return { success: true, linked, failed };
      } else {
        toast({
          title: newlyLinked > 0 ? "Partial Success" : "Linking Failed",
          description: `${newlyLinked} linked, ${failed.length} failed. Please retry.`,
          variant: "destructive",
        });
        return { success: false, linked, failed };
      }
    } catch (error: any) {
      console.error("Error linking PO to Critical Tasks:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to link PO to Critical PO Tasks.",
        variant: "destructive",
      });
      return { success: false, linked: [], failed: [] };
    } finally {
      setIsLinking(false);
    }
  }, [selectedTasks, poName, updateDoc, mutate]);

  return {
    // Data states
    tasks,
    isLoading,
    error,
    hasCriticalPOSetup,
    isPoAlreadyLinked,

    // Options for react-select
    categoryOptions,
    taskOptions,
    filteredTaskOptions,

    // Selection state
    selectedCategory,
    selectedTasks,

    // Selection handlers
    setSelectedCategory,
    setSelectedTasks,
    removeTask,

    // Derived data
    selectedTasksDetails,
    linkedPOsToSelectedTasks,

    // Cross-task conflict detection
    poLinkedToOtherTasks,

    // Validation
    selectionValid,

    // Actions
    linkPOToTasks,
    isLinking,

    // Reset
    resetSelection,

    // Refetch
    mutate,
  };
};
