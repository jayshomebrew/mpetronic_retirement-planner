import { ActualExpense, ExpenseCategory, FullHouseholdArchive, StorageAdapter, SyncStatus } from '../types/expenses';
import { DEFAULT_EXPENSE_CATEGORIES } from './defaultCategories';

export class InMemoryStorageAdapter implements StorageAdapter {
  private categories: ExpenseCategory[];
  private expenses: ActualExpense[];

  constructor(initialExpenses?: ActualExpense[]) {
    this.categories = [...DEFAULT_EXPENSE_CATEGORIES];
    this.expenses = initialExpenses ? [...initialExpenses] : [];
  }

  async getCategories(): Promise<ExpenseCategory[]> {
    return [...this.categories];
  }

  async saveCategory(category: Omit<ExpenseCategory, 'createdAt'>): Promise<ExpenseCategory> {
    const existingIndex = this.categories.findIndex(c => c.id === category.id);
    const fullCategory: ExpenseCategory = {
      ...category,
      createdAt: existingIndex >= 0 ? this.categories[existingIndex].createdAt : new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      this.categories[existingIndex] = fullCategory;
    } else {
      this.categories.push(fullCategory);
    }

    return fullCategory;
  }

  async deleteCategory(id: string): Promise<void> {
    this.categories = this.categories.filter(c => c.id !== id);
  }

  async getExpenses(year: number, month?: number): Promise<ActualExpense[]> {
    const yearPrefix = `${year}-`;
    const monthPrefix = month !== undefined ? `${year}-${String(month).padStart(2, '0')}-` : null;

    return this.expenses.filter(e => {
      if (monthPrefix) {
        return e.date.startsWith(monthPrefix);
      }
      return e.date.startsWith(yearPrefix);
    });
  }

  async getRecentExpenses(limit: number = 20): Promise<ActualExpense[]> {
    return [...this.expenses]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async getExpenseById(id: string): Promise<ActualExpense | null> {
    const found = this.expenses.find(e => e.expenseId === id);
    return found || null;
  }

  async saveExpense(
    expense: Omit<ActualExpense, 'expenseId' | 'createdAt' | 'updatedAt' | 'syncStatus'> & {
      expenseId?: string;
      createdAt?: string;
      updatedAt?: string;
      syncStatus?: SyncStatus;
    }
  ): Promise<ActualExpense> {
    const now = new Date().toISOString();
    const expenseId = expense.expenseId || `exp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newRecord: ActualExpense = {
      ...expense,
      expenseId,
      syncStatus: expense.syncStatus || 'PENDING_SYNC',
      createdAt: expense.createdAt || now,
      updatedAt: expense.updatedAt || now,
    };

    const existingIndex = this.expenses.findIndex(e => e.expenseId === expenseId);
    if (existingIndex >= 0) {
      this.expenses[existingIndex] = newRecord;
    } else {
      this.expenses.push(newRecord);
    }
    return newRecord;
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
    const results: ActualExpense[] = [];
    for (const exp of expenses) {
      results.push(await this.saveExpense(exp));
    }
    return results;
  }

  async updateExpense(id: string, updates: Partial<ActualExpense>): Promise<ActualExpense> {
    const index = this.expenses.findIndex(e => e.expenseId === id);
    if (index === 0 && this.expenses.length === 0) {
      throw new Error(`Expense ${id} not found`);
    }
    if (index === -1) {
      throw new Error(`Expense ${id} not found`);
    }

    const updated = {
      ...this.expenses[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.expenses[index] = updated;
    return updated;
  }

  async deleteExpense(id: string): Promise<void> {
    this.expenses = this.expenses.filter(e => e.expenseId !== id);
  }

  async getPendingSyncExpenses(): Promise<ActualExpense[]> {
    return this.expenses.filter(e => e.syncStatus === 'PENDING_SYNC');
  }

  async markExpensesSynced(expenseIds: string[]): Promise<void> {
    const idSet = new Set(expenseIds);
    this.expenses = this.expenses.map(e => (idSet.has(e.expenseId) ? { ...e, syncStatus: 'SYNCED' } : e));
  }

  async exportArchive(): Promise<FullHouseholdArchive> {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      householdId: 'local_household',
      categories: [...this.categories],
      expenses: [...this.expenses],
      annualOperations: {},
    };
  }

  async importArchive(archive: FullHouseholdArchive): Promise<void> {
    if (archive.categories) {
      this.categories = [...archive.categories];
    }
    if (archive.expenses) {
      this.expenses = [...archive.expenses];
    }
  }
}
