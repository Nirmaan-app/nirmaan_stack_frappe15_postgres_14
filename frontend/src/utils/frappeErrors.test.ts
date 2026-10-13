import { describe, expect, it } from "vitest";

import { getFrappeErrorText } from "./frappeErrors";

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
