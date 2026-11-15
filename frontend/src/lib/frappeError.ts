import type { FrappeError } from "./frappe";

/**
 * Is this caught value a failed frappe-react-sdk call? The SDK rejects with a `FrappeError` (always `httpStatus`
 * and `message`; `exc_type` names the Python exception when the server raised one), so after this check
 * `err.exc_type` reads without a cast:  `if (isFrappeError(err) && err.exc_type === "CustomerGSTExistError")`.
 */
export function isFrappeError(err: unknown): err is FrappeError {
  return (
    typeof err === "object" &&
    err !== null &&
    "httpStatus" in err &&
    typeof err.httpStatus === "number" &&
    "message" in err &&
    typeof err.message === "string" &&
    (!("exc_type" in err) || err.exc_type === undefined || typeof err.exc_type === "string")
  );
}
