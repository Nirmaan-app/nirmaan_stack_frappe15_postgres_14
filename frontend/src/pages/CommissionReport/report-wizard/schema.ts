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
    MeasurementMatrixSection,
    RepeatingGroupsSection,
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
        case 'image': {
            // AttachmentRecord shape: { file_url, file_name, file_doc? }
            // Stored inline in the row's column value (not under top-level attachments).
            const record = z.object({
                file_url: z.string().min(1),
                file_name: z.string(),
                file_doc: z.string().optional(),
            });
            // An empty/blank cell can arrive as "" (string), null, or undefined — all mean "no image".
            const normalizeEmptyImage = (v: unknown) =>
                v && typeof v === 'object' ? v : undefined;
            return required
                ? z.preprocess(
                      normalizeEmptyImage,
                      record.refine((v) => !!v && !!v.file_url, `${field.label} is required`),
                  )
                : z.preprocess(normalizeEmptyImage, record.optional());
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

const buildRepeatingGroupsSchema = (section: RepeatingGroupsSection): ZodTypeAny => {
    // Per-group object schema: groupFields (flat) + optional rowsTable rows
    // + optional nestedSections per group.
    const groupShape: Record<string, ZodTypeAny> = {};
    for (const f of section.groupFields) {
        groupShape[f.key] = buildFieldSchema(f);
    }
    if (section.rowsTable) {
        const rowShape: Record<string, ZodTypeAny> = {};
        for (const col of section.rowsTable.columns) {
            rowShape[col.key] = buildFieldSchema({ ...col, bind: undefined } as Field);
        }
        groupShape.rows = z
            .array(z.object(rowShape))
            .min(
                Math.max(1, section.rowsTable.minRows ?? 1),
                `At least ${Math.max(1, section.rowsTable.minRows ?? 1)} row(s) required per group`,
            )
            .max(section.rowsTable.maxRows ?? 100, `Too many rows in a group`);
    }
    if (section.nestedSections) {
        // Each nested section's schema is attached under the section's own id.
        const nestedShape = buildSchemaForSections(section.nestedSections);
        for (const [k, v] of Object.entries(nestedShape.shape)) {
            groupShape[k] = v as ZodTypeAny;
        }
    }
    return z.array(z.object(groupShape)).min(1, 'At least one group required');
};

const buildMeasurementMatrixSchema = (section: MeasurementMatrixSection): ZodTypeAny => {
    const rowShape: Record<string, ZodTypeAny> = {
        id: z.string(),
    };
    for (const col of section.columns) {
        rowShape[col.key] = buildFieldSchema({ ...col, bind: undefined } as Field);
    }
    const rowSchema = z.object(rowShape);
    const rowCount = section.rows.length;
    return z.array(rowSchema).length(rowCount, `Expected ${rowCount} row(s)`);
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
            case 'measurement_matrix':
                shape[s.id] = buildMeasurementMatrixSchema(s);
                break;
            case 'repeating_groups':
                shape[s.id] = buildRepeatingGroupsSchema(s);
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
                for (const f of section.fields) {
                    if (f.type !== 'date') continue;
                    const m = /^(.*)_start_date$/.exec(f.key);
                    if (!m) continue;
                    const endKey = `${m[1]}_end_date`;
                    const endField = section.fields.find((x) => x.key === endKey && x.type === 'date');
                    if (!endField) continue;
                    const start = sectionValues[f.key];
                    const end = sectionValues[endKey];
                    if (typeof start !== 'string' || typeof end !== 'string') continue;
                    if (!start || !end) continue;
                    if (start > end) {
                        errors.push({
                            path: `responses.${sid}.${endKey}`,
                            message: `${endField.label} must be on or after ${f.label}`,
                        });
                    }
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

                // Earth Pit Resistance Report: the Parameters table's row count
                // must match `Number of Earth Pits` from the Header step. The
                // wizard auto-seeds rows on growth; reduction is manual, so we
                // block Next/Submit until the user deletes the extras.
                if (
                    template.templateId === 'earth-pit-resistance-report' &&
                    sid === 'parameters'
                ) {
                    const hdrResponses = (responses['hdr'] || {}) as Record<string, unknown>;
                    const declared = Number(hdrResponses['num_earth_pits']);
                    if (Number.isFinite(declared) && declared > 0 && rows.length > declared) {
                        const extra = rows.length - declared;
                        errors.push({
                            path: `responses.${sid}`,
                            message: `Header says ${declared} earth pit(s) but you have ${rows.length}. Either remove ${extra} unwanted earth pit(s) here, or increase Number of Earth Pits in the Header step.`,
                        });
                    }
                }

                // LT Cable Megger Test Report: each row must pick a unique
                // `cable_size`. We flag every offending row so the user can
                // see which ones collide. Scoped to the template that needs
                // this constraint; safely no-op elsewhere.
                if (template.templateId === 'lt-cable-megger-test-report') {
                    const hasCableSizeCol = section.columns.some((c) => c.key === 'cable_size');
                    if (hasCableSizeCol) {
                        const seenAt = new Map<string, number[]>();
                        rows.forEach((row, idx) => {
                            const v = (row as Record<string, unknown> | undefined)?.['cable_size'];
                            if (typeof v !== 'string' || !v.trim()) return;
                            const k = v.trim();
                            const arr = seenAt.get(k) || [];
                            arr.push(idx);
                            seenAt.set(k, arr);
                        });
                        for (const [, idxs] of seenAt) {
                            if (idxs.length <= 1) continue;
                            for (const idx of idxs) {
                                errors.push({
                                    path: `responses.${sid}.${idx}.cable_size`,
                                    message: 'Each cable can only be tested once — pick a unique cable size.',
                                });
                            }
                        }
                    }
                }
                break;
            }
            case 'measurement_matrix': {
                const rows = (responses[sid] || []) as unknown[];
                section.rows.forEach((rowDef, idx) => {
                    const row = (Array.isArray(rows) ? rows[idx] : undefined) as
                        | Record<string, unknown>
                        | undefined;
                    for (const col of section.columns) {
                        const fieldDef = {
                            ...col,
                            bind: undefined,
                            label: rowDef.labels[col.key] || col.label,
                        } as Field;
                        runField(fieldDef, row?.[col.key], `responses.${sid}.${idx}.${col.key}`);
                    }
                });
                break;
            }
            case 'repeating_groups': {
                const groups = (responses[sid] || []) as unknown[];
                if (!Array.isArray(groups) || groups.length === 0) {
                    errors.push({
                        path: `responses.${sid}`,
                        message: 'At least one group required',
                    });
                    break;
                }
                // If the wizard step is a synthetic per-group slice, validate
                // only that group. Otherwise validate every group (used by
                // validateTemplate at submit time, where step.groupSlice is
                // unset).
                const sliceIdx =
                    step.groupSlice && step.groupSlice.sectionId === sid
                        ? step.groupSlice.groupIndex
                        : null;
                const indices: number[] =
                    sliceIdx !== null && sliceIdx < groups.length
                        ? [sliceIdx]
                        : groups.map((_, i) => i);
                indices.forEach((gIdx) => {
                    const g = groups[gIdx];
                    const group = (g as Record<string, unknown> | undefined) || {};
                    // Flat groupFields
                    for (const f of section.groupFields) {
                        if (f.readonly) continue;
                        runField(f, group[f.key], `responses.${sid}.${gIdx}.${f.key}`);
                    }
                    // Optional rowsTable
                    if (section.rowsTable) {
                        const rows = Array.isArray(group.rows) ? (group.rows as unknown[]) : [];
                        const minR = Math.max(1, section.rowsTable.minRows ?? 1);
                        const maxR = section.rowsTable.maxRows ?? 100;
                        if (rows.length < minR) {
                            errors.push({
                                path: `responses.${sid}.${gIdx}.rows`,
                                message: `Group ${gIdx + 1}: at least ${minR} row(s) required`,
                            });
                            return;
                        }
                        if (rows.length > maxR) {
                            errors.push({
                                path: `responses.${sid}.${gIdx}.rows`,
                                message: `Group ${gIdx + 1}: no more than ${maxR} rows allowed`,
                            });
                        }
                        rows.forEach((row, rIdx) => {
                            for (const col of section.rowsTable!.columns) {
                                const fieldDef = { ...col, bind: undefined } as Field;
                                const value = (row as Record<string, unknown> | undefined)?.[col.key];
                                runField(
                                    fieldDef,
                                    value,
                                    `responses.${sid}.${gIdx}.rows.${rIdx}.${col.key}`,
                                );
                            }
                        });
                    }
                    // Optional nestedSections — each section's data is stored
                    // under `group[<nested.id>]`. We validate per nested section
                    // by emitting paths under `responses.${sid}.${gIdx}.${nested.id}`.
                    if (section.nestedSections) {
                        for (const nested of section.nestedSections) {
                            const nestedVals =
                                (group[nested.id] as Record<string, unknown> | undefined) || {};
                            if (nested.type === 'header' || nested.type === 'fields') {
                                for (const f of nested.fields) {
                                    if (f.readonly) continue;
                                    runField(
                                        f,
                                        nestedVals[f.key],
                                        `responses.${sid}.${gIdx}.${nested.id}.${f.key}`,
                                    );
                                }
                            } else if (nested.type === 'checklist') {
                                for (const item of nested.items) {
                                    const itemVals =
                                        (nestedVals[item.id] as Record<string, unknown> | undefined) || {};
                                    runField(
                                        {
                                            ...item.result,
                                            key: 'result',
                                            label: item.result.label || item.particular,
                                        } as Field,
                                        itemVals.result,
                                        `responses.${sid}.${gIdx}.${nested.id}.${item.id}.result`,
                                    );
                                    if (item.remarks) {
                                        runField(
                                            {
                                                ...item.remarks,
                                                key: 'remarks',
                                                label: item.remarks.label || 'Remarks',
                                            } as Field,
                                            itemVals.remarks,
                                            `responses.${sid}.${gIdx}.${nested.id}.${item.id}.remarks`,
                                        );
                                    }
                                }
                            }
                            // process / signatures / image_attachments etc. nested
                            // sections have no per-group inputs to validate.
                        }
                    }
                });
                // Header-driven count guard: if countBoundTo points at a numeric
                // header field, group count must match. Mismatch blocks Next/Submit
                // until the user adjusts (same UX as Earth Pit). Skip on synthetic
                // per-group slices — the user's local validation shouldn't fail
                // because of an unrelated other group; the guard re-runs at
                // submit (validateTemplate has step.groupSlice undefined).
                if (section.countBoundTo && sliceIdx === null) {
                    const declaredRaw = section.countBoundTo
                        .split('.')
                        .reduce<unknown>((acc, k) => {
                            if (acc && typeof acc === 'object') {
                                return (acc as Record<string, unknown>)[k];
                            }
                            return undefined;
                        }, formValues);
                    const declared = Number(declaredRaw);
                    if (Number.isFinite(declared) && declared > 0 && groups.length > declared) {
                        const extra = groups.length - declared;
                        errors.push({
                            path: `responses.${sid}`,
                            message: `Header says ${declared} group(s) but you have ${groups.length}. Either remove ${extra} group(s) here, or increase the header count.`,
                        });
                    }
                }
                break;
            }
            case 'process':
            case 'signatures':
                break;
        }
    }
    return errors;
};

