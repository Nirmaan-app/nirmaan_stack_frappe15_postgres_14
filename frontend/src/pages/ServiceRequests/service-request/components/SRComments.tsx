import React, { useState, useMemo } from "react";
import { MessageCircle, Send, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";
import {
  useSRRemarks,
  useAddSRRemark,
  useDeleteSRRemark,
  RemarkSubject,
  SRRemarkData,
} from "../hooks/useSRRemarks";

interface SRCommentsProps {
  srId: string;
}

type FilterValue = "all" | "accountant" | "procurement" | "admin";

const FILTER_TO_SUBJECT: Record<FilterValue, RemarkSubject | undefined> = {
  all: undefined,
  accountant: "accountant_remark",
  procurement: "procurement_remark",
  admin: "admin_remark",
};

const FILTER_CONFIG = [
  { value: "all" as FilterValue, label: "All", countKey: "total", activeClass: "bg-slate-100 text-slate-900", dotClass: "bg-slate-400" },
  { value: "accountant" as FilterValue, label: "Accountant", countKey: "accountant", activeClass: "bg-blue-50 text-blue-700", dotClass: "bg-blue-500" },
  { value: "procurement" as FilterValue, label: "Procurement", countKey: "procurement", activeClass: "bg-green-50 text-green-700", dotClass: "bg-green-500" },
  { value: "admin" as FilterValue, label: "Admin", countKey: "admin", activeClass: "bg-purple-50 text-purple-700", dotClass: "bg-purple-500" },
];

const getSubjectDotColor = (subject: RemarkSubject): string => {
  switch (subject) {
    case "accountant_remark": return "bg-blue-500";
    case "procurement_remark": return "bg-green-500";
    case "admin_remark": return "bg-purple-500";
    default: return "bg-slate-400";
  }
};

const getAvatarBgColor = (subject: RemarkSubject): string => {
  switch (subject) {
    case "accountant_remark": return "bg-blue-100 text-blue-700";
    case "procurement_remark": return "bg-green-100 text-green-700";
    case "admin_remark": return "bg-purple-100 text-purple-700";
    default: return "bg-slate-100 text-slate-700";
  }
};

export const SRComments: React.FC<SRCommentsProps> = ({ srId }) => {
  const { toast } = useToast();
  const { role, user_id } = useUserData();

  const [activeFilter, setActiveFilter] = useState<FilterValue>("all");
  const [newRemark, setNewRemark] = useState("");

  const subjectFilter = FILTER_TO_SUBJECT[activeFilter];
  const { remarks, counts, isLoading, mutate } = useSRRemarks(srId, subjectFilter);
  const { addRemark, isLoading: isAdding } = useAddSRRemark();
  const { deleteRemark, isLoading: isDeleting } = useDeleteSRRemark();

  const canAddRemarks = useMemo(() => {
    const allowedRoles = [
      "Nirmaan Admin Profile",
      "Nirmaan PMO Executive Profile",
      "Nirmaan Accountant Profile",
      "Nirmaan Procurement Executive Profile",
      "Nirmaan Project Lead Profile",
    ];
    return allowedRoles.includes(role || "");
  }, [role]);

  const canDeleteRemark = (remark: SRRemarkData): boolean => {
    if (user_id === "Administrator") return true;
    const currentUserLower = user_id?.toLowerCase() || "";
    const remarkOwnerLower = remark.comment_by?.toLowerCase() || "";
    return currentUserLower === remarkOwnerLower;
  };

  const handleDeleteRemark = async (remarkId: string) => {
    try {
      await deleteRemark(remarkId);
      mutate();
      toast({ title: "Success", description: "Comment deleted successfully" });
    } catch {
      toast({ title: "Error", description: "Failed to delete comment", variant: "destructive" });
    }
  };

  const handleAddRemark = async () => {
    if (!newRemark.trim()) {
      toast({ title: "Error", description: "Please enter a comment", variant: "destructive" });
      return;
    }
    try {
      await addRemark(srId, newRemark.trim());
      setNewRemark("");
      mutate();
      toast({ title: "Success", description: "Comment added successfully" });
    } catch {
      toast({ title: "Error", description: "Failed to add comment", variant: "destructive" });
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
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
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

  const getFilterCount = (countKey: string): number => {
    if (countKey === "total") return counts.total;
    if (countKey === "accountant") return counts.accountant_remark;
    if (countKey === "procurement") return counts.procurement_remark;
    if (countKey === "admin") return counts.admin_remark;
    return 0;
  };

  return (
    <Accordion type="multiple" className="w-full" defaultValue={["comments"]}>
      <AccordionItem value="comments" className="border-0">
        <AccordionTrigger className="hover:no-underline py-3 px-4 bg-slate-50/50 rounded-lg">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-slate-500" />
            <span className="font-medium text-sm text-slate-700">Comments</span>
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 text-xs font-medium rounded-full bg-slate-200 text-slate-700">
              {counts.total}
            </span>
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-4 pb-0">
          <div className="space-y-4">
            {/* Filter Pills */}
            <div className="flex flex-wrap gap-2">
              {FILTER_CONFIG.map((filter) => {
                const count = getFilterCount(filter.countKey);
                const isActive = activeFilter === filter.value;
                return (
                  <button
                    key={filter.value}
                    onClick={() => setActiveFilter(filter.value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full transition-colors",
                      isActive ? filter.activeClass : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                    )}
                  >
                    {filter.value !== "all" && (
                      <span className={cn("w-1.5 h-1.5 rounded-full", filter.dotClass)} />
                    )}
                    {filter.label}
                    <span className="opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>

            {/* Add Comment Form */}
            {canAddRemarks && (
              <div className="bg-slate-50/50 rounded-lg p-3 border border-slate-200">
                <Textarea
                  placeholder="Add a comment... (Ctrl+Enter to submit)"
                  value={newRemark}
                  onChange={(e) => setNewRemark(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isAdding}
                  className="min-h-[60px] resize-none bg-white border-slate-200 text-sm"
                />
                <div className="flex justify-end mt-2">
                  <Button size="sm" onClick={handleAddRemark} disabled={isAdding || !newRemark.trim()} className="h-7 text-xs">
                    {isAdding ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Send className="w-3 h-3 mr-1.5" />}
                    Add
                  </Button>
                </div>
              </div>
            )}

            {/* Timeline */}
            {isLoading ? (
              <div className="space-y-3 pl-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : remarks.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No comments yet</p>
                {canAddRemarks && <p className="text-xs mt-1 opacity-70">Be the first to add a comment</p>}
              </div>
            ) : (
              <div className="relative max-h-[350px] overflow-y-auto pr-2">
                <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-slate-200" />
                <div className="space-y-4">
                  {remarks.map((remark) => (
                    <div key={remark.name} className="relative pl-6">
                      <div className={cn("absolute left-0 top-2 w-[15px] h-[15px] rounded-full border-2 border-white", getSubjectDotColor(remark.subject))} />
                      <div className="flex items-start gap-2.5">
                        <Avatar className={cn("h-7 w-7 flex-shrink-0", getAvatarBgColor(remark.subject))}>
                          <AvatarFallback className="text-[10px] font-medium bg-transparent">
                            {getInitials(remark.comment_by_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-slate-800">{remark.comment_by_name}</span>
                            <span className="text-xs text-slate-400">{formatRelativeTime(remark.creation)}</span>
                            {canDeleteRemark(remark) && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <button className="ml-auto p-1 text-slate-400 hover:text-red-500 transition-colors" disabled={isDeleting}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Comment</AlertDialogTitle>
                                    <AlertDialogDescription>Are you sure you want to delete this comment? This action cannot be undone.</AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDeleteRemark(remark.name)} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 mt-0.5 whitespace-pre-wrap break-words">{remark.content}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

export default SRComments;
