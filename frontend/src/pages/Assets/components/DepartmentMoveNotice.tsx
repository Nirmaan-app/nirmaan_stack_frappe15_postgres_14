import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DepartmentMove, MIN_DEPARTMENT_REASON_LENGTH } from '@/utils/assetDepartment';

import { DepartmentBadge } from '../utils/departmentColumn';

interface DepartmentMoveNoticeProps {
    /** What the assignment does to the asset's department (`departmentMove`). */
    move: DepartmentMove | null;
    personName: string;
    /** The person's department, to explain the "no department yet" case. */
    personDepartment: string | null | undefined;
    assetDepartment: string | null | undefined;
    reason: string;
    onReasonChange: (reason: string) => void;
}

/**
 * Tells the assigner what happens to the asset's department, and asks why when the asset is moved
 * out of a department it already belongs to. The server re-checks the same rule.
 */
export const DepartmentMoveNotice: React.FC<DepartmentMoveNoticeProps> = ({
    move,
    personName,
    personDepartment,
    assetDepartment,
    reason,
    onReasonChange,
}) => {
    if (move?.from) {
        const tooShort = reason.trim().length > 0 && reason.trim().length < MIN_DEPARTMENT_REASON_LENGTH;
        // Compact: one line of text and a two-line box, so the Assign dialog stays short.
        return (
            <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                <div className="flex items-start gap-1.5 text-sm text-amber-900">
                    <AlertTriangle className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                    <p className="leading-6">
                        Moving from <DepartmentBadge department={move.from} /> to{' '}
                        <DepartmentBadge department={move.to} />, {personName}'s department. Why?
                    </p>
                </div>
                <Label htmlFor="departmentChangeReason" className="sr-only">
                    Reason for moving the asset to {move.to}
                </Label>
                <Textarea
                    id="departmentChangeReason"
                    value={reason}
                    onChange={(e) => onReasonChange(e.target.value)}
                    placeholder={`Reason (at least ${MIN_DEPARTMENT_REASON_LENGTH} characters)`}
                    rows={2}
                    className="min-h-[52px] resize-none bg-white"
                />
                <p className={`text-xs ${tooShort ? 'text-red-600' : 'text-amber-700'}`}>
                    {tooShort
                        ? `At least ${MIN_DEPARTMENT_REASON_LENGTH} characters.`
                        : "The reason is kept in the asset's history."}
                </p>
            </div>
        );
    }

    if (move) {
        return (
            <div className="flex items-start gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                <Info className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-blue-600" />
                <p className="leading-6">
                    This asset has no department yet. It will be set to <DepartmentBadge department={move.to} />,{' '}
                    {personName}'s department.
                </p>
            </div>
        );
    }

    if (assetDepartment && !personDepartment && personName) {
        return (
            <div className="flex items-start gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                <Info className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                <p className="leading-6">
                    {personName} has no department yet, so the asset stays in{' '}
                    <DepartmentBadge department={assetDepartment} />. HR can set the department in Edit User.
                </p>
            </div>
        );
    }

    return null;
};
