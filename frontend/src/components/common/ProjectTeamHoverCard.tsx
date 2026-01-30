import React from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { ProjectAssignee } from "@/hooks/useProjectAssignees";

export const ProjectTeamHoverCard = ({ assignees }: { assignees: ProjectAssignee[] }) => {
    if (!assignees || assignees.length === 0) {
        return <div className="text-center text-gray-400">--</div>;
    }

    // Group by Role
    const grouped = assignees.reduce((acc, user) => {
        const roleName = user.role?.replace(/Nirmaan\s|\sProfile/g, "") || "Others";
        if (!acc[roleName]) acc[roleName] = [];
        acc[roleName].push(user);
        return acc;
    }, {} as Record<string, ProjectAssignee[]>);

    return (
        <div className="flex justify-center">
             <HoverCard openDelay={200} closeDelay={100}>
                <HoverCardTrigger asChild>
                    <div className="cursor-pointer p-1.5 hover:bg-gray-100 rounded-full transition-colors group">
                        <Users className="w-4 h-4 text-gray-500 group-hover:text-blue-600" />
                    </div>
                </HoverCardTrigger>
                <HoverCardContent className="w-72 p-0 shadow-lg" side="left" align="start">
                     <div className="p-3 border-b bg-gray-50/50 flex justify-between items-center">
                        <h4 className="font-semibold text-sm text-gray-900">Responsible Team</h4>
                        <Badge variant="outline" className="bg-white text-xs font-normal">
                            {assignees.length} Members
                        </Badge>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto p-2 space-y-3 custom-scrollbar">
                        {Object.entries(grouped).map(([role, users]) => (
                            <div key={role} className="space-y-1">
                                <div className="flex items-center gap-1 px-2">
                                    <h5 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                                        {role}
                                    </h5>
                                    <div className="h-px bg-gray-100 flex-1 ml-2" />
                                </div>
                                <div className="space-y-1">
                                    {users.map((user, idx) => (
                                        <div 
                                            key={idx} 
                                            className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 transition-colors"
                                        >
                                            <div className="h-6 w-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0 border border-blue-100">
                                                <span className="text-[10px] font-bold text-blue-600">
                                                    {user.name.charAt(0).toUpperCase()}
                                                </span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-gray-900 leading-none">
                                                    {user.name}
                                                </span>
                                                <span className="text-[10px] text-gray-500 mt-0.5">
                                                    {user.email || 'Nirmaan User'}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </HoverCardContent>
            </HoverCard>
        </div>
    );
};
