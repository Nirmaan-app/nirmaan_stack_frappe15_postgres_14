// Parses + validates raw template JSON into the typed ReportTemplate shape.
// Used by:
//   - useReportTemplate (wizard mount): friendly error if admin shipped bad JSON
//   - The master CRUD's "Validate JSON" button (Phase 6)
// Both validation errors are surfaced via TemplateValidationError; never throws.

import { FIELD_TYPES, REVIEW_STEP_KEY, SECTION_TYPES } from './constants';
import { isAllowedBinding } from './prefill/bindings';
import type {
    Field,
    ReportTemplate,
    Section,
    TemplateValidationError,
    WizardStepDef,
} from './types';

export type ParseResult =
    | { ok: true; template: ReportTemplate; warnings: string[] }
    | { ok: false; errors: TemplateValidationError[] };

const err = (
    code: TemplateValidationError['code'],
    message: string,
    path?: string,
): TemplateValidationError => ({ code, message, path });

/** Generates a default wizard-steps array (one per section + Review). */
export const synthesizeWizardSteps = (sections: Section[]): WizardStepDef[] => {
    const steps: WizardStepDef[] = sections.map((s) => ({
        key: s.id,
        title: s.title || s.id,
        sections: [s.id],
    }));
    steps.push({ key: REVIEW_STEP_KEY, title: 'Review', sections: [] });
    return steps;
};

const validateField = (
    f: unknown,
    path: string,
    errors: TemplateValidationError[],
): f is Field => {
    if (typeof f !== 'object' || f === null) {
        errors.push(err('invalid_type', `${path}: field must be an object`, path));
        return false;
    }
    const obj = f as Record<string, unknown>;
    if (typeof obj.key !== 'string' || !obj.key.trim()) {
        errors.push(err('missing_field', `${path}.key required`, path));
        return false;
    }
    if (typeof obj.label !== 'string' || !obj.label.trim()) {
        errors.push(err('missing_field', `${path}.label required`, path));
        return false;
    }
    if (!FIELD_TYPES.includes(obj.type as Field['type'])) {
        errors.push(err('invalid_type', `${path}.type must be one of ${FIELD_TYPES.join('|')}`, path));
        return false;
    }
    if (obj.type === 'select') {
        const options = obj.options;
        if (!Array.isArray(options) || options.length === 0) {
            errors.push(err('missing_field', `${path}.options required for select`, path));
            return false;
        }
    }
    if (obj.bind !== undefined && obj.bind !== null && obj.bind !== '') {
        if (typeof obj.bind !== 'string' || !isAllowedBinding(obj.bind)) {
            errors.push(err('invalid_type', `${path}.bind "${obj.bind}" is not in the allowlist`, path));
            return false;
        }
    }
    return true;
};

const validateSection = (
    section: unknown,
    index: number,
    errors: TemplateValidationError[],
): section is Section => {
    if (typeof section !== 'object' || section === null) {
        errors.push(err('invalid_type', `sections[${index}]: must be an object`, `sections[${index}]`));
        return false;
    }
    const obj = section as Record<string, unknown>;
    const path = `sections[${index}]`;
    if (typeof obj.id !== 'string' || !obj.id.trim()) {
        errors.push(err('missing_field', `${path}.id required`, path));
        return false;
    }
    if (!SECTION_TYPES.includes(obj.type as Section['type'])) {
        errors.push(err('invalid_type', `${path}.type must be one of ${SECTION_TYPES.join('|')}`, path));
        return false;
    }

    switch (obj.type) {
        case 'process':
            if (!Array.isArray(obj.blocks)) {
                errors.push(err('missing_field', `${path}.blocks required`, path));
                return false;
            }
            return true;

        case 'header':
        case 'fields': {
            if (!Array.isArray(obj.fields) || obj.fields.length === 0) {
                errors.push(err('missing_field', `${path}.fields required (non-empty)`, path));
                return false;
            }
            const fieldKeys = new Set<string>();
            for (let i = 0; i < obj.fields.length; i++) {
                if (!validateField(obj.fields[i], `${path}.fields[${i}]`, errors)) return false;
                const k = (obj.fields[i] as Field).key;
                if (fieldKeys.has(k)) {
                    errors.push(err('duplicate_id', `${path}.fields[${i}].key "${k}" duplicated`, path));
                    return false;
                }
                fieldKeys.add(k);
            }
            return true;
        }

        case 'checklist': {
            if (!Array.isArray(obj.columns) || obj.columns.length === 0) {
                errors.push(err('missing_field', `${path}.columns required`, path));
                return false;
            }
            if (!Array.isArray(obj.items) || obj.items.length === 0) {
                errors.push(err('missing_field', `${path}.items required (non-empty)`, path));
                return false;
            }
            const ids = new Set<string>();
            for (let i = 0; i < obj.items.length; i++) {
                const item = obj.items[i] as Record<string, unknown>;
                if (typeof item?.id !== 'string' || !item.id.trim()) {
                    errors.push(
                        err('missing_field', `${path}.items[${i}].id required`, `${path}.items[${i}]`),
                    );
                    return false;
                }
                if (ids.has(item.id)) {
                    errors.push(
                        err('duplicate_id', `${path}.items[${i}].id "${item.id}" duplicated`, path),
                    );
                    return false;
                }
                ids.add(item.id);
                if (typeof item.particular !== 'string') {
                    errors.push(
                        err('missing_field', `${path}.items[${i}].particular required`, `${path}.items[${i}]`),
                    );
                    return false;
                }
                if (!validateField(
                    { ...((item.result as object) || {}), key: 'result', label: 'Result' },
                    `${path}.items[${i}].result`, errors,
                )) return false;
                if (item.remarks && !validateField(
                    { ...((item.remarks as object) || {}), key: 'remarks', label: 'Remarks' },
                    `${path}.items[${i}].remarks`, errors,
                )) return false;
            }
            return true;
        }

        case 'image_attachments': {
            if (!Array.isArray(obj.slots) || obj.slots.length === 0) {
                errors.push(err('missing_field', `${path}.slots required (non-empty)`, path));
                return false;
            }
            const slotKeys = new Set<string>();
            for (let i = 0; i < obj.slots.length; i++) {
                const slot = obj.slots[i] as Record<string, unknown>;
                if (typeof slot?.key !== 'string' || !slot.key.trim()) {
                    errors.push(err('missing_field', `${path}.slots[${i}].key required`, `${path}.slots[${i}]`));
                    return false;
                }
                if (typeof slot.label !== 'string') {
                    errors.push(err('missing_field', `${path}.slots[${i}].label required`, `${path}.slots[${i}]`));
                    return false;
                }
                if (slotKeys.has(slot.key)) {
                    errors.push(err('duplicate_id', `${path}.slots[${i}].key "${slot.key}" duplicated`, path));
                    return false;
                }
                slotKeys.add(slot.key);
            }
            return true;
        }

        case 'signatures': {
            if (!Array.isArray(obj.blocks) || obj.blocks.length === 0) {
                errors.push(err('missing_field', `${path}.blocks required (non-empty)`, path));
                return false;
            }
            return true;
        }

        default:
            errors.push(err('invalid_type', `${path}.type unsupported`, path));
            return false;
    }
};

