// frontend/src/pages/ProjectDesignTracker/components/TeamPerformanceSummary.tsx

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Users, UserX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useTeamSummary, useFilteredTasks } from '../hooks/useTeamSummary';
import { useDesignMasters } from '../hooks/useDesignMasters';
import { InlineTaskList } from './InlineTaskList';
import { TeamSummaryFilterBar } from './TeamSummaryFilterBar';
import { getUnifiedStatusStyle } from '../utils';
import { formatDate } from '@/utils/FormatDate';
import {
    UNASSIGNED_SENTINEL,
    TaskPreviewFilter,
    InlineTaskExpansion,
    StatusCountMap,
    UserTaskSummary,
    ProjectTaskSummary,
    TeamSummaryFilters,
} from '../types';

// ==================== Types ====================

interface TeamPerformanceSummaryProps {
    hasAccess: boolean;
    taskPhase?: string; // "Onboarding" or "Handover" - undefined means all phases
}

// Status columns configuration
type StatusColumn = {
    key: keyof StatusCountMap;
    header: string;
    abbrev: string;
};

const STATUS_COLUMNS: StatusColumn[] = [
    { key: 'Not Started', header: 'Not Started', abbrev: 'Not Started' },
    { key: 'Drawings Awaiting from Client', header: 'Drawings Awaiting from Client', abbrev: 'Drawings Awaiting' },
    { key: 'In Progress', header: 'In Progress', abbrev: 'In Prog' },
    { key: 'Submitted', header: 'Submitted', abbrev: 'Submitted' },
    { key: 'Revision Pending', header: 'Revision Pending', abbrev: 'Revision' },
    { key: 'Clarification Awaiting', header: 'Clarification Awaiting', abbrev: 'Clarif.' },
    { key: 'Approved', header: 'Approved', abbrev: 'Approved' },
];

// Helper function for formatting date range display
function formatDateRange(from?: string, to?: string): string {
    if (from && to) return `${formatDate(from)} - ${formatDate(to)}`;
    if (from) return `From ${formatDate(from)}`;
    if (to) return `Until ${formatDate(to)}`;
    return '';
}

// ==================== CountCell Component ====================

interface CountCellProps {
    count: number;
    status: string;
    userName: string;
    onClick: () => void;
    isTotal?: boolean;
    isSelected?: boolean;
    expansionId?: string;  // ID of the expansion row for aria-controls
}

const CountCell = React.memo<CountCellProps>(
    ({ count, status, userName, onClick, isTotal = false, isSelected = false, expansionId }) => {
        if (count === 0) {
            return (
                <td
                    className="py-1 px-2 text-center text-muted-foreground"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                    -
                </td>
            );
        }

        const statusStyle = isTotal
            ? 'bg-gray-100 text-gray-800 border border-gray-300'
            : getUnifiedStatusStyle(status);

        const selectedRing = isSelected ? 'ring-2 ring-offset-1 ring-blue-500' : '';

        return (
            <td
                className="py-1 px-2 text-center"
                style={{ fontVariantNumeric: 'tabular-nums' }}
            >
                <button
                    type="button"
                    onClick={onClick}
                    className={`inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 text-xs font-medium rounded transition-all hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 ${statusStyle} ${selectedRing}`}
                    aria-label={`View ${count} ${status} task${count !== 1 ? 's' : ''} for ${userName}`}
                    aria-expanded={isSelected}
                    aria-controls={isSelected ? expansionId : undefined}
                >
                    {count}
                </button>
            </td>
        );
    }
);
CountCell.displayName = 'CountCell';

// ==================== ProjectRow Component ====================

interface ProjectRowProps {
    project: ProjectTaskSummary;
    user: UserTaskSummary;
    isLast: boolean;
    onCountClick: (filter: TaskPreviewFilter) => void;
    inlineExpansion: InlineTaskExpansion | null;
}

