import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Upload,
  FileSpreadsheet,
  AlertCircle,
  Check,
  Search,
  Pencil,
  Sparkles,
  Key,
  CreditCard,
  Eye,
  EyeOff,
} from 'lucide-react';
import { getStorageAdapter } from '../shared/storage';
import {
  ActualExpense,
  StatementColumnMapping,
  StatementFormatProfile,
  LearnedMerchantRule,
} from '../shared/types/expenses';
import {
  getPlannerExpenseCatalog,
  savePlannerExpenseLineItem,
  PlannerExpenseLineItem,
} from '../shared/utils/plannerCategories';
import { getPlannerProfileNames, resolveLoggedInPayerName } from '../shared/utils/profileNames';
import {
  normalizeMerchant,
  calculateHeaderFingerprint,
  guessColumnMapping,
  findMatchingFormatProfile,
  saveFormatProfile,
  categorizeLocally,
  batchSaveLearnedMerchantRules,
  batchCategorizeWithLLM,
  getGeminiApiKey,
  saveGeminiApiKey,
  isPaymentOrTransfer,
} from '../shared/utils/merchantMatcher';
import { FormatSetupModal } from './FormatSetupModal';

export interface ImportExpensesModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedYear: number;
  onImportComplete: (importedCount: number, totalAmount: number) => void;
  onUpdateActualsLivingExpenses?: (year: number, amount: number) => void;
}

export interface ParsedWorksheetRow {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number; // Positive = expense, Negative = return/credit
  rawDescription: string;
  normalizedMerchant: string;
  category: string;
  lineItem: string;
  notes: string;
  payer: string;
  isDuplicate: boolean;
  isPaymentTransfer: boolean;
  selected: boolean;
  isUnknown: boolean;
  mappingSource: 'learned' | 'heuristic' | 'llm' | 'user' | 'unknown';
}

