import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { getStorageAdapter } from '../shared/storage';
import { ActualExpense } from '../shared/types/expenses';
import { AuthService } from '../shared/auth/AuthService';
import { RangeSlider } from './RangeSlider';
import { Chart } from 'react-chartjs-2';
import { Chart as ChartJS, registerables } from 'chart.js';

ChartJS.register(...registerables);

interface ActualsWorkspaceProps {
  ledger: SimulationResultRow[];
  inputs: AppStateInputs;
  onUpdateActuals: (actuals: Record<number, YearActualsRecord>) => void;
  onUpdateGuardrailSettings: (settings: GuardrailSettings) => void;
  onApplySpendingBonusToBudget?: (newBudget: number) => void;
  onNavigateToTab?: (tabIndex: number) => void;
}

export const ActualsWorkspace: React.FC<ActualsWorkspaceProps> = ({
  ledger,
  inputs,
  onUpdateActuals,
  onUpdateGuardrailSettings,
  onApplySpendingBonusToBudget,
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
  const [isLoadingExpenses, setIsLoadingExpenses] = useState<boolean>(false);
  const [selectedMonthFilter, setSelectedMonthFilter] = useState<number | null>(null);
  const [showExpenseTable, setShowExpenseTable] = useState<boolean>(true);
  const [showTransactionsDrawer, setShowTransactionsDrawer] = useState<boolean>(false);
  const [, setIsAuthenticated] = useState<boolean>(() => AuthService.isAuthenticated());

  const loadLoggedExpenses = useCallback(async () => {
    setIsLoadingExpenses(true);
    try {
      const adapter = getStorageAdapter();
      const exps = await adapter.getExpenses(selectedYear, selectedMonthFilter || undefined);
      setLoggedExpenses(exps);
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
    }

    // Also include any logged categories created on the fly not present in detailedExpenses
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
  }, [inputs.useDetailedExpenses, inputs.detailedExpenses, inputs.jurisdiction.currentState, inputs.jurisdiction.targetState, inputs.jurisdiction.relocationYear, selectedYear, selectedMonthFilter, actualsSummary]);

  // Sync actual logged expenses into activeRecord living expenses
  const handleSyncActualsToRecord = () => {
    const nextCategories: Record<string, number> = {};
    for (const [catName, amount] of Object.entries(actualsSummary.byCategory)) {
      const group = catName.includes(' - ') ? catName.split(' - ')[0].trim() : catName;
      nextCategories[group] = (nextCategories[group] || 0) + amount;
    }

    const updatedRecord = {
      ...activeRecord,
      totalLivingExpenses: Math.round(actualsSummary.totalSpend),
      categoryExpenses: nextCategories,
    };

    onUpdateActuals({
      ...actualTracking,
      [selectedYear]: updatedRecord,
    });
  };

  // Delete an individual logged expense transaction
  const handleDeleteLoggedExpense = async (id: string) => {
    if (window.confirm('Delete this expense transaction?')) {
      const adapter = getStorageAdapter();
      await adapter.deleteExpense(id);
      await loadLoggedExpenses();
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

  // Format currency helper
  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  };

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
      totalLivingExpenses: inputs.annualLivingExpenses,
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
    if (actualRows.length === 0) return ledger[0];
    return actualRows[actualRows.length - 1];
  }, [ledger]);

  // Baseline recurring budget before discretionary bonuses
  const baselineRecurringAnnual = useMemo(() => {
    if (inputs.useDetailedExpenses && inputs.detailedExpenses) {
      const norm = normalizeDetailedExpenses(inputs.detailedExpenses);
      const stateCosts = norm.costs[inputs.jurisdiction.currentState] || {};
      const freqs = norm.frequencies;
      const sum = norm.catalog.items
        .filter((i) => !i.isOneTime)
        .reduce((acc, item) => {
          const cost = stateCosts[item.id] ?? 0;
          const freq = freqs[item.id] ?? item.defaultFrequency ?? 12;
          return acc + cost * freq;
        }, 0);
      if (sum > 0) return sum;
    }
    return 100000;
  }, [inputs.useDetailedExpenses, inputs.detailedExpenses, inputs.jurisdiction.currentState]);

  // Guardrail metrics
  const guardrailUpperLimit = latestActualRow?.guardrailUpperLimit ?? ((inputs.annualLivingExpenses ?? 100000) * 1.15);
  const guardrailLowerLimit = latestActualRow?.guardrailLowerLimit ?? ((inputs.annualLivingExpenses ?? 100000) * 0.85);
  const currentSurplusGap = latestActualRow?.actualSurplusGap ?? 0;
  const permittedBonus = latestActualRow?.permittedSpendingBonus ?? 0;
  const plannedBudget = (inputs.annualLivingExpenses ?? 100000) * (latestActualRow?.cpiFactor ?? 1.0);
  const actualSpend = latestActualRow?.livingExpenses ?? plannedBudget;
  const spendingSavings = plannedBudget - actualSpend;
  const marketSurplusShare = currentSurplusGap - spendingSavings;

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
          data: rowsToChart.map((r) => (inputs.annualLivingExpenses ?? 100000) * r.cpiFactor),
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
  }, [ledger, inputs.annualLivingExpenses]);

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
                Permission to Spend Advisory ({latestActualRow ? latestActualRow.year : currentCalendarYear})
              </span>
              <span
                className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full border ${
                  currentSurplusGap >= 0
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                }`}
              >
                {currentSurplusGap >= 0 ? `+${formatCurrency(currentSurplusGap)} Net Surplus` : `${formatCurrency(currentSurplusGap)} Deficit`}
              </span>
            </div>
            <p className="text-sm font-bold text-slate-100 mt-1">
              {currentSurplusGap >= 0 ? (
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
                Live expense records synchronized from your companion Expenser PWA and household storage.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              onClick={() => loadLoggedExpenses()}
              disabled={isLoadingExpenses}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-all border border-slate-700/60 cursor-pointer"
              title="Refresh logged expenses"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingExpenses ? 'animate-spin text-emerald-400' : ''}`} />
            </button>

            <a
              href="/expenser"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
              title="Open mobile Expenser PWA in new tab"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Open Expenser</span>
              <ExternalLink className="w-3 h-3 text-emerald-400" />
            </a>

            <button
              onClick={() => setShowExpenseTable(!showExpenseTable)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-all flex items-center gap-1 cursor-pointer"
            >
              {showExpenseTable ? 'Collapse' : 'Expand'}
              {showExpenseTable ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
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
          {/* Total Logged Actual Spend */}
          <div className="bg-slate-950/60 border border-slate-800/90 rounded-xl p-3.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Total Logged Spend
            </span>
            <div className="text-xl font-extrabold text-white mt-1">
              {formatCurrency(actualsSummary.totalSpend)}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {actualsSummary.count} transaction{actualsSummary.count === 1 ? '' : 's'} recorded
            </p>
          </div>

          {/* Planned Budget */}
          <div className="bg-slate-950/60 border border-slate-800/90 rounded-xl p-3.5">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Planned Baseline Budget
            </span>
            <div className="text-xl font-extrabold text-slate-200 mt-1">
              {formatCurrency(selectedMonthFilter ? (baselineRecurringAnnual / 12) : baselineRecurringAnnual)}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {selectedMonthFilter ? '1 month allocation' : 'Annual budgeted recurring baseline'}
            </p>
          </div>

          {/* Net Variance */}
          {(() => {
            const plannedRef = selectedMonthFilter ? (baselineRecurringAnnual / 12) : baselineRecurringAnnual;
            const variance = plannedRef - actualsSummary.totalSpend;
            const isUnder = variance >= 0;
            const pct = plannedRef > 0 ? Math.abs((variance / plannedRef) * 100).toFixed(1) : '0';
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
                  {isUnder ? `+${formatCurrency(variance)}` : `-${formatCurrency(Math.abs(variance))}`}
                </div>
                <p className="text-[11px] opacity-80 mt-0.5">
                  {isUnder ? `${pct}% below planned spend` : `${pct}% above planned spend`}
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

        {/* Detailed Line Item Variance Table */}
        {showExpenseTable && (
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                    {comparisonItems.map((item) => {
                      const isOver = item.variance < 0;
                      const hasSpend = item.actualAnnual > 0;
                      return (
                        <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="px-3.5 py-2.5 font-medium text-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                            <div>
                              <div className="font-semibold text-slate-100">{item.name}</div>
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 12.5"
                  value={activeRecord.equityReturnRate !== null && activeRecord.equityReturnRate !== undefined ? Math.round(activeRecord.equityReturnRate * 10000) / 100 : ''}
                  onChange={(e) =>
                    handleFieldChange(
                      'equityReturnRate',
                      e.target.value === '' ? null : parseFloat(e.target.value) / 100
                    )
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 pr-8 text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
                <span className="absolute right-3 top-2 text-slate-400 font-mono font-bold">
                  %
                </span>
              </div>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Realized Fixed Income Return (Bonds / Treasuries)
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 4.0"
                  value={activeRecord.fixedIncomeReturnRate !== null && activeRecord.fixedIncomeReturnRate !== undefined ? Math.round(activeRecord.fixedIncomeReturnRate * 10000) / 100 : ''}
                  onChange={(e) =>
                    handleFieldChange(
                      'fixedIncomeReturnRate',
                      e.target.value === '' ? null : parseFloat(e.target.value) / 100
                    )
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 pr-8 text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
                <span className="absolute right-3 top-2 text-slate-400 font-mono font-bold">
                  %
                </span>
              </div>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Realized CPI Headline Inflation Rate
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 2.8"
                  value={activeRecord.cpiInflationRate !== null && activeRecord.cpiInflationRate !== undefined ? Math.round(activeRecord.cpiInflationRate * 10000) / 100 : ''}
                  onChange={(e) =>
                    handleFieldChange(
                      'cpiInflationRate',
                      e.target.value === '' ? null : parseFloat(e.target.value) / 100
                    )
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 pr-8 text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
                <span className="absolute right-3 top-2 text-slate-400 font-mono font-bold">
                  %
                </span>
              </div>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Realized Healthcare Inflation Rate
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 5.0"
                  value={activeRecord.healthcareInflationRate !== null && activeRecord.healthcareInflationRate !== undefined ? Math.round(activeRecord.healthcareInflationRate * 10000) / 100 : ''}
                  onChange={(e) =>
                    handleFieldChange(
                      'healthcareInflationRate',
                      e.target.value === '' ? null : parseFloat(e.target.value) / 100
                    )
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 pr-8 text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
                <span className="absolute right-3 top-2 text-slate-400 font-mono font-bold">
                  %
                </span>
              </div>
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
                Total Annual Living Expenses
              </label>
              <input
                type="number"
                step="100"
                placeholder={`Budgeted: ${formatCurrency((inputs.annualLivingExpenses ?? 100000) * (activeLedgerRow?.cpiFactor || 1))}`}
                value={activeRecord.totalLivingExpenses !== null && activeRecord.totalLivingExpenses !== undefined ? activeRecord.totalLivingExpenses : ''}
                onChange={(e) =>
                  handleFieldChange(
                    'totalLivingExpenses',
                    e.target.value === '' ? null : parseFloat(e.target.value)
                  )
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:border-sky-500 focus:outline-none"
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
                    <input
                      type="number"
                      placeholder="$0"
                      value={activeRecord.categoryExpenses?.[cat] || ''}
                      onChange={(e) =>
                        handleCategoryCostChange(cat, e.target.value === '' ? 0 : parseFloat(e.target.value))
                      }
                      className="w-28 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-right text-white font-mono text-xs"
                    />
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Pre-Medicare Healthcare Costs (Annual)
              </label>
              <input
                type="number"
                placeholder="Optional override ($)"
                value={activeRecord.preMedicareHealthcareCost !== null && activeRecord.preMedicareHealthcareCost !== undefined ? activeRecord.preMedicareHealthcareCost : ''}
                onChange={(e) =>
                  handleFieldChange(
                    'preMedicareHealthcareCost',
                    e.target.value === '' ? null : parseFloat(e.target.value)
                  )
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Medicare Base Premiums (Annual)
              </label>
              <input
                type="number"
                placeholder="Optional override ($)"
                value={activeRecord.medicareBasePremiums !== null && activeRecord.medicareBasePremiums !== undefined ? activeRecord.medicareBasePremiums : ''}
                onChange={(e) =>
                  handleFieldChange(
                    'medicareBasePremiums',
                    e.target.value === '' ? null : parseFloat(e.target.value)
                  )
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Actual Charitable Giving & Tithe ($)
              </label>
              <input
                type="number"
                placeholder="Optional override ($)"
                value={activeRecord.charitableTithe !== null && activeRecord.charitableTithe !== undefined ? activeRecord.charitableTithe : ''}
                onChange={(e) =>
                  handleFieldChange(
                    'charitableTithe',
                    e.target.value === '' ? null : parseFloat(e.target.value)
                  )
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:border-sky-500 focus:outline-none"
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
              <input
                type="number"
                placeholder={`Replayed: ${formatCurrency(activeLedgerRow?.magi)}`}
                value={activeRecord.magi !== null && activeRecord.magi !== undefined ? activeRecord.magi : ''}
                onChange={(e) =>
                  handleFieldChange('magi', e.target.value === '' ? null : parseFloat(e.target.value))
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:border-purple-500 focus:outline-none"
              />
              <p className="text-[11px] text-slate-500 mt-0.5">
                Automatically determines Medicare IRMAA tiers for {selectedYear + 2}.
              </p>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Total Income Taxes Paid (Fed + State)
              </label>
              <input
                type="number"
                placeholder={`Replayed: ${formatCurrency(activeLedgerRow?.totalIncomeTax)}`}
                value={activeRecord.totalIncomeTax !== null && activeRecord.totalIncomeTax !== undefined ? activeRecord.totalIncomeTax : ''}
                onChange={(e) =>
                  handleFieldChange(
                    'totalIncomeTax',
                    e.target.value === '' ? null : parseFloat(e.target.value)
                  )
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:border-purple-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Earned Gross Salary - Primary ($)
              </label>
              <input
                type="number"
                placeholder="Active paycheck salary earned"
                value={activeRecord.earnedSalaryYou !== null && activeRecord.earnedSalaryYou !== undefined ? activeRecord.earnedSalaryYou : ''}
                onChange={(e) =>
                  handleFieldChange(
                    'earnedSalaryYou',
                    e.target.value === '' ? null : parseFloat(e.target.value)
                  )
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:border-purple-500 focus:outline-none"
              />
            </div>

            {!inputs.isSingleFiler && (
              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Earned Gross Salary - Spouse ($)
                </label>
                <input
                  type="number"
                  placeholder="Active paycheck salary earned"
                  value={activeRecord.earnedSalaryWife !== null && activeRecord.earnedSalaryWife !== undefined ? activeRecord.earnedSalaryWife : ''}
                  onChange={(e) =>
                    handleFieldChange(
                      'earnedSalaryWife',
                      e.target.value === '' ? null : parseFloat(e.target.value)
                    )
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:border-purple-500 focus:outline-none"
                />
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
                  <input
                    type="number"
                    placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endYourPreTaxIRA)}`}
                    value={activeRecord.endYourPreTaxIRA !== null && activeRecord.endYourPreTaxIRA !== undefined ? activeRecord.endYourPreTaxIRA : ''}
                    onChange={(e) =>
                      handleFieldChange(
                        'endYourPreTaxIRA',
                        e.target.value === '' ? null : parseFloat(e.target.value)
                      )
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Roth IRA</label>
                  <input
                    type="number"
                    placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endYourRothIRA)}`}
                    value={activeRecord.endYourRothIRA !== null && activeRecord.endYourRothIRA !== undefined ? activeRecord.endYourRothIRA : ''}
                    onChange={(e) =>
                      handleFieldChange(
                        'endYourRothIRA',
                        e.target.value === '' ? null : parseFloat(e.target.value)
                      )
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Taxable Brokerage</label>
                  <input
                    type="number"
                    placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endYourTaxableBrokerage)}`}
                    value={activeRecord.endYourTaxableBrokerage !== null && activeRecord.endYourTaxableBrokerage !== undefined ? activeRecord.endYourTaxableBrokerage : ''}
                    onChange={(e) =>
                      handleFieldChange(
                        'endYourTaxableBrokerage',
                        e.target.value === '' ? null : parseFloat(e.target.value)
                      )
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Taxable Cost Basis</label>
                  <input
                    type="number"
                    placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endYourTaxableBasis)}`}
                    value={activeRecord.endYourTaxableBasis !== null && activeRecord.endYourTaxableBasis !== undefined ? activeRecord.endYourTaxableBasis : ''}
                    onChange={(e) =>
                      handleFieldChange(
                        'endYourTaxableBasis',
                        e.target.value === '' ? null : parseFloat(e.target.value)
                      )
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-slate-400 block mb-1">Cash Reserve Savings</label>
                  <input
                    type="number"
                    placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endYourCash)}`}
                    value={activeRecord.endYourCash !== null && activeRecord.endYourCash !== undefined ? activeRecord.endYourCash : ''}
                    onChange={(e) =>
                      handleFieldChange(
                        'endYourCash',
                        e.target.value === '' ? null : parseFloat(e.target.value)
                      )
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
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
                    <input
                      type="number"
                      placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endWifePreTaxIRA)}`}
                      value={activeRecord.endWifePreTaxIRA !== null && activeRecord.endWifePreTaxIRA !== undefined ? activeRecord.endWifePreTaxIRA : ''}
                      onChange={(e) =>
                        handleFieldChange(
                          'endWifePreTaxIRA',
                          e.target.value === '' ? null : parseFloat(e.target.value)
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Roth IRA</label>
                    <input
                      type="number"
                      placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endWifeRothIRA)}`}
                      value={activeRecord.endWifeRothIRA !== null && activeRecord.endWifeRothIRA !== undefined ? activeRecord.endWifeRothIRA : ''}
                      onChange={(e) =>
                        handleFieldChange(
                          'endWifeRothIRA',
                          e.target.value === '' ? null : parseFloat(e.target.value)
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Taxable Brokerage</label>
                    <input
                      type="number"
                      placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endWifeTaxableBrokerage)}`}
                      value={activeRecord.endWifeTaxableBrokerage !== null && activeRecord.endWifeTaxableBrokerage !== undefined ? activeRecord.endWifeTaxableBrokerage : ''}
                      onChange={(e) =>
                        handleFieldChange(
                          'endWifeTaxableBrokerage',
                          e.target.value === '' ? null : parseFloat(e.target.value)
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Taxable Cost Basis</label>
                    <input
                      type="number"
                      placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endWifeTaxableBasis)}`}
                      value={activeRecord.endWifeTaxableBasis !== null && activeRecord.endWifeTaxableBasis !== undefined ? activeRecord.endWifeTaxableBasis : ''}
                      onChange={(e) =>
                        handleFieldChange(
                          'endWifeTaxableBasis',
                          e.target.value === '' ? null : parseFloat(e.target.value)
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-slate-400 block mb-1">Cash Reserve Savings</label>
                    <input
                      type="number"
                      placeholder={`Calc: ${formatCurrency(activeLedgerRow?.endWifeCash)}`}
                      value={activeRecord.endWifeCash !== null && activeRecord.endWifeCash !== undefined ? activeRecord.endWifeCash : ''}
                      onChange={(e) =>
                        handleFieldChange(
                          'endWifeCash',
                          e.target.value === '' ? null : parseFloat(e.target.value)
                        )
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-mono"
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
    </div>
  );
};
