import React, { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { Badge } from '@/components/ui/badge';
import { useDepartmentOptions } from '@/hooks/useDepartmentOptions';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { auditChecksLabel, auditHistorySummary, countAuditIssues, parseAuditAnswers } from '@/utils/assetAudit';
import { formatHistoryTime } from '@/utils/assetHistory';
import { HistoryFacetField, useAssetHistoryFacets } from '../hooks/useAssetHistoryFacets';
import { useAssetHistoryPeople } from '../hooks/useAssetHistoryPeople';
import { AuditAnswersDialog } from './AuditAnswers';

/** The audit events: their stored text is shown as one short line (+ the holder's remarks), not as a quote. */
const AUDIT_EVENTS = new Set(['Audit Requested', 'Audit Fulfilled', 'Audit Missed']);

const HISTORY_TABLE_METHOD = 'nirmaan_stack.api.assets.history.get_asset_history_table';

const EVENT_OPTIONS = [
    'Assigned',
    'Unassigned',
    'Declaration Signed',
    'Declaration Uploaded',
    'Department Set',
    'Asset Added',
    'Return Requested',
    'Return Rejected',
    'Audit Requested',
    'Audit Fulfilled',
    'Audit Missed',
].map((event) => ({ label: event, value: event }));

const EVENT_BADGE: Record<string, string> = {
    'Asset Added': 'bg-gray-50 text-gray-700 border-gray-200',
    Assigned: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Unassigned: 'bg-red-50 text-red-700 border-red-200',
    'Declaration Signed': 'bg-blue-50 text-blue-700 border-blue-200',
    'Declaration Uploaded': 'bg-blue-50 text-blue-700 border-blue-200',
    'Department Set': 'bg-indigo-50 text-indigo-700 border-indigo-200',
    'Return Requested': 'bg-sky-50 text-sky-700 border-sky-200',
    'Return Rejected': 'bg-sky-50 text-sky-700 border-sky-200',
    'Audit Requested': 'bg-amber-50 text-amber-700 border-amber-200',
    'Audit Fulfilled': 'bg-teal-50 text-teal-700 border-teal-200',
    'Audit Missed': 'bg-red-50 text-red-700 border-red-200',
};

/** One history row, as `get_asset_history_table` returns it. */
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
    /** Audit Fulfilled rows: the questions and the holder's answers (owner, 2026-10-15). */
    audit_answers?: unknown;
}

const SEARCH_FIELDS: SearchFieldOption[] = [
    { value: 'asset', label: 'Asset', placeholder: 'Search by asset ID or name...', default: true },
];

// The endpoint returns a fixed row shape; the hook still sends a field list, so name the columns read here.
const FETCH_FIELDS = [
    'name', 'asset', 'asset_name', 'asset_category', 'event', 'assigned_to', 'done_by', 'done_on',
    'declaration', 'from_department', 'to_department', 'reason', 'audit_answers',
];

/** "Projects → Accounts", "→ Accounts", or nothing -- the department a row moved the asset to. */
const departmentText = (row: HistoryListRow) =>
    row.from_department && row.to_department
        ? `${row.from_department} → ${row.to_department}`
        : row.to_department
          ? `→ ${row.to_department}`
          : '';

/**
 * Every change to every asset, newest first -- Admin and HR only (the server refuses anyone else). The shared
 * data table (owner, 2026-10-15): filters sit in the column headers -- When (dates), Event, Person, Done by,
 * Department -- with the asset search above, sorting, paging and CSV export. Rows come from
 * `api/assets/history.get_asset_history_table`, which reads the child table under the role-profile rule the
 * generic list API can't apply. A sent audit's answers open in a dialog from its "N answers" link.
 */
