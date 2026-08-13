// frontend/src/pages/ProjectDesignTracker/download/downloadSelection.test.ts
//
// Pins the four rules this module shares with the "Project Design Tracker" Jinja
// (null phase => Onboarding, blank category => Uncategorized, zones compared
// trimmed, "Not Applicable" excluded) plus the param/filename shapes.

import { describe, expect, it } from "vitest";

import {
    buildDownloadFilename,
    buildDownloadParams,
    countMatchingTasks,
    describeSelection,
    getCategoryOptions,
    getPhaseOptions,
    getZoneOptions,
    isSelectionComplete,
    pruneSelection,
    resolveSeed,
    taskCategory,
    taskPhase,
    taskZone,
} from "./downloadSelection";
import type { DownloadOption, DownloadableTask } from "./downloadTypes";

const task = (over: Partial<DownloadableTask> = {}): DownloadableTask => ({
    task_phase: "Onboarding",
    task_zone: "Zone A",
    design_category: "Civil",
    task_status: "Not Started",
    ...over,
});

/** A small tracker: 2 phases x 2 zones, one blank category, one Not Applicable. */
const TASKS: DownloadableTask[] = [
    task({ design_category: "Civil", task_zone: "Zone A" }),
    task({ design_category: "Civil", task_zone: "Zone A" }),
    task({ design_category: "Electrical", task_zone: "Zone A" }),
    task({ design_category: "", task_zone: "Zone A" }), // Uncategorized
    task({ design_category: "Civil", task_zone: "Zone B" }),
    task({ task_phase: "Handover", design_category: "Civil", task_zone: "Zone A" }),
    task({ task_phase: null, design_category: "Civil", task_zone: "Zone B" }), // => Onboarding
    task({ design_category: "Civil", task_zone: "Zone A", task_status: "Not Applicable" }),
];

const ZONE_ORDER = ["Zone A", "Zone B"];

const opts = (...values: string[]): DownloadOption[] =>
    values.map((value) => ({ value, label: value, count: 1 }));

describe("normalizers (shared with the Jinja)", () => {
    it("treats a missing task_phase as Onboarding", () => {
        expect(taskPhase(task({ task_phase: null }))).toBe("Onboarding");
        expect(taskPhase(task({ task_phase: undefined }))).toBe("Onboarding");
        expect(taskPhase(task({ task_phase: "Handover" }))).toBe("Handover");
    });

    it("trims zones so stray whitespace still matches", () => {
        expect(taskZone(task({ task_zone: "  Zone A  " }))).toBe("Zone A");
        expect(taskZone(task({ task_zone: null }))).toBe("");
    });

    it("keys a blank category on the empty string", () => {
        expect(taskCategory(task({ design_category: null }))).toBe("");
        expect(taskCategory(task({ design_category: "  Civil " }))).toBe("Civil");
    });
});

describe("getPhaseOptions", () => {
    it("hides Handover when the tracker has no handover", () => {
        expect(getPhaseOptions(TASKS, false).map((o) => o.value)).toEqual([
            "Onboarding",
        ]);
    });

    it("counts printable tasks per phase, excluding Not Applicable", () => {
        const options = getPhaseOptions(TASKS, true);
        // 8 rows total: 1 Handover, 1 Not Applicable, 6 printable Onboarding.
        expect(options).toEqual([
            { value: "Onboarding", label: "Onboarding", count: 6 },
            { value: "Handover", label: "Handover", count: 1 },
        ]);
    });
});

describe("getZoneOptions", () => {
    it("follows the tracker's zone order, not task order", () => {
        const options = getZoneOptions(TASKS, ["Onboarding"], ["Zone B", "Zone A"]);
        expect(options.map((o) => o.value)).toEqual(["Zone B", "Zone A"]);
    });

    it("drops zones with no printable task in the selected phases", () => {
        const options = getZoneOptions(TASKS, ["Handover"], ZONE_ORDER);
        expect(options).toEqual([{ value: "Zone A", label: "Zone A", count: 1 }]);
    });

    it("appends a zone that exists on tasks but not in the tracker's zone table", () => {
        const withOrphan = [...TASKS, task({ task_zone: "Zone Z" })];
        const options = getZoneOptions(withOrphan, ["Onboarding"], ZONE_ORDER);
        expect(options.map((o) => o.value)).toEqual(["Zone A", "Zone B", "Zone Z"]);
    });

    it("never offers a blank zone -- the PDF cannot print one", () => {
        const withBlank = [...TASKS, task({ task_zone: null }), task({ task_zone: "  " })];
        const options = getZoneOptions(withBlank, ["Onboarding"], ZONE_ORDER);
        expect(options.map((o) => o.value)).toEqual(["Zone A", "Zone B"]);
    });
});

