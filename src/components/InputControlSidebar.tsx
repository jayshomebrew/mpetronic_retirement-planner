import React, { useState, useRef, useMemo } from 'react';
import { AppStateInputs, SimulationResultRow, getSimulationStartYear, normalizeDetailedExpenses } from '../types';
import {
  User,
  TrendingUp,
  Coins,
  MapPin,
  Flame,
  DollarSign,
  Calendar,
  Pencil,
  Check,
  RefreshCw,
  Info,
  Settings,
  HelpCircle,
  Heart,
  Download,
  Upload,
  FileText,
  FileSpreadsheet,
  X
} from 'lucide-react';
import { DetailedExpensesDialog } from './DetailedExpensesDialog';
import { HealthcareConfigDialog } from './HealthcareConfigDialog';
import { CharityControlPanel } from './CharityControlPanel';
import { ExportPlanDialog } from './ExportPlanDialog';
import { ExportFormatType } from '../utils/exportHelpers';
import { AboutDialog } from './AboutDialog';
import { DocumentationDialog } from './DocumentationDialog';
import { getVersionInfo } from '../utils/version';
import { NumericInput } from './NumericInput';
import { RangeSlider } from './RangeSlider';

const getBirthMonth = (dateStr: string | undefined): number => {
  if (!dateStr) return 1;
  const parts = dateStr.split('-');
  if (parts.length < 2) return 1;
  const m = parseInt(parts[1], 10);
  return isNaN(m) ? 1 : m;
};

interface InputControlSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  inputs: AppStateInputs;
  onChange: (newInputs: AppStateInputs) => void;
  onReset: () => void;
  useTodayDollars: boolean;
  setUseTodayDollars: (val: boolean) => void;
  globalScenario: 'flat' | 'p10' | 'p50' | 'p90';
  simulateSurvivor: boolean;
  setSimulateSurvivor: (val: boolean) => void;
  ledger: SimulationResultRow[];
  globalFontSize: number;
  setGlobalFontSize: (val: number) => void;
  onNavigateTab?: (tabIndex: number) => void;
  onOpenDocumentation?: (sectionId?: string) => void;
}

