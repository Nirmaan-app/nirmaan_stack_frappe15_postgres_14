// Reviewing a Porter import's projects (#1446): how the orders are laid out, what each suggestion says,
// and which come first.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PORTER_STEPS, currentStepIndex } from "./importWizard";
import {
    keepShownOrder,
    placementLabel,
    porterReviewOffered,
    reasonLabel,
    reviewItems,
    strengthLabel,
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

    it("is plain when strong, and says Check when weak", () => {
        expect(strengthLabel("Strong")).toBeNull();
        expect(strengthLabel(null)).toBeNull();
        expect(strengthLabel("Check")).toBe("Check");
        const [group] = reviewItems([zephyr(), zephyr({ strength: "Check" })]);
        expect(group.needsCheck).toBe(true);
        expect(group.reasons).toEqual(["name"]);
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
