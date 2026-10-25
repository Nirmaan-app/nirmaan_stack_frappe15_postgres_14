// Reviewing a Porter import's projects (#1446): how the orders are laid out, what each suggestion says,
// and which come first.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PORTER_STEPS, currentStepIndex } from "./importWizard";
import {
    automaticLines,
    choiceItems,
    choiceSummary,
    confirmSummary,
    placedOn,
    nextConfirmLabel,
    keepShownOrder,
    likelyChoices,
    listedBecause,
    placementLabel,
    porterReviewOffered,
    reasonLabel,
    reviewItems,
    type PorterReviewLine,
} from "./porterReview";

let serial = 0;
const line = (over: Partial<PorterReviewLine>): PorterReviewLine => {
    serial += 1;
    return {
        name: `OFR-${String(serial).padStart(3, "0")}`,
        crn: `CRN${serial}`,
        completed_on: `2026-09-${String(serial).padStart(2, "0")} 10:00:00`,
        fare: 100,
        remarks: "",
        city: "Bangalore",
        from_address: "From",
        to_address: "To",
        booked_by: "Kavya Menon",
        group_key: "",
        ledger: "Non Project Expenses",
        project: null,
        project_name: null,
        reason: null,
        strength: null,
        editable: true,
        needs_person: false,
        likely_projects: [],
        ...over,
    };
};

const zephyr = (over: Partial<PorterReviewLine> = {}) =>
    line({
        remarks: "zephyr tower project",
        group_key: "bangalore|zephyr tower project",
        ledger: "Project Expenses",
        project: "PROJ-1",
        project_name: "Zephyr Tower",
        reason: "name",
        strength: "Strong",
        ...over,
    });

describe("how the orders are laid out", () => {
    it("puts orders with one remark in one city into one group, assigned together", () => {
        const lines = [zephyr({ fare: 858 }), zephyr({ remarks: "Zephyr Tower Project ", fare: 1616 }), zephyr({ fare: 456 })];
        const items = reviewItems(lines);
        expect(items).toHaveLength(1);
        expect(items[0].kind).toBe("group");
        expect(items[0].lines.map((l) => l.name)).toEqual(lines.map((l) => l.name));
        expect(items[0].fare).toBe(2930);
        expect(items[0].remark).toBe("zephyr tower project");
        expect(items[0].city).toBe("Bangalore");
    });

    it("keeps the same remark in another city apart", () => {
        const items = reviewItems([
            line({ remarks: "quillon site", group_key: "bangalore|quillon site" }),
            line({ remarks: "quillon site", city: "Hyderabad", group_key: "hyderabad|quillon site" }),
        ]);
        expect(items.map((item) => item.city).sort()).toEqual(["Bangalore", "Hyderabad"]);
    });

    it("lists orders with no remark one by one, never together", () => {
        const items = reviewItems([line({ booked_by: "Ravi" }), line({ booked_by: "Sunil" })]);
        expect(items).toHaveLength(2);
        expect(items.every((item) => item.kind === "order" && item.lines.length === 1)).toBe(true);
    });
});

describe("what a suggestion says", () => {
    it("shows the project, or Non-Project, and says when a group's orders disagree", () => {
        const [one] = reviewItems([zephyr()]);
        expect(placementLabel(one)).toBe("Zephyr Tower");
        const [none] = reviewItems([line({})]);
        expect(placementLabel(none)).toBe("Non-Project");
        const [mixed] = reviewItems([zephyr(), zephyr({ ledger: "Non Project Expenses", project: null, project_name: null })]);
        expect(mixed.mixed).toBe(true);
        expect(mixed.project).toBeNull();
        expect(placementLabel(mixed)).toBe("Mixed: 1 Zephyr Tower, 1 Non-Project");
    });

    it("names its reason, and shows a reason it does not know as it is", () => {
        expect(reasonLabel("name")).toBe("Project name in the remark");
        expect(reasonLabel("review")).toBe("Chosen in review");
        expect(reasonLabel("someday-signal")).toBe("someday-signal");
        expect(reasonLabel(null)).toBe("No project found");
    });

    it("names every signal that agreed (#1448)", () => {
        expect(reasonLabel("name+address")).toBe("Project name in the remark, and its site address");
        expect(reasonLabel("typo+address")).toBe("Project name misspelt in the remark, and its site address");
        expect(reasonLabel("address")).toBe("Its site address");
        expect(reasonLabel("history")).toBe("Kept so in an earlier Porter import");
        expect(reasonLabel("conflict")).toBe("Name and most addresses point to different projects");
        // A part it does not know is still shown as it is.
        expect(reasonLabel("name+someday")).toBe("Project name in the remark, and someday");
    });

    it("marks a group with a weak order as one to check", () => {
        const [group] = reviewItems([zephyr(), zephyr({ strength: "Check" })]);
        expect(group.needsCheck).toBe(true);
        expect(group.reasons).toEqual(["name"]);
    });
});