export const InputControlSidebar: React.FC<InputControlSidebarProps> = ({
  isOpen = true,
  onClose,
  inputs,
  onChange,
  onReset,
  useTodayDollars,
  setUseTodayDollars,
  globalScenario,
  simulateSurvivor,
  setSimulateSurvivor,
  ledger,
  globalFontSize,
  setGlobalFontSize,
  onNavigateTab,
  onOpenDocumentation,
}) => {
  const [activeTab, setActiveTab] = useState<'profiles' | 'portfolio' | 'assumptions' | 'expenses'>('profiles');
  const [isEditingYou, setIsEditingYou] = useState(false);
  const [tempYouName, setTempYouName] = useState(inputs.you.name || '');
  const [isEditingWife, setIsEditingWife] = useState(false);
  const [tempWifeName, setTempWifeName] = useState(inputs.wife.name || '');
  const [showExpensesDialog, setShowExpensesDialog] = useState(false);
  const [editingHealthcarePerson, setEditingHealthcarePerson] = useState<'you' | 'wife' | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDisplaySettings, setShowDisplaySettings] = useState(false);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [exportDialogFormat, setExportDialogFormat] = useState<ExportFormatType | null>(null);
  const versionInfo = useMemo(() => getVersionInfo(), []);
  const simStartYear = getSimulationStartYear(inputs);

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) return;
        const parsed = JSON.parse(text) as AppStateInputs;

        // Validation check
        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.you &&
          parsed.portfolio &&
          parsed.growthAssumptions
        ) {
          const cleaned = {
            ...parsed,
            isConfigured: true
          };
          if (typeof parsed.simulateSurvivor === 'boolean') {
            setSimulateSurvivor(parsed.simulateSurvivor);
          }
          onChange(cleaned);
        } else {
          alert('Invalid plan configuration file. Please ensure the file is a valid JSON exported from this app.');
        }
      } catch (err) {
        console.error("Import plan failed:", err);
        alert('Failed to parse the file. Please ensure it is a valid JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset file input
  };



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

  const yourBirthYear = React.useMemo(() => {
    if (!inputs.you.birthDate) return 1960;
    const year = parseInt(inputs.you.birthDate.split('-')[0], 10);
    return isNaN(year) ? 1960 : year;
  }, [inputs.you.birthDate]);

  const wifeBirthYear = React.useMemo(() => {
    if (!inputs.wife.birthDate) return 1964;
    const year = parseInt(inputs.wife.birthDate.split('-')[0], 10);
    return isNaN(year) ? 1964 : year;
  }, [inputs.wife.birthDate]);
  // Remembers the last non-null relocation year so toggling off then back on restores it.
  const lastRelocationYear = useRef<number>(inputs.jurisdiction.relocationYear ?? 2032);
  const updateNestedState = (
    category: keyof AppStateInputs | 'you' | 'wife' | 'jurisdiction' | 'growthAssumptions' | 'portfolio',
    field: string,
    value: unknown
  ) => {
    const updated = { ...inputs };
    if (category === 'you' || category === 'wife') {
      updated[category] = { ...updated[category], [field]: value };
    } else if (category === 'jurisdiction') {
      updated.jurisdiction = { ...updated.jurisdiction, [field]: value };
    } else if (category === 'growthAssumptions') {
      updated.growthAssumptions = { ...updated.growthAssumptions, [field]: value };
    } else if (category === 'portfolio') {
      updated.portfolio = { ...updated.portfolio, [field]: value };
    } else {
      (updated as Record<string, unknown>)[category] = value;
    }
    onChange(updated);
  };

  const formatCurrency = (val: number | null | undefined) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val || 0);
  };

  const formatPercent = (val: number) => {
    const rounded = Math.round((val * 100 + Number.EPSILON) * 100) / 100;
    return `${rounded}%`;
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over Drawer Panel */}
      <aside className="relative z-50 w-full max-w-md bg-slate-900 border-l border-slate-800 flex flex-col h-full overflow-y-auto custom-scrollbar shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Sidebar Sticky Header & Tab Strip */}
        <div className="border-b border-slate-800 bg-slate-900/90 sticky top-0 backdrop-blur-md z-10">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Flame className="w-5 h-5 text-emerald-500 animate-pulse shrink-0" />
              <div>
                <h1 className="text-base font-bold bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent">
                  Scenario Planner
                </h1>
                <p className="text-[10px] text-slate-400">Configure parameters in real-time</p>
              </div>
            </div>

            {/* Header Action Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowAboutDialog(true)}
                className="p-1.5 bg-slate-950/60 hover:bg-slate-800/80 text-slate-400 hover:text-emerald-400 border border-slate-800 hover:border-slate-700/60 rounded-xl transition-all cursor-pointer flex items-center justify-center group"
                title={`About Retirement Planner (${versionInfo.displayVersion})`}
              >
                <Info className="w-4 h-4 text-slate-400 group-hover:text-emerald-400" />
              </button>
              <button
                type="button"
                onClick={() => setShowDisplaySettings(true)}
                className="p-1.5 bg-slate-950/60 hover:bg-slate-800/80 text-slate-400 hover:text-slate-100 border border-slate-800 hover:border-slate-700/60 rounded-xl transition-all cursor-pointer flex items-center justify-center"
                title="Display & Font Size Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 bg-slate-950/60 hover:bg-slate-800 hover:text-white text-slate-400 border border-slate-800 hover:border-slate-700 rounded-xl transition-all cursor-pointer flex items-center justify-center"
                  title="Close parameters drawer (Esc or P)"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Category Tabs Strip */}
          <div className="px-3 pb-3">
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setActiveTab('profiles')}
                className={`flex-1 flex items-center justify-center gap-1 text-[10px] py-1.5 px-1 rounded-lg font-bold transition-all border ${
                  activeTab === 'profiles'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-sm'
                    : 'bg-transparent text-slate-400 hover:text-slate-200 border-transparent'
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>Profiles</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('portfolio')}
                className={`flex-1 flex items-center justify-center gap-1 text-[10px] py-1.5 px-1 rounded-lg font-bold transition-all border ${
                  activeTab === 'portfolio'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-sm'
                    : 'bg-transparent text-slate-400 hover:text-slate-200 border-transparent'
                }`}
              >
                <Coins className="w-3.5 h-3.5" />
                <span>Accounts</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('assumptions')}
                className={`flex-1 flex items-center justify-center gap-1 text-[10px] py-1.5 px-1 rounded-lg font-bold transition-all border ${
                  activeTab === 'assumptions'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-sm'
                    : 'bg-transparent text-slate-400 hover:text-slate-200 border-transparent'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Assumptions</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('expenses')}
                className={`flex-1 flex items-center justify-center gap-1 text-[10px] py-1.5 px-1 rounded-lg font-bold transition-all border ${
                  activeTab === 'expenses'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-sm'
                    : 'bg-transparent text-slate-400 hover:text-slate-200 border-transparent'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span>Expenses</span>
              </button>
            </div>
          </div>
        </div>

      <div className="p-4 space-y-5 flex-1">
        {/* TAB 1: PROFILES */}
        {activeTab === 'profiles' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold border-b border-slate-800 pb-2">
                <User className="w-5 h-5" />
                <h2>Spouse Profiles</h2>
              </div>

              {/* Primary User (You) */}
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
                {isEditingYou ? (
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center gap-1.5 flex-1">
                      <span className="text-xs text-slate-400 font-bold uppercase whitespace-nowrap">Primary User:</span>
                      <input
                        type="text"
                        value={tempYouName}
                        onChange={(e) => setTempYouName(e.target.value)}
                        onBlur={() => {
                          setIsEditingYou(false);
                          const trimmed = tempYouName.trim();
                          if (trimmed !== (inputs.you.name || '')) {
                            updateNestedState('you', 'name', trimmed);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            setIsEditingYou(false);
                            const trimmed = tempYouName.trim();
                            if (trimmed !== (inputs.you.name || '')) {
                              updateNestedState('you', 'name', trimmed);
                            }
                          } else if (e.key === 'Escape') {
                            setIsEditingYou(false);
                            setTempYouName(inputs.you.name || '');
                          }
                        }}
                        placeholder="Enter name"
                        autoFocus
                        className="bg-slate-900 border border-emerald-500/50 rounded px-2 py-0.5 text-xs text-slate-100 font-semibold focus:outline-none w-full focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <button
                      onClick={() => {
                        setIsEditingYou(false);
                        const trimmed = tempYouName.trim();
                        if (trimmed !== (inputs.you.name || '')) {
                          updateNestedState('you', 'name', trimmed);
                        }
                      }}
                      className="text-emerald-400 hover:text-emerald-300 p-0.5 hover:bg-slate-800 rounded transition-colors"
                      title="Save name"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex justify-between items-center">
                    <div
                      className="flex items-center gap-2 group cursor-pointer"
                      onClick={() => {
                        setTempYouName(inputs.you.name || '');
                        setIsEditingYou(true);
                      }}
                    >
                      <span className="text-sm font-semibold text-slate-200 hover:text-emerald-400 transition-colors">
                        Primary User ({inputs.you.name || 'You'})
                      </span>
                      <Pencil className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer" />
                    </div>
                    <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-emerald-400 font-mono">{yourBirthYear}</span>
                  </div>
                )}
                
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Estimated SS Monthly PIA (at Age 67)</label>
                  <NumericInput
                    prefix="$"
                    value={inputs.you.estimatedPIA}
                    onChange={(val) => updateNestedState('you', 'estimatedPIA', val)}
                    placeholder="e.g. 3000"
                  />
                </div>

                <div className="space-y-1">
                  <RangeSlider
                    min={62}
                    max={70}
                    step={1}
                    value={inputs.you.targetSSClaimingAge ?? 67}
                    onChange={(val) => updateNestedState('you', 'targetSSClaimingAge', val)}
                    renderLabel={(val) => (
                      <label className="text-xs text-slate-400 flex justify-between">
                        <span>Target Social Security Claiming Age</span>
                        <span className="text-emerald-400 font-bold font-mono">Age {val}</span>
                      </label>
                    )}
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono px-1">
                    <span>62 (Reduced)</span>
                    <span>67 (FRA)</span>
                    <span>70 (Max)</span>
                  </div>
                </div>

                {/* Planned Retirement — single slider stepping by month */}
                <div className="space-y-2 pt-1 border-t border-slate-800/30">
                  <div className="space-y-1">
                    {(() => {
                      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                      const age = inputs.you.plannedRetirementAge ?? 67;
                      const mon = inputs.you.plannedRetirementMonth ?? getBirthMonth(inputs.you.birthDate);
                      const sliderVal = (age - 55) * 12 + (mon - 1);
                      return (
                        <>
                          <RangeSlider
                            min={0}
                            max={239}
                            step={1}
                            value={sliderVal}
                            onChange={(v) => {
                              const newAge = 55 + Math.floor(v / 12);
                              const newMon = (v % 12) + 1;
                              const next = { ...inputs, you: { ...inputs.you, plannedRetirementAge: newAge, plannedRetirementMonth: newMon } };
                              onChange(next);
                            }}
                            renderLabel={(v) => {
                              const newAge = 55 + Math.floor(v / 12);
                              const newMon = (v % 12) + 1;
                              return (
                                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                                  <span>Retire Age</span>
                                  <span className="text-emerald-400 font-mono font-semibold">
                                    Age {newAge} · {MONTHS[newMon - 1]}
                                  </span>
                                </label>
                              );
                            }}
                            className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-emerald-500"
                          />
                          <div className="flex justify-between text-[10px] text-slate-500 font-mono px-0.5">
                            <span>55</span>
                            <span>60</span>
                            <span>65</span>
                            <span>70</span>
                            <span>75</span>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Salary</label>
                    <NumericInput
                      prefix="$"
                      value={inputs.you.activeSalary}
                      onChange={(val) => updateNestedState('you', 'activeSalary', val)}
                      placeholder="e.g. 150000"
                    />
                  </div>
                  <div className="space-y-1 pt-1.5 border-t border-slate-800/30">
                    <RangeSlider
                      min={50}
                      max={110}
                      step={1}
                      value={inputs.you.longevityAge ?? 85}
                      onChange={(val) => updateNestedState('you', 'longevityAge', val)}
                      renderLabel={(val) => (
                        <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                          <span>Longevity Age</span>
                          <span className="text-emerald-400 font-mono font-semibold">Age {val}</span>
                        </label>
                      )}
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono px-0.5">
                      <span>50</span>
                      <span>80</span>
                      <span>95</span>
                      <span>110</span>
                    </div>
                  </div>
                </div>

                {/* Healthcare Planning Dialog Trigger */}
                <div className="pt-2 border-t border-slate-800/30">
                  <button
                    type="button"
                    onClick={() => setEditingHealthcarePerson('you')}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-slate-100 rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
                    <Heart className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Configure Health Expenses</span>
                  </button>
                </div>
              </div>

              {/* Spouse Profile */}
              {!inputs.isSingleFiler && (
                <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
                  {isEditingWife ? (
                    <div className="flex justify-between items-center gap-2">
                      <div className="flex items-center gap-1.5 flex-1">
                        <span className="text-xs text-slate-400 font-bold uppercase whitespace-nowrap">Spouse:</span>
                        <input
                          type="text"
                          value={tempWifeName}
                          onChange={(e) => setTempWifeName(e.target.value)}
                          onBlur={() => {
                            setIsEditingWife(false);
                            const trimmed = tempWifeName.trim();
                            if (trimmed !== (inputs.wife.name || '')) {
                              updateNestedState('wife', 'name', trimmed);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              setIsEditingWife(false);
                              const trimmed = tempWifeName.trim();
                              if (trimmed !== (inputs.wife.name || '')) {
                                updateNestedState('wife', 'name', trimmed);
                              }
                            } else if (e.key === 'Escape') {
                              setIsEditingWife(false);
                              setTempWifeName(inputs.wife.name || '');
                            }
                          }}
                          placeholder="Enter name"
                          autoFocus
                          className="bg-slate-900 border border-emerald-500/50 rounded px-2 py-0.5 text-xs text-slate-100 font-semibold focus:outline-none w-full focus:ring-1 focus:ring-emerald-500"
                        />
                      </div>
                      <button
                        onClick={() => {
                          setIsEditingWife(false);
                          const trimmed = tempWifeName.trim();
                          if (trimmed !== (inputs.wife.name || '')) {
                            updateNestedState('wife', 'name', trimmed);
                          }
                        }}
                        className="text-emerald-400 hover:text-emerald-300 p-0.5 hover:bg-slate-800 rounded transition-colors"
                        title="Save name"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center">
                      <div
                        className="flex items-center gap-2 group cursor-pointer"
                        onClick={() => {
                          setTempWifeName(inputs.wife.name || '');
                          setIsEditingWife(true);
                        }}
                      >
                        <span className="text-sm font-semibold text-slate-200 hover:text-emerald-400 transition-colors">
                          Spouse ({inputs.wife.name || 'Spouse'})
                        </span>
                        <Pencil className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer" />
                      </div>
                      <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-emerald-400 font-mono">{wifeBirthYear}</span>
                    </div>
                  )}
                  
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400">Estimated SS Monthly PIA (at Age 67)</label>
                    <NumericInput
                      prefix="$"
                      value={inputs.wife.estimatedPIA}
                      onChange={(val) => updateNestedState('wife', 'estimatedPIA', val)}
                      placeholder="e.g. 2800"
                    />
                  </div>

                  <div className="space-y-1">
                    <RangeSlider
                      min={62}
                      max={70}
                      step={1}
                      value={inputs.wife.targetSSClaimingAge ?? 67}
                      onChange={(val) => updateNestedState('wife', 'targetSSClaimingAge', val)}
                      renderLabel={(val) => (
                        <label className="text-xs text-slate-400 flex justify-between">
                          <span>Target Social Security Claiming Age</span>
                          <span className="text-emerald-400 font-bold font-mono">Age {val}</span>
                        </label>
                      )}
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono px-1">
                      <span>62 (Reduced)</span>
                      <span>67 (FRA)</span>
                      <span>70 (Max)</span>
                    </div>
                  </div>

                  {/* Planned Retirement — single slider stepping by month */}
                  <div className="space-y-2 pt-1 border-t border-slate-800/30">
                    <div className="space-y-1">
                      {(() => {
                        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                        const age = inputs.wife.plannedRetirementAge ?? 67;
                        const mon = inputs.wife.plannedRetirementMonth ?? getBirthMonth(inputs.wife.birthDate);
                        const sliderVal = (age - 55) * 12 + (mon - 1);
                        return (
                          <>
                            <RangeSlider
                              min={0}
                              max={239}
                              step={1}
                              value={sliderVal}
                              onChange={(v) => {
                                const newAge = 55 + Math.floor(v / 12);
                                const newMon = (v % 12) + 1;
                                const next = { ...inputs, wife: { ...inputs.wife, plannedRetirementAge: newAge, plannedRetirementMonth: newMon } };
                                onChange(next);
                              }}
                              renderLabel={(v) => {
                                const newAge = 55 + Math.floor(v / 12);
                                const newMon = (v % 12) + 1;
                                return (
                                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                                    <span>Retire Age</span>
                                    <span className="text-emerald-400 font-mono font-semibold">
                                      Age {newAge} · {MONTHS[newMon - 1]}
                                    </span>
                                  </label>
                                );
                              }}
                              className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-emerald-500"
                            />
                            <div className="flex justify-between text-[10px] text-slate-500 font-mono px-0.5">
                              <span>55</span>
                              <span>60</span>
                              <span>65</span>
                              <span>70</span>
                              <span>75</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Salary</label>
                      <NumericInput
                        prefix="$"
                        value={inputs.wife.activeSalary}
                        onChange={(val) => updateNestedState('wife', 'activeSalary', val)}
                        placeholder="e.g. 100000"
                      />
                    </div>
                    <div className="space-y-1 pt-1.5 border-t border-slate-800/30">
                      <RangeSlider
                        min={50}
                        max={110}
                        step={1}
                        value={inputs.wife.longevityAge ?? 95}
                        onChange={(val) => updateNestedState('wife', 'longevityAge', val)}
                        renderLabel={(val) => (
                          <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                            <span>Longevity Age</span>
                            <span className="text-emerald-400 font-mono font-semibold">Age {val}</span>
                          </label>
                        )}
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 font-mono px-0.5">
                        <span>50</span>
                        <span>80</span>
                        <span>95</span>
                        <span>110</span>
                      </div>
                    </div>
                  </div>

                  {/* Healthcare Planning Dialog Trigger */}
                  <div className="pt-2 border-t border-slate-800/30">
                    <button
                      type="button"
                      onClick={() => setEditingHealthcarePerson('wife')}
                      className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-slate-100 rounded-lg text-xs font-bold transition-all cursor-pointer"
                    >
                      <Heart className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Configure Health Expenses</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Survivor simulation mode toggle switch */}
            {!inputs.isSingleFiler && (
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 flex items-center justify-between">
                <div className="space-y-0.5 pr-2">
                  <label htmlFor="simulateSurvivorToggle" className="text-xs font-semibold text-slate-200 cursor-pointer block">
                    Simulate Survivor View
                  </label>
                  <span className="text-[10px] text-slate-500 block leading-normal font-sans">
                    Model compressed tax brackets and Medicare surcharges when one spouse passes away.
                  </span>
                </div>
                <input
                  type="checkbox"
                  id="simulateSurvivorToggle"
                  checked={simulateSurvivor}
                  onChange={(e) => setSimulateSurvivor(e.target.checked)}
                  className="w-4 h-4 bg-slate-900 rounded border-slate-800 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer flex-shrink-0"
                />
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ACCOUNTS & PORTFOLIO */}
        {activeTab === 'portfolio' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold border-b border-slate-800 pb-2">
              <Coins className="w-5 h-5" />
              <h2>Starting Account Balances ({simStartYear})</h2>
            </div>

            {/* Primary User Starting Balances */}
            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
              <span className="text-xs font-bold text-slate-200 block border-b border-slate-800/40 pb-1">
                Primary User ({inputs.you.name || 'You'})
              </span>
              
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block truncate" title="Traditional IRA">Traditional IRA</label>
                  <NumericInput
                    prefix="$"
                    value={inputs.portfolio.yourPreTaxIRA}
                    onChange={(val) => updateNestedState('portfolio', 'yourPreTaxIRA', val)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block truncate" title="Roth IRA Balance">Roth IRA</label>
                  <NumericInput
                    prefix="$"
                    value={inputs.portfolio.yourRothIRA}
                    onChange={(val) => updateNestedState('portfolio', 'yourRothIRA', val)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block truncate" title="Brokerage Assets (Taxable)">Brokerage Assets</label>
                  <NumericInput
                    prefix="$"
                    value={inputs.portfolio.yourTaxableBrokerage}
                    onChange={(val) => updateNestedState('portfolio', 'yourTaxableBrokerage', val)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block truncate" title="Brokerage Cost Basis">Cost Basis</label>
                  <NumericInput
                    prefix="$"
                    value={inputs.portfolio.yourTaxableBasis}
                    onChange={(val) => updateNestedState('portfolio', 'yourTaxableBasis', val)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block truncate" title="Cash Assets Balance">Cash Assets</label>
                  <NumericInput
                    prefix="$"
                    value={inputs.portfolio.yourCash}
                    onChange={(val) => updateNestedState('portfolio', 'yourCash', val)}
                  />
                </div>
              </div>
            </div>

            {/* Spouse Starting Balances */}
            {!inputs.isSingleFiler && (
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
                <span className="text-xs font-bold text-slate-200 block border-b border-slate-800/40 pb-1">
                  Spouse ({inputs.wife.name || 'Spouse'})
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 block truncate" title="Traditional IRA">Traditional IRA</label>
                    <NumericInput
                      prefix="$"
                      value={inputs.portfolio.wifePreTaxIRA}
                      onChange={(val) => updateNestedState('portfolio', 'wifePreTaxIRA', val)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 block truncate" title="Roth IRA Balance">Roth IRA</label>
                    <NumericInput
                      prefix="$"
                      value={inputs.portfolio.wifeRothIRA}
                      onChange={(val) => updateNestedState('portfolio', 'wifeRothIRA', val)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 block truncate" title="Brokerage Assets (Taxable)">Brokerage Assets</label>
                    <NumericInput
                      prefix="$"
                      value={inputs.portfolio.wifeTaxableBrokerage}
                      onChange={(val) => updateNestedState('portfolio', 'wifeTaxableBrokerage', val)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 block truncate" title="Brokerage Cost Basis">Cost Basis</label>
                    <NumericInput
                      prefix="$"
                      value={inputs.portfolio.wifeTaxableBasis}
                      onChange={(val) => updateNestedState('portfolio', 'wifeTaxableBasis', val)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 block truncate" title="Cash Assets Balance">Cash Assets</label>
                    <NumericInput
                      prefix="$"
                      value={inputs.portfolio.wifeCash}
                      onChange={(val) => updateNestedState('portfolio', 'wifeCash', val)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Taxable Brokerage Yield & Interest settings */}
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 border-b border-slate-800 pb-1">
                <span className="text-xs font-bold text-slate-300 block">Taxable Assets Dividend Yield & Type</span>
                <div className="relative group inline-block">
                  <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 bg-slate-950 text-slate-200 text-[10px] p-2.5 rounded-lg border border-slate-800 shadow-xl z-50 leading-normal pointer-events-none normal-case font-medium">
                    <strong>Annual Yield (%)</strong>: The annual percentage of taxable brokerage assets paid out as dividends or interest. Taxed in the year received.<br /><br />
                    <strong>Non-Qualified (%)</strong>: The portion of the yield taxed at ordinary income rates (e.g., bond interest/non-qualified dividends) vs. preferential capital gains rates.
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block truncate" title="Annual Dividend/Interest Yield">Annual Yield (%)</label>
                  <NumericInput
                    suffix="%"
                    allowDecimals={true}
                    min={0}
                    max={20}
                    value={inputs.portfolio.taxableDividendYield !== null && inputs.portfolio.taxableDividendYield !== undefined ? inputs.portfolio.taxableDividendYield * 100 : null}
                    onChange={(val) => updateNestedState('portfolio', 'taxableDividendYield', val === null ? null : val / 100)}
                    placeholder="2.0"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block truncate" title="Portion of yield taxed at ordinary income rate">Non-Qualified (%)</label>
                  <NumericInput
                    suffix="%"
                    allowDecimals={true}
                    min={0}
                    max={100}
                    value={inputs.portfolio.taxableNonQualifiedPortion !== null && inputs.portfolio.taxableNonQualifiedPortion !== undefined ? inputs.portfolio.taxableNonQualifiedPortion * 100 : null}
                    onChange={(val) => updateNestedState('portfolio', 'taxableNonQualifiedPortion', val === null ? null : val / 100)}
                    placeholder="30"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ASSUMPTIONS */}
        {activeTab === 'assumptions' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Global Valuation Toggle */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold border-b border-slate-800 pb-2">
                <DollarSign className="w-5 h-5" />
                <h2>Currency Valuation</h2>
              </div>
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
                <div className="flex bg-slate-900 p-0.5 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setUseTodayDollars(false)}
                    className={`flex-1 text-[10px] py-2 rounded-lg font-bold transition-all ${
                      !useTodayDollars
                        ? 'bg-emerald-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Future Dollars (Nominal)
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseTodayDollars(true)}
                    className={`flex-1 text-[10px] py-2 rounded-lg font-bold transition-all ${
                      useTodayDollars
                        ? 'bg-emerald-500 text-slate-950 shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Today's Dollars (Real)
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 leading-normal flex items-start gap-1.5">
                  <Info className="w-4 h-4 text-emerald-500/80 flex-shrink-0 mt-0.5" />
                  <span>
                    {!useTodayDollars
                      ? "Displaying actual nominal dollar amounts including standard CPI adjustments and compounding growth."
                      : "Discounting all future balances and expenses back by the CPI inflation factor to reflect today's real purchasing power."}
                  </span>
                </p>
              </div>
            </div>

            {/* Section: Plan Timeline & Simulation Start Year */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold border-b border-slate-800 pb-2">
                <Calendar className="w-5 h-5" />
                <h2>Plan Timeline & Start Year</h2>
              </div>
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-400 font-medium">Simulation Start Year</label>
                    {simStartYear !== new Date().getFullYear() && (
                      <button
                        type="button"
                        onClick={() => updateNestedState('simulationStartYear', '', new Date().getFullYear())}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 underline cursor-pointer"
                      >
                        Reset to {new Date().getFullYear()}
                      </button>
                    )}
                  </div>
                  <NumericInput
                    min={1990}
                    max={2100}
                    value={inputs.simulationStartYear ?? simStartYear}
                    onChange={(val) => updateNestedState('simulationStartYear', '', val)}
                  />
                </div>
                <p className="text-[10px] text-slate-400 leading-normal flex items-start gap-1.5">
                  <Info className="w-4 h-4 text-emerald-500/80 flex-shrink-0 mt-0.5" />
                  <span>
                    Timeline anchor for starting balances, returns, and cash flows. Stored with the plan so it stays constant over time.
                  </span>
                </p>
              </div>
            </div>

            {/* Model Assumptions Summary */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-emerald-400 font-semibold border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  <h2>Model Growth Assumptions</h2>
                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-900 text-emerald-400 border border-slate-800 uppercase">
                    {globalScenario}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab?.(3)}
                  className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-900 rounded-lg transition-colors cursor-pointer"
                  title="Configure Model Assumptions & Allocations in Monte Carlo Analysis"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>

              <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2.5 text-xs">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 bg-slate-900/60 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block font-semibold">Stocks (Mean)</span>
                    <span className="font-mono font-bold text-slate-200">{formatPercent(inputs.growthAssumptions.equityReturnRate)}</span>
                  </div>
                  <div className="p-2 bg-slate-900/60 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block font-semibold">Bonds (Mean)</span>
                    <span className="font-mono font-bold text-slate-200">{formatPercent(inputs.growthAssumptions.fixedIncomeReturnRate)}</span>
                  </div>
                  <div className="p-2 bg-slate-900/60 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block font-semibold">CPI Inflation</span>
                    <span className="font-mono font-bold text-slate-200">{formatPercent(inputs.growthAssumptions.cpiInflationRate)}</span>
                  </div>
                  <div className="p-2 bg-slate-900/60 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] text-slate-400 block font-semibold">Healthcare Infl.</span>
                    <span className="font-mono font-bold text-slate-200">{formatPercent(inputs.growthAssumptions.healthcareInflationRate)}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/40 text-[10px] text-slate-400 flex justify-between items-center">
                  <span>Account Allocations:</span>
                  <span className="font-mono text-slate-300 font-semibold">
                    Pre-Tax {Math.round((inputs.growthAssumptions.preTaxEquityPortion ?? 0.50) * 100)}/{Math.round((1 - (inputs.growthAssumptions.preTaxEquityPortion ?? 0.50)) * 100)} · Taxable {Math.round((inputs.growthAssumptions.taxableEquityPortion ?? 0.60) * 100)}/{Math.round((1 - (inputs.growthAssumptions.taxableEquityPortion ?? 0.60)) * 100)} · Roth {Math.round((inputs.growthAssumptions.rothEquityPortion ?? 1.00) * 100)}%
                  </span>
                </div>

                <div className="pt-1 text-[10px] text-slate-400 flex justify-between items-center">
                  <span>Min Cash Reserve Floor:</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {formatCurrency(inputs.growthAssumptions.minCashReserveDollars ?? 100000)} (CPI-Indexed)
                  </span>
                </div>
              </div>
            </div>

            {/* Jurisdiction & Relocation */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold border-b border-slate-800 pb-2">
                <MapPin className="w-5 h-5" />
                <h2>Jurisdiction & Relocation</h2>
              </div>

              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Current State</label>
                    <select
                      value={inputs.jurisdiction.currentState}
                      onChange={(e) => updateNestedState('jurisdiction', 'currentState', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="MD">Maryland (MD)</option>
                      <option value="FL">Florida (FL)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Target State</label>
                    <select
                      value={inputs.jurisdiction.targetState}
                      onChange={(e) => updateNestedState('jurisdiction', 'targetState', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="FL">Florida (FL)</option>
                      <option value="MD">Maryland (MD)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-400 flex justify-between">
                    <span>Relocation Year</span>
                    <span className="text-emerald-400 font-bold font-mono">
                      {inputs.jurisdiction.relocationYear ? inputs.jurisdiction.relocationYear : 'Never Relocate'}
                    </span>
                  </label>
                  <div className="flex items-center gap-3">
                    <RangeSlider
                      min={simStartYear}
                      max={simStartYear + 34}
                      step={1}
                      disabled={inputs.jurisdiction.relocationYear === null}
                      value={inputs.jurisdiction.relocationYear ?? lastRelocationYear.current}
                      onChange={(val) => {
                        lastRelocationYear.current = val;
                        updateNestedState('jurisdiction', 'relocationYear', val);
                      }}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 disabled:opacity-30"
                    />
                    <button
                      onClick={() => {
                        const nextVal = inputs.jurisdiction.relocationYear === null
                          ? lastRelocationYear.current
                          : null;
                        if (inputs.jurisdiction.relocationYear !== null) {
                          lastRelocationYear.current = inputs.jurisdiction.relocationYear;
                        }
                        updateNestedState('jurisdiction', 'relocationYear', nextVal);
                      }}
                      className={`text-xs px-2 py-1 rounded transition-colors font-semibold ${
                        inputs.jurisdiction.relocationYear === null
                          ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {inputs.jurisdiction.relocationYear === null ? 'Enable' : 'Disable'}
                    </button>
                  </div>
                </div>
                
                <p className="text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800/40 leading-relaxed">
                  {inputs.jurisdiction.relocationYear 
                    ? `Modeling relocation from ${inputs.jurisdiction.currentState} to ${inputs.jurisdiction.targetState} in calendar year ${inputs.jurisdiction.relocationYear}.`
                    : `Active residency in ${inputs.jurisdiction.currentState} remains unchanged for the entire 35-year timeline.`}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: EXPENSES */}
        {activeTab === 'expenses' && (
          <div className="space-y-4 animate-in fade-in duration-150">
            {/* Section 4: Expenses */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold border-b border-slate-800 pb-2">
                <DollarSign className="w-5 h-5" />
                <h2>Expenses Worksheet</h2>
              </div>

              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-4">
                {/* Toggle choice */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Calculation Method</label>
                  <div className="flex bg-slate-900 p-0.5 rounded-xl border border-slate-800">
                    <button
                      type="button"
                      onClick={() => updateNestedState('useDetailedExpenses', '', false)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        !inputs.useDetailedExpenses
                          ? 'bg-emerald-500 text-slate-950 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Simple Aggregate
                    </button>
                    <button
                      type="button"
                      onClick={() => updateNestedState('useDetailedExpenses', '', true)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        inputs.useDetailedExpenses
                          ? 'bg-emerald-500 text-slate-950 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Itemized Expenses
                    </button>
                  </div>
                </div>

                {inputs.useDetailedExpenses ? (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setShowExpensesDialog(true)}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-emerald-400 hover:text-emerald-300 rounded-xl text-xs font-bold transition-all"
                    >
                      <Settings className="w-4 h-4 text-emerald-400" />
                      <span>Configure Detailed Expenses</span>
                    </button>
                    
                    <div className="p-3 bg-slate-900/60 border border-slate-800/80 rounded-xl space-y-2 text-[10px] text-slate-400 leading-normal">
                      <div className="flex justify-between border-b border-slate-800 pb-1">
                        <span className="font-semibold">Maryland (MD) Cost:</span>
                        <span className="text-slate-200 font-mono font-bold">{formatCurrency(mdMonthlySum * 12)}/yr</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold">Florida (FL) Cost:</span>
                        <span className="text-slate-200 font-mono font-bold">{formatCurrency(flMonthlySum * 12)}/yr</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-normal">
                      Annual living expenses are calculated as the sum of all itemized recurring expenses for the active state in any simulated year, inflated using CPI.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <RangeSlider
                        min={40000}
                        max={300000}
                        step={5000}
                        value={inputs.annualLivingExpenses ?? 100000}
                        onChange={(val) => updateNestedState('annualLivingExpenses', '', val)}
                        renderLabel={(val) => (
                          <label className="text-xs text-slate-400 flex justify-between">
                            <span>Expenses (Today's Dollars)</span>
                            <span className="text-emerald-400 font-bold font-mono">{formatCurrency(val)}</span>
                          </label>
                        )}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                      <div className="flex justify-between text-[10px] text-slate-500 font-mono px-1">
                        <span>$40k</span>
                        <span>$150k</span>
                        <span>$300k</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-normal">
                      This represents your base annual living budget, which will inflate by CPI annually. Portfolio drawdowns dynamically scale to fund this amount.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Charitable Giving & Tithe Engine */}
            <div className="space-y-3 pt-2">
              <CharityControlPanel
                settings={inputs.charitySettings}
                onChange={(newSettings) => onChange({ ...inputs, charitySettings: newSettings })}
                yourAge={new Date().getFullYear() - (parseInt(inputs.you.birthDate?.split('-')[0] || '1960', 10))}
                wifeAge={new Date().getFullYear() - (parseInt(inputs.wife.birthDate?.split('-')[0] || '1964', 10))}
                isSingleFiler={inputs.isSingleFiler}
              />
            </div>
          </div>
        )}

        {/* Section 7: Backup & Portability */}
        <div className="space-y-3 pt-4 border-t border-slate-800">
          <div className="flex items-center gap-2 text-emerald-500 font-semibold pb-1">
            <Upload className="w-4 h-4 text-emerald-500" />
            <h2 className="text-xs uppercase font-bold tracking-wider">Backup & Portability</h2>
          </div>
          <p className="text-[10px] text-slate-400 leading-normal">
            Export/import plan configurations or download structured data and summary reports.
          </p>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setExportDialogFormat('json')}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-750 border border-slate-750 hover:border-slate-700 text-slate-200 hover:text-slate-100 rounded-xl text-xs font-bold transition-all cursor-pointer"
                title="Export plan configuration with custom file name and folder destination"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Plan</span>
              </button>
              <label
                htmlFor="global-plan-input"
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-750 border border-slate-750 hover:border-slate-700 text-slate-200 hover:text-slate-100 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import Plan</span>
              </label>
              <input
                type="file"
                id="global-plan-input"
                accept=".json"
                onChange={handleImportJSON}
                className="hidden"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setExportDialogFormat('pdf')}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-750 border border-slate-750 hover:border-slate-700 text-slate-200 hover:text-slate-100 rounded-xl text-xs font-bold transition-all cursor-pointer"
                title="Export executive PDF report with custom file name and folder destination"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF Report</span>
              </button>

              <button
                type="button"
                onClick={() => setExportDialogFormat('excel')}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-750 border border-slate-750 hover:border-slate-700 text-slate-200 hover:text-slate-100 rounded-xl text-xs font-bold transition-all cursor-pointer"
                title="Export Excel simulation ledger with custom file name and folder destination"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel Ledger</span>
              </button>
            </div>
          </div>
        </div>

        {/* Section 7: Danger Zone / Reset */}
        <div className="space-y-3 pt-4 border-t border-slate-800">
          <div className="flex items-center gap-2 text-rose-500 font-semibold pb-1">
            <RefreshCw className="w-4 h-4 text-rose-500 animate-spin" style={{ animationDuration: '6s' }} />
            <h2 className="text-xs uppercase font-bold tracking-wider">Danger Zone</h2>
          </div>
          {!showResetConfirm ? (
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-950/20 hover:bg-red-950/40 border border-red-900/30 hover:border-red-900/50 text-red-400 rounded-xl text-xs font-bold transition-all hover:scale-102 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reset Plan & Configuration</span>
            </button>
          ) : (
            <div className="space-y-2 p-3 bg-red-950/10 border border-red-900/20 rounded-xl">
              <span className="text-[11px] text-slate-300 block text-center leading-normal">
                Are you sure? This will delete all customized inputs and restart the onboarding setup.
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetConfirm(false);
                    onReset();
                  }}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  Yes, Reset
                </button>
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
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
            setEditingHealthcarePerson('you');
          }}
        />
      )}
      {editingHealthcarePerson && (
        <HealthcareConfigDialog
          isOpen={editingHealthcarePerson !== null}
          onClose={() => setEditingHealthcarePerson(null)}
          personName={editingHealthcarePerson === 'you' ? (inputs.you.name || 'Primary') : (inputs.wife.name || 'Spouse')}
          birthDate={editingHealthcarePerson === 'you' ? inputs.you.birthDate : inputs.wife.birthDate}
          healthcareConfig={editingHealthcarePerson === 'you' ? inputs.you.healthcare : inputs.wife.healthcare}
          healthcareInflationRate={inputs.growthAssumptions.healthcareInflationRate}
          startYear={simStartYear}
          onSave={(config) => updateNestedState(editingHealthcarePerson, 'healthcare', config)}
        />
      )}

      {/* Global Display & Typography Settings Modal */}
      {showDisplaySettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm transition-all duration-200">
          <div className="w-full max-w-md bg-slate-900/95 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-6 glass-panel backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center border-b border-slate-800/60 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                Display & Typography Settings
              </h3>
              <button
                type="button"
                onClick={() => setShowDisplaySettings(false)}
                className="p-1.5 text-slate-400 hover:text-slate-100 bg-slate-800/40 hover:bg-slate-800 border border-slate-700/30 rounded-lg transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-400">Global Font Size Scale</span>
                  <span className="text-slate-200 font-mono font-bold bg-slate-800 px-2 py-0.5 rounded border border-slate-700/50">
                    {globalFontSize}px ({Math.round((globalFontSize / 16) * 100)}%)
                  </span>
                </div>
                <input
                  type="range"
                  min="12"
                  max="24"
                  value={globalFontSize}
                  onChange={(e) => setGlobalFontSize(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>12px (Small)</span>
                  <span>16px (Default)</span>
                  <span>24px (Extra Large)</span>
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div className="space-y-2 pt-2 border-t border-slate-800/60">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Size Presets</span>
                <div className="grid grid-cols-5 gap-1.5">
                  {[12, 14, 16, 18, 20].map((size) => {
                    const label = size === 12 ? 'XS' : size === 14 ? 'SM' : size === 16 ? 'DF' : size === 18 ? 'LG' : 'XL';
                    const isSelected = globalFontSize === size;
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setGlobalFontSize(size)}
                        className={`py-2 px-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                            : 'bg-slate-800/35 text-slate-400 border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {label} ({size}px)
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 text-[10px] text-slate-400 leading-relaxed">
                💡 <strong>Accessibility Note:</strong> Changing the root scale dynamically updates all relative text units (<code>rem</code>). This affects all parameters, sidebars, charts, menus, and details cards across the entire application interface.
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800/60">
              <button
                type="button"
                onClick={() => setGlobalFontSize(16)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition-all cursor-pointer"
              >
                Reset to Default
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Plan & Reports Dialog */}
      {exportDialogFormat && (
        <ExportPlanDialog
          isOpen={exportDialogFormat !== null}
          onClose={() => setExportDialogFormat(null)}
          inputs={inputs}
          simulateSurvivor={simulateSurvivor}
          ledger={ledger}
          initialFormat={exportDialogFormat}
        />
      )}

      {/* About & SCM Version Dialog */}
      {showAboutDialog && (
        <AboutDialog
          isOpen={showAboutDialog}
          onClose={() => setShowAboutDialog(false)}
          onOpenDocumentation={() => {
            setShowAboutDialog(false);
            if (onOpenDocumentation) {
              onOpenDocumentation('overview');
            } else {
              setShowDocumentation(true);
            }
          }}
        />
      )}

      {/* Application Documentation & User Guide Dialog */}
      {showDocumentation && (
        <DocumentationDialog
          isOpen={showDocumentation}
          onClose={() => setShowDocumentation(false)}
          onNavigateTab={onNavigateTab}
        />
      )}
      </aside>
    </div>
  );
};
