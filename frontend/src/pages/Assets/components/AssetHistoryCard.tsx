import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, ChevronDown, ClipboardCheck, ClipboardList, ClipboardX, ExternalLink, FileCheck, History, PackagePlus, Undo2, UserMinus, UserPlus } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { countAuditIssues } from '@/utils/assetAudit';
import { AssetHistoryRow, AuditKind, HistoryEntry, HistoryTone, describeHistory } from '@/utils/assetHistory';
import { AuditAnswersList } from './AuditAnswers';
import { useAssetHistoryPeople } from '../hooks/useAssetHistoryPeople';

const TONE_STYLE: Record<HistoryTone, { icon: React.ReactNode; dot: string }> = {
    added: { icon: <PackagePlus className="h-3.5 w-3.5" />, dot: 'bg-gray-100 text-gray-600' },
    assigned: { icon: <UserPlus className="h-3.5 w-3.5" />, dot: 'bg-emerald-100 text-emerald-700' },
    declaration: { icon: <FileCheck className="h-3.5 w-3.5" />, dot: 'bg-blue-100 text-blue-700' },
    unassigned: { icon: <UserMinus className="h-3.5 w-3.5" />, dot: 'bg-red-100 text-red-700' },
    department: { icon: <ArrowRightLeft className="h-3.5 w-3.5" />, dot: 'bg-indigo-100 text-indigo-700' },
    return: { icon: <Undo2 className="h-3.5 w-3.5" />, dot: 'bg-sky-100 text-sky-700' },
    audit: { icon: <ClipboardCheck className="h-3.5 w-3.5" />, dot: 'bg-teal-100 text-teal-700' },
};

// Each audit event its own icon and colour (owner, 2026-10-14): asked, sent, missed.
const AUDIT_STYLE: Record<AuditKind, { icon: React.ReactNode; dot: string }> = {
    requested: { icon: <ClipboardList className="h-3.5 w-3.5" />, dot: 'bg-amber-100 text-amber-700' },
    fulfilled: { icon: <ClipboardCheck className="h-3.5 w-3.5" />, dot: 'bg-teal-100 text-teal-700' },
    missed: { icon: <ClipboardX className="h-3.5 w-3.5" />, dot: 'bg-red-100 text-red-700' },
};

const FILTERS: { tone: HistoryTone | 'all'; label: string }[] = [
    { tone: 'all', label: 'All' },
    { tone: 'assigned', label: 'Assigned' },
    { tone: 'unassigned', label: 'Unassigned' },
    { tone: 'declaration', label: 'Declarations' },
    { tone: 'return', label: 'Returns' },
    { tone: 'audit', label: 'Audits' },
    { tone: 'department', label: 'Department' },
    { tone: 'added', label: 'Added' },
];

interface AssetHistoryCardProps {
    /** `asset.asset_history` from the asset document. */
    rows: AssetHistoryRow[] | undefined;
}

