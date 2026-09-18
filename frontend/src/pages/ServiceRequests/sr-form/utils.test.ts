import { describe, expect, it } from "vitest";
import { ServiceItemType } from "./schema";
import { groupItemsByPackage, isCustomServiceItem, orderPackageOptions } from "./utils";

const line = (id: string, category: string, standard_rate?: number): ServiceItemType => ({
    id,
    category,
    description: id,
    uom: "Nos",
    quantity: 1,
    rate: 10,
    standard_rate,
});

describe("isCustomServiceItem", () => {
    it("reads a line without a standard rate as custom", () => {
        expect(isCustomServiceItem({ standard_rate: undefined })).toBe(true);
        expect(isCustomServiceItem({ standard_rate: null as unknown as undefined })).toBe(true);
    });

    it("reads a rate-card line as approved, even at a standard rate of 0", () => {
        expect(isCustomServiceItem({ standard_rate: 45 })).toBe(false);
        expect(isCustomServiceItem({ standard_rate: 0 })).toBe(false);
    });
});

describe("orderPackageOptions", () => {
    it("lists every package in one alphabetical list, flagging which have rate-card services", () => {
        const options = orderPackageOptions(
            [
                { value: "plb", label: "Plumbing" },
                { value: "ele", label: "Electrical Works" },
            ],
            [
                { value: "pnt", label: "Painting" },
                { value: "civ", label: "Civil Works" },
            ],
        );
        expect(options.map((o) => [o.label, o.hasItems])).toEqual([
            ["Civil Works", false],
            ["Electrical Works", true],
            ["Painting", false],
            ["Plumbing", true],
        ]);
    });

    it("does not reorder the arrays it was given", () => {
        const withItems = [
            { value: "b", label: "B" },
            { value: "a", label: "A" },
        ];
        orderPackageOptions(withItems, []);
        expect(withItems.map((c) => c.label)).toEqual(["B", "A"]);
    });
});

describe("groupItemsByPackage", () => {
    const items = [
        line("conduit", "Electrical", 45),
        line("custom-1", "Electrical"),
        line("valve", "Plumbing", 600),
        line("custom-2", "Civil"),
        line("earthing", "Electrical", 3200),
    ];

    it("keeps approved and custom lines together, grouped by package in order of first appearance", () => {
        const groups = groupItemsByPackage(items);
        expect(groups.map(([pkg, rows]) => [pkg, rows.map((r) => r.item.id)])).toEqual([
            ["Electrical", ["conduit", "custom-1", "earthing"]],
            ["Plumbing", ["valve"]],
            ["Civil", ["custom-2"]],
        ]);
    });

    it("carries each line's index in the full list, so edits land on the right row", () => {
        const rows = groupItemsByPackage(items).flatMap(([, r]) => r);
        expect(rows.map((r) => [r.item.id, r.index])).toEqual([
            ["conduit", 0],
            ["custom-1", 1],
            ["earthing", 4],
            ["valve", 2],
            ["custom-2", 3],
        ]);
    });

    it("returns nothing for an empty list", () => {
        expect(groupItemsByPackage([])).toEqual([]);
    });
});
