import type { RebalanceAccountTemplate, RebalanceSnapshot } from './rebalancing';

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
  catalogId: string; // Foreign key linking to catalog item definition
  category: string; // Category group (e.g. "Subscriptions", "Living")
  name: string; // Expense Name (e.g. "Amazon Prime", "Groceries")
  date: string; // ISO YYYY-MM-DD
  amount: number;
  enteredBy: string; // e.g. "Mike" | "Wife"
  notes?: string;
  tags?: string[];
  syncStatus: SyncStatus;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp

  // Backward-compatibility / transitional fields (deprecated)
  categoryId?: string;
  categoryName?: string;
}
export interface StatementColumnMapping {
  dateColumn: string;
  descriptionColumn: string;
  amountMode: 'single' | 'split_debit_credit';
  amountColumn?: string;
  debitColumn?: string;
  creditColumn?: string;
  chargesAreNegative: boolean; // true for Capital One (sales negative, payments/returns positive)
  categoryColumn?: string;
  typeColumn?: string;
  notesColumn?: string;
  payerColumn?: string;
}

export interface StatementFormatProfile {
  id: string;
  nickname: string; // e.g. "Capital One Venture", "Chase Sapphire", "Navy Federal Checking"
  fingerprint: string; // Normalized sorted header token hash
  mapping: StatementColumnMapping;
  createdAt: string;
  updatedAt: string;
}

export interface LearnedMerchantRule {
  normalizedKey: string; // Canonical cleaned merchant root, e.g. "GIANT FOOD"
  category: string;
  lineItem: string;
  lastUsed: string;
  matchCount: number;
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
  rebalancingAccounts?: RebalanceAccountTemplate[];
  rebalancingSnapshots?: RebalanceSnapshot[];
}

export type NewExpenseInput = Omit<
  ActualExpense,
  'expenseId' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'catalogId' | 'category' | 'name'
> & {
  expenseId?: string;
  catalogId?: string;
  category?: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  syncStatus?: SyncStatus;
};

export interface StorageAdapter {
  // Expense operations
  getCategories(): Promise<ExpenseCategory[]>;
  saveCategory(category: Omit<ExpenseCategory, 'createdAt'>): Promise<ExpenseCategory>;
  deleteCategory?(id: string): Promise<void>;

  getExpenses(year: number, month?: number): Promise<ActualExpense[]>;
  getRecentExpenses(limit?: number, sortBy?: 'occurred' | 'entered'): Promise<ActualExpense[]>;
  getExpenseById?(id: string): Promise<ActualExpense | null>;
  saveExpense(expense: NewExpenseInput): Promise<ActualExpense>;
  saveExpensesBatch?(expenses: NewExpenseInput[]): Promise<ActualExpense[]>;
  updateExpense(id: string, updates: Partial<ActualExpense>): Promise<ActualExpense>;
  updateExpensesBatch?(batch: Array<{ id: string; updates: Partial<ActualExpense> }>): Promise<ActualExpense[]>;
  deleteExpense(id: string): Promise<void>;
  clearAllExpenses?(): Promise<void>;

  // Pending queue sync
  getPendingSyncExpenses(): Promise<ActualExpense[]>;
  markExpensesSynced(expenseIds: string[]): Promise<void>;

  // Sovereign statement format profiles & learned merchant memory
  getStatementProfiles?(): Promise<StatementFormatProfile[]>;
  saveStatementProfile?(profile: StatementFormatProfile): Promise<void>;
  deleteStatementProfile?(id: string): Promise<void>;
  getLearnedMerchantRules?(): Promise<LearnedMerchantRule[]>;
  saveLearnedMerchantRulesBatch?(rules: LearnedMerchantRule[]): Promise<void>;

  // Full backup & sovereign export
  getAllExpensesFromCloud?(): Promise<Array<Record<string, unknown>>>;
  exportArchive(): Promise<FullHouseholdArchive>;
  importArchive(archive: FullHouseholdArchive): Promise<void>;
}