describe("why a group is listed (#1563)", () => {
    const badge = (lines: PorterReviewLine[]) => listedBecause(reviewItems(lines)[0]);
    const unplaced = { ledger: "Non Project Expenses", project: null, project_name: null };

    it("names the disagreement between the remark and the addresses", () => {
        expect(badge([zephyr({ ...unplaced, reason: "conflict", strength: "Check", needs_person: true })])).toBe(
            "Name and address disagree",
        );
    });

    it("says only the address matched for an address-only suggestion", () => {
        expect(badge([line({ ledger: "Project Expenses", project: "P-1", reason: "address", strength: "Check", needs_person: true })])).toBe(
            "Only the address matched",
        );
    });

    it("says the name match was loose for a single word, a typo or initials", () => {
        for (const reason of ["name", "typo", "initials"]) {
            expect(badge([zephyr({ reason, strength: "Check", needs_person: true })])).toBe("Loose name match");
        }
    });

    it("says nothing matched when no project was found", () => {
        expect(badge([line({ needs_person: true })])).toBe("No match");
    });

    it("says the orders were placed differently when a group splits", () => {
        expect(
            badge([zephyr({ needs_person: true }), zephyr({ project: "P-2", project_name: "Quillon Park", needs_person: true })]),
        ).toBe("Orders placed differently");
    });

    it("never says a bare Check, and says nothing once a person has decided", () => {
        expect(badge([zephyr({ reason: "review", strength: null })])).toBeNull();
    });
});

describe("the two likely projects (#1563)", () => {
    const projects = [
        { name: "P-1", project_name: "Zephyr Tower" },
        { name: "P-2", project_name: "Quillon Park" },
        { name: "P-3", project_name: "Orion Mall" },
    ];
    const choices = (likely: string[]) =>
        likelyChoices(reviewItems([zephyr({ needs_person: true, likely_projects: likely })])[0], projects);

    it("offers each as a one-click choice when the placement names two", () => {
        expect(choices(["P-1", "P-3"])).toEqual([
            { value: "P-1", label: "Zephyr Tower" },
            { value: "P-3", label: "Orion Mall" },
        ]);
    });

    it("offers none when it names one, or more than two", () => {
        expect(choices(["P-1"])).toEqual([]);
        expect(choices(["P-1", "P-2", "P-3"])).toEqual([]);
        expect(choices([])).toEqual([]);
    });

    it("leaves out a project that is no longer offered (not Won)", () => {
        expect(choices(["P-1", "P-GONE"])).toEqual([]);
    });
});

describe("which come first", () => {
    it("lists Check suggestions first, then orders with no project, then the rest", () => {
        const strong = zephyr();
        const blank = line({});
        const weak = line({
            remarks: "quillon",
            group_key: "bangalore|quillon",
            ledger: "Project Expenses",
            project: "PROJ-2",
            project_name: "Quillon Park",
            reason: "name",
            strength: "Check",
        });
        const chosen = line({ reason: "review" });
        const keys = reviewItems([strong, chosen, blank, weak]).map((item) => item.lines[0].name);
        expect(keys).toEqual([weak.name, blank.name, strong.name, chosen.name]);
    });

    it("treats a group whose orders disagree as one to check", () => {
        const mixed = [zephyr(), zephyr({ project: "PROJ-2", project_name: "Quillon Park" })];
        const items = reviewItems([line({}), ...mixed]);
        expect(items[0].lines).toEqual(mixed);
    });

    it("within a tier, puts bigger groups first, then the earlier order", () => {
        const late = line({ completed_on: "2026-09-30 10:00:00" });
        const early = line({ completed_on: "2026-09-01 10:00:00" });
        const pair = [
            line({ remarks: "misc", group_key: "bangalore|misc" }),
            line({ remarks: "misc", group_key: "bangalore|misc" }),
        ];
        const items = reviewItems([late, early, ...pair]);
        expect(items.map((item) => item.lines[0].name)).toEqual([pair[0].name, early.name, late.name]);
    });

    it("does not move what is on screen when an edit changes its tier", () => {
        const weak = zephyr({ strength: "Check" });
        const blank = line({});
        const shown = reviewItems([weak, blank]).map((item) => item.key);
        // The weak group was just confirmed: its tier drops, but it stays where the reader left it.
        const after = reviewItems([{ ...weak, reason: "review", strength: null }, blank]);
        expect(keepShownOrder(after, shown).map((item) => item.key)).toEqual(shown);
        // A key never shown before goes after the ones that were.
        const added = line({});
        const withNew = keepShownOrder(reviewItems([added, weak, blank]), shown);
        expect(withNew.map((item) => item.key)).toEqual([...shown, `order:${added.name}`]);
    });
});

