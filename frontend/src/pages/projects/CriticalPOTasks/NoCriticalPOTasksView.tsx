import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";
import { TailSpin } from "react-loader-spinner";
import { ClipboardList, AlertCircle, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { CriticalPOCategory } from "@/pages/CriticalPOCategories/components/CriticalPOCategoriesMaster";
import { useBulkCreateTasks } from "./hooks/useBulkCreateTasks";
import { isValidProjectStartDate } from "./utils/calculatePODate";

interface NoCriticalPOTasksViewProps {
  projectId: string;
  projectName: string;
  projectStartDate?: string | null;
  onTasksCreated: () => void;
}

export const NoCriticalPOTasksView: React.FC<NoCriticalPOTasksViewProps> = ({
  projectId,
  projectName,
  projectStartDate,
  onTasksCreated,
}) => {
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [isCreatingTasks, setIsCreatingTasks] = useState(false);

  const { createTasksForCategories } = useBulkCreateTasks();

  // Fetch all Critical PO Categories
  const {
    data: categories,
    isLoading: categoriesLoading,
    error: categoriesError,
  } = useFrappeGetDocList<CriticalPOCategory>("Critical PO Category", {
    fields: ["name", "category_name"],
    limit: 0,
    orderBy: { field: "category_name", order: "asc" },
  });

  const hasValidStartDate = isValidProjectStartDate(projectStartDate);

  const handleCategoryToggle = (categoryId: string) => {
    const newSelected = new Set(selectedCategories);
    if (newSelected.has(categoryId)) {
      newSelected.delete(categoryId);
    } else {
      newSelected.add(categoryId);
    }
    setSelectedCategories(newSelected);
  };

  const handleSetupClick = () => {
    if (!hasValidStartDate) {
      toast({
        title: "Missing Project Start Date",
        description: "Please set a project start date before setting up Critical PO tasks.",
        variant: "destructive",
      });
      return;
    }
    setSetupDialogOpen(true);
  };

  const handleGenerateTasks = async () => {
    if (selectedCategories.size === 0) {
      toast({
        title: "No Categories Selected",
        description: "Please select at least one category to generate tasks.",
        variant: "destructive",
      });
      return;
    }

    if (!projectStartDate) {
      toast({
        title: "Error",
        description: "Project start date is missing.",
        variant: "destructive",
      });
      return;
    }

    setIsCreatingTasks(true);

    try {
      const result = await createTasksForCategories({
        selectedCategoryIds: Array.from(selectedCategories),
        projectId,
        projectName,
        projectStartDate,
      });

      if (result.success) {
        toast({
          title: "Success",
          description: `Created ${result.count} Critical PO task(s) successfully.`,
          variant: "success",
        });
        setSetupDialogOpen(false);
        setSelectedCategories(new Set());
        onTasksCreated();
      } else {
        toast({
          title: "Error",
          description: result.error || "Failed to create tasks.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsCreatingTasks(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[400px] p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <ClipboardList className="h-16 w-16 text-gray-400" />
          </div>
          <CardTitle className="text-2xl">No Critical PO Tasks Setup</CardTitle>
          <CardDescription className="text-base mt-2">
            Set up critical PO tracking for this project by selecting applicable categories.
            Tasks will be generated based on the configured items and timelines.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center space-y-4">
          {!hasValidStartDate && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Project start date is missing or invalid. Please set a valid start date in the project settings before proceeding.
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleSetupClick}
            disabled={!hasValidStartDate}
            className="bg-primary hover:bg-primary/90"
            size="lg"
          >
            Setup Critical PO Tasks
          </Button>

          <p className="text-sm text-gray-500 text-center mt-2">
            You can add or modify categories later from the setup menu.
          </p>
        </CardContent>
      </Card>

      {/* Category Selection Dialog */}
      <Dialog open={setupDialogOpen} onOpenChange={setSetupDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Select Critical PO Categories</DialogTitle>
            <DialogDescription>
              Choose the categories applicable to this project. Tasks will be created for all items within the selected categories.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {/* Info Message */}
            <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-md">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-700">
                  PO release deadlines will be automatically calculated based on the project start date and each item's timeline offset.
                </p>
              </div>
            </div>

            {categoriesLoading ? (
              <div className="flex justify-center items-center h-32">
                <TailSpin width={40} height={40} color="#dc2626" />
              </div>
            ) : categoriesError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Failed to load categories: {categoriesError.message}
                </AlertDescription>
              </Alert>
            ) : categories && categories.length > 0 ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {categories.map((category) => {
                    const isSelected = selectedCategories.has(category.name);
                    return (
                      <Button
                        key={category.name}
                        type="button"
                        variant={isSelected ? "default" : "outline"}
                        onClick={() => handleCategoryToggle(category.name)}
                        size="sm"
                        className="text-xs h-auto py-2 whitespace-normal min-h-[40px] justify-start"
                      >
                        <span className="truncate">{category.category_name}</span>
                      </Button>
                    );
                  })}
                </div>

                {selectedCategories.size > 0 && (
                  <p className="text-xs text-gray-500">
                    {selectedCategories.size} categor{selectedCategories.size !== 1 ? 'ies' : 'y'} selected
                  </p>
                )}

                {selectedCategories.size === 0 && (
                  <p className="text-xs text-amber-600">
                    Select at least one category
                  </p>
                )}
              </div>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No Critical PO Categories found. Please create categories first in the Admin settings.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <div className="flex justify-end items-center w-full">
              <div className="space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSetupDialogOpen(false)}
                  disabled={isCreatingTasks}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleGenerateTasks}
                  disabled={isCreatingTasks || selectedCategories.size === 0}
                >
                  {isCreatingTasks ? (
                    <>
                      <TailSpin height={16} width={16} color="white" />
                      <span className="ml-2">Generating...</span>
                    </>
                  ) : (
                    "Generate Tasks"
                  )}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
