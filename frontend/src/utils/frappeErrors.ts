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
