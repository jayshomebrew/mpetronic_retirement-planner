import { RebalanceAccountTemplate, RebalanceSnapshot } from '../../types/rebalancing';

export interface RebalancingImportPlan {
  accounts: RebalanceAccountTemplate[];
  snapshots: RebalanceSnapshot[];
  skippedAccounts: string[];
}

/**
 * Decides which archived accounts and snapshots can be imported. Existing data is never overwritten:
 * an account is skipped when its id already exists, or when it is active and another active account
 * already holds the same owner and account type. Snapshots follow their account.
 */
export function planRebalancingImport(
  existing: RebalanceAccountTemplate[],
  incomingAccounts: RebalanceAccountTemplate[],
  incomingSnapshots: RebalanceSnapshot[]
): RebalancingImportPlan {
  const takenIds = new Set(existing.map((a) => a.accountId));
  const activeKeys = new Set(existing.filter((a) => !a.archived).map((a) => `${a.owner}|${a.accountType}`));
  const accounts: RebalanceAccountTemplate[] = [];
  const importedIds = new Set<string>();
  const skippedAccounts: string[] = [];

  for (const account of incomingAccounts) {
    const key = `${account.owner}|${account.accountType}`;
    if (takenIds.has(account.accountId) || (!account.archived && activeKeys.has(key))) {
      skippedAccounts.push(`${account.owner} ${account.accountType}`);
      continue;
    }
    takenIds.add(account.accountId);
    if (!account.archived) activeKeys.add(key);
    importedIds.add(account.accountId);
    accounts.push(account);
  }

  const snapshots = incomingSnapshots.filter((s) => importedIds.has(s.accountId));
  return { accounts, snapshots, skippedAccounts };
}
