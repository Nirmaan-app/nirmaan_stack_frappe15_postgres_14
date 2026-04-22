export interface AssignedPMODetail {
    userId: string;
    userName: string;
    userEmail: string;
}

/**
 * Parse the assigned_to JSON field from PMO Project Task.
 * Handles: { list: [...] }, direct array, JSON string, or null/empty.
 */
export const parseAssignedFromField = (field: unknown): AssignedPMODetail[] => {
    if (!field) return [];

    if (typeof field === "object" && field !== null && "list" in field) {
        const obj = field as { list: AssignedPMODetail[] };
        if (Array.isArray(obj.list)) return obj.list;
    }

    if (Array.isArray(field)) return field;

    if (typeof field === "string" && field.trim() !== "") {
        try {
            const parsed = JSON.parse(field);
            if (parsed?.list && Array.isArray(parsed.list)) return parsed.list;
            if (Array.isArray(parsed)) return parsed;
        } catch {
            // invalid JSON
        }
    }

    return [];
};
