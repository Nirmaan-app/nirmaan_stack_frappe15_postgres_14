import { describe, expect, it } from "vitest";
import { buildWorkPackageEntry, combineBoqScope, seedWorkPackagesFromBoq } from "./boqPackageSeed";

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
