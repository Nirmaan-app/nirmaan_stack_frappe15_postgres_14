import { ColumnDef } from '@tanstack/react-table';

import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { NOT_SET_FACET_VALUE } from '@/components/data-table/facetConfig';
import { Badge } from '@/components/ui/badge';
import { NO_DEPARTMENT_LABEL } from '@/constants/departments';
import { normalizeDepartment } from '@/utils/assetDepartment';

import { AssetLookupFacetFilter } from '../components/AssetLookupFacetFilter';

/** An asset's department, or a quiet "No department". */
export function DepartmentBadge({ department }: { department?: string | null }) {
    if (!department) return <span className="text-xs text-gray-400">{NO_DEPARTMENT_LABEL}</span>;
    return (
        <Badge variant="outline" className="font-normal border-indigo-200 bg-indigo-50 text-indigo-700">
            {department}
        </Badge>
    );
}

/** Department column for tables whose rows are Asset Master records (filterable on `department`). */
export function assetDepartmentColumn<T extends { department?: string | null }>(): ColumnDef<T> {
    return {
        accessorKey: 'department',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Department" />,
        cell: ({ row }) => <DepartmentBadge department={row.original.department} />,
        size: 140,
        meta: {
            exportHeaderName: 'Department',
            exportValue: (row: T) => row.department || '',
        },
    };
}

/**
 * Department column for tables whose rows are assignments; the department comes from the asset.
 *
 * The table's own filters only reach the assignment's fields, so a Department filter is a lookup
 * funnel (as Project / City / State are): pass `filter` and the page narrows its `asset` scope with
 * the picked values (`matchesDepartmentFilter`).
 */
export function assignmentDepartmentColumn<T extends { asset: string }>(
    departmentOf: (assetId: string) => string | null | undefined,
    filter?: { options: { label: string; value: string }[]; onChange: (next: string[]) => void }
): ColumnDef<T> {
    return {
        id: 'asset_department',
        enableSorting: !filter,
        header: ({ column }) =>
            filter ? (
                <div className="flex items-center gap-1">
                    <AssetLookupFacetFilter title="Department" options={filter.options} onChange={filter.onChange} />
                    <DataTableColumnHeader column={column} title="Department" />
                </div>
            ) : (
                <DataTableColumnHeader column={column} title="Department" />
            ),
        cell: ({ row }) => <DepartmentBadge department={departmentOf(row.original.asset)} />,
        size: 140,
        meta: {
            exportHeaderName: 'Department',
            exportValue: (row: T) => departmentOf(row.asset) || '',
        },
    };
}

/**
 * Filter options with counts ("Projects (12)"), plus "No department (n)" when some rows have none.
 * The blank option uses the data table's not-set sentinel, which the server turns into `is not set`.
 */
export function departmentFacetOptions(departments: (string | null | undefined)[]) {
    const counts = new Map<string, number>();
    let blank = 0;
    departments.forEach((value) => {
        const department = normalizeDepartment(value);
        if (department) counts.set(department, (counts.get(department) ?? 0) + 1);
        else blank += 1;
    });
    const options = [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([department, count]) => ({ label: `${department} (${count})`, value: department }));
    if (blank > 0) options.push({ label: `${NO_DEPARTMENT_LABEL} (${blank})`, value: NOT_SET_FACET_VALUE });
    return options;
}

/** True when an asset's department is one of the picked filter values ("No department" included). */
export function matchesDepartmentFilter(department: string | null | undefined, picked: string[]): boolean {
    const value = normalizeDepartment(department);
    return value ? picked.includes(value) : picked.includes(NOT_SET_FACET_VALUE);
}
