// Wraps the update_task_response API with optimistic-concurrency error handling.

import { useCallback, useState } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';

import { captureApiError } from '@/utils/sentry/captureApiError';

import type { ReportTemplate, ResponseData } from '../types';
import { canonicalJson } from '../template-parser';

export interface SubmitParams {
    parent: string;
    taskRowName: string;
    template: ReportTemplate;
    responseData: ResponseData;
    expectedModified: string;
}

export interface SubmitResult {
    snapshotId: string;
    parentModified: string;
}

export interface UseReportSubmitResult {
    submit: (params: SubmitParams) => Promise<SubmitResult>;
    isSubmitting: boolean;
    isConflict: boolean;
    /** Reset isConflict after the user acknowledges the refresh prompt. */
    clearConflict: () => void;
}

interface BackendResponse {
    message: {
        status: string;
        task_row_name: string;
        response_snapshot_id: string;
        parent_modified: string;
    };
}

const CONCURRENCY_TITLE = 'CommissionReportConcurrencyError';

const isConcurrencyError = (e: unknown): boolean => {
    if (!e || typeof e !== 'object') return false;
    const obj = e as Record<string, unknown>;
    if (obj._server_messages && typeof obj._server_messages === 'string') {
        return obj._server_messages.includes(CONCURRENCY_TITLE);
    }
    const msg = (obj.message as string | undefined) || '';
    if (typeof msg === 'string' && msg.includes(CONCURRENCY_TITLE)) return true;
    const httpStatus = obj.httpStatus as number | undefined;
    return httpStatus === 409;
};

export const useReportSubmit = (): UseReportSubmitResult => {
    const { call } = useFrappePostCall<BackendResponse>(
        'nirmaan_stack.api.commission_report.update_task_response.update_task_response',
    );
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isConflict, setIsConflict] = useState(false);

    const submit = useCallback(
        async (p: SubmitParams): Promise<SubmitResult> => {
            setIsSubmitting(true);
            setIsConflict(false);
            try {
                const result = await call({
                    parent: p.parent,
                    task_row_name: p.taskRowName,
                    response_data: JSON.stringify(p.responseData),
                    snapshot_payload: canonicalJson(p.template),
                    expected_modified: p.expectedModified,
                });
                return {
                    snapshotId: result.message.response_snapshot_id,
                    parentModified: String(result.message.parent_modified),
                };
            } catch (e) {
                if (isConcurrencyError(e)) {
                    setIsConflict(true);
                }
                captureApiError({
                    hook: 'useReportSubmit',
                    api: 'update_task_response',
                    feature: 'commission-report',
                    entity_id: p.taskRowName,
                    error: e,
                });
                throw e;
            } finally {
                setIsSubmitting(false);
            }
        },
        [call],
    );

    return {
        submit,
        isSubmitting,
        isConflict,
        clearConflict: () => setIsConflict(false),
    };
};
