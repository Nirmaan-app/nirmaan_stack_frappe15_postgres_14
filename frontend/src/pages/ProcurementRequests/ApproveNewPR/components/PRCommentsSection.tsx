import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Comment } from '../types'; // Your NirmaanComments type
import { format } from 'date-fns'; // For formatting dates

interface PRCommentsSectionProps {
    comments: Comment[];
    getUserName: (userId: string | undefined) => string;
}

export const PRCommentsSection: React.FC<PRCommentsSectionProps> = ({ comments, getUserName }) => {
    if (!comments || comments.length === 0) {
        return (
             <Card className='mt-4'>
                 <CardHeader>
                     <CardTitle className="text-base">Comments</CardTitle>
                 </CardHeader>
                 <CardContent>
                     <p className="text-sm text-muted-foreground">No relevant comments found for this PR.</p>
                 </CardContent>
             </Card>
         );
    }

    // Sort comments, e.g., newest first
    const sortedComments = [...comments].sort((a, b) =>
        new Date(b.creation ?? 0).getTime() - new Date(a.creation ?? 0).getTime()
    );

    return (
        <Card className='mt-4'>
            <CardHeader>
                <CardTitle className="text-base">Comments History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {sortedComments.map(comment => (
                    <div key={comment.name} className="text-sm border-b pb-2 last:border-b-0">
                        <p className="whitespace-pre-wrap">{comment.content}</p>
                        <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                            <span>
                                By: <strong>{getUserName(comment.comment_by)}</strong> ({comment.subject || 'General Comment'})
                            </span>
                            <span>
                                {comment.creation ? format(new Date(comment.creation), 'PPp') : 'Unknown date'}
                            </span>
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
};