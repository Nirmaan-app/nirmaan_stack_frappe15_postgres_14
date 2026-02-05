// frontend/src/pages/ProjectDesignTracker/components/TeamSummaryFilterBar.tsx

import { useMemo } from 'react';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import { format, parseISO } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FuzzySearchSelect, TokenSearchConfig } from '@/components/ui/fuzzy-search-select';
import { MinStandaloneDateFilter } from '@/components/ui/MinStandaloneDateFilter';
import { ProjectDesignTracker } from '../types';
import { TeamSummaryFilters, ProjectFilterOption } from '../types';

interface TeamSummaryFilterBarProps {
    filters: TeamSummaryFilters;
    onFiltersChange: (filters: TeamSummaryFilters) => void;
    onClearFilters: () => void;
}

// Token-based search config for projects
const projectSearchConfig: TokenSearchConfig = {
    searchFields: ['label', 'value'],
    minSearchLength: 1,
    partialMatch: true,
    minTokenLength: 1,
    fieldWeights: {
        'label': 2.0,
        'value': 1.5,
    },
    minTokenMatches: 1
};

export function TeamSummaryFilterBar({
    filters,
    onFiltersChange,
    onClearFilters
}: TeamSummaryFilterBarProps) {
    // Fetch projects from Design Trackers that are NOT hidden
    // This ensures we only show projects with visible design trackers
    const { data: trackersData, isLoading: trackersLoading } = useFrappeGetDocList<ProjectDesignTracker>(
        'Project Design Tracker',
        {
            fields: ['name', 'project', 'project_name', 'hide_design_tracker'],
            filters: [['hide_design_tracker', '!=', 1]],
            limit: 1000,
            orderBy: { field: 'creation', order: 'desc' },
        }
    );

    // Build unique project options from trackers (deduplicate by project ID)
    const projectOptions: ProjectFilterOption[] = useMemo(() => {
        if (!trackersData) return [];

        const seen = new Set<string>();
        const options: ProjectFilterOption[] = [];

        for (const tracker of trackersData) {
            if (tracker.project && !seen.has(tracker.project)) {
                seen.add(tracker.project);
                options.push({
                    value: tracker.project,
                    label: tracker.project_name || tracker.project,
                });
            }
        }

        // Sort alphabetically by label
        return options.sort((a, b) => a.label.localeCompare(b.label));
    }, [trackersData]);

    // Current selected projects for controlled multi-select
    const selectedProjects = filters.projects || [];

    // Derive hasActiveFilters - check if any filter has a value
    const hasActiveFilters = !!(
        (filters.projects && filters.projects.length > 0) ||
        filters.deadlineFrom ||
        filters.deadlineTo
    );

    // Handle multi-project change
    const handleProjectsChange = (options: readonly ProjectFilterOption[] | null) => {
        onFiltersChange({
            ...filters,
            projects: options ? [...options] : undefined,
        });
    };

    // Handle date range change from MinStandaloneDateFilter
    // The component uses setDaysRange(days, range) callback
    const handleDateRangeChange = (days: number | 'All' | 'custom', range?: DateRange) => {
        if (days === 'All') {
            // Clear date filters
            onFiltersChange({
                ...filters,
                deadlineFrom: undefined,
                deadlineTo: undefined,
            });
        } else if (range?.from && range?.to) {
            // Apply custom date range
            onFiltersChange({
                ...filters,
                deadlineFrom: format(range.from, 'yyyy-MM-dd'),
                deadlineTo: format(range.to, 'yyyy-MM-dd'),
            });
        }
    };

    // Parse date filters back to DateRange for the date picker
    const dateRange: DateRange | undefined = (filters.deadlineFrom && filters.deadlineTo)
        ? {
            from: parseISO(filters.deadlineFrom),
            to: parseISO(filters.deadlineTo),
        }
        : undefined;

    return (
        <div className="flex items-center gap-4 flex-wrap">
            {/* Project Filter (Multi-select) */}
            <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 font-medium">Projects</span>
                <FuzzySearchSelect<ProjectFilterOption, true>
                    allOptions={projectOptions}
                    tokenSearchConfig={projectSearchConfig}
                    isLoading={trackersLoading}
                    value={selectedProjects}
                    onChange={handleProjectsChange}
                    placeholder="All Projects"
                    isMulti
                    isClearable
                    closeMenuOnSelect={false}
                    hideSelectedOptions={false}
                    menuPortalTarget={document.body}
                    menuPosition="fixed"
                    styles={{
                        control: (base) => ({
                            ...base,
                            minWidth: '250px',
                            minHeight: '32px',
                            fontSize: '0.875rem',
                        }),
                        menu: (base) => ({
                            ...base,
                            zIndex: 9999,
                        }),
                        multiValue: (base) => ({
                            ...base,
                            backgroundColor: '#EFF6FF',
                            borderRadius: '4px',
                        }),
                        multiValueLabel: (base) => ({
                            ...base,
                            color: '#1D4ED8',
                            fontSize: '0.75rem',
                        }),
                        multiValueRemove: (base) => ({
                            ...base,
                            color: '#1D4ED8',
                            ':hover': {
                                backgroundColor: '#DBEAFE',
                                color: '#1E40AF',
                            },
                        }),
                    }}
                />
            </div>

            {/* Deadline Filter */}
            <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 font-medium">Deadline</span>
                <MinStandaloneDateFilter
                    dateRange={dateRange}
                    setDaysRange={handleDateRangeChange}
                />
            </div>

            {/* Clear Button - Show only when filters active */}
            {hasActiveFilters && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClearFilters}
                    className="text-gray-500 hover:text-gray-700 h-8"
                >
                    <X className="h-3 w-3 mr-1" />
                    Clear
                </Button>
            )}
        </div>
    );
}
