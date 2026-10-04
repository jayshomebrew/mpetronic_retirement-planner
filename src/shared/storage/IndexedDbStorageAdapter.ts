import { ActualExpense, ExpenseCategory, FullHouseholdArchive, StorageAdapter, SyncStatus } from '../types/expenses';

const DB_NAME = 'RetirementExpenserDB';
const DB_VERSION = 1;
const STORE_EXPENSES = 'expenses';
const STORE_CATEGORIES = 'categories';

export class IndexedDbStorageAdapter implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      throw new Error('IndexedDB is not supported or not available in this environment');
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(request.error || new Error('Failed to open IndexedDB'));
      };

      request.onsuccess = async () => {
        const db = request.result;
        // Ensure default categories exist
        await this.ensureDefaultCategories(db);
        resolve(db);
      };

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Categories store
        if (!db.objectStoreNames.contains(STORE_CATEGORIES)) {
          db.createObjectStore(STORE_CATEGORIES, { keyPath: 'id' });
        }

        // Expenses store
        if (!db.objectStoreNames.contains(STORE_EXPENSES)) {
          const expenseStore = db.createObjectStore(STORE_EXPENSES, { keyPath: 'expenseId' });
          expenseStore.createIndex('date', 'date', { unique: false });
          expenseStore.createIndex('categoryId', 'categoryId', { unique: false });
          expenseStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          expenseStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });

    return this.dbPromise;
  }

  private async ensureDefaultCategories(db: IDBDatabase): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CATEGORIES, 'readwrite');
      const store = tx.objectStore(STORE_CATEGORIES);
      const req = store.getAll();

      req.onsuccess = () => {
        // Only purge legacy hardcoded mock seed IDs so real cloud categories are preserved
        const legacyMockIds = new Set([
          'cat_living',
          'cat_housing',
          'cat_transportation',
          'cat_insurance',
          'cat_healthcare',
          'cat_leisure',
          'cat_other',
        ]);
        const items = (req.result || []) as ExpenseCategory[];
        for (const item of items) {
          if (legacyMockIds.has(item.id)) {
            store.delete(item.id);
          }
        }
        resolve();
      };

      req.onerror = () => reject(req.error);
    });
  }

  async getCategories(): Promise<ExpenseCategory[]> {
    const db = await this.getDB();
    return new Promise<ExpenseCategory[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CATEGORIES, 'readonly');
      const store = tx.objectStore(STORE_CATEGORIES);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async saveCategory(category: Omit<ExpenseCategory, 'createdAt'>): Promise<ExpenseCategory> {
    const db = await this.getDB();
    const existing = await this.getCategoryById(category.id);
    const fullCategory: ExpenseCategory = {
      ...category,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
    };

    return new Promise<ExpenseCategory>((resolve, reject) => {
      const tx = db.transaction(STORE_CATEGORIES, 'readwrite');
      const store = tx.objectStore(STORE_CATEGORIES);
      const req = store.put(fullCategory);

      req.onsuccess = () => resolve(fullCategory);
      req.onerror = () => reject(req.error);
    });
  }

  private async getCategoryById(id: string): Promise<ExpenseCategory | null> {
    const db = await this.getDB();
    return new Promise<ExpenseCategory | null>((resolve, reject) => {
      const tx = db.transaction(STORE_CATEGORIES, 'readonly');
      const store = tx.objectStore(STORE_CATEGORIES);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteCategory(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CATEGORIES, 'readwrite');
      const store = tx.objectStore(STORE_CATEGORIES);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getExpenses(year: number, month?: number): Promise<ActualExpense[]> {
    const all = await this.getAllExpenses();
    const yearPrefix = `${year}-`;
    const monthPrefix = month !== undefined ? `${year}-${String(month).padStart(2, '0')}-` : null;

    return all.filter(e => {
      if (monthPrefix) {
        return e.date.startsWith(monthPrefix);
      }
      return e.date.startsWith(yearPrefix);
    });
  }

  async getRecentExpenses(limit: number = 20): Promise<ActualExpense[]> {
    const all = await this.getAllExpenses();
    return all
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  private async getAllExpenses(): Promise<ActualExpense[]> {
    const db = await this.getDB();
    return new Promise<ActualExpense[]>((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readonly');
      const store = tx.objectStore(STORE_EXPENSES);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async saveExpense(
    expense: Omit<ActualExpense, 'expenseId' | 'createdAt' | 'updatedAt' | 'syncStatus'> & {
      expenseId?: string;
      createdAt?: string;
      updatedAt?: string;
      syncStatus?: SyncStatus;
    }
  ): Promise<ActualExpense> {
    const db = await this.getDB();
    const now = new Date().toISOString();
    const expenseId = expense.expenseId || `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newRecord: ActualExpense = {
      ...expense,
      expenseId,
      syncStatus: expense.syncStatus || 'PENDING_SYNC',
      createdAt: expense.createdAt || now,
      updatedAt: expense.updatedAt || now,
    };

    return new Promise<ActualExpense>((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readwrite');
      const store = tx.objectStore(STORE_EXPENSES);
      const req = store.put(newRecord);

      req.onsuccess = () => resolve(newRecord);
      req.onerror = () => reject(req.error);
    });
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
    const db = await this.getDB();
    const now = new Date().toISOString();
    const records: ActualExpense[] = expenses.map(exp => ({
      ...exp,
      expenseId: exp.expenseId || `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      syncStatus: exp.syncStatus || 'PENDING_SYNC',
      createdAt: exp.createdAt || now,
      updatedAt: exp.updatedAt || now,
    }));

    return new Promise<ActualExpense[]>((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readwrite');
      const store = tx.objectStore(STORE_EXPENSES);

      for (const record of records) {
        store.put(record);
      }

      tx.oncomplete = () => resolve(records);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async updateExpense(id: string, updates: Partial<ActualExpense>): Promise<ActualExpense> {
    const db = await this.getDB();
    const existing = await this.getExpenseById(id);
    if (!existing) {
      throw new Error(`Expense ${id} not found`);
    }

    const updated: ActualExpense = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    return new Promise<ActualExpense>((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readwrite');
      const store = tx.objectStore(STORE_EXPENSES);
      const req = store.put(updated);

      req.onsuccess = () => resolve(updated);
      req.onerror = () => reject(req.error);
    });
  }

  async getExpenseById(id: string): Promise<ActualExpense | null> {
    const db = await this.getDB();
    return new Promise<ActualExpense | null>((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readonly');
      const store = tx.objectStore(STORE_EXPENSES);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteExpense(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readwrite');
      const store = tx.objectStore(STORE_EXPENSES);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getPendingSyncExpenses(): Promise<ActualExpense[]> {
    const db = await this.getDB();
    return new Promise<ActualExpense[]>((resolve, reject) => {
      const tx = db.transaction(STORE_EXPENSES, 'readonly');
      const store = tx.objectStore(STORE_EXPENSES);
      const index = store.index('syncStatus');
      const req = index.getAll('PENDING_SYNC');

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async markExpensesSynced(expenseIds: string[]): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(STORE_EXPENSES, 'readwrite');
    const store = tx.objectStore(STORE_EXPENSES);

    for (const id of expenseIds) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (getReq.result) {
          const item = getReq.result as ActualExpense;
          item.syncStatus = 'SYNCED';
          item.updatedAt = new Date().toISOString();
          store.put(item);
        }
      };
    }

    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async exportArchive(): Promise<FullHouseholdArchive> {
    const categories = await this.getCategories();
    const expenses = await this.getAllExpenses();

    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      householdId: 'local_household',
      categories,
      expenses,
      annualOperations: {},
    };
  }

  async importArchive(archive: FullHouseholdArchive): Promise<void> {
    const db = await this.getDB();

    if (archive.categories && archive.categories.length > 0) {
      const txCat = db.transaction(STORE_CATEGORIES, 'readwrite');
      const storeCat = txCat.objectStore(STORE_CATEGORIES);
      for (const cat of archive.categories) {
        storeCat.put(cat);
      }
    }

    if (archive.expenses && archive.expenses.length > 0) {
      const txExp = db.transaction(STORE_EXPENSES, 'readwrite');
      const storeExp = txExp.objectStore(STORE_EXPENSES);
      for (const exp of archive.expenses) {
        storeExp.put(exp);
      }
    }
  }
}
