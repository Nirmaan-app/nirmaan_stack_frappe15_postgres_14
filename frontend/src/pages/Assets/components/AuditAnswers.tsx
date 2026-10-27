import React from 'react';
import { AlertTriangle, ImageIcon, ListChecks } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { type AuditAnswer, auditChecksLabel, countAuditIssues } from '@/utils/assetAudit';

/**
 * An audit's questions, each with the holder's answer under it (owner, 2026-10-15). A red answer shows in red with
 * the text the holder typed, if any. The same list on the answers dialog and the asset's history card.
 */
export const AuditAnswersList: React.FC<{ answers: readonly AuditAnswer[]; className?: string }> = ({ answers, className }) => (
    <ol className={cn('divide-y rounded-md border', className)}>
        {answers.map((answer, index) => (
            <li key={`${answer.id}-${index}`} className="flex flex-col gap-0.5 px-3 py-2">
                <span className="text-xs text-muted-foreground">
                    {index + 1}. {answer.q}
                </span>
                <span className={cn('flex items-start gap-1.5 text-sm font-medium', answer.flag ? 'text-red-700' : 'text-gray-900')}>
                    {answer.flag && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />}
                    {answer.a}
                </span>
                {answer.text && <span className="text-xs text-gray-600">“{answer.text}”</span>}
            </li>
        ))}
    </ol>
);

/** "All OK" in green or "2 issues" in red; nothing for an audit sent before the questions existed. */
export const AuditChecksLabel: React.FC<{ answers: readonly AuditAnswer[]; className?: string }> = ({ answers, className }) => {
    const label = auditChecksLabel(answers);
    if (!label) return null;
    return (
        <span className={cn('text-xs font-semibold', countAuditIssues(answers) ? 'text-red-700' : 'text-green-700', className)}>
            {label}
        </span>
    );
};

interface AuditAnswersDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    answers: readonly AuditAnswer[];
    /** What was audited: "Lux Meter · audit for 10/2026". */
    title: string;
    /** Who sent it and when: "Sent by Pranav on 15-Oct-2026 · Condition Good". */
    subtitle?: string | null;
    photoUrl?: string | null;
    remarks?: string | null;
}

/** The answers of one audit, opened from the Fulfilled list, the holder's card or the asset page. */
export const AuditAnswersDialog: React.FC<AuditAnswersDialogProps> = ({
    open,
    onOpenChange,
    answers,
    title,
    subtitle,
    photoUrl,
    remarks,
}) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <ListChecks className="h-5 w-5 text-teal-600" />
                    Audit answers
                </DialogTitle>
                <DialogDescription>{title}</DialogDescription>
            </DialogHeader>
            {(subtitle || answers.length > 0) && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{subtitle}</span>
                    <AuditChecksLabel answers={answers} />
                </div>
            )}
            {answers.length > 0 ? (
                <AuditAnswersList answers={answers} />
            ) : (
                <p className="text-sm text-muted-foreground">This audit was sent before the questions were added.</p>
            )}
            {remarks && (
                <p className="text-sm text-gray-700">
                    <span className="font-medium">Remarks:</span> {remarks}
                </p>
            )}
            {photoUrl && (
                <a
                    href={photoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline"
                >
                    <ImageIcon className="h-4 w-4" />
                    View audit photo
                </a>
            )}
        </DialogContent>
    </Dialog>
);
