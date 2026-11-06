import React, { useMemo, useState } from 'react';
import { Copy, Check, History, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  CENTS_PER_DOLLAR,
  FundResult,
  RebalanceAccountTemplate,
  RebalanceTransaction,
  RebalanceSnapshot,
} from '../shared/types/rebalancing';
import { calculateRebalance, parseDollarInput } from '../engine/rebalancingEngine';

interface RebalanceWorksheetProps {
  account: RebalanceAccountTemplate;
  accountName: string;
  ownerDisplayName: string;
  lastSnapshot: RebalanceSnapshot | null;
  onSave: (snapshot: RebalanceSnapshot) => Promise<void>;
  onShowHistory: () => void;
  onBack: () => void;
}

const PERCENT_DECIMALS = 2;
const COPY_FEEDBACK_MS = 1500;

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const pct = (n: number) => `${n.toFixed(PERCENT_DECIMALS)}%`;
const signedPct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(PERCENT_DECIMALS)}`;

const STATUS_STYLES: Record<FundResult['status'], string> = {
  IN_BAND: 'bg-slate-800 text-slate-300',
  HIGH: 'bg-rose-500/15 text-rose-400',
  LOW: 'bg-amber-500/15 text-amber-400',
};
const describeTransaction = (t: RebalanceTransaction): string =>
  t.type === 'EXCHANGE' ? `exchange from ${t.fromSymbol} to ${t.toSymbol}` : `${t.type === 'BUY' ? 'buy' : 'sell'} ${t.type === 'BUY' ? t.toSymbol : t.fromSymbol}`;

const TRANSACTION_LABELS: Record<RebalanceTransaction['type'], string> = {
  EXCHANGE: 'Exchange',
  BUY: 'Buy',
  SELL: 'Sell',
};
const TRANSACTION_STYLES: Record<RebalanceTransaction['type'], string> = {
  EXCHANGE: 'text-sky-400',
  BUY: 'text-emerald-400',
  SELL: 'text-rose-400',
};
const STATUS_LABELS: Record<FundResult['status'], string> = { IN_BAND: 'In band', HIGH: 'High', LOW: 'Low' };

export const RebalanceWorksheet: React.FC<RebalanceWorksheetProps> = ({
  account,
  accountName,
  ownerDisplayName,
  lastSnapshot,
  onSave,
  onShowHistory,
  onBack,
}) => {
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [showTrades, setShowTrades] = useState(false);
  const [separateTrades, setSeparateTrades] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsed = useMemo(() => {
    const values: Record<string, number> = {};
    const invalid: string[] = [];
    const missing: string[] = [];
    for (const f of account.funds) {
      const text = raw[f.symbol] ?? '';
      if (text.trim() === '') {
        missing.push(f.symbol);
        continue;
      }
      const v = parseDollarInput(text);
      if (v === null) invalid.push(f.symbol);
      else values[f.symbol] = v;
    }
    return { values, invalid, missing };
  }, [raw, account.funds]);

  const complete = parsed.invalid.length === 0 && parsed.missing.length === 0;
  const result = useMemo(
    () => (complete ? calculateRebalance(account.funds, parsed.values, account.thresholdPoints) : null),
    [complete, account, parsed.values]
  );

  const needed = result?.accountStatus === 'NEEDED';
  const tradesVisible = needed || showTrades;
  // Cash is never traded directly: buys draw on it and sales land in it, so it gets no row of its own.
  const cashSymbol = account.funds.find((f) => f.isCash)?.symbol ?? null;
  const tradeFunds = result ? result.funds.filter((f) => f.symbol !== cashSymbol) : [];
  const cashFund = result?.funds.find((f) => f.symbol === cashSymbol) ?? null;
  const totalSells = tradeFunds.reduce((s, f) => (f.action === 'SELL' ? s - f.tradeAmount : s), 0);
  const totalBuys = tradeFunds.reduce((s, f) => (f.action === 'BUY' ? s + f.tradeAmount : s), 0);
  const cashFlow = totalBuys - totalSells; // positive = buys draw on cash, negative = sales add to cash
  const trades = result
    ? [
        ...tradeFunds.filter((f) => f.action === 'SELL').sort((a, b) => a.tradeAmount - b.tradeAmount),
        ...tradeFunds.filter((f) => f.action === 'BUY').sort((a, b) => b.tradeAmount - a.tradeAmount),
      ]
    : [];

  const transactions: RebalanceTransaction[] = result?.transactions ?? [];

  const copyAmount = async (key: string, amount: number) => {
    try {
      await navigator.clipboard.writeText(Math.abs(amount).toFixed(2));
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), COPY_FEEDBACK_MS);
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  };

  const handleSave = async () => {
    if (!result) return;
    const now = new Date().toISOString();
    await onSave({
      snapshotId: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      accountId: account.accountId,
      savedAt: now,
      owner: account.owner,
      ownerDisplayName,
      accountType: account.accountType,
      accountName,
      thresholdPoints: account.thresholdPoints,
      funds: account.funds,
      values: parsed.values,
      result,
      note: note.trim() || undefined,
      executed: false,
    });
    setSaved(true);
  };

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">{accountName}</h2>
            <p className="text-sm text-slate-400">Threshold ±{account.thresholdPoints} percentage points</p>
          </div>
          <div className="flex gap-3">
            <button type="button" className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5" onClick={onShowHistory}>
              <History className="w-4 h-4" /> History
            </button>
            <button type="button" className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm" onClick={onBack}>
              Back
            </button>
          </div>
        </div>

        {lastSnapshot && (
          <p className="text-xs text-slate-500">
            Last saved check: {new Date(lastSnapshot.savedAt).toLocaleDateString()} ({lastSnapshot.result.accountStatus === 'NEEDED' ? 'rebalance needed' : 'optional'}
            {lastSnapshot.executed ? ', executed' : ''}) with total {usd(lastSnapshot.result.total)}. Values below start blank.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {account.funds.map((f) => {
            const bad = parsed.invalid.includes(f.symbol);
            return (
              <label key={f.symbol} className="text-xs font-semibold uppercase tracking-wider text-slate-400 space-y-1.5 block">
                {f.symbol} <span className="normal-case text-slate-500">target {pct(f.targetPercent)}</span>
                <input
                  className={`w-full bg-slate-950 border rounded-lg px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500 ${bad ? 'border-rose-500' : 'border-slate-700'}`}
                  inputMode="decimal"
                  placeholder="$0.00"
                  value={raw[f.symbol] ?? ''}
                  onChange={(e) => {
                    setRaw((prev) => ({ ...prev, [f.symbol]: e.target.value }));
                    setSaved(false);
                  }}
                />
              </label>
            );
          })}
        </div>
        {parsed.invalid.length > 0 && (
          <p className="text-sm text-rose-400">Enter a non-negative dollar amount for {parsed.invalid.join(', ')}.</p>
        )}
      </div>

      {complete && !result && (
        <p className="text-sm text-amber-400">Enter at least one value.</p>
      )}

      {result && (
        <>
          <div
            className={`rounded-2xl border p-5 flex items-center gap-3 ${
              needed ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-slate-900 border-slate-800 text-slate-300'
            }`}
          >
            {needed ? <AlertTriangle className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6 text-emerald-400" />}
            <div>
              <div className="text-lg font-bold">{needed ? 'Rebalance needed' : 'Optional'}</div>
              <div className="text-sm opacity-80">
                {needed
                  ? 'At least one fund is outside its threshold. Rebalance the whole account to targets.'
                  : 'Within thresholds, no rebalance needed.'}
              </div>
            </div>
            <div className="ml-auto text-right text-sm text-slate-400">
              Account total
              <div className="text-lg font-bold text-white">{usd(result.total)}</div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="text-left p-3">Fund</th>
                  <th className="text-right p-3">Value</th>
                  <th className="text-right p-3">Current</th>
                  <th className="text-right p-3">Target</th>
                  <th className="text-right p-3">Deviation (pts)</th>
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.funds.map((f) => (
                  <tr key={f.symbol} className="border-b border-slate-800/60 last:border-0">
                    <td className="p-3 font-semibold text-white">{f.symbol}</td>
                    <td className="p-3 text-right text-slate-200">{usd(f.value)}</td>
                    <td className="p-3 text-right text-slate-200">{pct(f.currentPercent)}</td>
                    <td className="p-3 text-right text-slate-400">{pct(f.targetPercent)}</td>
                    <td className="p-3 text-right text-slate-200">{signedPct(f.deviationPoints)}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${STATUS_STYLES[f.status]}`}>{STATUS_LABELS[f.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!needed && (
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={showTrades} onChange={(e) => setShowTrades(e.target.checked)} />
              View trades anyway
            </label>
          )}

          {tradesVisible && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                  {separateTrades ? 'Trades (sells first)' : 'Trades'}
                </h3>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input type="checkbox" checked={separateTrades} onChange={(e) => setSeparateTrades(e.target.checked)} />
                  Show separate sells and buys
                </label>
              </div>
              {!separateTrades && transactions.length === 0 && (
                <p className="text-sm text-slate-400">No trades. Every fund is at its target.</p>
              )}
              {!separateTrades &&
                transactions.map((t, idx) => {
                  const key = `tx-${idx}`;
                  return (
                    <div key={key} className="flex items-center gap-4 text-sm">
                      <span className={`w-20 font-bold ${TRANSACTION_STYLES[t.type]}`}>{TRANSACTION_LABELS[t.type]}</span>
                      <span className="w-56 font-semibold text-white">
                        {t.type === 'EXCHANGE' ? (
                          <>
                            <span className="font-normal text-slate-500">From</span> {t.fromSymbol}{' '}
                            <span className="font-normal text-slate-500">To</span> {t.toSymbol}
                          </>
                        ) : t.type === 'BUY' ? (
                          t.toSymbol
                        ) : (
                          t.fromSymbol
                        )}
                      </span>
                      <span className="w-32 text-right text-slate-100">{usd(t.amount)}</span>
                      <span className="w-24 text-right text-slate-400">{pct(t.percentPoints)} pts</span>
                      <button
                        type="button"
                        aria-label={`Copy ${describeTransaction(t)} amount`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                        onClick={() => copyAmount(key, t.amount)}
                      >
                        {copied === key ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  );
                })}
              {separateTrades && trades.length === 0 && <p className="text-sm text-slate-400">No trades. Every fund is at its target.</p>}
              {separateTrades &&
                trades.map((f) => (
                  <div key={f.symbol} className="flex items-center gap-4 text-sm">
                    <span className={`w-12 font-bold ${f.action === 'SELL' ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {f.action === 'SELL' ? 'Sell' : 'Buy'}
                    </span>
                    <span className="w-20 font-semibold text-white">{f.symbol}</span>
                    <span className="w-32 text-right text-slate-100">{usd(Math.abs(f.tradeAmount))}</span>
                    <span className="w-24 text-right text-slate-400">{signedPct(f.tradePercentPoints)} pts</span>
                    <button
                      type="button"
                      aria-label={`Copy ${f.symbol} amount`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                      onClick={() => copyAmount(f.symbol, f.tradeAmount)}
                    >
                      {copied === f.symbol ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                ))}
              {separateTrades && cashFund && cashFund.action !== 'NONE' && (
                <div className="text-sm text-slate-500">
                  {cashFund.symbol} is your cash fund: no trade to enter. Buys draw on it and sales land in it automatically.
                </div>
              )}
              {result.funds.filter((f) => f.action === 'NONE').map((f) => (
                <div key={f.symbol} className="text-sm text-slate-500">{f.symbol}: No trade</div>
              ))}
              <div className="pt-2 border-t border-slate-800 text-sm text-slate-400">
                Total sells {usd(totalSells)} · Total buys {usd(totalBuys)}
                {Math.abs(cashFlow) >= 1 / CENTS_PER_DOLLAR && (
                  <span> · {usd(Math.abs(cashFlow))} {cashFlow > 0 ? 'from' : 'to'} cash</span>
                )}
                {result.residualSymbol && result.residualSymbol !== cashSymbol && (
                  <span> · {usd(Math.abs(result.residualAdjustment))} rounding adjustment applied to {result.residualSymbol}</span>
                )}
              </div>
            </div>
          )}

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[16rem] text-xs font-semibold uppercase tracking-wider text-slate-400 space-y-1.5 block">
              Note (optional)
              <input
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500 normal-case"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button type="button" className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold" onClick={handleSave}>
              Save snapshot
            </button>
            {saved && <span className="text-sm text-emerald-400">Saved</span>}
          </div>
        </>
      )}
    </div>
  );
};