/** Resolve a dot-path inside an object — used to evaluate `visibleIf.field`. */
const getByPath = (obj: unknown, path: string): unknown => {
    if (!obj || !path) return undefined;
    return path.split('.').reduce<unknown>((acc, k) => {
        if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k];
        return undefined;
    }, obj);
};

/** A wizard step is visible when its `visibleIf` (if any) matches the current form values. */
const isStepVisible = (
    step: WizardStepDef,
    formValues: { responses?: Record<string, unknown>; attachments?: Record<string, unknown> },
): boolean => {
    if (!step.visibleIf) return true;
    const v = getByPath(formValues, step.visibleIf.field);
    if (step.visibleIf.in !== undefined) return step.visibleIf.in.includes(v as string);
    if (step.visibleIf.equals !== undefined) return v === step.visibleIf.equals;
    return true;
};

/** Validates the entire template (all input-bearing sections), used at Submit.
 *  Sections referenced ONLY by wizard steps hidden via `visibleIf` are skipped. */
export const validateTemplate = (
    template: ReportTemplate,
    formValues: { responses?: Record<string, unknown>; attachments?: Record<string, unknown> },
): StepValidationError[] => {
    // Determine which section ids belong to visible wizard steps.
    let sectionIdsToValidate: string[];
    if (template.wizardSteps && template.wizardSteps.length > 0) {
        const visibleIds = new Set<string>();
        for (const step of template.wizardSteps) {
            if (!isStepVisible(step, formValues)) continue;
            for (const sid of step.sections) visibleIds.add(sid);
        }
        sectionIdsToValidate = template.sections
            .map((s) => s.id)
            .filter((id) => visibleIds.has(id));
    } else {
        sectionIdsToValidate = template.sections.map((s) => s.id);
    }
    const allSectionsStep: WizardStepDef = {
        key: '_all',
        title: '_all',
        sections: sectionIdsToValidate,
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
            case 'measurement_matrix':
                // Same array-path strategy as trainees_data_table.
                out.push(`responses.${s.id}`);
                break;
            case 'repeating_groups':
                // For a synthetic per-group step, narrow to that group's path
                // so error-clearing on Next only touches the relevant slice.
                if (step.groupSlice && step.groupSlice.sectionId === s.id) {
                    out.push(`responses.${s.id}.${step.groupSlice.groupIndex}`);
                } else {
                    out.push(`responses.${s.id}`);
                }
                break;
            case 'process':
            case 'signatures':
                break;
        }
    }
    return out;
};
