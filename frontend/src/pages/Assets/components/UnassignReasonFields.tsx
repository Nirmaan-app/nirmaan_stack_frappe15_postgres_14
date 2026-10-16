import React from 'react';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MIN_UNASSIGN_DETAILS, OTHER_UNASSIGN_REASON, UNASSIGN_REASONS } from '@/utils/assetUnassign';

interface UnassignReasonFieldsProps {
    reason: string;
    details: string;
    onReasonChange: (reason: string) => void;
    onDetailsChange: (details: string) => void;
    disabled?: boolean;
}

/**
 * Why the asset is being unassigned: a reason from the fixed list, plus details -- required with
 * "Other", optional otherwise. Both Unassign dialogs use it; the text lands on the asset's
 * "Unassigned" history row.
 */
export const UnassignReasonFields: React.FC<UnassignReasonFieldsProps> = ({
    reason,
    details,
    onReasonChange,
    onDetailsChange,
    disabled,
}) => {
    const isOther = reason === OTHER_UNASSIGN_REASON;
    const detailsShort = isOther && details.trim().length < MIN_UNASSIGN_DETAILS;

    return (
        <div className="space-y-3 text-left">
            <div className="space-y-1.5">
                <Label htmlFor="unassignReason" className="text-sm font-medium">
                    Reason for unassigning <span className="text-red-500">*</span>
                </Label>
                {/* The placeholder stays selectable (frontend CODING_STANDARDS: controlled <select>). */}
                <select
                    id="unassignReason"
                    value={reason}
                    onChange={(e) => onReasonChange(e.target.value)}
                    disabled={disabled}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                    <option value="">Select a reason…</option>
                    {UNASSIGN_REASONS.map((r) => (
                        <option key={r} value={r}>
                            {r === OTHER_UNASSIGN_REASON ? 'Other (explain below)' : r}
                        </option>
                    ))}
                </select>
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="unassignDetails" className="text-sm font-medium">
                    Details{' '}
                    <span className="text-xs font-normal text-gray-400">
                        {isOther ? `(required, at least ${MIN_UNASSIGN_DETAILS} characters)` : '(optional)'}
                    </span>
                </Label>
                <Textarea
                    id="unassignDetails"
                    value={details}
                    onChange={(e) => onDetailsChange(e.target.value)}
                    disabled={disabled}
                    rows={2}
                    placeholder="e.g. Returned on the last working day"
                />
                {detailsShort && details.trim().length > 0 && (
                    <p className="text-xs text-amber-600">
                        {MIN_UNASSIGN_DETAILS - details.trim().length} more characters needed.
                    </p>
                )}
            </div>
        </div>
    );
};