describe("getCategoryOptions", () => {
    it("sorts alphabetically to match the Jinja's groupby, Uncategorized first", () => {
        const options = getCategoryOptions(TASKS, ["Onboarding"], ZONE_ORDER);
        expect(options.map((o) => o.value)).toEqual(["", "Civil", "Electrical"]);
        expect(options[0].label).toBe("Uncategorized");
    });

    it("is scoped by the selected zones", () => {
        const options = getCategoryOptions(TASKS, ["Onboarding"], ["Zone B"]);
        expect(options.map((o) => o.value)).toEqual(["Civil"]);
        expect(options[0].count).toBe(2);
    });
});

describe("countMatchingTasks", () => {
    it("matches the printable set across all axes", () => {
        expect(
            countMatchingTasks(TASKS, {
                phases: ["Onboarding"],
                zones: ["Zone A", "Zone B"],
                categories: ["", "Civil", "Electrical"],
            }),
        ).toBe(6);
    });

    it("never counts a Not Applicable task", () => {
        const onlyExcluded = [task({ task_status: "Not Applicable" })];
        expect(
            countMatchingTasks(onlyExcluded, {
                phases: ["Onboarding"],
                zones: ["Zone A"],
                categories: ["Civil"],
            }),
        ).toBe(0);
    });

    it("counts the Uncategorized bucket only when the empty string is selected", () => {
        const base = { phases: ["Onboarding"] as const, zones: ["Zone A"] };
        expect(
            countMatchingTasks(TASKS, { ...base, phases: ["Onboarding"], categories: ["Civil"] }),
        ).toBe(2);
        expect(
            countMatchingTasks(TASKS, { ...base, phases: ["Onboarding"], categories: [""] }),
        ).toBe(1);
    });

    it("returns 0 when an axis is empty", () => {
        expect(
            countMatchingTasks(TASKS, { phases: [], zones: ["Zone A"], categories: ["Civil"] }),
        ).toBe(0);
    });
});

describe("pruneSelection", () => {
    it("drops values no longer on offer after a phase change", () => {
        const pruned = pruneSelection(
            { phases: ["Handover"], zones: ["Zone A", "Zone B"], categories: ["Civil", "Electrical"] },
            opts("Zone A"),
            opts("Civil"),
        );
        expect(pruned).toEqual({
            phases: ["Handover"],
            zones: ["Zone A"],
            categories: ["Civil"],
        });
    });

    it("leaves phases alone -- they are the axis driving the prune", () => {
        const pruned = pruneSelection(
            { phases: ["Onboarding", "Handover"], zones: [], categories: [] },
            opts("Zone A"),
            opts("Civil"),
        );
        expect(pruned.phases).toEqual(["Onboarding", "Handover"]);
    });
});

describe("isSelectionComplete", () => {
    it("requires a tick on every axis", () => {
        expect(
            isSelectionComplete({ phases: ["Onboarding"], zones: ["Zone A"], categories: ["Civil"] }),
        ).toBe(true);
        expect(
            isSelectionComplete({ phases: ["Onboarding"], zones: [], categories: ["Civil"] }),
        ).toBe(false);
    });
});

describe("resolveSeed", () => {
    const phaseOptions = opts("Onboarding", "Handover");
    const zoneOptions = opts("Zone A", "Zone B");
    const categoryOptions = opts("", "Civil");

    it("defaults an unseeded axis to everything available", () => {
        expect(resolveSeed({}, phaseOptions, zoneOptions, categoryOptions)).toEqual({
            phases: ["Onboarding", "Handover"],
            zones: ["Zone A", "Zone B"],
            categories: ["", "Civil"],
        });
    });

    it("honours a seeded axis", () => {
        const resolved = resolveSeed(
            { phases: ["Handover"], zones: ["Zone B"] },
            phaseOptions,
            zoneOptions,
            categoryOptions,
        );
        expect(resolved.phases).toEqual(["Handover"]);
        expect(resolved.zones).toEqual(["Zone B"]);
        expect(resolved.categories).toEqual(["", "Civil"]);
    });

    it("falls back to all when a stale seed matches nothing", () => {
        const resolved = resolveSeed(
            { zones: ["Zone Deleted"] },
            phaseOptions,
            zoneOptions,
            categoryOptions,
        );
        expect(resolved.zones).toEqual(["Zone A", "Zone B"]);
    });
});

