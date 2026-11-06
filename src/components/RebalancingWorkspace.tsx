import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, FileSpreadsheet, ArrowLeftRight } from 'lucide-react';
import {
  RebalanceAccountTemplate,
  RebalanceOwner,
  RebalanceSnapshot,
} from '../shared/types/rebalancing';
import { getRebalancingStorage } from '../shared/storage/rebalancing';
import { getAccountName, getOwnerDisplayName } from '../engine/rebalancingEngine';
import { RebalanceTemplateEditor } from './RebalanceTemplateEditor';
import { RebalanceWorksheet } from './RebalanceWorksheet';
import { RebalanceHistory } from './RebalanceHistory';

interface RebalancingWorkspaceProps {
  primaryName?: string;
  spouseName?: string;
}

type ViewState =
  | { kind: 'overview' }
  | { kind: 'edit'; accountId: string | null }
  | { kind: 'worksheet'; accountId: string }
  | { kind: 'history'; accountId: string };

export const RebalancingWorkspace: React.FC<RebalancingWorkspaceProps> = ({ primaryName, spouseName }) => {
  const storage = useMemo(() => getRebalancingStorage(), []);
  const [accounts, setAccounts] = useState<RebalanceAccountTemplate[]>([]);
  const [snapshots, setSnapshots] = useState<RebalanceSnapshot[]>([]);
  const [view, setView] = useState<ViewState>({ kind: 'overview' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const ownerLabel = useCallback(
    (owner: RebalanceOwner) => getOwnerDisplayName(owner, primaryName, spouseName),
    [primaryName, spouseName]
  );
  const nameOf = useCallback(
    (a: RebalanceAccountTemplate) => getAccountName(ownerLabel(a.owner), a.accountType),
    [ownerLabel]
  );

  const reload = useCallback(async () => {
    try {
      const [accs, snaps] = await Promise.all([storage.getAccounts(), storage.getSnapshots()]);
      setAccounts(accs);
      setSnapshots(snaps);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rebalancing data');
    } finally {
      setLoading(false);
    }
  }, [storage]);

  useEffect(() => {
    reload();
  }, [reload]);

  const activeAccounts = useMemo(
    () => accounts.filter((a) => !a.archived).sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [accounts, nameOf]
  );
  const latestFor = useCallback(
    (accountId: string) => snapshots.find((s) => s.accountId === accountId) ?? null, // already newest first
    [snapshots]
  );
  const findAccount = (id: string | null) => accounts.find((a) => a.accountId === id) ?? null;

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    }
  };

  const renderBody = () => {
    if (view.kind === 'edit') {
      const account = findAccount(view.accountId);
      return (
        <RebalanceTemplateEditor
          account={account}
          allAccounts={accounts}
          ownerLabel={ownerLabel}
          onCancel={() => setView({ kind: 'overview' })}
          onSave={(a) => run(async () => { await storage.saveAccount(a); setView({ kind: 'overview' }); })}
          onArchive={(a) => {
            if (window.confirm(`Archive ${nameOf(a)}? Its snapshots stay readable.`)) {
              run(async () => { await storage.saveAccount({ ...a, archived: true, updatedAt: new Date().toISOString() }); setView({ kind: 'overview' }); });
            }
          }}
          onDelete={(a) => {
            if (window.confirm(`Permanently delete ${nameOf(a)} and all of its snapshots? This cannot be undone.`)) {
              run(async () => { await storage.deleteAccount(a.accountId); setView({ kind: 'overview' }); });
            }
          }}
        />
      );
    }

    if (view.kind === 'worksheet') {
      const account = findAccount(view.accountId);
      if (!account) return null;
      return (
        <RebalanceWorksheet
          key={account.accountId}
          account={account}
          accountName={nameOf(account)}
          ownerDisplayName={ownerLabel(account.owner)}
          lastSnapshot={latestFor(account.accountId)}
          onSave={async (s) => { await run(() => storage.saveSnapshot(s)); }}
          onShowHistory={() => setView({ kind: 'history', accountId: account.accountId })}
          onBack={() => setView({ kind: 'overview' })}
        />
      );
    }

    if (view.kind === 'history') {
      const account = findAccount(view.accountId);
      if (!account) return null;
      return (
        <RebalanceHistory
          accountName={nameOf(account)}
          snapshots={snapshots.filter((s) => s.accountId === account.accountId)}
          onToggleExecuted={(s) => {
            const updated = { ...s, executed: !s.executed };
            setSnapshots((prev) => prev.map((x) => (x.snapshotId === s.snapshotId ? updated : x)));
            run(() => storage.saveSnapshot(updated));
          }}
          onDelete={(s) => {
            if (window.confirm('Delete this snapshot?')) run(() => storage.deleteSnapshot(s.accountId, s.snapshotId));
          }}
          onBack={() => setView({ kind: 'worksheet', accountId: account.accountId })}
        />
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">
            Statuses shown are as of each account's last saved check, not live.
          </p>
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center gap-1.5"
            onClick={() => setView({ kind: 'edit', accountId: null })}
          >
            <Plus className="w-4 h-4" /> New account
          </button>
        </div>
        {!loading && activeAccounts.length === 0 && (
          <p className="text-sm text-slate-400">No accounts yet. Create one to define its funds and targets.</p>
        )}
        {activeAccounts.map((a) => {
          const last = latestFor(a.accountId);
          return (
            <div key={a.accountId} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[12rem]">
                <div className="font-semibold text-white">{nameOf(a)}</div>
                <div className="text-xs text-slate-400">
                  {a.funds.length} funds · threshold ±{a.thresholdPoints} pts
                </div>
              </div>
              <div className="text-sm text-slate-300 min-w-[12rem]">
                {last ? (
                  <>
                    <span
                      className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                        last.result.accountStatus === 'NEEDED' ? 'bg-rose-500/15 text-rose-400' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {last.result.accountStatus === 'NEEDED' ? 'Rebalance needed' : 'Optional'}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      as of {new Date(last.savedAt).toLocaleDateString()}
                      {last.executed ? ' · executed' : ''}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-slate-500">No checks saved</span>
                )}
              </div>
              <button type="button" className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm flex items-center gap-1.5" onClick={() => setView({ kind: 'worksheet', accountId: a.accountId })}>
                <FileSpreadsheet className="w-4 h-4" /> Open worksheet
              </button>
              <button type="button" className="px-3 py-2 rounded-xl text-slate-300 hover:text-white text-sm flex items-center gap-1.5" onClick={() => setView({ kind: 'edit', accountId: a.accountId })}>
                <Pencil className="w-4 h-4" /> Edit template
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <ArrowLeftRight className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Account Rebalancing</h1>
          <p className="text-sm text-slate-400">Fund targets, thresholds, and the trades to bring each account back to target.</p>
        </div>
      </div>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {renderBody()}
    </div>
  );
};
