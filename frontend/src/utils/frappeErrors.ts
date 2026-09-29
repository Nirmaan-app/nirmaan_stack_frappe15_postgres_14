/**
 * Utility to extract a human-readable error message from a Frappe error object.
 * Handles _server_messages, exception, and basic message properties.
 */
export const getFrappeError = (error: any): string => {
    if (!error) return "An unknown error occurred.";

    // 1. Check for _server_messages (often a stringified JSON array of stringified JSON objects)
    if (error._server_messages) {
        try {
            const messages = typeof error._server_messages === 'string' 
                ? JSON.parse(error._server_messages) 
                : error._server_messages;

            if (Array.isArray(messages)) {
                return messages.map((m: any) => {
                    if (typeof m === 'string') {
                        try {
                            const parsed = JSON.parse(m);
                            return parsed.message || m;
                        } catch {
                            return m;
                        }
                    }
                    return m.message || JSON.stringify(m);
                }).join(", ");
            }
        } catch (e) {
            console.error("Error parsing _server_messages:", e);
        }
    }

    // 2. Check for exception property
    if (error.exception) {
        // Often looks like "frappe.exceptions.ValidationError: Specific Message"
        const parts = error.exception.split(':');
        if (parts.length > 1) {
            return parts.slice(1).join(':').trim();
        }
        return error.exception;
    }

    // 3. Fallback to basic message or toString
    return error.message || error.toString() || "Something went wrong.";
};

/**
 * Stale-save guard for a plain `updateDoc`. Sends back the `modified` the screen loaded, and
 * Frappe's own `check_if_latest` refuses the save (TimestampMismatchError) when someone else saved
 * the record in between — instead of the second save silently overwriting the first.
 * A record loaded without `modified` sends nothing, so the save goes through unguarded as before.
 */
export const staleGuard = (record?: { modified?: string | null } | null): { modified?: string } =>
    record?.modified ? { modified: record.modified } : {};

export const STALE_RECORD_MESSAGE =
    "Someone else changed this record after you opened it. Refresh and try again.";

export const isStaleRecordError = (error: any): boolean =>
    error?.exc_type === "TimestampMismatchError" ||
    String(error?.exception ?? "").includes("TimestampMismatchError");

/** The toast text for a failed save: the stale-record message, else the error's own. */
export const describeWriteError = (error: any, fallback: string): string => {
    if (isStaleRecordError(error)) return STALE_RECORD_MESSAGE;
    // The server's own reason (a frappe.throw) rides `_server_messages`; the SDK's `message` is often
    // only "There was an error." -- prefer the server's words when it sent any.
    if (error?._server_messages) return getFrappeError(error);
    return error?.message || fallback;
};

/**
 * The stale-save message naming WHO changed the record and when ("Ravi changed this record at
 * 29 Sep, 10:02 AM, after you opened it…"). The server writes the words (`api/last_change`) so the
 * screens and the bulk engines say the same thing; any failure falls back to the plain message.
 */
export const staleConflictMessage = async (doctype: string, name: string): Promise<string> => {
    try {
        const params = new URLSearchParams({ doctype, name });
        const res = await fetch(`/api/method/nirmaan_stack.api.last_change.get_stale_message?${params}`);
        const message = res.ok ? (await res.json())?.message : null;
        if (typeof message === "string" && message) return message;
    } catch {
        // fall through to the plain message
    }
    return STALE_RECORD_MESSAGE;
};

/** `describeWriteError`, but a stale save names who changed the record (one extra request). */
export const writeErrorMessage = async (
    error: any, fallback: string, doctype: string, name: string
): Promise<string> =>
    isStaleRecordError(error) ? staleConflictMessage(doctype, name) : describeWriteError(error, fallback);
