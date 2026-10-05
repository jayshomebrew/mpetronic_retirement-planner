import React, { useMemo, useState, useRef, useEffect } from 'react';
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
import { SimulationResultRow, AppStateInputs } from '../types';
import { TrendingUp, Check, Maximize2, Minimize2, ArrowUpDown, Layers } from 'lucide-react';

ChartJS.register(...registerables);

interface BracketMapChartProps {
  ledger: SimulationResultRow[];
  inputs: AppStateInputs;
  simulateSurvivor?: boolean;
}

export const BracketMapChart: React.FC<BracketMapChartProps> = ({
  ledger,
  inputs,
}) => {
  const chartRef = useRef<ChartJS<'bar' | 'line'> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [hasHiddenDatasets, setHasHiddenDatasets] = useState(false);
  const [computedHeight, setComputedHeight] = useState<number>(580);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<'cashflow' | 'balances'>(() => {
    try {
      const saved = window.localStorage.getItem('retirement_planner_chart_view_mode');
      return saved === 'balances' ? 'balances' : 'cashflow';
    } catch {
      return 'cashflow';
    }
  });

  const handleSetViewMode = (mode: 'cashflow' | 'balances') => {
    setViewMode(mode);
    setHasHiddenDatasets(false);
    try {
      window.localStorage.setItem('retirement_planner_chart_view_mode', mode);
    } catch {
      // ignore
    }
  };

  // Automatically detect screen and viewport height to maximize chart display
  useEffect(() => {
    const updateHeight = () => {
      if (typeof window === 'undefined') return;

      if (isFullscreen) {
        const headerH = headerRef.current?.offsetHeight || 60;
        const availableFs = window.innerHeight - headerH - 52;
        setComputedHeight(Math.max(450, Math.floor(availableFs)));
        return;
      }

      if (!panelRef.current) return;
      const rect = panelRef.current.getBoundingClientRect();
      const headerH = headerRef.current?.offsetHeight || 60;
      // 24px bottom buffer + 32px padding/margins
      const available = window.innerHeight - rect.top - headerH - 56;
      setComputedHeight(Math.max(450, Math.floor(available)));
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        updateHeight();
      });

      if (panelRef.current?.parentElement) {
        observer.observe(panelRef.current.parentElement);
      }
      if (document.body) {
        observer.observe(document.body);
      }
    }

    return () => {
      window.removeEventListener('resize', updateHeight);
      if (observer) observer.disconnect();
    };
  }, [isFullscreen]);

  // Handle ESC key to exit fullscreen mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Trigger chart resize when computed height updates
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.resize();
    }
  }, [computedHeight]);

  // Extract cash flow components
  const ssIncomes = useMemo(() => ledger.map((r) => r.yourSS + r.wifeSS), [ledger]);
  const rmds = useMemo(() => ledger.map((r) => r.yourRMD + r.wifeRMD), [ledger]);
  const activeSalaries = useMemo(() => ledger.map((r) => (r.yourSalary || 0) + (r.wifeSalary || 0)), [ledger]);

  // Extract account balance components
  const cashBalances = useMemo(() => ledger.map((r) => r.endYourCash + r.endWifeCash), [ledger]);
  const taxableBalances = useMemo(() => ledger.map((r) => r.endYourTaxableBrokerage + r.endWifeTaxableBrokerage), [ledger]);
  const preTaxBalances = useMemo(() => ledger.map((r) => r.endYourPreTaxIRA + r.endWifePreTaxIRA), [ledger]);
  const rothBalances = useMemo(() => ledger.map((r) => r.endYourRothIRA + r.endWifeRothIRA), [ledger]);

  const chartData = useMemo(() => {
    const isDataPresent = (data: number[]) => data.some((v) => Math.abs(v) > 0.01);

    let rawDatasets: unknown[];

    if (viewMode === 'balances') {
      rawDatasets = [
        isDataPresent(cashBalances) && {
          label: 'Cash Reserves',
          data: cashBalances,
          backgroundColor: 'rgba(56, 189, 248, 0.85)', // sky-400 @ 85%
          borderColor: '#38bdf8',
          borderWidth: 1,
          stack: 'balances',
          order: 4,
          pointStyle: 'rect',
        },
        isDataPresent(taxableBalances) && {
          label: 'Taxable Brokerage',
          data: taxableBalances,
          backgroundColor: 'rgba(59, 130, 246, 0.85)', // blue-500 @ 85%
          borderColor: '#3b82f6',
          borderWidth: 1,
          stack: 'balances',
          order: 3,
          pointStyle: 'rect',
        },
        isDataPresent(preTaxBalances) && {
          label: 'Pre-Tax (Traditional IRA/401k)',
          data: preTaxBalances,
          backgroundColor: 'rgba(245, 158, 11, 0.85)', // amber-500 @ 85%
          borderColor: '#f59e0b',
          borderWidth: 1,
          stack: 'balances',
          order: 2,
          pointStyle: 'rect',
        },
        isDataPresent(rothBalances) && {
          label: 'Roth IRA (Tax-Free)',
          data: rothBalances,
          backgroundColor: 'rgba(16, 185, 129, 0.85)', // emerald-500 @ 85%
          borderColor: '#10b981',
          borderWidth: 1,
          stack: 'balances',
          order: 1,
          pointStyle: 'rect',
        },
        // BOLD Line for Total Net Estate overlay on top of stacked account bars
        {
          label: 'Total Net Estate (Portfolio)',
          data: ledger.map((r) => r.totalPortfolioValue),
          type: 'line' as const,
          borderColor: '#ffffff', // crisp white
          borderWidth: 3,
          pointRadius: 2,
          pointHoverRadius: 5,
          fill: false,
          yAxisID: 'y',
          order: -1,
          pointStyle: 'circle',
          stack: 'line-estate',
        },
      ];
    } else {
      const taxableDraws = ledger.map((r) => r.drawdownTaxable);
      const preTaxDraws = ledger.map((r) => r.drawdownPreTax);
      const rothDraws = ledger.map((r) => r.drawdownRoth);
      const cashDraws = ledger.map((r) => r.drawdownCash);

      rawDatasets = [
        isDataPresent(activeSalaries) && {
          label: 'Active Salaries',
          data: activeSalaries,
          backgroundColor: 'rgba(139, 92, 246, 0.75)', // violet-500 @ 75% opacity
          borderColor: '#8b5cf6',
          borderWidth: 1,
          stack: 'income',
          order: 2,
          pointStyle: 'rect',
        },
        isDataPresent(ssIncomes) && {
          label: 'Social Security',
          data: ssIncomes,
          backgroundColor: 'rgba(59, 130, 246, 0.75)', // blue-500 @ 75% opacity
          borderColor: '#3b82f6',
          borderWidth: 1,
          stack: 'income',
          order: 3,
          pointStyle: 'rect',
        },
        isDataPresent(rmds) && {
          label: 'Forced RMDs',
          data: rmds,
          backgroundColor: 'rgba(245, 158, 11, 0.75)', // amber-500 @ 75% opacity
          borderColor: '#f59e0b',
          borderWidth: 1,
          stack: 'income',
          order: 4,
          pointStyle: 'rect',
        },
        isDataPresent(preTaxDraws) && {
          label: 'Pre-Tax IRA Draws',
          data: preTaxDraws,
          backgroundColor: 'rgba(217, 70, 239, 0.75)', // fuchsia-500 representing IRA ordinary income draws
          borderColor: '#d946ef',
          borderWidth: 1,
          stack: 'income',
          order: 5,
          pointStyle: 'rect',
        },
        isDataPresent(taxableDraws) && {
          label: 'Taxable Brokerage Draws',
          data: taxableDraws,
          backgroundColor: 'rgba(244, 63, 94, 0.80)', // rose-500 representing taxable brokerage liquidation
          borderColor: '#f43f5e',
          borderWidth: 1,
          stack: 'income',
          order: 6,
          pointStyle: 'rect',
        },
        isDataPresent(rothDraws) && {
          label: 'Roth Draws (Tax-Free)',
          data: rothDraws,
          backgroundColor: 'rgba(52, 211, 153, 0.85)', // emerald-400 representing tax-free Roth draws
          borderColor: '#34d399',
          borderWidth: 1,
          stack: 'income',
          order: 7,
          pointStyle: 'rect',
        },
        isDataPresent(cashDraws) && {
          label: 'Cash Draws',
          data: cashDraws,
          backgroundColor: 'rgba(249, 115, 22, 0.85)', // dark orange (orange-500)
          borderColor: '#f97316',
          borderWidth: 1,
          stack: 'income',
          order: 8,
          pointStyle: 'rect',
        },
        // BOLD Line for Portfolio Value at all times on secondary Y-axis
        {
          label: 'Total Net Estate (Portfolio)',
          data: ledger.map((r) => r.totalPortfolioValue),
          type: 'line' as const,
          borderColor: '#10b981', // emerald-500
          borderWidth: 3,
          pointRadius: 2,
          pointHoverRadius: 5,
          fill: false,
          yAxisID: 'yPortfolio',
          order: -1,
          pointStyle: 'circle',
          stack: 'line-portfolio',
        },
        // BOLD Line for Base Living Expenses on primary Y-axis
        {
          label: 'Base Living Expenses',
          data: ledger.map((r) => r.livingExpenses),
          type: 'line' as const,
          borderColor: '#fb7185', // rose-400 representing expenses/outflows
          borderWidth: 3,
          pointRadius: 2,
          pointHoverRadius: 5,
          fill: false,
          yAxisID: 'y',
          order: -2,
          pointStyle: 'triangle',
          stack: 'line-expenses',
        },
      ];
    }

    const datasets = rawDatasets.filter(Boolean) as ChartData<'bar' | 'line'>['datasets'];

    const primaryLongevity = inputs.you.longevityAge ?? 85;
    const spouseLongevity = inputs.wife?.longevityAge ?? 95;

    const labels = ledger.map((r) => {
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
  }, [
    ledger,
    inputs.isSingleFiler,
    inputs.you.longevityAge,
    inputs.wife?.longevityAge,
    viewMode,
    activeSalaries,
    ssIncomes,
    rmds,
    cashBalances,
    taxableBalances,
    preTaxBalances,
    rothBalances,
  ]);

  const chartOptions: ChartOptions<'bar' | 'line'> = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
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
            color: '#cbd5e1', // slate-300
            font: {
              size: 11,
            },
            boxWidth: 15,
            usePointStyle: true,
          },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: '#0f172a',
          titleColor: '#f1f5f9',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function (context: TooltipItem<'bar' | 'line'>) {
              let label = context.dataset.label || '';
              const row = ledger[context.dataIndex];
              const fmt = (v: number) => new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              }).format(v);

              if (!row) return label;

              const youName = inputs.you.name || 'Primary';
              const wifeName = inputs.wife?.name || 'Spouse';
              const isSingle = inputs.isSingleFiler || !row.wifeAge || row.wifeAge === 0;

              if (viewMode === 'balances') {
                const val = context.parsed.y || 0;
                if (context.dataset.label === 'Cash Reserves') {
                  const yourAmt = row.endYourCash || 0;
                  const wifeAmt = row.endWifeCash || 0;
                  const spousalBreakdown = !isSingle && (yourAmt > 0 || wifeAmt > 0)
                    ? ` (${youName}: ${fmt(yourAmt)}, ${wifeName}: ${fmt(wifeAmt)})`
                    : '';
                  return `Cash Reserves (Taxable Acct - Cash / Money Market): ${fmt(val)}${spousalBreakdown}`;
                }

                if (context.dataset.label === 'Taxable Brokerage') {
                  const yourAmt = row.endYourTaxableBrokerage || 0;
                  const wifeAmt = row.endWifeTaxableBrokerage || 0;
                  const spousalBreakdown = !isSingle && (yourAmt > 0 || wifeAmt > 0)
                    ? ` (${youName}: ${fmt(yourAmt)}, ${wifeName}: ${fmt(wifeAmt)})`
                    : '';
                  return `Taxable Brokerage (Taxable Acct - Invested Market Funds): ${fmt(val)}${spousalBreakdown}`;
                }

                if (context.dataset.label?.includes('Pre-Tax')) {
                  const yourAmt = row.endYourPreTaxIRA || 0;
                  const wifeAmt = row.endWifePreTaxIRA || 0;
                  if (!isSingle && (yourAmt > 0 || wifeAmt > 0)) {
                    return `Pre-Tax IRAs: ${fmt(val)} (${youName}: ${fmt(yourAmt)}, ${wifeName}: ${fmt(wifeAmt)})`;
                  }
                  return `Pre-Tax IRAs: ${fmt(val)}`;
                }

                if (context.dataset.label?.includes('Roth')) {
                  const yourAmt = row.endYourRothIRA || 0;
                  const wifeAmt = row.endWifeRothIRA || 0;
                  if (!isSingle && (yourAmt > 0 || wifeAmt > 0)) {
                    return `Roth IRAs: ${fmt(val)} (${youName}: ${fmt(yourAmt)}, ${wifeName}: ${fmt(wifeAmt)})`;
                  }
                  return `Roth IRAs: ${fmt(val)}`;
                }

                if (context.dataset.label?.includes('Total Net Estate')) {
                  return `Total Net Estate: ${fmt(row.totalPortfolioValue)}`;
                }

                return `${label}: ${fmt(val)}`;
              }

              // Existing Cash Flow callbacks
              if (context.dataset.label === 'Active Salaries') {
                const yourSal = row.yourSalary || 0;
                const wifeSal = row.wifeSalary || 0;
                if (yourSal > 0 && wifeSal > 0) {
                  label = `Active Salaries (${youName}: ${fmt(yourSal)}, ${wifeName}: ${fmt(wifeSal)})`;
                } else if (yourSal > 0) {
                  label = `Active Salaries (${youName})`;
                } else if (wifeSal > 0) {
                  label = `Active Salaries (${wifeName})`;
                }
              } else if (context.dataset.label === 'Social Security') {
                const yourSS = row.yourSS || 0;
                const wifeSS = row.wifeSS || 0;
                if (yourSS > 0 && wifeSS > 0) {
                  label = `Social Security (${youName}: ${fmt(yourSS)}, ${wifeName}: ${fmt(wifeSS)})`;
                } else if (yourSS > 0) {
                  label = `Social Security (${youName})`;
                } else if (wifeSS > 0) {
                  label = `Social Security (${wifeName})`;
                }
              } else if (context.dataset.label === 'Forced RMDs') {
                const yourRMD = row.yourRMD || 0;
                const wifeRMD = row.wifeRMD || 0;
                if (yourRMD > 0 && wifeRMD > 0) {
                  label = `Forced RMDs (${youName}: ${fmt(yourRMD)}, ${wifeName}: ${fmt(wifeRMD)})`;
                } else if (yourRMD > 0) {
                  label = `Forced RMDs (${youName})`;
                } else if (wifeRMD > 0) {
                  label = `Forced RMDs (${wifeName})`;
                }
              }
              
              if (label) {
                label += ': ';
              }
              if (context.parsed.y !== null) {
                label += fmt(context.parsed.y);
              }
              return label;
            },
            footer: function (tooltipItems: TooltipItem<'bar' | 'line'>[]) {
              const fmt = (v: number) => new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              }).format(v);

              if (viewMode === 'balances') {
                const row = ledger[tooltipItems[0]?.dataIndex];
                if (row) {
                  const totalVal = row.totalPortfolioValue || 0;
                  const cashVal = (row.endYourCash || 0) + (row.endWifeCash || 0);
                  const taxableInvestedVal = (row.endYourTaxableBrokerage || 0) + (row.endWifeTaxableBrokerage || 0);
                  const totalTaxableAcctVal = cashVal + taxableInvestedVal;

                  const lines: string[] = [];
                  lines.push(`\nCombined Taxable Account: ${fmt(totalTaxableAcctVal)} (${fmt(taxableInvestedVal)} invested funds + ${fmt(cashVal)} cash reserves)`);

                  if (totalVal > 0) {
                    const rothPct = Math.round(((row.endYourRothIRA + row.endWifeRothIRA) / totalVal) * 100);
                    const preTaxPct = Math.round(((row.endYourPreTaxIRA + row.endWifePreTaxIRA) / totalVal) * 100);
                    const taxableCashPct = Math.max(0, 100 - rothPct - preTaxPct);
                    lines.push(`Total Net Estate: ${fmt(totalVal)} (${rothPct}% Roth • ${preTaxPct}% Pre-Tax • ${taxableCashPct}% Taxable Acct)`);
                  }
                  return lines.join('\n');
                }
                return '';
              }

              let sum = 0;
              tooltipItems.forEach((item) => {
                if (item.dataset.stack === 'income') {
                  sum += item.parsed.y || 0;
                }
              });
              if (sum > 0) {
                return '\nTotal Annual Cash Inflows & Draws: ' + fmt(sum);
              }
              return '';
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: {
            color: 'rgba(255,255,255,0.04)',
          },
          ticks: {
            color: '#94a3b8',
            font: {
              size: 10,
            },
          },
        },
        y: {
          stacked: true,
          grid: {
            color: 'rgba(255,255,255,0.04)',
          },
          ticks: {
            color: '#94a3b8',
            font: {
              size: 10,
            },
            callback: function (value: string | number) {
              const num = Number(value);
              if (viewMode === 'balances') {
                if (Math.abs(num) >= 1000000) {
                  return '$' + (num / 1000000).toFixed(1) + 'M';
                }
                return '$' + Math.round(num / 1000) + 'k';
              }
              return '$' + (Number(value) / 1000) + 'k';
            },
          },
          title: {
            display: true,
            text: viewMode === 'balances' ? 'Ending Account Balances ($)' : 'Annual Cash Inflows & Draws',
            color: '#94a3b8',
            font: { size: 10, weight: 'bold' }
          }
        },
        yPortfolio: {
          type: 'linear' as const,
          position: 'right' as const,
          display: viewMode === 'cashflow',
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            color: '#10b981',
            font: {
              size: 10,
            },
            callback: function (value: string | number) {
              return '$' + (Number(value) / 1000000).toFixed(1) + 'M';
            },
          },
          title: {
            display: viewMode === 'cashflow',
            text: 'Portfolio Net Estate',
            color: '#10b981',
            font: { size: 10, weight: 'bold' }
          }
        }
      },
    };
  }, [ledger, inputs, viewMode]);

  return (
    <div
      ref={panelRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 p-4 md:p-6 bg-slate-950 flex flex-col overflow-hidden animate-in fade-in duration-150'
          : 'glass-panel rounded-2xl p-3.5 space-y-3 flex flex-col w-full'
      }
    >
      {/* Header Info */}
      <div
        ref={headerRef}
        className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 shrink-0"
      >
        <div>
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Lifetime Cash Flow &amp; Estate Trajectory
          </h3>
          <p className="text-xs text-slate-400">
            {viewMode === 'cashflow'
              ? 'Visualize annual cash inflows and account drawdowns funding your living expenses alongside long-term portfolio growth.'
              : 'Track the evolution of Taxable, Pre-Tax, and Roth account balances over time showing the impact of Roth conversions and drawdowns.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* View Mode Toggle Pill */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => handleSetViewMode('cashflow')}
              className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'cashflow'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="View annual cash inflows, social security, salaries, and account drawdowns"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>Cash Flows &amp; Draws</span>
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode('balances')}
              className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'balances'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="View stacked account balances over time (Taxable, Pre-Tax IRA, and Roth IRA)"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Stacked Balances</span>
            </button>
          </div>

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

          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="text-xs font-semibold px-2.5 py-1.5 bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-slate-100 border border-slate-700/60 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
            title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Maximize Chart to Fullscreen'}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden sm:inline">Exit Fullscreen</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden sm:inline">Maximize</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      <div
        style={{ height: computedHeight ? `${computedHeight}px` : '580px' }}
        className="relative bg-slate-950/40 rounded-xl border border-slate-800/40 p-3 sm:p-4 w-full transition-[height] duration-150 shrink-0"
      >
        <Chart ref={chartRef} type="bar" data={chartData} options={chartOptions} />
      </div>
    </div>
  );
};
