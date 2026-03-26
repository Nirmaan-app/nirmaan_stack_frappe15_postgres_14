import React, { useMemo } from "react";
import { useFrappeGetDocList } from "frappe-react-sdk";
import { ClipboardList, Package, LayoutList, FileText } from "lucide-react";
import { CriticalPRTag } from "../types";
import { Projects } from "@/types/NirmaanStack/Projects";

interface PRCriticalTagsSummaryProps {
    tags: CriticalPRTag[];
    project: Projects;
}

export const PRCriticalTagsSummary: React.FC<PRCriticalTagsSummaryProps> = ({
    tags,
    project,
}) => {
    // Fetch all PR Tag Headers to compute total available headers (same as backend)
    const { data: prTagHeaders } = useFrappeGetDocList<{ pr_header: string; tag_package: string }>("PR Tag Headers", {
        fields: ["pr_header", "tag_package"],
        limit: 0,
    });

    // Compute stats from tags
    const stats = useMemo(() => {
        const uniquePackages = new Set(tags.map(t => t.package).filter(Boolean));
        const uniqueHeaders = new Set(tags.map(t => t.header).filter(Boolean));

        // Count total linked PRs (unique)
        const allPRs = new Set<string>();
        tags.forEach(tag => {
            let prs: string[] = [];
            if (typeof tag.associated_prs === "string") {
                try { prs = JSON.parse(tag.associated_prs || '{"prs":[]}').prs || []; } catch { prs = []; }
            } else {
                prs = tag.associated_prs?.prs || [];
            }
            prs.forEach(pr => allPRs.add(pr));
        });

        // Total enabled packages from project
        const enabledPackages = project?.project_wp_category_makes
            ? new Set(project.project_wp_category_makes.map(m => m.procurement_package))
            : new Set<string>();

        const totalPackages = enabledPackages.size;

        // Total available headers = all PR Tag Headers whose package is in enabled packages
        const totalAvailableHeaders = prTagHeaders
            ? new Set(
                prTagHeaders
                    .filter(h => h.tag_package && enabledPackages.has(h.tag_package))
                    .map(h => h.pr_header)
            ).size
            : 0;

        return {
            usedPackages: uniquePackages.size,
            totalPackages,
            usedHeaders: uniqueHeaders.size,
            totalAvailableHeaders,
            totalPRs: allPRs.size,
        };
    }, [tags, project, prTagHeaders]);

    return (
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
                <ClipboardList className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-gray-900">
                    Critical PR Tags Summary
                </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

                {/* Headers Used */}
                <div className="flex items-center gap-3 p-3 bg-purple-50/60 rounded-lg border border-purple-100/60">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500 text-white">
                        <LayoutList className="h-5 w-5" />
                    </div>
                    <div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-bold text-purple-700 tabular-nums">{stats.usedHeaders}</span>
                            <span className="text-sm text-purple-400 font-medium">/ {stats.totalAvailableHeaders}</span>
                        </div>
                        <p className="text-xs text-purple-600/70 font-medium">Headers Used in PRs</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
