import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Loader2, X, Send, ExternalLink } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/use-toast";

import { formatDate } from "@/utils/FormatDate";
import { useUserData } from "@/hooks/useUserData";
import {
    usePORemarks,
    useAddPORemark,
    getSubjectBadgeClass,
    PORemarkData,
} from "../hooks/usePORemarks";

interface PORemarksPopoverProps {
    poId: string;
}

export const PORemarksPopover: React.FC<PORemarksPopoverProps> = ({ poId }) => {
    const { toast } = useToast();
    const { role } = useUserData();

    const [isOpen, setIsOpen] = useState(false);
    const [newRemark, setNewRemark] = useState("");

    // Fetch remarks when popover is open
    const { remarks, counts, isLoading, mutate } = usePORemarks(isOpen ? poId : undefined);
    const { addRemark, isLoading: isAdding } = useAddPORemark();

    // Check if user can add remarks
    const canAddRemarks = useMemo(() => {
        const allowedRoles = [
            "Nirmaan Admin Profile",
            "Nirmaan PMO Executive Profile",
            "Nirmaan Accountant Profile",
            "Nirmaan Procurement Executive Profile",
            "Nirmaan Project Lead Profile",
            "Nirmaan Project Manager Profile",
        ];
        return allowedRoles.includes(role || "");
    }, [role]);

    const handleAddRemark = async () => {
        if (!newRemark.trim()) return;

        try {
            await addRemark(poId, newRemark.trim());
            setNewRemark("");
            mutate();
            toast({
                title: "Success",
                description: "Remark added successfully",
            });
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to add remark",
                variant: "destructive",
            });
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleAddRemark();
        }
    };

    const getInitials = (name: string): string => {
        if (!name) return "?";
        const parts = name.split(" ");
        if (parts.length >= 2) {
            return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

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
        return formatDate(dateStr);
    };

    // Show only the 5 most recent remarks in popover
    const recentRemarks = useMemo(() => remarks.slice(0, 5), [remarks]);

    // Encode PO ID for URL (replace / with &=)
    const encodedPoId = poId.replace(/\//g, "&=");

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <button
                    aria-label="View remarks"
                    className="inline-flex items-center justify-center"
                    type="button"
                >
                    {counts.total > 0 ? (
                        <Badge
                            variant="secondary"
                            className="cursor-pointer hover:bg-gray-200 transition-colors"
                        >
                            <MessageCircle className="w-3 h-3 mr-1" />
                            {counts.total}
                        </Badge>
                    ) : (
                        <Badge
                            variant="outline"
                            className="cursor-pointer text-gray-400 hover:bg-gray-100 transition-colors"
                        >
                            <MessageCircle className="w-3 h-3" />
                        </Badge>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-[380px] max-h-[450px] overflow-hidden p-0" align="end">
                {/* Header */}
                <div className="sticky top-0 bg-white z-20 flex justify-between items-center px-3 py-2 border-b">
                    <h4 className="font-semibold text-sm">
                        Remarks {counts.total > 0 && `(${counts.total})`}
                    </h4>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 rounded-full hover:bg-gray-100"
                        onClick={() => setIsOpen(false)}
                        aria-label="Close"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <div className="p-3 space-y-3 max-h-[350px] overflow-y-auto">
                    {/* Add Remark Form */}
                    {canAddRemarks && (
                        <div className="flex gap-2">
                            <Textarea
                                placeholder="Add remark... (Ctrl+Enter)"
                                value={newRemark}
                                onChange={(e) => setNewRemark(e.target.value)}
                                onKeyDown={handleKeyDown}
                                disabled={isAdding}
                                className="min-h-[60px] resize-none text-sm"
                            />
                            <Button
                                size="sm"
                                onClick={handleAddRemark}
                                disabled={isAdding || !newRemark.trim()}
                                className="self-end"
                            >
                                {isAdding ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Send className="w-4 h-4" />
                                )}
                            </Button>
                        </div>
                    )}

                    {/* Loading State */}
                    {isLoading && (
                        <div className="flex items-center justify-center p-4">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            <span className="ml-2 text-sm text-gray-500">Loading...</span>
                        </div>
                    )}

                    {/* Empty State */}
                    {!isLoading && remarks.length === 0 && (
                        <div className="text-center text-gray-500 py-4">
                            <MessageCircle className="w-6 h-6 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No remarks yet</p>
                        </div>
                    )}

                    {/* Remarks List */}
                    {!isLoading && recentRemarks.length > 0 && (
                        <div className="space-y-2">
                            {recentRemarks.map((remark: PORemarkData) => (
                                <div
                                    key={remark.name}
                                    className="flex items-start gap-2 p-2 bg-gray-50 rounded-md"
                                >
                                    <Avatar className="h-7 w-7 flex-shrink-0">
                                        <AvatarFallback className="text-xs bg-gray-200">
                                            {getInitials(remark.comment_by_name)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-medium text-xs">
                                                {remark.comment_by_name}
                                            </span>
                                            <Badge
                                                variant="secondary"
                                                className={`text-[10px] px-1.5 py-0 ${getSubjectBadgeClass(remark.subject)}`}
                                            >
                                                {remark.subject_label}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-gray-700 mt-0.5 line-clamp-2">
                                            {remark.content}
                                        </p>
                                        <span className="text-[10px] text-gray-400">
                                            {formatRelativeTime(remark.creation)}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer with View All link */}
                {counts.total > 5 && (
                    <div className="border-t px-3 py-2 bg-gray-50">
                        <Link
                            to={`/purchase-orders/${encodedPoId}`}
                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center justify-center gap-1"
                            onClick={() => setIsOpen(false)}
                        >
                            View all {counts.total} remarks
                            <ExternalLink className="w-3 h-3" />
                        </Link>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
};

export default PORemarksPopover;
