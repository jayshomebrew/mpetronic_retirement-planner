import React, { useMemo, useState, useRef } from 'react';
import { Chart } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  registerables,
  ChartData,
  ChartOptions,
  TooltipItem,
  LegendItem,
  ChartEvent,
} from 'chart.js';
import {
  SimulationResultRow,
  AppStateInputs,
  LockedReturnSequence,
  CustomRothScenario,
  getSimulationStartYear,
} from '../types';
import { RangeSlider } from './RangeSlider';
import { 
  Calculator,
  Sliders,
  ShieldAlert,
  Check,
  X,
  AlertCircle,
  Sparkles,
  Info,
  Zap,
  Shield,
  Gem,
  HeartPulse,
  Edit3,
  TrendingUp,
} from 'lucide-react';
import { optimizeRetirementScenario, OptimizationResult, OptimizationGoal } from '../engine/optimizer';
import { 
  getTargetPresetInfo, 
  DEFAULT_FILL_TO_TARGET_VALUE, 
  CONVERSION_TARGET_PRESETS,
  FED_STANDARD_DEDUCTION_MFJ 
} from '../engine/taxRates2026';
import { CustomRothScenarioModal } from './CustomRothScenarioModal';

ChartJS.register(...registerables);

interface TaxableIncomeWorkspaceProps {
  ledger: SimulationResultRow[];
  inputs: AppStateInputs;
  simulateSurvivor: boolean;
  activeScenarioSequence: LockedReturnSequence | null;
  onApplyOptimization: (
    annualConversion: number,
    targetValue: number | null,
    yourAge: number,
    wifeAge: number,
    strategy?: 'flat' | 'fill-to-target'
  ) => void;
  onUpdateStrategy: (strategy: 'flat' | 'fill-to-target' | 'custom') => void;
  onUpdateTargetValue: (val: number | null) => void;
  onSaveCustomScenario?: (scenario: CustomRothScenario, applyImmediately?: boolean) => void;
  onDeleteCustomScenario?: (scenarioId: string) => void;
  onSelectCustomScenario?: (scenarioId: string) => void;
  onInputsChange?: (newInputs: AppStateInputs) => void;
  selectedQuickFill: number | null;
  setSelectedQuickFill: (val: number | null) => void;
}

