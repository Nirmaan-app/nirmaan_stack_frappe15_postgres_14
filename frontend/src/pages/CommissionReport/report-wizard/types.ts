// Template + response type system for the commissioning report wizard.
// Authoring grammar reference: frontend/.claude/context/domain/commissioning-report-templates.md

// ─── Field-level shapes (used inside header + fields + checklist items) ───────

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'image';

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

/** Per-cell image field, used inside `trainees_data_table` columns. The cell
 *  uploads to S3 via the same `useFrappeFileUpload` flow as `image_attachments`
 *  and stores an `AttachmentRecord` inline in the row's column value. */
export interface ImageField extends BaseField {
    type: 'image';
    /** Max upload size in MB. Default 5. */
    maxSizeMb?: number;
    /** MIME hint, e.g. "image/*". Default "image/*". */
    accept?: string;
}

export type Field = TextField | TextareaField | NumberField | DateField | SelectField | ImageField;

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
    /** Optional visibility gate when this checklist is a NESTED section inside a
     *  `repeating_groups` group. `field` is a group-relative field key (e.g.
     *  "db_type") — the section renders only when the group's value matches.
     *  Reuses the WizardStepVisibleIf shape ({ field, equals | in }). */
    visibleIf?: WizardStepVisibleIf;
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

/** Column in a `trainees_data_table` section. Reuses the Field shape minus prefill (`bind`),
 *  since each row has its own value — bindings don't apply per row. */
export type TraineesDataTableColumn = Omit<Field, 'bind'> & {
    /** Column display width hint, e.g. "20%", "120px". Optional. */
    width?: string;
};

export interface TraineesDataTableSection {
    id: string;
    type: 'trainees_data_table';
    title?: string;
    columns: TraineesDataTableColumn[];
    /** Render this many empty rows by default (≥ 1). Default 1. */
    minRows?: number;
    /** Cap the user at N rows. Default 100. */
    maxRows?: number;
    /** Button text when adding another row. Default "Add another trainee". */
    addRowLabel?: string;
    /** Optional prefix for the row-number column (e.g. "Loop " → "Loop 1", "Loop 2"). */
    rowLabelPrefix?: string;
}

/** Column-group in a `measurement_matrix` section. Like a `Field` (sans `bind`)
 *  plus an optional `valueLabel` shown as a sub-header above the input column. */
export type MeasurementMatrixColumn = Omit<Field, 'bind'> & {
    /** Sub-header rendered above the input column (e.g. "In Volts"). Optional. */
    valueLabel?: string;
};

/** One declared row in a `measurement_matrix` section. */
export interface MeasurementMatrixRow {
    /** Stable identifier — written to responses, never user-edited. */
    id: string;
    /** Static cell label per column key, e.g. { pp: "R-Y", pn: "R-N", pe: "R-E" }. */
    labels: Record<string, string>;
}

/** Fixed-row tabular measurement grid: N declared rows × M typed column-groups.
 *  Stored as an array at `responses.<id>` — `[{ id, [col_key]: value, … }, …]`. */
export interface MeasurementMatrixSection {
    id: string;
    type: 'measurement_matrix';
    title?: string;
    rows: MeasurementMatrixRow[];
    columns: MeasurementMatrixColumn[];
}

/** Repeating-groups section. N independent cards, each with a flat set of
 *  `groupFields` (e.g. Equipment + Area), an optional nested repeating
 *  data-table of `rowsTable` rows, and optional `nestedSections` (e.g. a
 *  per-group checklist or process). Used by the CFM / Air Balance Report
 *  (rowsTable) and the DX Commission Report (nestedSections). */
