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
 * The reason Frappe gives for refusing a raw `fetch` request, for a toast. Frappe never puts it in
 * `message`: it is read from `_server_messages` / `exception` through `getFrappeError`. Returns
 * `fallback` when the body carries neither (production hides `exception` from most users) or is not
 * JSON at all (an HTML error page while the server restarts). Never throws.
 */
export const readFrappeError = async (response: Pick<Response, "json">, fallback: string): Promise<string> => {
    const body = await response.json().catch(() => null);
    return (body && (body._server_messages || body.exception) && getFrappeError(body)) || fallback;
};

/**
 * Frappe's messages carry HTML -- a link-check refusal links every record it names
 * (`... linked with Nirmaan Notifications <a href="...">9ekd6leegl</a>`) -- and a toast shows text,
 * so the tags would appear as typed. Keeps each link's text, decodes the common entities.
 */
const toPlainText = (html: string): string =>
    html
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&#x27;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();

/** The server's exact reason as plain text, for a toast (see `toPlainText`). */
export const getFrappeErrorText = (error: any): string => toPlainText(getFrappeError(error));

/**
 * True when Frappe refused a save because a unique field already holds that value (the database's
 * "duplicate key" refusal, for example two users with one mobile number).
 *
 * On PostgreSQL Frappe gives this refusal no readable message (`show_unique_validation_message` writes one
 * only on MariaDB), and production sends just `exc_type: "UniqueValidationError"`, with no text that names
 * the field. So the type is what identifies it. When the reply does carry the database text (developer mode,
 * or error tracebacks allowed), it names the unique key (`"tabUser_mobile_no_key"`); then `fieldname`, when
 * given, must appear in it, so a refusal on another unique field is not mistaken for this one.
 */
export const isUniqueValueError = (error: unknown, fieldname?: string): boolean => {
    if (!error || typeof error !== "object") return false;
    const { exc_type, exception, _debug_messages } = error as Record<string, unknown>;
    const text = [exception, _debug_messages].filter((part): part is string => typeof part === "string").join(" ");
    const isUnique = exc_type === "UniqueValidationError" || text.includes("UniqueValidationError");
    if (!isUnique) return false;
    return !fieldname || !text.includes("duplicate key") || text.includes(fieldname);
};
