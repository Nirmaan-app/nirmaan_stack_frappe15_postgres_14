import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useFrappeGetDocList, useFrappeDeleteDoc } from "frappe-react-sdk";
import { CriticalPOCategory } from "@/pages/CriticalPOCategories/components/CriticalPOCategoriesMaster";
import { CriticalPOTask } from "@/types/NirmaanStack/CriticalPOTasks";
import { useBulkCreateTasks } from "../hooks/useBulkCreateTasks";

interface ManageSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  projectStartDate?: string | null;
  existingTasks: CriticalPOTask[];
  onTasksUpdated: () => void;
}

export const ManageSetupDialog: React.FC<ManageSetupDialogProps> = ({
  open,
  onOpenChange,
  projectId,
  projectName,
  projectStartDate,
  existingTasks,
  onTasksUpdated,
}) => {
  // Separate state for adding and removing categories
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [selectedToRemove, setSelectedToRemove] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<"add" | "remove" | null>(null);

  const { createTasksForCategories } = useBulkCreateTasks();
  const { deleteDoc } = useFrappeDeleteDoc();

  // Fetch all Critical PO Categories
  const {
    data: categories,
    isLoading: categoriesLoading,
  } = useFrappeGetDocList<CriticalPOCategory>("Critical PO Category", {
    fields: ["name", "category_name"],
    limit: 0,
    orderBy: { field: "category_name", order: "asc" },
  });

  // Get categories that already have tasks
  const existingCategories = useMemo(() => {
    return new Set(existingTasks.map((task) => task.critical_po_category));
  }, [existingTasks]);

  // Categories available to add (not yet in project)
  const availableCategories = useMemo(() => {
    return categories?.filter((cat) => !existingCategories.has(cat.name)) || [];
  }, [categories, existingCategories]);

  // Categories that can be removed (already in project)
  const removableCategories = useMemo(() => {
    return categories?.filter((cat) => existingCategories.has(cat.name)) || [];
  }, [categories, existingCategories]);

  const handleAddToggle = (categoryId: string) => {
    const newSelected = new Set(selectedToAdd);
    if (newSelected.has(categoryId)) {
      newSelected.delete(categoryId);
    } else {
      newSelected.add(categoryId);
    }
    setSelectedToAdd(newSelected);
  };

  const handleRemoveToggle = (categoryId: string) => {
    const newSelected = new Set(selectedToRemove);
    if (newSelected.has(categoryId)) {
      newSelected.delete(categoryId);
    } else {
      newSelected.add(categoryId);
    }
    setSelectedToRemove(newSelected);
  };

  const handleAddCategories = () => {
    if (selectedToAdd.size === 0) {
      toast({
        title: "No Categories Selected",
        description: "Please select at least one category to add.",
        variant: "destructive",
      });
      return;
    }
    setPendingAction("add");
    setShowConfirmDialog(true);
  };

  const handleRemoveCategories = () => {
    if (selectedToRemove.size === 0) {
      toast({
        title: "No Categories Selected",
        description: "Please select at least one category to remove.",
        variant: "destructive",
      });
      return;
    }
    setPendingAction("remove");
    setShowConfirmDialog(true);
  };

  const confirmAction = async () => {
    if (!projectStartDate) {
      toast({
        title: "Error",
        description: "Project start date is missing.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setShowConfirmDialog(false);

    try {
      if (pendingAction === "add") {
        // Add new categories
        const result = await createTasksForCategories({
          selectedCategoryIds: Array.from(selectedToAdd),
          projectId,
          projectName,
          projectStartDate,
        });

        if (result.success) {
          toast({
            title: "Success",
            description: `Added ${result.count} new task(s) successfully.`,
            variant: "success",
          });
        } else {
          toast({
            title: "Error",
            description: result.error || "Failed to add categories.",
            variant: "destructive",
          });
        }
      } else if (pendingAction === "remove") {
        // Remove categories (delete associated tasks)
        const tasksToDelete = existingTasks.filter((task) =>
          selectedToRemove.has(task.critical_po_category)
        );

        let deletedCount = 0;
        for (const task of tasksToDelete) {
          try {
            await deleteDoc("Critical PO Tasks", task.name);
            deletedCount++;
          } catch (error) {
            console.error(`Failed to delete task ${task.name}:`, error);
          }
        }

        toast({
          title: "Success",
          description: `Removed ${deletedCount} task(s) successfully.`,
          variant: "success",
        });
      }

      setSelectedToAdd(new Set());
      setSelectedToRemove(new Set());
      onTasksUpdated();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setPendingAction(null);
    }
  };

  const handleCancel = () => {
    setSelectedToAdd(new Set());
    setSelectedToRemove(new Set());
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Critical PO Setup</DialogTitle>
            <DialogDescription>
              Add new categories or remove existing ones. Removing a category will delete all associated tasks.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-6">
            {categoriesLoading ? (
              <div className="flex justify-center items-center h-32">
                <TailSpin width={40} height={40} color="#dc2626" />
              </div>
            ) : (
              <>
                {/* Add Categories Section */}
                {availableCategories.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700">
                      Add Categories ({availableCategories.length} available)
                    </h3>

                    {/* Info Message */}
                    <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-md">
                      <div className="flex items-start gap-2">
                        <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-blue-700">
                          PO release deadlines will be calculated based on the project start date and each item's timeline offset.
                        </p>
                      </div>
                    </div>

                    <div className="border rounded-md p-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {availableCategories.map((category) => {
                          const isSelected = selectedToAdd.has(category.name);
                          return (
                            <Button
                              key={category.name}
                              type="button"
                              variant={isSelected ? "default" : "outline"}
                              onClick={() => handleAddToggle(category.name)}
                              size="sm"
                              className="text-xs h-auto py-2 whitespace-normal min-h-[40px] justify-start"
                            >
                              <span className="truncate">{category.category_name}</span>
                            </Button>
                          );
                        })}
                      </div>

                      {selectedToAdd.size > 0 && (
                        <p className="text-xs text-gray-500 mt-3">
                          {selectedToAdd.size} categor{selectedToAdd.size !== 1 ? 'ies' : 'y'} selected to add
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Remove Categories Section */}
                {removableCategories.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700">
                      Remove Categories ({removableCategories.length} in use)
                    </h3>

                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Warning: Removing a category will permanently delete all associated tasks.
                      </AlertDescription>
                    </Alert>

                    <div className="border rounded-md p-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {removableCategories.map((category) => {
                          const taskCount = existingTasks.filter(
                            (t) => t.critical_po_category === category.name
                          ).length;
                          const isSelected = selectedToRemove.has(category.name);
                          return (
                            <Button
                              key={category.name}
                              type="button"
                              variant={isSelected ? "destructive" : "outline"}
                              onClick={() => handleRemoveToggle(category.name)}
                              size="sm"
                              className="text-xs h-auto py-2 whitespace-normal min-h-[40px] justify-start"
                            >
                              <span className="truncate">{category.category_name}</span>
                              <span className="ml-1 text-[10px] opacity-70">({taskCount})</span>
                            </Button>
                          );
                        })}
                      </div>

                      {selectedToRemove.size > 0 && (
                        <p className="text-xs text-red-600 mt-3">
                          {selectedToRemove.size} categor{selectedToRemove.size !== 1 ? 'ies' : 'y'} selected to remove
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {availableCategories.length === 0 && removableCategories.length === 0 && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      No categories available. All categories are already set up for this project.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <div className="flex justify-end items-center w-full gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isProcessing}
              >
                Cancel
              </Button>
              {availableCategories.length > 0 && (
                <Button
                  type="button"
                  onClick={handleAddCategories}
                  disabled={isProcessing || selectedToAdd.size === 0}
                >
                  Add Selected
                </Button>
              )}
              {removableCategories.length > 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleRemoveCategories}
                  disabled={isProcessing || selectedToRemove.size === 0}
                >
                  Remove Selected
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === "add" ? "Add Categories?" : "Remove Categories?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === "add" ? (
                <>
                  This will create new tasks for <strong>{selectedToAdd.size}</strong>{" "}
                  category(s). You can continue with this action.
                </>
              ) : (
                <>
                  This will permanently delete all tasks associated with{" "}
                  <strong>{selectedToRemove.size}</strong> category(s).{" "}
                  <strong className="text-red-600">This action cannot be undone.</strong>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAction}
              className={pendingAction === "remove" ? "bg-red-600 hover:bg-red-700" : ""}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
