// Pure resolver: given a parsed template + a prefill dict + (optionally) any
// existing response, returns the initial form values keyed by section.id.
//
// Resolution order for each field:
//   1. Existing response value (edit/view mode)
//   2. `bind` → prefillDict[bind]
//   3. `default` (static)
//   4. type-appropriate empty (text → "", number → "", date → "")
//
// Snapshot semantics (Decision E): bindings are read once at fill time.
// Once a value lands in `response_data.responses`, future renders use it as-is
// even if the project (and therefore the underlying prefill dict) changes.

import type {
    Field,
    PrefillSnapshot,
    ReportTemplate,
    ResponseData,
    Section,
} from '../types';
import { isAllowedBinding } from './bindings';

export type FormValues = Record<string, Record<string, unknown>>;

interface ResolveOpts {
    template: ReportTemplate;
    prefillDict: PrefillSnapshot;
    existingResponse?: ResponseData | null;
}

const emptyForType = (f: Pick<Field, 'type'>): unknown => {
    switch (f.type) {
        case 'number':
            return '';
        case 'date':
            return '';
        case 'select':
        case 'text':
        case 'textarea':
        default:
            return '';
    }
};

const resolveFieldValue = (
    field: Field,
    sectionResponses: Record<string, unknown> | undefined,
    prefillDict: PrefillSnapshot,
): unknown => {
    // 1. Existing response wins.
    const existing = sectionResponses?.[field.key];
    if (existing !== undefined && existing !== null && existing !== '') {
        return existing;
    }
    // 2. Bind from project prefill.
    if (field.bind && isAllowedBinding(field.bind)) {
        const v = prefillDict[field.bind];
        if (v !== undefined && v !== null && v !== '') return v;
    }
    // 3. Static default.
    if (field.default !== undefined && field.default !== null && field.default !== '') {
        return field.default;
    }
    // 4. Empty.
    return emptyForType(field);
};

export const resolveInitialValues = ({
    template,
    prefillDict,
    existingResponse,
}: ResolveOpts): FormValues => {
    const out: FormValues = {};
    const existingResponses = existingResponse?.responses || {};

    for (const section of template.sections) {
        const existing = existingResponses[section.id] as Record<string, unknown> | undefined;
        switch (section.type) {
            case 'header':
            case 'fields': {
                const sectionOut: Record<string, unknown> = {};
                for (const field of section.fields) {
                    sectionOut[field.key] = resolveFieldValue(field, existing, prefillDict);
                }
                out[section.id] = sectionOut;
                break;
            }
            case 'checklist': {
                const sectionOut: Record<string, { result?: unknown; remarks?: unknown }> = {};
                for (const item of section.items) {
                    const existingItem =
                        (existing?.[item.id] as { result?: unknown; remarks?: unknown }) || undefined;
                    // Build pseudo-fields with synthetic keys to reuse resolver.
                    const resultField = {
                        ...item.result,
                        key: 'result',
                        label: item.result.label || 'Result',
                    } as Field;
                    const remarksField = item.remarks
                        ? ({ ...item.remarks, key: 'remarks', label: item.remarks.label || 'Remarks' } as Field)
                        : null;
                    sectionOut[item.id] = {
                        result: resolveFieldValue(resultField, existingItem, prefillDict),
                        remarks: remarksField
                            ? resolveFieldValue(remarksField, existingItem, prefillDict)
                            : '',
                    };
                }
                out[section.id] = sectionOut;
                break;
            }
            case 'process':
            case 'image_attachments':
            case 'signatures':
                // No form values for these.
                break;
            default: {
                const _exhaustive: never = section;
                void _exhaustive;
            }
        }
    }
    return out;
};

/** Returns only the prefill keys actually consumed by `template.bind` declarations.
 *  This is what gets frozen into `response_data.prefillSnapshot`. */
export const collectUsedPrefillKeys = (template: ReportTemplate): string[] => {
    const seen = new Set<string>();
    const visitField = (f: Pick<Field, 'bind'>) => {
        if (f.bind && isAllowedBinding(f.bind)) seen.add(f.bind);
    };
    const visitSection = (section: Section) => {
        switch (section.type) {
            case 'header':
            case 'fields':
                section.fields.forEach(visitField);
                break;
            case 'checklist':
                section.items.forEach((item) => {
                    visitField(item.result as Pick<Field, 'bind'>);
                    if (item.remarks) visitField(item.remarks as Pick<Field, 'bind'>);
                });
                break;
            case 'process':
            case 'image_attachments':
            case 'signatures':
                break;
        }
    };
    template.sections.forEach(visitSection);
    return Array.from(seen);
};

/** Subset of `prefillDict` containing only keys used by `template`. */
export const buildPrefillSnapshot = (
    template: ReportTemplate,
    prefillDict: PrefillSnapshot,
): PrefillSnapshot => {
    const used = collectUsedPrefillKeys(template);
    const out: PrefillSnapshot = {};
    for (const key of used) {
        if (prefillDict[key] !== undefined) out[key] = prefillDict[key];
    }
    return out;
};
