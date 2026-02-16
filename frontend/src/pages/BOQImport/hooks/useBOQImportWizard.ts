import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFrappeFileUpload } from 'frappe-react-sdk';
import {
  boqUploadSchema,
  type BOQUploadFormValues,
  type ParsedExcelData,
  type SelectedHeaders,
  type FieldMapping,
} from '../schema';
import { useExcelParser } from './useExcelParser';
import { MAX_HEADER_SELECTIONS } from '../constants';

interface UseBOQImportWizardOptions {
  preSelectedProject?: string;
}

export function useBOQImportWizard(options?: UseBOQImportWizardOptions) {
  const preSelectedProject = options?.preSelectedProject;

  // ─── State ───────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedExcelData | null>(null);
  const [selectedHeaders, setSelectedHeaders] = useState<SelectedHeaders>({});
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>({});
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [dataStartRow, setDataStartRow] = useState(0);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);

  // ─── Form ────────────────────────────────────────────────────
  const form = useForm<BOQUploadFormValues>({
    resolver: zodResolver(boqUploadSchema),
    defaultValues: {
      project: preSelectedProject || '',
      work_package: '',
      zone: '',
    },
  });

  // ─── Hooks ───────────────────────────────────────────────────
  const { upload } = useFrappeFileUpload();
  const { parseFile, parseSheet, reparseWithCellHeaders, suggestFieldForColumn } = useExcelParser();

  // ─── Handlers ────────────────────────────────────────────────

  const handleUploadNext = useCallback(async () => {
    if (!selectedFile) return;
    setIsParsing(true);
    try {
      const uploadResult = await upload(selectedFile, { isPrivate: true });
      const url = uploadResult?.file_url || '';
      setFileUrl(url);
      const data = await parseFile(selectedFile);
      setParsedData(data);
      setSheetNames(data.sheetNames);
      setSelectedHeaders(data.selectedHeaders);
      setFieldMapping(data.suggestedFieldMapping);
      setPreviewRows(data.previewRows);
      setTotalRows(data.totalRows);
      setDataStartRow(data.dataStartRow);
      setCurrentStep(1);
    } catch (error) {
      console.error('Failed to parse file:', error);
    } finally {
      setIsParsing(false);
    }
  }, [selectedFile, upload, parseFile]);

  const handleSheetChange = useCallback(
    (index: number) => {
      setSelectedSheetIndex(index);
      const data = parseSheet(index);
      if (data) {
        setParsedData(data);
        setSelectedHeaders(data.selectedHeaders);
        setFieldMapping(data.suggestedFieldMapping);
        setPreviewRows(data.previewRows);
        setTotalRows(data.totalRows);
        setDataStartRow(data.dataStartRow);
      }
    },
    [parseSheet]
  );

  /** Cell-level header selection */
  const handleCellClick = useCallback(
    (rowIdx: number, colIdx: number) => {
      if (!parsedData) return;

      const cellValue = parsedData.allRows[rowIdx]?.[colIdx];
      // Block empty cells
      if (!cellValue?.trim()) return;

      const currentRowForCol = selectedHeaders[colIdx];
      const isSelected = currentRowForCol === rowIdx;

      let newHeaders: SelectedHeaders;
      let newMapping: FieldMapping;

      if (isSelected) {
        // Deselect this cell
        newHeaders = { ...selectedHeaders };
        delete newHeaders[colIdx];
        // Remove any field mapping pointing to this column
        newMapping = { ...fieldMapping };
        for (const [field, mappedCol] of Object.entries(newMapping)) {
          if (mappedCol === colIdx) delete newMapping[field];
        }
      } else if (currentRowForCol != null) {
        // Same column, different row → replace header cell
        newHeaders = { ...selectedHeaders, [colIdx]: rowIdx };
        // Clear field mapping for this column, then re-suggest
        newMapping = { ...fieldMapping };
        for (const [field, mappedCol] of Object.entries(newMapping)) {
          if (mappedCol === colIdx) delete newMapping[field];
        }
        const suggested = suggestFieldForColumn(parsedData.allRows, colIdx, rowIdx, newMapping);
        if (suggested) newMapping[suggested] = colIdx;
      } else {
        // New column — check limit
        const currentCount = Object.keys(selectedHeaders).length;
        if (currentCount >= MAX_HEADER_SELECTIONS) return;

        newHeaders = { ...selectedHeaders, [colIdx]: rowIdx };
        newMapping = { ...fieldMapping };
        const suggested = suggestFieldForColumn(parsedData.allRows, colIdx, rowIdx, newMapping);
        if (suggested) newMapping[suggested] = colIdx;
      }

      setSelectedHeaders(newHeaders);
      setFieldMapping(newMapping);
      const result = reparseWithCellHeaders(parsedData.allRows, newHeaders);
      setPreviewRows(result.previewRows);
      setTotalRows(result.totalRows);
      setDataStartRow(result.dataStartRow);
    },
    [parsedData, selectedHeaders, fieldMapping, reparseWithCellHeaders, suggestFieldForColumn]
  );

  const handleMappingNext = useCallback(() => setCurrentStep(2), []);

  const goBack = useCallback(() => {
    setCurrentStep(prev => Math.max(0, prev - 1));
  }, []);

  const handleStepClick = useCallback(
    (stepIndex: number) => {
      if (stepIndex <= currentStep) setCurrentStep(stepIndex);
    },
    [currentStep]
  );

  const handleReset = useCallback(() => {
    setCurrentStep(0);
    setSelectedFile(null);
    setFileUrl('');
    setParsedData(null);
    setSelectedHeaders({});
    setFieldMapping({});
    setPreviewRows([]);
    setTotalRows(0);
    setDataStartRow(0);
    setSheetNames([]);
    setSelectedSheetIndex(0);
    form.reset({ project: preSelectedProject || '', work_package: '', zone: '' });
  }, [form, preSelectedProject]);

  // ─── Return ──────────────────────────────────────────────────
  return {
    // State
    currentStep,
    selectedFile,
    fileUrl,
    isParsing,
    parsedData,
    selectedHeaders,
    fieldMapping,
    previewRows,
    totalRows,
    dataStartRow,
    sheetNames,
    selectedSheetIndex,
    form,
    // Handlers
    setSelectedFile,
    handleUploadNext,
    handleSheetChange,
    handleCellClick,
    handleMappingNext,
    goBack,
    handleStepClick,
    handleReset,
    setFieldMapping,
  };
}
