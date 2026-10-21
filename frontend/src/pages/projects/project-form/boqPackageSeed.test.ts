import { describe, expect, it } from "vitest";
import {
    applyBoqPickChange,
    buildWorkPackageEntry,
    combineBoqScope,
    seedWorkPackagesFromBoq,
    tickedBoqScopes,
    wizardBoqCounts,
    type MergeSource,
} from "./boqPackageSeed";

const categories = [
    { category_name: "Cables", work_package: "Electrical Work" },
    { category_name: "Switchgear", work_package: "Electrical Work" },
    { category_name: "Ducting", work_package: "HVAC System" },
    { category_name: "Orphan", work_package: null },
];

const offered = [
    { work_package_name: "HVAC System" },
    { work_package_name: "Electrical Work" },
    { work_package_name: "Fire Fighting System" },
];

describe("buildWorkPackageEntry", () => {
    it("takes every category of the package, with no makes", () => {
        expect(buildWorkPackageEntry("Electrical Work", categories)).toEqual({
            work_package_name: "Electrical Work",
            category_list: {
                list: [
                    { name: "Cables", makes: [] },
                    { name: "Switchgear", makes: [] },
                ],
            },
        });
    });

    it("gives an empty category list for a package with no categories", () => {
        expect(buildWorkPackageEntry("Fire Fighting System", categories).category_list.list).toEqual([]);
    });
});

describe("combineBoqScope", () => {
    it("unions packages and unmapped headers across the picked BoQs, without duplicates", () => {
        const scope = combineBoqScope([
            { packages: ["HVAC System", "Electrical Work"], unmapped_headers: ["ELV System"] },
            { packages: ["Electrical Work"], unmapped_headers: ["BMS", "ELV System"] },
        ]);
        expect(scope).toEqual({
            packages: ["Electrical Work", "HVAC System"],
            unmappedHeaders: ["BMS", "ELV System"],
        });
    });

    it("is empty when nothing is picked", () => {
        expect(combineBoqScope([])).toEqual({ packages: [], unmappedHeaders: [] });
    });
});

describe("seedWorkPackagesFromBoq", () => {
    it("ticks the BoQ's packages in the wizard's display order", () => {
        const seeded = seedWorkPackagesFromBoq(["Electrical Work", "HVAC System"], offered, categories);
        expect(seeded.map((p) => p.work_package_name)).toEqual(["HVAC System", "Electrical Work"]);
    });

    it("drops a BoQ package the wizard does not offer", () => {
        const seeded = seedWorkPackagesFromBoq(["Electrical Work", "Tool & Equipments"], offered, categories);
        expect(seeded.map((p) => p.work_package_name)).toEqual(["Electrical Work"]);
    });

    it("builds each entry exactly as a manual tick would", () => {
        const [seeded] = seedWorkPackagesFromBoq(["Electrical Work"], offered, categories);
        expect(seeded).toEqual(buildWorkPackageEntry("Electrical Work", categories));
    });

    it("ticks nothing for a BoQ with no packages", () => {
        expect(seedWorkPackagesFromBoq([], offered, categories)).toEqual([]);
    });
});

describe("applyBoqPickChange", () => {
    const entry = (name: string) => buildWorkPackageEntry(name, categories);
    const names = (result: { workPackages: { work_package_name: string }[] }) =>
        result.workPackages.map((p) => p.work_package_name);

    it("first pick: ticks every package of the picked BoQs", () => {
        const result = applyBoqPickChange([], [], ["Electrical Work", "HVAC System"], offered, categories);
        expect(names(result)).toEqual(["HVAC System", "Electrical Work"]);
        expect(result.added).toEqual(["HVAC System", "Electrical Work"]);
        expect(result.removed).toEqual([]);
    });

    it("keeps a package ticked by hand when another BoQ is added (the Fire Fighting case)", () => {
        const current = [entry("Electrical Work"), entry("Fire Fighting System")];
        const result = applyBoqPickChange(
            current,
            ["Electrical Work"],
            ["Electrical Work", "HVAC System"],
            offered,
            categories
        );
        expect(names(result)).toEqual(["HVAC System", "Electrical Work", "Fire Fighting System"]);
        expect(result.added).toEqual(["HVAC System"]);
        expect(result.removed).toEqual([]);
    });

    it("keeps a package unticked by hand unticked when the new picks still include it", () => {
        const current = [entry("Fire Fighting System")]; // Electrical unticked by hand
        const result = applyBoqPickChange(
            current,
            ["Electrical Work"],
            ["Electrical Work", "HVAC System"],
            offered,
            categories
        );
        expect(names(result)).toEqual(["HVAC System", "Fire Fighting System"]);
    });

    it("unticks only the packages of a BoQ that was unpicked", () => {
        const current = [entry("HVAC System"), entry("Electrical Work"), entry("Fire Fighting System")];
        const result = applyBoqPickChange(
            current,
            ["Electrical Work", "HVAC System"],
            ["Electrical Work"],
            offered,
            categories
        );
        expect(names(result)).toEqual(["Electrical Work", "Fire Fighting System"]);
        expect(result.removed).toEqual(["HVAC System"]);
        expect(result.added).toEqual([]);
    });

    it("keeps the makes on an entry it does not touch", () => {
        const withMakes = {
            work_package_name: "Electrical Work",
            category_list: { list: [{ name: "Cables", makes: [{ label: "Polycab", value: "Polycab" }] }] },
        };
        const result = applyBoqPickChange([withMakes], ["Electrical Work"], ["Electrical Work", "HVAC System"], offered, categories);
        expect(result.workPackages.find((p) => p.work_package_name === "Electrical Work")).toBe(withMakes);
    });
});

describe("BoQs from other Tendering projects (ADR-0038)", () => {
    const own = [
        { name: "OWN-1", packages: ["Electrical Work"], unmapped_headers: [] },
        { name: "OWN-2", packages: ["HVAC System"], unmapped_headers: [] },
    ];
    const source = (selected: string[]): MergeSource => ({
        project: "STUB-2",
        project_name: "E SKY",
        boqs: [
            { name: "SRC-1", boq_name: "MEP", version: 1, packages: ["Fire Fighting System"], unmapped_headers: ["ELV System"] },
            { name: "SRC-2", boq_name: "Fire", version: 1, packages: [], unmapped_headers: [] },
        ],
        selected_boqs: selected,
    });

    it("counts BoQs and ticks across the project's own and the added ones", () => {
        expect(wizardBoqCounts(2, ["OWN-1"], [source(["SRC-1"])])).toEqual({ boqs: 4, ticked: 2 });
        expect(wizardBoqCounts(0, [], [source([])])).toEqual({ boqs: 2, ticked: 0 });
        expect(wizardBoqCounts(0, [], [])).toEqual({ boqs: 0, ticked: 0 });
    });

    it("a tick on an added project alone is enough (no minimum per project)", () => {
        expect(wizardBoqCounts(2, [], [source(["SRC-2"])]).ticked).toBe(1);
    });

    it("collects every ticked BoQ, own first, for the package pre-fill", () => {
        const ticked = tickedBoqScopes(own, ["OWN-2"], [source(["SRC-1"])]);
        expect(ticked.map((b) => b.name)).toEqual(["OWN-2", "SRC-1"]);
        expect(combineBoqScope(ticked)).toEqual({
            packages: ["Fire Fighting System", "HVAC System"],
            unmappedHeaders: ["ELV System"],
        });
    });
});
