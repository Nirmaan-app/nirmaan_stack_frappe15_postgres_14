import React, { useMemo } from "react";
import { ClipboardList, Package, FileText } from "lucide-react";
import { PRPackageRow } from "../types";
import { Projects } from "@/types/NirmaanStack/Projects";

interface PRCriticalTagsSummaryProps {
    tags: PRPackageRow[];
    project: Projects;
}

export const PRCriticalTagsSummary: React.FC<PRCriticalTagsSummaryProps> = ({
    tags,
    project,
}) => {
    const stats = useMemo(() => {
        const usedPackages = new Set(tags.map(t => t.package).filter(Boolean));

        // Count total linked PRs (unique)
        const allPRs = new Set<string>();
        tags.forEach(tag => tag.prs.forEach(pr => allPRs.add(pr)));

        // A PR may carry a package the project has not enabled (its items' categories decide),
        // so the total counts those too and "used" can never exceed it -- same as the backend.
        const totalPackages = new Set([
            ...(project?.project_wp_category_makes?.map(m => m.procurement_package).filter(Boolean) as string[] || []),
            ...usedPackages,
        ]).size;

        return {
            usedPackages: usedPackages.size,
            totalPackages,
            totalPRs: allPRs.size,
        };
    }, [tags, project]);

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
                <ClipboardList className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-gray-900">
                    PR Packages Summary
                </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Total PRs */}
                <div className="flex items-center gap-3 p-3 bg-blue-50/60 rounded-lg border border-blue-100/60">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white">
                        <FileText className="h-5 w-5" />
                    </div>
                    <div>
                        <span className="text-2xl font-bold text-blue-700 tabular-nums">{stats.totalPRs}</span>
                        <p className="text-xs text-blue-600/70 font-medium">Total PRs Created</p>
                    </div>
                </div>

                {/* Packages Used */}
                <div className="flex items-center gap-3 p-3 bg-emerald-50/60 rounded-lg border border-emerald-100/60">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white">
                        <Package className="h-5 w-5" />
                    </div>
                    <div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-bold text-emerald-700 tabular-nums">{stats.usedPackages}</span>
                            <span className="text-sm text-emerald-400 font-medium">/ {stats.totalPackages}</span>
                        </div>
                        <p className="text-xs text-emerald-600/70 font-medium">Packages Used</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
