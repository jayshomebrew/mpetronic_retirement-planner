import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Archive } from 'lucide-react';
import {
  DEFAULT_THRESHOLD_POINTS,
  REBALANCE_ACCOUNT_TYPES,
  REBALANCE_OWNERS,
  RebalanceAccountTemplate,
  RebalanceAccountType,
  RebalanceOwner,
  TARGET_PERCENT_TOTAL,
  TARGET_SUM_TOLERANCE,
} from '../shared/types/rebalancing';
import { normalizeSymbol, sumTargets, validateTemplate } from '../engine/rebalancingEngine';

interface FundDraft {
  symbol: string;
  target: string;
  isCash: boolean;
}

interface RebalanceTemplateEditorProps {
  account: RebalanceAccountTemplate | null;
  allAccounts: RebalanceAccountTemplate[];
  ownerLabel: (owner: RebalanceOwner) => string;
  onSave: (account: RebalanceAccountTemplate) => void;
  onArchive: (account: RebalanceAccountTemplate) => void;
  onDelete: (account: RebalanceAccountTemplate) => void;
  onCancel: () => void;
}

const INITIAL_FUND_ROWS = 1;

const inputClass =
  'bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500';

export const RebalanceTemplateEditor: React.FC<RebalanceTemplateEditorProps> = ({
  account,
  allAccounts,
  ownerLabel,
  onSave,
  onArchive,
  onDelete,
  onCancel,
}) => {
  const [owner, setOwner] = useState<RebalanceOwner>(account?.owner ?? 'primary');
  const [accountType, setAccountType] = useState<RebalanceAccountType>(account?.accountType ?? 'Rollover IRA');
  const [threshold, setThreshold] = useState(String(account?.thresholdPoints ?? DEFAULT_THRESHOLD_POINTS));
  const [funds, setFunds] = useState<FundDraft[]>(
    account
      ? account.funds.map((f) => ({ symbol: f.symbol, target: String(f.targetPercent), isCash: Boolean(f.isCash) }))
      : Array.from({ length: INITIAL_FUND_ROWS }, () => ({ symbol: '', target: '', isCash: false }))
  );
  const [showErrors, setShowErrors] = useState(false);

  const draft = useMemo(
    () => ({
      accountId: account?.accountId,
      owner,
      accountType,
      thresholdPoints: Number(threshold),
      funds: funds.map((f) => ({
        symbol: normalizeSymbol(f.symbol),
        targetPercent: Number(f.target),
        ...(f.isCash ? { isCash: true } : {}),
      })),
    }),
    [account, owner, accountType, threshold, funds]
  );
  const errors = useMemo(() => validateTemplate(draft, allAccounts), [draft, allAccounts]);
  const targetTotal = sumTargets(draft.funds);
  const totalOk = Math.abs(targetTotal - TARGET_PERCENT_TOTAL) <= TARGET_SUM_TOLERANCE;

  const updateFund = (idx: number, patch: Partial<FundDraft>) =>
    setFunds((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  // Only one fund can be the cash fund, so checking one clears the others.
  const setCashFund = (idx: number, checked: boolean) =>
    setFunds((prev) => prev.map((f, i) => ({ ...f, isCash: checked && i === idx })));

  const handleSave = () => {
    setShowErrors(true);
    if (errors.length > 0) return;
    const now = new Date().toISOString();
    onSave({
      accountId: account?.accountId ?? `acct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      owner,
      accountType,
      thresholdPoints: draft.thresholdPoints,
      funds: draft.funds,
      archived: account?.archived ?? false,
      createdAt: account?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
      <h2 className="text-xl font-bold text-white">{account ? 'Edit account template' : 'New account template'}</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 space-y-1.5 block">
          Owner
          <select className={`${inputClass} w-full normal-case`} value={owner} onChange={(e) => setOwner(e.target.value as RebalanceOwner)}>
            {REBALANCE_OWNERS.map((o) => (
              <option key={o} value={o}>{ownerLabel(o)}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 space-y-1.5 block">
          Account type
          <select className={`${inputClass} w-full normal-case`} value={accountType} onChange={(e) => setAccountType(e.target.value as RebalanceAccountType)}>
            {REBALANCE_ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 space-y-1.5 block">
          Threshold (± percentage points)
          <input className={`${inputClass} w-full`} inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </label>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          <span>Fund symbol</span>
          <span>Target %</span>
          <span className="w-12 text-center">Cash</span>
          <span className="w-9" />
        </div>
        {funds.map((f, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto] gap-3">
            <input className={inputClass} placeholder="Enter fund symbol" value={f.symbol} onChange={(e) => updateFund(idx, { symbol: e.target.value })} />
            <input className={inputClass} inputMode="decimal" placeholder="Target %" value={f.target} onChange={(e) => updateFund(idx, { target: e.target.value })} />
            <label className="w-12 flex items-center justify-center" title="Mark as the account's cash fund (never exchanged)">
              <input type="checkbox" aria-label="Cash fund" checked={f.isCash} onChange={(e) => setCashFund(idx, e.target.checked)} />
            </label>
            <button
              type="button"
              aria-label="Remove fund"
              className="p-2 text-slate-400 hover:text-rose-400"
              onClick={() => setFunds((prev) => prev.filter((_, i) => i !== idx))}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            className="text-sm text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5"
            onClick={() => setFunds((prev) => [...prev, { symbol: '', target: '', isCash: false }])}
          >
            <Plus className="w-4 h-4" /> Add fund
          </button>
          <span className={`text-sm font-semibold ${totalOk ? 'text-emerald-400' : 'text-amber-400'}`}>
            Target total: {targetTotal.toFixed(2)}% / {TARGET_PERCENT_TOTAL}%
          </span>
        </div>
      </div>

      {showErrors && errors.length > 0 && (
        <ul className="text-sm text-rose-400 list-disc pl-5 space-y-0.5">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
        <div className="flex gap-3">
          <button type="button" className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold" onClick={handleSave}>
            Save
          </button>
          <button type="button" className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {account && (
          <div className="flex gap-3">
            <button type="button" className="px-3 py-2 rounded-xl text-sm text-slate-300 hover:text-white flex items-center gap-1.5" onClick={() => onArchive(account)}>
              <Archive className="w-4 h-4" /> Archive
            </button>
            <button type="button" className="px-3 py-2 rounded-xl text-sm text-rose-400 hover:text-rose-300 flex items-center gap-1.5" onClick={() => onDelete(account)}>
              <Trash2 className="w-4 h-4" /> Delete permanently
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
