// src/utils/expenseFormat.ts
//
// Pure helpers for the Expense Type `source_format` editor.
//
// The JSON handling lives HERE rather than inline in the dialog for the reason ADR-0010 F2
// gives: a page should not parse a JSON shape inline. It is also trivially unit-testable
// this way, which an inline `try { JSON.parse }` never is.

/** Pretty-print raw JSON text. Returns null when it does not parse. */
export const prettyPrintJson = (raw: string): string | null => {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return null;
    }
};

/** The parse error message, or null when the text parses. Empty text is NOT an error. */
export const jsonParseError = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
        JSON.parse(trimmed);
        return null;
    } catch (e) {
        return (e as Error).message;
    }
};

/** True when the type ships a format. Whitespace-only counts as absent, deliberately. */
export const hasFormat = (source_format?: string | null): boolean =>
    !!(source_format || "").trim();


// --- the shipped format shape, parsed HERE rather than inline in a page (ADR-0010 F2) ---

export interface FormatField {
    key: string;
    label: string;
    type?: "text" | "textarea" | "number" | "date" | "select";
    required?: boolean;
    options?: string[];
    unit?: string;
    min?: number;
    max?: number;
    /** Prefill from a CLOSED allowlist (see BINDINGS). A default, never a lock. */
    bind?: string;
    /** Static prefill, used when there is no `bind` or the binding resolves to nothing. */
    default?: string | number;
}

export interface FormatSection {
    id: string;
    type: string;
    title?: string;
    fields?: FormatField[];
    slots?: { key: string; label: string }[];
}

export interface ParsedFormat {
    templateId?: string;
    templateVersion?: number;
    title?: string;
    sections?: FormatSection[];
}

/** Parse an `Expense Type.source_format`. Null for absent, blank or unparseable. */
export const parseFormat = (raw?: string | null): ParsedFormat | null => {
    if (!raw || !raw.trim()) return null;
    try {
        const p = JSON.parse(raw);
        return p && typeof p === "object" && !Array.isArray(p) ? (p as ParsedFormat) : null;
    } catch {
        return null;
    }
};


// --- prefill ------------------------------------------------------------------------

/** What a `bind` may resolve against. A CLOSED allowlist, deliberately: an open dot-path
 *  eval over arbitrary context is how a form ends up rendering something it should not. */
export interface BindContext {
    /** The logged-in user's display name. */
    userFullName?: string;
    /** The logged-in user's login id. */
    userEmail?: string;
}

const BINDINGS: Record<string, (c: BindContext) => string | undefined> = {
    "user.full_name": (c) => c.userFullName,
    "user.email": (c) => c.userEmail,
};

/** The bindings a format may use. Anything else resolves to nothing rather than throwing —
 *  a stale binding must cost a prefill, never the whole form. */
export const isKnownBinding = (bind?: string): boolean => !!bind && bind in BINDINGS;

/**
 * Initial answers for a format: `bind` first, then `default`.
 *
 * These are DEFAULTS, not locks. A bound field stays fully editable — a PM raising a request
 * for a colleague must be able to type that colleague's name over their own, and a readonly
 * field would silently file the wrong person.
 *
 * Keys are `sectionId.fieldKey`, matching the renderer.
 */
export const seedAnswers = (
    fmt: ParsedFormat | null,
    ctx: BindContext,
): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const section of fmt?.sections ?? []) {
        if (section.type !== "fields") continue;
        for (const f of section.fields ?? []) {
            const bound = f.bind ? BINDINGS[f.bind]?.(ctx) : undefined;
            const value = bound ?? f.default;
            if (value !== undefined && value !== null && `${value}`.trim() !== "") {
                out[`${section.id}.${f.key}`] = `${value}`;
            }
        }
    }
    return out;
};

/** Every attachment a request's `source_data` carries, flattened.
 *
 * `source_data` is a BACKEND shape, so it is parsed HERE and not in a page (ADR-0010 F2) --
 * one accessor, one place to correct if the envelope ever changes. Unparseable or
 * attachment-less data yields an empty list; a broken envelope must never break an
 * approval screen.
 */
export const attachmentsFromSourceData = (sourceData?: string | null): string[] => {
    try {
        const parsed = JSON.parse(sourceData || "{}");
        return Object.values(parsed?.attachments || {}).flat() as string[];
    } catch {
        return [];
    }
};


