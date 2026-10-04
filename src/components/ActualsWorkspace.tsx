import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  SimulationResultRow,
  AppStateInputs,
  YearActualsRecord,
  GuardrailSettings,
  DEFAULT_GUARDRAIL_SETTINGS,
  getSimulationStartYear,
  DEFAULT_EXPENSE_CATEGORIES,
  normalizeDetailedExpenses,
} from '../types';
import {
  ClipboardCheck,
  ShieldCheck,
  TrendingUp,
  Sliders,
  DollarSign,
  Plus,
  Trash2,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  AlertTriangle,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Wallet,
  RefreshCw,
  Smartphone,
  ExternalLink,
  Tag,
  Pencil,
  Search,
  ArrowUpDown,
  Check,
  X,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  BarChart3,
  Table,
  EyeOff,
  Upload,
} from 'lucide-react';
import { getStorageAdapter } from '../shared/storage';
import { ActualExpense } from '../shared/types/expenses';
import { AuthService } from '../shared/auth/AuthService';
import { isLocalhostEnvironment } from '../shared/utils/appMode';
import { syncCustomCategoriesToPlanner, savePlannerExpenseLineItem } from '../shared/utils/plannerCategories';
import { ActiveViewType } from './SidebarNavigation';
import { RangeSlider } from './RangeSlider';
import { NumericInput } from './NumericInput';
import { Chart } from 'react-chartjs-2';
import { Chart as ChartJS, registerables, ChartEvent, LegendItem } from 'chart.js';
import { ImportExpensesModal } from './ImportExpensesModal';

ChartJS.register(...registerables);

interface ActualsWorkspaceProps {
  ledger: SimulationResultRow[];
  inputs: AppStateInputs;
  onUpdateActuals: (actuals: Record<number, YearActualsRecord>) => void;
  onUpdateGuardrailSettings: (settings: GuardrailSettings) => void;
  onApplySpendingBonusToBudget?: (newBudget: number) => void;
  onNavigateToTab?: (tab: number | ActiveViewType) => void;
  onUpdatePriorTaxReturnMAGI?: (priorMAGI: Record<number, number | null>) => void;
}

