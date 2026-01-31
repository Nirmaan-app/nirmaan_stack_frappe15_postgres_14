import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { ProjectTeamHoverCard } from "@/components/common/ProjectTeamHoverCard";
import { ProjectAssignee } from "@/hooks/useProjectAssignees";

/**
 * Creates a standard Assignees column definition for TanStack Table.
 * 
 * @param idAccessor The accessor key for the Project ID/Name in the row data (e.g., "project", "name").
 * @param assignmentsLookup The lookup object returned by useProjectAssignees hook.
 * @returns A ColumnDef object.
 */
export const getAssigneesColumn = <TData extends object>(
    idAccessor: keyof TData | string,
    assignmentsLookup: Record<string, ProjectAssignee[]>,
    allowedRoles?: string[]
): ColumnDef<TData> => {
    return {
        id: "assignees",
        accessorFn: (row) => {
            // Helper to get nested value if needed, simplified here for direct access
            const projectId = (row as any)[idAccessor] as string;
            let assignees = assignmentsLookup[projectId] || [];
            
            if (allowedRoles && allowedRoles.length > 0) {
                assignees = assignees.filter(a => allowedRoles.includes(a.role));
            }

            return assignees.map(a => a.name).join(", ");
        },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Assignees" className="justify-center" />,
        cell: ({ row }) => {
            const projectId = (row.original as any)[idAccessor] as string;
            let assignees = assignmentsLookup[projectId] || [];
            
            if (allowedRoles && allowedRoles.length > 0) {
                assignees = assignees.filter(a => allowedRoles.includes(a.role));
            }

            return <ProjectTeamHoverCard assignees={assignees} />;
        },
        size: 80,
        enableSorting: false,
        meta: {
            exportValue: (row) => {
                const projectId = (row as any)[idAccessor] as string;
                let assignees = assignmentsLookup[projectId] || [];
                
                if (allowedRoles && allowedRoles.length > 0) {
                    assignees = assignees.filter(a => allowedRoles.includes(a.role));
                }
                
                return assignees.map(a => `${a.name} (${a.role})`).join("; ") || "--";
            },
            exportHeaderName: "Assignees"
        }
    };
};
