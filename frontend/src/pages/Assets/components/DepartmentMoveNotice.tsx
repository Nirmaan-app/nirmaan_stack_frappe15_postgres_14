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
        return (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <div className="flex items-start gap-2 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                    <p className="leading-7">
                        This asset belongs to <DepartmentBadge department={move.from} />. {personName} is in{' '}
                        <DepartmentBadge department={move.to} />. Why are you moving it to {move.to}?
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
                    className="bg-white"
                />
                <p className={`text-xs ${tooShort ? 'text-red-600' : 'text-amber-700'}`}>
                    {tooShort
                        ? `Add a little more: at least ${MIN_DEPARTMENT_REASON_LENGTH} characters.`
                        : `On Confirm, the asset moves to ${move.to} and the reason is kept in its history.`}
                </p>
            </div>
        );
    }

    if (move) {
        return (
            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
                <p className="leading-7">
                    This asset has no department yet. It will be set to <DepartmentBadge department={move.to} />,{' '}
                    {personName}'s department.
                </p>
            </div>
        );
    }

    if (assetDepartment && !personDepartment && personName) {
        return (
            <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
                <p className="leading-7">
                    {personName} has no department yet, so the asset stays in{' '}
                    <DepartmentBadge department={assetDepartment} />. HR can set the department in Edit User.
                </p>
            </div>
        );
    }

    return null;
};