describe("what a choice places", () => {
    it("every order of a group not created yet, and none that is", () => {
        const created = zephyr({ editable: false });
        const failed = zephyr({ editable: true });
        const [group] = reviewItems([created, failed]);
        expect(group.editable).toBe(true);
        expect(group.toPlace).toEqual([failed.name]);
    });

    it("nothing once every order of the item is created", () => {
        const [group] = reviewItems([zephyr({ editable: false }), zephyr({ editable: false })]);
        expect(group.editable).toBe(false);
        expect(group.toPlace).toEqual([]);
    });
});

describe("when review is offered", () => {
    it("on a Validated import, and never before every invoice passed or once all is created", () => {
        expect(porterReviewOffered({ state: "Validated" })).toBe(true);
        for (const state of ["Validating", "Validation failed", "Created"]) {
            expect(porterReviewOffered({ state })).toBe(false);
        }
        expect(porterReviewOffered(null)).toBe(false);
    });

    it("not while a Create job just started still has every line waiting (#1564)", () => {
        expect(porterReviewOffered({ state: "Validated", create_running: true, to_create: 11 })).toBe(false);
    });

    it("again on a stopped Create with orders still to create, so a line in Error can be re-placed", () => {
        expect(porterReviewOffered({ state: "Creating", to_create: 2, create_running: false })).toBe(true);
        expect(porterReviewOffered({ state: "Creating", to_create: 2, create_running: true })).toBe(false);
        expect(porterReviewOffered({ state: "Creating", to_create: 0, create_running: false })).toBe(false);
    });

    it("moves the stepper to Review projects once every invoice passed", () => {
        const uploaded = { previewed: true, staged: true, matched: false };
        expect(currentStepIndex("Porter Statement", uploaded)).toBe(1);
        expect(currentStepIndex("Porter Statement", { ...uploaded, validated: true })).toBe(2);
        expect(PORTER_STEPS[2].key).toBe("review");
    });
});

describe("which orders Choose projects lists (#1560)", () => {
    // The server decides who needs a person (`porter_state.placement_kinds`): a remark group with a Check,
    // an order with no placement, a group placed differently. The screen lists exactly those, and keeps a
    // group a person already chose on screen so the choice can be seen and changed.
    it("lists a group that needs a person and leaves a sure one out", () => {
        const strong = [zephyr(), zephyr()];
        const doubt = [
            line({ remarks: "misc", group_key: "bangalore|misc", needs_person: true }),
            line({ remarks: "misc", group_key: "bangalore|misc", needs_person: true }),
        ];
        const blank = line({ needs_person: true });
        const listed = choiceItems([...strong, ...doubt, blank]);
        expect(listed.map((item) => item.key).sort()).toEqual(["group:bangalore|misc", `order:${blank.name}`].sort());
    });

    it("keeps a group a person chose, Not a project included", () => {
        const chosen = line({ reason: "review", ledger: "Non Project Expenses" });
        expect(choiceItems([chosen, zephyr()]).map((item) => item.key)).toEqual([`order:${chosen.name}`]);
    });

    it("never lists a created order", () => {
        const created = line({ reason: "review", editable: false });
        expect(choiceItems([created])).toEqual([]);
    });
});

