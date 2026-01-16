/**
 * CSRF Token Refresh Utilities
 *
 * Handles CSRF token staleness in production environments where the token
 * set at page load can become invalid after session timeout/refresh.
 */

declare global {
  interface Window {
    csrf_token?: string;
  }
}

/**
 * Fetches a fresh CSRF token from the backend and updates window.csrf_token.
 *
 * @returns The new CSRF token if successful, null otherwise.
 */
export async function refreshCsrfToken(): Promise<string | null> {
  try {
    // Use GET to avoid CSRF requirement for this endpoint
    const response = await fetch(
      "/api/method/nirmaan_stack.api.auth.get_csrf_token",
      {
        method: "GET",
        credentials: "include", // Include session cookies
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error(`CSRF token refresh failed with status: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.message?.csrf_token) {
      // Update the global CSRF token
      window.csrf_token = data.message.csrf_token;
      console.log("CSRF token refreshed successfully");
      return data.message.csrf_token;
    }

    console.warn("CSRF token refresh response missing token");
    return null;
  } catch (error) {
    console.error("Failed to refresh CSRF token:", error);
    return null;
  }
}

/**
 * Checks if an error is a CSRF validation error.
 *
 * @param error - The error object to check.
 * @returns True if this appears to be a CSRF-related error.
 */
export function isCsrfError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const errorObj = error as Record<string, unknown>;

  // Check various error message locations
  const messageSources = [
    errorObj.message,
    errorObj._server_messages,
    (errorObj.response as Record<string, unknown>)?.data,
    (errorObj.exc as string),
  ];

  for (const source of messageSources) {
    if (source) {
      const msgStr = typeof source === "string" ? source : JSON.stringify(source);
      if (msgStr.toLowerCase().includes("csrf")) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks if an error is a 403 Forbidden error.
 *
 * @param error - The error object to check.
 * @returns True if this is a 403 error.
 */
export function is403Error(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const errorObj = error as Record<string, unknown>;

  // Check various status code locations
  const statusCode =
    errorObj.httpStatus ||
    errorObj.status ||
    (errorObj.response as Record<string, unknown>)?.status;

  return statusCode === 403;
}
