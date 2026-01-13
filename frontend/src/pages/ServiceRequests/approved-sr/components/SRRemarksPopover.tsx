import React, { useState, useMemo } from "react";
import { MessageCircle, Send, Loader2, Plus } from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useUserData } from "@/hooks/useUserData";
import {
    useSRRecentRemarks,
    useAddSRRemark,
    getSubjectBadgeClass,
    SRRemarkData,
} from "../hooks/useSRRemarks";

interface SRRemarksPopoverProps {
    srId: string;
}

export const SRRemarksPopover: React.FC<SRRemarksPopoverProps> = ({ srId }) => {
    const { toast } = useToast();
    const { role } = useUserData();
    const [isOpen, setIsOpen] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newRemark, setNewRemark] = useState("");

    const { remarks, total, isLoading, mutate } = useSRRecentRemarks(srId, isOpen);
    const { addRemark, isLoading: isAdding } = useAddSRRemark();

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
            await addRemark(srId, newRemark.trim());
            setNewRemark("");
            setShowAddForm(false);
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
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 gap-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    <MessageCircle className="w-4 h-4" />
                    {total > 0 && (
                        <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                            {total}
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-80 p-0"
                align="end"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-3 border-b bg-gray-50">
                    <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm">Remarks</h4>
                        {canAddRemarks && !showAddForm && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setShowAddForm(true)}
                            >
                                <Plus className="w-3 h-3 mr-1" />
                                Add
                            </Button>
                        )}
                    </div>
                </div>

                {/* Add Remark Form */}
                {showAddForm && (
                    <div className="p-3 border-b">
                        <Textarea
                            placeholder="Add a remark..."
                            value={newRemark}
                            onChange={(e) => setNewRemark(e.target.value)}
                            className="min-h-[60px] text-sm resize-none mb-2"
                            disabled={isAdding}
                        />
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setShowAddForm(false);
                                    setNewRemark("");
                                }}
                                disabled={isAdding}
                            >
                                Cancel
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleAddRemark}
                                disabled={isAdding || !newRemark.trim()}
                            >
                                {isAdding ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                    <Send className="w-3 h-3 mr-1" />
                                )}
                                Add
                            </Button>
                        </div>
                    </div>
                )}

                {/* Remarks List */}
                <div className="max-h-[250px] overflow-y-auto">
                    {isLoading ? (
                        <div className="p-4 text-center text-gray-500 text-sm">
                            Loading...
                        </div>
                    ) : remarks.length === 0 ? (
                        <div className="p-4 text-center text-gray-500 text-sm">
                            <MessageCircle className="w-6 h-6 mx-auto mb-1 opacity-50" />
                            No remarks yet
                        </div>
                    ) : (
                        <div className="p-2 space-y-2">
                            {remarks.map((remark: SRRemarkData) => (
                                <div
                                    key={remark.name}
                                    className="p-2 rounded bg-gray-50 border border-gray-100"
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-xs font-medium text-gray-700 truncate max-w-[100px]">
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
                            {total > 3 && (
                                <p className="text-xs text-center text-gray-400 pt-1">
                                    +{total - 3} more remarks
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
};

export default SRRemarksPopover;
