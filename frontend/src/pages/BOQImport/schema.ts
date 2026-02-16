import { z } from 'zod';

// ─── Upload Step Schema ────────────────────────────────────────
export const boqUploadSchema = z.object({
  project: z.string().min(1, 'Project is required'),
  work_package: z.string().min(1, 'Work Package is required'),
  zone: z.string().optional(),
});

export type BOQUploadFormValues = z.infer<typeof boqUploadSchema>;

// ─── Cell-Level Header Selection ───────────────────────────────
// Maps colIndex → rowIndex: each column picks its header from any row
export type SelectedHeaders = Record<number, number>;

// ─── Inverted Field Mapping ────────────────────────────────────
// Maps targetField → colIndex (e.g., { description: 2, quantity: 5 })
export type FieldMapping = Record<string, number>;

// ─── Data Types ────────────────────────────────────────────────

export interface ParsedExcelData {
  rawRows: string[][];
  allRows: string[][];
  sheetNames: string[];
  detectedHeaderRow: number;
  selectedHeaders: SelectedHeaders;
  previewRows: string[][];
  totalRows: number;
  dataStartRow: number;
  suggestedFieldMapping: FieldMapping;
}

export interface BOQPreviewRow {
  rowIndex: number;
  description: string;
  unit: string;
  quantity: number;
  supply_rate: number;
  installation_rate: number;
  total_rate: number;
  amount: number;
  hasWarning?: 'empty_description' | 'zero_rates';
}

export interface BOQImportResult {
  status: 'success' | 'error';
  boq_name?: string;
  items_count?: number;
  total_amount?: number;
  message?: string;
}

export interface SelectOption {
  label: string;
  value: string;
}

// ─── Target Field Definition ───────────────────────────────────
export interface TargetFieldDef {
  value: string;
  label: string;
  required?: boolean;
  keywords: string[];
}
