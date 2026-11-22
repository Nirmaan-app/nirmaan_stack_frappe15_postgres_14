import { describe, expect, it } from "vitest";

import { sdkRejection } from "./__fixtures__/sdkRejection";
import { serverRefusalText } from "./frappeErrorText";

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
