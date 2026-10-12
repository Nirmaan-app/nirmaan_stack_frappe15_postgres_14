import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFrappeGetCall, useFrappeGetDocList } from 'frappe-react-sdk';
import ReactSelect from 'react-select';
import { ChevronLeft, ChevronRight, ExternalLink, FilterX, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDestructive } from '@/components/layout/alert-banner/error-alert';
import { useDepartmentOptions } from '@/hooks/useDepartmentOptions';
import { formatHistoryTime } from '@/utils/assetHistory';
import { getFrappeError } from '@/utils/frappeErrors';

const PAGE_LENGTH = 50;

const EVENT_OPTIONS = [
    'Assigned',
    'Unassigned',
    'Declaration Signed',
    'Declaration Uploaded',
    'Department Set',
    'Asset Added',
].map((event) => ({ label: event, value: event }));

const EVENT_BADGE: Record<string, string> = {
    'Asset Added': 'bg-gray-50 text-gray-700 border-gray-200',
    Assigned: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Unassigned: 'bg-red-50 text-red-700 border-red-200',
    'Declaration Signed': 'bg-blue-50 text-blue-700 border-blue-200',
    'Declaration Uploaded': 'bg-blue-50 text-blue-700 border-blue-200',
    'Department Set': 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

interface HistoryListRow {
    name: string;
    asset: string;
    asset_name: string;
    asset_category: string;
    asset_department: string | null;
    event: string;
    assigned_to: string | null;
    done_by: string | null;
    done_on: string | null;
    declaration: string | null;
    from_department: string | null;
    to_department: string | null;
    reason: string | null;
}

interface Filters {
    event: string;
    department: string;
    person: string;
    asset: string;
    from_date: string;
    to_date: string;
}

const NO_FILTERS: Filters = { event: '', department: '', person: '', asset: '', from_date: '', to_date: '' };

const selectClassNames = { control: () => 'border-gray-200 hover:border-gray-300 min-h-9' };

/**
 * Every change to every asset, newest first, with filters -- Admin and HR only (the server refuses
 * anyone else). Rows come from `api/assets/history.get_asset_history`.
 */
export const AssetHistoryList: React.FC = () => {
    const [filters, setFilters] = useState<Filters>(NO_FILTERS);
    const [assetSearch, setAssetSearch] = useState('');
    const [start, setStart] = useState(0);

    // Type freely in the asset search; it applies a moment after typing stops.
    useEffect(() => {
        const timer = window.setTimeout(() => {
            setFilters((current) => (current.asset === assetSearch.trim() ? current : { ...current, asset: assetSearch.trim() }));
            setStart(0);
        }, 400);
        return () => window.clearTimeout(timer);
    }, [assetSearch]);

    const setFilter = (key: keyof Filters, value: string) => {
        setFilters((current) => ({ ...current, [key]: value }));
        setStart(0);
    };

    const params = useMemo(() => {
        const applied: Record<string, string | number> = { start, page_length: PAGE_LENGTH };
        (Object.keys(filters) as (keyof Filters)[]).forEach((key) => {
            if (filters[key]) applied[key] = filters[key];
        });
        return applied;
    }, [filters, start]);

    const { data, isLoading, error } = useFrappeGetCall<{ message: { rows: HistoryListRow[]; total: number } }>(
        'nirmaan_stack.api.assets.history.get_asset_history',
        params,
        `asset_history_list_${JSON.stringify(params)}`
    );
    const rows = data?.message?.rows ?? [];
    const total = data?.message?.total ?? 0;

    // Filter on any department, switched-off ones included, so old history can still be found.
    const { departments } = useDepartmentOptions(true, { includeInactive: true });
    const departmentOptions = useMemo(() => departments.map((d) => ({ label: d, value: d })), [departments]);

    const { data: users } = useFrappeGetDocList<{ name: string; full_name: string }>(
        'Nirmaan Users',
        { fields: ['name', 'full_name'], orderBy: { field: 'full_name', order: 'asc' }, limit: 0 },
        'asset_history_user_names'
    );
    const names = useMemo(() => new Map((users ?? []).map((u) => [u.name, u.full_name || u.name])), [users]);
    const nameOf = (id?: string | null) => (id ? names.get(id) ?? id : '—');
    const personOptions = useMemo(
        () => (users ?? []).map((u) => ({ label: u.full_name || u.name, value: u.name })),
        [users]
    );

    const hasFilters = Object.values(filters).some(Boolean) || !!assetSearch;
    const clearFilters = () => {
        setFilters(NO_FILTERS);
        setAssetSearch('');
        setStart(0);
    };

    if (error) return <AlertDestructive error={new Error(getFrappeError(error))} />;

    return (
        <div className="space-y-3">
            {/* Filters */}
            <div className="grid grid-cols-1 gap-3 rounded-lg border bg-gray-50/60 p-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className="space-y-1 lg:col-span-2">
                    <Label htmlFor="historyAssetSearch" className="text-xs text-gray-600">Asset</Label>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <Input
                            id="historyAssetSearch"
                            value={assetSearch}
                            onChange={(e) => setAssetSearch(e.target.value)}
                            placeholder="Asset ID or name"
                            className="h-9 bg-white pl-8"
                        />
                    </div>
                </div>
                <div className="space-y-1">
                    <Label htmlFor="historyEvent" className="text-xs text-gray-600">Event</Label>
                    <ReactSelect
                        inputId="historyEvent"
                        options={EVENT_OPTIONS}
                        value={EVENT_OPTIONS.find((o) => o.value === filters.event) ?? null}
                        onChange={(o) => setFilter('event', o?.value ?? '')}
                        placeholder="All events"
                        isClearable
                        classNames={selectClassNames}
                    />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="historyDepartment" className="text-xs text-gray-600">Department</Label>
                    <ReactSelect
                        inputId="historyDepartment"
                        options={departmentOptions}
                        value={departmentOptions.find((o) => o.value === filters.department) ?? null}
                        onChange={(o) => setFilter('department', o?.value ?? '')}
                        placeholder="All"
                        isClearable
                        classNames={selectClassNames}
                    />
                </div>
                <div className="space-y-1 lg:col-span-2">
                    <Label htmlFor="historyPerson" className="text-xs text-gray-600">Person (holder or done by)</Label>
                    <ReactSelect
                        inputId="historyPerson"
                        options={personOptions}
                        value={personOptions.find((o) => o.value === filters.person) ?? null}
                        onChange={(o) => setFilter('person', o?.value ?? '')}
                        placeholder="Anyone"
                        isClearable
                        classNames={selectClassNames}
                    />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="historyFrom" className="text-xs text-gray-600">From</Label>
                    <Input
                        id="historyFrom"
                        type="date"
                        value={filters.from_date}
                        onChange={(e) => setFilter('from_date', e.target.value)}
                        className="h-9 bg-white"
                    />
                </div>
                <div className="space-y-1">
                    <Label htmlFor="historyTo" className="text-xs text-gray-600">To</Label>
                    <Input
                        id="historyTo"
                        type="date"
                        value={filters.to_date}
                        onChange={(e) => setFilter('to_date', e.target.value)}
                        className="h-9 bg-white"
                    />
                </div>
                <div className="flex items-end lg:col-span-4 lg:justify-end">
                    <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!hasFilters} className="gap-1.5 text-gray-600">
                        <FilterX className="h-4 w-4" />
                        Clear filters
                    </Button>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border bg-white">
                <table className="w-full min-w-[900px] text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                        <tr>
                            <th className="px-3 py-2">When</th>
                            <th className="px-3 py-2">Asset</th>
                            <th className="px-3 py-2">Event</th>
                            <th className="px-3 py-2">Person</th>
                            <th className="px-3 py-2">Done by</th>
                            <th className="px-3 py-2">Department</th>
                            <th className="px-3 py-2">Reason / file</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {isLoading ? (
                            [...Array(5)].map((_, i) => (
                                <tr key={i}>
                                    <td colSpan={7} className="px-3 py-2">
                                        <Skeleton className="h-6 w-full bg-gray-100" />
                                    </td>
                                </tr>
                            ))
                        ) : rows.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="px-3 py-10 text-center text-gray-500">
                                    {hasFilters ? 'No changes match these filters.' : 'No asset history yet.'}
                                </td>
                            </tr>
                        ) : (
                            rows.map((row) => {
                                const isDeclaration = row.event.startsWith('Declaration');
                                return (
                                    <tr key={row.name} className="align-top hover:bg-gray-50/60">
                                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">
                                            {formatHistoryTime(row.done_on) ?? '—'}
                                        </td>
                                        <td className="px-3 py-2">
                                            <Link to={`/asset-management/${row.asset}`} className="font-medium text-gray-900 hover:text-blue-600 hover:underline">
                                                {row.asset_name || row.asset}
                                            </Link>
                                            <div className="text-xs text-gray-500">{row.asset} · {row.asset_category}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <Badge variant="outline" className={`whitespace-nowrap font-medium ${EVENT_BADGE[row.event] ?? ''}`}>
                                                {row.event}
                                            </Badge>
                                        </td>
                                        <td className="px-3 py-2 text-gray-800">{row.assigned_to ? nameOf(row.assigned_to) : '—'}</td>
                                        <td className="px-3 py-2 text-gray-800">{nameOf(row.done_by)}</td>
                                        <td className="px-3 py-2">
                                            {row.from_department && row.to_department ? (
                                                <span className="whitespace-nowrap rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                                                    {row.from_department} → {row.to_department}
                                                </span>
                                            ) : row.to_department ? (
                                                <span className="text-xs text-gray-700">→ {row.to_department}</span>
                                            ) : (
                                                <span className="text-xs text-gray-400">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            {row.reason && <p className="text-sm italic text-gray-700">“{row.reason}”</p>}
                                            {isDeclaration && row.declaration && (
                                                <a href={row.declaration} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                                                    View declaration <ExternalLink className="h-3 w-3" />
                                                </a>
                                            )}
                                            {isDeclaration && !row.declaration && (
                                                <span className="text-xs italic text-gray-400">File no longer available</span>
                                            )}
                                            {!row.reason && !isDeclaration && <span className="text-xs text-gray-400">—</span>}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Paging */}
            <div className="flex items-center justify-between text-sm text-gray-600">
                <span className="tabular-nums">
                    {total === 0 ? '0 changes' : `${start + 1}–${Math.min(start + PAGE_LENGTH, total)} of ${total} changes`}
                </span>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setStart(Math.max(start - PAGE_LENGTH, 0))} disabled={start === 0 || isLoading} className="gap-1">
                        <ChevronLeft className="h-4 w-4" /> Previous
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setStart(start + PAGE_LENGTH)} disabled={start + PAGE_LENGTH >= total || isLoading} className="gap-1">
                        Next <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
};
