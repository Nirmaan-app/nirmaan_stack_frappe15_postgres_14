import { useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import type { ParsedExcelData, SelectedHeaders, FieldMapping } from '../schema';

// Keywords for header detection scoring
const HEADER_KEYWORDS = [
  'description', 'item', 'particular', 'particulars',
  'quantity', 'qty', 'unit', 'uom',
  'rate', 'amount', 'total', 'supply', 'installation',
  'sl', 'sno', 's.no', 'sr', 'no'
];

// Target field mapping keywords
const FIELD_KEYWORDS: Record<string, string[]> = {
  description: ['description', 'item', 'particular', 'particulars', 'item description', 'name of item', 'name of work'],
  unit: ['unit', 'uom', 'units'],
  quantity: ['quantity', 'qty', 'nos', 'number'],
  supply_rate: ['supply rate', 'supply', 'material rate', 'material cost'],
  installation_rate: ['installation rate', 'installation', 'labour rate', 'labor rate', 'labour cost', 'labor cost'],
};

/** Column letter helper: 0→A, 1→B, ..., 25→Z, 26→AA */
export function colLetter(index: number): string {
  let s = '';
  let n = index;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function sheetToRows(workbook: XLSX.WorkBook, sheetIndex: number): string[][] {
  const sheetName = workbook.SheetNames[sheetIndex];
  const worksheet = workbook.Sheets[sheetName];
  const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    blankrows: true,
  });
  return rawData.map(row =>
    row.map((cell: any) => (cell != null ? String(cell).trim() : ''))
  );
}

function detectHeaderRow(allRows: string[][]): number {
  const scanLimit = Math.min(15, allRows.length);
  let bestScore = -1;
  let detectedHeaderRow = 0;

  for (let i = 0; i < scanLimit; i++) {
    const row = allRows[i];
    let score = 0;
    const nonEmptyCells = row.filter(cell => cell !== '').length;

    if (nonEmptyCells < 3) score -= 5;
    score += nonEmptyCells;

    const allStrings = row.every(cell => cell === '' || isNaN(Number(cell)));
    if (allStrings && nonEmptyCells > 0) score += 2;

    row.forEach(cell => {
      const lower = cell.toLowerCase();
      HEADER_KEYWORDS.forEach(keyword => {
        if (lower.includes(keyword)) score += 3;
      });
    });

    if (score > bestScore) {
      bestScore = score;
      detectedHeaderRow = i;
    }
  }

  return detectedHeaderRow;
}

/** Build SelectedHeaders: pre-select all non-empty cells in the detected header row */
export function buildSelectedHeaders(allRows: string[][], headerRow: number): SelectedHeaders {
  const headers: SelectedHeaders = {};
  const row = allRows[headerRow];
  if (!row) return headers;
  row.forEach((cell, colIdx) => {
    if (cell.trim()) {
      headers[colIdx] = headerRow;
    }
  });
  return headers;
}

/** Cell-level auto-detection: find up to maxSelections cells matching target field keywords */
export function buildAutoDetectedCellHeaders(
  allRows: string[][],
  maxSelections: number
): { selectedHeaders: SelectedHeaders; detectedHeaderRow: number } {
  const detectedHeaderRow = detectHeaderRow(allRows);
  const selectedHeaders: SelectedHeaders = {};
  const usedFields = new Set<string>();

  // Helper: try to match a cell against FIELD_KEYWORDS
  const tryMatch = (rowIdx: number, colIdx: number): boolean => {
    const cell = allRows[rowIdx]?.[colIdx];
    if (!cell?.trim()) return false;
    const lower = cell.toLowerCase();
    for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
      if (usedFields.has(field)) continue;
      if (keywords.some(kw => lower.includes(kw))) {
        selectedHeaders[colIdx] = rowIdx;
        usedFields.add(field);
        return true;
      }
    }
    return false;
  };

  // Pass 1: scan detected header row first
  const bestRow = allRows[detectedHeaderRow];
  if (bestRow) {
    for (let c = 0; c < bestRow.length && usedFields.size < maxSelections; c++) {
      tryMatch(detectedHeaderRow, c);
    }
  }

  // Pass 2: scan other rows in the first 15 if we haven't found enough
  const scanLimit = Math.min(15, allRows.length);
  for (let r = 0; r < scanLimit && usedFields.size < maxSelections; r++) {
    if (r === detectedHeaderRow) continue;
    const row = allRows[r];
    if (!row) continue;
    for (let c = 0; c < row.length && usedFields.size < maxSelections; c++) {
      if (selectedHeaders[c] != null) continue; // column already taken
      tryMatch(r, c);
    }
  }

  return { selectedHeaders, detectedHeaderRow };
}

