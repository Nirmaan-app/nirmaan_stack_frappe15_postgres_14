import React, { useState } from "react";
import { CirclePlus, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NewTrackerModal } from "./NewTrackerModal";
import { useDesignMasters } from "../hooks/useDesignMasters";

interface NoDesignTrackerViewProps {
    projectId: string;
    projectName: string;
    onTrackerCreated: () => void;
}

export const NoDesignTrackerView: React.FC<NoDesignTrackerViewProps> = ({
    projectId,
    projectName,
    onTrackerCreated
}) => {
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Fetch necessary data for the modal
    const { projectOptions, projects, categoryData, mutateMasters } = useDesignMasters();

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
                                No Design Tracker Setup
                            </h3>
                            <p className="text-base text-gray-600 max-w-md">
                                Track and manage design tasks for <span className="font-semibold text-primary">{projectName}</span> by setting up a Design Tracker
                            </p>
                        </div>

                        {/* Features List */}
                        <div className="w-full max-w-md bg-gray-50 rounded-lg p-4 space-y-2">
                            <p className="text-sm font-semibold text-gray-700 mb-2">What you can do:</p>
                            <ul className="space-y-2 text-sm text-gray-600">
                                <li className="flex items-start">
                                    <span className="mr-2 text-red-700">•</span>
                                    <span>Organize design tasks by categories and zones</span>
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

                        {/* CTA Button */}
                        <Button
                            onClick={() => setIsModalOpen(true)}
                            size="lg"
                            className="text-base px-8 py-6 h-auto"
                        >
                            <CirclePlus className="h-5 w-5 mr-2" />
                            Setup Design Tracker
                        </Button>
                    </CardContent>
                </Card>
            </div>

            {/* Modal */}
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
        </>
    );
};
