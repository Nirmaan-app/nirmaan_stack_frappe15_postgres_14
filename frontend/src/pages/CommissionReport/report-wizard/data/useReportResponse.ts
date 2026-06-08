// Looks up the existing response_data for a single child task row inside an
// already-fetched parent commission report. Pure derivation — does NOT issue
// its own fetch; the parent doc is fetched by useCommissionTrackerDoc.

import { useMemo } from 'react';

import type { CommissionReportTask, ProjectCommissionReportType } from '../../types';
import type { ResponseData } from '../types';

export interface UseReportResponseResult {
    childRow: CommissionReportTask | null;
    response: ResponseData | null;
    isFilled: boolean;
    parseError: Error | null;
}

const tryParseResponse = (raw: string): { response: ResponseData | null; error: Error | null } => {
    try {
        const parsed = JSON.parse(raw) as ResponseData;
        if (!parsed || typeof parsed !== 'object' || !parsed.responses) {
            return { response: null, error: new Error('Malformed response_data: missing `responses`') };
        }
        return { response: parsed, error: null };
    } catch (e) {
        return { response: null, error: e as Error };
    }
};

export const useReportResponse = (
    parentDoc: ProjectCommissionReportType | null | undefined,
    childRowName: string,
): UseReportResponseResult => {
    return useMemo(() => {
        if (!parentDoc || !childRowName) {
            return { childRow: null, response: null, isFilled: false, parseError: null };
        }
        const row = parentDoc.commission_report_task.find((r) => r.name === childRowName);
        if (!row) {
            return { childRow: null, response: null, isFilled: false, parseError: null };
        }
        const raw = (row.response_data || '').trim();
        if (!raw) {
            return { childRow: row, response: null, isFilled: false, parseError: null };
        }
        const { response, error } = tryParseResponse(raw);
        return {
            childRow: row,
            response,
            isFilled: !!response,
            parseError: error,
        };
    }, [parentDoc, childRowName]);
};
