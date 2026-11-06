import { describe, it, expect } from 'vitest';
import { planRebalancingImport } from './importPlan';
import { RebalanceAccountTemplate, RebalanceSnapshot } from '../../types/rebalancing';

const acct = (id: string, over: Partial<RebalanceAccountTemplate> = {}): RebalanceAccountTemplate => ({
  accountId: id,
  owner: 'primary',
  accountType: 'Roth IRA',
  thresholdPoints: 5,
  funds: [],
  archived: false,
  createdAt: '',
  updatedAt: '',
  ...over,
});
const snap = (id: string, accountId: string) => ({ snapshotId: id, accountId }) as RebalanceSnapshot;

describe('planRebalancingImport', () => {
  it('skips an account with the same owner and type, and its snapshots', () => {
    const plan = planRebalancingImport([acct('a1')], [acct('a2')], [snap('s1', 'a2')]);
    expect(plan.accounts).toEqual([]);
    expect(plan.snapshots).toEqual([]);
    expect(plan.skippedAccounts).toHaveLength(1);
  });

  it('skips an account whose id already exists', () => {
    const plan = planRebalancingImport([acct('a1')], [acct('a1', { owner: 'spouse' })], []);
    expect(plan.skippedAccounts).toHaveLength(1);
  });

  it('imports new accounts with their snapshots', () => {
    const plan = planRebalancingImport([acct('a1')], [acct('a2', { owner: 'joint' })], [snap('s1', 'a2')]);
    expect(plan.accounts).toHaveLength(1);
    expect(plan.snapshots).toHaveLength(1);
    expect(plan.skippedAccounts).toEqual([]);
  });

  it('allows an archived incoming account next to an active one', () => {
    const plan = planRebalancingImport([acct('a1')], [acct('a2', { archived: true })], []);
    expect(plan.accounts).toHaveLength(1);
  });

  it('skips a second active duplicate within the same archive', () => {
    const plan = planRebalancingImport([], [acct('a1'), acct('a2')], []);
    expect(plan.accounts).toHaveLength(1);
    expect(plan.skippedAccounts).toHaveLength(1);
  });
});
