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
import { auditMonthLabel, conditionGotWorse, parseFulfilledText, sentLate } from '@/utils/assetAudit';
import { formatHistoryTime } from '@/utils/assetHistory';
import { getFrappeError } from '@/utils/frappeErrors';

import { ASSET_CACHE_KEYS, AssetCategoryType } from '../assets.constants';

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
}

const CONDITION_TEXT: Record<string, string> = {
    Good: 'text-blue-700',
    Fair: 'text-amber-700',
    Poor: 'text-orange-700',
    Damaged: 'text-red-700',
};

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
 * sent in the grace days (to the 7th), marked late. A worse condition shows in red.
 */
export const AuditFulfilledList: React.FC<{ assetType: AssetCategoryType }> = ({ assetType }) => {
    const [month, setMonth] = useState(() => monthInputValue(new Date()));
    const [start, setStart] = useState(0);

    const params = useMemo(() => {
        const { from, to } = monthRange(month);
        return { event: 'Audit Fulfilled', from_date: from, to_date: to, category_type: assetType, start, page_length: PAGE_LENGTH };
    }, [month, assetType, start]);

    const { data, isLoading, error } = useFrappeGetCall<{ message: { rows: FulfilledRow[]; total: number } }>(
        'nirmaan_stack.api.assets.history.get_asset_history',
        params,
        `${ASSET_CACHE_KEYS.AUDIT_FULFILLED_PREFIX}${assetType}:${month}:${start}`
    );
    const rows = data?.message?.rows ?? [];
    const total = data?.message?.total ?? 0;

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
                <p className="text-sm text-gray-600">
                    <span className="font-semibold tabular-nums text-emerald-700">{total}</span> audit{total === 1 ? '' : 's'} sent in {label}
                    <span className="block text-xs text-gray-500">Picked by the day it was sent. Months nobody sent show as "Audit Missed" in the asset's history.</span>
                </p>
            </div>

            <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-600">
                        <tr>
                            <th className="px-3 py-2">Asset</th>
                            <th className="px-3 py-2">Category</th>
                            <th className="px-3 py-2">Holder</th>
                            <th className="px-3 py-2">Condition</th>
                            <th className="px-3 py-2">Remarks</th>
                            <th className="px-3 py-2">Photo</th>
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
                            rows.map((row) => {
                                const sent = parseFulfilledText(row.reason);
                                const worse = conditionGotWorse(sent.previous, sent.condition);
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
                                        <td className={cn('px-3 py-2 font-medium whitespace-nowrap', worse ? 'text-red-700' : CONDITION_TEXT[sent.condition])}>
                                            {sent.previous && sent.previous !== sent.condition ? `${sent.previous} → ${sent.condition}` : sent.condition}
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
