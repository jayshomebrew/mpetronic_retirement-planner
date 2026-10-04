import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  AlertCircle,
  RefreshCw,
  Trash2,
  Check,
  Search,
  Pencil,
  Plus,
  Tag,
  User,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { getStorageAdapter } from '../shared/storage';
import { ActualExpense } from '../shared/types/expenses';
import {
  getPlannerExpenseCatalog,
  batchRegisterPlannerExpenseLineItems,
  PlannerExpenseLineItem,
} from '../shared/utils/plannerCategories';
import { getPlannerProfileNames, resolveLoggedInPayerName } from '../shared/utils/profileNames';

export interface ImportExpensesModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedYear: number;
  onImportComplete: (importedCount: number, totalAmount: number) => void;
  onUpdateActualsLivingExpenses?: (year: number, amount: number) => void;
}

interface ParsedTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  category: string;
  lineItem: string;
  description: string;
  payer: string;
  notes: string;
  isDuplicate: boolean;
  isPaymentTransfer: boolean;
  selected: boolean;
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
  const [parsedRows, setParsedRows] = useState<ParsedTransaction[]>([]);
  const [existingExpenses, setExistingExpenses] = useState<ActualExpense[]>([]);
  const [targetYear, setTargetYear] = useState<number>(selectedYear);
  const [defaultPayer, setDefaultPayer] = useState<string>(() => resolveLoggedInPayerName() || 'Primary');
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [updateActualsRecord, setUpdateActualsRecord] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [hideDuplicates, setHideDuplicates] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null);

  // Available Planner Catalog Items
  const [catalogItems, setCatalogItems] = useState<PlannerExpenseLineItem[]>(() => getPlannerExpenseCatalog());

  // Editing Single Row Modal State
  const [editingTransaction, setEditingTransaction] = useState<ParsedTransaction | null>(null);
  const [editCategory, setEditCategory] = useState<string>('Living');
  const [editLineItem, setEditLineItem] = useState<string>('');
  const [editDescription, setEditDescription] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editPayer, setEditPayer] = useState<string>('');
  const [editAmount, setEditAmount] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');
  const [applyToMatchingMerchants, setApplyToMatchingMerchants] = useState<boolean>(true);
  const [isCreatingCustomItem, setIsCreatingCustomItem] = useState<boolean>(false);
  const [customItemName, setCustomItemName] = useState<string>('');
  const [customItemGroup, setCustomItemGroup] = useState<string>('Living');

  // Bulk Edit Modal State
  const [bulkEditOpen, setBulkEditOpen] = useState<boolean>(false);
  const [bulkCategory, setBulkCategory] = useState<string>('');
  const [bulkLineItem, setBulkLineItem] = useState<string>('');
  const [bulkPayer, setBulkPayer] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing expenses for duplicate detection
  useEffect(() => {
    if (isOpen) {
      const adapter = getStorageAdapter();
      adapter.getExpenses(targetYear).then(exps => {
        setExistingExpenses(exps);
      }).catch(err => console.error('Failed to load existing expenses:', err));

      setCatalogItems(getPlannerExpenseCatalog());
    }
  }, [isOpen, targetYear]);

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

  // Standard category groups
  const standardCategoryGroups = useMemo(() => {
    const groups = new Set<string>(['Housing', 'Transportation', 'Living', 'Insurance', 'Healthcare', 'Leisure', 'Charities', 'Other']);
    catalogItems.forEach(i => { if (i.groupCategory) groups.add(i.groupCategory); });
    return Array.from(groups);
  }, [catalogItems]);

  // Parse CSV text into candidate transactions
  const parseCsvData = (rawContent: string) => {
    setIsParsing(true);
    setImportStatusMessage(null);

    try {
      const lines = rawContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        setImportStatusMessage('CSV file is empty or does not contain data rows.');
        setIsParsing(false);
        return;
      }

      const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
      
      // Column index detection
      let dateIdx = headers.findIndex(h => h.includes('transactiondate') || h.includes('date'));
      const postDateIdx = headers.findIndex(h => h.includes('postdate'));
      if (dateIdx === -1 && postDateIdx !== -1) dateIdx = postDateIdx;

      let amountIdx = headers.findIndex(h => h === 'amount' || h.includes('amt') || h.includes('spend'));
      let categoryIdx = headers.findIndex(h => h === 'category' || h.includes('group') || h.includes('categorygroup'));
      let lineItemIdx = headers.findIndex(h => h.includes('lineitem') || h.includes('item') || h.includes('subcategory'));
      let descIdx = headers.findIndex(h => h.includes('description') || h.includes('merchant') || h.includes('payee') || h.includes('memo') || h.includes('name'));
      const payerIdx = headers.findIndex(h => h.includes('payer') || h.includes('enteredby') || h.includes('who'));
      const notesIdx = headers.findIndex(h => h.includes('notes') || h.includes('memo') || h.includes('comment'));
      const typeIdx = headers.findIndex(h => h.includes('type'));

      // If headers weren't found, fallback to standard target template positions
      if (dateIdx === -1) dateIdx = 0;
      if (amountIdx === -1) amountIdx = 1;
      if (categoryIdx === -1 && lineItemIdx === -1) {
        categoryIdx = 2;
        lineItemIdx = 3;
      }
      if (descIdx === -1) descIdx = 4;

      const candidates: ParsedTransaction[] = [];

      for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        if (row.length < 2) continue;

        const rawDate = row[dateIdx] || '';
        const isoDate = normalizeDate(rawDate);
        if (!isoDate || isoDate.length < 4) continue;

        const rawAmountStr = (row[amountIdx] || '0').replace(/[$,]/g, '').trim();
        const rawAmount = parseFloat(rawAmountStr);
        if (isNaN(rawAmount)) continue;

        const rawType = typeIdx !== -1 ? (row[typeIdx] || '').toLowerCase() : '';
        const rawDesc = descIdx !== -1 ? (row[descIdx] || '').trim() : '';
        const rawCat = categoryIdx !== -1 ? (row[categoryIdx] || '').trim() : 'Living';
        const rawLineItem = lineItemIdx !== -1 ? (row[lineItemIdx] || '').trim() : rawCat;
        const rawPayer = payerIdx !== -1 ? (row[payerIdx] || '').trim() : '';
        const rawNotes = notesIdx !== -1 ? (row[notesIdx] || '').trim() : '';

        // Check if internal credit card payment / transfer
        const isPaymentTransfer = 
          rawDesc.toUpperCase().includes('AUTOMATIC PAYMENT') || 
          rawDesc.toUpperCase().includes('CREDIT CARD PAYMENT') || 
          rawType === 'payment';

        // Normalize amount
        let netAmount: number;
        if (rawType === 'return' || rawType === 'reversal') {
          netAmount = -Math.abs(rawAmount);
        } else if (rawAmount < 0) {
          netAmount = Math.abs(rawAmount);
        } else {
          netAmount = rawAmount;
        }

        // Determine Category & Line Item
        let resolvedCategory = rawCat || 'Living';
        let resolvedLineItem = rawLineItem || 'Miscellaneous';

        if (resolvedLineItem.includes(' - ') && !rawCat) {
          const parts = resolvedLineItem.split(' - ');
          resolvedCategory = parts[0].trim();
          resolvedLineItem = parts.slice(1).join(' - ').trim();
        }

        // Duplicate check against existing logged expenses
        const isDuplicate = existingExpenses.some(e => {
          const sameDate = e.date === isoDate;
          const sameAmount = Math.abs(e.amount - netAmount) < 0.01;
          const notesLower = (e.notes || '').toLowerCase();
          const descLower = rawDesc.toLowerCase();
          const sameDesc = descLower ? notesLower.includes(descLower) || descLower.includes(notesLower) : true;
          return sameDate && sameAmount && sameDesc;
        });

        candidates.push({
          id: `txn_${i}_${Date.now()}`,
          date: isoDate,
          amount: Math.round(netAmount * 100) / 100,
          category: resolvedCategory,
          lineItem: resolvedLineItem,
          description: rawDesc,
          payer: rawPayer || defaultPayer,
          notes: rawNotes,
          isDuplicate,
          isPaymentTransfer,
          selected: !isPaymentTransfer && (!isDuplicate || importMode === 'replace'),
        });
      }

      setParsedRows(candidates);
      if (candidates.length > 0) {
        const years = candidates.map(c => parseInt(c.date.split('-')[0], 10)).filter(y => !isNaN(y));
        if (years.length > 0) {
          const mostCommonYear = years.sort((a,b) =>
            years.filter(v => v === a).length - years.filter(v => v === b).length
          ).pop();
          if (mostCommonYear) setTargetYear(mostCommonYear);
        }
      }
    } catch (err) {
      console.error('Failed to parse CSV:', err);
      setImportStatusMessage('An error occurred while parsing the CSV. Please check the file formatting.');
    } finally {
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
    setFileName('Pasted CSV Data');
    parseCsvData(csvText);
  };

  // Toggle selection
  const handleToggleRow = (id: string) => {
    setParsedRows(prev => prev.map(r => r.id === id ? { ...r, selected: !r.selected } : r));
  };

  const handleSelectAll = (select: boolean) => {
    setParsedRows(prev => prev.map(r => r.isPaymentTransfer ? r : { ...r, selected: select }));
  };

  // Filtered rows for the preview table
  const filteredRows = useMemo(() => {
    return parsedRows.filter(r => {
      if (hideDuplicates && r.isDuplicate) return false;
      if (categoryFilter !== 'ALL' && r.category !== categoryFilter) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          r.date.includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.lineItem.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.payer.toLowerCase().includes(q) ||
          r.amount.toString().includes(q)
        );
      }
      return true;
    });
  }, [parsedRows, categoryFilter, searchTerm, hideDuplicates]);

  // Available unique categories in parsed rows
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    parsedRows.forEach(r => { if (r.category) set.add(r.category); });
    return Array.from(set);
  }, [parsedRows]);

  // Selected totals
  const selectedRows = useMemo(() => parsedRows.filter(r => r.selected), [parsedRows]);
  const totalSpendSelected = useMemo(() => selectedRows.reduce((sum, r) => sum + r.amount, 0), [selectedRows]);
  const duplicateCount = useMemo(() => parsedRows.filter(r => r.isDuplicate).length, [parsedRows]);

  // Open Single Row Edit Modal
  const handleOpenRowEditor = (row: ParsedTransaction) => {
    setEditingTransaction(row);
    setEditCategory(row.category || 'Living');
    setEditLineItem(row.lineItem || '');
    setEditDescription(row.description || '');
    setEditNotes(row.notes || '');
    setEditPayer(row.payer || defaultPayer);
    setEditAmount(row.amount.toString());
    setEditDate(row.date);
    setIsCreatingCustomItem(false);
    setCustomItemName('');
    setCustomItemGroup(row.category || 'Living');
    setApplyToMatchingMerchants(true);
  };

  // Handle Create New Line Item on the Fly
  const handleCreateNewItem = () => {
    const trimmedName = customItemName.trim();
    if (!trimmedName) return;

    const group = customItemGroup.trim() || 'Living';
    batchRegisterPlannerExpenseLineItems([{ name: trimmedName, groupCategory: group }]);
    const refreshed = getPlannerExpenseCatalog();
    setCatalogItems(refreshed);

    setEditCategory(group);
    setEditLineItem(trimmedName);
    setIsCreatingCustomItem(false);
    setCustomItemName('');
  };

  // Save Single Row Changes
  const handleSaveRowEdit = () => {
    if (!editingTransaction) return;
    const parsedAmt = parseFloat(editAmount);
    const validAmount = isNaN(parsedAmt) ? editingTransaction.amount : parsedAmt;

    const targetMerchant = editingTransaction.description.trim().toLowerCase();

    setParsedRows(prev => prev.map(r => {
      const isTargetRow = r.id === editingTransaction.id;
      const isMatchingMerchant = applyToMatchingMerchants && targetMerchant && r.description.trim().toLowerCase() === targetMerchant;

      if (isTargetRow) {
        return {
          ...r,
          date: editDate || r.date,
          amount: validAmount,
          category: editCategory,
          lineItem: editLineItem || r.lineItem,
          description: editDescription,
          notes: editNotes,
          payer: editPayer || defaultPayer,
        };
      } else if (isMatchingMerchant) {
        return {
          ...r,
          category: editCategory,
          lineItem: editLineItem || r.lineItem,
          payer: editPayer || r.payer,
        };
      }
      return r;
    }));

    setEditingTransaction(null);
  };

  // Save Bulk Changes
  const handleSaveBulkEdit = () => {
    if (selectedRows.length === 0) return;

    setParsedRows(prev => prev.map(r => {
      if (!r.selected) return r;
      return {
        ...r,
        category: bulkCategory ? bulkCategory : r.category,
        lineItem: bulkLineItem ? bulkLineItem : r.lineItem,
        payer: bulkPayer ? bulkPayer : r.payer,
      };
    }));

    setBulkEditOpen(false);
    setBulkCategory('');
    setBulkLineItem('');
    setBulkPayer('');
  };

  // Execute Import
  const handleExecuteImport = async () => {
    if (selectedRows.length === 0) return;

    setIsImporting(true);
    setImportProgress({ current: 0, total: selectedRows.length });
    const adapter = getStorageAdapter();

    try {
      // 1. Batch register all missing catalog line items in a single memory/storage pass
      const catalogItemsToRegister = selectedRows.map(r => ({
        name: r.lineItem,
        groupCategory: r.category,
      }));
      const resolvedCatalogMap = batchRegisterPlannerExpenseLineItems(catalogItemsToRegister);

      // 2. If replace mode is chosen, delete existing expenses for target year
      if (importMode === 'replace') {
        const existingYearExpenses = await adapter.getExpenses(targetYear);
        for (const exp of existingYearExpenses) {
          await adapter.deleteExpense(exp.expenseId);
        }
      }

      // 3. Prepare full payload of ActualExpense records
      const expensePayloads = selectedRows.map(row => {
        const mapKey = `${row.category.toLowerCase()}:::${row.lineItem.toLowerCase()}`;
        const registered = resolvedCatalogMap.get(mapKey);
        const catId = registered?.id || `cat_${row.category.toLowerCase()}_${row.lineItem.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        const catDisplayName = registered?.displayName || `${row.category} - ${row.lineItem}`;
        const noteText = [row.description, row.notes].filter(Boolean).join(' | ');

        return {
          date: row.date,
          amount: Math.round(row.amount * 100) / 100,
          categoryId: catId,
          categoryName: catDisplayName,
          enteredBy: row.payer || defaultPayer,
          notes: noteText || undefined,
        };
      });

      // 4. Atomic batch insert into storage adapter
      if (adapter.saveExpensesBatch) {
        await adapter.saveExpensesBatch(expensePayloads);
      } else {
        for (let i = 0; i < expensePayloads.length; i++) {
          await adapter.saveExpense(expensePayloads[i]);
          if (i % 50 === 0) {
            setImportProgress({ current: i, total: expensePayloads.length });
          }
        }
      }
      setImportProgress({ current: expensePayloads.length, total: expensePayloads.length });

      // 5. Update Year Actuals Record living expenses if checked
      if (updateActualsRecord && onUpdateActualsLivingExpenses) {
        onUpdateActualsLivingExpenses(targetYear, Math.round(totalSpendSelected));
      }

      // 6. Dispatch global sync event ONCE at the end
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cloud_expenses_synced'));
      }

      onImportComplete(expensePayloads.length, totalSpendSelected);
      onClose();
    } catch (err) {
      console.error('Import execution failed:', err);
      setImportStatusMessage('An error occurred during bulk import. Please check your connection and storage settings.');
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Import / Backfill Actual Expenses
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {targetYear}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Review, edit, categorize, and assign payers before committing expenses into your household ledger.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar text-slate-200">
          
          {/* Source Tabs */}
          {parsedRows.length === 0 ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('upload')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'upload'
                      ? 'bg-emerald-500 text-slate-950 shadow'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  Upload CSV File
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('paste')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    activeTab === 'paste'
                      ? 'bg-emerald-500 text-slate-950 shadow'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Paste CSV Text
                </button>
              </div>

              {activeTab === 'upload' ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-2xl p-10 flex flex-col items-center justify-center gap-3 bg-slate-950/40 hover:bg-slate-950/60 transition-all cursor-pointer group"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                    <Upload className="w-7 h-7" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-white">Click or drag a CSV file here to upload</p>
                    <p className="text-xs text-slate-400 mt-1">Accepts mapped template CSV or bank export CSV</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    rows={10}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder="Paste CSV rows here including the header row (e.g. Transaction Date, Amount, Category, Line Item, Description, Payer, Notes)..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 custom-scrollbar"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handlePasteParse}
                      disabled={!csvText.trim() || isParsing}
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer shadow-md"
                    >
                      {isParsing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 stroke-[2.5]" />}
                      Parse CSV
                    </button>
                  </div>
                </div>
              )}

              {importStatusMessage && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{importStatusMessage}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {/* Configuration Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-slate-950/60 border border-slate-800 rounded-xl text-xs">
                {/* Target Year */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Target Year
                  </label>
                  <input
                    type="number"
                    value={targetYear}
                    onChange={(e) => setTargetYear(parseInt(e.target.value, 10) || selectedYear)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 font-bold text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Default Payer */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Default Payer
                  </label>
                  <select
                    value={defaultPayer}
                    onChange={(e) => {
                      setDefaultPayer(e.target.value);
                      setParsedRows(prev => prev.map(r => (!r.payer || r.payer === defaultPayer) ? { ...r, payer: e.target.value } : r));
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 font-medium text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    {payerOptions.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                {/* Import Mode */}
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Import Mode
                  </label>
                  <select
                    value={importMode}
                    onChange={(e) => {
                      const newMode = e.target.value as 'append' | 'replace';
                      setImportMode(newMode);
                      if (newMode === 'replace') {
                        setParsedRows(prev => prev.map(r => ({ ...r, selected: !r.isPaymentTransfer })));
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 font-medium text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="append">Append & Skip Duplicates</option>
                    <option value="replace">Replace Year {targetYear} (Fresh Backfill)</option>
                  </select>
                </div>
              </div>

              {/* Stats & KPI Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Selected Transactions</span>
                  <div className="text-lg font-bold text-white mt-0.5">
                    {selectedRows.length} <span className="text-xs text-slate-400 font-normal">/ {parsedRows.length}</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Total Spend (Selected)</span>
                  <div className="text-lg font-bold text-emerald-400 mt-0.5">
                    ${totalSpendSelected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>

                <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Duplicates Detected</span>
                  <div className={`text-lg font-bold mt-0.5 ${duplicateCount > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                    {duplicateCount}
                  </div>
                </div>

                <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Active File</span>
                    <div className="text-xs font-medium text-slate-200 truncate max-w-[120px] mt-0.5" title={fileName}>
                      {fileName || 'CSV'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setParsedRows([]);
                      setCsvText('');
                      setFileName('');
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Clear and load new file"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Table Search & Bulk Action Strip */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search transactions, merchants, notes..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="ALL">All Categories</option>
                    {availableCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs text-slate-300 font-medium cursor-pointer select-none bg-slate-900/80 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 px-2.5 py-1 rounded-lg transition-colors">
                    <input
                      type="checkbox"
                      checked={hideDuplicates}
                      onChange={(e) => setHideDuplicates(e.target.checked)}
                      className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                    />
                    <span>Hide Duplicates</span>
                    {duplicateCount > 0 && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                        {duplicateCount}
                      </span>
                    )}
                  </label>
                  {selectedRows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setBulkEditOpen(true)}
                      className="px-3 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 transition-colors font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Bulk Edit Selected ({selectedRows.length})</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSelectAll(true)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors font-medium cursor-pointer"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAll(false)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors font-medium cursor-pointer"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              {/* Preview Table */}
              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40 shadow-inner">
                <div className="max-h-80 overflow-y-auto custom-scrollbar">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-900/90 text-slate-400 sticky top-0 z-10 border-b border-slate-800 font-semibold uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="p-2.5 text-center w-10">
                          <input
                            type="checkbox"
                            checked={selectedRows.length === parsedRows.length && parsedRows.length > 0}
                            onChange={(e) => handleSelectAll(e.target.checked)}
                            className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                          />
                        </th>
                        <th className="p-2.5">Date</th>
                        <th className="p-2.5">Category & Line Item</th>
                        <th className="p-2.5">Merchant / Notes</th>
                        <th className="p-2.5">Payer</th>
                        <th className="p-2.5 text-right">Amount</th>
                        <th className="p-2.5 text-center">Status</th>
                        <th className="p-2.5 text-center w-16">Edit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {filteredRows.map((row) => (
                        <tr
                          key={row.id}
                          className={`hover:bg-slate-900/40 transition-colors ${
                            !row.selected ? 'opacity-40 bg-slate-950/60' : ''
                          } ${row.isPaymentTransfer ? 'bg-rose-950/10' : ''}`}
                        >
                          <td className="p-2.5 text-center">
                            <input
                              type="checkbox"
                              checked={row.selected}
                              disabled={row.isPaymentTransfer}
                              onChange={() => handleToggleRow(row.id)}
                              className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                            />
                          </td>
                          <td className="p-2.5 font-mono text-slate-300 whitespace-nowrap">{row.date}</td>
                          <td className="p-2.5 cursor-pointer" onClick={() => handleOpenRowEditor(row)}>
                            <div className="font-semibold text-white flex items-center gap-1.5 group">
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-bold text-emerald-400 group-hover:bg-slate-700">
                                {row.category}
                              </span>
                              <span className="underline decoration-slate-700 underline-offset-2 group-hover:text-emerald-300">
                                {row.lineItem}
                              </span>
                            </div>
                          </td>
                          <td
                            className="p-2.5 text-slate-300 max-w-[220px] truncate cursor-pointer hover:text-white"
                            title={row.description}
                            onClick={() => handleOpenRowEditor(row)}
                          >
                            <span>{row.description || <span className="text-slate-500 italic">None</span>}</span>
                            {row.notes && <span className="text-slate-500 text-[10px] block truncate">{row.notes}</span>}
                          </td>
                          <td className="p-2.5 text-slate-300 whitespace-nowrap cursor-pointer hover:text-white" onClick={() => handleOpenRowEditor(row)}>
                            <span className="px-2 py-0.5 rounded bg-slate-800/80 text-[11px] font-medium border border-slate-700/60">
                              {row.payer}
                            </span>
                          </td>
                          <td className="p-2.5 text-right font-mono font-bold whitespace-nowrap">
                            <span className={row.amount < 0 ? 'text-teal-400' : 'text-slate-100'}>
                              ${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </td>
                          <td className="p-2.5 text-center whitespace-nowrap">
                            {row.isPaymentTransfer ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                Payment / Transfer (Skipped)
                              </span>
                            ) : row.isDuplicate ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                Duplicate
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                New
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => handleOpenRowEditor(row)}
                              className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                              title="Edit Category, Notes, or Payer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Checkbox: Also update Year Actuals record */}
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
                <input
                  type="checkbox"
                  id="updateActualsCheck"
                  checked={updateActualsRecord}
                  onChange={(e) => setUpdateActualsRecord(e.target.checked)}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="updateActualsCheck" className="text-slate-300 cursor-pointer">
                  Update <strong>Year {targetYear} Living Expenses Actuals</strong> in planner ledger to match this backfilled sum (
                  <strong className="text-emerald-400">${Math.round(totalSpendSelected).toLocaleString()}</strong>)
                </label>
              </div>

              {/* Progress Indicator if importing */}
              {isImporting && (
                <div className="space-y-2 p-3 bg-slate-950 border border-emerald-500/30 rounded-xl">
                  <div className="flex items-center justify-between text-xs text-emerald-300 font-semibold">
                    <span>Importing transactions into household ledger...</span>
                    <span>{importProgress.current} / {importProgress.total} ({Math.round((importProgress.current / importProgress.total) * 100)}%)</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-2 transition-all duration-150 rounded-full"
                      style={{ width: `${(importProgress.current / (importProgress.total || 1)) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          {parsedRows.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={selectedRows.length === 0 || isImporting}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2 transition-all shadow-lg shadow-emerald-950/50 disabled:opacity-50 cursor-pointer"
              >
                {isImporting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 stroke-[2.5]" />
                )}
                <span>Import {selectedRows.length} Expenses (${Math.round(totalSpendSelected).toLocaleString()})</span>
              </button>
            </div>
          )}
        </div>

      </div>

      {/* --- Single Transaction Edit Dialog Modal --- */}
      {editingTransaction && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden text-slate-200">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Edit Transaction Details</h3>
                  <p className="text-[11px] text-slate-400">
                    {editingTransaction.date} • ${editingTransaction.amount.toFixed(2)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingTransaction(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 text-xs">
              {/* Category & Line Item Selector */}
              <div className="space-y-2 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-emerald-400" />
                    Category & Line Item
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsCreatingCustomItem(!isCreatingCustomItem)}
                    className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{isCreatingCustomItem ? 'Choose Existing' : '+ Create New Line Item'}</span>
                  </button>
                </div>

                {isCreatingCustomItem ? (
                  <div className="space-y-2.5 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-slate-400 font-medium block mb-1">Group Category</span>
                        <select
                          value={customItemGroup}
                          onChange={(e) => setCustomItemGroup(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                        >
                          {standardCategoryGroups.map(grp => (
                            <option key={grp} value={grp}>{grp}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <span className="text-[10px] text-slate-400 font-medium block mb-1">New Line Item Name</span>
                        <input
                          type="text"
                          placeholder="e.g. Property Taxes, Landscaping"
                          value={customItemName}
                          onChange={(e) => setCustomItemName(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleCreateNewItem}
                      disabled={!customItemName.trim()}
                      className="w-full py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Add & Select Line Item</span>
                    </button>
                  </div>
                ) : (
                  <div>
                    <select
                      value={`${editCategory}:::${editLineItem}`}
                      onChange={(e) => {
                        const [grp, item] = e.target.value.split(':::');
                        setEditCategory(grp);
                        setEditLineItem(item);
                      }}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500 cursor-pointer"
                    >
                      {standardCategoryGroups.map(grp => {
                        const itemsInGroup = catalogItems.filter(i => (i.groupCategory || 'Living') === grp);
                        return (
                          <optgroup key={grp} label={`Category: ${grp}`}>
                            {itemsInGroup.map(item => (
                              <option key={item.id} value={`${grp}:::${item.name}`}>
                                {grp} → {item.name}
                              </option>
                            ))}
                            {/* Fallback if current line item is not yet in catalog */}
                            {editCategory === grp && !itemsInGroup.some(i => i.name === editLineItem) && editLineItem && (
                              <option value={`${grp}:::${editLineItem}`}>
                                {grp} → {editLineItem} (Custom)
                              </option>
                            )}
                          </optgroup>
                        );
                      })}
                    </select>
                  </div>
                )}
              </div>

              {/* Merchant / Description & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Merchant / Description
                  </label>
                  <input
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Notes / Memo
                  </label>
                  <input
                    type="text"
                    placeholder="Optional memo or tags..."
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Payer, Amount & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1 flex items-center gap-1">
                    <User className="w-3 h-3 text-emerald-400" />
                    Payer
                  </label>
                  <select
                    value={editPayer}
                    onChange={(e) => setEditPayer(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    {payerOptions.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Amount ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Transaction Date
                  </label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Checkbox: Propagate to matching merchants */}
              {editingTransaction.description && (
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    id="applyMatchingCheck"
                    checked={applyToMatchingMerchants}
                    onChange={(e) => setApplyToMatchingMerchants(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="applyMatchingCheck" className="text-slate-300 text-xs cursor-pointer">
                    Also apply this Category, Line Item, and Payer to all other transactions matching <strong>"{editingTransaction.description}"</strong>
                  </label>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-800 bg-slate-900 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setEditingTransaction(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRowEdit}
                className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Save Changes</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Bulk Edit Modal --- */}
      {bulkEditOpen && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-200">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Bulk Edit Selected Transactions</h3>
                  <p className="text-[11px] text-slate-400">
                    Applying changes to {selectedRows.length} selected transaction{selectedRows.length === 1 ? '' : 's'}.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBulkEditOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Assign Category & Line Item (Optional)
                </label>
                <select
                  value={bulkCategory && bulkLineItem ? `${bulkCategory}:::${bulkLineItem}` : ''}
                  onChange={(e) => {
                    if (!e.target.value) {
                      setBulkCategory('');
                      setBulkLineItem('');
                    } else {
                      const [grp, item] = e.target.value.split(':::');
                      setBulkCategory(grp);
                      setBulkLineItem(item);
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="">-- Leave Unchanged --</option>
                  {standardCategoryGroups.map(grp => (
                    <optgroup key={grp} label={`Category: ${grp}`}>
                      {catalogItems.filter(i => (i.groupCategory || 'Living') === grp).map(item => (
                        <option key={item.id} value={`${grp}:::${item.name}`}>
                          {grp} → {item.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Assign Payer (Optional)
                </label>
                <select
                  value={bulkPayer}
                  onChange={(e) => setBulkPayer(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="">-- Leave Unchanged --</option>
                  {payerOptions.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-800 bg-slate-900 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setBulkEditOpen(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveBulkEdit}
                disabled={!bulkCategory && !bulkPayer}
                className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-md disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Apply to Selected</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
