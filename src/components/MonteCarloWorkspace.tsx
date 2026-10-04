import React, { useMemo } from 'react';
import { Chart } from 'react-chartjs-2';
import { Chart as ChartJS, registerables, ChartOptions, TooltipItem } from 'chart.js';
import { AppStateInputs, MonteCarloSettings } from '../types';
import { MonteCarloSummary } from '../engine/monteCarloEngine';
import { StressTestControlPanel } from './StressTestControlPanel';
import { RangeSlider } from './RangeSlider';
import { NumericInput } from './NumericInput';
import { 
  Sliders, 
  Info,
  Calendar,
  RefreshCw,
  TrendingUp,
  PieChart,
  DollarSign,
  RotateCcw,
  ExternalLink,
  Flame
} from 'lucide-react';
import { CmaProfileSelector } from './CmaProfileSelector';
import { 
  getCmaProfile, 
  getFieldDeviations, 
  isProfileModified,
  calculateArithmeticDrift, 
  DEFAULT_CMA_PROFILE_ID,
  CurrentParameterValues, 
  CMAFieldKey 
} from '../constants/cmaProfiles';

ChartJS.register(...registerables);

interface MonteCarloWorkspaceProps {
  inputs: AppStateInputs;
  onChangeInputs: (newInputs: AppStateInputs) => void;
  simulateSurvivor: boolean;
  summary: MonteCarloSummary;
  globalScenario: 'flat' | 'p10' | 'p50' | 'p90';
  useTodayDollars?: boolean;
  setUseTodayDollars?: (val: boolean) => void;
  onOpenDocumentation?: (sectionId?: string) => void;
}

