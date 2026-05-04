// Frozen, content-addressed snapshot of a commissioning report template.
// docname = SHA-256 of `payload`. Immutable after insert.

export interface CommissionReportTemplateSnapshot {
    name: string;             // = payload_hash (SHA-256 hex)
    payload_hash: string;     // same as `name`, kept explicitly for queries
    template_id: string;
    template_version: number;
    template_title: string;
    payload: string;          // canonical JSON (sort_keys, no whitespace)
    first_seen_at: string;    // ISO datetime
    creation?: string;
    modified?: string;
    owner?: string;
    modified_by?: string;
}
