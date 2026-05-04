// Template + response type system for the commissioning report wizard.
// Authoring grammar reference: frontend/.claude/context/domain/commissioning-report-templates.md

// ─── Field-level shapes (used inside header + fields + checklist items) ───────

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select';

export interface BaseField {
    key: string;
    label: string;
    required?: boolean;
    readonly?: boolean;
    /** Static default value used when neither an existing response nor a binding resolves. */
    default?: string | number;
    /** Closed-allowlist binding path. Mutually preferred over `default` when set. */
    bind?: string;
    /** Optional help text shown under the input. */
    helpText?: string;
}

export interface TextField extends BaseField {
    type: 'text';
    maxLength?: number;
    placeholder?: string;
}

export interface TextareaField extends BaseField {
    type: 'textarea';
    rows?: number;
    placeholder?: string;
}

export interface NumberField extends BaseField {
    type: 'number';
    min?: number;
    max?: number;
    /** Static suffix rendered next to the input (e.g. "kPa"). */
    unit?: string;
}

export interface DateField extends BaseField {
    type: 'date';
}

export interface SelectField extends BaseField {
    type: 'select';
    options: string[];
}

export type Field = TextField | TextareaField | NumberField | DateField | SelectField;

// ─── Section-level shapes ────────────────────────────────────────────────────

export interface ProcessBlock {
    subtitle: string;
    items: string[];
}

export interface ProcessSection {
    id: string;
    type: 'process';
    title?: string;
    blocks: ProcessBlock[];
}

export interface HeaderSection {
    id: string;
    type: 'header';
    title?: string;
    fields: Field[];
}

export interface ChecklistColumn {
    key: string;
    label: string;
}

export interface ChecklistItem {
    id: string;
    particular: string;
    /** result column input definition (without `key`/`label` since those come from the column). */
    result: Omit<Field, 'key' | 'label'> & { key?: string; label?: string };
    /** remarks column input definition. */
    remarks?: Omit<Field, 'key' | 'label'> & { key?: string; label?: string };
}

export interface ChecklistSection {
    id: string;
    type: 'checklist';
    title?: string;
    columns: ChecklistColumn[];
    items: ChecklistItem[];
}

export interface ImageSlot {
    key: string;
    label: string;
    multi?: boolean;          // default false
    accept?: string;          // default "image/*"
    maxSizeMb?: number;       // default 5
    required?: boolean;       // default false
}

export interface ImageAttachmentsSection {
    id: string;
    type: 'image_attachments';
    title?: string;
    columns?: number;         // visual layout columns; default 2
    slots: ImageSlot[];
}

export interface FieldsSection {
    id: string;
    type: 'fields';
    title?: string;
    layout?: 'grid' | 'stack';
    columns?: number;
    fields: Field[];
}

export interface SignatureBlock {
    key: string;
    label: string;
}

export interface SignaturesSection {
    id: string;
    type: 'signatures';
    title?: string;
    blocks: SignatureBlock[];
}

export type Section =
    | ProcessSection
    | HeaderSection
    | ChecklistSection
    | ImageAttachmentsSection
    | FieldsSection
    | SignaturesSection;

export type SectionType = Section['type'];

// ─── Wizard-step + template ──────────────────────────────────────────────────

export interface WizardStepDef {
    key: string;
    title: string;
    /** Section ids this step renders. Empty array = Review step. */
    sections: string[];
}

export interface ReportTemplate {
    templateId: string;
    templateVersion: number;
    title: string;
    /** Optional. If omitted, one step per section + auto Review step is generated. */
    wizardSteps?: WizardStepDef[];
    sections: Section[];
}

// ─── Response data shape (lives in `response_data` Long Text field) ──────────

/** Map of `bind` path → resolved value (snapshot frozen at fill time). */
export type PrefillSnapshot = Record<string, string>;

/** Per-section response payload. Shape varies by section type — see encoder/decoder. */
export interface ResponsesByCheckListItem {
    [itemId: string]: { result?: string; remarks?: string };
}

export type SectionResponses = Record<string, unknown>;
// Concrete shapes per section type:
//   header:            { [field_key: string]: string }
//   checklist:         { [item_id: string]: { result?: string; remarks?: string } }
//   fields:            { [field_key: string]: string | number }
// Sections without inputs (process, image_attachments, signatures) do NOT
// appear in `responses` — image data lives in `attachments`.

/**
 * One uploaded image. Mirrors what `useFrappeFileUpload` returns plus the
 * `file_doc` so the orphan janitor can delete by Frappe File docname.
 *
 * Print format passes `file_url` through `get_s3_temp_url` to render.
 *
 * Legacy responses created before the Inflow-Payments-aligned refactor stored
 * a Nirmaan Attachment docname string here instead of an object — the print
 * format and read path tolerate both shapes.
 */
export interface AttachmentRecord {
    file_url: string;
    file_name: string;
    file_doc?: string;
}

export type AttachmentSlotValue = AttachmentRecord | string;

export interface ResponseData {
    templateId: string;
    templateVersion: number;
    snapshotHash: string;
    filledAt: string;
    filledBy: string;
    lastEditedAt?: string;
    prefillSnapshot: PrefillSnapshot;
    responses: Record<string, SectionResponses>;
    /** Map of slot_key → ordered list of attachments. Strings = legacy NA names. */
    attachments: Record<string, AttachmentSlotValue[]>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Wizard mode — derived from URL ?mode= and the row's filled state. */
export type WizardMode = 'fill' | 'view' | 'edit';

/** Template-validation error — surfaced to admins in friendly form. */
export interface TemplateValidationError {
    code: 'invalid_json' | 'missing_field' | 'duplicate_id' | 'invalid_type' | 'unknown';
    message: string;
    path?: string;
}