export const ActualsWorkspace: React.FC<ActualsWorkspaceProps> = ({
  ledger,
  inputs,
  onUpdateActuals,
  onUpdateGuardrailSettings,
  onApplySpendingBonusToBudget,
  onNavigateToTab,
  onUpdatePriorTaxReturnMAGI,
}) => {
  const simStartYear = getSimulationStartYear(inputs);
  const currentCalendarYear = new Date().getFullYear();

  // Guardrail settings state
  const guardrailSettings: GuardrailSettings = inputs.guardrailSettings || DEFAULT_GUARDRAIL_SETTINGS;
  const actualTracking = useMemo(() => inputs.actualTracking || {}, [inputs.actualTracking]);

  // Find all years with actuals or between start year and current year
  const recordedYears = useMemo(() => {
    const keys = Object.keys(actualTracking).map(Number);
    if (keys.length === 0) return [simStartYear];
    return Array.from(new Set([...keys, simStartYear])).sort((a, b) => a - b);
  }, [actualTracking, simStartYear]);

  // Selected year for editing
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const keys = Object.keys(actualTracking).map(Number);
    if (keys.length > 0) {
      return Math.max(...keys);
    }
    return simStartYear;
  });

  // Category breakdown toggle
  const [showCategoryBreakdown, setShowCategoryBreakdown] = useState(false);
  const [showReconciliation, setShowReconciliation] = useState(true);
  const [showGuardrailConfig, setShowGuardrailConfig] = useState(false);
  const [yearPendingDelete, setYearPendingDelete] = useState<number | null>(null);

  // Live Logged Actual Expenses from Storage Adapter
  const [loggedExpenses, setLoggedExpenses] = useState<ActualExpense[]>([]);
  const [allYearLoggedExpenses, setAllYearLoggedExpenses] = useState<ActualExpense[]>([]);
  const [isLoadingExpenses, setIsLoadingExpenses] = useState<boolean>(false);
  const [selectedMonthFilter, setSelectedMonthFilter] = useState<number | null>(null);
  const [expensesDisplayMode, setExpensesDisplayMode] = useState<'table' | 'chart' | 'none'>('table');
  const [chartAggregationMode, setChartAggregationMode] = useState<'monthly' | 'cumulative'>('monthly');
  const [tableFilterText, setTableFilterText] = useState<string>('');
  const [showTransactionsDrawer, setShowTransactionsDrawer] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => AuthService.isAuthenticated());
  const monthlyExpensesChartRef = useRef<ChartJS<'bar' | 'line'> | null>(null);
  const [hasHiddenExpensesDatasets, setHasHiddenExpensesDatasets] = useState(false);

  useEffect(() => {
    const unsub = AuthService.subscribe((s) => {
      setIsAuthenticated(Boolean(s));
    });
    return () => unsub();
  }, []);

  const storageSyncMessage = useMemo(() => {
    if (isLocalhostEnvironment()) {
      return 'Edits and deletions update your local browser storage.';
    }
    if (isAuthenticated) {
      return 'Edits and deletions synchronize automatically to your household cloud storage.';
    }
    return 'Edits and deletions update your household expense ledger.';
  }, [isAuthenticated]);

  const handleUpdateActualsLivingExpenses = useCallback((year: number, amount: number) => {
    const currentRecord = actualTracking[year] || {
      year,
      totalLivingExpenses: amount,
    };
    onUpdateActuals({
      ...actualTracking,
      [year]: {
        ...currentRecord,
        totalLivingExpenses: amount,
      },
    });
  }, [actualTracking, onUpdateActuals]);

  // Line item breakdown modal state
  const [selectedLineItemForBreakdown, setSelectedLineItemForBreakdown] = useState<{
    id: string;
    name: string;
    group: string;
    plannedAnnual: number;
    actualAnnual: number;
  } | null>(null);

  // Breakdown modal filter and sort state
  const [breakdownFilterText, setBreakdownFilterText] = useState<string>('');
  const [breakdownPayerFilter, setBreakdownPayerFilter] = useState<string>('ALL');
  const [breakdownSortField, setBreakdownSortField] = useState<'date' | 'amount' | 'enteredBy'>('date');
  const [breakdownSortDirection, setBreakdownSortDirection] = useState<'asc' | 'desc'>('desc');

  // Breakdown modal editing state
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editExpenseDate, setEditExpenseDate] = useState<string>('');
  const [editExpenseAmount, setEditExpenseAmount] = useState<string>('');
  const [editExpensePayer, setEditExpensePayer] = useState<string>('');
  const [editExpenseNotes, setEditExpenseNotes] = useState<string>('');
  const [isSavingExpenseEdit, setIsSavingExpenseEdit] = useState<boolean>(false);
  const [expenseEditError, setExpenseEditError] = useState<string | null>(null);

  const loadLoggedExpenses = useCallback(async () => {
    setIsLoadingExpenses(true);
    try {
      const adapter = getStorageAdapter();
      const [allExps, cats] = await Promise.all([
        adapter.getExpenses(selectedYear),
        adapter.getCategories().catch(() => []),
      ]);
      setAllYearLoggedExpenses(allExps);
      const filtered = selectedMonthFilter
        ? allExps.filter((exp) => {
            if (!exp.date) return false;
            const m = parseInt(exp.date.split('-')[1], 10);
            return m === selectedMonthFilter;
          })
        : allExps;
      setLoggedExpenses(filtered);

      // 1. Sync custom categories from storage into Planner Detailed Expenses
      if (cats && cats.length > 0) {
        syncCustomCategoriesToPlanner(cats);
      }

      // 2. Also register any line items from logged transactions if missing from catalog
      for (const exp of allExps) {
        if (!exp.categoryName) continue;
        const parts = exp.categoryName.includes(' - ') ? exp.categoryName.split(' - ') : ['Living', exp.categoryName];
        const group = parts[0].trim();
        const name = parts[1] ? parts[1].trim() : exp.categoryName.trim();
        if (group === 'Healthcare') continue;

        savePlannerExpenseLineItem({
          id: exp.categoryId,
          name,
          groupCategory: group,
          plannedMonthlyDefault: 0,
        });
      }
    } catch (err) {
      console.error('Failed to load logged actual expenses:', err);
    } finally {
      setIsLoadingExpenses(false);
    }
  }, [selectedYear, selectedMonthFilter]);

  useEffect(() => {
    loadLoggedExpenses();

    const handleStorageEvent = () => {
      loadLoggedExpenses();
    };
    const unsubscribeAuth = AuthService.subscribe(s => {
      setIsAuthenticated(Boolean(s));
      loadLoggedExpenses();
    });

    window.addEventListener('storage', handleStorageEvent);
    window.addEventListener('retirement_planner_inputs_updated', handleStorageEvent);
    window.addEventListener('cloud_expenses_synced', handleStorageEvent);
    window.addEventListener('cloud_categories_synced', handleStorageEvent);
    window.addEventListener('cloud_sync_completed', handleStorageEvent);

    return () => {
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('retirement_planner_inputs_updated', handleStorageEvent);
      window.removeEventListener('cloud_expenses_synced', handleStorageEvent);
      window.removeEventListener('cloud_categories_synced', handleStorageEvent);
      window.removeEventListener('cloud_sync_completed', handleStorageEvent);
      unsubscribeAuth();
    };
  }, [loadLoggedExpenses]);

  // Aggregated logged actual expenses for the selected year/month
  const actualsSummary = useMemo(() => {
    let totalSpend = 0;
    const byCategory: Record<string, number> = {};
    const byLineItem: Record<string, { total: number; count: number; name: string; categoryName: string; payers: Record<string, number> }> = {};
    const byPayer: Record<string, number> = {};

    for (const exp of loggedExpenses) {
      totalSpend += exp.amount;
      byCategory[exp.categoryName] = (byCategory[exp.categoryName] || 0) + exp.amount;

      if (!byLineItem[exp.categoryId]) {
        byLineItem[exp.categoryId] = {
          total: 0,
          count: 0,
          name: exp.categoryName,
          categoryName: exp.categoryName,
          payers: {},
        };
      }
      byLineItem[exp.categoryId].total += exp.amount;
      byLineItem[exp.categoryId].count += 1;
      const payer = exp.enteredBy || 'Primary';
      byLineItem[exp.categoryId].payers[payer] = (byLineItem[exp.categoryId].payers[payer] || 0) + exp.amount;
      byPayer[payer] = (byPayer[payer] || 0) + exp.amount;
    }

    return { totalSpend, byCategory, byLineItem, byPayer, count: loggedExpenses.length };
  }, [loggedExpenses]);


  // Delete an individual logged expense transaction
  const handleDeleteLoggedExpense = async (id: string) => {
    if (window.confirm('Delete this expense transaction?')) {
      const adapter = getStorageAdapter();
      await adapter.deleteExpense(id);
      if (editingExpenseId === id) {
        setEditingExpenseId(null);
      }
      await loadLoggedExpenses();
    }
  };

  // Active line item expenses matching the selected category/line item
  const activeLineItemExpenses = useMemo(() => {
    if (!selectedLineItemForBreakdown) return [];
    const targetId = selectedLineItemForBreakdown.id;
    const targetNameLower = selectedLineItemForBreakdown.name.toLowerCase();

    return loggedExpenses.filter(e => {
      if (e.categoryId === targetId) return true;
      const catLower = e.categoryName.toLowerCase();
      if (catLower === targetNameLower) return true;
      if (catLower.endsWith(` - ${targetNameLower}`)) return true;
      if (catLower.endsWith(targetNameLower)) return true;
      return false;
    });
  }, [selectedLineItemForBreakdown, loggedExpenses]);

  // Unique payers for the active line item breakdown
  const availableBreakdownPayers = useMemo(() => {
    const payersSet = new Set<string>();
    for (const exp of activeLineItemExpenses) {
      payersSet.add(exp.enteredBy || 'Primary');
    }
    return Array.from(payersSet);
  }, [activeLineItemExpenses]);

  // Filtered and sorted expenses for the breakdown modal
  const filteredAndSortedLineItemExpenses = useMemo(() => {
    let list = [...activeLineItemExpenses];

    // 1. Text filter (notes, amount, date, who entered)
    if (breakdownFilterText.trim()) {
      const q = breakdownFilterText.trim().toLowerCase();
      list = list.filter(e => {
        const matchesDate = e.date.toLowerCase().includes(q);
        const matchesAmount = e.amount.toString().includes(q) || formatCurrency(e.amount).toLowerCase().includes(q);
        const matchesPayer = (e.enteredBy || '').toLowerCase().includes(q);
        const matchesNotes = (e.notes || '').toLowerCase().includes(q);
        return matchesDate || matchesAmount || matchesPayer || matchesNotes;
      });
    }

    // 2. Payer filter
    if (breakdownPayerFilter !== 'ALL') {
      list = list.filter(e => (e.enteredBy || 'Primary') === breakdownPayerFilter);
    }

    // 3. Sorting
    list.sort((a, b) => {
      let comparison = 0;
      if (breakdownSortField === 'date') {
        comparison = a.date.localeCompare(b.date);
      } else if (breakdownSortField === 'amount') {
        comparison = a.amount - b.amount;
      } else if (breakdownSortField === 'enteredBy') {
        const pA = a.enteredBy || 'Primary';
        const pB = b.enteredBy || 'Primary';
        comparison = pA.localeCompare(pB);
      }
      return breakdownSortDirection === 'asc' ? comparison : -comparison;
    });

    return list;
  }, [activeLineItemExpenses, breakdownFilterText, breakdownPayerFilter, breakdownSortField, breakdownSortDirection]);

  const handleToggleSort = (field: 'date' | 'amount' | 'enteredBy') => {
    if (breakdownSortField === field) {
      setBreakdownSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setBreakdownSortField(field);
      setBreakdownSortDirection(field === 'date' ? 'desc' : 'asc');
    }
  };

  const handleStartEditExpense = (exp: ActualExpense) => {
    setEditingExpenseId(exp.expenseId);
    setEditExpenseDate(exp.date);
    setEditExpenseAmount(exp.amount.toFixed(2));
    setEditExpensePayer(exp.enteredBy || 'Primary');
    setEditExpenseNotes(exp.notes || '');
    setExpenseEditError(null);
  };

  const handleSaveExpenseEdit = async (expenseId: string) => {
    const parsedAmount = parseFloat(editExpenseAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setExpenseEditError('Amount must be greater than $0.00');
      return;
    }
    if (!editExpenseDate) {
      setExpenseEditError('Date is required');
      return;
    }

    setIsSavingExpenseEdit(true);
    setExpenseEditError(null);

    try {
      const adapter = getStorageAdapter();
      await adapter.updateExpense(expenseId, {
        date: editExpenseDate,
        amount: Math.round(parsedAmount * 100) / 100,
        enteredBy: editExpensePayer.trim() || 'Primary',
        notes: editExpenseNotes.trim() || undefined,
      });

      await loadLoggedExpenses();
      setEditingExpenseId(null);
    } catch (err: unknown) {
      console.error('Failed to update expense:', err);
      setExpenseEditError(err instanceof Error ? err.message : 'Failed to update expense');
    } finally {
      setIsSavingExpenseEdit(false);
    }
  };

  // Active year record or defaults
  const activeRecord: YearActualsRecord = useMemo(() => {
    return actualTracking[selectedYear] || {
      year: selectedYear,
      equityReturnRate: null,
      fixedIncomeReturnRate: null,
      cpiInflationRate: null,
      healthcareInflationRate: null,
      totalLivingExpenses: null,
      categoryExpenses: {},
      healthcareOOP: null,
      irmaaSurcharges: null,
      preMedicareHealthcareCost: null,
      medicareBasePremiums: null,
      earnedSalaryYou: null,
      earnedSalaryWife: null,
      charitableTithe: null,
      magi: null,
      totalIncomeTax: null,
      endYourPreTaxIRA: null,
      endYourRothIRA: null,
      endYourTaxableBrokerage: null,
      endYourTaxableBasis: null,
      endYourCash: null,
      endWifePreTaxIRA: null,
      endWifeRothIRA: null,
      endWifeTaxableBrokerage: null,
      endWifeTaxableBasis: null,
      endWifeCash: null,
    };
  }, [actualTracking, selectedYear]);

  // Active ledger row for selected year
  const activeLedgerRow = useMemo(() => {
    return ledger.find((r) => r.year === selectedYear);
  }, [ledger, selectedYear]);

  // Sync actual logged expenses into activeRecord living expenses and healthcare
  const handleSyncActualsToRecord = () => {
    const nextCategories: Record<string, number> = {};
    let nonHealthcareSpend = 0;
    let loggedOOP = 0;
    let loggedPremiums = 0;
    let loggedIRMAA = 0;

    for (const exp of loggedExpenses) {
      const catLower = exp.categoryName.toLowerCase();
      const idLower = exp.categoryId.toLowerCase();
      if (
        idLower === 'healthcare-oop' ||
        catLower.includes('out-of-pocket') ||
        catLower.includes('deductible') ||
        catLower.includes('copay') ||
        catLower.includes('co-pay')
      ) {
        loggedOOP += exp.amount;
      } else if (
        idLower === 'healthcare-premiums' ||
        catLower.includes('insurance premium') ||
        catLower.includes('medicare part b') ||
        catLower.includes('supplement')
      ) {
        loggedPremiums += exp.amount;
      } else if (
        idLower === 'healthcare-irmaa' ||
        catLower.includes('irmaa') ||
        catLower.includes('surcharge')
      ) {
        loggedIRMAA += exp.amount;
      } else {
        const group = exp.categoryName.includes(' - ') ? exp.categoryName.split(' - ')[0].trim() : exp.categoryName;
        nextCategories[group] = (nextCategories[group] || 0) + exp.amount;
        nonHealthcareSpend += exp.amount;
      }
    }

    const updatedRecord: YearActualsRecord = {
      ...activeRecord,
      totalLivingExpenses: Math.round(nonHealthcareSpend),
      categoryExpenses: nextCategories,
      healthcareOOP: loggedOOP > 0 ? Math.round(loggedOOP) : activeRecord.healthcareOOP,
      preMedicareHealthcareCost: loggedPremiums > 0 ? Math.round(loggedPremiums) : activeRecord.preMedicareHealthcareCost,
      irmaaSurcharges: loggedIRMAA > 0 ? Math.round(loggedIRMAA) : activeRecord.irmaaSurcharges,
    };

    onUpdateActuals({
      ...actualTracking,
      [selectedYear]: updatedRecord,
    });
  };

  // Comparison list between Planned Detailed Budget and Logged Actuals
  const comparisonItems = useMemo(() => {
    const items: Array<{
      id: string;
      name: string;
      group: string;
      plannedAnnual: number;
      actualAnnual: number;
      variance: number;
      percentUsed: number;
      transactionCount: number;
      payers: Record<string, number>;
    }> = [];

    // 1. Detailed Living Expenses (or fallback to general living expenses if detailed expenses disabled)
    if (inputs.useDetailedExpenses && inputs.detailedExpenses) {
      const norm = normalizeDetailedExpenses(inputs.detailedExpenses);
      const activeStateForYear = (inputs.jurisdiction.relocationYear !== null && selectedYear >= inputs.jurisdiction.relocationYear)
        ? inputs.jurisdiction.targetState
        : inputs.jurisdiction.currentState;
      const stateCosts = norm.costs[activeStateForYear] || norm.costs.ALL || norm.costs[inputs.jurisdiction.currentState] || {};
      const freqs = norm.frequencies;

      for (const catItem of norm.catalog.items) {
        if (catItem.isOneTime && catItem.targetYear !== selectedYear) continue;

        const appliesToActiveState = !catItem.applicableStates ||
          catItem.applicableStates.includes('ALL') ||
          catItem.applicableStates.includes(activeStateForYear);

        const actualEntry = actualsSummary.byLineItem[catItem.id];
        const actualAmount = actualEntry?.total || 0;

        // Clean declutter: Hide line item completely if not applicable to current active state and has zero actual spend
        if (!appliesToActiveState && actualAmount === 0) {
          continue;
        }

        const cost = appliesToActiveState ? (stateCosts[catItem.id] ?? 0) : 0;
        const freq = freqs[catItem.id] ?? catItem.defaultFrequency ?? 12;
        const plannedFullYear = catItem.isOneTime ? cost : cost * freq;
        const plannedAmount = selectedMonthFilter ? cost * (freq / 12) : plannedFullYear;

        const variance = plannedAmount - actualAmount;
        const percentUsed = plannedAmount > 0 ? (actualAmount / plannedAmount) * 100 : actualAmount > 0 ? 999 : 0;

        items.push({
          id: catItem.id,
          name: !appliesToActiveState ? `${catItem.name} (Unbudgeted in ${activeStateForYear})` : catItem.name,
          group: catItem.category || 'Living',
          plannedAnnual: plannedAmount,
          actualAnnual: actualAmount,
          variance,
          percentUsed,
          transactionCount: actualEntry?.count || 0,
          payers: actualEntry?.payers || {},
        });
      }
    } else {
      const plannedLiving = activeLedgerRow?.plannedBaseLivingExpenses ?? (inputs.annualLivingExpenses ?? 100000);
      const plannedAmount = selectedMonthFilter ? plannedLiving / 12 : plannedLiving;
      const actualAmount = activeRecord.totalLivingExpenses ?? actualsSummary.totalSpend ?? 0;
      const variance = plannedAmount - actualAmount;
      const percentUsed = plannedAmount > 0 ? (actualAmount / plannedAmount) * 100 : actualAmount > 0 ? 999 : 0;
      items.push({
        id: 'general-living',
        name: 'General Living Expenses',
        group: 'Living',
        plannedAnnual: plannedAmount,
        actualAnnual: actualAmount,
        variance,
        percentUsed,
        transactionCount: actualsSummary.count,
        payers: actualsSummary.byPayer,
      });
    }

    // 2. Healthcare Insurance Premiums (Pre-65 + Medicare Base)
    const plannedPremiumsAnnual = (activeLedgerRow?.preMedicareHealthcareCost ?? 0) + (activeLedgerRow?.medicareBasePremiums ?? 0);
    const plannedPremiums = selectedMonthFilter ? plannedPremiumsAnnual / 12 : plannedPremiumsAnnual;
    const premiumsLoggedEntry = actualsSummary.byLineItem['healthcare-premiums'];
    const actualPremiums = premiumsLoggedEntry
      ? premiumsLoggedEntry.total
      : ((activeRecord.preMedicareHealthcareCost ?? 0) + (activeRecord.medicareBasePremiums ?? 0));

    if (plannedPremiums > 0 || actualPremiums > 0) {
      const variance = plannedPremiums - actualPremiums;
      const percentUsed = plannedPremiums > 0 ? (actualPremiums / plannedPremiums) * 100 : actualPremiums > 0 ? 999 : 0;
      items.push({
        id: 'healthcare-premiums',
        name: 'Healthcare Insurance Premiums (Pre-65 & Medicare Part B / Supp / D)',
        group: 'Healthcare',
        plannedAnnual: plannedPremiums,
        actualAnnual: actualPremiums,
        variance,
        percentUsed,
        transactionCount: premiumsLoggedEntry?.count ?? (actualPremiums > 0 ? 1 : 0),
        payers: premiumsLoggedEntry?.payers ?? {},
      });
    }

    // 3. Healthcare Out-of-Pocket (Max Allowance Ceiling vs Realized Co-pays & Deductibles)
    const plannedOOPAnnual = activeLedgerRow?.plannedHealthcareOOP ?? 0;
    const plannedOOP = selectedMonthFilter ? plannedOOPAnnual / 12 : plannedOOPAnnual;
    const oopLoggedEntry = actualsSummary.byLineItem['healthcare-oop'];
    const actualOOP = oopLoggedEntry
      ? oopLoggedEntry.total
      : (activeRecord.healthcareOOP ?? 0);

    if (plannedOOP > 0 || actualOOP > 0) {
      const variance = plannedOOP - actualOOP;
      const percentUsed = plannedOOP > 0 ? (actualOOP / plannedOOP) * 100 : actualOOP > 0 ? 999 : 0;
      items.push({
        id: 'healthcare-oop',
        name: 'Healthcare Out-of-Pocket (Max Allowance Ceiling)',
        group: 'Healthcare',
        plannedAnnual: plannedOOP,
        actualAnnual: actualOOP,
        variance,
        percentUsed,
        transactionCount: oopLoggedEntry?.count ?? (actualOOP > 0 ? 1 : 0),
        payers: oopLoggedEntry?.payers ?? {},
      });
    }

    // 4. Medicare IRMAA Surcharges (Part B & D)
    const plannedIRMAAAnnual = activeLedgerRow?.combinedSurchargeAnnual ?? 0;
    const plannedIRMAA = selectedMonthFilter ? plannedIRMAAAnnual / 12 : plannedIRMAAAnnual;
    const irmaaLoggedEntry = actualsSummary.byLineItem['healthcare-irmaa'];
    const actualIRMAA = irmaaLoggedEntry
      ? irmaaLoggedEntry.total
      : (activeRecord.irmaaSurcharges ?? 0);

    if (plannedIRMAA > 0 || actualIRMAA > 0) {
      const variance = plannedIRMAA - actualIRMAA;
      const percentUsed = plannedIRMAA > 0 ? (actualIRMAA / plannedIRMAA) * 100 : actualIRMAA > 0 ? 999 : 0;
      items.push({
        id: 'healthcare-irmaa',
        name: 'Medicare IRMAA Surcharges (Part B & D)',
        group: 'Healthcare',
        plannedAnnual: plannedIRMAA,
        actualAnnual: actualIRMAA,
        variance,
        percentUsed,
        transactionCount: irmaaLoggedEntry?.count ?? (actualIRMAA > 0 ? 1 : 0),
        payers: irmaaLoggedEntry?.payers ?? {},
      });
    }

    // 5. Also include any logged categories created on the fly not present in items
    for (const [catId, entry] of Object.entries(actualsSummary.byLineItem)) {
      if (!items.some((i) => i.id === catId)) {
        const parts = entry.name.includes(' - ') ? entry.name.split(' - ') : ['Custom', entry.name];
        items.push({
          id: catId,
          name: parts[1] ? parts[1].trim() : entry.name,
          group: parts[0].trim(),
          plannedAnnual: 0,
          actualAnnual: entry.total,
          variance: -entry.total,
          percentUsed: 999,
          transactionCount: entry.count,
          payers: entry.payers,
        });
      }
    }

    return items.sort((a, b) => b.actualAnnual - a.actualAnnual);
  }, [
    inputs.useDetailedExpenses,
    inputs.detailedExpenses,
    inputs.annualLivingExpenses,
    inputs.jurisdiction.currentState,
    inputs.jurisdiction.targetState,
    inputs.jurisdiction.relocationYear,
    selectedYear,
    selectedMonthFilter,
    actualsSummary,
    activeLedgerRow,
    activeRecord,
  ]);

  const totalPlannedForComparison = useMemo(() => {
    return comparisonItems.reduce((acc, i) => acc + i.plannedAnnual, 0);
  }, [comparisonItems]);

  const totalActualForComparison = useMemo(() => {
    return comparisonItems.reduce((acc, i) => acc + i.actualAnnual, 0);
  }, [comparisonItems]);

  const totalVarianceForComparison = totalPlannedForComparison - totalActualForComparison;

  // Format currency helper
  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  };

  // Dynamic regex / substring filter across all columns for the variance comparison table
  const filteredComparisonItems = useMemo(() => {
    if (!tableFilterText.trim()) return comparisonItems;

    const rawQuery = tableFilterText.trim();
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(rawQuery, 'i');
    } catch {
      regex = null;
    }
    const lowerQuery = rawQuery.toLowerCase();

    return comparisonItems.filter((item) => {
      const payerStrings = Object.entries(item.payers || {})
        .map(([payer, amt]) => `${payer} ${amt} ${formatCurrency(amt)}`)
        .join(' ');

      const concatenatedFields = [
        item.name,
        item.group,
        item.id,
        item.plannedAnnual.toString(),
        formatCurrency(item.plannedAnnual),
        Math.round(item.plannedAnnual).toString(),
        item.actualAnnual.toString(),
        formatCurrency(item.actualAnnual),
        Math.round(item.actualAnnual).toString(),
        item.variance.toString(),
        formatCurrency(item.variance),
        Math.round(item.variance).toString(),
        `${Math.round(item.percentUsed)}%`,
        `${item.transactionCount} logs`,
        item.transactionCount.toString(),
        payerStrings,
      ].join(' ');

      if (regex) {
        return regex.test(concatenatedFields);
      }
      return concatenatedFields.toLowerCase().includes(lowerQuery);
    });
  }, [comparisonItems, tableFilterText]);


  // Scheduled 12-month budget array accounting for periodic due months (e.g. Sep/Dec property taxes)
  const scheduledMonthlyBudgets = useMemo(() => {
    const monthlyBudgets = Array(12).fill(0);

    if (inputs.useDetailedExpenses && inputs.detailedExpenses) {
      const norm = normalizeDetailedExpenses(inputs.detailedExpenses);
      const activeStateForYear = (inputs.jurisdiction.relocationYear !== null && selectedYear >= inputs.jurisdiction.relocationYear)
        ? inputs.jurisdiction.targetState
        : inputs.jurisdiction.currentState;
      const stateCosts = norm.costs[activeStateForYear] || norm.costs.ALL || norm.costs[inputs.jurisdiction.currentState] || {};
      const freqs = norm.frequencies;

      for (const item of norm.catalog.items) {
        if (item.isOneTime && item.targetYear !== selectedYear) continue;

        const appliesToActiveState = !item.applicableStates ||
          item.applicableStates.includes('ALL') ||
          item.applicableStates.includes(activeStateForYear);
        if (!appliesToActiveState) continue;

        const cost = stateCosts[item.id] ?? 0;
        const freq = freqs[item.id] ?? item.defaultFrequency ?? (item.isOneTime ? 1 : 12);

        if (freq === 12 && !item.isOneTime) {
          // Monthly item: add to all 12 months
          for (let m = 0; m < 12; m++) {
            monthlyBudgets[m] += cost;
          }
        } else if (item.dueMonths && item.dueMonths.length > 0) {
          // Item has explicitly scheduled due month(s)
          item.dueMonths.forEach((mNum) => {
            if (mNum >= 1 && mNum <= 12) {
              monthlyBudgets[mNum - 1] += cost;
            }
          });
        } else {
          // Non-monthly without explicit due months: spread evenly (sinking fund accrual)
          const annualTotal = item.isOneTime ? cost : cost * freq;
          const monthlyPortion = annualTotal / 12;
          for (let m = 0; m < 12; m++) {
            monthlyBudgets[m] += monthlyPortion;
          }
        }
      }
    } else {
      const plannedLiving = activeLedgerRow?.plannedBaseLivingExpenses ?? (inputs.annualLivingExpenses ?? 100000);
      const monthlyPortion = plannedLiving / 12;
      for (let m = 0; m < 12; m++) {
        monthlyBudgets[m] += monthlyPortion;
      }
    }

    // Healthcare Obligations spread evenly across all 12 months
    const healthcareMonthly = ((activeLedgerRow?.preMedicareHealthcareCost ?? 0) +
      (activeLedgerRow?.medicareBasePremiums ?? 0) +
      (activeLedgerRow?.plannedHealthcareOOP ?? 0) +
      (activeLedgerRow?.combinedSurchargeAnnual ?? 0)) / 12;

    for (let m = 0; m < 12; m++) {
      monthlyBudgets[m] += healthcareMonthly;
    }

    return monthlyBudgets;
  }, [
    inputs.useDetailedExpenses,
    inputs.detailedExpenses,
    inputs.annualLivingExpenses,
    inputs.jurisdiction.currentState,
    inputs.jurisdiction.targetState,
    inputs.jurisdiction.relocationYear,
    selectedYear,
    activeLedgerRow,
  ]);

  // Monthly / Cumulative Stacked Category Spend Chart Data
  const monthlyExpensesChartData = useMemo(() => {
    const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const CATEGORY_COLORS: Record<string, { bg: string; border: string }> = {
      'Living': { bg: 'rgba(56, 189, 248, 0.85)', border: '#38bdf8' },
      'Home': { bg: 'rgba(99, 102, 241, 0.85)', border: '#6366f1' },
      'Utilities': { bg: 'rgba(234, 179, 8, 0.85)', border: '#eab308' },
      'Transportation': { bg: 'rgba(168, 85, 247, 0.85)', border: '#a855f7' },
      'Auto': { bg: 'rgba(168, 85, 247, 0.85)', border: '#a855f7' },
      'Leisure': { bg: 'rgba(236, 72, 153, 0.85)', border: '#ec4899' },
      'Healthcare': { bg: 'rgba(20, 184, 166, 0.85)', border: '#14b8a6' },
      'Insurance': { bg: 'rgba(14, 165, 233, 0.85)', border: '#0ea5e9' },
      'Charity': { bg: 'rgba(249, 115, 22, 0.85)', border: '#f97316' },
      'Taxes': { bg: 'rgba(244, 63, 94, 0.85)', border: '#f43f5e' },
      'One-Time Expenses': { bg: 'rgba(245, 158, 11, 0.85)', border: '#f59e0b' },
      'Custom': { bg: 'rgba(148, 163, 184, 0.85)', border: '#94a3b8' },
    };

    const FALLBACK_PALETTE = [
      { bg: 'rgba(56, 189, 248, 0.85)', border: '#38bdf8' },
      { bg: 'rgba(99, 102, 241, 0.85)', border: '#6366f1' },
      { bg: 'rgba(236, 72, 153, 0.85)', border: '#ec4899' },
      { bg: 'rgba(234, 179, 8, 0.85)', border: '#eab308' },
      { bg: 'rgba(20, 184, 166, 0.85)', border: '#14b8a6' },
      { bg: 'rgba(249, 115, 22, 0.85)', border: '#f97316' },
      { bg: 'rgba(168, 85, 247, 0.85)', border: '#a855f7' },
      { bg: 'rgba(244, 63, 94, 0.85)', border: '#f43f5e' },
    ];

    const groupsSet = new Set<string>();
    if (inputs.detailedExpenses?.catalog?.categories) {
      inputs.detailedExpenses.catalog.categories.forEach((c) => groupsSet.add(c));
    }

    const groupMonthlySpends: Record<string, number[]> = {};
    const initGroup = (g: string) => {
      if (!groupMonthlySpends[g]) {
        groupMonthlySpends[g] = Array(12).fill(0);
      }
    };

    groupsSet.forEach((g) => initGroup(g));

    allYearLoggedExpenses.forEach((exp) => {
      if (!exp.date) return;
      const m = parseInt(exp.date.split('-')[1], 10);
      if (m >= 1 && m <= 12) {
        let group = 'Living';
        if (exp.categoryName) {
          group = exp.categoryName.includes(' - ') ? exp.categoryName.split(' - ')[0].trim() : exp.categoryName.trim();
        }
        groupsSet.add(group);
        initGroup(group);
        groupMonthlySpends[group][m - 1] += (exp.amount || 0);
      }
    });

    const activeGroups = Array.from(groupsSet).filter((g) => {
      const total = (groupMonthlySpends[g] || []).reduce((a, b) => a + b, 0);
      return total > 0;
    });

    const isCumulative = chartAggregationMode === 'cumulative';

    // Build budget line data
    let budgetLineData: number[];
    if (isCumulative) {
      let runningSum = 0;
      budgetLineData = scheduledMonthlyBudgets.map((b) => {
        runningSum += b;
        return runningSum;
      });
    } else {
      budgetLineData = scheduledMonthlyBudgets;
    }

    const barDatasets = activeGroups.map((group, idx) => {
      const colors = CATEGORY_COLORS[group] || FALLBACK_PALETTE[idx % FALLBACK_PALETTE.length];
      let data = groupMonthlySpends[group];
      if (isCumulative) {
        let runningSpend = 0;
        data = data.map((s) => {
          runningSpend += s;
          return runningSpend;
        });
      }

      return {
        type: 'bar' as const,
        label: group,
        data,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        borderWidth: 1,
        stack: 'expensesStack',
        borderRadius: 3,
        order: 2,
      };
    });

    const budgetLineDataset = {
      type: 'line' as const,
      label: isCumulative ? 'Cumulative Planned Budget (YTD)' : 'Scheduled Monthly Budget',
      data: budgetLineData,
      borderColor: '#10b981',
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      borderDash: [6, 4],
      pointRadius: 3,
      pointHoverRadius: 6,
      pointBackgroundColor: '#10b981',
      pointBorderColor: '#0f172a',
      order: 1,
    };

    return {
      labels: MONTH_LABELS,
      datasets: [budgetLineDataset, ...barDatasets],
    };
  }, [allYearLoggedExpenses, inputs.detailedExpenses, scheduledMonthlyBudgets, chartAggregationMode]);

  const monthlyExpensesChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top' as const,
        onClick: (e: ChartEvent, legendItem: LegendItem, legend: { chart: ChartJS }) => {
          const index = legendItem.datasetIndex;
          if (index === undefined) return;
          const ci = legend.chart;
          const nativeEvent = e.native as MouseEvent | undefined;
          const hasModifier = nativeEvent ? (nativeEvent.ctrlKey || nativeEvent.altKey || nativeEvent.shiftKey || nativeEvent.metaKey) : false;

          if (hasModifier) {
            // Modifier + Click: Solo / Isolate (or reset if already soloed)
            let visibleCount = 0;
            let isClickedVisible = false;
            ci.data.datasets.forEach((_, i: number) => {
              if (ci.isDatasetVisible(i)) {
                visibleCount++;
                if (i === index) {
                  isClickedVisible = true;
                }
              }
            });

            if (visibleCount === 1 && isClickedVisible) {
              // Already soloed: Show all
              ci.data.datasets.forEach((_, i: number) => {
                ci.setDatasetVisibility(i, true);
              });
            } else {
              // Solo this dataset
              ci.data.datasets.forEach((_, i: number) => {
                ci.setDatasetVisibility(i, i === index);
              });
            }
          } else {
            // Standard Click: Toggle individually
            const isVisible = ci.isDatasetVisible(index);
            ci.setDatasetVisibility(index, !isVisible);
          }

          ci.update();

          // Update hasHiddenExpensesDatasets state to conditionally render Show All Categories UI
          let anyHidden = false;
          ci.data.datasets.forEach((_, i: number) => {
            if (!ci.isDatasetVisible(i)) {
              anyHidden = true;
            }
          });
          setHasHiddenExpensesDatasets(anyHidden);
        },
        labels: {
          color: '#cbd5e1',
          boxWidth: 15,
          padding: 12,
          usePointStyle: true,
          font: { size: 11, weight: 500 },
        },
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        borderColor: '#334155',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          label: (context: { dataset: { label?: string; type?: string }; raw: unknown }) => {
            const val = Number(context.raw) || 0;
            if (val === 0 && context.dataset.type === 'bar') return '';
            return ` ${context.dataset.label || 'Spend'}: ${formatCurrency(val)}`;
          },
          footer: (items: Array<{ dataset: { type?: string }; raw: unknown }>) => {
            const totalActual = items
              .filter((i) => i.dataset.type === 'bar')
              .reduce((sum: number, i) => sum + (Number(i.raw) || 0), 0);
            return totalActual > 0 ? `Total Actual: ${formatCurrency(totalActual)}` : '';
          },
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        ticks: { color: '#94a3b8', font: { size: 11 } },
        grid: { color: 'rgba(51, 65, 85, 0.25)' },
      },
      y: {
        stacked: true,
        ticks: {
          color: '#94a3b8',
          font: { size: 11 },
          callback: (val: string | number) => formatCurrency(Number(val)),
        },
        grid: { color: 'rgba(51, 65, 85, 0.25)' },
      },
    },
  }), []);

  // Update field in active record
  const handleFieldChange = <K extends keyof YearActualsRecord>(field: K, value: YearActualsRecord[K]) => {
    const updatedRecord = {
      ...activeRecord,
      [field]: value,
    };
    const nextActuals = {
      ...actualTracking,
      [selectedYear]: updatedRecord,
    };
    onUpdateActuals(nextActuals);
  };

  // Update category expense
  const handleCategoryCostChange = (category: string, cost: number) => {
    const nextCategories = {
      ...(activeRecord.categoryExpenses || {}),
      [category]: cost,
    };
    const nextTotal = Object.values(nextCategories).reduce((sum, c) => sum + (c || 0), 0);
    const updatedRecord = {
      ...activeRecord,
      categoryExpenses: nextCategories,
      totalLivingExpenses: nextTotal,
    };
    const nextActuals = {
      ...actualTracking,
      [selectedYear]: updatedRecord,
    };
    onUpdateActuals(nextActuals);
  };

  // Helper to compute planned recurring budget for a given year (considering relocation)
  const getPlannedRecurringBudgetForYear = useCallback((year: number) => {
    if (inputs.useDetailedExpenses && inputs.detailedExpenses) {
      const activeState = (inputs.jurisdiction.relocationYear !== null && year >= inputs.jurisdiction.relocationYear)
        ? inputs.jurisdiction.targetState
        : inputs.jurisdiction.currentState;
      const norm = normalizeDetailedExpenses(inputs.detailedExpenses);
      const stateCosts = norm.costs[activeState] || {};
      const allCosts = norm.costs['ALL'] || {};
      const defaultStateCosts = norm.costs[inputs.jurisdiction.currentState] || {};
      const freqs = norm.frequencies;
      const sum = norm.catalog.items
        .filter((i) => !i.isOneTime)
        .reduce((acc, item) => {
          const applies = !item.applicableStates || item.applicableStates.includes('ALL') || item.applicableStates.includes(activeState);
          if (!applies) return acc;
          const cost = stateCosts[item.id] ?? allCosts[item.id] ?? defaultStateCosts[item.id] ?? 0;
          const freq = freqs[item.id] ?? item.defaultFrequency ?? 12;
          return acc + cost * freq;
        }, 0);
      if (sum > 0) return sum;
    }
    return inputs.annualLivingExpenses ?? 100000;
  }, [
    inputs.useDetailedExpenses,
    inputs.detailedExpenses,
    inputs.jurisdiction.relocationYear,
    inputs.jurisdiction.targetState,
    inputs.jurisdiction.currentState,
    inputs.annualLivingExpenses,
  ]);

  // Add a new year
  const handleAddYear = () => {
    const existingYears = Object.keys(actualTracking).map(Number);
    const nextYear = existingYears.length > 0 ? Math.max(...existingYears) + 1 : simStartYear;
    const newRecord: YearActualsRecord = {
      year: nextYear,
      equityReturnRate: inputs.growthAssumptions.equityReturnRate,
      fixedIncomeReturnRate: inputs.growthAssumptions.fixedIncomeReturnRate,
      cpiInflationRate: inputs.growthAssumptions.cpiInflationRate,
      healthcareInflationRate: inputs.growthAssumptions.healthcareInflationRate,
      totalLivingExpenses: getPlannedRecurringBudgetForYear(nextYear),
    };
    const nextActuals = {
      ...actualTracking,
      [nextYear]: newRecord,
    };
    onUpdateActuals(nextActuals);
    setSelectedYear(nextYear);
  };

  // Delete active year after confirmation
  const confirmDeleteYear = (yearToDelete: number) => {
    const nextActuals = { ...actualTracking };
    delete nextActuals[yearToDelete];
    onUpdateActuals(nextActuals);
    const remaining = Object.keys(nextActuals).map(Number);
    if (remaining.length > 0) {
      setSelectedYear(remaining[0]);
    } else {
      setSelectedYear(simStartYear);
    }
  };

  // Latest actual row for guardrail analysis
  const latestActualRow = useMemo(() => {
    const actualRows = ledger.filter((r) => r.isActual);
    if (actualRows.length === 0) return null;
    return actualRows[actualRows.length - 1];
  }, [ledger]);

  // Baseline recurring budget for current calendar year
  const baselineRecurringAnnual = useMemo(() => {
    return getPlannedRecurringBudgetForYear(currentCalendarYear);
  }, [getPlannedRecurringBudgetForYear, currentCalendarYear]);

  // Guardrail metrics
  const plannedBudgetBase = getPlannedRecurringBudgetForYear(latestActualRow?.year ?? selectedYear);
  const plannedBudget = latestActualRow?.plannedLivingExpenses ?? (plannedBudgetBase * (ledger[0]?.cpiFactor ?? 1.0) + (ledger[0]?.plannedHealthcareOOP ?? 0));
  const guardrailUpperLimit = latestActualRow?.guardrailUpperLimit ?? (plannedBudget * (1 + (guardrailSettings.upperGuardrailPct ?? 0.15)));
  const guardrailLowerLimit = latestActualRow?.guardrailLowerLimit ?? (plannedBudget * (1 - (guardrailSettings.lowerGuardrailPct ?? 0.15)));
  const currentSurplusGap = latestActualRow?.actualSurplusGap ?? 0;
  const permittedBonus = latestActualRow?.permittedSpendingBonus ?? 0;

  // Actual spend: if an actual row exists in ledger, use its realized living expenses.
  // Otherwise, use what's tracked or logged for selectedYear (defaults to 0 when zero transactions logged).
  const trackedSpend = (activeRecord?.totalLivingExpenses !== undefined && activeRecord?.totalLivingExpenses !== null)
    ? (activeRecord.totalLivingExpenses + (activeRecord.healthcareOOP ?? 0))
    : actualsSummary.totalSpend;
  const actualSpend = latestActualRow ? latestActualRow.livingExpenses : trackedSpend;
  const spendingSavings = plannedBudget - actualSpend;
  const marketSurplusShare = latestActualRow ? (currentSurplusGap - spendingSavings) : 0;

  // Variance Comparison Chart Data
  const varianceChartData = useMemo(() => {
    const actualYears = ledger.filter((r) => r.isActual || r.isBridged);
    const rowsToChart = actualYears.length > 0 ? actualYears : ledger.slice(0, 8);
    const isProjectedFallback = actualYears.length === 0;

    return {
      labels: rowsToChart.map((r) => r.year.toString()),
      datasets: [
        {
          label: 'Planned Budget ($)',
          data: rowsToChart.map((r) => r.plannedLivingExpenses ?? (getPlannedRecurringBudgetForYear(r.year) * r.cpiFactor)),
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96, 165, 250, 0.1)',
          borderWidth: 1.75,
          borderDash: [5, 5],
          pointRadius: 3,
          fill: false,
        },
        {
          label: isProjectedFallback ? 'Projected Spending ($)' : 'Actual Spending ($)',
          data: rowsToChart.map((r) => r.livingExpenses),
          borderColor: '#34d399',
          backgroundColor: 'rgba(52, 211, 153, 0.2)',
          borderWidth: 2.5,
          pointRadius: 4,
          fill: false,
        },
        {
          label: 'Upper Guardrail Ceiling ($)',
          data: rowsToChart.map((r) => r.guardrailUpperLimit || 0),
          borderColor: '#f59e0b',
          borderWidth: 1.25,
          borderDash: [4, 4],
          pointRadius: 2,
          fill: false,
        },
        {
          label: 'Lower Guardrail Floor ($)',
          data: rowsToChart.map((r) => r.guardrailLowerLimit || 0),
          borderColor: '#ef4444',
          borderWidth: 1.25,
          borderDash: [4, 4],
          pointRadius: 2,
          fill: false,
        },
      ],
    };
  }, [ledger, getPlannedRecurringBudgetForYear]);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 custom-scrollbar bg-slate-950 text-slate-100">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <ClipboardCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Actual Tracking & Guardrail Plan
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  Active
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Substitute simulated predictions with verified real-world market returns, expenses, and account balances.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-2">
          {actualTracking[selectedYear] && (
            <button
              onClick={() => setYearPendingDelete(selectedYear)}
              className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 transition-all flex items-center gap-1.5 cursor-pointer"
              title={`Delete actual record for ${selectedYear}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete {selectedYear} Actuals
            </button>
          )}
          <button
            onClick={() => setShowGuardrailConfig(!showGuardrailConfig)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer ${
              showGuardrailConfig
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Guardrail Settings
          </button>
          <button
            onClick={handleAddYear}
            className="px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all flex items-center gap-1.5 shadow-md cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            Log New Year
          </button>
        </div>
      </div>

      {/* Guardrail Settings Panel (Expandable) */}
      {showGuardrailConfig && (
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-4 shadow-xl space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-emerald-300 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Guardrail Dynamic Spending Policy Parameters
            </h3>
            <button
              onClick={() => setShowGuardrailConfig(false)}
              className="text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
            >
              Close
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1.5">
              <RangeSlider
                min={0.05}
                max={0.40}
                step={0.01}
                value={guardrailSettings.upperGuardrailPct}
                onChange={(val) =>
                  onUpdateGuardrailSettings({
                    ...guardrailSettings,
                    upperGuardrailPct: val,
                  })
                }
                className="w-full accent-emerald-400"
                renderLabel={(displayVal) => (
                  <label className="text-slate-300 font-semibold flex items-center justify-between">
                    Upper Guardrail (+%)
                    <span className="text-emerald-400 font-mono">+{(displayVal * 100).toFixed(0)}%</span>
                  </label>
                )}
              />
              <p className="text-[11px] text-slate-500">Maximum allowable budget surge in boom years.</p>
            </div>

            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1.5">
              <RangeSlider
                min={0.05}
                max={0.40}
                step={0.01}
                value={guardrailSettings.lowerGuardrailPct}
                onChange={(val) =>
                  onUpdateGuardrailSettings({
                    ...guardrailSettings,
                    lowerGuardrailPct: val,
                  })
                }
                className="w-full accent-rose-400"
                renderLabel={(displayVal) => (
                  <label className="text-slate-300 font-semibold flex items-center justify-between">
                    Lower Guardrail (-%)
                    <span className="text-rose-400 font-mono">-{(displayVal * 100).toFixed(0)}%</span>
                  </label>
                )}
              />
              <p className="text-[11px] text-slate-500">Maximum recommended belt-tightening floor.</p>
            </div>

            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1.5">
              <RangeSlider
                min={0.02}
                max={0.25}
                step={0.01}
                value={guardrailSettings.marketSurplusSharePct}
                onChange={(val) =>
                  onUpdateGuardrailSettings({
                    ...guardrailSettings,
                    marketSurplusSharePct: val,
                  })
                }
                className="w-full accent-sky-400"
                renderLabel={(displayVal) => (
                  <label className="text-slate-300 font-semibold flex items-center justify-between">
                    Market Surplus Share
                    <span className="text-sky-400 font-mono">{(displayVal * 100).toFixed(0)}%</span>
                  </label>
                )}
              />
              <p className="text-[11px] text-slate-500">Share of market excess allocated to spending bonus.</p>
            </div>

            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
              <div className="space-y-1">
                <span className="text-slate-300 font-semibold">Apply to Forward Simulation</span>
                <p className="text-[11px] text-slate-500">Dynamic Guyton-Klinger style adjustments in Monte Carlo.</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={guardrailSettings.applyToSimulation}
                  onChange={(e) =>
                    onUpdateGuardrailSettings({
                      ...guardrailSettings,
                      applyToSimulation: e.target.checked,
                    })
                  }
                  className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 w-4 h-4"
                />
                <span className="text-xs font-semibold text-slate-200">Enable Dynamic Policy</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Guardrail Health Advisory & KPI Banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Permission to Spend Advisory Card */}
        <div className="md:col-span-2 bg-gradient-to-br from-slate-900 to-slate-900/70 border border-emerald-500/30 rounded-2xl p-4 shadow-lg flex flex-col justify-between relative overflow-hidden">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Permission to Spend Advisory ({latestActualRow ? latestActualRow.year : selectedYear})
              </span>
              <span
                className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full border ${
                  !latestActualRow
                    ? 'bg-slate-800 text-slate-300 border-slate-700'
                    : currentSurplusGap >= 0
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                }`}
              >
                {!latestActualRow
                  ? 'Tracking Active'
                  : currentSurplusGap >= 0
                  ? `+${formatCurrency(currentSurplusGap)} Net Surplus`
                  : `${formatCurrency(currentSurplusGap)} Deficit`}
              </span>
            </div>
            <p className="text-sm font-bold text-slate-100 mt-1">
              {!latestActualRow ? (
                <>
                  Tracking for {selectedYear} is active. Log actual expense transactions and reconcile year-end portfolio balances to activate next year's spending advisory.
                </>
              ) : currentSurplusGap >= 0 ? (
                <>
                  You have <span className="text-emerald-400">permission to spend up to +{formatCurrency(permittedBonus)}</span> in extra discretionary budget next year!
                </>
              ) : (
                <>
                  Portfolio underperformance / spending gap suggests trimming next year's budget by{' '}
                  <span className="text-rose-400">{formatCurrency(Math.abs(currentSurplusGap))}</span>.
                </>
              )}
            </p>
            <p className="text-xs text-slate-400">
              Planned Baseline: <span className="text-slate-200 font-semibold">{formatCurrency(plannedBudget)}</span> | Actual Spent:{' '}
              <span className="text-slate-200 font-semibold">{formatCurrency(actualSpend)}</span>
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-400">
              <span className="bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
                Expense Savings: <span className={spendingSavings >= 0 ? "text-emerald-400 font-semibold font-mono" : "text-rose-400 font-semibold font-mono"}>{spendingSavings >= 0 ? `+${formatCurrency(spendingSavings)}` : formatCurrency(spendingSavings)}</span>
              </span>
              <span className="bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
                Market Growth Share ({((guardrailSettings.marketSurplusSharePct || 0.10) * 100).toFixed(0)}%): <span className="text-sky-400 font-semibold font-mono">+{formatCurrency(marketSurplusShare)}</span>
              </span>
              <span className="bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
                Upper Ceiling (+{((guardrailSettings.upperGuardrailPct || 0.15) * 100).toFixed(0)}%): <span className="text-amber-400 font-semibold font-mono">{formatCurrency(guardrailUpperLimit)}</span>
              </span>
              <span className="bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800">
                Lower Floor (-{((guardrailSettings.lowerGuardrailPct || 0.15) * 100).toFixed(0)}%): <span className="text-rose-400 font-semibold font-mono">{formatCurrency(guardrailLowerLimit)}</span>
              </span>
            </div>
          </div>

          {onApplySpendingBonusToBudget && (
            <div className="pt-3 flex flex-wrap items-center gap-3">
              {currentSurplusGap > 0 && (
                <button
                  onClick={() => {
                    const base = baselineRecurringAnnual > 0 ? baselineRecurringAnnual : (inputs.annualLivingExpenses ?? 100000);
                    onApplySpendingBonusToBudget(base + permittedBonus);
                  }}
                  className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all flex items-center gap-1.5 cursor-pointer shadow"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Apply +{formatCurrency(permittedBonus)} to Next Year Budget
                </button>
              )}

              <button
                onClick={() => {
                  onApplySpendingBonusToBudget(baselineRecurringAnnual > 0 ? baselineRecurringAnnual : 100000);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
                title="Reset annual living expenses budget back to original unadjusted baseline"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                Reset Budget to Baseline ({formatCurrency(baselineRecurringAnnual || 100000)})
              </button>
            </div>
          )}
        </div>

        {/* Guardrail Boundaries Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow flex flex-col justify-between">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
            Guardrail Spending Bands
          </span>
          <div className="space-y-1.5 my-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5 text-amber-400" /> Upper Ceiling:
              </span>
              <span className="font-bold text-amber-300">{formatCurrency(guardrailUpperLimit)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Planned Budget:</span>
              <span className="font-bold text-slate-200">{formatCurrency(plannedBudget)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1">
                <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" /> Lower Floor:
              </span>
              <span className="font-bold text-rose-300">{formatCurrency(guardrailLowerLimit)}</span>
            </div>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden flex">
            <div
              className="bg-emerald-400 h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(10, (actualSpend / (guardrailUpperLimit || 1)) * 100))}%`,
              }}
            />
          </div>
        </div>

        {/* Reconciled Ending Balance Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow flex flex-col justify-between">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            Verified Portfolio Value ({latestActualRow ? latestActualRow.year : currentCalendarYear})
          </span>
          <div className="my-2">
            <div className="text-2xl font-black text-white tracking-tight">
              {formatCurrency(latestActualRow?.totalPortfolioValue ?? 0)}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {Object.keys(actualTracking).length} verified year{Object.keys(actualTracking).length === 1 ? '' : 's'} logged
            </p>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Timeline seamlessly stitched forward
          </div>
        </div>
      </div>

      {/* Year Selection Strip */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 flex items-center gap-2 overflow-x-auto custom-scrollbar">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-2 flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5 text-emerald-400" /> Timeline Years:
        </span>
        {recordedYears.map((yr) => {
          const isSelected = selectedYear === yr;
          const isAct = Boolean(actualTracking[yr]);
          return (
            <button
              key={yr}
              onClick={() => setSelectedYear(yr)}
              className={`group px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                isSelected
                  ? 'bg-emerald-500 text-slate-950 shadow-md font-extrabold'
                  : isAct
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                  : 'bg-slate-800/80 border border-slate-700/80 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>{yr}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                  isSelected
                    ? 'bg-slate-950/30 text-slate-950 font-bold'
                    : isAct
                    ? 'bg-emerald-500/30 text-emerald-200'
                    : 'bg-slate-700 text-slate-300'
                }`}
              >
                {isAct ? 'ACTUAL' : 'PROJECTED'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Logged Expense Actuals & Budget Reconciliation Card */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow space-y-4 animate-in fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                Logged Actual Expenses & Budget Variance ({selectedYear})
                {selectedMonthFilter && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700 font-normal">
                    Month {selectedMonthFilter}
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Live expense records synchronized from your companion Expenser PWA and household storage. Click any line item to view, filter, sort, edit, or delete logged purchases. Manage planned baselines in the{' '}
                {onNavigateToTab && (
                  <button
                    type="button"
                    onClick={() => onNavigateToTab('params-expenses')}
                    className="text-emerald-400 hover:text-emerald-300 underline font-medium cursor-pointer inline-flex items-center gap-0.5"
                  >
                    Detailed Living Expenses worksheet
                    <ArrowRight className="w-2.5 h-2.5" />
                  </button>
                )}
                .
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-nowrap shrink-0">
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700/80 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shrink-0 whitespace-nowrap cursor-pointer"
              title="Import and backfill expenses from CSV"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span>Import / Backfill</span>
            </button>

            <a
              href="/expenser"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm shrink-0 whitespace-nowrap"
              title="Open mobile Expenser PWA in new tab"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Open Expenser</span>
              <ExternalLink className="w-3 h-3 text-emerald-400" />
            </a>

            <button
              onClick={() => loadLoggedExpenses()}
              disabled={isLoadingExpenses}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-all border border-slate-700/60 cursor-pointer shrink-0"
              title="Refresh logged expenses"
              aria-label="Refresh logged expenses"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingExpenses ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Month Filter Selector Strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar text-xs">
          <span className="text-slate-500 font-bold uppercase text-[10px] tracking-wider shrink-0 mr-1">
            Filter Period:
          </span>
          <button
            onClick={() => setSelectedMonthFilter(null)}
            className={`px-2.5 py-1 rounded-lg font-semibold transition-all shrink-0 cursor-pointer ${
              selectedMonthFilter === null
                ? 'bg-emerald-500 text-slate-950 shadow font-bold'
                : 'bg-slate-950/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            Full Year {selectedYear}
          </button>
          {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((mName, mIdx) => {
            const mNum = mIdx + 1;
            const isSelected = selectedMonthFilter === mNum;
            return (
              <button
                key={mNum}
                onClick={() => setSelectedMonthFilter(isSelected ? null : mNum)}
                className={`px-2 py-1 rounded-lg font-medium transition-all shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-500 text-slate-950 shadow font-bold'
                    : 'bg-slate-950/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {mName}
              </button>
            );
          })}
        </div>

        {/* Summary KPIs Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Total Actual Spend */}
          <div className="bg-slate-950/60 border border-slate-800/90 rounded-xl p-3.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Total Actual Spend
            </span>
            <div className="text-xl font-extrabold text-white mt-1">
              {formatCurrency(totalActualForComparison)}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {actualsSummary.count} logged transaction{actualsSummary.count === 1 ? '' : 's'} + recorded actuals
            </p>
          </div>

          {/* Planned Budget */}
          <div className="bg-slate-950/60 border border-slate-800/90 rounded-xl p-3.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Planned Total Budget
            </span>
            <div className="text-xl font-extrabold text-slate-200 mt-1">
              {formatCurrency(totalPlannedForComparison)}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {selectedMonthFilter ? '1 month allocation' : 'Annual comprehensive living & healthcare budget'}
            </p>
          </div>

          {/* Net Variance */}
          {(() => {
            const isUnder = totalVarianceForComparison >= 0;
            const pct = totalPlannedForComparison > 0 ? Math.abs((totalVarianceForComparison / totalPlannedForComparison) * 100).toFixed(1) : '0';
            return (
              <div className={`border rounded-xl p-3.5 ${
                isUnder
                  ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
              }`}>
                <span className="text-[11px] font-bold uppercase tracking-wider block">
                  {isUnder ? 'Under Budget (Surplus)' : 'Over Budget (Deficit)'}
                </span>
                <div className="text-xl font-extrabold mt-1 flex items-center gap-1">
                  {isUnder ? `+${formatCurrency(totalVarianceForComparison)}` : `-${formatCurrency(Math.abs(totalVarianceForComparison))}`}
                </div>
                <p className="text-[11px] opacity-80 mt-0.5">
                  {isUnder ? `${pct}% below planned budget` : `${pct}% above planned budget`}
                </p>
              </div>
            );
          })()}

          {/* Payer Breakdown & Sync Action */}
          <div className="bg-slate-950/60 border border-slate-800/90 rounded-xl p-3.5 flex flex-col justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Payer Share
              </span>
              <div className="flex items-center gap-2 mt-1 text-xs">
                {Object.keys(actualsSummary.byPayer).length === 0 ? (
                  <span className="text-slate-500 italic">No transactions</span>
                ) : (
                  Object.entries(actualsSummary.byPayer).map(([payer, amount]) => (
                    <span key={payer} className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700 text-slate-300 font-medium">
                      {payer}: <strong>{formatCurrency(amount)}</strong>
                    </span>
                  ))
                )}
              </div>
            </div>

            {actualsSummary.totalSpend > 0 && !selectedMonthFilter && (
              <button
                type="button"
                onClick={handleSyncActualsToRecord}
                className="mt-2 w-full py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-all flex items-center justify-center gap-1 cursor-pointer shadow"
                title="Copy logged actual spend total into Living Expenses override for this timeline year"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Sync to Year {selectedYear} Total</span>
              </button>
            )}
          </div>
        </div>

        {/* 3-Way View Selector: Table / Graph / Hide */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="inline-flex p-1 bg-slate-950/80 rounded-xl border border-slate-800 shadow-inner">
            <button
              type="button"
              onClick={() => setExpensesDisplayMode(prev => prev === 'table' ? 'none' : 'table')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                expensesDisplayMode === 'table'
                  ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Table View</span>
            </button>

            <button
              type="button"
              onClick={() => setExpensesDisplayMode(prev => prev === 'chart' ? 'none' : 'chart')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                expensesDisplayMode === 'chart'
                  ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Graph View</span>
            </button>

            <button
              type="button"
              onClick={() => setExpensesDisplayMode(prev => prev === 'none' ? 'table' : 'none')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                expensesDisplayMode === 'none'
                  ? 'bg-slate-800 text-slate-200 font-bold border border-slate-700'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900'
              }`}
              title="Hide table and graph"
            >
              <EyeOff className="w-3.5 h-3.5" />
              <span>{expensesDisplayMode === 'none' ? 'Hidden' : 'Hide'}</span>
            </button>
          </div>
        </div>

        {/* Graph View: Monthly / Cumulative Stacked Bar Chart with Budget Benchmark */}
        {expensesDisplayMode === 'chart' && (
          <div className="space-y-3 pt-1 animate-in fade-in duration-200">
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      {chartAggregationMode === 'monthly'
                        ? `Monthly Spend by Category vs. Scheduled Budget (${selectedYear})`
                        : `Cumulative Year-to-Date (YTD) Spend vs. Budget (${selectedYear})`}
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      {chartAggregationMode === 'monthly'
                        ? 'Category spending compared against true scheduled monthly budgets (including scheduled due months for property taxes & insurance).'
                        : 'Running cumulative total of actual spend compared against cumulative planned budget progression.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                  {hasHiddenExpensesDatasets && (
                    <button
                      type="button"
                      onClick={() => {
                        if (monthlyExpensesChartRef.current) {
                          const chart = monthlyExpensesChartRef.current;
                          chart.data.datasets.forEach((_, i: number) => {
                            chart.setDatasetVisibility(i, true);
                          });
                          chart.update();
                          setHasHiddenExpensesDatasets(false);
                        }
                      }}
                      className="text-xs font-semibold px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 rounded-lg transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Show All Categories</span>
                    </button>
                  )}

                  {/* Monthly vs Cumulative Toggle */}
                  <div className="inline-flex p-0.5 bg-slate-900 rounded-lg border border-slate-800 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setChartAggregationMode('monthly')}
                      className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                        chartAggregationMode === 'monthly'
                          ? 'bg-emerald-500 text-slate-950 shadow font-bold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Monthly Cash Flow
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartAggregationMode('cumulative')}
                      className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                        chartAggregationMode === 'cumulative'
                          ? 'bg-emerald-500 text-slate-950 shadow font-bold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Cumulative YTD
                    </button>
                  </div>
                </div>
              </div>

              <div className="h-80 w-full pt-1">
                <Chart
                  ref={monthlyExpensesChartRef}
                  type="bar"
                  data={monthlyExpensesChartData}
                  options={monthlyExpensesChartOptions}
                />
              </div>
            </div>
          </div>
        )}

        {/* Detailed Line Item Variance Table */}
        {expensesDisplayMode === 'table' && (
          <div className="space-y-3 pt-1">
            {comparisonItems.length === 0 ? (
              <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-8 text-center space-y-2.5">
                <p className="text-sm font-semibold text-slate-300">
                  No actual expenses logged for {selectedMonthFilter ? `Month ${selectedMonthFilter}, ` : ''}{selectedYear} yet.
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Log daily expenses on the go with the mobile companion app or add a line item to start tracking variances against your retirement budget.
                </p>
                <div className="pt-2">
                  <a
                    href="/expenser"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg transition-all"
                  >
                    <Smartphone className="w-4 h-4" />
                    Launch Expenser PWA
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Dynamic Table Filter Bar */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 bg-slate-950/60 border border-slate-800/80 p-2.5 rounded-xl">
                  <div className="relative w-full sm:w-80">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={tableFilterText}
                      onChange={(e) => setTableFilterText(e.target.value)}
                      placeholder="Filter rows (e.g. 2310, gas, living.*12, Spouse)..."
                      className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                    {tableFilterText && (
                      <button
                        type="button"
                        onClick={() => setTableFilterText('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-white rounded cursor-pointer"
                        title="Clear filter"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-400 self-end sm:self-auto">
                    {tableFilterText.trim() ? (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-semibold">
                        Showing {filteredComparisonItems.length} of {comparisonItems.length} rows
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 font-medium">
                        {comparisonItems.length} line items
                      </span>
                    )}
                  </div>
                </div>

                {filteredComparisonItems.length === 0 ? (
                  <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-8 text-center space-y-2.5">
                    <p className="text-xs text-slate-400 font-medium">
                      No line items match filter <strong className="text-white font-mono">"{tableFilterText}"</strong>
                    </p>
                    <button
                      type="button"
                      onClick={() => setTableFilterText('')}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer transition-colors"
                    >
                      Clear Filter
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-800 rounded-xl">
                    <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800">
                      <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] font-bold tracking-wider">
                        <tr>
                          <th className="px-3.5 py-2.5">Line Item / Category</th>
                          <th className="px-3.5 py-2.5 text-right">Planned Budget</th>
                          <th className="px-3.5 py-2.5 text-right">Actual Spend</th>
                          <th className="px-3.5 py-2.5 text-right">Variance</th>
                          <th className="px-3.5 py-2.5">Budget Usage</th>
                          <th className="px-3.5 py-2.5">Payer Breakdown</th>
                          <th className="px-3.5 py-2.5 text-center">Actuals</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                        {filteredComparisonItems.map((item) => {
                          const isOver = item.variance < 0;
                          const hasSpend = item.actualAnnual > 0;
                          return (
                            <tr
                              key={item.id}
                              onClick={() => {
                                setSelectedLineItemForBreakdown(item);
                                setBreakdownFilterText('');
                                setBreakdownPayerFilter('ALL');
                                setBreakdownSortField('date');
                                setBreakdownSortDirection('desc');
                                setEditingExpenseId(null);
                              }}
                              className="hover:bg-slate-800/60 transition-colors cursor-pointer group"
                              title="Click to view detailed expense breakdown, edit, or delete logged transactions"
                            >
                              <td className="px-3.5 py-2.5 font-medium text-white flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 group-hover:scale-125 transition-transform" />
                                <div>
                                  <div className="font-semibold text-slate-100 group-hover:text-emerald-300 transition-colors flex items-center gap-1.5">
                                    <span>{item.name}</span>
                                    {item.transactionCount > 0 && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold font-mono">
                                        {item.transactionCount}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-500">{item.group}</div>
                                </div>
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-mono text-slate-300">
                                {formatCurrency(item.plannedAnnual)}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-mono font-semibold text-white">
                                {formatCurrency(item.actualAnnual)}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-mono">
                                {hasSpend ? (
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                                      isOver
                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    }`}
                                  >
                                    {isOver ? `-${formatCurrency(Math.abs(item.variance))}` : `+${formatCurrency(item.variance)}`}
                                  </span>
                                ) : (
                                  <span className="text-slate-500">$0</span>
                                )}
                              </td>
                              <td className="px-3.5 py-2.5 min-w-[130px]">
                                {item.plannedAnnual > 0 ? (
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-mono text-slate-400">
                                      <span>{Math.round(item.percentUsed)}%</span>
                                    </div>
                                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          item.percentUsed > 100
                                            ? 'bg-rose-500'
                                            : item.percentUsed > 80
                                            ? 'bg-amber-400'
                                            : 'bg-emerald-400'
                                        }`}
                                        style={{ width: `${Math.min(100, item.percentUsed)}%` }}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-500 italic">No budget set</span>
                                )}
                              </td>
                              <td className="px-3.5 py-2.5">
                                {Object.keys(item.payers).length > 0 ? (
                                  <div className="flex flex-wrap gap-1 text-[10px]">
                                    {Object.entries(item.payers).map(([payer, amt]) => (
                                      <span key={payer} className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                        {payer}: {formatCurrency(amt)}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-600 text-[11px]">—</span>
                                )}
                              </td>
                              <td className="px-3.5 py-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedLineItemForBreakdown(item);
                                    setBreakdownFilterText('');
                                    setBreakdownPayerFilter('ALL');
                                    setBreakdownSortField('date');
                                    setBreakdownSortDirection('desc');
                                    setEditingExpenseId(null);
                                  }}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                    item.transactionCount > 0
                                      ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30'
                                      : 'bg-slate-800/40 hover:bg-slate-800 text-slate-500 hover:text-slate-300 border border-slate-700/50'
                                  }`}
                                >
                                  <span>{item.transactionCount > 0 ? `${item.transactionCount} logs` : 'Breakdown'}</span>
                                  <ExternalLink className="w-3 h-3 text-emerald-400" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Collapsible Transactions Drawer Trigger */}
            {loggedExpenses.length > 0 && (
              <div className="pt-1 flex items-center justify-between text-xs text-slate-400">
                <button
                  type="button"
                  onClick={() => setShowTransactionsDrawer(!showTransactionsDrawer)}
                  className="text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-semibold cursor-pointer"
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span>{showTransactionsDrawer ? 'Hide' : 'View'} all {loggedExpenses.length} transaction records</span>
                </button>
              </div>
            )}

            {/* Individual Transaction Ledger Drawer */}
            {showTransactionsDrawer && loggedExpenses.length > 0 && (
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-2 max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Transaction Audit Log ({selectedYear})
                </div>
                <div className="divide-y divide-slate-800/60">
                  {loggedExpenses.map((exp) => (
                    <div key={exp.expenseId} className="py-2 first:pt-0 flex items-center justify-between text-xs">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-white">${exp.amount.toFixed(2)}</span>
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[11px]">
                            {exp.categoryName}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center space-x-2">
                          <span>{exp.date}</span>
                          <span>•</span>
                          <span>{exp.enteredBy}</span>
                          {exp.notes && (
                            <>
                              <span>•</span>
                              <span className="text-amber-300 italic truncate max-w-[200px]">{exp.notes}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteLoggedExpense(exp.expenseId)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                        title="Delete this transaction"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active Year Data Entry Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Card 1: Macro Returns & Inflation */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              Realized Market Returns ({selectedYear})
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Realized Equities Return (S&P 500 / Total Stock)
              </label>
              <NumericInput
                allowDecimals={true}
                decimalPlaces={2}
                suffix="%"
                placeholder="e.g. 12.5"
                value={activeRecord.equityReturnRate !== null && activeRecord.equityReturnRate !== undefined ? Math.round(activeRecord.equityReturnRate * 10000) / 100 : null}
                onChange={(val) =>
                  handleFieldChange(
                    'equityReturnRate',
                    val === null ? null : val / 100
                  )
                }
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Realized Fixed Income Return (Bonds / Treasuries)
              </label>
              <NumericInput
                allowDecimals={true}
                decimalPlaces={2}
                suffix="%"
                placeholder="e.g. 4.0"
                value={activeRecord.fixedIncomeReturnRate !== null && activeRecord.fixedIncomeReturnRate !== undefined ? Math.round(activeRecord.fixedIncomeReturnRate * 10000) / 100 : null}
                onChange={(val) =>
                  handleFieldChange(
                    'fixedIncomeReturnRate',
                    val === null ? null : val / 100
                  )
                }
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Realized CPI Headline Inflation Rate
              </label>
              <NumericInput
                allowDecimals={true}
                decimalPlaces={2}
                suffix="%"
                placeholder="e.g. 2.8"
                value={activeRecord.cpiInflationRate !== null && activeRecord.cpiInflationRate !== undefined ? Math.round(activeRecord.cpiInflationRate * 10000) / 100 : null}
                onChange={(val) =>
                  handleFieldChange(
                    'cpiInflationRate',
                    val === null ? null : val / 100
                  )
                }
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Realized Healthcare Inflation Rate
              </label>
              <NumericInput
                allowDecimals={true}
                decimalPlaces={2}
                suffix="%"
                placeholder="e.g. 5.0"
                value={activeRecord.healthcareInflationRate !== null && activeRecord.healthcareInflationRate !== undefined ? Math.round(activeRecord.healthcareInflationRate * 10000) / 100 : null}
                onChange={(val) =>
                  handleFieldChange(
                    'healthcareInflationRate',
                    val === null ? null : val / 100
                  )
                }
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Card 2: Actual Living Expenses & Inflows */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-sky-400" />
              Actual Living Expenses ({selectedYear})
            </h3>
            <button
              onClick={() => setShowCategoryBreakdown(!showCategoryBreakdown)}
              className="text-xs text-sky-400 hover:text-sky-300 font-semibold flex items-center gap-1 cursor-pointer"
            >
              {showCategoryBreakdown ? 'Summary View' : 'Itemize Categories'}
              {showCategoryBreakdown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Living Expenses (Excluding Healthcare) ($)
              </label>
              <NumericInput
                prefix="$"
                placeholder={`Budgeted: ${formatCurrency(getPlannedRecurringBudgetForYear(selectedYear) * (activeLedgerRow?.cpiFactor || 1))}`}
                value={activeRecord.totalLivingExpenses}
                onChange={(val) => handleFieldChange('totalLivingExpenses', val)}
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-sky-500"
              />
            </div>

            {showCategoryBreakdown && (
              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Category Breakdown
                </span>
                {DEFAULT_EXPENSE_CATEGORIES.map((cat) => (
                  <div key={cat} className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">{cat}:</span>
                    <NumericInput
                      prefix="$"
                      placeholder="0"
                      value={activeRecord.categoryExpenses?.[cat]}
                      onChange={(val) => handleCategoryCostChange(cat, val ?? 0)}
                      className="w-28 h-7 bg-slate-900 border-slate-700 text-right text-white font-mono text-xs"
                    />
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Actual Healthcare OOP (Co-pays & Deductibles) ($)
              </label>
              <NumericInput
                prefix="$"
                placeholder={`Allowance Ceiling: ${formatCurrency(activeLedgerRow?.plannedHealthcareOOP ?? 0)}`}
                value={activeRecord.healthcareOOP}
                onChange={(val) => handleFieldChange('healthcareOOP', val)}
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-sky-500"
              />
              <p className="text-[11px] text-slate-500 mt-0.5">
                Maximum allowance ceiling is budgeted. Only actual spend reduces portfolio; unspent allowance remains invested.
              </p>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Pre-Medicare Healthcare Premiums ($)
              </label>
              <NumericInput
                prefix="$"
                placeholder="Optional override ($)"
                value={activeRecord.preMedicareHealthcareCost}
                onChange={(val) => handleFieldChange('preMedicareHealthcareCost', val)}
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-sky-500"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Medicare Base Premiums (Part B + Supp/D) ($)
              </label>
              <NumericInput
                prefix="$"
                placeholder="Optional override ($)"
                value={activeRecord.medicareBasePremiums}
                onChange={(val) => handleFieldChange('medicareBasePremiums', val)}
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-sky-500"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Medicare IRMAA Surcharges (Part B & D) ($)
              </label>
              <NumericInput
                prefix="$"
                placeholder={`Planned Surcharges: ${formatCurrency(activeLedgerRow?.combinedSurchargeAnnual ?? 0)}`}
                value={activeRecord.irmaaSurcharges}
                onChange={(val) => handleFieldChange('irmaaSurcharges', val)}
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-sky-500"
              />
              <p className="text-[11px] text-slate-500 mt-0.5">
                Optional override for realized IRMAA Part B & D surcharge premiums.
              </p>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Actual Charitable Giving & Tithe ($)
              </label>
              <NumericInput
                prefix="$"
                placeholder="Optional override ($)"
                value={activeRecord.charitableTithe}
                onChange={(val) => handleFieldChange('charitableTithe', val)}
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-sky-500"
              />
            </div>
          </div>
        </div>

        {/* Card 3: Actual Tax & Surcharges Overrides */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-purple-400" />
              Realized Taxes & Lookback MAGI
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Realized MAGI / AGI (Feeds 2-Yr Lookback)
              </label>
              <NumericInput
                prefix="$"
                placeholder={`Replayed: ${formatCurrency(activeLedgerRow?.magi)}`}
                value={activeRecord.magi}
                onChange={(val) => handleFieldChange('magi', val)}
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-purple-500"
              />
              <p className="text-[11px] text-slate-500 mt-0.5">
                Automatically determines Medicare IRMAA tiers for {selectedYear + 2}.
              </p>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Total Income Taxes Paid (Fed + State)
              </label>
              <NumericInput
                prefix="$"
                placeholder={`Replayed: ${formatCurrency(activeLedgerRow?.totalIncomeTax)}`}
                value={activeRecord.totalIncomeTax}
                onChange={(val) => handleFieldChange('totalIncomeTax', val)}
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-purple-500"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Earned Gross Salary - Primary ($)
              </label>
              <NumericInput
                prefix="$"
                placeholder="Active paycheck salary earned"
                value={activeRecord.earnedSalaryYou}
                onChange={(val) => handleFieldChange('earnedSalaryYou', val)}
                className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-purple-500"
              />
            </div>

            {!inputs.isSingleFiler && (
              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Earned Gross Salary - Spouse ($)
                </label>
                <NumericInput
                  prefix="$"
                  placeholder="Active paycheck salary earned"
                  value={activeRecord.earnedSalaryWife}
                  onChange={(val) => handleFieldChange('earnedSalaryWife', val)}
                  className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-purple-500"
                />
              </div>
            )}

            {onUpdatePriorTaxReturnMAGI && (
              <div className="pt-3 border-t border-slate-800 space-y-3">
                <span className="text-[11px] font-bold text-purple-400 uppercase tracking-wider block">
                  Prior Tax Return MAGI (2-Year IRMAA Lookback)
                </span>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">
                    2024 Form 1040 MAGI (Feeds 2026 IRMAA)
                  </label>
                  <NumericInput
                    prefix="$"
                    placeholder="Optional (Defaults to 2026 salary/yields)"
                    value={inputs.priorTaxReturnMAGI?.[2024]}
                    onChange={(val) =>
                      onUpdatePriorTaxReturnMAGI({
                        ...(inputs.priorTaxReturnMAGI || {}),
                        2024: val,
                      })
                    }
                    className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-purple-500 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">
                    2025 Form 1040 MAGI (Feeds 2027 IRMAA)
                  </label>
                  <NumericInput
                    prefix="$"
                    placeholder="Optional (Defaults to 2026 salary/yields)"
                    value={inputs.priorTaxReturnMAGI?.[2025]}
                    onChange={(val) =>
                      onUpdatePriorTaxReturnMAGI({
                        ...(inputs.priorTaxReturnMAGI || {}),
                        2025: val,
                      })
                    }
                    className="h-9 bg-slate-950 border-slate-700 text-white font-mono focus:border-purple-500 focus:ring-purple-500"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  IRS Form 1040 Line 11 + tax-exempt interest from prior returns. Used by Medicare to evaluate Part B & D surcharge tiers in simulation years 2026 and 2027. Updates simulation on blur.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Card 4: Year-End Portfolio Balance Reconciliation */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">
              Year-End Portfolio Balance Reconciliation ({selectedYear})
            </h3>
          </div>
          <button
            onClick={() => setShowReconciliation(!showReconciliation)}
            className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer flex items-center gap-1"
          >
            {showReconciliation ? 'Collapse' : 'Expand'}
            {showReconciliation ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {showReconciliation && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            {/* Primary Spouse Balances */}
            <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
              <span className="font-bold text-slate-200 block text-xs uppercase tracking-wider border-b border-slate-800 pb-2">
                Primary Accounts (Year-End)
              </span>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Pre-Tax (Traditional IRA)</label>
                  <NumericInput
                    prefix="$"
                    placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endYourPreTaxIRA)}`}
                    value={activeRecord.endYourPreTaxIRA}
                    onChange={(val) => handleFieldChange('endYourPreTaxIRA', val)}
                    className="h-8 bg-slate-900 border-slate-700 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Roth IRA</label>
                  <NumericInput
                    prefix="$"
                    placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endYourRothIRA)}`}
                    value={activeRecord.endYourRothIRA}
                    onChange={(val) => handleFieldChange('endYourRothIRA', val)}
                    className="h-8 bg-slate-900 border-slate-700 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Taxable Brokerage</label>
                  <NumericInput
                    prefix="$"
                    placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endYourTaxableBrokerage)}`}
                    value={activeRecord.endYourTaxableBrokerage}
                    onChange={(val) => handleFieldChange('endYourTaxableBrokerage', val)}
                    className="h-8 bg-slate-900 border-slate-700 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Taxable Cost Basis</label>
                  <NumericInput
                    prefix="$"
                    placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endYourTaxableBasis)}`}
                    value={activeRecord.endYourTaxableBasis}
                    onChange={(val) => handleFieldChange('endYourTaxableBasis', val)}
                    className="h-8 bg-slate-900 border-slate-700 text-white font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-slate-400 block mb-1">Cash Reserve Savings</label>
                  <NumericInput
                    prefix="$"
                    placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endYourCash)}`}
                    value={activeRecord.endYourCash}
                    onChange={(val) => handleFieldChange('endYourCash', val)}
                    className="h-8 bg-slate-900 border-slate-700 text-white font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Spouse Balances */}
            {!inputs.isSingleFiler && (
              <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <span className="font-bold text-slate-200 block text-xs uppercase tracking-wider border-b border-slate-800 pb-2">
                  Spouse Accounts (Year-End)
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 block mb-1">Pre-Tax (Traditional IRA)</label>
                    <NumericInput
                      prefix="$"
                      placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endWifePreTaxIRA)}`}
                      value={activeRecord.endWifePreTaxIRA}
                      onChange={(val) => handleFieldChange('endWifePreTaxIRA', val)}
                      className="h-8 bg-slate-900 border-slate-700 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Roth IRA</label>
                    <NumericInput
                      prefix="$"
                      placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endWifeRothIRA)}`}
                      value={activeRecord.endWifeRothIRA}
                      onChange={(val) => handleFieldChange('endWifeRothIRA', val)}
                      className="h-8 bg-slate-900 border-slate-700 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Taxable Brokerage</label>
                    <NumericInput
                      prefix="$"
                      placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endWifeTaxableBrokerage)}`}
                      value={activeRecord.endWifeTaxableBrokerage}
                      onChange={(val) => handleFieldChange('endWifeTaxableBrokerage', val)}
                      className="h-8 bg-slate-900 border-slate-700 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Taxable Cost Basis</label>
                    <NumericInput
                      prefix="$"
                      placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endWifeTaxableBasis)}`}
                      value={activeRecord.endWifeTaxableBasis}
                      onChange={(val) => handleFieldChange('endWifeTaxableBasis', val)}
                      className="h-8 bg-slate-900 border-slate-700 text-white font-mono"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-400 block mb-1">Cash Reserve Savings</label>
                    <NumericInput
                      prefix="$"
                      placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endWifeCash)}`}
                      value={activeRecord.endWifeCash}
                      onChange={(val) => handleFieldChange('endWifeCash', val)}
                      className="h-8 bg-slate-900 border-slate-700 text-white font-mono"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Model vs. Actual Variance Chart */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Model vs. Actual Spending & Guardrails Variance
          </h3>
        </div>
        <div className="h-64">
          <Chart
            type="line"
            data={varianceChartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: 'top' as const,
                  labels: { color: '#94a3b8', font: { size: 11 } },
                },
                tooltip: {
                  callbacks: {
                    label: (context) => {
                      return `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`;
                    },
                  },
                },
              },
              scales: {
                x: {
                  ticks: { color: '#94a3b8' },
                  grid: { color: 'rgba(51, 65, 85, 0.2)' },
                },
                y: {
                  ticks: {
                    color: '#94a3b8',
                    callback: (value) => formatCurrency(Number(value)),
                  },
                  grid: { color: 'rgba(51, 65, 85, 0.2)' },
                },
              },
            }}
          />
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {yearPendingDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Delete {yearPendingDelete} Actuals Record?</h3>
                <p className="text-xs text-slate-400">This action will remove recorded historical actuals for year {yearPendingDelete}.</p>
              </div>
            </div>

            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5 leading-relaxed">
              <p>• Year {yearPendingDelete} will revert to the standard simulation model projection.</p>
              <p>• Future years will re-simulate starting from the preceding reconciled balance.</p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setYearPendingDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const target = yearPendingDelete;
                  setYearPendingDelete(null);
                  confirmDeleteYear(target);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Line Item Breakdown Modal */}
      {selectedLineItemForBreakdown && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="p-2.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                  <Tag className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-white truncate">
                      {selectedLineItemForBreakdown.name}
                    </h2>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-semibold border border-slate-700">
                      {selectedLineItemForBreakdown.group}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                      Year {selectedYear}{selectedMonthFilter ? ` • Month ${selectedMonthFilter}` : ''}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Individual actual expenses logged for this line item. Edit or delete entries to correct mistakes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedLineItemForBreakdown(null);
                  setEditingExpenseId(null);
                }}
                className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors cursor-pointer shrink-0 ml-3"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Stats Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-950/60 border-b border-slate-800 text-xs">
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5">
                <span className="text-[10px] text-slate-400 block font-medium uppercase tracking-wider">Planned Budget</span>
                <span className="text-sm font-bold font-mono text-slate-200">
                  {formatCurrency(selectedLineItemForBreakdown.plannedAnnual)}
                </span>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5">
                <span className="text-[10px] text-slate-400 block font-medium uppercase tracking-wider">Actual Spend</span>
                <span className="text-sm font-bold font-mono text-emerald-400">
                  {formatCurrency(activeLineItemExpenses.reduce((sum, e) => sum + e.amount, 0))}
                </span>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5">
                <span className="text-[10px] text-slate-400 block font-medium uppercase tracking-wider">Transactions</span>
                <span className="text-sm font-bold font-mono text-white">
                  {activeLineItemExpenses.length} logged
                </span>
              </div>
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5">
                <span className="text-[10px] text-slate-400 block font-medium uppercase tracking-wider">Average / Log</span>
                <span className="text-sm font-bold font-mono text-slate-300">
                  {activeLineItemExpenses.length > 0
                    ? formatCurrency(activeLineItemExpenses.reduce((sum, e) => sum + e.amount, 0) / activeLineItemExpenses.length)
                    : '$0'}
                </span>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="p-3.5 bg-slate-900/80 border-b border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1">
                <div className="relative flex-1 max-w-sm flex items-center bg-slate-950 border border-slate-800 focus-within:border-emerald-500 rounded-xl px-2.5 py-1.5 transition-all">
                  <Search className="w-3.5 h-3.5 text-slate-500 mr-2 shrink-0" />
                  <input
                    type="text"
                    value={breakdownFilterText}
                    onChange={(e) => setBreakdownFilterText(e.target.value)}
                    placeholder="Filter by note, amount, date, purchaser..."
                    className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
                  />
                  {breakdownFilterText && (
                    <button
                      type="button"
                      onClick={() => setBreakdownFilterText('')}
                      className="p-0.5 text-slate-400 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {availableBreakdownPayers.length > 1 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 font-medium hidden md:inline">Purchaser:</span>
                    <select
                      value={breakdownPayerFilter}
                      onChange={(e) => setBreakdownPayerFilter(e.target.value)}
                      className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="ALL">All Payers</option>
                      {availableBreakdownPayers.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="text-[11px] text-slate-400 flex items-center gap-2 self-end sm:self-auto">
                <span>
                  Showing <strong className="text-white">{filteredAndSortedLineItemExpenses.length}</strong> of {activeLineItemExpenses.length}
                </span>
                {(breakdownFilterText || breakdownPayerFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setBreakdownFilterText('');
                      setBreakdownPayerFilter('ALL');
                    }}
                    className="text-emerald-400 hover:text-emerald-300 underline font-medium cursor-pointer"
                  >
                    Clear filter
                  </button>
                )}
              </div>
            </div>

            {/* Error Message banner if edit fails */}
            {expenseEditError && (
              <div className="mx-4 mt-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{expenseEditError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setExpenseEditError(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Scrollable Tabular Display */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-0">
              {activeLineItemExpenses.length === 0 ? (
                <div className="py-16 text-center space-y-2 px-4">
                  <Tag className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-sm font-semibold text-slate-300">
                    No actual expenses logged for {selectedLineItemForBreakdown.name} in {selectedYear}.
                  </p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    When purchases are logged in the Expenser app or via cloud sync with this category, they will appear here.
                  </p>
                </div>
              ) : filteredAndSortedLineItemExpenses.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  No logged expenses match &ldquo;{breakdownFilterText}&rdquo;.
                </div>
              ) : (
                <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase text-[10px] font-bold tracking-wider sticky top-0 z-10 backdrop-blur">
                    <tr>
                      <th
                        onClick={() => handleToggleSort('date')}
                        className="px-4 py-3 cursor-pointer hover:text-white transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Expense Date</span>
                          {breakdownSortField === 'date' ? (
                            breakdownSortDirection === 'asc' ? (
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
                        onClick={() => handleToggleSort('amount')}
                        className="px-4 py-3 text-right cursor-pointer hover:text-white transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <span>Amount</span>
                          {breakdownSortField === 'amount' ? (
                            breakdownSortDirection === 'asc' ? (
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
                        onClick={() => handleToggleSort('enteredBy')}
                        className="px-4 py-3 cursor-pointer hover:text-white transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Who Entered</span>
                          {breakdownSortField === 'enteredBy' ? (
                            breakdownSortDirection === 'asc' ? (
                              <ArrowUp className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <ArrowDown className="w-3 h-3 text-emerald-400" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-600" />
                          )}
                        </div>
                      </th>
                      <th className="px-4 py-3">Note / Memo</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-900/30">
                    {filteredAndSortedLineItemExpenses.map((exp) => {
                      const isEditing = editingExpenseId === exp.expenseId;

                      if (isEditing) {
                        return (
                          <tr key={exp.expenseId} className="bg-emerald-950/20 border-y border-emerald-500/30">
                            <td className="px-4 py-2.5">
                              <input
                                type="date"
                                value={editExpenseDate}
                                onChange={(e) => setEditExpenseDate(e.target.value)}
                                className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500 [color-scheme:dark]"
                                required
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="relative inline-flex items-center">
                                <span className="text-emerald-400 font-bold mr-1">$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  value={editExpenseAmount}
                                  onChange={(e) => setEditExpenseAmount(e.target.value)}
                                  className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono font-bold text-white text-right focus:outline-none focus:border-emerald-500"
                                  required
                                />
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <input
                                type="text"
                                value={editExpensePayer}
                                onChange={(e) => setEditExpensePayer(e.target.value)}
                                placeholder="Payer name"
                                className="w-28 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="px-4 py-2.5">
                              <input
                                type="text"
                                value={editExpenseNotes}
                                onChange={(e) => setEditExpenseNotes(e.target.value)}
                                placeholder="Add note / store..."
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  disabled={isSavingExpenseEdit}
                                  onClick={() => handleSaveExpenseEdit(exp.expenseId)}
                                  className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
                                  title="Save changes"
                                >
                                  {isSavingExpenseEdit ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Check className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingExpenseEdit}
                                  onClick={() => setEditingExpenseId(null)}
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs transition-colors cursor-pointer"
                                  title="Cancel edit"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={exp.expenseId} className="hover:bg-slate-800/40 transition-colors">
                          <td className="px-4 py-3 font-mono text-slate-200">
                            {exp.date}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400 text-sm">
                            {formatCurrency(exp.amount)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[11px] font-medium border border-slate-700/60">
                              {exp.enteredBy || 'Primary'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-300">
                            {exp.notes ? (
                              <span className="text-amber-200/90">{exp.notes}</span>
                            ) : (
                              <span className="text-slate-600 italic text-[11px]">No note</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleStartEditExpense(exp)}
                                className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors cursor-pointer"
                                title="Edit this transaction"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteLoggedExpense(exp.expenseId)}
                                className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                                title="Delete this transaction"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-950/70 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span className="hidden sm:inline">
                {storageSyncMessage}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedLineItemForBreakdown(null);
                  setEditingExpenseId(null);
                }}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-semibold transition-colors cursor-pointer ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Import / Backfill Expenses Modal */}
      {showImportModal && (
        <ImportExpensesModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          selectedYear={selectedYear}
          onImportComplete={async () => {
            await loadLoggedExpenses();
          }}
          onUpdateActualsLivingExpenses={handleUpdateActualsLivingExpenses}
        />
      )}
    </div>
  );
};