/** The asset's history -- every assignment, declaration and department change, newest first. */
export const AssetHistoryCard: React.FC<AssetHistoryCardProps> = ({ rows }) => {
    const { data: users } = useAssetHistoryPeople();

    const [filter, setFilter] = useState<HistoryTone | 'all'>('all');

    const allEntries = useMemo(() => {
        const names = new Map((users ?? []).map((user) => [user.name, user.full_name || user.name]));
        return describeHistory(rows ?? [], (id) => (id ? names.get(id) ?? id : '—'));
    }, [rows, users]);

    const countFor = (tone: HistoryTone | 'all') =>
        tone === 'all' ? allEntries.length : allEntries.filter((entry) => entry.tone === tone).length;
    const entries = filter === 'all' ? allEntries : allEntries.filter((entry) => entry.tone === filter);

    return (
        <Card className="md:col-span-2">
            <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                    <History className="h-4 w-4 text-gray-500" />
                    Asset History
                </CardTitle>
                <CardDescription>Every assignment, declaration, audit and department change, newest first.</CardDescription>
                {allEntries.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2" role="group" aria-label="Filter the history">
                        {FILTERS.filter((f) => f.tone === 'all' || countFor(f.tone) > 0).map((f) => (
                            <button
                                key={f.tone}
                                type="button"
                                onClick={() => setFilter(f.tone)}
                                aria-pressed={filter === f.tone}
                                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                    filter === f.tone ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                            >
                                {f.label} <span className="tabular-nums opacity-70">{countFor(f.tone)}</span>
                            </button>
                        ))}
                    </div>
                )}
            </CardHeader>
            <CardContent>
                {allEntries.length === 0 ? (
                    <p className="text-sm text-gray-500">No history yet. Changes from now on are recorded here.</p>
                ) : entries.length === 0 ? (
                    <p className="text-sm text-gray-500">Nothing of this kind yet.</p>
                ) : (
                    <ol className="space-y-0">
                        {entries.map((entry, index) => (
                            <li key={entry.key} className="relative flex gap-3 pb-4 last:pb-0">
                                {index < entries.length - 1 && (
                                    <span className="absolute left-[13px] top-7 bottom-0 w-px bg-gray-200" aria-hidden />
                                )}
                                <span
                                    className={`relative z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${(entry.auditKind ? AUDIT_STYLE[entry.auditKind] : TONE_STYLE[entry.tone]).dot}`}
                                >
                                    {(entry.auditKind ? AUDIT_STYLE[entry.auditKind] : TONE_STYLE[entry.tone]).icon}
                                </span>
                                <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                        <p className="text-sm font-medium text-gray-900">{entry.title}</p>
                                        {entry.when && (
                                            <span className="text-xs tabular-nums text-gray-500">{entry.when}</span>
                                        )}
                                    </div>
                                    {/* An audit entry is kept to three lines (owner, 2026-10-15). */}
                                    {entry.auditKind ? <AuditEntryDetails entry={entry} /> : <p className="text-xs text-gray-500">by {entry.by}</p>}
                                    {entry.department && (
                                        <p className="inline-flex rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                            {entry.department}
                                        </p>
                                    )}
                                    {entry.reason && !entry.auditKind && (
                                        <p className="text-sm italic text-gray-700">“{entry.reason}”</p>
                                    )}
                                    {entry.declarationUrl && (
                                        <a
                                            href={entry.declarationUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                                        >
                                            View declaration
                                            <ExternalLink className="h-3 w-3" />
                                        </a>
                                    )}
                                    {entry.declarationMissing && (
                                        <p className="text-xs italic text-gray-400">Declaration file no longer available</p>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ol>
                )}
            </CardContent>
        </Card>
    );
};

/**
 * An audit entry under its title, in at most two more lines (owner, 2026-10-15): the month and, for the runs,
 * who opened it -- then View photo and "4 answers · 1 issue" on the same line -- and the holder's remarks. The
 * answers open below only when asked for.
 */
const AuditEntryDetails: React.FC<{ entry: HistoryEntry }> = ({ entry }) => {
    const [open, setOpen] = useState(false);
    const issues = countAuditIssues(entry.answers);
    const parts: React.ReactNode[] = [];
    if (entry.auditLine) parts.push(<span key="line">{entry.auditLine}</span>);
    // A sent audit names its holder in the title; the others say who opened or recorded them.
    if (entry.auditKind !== 'fulfilled') parts.push(<span key="by">by {entry.by}</span>);
    if (entry.photoUrl) {
        parts.push(
            <a
                key="photo"
                href={entry.photoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
            >
                View photo
                <ExternalLink className="h-3 w-3" />
            </a>
        );
    }
    if (entry.answers.length > 0) {
        parts.push(
            <button
                key="answers"
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className={cn('inline-flex items-center gap-1 font-medium hover:underline', issues ? 'text-red-700' : 'text-teal-700')}
            >
                {entry.answers.length} answers{issues ? ` · ${issues} ${issues === 1 ? 'issue' : 'issues'}` : ' · all OK'}
                <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
            </button>
        );
    }
    return (
        <>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-gray-500">
                {parts.map((part, index) => (
                    <React.Fragment key={index}>
                        {index > 0 && <span aria-hidden>·</span>}
                        {part}
                    </React.Fragment>
                ))}
            </p>
            {entry.reason && (
                <p className="truncate text-xs italic text-gray-600" title={entry.reason}>
                    “{entry.reason}”
                </p>
            )}
            {open && <AuditAnswersList answers={entry.answers} className="bg-white" />}
        </>
    );
};
