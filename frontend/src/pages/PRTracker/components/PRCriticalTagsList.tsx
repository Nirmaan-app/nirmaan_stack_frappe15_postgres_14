import React, { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ClipboardList, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { CriticalPRTag } from "../types";
import { Link } from "react-router-dom";

interface PRTagMobileCardProps {
    tag: CriticalPRTag;
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

    return (
        <Card className="p-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1 mb-1.5">
                        <Badge variant="outline" className="text-xs">
                            {tag.header}
                        </Badge>
                        {tag.package && (
                            <Badge variant="secondary" className="text-xs">
                                {tag.package}
                            </Badge>
                        )}
                    </div>
                    <h4 className="font-medium text-sm leading-tight text-gray-900">{tag.name}</h4>
                    <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            {isReleased ? (
                                <Badge className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100 py-0.5">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    Released
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="text-gray-500 py-0.5">
                                    <AlertCircle className="h-3 w-3 mr-1" />
                                    Not Released
                                </Badge>
                            )}
                        </div>

                        {isReleased && (
                             <Dialog>
                                <DialogTrigger asChild>
                                    <Button
                                        variant="link"
                                        size="sm"
                                        className="h-7 text-xs text-primary hover:text-primary px-0 underline decoration-dotted"
                                    >
                                        {associatedPRs.length} Linked PR{associatedPRs.length > 1 ? "s" : ""}
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-md">
                                    <DialogHeader>
                                        <DialogTitle className="text-base font-semibold">
                                            Linked Procurement Requests
                                        </DialogTitle>
                                        <p className="text-sm text-gray-500 mt-1">
                                            {tag.name}
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
            </div>
        </Card>
    );
};

interface PRCriticalTagsListProps {
    tags: CriticalPRTag[];
    projectId: string;
}

export const PRCriticalTagsList: React.FC<PRCriticalTagsListProps> = ({
    tags,
    projectId,
}) => {
    const releasedCount = useMemo(() => {
        return tags.filter(tag => {
            const prs = typeof tag.associated_prs === "string" ? JSON.parse(tag.associated_prs || '{"prs":[]}').prs : tag.associated_prs?.prs;
            return prs && prs.length > 0;
        }).length;
    }, [tags]);

    const totalCount = tags.length;
    const percentage = totalCount > 0 ? Math.round((releasedCount / totalCount) * 100) : 0;

    return (
        <div className="space-y-6">
            {/* Stats Summary Section */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <ClipboardList className="h-5 w-5 text-primary" />
                        Critical PR Tags Summary
                    </h2>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    <div className="flex flex-col">
                        <span className="text-sm text-gray-500 font-medium">Release Progress</span>
                        <div className="mt-2 flex items-center gap-4">
                             <div className="relative h-16 w-16">
                                <svg className="h-16 w-16" viewBox="0 0 36 36">
                                    <path
                                        className="text-gray-100 stroke-current"
                                        strokeWidth="3"
                                        fill="none"
                                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                    />
                                    <path
                                        className="text-primary stroke-current"
                                        strokeWidth="3"
                                        strokeDasharray={`${percentage}, 100`}
                                        strokeLinecap="round"
                                        fill="none"
                                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                    />
                                </svg>
                                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900">
                                    {percentage}%
                                </span>
                            </div>
                            <div className="flex flex-col">
                                <span className="text-2xl font-bold text-gray-900">{releasedCount}/{totalCount}</span>
                                <span className="text-xs text-gray-500">Tags Released</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col justify-center border-t sm:border-t-0 sm:border-l border-gray-100 sm:pl-6 pt-4 sm:pt-0">
                        <span className="text-sm text-gray-500 font-medium italic">Released Tags</span>
                        <span className="text-2xl font-bold text-green-600 mt-1">{releasedCount}</span>
                    </div>

                    <div className="flex flex-col justify-center border-t sm:border-t-0 sm:border-l border-gray-100 sm:pl-6 pt-4 sm:pt-0">
                        <span className="text-sm text-gray-500 font-medium italic">Remaining Tags</span>
                        <span className="text-2xl font-bold text-amber-600 mt-1">{totalCount - releasedCount}</span>
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