const ProjectRow = React.memo<ProjectRowProps>(
    ({ project, user, isLast, onCountClick, inlineExpansion }) => {
        const treePrefix = isLast ? '\u2514\u2500' : '\u251C\u2500'; // └─ or ├─
        const expansionIdBase = `expansion-${user.user_id}-${project.project_id}`;

        return (
            <tr className="bg-gray-50/50" style={{ height: '32px' }}>
                <td className="py-1 px-3 text-gray-600 text-sm">
                    <span className="flex items-center gap-1">
                        <span
                            aria-hidden="true"
                            className="text-gray-400 font-mono text-xs w-5 inline-block"
                        >
                            {treePrefix}
                        </span>
                        <span className="truncate max-w-[150px]" title={project.project_name}>
                            {project.project_name}
                        </span>
                    </span>
                </td>
                {STATUS_COLUMNS.map((col) => {
                    const isSelected =
                        inlineExpansion?.userId === user.user_id &&
                        inlineExpansion?.projectId === project.project_id &&
                        inlineExpansion?.status === col.header;
                    return (
                        <CountCell
                            key={col.key}
                            count={project.counts[col.key]}
                            status={col.header}
                            userName={user.user_name}
                            isTotal={col.key === 'total'}
                            isSelected={isSelected}
                            expansionId={isSelected ? expansionIdBase : undefined}
                            onClick={() =>
                                onCountClick({
                                    user_id: user.user_id,
                                    user_name: user.user_name,
                                    status: col.header,
                                    project_id: project.project_id,
                                    project_name: project.project_name,
                                })
                            }
                        />
                    );
                })}
            </tr>
        );
    }
);
ProjectRow.displayName = 'ProjectRow';

// ==================== UserRow Component ====================

interface UserRowProps {
    user: UserTaskSummary;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onCountClick: (filter: TaskPreviewFilter) => void;
    isDesignLead?: boolean;
    inlineExpansion: InlineTaskExpansion | null;
}

