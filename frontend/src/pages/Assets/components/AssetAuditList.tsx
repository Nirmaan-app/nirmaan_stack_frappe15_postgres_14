import React, { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { useFrappeGetDocList } from 'frappe-react-sdk';
import { AlertTriangle, Briefcase, CheckCircle2, ClipboardCheck, Hash, User } from 'lucide-react';

import { DataTable, SearchFieldOption } from '@/components/data-table/new-data-table';
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useServerDataTable } from '@/hooks/useServerDataTable';
import { cn } from '@/lib/utils';
import { auditBadge } from '@/utils/assetAudit';
import { formatDate } from '@/utils/FormatDate';

import { ASSET_MANAGEMENT_AUDIT_FIELDS, ASSET_MANAGEMENT_DOCTYPE, AssetCategoryType } from '../assets.constants';
import { useAssetMasterNamesByType } from '../hooks/useAssetMasterNamesByType';
import { useAssetProjectOptions } from '../hooks/useAssetProjectOptions';
import { useAuditPendingCounts } from '../hooks/useAuditPending';
import { assignmentDepartmentColumn } from '../utils/departmentColumn';
import { AuditFulfilledList } from './AuditFulfilledList';

/** An assignment with its monthly audit open (Asset Management, `audit_status` Pending). */
interface PendingAuditRow {
    name: string;
    asset: string;
    asset_assigned_to: string;
    audit_month: string | null;
    last_audit_on: string | null;
    received_on: string | null;
    audit_status: string | null;
    audit_overdue_since: string | null;
}

interface AssetMaster {
    name: string;
    asset_name: string;
    asset_category: string;
    department: string | null;
    project: string | null;
}

type AuditView = 'pending' | 'fulfilled';

const PENDING_SEARCHABLE_FIELDS: SearchFieldOption[] = [
    { value: 'asset', label: 'Asset ID', placeholder: 'Search by asset ID...', default: true },
    { value: 'asset_assigned_to', label: 'Holder', placeholder: 'Search by person...' },
];

interface AssetAuditListProps {
    assetType: AssetCategoryType;
}

/**
 * The Asset Audit tab (owner, 2026-10-14). Pending: the open audits, read off Asset Management, oldest
 * first -- the same table as Return Request. Fulfilled: the audits sent in a chosen month, read from the
 * asset history. Audits open on their own (the 28th and the 7th, handover, a category switched on): no start
 * button. Each view has its history event's colour: Pending amber, Fulfilled teal.
 */
export const AssetAuditList: React.FC<AssetAuditListProps> = ({ assetType }) => {
    const [view, setView] = useState<AuditView>('pending');
    const pendingCount = useAuditPendingCounts()[assetType];

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                    <ViewChip tone="pending" active={view === 'pending'} onClick={() => setView('pending')} icon={<AlertTriangle className="h-3.5 w-3.5" />}>
                        Pending
                        {pendingCount > 0 && (
                            <span className="rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 text-white tabular-nums">
                                {pendingCount}
                            </span>
                        )}
                    </ViewChip>
                    <ViewChip tone="fulfilled" active={view === 'fulfilled'} onClick={() => setView('fulfilled')} icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
                        Fulfilled
                    </ViewChip>
                </div>
            </div>
            {view === 'pending' ? <PendingAudits assetType={assetType} /> : <AuditFulfilledList assetType={assetType} />}
        </div>
    );
};

/** Same colours as the history's audit events: Requested amber, Fulfilled teal. */
const CHIP_TONE = {
    pending: { active: 'border-amber-400 bg-amber-50 text-amber-800', icon: 'text-amber-600' },
    fulfilled: { active: 'border-teal-400 bg-teal-50 text-teal-800', icon: 'text-teal-600' },
} as const;

const ViewChip: React.FC<{
    tone: keyof typeof CHIP_TONE;
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    children: React.ReactNode;
}> = ({ tone, active, onClick, icon, children }) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
            active ? cn(CHIP_TONE[tone].active, 'shadow-sm') : 'border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200'
        )}
    >
        <span className={CHIP_TONE[tone].icon}>{icon}</span>
        {children}
    </button>
);