describe("what Choose projects says (#1560)", () => {
    it("counts the orders that need a project and the ones placed automatically", () => {
        const lines = [
            zephyr(),
            zephyr(),
            zephyr({ remarks: "x", group_key: "bangalore|x" }),
            line({ needs_person: true }),
            line({ needs_person: true }),
        ];
        expect(choiceSummary(lines)).toEqual({
            heading: "2 orders need a project",
            note: "3 orders were placed automatically. You'll see them on the next screen.",
        });
    });

    it("says one order in the singular", () => {
        expect(choiceSummary([zephyr(), line({ needs_person: true })])).toEqual({
            heading: "1 order needs a project",
            note: "1 order was placed automatically. You'll see it on the next screen.",
        });
    });

    it("reads 0 once a person has placed every one", () => {
        const chosen = line({ reason: "review" });
        expect(choiceSummary([zephyr(), chosen]).heading).toBe("0 orders need a project");
        // Nothing was placed automatically: no note about it.
        expect(choiceSummary([line({ needs_person: true })]).note).toBeNull();
    });

    it("says all were placed automatically when nothing needed a person", () => {
        expect(choiceSummary([zephyr(), zephyr(), zephyr()])).toEqual({
            heading: "All 3 orders placed automatically.",
            note: null,
        });
    });

    it("labels Next with how many are left", () => {
        expect(nextConfirmLabel(5)).toBe("Next: confirm (5 left)");
        expect(nextConfirmLabel(0)).toBe("Next: confirm");
    });
});

describe("what Confirm & create totals (#1564)", () => {
    const kharadi = (over: Partial<PorterReviewLine> = {}) =>
        line({
            ledger: "Project Expenses",
            project: "PROJ-2",
            project_name: "Kharadi Tower B",
            reason: "name",
            strength: "Strong",
            ...over,
        });

    it("sums orders and fare per project, then Not a project, then a total", () => {
        const summary = confirmSummary([
            zephyr({ fare: 100 }),
            kharadi({ fare: 500 }),
            line({ fare: 40, reason: "review" }),
            kharadi({ fare: 250 }),
            line({ fare: 60, reason: "review" }),
        ]);
        expect(summary.rows).toEqual([
            { key: "PROJ-2", label: "Kharadi Tower B", orders: 2, fare: 750 },
            { key: "PROJ-1", label: "Zephyr Tower", orders: 1, fare: 100 },
            { key: "", label: "Not a project", orders: 2, fare: 100 },
        ]);
        expect(summary.total).toEqual({ orders: 5, fare: 950 });
    });

    it("counts only the orders Create would still write", () => {
        const summary = confirmSummary([zephyr({ fare: 100 }), zephyr({ fare: 300, editable: false })]);
        expect(summary.rows).toEqual([{ key: "PROJ-1", label: "Zephyr Tower", orders: 1, fare: 100 }]);
        expect(summary.total).toEqual({ orders: 1, fare: 100 });
    });

    it("leaves Not a project out when every order is on a project", () => {
        expect(confirmSummary([zephyr()]).rows.map((row) => row.label)).toEqual(["Zephyr Tower"]);
    });
});

describe("which orders Confirm & create folds away (#1564)", () => {
    it("lists the orders placed automatically, never one a person chose or one still to decide", () => {
        const sure = zephyr();
        const chosen = line({ reason: "review" });
        const undecided = line({ reason: null, needs_person: true });
        const created = zephyr({ editable: false });
        expect(automaticLines([sure, chosen, undecided, created]).map((l) => l.name)).toEqual([sure.name]);
    });

    it("says where each one is placed", () => {
        expect(placedOn(zephyr())).toBe("Zephyr Tower");
        expect(placedOn(line({ reason: "history", strength: "Strong" }))).toBe("Not a project");
    });
});

describe("parity with the server", () => {
    it("knows the reasons the server writes today", () => {
        const source = readFileSync(
            fileURLToPath(new URL("../../../../nirmaan_stack/services/outflow_import/porter.py", import.meta.url)),
            "utf-8",
        );
        const written = [...source.matchAll(/^REASON_\w+ = "([^"]+)"/gm)].map((match) => match[1]);
        expect(written.length).toBeGreaterThan(1);
        for (const reason of written) expect(reasonLabel(reason)).not.toBe(reason);
    });
});
