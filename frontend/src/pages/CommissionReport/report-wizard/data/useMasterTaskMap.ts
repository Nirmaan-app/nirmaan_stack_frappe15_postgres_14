// One-shot fetch of every Commission Report Tasks master row, returned as a
// Map keyed by `${category_link}::${task_name}` so child rows can be matched
// to their masters in O(1) without per-row queries.
//
// Use sparingly — call it once per page (e.g. in the tracker detail page) and
// pass the resulting map down via props.

import { useFrappeGetDocList } from 'frappe-react-sdk';
import { useMemo } from 'react';

import { useApiErrorLogger } from '@/utils/sentry/useApiErrorLogger';

import { COMMISSION_TASK_MASTER_DOCTYPE } from '../../commission.constants';
import type { CommissionTaskMaster } from '../../types';
import { masterMapKey, type MasterTaskInfo } from '../../components/FillReportButton';

export interface UseMasterTaskMapResult {
    isLoading: boolean;
    map: Map<string, MasterTaskInfo>;
}

export const useMasterTaskMap = (): UseMasterTaskMapResult => {
    const { data, error, isLoading } = useFrappeGetDocList<CommissionTaskMaster>(
        COMMISSION_TASK_MASTER_DOCTYPE,
        {
            fields: ['name', 'task_name', 'category_link', 'source_format', 'is_active'],
            limit: 0,
            orderBy: { field: 'creation', order: 'asc' },
        },
        ['commission', 'master-task-map'],
    );

    useApiErrorLogger(error, {
        hook: 'useMasterTaskMap',
        api: 'Get Doc List',
        feature: 'commission-report',
        doctype: COMMISSION_TASK_MASTER_DOCTYPE,
    });

    return useMemo(() => {
        const map = new Map<string, MasterTaskInfo>();
        for (const m of data || []) {
            const key = masterMapKey(m.category_link, m.task_name);
            const hasTemplate = !!(m.source_format && m.source_format.trim());
            map.set(key, {
                masterName: m.name,
                hasTemplate,
                isActive: m.is_active !== 0,
            });
        }
        return { isLoading, map };
    }, [data, isLoading]);
};
