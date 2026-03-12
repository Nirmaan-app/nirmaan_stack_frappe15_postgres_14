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

  // Already-linked tasks (read-only display, separate from multi-select)
  initiallyLinkedTasks: TaskOption[];

  // Selection state for NEW tasks only (multi-select)
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

  // Actions — add-only linking for new tasks
  linkPOToTasks: () => Promise<LinkResult>;
  isLinking: boolean;

  // Explicit unlink for a single already-linked task
  unlinkTask: (taskName: string) => Promise<boolean>;

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

  // Tasks already linked to this PO (read-only display)
  const initiallyLinkedTasks = useMemo<TaskOption[]>(() => {
    return taskOptions.filter((option) => {
      const pos = parseAssociatedPOs(option.data.associated_pos);
      return pos.includes(poName);
    });
  }, [taskOptions, poName]);

  const initiallyLinkedTaskNames = useMemo<Set<string>>(() => {
    return new Set(initiallyLinkedTasks.map((t) => t.value));
  }, [initiallyLinkedTasks]);

  // Filter task options by selected category, excluding already-linked tasks
  const filteredTaskOptions = useMemo<TaskOption[]>(() => {
    let options = taskOptions.filter((o) => !initiallyLinkedTaskNames.has(o.value));
    if (selectedCategory) {
      options = options.filter(
        (option) => option.data.critical_po_category === selectedCategory.value
      );
    }
    return options;
  }, [taskOptions, selectedCategory, initiallyLinkedTaskNames]);

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
    if (!hasCriticalPOSetup) return true;
    // Already linked to at least one task = valid even with 0 new selections
    if (isPoAlreadyLinked) return true;
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

  // Link PO to ALL newly selected tasks (add-only, never removes existing links)
  const linkPOToTasks = useCallback(async (): Promise<LinkResult> => {
    if (selectedTasks.length === 0) {
      return { success: true, linked: [], failed: [] };
    }

    setIsLinking(true);

    try {
      const results = await Promise.allSettled(
        selectedTasks.map(async (taskOption) => {
          const task = taskOption.data;
          const currentPOs = parseAssociatedPOs(task.associated_pos);

          if (currentPOs.includes(poName)) {
            return { task: task.name, itemName: task.item_name, status: 'already_linked' as const };
          }

          const updatedPOs = [...currentPOs, poName];
          await updateDoc("Critical PO Tasks", task.name, {
            associated_pos: JSON.stringify({ pos: updatedPOs }),
          });
          return { task: task.name, itemName: task.item_name, status: 'linked' as const };
        })
      );

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

      await mutate();

      const newlyLinked = linked.filter((l) => l.status === 'linked').length;

      if (failed.length === 0) {
        if (newlyLinked > 0) {
          toast({
            title: "Success",
            description: `PO linked to ${newlyLinked} task${newlyLinked > 1 ? 's' : ''}.`,
            variant: "success",
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

  // Explicit unlink: remove PO from a single already-linked task
  const unlinkTask = useCallback(async (taskName: string): Promise<boolean> => {
    const task = tasks.find((t) => t.name === taskName);
    if (!task) return false;

    setIsLinking(true);
    try {
      const currentPOs = parseAssociatedPOs(task.associated_pos);
      const updatedPOs = currentPOs.filter((po) => po !== poName);

      await updateDoc("Critical PO Tasks", taskName, {
        associated_pos: JSON.stringify({ pos: updatedPOs }),
      });

      await mutate();

      toast({
        title: "Unlinked",
        description: `PO unlinked from "${task.item_name}".`,
        variant: "success",
      });
      return true;
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to unlink PO from task.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsLinking(false);
    }
  }, [tasks, poName, updateDoc, mutate]);

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

    // Already-linked tasks (read-only display)
    initiallyLinkedTasks,

    // Selection state (new tasks only)
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
    unlinkTask,

    // Reset
    resetSelection,

    // Refetch
    mutate,
  };
};