// --- validation ---------------------------------------------------------------------
//
// OWNED BY THIS MODULE, deliberately. The editor used to call the commissioning
// `parseTemplate`, on the theory that one grammar cannot drift. It drifted anyway, in the
// direction that matters: commissioning's binding allowlist is project-scoped, so every
// expense format using `bind: "user.full_name"` was REFUSED BY THE EDITOR — five of the
// seven shipped formats could not be saved through the app at all. The grammars are not
// the same grammar; pretending they were cost us the ability to save.
//
// The other half of the drift ran the opposite way: commissioning accepts section types
// (checklist, matrix, rowsTable, repeating_groups) that FormatFieldsRenderer cannot draw,
// so a format could validate clean and reach a requester with a section simply missing.

/** Same shape the editor has always rendered, so the dialog's error list is unchanged. */
export interface FormatValidationError {
    code: "invalid_json" | "missing_field" | "duplicate_id" | "invalid_type" | "unknown";
    message: string;
    path?: string;
}

export type FormatValidationResult =
    | { ok: true; warnings: string[] }
    | { ok: false; errors: FormatValidationError[] };

/** What FormatFieldsRenderer can actually draw — see its SCOPE note. The validator tracks
 *  the renderer, because a format that saves clean and renders nothing is the worse bug. */
const SECTION_TYPES = ["fields", "image_attachments"] as const;
const FIELD_TYPES = ["text", "textarea", "number", "date", "select"] as const;

const vErr = (
    code: FormatValidationError["code"], message: string, path?: string,
): FormatValidationError => (path ? { code, message, path } : { code, message });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validate an `Expense Type.source_format` for the editor.
 *
 * EMPTY IS NOT HANDLED HERE — the dialog treats a blank box as "clear the format", which is
 * legitimate, and never reaches this. An empty string arriving anyway is an error, not a pass.
 */
