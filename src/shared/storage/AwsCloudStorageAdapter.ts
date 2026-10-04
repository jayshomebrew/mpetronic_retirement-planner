import { ActualExpense, ExpenseCategory, FullHouseholdArchive, StorageAdapter, SyncStatus } from '../types/expenses';
import { IndexedDbStorageAdapter } from './IndexedDbStorageAdapter';
import { AuthService } from '../auth/AuthService';
import { getCloudConfig } from '../auth/config';

export class AwsCloudStorageAdapter implements StorageAdapter {
  private localAdapter: IndexedDbStorageAdapter;
  private isSyncingExpenses: boolean = false;
  private isSyncingCategories: boolean = false;

  constructor(localAdapter?: IndexedDbStorageAdapter) {
    this.localAdapter = localAdapter || new IndexedDbStorageAdapter();
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

  // --- Category Operations ---

  async getCategories(): Promise<ExpenseCategory[]> {
    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      try {
        await this.syncCategoriesFromCloud();
      } catch (err) {
        console.warn('Background category cloud sync failed, using local cache:', err);
      }
    }

    return this.localAdapter.getCategories();
  }

  private async syncCategoriesFromCloud(): Promise<void> {
    if (this.isSyncingCategories) return;
    this.isSyncingCategories = true;

    try {
      const headers = await this.getAuthHeaders();
      if (!headers) return;

      const endpoint = `${this.getApiEndpoint()}/api/categories`;
      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
      });

      if (!response.ok) return;

      const data = await response.json();
      const remoteCats: ExpenseCategory[] = Array.isArray(data)
        ? data
        : Array.isArray(data.categories)
        ? data.categories
        : [];

      const remoteIds = new Set(remoteCats.map(c => c.id));
      const localCats = await this.localAdapter.getCategories();

      // 1. Purge any local categories that were deleted in the cloud
      for (const localCat of localCats) {
        if (!remoteIds.has(localCat.id)) {
          await this.localAdapter.deleteCategory(localCat.id);
        }
      }

