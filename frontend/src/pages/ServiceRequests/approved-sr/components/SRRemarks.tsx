import React, { useState, useMemo } from "react";
import { MessageCircle, Send, Loader2, Trash2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";

import { formatDate } from "@/utils/FormatDate";
import { useUserData } from "@/hooks/useUserData";
import {
    useSRRemarks,
    useAddSRRemark,
    useDeleteSRRemark,
    getSubjectBadgeClass,
    RemarkSubject,
    SRRemarkData,
} from "../hooks/useSRRemarks";

interface SRRemarksProps {
    srId: string;
}

type TabValue = "all" | "accountant" | "procurement" | "admin";

const TAB_TO_SUBJECT: Record<TabValue, RemarkSubject | undefined> = {
    all: undefined,
    accountant: "accountant_remark",
    procurement: "procurement_remark",
    admin: "admin_remark",
};

export const SRRemarks: React.FC<SRRemarksProps> = ({ srId }) => {
    const { toast } = useToast();
    const { role, user_id } = useUserData();

    const [activeTab, setActiveTab] = useState<TabValue>("all");
    const [newRemark, setNewRemark] = useState("");

    // Fetch remarks based on active tab filter
    const subjectFilter = TAB_TO_SUBJECT[activeTab];
    const { remarks, counts, isLoading, mutate } = useSRRemarks(srId, subjectFilter);
    const { addRemark, isLoading: isAdding } = useAddSRRemark();
    const { deleteRemark, isLoading: isDeleting } = useDeleteSRRemark();

    // Check if user can add remarks (Admin, Accountant, Procurement roles)
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

    // Check if current user owns the remark (can delete)
    const canDeleteRemark = (remark: SRRemarkData): boolean => {
        if (user_id === "Administrator") return true;
        const currentUserLower = user_id?.toLowerCase() || "";
        const remarkOwnerLower = remark.comment_by?.toLowerCase() || "";
        return currentUserLower === remarkOwnerLower;
    };

    const handleDeleteRemark = async (remarkId: string) => {
        try {
            await deleteRemark(remarkId);
            mutate(); // Refresh the remarks list
            toast({
                title: "Success",
                description: "Remark deleted successfully",
            });
        } catch (error) {
            toast({
                title: "Error",
                description: "Failed to delete remark",
                variant: "destructive",
            });
        }
    };

    const handleAddRemark = async () => {
        if (!newRemark.trim()) {
            toast({
                title: "Error",
                description: "Please enter a remark",
                variant: "destructive",
            });
            return;
        }

        try {
            await addRemark(srId, newRemark.trim());
            setNewRemark("");
            mutate(); // Refresh the remarks list
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

    return (
        <Accordion type="multiple" className="w-full">
            <AccordionItem value="remarks">
                <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3 pl-6">
                        <p className="font-semibold text-lg text-red-600">Remarks</p>
                        <Badge variant="secondary">{counts.total}</Badge>
                    </div>
                </AccordionTrigger>
                <AccordionContent>
                    <div className="space-y-4 px-2">
                        {/* Filter Tabs */}
                        <Tabs
                            value={activeTab}
                            onValueChange={(value) => setActiveTab(value as TabValue)}
                        >
                            <TabsList className="grid w-full grid-cols-4 max-w-md">
                                <TabsTrigger value="all">
                                    All ({counts.total})
                                </TabsTrigger>
                                <TabsTrigger value="accountant">
                                    Accountant ({counts.accountant_remark})
                                </TabsTrigger>
                                <TabsTrigger value="procurement">
                                    Procurement ({counts.procurement_remark})
                                </TabsTrigger>
                                <TabsTrigger value="admin">
                                    Admin ({counts.admin_remark})
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>

                        {/* Add Remark Form */}
                        {canAddRemarks && (
                            <Card className="border border-gray-200 shadow-none">
                                <CardContent className="p-3">
                                    <div className="flex flex-col gap-2">
                                        <Textarea
                                            placeholder="Add a remark... (Ctrl+Enter to submit)"
                                            value={newRemark}
                                            onChange={(e) => setNewRemark(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            disabled={isAdding}
                                            className="min-h-[80px] resize-none"
                                        />
                                        <div className="flex justify-end">
                                            <Button
                                                size="sm"
                                                onClick={handleAddRemark}
                                                disabled={isAdding || !newRemark.trim()}
                                            >
                                                {isAdding ? (
                                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                ) : (
                                                    <Send className="w-4 h-4 mr-2" />
                                                )}
                                                Add Remark
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* Remarks List */}
                        {isLoading ? (
                            <div className="space-y-3">
                                <Skeleton className="h-20 w-full" />
                                <Skeleton className="h-20 w-full" />
                            </div>
                        ) : remarks.length === 0 ? (
                            <Card className="border border-gray-200 shadow-none">
                                <CardContent className="p-6 text-center text-gray-500">
                                    <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                    <p>No remarks yet</p>
                                    {canAddRemarks && (
                                        <p className="text-sm mt-1">
                                            Be the first to add a remark
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                                {remarks.map((remark: SRRemarkData) => (
                                    <Card
                                        key={remark.name}
                                        className="border border-gray-200 shadow-none"
                                    >
                                        <CardContent className="p-3">
                                            <div className="flex items-start gap-3">
                                                <Avatar className="h-9 w-9 flex-shrink-0">
                                                    <AvatarFallback className="text-xs bg-gray-100">
                                                        {getInitials(remark.comment_by_name)}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-medium text-sm">
                                                            {remark.comment_by_name}
                                                        </span>
                                                        <Badge
                                                            variant="secondary"
                                                            className={`text-xs ${getSubjectBadgeClass(remark.subject)}`}
                                                        >
                                                            {remark.subject_label}
                                                        </Badge>
                                                        <span className="text-xs text-gray-400">
                                                            {formatRelativeTime(remark.creation)}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap break-words">
                                                        {remark.content}
                                                    </p>
                                                </div>
                                                {/* Delete button - only show for own remarks */}
                                                {canDeleteRemark(remark) && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 flex-shrink-0"
                                                                disabled={isDeleting}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete Remark</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Are you sure you want to delete this remark? This action cannot be undone.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    onClick={() => handleDeleteRemark(remark.name)}
                                                                    className="bg-red-600 hover:bg-red-700"
                                                                >
                                                                    Delete
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    );
};

export default SRRemarks;