// Robust CSV Line Splitter handling commas inside quotes
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      if (inQuotes && line[i + 1] === char) {
        current += char;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

// Format date to standard ISO YYYY-MM-DD
function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Handle MM/DD/YYYY or M/D/YYYY
  const parts = trimmed.split(/[/.-]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY/MM/DD
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    // MM/DD/YYYY
    const month = parts[0].padStart(2, '0');
    const day = parts[1].padStart(2, '0');
    let year = parts[2];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return trimmed;
}

export const ImportExpensesModal: React.FC<ImportExpensesModalProps> = ({
  isOpen,
  onClose,
  selectedYear,
  onImportComplete,
  onUpdateActualsLivingExpenses,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [csvText, setCsvText] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parsedRows, setParsedRows] = useState<ParsedWorksheetRow[]>([]);
  const [existingExpenses, setExistingExpenses] = useState<ActualExpense[]>([]);
  const [defaultPayer, setDefaultPayer] = useState<string>(() => resolveLoggedInPayerName() || 'Primary');
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null);

  // Statement Format Profile State
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawSampleLines, setRawSampleLines] = useState<string[][]>([]);
  const [currentProfile, setCurrentProfile] = useState<StatementFormatProfile | null>(null);
  const [isFormatSetupOpen, setIsFormatSetupOpen] = useState<boolean>(false);
  const [formatSetupInitialMapping, setFormatSetupInitialMapping] = useState<StatementColumnMapping | null>(null);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [activeFilterTab, setActiveFilterTab] = useState<'ALL' | 'UNKNOWN' | 'DUPLICATES' | 'PAYMENTS'>('ALL');
  const [hideDuplicates, setHideDuplicates] = useState<boolean>(false);

  // Catalog items
  const [catalogItems, setCatalogItems] = useState<PlannerExpenseLineItem[]>(() => getPlannerExpenseCatalog());

  // LLM State
  const [isAiMatching, setIsAiMatching] = useState<boolean>(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState<string>(() => getGeminiApiKey());
  const [showApiKeyClearText, setShowApiKeyClearText] = useState<boolean>(false);

  // On-the-fly category/item creation popover
  const [inlineCreateRowId, setInlineCreateRowId] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState<string>('');
  const [newItemCategory, setNewItemCategory] = useState<string>('Living');

  // Bulk Edit
  const [bulkCategory, setBulkCategory] = useState<string>('');
  const [bulkLineItem, setBulkLineItem] = useState<string>('');
  const [bulkPayer, setBulkPayer] = useState<string>('');

  // Submission progress
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitProgress, setSubmitProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing expenses for duplicate detection
  useEffect(() => {
    if (isOpen) {
      const adapter = getStorageAdapter();
      // Load current and adjacent year expenses to cover statement boundaries
      Promise.all([
        adapter.getExpenses(selectedYear - 1),
        adapter.getExpenses(selectedYear),
        adapter.getExpenses(selectedYear + 1),
      ])
        .then(([prevYear, currYear, nextYear]) => {
          setExistingExpenses([...prevYear, ...currYear, ...nextYear]);
        })
        .catch(err => console.error('Failed to load existing expenses:', err));

      setCatalogItems(getPlannerExpenseCatalog());
    }
  }, [isOpen, selectedYear]);

  // Profile names for payer selector
  const profileNames = useMemo(() => getPlannerProfileNames(), []);
  const payerOptions = useMemo(() => {
    const opts = [profileNames.primaryName];
    if (!profileNames.isSingleFiler && profileNames.spouseName) {
      opts.push(profileNames.spouseName);
    }
    opts.push('Joint');
    return opts;
  }, [profileNames]);

  // Distinct category groups from catalog
  const availableCategoryGroups = useMemo(() => {
    const groups = new Set<string>(['Living', 'Housing', 'Transportation', 'Healthcare', 'Leisure', 'Charities', 'Other']);
    catalogItems.forEach(i => { if (i.groupCategory) groups.add(i.groupCategory); });
    return Array.from(groups);
  }, [catalogItems]);

  // Parse CSV content using a resolved format mapping
  const processCsvWithMapping = (
    rawContent: string,
    mapping: StatementColumnMapping,
    profile: StatementFormatProfile | null
  ) => {
    try {
      const lines = rawContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return;

      const headers = parseCsvLine(lines[0]);
      const dateIdx = headers.indexOf(mapping.dateColumn);
      const descIdx = headers.indexOf(mapping.descriptionColumn);
      const amtIdx = mapping.amountColumn ? headers.indexOf(mapping.amountColumn) : -1;
      const debitIdx = mapping.debitColumn ? headers.indexOf(mapping.debitColumn) : -1;
      const creditIdx = mapping.creditColumn ? headers.indexOf(mapping.creditColumn) : -1;
      const catIdx = mapping.categoryColumn ? headers.indexOf(mapping.categoryColumn) : -1;
      const typeIdx = mapping.typeColumn ? headers.indexOf(mapping.typeColumn) : -1;
      const notesIdx = mapping.notesColumn ? headers.indexOf(mapping.notesColumn) : -1;

      // Track available existing expenses for 1-to-1 balanced duplicate matching
      const unmatchedExisting = [...existingExpenses];

      const candidates: ParsedWorksheetRow[] = [];

      for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        if (row.length < 2) continue;

        const rawDate = dateIdx !== -1 ? row[dateIdx] : '';
        const isoDate = normalizeDate(rawDate);
        if (!isoDate || isoDate.length < 4) continue;

        const rawDesc = descIdx !== -1 ? (row[descIdx] || '').trim() : '';
        const rawType = typeIdx !== -1 ? (row[typeIdx] || '').toLowerCase() : '';
        const rawCat = catIdx !== -1 ? (row[catIdx] || '').trim() : '';
        const rawNotes = notesIdx !== -1 ? (row[notesIdx] || '').trim() : '';

        // Calculate net amount based on mapping mode and sign convention
        let netAmount = 0;
        const isReturn = rawType.includes('return') || rawType.includes('reversal');

        if (mapping.amountMode === 'single' && amtIdx !== -1) {
          const rawAmt = parseFloat((row[amtIdx] || '0').replace(/[$,]/g, '').trim()) || 0;
          if (mapping.chargesAreNegative) {
            // Negative amounts are sales (charges) -> make positive
            // Positive amounts are payments or returns -> make negative if return
            if (isReturn) {
              netAmount = -Math.abs(rawAmt);
            } else if (rawAmt < 0) {
              netAmount = Math.abs(rawAmt);
            } else {
              netAmount = -Math.abs(rawAmt);
            }
          } else {
            // Charges are positive
            if (isReturn) {
              netAmount = -Math.abs(rawAmt);
            } else {
              netAmount = rawAmt;
            }
          }
        } else if (mapping.amountMode === 'split_debit_credit') {
          const debitVal = parseFloat((row[debitIdx] || '0').replace(/[$,]/g, '').trim()) || 0;
          const creditVal = parseFloat((row[creditIdx] || '0').replace(/[$,]/g, '').trim()) || 0;
          if (debitVal > 0) netAmount = debitVal;
          else if (creditVal > 0) netAmount = -creditVal;
        }

        const isPaymentTransfer = isPaymentOrTransfer(rawDesc, rawType, rawCat);

        const cleanMerchant = normalizeMerchant(rawDesc);

        // Run Multi-Tier Categorization
        const localMatch = categorizeLocally(rawDesc, rawCat, catalogItems);

        // 1-to-1 Balanced Duplicate Detection
        const matchIdx = unmatchedExisting.findIndex(e => {
          const sameDate = e.date === isoDate;
          const sameAmount = Math.abs(e.amount - netAmount) < 0.01;
          const notesLower = (e.notes || '').toLowerCase();
          const descLower = rawDesc.toLowerCase();
          const sameDesc = descLower ? notesLower.includes(descLower) || descLower.includes(notesLower) : true;
          return sameDate && sameAmount && sameDesc;
        });

        const isDuplicate = matchIdx !== -1;
        if (isDuplicate) {
          // Remove from available existing so twin charges on same day aren't both matched to one DB record
          unmatchedExisting.splice(matchIdx, 1);
        }

        candidates.push({
          id: `row_${i}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          date: isoDate,
          amount: Math.round(netAmount * 100) / 100,
          rawDescription: rawDesc,
          normalizedMerchant: cleanMerchant,
          category: localMatch.category,
          lineItem: localMatch.lineItem,
          notes: rawNotes,
          payer: defaultPayer,
          isDuplicate,
          isPaymentTransfer,
          selected: !isPaymentTransfer && !isDuplicate,
          isUnknown: localMatch.isUnknown,
          mappingSource: localMatch.source,
        });
      }

      setParsedRows(candidates);
      setCurrentProfile(profile);
    } catch (err) {
      console.error('Failed to parse statement rows:', err);
      setImportStatusMessage('An error occurred while parsing the CSV. Please verify column formatting.');
    } finally {
      setIsParsing(false);
    }
  };

  // Entry parse trigger: inspects fingerprint and either uses existing profile or opens setup
  const parseCsvData = (rawContent: string) => {
    setIsParsing(true);
    setImportStatusMessage(null);

    try {
      const lines = rawContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        setImportStatusMessage('The CSV file does not contain enough data rows.');
        setIsParsing(false);
        return;
      }

      const headers = parseCsvLine(lines[0]);
      const sampleLines = lines.slice(1, 10).map(l => parseCsvLine(l));
      setRawHeaders(headers);
      setRawSampleLines(sampleLines);

      // Check if format is recognized
      const matchingProfile = findMatchingFormatProfile(headers);

      if (matchingProfile) {
        processCsvWithMapping(rawContent, matchingProfile.mapping, matchingProfile);
      } else {
        // New unrecognized format: guess initial mapping and open setup dialog
        const guessed = guessColumnMapping(headers, sampleLines);
        setFormatSetupInitialMapping(guessed);
        setIsFormatSetupOpen(true);
        setIsParsing(false);
      }
    } catch (err) {
      console.error('Failed to inspect CSV header fingerprint:', err);
      setImportStatusMessage('Failed to inspect CSV headers.');
      setIsParsing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      setCsvText(content);
      parseCsvData(content);
    };
    reader.readAsText(file);
  };

  const handlePasteParse = () => {
    if (!csvText.trim()) return;
    setFileName('Pasted Statement Data');
    parseCsvData(csvText);
  };

  // Save new format profile from setup modal
  const handleSaveFormatProfile = (newProfile: StatementFormatProfile) => {
    saveFormatProfile(newProfile);
    setCurrentProfile(newProfile);
    if (csvText) {
      processCsvWithMapping(csvText, newProfile.mapping, newProfile);
    }
  };

  // Toggle row selection
  const handleToggleRow = (id: string) => {
    setParsedRows(prev => prev.map(r => (r.id === id && !r.isPaymentTransfer ? { ...r, selected: !r.selected } : r)));
  };

  const handleSelectAll = (select: boolean) => {
    setParsedRows(prev => prev.map(r => (r.isPaymentTransfer ? { ...r, selected: false } : { ...r, selected: select })));
  };

  // Inline row update handlers
  const handleUpdateRowCategory = (rowId: string, newCategory: string) => {
    setParsedRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      // Filter line items for new category; pick first if current doesn't match
      const validItems = catalogItems.filter(c => c.groupCategory === newCategory);
      const nextLineItem = validItems.some(i => i.name === r.lineItem)
        ? r.lineItem
        : validItems[0]?.name || 'General';

      return {
        ...r,
        category: newCategory,
        lineItem: nextLineItem,
        isUnknown: false,
        mappingSource: 'user',
      };
    }));
  };

  const handleUpdateRowLineItem = (rowId: string, newLineItem: string) => {
    setParsedRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      return {
        ...r,
        lineItem: newLineItem,
        isUnknown: false,
        mappingSource: 'user',
      };
    }));
  };

  const handleUpdateRowNotes = (rowId: string, notes: string) => {
    setParsedRows(prev => prev.map(r => r.id === rowId ? { ...r, notes } : r));
  };

  const handleUpdateRowPayer = (rowId: string, payer: string) => {
    setParsedRows(prev => prev.map(r => r.id === rowId ? { ...r, payer } : r));
  };

  // On-the-fly Category / Line Item Creation
  const handleCreateNewItemOnTheFly = () => {
    const trimmed = newItemName.trim();
    if (!trimmed) return;

    savePlannerExpenseLineItem({
      name: trimmed,
      groupCategory: newItemCategory,
      plannedMonthlyDefault: 0,
      applicableStates: ['ALL'],
    });

    const refreshedCatalog = getPlannerExpenseCatalog();
    setCatalogItems(refreshedCatalog);

    if (inlineCreateRowId) {
      setParsedRows(prev => prev.map(r => {
        if (r.id !== inlineCreateRowId) return r;
        return {
          ...r,
          category: newItemCategory,
          lineItem: trimmed,
          isUnknown: false,
          mappingSource: 'user',
        };
      }));
    }

    setInlineCreateRowId(null);
    setNewItemName('');
  };

  // Bulk Edit Execution
  const handleApplyBulkEdit = () => {
    const selected = parsedRows.filter(r => r.selected);
    if (selected.length === 0) return;

    setParsedRows(prev => prev.map(r => {
      if (!r.selected) return r;
      return {
        ...r,
        category: bulkCategory || r.category,
        lineItem: bulkLineItem || r.lineItem,
        payer: bulkPayer || r.payer,
        isUnknown: bulkCategory && bulkLineItem ? false : r.isUnknown,
        mappingSource: 'user',
      };
    }));

    setBulkCategory('');
    setBulkLineItem('');
    setBulkPayer('');
  };

  // Trigger LLM Smart Categorization for unmapped / unknown items
  const handleRunAiCategorization = async () => {
    const unmapped = parsedRows.filter(r => r.isUnknown || r.lineItem === 'Unknown');
    if (unmapped.length === 0) return;

    setIsAiMatching(true);
    setImportStatusMessage('Running AI smart categorization...');

    try {
      const payload = unmapped.map(u => ({
        rawDesc: u.rawDescription,
        normalized: u.normalizedMerchant || normalizeMerchant(u.rawDescription),
      }));

      const result = await batchCategorizeWithLLM(payload, catalogItems);

      if (result.status === 'SUCCESS' && result.matches.size > 0) {
        setParsedRows(prev => prev.map(r => {
          const key = (r.normalizedMerchant || normalizeMerchant(r.rawDescription)).toUpperCase();
          const match = result.matches.get(key);
          if (match && (r.isUnknown || r.lineItem === 'Unknown')) {
            return {
              ...r,
              category: match.category,
              lineItem: match.lineItem,
              isUnknown: false,
              mappingSource: 'llm',
            };
          }
          return r;
        }));
        setImportStatusMessage(`AI successfully categorized ${result.matches.size} of ${result.totalEvaluated} merchants.`);
      } else {
        setImportStatusMessage(result.errorMessage || 'AI categorization completed with no new matches.');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('AI categorization failed:', err);
      setImportStatusMessage(`AI categorization encountered an error: ${errMsg}`);
    } finally {
      setIsAiMatching(false);
    }
  };

  // Filtered rows for the worksheet
  const filteredRows = useMemo(() => {
    return parsedRows.filter(r => {
      if (hideDuplicates && r.isDuplicate) return false;

      // Filter tabs
      if (activeFilterTab === 'UNKNOWN' && !r.isUnknown && r.lineItem !== 'Unknown') return false;
      if (activeFilterTab === 'DUPLICATES' && !r.isDuplicate) return false;
      if (activeFilterTab === 'PAYMENTS' && !r.isPaymentTransfer) return false;

      // Search query
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          r.date.includes(q) ||
          r.rawDescription.toLowerCase().includes(q) ||
          r.normalizedMerchant.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.lineItem.toLowerCase().includes(q) ||
          r.notes.toLowerCase().includes(q) ||
          r.payer.toLowerCase().includes(q) ||
          r.amount.toString().includes(q)
        );
      }

      return true;
    });
  }, [parsedRows, hideDuplicates, activeFilterTab, searchTerm]);

  // Counts and totals
  const selectedRows = useMemo(() => parsedRows.filter(r => r.selected && !r.isPaymentTransfer), [parsedRows]);
  const totalSpendSelected = useMemo(() => selectedRows.reduce((sum, r) => sum + r.amount, 0), [selectedRows]);
  const unknownCount = useMemo(() => parsedRows.filter(r => r.isUnknown || r.lineItem === 'Unknown').length, [parsedRows]);
  const duplicateCount = useMemo(() => parsedRows.filter(r => r.isDuplicate).length, [parsedRows]);
  const paymentCount = useMemo(() => parsedRows.filter(r => r.isPaymentTransfer).length, [parsedRows]);

  // Execute Submission
  const handleExecuteSubmit = async () => {
    if (selectedRows.length === 0) return;

    setIsSubmitting(true);
    setSubmitProgress({ current: 0, total: selectedRows.length });
    const adapter = getStorageAdapter();

    try {
      // 1. Prepare ActualExpense records (strictly excluding any internal payments/transfers)
      const expensePayloads = selectedRows
        .filter(row => !row.isPaymentTransfer)
        .map(row => {
          const catDisplayName = `${row.category} - ${row.lineItem}`;
          const noteText = [row.rawDescription, row.notes].filter(Boolean).join(' | ');
          const catalogId = `cat_${row.category.toLowerCase()}_${row.lineItem.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

          return {
            date: row.date,
            amount: Math.round(row.amount * 100) / 100,
            catalogId,
            category: row.category,
            name: row.lineItem,
            categoryId: catalogId,
            categoryName: catDisplayName,
            enteredBy: row.payer || defaultPayer,
            notes: noteText || undefined,
          };
        });

      // 2. Commit batch to storage adapter
      if (adapter.saveExpensesBatch) {
        await adapter.saveExpensesBatch(expensePayloads);
      } else {
        for (let i = 0; i < expensePayloads.length; i++) {
          await adapter.saveExpense(expensePayloads[i]);
          if (i % 25 === 0) {
            setSubmitProgress({ current: i, total: expensePayloads.length });
          }
        }
      }
      setSubmitProgress({ current: expensePayloads.length, total: expensePayloads.length });

      // 3. Save confirmed merchant mappings to Learned Merchant Dictionary
      const rulesToSave: LearnedMerchantRule[] = selectedRows
        .filter(r => r.normalizedMerchant && r.lineItem !== 'Unknown')
        .map(r => ({
          normalizedKey: r.normalizedMerchant,
          category: r.category,
          lineItem: r.lineItem,
          lastUsed: new Date().toISOString(),
          matchCount: 1,
        }));

      if (rulesToSave.length > 0) {
        batchSaveLearnedMerchantRules(rulesToSave);
      }

      // 4. Update parent Actuals if hook provided
      if (onUpdateActualsLivingExpenses) {
        onUpdateActualsLivingExpenses(selectedYear, Math.round(totalSpendSelected));
      }

      onImportComplete(selectedRows.length, totalSpendSelected);
      onClose();
    } catch (err) {
      console.error('Failed to submit imported expenses:', err);
      setImportStatusMessage('An error occurred while saving expenses to persistent storage.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-md animate-fade-in font-sans">
      <div className="relative w-full max-w-[96vw] xl:max-w-7xl h-[94vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-slate-800/80 bg-slate-50/80 dark:bg-slate-950/60">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl text-white shadow-md shadow-indigo-500/20">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Expense Statement Ingestion Worksheet
                </h2>
                {fileName && (
                  <span className="text-xs text-slate-400 font-mono">({fileName})</span>
                )}
                {currentProfile && (
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 rounded-full text-indigo-700 dark:text-indigo-300 text-xs font-semibold">
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>{currentProfile.nickname}</span>
                    <button
                      onClick={() => {
                        setFormatSetupInitialMapping(currentProfile.mapping);
                        setIsFormatSetupOpen(true);
                      }}
                      title="Edit Statement Format Mapping"
                      className="p-0.5 hover:text-indigo-900 dark:hover:text-white rounded"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Upload credit card or bank statements, review intelligent category matches, and commit directly to storage.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {parsedRows.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 mr-2">
                <span>Default Payer:</span>
                <select
                  value={defaultPayer}
                  onChange={(e) => setDefaultPayer(e.target.value)}
                  className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-200"
                >
                  {payerOptions.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Gemini API Key configuration button */}
            <button
              onClick={() => {
                setGeminiApiKeyInput(getGeminiApiKey());
                setShowApiKeyClearText(false);
                setIsApiKeyModalOpen(true);
              }}
              title="Configure LLM API Key"
              className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-colors"
            >
              <Key className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status / Alert Banner */}
        {importStatusMessage && (
          <div className="flex items-center justify-between px-6 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>{importStatusMessage}</span>
            </div>
            <button onClick={() => setImportStatusMessage(null)} className="text-amber-600 hover:text-amber-900">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Content Area */}
        {parsedRows.length === 0 ? (
          /* Step 1: Upload or Paste */
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50/40 dark:bg-slate-900/40">
            <div className="w-full max-w-xl p-8 bg-white dark:bg-slate-800/80 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xl space-y-6">
              <div className="p-4 bg-indigo-50 dark:bg-indigo-950/50 rounded-2xl w-16 h-16 mx-auto flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                <Upload className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Import Statement Data
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Upload a CSV statement from your credit card or bank (Capital One, Chase, Checking, etc.).
                </p>
              </div>

              {/* Upload or Paste Tab Switcher */}
              <div className="flex items-center justify-center gap-2 p-1 bg-slate-100 dark:bg-slate-900 rounded-xl max-w-xs mx-auto text-xs font-semibold">
                <button
                  onClick={() => setActiveTab('upload')}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${
                    activeTab === 'upload'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Upload File
                </button>
                <button
                  onClick={() => setActiveTab('paste')}
                  className={`flex-1 py-1.5 rounded-lg transition-all ${
                    activeTab === 'paste'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Paste CSV
                </button>
              </div>

              {activeTab === 'upload' ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-indigo-500 dark:hover:border-indigo-400 rounded-2xl p-8 transition-colors bg-slate-50/50 dark:bg-slate-800/40 flex flex-col items-center justify-center gap-2 group"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".csv,.txt"
                    className="hidden"
                  />
                  <FileSpreadsheet className="w-8 h-8 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Click to browse or drop CSV file here
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Supports Capital One, Chase, Bank checking, and all standard formats
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    rows={6}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder="Paste CSV text with header row here..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    onClick={handlePasteParse}
                    disabled={!csvText.trim() || isParsing}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition-colors disabled:opacity-50"
                  >
                    {isParsing ? 'Parsing Statement...' : 'Parse Statement Data'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Step 2: Interactive Review Worksheet Grid */
          <div className="flex-1 flex flex-col min-h-0 bg-slate-50/50 dark:bg-slate-950/40">
            {/* Filter & Action Toolbar */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-[280px] max-w-md">
                <div className="relative w-full">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by merchant, expense name, amount..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  onClick={() => setActiveFilterTab('ALL')}
                  className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                    activeFilterTab === 'ALL'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  All ({parsedRows.length})
                </button>
                <button
                  onClick={() => setActiveFilterTab('UNKNOWN')}
                  className={`px-3 py-1 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                    activeFilterTab === 'UNKNOWN'
                      ? 'bg-amber-600 text-white'
                      : 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                  }`}
                >
                  <span>Needs Review</span>
                  <span className="px-1.5 py-0.2 bg-amber-100 dark:bg-amber-900/60 rounded-full text-[10px]">
                    {unknownCount}
                  </span>
                </button>
                <button
                  onClick={() => setActiveFilterTab('DUPLICATES')}
                  className={`px-3 py-1 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                    activeFilterTab === 'DUPLICATES'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>Duplicates</span>
                  <span className="px-1.5 py-0.2 bg-slate-200 dark:bg-slate-800 rounded-full text-[10px]">
                    {duplicateCount}
                  </span>
                </button>
                <button
                  onClick={() => setActiveFilterTab('PAYMENTS')}
                  className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                    activeFilterTab === 'PAYMENTS'
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  Payments ({paymentCount})
                </button>
              </div>

              {/* Duplicates toggle & AI Match Button */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hideDuplicates}
                    onChange={(e) => setHideDuplicates(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Hide Duplicates</span>
                </label>

                {unknownCount > 0 && (
                  <button
                    onClick={handleRunAiCategorization}
                    disabled={isAiMatching}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isAiMatching ? 'animate-spin' : ''}`} />
                    <span>{isAiMatching ? 'Categorizing...' : `Smart Match AI (${unknownCount})`}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Bulk Action Bar (when rows are selected) */}
            {selectedRows.length > 0 && (
              <div className="px-6 py-2.5 bg-indigo-50/90 dark:bg-indigo-950/70 border-b border-indigo-200 dark:border-indigo-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200 font-semibold">
                  <span>{selectedRows.length} rows selected</span>
                  <span className="text-indigo-400 dark:text-indigo-500">•</span>
                  <span>Total: ${totalSpendSelected.toFixed(2)}</span>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={bulkCategory}
                    onChange={(e) => setBulkCategory(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="">-- Set Category --</option>
                    {availableCategoryGroups.map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>

                  <select
                    value={bulkLineItem}
                    onChange={(e) => setBulkLineItem(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="">-- Set Expense Name --</option>
                    {catalogItems
                      .filter(c => !bulkCategory || c.groupCategory === bulkCategory)
                      .map(i => (
                        <option key={i.id} value={i.name}>{i.name}</option>
                      ))}
                  </select>

                  <select
                    value={bulkPayer}
                    onChange={(e) => setBulkPayer(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="">-- Set Payer --</option>
                    {payerOptions.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>

                  <button
                    onClick={handleApplyBulkEdit}
                    className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm"
                  >
                    Apply Bulk Edit
                  </button>
                </div>
              </div>
            )}

            {/* Table Worksheet */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 font-semibold shadow-sm">
                  <tr>
                    <th className="py-2.5 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedRows.length > 0 && selectedRows.length === filteredRows.filter(r => !r.isPaymentTransfer).length}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </th>
                    <th className="py-2.5 px-3 w-24">Date</th>
                    <th className="py-2.5 px-3 min-w-[200px]">Merchant / Payee</th>
                    <th className="py-2.5 px-3 w-36">Category</th>
                    <th className="py-2.5 px-3 w-48">Expense Name</th>
                    <th className="py-2.5 px-3 w-28 text-right">Amount</th>
                    <th className="py-2.5 px-3 min-w-[150px]">Notes</th>
                    <th className="py-2.5 px-3 w-28">Payer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-sans">
                  {filteredRows.map(row => {
                    const isRowUnknown = row.isUnknown || row.lineItem === 'Unknown';
                    const categoryLineItems = catalogItems.filter(c => c.groupCategory === row.category);

                    return (
                      <tr
                        key={row.id}
                        className={`transition-colors ${
                          row.isPaymentTransfer
                            ? 'opacity-40 bg-slate-100/30 dark:bg-slate-900/30'
                            : row.isDuplicate
                            ? 'bg-slate-100/50 dark:bg-slate-900/50 text-slate-500'
                            : isRowUnknown
                            ? 'bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-50/70'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        {/* Select Checkbox */}
                        <td className="py-2 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={row.selected && !row.isPaymentTransfer}
                            disabled={row.isPaymentTransfer}
                            title={row.isPaymentTransfer ? "Payments and transfers are automatically excluded from storage" : undefined}
                            onChange={() => handleToggleRow(row.id)}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          />
                        </td>

                        {/* Date */}
                        <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {row.date}
                        </td>

                        {/* Merchant & Badges */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {row.normalizedMerchant || row.rawDescription}
                            </span>

                            {row.isDuplicate && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                Duplicate
                              </span>
                            )}

                            {row.isPaymentTransfer && (
                              <span
                                title="Internal payment / transfer - excluded from stored expenses"
                                className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300"
                              >
                                Payment (Excluded)
                              </span>
                            )}

                            {isRowUnknown && !row.isPaymentTransfer && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                                Unknown
                              </span>
                            )}

                            {row.mappingSource === 'learned' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
                                Learned
                              </span>
                            )}

                            {row.mappingSource === 'llm' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300">
                                AI
                              </span>
                            )}
                          </div>
                          {row.rawDescription !== row.normalizedMerchant && (
                            <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-xs">
                              {row.rawDescription}
                            </div>
                          )}
                        </td>

                        {/* Category Dropdown */}
                        <td className="py-2 px-3">
                          <select
                            value={row.category}
                            onChange={(e) => handleUpdateRowCategory(row.id, e.target.value)}
                            className="w-full py-1 px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-1 focus:ring-indigo-500"
                          >
                            {availableCategoryGroups.map(g => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                        </td>

                        {/* Line Item Dropdown with Add-on-the-fly */}
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1">
                            <select
                              value={row.lineItem}
                              onChange={(e) => {
                                if (e.target.value === '__CREATE_NEW__') {
                                  setInlineCreateRowId(row.id);
                                  setNewItemCategory(row.category);
                                } else {
                                  handleUpdateRowLineItem(row.id, e.target.value);
                                }
                              }}
                              className={`w-full py-1 px-2 text-xs rounded-lg border ${
                                row.lineItem === 'Unknown'
                                  ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 font-semibold'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200'
                              } focus:ring-1 focus:ring-indigo-500`}
                            >
                              {categoryLineItems.map(item => (
                                <option key={item.id} value={item.name}>{item.name}</option>
                              ))}
                              <option value="Unknown">Unknown / Uncategorized</option>
                              <option value="__CREATE_NEW__">+ Create New Expense Name...</option>
                            </select>
                          </div>
                        </td>

                        {/* Amount */}
                        <td className={`py-2 px-3 text-right font-mono font-bold whitespace-nowrap ${
                          row.amount < 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}>
                          {row.amount < 0 ? `-$${Math.abs(row.amount).toFixed(2)}` : `$${row.amount.toFixed(2)}`}
                        </td>

                        {/* Notes */}
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={row.notes}
                            onChange={(e) => handleUpdateRowNotes(row.id, e.target.value)}
                            placeholder="Add memo..."
                            className="w-full py-1 px-2 text-xs rounded-lg border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:border-indigo-500 bg-transparent dark:focus:bg-slate-800 text-slate-700 dark:text-slate-300"
                          />
                        </td>

                        {/* Payer */}
                        <td className="py-2 px-3">
                          <select
                            value={row.payer}
                            onChange={(e) => handleUpdateRowPayer(row.id, e.target.value)}
                            className="w-full py-1 px-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                          >
                            {payerOptions.map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom Worksheet Bar */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-4 text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  Ready to Commit:{' '}
                  <strong className="text-slate-900 dark:text-slate-100">{selectedRows.length}</strong> of{' '}
                  {parsedRows.length} transactions
                </span>
                <span className="text-slate-300 dark:text-slate-700">|</span>
                <span className="text-slate-500 dark:text-slate-400">
                  Total Spend:{' '}
                  <strong className="text-indigo-600 dark:text-indigo-400 text-sm">
                    ${totalSpendSelected.toFixed(2)}
                  </strong>
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setParsedRows([]);
                    setCsvText('');
                  }}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium text-xs transition-colors"
                >
                  Clear & Re-Upload
                </button>
                <button
                  onClick={handleExecuteSubmit}
                  disabled={selectedRows.length === 0 || isSubmitting}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-lg shadow-indigo-600/20 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {isSubmitting
                      ? `Saving ${submitProgress.current}/${submitProgress.total}...`
                      : `Submit ${selectedRows.length} Expenses`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Format Setup Modal */}
      {isFormatSetupOpen && formatSetupInitialMapping && (
        <FormatSetupModal
          isOpen={isFormatSetupOpen}
          onClose={() => setIsFormatSetupOpen(false)}
          headers={rawHeaders}
          sampleRows={rawSampleLines}
          initialMapping={formatSetupInitialMapping}
          initialNickname={currentProfile?.nickname || 'New Statement Profile'}
          fingerprint={calculateHeaderFingerprint(rawHeaders)}
          onSaveProfile={handleSaveFormatProfile}
        />
      )}

      {/* Inline Create Item Modal */}
      {inlineCreateRowId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 w-full max-w-md space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Create New Expense Name
            </h3>
            <p className="text-xs text-slate-500">
              This new item will be safely added to your catalog with safe defaults ($0 budget) and will be available for all future statements.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Category Group
                </label>
                <select
                  value={newItemCategory}
                  onChange={(e) => setNewItemCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                >
                  {availableCategoryGroups.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Expense Name
                </label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="e.g. Lawn Care, Veterinary, Golf Membership"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setInlineCreateRowId(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNewItemOnTheFly}
                disabled={!newItemName.trim()}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
              >
                Create Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gemini API Key Configuration Modal */}
      {isApiKeyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-base">
                <Key className="w-5 h-5" />
                <span>AI Categorization Settings</span>
              </div>
              <button
                onClick={() => {
                  setShowApiKeyClearText(false);
                  setIsApiKeyModalOpen(false);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              In Local and Demo mode, smart categorization uses <strong>Google Gemini Flash</strong>. Your API key is stored locally in your browser and is never committed or sent to any third party. In Cloud mode, AWS Bedrock Nova Micro is automatically utilized via IAM.
            </p>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Google Gemini API Key
                </label>
                <span className="text-[11px] text-slate-400 dark:text-slate-500 select-none">
                  Hold icon to view
                </span>
              </div>
              <div className="relative flex items-center">
                <input
                  type={showApiKeyClearText ? 'text' : 'password'}
                  value={geminiApiKeyInput}
                  onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full pl-3.5 pr-10 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  title="Press and hold to view API key in clear text"
                  aria-label="Press and hold to view API key in clear text"
                  onMouseDown={() => setShowApiKeyClearText(true)}
                  onMouseUp={() => setShowApiKeyClearText(false)}
                  onMouseLeave={() => setShowApiKeyClearText(false)}
                  onTouchStart={() => setShowApiKeyClearText(true)}
                  onTouchEnd={() => setShowApiKeyClearText(false)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      setShowApiKeyClearText(true);
                    }
                  }}
                  onKeyUp={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      setShowApiKeyClearText(false);
                    }
                  }}
                  className="absolute right-2 p-1.5 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 rounded-lg select-none cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  {showApiKeyClearText ? (
                    <EyeOff className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowApiKeyClearText(false);
                  setIsApiKeyModalOpen(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  saveGeminiApiKey(geminiApiKeyInput);
                  setShowApiKeyClearText(false);
                  setIsApiKeyModalOpen(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
};
