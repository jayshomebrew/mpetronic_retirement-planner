import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { RebalanceSnapshot } from '../shared/types/rebalancing';

interface RebalanceHistoryProps {
  accountName: string;
  snapshots: RebalanceSnapshot[];
  onToggleExecuted: (snapshot: RebalanceSnapshot) => void;
  onDelete: (snapshot: RebalanceSnapshot) => void;
  onBack: () => void;
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const PERCENT_DECIMALS = 2;

export const RebalanceHistory: React.FC<RebalanceHistoryProps> = ({
  accountName,
  snapshots,
  onToggleExecuted,
  onDelete,
  onBack,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = snapshots.find((s) => s.snapshotId === selectedId) ?? null;
  const cashSymbols = new Set((selected?.funds ?? []).filter((f) => f.isCash).map((f) => f.symbol));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">{accountName} history</h2>
        <button type="button" className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm" onClick={onBack}>
          Back
        </button>
      </div>

      {snapshots.length === 0 && <p className="text-sm text-slate-400">No saved snapshots yet.</p>}

      <div className="space-y-2">
        {snapshots.map((s) => (
          <div key={s.snapshotId} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-4">
            <button type="button" className="text-left flex-1 min-w-[12rem]" onClick={() => setSelectedId(s.snapshotId === selectedId ? null : s.snapshotId)}>
              <div className="text-sm font-semibold text-white">{new Date(s.savedAt).toLocaleString()}</div>
              <div className="text-xs text-slate-400">
                {s.result.accountStatus === 'NEEDED' ? 'Rebalance needed' : 'Optional'} · total {usd(s.result.total)}
                {s.note ? ` · ${s.note}` : ''}
              </div>
            </button>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={s.executed} onChange={() => onToggleExecuted(s)} />
              Executed
            </label>
            <button type="button" aria-label="Delete snapshot" className="p-2 text-slate-400 hover:text-rose-400" onClick={() => onDelete(s)}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {selected && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 overflow-x-auto">
          <p className="text-xs text-slate-500">
            Frozen as of {new Date(selected.savedAt).toLocaleString()} · {selected.accountName} · threshold ±{selected.thresholdPoints} points
          </p>
          {selected.result.transactions && (
            <div className="space-y-1 text-sm text-slate-200">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Instructions</div>
              {selected.result.transactions.length === 0 && <div className="text-slate-500">No trades</div>}
              {selected.result.transactions.map((t, idx) => (
                <div key={idx}>
                  {t.type === 'EXCHANGE'
                    ? `Exchange from ${t.fromSymbol} to ${t.toSymbol}`
                    : t.type === 'BUY'
                      ? `Buy ${t.toSymbol}`
                      : `Sell ${t.fromSymbol}`}{' '}
                  {usd(t.amount)}
                </div>
              ))}
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-400">
              <tr className="border-b border-slate-800">
                <th className="text-left p-2">Fund</th>
                <th className="text-right p-2">Value</th>
                <th className="text-right p-2">Current</th>
                <th className="text-right p-2">Target</th>
                <th className="text-left p-2">Status</th>
                <th className="text-right p-2">Trade</th>
              </tr>
            </thead>
            <tbody>
              {selected.result.funds.map((f) => (
                <tr key={f.symbol} className="border-b border-slate-800/60 last:border-0 text-slate-200">
                  <td className="p-2 font-semibold text-white">{f.symbol}</td>
                  <td className="p-2 text-right">{usd(f.value)}</td>
                  <td className="p-2 text-right">{f.currentPercent.toFixed(PERCENT_DECIMALS)}%</td>
                  <td className="p-2 text-right">{f.targetPercent.toFixed(PERCENT_DECIMALS)}%</td>
                  <td className="p-2">{f.status === 'IN_BAND' ? 'In band' : f.status === 'HIGH' ? 'High' : 'Low'}</td>
                  <td className="p-2 text-right">
                    {f.action === 'NONE'
                      ? 'No trade'
                      : cashSymbols.has(f.symbol)
                        ? 'Cash (automatic)'
                        : `${f.action === 'SELL' ? 'Sell' : 'Buy'} ${usd(Math.abs(f.tradeAmount))}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
