import { describe, expect, it } from "vitest";

import { serverRefusalText } from "./frappeErrorText";

// What frappe-js-sdk rejects with when a whitelisted call fails: the reply's body spread, then its own `message`
// ("There was an error." when the body has none) and `exception` ("" when the body has none).
const sdkRejection = (body: Record<string, unknown>) => ({
  ...body,
  httpStatus: 417,
  httpStatusText: "Expectation Failed",
  message: typeof body.message === "string" ? body.message : "There was an error.",
  exception: typeof body.exception === "string" ? body.exception : "",
});

describe("serverRefusalText on what frappe-js-sdk rejects with", () => {
  it("reads the server's refusal through the SDK's added fields", () => {
    const _server_messages = JSON.stringify([JSON.stringify({ message: "The sheet is locked." })]);
    expect(serverRefusalText(sdkRejection({ _server_messages }))).toBe("The sheet is locked.");
    expect(serverRefusalText(sdkRejection({ exception: "frappe.exceptions.ValidationError: No rows." }))).toBe("No rows.");
  });

  it("NEGATIVE: the SDK's own placeholder is not the server's words -> null", () => {
    expect(serverRefusalText(sdkRejection({}))).toBeNull();
  });

  it("NEGATIVE: a client-side Error (the SDK's TypeError when no reply came) -> null", () => {
    expect(serverRefusalText(new TypeError("Cannot read properties of undefined (reading 'data')"))).toBeNull();
  });
});
