import React from 'react';
import { ArrowLeft, Calendar, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DraftIndicator } from '@/components/ui/draft-indicator';
import { formatDate } from '@/utils/FormatDate';

interface ApprovePRHeaderProps {
    prName: string;
    projectName: string;
    workPackage: string;
    status: string;
    createdDate: string;
    createdBy: string;
    onBack: () => void;
    onCancel?: () => void;
    // Draft indicator props
    hasDraft?: boolean;
    lastSavedText?: string | null;
    isSaving?: boolean;
}

/**
 * Returns the appropriate badge variant based on PR status
 */
const getStatusBadgeVariant = (status: string): "default" | "secondary" | "destructive" | "outline" | "green" | "yellow" | "blue" | "teal" | "purple" | "indigo" | "orange" | "red" | "gray" | "darkGreen" => {
    const statusLower = status?.toLowerCase() || '';

    if (statusLower.includes('approved') || statusLower.includes('ordered')) {
        return 'green';
    }
    if (statusLower.includes('pending')) {
        return 'yellow';
    }
    if (statusLower.includes('rejected') || statusLower.includes('cancelled')) {
        return 'red';
    }
    if (statusLower.includes('draft')) {
        return 'gray';
    }
    if (statusLower.includes('partial')) {
        return 'orange';
    }
    return 'secondary';
};

export const ApprovePRHeader: React.FC<ApprovePRHeaderProps> = ({
    prName,
    projectName,
    workPackage,
    status,
    createdDate,
    createdBy,
    onBack,
    onCancel,
    hasDraft = false,
    lastSavedText = null,
    isSaving = false,
}) => {
    const formattedDate = createdDate ? formatDate(createdDate) : '';
    const showDraftIndicator = hasDraft || isSaving || lastSavedText;

    return (
        <div className="bg-background">
            {/* Top row: Back button, PR title, DraftIndicator, Cancel button */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onBack}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <h1 className="text-lg font-semibold text-foreground">
                        Approve PR: {prName}
                    </h1>
                </div>
                <div className="flex items-center gap-3">
                    {showDraftIndicator && (
                        <DraftIndicator
                            lastSavedText={lastSavedText}
                            isSaving={isSaving}
                        />
                    )}
                    {onCancel && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onCancel}
                            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-4 w-4" />
                            <span className="hidden sm:inline">Cancel</span>
                        </Button>
                    )}
                </div>
            </div>

            {/* Metadata row: Project, Work Package, Status, Created date, Created by */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 border-b bg-muted/30 text-sm">
                <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Project:</span>
                    <span className="font-medium text-foreground">{projectName}</span>
                </div>

                <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Work Package:</span>
                    <span className="font-medium text-foreground">{workPackage}</span>
                </div>

                <Badge variant={getStatusBadgeVariant(status)}>
                    {status}
                </Badge>

                <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>Created: {formattedDate}</span>
                </div>

                <div className="flex items-center gap-1.5 text-muted-foreground">
                    <User className="h-3.5 w-3.5" />
                    <span>Created by: {createdBy}</span>
                </div>
            </div>
        </div>
    );
};
