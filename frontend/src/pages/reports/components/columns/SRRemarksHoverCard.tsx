import React, { useState } from "react";
import { MessageCircle, Loader2 } from "lucide-react";
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { useSRRecentRemarks, getSubjectBadgeClass, SRRemarkData } from "@/pages/ServiceRequests/approved-sr/hooks/useSRRemarks";

interface SRRemarksHoverCardProps {
    srId: string;
}

export const SRRemarksHoverCard: React.FC<SRRemarksHoverCardProps> = ({ srId }) => {
    const [isOpen, setIsOpen] = useState(false);
    const { remarks, total, isLoading } = useSRRecentRemarks(srId, isOpen);

    const formatRelativeTime = (dateStr: string): string => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMins < 1) return "Just now";
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    return (
        <HoverCard openDelay={200} closeDelay={100} open={isOpen} onOpenChange={setIsOpen}>
            <HoverCardTrigger asChild>
                <button
                    className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 transition-colors cursor-pointer"
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(!isOpen);
                    }}
                >
                    <MessageCircle className="w-4 h-4 text-gray-500" />
                    {total > 0 && (
                        <span className="text-xs font-medium text-gray-600">{total}</span>
                    )}
                </button>
            </HoverCardTrigger>
            <HoverCardContent
                className="w-80 p-0"
                side="left"
                align="start"
            >
                <div className="p-3 border-b bg-gray-50">
                    <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm">Recent Remarks</h4>
                        {total > 3 && (
                            <span className="text-xs text-gray-500">
                                +{total - 3} more
                            </span>
                        )}
                    </div>
                </div>

                <div className="max-h-[250px] overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center p-4">
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            <span className="text-sm text-gray-500">Loading...</span>
                        </div>
                    ) : remarks.length === 0 ? (
                        <div className="p-4 text-center text-gray-500 text-sm">
                            <MessageCircle className="w-6 h-6 mx-auto mb-1 opacity-50" />
                            No remarks
                        </div>
                    ) : (
                        <div className="p-2 space-y-2">
                            {remarks.map((remark: SRRemarkData) => (
                                <div
                                    key={remark.name}
                                    className="p-2 rounded bg-gray-50 border border-gray-100"
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-medium text-gray-700 truncate max-w-[120px]">
                                            {remark.comment_by_name}
                                        </span>
                                        <Badge
                                            variant="secondary"
                                            className={`text-[10px] px-1.5 py-0 ${getSubjectBadgeClass(remark.subject)}`}
                                        >
                                            {remark.subject_label}
                                        </Badge>
                                        <span className="text-[10px] text-gray-400 ml-auto">
                                            {formatRelativeTime(remark.creation)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-600 line-clamp-2">
                                        {remark.content}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </HoverCardContent>
        </HoverCard>
    );
};

export default SRRemarksHoverCard;
