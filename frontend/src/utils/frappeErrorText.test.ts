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

/** What `frappe.throw` sends back through frappe-react-sdk: `_server_messages` is a JSON list of JSON strings. */
const serverMessages = (...messages: string[]) =>
	JSON.stringify(messages.map((message) => JSON.stringify({ message, indicator: "red" })));

describe("serverRefusalText: the server's own refusal, shown to the user", () => {
	it("reads the message of a frappe.throw (Request / Update / Delete Payment dialogs)", () => {
		const err = { _server_messages: serverMessages("UTR 12345 already exists on PAY-00058-001."), message: "There was an error." };
		expect(serverRefusalText(err)).toBe("UTR 12345 already exists on PAY-00058-001.");
	});

	it("prefers the server's message over the SDK's generic one", () => {
		const err = { _server_messages: serverMessages("No GST left to request."), message: "Request failed with status code 417" };
		expect(serverRefusalText(err)).toBe("No GST left to request.");
	});

	it("joins several messages and strips HTML", () => {
		const err = { _server_messages: serverMessages("<b>Not allowed</b>", "Ask an Admin.") };
		expect(serverRefusalText(err)).toBe("Not allowed Ask an Admin.");
	});

	it("takes a plain-text entry as it is", () => {
		expect(serverRefusalText({ _server_messages: JSON.stringify(["Plain refusal"]) })).toBe("Plain refusal");
	});

	it("falls back to the error's message (a network error)", () => {
		expect(serverRefusalText({ message: "Network Error" })).toBe("Network Error");
		expect(serverRefusalText({ _server_messages: "not json", message: "Network Error" })).toBe("Network Error");
	});

	it("falls back to the exception, without its class name", () => {
		expect(serverRefusalText({ exception: "frappe.exceptions.ValidationError: Amount cannot be zero" }))
			.toBe("Amount cannot be zero");
	});

	it("gives null when there is nothing to show, so the dialog uses its own default", () => {
		for (const err of [null, undefined, "boom", 42, {}, { message: "   " }, { _server_messages: "[]" }]) {
			expect(serverRefusalText(err)).toBeNull();
		}
	});
});
