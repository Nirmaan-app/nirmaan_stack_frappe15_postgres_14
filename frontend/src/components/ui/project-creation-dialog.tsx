import { CheckCircle2, Loader2, FolderPlus, Users, CirclePlus, Undo2, BadgeIndianRupee } from "lucide-react";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type CreationStage = "idle" | "creating_project" | "assigning_users" | "complete" | "error";

interface ProjectCreationDialogProps {
    open: boolean;
    stage: CreationStage;
    projectName?: string;
    assigneeCount?: number;
    errorMessage?: string;
    onGoBack: () => void;
    onCreateNew: () => void;
    onAddEstimates: () => void;
}

interface StageItemProps {
    label: string;
    isActive: boolean;
    isComplete: boolean;
    icon: React.ReactNode;
}

const StageItem: React.FC<StageItemProps> = ({ label, isActive, isComplete, icon }) => {
    return (
        <div className="flex items-center gap-3 py-3">
            <div
                className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300",
                    isComplete
                        ? "bg-emerald-100 text-emerald-600"
                        : isActive
                        ? "bg-sky-100 text-sky-600"
                        : "bg-gray-100 text-gray-400"
                )}
            >
                {isComplete ? (
                    <CheckCircle2 className="h-5 w-5" />
                ) : isActive ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                    icon
                )}
            </div>
            <span
                className={cn(
                    "text-sm font-medium transition-colors duration-200",
                    isComplete
                        ? "text-emerald-700"
                        : isActive
                        ? "text-gray-900"
                        : "text-gray-400"
                )}
            >
                {label}
                {isComplete && (
                    <span className="ml-2 text-xs text-emerald-600">Done</span>
                )}
                {isActive && (
                    <span className="ml-2 text-xs text-sky-600">In progress...</span>
                )}
            </span>
        </div>
    );
};

export const ProjectCreationDialog: React.FC<ProjectCreationDialogProps> = ({
    open,
    stage,
    projectName,
    assigneeCount = 0,
    errorMessage,
    onGoBack,
    onCreateNew,
    onAddEstimates,
}) => {
    const isCreatingProject = stage === "creating_project";
    const isAssigningUsers = stage === "assigning_users";
    const isComplete = stage === "complete";
    const isError = stage === "error";

    return (
        <AlertDialog open={open}>
            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-3">
                        {isComplete ? (
                            <>
                                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                                    <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                                </div>
                                <span className="text-emerald-700">Project Created!</span>
                            </>
                        ) : isError ? (
                            <>
                                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                                    <FolderPlus className="h-6 w-6 text-red-600" />
                                </div>
                                <span className="text-red-700">Creation Failed</span>
                            </>
                        ) : (
                            <>
                                <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center">
                                    <FolderPlus className="h-6 w-6 text-sky-600" />
                                </div>
                                <span>Creating Your Project</span>
                            </>
                        )}
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-1">
                            {isComplete ? (
                                <p className="text-sm text-gray-600">
                                    <span className="font-semibold text-gray-900">{projectName}</span> has been
                                    created successfully
                                    {assigneeCount > 0 && (
                                        <span>
                                            {" "}with{" "}
                                            <span className="font-medium text-sky-600">
                                                {assigneeCount} team member{assigneeCount !== 1 ? "s" : ""}
                                            </span>{" "}
                                            assigned
                                        </span>
                                    )}
                                    . You can now start adding project estimates.
                                </p>
                            ) : isError ? (
                                <p className="text-sm text-red-600">
                                    {errorMessage || "An error occurred while creating the project. Please try again."}
                                </p>
                            ) : (
                                <p className="text-sm text-gray-500">
                                    Please wait while we set up your project...
                                </p>
                            )}
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {/* Progress Stages */}
                {!isComplete && !isError && (
                    <div className="py-2 border-y border-gray-100">
                        <StageItem
                            label="Creating project"
                            isActive={isCreatingProject}
                            isComplete={isAssigningUsers || isComplete}
                            icon={<FolderPlus className="h-4 w-4" />}
                        />
                        <StageItem
                            label={`Assigning team members${assigneeCount > 0 ? ` (${assigneeCount})` : ""}`}
                            isActive={isAssigningUsers}
                            isComplete={isComplete}
                            icon={<Users className="h-4 w-4" />}
                        />
                    </div>
                )}

                {/* Success Actions */}
                {isComplete && (
                    <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                        <AlertDialogAction
                            onClick={onGoBack}
                            className="bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-2"
                        >
                            <Undo2 className="h-4 w-4" />
                            Go to Projects
                        </AlertDialogAction>
                        <AlertDialogAction
                            onClick={onCreateNew}
                            className="bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-2"
                        >
                            <CirclePlus className="h-4 w-4" />
                            Create Another
                        </AlertDialogAction>
                        <AlertDialogAction
                            onClick={onAddEstimates}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white flex items-center gap-2"
                        >
                            <BadgeIndianRupee className="h-4 w-4" />
                            Add Estimates
                        </AlertDialogAction>
                    </AlertDialogFooter>
                )}

                {/* Error Actions */}
                {isError && (
                    <AlertDialogFooter>
                        <AlertDialogAction
                            onClick={onGoBack}
                            className="bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                            Close
                        </AlertDialogAction>
                    </AlertDialogFooter>
                )}
            </AlertDialogContent>
        </AlertDialog>
    );
};

export default ProjectCreationDialog;
