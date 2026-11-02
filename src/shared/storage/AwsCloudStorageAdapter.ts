import { ActualExpense, ExpenseCategory, FullHouseholdArchive, NewExpenseInput, StorageAdapter } from '../types/expenses';
import { IndexedDbStorageAdapter } from './IndexedDbStorageAdapter';
import { AuthService } from '../auth/AuthService';
import { getCloudConfig } from '../auth/config';
import { CloudRebalancingStorage } from './rebalancing/CloudRebalancingStorage';

const FLUSH_BATCH_SIZE = 25;
const FLUSH_MAX_ATTEMPTS = 3;
const PENDING_CATEGORY_PUSHES_KEY = 'expenser_pending_category_pushes';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class AwsCloudStorageAdapter implements StorageAdapter {
  private localAdapter: IndexedDbStorageAdapter;
  private isSyncingExpenses: boolean = false;
  private isSyncingCategories: boolean = false;
  private lastCategorySyncTime: number = 0;
  private readonly CATEGORY_CACHE_TTL_MS: number = 15 * 60 * 1000; // 15-minute in-memory throttle
  private flushInFlight: Promise<{ syncedCount: number; errors: number }> | null = null;
  private flushRerunRequested: boolean = false;
  private lastSyncError: string | null = null;
  // Category pushes are serialized so a catalog sync of dozens of items does not
  // fan out into dozens of concurrent Lambda invocations (account limit is low).
  private categoryPushChain: Promise<void> = Promise.resolve();

  constructor(localAdapter?: IndexedDbStorageAdapter) {
    this.localAdapter = localAdapter || new IndexedDbStorageAdapter();
  }

  /**
   * IDs of locally saved categories the cloud has not confirmed yet. They survive reloads so a
   * cloud refresh never purges a category whose push is still in flight or failed.
   */
  private getPendingCategoryPushIds(): Set<string> {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(PENDING_CATEGORY_PUSHES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  }

  private setPendingCategoryPushIds(ids: Set<string>): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PENDING_CATEGORY_PUSHES_KEY, JSON.stringify([...ids]));
    } catch {
      // ignore storage failures
    }
  }

  private markCategoryPushPending(id: string): void {
    const ids = this.getPendingCategoryPushIds();
    ids.add(id);
    this.setPendingCategoryPushIds(ids);
  }

  private clearCategoryPushPending(id: string): void {
    const ids = this.getPendingCategoryPushIds();
    if (ids.delete(id)) this.setPendingCategoryPushIds(ids);
  }

  /** Human-readable reason the last expense sync attempt failed, or null if it succeeded. */
  public getLastSyncError(): string | null {
    return this.lastSyncError;
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

  /** Invalidate in-memory category cache timestamp so next call fetches fresh data */
  public invalidateCategoryCache(): void {
    this.lastCategorySyncTime = 0;
  }

  async getCategories(forceRefresh: boolean = false): Promise<ExpenseCategory[]> {
    const now = Date.now();
    const isExpired = now - this.lastCategorySyncTime > this.CATEGORY_CACHE_TTL_MS;

    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      if (forceRefresh || isExpired) {
        this.lastCategorySyncTime = now;
        try {
          await this.syncCategoriesFromCloud();
        } catch (err) {
          console.warn('Background category cloud sync failed, using local cache:', err);
        }
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

      // Let in-flight pushes finish, then retry any that failed, so a brand-new local
      // category is never mistaken for one that was deleted in the cloud.
      await this.categoryPushChain;
      const remoteIds = new Set(remoteCats.map(c => c.id));
      const localCats = await this.localAdapter.getCategories();
      const pendingIds = this.getPendingCategoryPushIds();

      for (const localCat of localCats) {
        if (remoteIds.has(localCat.id)) {
          this.clearCategoryPushPending(localCat.id);
        } else if (pendingIds.has(localCat.id)) {
          try {
            await this.pushCategoryToCloud(localCat);
          } catch (err) {
            console.warn('Retry of category push failed:', err);
          }
        }
      }

      // 1. Purge any local categories that were deleted in the cloud (never unpushed ones)
      for (const localCat of localCats) {
        if (!remoteIds.has(localCat.id) && !pendingIds.has(localCat.id)) {
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
    let unchanged = false;
    try {
      const existing = (await this.localAdapter.getCategories()).find(c => c.id === category.id);
      unchanged = Boolean(
        existing &&
          existing.name === category.name &&
          existing.plannedMonthlyDefault === category.plannedMonthlyDefault &&
          existing.color === category.color &&
          existing.icon === category.icon &&
          Boolean(existing.isCustom) === Boolean(category.isCustom)
      );
    } catch {
      unchanged = false;
    }

    const saved = await this.localAdapter.saveCategory(category);
    if (!unchanged) this.markCategoryPushPending(saved.id);

    // Sync to DynamoDB only when something actually changed, one request at a time
    if (!unchanged && typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      this.categoryPushChain = this.categoryPushChain
        .then(() => this.pushCategoryToCloud(saved))
        .catch(err => {
          console.warn('Failed to push category to cloud:', err);
        });
    }

    this.lastCategorySyncTime = Date.now();
    return saved;
  }

  private async pushCategoryToCloud(category: ExpenseCategory): Promise<void> {
    const headers = await this.getAuthHeaders();
    if (!headers) return;

    const response = await fetch(`${this.getApiEndpoint()}/api/categories`, {
      method: 'POST',
      headers,
      body: JSON.stringify(category),
    });
    if (!response.ok) {
      throw new Error(`Failed to push category ${category.id} (status ${response.status})`);
    }
    this.clearCategoryPushPending(category.id);
  }

  async deleteCategory(id: string): Promise<void> {
    this.lastCategorySyncTime = Date.now();
    await this.localAdapter.deleteCategory(id);
    this.clearCategoryPushPending(id);

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

      // 3. Save / update authoritative remote expenses, preserving newer local edits
      for (const exp of remoteExpenses) {
        if (pendingIds.has(exp.expenseId)) {
          continue;
        }

        if (this.localAdapter.getExpenseById) {
          const localExisting = await this.localAdapter.getExpenseById(exp.expenseId);
          if (localExisting) {
            if (localExisting.syncStatus === 'PENDING_SYNC') {
              continue;
            }
            if (
              localExisting.updatedAt &&
              exp.updatedAt &&
              new Date(localExisting.updatedAt).getTime() > new Date(exp.updatedAt).getTime()
            ) {
              // Local expense is newer than remote snapshot; preserve local edit
              continue;
            }
          }
        }

        await this.localAdapter.saveExpense({
          ...exp,
          syncStatus: 'SYNCED',
        });
      }
    } finally {
      this.isSyncingExpenses = false;
    }
  }

  /**
   * Fetches all expenses across all years and months directly from AWS DynamoDB.
   * Returns the complete unstripped database item records with all fields.
   */
  async getAllExpensesFromCloud(): Promise<Array<Record<string, unknown>>> {
    const headers = await this.getAuthHeaders();
    if (!headers) {
      throw new Error('Not authenticated with AWS. Please sign in to fetch all expenses from DynamoDB.');
    }

    const endpoint = `${this.getApiEndpoint()}/api/expenses`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to fetch expenses from DynamoDB (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const rawList: Record<string, unknown>[] = Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : Array.isArray(data.expenses)
      ? (data.expenses as Record<string, unknown>[])
      : [];

    // Also update local cache for items with standard expense shape
    try {
      const pending = await this.localAdapter.getPendingSyncExpenses();
      const pendingIds = new Set(pending.map(p => p.expenseId));
      for (const item of rawList) {
        const expId = typeof item.expenseId === 'string' ? item.expenseId : undefined;
        if (expId && !pendingIds.has(expId)) {
          let category = typeof item.category === 'string' ? item.category : undefined;
          let name = typeof item.name === 'string' ? item.name : undefined;
          if (!category && typeof item.categoryName === 'string') {
            const parts = item.categoryName.split(' - ');
            category = parts[0] || 'Uncategorized';
            name = parts.slice(1).join(' - ') || item.categoryName;
          }
          const catalogId =
            typeof item.catalogId === 'string'
              ? item.catalogId
              : typeof item.categoryId === 'string'
              ? item.categoryId
              : 'uncategorized';

          await this.localAdapter.saveExpense({
            expenseId: expId,
            catalogId,
            category: category || 'Uncategorized',
            name: name || 'Expense',
            date: typeof item.date === 'string' ? item.date : '',
            amount: Number(item.amount) || 0,
            categoryId: catalogId,
            categoryName: `${category || 'Uncategorized'} - ${name || 'Expense'}`,
            enteredBy: typeof item.enteredBy === 'string' ? item.enteredBy : 'Primary',
            notes: typeof item.notes === 'string' ? item.notes : undefined,
            tags: Array.isArray(item.tags) ? (item.tags as string[]) : undefined,
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
            updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
            syncStatus: 'SYNCED',
          });
        }
      }
    } catch (cacheErr) {
      console.warn('Failed to update local cache with full cloud expenses:', cacheErr);
    }

    return rawList;
  }

  async getRecentExpenses(limit: number = 20, sortBy: 'occurred' | 'entered' = 'occurred'): Promise<ActualExpense[]> {
    return this.localAdapter.getRecentExpenses(limit, sortBy);
  }

  async saveExpense(expense: NewExpenseInput): Promise<ActualExpense> {
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

  async saveExpensesBatch(expenses: NewExpenseInput[]): Promise<ActualExpense[]> {
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

  async updateExpensesBatch(
    batch: Array<{ id: string; updates: Partial<ActualExpense> }>
  ): Promise<ActualExpense[]> {
    if (batch.length === 0) return [];

    let updated: ActualExpense[];
    if (this.localAdapter.updateExpensesBatch) {
      updated = await this.localAdapter.updateExpensesBatch(
        batch.map(item => ({
          ...item,
          updates: { ...item.updates, syncStatus: 'PENDING_SYNC' },
        }))
      );
    } else {
      updated = [];
      for (const item of batch) {
        updated.push(
          await this.localAdapter.updateExpense(item.id, {
            ...item.updates,
            syncStatus: 'PENDING_SYNC',
          })
        );
      }
    }

    if (typeof window !== 'undefined' && navigator.onLine && AuthService.isAuthenticated()) {
      try {
        await this.flushPendingExpenses();
      } catch (err) {
        console.warn('Background update expenses batch sync failed:', err);
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

  async clearAllExpenses(): Promise<void> {
    if (this.localAdapter.clearAllExpenses) {
      await this.localAdapter.clearAllExpenses();
    }
  }

  // --- Queue Synchronization ---

  async getPendingSyncExpenses(): Promise<ActualExpense[]> {
    return this.localAdapter.getPendingSyncExpenses();
  }

  async markExpensesSynced(expenseIds: string[]): Promise<void> {
    return this.localAdapter.markExpensesSynced(expenseIds);
  }

  /**
   * Pushes all PENDING_SYNC expenses to DynamoDB. Single-flight: concurrent callers share
   * the running flush, and a caller arriving mid-flush triggers one follow-up pass so
   * expenses saved during the flush are not left queued.
   */
  public flushPendingExpenses(): Promise<{ syncedCount: number; errors: number }> {
    if (this.flushInFlight) {
      this.flushRerunRequested = true;
      return this.flushInFlight;
    }

    const run = (async () => {
      let totalSynced = 0;
      let totalErrors = 0;
      do {
        this.flushRerunRequested = false;
        const result = await this.flushPendingExpensesOnce();
        totalSynced += result.syncedCount;
        totalErrors = result.errors;
        if (result.errors > 0) break;
      } while (this.flushRerunRequested);
      return { syncedCount: totalSynced, errors: totalErrors };
    })();

    this.flushInFlight = run;
    const clear = () => {
      this.flushInFlight = null;
    };
    run.then(clear, clear);
    return run;
  }

  private async flushPendingExpensesOnce(): Promise<{ syncedCount: number; errors: number }> {
    const pending = await this.localAdapter.getPendingSyncExpenses();
    if (pending.length === 0) {
      this.lastSyncError = null;
      return { syncedCount: 0, errors: 0 };
    }

    let syncedCount = 0;

    for (let i = 0; i < pending.length; i += FLUSH_BATCH_SIZE) {
      const chunk = pending.slice(i, i + FLUSH_BATCH_SIZE);
      let chunkSynced = false;

      for (let attempt = 1; attempt <= FLUSH_MAX_ATTEMPTS && !chunkSynced; attempt++) {
        // Re-resolve headers every attempt so an expired token gets refreshed
        const headers = await this.getAuthHeaders();
        if (!headers) {
          this.lastSyncError = 'Not signed in - sign in to sync queued expenses';
          console.warn(this.lastSyncError);
          return { syncedCount, errors: pending.length - syncedCount };
        }

        try {
          const response = await fetch(`${this.getApiEndpoint()}/api/expenses/batch`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ expenses: chunk }),
          });

          if (response.ok) {
            const ids = chunk.map(p => p.expenseId);
            await this.localAdapter.markExpensesSynced(ids);
            syncedCount += ids.length;
            chunkSynced = true;
            break;
          }

          const retryable = response.status === 429 || response.status >= 500;
          this.lastSyncError = `Cloud sync failed (HTTP ${response.status})`;
          console.error(`Batch expense sync failed with status ${response.status} (attempt ${attempt}/${FLUSH_MAX_ATTEMPTS})`);
          if (!retryable) break;
        } catch (err) {
          this.lastSyncError = `Cloud sync failed (${err instanceof Error ? err.message : 'network error'})`;
          console.error(`Error flushing pending expenses (attempt ${attempt}/${FLUSH_MAX_ATTEMPTS}):`, err);
        }

        if (attempt < FLUSH_MAX_ATTEMPTS) {
          await sleep(500 * attempt * attempt);
        }
      }

      if (!chunkSynced) {
        return { syncedCount, errors: pending.length - syncedCount };
      }
    }

    this.lastSyncError = null;

    if (syncedCount > 0 && typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cloud_sync_completed', { detail: { count: syncedCount } }));
    }

    return { syncedCount, errors: 0 };
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
    // 1. Ingest into local IndexedDB (rebalancing data goes through its own cloud-aware storage)
    const { rebalancingAccounts, rebalancingSnapshots, ...coreArchive } = archive;
    await this.localAdapter.importArchive(coreArchive);
    if (rebalancingAccounts && rebalancingAccounts.length > 0) {
      const report = await new CloudRebalancingStorage().importRebalancing(
        rebalancingAccounts,
        rebalancingSnapshots || []
      );
      if (report.skippedAccounts.length > 0) {
        console.warn('Rebalancing import skipped existing accounts:', report.skippedAccounts.join(', '));
      }
    }

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
