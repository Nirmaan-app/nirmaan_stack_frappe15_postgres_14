import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, ClipboardList, ImageIcon, ListChecks, MinusCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { type AuditAnswer, type AuditBadge, type AuditBadgeTone, countAuditIssues } from '@/utils/assetAudit';

import { AuditAnswersDialog } from './AuditAnswers';

const TONE: Record<AuditBadgeTone, { text: string; icon: React.ReactNode }> = {
    pending: { text: 'text-amber-600', icon: <ClipboardList className="h-4 w-4 flex-shrink-0" /> },
    overdue: { text: 'text-red-600', icon: <AlertTriangle className="h-4 w-4 flex-shrink-0" /> },
    done: { text: 'text-green-600', icon: <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> },
    none: { text: 'text-slate-500', icon: <ClipboardList className="h-4 w-4 flex-shrink-0" /> },
    off: { text: 'text-slate-400', icon: <MinusCircle className="h-4 w-4 flex-shrink-0" /> },
};

interface AuditStatusRowProps {
    badge: AuditBadge;
    /** The latest audit photo, linked as "View photo" once the audit is done. */
    proofUrl?: string | null;
    /** The holder, on their own profile, with an audit open. */
    canSubmit?: boolean;
    onSubmit?: () => void;
    /** The latest audit's answers (`Asset Management.audit_answers`): "View answers" once it is done. */
    answers?: readonly AuditAnswer[];
    /** Heading of the answers dialog: "Lux Meter · audit for 10/2026". */
    answersTitle?: string;
    className?: string;
}

/**
 * The monthly audit line (owner, 2026-10-14), laid out like the card's declaration row: one line, the
 * status on the left, the action on the right -- Submit audit for the holder while it is open. Once done,
 * "View Audit Photo" and "View answers" sit on the left like "View Declaration", and the date on the right. The longer
 * detail ("Pending since 09/2026 · 1 month") is the hover text.
 */
export const AuditStatusRow: React.FC<AuditStatusRowProps> = ({
    badge,
    proofUrl,
    canSubmit = false,
    onSubmit,
    answers = [],
    answersTitle,
    className,
}) => {
    const [answersOpen, setAnswersOpen] = useState(false);
    const tone = TONE[badge.tone];
    if (badge.tone === 'done' && proofUrl) {
        const issues = countAuditIssues(answers);
        return (
            <div className={cn('flex items-center justify-between gap-2 border-t pt-2', className)}>
                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <a
                        href={proofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 items-center gap-1.5 text-green-600 hover:underline"
                    >
                        <ImageIcon className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate text-xs font-medium">View Audit Photo</span>
                    </a>
                    {/* The questions and the holder's answers (owner, 2026-10-15); red when any answer was red. */}
                    {answers.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setAnswersOpen(true)}
                            className={cn(
                                'flex items-center gap-1.5 text-xs font-medium hover:underline',
                                issues ? 'text-red-600' : 'text-green-600'
                            )}
                        >
                            <ListChecks className="h-4 w-4 flex-shrink-0" />
                            View answers{issues ? ` · ${issues} ${issues === 1 ? 'issue' : 'issues'}` : ''}
                        </button>
                    )}
                </span>
                <span className="flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    {badge.text}
                </span>
                {answers.length > 0 && (
                    <AuditAnswersDialog
                        open={answersOpen}
                        onOpenChange={setAnswersOpen}
                        answers={answers}
                        title={answersTitle ?? 'Latest audit'}
                        subtitle={badge.text}
                        photoUrl={proofUrl}
                    />
                )}
            </div>
        );
    }
    return (
        <div className={cn('flex items-center justify-between gap-2 border-t pt-2', className)}>
            <span title={badge.hint ?? badge.text} className={cn('flex min-w-0 items-center gap-1.5', tone.text)}>
                {tone.icon}
                <span className="truncate text-xs font-medium">{badge.text}</span>
            </span>
            {canSubmit && onSubmit && (
                <Button
                    size="sm"
                    onClick={onSubmit}
                    className="h-7 flex-shrink-0 gap-1 px-2.5 text-xs bg-amber-600 text-white hover:bg-amber-700"
                >
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    Submit audit
                </Button>
            )}
        </div>
    );
};