const PendingAudits: React.FC<{ assetType: AssetCategoryType }> = ({ assetType }) => {
    // Wait for the tab's asset list, so the first fetch is never scoped to nothing.
    const { masterNames, isLoading } = useAssetMasterNamesByType(assetType);
    if (isLoading) return <Skeleton className="h-96 w-full bg-gray-100" />;
    return <PendingAuditsTable assetType={assetType} masterNames={masterNames} />;
};

const PendingAuditsTable: React.FC<{ assetType: AssetCategoryType; masterNames: string[] }> = ({ assetType, masterNames }) => {
    const isProjectTab = assetType === 'Project';
    const scope = masterNames.length ? masterNames : ['__none__'];

    const { data: assetsList } = useFrappeGetDocList<AssetMaster>(
        'Asset Master',
        { fields: ['name', 'asset_name', 'asset_category', 'department', 'project'], filters: [['name', 'in', scope]], limit: 0 },
        `audit_pending_assets_${assetType}`
    );
    const assetsMap = useMemo(() => {
        const map: Record<string, AssetMaster> = {};
        assetsList?.forEach((asset) => {
            map[asset.name] = asset;
        });
        return map;
    }, [assetsList]);

    const { data: usersList } = useFrappeGetDocList<{ name: string; full_name: string }>(
        'Nirmaan Users',
        { fields: ['name', 'full_name'], limit: 0 },
        'users_for_pending_list'
    );
    const usersMap = useMemo(() => {
        const map: Record<string, string> = {};
        usersList?.forEach((user) => {
            map[user.name] = user.full_name;
        });
        return map;
    }, [usersList]);

    const { projectsById } = useAssetProjectOptions(isProjectTab);

    const additionalFilters = useMemo(
        () => [
            ['audit_status', '=', 'Pending'],
            ['asset', 'in', scope],
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [masterNames]
    );

    const columns = useMemo<ColumnDef<PendingAuditRow>[]>(() => [
        {
            id: 'asset_id_display',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Asset ID" />,
            cell: ({ row }) => (
                <Link
                    to={`/asset-management/${row.original.asset}`}
                    className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline font-medium"
                >
                    <Hash className="h-3 w-3" />
                    <span className="tabular-nums">{row.original.asset.slice(-6)}</span>
                </Link>
            ),
            size: 90,
        },
        {
            accessorKey: 'asset',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Asset Name" />,
            meta: { exportValue: (row: PendingAuditRow) => assetsMap[row.asset]?.asset_name || row.asset },
            cell: ({ row }) => (
                <Link to={`/asset-management/${row.original.asset}`} className="font-medium text-gray-900 hover:text-blue-600 transition-colors">
                    {assetsMap[row.original.asset]?.asset_name || row.original.asset}
                </Link>
            ),
            size: 170,
        },
        {
            id: 'asset_category',
            enableSorting: false,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
            meta: { exportHeaderName: 'Category', exportValue: (row: PendingAuditRow) => assetsMap[row.asset]?.asset_category || '' },
            cell: ({ row }) => {
                const category = assetsMap[row.original.asset]?.asset_category;
                return category ? <Badge variant="outline" className="font-normal">{category}</Badge> : <span className="text-gray-400">—</span>;
            },
            size: 130,
        },
        {
            accessorKey: 'asset_assigned_to',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Holder" />,
            meta: { exportValue: (row: PendingAuditRow) => usersMap[row.asset_assigned_to] || row.asset_assigned_to },
            cell: ({ row }) => (
                <Link to={`/users/${row.original.asset_assigned_to}?tab=assets`} className="inline-flex items-center gap-1.5 text-gray-700 text-sm hover:underline">
                    <User className="h-3.5 w-3.5 text-amber-500" />
                    {usersMap[row.original.asset_assigned_to] || row.original.asset_assigned_to}
                </Link>
            ),
            size: 160,
        },
        assignmentDepartmentColumn<PendingAuditRow>((assetId) => assetsMap[assetId]?.department),
        ...(isProjectTab
            ? ([
                  {
                      id: 'project',
                      enableSorting: false,
                      header: ({ column }) => <DataTableColumnHeader column={column} title="Project" />,
                      meta: {
                          exportHeaderName: 'Project',
                          exportValue: (row: PendingAuditRow) => {
                              const id = assetsMap[row.asset]?.project;
                              return id ? projectsById[id]?.project_name || id : '';
                          },
                      },
                      cell: ({ row }) => {
                          const id = assetsMap[row.original.asset]?.project;
                          if (!id) return <span className="text-gray-400">—</span>;
                          return (
                              <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                                  <Briefcase className="h-3.5 w-3.5 text-gray-400" />
                                  {projectsById[id]?.project_name || id}
                              </span>
                          );
                      },
                      size: 160,
                  },
              ] as ColumnDef<PendingAuditRow>[])
            : []),
        {
            accessorKey: 'audit_month',
            // The month it is for; red with "overdue since" once a month was recorded Missed on the 7th and
            // nothing has been sent since -- same rule as the profile card (owner, 2026-10-14).
            enableSorting: false,
            header: ({ column }) => <DataTableColumnHeader column={column} title="Audit Month" />,
            meta: {
                exportHeaderName: 'Audit Month',
                exportValue: (row: PendingAuditRow) =>
                    [row.audit_month, row.audit_overdue_since && `overdue since ${row.audit_overdue_since}`].filter(Boolean).join(' · '),
            },
            cell: ({ row }) => {
                const badge = auditBadge(row.original, true, null);
                return (
                    <span
                        title={badge.hint}
                        className={cn('inline-flex items-center gap-1.5 text-sm font-medium tabular-nums', badge.tone === 'overdue' ? 'text-red-700' : 'text-amber-700')}
                    >
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        {row.original.audit_month || '—'}
                        {badge.tone === 'overdue' && <span className="font-normal">· overdue since {row.original.audit_overdue_since}</span>}
                    </span>
                );
            },
            size: 200,
        },
        {
            accessorKey: 'last_audit_on',
            header: ({ column }) => <DataTableColumnHeader column={column} title="Last Audit" />,
            cell: ({ row }) => (
                <span className="text-sm text-gray-500 tabular-nums">
                    {row.original.last_audit_on ? formatDate(row.original.last_audit_on) : 'Never'}
                </span>
            ),
            size: 110,
        },
    ], [assetsMap, usersMap, projectsById, isProjectTab]);

    const {
        table,
        totalCount,
        isLoading,
        error,
        searchTerm,
        setSearchTerm,
        selectedSearchField,
        setSelectedSearchField,
        exportAllRows,
        isExporting,
    } = useServerDataTable<PendingAuditRow>({
        doctype: ASSET_MANAGEMENT_DOCTYPE,
        columns,
        fetchFields: ASSET_MANAGEMENT_AUDIT_FIELDS as unknown as string[],
        searchableFields: PENDING_SEARCHABLE_FIELDS,
        // Longest without an audit first (Postgres puts the never-audited after them).
        defaultSort: 'last_audit_on asc',
        urlSyncKey: `asset_audit_pending_${assetType.toLowerCase()}`,
        enableRowSelection: false,
        additionalFilters,
    });

    return (
        <DataTable<PendingAuditRow>
            table={table}
            columns={columns}
            isLoading={isLoading}
            error={error as Error}
            totalCount={totalCount}
            searchFieldOptions={PENDING_SEARCHABLE_FIELDS}
            selectedSearchField={selectedSearchField}
            onSelectedSearchFieldChange={setSelectedSearchField}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            showExportButton={true}
            onExport="default"
            onExportAll={exportAllRows}
            isExporting={isExporting}
        />
    );
};