const UserRow = React.memo<UserRowProps>(
    ({ user, isExpanded, onToggleExpand, onCountClick, isDesignLead, inlineExpansion }) => {
        const hasProjects = user.projects.length > 0;
        const projectsId = `user-projects-${user.user_id}`;
        const expansionIdBase = `expansion-${user.user_id}`;
        const isUnassigned = user.user_id === UNASSIGNED_SENTINEL;

        return (
            <tr className={`transition-colors ${isUnassigned ? 'bg-amber-50/30 hover:bg-amber-50/50' : 'hover:bg-gray-50'}`} style={{ height: '32px' }}>
                <td className="py-1 px-3 text-gray-900 text-sm font-medium">
                    <span className="flex items-center gap-1">
                        {hasProjects ? (
                            <button
                                type="button"
                                onClick={onToggleExpand}
                                className="inline-flex items-center justify-center w-5 h-5 rounded hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                                aria-expanded={isExpanded}
                                aria-controls={projectsId}
                                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} project breakdown for ${user.user_name}`}
                            >
                                {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
                                ) : (
                                    <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
                                )}
                            </button>
                        ) : (
                            <span className="w-5" />
                        )}
                        {isUnassigned && (
                            <UserX className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                        )}
                        <span className={`truncate max-w-[150px] ${isUnassigned ? 'text-amber-800 italic' : ''}`} title={user.user_name}>
                            {user.user_name}
                        </span>
                        {!isUnassigned && isDesignLead && (
                            <Badge
                                variant="outline"
                                className="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium bg-purple-50 text-purple-700 border-purple-200"
                            >
                                Lead
                            </Badge>
                        )}
                    </span>
                </td>
                {STATUS_COLUMNS.map((col) => {
                    const isSelected =
                        inlineExpansion?.userId === user.user_id &&
                        !inlineExpansion?.projectId &&
                        inlineExpansion?.status === col.header;
                    return (
                        <CountCell
                            key={col.key}
                            count={user.totals[col.key]}
                            status={col.header}
                            userName={user.user_name}
                            isTotal={col.key === 'total'}
                            isSelected={isSelected}
                            expansionId={isSelected ? expansionIdBase : undefined}
                            onClick={() =>
                                onCountClick({
                                    user_id: user.user_id,
                                    user_name: user.user_name,
                                    status: col.header,
                                })
                            }
                        />
                    );
                })}
            </tr>
        );
    }
);
UserRow.displayName = 'UserRow';

// ==================== Main Component ====================

export const TeamPerformanceSummary: React.FC<TeamPerformanceSummaryProps> = ({
    hasAccess,
    taskPhase,
}) => {
    // Don't render if user doesn't have access
    if (!hasAccess) {
        return null;
    }

    // Filter state for team summary
    const [filters, setFilters] = useState<TeamSummaryFilters>({});

    const { summaryData, isLoading, error, refetch } = useTeamSummary(filters, taskPhase);
    const { usersList, statusOptions, subStatusOptions } = useDesignMasters();

    // Create a lookup map for user roles
    const userRoleMap = useMemo(() => {
        const map = new Map<string, string>();
        usersList?.forEach(user => map.set(user.name, user.role_profile));
        return map;
    }, [usersList]);

    // Section collapse state
    const [isExpanded, setIsExpanded] = useState(true);

    // Expanded user rows state
    const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

    // Inline task expansion state (replaces dialog)
    const [inlineExpansion, setInlineExpansion] = useState<InlineTaskExpansion | null>(null);

    // Extract primitive for dependency tracking (avoid object reference issues)
    const projectsKey = filters.projects?.map(p => p.value).join(',') || '';

    // Close inline expansion when filters change
    useEffect(() => {
        setInlineExpansion(null);
    }, [projectsKey, filters.deadlineFrom, filters.deadlineTo]);

    // Create filter for the hook (converts InlineTaskExpansion to TaskPreviewFilter)
    // Include filters from summary to ensure inline tasks match summary counts
    const taskFilter: TaskPreviewFilter | null = inlineExpansion ? {
        user_id: inlineExpansion.userId,
        user_name: inlineExpansion.userName,
        status: inlineExpansion.status,
        project_id: inlineExpansion.projectId,
        project_name: inlineExpansion.projectName,
        // Inherit project filter from summary when clicking user-level row (no specific project)
        projectIds: !inlineExpansion.projectId && filters.projects?.length
            ? filters.projects.map(p => p.value)
            : undefined,
        // Inherit deadline filters from summary filters
        deadlineFrom: filters.deadlineFrom,
        deadlineTo: filters.deadlineTo,
        // Inherit phase filter
        taskPhase,
    } : null;

    // Fetch filtered tasks when inline expansion is open
    const { tasks, isLoading: isLoadingTasks, refetch: refetchTasks } = useFilteredTasks(taskFilter);

    // Handlers
    const toggleUserExpand = useCallback((userId: string) => {
        setExpandedUsers((prev) => {
            const next = new Set(prev);
            if (next.has(userId)) {
                next.delete(userId);
            } else {
                next.add(userId);
            }
            return next;
        });
    }, []);

    const handleCountClick = useCallback((filter: TaskPreviewFilter) => {
        // Don't expand for "Total" column
        if (filter.status === 'Total') return;

        setInlineExpansion(prev => {
            // Convert to InlineTaskExpansion format
            const newExpansion: InlineTaskExpansion = {
                userId: filter.user_id,
                userName: filter.user_name,
                status: filter.status,
                projectId: filter.project_id,
                projectName: filter.project_name,
            };

            // Toggle off if clicking same cell
            if (prev?.userId === newExpansion.userId &&
                prev?.status === newExpansion.status &&
                prev?.projectId === newExpansion.projectId) {
                return null;
            }
            return newExpansion;
        });
    }, []);

    // Refetch both summary counts and inline task list after an edit
    const handleTaskUpdated = useCallback(() => {
        refetch();
        refetchTasks();
    }, [refetch, refetchTasks]);

    // Derived data
    const teamMembers = summaryData?.summary || [];
    const memberCount = teamMembers.length;

    // Content rendering based on state
    const renderContent = () => {
        if (isLoading) {
            return (
                <div className="p-4 space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                </div>
            );
        }

        if (error) {
            return (
                <div className="p-4 text-sm text-red-600">
                    Failed to load team summary. Please try again later.
                </div>
            );
        }

        if (memberCount === 0) {
            return (
                <div className="p-4 text-sm text-muted-foreground text-center">
                    No task assignments found
                </div>
            );
        }

        return (
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th
                                scope="col"
                                className="text-left py-2 px-3 font-medium text-gray-600 text-xs uppercase tracking-wider min-w-[180px]"
                            >
                                Team Member
                            </th>
                            {STATUS_COLUMNS.map((col) => (
                                <th
                                    key={col.key}
                                    scope="col"
                                    className="text-center py-2 px-2 font-medium text-gray-600 text-xs uppercase tracking-wider whitespace-nowrap"
                                    title={col.header}
                                >
                                    {col.abbrev}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {teamMembers.map((user) => (
                            <React.Fragment key={user.user_id}>
                                <UserRow
                                    user={user}
                                    isExpanded={expandedUsers.has(user.user_id)}
                                    onToggleExpand={() => toggleUserExpand(user.user_id)}
                                    onCountClick={handleCountClick}
                                    isDesignLead={userRoleMap.get(user.user_id) === "Nirmaan Design Lead Profile"}
                                    inlineExpansion={inlineExpansion}
                                />
                                {/* Render project rows if user is expanded */}
                                {expandedUsers.has(user.user_id) && user.projects.length > 0 && (
                                    <>
                                        {user.projects.map((project, idx) => (
                                            <React.Fragment key={project.project_id}>
                                                <ProjectRow
                                                    project={project}
                                                    user={user}
                                                    isLast={idx === user.projects.length - 1}
                                                    onCountClick={handleCountClick}
                                                    inlineExpansion={inlineExpansion}
                                                />
                                                {/* Inline task list for project-level expansion */}
                                                {inlineExpansion?.userId === user.user_id &&
                                                    inlineExpansion?.projectId === project.project_id && (
                                                    <InlineTaskList
                                                        filter={inlineExpansion}
                                                        tasks={tasks}
                                                        isLoading={isLoadingTasks}
                                                        onClose={() => setInlineExpansion(null)}
                                                        usersList={usersList || []}
                                                        statusOptions={statusOptions}
                                                        subStatusOptions={subStatusOptions}
                                                        onTaskUpdated={handleTaskUpdated}
                                                        expansionId={`expansion-${user.user_id}-${project.project_id}`}
                                                    />
                                                )}
                                            </React.Fragment>
                                        ))}
                                    </>
                                )}
                                {/* Inline task list for user-level expansion (no project filter) */}
                                {inlineExpansion?.userId === user.user_id && !inlineExpansion?.projectId && (
                                    <InlineTaskList
                                        filter={inlineExpansion}
                                        tasks={tasks}
                                        isLoading={isLoadingTasks}
                                        onClose={() => setInlineExpansion(null)}
                                        usersList={usersList || []}
                                        statusOptions={statusOptions}
                                        subStatusOptions={subStatusOptions}
                                        onTaskUpdated={handleTaskUpdated}
                                        expansionId={`expansion-${user.user_id}`}
                                    />
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    const sectionId = 'team-performance-content';

    return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger asChild>
                    <button
                        type="button"
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 rounded-t-lg"
                        aria-expanded={isExpanded}
                        aria-controls={sectionId}
                    >
                        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                            <Users className="h-4 w-4 text-gray-500" />
                            Team Performance Summary
                        </span>
                        <span className="flex items-center gap-2">
                            {!isLoading && memberCount > 0 && (
                                <Badge
                                    variant="secondary"
                                    className="bg-gray-100 text-gray-700 border border-gray-200 text-xs"
                                >
                                    {memberCount} member{memberCount !== 1 ? 's' : ''}
                                </Badge>
                            )}
                            {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-gray-500" />
                            ) : (
                                <ChevronRight className="h-4 w-4 text-gray-500" />
                            )}
                        </span>
                    </button>
                </CollapsibleTrigger>
                <CollapsibleContent id={sectionId}>
                    <div className="border-t border-gray-200">
                        {/* Filter Bar */}
                        <div className="px-4 pt-3 pb-2">
                            <TeamSummaryFilterBar
                                filters={filters}
                                onFiltersChange={setFilters}
                                onClearFilters={() => setFilters({})}
                            />
                            {/* Active Filter Badges */}
                            {((filters.projects && filters.projects.length > 0) || filters.deadlineFrom || filters.deadlineTo) && (
                                <div className="flex items-center gap-2 mt-2 text-xs flex-wrap">
                                    <span className="text-gray-500">Showing:</span>
                                    {filters.projects && filters.projects.length > 0 && (
                                        filters.projects.length <= 2 ? (
                                            // Show individual badges for 1-2 projects
                                            filters.projects.map((proj) => (
                                                <Badge
                                                    key={proj.value}
                                                    variant="outline"
                                                    className="bg-blue-50 text-blue-700 border-blue-200"
                                                >
                                                    {proj.label}
                                                </Badge>
                                            ))
                                        ) : (
                                            // Show count badge for 3+ projects
                                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                                {filters.projects.length} projects
                                            </Badge>
                                        )
                                    )}
                                    {(filters.deadlineFrom || filters.deadlineTo) && (
                                        <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                            {formatDateRange(filters.deadlineFrom, filters.deadlineTo)}
                                        </Badge>
                                    )}
                                </div>
                            )}
                        </div>
                        {renderContent()}
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
};
