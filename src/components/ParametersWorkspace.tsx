import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  AppStateInputs,
  SavedPlan,
  SimulationResultRow,
  getSimulationStartYear,
  normalizeDetailedExpenses,
} from '../types';
import {
  Wallet,
  Flame,
  FileSpreadsheet,
  RefreshCw,
  User,
  Heart,
  HeartPulse,
  Activity,
  Scale,
  MapPin,
  HeartHandshake,
  Users,
  Pencil,
  Check,
  Download,
  Upload,
  FileText,
  Percent,
  Building,
  Sparkles,
  RotateCcw,
  Receipt,
} from 'lucide-react';
import {
  getSupportedStates,
  getStateTaxProfile,
  getSubJurisdictions,
  getEffectiveLocalTaxRate,
} from '../engine/stateTaxRegistry';
import { SAMPLE_DEMO_PLAN } from '../shared/utils/sampleDemoPlan';
import { NumericInput } from './NumericInput';
import { RangeSlider } from './RangeSlider';
import { DetailedExpensesDialog } from './DetailedExpensesDialog';
import { PersonHealthcareInlineCard } from './PersonHealthcareInlineCard';
import { CharityControlPanel } from './CharityControlPanel';
import { ExportPlanDialog } from './ExportPlanDialog';
import { ExportFormatType } from '../utils/exportHelpers';
import { ActiveViewType } from './SidebarNavigation';

interface ParametersWorkspaceProps {
  activeSection: ActiveViewType;
  onNavigateSection?: (section: ActiveViewType) => void;
  inputs: AppStateInputs;
  onChange: (newInputs: AppStateInputs | ((prev: AppStateInputs) => AppStateInputs)) => void;
  onReset: () => void;
  simulateSurvivor: boolean;
  setSimulateSurvivor: (val: boolean) => void;
  ledger: SimulationResultRow[];
  globalScenario: 'flat' | 'p10' | 'p50' | 'p90';
  savedPlans?: SavedPlan[];
  onSavePlans?: (plans: SavedPlan[] | ((prev: SavedPlan[]) => SavedPlan[])) => void;
}

