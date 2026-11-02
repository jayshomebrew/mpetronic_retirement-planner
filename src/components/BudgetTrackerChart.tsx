import React, { useMemo } from 'react';
import { Chart } from 'react-chartjs-2';
import { Chart as ChartJS, registerables } from 'chart.js';
import { MONTH_LABELS, computeBudgetTracker } from '../utils/budgetTracker';

ChartJS.register(...registerables);

interface BudgetTrackerChartProps {
  monthlyActual: number[];
  monthlyBudget: number[];
  selectedYear: number;
  formatCurrency: (val: number | null | undefined) => string;
}

const AXIS_TICK_COLOR = '#94a3b8';
const GRID_COLOR = 'rgba(51, 65, 85, 0.2)';

export const BudgetTrackerChart: React.FC<BudgetTrackerChartProps> = ({
  monthlyActual,
  monthlyBudget,
  selectedYear,
  formatCurrency,
}) => {
  const t = useMemo(
    () => computeBudgetTracker(monthlyActual, monthlyBudget, selectedYear),
    [monthlyActual, monthlyBudget, selectedYear]
  );

  const cumulativeData = useMemo(() => ({
    labels: MONTH_LABELS,
    datasets: [
      {
        label: 'Cumulative Budget',
        data: t.cumBudget,
        borderColor: '#f59e0b',
        backgroundColor: '#f59e0b',
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 2,
        tension: 0.2,
      },
      {
        label: 'Cumulative Actual',
        data: t.cumActual.map((v, m) => (m <= t.lastIdx ? v : null)),
        borderColor: '#34d399',
        backgroundColor: '#34d399',
        borderWidth: 3,
        pointRadius: 3,
        tension: 0.2,
        fill: {
          target: 0,
          above: 'rgba(244, 63, 94, 0.25)',
          below: 'rgba(52, 211, 153, 0.25)',
        },
      },
      {
        label: 'Projected Actual',
        data: t.projection,
        borderColor: 'rgba(52, 211, 153, 0.6)',
        backgroundColor: 'rgba(52, 211, 153, 0.6)',
        borderDash: [2, 4],
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
      },
    ],
  }), [t]);

  const varianceData = useMemo(() => ({
    labels: MONTH_LABELS,
    datasets: [
      {
        label: 'Under (+) / Over (-) Budget',
        data: t.variance,
        backgroundColor: t.variance.map((v) => ((v ?? 0) >= 0 ? 'rgba(52, 211, 153, 0.8)' : 'rgba(244, 63, 94, 0.8)')),
      },
    ],
  }), [t]);

  const ytdVariance = t.ytdBudget - t.ytdActual;
  const projectedVariance = t.annualBudget - t.projectedYearEnd;
  const tiles: Array<{ label: string; value: string; tone: string }> = [
    { label: 'YTD Actual', value: formatCurrency(t.ytdActual), tone: 'text-emerald-400' },
    { label: 'YTD Budget', value: formatCurrency(t.ytdBudget), tone: 'text-slate-200' },
    {
      label: 'YTD Under / (Over)',
      value: `${formatCurrency(ytdVariance)}${t.ytdBudget > 0 ? ` (${((ytdVariance / t.ytdBudget) * 100).toFixed(0)}%)` : ''}`,
      tone: ytdVariance >= 0 ? 'text-emerald-400' : 'text-rose-400',
    },
    { label: 'Annual Budget', value: formatCurrency(t.annualBudget), tone: 'text-slate-200' },
    { label: 'Projected Year-End', value: formatCurrency(t.projectedYearEnd), tone: 'text-slate-200' },
    {
      label: 'Projected Under / (Over)',
      value: formatCurrency(projectedVariance),
      tone: projectedVariance >= 0 ? 'text-emerald-400' : 'text-rose-400',
    },
  ];

  const scales = {
    x: { ticks: { color: AXIS_TICK_COLOR }, grid: { color: GRID_COLOR } },
    y: {
      ticks: { color: AXIS_TICK_COLOR, callback: (value: string | number) => formatCurrency(Number(value)) },
      grid: { color: GRID_COLOR },
    },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-slate-900/60 border border-slate-800 rounded-xl p-2.5">
            <span className="text-[10px] text-slate-400 block font-medium uppercase tracking-wider">{tile.label}</span>
            <span className={`text-sm font-bold font-mono ${tile.tone}`}>{tile.value}</span>
          </div>
        ))}
      </div>

      <div>
        <p className="text-[11px] text-slate-400 mb-1">
          Cumulative spend vs budget. Green shading means under budget, red means over. Dotted line projects the year-end at your current pace against the budget schedule.
        </p>
        <div className="h-60">
          <Chart
            type="line"
            data={cumulativeData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              interaction: { mode: 'index' as const, intersect: false },
              plugins: {
                legend: { position: 'top' as const, labels: { color: AXIS_TICK_COLOR, font: { size: 11 } } },
                tooltip: {
                  callbacks: {
                    label: (context) => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`,
                  },
                },
              },
              scales: { ...scales, y: { ...scales.y, beginAtZero: true } },
            }}
          />
        </div>
      </div>

      <div>
        <p className="text-[11px] text-slate-400 mb-1">
          Monthly variance (budget minus actual). Bars above zero are under budget, below zero are over.
        </p>
        <div className="h-40">
          <Chart
            type="bar"
            data={varianceData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (context) => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`,
                  },
                },
              },
              scales,
            }}
          />
        </div>
      </div>
    </div>
  );
};