/** Build inverted field mapping: targetField → colIndex */
export function buildSuggestedFieldMapping(allRows: string[][], selectedHeaders: SelectedHeaders): FieldMapping {
  const mapping: FieldMapping = {};
  const mappedTargets = new Set<string>();

  for (const [colIdxStr, rowIdx] of Object.entries(selectedHeaders)) {
    const colIdx = Number(colIdxStr);
    const cellValue = allRows[rowIdx]?.[colIdx] || '';
    if (!cellValue) continue;
    const lower = cellValue.toLowerCase();

    for (const [targetField, keywords] of Object.entries(FIELD_KEYWORDS)) {
      if (mappedTargets.has(targetField)) continue;
      if (keywords.some(kw => lower.includes(kw))) {
        mapping[targetField] = colIdx;
        mappedTargets.add(targetField);
        break;
      }
    }
  }

  return mapping;
}

/** Compute dataStartRow from selected headers */
function computeDataStartRow(selectedHeaders: SelectedHeaders): number {
  const rowIndices = Object.values(selectedHeaders);
  if (rowIndices.length === 0) return 0;
  return Math.max(...rowIndices) + 1;
}

/** Get preview rows and total count from allRows given dataStartRow */
function getDataRowsInfo(allRows: string[][], dataStartRow: number) {
  const dataRows = allRows.slice(dataStartRow).filter(
    row => row.some(cell => cell !== '')
  );
  return {
    previewRows: dataRows.slice(0, 100),
    totalRows: dataRows.length,
  };
}

export function useExcelParser() {
  const workbookRef = useRef<XLSX.WorkBook | null>(null);

  const parseFile = useCallback(async (file: File): Promise<ParsedExcelData> => {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    workbookRef.current = workbook;

    const sheetNames = workbook.SheetNames;
    const allRows = sheetToRows(workbook, 0);

    const { selectedHeaders, detectedHeaderRow } = buildAutoDetectedCellHeaders(allRows, 5);
    const suggestedFieldMapping = buildSuggestedFieldMapping(allRows, selectedHeaders);
    const dataStartRow = computeDataStartRow(selectedHeaders);
    const { previewRows, totalRows } = getDataRowsInfo(allRows, dataStartRow);

    return {
      rawRows: allRows.slice(0, 15),
      allRows,
      sheetNames,
      detectedHeaderRow,
      selectedHeaders,
      previewRows,
      totalRows,
      dataStartRow,
      suggestedFieldMapping,
    };
  }, []);

  /** Re-parse a different sheet from the stored workbook */
  const parseSheet = useCallback((sheetIndex: number): ParsedExcelData | null => {
    const workbook = workbookRef.current;
    if (!workbook || sheetIndex >= workbook.SheetNames.length) return null;

    const sheetNames = workbook.SheetNames;
    const allRows = sheetToRows(workbook, sheetIndex);

    const { selectedHeaders, detectedHeaderRow } = buildAutoDetectedCellHeaders(allRows, 5);
    const suggestedFieldMapping = buildSuggestedFieldMapping(allRows, selectedHeaders);
    const dataStartRow = computeDataStartRow(selectedHeaders);
    const { previewRows, totalRows } = getDataRowsInfo(allRows, dataStartRow);

    return {
      rawRows: allRows.slice(0, 15),
      allRows,
      sheetNames,
      detectedHeaderRow,
      selectedHeaders,
      previewRows,
      totalRows,
      dataStartRow,
      suggestedFieldMapping,
    };
  }, []);

  /** Re-compute preview data after cell-level header changes */
  const reparseWithCellHeaders = useCallback((
    allRows: string[][],
    selectedHeaders: SelectedHeaders
  ): {
    dataStartRow: number;
    previewRows: string[][];
    totalRows: number;
    suggestedFieldMapping: FieldMapping;
  } => {
    const dataStartRow = computeDataStartRow(selectedHeaders);
    const { previewRows, totalRows } = getDataRowsInfo(allRows, dataStartRow);
    const suggestedFieldMapping = buildSuggestedFieldMapping(allRows, selectedHeaders);

    return { dataStartRow, previewRows, totalRows, suggestedFieldMapping };
  }, []);

  /** Auto-suggest field mapping for a single column that was just selected */
  const suggestFieldForColumn = useCallback((
    allRows: string[][],
    colIdx: number,
    rowIdx: number,
    currentMapping: FieldMapping
  ): string | null => {
    const cellValue = allRows[rowIdx]?.[colIdx] || '';
    if (!cellValue) return null;
    const lower = cellValue.toLowerCase();
    const mappedTargets = new Set(Object.keys(currentMapping));

    for (const [targetField, keywords] of Object.entries(FIELD_KEYWORDS)) {
      if (mappedTargets.has(targetField)) continue;
      if (keywords.some(kw => lower.includes(kw))) {
        return targetField;
      }
    }
    return null;
  }, []);

  return { parseFile, parseSheet, reparseWithCellHeaders, suggestFieldForColumn, colLetter };
}
