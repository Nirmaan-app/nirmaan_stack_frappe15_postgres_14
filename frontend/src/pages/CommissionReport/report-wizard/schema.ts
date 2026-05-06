// Builds per-section / per-step Zod schemas from a ReportTemplate.
// Used by the wizard's RHF resolver and by per-step `form.trigger()` validation.

import { z, ZodTypeAny } from 'zod';

import type {
    ChecklistSection,
    TraineesDataTableSection,
    Field,
    FieldsSection,
    HeaderSection,
    ImageAttachmentsSection,
    ReportTemplate,
    Section,
    WizardStepDef,
} from './types';

// ─── Field-level Zod ────────────────────────────────────────────────────────

const optionalText = (): ZodTypeAny =>
    z.string().optional().default('');

export const buildFieldSchema = (field: Field): ZodTypeAny => {
    const required = !!field.required && !field.readonly;
    switch (field.type) {
        case 'text':
        case 'textarea': {
            let s = z.string();
            if (field.type === 'text' && (field as { maxLength?: number }).maxLength) {
                s = s.max(
                    (field as { maxLength?: number }).maxLength!,
                    `${field.label} too long`,
                );
            }
            return required ? s.min(1, `${field.label} is required`) : s.optional().default('');
        }
        case 'date': {
            // ISO date string YYYY-MM-DD or empty.
            const s = z.string();
            return required ? s.min(1, `${field.label} is required`) : s.optional().default('');
        }
        case 'number': {
            // Accept both number and "" — coerce in onSubmit.
            const min = (field as { min?: number }).min;
            const max = (field as { max?: number }).max;
            const inner = z.preprocess(
                (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
                z
                    .number({ invalid_type_error: `${field.label} must be a number` })
                    .refine((n) => !Number.isNaN(n), `${field.label} must be a number`)
                    .refine((n) => min === undefined || n >= min, `${field.label} must be >= ${min}`)
                    .refine((n) => max === undefined || n <= max, `${field.label} must be <= ${max}`),
            );
            if (required) return inner;
            return inner.optional();
        }
        case 'select': {
            const options = (field as { options: string[] }).options;
            const enumSchema = z.enum(options as [string, ...string[]]);
            // Allow empty string when not required.
            return required
                ? enumSchema
                : z.union([z.literal(''), enumSchema]).optional().default('');
        }
        default:
            return optionalText();
    }
};

// ─── Section-level Zod ──────────────────────────────────────────────────────

const buildHeaderSchema = (section: HeaderSection): ZodTypeAny => {
    const shape: Record<string, ZodTypeAny> = {};
    for (const f of section.fields) {
        shape[f.key] = buildFieldSchema(f);
    }
    return z.object(shape);
};

const buildFieldsSectionSchema = (section: FieldsSection): ZodTypeAny => {
    const shape: Record<string, ZodTypeAny> = {};
    for (const f of section.fields) {
        shape[f.key] = buildFieldSchema(f);
    }
    return z.object(shape);
};

const buildChecklistSchema = (section: ChecklistSection): ZodTypeAny => {
    const shape: Record<string, ZodTypeAny> = {};
    for (const item of section.items) {
        const result = buildFieldSchema({
            ...item.result,
            key: 'result',
            label: item.result.label || `${item.particular} - Result`,
        } as Field);
        const remarks = item.remarks
            ? buildFieldSchema({
                  ...item.remarks,
                  key: 'remarks',
                  label: item.remarks.label || `${item.particular} - Remarks`,
              } as Field)
            : optionalText();
        shape[item.id] = z.object({ result, remarks });
    }
    return z.object(shape);
};

const buildTraineesDataTableSchema = (section: TraineesDataTableSection): ZodTypeAny => {
    const rowShape: Record<string, ZodTypeAny> = {};
    for (const col of section.columns) {
        rowShape[col.key] = buildFieldSchema({ ...col, bind: undefined } as Field);
    }
    const rowSchema = z.object(rowShape);
    const minRows = Math.max(1, section.minRows ?? 1);
    const maxRows = section.maxRows ?? 100;
    return z
        .array(rowSchema)
        .min(minRows, `At least ${minRows} row(s) required`)
        .max(maxRows, `No more than ${maxRows} rows allowed`);
};

const buildImageSectionSchema = (section: ImageAttachmentsSection): ZodTypeAny => {
    const shape: Record<string, ZodTypeAny> = {};
    for (const slot of section.slots) {
        const arr = z.array(z.string());
        shape[slot.key] = slot.required
            ? arr.min(1, `${slot.label} requires at least one image`)
            : arr.optional().default([]);
    }
    return z.object(shape);
};

/** Build a Zod schema covering all input-bearing sections in `sections`.
 *  Returns z.object({ <section.id>: ..., ... }). Sections without inputs are skipped. */
export const buildSchemaForSections = (sections: Section[]): z.ZodObject<any> => {
    const shape: Record<string, ZodTypeAny> = {};
    for (const s of sections) {
        switch (s.type) {
            case 'header':
                shape[s.id] = buildHeaderSchema(s);
                break;
            case 'fields':
                shape[s.id] = buildFieldsSectionSchema(s);
                break;
            case 'checklist':
                shape[s.id] = buildChecklistSchema(s);
                break;
            case 'image_attachments':
                // Image attachments are stored under top-level `attachments` not under `responses`,
                // so we treat them as a sibling top-level key per slot section.
                shape[s.id] = buildImageSectionSchema(s);
                break;
            case 'trainees_data_table':
                shape[s.id] = buildTraineesDataTableSchema(s);
                break;
            case 'process':
            case 'signatures':
                break;
        }
    }
    return z.object(shape);
};

/** Schema for one wizard step — covers only the sections referenced by the step. */
export const buildSchemaForStep = (
    template: ReportTemplate,
    step: WizardStepDef,
): z.ZodObject<any> => {
    const sectionsById = new Map(template.sections.map((s) => [s.id, s]));
    const stepSections = step.sections.map((id) => sectionsById.get(id)!).filter(Boolean);
    return buildSchemaForSections(stepSections);
};

/** Full schema across the whole template — used at Submit. */
export const buildSchemaForTemplate = (template: ReportTemplate): z.ZodObject<any> => {
    return buildSchemaForSections(template.sections);
};

/** A single validation error mapped to an RHF dot-path. */
export interface StepValidationError {
    path: string;
    message: string;
}

/** Validates the form values covered by a single step against the per-field Zod
 *  schemas built from the template, returning errors keyed by RHF dot-path so
 *  `form.setError(path, { message })` can render them inline.
 *
 *  We can't use a static RHF resolver here because (a) the resolver shape would
 *  have to switch per step, and (b) the section schemas in `buildSchemaForSections`
 *  are rooted at section ids which don't match the actual form value paths
 *  (`responses.<section>.<field>` for inputs vs `attachments.<slot>` for images).
 */
export const validateStep = (
    template: ReportTemplate,
    step: WizardStepDef,
    formValues: { responses?: Record<string, unknown>; attachments?: Record<string, unknown> },
): StepValidationError[] => {
    const errors: StepValidationError[] = [];
    const sectionsById = new Map(template.sections.map((s) => [s.id, s]));
    const responses = formValues.responses || {};
    const attachments = formValues.attachments || {};

    const runField = (fieldDef: Field, value: unknown, path: string) => {
        const schema = buildFieldSchema(fieldDef);
        const result = schema.safeParse(value);
        if (!result.success) {
            errors.push({ path, message: result.error.issues[0]?.message || 'Invalid value' });
        }
    };

    for (const sid of step.sections) {
        const section = sectionsById.get(sid);
        if (!section) continue;
        switch (section.type) {
            case 'header':
            case 'fields': {
                const sectionValues = (responses[sid] || {}) as Record<string, unknown>;
                for (const f of section.fields) {
                    if (f.readonly) continue;
                    runField(f, sectionValues[f.key], `responses.${sid}.${f.key}`);
                }
                break;
            }
            case 'checklist': {
                const sectionValues = (responses[sid] || {}) as Record<
                    string,
                    { result?: unknown; remarks?: unknown } | undefined
                >;
                for (const item of section.items) {
                    const v = sectionValues[item.id] || {};
                    runField(
                        { ...item.result, key: 'result', label: item.result.label || item.particular } as Field,
                        v.result,
                        `responses.${sid}.${item.id}.result`,
                    );
                    if (item.remarks) {
                        runField(
                            { ...item.remarks, key: 'remarks', label: item.remarks.label || 'Remarks' } as Field,
                            v.remarks,
                            `responses.${sid}.${item.id}.remarks`,
                        );
                    }
                }
                break;
            }
            case 'image_attachments': {
                for (const slot of section.slots) {
                    if (!slot.required) continue;
                    const items = attachments[slot.key];
                    if (!Array.isArray(items) || items.length === 0) {
                        errors.push({
                            path: `attachments.${slot.key}`,
                            message: `${slot.label} requires at least one image`,
                        });
                    }
                }
                break;
            }
            case 'trainees_data_table': {
                const rows = (responses[sid] || []) as unknown[];
                const minRows = Math.max(1, section.minRows ?? 1);
                const maxRows = section.maxRows ?? 100;
                if (!Array.isArray(rows) || rows.length < minRows) {
                    errors.push({
                        path: `responses.${sid}`,
                        message: `At least ${minRows} row(s) required`,
                    });
                    break;
                }
                if (rows.length > maxRows) {
                    errors.push({
                        path: `responses.${sid}`,
                        message: `No more than ${maxRows} rows allowed`,
                    });
                }
                rows.forEach((row, idx) => {
                    for (const col of section.columns) {
                        const fieldDef = { ...col, bind: undefined } as Field;
                        const value = (row as Record<string, unknown> | undefined)?.[col.key];
                        runField(fieldDef, value, `responses.${sid}.${idx}.${col.key}`);
                    }
                });
                break;
            }
            case 'process':
            case 'signatures':
                break;
        }
    }
    return errors;
};

/** Validates the entire template (all input-bearing sections), used at Submit. */
export const validateTemplate = (
    template: ReportTemplate,
    formValues: { responses?: Record<string, unknown>; attachments?: Record<string, unknown> },
): StepValidationError[] => {
    const allSectionsStep: WizardStepDef = {
        key: '_all',
        title: '_all',
        sections: template.sections.map((s) => s.id),
    };
    return validateStep(template, allSectionsStep, formValues);
};

/** Returns the dot-path RHF field keys covered by a single step. Used by
 *  `form.trigger(stepKeys)` to validate just the current step on Next. */
export const getRhfKeysForStep = (template: ReportTemplate, step: WizardStepDef): string[] => {
    const sectionsById = new Map(template.sections.map((s) => [s.id, s]));
    const out: string[] = [];
    for (const sid of step.sections) {
        const s = sectionsById.get(sid);
        if (!s) continue;
        switch (s.type) {
            case 'header':
            case 'fields':
                for (const f of s.fields) out.push(`responses.${s.id}.${f.key}`);
                break;
            case 'checklist':
                for (const item of s.items) {
                    out.push(`responses.${s.id}.${item.id}.result`);
                    out.push(`responses.${s.id}.${item.id}.remarks`);
                }
                break;
            case 'image_attachments':
                for (const slot of s.slots) out.push(`attachments.${slot.key}`);
                break;
            case 'trainees_data_table':
                // The whole array is validated as one path; per-row keys are dynamic.
                out.push(`responses.${s.id}`);
                break;
            case 'process':
            case 'signatures':
                break;
        }
    }
    return out;
};
