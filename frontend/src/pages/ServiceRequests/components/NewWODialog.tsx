import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, MapPin, Building2, ArrowRight } from "lucide-react";
import { useFrappeGetDocList } from "frappe-react-sdk";

// UI Components
import ProjectSelect from "@/components/custom-select/project-select";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// State & Types
import { useDialogStore } from "@/zustand/useDialogStore";
import { Projects } from "@/types/NirmaanStack/Projects";
import { cn } from "@/lib/utils";

export function NewWODialog() {
    const navigate = useNavigate();
    const { newWODialog, setNewWODialog } = useDialogStore();

    const [selectedProject, setSelectedProject] = useState<{
        value: string;
        label: string;
    } | null>(null);

    // Fetch projects for additional details (location, status)
    const { data: projects } = useFrappeGetDocList<Projects>(
        "Projects",
        {
            fields: ["name", "project_name", "project_city", "project_state", "status"],
            filters: [["status", "not in", ["Completed", "Halted"]]],
            limit: 1000
        },
        newWODialog ? undefined : null // Only fetch when dialog is open
    );

    const projectDetails = projects?.find(p => p.name === selectedProject?.value);

    const handleClose = useCallback(() => {
        setNewWODialog(false);
        setSelectedProject(null);
    }, [setNewWODialog]);

    const handleProjectChange = useCallback((option: { value: string; label: string } | null) => {
        setSelectedProject(option);
    }, []);

    const handleContinue = useCallback(() => {
        if (selectedProject) {
            handleClose();
            navigate(`/service-requests/new/${selectedProject.value}`);
        }
    }, [selectedProject, navigate, handleClose]);

    return (
        <AlertDialog open={newWODialog} onOpenChange={(open) => { if (!open) handleClose(); }}>
            <AlertDialogContent className="max-w-[420px] p-0 gap-0 overflow-hidden border-0 shadow-2xl">
                {/* Header */}
                <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-6 py-5">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-500/20 ring-1 ring-blue-500/30">
                            <ClipboardList className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                            <AlertDialogTitle className="text-lg font-semibold text-white tracking-tight">
                                Create New Work Order
                            </AlertDialogTitle>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Select a project to continue
                            </p>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-4 bg-white dark:bg-slate-950">
                    {/* Project Select Section */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
                            <Building2 className="w-3.5 h-3.5" />
                            Select Project
                        </div>

                        <ProjectSelect
                            key={`wo-project-select-${newWODialog}`}
                            onChange={handleProjectChange}
                            universal={false}
                            usePortal
                        />
                    </div>

                    {/* Selected Project Badge */}
                    {selectedProject && projectDetails && (
                        <div className="rounded-lg p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">
                                        {selectedProject.value}
                                    </p>
                                    <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 truncate">
                                        {selectedProject.label}
                                    </p>
                                    {(projectDetails.project_city || projectDetails.project_state) && (
                                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-1 flex items-center gap-1">
                                            <MapPin className="w-3 h-3" />
                                            {[projectDetails.project_city, projectDetails.project_state].filter(Boolean).join(", ")}
                                        </p>
                                    )}
                                </div>
                                <Badge variant="outline" className="text-[10px] shrink-0 bg-white dark:bg-slate-900 border-blue-300">
                                    {projectDetails.status || "Active"}
                                </Badge>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-end gap-3">
                        <AlertDialogCancel
                            onClick={handleClose}
                            className="h-10 px-4 text-sm font-medium bg-white dark:bg-slate-800 hover:bg-slate-100"
                        >
                            Cancel
                        </AlertDialogCancel>
                        <Button
                            onClick={handleContinue}
                            disabled={!selectedProject}
                            className={cn(
                                "h-10 px-5 text-sm font-medium",
                                "bg-blue-600 hover:bg-blue-700 text-white",
                                "shadow-sm shadow-blue-600/20",
                                "disabled:opacity-50 disabled:cursor-not-allowed",
                                "transition-all duration-200"
                            )}
                        >
                            Continue
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                    </div>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
}
