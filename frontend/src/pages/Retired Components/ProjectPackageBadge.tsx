import React, { useMemo } from 'react';
import { useFrappeGetDoc } from 'frappe-react-sdk';
import { Loader2, Info } from "lucide-react";
import { Projects as Project } from '@/types/NirmaanStack/Projects';
import { Badge } from '@/components/ui/badge';

interface ProjectPackageBadgeProps {
    projectId: string;
}

export const ProjectPackageBadge: React.FC<ProjectPackageBadgeProps> = ({
    projectId,
}) => {
    const { data: projectDoc, isLoading } = useFrappeGetDoc<Project>(
        "Projects",
        projectId,
        `ProjectPackageBadge-${projectId}`
    );

    const availablePackages = useMemo(() => {
        if (!projectDoc?.project_wp_category_makes) return [];

        const packages = projectDoc.project_wp_category_makes.map(
            (item: any) => item.procurement_package
        );
        return Array.from(new Set(packages)).filter(Boolean).sort() as string[];
    }, [projectDoc?.project_wp_category_makes]);

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-[10px]">Loading project configuration...</span>
            </div>
        );
    }

    if (availablePackages.length === 0) {
        return null;
    }

    return (
        <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 pr-2 border-r border-blue-100/50 mr-1">
                <Badge variant="outline" className="flex items-center gap-1 py-0.5 px-1.5 text-[9px] font-bold uppercase tracking-wider bg-white border-blue-200 text-blue-600 shadow-sm">
                    <Info className="h-3 w-3" />
                    Project Package
                </Badge>
            </div>

            <div className="flex items-center gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    {availablePackages.map((pkg) => (
                        <Badge
                            key={pkg}
                            variant="secondary"
                            className="bg-white border-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-[10px] font-medium"
                        >
                            {pkg}
                        </Badge>
                    ))}
                </div>
            </div>
        </div>
    );
};