export const AssetHistoryList: React.FC = () => {
    // The Audit Fulfilled row whose answers are open: its name, so the dialog follows a refetch.
    const [answersRowName, setAnswersRowName] = useState<string | null>(null);

    // Filter on any department, switched-off ones included, so old history can still be found.
    const { departments } = useDepartmentOptions(true, { includeInactive: true });
    const { data: users } = useAssetHistoryPeople();
    const names = useMemo(() => new Map((users ?? []).map((u) => [u.name, u.full_name || u.name])), [users]);
    const nameOf = useMemo(() => (id?: string | null) => (id ? names.get(id) ?? id : '—'), [names]);

    // The header filters whose popover has been opened: only those fetch their counts.
    const [openedFacets, setOpenedFacets] = useState<ReadonlySet<string>>(() => new Set());
    const openFacet = (field: string) => setOpenedFacets((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));

    const columns = useMemo<ColumnDef<HistoryListRow>[]>(
        () => [
            {
                accessorKey: 'done_on',
                header: ({ column }) => <DataTableColumnHeader column={column} title="When" />,
                cell: ({ row }) => (
                    <span className="whitespace-nowrap tabular-nums text-gray-600">{formatHistoryTime(row.original.done_on) ?? '—'}</span>
                ),
                meta: { exportHeaderName: 'When', exportValue: (row: HistoryListRow) => formatHistoryTime(row.done_on) ?? '' },
                size: 170,
            },
            {
                accessorKey: 'asset',
                header: ({ column }) => <DataTableColumnHeader column={column} title="Asset" />,
                cell: ({ row }) => (
                    <div className="min-w-0">
                        <Link
                            to={`/asset-management/${row.original.asset}`}
                            className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                        >
                            {row.original.asset_name || row.original.asset}
                        </Link>
                        <div className="text-xs text-gray-500">
                            {row.original.asset} · {row.original.asset_category}
                        </div>
                    </div>
                ),
                meta: {
                    exportHeaderName: 'Asset',
                    exportValue: (row: HistoryListRow) => `${row.asset_name || ''} (${row.asset})`,
                },
                size: 220,
            },
            {
                accessorKey: 'event',
                header: ({ column }) => <DataTableColumnHeader column={column} title="Event" />,
                cell: ({ row }) => (
                    <Badge variant="outline" className={`whitespace-nowrap font-medium ${EVENT_BADGE[row.original.event] ?? ''}`}>
                        {row.original.event}
                    </Badge>
                ),
                meta: { exportHeaderName: 'Event', exportValue: (row: HistoryListRow) => row.event },
                size: 160,
            },
            {
                accessorKey: 'assigned_to',
                header: ({ column }) => <DataTableColumnHeader column={column} title="Person" />,
                cell: ({ row }) => <span className="text-gray-800">{row.original.assigned_to ? nameOf(row.original.assigned_to) : '—'}</span>,
                meta: { exportHeaderName: 'Person', exportValue: (row: HistoryListRow) => (row.assigned_to ? nameOf(row.assigned_to) : '') },
                size: 150,
            },
            {
                accessorKey: 'done_by',
                header: ({ column }) => <DataTableColumnHeader column={column} title="Done by" />,
                cell: ({ row }) => <span className="text-gray-800">{nameOf(row.original.done_by)}</span>,
                meta: { exportHeaderName: 'Done By', exportValue: (row: HistoryListRow) => nameOf(row.done_by) },
                size: 150,
            },
            {
                id: 'department',
                accessorFn: departmentText,
                enableSorting: false,
                header: ({ column }) => <DataTableColumnHeader column={column} title="Department" />,
                cell: ({ row }) => {
                    const text = departmentText(row.original);
                    if (!text) return <span className="text-xs text-gray-400">—</span>;
                    return row.original.from_department ? (
                        <span className="whitespace-nowrap rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700">{text}</span>
                    ) : (
                        <span className="text-xs text-gray-700">{text}</span>
                    );
                },
                meta: { exportHeaderName: 'Department', exportValue: departmentText },
                size: 160,
            },
            {
                id: 'reason',
                enableSorting: false,
                header: ({ column }) => <DataTableColumnHeader column={column} title="Reason / File" />,
                cell: ({ row }) => <ReasonCell row={row.original} onOpenAnswers={() => setAnswersRowName(row.original.name)} />,
                meta: {
                    exportHeaderName: 'Reason',
                    exportValue: (row: HistoryListRow) => {
                        if (!AUDIT_EVENTS.has(row.event)) return row.reason ?? '';
                        const summary = auditHistorySummary(row.event, row.reason);
                        return [summary?.line, summary?.remarks].filter(Boolean).join(' · ');
                    },
                },
                size: 260,
            },
        ],
        [nameOf]
    );

    const {
        table,
        data,
        totalCount,
        isLoading,
        error,
        columnFilters,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        exportAllRows,
        isExporting,
    } = useServerDataTable<HistoryListRow>({
        doctype: 'Asset History',
        apiEndpoint: HISTORY_TABLE_METHOD,
        columns,
        fetchFields: FETCH_FIELDS,
        searchableFields: SEARCH_FIELDS,
        defaultSort: 'done_on desc',
        urlSyncKey: 'asset_history',
        enableRowSelection: false,
    });

    // The header filters: the picked values go to the server as [column, "in", [...]]. Once a filter has been
    // opened its choices are the values in the rows the other filters leave, each with its count (most first);
    // before that, the full lists. A picked value the other filters have emptied stays listed, at 0, so it can
    // still be unticked.
    const facetCounts = useAssetHistoryFacets(openedFacets, columnFilters, searchTerm);
    const facetFilterOptions = useMemo(() => {
        const people = (users ?? []).map((u) => ({ label: u.full_name || u.name, value: u.name }));
        // The monthly runs and Desk act as Administrator.
        const doneByLabel = (id: string) => (id === 'Administrator' ? 'Administrator (System)' : nameOf(id));
        const withCounts = (field: HistoryFacetField, fallback: { label: string; value: string }[], labelOf: (value: string) => string) => {
            const counted = facetCounts.counts[field];
            if (!counted) return fallback;
            const options = counted.map((c) => ({ value: c.value, label: `${labelOf(c.value)} (${c.count})` }));
            const listed = new Set(counted.map((c) => c.value.toLowerCase()));
            const picked = (columnFilters.find((f) => f.id === field)?.value as string[] | undefined) ?? [];
            for (const value of picked) {
                if (!listed.has(String(value).toLowerCase())) options.push({ value, label: `${labelOf(value)} (0)` });
            }
            return options;
        };
        return {
            event: { title: 'Event', options: withCounts('event', EVENT_OPTIONS, (v) => v), isLoading: facetCounts.loading.event },
            assigned_to: { title: 'Person', options: withCounts('assigned_to', people, nameOf), isLoading: facetCounts.loading.assigned_to },
            done_by: {
                title: 'Done by',
                options: withCounts('done_by', [{ label: doneByLabel('Administrator'), value: 'Administrator' }, ...people], doneByLabel),
                isLoading: facetCounts.loading.done_by,
            },
            department: {
                title: 'Department',
                options: withCounts('department', departments.map((d) => ({ label: d, value: d })), (v) => v),
                isLoading: facetCounts.loading.department,
            },
        };
    }, [users, departments, nameOf, facetCounts, columnFilters]);

    const answersRow = (data ?? []).find((row) => row.name === answersRowName) ?? null;
    const answersSummary = answersRow ? auditHistorySummary(answersRow.event, answersRow.reason) : null;

    return (
        <>
            <DataTable<HistoryListRow>
                table={table}
                columns={columns}
                isLoading={isLoading}
                error={error as Error}
                totalCount={totalCount}
                searchFieldOptions={SEARCH_FIELDS}
                selectedSearchField={selectedSearchField}
                onSelectedSearchFieldChange={setSelectedSearchField}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                facetFilterOptions={facetFilterOptions}
                onFacetOpen={openFacet}
                dateFilterColumns={['done_on']}
                showExportButton={true}
                onExport="default"
                onExportAll={exportAllRows}
                isExporting={isExporting}
                exportFileName="Asset_History"
            />

            {/* The answers of one sent audit, from its "N answers" link (owner, 2026-10-15). */}
            {answersRow && (
                <AuditAnswersDialog
                    open
                    onOpenChange={(open) => !open && setAnswersRowName(null)}
                    answers={parseAuditAnswers(answersRow.audit_answers)}
                    title={`${answersRow.asset_name || answersRow.asset}${answersSummary?.line ? ` · ${answersSummary.line.charAt(0).toLowerCase()}${answersSummary.line.slice(1)}` : ''}`}
                    subtitle={`Sent by ${nameOf(answersRow.done_by)} on ${formatHistoryTime(answersRow.done_on) ?? '—'}`}
                    photoUrl={answersRow.declaration}
                    remarks={answersSummary?.remarks}
                />
            )}
        </>
    );
};

