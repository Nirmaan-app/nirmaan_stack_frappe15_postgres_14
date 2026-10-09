import { describe, expect, it } from "vitest";
import { ColumnDef } from "@tanstack/react-table";
import { dcColumns, dnColumns, forScope, invoiceColumns, mirColumns, poColumns, woColumns } from "./bulkTableColumns";

const ids = (columns: ColumnDef<any, any>[]) => columns.map((c) => c.id);
const accessor = (column: ColumnDef<any, any>) => (column as { accessorFn: (row: unknown, i: number) => unknown }).accessorFn;

const ALL_SETS = { poColumns, woColumns, dnColumns, invoiceColumns, dcColumns, mirColumns };

describe("forScope", () => {
    it("hands project scope the very same column array (the project tab is unchanged)", () => {
        for (const columns of Object.values(ALL_SETS)) {
            expect(forScope(columns as ColumnDef<any, any>[], "project")).toBe(columns);
        }
    });

    it("swaps the Vendor column for a Project column in the same place, leaving every other column alone", () => {
        for (const [name, columns] of Object.entries(ALL_SETS)) {
            const scoped = forScope(columns as ColumnDef<any, any>[], "vendor");
            const expected = ids(columns as ColumnDef<any, any>[]).map((id) => (id === "vendor" ? "project" : id));
            expect(ids(scoped), name).toEqual(expected);
            scoped.forEach((column, i) => {
                if (column.id !== "project") expect(column, `${name}[${i}]`).toBe((columns as ColumnDef<any, any>[])[i]);
            });
        }
    });

    it("shows the project name and falls back to the project id", () => {
        const project = forScope(poColumns, "vendor").find((c) => c.id === "project")!;
        expect(accessor(project)({ name: "PO-1", project: "P-1", project_name: "Tower A" }, 0)).toBe("Tower A");
        expect(accessor(project)({ name: "PO-1", project: "P-1" }, 0)).toBe("P-1");
        expect(project.header).toBe("Project");
    });
});
