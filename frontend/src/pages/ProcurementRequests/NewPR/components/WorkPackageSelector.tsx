import React, { useState } from 'react';
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { SelectedHeaderTag } from '../types';
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Projects } from '@/types/NirmaanStack/Projects';

interface PRTagHeader {
    name: string;
    pr_header: string;
    tag_package: string;
}

interface WorkPackageSelectorProps {
    onSelectHeaders: (headers: SelectedHeaderTag[]) => void;
    project?: Projects;
}

export const WorkPackageSelector: React.FC<WorkPackageSelectorProps> = ({ onSelectHeaders, project }) => {
    const [selectedHeaderNames, setSelectedHeaderNames] = useState<string[]>([]);

    const { data: headers, isLoading } = useFrappeGetDocList<PRTagHeader>("PR Tag Headers", {
        fields: ["name", "pr_header", "tag_package"],
        limit: 0,
        orderBy: { field: "pr_header", order: "asc" }
    });

    const filteredHeaders = React.useMemo(() => {
        if (!headers || !project?.project_wp_category_makes) return [];
        const projectPackages = new Set(project.project_wp_category_makes.map(m => m.procurement_package));
        return headers.filter(h => projectPackages.has(h.tag_package));
    }, [headers, project]);

    if (isLoading) {
        return <div className="p-4 text-center">Loading Headers...</div>;
    }

    if (filteredHeaders.length === 0) {
        return <div className="p-4 text-center text-gray-500">No PR Headers available for this project's packages.</div>;
    }

    const toggleHeader = (headerName: string) => {
        setSelectedHeaderNames(prev =>
            prev.includes(headerName)
                ? prev.filter(name => name !== headerName)
                : [...prev, headerName]
        );
    };

    const handleConfirm = () => {
        const selectedHeaders = filteredHeaders
            .filter(h => selectedHeaderNames.includes(h.name))
            .map(h => ({
                tag_header: h.pr_header,
                tag_package: h.tag_package
            }));
        onSelectHeaders(selectedHeaders);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Select PR Headers</h3>
                <Button 
                    onClick={handleConfirm} 
                    disabled={selectedHeaderNames.length === 0}
                    className="bg-slate-900 text-white"
                >
                    Confirm Selection ({selectedHeaderNames.length})
                </Button>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {filteredHeaders.map((item) => {
                    const isSelected = selectedHeaderNames.includes(item.name);
                    return (
                        <Card
                            key={item.name}
                            className={cn(
                                "relative flex flex-col items-center shadow-sm text-center border transition-all cursor-pointer hover:shadow-md",
                                isSelected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-gray-200"
                            )}
                            onClick={() => toggleHeader(item.name)}
                        >
                            {isSelected && (
                                <div className="absolute top-2 right-2 bg-primary text-white p-1 rounded-full">
                                    <Check className="w-3 h-3" />
                                </div>
                            )}
                            <CardHeader className="flex flex-col items-center justify-center space-y-0 p-6 w-full">
                                <CardTitle className="text-sm font-medium text-slate-900 break-words">
                                    {item.pr_header}
                                </CardTitle>
                                <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-tight">
                                    {item.tag_package}
                                </p>
                            </CardHeader>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};