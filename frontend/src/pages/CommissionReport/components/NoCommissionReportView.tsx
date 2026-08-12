import React, { useMemo, useState } from "react";
import { CirclePlus, Layers, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NewTrackerModal } from "./NewTrackerModal";
import { useCommissionMasters } from "../hooks/useCommissionMasters";
import { useUserData } from "@/hooks/useUserData";

interface NoCommissionReportViewProps {
    projectId: string;
    projectName: string;
    onTrackerCreated: () => void;
}

export const NoCommissionReportView: React.FC<NoCommissionReportViewProps> = ({
    projectId,
    projectName,
    onTrackerCreated
}) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { role, user_id } = useUserData();

    // Creating a Commission Report is ADMIN-ONLY. Every other role still reaches
    // this tab (so they can see the report once it exists) but gets a message
    // instead of the create button. `role` is the literal "Loading" while the
    // Nirmaan Users doc is in flight -- gate on it so a non-admin never sees the
    // button flash. UX gate only; the doctype permissions are the real boundary.
    const roleResolved = role !== "Loading" && role !== "Error";
    const isAdmin = useMemo(
        () => user_id === "Administrator" || role === "Nirmaan Admin Profile",
        [role, user_id]
    );

    // Fetch necessary data for the modal
    const { projectOptions, projects, categoryData, mutateMasters } = useCommissionMasters();

    const handleSuccess = () => {
        onTrackerCreated();
        if (mutateMasters) mutateMasters();
    };

    return (
        <>
            <div className="flex flex-col items-center justify-center min-h-[400px] p-8">
                <Card className="w-full max-w-2xl border-dashed border-2">
                    <CardContent className="flex flex-col items-center justify-center py-12 px-6 space-y-6">
                        {/* Icon */}
                        <div className="rounded-full bg-red-50 p-6">
                            <Layers className="h-12 w-12 text-red-700" />
                        </div>

                        {/* Content */}
                        <div className="text-center space-y-3">
                            <h3 className="text-2xl font-bold text-gray-900">
                                Commission Report Not Found
                            </h3>
                            <p className="text-base text-gray-600 max-w-md">
                                Track and manage commission tasks for <span className="font-semibold text-primary">{projectName}</span> by setting up a Commission Report
                            </p>
                        </div>

                        {/* Features List */}
                        <div className="w-full max-w-md bg-gray-50 rounded-lg p-4 space-y-2">
                            <p className="text-sm font-semibold text-gray-700 mb-2">What you can do:</p>
                            <ul className="space-y-2 text-sm text-gray-600">
                                <li className="flex items-start">
                                    <span className="mr-2 text-red-700">•</span>
                                    <span>Organize commission tasks by categories and zones</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="mr-2 text-red-700">•</span>
                                    <span>Assign designers and track progress</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="mr-2 text-red-700">•</span>
                                    <span>Set deadlines and monitor completion status</span>
                                </li>
                                <li className="flex items-start">
                                    <span className="mr-2 text-red-700">•</span>
                                    <span>Generate reports and export data</span>
                                </li>
                            </ul>
                        </div>

                        {/* CTA Button -- ADMIN ONLY; everyone else gets the notice below. */}
                        {roleResolved && (isAdmin ? (
                            <Button
                                onClick={() => setIsModalOpen(true)}
                                size="lg"
                                className="text-base px-8 py-6 h-auto"
                            >
                                <CirclePlus className="h-5 w-5 mr-2" />
                                Create Commission Report
                            </Button>
                        ) : (
                            <div className="flex items-start gap-3 w-full max-w-md rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                                <Lock className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                                <p className="text-sm text-amber-800">
                                    Only an <span className="font-semibold">Admin</span> can create a Commission Report.
                                    Please contact an Admin to set one up for this project.
                                </p>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>

            {/* Modal -- mounted for admins only, so a non-admin has no way to open it. */}
            {isAdmin && (
                <NewTrackerModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    projectOptions={projectOptions}
                    projects={projects}
                    categoryData={categoryData}
                    preSelectedProjectId={projectId}
                    preSelectedProjectName={projectName}
                    onSuccess={handleSuccess}
                />
            )}
        </>
    );
};