export const MonteCarloWorkspace: React.FC<MonteCarloWorkspaceProps> = ({
  inputs,
  onChangeInputs,
  summary,
  globalScenario,
  useTodayDollars = false,
  setUseTodayDollars,
  onOpenDocumentation,
}) => {
  const successRate = summary.successRate;

  const endingAges = useMemo(() => {
    const parseBirthYear = (dateStr: string | undefined, fallback: number): number => {
      if (!dateStr) return fallback;
      const match = dateStr.match(/^(\d{4})/);
      if (match) {
        const parsed = parseInt(match[1], 10);
        if (!isNaN(parsed) && parsed > 1900 && parsed < 2100) {
          return parsed;
        }
      }
      return fallback;
    };

    const youBirthYear = parseBirthYear(inputs.you.birthDate, 1960);
    const wifeBirthYear = parseBirthYear(inputs.wife.birthDate, 1964);

    return {
      you: 2060 - youBirthYear,
      wife: 2060 - wifeBirthYear,
    };
  }, [inputs.you.birthDate, inputs.wife.birthDate]);

  // Formatting helpers
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const formatPercent = (val: number) => {
    const rounded = Math.round((val * 100 + Number.EPSILON) * 100) / 100;
    return `${rounded}%`;
  };

  // Reference CMA profile and deviation detection
  const defaultPresetId = DEFAULT_CMA_PROFILE_ID;
  const customProfiles = inputs.monteCarloSettings.customCmaProfiles || [];
  const activeCmaId = inputs.monteCarloSettings.activeCmaProfileId;
  const baseCmaId = inputs.monteCarloSettings.baseCmaProfileId 
    || (activeCmaId && activeCmaId !== 'custom' ? activeCmaId : defaultPresetId);
  const referenceProfile = getCmaProfile(activeCmaId, customProfiles) 
    || getCmaProfile(baseCmaId, customProfiles) 
    || getCmaProfile(defaultPresetId);

  const currentValues: CurrentParameterValues = {
    equityReturnRate: inputs.growthAssumptions.equityReturnRate,
    equityVolatility: inputs.monteCarloSettings.equityVolatility,
    fixedIncomeReturnRate: inputs.growthAssumptions.fixedIncomeReturnRate,
    fixedIncomeVolatility: inputs.monteCarloSettings.fixedIncomeVolatility,
    cashYieldRate: inputs.growthAssumptions.cashYieldRate,
    cpiInflationRate: inputs.growthAssumptions.cpiInflationRate,
    correlation: inputs.monteCarloSettings.correlation,
  };

  const deviations = referenceProfile ? getFieldDeviations(referenceProfile, currentValues) : null;

  // State update helpers with auto-forking from CMA presets
  const updateSettings = <K extends keyof MonteCarloSettings>(field: K, value: MonteCarloSettings[K]) => {
    const isCmaField = ['equityVolatility', 'fixedIncomeVolatility', 'correlation'].includes(field as string);
    const effectiveBaseId = inputs.monteCarloSettings.baseCmaProfileId 
      || (inputs.monteCarloSettings.activeCmaProfileId && inputs.monteCarloSettings.activeCmaProfileId !== 'custom' 
          ? inputs.monteCarloSettings.activeCmaProfileId 
          : defaultPresetId);

    onChangeInputs({
      ...inputs,
      monteCarloSettings: {
        ...inputs.monteCarloSettings,
        [field]: value,
        ...(isCmaField ? {
          activeCmaProfileId: 'custom',
          baseCmaProfileId: effectiveBaseId,
        } : {}),
      },
    });
  };

  const updateGrowthAssumptions = (field: keyof AppStateInputs['growthAssumptions'], value: number | null) => {
    const isCmaField = ['equityReturnRate', 'fixedIncomeReturnRate', 'cashYieldRate', 'cpiInflationRate'].includes(field);
    const effectiveBaseId = inputs.monteCarloSettings.baseCmaProfileId 
      || (inputs.monteCarloSettings.activeCmaProfileId && inputs.monteCarloSettings.activeCmaProfileId !== 'custom' 
          ? inputs.monteCarloSettings.activeCmaProfileId 
          : defaultPresetId);

    onChangeInputs({
      ...inputs,
      growthAssumptions: {
        ...inputs.growthAssumptions,
        [field]: value,
      },
      monteCarloSettings: isCmaField ? {
        ...inputs.monteCarloSettings,
        activeCmaProfileId: 'custom',
        baseCmaProfileId: effectiveBaseId,
      } : inputs.monteCarloSettings,
    });
  };

  const resetFieldToPreset = (field: CMAFieldKey) => {
    if (!referenceProfile) return;
    const nextGrowth = { ...inputs.growthAssumptions };
    const nextSettings = { ...inputs.monteCarloSettings };

    if (field === 'equityReturnRate' || field === 'fixedIncomeReturnRate' || field === 'cashYieldRate' || field === 'cpiInflationRate') {
      nextGrowth[field] = referenceProfile[field] as number;
    } else {
      nextSettings[field] = referenceProfile[field] as number;
    }

    // Check if after resetting this field, the profile matches the reference preset exactly
    const nextValues: CurrentParameterValues = {
      equityReturnRate: nextGrowth.equityReturnRate,
      equityVolatility: nextSettings.equityVolatility,
      fixedIncomeReturnRate: nextGrowth.fixedIncomeReturnRate,
      fixedIncomeVolatility: nextSettings.fixedIncomeVolatility,
      cashYieldRate: nextGrowth.cashYieldRate,
      cpiInflationRate: nextGrowth.cpiInflationRate,
      correlation: nextSettings.correlation,
    };

    const stillModified = isProfileModified(referenceProfile, nextValues);
    if (!stillModified && referenceProfile.isBuiltIn) {
      nextSettings.activeCmaProfileId = referenceProfile.id;
      nextSettings.baseCmaProfileId = referenceProfile.id;
    }

    onChangeInputs({
      ...inputs,
      growthAssumptions: nextGrowth,
      monteCarloSettings: nextSettings,
    });
  };

  const fiRate = inputs.growthAssumptions.fixedIncomeReturnRate;
  const preTaxEq = inputs.growthAssumptions.preTaxEquityPortion ?? 0.50;
  const taxableEq = inputs.growthAssumptions.taxableEquityPortion ?? 0.60;
  const rothEq = inputs.growthAssumptions.rothEquityPortion ?? 1.00;
  const cashYield = inputs.growthAssumptions.cashYieldRate ?? fiRate;

  const handleRegenerate = () => {
    if (inputs.monteCarloSettings.seed !== null) {
      const newSeed = Math.floor(Math.random() * 1000000);
      updateSettings('seed', newSeed);
    } else {
      const currentNonce = inputs.monteCarloSettings.nonce || 0;
      updateSettings('nonce', currentNonce + 1);
    }
  };

  // SVG parameters for circular success rate gauge
  const radius = 70;
  const strokeWidth = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - successRate * circumference;

  // ChartJS Percentile setup
  const years = summary.percentiles.map(p => p.year);
  const chartData = {
    labels: years.map(String),
    datasets: [
      // 90th percentile (Best Case)
      {
        label: 'Best Case (90th Percentile)',
        data: summary.percentiles.map(p => p.p90),
        borderColor: 'rgba(16, 185, 129, 0.8)', // emerald-500
        backgroundColor: 'rgba(16, 185, 129, 0.03)',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      },
      // 50th percentile (Median Case)
      {
        label: 'Median Case (50th Percentile)',
        data: summary.percentiles.map(p => p.p50),
        borderColor: 'rgba(59, 130, 246, 0.85)', // blue-500
        backgroundColor: 'rgba(59, 130, 246, 0.05)',
        borderWidth: 2.5,
        pointRadius: 0,
        fill: false,
      },
      // 10th percentile (Worst Case)
      {
        label: 'Worst Case (10th Percentile)',
        data: summary.percentiles.map(p => p.p10),
        borderColor: 'rgba(239, 68, 68, 0.8)', // red-500
        backgroundColor: 'rgba(239, 68, 68, 0.03)',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
      },
    ],
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          color: '#cbd5e1',
          font: { size: 10, weight: 'bold' as const },
          boxWidth: 10,
        },
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        backgroundColor: '#0f172a',
        titleColor: '#f1f5f9',
        bodyColor: '#cbd5e1',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          label: function (context: TooltipItem<'line'>) {
            return `${context.dataset.label}: ${formatCurrency(context.parsed.y ?? 0)}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255, 255, 255, 0.03)' },
        ticks: { color: '#94a3b8', font: { size: 9 } },
      },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.03)' },
        ticks: { 
          color: '#94a3b8', 
          font: { size: 9 },
          callback: (val: string | number) => `$${(Number(val) / 1000000).toFixed(1)}M`,
        },
      },
    },
  };

  // Return rates dataset preparation
  const activeEquityReturns = useMemo(() => {
    if (globalScenario === 'flat') {
      return Array(35).fill(inputs.growthAssumptions.equityReturnRate);
    }
    const seq = globalScenario === 'p10' ? summary.representativeSequences.worst
              : globalScenario === 'p90' ? summary.representativeSequences.best
              : summary.representativeSequences.median;
    return seq ? seq.equityReturns : Array(35).fill(inputs.growthAssumptions.equityReturnRate);
  }, [globalScenario, inputs.growthAssumptions.equityReturnRate, summary.representativeSequences]);

  const activeFixedIncomeReturns = useMemo(() => {
    if (globalScenario === 'flat') {
      return Array(35).fill(inputs.growthAssumptions.fixedIncomeReturnRate);
    }
    const seq = globalScenario === 'p10' ? summary.representativeSequences.worst
              : globalScenario === 'p90' ? summary.representativeSequences.best
              : summary.representativeSequences.median;
    return seq ? seq.fixedIncomeReturns : Array(35).fill(inputs.growthAssumptions.fixedIncomeReturnRate);
  }, [globalScenario, inputs.growthAssumptions.fixedIncomeReturnRate, summary.representativeSequences]);

  const stressedYearSet = useMemo(() => {
    const st = inputs.monteCarloSettings.stressTest;
    if (!st || !st.enabled || !st.overrides) return new Set<number>();
    return new Set(st.overrides.map(o => o.year));
  }, [inputs.monteCarloSettings.stressTest]);

  const barChartData = {
    labels: years.map(String),
    datasets: [
      {
        label: 'Equity (Stock) Return Rate',
        data: activeEquityReturns.map(r => Number((r * 100).toFixed(2))),
        backgroundColor: years.map(yr => stressedYearSet.has(yr) ? 'rgba(244, 63, 94, 0.85)' : 'rgba(6, 182, 212, 0.75)'),
        borderColor: years.map(yr => stressedYearSet.has(yr) ? '#f43f5e' : '#06b6d2'),
        borderWidth: 1,
        borderRadius: 4,
      },
      {
        label: 'Fixed Income (Bond) Return Rate',
        data: activeFixedIncomeReturns.map(r => Number((r * 100).toFixed(2))),
        backgroundColor: years.map(yr => stressedYearSet.has(yr) ? 'rgba(225, 29, 72, 0.85)' : 'rgba(245, 158, 11, 0.75)'),
        borderColor: years.map(yr => stressedYearSet.has(yr) ? '#e11d48' : '#f59e0b'),
        borderWidth: 1,
        borderRadius: 4,
      }
    ]
  };

  const barChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          color: '#cbd5e1',
          font: { size: 10, weight: 'bold' as const },
        }
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#f1f5f9',
        bodyColor: '#cbd5e1',
        borderColor: 'rgba(255, 255, 255, 0.08)',
        borderWidth: 1,
        callbacks: {
          label: function(context: TooltipItem<'bar'>) {
            let label = context.dataset.label || '';
            if (label) label += ': ';
            if (context.parsed.y !== null) {
              const sign = context.parsed.y >= 0 ? '+' : '';
              label += sign + context.parsed.y.toFixed(2) + '%';
            }
            return label;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(255, 255, 255, 0.03)' },
        ticks: { color: '#94a3b8', font: { size: 9 } }
      },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.03)' },
        ticks: {
          color: '#94a3b8',
          font: { size: 9 },
          callback: (val: string | number) => {
            const num = Number(val);
            const sign = num >= 0 ? '+' : '';
            return sign + num + '%';
          }
        }
      }
    }
  };

  return (
    <div className="space-y-3">
      {/* Top Title Section */}
      <div className="bg-slate-900/30 px-4 py-2.5 rounded-2xl border border-slate-800/60">
        <div>
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Monte Carlo Analysis & Stress Testing
          </h3>
          <p className="text-xs text-slate-400">
            Model stock/bond return variances, run batch trial stress tests, and explore statistical probabilities of success.
          </p>
        </div>
      </div>

      {/* Main Grid: Statistics Gauge & Parameter Configuration Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        
        {/* Left Column: Premium Circular Gauge and Stats */}
        <div className="lg:col-span-1 glass-panel rounded-2xl p-3.5 flex flex-col justify-between border border-slate-800 bg-slate-900/20 relative overflow-hidden">
          <div className="space-y-4">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Plan Health Summary</span>
            
            {/* SVG Circular Success Gauge */}
            <div className="relative flex items-center justify-center py-6">
              <svg viewBox="0 0 176 176" className="w-44 h-44 transform -rotate-90">
                {/* Background Ring */}
                <circle
                  cx="88"
                  cy="88"
                  r={radius}
                  fill="transparent"
                  stroke="rgba(255, 255, 255, 0.03)"
                  strokeWidth={strokeWidth}
                />
                {/* Foreground Arc */}
                <circle
                  cx="88"
                  cy="88"
                  r={radius}
                  fill="transparent"
                  stroke={successRate > 0.75 ? '#10b981' : successRate > 0.50 ? '#f59e0b' : '#ef4444'}
                  strokeWidth={strokeWidth}
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-500 ease-out"
                />
              </svg>
              {/* Central Text */}
              <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-3xl font-black text-slate-100 font-mono tracking-tight">
                  {formatPercent(successRate)}
                </span>
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                  Success Rate
                </span>
              </div>
            </div>

            {/* Micro Stats Ledger */}
            <div className="space-y-2.5 pt-4 border-t border-slate-800/40 text-xs">
              <div className="flex justify-between items-center bg-slate-950/20 p-2 rounded-lg border border-slate-800/30">
                <span className="text-slate-400">Total Trials Executed</span>
                <span className="font-mono text-slate-200 font-bold">{inputs.monteCarloSettings.trials}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-950/20 p-2 rounded-lg border border-slate-800/30">
                <span className="text-slate-400">Worst ending estate (P10)</span>
                <span className="font-mono text-rose-400 font-bold">{formatCurrency(summary.percentiles[summary.percentiles.length - 1].p10)}</span>
              </div>
              <div className="flex justify-between items-center bg-slate-950/20 p-2 rounded-lg border border-slate-800/30">
                <span className="text-slate-400">Median ending estate (P50)</span>
                <span className="font-mono text-blue-400 font-bold">{formatCurrency(summary.percentiles[summary.percentiles.length - 1].p50)}</span>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-[10px] text-slate-400 leading-normal flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
              Success rate represents the percent of simulations where the joint retirement estate remained solvent (&gt; $0) through year 2060 (Age {endingAges.you}{inputs.isSingleFiler ? '' : '/' + endingAges.wife}).
            </p>
          </div>
        </div>

        {/* Right Column: Dedicated Model Estimation Configuration Panel */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-3.5 border border-slate-800 bg-slate-900/20 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Model Estimation Config Panel</h4>
            </div>

            <button
              id="regenerate-mc-panel-btn"
              onClick={handleRegenerate}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:border-emerald-500/50 rounded-lg text-xs font-semibold transition-all duration-200 active:scale-95 group cursor-pointer"
              title="Regenerate stochastic market predictions with new random trials"
            >
              <RefreshCw className="w-3.5 h-3.5 text-emerald-400 group-hover:rotate-180 transition-transform duration-500" />
              <span>Regenerate Predictions</span>
            </button>
          </div>

          {/* Valuation Currency Mode */}
          {setUseTodayDollars && (
            <div className="p-3.5 bg-slate-950/70 border border-slate-800/90 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-100">Valuation Currency Mode</h4>
                  <p className="text-[11px] text-slate-400">
                    Display simulations, percentiles, and ledgers in future nominal dollars or real purchasing power (discounted by CPI inflation).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800 shrink-0">
                <button
                  type="button"
                  onClick={() => setUseTodayDollars(false)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    !useTodayDollars
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Future Nominal $
                </button>
                <button
                  type="button"
                  onClick={() => setUseTodayDollars(true)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    useTodayDollars
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Real Today's $ (Inflation Discounted)
                </button>
              </div>
            </div>
          )}

          {/* Section 1: Baseline Market Returns & Inflation (Expected Means) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <span>1. Baseline Market Returns & Inflation (Expected Means)</span>
              </label>
              <span className="text-[10px] text-slate-400 font-mono">
                Active Scenario: <strong className="text-emerald-400 uppercase">{globalScenario}</strong>
              </span>
            </div>

            {/* CMA Profile Selection & Institutional Status Header */}
            <CmaProfileSelector inputs={inputs} onChangeInputs={onChangeInputs} />

            <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 space-y-3">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <span className="text-slate-200 font-semibold">How these values drive the simulation:</span> In <strong className="text-emerald-400">Flat Mode</strong>, these rates are applied as fixed, constant annual growth and inflation. In <strong className="text-emerald-400">Monte Carlo Mode</strong>, the Equity and Fixed Income rates represent your <strong className="text-slate-200">Target CAGR (Compound Annual Growth Rate)</strong>. The engine automatically adjusts stochastic annual drift (μ) to overcome volatility drag, ensuring your median 30-year wealth compounds at your target CAGR. In <strong className="text-emerald-400">Historical Bootstrap Mode</strong>, market returns sample from 1970–2025 history calibrated to your target expectations.
                {onOpenDocumentation && (
                  <button
                    type="button"
                    onClick={() => onOpenDocumentation('cma-volatility-drag')}
                    className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-semibold ml-1.5 underline decoration-emerald-500/50 hover:decoration-emerald-400 transition-colors cursor-pointer"
                  >
                    <span>Read detailed CMA & Volatility Drag Math guide</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                )}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                {/* Equity Return Rate */}
                <div className="space-y-1.5 p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/80">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">Equity Return (Mean)</label>
                    {deviations?.equityReturnRate.isModified && (
                      <button
                        type="button"
                        onClick={() => resetFieldToPreset('equityReturnRate')}
                        className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5 cursor-pointer font-mono"
                        title={`Reset to ${referenceProfile?.name} default (${formatPercent(deviations.equityReturnRate.presetValue)})`}
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>{deviations.equityReturnRate.delta > 0 ? '+' : ''}{(deviations.equityReturnRate.delta * 100).toFixed(1)}%</span>
                      </button>
                    )}
                  </div>
                  <RangeSlider
                    min={0.00}
                    max={0.15}
                    step={0.005}
                    value={inputs.growthAssumptions.equityReturnRate}
                    onChange={(val) => updateGrowthAssumptions('equityReturnRate', val)}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    renderLabel={(displayVal) => (
                      <div className="space-y-0.5 font-mono">
                        <div className="flex justify-between items-center text-xs font-bold text-slate-200">
                          <span>
                            Target{' '}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenDocumentation?.('cma-volatility-drag');
                              }}
                              className="text-emerald-400 hover:text-emerald-300 underline decoration-dotted decoration-emerald-500/60 hover:decoration-emerald-400 cursor-pointer transition-colors"
                              title="Compound Annual Growth Rate (CAGR) - Click to view documentation"
                            >
                              CAGR
                            </button>
                            :
                          </span>
                          <span className="text-emerald-400">{formatPercent(displayVal)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-slate-400">
                          <span>Drift (μ):</span>
                          <span className="text-slate-300 font-semibold">
                            {formatPercent(calculateArithmeticDrift(displayVal, inputs.monteCarloSettings.equityVolatility))}
                          </span>
                        </div>
                      </div>
                    )}
                  />
                </div>

                {/* Fixed Income Return Rate */}
                <div className="space-y-1.5 p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/80">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">Fixed Income (Mean)</label>
                    {deviations?.fixedIncomeReturnRate.isModified && (
                      <button
                        type="button"
                        onClick={() => resetFieldToPreset('fixedIncomeReturnRate')}
                        className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5 cursor-pointer font-mono"
                        title={`Reset to ${referenceProfile?.name} default (${formatPercent(deviations.fixedIncomeReturnRate.presetValue)})`}
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>{deviations.fixedIncomeReturnRate.delta > 0 ? '+' : ''}{(deviations.fixedIncomeReturnRate.delta * 100).toFixed(1)}%</span>
                      </button>
                    )}
                  </div>
                  <RangeSlider
                    min={0.00}
                    max={0.10}
                    step={0.005}
                    value={inputs.growthAssumptions.fixedIncomeReturnRate}
                    onChange={(val) => updateGrowthAssumptions('fixedIncomeReturnRate', val)}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    renderLabel={(displayVal) => (
                      <div className="space-y-0.5 font-mono">
                        <div className="flex justify-between items-center text-xs font-bold text-slate-200">
                          <span>
                            Target{' '}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenDocumentation?.('cma-volatility-drag');
                              }}
                              className="text-emerald-400 hover:text-emerald-300 underline decoration-dotted decoration-emerald-500/60 hover:decoration-emerald-400 cursor-pointer transition-colors"
                              title="Compound Annual Growth Rate (CAGR) - Click to view documentation"
                            >
                              CAGR
                            </button>
                            :
                          </span>
                          <span className="text-emerald-400">{formatPercent(displayVal)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-slate-400">
                          <span>Drift (μ):</span>
                          <span className="text-slate-300 font-semibold">
                            {formatPercent(calculateArithmeticDrift(displayVal, inputs.monteCarloSettings.fixedIncomeVolatility))}
                          </span>
                        </div>
                      </div>
                    )}
                  />
                </div>

                {/* CPI Inflation Rate */}
                <div className="space-y-1.5 p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/80">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">CPI Inflation</label>
                    {deviations?.cpiInflationRate.isModified && (
                      <button
                        type="button"
                        onClick={() => resetFieldToPreset('cpiInflationRate')}
                        className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5 cursor-pointer font-mono"
                        title={`Reset to ${referenceProfile?.name} default (${formatPercent(deviations.cpiInflationRate.presetValue)})`}
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>{deviations.cpiInflationRate.delta > 0 ? '+' : ''}{(deviations.cpiInflationRate.delta * 100).toFixed(1)}%</span>
                      </button>
                    )}
                  </div>
                  <RangeSlider
                    min={0.00}
                    max={0.08}
                    step={0.002}
                    value={inputs.growthAssumptions.cpiInflationRate}
                    onChange={(val) => updateGrowthAssumptions('cpiInflationRate', val)}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    renderLabel={(displayVal) => (
                      <div className="flex justify-between items-center text-xs font-mono font-bold text-slate-200">
                        <span>Rate:</span>
                        <span className="text-emerald-400">{formatPercent(displayVal)}</span>
                      </div>
                    )}
                  />
                </div>

                {/* Healthcare Inflation Rate */}
                <div className="space-y-1.5 p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/80">
                  <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">Healthcare Inflation</label>
                  <RangeSlider
                    min={0.00}
                    max={0.10}
                    step={0.005}
                    value={inputs.growthAssumptions.healthcareInflationRate}
                    onChange={(val) => updateGrowthAssumptions('healthcareInflationRate', val)}
                    className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    renderLabel={(displayVal) => (
                      <div className="flex justify-between items-center text-xs font-mono font-bold text-slate-200">
                        <span>Rate:</span>
                        <span className="text-emerald-400">{formatPercent(displayVal)}</span>
                      </div>
                    )}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Account Asset Allocations & Live Effective Rates */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-emerald-400" />
                <span>2. Account Asset Allocations & Effective Growth Rates</span>
              </label>
              <span className="text-[10px] text-slate-500">
                Adjust stock/bond mix per account
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Pre-Tax Traditional IRA */}
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
                <RangeSlider
                  min={0.00}
                  max={1.00}
                  step={0.05}
                  value={preTaxEq}
                  onChange={(val) => updateGrowthAssumptions('preTaxEquityPortion', val)}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  renderLabel={(displayVal) => (
                    <>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-200">Pre-Tax IRA</span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {formatPercent(displayVal * inputs.growthAssumptions.equityReturnRate + (1 - displayVal) * inputs.growthAssumptions.fixedIncomeReturnRate)} mean
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>{Math.round(displayVal * 100)}% Stocks</span>
                        <span>{Math.round((1 - displayVal) * 100)}% Bonds</span>
                      </div>
                    </>
                  )}
                />
              </div>

              {/* Taxable Brokerage */}
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
                <RangeSlider
                  min={0.00}
                  max={1.00}
                  step={0.05}
                  value={taxableEq}
                  onChange={(val) => updateGrowthAssumptions('taxableEquityPortion', val)}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  renderLabel={(displayVal) => (
                    <>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-200">Taxable Brokerage</span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {formatPercent(displayVal * inputs.growthAssumptions.equityReturnRate + (1 - displayVal) * inputs.growthAssumptions.fixedIncomeReturnRate)} mean
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>{Math.round(displayVal * 100)}% Stocks</span>
                        <span>{Math.round((1 - displayVal) * 100)}% Bonds</span>
                      </div>
                    </>
                  )}
                />
              </div>

              {/* Roth IRA */}
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
                <RangeSlider
                  min={0.00}
                  max={1.00}
                  step={0.05}
                  value={rothEq}
                  onChange={(val) => updateGrowthAssumptions('rothEquityPortion', val)}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  renderLabel={(displayVal) => (
                    <>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-200">Roth IRA</span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {formatPercent(displayVal * inputs.growthAssumptions.equityReturnRate + (1 - displayVal) * inputs.growthAssumptions.fixedIncomeReturnRate)} mean
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>{Math.round(displayVal * 100)}% Stocks</span>
                        <span>{Math.round((1 - displayVal) * 100)}% Bonds</span>
                      </div>
                    </>
                  )}
                />
              </div>

              {/* Cash Savings Yield */}
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
                <RangeSlider
                  min={0.00}
                  max={0.08}
                  step={0.005}
                  value={cashYield}
                  onChange={(val) => updateGrowthAssumptions('cashYieldRate', val)}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  renderLabel={(displayVal) => (
                    <>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-200">Cash Savings</span>
                        <div className="flex items-center gap-1.5">
                          {deviations?.cashYieldRate.isModified && (
                            <button
                              type="button"
                              onClick={() => resetFieldToPreset('cashYieldRate')}
                              className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5 cursor-pointer font-mono"
                              title={`Reset to ${referenceProfile?.name} default (${formatPercent(deviations.cashYieldRate.presetValue)})`}
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>{deviations.cashYieldRate.delta > 0 ? '+' : ''}{(deviations.cashYieldRate.delta * 100).toFixed(1)}%</span>
                            </button>
                          )}
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {formatPercent(displayVal)} yield
                          </span>
                        </div>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>{inputs.growthAssumptions.cashYieldRate !== null && inputs.growthAssumptions.cashYieldRate !== undefined ? 'Custom' : 'Matches Bonds'}</span>
                        <span>{formatPercent(displayVal)}</span>
                      </div>
                    </>
                  )}
                />
              </div>

              {/* Minimum Cash Reserve Level Target */}
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2 col-span-1 sm:col-span-2">
                <RangeSlider
                  min={0}
                  max={500000}
                  step={5000}
                  value={inputs.growthAssumptions.minCashReserveDollars ?? 100000}
                  onChange={(val) => updateGrowthAssumptions('minCashReserveDollars', val)}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  renderLabel={(displayVal) => (
                    <>
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-200">Minimum Cash Reserve Floor ($)</span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {formatCurrency(displayVal)} (CPI-Indexed)
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                        <span>Protects cash from drawdowns (in today's dollars, grows with inflation)</span>
                        <span>
                          {((inputs.annualLivingExpenses ?? 100000) > 0 
                            ? (((displayVal) / (inputs.annualLivingExpenses ?? 100000)) * 12).toFixed(1)
                            : '12.0')} mo of expenses
                        </span>
                      </div>
                    </>
                  )}
                />
              </div>
            </div>
          </div>

          {/* Section 3: Volatility, Correlation & Simulation Parameters */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>3. Monte Carlo Volatility, Correlation & Sampling</span>
              </label>
            </div>

            {/* Regime Switching & Mean Reversion Toggle */}
            <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="enableRegimeSwitchingCheckbox"
                    checked={inputs.monteCarloSettings.enableRegimeSwitching !== false}
                    onChange={(e) => updateSettings('enableRegimeSwitching', e.target.checked)}
                    className="w-4 h-4 bg-slate-950 rounded border-slate-800 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                  />
                  <label htmlFor="enableRegimeSwitchingCheckbox" className="text-xs text-slate-200 cursor-pointer select-none font-semibold">
                    Enable Markov Regime Switching & Mean Reversion
                  </label>
                </div>
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                  inputs.monteCarloSettings.enableRegimeSwitching !== false
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}>
                  {inputs.monteCarloSettings.enableRegimeSwitching !== false ? 'Active (Cyclical + Mean Reversion)' : 'Inactive (i.i.d. Random Walk)'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed pl-6">
                {inputs.monteCarloSettings.enableRegimeSwitching !== false ? (
                  <>
                    <strong className="text-slate-200">How this impacts outcomes:</strong> Models real-world multi-year economic cycles (expansions vs. recessions) using a 2-state Markov process and Ornstein-Uhlenbeck mean reversion. This clusters bear markets into realistic 1–3 year sequences, generates post-crisis recovery rebounds, and prevents unrealistic runaway compounding streaks without changing your configured long-term baseline return mean.
                  </>
                ) : (
                  <>
                    <strong className="text-amber-400">Pure i.i.d. Random Walk:</strong> Each year's market shock is sampled completely independently of the previous year (like flipping a coin each Dec 31). This can produce artificially prolonged multi-decade bull streaks or isolated single-year dips.
                  </>
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Mode selection and Trials */}
              <div className="space-y-4">
                {/* Simulation Mode Toggle */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                    <span>Simulation Distribution Mode</span>
                    <span className="text-[10px] text-slate-500 font-mono">Select data source</span>
                  </label>
                  <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      onClick={() => updateSettings('mode', 'monte-carlo')}
                      className={`flex-1 text-[10px] py-2 rounded-lg font-bold transition-all ${
                        inputs.monteCarloSettings.mode === 'monte-carlo'
                          ? 'bg-emerald-500 text-slate-950 shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Bivariate Normal MC
                    </button>
                    <button
                      onClick={() => updateSettings('mode', 'historical')}
                      className={`flex-1 text-[10px] py-2 rounded-lg font-bold transition-all ${
                        inputs.monteCarloSettings.mode === 'historical'
                          ? 'bg-emerald-500 text-slate-950 shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Historical Bootstrap
                    </button>
                  </div>
                </div>

                {/* Number of Trials */}
                <div className="space-y-2">
                  <RangeSlider
                    min={200}
                    max={10000}
                    step={100}
                    value={inputs.monteCarloSettings.trials}
                    onChange={(val) => updateSettings('trials', val)}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    renderLabel={(displayVal) => (
                      <label className="text-xs font-semibold text-slate-300 flex justify-between">
                        <span>Simulated Sample Size</span>
                        <span className="text-emerald-400 font-mono font-bold">{displayVal} trials</span>
                      </label>
                    )}
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                    <span>200 (Draft)</span>
                    <span>1000 (Recommended)</span>
                    <span>10000 (High Precision)</span>
                  </div>
                </div>

                {/* Seedable Reproducibility */}
                <div className="space-y-2 pt-3 border-t border-slate-800/40">
                  <label className="text-xs font-semibold text-slate-300 flex justify-between items-center">
                    <span>Deterministic Random Seed</span>
                    <span className="text-[10px] text-slate-500 font-mono">Reproducibility</span>
                  </label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="checkbox"
                      id="useSeedCheckbox"
                      checked={inputs.monteCarloSettings.seed !== null}
                      onChange={(e) => {
                        const useSeed = e.target.checked;
                        updateSettings('seed', useSeed ? 42 : null);
                      }}
                      className="w-4 h-4 bg-slate-950 rounded border-slate-800 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                    />
                    <label htmlFor="useSeedCheckbox" className="text-xs text-slate-400 cursor-pointer select-none">
                      Lock Seed Value
                    </label>
                    
                    {inputs.monteCarloSettings.seed !== null && (
                      <div className="flex items-center gap-1.5 flex-1">
                        <NumericInput
                          value={inputs.monteCarloSettings.seed}
                          onChange={(val) => {
                            updateSettings('seed', val ?? 42);
                          }}
                          placeholder="e.g. 42"
                        />
                        <button
                          type="button"
                          onClick={handleRegenerate}
                          className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-emerald-400 border border-slate-700 rounded-lg transition-colors cursor-pointer group"
                          title="Randomize seed value and regenerate"
                        >
                          <RefreshCw className="w-3.5 h-3.5 group-hover:rotate-180 transition-transform duration-500" />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-[9px] text-slate-500 leading-normal">
                    Locking a seed value ensures simulation returns remain 100% identical on page reloads or slider edits for debugging and repeatable analysis.
                  </p>
                </div>
              </div>

              {/* Volatilities and Correlations (Normal mode parameters) */}
              <div className="space-y-4">
                {inputs.monteCarloSettings.mode === 'monte-carlo' ? (
                  <>
                    {/* Equity Volatility */}
                    <div className="space-y-1">
                      <RangeSlider
                        min={0.05}
                        max={0.30}
                        step={0.005}
                        value={inputs.monteCarloSettings.equityVolatility}
                        onChange={(val) => updateSettings('equityVolatility', Math.round(val * 1000) / 1000)}
                        className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        renderLabel={(displayVal) => (
                          <div className="text-xs font-semibold text-slate-300 flex justify-between items-center">
                            <span>Equity Return Volatility (Std Dev)</span>
                            <div className="flex items-center gap-1.5 font-mono">
                              {deviations?.equityVolatility.isModified && (
                                <button
                                  type="button"
                                  onClick={() => resetFieldToPreset('equityVolatility')}
                                  className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5 cursor-pointer font-mono"
                                  title={`Reset to ${referenceProfile?.name} default (${formatPercent(deviations.equityVolatility.presetValue)})`}
                                >
                                  <RotateCcw className="w-2.5 h-2.5" />
                                  <span>{deviations.equityVolatility.delta > 0 ? '+' : ''}{(deviations.equityVolatility.delta * 100).toFixed(1)}%</span>
                                </button>
                              )}
                              <span className="text-emerald-400 font-semibold">{formatPercent(displayVal)}</span>
                            </div>
                          </div>
                        )}
                      />
                    </div>

                    {/* Bond Volatility */}
                    <div className="space-y-1">
                      <RangeSlider
                        min={0.005}
                        max={0.15}
                        step={0.005}
                        value={inputs.monteCarloSettings.fixedIncomeVolatility}
                        onChange={(val) => updateSettings('fixedIncomeVolatility', Math.round(val * 1000) / 1000)}
                        className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        renderLabel={(displayVal) => (
                          <div className="text-xs font-semibold text-slate-300 flex justify-between items-center">
                            <span>Bond Return Volatility (Std Dev)</span>
                            <div className="flex items-center gap-1.5 font-mono">
                              {deviations?.fixedIncomeVolatility.isModified && (
                                <button
                                  type="button"
                                  onClick={() => resetFieldToPreset('fixedIncomeVolatility')}
                                  className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5 cursor-pointer font-mono"
                                  title={`Reset to ${referenceProfile?.name} default (${formatPercent(deviations.fixedIncomeVolatility.presetValue)})`}
                                >
                                  <RotateCcw className="w-2.5 h-2.5" />
                                  <span>{deviations.fixedIncomeVolatility.delta > 0 ? '+' : ''}{(deviations.fixedIncomeVolatility.delta * 100).toFixed(1)}%</span>
                                </button>
                              )}
                              <span className="text-emerald-400 font-semibold">{formatPercent(displayVal)}</span>
                            </div>
                          </div>
                        )}
                      />
                    </div>

                    {/* Asset Correlation */}
                    <div className="space-y-1">
                      <RangeSlider
                        min={-0.50}
                        max={0.80}
                        step={0.05}
                        value={inputs.monteCarloSettings.correlation}
                        onChange={(val) => updateSettings('correlation', val)}
                        className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        renderLabel={(displayVal) => (
                          <div className="text-xs font-semibold text-slate-300 flex justify-between items-center">
                            <span>Asset Correlation Coefficient (ρ)</span>
                            <div className="flex items-center gap-1.5 font-mono">
                              {deviations?.correlation.isModified && (
                                <button
                                  type="button"
                                  onClick={() => resetFieldToPreset('correlation')}
                                  className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5 cursor-pointer font-mono"
                                  title={`Reset to ${referenceProfile?.name} default (${(deviations.correlation.presetValue).toFixed(2)})`}
                                >
                                  <RotateCcw className="w-2.5 h-2.5" />
                                  <span>{deviations.correlation.delta > 0 ? '+' : ''}{(deviations.correlation.delta).toFixed(2)}</span>
                                </button>
                              )}
                              <span className="text-emerald-400 font-semibold">{(displayVal).toFixed(2)}</span>
                            </div>
                          </div>
                        )}
                      />
                    </div>
                  </>
                ) : (
                  <div className="h-full bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/40 flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Calendar className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-bold text-slate-200">Historical Sampling Strategy</span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-normal">
                        Control how the 56-year dataset (1970–2025 S&P 500, Treasuries & CPI) is sampled across your 1,000 retirement trials:
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
                      <button
                        type="button"
                        onClick={() => updateSettings('historicalSamplingStrategy', 'hybrid')}
                        className={`text-[9px] py-1.5 px-2 rounded-lg font-bold transition-all cursor-pointer ${
                          (inputs.monteCarloSettings.historicalSamplingStrategy ?? 'hybrid') === 'hybrid'
                            ? 'bg-emerald-500 text-slate-950 shadow'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        Hybrid (35/65)
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSettings('historicalSamplingStrategy', 'block')}
                        className={`text-[9px] py-1.5 px-2 rounded-lg font-bold transition-all cursor-pointer ${
                          inputs.monteCarloSettings.historicalSamplingStrategy === 'block'
                            ? 'bg-emerald-500 text-slate-950 shadow'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        100% Block
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSettings('historicalSamplingStrategy', 'random')}
                        className={`text-[9px] py-1.5 px-2 rounded-lg font-bold transition-all cursor-pointer ${
                          inputs.monteCarloSettings.historicalSamplingStrategy === 'random'
                            ? 'bg-emerald-500 text-slate-950 shadow'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        100% Random
                      </button>
                    </div>

                    <div className="p-2.5 bg-slate-900/60 rounded-lg border border-slate-800/80 text-[10px] text-slate-300 leading-normal">
                      {(inputs.monteCarloSettings.historicalSamplingStrategy ?? 'hybrid') === 'hybrid' && (
                        <span>
                          <strong className="text-emerald-400">Hybrid (Recommended):</strong> 35% of the configured trials replay 35-year contiguous chronological blocks (e.g. 1973–2007) to preserve exact historic bear market clusters, while 65% of the trials resample random individual years to test novel sequence permutations.
                        </span>
                      )}
                      {inputs.monteCarloSettings.historicalSamplingStrategy === 'block' && (
                        <span>
                          <strong className="text-emerald-400">100% Contiguous Chronological Blocks:</strong> Every trial strictly replays actual 35-year continuous historic windows (1970–2004, 1973–2007, 1982–2016, etc.) preserving true macroeconomic persistence and lived sequences.
                        </span>
                      )}
                      {inputs.monteCarloSettings.historicalSamplingStrategy === 'random' && (
                        <span>
                          <strong className="text-emerald-400">100% Random Year Resampling:</strong> Every trial randomly shuffles 35 individual years from 1970–2025 with replacement (preserving joint stock/bond/inflation synchronization per year) to stress-test arbitrary combinations.
                        </span>
                      )}
                    </div>

                    {/* Mean Calibration Toggle */}
                    <div className="pt-2 border-t border-slate-800/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="calibrateHistoricalMeansCheckbox"
                            checked={inputs.monteCarloSettings.calibrateHistoricalMeans !== false}
                            onChange={(e) => updateSettings('calibrateHistoricalMeans', e.target.checked)}
                            className="w-3.5 h-3.5 bg-slate-950 rounded border-slate-800 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                          />
                          <label htmlFor="calibrateHistoricalMeansCheckbox" className="text-[11px] text-slate-200 cursor-pointer select-none font-semibold">
                            Calibrate Historical Shocks to Baseline Means
                          </label>
                        </div>
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          inputs.monteCarloSettings.calibrateHistoricalMeans !== false
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}>
                          {inputs.monteCarloSettings.calibrateHistoricalMeans !== false ? 'Calibrated (Aligned)' : 'Raw History (12.3% Stocks)'}
                        </span>
                      </div>
                      <p className="text-[9px] text-slate-400 leading-normal pl-5">
                        {inputs.monteCarloSettings.calibrateHistoricalMeans !== false ? (
                          <>
                            <strong className="text-slate-300">Calibrated (Recommended):</strong> Shifts 1970–2025 returns so the average matches your configured baseline ({formatPercent(inputs.growthAssumptions.equityReturnRate)} Stocks / {formatPercent(inputs.growthAssumptions.fixedIncomeReturnRate)} Bonds) while preserving 100% of historical volatility, crash depths (1973, 2008), and correlations. Aligns ending wealth scale with Bivariate mode.
                          </>
                        ) : (
                          <>
                            <strong className="text-amber-400">Raw Unadjusted History:</strong> Uses actual unadjusted nominal returns from 1970–2025 (averaging 12.3% stocks / 6.7% bonds). Because historical US returns were unusually high, ending estate balances will be significantly higher ($70M–$80M+).
                          </>
                        )}
                      </p>
                    </div>

                    {/* Student-t Fat-Tail Adjustments Toggle (Only for Historical Mode) */}
                    <div className="pt-2 border-t border-slate-800/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="enableHistoricalStudentTCheckbox"
                            checked={inputs.monteCarloSettings.enableHistoricalStudentT === true}
                            onChange={(e) => updateSettings('enableHistoricalStudentT', e.target.checked)}
                            className="w-3.5 h-3.5 bg-slate-950 rounded border-slate-800 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
                          />
                          <label htmlFor="enableHistoricalStudentTCheckbox" className="text-[11px] text-slate-200 cursor-pointer select-none font-semibold">
                            Apply Student-t Fat-Tail Adjustments (df = 5)
                          </label>
                        </div>
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          inputs.monteCarloSettings.enableHistoricalStudentT === true
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}>
                          {inputs.monteCarloSettings.enableHistoricalStudentT === true ? 'Active (df = 5 Fat Tails)' : 'Standard (Empirical History)'}
                        </span>
                      </div>
                      <p className="text-[9px] text-slate-400 leading-normal pl-5">
                        {inputs.monteCarloSettings.enableHistoricalStudentT === true ? (
                          <>
                            <strong className="text-amber-400">Student-t Fat Tails Enabled:</strong> Scales annual historical return deviations by a Student-t distribution factor (5 degrees of freedom). This generates amplified outlier shocks and fat tails beyond the 1970–2025 empirical dataset to stress-test extreme market crises.
                          </>
                        ) : (
                          <>
                            <strong className="text-slate-300">Standard Historical (Recommended):</strong> Replays empirical annual returns directly from 1970–2025, preserving authentic historical fat tails (e.g. 1973–74 stagflation, 2008 GFC, 2022 rate shock) without synthetic tail amplification.
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 4: Inflation (CPI) Simulation Modeling */}
          <div className="pt-4 border-t border-slate-800/60 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Flame className="w-4 h-4 text-emerald-400" />
                <span>4. Inflation (CPI) Simulation Modeling</span>
              </label>
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                inputs.monteCarloSettings.randomizeCPI !== false
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}>
                {inputs.monteCarloSettings.randomizeCPI !== false ? 'Stochastic (Randomized)' : 'Constant (Advisor Alignment)'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="randomizeCpiCheckbox"
                checked={inputs.monteCarloSettings.randomizeCPI !== false}
                onChange={(e) => {
                  const randomize = e.target.checked;
                  onChangeInputs({
                    ...inputs,
                    monteCarloSettings: {
                      ...inputs.monteCarloSettings,
                      randomizeCPI: randomize,
                      constantCPIRate: randomize
                        ? inputs.monteCarloSettings.constantCPIRate
                        : (inputs.monteCarloSettings.constantCPIRate ?? inputs.growthAssumptions.cpiInflationRate),
                    },
                  });
                }}
                className="w-4 h-4 bg-slate-950 rounded border-slate-800 text-emerald-500 focus:ring-emerald-500 accent-emerald-500 cursor-pointer"
              />
              <label htmlFor="randomizeCpiCheckbox" className="text-xs text-slate-300 cursor-pointer select-none font-medium">
                Stochastic Annual CPI Across Trials (Historical Shocks Calibrated to CMA Baseline)
              </label>
            </div>

            {inputs.monteCarloSettings.randomizeCPI !== false ? (
              <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/60 space-y-2">
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  <strong className="text-emerald-400">Stochastic Shock Calibration:</strong> Annual inflation varies each trial by zero-centering historical 1970–2025 CPI shocks and calibrating them directly to your configured CMA secular baseline (<strong className="text-slate-100 font-mono">{formatPercent(inputs.growthAssumptions.cpiInflationRate)}</strong>{referenceProfile ? ` from ${referenceProfile.name}` : ''}).
                </p>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[10px] text-slate-400">
                  <span>Preserves empirical crisis spikes and stagflation fat tails without unbalancing 30-year secular purchasing power.</span>
                  {onOpenDocumentation && (
                    <button
                      type="button"
                      onClick={() => onOpenDocumentation('cma-volatility-drag')}
                      className="text-emerald-400 hover:text-emerald-300 underline decoration-dotted decoration-emerald-500/60 hover:decoration-emerald-400 cursor-pointer transition-colors shrink-0 text-left sm:text-right"
                      title="Learn how CMA secular inflation targets calibrate historical shocks"
                    >
                      Learn about CMA inflation shock calibration &rarr;
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-3 bg-slate-950/60 rounded-xl border border-amber-500/30 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-300 font-semibold">Constant Annual Inflation Rate (CPI):</span>
                  <div className="flex items-center gap-1.5 font-mono">
                    {referenceProfile && Math.abs((inputs.monteCarloSettings.constantCPIRate ?? inputs.growthAssumptions.cpiInflationRate) - referenceProfile.cpiInflationRate) > 0.0001 && (
                      <button
                        type="button"
                        onClick={() => updateSettings('constantCPIRate', referenceProfile.cpiInflationRate)}
                        className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5 cursor-pointer font-mono"
                        title={`Reset to ${referenceProfile.name} default (${formatPercent(referenceProfile.cpiInflationRate)})`}
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>
                          {(inputs.monteCarloSettings.constantCPIRate ?? inputs.growthAssumptions.cpiInflationRate) - referenceProfile.cpiInflationRate > 0 ? '+' : ''}
                          {(((inputs.monteCarloSettings.constantCPIRate ?? inputs.growthAssumptions.cpiInflationRate) - referenceProfile.cpiInflationRate) * 100).toFixed(1)}%
                        </span>
                      </button>
                    )}
                    <span className="text-amber-400 font-bold">
                      {formatPercent(inputs.monteCarloSettings.constantCPIRate ?? inputs.growthAssumptions.cpiInflationRate)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <RangeSlider
                    min={0.00}
                    max={0.08}
                    step={0.002}
                    value={inputs.monteCarloSettings.constantCPIRate ?? inputs.growthAssumptions.cpiInflationRate}
                    onChange={(val) => updateSettings('constantCPIRate', val)}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <div className="w-28">
                    <NumericInput
                      suffix="%"
                      allowDecimals={true}
                      min={0}
                      max={15}
                      value={Number(((inputs.monteCarloSettings.constantCPIRate ?? inputs.growthAssumptions.cpiInflationRate) * 100).toFixed(2))}
                      onChange={(val) => updateSettings('constantCPIRate', val === null ? null : val / 100)}
                    />
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  <span className="text-amber-400 font-semibold">Deterministic Constant CPI:</span> Inflation is fixed at exactly {formatPercent(inputs.monteCarloSettings.constantCPIRate ?? inputs.growthAssumptions.cpiInflationRate)}/year across every trial and year. This disables stochastic shocks and matches the standard convention of commercial financial planning software (e.g. eMoney, RightCapital, MoneyGuidePro).
                </p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Sequence of Returns Risk & Stress Testing Panel */}
      <StressTestControlPanel inputs={inputs} onChangeInputs={onChangeInputs} />

      {/* Percentile Trajectory Line Chart */}
      <div className="glass-panel rounded-2xl p-3.5 border border-slate-800 bg-slate-900/20 space-y-2">
        <div>
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Ending Portfolio Estate Percentile Trajectories</h4>
          <p className="text-[10px] text-slate-400">View final estate value outcomes across the 35-year retirement horizon.</p>
        </div>

        <div className="h-96 bg-slate-950/40 rounded-xl border border-slate-800/40 p-4">
          <Chart type="line" data={chartData} options={chartOptions} />
        </div>
      </div>

      {/* Annual Selected Return Rates Bar Chart */}
      <div className="glass-panel rounded-2xl p-3.5 border border-slate-800 bg-slate-900/20 space-y-2">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div>
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              {globalScenario === 'flat' ? 'Deterministic Flat Return Rates Baseline' : 'Stochastic Simulated Return Rates Sequence'}
            </h4>
            <p className="text-[10px] text-slate-400">
              {globalScenario === 'flat'
                ? 'Showing the baseline flat equity and fixed income return rates currently configured for the deterministic scenario.'
                : 'View the specific stock (Equity) and bond (Fixed Income) return rates simulated for each year of the selected path.'
              }
            </p>
          </div>
        </div>

        <div className="h-72 bg-slate-950/40 rounded-xl border border-slate-800/40 p-4">
          <Chart type="bar" data={barChartData} options={barChartOptions} />
        </div>
      </div>
    </div>
  );
};
