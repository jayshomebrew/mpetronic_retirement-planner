import React, { useState, useMemo } from 'react';
import { AppStateInputs, SavedPlan, SimulationResultRow, LockedReturnSequence, getSimulationStartYear } from '../types';
import { runRetirementSimulation } from '../engine/simulationEngine';
import { 
  Plus, 
  Trash2, 
  Play, 
  Check, 
  AlertCircle, 
  TrendingUp, 
  TrendingDown, 
  Sparkles, 
  ArrowRightLeft, 
  Info,
  X,
  Shield,
  DollarSign,
  FileText,
  MapPin,
  Calendar,
  Zap,
  Download,
  Upload
} from 'lucide-react';

interface PlanComparisonWorkspaceProps {
  inputs: AppStateInputs;
  onLoadPlan: (inputs: AppStateInputs) => void;
  savedPlans: SavedPlan[];
  onSavePlans: (plans: SavedPlan[] | ((prev: SavedPlan[]) => SavedPlan[])) => void;
  simulateSurvivor: boolean;
  useTodayDollars: boolean;
  selectedPlanAId: string;
  setSelectedPlanAId: (id: string) => void;
  selectedPlanBId: string;
  setSelectedPlanBId: (id: string) => void;
  ledger?: SimulationResultRow[];
  activeSequence?: LockedReturnSequence | null;
  globalScenario?: 'flat' | 'p10' | 'p50' | 'p90';
}

