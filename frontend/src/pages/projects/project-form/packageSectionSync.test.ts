import { describe, expect, it } from "vitest";
import {
    DESIGN_CATEGORY_PACKAGES,
    designCategoryPackages,
    OptionalSections,
    PackageSectionMasters,
    readOptionalSections,
    sectionSetupProblems,
    syncSectionsWithPackages,
    turnSectionOff,
    turnSectionOn,
} from "./packageSectionSync";

const masters: PackageSectionMasters = {
    workHeaders: [
        { name: "Electrical", work_header_name: "Electrical", work_package_link: "Electrical Work" },
        { name: "HVAC Ducting", work_header_name: "HVAC Ducting", work_package_link: "HVAC System" },
        { name: "HVAC VRF/DX", work_header_name: "HVAC VRF/DX", work_package_link: "HVAC System" },
        { name: "ELV System", work_header_name: "ELV System", work_package_link: null },
    ],
    designCategories: [
        { category_name: "Electrical", work_package: "Electrical Work" },
        { category_name: "HVAC", work_package: "HVAC System" },
        { category_name: "Overall Project", work_package: null },
    ],
    criticalPOCategories: [
        { name: "Electrical", work_package: "Electrical Work" },
        { name: "HVAC Machines", work_package: "HVAC System" },
        { name: "HVAC Piping", work_package: "HVAC System" },
    ],
};

const empty = (): OptionalSections => readOptionalSections({});
// `tickedAfter` = every package ticked once the change is applied.
const tick = (sections: OptionalSections, pkgs: string[], tickedAfter: string[] = pkgs) =>
    syncSectionsWithPackages(sections, masters, { added: pkgs, removed: [], ticked: tickedAfter });
const untick = (sections: OptionalSections, pkgs: string[], tickedAfter: string[] = []) =>
    syncSectionsWithPackages(sections, masters, { added: [], removed: pkgs, ticked: tickedAfter });
const headerNames = (s: OptionalSections) => s.daily_progress_setup.work_headers.map((h) => h.work_header_doc_name);

describe("ticking a package", () => {
    it("switches each section on and selects what belongs to the package", () => {
        const s = tick(empty(), ["HVAC System"]);
        expect(s.daily_progress_setup.enabled).toBe(true);
        expect(s.daily_progress_setup.zone_type).toBe("single");
        expect(headerNames(s)).toEqual(["HVAC Ducting", "HVAC VRF/DX"]);
        expect(s.design_packages_setup).toMatchObject({
            enabled: true,
            zone_source: "custom",
            zone_type: "single",
            selected_categories: ["HVAC"],
        });
        expect(s.critical_po_setup).toMatchObject({
            enabled: true,
            selected_categories: ["HVAC Machines", "HVAC Piping"],
        });
    });

    it("adds to what is already selected without duplicates", () => {
        const s = tick(tick(empty(), ["Electrical Work"]), ["HVAC System", "Electrical Work"]);
        expect(headerNames(s)).toEqual(["Electrical", "HVAC Ducting", "HVAC VRF/DX"]);
        expect(s.critical_po_setup.selected_categories).toEqual(["Electrical", "HVAC Machines", "HVAC Piping"]);
    });

    it("leaves a section off when the package has nothing for it", () => {
        const noDesign = { ...masters, designCategories: [] };
        const s = syncSectionsWithPackages(empty(), noDesign, { added: ["HVAC System"], removed: [], ticked: ["HVAC System"] });
        expect(s.design_packages_setup.enabled).toBe(false);
    });

    it("keeps a zone setup the user already chose", () => {
        const start = empty();
        start.daily_progress_setup = { ...start.daily_progress_setup, enabled: true, zone_type: "multiple", zones: [{ zone_name: "Tower A" }] };
        const s = tick(start, ["HVAC System"]);
        expect(s.daily_progress_setup.zone_type).toBe("multiple");
        expect(s.daily_progress_setup.zones).toEqual([{ zone_name: "Tower A" }]);
    });

    it("stores an empty package link, never null, for a package-less header", () => {
        const s = syncSectionsWithPackages(empty(), masters, { added: [], removed: [], ticked: [], addHeaders: ["ELV System"] });
        expect(s.daily_progress_setup.work_headers).toEqual([
            { work_header_doc_name: "ELV System", work_header_display_name: "ELV System", work_package_link: "" },
        ]);
    });
});