describe("buildDownloadParams", () => {
    const available = {
        phases: opts("Onboarding", "Handover"),
        zones: opts("Zone A", "Zone B"),
        categories: opts("", "Civil", "Electrical"),
    };

    it("always sends phases -- an absent phase means Onboarding-only to the Jinja", () => {
        const params = buildDownloadParams(
            "PDT-001",
            { phases: ["Onboarding", "Handover"], zones: ["Zone A", "Zone B"], categories: ["", "Civil", "Electrical"] },
            available,
        );
        expect(params.get("phases")).toBe('["Onboarding","Handover"]');
        expect(params.get("doctype")).toBe("Project Design Tracker");
        expect(params.get("name")).toBe("PDT-001");
    });

    it("omits zones and categories when the axis is fully selected", () => {
        const params = buildDownloadParams(
            "PDT-001",
            { phases: ["Onboarding"], zones: ["Zone A", "Zone B"], categories: ["", "Civil", "Electrical"] },
            available,
        );
        expect(params.has("zones")).toBe(false);
        expect(params.has("categories")).toBe(false);
    });

    it("sends a JSON array when an axis is narrowed", () => {
        const params = buildDownloadParams(
            "PDT-001",
            { phases: ["Onboarding"], zones: ["Zone A"], categories: [""] },
            available,
        );
        expect(params.get("zones")).toBe('["Zone A"]');
        expect(params.get("categories")).toBe('[""]');
    });

    it("survives a zone name containing a comma or quote", () => {
        const awkward = { ...available, zones: opts('Zone "A", North', "Zone B") };
        const params = buildDownloadParams(
            "PDT-001",
            { phases: ["Onboarding"], zones: ['Zone "A", North'], categories: ["Civil"] },
            awkward,
        );
        expect(JSON.parse(params.get("zones") as string)).toEqual(['Zone "A", North']);
    });
});

describe("describeSelection", () => {
    const available = {
        phases: opts("Onboarding", "Handover"),
        zones: opts("Zone A", "Zone B", "Zone C"),
        categories: [
            { value: "", label: "Uncategorized", count: 1 },
            { value: "Civil", label: "Civil", count: 3 },
        ],
    };

    it("says All when an axis is untouched", () => {
        expect(
            describeSelection(
                {
                    phases: ["Onboarding", "Handover"],
                    zones: ["Zone A", "Zone B", "Zone C"],
                    categories: ["", "Civil"],
                },
                available,
            ),
        ).toEqual(["All phases", "All zones", "All categories"]);
    });

    it("names a single pick and counts several", () => {
        expect(
            describeSelection(
                { phases: ["Handover"], zones: ["Zone A", "Zone C"], categories: ["Civil"] },
                available,
            ),
        ).toEqual(["Handover", "2 of 3 zones", "Civil"]);
    });

    it("uses the human label, so the blank category reads as Uncategorized", () => {
        expect(
            describeSelection(
                { phases: ["Onboarding"], zones: ["Zone A"], categories: [""] },
                available,
            ),
        ).toEqual(["Onboarding", "Zone A", "Uncategorized"]);
    });

    it("says No <axis> rather than going silent when nothing is ticked", () => {
        expect(
            describeSelection(
                { phases: ["Onboarding"], zones: [], categories: [] },
                available,
            ),
        ).toEqual(["Onboarding", "No zones", "No categories"]);
    });

    it("drops an axis that has no options at all", () => {
        expect(
            describeSelection(
                { phases: ["Onboarding"], zones: [], categories: [] },
                { ...available, zones: [], categories: [] },
            ),
        ).toEqual(["Onboarding"]);
    });
});

describe("buildDownloadFilename", () => {
    const NOW = new Date(2026, 7, 12); // 12 Aug 2026
    const available = {
        phases: opts("Onboarding", "Handover"),
        zones: opts("Zone A", "Zone B"),
        categories: opts("Civil", "Electrical"),
    };

    it("uses AllPhases/AllZones and omits categories when nothing is narrowed", () => {
        const name = buildDownloadFilename(
            "Acme Tower",
            { phases: ["Onboarding", "Handover"], zones: ["Zone A", "Zone B"], categories: ["Civil", "Electrical"] },
            available,
            NOW,
        );
        expect(name).toBe("Acme_Tower-AllPhases-AllZones-12_Aug_2026-DesignTracker.pdf");
    });

    it("names a single pick and counts several", () => {
        expect(
            buildDownloadFilename(
                "Acme Tower",
                { phases: ["Handover"], zones: ["Zone A"], categories: ["Civil"] },
                available,
                NOW,
            ),
        ).toBe("Acme_Tower-Handover-Zone_A-Civil-12_Aug_2026-DesignTracker.pdf");

        expect(
            buildDownloadFilename(
                "Acme Tower",
                { phases: ["Onboarding"], zones: ["Zone A", "Zone B"], categories: [] },
                { ...available, categories: opts("Civil", "Electrical", "Plumbing") },
                NOW,
            ),
        ).toBe("Acme_Tower-Onboarding-AllZones-0Categories-12_Aug_2026-DesignTracker.pdf");
    });

    it("falls back to Project when the name is blank", () => {
        const name = buildDownloadFilename(
            "",
            { phases: ["Onboarding"], zones: ["Zone A"], categories: ["Civil", "Electrical"] },
            available,
            NOW,
        );
        expect(name.startsWith("Project-")).toBe(true);
    });
});
