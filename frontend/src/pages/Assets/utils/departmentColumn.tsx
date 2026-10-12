import { ColumnDef } from '@tanstack/react-table';

import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header';
import { NOT_SET_FACET_VALUE } from '@/components/data-table/facetConfig';
import { Badge } from '@/components/ui/badge';
import { NO_DEPARTMENT_LABEL } from '@/constants/departments';
import { normalizeDepartment } from '@/utils/assetDepartment';

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

/** Department column for tables whose rows are assignments; the department comes from the asset. */
export function assignmentDepartmentColumn<T extends { asset: string }>(
    departmentOf: (assetId: string) => string | null | undefined
): ColumnDef<T> {
    return {
        id: 'asset_department',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Department" />,
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