export const parseTemplate = (raw: string): ParseResult => {
    if (!raw || !raw.trim()) {
        return { ok: false, errors: [err('invalid_json', 'Source format is empty')] };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return { ok: false, errors: [err('invalid_json', `Invalid JSON: ${(e as Error).message}`)] };
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return { ok: false, errors: [err('invalid_type', 'Top-level must be an object')] };
    }
    const obj = parsed as Record<string, unknown>;
    const errors: TemplateValidationError[] = [];
    const warnings: string[] = [];

    if (typeof obj.templateId !== 'string' || !obj.templateId.trim()) {
        errors.push(err('missing_field', '`templateId` required'));
    }
    if (typeof obj.templateVersion !== 'number' || obj.templateVersion < 1) {
        errors.push(err('missing_field', '`templateVersion` must be an integer >= 1'));
    }
    if (typeof obj.title !== 'string' || !obj.title.trim()) {
        errors.push(err('missing_field', '`title` required'));
    }
    if (!Array.isArray(obj.sections) || obj.sections.length === 0) {
        errors.push(err('missing_field', '`sections` required (non-empty array)'));
        return { ok: false, errors };
    }

    const sectionIds = new Set<string>();
    for (let i = 0; i < obj.sections.length; i++) {
        if (!validateSection(obj.sections[i], i, errors)) {
            // continue to collect more errors but mark template invalid
            continue;
        }
        const sId = (obj.sections[i] as Section).id;
        if (sectionIds.has(sId)) {
            errors.push(err('duplicate_id', `sections[${i}].id "${sId}" duplicated`));
        }
        sectionIds.add(sId);
    }

    // Validate wizardSteps if present.
    if (obj.wizardSteps !== undefined) {
        if (!Array.isArray(obj.wizardSteps)) {
            errors.push(err('invalid_type', '`wizardSteps` must be an array'));
        } else {
            const stepKeys = new Set<string>();
            for (let i = 0; i < obj.wizardSteps.length; i++) {
                const s = obj.wizardSteps[i] as Record<string, unknown>;
                if (typeof s?.key !== 'string' || !s.key.trim()) {
                    errors.push(err('missing_field', `wizardSteps[${i}].key required`));
                    continue;
                }
                if (stepKeys.has(s.key)) {
                    errors.push(err('duplicate_id', `wizardSteps[${i}].key "${s.key}" duplicated`));
                }
                stepKeys.add(s.key);
                if (typeof s.title !== 'string') {
                    errors.push(err('missing_field', `wizardSteps[${i}].title required`));
                }
                if (!Array.isArray(s.sections)) {
                    errors.push(err('missing_field', `wizardSteps[${i}].sections required (use [] for Review)`));
                } else {
                    for (const refId of s.sections) {
                        if (typeof refId !== 'string' || !sectionIds.has(refId)) {
                            errors.push(
                                err('invalid_type', `wizardSteps[${i}].sections references unknown id "${refId}"`),
                            );
                        }
                    }
                }
            }
        }
    }

    if (errors.length > 0) return { ok: false, errors };

    const template = parsed as ReportTemplate;
    if (!template.wizardSteps) {
        template.wizardSteps = synthesizeWizardSteps(template.sections);
        warnings.push('wizardSteps was synthesized (one step per section + Review)');
    }
    return { ok: true, template, warnings };
};

/** Stable canonical JSON for hashing — must match the backend serializer. */
export const canonicalJson = (obj: unknown): string => {
    return JSON.stringify(obj, sortReplacer);
};

const sortReplacer = (_key: string, value: unknown): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(value as object).sort()) {
            sorted[k] = (value as Record<string, unknown>)[k];
        }
        return sorted;
    }
    return value;
};
