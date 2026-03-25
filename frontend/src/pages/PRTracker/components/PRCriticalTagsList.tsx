import React, { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFrappeGetDocList } from "frappe-react-sdk";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ClipboardList, CheckCircle2, AlertCircle, ExternalLink, Package, LayoutList, FileText } from "lucide-react";
import { CriticalPRTag } from "../types";
import { Link } from "react-router-dom";
import { Projects } from "@/types/NirmaanStack/Projects";
import { cn } from "@/lib/utils";

interface PRTagMobileCardProps {
    tag: CriticalPRTag;
}

/** Extract initials from header name */
function getInitials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

const PRTagMobileCard: React.FC<PRTagMobileCardProps> = ({ tag }) => {
    const associatedPRs = useMemo(() => {
        if (!tag.associated_prs) return [];
        if (typeof tag.associated_prs === "string") {
            try {
                const parsed = JSON.parse(tag.associated_prs);
                return parsed.prs || [];
            } catch (e) {
                return [];
            }
        }
        return tag.associated_prs.prs || [];
    }, [tag.associated_prs]);

    const isReleased = associatedPRs.length > 0;
    const initials = getInitials(tag.header);

    return (
        <Card className={cn(
            "group relative overflow-hidden border transition-all duration-200",
            "hover:-translate-y-0.5 hover:shadow-md",
            isReleased
                ? "border-l-[3px] border-l-emerald-500 border-gray-200 hover:border-emerald-300"
                : "border-l-[3px] border-l-amber-400 border-gray-200 hover:border-amber-300"
        )}>
            <div className="p-4">
                {/* Top: Badge + Header + Package */}
                <div className="flex items-start gap-3">
                    <div className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold transition-colors duration-200",
                        isReleased
                            ? "bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100"
                            : "bg-amber-50 text-amber-600 group-hover:bg-amber-100"
                    )}>
                        {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h4 className="text-base font-semibold text-gray-900 leading-snug group-hover:text-gray-700 transition-colors">
                            {tag.header}
                        </h4>
                        {tag.package && (
                            <div className="flex items-center gap-1.5 mt-1.5">
                                <span className={cn(
                                    "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold tracking-wide",
                                    isReleased
                                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                                        : "bg-amber-50 text-amber-700 border border-amber-200/60"
                                )}>
                                    <Package className="h-3 w-3" />
                                    {tag.package}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Divider */}
                <div className="mt-3 mb-3 border-t border-gray-100" />

                {/* Bottom: Status + Linked PRs */}
                <div className="flex items-center justify-end">


                    {associatedPRs.length > 0 && (
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs font-semibold text-primary hover:bg-primary/5 rounded-md gap-1"
                                >
                                    <ExternalLink className="h-3 w-3" />
                                    {associatedPRs.length} PR{associatedPRs.length > 1 ? "s" : ""}
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle className="text-base font-semibold">
                                        Linked Procurement Requests
                                    </DialogTitle>
                                    <p className="text-sm text-gray-500 mt-1">
                                        {tag.header} — {tag.package}
                                    </p>
                                </DialogHeader>
                                <div className="space-y-2 mt-4 max-h-[300px] overflow-y-auto pr-1">
                                    {associatedPRs.map((pr: string) => (
                                        <Link
                                            key={pr}
                                            to={`/procurement-requests/${pr}?tab=Approve PR`}
                                            className="flex items-center gap-3 text-sm text-blue-600 hover:text-blue-800 py-2.5 px-3 rounded-md hover:bg-blue-50 border border-gray-100 transition-all font-medium"
                                        >
                                            <ExternalLink className="h-4 w-4 flex-shrink-0" />
                                            <span>{pr}</span>
                                        </Link>
                                    ))}
                                </div>
                            </DialogContent>
                        </Dialog>
                    )}
                </div>
            </div>
        </Card>
    );
};

interface PRCriticalTagsListProps {
    tags: CriticalPRTag[];
    projectId: string;
    project: Projects;
}

export const PRCriticalTagsList: React.FC<PRCriticalTagsListProps> = ({
    tags,
    projectId,
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
        <div className="space-y-6">
            {/* Stats Summary Section */}
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

            {/* Tags Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {tags.map((tag) => (
                    <PRTagMobileCard key={tag.name} tag={tag} />
                ))}
            </div>

            {tags.length === 0 && (
                <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 text-gray-500 italic">
                    No critical PR tags found for this project.
                </div>
            )}
        </div>
    );
};
