// Loads a Commission Report Tasks master row, parses + validates source_format JSON.
// Surfaces malformed templates as a friendly error rather than crashing the wizard.

import { useMemo } from 'react';
import { useFrappeGetDoc } from 'frappe-react-sdk';

import { useApiErrorLogger } from '@/utils/sentry/useApiErrorLogger';

import {
    COMMISSION_TASK_MASTER_DOCTYPE,
    commissionKeys,
} from '../../commission.constants';
import type { CommissionTaskMaster } from '../../types';
import { parseTemplate } from '../template-parser';
import type { ReportTemplate, TemplateValidationError } from '../types';

export interface UseReportTemplateResult {
    isLoading: boolean;
    error: Error | null;
    masterTask: CommissionTaskMaster | null;
    template: ReportTemplate | null;
    /** Friendly per-issue errors when source_format JSON is broken. */
    templateErrors: TemplateValidationError[];
    /** True iff the master has source_format set AND parsed cleanly. */
    hasValidTemplate: boolean;
    /** True iff the master is soft-deleted. */
    isInactive: boolean;
}

/**
 * @param taskMasterName  Commission Report Tasks docname (the master). Pass empty
 *                        string when the master is unknown — the hook short-circuits.
 */
export const useReportTemplate = (taskMasterName: string): UseReportTemplateResult => {
    const swrKey = taskMasterName ? commissionKeys.reportTemplate(taskMasterName) : null;
    const { data, error, isLoading } = useFrappeGetDoc<CommissionTaskMaster>(
        COMMISSION_TASK_MASTER_DOCTYPE,
        taskMasterName || '',
        // Third arg is swrKey, NOT options — see frontend/CLAUDE.md gotcha.
        taskMasterName ? swrKey : undefined,
    );

    useApiErrorLogger(error, {
        hook: 'useReportTemplate',
        api: 'Get Doc',
        feature: 'commission-report',
        doctype: COMMISSION_TASK_MASTER_DOCTYPE,
        entity_id: taskMasterName,
    });

    const parsed = useMemo(() => {
        if (!data?.source_format) {
            return { template: null, templateErrors: [] as TemplateValidationError[] };
        }
        const result = parseTemplate(data.source_format);
        if (result.ok) return { template: result.template, templateErrors: [] };
        return { template: null, templateErrors: result.errors };
    }, [data?.source_format]);

    return {
        isLoading,
        error: error ? (error as unknown as Error) : null,
        masterTask: data || null,
        template: parsed.template,
        templateErrors: parsed.templateErrors,
        hasValidTemplate: !!parsed.template,
        isInactive: data ? data.is_active === 0 : false,
    };
};
