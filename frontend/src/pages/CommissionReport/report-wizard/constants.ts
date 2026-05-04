// Constants shared across the report wizard subsystem.

import type { SectionType, FieldType } from './types';

export const SECTION_TYPES: readonly SectionType[] = [
    'process',
    'header',
    'checklist',
    'image_attachments',
    'fields',
    'signatures',
] as const;

export const FIELD_TYPES: readonly FieldType[] = [
    'text',
    'textarea',
    'number',
    'date',
    'select',
] as const;

export const REVIEW_STEP_KEY = 'review';
export const DEFAULT_REVIEW_STEP_TITLE = 'Review';

/** Sections that contribute to `response_data.responses[section.id]`. */
export const INPUT_SECTION_TYPES: readonly SectionType[] = ['header', 'checklist', 'fields'] as const;

export const isInputSection = (type: SectionType): boolean =>
    INPUT_SECTION_TYPES.includes(type);
