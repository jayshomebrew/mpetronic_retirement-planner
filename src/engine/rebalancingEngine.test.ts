import { describe, it, expect } from 'vitest';
import {
  calculateRebalance,
  getAccountName,
  getOwnerDisplayName,
  parseDollarInput,
  validateTemplate,
} from './rebalancingEngine';
import { RebalanceAccountTemplate, RebalanceFund } from '../shared/types/rebalancing';

const FUNDS: RebalanceFund[] = [
  { symbol: 'A', targetPercent: 50 },
  { symbol: 'B', targetPercent: 25 },
  { symbol: 'C', targetPercent: 25 },
];
const THRESHOLD = 5;

const account = (over: Partial<RebalanceAccountTemplate> = {}): RebalanceAccountTemplate => ({
  accountId: 'acc1',
  owner: 'primary',
  accountType: 'Rollover IRA',
  thresholdPoints: THRESHOLD,
  funds: FUNDS,
  archived: false,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('calculateRebalance', () => {
  it('matches the worked example: sell A and B, buy C', () => {
    const r = calculateRebalance(FUNDS, { A: 650, B: 300, C: 50 }, THRESHOLD)!;
    expect(r.accountStatus).toBe('NEEDED');
    const byId = Object.fromEntries(r.funds.map((f) => [f.symbol, f]));
    expect(byId.A.status).toBe('HIGH');
    expect(byId.B.status).toBe('IN_BAND'); // exactly on the +5 edge
    expect(byId.C.status).toBe('LOW');
    expect(byId.A.tradeAmount).toBe(-150);
    expect(byId.B.tradeAmount).toBe(-50);
    expect(byId.C.tradeAmount).toBe(200);
    expect(r.totalSells).toBe(200);
    expect(r.totalBuys).toBe(200);
  });

  it('is optional when every fund is within the band', () => {
    const r = calculateRebalance(FUNDS, { A: 520, B: 240, C: 240 }, THRESHOLD)!;
    expect(r.accountStatus).toBe('OPTIONAL');
    expect(r.funds.every((f) => f.status === 'IN_BAND')).toBe(true);
  });

  it('flags the account when a single fund just exceeds the band', () => {
    const r = calculateRebalance(FUNDS, { A: 550.1, B: 224.95, C: 224.95 }, THRESHOLD)!;
    expect(r.accountStatus).toBe('NEEDED');
  });

  it('reports no trade for funds already at target', () => {
    const r = calculateRebalance(FUNDS, { A: 500, B: 250, C: 250 }, THRESHOLD)!;
    expect(r.funds.every((f) => f.action === 'NONE')).toBe(true);
  });

  it('nets buys and sells to exactly zero after rounding', () => {
    const thirds: RebalanceFund[] = [
      { symbol: 'X', targetPercent: 33.33 },
      { symbol: 'Y', targetPercent: 33.33 },
      { symbol: 'Z', targetPercent: 33.34 },
    ];
    const r = calculateRebalance(thirds, { X: 1001.01, Y: 5, Z: 3.33 }, THRESHOLD)!;
    expect(Math.round((r.totalBuys - r.totalSells) * 100)).toBe(0);
  });

  it('returns null when the total is zero', () => {
    expect(calculateRebalance(FUNDS, { A: 0, B: 0, C: 0 }, THRESHOLD)).toBeNull();
  });

  it('treats a fully sold fund (zero) as a buy to target', () => {
    const r = calculateRebalance(FUNDS, { A: 750, B: 250, C: 0 }, THRESHOLD)!;
    expect(r.funds.find((f) => f.symbol === 'C')!.action).toBe('BUY');
  });
});

describe('validateTemplate', () => {
  it('accepts a valid template', () => {
    expect(validateTemplate(account(), [])).toEqual([]);
  });

  it('requires at least two funds', () => {
    const errs = validateTemplate(account({ funds: [{ symbol: 'A', targetPercent: 100 }] }), []);
    expect(errs.some((e) => e.includes('At least'))).toBe(true);
  });

  it('requires targets to sum to 100', () => {
    const errs = validateTemplate(
      account({ funds: [{ symbol: 'A', targetPercent: 50 }, { symbol: 'B', targetPercent: 40 }] }),
      []
    );
    expect(errs.some((e) => e.includes('sum'))).toBe(true);
  });

  it('rejects duplicate symbols case-insensitively', () => {
    const errs = validateTemplate(
      account({ funds: [{ symbol: 'fsnax', targetPercent: 50 }, { symbol: ' FSNAX ', targetPercent: 50 }] }),
      []
    );
    expect(errs.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('allows at most one cash fund', () => {
    const errs = validateTemplate(
      account({
        funds: [
          { symbol: 'A', targetPercent: 50, isCash: true },
          { symbol: 'B', targetPercent: 50, isCash: true },
        ],
      }),
      []
    );
    expect(errs.some((e) => e.includes('cash fund'))).toBe(true);
  });

  it('rejects out of range thresholds', () => {
    expect(validateTemplate(account({ thresholdPoints: 0 }), []).length).toBeGreaterThan(0);
    expect(validateTemplate(account({ thresholdPoints: 51 }), []).length).toBeGreaterThan(0);
  });

  it('enforces unique owner and account type but ignores archived and self', () => {
    const existing = account({ accountId: 'other' });
    expect(validateTemplate(account({ accountId: 'new' }), [existing]).length).toBeGreaterThan(0);
    expect(validateTemplate(account({ accountId: 'new' }), [{ ...existing, archived: true }])).toEqual([]);
    expect(validateTemplate(account({ accountId: 'other' }), [existing])).toEqual([]);
  });
});

describe('helpers', () => {
  it('parses dollar input', () => {
    expect(parseDollarInput('$12,345.67')).toBe(12345.67);
    expect(parseDollarInput('0')).toBe(0);
    expect(parseDollarInput('-5')).toBeNull();
    expect(parseDollarInput('abc')).toBeNull();
    expect(parseDollarInput('')).toBeNull();
  });

  it('builds account names from owner and type', () => {
    expect(getAccountName(getOwnerDisplayName('primary', 'Mark'), 'Roth IRA')).toBe('Mark Roth IRA');
    expect(getOwnerDisplayName('joint')).toBe('Joint');
    expect(getOwnerDisplayName('spouse', '  ')).toBe('Spouse');
  });
});

describe('transactions (exchanges)', () => {
  const tx = (funds: RebalanceFund[], values: Record<string, number>) =>
    calculateRebalance(funds, values, THRESHOLD)!.transactions!;

  it('pairs sells into the buy with exchanges when there is no cash fund', () => {
    const t = tx(FUNDS, { A: 650, B: 300, C: 50 });
    expect(t).toEqual([
      expect.objectContaining({ type: 'EXCHANGE', fromSymbol: 'A', toSymbol: 'C', amount: 150 }),
      expect.objectContaining({ type: 'EXCHANGE', fromSymbol: 'B', toSymbol: 'C', amount: 50 }),
    ]);
  });

  it('splits one sell across several buys', () => {
    const funds: RebalanceFund[] = [
      { symbol: 'A', targetPercent: 40 },
      { symbol: 'B', targetPercent: 30 },
      { symbol: 'C', targetPercent: 30 },
    ];
    const t = tx(funds, { A: 700, B: 100, C: 200 });
    expect(t.every((x) => x.type === 'EXCHANGE' && x.fromSymbol === 'A')).toBe(true);
    expect(t.map((x) => [x.toSymbol, x.amount])).toEqual([['B', 200], ['C', 100]]);
  });

  it('spends excess cash on the largest need first, then exchanges the rest', () => {
    const funds: RebalanceFund[] = [
      { symbol: 'A', targetPercent: 40 },
      { symbol: 'B', targetPercent: 30 },
      { symbol: 'C', targetPercent: 20 },
      { symbol: 'SPAXX', targetPercent: 10, isCash: true },
    ];
    // total 1000: targets A 400, B 300, C 200, cash 100. Cash is 200 (excess 100), A 450 (sell 50), B 150, C 200.
    const t = tx(funds, { A: 450, B: 150, C: 200, SPAXX: 200 });
    expect(t[0]).toEqual(expect.objectContaining({ type: 'BUY', fromSymbol: 'SPAXX', toSymbol: 'B', amount: 100 }));
    expect(t[1]).toEqual(expect.objectContaining({ type: 'EXCHANGE', fromSymbol: 'A', toSymbol: 'B', amount: 50 }));
    expect(t).toHaveLength(2);
  });

  it('spills excess cash into the next-largest need', () => {
    const funds: RebalanceFund[] = [
      { symbol: 'A', targetPercent: 40 },
      { symbol: 'B', targetPercent: 40 },
      { symbol: 'SPAXX', targetPercent: 20, isCash: true },
    ];
    // total 1000: A 300 (needs +100), B 250 (needs +150), cash 450 (excess 250)
    const t = tx(funds, { A: 300, B: 250, SPAXX: 450 });
    expect(t.map((x) => [x.type, x.toSymbol, x.amount])).toEqual([
      ['BUY', 'B', 150],
      ['BUY', 'A', 100],
    ]);
  });

  it('sells into cash when the cash fund is under target', () => {
    const funds: RebalanceFund[] = [
      { symbol: 'A', targetPercent: 40 },
      { symbol: 'B', targetPercent: 40 },
      { symbol: 'SPAXX', targetPercent: 20, isCash: true },
    ];
    // total 1000: A 600 (sell 200), B 400 (no trade), cash 0 (needs +200)
    const t = tx(funds, { A: 600, B: 400, SPAXX: 0 });
    expect(t).toHaveLength(1);
    expect(t[0]).toEqual(expect.objectContaining({ type: 'SELL', fromSymbol: 'A', toSymbol: 'SPAXX', amount: 200 }));
  });

  it('exchanges first and sells only the remainder into cash', () => {
    const funds: RebalanceFund[] = [
      { symbol: 'A', targetPercent: 40 },
      { symbol: 'B', targetPercent: 40 },
      { symbol: 'SPAXX', targetPercent: 20, isCash: true },
    ];
    // total 1000: A 600 (sell 200), B 350 (needs +50), cash 50 (needs +150)
    const t = tx(funds, { A: 600, B: 350, SPAXX: 50 });
    expect(t.map((x) => [x.type, x.fromSymbol, x.toSymbol, x.amount])).toEqual([
      ['EXCHANGE', 'A', 'B', 50],
      ['SELL', 'A', 'SPAXX', 150],
    ]);
  });

  it('treats a fund named like a money market as an ordinary fund unless flagged as cash', () => {
    const funds: RebalanceFund[] = [
      { symbol: 'A', targetPercent: 40 },
      { symbol: 'B', targetPercent: 40 },
      { symbol: 'SPAXX', targetPercent: 20 },
    ];
    const t = tx(funds, { A: 600, B: 400, SPAXX: 0 });
    expect(t).toEqual([expect.objectContaining({ type: 'EXCHANGE', fromSymbol: 'A', toSymbol: 'SPAXX', amount: 200 })]);
  });

  it('produces no transactions when everything is at target', () => {
    expect(tx(FUNDS, { A: 500, B: 250, C: 250 })).toEqual([]);
  });

  it('moves exactly the same dollars the per-fund trades require', () => {
    const t = tx(FUNDS, { A: 650.37, B: 301.11, C: 48.52 });
    const bought = t.filter((x) => x.toSymbol === 'C').reduce((s, x) => s + Math.round(x.amount * 100), 0);
    const sold = t.filter((x) => x.fromSymbol !== null).reduce((s, x) => s + Math.round(x.amount * 100), 0);
    expect(bought).toBe(sold);
  });
});
