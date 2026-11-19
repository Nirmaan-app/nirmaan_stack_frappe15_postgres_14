/**
 * Test helper: what frappe-js-sdk rejects with when a whitelisted call fails (`lib/call/index.js`): the reply's body
 * spread, the HTTP status, then the body's own `message` and `exception`, or the SDK's defaults when the body has
 * none ("There was an error." and "").
 */
export const sdkRejection = (body: Record<string, unknown>) => ({
  ...body,
  httpStatus: 417,
  httpStatusText: "Expectation Failed",
  message: body.message ?? "There was an error.",
  exception: body.exception ?? "",
});
