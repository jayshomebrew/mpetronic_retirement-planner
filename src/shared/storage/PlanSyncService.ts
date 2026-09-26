import { AuthService } from '../auth/AuthService';
import { getCloudConfig } from '../auth/config';
import { AppStateInputs, SavedPlan, CustomRothScenario, normalizeDetailedExpenses } from '../../types';

export interface PlanSyncStatus {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  lastUpdatedBy: string | null;
  error: string | null;
}

export interface RemotePlanDocument {
  inputs: AppStateInputs;
  savedPlans?: SavedPlan[];
  customScenarios?: CustomRothScenario[];
  updatedBy: string;
  updatedAt: string;
  version?: number;
}

type SyncListener = (status: PlanSyncStatus) => void;

class PlanSyncServiceSingleton {
  private listeners: Set<SyncListener> = new Set();
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private isSyncing: boolean = false;
  private lastSyncedAt: string | null = null;
  private lastUpdatedBy: string | null = null;
  private error: string | null = null;
  private isDemoMode: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.lastSyncedAt = window.localStorage.getItem('retirement_planner_plan_synced_at');
      this.lastUpdatedBy = window.localStorage.getItem('retirement_planner_plan_updated_by');
    }
  }

  public setDemoMode(active: boolean): void {
    this.isDemoMode = active;
    if (active && this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  public isDemo(): boolean {
    return this.isDemoMode;
  }

  public getStatus(): PlanSyncStatus {
    return {
      isSyncing: this.isSyncing,
      lastSyncedAt: this.lastSyncedAt,
      lastUpdatedBy: this.lastUpdatedBy,
      error: this.error,
    };
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const status = this.getStatus();
    this.listeners.forEach(cb => {
      try {
        cb(status);
      } catch (err) {
        console.error('PlanSyncService listener error:', err);
      }
    });
  }

  private getApiEndpoint(): string {
    return getCloudConfig().apiEndpoint.replace(/\/$/, '');
  }

  private async getAuthHeaders(): Promise<HeadersInit | null> {
    const idToken = await AuthService.getIdToken();
    if (!idToken) return null;
    return {
      'Content-Type': 'application/json',
      Authorization: idToken,
    };
  }

  /**
   * Fetch the latest shared household plan from AWS DynamoDB.
   */
  public async fetchRemotePlan(): Promise<RemotePlanDocument | null> {
    if (this.isDemoMode) return null;
    if (!AuthService.isAuthenticated()) return null;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

    const headers = await this.getAuthHeaders();
    if (!headers) return null;

    const endpoint = `${this.getApiEndpoint()}/api/plan`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to fetch cloud plan (status ${response.status})`);
    }

    const data = await response.json();
    if (!data.plan || !data.plan.inputs) {
      return null;
    }

    return {
      inputs: data.plan.inputs,
      savedPlans: data.plan.savedPlans || [],
      customScenarios: data.plan.customScenarios || [],
      updatedBy: data.plan.updatedBy || 'Household User',
      updatedAt: data.plan.updatedAt || new Date().toISOString(),
      version: data.plan.version || 1,
    };
  }

  /**
   * Save the current plan to AWS DynamoDB under the shared household partition.
   */
  public async saveRemotePlan(
    inputs: AppStateInputs,
    savedPlans: SavedPlan[] = [],
    customScenarios: CustomRothScenario[] = []
  ): Promise<boolean> {
    if (this.isDemoMode) return false;
    if (!AuthService.isAuthenticated()) return false;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;

    const headers = await this.getAuthHeaders();
    if (!headers) return false;

    const endpoint = `${this.getApiEndpoint()}/api/plan`;
    const payload = {
      inputs,
      savedPlans,
      customScenarios,
      version: 1,
    };

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Failed to save plan to cloud (status ${response.status})`);
    }

    const now = new Date().toISOString();
    const session = AuthService.getSession();
    this.lastSyncedAt = now;
    this.lastUpdatedBy = session?.email || 'Household User';
    this.error = null;

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('retirement_planner_plan_synced_at', now);
      window.localStorage.setItem('retirement_planner_plan_updated_by', this.lastUpdatedBy);
    }

    this.notify();
    return true;
  }

  /**
   * Determine if a plan contains real user data rather than being unconfigured / default zeros.
   */
  public hasMeaningfulPlanData(inputs?: AppStateInputs | null): boolean {
    if (!inputs) return false;
    if (!inputs.isConfigured) return false;

    const p = inputs.portfolio;
    const totalAssets =
      (p?.yourPreTaxIRA || 0) +
      (p?.yourRothIRA || 0) +
      (p?.yourTaxableBrokerage || 0) +
      (p?.yourCash || 0) +
      (p?.wifePreTaxIRA || 0) +
      (p?.wifeRothIRA || 0) +
      (p?.wifeTaxableBrokerage || 0) +
      (p?.wifeCash || 0);

    const totalIncome =
      (inputs.you?.activeSalary || 0) +
      (inputs.you?.estimatedPIA || 0) +
      (inputs.wife?.activeSalary || 0) +
      (inputs.wife?.estimatedPIA || 0);

    const hasCatalogExpenses = (inputs.detailedExpenses?.catalog?.items?.length || 0) > 0;
    const hasCustomLiving =
      typeof inputs.annualLivingExpenses === 'number' &&
      inputs.annualLivingExpenses > 0 &&
      inputs.annualLivingExpenses !== 100000;

    return totalAssets > 0 || totalIncome > 0 || hasCatalogExpenses || hasCustomLiving;
  }

  private applyRemotePlan(remote: RemotePlanDocument): void {
    if (typeof window === 'undefined') return;

    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    const normalizedInputs = {
      ...remote.inputs,
      isConfigured: true,
      detailedExpenses: normalizeDetailedExpenses(remote.inputs.detailedExpenses),
    };

    window.localStorage.setItem('retirement_planner_inputs', JSON.stringify(normalizedInputs));
    if (typeof remote.inputs.simulateSurvivor === 'boolean') {
      window.localStorage.setItem('retirement_planner_survivor', JSON.stringify(remote.inputs.simulateSurvivor));
    }
    if (remote.savedPlans) {
      window.localStorage.setItem('retirement_planner_saved_plans', JSON.stringify(remote.savedPlans));
    }
    if (remote.customScenarios) {
      window.localStorage.setItem('retirement_planner_custom_roth_scenarios', JSON.stringify(remote.customScenarios));
    }

    this.lastSyncedAt = remote.updatedAt;
    this.lastUpdatedBy = remote.updatedBy;
    window.localStorage.setItem('retirement_planner_plan_synced_at', remote.updatedAt);
    window.localStorage.setItem('retirement_planner_plan_updated_by', remote.updatedBy);
    window.localStorage.setItem('retirement_planner_plan_local_modified_at', remote.updatedAt);

    // Dispatch event to re-render App state instantly
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('retirement_planner_inputs_updated', { detail: normalizedInputs }));
    window.dispatchEvent(new CustomEvent('retirement_planner_plan_synced', { detail: remote }));
  }

  /**
   * Complete 2-way cloud plan sync:
   * 1. Fetches cloud plan.
   * 2. If cloud has populated data and local does not: downloads and applies cloud plan.
   * 3. If local has populated data and cloud does not: uploads local plan to cloud.
   * 4. If both have populated data: compares timestamps to resolve newer version.
   */
  public async syncPlanNow(): Promise<{ action: 'downloaded' | 'uploaded' | 'up-to-date'; updatedBy?: string }> {
    if (this.isDemoMode) {
      return { action: 'up-to-date' };
    }
    if (!AuthService.isAuthenticated()) {
      return { action: 'up-to-date' };
    }

    this.isSyncing = true;
    this.error = null;
    this.notify();

    try {
      const remote = await this.fetchRemotePlan();

      if (typeof window === 'undefined') {
        this.isSyncing = false;
        this.notify();
        return { action: 'up-to-date' };
      }

      const localRaw = window.localStorage.getItem('retirement_planner_inputs');
      const localSavedPlansRaw = window.localStorage.getItem('retirement_planner_saved_plans');
      const localModifiedAt = window.localStorage.getItem('retirement_planner_plan_local_modified_at');

      const localInputs = localRaw ? (JSON.parse(localRaw) as AppStateInputs) : null;
      const localSavedPlans = localSavedPlansRaw ? (JSON.parse(localSavedPlansRaw) as SavedPlan[]) : [];

      const isRemoteMeaningful = this.hasMeaningfulPlanData(remote?.inputs);
      const isLocalMeaningful = this.hasMeaningfulPlanData(localInputs);

      // Case 1: Remote cloud has real plan data, local is empty/unconfigured -> Download remote
      if (isRemoteMeaningful && !isLocalMeaningful && remote) {
        this.applyRemotePlan(remote);
        this.isSyncing = false;
        this.notify();
        return { action: 'downloaded', updatedBy: remote.updatedBy };
      }

      // Case 2: Local has real plan data, remote cloud is empty/unconfigured -> Upload local
      if (isLocalMeaningful && !isRemoteMeaningful && localInputs) {
        await this.saveRemotePlan(localInputs, localSavedPlans);
        this.isSyncing = false;
        this.notify();
        return { action: 'uploaded' };
      }

      // Case 3: Both have meaningful data -> Compare timestamps & version
      if (isRemoteMeaningful && isLocalMeaningful && remote && localInputs) {
        const remoteTime = new Date(remote.updatedAt).getTime();
        const localTime = localModifiedAt ? new Date(localModifiedAt).getTime() : 0;
        const remoteVersion = Number(remote.version || 0);
        const localVersion = Number((localInputs as unknown as Record<string, unknown>).version || 0);

        if (remoteVersion > localVersion || remoteTime >= localTime) {
          this.applyRemotePlan(remote);
          this.isSyncing = false;
          this.notify();
          return { action: 'downloaded', updatedBy: remote.updatedBy };
        } else {
          await this.saveRemotePlan(localInputs, localSavedPlans);
          this.isSyncing = false;
          this.notify();
          return { action: 'uploaded' };
        }
      }

      // Case 4: Neither is meaningful, but local is configured -> Upload if local configured
      if (localInputs && localInputs.isConfigured && !remote) {
        await this.saveRemotePlan(localInputs, localSavedPlans);
        this.isSyncing = false;
        this.notify();
        return { action: 'uploaded' };
      }

      this.isSyncing = false;
      this.notify();
      return { action: 'up-to-date' };
    } catch (err: unknown) {
      this.isSyncing = false;
      this.error = err instanceof Error ? err.message : 'Plan synchronization failed';
      this.notify();
      throw err;
    }
  }

  /**
   * Debounced Auto-Save trigger for changes made in the UI.
   */
  public scheduleAutoSave(
    inputs: AppStateInputs,
    savedPlans: SavedPlan[] = [],
    customScenarios: CustomRothScenario[] = []
  ): void {
    if (this.isDemoMode) return;

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('retirement_planner_plan_local_modified_at', new Date().toISOString());
    }

    if (!AuthService.isAuthenticated()) return;

    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    this.autoSaveTimer = setTimeout(() => {
      this.saveRemotePlan(inputs, savedPlans, customScenarios).catch(err => {
        console.warn('Background plan auto-save failed:', err);
      });
    }, 2000);
  }
}

export const PlanSyncService = new PlanSyncServiceSingleton();
