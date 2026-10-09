import { describe, expect, it } from "vitest";
import { ColumnDef } from "@tanstack/react-table";
import { dcColumns, dnColumns, forScope, invoiceColumns, mirColumns, mtcColumns, poColumns, voucherColumns, woColumns } from "./bulkTableColumns";

const ids = (columns: ColumnDef<any, any>[]) => columns.map((c) => c.id);
const accessor = (column: ColumnDef<any, any>) => (column as { accessorFn: (row: unknown, i: number) => unknown }).accessorFn;

const ALL_SETS = { poColumns, woColumns, dnColumns, invoiceColumns, dcColumns, mirColumns, voucherColumns, mtcColumns };

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

describe("voucherColumns", () => {
    it("labels each payment Uploaded or Missing; an emptied voucher field counts as Missing", () => {
        const voucher = voucherColumns.find((c) => c.id === "voucher")!;
        expect(accessor(voucher)({ name: "PAY-1", voucher_attachment: "/files/v.pdf" }, 0)).toBe("Uploaded");
        expect(accessor(voucher)({ name: "PAY-2", voucher_attachment: "" }, 0)).toBe("Missing");
        expect(accessor(voucher)({ name: "PAY-3" }, 0)).toBe("Missing");
    });

    it("keeps amount, date and voucher status out of the search box", () => {
        const searchable = voucherColumns.filter((c) => c.enableGlobalFilter !== false).map((c) => c.id);
        expect(searchable).toEqual(["document_name", "vendor", "utr"]);
    });
});

describe("mtcColumns", () => {
    it("names a certificate by the items it covers (never by its MTC id)", () => {
        const items = mtcColumns.find((c) => c.id === "items")!;
        const row = { name: "MTC-26-00001", procurement_order: "PO/1", items: [
            { item_id: "I1", item_name: "Copper Cable", make: "Polycab" },
            { item_id: "I2", item_name: "Cable Tray" },
        ] };
        const text = accessor(items)(row, 0) as string;
        expect(text).toBe("Copper Cable (Polycab), Cable Tray");
        expect(text).not.toContain("MTC-26");
    });
});
