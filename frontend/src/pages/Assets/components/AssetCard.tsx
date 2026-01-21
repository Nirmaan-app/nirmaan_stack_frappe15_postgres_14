import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
    Package,
    Hash,
    User,
    UserPlus,
    UserMinus,
    ExternalLink,
    AlertTriangle,
} from 'lucide-react';

interface AssetCardProps {
    assetId: string;
    assetName: string;
    serialNumber?: string | null;
    condition?: string | null;
    assigneeName?: string | null;
    isAssigned: boolean;
    /** Whether the declaration document is pending (assigned but no declaration uploaded) */
    isDeclarationPending?: boolean;
    /** Show assign action button */
    showAssignAction?: boolean;
    /** Show unassign action button */
    showUnassignAction?: boolean;
    onAssignClick?: () => void;
    onUnassignClick?: () => void;
}

const conditionColorMap: Record<string, string> = {
    'New': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Good': 'bg-blue-50 text-blue-700 border-blue-200',
    'Fair': 'bg-amber-50 text-amber-700 border-amber-200',
    'Poor': 'bg-orange-50 text-orange-700 border-orange-200',
    'Damaged': 'bg-red-50 text-red-700 border-red-200',
};

export const AssetCard: React.FC<AssetCardProps> = ({
    assetId,
    assetName,
    serialNumber,
    condition,
    assigneeName,
    isAssigned,
    isDeclarationPending = false,
    showAssignAction = false,
    showUnassignAction = false,
    onAssignClick,
    onUnassignClick,
}) => {
    const [isHovered, setIsHovered] = useState(false);

    // Theme colors based on assignment status
    const themeColors = isAssigned
        ? {
            gradient: 'from-emerald-500 via-emerald-400 to-teal-400',
            iconBg: 'bg-emerald-100 text-emerald-600',
            iconBgHover: 'bg-emerald-500 text-white',
            border: 'hover:border-emerald-200',
            shadow: 'hover:shadow-emerald-100',
        }
        : {
            gradient: 'from-slate-400 via-slate-300 to-gray-300',
            iconBg: 'bg-gray-100 text-gray-500',
            iconBgHover: 'bg-gray-500 text-white',
            border: 'hover:border-gray-300',
            shadow: 'hover:shadow-gray-100',
        };

    return (
        <Card
            className={cn(
                'group relative flex flex-col overflow-hidden transition-all duration-300',
                'hover:shadow-lg',
                themeColors.border,
                themeColors.shadow
            )}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Gradient accent on hover */}
            <div
                className={cn(
                    'absolute inset-x-0 top-0 h-1 bg-gradient-to-r',
                    themeColors.gradient,
                    'transform origin-left transition-transform duration-300',
                    isHovered ? 'scale-x-100' : 'scale-x-0'
                )}
            />

            <CardHeader className="pb-2 pt-4">
                <div className="flex items-start gap-3 min-w-0">
                    <div
                        className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0',
                            'transition-all duration-300',
                            isHovered ? themeColors.iconBgHover : themeColors.iconBg,
                            isHovered && 'scale-105'
                        )}
                    >
                        <Package className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <CardTitle className="text-sm font-semibold truncate leading-tight">
                            {assetName}
                        </CardTitle>
                        <CardDescription className="text-xs font-mono truncate mt-0.5">
                            <Hash className="h-3 w-3 inline mr-0.5" />
                            {assetId.slice(-8)}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="flex-grow space-y-2 pt-0 pb-3">
                {/* Serial Number */}
                {serialNumber && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 truncate">
                            {serialNumber}
                        </span>
                    </div>
                )}

                {/* Condition Badge */}
                {condition && (
                    <Badge
                        variant="outline"
                        className={cn('text-xs font-medium', conditionColorMap[condition] || '')}
                    >
                        {condition}
                    </Badge>
                )}

                {/* Declaration Pending Warning */}
                {isAssigned && isDeclarationPending && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-amber-50 border border-amber-200">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                        <span className="text-xs font-medium text-amber-700">Declaration Pending</span>
                    </div>
                )}

                {/* Assignee */}
                {isAssigned && assigneeName && (
                    <div className="flex items-center gap-1.5 text-xs mt-2 pt-2 border-t border-gray-100">
                        <User className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                        <span className="text-gray-600 truncate">{assigneeName}</span>
                    </div>
                )}

                {/* Unassigned indicator */}
                {!isAssigned && (
                    <div className="flex items-center gap-1.5 text-xs mt-2 pt-2 border-t border-gray-100">
                        <User className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                        <span className="text-gray-400 italic">Unassigned</span>
                    </div>
                )}
            </CardContent>

            {/* Hover action footer */}
            <div
                className={cn(
                    'px-3 py-2.5 bg-muted/30 border-t',
                    'transform transition-all duration-300',
                    isHovered ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
                )}
            >
                <div className="flex items-center justify-between gap-2">
                    <Link
                        to={`/asset-management/${assetId}`}
                        className={cn(
                            'flex items-center gap-1.5 text-xs font-medium',
                            isAssigned ? 'text-emerald-600 hover:text-emerald-700' : 'text-gray-600 hover:text-gray-700',
                            'hover:underline'
                        )}
                    >
                        View Details
                        <ExternalLink className="h-3 w-3" />
                    </Link>

                    {/* Action button based on assignment status */}
                    {showAssignAction && !isAssigned && onAssignClick && (
                        <TooltipProvider delayDuration={0}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 gap-1 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onAssignClick();
                                        }}
                                    >
                                        <UserPlus className="h-3 w-3" />
                                        Assign
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    <p>Assign asset to a user</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}

                    {showUnassignAction && isAssigned && onUnassignClick && (
                        <TooltipProvider delayDuration={0}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 gap-1 text-xs text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onUnassignClick();
                                        }}
                                    >
                                        <UserMinus className="h-3 w-3" />
                                        Unassign
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    <p>Unassign asset from user</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>
            </div>
        </Card>
    );
};
