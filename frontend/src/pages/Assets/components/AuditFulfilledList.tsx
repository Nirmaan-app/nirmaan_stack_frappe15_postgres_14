import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFrappeGetCall, useFrappeGetDocList } from 'frappe-react-sdk';
import { ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react';

import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
    type AuditAnswer,
    auditMonthLabel,
    parseAuditAnswers,
    parseFulfilledText,
    sentLate,
} from '@/utils/assetAudit';
import { formatHistoryTime } from '@/utils/assetHistory';
import { getFrappeError } from '@/utils/frappeErrors';

import { ASSET_CACHE_KEYS, AssetCategoryType } from '../assets.constants';
import { AuditAnswersDialog, AuditChecksLabel } from './AuditAnswers';

const PAGE_LENGTH = 50;

/** An "Audit Fulfilled" history row, as `api/assets/history.get_asset_history` returns it. */
interface FulfilledRow {
    name: string;
    asset: string;
    asset_name: string;
    asset_category: string;
    assigned_to: string | null;
    done_on: string | null;
    declaration: string | null;
    reason: string | null;
    /** The questions and the holder's answers (owner, 2026-10-15); read through parseAuditAnswers. */
    audit_answers?: unknown;
}

/** The Answers view's columns: every question the shown audits answered, in the order first asked. */
function answerColumns(answersByRow: readonly AuditAnswer[][]): { id: string; q: string }[] {
    const columns = new Map<string, string>();
    answersByRow.forEach((answers) => answers.forEach((answer) => {
        if (!columns.has(answer.id)) columns.set(answer.id, answer.q);
    }));
    return [...columns].map(([id, q]) => ({ id, q }));
}


/** "2026-10" (the month input's value) for a date. */
const monthInputValue = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;

