import { Upload, TableProperties, Eye } from 'lucide-react';
import type { WizardStep } from '@/components/ui/wizard-steps';
import type { TargetFieldDef } from './schema';

// ─── Wizard Steps Configuration ────────────────────────────────
export const WIZARD_STEPS: WizardStep[] = [
  { key: 'upload', title: 'Upload & Configure', shortTitle: 'Upload', icon: Upload },
  { key: 'headers-mapping', title: 'Headers & Mapping', shortTitle: 'Map', icon: TableProperties },
  { key: 'preview', title: 'Preview & Import', shortTitle: 'Preview', icon: Eye },
];

// ─── Target Fields for Column Mapping ──────────────────────────
export const TARGET_FIELDS: TargetFieldDef[] = [
  {
    value: 'description',
    label: 'Description',
    required: true,
    keywords: ['description', 'item', 'particular', 'particulars', 'item description', 'name of item', 'name of work'],
  },
  {
    value: 'unit',
    label: 'Unit',
    keywords: ['unit', 'uom', 'units'],
  },
  {
    value: 'quantity',
    label: 'Quantity',
    keywords: ['quantity', 'qty', 'nos', 'number'],
  },
  {
    value: 'supply_rate',
    label: 'Supply Rate',
    keywords: ['supply rate', 'supply', 'material rate', 'material cost'],
  },
  {
    value: 'installation_rate',
    label: 'Installation Rate',
    keywords: ['installation rate', 'installation', 'labour rate', 'labor rate', 'labour cost', 'labor cost'],
  },
];

// ─── Header Detection Keywords ─────────────────────────────────
export const HEADER_KEYWORDS = [
  'description', 'item', 'particular', 'particulars',
  'quantity', 'qty', 'unit', 'uom',
  'rate', 'amount', 'total', 'supply', 'installation',
  'sl', 'sno', 's.no', 'sr', 'no',
];

// ─── Header Selection Limits ─────────────────────────────────
export const MAX_HEADER_SELECTIONS = 5;

// ─── Accepted File Types ───────────────────────────────────────
export const ACCEPTED_FILE_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
] as const;

// ─── Number Formatting ─────────────────────────────────────────
export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

export const formatNumber = (value: number): string => {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};
