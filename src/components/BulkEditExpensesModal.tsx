import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  X,
  Search,
  Check,
  AlertCircle,
  Sliders,
  Tag,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  CheckSquare,
  Square,
  MinusSquare,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { getStorageAdapter } from '../shared/storage';
import { ActualExpense, LearnedMerchantRule } from '../shared/types/expenses';
import {
  getPlannerExpenseCatalog,
  getPlannerCategories,
  savePlannerExpenseLineItem,
  resolveExpenseCategoryAndLineItem,
  PlannerExpenseLineItem,
} from '../shared/utils/plannerCategories';
import { normalizeMerchant, batchSaveLearnedMerchantRules } from '../shared/utils/merchantMatcher';

export interface BulkEditExpensesModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedYear: number;
  recordedYears: number[];
  onExpensesUpdated: () => void;
  plannerCatalogItems?: PlannerExpenseLineItem[];
}

// Helper to format currency
function formatCurrency(amt: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amt);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const BulkEditExpensesModal: React.FC<BulkEditExpensesModalProps> = ({
  isOpen,
  onClose,
  selectedYear,
  recordedYears,
  onExpensesUpdated,
  plannerCatalogItems,
}) => {
  // Data loading state
  const [activeYearScope, setActiveYearScope] = useState<number | 'ALL'>(selectedYear);
  const [expenses, setExpenses] = useState<ActualExpense[]>([]);
  const [catalogItems, setCatalogItems] = useState<PlannerExpenseLineItem[]>(() => getPlannerExpenseCatalog());
  const [catalogCategories, setCatalogCategories] = useState<string[]>(() => {
    const cats = getPlannerCategories();
    const items = getPlannerExpenseCatalog();
    return Array.from(new Set([...cats, ...items.map((i) => i.groupCategory)])).sort();
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters state
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterLineItem, setFilterLineItem] = useState<string>('ALL');
  const [filterText, setFilterText] = useState<string>('');
  const [filterMonth, setFilterMonth] = useState<number | 'ALL'>('ALL');
  const [filterPayer, setFilterPayer] = useState<string>('ALL');

  // Sorting state
  const [sortField, setSortField] = useState<'date' | 'amount' | 'category' | 'lineItem' | 'payer'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Row selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Bulk Edit Inputs state
  const [updateCategoryEnabled, setUpdateCategoryEnabled] = useState<boolean>(false);
  const [targetCategory, setTargetCategory] = useState<string>('');
  const [isCustomCategory, setIsCustomCategory] = useState<boolean>(false);
  const [customCategoryInput, setCustomCategoryInput] = useState<string>('');

  const [updateLineItemEnabled, setUpdateLineItemEnabled] = useState<boolean>(false);
  const [targetLineItem, setTargetLineItem] = useState<string>('');
  const [isCustomLineItem, setIsCustomLineItem] = useState<boolean>(false);
  const [customLineItemInput, setCustomLineItemInput] = useState<string>('');

  const [updateNotesEnabled, setUpdateNotesEnabled] = useState<boolean>(false);
  const [noteMode, setNoteMode] = useState<'replace' | 'append' | 'clear'>('replace');
  const [targetNotes, setTargetNotes] = useState<string>('');

  const [updateMerchantRule, setUpdateMerchantRule] = useState<boolean>(false);

  // Confirmation & Execution state
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyProgress, setApplyProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Delete confirmation & Execution state
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  // Load catalog definitions
  const refreshCatalog = useCallback(() => {
    const items = getPlannerExpenseCatalog();
    setCatalogItems(items);
    const cats = getPlannerCategories();
    // Gather unique categories from both catalog and default items
    const catSet = new Set<string>([...cats, ...items.map((i) => i.groupCategory)]);
    setCatalogCategories(Array.from(catSet).sort());
  }, []);

  // Load expenses based on selected year scope
  const loadExpenses = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const adapter = getStorageAdapter();
      if (activeYearScope === 'ALL') {
        const yearsToFetch = recordedYears.length > 0 ? recordedYears : [selectedYear];
        const yearPromises = yearsToFetch.map((yr) => adapter.getExpenses(yr).catch(() => []));
        const results = await Promise.all(yearPromises);
        const combined = results.flat();
        // Deduplicate in case overlapping IDs
        const seen = new Set<string>();
        const deduped: ActualExpense[] = [];
        for (const exp of combined) {
          if (!seen.has(exp.expenseId)) {
            seen.add(exp.expenseId);
            deduped.push(exp);
          }
        }
        setExpenses(deduped);
      } else {
        const list = await adapter.getExpenses(activeYearScope);
        setExpenses(list);
      }
    } catch (err: unknown) {
      console.error('Failed to load expenses for bulk edit:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load expenses');
    } finally {
      setIsLoading(false);
    }
  }, [activeYearScope, recordedYears, selectedYear]);

  // Initial load when modal opens
  useEffect(() => {
    if (isOpen) {
      refreshCatalog();
      loadExpenses();
      setSelectedIds(new Set());
      setFeedbackMessage(null);
    }
  }, [isOpen, refreshCatalog, loadExpenses]);

  // Effective catalog items prioritizing props or fetched catalog
  const effectiveCatalogItems = useMemo(() => {
    return plannerCatalogItems && plannerCatalogItems.length > 0 ? plannerCatalogItems : catalogItems;
  }, [plannerCatalogItems, catalogItems]);

  // Extract all available categories from catalog and loaded expenses
  const allAvailableCategories = useMemo(() => {
    const set = new Set<string>(catalogCategories);
    for (const item of effectiveCatalogItems) {
      if (item.groupCategory) set.add(item.groupCategory);
    }
    for (const exp of expenses) {
      const { category } = resolveExpenseCategoryAndLineItem(exp, effectiveCatalogItems);
      if (category) set.add(category);
    }
    return Array.from(set).sort();
  }, [catalogCategories, effectiveCatalogItems, expenses]);

  // Extract available line items for the filter based on selected category
  const availableFilterLineItems = useMemo(() => {
    const set = new Set<string>();
    for (const item of effectiveCatalogItems) {
      if (filterCategory === 'ALL' || item.groupCategory.toLowerCase() === filterCategory.toLowerCase()) {
        set.add(item.name);
      }
    }
    for (const exp of expenses) {
      const { category, lineItem } = resolveExpenseCategoryAndLineItem(exp, effectiveCatalogItems);
      if (filterCategory === 'ALL' || category.toLowerCase() === filterCategory.toLowerCase()) {
        if (lineItem) set.add(lineItem);
      }
    }
    return Array.from(set).sort();
  }, [effectiveCatalogItems, expenses, filterCategory]);

  // Available payers from loaded expenses
  const availablePayers = useMemo(() => {
    const set = new Set<string>();
    for (const exp of expenses) {
      set.add(exp.enteredBy || 'Primary');
    }
    return Array.from(set).sort();
  }, [expenses]);

  // Available line items for the target category when bulk editing
  const effectiveTargetCategory = isCustomCategory ? customCategoryInput.trim() : targetCategory;
  const targetCategoryLineItems = useMemo(() => {
    if (!effectiveTargetCategory) return [];
    const set = new Set<string>();
    for (const item of effectiveCatalogItems) {
      if (item.groupCategory.toLowerCase() === effectiveTargetCategory.toLowerCase()) {
        set.add(item.name);
      }
    }
    return Array.from(set).sort();
  }, [effectiveCatalogItems, effectiveTargetCategory]);

  // Reactive filtering pipeline
  const filteredExpenses = useMemo(() => {
    return expenses.filter((exp) => {
      const { category, lineItem } = resolveExpenseCategoryAndLineItem(exp, effectiveCatalogItems);

      // Category filter
      if (filterCategory !== 'ALL' && category.toLowerCase() !== filterCategory.toLowerCase()) {
        return false;
      }

      // Line item filter
      if (filterLineItem !== 'ALL' && lineItem.toLowerCase() !== filterLineItem.toLowerCase()) {
        return false;
      }

      // Month filter
      if (filterMonth !== 'ALL') {
        if (!exp.date) return false;
        const parts = exp.date.split('-');
        const m = parseInt(parts[1], 10);
        if (m !== filterMonth) return false;
      }

      // Payer filter
      if (filterPayer !== 'ALL') {
        const payer = exp.enteredBy || 'Primary';
        if (payer.toLowerCase() !== filterPayer.toLowerCase()) {
          return false;
        }
      }

      // Universal text search
      if (filterText.trim()) {
        const q = filterText.trim().toLowerCase();
        const matchCategory = category.toLowerCase().includes(q);
        const matchLineItem = lineItem.toLowerCase().includes(q);
        const matchNotes = (exp.notes || '').toLowerCase().includes(q);
        const matchPayer = (exp.enteredBy || '').toLowerCase().includes(q);
        const matchDate = (exp.date || '').toLowerCase().includes(q);
        const matchAmount = exp.amount.toString().includes(q) || formatCurrency(exp.amount).toLowerCase().includes(q);

        if (!matchCategory && !matchLineItem && !matchNotes && !matchPayer && !matchDate && !matchAmount) {
          return false;
        }
      }

      return true;
    });
  }, [expenses, filterCategory, filterLineItem, filterMonth, filterPayer, filterText, effectiveCatalogItems]);

  // Sorted expenses
  const sortedExpenses = useMemo(() => {
    const list = [...filteredExpenses];
    list.sort((a, b) => {
      let comparison = 0;
      const parsedA = resolveExpenseCategoryAndLineItem(a, effectiveCatalogItems);
      const parsedB = resolveExpenseCategoryAndLineItem(b, effectiveCatalogItems);

      if (sortField === 'date') {
        comparison = (a.date || '').localeCompare(b.date || '');
      } else if (sortField === 'amount') {
        comparison = a.amount - b.amount;
      } else if (sortField === 'category') {
        comparison = parsedA.category.localeCompare(parsedB.category);
      } else if (sortField === 'lineItem') {
        comparison = parsedA.lineItem.localeCompare(parsedB.lineItem);
      } else if (sortField === 'payer') {
        const pA = a.enteredBy || 'Primary';
        const pB = b.enteredBy || 'Primary';
        comparison = pA.localeCompare(pB);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return list;
  }, [filteredExpenses, sortField, sortDirection, effectiveCatalogItems]);

  // Selection metrics
  const selectedExpenses = useMemo(() => {
    return expenses.filter((e) => selectedIds.has(e.expenseId));
  }, [expenses, selectedIds]);

  const selectedTotalAmount = useMemo(() => {
    return selectedExpenses.reduce((sum, e) => sum + e.amount, 0);
  }, [selectedExpenses]);

  // All filtered rows selected status
  const isAllFilteredSelected = useMemo(() => {
    if (sortedExpenses.length === 0) return false;
    return sortedExpenses.every((e) => selectedIds.has(e.expenseId));
  }, [sortedExpenses, selectedIds]);

  const isSomeFilteredSelected = useMemo(() => {
    if (sortedExpenses.length === 0) return false;
    const count = sortedExpenses.filter((e) => selectedIds.has(e.expenseId)).length;
    return count > 0 && count < sortedExpenses.length;
  }, [sortedExpenses, selectedIds]);

  // Handle master select / deselect toggle
  const handleToggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isAllFilteredSelected) {
        // Deselect all currently filtered rows
        for (const exp of sortedExpenses) {
          next.delete(exp.expenseId);
        }
      } else {
        // Select all currently filtered rows
        for (const exp of sortedExpenses) {
          next.add(exp.expenseId);
        }
      }
      return next;
    });
  };

  // Handle single row selection toggle
  const handleToggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Handle column header sort click
  const handleSortClick = (field: 'date' | 'amount' | 'category' | 'lineItem' | 'payer') => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'date' ? 'desc' : 'asc');
    }
  };

  // Clear all filters
  const handleClearFilters = () => {
    setFilterCategory('ALL');
    setFilterLineItem('ALL');
    setFilterText('');
    setFilterMonth('ALL');
    setFilterPayer('ALL');
  };

  const hasActiveFilters =
    filterCategory !== 'ALL' ||
    filterLineItem !== 'ALL' ||
    filterText.trim() !== '' ||
    filterMonth !== 'ALL' ||
    filterPayer !== 'ALL';

  // Determine effective target category & line item
  const resolvedTargetCategory = isCustomCategory ? customCategoryInput.trim() : targetCategory.trim();
  const resolvedTargetLineItem = isCustomLineItem ? customLineItemInput.trim() : targetLineItem.trim();

  // Validate if bulk update is ready to execute
  const canApplyBulkUpdate = useMemo(() => {
    if (selectedIds.size === 0) return false;
    const hasFieldSelected = updateCategoryEnabled || updateLineItemEnabled || updateNotesEnabled;
    if (!hasFieldSelected) return false;

    if (updateCategoryEnabled && !resolvedTargetCategory) return false;
    if (updateLineItemEnabled && !resolvedTargetLineItem) return false;
    if (updateNotesEnabled && noteMode !== 'clear' && !targetNotes.trim()) return false;

    return true;
  }, [
    selectedIds.size,
    updateCategoryEnabled,
    updateLineItemEnabled,
    updateNotesEnabled,
    resolvedTargetCategory,
    resolvedTargetLineItem,
    noteMode,
    targetNotes,
  ]);

  // Execute the bulk update
  const handleExecuteBulkUpdate = async () => {
    if (!canApplyBulkUpdate) return;

    setIsApplying(true);
    setApplyProgress({ current: 0, total: selectedExpenses.length });
    setFeedbackMessage(null);

    try {
      const adapter = getStorageAdapter();

      const finalCategory = resolvedTargetCategory;
      const finalLineItem = resolvedTargetLineItem;

      // Register new line item in catalog once if modified
      if (updateCategoryEnabled || updateLineItemEnabled) {
        savePlannerExpenseLineItem({
          name: finalLineItem,
          groupCategory: finalCategory,
        });
      }

      // Prepare batch updates and merchant rules
      const updatesBatch: Array<{ id: string; updates: Partial<ActualExpense> }> = [];
      const merchantRulesToSave: LearnedMerchantRule[] = [];

      for (const exp of selectedExpenses) {
        const currentParsed = resolveExpenseCategoryAndLineItem(exp, effectiveCatalogItems);
        const itemCategory = updateCategoryEnabled ? finalCategory : currentParsed.category;
        const itemLineItem = updateLineItemEnabled ? finalLineItem : currentParsed.lineItem;

        // Calculate new notes
        let newNotes: string | undefined = exp.notes;
        if (updateNotesEnabled) {
          if (noteMode === 'replace') {
            newNotes = targetNotes.trim() || undefined;
          } else if (noteMode === 'append') {
            newNotes = exp.notes ? `${exp.notes} • ${targetNotes.trim()}` : targetNotes.trim();
          } else if (noteMode === 'clear') {
            newNotes = undefined;
          }
        }

        const matchingCatalog = effectiveCatalogItems.find(
          c => c.groupCategory.toLowerCase() === itemCategory.toLowerCase() && c.name.toLowerCase() === itemLineItem.toLowerCase()
        );
        const canonicalCatalogId = matchingCatalog ? matchingCatalog.id : `cat_${itemCategory.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${itemLineItem.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;

        updatesBatch.push({
          id: exp.expenseId,
          updates: {
            catalogId: canonicalCatalogId,
            category: itemCategory,
            name: itemLineItem,
            categoryName: `${itemCategory} - ${itemLineItem}`,
            categoryId: canonicalCatalogId,
            notes: newNotes,
          },
        });

        // Collect merchant rules if checked
        if (updateMerchantRule && (updateCategoryEnabled || updateLineItemEnabled)) {
          const merchantKey = exp.notes ? normalizeMerchant(exp.notes) : '';
          if (merchantKey) {
            merchantRulesToSave.push({
              normalizedKey: merchantKey,
              category: itemCategory,
              lineItem: itemLineItem,
              lastUsed: new Date().toISOString(),
              matchCount: 1,
            });
          }
        }
      }

      setApplyProgress({ current: 0, total: updatesBatch.length });

      if (adapter.updateExpensesBatch) {
        await adapter.updateExpensesBatch(updatesBatch);
        setApplyProgress({ current: updatesBatch.length, total: updatesBatch.length });
      } else {
        let processed = 0;
        for (const item of updatesBatch) {
          await adapter.updateExpense(item.id, item.updates);
          processed++;
          setApplyProgress({ current: processed, total: updatesBatch.length });
        }
      }

      // Save merchant rules in batch if applicable
      if (merchantRulesToSave.length > 0) {
        batchSaveLearnedMerchantRules(merchantRulesToSave);
      }

      // Clear selection and close confirmation modal immediately
      setSelectedIds(new Set());
      setShowConfirmModal(false);

      // Refresh catalog and reload updated expenses
      refreshCatalog();
      await loadExpenses();

      setFeedbackMessage({
        type: 'success',
        text: `Successfully updated ${selectedExpenses.length} expense${selectedExpenses.length > 1 ? 's' : ''}!`,
      });

      // Notify parent ActualsWorkspace to refresh living expenses and comparison cards
      onExpensesUpdated();
    } catch (err: unknown) {
      console.error('Failed to apply bulk edit:', err);
      setFeedbackMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'An error occurred during bulk edit.',
      });
    } finally {
      setIsApplying(false);
    }
  };

  // Execute bulk deletion of selected expenses
  const handleExecuteBulkDelete = async () => {
    if (selectedExpenses.length === 0) return;

    setIsDeleting(true);
    setDeleteProgress({ current: 0, total: selectedExpenses.length });
    setFeedbackMessage(null);

    try {
      const adapter = getStorageAdapter();
      let processed = 0;

      for (const exp of selectedExpenses) {
        await adapter.deleteExpense(exp.expenseId);
        processed++;
        setDeleteProgress({ current: processed, total: selectedExpenses.length });
      }

      setSelectedIds(new Set());
      setShowDeleteConfirmModal(false);
      await loadExpenses();
      setFeedbackMessage({
        type: 'success',
        text: `Successfully deleted ${selectedExpenses.length} expense record${selectedExpenses.length > 1 ? 's' : ''}!`,
      });

      // Notify parent ActualsWorkspace to refresh living expenses and comparison cards
      onExpensesUpdated();
    } catch (err: unknown) {
      console.error('Failed to delete expenses:', err);
      setFeedbackMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'An error occurred while deleting expenses.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-6xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
              <Sliders className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-white">Bulk Edit Actual Expenses</h2>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-medium">Scope:</span>
                  <select
                    value={activeYearScope}
                    onChange={(e) => {
                      const val = e.target.value === 'ALL' ? 'ALL' : parseInt(e.target.value, 10);
                      setActiveYearScope(val);
                    }}
                    className="bg-slate-950 border border-slate-700 text-emerald-400 text-xs font-semibold rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value={selectedYear}>Year {selectedYear} (Active)</option>
                    {recordedYears
                      .filter((y) => y !== selectedYear)
                      .map((y) => (
                        <option key={y} value={y}>
                          Year {y}
                        </option>
                      ))}
                    <option value="ALL">All Recorded Years</option>
                  </select>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold border border-slate-700">
                  {expenses.length} records
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Filter by any criteria, select rows, and modify category, expense name, or note/memo in bulk.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer shrink-0 ml-3"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback Message Banner */}
        {feedbackMessage && (
          <div
            className={`mx-4 mt-3 p-3 rounded-xl border text-xs flex items-center justify-between gap-2 transition-all ${
              feedbackMessage.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedbackMessage.type === 'success' ? (
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{feedbackMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackMessage(null)}
              className="p-1 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Load Error Banner */}
        {loadError && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {/* Comprehensive Filter Controls Bar */}
        <div className="p-3.5 bg-slate-950/70 border-b border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Category Filter */}
            <div className="flex items-center gap-1.5 min-w-[170px] flex-1 sm:flex-initial">
              <span className="text-[11px] text-slate-400 font-medium">Category:</span>
              <select
                value={filterCategory}
                onChange={(e) => {
                  setFilterCategory(e.target.value);
                  setFilterLineItem('ALL'); // Reset line item when category changes
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">All Categories</option>
                {allAvailableCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Expense Name Filter */}
            <div className="flex items-center gap-1.5 min-w-[190px] flex-1 sm:flex-initial">
              <span className="text-[11px] text-slate-400 font-medium">Expense Name:</span>
              <select
                value={filterLineItem}
                onChange={(e) => setFilterLineItem(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">All Expense Names</option>
                {availableFilterLineItems.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            {/* Month Filter */}
            <div className="flex items-center gap-1.5 min-w-[130px] flex-1 sm:flex-initial">
              <span className="text-[11px] text-slate-400 font-medium">Month:</span>
              <select
                value={filterMonth}
                onChange={(e) => {
                  const val = e.target.value === 'ALL' ? 'ALL' : parseInt(e.target.value, 10);
                  setFilterMonth(val);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">All Months</option>
                {MONTH_NAMES.map((name, idx) => (
                  <option key={idx + 1} value={idx + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            {/* Payer Filter */}
            {availablePayers.length > 1 && (
              <div className="flex items-center gap-1.5 min-w-[130px] flex-1 sm:flex-initial">
                <span className="text-[11px] text-slate-400 font-medium">Payer:</span>
                <select
                  value={filterPayer}
                  onChange={(e) => setFilterPayer(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All Payers</option>
                  {availablePayers.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium underline px-1 cursor-pointer"
              >
                Clear all filters
              </button>
            )}
          </div>

          {/* Universal Fast Search Box */}
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Search by note/memo, merchant, expense name, amount, or date..."
              className="w-full bg-slate-900 border border-slate-700/80 rounded-xl pl-8 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            {filterText && (
              <button
                type="button"
                onClick={() => setFilterText('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Selection Status & Action Summary Bar */}
        <div className="px-4 py-2.5 bg-slate-950/40 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggleSelectAllFiltered}
              disabled={sortedExpenses.length === 0}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer disabled:opacity-40"
            >
              {isAllFilteredSelected ? (
                <CheckSquare className="w-4 h-4 text-emerald-400" />
              ) : isSomeFilteredSelected ? (
                <MinusSquare className="w-4 h-4 text-emerald-400" />
              ) : (
                <Square className="w-4 h-4 text-slate-500" />
              )}
              <span>{isAllFilteredSelected ? 'Deselect All Filtered' : 'Select All Filtered'}</span>
            </button>

            <span className="text-slate-500">|</span>

            <span className="text-slate-400">
              Showing <strong className="text-white font-mono">{sortedExpenses.length}</strong> of{' '}
              <strong className="text-slate-300 font-mono">{expenses.length}</strong>
            </span>

            {selectedIds.size > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30 font-mono text-[11px]">
                {selectedIds.size} selected ({formatCurrency(selectedTotalAmount)})
              </span>
            )}
          </div>

          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] text-slate-400 hover:text-slate-200 underline cursor-pointer"
            >
              Clear selection
            </button>
          )}
        </div>

        {/* Interactive Expenses Table */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-0 bg-slate-900/30">
          {isLoading ? (
            <div className="py-20 text-center space-y-2">
              <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin mx-auto" />
              <p className="text-xs text-slate-400">Loading expenses from storage...</p>
            </div>
          ) : sortedExpenses.length === 0 ? (
            <div className="py-20 text-center space-y-2 px-4">
              <Tag className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-300">No actual expenses match your filters.</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Try widening your category, expense name, or text search criteria.
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800">
              <thead className="bg-slate-950/90 text-slate-400 uppercase text-[10px] font-bold tracking-wider sticky top-0 z-10 backdrop-blur">
                <tr>
                  <th className="w-10 px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={isAllFilteredSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = isSomeFilteredSelected;
                      }}
                      onChange={handleToggleSelectAllFiltered}
                      className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                    />
                  </th>
                  <th
                    onClick={() => handleSortClick('date')}
                    className="px-3.5 py-2.5 cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>Date</span>
                      {sortField === 'date' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-emerald-400" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-600" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSortClick('category')}
                    className="px-3.5 py-2.5 cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>Category</span>
                      {sortField === 'category' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-emerald-400" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-600" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSortClick('lineItem')}
                    className="px-3.5 py-2.5 cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>Expense Name</span>
                      {sortField === 'lineItem' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-emerald-400" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-600" />
                      )}
                    </div>
                  </th>
                  <th className="px-3.5 py-2.5">Note / Memo</th>
                  <th
                    onClick={() => handleSortClick('payer')}
                    className="px-3.5 py-2.5 cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center gap-1">
                      <span>Payer</span>
                      {sortField === 'payer' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-emerald-400" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-600" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSortClick('amount')}
                    className="px-3.5 py-2.5 text-right cursor-pointer hover:text-white transition-colors"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Amount</span>
                      {sortField === 'amount' ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-emerald-400" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-600" />
                      )}
                    </div>
                  </th>
                  <th className="px-2 py-2.5 text-center w-10">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {sortedExpenses.map((exp) => {
                  const isSelected = selectedIds.has(exp.expenseId);
                  const { category, lineItem } = resolveExpenseCategoryAndLineItem(exp, effectiveCatalogItems);

                  return (
                    <tr
                      key={exp.expenseId}
                      onClick={() => handleToggleRow(exp.expenseId)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-emerald-950/25 hover:bg-emerald-950/35' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => handleToggleRow(exp.expenseId)}
                          className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-slate-300 whitespace-nowrap">{exp.date}</td>
                      <td className="px-3.5 py-2.5">
                        <span className="inline-block px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-semibold border border-slate-700">
                          {category}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 font-semibold text-white whitespace-nowrap">{lineItem}</td>
                      <td className="px-3.5 py-2.5 text-slate-300 max-w-xs truncate">
                        {exp.notes ? (
                          <span className="text-amber-200/90">{exp.notes}</span>
                        ) : (
                          <span className="text-slate-600 italic text-[11px]">No memo</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 text-[10px]">
                          {exp.enteredBy || 'Primary'}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                        {formatCurrency(exp.amount)}
                      </td>
                      <td className="px-2 py-2.5 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedIds(new Set([exp.expenseId]));
                            setShowDeleteConfirmModal(true);
                          }}
                          className="p-1 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="Delete this expense"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Bulk Edit Action Bar (Docked at bottom when rows are selected) */}
        {selectedIds.size > 0 && (
          <div className="p-4 bg-slate-950 border-t border-emerald-500/30 shadow-2xl space-y-3 animate-in slide-in-from-bottom-2">
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-xl bg-emerald-500/20 text-emerald-300 font-bold font-mono text-xs border border-emerald-500/30">
                  {selectedIds.size} Selected
                </span>
                <span className="text-xs text-slate-300 font-semibold hidden sm:inline">
                  Select fields to update:
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 self-end lg:self-auto flex-wrap">
                <button
                  type="button"
                  disabled={isApplying || isDeleting}
                  onClick={() => setShowDeleteConfirmModal(true)}
                  className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Delete selected expense records"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Selected ({selectedIds.size})</span>
                </button>
                <button
                  type="button"
                  disabled={isApplying || isDeleting}
                  onClick={() => setSelectedIds(new Set())}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors disabled:opacity-40"
                >
                  Deselect
                </button>
                <button
                  type="button"
                  disabled={!canApplyBulkUpdate || isApplying || isDeleting}
                  onClick={() => setShowConfirmModal(true)}
                  className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-900/30 flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Review & Apply to {selectedIds.size} Records</span>
                </button>
              </div>
            </div>

            {/* Field update panels */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-1">
              {/* 1. Category Field */}
              <div
                className={`p-3 rounded-xl border transition-all ${
                  updateCategoryEnabled ? 'bg-slate-900/90 border-emerald-500/40' : 'bg-slate-900/40 border-slate-800'
                }`}
              >
                <label className="flex items-center gap-2 font-semibold text-white cursor-pointer select-none mb-2">
                  <input
                    type="checkbox"
                    checked={updateCategoryEnabled}
                    onChange={(e) => {
                      setUpdateCategoryEnabled(e.target.checked);
                      if (e.target.checked && !targetCategory && allAvailableCategories.length > 0) {
                        setTargetCategory(allAvailableCategories[0]);
                      }
                    }}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                  />
                  <span>Change Category</span>
                </label>

                {updateCategoryEnabled && (
                  <div className="space-y-1.5 animate-in fade-in">
                    {!isCustomCategory ? (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={targetCategory}
                          onChange={(e) => {
                            if (e.target.value === '__NEW__') {
                              setIsCustomCategory(true);
                              setCustomCategoryInput('');
                            } else {
                              setTargetCategory(e.target.value);
                            }
                          }}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                        >
                          <option value="">-- Choose Category --</option>
                          {allAvailableCategories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                          <option value="__NEW__">+ Enter New Category...</option>
                        </select>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={customCategoryInput}
                          onChange={(e) => setCustomCategoryInput(e.target.value)}
                          placeholder="New category name..."
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomCategory(false);
                            setCustomCategoryInput('');
                          }}
                          className="p-1 text-slate-400 hover:text-white"
                          title="Back to list"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 2. Line Item Field */}
              <div
                className={`p-3 rounded-xl border transition-all ${
                  updateLineItemEnabled ? 'bg-slate-900/90 border-emerald-500/40' : 'bg-slate-900/40 border-slate-800'
                }`}
              >
                <label className="flex items-center gap-2 font-semibold text-white cursor-pointer select-none mb-2">
                  <input
                    type="checkbox"
                    checked={updateLineItemEnabled}
                    onChange={(e) => {
                      setUpdateLineItemEnabled(e.target.checked);
                      if (e.target.checked && !targetLineItem && targetCategoryLineItems.length > 0) {
                        setTargetLineItem(targetCategoryLineItems[0]);
                      }
                    }}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                  />
                  <span>Change Expense Name</span>
                </label>

                {updateLineItemEnabled && (
                  <div className="space-y-1.5 animate-in fade-in">
                    {!isCustomLineItem ? (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={targetLineItem}
                          onChange={(e) => {
                            if (e.target.value === '__NEW__') {
                              setIsCustomLineItem(true);
                              setCustomLineItemInput('');
                            } else {
                              setTargetLineItem(e.target.value);
                            }
                          }}
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                        >
                          <option value="">-- Choose Expense Name --</option>
                          {targetCategoryLineItems.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                          <option value="__NEW__">+ Enter New Expense Name...</option>
                        </select>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={customLineItemInput}
                          onChange={(e) => setCustomLineItemInput(e.target.value)}
                          placeholder="e.g. Prime Video Ultra"
                          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomLineItem(false);
                            setCustomLineItemInput('');
                          }}
                          className="p-1 text-slate-400 hover:text-white"
                          title="Back to list"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 3. Note / Memo Field */}
              <div
                className={`p-3 rounded-xl border transition-all ${
                  updateNotesEnabled ? 'bg-slate-900/90 border-emerald-500/40' : 'bg-slate-900/40 border-slate-800'
                }`}
              >
                <label className="flex items-center gap-2 font-semibold text-white cursor-pointer select-none mb-2">
                  <input
                    type="checkbox"
                    checked={updateNotesEnabled}
                    onChange={(e) => setUpdateNotesEnabled(e.target.checked)}
                    className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                  />
                  <span>Update Note / Memo</span>
                </label>

                {updateNotesEnabled && (
                  <div className="space-y-1.5 animate-in fade-in">
                    <div className="flex items-center gap-3 text-[11px] text-slate-300">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="noteMode"
                          checked={noteMode === 'replace'}
                          onChange={() => setNoteMode('replace')}
                          className="text-emerald-500"
                        />
                        <span>Replace</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="noteMode"
                          checked={noteMode === 'append'}
                          onChange={() => setNoteMode('append')}
                          className="text-emerald-500"
                        />
                        <span>Append</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name="noteMode"
                          checked={noteMode === 'clear'}
                          onChange={() => setNoteMode('clear')}
                          className="text-emerald-500"
                        />
                        <span>Clear</span>
                      </label>
                    </div>

                    {noteMode !== 'clear' && (
                      <input
                        type="text"
                        value={targetNotes}
                        onChange={(e) => setTargetNotes(e.target.value)}
                        placeholder={noteMode === 'replace' ? 'New memo text...' : 'Text to append...'}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Optional Learned Merchant Rule checkbox */}
            {(updateCategoryEnabled || updateLineItemEnabled) && (
              <div className="pt-1 flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  id="chkUpdateMerchantRule"
                  checked={updateMerchantRule}
                  onChange={(e) => setUpdateMerchantRule(e.target.checked)}
                  className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                />
                <label htmlFor="chkUpdateMerchantRule" className="cursor-pointer select-none">
                  Update learned merchant rules for future statement imports
                </label>
              </div>
            )}
          </div>
        )}

        {/* Modal Footer (when no rows selected) */}
        {selectedIds.size === 0 && (
          <div className="p-3.5 bg-slate-950/70 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>Select one or more expense rows above to activate bulk edit actions.</span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* Confirmation Pre-Flight Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-60 bg-slate-950/90 backdrop-blur flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center gap-3 text-emerald-400">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Confirm Bulk Edit</h3>
                <p className="text-xs text-slate-400">
                  You are about to modify {selectedExpenses.length} expense record{selectedExpenses.length > 1 ? 's' : ''}.
                </p>
              </div>
            </div>

            {/* Summary of changes */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="font-semibold text-slate-300 border-b border-slate-800 pb-1.5">
                Modifications Summary:
              </div>

              {updateCategoryEnabled && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Category:</span>
                  <span className="font-bold text-emerald-400 font-mono">{resolvedTargetCategory}</span>
                </div>
              )}

              {updateLineItemEnabled && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Expense Name:</span>
                  <span className="font-bold text-emerald-400 font-mono">
                    {resolvedTargetLineItem}
                    {isCustomLineItem && ' (New)'}
                  </span>
                </div>
              )}

              {updateNotesEnabled && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Note / Memo:</span>
                  <span className="font-bold text-amber-300 font-mono">
                    {noteMode === 'clear' ? 'Clear existing note' : `${noteMode}: "${targetNotes}"`}
                  </span>
                </div>
              )}

              {updateMerchantRule && (
                <div className="flex items-center justify-between text-slate-400 pt-1 border-t border-slate-800/80">
                  <span>Merchant Memory:</span>
                  <span className="text-slate-200">Will learn rules for future CSV imports</span>
                </div>
              )}

              <div className="flex items-center justify-between text-slate-400 pt-1 border-t border-slate-800/80">
                <span>Total Amount Affected:</span>
                <span className="font-bold text-white font-mono">{formatCurrency(selectedTotalAmount)}</span>
              </div>
            </div>

            {/* Progress indicator during save */}
            {isApplying && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-400 font-mono">
                  <span>Updating records...</span>
                  <span>
                    {applyProgress.current} / {applyProgress.total}
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-150"
                    style={{
                      width: `${applyProgress.total > 0 ? (applyProgress.current / applyProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isApplying}
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isApplying}
                onClick={handleExecuteBulkUpdate}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-900/30 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isApplying ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Applying Changes...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Confirm & Apply</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Delete Modal */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 z-60 bg-slate-950/90 backdrop-blur flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-rose-900/50 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in zoom-in-95">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Confirm Delete Expenses</h3>
                <p className="text-xs text-rose-300/80">
                  You are about to permanently delete {selectedExpenses.length} expense record{selectedExpenses.length > 1 ? 's' : ''}.
                </p>
              </div>
            </div>

            {/* Warning banner */}
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 flex items-start gap-2.5 text-xs text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-rose-300">This action cannot be undone.</span>
                <p className="text-rose-300/80 mt-0.5">
                  The selected transaction{selectedExpenses.length > 1 ? 's' : ''} will be permanently removed from your storage records and actuals budget variance calculations.
                </p>
              </div>
            </div>

            {/* Summary preview */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-2">
                <span>Records to Delete:</span>
                <span className="font-bold text-white font-mono">{selectedExpenses.length}</span>
              </div>
              <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-2">
                <span>Total Amount:</span>
                <span className="font-bold text-rose-400 font-mono">{formatCurrency(selectedTotalAmount)}</span>
              </div>

              {/* Preview list of items being deleted */}
              <div className="pt-1 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Preview:</div>
                {selectedExpenses.slice(0, 5).map((exp) => {
                  const { category, lineItem } = resolveExpenseCategoryAndLineItem(exp, effectiveCatalogItems);
                  return (
                    <div
                      key={exp.expenseId}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-900/80 border border-slate-800/80 text-[11px]"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-medium text-slate-200 truncate">
                          {lineItem} <span className="text-slate-500 font-normal">({category})</span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {exp.date} {exp.notes ? `• ${exp.notes}` : ''}
                        </div>
                      </div>
                      <div className="font-mono font-bold text-rose-400 whitespace-nowrap">
                        {formatCurrency(exp.amount)}
                      </div>
                    </div>
                  );
                })}
                {selectedExpenses.length > 5 && (
                  <div className="text-center text-[10px] text-slate-500 italic pt-1">
                    + {selectedExpenses.length - 5} more record{selectedExpenses.length - 5 > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>

            {/* Progress indicator during delete */}
            {isDeleting && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-400 font-mono">
                  <span>Deleting records...</span>
                  <span>
                    {deleteProgress.current} / {deleteProgress.total}
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-rose-500 rounded-full transition-all duration-150"
                    style={{
                      width: `${deleteProgress.total > 0 ? (deleteProgress.current / deleteProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setShowDeleteConfirmModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleExecuteBulkDelete}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-950/50 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Permanently Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
