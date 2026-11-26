import { describe, expect, it } from "vitest";

import { moveLabel } from "./moveLabel";

const PE = "Project Expenses";
const NPE = "Non Project Expenses";

describe("the Move button and title (spec #1753 stories 37-39)", () => {
    it("reads Move to a project on a Non Project Expense", () => {
        expect(moveLabel([NPE])).toBe("Move to a project");
        expect(moveLabel([NPE, NPE])).toBe("Move to a project");
    });

    it("reads Change project on a Project Expense", () => {
        expect(moveLabel([PE])).toBe("Change project");
        expect(moveLabel([PE, PE, PE])).toBe("Change project");
    });

    it("reads Move N expenses for a mixed selection", () => {
        expect(moveLabel([PE, NPE, NPE])).toBe("Move 3 expenses");
    });
});