export const validateFormat = (raw: string): FormatValidationResult => {
    if (!raw || !raw.trim()) {
        return { ok: false, errors: [vErr("invalid_json", "Source format is empty")] };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return { ok: false, errors: [vErr("invalid_json", `Invalid JSON: ${(e as Error).message}`)] };
    }
    if (!isPlainObject(parsed)) {
        return { ok: false, errors: [vErr("invalid_type", "Top-level must be a JSON object")] };
    }

    const errors: FormatValidationError[] = [];
    const warnings: string[] = [];

    if (typeof parsed.templateId !== "string" || !parsed.templateId.trim()) {
        warnings.push("templateId is not set");
    }
    if (typeof parsed.templateVersion !== "number") {
        warnings.push("templateVersion is not a number — bump it whenever a key changes");
    }

    const sections = parsed.sections;
    if (!Array.isArray(sections) || sections.length === 0) {
        errors.push(vErr("missing_field", "sections must be a non-empty array", "sections"));
        return { ok: false, errors };
    }

    const sectionIds = new Set<string>();
    let mappedSlots = 0;

    sections.forEach((rawSection, i) => {
        const path = `sections[${i}]`;
        if (!isPlainObject(rawSection)) {
            errors.push(vErr("invalid_type", `${path} must be an object`, path));
            return;
        }

        const id = typeof rawSection.id === "string" ? rawSection.id.trim() : "";
        if (!id) errors.push(vErr("missing_field", `${path}.id is required`, path));
        else if (sectionIds.has(id)) {
            // Two sections under one id collapse in `source_data.responses` — the second
            // silently overwrites the first's answers.
            errors.push(vErr("duplicate_id", `${path}.id "${id}" duplicated`, path));
        } else sectionIds.add(id);

        const type = rawSection.type;
        if (typeof type !== "string" || !(SECTION_TYPES as readonly string[]).includes(type)) {
            errors.push(vErr("invalid_type",
                `${path}.type "${String(type)}" cannot be rendered here ` +
                `(expected ${SECTION_TYPES.join(" or ")})`, path));
            return;
        }

        if (type === "fields") {
            const fields = rawSection.fields;
            if (!Array.isArray(fields) || fields.length === 0) {
                errors.push(vErr("missing_field", `${path}.fields must be a non-empty array`, path));
                return;
            }
            const keys = new Set<string>();
            fields.forEach((rawField, j) => {
                const fp = `${path}.fields[${j}]`;
                if (!isPlainObject(rawField)) {
                    errors.push(vErr("invalid_type", `${fp} must be an object`, fp));
                    return;
                }
                const key = typeof rawField.key === "string" ? rawField.key.trim() : "";
                if (!key) errors.push(vErr("missing_field", `${fp}.key is required`, fp));
                else if (keys.has(key)) {
                    errors.push(vErr("duplicate_id", `${fp}.key "${key}" duplicated`, fp));
                } else keys.add(key);

                // The label is what the approval screen and the ledger description print.
                // Without one, flatten falls back to a title-cased key — which is exactly the
                // drift that made these formats unreadable in the first place.
                if (typeof rawField.label !== "string" || !rawField.label.trim()) {
                    errors.push(vErr("missing_field", `${fp}.label is required`, fp));
                }
                if (rawField.type !== undefined
                    && !(FIELD_TYPES as readonly string[]).includes(rawField.type as string)) {
                    errors.push(vErr("invalid_type",
                        `${fp}.type "${String(rawField.type)}" is not one of ${FIELD_TYPES.join(", ")}`, fp));
                }
                if (rawField.type === "select"
                    && (!Array.isArray(rawField.options) || rawField.options.length === 0)) {
                    errors.push(vErr("missing_field", `${fp}.options is required for a select`, fp));
                }
                const bind = rawField.bind;
                if (bind !== undefined && bind !== null && bind !== "") {
                    if (typeof bind !== "string" || !isKnownBinding(bind)) {
                        errors.push(vErr("invalid_type",
                            `${fp}.bind "${String(bind)}" is not in the allowlist ` +
                            `(${Object.keys(BINDINGS).join(", ")})`, fp));
                    }
                }
            });
            return;
        }

        const slots = rawSection.slots;
        if (!Array.isArray(slots) || slots.length === 0) {
            errors.push(vErr("missing_field", `${path}.slots must be a non-empty array`, path));
            return;
        }
        const slotKeys = new Set<string>();
        slots.forEach((rawSlot, j) => {
            const sp = `${path}.slots[${j}]`;
            if (!isPlainObject(rawSlot)) {
                errors.push(vErr("invalid_type", `${sp} must be an object`, sp));
                return;
            }
            const key = typeof rawSlot.key === "string" ? rawSlot.key.trim() : "";
            if (!key) errors.push(vErr("missing_field", `${sp}.key is required`, sp));
            else if (slotKeys.has(key)) {
                errors.push(vErr("duplicate_id", `${sp}.key "${key}" duplicated`, sp));
            } else slotKeys.add(key);

            if (typeof rawSlot.label !== "string" || !rawSlot.label.trim()) {
                errors.push(vErr("missing_field", `${sp}.label is required`, sp));
            }
            if (rawSlot.maps_to === "invoice_attachment") mappedSlots += 1;
        });
    });

    // A WARNING, not an error: `first_mapped_attachment` documents that the first declaring
    // slot wins. Surfacing it beats letting the author believe both files carry.
    if (mappedSlots > 1) {
        warnings.push(
            `${mappedSlots} slots declare maps_to "invoice_attachment" — the FIRST one wins, ` +
            "the rest carry no file to the ledger row"
        );
    }

    return errors.length ? { ok: false, errors } : { ok: true, warnings };
};


/** The stored answers as the dialog's flat `section.field` map — the inverse of `toResponses`.
 *
 *  Needed to EDIT a request: the answers are stored nested under their section, while the form
 *  holds them flat, and rebuilding the flat shape by hand at the call site would be a second
 *  definition of the key format that could drift from `toResponses`. */
export const answersFromSourceData = (raw?: string | null): Record<string, string> => {
    const responses = parseResponses(raw);
    const out: Record<string, string> = {};
    Object.entries(responses).forEach(([section, fields]) => {
        if (!fields || typeof fields !== "object" || Array.isArray(fields)) return;
        Object.entries(fields as Record<string, unknown>).forEach(([key, value]) => {
            if (value === null || value === undefined) return;
            out[`${section}.${key}`] = String(value);
        });
    });
    return out;
};

/** The typed description of a FORMAT-LESS request.
 *
 *  It lives under the synthetic `detail.description` key that the dialog mints, because the
 *  doctype has no `description` column — so editing one has to read it back from there or the
 *  requester's own text vanishes the moment they open the form. */
export const readDetailDescription = (raw?: string | null): string => {
    const responses = parseResponses(raw);
    const detail = responses?.detail;
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "";
    const value = (detail as Record<string, unknown>).description;
    return typeof value === "string" ? value : "";
};

/** `source_data.responses`, or {}. Shared by the two readers above so the envelope is
 *  understood in ONE place. */
const parseResponses = (raw?: string | null): Record<string, unknown> => {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        const responses = parsed?.responses;
        return responses && typeof responses === "object" && !Array.isArray(responses)
            ? (responses as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
};
