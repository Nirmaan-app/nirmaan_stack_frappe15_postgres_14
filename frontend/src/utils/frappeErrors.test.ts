import { describe, expect, it } from "vitest";
import { getFrappeErrorText, isUniqueValueError, readFrappeError } from "./frappeErrors";

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

// What the server sent when an edited user was given another user's mobile number (localhost, developer mode;
// values changed). Production sends only the exc_type.
const DUPLICATE_MOBILE_DEV = {
    exc_type: "UniqueValidationError",
    exception: "frappe.exceptions.UniqueValidationError: ('User', 'a@x.com', UniqueViolation('duplicate key value violates unique constraint \"tabUser_mobile_no_key\"\\nDETAIL:  Key (mobile_no)=(9000000000) already exists.\\n'))",
    _debug_messages: JSON.stringify(["Error in query:\nduplicate key value violates unique constraint \"tabUser_mobile_no_key\"\nDETAIL:  Key (mobile_no)=(9000000000) already exists.\n"]),
};

describe("isUniqueValueError — the database refused a value another record already holds", () => {
    it("recognises the developer-mode reply, and matches the field it names", () => {
        expect(isUniqueValueError(DUPLICATE_MOBILE_DEV)).toBe(true);
        expect(isUniqueValueError(DUPLICATE_MOBILE_DEV, "mobile_no")).toBe(true);
    });

    it("does not match a field the database text does not name", () => {
        expect(isUniqueValueError(DUPLICATE_MOBILE_DEV, "username")).toBe(false);
    });

    it("recognises the production reply, which carries only the type", () => {
        expect(isUniqueValueError({ exc_type: "UniqueValidationError" }, "mobile_no")).toBe(true);
        expect(isUniqueValueError({ exc_type: "UniqueValidationError", message: "There was an error." })).toBe(true);
    });

    it("leaves every other refusal alone", () => {
        expect(isUniqueValueError({ exc_type: "ValidationError", exception: "frappe.exceptions.ValidationError: Mobile No is invalid" }, "mobile_no")).toBe(false);
        expect(isUniqueValueError({ exc_type: "PermissionError" })).toBe(false);
        expect(isUniqueValueError(LINKED)).toBe(false);
        expect(isUniqueValueError(new Error("Network Error"))).toBe(false);
        expect(isUniqueValueError(undefined)).toBe(false);
        expect(isUniqueValueError("UniqueValidationError")).toBe(false);
    });
});