export const ParametersWorkspace: React.FC<ParametersWorkspaceProps> = ({
  activeSection,
  onNavigateSection,
  inputs,
  onChange,
  onReset,
  simulateSurvivor,
  setSimulateSurvivor,
  ledger,
  savedPlans = [],
  onSavePlans,
}) => {
  const [isEditingYouName, setIsEditingYouName] = useState(false);
  const [tempYouName, setTempYouName] = useState(inputs.you.name || '');
  const [tempYouBirthDate, setTempYouBirthDate] = useState(inputs.you.birthDate || '1960-01-01');
  const [isEditingWifeName, setIsEditingWifeName] = useState(false);
  const [tempWifeName, setTempWifeName] = useState(inputs.wife.name || '');
  const [tempWifeBirthDate, setTempWifeBirthDate] = useState(inputs.wife.birthDate || '1964-01-01');
  const [showExpensesDialog, setShowExpensesDialog] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [exportDialogFormat, setExportDialogFormat] = useState<ExportFormatType | null>(null);

  useEffect(() => {
    setTempYouBirthDate(inputs.you.birthDate || '1960-01-01');
  }, [inputs.you.birthDate]);

  useEffect(() => {
    setTempWifeBirthDate(inputs.wife.birthDate || '1964-01-01');
  }, [inputs.wife.birthDate]);

  const simStartYear = getSimulationStartYear(inputs);
  const lastRelocationYear = useRef<number>(inputs.jurisdiction.relocationYear ?? 2032);

  const updateNestedState = (
    category: keyof AppStateInputs | 'you' | 'wife' | 'jurisdiction' | 'growthAssumptions' | 'portfolio' | 'monteCarloSettings',
    field: string,
    value: unknown
  ) => {
    // Avoid triggering state change if value is identical
    const catObj = inputs[category as keyof AppStateInputs];
    if (catObj && typeof catObj === 'object' && (catObj as Record<string, unknown>)[field] === value) {
      return;
    }
    if ((inputs as unknown as Record<string, unknown>)[category] === value) {
      return;
    }

    const updated = { ...inputs };
    if (category === 'you' || category === 'wife') {
      updated[category] = { ...updated[category], [field]: value };
    } else if (category === 'jurisdiction') {
      updated.jurisdiction = { ...updated.jurisdiction, [field]: value };
    } else if (category === 'growthAssumptions') {
      updated.growthAssumptions = { ...updated.growthAssumptions, [field]: value };
    } else if (category === 'portfolio') {
      updated.portfolio = { ...updated.portfolio, [field]: value };
    } else if (category === 'monteCarloSettings') {
      updated.monteCarloSettings = { ...updated.monteCarloSettings, [field]: value };
    } else {
      (updated as Record<string, unknown>)[category] = value;
    }
    onChange(updated);
  };

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const yourBirthYear = useMemo(() => {
    if (!inputs.you.birthDate) return 1960;
    const year = parseInt(inputs.you.birthDate.split('-')[0], 10);
    return isNaN(year) ? 1960 : year;
  }, [inputs.you.birthDate]);

  const yourBirthMonthNum = useMemo(() => {
    if (!inputs.you.birthDate) return 1;
    const mo = parseInt(inputs.you.birthDate.split('-')[1], 10);
    return isNaN(mo) ? 1 : mo;
  }, [inputs.you.birthDate]);

  const wifeBirthYear = useMemo(() => {
    if (!inputs.wife.birthDate) return 1964;
    const year = parseInt(inputs.wife.birthDate.split('-')[0], 10);
    return isNaN(year) ? 1964 : year;
  }, [inputs.wife.birthDate]);

  const wifeBirthMonthNum = useMemo(() => {
    if (!inputs.wife.birthDate) return 1;
    const mo = parseInt(inputs.wife.birthDate.split('-')[1], 10);
    return isNaN(mo) ? 1 : mo;
  }, [inputs.wife.birthDate]);

  const mdMonthlySum = useMemo(() => {
    if (!inputs.detailedExpenses) return 0;
    const norm = normalizeDetailedExpenses(inputs.detailedExpenses);
    const stateCosts = norm.costs[inputs.jurisdiction.currentState] || {};
    const freqs = norm.frequencies;
    const items = norm.catalog.items;
    let sum = 0;
    for (const item of items) {
      if (item.isOneTime) continue;
      const cost = stateCosts[item.id] ?? 0;
      const freq = freqs[item.id] ?? item.defaultFrequency ?? 12;
      sum += cost * freq;
    }
    return sum / 12;
  }, [inputs.detailedExpenses, inputs.jurisdiction.currentState]);

  const flMonthlySum = useMemo(() => {
    if (!inputs.detailedExpenses) return 0;
    const norm = normalizeDetailedExpenses(inputs.detailedExpenses);
    const stateCosts = norm.costs[inputs.jurisdiction.targetState] || {};
    const freqs = norm.frequencies;
    const items = norm.catalog.items;
    let sum = 0;
    for (const item of items) {
      if (item.isOneTime) continue;
      const cost = stateCosts[item.id] ?? 0;
      const freq = freqs[item.id] ?? item.defaultFrequency ?? 12;
      sum += cost * freq;
    }
    return sum / 12;
  }, [inputs.detailedExpenses, inputs.jurisdiction.targetState]);

  const formatCurrency = (val: number | null | undefined) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val || 0);
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) return;
        const parsed = JSON.parse(text) as AppStateInputs & { savedPlans?: SavedPlan[] };

        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.you &&
          parsed.portfolio &&
          parsed.growthAssumptions
        ) {
          const cleaned = {
            ...parsed,
            isConfigured: true,
          };
          if (typeof parsed.simulateSurvivor === 'boolean') {
            setSimulateSurvivor(parsed.simulateSurvivor);
          }
          if (Array.isArray(parsed.savedPlans) && onSavePlans) {
            onSavePlans(parsed.savedPlans);
          }
          onChange(cleaned);
        } else {
          alert('Invalid plan configuration file. Please ensure the file is a valid JSON exported from this app.');
        }
      } catch (err) {
        console.error('Import plan failed:', err);
        alert('Failed to parse the file. Please ensure it is a valid JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-8">
      {/* SECTION 1: PROFILES & FAMILY */}
      {activeSection === 'params-profiles' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100">Profiles & Family</h2>
                <p className="text-[11px] text-slate-400">Personal profiles, birth dates, Social Security claiming ages & active salaries</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Primary User Card */}
            <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <User className="w-4 h-4" />
                  </div>
                  {isEditingYouName ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={tempYouName}
                        onChange={(e) => setTempYouName(e.target.value)}
                        onBlur={() => {
                          setIsEditingYouName(false);
                          const trimmed = tempYouName.trim();
                          if (trimmed !== (inputs.you.name || '')) {
                            updateNestedState('you', 'name', trimmed);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setIsEditingYouName(false);
                            const trimmed = tempYouName.trim();
                            if (trimmed !== (inputs.you.name || '')) {
                              updateNestedState('you', 'name', trimmed);
                            }
                          } else if (e.key === 'Escape') {
                            setIsEditingYouName(false);
                            setTempYouName(inputs.you.name || '');
                          }
                        }}
                        autoFocus
                        className="bg-slate-950 border border-emerald-500 rounded px-2 py-0.5 text-xs text-slate-100 font-bold focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingYouName(false);
                          const trimmed = tempYouName.trim();
                          if (trimmed !== (inputs.you.name || '')) {
                            updateNestedState('you', 'name', trimmed);
                          }
                        }}
                        className="text-emerald-400 hover:text-emerald-300 p-1"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-1.5 cursor-pointer group"
                      onClick={() => {
                        setTempYouName(inputs.you.name || '');
                        setIsEditingYouName(true);
                      }}
                    >
                      <h3 className="text-sm font-bold text-slate-100 group-hover:text-emerald-400 transition-colors">
                        {inputs.you.name || 'Primary User'}
                      </h3>
                      <Pencil className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                    </div>
                  )}
                </div>
                <span className="text-xs bg-slate-800 px-2.5 py-1 rounded-lg text-emerald-400 font-mono font-bold">
                  Born {yourBirthYear}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-end">
                <div className="space-y-1">
                  <div className="flex justify-between items-center h-5">
                    <label className="text-xs text-slate-400 font-medium">Birth Date</label>
                  </div>
                  <input
                    type="date"
                    value={tempYouBirthDate}
                    onChange={(e) => setTempYouBirthDate(e.target.value)}
                    onBlur={() => {
                      if (tempYouBirthDate && tempYouBirthDate !== (inputs.you.birthDate || '1960-01-01')) {
                        updateNestedState('you', 'birthDate', tempYouBirthDate);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (tempYouBirthDate && tempYouBirthDate !== (inputs.you.birthDate || '1960-01-01')) {
                          updateNestedState('you', 'birthDate', tempYouBirthDate);
                        }
                      }
                    }}
                    className="w-full h-8 bg-slate-900 border border-slate-800 rounded-lg px-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 box-border"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center h-5">
                    <label className="text-xs text-slate-400 font-medium">Planned Retirement</label>
                    <span className="text-[10px] text-emerald-400 font-mono font-bold">
                      {MONTH_NAMES[(inputs.you.plannedRetirementMonth ?? yourBirthMonthNum) - 1]} {yourBirthYear + (inputs.you.plannedRetirementAge ?? 65)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumericInput
                      value={inputs.you.plannedRetirementAge}
                      onChange={(val) => updateNestedState('you', 'plannedRetirementAge', val ?? 65)}
                      min={50}
                      max={80}
                      suffix="yrs"
                    />
                    <select
                      value={inputs.you.plannedRetirementMonth ?? yourBirthMonthNum}
                      onChange={(e) => updateNestedState('you', 'plannedRetirementMonth', parseInt(e.target.value, 10))}
                      className="w-full h-8 bg-slate-900 border border-slate-800 rounded-lg px-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer box-border"
                    >
                      {MONTH_NAMES.map((m, idx) => (
                        <option key={idx + 1} value={idx + 1}>
                          {m} ({String(idx + 1).padStart(2, '0')})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <RangeSlider
                  min={62}
                  max={70}
                  step={1}
                  value={inputs.you.targetSSClaimingAge ?? 67}
                  onChange={(val) => updateNestedState('you', 'targetSSClaimingAge', val)}
                  renderLabel={(displayVal) => (
                    <div className="flex justify-between items-center text-xs">
                      <label className="text-slate-400 font-medium">Target Social Security Claiming Age</label>
                      <span className="text-emerald-400 font-bold font-mono text-xs bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        Age {displayVal}
                      </span>
                    </div>
                  )}
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>Age 62 (Early)</span>
                  <span>Age 67 (FRA)</span>
                  <span>Age 70 (Max +24%)</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400 font-medium">Estimated SS Monthly PIA (Age 67)</label>
                  <NumericInput
                    value={inputs.you.estimatedPIA}
                    onChange={(val) => updateNestedState('you', 'estimatedPIA', val)}
                    prefix="$"
                    placeholder="e.g. 3,000"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-400 font-medium">Active Annual Salary</label>
                  <NumericInput
                    value={inputs.you.activeSalary}
                    onChange={(val) => updateNestedState('you', 'activeSalary', val ?? 0)}
                    prefix="$"
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
                <RangeSlider
                  min={50}
                  max={110}
                  step={1}
                  value={inputs.you.longevityAge ?? 90}
                  onChange={(val) => updateNestedState('you', 'longevityAge', val)}
                  renderLabel={(displayVal) => (
                    <div className="flex justify-between items-center text-xs">
                      <label className="text-slate-400 font-medium">Actuarial Projected Longevity Age</label>
                      <span className="text-emerald-400 font-bold font-mono text-xs bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        Age {displayVal} (Year {yourBirthYear + displayVal})
                      </span>
                    </div>
                  )}
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>Age 50</span>
                  <span>Age 85</span>
                  <span>Age 90</span>
                  <span>Age 95</span>
                  <span>Age 110</span>
                </div>
              </div>
            </div>

            {/* Spouse Profile Card */}
            {!inputs.isSingleFiler && (
              <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-teal-500/20 text-teal-400">
                      <Heart className="w-4 h-4" />
                    </div>
                    {isEditingWifeName ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={tempWifeName}
                          onChange={(e) => setTempWifeName(e.target.value)}
                          onBlur={() => {
                            setIsEditingWifeName(false);
                            const trimmed = tempWifeName.trim();
                            if (trimmed !== (inputs.wife.name || '')) {
                              updateNestedState('wife', 'name', trimmed);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setIsEditingWifeName(false);
                              const trimmed = tempWifeName.trim();
                              if (trimmed !== (inputs.wife.name || '')) {
                                updateNestedState('wife', 'name', trimmed);
                              }
                            } else if (e.key === 'Escape') {
                              setIsEditingWifeName(false);
                              setTempWifeName(inputs.wife.name || '');
                            }
                          }}
                          autoFocus
                          className="bg-slate-950 border border-teal-500 rounded px-2 py-0.5 text-xs text-slate-100 font-bold focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditingWifeName(false);
                            const trimmed = tempWifeName.trim();
                            if (trimmed !== (inputs.wife.name || '')) {
                              updateNestedState('wife', 'name', trimmed);
                            }
                          }}
                          className="text-teal-400 hover:text-teal-300 p-1"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div
                        className="flex items-center gap-1.5 cursor-pointer group"
                        onClick={() => {
                          setTempWifeName(inputs.wife.name || '');
                          setIsEditingWifeName(true);
                        }}
                      >
                        <h3 className="text-sm font-bold text-slate-100 group-hover:text-teal-400 transition-colors">
                          {inputs.wife.name || 'Spouse'}
                        </h3>
                        <Pencil className="w-3.5 h-3.5 text-slate-500 group-hover:text-teal-400 transition-colors" />
                      </div>
                    )}
                  </div>
                  <span className="text-xs bg-slate-800 px-2.5 py-1 rounded-lg text-teal-400 font-mono font-bold">
                    Born {wifeBirthYear}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-end">
                  <div className="space-y-1">
                    <div className="flex justify-between items-center h-5">
                      <label className="text-xs text-slate-400 font-medium">Birth Date</label>
                    </div>
                    <input
                      type="date"
                      value={tempWifeBirthDate}
                      onChange={(e) => setTempWifeBirthDate(e.target.value)}
                      onBlur={() => {
                        if (tempWifeBirthDate && tempWifeBirthDate !== (inputs.wife.birthDate || '1964-01-01')) {
                          updateNestedState('wife', 'birthDate', tempWifeBirthDate);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (tempWifeBirthDate && tempWifeBirthDate !== (inputs.wife.birthDate || '1964-01-01')) {
                            updateNestedState('wife', 'birthDate', tempWifeBirthDate);
                          }
                        }
                      }}
                      className="w-full h-8 bg-slate-900 border border-slate-800 rounded-lg px-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-teal-500 box-border"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-center h-5">
                      <label className="text-xs text-slate-400 font-medium">Planned Retirement</label>
                      <span className="text-[10px] text-teal-400 font-mono font-bold">
                        {MONTH_NAMES[(inputs.wife.plannedRetirementMonth ?? wifeBirthMonthNum) - 1]} {wifeBirthYear + (inputs.wife.plannedRetirementAge ?? 67)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumericInput
                        value={inputs.wife.plannedRetirementAge}
                        onChange={(val) => updateNestedState('wife', 'plannedRetirementAge', val ?? 67)}
                        min={50}
                        max={80}
                        suffix="yrs"
                      />
                      <select
                        value={inputs.wife.plannedRetirementMonth ?? wifeBirthMonthNum}
                        onChange={(e) => updateNestedState('wife', 'plannedRetirementMonth', parseInt(e.target.value, 10))}
                        className="w-full h-8 bg-slate-900 border border-slate-800 rounded-lg px-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-teal-500 cursor-pointer box-border"
                      >
                        {MONTH_NAMES.map((m, idx) => (
                          <option key={idx + 1} value={idx + 1}>
                            {m} ({String(idx + 1).padStart(2, '0')})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <RangeSlider
                    min={62}
                    max={70}
                    step={1}
                    value={inputs.wife.targetSSClaimingAge ?? 67}
                    onChange={(val) => updateNestedState('wife', 'targetSSClaimingAge', val)}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500"
                    renderLabel={(displayVal) => (
                      <div className="flex justify-between items-center text-xs">
                        <label className="text-slate-400 font-medium">Target Social Security Claiming Age</label>
                        <span className="text-teal-400 font-bold font-mono text-xs bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          Age {displayVal}
                        </span>
                      </div>
                    )}
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>Age 62 (Early)</span>
                    <span>Age 67 (FRA)</span>
                    <span>Age 70 (Max +24%)</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 font-medium">Estimated SS Monthly PIA (Age 67)</label>
                    <NumericInput
                      value={inputs.wife.estimatedPIA}
                      onChange={(val) => updateNestedState('wife', 'estimatedPIA', val)}
                      prefix="$"
                      placeholder="e.g. 1,500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 font-medium">Active Annual Salary</label>
                    <NumericInput
                      value={inputs.wife.activeSalary}
                      onChange={(val) => updateNestedState('wife', 'activeSalary', val ?? 0)}
                      prefix="$"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
                  <RangeSlider
                    min={50}
                    max={110}
                    step={1}
                    value={inputs.wife.longevityAge ?? 95}
                    onChange={(val) => updateNestedState('wife', 'longevityAge', val)}
                    renderLabel={(displayVal) => (
                      <div className="flex justify-between items-center text-xs">
                        <label className="text-slate-400 font-medium">Actuarial Projected Longevity Age</label>
                        <span className="text-emerald-400 font-bold font-mono text-xs bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          Age {displayVal} (Year {wifeBirthYear + displayVal})
                        </span>
                      </div>
                    )}
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>Age 50</span>
                    <span>Age 85</span>
                    <span>Age 90</span>
                    <span>Age 95</span>
                    <span>Age 110</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION: TAX FILING STATUS */}
      {activeSection === 'params-filing-status' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <Scale className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100">Tax Filing Status</h2>
                <p className="text-[11px] text-slate-400">Federal and State tax brackets, standard deductions & survivor scenario modeling</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Primary Status Selection Card */}
            <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <Scale className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">IRS Tax Filing Mode</h3>
                    <p className="text-[10px] text-slate-400">Standard deductions & bracket thresholds</p>
                  </div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-lg font-mono font-bold ${
                  inputs.isSingleFiler
                    ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                    : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                }`}>
                  {inputs.isSingleFiler ? 'Single Filer' : 'Married Filing Jointly (MFJ)'}
                </span>
              </div>

              <div className="space-y-3">
                <label className="text-xs text-slate-300 font-semibold block">Select Filing Mode</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateNestedState('isSingleFiler', '', false)}
                    className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                      !inputs.isSingleFiler
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    Married Filing Jointly (MFJ)
                  </button>
                  <button
                    type="button"
                    onClick={() => updateNestedState('isSingleFiler', '', true)}
                    className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                      inputs.isSingleFiler
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    Single Filer
                  </button>
                </div>

                <div className="p-3.5 bg-slate-950/50 rounded-xl border border-slate-800 text-[11px] text-slate-400 leading-relaxed space-y-1.5">
                  {!inputs.isSingleFiler ? (
                    <div>
                      <strong className="text-emerald-400 block mb-0.5">MFJ Rules Applied:</strong>
                      Joint standard deduction ($30,000+ indexed), doubled 10%/12%/22%/24% bracket widths, and higher IRMAA threshold ($212,000+ MAGI).
                    </div>
                  ) : (
                    <div>
                      <strong className="text-amber-400 block mb-0.5">Single Filer Rules Applied:</strong>
                      Single standard deduction ($15,000+ indexed), compressed tax bracket thresholds, and single IRMAA threshold ($106,000+ MAGI).
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Survivor Stress Scenario Modeling Card */}
            <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400">
                    <Heart className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">Survivor Scenario Stress Analysis</h3>
                    <p className="text-[10px] text-slate-400">Tax bracket compression & widow's penalty</p>
                  </div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-lg font-mono font-bold ${
                  !inputs.isSingleFiler
                    ? simulateSurvivor
                      ? 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                    : 'bg-slate-800 text-slate-500 border border-slate-700'
                }`}>
                  {!inputs.isSingleFiler ? (simulateSurvivor ? 'Survivor Active' : 'Off') : 'N/A (Single)'}
                </span>
              </div>

              <div className="space-y-3">
                {!inputs.isSingleFiler ? (
                  <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <label htmlFor="simulateSurvivorToggle" className="cursor-pointer">
                        <span className="text-xs font-semibold text-slate-200 block">Simulate Survivor Scenario</span>
                        <span className="text-[10px] text-slate-400">
                          Stress tests widow's tax penalty if primary spouse passes away first
                        </span>
                      </label>
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          id="simulateSurvivorToggle"
                          checked={simulateSurvivor}
                          onChange={(e) => setSimulateSurvivor(e.target.checked)}
                          className="rounded border-slate-700 text-rose-500 focus:ring-rose-500 h-4 w-4 bg-slate-900 cursor-pointer accent-rose-500"
                        />
                        <button
                          type="button"
                          onClick={() => setSimulateSurvivor(!simulateSurvivor)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                            simulateSurvivor
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-sm'
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                          }`}
                        >
                          {simulateSurvivor ? 'Survivor Active' : 'Off'}
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-normal">
                      When active, compresses tax brackets to single filer rates and reduces dual Social Security to the single higher benefit upon survivor transition.
                    </p>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-800/60 text-xs text-slate-500 flex items-center justify-center text-center min-h-[140px]">
                    Survivor scenario simulation is not applicable for Single Filer plans as single tax bracket rates are already utilized.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION: TAX RESIDENCY & STATE RELOCATION */}
      {activeSection === 'params-residency' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100">Tax Residency & States</h2>
                <p className="text-[11px] text-slate-400">Model multi-state tax jurisdiction transitions and cost of living impacts</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Card 1: Primary Tax Jurisdiction */}
            <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">Primary Residence</h3>
                    <p className="text-[10px] text-slate-400">Starting tax jurisdiction and county residency</p>
                  </div>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-lg font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {inputs.jurisdiction.currentState}
                  {inputs.jurisdiction.currentCounty ? ` • ${inputs.jurisdiction.currentCounty}` : ''}
                </span>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-200 block mb-1">State of Residence</label>
                  <select
                    value={inputs.jurisdiction.currentState || 'MD'}
                    onChange={(e) => {
                      const newState = e.target.value;
                      const profile = getStateTaxProfile(newState);
                      if (profile?.hasLocalTax) {
                        const defaultCounty = profile.subJurisdictions[0]?.id || 'montgomery';
                        onChange({
                          ...inputs,
                          jurisdiction: {
                            ...inputs.jurisdiction,
                            currentState: newState,
                            currentCounty: defaultCounty,
                            currentLocalTaxRate: null,
                          },
                        });
                      } else {
                        onChange({
                          ...inputs,
                          jurisdiction: {
                            ...inputs.jurisdiction,
                            currentState: newState,
                            currentCounty: null,
                            currentLocalTaxRate: null,
                          },
                        });
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs font-medium text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  >
                    {getSupportedStates().map((st) => (
                      <option key={st.code} value={st.code}>
                        {st.name} ({st.code})
                      </option>
                    ))}
                  </select>
                </div>

                {(() => {
                  const currentProfile = getStateTaxProfile(inputs.jurisdiction.currentState || 'MD');
                  const hasCounties = (currentProfile?.subJurisdictions && currentProfile.subJurisdictions.length > 0);
                  const effectiveRate = getEffectiveLocalTaxRate(
                    inputs.jurisdiction.currentState || 'MD',
                    inputs.jurisdiction.currentCounty,
                    inputs.jurisdiction.currentLocalTaxRate
                  );

                  return (
                    <div className="space-y-3 p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
                      {hasCounties && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-bold text-slate-200">
                              {currentProfile?.subJurisdictionLabel || 'County'}
                            </label>
                            <span className="text-[10px] text-slate-400 font-mono">
                              Local Piggyback Tax
                            </span>
                          </div>
                          <select
                            value={inputs.jurisdiction.currentCounty || ''}
                            onChange={(e) => {
                              onChange({
                                ...inputs,
                                jurisdiction: {
                                  ...inputs.jurisdiction,
                                  currentCounty: e.target.value,
                                  currentLocalTaxRate: null,
                                },
                              });
                            }}
                            className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-medium text-slate-100 focus:outline-none focus:border-emerald-500"
                          >
                            <option value="" disabled>Select {currentProfile?.subJurisdictionLabel || 'County'}...</option>
                            {getSubJurisdictions(inputs.jurisdiction.currentState || 'MD').map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({(c.defaultLocalRate * 100).toFixed(2)}%)
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[11px] font-semibold text-slate-300">
                            {hasCounties ? 'Effective Local / Municipal Rate' : 'Custom Local Tax Rate (%)'}
                          </label>
                          {inputs.jurisdiction.currentLocalTaxRate !== undefined &&
                            inputs.jurisdiction.currentLocalTaxRate !== null && (
                              <button
                                type="button"
                                onClick={() => {
                                  onChange({
                                    ...inputs,
                                    jurisdiction: {
                                      ...inputs.jurisdiction,
                                      currentLocalTaxRate: null,
                                    },
                                  });
                                }}
                                className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                {hasCounties ? 'Reset to county default' : 'Reset to 0%'}
                              </button>
                            )}
                        </div>
                        <NumericInput
                          value={
                            inputs.jurisdiction.currentLocalTaxRate !== null &&
                            inputs.jurisdiction.currentLocalTaxRate !== undefined
                              ? Math.round(inputs.jurisdiction.currentLocalTaxRate * 10000) / 100
                              : Math.round(effectiveRate * 10000) / 100
                          }
                          onChange={(val) => {
                            onChange({
                              ...inputs,
                              jurisdiction: {
                                ...inputs.jurisdiction,
                                currentLocalTaxRate: val !== null ? val / 100 : null,
                              },
                            });
                          }}
                          suffix="%"
                          allowDecimals
                          decimalPlaces={2}
                          fixedDecimals
                          min={0}
                          max={15}
                          step={0.01}
                          className="font-bold text-emerald-400"
                        />
                        <p className="text-[10px] text-slate-400 leading-relaxed mt-1.5">
                          Optional local or municipal income tax rate. For states like Maryland where county rates are in the dropdown above, selecting your county automatically sets the official piggyback rate so you do not need to enter anything here. However, if you reside inside an incorporated municipality that levies an additional city tax (for example, living inside Gaithersburg city limits where you pay Maryland state + Montgomery County + Gaithersburg City taxes), enter the combined sum of both the county and municipal rates (e.g., 3.20% county + 0.50% city = 3.70%) to override the default county rate. For states without county dropdowns (such as PA, OH, or NY), enter your local city, borough, or school district income tax rate directly.
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {/* Total Effective State & Local Tax Display */}
                {(() => {
                  const primaryProfile = getStateTaxProfile(inputs.jurisdiction.currentState || 'MD');
                  const primaryLocalRate = getEffectiveLocalTaxRate(
                    inputs.jurisdiction.currentState || 'MD',
                    inputs.jurisdiction.currentCounty,
                    inputs.jurisdiction.currentLocalTaxRate
                  );
                  const stateTopRate = primaryProfile?.hasIncomeTax ? primaryProfile.topRate : 0;
                  const primaryTopCombinedRate = stateTopRate + primaryLocalRate;
                  const year1Row = ledger && ledger.length > 0 ? ledger[0] : null;
                  const year1EffectiveRate = year1Row && year1Row.fedAGI > 0
                    ? (year1Row.stateIncomeTax / year1Row.fedAGI) * 100
                    : 0;

                  return (
                    <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1 rounded-md bg-emerald-500/20 text-emerald-400">
                            <Receipt className="w-3.5 h-3.5" />
                          </div>
                          <div>
                            <span className="text-xs font-bold text-slate-200 block">
                              Total Effective State &amp; Local Tax
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {primaryProfile?.hasIncomeTax
                                ? `Combined top rate: ${(primaryTopCombinedRate * 100).toFixed(2)}% (State up to ${(stateTopRate * 100).toFixed(2)}% + Local ${(primaryLocalRate * 100).toFixed(2)}%)`
                                : primaryLocalRate > 0
                                ? `Local only: ${(primaryLocalRate * 100).toFixed(2)}% (No state income tax)`
                                : '0.00% (No state or local income tax)'}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-mono font-extrabold text-emerald-400 block">
                            {(primaryTopCombinedRate * 100).toFixed(2)}%
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            Top Combined
                          </span>
                        </div>
                      </div>

                      {year1Row && (
                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                          <span className="text-slate-400 text-[11px]">
                            Year 1 ({year1Row.year}) Projected State Tax:
                          </span>
                          <div className="flex items-center gap-2 font-mono">
                            <span className="text-slate-200 font-bold">
                              ${Math.round(year1Row.stateIncomeTax).toLocaleString()}
                            </span>
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                              {year1EffectiveRate.toFixed(2)}% effective
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Card 2: Relocation Planning */}
            <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">Relocation Planning</h3>
                    <p className="text-[10px] text-slate-400">Future state or county relocation timing</p>
                  </div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-lg font-mono font-bold ${
                  inputs.jurisdiction.relocationYear !== null
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}>
                  {inputs.jurisdiction.relocationYear !== null
                    ? `Relocating in ${inputs.jurisdiction.relocationYear}`
                    : 'Continuous Residency'}
                </span>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
                  <div>
                    <label className="text-xs font-bold text-slate-200 block">Enable Relocation?</label>
                    <span className="text-[10px] text-slate-400">Transition to a new state or county in a future year</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-300">Enable</span>
                    <input
                      type="checkbox"
                      id="relocateCheckbox"
                      checked={inputs.jurisdiction.relocationYear !== null}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const year = lastRelocationYear.current ?? simStartYear;
                          const targetSt = inputs.jurisdiction.targetState || (inputs.jurisdiction.currentState === 'MD' ? 'FL' : 'MD');
                          const profile = getStateTaxProfile(targetSt);
                          const defaultTargetCounty = profile?.hasLocalTax ? (profile.subJurisdictions[0]?.id || 'montgomery') : null;
                          onChange({
                            ...inputs,
                            jurisdiction: {
                              ...inputs.jurisdiction,
                              targetState: targetSt,
                              targetCounty: defaultTargetCounty,
                              targetLocalTaxRate: null,
                              relocationYear: year,
                            },
                          });
                        } else {
                          if (inputs.jurisdiction.relocationYear !== null) {
                            lastRelocationYear.current = inputs.jurisdiction.relocationYear;
                          }
                          updateNestedState('jurisdiction', 'relocationYear', null);
                        }
                      }}
                      className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 h-4 w-4 bg-slate-900 cursor-pointer accent-emerald-500"
                    />
                  </div>
                </div>

                {inputs.jurisdiction.relocationYear !== null ? (
                  <div className="space-y-3.5 p-4 bg-slate-950/60 rounded-xl border border-amber-500/30">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold text-slate-200 block mb-1">Destination State</label>
                        <select
                          value={inputs.jurisdiction.targetState || (inputs.jurisdiction.currentState === 'MD' ? 'FL' : 'MD')}
                          onChange={(e) => {
                            const newTargetState = e.target.value;
                            const profile = getStateTaxProfile(newTargetState);
                            const defaultCounty = profile?.hasLocalTax ? (profile.subJurisdictions[0]?.id || 'montgomery') : null;
                            onChange({
                              ...inputs,
                              jurisdiction: {
                                ...inputs.jurisdiction,
                                targetState: newTargetState,
                                targetCounty: defaultCounty,
                                targetLocalTaxRate: null,
                              },
                            });
                          }}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-medium text-slate-100 focus:outline-none focus:border-amber-500"
                        >
                          {getSupportedStates().map((st) => (
                            <option key={st.code} value={st.code}>
                              {st.name} ({st.code})
                            </option>
                          ))}
                        </select>
                      </div>

                      {(() => {
                        const targetProfile = getStateTaxProfile(inputs.jurisdiction.targetState || 'FL');
                        const hasTargetCounties = (targetProfile?.subJurisdictions && targetProfile.subJurisdictions.length > 0);
                        if (!hasTargetCounties) return null;

                        return (
                          <div>
                            <label className="text-xs font-bold text-slate-200 block mb-1">
                              Destination {targetProfile?.subJurisdictionLabel || 'County'}
                            </label>
                            <select
                              value={inputs.jurisdiction.targetCounty || ''}
                              onChange={(e) => {
                                onChange({
                                  ...inputs,
                                  jurisdiction: {
                                    ...inputs.jurisdiction,
                                    targetCounty: e.target.value,
                                    targetLocalTaxRate: null,
                                  },
                                });
                              }}
                              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs font-medium text-slate-100 focus:outline-none focus:border-amber-500"
                            >
                              <option value="" disabled>Select Destination {targetProfile?.subJurisdictionLabel || 'County'}...</option>
                              {getSubJurisdictions(inputs.jurisdiction.targetState || 'FL').map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} ({(c.defaultLocalRate * 100).toFixed(2)}%)
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })()}
                    </div>

                    {(() => {
                      const targetProfile = getStateTaxProfile(inputs.jurisdiction.targetState || 'FL');
                      const hasTargetCounties = (targetProfile?.subJurisdictions && targetProfile.subJurisdictions.length > 0);
                      const targetEffectiveRate = getEffectiveLocalTaxRate(
                        inputs.jurisdiction.targetState || 'FL',
                        inputs.jurisdiction.targetCounty,
                        inputs.jurisdiction.targetLocalTaxRate
                      );

                      return (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[11px] font-semibold text-slate-300">
                              {hasTargetCounties ? 'Destination Effective Local Rate' : 'Destination Local Tax Rate (%)'}
                            </label>
                            {inputs.jurisdiction.targetLocalTaxRate !== undefined &&
                              inputs.jurisdiction.targetLocalTaxRate !== null && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onChange({
                                      ...inputs,
                                      jurisdiction: {
                                        ...inputs.jurisdiction,
                                        targetLocalTaxRate: null,
                                      },
                                    });
                                  }}
                                  className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  {hasTargetCounties ? 'Reset to county default' : 'Reset to 0%'}
                                </button>
                              )}
                          </div>
                          <NumericInput
                            value={
                              inputs.jurisdiction.targetLocalTaxRate !== null &&
                              inputs.jurisdiction.targetLocalTaxRate !== undefined
                                ? Math.round(inputs.jurisdiction.targetLocalTaxRate * 10000) / 100
                                : Math.round(targetEffectiveRate * 10000) / 100
                            }
                            onChange={(val) => {
                              onChange({
                                ...inputs,
                                jurisdiction: {
                                  ...inputs.jurisdiction,
                                  targetLocalTaxRate: val !== null ? val / 100 : null,
                                },
                              });
                            }}
                            suffix="%"
                            allowDecimals
                            decimalPlaces={2}
                            fixedDecimals
                            min={0}
                            max={15}
                            step={0.01}
                            className="font-bold text-amber-400"
                          />
                          <p className="text-[10px] text-slate-400 leading-relaxed mt-1.5">
                            Optional destination municipal or local income tax rate. For states like Maryland where county rates are in the dropdown above, selecting your destination county automatically sets the default rate. If relocating into an incorporated municipality that levies an additional city tax, enter the combined sum of the county and municipal rates to override the default county rate. For states without county dropdowns (such as PA, OH, or NY), enter your destination local tax rate directly.
                          </p>
                        </div>
                      );
                    })()}

                    <RangeSlider
                      min={simStartYear}
                      max={simStartYear + 35}
                      value={inputs.jurisdiction.relocationYear}
                      onChange={(val) => {
                        onChange({
                          ...inputs,
                          jurisdiction: {
                            ...inputs.jurisdiction,
                            relocationYear: val,
                          },
                        });
                      }}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                      renderLabel={(displayVal) => (
                        <div className="flex justify-between items-center text-xs mb-1">
                          <span className="text-slate-300 font-semibold">Relocation Year</span>
                          <span className="text-amber-400 font-bold font-mono">
                            {displayVal} (Age {displayVal - yourBirthYear})
                          </span>
                        </div>
                      )}
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                      <span>{simStartYear} (Immediate)</span>
                      <span>{simStartYear + 35} (Year 35)</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 bg-slate-950/40 rounded-xl border border-slate-800/80 text-[11px] text-slate-400 leading-relaxed">
                    Continuous residency in {getStateTaxProfile(inputs.jurisdiction.currentState || 'MD')?.name || inputs.jurisdiction.currentState}
                    {inputs.jurisdiction.currentCounty ? ` (${inputs.jurisdiction.currentCounty})` : ''} with standard state and local tax rates applied for all simulation years.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Dynamic Jurisdiction Comparison Card */}
          <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Building className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Jurisdiction Tax Profile Comparison</h3>
                  <p className="text-[10px] text-slate-400">Comparative state income and local piggyback tax criteria</p>
                </div>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-lg font-mono font-bold bg-slate-800 text-slate-400 border border-slate-700">
                {inputs.jurisdiction.currentState}
                {inputs.jurisdiction.relocationYear !== null ? ` → ${inputs.jurisdiction.targetState || 'FL'}` : ' (Continuous)'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Left: Current Jurisdiction */}
              <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">
                    {getStateTaxProfile(inputs.jurisdiction.currentState || 'MD')?.name || inputs.jurisdiction.currentState} ({inputs.jurisdiction.currentState})
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400 font-semibold">Current</span>
                </div>
                {getStateTaxProfile(inputs.jurisdiction.currentState || 'MD')?.hasIncomeTax ? (
                  <>
                    <p className="text-[10px] text-slate-400 leading-normal">
                      State income tax rate: <strong>Up to {((getStateTaxProfile(inputs.jurisdiction.currentState || 'MD')?.topRate ?? 0) * 100).toFixed(2)}%</strong>
                    </p>
                    <p className="text-[10px] text-slate-400 leading-normal">
                      Local tax rate: <strong>{(getEffectiveLocalTaxRate(inputs.jurisdiction.currentState || 'MD', inputs.jurisdiction.currentCounty, inputs.jurisdiction.currentLocalTaxRate) * 100).toFixed(2)}%</strong>
                      {inputs.jurisdiction.currentCounty ? ` (${inputs.jurisdiction.currentCounty})` : ''}
                    </p>
                    <p className="text-[10px] text-slate-500 pt-1">
                      Standard state deductions, filing brackets, and retirement exemption allowances.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] text-emerald-400 font-semibold leading-normal">0.00% State Income Tax</p>
                    <p className="text-[10px] text-emerald-400 font-semibold leading-normal">
                      {(getEffectiveLocalTaxRate(inputs.jurisdiction.currentState || 'MD', inputs.jurisdiction.currentCounty, inputs.jurisdiction.currentLocalTaxRate) * 100).toFixed(2)}% Local Tax
                    </p>
                    <p className="text-[10px] text-slate-500 pt-1">
                      $0 state tax on IRA withdrawals, salaries, and capital gains.
                    </p>
                  </>
                )}
              </div>

              {/* Right: Target Jurisdiction or Continuous */}
              <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-300">
                    {inputs.jurisdiction.relocationYear !== null
                      ? `${getStateTaxProfile(inputs.jurisdiction.targetState || 'FL')?.name || inputs.jurisdiction.targetState} (${inputs.jurisdiction.targetState || 'FL'})`
                      : 'Continuous Plan'}
                  </span>
                  <span className="text-[10px] font-mono text-amber-400 font-semibold">
                    {inputs.jurisdiction.relocationYear !== null ? `Starting ${inputs.jurisdiction.relocationYear}` : '35 Years'}
                  </span>
                </div>
                {inputs.jurisdiction.relocationYear !== null ? (
                  getStateTaxProfile(inputs.jurisdiction.targetState || 'FL')?.hasIncomeTax ? (
                    <>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        State income tax rate: <strong>Up to {((getStateTaxProfile(inputs.jurisdiction.targetState || 'FL')?.topRate ?? 0) * 100).toFixed(2)}%</strong>
                      </p>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        Destination local tax: <strong>{(getEffectiveLocalTaxRate(inputs.jurisdiction.targetState || 'FL', inputs.jurisdiction.targetCounty, inputs.jurisdiction.targetLocalTaxRate) * 100).toFixed(2)}%</strong>
                        {inputs.jurisdiction.targetCounty ? ` (${inputs.jurisdiction.targetCounty})` : ''}
                      </p>
                      <p className="text-[10px] text-slate-500 pt-1">
                        State tax begins in calendar year {inputs.jurisdiction.relocationYear}.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] text-emerald-400 font-semibold leading-normal">0.00% State Income Tax</p>
                      <p className="text-[10px] text-emerald-400 font-semibold leading-normal">0.00% Local County Tax</p>
                      <p className="text-[10px] text-slate-500 pt-1">
                        Full zero state income tax transition starting in {inputs.jurisdiction.relocationYear}.
                      </p>
                    </>
                  )
                ) : (
                  <p className="text-[10px] text-slate-400 leading-relaxed pt-1">
                    Continuous residency models no state relocation over the simulated horizon. Enable relocation above to test migration savings.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION: HEALTHCARE & MEDICARE */}
      {activeSection === 'params-healthcare' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <HeartPulse className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100">Healthcare & Medicare</h2>
                <p className="text-[11px] text-slate-400">Pre-65 health insurance premiums, Medicare Part B/D, Medigap supplement plans & IRMAA surcharges</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Primary User Healthcare Inline Card */}
            <PersonHealthcareInlineCard
              personKey="you"
              name={inputs.you.name || 'Primary User'}
              birthDate={inputs.you.birthDate}
              birthYear={yourBirthYear}
              plannedRetirementAge={inputs.you.plannedRetirementAge}
              plannedRetirementMonth={inputs.you.plannedRetirementMonth}
              healthcareConfig={inputs.you.healthcare}
              healthcareInflationRate={inputs.growthAssumptions.healthcareInflationRate}
              currentState={inputs.jurisdiction.currentState}
              targetState={inputs.jurisdiction.targetState}
              relocationYear={inputs.jurisdiction.relocationYear}
              startYear={simStartYear}
              accentColor="emerald"
              onChange={(config) => updateNestedState('you', 'healthcare', config)}
            />

            {/* Spouse Healthcare Inline Card */}
            {!inputs.isSingleFiler ? (
              <PersonHealthcareInlineCard
                personKey="wife"
                name={inputs.wife.name || 'Spouse'}
                birthDate={inputs.wife.birthDate}
                birthYear={wifeBirthYear}
                plannedRetirementAge={inputs.wife.plannedRetirementAge}
                plannedRetirementMonth={inputs.wife.plannedRetirementMonth}
                healthcareConfig={inputs.wife.healthcare}
                healthcareInflationRate={inputs.growthAssumptions.healthcareInflationRate}
                currentState={inputs.jurisdiction.currentState}
                targetState={inputs.jurisdiction.targetState}
                relocationYear={inputs.jurisdiction.relocationYear}
                startYear={simStartYear}
                accentColor="teal"
                onChange={(config) => updateNestedState('wife', 'healthcare', config)}
              />
            ) : (
              <div className="glass-panel bg-slate-900/40 border border-slate-800/60 rounded-2xl p-5 flex flex-col items-center justify-center text-center space-y-3 min-h-[220px]">
                <div className="p-3 bg-slate-800/40 rounded-full text-slate-500">
                  <HeartPulse className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-300">Single Filer Mode</h4>
                  <p className="text-[11px] text-slate-500 max-w-xs mt-1">
                    Spouse healthcare configuration is disabled because the plan filing status is set to Single Filer.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Healthcare Modeling & Transition Rules Card */}
          <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Healthcare Modeling & Transition Rules</h3>
                  <p className="text-[10px] text-slate-400">Medicare transition rules, escalation notes & cashflow mechanics</p>
                </div>
              </div>
            </div>

            <div className="bg-slate-950/50 p-4 rounded-xl border border-slate-800/80 space-y-2 text-xs text-slate-400">
              <span className="font-semibold text-slate-200 block">How Healthcare Cashflows Flow into the Simulation</span>
              <ul className="list-disc list-inside space-y-1.5 text-[11px] text-slate-400">
                <li>
                  <strong className="text-slate-300">Healthcare Cost Inflation:</strong> Controlled globally in <strong className="text-emerald-400">Monte Carlo Analysis &rarr; Model Estimation Config Panel</strong> (Active rate: <span className="font-mono text-emerald-400 font-bold">{(Math.round((inputs.growthAssumptions.healthcareInflationRate * 100 + Number.EPSILON) * 100) / 100)}%</span>/yr).
                </li>
                <li><strong className="text-slate-300">Pre-65 / Pre-Medicare:</strong> Uses itemized state plan premiums + out-of-pocket costs, or flat rate.</li>
                <li><strong className="text-slate-300">Medicare Transition:</strong> Switches to Medicare Part B + Part D + Medigap Supplement when turning 65 or on your specified start date.</li>
                <li><strong className="text-slate-300">IRMAA Surcharges:</strong> Evaluated dynamically based on MAGI from 2 years prior on tax returns.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: ACCOUNTS & BALANCES */}
      {activeSection === 'params-accounts' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100">Accounts & Balances</h2>
                <p className="text-[11px] text-slate-400">Pre-tax Traditional IRAs, Roth accounts, taxable brokerage & cash reserves</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Primary User Accounts */}
            <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                    <Wallet className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      {inputs.you.name || 'Primary User'} Account Balances
                    </h3>
                    <p className="text-[10px] text-slate-400">Pre-tax IRAs, Roth accounts & cash reserves</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400 font-medium">Pre-Tax Traditional IRA / 401(k)</label>
                  <NumericInput
                    value={inputs.portfolio.yourPreTaxIRA}
                    onChange={(val) => updateNestedState('portfolio', 'yourPreTaxIRA', val ?? 0)}
                    prefix="$"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-400 font-medium">Roth IRA</label>
                  <NumericInput
                    value={inputs.portfolio.yourRothIRA}
                    onChange={(val) => updateNestedState('portfolio', 'yourRothIRA', val ?? 0)}
                    prefix="$"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 font-medium">Taxable Brokerage</label>
                    <NumericInput
                      value={inputs.portfolio.yourTaxableBrokerage}
                      onChange={(val) => updateNestedState('portfolio', 'yourTaxableBrokerage', val ?? 0)}
                      prefix="$"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 font-medium">Taxable Cost Basis</label>
                    <NumericInput
                      value={inputs.portfolio.yourTaxableBasis}
                      onChange={(val) => updateNestedState('portfolio', 'yourTaxableBasis', val ?? 0)}
                      prefix="$"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-400 font-medium">Cash Reserve</label>
                  <NumericInput
                    value={inputs.portfolio.yourCash}
                    onChange={(val) => updateNestedState('portfolio', 'yourCash', val ?? 0)}
                    prefix="$"
                  />
                </div>
              </div>
            </div>

            {/* Spouse Accounts */}
            {!inputs.isSingleFiler && (
              <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-teal-500/20 text-teal-400">
                      <Wallet className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-100">
                        {inputs.wife.name || 'Spouse'} Account Balances
                      </h3>
                      <p className="text-[10px] text-slate-400">Pre-tax IRAs, Roth accounts & cash reserves</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 font-medium">Pre-Tax Traditional IRA / 401(k)</label>
                    <NumericInput
                      value={inputs.portfolio.wifePreTaxIRA}
                      onChange={(val) => updateNestedState('portfolio', 'wifePreTaxIRA', val ?? 0)}
                      prefix="$"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 font-medium">Roth IRA</label>
                    <NumericInput
                      value={inputs.portfolio.wifeRothIRA}
                      onChange={(val) => updateNestedState('portfolio', 'wifeRothIRA', val ?? 0)}
                      prefix="$"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-slate-400 font-medium">Taxable Brokerage</label>
                      <NumericInput
                        value={inputs.portfolio.wifeTaxableBrokerage}
                        onChange={(val) => updateNestedState('portfolio', 'wifeTaxableBrokerage', val ?? 0)}
                        prefix="$"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-slate-400 font-medium">Taxable Cost Basis</label>
                      <NumericInput
                        value={inputs.portfolio.wifeTaxableBasis}
                        onChange={(val) => updateNestedState('portfolio', 'wifeTaxableBasis', val ?? 0)}
                        prefix="$"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 font-medium">Cash Reserve</label>
                    <NumericInput
                      value={inputs.portfolio.wifeCash}
                      onChange={(val) => updateNestedState('portfolio', 'wifeCash', val ?? 0)}
                      prefix="$"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Taxable Brokerage Yield & Dividend Characteristics */}
          <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
                  <Percent className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Taxable Brokerage Yield & Dividends</h3>
                  <p className="text-[10px] text-slate-400">Annual dividend distributions & non-qualified tax treatment</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-400 font-medium">Taxable Annual Dividend Yield</label>
                <NumericInput
                  value={inputs.portfolio.taxableDividendYield != null ? inputs.portfolio.taxableDividendYield * 100 : 2.0}
                  onChange={(val) => updateNestedState('portfolio', 'taxableDividendYield', val !== null ? val / 100 : 0.02)}
                  suffix="%"
                  allowDecimals
                  step={0.1}
                />
                <span className="text-[10px] text-slate-500">Annual dividend distribution rate from taxable stocks</span>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400 font-medium">Non-Qualified Dividend Portion</label>
                <NumericInput
                  value={inputs.portfolio.taxableNonQualifiedPortion != null ? inputs.portfolio.taxableNonQualifiedPortion * 100 : 15.0}
                  onChange={(val) => updateNestedState('portfolio', 'taxableNonQualifiedPortion', val !== null ? val / 100 : 0.15)}
                  suffix="%"
                  allowDecimals
                  step={1}
                />
                <span className="text-[10px] text-slate-500">Portion taxed at ordinary rates vs preferential LTCG</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: LIVING EXPENSES & BUDGET */}
      {activeSection === 'params-expenses' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <Flame className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100">Living Expenses & Budget</h2>
                <p className="text-[11px] text-slate-400">Annual baseline living expenses and detailed itemized catalog manager</p>
              </div>
            </div>
          </div>

          {/* Annual Living Expenses Mode */}
          <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <Flame className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Annual Living Expenses Budget</h3>
                  <p className="text-[10px] text-slate-400">Baseline living budget or detailed itemized catalog manager</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateNestedState('useDetailedExpenses', '', false)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                    !inputs.useDetailedExpenses
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  Simple Living Budget
                </button>
                <button
                  type="button"
                  onClick={() => updateNestedState('useDetailedExpenses', '', true)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                    inputs.useDetailedExpenses
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  Detailed Itemized Expenses
                </button>
              </div>
            </div>

            {!inputs.useDetailedExpenses ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400 font-medium">Annual Baseline Living Expenses</label>
                  <NumericInput
                    value={inputs.annualLivingExpenses}
                    onChange={(val) => updateNestedState('annualLivingExpenses', '', val ?? 100000)}
                    prefix="$"
                  />
                  <span className="text-[10px] text-slate-500">
                    Gross annual living spending baseline (excluding income taxes and Medicare premiums).
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-slate-200 block">Itemized Expense Catalog Active</span>
                    <span className="text-[10px] text-slate-400">
                      {getStateTaxProfile(inputs.jurisdiction.currentState || 'MD')?.name || inputs.jurisdiction.currentState}: {formatCurrency(mdMonthlySum * 12)}/yr (${Math.round(mdMonthlySum).toLocaleString()}/mo)
                      {inputs.jurisdiction.relocationYear !== null && inputs.jurisdiction.targetState !== inputs.jurisdiction.currentState && (
                        ` • ${getStateTaxProfile(inputs.jurisdiction.targetState)?.name || inputs.jurisdiction.targetState}: ${formatCurrency(flMonthlySum * 12)}/yr (${Math.round(flMonthlySum).toLocaleString()}/mo)`
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowExpensesDialog(true)}
                    className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    Open Detailed Expenses Manager
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION: CHARITABLE GIVING & QCD */}
      {activeSection === 'params-charity' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <HeartHandshake className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100">Charitable Giving & QCD</h2>
                <p className="text-[11px] text-slate-400">Portfolio tithe engine, annual cash floors & Qualified Charitable Distributions</p>
              </div>
            </div>
          </div>

          <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <CharityControlPanel
              settings={inputs.charitySettings}
              onChange={(newSettings) => updateNestedState('charitySettings', '', newSettings)}
              yourAge={simStartYear - yourBirthYear}
              wifeAge={simStartYear - wifeBirthYear}
              isSingleFiler={inputs.isSingleFiler}
            />
          </div>
        </div>
      )}

      {/* SECTION 5: BACKUP & PORTABILITY */}
      {activeSection === 'params-data' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100">Backup & Portability</h2>
                <p className="text-[11px] text-slate-400">Export and import scenario state, generate executive PDF reports & Excel simulation ledgers</p>
              </div>
            </div>
          </div>

          <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Backup, Export & Reports</h3>
                  <p className="text-[10px] text-slate-400">Plan state backup, executive PDF reports & Excel ledger exports</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-400">
              Export and import your complete plan configuration, generate executive PDF reports, or download the 35-year simulation ledger as an Excel spreadsheet.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-2">
              <button
                type="button"
                onClick={() => setExportDialogFormat('json')}
                className="flex flex-col items-center justify-center p-4 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 rounded-xl transition-all cursor-pointer group text-center space-y-2"
              >
                <Download className="w-6 h-6 text-emerald-400 group-hover:scale-110 transition-transform" />
                <div>
                  <span className="text-xs font-bold block text-slate-100">Export Plan JSON</span>
                  <span className="text-[10px] text-slate-500">Save full scenario state</span>
                </div>
              </button>

              <label
                htmlFor="workspace-plan-input"
                className="flex flex-col items-center justify-center p-4 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 rounded-xl transition-all cursor-pointer group text-center space-y-2"
              >
                <Upload className="w-6 h-6 text-teal-400 group-hover:scale-110 transition-transform" />
                <div>
                  <span className="text-xs font-bold block text-slate-100">Import Plan JSON</span>
                  <span className="text-[10px] text-slate-500">Restore saved file</span>
                </div>
              </label>
              <input
                type="file"
                id="workspace-plan-input"
                accept=".json"
                onChange={handleImportJSON}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => setExportDialogFormat('pdf')}
                className="flex flex-col items-center justify-center p-4 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 rounded-xl transition-all cursor-pointer group text-center space-y-2"
              >
                <FileText className="w-6 h-6 text-indigo-400 group-hover:scale-110 transition-transform" />
                <div>
                  <span className="text-xs font-bold block text-slate-100">Executive PDF Report</span>
                  <span className="text-[10px] text-slate-500">Detailed printable plan</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setExportDialogFormat('excel')}
                className="flex flex-col items-center justify-center p-4 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 rounded-xl transition-all cursor-pointer group text-center space-y-2"
              >
                <FileSpreadsheet className="w-6 h-6 text-emerald-400 group-hover:scale-110 transition-transform" />
                <div>
                  <span className="text-xs font-bold block text-slate-100">Excel Simulation Ledger</span>
                  <span className="text-[10px] text-slate-500">35-year cashflows .xlsx</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 6: RESET PLAN */}
      {activeSection === 'params-reset' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
                <RefreshCw className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-100">Reset Plan</h2>
                <p className="text-[11px] text-slate-400">Restart onboarding wizard or restore initial default plan configuration</p>
              </div>
            </div>
          </div>

          <div className="glass-panel bg-slate-900/80 border border-rose-950/40 rounded-2xl p-5 space-y-4 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400">
                  <RefreshCw className="w-4 h-4 animate-spin" style={{ animationDuration: '6s' }} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-rose-400">Danger Zone: Reset Plan & Configuration</h3>
                  <p className="text-[10px] text-slate-400">Restore initial factory defaults and restart onboarding wizard</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Resetting your plan will restore all personal profiles, portfolio balances, return assumptions, and living expenses back to initial defaults and launch the guided onboarding wizard.
            </p>

            {!showResetConfirm ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onChange(JSON.parse(JSON.stringify(SAMPLE_DEMO_PLAN)))}
                  className="px-5 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2"
                  title="Overwrite current inputs with realistic sample demonstration plan for testing"
                >
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <span>Load Sample Demo Plan</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(true)}
                  className="px-5 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Reset Plan Configuration
                </button>
              </div>
            ) : (
              <div className="p-4 bg-rose-950/20 border border-rose-900/40 rounded-xl space-y-3 max-w-md">
                <span className="text-xs text-slate-200 font-semibold block">
                  Are you absolutely sure? This action cannot be undone.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowResetConfirm(false);
                      onReset();
                    }}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    Yes, Reset Everything
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dialogs */}
      {showExpensesDialog && (
        <DetailedExpensesDialog
          isOpen={showExpensesDialog}
          onClose={() => setShowExpensesDialog(false)}
          currentState={inputs.jurisdiction.currentState}
          targetState={inputs.jurisdiction.targetState}
          relocationYear={inputs.jurisdiction.relocationYear}
          simStartYear={simStartYear}
          detailedExpenses={inputs.detailedExpenses}
          onSave={(expenses) => updateNestedState('detailedExpenses', '', expenses)}
          youHealthcare={inputs.you.healthcare}
          wifeHealthcare={inputs.wife.healthcare}
          isSingleFiler={inputs.isSingleFiler}
          onNavigateToHealthcare={() => {
            setShowExpensesDialog(false);
            onNavigateSection?.('params-healthcare');
          }}
        />
      )}

      {exportDialogFormat && (
        <ExportPlanDialog
          isOpen={exportDialogFormat !== null}
          onClose={() => setExportDialogFormat(null)}
          inputs={inputs}
          simulateSurvivor={simulateSurvivor}
          savedPlans={savedPlans}
          ledger={ledger}
          initialFormat={exportDialogFormat}
        />
      )}
    </div>
  );
};
