import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { getUnifiedStatusStyle } from "../utils";

interface ProjectWiseCardProps {
    tracker: any; // Using any for now to match flexible API response, typically ProjectDesignTracker + stats
    onClick?: () => void;
}

export const ProjectWiseCard: React.FC<ProjectWiseCardProps> = ({ tracker, onClick }) => {
    
    // Status counts provided by the new API
    const statusCounts = tracker.status_counts || {};
    const totalTasks = tracker.total_tasks || 0;

    // Helper to format date
    const formatDate = (dateString: string) => {
        try {
            return format(new Date(dateString), "dd MMM, yyyy");
        } catch {
            return dateString;
        }
    };

    return (
        <Card 
            className="hover:shadow-lg transition-shadow duration-200 cursor-pointer border-l-4 border-l-primary h-full flex flex-col"
            onClick={onClick}
        >
            <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                    <div className="space-y-1">
                         <CardTitle className="text-lg font-bold text-gray-800 line-clamp-1" title={tracker.project_name}>
                            {tracker.project_name}
                        </CardTitle>
                         <p className="text-xs text-muted-foreground">
                            Created: {formatDate(tracker.creation)}
                        </p>
                    </div>
                   <Badge 
                        variant="outline" 
                        className={`capitalize ${getUnifiedStatusStyle(tracker.status)}`}
                    >
                        {tracker.status}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-end pt-2">
                 <div className="space-y-3">
                    {/* Total Tasks Count */}
                    {/* Total Tasks Count */}
                    <div className="flex justify-between items-end border-b pb-2">
                        <span className="text-sm font-medium text-gray-600">Tasks (Approved/Total)</span>
                        <div className="flex items-baseline gap-1">
                             <span className={`text-2xl font-bold ${(tracker.completed_tasks || 0) === totalTasks && totalTasks > 0 ? "text-green-600" : "text-primary"}`}>
                                {tracker.completed_tasks || 0}
                             </span>
                             <span className="text-sm font-medium text-gray-500">/ {totalTasks}</span>
                        </div>
                    </div>

                    {/* Status Breakdown (Top 3 or Grid?) */}
                    {totalTasks > 0 ? (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                             {Object.entries(statusCounts).map(([status, count]) => (
                                <div key={status} className={`flex justify-between items-center px-2 py-1 rounded ${getUnifiedStatusStyle(status)} border-0`}> 
                                    <TooltipProvider>
                                        <Tooltip delayDuration={300}>
                                            <TooltipTrigger asChild>
                                                <span className="truncate max-w-[70%] cursor-default">
                                                    {status}
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>{status}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                    <span className="font-semibold">{count as number}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-gray-400 italic py-2">No tasks created yet.</p>
                    )}
                 </div>
                 
                 {/* View Details Link (Visual cue) */}
                 <div className="mt-4 flex justify-end">
                     <span className="text-xs text-primary flex items-center gap-1 font-medium hover:underline">
                        View Details <ArrowUpRight className="h-3 w-3" />
                     </span>
                 </div>
            </CardContent>
        </Card>
    );
};
