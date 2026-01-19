/**
 * CSRF Token Error Detection Utility
 *
 * Used to detect CSRF-related errors so we can show user-friendly messages
 * instead of generic error states.
 */

/**
 * Check if an error is a CSRF-related error.
 * Looks for "csrf" keyword or 403 status in error message/properties.
 *
 * @param error - The error to check (can be Error, string, or object)
 * @returns true if this appears to be a CSRF token error
 */
export function isCsrfError(error: unknown): boolean {
  if (!error) return false;

  // Convert error to string for keyword checking
  const errorStr = String(error).toLowerCase();

  // Check for explicit CSRF mention
  if (errorStr.includes("csrf")) return true;

  // Check for 403 status in string representation
  if (errorStr.includes("403")) return true;

  // Check if error object has httpStatus or status property
  if (typeof error === "object" && error !== null) {
    const errObj = error as Record<string, unknown>;

    // Check common status code properties
    if (errObj.httpStatus === 403 || errObj.status === 403) return true;

    // Check nested response object (common in fetch/axios errors)
    if (
      typeof errObj.response === "object" &&
      errObj.response !== null &&
      (errObj.response as Record<string, unknown>).status === 403
    ) {
      return true;
    }

    // Check message property
    if (typeof errObj.message === "string") {
      const msg = errObj.message.toLowerCase();
      if (msg.includes("csrf") || msg.includes("403")) return true;
    }
  }

  return false;
}
