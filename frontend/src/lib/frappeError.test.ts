import { describe, expect, it } from "vitest";
import { isFrappeError } from "./frappeError";

// The shape frappe-js-sdk rejects with when a call fails (its `Error` type, re-exported as `FrappeError`).
const duplicateGst = {
  httpStatus: 417,
  httpStatusText: "Expectation Failed",
  message: "There was an error.",
  exception: "CustomerGSTExistError: GST already used",
  exc_type: "CustomerGSTExistError",
};

describe("isFrappeError", () => {
  it("accepts a failed SDK call, so its exc_type can be read", () => {
    expect(isFrappeError(duplicateGst)).toBe(true);
    const err: unknown = duplicateGst;
    if (isFrappeError(err)) expect(err.exc_type).toBe("CustomerGSTExistError");
  });

  it("accepts one with no exc_type (a network or permission failure)", () => {
    expect(isFrappeError({ httpStatus: 403, httpStatusText: "Forbidden", message: "Not permitted", exception: "" })).toBe(true);
  });

  it("refuses anything that is not a failed SDK call", () => {
    for (const value of [undefined, null, "CustomerGSTExistError", 417, new Error("boom"), { exc_type: 5 }, {}]) {
      expect(isFrappeError(value)).toBe(false);
    }
  });
});