describe("unticking a package", () => {
    it("removes only what belongs to that package", () => {
        const s = untick(tick(empty(), ["Electrical Work", "HVAC System"]), ["HVAC System"], ["Electrical Work"]);
        expect(headerNames(s)).toEqual(["Electrical"]);
        expect(s.design_packages_setup.selected_categories).toEqual(["Electrical"]);
        expect(s.critical_po_setup.selected_categories).toEqual(["Electrical"]);
    });

    it("switches a section off when its last item goes", () => {
        const s = untick(tick(empty(), ["HVAC System"]), ["HVAC System"]);
        expect(s.daily_progress_setup).toMatchObject({ enabled: false, zone_type: undefined, work_headers: [] });
        expect(s.design_packages_setup.enabled).toBe(false);
        expect(s.critical_po_setup.enabled).toBe(false);
    });

    it("keeps a hand-picked item that belongs to no ticked package", () => {
        const start = tick(empty(), ["HVAC System"]);
        start.critical_po_setup = { ...start.critical_po_setup, selected_categories: [...start.critical_po_setup.selected_categories, "Electrical"] };
        const s = untick(start, ["HVAC System"]);
        expect(s.critical_po_setup).toMatchObject({ enabled: true, selected_categories: ["Electrical"] });
    });

    it("does not bring back an item the user unticked by hand", () => {
        const start = tick(empty(), ["HVAC System"]);
        start.daily_progress_setup = {
            ...start.daily_progress_setup,
            work_headers: start.daily_progress_setup.work_headers.filter((h) => h.work_header_doc_name !== "HVAC VRF/DX"),
        };
        expect(headerNames(tick(start, ["Electrical Work"], ["HVAC System", "Electrical Work"]))).toEqual([
            "HVAC Ducting",
            "Electrical",
        ]);
    });
});

describe("Design categories without a package link", () => {
    // The live data: no design category has work_package set.
    const unlinked: PackageSectionMasters = {
        ...masters,
        designCategories: ["BMS", "Data Networking", "Electrical", "ELV", "Fire Sprinkler", "HVAC", "Overall Project"].map(
            (category_name) => ({ category_name, work_package: null })
        ),
    };
    const change = (sections: OptionalSections, added: string[], removed: string[], ticked: string[]) =>
        syncSectionsWithPackages(sections, unlinked, { added, removed, ticked });

    it("are ticked from the wizard's own mapping", () => {
        const s = change(empty(), ["Electrical Work", "Fire Fighting System"], [], ["Electrical Work", "Fire Fighting System"]);
        expect(s.design_packages_setup.selected_categories).toEqual(["Electrical", "Fire Sprinkler"]);
        expect(s.design_packages_setup.enabled).toBe(true);
    });

    it("ELV follows any of its five packages and stays while one is still ticked", () => {
        const both = change(empty(), ["FA System", "CCTV System"], [], ["FA System", "CCTV System"]);
        expect(both.design_packages_setup.selected_categories).toEqual(["ELV"]);
        const oneLeft = change(both, [], ["CCTV System"], ["FA System"]);
        expect(oneLeft.design_packages_setup.selected_categories).toEqual(["ELV"]);
        const none = change(oneLeft, [], ["FA System"], []);
        expect(none.design_packages_setup.enabled).toBe(false);
    });

    it("never ticks Overall Project, which belongs to no package", () => {
        const all = Object.values(DESIGN_CATEGORY_PACKAGES).flat();
        expect(change(empty(), all, [], all).design_packages_setup.selected_categories).not.toContain("Overall Project");
    });

    it("adds a package set on the category in Desk to the mapping", () => {
        expect(designCategoryPackages({ category_name: "Overall Project", work_package: "Civil & Interior" })).toEqual([
            "Civil & Interior",
        ]);
        expect(designCategoryPackages({ category_name: "HVAC", work_package: "HVAC System" })).toEqual(["HVAC System"]);
    });
});

describe("switching a section by hand", () => {
    it("off: clears it and later package ticks leave it off", () => {
        const off = turnSectionOff(tick(empty(), ["HVAC System"]), "critical_po_setup");
        expect(off.critical_po_setup).toEqual({ enabled: false, selected_categories: [], opted_out: true });
        const s = tick(off, ["Electrical Work"], ["HVAC System", "Electrical Work"]);
        expect(s.critical_po_setup.enabled).toBe(false);
        expect(s.daily_progress_setup.enabled).toBe(true);
    });

    it("on: fills it from the packages already ticked", () => {
        const off = turnSectionOff(tick(empty(), ["HVAC System"]), "daily_progress_setup");
        const on = turnSectionOn(off, "daily_progress_setup", ["HVAC System"], masters);
        expect(on.daily_progress_setup).toMatchObject({ enabled: true, zone_type: "single", opted_out: false });
        expect(headerNames(on)).toEqual(["HVAC Ducting", "HVAC VRF/DX"]);
    });

    it("on with nothing ticked: on and empty, ready for hand picks", () => {
        const on = turnSectionOn(empty(), "design_packages_setup", [], masters);
        expect(on.design_packages_setup).toMatchObject({ enabled: true, zone_source: "custom", zone_type: "single", selected_categories: [] });
    });
});

describe("sectionSetupProblems", () => {
    it("passes when every switched-on section is complete", () => {
        expect(sectionSetupProblems(tick(empty(), ["HVAC System"]))).toEqual([]);
        expect(sectionSetupProblems(empty())).toEqual([]);
    });

    it("blocks a switched-on section that would save nothing", () => {
        const s = empty();
        s.daily_progress_setup = { ...s.daily_progress_setup, enabled: true, zone_type: "multiple" };
        s.design_packages_setup = { ...s.design_packages_setup, enabled: true };
        s.critical_po_setup = { ...s.critical_po_setup, enabled: true };
        expect(sectionSetupProblems(s)).toEqual([
            "Daily Progress: add at least one zone.",
            "Daily Progress: select at least one work header.",
            "Design: choose the zones.",
            "Design: select at least one category.",
            "Critical PO: select at least one category.",
        ]);
    });
});
