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
