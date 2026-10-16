import { describe, expect, it } from "vitest";
import { readFrappeError } from "./frappeErrors";

const reply = (body: unknown) => ({ json: async () => body });
const FALLBACK = "Failed to start the download (status 417).";

describe("readFrappeError — the reason Frappe gives for refusing a fetch", () => {
    it("reads frappe.throw's message out of _server_messages (a JSON list of JSON strings)", async () => {
        const body = { exc_type: "ValidationError", _server_messages: JSON.stringify([JSON.stringify({ message: "Select at least one PO to download." })]) };
        expect(await readFrappeError(reply(body), FALLBACK)).toBe("Select at least one PO to download.");
    });

    it("reads the exception text when there is no message log (developer mode / System Manager)", async () => {
        const body = { exc_type: "PermissionError", exception: "frappe.exceptions.PermissionError: You are not permitted to access this resource." };
        expect(await readFrappeError(reply(body), FALLBACK)).toBe("You are not permitted to access this resource.");
    });

    it("falls back when the body names only the error type (what most users get in production)", async () => {
        expect(await readFrappeError(reply({ exc_type: "KeyError" }), FALLBACK)).toBe(FALLBACK);
    });

    it("falls back on an empty message log and on an empty body", async () => {
        expect(await readFrappeError(reply({ _server_messages: "[]" }), FALLBACK)).toBe(FALLBACK);
        expect(await readFrappeError(reply({}), FALLBACK)).toBe(FALLBACK);
        expect(await readFrappeError(reply(null), FALLBACK)).toBe(FALLBACK);
    });

    it("never throws on a body that is not JSON (an HTML error page while the server restarts)", async () => {
        const html = { json: async () => { throw new SyntaxError("Unexpected token '<'"); } };
        expect(await readFrappeError(html, FALLBACK)).toBe(FALLBACK);
    });
});
