// Resolves the master Commission Report Tasks row for a given child task by
// (commission_category, task_name) — child rows store names, not links, so we
// have to look the master up by composite key.
//
// Combines that lookup with template parsing (delegates to useReportTemplate).

import { useFrappeGetDocList } from 'frappe-react-sdk';
import { useMemo } from 'react';

import { useApiErrorLogger } from '@/utils/sentry/useApiErrorLogger';

import { COMMISSION_TASK_MASTER_DOCTYPE } from '../../commission.constants';
import type { CommissionTaskMaster } from '../../types';
import { parseTemplate } from '../template-parser';
import type { ReportTemplate, TemplateValidationError } from '../types';

export interface UseReportTemplateForTaskResult {
    isLoading: boolean;
    masterTask: CommissionTaskMaster | null;
    template: ReportTemplate | null;
    templateErrors: TemplateValidationError[];
    hasValidTemplate: boolean;
    isInactive: boolean;
    notFound: boolean;
}

export const useReportTemplateForTask = (
    categoryName: string,
    taskName: string,
): UseReportTemplateForTaskResult => {
    const enabled = !!categoryName && !!taskName;
    const { data, error, isLoading } = useFrappeGetDocList<CommissionTaskMaster>(
        COMMISSION_TASK_MASTER_DOCTYPE,
        {
            fields: ['name', 'task_name', 'category_link', 'source_format', 'is_active'],
            limit: 1,
            filters: [
                ['category_link', '=', categoryName],
                ['task_name', '=', taskName],
            ],
        },
        enabled ? ['commission', 'master-by-task', categoryName, taskName] : null,
    );

    useApiErrorLogger(error, {
        hook: 'useReportTemplateForTask',
        api: 'Get Doc List',
        feature: 'commission-report',
        doctype: COMMISSION_TASK_MASTER_DOCTYPE,
        entity_id: `${categoryName}::${taskName}`,
    });

    return useMemo(() => {
        if (!enabled) {
            return {
                isLoading: false,
                masterTask: null,
                template: null,
                templateErrors: [],
                hasValidTemplate: false,
                isInactive: false,
                notFound: false,
            };
        }
        if (isLoading) {
            return {
                isLoading: true,
                masterTask: null,
                template: null,
                templateErrors: [],
                hasValidTemplate: false,
                isInactive: false,
                notFound: false,
            };
        }
        const master = (data && data[0]) || null;
        if (!master) {
            return {
                isLoading: false,
                masterTask: null,
                template: null,
                templateErrors: [],
                hasValidTemplate: false,
                isInactive: false,
                notFound: true,
            };
        }
        if (!master.source_format) {
            return {
                isLoading: false,
                masterTask: master,
                template: null,
                templateErrors: [],
                hasValidTemplate: false,
                isInactive: master.is_active === 0,
                notFound: false,
            };
        }
        const parsed = parseTemplate(master.source_format);
        return {
            isLoading: false,
            masterTask: master,
            template: parsed.ok ? parsed.template : null,
            templateErrors: parsed.ok ? [] : parsed.errors,
            hasValidTemplate: parsed.ok,
            isInactive: master.is_active === 0,
            notFound: false,
        };
    }, [data, enabled, isLoading]);
};
