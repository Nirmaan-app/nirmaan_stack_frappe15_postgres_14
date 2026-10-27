// The Create Expense comment cap is answered in TWO LANGUAGES, and this file is the join.
//
// The dialog caps a typed comment at `NEW_EXPENSE_COMMENT_MAX` (`newExpenseSeed.ts`). The server
// stores it as `<typed> · Imported from <batch>` in a Data field of `COMMENT_MAX_LENGTH` characters
// and REFUSES anything longer (`services/outflow_import/import_comment.py`). If the two drift, the
// screen accepts a comment the server then refuses -- on Confirm, after the person has typed it. Each
// side's own suite would stay green (ADR-0010 F1; `CODING_STANDARDS.md`: a test on each side of a
// boundary is not a test of the boundary), so the cap is checked here against the server's own text.
//
// ⚠️ IT READS THE PYTHON AND THE DOCTYPE AS TEXT, which is vacuous if a path rots, so the first case
// proves every value was actually found. vitest is a local gate (`frontend/CLAUDE.md`).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { NEW_EXPENSE_COMMENT_MAX } from "./newExpenseSeed";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const commentPy = read("../../../../nirmaan_stack/services/outflow_import/import_comment.py");
const batchDoctype = read(
    "../../../../nirmaan_stack/nirmaan_stack/doctype/outflow_import_batch/outflow_import_batch.json",
);
const autoname = /"autoname": "([^"]*)"/.exec(batchDoctype)?.[1];

const maxLength = Number(/^COMMENT_MAX_LENGTH = (\d+)$/m.exec(commentPy)?.[1]);
const separator = /^_SEPARATOR = "(.*)"$/m.exec(commentPy)?.[1];
const notePrefix = /note = f"(.*)\{batch\}"/.exec(commentPy)?.[1];

/** The widest batch name the doctype's autoname can produce: `OFI-.YY.-.#####` -> `OFI-99-99999`. */
const widestBatchName = (autoname: string) =>
    autoname
        .split(".")
        .map((part) => (part === "YY" ? "99" : part.replace(/#/g, "9")))
        .join("");

describe("the Create Expense comment cap fits what the server stores", () => {
    it("found every value it compares (a rotted path would pass vacuously)", () => {
        expect(maxLength).toBeGreaterThan(0);
        expect(separator).toBeTruthy();
        expect(notePrefix).toBe("Imported from ");
        expect(autoname).toBe("OFI-.YY.-.#####");
    });

    it("★ a comment at the screen's cap still fits beside the note on the widest batch name", () => {
        const note = `${notePrefix}${widestBatchName(autoname ?? "")}`;
        expect(NEW_EXPENSE_COMMENT_MAX + (separator ?? "").length + note.length).toBeLessThanOrEqual(maxLength);
    });
});
