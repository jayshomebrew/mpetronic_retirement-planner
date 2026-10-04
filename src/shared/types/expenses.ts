export type SyncStatus = 'SYNCED' | 'PENDING_SYNC' | 'FAILED_SYNC';

export interface ExpenseCategory {
  id: string;
  name: string;
  plannedMonthlyDefault: number;
  color?: string;
  icon?: string;
  isCustom?: boolean;
  createdAt: string;
}

export interface ActualExpense {
  expenseId: string;
  date: string; // ISO YYYY-MM-DD
  amount: number;
  categoryId: string;
  categoryName: string;
  enteredBy: string; // e.g. "Mike" | "Wife"
  notes?: string;
  tags?: string[];
  syncStatus: SyncStatus;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface ExpenseSummaryByCategory {
  categoryId: string;
  categoryName: string;
  plannedAmount: number;
  actualAmount: number;
  variance: number; // actual - planned (positive is overspent)
  percentageOfBudget: number;
  transactionCount: number;
}

export interface AnnualOperationsState {
  year: number;
  bondLadderRungs: Array<{
    id: string;
    cusip?: string;
    maturityYear: number;
    principal: number;
    yieldPercent: number;
    status: 'ACTIVE' | 'MATURED';
  }>;
  bucketTasks: Record<string, boolean | string | number>;
  startingBalances: {
    bucket1Cash: number;
    bucket2Income: number;
    bucket3Growth: number;
  };
  reconciliationNotes?: string;
}

export interface FullHouseholdArchive {
  schemaVersion: number;
  exportedAt: string;
  householdId: string;
  categories: ExpenseCategory[];
  expenses: ActualExpense[];
  annualOperations: Record<number, AnnualOperationsState>;
  planDocument?: unknown;
}

export interface StorageAdapter {
  // Expense operations
  getCategories(): Promise<ExpenseCategory[]>;
  saveCategory(category: Omit<ExpenseCategory, 'createdAt'>): Promise<ExpenseCategory>;
  deleteCategory?(id: string): Promise<void>;

  getExpenses(year: number, month?: number): Promise<ActualExpense[]>;
  getRecentExpenses(limit?: number): Promise<ActualExpense[]>;
  getExpenseById?(id: string): Promise<ActualExpense | null>;
  saveExpense(expense: Omit<ActualExpense, 'expenseId' | 'createdAt' | 'updatedAt' | 'syncStatus'> & {
    expenseId?: string;
    createdAt?: string;
    updatedAt?: string;
    syncStatus?: SyncStatus;
  }): Promise<ActualExpense>;
  saveExpensesBatch?(expenses: Array<Omit<ActualExpense, 'expenseId' | 'createdAt' | 'updatedAt' | 'syncStatus'> & {
    expenseId?: string;
    createdAt?: string;
    updatedAt?: string;
    syncStatus?: SyncStatus;
  }>): Promise<ActualExpense[]>;
  updateExpense(id: string, updates: Partial<ActualExpense>): Promise<ActualExpense>;
  deleteExpense(id: string): Promise<void>;

  // Pending queue sync
  getPendingSyncExpenses(): Promise<ActualExpense[]>;
  markExpensesSynced(expenseIds: string[]): Promise<void>;

  // Full backup & sovereign export
  exportArchive(): Promise<FullHouseholdArchive>;
  importArchive(archive: FullHouseholdArchive): Promise<void>;
}