/** The Reason / File cell: an audit row in a few words, any other row's reason as typed, and its file links. */
const ReasonCell: React.FC<{ row: HistoryListRow; onOpenAnswers: () => void }> = ({ row, onOpenAnswers }) => {
    const isDeclaration = row.event.startsWith('Declaration');
    return (
        <div className="space-y-0.5">
            {AUDIT_EVENTS.has(row.event) ? (
                <AuditSummaryCell summary={auditHistorySummary(row.event, row.reason)} />
            ) : (
                row.reason && <p className="text-sm italic text-gray-700">“{row.reason}”</p>
            )}
            {isDeclaration && row.declaration && (
                <a href={row.declaration} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
                    View declaration <ExternalLink className="h-3 w-3" />
                </a>
            )}
            {row.event === 'Audit Fulfilled' && <AuditRowLinks row={row} onOpenAnswers={onOpenAnswers} />}
            {isDeclaration && !row.declaration && <span className="text-xs italic text-gray-400">File no longer available</span>}
            {!row.reason && !isDeclaration && <span className="text-xs text-gray-400">—</span>}
        </div>
    );
};

/** An audit row on the History tab: "For November 2026", and the holder's remarks under it when there are any. */
const AuditSummaryCell: React.FC<{ summary: ReturnType<typeof auditHistorySummary> }> = ({ summary }) => {
    if (!summary) return null;
    return (
        <div className="space-y-0.5">
            {summary.line && <p className="text-xs text-gray-600">{summary.line}</p>}
            {summary.remarks && <p className="text-sm italic text-gray-700">“{summary.remarks}”</p>}
        </div>
    );
};

/** A sent audit's links on the History tab: its photo, and "4 answers · 1 issue", which opens the answers. */
const AuditRowLinks: React.FC<{ row: HistoryListRow; onOpenAnswers: () => void }> = ({ row, onOpenAnswers }) => {
    const answers = parseAuditAnswers(row.audit_answers);
    const label = auditChecksLabel(answers);
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {row.declaration && (
                <a href={row.declaration} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
                    View photo <ExternalLink className="h-3 w-3" />
                </a>
            )}
            {label && (
                <button
                    type="button"
                    onClick={onOpenAnswers}
                    className={`text-xs font-medium hover:underline ${countAuditIssues(answers) ? 'text-red-700' : 'text-teal-700'}`}
                >
                    {answers.length} answers · {label === 'All OK' ? 'all OK' : label}
                </button>
            )}
        </div>
    );
};