export const PlanComparisonWorkspace: React.FC<PlanComparisonWorkspaceProps> = ({
  inputs,
  onLoadPlan,
  savedPlans,
  onSavePlans,
  simulateSurvivor,
  useTodayDollars,
  selectedPlanAId,
  setSelectedPlanAId,
  selectedPlanBId,
  setSelectedPlanBId,
  ledger,
  activeSequence,
  globalScenario,
}) => {
  const [newPlanName, setNewPlanName] = useState('');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [inspectingPlan, setInspectingPlan] = useState<SavedPlan | null>(null);
  const simStartYear = getSimulationStartYear(inputs);

  // Derive the global plan ending year and ending age from the active overview analysis ledger or inputs
  const { globalEndingYear, endingAge, totalPlanYears } = useMemo(() => {
    if (ledger && ledger.length > 0) {
      const finalRow = ledger[ledger.length - 1];
      const endYr = finalRow.year;
      const endAge = finalRow.yourAge;
      return {
        globalEndingYear: endYr,
        endingAge: endAge,
        totalPlanYears: endYr - simStartYear + 1,
      };
    }

    // Fallback if ledger is not provided
    const yourBirthYear = inputs.you.birthDate ? parseInt(inputs.you.birthDate.split('-')[0], 10) : 1960;
    const wifeBirthYear = inputs.wife.birthDate ? parseInt(inputs.wife.birthDate.split('-')[0], 10) : 1964;
    const deathYear = yourBirthYear + (inputs.you.longevityAge ?? 85);
    const wifeDeathYear = inputs.isSingleFiler ? 0 : (wifeBirthYear + (inputs.wife.longevityAge ?? 95));
    const endYr = Math.max(simStartYear, inputs.isSingleFiler ? deathYear : Math.max(deathYear, wifeDeathYear));
    const endAge = endYr - yourBirthYear;
    return {
      globalEndingYear: endYr,
      endingAge: endAge,
      totalPlanYears: endYr - simStartYear + 1,
    };
  }, [ledger, inputs, simStartYear]);

  // Trigger alert messages that auto-dismiss
  const triggerNotification = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatPercentage = (val: number) => {
    if (isNaN(val) || !isFinite(val)) return '0.0%';
    const sign = val > 0 ? '+' : '';
    return `${sign}${(val * 100).toFixed(1)}%`;
  };

  const renderInspectModal = () => {
    if (!inspectingPlan) return null;
    const pInputs = inspectingPlan.inputs;
    const pYou = pInputs.you;
    const pWife = pInputs.wife;
    const pPort = pInputs.portfolio;
    const pGrowth = pInputs.growthAssumptions;
    const pJuris = pInputs.jurisdiction;

    const totalStartingPortfolio = 
      (pPort.yourPreTaxIRA || 0) +
      (pPort.yourRothIRA || 0) +
      (pPort.yourTaxableBrokerage || 0) +
      (pPort.yourCash || 0) +
      (pInputs.isSingleFiler ? 0 : (
        (pPort.wifePreTaxIRA || 0) +
        (pPort.wifeRothIRA || 0) +
        (pPort.wifeTaxableBrokerage || 0) +
        (pPort.wifeCash || 0)
      ));

    const rothStrategyText = pInputs.rothConversionStrategy === 'fill-to-target'
      ? `Fill-to-Target Bracket (${formatCurrency(pInputs.rothConversionTargetValue ?? 0)})`
      : pInputs.annualRothConversion > 0
        ? `Flat Annual Conversion (${formatCurrency(pInputs.annualRothConversion)}/yr)`
        : `No Conversion ($0/yr)`;

    const relocationText = pJuris.relocationYear
      ? `Relocating from ${pJuris.currentState} to ${pJuris.targetState} in ${pJuris.relocationYear}`
      : `Staying in ${pJuris.currentState} (No Relocation)`;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md transition-all">
        <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden glass-panel flex flex-col max-h-[90vh]">
          {/* Modal Header */}
          <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-900/80">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-slate-100">{inspectingPlan.name}</h3>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase">
                  Scenario Details
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Saved on {inspectingPlan.createdAt}
              </p>
            </div>
            <button
              onClick={() => setInspectingPlan(null)}
              className="p-1.5 rounded-lg bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Modal Body - Scrollable content */}
          <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar text-xs">
            {/* Section 1: Demographics & Retirement Timelines */}
            <div className="space-y-2">
              <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-blue-400" /> Demographics & Timelines
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/50 border border-slate-800/60 p-3.5 rounded-xl">
                <div>
                  <span className="font-bold text-slate-200 block">{pYou.name || 'Primary Filer'}</span>
                  <span className="text-slate-400 block mt-0.5">
                    Birth: <strong className="text-slate-300">{pYou.birthDate || 'N/A'}</strong> | Retire: <strong className="text-emerald-400">Age {pYou.plannedRetirementAge ?? 67}</strong>
                  </span>
                  <span className="text-slate-400 block mt-0.5">
                    SS Claiming: <strong className="text-slate-300">Age {pYou.targetSSClaimingAge ?? 67}</strong> (${formatCurrency(pYou.estimatedPIA ?? 0)}/mo PIA)
                  </span>
                  <span className="text-slate-400 block mt-0.5">
                    Active Salary: <strong className="text-slate-300">{formatCurrency(pYou.activeSalary ?? 0)}/yr</strong>
                  </span>
                </div>
                {!pInputs.isSingleFiler ? (
                  <div>
                    <span className="font-bold text-slate-200 block">{pWife.name || 'Spouse'}</span>
                    <span className="text-slate-400 block mt-0.5">
                      Birth: <strong className="text-slate-300">{pWife.birthDate || 'N/A'}</strong> | Retire: <strong className="text-emerald-400">Age {pWife.plannedRetirementAge ?? 67}</strong>
                    </span>
                    <span className="text-slate-400 block mt-0.5">
                      SS Claiming: <strong className="text-slate-300">Age {pWife.targetSSClaimingAge ?? 67}</strong> (${formatCurrency(pWife.estimatedPIA ?? 0)}/mo PIA)
                    </span>
                    <span className="text-slate-400 block mt-0.5">
                      Active Salary: <strong className="text-slate-300">{formatCurrency(pWife.activeSalary ?? 0)}/yr</strong>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center text-slate-500 italic">
                    Single Filing Status
                  </div>
                )}
              </div>
            </div>

            {/* Section 2: Portfolio Assets */}
            <div className="space-y-2">
              <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Starting Portfolio Balances ({formatCurrency(totalStartingPortfolio)})
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-slate-950/50 border border-slate-800/60 p-2.5 rounded-xl space-y-1">
                  <span className="text-[10px] text-slate-400 font-semibold block">Pre-Tax IRA/401(k)</span>
                  <span className="font-mono font-bold text-amber-400 block">{formatCurrency((pPort.yourPreTaxIRA || 0) + (pInputs.isSingleFiler ? 0 : (pPort.wifePreTaxIRA || 0)))}</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-800/60 p-2.5 rounded-xl space-y-1">
                  <span className="text-[10px] text-slate-400 font-semibold block">Roth IRA</span>
                  <span className="font-mono font-bold text-emerald-400 block">{formatCurrency((pPort.yourRothIRA || 0) + (pInputs.isSingleFiler ? 0 : (pPort.wifeRothIRA || 0)))}</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-800/60 p-2.5 rounded-xl space-y-1">
                  <span className="text-[10px] text-slate-400 font-semibold block">Taxable Brokerage</span>
                  <span className="font-mono font-bold text-sky-400 block">{formatCurrency((pPort.yourTaxableBrokerage || 0) + (pInputs.isSingleFiler ? 0 : (pPort.wifeTaxableBrokerage || 0)))}</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-800/60 p-2.5 rounded-xl space-y-1">
                  <span className="text-[10px] text-slate-400 font-semibold block">Cash Reserves</span>
                  <span className="font-mono font-bold text-violet-400 block">{formatCurrency((pPort.yourCash || 0) + (pInputs.isSingleFiler ? 0 : (pPort.wifeCash || 0)))}</span>
                </div>
              </div>
            </div>

            {/* Section 3: Roth Conversion Strategy & Jurisdiction */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Roth Conversion Strategy
                </h4>
                <div className="bg-slate-950/50 border border-slate-800/60 p-3 rounded-xl space-y-1">
                  <span className="font-bold text-slate-200 block">{rothStrategyText}</span>
                  <span className="text-slate-400 block text-[11px]">
                    Conversion Window: <strong className="text-slate-300">{pInputs.rothConversionStartYear} – {pInputs.rothConversionEndYear}</strong>
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-rose-400" /> Living Expenses & State
                </h4>
                <div className="bg-slate-950/50 border border-slate-800/60 p-3 rounded-xl space-y-1">
                  <span className="font-bold text-slate-200 block">
                    Budget: {formatCurrency(pInputs.annualLivingExpenses ?? 100000)}/yr {pInputs.useDetailedExpenses ? '(Detailed Catalog Active)' : '(Flat Budget)'}
                  </span>
                  <span className="text-slate-400 block text-[11px]">{relocationText}</span>
                </div>
              </div>
            </div>

            {/* Section 4: Economic Assumptions */}
            <div className="space-y-2">
              <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-sky-400" /> Economic & Investment Assumptions
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-slate-950/50 border border-slate-800/60 p-3 rounded-xl text-[11px]">
                <div>
                  <span className="text-slate-400 block">Equity Return:</span>
                  <strong className="text-emerald-400 font-mono">{(Math.round((pGrowth.equityReturnRate * 100 + Number.EPSILON) * 100) / 100)}%</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Fixed Income:</span>
                  <strong className="text-sky-400 font-mono">{(Math.round((pGrowth.fixedIncomeReturnRate * 100 + Number.EPSILON) * 100) / 100)}%</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">CPI Inflation:</span>
                  <strong className="text-amber-400 font-mono">{(Math.round((pGrowth.cpiInflationRate * 100 + Number.EPSILON) * 100) / 100)}%</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Healthcare Infl:</span>
                  <strong className="text-rose-400 font-mono">{(Math.round((pGrowth.healthcareInflationRate * 100 + Number.EPSILON) * 100) / 100)}%</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Min Cash Reserve:</span>
                  <strong className="text-emerald-400 font-mono">{formatCurrency(pGrowth.minCashReserveDollars ?? 100000)}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="p-4 border-t border-slate-800 flex justify-between items-center bg-slate-900/80">
            <button
              onClick={() => setInspectingPlan(null)}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
            >
              Close
            </button>

            <button
              onClick={() => {
                handleLoadPlan(inspectingPlan);
                setInspectingPlan(null);
              }}
              className="px-5 py-2 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-all shadow cursor-pointer flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Load Scenario Into Workspace
            </button>
          </div>
        </div>
      </div>
    );
  };

  // 1. Plan Saving Action
  const handleSaveCurrentScenario = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newPlanName.trim();
    if (!name) {
      triggerNotification('Please provide a valid name for your plan.', 'error');
      return;
    }

    if (savedPlans.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      triggerNotification('A plan with this name already exists. Please choose a unique name.', 'error');
      return;
    }

    const newPlan: SavedPlan = {
      id: Date.now().toString(),
      name,
      inputs: {
        ...JSON.parse(JSON.stringify(inputs)),
        simulateSurvivor,
      },
      createdAt: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    onSavePlans((prev) => [...prev, newPlan]);
    setNewPlanName('');
    triggerNotification(`Scenario "${name}" successfully saved!`, 'success');

    // Auto-select as Plan B if empty (Plan A defaults to current active plan)
    if (!selectedPlanBId) {
      setSelectedPlanBId(newPlan.id);
    }
  };

  // 2. Load Scenario
  const handleLoadPlan = (plan: SavedPlan) => {
    onLoadPlan(plan.inputs);
    triggerNotification(`Plan "${plan.name}" loaded into active workspace!`, 'success');
  };

  // 3. Delete Plan
  const handleDeletePlan = (id: string, name: string) => {
    onSavePlans((prev) => prev.filter((p) => p.id !== id));
    if (selectedPlanAId === id) setSelectedPlanAId('current');
    if (selectedPlanBId === id) setSelectedPlanBId('');
    triggerNotification(`Plan "${name}" deleted.`, 'info');
  };

  // 4. Export Saved Scenarios to JSON
  const handleExportScenariosJSON = () => {
    if (savedPlans.length === 0) {
      triggerNotification('No saved scenarios to export.', 'info');
      return;
    }
    const dataStr = JSON.stringify(savedPlans, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Retirement_Scenarios_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    triggerNotification(`Exported ${savedPlans.length} scenario(s) to JSON.`, 'success');
  };

  // 5. Import Scenarios from JSON
  const handleImportScenariosJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) return;
        const parsed = JSON.parse(text);

        let scenariosToImport: SavedPlan[] = [];
        if (Array.isArray(parsed)) {
          scenariosToImport = parsed;
        } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.savedPlans)) {
          scenariosToImport = parsed.savedPlans;
        }

        if (scenariosToImport.length === 0) {
          triggerNotification('No valid scenarios found in this JSON file.', 'error');
          return;
        }

        onSavePlans((prev) => {
          const existingNames = new Set(prev.map((p) => p.name.toLowerCase()));
          const existingIds = new Set(prev.map((p) => p.id));
          const validNew = scenariosToImport.filter((p) => p && p.name && p.inputs);
          const merged = [...prev];
          let addedCount = 0;

          for (const plan of validNew) {
            let uniqueId = plan.id || Date.now().toString();
            if (existingIds.has(uniqueId)) {
              uniqueId = `${uniqueId}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
            }
            let uniqueName = plan.name;
            if (existingNames.has(uniqueName.toLowerCase())) {
              uniqueName = `${plan.name} (Imported)`;
            }
            existingIds.add(uniqueId);
            existingNames.add(uniqueName.toLowerCase());
            merged.push({
              ...plan,
              id: uniqueId,
              name: uniqueName,
            });
            addedCount++;
          }
          triggerNotification(`Successfully imported ${addedCount} scenario(s)!`, 'success');
          return merged;
        });
      } catch (err) {
        console.error('Import scenarios failed:', err);
        triggerNotification('Failed to parse scenarios file. Please ensure it is a valid JSON file.', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Helpers to calculate lifetime statistics
  const calculateLifetimeMetrics = (ledger: SimulationResultRow[]) => {
    const lastRow = ledger[ledger.length - 1];
    const endingEstate = lastRow ? lastRow.totalPortfolioValue : 0;
    const endingRoth = lastRow ? (lastRow.endYourRothIRA || 0) + (lastRow.endWifeRothIRA || 0) : 0;
    
    const federalTaxExcludingNiit = ledger.reduce((sum, r) => sum + Math.max(0, r.fedIncomeTax - r.niitTax), 0);
    const stateTax = ledger.reduce((sum, r) => sum + r.stateIncomeTax, 0);
    const irmaa = ledger.reduce((sum, r) => sum + r.combinedSurchargeAnnual, 0);
    const medicareBase = ledger.reduce((sum, r) => sum + r.medicareBasePremiums, 0);
    const niit = ledger.reduce((sum, r) => sum + r.niitTax, 0);
    const totalTax = ledger.reduce((sum, r) => sum + r.totalIncomeTax, 0);
    const totalExpenses = ledger.reduce((sum, r) => sum + r.totalExpenses, 0);

    return {
      federalTaxExcludingNiit,
      stateTax,
      irmaa,
      medicareBase,
      endingEstate,
      endingRoth,
      niit,
      totalTax,
      totalExpenses
    };
  };

  // Dynamic representation of the Current Active Plan
  const currentPlan: SavedPlan = useMemo(() => ({
    id: 'current',
    name: 'Current Active Plan',
    inputs: {
      ...inputs,
      simulateSurvivor,
    },
    createdAt: 'Active Workspace',
  }), [inputs, simulateSurvivor]);

  // Resolve Plan A and Plan B (defaulting Plan A to current active plan if unset)
  const effectivePlanAId = selectedPlanAId || 'current';
  const planA = useMemo(() => {
    if (effectivePlanAId === 'current') return currentPlan;
    return savedPlans.find((p) => p.id === effectivePlanAId);
  }, [savedPlans, effectivePlanAId, currentPlan]);

  const planB = useMemo(() => {
    if (selectedPlanBId === 'current') return currentPlan;
    return savedPlans.find((p) => p.id === selectedPlanBId);
  }, [savedPlans, selectedPlanBId, currentPlan]);

  // Helper to discount a row's nominal values back to today's purchasing power (real value)
  const discountRow = (row: SimulationResultRow): SimulationResultRow => {
    const factor = row.cpiFactor;
    if (factor <= 1) return row;

    const discounted = { ...row };
    const nonCurrencyKeys = new Set(['year', 'yourAge', 'wifeAge', 'surchargeTier', 'cpiFactor']);
    
    for (const key of Object.keys(discounted) as Array<keyof SimulationResultRow>) {
      const val = discounted[key];
      if (!nonCurrencyKeys.has(key) && typeof val === 'number') {
        (discounted as Record<string, unknown>)[key] = val / factor;
      }
    }
    return discounted;
  };

  // Run dynamic simulations on active scenario returns ending on global plan ending year
  const simResultA = useMemo(() => {
    if (!planA) return null;
    if (planA.id === 'current' && ledger && ledger.length > 0) {
      return ledger;
    }
    const inputsA: AppStateInputs = {
      ...planA.inputs,
      you: { ...planA.inputs.you, birthDate: inputs.you.birthDate, longevityAge: inputs.you.longevityAge },
      wife: { ...planA.inputs.wife, birthDate: inputs.wife.birthDate, longevityAge: inputs.wife.longevityAge },
      isSingleFiler: inputs.isSingleFiler,
      simulationStartYear: inputs.simulationStartYear,
    };
    const simSurvivorA = (planA.inputs as { simulateSurvivor?: boolean })?.simulateSurvivor !== undefined 
      ? (planA.inputs as { simulateSurvivor?: boolean }).simulateSurvivor!
      : simulateSurvivor;
    const rawResult = runRetirementSimulation(inputsA, simSurvivorA, activeSequence).filter((r) => r.year <= globalEndingYear);
    if (!useTodayDollars) return rawResult;
    return rawResult.map((r) => discountRow(r));
  }, [planA, simulateSurvivor, useTodayDollars, inputs, globalEndingYear, activeSequence, ledger]);

  const simResultB = useMemo(() => {
    if (!planB) return null;
    if (planB.id === 'current' && ledger && ledger.length > 0) {
      return ledger;
    }
    const inputsB: AppStateInputs = {
      ...planB.inputs,
      you: { ...planB.inputs.you, birthDate: inputs.you.birthDate, longevityAge: inputs.you.longevityAge },
      wife: { ...planB.inputs.wife, birthDate: inputs.wife.birthDate, longevityAge: inputs.wife.longevityAge },
      isSingleFiler: inputs.isSingleFiler,
      simulationStartYear: inputs.simulationStartYear,
    };
    const simSurvivorB = (planB.inputs as { simulateSurvivor?: boolean })?.simulateSurvivor !== undefined 
      ? (planB.inputs as { simulateSurvivor?: boolean }).simulateSurvivor!
      : simulateSurvivor;
    const rawResult = runRetirementSimulation(inputsB, simSurvivorB, activeSequence).filter((r) => r.year <= globalEndingYear);
    if (!useTodayDollars) return rawResult;
    return rawResult.map((r) => discountRow(r));
  }, [planB, simulateSurvivor, useTodayDollars, inputs, globalEndingYear, activeSequence, ledger]);

  // Sum lifetime stats
  const statsA = useMemo(() => simResultA ? calculateLifetimeMetrics(simResultA) : null, [simResultA]);
  const statsB = useMemo(() => simResultB ? calculateLifetimeMetrics(simResultB) : null, [simResultB]);

  // Comparison Grid Data
  const comparisonRows = useMemo(() => {
    if (!statsA || !statsB) return [];

    return [
      {
        id: 'federal',
        name: 'Federal Income Taxes',
        desc: 'Regular federal income tax on ordinary and capital income, excluding NIIT.',
        valA: statsA.federalTaxExcludingNiit,
        valB: statsB.federalTaxExcludingNiit,
        lowerIsBetter: true,
      },
      {
        id: 'state',
        name: 'State Income Taxes',
        desc: `State taxes paid over ${totalPlanYears} years based on Maryland vs Florida rules.`,
        valA: statsA.stateTax,
        valB: statsB.stateTax,
        lowerIsBetter: true,
      },
      {
        id: 'niit',
        name: 'Net Investment Income Tax (NIIT)',
        desc: '3.8% tax on net investment income/capital gains above MFJ/Single thresholds.',
        valA: statsA.niit,
        valB: statsB.niit,
        lowerIsBetter: true,
      },
      {
        id: 'totalTax',
        name: 'Total Income Taxes',
        desc: 'Sum of Federal, State, and Net Investment Income Taxes.',
        valA: statsA.totalTax,
        valB: statsB.totalTax,
        lowerIsBetter: true,
      },
      {
        id: 'irmaa',
        name: 'Medicare IRMAA Surcharges',
        desc: 'Income-Related Monthly Adjustment Amount surcharges triggered by lookback MAGI.',
        valA: statsA.irmaa,
        valB: statsB.irmaa,
        lowerIsBetter: true,
      },
      {
        id: 'endingRoth',
        name: `Ending Roth IRA Balance (Age ${endingAge})`,
        desc: `Final terminal tax-free Roth IRA balance in year ${globalEndingYear} for legacy inheritance or late-life expenditures.`,
        valA: statsA.endingRoth,
        valB: statsB.endingRoth,
        lowerIsBetter: false,
      },
      {
        id: 'endingEstate',
        name: `Ending Net Estate (Age ${endingAge})`,
        desc: `Final terminal value of combined accounts in year ${globalEndingYear} after all years of growth, taxes, and drawdowns under ${globalScenario ? globalScenario.toUpperCase() : 'active'} return assumptions.`,
        valA: statsA.endingEstate,
        valB: statsB.endingEstate,
        lowerIsBetter: false,
      },
    ];
  }, [statsA, statsB, endingAge, globalEndingYear, totalPlanYears, globalScenario]);

  // Visual summary analysis
  const summaryInsight = useMemo(() => {
    if (!statsA || !statsB || !planA || !planB) return null;

    const taxSavings = statsA.totalTax - statsB.totalTax;
    const estateDelta = statsB.endingEstate - statsA.endingEstate;
    const surchargeSavings = statsA.irmaa - statsB.irmaa;

    const isIdentical = effectivePlanAId === selectedPlanBId || (Math.abs(taxSavings) < 0.1 && Math.abs(estateDelta) < 0.1);

    const isTaxFavorable = taxSavings > 0;
    const isEstateFavorable = estateDelta > 0;
    const isSurchargeFavorable = surchargeSavings > 0;

    let netTaxesDesc = '';
    if (Math.abs(taxSavings) < 100) {
      netTaxesDesc = 'approximately equal lifetime taxes';
    } else {
      netTaxesDesc = isTaxFavorable
        ? `${formatCurrency(taxSavings)} LESS in total taxes`
        : `${formatCurrency(Math.abs(taxSavings))} MORE in total taxes`;
    }

    let estateDesc = '';
    if (Math.abs(estateDelta) < 100) {
      estateDesc = 'equivalent net estate values';
    } else {
      estateDesc = isEstateFavorable
        ? `${formatCurrency(estateDelta)} HIGHER net ending estate`
        : `${formatCurrency(Math.abs(estateDelta))} LOWER net ending estate`;
    }

    // Determine the key takeaway theme
    let benefitSummary = '';
    let isPositiveOverall = false;

    if (isIdentical) {
      benefitSummary = `Plan A ("${planA.name}") and Plan B ("${planB.name}") are identical scenarios. The lifetime taxes, Medicare premiums, surcharges, and portfolio trajectories are mathematically equivalent. Use the dropdown selectors to load or compare different configurations.`;
      isPositiveOverall = true;
    } else if (isTaxFavorable && isEstateFavorable) {
      benefitSummary = `Plan B ("${planB.name}") is a highly superior scenario. It successfully optimizes your portfolio to save ${formatCurrency(taxSavings)} in lifetime taxes while generating a larger terminal estate (+${formatCurrency(estateDelta)}). This is a clear win-win outcome.`;
      isPositiveOverall = true;
    } else if (isTaxFavorable && !isEstateFavorable) {
      const netBenefit = taxSavings - Math.abs(estateDelta);
      if (netBenefit > 0) {
        benefitSummary = `Plan B reduces your tax burden significantly, saving ${formatCurrency(taxSavings)}. Although it ends with a lower nominal estate (-${formatCurrency(Math.abs(estateDelta))}), the total tax savings more than compensate for the estate difference, yielding a net positive spousal value of ${formatCurrency(netBenefit)}.`;
        isPositiveOverall = true;
      } else {
        benefitSummary = `Plan B saves ${formatCurrency(taxSavings)} in lifetime taxes. However, because of accelerated drawdowns or early conversions, it results in an estate reduction of -${formatCurrency(Math.abs(estateDelta))}. The nominal estate shrinkage exceeds your tax savings by ${formatCurrency(Math.abs(netBenefit))}, indicating a potential drag on long-term compound growth.`;
        isPositiveOverall = false;
      }
    } else if (!isTaxFavorable && isEstateFavorable) {
      const netBenefit = estateDelta - Math.abs(taxSavings);
      if (netBenefit > 0) {
        benefitSummary = `Plan B increases your lifetime taxes by ${formatCurrency(Math.abs(taxSavings))}, likely due to strategic Roth conversions that front-load your tax liability. However, this strategy pays off handsomely, resulting in a much larger ending portfolio estate (+${formatCurrency(estateDelta)}). The terminal gain outweighs the tax premium by ${formatCurrency(netBenefit)}.`;
        isPositiveOverall = true;
      } else {
        benefitSummary = `Plan B increases your ending estate by ${formatCurrency(estateDelta)}, but it cost you an additional ${formatCurrency(Math.abs(taxSavings))} in lifetime taxes to achieve this. From an efficiency standpoint, the incremental tax drag outweighs the estate improvement by ${formatCurrency(Math.abs(netBenefit))}.`;
        isPositiveOverall = false;
      }
    } else {
      benefitSummary = `Plan B ("${planB.name}") results in both higher lifetime taxes (+${formatCurrency(Math.abs(taxSavings))}) and a lower ending estate value (-${formatCurrency(Math.abs(estateDelta))}) compared to Plan A. From a financial optimization standpoint, Plan A is highly recommended over this scenario.`;
      isPositiveOverall = false;
    }

    return {
      taxSavings,
      estateDelta,
      surchargeSavings,
      isTaxFavorable,
      isEstateFavorable,
      isSurchargeFavorable,
      benefitSummary,
      isPositiveOverall,
      netTaxesDesc,
      estateDesc,
      isIdentical
    };
  }, [statsA, statsB, planA, planB, effectivePlanAId, selectedPlanBId]);

  return (
    <div className="space-y-3">
      {renderInspectModal()}
      {/* Notifications bar */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md transition-all duration-300 animate-slide-in ${
          notification.type === 'success'
            ? 'bg-emerald-950/90 text-emerald-200 border-emerald-500/50'
            : notification.type === 'error'
              ? 'bg-rose-950/90 text-rose-200 border-rose-500/50'
              : 'bg-slate-900/90 text-slate-200 border-slate-700/50'
        }`}>
          <Check className={`w-4 h-4 ${notification.type === 'success' ? 'text-emerald-400' : notification.type === 'error' ? 'text-rose-400' : 'text-slate-400'}`} />
          <span className="text-xs font-bold font-sans">{notification.message}</span>
        </div>
      )}

      {/* Main Workspace Header */}
      <div>
        <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-emerald-400" />
          Scenario Saved Plans & Lifetime Comparison
        </h3>
        <p className="text-xs text-slate-400">
          Save different conversion or state tax setups, load them on demand, and perform exhaustive side-by-side lifetime metrics analysis.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-start">
        {/* Left Side: Save & Plan Management Panel (Col span 4) */}
        <div className="xl:col-span-4 space-y-3">
          
          {/* Save Active Scenario Card */}
          <div className="glass-panel rounded-2xl p-3.5 border border-slate-800 space-y-2">
            <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />
              Save Active Workspace Scenario
            </h4>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Name and save the parameters currently set in the left sidebar as a comparison target (e.g. "FL Relocation, $0 Conversions").
            </p>
            <form onSubmit={handleSaveCurrentScenario} className="space-y-3">
              <input
                type="text"
                value={newPlanName}
                onChange={(e) => setNewPlanName(e.target.value)}
                placeholder="e.g. Baseline - No Conversions"
                maxLength={40}
                className="w-full bg-slate-950/60 border border-slate-800 focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/20 text-xs px-5 py-3 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none transition-colors"
              />
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-slate-100 text-xs font-bold py-2.5 rounded-xl shadow-lg shadow-emerald-950/50 hover:scale-[1.01] active:scale-[0.99] transition-all font-sans"
              >
                <Plus className="w-4 h-4" />
                Save Current Parameters
              </button>
            </form>
          </div>

          {/* Saved Plans List */}
          <div className="glass-panel rounded-2xl p-3.5 border border-slate-800 space-y-2">
            <div className="flex justify-between items-center">
              <h4 className="text-sm font-bold text-slate-200">
                Saved Scenarios ({savedPlans.length})
              </h4>
              <div className="flex items-center gap-1.5">
                <label
                  title="Import scenarios from JSON file"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-600 text-slate-300 hover:text-emerald-400 text-xs font-semibold transition-colors cursor-pointer shadow-sm"
                >
                  <Upload className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Import</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportScenariosJSON}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleExportScenariosJSON}
                  disabled={savedPlans.length === 0}
                  title={savedPlans.length === 0 ? "No saved scenarios to export" : "Export scenarios to JSON file"}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold transition-colors shadow-sm ${
                    savedPlans.length === 0
                      ? 'bg-slate-950/60 border-slate-800 text-slate-600 cursor-not-allowed'
                      : 'bg-slate-900 hover:bg-slate-800 border-slate-700/80 hover:border-slate-600 text-slate-300 hover:text-blue-400 cursor-pointer'
                  }`}
                >
                  <Download className={`w-3.5 h-3.5 ${savedPlans.length > 0 ? 'text-blue-400' : 'text-slate-600'}`} />
                  <span>Export</span>
                </button>
                {savedPlans.length > 0 && (
                  <div className="flex items-center gap-2 pl-1 border-l border-slate-800">
                    {!showClearConfirm ? (
                      <button
                        onClick={() => setShowClearConfirm(true)}
                        className="text-[10px] text-slate-500 hover:text-rose-400 flex items-center gap-1 font-bold font-sans transition-colors cursor-pointer"
                      >
                        Clear
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="text-slate-400 font-sans">Delete all?</span>
                        <button
                          onClick={() => {
                            onSavePlans([]);
                            setSelectedPlanAId('');
                            setSelectedPlanBId('');
                            triggerNotification('All saved plans cleared.', 'info');
                            setShowClearConfirm(false);
                          }}
                          className="text-rose-400 hover:text-rose-300 font-bold cursor-pointer"
                        >
                          Yes
                        </button>
                        <span className="text-slate-500">/</span>
                        <button
                          onClick={() => setShowClearConfirm(false)}
                          className="text-slate-400 hover:text-slate-300 font-bold cursor-pointer"
                        >
                          No
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {savedPlans.length === 0 ? (
              <div className="text-center py-6 px-3 bg-slate-950/20 rounded-xl border border-slate-800/40 border-dashed space-y-2">
                <AlertCircle className="w-5 h-5 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400 font-medium">No plans saved yet.</p>
                <p className="text-[10px] text-slate-500 max-w-[220px] mx-auto leading-normal">
                  Save current parameters above, or import scenarios from a JSON backup file.
                </p>
                <div className="pt-1">
                  <label
                    title="Import scenarios from JSON file"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500/50 text-slate-300 hover:text-emerald-300 text-xs font-semibold transition-all cursor-pointer shadow-sm"
                  >
                    <Upload className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Import Scenarios JSON</span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportScenariosJSON}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="space-y-3 max-h-[360px] overflow-y-auto custom-scrollbar pr-1">
                {savedPlans.map((plan) => {
                  const isA = effectivePlanAId === plan.id;
                  const isB = selectedPlanBId === plan.id;
                  
                  // Compute details
                  const rothSummaryBadge = plan.inputs.rothConversionStrategy === 'fill-to-target'
                    ? `Roth Conv: Fill (${formatCurrency(plan.inputs.rothConversionTargetValue ?? 0)})`
                    : plan.inputs.annualRothConversion > 0
                      ? `Roth Conv: Flat (${formatCurrency(plan.inputs.annualRothConversion)})`
                      : `Roth Conv: None ($0)`;

                  const isFL = plan.inputs.jurisdiction.relocationYear 
                    ? `Move to FL (${plan.inputs.jurisdiction.relocationYear})` 
                    : `${plan.inputs.jurisdiction.currentState}`;

                  return (
                    <div 
                      key={plan.id}
                      className={`group p-3 rounded-xl border bg-slate-900/20 hover:bg-slate-900/40 transition-all ${
                        isA 
                          ? 'border-blue-500/40 ring-1 ring-blue-500/10' 
                          : isB 
                            ? 'border-emerald-500/40 ring-1 ring-emerald-500/10' 
                            : 'border-slate-800/60'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="space-y-1">
                          <h5 className="text-xs font-bold text-slate-200 line-clamp-1">{plan.name}</h5>
                          <span className="text-[9px] text-slate-500 font-mono block">Saved {plan.createdAt}</span>
                        </div>
                        
                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setInspectingPlan(plan)}
                            title="View full scenario ingredients & config details"
                            className="p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-slate-100 transition-colors"
                          >
                            <Info className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleLoadPlan(plan)}
                            title="Load these inputs into sidebar"
                            className="p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-slate-100 transition-colors"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeletePlan(plan.id, plan.name)}
                            title="Delete Plan"
                            className="p-1 rounded bg-slate-800/80 hover:bg-rose-950 hover:text-rose-400 text-slate-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Config Summary Badges */}
                      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[9px] font-bold tracking-wide uppercase">
                        <span className="bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded-md">
                          {isFL}
                        </span>
                        <span className="bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded-md">
                          {rothSummaryBadge}
                        </span>
                        <span className="bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded-md">
                          Claim: {plan.inputs.you.targetSSClaimingAge}/{plan.inputs.wife.targetSSClaimingAge}
                        </span>
                      </div>

                      {/* Selectors shortcuts */}
                      <div className="mt-2.5 pt-2 border-t border-slate-800/40 flex gap-2">
                        <button
                          onClick={() => setSelectedPlanAId(plan.id)}
                          className={`flex-1 text-[9px] font-bold py-1 px-2 rounded-md border text-center transition-all ${
                            isA 
                              ? 'bg-blue-600 border-blue-500 text-slate-100' 
                              : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Select Plan A
                        </button>
                        <button
                          onClick={() => setSelectedPlanBId(plan.id)}
                          className={`flex-1 text-[9px] font-bold py-1 px-2 rounded-md border text-center transition-all ${
                            isB 
                              ? 'bg-emerald-600 border-emerald-500 text-slate-100' 
                              : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Select Plan B
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Right Side: Lifetime Scenario Comparison Dashboard (Col span 8) */}
        <div className="xl:col-span-8 space-y-3">
          <div className="glass-panel rounded-2xl p-3.5 border border-slate-800 space-y-3">
            
            {/* Header Dropdown Selectors */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-950/40 border border-slate-800">
              
              {/* Dropdown A */}
              <div className="flex-1 space-y-1.5">
                <label className="text-[10px] text-blue-400 font-bold uppercase tracking-wider block">Plan A (Baseline Scenario)</label>
                <select
                  value={effectivePlanAId}
                  onChange={(e) => setSelectedPlanAId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-blue-500 text-xs px-3 py-2 rounded-xl text-slate-200 focus:outline-none"
                >
                  <option value="current">Current Active Plan</option>
                  {savedPlans.length > 0 && (
                    <optgroup label="Saved Scenarios">
                      {savedPlans.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="flex items-center justify-center p-2">
                <ArrowRightLeft className="w-5 h-5 text-slate-500 hidden md:block" />
              </div>

              {/* Dropdown B */}
              <div className="flex-1 space-y-1.5">
                <label className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider block">Plan B (Proposed Scenario)</label>
                <select
                  value={selectedPlanBId}
                  onChange={(e) => setSelectedPlanBId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-emerald-500 text-xs px-3 py-2 rounded-xl text-slate-200 focus:outline-none"
                >
                  <option value="">-- Choose Plan B --</option>
                  <option value="current">Current Active Plan</option>
                  {savedPlans.length > 0 && (
                    <optgroup label="Saved Scenarios">
                      {savedPlans.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

            </div>

            {/* If missing inputs, show detailed informative onboarding */}
            {(!planA || !planB) ? (
              <div className="text-center py-20 bg-slate-950/20 rounded-2xl border border-slate-800/40 border-dashed space-y-4">
                <div className="relative inline-block">
                  <div className="absolute -inset-1 rounded-full bg-emerald-500/10 blur animate-pulse" />
                  <Sparkles className="relative w-10 h-10 text-emerald-400 mx-auto" />
                </div>
                <h5 className="text-sm font-bold text-slate-200">Side-by-Side Lifetime Plan Comparison</h5>
                <p className="text-xs text-slate-400 max-w-[420px] mx-auto leading-relaxed">
                  Select both **Plan A** and **Plan B** in the dropdown selectors above to view an exhaustive, color-coded comparison of lifetime federal/state taxes, Medicare costs, and final portfolio values.
                </p>
                <div className="pt-2 text-[10px] text-slate-500 font-mono">
                  Tip: Save scenarios like "Flat conversions" and "Fill to Target" to compare side-by-side.
                </div>
              </div>
            ) : (
              // Live Side-by-Side Comparison Render
              <div className="space-y-6 animate-fade-in">
                
                {/* 1. Key Lifetime Metric Deltas Table */}
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/30">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-900/60 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                        <th className="py-5 px-6">Lifetime Category ({simStartYear} - {globalEndingYear})</th>
                        <th className="py-5 px-5 text-right text-blue-300 font-bold bg-blue-500/5">Plan A: {planA.name}</th>
                        <th className="py-5 px-5 text-right text-emerald-300 font-bold bg-emerald-500/5">Plan B: {planB.name}</th>
                        <th className="py-5 px-5 text-right">Lifetime Delta</th>
                        <th className="py-5 px-5 text-right">Difference %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {comparisonRows.map((row) => {
                        const delta = row.valB - row.valA;
                        const percentDelta = row.valA !== 0 ? delta / row.valA : 0;
                        
                        // Favorable vs Unfavorable Logic
                        // Favorable: Taxes decrease OR ending net estate increases.
                        let isFavorable = false;
                        const isZero = Math.abs(delta) < 0.01;
                        
                        if (!isZero) {
                          if (row.lowerIsBetter) {
                            // Taxes / Surcharges: lower is better
                            isFavorable = delta < 0;
                          } else {
                            // Estate / Net Worth: higher is better
                            isFavorable = delta > 0;
                          }
                        }

                        return (
                          <tr key={row.id} className="transition-colors hover:bg-slate-900/20 group">
                            <td className="py-5 px-6 font-medium">
                              <div className="font-bold text-slate-200 flex items-center gap-1.5 mb-1.5">
                                {row.name}
                                <span className="group-hover:opacity-100 opacity-0 transition-opacity" title={row.desc}>
                                  <Info className="w-3.5 h-3.5 text-slate-500 cursor-help" />
                                </span>
                              </div>
                              <span className="text-[11px] text-slate-400 block leading-relaxed">{row.desc}</span>
                            </td>
                            
                            <td className="py-5 px-5 text-right font-mono font-bold text-slate-300 bg-blue-500/5">
                              {formatCurrency(row.valA)}
                            </td>
                            
                            <td className="py-5 px-5 text-right font-mono font-bold text-slate-300 bg-emerald-500/5">
                              {formatCurrency(row.valB)}
                            </td>
                            
                            <td className={`py-5 px-5 text-right font-mono font-black ${
                              isZero 
                                ? 'text-slate-400' 
                                : isFavorable 
                                  ? 'text-emerald-400' 
                                  : 'text-rose-400'
                            }`}>
                              {isZero ? '$0' : `${delta > 0 ? '+' : ''}${formatCurrency(delta)}`}
                            </td>
                            
                            <td className={`py-5 px-5 text-right font-mono font-black rounded-r-lg ${
                              isZero 
                                ? 'text-slate-400' 
                                : isFavorable 
                                  ? 'text-emerald-400' 
                                  : 'text-rose-400'
                            }`}>
                              {isZero ? '0.0%' : formatPercentage(percentDelta)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 2. Premium Visual TakeawayInsight Card */}
                {summaryInsight && (
                  <div className={`border rounded-2xl p-5 shadow-xl transition-all relative overflow-hidden ${
                    summaryInsight.isIdentical
                      ? 'bg-slate-900/40 border-slate-700/50'
                      : summaryInsight.isPositiveOverall
                        ? 'bg-emerald-950/20 border-emerald-500/30'
                        : 'bg-rose-950/10 border-rose-500/20'
                  }`}>
                    {/* Background glows */}
                    <div className={`absolute -right-10 -bottom-10 w-40 h-40 rounded-full blur-3xl opacity-10 ${
                      summaryInsight.isIdentical
                        ? 'bg-slate-500'
                        : summaryInsight.isPositiveOverall 
                          ? 'bg-emerald-400' 
                          : 'bg-rose-400'
                    }`} />
                    
                    <div className="flex gap-4">
                      <div className="mt-1 flex-shrink-0">
                        {summaryInsight.isIdentical ? (
                          <div className="bg-slate-800/80 border border-slate-700/60 p-2.5 rounded-xl">
                            <Sparkles className="w-5 h-5 text-slate-400" />
                          </div>
                        ) : summaryInsight.isPositiveOverall ? (
                          <div className="bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl">
                            <TrendingUp className="w-5 h-5 text-emerald-400" />
                          </div>
                        ) : (
                          <div className="bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-xl">
                            <TrendingDown className="w-5 h-5 text-rose-400" />
                          </div>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <h4 className={`text-sm font-black ${
                          summaryInsight.isIdentical
                            ? 'text-slate-300'
                            : summaryInsight.isPositiveOverall 
                              ? 'text-emerald-400' 
                              : 'text-rose-400'
                        }`}>
                          Plan comparison analysis: {
                            summaryInsight.isIdentical 
                              ? 'Identical Scenarios' 
                              : summaryInsight.isPositiveOverall 
                                ? 'Optimal Setup Identified' 
                                : 'Caution Advised'
                          }
                        </h4>
                        
                        <p className="text-xs text-slate-300 leading-relaxed font-medium">
                          {summaryInsight.benefitSummary}
                        </p>

                        {!summaryInsight.isIdentical && (
                          <div className="pt-2 flex flex-wrap gap-x-4 gap-y-2 text-[10px] font-mono">
                            <span className="flex items-center gap-1 text-slate-400">
                              🛡️ Surcharges: <strong className={summaryInsight.isSurchargeFavorable ? 'text-emerald-400' : 'text-slate-300'}>
                                {summaryInsight.surchargeSavings > 0 
                                  ? `${formatCurrency(summaryInsight.surchargeSavings)} saved` 
                                  : summaryInsight.surchargeSavings < 0
                                    ? `${formatCurrency(Math.abs(summaryInsight.surchargeSavings))} increase`
                                    : 'No change'}
                              </strong>
                            </span>
                            
                            <span className="flex items-center gap-1 text-slate-400">
                              💸 Income Tax: <strong className={summaryInsight.isTaxFavorable ? 'text-emerald-400' : 'text-rose-400'}>
                                {summaryInsight.netTaxesDesc}
                              </strong>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                
              </div>
            )}

          </div>
        </div>

      </div>
    </div>
  );
};
