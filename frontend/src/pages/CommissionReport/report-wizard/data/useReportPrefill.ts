// SWR-cached call to nirmaan_stack.api.commission_report.get_report_prefill.get_report_prefill.
// Returns the resolved binding dictionary for one project. Cached per-project so
// multiple wizard sessions on the same project share the result.

import { useFrappeGetCall } from 'frappe-react-sdk';

import { useApiErrorLogger } from '@/utils/sentry/useApiErrorLogger';

import { commissionKeys } from '../../commission.constants';
import type { PrefillSnapshot } from '../types';

interface PrefillResponse {
    message: PrefillSnapshot;
}

export interface UseReportPrefillResult {
    isLoading: boolean;
    error: Error | null;
    prefillDict: PrefillSnapshot;
    refetch: () => Promise<unknown>;
}

export const useReportPrefill = (projectId: string): UseReportPrefillResult => {
    const response = useFrappeGetCall<PrefillResponse>(
        'nirmaan_stack.api.commission_report.get_report_prefill.get_report_prefill',
        projectId ? { project: projectId } : undefined,
        projectId ? commissionKeys.reportPrefill(projectId) : null,
    );

    useApiErrorLogger(response.error, {
        hook: 'useReportPrefill',
        api: 'get_report_prefill',
        feature: 'commission-report',
        entity_id: projectId,
    });

    return {
        isLoading: response.isLoading,
        error: response.error ? (response.error as unknown as Error) : null,
        prefillDict: response.data?.message || {},
        refetch: response.mutate,
    };
};