      // 2. Save / update all active remote categories
      for (const cat of remoteCats) {
        await this.localAdapter.saveCategory(cat);
      }
    } finally {
      this.isSyncingCategories = false;
    }
  }

  async saveCategory(category: Omit<ExpenseCategory, 'createdAt'>): Promise<ExpenseCategory> {
    const saved = await this.localAdapter.saveCategory(category);

    // Sync to DynamoDB
    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      this.pushCategoryToCloud(saved).catch(err => {
        console.warn('Failed to push category to cloud:', err);
      });
    }

    return saved;
  }

  private async pushCategoryToCloud(category: ExpenseCategory): Promise<void> {
    const headers = await this.getAuthHeaders();
    if (!headers) return;

    await fetch(`${this.getApiEndpoint()}/api/categories`, {
      method: 'POST',
      headers,
      body: JSON.stringify(category),
    });
  }

  async deleteCategory(id: string): Promise<void> {
    await this.localAdapter.deleteCategory(id);

    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      try {
        const headers = await this.getAuthHeaders();
        if (headers) {
          await fetch(`${this.getApiEndpoint()}/api/categories/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers,
          });
        }
      } catch (err) {
        console.warn('Failed to delete category on cloud:', err);
      }
    }
  }

  // --- Expense Operations ---

  async getExpenses(year: number, month?: number): Promise<ActualExpense[]> {
    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      try {
        await this.syncExpensesFromCloud(year, month);
      } catch (err) {
        console.warn('Background expense cloud sync failed, using local cache:', err);
      }
    }

    return this.localAdapter.getExpenses(year, month);
  }

  private async syncExpensesFromCloud(year: number, month?: number): Promise<void> {
    if (this.isSyncingExpenses) return;
    this.isSyncingExpenses = true;

    try {
      const headers = await this.getAuthHeaders();
      if (!headers) return;

      let url = `${this.getApiEndpoint()}/api/expenses?year=${year}`;
      if (month !== undefined) {
        url += `&month=${month}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) return;

      const data = await response.json();
      const remoteExpenses: ActualExpense[] = Array.isArray(data)
        ? data
        : Array.isArray(data.expenses)
        ? data.expenses
        : [];

      const pending = await this.localAdapter.getPendingSyncExpenses();
      const pendingIds = new Set(pending.map(p => p.expenseId));
      const remoteIds = new Set(remoteExpenses.map(p => p.expenseId));

      // 1. Fetch current local expenses for this timeframe
      const localExpenses = await this.localAdapter.getExpenses(year, month);

      // 2. Remove any local expenses that were deleted on the cloud (and not pending sync)
      for (const localExp of localExpenses) {
        if (!remoteIds.has(localExp.expenseId) && !pendingIds.has(localExp.expenseId) && localExp.syncStatus !== 'PENDING_SYNC') {
          await this.localAdapter.deleteExpense(localExp.expenseId);
        }
      }

      // 3. Save / update all authoritative remote expenses
      for (const exp of remoteExpenses) {
        if (!pendingIds.has(exp.expenseId)) {
          await this.localAdapter.saveExpense({
            ...exp,
            syncStatus: 'SYNCED',
          });
        }
      }
    } finally {
      this.isSyncingExpenses = false;
    }
  }

  async getRecentExpenses(limit: number = 20): Promise<ActualExpense[]> {
    return this.localAdapter.getRecentExpenses(limit);
  }

  async saveExpense(expense: Omit<ActualExpense, 'expenseId' | 'createdAt' | 'updatedAt' | 'syncStatus'>): Promise<ActualExpense> {
    // 1. Write to local IndexedDB first with PENDING_SYNC status (100% offline-ready)
    const saved = await this.localAdapter.saveExpense(expense);

    // 2. Immediately attempt to push pending queue to cloud if online & authenticated
    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      this.flushPendingExpenses().catch(err => {
        console.warn('Background pending expenses flush failed:', err);
      });
    }

    return saved;
  }

  async saveExpensesBatch(
    expenses: Array<
      Omit<ActualExpense, 'expenseId' | 'createdAt' | 'updatedAt' | 'syncStatus'> & {
        expenseId?: string;
        createdAt?: string;
        updatedAt?: string;
        syncStatus?: SyncStatus;
      }
    >
  ): Promise<ActualExpense[]> {
    if (expenses.length === 0) return [];

    // 1. Write entire batch to local IndexedDB in a single transaction
    const saved = this.localAdapter.saveExpensesBatch
      ? await this.localAdapter.saveExpensesBatch(expenses)
      : await Promise.all(expenses.map(e => this.localAdapter.saveExpense(e)));

    // 2. Push pending queue to cloud ONCE after entire batch is safely written
    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      this.flushPendingExpenses().catch(err => {
        console.warn('Background batch pending expenses flush failed:', err);
      });
    }

    return saved;
  }

  async getExpenseById(id: string): Promise<ActualExpense | null> {
    if (this.localAdapter.getExpenseById) {
      return this.localAdapter.getExpenseById(id);
    }
    return null;
  }

  async updateExpense(id: string, updates: Partial<ActualExpense>): Promise<ActualExpense> {
    const existing = this.localAdapter.getExpenseById ? await this.localAdapter.getExpenseById(id) : null;
    const dateChangedMonthOrYear = Boolean(
      existing && updates.date && existing.date.slice(0, 7) !== updates.date.slice(0, 7)
    );

    const updated = await this.localAdapter.updateExpense(id, {
      ...updates,
      syncStatus: 'PENDING_SYNC',
    });

    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      // If date changed year or month, delete the old remote item with the old sort key from DynamoDB
      if (dateChangedMonthOrYear) {
        try {
          const headers = await this.getAuthHeaders();
          if (headers) {
            await fetch(`${this.getApiEndpoint()}/api/expenses/${encodeURIComponent(id)}`, {
              method: 'DELETE',
              headers,
            });
          }
        } catch (err) {
          console.warn('Failed to delete old remote expense during date move:', err);
        }
      }

      try {
        await this.flushPendingExpenses();
      } catch (err) {
        console.warn('Background update expense sync failed:', err);
      }
    }

    return updated;
  }

  async deleteExpense(id: string): Promise<void> {
    await this.localAdapter.deleteExpense(id);

    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      try {
        const headers = await this.getAuthHeaders();
        if (headers) {
          await fetch(`${this.getApiEndpoint()}/api/expenses/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers,
          });
        }
      } catch (err) {
        console.warn('Failed to delete expense on cloud:', err);
      }
    }
  }

  // --- Queue Synchronization ---

  async getPendingSyncExpenses(): Promise<ActualExpense[]> {
    return this.localAdapter.getPendingSyncExpenses();
  }

  async markExpensesSynced(expenseIds: string[]): Promise<void> {
    return this.localAdapter.markExpensesSynced(expenseIds);
  }

  public async flushPendingExpenses(): Promise<{ syncedCount: number; errors: number }> {
    const pending = await this.localAdapter.getPendingSyncExpenses();
    if (pending.length === 0) {
      return { syncedCount: 0, errors: 0 };
    }

    const headers = await this.getAuthHeaders();
    if (!headers) {
      return { syncedCount: 0, errors: pending.length };
    }

    try {
      const response = await fetch(`${this.getApiEndpoint()}/api/expenses/batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          expenses: pending,
        }),
      });

      if (!response.ok) {
        throw new Error(`Batch expense sync failed with status ${response.status}`);
      }

      const syncedIds = pending.map(p => p.expenseId);
      await this.localAdapter.markExpensesSynced(syncedIds);

      if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cloud_sync_completed', { detail: { count: syncedIds.length } }));
      }

      return { syncedCount: syncedIds.length, errors: 0 };
    } catch (err) {
      console.error('Error flushing pending expenses:', err);
      return { syncedCount: 0, errors: pending.length };
    }
  }

  // --- Full Backup & Sovereign Export ---

  async exportArchive(): Promise<FullHouseholdArchive> {
    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      try {
        const headers = await this.getAuthHeaders();
        if (headers) {
          const response = await fetch(`${this.getApiEndpoint()}/api/export`, {
            method: 'GET',
            headers,
          });
          if (response.ok) {
            return await response.json();
          }
        }
      } catch (err) {
        console.warn('Cloud export failed, falling back to local archive:', err);
      }
    }
    return this.localAdapter.exportArchive();
  }

  async importArchive(archive: FullHouseholdArchive): Promise<void> {
    // 1. Ingest into local IndexedDB
    await this.localAdapter.importArchive(archive);

    // 2. If authenticated, push categories and expenses to Cloud DynamoDB
    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      if (archive.categories && archive.categories.length > 0) {
        for (const cat of archive.categories) {
          await this.pushCategoryToCloud(cat).catch(console.warn);
        }
      }
      if (archive.expenses && archive.expenses.length > 0) {
        await this.flushPendingExpenses().catch(console.warn);
      }
    }
  }
}
