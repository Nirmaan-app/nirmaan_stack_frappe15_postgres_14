import React, { useState } from 'react';
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

/** Extract up to 2 initials from a header name, e.g. "HVAC Ducting" → "HD" */
function getInitials(name: string): string {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(w => w[0].toUpperCase())
        .join('');
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
            <h3 className="text-lg font-semibold tracking-tight text-slate-800">
                Select PR Headers
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredHeaders.map((item) => {
                    const isSelected = selectedHeaderNames.includes(item.name);
                    const initials = getInitials(item.pr_header);

                    return (
                        <div
                            key={item.name}
                            onClick={() => toggleHeader(item.name)}
                            className={cn(
                                "group relative flex flex-col items-center rounded-xl border bg-white px-3 py-[22px]",
                                "cursor-pointer select-none overflow-hidden",
                                "shadow-sm transition-all duration-200 ease-out",
                                "hover:-translate-y-0.5 hover:shadow-md hover:border-red-300",
                                isSelected
                                    ? "border-primary bg-red-50/50 ring-1 ring-primary/30"
                                    : "border-gray-200"
                            )}
                        >
                            {/* Initials badge */}
                            <div
                                className={cn(
                                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold transition-colors duration-200",
                                    isSelected
                                        ? "bg-primary text-white"
                                        : "bg-red-50 text-primary group-hover:bg-red-100"
                                )}
                            >
                                {initials}
                            </div>

                            {/* Text */}
                            <div className="w-full text-center pt-1">
                                <p
                                    className={cn(
                                        "text-sm font-semibold leading-snug transition-colors duration-200",
                                        isSelected
                                            ? "text-red-700"
                                            : "text-slate-800 group-hover:text-primary"
                                    )}
                                >
                                    {item.pr_header}
                                </p>
                                <p className="mt-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-400">
                                    {item.tag_package}
                                </p>
                            </div>

                            {/* Selected checkmark */}
                            {isSelected && (
                                <div className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white">
                                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                                </div>
                            )}

                            {/* Bottom indicator bar */}
                            <span
                                className={cn(
                                    "absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] rounded-full transition-all duration-200",
                                    isSelected
                                        ? "w-3/4 bg-primary"
                                        : "w-0 bg-red-400 group-hover:w-1/2"
                                )}
                            />
                        </div>
                    );
                })}
            </div>

            <div className="flex justify-end">
                <Button
                    onClick={handleConfirm}
                    disabled={selectedHeaderNames.length === 0}
                    className={cn(
                        "px-6 py-2.5 rounded-md font-medium transition-all duration-200",
                        selectedHeaderNames.length > 0
                            ? "bg-primary hover:bg-primary/90 text-white shadow-md hover:shadow-lg"
                            : ""
                    )}
                >
                    Confirm Selection ({selectedHeaderNames.length})
                </Button>
            </div>
        </div>
    );
};