/** First and last day of a "2026-10" month, as YYYY-MM-DD. */
function monthRange(value: string): { from: string; to: string } {
    const [year, month] = value.split('-').map(Number);
    const last = new Date(year, month, 0).getDate();
    const mm = String(month).padStart(2, '0');
    return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

/**
 * The Asset Audit tab's Fulfilled view (owner, 2026-10-14): every audit SENT in the chosen month (the
 * history row's `done_on`), read from the asset history -- the assignment rows are deleted on unassign and
 * their photo is replaced each month, so only the history has every month. Each row also shows the month
 * the audit was FOR: usually the month it was sent; next month's when sent from the 28th; last month's when
 * sent in the grace days (to the 7th), marked late. No condition (owner, 2026-10-15): the answers show any issue.
 *
 * The holder's answers to the audit questions (owner, 2026-10-15): the Checks column ("All OK" / "2 issues")
 * opens them; the Answers view lays every audit of the month side by side, one column per question.
 */
export const AuditFulfilledList: React.FC<{ assetType: AssetCategoryType }> = ({ assetType }) => {
    const [month, setMonth] = useState(() => monthInputValue(new Date()));
    const [start, setStart] = useState(0);
    const [view, setView] = useState<'list' | 'answers'>('list');
    // The audit whose answers are open: its history row's name, so the dialog follows a refetch.
    const [openRowName, setOpenRowName] = useState<string | null>(null);

    const params = useMemo(() => {
        const { from, to } = monthRange(month);
        return { event: 'Audit Fulfilled', from_date: from, to_date: to, category_type: assetType, start, page_length: PAGE_LENGTH };
    }, [month, assetType, start]);

    const { data, isLoading, error } = useFrappeGetCall<{ message: { rows: FulfilledRow[]; total: number } }>(
        'nirmaan_stack.api.assets.history.get_asset_history',
        params,
        `${ASSET_CACHE_KEYS.AUDIT_FULFILLED_PREFIX}${assetType}:${month}:${start}`
    );
    const rows = useMemo(() => data?.message?.rows ?? [], [data]);
    const total = data?.message?.total ?? 0;
    const answersByRow = useMemo(() => rows.map((row) => parseAuditAnswers(row.audit_answers)), [rows]);
    const columns = useMemo(() => answerColumns(answersByRow), [answersByRow]);
    const openIndex = rows.findIndex((row) => row.name === openRowName);
    const openRow = openIndex >= 0 ? rows[openIndex] : null;
    const openSent = openRow ? parseFulfilledText(openRow.reason) : null;

    const { data: users } = useFrappeGetDocList<{ name: string; full_name: string }>(
        'Nirmaan Users',
        { fields: ['name', 'full_name'], limit: 0 },
        'users_for_pending_list'
    );
    const nameOf = useMemo(() => {
        const names = new Map((users ?? []).map((user) => [user.name, user.full_name]));
        return (id: string | null) => (id ? names.get(id) || id : '—');
    }, [users]);

    const label = (() => {
        const [year, mm] = month.split('-').map(Number);
        return auditMonthLabel(new Date(year, mm - 1, 1));
    })();

    if (error) return <AlertDestructive error={new Error(getFrappeError(error))} />;

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1">
                    <Label htmlFor="auditMonth" className="text-xs text-gray-600">Month</Label>
                    <Input
                        id="auditMonth"
                        type="month"
                        value={month}
                        max={monthInputValue(new Date())}
                        onChange={(event) => {
                            if (!event.target.value) return;
                            setMonth(event.target.value);
                            setStart(0);
                        }}
                        className="h-9 w-44"
                    />
                </div>
                <div className="inline-flex rounded-md bg-gray-100 p-0.5" role="group" aria-label="View">
                    {(['list', 'answers'] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={view === option}
                            onClick={() => setView(option)}
                            className={cn(
                                'rounded px-3 py-1 text-xs font-medium text-gray-600',
                                view === option && 'bg-white text-gray-900 shadow-sm'
                            )}
                        >
                            {option === 'list' ? 'List' : 'Answers'}
                        </button>
                    ))}
                </div>
                <p className="text-sm text-gray-600">
                    <span className="font-semibold tabular-nums text-emerald-700">{total}</span> audit{total === 1 ? '' : 's'} sent in {label}
                    <span className="block text-xs text-gray-500">Picked by the day it was sent. Months nobody sent show as "Audit Missed" in the asset's history.</span>
                </p>
            </div>

            {view === 'list' ? (
                <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-600">
                            <tr>
                                <th className="px-3 py-2">Asset</th>
                                <th className="px-3 py-2">Category</th>
                                <th className="px-3 py-2">Holder</th>
                                <th className="px-3 py-2">Checks</th>
                                <th className="px-3 py-2">Remarks</th>
                                <th className="px-3 py-2">Image</th>
                                <th className="px-3 py-2">For Month</th>
                                <th className="px-3 py-2">Sent On</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={8} className="p-3">
                                        <Skeleton className="h-24 w-full bg-gray-100" />
                                    </td>
                                </tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-3 py-10 text-center text-gray-500">
                                        No audits were sent in {label}.
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row, index) => {
                                    const sent = parseFulfilledText(row.reason);
                                    const answers = answersByRow[index];
                                    return (
                                        <tr key={row.name} className="hover:bg-gray-50/60">
                                            <td className="px-3 py-2">
                                                <Link to={`/asset-management/${row.asset}`} className="font-medium text-gray-900 hover:text-blue-600">
                                                    {row.asset_name || row.asset}
                                                </Link>
                                                <div className="text-xs text-gray-400 tabular-nums">{row.asset}</div>
                                            </td>
                                            <td className="px-3 py-2">
                                                <Badge variant="outline" className="font-normal">{row.asset_category}</Badge>
                                            </td>
                                            <td className="px-3 py-2">
                                                {row.assigned_to ? (
                                                    <Link to={`/users/${row.assigned_to}?tab=assets`} className="text-gray-700 hover:underline">
                                                        {nameOf(row.assigned_to)}
                                                    </Link>
                                                ) : (
                                                    '—'
                                                )}
                                            </td>
                                            <td className="px-3 py-2 whitespace-nowrap">
                                                {answers.length ? (
                                                    <button type="button" onClick={() => setOpenRowName(row.name)} className="hover:underline">
                                                        <AuditChecksLabel answers={answers} />
                                                    </button>
                                                ) : (
                                                    <span className="text-gray-400">—</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-gray-600">{sent.remarks || '—'}</td>
                                            <td className="px-3 py-2">
                                                {row.declaration ? (
                                                    <a
                                                        href={row.declaration}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
                                                    >
                                                        <ImageIcon className="h-3.5 w-3.5" />
                                                        View
                                                    </a>
                                                ) : (
                                                    '—'
                                                )}
                                            </td>
                                            <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                                                <span className="text-gray-700">{sent.forMonth || '—'}</span>
                                                {sentLate(sent.forMonth, row.done_on) && (
                                                    <span className="ml-1.5 text-xs text-amber-700" title="Sent after its month, in the grace days (by the 7th)">
                                                        late
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 whitespace-nowrap text-gray-500 tabular-nums">{formatHistoryTime(row.done_on)}</td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-600">
                            <tr>
                                <th className="px-3 py-2">Asset</th>
                                <th className="px-3 py-2">Holder</th>
                                {columns.map((column) => (
                                    <th key={column.id} className="px-3 py-2 min-w-[9rem]">{column.q}</th>
                                ))}
                                <th className="px-3 py-2">Sent On</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={columns.length + 3} className="p-3">
                                        <Skeleton className="h-24 w-full bg-gray-100" />
                                    </td>
                                </tr>
                            ) : columns.length === 0 ? (
                                <tr>
                                    <td colSpan={3} className="px-3 py-10 text-center text-gray-500">
                                        No audit sent in {label} has answers yet.
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row, index) => {
                                    const byId = new Map(answersByRow[index].map((answer) => [answer.id, answer]));
                                    return (
                                        <tr key={row.name} className="hover:bg-gray-50/60">
                                            <td className="px-3 py-2">
                                                <button type="button" onClick={() => setOpenRowName(row.name)} className="text-left font-medium text-gray-900 hover:text-blue-600">
                                                    {row.asset_name || row.asset}
                                                </button>
                                                <div className="text-xs text-gray-400 tabular-nums">{row.asset}</div>
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">{nameOf(row.assigned_to)}</td>
                                            {columns.map((column) => {
                                                const answer = byId.get(column.id);
                                                return (
                                                    <td
                                                        key={column.id}
                                                        title={answer?.text}
                                                        className={cn('px-3 py-2', answer?.flag ? 'font-medium text-red-700' : 'text-gray-700')}
                                                    >
                                                        {answer ? answer.a : <span className="text-gray-400">—</span>}
                                                        {answer?.text && <span className="block text-xs font-normal text-gray-500">“{answer.text}”</span>}
                                                    </td>
                                                );
                                            })}
                                            <td className="px-3 py-2 whitespace-nowrap text-gray-500 tabular-nums">{formatHistoryTime(row.done_on)}</td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {openRow && openSent && (
                <AuditAnswersDialog
                    open
                    onOpenChange={(open) => !open && setOpenRowName(null)}
                    answers={answersByRow[openIndex]}
                    title={`${openRow.asset_name || openRow.asset} · audit for ${openSent.forMonth ?? '—'}`}
                    subtitle={`Sent by ${nameOf(openRow.assigned_to)} on ${formatHistoryTime(openRow.done_on) ?? '—'}`}
                    photoUrl={openRow.declaration}
                    remarks={openSent.remarks}
                />
            )}

            {total > PAGE_LENGTH && (
                <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
                    <span className="tabular-nums">
                        {start + 1}–{Math.min(start + PAGE_LENGTH, total)} of {total}
                    </span>
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={start === 0} onClick={() => setStart(Math.max(0, start - PAGE_LENGTH))}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" disabled={start + PAGE_LENGTH >= total} onClick={() => setStart(start + PAGE_LENGTH)}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    );
};
