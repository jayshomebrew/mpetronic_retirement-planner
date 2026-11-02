export type RebalanceOwner = 'primary' | 'spouse' | 'joint';

export type RebalanceAccountType = 'Rollover IRA' | 'Roth IRA' | 'Brokerage';

export const REBALANCE_ACCOUNT_TYPES: RebalanceAccountType[] = ['Rollover IRA', 'Roth IRA', 'Brokerage'];

export const REBALANCE_OWNERS: RebalanceOwner[] = ['primary', 'spouse', 'joint'];

export const TARGET_PERCENT_TOTAL = 100;
export const TARGET_SUM_TOLERANCE = 0.005;
export const MIN_FUNDS_PER_ACCOUNT = 2;
export const DEFAULT_THRESHOLD_POINTS = 5;
export const MAX_THRESHOLD_POINTS = 50;
export const CENTS_PER_DOLLAR = 100;

export interface RebalanceFund {
  symbol: string;
  targetPercent: number;
  // Marks the account's one cash fund (for example a money market core position). Cash is never
  // exchanged with a fund; money moves in and out of it with an ordinary buy or sell.
  isCash?: boolean;
}

export interface RebalanceAccountTemplate {
  accountId: string;
  owner: RebalanceOwner;
  accountType: RebalanceAccountType;
  thresholdPoints: number;
  funds: RebalanceFund[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type FundStatus = 'IN_BAND' | 'HIGH' | 'LOW';
export type AccountStatus = 'NEEDED' | 'OPTIONAL';
export type TradeAction = 'BUY' | 'SELL' | 'NONE';

export interface FundResult {
  symbol: string;
  value: number;
  currentPercent: number;
  targetPercent: number;
  deviationPoints: number;
  status: FundStatus;
  tradeAmount: number; // positive = buy, negative = sell, rounded to cents
  tradePercentPoints: number; // signed percentage points of the account
  action: TradeAction;
}

export type TransactionType = 'EXCHANGE' | 'BUY' | 'SELL';

/**
 * One instruction for the Fidelity trade wizard. EXCHANGE moves money between two mutual funds.
 * BUY funds a fund from the core cash position, SELL puts proceeds into it. For BUY and SELL the
 * cash side is null when the template has no core cash fund.
 */
export interface RebalanceTransaction {
  type: TransactionType;
  fromSymbol: string | null;
  toSymbol: string | null;
  amount: number; // dollars, rounded to cents, always positive
  percentPoints: number; // amount as a percent of the account total
}

export interface RebalanceResult {
  total: number;
  accountStatus: AccountStatus;
  funds: FundResult[];
  totalSells: number;
  totalBuys: number;
  residualAdjustment: number; // cents-level amount applied to the largest trade so buys equal sells
  residualSymbol: string | null;
  transactions?: RebalanceTransaction[]; // absent on snapshots saved before exchanges existed
}

export interface RebalanceSnapshot {
  snapshotId: string;
  accountId: string;
  savedAt: string;
  owner: RebalanceOwner;
  ownerDisplayName: string;
  accountType: RebalanceAccountType;
  accountName: string;
  thresholdPoints: number;
  funds: RebalanceFund[];
  values: Record<string, number>;
  result: RebalanceResult;
  note?: string;
  executed: boolean;
}

export interface RebalancingImportReport {
  accountsImported: number;
  snapshotsImported: number;
  skippedAccounts: string[];
}

export interface RebalancingStorage {
  getAccounts(): Promise<RebalanceAccountTemplate[]>;
  saveAccount(account: RebalanceAccountTemplate): Promise<void>;
  deleteAccount(accountId: string): Promise<void>; // hard delete, also removes its snapshots
  getSnapshots(accountId?: string): Promise<RebalanceSnapshot[]>;
  saveSnapshot(snapshot: RebalanceSnapshot): Promise<void>;
  deleteSnapshot(accountId: string, snapshotId: string): Promise<void>;
  exportRebalancing(): Promise<{ accounts: RebalanceAccountTemplate[]; snapshots: RebalanceSnapshot[] }>;
  importRebalancing(
    accounts: RebalanceAccountTemplate[],
    snapshots: RebalanceSnapshot[]
  ): Promise<RebalancingImportReport>;
}