export const TaxableIncomeWorkspace: React.FC<TaxableIncomeWorkspaceProps> = ({
  ledger,
  inputs,
  simulateSurvivor,
  activeScenarioSequence,
  onApplyOptimization,
  onUpdateStrategy,
  onUpdateTargetValue,
  onSaveCustomScenario,
  onDeleteCustomScenario,
  onSelectCustomScenario,
  onInputsChange,
  selectedQuickFill,
  setSelectedQuickFill,
}) => {
  const chartRef = useRef<ChartJS<'bar' | 'line'> | null>(null);
  const simStartYear = getSimulationStartYear(inputs);

  // Custom scenario modal state
  const [showCustomModal, setShowCustomModal] = useState(false);

  const customScenarios = useMemo(() => inputs.customRothScenarios || [], [inputs.customRothScenarios]);
  const activeCustomScenario = useMemo(() => {
    if (inputs.rothConversionStrategy !== 'custom') return null;
    return customScenarios.find((s) => s.id === inputs.activeCustomScenarioId) || customScenarios[0] || null;
  }, [inputs.rothConversionStrategy, customScenarios, inputs.activeCustomScenarioId]);

  // Selected benchmark state (only active and defaults in fill-to-target mode)
  const isFillToTarget = inputs.rothConversionStrategy === 'fill-to-target';
  const activeTarget = useMemo(() => {
    if (!isFillToTarget) return null;
    return inputs.rothConversionTargetValue || selectedQuickFill || DEFAULT_FILL_TO_TARGET_VALUE;
  }, [isFillToTarget, inputs.rothConversionTargetValue, selectedQuickFill]);

  // Ensure a default benchmark (12% Fed Bracket - $100,800) is active in fill-to-target mode only if none exists
  React.useEffect(() => {
    if (inputs.rothConversionStrategy === 'fill-to-target' && !inputs.rothConversionTargetValue && !selectedQuickFill) {
      onUpdateTargetValue(DEFAULT_FILL_TO_TARGET_VALUE);
      setSelectedQuickFill(DEFAULT_FILL_TO_TARGET_VALUE);
    }
  }, [inputs.rothConversionStrategy, inputs.rothConversionTargetValue, selectedQuickFill, onUpdateTargetValue, setSelectedQuickFill]);

  // Optimizer modal visual state
  const [showOptimizerModal, setShowOptimizerModal] = useState(false);
  const [isOptimizingScan, setIsOptimizingScan] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<OptimizationGoal>('max_portfolio');
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [hasHiddenDatasets, setHasHiddenDatasets] = useState(false);

  // Baseline metrics for variance comparison
  const currentEndingEstate = useMemo(() => {
    const lastRow = ledger[ledger.length - 1];
    return lastRow ? lastRow.totalPortfolioValue : 0;
  }, [ledger]);

  const currentLifetimeTaxes = useMemo(() => {
    return ledger.reduce((sum, r) => sum + r.totalIncomeTax, 0);
  }, [ledger]);

  const currentLifetimeIRMAA = useMemo(() => {
    return ledger.reduce((sum, r) => sum + r.combinedSurchargeAnnual, 0);
  }, [ledger]);

  const currentEndingRoth = useMemo(() => {
    const lastRow = ledger[ledger.length - 1];
    return lastRow ? (lastRow.endYourRothIRA + lastRow.endWifeRothIRA) : 0;
  }, [ledger]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(Math.round(val || 0));
  };

  const formatYearOption = (yr: number) => {
    const row = ledger.find((r) => r.year === yr);
    let yourAge: number;
    let wifeAge: number;

    if (row) {
      yourAge = row.yourAge;
      wifeAge = row.wifeAge;
    } else {
      const delta = yr - simStartYear;
      const yourBirthYear = parseInt(inputs.you.birthDate?.split('-')[0] || '1960', 10);
      const wifeBirthYear = parseInt(inputs.wife?.birthDate?.split('-')[0] || '1964', 10);
      yourAge = yr - yourBirthYear || (65 + delta);
      wifeAge = yr - wifeBirthYear || (63 + delta);
    }

    const primaryLongevity = inputs.you.longevityAge ?? 85;
    const spouseLongevity = inputs.wife?.longevityAge ?? 95;
    const primaryAgeStr = yourAge >= primaryLongevity ? '-' : String(yourAge);
    const spouseAgeStr = wifeAge >= spouseLongevity ? '-' : String(wifeAge);

    if (inputs.isSingleFiler) {
      return `${yr} (${primaryAgeStr})`;
    }

    return `${yr} (${primaryAgeStr}/${spouseAgeStr})`;
  };

  // Parse birth year for survivor status checks
  const yourBirthYear = useMemo(() => {
    const dateStr = inputs.you.birthDate;
    if (!dateStr) return 1960;
    const match = dateStr.match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : 1960;
  }, [inputs.you.birthDate]);

  const deathYear = yourBirthYear + (inputs.you.longevityAge ?? 85);

  // Compute non-conversion taxable income breakdown for each year
  // Net Taxable Base = max(0, Non-Conversion AGI - Standard Deduction)
  // Components scaled proportionally so total stacked base equals Net Non-Conversion Taxable Income
  const processedRows = useMemo(() => {
    return ledger.map((r) => {
      const isSingle = simulateSurvivor && r.year >= deathYear;
      const rothConv = r.intentionalRothConversion || 0;
      
      // Gross income components (before standard deduction)
      const taxableSS = r.taxableSS || 0;
      const grossSalary = (r.yourSalary || 0) + (r.wifeSalary || 0);
      const employee401k = r.employee401kContribution || 0;
      const taxableSalary = Math.max(0, grossSalary - employee401k);
      const rmdsAndTradDraws = (r.yourRMD || 0) + (r.wifeRMD || 0) + (r.drawdownPreTax || 0);
      const investmentIncome = (r.taxableDividends || 0) + (r.taxableInterest || 0) + (r.capitalGainsTriggered || 0);
      const otherIncome = r.otherTaxableIncome || 0;

      const grossNonConvAGI = Math.max(0, r.fedAGI - rothConv);
      const stdDeduction = r.standardDeduction || 0;
      const netNonConvTaxable = Math.max(0, grossNonConvAGI - stdDeduction);
      const totalTaxableIncome = r.taxableIncome;

      // Scale all income components proportionally to their share of total gross income,
      // ensuring the stacked bar components exactly sum up to Total Taxable Income,
      // preserving visibility of dividends, interest, and capital gains in all years.
      const totalGrossAGI = taxableSalary + taxableSS + rmdsAndTradDraws + investmentIncome + otherIncome + rothConv;
      const globalScale = (totalGrossAGI > 0 && totalTaxableIncome > 0) ? (totalTaxableIncome / totalGrossAGI) : 0;

      const netSS = taxableSS * globalScale;
      const netSalary = taxableSalary * globalScale;
      const netRMDsDraws = rmdsAndTradDraws * globalScale;
      const netInvestment = investmentIncome * globalScale;
      const netOther = otherIncome * globalScale;
      const taxableRothConv = rothConv * globalScale;

      return {
        year: r.year,
        yourAge: r.yourAge,
        wifeAge: r.wifeAge,
        isSingle,
        cpiFactor: r.cpiFactor,
        grossNonConvAGI,
        stdDeduction,
        netNonConvTaxable,
        rothConv,
        taxableRothConv,
        netSS,
        netSalary,
        netRMDsDraws,
        netInvestment,
        netOther,
        rawDividends: (r.taxableDividends || 0) + (r.taxableInterest || 0),
        rawCapGains: r.capitalGainsTriggered || 0,
        totalTaxableIncome,
        requestedCustomRothConversion: r.requestedCustomRothConversion,
        isRothConversionCapped: r.isRothConversionCapped,
        rothConversionShortfall: r.rothConversionShortfall,
      };
    });
  }, [ledger, simulateSurvivor, deathYear]);

  // Compute dynamic benchmark line data points (indexed to Taxable Income threshold)
  const benchmarkLineData = useMemo(() => {
    if (!isFillToTarget || !activeTarget) {
      return null;
    }

    const preset = getTargetPresetInfo(activeTarget);
    const isMAGIBased = preset?.type === 'irmaa' || !preset;
    const jointBase = preset ? preset.jointBase : activeTarget;
    const singleBase = preset ? preset.singleBase : activeTarget / 2;
    const label = preset ? preset.description : `Target MAGI Limit ($${activeTarget.toLocaleString()} MAGI)`;
    const color = preset ? preset.color : 'rgba(14, 165, 233, 0.9)';

    const dataPoints = processedRows.map((r) => {
      const baseVal = r.isSingle ? singleBase : jointBase;
      const inflatedBase = baseVal * r.cpiFactor;
      // If IRMAA MAGI based, translate MAGI threshold to equivalent Taxable Income ceiling:
      // Taxable Ceiling = MAGI Limit - Standard Deduction
      if (isMAGIBased) {
        return Math.max(0, inflatedBase - r.stdDeduction);
      }
      return inflatedBase;
    });

    return {
      label,
      color,
      data: dataPoints,
      borderColor: color,
      borderWidth: 3,
      borderDash: [6, 4],
      pointRadius: 0,
      pointHoverRadius: 5,
      order: 1,
    };
  }, [isFillToTarget, activeTarget, processedRows]);

  // Chart datasets configuration
  const chartData = useMemo(() => {
    const isDataPresent = (data: number[]) => data.some((v) => Math.abs(v) > 0.01);

    const ssData = processedRows.map((r) => r.netSS);
    const salaryData = processedRows.map((r) => r.netSalary);
    const rmdsData = processedRows.map((r) => r.netRMDsDraws);
    const investmentData = processedRows.map((r) => r.netInvestment);
    const rothConvData = processedRows.map((r) => r.taxableRothConv);

    const rawDatasets = [
      isDataPresent(ssData) && {
        label: 'Taxable Social Security',
        data: ssData,
        backgroundColor: 'rgba(59, 130, 246, 0.75)', // blue-500
        stack: 'taxable',
        order: 2,
      },
      isDataPresent(salaryData) && {
        label: 'Taxable Active Salaries',
        data: salaryData,
        backgroundColor: 'rgba(139, 92, 246, 0.75)', // violet-500
        stack: 'taxable',
        order: 3,
      },
      isDataPresent(rmdsData) && {
        label: 'Forced RMDs & Pre-Tax Draws',
        data: rmdsData,
        backgroundColor: 'rgba(245, 158, 11, 0.75)', // amber-500
        stack: 'taxable',
        order: 4,
      },
      isDataPresent(investmentData) && {
        label: 'Taxable Dividends & Capital Gains',
        data: investmentData,
        backgroundColor: 'rgba(236, 72, 153, 0.75)', // pink-500
        stack: 'taxable',
        order: 5,
      },
      isDataPresent(rothConvData) && {
        label: 'Roth Conversion',
        data: rothConvData,
        backgroundColor: 'rgba(16, 185, 129, 0.9)', // emerald-500
        stack: 'taxable',
        order: 6,
      },
      benchmarkLineData && {
        type: 'line' as const,
        label: benchmarkLineData.label,
        data: benchmarkLineData.data,
        borderColor: benchmarkLineData.color,
        borderWidth: 2.5,
        borderDash: [6, 4],
        fill: false,
        pointRadius: 2,
        pointHoverRadius: 5,
        order: 1,
      },
    ];

    const datasets = rawDatasets.filter(Boolean) as ChartData<'bar' | 'line'>['datasets'];

    const primaryLongevity = inputs.you.longevityAge ?? 85;
    const spouseLongevity = inputs.wife?.longevityAge ?? 95;

    const labels = processedRows.map((r) => {
      const isSingle = inputs.isSingleFiler || !r.wifeAge || r.wifeAge === 0;
      const primaryAgeStr = r.yourAge >= primaryLongevity ? '-' : String(r.yourAge);
      const spouseAgeStr = r.wifeAge >= spouseLongevity ? '-' : String(r.wifeAge);
      const ageLabel = isSingle ? `(${primaryAgeStr})` : `(${primaryAgeStr}/${spouseAgeStr})`;
      return [String(r.year), ageLabel];
    });

    return {
      labels,
      datasets,
    };
  }, [processedRows, benchmarkLineData, inputs.isSingleFiler, inputs.you.longevityAge, inputs.wife?.longevityAge]);

  // Chart options
  const chartOptions: ChartOptions<'bar' | 'line'> = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
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
            
            // Update hasHiddenDatasets state to conditionally render Reset Legend UI
            let anyHidden = false;
            ci.data.datasets.forEach((_, i: number) => {
              if (!ci.isDatasetVisible(i)) {
                anyHidden = true;
              }
            });
            setHasHiddenDatasets(anyHidden);
          },
          labels: {
            color: '#cbd5e1',
            font: { size: 11, weight: 'bold' as const },
            usePointStyle: true,
            boxWidth: 10,
            padding: 16,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(51, 65, 85, 0.8)',
          borderWidth: 1,
          padding: 12,
          boxPadding: 6,
          usePointStyle: true,
          callbacks: {
            title: (items: TooltipItem<'bar' | 'line'>[]) => {
              if (!items.length) return '';
              const idx = items[0].dataIndex;
              const r = processedRows[idx];
              const primaryLongevity = inputs.you.longevityAge ?? 85;
              const spouseLongevity = inputs.wife?.longevityAge ?? 95;
              const primaryAgeStr = r.yourAge >= primaryLongevity ? '-' : String(r.yourAge);
              const spouseAgeStr = r.wifeAge >= spouseLongevity ? '-' : String(r.wifeAge);
              if (inputs.isSingleFiler || !r.wifeAge || r.wifeAge === 0) {
                return `Year ${r.year} (Age: ${primaryAgeStr})`;
              }
              return `Year ${r.year} (Ages: You ${primaryAgeStr} / Spouse ${spouseAgeStr})`;
            },
            label: (context: TooltipItem<'bar' | 'line'>) => {
              const label = context.dataset.label || '';
              const rawVal = context.parsed.y ?? (context.raw as number) ?? 0;
              return `${label}: ${formatCurrency(rawVal)}`;
            },
            footer: (items: TooltipItem<'bar' | 'line'>[]) => {
              if (!items.length) return '';
              const idx = items[0].dataIndex;
              const r = processedRows[idx];
              const lines = [
                '-----------------------------------',
                `Gross Federal AGI: ${formatCurrency(r.grossNonConvAGI + r.rothConv)}`,
                `Deductions (Std / Itemized): -${formatCurrency(r.stdDeduction)}`,
                `Net Non-Conv Taxable: ${formatCurrency(r.netNonConvTaxable)}`,
                `Roth Conversion: +${formatCurrency(r.rothConv)}`,
                `TOTAL TAXABLE INCOME: ${formatCurrency(r.totalTaxableIncome)}`,
              ];

              if (benchmarkLineData && benchmarkLineData.data[idx] !== undefined) {
                const limit = benchmarkLineData.data[idx];
                const headroom = limit - r.totalTaxableIncome;
                lines.push(
                  `Target Upper Limit: ${formatCurrency(limit)}`,
                  `Headroom Remaining: ${headroom >= 0 ? '+' : ''}${formatCurrency(headroom)}`
                );
              }

              lines.push(
                '-----------------------------------',
                `Dividends & Interest: ${formatCurrency(r.rawDividends)}`,
                `Net Realized Cap Gains: ${formatCurrency(r.rawCapGains)} (excl. basis)`
              );

              return lines.join('\n');
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(51, 65, 85, 0.3)' },
          ticks: { color: '#94a3b8', font: { size: 10 } },
        },
        y: {
          grid: { color: 'rgba(51, 65, 85, 0.3)' },
          ticks: {
            color: '#94a3b8',
            font: { size: 10 },
            callback: (val: string | number) => `$${(Number(val) / 1000).toFixed(0)}k`,
          },
          stacked: true,
        },
      },
    };
  }, [processedRows, benchmarkLineData, inputs.isSingleFiler, inputs.you.longevityAge, inputs.wife?.longevityAge]);

  // Key KPI summary statistics across conversion window years
  const kpiStats = useMemo(() => {
    let convStart = inputs.rothConversionStartYear || ledger[0]?.year || 2026;
    let convEnd = inputs.rothConversionEndYear || (ledger[0]?.year ? ledger[0].year + 5 : 2031);

    if (inputs.rothConversionStrategy === 'custom' && activeCustomScenario) {
      const customYears = Object.keys(activeCustomScenario.schedule).map(Number).sort((a, b) => a - b);
      if (customYears.length > 0) {
        convStart = customYears[0];
        convEnd = customYears[customYears.length - 1];
      }
    }

    const convRows = processedRows.filter((r) => r.year >= convStart && r.year <= convEnd);
    const targetRows = convRows.length > 0 ? convRows : processedRows.slice(0, 5);

    const maxTaxable = Math.max(...processedRows.map((r) => r.totalTaxableIncome));
    const totalConversions = processedRows.reduce((sum, r) => sum + r.rothConv, 0);

    let avgHeadroom = 0;
    let breachedYears = 0;

    if (benchmarkLineData) {
      avgHeadroom = targetRows.reduce((sum, r) => {
        const rowIdx = ledger.findIndex((l) => l.year === r.year);
        const limit = benchmarkLineData.data[rowIdx >= 0 ? rowIdx : 0];
        return sum + (limit - r.totalTaxableIncome);
      }, 0) / (targetRows.length || 1);

      breachedYears = processedRows.filter((r, idx) => r.totalTaxableIncome > benchmarkLineData.data[idx]).length;
    }

    return { convStart, convEnd, maxTaxable, avgHeadroom, totalConversions, breachedYears };
  }, [inputs, ledger, processedRows, benchmarkLineData, activeCustomScenario]);

  // Quick Preset Selection Buttons handler
  const handleSelectPreset = (targetVal: number) => {
    setSelectedQuickFill(targetVal);
    onUpdateTargetValue(targetVal);
    if (inputs.rothConversionStrategy !== 'fill-to-target') {
      onUpdateStrategy('fill-to-target');
    }
  };

  // Run Optimizer Scan
  const runOptimizationScan = (goal: OptimizationGoal = selectedGoal) => {
    setIsOptimizingScan(true);
    setTimeout(() => {
      try {
        const result = optimizeRetirementScenario(
          inputs,
          goal,
          simulateSurvivor,
          activeScenarioSequence
        );
        setOptimizationResult(result);
      } catch (err) {
        console.error('Optimization error:', err);
      } finally {
        setIsOptimizingScan(false);
      }
    }, 120);
  };

  const handleRunOptimizer = () => {
    setShowOptimizerModal(true);
    runOptimizationScan(selectedGoal);
  };

  const renderVarianceBadge = (current: number, optimal: number, type: 'higher-is-better' | 'lower-is-better') => {
    const diff = optimal - current;
    if (Math.abs(diff) < 1) {
      return <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 font-mono font-semibold">No Change</span>;
    }
    
    const isGood = type === 'higher-is-better' ? diff > 0 : diff < 0;
    const formattedDiff = formatCurrency(Math.abs(diff));
    const sign = diff > 0 ? '+' : '-';
    const label = type === 'higher-is-better' ? (diff > 0 ? 'Gained' : 'Reduced') : (diff < 0 ? 'Saved' : 'Increased');
    
    return (
      <span className={`text-xs px-2.5 py-1 rounded-full font-mono font-semibold flex items-center gap-1 ${
        isGood 
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
      }`}>
        {isGood ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
        {sign}{formattedDiff} {label}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      {/* Streamlined Top Control Card (~52px height) */}
      <div className="glass-panel p-3.5 rounded-2xl border border-slate-800 bg-slate-900/80 shadow-md space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Title & Info */}
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Calculator className="w-4 h-4" />
            </div>
            <h2 className="text-base font-black text-slate-100 tracking-tight whitespace-nowrap">
              Taxable Income & Roth Conversions Planner
            </h2>
            <div 
              className="group relative cursor-help text-slate-400 hover:text-slate-200"
              title="Stack non-conversion taxable income (AGI after standard deduction) with Roth conversions to stay cleanly under Federal Tax Brackets or Medicare IRMAA limits."
            >
              <Info className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* Controls: Strategy, Window Years & Auto-Fill */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Strategy Mode Toggle */}
            <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => {
                  onUpdateStrategy('fill-to-target');
                }}
                className={`text-[10px] px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  inputs.rothConversionStrategy === 'fill-to-target'
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Fill-to-Target
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateStrategy('flat');
                }}
                className={`text-[10px] px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  inputs.rothConversionStrategy === 'flat'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Flat Target
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateStrategy('custom');
                  if (!inputs.customRothScenarios || inputs.customRothScenarios.length === 0) {
                    setShowCustomModal(true);
                  }
                }}
                className={`text-[10px] px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  inputs.rothConversionStrategy === 'custom'
                    ? 'bg-purple-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Custom Schedule
              </button>
            </div>

            {/* Conversion Window Controls */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300">
              <span className="text-[10px] font-sans text-slate-400">Window:</span>
              <select
                value={inputs.rothConversionStartYear !== undefined ? inputs.rothConversionStartYear : (simStartYear + 1)}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (onInputsChange) {
                    onInputsChange({ ...inputs, rothConversionStartYear: val });
                  }
                }}
                className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[11px] text-emerald-400 font-bold font-mono focus:outline-none cursor-pointer"
                title="Roth Conversion Start Year"
              >
                {Array.from({ length: 25 }, (_, i) => simStartYear + i).map((yr) => (
                  <option key={yr} value={yr}>
                    {formatYearOption(yr)}
                  </option>
                ))}
              </select>
              <span className="text-slate-500">–</span>
              <select
                value={inputs.rothConversionEndYear !== undefined ? inputs.rothConversionEndYear : (simStartYear + 8)}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (onInputsChange) {
                    onInputsChange({ ...inputs, rothConversionEndYear: val });
                  }
                }}
                className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[11px] text-emerald-400 font-bold font-mono focus:outline-none cursor-pointer"
                title="Roth Conversion End Year"
              >
                {Array.from({ length: 35 }, (_, i) => simStartYear + i).map((yr) => (
                  <option key={yr} value={yr}>
                    {formatYearOption(yr)}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleRunOptimizer}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-950/50 cursor-pointer active:scale-95 shrink-0"
              title="Run algorithmic scan across all tax brackets and conversion years to maximize ending estate"
            >
              <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
              <span>Run Strategy Optimizer</span>
            </button>
          </div>
        </div>

        {/* Row 2: Strategy Configuration (Benchmark Pills for Fill-to-Target, Slider for Flat, or Dropdown for Custom) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/60 min-h-[36px]">
          {inputs.rothConversionStrategy === 'fill-to-target' ? (
            <>
              <div className="flex flex-wrap items-center gap-2 overflow-x-auto custom-scrollbar">
                {/* Federal Brackets */}
                <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-400 px-1.5 uppercase font-mono">Fed:</span>
                  {CONVERSION_TARGET_PRESETS.filter((p) => p.type === 'bracket').map((p) => {
                    const isSelected =
                      activeTarget === p.targetValue ||
                      (activeTarget !== null && activeTarget === p.jointBase + FED_STANDARD_DEDUCTION_MFJ);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectPreset(p.targetValue)}
                        className={`text-[10px] px-2 py-0.5 rounded-lg font-bold transition-all border cursor-pointer ${
                          isSelected
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/60 font-black'
                            : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border-slate-800'
                        }`}
                      >
                        {p.shortLabel}
                      </button>
                    );
                  })}
                </div>

                {/* IRMAA Tiers */}
                <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
                  <span className="text-[9px] font-bold text-slate-400 px-1.5 uppercase font-mono">IRMAA:</span>
                  {CONVERSION_TARGET_PRESETS.filter((p) => p.type === 'irmaa').map((p) => {
                    const isSelected =
                      activeTarget === p.targetValue ||
                      (activeTarget !== null && Math.abs(activeTarget - p.targetValue) <= 1);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectPreset(p.targetValue)}
                        className={`text-[10px] px-2 py-0.5 rounded-lg font-bold transition-all border cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 font-black'
                            : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border-slate-800'
                        }`}
                      >
                        {p.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Line Badge */}
              {activeTarget && benchmarkLineData && (
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md shrink-0">
                  Active: {benchmarkLineData.label}
                </span>
              )}
            </>
          ) : inputs.rothConversionStrategy === 'custom' ? (
            <div className="flex flex-wrap items-center justify-between gap-3 w-full">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">
                  Custom Plan:
                </span>
                {customScenarios.length > 0 ? (
                  <select
                    value={inputs.activeCustomScenarioId || customScenarios[0]?.id || ''}
                    onChange={(e) => {
                      if (onSelectCustomScenario) {
                        onSelectCustomScenario(e.target.value);
                      }
                    }}
                    className="bg-slate-950 text-purple-300 font-bold border border-purple-500/40 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-purple-400 cursor-pointer"
                  >
                    {customScenarios.map((scen) => (
                      <option key={scen.id} value={scen.id}>
                        {scen.name} ({Object.keys(scen.schedule).length} yrs)
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-slate-500 italic">No custom plans saved yet</span>
                )}

                <button
                  type="button"
                  onClick={() => setShowCustomModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 text-xs font-bold transition-all cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>{customScenarios.length > 0 ? 'Edit / New Custom Plan' : '+ Create Custom Plan'}</span>
                </button>
              </div>

              {activeCustomScenario && (
                <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-md shrink-0">
                  Active: {activeCustomScenario.name} ({Object.keys(activeCustomScenario.schedule).length} yrs, {formatCurrency(Object.values(activeCustomScenario.schedule).reduce((a, b) => a + (b || 0), 0))})
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800 text-[11px] font-mono text-slate-300">
                <span className="text-[10px] font-sans text-slate-400 font-bold uppercase tracking-wider">Annual Flat Amount:</span>
                <RangeSlider
                  min={0}
                  max={500000}
                  step={5000}
                  value={inputs.annualRothConversion}
                  onChange={(val) => {
                    if (onInputsChange) {
                      onInputsChange({ ...inputs, annualRothConversion: val });
                    }
                  }}
                  className="w-48 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  title="Annual Flat Conversion Amount"
                  renderLabel={(displayVal) => (
                    <span className="text-amber-400 font-black font-mono text-xs inline-block min-w-[90px] text-right">
                      {formatCurrency(displayVal)}/yr
                    </span>
                  )}
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-500 font-mono hidden md:inline">
                  Converts a fixed dollar amount each year regardless of bracket headroom
                </span>
                <button
                  type="button"
                  onClick={() => setShowCustomModal(true)}
                  className="text-xs text-purple-400 hover:text-purple-300 font-semibold underline cursor-pointer"
                >
                  Custom Plan Editor
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4 Summary Metric Cards - Compact Single Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {/* Card 1: Conversion Window */}
        <div className="glass-panel rounded-xl px-3 py-2 flex items-center justify-between border-l-4 border-l-emerald-500 bg-slate-900/60">
          <div className="min-w-0">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">
              Roth Conversion Window
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-base font-black text-emerald-400 font-mono">
                {kpiStats.convStart} – {kpiStats.convEnd}
              </span>
              <span className="text-[9px] text-slate-500 font-mono truncate">
                ({formatCurrency(kpiStats.totalConversions)})
              </span>
            </div>
          </div>
          <Sliders className="w-5 h-5 text-emerald-500/50 shrink-0 ml-2" />
        </div>

        {/* Card 2: Peak Taxable Income */}
        <div className="glass-panel rounded-xl px-3 py-2 flex items-center justify-between border-l-4 border-l-blue-500 bg-slate-900/60">
          <div className="min-w-0">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">
              Peak Taxable Income
            </span>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-base font-black text-blue-400 font-mono">
                {formatCurrency(kpiStats.maxTaxable)}
              </span>
              <span className="text-[9px] text-slate-500 font-mono truncate">
                in window
              </span>
            </div>
          </div>
          <TrendingUp className="w-5 h-5 text-blue-500/50 shrink-0 ml-2" />
        </div>

        {/* Card 3: Avg Headroom to Limit (Fill-to-Target), Active Custom Plan (Custom), or Annual Flat Conversion (Flat) */}
        {isFillToTarget ? (
          <div className="glass-panel rounded-xl px-3 py-2 flex items-center justify-between border-l-4 border-l-amber-500 bg-slate-900/60">
            <div className="min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">
                Avg Headroom to Limit
              </span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className={`text-base font-black font-mono ${kpiStats.avgHeadroom >= 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {formatCurrency(kpiStats.avgHeadroom)}
                </span>
                <span className="text-[9px] text-slate-500 font-mono truncate">
                  under target
                </span>
              </div>
            </div>
            <ShieldAlert className="w-5 h-5 text-amber-500/50 shrink-0 ml-2" />
          </div>
        ) : inputs.rothConversionStrategy === 'custom' ? (
          <div className="glass-panel rounded-xl px-3 py-2 flex items-center justify-between border-l-4 border-l-purple-500 bg-slate-900/60">
            <div className="min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">
                Active Custom Plan
              </span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-base font-black font-mono text-purple-400 truncate">
                  {activeCustomScenario ? activeCustomScenario.name : 'Custom Schedule'}
                </span>
                <span className="text-[9px] text-slate-500 font-mono truncate">
                  ({activeCustomScenario ? Object.keys(activeCustomScenario.schedule).length : 0} yrs)
                </span>
              </div>
            </div>
            <Sliders className="w-5 h-5 text-purple-500/50 shrink-0 ml-2" />
          </div>
        ) : (
          <div className="glass-panel rounded-xl px-3 py-2 flex items-center justify-between border-l-4 border-l-amber-500 bg-slate-900/60">
            <div className="min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">
                Annual Flat Target
              </span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-base font-black font-mono text-amber-400">
                  {formatCurrency(inputs.annualRothConversion)}
                </span>
                <span className="text-[9px] text-slate-500 font-mono truncate">
                  per year
                </span>
              </div>
            </div>
            <Sliders className="w-5 h-5 text-amber-500/50 shrink-0 ml-2" />
          </div>
        )}

        {/* Card 4: Limit Breaches (Fill-to-Target) OR Total Lifetime Taxes (Flat / Custom) */}
        {isFillToTarget ? (
          <div className="glass-panel rounded-xl px-3 py-2 flex items-center justify-between border-l-4 border-l-purple-500 bg-slate-900/60">
            <div className="min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">
                Limit Overages
              </span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className={`text-base font-black font-mono ${kpiStats.breachedYears === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {kpiStats.breachedYears} {kpiStats.breachedYears === 1 ? 'Yr' : 'Yrs'}
                </span>
                <span className="text-[9px] text-slate-500 font-mono truncate">
                  exceeding line
                </span>
              </div>
            </div>
            <AlertCircle className="w-5 h-5 text-purple-500/50 shrink-0 ml-2" />
          </div>
        ) : (
          <div className="glass-panel rounded-xl px-3 py-2 flex items-center justify-between border-l-4 border-l-purple-500 bg-slate-900/60">
            <div className="min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">
                Lifetime Income Taxes
              </span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-base font-black font-mono text-purple-400">
                  {formatCurrency(currentLifetimeTaxes)}
                </span>
                <span className="text-[9px] text-slate-500 font-mono truncate">
                  total horizon
                </span>
              </div>
            </div>
            <Shield className="w-5 h-5 text-purple-500/50 shrink-0 ml-2" />
          </div>
        )}
      </div>

      {/* Main Stacked Bar Chart */}
      <div className="glass-panel p-3.5 rounded-2xl border border-slate-800 bg-slate-900/40 shadow-xl space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Calculator className="w-4 h-4 text-emerald-400" />
            Taxable Income & Roth Conversion Stack
          </h3>
          {hasHiddenDatasets && (
            <button
              onClick={() => {
                if (chartRef.current) {
                  const chart = chartRef.current;
                  chart.data.datasets.forEach((_, i: number) => {
                    chart.setDatasetVisibility(i, true);
                  });
                  chart.update();
                  setHasHiddenDatasets(false);
                }
              }}
              className="text-xs font-semibold px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Show All Categories</span>
            </button>
          )}
        </div>

        <div className="h-[540px] w-full">
          <Chart ref={chartRef} type="bar" data={chartData} options={chartOptions} />
        </div>
      </div>

      {/* Detailed Audit Table */}
      <div className="glass-panel p-3.5 rounded-2xl border border-slate-800 bg-slate-900/40 shadow-xl space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Info className="w-4 h-4 text-indigo-400" />
            Year-by-Year Taxable Income & Headroom Ledger
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            Showing {processedRows.length} simulation years
          </span>
        </div>

        <div className="overflow-auto max-h-[600px] rounded-xl border border-slate-800 bg-slate-950/20 custom-scrollbar">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-900">
              <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                <th className="py-2.5 px-3">Year</th>
                <th className="py-2.5 px-3">Ages</th>
                <th className="py-2.5 px-3">Gross Non-Conv AGI</th>
                <th className="py-2.5 px-3">Std Deduction</th>
                <th className="py-2.5 px-3">Net Non-Conv Taxable</th>
                <th className="py-2.5 px-3">Roth Conv</th>
                <th className="py-2.5 px-3">Total Taxable Income</th>
                <th className="py-2.5 px-3">Target Limit</th>
                <th className="py-2.5 px-3">Headroom</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {processedRows.map((r, idx) => {
                const limit = benchmarkLineData?.data[idx];
                const headroom = limit !== undefined ? limit - r.totalTaxableIncome : null;
                const isBreached = headroom !== null && headroom < 0;
                const isConvYear = r.rothConv > 0;

                return (
                  <tr
                    key={r.year}
                    className={`hover:bg-slate-800/40 transition-colors ${
                      isConvYear ? 'bg-emerald-950/20' : ''
                    }`}
                  >
                    <td className="py-2 px-3 font-bold text-slate-100">{r.year}</td>
                    <td className="py-2 px-3 text-slate-400">
                      {inputs.isSingleFiler 
                        ? (r.yourAge >= (inputs.you.longevityAge ?? 85) ? '-' : r.yourAge)
                        : `${r.yourAge >= (inputs.you.longevityAge ?? 85) ? '-' : r.yourAge} / ${r.wifeAge >= (inputs.wife?.longevityAge ?? 95) ? '-' : r.wifeAge}`}
                    </td>
                    <td className="py-2 px-3">{formatCurrency(r.grossNonConvAGI)}</td>
                    <td className="py-2 px-3 text-slate-400">-{formatCurrency(r.stdDeduction)}</td>
                    <td className="py-2 px-3 font-semibold text-slate-200">{formatCurrency(r.netNonConvTaxable)}</td>
                    <td className="py-2 px-3 font-bold text-emerald-400">
                      {r.rothConv > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <span>{formatCurrency(r.rothConv)}</span>
                          {r.isRothConversionCapped && (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold cursor-help"
                              title={`Requested conversion was ${formatCurrency(r.requestedCustomRothConversion || 0)}, but was capped due to exhausted pre-tax IRA balance.`}
                            >
                              ⚠️ Capped
                            </span>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 px-3 font-black text-slate-100">{formatCurrency(r.totalTaxableIncome)}</td>
                    <td className="py-2 px-3 text-slate-400">
                      {limit !== undefined ? formatCurrency(limit) : '—'}
                    </td>
                    <td className={`py-2 px-3 font-bold ${
                      headroom === null ? 'text-slate-500' : isBreached ? 'text-rose-400' : 'text-emerald-400'
                    }`}>
                      {headroom !== null ? (headroom >= 0 ? `+${formatCurrency(headroom)}` : formatCurrency(headroom)) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Optimizer Modal */}
      {showOptimizerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <div className="glass-panel max-w-2xl w-full p-6 rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl space-y-6 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-100">Retirement Strategy Optimizer</h3>
                  <p className="text-xs text-slate-400">
                    Multidimensional scenario engine sweeping 1,700+ conversion and claiming milestone combinations
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOptimizerModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold p-1.5 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Goal Switcher Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedGoal('max_portfolio');
                  runOptimizationScan('max_portfolio');
                }}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  selectedGoal === 'max_portfolio'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60 shadow-md shadow-emerald-950/40'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span>Max Net Estate</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedGoal('min_taxes');
                  runOptimizationScan('min_taxes');
                }}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  selectedGoal === 'min_taxes'
                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/60 shadow-md shadow-blue-950/40'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <Shield className="w-3.5 h-3.5 text-blue-400" />
                <span>Min Taxes</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedGoal('max_roth');
                  runOptimizationScan('max_roth');
                }}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  selectedGoal === 'max_roth'
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/60 shadow-md shadow-purple-950/40'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <Gem className="w-3.5 h-3.5 text-purple-400" />
                <span>Max Roth</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedGoal('min_surcharges');
                  runOptimizationScan('min_surcharges');
                }}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  selectedGoal === 'min_surcharges'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-md shadow-amber-950/40'
                    : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <HeartPulse className="w-3.5 h-3.5 text-amber-400" />
                <span>Min IRMAA</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto space-y-4 flex-1 custom-scrollbar pr-1">
              {isOptimizingScan ? (
                <div className="py-16 flex flex-col items-center justify-center space-y-4">
                  <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin" />
                  <div className="text-center space-y-1">
                    <p className="text-sm font-bold text-slate-200">Evaluating 1,700+ Multi-Year Scenarios...</p>
                    <p className="text-xs text-slate-500">
                      Optimizing Roth conversion rates, bracket headroom, and Social Security claiming milestones
                    </p>
                  </div>
                </div>
              ) : optimizationResult ? (
                <div className="space-y-4 animate-in fade-in duration-200">
                  {/* Recommended Strategy Callout Banner */}
                  <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-sm text-emerald-400 uppercase tracking-wider font-mono">
                      <Check className="w-4 h-4" />
                      <span>Recommended Strategy</span>
                    </div>
                    <div className="text-base font-black text-slate-100">
                      {optimizationResult.bestStrategy === 'fill-to-target' ? (
                        <>Fill-to-Target ({getTargetPresetInfo(optimizationResult.bestTargetValue)?.description || `Target Limit: ${formatCurrency(optimizationResult.bestTargetValue || 0)}`})</>
                      ) : (
                        <>Flat Conversion ({formatCurrency(optimizationResult.bestAnnualRothConversion)} / year)</>
                      )}
                    </div>
                    <p className="text-xs text-slate-300">
                      Claim Social Security at <span className="font-bold text-white">Age {optimizationResult.bestYourSSAge}</span> for {inputs.you.name || 'You'}
                      {!inputs.isSingleFiler && <> and <span className="font-bold text-white">Age {optimizationResult.bestWifeSSAge}</span> for {inputs.wife.name || 'Spouse'}</>}.
                    </p>
                  </div>

                  {/* Comparative Metrics Grid */}
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
                      Lifetime Financial Impact Comparison
                    </h4>

                    <div className="grid grid-cols-1 gap-2.5">
                      {/* Metric 1: Net Ending Estate */}
                      <div className="bg-slate-950/40 border border-slate-800/60 p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold text-slate-200">Ending Net Estate</span>
                          <span className="text-[10px] text-slate-500 block">Total portfolio value remaining at simulation end</span>
                        </div>
                        <div className="flex items-center gap-4 justify-between sm:justify-end">
                          <div className="flex items-baseline gap-2 font-mono">
                            <span className="text-xs text-slate-500">{formatCurrency(currentEndingEstate)}</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-sm font-black text-emerald-400">{formatCurrency(optimizationResult.details.endingEstate)}</span>
                          </div>
                          {renderVarianceBadge(currentEndingEstate, optimizationResult.details.endingEstate, 'higher-is-better')}
                        </div>
                      </div>

                      {/* Metric 2: Lifetime Taxes */}
                      <div className="bg-slate-950/40 border border-slate-800/60 p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold text-slate-200">Lifetime Income Taxes</span>
                          <span className="text-[10px] text-slate-500 block">Total Federal + State income taxes paid over horizon</span>
                        </div>
                        <div className="flex items-center gap-4 justify-between sm:justify-end">
                          <div className="flex items-baseline gap-2 font-mono">
                            <span className="text-xs text-slate-500">{formatCurrency(currentLifetimeTaxes)}</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-sm font-black text-rose-400">{formatCurrency(optimizationResult.details.lifetimeTaxes)}</span>
                          </div>
                          {renderVarianceBadge(currentLifetimeTaxes, optimizationResult.details.lifetimeTaxes, 'lower-is-better')}
                        </div>
                      </div>

                      {/* Metric 3: Medicare Surcharges */}
                      <div className="bg-slate-950/40 border border-slate-800/60 p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold text-slate-200">Lifetime Medicare IRMAA</span>
                          <span className="text-[10px] text-slate-500 block">Total IRMAA Part B & D surcharges from lookback MAGI</span>
                        </div>
                        <div className="flex items-center gap-4 justify-between sm:justify-end">
                          <div className="flex items-baseline gap-2 font-mono">
                            <span className="text-xs text-slate-500">{formatCurrency(currentLifetimeIRMAA)}</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-sm font-black text-amber-400">{formatCurrency(optimizationResult.details.lifetimeIRMAA)}</span>
                          </div>
                          {renderVarianceBadge(currentLifetimeIRMAA, optimizationResult.details.lifetimeIRMAA, 'lower-is-better')}
                        </div>
                      </div>

                      {/* Metric 4: Ending Roth Value */}
                      <div className="bg-slate-950/40 border border-slate-800/60 p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="space-y-0.5">
                          <span className="text-xs font-bold text-slate-200">Ending Roth Balances</span>
                          <span className="text-[10px] text-slate-500 block">Total tax-free Roth wealth preserved for heirs</span>
                        </div>
                        <div className="flex items-center gap-4 justify-between sm:justify-end">
                          <div className="flex items-baseline gap-2 font-mono">
                            <span className="text-xs text-slate-500">{formatCurrency(currentEndingRoth)}</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-sm font-black text-purple-400">{formatCurrency(optimizationResult.details.endingRoth)}</span>
                          </div>
                          {renderVarianceBadge(currentEndingRoth, optimizationResult.details.endingRoth, 'higher-is-better')}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Modal Footer */}
            {!isOptimizingScan && optimizationResult && (
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowOptimizerModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all cursor-pointer"
                >
                  Dismiss / Keep Current
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const isFill = optimizationResult.bestStrategy === 'fill-to-target';
                    const targetVal = isFill ? optimizationResult.bestTargetValue : null;
                    onApplyOptimization(
                      optimizationResult.bestAnnualRothConversion,
                      targetVal,
                      optimizationResult.bestYourSSAge,
                      optimizationResult.bestWifeSSAge,
                      optimizationResult.bestStrategy
                    );
                    setSelectedQuickFill(targetVal);
                    setShowOptimizerModal(false);
                  }}
                  className="px-5 py-2 bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400 text-slate-950 font-bold rounded-xl text-xs shadow-lg shadow-emerald-500/20 transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Apply Optimal Strategy</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom Roth Scenario Editor Modal */}
      {showCustomModal && (
        <CustomRothScenarioModal
          isOpen={showCustomModal}
          onClose={() => setShowCustomModal(false)}
          inputs={inputs}
          ledger={ledger}
          simulateSurvivor={simulateSurvivor}
          activeScenarioId={inputs.activeCustomScenarioId}
          onSaveScenario={(scenario, applyImmediately) => {
            if (onSaveCustomScenario) {
              onSaveCustomScenario(scenario, applyImmediately);
            }
          }}
          onDeleteScenario={(scenarioId) => {
            if (onDeleteCustomScenario) {
              onDeleteCustomScenario(scenarioId);
            }
          }}
        />
      )}
    </div>
  );
};
