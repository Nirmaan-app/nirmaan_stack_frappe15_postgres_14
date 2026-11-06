import React, { useEffect, useMemo, useState } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';
import { PackageCheck, PackageX } from 'lucide-react';

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { AssetHistoryRow } from '@/utils/assetHistory';
import {
    type HolderAssignmentFields,
    MIN_LOST_DAMAGED_REASON,
    holderAuditRecord,
    isLostDamagedReasonValid,
} from '@/utils/assetLostDamaged';
import { getFrappeError } from '@/utils/frappeErrors';
import { useAssetDataRefresh } from '../hooks/useAssetDataRefresh';
import { AuditAnswersList } from './AuditAnswers';

export type LostDamagedMode = 'mark' | 'recover';

interface LostDamagedDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    /** 'mark' = Mark as Lost/Damaged; 'recover' = Mark as Found/Repaired. */
    mode: LostDamagedMode;
    assetId: string;
    assetName: string;
    /** The current holder (mark only): their assignment ends, and their audit record is shown first. */
    holderId?: string | null;
    holderName?: string | null;
    assignment?: HolderAssignmentFields | null;
    history?: AssetHistoryRow[];
    onDone?: () => void;
}

const COPY = {
    mark: {
        title: 'Mark as Lost/Damaged',
        method: 'nirmaan_stack.api.assets.lost_damaged.mark_lost_damaged',
        placeholder: 'e.g. Stolen from the site vehicle on 29 Oct / Screen cracked, sent for repair',
        button: 'Mark as Lost/Damaged',
        busy: 'Marking...',
        done: 'Marked Lost/Damaged',
    },
    recover: {
        title: 'Mark as Found/Repaired',
        method: 'nirmaan_stack.api.assets.lost_damaged.mark_found_repaired',
        placeholder: 'e.g. Found in the site store room / Back from the service centre, working',
        button: 'Mark as Found/Repaired',
        busy: 'Saving...',
        done: 'Marked Found/Repaired',
    },
} as const;

/**
 * Mark an asset Lost/Damaged, or bring it back Found/Repaired -- Admin and HR only (owner, 2026-10-31). The server
 * (`api/assets/lost_damaged.py`) re-checks who, the state and the reason. Marking a held asset unassigns it at once;
 * before that, the holder's audit record is shown for information (owner, Q7).
 */
export const LostDamagedDialog: React.FC<LostDamagedDialogProps> = ({
    isOpen,
    onOpenChange,
    mode,
    assetId,
    assetName,
    holderId,
    holderName,
    assignment,
    history,
    onDone,
}) => {
    const copy = COPY[mode];
    const [reason, setReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { toast } = useToast();
    const { refreshSummaryCards } = useAssetDataRefresh();
    const { call } = useFrappePostCall(copy.method);

    useEffect(() => {
        if (isOpen) setReason('');
    }, [isOpen]);

    const audit = useMemo(
        () => (mode === 'mark' && holderId ? holderAuditRecord(holderId, assignment, history) : null),
        [mode, holderId, assignment, history],
    );
    const typed = reason.trim().length;
    const canSubmit = isLostDamagedReasonValid(reason) && !isSubmitting;

    const handleSubmit = async () => {
        setIsSubmitting(true);
        try {
            await call({ asset: assetId, reason: reason.trim() });
            toast({
                title: copy.done,
                description:
                    mode === 'mark'
                        ? `${assetName} is marked Lost/Damaged${holderName ? ` and unassigned from ${holderName}` : ''}.`
                        : `${assetName} is back in Unassigned. Assign it to hand it out again.`,
                variant: 'success',
            });
            onOpenChange(false);
            refreshSummaryCards();
            onDone?.();
        } catch (error: unknown) {
            toast({ title: `${copy.title} failed`, description: getFrappeError(error), variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
            <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
                <AlertDialogHeader>
                    <div
                        className={cn(
                            'mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full',
                            mode === 'mark' ? 'bg-red-50' : 'bg-emerald-50',
                        )}
                    >
                        {mode === 'mark' ? (
                            <PackageX className="h-6 w-6 text-red-600" />
                        ) : (
                            <PackageCheck className="h-6 w-6 text-emerald-600" />
                        )}
                    </div>
                    <AlertDialogTitle className="text-center">{copy.title}</AlertDialogTitle>
                    <AlertDialogDescription className="text-center">
                        <span className="font-medium text-gray-700">{assetName}</span> ({assetId})
                        <span className="text-xs text-gray-500 mt-2 block">
                            {mode === 'mark'
                                ? holderName
                                    ? `This also unassigns it from ${holderName} straight away. While Lost/Damaged it can't be assigned and isn't audited.`
                                    : "While Lost/Damaged it can't be assigned and isn't audited."
                                : 'It goes back to Unassigned. Nobody gets it until someone assigns it again, with a fresh declaration.'}
                        </span>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {audit && (
                    <div
                        className={cn(
                            'rounded-md border px-3 py-2.5 text-sm space-y-1.5',
                            audit.owes ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50',
                        )}
                        data-testid="lost-damaged-audit-record"
                    >
                        <p className="font-medium text-gray-900">{holderName ?? holderId}'s audits</p>
                        <p className="text-gray-700">{audit.lastSent}</p>
                        {audit.lastAnswers.length > 0 && <AuditAnswersList answers={audit.lastAnswers} className="bg-white" />}
                        <p className={audit.owes ? 'text-amber-800' : 'text-gray-600'}>{audit.openNow}</p>
                    </div>
                )}

                <div className="space-y-1.5">
                    <Label htmlFor="lost-damaged-reason" className="text-sm font-medium">
                        Reason <span className="text-red-500">*</span>
                    </Label>
                    <Textarea
                        id="lost-damaged-reason"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={copy.placeholder}
                        disabled={isSubmitting}
                        rows={3}
                    />
                    <p className={cn('text-xs', typed < MIN_LOST_DAMAGED_REASON ? 'text-red-600' : 'text-gray-500')}>
                        {typed < MIN_LOST_DAMAGED_REASON
                            ? `${MIN_LOST_DAMAGED_REASON - typed} more character${MIN_LOST_DAMAGED_REASON - typed === 1 ? '' : 's'} needed`
                            : 'Kept in the asset history.'}
                    </p>
                </div>

                <AlertDialogFooter className="sm:justify-center gap-2">
                    <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(event) => {
                            // Radix closes the dialog on this click by default; it closes only on success.
                            event.preventDefault();
                            handleSubmit();
                        }}
                        disabled={!canSubmit}
                        className={cn(
                            'text-white',
                            mode === 'mark'
                                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-600'
                                : 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-600',
                        )}
                    >
                        {isSubmitting ? copy.busy : copy.button}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
