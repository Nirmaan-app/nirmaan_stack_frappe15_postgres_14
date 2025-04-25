// src/features/procurement-requests/components/PreviousComments.tsx
import React from 'react';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"; // Adjust path
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"; // Adjust path
import { MessageCircleMore } from "lucide-react";
import { formatDate } from "@/utils/FormatDate"; // Adjust path
import { Skeleton } from '@/components/ui/skeleton'; // Adjust path
import { NirmaanUsers } from '@/types/NirmaanStack/NirmaanUsers';
import { NirmaanComments } from '@/types/NirmaanStack/NirmaanComments';

interface PreviousCommentsProps {
    prId: string;
    mode: 'edit' | 'resolve';
}

// Helper to map user ID to full name (or fetch users here)
const useUserMap = () => {
    const { data: usersList } = useFrappeGetDocList<NirmaanUsers>("Nirmaan Users", {
        fields: ["name", "full_name"],
        limit: 1000,
    });
    const userMap = React.useMemo(() => {
        const map = new Map<string, { fullName: string, image?: string }>();
        usersList?.forEach(user => {
            map.set(user.name, { fullName: user.full_name || user.name });
        });
        return map;
    }, [usersList]);
    return userMap;
};

export const PreviousComments: React.FC<PreviousCommentsProps> = ({ prId, mode }) => {
    const subjectFilter = mode === 'resolve' ? "rejecting pr" : "creating pr"; // Adjust subject based on mode if needed
    const userMap = useUserMap();

    const { data: comments, isLoading } = useFrappeGetDocList<NirmaanComments>(
        "Nirmaan Comments", {
            fields: ["name", "content", "comment_by", "creation", "subject"], // Fetch only needed fields
            filters: [
                ["reference_name", "=", prId],
                ["reference_doctype", "=", "Procurement Requests"],
                ["subject", "=", subjectFilter], // Filter by subject
            ],
            orderBy: { field: "creation", order: "desc" }, // Show newest first or oldest? Desc = newest
        },
        {
            // Only run if prId is valid
             enabled: !!prId,
             // Add key to refetch if prId changes, although it's unlikely in this component instance
             // queryKey: ["comments", prId, subjectFilter]
        }
    );

    const getFullName = (id: string): string => {
        if (id === "Administrator") return "Administrator";
        return userMap.get(id)?.fullName || id; // Fallback to ID
    };

    const getAvatar = (id: string): string | undefined => {
        return userMap.get(id)?.image;
    };


    if (isLoading) {
        return (
            <Card className="shadow-none border border-gray-200 p-3 mt-2">
                 <CardHeader className='p-0 pb-2'>
                     <CardTitle className="text-base font-semibold flex items-center gap-1.5">
                        <MessageCircleMore className="w-5 h-5 text-gray-600" />
                        Previous Comments
                    </CardTitle>
                 </CardHeader>
                <CardContent className="p-0 space-y-3">
                     <Skeleton className="h-16 w-full" />
                     <Skeleton className="h-16 w-full" />
                </CardContent>
            </Card>
        )
    }

     if (!comments || comments.length === 0) {
        // Optionally render nothing or a message if no relevant comments exist
        return null;
        // return <div className="text-sm text-gray-500 mt-2">No previous rejection comments found.</div>;
    }

    return (
        <Card className="shadow-none border border-gray-200 p-3 mt-2">
            <CardHeader className='p-0 pb-2'>
                <CardTitle className="text-base font-semibold flex items-center gap-1.5">
                    <MessageCircleMore className="w-5 h-5 text-gray-600" />
                    Previous Comments ({comments.length})
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0 space-y-3 max-h-48 overflow-y-auto pr-2">
                {comments.map((cmt) => (
                    <div key={cmt.name} className="flex items-start space-x-3 bg-gray-50 p-3 rounded-lg">
                        <Avatar className='h-8 w-8'>
                             <AvatarImage src={getAvatar(cmt.comment_by)} alt={getFullName(cmt.comment_by)} />
                            <AvatarFallback className='text-xs'>
                                {getFullName(cmt.comment_by)?.[0]?.toUpperCase() || '?'}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                            <p className="text-sm text-gray-800 break-words">
                                {cmt.content}
                            </p>
                            <div className="flex justify-between items-center mt-1.5">
                                <p className="text-xs font-medium text-gray-600">
                                    {getFullName(cmt.comment_by)}
                                </p>
                                <p className="text-xs text-gray-400">
                                    {formatDate(cmt.creation)} {/* Format full date/time */}
                                </p>
                            </div>
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
};