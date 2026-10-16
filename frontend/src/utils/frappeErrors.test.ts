import { describe, expect, it } from "vitest";
import { getFrappeErrorText, readFrappeError } from "./frappeErrors";

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

// What the server sends when a person still has linked records (captured from localhost, names changed).
const LINKED = {
  message: "There was an error while deleting the document.",
  exception: 'frappe.exceptions.LinkExistsError: Cannot delete or cancel because Nirmaan Users <a href="http://localhost:8000/app/nirmaan-users/a@x.com">a@x.com</a> is linked with Nirmaan Notifications <a href="http://localhost:8000/app/nirmaan-notifications/9ekd6leegl">9ekd6leegl</a> ',
  _server_messages: JSON.stringify([
    JSON.stringify({
      message: 'Cannot delete or cancel because Nirmaan Users <a href="http://localhost:8000/app/nirmaan-users/a@x.com">a@x.com</a> is linked with Nirmaan Notifications <a href="http://localhost:8000/app/nirmaan-notifications/9ekd6leegl">9ekd6leegl</a> ',
      title: "Message",
      indicator: "red",
    }),
  ]),
};

describe("getFrappeErrorText", () => {
  it("gives the server's reason, not the SDK's generic message", () => {
    expect(getFrappeErrorText(LINKED)).toBe(
      "Cannot delete or cancel because Nirmaan Users a@x.com is linked with Nirmaan Notifications 9ekd6leegl"
    );
  });

  it("reads the exception when there are no server messages", () => {
    const { _server_messages, ...noMessages } = LINKED;
    void _server_messages;
    expect(getFrappeErrorText(noMessages)).toBe(
      "Cannot delete or cancel because Nirmaan Users a@x.com is linked with Nirmaan Notifications 9ekd6leegl"
    );
  });

  it("decodes entities and keeps a plain message as it is", () => {
    expect(getFrappeErrorText({ exception: "frappe.exceptions.ValidationError: Can&#39;t delete &quot;A &amp; B&quot;" }))
      .toBe('Can\'t delete "A & B"');
    expect(getFrappeErrorText(new Error("User email is missing"))).toBe("User email is missing");
  });
});
