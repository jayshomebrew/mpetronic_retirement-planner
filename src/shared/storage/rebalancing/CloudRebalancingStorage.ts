import {
  RebalanceAccountTemplate,
  RebalanceSnapshot,
  RebalancingImportReport,
  RebalancingStorage,
} from '../../types/rebalancing';
import { AuthService } from '../../auth/AuthService';
import { getCloudConfig } from '../../auth/config';
import { IndexedDbRebalancingStorage } from './IndexedDbRebalancingStorage';
import { planRebalancingImport } from './importPlan';

interface CloudState {
  accounts: RebalanceAccountTemplate[];
  snapshots: RebalanceSnapshot[];
}

/**
 * Local-first rebalancing storage. Writes go to IndexedDB, then are pushed to the API when the
 * user is online and authenticated. Reads refresh the local copy from the cloud when possible.
 */
export class CloudRebalancingStorage implements RebalancingStorage {
  private local: IndexedDbRebalancingStorage;

  constructor(local?: IndexedDbRebalancingStorage) {
    this.local = local || new IndexedDbRebalancingStorage();
  }

  private canUseCloud(): boolean {
    return typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated();
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response | null> {
    const idToken = await AuthService.getIdToken();
    if (!idToken) return null;
    const endpoint = getCloudConfig().apiEndpoint.replace(/\/$/, '');
    return fetch(`${endpoint}/api/rebalancing${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: idToken },
    });
  }

  private async push(path: string, init: RequestInit): Promise<void> {
    if (!this.canUseCloud()) return;
    try {
      const res = await this.request(path, init);
      if (res && !res.ok) console.warn(`Rebalancing cloud sync failed (${res.status}) for ${path}`);
    } catch (err) {
      console.warn('Rebalancing cloud sync failed:', err);
    }
  }

  private async refreshFromCloud(): Promise<void> {
    if (!this.canUseCloud()) return;
    try {
      const [accRes, snapRes] = await Promise.all([this.request('/accounts'), this.request('/snapshots')]);
      if (!accRes?.ok || !snapRes?.ok) return;
      const { accounts } = (await accRes.json()) as { accounts: RebalanceAccountTemplate[] };
      const { snapshots } = (await snapRes.json()) as { snapshots: RebalanceSnapshot[] };
      await this.local.replaceAll(accounts, snapshots);
    } catch (err) {
      console.warn('Failed to refresh rebalancing data from cloud:', err);
    }
  }

  async getAccounts(): Promise<RebalanceAccountTemplate[]> {
    await this.refreshFromCloud();
    return this.local.getAccounts();
  }

  async saveAccount(account: RebalanceAccountTemplate): Promise<void> {
    await this.local.saveAccount(account);
    await this.push('/accounts', { method: 'POST', body: JSON.stringify(account) });
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.local.deleteAccount(accountId);
    await this.push(`/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
  }

  async getSnapshots(accountId?: string): Promise<RebalanceSnapshot[]> {
    await this.refreshFromCloud();
    return this.local.getSnapshots(accountId);
  }

  async saveSnapshot(snapshot: RebalanceSnapshot): Promise<void> {
    await this.local.saveSnapshot(snapshot);
    await this.push('/snapshots', { method: 'POST', body: JSON.stringify(snapshot) });
  }

  async deleteSnapshot(accountId: string, snapshotId: string): Promise<void> {
    await this.local.deleteSnapshot(accountId, snapshotId);
    await this.push(`/snapshots/${encodeURIComponent(snapshotId)}?accountId=${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
    });
  }

  async exportRebalancing(): Promise<CloudState> {
    await this.refreshFromCloud();
    return this.local.exportRebalancing();
  }

  async importRebalancing(
    accounts: RebalanceAccountTemplate[],
    snapshots: RebalanceSnapshot[]
  ): Promise<RebalancingImportReport> {
    await this.refreshFromCloud();
    const plan = planRebalancingImport(await this.local.getAccounts(), accounts, snapshots);
    for (const a of plan.accounts) await this.saveAccount(a);
    for (const s of plan.snapshots) await this.saveSnapshot(s);
    return {
      accountsImported: plan.accounts.length,
      snapshotsImported: plan.snapshots.length,
      skippedAccounts: plan.skippedAccounts,
    };
  }
}