export interface RepeatingGroupsSection {
    id: string;
    type: 'repeating_groups';
    title?: string;
    /** Header-field path whose number value drives the initial group count.
     *  Wizard auto-seeds empty groups as the count grows; reductions are
     *  manual (mirrors the Earth Pit count behavior). */
    countBoundTo?: string;
    /** Flat fields shown at the top of each group (e.g. equipment, area). */
    groupFields: Field[];
    /** Optional nested repeating data-table inside each group (CFM uses this). */
    rowsTable?: {
        title?: string;
        columns: TraineesDataTableColumn[];
        minRows?: number;
        maxRows?: number;
        addRowLabel?: string;
    };
    /** Optional sub-sections rendered per group after the group fields (e.g.
     *  a Physical Test checklist or a Timer process line). Each nested section's
     *  data lives under `responses[<this.id>][<groupIdx>][<nested.id>]`. */
    nestedSections?: Section[];
    /** Used to label each group card, e.g. "CFM Reading 1". */
    groupTitlePrefix?: string;
    /** Max number of groups the wizard will allow. Default 50. */
    maxGroups?: number;
}

export type Section =
    | ProcessSection
    | HeaderSection
    | ChecklistSection
    | ImageAttachmentsSection
    | FieldsSection
    | SignaturesSection
    | TraineesDataTableSection
    | MeasurementMatrixSection
    | RepeatingGroupsSection;

export type SectionType = Section['type'];

// ─── Wizard-step + template ──────────────────────────────────────────────────

/** Optional condition that hides a wizard step when a form value doesn't match.
 *  `field` is a dot path into the response object, e.g. "responses.unit_choice.unit_type". */
export interface WizardStepVisibleIf {
    /** Dot path into the form values (e.g. "responses.unit_choice.unit_type"). */
    field: string;
    /** Step is visible if the resolved value is in this list. */
    in?: string[];
    /** Step is visible if the resolved value equals this. */
    equals?: string | number | boolean;
}

export interface WizardStepDef {
    key: string;
    title: string;
    /** Section ids this step renders. Empty array = Review step. */
    sections: string[];
    /** Optional visibility gate based on current form values. */
    visibleIf?: WizardStepVisibleIf;
    /** Synthetic per-group step. Set by the wizard at runtime when expanding a
     *  `repeating_groups` section into one wizard step per group. Renderers
     *  use this to scope to a single group. */
    groupSlice?: {
        sectionId: string;
        groupIndex: number;
    };
    /** Synthetic per-zone step. Set by the wizard at runtime when a zone-wise
     *  template (`zone_wise_enable === "YES"`) expands each zone into its own
     *  Header/Checklist/Signatures/Review steps. Renderers scope to the zone via
     *  `responsesRoot = "zones.<zoneIndex>.responses"`. */
    zoneSlice?: {
        zoneIndex: number;
    };
}

export interface ReportTemplate {
    templateId: string;
    templateVersion: number;
    title: string;
    /** When "YES", the wizard runs zone-wise: a zone tab bar, each zone holding
     *  the full section set, and `response_data.zones[]` storage. "NO"/absent =
     *  the ordinary single-report wizard (unchanged). Read from the master
     *  `Commission Report Tasks.source_format`. */
    zone_wise_enable?: 'YES' | 'NO';
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

/** One zone of a zone-wise report (`zone_wise_enable === "YES"`). Each zone is a
 *  fully self-contained report: its own per-section `responses` (header,
 *  checklist, signatures, …) and its own `attachments`. Keyed by a stable `id`
 *  so rename / reorder / delete never disturbs another zone's data. */
export interface ZoneEntry {
    id: string;
    label: string;
    responses: Record<string, SectionResponses>;
    attachments: Record<string, AttachmentSlotValue[]>;
}

export interface ResponseData {
    templateId: string;
    templateVersion: number;
    snapshotHash: string;
    filledAt: string;
    filledBy: string;
    lastEditedAt?: string;
    prefillSnapshot: PrefillSnapshot;
    /** Zone-wise reports populate `zoneWise: true` + `zones[]`; the flat
     *  `responses`/`attachments` are then left empty. Non-zone reports do the
     *  reverse. Exactly one shape carries the data. */
    zoneWise?: boolean;
    zones?: ZoneEntry[];
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
